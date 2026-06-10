/**
 * 令牌生命周期状态机纯函数库（组件 2，需求 5、3、4）。
 *
 * 无副作用，仅依赖入参与传入的 `now`，使令牌状态机不变量可被属性测试覆盖。
 *
 * 包含：
 *  - `evaluateTokenStatus`：令牌状态机核心，输出唯一状态（需求 5.1、5.2、5.3、3.4）。
 *  - `remainingValidityDays`：剩余有效期天数（用于预警与汇总视图，需求 5.2、5.7）。
 *  - `shouldSendExpiryWarning`：即将过期预警幂等判定（需求 5.2、5.6）。
 *  - `applyRefreshSuccess`：刷新成功复位（需求 5.4、4.3）。
 *  - `applyRefreshFailure`：连续刷新失败阈值停止（需求 5.5）。
 *  - `evaluateGoogleKeepAlive`：Google OAuth 保活触发区间（需求 3.3、3.4）。
 */
import type { TokenStatus } from '../entities/token-record.entity';

/** 一天的毫秒数。 */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** 即将过期预警窗口（天）：剩余有效期处于 0（不含）至 7（含）天（需求 5.2）。 */
export const WARNING_WINDOW_DAYS = 7;

/** 即将过期预警窗口（毫秒）。 */
export const WARNING_WINDOW_MS = WARNING_WINDOW_DAYS * DAY_MS;

/** 连续刷新失败阈值：达到即置「需重新授权」并停止自动刷新（需求 5.5）。 */
export const MAX_CONSECUTIVE_REFRESH_FAILURES = 3;

/** Google OAuth 保活下界（天，含）：距上次使用达 80 天触发保活刷新（需求 3.3）。 */
export const GOOGLE_KEEPALIVE_MIN_DAYS = 80;

/** Google OAuth 保活上界（天，不含）：距上次使用达 90 天置「需重新授权」（需求 3.4）。 */
export const GOOGLE_KEEPALIVE_MAX_DAYS = 90;

/** 令牌状态机合法取值集合（需求 5.1）。 */
export const TOKEN_STATUSES: readonly TokenStatus[] = [
  '有效',
  '即将过期',
  '已过期',
  '需重新授权',
  '授权已撤销',
];

/**
 * 令牌状态机所需的最小输入视图。
 *
 * 取自 {@link TokenRecord} 的相关字段，便于纯函数与属性测试构造任意输入。
 */
export interface TokenStateInput {
  /** 当前持久化状态（承载撤销/需重新授权等事件驱动的粘滞状态）。 */
  status: TokenStatus;
  /** 访问令牌有效期（精确到秒，需求 2.7）。为空视为已过期。 */
  accessTokenExpireAt?: Date | null;
  /** 连续刷新失败计数（需求 5.5）。 */
  consecutiveRefreshFailures: number;
  /** 上次预警发送时间，用于预警幂等（需求 5.6）。 */
  lastWarningSentAt?: Date | null;
}

/**
 * 令牌状态机核心纯函数（需求 5.1、5.2、5.3、3.4）。
 *
 * 输入令牌记录与当前时间，输出有且仅有一个、且属于合法状态集合的状态。
 *
 * 判定优先级（保证任一时刻唯一）：
 *  1. 已撤销（粘滞终态，由撤销检测置入，需求 2.5/3.5/4.6）→「授权已撤销」。
 *  2. 需重新授权（由连续刷新失败/Google 90 天/授权失效错误置入），或连续刷新失败
 *     计数达阈值（需求 5.5、3.4）→「需重新授权」。
 *  3. 访问令牌已到期且未刷新（需求 5.3）→「已过期」。
 *  4. 剩余有效期处于 0（不含）至 7（含）天（需求 5.2）→「即将过期」。
 *  5. 其余 →「有效」。
 */
export function evaluateTokenStatus(token: TokenStateInput, now: Date): TokenStatus {
  // 1) 撤销为粘滞终态，优先级最高。
  if (token.status === '授权已撤销') {
    return '授权已撤销';
  }

  // 2) 需重新授权：已置入的需重新授权状态，或连续刷新失败达阈值（需求 5.5）。
  if (
    token.status === '需重新授权' ||
    token.consecutiveRefreshFailures >= MAX_CONSECUTIVE_REFRESH_FAILURES
  ) {
    return '需重新授权';
  }

  // 3-5) 基于剩余有效期的时间派生状态。
  const expireAt = token.accessTokenExpireAt;
  if (!expireAt) {
    // 无已知有效期不可视为「有效」，按已过期处理。
    return '已过期';
  }

  const remaining = expireAt.getTime() - now.getTime();
  if (remaining <= 0) {
    return '已过期'; // 到期未刷新（需求 5.3）；不含 0 边界归入已过期。
  }
  if (remaining <= WARNING_WINDOW_MS) {
    return '即将过期'; // 含 7 天上界（需求 5.2）。
  }
  return '有效';
}

