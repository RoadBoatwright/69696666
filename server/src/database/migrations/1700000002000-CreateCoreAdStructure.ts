import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 任务 2.1 —— 创建三级广告结构与定向/预算/素材核心表。
 *
 * 覆盖需求 6.1、7.1、7.2、7.3：
 * - 三级结构 CAMPAIGN → AD_GROUP → AD，子级到父级外键非空（NOT NULL）+ 外键约束，
 *   保证每个子级有且仅有一个父级。
 * - TARGETING / BUDGET_SCHEDULE 与广告组一对一（ad_group_id 唯一非空外键）。
 * - ASSET / AD_ASSET（复合主键 + 双非空外键）/ LEAD_FORM。
 * - CAMPAIGN.first_published_at：精确到秒首次投放成功时间记录点（需求 45.1）。
 *
 * 命名带时间戳前缀（1700000002000）保证迁移按顺序执行，排在工程骨架之后。
 */
export class CreateCoreAdStructure1700000002000 implements MigrationInterface {
  name = 'CreateCoreAdStructure1700000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // pgcrypto 提供 gen_random_uuid()，用于 uuid 主键默认值。
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // CAMPAIGN —— 三级结构顶层（需求 7.1、45.1）。
    await queryRunner.query(`
      CREATE TABLE "campaign" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "merchant_id" uuid NOT NULL,
        "name" character varying(255) NOT NULL,
        "objective" character varying(64) NOT NULL,
        "platform" character varying(32) NOT NULL,
        "publish_status" character varying(16) NOT NULL DEFAULT '未提交',
        "platform_object_id" character varying(255),
        "first_published_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_campaign" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_campaign_merchant_id" ON "campaign" ("merchant_id")`,
    );

    // AD_GROUP —— 中间层；campaign_id 非空外键（需求 6.1、7.2）。版位字段为需求 47 预留。
    await queryRunner.query(`
      CREATE TABLE "ad_group" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "campaign_id" uuid NOT NULL,
        "placement_mode" character varying(16),
        "selected_placements" jsonb,
        "not_applicable_placements" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ad_group" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ad_group_campaign" FOREIGN KEY ("campaign_id")
          REFERENCES "campaign" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_ad_group_campaign_id" ON "ad_group" ("campaign_id")`,
    );

    // AD —— 最底层；ad_group_id 非空外键（需求 6.1、7.3）。
    await queryRunner.query(`
      CREATE TABLE "ad" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ad_group_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ad" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ad_ad_group" FOREIGN KEY ("ad_group_id")
          REFERENCES "ad_group" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_ad_ad_group_id" ON "ad" ("ad_group_id")`);

    // TARGETING —— 与广告组一对一（ad_group_id 唯一非空外键，需求 8.1、8.2、8.4）。
    await queryRunner.query(`
      CREATE TABLE "targeting" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ad_group_id" uuid NOT NULL,
        "geo" jsonb,
        "industry" jsonb,
        "job_role" jsonb,
        "age_min" integer,
        "age_max" integer,
        "gender" character varying(8),
        "interests" jsonb,
        "behaviors" jsonb,
        "custom_audiences" jsonb,
        "lookalike_audiences" jsonb,
        "not_applicable_dims" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_targeting" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_targeting_ad_group" UNIQUE ("ad_group_id"),
        CONSTRAINT "FK_targeting_ad_group" FOREIGN KEY ("ad_group_id")
          REFERENCES "ad_group" ("id") ON DELETE CASCADE
      )
    `);

    // BUDGET_SCHEDULE —— 与广告组一对一；预算 numeric(12,2)（需求 10.1-10.7、24.1）。
    await queryRunner.query(`
      CREATE TABLE "budget_schedule" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ad_group_id" uuid NOT NULL,
        "daily_budget" numeric(12,2) NOT NULL,
        "total_budget" numeric(12,2) NOT NULL,
        "bidding_strategy" character varying(32) NOT NULL,
        "bidding_target_value" numeric(12,2),
        "start_at" TIMESTAMP WITH TIME ZONE,
        "end_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_budget_schedule" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_budget_schedule_ad_group" UNIQUE ("ad_group_id"),
        CONSTRAINT "FK_budget_schedule_ad_group" FOREIGN KEY ("ad_group_id")
          REFERENCES "ad_group" ("id") ON DELETE CASCADE
      )
    `);

    // ASSET —— 商家素材（需求 9.1）。
    await queryRunner.query(`
      CREATE TABLE "asset" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "merchant_id" uuid NOT NULL,
        "type" character varying(16) NOT NULL,
        "size_bytes" bigint NOT NULL,
        "carousel_children" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_asset" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_asset_merchant_id" ON "asset" ("merchant_id")`);

    // AD_ASSET —— 广告↔素材引用关系；复合主键 + 双非空外键（需求 9.4、9.5、9.7）。
    // 素材侧 ON DELETE RESTRICT：被引用素材不可删除（需求 9.7）。
    await queryRunner.query(`
      CREATE TABLE "ad_asset" (
        "ad_id" uuid NOT NULL,
        "asset_id" uuid NOT NULL,
        "platform_ref" character varying(255),
        "ref_status" character varying(32),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ad_asset" PRIMARY KEY ("ad_id", "asset_id"),
        CONSTRAINT "FK_ad_asset_ad" FOREIGN KEY ("ad_id")
          REFERENCES "ad" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ad_asset_asset" FOREIGN KEY ("asset_id")
          REFERENCES "asset" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_ad_asset_ad_id" ON "ad_asset" ("ad_id")`);
    await queryRunner.query(`CREATE INDEX "idx_ad_asset_asset_id" ON "ad_asset" ("asset_id")`);

    // LEAD_FORM —— 广告挂载的线索表单（需求 12.1）。
    await queryRunner.query(`
      CREATE TABLE "lead_form" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ad_id" uuid NOT NULL,
        "fields" jsonb NOT NULL,
        "status" character varying(16),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lead_form" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lead_form_ad" FOREIGN KEY ("ad_id")
          REFERENCES "ad" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_lead_form_ad_id" ON "lead_form" ("ad_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 逆序删除以满足外键依赖。
    await queryRunner.query(`DROP TABLE "lead_form"`);
    await queryRunner.query(`DROP TABLE "ad_asset"`);
    await queryRunner.query(`DROP TABLE "asset"`);
    await queryRunner.query(`DROP TABLE "budget_schedule"`);
    await queryRunner.query(`DROP TABLE "targeting"`);
    await queryRunner.query(`DROP TABLE "ad"`);
    await queryRunner.query(`DROP TABLE "ad_group"`);
    await queryRunner.query(`DROP TABLE "campaign"`);
  }
}
