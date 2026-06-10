import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuditLog } from './entities';
import { DataIsolationGuard } from './data-isolation.guard';
import { RbacService } from './rbac.service';

/**
 * 权限服务 RBAC（组件 15，需求 7）。
 *
 * 提供三角色授权纯函数编排（{@link RbacService}）、越权审计落库（AUDIT_LOG）与
 * 数据隔离守卫（{@link DataIsolationGuard}）——JWT 认证检查 + 三角色数据隔离 +
 * 越权审计（需求 7.1-7.6）。守卫与服务导出供接入层逐路由挂载。
 */
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [RbacService, DataIsolationGuard],
  exports: [RbacService, DataIsolationGuard],
})
export class RbacModule {}
