import fc from 'fast-check';

import { authorize, isOverPrivilegeDenial } from './authorize.pure';
import {
  ADMINISTRATOR_RESOURCE_TYPES,
  MERCHANT_RESOURCE_TYPES,
  OPERATOR_RESOURCE_TYPES,
  type Action,
  type Actor,
  type ResourceRef,
  type ResourceType,
  type Role,
} from '../domain/rbac';

/**
 * 三角色授权纯函数属性测试（组件 15，需求 7、21.10）。
 *
 * 覆盖 Property 49（RBAC 授权决策不变量：管理员对凭据/账户池/权限允许、投手仅其分配商家、
 * 商家仅自身、否则拒绝）与 Property 50（越权拒绝返回「权限不足」、纯函数无副作用且不返回
 * 资产数据，含非自身商机资产隔离）。最少 100 次迭代（numRuns: 200）。
 */

const ALL_ACTIONS: readonly Action[] = ['create', 'read', 'update', 'delete'];
const ALL_ROLES: readonly Role[] = ['merchant', 'operator', 'administrator'];
const ALL_RESOURCE_TYPES: readonly ResourceType[] = [
  'credential',
  'account_pool',
  'permission',
  'campaign',
  'opportunity',
  'asset',
  'data',
];

const arbAction: fc.Arbitrary<Action> = fc.constantFrom(...ALL_ACTIONS);
const arbResourceType: fc.Arbitrary<ResourceType> = fc.constantFrom(...ALL_RESOURCE_TYPES);

/** 商家标识取自小集合，提升「分配命中/未命中」「自身/他人」组合的覆盖率。 */
const arbMerchantId: fc.Arbitrary<string> = fc.constantFrom('m1', 'm2', 'm3', 'm4');

/** 生成任意角色的操作主体（含投手分配集合、商家自身标识，可能缺省以覆盖防御分支）。 */
const arbActor: fc.Arbitrary<Actor> = fc
  .record({
    id: fc.string({ minLength: 1, maxLength: 8 }),
    role: fc.constantFrom(...ALL_ROLES),
    merchantId: fc.option(arbMerchantId, { nil: undefined }),
    assignedMerchantIds: fc.option(fc.array(arbMerchantId, { maxLength: 4 }), { nil: undefined }),
  })
  .map(({ id, role, merchantId, assignedMerchantIds }) => ({
    id,
    role,
    merchantId,
    assignedMerchantIds,
  }));

/** 生成任意资源引用（归属商家可能缺省以覆盖「无归属」拒绝分支）。 */
const arbResource: fc.Arbitrary<ResourceRef> = fc
  .record({
    type: arbResourceType,
    resourceId: fc.option(fc.string({ minLength: 1, maxLength: 8 }), { nil: undefined }),
    ownerMerchantId: fc.option(arbMerchantId, { nil: undefined }),
  })
  .map(({ type, resourceId, ownerMerchantId }) => ({ type, resourceId, ownerMerchantId }));

/** 依据需求 7.1-7.3 的规格独立重算期望决策（不复用被测实现）。 */
function expectedAllowed(actor: Actor, resource: ResourceRef): boolean {
  switch (actor.role) {
    case 'administrator':
      return ADMINISTRATOR_RESOURCE_TYPES.has(resource.type);
    case 'operator': {
      if (!OPERATOR_RESOURCE_TYPES.has(resource.type)) {
        return false;
      }
      const owner = resource.ownerMerchantId;
      return !!owner && (actor.assignedMerchantIds ?? []).includes(owner);
    }
    case 'merchant': {
      if (!MERCHANT_RESOURCE_TYPES.has(resource.type)) {
        return false;
      }
      const owner = resource.ownerMerchantId;
      return !!owner && !!actor.merchantId && owner === actor.merchantId;
    }
    default:
      return false;
  }
}

