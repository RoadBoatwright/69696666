import type { PlatformId } from '../../platform-adapter/domain/platform-adapter';
import type { AdReviewStatus } from '../entities';

/** 归一化后的单条指标行（需求 18.1、18.2）。 */
export interface NormalizedMetricRow {
  /** 系统内广告标识。 */
  adId: string;
  /** 来源平台。 */
  platform: PlatformId;
  /** 曝光。 */
  impressions: number;
  /** 点击。 */
  clicks: number;
  /** 转化。 */
  conversions: number;
  /** 花费。 */
  spend: number;
  /** 转化价值。 */
  conversionValue: number;
}

/** ROI 计算结果：花费为零标「不可计算」（需求 18.2、18.3）。 */
export type RoiResult =
  | { kind: 'value'; value: number }
  | { kind: 'not_computable'; note: '不可计算' };

/** 单平台拉取失败描述（需求 18.7）。 */
export interface PlatformPullFailure {
  platform: PlatformId;
  reason: string;
}

/** 指标拉取汇总：失败平台保留上次成功数据、其余平台继续（需求 18.7）。 */
export interface MetricsPullSummary {
  /** 拉取成功的平台。 */
  succeeded: PlatformId[];
  /** 拉取失败的平台与原因（保留上次成功数据）。 */
  failed: PlatformPullFailure[];
  /** 本轮入库的指标行数。 */
  savedRows: number;
}

/** 指标拉取目标账户。 */
export interface MetricsPullTarget {
  platform: PlatformId;
  accountId: string;
}

/** 转化事件回流输入（需求 19.5、19.6）。 */
export interface ConversionEventInput {
  /** 平台侧事件标识。 */
  platformEventId: string;
  /** 关联广告标识；无法匹配时为空（需求 19.6）。 */
  adId?: string | null;
  /** 所属转化配置标识（可空）。 */
  conversionConfigId?: string | null;
  /** 原始事件数据，未匹配时保留待匹配。 */
  raw?: unknown;
}

/** 审核状态同步结果（需求 20.1-20.5）。 */
export interface ReviewSyncResult {
  platform: PlatformId;
  /** 状态发生变更的广告（用于变更通知，需求 20.4）。 */
  changes: ReviewStatusChange[];
  /** 拉取失败时为失败原因；此时保留上次状态（需求 20.5）。 */
  failureReason?: string;
}

/** 审核状态变更记录（需求 20.4）。 */
export interface ReviewStatusChange {
  adId: string;
  before: AdReviewStatus | null;
  after: AdReviewStatus;
  rejectReason: string | null;
}
