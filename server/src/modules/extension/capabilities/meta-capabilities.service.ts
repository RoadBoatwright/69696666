import { Injectable } from '@nestjs/common';

import { CredentialManagerService } from '../../credential/credential-manager.service';

const META_GRAPH_VERSION = 'v21.0';
const META_API_HOST = 'https://graph.facebook.com';

/**
 * Meta 平台扩展能力执行器（对接**真实 Meta Marketing API / Graph API**）。
 *
 * 承载 Advantage+ 全自动系列（需求 23）、商品目录与动态商品广告（需求 24）、
 * CTWA/CTM 消息广告（需求 30）、动态创意（需求 31）、离线转化回传（需求 32）、
 * Reach Estimate 投前预估（需求 29）与 Split Test 实验（需求 28）的 Meta 侧真实调用。
 *
 * 凭据经凭据管理器在内存中解密（`systemUserToken`）、用后清理（需求 6.3、6.4）；
 * 凭据未配置时由凭据管理器抛「该平台凭据未配置」（需求 1.5），不以假数据顶替。
 * 调用前的支持集/凭据校验由扩展能力网关完成（需求 22）。
 */
@Injectable()
export class MetaCapabilitiesService {
  constructor(private readonly credentials: CredentialManagerService) {}

  /**
   * 创建 Meta Advantage+ 系列（需求 23.2、23.3）。
   *
   * 经 `POST /act_{id}/campaigns` 创建 `smart_promotion_type=AUTOMATED_SHOPPING_ADS`
   * 的全自动系列，硬控制项（地域/语言/最低年龄/排除条件/特殊广告类别）作为投放约束
   * 写入；同时经 `GET /act_{id}/targetingsuggestions` 拉取 Meta 定向建议（可选项，
   * 需求 23.3）。
   */
  async createAdvantagePlusCampaign(
    accountId: string,
    name: string,
    hardControls: Record<string, unknown>,
  ): Promise<{ campaignId: string; targetingSuggestions: unknown[] }> {
    return this.withToken(async (token) => {
      const account = this.toAccountId(accountId);
      const created = await this.post<{ id: string }>(token, `/${account}/campaigns`, {
        name,
        objective: 'OUTCOME_SALES',
        smart_promotion_type: 'AUTOMATED_SHOPPING_ADS',
        special_ad_categories: hardControls.specialAdCategories ?? [],
        status: 'PAUSED',
        // 硬控制项作为投放约束随系列持久化（需求 23.2）。
        advantage_state_info: {
          geo_locations: hardControls.geoLocations,
          locales: hardControls.languages,
          age_min: hardControls.minAge,
          exclusions: hardControls.exclusions ?? {},
        },
      });
      const suggestions = await this.get<{ data?: unknown[] }>(
        token,
        `/${account}/targetingsuggestions`,
        {},
      ).catch(() => ({ data: [] as unknown[] }));
      return {
        campaignId: String(created.id),
        targetingSuggestions: suggestions.data ?? [],
      };
    });
  }

  /**
   * 创建/同步 Meta 商品目录条目（需求 24.2）。
   *
   * 目录缺省时经 `POST /{business_id}/owned_product_catalogs` 创建；条目经
   * `POST /{catalog_id}/items_batch` 批量写入（Graph Items Batch API）。
   */
  async syncCatalogItems(
    businessId: string,
    catalogId: string | undefined,
    items: Record<string, unknown>[],
  ): Promise<{ catalogId: string }> {
    return this.withToken(async (token) => {
      let id = catalogId;
      if (!id) {
        const created = await this.post<{ id: string }>(
          token,
          `/${businessId}/owned_product_catalogs`,
          { name: `catalog_${Date.now()}` },
        );
        id = String(created.id);
      }
      await this.post(token, `/${id}/items_batch`, {
        item_type: 'PRODUCT_ITEM',
        requests: items.map((item) => ({ method: 'UPDATE', data: item })),
      });
      return { catalogId: id };
    });
  }

  /** 基于目录定义商品集（需求 24.3）：`POST /{catalog_id}/product_sets`。 */
  async createProductSet(
    catalogId: string,
    name: string,
    filter: Record<string, unknown>,
  ): Promise<{ productSetId: string }> {
    return this.withToken(async (token) => {
      const created = await this.post<{ id: string }>(token, `/${catalogId}/product_sets`, {
        name,
        filter,
      });
      return { productSetId: String(created.id) };
    });
  }

  /**
   * 创建 CTWA / CTM 消息广告创意（需求 30.2）。
   *
   * 经 `POST /act_{id}/adcreatives` 创建带 `page_welcome_message`（预填消息）与
   * 会话路由（destination_type=WHATSAPP / MESSENGER）的创意。
   */
  async createMessageAd(
    accountId: string,
    destination: 'whatsapp' | 'messenger',
    prefilledMessage: string,
    routing: Record<string, unknown>,
  ): Promise<{ creativeId: string }> {
    return this.withToken(async (token) => {
      const account = this.toAccountId(accountId);
      const created = await this.post<{ id: string }>(token, `/${account}/adcreatives`, {
        object_story_spec: {
          page_id: routing.pageId ?? process.env.META_PAGE_ID,
          link_data: {
            page_welcome_message: prefilledMessage,
            call_to_action: {
              type: destination === 'whatsapp' ? 'WHATSAPP_MESSAGE' : 'MESSAGE_PAGE',
              value: routing,
            },
          },
        },
      });
      return { creativeId: String(created.id) };
    });
  }

