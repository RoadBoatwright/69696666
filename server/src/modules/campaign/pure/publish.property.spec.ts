import fc from 'fast-check';

import {
  callWithTimeout,
  computeFirstPublishedAt,
  evaluatePublishGate,
  isAuthValidForPublish,
  resolvePublishStatus,
} from './publish.pure';
import type { AccountAuthStatus } from '../../auth-center/entities/account-authorization.entity';
import type { CampaignPublishStatus } from '../entities/campaign.entity';

/**
 * 投放编排状态机属性测试（组件 6，需求 13）。
 *
 * 覆盖 Property 28（非有效授权阻止投放）、Property 29（提交中拒绝重复投放）。
 * 最少 100 次迭代。
 */

const AUTH_STATUSES: readonly AccountAuthStatus[] = ['未授权', '有效', '需重新授权', '授权已撤销'];
const PUBLISH_STATUSES: readonly CampaignPublishStatus[] = [
  '未提交',
  '提交中',
  '已提交',
  '投放失败',
  '投放超时',
];

describe('投放编排状态机属性测试（fast-check）', () => {
  // Feature: multi-platform-ad-integration, Property 28
  // Property 28: 非有效授权阻止投放
  // Validates: Requirements 13.4
  it('Property 28: 授权非「有效」时投放被阻止，保持「未提交」', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<AccountAuthStatus>(...AUTH_STATUSES),
        fc.constantFrom<CampaignPublishStatus>(...PUBLISH_STATUSES),
        (authStatus, currentStatus) => {
          const decision = evaluatePublishGate(authStatus, currentStatus);
          if (!isAuthValidForPublish(authStatus)) {
            expect(decision.canPublish).toBe(false);
            if (!decision.canPublish) {
              expect(decision.keepStatus).toBe('未提交');
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 29
  // Property 29: 提交中拒绝重复投放
  // Validates: Requirements 13.6
  it('Property 29: 有效授权且当前「提交中」时拒绝重复投放，保持「提交中」', () => {
    fc.assert(
      fc.property(fc.constantFrom<CampaignPublishStatus>(...PUBLISH_STATUSES), (currentStatus) => {
        const decision = evaluatePublishGate('有效', currentStatus);
        if (currentStatus === '提交中') {
          expect(decision.canPublish).toBe(false);
          if (!decision.canPublish) {
            expect(decision.keepStatus).toBe('提交中');
          }
        } else {
          expect(decision.canPublish).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 28/29 辅助
  // first_published_at 仅首次成功写入，后续不覆盖（需求 21/45）
  it('first_published_at 仅在首次成功且原值为空时写入', () => {
    fc.assert(
      fc.property(
        fc.option(fc.date(), { nil: null }),
        fc.constantFrom('success', 'failure', 'timeout'),
        (current, kind) => {
          const now = new Date('2025-06-01T00:00:00Z');
          const outcome =
            kind === 'success'
              ? ({ kind: 'success', platformObjectId: 'p1' } as const)
              : kind === 'failure'
                ? ({ kind: 'failure', reason: 'x' } as const)
                : ({ kind: 'timeout' } as const);
          const result = computeFirstPublishedAt(current, outcome, now);
          if (kind === 'success' && current == null) {
            expect(result).toBe(now);
          } else {
            expect(result).toBe(current);
          }
          // 状态映射自洽。
          const status = resolvePublishStatus(outcome);
          expect(['已提交', '投放失败', '投放超时']).toContain(status);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('callWithTimeout（需求 13.2、13.5）', () => {
  it('在阈值内返回成功', async () => {
    const outcome = await callWithTimeout(async () => 'platform-1', 1000);
    expect(outcome).toEqual({ kind: 'success', platformObjectId: 'platform-1' });
  });

  it('调用抛错归一化为失败', async () => {
    const outcome = await callWithTimeout(async () => {
      throw new Error('boom');
    }, 1000);
    expect(outcome.kind).toBe('failure');
    if (outcome.kind === 'failure') {
      expect(outcome.reason).toBe('boom');
    }
  });

  it('超过阈值未响应归一化为超时', async () => {
    const outcome = await callWithTimeout(
      () => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 50)),
      5,
    );
    expect(outcome.kind).toBe('timeout');
  });
});
