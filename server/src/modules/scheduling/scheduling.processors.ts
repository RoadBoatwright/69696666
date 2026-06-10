import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { QUEUE_NAMES } from '../../queue/queue.constants';
import { AuthCenterService } from '../auth-center/auth-center.service';
import { TokenRecord } from '../auth-center/entities';
import { FollowUpRoutingService } from '../followup-routing/followup-routing.service';
import { MetricsService } from '../metrics/metrics.service';
import { Opportunity } from '../opportunity-scoring/entities/opportunity.entity';
import { OpportunityScoringService } from '../opportunity-scoring/opportunity-scoring.service';
import { PlatformAdapterRegistry } from '../platform-adapter';
import { VerificationService } from '../verification/verification.service';
import type {
  FollowupRouteJobData,
  LevelRecomputeJobData,
  MetricsPullJobData,
  VerificationJobData,
} from './scheduling.service';

/** 默认指标/审核拉取窗口：15 分钟（需求 18.5、20.1）。 */
const DEFAULT_WINDOW_MS = 15 * 60_000;

/**
 * 令牌保活与状态扫描消费者（需求 2.4、5.2）。
 *
 * 周期触发时遍历全部令牌：Google 令牌执行保活刷新，全部令牌执行过期预警扫描。
 * 单令牌失败不影响其余令牌（逐条捕获记录）。
 */
@Processor(QUEUE_NAMES.TOKEN_KEEPALIVE)
export class TokenKeepaliveProcessor extends WorkerHost {
  private readonly logger = new Logger(TokenKeepaliveProcessor.name);

  constructor(
    @InjectRepository(TokenRecord)
    private readonly tokenRepo: Repository<TokenRecord>,
    private readonly authCenter: AuthCenterService,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const tokens = await this.tokenRepo.find();
    for (const token of tokens) {
      try {
        await this.authCenter.runGoogleKeepAlive(token.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`令牌保活失败已隔离：tokenId=${token.id}, 原因=${message}`);
      }
    }
  }
}

/** 令牌状态扫描消费者：逐令牌过期预警，单条失败隔离（需求 5.2）。 */
@Processor(QUEUE_NAMES.TOKEN_STATUS_SCAN)
export class TokenStatusScanProcessor extends WorkerHost {
  private readonly logger = new Logger(TokenStatusScanProcessor.name);

  constructor(
    @InjectRepository(TokenRecord)
    private readonly tokenRepo: Repository<TokenRecord>,
    private readonly authCenter: AuthCenterService,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const tokens = await this.tokenRepo.find();
    for (const token of tokens) {
      try {
        await this.authCenter.scanExpiryWarning(token.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`令牌状态扫描失败已隔离：tokenId=${token.id}, 原因=${message}`);
      }
    }
  }
}

/**
 * 指标拉取消费者：每 15 分钟对全部已注册平台拉取并归一化指标，
 * 单平台失败隔离由 {@link MetricsService.pullMetrics} 保证（需求 18.5、18.7）。
 */
@Processor(QUEUE_NAMES.METRICS_PULL)
export class MetricsPullProcessor extends WorkerHost {
  constructor(
    private readonly metrics: MetricsService,
    private readonly adapters: PlatformAdapterRegistry,
  ) {
    super();
  }

  async process(job: Job<MetricsPullJobData | Record<string, never>>): Promise<void> {
    const data = (job.data ?? {}) as MetricsPullJobData;
    const targets =
      data.targets && data.targets.length > 0
        ? data.targets
        : this.adapters
            .registeredPlatforms()
            .map((platform) => ({ platform, accountId: 'default' }));
    const until = new Date();
    const since = new Date(until.getTime() - (data.windowMs ?? DEFAULT_WINDOW_MS));
    await this.metrics.pullMetrics(targets, since, until);
  }
}

/** 审核状态轮询消费者：每 15 分钟逐平台同步，失败保留上次状态（需求 20.1、20.5）。 */
@Processor(QUEUE_NAMES.REVIEW_STATUS_POLL)
export class ReviewStatusPollProcessor extends WorkerHost {
  constructor(
    private readonly metrics: MetricsService,
    private readonly adapters: PlatformAdapterRegistry,
  ) {
    super();
  }

  async process(job: Job<{ adIdsByPlatform?: Record<string, string[]> }>): Promise<void> {
    const adIdsByPlatform = job.data?.adIdsByPlatform ?? {};
    for (const platform of this.adapters.registeredPlatforms()) {
      await this.metrics.syncReviewStatuses(platform, adIdsByPlatform[platform] ?? []);
    }
  }
}

/**
 * 背调消费者：线索回流升格商机后触发 Gemini 背调（需求 15.2）；
 * 抛错由 BullMQ 按指数退避重试（需求 15.6）。
 */
@Processor(QUEUE_NAMES.VERIFICATION_RUN)
export class VerificationRunProcessor extends WorkerHost {
  constructor(private readonly verification: VerificationService) {
    super();
  }

  async process(job: Job<VerificationJobData>): Promise<void> {
    await this.verification.verify(job.data.opportunityId, job.data.lead);
  }
}

/** 分级重算消费者（需求 16.5）。 */
@Processor(QUEUE_NAMES.LEVEL_RECOMPUTE)
export class LevelRecomputeProcessor extends WorkerHost {
  constructor(private readonly scoring: OpportunityScoringService) {
    super();
  }

  async process(job: Job<LevelRecomputeJobData>): Promise<void> {
    await this.scoring.recompute(job.data.opportunityId, job.data.input);
  }
}

/**
 * 自动跟进路由消费者：高意向商机自动路由至 WhatsApp/CRM（需求 17.3）；
 * 抛错由 BullMQ 按指数退避重试（需求 17.7）。
 */
@Processor(QUEUE_NAMES.FOLLOWUP_ROUTE)
export class FollowupRouteProcessor extends WorkerHost {
  constructor(
    @InjectRepository(Opportunity)
    private readonly opportunityRepo: Repository<Opportunity>,
    private readonly routing: FollowUpRoutingService,
  ) {
    super();
  }

  async process(job: Job<FollowupRouteJobData>): Promise<void> {
    const opp = await this.opportunityRepo.findOne({ where: { id: job.data.opportunityId } });
    if (!opp) {
      return;
    }
    await this.routing.autoRoute(opp, job.data.threshold, job.data.contact ?? {});
  }
}

/** 全部调度消费者集合（模块注册用）。 */
export const SCHEDULING_PROCESSORS = [
  TokenKeepaliveProcessor,
  TokenStatusScanProcessor,
  MetricsPullProcessor,
  ReviewStatusPollProcessor,
  VerificationRunProcessor,
  LevelRecomputeProcessor,
  FollowupRouteProcessor,
];
