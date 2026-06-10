import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 草案确认状态机取值域，新草案恒「待确认」（需求 9.2、9.5）。 */
export type DraftConfirmStatus = '待确认' | '已确认';

/** 买家画像来源标记（需求 9.1）。 */
export type PersonaSource = 'AI自动推导' | '人工指定';

/**
 * CAMPAIGN_DRAFT —— AI 辅助建广告生成的多平台广告计划草案（需求 9.2、9.3、9.5）。
 *
 * - `confirm_status`：草案确认状态机，新草案恒「待确认」，仅「已确认」可驱动投放
 *   （需求 9.5、9.6）。全自动档自动确认，专家把关档需投手确认（需求 9.3）。
 * - `platform_drafts`：Meta/Google/TikTok 各平台草案（系列/组/广告/定向/预算/素材/表单建议）。
 * - `persona_source`：买家画像来源（AI 自动推导 / 人工指定，需求 9.1）。
 */
@Entity({ name: 'campaign_draft' })
export class CampaignDraft {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 所属客户标识。 */
  @Index('idx_campaign_draft_merchant_id')
  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId!: string;

  /** 草案确认状态，新草案恒「待确认」（需求 9.2、9.5）。 */
  @Column({
    name: 'confirm_status',
    type: 'varchar',
    length: 16,
    default: '待确认',
  })
  confirmStatus!: DraftConfirmStatus;

  /** 各平台草案内容（系列/组/广告/定向/预算/素材/表单建议）。 */
  @Column({ name: 'platform_drafts', type: 'jsonb', nullable: true })
  platformDrafts!: unknown | null;

  /** 买家画像来源标记（AI 自动推导 / 人工指定，需求 9.1）。 */
  @Column({ name: 'persona_source', type: 'varchar', length: 16, nullable: true })
  personaSource!: PersonaSource | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
