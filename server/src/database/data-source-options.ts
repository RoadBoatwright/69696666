import { join } from 'node:path';

import type { DataSourceOptions } from 'typeorm';

import type { DatabaseConfig } from '../config/configuration';
import { AdAsset, Asset } from '../modules/asset/entities';
import { AccountAuthorization, TokenRecord } from '../modules/auth-center/entities';
import { Ad, AdGroup, BudgetSchedule, Campaign, Targeting } from '../modules/campaign/entities';
import { CampaignDraft } from '../modules/campaign-draft/entities';
import { ReviewModeConfig } from '../modules/campaign-draft/entities';
import { PlatformCredential } from '../modules/credential/entities';
import { BuyerReplyEvent, FollowupRecord } from '../modules/followup-routing/entities';
import { Lead, LeadForm } from '../modules/lead/entities';
import {
  ConversionConfig,
  ConversionEvent,
  Metric,
  ReviewStatus,
} from '../modules/metrics/entities';
import { LevelChangeRecord, Opportunity } from '../modules/opportunity-scoring/entities';
import { AuditLog } from '../modules/rbac/entities';
import { VerificationResult, VerifiedField } from '../modules/verification/entities';

/**
 * 由 {@link DatabaseConfig} 构建 TypeORM PostgreSQL 连接选项。
 *
 * 该纯函数同时被运行时（{@link DatabaseModule} 经 ConfigService）与
 * CLI 迁移数据源（{@link file://./data-source.ts}）复用，保证两处连接、
 * 连接池与迁移目录配置一致。
 *
 * 设计要点：
 * - 显式配置连接池（max/min/超时），避免默认值在生产下连接耗尽。
 * - `migrations` 指向编译后与源码两种路径，使开发态（ts-node）与
 *   生产态（dist）均可定位迁移脚本。
 * - `synchronize` 恒为 false：schema 变更一律走迁移脚本（任务 2 起）。
 * - `autoLoadEntities` 由运行时模块开启，本任务实体集合先留空。
 */
export function buildDataSourceOptions(database: DatabaseConfig): DataSourceOptions {
  return {
    type: 'postgres',
    host: database.host,
    port: database.port,
    username: database.username,
    password: database.password,
    database: database.database,
    // schema 变更仅经迁移脚本，禁止自动同步（保护既有数据）。
    synchronize: false,
    // 迁移脚本目录：编译产物（dist）与源码（ts-node 开发态）双路径。
    migrations: [join(__dirname, 'migrations', '*.{js,ts}')],
    migrationsTableName: 'schema_migrations',
    // 核心广告对象实体集合（任务 2.1、2.2）。
    entities: [
      // 三级广告结构与定向/预算/素材（任务 2.1）
      Campaign,
      AdGroup,
      Ad,
      Targeting,
      BudgetSchedule,
      Asset,
      AdAsset,
      LeadForm,
      // 凭据/授权/令牌与线索/指标/转化/审核/审计（任务 2.2）
      PlatformCredential,
      AccountAuthorization,
      TokenRecord,
      Lead,
      Metric,
      ConversionConfig,
      ConversionEvent,
      ReviewStatus,
      AuditLog,
      // 草案/商机/背调/跟进/分级闭环（任务 2.2 补全）
      CampaignDraft,
      ReviewModeConfig,
      Opportunity,
      LevelChangeRecord,
      VerificationResult,
      VerifiedField,
      FollowupRecord,
      BuyerReplyEvent,
    ],
    // 连接池配置：上限 10、下限 2，获取连接 30s 超时，空闲 10s 回收。
    extra: {
      max: 10,
      min: 2,
      connectionTimeoutMillis: 30_000,
      idleTimeoutMillis: 10_000,
    },
  };
}
