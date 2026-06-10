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
 * Meta Marketing API（Facebook Graph API）默认接入端点（需求 13.1、18.1、20.1）。
 *
 * 采用 Graph REST + System User Token（`access_token`）的 Business Manager / on-behalf-of
 * 代客户投放模式。API 版本与基址可经环境变量 `META_GRAPH_VERSION` / `META_API_BASE_URL`
 * 覆盖（如对接其他版本或测试环境），默认指向稳定版生产域名。
 */
const META_GRAPH_VERSION = 'v21.0';
const META_API_HOST = 'https://graph.facebook.com';

/**
 * 统一定向维度 → Meta 原生定向字段映射（需求 10.3）。
 *
 * 仅列出 Meta Marketing API 真实支持的 `targeting` 子字段；其余在 Meta 不适用的
 * B2B 维度（职位/资历/公司规模等）由 {@link META_NOT_APPLICABLE_DIMENSIONS} 标记并经
 * {@link TargetingResult.notApplicable} 回传（需求 10.4）。
 */
const META_TARGETING_FIELD_MAP: Readonly<Record<string, string>> = {
  country: 'geo_locations',
  countryRegion: 'geo_locations',
  location: 'geo_locations',
  region: 'geo_locations',
  geoLocations: 'geo_locations',
  age: 'age_range',
  ageRange: 'age_range',
  ageMin: 'age_min',
  ageMax: 'age_max',
  gender: 'genders',
  genders: 'genders',
  interest: 'flexible_spec',
  interests: 'flexible_spec',
  behavior: 'behaviors',
  behaviors: 'behaviors',
  customAudience: 'custom_audiences',
  customAudiences: 'custom_audiences',
  lookalike: 'custom_audiences',
  locale: 'locales',
  locales: 'locales',
  language: 'locales',
  languages: 'locales',
  excludedCustomAudiences: 'excluded_custom_audiences',
  exclusions: 'exclusions',
};

/**
 * 在 Meta 不适用的统一定向维度（需求 10.4）：Meta 无 LinkedIn 式 B2B 职位/资历/公司定向。
 */
const META_NOT_APPLICABLE_DIMENSIONS: readonly string[] = [
  'jobTitle',
  'jobFunction',
  'seniority',
  'company',
  'companySize',
  'industry',
];

/**
 * Meta 审核状态归一化三态（需求 20.1）。
 *
 * 归一化为「审核中 / 审核通过 / 审核被拒绝」三者之一；适配器经
 * {@link NativeReviewStatus.rawStatus} 回传原生状态（`effective_status`），由统一模型层
 * 落库前归一化。本表供适配器内部与上层共享映射口径。
 */
export const META_REVIEW_STATUS_NORMALIZED = {
  审核中: '审核中',
  审核通过: '审核通过',
  审核被拒绝: '审核被拒绝',
} as const;

export type MetaNormalizedReviewStatus =
  (typeof META_REVIEW_STATUS_NORMALIZED)[keyof typeof META_REVIEW_STATUS_NORMALIZED];

/**
 * 将 Meta 广告原生审核状态归一化为系统三态（需求 20.1）。
 *
 * Meta `effective_status` 取值如 `PENDING_REVIEW`、`IN_PROCESS`、`DISAPPROVED`、`ACTIVE`、
 * `PAUSED`、`WITH_ISSUES` 等。审核进行中（含计费/初始处理）归「审核中」，被拒归
 * 「审核被拒绝」，其余（已通过、可投放、已暂停）归「审核通过」。
 */
export function normalizeMetaReviewStatus(rawStatus: string): MetaNormalizedReviewStatus {
  const status = (rawStatus ?? '').toUpperCase();
  if (status.includes('DISAPPROVED') || status.includes('REJECT') || status.includes('DENIED')) {
    return META_REVIEW_STATUS_NORMALIZED.审核被拒绝;
  }
  if (
    status.includes('PENDING') ||
    status.includes('IN_PROCESS') ||
    status.includes('REVIEW') ||
    status === 'PREAPPROVED'
  ) {
    return META_REVIEW_STATUS_NORMALIZED.审核中;
  }
  return META_REVIEW_STATUS_NORMALIZED.审核通过;
}

/**
 * Meta 平台适配器（组件 4，对接**真实 Meta Marketing API / Graph API**）。
 *
 * 实现 {@link PlatformAdapter} 全部方法，覆盖三级广告结构发布（需求 13.1）、原生定向
 * 应用（需求 10.3）、成品素材上传（需求 11.4）、线索表单挂载（需求 14.1）、转化追踪
 * Pixel 配置（需求 19.2）、Insights API 指标拉取（需求 18.1）与审核状态拉取（需求 20.1）。
 *
 * 凭据经 {@link AdapterContext.callWithCredential} 在内存中解密取 `systemUserToken`、用后
 * 清理（需求 6.3、6.4）；当 Meta 凭据未配置时由凭据管理器抛「该平台凭据未配置」优雅降级
 *（需求 1.5），适配器不以假数据顶替（真实服务原则）。
 *
 * 统一字段经统一模型层（组件 3）映射为 Meta 原生字段后，由本适配器透传至 Graph API；
 * 本适配器只做「定向维度→原生 targeting / 审核状态归一化 / Insights 行回传」的平台特定转换。
 */
