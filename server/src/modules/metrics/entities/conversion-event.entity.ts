import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ConversionConfig } from './conversion-config.entity';
import { Ad } from '../../campaign/entities/ad.entity';

/** 转化事件匹配状态取值域（需求 14.5、14.6）。 */
export type ConversionMatchStatus = 'matched' | 'unmatched';

/**
 * CONVERSION_EVENT —— 转化事件（需求 14.5、14.6）。
 *
 * - `ad_id` 可空：可关联广告则置「matched」，无法匹配则置「unmatched」并保留待匹配（需求 14.6）。
 * - `conversion_config_id`：所属转化配置（可空）。
 * - `raw_data`：原始事件数据，保留以待重试/匹配。
 */
@Entity({ name: 'conversion_event' })
export class ConversionEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 平台事件标识。 */
  @Index('idx_conversion_event_platform_event_id')
  @Column({ name: 'platform_event_id', type: 'varchar', length: 255 })
  platformEventId!: string;

  /** 所属转化配置，可空。 */
  @Column({ name: 'conversion_config_id', type: 'uuid', nullable: true })
  conversionConfigId!: string | null;

  @ManyToOne(() => ConversionConfig, (config) => config.events, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'conversion_config_id' })
  conversionConfig!: ConversionConfig | null;

  /** 关联广告标识，可空（空=未匹配，需求 14.6）。 */
  @Index('idx_conversion_event_ad_id')
  @Column({ name: 'ad_id', type: 'uuid', nullable: true })
  adId!: string | null;

  @ManyToOne(() => Ad, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'ad_id' })
  ad!: Ad | null;

  /** 匹配状态：matched | unmatched（需求 14.5、14.6）。 */
  @Column({ name: 'match_status', type: 'varchar', length: 16 })
  matchStatus!: ConversionMatchStatus;

  /** 原始事件数据，未匹配时保留待匹配（需求 14.6）。 */
  @Column({ name: 'raw_data', type: 'jsonb', nullable: true })
  rawData!: unknown | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
