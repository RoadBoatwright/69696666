import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Opportunity } from '../../opportunity-scoring/entities';

/** 买家回复通道取值域（需求 21.6）。 */
export type ReplyChannel = 'whatsapp' | 'crm';

/**
 * BUYER_REPLY_EVENT —— 买家回复事件（需求 21.6）。
 *
 * 记录买家通过 WhatsApp / CRM 通道的回复，供有效联络率判定使用（需求 21.6）。
 */
@Entity({ name: 'buyer_reply_event' })
export class BuyerReplyEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 所属商机标识。 */
  @Index('idx_buyer_reply_event_opportunity_id')
  @Column({ name: 'opportunity_id', type: 'uuid' })
  opportunityId!: string;

  @ManyToOne(() => Opportunity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'opportunity_id' })
  opportunity!: Opportunity;

  /** 回复通道（whatsapp / crm，需求 21.6）。 */
  @Column({ type: 'varchar', length: 16 })
  channel!: ReplyChannel;

  /** 回复时间，精确到秒（需求 21.6）。 */
  @Column({ name: 'replied_at', type: 'timestamptz' })
  repliedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
