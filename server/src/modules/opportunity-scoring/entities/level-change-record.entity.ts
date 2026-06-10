import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Opportunity } from './opportunity.entity';
import type { IntentLevel } from './opportunity.entity';

/**
 * LEVEL_CHANGE_RECORD —— 商机意向等级变更轨迹（需求 16.5、16.6）。
 *
 * 等级重算覆盖时，若等级发生变化则生成一条含旧/新等级与精确到秒
 * 变更时间的记录（需求 16.6）。
 */
@Entity({ name: 'level_change_record' })
export class LevelChangeRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 所属商机标识。 */
  @Index('idx_level_change_record_opportunity_id')
  @Column({ name: 'opportunity_id', type: 'uuid' })
  opportunityId!: string;

  @ManyToOne(() => Opportunity, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'opportunity_id' })
  opportunity!: Opportunity;

  /** 变更前等级。 */
  @Column({ name: 'before_level', type: 'varchar', length: 8, nullable: true })
  beforeLevel!: IntentLevel | null;

  /** 变更后等级。 */
  @Column({ name: 'after_level', type: 'varchar', length: 8 })
  afterLevel!: IntentLevel;

  /** 变更时间，精确到秒（需求 16.6）。 */
  @CreateDateColumn({ name: 'changed_at', type: 'timestamptz' })
  changedAt!: Date;
}
