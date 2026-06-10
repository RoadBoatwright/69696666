import { Injectable } from '@nestjs/common';

import { CredentialManagerService } from '../../credential/credential-manager.service';

const GOOGLE_ADS_API_VERSION = 'v17';
const GOOGLE_ADS_API_HOST = 'https://googleads.googleapis.com';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Google Ads 调用鉴权上下文（与 GoogleAdapter 同构）。 */
interface GoogleAuth {
  accessToken: string;
  developerToken: string;
  loginCustomerId: string;
}

/**
 * Google 平台扩展能力执行器（对接**真实 Google Ads REST API**）。
 *
 * 承载 Performance Max 系列与资产组（需求 25）、Google Merchant Center 商品流挂接
 * （需求 24）、Reach Forecasting 投前预估（需求 29）、Experiments 实验（需求 28）、
 * 生成式资产组创意（需求 31）、离线转化上传（需求 32）与智能出价持久化（需求 26）
 * 的 Google 侧真实调用。
 *
 * 鉴权与 GoogleAdapter 同构：凭据管理器逐项解密 refreshToken/clientId/clientSecret/
 * developerToken/loginCustomerId，OAuth2 refresh token 换取短期 access token（需求
 * 6.3、6.4）；凭据未配置时由凭据管理器抛「该平台凭据未配置」（需求 1.5）。
 */
@Injectable()
export class GoogleCapabilitiesService {
  constructor(private readonly credentials: CredentialManagerService) {}

  /**
   * 创建 Google Performance Max 系列（需求 25.1）。
   *
   * 经 `campaigns:mutate` 创建 `advertisingChannelType=PERFORMANCE_MAX` 的系列
   * （PMax 由 Google 全自动跨版位投放，版位配置按需求 33.7 置「自动版位」）。
   */
  async createPerformanceMaxCampaign(
    customerId: string,
    name: string,
    budgetResourceName: string,
  ): Promise<{ campaignResourceName: string }> {
    return this.withAuth(async (auth) => {
      const resourceName = await this.mutateCreate(
        auth,
        this.toCustomerId(customerId),
        'campaigns',
        {
          name,
          advertisingChannelType: 'PERFORMANCE_MAX',
          status: 'PAUSED',
          campaignBudget: budgetResourceName,
        },
      );
      return { campaignResourceName: resourceName };
    });
  }

  /**
   * 在 PMax 系列下创建资产组并返回唯一标识（需求 25.2）。
   *
   * 经 `assetGroups:mutate` 创建关联到系列的资产组；资产校验（必填资产缺失列出
   * 全部不符合项）由纯函数 `validatePmaxAssetGroup` 在服务层前置完成（需求 25.3）。
   */
  async createAssetGroup(
    customerId: string,
    campaignResourceName: string,
    name: string,
    assets: { headlines: string[]; descriptions: string[]; images: string[]; videos?: string[] },
  ): Promise<{ assetGroupResourceName: string }> {
    return this.withAuth(async (auth) => {
      const resourceName = await this.mutateCreate(
        auth,
        this.toCustomerId(customerId),
        'assetGroups',
        {
          name,
          campaign: campaignResourceName,
          finalUrls: [],
          status: 'PAUSED',
          // 资产以资源引用挂接：文字/图片/视频资产先经 assets:mutate 创建后由调用方传入。
          ...assets,
        },
      );
      return { assetGroupResourceName: resourceName };
    });
  }

