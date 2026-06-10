import type { Repository } from 'typeorm';

import { AccountAuthorization } from '../auth-center/entities/account-authorization.entity';
import { CredentialNotConfiguredError } from '../../common/errors/credential.error';
import { PlatformAdapterRegistry } from '../platform-adapter';
import type { PlatformAdapter } from '../platform-adapter/domain/platform-adapter';
import {
  CampaignService,
  CampaignValidationFailure,
  ParentNotFoundError,
} from './campaign.service';
import { Ad } from './entities/ad.entity';
import { AdGroup } from './entities/ad-group.entity';
import { BudgetSchedule } from './entities/budget-schedule.entity';
import { Campaign } from './entities/campaign.entity';
import { Targeting } from './entities/targeting.entity';

/** 通用内存仓储桩。 */
function makeRepo<T extends { id?: string }>(
  prefix: string,
): {
  repo: Repository<T>;
  store: Map<string, T>;
} {
  const store = new Map<string, T>();
  let seq = 0;
  const repo = {
    create: (e: Partial<T>) => ({ ...e }) as T,
    save: async (e: T) => {
      if (!e.id) {
        e.id = `${prefix}-${++seq}`;
      }
      store.set(e.id, { ...e });
      return store.get(e.id)!;
    },
    findOne: async ({ where }: { where: Partial<T> }) => {
      for (const v of store.values()) {
        const match = Object.entries(where).every(
          ([k, val]) => (v as Record<string, unknown>)[k] === val,
        );
        if (match) {
          return { ...v };
        }
      }
      return null;
    },
    count: async ({ where }: { where: Partial<T> } = { where: {} as Partial<T> }) => {
      let n = 0;
      for (const v of store.values()) {
        const match = Object.entries(where).every(
          ([k, val]) => (v as Record<string, unknown>)[k] === val,
        );
        if (match) {
          n += 1;
        }
      }
      return n;
    },
  } as unknown as Repository<T>;
  return { repo, store };
}

/** 可配置行为的假平台适配器。 */
function makeAdapter(
  overrides: Partial<PlatformAdapter> & { platform?: 'meta' | 'google' | 'tiktok' } = {},
): PlatformAdapter {
  return {
    platform: overrides.platform ?? 'meta',
    publishCampaign:
      overrides.publishCampaign ??
      (async () => ({ platformCampaignId: 'pc-1', nativeIds: { campaign: 'pc-1' } })),
    applyTargeting:
      overrides.applyTargeting ?? (async () => ({ nativeTargetingId: 'tg-1', notApplicable: [] })),
    uploadAsset: async () => ({ platformAssetId: 'a-1' }),
    attachLeadForm: async () => ({ platformLeadFormId: 'lf-1' }),
    submitConversionTracking: async () => ({ platformTrackingId: 'cv-1' }),
    fetchMetrics: async () => ({ platform: overrides.platform ?? 'meta', rows: [] }),
    fetchReviewStatus: async () => [],
    supportedBiddingStrategies:
      overrides.supportedBiddingStrategies ?? (() => ['MAXIMIZE_CONVERSIONS', 'TARGET_CPA']),
  } as PlatformAdapter;
}

function setup(adapter: PlatformAdapter = makeAdapter()) {
  const campaign = makeRepo<Campaign>('camp');
  const adGroup = makeRepo<AdGroup>('ag');
  const ad = makeRepo<Ad>('ad');
  const targeting = makeRepo<Targeting>('tg');
  const budget = makeRepo<BudgetSchedule>('bg');
  const account = makeRepo<AccountAuthorization>('acc');

  const registry = {
    getAdapter: () => adapter,
    createContext: () => ({
      platform: adapter.platform,
      callWithCredential: async () => undefined,
    }),
  } as unknown as PlatformAdapterRegistry;

  const service = new CampaignService(
    campaign.repo,
    adGroup.repo,
    ad.repo,
    targeting.repo,
    budget.repo,
    account.repo,
    registry,
  );
  return { service, campaign, adGroup, ad, targeting, budget, account };
}

