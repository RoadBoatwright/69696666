import type { Repository } from 'typeorm';

import { AiCampaignService, DraftNotConfirmedError } from './ai-campaign.service';
import type { CredentialManagerService } from '../credential/credential-manager.service';
import { CampaignDraft } from './entities/campaign-draft.entity';
import { GLOBAL_REVIEW_MODE_SCOPE, ReviewModeConfig } from './entities/review-mode-config.entity';
import type {
  AutoAdjustmentApplier,
  CampaignPublisher,
  GeminiClient,
  OptimizationDataProvider,
} from './ports';
import type { Actor } from '../rbac/domain';
import type { BuyerPersona, OptimizationSnapshot, PlatformDraft } from './domain/ai-campaign';
import type { AssetRef } from '../platform-adapter/domain/platform-adapter';

/** 通用内存仓储桩。 */
function makeRepo<T extends object & { id?: string }>(
  prefix: string,
  keyOf?: (e: T) => string,
): { repo: Repository<T>; store: Map<string, T> } {
  const store = new Map<string, T>();
  let seq = 0;
  const matches = (v: T, where: Partial<T>): boolean =>
    Object.entries(where).every(([k, val]) => (v as Record<string, unknown>)[k] === val);
  const keyFor = (e: T): string => {
    if (keyOf) {
      return keyOf(e);
    }
    const withId = e as T & { id?: string };
    if (!withId.id) {
      withId.id = `${prefix}-${++seq}`;
    }
    return withId.id;
  };
  const repo = {
    create: (e: Partial<T>) => ({ ...e }) as T,
    save: async (e: T) => {
      const key = keyFor(e);
      store.set(key, { ...e });
      return store.get(key)!;
    },
    findOne: async ({ where }: { where: Partial<T> }) => {
      for (const v of store.values()) {
        if (matches(v, where)) return { ...v };
      }
      return null;
    },
  } as unknown as Repository<T>;
  return { repo, store };
}

const ACTOR: Actor = { id: 'op-1', role: 'operator', assignedMerchantIds: ['m1'] };

const PERSONA: BuyerPersona = { geo: 'US', industry: 'SaaS', jobRole: 'CEO' };
const MATERIALS: AssetRef[] = [{ assetId: 'a1', type: 'image', source: 's3://a1' }];

function fakeDrafts(): PlatformDraft[] {
  return [
    {
      platform: 'meta',
      campaign: { name: 'c', objective: 'LEADS' },
      adGroup: {},
      ad: {},
      assetRefs: MATERIALS,
      leadFormSuggestion: {},
    },
  ];
}

interface Deps {
  geminiAvailable: boolean;
  gemini?: Partial<GeminiClient>;
  provider?: Partial<OptimizationDataProvider>;
  publisher?: Partial<CampaignPublisher>;
  applier?: AutoAdjustmentApplier;
}

function setup(deps: Deps) {
  const draft = makeRepo<CampaignDraft>('draft');
  const reviewMode = makeRepo<ReviewModeConfig>('rmc', (e) => e.scope);

  const credentials = {
    isGeminiAvailable: async () => deps.geminiAvailable,
    redact: (s: string) => s,
  } as unknown as CredentialManagerService;

  const gemini: GeminiClient = {
    derivePersona: deps.gemini?.derivePersona ?? (async () => PERSONA),
    generatePlatformDrafts: deps.gemini?.generatePlatformDrafts ?? (async () => fakeDrafts()),
  };

  const provider: OptimizationDataProvider = {
    loadSnapshot:
      deps.provider?.loadSnapshot ?? (async (campaignId: string) => emptySnapshot(campaignId)),
  };

  const published: string[][] = [];
  const publisher: CampaignPublisher = {
    publishFromDraft:
      deps.publisher?.publishFromDraft ??
      (async (input) => {
        published.push(input.platformDrafts.map((d) => d.platform));
        return input.platformDrafts.map((_, i) => `camp-${i}`);
      }),
  };

  const service = new AiCampaignService(
    draft.repo,
    reviewMode.repo,
    credentials,
    gemini,
    provider,
    publisher,
    deps.applier,
  );
  return { service, draft, reviewMode, published };
}

