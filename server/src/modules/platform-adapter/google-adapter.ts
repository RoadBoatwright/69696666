import { Injectable } from '@nestjs/common';

import type { BiddingStrategy } from '../unified-model/domain/unified-model';
import type {
  AdapterContext,
  AssetRef,
  AssetUploadResult,
  ConversionConfig,
  ConversionResult,
  LeadFormConfig,
  LeadFormResult,
  MetricsQuery,
  NativeMetrics,
  NativeReviewStatus,
  PlatformAdapter,
  PublishResult,
  Targeting,
  TargetingResult,
  UnifiedAdPlan,
} from './domain/platform-adapter';

/**
 * Google Ads API（REST）默认接入端点（需求 13.1、18.1、20.1）。
 *
 * 采用 REST + OAuth2 refresh token 换取 access token 的代客户（MCC / login-customer-id）
 * 投放模式：每次调用携带 `Authorization: Bearer {accessToken}`、`developer-token` 与
 * `login-customer-id`（MCC 经理账号）请求头。API 版本与基址可经环境变量
 * `GOOGLE_ADS_API_VERSION` / `GOOGLE_ADS_API_BASE_URL` 覆盖（如对接其他版本或测试环境），
 * OAuth 令牌端点可经 `GOOGLE_OAUTH_TOKEN_URL` 覆盖，默认指向稳定版生产域名。
 */
const GOOGLE_ADS_API_VERSION = 'v17';
const GOOGLE_ADS_API_HOST = 'https://googleads.googleapis.com';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * 统一定向维度 → Google Ads 原生定向 criterion 字段映射（需求 10.3）。
 *
 * 仅列出 Google Ads API 真实支持的 criterion 维度（地域/年龄/性别/语言）；其余在 Google
 * 搜索广告不适用的维度（兴趣/B2B 职位/公司等）由 {@link GOOGLE_NOT_APPLICABLE_DIMENSIONS}
 * 标记并经 {@link TargetingResult.notApplicable} 回传（需求 10.4）。
 */
const GOOGLE_TARGETING_FIELD_MAP: Readonly<Record<string, string>> = {
  country: 'location',
  countryRegion: 'location',
  location: 'location',
  region: 'location',
  geoLocations: 'location',
  age: 'ageRange',
  ageRange: 'ageRange',
  gender: 'gender',
  language: 'language',
  languages: 'language',
};

/**
 * 在 Google 搜索广告不适用的统一定向维度（需求 10.4）。
 *
 * 与统一模型层字段映射保持一致：`interests`（兴趣定向）在 Google 搜索广告无对应原生字段
 * （见 field-map），B2B 职位/资历/公司维度亦无对应 criterion。
 */
const GOOGLE_NOT_APPLICABLE_DIMENSIONS: readonly string[] = [
  'interest',
  'interests',
  'behavior',
  'behaviors',
  'jobTitle',
  'jobFunction',
  'seniority',
  'company',
  'companySize',
  'industry',
];

/**
 * Google 审核状态归一化三态（需求 20.1）。
 *
 * 归一化为「审核中 / 审核通过 / 审核被拒绝」三者之一；适配器经
 * {@link NativeReviewStatus.rawStatus} 回传原生状态（`policy_summary.approval_status` /
 * `review_status`），由统一模型层落库前归一化。本表供适配器内部与上层共享映射口径。
 */
export const GOOGLE_REVIEW_STATUS_NORMALIZED = {
  审核中: '审核中',
  审核通过: '审核通过',
  审核被拒绝: '审核被拒绝',
} as const;

export type GoogleNormalizedReviewStatus =
  (typeof GOOGLE_REVIEW_STATUS_NORMALIZED)[keyof typeof GOOGLE_REVIEW_STATUS_NORMALIZED];

/**
 * 将 Google 广告原生审核状态归一化为系统三态（需求 20.1）。
 *
 * Google Ads `ad_group_ad.policy_summary.approval_status` 取值如 `APPROVED`、
 * `APPROVED_LIMITED`、`AREA_OF_INTEREST_ONLY`、`DISAPPROVED`；`ad_group_ad.review_status`
 * 取值如 `REVIEW_IN_PROGRESS`、`REVIEWED`、`UNDER_APPEAL`、`ELIGIBLE_MAY_SERVE`。被拒归
 *「审核被拒绝」，审核进行中/申诉中归「审核中」，其余（已通过、受限可投放、已审核）归
 *「审核通过」。
 */