describe('三角色授权纯函数属性测试（fast-check）', () => {
  // Feature: multi-platform-ad-integration, Property 49
  // Property 49: RBAC 授权决策不变量
  // Validates: Requirements 7.1, 7.2, 7.3
  it('Property 49: 管理员对凭据/账户池/权限允许、投手仅分配商家、商家仅自身、否则拒绝', () => {
    fc.assert(
      fc.property(arbActor, arbAction, arbResource, (actor, action, resource) => {
        const decision = authorize(actor, action, resource);
        const allowed = expectedAllowed(actor, resource);

        expect(decision.allowed).toBe(allowed);
        if (decision.allowed) {
          // 允许决策不携带拒绝原因。
          expect(decision).toEqual({ allowed: true });
        } else {
          // 已认证主体的拒绝一律为「权限不足」（需求 7.4）。
          expect(decision.reason).toBe('权限不足');
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 49
  // Property 49: RBAC 授权决策不变量（投手分配命中专项）
  // Validates: Requirements 7.2
  it('Property 49: 投手对其已分配商家的广告计划/商机允许、未分配则拒绝', () => {
    const arbOperator = fc.record({
      id: fc.string({ minLength: 1, maxLength: 8 }),
      assignedMerchantIds: fc.array(arbMerchantId, { maxLength: 4 }),
    });
    fc.assert(
      fc.property(
        arbOperator,
        arbAction,
        fc.constantFrom<ResourceType>('campaign', 'opportunity'),
        arbMerchantId,
        (op, action, type, owner) => {
          const actor: Actor = {
            id: op.id,
            role: 'operator',
            assignedMerchantIds: op.assignedMerchantIds,
          };
          const decision = authorize(actor, action, { type, ownerMerchantId: owner });
          expect(decision.allowed).toBe(op.assignedMerchantIds.includes(owner));
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 50
  // Property 50: 越权拒绝无副作用 / 商机资产隔离
  // Validates: Requirements 7.4, 21.10
  it('Property 50: 任意越权请求返回「权限不足」、不改资源、不返回资产数据', () => {
    fc.assert(
      fc.property(arbActor, arbAction, arbResource, (actor, action, resource) => {
        // 仅考察越权（按规格应被拒绝）的请求。
        fc.pre(!expectedAllowed(actor, resource));

        // 冻结输入快照，校验纯函数不修改 actor/resource（无副作用，需求 7.4）。
        const actorSnapshot = JSON.parse(JSON.stringify(actor));
        const resourceSnapshot = JSON.parse(JSON.stringify(resource));

        const decision = authorize(actor, action, resource);

        // 拒绝且原因为「权限不足」（需求 7.4、21.10）。
        expect(decision.allowed).toBe(false);
        if (!decision.allowed) {
          expect(decision.reason).toBe('权限不足');
        }
        expect(isOverPrivilegeDenial(decision)).toBe(true);

        // 决策对象不携带任何资产/资源数据，仅含 allowed + reason（不返回资产数据，需求 21.10）。
        expect(Object.keys(decision).sort()).toEqual(['allowed', 'reason']);

        // 输入对象未被修改（目标数据状态不变，需求 7.4）。
        expect(actor).toEqual(actorSnapshot);
        expect(resource).toEqual(resourceSnapshot);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: multi-platform-ad-integration, Property 50
  // Property 50: 商机资产隔离（访问非自身商机一律拒绝）
  // Validates: Requirements 7.4, 21.10
  it('Property 50: 商家/投手访问非自身归属的商机资产被拒绝且不返回数据', () => {
    const arbAccessor = fc.oneof(
      // 商家访问他人商机/素材/数据。
      fc.record({
        actor: fc
          .record({ id: fc.string({ minLength: 1, maxLength: 8 }), merchantId: arbMerchantId })
          .map(({ id, merchantId }) => ({ id, role: 'merchant' as const, merchantId })),
        owner: arbMerchantId,
        type: fc.constantFrom<ResourceType>('opportunity', 'asset', 'data'),
      }),
      // 投手访问未分配商家的商机/广告计划。
      fc.record({
        actor: fc
          .record({
            id: fc.string({ minLength: 1, maxLength: 8 }),
            assignedMerchantIds: fc.array(arbMerchantId, { maxLength: 3 }),
          })
          .map(({ id, assignedMerchantIds }) => ({
            id,
            role: 'operator' as const,
            assignedMerchantIds,
          })),
        owner: arbMerchantId,
        type: fc.constantFrom<ResourceType>('opportunity', 'campaign'),
      }),
    );

    fc.assert(
      fc.property(arbAccessor, arbAction, ({ actor, owner, type }, action) => {
        const isOwnAccess =
          actor.role === 'merchant'
            ? actor.merchantId === owner
            : (actor.assignedMerchantIds ?? []).includes(owner);
        // 仅考察非自身/未分配的越权访问。
        fc.pre(!isOwnAccess);

        const decision = authorize(actor, action, { type, ownerMerchantId: owner });

        expect(decision.allowed).toBe(false);
        if (!decision.allowed) {
          expect(decision.reason).toBe('权限不足');
        }
        expect(Object.keys(decision).sort()).toEqual(['allowed', 'reason']);
      }),
      { numRuns: 200 },
    );
  });
});
