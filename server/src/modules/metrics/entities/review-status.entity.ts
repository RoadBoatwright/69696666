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

/** 审核状态归一化三态取值域（需求 16.2）。 */
export type AdReviewStatus = '审核中' | '审核通过' | '审核被拒绝';

/**
 * REVIEW_STATUS —— 广告审核状态（需求 16.1-16.3）。
 *
 * - 关联广告（`ad_id` 非空外键）。
 * - `status`：归一化为三态「审核中|审核通过|审核被拒绝」（需求 16.2）。
 * - `reject_reason`：被拒绝原因。
 * - `pulled_at`：拉取时间；拉取失败时保留上次状态（需求 16.4）。
 */
@Entity({ name: 'review_status' })
export class ReviewStatus {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 关联广告标识，非空外键。 */
  @Index('idx_review_status_ad_id')
  @Column({ name: 'ad_id', type: 'uuid' })
  adId!: string;

  @ManyToOne(() => Ad, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ad_id' })
  ad!: Ad;

  /** 归一化审核状态三态（需求 16.2）。 */
  @Column({ type: 'varchar', length: 16 })
  status!: AdReviewStatus;

  /** 审核被拒绝原因。 */
  @Column({ name: 'reject_reason', type: 'text', nullable: true })
  rejectReason!: string | null;

  /** 拉取时间。 */
  @Column({ name: 'pulled_at', type: 'timestamptz' })
  pulledAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
