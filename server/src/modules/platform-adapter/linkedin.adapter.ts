import { Injectable, NotImplementedException } from '@nestjs/common';

import type {
  AdapterContext,
  AssetRef,
  AssetUploadResult,
  BiddingStrategy,
  ConversionConfig,
  ConversionResult,
  LeadFormConfig,
  LeadFormResult,
  MetricsQuery,
  NativeMetrics,
  NativeReviewStatus,
  PlatformAdapter,
  PlatformId,
  PublishResult,
  Targeting,
  TargetingResult,
  UnifiedAdPlan,
} from './domain/platform-adapter';

/**
 * LinkedIn 第二期平台扩展位（组件 4，需求 8.9、34.1、34.3）。
 *
 * 本期不实现 LinkedIn 投放能力。该适配器仅作为第二期平台扩展位存在，所有 {@link PlatformAdapter}
 * 方法体一律抛出 {@link NotImplementedException}，对应需求 34.3「该能力第二期提供」语义：
 * 第二期实现前对 LinkedIn 发起任一调用时返回明确的「第二期提供」提示并不执行调用。
 *
 * 新增本适配器**不改动**既有 Meta/Google/TikTok 的字段映射与实现（需求 8.9、34.2）：它仅作为
 * 一个独立 provider 经 {@link PLATFORM_ADAPTERS} 集合注入注册表，第二期落地 LinkedIn 真实
 * 能力时只需替换本类方法体，无需触碰既有平台适配器（需求 34.4）。
 */
@Injectable()
export class LinkedInAdapter implements PlatformAdapter {
  /** 该适配器对应的平台标识。 */
  readonly platform: PlatformId = 'linkedin';

  /** 第二期提供：发布投放计划（需求 13.1、34.3）。 */
  async publishCampaign(_ctx: AdapterContext, _plan: UnifiedAdPlan): Promise<PublishResult> {
    throw this.secondPhase('publishCampaign');
  }

  /** 第二期提供：应用受众定向（需求 10.3、34.3）。 */
  async applyTargeting(
    _ctx: AdapterContext,
    _adGroupId: string,
    _t: Targeting,
  ): Promise<TargetingResult> {
    throw this.secondPhase('applyTargeting');
  }

  /** 第二期提供：上传素材（需求 11.4、34.3）。 */
  async uploadAsset(_ctx: AdapterContext, _asset: AssetRef): Promise<AssetUploadResult> {
    throw this.secondPhase('uploadAsset');
  }

  /** 第二期提供：挂载线索表单（需求 14.1、34.3）。 */
  async attachLeadForm(
    _ctx: AdapterContext,
    _adId: string,
    _form: LeadFormConfig,
  ): Promise<LeadFormResult> {
    throw this.secondPhase('attachLeadForm');
  }

  /** 第二期提供：提交转化追踪（需求 19.2、34.3）。 */
  async submitConversionTracking(
    _ctx: AdapterContext,
    _cfg: ConversionConfig,
  ): Promise<ConversionResult> {
    throw this.secondPhase('submitConversionTracking');
  }

  /** 第二期提供：拉取平台原生指标（需求 18.1、34.3）。 */
  async fetchMetrics(_ctx: AdapterContext, _q: MetricsQuery): Promise<NativeMetrics> {
    throw this.secondPhase('fetchMetrics');
  }

  /** 第二期提供：拉取平台原生审核状态（需求 20.1、34.3）。 */
  async fetchReviewStatus(_ctx: AdapterContext, _adIds: string[]): Promise<NativeReviewStatus[]> {
    throw this.secondPhase('fetchReviewStatus');
  }

  /** 第二期提供：支持的出价策略集合（需求 26.1、34.3）。 */
  supportedBiddingStrategies(): BiddingStrategy[] {
    throw this.secondPhase('supportedBiddingStrategies');
  }

  /** 构造统一的「该能力第二期提供」未实现异常（需求 34.3）。 */
  private secondPhase(capability: string): NotImplementedException {
    return new NotImplementedException(
      `LinkedIn「${capability}」为第二期平台扩展位，该能力第二期提供`,
    );
  }
}
