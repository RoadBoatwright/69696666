import { Injectable } from '@nestjs/common';

import {
  hasUniqueParent,
  mapFromNative,
  mapToNative,
  resolvePlacementsForPlatform,
  validatePlacement,
  type PlacementConfig,
  type PlacementValidation,
} from './pure/mapping.pure';
import type {
  AdLevel,
  MapToNativeResult,
  PlatformId,
  UnifiedAdObject,
} from './domain/unified-model';

/**
 * 统一广告模型层服务（组件 3，需求 8、10、33）。
 *
 * 对应用服务层暴露统一↔原生字段映射、父级唯一校验、默认值/不适用标记与
 * 版位（自动/手动二选一）校验。核心逻辑均委派至 {@link ./pure/mapping.pure}
 * 纯函数，保证可被属性测试覆盖（Property 11/12/13/14/51）。
 */
@Injectable()
export class UnifiedModelService {
  /** 统一对象 → 平台原生字段映射（需求 8.4、8.5、8.7、10.4）。 */
  mapToNative(platform: PlatformId, unified: UnifiedAdObject): MapToNativeResult {
    return mapToNative(platform, unified);
  }

  /** 平台原生字段 → 统一对象映射（需求 8.4）。 */
  mapFromNative(
    platform: PlatformId,
    level: AdLevel,
    native: Record<string, unknown>,
    parentId?: string,
  ): UnifiedAdObject {
    return mapFromNative(platform, level, native, parentId);
  }

  /** 校验三级结构父级唯一性（需求 8.1）。 */
  hasUniqueParent(obj: UnifiedAdObject): boolean {
    return hasUniqueParent(obj);
  }

  /** 校验版位配置二选一不变量（需求 33.1、33.4、33.7）。 */
  validatePlacement(config: PlacementConfig): PlacementValidation {
    return validatePlacement(config);
  }

  /** 在目标平台解析手动所选版位，区分受支持与不适用（需求 33.5、33.6）。 */
  resolvePlacementsForPlatform(
    selected: readonly string[],
    supported: readonly string[],
  ): { applied: string[]; notApplicable: string[] } {
    return resolvePlacementsForPlatform(selected, supported);
  }
}
