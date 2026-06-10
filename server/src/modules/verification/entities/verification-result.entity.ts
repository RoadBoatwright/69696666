import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Opportunity } from '../../opportunity-scoring/entities';

/** 背调结果状态取值域（需求 15.3、15.4）。 */
export type VerificationResultStatus = '背调完成' | '背调失败' | '背调不可用';

/**
 * VERIFICATION_RESULT —— Gemini 背调结果（需求 15.3、15.4、15.5）。
 *
 * - 与 {@link Opportunity} 一对一（`opportunity_id` 唯一非空外键）。
 * - 凭据缺失降级仍存储商机、背调能力标不可用（需求 15.3）。
 * - 调用失败保留原始数据、置「背调失败」并记录原因待重试（需求 15.4）。
 * - `credibility_score`：可信度评估，供分级使用（需求 16.1）。
 */
@Entity({ name: 'verification_result' })
export class VerificationResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 所属商机标识，唯一非空外键（一对一）。 */
  @Column({ name: 'opportunity_id', type: 'uuid', unique: true })
  opportunityId!: string;

  @OneToOne(() => Opportunity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'opportunity_id' })
  opportunity!: Opportunity;

  /** 背调状态（需求 15.3、15.4）。 */
  @Column({ type: 'varchar', length: 16 })
  status!: VerificationResultStatus;

  /** 可信度评估分数（需求 16.1）。 */
  @Column({
    name: 'credibility_score',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  credibilityScore!: string | null;

  /** 背调摘要。 */
  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  /** 背调失败原因，置「背调失败」时记录（需求 15.4）。 */
  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason!: string | null;

  /** 背调完成时间。 */
  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