function emptySnapshot(campaignId: string): OptimizationSnapshot {
  return {
    campaignId,
    hasMetrics: true,
    impressions: 100,
    clicks: 10,
    conversions: 2,
    spend: 50,
    roi: 0.5,
    segments: [],
    totalHighIntentOpportunities: 0,
  };
}

describe('AiCampaignService（组件 5，需求 9）', () => {
  describe('derivePersona（需求 9.1）', () => {
    it('显式指定画像采用人工指定来源', async () => {
      const { service } = setup({ geminiAvailable: false });
      const r = await service.derivePersona(ACTOR, {
        positioning: 'x',
        materials: MATERIALS,
        override: PERSONA,
      });
      expect(r).toEqual({ persona: PERSONA, source: '人工指定' });
    });

    it('Gemini 未配置时返回不可用降级（需求 9.7）', async () => {
      const { service } = setup({ geminiAvailable: false });
      const r = await service.derivePersona(ACTOR, { positioning: 'x', materials: MATERIALS });
      expect(r).toEqual({ unavailable: true });
    });

    it('缺产品定位描述时由 AI 从素材推理产品信息后推导画像', async () => {
      const { service } = setup({ geminiAvailable: true });
      const r = await service.derivePersona(ACTOR, { positioning: '', materials: MATERIALS });
      expect(r).toEqual({ persona: PERSONA, source: 'AI自动推导' });
    });

    it('缺素材时返回缺失项（需求 9.8）', async () => {
      const { service } = setup({ geminiAvailable: true });
      const r = await service.derivePersona(ACTOR, { positioning: '', materials: [] });
      expect(r).toEqual({ error: ['成品广告素材'] });
    });

    it('国家/地区缺失时默认泰国（产品约定）', async () => {
      const { service } = setup({ geminiAvailable: false });
      const r = await service.derivePersona(ACTOR, {
        positioning: 'x',
        materials: MATERIALS,
        override: { geo: '', industry: 'SaaS', jobRole: 'CEO' },
      });
      expect(r).toEqual({
        persona: { geo: '泰国', industry: 'SaaS', jobRole: 'CEO' },
        source: '人工指定',
      });
    });

    it('AI 推导成功标记来源「AI自动推导」', async () => {
      const { service } = setup({ geminiAvailable: true });
      const r = await service.derivePersona(ACTOR, { positioning: 'x', materials: MATERIALS });
      expect(r).toEqual({ persona: PERSONA, source: 'AI自动推导' });
    });
  });

  describe('generateDraft（需求 9.2、9.7、9.8）', () => {
    it('缺素材与画像维度返回全部缺失项不生成（需求 9.8）', async () => {
      const { service, draft } = setup({ geminiAvailable: true });
      const r = await service.generateDraft(ACTOR, {
        merchantId: 'm1',
        materials: [],
        persona: { geo: '', industry: '', jobRole: '' },
      });
      // 国家/地区缺失时默认泰国，不再计入缺失项（产品约定）。
      expect(r).toEqual({
        error: ['成品广告素材', '行业', '职位'],
      });
      expect(draft.store.size).toBe(0);
    });

    it('Gemini 未配置返回不可用降级（需求 9.7）', async () => {
      const { service } = setup({ geminiAvailable: false });
      const r = await service.generateDraft(ACTOR, {
        merchantId: 'm1',
        materials: MATERIALS,
        persona: PERSONA,
      });
      expect(r).toEqual({ unavailable: true });
    });

    it('全自动档生成后自动确认并驱动投放（需求 9.3）', async () => {
      const { service, published } = setup({ geminiAvailable: true });
      const r = await service.generateDraft(ACTOR, {
        merchantId: 'm1',
        materials: MATERIALS,
        persona: PERSONA,
      });
      expect('confirmStatus' in r && r.confirmStatus).toBe('已确认');
      expect(published.length).toBe(1);
    });

    it('专家把关档置「待确认」且不驱动投放（需求 9.5）', async () => {
      const { service, reviewMode, published } = setup({ geminiAvailable: true });
      await reviewMode.repo.save({ scope: 'm1', mode: '专家把关' } as ReviewModeConfig);
      const r = await service.generateDraft(ACTOR, {
        merchantId: 'm1',
        materials: MATERIALS,
        persona: PERSONA,
      });
      expect('confirmStatus' in r && r.confirmStatus).toBe('待确认');
      expect(published.length).toBe(0);
    });
  });

  describe('审核模式两级配置（需求 9.4）', () => {
    it('单商家未覆盖时采用全局默认（默认全自动）', async () => {
      const { service } = setup({ geminiAvailable: true });
      expect(await service.resolveReviewMode('m1')).toBe('全自动');
    });

    it('全局默认可设为专家把关', async () => {
      const { service, reviewMode } = setup({ geminiAvailable: true });
      await service.setGlobalReviewMode('专家把关');
      expect(reviewMode.store.get(GLOBAL_REVIEW_MODE_SCOPE)!.mode).toBe('专家把关');
      expect(await service.resolveReviewMode('m1')).toBe('专家把关');
    });

    it('单商家覆盖优先于全局默认', async () => {
      const { service } = setup({ geminiAvailable: true });
      await service.setGlobalReviewMode('专家把关');
      await service.setMerchantReviewMode('m1', '全自动');
      expect(await service.resolveReviewMode('m1')).toBe('全自动');
      expect(await service.resolveReviewMode('m2')).toBe('专家把关');
    });
  });

  describe('canPublish + confirm（需求 9.5、9.6）', () => {
    it('待确认草案不得发布投放（需求 9.6）', async () => {
      const { service, draft } = setup({ geminiAvailable: true });
      const d = await draft.repo.save({
        merchantId: 'm1',
        confirmStatus: '待确认',
        platformDrafts: fakeDrafts(),
      } as unknown as CampaignDraft);
      await expect(service.assertPublishable(d.id!)).rejects.toBeInstanceOf(DraftNotConfirmedError);
    });

    it('confirm 置「已确认」并驱动投放（需求 9.3、9.6）', async () => {
      const { service, draft, published } = setup({ geminiAvailable: true });
      const d = await draft.repo.save({
        merchantId: 'm1',
        confirmStatus: '待确认',
        platformDrafts: fakeDrafts(),
      } as unknown as CampaignDraft);
      const r = await service.confirm(ACTOR, d.id!);
      expect(r.confirmStatus).toBe('已确认');
      expect(r.campaignIds.length).toBe(1);
      expect(published.length).toBe(1);
      expect(draft.store.get(d.id!)!.confirmStatus).toBe('已确认');
    });
  });

  describe('analyze（需求 9.9、9.12）', () => {
    it('Gemini 未配置返回不可用（需求 9.7）', async () => {
      const { service } = setup({ geminiAvailable: false });
      const r = await service.analyze(ACTOR, 'camp-1');
      expect(r).toEqual({ unavailable: true });
    });

    it('数据缺失返回数据不可用（需求 9.12）', async () => {
      const { service } = setup({
        geminiAvailable: true,
        provider: {
          loadSnapshot: async (campaignId) => ({
            ...emptySnapshot(campaignId),
            hasMetrics: false,
          }),
        },
      });
      const r = await service.analyze(ACTOR, 'camp-1');
      expect(r).toEqual({ dataUnavailable: true });
    });

    it('数据拉取失败按数据不可用处理（需求 9.12）', async () => {
      const { service } = setup({
        geminiAvailable: true,
        provider: {
          loadSnapshot: async () => {
            throw new Error('platform api error');
          },
        },
      });
      const r = await service.analyze(ACTOR, 'camp-1');
      expect(r).toEqual({ dataUnavailable: true });
    });

    it('以有效高意向商机占比生成预算再分配建议（需求 9.15）', async () => {
      const { service } = setup({
        geminiAvailable: true,
        provider: {
          loadSnapshot: async (campaignId) => ({
            ...emptySnapshot(campaignId),
            segments: [
              {
                segmentId: 'seg-high',
                currentDailyBudget: 100,
                currentBid: 1,
                totalOpportunities: 10,
                highIntentOpportunities: 8,
              },
              {
                segmentId: 'seg-low',
                currentDailyBudget: 100,
                currentBid: 1,
                totalOpportunities: 10,
                highIntentOpportunities: 1,
              },
            ],
          }),
        },
      });
      const r = await service.analyze(ACTOR, 'camp-1');
      expect(Array.isArray(r)).toBe(true);
      if (Array.isArray(r)) {
        const items = r.map((s) => s.adjustmentItem);
        expect(items).toContain('budget:seg-high');
        expect(items).toContain('budget:seg-low');
      }
    });
  });

  describe('applyAuto（需求 9.11、9.13、9.14）', () => {
    function snapshotWithBudgetSuggestion(campaignId: string): OptimizationSnapshot {
      return {
        ...emptySnapshot(campaignId),
        segments: [
          {
            segmentId: 'seg-high',
            currentDailyBudget: 100,
            currentBid: 1,
            totalOpportunities: 10,
            highIntentOpportunities: 8,
          },
          {
            segmentId: 'seg-low',
            currentDailyBudget: 100,
            currentBid: 1,
            totalOpportunities: 10,
            highIntentOpportunities: 1,
          },
        ],
      };
    }

    it('上下限内应用调整并记录时间（需求 9.11）', async () => {
      const applied: string[] = [];
      const { service } = setup({
        geminiAvailable: true,
        provider: { loadSnapshot: async (id) => snapshotWithBudgetSuggestion(id) },
        applier: {
          apply: async (_c, item) => {
            applied.push(item);
          },
        },
      });
      const r = await service.applyAuto(ACTOR, 'camp-1', {
        budgetMin: 0,
        budgetMax: 1000,
        bidMin: 0,
        bidMax: 100,
      });
      expect('applied' in r && r.applied.length).toBeGreaterThan(0);
      if ('applied' in r) {
        expect(r.applied[0].appliedAt).toBeInstanceOf(Date);
      }
      expect(applied.length).toBeGreaterThan(0);
    });

    it('超出授权范围转人工确认（需求 9.13）', async () => {
      const { service } = setup({
        geminiAvailable: true,
        provider: { loadSnapshot: async (id) => snapshotWithBudgetSuggestion(id) },
        applier: { apply: async () => undefined },
      });
      // 上限极低，预算建议（120）超限。
      const r = await service.applyAuto(ACTOR, 'camp-1', {
        budgetMin: 0,
        budgetMax: 50,
        bidMin: 0,
        bidMax: 100,
      });
      expect('needsManualConfirmation' in r && r.needsManualConfirmation.length).toBeGreaterThan(0);
    });

    it('应用失败保留原配置并记录原因（需求 9.14）', async () => {
      const { service } = setup({
        geminiAvailable: true,
        provider: { loadSnapshot: async (id) => snapshotWithBudgetSuggestion(id) },
        applier: {
          apply: async () => {
            throw new Error('apply failed');
          },
        },
      });
      const r = await service.applyAuto(ACTOR, 'camp-1', {
        budgetMin: 0,
        budgetMax: 1000,
        bidMin: 0,
        bidMax: 100,
      });
      expect('failed' in r && r.failed.length).toBeGreaterThan(0);
      if ('failed' in r) {
        expect(r.failed[0].reason).toContain('apply failed');
      }
    });
  });
});
