import type { Repository } from 'typeorm';

import type { Actor } from '../rbac/domain/rbac';
import { LevelChangeRecord } from './entities/level-change-record.entity';
import { Opportunity } from './entities/opportunity.entity';
import {
  OpportunityScoringService,
  ScoringOpportunityNotFoundError,
} from './opportunity-scoring.service';
import type { ScoringInput } from './domain/opportunity-scoring';

/** 通用内存仓储桩（支持 In 操作符简化匹配）。 */
function makeRepo<T extends object>(
  prefix: string,
): { repo: Repository<T>; store: Map<string, T> } {
  const store = new Map<string, T>();
  let seq = 0;
  const matchValue = (actual: unknown, expected: unknown): boolean => {
    if (
      expected !== null &&
      typeof expected === 'object' &&
      '_value' in (expected as Record<string, unknown>)
    ) {
      return ((expected as { _value: unknown[] })._value ?? []).includes(actual);
    }
    return actual === expected;
  };
  const matches = (v: T, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, val]) => matchValue((v as Record<string, unknown>)[k], val));
  const repo = {
    create: (e: Partial<T>) => ({ ...e }) as T,
    save: async (e: T) => {
      const rec = e as Record<string, unknown>;
      if (!rec.id) rec.id = `${prefix}-${++seq}`;
      store.set(rec.id as string, { ...e });
      return store.get(rec.id as string)!;
    },
    findOne: async ({ where }: { where: Record<string, unknown> }) => {
      for (const v of store.values()) {
        if (matches(v, where)) return { ...v };
      }
      return null;
    },
    find: async ({ where }: { where?: Record<string, unknown> } = {}) => {
      const out: T[] = [];
      for (const v of store.values()) {
        if (!where || matches(v, where)) out.push({ ...v });
      }
      return out;
    },
  } as unknown as Repository<T>;
  return { repo, store };
}

const FULL_INPUT: ScoringInput = {
  verification: { credibilityScore: 90 },
  personaMatch: 0.9,
  behavior: { formCompleted: true, repliedToContact: true, engagementScore: 80 },
};

const MERCHANT: Actor = { id: 'u1', role: 'merchant', merchantId: 'm1' };

function setup() {
  const opp = makeRepo<Opportunity>('opp');
  const change = makeRepo<LevelChangeRecord>('chg');
  const service = new OpportunityScoringService(opp.repo, change.repo);
  return { service, opp, change };
}

async function seed(
  opp: { repo: Repository<Opportunity> },
  overrides: Partial<Opportunity> = {},
): Promise<Opportunity> {
  return opp.repo.save(
    opp.repo.create({
      leadId: `lead-${Math.random()}`,
      ownerMerchantId: 'm1',
      intentLevel: '未分级',
      ...overrides,
    } as Partial<Opportunity>),
  );
}

describe('OpportunityScoringService（组件 10，需求 16）', () => {
  it('商机不存在抛 ScoringOpportunityNotFoundError', async () => {
    const { service } = setup();
    await expect(service.recompute('nope', FULL_INPUT)).rejects.toBeInstanceOf(
      ScoringOpportunityNotFoundError,
    );
  });

  it('完整输入输出唯一等级并覆盖（需求 16.1、16.2、16.5）', async () => {
    const { service, opp } = setup();
    const o = await seed(opp);
    const r = await service.recompute(o.id, FULL_INPUT);
    expect(r.opportunity.intentLevel).toBe('L4');
    expect(r.opportunity.missingInputs).toBeNull();
    expect(r.changeRecord).toMatchObject({ beforeLevel: '未分级', afterLevel: 'L4' });
  });

  it('缺必需输入置未分级并记缺失项（需求 16.3）', async () => {
    const { service, opp } = setup();
    const o = await seed(opp, { intentLevel: 'L2' });
    const r = await service.recompute(o.id, { personaMatch: 0.5 });
    expect(r.opportunity.intentLevel).toBe('未分级');
    expect(r.opportunity.missingInputs).toEqual(['背调结果', '行为数据']);
  });

  it('等级未变化时不重复记录变更（幂等，需求 16.6）', async () => {
    const { service, opp, change } = setup();
    const o = await seed(opp);
    await service.recompute(o.id, FULL_INPUT);
    const second = await service.recompute(o.id, FULL_INPUT);
    expect(second.changeRecord).toBeNull();
    expect(change.store.size).toBe(1);
  });

  it('变更轨迹按时间正序返回（需求 16.6）', async () => {
    const { service, opp } = setup();
    const o = await seed(opp);
    await service.recompute(o.id, FULL_INPUT);
    await service.recompute(o.id, {
      ...FULL_INPUT,
      verification: { credibilityScore: 10 },
      personaMatch: 0.1,
      behavior: { formCompleted: false, repliedToContact: false, engagementScore: 0 },
    });
    const records = await service.listChangeRecords(o.id);
    expect(records.map((r) => [r.beforeLevel, r.afterLevel])).toEqual([
      ['未分级', 'L4'],
      ['L4', 'L1'],
    ]);
  });

  it('listByLevel 按 L4 优先排序且经 RBAC 隔离（需求 16.4、7.3）', async () => {
    const { service, opp } = setup();
    await seed(opp, { intentLevel: 'L1' });
    await seed(opp, { intentLevel: 'L4' });
    await seed(opp, { intentLevel: 'L2' });
    await seed(opp, { intentLevel: 'L4', ownerMerchantId: 'other' });
    const list = await service.listByLevel(MERCHANT);
    expect(list.map((o) => o.intentLevel)).toEqual(['L4', 'L2', 'L1']);
    expect(list.every((o) => o.ownerMerchantId === 'm1')).toBe(true);
  });

  it('未认证返回空集无数据泄露（需求 7.5）', async () => {
    const { service, opp } = setup();
    await seed(opp, { intentLevel: 'L4' });
    expect(await service.listByLevel(null)).toEqual([]);
  });
});
