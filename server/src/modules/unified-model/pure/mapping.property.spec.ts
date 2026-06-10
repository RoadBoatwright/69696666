import fc from 'fast-check';

import {
  hasUniqueParent,
  mapFromNative,
  mapToNative,
  roundTripFields,
  validatePlacement,
  type PlacementConfig,
} from './mapping.pure';
import { getFieldSpecs } from '../domain/field-map';
import { ACTIVE_PLATFORMS, type PlatformId, type UnifiedAdObject } from '../domain/unified-model';

/**
 * 统一模型映射属性测试（组件 3，需求 8、10、33）。
 *
 * 覆盖 Property 11（三级父级唯一）、Property 12（映射往返一致）、
 * Property 13（默认值与不适用标记）、Property 14（映射校验失败）、
 * Property 51（广告版位配置二选一）。最少 100 次迭代。
 */

const arbPlatform: fc.Arbitrary<PlatformId> = fc.constantFrom(...ACTIVE_PLATFORMS);

/** 生成合法的 campaign 统一对象（name 1-255、objective 1-64）。 */
const arbValidCampaign: fc.Arbitrary<UnifiedAdObject> = fc
  .record({
    name: fc.string({ minLength: 1, maxLength: 255 }),
    objective: fc.string({ minLength: 1, maxLength: 64 }),
  })
  .map((fields) => ({ level: 'campaign' as const, fields }));

/** 生成合法的 adgroup 统一对象（预算/出价/年龄/性别均在取值域内）。 */
const arbValidAdGroup: fc.Arbitrary<UnifiedAdObject> = fc
  .record({
    dailyBudget: fc.integer({ min: 1, max: 999999 }),
    bidStrategy: fc.constantFrom(
      'TARGET_CPA',
      'TARGET_ROAS',
      'MAXIMIZE_CONVERSIONS',
      'MAXIMIZE_CONVERSION_VALUE',
      'MAXIMIZE_CLICKS',
      'MANUAL_CPC',
    ),
    ageMin: fc.integer({ min: 13, max: 65 }),
    ageMax: fc.integer({ min: 13, max: 65 }),
    gender: fc.constantFrom('男', '女', '不限'),
    interests: fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 3 }),
  })
  .map((fields) => ({ level: 'adgroup' as const, parentId: 'c1', fields }));