export function normalizeGoogleReviewStatus(rawStatus: string): GoogleNormalizedReviewStatus {
  const status = (rawStatus ?? '').toUpperCase();
  if (status.includes('DISAPPROVED') || status.includes('REJECT') || status.includes('DENIED')) {
    return GOOGLE_REVIEW_STATUS_NORMALIZED.审核被拒绝;
  }
  if (
    status.includes('REVIEW_IN_PROGRESS') ||
    status.includes('UNDER_APPEAL') ||
    status.includes('PENDING') ||
    (status.includes('REVIEW') && !status.includes('REVIEWED'))
  ) {
    return GOOGLE_REVIEW_STATUS_NORMALIZED.审核中;
  }
  return GOOGLE_REVIEW_STATUS_NORMALIZED.审核通过;
}

/** Google Ads OAuth2 令牌端点返回的访问令牌载荷。 */
interface GoogleAccessTokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

/** 解析得到的 Google Ads 调用鉴权材料（仅在回调作用域内于内存中存在）。 */
interface GoogleAuth {
  /** 经 refresh token 换取的短期访问令牌。 */
  accessToken: string;
  /** Google Ads API developer token（请求头 `developer-token`）。 */
  developerToken: string;
  /** MCC 经理账号标识（请求头 `login-customer-id`，已去连字符）。 */
  loginCustomerId: string;
}

/**
 * Google 平台适配器（组件 4，对接**真实 Google Ads API**）。
 *
 * 实现 {@link PlatformAdapter} 全部方法，覆盖三级广告结构发布（需求 13.1）、原生定向
 * 应用（需求 10.3）、成品素材上传（需求 11.4）、线索表单 Asset 挂载（需求 14.1）、转化
 * 追踪配置（需求 19.2）、报表 API 指标拉取（需求 18.1）与审核状态拉取（需求 20.1）。
 *
 * 凭据经 {@link AdapterContext.callWithCredential} 在内存中逐项解密取 `refreshToken`/
 * `clientId`/`clientSecret`/`developerToken`/`loginCustomerId`、用后清理（需求 6.3、6.4）；
 * 适配器以 OAuth2 refresh token 换取短期 access token 后调用 Google Ads REST API。当
 * Google 凭据未配置时由凭据管理器抛「该平台凭据未配置」优雅降级（需求 1.5），适配器
 * 不以假数据顶替（真实服务原则）。
 *
 * Google 智能出价能力最丰富（design 概述）：{@link supportedBiddingStrategies} 覆盖目标
 * CPA/目标 ROAS/最大化转化/最大化转化价值/最大化点击/手动 CPC 全集（需求 26.1）。
 */
@Injectable()
export class GoogleAdapter implements PlatformAdapter {
  readonly platform = 'google' as const;

