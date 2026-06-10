import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CredentialNotConfiguredError } from '../../common/errors/credential.error';
import { PlatformAdapterRegistry } from '../platform-adapter';
import type { AssetRef, PlatformId } from '../platform-adapter/domain/platform-adapter';
import { validateAssetUpload } from './pure/asset-validation.pure';
import { Asset } from './entities/asset.entity';
import { AdAsset } from './entities/ad-asset.entity';
import { ASSET_STORAGE, type AssetStorage } from './ports';
import type {
  AssetUploadFailure,
  AssetUploadInput,
  AssetUploadOutcome,
  AssetUploadSuccess,
  BatchUploadResult,
  PlatformAssetSpec,
} from './domain/asset';

/** 删除被引用素材错误（需求 11.7）。 */
export class AssetInUseError extends Error {
  constructor(assetId: string, referencingAdIds: string[]) {
    super('该素材正在被引用，无法删除');
    this.name = 'AssetInUseError';
    this.assetId = assetId;
    this.referencingAdIds = referencingAdIds;
  }

  readonly assetId: string;
  readonly referencingAdIds: string[];
}

/** 素材不存在 / 非本账户素材错误（需求 11.6）。 */
export class AssetNotFoundError extends Error {
  constructor(assetId: string) {
    super('素材不存在或不属于当前账户');
    this.name = 'AssetNotFoundError';
    this.assetId = assetId;
  }

  readonly assetId: string;
}

/** 挂载素材到广告的结果（需求 11.4、11.5）。 */
export interface AttachAssetResult {
  /** 是否成功上传/引用至目标平台。 */
  attached: boolean;
  /** 平台侧返回的素材标识（成功时）。 */
  platformRef?: string | null;
  /** 引用状态：referenced 已引用；pending_retry 平台失败待重试（需求 11.5）。 */
  refStatus: 'referenced' | 'pending_retry';
  /** 失败原因说明（需求 11.5）。 */
  reason?: string;
}

/**
 * 素材服务（组件 7，需求 11）。
 *
 * 职责（成品素材直投定位——系统只做合规校验与挂载，不做创意制作/改写）：
 *  - 上传成品广告素材（视频/图片/PDF/轮播）：单文件 ≤ 500MB、轮播 2-10、生成唯一标识、
 *    记录来源类型与精确到秒上传时间（需求 11.1）。
 *  - 平台合规校验（格式/尺寸/时长/文件大小）：不符合即拒绝、不存储、返回全部不符合项（需求 11.2）。
 *  - 单份失败隔离：网络中断/存储失败仅隔离该份、不保留不完整素材、保留其余成功素材、
 *    不中断整批（需求 11.3）。
 *  - 挂载素材到广告：经平台适配器 uploadAsset 上传/引用至目标平台（需求 11.4）；
 *    失败保留素材与广告关联记录待重试（需求 11.5）。
 *  - 查看/复用/删除自身账户素材（需求 11.6）；被引用素材拒绝删除（需求 11.7）。
 *
 * 真实服务原则：底层存储经 {@link AssetStorage} 端口落库；上传至平台经平台适配器调用
 * 真实官方 API；不以假数据顶替业务逻辑。
 */
@Injectable()
export class AssetService {
  private readonly logger = new Logger(AssetService.name);

  constructor(
    @InjectRepository(Asset)
    private readonly assetRepo: Repository<Asset>,
    @InjectRepository(AdAsset)
    private readonly adAssetRepo: Repository<AdAsset>,
    private readonly adapters: PlatformAdapterRegistry,
    @Optional()
    @Inject(ASSET_STORAGE)
    private readonly storage?: AssetStorage,
  ) {}

  // ---------------------------------------------------------------------------
  // 11.1 / 11.2 / 11.3 批量上传：合规校验 + 单份失败隔离
  // ---------------------------------------------------------------------------

