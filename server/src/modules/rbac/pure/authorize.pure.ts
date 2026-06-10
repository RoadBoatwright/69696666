/**
 * 三角色授权纯函数库（组件 15，需求 7.1、7.2、7.3、7.4、7.5）。
 *
 * 无副作用，仅依据 `actor` 与 `resource` 推导唯一的允许/拒绝决策，使授权不变量
 * （Property 49/50）可被属性测试覆盖。任何越权拒绝在纯函数层不产生副作用——
 * 数据保持不变（需求 7.4）、审计记录由服务侧在拒绝后另行写入（需求 7.6）。
 */
import {
  type Action,
  type Actor,
  type AuthorizationDecision,
  ADMINISTRATOR_RESOURCE_TYPES,
  MERCHANT_RESOURCE_TYPES,
  OPERATOR_RESOURCE_TYPES,
  type ResourceRef,
} from '../domain/rbac';

/** 允许决策常量。 */
const ALLOW: AuthorizationDecision = { allowed: true };

/** 权限不足拒绝决策常量（需求 7.4）。 */
const DENY_INSUFFICIENT: AuthorizationDecision = { allowed: false, reason: '权限不足' };

/** 未认证拒绝决策常量（需求 7.5）。 */
const DENY_UNAUTHENTICATED: AuthorizationDecision = { allowed: false, reason: '未认证' };

/**
 * 三角色授权决策核心纯函数（需求 7.1、7.2、7.3、7.4、7.5）。
 *
 * 判定规则（保证输出唯一）：
 *  1. `actor` 为空（未认证）→「未认证」（需求 7.5）。
 *  2. 管理员：对凭据/账户池/角色权限的任意 CRUD 一律允许；对其余资源类型「权限不足」（需求 7.1）。
 *  3. 投手：仅对「已分配给其负责商家」的广告计划与商机允许 CRUD；未分配商家或越类资源
 *     「权限不足」（需求 7.2）。
 *  4. 商家：仅对其「自身账户名下」的产品素材、商机与数据允许访问；他人账户或越类资源
 *     「权限不足」（需求 7.3）。
 *
 * 任何超出权限范围的访问返回「权限不足」且不产生副作用（需求 7.4）。
 */
export function authorize(
  actor: Actor | null | undefined,
  _action: Action,
  resource: ResourceRef,
): AuthorizationDecision {
  // 1) 未认证（需求 7.5）。
  if (!actor) {
    return DENY_UNAUTHENTICATED;
  }

  switch (actor.role) {
    case 'administrator':
      // 2) 管理员：仅管凭据/账户池/角色权限（需求 7.1）。
      return ADMINISTRATOR_RESOURCE_TYPES.has(resource.type) ? ALLOW : DENY_INSUFFICIENT;

    case 'operator': {
      // 3) 投手：仅已分配商家的广告计划与商机（需求 7.2）。
      if (!OPERATOR_RESOURCE_TYPES.has(resource.type)) {
        return DENY_INSUFFICIENT;
      }
      const owner = resource.ownerMerchantId;
      if (!owner) {
        return DENY_INSUFFICIENT;
      }
      const assigned = actor.assignedMerchantIds ?? [];
      return assigned.includes(owner) ? ALLOW : DENY_INSUFFICIENT;
    }

    case 'merchant': {
      // 4) 商家：仅自身账户名下素材/商机/数据（需求 7.3）。
      if (!MERCHANT_RESOURCE_TYPES.has(resource.type)) {
        return DENY_INSUFFICIENT;
      }
      const owner = resource.ownerMerchantId;
      if (!owner || !actor.merchantId) {
        return DENY_INSUFFICIENT;
      }
      return owner === actor.merchantId ? ALLOW : DENY_INSUFFICIENT;
    }

    default:
      // 未知角色一律拒绝（防御性，需求 7.4）。
      return DENY_INSUFFICIENT;
  }
}

/** 决策是否为越权（权限不足）拒绝——服务侧据此触发审计记录（需求 7.6）。 */
export function isOverPrivilegeDenial(decision: AuthorizationDecision): boolean {
  return !decision.allowed && decision.reason === '权限不足';
}
