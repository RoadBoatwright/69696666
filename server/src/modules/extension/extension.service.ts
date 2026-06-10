import { Injectable } from '@nestjs/common';

import type { PlatformId } from '../platform-adapter/domain/platform-adapter';
import type { BiddingStrategy } from '../unified-model/domain/unified-model';
import { GoogleCapabilitiesService } from './capabilities/google-capabilities.service';
import { MetaCapabilitiesService } from './capabilities/meta-capabilities.service';
import { TikTokCapabilitiesService } from './capabilities/tiktok-capabilities.service';
import type { CapabilityValidationError } from './domain/extension';
import { ExtensionGatewayService, type GatewayResult } from './extension-gateway.service';
import {
  resolveBiddingStrategy,
  validateAdvantagePlusControls,
  validateCreativeInputs,
  validateMessageAd,
  validateOfflineConversion,
  validatePmaxAssetGroup,
} from './pure';

/** 校验失败结果：列出全部不符合项及原因（需求 23.4、25.3、32.3）。 */
export type ValidatedResult<T> =
  | GatewayResult<T>
  | { kind: 'invalid'; errors: CapabilityValidationError[] };

/**
 * 高级投放能力应用服务（任务 29、32、33、36、37、38）。
 *
 * 在扩展能力网关之上编排各能力：先做统一入参校验（纯函数，错误点名具体字段与原因），
 * 再经网关路由（支持集 + 凭据状态）到对应平台执行器发起**真实平台 API** 调用。
 * LinkedIn B2B 能力本期一律由网关返回「该能力第二期提供」（需求 34.3）。
 */
@Injectable()
export class ExtensionService {
  constructor(
    private readonly gateway: ExtensionGatewayService,
    private readonly meta: MetaCapabilitiesService,
    private readonly google: GoogleCapabilitiesService,
    private readonly tiktok: TikTokCapabilitiesService,
  ) {}

  /**
   * 创建 Meta Advantage+ 全自动系列（任务 29，需求 23）。
   *
   * 硬控制项校验失败时点名具体控制项与原因（需求 23.4）；非 Meta 平台经网关返回
   * 「该平台不支持此能力」（需求 23.5）；Meta 定向建议作为可选项返回（需求 23.3）。
   */
  async createAdvantagePlus(
    platform: PlatformId,
    accountId: string,
    name: string,
    hardControls: Record<string, unknown>,
  ): Promise<ValidatedResult<{ campaignId: string; targetingSuggestions: unknown[] }>> {
    const validation = validateAdvantagePlusControls(hardControls);
    if (!validation.ok) {
      return { kind: 'invalid', errors: validation.errors };
    }
    return this.gateway.invoke('advantage_plus', platform, () =>
      this.meta.createAdvantagePlusCampaign(accountId, name, hardControls),
    );
  }

  /**
   * 创建 Google Performance Max 系列 + 资产组（任务 31，需求 25）。
   *
   * 资产组校验失败时一次性返回**所有**不符合项（需求 25.3）；非 Google 平台经网关
   * 返回「该平台不支持此能力」（需求 25.4）；版位按 PMax 全自动跨版位（需求 33.7）。
   */
  async createPerformanceMax(
    platform: PlatformId,
    customerId: string,
    name: string,
    budgetResourceName: string,
    assetGroup: {
      name: string;
      headlines: string[];
      descriptions: string[];
      images: string[];
      videos?: string[];
    },
  ): Promise<ValidatedResult<{ campaignResourceName: string; assetGroupResourceName: string }>> {
    const validation = validatePmaxAssetGroup(assetGroup);
    if (!validation.ok) {
      return { kind: 'invalid', errors: validation.errors };
    }
    return this.gateway.invoke('performance_max', platform, async () => {
      const campaign = await this.google.createPerformanceMaxCampaign(
        customerId,
        name,
        budgetResourceName,
      );
      const group = await this.google.createAssetGroup(
        customerId,
        campaign.campaignResourceName,
        assetGroup.name,
        assetGroup,
      );
      return {
        campaignResourceName: campaign.campaignResourceName,
        assetGroupResourceName: group.assetGroupResourceName,
      };
    });
  }

  /**
   * 应用统一智能出价策略（任务 32，需求 26）。
   *
   * 统一枚举 → 平台原生出价参数转换由纯函数完成：不支持时「出价方式不受支持」
   * （需求 26.4）、Target CPA/ROAS 缺目标值时点名缺失项（需求 26.3）；转换通过后
   * 经平台 API 持久化（需求 26.2）。
   */
  async applyBiddingStrategy(
    platform: PlatformId,
    accountRef: string,
    targetRef: string,
    strategy: BiddingStrategy,
    targetValue?: number,
  ): Promise<ValidatedResult<{ applied: true; nativeParam: string }>> {
    if (platform === 'linkedin') {
      return this.gateway.invoke('smart_bidding', platform, async () => {
        throw new Error('unreachable');
      }) as Promise<ValidatedResult<{ applied: true; nativeParam: string }>>;
    }
    const resolution = resolveBiddingStrategy(platform, strategy, targetValue);
    if (!resolution.ok) {
      const errors: CapabilityValidationError[] =
        resolution.error === '目标值缺失'
          ? [{ field: resolution.missing, reason: '目标值缺失' }]
          : [{ field: 'strategy', reason: '出价方式不受支持' }];
      return { kind: 'invalid', errors };
    }
    return this.gateway.invoke('smart_bidding', platform, async () => {
      if (platform === 'meta') {
        await this.meta.applyBidding(targetRef, resolution.nativeParam, resolution.targetValue);
      } else if (platform === 'google') {
        await this.google.applyBidding(
          accountRef,
          targetRef,
          resolution.nativeParam,
          resolution.targetValue,
        );
      } else {
        await this.tiktok.applyBidding(
          accountRef,
          targetRef,
          resolution.nativeParam,
          resolution.targetValue,
        );
      }
      return { applied: true as const, nativeParam: resolution.nativeParam };
    });
  }

