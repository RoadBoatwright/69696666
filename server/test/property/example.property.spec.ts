/**
 * 属性测试模板示例（Property-Based Testing Template）。
 *
 * 本文件演示本项目属性测试的统一写法约定，供后续各正确性属性测试参照：
 *  1. 使用 fast-check 作为属性测试库（不自行实现框架）。
 *  2. 每条正确性属性以「单个」属性测试实现，最少运行 100 次迭代
 *     （通过统一的 `propertyConfig` 传入 numRuns: 100）。
 *  3. 每个属性测试以注释标注其对应的设计属性，标注格式为：
 *     // Feature: multi-platform-ad-integration, Property {编号}: {属性文本}
 *
 * 注意：本文件仅为模板示例，使用一个平凡的纯函数（数组反转）演示写法，
 * 不对应设计文档中的任何正式编号属性；正式属性测试将在各功能任务中按上述
 * 约定逐条实现。
 *
 * _Requirements: 6.1（作为通用测试基建支撑）_
 */
import fc from 'fast-check';

import { MIN_NUM_RUNS, propertyConfig } from './fc-config';

/** 平凡纯函数：反转数组（仅用于演示属性测试写法）。 */
function reverse<T>(xs: readonly T[]): T[] {
  return [...xs].reverse();
}

describe('属性测试模板示例（fast-check）', () => {
  // Feature: multi-platform-ad-integration, Property 0: 示例——对任意数组，反转两次等于原数组（幂等性演示）
  it('对任意数组，反转两次应等于原数组', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (xs) => {
        expect(reverse(reverse(xs))).toEqual(xs);
      }),
      propertyConfig,
    );
  });

  it('属性配置应满足最少 100 次迭代的规范', () => {
    expect(propertyConfig.numRuns).toBe(MIN_NUM_RUNS);
    expect(MIN_NUM_RUNS).toBeGreaterThanOrEqual(100);
  });
});
