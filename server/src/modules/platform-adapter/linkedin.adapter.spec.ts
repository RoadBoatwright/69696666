import { NotImplementedException } from '@nestjs/common';

import { LinkedInAdapter } from './linkedin.adapter';
import { PlatformAdapterRegistry } from './platform-adapter.registry';
import type {
  AdapterContext,
  AssetRef,
  ConversionConfig,
  LeadFormConfig,
  MetricsQuery,
  PlatformAdapter,
  PlatformId,
  Targeting,
  UnifiedAdPlan,
} from './domain/platform-adapter';

/** 不接触真实凭据/平台 API 的最小上下文桩（本期 LinkedIn 不会真正使用）。 */
const ctxStub = {
  platform: 'linkedin',
  callWithCredential: <T>(_name: string, _fn: (plain: string) => Promise<T>): Promise<T> =>
    Promise.reject(new Error('LinkedIn 本期无凭据配置项')),
} as AdapterContext;

const planStub: UnifiedAdPlan = { planId: 'p1', accountId: 'acc-1', native: {} };
const targetingStub: Targeting = { dimensions: {} };
const assetStub: AssetRef = { assetId: 'a1', type: 'image', source: 's3://x' };
const leadFormStub: LeadFormConfig = { fields: {} };
const conversionStub: ConversionConfig = { events: {} };
const metricsStub: MetricsQuery = { accountId: 'acc-1', since: new Date(0), until: new Date(1) };

/** 仅记录调用、不接触真实平台 API 的最小适配器桩（验证既有映射不受影响）。 */
function makeStubAdapter(platform: PlatformId): PlatformAdapter {
  return {
    platform,
    publishCampaign: () => Promise.resolve({ platformCampaignId: 'c1', nativeIds: {} }),
    applyTargeting: () => Promise.resolve({ nativeTargetingId: 't1', notApplicable: [] }),
    uploadAsset: () => Promise.resolve({ platformAssetId: 'a1' }),
    attachLeadForm: () => Promise.resolve({ platformLeadFormId: 'l1' }),
    submitConversionTracking: () => Promise.resolve({ platformTrackingId: 'p1' }),
    fetchMetrics: () => Promise.resolve({ platform, rows: [] }),
    fetchReviewStatus: () => Promise.resolve([]),
    supportedBiddingStrategies: () => [],
  };
}

describe('LinkedInAdapter（组件 4，第二期扩展位，需求 8.9、34.1、34.3）', () => {
  const adapter = new LinkedInAdapter();

  it('平台标识为 linkedin', () => {
    expect(adapter.platform).toBe('linkedin');
  });

  it('publishCampaign 抛 NotImplementedException（第二期提供）', async () => {
    await expect(adapter.publishCampaign(ctxStub, planStub)).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });

  it('applyTargeting 抛 NotImplementedException（第二期提供）', async () => {
    await expect(adapter.applyTargeting(ctxStub, 'ag1', targetingStub)).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });

  it('uploadAsset 抛 NotImplementedException（第二期提供）', async () => {
    await expect(adapter.uploadAsset(ctxStub, assetStub)).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });

  it('attachLeadForm 抛 NotImplementedException（第二期提供）', async () => {
    await expect(adapter.attachLeadForm(ctxStub, 'ad1', leadFormStub)).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });

  it('submitConversionTracking 抛 NotImplementedException（第二期提供）', async () => {
    await expect(adapter.submitConversionTracking(ctxStub, conversionStub)).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });

  it('fetchMetrics 抛 NotImplementedException（第二期提供）', async () => {
    await expect(adapter.fetchMetrics(ctxStub, metricsStub)).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });

  it('fetchReviewStatus 抛 NotImplementedException（第二期提供）', async () => {
    await expect(adapter.fetchReviewStatus(ctxStub, ['ad1'])).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });

  it('supportedBiddingStrategies 抛 NotImplementedException（第二期提供）', () => {
    expect(() => adapter.supportedBiddingStrategies()).toThrow(NotImplementedException);
  });

  it('新增 LinkedIn 扩展位不改动既有 Meta/Google/TikTok 映射（需求 8.9、34.2）', () => {
    const meta = makeStubAdapter('meta');
    const google = makeStubAdapter('google');
    const tiktok = makeStubAdapter('tiktok');
    const registry = new PlatformAdapterRegistry(
      [meta, google, tiktok, adapter],
      // 注册行为不触达凭据管理器，传 undefined 以隔离依赖。
      undefined as never,
    );

    // 既有平台映射保持不变。
    expect(registry.getAdapter('meta')).toBe(meta);
    expect(registry.getAdapter('google')).toBe(google);
    expect(registry.getAdapter('tiktok')).toBe(tiktok);
    // LinkedIn 扩展位已注册，但其能力调用抛 NotImplementedException。
    expect(registry.getAdapter('linkedin')).toBe(adapter);
  });
});
