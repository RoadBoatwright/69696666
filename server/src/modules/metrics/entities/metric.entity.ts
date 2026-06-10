import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Ad } from '../../campaign/entities/ad.entity';

/**
 * METRIC —— 广告指标快照（需求 13.1-13.4）。
 *
 * - 关联广告（`ad_id` 非空外键）。
 * - 指标按统一口径归一化（需求 13.4）；曝光/点击/转化为 bigint，花费/转化价值为 numeric。
 * - `roi`：字符串联合类型，花费为零时存 `not_computable`「不可计算」（需求 13.3）。
 * - `pulled_at`：拉取时间。
 */
@Entity({ name: 'metric' })
export class Metric {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 关联广告标识，非空外键。 */
  @Index('idx_metric_ad_id')
  @Column({ name: 'ad_id', type: 'uuid' })
  adId!: string;

  @ManyToOne(() => Ad, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ad_id' })
  ad!: Ad;

  /** 来源平台（meta | google | tiktok）。 */
  @Column({ type: 'varchar', length: 32 })
  platform!: string;

  @Column({ type: 'bigint', default: 0 })
  impressions!: string;

  @Column({ type: 'bigint', default: 0 })
  clicks!: string;

  @Column({ type: 'bigint', default: 0 })
  conversions!: string;

  /** 花费，numeric 承载以避免浮点精度丢失。 */
  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 })
  spend!: string;

  /** 转化价值。 */
  @Column({ name: 'conversion_value', type: 'numeric', precision: 18, scale: 2, default: 0 })
  conversionValue!: string;

  /** ROI：数值字符串或 `not_computable`（花费为零，需求 13.3）。 */
  @Column({ type: 'varchar', length: 32, nullable: true })
  roi!: string | null;

  /** 拉取时间。 */
  @Column({ name: 'pulled_at', type: 'timestamptz' })
  pulledAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