  /**
   * 上传一份成品广告素材（需求 11.1、11.2）。
   *
   * 合规校验通过 → 存储、生成唯一标识、记录来源类型与上传时间、返回上传成功指示；
   * 不通过 → 拒绝、不存储、返回包含每一项具体不符合项的错误说明（需求 11.2）。
   * 存储/网络中断 → 不保留不完整素材、返回存储失败（需求 11.3）。
   */
  async upload(input: AssetUploadInput, spec?: PlatformAssetSpec): Promise<AssetUploadOutcome> {
    return this.uploadOne(input, spec);
  }

  /**
   * 批量上传成品广告素材，单份失败隔离不中断整批（需求 11.3，Property 21）。
   *
   * 每份独立校验与存储：成功份进入 `succeeded`、失败份（校验不符或存储失败）被隔离进入
   * `failed`，不保留不完整素材；任一份失败不影响其余份的成功落库。
   *
   * @param inputs 本批待上传素材集合。
   * @param spec   目标平台合规规格（可选，需求 11.2）。
   */
  async uploadBatch(
    inputs: AssetUploadInput[],
    spec?: PlatformAssetSpec,
  ): Promise<BatchUploadResult> {
    const succeeded: AssetUploadSuccess[] = [];
    const failed: AssetUploadFailure[] = [];

    for (const input of inputs) {
      const outcome = await this.uploadOne(input, spec);
      if (outcome.uploaded) {
        succeeded.push(outcome);
      } else {
        failed.push(outcome);
      }
    }

    return { succeeded, failed };
  }

  /** 上传单份的内部实现：校验 → 存储 → 落库；失败隔离不抛出（需求 11.2、11.3）。 */
  private async uploadOne(
    input: AssetUploadInput,
    spec?: PlatformAssetSpec,
  ): Promise<AssetUploadOutcome> {
    // 合规校验：不符合即拒绝、不存储、返回全部不符合项（需求 11.2）。
    const errors = validateAssetUpload(input, spec);
    if (errors.length > 0) {
      return { clientRef: input.clientRef, uploaded: false, reason: 'validation', errors };
    }

    // 先生成唯一素材标识（需求 11.1），供存储端口与持久化共用。
    const assetId = randomUUID();

    try {
      // 存储：网络中断/存储失败时抛错，隔离该份、不保留不完整素材（需求 11.3）。
      let storageRef: string | null = null;
      if (this.storage) {
        const stored = await this.storage.store(assetId, input);
        storageRef = stored.storageRef;
      }

      const entity = this.assetRepo.create({
        id: assetId,
        merchantId: input.merchantId,
        type: input.type,
        sizeBytes: String(Math.trunc(input.sizeBytes)),
        carouselChildren: input.type === 'carousel' ? (input.carouselChildren ?? null) : null,
        sourceType: input.sourceType ?? null,
        storageRef,
        format: input.format ?? null,
      });
      const saved = await this.assetRepo.save(entity);

      return { clientRef: input.clientRef, uploaded: true, assetId: saved.id };
    } catch (error) {
      // 隔离失败份：清理可能产生的不完整素材，保留其余成功素材（需求 11.3）。
      const message = error instanceof Error ? error.message : '存储失败';
      this.logger.warn(
        `成品素材上传失败已隔离：merchantId=${input.merchantId}, type=${input.type}, 原因=${message}`,
      );
      return { clientRef: input.clientRef, uploaded: false, reason: 'storage', message };
    }
  }

  // ---------------------------------------------------------------------------
  // 11.4 / 11.5 挂载素材到广告：经平台适配器上传/引用至目标平台
  // ---------------------------------------------------------------------------

