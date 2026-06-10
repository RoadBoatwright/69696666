import fc from 'fast-check';
import type { Repository } from 'typeorm';

import { PlatformAdapterRegistry } from '../platform-adapter';
import type { PlatformAdapter } from '../platform-adapter/domain/platform-adapter';
import { AssetInUseError, AssetService } from './asset.service';
import { Asset } from './entities/asset.entity';
import { AdAsset } from './entities/ad-asset.entity';
import type { AssetStorage } from './ports';
import { validateAssetUpload } from './pure/asset-validation.pure';
import {
  CAROUSEL_CHILDREN_MAX,
  CAROUSEL_CHILDREN_MIN,
  MAX_FILE_SIZE_BYTES,
  type AssetType,
  type AssetUploadInput,
} from './domain/asset';

/**
 * 素材服务属性测试（组件 7，需求 11）。
 *
 * 覆盖 Property 21（单份失败隔离不变量）、Property 22（素材约束与不符合项完整反馈）、
 * Property 23（被引用素材不可删除）。底层存储经桩注入，平台调用经假适配器。最少 100 次迭代。
 */

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
        if (matches(v, where)) return { ...v };
      }
      return null;
    },
    find: async ({ where }: { where?: Partial<T> } = {}) => {
      const out: T[] = [];
      for (const v of store.values()) {
        if (!where || matches(v, where)) out.push({ ...v });
      }
      return out;
    },
  } as unknown as Repository<T>;
  return { repo, store };
}

function makeAdapter(): PlatformAdapter {
  return {
    platform: 'meta',
    publishCampaign: async () => ({ platformCampaignId: 'pc', nativeIds: {} }),
    applyTargeting: async () => ({ nativeTargetingId: 't', notApplicable: [] }),
    uploadAsset: async () => ({ platformAssetId: 'pa' }),
    attachLeadForm: async () => ({ platformLeadFormId: 'lf' }),
    submitConversionTracking: async () => ({ platformTrackingId: 'cv' }),
    fetchMetrics: async () => ({ platform: 'meta', rows: [] }),
    fetchReviewStatus: async () => [],
    supportedBiddingStrategies: () => ['MAXIMIZE_CONVERSIONS'],
  } as PlatformAdapter;
}

function setup(storage?: AssetStorage) {
  const asset = makeRepo<Asset>('asset');
  const adAsset = makeRepo<AdAsset>('adasset', (e) => `${e.adId}:${e.assetId}`);
  const adapter = makeAdapter();
  const registry = {
    getAdapter: () => adapter,
    createContext: () => ({
      platform: adapter.platform,
      callWithCredential: async () => undefined,
    }),
  } as unknown as PlatformAdapterRegistry;
  const service = new AssetService(asset.repo, adAsset.repo, registry, storage);
  return { service, asset, adAsset };
}

/** 生成「合法」成品素材输入（系统上限内、轮播 2-10）。 */
const validInputArb: fc.Arbitrary<AssetUploadInput> = fc
  .record({
    type: fc.constantFrom<AssetType>('image', 'video', 'pdf', 'carousel'),
    sizeBytes: fc.integer({ min: 1, max: MAX_FILE_SIZE_BYTES }),
    carouselChildren: fc.integer({ min: CAROUSEL_CHILDREN_MIN, max: CAROUSEL_CHILDREN_MAX }),
  })
  .map(({ type, sizeBytes, carouselChildren }) => ({
    merchantId: 'm1',
    type,
    sizeBytes,
    carouselChildren: type === 'carousel' ? carouselChildren : null,
  }));

/** 生成任意（可能合法可能非法）成品素材输入。 */
const anyInputArb: fc.Arbitrary<AssetUploadInput> = fc.record({
  merchantId: fc.constantFrom('m1', ''),
  type: fc.constantFrom<AssetType>('image', 'video', 'pdf', 'carousel'),
  sizeBytes: fc.integer({ min: -10, max: MAX_FILE_SIZE_BYTES + 5_000_000 }),
  carouselChildren: fc.integer({ min: 0, max: 15 }),
});

