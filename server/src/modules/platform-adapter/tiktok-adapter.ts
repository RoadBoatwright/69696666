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
 * TikTok Marketing API（TikTok for Business / business-api）默认接入端点（需求 13.1、18.1、20.1）。
 *
 * 采用 REST + `Access-Token` 请求头的 Business Center / Agency 代客户投放模式。
 * 可经环境变量 `TIKTOK_API_BASE_URL` 覆盖（如对接沙盒域名），默认指向生产域名。
 */
const TIKTOK_API_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';

/** TikTok Marketing API 统一响应包络：`code === 0` 表示成功（需求 13.1）。 */
interface TikTokApiResponse<T = Record<string, unknown>> {
  code: number;
  message: string;
  request_id?: string;
  data?: T;
}

/**
 * 统一定向维度 → TikTok 原生定向字段映射（需求 10.3）。
 *
 * 仅列出 TikTok Marketing API 真实支持的定向维度；其余在 TikTok 不适用的维度
 * （如 B2B 的职位/行业/资历）由 {@link TIKTOK_NOT_APPLICABLE_DIMENSIONS} 标记
 * 并经 {@link TargetingResult.notApplicable} 回传（需求 10.4）。
 */
const TIKTOK_TARGETING_FIELD_MAP: Readonly<Record<string, string>> = {
  country: 'location_ids',
  countryRegion: 'location_ids',
  location: 'location_ids',
  region: 'location_ids',
  age: 'age_groups',
  ageRange: 'age_groups',
  gender: 'gender',
  interest: 'interest_category_ids',
  interests: 'interest_category_ids',
  language: 'languages',
  languages: 'languages',
  os: 'operating_systems',
  device: 'device_model_ids',
};

/** 在 TikTok 不适用的统一定向维度（需求 10.4）：TikTok 无 LinkedIn 式 B2B 职位/行业定向。 */
const TIKTOK_NOT_APPLICABLE_DIMENSIONS: readonly string[] = [
  'industry',
  'jobTitle',
  'jobFunction',
  'seniority',
  'company',
  'companySize',
];

/**
 * TikTok 广告二级审核状态 → 系统三态归一化（需求 20.1）。
 *
 * 归一化为「审核中 / 审核通过 / 审核被拒绝」三者之一；适配器经
 * {@link NativeReviewStatus.rawStatus} 回传原生状态，由统一模型层落库前归一化。
 * 本表供适配器内部与上层共享映射口径。
 */
export const TIKTOK_REVIEW_STATUS_NORMALIZED = {
  审核中: '审核中',
  审核通过: '审核通过',
  审核被拒绝: '审核被拒绝',
} as const;

export type NormalizedReviewStatus =
  (typeof TIKTOK_REVIEW_STATUS_NORMALIZED)[keyof typeof TIKTOK_REVIEW_STATUS_NORMALIZED];

/**
 * 将 TikTok 广告原生审核状态归一化为系统三态（需求 20.1）。
 *
 * TikTok `ad/get` 返回 `secondary_status`（如 `AD_STATUS_AUDIT`、`AD_STATUS_DELIVERY_OK`、
 * `AD_STATUS_AUDIT_DENY`）。审核进行中归「审核中」，被拒归「审核被拒绝」，其余（投放中/
 * 可投放）归「审核通过」。
 */
export function normalizeTikTokReviewStatus(rawStatus: string): NormalizedReviewStatus {
  const status = (rawStatus ?? '').toUpperCase();
  if (status.includes('DENY') || status.includes('REJECT')) {
    return TIKTOK_REVIEW_STATUS_NORMALIZED.审核被拒绝;
  }
  if (status.includes('AUDIT') || status.includes('REVIEW') || status.includes('PENDING')) {
    return TIKTOK_REVIEW_STATUS_NORMALIZED.审核中;
  }
  return TIKTOK_REVIEW_STATUS_NORMALIZED.审核通过;
}

/**
 * TikTok 平台适配器（组件 4，对接**真实 TikTok Marketing API**）。
 *
 * 实现 {@link PlatformAdapter} 全部方法，覆盖三级广告结构发布（需求 13.1）、原生定向
 * 应用（需求 10.3）、成品素材上传（需求 11.4）、线索表单挂载（需求 14.1）、转化追踪
 * （需求 19.2）、Reporting API 指标拉取（需求 18.1）与审核状态拉取（需求 20.1）。
 *
 * 凭据经 {@link AdapterContext.callWithCredential} 在内存中解密取 `accessToken`、用后清理
 *（需求 6.3、6.4）；当 TikTok 凭据未配置时由凭据管理器抛「该平台凭据未配置」优雅降级
 *（需求 1.5），适配器不以假数据顶替（真实服务原则）。
 *
 * TikTok 是本系统相对竞品的差异化平台（design 概述）。
 */