  /**
   * 离线/CRM 转化回传（需求 32.2）：`POST /{offline_event_set_id}/events`
   * （Meta Conversions API 离线转化）。
   */
  async uploadOfflineConversions(
    offlineEventSetId: string,
    events: { eventId: string; eventTime: string; value: number; currency?: string }[],
  ): Promise<{ received: number }> {
    return this.withToken(async (token) => {
      const data = await this.post<{ num_processed_entries?: number }>(
        token,
        `/${offlineEventSetId}/events`,
        {
          upload_tag: `crm_${Date.now()}`,
          data: events.map((event) => ({
            event_name: 'Purchase',
            event_id: event.eventId,
            event_time: event.eventTime,
            value: event.value,
            currency: event.currency ?? 'USD',
            action_source: 'system_generated',
          })),
        },
      );
      return { received: Number(data.num_processed_entries ?? events.length) };
    });
  }

  /**
   * 投前预估（需求 29.2）：`GET /act_{id}/reachestimate`（Meta Reach/Delivery Estimate），
   * 由预估服务归一化为统一口径区间。
   */
  async reachEstimate(
    accountId: string,
    targeting: Record<string, unknown>,
    budget: number,
  ): Promise<{ lowerBound: number; upperBound: number }> {
    return this.withToken(async (token) => {
      const account = this.toAccountId(accountId);
      const data = await this.get<{
        data?: { users_lower_bound?: number; users_upper_bound?: number };
      }>(token, `/${account}/reachestimate`, {
        targeting_spec: targeting,
        optimization_goal: 'LEAD_GENERATION',
        daily_budget: budget,
      });
      return {
        lowerBound: Number(data.data?.users_lower_bound ?? 0),
        upperBound: Number(data.data?.users_upper_bound ?? 0),
      };
    });
  }

  /** 创建 Meta Split Test（需求 28.2）：`POST /act_{id}/ad_studies`。 */
  async createSplitTest(
    accountId: string,
    name: string,
    groups: Record<string, unknown>[],
  ): Promise<{ experimentId: string }> {
    return this.withToken(async (token) => {
      const created = await this.post<{ id: string }>(token, `/ad_studies`, {
        name,
        type: 'SPLIT_TEST',
        cells: groups,
        account_id: this.toAccountId(accountId),
      });
      return { experimentId: String(created.id) };
    });
  }

  /** 读取 Meta Split Test 结果（需求 28.3）：`GET /{study_id}/cells`。 */
  async getSplitTestResults(experimentId: string): Promise<Record<string, unknown>[]> {
    return this.withToken(async (token) => {
      const data = await this.get<{ data?: Record<string, unknown>[] }>(
        token,
        `/${experimentId}/cells`,
        { fields: 'name,treatment_percentage,results' },
      );
      return data.data ?? [];
    });
  }

  /**
   * Meta 动态创意生成（需求 31.2）：`POST /act_{id}/adcreatives`
   * （`asset_feed_spec` 动态创意，按目标语言生成变体）。
   */
  async generateDynamicCreatives(
    accountId: string,
    productAssets: Record<string, unknown>[],
    targetLanguages: string[],
  ): Promise<{ language: string; creativeId: string }[]> {
    return this.withToken(async (token) => {
      const account = this.toAccountId(accountId);
      const variants: { language: string; creativeId: string }[] = [];
      for (const language of targetLanguages) {
        const created = await this.post<{ id: string }>(token, `/${account}/adcreatives`, {
          asset_feed_spec: {
            images: productAssets,
            ad_formats: ['AUTOMATIC_FORMAT'],
            asset_customization_rules: [
              { customization_spec: { locales: [language] }, priority: 1 },
            ],
          },
        });
        variants.push({ language, creativeId: String(created.id) });
      }
      return variants;
    });
  }

  /** 应用智能出价策略到广告组（需求 26.2）：`POST /{adset_id}` 更新。 */
  async applyBidding(
    adGroupId: string,
    nativeParam: string,
    targetValue?: number,
  ): Promise<{ adGroupId: string }> {
    return this.withToken(async (token) => {
      await this.post(token, `/${adGroupId}`, {
        bid_strategy: nativeParam,
        ...(targetValue !== undefined ? { bid_amount: targetValue } : {}),
      });
      return { adGroupId };
    });
  }

  private withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
    return this.credentials.useDecrypted('meta', 'systemUserToken', fn);
  }

  private async post<T>(token: string, path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: this.buildForm({ ...body, access_token: token }),
    });
    return this.parse<T>(response, path);
  }

  private async get<T>(token: string, path: string, params: Record<string, unknown>): Promise<T> {
    const query = this.buildForm({ ...params, access_token: token });
    const response = await fetch(`${this.baseUrl()}${path}?${query}`, { method: 'GET' });
    return this.parse<T>(response, path);
  }

  private async parse<T>(response: Response, path: string): Promise<T> {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number };
    } & Record<string, unknown>;
    if (!response.ok || payload.error) {
      const detail = payload.error
        ? `code=${payload.error.code} message=${payload.error.message ?? ''}`
        : `HTTP ${response.status}`;
      throw new Error(`Meta Graph API 扩展能力调用失败（${path}）：${detail}`);
    }
    return payload as unknown as T;
  }

  private buildForm(params: Record<string, unknown>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) {
        continue;
      }
      search.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    return search.toString();
  }

  private baseUrl(): string {
    if (process.env.META_API_BASE_URL) {
      return process.env.META_API_BASE_URL;
    }
    return `${META_API_HOST}/${process.env.META_GRAPH_VERSION ?? META_GRAPH_VERSION}`;
  }

  private toAccountId(accountId: string): string {
    const id = (accountId ?? '').trim();
    if (id.length === 0) {
      throw new Error('Meta 广告账户标识缺失：请提供 accountId');
    }
    return id.startsWith('act_') ? id : `act_${id}`;
  }
}
