/**
 * 广告计划校验纯函数库（组件 6，需求 8、10、12）。
 *
 * 无副作用、仅依赖入参，使「名称长度」「数量上限」「预算/出价/排期」「受众取值域」
 * 等不变量可被属性测试覆盖（Property 15/16/17/20/24/25/26/27）。所有校验返回
 * {@link CampaignValidationError} 列表（含字段名 + 原因分类 + 中文文案，需求 8.7）。
 */
import {
  AGE_MAX,
  AGE_MIN,
  BUDGET_MAX,
  BUDGET_MIN,
  GENDERS,
  MAX_CHILDREN_PER_PARENT,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  type BiddingStrategy,
  type BudgetScheduleInput,
  type CampaignValidationError,
  type CreateCampaignInput,
  type Gender,
  type PlatformId,
  type TargetingInput,
} from '../domain/campaign';

/** 本期已支持创建广告系列的活跃平台集合（不含 LinkedIn 第二期扩展位）。 */
const ACTIVE_PLATFORMS: readonly PlatformId[] = ['meta', 'google', 'tiktok'];

// ---------------------------------------------------------------------------
// 名称与三级 CRUD 约束（需求 8.2、8.6、8.8）
// ---------------------------------------------------------------------------

/**
 * 校验广告系列名称长度（需求 8.2，Property 15）。
 *
 * 长度 1-255 接受；缺失/非字符串/长度 0 或超 255 拒绝。
 */
export function validateName(name: unknown): CampaignValidationError | null {
  if (typeof name !== 'string' || name.length < NAME_MIN_LENGTH) {
    return {
      field: 'name',
      code: name === undefined || name === null || name === '' ? 'required_missing' : 'name_length',
      message:
        name === undefined || name === null || name === ''
          ? '名称为必填项'
          : `名称长度需在 ${NAME_MIN_LENGTH}-${NAME_MAX_LENGTH} 之间`,
    };
  }
  if (name.length > NAME_MAX_LENGTH) {
    return {
      field: 'name',
      code: 'name_length',
      message: `名称长度需在 ${NAME_MIN_LENGTH}-${NAME_MAX_LENGTH} 之间`,
    };
  }
  return null;
}

/**
 * 校验创建广告系列输入，返回全部不符合项（需求 8.2、8.7）。
 *
 * 必填字段缺失返回完整缺失集合（merchantId/name/objective/platform），
 * 名称长度越界单独归类，平台非活跃平台归类为 unsupported（required_missing 复用）。
 */
export function validateCreateCampaign(
  input: Partial<CreateCampaignInput>,
): CampaignValidationError[] {
  const errors: CampaignValidationError[] = [];

  if (!isNonEmptyString(input.merchantId)) {
    errors.push({ field: 'merchantId', code: 'required_missing', message: '商家标识为必填项' });
  }

  const nameError = validateName(input.name);
  if (nameError) {
    errors.push(nameError);
  }

  if (!isNonEmptyString(input.objective)) {
    errors.push({ field: 'objective', code: 'required_missing', message: '投放目标为必填项' });
  }

  if (!isNonEmptyString(input.platform)) {
    errors.push({ field: 'platform', code: 'required_missing', message: '所属平台为必填项' });
  } else if (!ACTIVE_PLATFORMS.includes(input.platform as PlatformId)) {
    errors.push({
      field: 'platform',
      code: 'required_missing',
      message: `所属平台需为 ${ACTIVE_PLATFORMS.join('/')} 之一`,
    });
  }

  return errors;
}

/**
 * 校验在父级下创建子级是否超过数量上限（需求 8.8，Property 17）。
 *
 * 当父级下已有子级数量达到 5000 时，创建第 5001 个被拒绝。
 *
 * @param existingChildCount 父级当前已有子级数量。
 * @param childField 子级字段名（`adGroup` 或 `ad`），用于错误定位。
 */