@Injectable()
export class TikTokAdapter implements PlatformAdapter {
  readonly platform = 'tiktok' as const;

  /**
   * 发布投放计划至 TikTok（需求 13.1）。
   *
   * 按三级结构依次调用 `campaign/create` → `adgroup/create` → `ad/create`，
   * `plan.accountId` 作为 TikTok `advertiser_id`。返回平台广告系列标识与各层级原生标识。
   */
  async publishCampaign(ctx: AdapterContext, plan: UnifiedAdPlan): Promise<PublishResult> {
    return ctx.callWithCredential('accessToken', async (accessToken) => {
      const advertiserId = plan.accountId;
      const native = this.asRecord(plan.native);

      const campaignPayload = {
        advertiser_id: advertiserId,
        ...this.asRecord(native.campaign),
      };
      const campaignData = await this.post<{ campaign_id: string }>(
        accessToken,
        '/campaign/create/',
        campaignPayload,
      );
      const platformCampaignId = String(campaignData.campaign_id);

      const nativeIds: Record<string, string> = { campaign: platformCampaignId };

      // 广告组（可选）：每个广告组挂在新建的广告系列下。
      const adgroups = this.asArray(native.adgroups);
      const adgroupIds: string[] = [];
      for (let i = 0; i < adgroups.length; i += 1) {
        const adgroupData = await this.post<{ adgroup_id: string }>(
          accessToken,
          '/adgroup/create/',
          {
            advertiser_id: advertiserId,
            campaign_id: platformCampaignId,
            ...this.asRecord(adgroups[i]),
          },
        );
        const adgroupId = String(adgroupData.adgroup_id);
        adgroupIds.push(adgroupId);
        nativeIds[`adgroup_${i}`] = adgroupId;
      }

      // 广告（可选）：每条广告挂在对应索引的广告组下（缺省挂第一个广告组）。
      const ads = this.asArray(native.ads);
      for (let i = 0; i < ads.length; i += 1) {
        const adFields = this.asRecord(ads[i]);
        const targetAdgroupId =
          (typeof adFields.adgroup_id === 'string' && adFields.adgroup_id) || adgroupIds[0];
        const adData = await this.post<{ ad_ids: string[] }>(accessToken, '/ad/create/', {
          advertiser_id: advertiserId,
          ...(targetAdgroupId ? { adgroup_id: targetAdgroupId } : {}),
          ...adFields,
        });
        const createdAdId = Array.isArray(adData.ad_ids) ? String(adData.ad_ids[0] ?? '') : '';
        if (createdAdId) {
          nativeIds[`ad_${i}`] = createdAdId;
        }
      }

      return { platformCampaignId, nativeIds };
    });
  }

  /**
   * 将受众定向条件转换为 TikTok 原生定向参数并持久化至广告组（需求 10.3、10.4）。
   *
   * 经 `adgroup/update` 写入 TikTok 支持的定向字段；TikTok 不适用的维度记入
   * {@link TargetingResult.notApplicable}。`advertiser_id` 取自定向维度内的
   * `advertiserId`/`advertiser_id`（由统一模型层注入）。
   */
  async applyTargeting(
    ctx: AdapterContext,
    adGroupId: string,
    t: Targeting,
  ): Promise<TargetingResult> {
    return ctx.callWithCredential('accessToken', async (accessToken) => {
      const dimensions = this.asRecord(t.dimensions);
      const advertiserId = this.resolveAdvertiserId(dimensions);

      const nativeTargeting: Record<string, unknown> = {};
      const notApplicable: string[] = [];

      for (const [dim, value] of Object.entries(dimensions)) {
        if (dim === 'advertiserId' || dim === 'advertiser_id') {
          continue;
        }
        if (TIKTOK_NOT_APPLICABLE_DIMENSIONS.includes(dim)) {
          notApplicable.push(dim);
          continue;
        }
        const nativeField = TIKTOK_TARGETING_FIELD_MAP[dim];
        if (nativeField) {
          nativeTargeting[nativeField] = value;
        } else {
          notApplicable.push(dim);
        }
      }

      await this.post(accessToken, '/adgroup/update/', {
        advertiser_id: advertiserId,
        adgroup_id: adGroupId,
        ...nativeTargeting,
      });

      return { nativeTargetingId: adGroupId, notApplicable };
    });
  }