describe('素材服务属性测试（fast-check）', () => {
  // Feature: multi-platform-ad-integration, Property 21
  // Property 21: 素材单份失败隔离不变量
  // Validates: Requirements 11.3
  it('Property 21: 含成功/失败份的批次，成功集合不受失败份影响且失败份被隔离不中断整批', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 每份的「存储是否失败」标志，至少 1 份。
        fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }),
        async (failFlags) => {
          let idx = 0;
          const storage: AssetStorage = {
            store: async (id) => {
              const shouldFail = failFlags[idx];
              idx += 1;
              if (shouldFail) {
                throw new Error('网络中断/存储失败');
              }
              return { storageRef: `s3://${id}` };
            },
            remove: async () => undefined,
          };
          const { service, asset } = setup(storage);
          const inputs: AssetUploadInput[] = failFlags.map((_, i) => ({
            merchantId: 'm1',
            type: 'image',
            sizeBytes: 1024,
            clientRef: `c${i}`,
          }));

          const result = await service.uploadBatch(inputs);

          const expectedSuccessRefs = failFlags
            .map((f, i) => (f ? null : `c${i}`))
            .filter((x): x is string => x !== null);
          const expectedFailRefs = failFlags
            .map((f, i) => (f ? `c${i}` : null))
            .filter((x): x is string => x !== null);

          // 成功集合恰为非失败份，且不受失败份影响（需求 11.3）。
          expect(result.succeeded.map((s) => s.clientRef)).toEqual(expectedSuccessRefs);
          // 失败份被隔离（标记 storage 原因），不中断整批。
          expect(result.failed.map((f) => f.clientRef)).toEqual(expectedFailRefs);
          expect(result.failed.every((f) => f.reason === 'storage')).toBe(true);
          // 不保留不完整素材：落库数恰为成功份数。
          expect(asset.store.size).toBe(expectedSuccessRefs.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 22
  // Property 22: 素材约束与不符合项完整反馈
  // Validates: Requirements 11.1, 11.2
  it('Property 22: ≤500MB 且轮播 2-10 接受落库，否则返回全部不符合项且不存储', async () => {
    await fc.assert(
      fc.asyncProperty(anyInputArb, async (input) => {
        const { service, asset } = setup();
        const errors = validateAssetUpload(input);
        const result = await service.upload(input);

        if (errors.length === 0) {
          // 合法：接受、生成唯一标识、落库（需求 11.1）。
          expect(result.uploaded).toBe(true);
          expect(asset.store.size).toBe(1);
        } else {
          // 不合法：拒绝、不存储、返回全部不符合项（需求 11.2）。
          expect(result.uploaded).toBe(false);
          if (!result.uploaded) {
            expect(result.reason).toBe('validation');
            expect(result.errors).toEqual(errors);
          }
          expect(asset.store.size).toBe(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 23
  // Property 23: 被引用素材不可删除
  // Validates: Requirements 11.7
  it('Property 23: 任意正被引用的素材，删除被拒并提示正在被引用；未引用则可删除', async () => {
    await fc.assert(
      fc.asyncProperty(
        validInputArb,
        // 引用该素材的广告数量（0 表示未被引用）。
        fc.array(fc.uuid(), { minLength: 0, maxLength: 5 }),
        async (input, adIds) => {
          const { service, asset, adAsset } = setup();
          const up = await service.upload(input);
          expect(up.uploaded).toBe(true);
          if (!up.uploaded) return;
          const assetId = up.assetId;

          const uniqueAdIds = [...new Set(adIds)];
          for (const adId of uniqueAdIds) {
            await adAsset.repo.save({ adId, assetId } as AdAsset);
          }

          if (uniqueAdIds.length > 0) {
            // 被引用：删除被拒（需求 11.7）。
            await expect(service.deleteAsset(input.merchantId, assetId)).rejects.toBeInstanceOf(
              AssetInUseError,
            );
            // 素材仍保留。
            expect(asset.store.has(assetId)).toBe(true);
          } else {
            // 未被引用：可删除（需求 11.6）。
            await service.deleteAsset(input.merchantId, assetId);
            expect(asset.store.has(assetId)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
