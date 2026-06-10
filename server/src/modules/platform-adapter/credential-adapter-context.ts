import type { CredentialKey } from '../../common/domain/credential';
import { CredentialManagerService } from '../credential/credential-manager.service';
import type { AdapterContext, PlatformId } from './domain/platform-adapter';

/**
 * 平台标识 → 凭据配置项标识映射（需求 6.3）。
 *
 * 适配器的平台标识与凭据管理器的凭据配置项一一对应（需求 1.1）。LinkedIn 为第二期
 * 扩展位（需求 8.9、34.1），本期无对应凭据配置项，其上下文不会被实际调用。
 */
const PLATFORM_CREDENTIAL_KEY: Record<Exclude<PlatformId, 'linkedin'>, CredentialKey> = {
  meta: 'meta',
  google: 'google',
  tiktok: 'tiktok',
};

/**
 * 基于凭据管理器的 {@link AdapterContext} 实现（需求 6.3、6.4）。
 *
 * 将 {@link AdapterContext.callWithCredential} 委派至
 * {@link CredentialManagerService.useDecrypted}，使凭据明文仅在回调作用域内于内存中存在、
 * 用后立即清零，且绝不写入持久化日志。适配器借此对接平台真实官方 API 而无需直接接触
 * 持久化凭据明文。
 */
export class CredentialAdapterContext implements AdapterContext {
  constructor(
    public readonly platform: PlatformId,
    private readonly credentialManager: CredentialManagerService,
  ) {}

  /**
   * 在内存中解密使用某项凭据并在回调结束后立即清理（需求 6.3、6.4）。
   *
   * @throws 当该平台凭据未配置时由凭据管理器抛出「该平台凭据未配置」（需求 1.5）。
   */
  callWithCredential<T>(name: string, fn: (plain: string) => Promise<T>): Promise<T> {
    const key = this.resolveCredentialKey();
    return this.credentialManager.useDecrypted(key, name, fn);
  }

  /** 解析当前平台对应的凭据配置项标识（需求 6.3）。 */
  private resolveCredentialKey(): CredentialKey {
    const key = PLATFORM_CREDENTIAL_KEY[this.platform as Exclude<PlatformId, 'linkedin'>];
    if (!key) {
      // LinkedIn 第二期扩展位本期无凭据配置项（需求 8.9、34.1）。
      throw new Error(`平台「${this.platform}」本期无对应凭据配置项`);
    }
    return key;
  }
}
