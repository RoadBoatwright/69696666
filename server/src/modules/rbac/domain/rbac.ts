/**
 * 多角色权限领域类型（组件 15，需求 7）。
 *
 * 平台无关的 RBAC 领域定义，被 {@link authorize} 纯函数、RBAC 服务与数据隔离守卫共用。
 *
 * 三角色分工（需求 7.1、7.2、7.3）：
 *  - 系统管理员（administrator）：管理平台凭据、账户池与角色权限。
 *  - 平台投手（operator）：仅访问已分配给其负责商家的广告计划与商机。
 *  - 外贸商家客户（merchant）：仅访问其自身账户名下的产品素材、商机与数据。
 */

/** 三类角色标识（需求 7.1、7.2、7.3）。 */
export type Role = 'merchant' | 'operator' | 'administrator';

/** CRUD 动作（需求 7.1：创建、查看、修改或删除）。 */
export type Action = 'create' | 'read' | 'update' | 'delete';

/**
 * 受 RBAC 约束的资源类型。
 *
 * 按角色职责范围归类：
 *  - 管理员域：`credential`（平台凭据）、`account_pool`（账户池）、`permission`（角色权限）。
 *  - 投手/商家域：`campaign`（广告计划）、`opportunity`（商机）、`asset`（产品素材）、`data`（账户数据）。
 */
export type ResourceType =
  | 'credential'
  | 'account_pool'
  | 'permission'
  | 'campaign'
  | 'opportunity'
  | 'asset'
  | 'data';

/**
 * 已认证操作主体（需求 7.5：未认证由守卫拦截，授权纯函数以 `null` 表达未认证）。
 */
export interface Actor {
  /** 主体唯一标识（用于审计，需求 7.6）。 */
  id: string;
  /** 主体角色。 */
  role: Role;
  /** 商家主体自身账户标识（仅 merchant 角色，需求 7.3）。 */
  merchantId?: string;
  /** 投手被分配负责的商家标识集合（仅 operator 角色，需求 7.2）。 */
  assignedMerchantIds?: string[];
}

/**
 * 资源引用：授权决策的目标对象。
 *
 * `ownerMerchantId` 标识资源归属的商家，用于投手「仅分配商家」与商家「仅自身」隔离判定
 * （需求 7.2、7.3）；管理员域资源（凭据/账户池/权限）无归属商家。
 */
export interface ResourceRef {
  /** 资源类型。 */
  type: ResourceType;
  /** 资源标识（用于审计，需求 7.6）。 */
  resourceId?: string;
  /** 资源归属商家标识（投手/商家域资源必填，需求 7.2、7.3）。 */
  ownerMerchantId?: string;
}

/** 授权拒绝原因（需求 7.4、7.5）。 */
export type DenyReason = '权限不足' | '未认证';

/** 授权决策结果（需求 7.1-7.5）。 */
export type AuthorizationDecision = { allowed: true } | { allowed: false; reason: DenyReason };

/** 管理员职责范围内的资源类型（需求 7.1）。 */
export const ADMINISTRATOR_RESOURCE_TYPES: ReadonlySet<ResourceType> = new Set([
  'credential',
  'account_pool',
  'permission',
]);

/** 投手职责范围内的资源类型（需求 7.2）。 */
export const OPERATOR_RESOURCE_TYPES: ReadonlySet<ResourceType> = new Set([
  'campaign',
  'opportunity',
]);

/** 商家职责范围内的资源类型（需求 7.3）。 */
export const MERCHANT_RESOURCE_TYPES: ReadonlySet<ResourceType> = new Set([
  'asset',
  'opportunity',
  'data',
]);
