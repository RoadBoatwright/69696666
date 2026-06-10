import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 任务 14.10 —— 人工审核模式两级配置表 REVIEW_MODE_CONFIG（需求 9.3、9.4）。
 *
 * - `scope`：作用域键，主键。`__global__` 表示全局默认；其余值为商家标识（单商家覆盖）。
 * - `mode`：生效档位（全自动 / 专家把关）。默认关闭即全自动档（需求 9.4）。
 *
 * 解析规则（应用层）：单商家未覆盖时采用全局默认；同一商家任一时刻有且仅有一个生效档位。
 */
export class CreateReviewModeConfig1700000007000 implements MigrationInterface {
  name = 'CreateReviewModeConfig1700000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "review_mode_config" (
        "scope" character varying(64) NOT NULL,
        "mode" character varying(16) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_review_mode_config" PRIMARY KEY ("scope")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "review_mode_config"`);
  }
}
