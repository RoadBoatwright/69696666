import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CredentialCipherService } from '../credential/credential-cipher.service';
import {
  AccountAuthorization,
  type AccountAuthStatus,
} from './entities/account-authorization.entity';
import { TokenRecord } from './entities/token-record.entity';
import type {
  AuthorizationSummaryRow,
  AuthorizeResult,
  AuthPlatformId,
  GoogleAuthParams,
  IssuedToken,
  MetaAuthParams,
  TikTokAuthParams,
} from './domain/auth';
import {
  AUTH_NOTIFIER,
  type AuthNotifier,
  PLATFORM_AUTH_CLIENT,
  type PlatformAuthClient,
} from './ports';
import {
  applyRefreshFailure,
  applyRefreshSuccess,
  evaluateGoogleKeepAlive,
  evaluateTokenStatus,
  remainingValidityDays,
  shouldSendExpiryWarning,
  type TokenStateInput,
} from './pure/token-status.pure';

/**
 * 账户授权中心服务（组件 2，需求 2-5）。
 *
 * 编排令牌状态机纯函数（{@link evaluateTokenStatus} 等）、三平台代客户授权建立、
 * 令牌刷新/保活、连续失败阈值停止、即将过期预警幂等、撤销检测与授权状态汇总。
 *
 * 所有外部平台 API 调用经 {@link PlatformAuthClient} 端口（可 mock）；令牌明文
 * 经 {@link CredentialCipherService} 加密后落库，绝不落明文（需求 19.1）。
 */
@Injectable()
export class AuthCenterService {
  private readonly logger = new Logger(AuthCenterService.name);

  constructor(
    @InjectRepository(AccountAuthorization)
    private readonly accountRepo: Repository<AccountAuthorization>,
    @InjectRepository(TokenRecord)
    private readonly tokenRepo: Repository<TokenRecord>,
    @Inject(CredentialCipherService)
    private readonly cipher: CredentialCipherService,
    @Inject(PLATFORM_AUTH_CLIENT)
    private readonly platformClient: PlatformAuthClient,
    @Inject(AUTH_NOTIFIER)
    private readonly notifier: AuthNotifier,
  ) {}

  // ---------------------------------------------------------------------------
  // 5.9 三平台代客户授权建立
  // ---------------------------------------------------------------------------

  /** Meta 代客户授权建立（System User token + on-behalf-of，需求 2.1、2.2、2.7）。 */
  async authorizeMeta(merchantId: string, params: MetaAuthParams): Promise<AuthorizeResult> {
    return this.authorize('meta', merchantId, () =>
      this.platformClient.authorizeMeta(merchantId, params),
    );
  }

  /** Google 代客户授权建立（MCC + OAuth，需求 3.1、3.2）。 */
  async authorizeGoogle(merchantId: string, params: GoogleAuthParams): Promise<AuthorizeResult> {
    return this.authorize('google', merchantId, () =>
      this.platformClient.authorizeGoogle(merchantId, params),
    );
  }

  /** TikTok 代客户授权建立（BC Agency + 每账户 OAuth，需求 4.1、4.2、4.5）。 */
  async authorizeTikTok(merchantId: string, params: TikTokAuthParams): Promise<AuthorizeResult> {
    return this.authorize('tiktok', merchantId, () =>
      this.platformClient.authorizeTikTok(merchantId, params),
    );
  }

