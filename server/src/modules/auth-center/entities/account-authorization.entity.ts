import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { TokenRecord } from './token-record.entity';

/** 账户授权状态取值域（需求 2、3、4）。 */
export type AccountAuthStatus = '未授权' | '有效' | '需重新授权' | '授权已撤销';

/**
 * ACCOUNT_AUTHORIZATION —— 代客户账户授权（需求 2.1、2.2、5.1）。
 *
 * 将 Meta（System User token + on-behalf-of）、Google（MCC + OAuth）、
 * TikTok（BC Agency + 每账户 OAuth）三平台授权归一到统一模型，
 * 平台差异收敛在 `auth_model_meta`（需求 6.6）。
 *
 * - `merchant_id`：所属客户标识。
 * - `auth_status`：授权状态机取值，授权失败时保持「未授权」（需求 2.6）。
 * - `scopes`：授权范围。
 * - 与 {@link TokenRecord} 一对一。
 */
@Entity({ name: 'account_authorization' })
export class AccountAuthorization {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 所属平台（meta | google | tiktok）。 */
  @Index('idx_account_authorization_platform')
  @Column({ type: 'varchar', length: 32 })
  platform!: string;

  /** 所属客户标识。 */
  @Index('idx_account_authorization_merchant_id')
  @Column({ name: 'merchant_id', type: 'uuid' })
  merchantId!: string;

  /** 授权状态，默认「未授权」（需求 2.6）。 */
  @Column({
    name: 'auth_status',
    type: 'varchar',
    length: 16,
    default: '未授权',
  })
  authStatus!: AccountAuthStatus;

  /** 授权范围。 */
  @Column({ type: 'jsonb', nullable: true })
  scopes!: unknown | null;

  /** 平台授权模型差异承载（Meta/Google/TikTok），收敛平台差异（需求 6.6）。 */
  @Column({ name: 'auth_model_meta', type: 'jsonb', nullable: true })
  authModelMeta!: unknown | null;

  @OneToOne(() => TokenRecord, (tokenRecord) => tokenRecord.account)
  tokenRecord!: TokenRecord;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
