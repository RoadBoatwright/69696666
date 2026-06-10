import type { Repository } from 'typeorm';

import { AuditLog } from './entities/audit-log.entity';
import { RbacService } from './rbac.service';
import type { Actor } from './domain/rbac';

/** 内存版 AUDIT_LOG 仓储桩。 */
function makeAuditRepo(): {
  repo: Repository<AuditLog>;
  rows: AuditLog[];
} {
  const rows: AuditLog[] = [];
  let seq = 0;
  const repo = {
    create: (e: Partial<AuditLog>) => ({ ...e }) as AuditLog,
    save: async (e: AuditLog) => {
      if (!e.id) {
        e.id = `audit-${++seq}`;
      }
      rows.push({ ...e });
      return e;
    },
  } as unknown as Repository<AuditLog>;
  return { repo, rows };
}

const operator: Actor = { id: 'o-1', role: 'operator', assignedMerchantIds: ['m-1'] };

describe('RbacService（组件 15，需求 7.4、7.5、7.6）', () => {
  it('authorize 转发纯函数决策（需求 7.2）', () => {
    const { repo } = makeAuditRepo();
    const service = new RbacService(repo);
    expect(
      service.authorize(operator, 'read', { type: 'campaign', ownerMerchantId: 'm-1' }),
    ).toEqual({ allowed: true });
  });

  it('audit 写入含角色/资源/精确到秒时间的审计记录（需求 7.6）', async () => {
    const { repo, rows } = makeAuditRepo();
    const service = new RbacService(repo);
    const at = new Date('2025-01-01T12:34:56.789Z');
    await service.audit(operator, 'update', { type: 'campaign', resourceId: 'camp-9' }, at);

    expect(rows).toHaveLength(1);
    expect(rows[0].actorRole).toBe('operator');
    expect(rows[0].actorId).toBe('o-1');
    expect(rows[0].resourceId).toBe('camp-9');
    expect(rows[0].action).toBe('update');
    // 精确到秒：毫秒分量被抹去（需求 7.6）。
    expect(rows[0].occurredAt.getTime() % 1000).toBe(0);
    expect(rows[0].occurredAt.toISOString()).toBe('2025-01-01T12:34:56.000Z');
  });

  describe('enforce 授权 + 越权审计（需求 7.4、7.5、7.6）', () => {
    it('越权（权限不足）：返回拒绝并写审计，无数据副作用', async () => {
      const { repo, rows } = makeAuditRepo();
      const service = new RbacService(repo);
      const decision = await service.enforce(operator, 'delete', {
        type: 'campaign',
        ownerMerchantId: 'm-9',
        resourceId: 'camp-x',
      });
      expect(decision).toEqual({ allowed: false, reason: '权限不足' });
      expect(rows).toHaveLength(1);
      expect(rows[0].resourceId).toBe('camp-x');
    });

    it('允许：通过且不写审计', async () => {
      const { repo, rows } = makeAuditRepo();
      const service = new RbacService(repo);
      const decision = await service.enforce(operator, 'read', {
        type: 'campaign',
        ownerMerchantId: 'm-1',
      });
      expect(decision).toEqual({ allowed: true });
      expect(rows).toHaveLength(0);
    });

    it('未认证：返回「未认证」且不写审计（需求 7.5）', async () => {
      const { repo, rows } = makeAuditRepo();
      const service = new RbacService(repo);
      const decision = await service.enforce(null, 'read', {
        type: 'opportunity',
        ownerMerchantId: 'm-1',
      });
      expect(decision).toEqual({ allowed: false, reason: '未认证' });
      expect(rows).toHaveLength(0);
    });

    it('审计写入失败不抛出，决策仍正常返回（容错）', async () => {
      const failingRepo = {
        create: (e: Partial<AuditLog>) => ({ ...e }) as AuditLog,
        save: async () => {
          throw new Error('db down');
        },
      } as unknown as Repository<AuditLog>;
      const service = new RbacService(failingRepo);
      const decision = await service.enforce(operator, 'delete', {
        type: 'campaign',
        ownerMerchantId: 'm-9',
      });
      expect(decision).toEqual({ allowed: false, reason: '权限不足' });
    });
  });
});
