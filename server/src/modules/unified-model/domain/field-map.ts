/**
 * 统一字段↔平台原生字段映射表（组件 3，需求 8.4、8.5、8.7、33）。
 *
 * 每个统一字段在每个平台上声明：
 *  - `nativeKey`：目标平台原生字段名；缺失（undefined）表示该平台无对应原生字段。
 *  - `defaultValue`：当目标平台无对应原生字段但存在平台默认值时应用（需求 8.5）。
 *  - 当目标平台无对应原生字段且无默认值时，该字段标记为「该平台不适用」（需求 8.5、10.4）。
 *
 * 校验规则（必填/取值域/格式）由 {@link FieldSpec.validate} 表达，跨平台共享，
 * 失败时归入 {@link MappingErrorReason} 分类（需求 8.7）。
 *
 * 新增平台扩展能力或新平台映射不改动既有 Meta/Google/TikTok 字段定义（需求 8.9、22.5）。
 */
import type { AdLevel, BiddingStrategy, MappingErrorReason, PlatformId } from './unified-model';
import { ACTIVE_PLATFORMS, BIDDING_STRATEGIES } from './unified-model';

/** 单字段在单平台上的映射定义。 */
export interface PlatformFieldMapping {
  /** 目标平台原生字段名；undefined 表示该平台无对应原生字段。 */
  nativeKey?: string;
  /** 平台默认值；当无 nativeKey 但有默认值时应用（需求 8.5）。 */
  defaultValue?: unknown;
}

/** 字段校验结果：null 表示通过，否则给出失败原因分类。 */
export type FieldValidation = { reason: MappingErrorReason; detail?: string } | null;

/** 单个统一字段的规格（含层级、是否必填、校验与各平台映射）。 */
export interface FieldSpec {
  /** 统一字段名。 */
  field: string;
  /** 所属层级。 */
  level: AdLevel;
  /** 是否必填（缺失时返回 required_missing，需求 8.7）。 */
  required: boolean;
  /** 取值校验纯函数；返回 null 通过，否则返回失败原因分类。 */
  validate?: (value: unknown) => FieldValidation;
  /** 各平台映射定义。 */
  platforms: Partial<Record<PlatformId, PlatformFieldMapping>>;
}

// ---------------------------------------------------------------------------
// 通用校验器
// ---------------------------------------------------------------------------

/** 非空字符串且长度在 [min,max]（需求 8.2 名称 1-255）。 */
function stringLength(min: number, max: number): (value: unknown) => FieldValidation {
  return (value) => {
    if (typeof value !== 'string') {
      return { reason: 'invalid_format', detail: '必须为字符串' };
    }
    if (value.length < min || value.length > max) {
      return { reason: 'out_of_range', detail: `长度需在 ${min}-${max}` };
    }
    return null;
  };
}

/** 整数且在 [min,max]（需求 10.1 年龄 13-65）。 */
function intRange(min: number, max: number): (value: unknown) => FieldValidation {
  return (value) => {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return { reason: 'invalid_format', detail: '必须为整数' };
    }
    if (value < min || value > max) {
      return { reason: 'out_of_range', detail: `取值需在 ${min}-${max}` };
    }
    return null;
  };
}

/** 取值属于枚举集合，否则 unsupported_value。 */
function enumOf<T>(allowed: readonly T[]): (value: unknown) => FieldValidation {
  return (value) => {
    if (!allowed.includes(value as T)) {
      return { reason: 'unsupported_value', detail: `取值需属于 [${allowed.join(', ')}]` };
    }
    return null;
  };
}

/** 性别取值校验。 */
const genderValidator = enumOf<string>(['男', '女', '不限']);

/** 出价策略取值校验（统一枚举层，平台支持集校验在适配器，需求 12.7）。 */
const biddingValidator = enumOf<BiddingStrategy>(BIDDING_STRATEGIES);

// ---------------------------------------------------------------------------
// 字段映射表
// ---------------------------------------------------------------------------

/**
 * 全量统一字段规格表。
 *
 * 设计要点：
 *  - 三平台核心字段（name/objective/geo/age/gender 等）均有原生映射。
 *  - `interests`（兴趣定向）在 Google 搜索广告无对应原生字段且无默认值 →
 *    标「该平台不适用」（需求 10.4）。
 *  - `bidStrategy` 在各平台均有原生键，平台支持集差异由适配器校验。
 */
