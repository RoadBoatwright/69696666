import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

import { RedisHealthIndicator } from './redis.health';

/**
 * 健康检查端点（任务 1.3）。
 *
 * `GET /health` 聚合 PostgreSQL 与 Redis/BullMQ 连接状态，供运维与编排
 * 系统探活。任一基础设施不可用时返回降级状态而非使应用崩溃（需求 1.4）。
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      // PostgreSQL 连接探活（1.5s 超时）。
      () => this.db.pingCheck('database', { timeout: 1_500 }),
      // Redis / BullMQ 连接探活。
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
