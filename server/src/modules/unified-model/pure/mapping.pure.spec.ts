import {
  hasUniqueParent,
  mapFromNative,
  mapToNative,
  resolvePlacementsForPlatform,
  roundTripFields,
  validatePlacement,
} from './mapping.pure';
import { isMappingFailure, type UnifiedAdObject } from '../domain/unified-model';

/**
 * 统一模型映射纯函数单元测试（组件 3，需求 8、10、33）。
 *
 * 覆盖父级唯一、映射往返、默认值/不适用标记、映射校验失败分类、版位二选一的
 * 具体示例与边界用例，与属性测试互补。
 */
describe('统一模型映射纯函数', () => {
  describe('hasUniqueParent（需求 8.1）', () => {
    it('campaign 无父级时通过', () => {
      expect(hasUniqueParent({ level: 'campaign', fields: {} })).toBe(true);
    });

    it('campaign 有父级时不通过', () => {
      expect(hasUniqueParent({ level: 'campaign', parentId: 'x', fields: {} })).toBe(false);
    });

    it('adgroup/ad 必须有非空父级', () => {
      expect(hasUniqueParent({ level: 'adgroup', parentId: 'c1', fields: {} })).toBe(true);
      expect(hasUniqueParent({ level: 'adgroup', fields: {} })).toBe(false);
      expect(hasUniqueParent({ level: 'ad', parentId: '', fields: {} })).toBe(false);
    });
  });

  describe('mapToNative（需求 8.4、8.5、8.7、10.4）', () => {
    it('合法 campaign 映射为目标平台原生字段', () => {
      const unified: UnifiedAdObject = {
        level: 'campaign',
        fields: { name: '夏季促销', objective: 'LEADS' },
      };
      const result = mapToNative('meta', unified);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.native).toEqual({ name: '夏季促销', objective: 'LEADS' });
      }
    });

    it('TikTok 平台使用其原生字段名', () => {
      const result = mapToNative('tiktok', {
        level: 'campaign',
        fields: { name: 'X', objective: 'LEADS' },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.native.campaign_name).toBe('X');
        expect(result.native.objective_type).toBe('LEADS');
      }
    });

    it('无原生字段但有默认值时应用平台默认值（需求 8.5）', () => {
      const result = mapToNative('google', {
        level: 'campaign',
        fields: { name: 'X', objective: 'SEARCH', specialAdCategory: '不应被使用' },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        // google 对 specialAdCategory 无 nativeKey 但有默认值 NONE。
        expect(result.appliedDefaults).toContain('specialAdCategory');
        expect(result.native.specialAdCategory).toBe('NONE');
      }
    });

    it('无原生字段且无默认值时标记为该平台不适用（需求 10.4）', () => {
      const result = mapToNative('google', {
        level: 'adgroup',
        parentId: 'c1',
        fields: { dailyBudget: 100, bidStrategy: 'MAXIMIZE_CONVERSIONS', interests: ['tech'] },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        // google 对 interests 无 nativeKey、无默认值 → 不适用。
        expect(result.notApplicable).toContain('interests');
        expect(result.native).not.toHaveProperty('interests');
      }
    });

    it('必填字段缺失返回 required_missing（需求 8.7）', () => {
      const result = mapToNative('meta', { level: 'campaign', fields: { objective: 'LEADS' } });
      expect(isMappingFailure(result)).toBe(true);
      if (!result.ok) {
        expect(result.errors).toContainEqual({ field: 'name', reason: 'required_missing' });
      }
    });

    it('名称超长返回 out_of_range（需求 8.2、8.7）', () => {
      const result = mapToNative('meta', {
        level: 'campaign',
        fields: { name: 'a'.repeat(256), objective: 'LEADS' },
      });
      expect(isMappingFailure(result)).toBe(true);
      if (!result.ok) {
        expect(result.errors[0]).toMatchObject({ field: 'name', reason: 'out_of_range' });
      }
    });

    it('年龄越界返回 out_of_range（需求 10.7）', () => {
      const result = mapToNative('meta', {
        level: 'adgroup',
        parentId: 'c1',
        fields: { dailyBudget: 50, bidStrategy: 'MANUAL_CPC', ageMin: 10 },
      });
      expect(isMappingFailure(result)).toBe(true);
      if (!result.ok) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({ field: 'ageMin', reason: 'out_of_range' }),
        );
      }
    });

    it('出价策略非法返回 unsupported_value', () => {
      const result = mapToNative('meta', {
        level: 'adgroup',
        parentId: 'c1',
        fields: { dailyBudget: 50, bidStrategy: 'NOPE' },
      });
      expect(isMappingFailure(result)).toBe(true);
      if (!result.ok) {
        expect(result.errors).toContainEqual(
          expect.objectContaining({ field: 'bidStrategy', reason: 'unsupported_value' }),
        );
      }
    });
  });

  describe('mapFromNative 往返（需求 8.4）', () => {
    it('往返还原 nativeKey 映射的字段', () => {
      const unified: UnifiedAdObject = {
        level: 'campaign',
        fields: { name: '测试', objective: 'LEADS' },
      };
      const native = mapToNative('tiktok', unified);
      expect(native.ok).toBe(true);
      if (native.ok) {
        const back = mapFromNative('tiktok', 'campaign', native.native);
        expect(back.fields).toEqual(roundTripFields('tiktok', unified));
      }
    });
  });

  describe('validatePlacement（需求 33.1、33.4、33.7）', () => {
    it('auto 且无所选版位通过', () => {
      expect(validatePlacement({ mode: 'auto' })).toEqual({
        ok: true,
        mode: 'auto',
        selectedPlacements: [],
        coerced: false,
      });
    });

    it('auto 且有所选版位拒绝', () => {
      expect(validatePlacement({ mode: 'auto', selectedPlacements: ['feed'] }).ok).toBe(false);
    });

    it('manual 且非空通过', () => {
      const result = validatePlacement({ mode: 'manual', selectedPlacements: ['feed'] });
      expect(result).toEqual({
        ok: true,
        mode: 'manual',
        selectedPlacements: ['feed'],
        coerced: false,
      });
    });

    it('manual 且空集合降级为自动版位（需求 33.4）', () => {
      const result = validatePlacement({ mode: 'manual', selectedPlacements: [] });
      expect(result).toEqual({
        ok: true,
        mode: 'auto',
        selectedPlacements: [],
        coerced: true,
      });
    });

    it('Advantage+/PMax 强制自动版位并清空所选版位（需求 33.7）', () => {
      const result = validatePlacement({
        mode: 'manual',
        selectedPlacements: ['feed', 'reels'],
        forceAuto: true,
      });
      expect(result).toEqual({
        ok: true,
        mode: 'auto',
        selectedPlacements: [],
        coerced: true,
      });
    });

    it('非法 mode 拒绝', () => {
      expect(validatePlacement({ mode: 'both' as never }).ok).toBe(false);
    });
  });

  describe('resolvePlacementsForPlatform（需求 33.5、33.6）', () => {
    it('区分受支持与不适用版位', () => {
      const result = resolvePlacementsForPlatform(
        ['feed', 'reels', 'unsupported'],
        ['feed', 'reels'],
      );
      expect(result.applied).toEqual(['feed', 'reels']);
      expect(result.notApplicable).toEqual(['unsupported']);
    });
  });
});
