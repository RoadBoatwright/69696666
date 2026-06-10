import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** 凭据配置状态取值域，仅二态（需求 1.1、1.2）。 */
export type CredentialConfigStatus = 'unfilled' | 'filled';

/**
 * PLATFORM_CREDENTIAL —— 平台凭据配置（需求 1.2、19.1）。
 *
 * - 主键为 `platform`（meta | google | tiktok | gemini 等），每平台一行配置。
 * - `config_status` 仅二态「unfilled|filled」，由 `computeConfigStatus` 计算（需求 1.1）。
 * - `encrypted_values`：凭据敏感值经 KMS 信封加密 / AES-256-GCM 加密后的密文（bytea），
 *   **绝不落明文**（需求 19.1）。解密仅在内存中经 `useDecrypted` 进行（需求 19.2）。
 */
@Entity({ name: 'platform_credential' })
export class PlatformCredential {
  /** 平台标识，作为主键（meta | google | tiktok | gemini 等）。 */
  @PrimaryColumn({ type: 'varchar', length: 32 })
  platform!: string;

  /** 凭据配置状态，仅二态「unfilled|filled」，默认未填入（需求 1.1、1.2）。 */
  @Column({
    name: 'config_status',
    type: 'varchar',
    length: 16,
    default: 'unfilled',
  })
  configStatus!: CredentialConfigStatus;

  /**
   * 凭据敏感值密文（bytea），加密存储，绝不落明文（需求 19.1）。
   * 凭据未填入时为空。
   */
  @Column({ name: 'encrypted_values', type: 'bytea', nullable: true })
  encryptedValues!: Buffer | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
