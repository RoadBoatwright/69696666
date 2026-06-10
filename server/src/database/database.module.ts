import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import type { DatabaseConfig } from '../config/configuration';
import { buildDataSourceOptions } from './data-source-options';

/**
 * 数据库基础设施模块（任务 1.3）。
 *
 * 通过 `TypeOrmModule.forRootAsync` 从 {@link ConfigService} 读取 `database`
 * 配置项构建 PostgreSQL 连接，复用 {@link buildDataSourceOptions} 保证与
 * CLI 迁移数据源一致的连接池与迁移目录设置。
 *
 * 优雅启动校验（需求 1.4）：
 * - `retryAttempts` / `retryDelay` 让连接在数据库暂不可用时自动重试，
 *   而非立即抛错中断启动流程；
 * - `verboseRetryLog` 输出清晰的重试日志，便于在环境受限（无 DB）时定位。
 *
 * 标记为 @Global，使后续任务中各模块可直接注入仓储而无需重复导入。
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const database = configService.getOrThrow<DatabaseConfig>('database');
        return {
          ...buildDataSourceOptions(database),
          // 实体在后续任务逐步加入；开启自动加载，免去手工维护实体数组。
          autoLoadEntities: true,
          // 连接失败时重试而非崩溃启动流程（需求 1.4 优雅降级）。
          retryAttempts: 10,
          retryDelay: 3_000,
          verboseRetryLog: true,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
