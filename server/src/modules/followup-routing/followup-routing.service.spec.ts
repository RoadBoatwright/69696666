import type { Repository } from 'typeorm';

import type { Actor } from '../rbac/domain/rbac';
import { Opportunity } from '../opportunity-scoring/entities/opportunity.entity';
import { BuyerReplyEvent } from './entities/buyer-reply-event.entity';
import { FollowupRecord } from './entities/followup-record.entity';
import {
  FollowUpRoutingService,
  RoutingForbiddenError,
  RoutingOpportunityNotFoundError,
} from './followup-routing.service';
import type { FollowUpChannelGateway } from './ports/channel-gateway';
import type { FollowUpChannel } from './domain/followup-routing';

/** 通用内存仓储桩。 */
function makeRepo<T extends object>(
  prefix: string,
): { repo: Repository<T>; store: Map<string, T> } {
  const store = new Map<string, T>();
  let seq = 0;
  const matches = (v: T, where: Partial<T>): boolean =>
    Object.entries(where).every(([k, val]) => (v as Record<string, unknown>)[k] === val);
  const repo = {
    create: (e: Partial<T>) => ({ ...e }) as T,
    save: async (e: T) => {
      const rec = e as Record<string, unknown>;
      if (!rec.id) rec.id = `${prefix}-${++seq}`;
      store.set(rec.id as string, { ...e });
      return store.get(rec.id as string)!;
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

const MERCHANT: Actor = { id: 'u1', role: 'merchant', merchantId: 'm1' };

function setup(
  opts: {
    configured?: FollowUpChannel[];
    routeError?: string;
  } = {},
) {
  const record = makeRepo<FollowupRecord>('rec');
  const reply = makeRepo<BuyerReplyEvent>('rep');
  const opp = makeRepo<Opportunity>('opp');
  const routed: FollowUpChannel[] = [];
  const gateway: FollowUpChannelGateway = {
    isConfigured: (c) => (opts.configured ?? []).includes(c),
    route: async (c) => {
      if (opts.routeError) throw new Error(opts.routeError);
      routed.push(c);
    },
  };
  const service = new FollowUpRoutingService(record.repo, reply.repo, opp.repo, gateway);
  return { service, record, reply, opp, routed };
}

async function seed(
  opp: { repo: Repository<Opportunity> },
  overrides: Partial<Opportunity> = {},
): Promise<Opportunity> {
  return opp.repo.save(
    opp.repo.create({
      leadId: `lead-${Math.random()}`,
      ownerMerchantId: 'm1',
      intentLevel: 'L4',
      followupStatus: '待路由',
      ...overrides,
    } as Partial<Opportunity>),
  );
}

describe('FollowUpRoutingService（组件 11，需求 17、21.6）', () => {
  it('达阈值且 WhatsApp 配置自动路由置已触达并生成剧本（需求 17.3、17.5）', async () => {
    const { service, opp, routed } = setup({ configured: ['whatsapp'] });
    const o = await seed(opp);
    const r = await service.autoRoute(o, 'L3', { phone: '+66 2 123' });
    expect(routed).toEqual(['whatsapp']);
    expect(r).toMatchObject({ status: '已触达', channels: ['whatsapp'] });
    expect((r as FollowupRecord).playbook).toMatchObject({
      cadence: expect.stringContaining('24 小时'),
    });
    expect((await opp.repo.findOne({ where: { id: o.id } }))!.followupStatus).toBe('已触达');
  });

  it('等级未达阈值不路由（需求 17.2）', async () => {
    const { service, opp, routed } = setup({ configured: ['whatsapp'] });
    const o = await seed(opp, { intentLevel: 'L2' });
    const r = await service.autoRoute(o, 'L3');
    expect(r).toEqual({ kind: 'below_threshold' });
    expect(routed).toEqual([]);
  });

  it('通道均未配置保持待路由不丢商机（需求 17.6）', async () => {
    const { service, opp } = setup({ configured: [] });
    const o = await seed(opp);
    const r = await service.autoRoute(o, 'L3');
    expect(r).toEqual({ kind: 'channel_unconfigured', channels: ['whatsapp', 'crm'] });
    const stored = await opp.repo.findOne({ where: { id: o.id } });
    expect(stored).not.toBeNull();
    expect(stored!.followupStatus).toBe('待路由');
  });

  it('路由失败置路由失败并记录原因待重试（需求 17.7）', async () => {
    const { service, opp, record } = setup({ configured: ['whatsapp'], routeError: 'HTTP 500' });
    const o = await seed(opp);
    const r = await service.autoRoute(o, 'L3');
    expect(r).toMatchObject({ status: '路由失败', failureReason: 'HTTP 500' });
    expect((await opp.repo.findOne({ where: { id: o.id } }))!.followupStatus).toBe('路由失败');
    expect(record.store.size).toBe(1);
  });

  it('manualRoute 越权抛权限不足（需求 7.4、17.4）', async () => {
    const { service, opp } = setup({ configured: ['crm'] });
    const o = await seed(opp, { ownerMerchantId: 'other' });
    await expect(service.manualRoute(MERCHANT, o.id, ['crm'])).rejects.toBeInstanceOf(
      RoutingForbiddenError,
    );
  });

  it('manualRoute 商机不存在抛错', async () => {
    const { service } = setup({ configured: ['crm'] });
    await expect(service.manualRoute(MERCHANT, 'nope', ['crm'])).rejects.toBeInstanceOf(
      RoutingOpportunityNotFoundError,
    );
  });

  it('manualRoute 经已配置通道路由成功（需求 17.4）', async () => {
    const { service, opp, routed } = setup({ configured: ['crm'] });
    const o = await seed(opp);
    const r = await service.manualRoute(MERCHANT, o.id, ['crm']);
    expect(routed).toEqual(['crm']);
    expect(r).toMatchObject({ status: '已触达', channels: ['crm'] });
  });

  it('recordBuyerReply 记录回复并推进为跟进中（需求 21.6）', async () => {
    const { service, opp, reply } = setup({ configured: ['whatsapp'] });
    const o = await seed(opp, { followupStatus: '已触达' });
    const at = new Date('2024-02-01T08:00:00Z');
    const e = await service.recordBuyerReply(o.id, 'whatsapp', at);
    expect(e).toMatchObject({ opportunityId: o.id, channel: 'whatsapp', repliedAt: at });
    expect(reply.store.size).toBe(1);
    expect((await opp.repo.findOne({ where: { id: o.id } }))!.followupStatus).toBe('跟进中');
  });
});
