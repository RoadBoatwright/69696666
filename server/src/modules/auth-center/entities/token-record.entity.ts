import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { AccountAuthorization } from './account-authorization.entity';

/** 令牌状态机取值域，任一时刻唯一（需求 5.1）。 */
export type TokenStatus = '有效' | '即将过期' | '已过期' | '需重新授权' | '授权已撤销';

/**
 * TOKEN_RECORD —— 访问/刷新令牌记录（需求 5.1、19.1）。
 *
 * - 与 {@link AccountAuthorization} 一对一（`account_id` 唯一非空外键）。
 * - `status` 由状态机纯函数 `evaluateTokenStatus` 计算，任一时刻唯一（需求 5.1）。
 * - 令牌敏感值（access/refresh token）经加密存储，**绝不落明文**（需求 19.1）。
 * - `consecutive_refresh_failures`：连续刷新失败计数，达 3 次置「需重新授权」（需求 5.5）。
 * - `last_used_at`：上次使用时间，用于 Google OAuth 保活区间判定（需求 3.3）。
 * - 有效期精确到秒（需求 2.7）。
 */
@Entity({ name: 'token_record' })
export class TokenRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** 关联账户授权标识，唯一非空外键（一对一）。 */
  @Column({ name: 'account_id', type: 'uuid', unique: true })
  accountId!: string;

  @OneToOne(() => AccountAuthorization, (account) => account.tokenRecord, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'account_id' })
  account!: AccountAuthorization;

  /** 令牌状态机当前状态，任一时刻唯一（需求 5.1）。 */
  @Column({ type: 'varchar', length: 16 })
  status!: TokenStatus;

  /** 访问令牌密文（bytea），加密存储，绝不落明文（需求 19.1）。 */
  @Column({ name: 'encrypted_access_token', type: 'bytea', nullable: true })
  encryptedAccessToken!: Buffer | null;

  /** 刷新令牌密文（bytea），加密存储，绝不落明文（需求 19.1）。 */
  @Column({ name: 'encrypted_refresh_token', type: 'bytea', nullable: true })
  encryptedRefreshToken!: Buffer | null;

  /** 访问令牌有效期（精确到秒，需求 2.7）。 */
  @Column({ name: 'access_token_expire_at', type: 'timestamptz', nullable: true })
  accessTokenExpireAt!: Date | null;

  /** 刷新令牌有效期（精确到秒，需求 2.7）。 */
  @Column({ name: 'refresh_token_expire_at', type: 'timestamptz', nullable: true })
  refreshTokenExpireAt!: Date | null;

  /** 上次使用时间，用于 Google OAuth 保活区间判定（需求 3.3）。 */
  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt!: Date | null;

  /** 连续刷新失败计数，达 3 次置「需重新授权」并停止刷新（需求 5.5）；成功后复位为 0（需求 5.4）。 */
  @Column({ name: 'consecutive_refresh_failures', type: 'int', default: 0 })
  consecutiveRefreshFailures!: number;

  /** 上次预警发送时间，用于即将过期预警幂等（需求 5.6）。 */
  @Column({ name: 'last_warning_sent_at', type: 'timestamptz', nullable: true })
  lastWarningSentAt!: Date | null;

  /** 上次刷新/授权失败时间（精确到秒），连续失败达阈值或授权失效错误时记录（需求 5.5、2.6、4.3）。 */
  @Column({ name: 'last_failure_at', type: 'timestamptz', nullable: true })
  lastFailureAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
