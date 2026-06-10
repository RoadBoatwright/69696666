import fc from 'fast-check';

import {
  canPublish,
  collectMissingItems,
  initialConfirmStatusForMode,
} from './pure/ai-campaign.pure';
import { MISSING_ITEM_LABELS } from './domain/ai-campaign';
import type { AssetRef } from '../platform-adapter/domain/platform-adapter';
import type {
  BuyerPersona,
  DraftConfirmStatus,
  GenerateDraftInput,
  ReviewMode,
} from './domain/ai-campaign';

/**
 * AI 辅助建广告引擎属性测试（组件 5，需求 9）。
 *
 * 覆盖 Property 18（草案确认状态机：待确认不得投放）、Property 19（获客方案缺失项完整反馈）。
 * 均为平台无关纯函数，最少 100 次迭代。
 */

/** 任意成品素材引用生成器。 */
const assetRefArb: fc.Arbitrary<AssetRef> = fc.record({
  assetId: fc.uuid(),
  type: fc.constantFrom('image', 'video', 'pdf', 'carousel'),
  source: fc.webUrl(),
});

/** 任意（可能完整可能残缺）买家画像生成器。 */
const partialPersonaArb: fc.Arbitrary<Partial<BuyerPersona>> = fc.record(
  {
    geo: fc.option(fc.string(), { nil: undefined }),
    industry: fc.option(fc.string(), { nil: undefined }),
    jobRole: fc.option(fc.string(), { nil: undefined }),
  },
  { requiredKeys: [] },
) as fc.Arbitrary<Partial<BuyerPersona>>;

describe('AI 辅助建广告引擎属性测试（fast-check）', () => {
  // Feature: multi-platform-ad-integration, Property 18
  // Property 18: 草案确认状态机（待确认不得投放）
  // Validates: Requirements 9.5, 9.6
  it('Property 18: 新草案恒「待确认」，canPublish 当且仅当「已确认」为真', () => {
    fc.assert(
      fc.property(fc.constantFrom<DraftConfirmStatus>('待确认', '已确认'), (status) => {
        // canPublish 当且仅当「已确认」（需求 9.5、9.6）。
        expect(canPublish(status)).toBe(status === '已确认');
      }),
      { numRuns: 100 },
    );
  });

  it('Property 18: 专家把关档新草案恒「待确认」且不可投放；全自动档「已确认」可投放', () => {
    fc.assert(
      fc.property(fc.constantFrom<ReviewMode>('全自动', '专家把关'), (mode) => {
        const initial = initialConfirmStatusForMode(mode);
        if (mode === '专家把关') {
          expect(initial).toBe('待确认');
          expect(canPublish(initial)).toBe(false);
        } else {
          expect(initial).toBe('已确认');
          expect(canPublish(initial)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 19
  // Property 19: 获客方案缺失项完整反馈
  // Validates: Requirements 9.8
  it('Property 19: 从完整输入移除任意必填子集，缺失项集合恰为被移除项', () => {
    const completePersona: BuyerPersona = { geo: 'US', industry: 'SaaS', jobRole: 'CEO' };

    fc.assert(
      fc.property(
        // 是否移除素材。
        fc.boolean(),
        // 移除的画像维度子集。
        fc.subarray<keyof BuyerPersona>(['geo', 'industry', 'jobRole']),
        fc.array(assetRefArb, { minLength: 1, maxLength: 4 }),
        (dropMaterials, droppedDims, materials) => {
          const persona: Partial<BuyerPersona> = { ...completePersona };
          for (const dim of droppedDims) {
            delete persona[dim];
          }

          const input: GenerateDraftInput = {
            merchantId: 'm1',
            materials: dropMaterials ? [] : materials,
            persona: persona as BuyerPersona,
          };

          const missing = collectMissingItems(input);

          // 期望缺失项 = 被移除项（素材在前，画像维度按固定顺序）。
          const expected: string[] = [];
          if (dropMaterials) {
            expected.push(MISSING_ITEM_LABELS.materials);
          }
          for (const dim of ['geo', 'industry', 'jobRole'] as (keyof BuyerPersona)[]) {
            if (droppedDims.includes(dim)) {
              expected.push(MISSING_ITEM_LABELS[dim]);
            }
          }

          expect(missing).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 19: 任意残缺画像下，缺失项恰为空串/缺省的维度全集', () => {
    fc.assert(
      fc.property(partialPersonaArb, fc.array(assetRefArb), (persona, materials) => {
        const input: GenerateDraftInput = {
          merchantId: 'm1',
          materials,
          persona: persona as BuyerPersona,
        };
        const missing = collectMissingItems(input);

        const expected: string[] = [];
        if (materials.length === 0) {
          expected.push(MISSING_ITEM_LABELS.materials);
        }
        for (const dim of ['geo', 'industry', 'jobRole'] as (keyof BuyerPersona)[]) {
          const v = persona[dim];
          if (typeof v !== 'string' || v.trim().length === 0) {
            expected.push(MISSING_ITEM_LABELS[dim]);
          }
        }
        expect(missing).toEqual(expected);
        // 完整输入（无缺失）时方可生成草案。
        expect(missing.length === 0).toBe(
          materials.length > 0 &&
            ['geo', 'industry', 'jobRole'].every((d) => {
              const v = persona[d as keyof BuyerPersona];
              return typeof v === 'string' && v.trim().length > 0;
            }),
        );
      }),
      { numRuns: 100 },
    );
  });
});