  /**
   * 上传成品素材至 TikTok 素材库（需求 11.4）。
   *
   * 按素材类型走 `file/video/ad/upload`（视频）或 `file/image/ad/upload`（图片），
   * 以 `UPLOAD_BY_URL` 模式提交 {@link AssetRef.source} 媒体地址。`advertiser_id`
   * 取自环境变量 `TIKTOK_ADVERTISER_ID`（代运营场景由调度上下文注入）。
   */
  async uploadAsset(ctx: AdapterContext, asset: AssetRef): Promise<AssetUploadResult> {
    return ctx.callWithCredential('accessToken', async (accessToken) => {
      const advertiserId = this.resolveAdvertiserId();
      const isVideo = asset.type.toLowerCase().includes('video');

      if (isVideo) {
        const data = await this.post<{ video_id: string; videos?: { video_id: string }[] }>(
          accessToken,
          '/file/video/ad/upload/',
          {
            advertiser_id: advertiserId,
            upload_type: 'UPLOAD_BY_URL',
            video_url: asset.source,
            file_name: asset.assetId,
          },
        );
        const videoId = data.video_id ?? data.videos?.[0]?.video_id ?? '';
        return { platformAssetId: String(videoId) };
      }

      const data = await this.post<{ image_id: string }>(accessToken, '/file/image/ad/upload/', {
        advertiser_id: advertiserId,
        upload_type: 'UPLOAD_BY_URL',
        image_url: asset.source,
        file_name: asset.assetId,
      });
      return { platformAssetId: String(data.image_id) };
    });
  }

  /**
   * 为指定广告挂载 TikTok 线索表单（Instant Page / Lead Generation）（需求 14.1）。
   *
   * 经 `page/create` 建立线索收集即时表单页，并将其页面标识回传供广告绑定。
   * `advertiser_id` 取自表单字段内的 `advertiserId`/`advertiser_id` 或环境变量。
   */
  async attachLeadForm(
    ctx: AdapterContext,
    adId: string,
    form: LeadFormConfig,
  ): Promise<LeadFormResult> {
    return ctx.callWithCredential('accessToken', async (accessToken) => {
      const fields = this.asRecord(form.fields);
      const advertiserId = this.resolveAdvertiserId(fields);

      const data = await this.post<{ page_id: string; instant_page_id?: string }>(
        accessToken,
        '/page/create/',
        {
          advertiser_id: advertiserId,
          business_type: 'LEAD_GEN',
          ad_id: adId,
          ...fields,
        },
      );
      const platformLeadFormId = data.page_id ?? data.instant_page_id ?? '';
      return { platformLeadFormId: String(platformLeadFormId) };
    });
  }

  /**
   * 提交转化追踪配置至 TikTok（创建 Pixel）（需求 19.2）。
   *
   * 经 `pixel/create` 建立转化像素并回传 `pixel_id` 作为追踪标识。
   * `advertiser_id` 取自事件配置内的 `advertiserId`/`advertiser_id` 或环境变量。
   */
  async submitConversionTracking(
    ctx: AdapterContext,
    cfg: ConversionConfig,
  ): Promise<ConversionResult> {
    return ctx.callWithCredential('accessToken', async (accessToken) => {
      const events = this.asRecord(cfg.events);
      const advertiserId = this.resolveAdvertiserId(events);

      const data = await this.post<{ pixel_id: string; pixel_code?: string }>(
        accessToken,
        '/pixel/create/',
        {
          advertiser_id: advertiserId,
          ...events,
        },
      );
      const platformTrackingId = data.pixel_id ?? data.pixel_code ?? '';
      return { platformTrackingId: String(platformTrackingId) };
    });
  }

  /**
   * 经 TikTok Reporting API 拉取平台原生指标（需求 18.1）。
   *
   * 调用 `report/integrated/get`（`report_type=BASIC`，`data_level=AUCTION_CAMPAIGN`），
   * 拉取曝光/点击/转化/花费等基础指标，按天维度返回原生行集合，待统一模型层归一化。
   */
  async fetchMetrics(ctx: AdapterContext, q: MetricsQuery): Promise<NativeMetrics> {
    return ctx.callWithCredential('accessToken', async (accessToken) => {
      const data = await this.get<{ list?: Record<string, unknown>[] }>(
        accessToken,
        '/report/integrated/get/',
        {
          advertiser_id: q.accountId,
          report_type: 'BASIC',
          data_level: 'AUCTION_CAMPAIGN',
          dimensions: ['campaign_id', 'stat_time_day'],
          metrics: ['impressions', 'clicks', 'conversion', 'spend', 'cost_per_conversion'],
          start_date: this.toDate(q.since),
          end_date: this.toDate(q.until),
          page: 1,
          page_size: 1000,
        },
      );
      return { platform: this.platform, rows: data.list ?? [] };
    });
  }

