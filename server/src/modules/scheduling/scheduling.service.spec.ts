import type { Queue } from 'bullmq';

import { EVERY_15_MINUTES, RETRY_OPTIONS, SchedulingService } from './scheduling.service';
import {
  FollowupRouteProcessor,
  LevelRecomputeProcessor,
  MetricsPullProcessor,
  ReviewStatusPollProcessor,
  VerificationRunProcessor,
} from './scheduling.processors';

interface AddedJob {
  name: string;
  data: unknown;
  opts?: Record<string, unknown>;
}

function makeQueue(): { queue: Queue; added: AddedJob[] } {
  const added: AddedJob[] = [];
  const queue = {
    add: async (name: string, data: unknown, opts?: Record<string, unknown>) => {
      added.push({ name, data, opts });
      return { id: `job-${added.length}` };
    },
  } as unknown as Queue;
  return { queue, added };
}

function setup() {
  const queues = {
    tokenKeepalive: makeQueue(),
    tokenStatusScan: makeQueue(),
    metricsPull: makeQueue(),
    reviewStatusPoll: makeQueue(),
    verificationRun: makeQueue(),
    levelRecompute: makeQueue(),
    followupRoute: makeQueue(),
  };
  const service = new SchedulingService(
    queues.tokenKeepalive.queue,
    queues.tokenStatusScan.queue,
    queues.metricsPull.queue,
    queues.reviewStatusPoll.queue,
    queues.verificationRun.queue,
    queues.levelRecompute.queue,
    queues.followupRoute.queue,
  );
  return { service, queues };
}

describe('SchedulingService（任务 22：BullMQ 调度接线）', () => {
  it('registerRecurringJobs 注册四个 15 分钟周期任务（需求 2.4、5.2、18.5、20.1）', async () => {
    const { service, queues } = setup();
    await service.registerRecurringJobs();
    for (const key of [
      'tokenKeepalive',
      'tokenStatusScan',
      'metricsPull',
      'reviewStatusPoll',
    ] as const) {
      expect(queues[key].added).toHaveLength(1);
      expect(queues[key].added[0].opts?.repeat).toEqual({ pattern: EVERY_15_MINUTES });
      expect(queues[key].added[0].opts?.jobId).toBeDefined();
    }
  });

  it('enqueueVerification 带指数退避重试入队（需求 15.2、15.6）', async () => {
    const { service, queues } = setup();
    await service.enqueueVerification({ opportunityId: 'opp-1', lead: { phone: '+66 1' } });
    expect(queues.verificationRun.added).toHaveLength(1);
    expect(queues.verificationRun.added[0].opts).toMatchObject({
      attempts: RETRY_OPTIONS.attempts,
      backoff: RETRY_OPTIONS.backoff,
    });
    expect(queues.verificationRun.added[0].data).toEqual({
      opportunityId: 'opp-1',
      lead: { phone: '+66 1' },
    });
  });

  it('enqueueLevelRecompute 入队分级重算（需求 16.5）', async () => {
    const { service, queues } = setup();
    await service.enqueueLevelRecompute({ opportunityId: 'opp-2', input: { personaMatch: 0.8 } });
    expect(queues.levelRecompute.added).toHaveLength(1);
    expect(queues.levelRecompute.added[0].data).toMatchObject({ opportunityId: 'opp-2' });
  });

  it('enqueueFollowupRoute 带指数退避重试入队（需求 17.3、17.7）', async () => {
    const { service, queues } = setup();
    await service.enqueueFollowupRoute({ opportunityId: 'opp-3', threshold: 'L3' });
    expect(queues.followupRoute.added).toHaveLength(1);
    expect(queues.followupRoute.added[0].opts).toMatchObject({
      attempts: RETRY_OPTIONS.attempts,
    });
  });
});

describe('调度消费者委派（任务 22）', () => {
  it('VerificationRunProcessor 委派 VerificationService.verify（需求 15.2）', async () => {
    const calls: unknown[][] = [];
    const verification = {
      verify: async (...args: unknown[]) => {
        calls.push(args);
        return {} as never;
      },
    };
    const processor = new VerificationRunProcessor(verification as never);
    await processor.process({
      data: { opportunityId: 'opp-1', lead: { email: 'a@b.co' } },
    } as never);
    expect(calls).toEqual([['opp-1', { email: 'a@b.co' }]]);
  });

  it('LevelRecomputeProcessor 委派 OpportunityScoringService.recompute（需求 16.5）', async () => {
    const calls: unknown[][] = [];
    const scoring = {
      recompute: async (...args: unknown[]) => {
        calls.push(args);
        return {} as never;
      },
    };
    const processor = new LevelRecomputeProcessor(scoring as never);
    await processor.process({
      data: { opportunityId: 'opp-2', input: { personaMatch: 1 } },
    } as never);
    expect(calls).toEqual([['opp-2', { personaMatch: 1 }]]);
  });

  it('FollowupRouteProcessor 加载商机并委派 autoRoute；商机不存在时静默返回（需求 17.3）', async () => {
    const calls: unknown[][] = [];
    const opp = { id: 'opp-3', intentLevel: 'L4' };
    const repo = {
      findOne: async ({ where }: { where: { id: string } }) => (where.id === 'opp-3' ? opp : null),
    };
    const routing = {
      autoRoute: async (...args: unknown[]) => {
        calls.push(args);
        return { kind: 'below_threshold' } as never;
      },
    };
    const processor = new FollowupRouteProcessor(repo as never, routing as never);
    await processor.process({
      data: { opportunityId: 'opp-3', threshold: 'L3', contact: { phone: '+66' } },
    } as never);
    expect(calls).toEqual([[opp, 'L3', { phone: '+66' }]]);

    await processor.process({ data: { opportunityId: 'missing', threshold: 'L3' } } as never);
    expect(calls).toHaveLength(1);
  });

  it('MetricsPullProcessor 默认对全部已注册平台拉取 15 分钟窗口（需求 18.5）', async () => {
    const calls: { targets: unknown; since: Date; until: Date }[] = [];
    const metrics = {
      pullMetrics: async (targets: unknown, since: Date, until: Date) => {
        calls.push({ targets, since, until });
        return { succeeded: [], failed: [], savedRows: 0 };
      },
    };
    const adapters = { registeredPlatforms: () => ['meta', 'google'] };
    const processor = new MetricsPullProcessor(metrics as never, adapters as never);
    await processor.process({ data: {} } as never);
    expect(calls).toHaveLength(1);
    expect(calls[0].targets).toEqual([
      { platform: 'meta', accountId: 'default' },
      { platform: 'google', accountId: 'default' },
    ]);
    expect(calls[0].until.getTime() - calls[0].since.getTime()).toBe(15 * 60_000);
  });

  it('ReviewStatusPollProcessor 逐平台委派 syncReviewStatuses（需求 20.1）', async () => {
    const calls: unknown[][] = [];
    const metrics = {
      syncReviewStatuses: async (...args: unknown[]) => {
        calls.push(args);
        return { platform: args[0], changes: [] };
      },
    };
    const adapters = { registeredPlatforms: () => ['meta', 'tiktok'] };
    const processor = new ReviewStatusPollProcessor(metrics as never, adapters as never);
    await processor.process({
      data: { adIdsByPlatform: { meta: ['ad-1'] } },
    } as never);
    expect(calls).toEqual([
      ['meta', ['ad-1']],
      ['tiktok', []],
    ]);
  });
});
