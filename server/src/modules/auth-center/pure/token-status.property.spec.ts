import fc from 'fast-check';

import type { TokenStatus } from '../entities/token-record.entity';
import {
  applyRefreshSuccess,
  DAY_MS,
  evaluateGoogleKeepAlive,
  evaluateTokenStatus,
  GOOGLE_KEEPALIVE_MAX_DAYS,
  GOOGLE_KEEPALIVE_MIN_DAYS,
  MAX_CONSECUTIVE_REFRESH_FAILURES,
  TOKEN_STATUSES,
  WARNING_WINDOW_DAYS,
  type TokenStateInput,
} from './token-status.pure';

/**
 * 账户授权中心令牌状态机属性测试（组件 2，需求 2-5）。
 *
 * 覆盖 Property 6（令牌状态机唯一性不变量）、Property 8（刷新成功复位不变量）、
 * Property 10（Google 保活触发区间）。最少 100 次迭代。
 */

const NOW = new Date('2025-01-01T00:00:00Z');
const PERSISTED_STATUSES: readonly TokenStatus[] = TOKEN_STATUSES;

/** 任意持久化令牌状态生成器。 */
const arbStatus = fc.constantFrom<TokenStatus>(...PERSISTED_STATUSES);

/** 任意令牌状态机输入生成器（有效期相对 NOW 在 ±400 天内或缺失）。 */
const arbTokenState: fc.Arbitrary<TokenStateInput> = fc.record({
  status: arbStatus,
  accessTokenExpireAt: fc.option(
    fc
      .integer({ min: -400 * DAY_MS, max: 400 * DAY_MS })
      .map((offset) => new Date(NOW.getTime() + offset)),
    { nil: null },
  ),
  consecutiveRefreshFailures: fc.integer({ min: 0, max: 10 }),
  lastWarningSentAt: fc.option(fc.constant(NOW), { nil: null }),
});

describe('令牌状态机属性测试（fast-check）', () => {
  // Feature: multi-platform-ad-integration, Property 6
  // Property 6: 令牌状态机唯一性不变量
  // Validates: Requirements 5.1, 5.3, 3.4
  it('Property 6: 对任意令牌记录与当前时间，状态有且仅有一个且属于合法集合，且区间映射与剩余有效期一致', () => {
    fc.assert(
      fc.property(arbTokenState, (token) => {
        const status = evaluateTokenStatus(token, NOW);

        // 输出有且仅有一个且属于合法状态集合（需求 5.1）。
        expect(PERSISTED_STATUSES).toContain(status);
        expect(PERSISTED_STATUSES.filter((s) => s === status)).toHaveLength(1);

        // 撤销/需重新授权为粘滞/事件驱动状态，优先级最高，单独校验。
        if (token.status === '授权已撤销') {
          expect(status).toBe('授权已撤销');
          return;
        }
        if (
          token.status === '需重新授权' ||
          token.consecutiveRefreshFailures >= MAX_CONSECUTIVE_REFRESH_FAILURES
        ) {
          expect(status).toBe('需重新授权');
          return;
        }

        // 其余为基于剩余有效期的时间派生状态，区间映射与剩余有效期一致（需求 5.3、3.4）。
        const expireAt = token.accessTokenExpireAt;
        if (!expireAt) {
          expect(status).toBe('已过期');
          return;
        }
        const remaining = expireAt.getTime() - NOW.getTime();
        if (remaining <= 0) {
          expect(status).toBe('已过期'); // 到期未刷新；含 0 边界归入已过期。
        } else if (remaining <= WARNING_WINDOW_DAYS * DAY_MS) {
          expect(status).toBe('即将过期'); // 0（不含）-7（含）天。
        } else {
          expect(status).toBe('有效');
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 8
  // Property 8: 令牌刷新成功复位不变量
  // Validates: Requirements 5.4, 4.3
  it('Property 8: 对任意刷新前状态，刷新成功后有效期更新、状态置「有效」、失败计数复位为 0', () => {
    fc.assert(
      fc.property(
        arbTokenState,
        fc.integer({ min: 1, max: 365 * DAY_MS }).map((offset) => new Date(NOW.getTime() + offset)),
        (_before, newExpireAt) => {
          const patch = applyRefreshSuccess(newExpireAt);
          expect(patch.status).toBe('有效');
          expect(patch.accessTokenExpireAt).toEqual(newExpireAt);
          expect(patch.consecutiveRefreshFailures).toBe(0);
          // 复位预警标记，使新过期窗口可再次预警。
          expect(patch.lastWarningSentAt).toBeNull();

          // 复位后以新有效期求值，结果不再是「需重新授权（因失败计数）」或「已过期」。
          const evaluated = evaluateTokenStatus(
            {
              status: patch.status,
              accessTokenExpireAt: patch.accessTokenExpireAt,
              consecutiveRefreshFailures: patch.consecutiveRefreshFailures,
              lastWarningSentAt: patch.lastWarningSentAt,
            },
            NOW,
          );
          expect(['有效', '即将过期']).toContain(evaluated);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 10
  // Property 10: Google 保活触发区间
  // Validates: Requirements 3.3
  it('Property 10: 对任意上次使用时间，落在 80（含）-90（不含）天触发保活，达 90 天置需重新授权', () => {
    fc.assert(
      fc.property(fc.option(fc.integer({ min: 0, max: 200 * DAY_MS }), { nil: null }), (ageMs) => {
        const lastUsedAt = ageMs == null ? null : new Date(NOW.getTime() - ageMs);
        const action = evaluateGoogleKeepAlive(lastUsedAt, NOW);

        if (lastUsedAt == null) {
          expect(action).toBe('none');
          return;
        }
        const days = ageMs! / DAY_MS;
        if (days >= GOOGLE_KEEPALIVE_MAX_DAYS) {
          expect(action).toBe('reauth');
        } else if (days >= GOOGLE_KEEPALIVE_MIN_DAYS) {
          expect(action).toBe('keepalive');
        } else {
          expect(action).toBe('none');
        }
      }),
      { numRuns: 200 },
    );
  });
});
