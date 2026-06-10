import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Actor, ResourceRef } from './domain/rbac';
import { RBAC_PUBLIC_KEY, RBAC_RESOURCE_KEY, type RbacResourceMeta } from './rbac.decorators';
import { RbacService } from './rbac.service';

/**
 * 数据隔离守卫（组件 15，需求 7.4、7.5、7.6）。
 *
 * 在 NestJS 请求管线上强制执行：
 *  1. JWT 认证检查：请求未携带已认证主体（`request.user`）→ 抛 401「未认证」（需求 7.5）。
 *  2. 数据隔离：依据路由 {@link RbacResource} 声明的资源类型/动作与从请求提取的归属商家
 *     标识，调用 {@link RbacService.enforce} 做三角色授权；越权 → 抛 403「权限不足」，
 *     且不放行至控制器（目标数据状态不变，需求 7.4）。
 *  3. 越权审计：越权拒绝由 {@link RbacService.enforce} 写入含角色/资源/精确到秒时间的
 *     审计记录（需求 7.6）。
 *
 * 上游认证中间件负责验证 JWT 并将解析出的 {@link Actor} 挂到 `request.user`；本守卫只认
 * 已解析的主体，未携带即视为未认证。未声明 {@link RbacResource} 的路由仅做认证检查。
 */
@Injectable()
export class DataIsolationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(RBAC_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: Actor;
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
    }>();

    // 1) 未认证拦截（需求 7.5）。
    const actor = request.user;
    if (!actor) {
      throw new UnauthorizedException('未认证');
    }

    const meta = this.reflector.getAllAndOverride<RbacResourceMeta>(RBAC_RESOURCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // 仅认证、未声明资源隔离的路由直接放行。
    if (!meta) {
      return true;
    }

    // 2) 构造资源引用并执行授权 + 越权审计（需求 7.2、7.3、7.4、7.6）。
    const resource: ResourceRef = {
      type: meta.type,
      resourceId: readField(request, 'params', meta.resourceIdParam ?? 'id'),
      ownerMerchantId: meta.ownerMerchantIdFrom
        ? readField(request, meta.ownerMerchantIdFrom.source, meta.ownerMerchantIdFrom.field)
        : undefined,
    };

    const decision = await this.rbac.enforce(actor, meta.action, resource);
    if (!decision.allowed) {
      // 未认证已在上方拦截，此处恒为「权限不足」（需求 7.4）。
      throw new ForbiddenException(decision.reason);
    }
    return true;
  }
}

/** 从请求的指定位置读取字符串字段。 */
function readField(
  request: {
    params?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
  },
  source: 'params' | 'query' | 'body',
  field: string,
): string | undefined {
  const bag = request[source];
  const value = bag?.[field];
  return typeof value === 'string' ? value : undefined;
}