describe('统一模型映射属性测试（fast-check）', () => {
  // Feature: multi-platform-ad-integration, Property 11
  // Property 11: 三级结构父级唯一
  // Validates: Requirements 8.1
  it('Property 11: campaign 无父级、adgroup/ad 必有且仅有一个非空父级', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'campaign' | 'adgroup' | 'ad'>('campaign', 'adgroup', 'ad'),
        fc.option(fc.string(), { nil: undefined }),
        (level, parentId) => {
          const obj: UnifiedAdObject = { level, parentId, fields: {} };
          const valid = hasUniqueParent(obj);
          if (level === 'campaign') {
            expect(valid).toBe(parentId === undefined || parentId === null);
          } else {
            expect(valid).toBe(typeof parentId === 'string' && parentId.length > 0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 12
  // Property 12: 统一↔原生字段映射往返一致
  // Validates: Requirements 8.4
  it('Property 12: 合法统一对象映射到原生再映射回，可往返字段范围内等价', () => {
    fc.assert(
      fc.property(arbPlatform, fc.oneof(arbValidCampaign, arbValidAdGroup), (platform, unified) => {
        const native = mapToNative(platform, unified);
        expect(native.ok).toBe(true);
        if (native.ok) {
          const back = mapFromNative(platform, unified.level, native.native, unified.parentId);
          // 仅比较经 nativeKey 映射的可往返字段（默认值/不适用字段不参与往返）。
          expect(back.fields).toEqual(roundTripFields(platform, unified));
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 13
  // Property 13: 默认值与不适用标记
  // Validates: Requirements 8.5, 10.4
  it('Property 13: 每个被映射字段恰好归入原生/默认值/不适用之一，无交叉', () => {
    fc.assert(
      fc.property(arbPlatform, arbValidAdGroup, (platform, unified) => {
        const result = mapToNative(platform, unified);
        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }
        // appliedDefaults 与 notApplicable 不相交。
        for (const f of result.appliedDefaults) {
          expect(result.notApplicable).not.toContain(f);
        }
        // 不适用字段不应出现在原生字段输出中（以其统一字段名为键）。
        const specs = getFieldSpecs(unified.level);
        for (const f of result.notApplicable) {
          const spec = specs.find((s) => s.field === f)!;
          // 该平台确无 nativeKey 且无默认值。
          const mapping = spec.platforms[platform];
          expect(mapping?.nativeKey).toBeUndefined();
          expect(mapping && 'defaultValue' in mapping).toBeFalsy();
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 14
  // Property 14: 映射校验失败返回字段名+原因分类，不产出原生字段
  // Validates: Requirements 8.7, 10.7
  it('Property 14: 越界/格式/缺失必填的字段使映射失败且错误含字段名与分类', () => {
    // 生成必定违规的 campaign：name 超长或为空。
    const arbInvalid: fc.Arbitrary<UnifiedAdObject> = fc.oneof(
      // name 超长 → out_of_range
      fc
        .record({
          name: fc.string({ minLength: 256, maxLength: 300 }),
          objective: fc.constant('LEADS'),
        })
        .map((fields) => ({ level: 'campaign' as const, fields })),
      // name 缺失 → required_missing
      fc.constant({ level: 'campaign' as const, fields: { objective: 'LEADS' } }),
    );

    fc.assert(
      fc.property(arbPlatform, arbInvalid, (platform, unified) => {
        const result = mapToNative(platform, unified);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.errors.length).toBeGreaterThan(0);
          for (const err of result.errors) {
            expect(typeof err.field).toBe('string');
            expect([
              'required_missing',
              'out_of_range',
              'invalid_format',
              'unsupported_value',
            ]).toContain(err.reason);
          }
          // 失败结果不含 native 产出。
          expect(result).not.toHaveProperty('native');
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 51
  // Property 51: 广告版位配置二选一（手动为空降级为自动；Advantage+/PMax 强制自动）
  // Validates: Requirements 33.1, 33.4, 33.7
  it('Property 51: 版位配置归一化后恰为 auto/manual 之一，手动为空降级自动、强制自动覆盖', () => {
    const arbConfig: fc.Arbitrary<PlacementConfig> = fc.record({
      mode: fc.constantFrom<'auto' | 'manual'>('auto', 'manual'),
      selectedPlacements: fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 5 }),
      forceAuto: fc.boolean(),
    });
    fc.assert(
      fc.property(arbConfig, (config) => {
        const result = validatePlacement(config);
        const selectedCount = config.selectedPlacements?.length ?? 0;

        if (config.forceAuto) {
          // 需求 33.7：强制自动版位、清空所选版位。
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.mode).toBe('auto');
            expect(result.selectedPlacements).toEqual([]);
          }
          return;
        }

        if (config.mode === 'auto') {
          // auto 仅当无所选版位时合法。
          expect(result.ok).toBe(selectedCount === 0);
          if (result.ok) {
            expect(result.mode).toBe('auto');
            expect(result.selectedPlacements).toEqual([]);
          }
        } else if (selectedCount === 0) {
          // 需求 33.4：手动为空降级为自动版位（不报错）。
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.mode).toBe('auto');
            expect(result.selectedPlacements).toEqual([]);
          }
        } else {
          // 手动非空：保留为手动版位。
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.mode).toBe('manual');
            expect(result.selectedPlacements).toEqual(config.selectedPlacements);
          }
        }

        // 二选一不变量：生效配置方式恰为 auto/manual 之一。
        if (result.ok) {
          expect(result.mode === 'auto' || result.mode === 'manual').toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
