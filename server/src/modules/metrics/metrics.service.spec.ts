import type { Repository } from 'typeorm';

import { PlatformAdapterRegistry } from '../platform-adapter';
import type { PlatformAdapter, PlatformId } from '../platform-adapter/domain/platform-adapter';
import { ConversionConfig, ConversionEvent, Metric, ReviewStatus } from './entities';
import { InvalidConversionConfigError, MetricsService } from './metrics.service';

/** 通用内存仓库桩。 */
function makeRepo<T extends object>(
  prefix: string,
): { repo: Repository<T>; store: Map<string, T> } {
  const store = new Map<string, T>();
  let seq = 0;
  const matches = (v: T, where: Partial<T>): boolean =>
    Object.entries(where).every(([k, val]) => (v as Record<string, unknown>)[k] === val);
  const repo = {
    create: (e: Partial<T>) => ({ ...e }) as T,
    save: async (e: T) => {
      const rec = e as Record<string, unknown>;
      if (!rec.id) rec.id = `${prefix}-${++seq}`;
      store.set(rec.id as string, { ...e });
      return store.get(rec.id as string)!;
    },
    findOne: async ({ where }: { where: Partial<T> }) => {
      for (const v of store.values()) {
        if (matches(v, where)) return v;
      }
      return null;
    },
    find: async ({ where }: { where?: Partial<T> } = {}) => {
      const out: T[] = [];
      for (const v of store.values()) {
        if (!where || matches(v, where)) out.push(v);
      }
      return out;
    },
  } as unknown as Repository<T>;
  return { repo, store };
}

function makeAdapter(
  platform: PlatformId,
  overrides: Partial<PlatformAdapter> = {},
): PlatformAdapter {
  return {
    platform,
    publishCampaign: async () => ({ platformCampaignId: 'pc', nativeIds: {} }),
    applyTargeting: async () => ({ nativeTargetingId: 't', notApplicable: [] }),
    uploadAsset: async () => ({ platformAssetId: 'pa' }),
    attachLeadForm: async () => ({ platformLeadFormId: 'lf' }),
    submitConversionTracking:
      overrides.submitConversionTracking ?? (async () => ({ platformTrackingId: 'cv' })),
    fetchMetrics: overrides.fetchMetrics ?? (async () => ({ platform, rows: [] })),
    fetchReviewStatus: overrides.fetchReviewStatus ?? (async () => []),
    supportedBiddingStrategies: () => [],
  } as PlatformAdapter;
}

function setup(adaptersByPlatform: Partial<Record<PlatformId, PlatformAdapter>>) {
  const metric = makeRepo<Metric>('m');
  const config = makeRepo<ConversionConfig>('cc');
  const event = makeRepo<ConversionEvent>('ce');
  const review = makeRepo<ReviewStatus>('rs');
  const registry = {
    getAdapter: (platform: PlatformId) => {
      const adapter = adaptersByPlatform[platform];
      if (!adapter) throw new Error(`平台「${platform}」适配器尚未提供`);
      return adapter;
    },
    createContext: (platform: PlatformId) => ({
      platform,
      callWithCredential: async <T>(_n: string, fn: (p: string) => Promise<T>) => fn('tok'),
    }),
  } as unknown as PlatformAdapterRegistry;
  const service = new MetricsService(metric.repo, config.repo, event.repo, review.repo, registry);
  return { service, metric, config, event, review };
}

const range = { since: new Date('2026-01-01T00:00:00Z'), until: new Date('2026-01-02T00:00:00Z') };