  /**
   * 将成品素材挂载/引用到广告（需求 11.4、11.5）。
   *
   * 经平台适配器 `uploadAsset` 将成品素材上传/引用至目标平台（不做创意改写或重新设计，
   * 需求 11.4）。无论成功与否均保留素材与广告的关联记录（AdAsset）：
   *  - 成功 → 记录 platform_ref、ref_status='referenced'。
   *  - 失败 → 保留关联记录、ref_status='pending_retry' 以待重试，并返回失败原因（需求 11.5）。
   *
   * @param assetId  系统素材标识（须存在）。
   * @param adId     目标广告标识。
   * @param platform 目标平台标识。
   */
  async attachToAd(
    assetId: string,
    adId: string,
    platform: PlatformId,
  ): Promise<AttachAssetResult> {
    const asset = await this.assetRepo.findOne({ where: { id: assetId } });
    if (!asset) {
      throw new AssetNotFoundError(assetId);
    }

    const ref: AssetRef = {
      assetId: asset.id,
      type: asset.type,
      source: asset.storageRef ?? '',
    };

    // 预先建立/取得关联记录，保证失败时关联仍被保留以待重试（需求 11.5）。
    const existing = await this.adAssetRepo.findOne({ where: { adId, assetId } });
    const relation = existing ?? this.adAssetRepo.create({ adId, assetId });

    try {
      const adapter = this.adapters.getAdapter(platform);
      const ctx = this.adapters.createContext(platform);
      const result = await adapter.uploadAsset(ctx, ref);

      relation.platformRef = result.platformAssetId;
      relation.refStatus = 'referenced';
      await this.adAssetRepo.save(relation);
      return { attached: true, platformRef: result.platformAssetId, refStatus: 'referenced' };
    } catch (error) {
      // 上传/引用至平台失败：保留关联记录待重试并返回失败原因（需求 11.5）。
      const reason =
        error instanceof CredentialNotConfiguredError
          ? `平台「${platform}」凭据未配置`
          : error instanceof Error
            ? error.message
            : '素材上传至平台失败';
      relation.platformRef = relation.platformRef ?? null;
      relation.refStatus = 'pending_retry';
      await this.adAssetRepo.save(relation);
      this.logger.warn(`素材挂载至平台失败，保留关联待重试：assetId=${assetId}, adId=${adId}`);
      return { attached: false, refStatus: 'pending_retry', reason };
    }
  }

  // ---------------------------------------------------------------------------
  // 11.6 / 11.7 查看 / 复用 / 删除自身素材
  // ---------------------------------------------------------------------------

  /** 查看某商家账户已上传的全部素材（需求 11.6）。 */
  async listAssets(merchantId: string): Promise<Asset[]> {
    return this.assetRepo.find({ where: { merchantId } });
  }

  /** 取得某商家账户的单份素材，供复用挂载（需求 11.6）。 */
  async getAsset(merchantId: string, assetId: string): Promise<Asset> {
    const asset = await this.assetRepo.findOne({ where: { id: assetId, merchantId } });
    if (!asset) {
      throw new AssetNotFoundError(assetId);
    }
    return asset;
  }

  /**
   * 删除某商家账户的素材（需求 11.6、11.7）。
   *
   * - 素材正被任意广告引用（存在 AdAsset 关联）→ 拒绝删除并提示正在被引用
   *   （抛 {@link AssetInUseError}，需求 11.7，Property 23）。
   * - 否则删除底层存储与素材记录（需求 11.6）。
   *
   * @throws AssetNotFoundError 素材不存在或不属于该账户。
   * @throws AssetInUseError 素材正被广告引用。
   */
  async deleteAsset(merchantId: string, assetId: string): Promise<void> {
    const asset = await this.assetRepo.findOne({ where: { id: assetId, merchantId } });
    if (!asset) {
      throw new AssetNotFoundError(assetId);
    }

    const references = await this.adAssetRepo.find({ where: { assetId } });
    if (references.length > 0) {
      throw new AssetInUseError(
        assetId,
        references.map((r) => r.adId),
      );
    }

    if (this.storage) {
      await this.storage.remove(asset.storageRef);
    }
    await this.assetRepo.remove(asset);
  }
}
