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

import { Opportunity } from '../../opportunity-scoring/entities';

/** 跟进路由状态机取值域，任一时刻唯一（需求 17.1）。 */
export type FollowUpStatus = '待路由' | '已触达' | '跟进中' | '路由失败';

/**
 * FOLLOWUP_RECORD —— 商机跟进路由记录（需求 17.1、17.3、17.5-17.7）。
 *
 * - `status`：跟进状态机当前状态，任一时刻唯一（需求 17.1）。
 * - `channels`：路由通道（whatsapp / crm）。
 * - `playbook`：成功路由后生成的销售跟进剧本（需求 17.5）。
 * - `failure_reason`：路由失败原因，置「路由失败」保留待重试（需求 17.7）。
 */
@Entity({ name: 'followup_record' })
export class FollowupRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 所属商机标识。 */
  @Index('idx_followup_record_opportunity_id')
  @Column({ name: 'opportunity_id', type: 'uuid' })
  opportunityId!: string;

  @ManyToOne(() => Opportunity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'opportunity_id' })
  opportunity!: Opportunity;

  /** 跟进状态机当前状态，默认「待路由」（需求 17.1）。 */
  @Column({ type: 'varchar', length: 16, default: '待路由' })
  status!: FollowUpStatus;

  /** 路由通道（whatsapp / crm）。 */
  @Column({ type: 'jsonb', nullable: true })
  channels!: unknown | null;

  /** 销售跟进剧本，成功路由后生成（需求 17.5）。 */
  @Column({ type: 'jsonb', nullable: true })
  playbook!: unknown | null;

  /** 路由失败原因，保留待重试（需求 17.7）。 */
  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;

  /** 触达时间。 */
  @Column({ name: 'reached_at', type: 'timestamptz', nullable: true })
  reachedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
