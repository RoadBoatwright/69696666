import fc from 'fast-check';

import {
  validateBudgetSchedule,
  validateChildCount,
  validateCreateCampaign,
  validateName,
  validateTargeting,
} from './campaign-validation.pure';
import {
  BUDGET_MAX,
  BUDGET_MIN,
  MAX_CHILDREN_PER_PARENT,
  type BiddingStrategy,
  type PlatformId,
} from '../domain/campaign';

/**
 * 广告计划校验属性测试（组件 6，需求 8、10、12）。
 *
 * 覆盖 Property 15（名称长度）、Property 16（父级不存在拒绝，见 service 层）、
 * Property 17（数量上限）、Property 24/25/26/27（预算/日预算/排期/出价）、
 * Property 20（受众取值域）。最少 100 次迭代。
 */

const ALL_STRATEGIES: readonly BiddingStrategy[] = [
  'TARGET_CPA',
  'TARGET_ROAS',
  'MAXIMIZE_CONVERSIONS',
  'MAXIMIZE_CONVERSION_VALUE',
  'MAXIMIZE_CLICKS',
  'MANUAL_CPC',
];

const arbPlatform: fc.Arbitrary<PlatformId> = fc.constantFrom('meta', 'google', 'tiktok');

describe('广告计划校验属性测试（fast-check）', () => {
  // Feature: multi-platform-ad-integration, Property 15
  // Property 15: 广告系列名称长度约束
  // Validates: Requirements 8.2
  it('Property 15: 长度 1-255 名称接受、0 或超 255 拒绝', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 400 }), (name) => {
        const error = validateName(name);
        if (name.length >= 1 && name.length <= 255) {
          expect(error).toBeNull();
        } else {
          expect(error).not.toBeNull();
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 15
  // Property 15: 创建广告系列必填缺失返回完整不符合项集合
  // Validates: Requirements 8.2, 8.7
  it('Property 15: 必填字段缺失时返回的错误集合恰覆盖缺失字段', () => {
    fc.assert(
      fc.property(
        fc.record({
          merchantId: fc.option(fc.constant('m1'), { nil: undefined }),
          name: fc.option(fc.constant('campaign'), { nil: undefined }),
          objective: fc.option(fc.constant('LEADS'), { nil: undefined }),
          platform: fc.option(arbPlatform, { nil: undefined }),
        }),
        (input) => {
          const errors = validateCreateCampaign(input);
          const fields = new Set(errors.map((e) => e.field));
          expect(fields.has('merchantId')).toBe(input.merchantId === undefined);
          expect(fields.has('name')).toBe(input.name === undefined);
          expect(fields.has('objective')).toBe(input.objective === undefined);
          expect(fields.has('platform')).toBe(input.platform === undefined);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 17
  // Property 17: 数量上限约束
  // Validates: Requirements 8.8
  it('Property 17: 已有子级数 >= 5000 拒绝创建，否则接受', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_CHILDREN_PER_PARENT + 100 }),
        fc.constantFrom<'adGroup' | 'ad'>('adGroup', 'ad'),
        (count, field) => {
          const error = validateChildCount(count, field);
          if (count >= MAX_CHILDREN_PER_PARENT) {
            expect(error).not.toBeNull();
            expect(error?.code).toBe('count_limit_exceeded');
          } else {
            expect(error).toBeNull();
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 24
  // Property 24: 预算取值域约束
  // Validates: Requirements 12.1, 12.5
  it('Property 24: 预算在 0.01-999999999.99 接受、超出返回「预算超出允许范围」', () => {
    fc.assert(
      fc.property(fc.double({ min: -1000, max: BUDGET_MAX + 1000, noNaN: true }), (budget) => {
        // 总预算固定在合法范围且 >= 日预算，以隔离预算取值域判定。
        const total = BUDGET_MAX;
        const errors = validateBudgetSchedule(
          {
            dailyBudget: budget,
            totalBudget: total,
            biddingStrategy: 'MAXIMIZE_CONVERSIONS',
          },
          ALL_STRATEGIES,
        );
        const hasRangeError = errors.some(
          (e) => e.field === 'dailyBudget' && e.code === 'budget_out_of_range',
        );
        const inRange = budget >= BUDGET_MIN && budget <= BUDGET_MAX;
        expect(hasRangeError).toBe(!inRange);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 25
  // Property 25: 日预算不大于总预算
  // Validates: Requirements 12.6
  it('Property 25: 日预算>总预算返回错误，否则不返回该错误', () => {
    fc.assert(
      fc.property(
        fc.double({ min: BUDGET_MIN, max: BUDGET_MAX, noNaN: true }),
        fc.double({ min: BUDGET_MIN, max: BUDGET_MAX, noNaN: true }),
        (daily, total) => {
          const errors = validateBudgetSchedule(
            { dailyBudget: daily, totalBudget: total, biddingStrategy: 'MAXIMIZE_CONVERSIONS' },
            ALL_STRATEGIES,
          );
          const hasExceed = errors.some((e) => e.code === 'daily_exceeds_total');
          expect(hasExceed).toBe(daily > total);
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 26
  // Property 26: 排期时间有效性
  // Validates: Requirements 12.3, 12.4
  it('Property 26: 结束早于开始返回「排期时间无效」，否则不返回该错误', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-01-01T00:00:00Z') }),
        fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2030-01-01T00:00:00Z') }),
        (startAt, endAt) => {
          const errors = validateBudgetSchedule(
            {
              dailyBudget: 10,
              totalBudget: 100,
              biddingStrategy: 'MAXIMIZE_CONVERSIONS',
              startAt,
              endAt,
            },
            ALL_STRATEGIES,
          );
          const hasScheduleError = errors.some((e) => e.code === 'schedule_invalid');
          expect(hasScheduleError).toBe(endAt.getTime() < startAt.getTime());
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 27
  // Property 27: 出价方式受平台支持约束
  // Validates: Requirements 12.7
  it('Property 27: 出价方式不在平台支持集返回「出价方式不受支持」', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<BiddingStrategy>(...ALL_STRATEGIES),
        fc.subarray([...ALL_STRATEGIES], { minLength: 0, maxLength: ALL_STRATEGIES.length }),
        (strategy, supported) => {
          const errors = validateBudgetSchedule(
            { dailyBudget: 10, totalBudget: 100, biddingStrategy: strategy },
            supported,
          );
          const hasUnsupported = errors.some((e) => e.code === 'bidding_unsupported');
          expect(hasUnsupported).toBe(!supported.includes(strategy));
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 20
  // Property 20: 受众取值域约束
  // Validates: Requirements 10.1
  it('Property 20: 年龄 13-65、性别男/女/不限接受，越界或非法拒绝', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.constantFrom('男', '女', '不限', '其他', ''),
        (age, gender) => {
          const errors = validateTargeting({ ageMin: age, gender: gender as never });
          const ageOk = age >= 13 && age <= 65;
          const genderOk = ['男', '女', '不限'].includes(gender);
          const hasAgeError = errors.some((e) => e.field === 'ageMin');
          const hasGenderError = errors.some((e) => e.field === 'gender');
          expect(hasAgeError).toBe(!ageOk);
          expect(hasGenderError).toBe(!genderOk);
        },
      ),
      { numRuns: 200 },
    );
  });
});
