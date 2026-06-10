import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PlatformCredential } from './entities/platform-credential.entity';
import { CredentialCipherService } from './credential-cipher.service';
import { CredentialManagerService } from './credential-manager.service';
import { CredentialRedactionInterceptor } from './credential-redaction.interceptor';

/**
 * 凭据管理器（组件 1，需求 1、6、15.1）。
 *
 * 负责按配置项独立的凭据（Meta/Google/TikTok/Gemini）、二态状态计算、KMS 信封加密存储
 *（无 KMS 降级为 AES-256-GCM）、内存解密使用与脱敏。
 * 凭据值仅通过配置接口/环境注入，禁止硬编码（需求 1.6）。
 *
 * `CredentialRedactionInterceptor` 经 `APP_INTERCEPTOR` 注册为全局拦截器，
 * 在所有接口响应输出前统一脱敏命中已存储凭据的明文（需求 6.5）。
 */
@Module({
  imports: [TypeOrmModule.forFeature([PlatformCredential])],
  providers: [
    CredentialCipherService,
    CredentialManagerService,
    CredentialRedactionInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useExisting: CredentialRedactionInterceptor,
    },
  ],
  exports: [CredentialManagerService, CredentialCipherService, CredentialRedactionInterceptor],
})
export class CredentialModule {}
