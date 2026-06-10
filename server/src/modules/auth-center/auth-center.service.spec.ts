import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';

import type { EncryptionConfig } from '../../config/configuration';
import { CredentialCipherService } from '../credential/credential-cipher.service';
import { AuthCenterService } from './auth-center.service';
import { AccountAuthorization } from './entities/account-authorization.entity';
import { TokenRecord } from './entities/token-record.entity';
import { DAY_MS } from './pure/token-status.pure';
import type { AuthNotifier, PlatformAuthClient } from './ports';
import type { IssuedToken, RefreshedToken } from './domain/auth';

const NOW = new Date('2025-01-01T00:00:00Z');

/** 内存版仓储桩，支持 save/findOne/find（含 relations 关联补全）。 */
function makeRepos(): {
  accountRepo: Repository<AccountAuthorization>;
  tokenRepo: Repository<TokenRecord>;
  accounts: Map<string, AccountAuthorization>;
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

  return { accountRepo, tokenRepo, accounts, tokens };
}

function makeCipher(): CredentialCipherService {
  const configService = {
    get: (key: string): EncryptionConfig | undefined =>
      key === 'encryption' ? { kmsKeyId: '', localEncryptionKey: 'auth-master-key' } : undefined,
  } as unknown as ConfigService;
  return new CredentialCipherService(configService);
}

