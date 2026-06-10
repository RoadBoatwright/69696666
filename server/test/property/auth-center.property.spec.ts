/**
 * 账户授权中心正确性属性测试（组件 2，需求 2-5）。
 *
 * 覆盖设计文档 Property 6-10。统一使用 fast-check，最少 100 次迭代（propertyConfig）。
 * 外部平台 API 调用一律 mock。
 */
import fc from 'fast-check';

import { propertyConfig } from './fc-config';
import type { TokenStatus } from '../../src/modules/auth-center/entities/token-record.entity';
import {
  applyRefreshFailure,
  applyRefreshSuccess,
  DAY_MS,
  evaluateGoogleKeepAlive,
  evaluateTokenStatus,
  GOOGLE_KEEPALIVE_MAX_DAYS,
  GOOGLE_KEEPALIVE_MIN_DAYS,
  MAX_CONSECUTIVE_REFRESH_FAILURES,
  shouldSendExpiryWarning,
  TOKEN_STATUSES,
  WARNING_WINDOW_MS,
  type TokenStateInput,
} from '../../src/modules/auth-center/pure/token-status.pure';

const NOW = new Date('2025-01-01T00:00:00Z');

/** 任意令牌状态生成器。 */
const statusArb = fc.constantFrom<TokenStatus>(...TOKEN_STATUSES);

/** 任意令牌状态机输入生成器（覆盖过期/即将过期/有效/无有效期等区间）。 */
const tokenStateArb: fc.Arbitrary<TokenStateInput> = fc.record({
  status: statusArb,
  // 有效期相对 NOW 在 [-30, +120] 天之间，含为空。
  accessTokenExpireAt: fc.option(
    fc
      .integer({ min: -30 * 24 * 60, max: 120 * 24 * 60 })
      .map((mins) => new Date(NOW.getTime() + mins * 60 * 1000)),
    { nil: null },
  ),
  consecutiveRefreshFailures: fc.integer({ min: 0, max: 6 }),
  lastWarningSentAt: fc.option(fc.constant(NOW), { nil: null }),
});

