import { Injectable } from '@nestjs/common';

import { CredentialManagerService } from '../../credential/credential-manager.service';

const TIKTOK_API_BASE_URL = 'https://business-api.tiktok.com/open_api/v1.3';

/** TikTok Marketing API 统一响应包络：`code === 0` 表示成功。 */
interface TikTokApiResponse<T = Record<string, unknown>> {
  code: number;
  message?: string;
  data?: T;
}

/**
 * TikTok 平台扩展能力执行器（对接**真实 TikTok Marketing API（business-api）**）。
 *
 * 承载 Spark Ads 原生帖子授权投放（需求 27）、TikTok Catalog 商品流挂接（需求 24）、
 * Split Test 实验（需求 28）、Symphony AI 创意（需求 31）与智能出价持久化（需求 26）
 * 的 TikTok 侧真实调用。
 *
 * 凭据经凭据管理器在内存中解密（`accessToken`，请求头 `Access-Token`）、用后清理
 * （需求 6.3、6.4）；凭据未配置时由凭据管理器抛「该平台凭据未配置」（需求 1.5）。
 */
@Injectable()
export class TikTokCapabilitiesService {
  constructor(private readonly credentials: CredentialManagerService) {}

  /**
   * 创建 Spark Ads：以创作者授权的原生帖子作为广告素材（需求 27.2）。
   *
   * 经 `/ad/create/` 以 `identity_type=AUTH_CODE` + `tiktok_item_id` 挂接原生帖子。
   * 平台返回账户上限类错误时抛「Spark Ads 数量超过账户上限」（需求 27.3）。
   */
  async createSparkAd(
    advertiserId: string,
    adgroupId: string,
    tiktokItemId: string,
    identityId: string,
    authCode: string,
  ): Promise<{ adId: string }> {
    return this.withToken(async (token) => {
      const data = await this.post<{ ad_ids?: string[] }>(token, '/ad/create/', {
        advertiser_id: advertiserId,
        adgroup_id: adgroupId,
        creatives: [
          {
            identity_type: 'AUTH_CODE',
            identity_id: identityId,
            identity_authorized_bc_id: authCode,
            tiktok_item_id: tiktokItemId,
          },
        ],
      });
      const adId = Array.isArray(data.ad_ids) ? String(data.ad_ids[0] ?? '') : '';
      return { adId };
    });
  }

  /** 同步商品条目至 TikTok Catalog（需求 24.2）：`/catalog/product/file/`。 */
  async syncCatalogItems(
    bcId: string,
    catalogId: string | undefined,
    items: Record<string, unknown>[],
  ): Promise<{ catalogId: string }> {
    return this.withToken(async (token) => {
      let id = catalogId;
      if (!id) {
        const created = await this.post<{ catalog_id?: string }>(token, '/catalog/create/', {
          bc_id: bcId,
          name: `catalog_${Date.now()}`,
        });
        id = String(created.catalog_id ?? '');
      }
      await this.post(token, '/catalog/product/upload/', {
        bc_id: bcId,
        catalog_id: id,
        products: items,
      });
      return { catalogId: id };
    });
  }

  /** 基于目录定义商品集（需求 24.3）：`/catalog/set/create/`。 */
  async createProductSet(
    bcId: string,
    catalogId: string,
    name: string,
    filter: Record<string, unknown>,
  ): Promise<{ productSetId: string }> {
    return this.withToken(async (token) => {
      const data = await this.post<{ product_set_id?: string }>(token, '/catalog/set/create/', {
        bc_id: bcId,
        catalog_id: catalogId,
        product_set_name: name,
        conditions: filter,
      });
      return { productSetId: String(data.product_set_id ?? '') };
    });
  }

  /** 创建 TikTok Split Test 实验（需求 28.2）：`/split_test/create/`。 */
  async createSplitTest(
    advertiserId: string,
    name: string,
    groups: Record<string, unknown>[],
  ): Promise<{ experimentId: string }> {
    return this.withToken(async (token) => {
      const data = await this.post<{ split_test_id?: string }>(token, '/split_test/create/', {
        advertiser_id: advertiserId,
        split_test_name: name,
        split_test_groups: groups,
      });
      return { experimentId: String(data.split_test_id ?? '') };
    });
  }

  /** 读取 Split Test 各组结果（需求 28.3）：`/split_test/result/get/`。 */
  async getSplitTestResults(
    advertiserId: string,
    experimentId: string,
  ): Promise<Record<string, unknown>[]> {
    return this.withToken(async (token) => {
      const data = await this.get<{ list?: Record<string, unknown>[] }>(
        token,
        '/split_test/result/get/',
        { advertiser_id: advertiserId, split_test_id: experimentId },
      );
      return data.list ?? [];
    });
  }

  /**
   * TikTok Symphony AI 创意生成（需求 31.2）：`/creative/ai_video/generate/`
   * （Symphony Creative Studio 能力，按目标语言生成本地化变体）。
   */
  async generateSymphonyCreatives(
    advertiserId: string,
    productAssets: Record<string, unknown>[],
    targetLanguages: string[],
  ): Promise<{ language: string; creativeId: string }[]> {
    return this.withToken(async (token) => {
      const variants: { language: string; creativeId: string }[] = [];
      for (const language of targetLanguages) {
        const data = await this.post<{ task_id?: string }>(token, '/creative/ai_video/generate/', {
          advertiser_id: advertiserId,
          language,
          materials: productAssets,
        });
        variants.push({ language, creativeId: String(data.task_id ?? '') });
      }
      return variants;
    });
  }

  /** 应用智能出价策略到广告组（需求 26.2）：`/adgroup/update/`。 */
  async applyBidding(
    advertiserId: string,
    adgroupId: string,
    nativeParam: string,
    targetValue?: number,
  ): Promise<{ adGroupId: string }> {
    return this.withToken(async (token) => {
      await this.post(token, '/adgroup/update/', {
        advertiser_id: advertiserId,
        adgroup_id: adgroupId,
        bid_type: nativeParam,
        ...(targetValue !== undefined ? { conversion_bid_price: targetValue } : {}),
      });
      return { adGroupId: adgroupId };
    });
  }

  private withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
    return this.credentials.useDecrypted('tiktok', 'accessToken', fn);
  }

  private async post<T>(token: string, path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.parse<T>(response, path);
  }

  private async get<T>(token: string, path: string, params: Record<string, unknown>): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) {
        continue;
      }
      search.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    const response = await fetch(`${this.baseUrl()}${path}?${search.toString()}`, {
      method: 'GET',
      headers: { 'Access-Token': token },
    });
    return this.parse<T>(response, path);
  }

  private async parse<T>(response: Response, path: string): Promise<T> {
    const payload = (await response.json().catch(() => ({}))) as TikTokApiResponse<T>;
    if (!response.ok || payload.code !== 0) {
      const message = payload.message ?? `HTTP ${response.status}`;
      if (/limit|上限|exceed/i.test(message) && path === '/ad/create/') {
        throw new Error('Spark Ads 数量超过账户上限');
      }
      throw new Error(`TikTok Marketing API 扩展能力调用失败（${path}）：${message}`);
    }
    return (payload.data ?? ({} as T)) as T;
  }

  private baseUrl(): string {
    return process.env.TIKTOK_API_BASE_URL ?? TIKTOK_API_BASE_URL;
  }
}
