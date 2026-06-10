/**
 * Gemini 背调纯函数库（组件 9，需求 15.5）。
 */
import {
  VERIFIABLE_FIELDS,
  type RawLead,
  type VerifiableField,
  type VerifiedFieldValue,
} from '../domain/verification';

/** 取非空裁剪值；空白/缺失视为无值。 */
function valueOf(v: string | null | undefined): string | undefined {
  if (typeof v !== 'string') {
    return undefined;
  }
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 合并原始留资与背调返回字段（纯函数，需求 15.5）。
 *
 * - 仅一侧有值：直接采用该侧值，无冲突。
 * - 两侧均有值且一致：无冲突。
 * - 两侧均有值且不一致：同时保留两值，标 conflict + needsReview「待核实」。
 * - 两侧均无值：不产出该字段条目。
 */
export function mergeFields(
  original: Partial<Record<VerifiableField, string>>,
  verified: Partial<Record<VerifiableField, string>>,
): VerifiedFieldValue[] {
  const result: VerifiedFieldValue[] = [];
  for (const field of VERIFIABLE_FIELDS) {
    const originalValue = valueOf(original[field]);
    const verifiedValue = valueOf(verified[field]);
    if (originalValue === undefined && verifiedValue === undefined) {
      continue;
    }
    const conflict =
      originalValue !== undefined && verifiedValue !== undefined && originalValue !== verifiedValue;
    result.push({
      field,
      ...(originalValue !== undefined ? { originalValue } : {}),
      ...(verifiedValue !== undefined ? { verifiedValue } : {}),
      conflict,
      needsReview: conflict,
    });
  }
  return result;
}

/** 将原始留资投影为可背调字段映射。 */
export function leadToVerifiableFields(lead: RawLead): Partial<Record<VerifiableField, string>> {
  const out: Partial<Record<VerifiableField, string>> = {};
  for (const field of VERIFIABLE_FIELDS) {
    const v = valueOf(lead[field]);
    if (v !== undefined) {
      out[field] = v;
    }
  }
  return out;
}
