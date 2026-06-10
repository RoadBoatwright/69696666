import * as fc from 'fast-check';

import {
  costPerQualifiedLead,
  effectiveContactRate,
  intentLevelDistribution,
  leadAssetOwnership,
  timeToFirstOpportunity,
  validateRange,
} from './pure';
import type { Actor } from '../rbac/domain/rbac';

const finiteNonNegative = fc.double({ min: 0, max: 1e12, noNaN: true, noDefaultInfinity: true });

describe('看板纯函数属性测试（任务 23，需求 21）', () => {
  // Feature: multi-platform-ad-integration, Property 43
  it('Property 43: 时间范围有效性 —— 结束早于开始恒无效，跨度 ≤365 天且顺序正确恒有效', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2000-01-01'), max: new Date('2100-01-01'), noInvalidDate: true }),
        fc.integer({ min: 1, max: 365 * 24 * 3_600_000 }),
        (start, spanMs) => {
          expect(validateRange({ start, end: new Date(start.getTime() + spanMs) })).toBe(true);
          expect(validateRange({ start: new Date(start.getTime() + spanMs), end: start })).toBe(
            false,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 44
  it('Property 44: 询盘成本 —— 有效线索数为零或缺失恒不可计算，否则等于 spend/count', () => {
    fc.assert(
      fc.property(finiteNonNegative, fc.integer({ min: 0, max: 100_000 }), (spend, count) => {
        const result = costPerQualifiedLead({ spend, qualifiedLeadCount: count });
        if (count === 0) {
          expect(result).toEqual({ kind: 'incomputable', note: '不可计算' });
        } else {
          expect(result).toEqual({ kind: 'value', value: spend / count });
        }
        expect(costPerQualifiedLead({ spend: null, qualifiedLeadCount: count }).kind).toBe(
          'incomputable',
        );
        expect(costPerQualifiedLead({ spend, qualifiedLeadCount: null }).kind).toBe('incomputable');
      }),
      { numRuns: 100 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 45
  it('Property 45: 联络率 —— 总数为零恒不可计算，否则结果在 [0,1]（contacted ≤ total 时）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (contacted, extra) => {
          const total = contacted + extra;
          const result = effectiveContactRate({ contactedCount: contacted, totalCount: total });
          if (total === 0) {
            expect(result).toEqual({ kind: 'incomputable', note: '不可计算' });
          } else if (result.kind === 'value') {
            expect(result.value).toBeGreaterThanOrEqual(0);
            expect(result.value).toBeLessThanOrEqual(1);
          } else {
            throw new Error('total>0 时应可计算');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 46
  it('Property 46: 意向分布 —— 已分级>0 时各级占比和为 1 且高意向占比 = L3+L4 占比；全零恒不可计算', () => {
    fc.assert(
      fc.property(
        fc.record({
          L1: fc.integer({ min: 0, max: 10_000 }),
          L2: fc.integer({ min: 0, max: 10_000 }),
          L3: fc.integer({ min: 0, max: 10_000 }),
          L4: fc.integer({ min: 0, max: 10_000 }),
        }),
        (levelCounts) => {
          const total = levelCounts.L1 + levelCounts.L2 + levelCounts.L3 + levelCounts.L4;
          const result = intentLevelDistribution({ levelCounts });
          if (total === 0) {
            expect(result).toEqual({ kind: 'incomputable', note: '不可计算' });
            return;
          }
          if (result.kind !== 'value') {
            throw new Error('已分级>0 时应可计算');
          }
          const { shares, highIntentShare } = result.value;
          expect(shares.L1 + shares.L2 + shares.L3 + shares.L4).toBeCloseTo(1, 9);
          expect(highIntentShare).toBeCloseTo(shares.L3 + shares.L4, 12);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 47
  it('Property 47: 投放时长 —— 尚无商机恒返回「暂无商机」；有商机且时间齐全恒返回非负秒数', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2000-01-01'), max: new Date('2100-01-01'), noInvalidDate: true }),
        fc.integer({ min: 0, max: 365 * 24 * 3_600_000 }),
        (publishedAt, deltaMs) => {
          expect(
            timeToFirstOpportunity({
              firstPublishedAt: publishedAt,
              firstOpportunityAt: null,
              hasOpportunity: false,
            }),
          ).toEqual({ kind: 'noOpportunity', note: '暂无商机' });
          const result = timeToFirstOpportunity({
            firstPublishedAt: publishedAt,
            firstOpportunityAt: new Date(publishedAt.getTime() + deltaMs),
            hasOpportunity: true,
          });
          expect(result).toEqual({ kind: 'duration', seconds: deltaMs / 1_000 });
          expect(
            timeToFirstOpportunity({
              firstPublishedAt: null,
              firstOpportunityAt: new Date(),
              hasOpportunity: true,
            }),
          ).toEqual({ kind: 'unavailable', note: '数据不可用' });
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 48
  it('Property 48: 客户资产停投/重启不丢失 —— 归属商家恒可访问且沉淀标记保持，非归属商家恒不可访问', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), fc.boolean(), (merchantA, merchantB, settled) => {
        fc.pre(merchantA !== merchantB);
        const owner: Actor = { id: 'u-1', role: 'merchant', merchantId: merchantA } as Actor;
        const other: Actor = { id: 'u-2', role: 'merchant', merchantId: merchantB } as Actor;
        const admin: Actor = { id: 'u-3', role: 'administrator' } as Actor;
        const opp = { merchantId: merchantA, privateDomainSettled: settled };
        expect(leadAssetOwnership(owner, opp)).toEqual({ accessible: true, settled });
        expect(leadAssetOwnership(other, opp).accessible).toBe(false);
        expect(leadAssetOwnership(admin, opp).accessible).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
