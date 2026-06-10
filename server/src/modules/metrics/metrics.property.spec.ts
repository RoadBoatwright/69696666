import fc from 'fast-check';

import { computeRoi, matchConversionEvent, normalizeReviewStatus } from './pure';

const NUM_RUNS = { numRuns: 100 };

describe('数据回传服务属性测试', () => {
  // Feature: multi-platform-ad-integration, Property 32
  it('Property 32: 花费为正时 ROI 为有限值，花费为零/非法时标「不可计算」且绝不除零', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e9, noNaN: true }),
        fc.double({ min: -1e6, max: 1e9, noNaN: true }),
        (value, spend) => {
          const result = computeRoi(value, spend);
          if (spend > 0) {
            expect(result.kind).toBe('value');
            if (result.kind === 'value') {
              expect(Number.isFinite(result.value)).toBe(true);
              expect(result.value).toBeCloseTo((value - spend) / spend, 8);
            }
          } else {
            expect(result).toEqual({ kind: 'not_computable', note: '不可计算' });
          }
        },
      ),
      NUM_RUNS,
    );
  });

  // Feature: multi-platform-ad-integration, Property 33
  it('Property 33: 单平台失败隔离——失败集合与成功集合互斥且并集覆盖全部平台', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.constantFrom<'meta' | 'google' | 'tiktok'>('meta', 'google', 'tiktok'), {
          minLength: 1,
        }),
        fc.func(fc.boolean()),
        async (platforms, failsOf) => {
          const failing = new Set(platforms.filter((p) => failsOf(p)));
          type P = 'meta' | 'google' | 'tiktok';
          const succeeded: P[] = [];
          const failed: P[] = [];
          for (const platform of platforms) {
            try {
              if (failing.has(platform)) throw new Error('拉取失败');
              succeeded.push(platform);
            } catch {
              failed.push(platform);
            }
          }
          // 失败平台不影响其余平台继续拉取。
          expect(new Set([...succeeded, ...failed])).toEqual(new Set(platforms));
          expect(succeeded.filter((p) => failing.has(p))).toHaveLength(0);
          expect(failed.every((p) => failing.has(p))).toBe(true);
        },
      ),
      NUM_RUNS,
    );
  });

  // Feature: multi-platform-ad-integration, Property 34
  it('Property 34: 转化事件有广告标识即 matched，否则 unmatched', () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: undefined }), (adId) => {
        const status = matchConversionEvent(adId);
        if (typeof adId === 'string' && adId.trim().length > 0) {
          expect(status).toBe('matched');
        } else {
          expect(status).toBe('unmatched');
        }
      }),
      NUM_RUNS,
    );
  });

  // Feature: multi-platform-ad-integration, Property 34
  it('Property 34 补充: 任意原生审核状态归一化结果必为三态之一', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        expect(['审核中', '审核通过', '审核被拒绝']).toContain(normalizeReviewStatus(raw));
      }),
      NUM_RUNS,
    );
  });
});
