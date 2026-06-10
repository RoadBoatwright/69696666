/**
 * 效果看板纯函数（任务 23，需求 21.2、21.5-21.9）。
 */
import type {
  IntentDistribution,
  MetricValue,
  TimeRange,
  TimeToFirstOpportunity,
} from '../domain/dashboard';
import type { Actor } from '../../rbac/domain/rbac';

const DAY_MS = 24 * 60 * 60 * 1_000;

/** 默认看板跨度：7 天（需求 21.2）。 */
export const DEFAULT_RANGE_DAYS = 7;

/** 最大看板跨度：365 天（需求 21.2）。 */
export const MAX_RANGE_DAYS = 365;

/**
 * 校验时间范围（需求 21.2）：结束早于开始无效；跨度须在 1-365 天内。
 */
export function validateRange(range: TimeRange): boolean {
  const startMs = range.start.getTime();
  const endMs = range.end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return false;
  }
  if (endMs < startMs) {
    return false;
  }
  const spanDays = (endMs - startMs) / DAY_MS;
  return spanDays >= 0 && spanDays <= MAX_RANGE_DAYS;
}

/** 生成默认 7 天范围（需求 21.2）。 */
export function defaultRange(now: Date): TimeRange {
  return { start: new Date(now.getTime() - DEFAULT_RANGE_DAYS * DAY_MS), end: now };
}

/** 有效询盘成本 = spend / qualifiedLeadCount；分母为零或输入缺失→不可计算（需求 21.5、21.7）。 */
export function costPerQualifiedLead(i: {
  spend: number | null;
  qualifiedLeadCount: number | null;
}): MetricValue<number> {
  if (
    i.spend === null ||
    i.qualifiedLeadCount === null ||
    !Number.isFinite(i.spend) ||
    !Number.isFinite(i.qualifiedLeadCount)
  ) {
    return { kind: 'incomputable', note: '不可计算' };
  }
  if (i.qualifiedLeadCount <= 0) {
    return { kind: 'incomputable', note: '不可计算' };
  }
  return { kind: 'value', value: i.spend / i.qualifiedLeadCount };
}

/** 有效联络率 = contactedCount / totalCount；分母为零→不可计算（需求 21.6、21.7）。 */
export function effectiveContactRate(i: {
  contactedCount: number | null;
  totalCount: number | null;
}): MetricValue<number> {
  if (
    i.contactedCount === null ||
    i.totalCount === null ||
    !Number.isFinite(i.contactedCount) ||
    !Number.isFinite(i.totalCount)
  ) {
    return { kind: 'incomputable', note: '不可计算' };
  }
  if (i.totalCount <= 0) {
    return { kind: 'incomputable', note: '不可计算' };
  }
  return { kind: 'value', value: i.contactedCount / i.totalCount };
}

/**
 * 意向等级分布：各级占比和为 1，高意向占比 = L3 占比 + L4 占比；
 * 已分级总数为零→不可计算（需求 21.7）。
 */
export function intentLevelDistribution(i: {
  levelCounts: Record<'L1' | 'L2' | 'L3' | 'L4', number> | null;
}): MetricValue<IntentDistribution> {
  if (i.levelCounts === null) {
    return { kind: 'incomputable', note: '不可计算' };
  }
  const counts = i.levelCounts;
  const total = counts.L1 + counts.L2 + counts.L3 + counts.L4;
  if (!Number.isFinite(total) || total <= 0) {
    return { kind: 'incomputable', note: '不可计算' };
  }
  const shares = {
    L1: counts.L1 / total,
    L2: counts.L2 / total,
    L3: counts.L3 / total,
    L4: counts.L4 / total,
  };
  return { kind: 'value', value: { shares, highIntentShare: shares.L3 + shares.L4 } };
}

/**
 * 投放时长 = 首次发布 → 首个商机的秒数；尚无商机→「暂无商机」；
 * 缺首次发布时间→数据不可用（需求 21.8）。
 */
export function timeToFirstOpportunity(i: {
  firstPublishedAt: Date | null;
  firstOpportunityAt: Date | null;
  hasOpportunity: boolean;
}): TimeToFirstOpportunity {
  if (!i.hasOpportunity) {
    return { kind: 'noOpportunity', note: '暂无商机' };
  }
  if (i.firstPublishedAt === null || i.firstOpportunityAt === null) {
    return { kind: 'unavailable', note: '数据不可用' };
  }
  const seconds = (i.firstOpportunityAt.getTime() - i.firstPublishedAt.getTime()) / 1_000;
  if (!Number.isFinite(seconds) || seconds < 0) {
    return { kind: 'unavailable', note: '数据不可用' };
  }
  return { kind: 'duration', seconds };
}

/**
 * 客户资产归属：商机归属 Merchant，停投/重启不丢失；
 * 仅归属商家本人、运营或管理员可访问（需求 21.9、21.10）。
 */
export function leadAssetOwnership(
  actor: Actor,
  opp: { merchantId: string; privateDomainSettled: boolean },
): { accessible: boolean; settled: boolean } {
  const accessible =
    actor.role === 'administrator' ||
    actor.role === 'operator' ||
    (actor.role === 'merchant' && actor.merchantId === opp.merchantId);
  return { accessible, settled: opp.privateDomainSettled };
}
