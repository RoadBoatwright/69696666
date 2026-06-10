import type { Repository } from 'typeorm';

import { CredentialNotConfiguredError } from '../../common/errors/credential.error';
import { PlatformAdapterRegistry } from '../platform-adapter';
import type { PlatformAdapter } from '../platform-adapter/domain/platform-adapter';
import { AssetInUseError, AssetNotFoundError, AssetService } from './asset.service';
import { Asset } from './entities/asset.entity';
import { AdAsset } from './entities/ad-asset.entity';
import type { AssetStorage } from './ports';
import { MAX_FILE_SIZE_BYTES, type PlatformAssetSpec } from './domain/asset';

/** 通用内存仓储桩（支持 uuid 注入与多条匹配，含复合主键实体）。 */
function makeRepo<T extends object>(
  prefix: string,
  keyOf?: (e: T) => string,
): {
  repo: Repository<T>;
  store: Map<string, T>;
} {
  const store = new Map<string, T>();
  let seq = 0;
  const matches = (v: T, where: Partial<T>): boolean =>
    Object.entries(where).every(([k, val]) => (v as Record<string, unknown>)[k] === val);
  const recordKey = (e: T): string => {
    if (keyOf) {
      return keyOf(e);
    }
    const rec = e as Record<string, unknown>;
    if (!rec.id) {
      rec.id = `${prefix}-${++seq}`;
    }
    return rec.id as string;
  };
  const repo = {
    create: (e: Partial<T>) => ({ ...e }) as T,
    save: async (e: T) => {
      const key = recordKey(e);
      store.set(key, { ...e });
      return store.get(key)!;
    },
    remove: async (e: T) => {
      store.delete(recordKey(e));
      return e;
    },
    findOne: async ({ where }: { where: Partial<T> }) => {
      for (const v of store.values()) {
        if (matches(v, where)) {
          return { ...v };
        }
      }
      return null;
    },
    find: async ({ where }: { where?: Partial<T> } = {}) => {
      const out: T[] = [];
      for (const v of store.values()) {
        if (!where || matches(v, where)) {
          out.push({ ...v });
        }
      }
      return out;
    },
  } as unknown as Repository<T>;
  return { repo, store };
}

function makeAdapter(overrides: Partial<PlatformAdapter> = {}): PlatformAdapter {
  return {
    platform: 'meta',
    publishCampaign: async () => ({ platformCampaignId: 'pc', nativeIds: {} }),
    applyTargeting: async () => ({ nativeTargetingId: 't', notApplicable: [] }),
    uploadAsset: overrides.uploadAsset ?? (async () => ({ platformAssetId: 'pa-1' })),
    attachLeadForm: async () => ({ platformLeadFormId: 'lf' }),
    submitConversionTracking: async () => ({ platformTrackingId: 'cv' }),
    fetchMetrics: async () => ({ platform: 'meta', rows: [] }),
    fetchReviewStatus: async () => [],
    supportedBiddingStrategies: () => ['MAXIMIZE_CONVERSIONS'],
  } as PlatformAdapter;
}

function setup(opts: { adapter?: PlatformAdapter; storage?: AssetStorage } = {}) {
  const asset = makeRepo<Asset>('asset');
  const adAsset = makeRepo<AdAsset>('adasset', (e) => `${e.adId}:${e.assetId}`);
  const adapter = opts.adapter ?? makeAdapter();
  const registry = {
    getAdapter: () => adapter,
    createContext: () => ({
      platform: adapter.platform,
      callWithCredential: async () => undefined,
    }),
  } as unknown as PlatformAdapterRegistry;
  const service = new AssetService(asset.repo, adAsset.repo, registry, opts.storage);
  return { service, asset, adAsset, adapter };
}

const META_SPEC: PlatformAssetSpec = {
  allowedFormats: ['mp4', 'jpg', 'png'],
  maxSizeBytes: 200 * 1024 * 1024,
  minDurationSec: 3,
  maxDurationSec: 60,
};

