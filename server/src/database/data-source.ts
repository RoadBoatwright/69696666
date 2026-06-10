import 'reflect-metadata';

import { DataSource } from 'typeorm';

import configuration from '../config/configuration';
import { buildDataSourceOptions } from './data-source-options';

/**
 * TypeORM CLI 迁移数据源。
 *
 * 供 `typeorm migration:generate` / `migration:run` / `migration:revert`
 * 等 CLI 命令使用。配置从环境变量经 {@link configuration} 读取，
 * 与运行时 {@link DatabaseModule} 复用同一份连接/迁移目录定义，
 * 避免开发态与生产态配置漂移。
 *
 * 注意：本文件被 TypeORM CLI 以 ts-node 直接加载，不参与 Nest 依赖注入。
 */
const { database } = configuration();

// TypeORM CLI 要求数据源文件「有且仅有一个 DataSource 导出」，
// 因此此处仅保留具名导出，不再额外提供默认导出（否则 migration:run/generate 报错）。
export const AppDataSource = new DataSource(buildDataSourceOptions(database));
