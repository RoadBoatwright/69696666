/**
 * 凭据管理器正确性属性测试（组件 1，需求 1、6）。
 *
 * 覆盖设计文档 Property 1-5。统一使用 fast-check，最少 100 次迭代（propertyConfig）。
 */
import fc from 'fast-check';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';

import { propertyConfig } from './fc-config';
import type { EncryptionConfig } from '../../src/config/configuration';
import type {
  CredentialDescriptor,
  CredentialConfigStatus,
  CredentialPlatformId,
} from '../../src/common/domain/credential';
import {
  computeConfigStatus,
  computeUnavailablePlatforms,
  maskSecret,
  redact,
} from '../../src/common/pure/credential.pure';
import { isCredentialSubmitFailure } from '../../src/common/domain/credential';
import { CredentialCipherService } from '../../src/modules/credential/credential-cipher.service';
import { CredentialManagerService } from '../../src/modules/credential/credential-manager.service';
import type { PlatformCredential } from '../../src/modules/credential/entities/platform-credential.entity';

const descriptor: CredentialDescriptor = {
  key: 'meta',
  requiredKeys: ['appId', 'appSecret', 'systemUserToken'],
};

/** 合法凭据值：非空且不含控制字符。 */
const validValue = fc
  .string({ minLength: 1, maxLength: 24 })
  .map((s) => s.replace(/[\u0000-\u001f\u007f]/g, 'x'))
  .filter((s) => s.trim().length > 0);

/** 部分提交：随机选择 requiredKeys 的子集并赋合法值。 */
function submittedValuesArb() {
  return fc.subarray([...descriptor.requiredKeys], { minLength: 0 }).chain((keys) =>
    fc.tuple(...keys.map(() => validValue)).map((vals) => {
      const record: Record<string, string> = {};
      keys.forEach((k, i) => {
        record[k] = vals[i];
      });
      return record;
    }),
  );
}

function makeManager(): CredentialManagerService {
  const store = new Map<string, PlatformCredential>();
  const repository = {
    findOne: async ({ where }: { where: { platform: string } }) =>
      store.get(where.platform) ?? null,
    save: async (entity: PlatformCredential) => {
      store.set(entity.platform, { ...entity, updatedAt: new Date() });
      return store.get(entity.platform)!;
    },
  } as unknown as Repository<PlatformCredential>;
  const configService = {
    get: (key: string): EncryptionConfig | undefined =>
      key === 'encryption' ? { kmsKeyId: '', localEncryptionKey: 'prop-master-key' } : undefined,
  } as unknown as ConfigService;
  return new CredentialManagerService(repository, new CredentialCipherService(configService));
}

