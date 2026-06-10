import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import { geminiChatCompletion } from '../../common/llm/gemini-chat';
import { CredentialManagerService } from '../credential/credential-manager.service';
import { Metric } from '../metrics/entities';
import { Opportunity } from '../opportunity-scoring/entities/opportunity.entity';
import type { Actor } from '../rbac/domain/rbac';
import type { PlatformId } from '../unified-model/domain/unified-model';
import type { Dashboard, IndustrySurveyReport, MetricValue, TimeRange } from './domain/dashboard';
import {
  costPerQualifiedLead,
  defaultRange,
  effectiveContactRate,
  intentLevelDistribution,
  validateRange,
} from './pure';

const UNAVAILABLE = { kind: 'unavailable', note: '数据不可用' } as const;

/**
 * 效果看板服务（组件 14，任务 23.1/23.2/23.5，需求 21.1-21.12）。
 *
 * - `load`：按平台/时间范围聚合看板；范围非法返回 `{ error: '时间范围无效' }`，
 *   未传范围默认最近 7 天；各维度独立取数，任一维度数据缺失只影响该维度
 *   （标「数据不可用」），不拖垮整张看板（需求 21.4）。
 * - `exportIndustrySurvey`：客户行业调查报告；行业维度缺失或 Gemini 凭据
 *   缺失时对应部分标「数据不可用」，导出不中断（需求 21.11、21.12）。
 *
 * 真实服务原则：AI 洞察经凭据管理器调用真实 Gemini 中转，凭据缺失即降级。
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectRepository(Metric)
    private readonly metricRepo: Repository<Metric>,
    @InjectRepository(Opportunity)
    private readonly opportunityRepo: Repository<Opportunity>,
    private readonly credentials: CredentialManagerService,
  ) {}

  /** 聚合看板（需求 21.1-21.4）。 */
  async load(
    actor: Actor,
    range?: TimeRange | null,
    platform?: PlatformId,
  ): Promise<Dashboard | { error: '时间范围无效' }> {
    const effective = range ?? defaultRange(new Date());
    if (!validateRange(effective)) {
      return { error: '时间范围无效' };
    }

    const spend = await this.isolate('投放消耗', () => this.sumSpend(effective, platform));
    const opportunities = await this.isolate('商机', () =>
      this.loadOpportunities(actor, effective, platform),
    );

    const opportunityCount: MetricValue<number> =
      opportunities.kind === 'value'
        ? { kind: 'value', value: opportunities.value.length }
        : opportunities;

    const cost: MetricValue<number> =
      spend.kind === 'value' && opportunities.kind === 'value'
        ? costPerQualifiedLead({
            spend: spend.value,
            qualifiedLeadCount: opportunities.value.filter((o) => o.isQualified).length,
          })
        : UNAVAILABLE;

    const contactRate: MetricValue<number> =
      opportunities.kind === 'value'
        ? effectiveContactRate({
            contactedCount: opportunities.value.filter((o) => o.followupStatus === '已触达').length,
            totalCount: opportunities.value.length,
          })
        : UNAVAILABLE;

    const distribution =
      opportunities.kind === 'value'
        ? intentLevelDistribution({ levelCounts: this.countLevels(opportunities.value) })
        : UNAVAILABLE;

    return {
      range: effective,
      platform,
      spend,
      costPerQualifiedLead: cost,
      effectiveContactRate: contactRate,
      intentLevelDistribution: distribution,
      opportunityCount,
    };
  }

  /** 客户行业调查报告导出（需求 21.11、21.12）。 */
  async exportIndustrySurvey(
    actor: Actor,
    range: TimeRange,
  ): Promise<IndustrySurveyReport | { error: '时间范围无效' }> {
    if (!validateRange(range)) {
      return { error: '时间范围无效' };
    }

    const industryDistribution = await this.isolate('行业分布', async () => {
      const opportunities = await this.loadOpportunities(actor, range);
      const byIndustry: Record<string, number> = {};
      for (const opp of opportunities) {
        const industry = this.extractIndustry(opp) ?? '未知行业';
        byIndustry[industry] = (byIndustry[industry] ?? 0) + 1;
      }
      return byIndustry;
    });

    let aiInsight: MetricValue<string> = UNAVAILABLE;
    if ((await this.credentials.isGeminiAvailable()) && industryDistribution.kind === 'value') {
      try {
        const text = await this.credentials.useDecrypted('gemini', 'apiKey', (apiKey) =>
          geminiChatCompletion(
            apiKey,
            `请基于以下行业分布数据生成简短的客户行业调查洞察（中文）：${JSON.stringify(
              industryDistribution.value,
            )}`,
          ),
        );
        aiInsight = { kind: 'value', value: text };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`行业调查 AI 洞察生成失败，标「数据不可用」：${message}`);
      }
    }

    return { range, industryDistribution, aiInsight, generatedAt: new Date() };
  }

  /** 维度隔离：单维度取数失败仅该维度标「数据不可用」（需求 21.4）。 */
  private async isolate<T>(
    dimension: string,
    fn: () => Promise<T>,
  ): Promise<MetricValue<T> & { kind: 'value' | 'unavailable' }> {
    try {
      return { kind: 'value', value: await fn() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`看板维度「${dimension}」数据缺失已隔离：${message}`);
      return { ...UNAVAILABLE };
    }
  }

  private async sumSpend(range: TimeRange, platform?: PlatformId): Promise<number> {
    const where: Record<string, unknown> = { pulledAt: Between(range.start, range.end) };
    if (platform) {
      where.platform = platform;
    }
    const rows = await this.metricRepo.find({ where });
    return rows.reduce((sum, row) => sum + Number(row.spend), 0);
  }

  private async loadOpportunities(
    actor: Actor,
    range: TimeRange,
    platform?: PlatformId,
  ): Promise<Opportunity[]> {
    const where: Record<string, unknown> = { createdAt: Between(range.start, range.end) };
    if (actor.role === 'merchant') {
      where.ownerMerchantId = actor.merchantId;
    }
    const rows = await this.opportunityRepo.find({ where, relations: { lead: true } });
    if (!platform) {
      return rows;
    }
    return rows.filter((row) => row.lead?.sourcePlatform === platform);
  }

  private countLevels(opportunities: Opportunity[]): Record<'L1' | 'L2' | 'L3' | 'L4', number> {
    const counts = { L1: 0, L2: 0, L3: 0, L4: 0 };
    for (const opp of opportunities) {
      if (opp.intentLevel !== '未分级') {
        counts[opp.intentLevel] += 1;
      }
    }
    return counts;
  }

  private extractIndustry(opp: Opportunity): string | null {
    const raw = opp.lead?.rawData;
    if (raw && typeof raw === 'object' && 'industry' in raw) {
      const industry = (raw as Record<string, unknown>).industry;
      return typeof industry === 'string' && industry.trim() !== '' ? industry : null;
    }
    return null;
  }
}
