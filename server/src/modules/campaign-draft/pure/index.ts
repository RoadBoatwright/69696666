/**
 * AI 辅助建广告引擎纯函数库导出（组件 5，需求 9）。
 */
export {
  INITIAL_CONFIRM_STATUS,
  canPublish,
  initialConfirmStatusForMode,
  resolveReviewMode,
  collectMissingItems,
  collectPersonaInputMissingItems,
  buildOptimizationSuggestions,
  highIntentRatio,
  rankSegmentsByHighIntentRatio,
  classifyAdjustment,
} from './ai-campaign.pure';
export type { AdjustmentDisposition } from './ai-campaign.pure';
