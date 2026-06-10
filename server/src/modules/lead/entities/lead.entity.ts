import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { LeadForm } from './lead-form.entity';

/**
 * LEAD —— 回流线索（需求 12.5、12.6）。
 *
 * 去重键：`platform_lead_id` + `source_platform` 唯一索引，
 * 同一来源平台同一平台线索标识仅保留最早 `collected_at` 记录（需求 12.6）。
 *
 * - `lead_form_id`：关联回流来源表单（可空，部分平台轮询拉取场景）。
 * - `collected_at`：采集时间，精确到秒（需求 12.5）。
 * - `raw_data`：原始留资数据，回流/处理失败时保留以待重试（需求 12.7）。
 */
@Entity({ name: 'lead' })
@Index('uq_lead_source_platform_lead_id', ['sourcePlatform', 'platformLeadId'], {
  unique: true,
})
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 关联回流来源表单，可空（部分平台轮询拉取无表单关联）。 */
  @Index('idx_lead_lead_form_id')
  @Column({ name: 'lead_form_id', type: 'uuid', nullable: true })
  leadFormId!: string | null;

  @ManyToOne(() => LeadForm, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'lead_form_id' })
  leadForm!: LeadForm | null;

  /** 来源平台（去重键之一，需求 12.6）。 */
  @Column({ name: 'source_platform', type: 'varchar', length: 32 })
  sourcePlatform!: string;

  /** 来源广告标识。 */
  @Column({ name: 'source_ad_id', type: 'varchar', length: 255, nullable: true })
  sourceAdId!: string | null;

  /** 平台线索标识（去重键之一，需求 12.6）。 */
  @Column({ name: 'platform_lead_id', type: 'varchar', length: 255 })
  platformLeadId!: string;

  /** 采集时间，精确到秒；去重时保留最早记录（需求 12.5、12.6）。 */
  @Column({ name: 'collected_at', type: 'timestamptz' })
  collectedAt!: Date;

  /** 原始留资数据，回流失败时保留以待重试（需求 12.7）。 */
  @Column({ name: 'raw_data', type: 'jsonb', nullable: true })
  rawData!: unknown | null;

  /**
   * 留资质量分类：格式/有效性与反作弊判定结果（需求 14.9-14.11）。
   * 取值如「高质量」「低质量/疑似无效」「疑似作弊」；命中后者不计入有效线索。
   */
  @Column({ name: 'quality_status', type: 'varchar', length: 16, nullable: true })
  qualityStatus!: string | null;

  /** 是否计入有效线索：质量校验通过为真，低质量/疑似作弊为假（需求 14.10、14.11）。 */
  @Column({ name: 'is_valid_lead', type: 'boolean', default: true })
  isValidLead!: boolean;

  /** 企业身份初判：如「疑似真实企业」「疑似个人/免费邮箱」，供背调与分级使用（需求 14.12）。 */
  @Column({ name: 'enterprise_identity', type: 'varchar', length: 32, nullable: true })
  enterpriseIdentity!: string | null;

  /** 质量校验/反作弊命中明细，区分存储以供追溯（需求 14.10、14.11）。 */
  @Column({ name: 'quality_flags', type: 'jsonb', nullable: true })
  qualityFlags!: unknown | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
