import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CredentialNotConfiguredError } from '../../common/errors/credential.error';
import { PlatformAdapterRegistry } from '../platform-adapter';
import type { PlatformId } from '../platform-adapter/domain/platform-adapter';
import {
  ConversionConfig,
  ConversionEvent,
  Metric,
  ReviewStatus,
  type ConversionMechanism,
} from './entities';
import {
  computeRoi,
  matchConversionEvent,
  normalizeMetricRow,
  normalizeReviewStatus,
  validateEventDefs,
} from './pure';
import type {
  ConversionEventInput,
  MetricsPullSummary,
  MetricsPullTarget,
  ReviewStatusChange,
  ReviewSyncResult,
} from './domain/metrics';

/** 转化追踪配置非法错误（需求 19.1）。 */
export class InvalidConversionConfigError extends Error {
  constructor(public readonly errors: string[]) {
    super('转化追踪配置非法');
    this.name = 'InvalidConversionConfigError';
  }
}

/**
 * 数据回传服务与审核同步（组件 12、13，需求 18、19、20）。
 *
 * 职责：
 *  - 指标拉取/归一化：经平台适配器 `fetchMetrics` 拉取曝光/点击/转化/花费并按统一口径
 *    归一化入库；ROI 花费为零标「不可计算」（需求 18.1-18.3）。
 *  - 单平台失败隔离：某平台拉取失败仅记录原因、保留该平台上次成功数据，其余平台照常
 *    继续（需求 18.7，Property 33）。
 *  - 转化追踪：配置（Pixel|Event|EventsAPI，事件定义 ≤50）经适配器提交真实平台 API，
 *    成功「已生效」/失败「提交失败」（需求 19.1-19.4）；转化事件回流按广告关联，能关联
 *    标「matched」、无法匹配保留原始数据标「unmatched」待配（需求 19.5、19.6）。
 *  - 审核状态同步：经适配器 `fetchReviewStatus` 拉取并归一化为三态「审核中|审核通过|
 *    审核被拒绝」，状态变更产生通知记录，拉取失败保留上次状态（需求 20.1-20.5）。
 *
 * 真实服务原则：全部经平台适配器调用真实官方 API；凭据未配置按降级处理，不以假数据顶替。
 */