  /**
   * 三平台授权建立的统一编排（归一到 AccountAuthorization + TokenRecord，需求 6.6）。
   *
   * - 成功：建立代管理关系、加密落库令牌、记录客户标识/范围/关联与精确到秒有效期、置「有效」。
   * - 失败：不建立代管理关系、返回失败原因、保持「未授权」（需求 2.7、4.5）。
   */
  private async authorize(
    platform: AuthPlatformId,
    merchantId: string,
    issue: () => Promise<IssuedToken>,
  ): Promise<AuthorizeResult> {
    let token: IssuedToken;
    try {
      token = await issue();
    } catch (error) {
      // 授权建立失败：不建立代管理关系、保持「未授权」（需求 2.7、4.5）。
      return {
        ok: false,
        reason: this.describeError(error),
        authStatus: '未授权',
      };
    }

    const account = await this.accountRepo.save(
      this.accountRepo.create({
        platform,
        merchantId,
        authStatus: '有效',
        scopes: token.scopes,
        authModelMeta: token.authModelMeta,
      }),
    );

    const now = new Date();
    const status = evaluateTokenStatus(
      {
        status: '有效',
        accessTokenExpireAt: token.accessTokenExpireAt,
        consecutiveRefreshFailures: 0,
        lastWarningSentAt: null,
      },
      now,
    );

    await this.tokenRepo.save(
      this.tokenRepo.create({
        accountId: account.id,
        status,
        encryptedAccessToken: this.encryptToken(token.accessToken),
        encryptedRefreshToken: token.refreshToken ? this.encryptToken(token.refreshToken) : null,
        accessTokenExpireAt: token.accessTokenExpireAt,
        refreshTokenExpireAt: token.refreshTokenExpireAt ?? null,
        lastUsedAt: now,
        consecutiveRefreshFailures: 0,
        lastWarningSentAt: null,
        lastFailureAt: null,
      }),
    );

    return { ok: true, accountId: account.id, authStatus: '有效' };
  }

  // ---------------------------------------------------------------------------
  // 5.5 令牌刷新、保活与连续失败阈值停止
  // ---------------------------------------------------------------------------

  /**
   * 刷新令牌（需求 5.4、5.5、4.3）。
   *
   * - 已达连续失败阈值（状态「需重新授权」）时停止刷新、不再调用平台（需求 5.5）。
   * - 刷新成功：更新有效期、状态置「有效」、连续失败计数复位为 0（需求 5.4、4.3）。
   * - 刷新失败：失败计数加一；达 3 次置「需重新授权」、停止刷新、记录失败时间、通知管理员（需求 5.5）。
   */
  async refreshToken(tokenId: string): Promise<TokenRecord> {
    const record = await this.tokenRepo.findOne({
      where: { id: tokenId },
      relations: { account: true },
    });
    if (!record) {
      throw new Error(`令牌记录不存在：${tokenId}`);
    }

    // 已停止刷新（需求 5.5）：达阈值/需重新授权/已撤销不再发起刷新调用。
    if (record.status === '需重新授权' || record.status === '授权已撤销') {
      return record;
    }

    const platform = record.account.platform as AuthPlatformId;
    const refreshPlain = record.encryptedRefreshToken
      ? this.decryptToken(record.encryptedRefreshToken)
      : null;

    try {
      const refreshed = await this.platformClient.refreshToken(
        platform,
        refreshPlain,
        (record.account.authModelMeta as Record<string, unknown>) ?? {},
      );
      const patch = applyRefreshSuccess(refreshed.accessTokenExpireAt);
      record.status = patch.status;
      record.accessTokenExpireAt = patch.accessTokenExpireAt;
      record.consecutiveRefreshFailures = patch.consecutiveRefreshFailures;
      record.lastWarningSentAt = patch.lastWarningSentAt;
      record.encryptedAccessToken = this.encryptToken(refreshed.accessToken);
      if (refreshed.refreshToken) {
        record.encryptedRefreshToken = this.encryptToken(refreshed.refreshToken);
      }
      if (refreshed.refreshTokenExpireAt) {
        record.refreshTokenExpireAt = refreshed.refreshTokenExpireAt;
      }
      record.lastUsedAt = new Date();
      return await this.tokenRepo.save(record);
    } catch (error) {
      const now = new Date();
      const patch = applyRefreshFailure(record, now);
      record.consecutiveRefreshFailures = patch.consecutiveRefreshFailures;
      record.status = patch.status;
      record.lastFailureAt = patch.lastFailureAt;
      const saved = await this.tokenRepo.save(record);
      if (patch.stopAutoRefresh) {
        // 达阈值：停止后续自动刷新、通知管理员（需求 5.5）。
        await this.notifier.notify(
          `令牌连续刷新失败达阈值，已置「需重新授权」：platform=${platform}, accountId=${record.accountId}`,
        );
      }
      return saved;
    }
  }

