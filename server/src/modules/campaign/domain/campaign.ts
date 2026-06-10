/**
 * 广告计划服务领域类型（组件 6，需求 8、10、12、13）。
 *
 * 平台无关的三级 CRUD 输入/校验、预算出价排期、受众定向与投放编排领域定义，
 * 被 {@link ../campaign.service} 与各纯函数库（{@link ../pure/campaign-validation.pure}、
 * {@link ../pure/publish.pure}）共用。
 */
import type { BiddingStrategy, Gender, PlatformId } from '../../unified-model/domain/unified-model';
import type { CampaignPublishStatus } from '../entities/campaign.entity';

export type { BiddingStrategy, Gender, PlatformId, CampaignPublishStatus };

// ---------------------------------------------------------------------------
// 约束常量（需求 8.2、8.8、12.1、10.1）
// ---------------------------------------------------------------------------

/** 广告系列名称长度下限（需求 8.2）。 */
export const NAME_MIN_LENGTH = 1;
/** 广告系列名称长度上限（需求 8.2）。 */
export const NAME_MAX_LENGTH = 255;
/** 单父级下子级数量上限（需求 8.8）：单系列广告组数、单广告组广告数均 ≤ 5000。 */
export const MAX_CHILDREN_PER_PARENT = 5000;
/** 预算取值下限（需求 12.1）。 */
export const BUDGET_MIN = 0.01;
/** 预算取值上限（需求 12.1）。 */
export const BUDGET_MAX = 999_999_999.99;
/** 年龄取值下限（需求 10.1）。 */
export const AGE_MIN = 13;
/** 年龄取值上限（需求 10.1）。 */
export const AGE_MAX = 65;
/** 性别取值域（需求 10.1）。 */
export const GENDERS: readonly Gender[] = ['男', '女', '不限'];

// ---------------------------------------------------------------------------
// 校验错误（需求 8.6、8.7、8.8、12.4-12.7、10.6、10.7）
// ---------------------------------------------------------------------------

/** 校验错误原因分类（与需求文案对齐的稳定标识）。 */
export type CampaignErrorCode =
  | 'required_missing' // 必填字段缺失（需求 8.7）
  | 'name_length' // 名称长度越界（需求 8.2）
  | 'parent_not_found' // 父级对象不存在（需求 8.6）
  | 'count_limit_exceeded' // 数量超过上限（需求 8.8）
  | 'budget_out_of_range' // 预算超出允许范围（需求 12.5）
  | 'daily_exceeds_total' // 日预算大于总预算（需求 12.6）
  | 'schedule_invalid' // 排期时间无效（需求 12.4）
  | 'bidding_unsupported' // 出价方式不受支持（需求 12.7）
  | 'audience_out_of_range' // 受众取值越界/非法（需求 10.7）
  | 'audience_too_small'; // 受众规模过小（需求 10.6）

/** 单条校验错误（含字段名与原因分类，需求 8.7）。 */
export interface CampaignValidationError {
  /** 涉及的字段名（如 `name`、`dailyBudget`、`ageMin`）。 */
  field: string;
  /** 原因分类。 */
  code: CampaignErrorCode;
  /** 面向用户的中文提示文案（与需求文案一致）。 */
  message: string;
}

// ---------------------------------------------------------------------------
// 三级 CRUD 输入（需求 8.2、8.3）
// ---------------------------------------------------------------------------

/** 创建广告系列输入（需求 8.2）。 */
export interface CreateCampaignInput {
  merchantId: string;
  /** 名称，长度 1-255（需求 8.2）。 */
  name: string;
  /** 投放目标（需求 8.2，必填）。 */
  objective: string;
  /** 所属平台（需求 8.2，必填）。 */
  platform: PlatformId;
}

/** 创建广告组输入（需求 8.3）。 */
export interface CreateAdGroupInput {
  /** 父级广告系列标识（必须已存在，需求 8.6）。 */
  campaignId: string;
}

