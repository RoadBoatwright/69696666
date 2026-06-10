/**
 * 纯函数库（无副作用的领域计算）。
 *
 * 例如：computeConfigStatus、redact、computeUnavailablePlatforms 等。
 */
export {
  validateCredentialValues,
  isWellFormedCredentialValue,
  computeConfigStatus,
  maskSecret,
  redact,
  computeUnavailablePlatforms,
  isPlatformAvailable,
} from './credential.pure';
