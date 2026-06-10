import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';

import type { EncryptionConfig } from '../../config/configuration';
import { CredentialNotConfiguredError } from '../../common/errors/credential.error';
import { CredentialCipherService } from '../credential/credential-cipher.service';
import { CredentialManagerService } from '../credential/credential-manager.service';
import type { PlatformCredential } from '../credential/entities/platform-credential.entity';
import { PlatformAdapterRegistry } from './platform-adapter.registry';
import {
  TikTokAdapter,
  normalizeTikTokReviewStatus,
  TIKTOK_REVIEW_STATUS_NORMALIZED,
} from './tiktok-adapter';

/** 内存版 PlatformCredential 仓储桩。 */
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

const validTikTok = {
  appId: 'app-1',
  appSecret: 'secret-value-123',
  accessToken: 'tt-access-token-xyz',
  refreshToken: 'tt-refresh-token-xyz',
  businessCenterId: 'bc-99',
};

describe('TikTokAdapter（组件 4，真实 TikTok Marketing API）', () => {
  const adapter = new TikTokAdapter();

  it('平台标识为 tiktok 且实现 PlatformAdapter 全部方法', () => {
    expect(adapter.platform).toBe('tiktok');
    expect(typeof adapter.publishCampaign).toBe('function');
    expect(typeof adapter.applyTargeting).toBe('function');
    expect(typeof adapter.uploadAsset).toBe('function');
    expect(typeof adapter.attachLeadForm).toBe('function');
    expect(typeof adapter.submitConversionTracking).toBe('function');
    expect(typeof adapter.fetchMetrics).toBe('function');
    expect(typeof adapter.fetchReviewStatus).toBe('function');
  });

  it('暴露 TikTok 支持的出价策略集合（需求 26.1）', () => {
    const strategies = adapter.supportedBiddingStrategies();
    expect(strategies).toEqual(
      expect.arrayContaining(['MAXIMIZE_CONVERSIONS', 'TARGET_CPA', 'TARGET_ROAS']),
    );
    // TikTok 不提供手动 CPC 出价。
    expect(strategies).not.toContain('MANUAL_CPC');
  });

  it('凭据未配置时优雅降级抛「该平台凭据未配置」（需求 1.5），不以假数据顶替', async () => {
    const manager = makeManager();
    const registry = new PlatformAdapterRegistry([adapter], manager);
    const ctx = registry.createContext('tiktok');

    await expect(adapter.fetchReviewStatus(ctx, ['ad-1'])).rejects.toBeInstanceOf(
      CredentialNotConfiguredError,
    );
  });

  it('fetchReviewStatus 空 adIds 不触发任何凭据访问，直接返回空集', async () => {
    const manager = makeManager();
    const registry = new PlatformAdapterRegistry([adapter], manager);
    const ctx = registry.createContext('tiktok');
    await expect(adapter.fetchReviewStatus(ctx, [])).resolves.toEqual([]);
  });

  it('注册后可经注册表工厂查找（需求 8.9）', async () => {
    const manager = makeManager();
    await manager.submitCredential('tiktok', validTikTok);
    const registry = new PlatformAdapterRegistry([adapter], manager);
    expect(registry.getAdapter('tiktok')).toBe(adapter);
    // 经凭据管理器在内存中解密取 accessToken（需求 6.3）。
    const ctx = registry.createContext('tiktok');
    const token = await ctx.callWithCredential('accessToken', async (plain) => plain);
    expect(token).toBe(validTikTok.accessToken);
  });
});

describe('normalizeTikTokReviewStatus（审核状态归一化三态，需求 20.1）', () => {
  it('审核进行中归一化为「审核中」', () => {
    expect(normalizeTikTokReviewStatus('AD_STATUS_AUDIT')).toBe(
      TIKTOK_REVIEW_STATUS_NORMALIZED.审核中,
    );
    expect(normalizeTikTokReviewStatus('REVIEW_IN_PROGRESS')).toBe('审核中');
    expect(normalizeTikTokReviewStatus('PENDING')).toBe('审核中');
  });

  it('被拒绝归一化为「审核被拒绝」', () => {
    expect(normalizeTikTokReviewStatus('AD_STATUS_AUDIT_DENY')).toBe('审核被拒绝');
    expect(normalizeTikTokReviewStatus('REJECTED')).toBe('审核被拒绝');
  });

  it('可投放/投放中归一化为「审核通过」', () => {
    expect(normalizeTikTokReviewStatus('AD_STATUS_DELIVERY_OK')).toBe('审核通过');
    expect(normalizeTikTokReviewStatus('ENABLE')).toBe('审核通过');
  });
});
