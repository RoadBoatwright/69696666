/**
 * 权限服务 RBAC 公共导出（组件 15，需求 7）。
 */
export { RbacModule } from './rbac.module';
export { RbacService } from './rbac.service';
export { DataIsolationGuard } from './data-isolation.guard';
export {
  RbacResource,
  RbacPublic,
  RBAC_RESOURCE_KEY,
  RBAC_PUBLIC_KEY,
  type RbacResourceMeta,
} from './rbac.decorators';
export { authorize, isOverPrivilegeDenial } from './pure';
export type {
  Role,
  Action,
  ResourceType,
  Actor,
  ResourceRef,
  DenyReason,
  AuthorizationDecision,
} from './domain';
