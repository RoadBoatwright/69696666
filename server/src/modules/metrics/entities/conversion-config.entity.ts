import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ConversionEvent } from './conversion-event.entity';
import { Campaign } from '../../campaign/entities/campaign.entity';

/** 转化追踪机制取值域（需求 14.1、14.2）。 */
export type ConversionMechanism = 'Pixel' | 'Event' | 'EventsAPI';

/** 转化配置状态取值域（需求 14.3）。 */
export type ConversionConfigStatus = '已生效' | '提交失败';

/**
 * CONVERSION_CONFIG —— 转化追踪配置（需求 14.1-14.3）。
 *
 * - 关联广告系列（`campaign_id` 非空外键）。
 * - `mechanism`：Pixel | Event | EventsAPI。
 * - `event_defs`：事件定义集合，最多 50（应用层校验）。
 * - `status`：「已生效|提交失败」。
 */
@Entity({ name: 'conversion_config' })
export class ConversionConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('idx_conversion_config_campaign_id')
  @Column({ name: 'campaign_id', type: 'uuid' })
  campaignId!: string;

  @ManyToOne(() => Campaign, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'campaign_id' })
  campaign!: Campaign;

  /** 转化追踪机制：Pixel | Event | EventsAPI（需求 14.2）。 */
  @Column({ type: 'varchar', length: 16 })
  mechanism!: ConversionMechanism;

  /** 事件定义集合，最多 50（应用层校验，需求 14）。 */
  @Column({ name: 'event_defs', type: 'jsonb', nullable: true })
  eventDefs!: unknown | null;

  /** 配置状态：「已生效|提交失败」（需求 14.3）。 */
  @Column({ type: 'varchar', length: 16, nullable: true })
  status!: ConversionConfigStatus | null;

  @OneToMany(() => ConversionEvent, (event) => event.conversionConfig)
  events!: ConversionEvent[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