/**
 * 计算令牌剩余有效期天数（向上取整，需求 5.2、5.7）。
 *
 * 已过期或无有效期返回 0；否则返回不小于剩余真实天数的最小整数天，
 * 使「剩余天数」对预警与汇总视图均不低估。
 */
export function remainingValidityDays(
  token: Pick<TokenStateInput, 'accessTokenExpireAt'>,
  now: Date,
): number {
  const expireAt = token.accessTokenExpireAt;
  if (!expireAt) {
    return 0;
  }
  const remaining = expireAt.getTime() - now.getTime();
  if (remaining <= 0) {
    return 0;
  }
  return Math.ceil(remaining / DAY_MS);
}

/**
 * 即将过期预警是否应当发送（需求 5.2、5.6）。
 *
 * 当且仅当令牌当前状态为「即将过期」且尚未就当前过期窗口发送过预警
 * （`lastWarningSentAt` 为空）时返回真，保证同一令牌的同一预警仅发送一次。
 * 刷新成功会复位 `lastWarningSentAt`（见 {@link applyRefreshSuccess}），
 * 使新的过期窗口可再次预警。
 */
export function shouldSendExpiryWarning(token: TokenStateInput, now: Date): boolean {
  return evaluateTokenStatus(token, now) === '即将过期' && token.lastWarningSentAt == null;
}

/** 刷新成功后应写回的字段（需求 5.4、4.3）。 */
export interface RefreshSuccessPatch {
  status: TokenStatus;
  accessTokenExpireAt: Date;
  consecutiveRefreshFailures: number;
  lastWarningSentAt: Date | null;
}

/**
 * 刷新成功复位纯函数（需求 5.4、4.3）。
 *
 * 刷新成功后：更新有效期、状态置「有效」、连续刷新失败计数复位为 0，
 * 并复位预警发送标记（新有效期对应新的预警窗口）。
 */
export function applyRefreshSuccess(newExpireAt: Date): RefreshSuccessPatch {
  return {
    status: '有效',
    accessTokenExpireAt: newExpireAt,
    consecutiveRefreshFailures: 0,
    lastWarningSentAt: null,
  };
}

/** 刷新失败后应写回的字段（需求 5.5）。 */
export interface RefreshFailurePatch {
  status: TokenStatus;
  consecutiveRefreshFailures: number;
  /** 是否应停止后续自动刷新（达阈值时为真，需求 5.5）。 */
  stopAutoRefresh: boolean;
  /** 精确到秒的失败时间（需求 5.5）。 */
  lastFailureAt: Date;
}

/**
 * 刷新失败计数与阈值停止纯函数（需求 5.5）。
 *
 * 在原计数上加一；达到阈值（默认 3）时置「需重新授权」并标记停止自动刷新；
 * 未达阈值时保持原状态。记录精确到秒的失败时间。
 */
export function applyRefreshFailure(
  token: Pick<TokenStateInput, 'status' | 'consecutiveRefreshFailures'>,
  now: Date,
  maxFailures: number = MAX_CONSECUTIVE_REFRESH_FAILURES,
): RefreshFailurePatch {
  const consecutiveRefreshFailures = token.consecutiveRefreshFailures + 1;
  const reached = consecutiveRefreshFailures >= maxFailures;
  return {
    status: reached ? '需重新授权' : token.status,
    consecutiveRefreshFailures,
    stopAutoRefresh: reached,
    lastFailureAt: now,
  };
}

/** Google OAuth 保活动作（需求 3.3、3.4）。 */
export type GoogleKeepAliveAction = 'none' | 'keepalive' | 'reauth';

/**
 * Google OAuth 保活触发区间纯函数（需求 3.3、3.4）。
 *
 * 依据上次使用时间距当前的天数：
 *  - 达 90 天（含）→「reauth」：置「需重新授权」并预警（需求 3.4）。
 *  - 处于 80（含）至 90（不含）天 →「keepalive」：触发保活刷新（需求 3.3）。
 *  - 不足 80 天 →「none」：无需动作。
 */
export function evaluateGoogleKeepAlive(
  lastUsedAt: Date | null | undefined,
  now: Date,
): GoogleKeepAliveAction {
  if (!lastUsedAt) {
    return 'none';
  }
  const days = (now.getTime() - lastUsedAt.getTime()) / DAY_MS;
  if (days >= GOOGLE_KEEPALIVE_MAX_DAYS) {
    return 'reauth';
  }
  if (days >= GOOGLE_KEEPALIVE_MIN_DAYS) {
    return 'keepalive';
  }
  return 'none';
}
