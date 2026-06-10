import { authorize, isOverPrivilegeDenial } from './authorize.pure';
import type { Actor, ResourceRef } from '../domain/rbac';

const admin: Actor = { id: 'a-1', role: 'administrator' };
const operator: Actor = {
  id: 'o-1',
  role: 'operator',
  assignedMerchantIds: ['m-1', 'm-2'],
};
const merchant: Actor = { id: 'u-1', role: 'merchant', merchantId: 'm-1' };

describe('authorize 三角色授权纯函数（需求 7.1-7.5）', () => {
  describe('7.5 未认证', () => {
    it('actor 为空返回「未认证」', () => {
      expect(authorize(null, 'read', { type: 'opportunity', ownerMerchantId: 'm-1' })).toEqual({
        allowed: false,
        reason: '未认证',
      });
      expect(authorize(undefined, 'create', { type: 'credential' })).toEqual({
        allowed: false,
        reason: '未认证',
      });
    });
  });

  describe('7.1 管理员', () => {
    it.each<ResourceRef['type']>(['credential', 'account_pool', 'permission'])(
      '对 %s 的任意 CRUD 一律允许',
      (type) => {
        for (const action of ['create', 'read', 'update', 'delete'] as const) {
          expect(authorize(admin, action, { type })).toEqual({ allowed: true });
        }
      },
    );

    it('对非管理员域资源（广告计划/商机/素材）返回「权限不足」', () => {
      expect(authorize(admin, 'read', { type: 'campaign', ownerMerchantId: 'm-1' })).toEqual({
        allowed: false,
        reason: '权限不足',
      });
      expect(authorize(admin, 'read', { type: 'asset', ownerMerchantId: 'm-1' })).toEqual({
        allowed: false,
        reason: '权限不足',
      });
    });
  });

  describe('7.2 投手', () => {
    it('对已分配商家的广告计划与商机允许 CRUD', () => {
      expect(authorize(operator, 'update', { type: 'campaign', ownerMerchantId: 'm-1' })).toEqual({
        allowed: true,
      });
      expect(
        authorize(operator, 'delete', { type: 'opportunity', ownerMerchantId: 'm-2' }),
      ).toEqual({ allowed: true });
    });

    it('对未分配商家的广告计划与商机返回「权限不足」', () => {
      expect(authorize(operator, 'read', { type: 'campaign', ownerMerchantId: 'm-9' })).toEqual({
        allowed: false,
        reason: '权限不足',
      });
    });

    it('缺归属商家标识或越类资源返回「权限不足」', () => {
      expect(authorize(operator, 'read', { type: 'campaign' })).toEqual({
        allowed: false,
        reason: '权限不足',
      });
      expect(authorize(operator, 'read', { type: 'credential' })).toEqual({
        allowed: false,
        reason: '权限不足',
      });
    });
  });

  describe('7.3 商家', () => {
    it('对自身账户名下素材/商机/数据允许访问', () => {
      expect(authorize(merchant, 'read', { type: 'asset', ownerMerchantId: 'm-1' })).toEqual({
        allowed: true,
      });
      expect(authorize(merchant, 'read', { type: 'opportunity', ownerMerchantId: 'm-1' })).toEqual({
        allowed: true,
      });
      expect(authorize(merchant, 'read', { type: 'data', ownerMerchantId: 'm-1' })).toEqual({
        allowed: true,
      });
    });

    it('对他人账户数据返回「权限不足」（数据隔离）', () => {
      expect(authorize(merchant, 'read', { type: 'opportunity', ownerMerchantId: 'm-2' })).toEqual({
        allowed: false,
        reason: '权限不足',
      });
    });

    it('对管理员域资源返回「权限不足」', () => {
      expect(authorize(merchant, 'read', { type: 'credential' })).toEqual({
        allowed: false,
        reason: '权限不足',
      });
    });
  });

  describe('isOverPrivilegeDenial', () => {
    it('仅在「权限不足」拒绝时为真', () => {
      expect(isOverPrivilegeDenial({ allowed: false, reason: '权限不足' })).toBe(true);
      expect(isOverPrivilegeDenial({ allowed: false, reason: '未认证' })).toBe(false);
      expect(isOverPrivilegeDenial({ allowed: true })).toBe(false);
    });
  });
});
