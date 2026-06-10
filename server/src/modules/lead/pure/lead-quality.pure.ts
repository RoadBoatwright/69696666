/**
 * 留资质量闸门纯函数库（组件 8，需求 14.9-14.12）。
 *
 * 无副作用、仅依赖入参，覆盖：
 *  - 邮箱 / 电话格式校验（需求 14.9）；
 *  - 一次性 / 临时邮箱域名识别（需求 14.9、14.10）；
 *  - 明显无效占位值识别（全 0 电话、测试字样等，需求 14.9、14.10）；
 *  - 机器人 / 批量提交反作弊（同源短时高频、字段内容雷同，需求 14.11）；
 *  - 企业身份初判（公司名 + 企业邮箱域名，需求 14.12）。
 *
 * 低质量 / 疑似作弊判定结果由调用方据此区分存储、不计入有效线索。
 */
import {
  type EnterpriseIdentity,
  type LeadQualityAssessment,
  type LeadQualityFlag,
  type LeadSubmission,
} from '../domain/lead';

/** RFC 5322 简化邮箱格式（需求 14.9）。 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 一次性 / 临时邮箱域名清单（需求 14.9、14.10）。
 *
 * 命中后该留资标记为「低质量/疑似无效」。生产可经配置扩展，此处内置常见域名。
 */
export const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.info',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'trashmail.com',
  'yopmail.com',
  'getnada.com',
  'throwawaymail.com',
  'maildrop.cc',
  'dispostable.com',
  'fakeinbox.com',
  'sharklasers.com',
  'mailnesia.com',
]);

/**
 * 免费 / 个人邮箱域名清单（需求 14.12）。
 *
 * 命中且无可识别企业身份特征时，企业身份初判为「疑似个人/免费邮箱」。
 */
export const FREE_EMAIL_DOMAINS = new Set<string>([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'aol.com',
  'icloud.com',
  'protonmail.com',
  'gmx.com',
  'mail.com',
  'qq.com',
  '163.com',
  '126.com',
  'foxmail.com',
  'sina.com',
]);

/** 无效占位字样（小写匹配，需求 14.9、14.10）。 */
const PLACEHOLDER_TOKENS = [
  'test',
  'testing',
  'asdf',
  'qwerty',
  'demo',
  'sample',
  'example',
  'none',
  'n/a',
  'na',
  'xxx',
  'aaa',
  'fake',
  'noname',
  'nobody',
];

/** 校验邮箱格式（需求 14.9）。 */
export function isValidEmailFormat(email: string | null | undefined): boolean {
  if (typeof email !== 'string') {
    return false;
  }
  const trimmed = email.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && EMAIL_PATTERN.test(trimmed);
}

/**
 * 校验电话号码格式与国家区号（需求 14.9）。
 *
 * 接受 E.164 风格（可选前导 +）与常见分隔符；归一化后须为 7-15 位数字，
 * 且非全相同数字（如全 0）。
 */
export function isValidPhoneFormat(phone: string | null | undefined): boolean {
  if (typeof phone !== 'string') {
    return false;
  }
  const trimmed = phone.trim();
  // 允许数字、空格、+、-、()。
  if (!/^\+?[\d\s\-()]+$/.test(trimmed)) {
    return false;
  }
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    return false;
  }
  // 全相同数字（含全 0）视为无效占位（需求 14.9）。
  if (/^(\d)\1+$/.test(digits)) {
    return false;
  }
  return true;
}

/** 提取邮箱域名（小写），无法解析返回 null。 */
export function extractEmailDomain(email: string | null | undefined): string | null {
  if (typeof email !== 'string') {
    return null;
  }
  const at = email.trim().toLowerCase().lastIndexOf('@');
  if (at < 0) {
    return null;
  }
  const domain = email
    .trim()
    .toLowerCase()
    .slice(at + 1);
  return domain.length > 0 ? domain : null;
}

/** 判定是否命中一次性 / 临时邮箱域名（需求 14.9、14.10）。 */
export function isDisposableEmail(email: string | null | undefined): boolean {
  const domain = extractEmailDomain(email);
  return domain != null && DISPOSABLE_EMAIL_DOMAINS.has(domain);
}

/** 判定单个字段值是否为明显无效占位值（需求 14.9、14.10）。 */
export function isPlaceholderValue(value: string | null | undefined): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  // 纯重复单字符（如 aaaa、0000）。
  if (/^(.)\1+$/.test(normalized)) {
    return true;
  }
  // 命中测试 / 占位字样（整体相等或以其为完整词）。
  return PLACEHOLDER_TOKENS.some(
    (token) => normalized === token || new RegExp(`\\b${token}\\b`).test(normalized),
  );
}

/**
 * 企业身份初判（需求 14.12）。
 *
 * - 邮箱域名为企业域名（非免费/一次性）且公司名非空 → 「疑似真实企业」。
 * - 邮箱域名为免费/个人域名，或缺乏企业特征 → 「疑似个人/免费邮箱」。
 *
 * @returns 初判标注；无法判定（无邮箱）时返回 null。
 */
export function judgeEnterpriseIdentity(
  submission: Pick<LeadSubmission, 'companyName' | 'email'>,
): EnterpriseIdentity | null {
  const domain = extractEmailDomain(submission.email);
  if (domain == null) {
    return null;
  }
  const isFreeOrDisposable = FREE_EMAIL_DOMAINS.has(domain) || DISPOSABLE_EMAIL_DOMAINS.has(domain);
  const hasCompany =
    typeof submission.companyName === 'string' && submission.companyName.trim().length > 0;
  if (!isFreeOrDisposable && hasCompany) {
    return '疑似真实企业';
  }
  return '疑似个人/免费邮箱';
}

