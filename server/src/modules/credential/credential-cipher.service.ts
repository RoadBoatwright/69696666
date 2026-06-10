import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EncryptionConfig } from '../../config/configuration';

/**
 * 凭据信封加密服务（需求 1.2、1.8、6.1）。
 *
 * - 默认采用「信封加密」：为每次加密随机生成数据密钥（DEK），用 DEK 经 AES-256-GCM 加密凭据；
 *   再用主密钥包裹（wrap）DEK，密文 DEK 与密文凭据一并存储。
 * - 主密钥来源：配置了 `kmsKeyId` 时由 KMS 托管（此处以从 KMS 派生的本地表示模拟，
 *   生产可替换为真实 KMS GenerateDataKey/Decrypt 调用）；未配置 KMS 时降级为本地对称
 *   主密钥（AES-256-GCM），密钥经配置注入、不与数据同库（需求 1.8、6.1）。
 * - 任何持久化介质均不保存凭据明文（需求 6.1）。
 *
 * 存储二进制布局（单一 Buffer）：
 *   [1B version][1B wrappedDekLen][wrappedDek][12B dataIv][16B dataTag][dataCiphertext]
 * 其中 wrappedDek 自身为 [12B iv][16B tag][ciphertext]。
 */
@Injectable()
export class CredentialCipherService {
  private static readonly VERSION = 1;
  private static readonly IV_LENGTH = 12;
  private static readonly TAG_LENGTH = 16;
  private static readonly ALGORITHM = 'aes-256-gcm';

  /** 32 字节主密钥（用于包裹 DEK）。 */
  private readonly masterKey: Buffer;

  /** 当前是否为无 KMS 的本地降级模式。 */
  readonly localFallback: boolean;

  constructor(@Inject(ConfigService) configService: ConfigService) {
    const encryption = configService.get<EncryptionConfig>('encryption');
    const kmsKeyId = encryption?.kmsKeyId ?? '';
    const localKey = encryption?.localEncryptionKey ?? '';

    this.localFallback = kmsKeyId.trim().length === 0;

    // 主密钥派生：
    // - KMS 模式下，以 kmsKeyId 派生稳定的 32 字节主密钥表示（生产替换为 KMS 调用）。
    // - 本地降级模式下，由配置注入的本地主密钥派生 32 字节密钥。
    const keyMaterial = this.localFallback ? localKey : kmsKeyId;
    if (keyMaterial.trim().length === 0) {
      throw new Error(
        '凭据加密主密钥缺失：请配置 KMS_KEY_ID 或 LOCAL_ENCRYPTION_KEY（需求 1.6、1.8）',
      );
    }
    this.masterKey = createHash('sha256').update(keyMaterial, 'utf8').digest();
  }

  /**
   * 加密凭据值集合（需求 1.2、6.1）。
   *
   * 序列化为 JSON 后经信封加密，返回单一密文 Buffer。加密过程失败将抛出错误，
   * 由调用方据此「不持久化明文、保持原状态」（需求 1.8）。
   */
  encrypt(values: Record<string, string>): Buffer {
    const plaintext = Buffer.from(JSON.stringify(values), 'utf8');

    // 1) 随机数据密钥 DEK，加密凭据。
    const dek = randomBytes(32);
    const dataSealed = this.sealWithKey(dek, plaintext);

    // 2) 用主密钥包裹 DEK。
    const wrappedDek = this.sealWithKey(this.masterKey, dek);
    if (wrappedDek.length > 0xff) {
      throw new Error('包裹后的数据密钥长度超出存储布局上限');
    }

    return Buffer.concat([
      Buffer.from([CredentialCipherService.VERSION]),
      Buffer.from([wrappedDek.length]),
      wrappedDek,
      dataSealed,
    ]);
  }

  /**
   * 解密凭据值集合（需求 6.3）。仅在内存中进行，调用方负责用后清理明文。
   */
  decrypt(blob: Buffer): Record<string, string> {
    if (blob.length < 2 || blob[0] !== CredentialCipherService.VERSION) {
      throw new Error('凭据密文格式无效或版本不兼容');
    }
    const wrappedDekLen = blob[1];
    let offset = 2;

    const wrappedDek = blob.subarray(offset, offset + wrappedDekLen);
    offset += wrappedDekLen;
    const dataSealed = blob.subarray(offset);

    // 1) 用主密钥解出 DEK。
    const dek = this.openWithKey(this.masterKey, wrappedDek);
    // 2) 用 DEK 解出凭据明文。
    const plaintext = this.openWithKey(dek, dataSealed);

    const parsed = JSON.parse(plaintext.toString('utf8')) as Record<string, string>;
    return parsed;
  }

  /** 以 AES-256-GCM 用给定密钥封装明文：返回 [iv][tag][ciphertext]。 */
  private sealWithKey(key: Buffer, plaintext: Buffer): Buffer {
    const iv = randomBytes(CredentialCipherService.IV_LENGTH);
    const cipher = createCipheriv(CredentialCipherService.ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]);
  }

  /** 以 AES-256-GCM 用给定密钥解封 [iv][tag][ciphertext]。 */
  private openWithKey(key: Buffer, sealed: Buffer): Buffer {
    const iv = sealed.subarray(0, CredentialCipherService.IV_LENGTH);
    const tag = sealed.subarray(
      CredentialCipherService.IV_LENGTH,
      CredentialCipherService.IV_LENGTH + CredentialCipherService.TAG_LENGTH,
    );
    const ciphertext = sealed.subarray(
      CredentialCipherService.IV_LENGTH + CredentialCipherService.TAG_LENGTH,
    );
    const decipher = createDecipheriv(CredentialCipherService.ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
