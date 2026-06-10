/**
 * AI 辅助建广告引擎纯函数库（组件 5，需求 9）。
 *
 * 平台无关、无副作用的核心决策逻辑：
 *  - 草案确认状态机 {@link canPublish}（需求 9.5、9.6，Property 18）。
 *  - 草案生成缺失项完整反馈 {@link collectMissingItems}（需求 9.8，Property 19）。
 *  - 人工审核模式两级配置解析 {@link resolveReviewMode}（需求 9.4）。
 *  - 优化建议生成 {@link buildOptimizationSuggestions}（需求 9.9、9.12、9.15、9.16）。
 *  - 受限自动优化上下限判定 {@link classifyAdjustment}（需求 9.11、9.13）。
 */
import {
  DEFAULT_PERSONA_GEO,
  MISSING_ITEM_LABELS,
  PERSONA_DIMENSIONS,
  SUFFICIENT_HIGH_INTENT_THRESHOLD,
  type AutoBounds,
  type BuyerPersona,
  type DraftConfirmStatus,
  type GenerateDraftInput,
  type OptimizationSnapshot,
  type OptimizationSuggestion,
  type ReviewMode,
} from '../domain/ai-campaign';

// ---------------------------------------------------------------------------
// 草案确认状态机（需求 9.5、9.6，Property 18）
// ---------------------------------------------------------------------------

/** 新生成的草案确认状态恒为「待确认」（需求 9.2、9.5）。 */
export const INITIAL_CONFIRM_STATUS: DraftConfirmStatus = '待确认';

/**
 * 草案确认状态机：当且仅当确认状态为「已确认」时可投放（需求 9.5、9.6）。
 *
 * 「待确认」草案不得发布或投放（需求 9.6）。
 */
export function canPublish(confirmStatus: DraftConfirmStatus): boolean {
  return confirmStatus === '已确认';
}

/**
 * 依据审核模式计算新草案的初始确认状态（需求 9.3、9.5）。
 *
 * - 全自动档：草案自动置「已确认」直接进入投放流程（需求 9.3）。
 * - 专家把关档：草案置「待确认」，需投手确认（需求 9.5）。
 */
export function initialConfirmStatusForMode(mode: ReviewMode): DraftConfirmStatus {
  return mode === '全自动' ? '已确认' : '待确认';
}

// ---------------------------------------------------------------------------
// 人工审核模式两级配置（需求 9.4）
// ---------------------------------------------------------------------------

/**
 * 解析某商家生效的审核模式档位（需求 9.4）。
 *
 * 两级配置：单商家覆盖优先，未覆盖时采用全局默认；任一时刻有且仅有一个生效档位。
 *
 * @param globalDefault 全局默认档位。
 * @param merchantOverride 单商家覆盖档位（未覆盖为 null/undefined）。
 */
export function resolveReviewMode(
  globalDefault: ReviewMode,
  merchantOverride: ReviewMode | null | undefined,
): ReviewMode {
  return merchantOverride ?? globalDefault;
}

// ---------------------------------------------------------------------------
// 草案生成缺失项完整反馈（需求 9.8，Property 19）
// ---------------------------------------------------------------------------

/**
 * 收集草案生成输入中的全部缺失项（需求 9.8，Property 19）。
 *
 * 必填项：成品广告素材（至少一份）+ 买家画像三维度（国家/地区、行业、职位）。
 * 返回**全部**缺失项的中文名称集合（顺序：素材在前，画像维度按 geo/industry/jobRole）；
 * 为空表示输入完整、可生成草案。
 */
export function collectMissingItems(input: GenerateDraftInput): string[] {
  const missing: string[] = [];

  if (!Array.isArray(input.materials) || input.materials.length === 0) {
    missing.push(MISSING_ITEM_LABELS.materials);
  }

  const persona: Partial<BuyerPersona> = input.persona ?? {};
  for (const dim of PERSONA_DIMENSIONS) {
    const value = persona[dim];
    if (typeof value !== 'string' || value.trim().length === 0) {
      missing.push(MISSING_ITEM_LABELS[dim]);
    }
  }

  return missing;
}

/**
 * 校验 AI 自动推导画像所需输入是否齐备（需求 9.1、9.8）。
 *
 * 仅成品素材为必填；产品定位描述可缺省，缺省时由 AI 从素材（广告视频/推广素材）
 * 推理产品信息后再推导画像。返回缺失项中文名称集合；为空表示可推导画像。
 */
export function collectPersonaInputMissingItems(input: {
  positioning: string;
  materials: unknown[];
}): string[] {
  const missing: string[] = [];
  if (!Array.isArray(input.materials) || input.materials.length === 0) {
    missing.push(MISSING_ITEM_LABELS.materials);
  }
  return missing;
}

/**
 * 应用画像默认值：国家/地区缺失时默认泰国（产品约定）。
 *
 * 行业与职位无默认值，仍按需求 9.8 参与缺失项反馈。
 */
export function applyPersonaDefaults(persona: Partial<BuyerPersona>): Partial<BuyerPersona> {
  const geo =
    typeof persona.geo === 'string' && persona.geo.trim().length > 0
      ? persona.geo
      : DEFAULT_PERSONA_GEO;
  return { ...persona, geo };
}

// ---------------------------------------------------------------------------
// 投放优化建议生成（需求 9.9、9.12、9.15、9.16）
// ---------------------------------------------------------------------------

/**
 * 基于优化快照生成优化建议（需求 9.9、9.12、9.15、9.16）。
 *
 * - 指标数据缺失（`hasMetrics=false`）→ 返回 `null`，由调用方提示数据不可用（需求 9.12）。
 * - 以「有效高意向商机数」为首要优化目标（而非曝光/点击，需求 9.15）：
 *   预算优先分配给历史回流高意向商机占比更高的受众/版位组合。
 * - 累计回流足量高意向商机后，追加相似扩展受众与低意向排除建议（需求 9.16）。
 *
 * @returns 优化建议集合；数据缺失返回 null。
 */