  /**
   * 拉取 TikTok 广告原生审核状态（需求 20.1）。
   *
   * 经 `ad/get` 按 `ad_ids` 过滤拉取 `secondary_status`，以原生状态回传供归一化为三态
   *（审核中/审核通过/审核被拒绝，见 {@link normalizeTikTokReviewStatus}）。
   */
  async fetchReviewStatus(ctx: AdapterContext, adIds: string[]): Promise<NativeReviewStatus[]> {
    if (adIds.length === 0) {
      return [];
    }
    return ctx.callWithCredential('accessToken', async (accessToken) => {
      const advertiserId = this.resolveAdvertiserId();
      const data = await this.get<{ list?: Record<string, unknown>[] }>(accessToken, '/ad/get/', {
        advertiser_id: advertiserId,
        filtering: { ad_ids: adIds },
        fields: ['ad_id', 'secondary_status', 'opt_status'],
        page: 1,
        page_size: Math.min(adIds.length, 1000),
      });

      const rows = data.list ?? [];
      return rows.map((row) => {
        const record = this.asRecord(row);
        return {
          adId: String(record.ad_id ?? ''),
          rawStatus: String(record.secondary_status ?? record.opt_status ?? ''),
        };
      });
    });
  }

  /**
   * TikTok 支持的统一出价策略集合（需求 26.1）。
   *
   * 对应 TikTok 的 Lowest Cost（最大化转化/点击）、Cost Cap（目标 CPA）、
   * Value Optimization（目标 ROAS / 最大化转化价值）。
   */
  supportedBiddingStrategies(): BiddingStrategy[] {
    return [
      'MAXIMIZE_CONVERSIONS',
      'MAXIMIZE_CLICKS',
      'TARGET_CPA',
      'TARGET_ROAS',
      'MAXIMIZE_CONVERSION_VALUE',
    ];
  }

  // ───────────────────────── 内部：HTTP 与工具 ─────────────────────────

  /** 发起 TikTok Marketing API POST 调用（JSON 包体 + `Access-Token` 头）。 */
  private async post<T>(
    accessToken: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl()}${path}`, {
      method: 'POST',
      headers: {
        'Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return this.parse<T>(response, path);
  }

  /** 发起 TikTok Marketing API GET 调用（查询参数 JSON 编码 + `Access-Token` 头）。 */
  private async get<T>(
    accessToken: string,
    path: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    const query = this.buildQuery(params);
    const response = await fetch(`${this.baseUrl()}${path}?${query}`, {
      method: 'GET',
      headers: { 'Access-Token': accessToken },
    });
    return this.parse<T>(response, path);
  }

  /** 解析 TikTok 响应包络：`code !== 0` 视为业务错误并抛出（需求 13.1）。 */
  private async parse<T>(response: Response, path: string): Promise<T> {
    if (!response.ok) {
      throw new Error(`TikTok API 调用失败（${path}）：HTTP ${response.status}`);
    }
    const payload = (await response.json()) as TikTokApiResponse<T>;
    if (payload.code !== 0) {
      throw new Error(
        `TikTok API 调用失败（${path}）：code=${payload.code} message=${payload.message}`,
      );
    }
    return (payload.data ?? ({} as T)) as T;
  }

  /**
   * 构造 TikTok GET 查询串：数组/对象按 JSON 字符串编码（TikTok 约定）。
   */
  private buildQuery(params: Record<string, unknown>): string {
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

  /** TikTok API 基址：允许经环境变量覆盖以对接沙盒。 */
  private baseUrl(): string {
    return process.env.TIKTOK_API_BASE_URL ?? TIKTOK_API_BASE_URL;
  }

  /**
   * 解析 TikTok `advertiser_id`：优先取显式来源（统一模型层注入的字段），
   * 否则回退到环境变量 `TIKTOK_ADVERTISER_ID`（代运营调度上下文）；均缺失时抛错。
   */
  private resolveAdvertiserId(source?: Record<string, unknown>): string {
    const explicit =
      (source && (source.advertiserId ?? source.advertiser_id)) ?? process.env.TIKTOK_ADVERTISER_ID;
    if (typeof explicit === 'string' && explicit.length > 0) {
      return explicit;
    }
    throw new Error(
      'TikTok advertiser_id 未提供：请在定向/配置中注入 advertiserId 或设置环境变量 TIKTOK_ADVERTISER_ID',
    );
  }

  /** 将日期格式化为 TikTok Reporting API 要求的 `YYYY-MM-DD`。 */
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
