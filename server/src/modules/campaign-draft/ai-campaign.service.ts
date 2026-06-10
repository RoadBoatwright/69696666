import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CredentialNotConfiguredError } from '../../common/errors/credential.error';
import { CredentialManagerService } from '../credential/credential-manager.service';
import type { Actor } from '../rbac/domain';
import {
  DEFAULT_REVIEW_MODE,
  type AnalyzeResult,
  type AppliedAdjustment,
  type AutoApplyResult,
  type AutoBounds,
  type BuyerPersona,
  type GenerateDraftInput,
  type PersonaSource,
  type PlatformDraft,
  type ReviewMode,
} from './domain/ai-campaign';
import {
  buildOptimizationSuggestions,
  canPublish as canPublishStatus,
  classifyAdjustment,
  collectMissingItems,
  collectPersonaInputMissingItems,
  initialConfirmStatusForMode,
  resolveReviewMode as resolveReviewModePure,
} from './pure/ai-campaign.pure';
import { CampaignDraft } from './entities/campaign-draft.entity';
import {
  GLOBAL_REVIEW_MODE_SCOPE,
  ReviewModeConfig,
} from './entities/review-mode-config.entity';
import {
  AUTO_ADJUSTMENT_APPLIER,
  CAMPAIGN_PUBLISHER,
  GEMINI_CLIENT,
  OPTIMIZATION_DATA_PROVIDER,
  type AutoAdjustmentApplier,
  type CampaignPublisher,
  type GeminiClient,
  type OptimizationDataProvider,
} from './ports';
import type { AssetRef } from '../platform-adapter/domain/platform-adapter';

/** 草案生成/画像推导缺失项错误（含全部缺失项名称，需求 9.8）。 */
export class MissingDraftInputsError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`生成广告计划草案所需输入缺失：${missing.join('、')}`);
    this.name = 'MissingDraftInputsError';
    this.missing = missing;
  }
}

/** AI 能力不可用（Gemini 凭据未填入，需求 9.7）。 */
export interface AiUnavailable {
  unavailable: true;
}

/** 草案待确认不得投放错误（需求 9.6）。 */
export class DraftNotConfirmedError extends Error {
  constructor(draftId: string) {
    super('该草案尚未确认，不得发布或投放');
    this.name = 'DraftNotConfirmedError';
    this.draftId = draftId;
  }

  readonly draftId: string;
}

/** 草案不存在错误。 */
export class DraftNotFoundError extends Error {
  constructor(draftId: string) {
    super('广告计划草案不存在');
    this.name = 'DraftNotFoundError';
    this.draftId = draftId;
  }

  readonly draftId: string;
}

/**
 * AI 辅助建广告引擎（组件 5，需求 9）。
 *
 * 将「买家画像推导 + 多平台草案生成 + 人工审核档位 + 草案确认状态机 + 投放优化」合并为
 * 一个能力：
 *  - {@link derivePersona}：产品定位描述 + 成品素材 → AI 自动推导买家画像，标记来源（需求 9.1）。
 *  - {@link generateDraft}：成品素材 + 画像 → Meta/Google/TikTok 草案；缺素材/画像维度返回全部
 *    缺失项不生成；Gemini 凭据未填入降级不可用（需求 9.2、9.7、9.8）。
 *  - {@link resolveReviewMode}：人工审核模式两级配置（全局默认 + 单商家覆盖，需求 9.4）。
 *  - {@link canPublish} / {@link confirm}：草案确认状态机，仅「已确认」可投放（需求 9.3、9.5、9.6）。
 *  - {@link analyze} / {@link applyAuto}：以「有效高意向商机数」为目标的优化建议与受限自动优化
 *    （MCP 优先/官方 API、上下限内应用、超限转人工、失败保留原配置、数据缺失不生成，需求 9.9-9.16）。
 *
 * 真实服务原则：底层生成式 AI 经 {@link GeminiClient} 调用真实 Google Gemini API（凭据经
 * `useDecrypted('gemini')` 取用）；优化数据经 {@link OptimizationDataProvider} 优先走平台官方
 * MCP/官方 API 真实拉取。凭据为占位符未填入时整能力降级为不可用，不崩溃、不以假数据顶替。
 */
