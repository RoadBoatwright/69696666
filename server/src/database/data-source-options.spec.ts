import { join } from 'node:path';

import type { DatabaseConfig } from '../config/configuration';
import { buildDataSourceOptions } from './data-source-options';

describe('buildDataSourceOptions', () => {
  const sample: DatabaseConfig = {
    host: 'db.example.com',
    port: 5433,
    username: 'app_user',
    password: 's3cret',
    database: 'ad_integration',
  };

  it('应将数据库配置映射为 PostgreSQL 连接选项', () => {
    const options = buildDataSourceOptions(sample);

    expect(options.type).toBe('postgres');
    expect(options).toMatchObject({
      host: 'db.example.com',
      port: 5433,
      username: 'app_user',
      password: 's3cret',
      database: 'ad_integration',
    });
  });

  it('应禁用 synchronize，schema 变更仅经迁移脚本', () => {
    expect(buildDataSourceOptions(sample).synchronize).toBe(false);
  });

  it('应指向 migrations 目录并使用独立的迁移记录表', () => {
    const options = buildDataSourceOptions(sample);

    expect(options.migrationsTableName).toBe('schema_migrations');
    const expectedGlob = join(__dirname, 'migrations', '*.{js,ts}');
    expect(options.migrations).toEqual([expectedGlob]);
  });

  it('应注册任务 2.1 的核心广告对象实体', () => {
    const entities = buildDataSourceOptions(sample).entities ?? [];

    const entityNames = (entities as Array<{ name: string }>).map((e) => e.name);
    expect(entityNames).toEqual(
      expect.arrayContaining([
        'Campaign',
        'AdGroup',
        'Ad',
        'Targeting',
        'BudgetSchedule',
        'Asset',
        'AdAsset',
        'LeadForm',
      ]),
    );
  });

  it('应配置连接池上下限与超时', () => {
    const options = buildDataSourceOptions(sample);

    expect(options.extra).toEqual({
      max: 10,
      min: 2,
      connectionTimeoutMillis: 30_000,
      idleTimeoutMillis: 10_000,
    });
  });
});