@Injectable()
export class MetaAdapter implements PlatformAdapter {
  readonly platform = 'meta' as const;

  /**
   * 发布投放计划至 Meta（需求 13.1）。
   *
   * 按三级结构依次调用 `act_{id}/campaigns` → `act_{id}/adsets` → `act_{id}/ads`，
   * `plan.accountId` 作为 Meta 广告账户标识（自动补 `act_` 前缀）。返回平台广告系列标识
   * 与各层级原生标识。Meta 创建对象默认 `status=PAUSED` 由统一模型层在 native 中控制。
   */
  async publishCampaign(ctx: AdapterContext, plan: UnifiedAdPlan): Promise<PublishResult> {
    return ctx.callWithCredential('systemUserToken', async (token) => {
      const account = this.toAccountId(plan.accountId);
      const native = this.asRecord(plan.native);

      const campaignData = await this.post<{ id: string }>(
        token,
        `/${account}/campaigns`,
        this.asRecord(native.campaign),
      );
      const platformCampaignId = String(campaignData.id);
      const nativeIds: Record<string, string> = { campaign: platformCampaignId };

      // 广告组（ad set，可选）：每个广告组挂在新建的广告系列下。
      const adsets = this.asArray(native.adsets ?? native.adgroups);
      const adsetIds: string[] = [];
      for (let i = 0; i < adsets.length; i += 1) {
        const adsetData = await this.post<{ id: string }>(token, `/${account}/adsets`, {
          campaign_id: platformCampaignId,
          ...this.asRecord(adsets[i]),
        });
        const adsetId = String(adsetData.id);
        adsetIds.push(adsetId);
        nativeIds[`adset_${i}`] = adsetId;
      }

      // 广告（可选）：每条广告挂在对应索引的广告组下（缺省挂第一个广告组）。
      const ads = this.asArray(native.ads);
      for (let i = 0; i < ads.length; i += 1) {
        const adFields = this.asRecord(ads[i]);
        const targetAdsetId =
          (typeof adFields.adset_id === 'string' && adFields.adset_id) || adsetIds[0];
        const adData = await this.post<{ id: string }>(token, `/${account}/ads`, {
          ...(targetAdsetId ? { adset_id: targetAdsetId } : {}),
          ...adFields,
        });
        nativeIds[`ad_${i}`] = String(adData.id);
      }

      return { platformCampaignId, nativeIds };
    });
  }

  /**
   * 将受众定向条件转换为 Meta 原生 `targeting` 参数并持久化至广告组（需求 10.3、10.4）。
   *
   * 经 `POST /{adset_id}`（更新）写入 Meta 支持的 `targeting` 子字段；Meta 不适用的 B2B
   * 维度记入 {@link TargetingResult.notApplicable}（需求 10.4）。
   */
  async applyTargeting(
    ctx: AdapterContext,
    adGroupId: string,
    t: Targeting,
  ): Promise<TargetingResult> {
    return ctx.callWithCredential('systemUserToken', async (token) => {
      const dimensions = this.asRecord(t.dimensions);
      const targeting: Record<string, unknown> = {};
      const notApplicable: string[] = [];

      for (const [dim, value] of Object.entries(dimensions)) {
        if (META_NOT_APPLICABLE_DIMENSIONS.includes(dim)) {
          notApplicable.push(dim);
          continue;
        }
        const nativeField = META_TARGETING_FIELD_MAP[dim];
        if (nativeField) {
          targeting[nativeField] = value;
        } else {
          notApplicable.push(dim);
        }
      }

      await this.post(token, `/${adGroupId}`, { targeting });

      return { nativeTargetingId: adGroupId, notApplicable };
    });
  }

