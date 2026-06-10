import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { AdGroup } from './ad-group.entity';

/**
 * 广告投放状态机取值（需求 11.1）。
 * 投放编排在任务 11 实现，此处先定义持久化取值域。
 */
export type CampaignPublishStatus = '未提交' | '提交中' | '已提交' | '投放失败' | '投放超时';

/**
 * CAMPAIGN —— 统一广告模型三级结构的顶层「广告系列」（需求 6.1、7.1）。
 *
 * - 归属某 Merchant（`merchant_id`），由其拥有。
 * - 名称长度 1-255（应用层校验，列长度上限 255）。
 * - `publish_status` 承载投放状态机（需求 11.1）。
 * - `first_published_at`：精确到秒的首次投放成功时间，仅首次写入、后续不覆盖，
 *   供「投放到首条商机时长」指标计算（需求 45.1）。
 */
@Entity({ name: 'campaign' })
export class Campaign {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_campaign_merchant_id')
  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId!: string;

  /** 广告系列名称，长度 1-255（应用层校验，需求 7.1）。 */
  @Column({ type: 'varchar', length: 255 })
  name!: string;

  /** 投放目标（需求 7.1）。 */
  @Column({ type: 'varchar', length: 64 })
  objective!: string;

  /** 所属平台（meta | google | tiktok）。 */
  @Column({ type: 'varchar', length: 32 })
  platform!: string;

  /** 投放状态机当前状态（需求 11.1），默认「未提交」。 */
  @Column({
    name: 'publish_status',
    type: 'varchar',
    length: 16,
    default: '未提交',
  })
  publishStatus!: CampaignPublishStatus;

  /** 平台返回的对象标识，投放成功后写入。 */
  @Column({
    name: 'platform_object_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  platformObjectId!: string | null;

  /**
   * 首次投放成功时间（精确到秒），仅首次写入不覆盖（需求 45.1）。
   * 供投放到首条商机时长指标计算。
   */
  @Column({
    name: 'first_published_at',
    type: 'timestamptz',
    nullable: true,
  })
  firstPublishedAt!: Date | null;

  @OneToMany(() => AdGroup, (adGroup) => adGroup.campaign)
  adGroups!: AdGroup[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
