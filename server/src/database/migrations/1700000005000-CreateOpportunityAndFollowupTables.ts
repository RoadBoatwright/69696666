import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 任务 2.2（补全）—— 创建草案/商机/背调/跟进/分级闭环核心表，并为 LEAD 增加质量校验列。
 *
 * 覆盖需求 1.2、5.1、6.1、9.2、14.5、15.2、16.2、17.1、21.9：
 * - CAMPAIGN_DRAFT（confirm_status 待确认|已确认；platform_drafts jsonb；persona_source，需求 9.2）。
 * - OPPORTUNITY（lead_id 一对一、owner_merchant_id 资产归属、source_campaign_id、
 *   intent_level L1-L4|未分级、is_qualified/is_first_opportunity/private_domain_settled、
 *   verification_status、followup_status、missing_inputs，需求 16.2、17.1、21.9）。
 * - VERIFICATION_RESULT / VERIFIED_FIELD（背调结果与字段比对，需求 15.2、15.5）。
 * - FOLLOWUP_RECORD / LEVEL_CHANGE_RECORD / BUYER_REPLY_EVENT（跟进/等级轨迹/回复，需求 17.1、16.6、21.6）。
 * - LEAD 增加 quality_status / is_valid_lead / enterprise_identity / quality_flags（需求 14.9-14.12）。
 *
 * 排在 1700000004000 之后；依赖 1700000002000（campaign、lead_form）与
 * 1700000003000（lead）已创建的表。所有敏感凭据/令牌列已在 1700000003000 以 bytea 加密列建立。
 */
export class CreateOpportunityAndFollowupTables1700000005000 implements MigrationInterface {
  name = 'CreateOpportunityAndFollowupTables1700000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // LEAD —— 增加留资质量校验与反作弊分类列（需求 14.9-14.12）。
    await queryRunner.query(`
      ALTER TABLE "lead"
        ADD COLUMN "quality_status" character varying(16),
        ADD COLUMN "is_valid_lead" boolean NOT NULL DEFAULT true,
        ADD COLUMN "enterprise_identity" character varying(32),
        ADD COLUMN "quality_flags" jsonb
    `);

    // CAMPAIGN_DRAFT —— AI 辅助建广告草案；confirm_status 状态机（需求 9.2、9.5）。
    await queryRunner.query(`
      CREATE TABLE "campaign_draft" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "merchant_id" uuid NOT NULL,
        "confirm_status" character varying(16) NOT NULL DEFAULT '待确认',
        "platform_drafts" jsonb,
        "persona_source" character varying(16),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_campaign_draft" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_campaign_draft_merchant_id" ON "campaign_draft" ("merchant_id")`,
    );

    // OPPORTUNITY —— 商机；lead_id 一对一、owner_merchant_id 资产归属（需求 16.2、17.1、21.9）。
    await queryRunner.query(`
      CREATE TABLE "opportunity" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "lead_id" uuid NOT NULL,
        "owner_merchant_id" uuid NOT NULL,
        "source_campaign_id" uuid,
        "intent_level" character varying(8) NOT NULL DEFAULT '未分级',
        "is_qualified" boolean NOT NULL DEFAULT true,
        "is_first_opportunity" boolean NOT NULL DEFAULT false,
        "private_domain_settled" boolean NOT NULL DEFAULT false,
        "verification_status" character varying(16),
        "followup_status" character varying(16) NOT NULL DEFAULT '待路由',
        "missing_inputs" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_opportunity" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_opportunity_lead" UNIQUE ("lead_id"),
        CONSTRAINT "FK_opportunity_lead" FOREIGN KEY ("lead_id")
          REFERENCES "lead" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_opportunity_source_campaign" FOREIGN KEY ("source_campaign_id")
          REFERENCES "campaign" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_opportunity_owner_merchant_id" ON "opportunity" ("owner_merchant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_opportunity_source_campaign_id" ON "opportunity" ("source_campaign_id")`,
    );

