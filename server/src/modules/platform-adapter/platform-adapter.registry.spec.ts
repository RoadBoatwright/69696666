import { ConfigService } from '@nestjs/config';
import { NotImplementedException } from '@nestjs/common';
import type { Repository } from 'typeorm';

import type { EncryptionConfig } from '../../config/configuration';
import { CredentialNotConfiguredError } from '../../common/errors/credential.error';
import { CredentialCipherService } from '../credential/credential-cipher.service';
import { CredentialManagerService } from '../credential/credential-manager.service';
import type { PlatformCredential } from '../credential/entities/platform-credential.entity';
import { PlatformAdapterRegistry } from './platform-adapter.registry';
import type {
  AdapterContext,
  AssetRef,
  AssetUploadResult,
  ConversionConfig,
  ConversionResult,
  LeadFormConfig,
  LeadFormResult,
  MetricsQuery,
  NativeMetrics,
  NativeReviewStatus,
  PlatformAdapter,
  PlatformId,
  PublishResult,
  Targeting,
  TargetingResult,
  UnifiedAdPlan,
} from './domain/platform-adapter';
import { BIDDING_STRATEGIES } from '../unified-model/domain/unified-model';

/** 内存版 PlatformCredential 仓储桩（不依赖真实数据库）。 */
function makeInMemoryRepository(): Repository<PlatformCredential> {
  const store = new Map<string, PlatformCredential>();
  return {
    findOne: async ({ where }: { where: { platform: string } }) =>
      store.get(where.platform) ?? null,
    save: async (entity: PlatformCredential) => {
      store.set(entity.platform, { ...entity, updatedAt: new Date() });
      return store.get(entity.platform)!;
    },
  } as unknown as Repository<PlatformCredential>;
}

function makeCipher(): CredentialCipherService {
  const configService = {
    get: (key: string): EncryptionConfig | undefined =>
      key === 'encryption' ? { kmsKeyId: '', localEncryptionKey: 'test-master-key' } : undefined,
  } as unknown as ConfigService;
  return new CredentialCipherService(configService);
}

function makeManager(): CredentialManagerService {
  return new CredentialManagerService(makeInMemoryRepository(), makeCipher());
}

const validMeta = {
  appId: 'app-1',
  appSecret: 'secret-value-123',
  systemUserToken: 'token-abcdef',
  businessManagerId: 'bm-99',
};

/** 仅记录调用、不接触真实平台 API 的最小适配器桩（验证注册/工厂行为）。 */
function makeStubAdapter(platform: PlatformId): PlatformAdapter {
  return {
    platform,
    publishCampaign: (_ctx: AdapterContext, _plan: UnifiedAdPlan): Promise<PublishResult> =>
      Promise.resolve({ platformCampaignId: 'c1', nativeIds: {} }),
    applyTargeting: (
      _ctx: AdapterContext,
      _adGroupId: string,
      _t: Targeting,
    ): Promise<TargetingResult> => Promise.resolve({ nativeTargetingId: 't1', notApplicable: [] }),
    uploadAsset: (_ctx: AdapterContext, _asset: AssetRef): Promise<AssetUploadResult> =>
      Promise.resolve({ platformAssetId: 'a1' }),
    attachLeadForm: (
      _ctx: AdapterContext,
      _adId: string,
      _form: LeadFormConfig,
    ): Promise<LeadFormResult> => Promise.resolve({ platformLeadFormId: 'l1' }),
    submitConversionTracking: (
      _ctx: AdapterContext,
      _cfg: ConversionConfig,
    ): Promise<ConversionResult> => Promise.resolve({ platformTrackingId: 'p1' }),
    fetchMetrics: (_ctx: AdapterContext, _q: MetricsQuery): Promise<NativeMetrics> =>
      Promise.resolve({ platform, rows: [] }),
    fetchReviewStatus: (_ctx: AdapterContext, _adIds: string[]): Promise<NativeReviewStatus[]> =>
      Promise.resolve([]),
    supportedBiddingStrategies: () => [...BIDDING_STRATEGIES],
  };
}

describe('PlatformAdapterRegistry（组件 4，需求 8.9、6.3）', () => {
  it('按平台标识注册并工厂查找已注册适配器（需求 8.9）', () => {
    const meta = makeStubAdapter('meta');
    const google = makeStubAdapter('google');
    const registry = new PlatformAdapterRegistry([meta, google], makeManager());

    expect(registry.getAdapter('meta')).toBe(meta);
    expect(registry.getAdapter('google')).toBe(google);
    expect(registry.has('tiktok')).toBe(false);
    expect(new Set(registry.registeredPlatforms())).toEqual(new Set(['meta', 'google']));
  });

  it('未注册平台（如 LinkedIn 扩展位未接入）查找抛 NotImplementedException（需求 8.9、34.3）', () => {
    const registry = new PlatformAdapterRegistry([makeStubAdapter('meta')], makeManager());
    expect(() => registry.getAdapter('linkedin')).toThrow(NotImplementedException);
  });

  it('新增 LinkedIn 适配器不改动既有平台映射（需求 8.9）', () => {
    const meta = makeStubAdapter('meta');
    const linkedin = makeStubAdapter('linkedin');
    const registry = new PlatformAdapterRegistry([meta], makeManager());
    registry.register(linkedin);

    // 既有 meta 映射保持不变。
    expect(registry.getAdapter('meta')).toBe(meta);
    expect(registry.getAdapter('linkedin')).toBe(linkedin);
  });

  it('同一平台重复注册被拒绝（避免静默覆盖既有映射）', () => {
    const registry = new PlatformAdapterRegistry([makeStubAdapter('meta')], makeManager());
    expect(() => registry.register(makeStubAdapter('meta'))).toThrow();
  });

  it('未注入任何适配器时注册表为空且查找抛 NotImplementedException', () => {
    const registry = new PlatformAdapterRegistry(undefined, makeManager());
    expect(registry.registeredPlatforms()).toEqual([]);
    expect(() => registry.getAdapter('meta')).toThrow(NotImplementedException);
  });
});

describe('AdapterContext.callWithCredential（需求 6.3、6.4）', () => {
  it('经凭据管理器在内存中解密取令牌并用于回调', async () => {
    const manager = makeManager();
    await manager.submitCredential('meta', validMeta);
    const registry = new PlatformAdapterRegistry([makeStubAdapter('meta')], manager);
    const ctx = registry.createContext('meta');

    const token = await ctx.callWithCredential('systemUserToken', async (plain) => plain);
    expect(token).toBe(validMeta.systemUserToken);
  });

  it('平台凭据未配置时抛「该平台凭据未配置」（需求 1.5）', async () => {
    const manager = makeManager();
    const registry = new PlatformAdapterRegistry([makeStubAdapter('tiktok')], manager);
    const ctx = registry.createContext('tiktok');

    await expect(
      ctx.callWithCredential('accessToken', async (plain) => plain),
    ).rejects.toBeInstanceOf(CredentialNotConfiguredError);
  });

  it('上下文绑定的平台标识与请求一致', () => {
    const manager = makeManager();
    const registry = new PlatformAdapterRegistry([makeStubAdapter('google')], manager);
    expect(registry.createContext('google').platform).toBe('google');
  });
});
