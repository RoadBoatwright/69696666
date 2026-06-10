import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CredentialModule } from '../credential/credential.module';
import { AuthCenterService } from './auth-center.service';
import { AccountAuthorization, TokenRecord } from './entities';
import { AUTH_NOTIFIER, PLATFORM_AUTH_CLIENT } from './ports';
import { DefaultAuthNotifier } from './ports/default-auth-notifier';
import { DefaultPlatformAuthClient } from './ports/default-platform-auth-client';

/**
 * 账户授权中心（组件 2，需求 2-5）。
 *
 * 负责三平台代客户授权建立、令牌生命周期管理（状态机、刷新、保活、
 * 过期预警、撤销检测）与授权状态汇总。
 *
 * 外部平台 API 调用经 {@link PLATFORM_AUTH_CLIENT} 端口（默认占位实现，
 * 由平台适配层覆盖；测试以 mock 注入）；管理员通知经 {@link AUTH_NOTIFIER} 端口。
 */
@Module({
  imports: [TypeOrmModule.forFeature([AccountAuthorization, TokenRecord]), CredentialModule],
  providers: [
    AuthCenterService,
    { provide: PLATFORM_AUTH_CLIENT, useClass: DefaultPlatformAuthClient },
    { provide: AUTH_NOTIFIER, useClass: DefaultAuthNotifier },
  ],
  exports: [AuthCenterService],
})
export class AuthCenterModule {}
