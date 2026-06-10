import type { CredentialManagerService } from '../credential/credential-manager.service';
import { ExtensionGatewayService } from '../extension/extension-gateway.service';
import { CatalogService } from './catalog.service';
import type { ProductFeed, ProductSet } from './entities';

function feedRepoStub(store: Map<string, ProductFeed>) {
  let seq = 0;
  return {
    create: (input: Partial<ProductFeed>) => ({ ...input }) as ProductFeed,
    save: async (feed: ProductFeed) => {
      if (!feed.id) {
        feed.id = `feed-${++seq}`;
      }
      store.set(feed.id, feed);
      return feed;
    },
    findOne: async ({ where }: { where: { id: string } }) => store.get(where.id) ?? null,
  };
}

function setRepoStub(store: Map<string, ProductSet>) {
  let seq = 0;
  return {
    create: (input: Partial<ProductSet>) => ({ ...input }) as ProductSet,
    save: async (set: ProductSet) => {
      if (!set.id) {
        set.id = `set-${++seq}`;
      }
      store.set(set.id, set);
      return set;
    },
    findOne: async ({ where }: { where: { id: string } }) => store.get(where.id) ?? null,
  };
}

function gatewayWith(status: 'filled' | 'unfilled'): ExtensionGatewayService {
  return new ExtensionGatewayService({
    getConfigStatus: async () => status,
  } as unknown as CredentialManagerService);
}

describe('CatalogService（任务 30，需求 24）', () => {
  function build(options: {
    status?: 'filled' | 'unfilled';
    metaSync?: () => Promise<{ catalogId: string }>;
    metaCreateSet?: () => Promise<{ productSetId: string }>;
  }) {
    const feeds = new Map<string, ProductFeed>();
    const sets = new Map<string, ProductSet>();
    const meta = {
      syncCatalogItems: options.metaSync ?? (async () => ({ catalogId: 'cat-1' })),
      createProductSet: options.metaCreateSet ?? (async () => ({ productSetId: 'ps-1' })),
    };
    const service = new CatalogService(
      feedRepoStub(feeds) as never,
      setRepoStub(sets) as never,
      gatewayWith(options.status ?? 'filled'),
      meta as never,
      {} as never,
      {} as never,
    );
    return { service, feeds, sets };
  }

  it('同步成功：记录状态、秒级时间与成功快照（需求 24.2）', async () => {
    const { service, feeds } = build({});
    const feed = await service.createFeed('meta', [{ sku: 'A' }]);
    const result = await service.syncFeed(feed.id, 'biz-1');
    expect(result.kind).toBe('ok');
    const saved = feeds.get(feed.id) as ProductFeed;
    expect(saved.syncStatus).toBe('同步成功');
    expect(saved.lastSyncedItems).toEqual([{ sku: 'A' }]);
    expect((saved.lastSyncAt as Date).getMilliseconds()).toBe(0);
  });

  it('同步失败：返回「同步失败」+ 原因，保留上次成功数据（需求 24.5）', async () => {
    let fail = false;
    const { service, feeds } = build({
      metaSync: async () => {
        if (fail) {
          throw new Error('网络中断');
        }
        return { catalogId: 'cat-1' };
      },
    });
    const feed = await service.createFeed('meta', [{ sku: 'A' }]);
    await service.syncFeed(feed.id, 'biz-1');
    fail = true;
    feeds.get(feed.id)!.items = [{ sku: 'B' }];
    const result = await service.syncFeed(feed.id, 'biz-1');
    expect(result.kind).toBe('sync_failed');
    if (result.kind === 'sync_failed') {
      expect(result.error).toBe('同步失败');
      expect(result.reason).toContain('网络中断');
    }
    const saved = feeds.get(feed.id) as ProductFeed;
    expect(saved.syncStatus).toBe('同步失败');
    expect(saved.lastSyncedItems).toEqual([{ sku: 'A' }]);
  });

  it('凭据未配置 → 经网关返回「该平台凭据未配置」（需求 24.4）', async () => {
    const { service } = build({ status: 'unfilled' });
    const feed = await service.createFeed('meta', []);
    const result = await service.syncFeed(feed.id, 'biz-1');
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') {
      expect(result.error).toBe('该平台凭据未配置');
    }
  });

  it('关联不存在的商品集 → 「商品集不存在」（需求 24.6）', async () => {
    const { service } = build({});
    const result = await service.resolveProductSetForAd('missing');
    expect(result).toEqual({ kind: 'not_found', error: '商品集不存在' });
  });

  it('基于已同步商品流创建商品集（需求 24.3）', async () => {
    const { service } = build({});
    const feed = await service.createFeed('meta', [{ sku: 'A' }]);
    await service.syncFeed(feed.id, 'biz-1');
    const created = await service.createProductSet(feed.id, 'biz-1', '热卖', { tag: 'hot' });
    expect(created.kind).toBe('ok');
    if (created.kind === 'ok') {
      const resolved = await service.resolveProductSetForAd(created.value.productSetId);
      expect(resolved.kind).toBe('ok');
    }
  });
});
