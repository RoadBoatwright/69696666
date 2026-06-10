/**
 * 账户授权中心领域类型（组件 2，需求 2-5）。
 *
 * 平台无关的统一授权/令牌领域定义，被 AuthCenter 服务、端口与接入层共用。
 * 三平台授权模型差异收敛在 {@link IssuedToken.authModelMeta}（需求 6.6）。
 */
import type { TokenStatus } from '../entities/token-record.entity';
import type { AccountAuthStatus } from '../entities/account-authorization.entity';

/** 受支持代客户授权的平台标识（需求 2、3、4）。 */
export type AuthPlatformId = 'meta' | 'google' | 'tiktok';

/** Meta 授权参数（System User token + on-behalf-of，需求 2.1）。 */
export interface MetaAuthParams {
  /** 客户 Business Manager 标识。 */
  businessManagerId: string;
  /** 授权范围。 */
  scopes?: string[];
}

/** Google 授权参数（MCC + OAuth，需求 3.1）。 */
export interface GoogleAuthParams {
  /** 待挂载到 MCC 下的客户账户标识。 */
  customerId: string;
  /** 授权范围。 */
  scopes?: string[];
}

/** TikTok 授权参数（BC Agency + 每账户 OAuth，需求 4.1）。 */
export interface TikTokAuthParams {
  /** TikTok 广告账户标识。 */
  advertiserId: string;
  /** 授权范围。 */
  scopes?: string[];
}

/**
 * 平台授权成功后由外部平台返回（在端口实现内归一化）的令牌材料（需求 2.2、3.2、4.2）。
 *
 * 令牌明文仅在内存中流转，服务侧加密后落库，绝不落明文（需求 19.1）。
 */
export interface IssuedToken {
  /** 访问令牌明文。 */
  accessToken: string;
  /** 刷新令牌明文（Meta 等无刷新令牌时可空）。 */
  refreshToken?: string;
  /** 访问令牌有效期（精确到秒，需求 2.7）。 */
  accessTokenExpireAt: Date;
  /** 刷新令牌有效期（精确到秒，需求 4.2）。 */
  refreshTokenExpireAt?: Date;
  /** 授权范围（需求 2.2）。 */
  scopes: string[];
  /** 平台授权模型差异承载（需求 6.6）。 */
  authModelMeta: Record<string, unknown>;
}

/** 令牌刷新成功的归一化结果（需求 5.4、4.3）。 */
export interface RefreshedToken {
  accessToken: string;
  accessTokenExpireAt: Date;
  refreshToken?: string;
  refreshTokenExpireAt?: Date;
}

/** 授权建立成功结果（需求 2.1）。 */
export interface AuthorizeSuccess {
  ok: true;
  accountId: string;
  authStatus: AccountAuthStatus;
}

/** 授权建立失败结果：不建立代管理关系、保持「未授权」（需求 2.7、4.5）。 */
export interface AuthorizeFailure {
  ok: false;
  /** 失败原因。 */
  reason: string;
  /** 失败后保持的授权状态（恒为「未授权」）。 */
  authStatus: AccountAuthStatus;
}

export type AuthorizeResult = AuthorizeSuccess | AuthorizeFailure;

/** 授权状态汇总视图行（需求 5.7）。 */
export interface AuthorizationSummaryRow {
  platform: string;
  accountId: string;
  status: TokenStatus;
  remainingDays: number;
}
