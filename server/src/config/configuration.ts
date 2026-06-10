/**
 * 应用配置加载器。
 *
 * 所有配置项（含数据库、Redis、KMS/加密）均从环境变量读取，
 * 凭据类配置项仅通过环境/配置接口注入，禁止在源码中硬编码（需求 1.6）。
 */

export interface AppConfig {
  port: number;
  env: string;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

export interface RedisConfig {
  host: string;
  port: number;
  password: string;
}

export interface EncryptionConfig {
  /** KMS 主密钥标识；为空时降级为本地对称加密（需求 1.8、19.1）。 */
  kmsKeyId: string;
  /** 本地降级模式主密钥（AES-256-GCM）。 */
  localEncryptionKey: string;
}

export interface RootConfig {
  app: AppConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  encryption: EncryptionConfig;
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export default (): RootConfig => ({
  app: {
    port: parsePort(process.env.APP_PORT, 3000),
    env: process.env.APP_ENV ?? 'development',
  },
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parsePort(process.env.DB_PORT, 5432),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'ad_integration',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parsePort(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD ?? '',
  },
  encryption: {
    kmsKeyId: process.env.KMS_KEY_ID ?? '',
    localEncryptionKey: process.env.LOCAL_ENCRYPTION_KEY ?? '',
  },
});