@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);

  constructor(
    @InjectRepository(Metric)
    private readonly metricRepo: Repository<Metric>,
    @InjectRepository(ConversionConfig)
    private readonly conversionConfigRepo: Repository<ConversionConfig>,
    @InjectRepository(ConversionEvent)
    private readonly conversionEventRepo: Repository<ConversionEvent>,
    @InjectRepository(ReviewStatus)
    private readonly reviewStatusRepo: Repository<ReviewStatus>,
    private readonly adapters: PlatformAdapterRegistry,
  ) {}

  // ---------------------------------------------------------------------------
  // 18.x 指标拉取/归一化/ROI/单平台失败隔离
  // ---------------------------------------------------------------------------

  /**
   * 拉取并归一化各平台指标（需求 18.1-18.3、18.7）。
   *
   * 按账户逐平台经适配器 `fetchMetrics` 拉取；归一化入库（ROI 花费为零存
   * `not_computable`）；单平台失败仅记录原因并保留上次成功数据，其余平台继续。
   */
  async pullMetrics(
    targets: MetricsPullTarget[],
    since: Date,
    until: Date,
  ): Promise<MetricsPullSummary> {
    const summary: MetricsPullSummary = { succeeded: [], failed: [], savedRows: 0 };
    for (const target of targets) {
      try {
        const adapter = this.adapters.getAdapter(target.platform);
        const ctx = this.adapters.createContext(target.platform);
        const native = await adapter.fetchMetrics(ctx, {
          accountId: target.accountId,
          since,
          until,
        });
        for (const row of native.rows) {
          const normalized = normalizeMetricRow(target.platform, row);
          if (!normalized) {
            this.logger.warn(`指标行缺少广告标识被丢弃：platform=${target.platform}`);
            continue;
          }
          const roi = computeRoi(normalized.conversionValue, normalized.spend);
          await this.metricRepo.save(
            this.metricRepo.create({
              adId: normalized.adId,
              platform: normalized.platform,
              impressions: String(normalized.impressions),
              clicks: String(normalized.clicks),
              conversions: String(normalized.conversions),
              spend: normalized.spend.toFixed(2),
              conversionValue: normalized.conversionValue.toFixed(2),
              roi: roi.kind === 'value' ? String(roi.value) : 'not_computable',
              pulledAt: new Date(),
            }),
          );
          summary.savedRows += 1;
        }
        summary.succeeded.push(target.platform);
      } catch (error) {
        // 单平台失败隔离：记录原因、保留上次成功数据，其余平台继续（需求 18.7）。
        const reason = this.describe(error, target.platform);
        this.logger.warn(`平台指标拉取失败已隔离：platform=${target.platform}, 原因=${reason}`);
        summary.failed.push({ platform: target.platform, reason });
      }
    }
    return summary;
  }

  // ---------------------------------------------------------------------------
  // 19.x 转化追踪配置与事件关联
  // ---------------------------------------------------------------------------

  /**
   * 配置转化追踪并经适配器提交至目标平台（需求 19.1-19.4）。
   *
   * 成功 → 状态「已生效」；提交失败 → 状态「提交失败」并记录原因。
   *
   * @throws InvalidConversionConfigError 事件定义非法（>50 条）。
   */
  async configureConversionTracking(input: {
    campaignId: string;
    platform: PlatformId;
    mechanism: ConversionMechanism;
    eventDefs?: unknown;
  }): Promise<ConversionConfig> {
    const errors = validateEventDefs(input.eventDefs);
    if (errors.length > 0) {
      throw new InvalidConversionConfigError(errors);
    }
    const config = await this.conversionConfigRepo.save(
      this.conversionConfigRepo.create({
        campaignId: input.campaignId,
        mechanism: input.mechanism,
        eventDefs: input.eventDefs ?? null,
        status: null,
      }),
    );
    try {
      const adapter = this.adapters.getAdapter(input.platform);
      const ctx = this.adapters.createContext(input.platform);
      await adapter.submitConversionTracking(ctx, {
        events: { mechanism: input.mechanism, eventDefs: input.eventDefs ?? [] },
      });
      config.status = '已生效';
    } catch (error) {
      const reason = this.describe(error, input.platform);
      this.logger.warn(`转化追踪提交失败：campaignId=${input.campaignId}, 原因=${reason}`);
      config.status = '提交失败';
    }
    return this.conversionConfigRepo.save(config);
  }

  /**
   * 回流转化事件并按广告关联（需求 19.5、19.6）。
   *
   * 能关联广告 → 「matched」；无法匹配 → 保留原始数据标「unmatched」待后续配置匹配。
   */
  async ingestConversionEvent(input: ConversionEventInput): Promise<ConversionEvent> {
    const matchStatus = matchConversionEvent(input.adId);
    return this.conversionEventRepo.save(
      this.conversionEventRepo.create({
        platformEventId: input.platformEventId,
        conversionConfigId: input.conversionConfigId ?? null,
        adId: matchStatus === 'matched' ? input.adId : null,
        matchStatus,
        rawData: input.raw ?? null,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // 20.x 审核状态同步
  // ---------------------------------------------------------------------------

  /**
   * 同步某平台广告审核状态（需求 20.1-20.5）。
   *
   * 经适配器拉取原生状态 → 归一化三态 → 入库；状态变更收集为通知记录（需求 20.4）；
   * 拉取失败保留上次状态并返回失败原因（需求 20.5）。
   */
  async syncReviewStatuses(platform: PlatformId, adIds: string[]): Promise<ReviewSyncResult> {
    try {
      const adapter = this.adapters.getAdapter(platform);
      const ctx = this.adapters.createContext(platform);
      const natives = await adapter.fetchReviewStatus(ctx, adIds);
      const changes: ReviewStatusChange[] = [];
      for (const native of natives) {
        const after = normalizeReviewStatus(native.rawStatus);
        const rejectReason = after === '审核被拒绝' ? native.rawStatus : null;
        const existing = await this.reviewStatusRepo.findOne({ where: { adId: native.adId } });
        if (existing) {
          if (existing.status !== after) {
            changes.push({ adId: native.adId, before: existing.status, after, rejectReason });
          }
          existing.status = after;
          existing.rejectReason = rejectReason;
          existing.pulledAt = new Date();
          await this.reviewStatusRepo.save(existing);
        } else {
          changes.push({ adId: native.adId, before: null, after, rejectReason });
          await this.reviewStatusRepo.save(
            this.reviewStatusRepo.create({
              adId: native.adId,
              status: after,
              rejectReason,
              pulledAt: new Date(),
            }),
          );
        }
      }
      for (const change of changes) {
        // 审核状态变更通知（需求 20.4）。
        this.logger.log(
          `审核状态变更：adId=${change.adId}, ${change.before ?? '（首次）'} → ${change.after}`,
        );
      }
      return { platform, changes };
    } catch (error) {
      // 拉取失败保留上次状态（需求 20.5）。
      const reason = this.describe(error, platform);
      this.logger.warn(`审核状态拉取失败已保留上次状态：platform=${platform}, 原因=${reason}`);
      return { platform, changes: [], failureReason: reason };
    }
  }

  private describe(error: unknown, platform: PlatformId): string {
    if (error instanceof CredentialNotConfiguredError) {
      return `平台「${platform}」凭据未配置`;
    }
    return error instanceof Error ? error.message : '平台调用失败';
  }
}