  /**
   * 创建 TikTok Spark Ads（任务 33，需求 27）。
   *
   * 仅 TikTok 支持（需求 27.4 由网关支持集保证）；账户上限错误由执行器抛
   * 「Spark Ads 数量超过账户上限」（需求 27.3）。
   */
  async createSparkAd(
    platform: PlatformId,
    advertiserId: string,
    adgroupId: string,
    tiktokItemId: string,
    identityId: string,
    authCode: string,
  ): Promise<GatewayResult<{ adId: string }>> {
    return this.gateway.invoke('spark_ads', platform, () =>
      this.tiktok.createSparkAd(advertiserId, adgroupId, tiktokItemId, identityId, authCode),
    );
  }

  /**
   * 创建 CTWA/CTM 消息广告（任务 36，需求 30）。
   *
   * 预填消息与会话路由配置必填（需求 30.3）；WhatsApp 渠道未配置时返回
   * 「WhatsApp 渠道未配置」（需求 30.4）。
   */
  async createMessageAd(
    platform: PlatformId,
    accountId: string,
    destination: 'whatsapp' | 'messenger',
    prefilledMessage: string,
    routing: Record<string, unknown> | undefined,
    whatsappConfigured: boolean,
  ): Promise<ValidatedResult<{ creativeId: string }>> {
    const validation = validateMessageAd({
      destination,
      prefilledMessage,
      routing,
      whatsappConfigured,
    });
    if (!validation.ok) {
      return { kind: 'invalid', errors: validation.errors };
    }
    return this.gateway.invoke('message_ads', platform, () =>
      this.meta.createMessageAd(accountId, destination, prefilledMessage, routing ?? {}),
    );
  }

  /**
   * AI 创意增强（任务 37，需求 31）。
   *
   * 可选增强能力、不阻塞主线（需求 31.1，由调用方按可选链路使用）；产品素材或目标
   * 语言缺失时点名缺失项（需求 31.4）；平台调用失败时记录并返回失败原因（需求 31.5）。
   */
  async generateCreatives(
    platform: PlatformId,
    accountRef: string,
    productAssets: Record<string, unknown>[],
    targetLanguages: string[],
  ): Promise<
    ValidatedResult<{ language: string; creativeId: string }[]> | { kind: 'failed'; reason: string }
  > {
    const validation = validateCreativeInputs({ productAssets, targetLanguages });
    if (!validation.ok) {
      return { kind: 'invalid', errors: validation.errors };
    }
    try {
      return await this.gateway.invoke('ai_creative', platform, () => {
        if (platform === 'meta') {
          return this.meta.generateDynamicCreatives(accountRef, productAssets, targetLanguages);
        }
        if (platform === 'google') {
          return this.google.generateCreativeAssets(accountRef, productAssets, targetLanguages);
        }
        return this.tiktok.generateSymphonyCreatives(accountRef, productAssets, targetLanguages);
      });
    } catch (error) {
      // 增强失败不阻塞主线：记录并返回失败原因（需求 31.5）。
      return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * 离线/CRM 转化回传（任务 38，需求 32）。
   *
   * eventId/eventTime/value 必填、缺失时列出全部缺失项（需求 32.3）；上传失败时
   * 记录失败原因并保留事件数据供重试（需求 32.5，由调用方持有原始事件）。
   */
  async uploadOfflineConversions(
    platform: PlatformId,
    targetRef: string,
    events: { eventId: string; eventTime: string; value: number; currency?: string }[],
    googleConversionAction?: string,
  ): Promise<
    ValidatedResult<{ received: number }> | { kind: 'failed'; reason: string; retained: number }
  > {
    const allErrors: CapabilityValidationError[] = [];
    events.forEach((event, index) => {
      const validation = validateOfflineConversion(event);
      if (!validation.ok) {
        allErrors.push(
          ...validation.errors.map((err) => ({
            field: `events[${index}].${err.field}`,
            reason: err.reason,
          })),
        );
      }
    });
    if (allErrors.length > 0) {
      return { kind: 'invalid', errors: allErrors };
    }
    try {
      return await this.gateway.invoke('offline_conversion', platform, () => {
        if (platform === 'meta') {
          return this.meta.uploadOfflineConversions(targetRef, events);
        }
        return this.google.uploadOfflineConversions(
          targetRef,
          googleConversionAction ?? '',
          events,
        );
      });
    } catch (error) {
      // 失败时保留事件数据供重试（需求 32.5）。
      return {
        kind: 'failed',
        reason: error instanceof Error ? error.message : String(error),
        retained: events.length,
      };
    }
  }
}
