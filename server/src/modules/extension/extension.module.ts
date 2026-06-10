import { Module } from '@nestjs/common';

import { CredentialModule } from '../credential/credential.module';
import { GoogleCapabilitiesService } from './capabilities/google-capabilities.service';
import { MetaCapabilitiesService } from './capabilities/meta-capabilities.service';
import { TikTokCapabilitiesService } from './capabilities/tiktok-capabilities.service';
import { ExtensionGatewayService } from './extension-gateway.service';
import { ExtensionService } from './extension.service';

/**
 * 平台扩展能力包 + 扩展能力调用网关（任务 28-38，需求 22-32、34）。
 *
 * 网关统一路由（支持集 + 凭据状态 + LinkedIn 第二期降级），各平台执行器对接真实
 * 平台 API；高级能力应用服务在网关之上做统一入参校验与编排。
 */
@Module({
  imports: [CredentialModule],
  providers: [
    ExtensionGatewayService,
    ExtensionService,
    MetaCapabilitiesService,
    GoogleCapabilitiesService,
    TikTokCapabilitiesService,
  ],
  exports: [
    ExtensionGatewayService,
    ExtensionService,
    MetaCapabilitiesService,
    GoogleCapabilitiesService,
    TikTokCapabilitiesService,
  ],
})
export class ExtensionModule {}
