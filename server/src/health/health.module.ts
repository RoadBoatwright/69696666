import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health';

/**
 * 健康检查模块（任务 1.3）。
 *
 * 基于 @nestjs/terminus 暴露 `/health` 端点，聚合 PostgreSQL（TypeORM）
 * 与 Redis/BullMQ 连接状态，提供连接失败时的可见性而非崩溃（需求 1.4）。
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator],
})
export class HealthModule {}
