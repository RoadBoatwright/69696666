import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { JobsOptions, Queue } from 'bullmq';

import { QUEUE_NAMES } from '../../queue/queue.constants';
import type { MetricsPullTarget } from '../metrics/domain/metrics';
import type { RawLead } from '../verification/domain/verification';
import type { ScoringInput } from '../opportunity-scoring/domain/opportunity-scoring';
import type { IntentLevel } from '../opportunity-scoring/entities/opportunity.entity';

/** 周期任务 cron：每 15 分钟（需求 18.5、20.1）。 */
export const EVERY_15_MINUTES = '*/15 * * * *';

/** 失败重试基础选项：指数退避 3 次（需求 15.6、17.7）。 */
export const RETRY_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: true,
};

/** 背调任务负载（需求 15.2）。 */
export interface VerificationJobData {
  opportunityId: string;
  lead: RawLead;
}

/** 分级重算任务负载（需求 16.5）。 */
export interface LevelRecomputeJobData {
  opportunityId: string;
  input: ScoringInput;
}

/** 自动跟进路由任务负载（需求 17.3）。 */
export interface FollowupRouteJobData {
  opportunityId: string;
  threshold: IntentLevel;
  contact?: { phone?: string | null; email?: string | null };
}

/** 指标拉取任务负载（需求 18.5）。 */
export interface MetricsPullJobData {
  targets: MetricsPullTarget[];
  /** 拉取窗口（毫秒），默认 15 分钟。 */
  windowMs?: number;
}

/**
 * 异步调度接线（任务 22）。
 *
 * 把业务侧的周期任务与事件触发任务接到 BullMQ：
 *  - 周期：令牌保活/状态扫描、指标 15 分钟拉取、审核 15 分钟轮询
 *    （需求 2.4、5.2、18.5、20.1）。
 *  - 事件：线索回流升格后触发背调（含失败重试）、分级重算、自动跟进路由
 *    （含失败重试）（需求 15.2、15.6、16.5、17.3、17.7）。
 *
 * 仅负责入队与周期注册；执行逻辑由 scheduling.processors.ts 中的消费者
 * 委派给对应业务服务（真实服务原则不变）。
 */
@Injectable()
export class SchedulingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.TOKEN_KEEPALIVE) private readonly tokenKeepalive: Queue,
    @InjectQueue(QUEUE_NAMES.TOKEN_STATUS_SCAN) private readonly tokenStatusScan: Queue,
    @InjectQueue(QUEUE_NAMES.METRICS_PULL) private readonly metricsPull: Queue,
    @InjectQueue(QUEUE_NAMES.REVIEW_STATUS_POLL) private readonly reviewStatusPoll: Queue,
    @InjectQueue(QUEUE_NAMES.VERIFICATION_RUN) private readonly verificationRun: Queue,
    @InjectQueue(QUEUE_NAMES.LEVEL_RECOMPUTE) private readonly levelRecompute: Queue,
    @InjectQueue(QUEUE_NAMES.FOLLOWUP_ROUTE) private readonly followupRoute: Queue,
  ) {}

  /** 应用启动后注册周期任务（可用 `SCHEDULER_DISABLED=1` 关闭，便于测试环境）。 */
  async onApplicationBootstrap(): Promise<void> {
    if (process.env.SCHEDULER_DISABLED === '1') {
      return;
    }
    try {
      await this.registerRecurringJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`周期任务注册失败（Redis 不可用时将按退避重连）：${message}`);
    }
  }

  /**
   * 注册全部周期任务（幂等：固定 jobId 去重）。
   *
   * - 令牌保活与状态扫描：每 15 分钟（需求 2.4、5.2）。
   * - 指标拉取：每 15 分钟（需求 18.5）。
   * - 审核状态轮询：每 15 分钟（需求 20.1）。
   */
  async registerRecurringJobs(): Promise<void> {
    const repeat = { pattern: EVERY_15_MINUTES };
    await this.tokenKeepalive.add('token-keepalive', {}, { repeat, jobId: 'token-keepalive' });
    await this.tokenStatusScan.add('token-status-scan', {}, { repeat, jobId: 'token-status-scan' });
    await this.metricsPull.add('metrics-pull', {}, { repeat, jobId: 'metrics-pull' });
    await this.reviewStatusPoll.add(
      'review-status-poll',
      {},
      { repeat, jobId: 'review-status-poll' },
    );
  }

  /** 线索回流升格商机后触发背调，失败按指数退避重试（需求 15.2、15.6）。 */
  async enqueueVerification(data: VerificationJobData): Promise<void> {
    await this.verificationRun.add('verify', data, RETRY_OPTIONS);
  }

  /** 触发商机意向等级重算（需求 16.5）。 */
  async enqueueLevelRecompute(data: LevelRecomputeJobData): Promise<void> {
    await this.levelRecompute.add('recompute', data, { removeOnComplete: true });
  }

  /** 触发自动跟进路由，失败按指数退避重试（需求 17.3、17.7）。 */
  async enqueueFollowupRoute(data: FollowupRouteJobData): Promise<void> {
    await this.followupRoute.add('route', data, RETRY_OPTIONS);
  }
}