export function buildOptimizationSuggestions(
  snapshot: OptimizationSnapshot,
): OptimizationSuggestion[] | null {
  // 数据缺失或拉取失败：不生成建议（需求 9.12）。
  if (!snapshot.hasMetrics) {
    return null;
  }

  const suggestions: OptimizationSuggestion[] = [];

  // 以「有效高意向商机占比」对受众/版位组合排序，预算向高占比组合倾斜（需求 9.15）。
  const ranked = rankSegmentsByHighIntentRatio(snapshot.segments);
  if (ranked.length >= 2) {
    const top = ranked[0];
    const bottom = ranked[ranked.length - 1];
    const topRatio = highIntentRatio(top);
    const bottomRatio = highIntentRatio(bottom);

    // 仅当存在占比差异时才建议预算再分配（避免无意义调整）。
    if (topRatio > bottomRatio) {
      // 高占比组合加预算。
      suggestions.push({
        adjustmentItem: `budget:${top.segmentId}`,
        before: top.currentDailyBudget,
        after: roundMoney(top.currentDailyBudget * 1.2),
        expectedDelta: estimateHighIntentDelta(top, 0.2),
      });
      // 低占比组合减预算。
      suggestions.push({
        adjustmentItem: `budget:${bottom.segmentId}`,
        before: bottom.currentDailyBudget,
        after: roundMoney(bottom.currentDailyBudget * 0.8),
        expectedDelta: -estimateHighIntentDelta(bottom, 0.2),
      });
    }
  }

  // 累计回流足量高意向商机：生成相似扩展 + 低意向排除建议（需求 9.16）。
  if (snapshot.totalHighIntentOpportunities >= SUFFICIENT_HIGH_INTENT_THRESHOLD) {
    const seeds = ranked.filter((s) => s.highIntentOpportunities > 0).map((s) => s.segmentId);
    if (seeds.length > 0) {
      suggestions.push({
        adjustmentItem: 'audienceExpansion',
        before: null,
        after: { lookalikeSeeds: seeds },
        expectedDelta: snapshot.totalHighIntentOpportunities,
      });
    }
    const lowIntentSegments = ranked
      .filter((s) => s.totalOpportunities > 0 && s.highIntentOpportunities === 0)
      .map((s) => s.segmentId);
    if (lowIntentSegments.length > 0) {
      suggestions.push({
        adjustmentItem: 'audienceExclusion',
        before: null,
        after: { excludeSegments: lowIntentSegments },
        expectedDelta: 0,
      });
    }
  }

  return suggestions;
}

/** 计算单组合的有效高意向商机占比（无回流商机记为 0，需求 9.15）。 */
export function highIntentRatio(segment: {
  totalOpportunities: number;
  highIntentOpportunities: number;
}): number {
  if (segment.totalOpportunities <= 0) {
    return 0;
  }
  return segment.highIntentOpportunities / segment.totalOpportunities;
}

/**
 * 按有效高意向商机占比降序排序受众/版位组合（需求 9.15）。
 *
 * 占比相同则高意向商机绝对数多者优先，再以 segmentId 稳定排序。
 */
export function rankSegmentsByHighIntentRatio<
  T extends { segmentId: string; totalOpportunities: number; highIntentOpportunities: number },
>(segments: readonly T[]): T[] {
  return [...segments].sort((a, b) => {
    const ratioDiff = highIntentRatio(b) - highIntentRatio(a);
    if (ratioDiff !== 0) {
      return ratioDiff;
    }
    const countDiff = b.highIntentOpportunities - a.highIntentOpportunities;
    if (countDiff !== 0) {
      return countDiff;
    }
    return a.segmentId.localeCompare(b.segmentId);
  });
}

/** 估算预算变动带来的有效高意向商机变化量（以当前高意向数 × 变动比例近似）。 */
function estimateHighIntentDelta(
  segment: { highIntentOpportunities: number },
  ratio: number,
): number {
  return roundMoney(segment.highIntentOpportunities * ratio);
}

/** 金额/数值保留两位小数。 */
function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// 受限自动优化上下限判定（需求 9.11、9.13）
// ---------------------------------------------------------------------------

/** 单条调整的自动应用分类（需求 9.11、9.13）。 */
export type AdjustmentDisposition = 'apply' | 'manual';

/**
 * 判定单条优化建议是否可在授权上下限内自动应用（需求 9.11、9.13）。
 *
 * - 预算类调整（`adjustmentItem` 以 `budget` 开头）：调整后取值须在 [budgetMin, budgetMax]。
 * - 出价类调整（以 `bid` 开头）：调整后取值须在 [bidMin, bidMax]。
 * - 其余非数值类调整（受众扩展/排除）：默认可应用。
 * - 数值类调整超出范围 → 'manual'（转人工确认，需求 9.13）。
 */
export function classifyAdjustment(
  suggestion: OptimizationSuggestion,
  bounds: AutoBounds,
): AdjustmentDisposition {
  const item = suggestion.adjustmentItem;
  const after = suggestion.after;

  if (item.startsWith('budget')) {
    if (typeof after !== 'number') {
      return 'manual';
    }
    return after >= bounds.budgetMin && after <= bounds.budgetMax ? 'apply' : 'manual';
  }

  if (item.startsWith('bid')) {
    if (typeof after !== 'number') {
      return 'manual';
    }
    return after >= bounds.bidMin && after <= bounds.bidMax ? 'apply' : 'manual';
  }

  // 非数值类（受众扩展/排除）默认可自动应用。
  return 'apply';
}
