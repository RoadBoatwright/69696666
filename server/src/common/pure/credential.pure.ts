/**
 * 凭据相关纯函数库（无副作用，组件 1，需求 1、6）。
 *
 * 包含：
 *  - `validateCredentialValues`：校验提交的凭据项，返回不符合项集合（需求 1.7）。
 *  - `computeConfigStatus`：二态状态计算纯函数（需求 1.1）。
 *  - `redact`：脱敏纯函数，暴露不超过末 4 位（需求 1.3、6.2）。
 *  - `computeUnavailablePlatforms`：平台功能可用性隔离（需求 1.4）。
 */
import {
  CredentialConfigStatus,
  CredentialDescriptor,
  CredentialPlatformId,
  CredentialValidationError,
} from '../domain/credential';

/**
 * 校验某平台提交的凭据项，返回全部不符合项（需求 1.7）。
 *
 * 规则：
 *  - 必填项缺失（未出现于提交集合）→ reason='missing'。
 *  - 必填项存在但为空（含仅空白字符）→ reason='empty'。
 *  - 必填项存在且非空但格式不符（含控制字符等）→ reason='invalid_format'。
 *
 * 纯函数，不修改入参。
 */
export function validateCredentialValues(
  descriptor: CredentialDescriptor,
  values: Record<string, string>,
): CredentialValidationError[] {
  const errors: CredentialValidationError[] = [];

  for (const key of descriptor.requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) {
      errors.push({ key, reason: 'missing' });
      continue;
    }

    const raw = values[key];

    if (typeof raw !== 'string' || raw.trim().length === 0) {
      errors.push({ key, reason: 'empty' });
      continue;
    }

    if (!isWellFormedCredentialValue(raw)) {
      errors.push({ key, reason: 'invalid_format' });
    }
  }

  return errors;
}

/**
 * 凭据值格式校验：拒绝包含控制字符（如换行、制表、NUL）的值。
 *
 * 控制字符通常意味着输入被截断或注入，且会破坏日志/脱敏管线，故视为格式不符。
 */
export function isWellFormedCredentialValue(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u001f\u007f]/.test(value);
}

/**
 * 二态状态计算纯函数（需求 1.1）。
 *
 * 当且仅当该平台全部必填凭据项均已提交且通过校验时返回「filled」，否则「unfilled」。
 */
export function computeConfigStatus(
  descriptor: CredentialDescriptor,
  values: Record<string, string>,
): CredentialConfigStatus {
  if (descriptor.requiredKeys.length === 0) {
    return 'unfilled';
  }
  return validateCredentialValues(descriptor, values).length === 0 ? 'filled' : 'unfilled';
}

/** 脱敏占位符字符（需求 6.2）。 */
const REDACTION_CHAR = '*';

/**
 * 单个凭据明文脱敏（需求 6.2）：暴露不超过末位 4 位，其余以占位符替代。
 *
 * - 明文长度 ≤ 4 时，全部以占位符替代（不暴露任何末位，避免短凭据完全泄露）。
 * - 明文长度 > 4 时，保留末 4 位，前缀以等长占位符替代。
 */
export function maskSecret(secret: string): string {
  if (secret.length === 0) {
    return secret;
  }
  if (secret.length <= 4) {
    return REDACTION_CHAR.repeat(secret.length);
  }
  const visible = secret.slice(-4);
  return REDACTION_CHAR.repeat(secret.length - 4) + visible;
}

/**
 * 对任意输出文本做脱敏，保证不含完整凭据明文（需求 1.3、6.2、6.5）。
 *
 * 给定一组已知敏感明文（来自已存储凭据指纹），将文本中出现的每个明文替换为其脱敏形式，
 * 使输出不含任何完整凭据明文，且暴露不超过末 4 位。纯函数。
 */
export function redact(text: string, secrets: readonly string[]): string {
  if (text.length === 0 || secrets.length === 0) {
    return text;
  }

  // 先替换较长的明文，避免较短明文是较长明文子串导致的部分替换遗漏。
  const ordered = [...new Set(secrets)]
    .filter((s) => s.length > 0)
    .sort((a, b) => b.length - a.length);

  let output = text;
  for (const secret of ordered) {
    if (output.includes(secret)) {
      output = output.split(secret).join(maskSecret(secret));
    }
  }
  return output;
}

/**
 * 平台功能可用性隔离（需求 1.4）。
 *
 * 给定各平台配置状态，返回被标记为不可用的平台集合，恰好等于状态为「unfilled」的平台集合；
 * 其余「filled」平台保持可用。纯函数。
 */
export function computeUnavailablePlatforms(
  statuses: Readonly<Record<CredentialPlatformId, CredentialConfigStatus>>,
): CredentialPlatformId[] {
  return (Object.keys(statuses) as CredentialPlatformId[]).filter(
    (platform) => statuses[platform] === 'unfilled',
  );
}

/** 判定某平台在给定状态下是否可用（需求 1.4、1.5）。 */
export function isPlatformAvailable(status: CredentialConfigStatus): boolean {
  return status === 'filled';
}
