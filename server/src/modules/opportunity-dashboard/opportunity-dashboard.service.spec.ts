import type { Repository } from 'typeorm';

import { OpportunityDashboardService } from './opportunity-dashboard.service';
import type { Actor } from '../rbac/domain/rbac';

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '_value' in (expected as object)) {
      const op = expected as { _type?: string; _value: unknown };
      if (op._type === 'in') {
        return (op._value as unknown[]).includes(row[key]);
      }
      return true;
    }
    return row[key] === expected;
  });
}

function makeRepo<T extends Record<string, unknown>>(rows: T[]): Repository<T> {
  return {
    find: async (opts?: { where?: Record<string, unknown> }) =>
      rows.filter((row) => matches(row, opts?.where ?? {})),
    findOne: async (opts: { where: Record<string, unknown> }) =>
      rows.find((row) => matches(row, opts.where)) ?? null,
  } as unknown as Repository<T>;
}

const merchantA: Actor = { id: 'u-a', role: 'merchant', merchantId: 'm-a' } as Actor;
const merchantB: Actor = { id: 'u-b', role: 'merchant', merchantId: 'm-b' } as Actor;

function opp(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'opp-1',
    ownerMerchantId: 'm-a',
    intentLevel: '未分级',
    followupStatus: '待路由',
    createdAt: new Date('2026-06-01T00:00:00Z'),
    lead: {
      sourcePlatform: 'meta',
      rawData: { companyName: '泰国公司', phone: '+66 1' },
      qualityStatus: '通过',
      isValidLead: true,
      qualityFlags: null,
    },
    ...partial,
  };
}

function setup(opts?: {
  opportunities?: Record<string, unknown>[];
  results?: Record<string, unknown>[];
  fields?: Record<string, unknown>[];
  levelChanges?: Record<string, unknown>[];
  followups?: Record<string, unknown>[];
}) {
  return new OpportunityDashboardService(
    makeRepo(opts?.opportunities ?? []) as never,
    makeRepo(opts?.results ?? []) as never,
    makeRepo(opts?.fields ?? []) as never,
    makeRepo(opts?.levelChanges ?? []) as never,
    makeRepo(opts?.followups ?? []) as never,
  );
}

describe('OpportunityDashboardService（任务 23.6-23.8，需求 21.13-21.17）', () => {
  it('商机清单：L4 优先排序 + 等级筛选（需求 21.13）', async () => {
    const service = setup({
      opportunities: [
        opp({ id: 'o1', intentLevel: 'L1' }),
        opp({ id: 'o2', intentLevel: 'L4' }),
        opp({ id: 'o3', intentLevel: 'L3' }),
      ],
    });
    const items = await service.listOpportunities(merchantA, {});
    expect(items.map((i) => i.opportunityId)).toEqual(['o2', 'o3', 'o1']);

    const onlyL4 = await service.listOpportunities(merchantA, { level: 'L4' });
    expect(onlyL4.map((i) => i.opportunityId)).toEqual(['o2']);
  });

  it('商机清单：RBAC 数据隔离，商家只能看到自己的商机（需求 21.17）', async () => {
    const service = setup({
      opportunities: [
        opp({ id: 'o1', ownerMerchantId: 'm-a' }),
        opp({ id: 'o2', ownerMerchantId: 'm-b' }),
      ],
    });
    const items = await service.listOpportunities(merchantA, {});
    expect(items.map((i) => i.opportunityId)).toEqual(['o1']);
  });

  it('单客户详情聚合：留资 + 背调补全 + 等级轨迹 + 跟进剧本（需求 21.15）', async () => {
    const service = setup({
      opportunities: [opp({ id: 'o1', intentLevel: 'L4', followupStatus: '已触达' })],
      results: [{ id: 'vr-1', opportunityId: 'o1', credibilityScore: '0.90' }],
      fields: [
        {
          verificationResultId: 'vr-1',
          field: 'companyName',
          originalValue: '泰国公司',
          verifiedValue: '泰国公司有限公司',
          conflict: true,
          needsReview: true,
        },
      ],
      levelChanges: [
        { opportunityId: 'o1', beforeLevel: null, afterLevel: 'L4', changedAt: new Date() },
      ],
      followups: [
        {
          opportunityId: 'o1',
          status: '已触达',
          playbook: { steps: ['首条消息'] },
          failureReason: null,
        },
      ],
    });
    const detail = await service.getOpportunityDetail(merchantA, 'o1');
    if ('error' in detail) {
      throw new Error('不应越权');
    }
    expect(detail.lead?.qualityStatus).toBe('通过');
    expect(detail.verifiedFields).toHaveLength(1);
    expect(detail.verifiedFields[0].conflict).toBe(true);
    expect(detail.levelHistory[0].afterLevel).toBe('L4');
    expect(detail.followups[0].playbook).toEqual({ steps: ['首条消息'] });
  });

  it('单客户详情：越权返回权限不足不泄露数据（需求 21.17）', async () => {
    const service = setup({ opportunities: [opp({ id: 'o1', ownerMerchantId: 'm-a' })] });
    expect(await service.getOpportunityDetail(merchantB, 'o1')).toEqual({ error: '权限不足' });
    expect(await service.getOpportunityDetail(merchantA, 'missing')).toEqual({
      error: '权限不足',
    });
  });

  it('导出 CSV：包含数据行且转义逗号（需求 21.14）', async () => {
    const service = setup({
      opportunities: [
        opp({
          id: 'o1',
          intentLevel: 'L4',
          lead: {
            sourcePlatform: 'meta',
            rawData: { companyName: 'A, B 公司', email: 'a@b.co' },
            qualityStatus: null,
            isValidLead: true,
            qualityFlags: null,
          },
        }),
      ],
    });
    const file = await service.exportOpportunities(merchantA, {}, 'csv');
    const text = file.content.toString('utf-8');
    expect(file.filename).toBe('opportunities.csv');
    expect(text).toContain('商机ID');
    expect(text).toContain('"A, B 公司"');
    expect(text.trim().split('\n')).toHaveLength(2);
  });

  it('导出空集生成仅含表头文件（需求 21.16）', async () => {
    const service = setup({ opportunities: [] });
    const csv = await service.exportOpportunities(merchantA, {}, 'csv');
    expect(csv.content.toString('utf-8').trim().split('\n')).toHaveLength(1);

    const excel = await service.exportOpportunities(merchantA, {}, 'excel');
    expect(excel.filename).toBe('opportunities.xlsx');
    expect(excel.content.length).toBeGreaterThan(0);
  });
});