/**
 * 计算单条留资的格式 / 有效性 / 企业身份质量标记（不含批量反作弊上下文）。
 *
 * 反作弊（同源高频 / 内容雷同，需求 14.11）依赖跨留资上下文，由
 * {@link assessBatchAntiFraud} 在批量回流时补充。
 */
export function assessLeadQuality(submission: LeadSubmission): LeadQualityAssessment {
  const flags: LeadQualityFlag[] = [];

  // 邮箱格式 / 一次性域名（需求 14.9、14.10）。
  if (!isValidEmailFormat(submission.email)) {
    flags.push('email_format_invalid');
  } else if (isDisposableEmail(submission.email)) {
    flags.push('disposable_email');
  }

  // 电话格式（需求 14.9）。
  if (!isValidPhoneFormat(submission.phone)) {
    flags.push('phone_format_invalid');
  }

  // 无效占位值：公司名 / 姓名 / 邮箱本地部分（需求 14.9、14.10）。
  const localPart =
    typeof submission.email === 'string' ? submission.email.split('@')[0] : undefined;
  if (
    isPlaceholderValue(submission.companyName) ||
    isPlaceholderValue(submission.name) ||
    isPlaceholderValue(localPart)
  ) {
    flags.push('placeholder_value');
  }

  const enterpriseIdentity = judgeEnterpriseIdentity(submission);
  const isValidLead = flags.length === 0;

  return {
    qualityStatus: isValidLead ? '高质量' : '低质量/疑似无效',
    isValidLead,
    enterpriseIdentity,
    flags,
  };
}

/** 批量反作弊配置（需求 14.11）。 */
export interface AntiFraudOptions {
  /** 同源高频提交时间窗口（毫秒）。默认 60_000（1 分钟）。 */
  windowMs?: number;
  /** 窗口内同源提交数达到该阈值即判为高频。默认 5。 */
  highFrequencyThreshold?: number;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_HIGH_FREQUENCY_THRESHOLD = 5;

/**
 * 对一批回流留资执行机器人 / 批量提交反作弊判定（需求 14.11，纯函数）。
 *
 * 命中规则：
 *  - 同一来源（sourcePlatform + sourceAdId）在时间窗口内提交数达阈值 → 高频（bot_high_frequency）。
 *  - 字段内容雷同（公司名 + 姓名 + 电话 + 邮箱归一化后完全相同）出现多次 → 雷同批量（bot_duplicate_content）。
 *
 * @returns 与输入等长的命中标记数组（每项为该留资命中的反作弊标记集合）。
 */
export function assessBatchAntiFraud(
  submissions: LeadSubmission[],
  options: AntiFraudOptions = {},
): LeadQualityFlag[][] {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const threshold = options.highFrequencyThreshold ?? DEFAULT_HIGH_FREQUENCY_THRESHOLD;

  const n = submissions.length;
  const result: LeadQualityFlag[][] = Array.from({ length: n }, () => []);

  // 内容雷同：按归一化内容指纹分组。
  const contentGroups = new Map<string, number[]>();
  // 同源分组：按来源分组，组内按时间排序做滑窗。
  const sourceGroups = new Map<string, number[]>();

  submissions.forEach((s, i) => {
    const fp = contentFingerprint(s);
    pushToGroup(contentGroups, fp, i);
    const src = `${s.sourcePlatform}::${s.sourceAdId ?? ''}`;
    pushToGroup(sourceGroups, src, i);
  });

  // 雷同批量：同一内容指纹出现 >= 2 次，组内全部命中（需求 14.11）。
  for (const indices of contentGroups.values()) {
    if (indices.length >= 2) {
      for (const i of indices) {
        result[i].push('bot_duplicate_content');
      }
    }
  }

  // 同源高频：滑动时间窗口内提交数达阈值，窗口内成员命中（需求 14.11）。
  for (const indices of sourceGroups.values()) {
    if (indices.length < threshold) {
      continue;
    }
    const sorted = [...indices].sort(
      (a, b) => submissions[a].collectedAt.getTime() - submissions[b].collectedAt.getTime(),
    );
    let start = 0;
    const hits = new Set<number>();
    for (let end = 0; end < sorted.length; end += 1) {
      const endTime = submissions[sorted[end]].collectedAt.getTime();
      while (endTime - submissions[sorted[start]].collectedAt.getTime() > windowMs) {
        start += 1;
      }
      if (end - start + 1 >= threshold) {
        for (let k = start; k <= end; k += 1) {
          hits.add(sorted[k]);
        }
      }
    }
    for (const i of hits) {
      if (!result[i].includes('bot_high_frequency')) {
        result[i].push('bot_high_frequency');
      }
    }
  }

  return result;
}

/** 归一化内容指纹，用于识别字段雷同的批量提交（需求 14.11）。 */
function contentFingerprint(s: LeadSubmission): string {
  const norm = (v: string | null | undefined): string =>
    typeof v === 'string' ? v.trim().toLowerCase() : '';
  return [norm(s.companyName), norm(s.name), norm(s.phone), norm(s.email)].join('|');
}

function pushToGroup<K>(map: Map<K, number[]>, key: K, index: number): void {
  const arr = map.get(key);
  if (arr) {
    arr.push(index);
  } else {
    map.set(key, [index]);
  }
}
