/**
 * 效果看板服务领域类型（组件 14，需求 21）。
 */
import type { PlatformId } from '../../unified-model/domain/unified-model';
import type { IntentLevel } from '../../opportunity-scoring/entities/opportunity.entity';

/**
 * 业务指标三态值（需求 21.7、21.12）：
 *  - value：可计算；
 *  - incomputable：分母为零/输入缺失，标「不可计算」；
 *  - unavailable：维度数据缺失或凭据缺失，标「数据不可用」。
 */
export type MetricValue<T> =
  | { kind: 'value'; value: T }
  | { kind: 'incomputable'; note: '不可计算' }
  | { kind: 'unavailable'; note: '数据不可用' };

/** 看板时间范围（需求 21.2）。 */
export interface TimeRange {
  start: Date;
  end: Date;
}

/** 意向等级分布：各级占比 + 高意向（L3+L4）占比（需求 21.7）。 */
export interface IntentDistribution {
  shares: Record<'L1' | 'L2' | 'L3' | 'L4', number>;
  highIntentShare: number;
}

/** 投放时长指标输出（需求 21.8）。 */
export type TimeToFirstOpportunity =
  | { kind: 'duration'; seconds: number }
  | { kind: 'noOpportunity'; note: '暂无商机' }
  | { kind: 'unavailable'; note: '数据不可用' };

/** 看板聚合维度（缺失维度互相隔离，需求 21.4）。 */
export interface Dashboard {
  range: TimeRange;
  platform?: PlatformId;
  /** 投放消耗合计。 */
  spend: MetricValue<number>;
  /** 有效询盘成本（需求 21.5）。 */
  costPerQualifiedLead: MetricValue<number>;
  /** 有效联络率（需求 21.6）。 */
  effectiveContactRate: MetricValue<number>;
  /** 意向等级分布（需求 21.7）。 */
  intentLevelDistribution: MetricValue<IntentDistribution>;
  /** 商机总数。 */
  opportunityCount: MetricValue<number>;
}

/** 客户行业调查报告（需求 21.11、21.12）。 */
export interface IndustrySurveyReport {
  range: TimeRange;
  /** 行业分布（行业名 → 商机数）；维度缺失时为 unavailable。 */
  industryDistribution: MetricValue<Record<string, number>>;
  /** Gemini 生成的行业洞察文本；凭据缺失时为 unavailable。 */
  aiInsight: MetricValue<string>;
  generatedAt: Date;
}

/** 商机清单筛选条件（需求 21.13）。 */
export interface OpportunityFilter {
  level?: IntentLevel;
  platform?: string;
  followupStatus?: string;
  start?: Date;
  end?: Date;
}

/** 商机清单行（需求 21.13）。 */
export interface OpportunityListItem {
  opportunityId: string;
  intentLevel: IntentLevel;
  sourcePlatform: string | null;
  followupStatus: string;
  credibilityScore: string | null;
  contact: { companyName?: string; phone?: string; email?: string };
  createdAt: Date;
}

/** 单客户详情聚合（需求 21.15）。 */
export interface OpportunityDetail {
  opportunityId: string;
  intentLevel: IntentLevel;
  followupStatus: string;
  /** 原始留资 + 质量校验标注。 */
  lead: {
    rawData: unknown;
    qualityStatus: string | null;
    isValidLead: boolean;
    qualityFlags: unknown;
  } | null;
  /** 背调补全字段（含冲突/待核实标记）。 */
  verifiedFields: Array<{
    field: string;
    originalValue: string | null;
    verifiedValue: string | null;
    conflict: boolean;
    needsReview: boolean;
  }>;
  /** 等级变更轨迹。 */
  levelHistory: Array<{
    beforeLevel: IntentLevel | null;
    afterLevel: IntentLevel;
    changedAt: Date;
  }>;
  /** 跟进剧本与状态记录。 */
  followups: Array<{ status: string; playbook: unknown; failureReason: string | null }>;
}

/** 导出文件（需求 21.14、21.16）。 */
export interface ExportFile {
  filename: string;
  mimeType: string;
  content: Buffer;
}
