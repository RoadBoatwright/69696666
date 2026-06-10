/**
 * 凭据相关领域错误（组件 1，需求 1、6）。
 */
import { CredentialValidationError } from '../domain/credential';

/**
 * 凭据未配置错误（需求 1.5）：使用某未填入平台功能时返回「该平台凭据未配置」。
 */
export class CredentialNotConfiguredError extends Error {
  readonly platform: string;

  constructor(platform: string) {
    super('该平台凭据未配置');
    this.name = 'CredentialNotConfiguredError';
    this.platform = platform;
  }
}

/**
 * 凭据校验失败错误（需求 1.7）：携带全部不符合项。
 */
export class CredentialValidationFailedError extends Error {
  readonly errors: CredentialValidationError[];

  constructor(errors: CredentialValidationError[]) {
    super('凭据校验失败');
    this.name = 'CredentialValidationFailedError';
    this.errors = errors;
  }
}

/**
 * 凭据加密或存储失败错误（需求 1.8）：携带失败原因，调用方据此保持原状态。
 */
export class CredentialPersistenceError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`凭据加密或存储失败：${reason}`);
    this.name = 'CredentialPersistenceError';
    this.reason = reason;
  }
}