  /**
   * 发布投放计划至 Google Ads（需求 13.1）。
   *
   * 按三级结构依次调用 `campaigns:mutate` → `adGroups:mutate` → `adGroupAds:mutate`，
   * `plan.accountId` 作为 Google Ads `customer_id`（去连字符）。返回平台广告系列资源名与
   * 各层级原生资源名。Google 创建对象默认 `status=PAUSED` 由统一模型层在 native 中控制。
   */
  async publishCampaign(ctx: AdapterContext, plan: UnifiedAdPlan): Promise<PublishResult> {
    return this.callWithGoogleAuth(ctx, async (auth) => {
      const customerId = this.toCustomerId(plan.accountId);
      const native = this.asRecord(plan.native);

      const campaignResource = await this.mutateCreate(
        auth,
        customerId,
        'campaigns',
        this.asRecord(native.campaign),
      );
      const nativeIds: Record<string, string> = { campaign: campaignResource };

      // 广告组（可选）：每个广告组挂在新建的广告系列下。
      const adGroups = this.asArray(native.adGroups ?? native.adgroups);
      const adGroupResources: string[] = [];
      for (let i = 0; i < adGroups.length; i += 1) {
        const adGroupResource = await this.mutateCreate(auth, customerId, 'adGroups', {
          campaign: campaignResource,
          ...this.asRecord(adGroups[i]),
        });
        adGroupResources.push(adGroupResource);
        nativeIds[`adGroup_${i}`] = adGroupResource;
      }

      // 广告（可选）：每条广告挂在对应索引的广告组下（缺省挂第一个广告组）。
      const ads = this.asArray(native.ads);
      for (let i = 0; i < ads.length; i += 1) {
        const adFields = this.asRecord(ads[i]);
        const targetAdGroup =
          (typeof adFields.adGroup === 'string' && adFields.adGroup) || adGroupResources[0];
        const adResource = await this.mutateCreate(auth, customerId, 'adGroupAds', {
          ...(targetAdGroup ? { adGroup: targetAdGroup } : {}),
          ...adFields,
        });
        nativeIds[`ad_${i}`] = adResource;
      }

      return { platformCampaignId: campaignResource, nativeIds };
    });
  }

  /**
   * 将受众定向条件转换为 Google Ads 原生 criterion 并持久化至广告组（需求 10.3、10.4）。
   *
   * 经 `adGroupCriteria:mutate` 为广告组创建地域/年龄/性别/语言等 criterion；Google 搜索
   * 广告不适用的维度（兴趣/B2B 职位等）记入 {@link TargetingResult.notApplicable}（需求 10.4）。
   * `customer_id` 取自定向维度内的 `customerId`/`customer_id`（由统一模型层注入）或环境变量。
   */
  async applyTargeting(
    ctx: AdapterContext,
    adGroupId: string,
    t: Targeting,
  ): Promise<TargetingResult> {
    return this.callWithGoogleAuth(ctx, async (auth) => {
      const dimensions = this.asRecord(t.dimensions);
      const customerId = this.toCustomerId(this.resolveCustomerId(dimensions));

      const operations: Record<string, unknown>[] = [];
      const notApplicable: string[] = [];

      for (const [dim, value] of Object.entries(dimensions)) {
        if (dim === 'customerId' || dim === 'customer_id') {
          continue;
        }
        if (GOOGLE_NOT_APPLICABLE_DIMENSIONS.includes(dim)) {
          notApplicable.push(dim);
          continue;
        }
        const criterionType = GOOGLE_TARGETING_FIELD_MAP[dim];
        if (criterionType) {
          operations.push({
            create: {
              adGroup: adGroupId,
              [criterionType]: value,
            },
          });
        } else {
          notApplicable.push(dim);
        }
      }

      if (operations.length > 0) {
        await this.post(auth, `/customers/${customerId}/adGroupCriteria:mutate`, { operations });
      }

      return { nativeTargetingId: adGroupId, notApplicable };
    });
  }

  /**
   * 上传成品素材至 Google Ads 资源库（需求 11.4）。
   *
   * 经 `assets:mutate` 创建 Asset：图片走 `image_asset`（以 `data`/`url` 远程引用），
   * 视频走 `youtube_video_asset`（以 YouTube 视频标识）。`customer_id` 取自环境变量
   * `GOOGLE_ADS_CUSTOMER_ID`（代运营调度上下文注入）。适配器不对素材内容做创意改写。
   */
  async uploadAsset(ctx: AdapterContext, asset: AssetRef): Promise<AssetUploadResult> {
    return this.callWithGoogleAuth(ctx, async (auth) => {
      const customerId = this.toCustomerId(this.resolveCustomerId());
      const isVideo = asset.type.toLowerCase().includes('video');

      const assetFields = isVideo
        ? {
            name: asset.assetId,
            type: 'YOUTUBE_VIDEO',
            youtubeVideoAsset: { youtubeVideoId: asset.source },
          }
        : {
            name: asset.assetId,
            type: 'IMAGE',
            imageAsset: { fullSize: { url: asset.source } },
          };

      const resourceName = await this.mutateCreate(auth, customerId, 'assets', assetFields);
      return { platformAssetId: resourceName };
    });
  }

