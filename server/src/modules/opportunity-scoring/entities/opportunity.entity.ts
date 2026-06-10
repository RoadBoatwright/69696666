import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Lead } from '../../lead/entities';

/** 买家意向等级取值域，任一时刻唯一（需求 16.2）。 */
export type IntentLevel = 'L1' | 'L2' | 'L3' | 'L4' | '未分级';

/** 背调状态取值域（需求 15.3、15.4）。 */
export type VerificationStatus = '待背调' | '背调中' | '背调完成' | '背调失败' | '背调不可用';

/** 跟进状态机取值域，任一时刻唯一（需求 17.1）。 */
export type OpportunityFollowupStatus = '待路由' | '已触达' | '跟进中' | '路由失败';

/**
 * OPPORTUNITY —— 商机（由线索升格而来，需求 14.7、15、16、17、21.9）。
 *
 * - `lead_id`：与 {@link Lead} 一对一（需求 14.7）。
 * - `owner_merchant_id`：资产归属商家，停投不删除、越权拒绝（需求 21.9）。
 * - `source_campaign_id`：来源广告计划，配合 is_first_opportunity 供投放时长计算（需求 21）。
 * - `intent_level`：买家意向等级，任一时刻唯一（需求 16.2）。
 * - `is_qualified`：是否计入有效线索（质量校验通过，需求 14.10-14.12）。
 * - `is_first_opportunity`：是否首条商机，供投放时长计算（需求 21）。
 * - `private_domain_settled`：私域沉淀标记（需求 17）。
 * - `verification_status` / `followup_status`：背调与跟进状态。
 * - `missing_inputs`：导致无法分级的缺失项名称（需求 16.3）。
 */
@Entity({ name: 'opportunity' })
export class Opportunity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 关联线索标识，唯一非空外键（一对一，需求 14.7）。 */
  @Column({ name: 'lead_id', type: 'uuid', unique: true })
  leadId!: string;

  @OneToOne(() => Lead, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'lead_id' })
  lead!: Lead;

  /** 资产归属商家，停投不删除、越权拒绝（需求 21.9）。 */
  @Index('idx_opportunity_owner_merchant_id')
  @Column({ name: 'owner_merchant_id', type: 'uuid' })
  ownerMerchantId!: string;

  /** 来源广告计划标识，供投放时长计算（需求 21）。 */
  @Index('idx_opportunity_source_campaign_id')
  @Column({ name: 'source_campaign_id', type: 'uuid', nullable: true })
  sourceCampaignId!: string | null;

  /** 买家意向等级，任一时刻唯一，默认「未分级」（需求 16.2、16.3）。 */
  @Column({ name: 'intent_level', type: 'varchar', length: 8, default: '未分级' })
  intentLevel!: IntentLevel;

  /** 是否计入有效线索（质量校验通过，需求 14.10-14.12）。 */
  @Column({ name: 'is_qualified', type: 'boolean', default: true })
  isQualified!: boolean;

  /** 是否首条商机，供投放时长计算（需求 21）。 */
  @Column({ name: 'is_first_opportunity', type: 'boolean', default: false })
  isFirstOpportunity!: boolean;

  /** 私域沉淀标记（需求 17）。 */
  @Column({ name: 'private_domain_settled', type: 'boolean', default: false })
  privateDomainSettled!: boolean;

  /** 背调状态（需求 15.3、15.4）。 */
  @Column({
    name: 'verification_status',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  verificationStatus!: VerificationStatus | null;

  /** 跟进状态机当前状态，默认「待路由」（需求 17.1）。 */
  @Column({
    name: 'followup_status',
    type: 'varchar',
    length: 16,
    default: '待路由',
  })
  followupStatus!: OpportunityFollowupStatus;

  /** 导致无法分级的缺失项名称（需求 16.3）。 */
  @Column({ name: 'missing_inputs', type: 'jsonb', nullable: true })
  missingInputs!: unknown | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