  /**
   * Google OAuth 保活（需求 3.3、3.4）。
   *
   * - 距上次使用处于 80（含）-90（不含）天区间 → 触发保活刷新，成功后更新上次使用时间。
   * - 距上次使用达 90 天 → 置「需重新授权」并向管理员预警。
   */
  async runGoogleKeepAlive(tokenId: string, now: Date = new Date()): Promise<TokenRecord> {
    const record = await this.tokenRepo.findOne({
      where: { id: tokenId },
      relations: { account: true },
    });
    if (!record) {
      throw new Error(`令牌记录不存在：${tokenId}`);
    }

    const action = evaluateGoogleKeepAlive(record.lastUsedAt, now);
    if (action === 'reauth') {
      record.status = '需重新授权';
      record.lastFailureAt = now;
      const saved = await this.tokenRepo.save(record);
      await this.notifier.notify(
        `Google OAuth 令牌距上次使用达 90 天，已置「需重新授权」：accountId=${record.accountId}`,
      );
      return saved;
    }
    if (action === 'keepalive') {
      const refreshPlain = record.encryptedRefreshToken
        ? this.decryptToken(record.encryptedRefreshToken)
        : null;
      try {
        const refreshed = await this.platformClient.refreshToken(
          'google',
          refreshPlain,
          (record.account.authModelMeta as Record<string, unknown>) ?? {},
        );
        const patch = applyRefreshSuccess(refreshed.accessTokenExpireAt);
        record.status = patch.status;
        record.accessTokenExpireAt = patch.accessTokenExpireAt;
        record.consecutiveRefreshFailures = patch.consecutiveRefreshFailures;
        record.lastWarningSentAt = patch.lastWarningSentAt;
        record.encryptedAccessToken = this.encryptToken(refreshed.accessToken);
        // 保活成功后更新上次使用时间（需求 3.3）。
        record.lastUsedAt = now;
        return await this.tokenRepo.save(record);
      } catch (error) {
        const patch = applyRefreshFailure(record, now);
        record.consecutiveRefreshFailures = patch.consecutiveRefreshFailures;
        record.status = patch.status;
        record.lastFailureAt = patch.lastFailureAt;
        const saved = await this.tokenRepo.save(record);
        if (patch.stopAutoRefresh) {
          await this.notifier.notify(
            `Google 保活刷新连续失败达阈值，已置「需重新授权」：accountId=${record.accountId}`,
          );
        }
        return saved;
      }
    }
    return record;
  }

  // ---------------------------------------------------------------------------
  // 5.3 即将过期预警与幂等发送
  // ---------------------------------------------------------------------------

  /**
   * 扫描单个令牌的即将过期预警（需求 5.2、5.6）。
   *
   * - 剩余有效期处于 0-7 天（含 7 不含 0）时置「即将过期」并发出含平台、账户、剩余天数的预警。
   * - 幂等：同一令牌同一预警仅发送一次（`lastWarningSentAt` 已置则不再发）。
   * - 发送失败：记录原因、状态不变（不置 `lastWarningSentAt`），下一周期重试。
   */
  async scanExpiryWarning(tokenId: string, now: Date = new Date()): Promise<TokenRecord> {
    const record = await this.tokenRepo.findOne({
      where: { id: tokenId },
      relations: { account: true },
    });
    if (!record) {
      throw new Error(`令牌记录不存在：${tokenId}`);
    }

    const stateInput = this.toStateInput(record);
    const status = evaluateTokenStatus(stateInput, now);
    record.status = status;

    if (shouldSendExpiryWarning(stateInput, now)) {
      const remainingDays = remainingValidityDays(record, now);
      const sent = await this.notifier.notify(
        `令牌即将过期：platform=${record.account.platform}, accountId=${record.accountId}, 剩余 ${remainingDays} 天`,
      );
      if (sent) {
        // 幂等标记：同一预警仅发一次（需求 5.2）。
        record.lastWarningSentAt = now;
      } else {
        // 发送失败：记录原因、状态不变（不置幂等标记），下周期重试（需求 5.6）。
        this.logger.warn(`即将过期预警发送失败，下一周期重试：accountId=${record.accountId}`);
      }
    }

    return this.tokenRepo.save(record);
  }