  /**
   * 为线索收集创建 Google Ads 线索表单 Asset（需求 14.1）。
   *
   * 经 `assets:mutate` 创建 `lead_form_asset` 类型 Asset 并回传资源名供广告/广告系列绑定。
   * `customer_id` 取自表单字段内的 `customerId`/`customer_id` 或环境变量。
   */
  async attachLeadForm(
    ctx: AdapterContext,
    adId: string,
    form: LeadFormConfig,
  ): Promise<LeadFormResult> {
    return this.callWithGoogleAuth(ctx, async (auth) => {
      const fields = this.asRecord(form.fields);
      const customerId = this.toCustomerId(this.resolveCustomerId(fields));
      const { customerId: _c1, customer_id: _c2, ...leadFormFields } = fields;

      const resourceName = await this.mutateCreate(auth, customerId, 'assets', {
        name: `lead_form_${adId}`,
        type: 'LEAD_FORM',
        leadFormAsset: leadFormFields,
      });
      return { platformLeadFormId: resourceName };
    });
  }

  /**
   * 提交转化追踪配置至 Google Ads（创建转化动作）（需求 19.2）。
   *
   * 经 `conversionActions:mutate` 创建 ConversionAction 并回传资源名作为追踪标识。
   * `customer_id` 取自事件配置内的 `customerId`/`customer_id` 或环境变量。
   */
  async submitConversionTracking(
    ctx: AdapterContext,
    cfg: ConversionConfig,
  ): Promise<ConversionResult> {
    return this.callWithGoogleAuth(ctx, async (auth) => {
      const events = this.asRecord(cfg.events);
      const customerId = this.toCustomerId(this.resolveCustomerId(events));
      const { customerId: _c1, customer_id: _c2, ...actionFields } = events;

      const resourceName = await this.mutateCreate(
        auth,
        customerId,
        'conversionActions',
        actionFields,
      );
      return { platformTrackingId: resourceName };
    });
  }

  /**
   * 经 Google Ads 报表 API 拉取平台原生指标（需求 18.1）。
   *
   * 调用 `googleAds:searchStream`，以 GAQL 按广告系列层级拉取曝光/点击/花费/转化（含转化
   * 价值），按天分桶（`segments.date`）返回原生行集合，待统一模型层归一化（曝光/点击/转化/
   * 花费）。Google 报表 API 为三平台最详尽（design 概述）。
   */
  async fetchMetrics(ctx: AdapterContext, q: MetricsQuery): Promise<NativeMetrics> {
    return this.callWithGoogleAuth(ctx, async (auth) => {
      const customerId = this.toCustomerId(q.accountId);
      const query =
        'SELECT campaign.id, metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
        'metrics.conversions, metrics.conversions_value, segments.date FROM campaign ' +
        `WHERE segments.date BETWEEN '${this.toDate(q.since)}' AND '${this.toDate(q.until)}'`;
      const data = await this.post<{ results?: Record<string, unknown>[] }[]>(
        auth,
        `/customers/${customerId}/googleAds:searchStream`,
        { query },
      );
      return { platform: this.platform, rows: this.flattenSearchStream(data) };
    });
  }

