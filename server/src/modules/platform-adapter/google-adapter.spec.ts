import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';

import type { EncryptionConfig } from '../../config/configuration';
import { CredentialNotConfiguredError } from '../../common/errors/credential.error';
import { CredentialCipherService } from '../credential/credential-cipher.service';
import { CredentialManagerService } from '../credential/credential-manager.service';
import type { PlatformCredential } from '../credential/entities/platform-credential.entity';
import { PlatformAdapterRegistry } from './platform-adapter.registry';
import {
  GoogleAdapter,
  normalizeGoogleReviewStatus,
  GOOGLE_REVIEW_STATUS_NORMALIZED,
} from './google-adapter';

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

const validGoogle = {
  clientId: 'client-id-1',
  clientSecret: 'client-secret-value-123',
  refreshToken: 'google-refresh-token-xyz',
  developerToken: 'google-dev-token-xyz',
  loginCustomerId: '123-456-7890',
};

describe('GoogleAdapter（组件 4，真实 Google Ads API）', () => {
  const adapter = new GoogleAdapter();

  it('平台标识为 google 且实现 PlatformAdapter 全部方法', () => {
    expect(adapter.platform).toBe('google');
    expect(typeof adapter.publishCampaign).toBe('function');
    expect(typeof adapter.applyTargeting).toBe('function');
    expect(typeof adapter.uploadAsset).toBe('function');
    expect(typeof adapter.attachLeadForm).toBe('function');
    expect(typeof adapter.submitConversionTracking).toBe('function');
    expect(typeof adapter.fetchMetrics).toBe('function');
    expect(typeof adapter.fetchReviewStatus).toBe('function');
    expect(typeof adapter.supportedBiddingStrategies).toBe('function');
  });

  it('暴露 Google 支持的出价策略全集（含手动 CPC，需求 26.1）', () => {
    const strategies = adapter.supportedBiddingStrategies();
    // Google 智能出价能力最丰富，覆盖全集 + 手动 CPC。
    expect(strategies).toEqual(
      expect.arrayContaining([
        'TARGET_CPA',
        'TARGET_ROAS',
        'MAXIMIZE_CONVERSIONS',
        'MAXIMIZE_CONVERSION_VALUE',
        'MAXIMIZE_CLICKS',
        'MANUAL_CPC',
      ]),
    );
  });

  it('凭据未配置时优雅降级抛「该平台凭据未配置」（需求 1.5），不以假数据顶替', async () => {
    const manager = makeManager();
    const registry = new PlatformAdapterRegistry([adapter], manager);
    const ctx = registry.createContext('google');

    await expect(adapter.fetchReviewStatus(ctx, ['ad-1'])).rejects.toBeInstanceOf(
      CredentialNotConfiguredError,
    );
  });

  it('fetchReviewStatus 空 adIds 不触发任何凭据访问，直接返回空集', async () => {
    const manager = makeManager();
    const registry = new PlatformAdapterRegistry([adapter], manager);
    const ctx = registry.createContext('google');
    await expect(adapter.fetchReviewStatus(ctx, [])).resolves.toEqual([]);
  });

  it('注册后可经注册表工厂查找，并经凭据管理器在内存中解密取 refreshToken（需求 8.9、6.3）', async () => {
    const manager = makeManager();
    await manager.submitCredential('google', validGoogle);
    const registry = new PlatformAdapterRegistry([adapter], manager);
    expect(registry.getAdapter('google')).toBe(adapter);

    const ctx = registry.createContext('google');
    const token = await ctx.callWithCredential('refreshToken', async (plain) => plain);
    expect(token).toBe(validGoogle.refreshToken);
  });
});

describe('normalizeGoogleReviewStatus（审核状态归一化三态，需求 20.1）', () => {
  it('审核进行中/申诉中/待审归一化为「审核中」', () => {
    expect(normalizeGoogleReviewStatus('REVIEW_IN_PROGRESS')).toBe(
      GOOGLE_REVIEW_STATUS_NORMALIZED.审核中,
    );
    expect(normalizeGoogleReviewStatus('UNDER_APPEAL')).toBe('审核中');
    expect(normalizeGoogleReviewStatus('PENDING_REVIEW')).toBe('审核中');
  });

  it('被拒绝归一化为「审核被拒绝」', () => {
    expect(normalizeGoogleReviewStatus('DISAPPROVED')).toBe('审核被拒绝');
    expect(normalizeGoogleReviewStatus('REJECTED')).toBe('审核被拒绝');
  });

  it('已通过/受限可投放/已审核归一化为「审核通过」', () => {
    expect(normalizeGoogleReviewStatus('APPROVED')).toBe('审核通过');
    expect(normalizeGoogleReviewStatus('APPROVED_LIMITED')).toBe('审核通过');
    expect(normalizeGoogleReviewStatus('REVIEWED')).toBe('审核通过');
    expect(normalizeGoogleReviewStatus('ELIGIBLE_MAY_SERVE')).toBe('审核通过');
  });
});
