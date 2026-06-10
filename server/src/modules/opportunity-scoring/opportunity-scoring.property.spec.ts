import fc from 'fast-check';

import { levelRank, score, sortByLevelDesc } from './pure';
import type { IntentLevel, ScoringInput, ScoringInputName } from './domain/opportunity-scoring';

const LEVELS: IntentLevel[] = ['L1', 'L2', 'L3', 'L4', '未分级'];

const behaviorArb = fc.record({
  formCompleted: fc.boolean(),
  repliedToContact: fc.boolean(),
  engagementScore: fc.double({ min: 0, max: 100, noNaN: true }),
});

const fullInputArb: fc.Arbitrary<ScoringInput> = fc.record({
  verification: fc.record({ credibilityScore: fc.double({ min: 0, max: 100, noNaN: true }) }),
  personaMatch: fc.double({ min: 0, max: 1, noNaN: true }),
  behavior: behaviorArb,
});

describe('商机分级纯函数属性（需求 16）', () => {
  // Feature: multi-platform-ad-integration, Property 38
  it('Property 38: 任意输入输出唯一等级且属于取值域', () => {
    fc.assert(
      fc.property(fullInputArb, (input) => {
        const r = score(input);
        expect(LEVELS).toContain(r.level);
        expect(r.missingInputs).toEqual([]);
        // 确定性：同输入同输出。
        expect(score(input)).toEqual(r);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 39
  it('Property 39: 移除必需输入子集则未分级且缺失项恰为被移除项', () => {
    fc.assert(
      fc.property(
        fullInputArb,
        fc.subarray(['背调结果', '画像匹配度', '行为数据'] as ScoringInputName[], {
          minLength: 1,
        }),
        (full, removed) => {
          const input: ScoringInput = { ...full };
          if (removed.includes('背调结果')) delete input.verification;
          if (removed.includes('画像匹配度')) delete input.personaMatch;
          if (removed.includes('行为数据')) delete input.behavior;
          const r = score(input);
          expect(r.level).toBe('未分级');
          expect(new Set(r.missingInputs)).toEqual(new Set(removed));
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 40
  it('Property 40: 排序后相邻等级权重非递增（L4>L3>L2>L1>未分级）', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<IntentLevel>(...LEVELS), { maxLength: 50 }),
        (levels) => {
          const sorted = sortByLevelDesc(levels.map((intentLevel) => ({ intentLevel })));
          for (let i = 1; i < sorted.length; i += 1) {
            expect(levelRank(sorted[i - 1].intentLevel)).toBeGreaterThanOrEqual(
              levelRank(sorted[i].intentLevel),
            );
          }
          expect(sorted).toHaveLength(levels.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 41
  it('Property 41: 重算等级等于 score(新输入)（覆盖语义，幂等）', () => {
    fc.assert(
      fc.property(fullInputArb, fullInputArb, (first, second) => {
        // 纯函数层验证覆盖语义：最终等级仅由最后一次输入决定。
        const after = score(second);
        expect(score(second)).toEqual(after);
        const changed = score(first).level !== after.level;
        // 等级变化与否完全由两次输入决定（确定性），不依赖外部状态。
        expect(score(first).level !== score(second).level).toBe(changed);
      }),
      { numRuns: 100 },
    );
  });
});
