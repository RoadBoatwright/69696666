import fc from 'fast-check';

import { CAPABILITY_IDS, CAPABILITY_SUPPORT, type CapabilityId } from './domain/extension';
import {
  BIDDING_TARGET_FIELD,
  PLATFORM_BIDDING_SUPPORT,
  resolveBiddingStrategy,
  routeCapability,
  validateOfflineConversion,
  validatePmaxAssetGroup,
} from './pure';

const platformArb = fc.constantFrom(
  'meta' as const,
  'google' as const,
  'tiktok' as const,
  'linkedin' as const,
);
const capabilityArb = fc.constantFrom(...(CAPABILITY_IDS as readonly CapabilityId[]));
const statusArb = fc.constantFrom('filled' as const, 'unfilled' as const);

describe('extension property tests', () => {
  it('能力路由三分律：LinkedIn→延期、不支持→不支持、未填→凭据缺失、否则路由', () => {
    // Feature: multi-platform-ad-integration, Property 52
    fc.assert(
      fc.property(capabilityArb, platformArb, statusArb, (capability, platform, status) => {
        const result = routeCapability(capability, platform, status);
        if (platform === 'linkedin') {
          expect(result.kind).toBe('deferred');
        } else if (!CAPABILITY_SUPPORT[capability].includes(platform)) {
          expect(result.kind).toBe('unsupported');
        } else if (status !== 'filled') {
          expect(result.kind).toBe('credential_missing');
        } else {
          expect(result.kind).toBe('route');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('出价策略转换：支持集内且目标值合法必有原生参数；支持集外必拒绝', () => {
    // Feature: multi-platform-ad-integration, Property 53
    const biddingPlatformArb = fc.constantFrom(
      'meta' as const,
      'google' as const,
      'tiktok' as const,
    );
    const strategyArb = fc.constantFrom(
      'TARGET_CPA' as const,
      'TARGET_ROAS' as const,
      'MAXIMIZE_CONVERSIONS' as const,
      'MAXIMIZE_CONVERSION_VALUE' as const,
      'MAXIMIZE_CLICKS' as const,
      'MANUAL_CPC' as const,
    );
    fc.assert(
      fc.property(
        biddingPlatformArb,
        strategyArb,
        fc.double({ min: 0.01, max: 1e6, noNaN: true }),
        (platform, strategy, targetValue) => {
          const result = resolveBiddingStrategy(platform, strategy, targetValue);
          if (!PLATFORM_BIDDING_SUPPORT[platform].includes(strategy)) {
            expect(result.ok).toBe(false);
            expect(!result.ok && result.error).toBe('出价方式不受支持');
          } else {
            expect(result.ok).toBe(true);
            expect(result.ok && typeof result.nativeParam).toBe('string');
            if (BIDDING_TARGET_FIELD[strategy]) {
              expect(result.ok && result.targetValue).toBe(targetValue);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('PMax 资产组校验：错误集合恰为缺失/为空的必填资产类别', () => {
    // Feature: multi-platform-ad-integration, Property 54
    const maybeAssets = fc.option(fc.array(fc.string(), { maxLength: 3 }), { nil: undefined });
    fc.assert(
      fc.property(maybeAssets, maybeAssets, maybeAssets, (headlines, descriptions, images) => {
        const result = validatePmaxAssetGroup({ headlines, descriptions, images });
        const expectedMissing = (
          [
            ['headlines', headlines],
            ['descriptions', descriptions],
            ['images', images],
          ] as const
        )
          .filter(([, value]) => !Array.isArray(value) || value.length === 0)
          .map(([field]) => field);
        if (expectedMissing.length === 0) {
          expect(result.ok).toBe(true);
        } else {
          expect(result.ok).toBe(false);
          expect(!result.ok && result.errors.map((e) => e.field)).toEqual(expectedMissing);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('离线转化校验：错误集合恰为缺失的必填项', () => {
    // Feature: multi-platform-ad-integration, Property 55
    const maybeValue = fc.option(fc.oneof(fc.string({ minLength: 1 }), fc.integer()), {
      nil: undefined,
    });
    fc.assert(
      fc.property(maybeValue, maybeValue, maybeValue, (eventId, eventTime, value) => {
        const result = validateOfflineConversion({ eventId, eventTime, value });
        const expectedMissing = (
          [
            ['eventId', eventId],
            ['eventTime', eventTime],
            ['value', value],
          ] as const
        )
          .filter(([, v]) => v === undefined || v === null || v === '')
          .map(([field]) => field);
        if (expectedMissing.length === 0) {
          expect(result.ok).toBe(true);
        } else {
          expect(result.ok).toBe(false);
          expect(!result.ok && result.errors.map((e) => e.field)).toEqual(expectedMissing);
        }
      }),
      { numRuns: 100 },
    );
  });
});