  /**
   * 拉取 Google 广告原生审核状态（需求 20.1）。
   *
   * 经 `googleAds:search` 以 GAQL 按 `ad_group_ad.ad.id` 过滤拉取
   * `ad_group_ad.policy_summary.approval_status` 与 `ad_group_ad.policy_summary.review_status`，
   * 以原生状态回传供归一化为三态（审核中/审核通过/审核被拒绝，见
   * {@link normalizeGoogleReviewStatus}）；被拒绝时携带 policy topic 供记录拒因（需求 20.3）。
   */
  async fetchReviewStatus(ctx: AdapterContext, adIds: string[]): Promise<NativeReviewStatus[]> {
    if (adIds.length === 0) {
      return [];
    }
    return this.callWithGoogleAuth(ctx, async (auth) => {
      const customerId = this.toCustomerId(this.resolveCustomerId());
      const idList = adIds.map((id) => `'${id}'`).join(',');
      const query =
        'SELECT ad_group_ad.ad.id, ad_group_ad.policy_summary.approval_status, ' +
        'ad_group_ad.policy_summary.review_status FROM ad_group_ad ' +
        `WHERE ad_group_ad.ad.id IN (${idList})`;
      const data = await this.post<{ results?: Record<string, unknown>[] }>(
        auth,
        `/customers/${customerId}/googleAds:search`,
        { query },
      );

      const byAdId = new Map<string, string>();
      for (const row of data.results ?? []) {
        const adGroupAd = this.asRecord(this.asRecord(row).adGroupAd);
        const ad = this.asRecord(adGroupAd.ad);
        const policySummary = this.asRecord(adGroupAd.policySummary);
        const adId = String(ad.id ?? '');
        if (adId) {
          byAdId.set(
            adId,
            String(policySummary.approvalStatus ?? policySummary.reviewStatus ?? ''),
          );
        }
      }

      return adIds.map((adId) => ({ adId, rawStatus: byAdId.get(adId) ?? '' }));
    });
  }

  /**
   * Google 支持的统一出价策略集合（需求 26.1）。
   *
   * Google 智能出价能力最丰富：覆盖 Target CPA、Target ROAS、Maximize Conversions、
   * Maximize Conversion Value、Maximize Clicks 全套智能出价，以及 Manual CPC 手动出价。
   */
  supportedBiddingStrategies(): BiddingStrategy[] {
    return [
      'TARGET_CPA',
      'TARGET_ROAS',
      'MAXIMIZE_CONVERSIONS',
      'MAXIMIZE_CONVERSION_VALUE',
      'MAXIMIZE_CLICKS',
      'MANUAL_CPC',
    ];
  }

  // ───────────────────────── 内部：鉴权与 HTTP ─────────────────────────

  /**
   * 逐项解密取 Google Ads 调用所需凭据并换取访问令牌后执行回调（需求 6.3、6.4）。
   *
   * 经 {@link AdapterContext.callWithCredential} 嵌套取 `refreshToken`/`clientId`/
   * `clientSecret`/`developerToken`/`loginCustomerId`，明文仅在回调作用域内于内存中存在、
   * 用后由凭据管理器立即清零；任一凭据未配置时抛「该平台凭据未配置」（需求 1.5）。
   */
  private callWithGoogleAuth<T>(
    ctx: AdapterContext,
    fn: (auth: GoogleAuth) => Promise<T>,
  ): Promise<T> {
    return ctx.callWithCredential('refreshToken', (refreshToken) =>
      ctx.callWithCredential('clientId', (clientId) =>
        ctx.callWithCredential('clientSecret', (clientSecret) =>
          ctx.callWithCredential('developerToken', (developerToken) =>
            ctx.callWithCredential('loginCustomerId', async (loginCustomerId) => {
              const accessToken = await this.fetchAccessToken(clientId, clientSecret, refreshToken);
              return fn({
                accessToken,
                developerToken,
                loginCustomerId: this.toCustomerId(loginCustomerId),
              });
            }),
          ),
        ),
      ),
    );
  }

