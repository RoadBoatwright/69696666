/**
 * Gemini 背调服务领域类型（组件 9，需求 15）。
 */
import type { VerifiableField } from '../entities';

export type { VerifiableField };

/** 可背调字段有序列表（需求 15.5）。 */
export const VERIFIABLE_FIELDS: readonly VerifiableField[] = [
  'companyName',
  'phone',
  'email',
  'industry',
  'jobTitle',
];

/** 待背调的原始留资数据（需求 15.2）。 */
export interface RawLead {
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
  industry?: string | null;
  jobTitle?: string | null;
}

/** 字段比对结果（纯值对象，需求 15.5）。 */
export interface VerifiedFieldValue {
  field: VerifiableField;
  originalValue?: string;
  verifiedValue?: string;
  /** 两侧均有值且不一致（需求 15.5）。 */
  conflict: boolean;
  /** 冲突时为真，标「待核实」（需求 15.5）。 */
  needsReview: boolean;
}

/** Gemini 背调推理输出（端口返回值，需求 15.2）。 */
export interface GeminiVerificationOutput {
  /** 背调补全/校正后的字段值。 */
  fields: Partial<Record<VerifiableField, string>>;
  /** 可信度评估 0-100（需求 16.1）。 */
  credibilityScore: number | null;
  /** 背调摘要。 */
  summary: string | null;
}

/** verify 结果分类（需求 15.2-15.4）。 */
export type VerifyOutcome =
  | { outcome: 'completed'; verificationResultId: string; fields: VerifiedFieldValue[] }
  | { outcome: 'unavailable'; verificationResultId: string }
  | { outcome: 'failed'; verificationResultId: string; reason: string };
