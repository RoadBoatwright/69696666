import type { PlatformId } from '../../platform-adapter/domain/platform-adapter';

/**
 * 平台扩展能力标识（需求 22.1，任务 28-40）。
 *
 * 每个扩展能力按平台命名空间暴露，可用平台范围经
 * {@link CAPABILITY_SUPPORT} 查询（需求 22.1）。
 */
export type CapabilityId =
  | 'advantage_plus' // Meta Advantage+ 全自动系列（需求 23）
  | 'product_catalog' // 商品目录与动态商品广告（需求 24）
  | 'performance_max' // Google Performance Max（需求 25）
  | 'smart_bidding' // 智能出价策略全集（需求 26）
  | 'spark_ads' // TikTok Spark Ads（需求 27）
  | 'ab_experiment' // 统一 A/B 实验（需求 28）
  | 'pre_estimate' // 投前效果预估（需求 29）
  | 'message_ads' // CTWA / CTM 消息广告（需求 30）
  | 'ai_creative' // AI 创意生成（需求 31）
  | 'offline_conversion' // 离线/CRM 转化回传（需求 32）
  | 'placement_management' // 广告版位管理（需求 33）
  | 'linkedin_b2b'; // LinkedIn B2B 扩展位（第二期，需求 34）

/** 扩展能力 → 支持平台集合（需求 22.1、22.3）。 */
export const CAPABILITY_SUPPORT: Readonly<Record<CapabilityId, readonly PlatformId[]>> = {
  advantage_plus: ['meta'],
  product_catalog: ['meta', 'google', 'tiktok'],
  performance_max: ['google'],
  smart_bidding: ['meta', 'google', 'tiktok'],
  spark_ads: ['tiktok'],
  ab_experiment: ['meta', 'google', 'tiktok'],
  pre_estimate: ['meta', 'google'],
  message_ads: ['meta'],
  ai_creative: ['meta', 'google', 'tiktok'],
  offline_conversion: ['meta', 'google'],
  placement_management: ['meta', 'google', 'tiktok'],
  linkedin_b2b: ['linkedin'],
};

/** 全部扩展能力标识（用于注册与生成器）。 */
export const CAPABILITY_IDS = Object.keys(CAPABILITY_SUPPORT) as readonly CapabilityId[];

/** 网关路由判定结果（需求 22.2-22.6、34.3）。 */
export type CapabilityRouting =
  | { kind: 'route'; capability: CapabilityId; platform: PlatformId }
  | {
      kind: 'unsupported';
      error: '该平台不支持此能力';
      capability: CapabilityId;
      platform: PlatformId;
    }
  | {
      kind: 'credential_missing';
      error: '该平台凭据未配置';
      capability: CapabilityId;
      platform: PlatformId;
    }
  | { kind: 'deferred'; error: '该能力第二期提供'; capability: CapabilityId; platform: PlatformId };

/** 校验失败的不符合项（需求 23.4、25.3、30.3 等）。 */
export interface CapabilityValidationError {
  /** 不符合项名称。 */
  field: string;
  /** 失败原因。 */
  reason: string;
}

/** 校验结果：通过或包含全部不符合项。 */
export type CapabilityValidation =
  | { ok: true }
  | { ok: false; errors: CapabilityValidationError[] };
