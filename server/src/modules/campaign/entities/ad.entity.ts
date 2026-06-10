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

import { AdGroup } from './ad-group.entity';
import { AdAsset } from '../../asset/entities/ad-asset.entity';
import { LeadForm } from '../../lead/entities/lead-form.entity';

/**
 * AD —— 三级结构最底层「广告」（需求 6.1、7.3）。
 *
 * 父级唯一约束：每个广告有且仅有一个父级广告组，
 * `ad_group_id` 非空（NOT NULL）+ 外键约束（需求 6.1）。
 */
@Entity({ name: 'ad' })
export class Ad {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 父级广告组标识，非空（需求 6.1：子级有且仅有一个父级）。 */
  @Index('idx_ad_ad_group_id')
  @Column({ name: 'ad_group_id', type: 'uuid' })
  adGroupId!: string;

  @ManyToOne(() => AdGroup, (adGroup) => adGroup.ads, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ad_group_id' })
  adGroup!: AdGroup;

  @OneToMany(() => AdAsset, (adAsset) => adAsset.ad)
  adAssets!: AdAsset[];

  @OneToMany(() => LeadForm, (leadForm) => leadForm.ad)
  leadForms!: LeadForm[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