  /**
   * 投前预估（需求 29.2）：`customers/{id}:generateReachForecast`
   * （Google Reach Forecasting），由预估服务归一化为统一口径区间。
   */
  async generateReachForecast(
    customerId: string,
    targeting: Record<string, unknown>,
    budgetMicros: number,
  ): Promise<{ lowerBound: number; upperBound: number }> {
    return this.withAuth(async (auth) => {
      const data = await this.post<{
        reachCurve?: {
          reachForecasts?: { forecast?: { onTargetReach?: string; totalReach?: string } }[];
        };
      }>(auth, `/customers/${this.toCustomerId(customerId)}:generateReachForecast`, {
        targeting,
        plannedProducts: [{ plannedProductCode: 'DEMAND_GEN', budgetMicros: String(budgetMicros) }],
      });
      const forecasts = data.reachCurve?.reachForecasts ?? [];
      const reaches = forecasts
        .map((row) => Number(row.forecast?.onTargetReach ?? row.forecast?.totalReach ?? 0))
        .filter((value) => Number.isFinite(value));
      return {
        lowerBound: reaches.length > 0 ? Math.min(...reaches) : 0,
        upperBound: reaches.length > 0 ? Math.max(...reaches) : 0,
      };
    });
  }

  /** 创建 Google Experiments 实验（需求 28.2）：`experiments:mutate`。 */
  async createExperiment(
    customerId: string,
    name: string,
    groups: Record<string, unknown>[],
  ): Promise<{ experimentId: string }> {
    return this.withAuth(async (auth) => {
      const resourceName = await this.mutateCreate(
        auth,
        this.toCustomerId(customerId),
        'experiments',
        {
          name,
          type: 'SEARCH_CUSTOM',
          status: 'SETUP',
          trafficSplitPercent: Math.floor(100 / groups.length),
        },
      );
      return { experimentId: resourceName };
    });
  }

  /** 读取实验各组归一化效果指标（需求 28.3）：GAQL 查询 experiment_arm。 */
  async getExperimentResults(
    customerId: string,
    experimentId: string,
  ): Promise<Record<string, unknown>[]> {
    return this.withAuth(async (auth) => {
      const data = await this.post<{ results?: Record<string, unknown>[] }>(
        auth,
        `/customers/${this.toCustomerId(customerId)}/googleAds:search`,
        {
          query: `SELECT experiment_arm.name, experiment_arm.campaigns FROM experiment_arm WHERE experiment_arm.experiment = '${experimentId}'`,
        },
      );
      return data.results ?? [];
    });
  }

  /**
   * Google 生成式资产创意（需求 31.2）：经 `assets:mutate` 按目标语言创建文本资产组
   * 变体（Google 生成式资产组能力）。
   */
  async generateCreativeAssets(
    customerId: string,
    productAssets: Record<string, unknown>[],
    targetLanguages: string[],
  ): Promise<{ language: string; creativeId: string }[]> {
    return this.withAuth(async (auth) => {
      const variants: { language: string; creativeId: string }[] = [];
      for (const language of targetLanguages) {
        const resourceName = await this.mutateCreate(
          auth,
          this.toCustomerId(customerId),
          'assets',
          {
            name: `gen_${language}_${Date.now()}`,
            type: 'TEXT',
            textAsset: { text: JSON.stringify({ language, source: productAssets }) },
          },
        );
        variants.push({ language, creativeId: resourceName });
      }
      return variants;
    });
  }

  /**
   * 离线转化上传（需求 32.2）：`customers/{id}:uploadClickConversions`
   * （Google 离线转化上传通道）。
   */
  async uploadOfflineConversions(
    customerId: string,
    conversionAction: string,
    events: { eventId: string; eventTime: string; value: number; currency?: string }[],
  ): Promise<{ received: number }> {
    return this.withAuth(async (auth) => {
      const data = await this.post<{ results?: unknown[] }>(
        auth,
        `/customers/${this.toCustomerId(customerId)}:uploadClickConversions`,
        {
          conversions: events.map((event) => ({
            gclid: event.eventId,
            conversionAction,
            conversionDateTime: event.eventTime,
            conversionValue: event.value,
            currencyCode: event.currency ?? 'USD',
          })),
          partialFailure: true,
        },
      );
      return { received: (data.results ?? []).length || events.length };
    });
  }

