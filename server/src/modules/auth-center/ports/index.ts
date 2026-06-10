/**
 * 账户授权中心外部依赖端口（组件 2，需求 2-5）。
 *
 * 将外部平台 API 调用、刷新、撤销检测与管理员通知抽象为端口接口，
 * 使 AuthCenter 服务可被单元/属性测试以 mock 桩注入（外部平台调用一律 mock）。
 */
import type {
  AuthPlatformId,
  GoogleAuthParams,
  IssuedToken,
  MetaAuthParams,
  RefreshedToken,
  TikTokAuthParams,
} from '../domain/auth';

/** DI 注入令牌：平台授权客户端。 */
export const PLATFORM_AUTH_CLIENT = Symbol('PLATFORM_AUTH_CLIENT');

/** DI 注入令牌：管理员通知器。 */
export const AUTH_NOTIFIER = Symbol('AUTH_NOTIFIER');

/**
 * 平台授权客户端端口：封装对三平台官方 API 的代客户授权建立、令牌刷新与撤销检测。
 *
 * 任一方法在外部调用失败时应抛出错误，由 AuthCenter 服务转译为领域结果。
 */
export interface PlatformAuthClient {
  /** Meta 代客户授权建立（System User token + on-behalf-of，需求 2.1）。 */
  authorizeMeta(merchantId: string, params: MetaAuthParams): Promise<IssuedToken>;

  /** Google 代客户授权建立（MCC + OAuth，需求 3.1）。 */
  authorizeGoogle(merchantId: string, params: GoogleAuthParams): Promise<IssuedToken>;

  /** TikTok 代客户授权建立（BC Agency + 每账户 OAuth，需求 4.1）。 */
  authorizeTikTok(merchantId: string, params: TikTokAuthParams): Promise<IssuedToken>;

  /** 刷新令牌；失败抛错（需求 5.4、5.5、4.3）。 */
  refreshToken(
    platform: AuthPlatformId,
    refreshToken: string | null,
    authModelMeta: Record<string, unknown>,
  ): Promise<RefreshedToken>;

  /**
   * 检测某账户授权是否仍然有效（需求 2.4、2.5、3.5、4.6）。
   *
   * 返回：
   *  - 'active'：授权仍有效。
   *  - 'revoked'：客户已撤销/解除关联 → 置「授权已撤销」。
   *  - 'invalid'：授权失效错误 → 置「需重新授权」。
   */
  detectRevocation(
    platform: AuthPlatformId,
    authModelMeta: Record<string, unknown>,
  ): Promise<'active' | 'revoked' | 'invalid'>;
}

/** 管理员通知器端口（需求 3.4、5.2、5.5）。 */
export interface AuthNotifier {
  /**
   * 发送预警/通知。返回是否发送成功；发送失败时由服务侧记录原因、状态不变、下周期重试（需求 5.6）。
   */
  notify(message: string): Promise<boolean>;
}
