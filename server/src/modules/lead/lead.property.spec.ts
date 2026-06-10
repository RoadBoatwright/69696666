import fc from 'fast-check';
import type { Repository } from 'typeorm';

import { Opportunity } from '../opportunity-scoring/entities/opportunity.entity';
import { PlatformAdapterRegistry } from '../platform-adapter';
import type { PlatformAdapter } from '../platform-adapter/domain/platform-adapter';
import { Lead } from './entities/lead.entity';
import { LeadForm } from './entities/lead-form.entity';
import { LeadService } from './lead.service';
import { findMissingRequiredFields } from './pure';
import { REQUIRED_LEAD_FIELDS, type LeadSubmission } from './domain/lead';

/**
 * 线索收集服务属性测试（组件 8，需求 14）。
 *
 * 覆盖 Property 30（留资高门槛必填校验）与 Property 31（线索去重幂等保留最早）。
 * 仓储以内存桩注入，平台调用经假适配器。最少 100 次迭代。
 */

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

function makeAdapter(): PlatformAdapter {
  return {
    platform: 'meta',
    publishCampaign: async () => ({ platformCampaignId: 'pc', nativeIds: {} }),
    applyTargeting: async () => ({ nativeTargetingId: 't', notApplicable: [] }),
    uploadAsset: async () => ({ platformAssetId: 'pa' }),
    attachLeadForm: async () => ({ platformLeadFormId: 'lf' }),
    submitConversionTracking: async () => ({ platformTrackingId: 'cv' }),
    fetchMetrics: async () => ({ platform: 'meta', rows: [] }),
    fetchReviewStatus: async () => [],
    supportedBiddingStrategies: () => ['MAXIMIZE_CONVERSIONS'],
  } as PlatformAdapter;
}

function setup() {
  const lead = makeRepo<Lead>('lead');
  const leadForm = makeRepo<LeadForm>('form');
  const opp = makeRepo<Opportunity>('opp');
  const adapter = makeAdapter();
  const registry = {
    getAdapter: () => adapter,
    createContext: () => ({
      platform: adapter.platform,
      callWithCredential: async () => undefined,
    }),
  } as unknown as PlatformAdapterRegistry;
  const service = new LeadService(lead.repo, leadForm.repo, opp.repo, registry);
  return { service, lead, leadForm, opp };
}

/** 非空白字段值生成器（高质量值，避免命中占位/格式问题）。 */
const presentOrAbsent = (present: fc.Arbitrary<string>) =>
  fc.oneof(
    present,
    fc.constantFrom('', '   ', null as unknown as string, undefined as unknown as string),
  );

describe('线索收集服务属性测试（fast-check）', () => {
  // Feature: multi-platform-ad-integration, Property 30
  // Property 30: 留资高门槛必填校验
  // Validates: Requirements 14.4
  it('Property 30: 缺公司名/姓名/电话/邮箱任一的留资被拒绝回流、不升格为商机', async () => {
    await fc.assert(
      fc.asyncProperty(
        presentOrAbsent(fc.constant('Acme Trading Co')),
        presentOrAbsent(fc.constant('John Doe')),
        presentOrAbsent(fc.constant('+1 415 555 0132')),
        presentOrAbsent(fc.constant('john@acme-trading.com')),
        async (companyName, name, phone, email) => {
          const { service, lead, opp } = setup();
          const submission: LeadSubmission = {
            sourcePlatform: 'meta',
            platformLeadId: `pl-${Math.random()}`,
            ownerMerchantId: 'm1',
            collectedAt: new Date('2024-01-01T10:00:00Z'),
            companyName,
            name,
            phone,
            email,
          };

          const missing = findMissingRequiredFields(submission);
          const result = await service.ingestLead(submission);

          if (missing.length > 0) {
            // 缺任一必填项 → 拒绝回流、不存储线索、不升格商机（需求 14.4）。
            expect(result.outcome).toBe('rejected_missing_required');
            expect(result.missingRequired).toEqual(missing);
            expect(lead.store.size).toBe(0);
            expect(opp.store.size).toBe(0);
          } else {
            // 四项齐备 → 不应因必填校验被拒。
            expect(result.outcome).not.toBe('rejected_missing_required');
            // 全集必填项均非空白。
            for (const key of REQUIRED_LEAD_FIELDS) {
              expect(
                typeof submission[key] === 'string' && submission[key]!.trim().length > 0,
              ).toBe(true);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 31
  // Property 31: 线索去重幂等保留最早
  // Validates: Requirements 14.7
  it('Property 31: 含重复的回流序列按来源平台+线索标识去重保留最早，重复执行幂等', async () => {
    await fc.assert(
      fc.asyncProperty(
        // 一组共享同一 (sourcePlatform, platformLeadId) 的重复回流，仅采集时间不同。
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 8 }),
        fc.constantFrom('meta', 'google', 'tiktok'),
        async (offsets, platform) => {
          const { service, lead, opp } = setup();
          const baseTime = new Date('2024-01-01T00:00:00Z').getTime();
          const platformLeadId = 'pl-dedupe';

          for (const offset of offsets) {
            await service.ingestLead({
              sourcePlatform: platform,
              platformLeadId,
              ownerMerchantId: 'm1',
              collectedAt: new Date(baseTime + offset * 1000),
              companyName: 'Acme Trading Co',
              name: 'John Doe',
              phone: '+1 415 555 0132',
              email: 'john@acme-trading.com',
            });
          }

          // 去重：无论重复多少次，仅保留一条线索、至多一个商机（幂等，需求 14.7）。
          expect(lead.store.size).toBe(1);
          expect(opp.store.size).toBeLessThanOrEqual(1);

          // 保留最早采集时间（需求 14.7）。
          const earliest = baseTime + Math.min(...offsets) * 1000;
          const stored = [...lead.store.values()][0];
          expect(stored.collectedAt.getTime()).toBe(earliest);

          // 幂等：再次以非更早时间回流不改变记录数与最早时间。
          await service.ingestLead({
            sourcePlatform: platform,
            platformLeadId,
            ownerMerchantId: 'm1',
            collectedAt: new Date(baseTime + (Math.max(...offsets) + 100) * 1000),
            companyName: 'Acme Trading Co',
            name: 'John Doe',
            phone: '+1 415 555 0132',
            email: 'john@acme-trading.com',
          });
          expect(lead.store.size).toBe(1);
          expect([...lead.store.values()][0].collectedAt.getTime()).toBe(earliest);
        },
      ),
      { numRuns: 100 },
    );
  });
});
