import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuditLog } from './entities/audit-log.entity';
import type { Action, Actor, AuthorizationDecision, ResourceRef } from './domain/rbac';
import { authorize, isOverPrivilegeDenial } from './pure/authorize.pure';

/**
 * 权限服务（组件 15，需求 7）。
 *
 * 编排三角色授权纯函数 {@link authorize}（管理员/投手/商家）与越权审计落库：
 *  - {@link authorize}：纯函数决策，无副作用——越权拒绝时目标数据状态不变（需求 7.4）。
 *  - {@link RbacService.audit}：将越权访问尝试以含角色标识、目标资源标识与精确到秒
 *    时间的审计记录写入 AUDIT_LOG（需求 7.6）。
 *  - {@link RbacService.enforce}：授权 + 越权自动审计的组合入口，供数据隔离守卫调用。
 */
@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  /**
   * 三角色授权决策（纯函数转发，需求 7.1、7.2、7.3、7.4、7.5）。
   *
   * 不产生任何副作用：仅返回允许/拒绝决策，越权时不执行任何创建/修改/删除（需求 7.4）。
   */
  authorize(
    actor: Actor | null | undefined,
    action: Action,
    resource: ResourceRef,
  ): AuthorizationDecision {
    return authorize(actor, action, resource);
  }

  /**
   * 记录越权访问尝试的审计记录（需求 7.6）。
   *
   * 写入主体角色标识、目标资源标识与精确到秒的发生时间。审计写入失败不抛出到调用方，
   * 仅记录告警，避免审计故障掩盖原始的拒绝语义。
   */
  async audit(
    actor: Actor,
    action: Action,
    resource: ResourceRef,
    at: Date = new Date(),
  ): Promise<void> {
    try {
      await this.auditRepo.save(
        this.auditRepo.create({
          actorRole: actor.role,
          actorId: actor.id ?? null,
          resourceId: resource.resourceId ?? null,
          action,
          // 精确到秒（需求 7.6）：抹去毫秒分量。
          occurredAt: truncateToSecond(at),
        }),
      );
    } catch (error) {
      this.logger.warn(`越权审计记录写入失败：${describeError(error)}`);
    }
  }

  /**
   * 授权并在越权时自动审计的组合入口（需求 7.4、7.5、7.6）。
   *
   * - 未认证 →「未认证」决策，不写审计（无可记录的主体）。
   * - 越权（权限不足）→「权限不足」决策，并写入越权审计记录（需求 7.6）。
   * - 允许 → 通过，不写审计。
   *
   * 始终为纯决策叠加审计副作用，绝不在拒绝路径上修改目标数据（需求 7.4）。
   */
  async enforce(
    actor: Actor | null | undefined,
    action: Action,
    resource: ResourceRef,
    at: Date = new Date(),
  ): Promise<AuthorizationDecision> {
    const decision = authorize(actor, action, resource);
    if (actor && isOverPrivilegeDenial(decision)) {
      await this.audit(actor, action, resource, at);
    }
    return decision;
  }
}

/** 抹去毫秒，使时间精确到秒（需求 7.6）。 */
function truncateToSecond(at: Date): Date {
  return new Date(Math.floor(at.getTime() / 1000) * 1000);
}

/** 提取错误原因文本（不含敏感明文）。 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
