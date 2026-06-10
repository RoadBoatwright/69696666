import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Ad } from './ad.entity';
import { BudgetSchedule } from './budget-schedule.entity';
import { Campaign } from './campaign.entity';
import { Targeting } from './targeting.entity';

/**
 * AD_GROUP —— 三级结构中间层「广告组」（需求 6.1、7.2）。
 *
 * 父级唯一约束：每个广告组有且仅有一个父级广告系列，
 * `campaign_id` 非空（NOT NULL）+ 外键约束（需求 6.1）。
 *
 * 版位字段（placement_mode / selected_placements / not_applicable_placements，
 * 需求 47）随核心 ER 图一并建立基础结构，完整版位编排逻辑留待任务 46.1。
 */
@Entity({ name: 'ad_group' })
export class AdGroup {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 父级广告系列标识，非空（需求 6.1：子级有且仅有一个父级）。 */
  @Index('idx_ad_group_campaign_id')
  @Column({ name: 'campaign_id', type: 'uuid' })
  campaignId!: string;

  @ManyToOne(() => Campaign, (campaign) => campaign.adGroups, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'campaign_id' })
  campaign!: Campaign;

  /**
   * 版位配置方式：auto | manual，二选一唯一；
   * 空集合/Advantage+/PMax 时强制 auto（需求 47.1、47.4、47.7）。
   * 基础结构预留，完整逻辑见任务 46.1。
   */
  @Column({
    name: 'placement_mode',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  placementMode!: string | null;

  /** 手动版位下用户所选版位集合，自动版位时为空（需求 47.3）。预留。 */
  @Column({ name: 'selected_placements', type: 'jsonb', nullable: true })
  selectedPlacements!: unknown | null;

  /**
   * 目标平台不支持的所选版位标记，含版位名称与平台标识
   * （复用需求 6.4/8.4 不适用机制，需求 47.5）。预留。
   */
  @Column({
    name: 'not_applicable_placements',
    type: 'jsonb',
    nullable: true,
  })
  notApplicablePlacements!: unknown | null;

  @OneToMany(() => Ad, (ad) => ad.adGroup)
  ads!: Ad[];

  @OneToOne(() => Targeting, (targeting) => targeting.adGroup)
  targeting!: Targeting;

  @OneToOne(() => BudgetSchedule, (budgetSchedule) => budgetSchedule.adGroup)
  budgetSchedule!: BudgetSchedule;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
