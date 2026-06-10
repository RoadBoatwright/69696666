import { Module } from '@nestjs/common';

import { CredentialModule } from '../credential/credential.module';
import { GoogleAdapter } from './google-adapter';
import { LinkedInAdapter } from './linkedin.adapter';
import { MetaAdapter } from './meta-adapter';
import { PLATFORM_ADAPTERS, PlatformAdapterRegistry } from './platform-adapter.registry';
import { TikTokAdapter } from './tiktok-adapter';
import type { PlatformAdapter } from './domain/platform-adapter';

/**
 * 平台适配器（组件 4，需求 6.6、8、9、11-16）。
 *
 * 定义 PlatformAdapter 接口与 AdapterContext，承载 Meta/Google/TikTok
 * 适配器实现及 LinkedIn 第二期扩展位。这是「统一↔平台原生」转换的
 * 唯一发生地。
 *
 * 本任务（10.1）提供接口、基于凭据管理器的 AdapterContext（需求 6.3）与
 * PlatformAdapter 注册工厂（PlatformId → 适配器，支持 LinkedIn 扩展位且不改动
 * 既有平台映射，需求 8.9）。Meta/Google/TikTok 真实适配器与 LinkedIn 扩展位
 * 将在后续任务（10.2/10.4/10.6/10.8）以 `PLATFORM_ADAPTERS` 集合注入。
 *
 * LinkedIn 第二期扩展位（10.8）经 {@link LinkedInAdapter} 注入 `PLATFORM_ADAPTERS`，
 * 其方法体抛 NotImplementedException（需求 34.1、34.3）；新增该适配器不改动既有
 * Meta/Google/TikTok 适配器实现与字段映射（需求 8.9、34.2）。
 */
@Module({
  imports: [CredentialModule],
  providers: [
    MetaAdapter,
    GoogleAdapter,
    LinkedInAdapter,
    TikTokAdapter,
    {
      provide: PLATFORM_ADAPTERS,
      useFactory: (
        meta: MetaAdapter,
        google: GoogleAdapter,
        tiktok: TikTokAdapter,
        linkedin: LinkedInAdapter,
      ): PlatformAdapter[] => [meta, google, tiktok, linkedin],
      inject: [MetaAdapter, GoogleAdapter, TikTokAdapter, LinkedInAdapter],
    },
    PlatformAdapterRegistry,
  ],
  exports: [PlatformAdapterRegistry],
})
export class PlatformAdapterModule {}
