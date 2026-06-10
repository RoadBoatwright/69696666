import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';

import type { EncryptionConfig } from '../../config/configuration';
import { CredentialNotConfiguredError } from '../../common/errors/credential.error';
import { CredentialCipherService } from '../credential/credential-cipher.service';
import { CredentialManagerService } from '../credential/credential-manager.service';
import type { PlatformCredential } from '../credential/entities/platform-credential.entity';
import { PlatformAdapterRegistry } from './platform-adapter.registry';
import {
  MetaAdapter,
  normalizeMetaReviewStatus,
  META_REVIEW_STATUS_NORMALIZED,
} from './meta-adapter';

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
  systemUserToken: 'meta-sys-user-token-xyz',
  businessManagerId: 'bm-99',
};

describe('MetaAdapter（组件 4，真实 Meta Marketing API）', () => {
  const adapter = new MetaAdapter();

  it('平台标识为 meta 且实现 PlatformAdapter 全部方法', () => {
    expect(adapter.platform).toBe('meta');
    expect(typeof adapter.publishCampaign).toBe('function');
    expect(typeof adapter.applyTargeting).toBe('function');
    expect(typeof adapter.uploadAsset).toBe('function');
    expect(typeof adapter.attachLeadForm).toBe('function');
    expect(typeof adapter.submitConversionTracking).toBe('function');
    expect(typeof adapter.fetchMetrics).toBe('function');
    expect(typeof adapter.fetchReviewStatus).toBe('function');
    expect(typeof adapter.supportedBiddingStrategies).toBe('function');
  });

  it('暴露 Meta 支持的出价策略集合（需求 26.1）', () => {
    const strategies = adapter.supportedBiddingStrategies();
    expect(strategies).toEqual(
      expect.arrayContaining([
        'MAXIMIZE_CONVERSIONS',
        'MAXIMIZE_CONVERSION_VALUE',
        'TARGET_CPA',
        'TARGET_ROAS',
      ]),
    );
    // Meta 不提供 Google 式手动 CPC 出价方式。
    expect(strategies).not.toContain('MANUAL_CPC');
  });

  it('凭据未配置时优雅降级抛「该平台凭据未配置」（需求 1.5），不以假数据顶替', async () => {
    const manager = makeManager();
    const registry = new PlatformAdapterRegistry([adapter], manager);
    const ctx = registry.createContext('meta');

    await expect(adapter.fetchReviewStatus(ctx, ['ad-1'])).rejects.toBeInstanceOf(
      CredentialNotConfiguredError,
    );
  });

  it('fetchReviewStatus 空 adIds 不触发任何凭据访问，直接返回空集', async () => {
    const manager = makeManager();
    const registry = new PlatformAdapterRegistry([adapter], manager);
    const ctx = registry.createContext('meta');
    await expect(adapter.fetchReviewStatus(ctx, [])).resolves.toEqual([]);
  });

  it('注册后可经注册表工厂查找，并经凭据管理器在内存中解密取 systemUserToken（需求 8.9、6.3）', async () => {
    const manager = makeManager();
    await manager.submitCredential('meta', validMeta);
    const registry = new PlatformAdapterRegistry([adapter], manager);
    expect(registry.getAdapter('meta')).toBe(adapter);

    const ctx = registry.createContext('meta');
    const token = await ctx.callWithCredential('systemUserToken', async (plain) => plain);
    expect(token).toBe(validMeta.systemUserToken);
  });
});

describe('normalizeMetaReviewStatus（审核状态归一化三态，需求 20.1）', () => {
  it('审核进行中/待审/处理中归一化为「审核中」', () => {
    expect(normalizeMetaReviewStatus('PENDING_REVIEW')).toBe(META_REVIEW_STATUS_NORMALIZED.审核中);
    expect(normalizeMetaReviewStatus('IN_PROCESS')).toBe('审核中');
    expect(normalizeMetaReviewStatus('PREAPPROVED')).toBe('审核中');
  });

  it('被拒绝归一化为「审核被拒绝」', () => {
    expect(normalizeMetaReviewStatus('DISAPPROVED')).toBe('审核被拒绝');
    expect(normalizeMetaReviewStatus('WITH_ISSUES_REJECTED')).toBe('审核被拒绝');
  });

  it('已通过/可投放/已暂停归一化为「审核通过」', () => {
    expect(normalizeMetaReviewStatus('ACTIVE')).toBe('审核通过');
    expect(normalizeMetaReviewStatus('PAUSED')).toBe('审核通过');
    expect(normalizeMetaReviewStatus('ADSET_PAUSED')).toBe('审核通过');
  });
});