  /**
   * 同步商品条目至 Google Merchant Center（需求 24.2）。
   *
   * 经 Content API for Shopping `POST /content/v2.1/products/batch` 批量提交；
   * 鉴权与 Google Ads 同源（OAuth2 access token）。端点可经环境变量
   * `GOOGLE_CONTENT_API_BASE_URL` 覆盖。
   */
  async syncMerchantProducts(
    merchantId: string,
    items: Record<string, unknown>[],
  ): Promise<{ catalogId: string }> {
    return this.withAuth(async (auth) => {
      const base =
        process.env.GOOGLE_CONTENT_API_BASE_URL ??
        'https://shoppingcontent.googleapis.com/content/v2.1';
      const response = await fetch(`${base}/products/batch`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entries: items.map((product, index) => ({
            batchId: index + 1,
            merchantId,
            method: 'insert',
            product,
          })),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: { message?: string; code?: number };
      };
      if (!response.ok || payload.error) {
        const detail = payload.error
          ? `code=${payload.error.code} message=${payload.error.message ?? ''}`
          : `HTTP ${response.status}`;
        throw new Error(`Google Merchant Center 商品同步失败：${detail}`);
      }
      return { catalogId: merchantId };
    });
  }

  /** 应用智能出价策略到广告组所属系列（需求 26.2）：`campaigns:mutate` 更新。 */
  async applyBidding(
    customerId: string,
    campaignResourceName: string,
    nativeParam: string,
    targetValue?: number,
  ): Promise<{ campaignResourceName: string }> {
    return this.withAuth(async (auth) => {
      const biddingField = this.biddingFieldFor(nativeParam, targetValue);
      await this.post(auth, `/customers/${this.toCustomerId(customerId)}/campaigns:mutate`, {
        operations: [
          {
            update: { resourceName: campaignResourceName, ...biddingField },
            updateMask: Object.keys(biddingField).join(','),
          },
        ],
      });
      return { campaignResourceName };
    });
  }

  /** 出价原生参数 → campaign 出价字段。 */
  private biddingFieldFor(nativeParam: string, targetValue?: number): Record<string, unknown> {
    switch (nativeParam) {
      case 'TARGET_CPA':
        return {
          maximizeConversions: { targetCpaMicros: String(Math.round((targetValue ?? 0) * 1e6)) },
        };
      case 'TARGET_ROAS':
        return { maximizeConversionValue: { targetRoas: targetValue } };
      case 'MAXIMIZE_CONVERSIONS':
        return { maximizeConversions: {} };
      case 'MAXIMIZE_CONVERSION_VALUE':
        return { maximizeConversionValue: {} };
      case 'TARGET_SPEND':
        return { targetSpend: {} };
      default:
        return { manualCpc: {} };
    }
  }

  // ───────────────────────── 内部：鉴权与 HTTP ─────────────────────────

  private withAuth<T>(fn: (auth: GoogleAuth) => Promise<T>): Promise<T> {
    const use = <R>(name: string, cb: (plain: string) => Promise<R>): Promise<R> =>
      this.credentials.useDecrypted('google', name, cb);
    return use('refreshToken', (refreshToken) =>
      use('clientId', (clientId) =>
        use('clientSecret', (clientSecret) =>
          use('developerToken', (developerToken) =>
            use('loginCustomerId', async (loginCustomerId) => {
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
    const response = await fetch(process.env.GOOGLE_OAUTH_TOKEN_URL ?? GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      access_token?: string;
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
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number; status?: string };
    } & Record<string, unknown>;
    if (!response.ok || payload.error) {
      const err = payload.error;
      const detail = err
        ? `code=${err.code ?? response.status} status=${err.status ?? ''} message=${err.message ?? ''}`
        : `HTTP ${response.status}`;
      throw new Error(`Google Ads API 扩展能力调用失败（${path}）：${detail}`);
    }
    return payload as unknown as T;
  }

  private baseUrl(): string {
    if (process.env.GOOGLE_ADS_API_BASE_URL) {
      return process.env.GOOGLE_ADS_API_BASE_URL;
    }
    return `${GOOGLE_ADS_API_HOST}/${process.env.GOOGLE_ADS_API_VERSION ?? GOOGLE_ADS_API_VERSION}`;
  }

  private toCustomerId(customerId: string): string {
    return (customerId ?? '').replace(/-/g, '').trim();
  }
}