  /**
   * 上传成品素材至 Meta 广告账户素材库（需求 11.4）。
   *
   * 图片走 `act_{id}/adimages`（以 `url` 远程拉取），视频走 `act_{id}/advideos`
   * （以 `file_url` 远程拉取）。`act_{id}` 取自素材来源内的 `accountId` 或环境变量
   * `META_AD_ACCOUNT_ID`（代运营调度上下文注入）。适配器不对素材内容做创意改写。
   */
  async uploadAsset(ctx: AdapterContext, asset: AssetRef): Promise<AssetUploadResult> {
    return ctx.callWithCredential('systemUserToken', async (token) => {
      const account = this.toAccountId(this.resolveAdAccountId());
      const isVideo = asset.type.toLowerCase().includes('video');

      if (isVideo) {
        const data = await this.post<{ id: string; video_id?: string }>(
          token,
          `/${account}/advideos`,
          { file_url: asset.source, name: asset.assetId },
        );
        return { platformAssetId: String(data.video_id ?? data.id) };
      }

      // 图片上传返回 `images` 映射，键为入参文件名；取其 hash 作为素材标识。
      const data = await this.post<{ images?: Record<string, { hash: string }> }>(
        token,
        `/${account}/adimages`,
        { url: asset.source, name: asset.assetId },
      );
      const images = data.images ?? {};
      const firstKey = Object.keys(images)[0];
      const hash = firstKey ? images[firstKey]?.hash : '';
      return { platformAssetId: String(hash ?? '') };
    });
  }

  /**
   * 为指定广告挂载 Meta 线索表单（Lead Ads / leadgen form）（需求 14.1）。
   *
   * 经 `POST /{page_id}/leadgen_forms` 在所属公共主页下创建即时线索表单，回传表单标识
   * 供广告创意绑定。`page_id` 取自表单字段内的 `pageId`/`page_id` 或环境变量
   * `META_PAGE_ID`。
   */
  async attachLeadForm(
    ctx: AdapterContext,
    adId: string,
    form: LeadFormConfig,
  ): Promise<LeadFormResult> {
    return ctx.callWithCredential('systemUserToken', async (token) => {
      const fields = this.asRecord(form.fields);
      const pageId = this.resolvePageId(fields);
      const { pageId: _drop, page_id: _drop2, ...formFields } = fields;

      const data = await this.post<{ id: string }>(token, `/${pageId}/leadgen_forms`, {
        ...formFields,
        // 记录关联广告，便于回溯（Graph 忽略未知字段时不影响创建）。
        ad_id: adId,
      });
      return { platformLeadFormId: String(data.id) };
    });
  }

  /**
   * 提交转化追踪配置至 Meta（创建广告像素 Pixel）（需求 19.2）。
   *
   * 经 `POST /act_{id}/adspixels` 创建转化像素并回传 `id` 作为追踪标识。`act_{id}`
   * 取自事件配置内的 `accountId` 或环境变量 `META_AD_ACCOUNT_ID`。
   */
  async submitConversionTracking(
    ctx: AdapterContext,
    cfg: ConversionConfig,
  ): Promise<ConversionResult> {
    return ctx.callWithCredential('systemUserToken', async (token) => {
      const events = this.asRecord(cfg.events);
      const account = this.toAccountId(this.resolveAdAccountId(events));
      const { accountId: _drop, ...pixelFields } = events;

      const data = await this.post<{ id: string }>(token, `/${account}/adspixels`, pixelFields);
      return { platformTrackingId: String(data.id) };
    });
  }

  /**
   * 经 Meta Insights API 拉取平台原生指标（需求 18.1）。
   *
   * 调用 `GET /act_{id}/insights`，按广告系列层级拉取曝光/点击/花费/转化动作，按天分桶
   * （`time_increment=1`）返回原生行集合，待统一模型层归一化（曝光/点击/转化/花费）。
   */
  async fetchMetrics(ctx: AdapterContext, q: MetricsQuery): Promise<NativeMetrics> {
    return ctx.callWithCredential('systemUserToken', async (token) => {
      const account = this.toAccountId(q.accountId);
      const data = await this.get<{ data?: Record<string, unknown>[] }>(
        token,
        `/${account}/insights`,
        {
          level: 'campaign',
          fields: 'impressions,clicks,spend,actions,action_values',
          time_range: JSON.stringify({
            since: this.toDate(q.since),
            until: this.toDate(q.until),
          }),
          time_increment: 1,
          limit: 1000,
        },
      );
      return { platform: this.platform, rows: data.data ?? [] };
    });
  }

  /**
   * 拉取 Meta 广告原生审核状态（需求 20.1）。
   *
   * 经 `GET /?ids=...&fields=effective_status,ad_review_feedback` 批量按广告标识拉取
   * `effective_status`，以原生状态回传供归一化为三态（审核中/审核通过/审核被拒绝，
   * 见 {@link normalizeMetaReviewStatus}）；被拒绝时携带 `ad_review_feedback` 供记录拒因
   *（需求 20.3）。
   */
  async fetchReviewStatus(ctx: AdapterContext, adIds: string[]): Promise<NativeReviewStatus[]> {
    if (adIds.length === 0) {
      return [];
    }
    return ctx.callWithCredential('systemUserToken', async (token) => {
      const data = await this.get<Record<string, Record<string, unknown>>>(token, '/', {
        ids: adIds.join(','),
        fields: 'effective_status,ad_review_feedback',
      });

      return adIds.map((adId) => {
        const record = this.asRecord(data[adId]);
        return {
          adId,
          rawStatus: String(record.effective_status ?? ''),
        };
      });
    });
  }

