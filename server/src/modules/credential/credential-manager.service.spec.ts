import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';

import type { EncryptionConfig } from '../../config/configuration';
import { isCredentialSubmitFailure } from '../../common/domain/credential';
import { CredentialNotConfiguredError } from '../../common/errors/credential.error';
import { CredentialCipherService } from './credential-cipher.service';
import { CredentialManagerService } from './credential-manager.service';
import type { PlatformCredential } from './entities/platform-credential.entity';

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

describe('CredentialManagerService（需求 1、6、15.1）', () => {
  it('合法凭据提交后状态置 filled（需求 1.2）', async () => {
    const manager = makeManager();
    const result = await manager.submitCredential('meta', validMeta);
    expect(isCredentialSubmitFailure(result)).toBe(false);
    expect(await manager.getConfigStatus('meta')).toBe('filled');
  });

  it('非法/空凭据被拒、返回不符合项且状态不变（需求 1.7）', async () => {
    const manager = makeManager();
    const result = await manager.submitCredential('meta', { appId: '' });
    expect(isCredentialSubmitFailure(result)).toBe(true);
    if (isCredentialSubmitFailure(result)) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.status).toBe('unfilled');
    }
    expect(await manager.getConfigStatus('meta')).toBe('unfilled');
  });

  it('未配置平台标记为不可用（需求 1.4）', async () => {
    const manager = makeManager();
    await manager.submitCredential('meta', validMeta);
    const unavailable = await manager.getUnavailablePlatforms();
    expect(unavailable).not.toContain('meta');
    expect(unavailable).toEqual(expect.arrayContaining(['google', 'tiktok']));
  });

  it('使用未配置平台抛出「该平台凭据未配置」（需求 1.5）', async () => {
    const manager = makeManager();
    await expect(manager.assertPlatformAvailable('google')).rejects.toBeInstanceOf(
      CredentialNotConfiguredError,
    );
  });

  it('useDecrypted 在回调内提供明文，结束后清理（需求 6.3、6.4）', async () => {
    const manager = makeManager();
    await manager.submitCredential('meta', validMeta);

    const captured = await manager.useDecrypted('meta', 'appSecret', async (plain) => {
      expect(plain).toBe('secret-value-123');
      return plain.length;
    });
    expect(captured).toBe('secret-value-123'.length);
  });

  it('useDecrypted 对未配置平台抛错（需求 1.5）', async () => {
    const manager = makeManager();
    await expect(manager.useDecrypted('tiktok', 'appId', async () => 1)).rejects.toBeInstanceOf(
      CredentialNotConfiguredError,
    );
  });

  it('redact 对已存储凭据明文脱敏（需求 1.3、6.5）', async () => {
    const manager = makeManager();
    await manager.submitCredential('meta', validMeta);
    const out = manager.redact('日志：systemUserToken=token-abcdef 已使用');
    expect(out).not.toContain('token-abcdef');
  });

  it('Gemini 作为独立凭据配置项可提交并置 filled（需求 1.1、15.1）', async () => {
    const manager = makeManager();
    const result = await manager.submitCredential('gemini', { apiKey: 'gemini-key-xyz789' });
    expect(isCredentialSubmitFailure(result)).toBe(false);
    expect(await manager.getConfigStatus('gemini')).toBe('filled');
    expect(await manager.isGeminiAvailable()).toBe(true);
  });

  it('Gemini 凭据缺失时 isGeminiAvailable 为 false 且不计入平台不可用集合（需求 9.7、15.3）', async () => {
    const manager = makeManager();
    expect(await manager.isGeminiAvailable()).toBe(false);
    const unavailable = await manager.getUnavailablePlatforms();
    // 平台可用性隔离仅作用于广告平台，不含 gemini。
    expect(unavailable).not.toContain('gemini' as never);
    expect(unavailable).toEqual(expect.arrayContaining(['meta', 'google', 'tiktok']));
  });

  it('useDecrypted 可解密 Gemini API Key（需求 6.3、6.4、15.1）', async () => {
    const manager = makeManager();
    await manager.submitCredential('gemini', { apiKey: 'gemini-key-xyz789' });
    const len = await manager.useDecrypted('gemini', 'apiKey', async (plain) => {
      expect(plain).toBe('gemini-key-xyz789');
      return plain.length;
    });
    expect(len).toBe('gemini-key-xyz789'.length);
  });
});
