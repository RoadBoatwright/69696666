import fc from 'fast-check';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';

import type { EncryptionConfig } from '../../config/configuration';
import { CredentialCipherService } from '../credential/credential-cipher.service';
import { AuthCenterService } from './auth-center.service';
import { AccountAuthorization } from './entities/account-authorization.entity';
import { TokenRecord } from './entities/token-record.entity';
import { DAY_MS, MAX_CONSECUTIVE_REFRESH_FAILURES } from './pure/token-status.pure';
import type { AuthNotifier, PlatformAuthClient } from './ports';
import type { IssuedToken, RefreshedToken } from './domain/auth';

/**
 * 账户授权中心服务级属性测试（组件 2，需求 2-5）。
 *
 * 覆盖 Property 7（即将过期区间映射与预警幂等）、Property 9（连续刷新失败阈值停止）。
 * 外部平台 API 全部经 mock 端口注入。最少 100 次迭代。
 */

const NOW = new Date('2025-01-01T00:00:00Z');

/** 内存版仓储桩。 */
function makeRepos(): {
  accountRepo: Repository<AccountAuthorization>;
  tokenRepo: Repository<TokenRecord>;
  tokens: Map<string, TokenRecord>;
} {
  const accounts = new Map<string, AccountAuthorization>();
  const tokens = new Map<string, TokenRecord>();
  let accSeq = 0;
  let tokSeq = 0;

  const accountRepo = {
    create: (e: Partial<AccountAuthorization>) => ({ ...e }) as AccountAuthorization,
    save: async (e: AccountAuthorization) => {
      if (!e.id) {
        e.id = `acc-${++accSeq}`;
      }
      accounts.set(e.id, { ...e });
      return accounts.get(e.id)!;
    },
    findOne: async ({ where }: { where: { id: string } }) => accounts.get(where.id) ?? null,
  } as unknown as Repository<AccountAuthorization>;

  const tokenRepo = {
    create: (e: Partial<TokenRecord>) => ({ ...e }) as TokenRecord,
    save: async (e: TokenRecord) => {
      if (!e.id) {
        e.id = `tok-${++tokSeq}`;
      }
      tokens.set(e.id, { ...e });
      return tokens.get(e.id)!;
    },
    findOne: async ({
      where,
      relations,
    }: {
      where: { id?: string; accountId?: string };
      relations?: { account?: boolean };
    }) => {
      let found: TokenRecord | undefined;
      for (const t of tokens.values()) {
        if (where.id && t.id === where.id) found = t;
        if (where.accountId && t.accountId === where.accountId) found = t;
      }
      if (!found) return null;
      const copy = { ...found };
      if (relations?.account) {
        copy.account = accounts.get(found.accountId)!;
      }
      return copy;
    },
    find: async ({ relations }: { relations?: { account?: boolean } } = {}) =>
      [...tokens.values()].map((t) => {
        const copy = { ...t };
        if (relations?.account) {
          copy.account = accounts.get(t.accountId)!;
        }
        return copy;
      }),
  } as unknown as Repository<TokenRecord>;

  return { accountRepo, tokenRepo, tokens };
}

function makeCipher(): CredentialCipherService {
  const configService = {
    get: (key: string): EncryptionConfig | undefined =>
      key === 'encryption' ? { kmsKeyId: '', localEncryptionKey: 'auth-master-key' } : undefined,
  } as unknown as ConfigService;
  return new CredentialCipherService(configService);
}

function setup(
  clientOverrides: Partial<PlatformAuthClient>,
  notifier: AuthNotifier,
): { service: AuthCenterService; tokens: Map<string, TokenRecord> } {
  const { accountRepo, tokenRepo, tokens } = makeRepos();
  const client: PlatformAuthClient = {
    authorizeMeta: jest.fn(),
    authorizeGoogle: jest.fn(),
    authorizeTikTok: jest.fn(),
    refreshToken: jest.fn(),
    detectRevocation: jest.fn(),
    ...clientOverrides,
  };
  const service = new AuthCenterService(accountRepo, tokenRepo, makeCipher(), client, notifier);
  return { service, tokens };
}

describe('账户授权中心服务级属性测试（fast-check）', () => {
  // Feature: multi-platform-ad-integration, Property 7
  // Property 7: 即将过期区间映射与预警幂等
  // Validates: Requirements 5.2
  it('Property 7: 剩余 0-7 天令牌经多次扫描，状态为「即将过期」且预警仅发送一次', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 剩余有效期落在 (0, 7] 天，含 7 不含 0。
        fc.integer({ min: 1, max: 7 * DAY_MS }),
        fc.integer({ min: 1, max: 5 }),
        async (remainingMs, scanCount) => {
          const notify = jest.fn(async () => true);
          const expiring: IssuedToken = {
            accessToken: 'a',
            refreshToken: 'r',
            accessTokenExpireAt: new Date(NOW.getTime() + remainingMs),
            scopes: ['ads'],
            authModelMeta: {},
          };
          const { service, tokens } = setup(
            { authorizeMeta: jest.fn(async () => expiring) },
            { notify },
          );
          await service.authorizeMeta('m', { businessManagerId: 'bm' });
          const tokenId = [...tokens.values()][0].id;

          let lastStatus = '';
          for (let i = 0; i < scanCount; i += 1) {
            const out = await service.scanExpiryWarning(tokenId, NOW);
            lastStatus = out.status;
          }

          // 区间映射：剩余 0-7 天恒为「即将过期」（需求 5.2）。
          expect(lastStatus).toBe('即将过期');
          // 幂等：无论扫描多少次，预警仅发送一次（需求 5.2）。
          expect(notify).toHaveBeenCalledTimes(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 9
  // Property 9: 连续刷新失败阈值停止
  // Validates: Requirements 5.5
  it('Property 9: 连续刷新失败达 3 次时置「需重新授权」且不再发起刷新调用', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 3, max: 8 }), async (attempts) => {
        const notify = jest.fn(async () => true);
        const refreshFn = jest.fn(async (): Promise<RefreshedToken> => {
          throw new Error('刷新失败');
        });
        const issued: IssuedToken = {
          accessToken: 'a',
          refreshToken: 'r',
          accessTokenExpireAt: new Date(Date.now() + 60 * DAY_MS),
          scopes: ['ads'],
          authModelMeta: {},
        };
        const { service, tokens } = setup(
          { authorizeMeta: jest.fn(async () => issued), refreshToken: refreshFn },
          { notify },
        );
        await service.authorizeMeta('m', { businessManagerId: 'bm' });
        const tokenId = [...tokens.values()][0].id;

        let finalStatus = '';
        for (let i = 0; i < attempts; i += 1) {
          const out = await service.refreshToken(tokenId);
          finalStatus = out.status;
        }

        // 达阈值后状态为「需重新授权」（需求 5.5）。
        expect(finalStatus).toBe('需重新授权');
        // 停止后续自动刷新：刷新调用次数恰为阈值次（达阈值后不再调用平台，需求 5.5）。
        expect(refreshFn.mock.calls.length).toBe(MAX_CONSECUTIVE_REFRESH_FAILURES);
      }),
      { numRuns: 100 },
    );
  });
});
