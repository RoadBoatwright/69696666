import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Ad } from '../../campaign/entities/ad.entity';
import { AdGroup } from '../../campaign/entities/ad-group.entity';
import { Metric } from '../../metrics/entities/metric.entity';
import { Opportunity } from '../../opportunity-scoring/entities/opportunity.entity';
import type { AudienceSegmentStat, OptimizationSnapshot } from '../domain/ai-campaign';
import type { OptimizationDataProvider } from './index';

/** 视为「有效高意向商机」的意向等级阈值（需求 9.15、16）。 */
const HIGH_INTENT_LEVELS = new Set(['L3', 'L4']);

/**
 * 默认优化数据来源（组件 5 端口实现，需求 9.9、9.12、9.15）。
 *
 * 聚合数据回传服务落库的广告指标（曝光/点击/转化/花费/ROI）与商机回流统计（含有效高意向
 * 商机数）为优化分析快照。指标缺失时 `hasMetrics=false`，由服务侧据此提示数据不可用
 * （需求 9.12）。受众/版位组合统计以来源广告计划为粒度聚合（需求 9.15、9.16）。
 *
 * 真实服务原则：本提供者读取由真实平台官方 API（MCP 优先/Marketing/Ads API）回传并归一化
 * 落库的指标，不构造假数据；无落库指标即视为数据不可用（需求 9.12）。
 */
@Injectable()
export class DefaultOptimizationDataProvider implements OptimizationDataProvider {
  constructor(
    @InjectRepository(Metric)
    private readonly metricRepo: Repository<Metric>,
    @InjectRepository(Ad)
    private readonly adRepo: Repository<Ad>,
    @InjectRepository(AdGroup)
    private readonly adGroupRepo: Repository<AdGroup>,
    @InjectRepository(Opportunity)
    private readonly opportunityRepo: Repository<Opportunity>,
  ) {}

  async loadSnapshot(campaignId: string): Promise<OptimizationSnapshot> {
    const adIds = await this.resolveAdIds(campaignId);
    const metrics = adIds.length > 0 ? await this.loadMetrics(adIds) : [];

    const hasMetrics = metrics.length > 0;
    let impressions = 0;
    let clicks = 0;
    let conversions = 0;
    let spend = 0;
    let conversionValue = 0;
    for (const m of metrics) {
      impressions += Number(m.impressions ?? 0);
      clicks += Number(m.clicks ?? 0);
      conversions += Number(m.conversions ?? 0);
      spend += Number(m.spend ?? 0);
      conversionValue += Number(m.conversionValue ?? 0);
    }
    const roi = spend > 0 ? (conversionValue - spend) / spend : null;

    const { segments, totalHighIntent } = await this.loadSegments(campaignId);

    return {
      campaignId,
      hasMetrics,
      impressions,
      clicks,
      conversions,
      spend,
      roi,
      segments,
      totalHighIntentOpportunities: totalHighIntent,
    };
  }

  /** 解析广告计划下全部广告标识（用于聚合指标）。 */
  private async resolveAdIds(campaignId: string): Promise<string[]> {
    const adGroups = await this.adGroupRepo.find({ where: { campaignId } });
    const adIds: string[] = [];
    for (const ag of adGroups) {
      const ads = await this.adRepo.find({ where: { adGroupId: ag.id } });
      adIds.push(...ads.map((a) => a.id));
    }
    return adIds;
  }

  /** 加载广告标识集合对应的全部指标行。 */
  private async loadMetrics(adIds: string[]): Promise<Metric[]> {
    const rows: Metric[] = [];
    for (const adId of adIds) {
      rows.push(...(await this.metricRepo.find({ where: { adId } })));
    }
    return rows;
  }

  /**
   * 聚合受众/版位组合的回流统计（需求 9.15、9.16）。
   *
   * 以广告组为受众/版位组合粒度，统计来源于该计划的商机总数与有效高意向商机数。
   * 当前实现以广告计划为单位聚合一个组合（更细粒度需待版位字段回流补齐）。
   */
  private async loadSegments(
    campaignId: string,
  ): Promise<{ segments: AudienceSegmentStat[]; totalHighIntent: number }> {
    const opportunities = await this.opportunityRepo.find({
      where: { sourceCampaignId: campaignId },
    });

    let total = 0;
    let highIntent = 0;
    for (const opp of opportunities) {
      if (!opp.isQualified) {
        continue;
      }
      total += 1;
      if (HIGH_INTENT_LEVELS.has(opp.intentLevel)) {
        highIntent += 1;
      }
    }

    const segments: AudienceSegmentStat[] =
      total > 0
        ? [
            {
              segmentId: campaignId,
              currentDailyBudget: 0,
              currentBid: 0,
              totalOpportunities: total,
              highIntentOpportunities: highIntent,
            },
          ]
        : [];

    return { segments, totalHighIntent: highIntent };
  }
}
