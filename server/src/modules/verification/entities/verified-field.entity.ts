import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { VerificationResult } from './verification-result.entity';

/** 可背调字段取值域（需求 15.5）。 */
export type VerifiableField = 'companyName' | 'phone' | 'email' | 'industry' | 'jobTitle';

/**
 * VERIFIED_FIELD —— 背调字段比对结果（需求 15.5）。
 *
 * 冲突字段同时保留原始值与背调值并标 conflict + needs_review（需求 15.5）；
 * 一致或单侧不标记。
 */
@Entity({ name: 'verified_field' })
export class VerifiedField {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 所属背调结果标识。 */
  @Index('idx_verified_field_verification_result_id')
  @Column({ name: 'verification_result_id', type: 'uuid' })
  verificationResultId!: string;

  @ManyToOne(() => VerificationResult, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'verification_result_id' })
  verificationResult!: VerificationResult;

  /** 字段名（需求 15.5）。 */
  @Column({ type: 'varchar', length: 32 })
  field!: VerifiableField;

  /** 原始留资值，冲突时保留（需求 15.5）。 */
  @Column({ name: 'original_value', type: 'text', nullable: true })
  originalValue!: string | null;

  /** 背调返回值，冲突时保留（需求 15.5）。 */
  @Column({ name: 'verified_value', type: 'text', nullable: true })
  verifiedValue!: string | null;

  /** 是否冲突（需求 15.5）。 */
  @Column({ type: 'boolean', default: false })
  conflict!: boolean;

  /** 是否待核实，冲突时为真（需求 15.5）。 */
  @Column({ name: 'needs_review', type: 'boolean', default: false })
  needsReview!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
