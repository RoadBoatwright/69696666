import type { Repository } from 'typeorm';

import { CredentialNotConfiguredError } from '../../common/errors/credential.error';
import { Opportunity } from '../opportunity-scoring/entities/opportunity.entity';
import { PlatformAdapterRegistry } from '../platform-adapter';
import type { PlatformAdapter } from '../platform-adapter/domain/platform-adapter';
import { Lead } from './entities/lead.entity';
import { LeadForm } from './entities/lead-form.entity';
import { InvalidLeadFormError, LeadFormNotFoundError, LeadService } from './lead.service';
import type { LeadFormConfigInput, LeadSubmission } from './domain/lead';

/** 通用内存仓储桩（支持 uuid 注入与多条匹配）。 */
function makeRepo<T extends object>(
  prefix: string,
  keyOf?: (e: T) => string,
): { repo: Repository<T>; store: Map<string, T> } {
  const store = new Map<string, T>();
  let seq = 0;
  const matches = (v: T, where: Partial<T>): boolean =>
    Object.entries(where).every(([k, val]) => (v as Record<string, unknown>)[k] === val);
  const recordKey = (e: T): string => {
    if (keyOf) {
      return keyOf(e);
    }
    const rec = e as Record<string, unknown>;
    if (!rec.id) {
      rec.id = `${prefix}-${++seq}`;
    }
    return rec.id as string;
  };
  const repo = {
    create: (e: Partial<T>) => ({ ...e }) as T,
    save: async (e: T) => {
      const key = recordKey(e);
      store.set(key, { ...e });
      return store.get(key)!;
    },
    remove: async (e: T) => {
      store.delete(recordKey(e));
      return e;
    },
    findOne: async ({ where }: { where: Partial<T> }) => {
      for (const v of store.values()) {
        if (matches(v, where)) return { ...v };
      }
      return null;
    },
    find: async ({ where }: { where?: Partial<T> } = {}) => {
      const out: T[] = [];
      for (const v of store.values()) {
        if (!where || matches(v, where)) out.push({ ...v });
      }
      return out;
    },
  } as unknown as Repository<T>;
  return { repo, store };
}

function makeAdapter(overrides: Partial<PlatformAdapter> = {}): PlatformAdapter {
  return {
    platform: 'meta',
    publishCampaign: async () => ({ platformCampaignId: 'pc', nativeIds: {} }),
    applyTargeting: async () => ({ nativeTargetingId: 't', notApplicable: [] }),
    uploadAsset: async () => ({ platformAssetId: 'pa' }),
    attachLeadForm: overrides.attachLeadForm ?? (async () => ({ platformLeadFormId: 'lf-1' })),
    submitConversionTracking: async () => ({ platformTrackingId: 'cv' }),
    fetchMetrics: async () => ({ platform: 'meta', rows: [] }),
    fetchReviewStatus: async () => [],
    supportedBiddingStrategies: () => ['MAXIMIZE_CONVERSIONS'],
  } as PlatformAdapter;
}

function setup(opts: { adapter?: PlatformAdapter } = {}) {
  const lead = makeRepo<Lead>('lead');
  const leadForm = makeRepo<LeadForm>('form');
  const opp = makeRepo<Opportunity>('opp');
  const adapter = opts.adapter ?? makeAdapter();
  const registry = {
    getAdapter: () => adapter,
    createContext: () => ({
      platform: adapter.platform,
      callWithCredential: async () => undefined,
    }),
  } as unknown as PlatformAdapterRegistry;
  const service = new LeadService(lead.repo, leadForm.repo, opp.repo, registry);
  return { service, lead, leadForm, opp, adapter };
}

const REQUIRED_FORM: LeadFormConfigInput = {
  adId: 'ad-1',
  fields: [
    { key: 'companyName', required: true },
    { key: 'name', required: true },
    { key: 'phone', required: true },
    { key: 'email', required: true },
  ],
};

function validSubmission(overrides: Partial<LeadSubmission> = {}): LeadSubmission {
  return {
    sourcePlatform: 'meta',
    platformLeadId: 'pl-1',
    sourceAdId: 'ad-1',
    ownerMerchantId: 'm1',
    collectedAt: new Date('2024-01-01T10:00:00Z'),
    companyName: 'Acme Trading Co',
    name: 'John Doe',
    phone: '+1 415 555 0132',
    email: 'john@acme-trading.com',
    ...overrides,
  };
}

