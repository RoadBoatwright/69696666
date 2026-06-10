/**
 * 统一模型映射纯函数库（组件 3，需求 8.4、8.5、8.7、10.4、33）。
 *
 * 无副作用，仅依赖入参，使「映射往返一致」「默认值/不适用标记」「映射校验失败分类」
 * 「版位二选一」等不变量可被属性测试覆盖（Property 11/12/13/14/51）。
 */
import { getFieldSpecs, type FieldSpec } from '../domain/field-map';
import type {
  AdLevel,
  MapToNativeResult,
  MappingValidationError,
  PlacementMode,
  PlatformId,
  UnifiedAdObject,
} from '../domain/unified-model';

/**
 * 校验三级结构父级唯一性（需求 8.1）。
 *
 * - campaign：不得有父级。
 * - adgroup/ad：必有且仅有一个父级（parentId 为非空字符串）。
 */
export function hasUniqueParent(obj: UnifiedAdObject): boolean {
  if (obj.level === 'campaign') {
    return obj.parentId === undefined || obj.parentId === null;
  }
  return typeof obj.parentId === 'string' && obj.parentId.length > 0;
}

/**
 * 统一对象 → 平台原生字段映射（需求 8.4、8.5、8.7、10.4）。
 *
 * 处理流程（对该层级的每个字段规格）：
 *  1. 必填校验：必填字段缺失 → required_missing（需求 8.7）。
 *  2. 取值校验：提供了值则按 spec.validate 校验，失败按分类记错（需求 8.7、10.7）。
 *  3. 映射：
 *     - 该平台有 nativeKey → 写入原生字段。
 *     - 无 nativeKey 但有 defaultValue → 应用平台默认值并记入 appliedDefaults（需求 8.5）。
 *     - 无 nativeKey 且无 defaultValue → 记入 notApplicable（需求 8.5、10.4）。
 *
 * 任一字段校验失败即返回包含全部错误的失败结果，不提交至目标平台（需求 8.7）。
 */
