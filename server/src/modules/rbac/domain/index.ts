/**
 * RBAC 领域类型导出（组件 15，需求 7）。
 */
export type {
  Role,
  Action,
  ResourceType,
  Actor,
  ResourceRef,
  DenyReason,
  AuthorizationDecision,
} from './rbac';
export {
  ADMINISTRATOR_RESOURCE_TYPES,
  OPERATOR_RESOURCE_TYPES,
  MERCHANT_RESOURCE_TYPES,
} from './rbac';
