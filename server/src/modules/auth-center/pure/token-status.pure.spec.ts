import type { TokenStatus } from '../entities/token-record.entity';
import {
  applyRefreshFailure,
  applyRefreshSuccess,
  DAY_MS,
  evaluateGoogleKeepAlive,
  evaluateTokenStatus,
  MAX_CONSECUTIVE_REFRESH_FAILURES,
  remainingValidityDays,
  shouldSendExpiryWarning,
  TOKEN_STATUSES,
  type TokenStateInput,
} from './token-status.pure';

const NOW = new Date('2025-01-01T00:00:00Z');

function tokenAt(daysFromNow: number, overrides: Partial<TokenStateInput> = {}): TokenStateInput {
  return {
    status: '有效',
    accessTokenExpireAt: new Date(NOW.getTime() + daysFromNow * DAY_MS),
    consecutiveRefreshFailures: 0,
    lastWarningSentAt: null,
    ...overrides,
  };
}

describe('evaluateTokenStatus（需求 5.1、5.3、3.4）', () => {
  it('剩余有效期 > 7 天为「有效」', () => {
    expect(evaluateTokenStatus(tokenAt(30), NOW)).toBe('有效');
  });

  it('剩余有效期恰好 7 天（含）为「即将过期」', () => {
    expect(evaluateTokenStatus(tokenAt(7), NOW)).toBe('即将过期');
  });

  it('剩余有效期处于 0-7 天之间为「即将过期」', () => {
    expect(evaluateTokenStatus(tokenAt(1), NOW)).toBe('即将过期');
  });

  it('剩余有效期恰好为 0（不含）归入「已过期」', () => {
    expect(evaluateTokenStatus(tokenAt(0), NOW)).toBe('已过期');
  });

  it('到期未刷新为「已过期」', () => {
    expect(evaluateTokenStatus(tokenAt(-1), NOW)).toBe('已过期');
  });

  it('无有效期视为「已过期」', () => {
    expect(evaluateTokenStatus(tokenAt(0, { accessTokenExpireAt: null }), NOW)).toBe('已过期');
  });

  it('连续刷新失败达阈值为「需重新授权」', () => {
    expect(
      evaluateTokenStatus(
        tokenAt(30, { consecutiveRefreshFailures: MAX_CONSECUTIVE_REFRESH_FAILURES }),
        NOW,
      ),
    ).toBe('需重新授权');
  });

  it('已置「授权已撤销」为粘滞终态', () => {
    expect(evaluateTokenStatus(tokenAt(30, { status: '授权已撤销' }), NOW)).toBe('授权已撤销');
  });

  it('已置「需重新授权」保持', () => {
    expect(evaluateTokenStatus(tokenAt(-5, { status: '需重新授权' }), NOW)).toBe('需重新授权');
  });

  it('输出恒属于合法状态集合', () => {
    const out = evaluateTokenStatus(tokenAt(3), NOW);
    expect(TOKEN_STATUSES).toContain<TokenStatus>(out);
  });
});

describe('remainingValidityDays（需求 5.2、5.7）', () => {
  it('已过期返回 0', () => {
    expect(remainingValidityDays(tokenAt(-1), NOW)).toBe(0);
  });
  it('无有效期返回 0', () => {
    expect(remainingValidityDays({ accessTokenExpireAt: null }, NOW)).toBe(0);
  });
  it('向上取整剩余天数', () => {
    expect(remainingValidityDays(tokenAt(6.2), NOW)).toBe(7);
  });
});

describe('shouldSendExpiryWarning（需求 5.2、5.6）', () => {
  it('即将过期且未发过预警时应发送', () => {
    expect(shouldSendExpiryWarning(tokenAt(3), NOW)).toBe(true);
  });
  it('已发过预警时不再发送（幂等）', () => {
    expect(shouldSendExpiryWarning(tokenAt(3, { lastWarningSentAt: NOW }), NOW)).toBe(false);
  });
  it('非即将过期不发送', () => {
    expect(shouldSendExpiryWarning(tokenAt(30), NOW)).toBe(false);
  });
});

describe('applyRefreshSuccess（需求 5.4、4.3）', () => {
  it('置「有效」、更新有效期、复位失败计数与预警标记', () => {
    const newExpire = new Date(NOW.getTime() + 60 * DAY_MS);
    expect(applyRefreshSuccess(newExpire)).toEqual({
      status: '有效',
      accessTokenExpireAt: newExpire,
      consecutiveRefreshFailures: 0,
      lastWarningSentAt: null,
    });
  });
});

describe('applyRefreshFailure（需求 5.5）', () => {
  it('未达阈值时累加计数并保持原状态、不停止刷新', () => {
    const patch = applyRefreshFailure({ status: '有效', consecutiveRefreshFailures: 1 }, NOW);
    expect(patch.consecutiveRefreshFailures).toBe(2);
    expect(patch.status).toBe('有效');
    expect(patch.stopAutoRefresh).toBe(false);
    expect(patch.lastFailureAt).toEqual(NOW);
  });

  it('达阈值时置「需重新授权」并停止刷新', () => {
    const patch = applyRefreshFailure({ status: '有效', consecutiveRefreshFailures: 2 }, NOW);
    expect(patch.consecutiveRefreshFailures).toBe(3);
    expect(patch.status).toBe('需重新授权');
    expect(patch.stopAutoRefresh).toBe(true);
  });
});

describe('evaluateGoogleKeepAlive（需求 3.3、3.4）', () => {
  it('不足 80 天无需动作', () => {
    expect(evaluateGoogleKeepAlive(new Date(NOW.getTime() - 79 * DAY_MS), NOW)).toBe('none');
  });
  it('恰好 80 天（含）触发保活', () => {
    expect(evaluateGoogleKeepAlive(new Date(NOW.getTime() - 80 * DAY_MS), NOW)).toBe('keepalive');
  });
  it('处于 80-90 天之间触发保活', () => {
    expect(evaluateGoogleKeepAlive(new Date(NOW.getTime() - 85 * DAY_MS), NOW)).toBe('keepalive');
  });
  it('达 90 天（含）置需重新授权', () => {
    expect(evaluateGoogleKeepAlive(new Date(NOW.getTime() - 90 * DAY_MS), NOW)).toBe('reauth');
  });
  it('无上次使用时间无需动作', () => {
    expect(evaluateGoogleKeepAlive(null, NOW)).toBe('none');
  });
});
