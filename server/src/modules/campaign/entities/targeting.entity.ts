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

/** 性别取值域（需求 8.1）。 */
export type TargetingGender = '男' | '女' | '不限';

/**
 * TARGETING —— 广告组受众定向设置（需求 8.1、8.2、8.4）。
 *
 * 与广告组一对一：`ad_group_id` 非空 + 外键约束。
 * - 年龄 13-65（应用层校验），性别限「男|女|不限」。
 * - 兴趣/行为/自定义受众/相似受众以 jsonb 承载。
 * - `not_applicable_dims` 标记目标平台不适用维度（需求 8.4）。
 */
@Entity({ name: 'targeting' })
export class Targeting {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'ad_group_id', type: 'uuid', unique: true })
  adGroupId!: string;

  @OneToOne(() => AdGroup, (adGroup) => adGroup.targeting, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ad_group_id' })
  adGroup!: AdGroup;

  /** 国家/地区定向（买家画像核心维度，需求 8.1）。 */
  @Column({ type: 'jsonb', nullable: true })
  geo!: unknown | null;

  /** 行业定向（买家画像核心维度：国家/地区 + 行业 + 职位，需求 8.1）。 */
  @Column({ type: 'jsonb', nullable: true })
  industry!: unknown | null;

  /** 职位定向（买家画像核心维度：国家/地区 + 行业 + 职位，需求 8.1）。 */
  @Column({ name: 'job_role', type: 'jsonb', nullable: true })
  jobRole!: unknown | null;

  /** 年龄下限，取值 13-65（应用层校验，需求 8.1）。 */
  @Column({ name: 'age_min', type: 'int', nullable: true })
  ageMin!: number | null;

  /** 年龄上限，取值 13-65（应用层校验，需求 8.1）。 */
  @Column({ name: 'age_max', type: 'int', nullable: true })
  ageMax!: number | null;

  /** 性别，限「男|女|不限」（需求 8.1）。 */
  @Column({ type: 'varchar', length: 8, nullable: true })
  gender!: TargetingGender | null;

  @Column({ type: 'jsonb', nullable: true })
  interests!: unknown | null;

  @Column({ type: 'jsonb', nullable: true })
  behaviors!: unknown | null;

  @Column({ name: 'custom_audiences', type: 'jsonb', nullable: true })
  customAudiences!: unknown | null;

  @Column({ name: 'lookalike_audiences', type: 'jsonb', nullable: true })
  lookalikeAudiences!: unknown | null;

  /** 标记目标平台不适用的定向维度（含维度名称，需求 8.4）。 */
  @Column({ name: 'not_applicable_dims', type: 'jsonb', nullable: true })
  notApplicableDims!: unknown | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
