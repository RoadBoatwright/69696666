import fc from 'fast-check';

import { nextStatus } from './pure';
import type { FollowUpStatus } from './domain/followup-routing';

const STATUSES: FollowUpStatus[] = ['待路由', '已触达', '跟进中', '路由失败'];

const eventArb = fc.record({
  channelsConfigured: fc.boolean(),
  routeSucceeded: fc.option(fc.boolean(), { nil: undefined }),
});

describe('跟进状态机属性（需求 17.1、17.3、17.6、17.7）', () => {
  // Feature: multi-platform-ad-integration, Property 42
  it('Property 42: 状态机综合不变量（唯一四态/未配置保持待路由/成功触达/失败保留）', () => {
    fc.assert(
      fc.property(fc.constantFrom<FollowUpStatus>(...STATUSES), eventArb, (current, e) => {
        const next = nextStatus(current, e);
        // 输出唯一且属于四态（需求 17.1）。
        expect(STATUSES).toContain(next);
        expect(nextStatus(current, e)).toBe(next);
        // 通道未配置：待路由/路由失败回到待路由，不丢商机（需求 17.6）。
        if (!e.channelsConfigured) {
          if (current === '待路由' || current === '路由失败') {
            expect(next).toBe('待路由');
          } else {
            expect(next).toBe(current);
          }
        }
        // 通道配置且路由成功：置已触达或推进跟进中（需求 17.3）。
        if (e.channelsConfigured && e.routeSucceeded === true) {
          expect(['已触达', '跟进中']).toContain(next);
        }
        // 通道配置且路由失败：置路由失败保留待重试（需求 17.7）。
        if (e.channelsConfigured && e.routeSucceeded === false) {
          expect(next).toBe('路由失败');
        }
      }),
      { numRuns: 100 },
    );
  });
});
