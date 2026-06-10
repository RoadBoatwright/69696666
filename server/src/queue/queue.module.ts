import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import type { RedisConfig } from '../config/configuration';
import { REGISTERED_QUEUE_NAMES } from './queue.constants';

/**
 * 队列基础设施模块（任务 1.3）。
 *
 * 通过 `BullModule.forRootAsync` 从 {@link ConfigService} 读取 `redis`
 * 配置项建立 BullMQ + Redis 连接，并通过 `BullModule.registerQueue`
 * 批量注册 {@link REGISTERED_QUEUE_NAMES} 中的队列，提供统一的队列注册入口。
 *
 * 本任务仅建连接与注册框架，不实现具体消费者（Processor）。
 *
 * 优雅启动校验（需求 1.4）：
 * - 连接配置 `maxRetriesPerRequest: null` 与 `retryStrategy`，使 Redis
 *   暂不可用时连接层自动重试而非中断启动流程；
 * - `enableOfflineQueue` 允许离线期间命令排队，避免启动期抛错。
 *
 * 标记为 @Global，使后续任务中各模块可直接注入队列而无需重复导入。
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redis = configService.getOrThrow<RedisConfig>('redis');
        return {
          connection: {
            host: redis.host,
            port: redis.port,
            // 仅在配置了非空密码时传入，避免向无密码 Redis 发送 AUTH。
            password: redis.password === '' ? undefined : redis.password,
            // BullMQ 要求阻塞命令的该项为 null。
            maxRetriesPerRequest: null,
            enableOfflineQueue: true,
            // Redis 暂不可用时按退避重连而非崩溃（需求 1.4 优雅降级）。
            retryStrategy: (times: number): number => Math.min(times * 1_000, 30_000),
          },
        };
      },
    }),
    // 统一批量注册队列（仅建立队列基础设施，本任务不绑定消费者）。
    BullModule.registerQueue(...REGISTERED_QUEUE_NAMES.map((name) => ({ name }))),
  ],
  exports: [BullModule],
})
export class QueueModule {}
