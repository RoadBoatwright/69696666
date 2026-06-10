/**
 * 统一广告对象模型领域类型（组件 3，需求 8、10、33）。
 *
 * 以「广告系列→广告组→广告」三级结构表达 Meta/Google/TikTok 的广告对象，
 * 每个子级有且仅有一个父级（需求 8.1）。统一字段与平台原生字段的映射、
 * 默认值与不适用标记、版位（自动/手动二选一）均在本模型与其纯函数库上表达。
 *
 * LinkedIn 仅作为第二期平台扩展位（需求 8.9），不在本期映射定义中。
 */

/** 统一模型支持的平台标识（含 LinkedIn 第二期扩展位，需求 8.9）。 */
export type PlatformId = 'meta' | 'google' | 'tiktok' | 'linkedin';

/** 本期已完整支持映射的平台集合（不含 LinkedIn 扩展位）。 */
export const ACTIVE_PLATFORMS: readonly PlatformId[] = ['meta', 'google', 'tiktok'];

/** 三级结构的层级标识（需求 8.1）。 */
export type AdLevel = 'campaign' | 'adgroup' | 'ad';

/** 统一出价策略枚举（需求 12.2、26.1）；各平台按其支持集校验。 */
export type BiddingStrategy =
  | 'TARGET_CPA'
  | 'TARGET_ROAS'
  | 'MAXIMIZE_CONVERSIONS'
  | 'MAXIMIZE_CONVERSION_VALUE'
  | 'MAXIMIZE_CLICKS'
  | 'MANUAL_CPC';

/** 全部统一出价策略取值（用于校验与生成器）。 */
export const BIDDING_STRATEGIES: readonly BiddingStrategy[] = [
  'TARGET_CPA',
  'TARGET_ROAS',
  'MAXIMIZE_CONVERSIONS',
  'MAXIMIZE_CONVERSION_VALUE',
  'MAXIMIZE_CLICKS',
  'MANUAL_CPC',
];

/** 性别取值域（需求 10.1）。 */
export type Gender = '男' | '女' | '不限';

/** 版位配置方式：自动/手动二选一（需求 33.1、33.4、33.7）。 */
export type PlacementMode = 'auto' | 'manual';

/**
 * 统一广告对象（单层级的字段集合）。
 *
 * `level` 标记该对象所处层级；`fields` 承载统一字段键值；`parentId` 表达
 * 父级唯一关系（campaign 无父级，adgroup/ad 必有且仅有一个父级，需求 8.1）。
 */
export interface UnifiedAdObject {
  /** 对象层级。 */
  level: AdLevel;
  /** 对象唯一标识（已持久化对象具备）。 */
  id?: string;
  /** 父级对象标识；campaign 为 undefined，adgroup/ad 必填且唯一（需求 8.1）。 */
  parentId?: string;
  /** 统一字段键值集合。 */
  fields: Record<string, unknown>;
}

/** 字段映射成功结果（需求 8.4、8.5）。 */
export interface FieldMappingResult {
  ok: true;
  /** 映射后的目标平台原生字段。 */
  native: Record<string, unknown>;
  /** 被应用了平台默认值的统一字段名（需求 8.5）。 */
  appliedDefaults: string[];
  /** 在目标平台不适用、已被标记的统一字段名（需求 8.5、10.4）。 */
  notApplicable: string[];
}

/** 映射校验失败原因分类（需求 8.7、10.7）。 */
export type MappingErrorReason =
  | 'required_missing' // 必填字段缺失
  | 'out_of_range' // 取值越界
  | 'invalid_format' // 格式不符
  | 'unsupported_value'; // 取值不被目标平台支持

/** 单条映射校验错误（含字段名与失败原因分类，需求 8.7）。 */
export interface MappingValidationError {
  /** 统一字段名。 */
  field: string;
  /** 失败原因分类（需求 8.7）。 */
  reason: MappingErrorReason;
  /** 可选的补充说明。 */
  detail?: string;
}

/** 字段映射失败结果（需求 8.7）。 */
export interface FieldMappingFailure {
  ok: false;
  /** 全部校验错误（含字段名与失败原因分类）。 */
  errors: MappingValidationError[];
}

export type MapToNativeResult = FieldMappingResult | FieldMappingFailure;

/** 区分映射结果是否成功的类型守卫。 */
export function isMappingFailure(result: MapToNativeResult): result is FieldMappingFailure {
  return result.ok === false;
}