describe('凭据管理器属性测试', () => {
  // Feature: multi-platform-ad-integration, Property 1: 凭据配置状态等价不变量
  // **Validates: Requirements 1.1, 1.2**
  it('Property 1: 状态为 filled 当且仅当全部必填项均提交且通过校验', () => {
    fc.assert(
      fc.property(submittedValuesArb(), (values) => {
        const allPresentAndValid = descriptor.requiredKeys.every(
          (k) => Object.prototype.hasOwnProperty.call(values, k) && values[k].trim().length > 0,
        );
        const status = computeConfigStatus(descriptor, values);
        expect(status).toBe(allPresentAndValid ? 'filled' : 'unfilled');
      }),
      propertyConfig,
    );
  });

  // Feature: multi-platform-ad-integration, Property 2: 非法凭据被拒且状态不变
  // **Validates: Requirements 1.7**
  it('Property 2: 空/不合法凭据提交被拒、返回不符合项且状态保持不变', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 至少缺失或置空一个必填项 -> 必非法
        fc
          .record({
            appId: fc.oneof(fc.constant(''), fc.constant('   ')),
            appSecret: fc.option(validValue, { nil: undefined }),
            systemUserToken: fc.option(validValue, { nil: undefined }),
          })
          .map((r) => {
            const out: Record<string, string> = {};
            if (r.appSecret !== undefined) out.appSecret = r.appSecret;
            if (r.systemUserToken !== undefined) out.systemUserToken = r.systemUserToken;
            out.appId = r.appId;
            return out;
          }),
        async (illegal) => {
          const manager = makeManager();
          const before = await manager.getConfigStatus('meta');
          const result = await manager.submitCredential('meta', illegal);
          expect(isCredentialSubmitFailure(result)).toBe(true);
          if (isCredentialSubmitFailure(result)) {
            expect(result.errors.length).toBeGreaterThan(0);
          }
          const after = await manager.getConfigStatus('meta');
          expect(after).toBe(before);
        },
      ),
      propertyConfig,
    );
  });

  // Feature: multi-platform-ad-integration, Property 3: 凭据脱敏不可逆出明文
  // **Validates: Requirements 1.3, 6.2, 6.5**
  it('Property 3: 脱敏后输出不含完整明文且暴露不超过末 4 位', () => {
    // 凭据明文取字母数字，周围文本取与之不相交的字符集，避免「掩码尾部 + 相邻同字符」
    // 偶然重组出明文子串的测试假象（这并非真实泄露）。
    const secretArb = fc.stringMatching(/^[A-Za-z0-9]{1,24}$/);
    const surroundingArb = fc.stringMatching(/^[ .:=_/#@-]{0,16}$/);
    fc.assert(
      fc.property(secretArb, surroundingArb, surroundingArb, (secret, prefix, suffix) => {
        const text = `${prefix}${secret}${suffix}`;
        const redacted = redact(text, [secret]);
        const masked = maskSecret(secret);
        const exposed = secret.length <= 4 ? 0 : 4;
        // 掩码后可见（非占位符）字符数不超过末 4 位（需求 6.2）。
        const visibleCount = masked.length - (masked.match(/\*/g)?.length ?? 0);
        expect(visibleCount).toBeLessThanOrEqual(exposed);
        // 周围文本与明文字符集不相交，故脱敏后输出不含任何完整明文（需求 1.3、6.5）。
        if (secret.length > 4) {
          expect(redacted.includes(secret)).toBe(false);
        }
      }),
      propertyConfig,
    );
  });

  // Feature: multi-platform-ad-integration, Property 4: 凭据存储加密往返
  // **Validates: Requirements 6.1**
  it('Property 4: 持久化值不等于明文且授权解密可还原原始明文', async () => {
    // 使用长度 ≥ 6 的合法值：单字符值会偶然命中随机密文字节，属测试噪声而非实现缺陷。
    const longValue = fc
      .string({ minLength: 6, maxLength: 24 })
      .map((s) => s.replace(/[\u0000-\u001f\u007f]/g, 'x'))
      .filter((s) => s.trim().length >= 6);
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          appId: longValue,
          appSecret: longValue,
          systemUserToken: longValue,
          businessManagerId: longValue,
        }),
        async (creds) => {
          const store = new Map<string, PlatformCredential>();
          const repository = {
            findOne: async ({ where }: { where: { platform: string } }) =>
              store.get(where.platform) ?? null,
            save: async (entity: PlatformCredential) => {
              store.set(entity.platform, { ...entity, updatedAt: new Date() });
              return store.get(entity.platform)!;
            },
          } as unknown as Repository<PlatformCredential>;
          const configService = {
            get: (key: string): EncryptionConfig | undefined =>
              key === 'encryption'
                ? { kmsKeyId: '', localEncryptionKey: 'prop-master-key' }
                : undefined,
          } as unknown as ConfigService;
          const cipher = new CredentialCipherService(configService);
          const manager = new CredentialManagerService(repository, cipher);

          const result = await manager.submitCredential('meta', creds);
          expect(isCredentialSubmitFailure(result)).toBe(false);

          const stored = store.get('meta')!;
          const blob = stored.encryptedValues!;
          // 持久化值不含明文（需求 6.1）。
          for (const v of Object.values(creds)) {
            expect(blob.toString('utf8')).not.toContain(v);
          }
          // 授权解密可还原（经 useDecrypted）。
          const back = await manager.useDecrypted('meta', 'appSecret', async (p) => p);
          expect(back).toBe(creds.appSecret);
        },
      ),
      propertyConfig,
    );
  });

  // Feature: multi-platform-ad-integration, Property 5: 平台功能可用性隔离
  // **Validates: Requirements 1.4**
  it('Property 5: 不可用平台集合恰好等于未填入平台集合', () => {
    const statusArb = fc.constantFrom<CredentialConfigStatus>('filled', 'unfilled');
    fc.assert(
      fc.property(
        fc.record({ meta: statusArb, google: statusArb, tiktok: statusArb }),
        (statuses) => {
          const unavailable = computeUnavailablePlatforms(statuses);
          const expected = (Object.keys(statuses) as CredentialPlatformId[]).filter(
            (p) => statuses[p] === 'unfilled',
          );
          expect(new Set(unavailable)).toEqual(new Set(expected));
          // 其余平台均为 filled。
          for (const p of Object.keys(statuses) as CredentialPlatformId[]) {
            if (!unavailable.includes(p)) {
              expect(statuses[p]).toBe('filled');
            }
          }
        },
      ),
      propertyConfig,
    );
  });
});
