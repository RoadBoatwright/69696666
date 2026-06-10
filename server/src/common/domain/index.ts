/**
 * 领域核心类型（平台无关的统一领域模型）。
 *
 * 例如：凭据状态、统一广告对象（Campaign / AdGroup / Ad）、令牌记录等。
 */
export { CREDENTIAL_PLATFORMS, CREDENTIAL_KEYS, isCredentialSubmitFailure } from './credential';
export type {
  CredentialPlatformId,
  CredentialKey,
  CredentialConfigStatus,
  CredentialDescriptor,
  CredentialValidationError,
  CredentialSubmitSuccess,
  CredentialSubmitFailure,
  CredentialSubmitResult,
} from './credential';
