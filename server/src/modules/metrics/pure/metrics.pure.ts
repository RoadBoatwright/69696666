import type { PlatformId } from '../../platform-adapter/domain/platform-adapter';
import type { AdReviewStatus, ConversionMatchStatus } from '../entities';
import type { NormalizedMetricRow, RoiResult } from '../domain/metrics';

/**
 * 计算 ROI（需求 18.2、18.3）。
 *
 * ROI = (转化价值 - 花费) / 花费；花费为零或非法时标「不可计算」，绝不除零。
 */
export function computeRoi(conversionValue: number, spend: number): RoiResult {
  if (!Number.isFinite(spend) || spend <= 0 || !Number.isFinite(conversionValue)) {
    return { kind: 'not_computable', note: '不可计算' };
  }
  return { kind: 'value', value: (conversionValue - spend) / spend };
}

/** 各平台原生指标字段别名表（归一化用，需求 18.1、18.2）。 */
const FIELD_ALIASES: Record<keyof Omit<NormalizedMetricRow, 'adId' | 'platform'>, string[]> = {
  impressions: ['impressions', 'impression', 'show_cnt'],
  clicks: ['clicks', 'click', 'click_cnt'],
  conversions: ['conversions', 'conversion', 'convert_cnt', 'results'],
  spend: ['spend', 'cost', 'stat_cost', 'cost_micros'],
  conversionValue: ['conversion_value', 'conversionValue', 'total_value', 'conversions_value'],
};

/**
 * 把平台原生指标行归一化为统一口径（需求 18.1、18.2）。
 *
 * 无法识别广告标识的行返回 null（由调用方丢弃并记录）；数值字段缺失按 0 处理。
 */
export function normalizeMetricRow(
  platform: PlatformId,
  row: Record<string, unknown>,
): NormalizedMetricRow | null {
  const adId = firstString(row, ['adId', 'ad_id', 'adgroup_ad_id', 'id']);
  if (!adId) return null;
  return {
    adId,
    platform,
    impressions: firstNumber(row, FIELD_ALIASES.impressions),
    clicks: firstNumber(row, FIELD_ALIASES.clicks),
    conversions: firstNumber(row, FIELD_ALIASES.conversions),
    spend: firstNumber(row, FIELD_ALIASES.spend),
    conversionValue: firstNumber(row, FIELD_ALIASES.conversionValue),
  };
}

/** 平台原生审核状态 → 三态归一化「审核中|审核通过|审核被拒绝」（需求 20.2）。 */
export function normalizeReviewStatus(rawStatus: string): AdReviewStatus {
  const value = rawStatus.trim().toLowerCase();
  const approved = ['approved', 'active', 'eligible', 'enabled', 'pass', 'passed', '审核通过'];
  const rejected = [
    'rejected',
    'disapproved',
    'denied',
    'deny',
    'failed',
    'with_issues',
    '审核被拒绝',
  ];
  if (approved.includes(value)) return '审核通过';
  if (rejected.includes(value)) return '审核被拒绝';
  return '审核中';
}

/** 转化事件匹配判定：能关联到广告即「matched」，否则「unmatched」（需求 19.5、19.6）。 */
export function matchConversionEvent(adId: string | null | undefined): ConversionMatchStatus {
  return typeof adId === 'string' && adId.trim().length > 0 ? 'matched' : 'unmatched';
}

/** 校验转化事件定义集合数量（最多 50，需求 19.1）。 */
export function validateEventDefs(eventDefs: unknown): string[] {
  if (eventDefs == null) return [];
  if (!Array.isArray(eventDefs)) return ['事件定义必须为数组'];
  if (eventDefs.length > 50) return ['事件定义最多 50 条'];
  return [];
}

function firstString(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function firstNumber(row: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}
