import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  CREDENTIAL_PLATFORMS,
  CredentialConfigStatus,
  CredentialKey,
  CredentialPlatformId,
  CredentialSubmitResult,
} from '../../common/domain/credential';
import {
  computeConfigStatus,
  computeUnavailablePlatforms,
  isPlatformAvailable,
  redact,
  validateCredentialValues,
} from '../../common/pure/credential.pure';
import { CredentialNotConfiguredError } from '../../common/errors/credential.error';
import { CREDENTIAL_DESCRIPTORS, getDescriptor } from './credential-descriptors';
import { CredentialCipherService } from './credential-cipher.service';
import { PlatformCredential } from './entities/platform-credential.entity';

/**
 * 凭据管理器（组件 1，需求 1、6、15.1）。
 *
 * 职责：按配置项独立的凭据（Meta/Google/TikTok/Gemini）、二态状态计算、信封加密存储、
 * 内存解密使用与脱敏。凭据值仅经配置接口提交，禁止硬编码（需求 1.6）。
 */
@Injectable()
export class CredentialManagerService {
  private readonly logger = new Logger(CredentialManagerService.name);

  /**
   * 已存储凭据明文指纹注册表（需求 6.5）。
   *
   * 仅驻留内存、绝不持久化、绝不写入日志；用于输出前检测并脱敏命中已存储凭据的明文。
   * 在提交与解密路径同步维护。
   */
  private readonly secretRegistry = new Set<string>();

  constructor(
    @InjectRepository(PlatformCredential)
    private readonly repository: Repository<PlatformCredential>,
    @Inject(CredentialCipherService)
    private readonly cipher: CredentialCipherService,
  ) {}

  /**
   * 提交凭据：校验 -> 加密存储 -> 状态更新（需求 1.2、1.7、1.8）。
   *
   * - 校验失败（空值/不符合）：拒绝保存、返回不符合项、保持原状态不变（需求 1.7）。
   * - 加密/存储失败：不持久化明文、返回失败原因、保持原状态不变（需求 1.8）。
   * - 全部必填项通过校验：加密存储并将状态置「filled」（需求 1.2）。
   */
  async submitCredential(
    key: CredentialKey,
    values: Record<string, string>,
  ): Promise<CredentialSubmitResult> {
    const descriptor = getDescriptor(key);
    const previousStatus = await this.getConfigStatus(key);

    // 1) 校验（需求 1.7）。
    const errors = validateCredentialValues(descriptor, values);
    if (errors.length > 0) {
      return { errors, status: previousStatus };
    }

    // 仅保留必填项，避免存储无关字段。
    const sanitized: Record<string, string> = {};
    for (const k of descriptor.requiredKeys) {
      sanitized[k] = values[k];
    }

    // 2) 加密 + 存储（需求 1.2、1.8）。
    let encrypted: Buffer;
    try {
      encrypted = this.cipher.encrypt(sanitized);
    } catch {
      // 加密失败：不持久化明文、保持原状态（需求 1.8）。
      return {
        errors: [
          {
            key: '*',
            reason: 'invalid_format',
          },
        ],
        status: previousStatus,
      };
    }

    const status: CredentialConfigStatus = computeConfigStatus(descriptor, sanitized);

    try {
      await this.repository.save({
        platform: key,
        configStatus: status,
        encryptedValues: encrypted,
      });
    } catch (error) {
      // 存储失败：不持久化明文、保持原状态（需求 1.8）。
      this.logger.error(`凭据存储失败（key=${key}）：${this.redact(String(error))}`);
      return {
        errors: [{ key: '*', reason: 'invalid_format' }],
        status: previousStatus,
      };
    }

    // 维护脱敏指纹注册表（需求 6.5）。
    for (const k of descriptor.requiredKeys) {
      this.secretRegistry.add(sanitized[k]);
    }

    return { status };
  }

  /** 查询某凭据配置项状态（需求 1.1、1.4、15.1）。 */
  async getConfigStatus(key: CredentialKey): Promise<CredentialConfigStatus> {
    const record = await this.repository.findOne({ where: { platform: key } });
    return record?.configStatus ?? 'unfilled';
  }

