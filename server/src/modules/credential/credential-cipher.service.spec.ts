import { ConfigService } from '@nestjs/config';

import type { EncryptionConfig } from '../../config/configuration';
import { CredentialCipherService } from './credential-cipher.service';

function makeConfigService(encryption: EncryptionConfig): ConfigService {
  return {
    get: (key: string) => (key === 'encryption' ? encryption : undefined),
  } as unknown as ConfigService;
}

describe('CredentialCipherService（需求 1.2、1.8、6.1）', () => {
  describe('本地降级模式（无 KMS，AES-256-GCM）', () => {
    const cipher = new CredentialCipherService(
      makeConfigService({ kmsKeyId: '', localEncryptionKey: 'local-master-key' }),
    );

    it('标记为本地降级模式', () => {
      expect(cipher.localFallback).toBe(true);
    });

    it('加密往返可还原原始明文且密文不含明文（需求 6.1）', () => {
      const values = { appId: '123', appSecret: 'SUPERSECRET' };
      const blob = cipher.encrypt(values);

      expect(Buffer.isBuffer(blob)).toBe(true);
      expect(blob.toString('utf8')).not.toContain('SUPERSECRET');
      expect(cipher.decrypt(blob)).toEqual(values);
    });

    it('相同输入两次加密产生不同密文（随机 IV/DEK）', () => {
      const values = { k: 'v' };
      expect(cipher.encrypt(values).equals(cipher.encrypt(values))).toBe(false);
    });

    it('篡改密文导致解密失败（GCM 认证）', () => {
      const blob = cipher.encrypt({ k: 'v' });
      blob[blob.length - 1] ^= 0xff;
      expect(() => cipher.decrypt(blob)).toThrow();
    });
  });

  describe('KMS 模式（配置 kmsKeyId）', () => {
    const cipher = new CredentialCipherService(
      makeConfigService({ kmsKeyId: 'arn:kms:key/abc', localEncryptionKey: '' }),
    );

    it('非本地降级模式', () => {
      expect(cipher.localFallback).toBe(false);
    });

    it('信封加密往返还原', () => {
      const values = { token: 'abc-123' };
      expect(cipher.decrypt(cipher.encrypt(values))).toEqual(values);
    });
  });

  it('主密钥缺失时构造抛错（需求 1.6、1.8）', () => {
    expect(
      () =>
        new CredentialCipherService(makeConfigService({ kmsKeyId: '', localEncryptionKey: '' })),
    ).toThrow();
  });
});
