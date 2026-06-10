/**
 * 受众定向组装纯函数库（组件 6，需求 10.1-10.9）。
 *
 * 无副作用，将统一 {@link TargetingInput} 组装为传给平台适配器 `applyTargeting` 的
 * 维度映射（{@link Targeting.dimensions}），含核心维度（国家地区/行业/职位）、
 * 年龄/性别/兴趣/行为、自定义/相似受众，以及排除/负向定向（需求 10.8）与以高意向
 * 商机为种子的相似受众扩展（需求 10.9）。
 */
import type { TargetingInput } from '../domain/campaign';

/**
 * 将统一受众定向输入组装为平台无关的定向维度映射（需求 10.1、10.8、10.9）。
 *
 * 仅纳入已提供（非 undefined/null）的维度；具体「平台不适用」标记由适配器
 * `applyTargeting` 经统一模型层判定（需求 10.4），本函数不做平台特定裁剪。
 *
 * 高意向相似受众（需求 10.9）：当提供 `lookalikeSeedOpportunityIds` 时，组装
 * `lookalikeSeedOpportunities` 维度，交由适配器以历史高意向商机为种子扩展相似人群。
 */
export function buildTargetingDimensions(input: TargetingInput): Record<string, unknown> {
  const dimensions: Record<string, unknown> = {};

  assignIfPresent(dimensions, 'geo', input.geo);
  assignIfPresent(dimensions, 'industry', input.industry);
  assignIfPresent(dimensions, 'jobRole', input.jobRole);
  assignIfPresent(dimensions, 'ageMin', input.ageMin);
  assignIfPresent(dimensions, 'ageMax', input.ageMax);
  assignIfPresent(dimensions, 'gender', input.gender);
  assignIfPresent(dimensions, 'interests', input.interests);
  assignIfPresent(dimensions, 'behaviors', input.behaviors);
  assignIfPresent(dimensions, 'customAudiences', input.customAudiences);
  assignIfPresent(dimensions, 'lookalikeAudiences', input.lookalikeAudiences);

  // 排除/负向定向（需求 10.8）：滤除低意向人群。
  assignIfPresent(dimensions, 'excludedAudiences', input.excludedAudiences);
  assignIfPresent(dimensions, 'negativeTargeting', input.negativeTargeting);

  // 以高意向商机为种子的相似受众扩展（需求 10.9）。
  if (
    Array.isArray(input.lookalikeSeedOpportunityIds) &&
    input.lookalikeSeedOpportunityIds.length > 0
  ) {
    dimensions.lookalikeSeedOpportunities = [...input.lookalikeSeedOpportunityIds];
  }

  return dimensions;
}

/** 当值已提供（非 undefined/null）时写入维度映射。 */
function assignIfPresent(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null) {
    target[key] = value;
  }
}
