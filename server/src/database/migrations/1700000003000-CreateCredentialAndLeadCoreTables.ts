import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 任务 2.2 —— 创建凭据/授权/令牌与线索/指标/转化/审核/审计核心表。
 *
 * 覆盖需求 1.2、5.1、12.5、12.6、19.1：
 * - PLATFORM_CREDENTIAL（encrypted_values 加密列；config_status 二态）。
 * - ACCOUNT_AUTHORIZATION / TOKEN_RECORD（令牌加密列、status、连续刷新失败计数、
 *   上次使用时间、有效期；一对一）。
 * - LEAD（platform_lead_id + source_platform 唯一索引去重、collected_at 精确到秒）。
 * - METRIC / CONVERSION_CONFIG / CONVERSION_EVENT / REVIEW_STATUS / AUDIT_LOG。
 * - 所有凭据/令牌敏感字段为 bytea 加密列，绝不落明文（需求 19.1）。
 *
 * 排在 1700000002000-CreateCoreAdStructure 之后（依赖 campaign / ad / lead_form）。
 */
export class CreateCredentialAndLeadCoreTables1700000003000 implements MigrationInterface {
  name = 'CreateCredentialAndLeadCoreTables1700000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // PLATFORM_CREDENTIAL —— 凭据配置；encrypted_values 加密列绝不落明文（需求 1.2、19.1）。
    await queryRunner.query(`
      CREATE TABLE "platform_credential" (
        "platform" character varying(32) NOT NULL,
        "config_status" character varying(16) NOT NULL DEFAULT 'unfilled',
        "encrypted_values" bytea,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_credential" PRIMARY KEY ("platform")
      )
    `);

    // ACCOUNT_AUTHORIZATION —— 代客户账户授权（需求 2.1、2.2、5.1）。
    await queryRunner.query(`
      CREATE TABLE "account_authorization" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "platform" character varying(32) NOT NULL,
        "merchant_id" uuid NOT NULL,
        "auth_status" character varying(16) NOT NULL DEFAULT '未授权',
        "scopes" jsonb,
        "auth_model_meta" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_account_authorization" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_account_authorization_platform" ON "account_authorization" ("platform")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_account_authorization_merchant_id" ON "account_authorization" ("merchant_id")`,
    );

    // TOKEN_RECORD —— 令牌记录；令牌加密列、status、失败计数、上次使用时间、有效期（需求 5.1、19.1）。
    // account_id 唯一非空外键，与授权一对一。
    await queryRunner.query(`
      CREATE TABLE "token_record" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "account_id" uuid NOT NULL,
        "status" character varying(16) NOT NULL,
        "encrypted_access_token" bytea,
        "encrypted_refresh_token" bytea,
        "access_token_expire_at" TIMESTAMP WITH TIME ZONE,
        "refresh_token_expire_at" TIMESTAMP WITH TIME ZONE,
        "last_used_at" TIMESTAMP WITH TIME ZONE,
        "consecutive_refresh_failures" integer NOT NULL DEFAULT 0,
        "last_warning_sent_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_token_record" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_token_record_account" UNIQUE ("account_id"),
        CONSTRAINT "FK_token_record_account" FOREIGN KEY ("account_id")
          REFERENCES "account_authorization" ("id") ON DELETE CASCADE
      )
    `);