  /** 查询全部凭据配置项的配置状态（含 Gemini，需求 1.1、15.1）。 */
  async getAllConfigStatuses(): Promise<Record<CredentialKey, CredentialConfigStatus>> {
    const result = {} as Record<CredentialKey, CredentialConfigStatus>;
    for (const key of Object.keys(CREDENTIAL_DESCRIPTORS) as CredentialKey[]) {
      result[key] = await this.getConfigStatus(key);
    }
    return result;
  }

  /**
   * 平台功能可用性隔离（需求 1.4）。
   *
   * 返回被标记为不可用的广告平台集合（恰好等于「unfilled」平台集合）。
   * 仅作用于广告平台（meta/google/tiktok）；Gemini 不属于平台可用性集合（其降级见需求 15.3）。
   */
  async getUnavailablePlatforms(): Promise<CredentialPlatformId[]> {
    const statuses = {} as Record<CredentialPlatformId, CredentialConfigStatus>;
    for (const platform of CREDENTIAL_PLATFORMS) {
      statuses[platform] = await this.getConfigStatus(platform);
    }
    return computeUnavailablePlatforms(statuses);
  }

  /**
   * 断言某平台可用，否则抛出「该平台凭据未配置」错误（需求 1.5）。
   */
  async assertPlatformAvailable(platform: CredentialPlatformId): Promise<void> {
    const status = await this.getConfigStatus(platform);
    if (!isPlatformAvailable(status)) {
      throw new CredentialNotConfiguredError(platform);
    }
  }

  /**
   * 判定底层生成式 AI（Gemini）凭据是否已填入（需求 9.7、15.3）。
   *
   * Gemini 凭据未填入时，对应 AI 能力（建广告/背调）优雅降级为不可用，而非崩溃。
   */
  async isGeminiAvailable(): Promise<boolean> {
    return isPlatformAvailable(await this.getConfigStatus('gemini'));
  }

  /**
   * 在内存中解密使用某凭据项，回调结束后立即清理明文（需求 6.3、6.4）。
   *
   * - 凭据未配置时抛出「该平台凭据未配置」（需求 1.5）。
   * - 明文仅在回调作用域内存在，回调结束（无论成功或异常）立即清零引用（需求 6.4）。
   * - 解密路径绝不写入持久化日志（需求 6.3）。
   */
  async useDecrypted<T>(
    key: CredentialKey,
    name: string,
    fn: (plain: string) => Promise<T>,
  ): Promise<T> {
    const record = await this.repository.findOne({ where: { platform: key } });
    if (!record || record.configStatus !== 'filled' || !record.encryptedValues) {
      throw new CredentialNotConfiguredError(key);
    }

    const blob = Buffer.isBuffer(record.encryptedValues)
      ? record.encryptedValues
      : Buffer.from(record.encryptedValues);

    const decrypted = this.cipher.decrypt(blob);
    let plain: string | undefined = decrypted[name];

    if (typeof plain !== 'string') {
      // 清理其余明文后再报错。
      this.wipe(decrypted);
      throw new CredentialNotConfiguredError(key);
    }

    // 持续维护脱敏指纹（需求 6.5）。
    this.secretRegistry.add(plain);

    try {
      return await fn(plain);
    } finally {
      // 释放内存中的凭据明文（需求 6.4）。
      this.wipe(decrypted);
      plain = undefined;
    }
  }

  /**
   * 对任意输出文本做脱敏，保证不含完整凭据明文（需求 1.3、6.2、6.5）。
   *
   * 复用脱敏纯函数，依据已存储凭据指纹注册表替换命中明文，暴露不超过末 4 位。
   */
  redact(text: string): string {
    return redact(text, [...this.secretRegistry]);
  }

  /**
   * 注册一个已知敏感明文到指纹注册表（需求 6.5），供输出拦截器脱敏使用。
   * 仅内存驻留，不持久化、不记日志。
   */
  registerSecret(secret: string): void {
    if (secret.length > 0) {
      this.secretRegistry.add(secret);
    }
  }

  /** 清零内存中解密得到的明文对象引用（需求 6.4）。 */
  private wipe(decrypted: Record<string, string>): void {
    for (const k of Object.keys(decrypted)) {
      // 覆盖引用，协助尽快释放明文字符串。
      decrypted[k] = '';
      delete decrypted[k];
    }
  }
}