describe('账户授权中心属性测试', () => {
  // Feature: multi-platform-ad-integration, Property 6: 令牌状态机唯一性不变量
  // **Validates: Requirements 5.1, 5.3, 3.4**
  it('Property 6: evaluateTokenStatus 输出有且仅有一个且属于合法状态集合', () => {
    fc.assert(
      fc.property(tokenStateArb, (token) => {
        const status = evaluateTokenStatus(token, NOW);
        // 属于合法状态集合（唯一性由返回单值天然保证）。
        expect(TOKEN_STATUSES).toContain<TokenStatus>(status);
        // 确定性：同一输入恒得同一状态。
        expect(evaluateTokenStatus(token, NOW)).toBe(status);
      }),
      propertyConfig,
    );
  });

  // Feature: multi-platform-ad-integration, Property 7: 即将过期区间映射与预警幂等
  // **Validates: Requirements 5.2**
  it('Property 7: 剩余 0-7 天（含 7 不含 0）映射「即将过期」且预警仅发送一次', () => {
    // 仅生成时间派生状态（非粘滞终态），剩余有效期在 (0, 7] 天内。
    const expiringArb = fc.record({
      status: fc.constantFrom<TokenStatus>('有效', '即将过期', '已过期'),
      // 剩余 1 分钟 至 7 天（含 7 天上界）。
      remainingMs: fc.integer({ min: 60 * 1000, max: WARNING_WINDOW_MS }),
    });
    fc.assert(
      fc.property(expiringArb, ({ status, remainingMs }) => {
        const base: TokenStateInput = {
          status,
          accessTokenExpireAt: new Date(NOW.getTime() + remainingMs),
          consecutiveRefreshFailures: 0,
          lastWarningSentAt: null,
        };
        // 区间映射为「即将过期」（需求 5.2）。
        expect(evaluateTokenStatus(base, NOW)).toBe('即将过期');

        // 首次扫描应发送预警。
        expect(shouldSendExpiryWarning(base, NOW)).toBe(true);

        // 模拟发送成功后置幂等标记：再次扫描不再发送（同一预警仅发一次）。
        const afterSent: TokenStateInput = { ...base, lastWarningSentAt: NOW };
        expect(shouldSendExpiryWarning(afterSent, NOW)).toBe(false);
      }),
      propertyConfig,
    );
  });

  // Feature: multi-platform-ad-integration, Property 8: 令牌刷新成功复位不变量
  // **Validates: Requirements 5.4, 4.3**
  it('Property 8: 刷新成功后有效期更新、状态置「有效」、失败计数复位为 0', () => {
    const arb = fc.record({
      priorStatus: statusArb,
      priorFailures: fc.integer({ min: 0, max: 6 }),
      newExpireDays: fc.integer({ min: 1, max: 365 }),
    });
    fc.assert(
      fc.property(arb, ({ newExpireDays }) => {
        const newExpireAt = new Date(NOW.getTime() + newExpireDays * DAY_MS);
        const patch = applyRefreshSuccess(newExpireAt);
        expect(patch.status).toBe('有效');
        expect(patch.accessTokenExpireAt).toEqual(newExpireAt);
        expect(patch.consecutiveRefreshFailures).toBe(0);
        expect(patch.lastWarningSentAt).toBeNull();
        // 复位后由状态机派生：新有效期 > 7 天时应为「有效」。
        if (newExpireDays > 7) {
          expect(
            evaluateTokenStatus(
              {
                status: patch.status,
                accessTokenExpireAt: patch.accessTokenExpireAt,
                consecutiveRefreshFailures: patch.consecutiveRefreshFailures,
                lastWarningSentAt: patch.lastWarningSentAt,
              },
              NOW,
            ),
          ).toBe('有效');
        }
      }),
      propertyConfig,
    );
  });

  // Feature: multi-platform-ad-integration, Property 9: 连续刷新失败阈值停止
  // **Validates: Requirements 5.5**
  it('Property 9: 连续失败达 3 次置「需重新授权」且停止后续刷新', () => {
    // 随机生成失败次数序列长度，从计数 0 起连续累加失败。
    const arb = fc.integer({ min: 1, max: 8 });
    fc.assert(
      fc.property(arb, (failureCount) => {
        let state: { status: TokenStatus; consecutiveRefreshFailures: number } = {
          status: '有效',
          consecutiveRefreshFailures: 0,
        };
        let stoppedAt: number | null = null;
        for (let i = 1; i <= failureCount; i++) {
          const patch = applyRefreshFailure(state, NOW);
          state = {
            status: patch.status,
            consecutiveRefreshFailures: patch.consecutiveRefreshFailures,
          };
          if (patch.stopAutoRefresh && stoppedAt === null) {
            stoppedAt = i;
          }
        }
        if (failureCount >= MAX_CONSECUTIVE_REFRESH_FAILURES) {
          // 恰在第 3 次达阈值并停止。
          expect(stoppedAt).toBe(MAX_CONSECUTIVE_REFRESH_FAILURES);
          expect(state.status).toBe('需重新授权');
          // 状态机也据计数派生「需重新授权」，使后续不再刷新。
          expect(
            evaluateTokenStatus(
              {
                status: state.status,
                accessTokenExpireAt: new Date(NOW.getTime() + 30 * DAY_MS),
                consecutiveRefreshFailures: state.consecutiveRefreshFailures,
                lastWarningSentAt: null,
              },
              NOW,
            ),
          ).toBe('需重新授权');
        } else {
          expect(stoppedAt).toBeNull();
          expect(state.status).not.toBe('需重新授权');
        }
      }),
      propertyConfig,
    );
  });

  // Feature: multi-platform-ad-integration, Property 10: Google 保活触发区间
  // **Validates: Requirements 3.3**
  it('Property 10: 上次使用落在 [80, 90) 天触发保活，[90,∞) 置需重新授权', () => {
    const arb = fc.integer({ min: 0, max: 120 * 24 * 60 }).map((mins) => mins / (24 * 60));
    fc.assert(
      fc.property(arb, (days) => {
        const lastUsedAt = new Date(NOW.getTime() - days * DAY_MS);
        const action = evaluateGoogleKeepAlive(lastUsedAt, NOW);
        if (days >= GOOGLE_KEEPALIVE_MAX_DAYS) {
          expect(action).toBe('reauth');
        } else if (days >= GOOGLE_KEEPALIVE_MIN_DAYS) {
          expect(action).toBe('keepalive');
        } else {
          expect(action).toBe('none');
        }
      }),
      propertyConfig,
    );
  });
});