describe('LeadService（组件 8，需求 14）', () => {
  describe('高门槛留资表单配置（需求 14.1）', () => {
    it('公司名/姓名/电话/邮箱必填且字段 1-30 的表单配置成功', async () => {
      const { service, leadForm } = setup();
      const form = await service.configureForm(REQUIRED_FORM);
      expect(form.id).toBeDefined();
      expect(leadForm.store.size).toBe(1);
    });

    it('缺必填字段定义则拒绝配置（需求 14.1）', async () => {
      const { service } = setup();
      await expect(
        service.configureForm({
          adId: 'ad-1',
          fields: [
            { key: 'companyName', required: true },
            { key: 'name', required: true },
          ],
        }),
      ).rejects.toBeInstanceOf(InvalidLeadFormError);
    });

    it('必填字段被标记为选填则拒绝配置（需求 14.1）', async () => {
      const { service } = setup();
      await expect(
        service.configureForm({
          adId: 'ad-1',
          fields: [
            { key: 'companyName', required: true },
            { key: 'name', required: true },
            { key: 'phone', required: true },
            { key: 'email', required: false },
          ],
        }),
      ).rejects.toBeInstanceOf(InvalidLeadFormError);
    });

    it('字段数量超过 30 则拒绝配置（需求 14.1）', async () => {
      const { service } = setup();
      const extra = Array.from({ length: 30 }, (_, i) => ({ key: `f${i}`, required: false }));
      await expect(
        service.configureForm({
          adId: 'ad-1',
          fields: [...REQUIRED_FORM.fields, ...extra],
        }),
      ).rejects.toBeInstanceOf(InvalidLeadFormError);
    });
  });

  describe('表单关联到广告（需求 14.2、14.3）', () => {
    it('提交成功则状态置「已关联」（需求 14.2）', async () => {
      const { service, leadForm } = setup();
      const form = await service.configureForm(REQUIRED_FORM);
      const result = await service.attachFormToAd(form.id, 'meta');
      expect(result.attached).toBe(true);
      expect(result.status).toBe('已关联');
      expect(result.platformLeadFormId).toBe('lf-1');
      expect(leadForm.store.get(form.id)?.status).toBe('已关联');
    });

    it('提交失败则状态置「关联失败」并返回原因（需求 14.3）', async () => {
      const adapter = makeAdapter({
        attachLeadForm: async () => {
          throw new Error('platform rejected form');
        },
      });
      const { service, leadForm } = setup({ adapter });
      const form = await service.configureForm(REQUIRED_FORM);
      const result = await service.attachFormToAd(form.id, 'meta');
      expect(result.attached).toBe(false);
      expect(result.status).toBe('关联失败');
      expect(result.reason).toContain('platform rejected form');
      expect(leadForm.store.get(form.id)?.status).toBe('关联失败');
    });

    it('凭据未配置时优雅降级为关联失败（需求 1.5、14.3）', async () => {
      const adapter = makeAdapter({
        attachLeadForm: async () => {
          throw new CredentialNotConfiguredError('meta');
        },
      });
      const { service } = setup({ adapter });
      const form = await service.configureForm(REQUIRED_FORM);
      const result = await service.attachFormToAd(form.id, 'meta');
      expect(result.status).toBe('关联失败');
      expect(result.reason).toContain('凭据未配置');
    });

    it('表单不存在抛 LeadFormNotFoundError', async () => {
      const { service } = setup();
      await expect(service.attachFormToAd('missing', 'meta')).rejects.toBeInstanceOf(
        LeadFormNotFoundError,
      );
    });
  });

  describe('买家留资回流（需求 14.4-14.8）', () => {
    it('缺任一必填项拒绝回流、不升格商机（需求 14.4）', async () => {
      const { service, lead, opp } = setup();
      const result = await service.ingestLead(validSubmission({ phone: '  ' }));
      expect(result.outcome).toBe('rejected_missing_required');
      expect(result.missingRequired).toContain('phone');
      expect(lead.store.size).toBe(0);
      expect(opp.store.size).toBe(0);
    });

    it('通过校验回流并升格为有效商机，记录来源与采集时间（需求 14.5、14.6）', async () => {
      const { service, lead, opp } = setup();
      const result = await service.ingestLead(validSubmission());
      expect(result.outcome).toBe('upgraded');
      expect(result.opportunityId).toBeDefined();
      const storedLead = lead.store.get(result.leadId!)!;
      expect(storedLead.sourcePlatform).toBe('meta');
      expect(storedLead.sourceAdId).toBe('ad-1');
      expect(storedLead.collectedAt).toEqual(new Date('2024-01-01T10:00:00Z'));
      expect(opp.store.size).toBe(1);
    });

    it('重复线索按来源平台+线索标识去重保留最早（需求 14.7）', async () => {
      const { service, lead } = setup();
      const first = await service.ingestLead(
        validSubmission({ collectedAt: new Date('2024-01-01T10:00:00Z') }),
      );
      const second = await service.ingestLead(
        validSubmission({ collectedAt: new Date('2024-01-01T12:00:00Z') }),
      );
      expect(second.outcome).toBe('deduped');
      expect(second.leadId).toBe(first.leadId);
      expect(lead.store.size).toBe(1);
      // 保留最早采集时间。
      expect(lead.store.get(first.leadId!)?.collectedAt).toEqual(new Date('2024-01-01T10:00:00Z'));
    });

    it('更早到达的重复线索更新为最早采集时间（需求 14.7）', async () => {
      const { service, lead } = setup();
      const first = await service.ingestLead(
        validSubmission({ collectedAt: new Date('2024-01-01T12:00:00Z') }),
      );
      await service.ingestLead(validSubmission({ collectedAt: new Date('2024-01-01T08:00:00Z') }));
      expect(lead.store.get(first.leadId!)?.collectedAt).toEqual(new Date('2024-01-01T08:00:00Z'));
    });

    it('回流/存储失败保留原始数据待重试（需求 14.8）', async () => {
      const { service, lead } = setup();
      // 让 opportunity 保存抛错以触发失败分支。
      jest.spyOn(service['opportunityRepo'], 'save').mockRejectedValueOnce(new Error('db down'));
      const result = await service.ingestLead(validSubmission());
      expect(result.outcome).toBe('failed');
      expect(result.reason).toContain('db down');
      // 原始数据被保留。
      const saved = [...lead.store.values()];
      expect(saved.some((l) => l.rawData != null || l.platformLeadId === 'pl-1')).toBe(true);
    });
  });

  describe('留资质量闸门（需求 14.9-14.12）', () => {
    it('邮箱格式无效标记低质量、区分存储不计入有效线索（需求 14.9、14.10）', async () => {
      const { service, opp } = setup();
      const result = await service.ingestLead(validSubmission({ email: 'not-an-email' }));
      expect(result.outcome).toBe('stored_low_quality');
      expect(result.quality?.isValidLead).toBe(false);
      expect(result.quality?.flags).toContain('email_format_invalid');
      expect(opp.store.size).toBe(0);
    });

    it('一次性邮箱域名标记低质量（需求 14.9、14.10）', async () => {
      const { service } = setup();
      const result = await service.ingestLead(validSubmission({ email: 'buyer@mailinator.com' }));
      expect(result.outcome).toBe('stored_low_quality');
      expect(result.quality?.flags).toContain('disposable_email');
    });

    it('全 0 电话等无效占位值标记低质量（需求 14.9、14.10）', async () => {
      const { service } = setup();
      const result = await service.ingestLead(validSubmission({ phone: '0000000000' }));
      expect(result.outcome).toBe('stored_low_quality');
      expect(result.quality?.flags).toContain('phone_format_invalid');
    });

    it('企业邮箱+公司名初判「疑似真实企业」（需求 14.12）', async () => {
      const { service } = setup();
      const result = await service.ingestLead(validSubmission());
      expect(result.quality?.enterpriseIdentity).toBe('疑似真实企业');
    });

    it('免费邮箱初判「疑似个人/免费邮箱」（需求 14.12）', async () => {
      const { service } = setup();
      const result = await service.ingestLead(validSubmission({ email: 'john@gmail.com' }));
      expect(result.quality?.enterpriseIdentity).toBe('疑似个人/免费邮箱');
    });

    it('批量同源高频提交标记疑似作弊、不升格（需求 14.11）', async () => {
      const { service, opp } = setup();
      const base = new Date('2024-01-01T10:00:00Z').getTime();
      const submissions: LeadSubmission[] = Array.from({ length: 6 }, (_, i) =>
        validSubmission({
          platformLeadId: `pl-${i}`,
          email: `buyer${i}@acme-trading.com`,
          phone: `+1 415 555 01${(10 + i).toString().padStart(2, '0')}`,
          name: `Buyer ${i}`,
          collectedAt: new Date(base + i * 1000),
        }),
      );
      const results = await service.ingestBatch(submissions);
      expect(results.every((r) => r.outcome === 'stored_low_quality')).toBe(true);
      expect(results.every((r) => r.quality?.qualityStatus === '疑似作弊')).toBe(true);
      expect(opp.store.size).toBe(0);
    });

    it('字段内容雷同的批量提交标记疑似作弊（需求 14.11）', async () => {
      const { service } = setup();
      const submissions: LeadSubmission[] = [0, 1].map((i) =>
        validSubmission({
          platformLeadId: `dup-${i}`,
          collectedAt: new Date(`2024-01-0${i + 1}T10:00:00Z`),
        }),
      );
      const results = await service.ingestBatch(submissions);
      expect(results.every((r) => r.quality?.flags.includes('bot_duplicate_content'))).toBe(true);
      expect(results.every((r) => r.outcome === 'stored_low_quality')).toBe(true);
    });
  });
});
