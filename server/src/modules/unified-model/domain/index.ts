/**
 * 统一广告模型层领域类型导出（组件 3，需求 8、10、33）。
 */
export { ACTIVE_PLATFORMS, BIDDING_STRATEGIES, isMappingFailure } from './unified-model';
export type {
  PlatformId,
  AdLevel,
  BiddingStrategy,
  Gender,
  PlacementMode,
  UnifiedAdObject,
  FieldMappingResult,
  FieldMappingFailure,
  MapToNativeResult,
  MappingErrorReason,
  MappingValidationError,
} from './unified-model';
export { FIELD_SPECS, getFieldSpecs, getFieldSpec, isActivePlatform } from './field-map';
export type { FieldSpec, FieldValidation, PlatformFieldMapping } from './field-map';