export function validateChildCount(
  existingChildCount: number,
  childField: 'adGroup' | 'ad',
): CampaignValidationError | null {
  if (existingChildCount >= MAX_CHILDREN_PER_PARENT) {
    return {
      field: childField,
      code: 'count_limit_exceeded',
      message: `数量超过上限（${MAX_CHILDREN_PER_PARENT}）`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 预算/出价/排期校验（需求 12.1-12.7）
// ---------------------------------------------------------------------------

/** 单个预算值是否在允许取值域 [0.01, 999,999,999.99] 内（需求 12.1）。 */
function isBudgetInRange(value: number): boolean {
  return Number.isFinite(value) && value >= BUDGET_MIN && value <= BUDGET_MAX;
}

/**
 * 校验预算/出价/排期设置，返回全部不符合项（需求 12.1-12.7）。
 *
 * - 预算取值域：日/总预算须在 0.01-999,999,999.99（需求 12.1、12.5，Property 24）。
 * - 日预算 ≤ 总预算（需求 12.6，Property 25）。
 * - 排期结束不早于开始（需求 12.3、12.4，Property 26）。
 * - 出价方式须被目标平台支持（需求 12.7，Property 27）。
 *
 * @param input 预算/出价/排期输入。
 * @param supportedStrategies 目标平台支持的出价策略集合（由平台适配器提供）。
 */
export function validateBudgetSchedule(
  input: BudgetScheduleInput,
  supportedStrategies: readonly BiddingStrategy[],
): CampaignValidationError[] {
  const errors: CampaignValidationError[] = [];

  if (!isBudgetInRange(input.dailyBudget)) {
    errors.push({
      field: 'dailyBudget',
      code: 'budget_out_of_range',
      message: '预算超出允许范围',
    });
  }
  if (!isBudgetInRange(input.totalBudget)) {
    errors.push({
      field: 'totalBudget',
      code: 'budget_out_of_range',
      message: '预算超出允许范围',
    });
  }

  // 日预算不得大于总预算（仅在两者均为有效数值时判定，需求 12.6）。
  if (
    Number.isFinite(input.dailyBudget) &&
    Number.isFinite(input.totalBudget) &&
    input.dailyBudget > input.totalBudget
  ) {
    errors.push({
      field: 'dailyBudget',
      code: 'daily_exceeds_total',
      message: '日预算不得大于总预算',
    });
  }

  // 排期结束不早于开始（仅在两者均提供时判定，需求 12.4）。
  if (
    input.startAt != null &&
    input.endAt != null &&
    input.endAt.getTime() < input.startAt.getTime()
  ) {
    errors.push({
      field: 'endAt',
      code: 'schedule_invalid',
      message: '排期时间无效',
    });
  }

  // 出价方式须被目标平台支持（需求 12.7）。
  if (!supportedStrategies.includes(input.biddingStrategy)) {
    errors.push({
      field: 'biddingStrategy',
      code: 'bidding_unsupported',
      message: '出价方式不受支持',
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 受众定向取值域校验（需求 10.1、10.7）
// ---------------------------------------------------------------------------

/** 单个年龄值是否为 13-65 的整数（需求 10.1）。 */
function isAgeValid(value: number): boolean {
  return Number.isInteger(value) && value >= AGE_MIN && value <= AGE_MAX;
}

/**
 * 校验受众定向取值域，返回全部不符合项（需求 10.1、10.7，Property 20）。
 *
 * - 年龄：提供时须为 13-65 的整数，且下限不大于上限（越界归 audience_out_of_range）。
 * - 性别：提供时须属于「男/女/不限」。
 * - 排除/负向定向与相似受众种子（需求 10.8、10.9）：提供时种子标识须为非空字符串集合。
 */
export function validateTargeting(input: TargetingInput): CampaignValidationError[] {
  const errors: CampaignValidationError[] = [];

  if (input.ageMin != null && !isAgeValid(input.ageMin)) {
    errors.push({
      field: 'ageMin',
      code: 'audience_out_of_range',
      message: `年龄取值需为 ${AGE_MIN}-${AGE_MAX} 的整数`,
    });
  }
  if (input.ageMax != null && !isAgeValid(input.ageMax)) {
    errors.push({
      field: 'ageMax',
      code: 'audience_out_of_range',
      message: `年龄取值需为 ${AGE_MIN}-${AGE_MAX} 的整数`,
    });
  }
  if (
    input.ageMin != null &&
    input.ageMax != null &&
    isAgeValid(input.ageMin) &&
    isAgeValid(input.ageMax) &&
    input.ageMin > input.ageMax
  ) {
    errors.push({
      field: 'ageMin',
      code: 'audience_out_of_range',
      message: '年龄下限不得大于上限',
    });
  }

  if (input.gender != null && !GENDERS.includes(input.gender as Gender)) {
    errors.push({
      field: 'gender',
      code: 'audience_out_of_range',
      message: '性别取值需为「男/女/不限」之一',
    });
  }

  if (
    input.lookalikeSeedOpportunityIds != null &&
    !isNonEmptyStringArray(input.lookalikeSeedOpportunityIds)
  ) {
    errors.push({
      field: 'lookalikeSeedOpportunityIds',
      code: 'audience_out_of_range',
      message: '相似受众种子商机标识需为非空字符串集合',
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/** 是否为非空字符串。 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** 是否为非空、且元素均为非空字符串的数组。 */
function isNonEmptyStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((v) => isNonEmptyString(v));
}
