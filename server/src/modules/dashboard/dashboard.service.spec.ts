import type { Repository } from 'typeorm';

import { DashboardService } from './dashboard.service';
import type { Actor } from '../rbac/domain/rbac';

interface RepoStub<T> {
  rows: T[];
  failNext?: boolean;
}

function makeRepo<T extends { id?: string }>(stub: RepoStub<T>): Repository<T> {
  return {
    find: async () => {
      if (stub.failNext) {
        throw new Error('数据库不可用');
      }
      return stub.rows;
    },
    findOne: async () => stub.rows[0] ?? null,
  } as unknown as Repository<T>;
}

const admin: Actor = { id: 'u-1', role: 'administrator' } as Actor;

function setup(opts?: {
  metrics?: unknown[];
  opportunities?: unknown[];
  metricsFail?: boolean;
  oppsFail?: boolean;
  geminiAvailable?: boolean;
  geminiText?: string;
}) {
  const metricStub = { rows: opts?.metrics ?? [], failNext: opts?.metricsFail };
  const oppStub = { rows: opts?.opportunities ?? [], failNext: opts?.oppsFail };
  const credentials = {
    isGeminiAvailable: async () => opts?.geminiAvailable ?? false,
    useDecrypted: async (_p: string, _k: string, fn: (key: string) => Promise<string>) =>
      opts?.geminiText !== undefined ? opts.geminiText : fn('key'),
  };
  const service = new DashboardService(
    makeRepo(metricStub as never),
    makeRepo(oppStub as never),
    credentials as never,
  );
  return { service, metricStub, oppStub };
}

function opp(partial: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'opp-1',
    intentLevel: '未分级',
    isQualified: true,
    followupStatus: '待路由',
    createdAt: new Date('2026-06-01T00:00:00Z'),
    lead: { sourcePlatform: 'meta', rawData: {} },
    ...partial,
  };
}

const range = { start: new Date('2026-06-01T00:00:00Z'), end: new Date('2026-06-07T00:00:00Z') };

describe('DashboardService（任务 23.1/23.5：效果看板与行业调查报告）', () => {
  it('结束早于开始返回时间范围无效（需求 21.2）', async () => {
    const { service } = setup();
    const result = await service.load(admin, { start: range.end, end: range.start });
    expect(result).toEqual({ error: '时间范围无效' });
  });

  it('未传范围默认最近 7 天（需求 21.2）', async () => {
    const { service } = setup();
    const result = await service.load(admin, null);
    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      const spanDays =
        (result.range.end.getTime() - result.range.start.getTime()) / (24 * 3_600_000);
      expect(spanDays).toBe(7);
    }
  });

  it('聚合看板：消耗/询盘成本/联络率/意向分布（需求 21.1、21.5-21.7）', async () => {
    const { service } = setup({
      metrics: [{ spend: '100.00' }, { spend: '50.00' }],
      opportunities: [
        opp({ id: 'o1', intentLevel: 'L4', followupStatus: '已触达' }),
        opp({ id: 'o2', intentLevel: 'L3' }),
        opp({ id: 'o3', intentLevel: 'L1', isQualified: false }),
      ],
    });
    const result = await service.load(admin, range);
    if ('error' in result) {
      throw new Error('不应返回错误');
    }
    expect(result.spend).toEqual({ kind: 'value', value: 150 });
    expect(result.costPerQualifiedLead).toEqual({ kind: 'value', value: 75 });
    expect(result.effectiveContactRate).toEqual({ kind: 'value', value: 1 / 3 });
    if (result.intentLevelDistribution.kind !== 'value') {
      throw new Error('意向分布应可计算');
    }
    expect(result.intentLevelDistribution.value.highIntentShare).toBeCloseTo(2 / 3, 10);
    expect(result.opportunityCount).toEqual({ kind: 'value', value: 3 });
  });

  it('缺失维度互相隔离：指标维度失败仅消耗类指标不可用（需求 21.4）', async () => {
    const { service } = setup({
      metricsFail: true,
      opportunities: [opp({ id: 'o1', intentLevel: 'L4' })],
    });
    const result = await service.load(admin, range);
    if ('error' in result) {
      throw new Error('不应返回错误');
    }
    expect(result.spend.kind).toBe('unavailable');
    expect(result.costPerQualifiedLead.kind).toBe('unavailable');
    expect(result.opportunityCount).toEqual({ kind: 'value', value: 1 });
    expect(result.intentLevelDistribution.kind).toBe('value');
  });

  it('行业调查报告：Gemini 凭据缺失时 AI 洞察标数据不可用，导出不中断（需求 21.12）', async () => {
    const { service } = setup({
      opportunities: [
        opp({ id: 'o1', lead: { sourcePlatform: 'meta', rawData: { industry: '制造业' } } }),
      ],
      geminiAvailable: false,
    });
    const report = await service.exportIndustrySurvey(admin, range);
    if ('error' in report) {
      throw new Error('不应返回错误');
    }
    expect(report.industryDistribution).toEqual({ kind: 'value', value: { 制造业: 1 } });
    expect(report.aiInsight).toEqual({ kind: 'unavailable', note: '数据不可用' });
  });

  it('行业调查报告：维度缺失标数据不可用（需求 21.12）', async () => {
    const { service } = setup({ oppsFail: true, geminiAvailable: true });
    const report = await service.exportIndustrySurvey(admin, range);
    if ('error' in report) {
      throw new Error('不应返回错误');
    }
    expect(report.industryDistribution.kind).toBe('unavailable');
    expect(report.aiInsight.kind).toBe('unavailable');
  });

  it('行业调查报告：Gemini 可用时生成 AI 洞察（需求 21.11）', async () => {
    const { service } = setup({
      opportunities: [
        opp({ id: 'o1', lead: { sourcePlatform: 'meta', rawData: { industry: '制造业' } } }),
      ],
      geminiAvailable: true,
      geminiText: '制造业线索占比最高。',
    });
    const report = await service.exportIndustrySurvey(admin, range);
    if ('error' in report) {
      throw new Error('不应返回错误');
    }
    expect(report.aiInsight).toEqual({ kind: 'value', value: '制造业线索占比最高。' });
  });
});
