import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { GoogleCapabilitiesService } from '../extension/capabilities/google-capabilities.service';
import { MetaCapabilitiesService } from '../extension/capabilities/meta-capabilities.service';
import { TikTokCapabilitiesService } from '../extension/capabilities/tiktok-capabilities.service';
import {
  ExtensionGatewayService,
  type GatewayResult,
} from '../extension/extension-gateway.service';
import type { PlatformId } from '../platform-adapter/domain/platform-adapter';
import { ProductFeed, ProductSet } from './entities';

/** 同步结果（需求 24.2、24.5）。 */
export type SyncResult =
  | GatewayResult<{ feedId: string; syncStatus: '同步成功'; lastSyncAt: Date }>
  | { kind: 'sync_failed'; error: '同步失败'; reason: string; feedId: string };

/** 商品集关联结果（需求 24.3、24.6）。 */
export type ProductSetResult =
  | GatewayResult<{ productSetId: string }>
  | { kind: 'not_found'; error: '商品集不存在' };

/**
 * 商品流服务（任务 30，需求 24）。
 *
 * 统一商品流抽象覆盖 Meta Catalog / Google Merchant Center / TikTok Catalog
 * （需求 24.1）；同步经各平台**真实 API** 完成并记录同步状态与精确到秒的最近同步
 * 时间（需求 24.2）；同步失败时返回「同步失败」+ 原因并保留最近一次成功的商品流
 * 数据（需求 24.5）；平台不支持或凭据缺失时经网关返回标准错误（需求 24.4）。
 */
@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(ProductFeed) private readonly feeds: Repository<ProductFeed>,
    @InjectRepository(ProductSet) private readonly sets: Repository<ProductSet>,
    private readonly gateway: ExtensionGatewayService,
    private readonly meta: MetaCapabilitiesService,
    private readonly google: GoogleCapabilitiesService,
    private readonly tiktok: TikTokCapabilitiesService,
  ) {}

  /** 创建统一商品流（需求 24.1）。 */
  async createFeed(platform: PlatformId, items: unknown[]): Promise<ProductFeed> {
    const feed = this.feeds.create({
      platform,
      items,
      lastSyncedItems: [],
      syncStatus: '未同步',
    });
    return this.feeds.save(feed);
  }

  /**
   * 同步商品流到平台目录（需求 24.2、24.4、24.5）。
   *
   * 成功：更新 `lastSyncedItems` 快照、`syncStatus='同步成功'`、`lastSyncAt`（秒级）。
   * 失败：`syncStatus='同步失败'` + `failureReason`，**保留**最近一次成功的
   * `lastSyncedItems` 不被覆盖。
   */
  async syncFeed(feedId: string, businessRef: string): Promise<SyncResult> {
    const feed = await this.feeds.findOne({ where: { id: feedId } });
    if (!feed) {
      return { kind: 'sync_failed', error: '同步失败', reason: '商品流不存在', feedId };
    }
    const platform = feed.platform as PlatformId;
    try {
      const routed = await this.gateway.invoke('product_catalog', platform, async () => {
        const items = feed.items as Record<string, unknown>[];
        if (platform === 'meta') {
          return this.meta.syncCatalogItems(
            businessRef,
            feed.platformCatalogId ?? undefined,
            items,
          );
        }
        if (platform === 'tiktok') {
          return this.tiktok.syncCatalogItems(
            businessRef,
            feed.platformCatalogId ?? undefined,
            items,
          );
        }
        // Google Merchant Center：经 Content API products/batch 批量提交。
        return this.google.syncMerchantProducts(businessRef, items);
      });
      if (routed.kind !== 'ok') {
        return routed;
      }
      const lastSyncAt = new Date(Math.floor(Date.now() / 1000) * 1000);
      feed.platformCatalogId = routed.value.catalogId;
      feed.lastSyncedItems = feed.items;
      feed.syncStatus = '同步成功';
      feed.lastSyncAt = lastSyncAt;
      feed.failureReason = null;
      await this.feeds.save(feed);
      return { kind: 'ok', value: { feedId, syncStatus: '同步成功', lastSyncAt } };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      feed.syncStatus = '同步失败';
      feed.failureReason = reason;
      // lastSyncedItems 保持最近一次成功快照不变（需求 24.5）。
      await this.feeds.save(feed);
      return { kind: 'sync_failed', error: '同步失败', reason, feedId };
    }
  }

  /** 基于商品流定义商品集（需求 24.3）。 */
  async createProductSet(
    feedId: string,
    businessRef: string,
    name: string,
    filter: Record<string, unknown>,
  ): Promise<ProductSetResult> {
    const feed = await this.feeds.findOne({ where: { id: feedId } });
    if (!feed || !feed.platformCatalogId) {
      return { kind: 'not_found', error: '商品集不存在' };
    }
    const platform = feed.platform as PlatformId;
    const routed = await this.gateway.invoke('product_catalog', platform, async () => {
      if (platform === 'meta') {
        return this.meta.createProductSet(feed.platformCatalogId as string, name, filter);
      }
      if (platform === 'tiktok') {
        return this.tiktok.createProductSet(
          businessRef,
          feed.platformCatalogId as string,
          name,
          filter,
        );
      }
      // Google 以 listing group filter 在 PMax 系列创建时表达商品集：此处仅保留筛选
      // 定义（无独立平台对象），实际过滤条件在 assetGroupListingGroupFilters 中下发。
      return { productSetId: '' };
    });
    if (routed.kind !== 'ok') {
      return routed;
    }
    const set = this.sets.create({
      feedId,
      name,
      filter,
      platformSetId: routed.value.productSetId || null,
    });
    const saved = await this.sets.save(set);
    return { kind: 'ok', value: { productSetId: saved.id } };
  }

  /**
   * 动态商品广告关联商品集（需求 24.3、24.6）。
   *
   * 商品集不存在时返回「商品集不存在」。
   */
  async resolveProductSetForAd(productSetId: string): Promise<ProductSetResult> {
    const set = await this.sets.findOne({ where: { id: productSetId } });
    if (!set) {
      return { kind: 'not_found', error: '商品集不存在' };
    }
    return { kind: 'ok', value: { productSetId: set.platformSetId ?? set.id } };
  }
}
