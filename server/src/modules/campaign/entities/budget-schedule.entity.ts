import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { AdGroup } from './ad-group.entity';

/**
 * BUDGET_SCHEDULE —— 广告组预算/出价/排期（需求 10.1-10.7）。
 *
 * 与广告组一对一：`ad_group_id` 非空 + 外键约束。
 * - `daily_budget` / `total_budget`：numeric(12,2)，取值 0.01-999,999,999.99
 *   （应用层校验，需求 10.1）。
 * - `bidding_strategy`：出价方式，由适配器按平台支持集校验（需求 10.7、24.1）。
 * - `bidding_target_value` 可空：目标类出价（Target CPA/ROAS）的目标值。
 * - 排期结束不早于开始（应用层校验，需求 10.5）。
 *
 * 注：decimal 列经 TypeORM 取出为 string 以避免浮点精度丢失。
 */
@Entity({ name: 'budget_schedule' })
export class BudgetSchedule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'ad_group_id', type: 'uuid', unique: true })
  adGroupId!: string;

  @OneToOne(() => AdGroup, (adGroup) => adGroup.budgetSchedule, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ad_group_id' })
  adGroup!: AdGroup;

  /** 日预算，0.01-999,999,999.99（需求 10.1）。 */
  @Column({ name: 'daily_budget', type: 'numeric', precision: 12, scale: 2 })
  dailyBudget!: string;

  /** 总预算，0.01-999,999,999.99（需求 10.1）。 */
  @Column({ name: 'total_budget', type: 'numeric', precision: 12, scale: 2 })
  totalBudget!: string;

  /** 出价方式（统一出价策略枚举，由适配器按平台支持集校验，需求 10.7、24.1）。 */
  @Column({ name: 'bidding_strategy', type: 'varchar', length: 32 })
  biddingStrategy!: string;

  /** 目标类出价的目标值（如 Target CPA/ROAS），可空。 */
  @Column({
    name: 'bidding_target_value',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  biddingTargetValue!: string | null;

  @Column({ name: 'start_at', type: 'timestamptz', nullable: true })
  startAt!: Date | null;

  @Column({ name: 'end_at', type: 'timestamptz', nullable: true })
  endAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