  // ---------------------------------------------------------------------------
  // 5.9 撤销/失效检测
  // ---------------------------------------------------------------------------

  /**
   * 撤销/失效检测（需求 2.5、3.5、4.6、2.6）。
   *
   * - 'revoked'：客户撤销/解除关联 → 账户与令牌置「授权已撤销」。
   * - 'invalid'：授权失效错误 → 置「需重新授权」并记录精确到秒失败时间。
   * - 'active'：保持不变。
   */
  async detectRevocation(accountId: string, now: Date = new Date()): Promise<AccountAuthStatus> {
    const account = await this.accountRepo.findOne({ where: { id: accountId } });
    if (!account) {
      throw new Error(`授权记录不存在：${accountId}`);
    }
    const result = await this.platformClient.detectRevocation(
      account.platform as AuthPlatformId,
      (account.authModelMeta as Record<string, unknown>) ?? {},
    );

    if (result === 'active') {
      return account.authStatus;
    }

    const token = await this.tokenRepo.findOne({ where: { accountId } });

    if (result === 'revoked') {
      account.authStatus = '授权已撤销';
      await this.accountRepo.save(account);
      if (token) {
        token.status = '授权已撤销';
        await this.tokenRepo.save(token);
      }
      return '授权已撤销';
    }

    // invalid：授权失效错误 → 需重新授权、记录失败时间（需求 2.6、3.7、4.4）。
    account.authStatus = '需重新授权';
    await this.accountRepo.save(account);
    if (token) {
      token.status = '需重新授权';
      token.lastFailureAt = now;
      await this.tokenRepo.save(token);
    }
    return '需重新授权';
  }

  // ---------------------------------------------------------------------------
  // 5.10 授权状态汇总视图
  // ---------------------------------------------------------------------------

  /**
   * 授权状态汇总视图（需求 5.7）。
   *
   * 含平台、账户标识、当前令牌状态与剩余有效期，状态依据当前时间由状态机派生。
   */
  async getAuthorizationSummary(now: Date = new Date()): Promise<AuthorizationSummaryRow[]> {
    const tokens = await this.tokenRepo.find({ relations: { account: true } });
    return tokens.map((record) => ({
      platform: record.account.platform,
      accountId: record.accountId,
      status: evaluateTokenStatus(this.toStateInput(record), now),
      remainingDays: remainingValidityDays(record, now),
    }));
  }

  // ---------------------------------------------------------------------------
  // 内部辅助
  // ---------------------------------------------------------------------------

  /** 由令牌记录构造状态机最小输入视图。 */
  private toStateInput(record: TokenRecord): TokenStateInput {
    return {
      status: record.status,
      accessTokenExpireAt: record.accessTokenExpireAt,
      consecutiveRefreshFailures: record.consecutiveRefreshFailures,
      lastWarningSentAt: record.lastWarningSentAt,
    };
  }

  /** 加密令牌明文为密文（需求 19.1）。 */
  private encryptToken(plain: string): Buffer {
    return this.cipher.encrypt({ token: plain });
  }

  /** 解密令牌密文为明文（仅在内存中使用，需求 19.3）。 */
  private decryptToken(blob: Buffer): string {
    const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
    const decrypted = this.cipher.decrypt(buf);
    return decrypted.token;
  }

  /** 提取错误原因文本（用于授权失败返回，不含敏感明文）。 */
  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}
