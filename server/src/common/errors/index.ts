/**
 * 统一领域错误（错误分类与异常过滤器归类）。
 *
 * 例如：CredentialNotConfiguredError、CredentialValidationFailedError 等。
 */
export {
  CredentialNotConfiguredError,
  CredentialValidationFailedError,
  CredentialPersistenceError,
} from './credential.error';
