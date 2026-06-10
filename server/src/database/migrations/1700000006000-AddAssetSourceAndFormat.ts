import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 任务 13.1 —— 为 ASSET 表补充来源类型、存储引用与格式列（需求 11.1、11.2）。
 *
 * - `source_type`：成品素材来源类型记录（需求 11.1）。
 * - `storage_ref`：系统侧存储引用（对象存储路径/外部托管引用），单份失败隔离时不落库（需求 11.3）。
 * - `format`：文件格式（如 mp4/jpg/pdf），用于平台合规校验留痕（需求 11.2）。
 */
export class AddAssetSourceAndFormat1700000006000 implements MigrationInterface {
  name = 'AddAssetSourceAndFormat1700000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "asset" ADD COLUMN "source_type" character varying(32)`);
    await queryRunner.query(`ALTER TABLE "asset" ADD COLUMN "storage_ref" character varying(512)`);
    await queryRunner.query(`ALTER TABLE "asset" ADD COLUMN "format" character varying(32)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "format"`);
    await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "storage_ref"`);
    await queryRunner.query(`ALTER TABLE "asset" DROP COLUMN "source_type"`);
  }
}
