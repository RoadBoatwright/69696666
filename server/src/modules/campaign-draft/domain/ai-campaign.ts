/**
 * AI 辅助建广告引擎领域类型（组件 5，需求 9）。
 *
 * 平台无关的买家画像推导、多平台草案生成、人工审核模式两级配置、草案确认状态机与
 * 投放优化（以「有效高意向商机数」为目标）领域定义，被 {@link ../ai-campaign.service}
 * 与各纯函数库共用。
 *
 * 定位：本引擎只做「画像推导 + 多平台草案编排 + 优化决策」，草案中的素材项为对**已上传
 * 成品素材**的引用挂载，引擎不对素材内容做创意设计或改写（需求 9.2）。
 */
import type { PlatformId } from '../../unified-model/domain/unified-model';
import type { AssetRef } from '../../platform-adapter/domain/platform-adapter';
import type { DraftConfirmStatus, PersonaSource } from '../entities/campaign-draft.entity';

export type { PlatformId, AssetRef, DraftConfirmStatus, PersonaSource };

// ---------------------------------------------------------------------------
// 买家画像（需求 9.1）
// ---------------------------------------------------------------------------

/**
 * 买家画像核心维度（国家/地区 + 行业 + 职位，需求 9.1）。
 *
 * 三个核心维度均为生成草案所必需；任一缺失视为画像维度缺失（需求 9.8）。
 */
export interface BuyerPersona {
  /** 国家/地区维度（需求 9.1）。 */
  geo: string;
  /** 行业维度（需求 9.1）。 */
  industry: string;
  /** 职位维度（需求 9.1）。 */
  jobRole: string;
}

/** 买家画像核心维度名称（用于缺失项完整反馈，需求 9.8）。 */
export const PERSONA_DIMENSIONS: readonly (keyof BuyerPersona)[] = ['geo', 'industry', 'jobRole'];

/** 缺失项面向用户的中文名称（需求 9.8）。 */
export const MISSING_ITEM_LABELS = {
  materials: '成品广告素材',
  geo: '国家/地区',
  industry: '行业',
  jobRole: '职位',
} as const;

// ---------------------------------------------------------------------------
// 人工审核模式两级配置（需求 9.3、9.4）
// ---------------------------------------------------------------------------

/**
 * 人工审核模式档位（需求 9.3、9.4）。
 *
 * - `全自动`：人工审核模式关闭（系统默认）。草案生成后自动确认并直接进入投放流程。
 * - `专家把关`：人工审核模式开启。草案置「待确认」，需投手确认后方可投放。
 */
export type ReviewMode = '全自动' | '专家把关';

/** 全局默认审核模式：默认关闭即全自动档（需求 9.4）。 */
export const DEFAULT_REVIEW_MODE: ReviewMode = '全自动';

// ---------------------------------------------------------------------------
// 多平台草案（需求 9.2）
// ---------------------------------------------------------------------------

/**
 * 单平台广告计划草案（系列/组/广告/定向/预算/素材挂载/留资表单建议，需求 9.2）。
 *
 * `assetRefs` 为对已上传成品素材的引用挂载（引擎不做创意改写，需求 9.2）。
 */
export interface PlatformDraft {
  /** 目标平台（Meta/Google/TikTok，需求 9.2）。 */
  platform: PlatformId;
  /** 广告系列建议（名称/目标等）。 */
  campaign: Record<string, unknown>;
  /** 广告组建议（受众定向/预算/出价建议）。 */
  adGroup: Record<string, unknown>;
  /** 广告建议。 */
  ad: Record<string, unknown>;
  /** 成品素材引用挂载集合（引擎不改写素材内容，需求 9.2）。 */
  assetRefs: AssetRef[];
  /** 留资表单字段建议（需求 9.2）。 */
  leadFormSuggestion: Record<string, unknown>;
}

/** 草案生成输入（需求 9.2、9.8）。 */
export interface GenerateDraftInput {
  /** 归属商家标识。 */
  merchantId: string;
  /** 成品素材引用集合（缺失视为缺素材，需求 9.8）。 */
  materials: AssetRef[];
  /** 买家画像（核心维度缺失视为画像维度缺失，需求 9.8）。 */
  persona: BuyerPersona;
}

