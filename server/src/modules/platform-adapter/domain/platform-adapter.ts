/**
 * 平台适配器领域类型（组件 4，需求 8、10、11、13、19、20）。
 *
 * 定义 {@link PlatformAdapter} 接口与 {@link AdapterContext}，作为「统一广告对象模型 ↔
 * 平台原生 API」转换的唯一发生地。Meta/Google/TikTok 适配器在后续任务（10.2/10.4/10.6）
 * 中以**真实官方 API** 实现；LinkedIn 仅作第二期扩展位（需求 8.9、34.1），其方法体抛
 * NotImplementedException。
 *
 * `AdapterContext.callWithCredential` 经凭据管理器在内存中解密取令牌、用后立即清理
 *（需求 6.3、6.4），适配器内部不直接接触持久化的凭据明文。
 */
import type { BiddingStrategy, PlatformId } from '../../unified-model/domain/unified-model';

export type { BiddingStrategy, PlatformId };

/**
 * 适配器执行上下文：向适配器提供受控的凭据访问入口（需求 6.3）。
 *
 * 适配器调用平台官方 API 前，通过 {@link callWithCredential} 取得在内存中解密的凭据
 * 明文（access token、密钥等）；回调结束后凭据管理器立即清零内存明文（需求 6.4），
 * 适配器不得在回调外保留明文引用。
 */
export interface AdapterContext {
  /** 当前上下文绑定的平台标识。 */
  readonly platform: PlatformId;

  /**
   * 在内存中解密使用某项凭据并在回调结束后立即清理（需求 6.3、6.4）。
   *
   * @param name 凭据项名称（如 `accessToken`、`developerToken`）。
   * @param fn   使用明文凭据执行平台调用的回调；其返回值原样透传。
   * @throws 当对应平台凭据未配置时抛出「该平台凭据未配置」（需求 1.5）。
   */
  callWithCredential<T>(name: string, fn: (plain: string) => Promise<T>): Promise<T>;
}

/** 投放计划：承载已映射为平台原生字段的三级广告结构引用（需求 13.1）。 */
export interface UnifiedAdPlan {
  /** 平台无关的计划标识。 */
  planId: string;
  /** 代客户授权所对应的平台广告账户标识。 */
  accountId: string;
  /** 经统一模型层映射后的平台原生计划负载。 */
  native: Record<string, unknown>;
}

/** 发布结果（需求 13.1、13.3）。 */
export interface PublishResult {
  /** 平台侧返回的广告系列标识。 */
  platformCampaignId: string;
  /** 平台侧返回的各层级原生标识映射。 */
  nativeIds: Record<string, string>;
}

/** 受众定向条件（需求 10.1、10.3）。 */
export interface Targeting {
  /** 统一定向维度键值集合（国家地区/行业/职位/年龄/性别/兴趣等）。 */
  dimensions: Record<string, unknown>;
}

/** 定向应用结果（需求 10.3、10.4）。 */
export interface TargetingResult {
  /** 平台侧持久化的原生定向标识。 */
  nativeTargetingId: string;
  /** 在目标平台不适用、已被标记的维度名称（需求 10.4）。 */
  notApplicable: string[];
}

/** 待上传素材引用（需求 11.1、11.4）。 */
export interface AssetRef {
  /** 系统内素材唯一标识。 */
  assetId: string;
  /** 素材类型（视频/图片/PDF/轮播等）。 */
  type: string;
  /** 素材可访问地址或存储引用。 */
  source: string;
}

/** 素材上传结果（需求 11.4）。 */
export interface AssetUploadResult {
  /** 平台侧返回的素材标识。 */
  platformAssetId: string;
}

/** 线索表单配置（需求 14.1）。 */
export interface LeadFormConfig {
  /** 表单字段定义（公司名/姓名/电话/邮箱等必填项）。 */
  fields: Record<string, unknown>;
}

/** 线索表单挂载结果（需求 14.1）。 */
export interface LeadFormResult {
  /** 平台侧返回的线索表单标识。 */
  platformLeadFormId: string;
}

/** 转化追踪配置（需求 19.2）。 */
export interface ConversionConfig {
  /** 转化事件定义与映射。 */
  events: Record<string, unknown>;
}

/** 转化追踪提交结果（需求 19.2）。 */
export interface ConversionResult {
  /** 平台侧返回的转化追踪标识（如 Pixel/转化动作 ID）。 */
  platformTrackingId: string;
}

/** 指标拉取查询（需求 18.1）。 */
export interface MetricsQuery {
  /** 平台广告账户标识。 */
  accountId: string;
  /** 起始时间（含）。 */
  since: Date;
  /** 截止时间（含）。 */
  until: Date;
}

/** 平台原生指标载荷（需求 18.1）。 */
export interface NativeMetrics {
  /** 平台标识。 */
  platform: PlatformId;
  /** 平台原生指标行集合，待统一模型层归一化。 */
  rows: Record<string, unknown>[];
}

/** 平台原生审核状态（需求 20.1）。 */
export interface NativeReviewStatus {
  /** 平台侧广告标识。 */
  adId: string;
  /** 平台原生审核状态值，待归一化为三态。 */
  rawStatus: string;
}

/**
 * 平台适配器接口（组件 4）。
 *
 * 每个平台一个实现，新增平台不改动既有平台映射（需求 8.9）。所有方法经
 * {@link AdapterContext} 获取受控凭据访问，并对接对应平台的**真实官方 API**。
 */
export interface PlatformAdapter {
  /** 该适配器对应的平台标识。 */
  readonly platform: PlatformId;

  /** 发布投放计划至目标平台（需求 13.1）。 */
  publishCampaign(ctx: AdapterContext, plan: UnifiedAdPlan): Promise<PublishResult>;

  /** 将受众定向条件转换为平台原生定向参数并持久化（需求 10.3）。 */
  applyTargeting(ctx: AdapterContext, adGroupId: string, t: Targeting): Promise<TargetingResult>;

  /** 上传成品素材至目标平台（需求 11.4）。 */
  uploadAsset(ctx: AdapterContext, asset: AssetRef): Promise<AssetUploadResult>;

  /** 为指定广告挂载线索表单（需求 14.1）。 */
  attachLeadForm(ctx: AdapterContext, adId: string, form: LeadFormConfig): Promise<LeadFormResult>;

  /** 提交转化追踪配置（需求 19.2）。 */
  submitConversionTracking(ctx: AdapterContext, cfg: ConversionConfig): Promise<ConversionResult>;

  /** 拉取平台原生指标（需求 18.1）。 */
  fetchMetrics(ctx: AdapterContext, q: MetricsQuery): Promise<NativeMetrics>;

  /** 拉取平台原生审核状态（需求 20.1）。 */
  fetchReviewStatus(ctx: AdapterContext, adIds: string[]): Promise<NativeReviewStatus[]>;

  /** 该平台支持的出价策略集合（需求 26.1）。 */
  supportedBiddingStrategies(): BiddingStrategy[];
}
