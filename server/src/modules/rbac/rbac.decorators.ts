import { SetMetadata } from '@nestjs/common';

import type { Action, ResourceType } from './domain/rbac';

/** 元数据键：受保护资源声明（供 {@link DataIsolationGuard} 读取）。 */
export const RBAC_RESOURCE_KEY = 'rbac:resource';

/** 元数据键：公开路由标记（跳过认证与隔离校验）。 */
export const RBAC_PUBLIC_KEY = 'rbac:public';

/**
 * 受保护资源声明，描述路由所操作的资源类型、动作与从请求中提取归属商家标识的位置。
 */
export interface RbacResourceMeta {
  /** 资源类型（需求 7.1、7.2、7.3）。 */
  type: ResourceType;
  /** CRUD 动作。 */
  action: Action;
  /**
   * 归属商家标识在请求中的来源：从 params/query/body 的哪个字段读取（需求 7.2、7.3）。
   * 管理员域资源（凭据/账户池/权限）无归属商家时可省略。
   */
  ownerMerchantIdFrom?: { source: 'params' | 'query' | 'body'; field: string };
  /** 资源标识在请求 params 中的字段名（用于审计，需求 7.6）。默认 `id`。 */
  resourceIdParam?: string;
}

/**
 * 声明路由受 RBAC 数据隔离守卫保护及其资源元数据（需求 7.2、7.3、7.4）。
 */
export const RbacResource = (meta: RbacResourceMeta) => SetMetadata(RBAC_RESOURCE_KEY, meta);

/** 标记路由为公开，跳过 RBAC 认证与隔离校验。 */
export const RbacPublic = () => SetMetadata(RBAC_PUBLIC_KEY, true);
