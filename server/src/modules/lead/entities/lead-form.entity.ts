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

import { Ad } from '../../campaign/entities/ad.entity';

/** 表单关联状态取值域（需求 12）。 */
export type LeadFormStatus = '已关联' | '关联失败';

/**
 * LEAD_FORM —— 广告挂载的线索表单（需求 12.1）。
 *
 * 与广告关联：`ad_id` 非空 + 外键约束。
 * - `fields`：字段定义集合，数量 1-30，每项可标必填/选填（应用层校验，需求 12.1）。
 * - `status`：「已关联|关联失败」。
 */
@Entity({ name: 'lead_form' })
export class LeadForm {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_lead_form_ad_id')
  @Column({ name: 'ad_id', type: 'uuid' })
  adId!: string;

  @ManyToOne(() => Ad, (ad) => ad.leadForms, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ad_id' })
  ad!: Ad;

  /** 表单字段定义，数量 1-30，含必填/选填标记（应用层校验，需求 12.1）。 */
  @Column({ type: 'jsonb' })
  fields!: unknown;

  /** 表单关联状态：「已关联|关联失败」。 */
  @Column({ type: 'varchar', length: 16, nullable: true })
  status!: LeadFormStatus | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