describe('AssetService（组件 7，需求 11）', () => {
  describe('上传与合规校验（需求 11.1、11.2）', () => {
    it('合法成品素材上传成功并生成唯一标识、记录来源与上传时间（需求 11.1）', async () => {
      const { service, asset } = setup();
      const result = await service.upload({
        merchantId: 'm1',
        type: 'image',
        sizeBytes: 1024,
        format: 'jpg',
        sourceType: 'merchant_upload',
      });
      expect(result.uploaded).toBe(true);
      if (result.uploaded) {
        expect(result.assetId).toBeDefined();
        const stored = asset.store.get(result.assetId)!;
        expect(stored.sourceType).toBe('merchant_upload');
        expect(stored.createdAt === undefined || stored.createdAt instanceof Date).toBe(true);
      }
    });

    it('超系统上限拒绝、不存储并返回不符合项（需求 11.2）', async () => {
      const { service, asset } = setup();
      const result = await service.upload({
        merchantId: 'm1',
        type: 'video',
        sizeBytes: MAX_FILE_SIZE_BYTES + 1,
      });
      expect(result.uploaded).toBe(false);
      if (!result.uploaded) {
        expect(result.reason).toBe('validation');
        expect(result.errors?.some((e) => e.code === 'size_exceeds_limit')).toBe(true);
      }
      expect(asset.store.size).toBe(0);
    });

    it('轮播子素材数量越界拒绝（需求 11.1）', async () => {
      const { service } = setup();
      const result = await service.upload({
        merchantId: 'm1',
        type: 'carousel',
        sizeBytes: 1024,
        carouselChildren: 1,
      });
      expect(result.uploaded).toBe(false);
      if (!result.uploaded) {
        expect(result.errors?.some((e) => e.code === 'carousel_children_out_of_range')).toBe(true);
      }
    });

    it('平台规格不符返回每项具体不符合项（格式+时长，需求 11.2）', async () => {
      const { service } = setup();
      const result = await service.upload(
        { merchantId: 'm1', type: 'video', sizeBytes: 1024, format: 'mov', durationSec: 120 },
        META_SPEC,
      );
      expect(result.uploaded).toBe(false);
      if (!result.uploaded) {
        const codes = (result.errors ?? []).map((e) => e.code);
        expect(codes).toEqual(
          expect.arrayContaining(['format_unsupported', 'duration_out_of_range']),
        );
      }
    });
  });

  describe('单份失败隔离（需求 11.3）', () => {
    it('存储失败隔离该份，其余成功素材保留，不中断整批', async () => {
      let calls = 0;
      const storage: AssetStorage = {
        store: async (id) => {
          calls += 1;
          // 第二份模拟网络中断/存储失败。
          if (calls === 2) {
            throw new Error('网络中断');
          }
          return { storageRef: `s3://${id}` };
        },
        remove: async () => undefined,
      };
      const { service, asset } = setup({ storage });
      const result = await service.uploadBatch([
        { merchantId: 'm1', type: 'image', sizeBytes: 1, clientRef: 'a' },
        { merchantId: 'm1', type: 'image', sizeBytes: 2, clientRef: 'b' },
        { merchantId: 'm1', type: 'image', sizeBytes: 3, clientRef: 'c' },
      ]);
      expect(result.succeeded.map((s) => s.clientRef)).toEqual(['a', 'c']);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toMatchObject({ clientRef: 'b', reason: 'storage' });
      // 不保留不完整素材：仅 2 份成功落库。
      expect(asset.store.size).toBe(2);
    });
  });

  describe('挂载素材到广告（需求 11.4、11.5）', () => {
    it('挂载成功记录 platform_ref 与已引用状态（需求 11.4）', async () => {
      const { service, asset, adAsset } = setup();
      const up = await service.upload({ merchantId: 'm1', type: 'image', sizeBytes: 1024 });
      const assetId = (up as { assetId: string }).assetId;
      const result = await service.attachToAd(assetId, 'ad-1', 'meta');
      expect(result.attached).toBe(true);
      expect(result.platformRef).toBe('pa-1');
      const rel = await adAsset.repo.findOne({ where: { adId: 'ad-1', assetId } });
      expect(rel?.refStatus).toBe('referenced');
      expect(asset.store.size).toBe(1);
    });

    it('平台上传失败保留关联记录待重试并返回失败原因（需求 11.5）', async () => {
      const adapter = makeAdapter({
        uploadAsset: async () => {
          throw new Error('platform upload failed');
        },
      });
      const { service, adAsset } = setup({ adapter });
      const up = await service.upload({ merchantId: 'm1', type: 'image', sizeBytes: 1024 });
      const assetId = (up as { assetId: string }).assetId;
      const result = await service.attachToAd(assetId, 'ad-1', 'meta');
      expect(result.attached).toBe(false);
      expect(result.refStatus).toBe('pending_retry');
      expect(result.reason).toContain('platform upload failed');
      const rel = await adAsset.repo.findOne({ where: { adId: 'ad-1', assetId } });
      expect(rel?.refStatus).toBe('pending_retry');
    });

    it('凭据未配置时优雅降级，关联记录待重试（需求 1.5、11.5）', async () => {
      const adapter = makeAdapter({
        uploadAsset: async () => {
          throw new CredentialNotConfiguredError('meta');
        },
      });
      const { service } = setup({ adapter });
      const up = await service.upload({ merchantId: 'm1', type: 'image', sizeBytes: 1024 });
      const assetId = (up as { assetId: string }).assetId;
      const result = await service.attachToAd(assetId, 'ad-1', 'meta');
      expect(result.attached).toBe(false);
      expect(result.reason).toContain('凭据未配置');
    });
  });

  describe('查看/复用/删除（需求 11.6、11.7）', () => {
    it('查看仅返回自身账户素材（需求 11.6）', async () => {
      const { service } = setup();
      await service.upload({ merchantId: 'm1', type: 'image', sizeBytes: 1 });
      await service.upload({ merchantId: 'm2', type: 'image', sizeBytes: 1 });
      const list = await service.listAssets('m1');
      expect(list).toHaveLength(1);
      expect(list[0].merchantId).toBe('m1');
    });

    it('未被引用的素材可删除（需求 11.6）', async () => {
      const removed: string[] = [];
      const storage: AssetStorage = {
        store: async (id) => ({ storageRef: `s3://${id}` }),
        remove: async (ref) => {
          if (ref) removed.push(ref);
        },
      };
      const { service, asset } = setup({ storage });
      const up = await service.upload({ merchantId: 'm1', type: 'image', sizeBytes: 1 });
      const assetId = (up as { assetId: string }).assetId;
      await service.deleteAsset('m1', assetId);
      expect(asset.store.size).toBe(0);
      expect(removed).toHaveLength(1);
    });

    it('删除正被引用的素材被拒并提示正在被引用（需求 11.7）', async () => {
      const { service, adAsset } = setup();
      const up = await service.upload({ merchantId: 'm1', type: 'image', sizeBytes: 1 });
      const assetId = (up as { assetId: string }).assetId;
      await adAsset.repo.save({ adId: 'ad-1', assetId } as AdAsset);
      await expect(service.deleteAsset('m1', assetId)).rejects.toBeInstanceOf(AssetInUseError);
    });

    it('删除不存在/非本账户素材抛 AssetNotFoundError（需求 11.6）', async () => {
      const { service } = setup();
      const up = await service.upload({ merchantId: 'm1', type: 'image', sizeBytes: 1 });
      const assetId = (up as { assetId: string }).assetId;
      await expect(service.deleteAsset('m2', assetId)).rejects.toBeInstanceOf(AssetNotFoundError);
    });
  });
});