describe('MetricsService', () => {
  it('拉取并归一化指标入库，花费为零 ROI 标 not_computable（需求 18.1-18.3）', async () => {
    const { service, metric } = setup({
      meta: makeAdapter('meta', {
        fetchMetrics: async () => ({
          platform: 'meta',
          rows: [
            {
              ad_id: 'ad-1',
              impressions: 100,
              clicks: 10,
              conversions: 2,
              spend: 50,
              conversion_value: 100,
            },
            {
              ad_id: 'ad-2',
              impressions: '20',
              clicks: '1',
              conversions: 0,
              spend: 0,
              conversion_value: 0,
            },
          ],
        }),
      }),
    });
    const summary = await service.pullMetrics(
      [{ platform: 'meta', accountId: 'a1' }],
      range.since,
      range.until,
    );
    expect(summary.succeeded).toEqual(['meta']);
    expect(summary.savedRows).toBe(2);
    const rows = [...metric.store.values()];
    const withSpend = rows.find((r) => r.adId === 'ad-1')!;
    expect(withSpend.roi).toBe(String((100 - 50) / 50));
    const zeroSpend = rows.find((r) => r.adId === 'ad-2')!;
    expect(zeroSpend.roi).toBe('not_computable');
  });

  it('单平台失败隔离：失败平台记录原因、其余平台继续（需求 18.7）', async () => {
    const { service, metric } = setup({
      meta: makeAdapter('meta', {
        fetchMetrics: async () => {
          throw new Error('Meta API 调用失败');
        },
      }),
      google: makeAdapter('google', {
        fetchMetrics: async () => ({
          platform: 'google',
          rows: [
            {
              ad_id: 'g-1',
              impressions: 5,
              clicks: 1,
              conversions: 1,
              spend: 10,
              conversion_value: 30,
            },
          ],
        }),
      }),
    });
    const summary = await service.pullMetrics(
      [
        { platform: 'meta', accountId: 'a1' },
        { platform: 'google', accountId: 'a2' },
      ],
      range.since,
      range.until,
    );
    expect(summary.failed).toEqual([{ platform: 'meta', reason: 'Meta API 调用失败' }]);
    expect(summary.succeeded).toEqual(['google']);
    expect([...metric.store.values()]).toHaveLength(1);
  });

  it('转化追踪配置提交成功置「已生效」、失败置「提交失败」（需求 19.2-19.4）', async () => {
    const ok = setup({ meta: makeAdapter('meta') });
    const effective = await ok.service.configureConversionTracking({
      campaignId: 'c-1',
      platform: 'meta',
      mechanism: 'Pixel',
      eventDefs: [{ name: 'Lead' }],
    });
    expect(effective.status).toBe('已生效');

    const bad = setup({
      meta: makeAdapter('meta', {
        submitConversionTracking: async () => {
          throw new Error('平台拒绝');
        },
      }),
    });
    const failed = await bad.service.configureConversionTracking({
      campaignId: 'c-1',
      platform: 'meta',
      mechanism: 'EventsAPI',
    });
    expect(failed.status).toBe('提交失败');
  });

  it('事件定义超过 50 条抛配置非法（需求 19.1）', async () => {
    const { service } = setup({ meta: makeAdapter('meta') });
    await expect(
      service.configureConversionTracking({
        campaignId: 'c-1',
        platform: 'meta',
        mechanism: 'Event',
        eventDefs: Array.from({ length: 51 }, (_, i) => ({ name: `e${i}` })),
      }),
    ).rejects.toBeInstanceOf(InvalidConversionConfigError);
  });

  it('转化事件能关联广告标 matched、无法匹配保留原始数据标 unmatched（需求 19.5、19.6）', async () => {
    const { service } = setup({});
    const matched = await service.ingestConversionEvent({
      platformEventId: 'e-1',
      adId: 'ad-1',
      raw: { value: 1 },
    });
    expect(matched.matchStatus).toBe('matched');
    expect(matched.adId).toBe('ad-1');

    const unmatched = await service.ingestConversionEvent({
      platformEventId: 'e-2',
      raw: { value: 2 },
    });
    expect(unmatched.matchStatus).toBe('unmatched');
    expect(unmatched.adId).toBeNull();
    expect(unmatched.rawData).toEqual({ value: 2 });
  });

  it('审核状态归一化三态并在变更时产生通知记录（需求 20.1-20.4）', async () => {
    const { service } = setup({
      meta: makeAdapter('meta', {
        fetchReviewStatus: async () => [
          { adId: 'ad-1', rawStatus: 'PENDING' },
          { adId: 'ad-2', rawStatus: 'APPROVED' },
          { adId: 'ad-3', rawStatus: 'DISAPPROVED' },
        ],
      }),
    });
    const first = await service.syncReviewStatuses('meta', ['ad-1', 'ad-2', 'ad-3']);
    expect(first.changes.map((c) => c.after)).toEqual(['审核中', '审核通过', '审核被拒绝']);

    // 再次同步无变化 → 不产生通知。
    const second = await service.syncReviewStatuses('meta', ['ad-1', 'ad-2', 'ad-3']);
    expect(second.changes).toHaveLength(0);
  });

  it('审核状态拉取失败保留上次状态（需求 20.5）', async () => {
    let fail = false;
    const { service, review } = setup({
      meta: makeAdapter('meta', {
        fetchReviewStatus: async () => {
          if (fail) throw new Error('平台不可用');
          return [{ adId: 'ad-1', rawStatus: 'APPROVED' }];
        },
      }),
    });
    await service.syncReviewStatuses('meta', ['ad-1']);
    fail = true;
    const result = await service.syncReviewStatuses('meta', ['ad-1']);
    expect(result.failureReason).toBe('平台不可用');
    const kept = [...review.store.values()].find((r) => r.adId === 'ad-1')!;
    expect(kept.status).toBe('审核通过');
  });
});