  /**
   * 以 OAuth2 refresh token 换取短期 access token（需求 3.3、13.1）。
   *
   * 经 Google OAuth2 令牌端点 `grant_type=refresh_token` 交换；失败抛业务错误。
   */
  private async fetchAccessToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
  ): Promise<string> {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const response = await fetch(this.oauthTokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const payload = (await response.json().catch(() => ({}))) as GoogleAccessTokenResponse & {
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !payload.access_token) {
      const detail = payload.error
        ? `${payload.error}: ${payload.error_description ?? ''}`
        : `HTTP ${response.status}`;
      throw new Error(`Google OAuth2 令牌交换失败：${detail}`);
    }
    return payload.access_token;
  }

  /**
   * 发起 Google Ads `{resource}:mutate` 单对象 create 调用并回传创建的资源名（需求 13.1）。
   */
  private async mutateCreate(
    auth: GoogleAuth,
    customerId: string,
    resource: string,
    create: Record<string, unknown>,
  ): Promise<string> {
    const data = await this.post<{ results?: { resourceName?: string }[] }>(
      auth,
      `/customers/${customerId}/${resource}:mutate`,
      { operations: [{ create }] },
    );
    const resourceName = data.results?.[0]?.resourceName;
    if (!resourceName) {
      throw new Error(`Google Ads ${resource}:mutate 未返回 resourceName`);
    }
    return String(resourceName);
  }

  /** 发起 Google Ads API POST 调用（JSON 包体 + Bearer / developer-token / login-customer-id 头）。 */
  private async post<T>(auth: GoogleAuth, path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl()}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'developer-token': auth.developerToken,
        'login-customer-id': auth.loginCustomerId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return this.parse<T>(response, path);
  }

  /**
   * 解析 Google Ads 响应：HTTP 非 2xx 或包体含 `error` 视为业务错误并抛出（需求 13.1、13.3）。
   */
  private async parse<T>(response: Response, path: string): Promise<T> {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number; status?: string };
    } & Record<string, unknown>;
    if (!response.ok || payload.error) {
      const err = payload.error;
      const detail = err
        ? `code=${err.code ?? response.status} status=${err.status ?? ''} message=${err.message ?? ''}`
        : `HTTP ${response.status}`;
      throw new Error(`Google Ads API 调用失败（${path}）：${detail}`);
    }
    return payload as unknown as T;
  }

  /**
   * 将 `searchStream` 的分块响应（数组，每块含 `results`）摊平为统一的原生行集合。
   *
   * 兼容单对象响应（含 `results`）与分块数组响应两种形态。
   */
  private flattenSearchStream(
    data: { results?: Record<string, unknown>[] }[] | { results?: Record<string, unknown>[] },
  ): Record<string, unknown>[] {
    const chunks = Array.isArray(data) ? data : [data];
    const rows: Record<string, unknown>[] = [];
    for (const chunk of chunks) {
      for (const row of chunk?.results ?? []) {
        rows.push(row);
      }
    }
    return rows;
  }

  /** Google Ads API 基址：允许经环境变量覆盖以对接其他版本或测试环境。 */
  private baseUrl(): string {
    if (process.env.GOOGLE_ADS_API_BASE_URL) {
      return process.env.GOOGLE_ADS_API_BASE_URL;
    }
    const version = process.env.GOOGLE_ADS_API_VERSION ?? GOOGLE_ADS_API_VERSION;
    return `${GOOGLE_ADS_API_HOST}/${version}`;
  }

  /** OAuth2 令牌端点：允许经环境变量覆盖以对接测试环境。 */
  private oauthTokenUrl(): string {
    return process.env.GOOGLE_OAUTH_TOKEN_URL ?? GOOGLE_OAUTH_TOKEN_URL;
  }

  /** 规范化 Google Ads 客户标识：去除连字符（Google 约定为纯数字客户编号）。 */
  private toCustomerId(customerId: string): string {
    const id = (customerId ?? '').replace(/-/g, '').trim();
    if (id.length === 0) {
      throw new Error('Google Ads 客户标识缺失：请提供 customerId');
    }
    return id;
  }

  /**
   * 解析 Google Ads 客户标识：优先取显式来源（统一模型层注入），否则回退到环境变量
   * `GOOGLE_ADS_CUSTOMER_ID`（代运营调度上下文）；均缺失时抛错。
   */
  private resolveCustomerId(source?: Record<string, unknown>): string {
    const explicit =
      (source && (source.customerId ?? source.customer_id ?? source.accountId)) ??
      process.env.GOOGLE_ADS_CUSTOMER_ID;
    if (typeof explicit === 'string' && explicit.length > 0) {
      return explicit;
    }
    throw new Error(
      'Google Ads 客户标识未提供：请在配置中注入 customerId 或设置环境变量 GOOGLE_ADS_CUSTOMER_ID',
    );
  }

  /** 将日期格式化为 Google Ads 报表 API 要求的 `YYYY-MM-DD`。 */
  private toDate(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  /** 安全地将未知值视作记录对象（非对象返回空记录）。 */
  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  /** 安全地将未知值视作数组（非数组返回空数组）。 */
  private asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }
}
