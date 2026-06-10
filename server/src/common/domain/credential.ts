/**
 * 凭据领域核心类型（组件 1，需求 1、6、15.1）。
 *
 * 这些类型为平台无关的统一定义，被凭据管理器、纯函数库与接入层共用。
 */

/** 支持配置凭据的平台标识（需求 1.1：Meta、Google、TikTok）。 */
export type CredentialPlatformId = 'meta' | 'google' | 'tiktok';

/**
 * 凭据配置项标识（需求 1.1）：包含三个广告平台与底层生成式 AI（Gemini）。
 *
 * 每个标识对应一个**独立的凭据配置项**（需求 1.1、15.1）。平台可用性隔离（需求 1.4）
 * 仅作用于广告平台（`CredentialPlatformId`）；Gemini 的「未填入」表现为对应 AI 能力
 * 优雅降级为不可用（需求 9.7、15.3），不属于平台可用性集合。
 */
export type CredentialKey = CredentialPlatformId | 'gemini';

/** 凭据配置状态取值域，仅二态（需求 1.1、1.2）。 */
export type CredentialConfigStatus = 'unfilled' | 'filled';

/** 受支持平台的有序列表（用于可用性隔离计算，需求 1.4）。 */
export const CREDENTIAL_PLATFORMS: readonly CredentialPlatformId[] = ['meta', 'google', 'tiktok'];

/** 全部凭据配置项标识的有序列表（含 Gemini，需求 1.1、15.1）。 */
export const CREDENTIAL_KEYS: readonly CredentialKey[] = ['meta', 'google', 'tiktok', 'gemini'];

/** 某凭据配置项描述符：声明该配置项的全部必填凭据项键名（需求 1.1）。 */
export interface CredentialDescriptor {
  /** 配置项标识（meta | google | tiktok | gemini）。 */
  key: CredentialKey;
  /** 该配置项所有必填凭据项的键名（需求 1.1）。 */
  requiredKeys: readonly string[];
}

/** 凭据校验不符合项（需求 1.7）。 */
export interface CredentialValidationError {
  /** 不符合的凭据项键名。 */
  key: string;
  /** 不符合原因（missing | empty | invalid_format）。 */
  reason: 'missing' | 'empty' | 'invalid_format';
}

/** `submitCredential` 成功结果（需求 1.2）。 */
export interface CredentialSubmitSuccess {
  status: CredentialConfigStatus;
}

/** `submitCredential` 校验/存储失败结果（需求 1.7、1.8）。 */
export interface CredentialSubmitFailure {
  errors: CredentialValidationError[];
  /** 失败后该平台保持的原有状态（需求 1.7、1.8）。 */
  status: CredentialConfigStatus;
}

export type CredentialSubmitResult = CredentialSubmitSuccess | CredentialSubmitFailure;

/** 判定提交结果是否为失败（含校验/存储不符合项）。 */
export function isCredentialSubmitFailure(
  result: CredentialSubmitResult,
): result is CredentialSubmitFailure {
  return (result as CredentialSubmitFailure).errors !== undefined;
}
