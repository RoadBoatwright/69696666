import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 任务 5.5/5.9 —— 为 TOKEN_RECORD 增加 last_failure_at 列。
 *
 * 覆盖需求 5.5、2.6、4.3：连续刷新失败达阈值或授权失效错误时，
 * 记录精确到秒的失败时间。
 */
export class AddTokenRecordLastFailureAt1700000004000 implements MigrationInterface {
  name = 'AddTokenRecordLastFailureAt1700000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "token_record" ADD COLUMN "last_failure_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "token_record" DROP COLUMN "last_failure_at"`);
  }
}
