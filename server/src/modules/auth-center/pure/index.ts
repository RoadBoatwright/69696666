/**
 * 账户授权中心纯函数库（无副作用的领域计算，组件 2，需求 2-5）。
 */
export {
  DAY_MS,
  WARNING_WINDOW_DAYS,
  WARNING_WINDOW_MS,
  MAX_CONSECUTIVE_REFRESH_FAILURES,
  GOOGLE_KEEPALIVE_MIN_DAYS,
  GOOGLE_KEEPALIVE_MAX_DAYS,
  TOKEN_STATUSES,
  evaluateTokenStatus,
  remainingValidityDays,
  shouldSendExpiryWarning,
  applyRefreshSuccess,
  applyRefreshFailure,
  evaluateGoogleKeepAlive,
} from './token-status.pure';
export type {
  TokenStateInput,
  RefreshSuccessPatch,
  RefreshFailurePatch,
  GoogleKeepAliveAction,
} from './token-status.pure';