// ---------------------------------------------------------------------------
// 投放优化（需求 9.9-9.16）
// ---------------------------------------------------------------------------

/** 单条优化建议（含调整项、调整前后取值与预期变化量，需求 9.9）。 */
export interface OptimizationSuggestion {
  /** 调整项标识（如 `dailyBudget`、`bid`、`audienceExpansion`、`audienceExclusion`）。 */
  adjustmentItem: string;
  /** 调整前取值。 */
  before: unknown;
  /** 调整后建议取值。 */
  after: unknown;
  /** 预期变化量（以「有效高意向商机数」口径衡量，需求 9.15）。 */
  expectedDelta: number;
}

/** 受限自动优化的预算/出价调整上下限（需求 9.11、9.13）。 */
export interface AutoBounds {
  /** 预算调整下限。 */
  budgetMin: number;
  /** 预算调整上限。 */
  budgetMax: number;
  /** 出价调整下限。 */
  bidMin: number;
  /** 出价调整上限。 */
  bidMax: number;
}

/** 单条调整应用记录（含调整项、调整前后取值与精确到秒的时间，需求 9.11）。 */
export interface AppliedAdjustment {
  adjustmentItem: string;
  before: unknown;
  after: unknown;
  /** 调整时间（精确到秒，需求 9.11）。 */
  appliedAt: Date;
}

/** 受限自动优化结果（需求 9.11、9.13、9.14）。 */
export interface AutoApplyResult {
  /** 在上下限内成功应用的调整（需求 9.11）。 */
  applied: AppliedAdjustment[];
  /** 超出授权范围、转为请求人工确认的调整（需求 9.13）。 */
  needsManualConfirmation: OptimizationSuggestion[];
  /** 应用失败、已保留原配置的调整及失败原因（需求 9.14）。 */
  failed: { suggestion: OptimizationSuggestion; reason: string }[];
}

/**
 * 单个受众/版位组合的历史回流统计（需求 9.15、9.16）。
 *
 * 用于以「有效高意向商机数」为目标的预算优先分配与相似扩展/低意向排除建议。
 */
export interface AudienceSegmentStat {
  /** 受众/版位组合标识。 */
  segmentId: string;
  /** 当前在该组合上的日预算。 */
  currentDailyBudget: number;
  /** 当前出价。 */
  currentBid: number;
  /** 该组合累计回流的商机总数。 */
  totalOpportunities: number;
  /** 该组合累计回流的有效高意向商机数（需求 9.15）。 */
  highIntentOpportunities: number;
}

/** 优化分析输入快照（由数据回传指标 + 商机回流统计聚合，需求 9.9、9.15）。 */
export interface OptimizationSnapshot {
  campaignId: string;
  /** 是否有可用指标数据；为 false 时不生成建议并提示数据不可用（需求 9.12）。 */
  hasMetrics: boolean;
  /** 累计曝光。 */
  impressions: number;
  /** 累计点击。 */
  clicks: number;
  /** 累计转化。 */
  conversions: number;
  /** 累计花费。 */
  spend: number;
  /** ROI（不可计算时为 null）。 */
  roi: number | null;
  /** 各受众/版位组合的回流统计（需求 9.15、9.16）。 */
  segments: AudienceSegmentStat[];
  /** 累计回流的有效高意向商机总数（需求 9.16 足量判定）。 */
  totalHighIntentOpportunities: number;
}

/** 优化分析结果：建议集合或数据不可用（需求 9.9、9.12）。 */
export type AnalyzeResult = OptimizationSuggestion[] | { dataUnavailable: true };

/**
 * 触发相似扩展/低意向排除建议的最小累计高意向商机数（需求 9.16）。
 *
 * 累计回流足量（达到该阈值）后，才基于高意向商机特征生成扩展/排除建议。
 */
export const SUFFICIENT_HIGH_INTENT_THRESHOLD = 10;