/** 创建广告输入（需求 8.3）。 */
export interface CreateAdInput {
  /** 父级广告组标识（必须已存在，需求 8.6）。 */
  adGroupId: string;
}

// ---------------------------------------------------------------------------
// 预算/出价/排期输入（需求 12.1-12.7）
// ---------------------------------------------------------------------------

/** 预算/出价/排期设置输入（需求 12.1-12.7）。 */
export interface BudgetScheduleInput {
  /** 日预算，0.01-999,999,999.99（需求 12.1）。 */
  dailyBudget: number;
  /** 总预算，0.01-999,999,999.99（需求 12.1）。 */
  totalBudget: number;
  /** 出价方式，须被目标平台支持（需求 12.7）。 */
  biddingStrategy: BiddingStrategy;
  /** 目标类出价的目标值（如 Target CPA/ROAS），可空。 */
  biddingTargetValue?: number | null;
  /** 投放排期开始时间（需求 12.3）。 */
  startAt?: Date | null;
  /** 投放排期结束时间，不早于开始（需求 12.3、12.4）。 */
  endAt?: Date | null;
}

// ---------------------------------------------------------------------------
// 受众定向输入（需求 10.1-10.9）
// ---------------------------------------------------------------------------

/**
 * 受众定向配置输入（需求 10.1、10.2、10.8、10.9）。
 *
 * 核心维度国家/地区 + 行业 + 职位（买家画像），叠加年龄/性别/兴趣/行为，
 * 自定义/相似受众，排除/负向定向，以及以高意向商机为种子的相似受众扩展。
 */
export interface TargetingInput {
  /** 国家/地区定向（核心维度，需求 10.1）。 */
  geo?: unknown;
  /** 行业定向（核心维度，需求 10.1）。 */
  industry?: unknown;
  /** 职位定向（核心维度，需求 10.1）。 */
  jobRole?: unknown;
  /** 年龄下限，13-65（需求 10.1）。 */
  ageMin?: number | null;
  /** 年龄上限，13-65（需求 10.1）。 */
  ageMax?: number | null;
  /** 性别，限「男|女|不限」（需求 10.1）。 */
  gender?: Gender | null;
  /** 兴趣定向（需求 10.1）。 */
  interests?: unknown;
  /** 行为定向（需求 10.1）。 */
  behaviors?: unknown;
  /** 自定义受众（需求 10.2）。 */
  customAudiences?: unknown;
  /** 相似受众（需求 10.2）。 */
  lookalikeAudiences?: unknown;
  /** 排除定向（需求 10.8）：滤除低意向人群（学生/求职者等）。 */
  excludedAudiences?: unknown;
  /** 负向受众条件（需求 10.8）。 */
  negativeTargeting?: unknown;
  /**
   * 以高意向商机为种子创建相似受众的种子商机标识集合（需求 10.9）。
   * 非空时表示请求基于历史高意向商机扩展相似受众。
   */
  lookalikeSeedOpportunityIds?: string[];
}

// ---------------------------------------------------------------------------
// 投放编排（需求 13.1-13.6）
// ---------------------------------------------------------------------------

/** 投放编排输入选项（需求 13.1-13.5）。 */
export interface PublishOptions {
  /** 平台广告账户标识；缺省时由授权关系派生。 */
  accountId?: string;
  /** 平台响应超时阈值（毫秒），缺省 30 秒（需求 13.2、13.5）。 */
  timeoutMs?: number;
}

/** 投放编排结果（需求 13.1-13.6）。 */
export interface PublishResultOutcome {
  /** 是否被接受发起投放（被阻止/拒绝重复时为 false）。 */
  accepted: boolean;
  /** 投放后的状态机当前状态。 */
  status: CampaignPublishStatus;
  /** 平台返回的广告对象标识（成功时）。 */
  platformObjectId?: string | null;
  /** 被阻止/失败/超时时的原因提示。 */
  reason?: string;
}