export const FIELD_SPECS: readonly FieldSpec[] = [
  // ---- 广告系列层 ----
  {
    field: 'name',
    level: 'campaign',
    required: true,
    validate: stringLength(1, 255),
    platforms: {
      meta: { nativeKey: 'name' },
      google: { nativeKey: 'name' },
      tiktok: { nativeKey: 'campaign_name' },
    },
  },
  {
    field: 'objective',
    level: 'campaign',
    required: true,
    validate: stringLength(1, 64),
    platforms: {
      meta: { nativeKey: 'objective' },
      google: { nativeKey: 'advertising_channel_type' },
      tiktok: { nativeKey: 'objective_type' },
    },
  },
  {
    // 特殊广告类别：Meta 有原生字段，Google/TikTok 无对应但有平台默认值（需求 8.5）。
    field: 'specialAdCategory',
    level: 'campaign',
    required: false,
    platforms: {
      meta: { nativeKey: 'special_ad_categories' },
      google: { defaultValue: 'NONE' },
      tiktok: { defaultValue: 'NONE' },
    },
  },

  // ---- 广告组层 ----
  {
    field: 'dailyBudget',
    level: 'adgroup',
    required: true,
    validate: budgetValidator,
    platforms: {
      meta: { nativeKey: 'daily_budget' },
      google: { nativeKey: 'campaign_budget' },
      tiktok: { nativeKey: 'budget' },
    },
  },
  {
    field: 'bidStrategy',
    level: 'adgroup',
    required: true,
    validate: biddingValidator,
    platforms: {
      meta: { nativeKey: 'bid_strategy' },
      google: { nativeKey: 'bidding_strategy_type' },
      tiktok: { nativeKey: 'bid_type' },
    },
  },
  {
    field: 'ageMin',
    level: 'adgroup',
    required: false,
    validate: intRange(13, 65),
    platforms: {
      meta: { nativeKey: 'age_min' },
      google: { nativeKey: 'age_range_min' },
      tiktok: { nativeKey: 'age_groups_min' },
    },
  },
  {
    field: 'ageMax',
    level: 'adgroup',
    required: false,
    validate: intRange(13, 65),
    platforms: {
      meta: { nativeKey: 'age_max' },
      google: { nativeKey: 'age_range_max' },
      tiktok: { nativeKey: 'age_groups_max' },
    },
  },
  {
    field: 'gender',
    level: 'adgroup',
    required: false,
    validate: genderValidator,
    platforms: {
      meta: { nativeKey: 'genders' },
      google: { nativeKey: 'gender' },
      tiktok: { nativeKey: 'gender' },
    },
  },
  {
    // 兴趣定向：Google 搜索广告无对应原生字段且无默认值 → 标「该平台不适用」（需求 10.4）。
    field: 'interests',
    level: 'adgroup',
    required: false,
    platforms: {
      meta: { nativeKey: 'flexible_spec' },
      tiktok: { nativeKey: 'interest_category_ids' },
      // google：无 nativeKey、无 defaultValue → 不适用。
    },
  },

  // ---- 广告层 ----
  {
    field: 'creativeName',
    level: 'ad',
    required: true,
    validate: stringLength(1, 255),
    platforms: {
      meta: { nativeKey: 'name' },
      google: { nativeKey: 'ad_name' },
      tiktok: { nativeKey: 'ad_name' },
    },
  },
  {
    field: 'landingUrl',
    level: 'ad',
    required: false,
    validate: urlValidator,
    platforms: {
      meta: { nativeKey: 'link_url' },
      google: { nativeKey: 'final_urls' },
      tiktok: { nativeKey: 'landing_page_url' },
    },
  },
];

/** 预算取值校验（需求 12.1：0.01-999,999,999.99，两位小数）。 */
function budgetValidator(value: unknown): FieldValidation {
  const num = typeof value === 'string' ? Number(value) : value;
  if (typeof num !== 'number' || Number.isNaN(num)) {
    return { reason: 'invalid_format', detail: '必须为数值' };
  }
  if (num < 0.01 || num > 999999999.99) {
    return { reason: 'out_of_range', detail: '预算需在 0.01-999,999,999.99' };
  }
  // 两位小数校验。
  if (Math.round(num * 100) !== num * 100) {
    return { reason: 'invalid_format', detail: '最多两位小数' };
  }
  return null;
}

/** URL 格式校验。 */
function urlValidator(value: unknown): FieldValidation {
  if (typeof value !== 'string') {
    return { reason: 'invalid_format', detail: '必须为字符串' };
  }
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { reason: 'invalid_format', detail: '需为 http/https URL' };
    }
    return null;
  } catch {
    return { reason: 'invalid_format', detail: 'URL 格式不合法' };
  }
}

/** 按层级索引的字段规格表（构建一次，供纯函数复用）。 */
const SPECS_BY_LEVEL: Record<AdLevel, FieldSpec[]> = {
  campaign: FIELD_SPECS.filter((s) => s.level === 'campaign'),
  adgroup: FIELD_SPECS.filter((s) => s.level === 'adgroup'),
  ad: FIELD_SPECS.filter((s) => s.level === 'ad'),
};

/** 取得某层级的全部字段规格。 */
export function getFieldSpecs(level: AdLevel): readonly FieldSpec[] {
  return SPECS_BY_LEVEL[level];
}

/** 取得某字段规格（按层级+字段名）。 */
export function getFieldSpec(level: AdLevel, field: string): FieldSpec | undefined {
  return SPECS_BY_LEVEL[level].find((s) => s.field === field);
}

/** 校验平台标识是否为本期已支持的活跃平台（非 LinkedIn 扩展位）。 */
export function isActivePlatform(platform: PlatformId): boolean {
  return ACTIVE_PLATFORMS.includes(platform);
}