describe('AuthCenterService（组件 2，需求 2-5）', () => {
  function setup(
    clientOverrides: Partial<PlatformAuthClient> = {},
    notifier: AuthNotifier = { notify: jest.fn(async () => true) },
  ) {
    const { accountRepo, tokenRepo, accounts, tokens } = makeRepos();
    const client: PlatformAuthClient = {
      authorizeMeta: jest.fn(),
      authorizeGoogle: jest.fn(),
      authorizeTikTok: jest.fn(),
      refreshToken: jest.fn(),
      detectRevocation: jest.fn(),
      ...clientOverrides,
    };
    const service = new AuthCenterService(accountRepo, tokenRepo, makeCipher(), client, notifier);
    return { service, client, notifier, accounts, tokens };
  }

  const issued: IssuedToken = {
    accessToken: 'access-plain-123',
    refreshToken: 'refresh-plain-456',
    // 有效期相对「真实当前时间」远期，使 authorize() 内部以实时时钟派生的持久化状态为「有效」。
    accessTokenExpireAt: new Date(Date.now() + 60 * DAY_MS),
    refreshTokenExpireAt: new Date(Date.now() + 180 * DAY_MS),
    scopes: ['ads_management'],
    authModelMeta: { businessManagerId: 'bm-1' },
  };

  describe('5.9 三平台授权建立与撤销检测', () => {
    it('Meta 授权成功：置「有效」、加密落库、不落明文（需求 2.1、2.2、19.1）', async () => {
      const { service, tokens } = setup({ authorizeMeta: jest.fn(async () => issued) });
      const result = await service.authorizeMeta('merchant-1', { businessManagerId: 'bm-1' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.authStatus).toBe('有效');
      }
      const token = [...tokens.values()][0];
      expect(token.status).toBe('有效');
      // 密文不含明文（需求 19.1）。
      expect(token.encryptedAccessToken!.toString('utf8')).not.toContain('access-plain-123');
      expect(token.encryptedRefreshToken!.toString('utf8')).not.toContain('refresh-plain-456');
    });

    it('授权失败：不建立代管理关系、返回原因、保持「未授权」（需求 2.7、4.5）', async () => {
      const { service, tokens, accounts } = setup({
        authorizeTikTok: jest.fn(async () => {
          throw new Error('授权被拒');
        }),
      });
      const result = await service.authorizeTikTok('merchant-1', { advertiserId: 'adv-1' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.authStatus).toBe('未授权');
        expect(result.reason).toContain('授权被拒');
      }
      expect(tokens.size).toBe(0);
      expect(accounts.size).toBe(0);
    });

    it('撤销检测：revoked → 「授权已撤销」（需求 2.5、4.6）', async () => {
      const { service, accounts, tokens } = setup({
        authorizeMeta: jest.fn(async () => issued),
        detectRevocation: jest.fn(async () => 'revoked' as const),
      });
      const r = await service.authorizeMeta('m', { businessManagerId: 'bm' });
      const accountId = r.ok ? r.accountId : '';
      const status = await service.detectRevocation(accountId, NOW);
      expect(status).toBe('授权已撤销');
      expect(accounts.get(accountId)!.authStatus).toBe('授权已撤销');
      expect([...tokens.values()][0].status).toBe('授权已撤销');
    });

    it('撤销检测：invalid → 「需重新授权」并记录失败时间（需求 2.6、3.7、4.4）', async () => {
      const { service, tokens } = setup({
        authorizeMeta: jest.fn(async () => issued),
        detectRevocation: jest.fn(async () => 'invalid' as const),
      });
      const r = await service.authorizeMeta('m', { businessManagerId: 'bm' });
      const accountId = r.ok ? r.accountId : '';
      const status = await service.detectRevocation(accountId, NOW);
      expect(status).toBe('需重新授权');
      expect([...tokens.values()][0].lastFailureAt).toEqual(NOW);
    });
  });

  describe('5.5 刷新、保活与连续失败阈值停止', () => {
    it('刷新成功：更新有效期、置「有效」、复位失败计数（需求 5.4、4.3）', async () => {
      const refreshed: RefreshedToken = {
        accessToken: 'new-access',
        accessTokenExpireAt: new Date(NOW.getTime() + 120 * DAY_MS),
      };
      const { service, tokens } = setup({
        authorizeMeta: jest.fn(async () => issued),
        refreshToken: jest.fn(async () => refreshed),
      });
      await service.authorizeMeta('m', { businessManagerId: 'bm' });
      const token = [...tokens.values()][0];
      token.consecutiveRefreshFailures = 2;
      token.status = '即将过期';
      await service['tokenRepo'].save(token);

      const out = await service.refreshToken(token.id);
      expect(out.status).toBe('有效');
      expect(out.consecutiveRefreshFailures).toBe(0);
      expect(out.accessTokenExpireAt).toEqual(refreshed.accessTokenExpireAt);
    });

    it('连续刷新失败达 3 次：置「需重新授权」、停止刷新、记失败时间、通知（需求 5.5）', async () => {
      const notify = jest.fn(async () => true);
      const refreshFn = jest.fn(async () => {
        throw new Error('刷新失败');
      });
      const { service, tokens } = setup(
        { authorizeMeta: jest.fn(async () => issued), refreshToken: refreshFn },
        { notify },
      );
      await service.authorizeMeta('m', { businessManagerId: 'bm' });
      const token = [...tokens.values()][0];

      await service.refreshToken(token.id); // 1
      await service.refreshToken(token.id); // 2
      const out = await service.refreshToken(token.id); // 3 → 阈值

      expect(out.consecutiveRefreshFailures).toBe(3);
      expect(out.status).toBe('需重新授权');
      expect(out.lastFailureAt).not.toBeNull();
      expect(notify).toHaveBeenCalledTimes(1);

      // 已停止刷新：再次调用不再发起平台刷新（需求 5.5）。
      const callsBefore = refreshFn.mock.calls.length;
      await service.refreshToken(token.id);
      expect(refreshFn.mock.calls.length).toBe(callsBefore);
    });

    it('Google 保活区间 [80,90) 触发刷新并更新上次使用时间（需求 3.3）', async () => {
      const refreshed: RefreshedToken = {
        accessToken: 'ka-access',
        accessTokenExpireAt: new Date(NOW.getTime() + 90 * DAY_MS),
      };
      const { service, tokens } = setup({
        authorizeGoogle: jest.fn(async () => issued),
        refreshToken: jest.fn(async () => refreshed),
      });
      await service.authorizeGoogle('m', { customerId: 'c-1' });
      const token = [...tokens.values()][0];
      token.lastUsedAt = new Date(NOW.getTime() - 85 * DAY_MS);
      await service['tokenRepo'].save(token);

      const out = await service.runGoogleKeepAlive(token.id, NOW);
      expect(out.status).toBe('有效');
      expect(out.lastUsedAt).toEqual(NOW);
    });

    it('Google 达 90 天置「需重新授权」并预警（需求 3.4）', async () => {
      const notify = jest.fn(async () => true);
      const { service, tokens } = setup(
        { authorizeGoogle: jest.fn(async () => issued) },
        { notify },
      );
      await service.authorizeGoogle('m', { customerId: 'c-1' });
      const token = [...tokens.values()][0];
      token.lastUsedAt = new Date(NOW.getTime() - 90 * DAY_MS);
      await service['tokenRepo'].save(token);

      const out = await service.runGoogleKeepAlive(token.id, NOW);
      expect(out.status).toBe('需重新授权');
      expect(notify).toHaveBeenCalledTimes(1);
    });
  });

  describe('5.3 即将过期预警与幂等', () => {
    it('剩余 0-7 天置「即将过期」并发预警，仅发一次（需求 5.2、5.6）', async () => {
      const notify = jest.fn(async () => true);
      const expiring: IssuedToken = {
        ...issued,
        accessTokenExpireAt: new Date(NOW.getTime() + 3 * DAY_MS),
      };
      const { service, tokens } = setup(
        { authorizeMeta: jest.fn(async () => expiring) },
        { notify },
      );
      await service.authorizeMeta('m', { businessManagerId: 'bm' });
      const token = [...tokens.values()][0];

      const out1 = await service.scanExpiryWarning(token.id, NOW);
      expect(out1.status).toBe('即将过期');
      expect(notify).toHaveBeenCalledTimes(1);

      // 幂等：再次扫描不再发送。
      await service.scanExpiryWarning(token.id, NOW);
      expect(notify).toHaveBeenCalledTimes(1);
    });

    it('预警发送失败：状态不变标记、下周期重试（需求 5.6）', async () => {
      const notify = jest.fn(async () => false);
      const expiring: IssuedToken = {
        ...issued,
        accessTokenExpireAt: new Date(NOW.getTime() + 3 * DAY_MS),
      };
      const { service, tokens } = setup(
        { authorizeMeta: jest.fn(async () => expiring) },
        { notify },
      );
      await service.authorizeMeta('m', { businessManagerId: 'bm' });
      const token = [...tokens.values()][0];

      const out1 = await service.scanExpiryWarning(token.id, NOW);
      expect(out1.lastWarningSentAt).toBeNull(); // 未置幂等标记

      // 下一周期重试仍尝试发送。
      await service.scanExpiryWarning(token.id, NOW);
      expect(notify).toHaveBeenCalledTimes(2);
    });
  });

  describe('5.10 授权状态汇总视图（需求 5.7）', () => {
    it('返回平台、账户、状态与剩余有效期', async () => {
      const { service, tokens } = setup({ authorizeMeta: jest.fn(async () => issued) });
      await service.authorizeMeta('m', { businessManagerId: 'bm' });
      // 汇总视图按传入的 now 重算剩余有效期，故将有效期对齐到 NOW + 60 天，使断言不随真实时钟漂移。
      const token = [...tokens.values()][0];
      token.accessTokenExpireAt = new Date(NOW.getTime() + 60 * DAY_MS);
      await service['tokenRepo'].save(token);

      const summary = await service.getAuthorizationSummary(NOW);
      expect(summary).toHaveLength(1);
      expect(summary[0].platform).toBe('meta');
      expect(summary[0].status).toBe('有效');
      expect(summary[0].remainingDays).toBe(60);
    });
  });
});
