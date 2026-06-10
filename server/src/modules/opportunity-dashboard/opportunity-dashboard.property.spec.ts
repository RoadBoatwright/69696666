import * as fc from 'fast-check';
import type { Repository } from 'typeorm';

import { OpportunityDashboardService } from './opportunity-dashboard.service';
import type { Actor } from '../rbac/domain/rbac';

function makeRepo<T extends Record<string, unknown>>(rows: T[]): Repository<T> {
  return {
    find: async (opts?: { where?: Record<string, unknown> }) =>
      rows.filter((row) =>
        Object.entries(opts?.where ?? {}).every(([key, expected]) =>
          expected && typeof expected === 'object' && '_value' in (expected as object)
            ? ((expected as { _value: unknown })._value as unknown[]).includes(row[key])
            : row[key] === expected,
        ),
      ),
    findOne: async (opts: { where: Record<string, unknown> }) =>
      rows.find((row) =>
        Object.entries(opts.where).every(([key, expected]) => row[key] === expected),
      ) ?? null,
  } as unknown as Repository<T>;
}

const merchantArb = fc.constantFrom('m-1', 'm-2', 'm-3');

const oppArb = fc.record({
  id: fc.uuid(),
  ownerMerchantId: merchantArb,
  intentLevel: fc.constantFrom('L1', 'L2', 'L3', 'L4', '未分级'),
  followupStatus: fc.constantFrom('待路由', '已触达', '跟进中', '路由失败'),
  createdAt: fc.date({
    min: new Date('2026-01-01'),
    max: new Date('2026-12-31'),
    noInvalidDate: true,
  }),
  lead: fc.constant({
    sourcePlatform: 'meta',
    rawData: {},
    qualityStatus: null,
    isValidLead: true,
    qualityFlags: null,
  }),
});

describe('商机清单/详情/导出 RBAC 数据隔离属性测试（任务 23.9）', () => {
  // Feature: multi-platform-ad-integration, 任务 23.9（RBAC 数据隔离，呼应 Property 49/50）
  it('商家清单/导出仅含本商家数据，详情越权恒返回权限不足（需求 21.17）', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(oppArb, { maxLength: 20 }), merchantArb, async (opps, mid) => {
        const service = new OpportunityDashboardService(
          makeRepo(opps as never) as never,
          makeRepo([]) as never,
          makeRepo([]) as never,
          makeRepo([]) as never,
          makeRepo([]) as never,
        );
        const actor: Actor = { id: 'u-1', role: 'merchant', merchantId: mid } as Actor;
        const items = await service.listOpportunities(actor, {});
        const ownIds = new Set(opps.filter((o) => o.ownerMerchantId === mid).map((o) => o.id));
        expect(new Set(items.map((i) => i.opportunityId))).toEqual(ownIds);

        const file = await service.exportOpportunities(actor, {}, 'csv');
        const lines = file.content.toString('utf-8').trim().split('\n');
        expect(lines).toHaveLength(1 + ownIds.size);

        for (const other of opps.filter((o) => o.ownerMerchantId !== mid)) {
          expect(await service.getOpportunityDetail(actor, other.id as string)).toEqual({
            error: '权限不足',
          });
        }
      }),
      { numRuns: 100 },
    );
  });
});
