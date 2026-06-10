/**
 * 属性测试（fast-check）统一配置。
 *
 * 规范要求：每条正确性属性以单个属性测试实现，最少运行 100 次迭代。
 * 所有属性测试统一通过 `propertyConfig` 传入 fast-check 的 assert 选项，
 * 以保证 numRuns 不低于 100。
 *
 * 用法：
 *   import fc from 'fast-check';
 *   import { propertyConfig } from '../fc-config';
 *
 *   fc.assert(
 *     fc.property(gen, (x) => { ... }),
 *     propertyConfig,
 *   );
 */
import type { Parameters as FcParameters } from 'fast-check';

/** 规范规定的最少属性测试迭代次数。 */
export const MIN_NUM_RUNS = 100;

/** 统一的 fast-check 断言配置（最少 100 次迭代）。 */
export const propertyConfig: FcParameters<unknown> = {
  numRuns: MIN_NUM_RUNS,
};