describe('CampaignService（组件 6，需求 8、10、12、13）', () => {
  describe('三级 CRUD 与约束校验（需求 8）', () => {
    it('创建广告系列：合法输入返回带标识的实体', async () => {
      const { service } = setup();
      const c = await service.createCampaign({
        merchantId: 'm1',
        name: '系列A',
        objective: 'LEADS',
        platform: 'meta',
      });
      expect(c.id).toBeDefined();
      expect(c.publishStatus).toBe('未提交');
    });

    it('创建广告系列：必填缺失返回完整不符合项（需求 8.7）', async () => {
      const { service } = setup();
      await expect(
        service.createCampaign({ merchantId: '', name: '', objective: '', platform: '' as never }),
      ).rejects.toMatchObject({ name: 'CampaignValidationFailure' });
      try {
        await service.createCampaign({
          merchantId: '',
          name: '',
          objective: '',
          platform: '' as never,
        });
      } catch (e) {
        const fields = (e as CampaignValidationFailure).errors.map((x) => x.field);
        expect(fields).toEqual(
          expect.arrayContaining(['merchantId', 'name', 'objective', 'platform']),
        );
      }
    });

    // Property 16: 父级不存在拒绝建子级（需求 8.6）
    it('父级广告系列不存在时创建广告组被拒（需求 8.6）', async () => {
      const { service } = setup();
      await expect(service.createAdGroup({ campaignId: 'missing' })).rejects.toBeInstanceOf(
        ParentNotFoundError,
      );
    });

    it('父级广告组不存在时创建广告被拒（需求 8.6）', async () => {
      const { service } = setup();
      await expect(service.createAd({ adGroupId: 'missing' })).rejects.toBeInstanceOf(
        ParentNotFoundError,
      );
    });

    it('在已存在父级下创建子级成功', async () => {
      const { service } = setup();
      const c = await service.createCampaign({
        merchantId: 'm1',
        name: '系列A',
        objective: 'LEADS',
        platform: 'meta',
      });
      const ag = await service.createAdGroup({ campaignId: c.id });
      expect(ag.campaignId).toBe(c.id);
      const ad = await service.createAd({ adGroupId: ag.id });
      expect(ad.adGroupId).toBe(ag.id);
    });
  });

  describe('预算/出价/排期校验（需求 12）', () => {
    it('合法预算/出价保存成功', async () => {
      const { service } = setup();
      const c = await service.createCampaign({
        merchantId: 'm1',
        name: '系列A',
        objective: 'LEADS',
        platform: 'meta',
      });
      const ag = await service.createAdGroup({ campaignId: c.id });
      const bs = await service.setBudgetSchedule(ag.id, {
        dailyBudget: 50,
        totalBudget: 500,
        biddingStrategy: 'MAXIMIZE_CONVERSIONS',
      });
      expect(bs.dailyBudget).toBe('50.00');
      expect(bs.totalBudget).toBe('500.00');
    });

    it('出价方式不被平台支持时拒绝（需求 12.7）', async () => {
      const { service } = setup();
      const c = await service.createCampaign({
        merchantId: 'm1',
        name: '系列A',
        objective: 'LEADS',
        platform: 'meta',
      });
      const ag = await service.createAdGroup({ campaignId: c.id });
      await expect(
        service.setBudgetSchedule(ag.id, {
          dailyBudget: 50,
          totalBudget: 500,
          biddingStrategy: 'MANUAL_CPC',
        }),
      ).rejects.toMatchObject({ name: 'CampaignValidationFailure' });
    });
  });

  describe('受众定向配置（需求 10）', () => {
    it('合法定向经适配器应用并持久化，回传不适用维度（需求 10.3、10.4）', async () => {
      const adapter = makeAdapter({
        applyTargeting: async () => ({ nativeTargetingId: 't', notApplicable: ['jobRole'] }),
      });
      const { service } = setup(adapter);
      const c = await service.createCampaign({
        merchantId: 'm1',
        name: '系列A',
        objective: 'LEADS',
        platform: 'meta',
      });
      const ag = await service.createAdGroup({ campaignId: c.id });
      const result = await service.configureTargeting(ag.id, {
        geo: ['US'],
        jobRole: ['CEO'],
        ageMin: 25,
        ageMax: 45,
        gender: '不限',
        excludedAudiences: ['students'],
        lookalikeSeedOpportunityIds: ['opp-1'],
      });
      expect(result.notApplicable).toContain('jobRole');
      expect(result.targeting.ageMin).toBe(25);
    });

    it('年龄越界拒绝（需求 10.1、10.7）', async () => {
      const { service } = setup();
      const c = await service.createCampaign({
        merchantId: 'm1',
        name: '系列A',
        objective: 'LEADS',
        platform: 'meta',
      });
      const ag = await service.createAdGroup({ campaignId: c.id });
      await expect(service.configureTargeting(ag.id, { ageMin: 5 })).rejects.toMatchObject({
        name: 'CampaignValidationFailure',
      });
    });

    it('平台凭据未配置时优雅降级，仍持久化定向（需求 1.5）', async () => {
      const adapter = makeAdapter({
        applyTargeting: async () => {
          throw new CredentialNotConfiguredError('meta');
        },
      });
      const { service } = setup(adapter);
      const c = await service.createCampaign({
        merchantId: 'm1',
        name: '系列A',
        objective: 'LEADS',
        platform: 'meta',
      });
      const ag = await service.createAdGroup({ campaignId: c.id });
      const result = await service.configureTargeting(ag.id, { geo: ['US'] });
      expect(result.targeting.geo).toEqual(['US']);
      expect(result.notApplicable).toEqual([]);
    });
  });

  describe('投放编排与状态机（需求 13）', () => {
    async function seedCampaignWithAuth(
      service: CampaignService,
      account: ReturnType<typeof setup>['account'],
      authStatus: AccountAuthorization['authStatus'],
    ) {
      const c = await service.createCampaign({
        merchantId: 'm1',
        name: '系列A',
        objective: 'LEADS',
        platform: 'meta',
      });
      await account.repo.save({
        platform: 'meta',
        merchantId: 'm1',
        authStatus,
        scopes: null,
        authModelMeta: null,
      } as AccountAuthorization);
      return c;
    }

    it('有效授权投放成功置「已提交」并写入 first_published_at（需求 13.2）', async () => {
      const { service, account, campaign } = setup();
      const c = await seedCampaignWithAuth(service, account, '有效');
      const result = await service.publishCampaign(c.id);
      expect(result.accepted).toBe(true);
      expect(result.status).toBe('已提交');
      expect(result.platformObjectId).toBe('pc-1');
      const stored = campaign.store.get(c.id)!;
      expect(stored.firstPublishedAt).toBeInstanceOf(Date);
    });

    it('非有效授权阻止投放，保持「未提交」（需求 13.4，Property 28）', async () => {
      const { service, account } = setup();
      const c = await seedCampaignWithAuth(service, account, '需重新授权');
      const result = await service.publishCampaign(c.id);
      expect(result.accepted).toBe(false);
      expect(result.status).toBe('未提交');
    });

    it('当前「提交中」拒绝重复投放（需求 13.6，Property 29）', async () => {
      const { service, account, campaign } = setup();
      const c = await seedCampaignWithAuth(service, account, '有效');
      const stored = campaign.store.get(c.id)!;
      stored.publishStatus = '提交中';
      campaign.store.set(c.id, stored);
      const result = await service.publishCampaign(c.id);
      expect(result.accepted).toBe(false);
      expect(result.status).toBe('提交中');
    });

    it('平台返回失败置「投放失败」（需求 13.3）', async () => {
      const adapter = makeAdapter({
        publishCampaign: async () => {
          throw new Error('platform rejected');
        },
      });
      const { service, account } = setup(adapter);
      const c = await seedCampaignWithAuth(service, account, '有效');
      const result = await service.publishCampaign(c.id);
      expect(result.status).toBe('投放失败');
      expect(result.reason).toContain('platform rejected');
    });

    it('平台超时置「投放超时」（需求 13.5）', async () => {
      const adapter = makeAdapter({
        publishCampaign: () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ platformCampaignId: 'x', nativeIds: {} }), 50),
          ),
      });
      const { service, account } = setup(adapter);
      const c = await seedCampaignWithAuth(service, account, '有效');
      const result = await service.publishCampaign(c.id, { timeoutMs: 5 });
      expect(result.status).toBe('投放超时');
    });

    it('first_published_at 二次投放不覆盖', async () => {
      const { service, account, campaign } = setup();
      const c = await seedCampaignWithAuth(service, account, '有效');
      await service.publishCampaign(c.id);
      const firstTime = campaign.store.get(c.id)!.firstPublishedAt;
      // 重置为非提交中以允许再次投放。
      const stored = campaign.store.get(c.id)!;
      stored.publishStatus = '已提交';
      campaign.store.set(c.id, stored);
      await service.publishCampaign(c.id);
      expect(campaign.store.get(c.id)!.firstPublishedAt).toEqual(firstTime);
    });
  });
});