    // LEAD —— 回流线索；source_platform + platform_lead_id 唯一索引去重（需求 12.5、12.6）。
    await queryRunner.query(`
      CREATE TABLE "lead" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "lead_form_id" uuid,
        "source_platform" character varying(32) NOT NULL,
        "source_ad_id" character varying(255),
        "platform_lead_id" character varying(255) NOT NULL,
        "collected_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "raw_data" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lead" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lead_lead_form" FOREIGN KEY ("lead_form_id")
          REFERENCES "lead_form" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_lead_lead_form_id" ON "lead" ("lead_form_id")`);
    // 去重唯一索引：同一来源平台 + 平台线索标识仅一条（需求 12.6）。
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_lead_source_platform_lead_id" ON "lead" ("source_platform", "platform_lead_id")`,
    );

    // METRIC —— 广告指标快照；roi 为数值或 not_computable（需求 13.3、13.4）。
    await queryRunner.query(`
      CREATE TABLE "metric" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ad_id" uuid NOT NULL,
        "platform" character varying(32) NOT NULL,
        "impressions" bigint NOT NULL DEFAULT 0,
        "clicks" bigint NOT NULL DEFAULT 0,
        "conversions" bigint NOT NULL DEFAULT 0,
        "spend" numeric(18,2) NOT NULL DEFAULT 0,
        "conversion_value" numeric(18,2) NOT NULL DEFAULT 0,
        "roi" character varying(32),
        "pulled_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_metric" PRIMARY KEY ("id"),
        CONSTRAINT "FK_metric_ad" FOREIGN KEY ("ad_id")
          REFERENCES "ad" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_metric_ad_id" ON "metric" ("ad_id")`);

    // CONVERSION_CONFIG —— 转化追踪配置（需求 14.1-14.3）。
    await queryRunner.query(`
      CREATE TABLE "conversion_config" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "campaign_id" uuid NOT NULL,
        "mechanism" character varying(16) NOT NULL,
        "event_defs" jsonb,
        "status" character varying(16),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversion_config" PRIMARY KEY ("id"),
        CONSTRAINT "FK_conversion_config_campaign" FOREIGN KEY ("campaign_id")
          REFERENCES "campaign" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_conversion_config_campaign_id" ON "conversion_config" ("campaign_id")`,
    );

    // CONVERSION_EVENT —— 转化事件；ad_id 可空（空=未匹配，需求 14.6）。
    await queryRunner.query(`
      CREATE TABLE "conversion_event" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "platform_event_id" character varying(255) NOT NULL,
        "conversion_config_id" uuid,
        "ad_id" uuid,
        "match_status" character varying(16) NOT NULL,
        "raw_data" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_conversion_event" PRIMARY KEY ("id"),
        CONSTRAINT "FK_conversion_event_config" FOREIGN KEY ("conversion_config_id")
          REFERENCES "conversion_config" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_conversion_event_ad" FOREIGN KEY ("ad_id")
          REFERENCES "ad" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_conversion_event_platform_event_id" ON "conversion_event" ("platform_event_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_conversion_event_ad_id" ON "conversion_event" ("ad_id")`,
    );

    // REVIEW_STATUS —— 广告审核状态；归一化三态（需求 16.1-16.3）。
    await queryRunner.query(`
      CREATE TABLE "review_status" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ad_id" uuid NOT NULL,
        "status" character varying(16) NOT NULL,
        "reject_reason" text,
        "pulled_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_review_status" PRIMARY KEY ("id"),
        CONSTRAINT "FK_review_status_ad" FOREIGN KEY ("ad_id")
          REFERENCES "ad" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_review_status_ad_id" ON "review_status" ("ad_id")`);

    // AUDIT_LOG —— 审计日志；越权尝试含主体、资源、精确到秒时间（需求 18.6）。
    await queryRunner.query(`
      CREATE TABLE "audit_log" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "actor_role" character varying(32) NOT NULL,
        "actor_id" character varying(255),
        "resource_id" character varying(255),
        "action" character varying(64) NOT NULL,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        CONSTRAINT "PK_audit_log" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_audit_log_occurred_at" ON "audit_log" ("occurred_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 逆序删除以满足外键依赖。
    await queryRunner.query(`DROP TABLE "audit_log"`);
    await queryRunner.query(`DROP TABLE "review_status"`);
    await queryRunner.query(`DROP TABLE "conversion_event"`);
    await queryRunner.query(`DROP TABLE "conversion_config"`);
    await queryRunner.query(`DROP TABLE "metric"`);
    await queryRunner.query(`DROP TABLE "lead"`);
    await queryRunner.query(`DROP TABLE "token_record"`);
    await queryRunner.query(`DROP TABLE "account_authorization"`);
    await queryRunner.query(`DROP TABLE "platform_credential"`);
  }
}