    // VERIFICATION_RESULT —— Gemini 背调结果；与商机一对一（需求 15.2、15.3、15.4）。
    await queryRunner.query(`
      CREATE TABLE "verification_result" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "opportunity_id" uuid NOT NULL,
        "status" character varying(16) NOT NULL,
        "credibility_score" numeric(5,2),
        "summary" text,
        "failure_reason" text,
        "verified_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_verification_result" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_verification_result_opportunity" UNIQUE ("opportunity_id"),
        CONSTRAINT "FK_verification_result_opportunity" FOREIGN KEY ("opportunity_id")
          REFERENCES "opportunity" ("id") ON DELETE CASCADE
      )
    `);

    // VERIFIED_FIELD —— 背调字段比对；冲突同时保留两值并标待核实（需求 15.5）。
    await queryRunner.query(`
      CREATE TABLE "verified_field" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "verification_result_id" uuid NOT NULL,
        "field" character varying(32) NOT NULL,
        "original_value" text,
        "verified_value" text,
        "conflict" boolean NOT NULL DEFAULT false,
        "needs_review" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_verified_field" PRIMARY KEY ("id"),
        CONSTRAINT "FK_verified_field_result" FOREIGN KEY ("verification_result_id")
          REFERENCES "verification_result" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_verified_field_verification_result_id" ON "verified_field" ("verification_result_id")`,
    );

    // FOLLOWUP_RECORD —— 跟进路由记录；状态机四态（需求 17.1、17.5-17.7）。
    await queryRunner.query(`
      CREATE TABLE "followup_record" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "opportunity_id" uuid NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT '待路由',
        "channels" jsonb,
        "playbook" jsonb,
        "failure_reason" text,
        "reached_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_followup_record" PRIMARY KEY ("id"),
        CONSTRAINT "FK_followup_record_opportunity" FOREIGN KEY ("opportunity_id")
          REFERENCES "opportunity" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_followup_record_opportunity_id" ON "followup_record" ("opportunity_id")`,
    );

    // LEVEL_CHANGE_RECORD —— 意向等级变更轨迹；含旧/新等级与精确到秒时间（需求 16.6）。
    await queryRunner.query(`
      CREATE TABLE "level_change_record" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "opportunity_id" uuid NOT NULL,
        "before_level" character varying(8),
        "after_level" character varying(8) NOT NULL,
        "changed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_level_change_record" PRIMARY KEY ("id"),
        CONSTRAINT "FK_level_change_record_opportunity" FOREIGN KEY ("opportunity_id")
          REFERENCES "opportunity" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_level_change_record_opportunity_id" ON "level_change_record" ("opportunity_id")`,
    );

    // BUYER_REPLY_EVENT —— 买家回复事件；供有效联络率判定（需求 21.6）。
    await queryRunner.query(`
      CREATE TABLE "buyer_reply_event" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "opportunity_id" uuid NOT NULL,
        "channel" character varying(16) NOT NULL,
        "replied_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_buyer_reply_event" PRIMARY KEY ("id"),
        CONSTRAINT "FK_buyer_reply_event_opportunity" FOREIGN KEY ("opportunity_id")
          REFERENCES "opportunity" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_buyer_reply_event_opportunity_id" ON "buyer_reply_event" ("opportunity_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 逆序删除以满足外键依赖。
    await queryRunner.query(`DROP TABLE "buyer_reply_event"`);
    await queryRunner.query(`DROP TABLE "level_change_record"`);
    await queryRunner.query(`DROP TABLE "followup_record"`);
    await queryRunner.query(`DROP TABLE "verified_field"`);
    await queryRunner.query(`DROP TABLE "verification_result"`);
    await queryRunner.query(`DROP TABLE "opportunity"`);
    await queryRunner.query(`DROP TABLE "campaign_draft"`);
    await queryRunner.query(`
      ALTER TABLE "lead"
        DROP COLUMN "quality_flags",
        DROP COLUMN "enterprise_identity",
        DROP COLUMN "is_valid_lead",
        DROP COLUMN "quality_status"
    `);
  }
}