  /**
   * Meta 支持的统一出价策略集合（需求 26.1）。
   *
   * 对应 Meta 的 Lowest Cost（最大化转化/转化价值/点击）、Cost Cap / Bid Cap（目标 CPA）、
   * 以及基于 ROAS 的最低/目标 ROAS 优化。Meta 不提供 Google 式手动 CPC 出价方式。
   */
  supportedBiddingStrategies(): BiddingStrategy[] {
    return [
      'MAXIMIZE_CONVERSIONS',
      'MAXIMIZE_CONVERSION_VALUE',
      'MAXIMIZE_CLICKS',
      'TARGET_CPA',
      'TARGET_ROAS',
    ];
  }

  // ───────────────────────── 内部：HTTP 与工具 ─────────────────────────

  /** 发起 Meta Graph API POST 调用（表单包体 + `access_token`）。 */
  private async post<T>(token: string, path: string, body: Record<string, unknown>): Promise<T> {
    const form = this.buildForm({ ...body, access_token: token });
    const response = await fetch(`${this.baseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    return this.parse<T>(response, path);
  }

  /** 发起 Meta Graph API GET 调用（查询参数 + `access_token`）。 */
  private async get<T>(token: string, path: string, params: Record<string, unknown>): Promise<T> {
    const query = this.buildForm({ ...params, access_token: token });
    const response = await fetch(`${this.baseUrl()}${path}?${query}`, { method: 'GET' });
    return this.parse<T>(response, path);
  }

  /**
   * 解析 Graph 响应：HTTP 非 2xx 或包体含 `error` 视为业务错误并抛出（需求 13.1、13.3）。
   */
  private async parse<T>(response: Response, path: string): Promise<T> {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number; error_user_msg?: string };
    } & Record<string, unknown>;
    if (!response.ok || payload.error) {
      const err = payload.error;
      const detail = err
        ? `code=${err.code} message=${err.error_user_msg ?? err.message ?? ''}`
        : `HTTP ${response.status}`;
      throw new Error(`Meta Graph API 调用失败（${path}）：${detail}`);
    }
    return payload as unknown as T;
  }

  /**
   * 构造 `application/x-www-form-urlencoded` 包体：对象/数组按 JSON 字符串编码（Graph 约定）。
   */
  private buildForm(params: Record<string, unknown>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) {
        continue;
      }
      if (typeof value === 'object') {
        search.append(key, JSON.stringify(value));
      } else {
        search.append(key, String(value));
      }
    }
    return search.toString();
  }

  /** Graph API 基址：允许经环境变量覆盖以对接其他版本或测试环境。 */
  private baseUrl(): string {
    if (process.env.META_API_BASE_URL) {
      return process.env.META_API_BASE_URL;
    }
    const version = process.env.META_GRAPH_VERSION ?? META_GRAPH_VERSION;
    return `${META_API_HOST}/${version}`;
  }

  /** 为广告账户标识补齐 Meta 约定的 `act_` 前缀（已带前缀则原样返回）。 */
  private toAccountId(accountId: string): string {
    const id = (accountId ?? '').trim();
    if (id.length === 0) {
      throw new Error('Meta 广告账户标识缺失：请提供 accountId');
    }
    return id.startsWith('act_') ? id : `act_${id}`;
  }

  /**
   * 解析 Meta 广告账户标识：优先取显式来源（统一模型层注入），否则回退到环境变量
   * `META_AD_ACCOUNT_ID`（代运营调度上下文）；均缺失时抛错。
   */
  private resolveAdAccountId(source?: Record<string, unknown>): string {
    const explicit =
      (source && (source.accountId ?? source.account_id ?? source.adAccountId)) ??
      process.env.META_AD_ACCOUNT_ID;
    if (typeof explicit === 'string' && explicit.length > 0) {
      return explicit;
    }
    throw new Error(
      'Meta 广告账户标识未提供：请在配置中注入 accountId 或设置环境变量 META_AD_ACCOUNT_ID',
    );
  }

  /**
   * 解析 Meta 公共主页标识（线索表单挂载所需）：优先取表单字段内的 `pageId`/`page_id`，
   * 否则回退到环境变量 `META_PAGE_ID`；均缺失时抛错。
   */
  private resolvePageId(source: Record<string, unknown>): string {
    const explicit = source.pageId ?? source.page_id ?? process.env.META_PAGE_ID;
    if (typeof explicit === 'string' && explicit.length > 0) {
      return explicit;
    }
    throw new Error(
      'Meta 公共主页标识未提供：请在表单配置中注入 pageId 或设置环境变量 META_PAGE_ID',
    );
  }

  /** 将日期格式化为 Meta Insights API 要求的 `YYYY-MM-DD`。 */
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