export function mapToNative(platform: PlatformId, unified: UnifiedAdObject): MapToNativeResult {
  const specs = getFieldSpecs(unified.level);
  const errors: MappingValidationError[] = [];
  const native: Record<string, unknown> = {};
  const appliedDefaults: string[] = [];
  const notApplicable: string[] = [];

  for (const spec of specs) {
    const present = Object.prototype.hasOwnProperty.call(unified.fields, spec.field);
    const value = unified.fields[spec.field];
    const hasValue = present && value !== undefined && value !== null;

    // 1) 必填校验。
    if (spec.required && !hasValue) {
      errors.push({ field: spec.field, reason: 'required_missing' });
      continue;
    }

    // 2) 取值校验（仅在提供了值时）。
    if (hasValue && spec.validate) {
      const result = spec.validate(value);
      if (result) {
        errors.push({ field: spec.field, reason: result.reason, detail: result.detail });
        continue;
      }
    }

    // 未提供值且非必填：不映射，跳过（不计入默认值/不适用）。
    if (!hasValue) {
      continue;
    }

    // 3) 映射。
    const platformMapping = spec.platforms[platform];
    if (platformMapping?.nativeKey) {
      native[platformMapping.nativeKey] = value;
    } else if (platformMapping && 'defaultValue' in platformMapping) {
      native[spec.field] = platformMapping.defaultValue;
      appliedDefaults.push(spec.field);
    } else {
      // 该平台无对应原生字段且无默认值 → 不适用（需求 8.5、10.4）。
      notApplicable.push(spec.field);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, native, appliedDefaults, notApplicable };
}

/**
 * 平台原生字段 → 统一对象映射（需求 8.4）。
 *
 * 用于映射往返一致（Property 12）：仅还原通过 nativeKey 映射写入的字段，
 * 被默认值填充或被标不适用的字段不参与往返（其在 mapToNative 中不来源于统一字段值）。
 */
export function mapFromNative(
  platform: PlatformId,
  level: AdLevel,
  native: Record<string, unknown>,
  parentId?: string,
): UnifiedAdObject {
  const specs = getFieldSpecs(level);
  const fields: Record<string, unknown> = {};

  for (const spec of specs) {
    const nativeKey = spec.platforms[platform]?.nativeKey;
    if (nativeKey && Object.prototype.hasOwnProperty.call(native, nativeKey)) {
      fields[spec.field] = native[nativeKey];
    }
  }

  const obj: UnifiedAdObject = { level, fields };
  if (parentId !== undefined) {
    obj.parentId = parentId;
  }
  return obj;
}

/**
 * 计算某统一对象在某平台经 nativeKey 映射的「可往返字段」子集（需求 8.4）。
 *
 * 即排除被默认值填充与被标不适用的字段后剩余的统一字段，供往返一致性比较。
 */
export function roundTripFields(
  platform: PlatformId,
  unified: UnifiedAdObject,
): Record<string, unknown> {
  const specs = getFieldSpecs(unified.level);
  const result: Record<string, unknown> = {};
  for (const spec of specs) {
    const hasValue =
      Object.prototype.hasOwnProperty.call(unified.fields, spec.field) &&
      unified.fields[spec.field] !== undefined &&
      unified.fields[spec.field] !== null;
    if (hasValue && spec.platforms[platform]?.nativeKey) {
      result[spec.field] = unified.fields[spec.field];
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 广告版位（自动/手动二选一，需求 33.1、33.4、33.7）
// ---------------------------------------------------------------------------

/** 版位配置（自动/手动二选一）。 */
export interface PlacementConfig {
  mode: PlacementMode;
  /** 手动版位下用户所选版位集合；自动版位下必须为空（需求 33.3、33.4）。 */
  selectedPlacements?: string[];
  /**
   * 广告系列为 Meta Advantage+（需求 23）或 Google Performance Max（需求 25）系列时为 true，
   * 强制将版位配置方式置为「自动版位」并由平台全自动版位优化承担选择（需求 33.7）。
   */
  forceAuto?: boolean;
}

/** 版位校验结果（成功结果含归一化后的生效配置方式与所选版位）。 */
export type PlacementValidation =
  | {
      ok: true;
      mode: PlacementMode;
      selectedPlacements: string[];
      /** 是否对用户输入做了归一化（空手动降级或强制自动）。 */
      coerced: boolean;
    }
  | { ok: false; reason: string };

/**
 * 校验并归一化版位配置的「二选一」不变量（需求 33.1、33.4、33.7）。
 *
 * 任一时刻有且仅有一个配置方式生效（需求 33.1）：
 *  - mode 必须为 'auto' 或 'manual' 之一，否则拒绝。
 *  - `forceAuto` 为真（Advantage+/PMax 系列）→ 强制「自动版位」、清空所选版位（需求 33.7）。
 *  - 'auto'：selectedPlacements 必须为空（由平台自动选择全场景版位，需求 33.2）。
 *  - 'manual' 且所选非空：保留为「手动版位」（需求 33.3）。
 *  - 'manual' 但所选为空：降级为「自动版位」（需求 33.4），而非报错。
 *
 * 返回 `coerced` 标识是否对用户输入做过归一化（空手动降级或强制自动）。
 */
export function validatePlacement(config: PlacementConfig): PlacementValidation {
  if (config.mode !== 'auto' && config.mode !== 'manual') {
    return { ok: false, reason: '版位配置方式必须为 auto 或 manual 二者之一' };
  }
  const selected = config.selectedPlacements ?? [];

  // 需求 33.7：Advantage+/PMax 系列强制自动版位，覆盖用户输入。
  if (config.forceAuto) {
    return {
      ok: true,
      mode: 'auto',
      selectedPlacements: [],
      coerced: config.mode !== 'auto' || selected.length > 0,
    };
  }

  if (config.mode === 'auto') {
    if (selected.length > 0) {
      return { ok: false, reason: '自动版位下不得显式选择版位' };
    }
    return { ok: true, mode: 'auto', selectedPlacements: [], coerced: false };
  }

  // 需求 33.4：手动版位但所选集合为空 → 降级为自动版位。
  if (selected.length === 0) {
    return { ok: true, mode: 'auto', selectedPlacements: [], coerced: true };
  }
  return { ok: true, mode: 'manual', selectedPlacements: selected, coerced: false };
}

/**
 * 在目标平台上解析手动所选版位，区分受支持与不适用版位（需求 33.5、33.6）。
 *
 * 复用「不适用」机制：不被目标平台支持的所选版位标记为该平台不适用，
 * 而非报错中断。纯函数。
 */
export function resolvePlacementsForPlatform(
  selected: readonly string[],
  supported: readonly string[],
): { applied: string[]; notApplicable: string[] } {
  const applied: string[] = [];
  const notApplicable: string[] = [];
  for (const p of selected) {
    if (supported.includes(p)) {
      applied.push(p);
    } else {
      notApplicable.push(p);
    }
  }
  return { applied, notApplicable };
}

/** 取得某层级全部字段名（用于诊断与测试）。 */
export function fieldNames(level: AdLevel): string[] {
  return getFieldSpecs(level).map((s: FieldSpec) => s.field);
}
