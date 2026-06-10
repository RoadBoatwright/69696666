/**
 * 高门槛留资表单与必填校验纯函数库（组件 8，需求 14.1、14.4）。
 *
 * 无副作用、仅依赖入参，使「字段数量 1-30」「公司名/姓名/电话/邮箱恒必填」
 * 「买家提交缺任一必填项即拒绝回流」等不变量可被属性测试覆盖（Property 30）。
 */
import {
  FORM_FIELD_COUNT_MAX,
  FORM_FIELD_COUNT_MIN,
  REQUIRED_LEAD_FIELDS,
  type LeadFormConfigInput,
  type LeadFormValidationError,
  type LeadSubmission,
  type RequiredLeadField,
} from '../domain/lead';

/**
 * 校验高门槛留资表单配置（需求 14.1）。
 *
 * 校验项：
 *  1. 字段数量为 1-30（需求 14.1）。
 *  2. 公司名/姓名/电话/邮箱四项必须存在且标记为必填（需求 14.1）。
 *  3. 字段键不重复。
 *
 * @returns 全部不符合项；空数组表示通过。
 */
export function validateLeadFormConfig(config: LeadFormConfigInput): LeadFormValidationError[] {
  const errors: LeadFormValidationError[] = [];
  const fields = config.fields ?? [];

  // 1) 字段数量 1-30（需求 14.1）。
  if (fields.length < FORM_FIELD_COUNT_MIN || fields.length > FORM_FIELD_COUNT_MAX) {
    errors.push({
      field: 'fields',
      code: 'field_count_out_of_range',
      message: `表单字段项数量需为 ${FORM_FIELD_COUNT_MIN}-${FORM_FIELD_COUNT_MAX} 个`,
    });
  }

  // 3) 字段键不重复。
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.key)) {
      errors.push({
        field: f.key,
        code: 'duplicate_field_key',
        message: `表单字段键「${f.key}」重复`,
      });
    }
    seen.add(f.key);
  }

  // 2) 公司名/姓名/电话/邮箱恒为必填（需求 14.1）。
  const byKey = new Map(fields.map((f) => [f.key, f]));
  for (const required of REQUIRED_LEAD_FIELDS) {
    const def = byKey.get(required);
    if (!def) {
      errors.push({
        field: required,
        code: 'required_field_missing',
        message: `高门槛表单必须包含必填字段「${required}」`,
      });
    } else if (!def.required) {
      errors.push({
        field: required,
        code: 'required_field_not_required',
        message: `字段「${required}」必须标记为必填`,
      });
    }
  }

  return errors;
}

/**
 * 校验买家留资提交的必填项是否齐备（需求 14.4，Property 30）。
 *
 * 公司名/姓名/电话/邮箱任一缺失（未提供或空白）即视为不齐备，由调用方据此拒绝回流。
 *
 * @returns 缺失的必填项集合；空数组表示四项均齐备。
 */
export function findMissingRequiredFields(submission: LeadSubmission): RequiredLeadField[] {
  const missing: RequiredLeadField[] = [];
  for (const key of REQUIRED_LEAD_FIELDS) {
    if (!isNonBlank(submission[key])) {
      missing.push(key);
    }
  }
  return missing;
}

/** 是否为非空白字符串。 */
function isNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
