/**
 * AI 辅助建广告引擎外部依赖端口（组件 5，需求 9）。
 *
 * 将「底层生成式 AI（Google Gemini）」与「优化数据来源（数据回传指标 + 商机回流统计）」
 * 抽象为端口接口：
 *  - {@link GeminiClient}：经凭据管理器 `useDecrypted('gemini')` 取 API Key 调用**真实
 *    Google Gemini API** 推导画像与生成草案内容；凭据未填入时整个能力降级为不可用（需求 9.7）。
 *  - {@link OptimizationDataProvider}：聚合数据回传指标与商机回流统计供优化决策（需求 9.9、9.15）；
 *    指标缺失时返回 `hasMetrics=false`（需求 9.12）。
 *  - {@link CampaignPublisher}：草案确认后驱动广告计划服务进入创建+投放（需求 9.3、9.6）。
 *  - {@link AutoAdjustmentApplier}：受限自动优化的实际平台改配置入口（需求 9.11、9.14）。
 */
import type { AutoBounds, BuyerPersona, PlatformDraft } from '../domain/ai-campaign';
import type { AssetRef } from '../../platform-adapter/domain/platform-adapter';
import type { OptimizationSnapshot } from '../domain/ai-campaign';

/** DI 注入令牌：Gemini 生成式 AI 客户端。 */
export const GEMINI_CLIENT = Symbol('GEMINI_CLIENT');

/** DI 注入令牌：优化数据来源。 */
export const OPTIMIZATION_DATA_PROVIDER = Symbol('OPTIMIZATION_DATA_PROVIDER');

/** DI 注入令牌：草案投放驱动器。 */
export const CAMPAIGN_PUBLISHER = Symbol('CAMPAIGN_PUBLISHER');

/** DI 注入令牌：自动优化调整应用器。 */
export const AUTO_ADJUSTMENT_APPLIER = Symbol('AUTO_ADJUSTMENT_APPLIER');

/**
 * 底层生成式 AI（Google Gemini）客户端端口（需求 9.1、9.2、9.7）。
 *
 * 实现经 `CredentialManagerService.useDecrypted('gemini', 'apiKey', …)` 在内存中取 API Key
 * 调用真实 Gemini API，用后立即清理（需求 6.3、6.4）。凭据未填入时由凭据管理器抛
 * 「该平台凭据未配置」，服务侧据此降级为不可用，绝不以假数据顶替（需求 9.7）。
 */
export interface GeminiClient {
  /**
   * 据产品定位描述 + 成品素材自动推导买家画像（国家/地区 + 行业 + 职位，需求 9.1）。
   */
  derivePersona(input: { positioning: string; materials: AssetRef[] }): Promise<BuyerPersona>;

  /**
   * 据成品素材 + 买家画像生成多平台广告计划草案内容（系列/组/广告/定向/预算/素材挂载/
   * 留资表单建议，需求 9.2）。素材项为对成品素材的引用挂载，不做创意改写。
   */
  generatePlatformDrafts(input: {
    materials: AssetRef[];
    persona: BuyerPersona;
  }): Promise<PlatformDraft[]>;
}

/**
 * 优化数据来源端口（需求 9.9、9.10、9.12、9.15）。
 *
 * 实现优先经目标平台官方 MCP 连接器（Meta）/官方 Marketing/Ads API 拉取曝光/点击/转化/
 * 花费/ROI，并聚合商机回流统计（含有效高意向商机数）。指标缺失或拉取失败时
 * 返回 `hasMetrics=false`（需求 9.12）。
 */
export interface OptimizationDataProvider {
  /** 聚合某广告计划的优化分析快照（需求 9.9、9.15）。 */
  loadSnapshot(campaignId: string): Promise<OptimizationSnapshot>;
}

/**
 * 草案投放驱动器端口（需求 9.3、9.6）。
 *
 * 草案确认（自动或人工）后，将各平台草案落地为广告计划服务的三级创建与投放编排，
 * 返回创建的广告计划标识集合。
 */
export interface CampaignPublisher {
  /** 据已确认草案创建并投放广告计划，返回广告计划标识集合（需求 9.3）。 */
  publishFromDraft(input: {
    merchantId: string;
    platformDrafts: PlatformDraft[];
  }): Promise<string[]>;
}

/** 单条调整的实际应用入口（需求 9.11、9.14）。 */
export interface AutoAdjustmentApplier {
  /**
   * 经平台官方 API 实际应用一条调整；失败抛错由服务侧保留原配置并记录原因（需求 9.14）。
   *
   * @param campaignId 目标广告计划标识。
   * @param adjustmentItem 调整项标识。
   * @param after 调整后取值。
   */
  apply(campaignId: string, adjustmentItem: string, after: unknown): Promise<void>;
}

export type { AutoBounds };
