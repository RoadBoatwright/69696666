import { Inject, Injectable, NotImplementedException, Optional } from '@nestjs/common';

import { CredentialManagerService } from '../credential/credential-manager.service';
import { CredentialAdapterContext } from './credential-adapter-context';
import type { AdapterContext, PlatformAdapter, PlatformId } from './domain/platform-adapter';

/**
 * DI 注入令牌：已注册的平台适配器集合（需求 8.9）。
 *
 * 各平台适配器（Meta/Google/TikTok 真实实现于 10.2/10.4/10.6，LinkedIn 扩展位于 10.8）
 * 经此令牌以数组形式注入注册表。新增平台只需追加一个适配器 provider，无需改动
 * 既有平台的映射（需求 8.9）。
 */
export const PLATFORM_ADAPTERS = Symbol('PLATFORM_ADAPTERS');

/**
 * 平台适配器注册工厂（组件 4，需求 8.9、6.3）。
 *
 * 职责：
 *  - 按 `platform` 将注入的适配器集合建立 PlatformId → 适配器 的映射（注册）。
 *  - 提供 {@link getAdapter} 工厂查找，未注册平台抛出 NotImplementedException。
 *  - 提供 {@link createContext} 构造基于凭据管理器的 {@link AdapterContext}，使适配器
 *    经受控入口在内存中解密取令牌、用后清理（需求 6.3）。
 *
 * 提供 LinkedIn 扩展位：第二期新增 LinkedIn 适配器时仅需将其加入 {@link PLATFORM_ADAPTERS}
 * 集合，注册表自动纳入映射，既有 Meta/Google/TikTok 映射保持不变（需求 8.9）。
 */
@Injectable()
export class PlatformAdapterRegistry {
  private readonly adapters = new Map<PlatformId, PlatformAdapter>();

  constructor(
    @Optional()
    @Inject(PLATFORM_ADAPTERS)
    adapters: PlatformAdapter[] | undefined,
    private readonly credentialManager: CredentialManagerService,
  ) {
    for (const adapter of adapters ?? []) {
      this.register(adapter);
    }
  }

  /**
   * 注册单个平台适配器（需求 8.9）。
   *
   * @throws 当同一平台被重复注册时抛错，避免静默覆盖既有映射。
   */
  register(adapter: PlatformAdapter): void {
    if (this.adapters.has(adapter.platform)) {
      throw new Error(`平台「${adapter.platform}」适配器重复注册`);
    }
    this.adapters.set(adapter.platform, adapter);
  }

  /** 判定某平台是否已注册适配器。 */
  has(platform: PlatformId): boolean {
    return this.adapters.has(platform);
  }

  /** 返回全部已注册的平台标识。 */
  registeredPlatforms(): PlatformId[] {
    return [...this.adapters.keys()];
  }

  /**
   * 工厂查找：按平台标识取得对应适配器（需求 8.9）。
   *
   * @throws NotImplementedException 当该平台尚未注册适配器（如 LinkedIn 第二期扩展位
   *   未接入时，需求 34.3）。
   */
  getAdapter(platform: PlatformId): PlatformAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new NotImplementedException(`平台「${platform}」适配器尚未提供`);
    }
    return adapter;
  }

  /**
   * 构造绑定到指定平台的 {@link AdapterContext}（需求 6.3）。
   *
   * 上下文经凭据管理器在内存中解密取令牌、用后立即清理，供适配器对接平台真实官方 API。
   */
  createContext(platform: PlatformId): AdapterContext {
    return new CredentialAdapterContext(platform, this.credentialManager);
  }
}