@Injectable()
export class AiCampaignService {
  private readonly logger = new Logger(AiCampaignService.name);

  constructor(
    @InjectRepository(CampaignDraft)
    private readonly draftRepo: Repository<CampaignDraft>,
    @InjectRepository(ReviewModeConfig)
    private readonly reviewModeRepo: Repository<ReviewModeConfig>,
    private readonly credentials: CredentialManagerService,
    @Inject(GEMINI_CLIENT)
    private readonly gemini: GeminiClient,
    @Inject(OPTIMIZATION_DATA_PROVIDER)
    private readonly dataProvider: OptimizationDataProvider,
    @Inject(CAMPAIGN_PUBLISHER)
    private readonly publisher: CampaignPublisher,
    @Optional()
    @Inject(AUTO_ADJUSTMENT_APPLIER)
    private readonly applier?: AutoAdjustmentApplier,
  ) {}

  // ---------------------------------------------------------------------------
  // 14.9 derivePersona —— 产品定位描述 → AI 自动推导买家画像（需求 9.1）
  // ---------------------------------------------------------------------------

  /**
   * 据产品定位描述与成品素材自动推导买家画像并标记来源（需求 9.1）。
   *
   * - Gemini 凭据未填入 → 返回 `{ unavailable: true }`（需求 9.7）。
   * - 产品定位描述或成品素材缺失 → 返回 `{ error: 全部缺失项 }`，不推导（需求 9.8）。
   * - 投手显式指定画像（`override`）→ 直接采用并标记来源「人工指定」（需求 9.1）。
   */
  async derivePersona(
    _actor: Actor,
    input: { positioning: string; materials: AssetRef[]; override?: BuyerPersona },
  ): Promise<{ persona: BuyerPersona; source: PersonaSource } | AiUnavailable | { error: string[] }> {
    // 投手显式指定：人工指定画像，无需 AI（需求 9.1）。
    if (input.override) {
      const missing = collectMissingItems({
        merchantId: '',
        materials: input.materials,
        persona: input.override,
      }).filter((m) => m !== '成品广告素材');
      if (missing.length > 0) {
        return { error: missing };
      }
      return { persona: input.override, source: '人工指定' };
    }

    if (!(await this.credentials.isGeminiAvailable())) {
      return { unavailable: true };
    }

    const missing = collectPersonaInputMissingItems(input);
    if (missing.length > 0) {
      return { error: missing };
    }

    try {
      const persona = await this.gemini.derivePersona({
        positioning: input.positioning,
        materials: input.materials,
      });
      // AI 输出维度不全时按缺失项反馈（需求 9.8）。
      const personaMissing = collectMissingItems({
        merchantId: '',
        materials: input.materials,
        persona,
      }).filter((m) => m !== '成品广告素材');
      if (personaMissing.length > 0) {
        return { error: personaMissing };
      }
      return { persona, source: 'AI自动推导' };
    } catch (error) {
      if (error instanceof CredentialNotConfiguredError) {
        return { unavailable: true };
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // 14.1 generateDraft —— 按画像生成多平台草案（需求 9.2、9.7、9.8）
  // ---------------------------------------------------------------------------

  /**
   * 生成 Meta/Google/TikTok 多平台广告计划草案（需求 9.2、9.7、9.8）。
   *
   * 顺序（缺失校验先于降级判定，以便完整反馈缺失项）：
   *  1. 缺素材或画像维度（国家/地区、行业、职位）→ 返回全部缺失项，不生成（需求 9.8）。
   *  2. Gemini 凭据未填入 → 返回 `{ unavailable: true }` 降级（需求 9.7）。
   *  3. 经真实 Gemini API 生成各平台草案骨架（素材为引用挂载，不改写，需求 9.2）。
   *  4. 依商家生效审核档位置初始确认状态：全自动档「已确认」、专家把关档「待确认」（需求 9.3、9.5）。
   */
  async generateDraft(
    _actor: Actor,
    input: GenerateDraftInput,
  ): Promise<CampaignDraft | AiUnavailable | { error: string[] }> {
    // 1) 缺失项完整反馈（需求 9.8，Property 19）。
    const missing = collectMissingItems(input);
    if (missing.length > 0) {
      return { error: missing };
    }

    // 2) Gemini 凭据未填入降级（需求 9.7）。
    if (!(await this.credentials.isGeminiAvailable())) {
      return { unavailable: true };
    }

    // 3) 经真实 Gemini API 生成各平台草案（需求 9.2）。
    let platformDrafts: PlatformDraft[];
    try {
      platformDrafts = await this.gemini.generatePlatformDrafts({
        materials: input.materials,
        persona: input.persona,
      });
    } catch (error) {
      if (error instanceof CredentialNotConfiguredError) {
        return { unavailable: true };
      }
      throw error;
    }

    // 4) 依审核档位置初始确认状态（需求 9.3、9.5）。
    const mode = await this.resolveReviewMode(input.merchantId);
    const confirmStatus = initialConfirmStatusForMode(mode);

    const draft = this.draftRepo.create({
      merchantId: input.merchantId,
      confirmStatus,
      platformDrafts: platformDrafts as unknown,
      personaSource: null,
    });
    const saved = await this.draftRepo.save(draft);

    // 全自动档：草案自动确认后直接进入投放流程（需求 9.3）。
    if (mode === '全自动') {
      await this.driveToPublish(saved);
    }

    return saved;
  }

  // ---------------------------------------------------------------------------
  // 14.10 人工审核模式两级配置（需求 9.3、9.4）
  // ---------------------------------------------------------------------------

  /**
   * 解析某商家生效的审核模式档位（需求 9.4）。
   *
   * 单商家覆盖优先，未覆盖采用全局默认（默认关闭即全自动档），任一时刻唯一档位。
   */
  async resolveReviewMode(merchantId: string): Promise<ReviewMode> {
    const [globalRow, merchantRow] = await Promise.all([
      this.reviewModeRepo.findOne({ where: { scope: GLOBAL_REVIEW_MODE_SCOPE } }),
      this.reviewModeRepo.findOne({ where: { scope: merchantId } }),
    ]);
    const globalDefault = globalRow?.mode ?? DEFAULT_REVIEW_MODE;
    return resolveReviewModePure(globalDefault, merchantRow?.mode ?? null);
  }

  /** 设置全局默认审核档位（需求 9.4）。 */
  async setGlobalReviewMode(mode: ReviewMode): Promise<void> {
    await this.reviewModeRepo.save(
      this.reviewModeRepo.create({ scope: GLOBAL_REVIEW_MODE_SCOPE, mode }),
    );
  }

  /** 设置单商家审核档位覆盖（需求 9.4）。 */
  async setMerchantReviewMode(merchantId: string, mode: ReviewMode): Promise<void> {
    await this.reviewModeRepo.save(this.reviewModeRepo.create({ scope: merchantId, mode }));
  }

  // ---------------------------------------------------------------------------
  // 14.2 canPublish 状态机 + confirm 驱动投放（需求 9.5、9.6）
  // ---------------------------------------------------------------------------

  /** 草案确认状态机：当且仅当「已确认」可投放（需求 9.5、9.6）。 */
  canPublish(draft: Pick<CampaignDraft, 'confirmStatus'>): boolean {
    return canPublishStatus(draft.confirmStatus);
  }

  /**
   * 确认草案并驱动进入创建+投放流程（需求 9.3、9.6）。
   *
   * 将「待确认」草案置「已确认」后驱动投放；已确认草案幂等驱动。
   */
  async confirm(
    _actor: Actor,
    draftId: string,
  ): Promise<{ confirmStatus: '已确认'; campaignIds: string[] }> {
    const draft = await this.draftRepo.findOne({ where: { id: draftId } });
    if (!draft) {
      throw new DraftNotFoundError(draftId);
    }

    if (draft.confirmStatus !== '已确认') {
      draft.confirmStatus = '已确认';
      await this.draftRepo.save(draft);
    }

    const campaignIds = await this.driveToPublish(draft);
    return { confirmStatus: '已确认', campaignIds };
  }

  /**
   * 校验某草案是否可发布投放，不可发布即拒绝（需求 9.6）。
   *
   * 供投放入口前置调用：确认状态「待确认」时抛 {@link DraftNotConfirmedError}。
   */
  async assertPublishable(draftId: string): Promise<void> {
    const draft = await this.draftRepo.findOne({ where: { id: draftId } });
    if (!draft) {
      throw new DraftNotFoundError(draftId);
    }
    if (!this.canPublish(draft)) {
      throw new DraftNotConfirmedError(draftId);
    }
  }

  // ---------------------------------------------------------------------------
  // 14.5 / 14.11 优化建议与受限自动优化（需求 9.9-9.16）
  // ---------------------------------------------------------------------------

  /**
   * 对已投放计划生成优化建议（需求 9.9、9.10、9.12、9.15、9.16）。
   *
   * 经优化数据来源（MCP 优先/官方 API）拉取指标 + 商机回流统计，以「有效高意向商机数」
   * 为目标生成调整项/调整前后/预期变化；指标缺失或拉取失败时返回 `{ dataUnavailable: true }`
   * 不生成建议（需求 9.12）。Gemini 凭据未填入时整能力降级不可用（需求 9.7）。
   */
  async analyze(_actor: Actor, campaignId: string): Promise<AnalyzeResult | AiUnavailable> {
    if (!(await this.credentials.isGeminiAvailable())) {
      return { unavailable: true };
    }

    let snapshot;
    try {
      snapshot = await this.dataProvider.loadSnapshot(campaignId);
    } catch (error) {
      this.logger.warn(
        `优化数据拉取失败：campaignId=${campaignId}，按数据不可用处理（需求 9.12）`,
      );
      return { dataUnavailable: true };
    }

    const suggestions = buildOptimizationSuggestions(snapshot);
    if (suggestions === null) {
      // 数据缺失：不生成建议并提示数据不可用（需求 9.12）。
      return { dataUnavailable: true };
    }
    return suggestions;
  }

  /**
   * 受限自动优化（需求 9.11、9.13、9.14）。
   *
   * - 仅在预算/出价授权上下限内自动应用调整，记录调整项/调整前后/精确到秒的时间（需求 9.11）。
   * - 超出授权范围的调整不应用、转为请求人工确认（需求 9.13）。
   * - 应用失败的调整保留原配置并记录失败原因（需求 9.14）。
   * - 数据缺失/Gemini 不可用时无可应用调整（需求 9.7、9.12）。
   */
  async applyAuto(
    actor: Actor,
    campaignId: string,
    bounds: AutoBounds,
  ): Promise<AutoApplyResult | AiUnavailable | { dataUnavailable: true }> {
    const analysis = await this.analyze(actor, campaignId);
    if ('unavailable' in analysis) {
      return analysis;
    }
    if ('dataUnavailable' in analysis) {
      return analysis;
    }

    const result: AutoApplyResult = { applied: [], needsManualConfirmation: [], failed: [] };

    for (const suggestion of analysis) {
      const disposition = classifyAdjustment(suggestion, bounds);
      if (disposition === 'manual') {
        // 超出授权范围：转人工确认（需求 9.13）。
        result.needsManualConfirmation.push(suggestion);
        continue;
      }

      try {
        if (this.applier) {
          await this.applier.apply(campaignId, suggestion.adjustmentItem, suggestion.after);
        }
        const applied: AppliedAdjustment = {
          adjustmentItem: suggestion.adjustmentItem,
          before: suggestion.before,
          after: suggestion.after,
          appliedAt: new Date(),
        };
        result.applied.push(applied);
      } catch (error) {
        // 应用失败：保留原配置并记录原因（需求 9.14）。
        result.failed.push({
          suggestion,
          reason: this.credentials.redact(
            error instanceof Error ? error.message : String(error),
          ),
        });
      }
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // 内部辅助
  // ---------------------------------------------------------------------------

  /** 据已确认草案驱动广告计划创建+投放，返回广告计划标识集合（需求 9.3、9.6）。 */
  private async driveToPublish(draft: CampaignDraft): Promise<string[]> {
    const platformDrafts = (draft.platformDrafts as PlatformDraft[] | null) ?? [];
    return this.publisher.publishFromDraft({
      merchantId: draft.merchantId,
      platformDrafts,
    });
  }
}
