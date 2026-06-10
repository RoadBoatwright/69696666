import { Injectable, NotImplementedException } from '@nestjs/common';

import type {
  AuthPlatformId,
  GoogleAuthParams,
  IssuedToken,
  MetaAuthParams,
  RefreshedToken,
  TikTokAuthParams,
} from '../domain/auth';
import type { PlatformAuthClient } from './index';

/**
 * 默认平台授权客户端占位实现（需求 2-5）。
 *
 * 真实的三平台官方 API 对接由平台适配层在后续任务提供并覆盖该 provider；
 * 单元/属性测试通过 mock 桩注入。占位实现的各方法抛出 NotImplementedException，
 * 以避免在未接入真实平台时静默成功。
 */
@Injectable()
export class DefaultPlatformAuthClient implements PlatformAuthClient {
  authorizeMeta(_merchantId: string, _params: MetaAuthParams): Promise<IssuedToken> {
    throw new NotImplementedException('Meta 授权客户端尚未接入');
  }

  authorizeGoogle(_merchantId: string, _params: GoogleAuthParams): Promise<IssuedToken> {
    throw new NotImplementedException('Google 授权客户端尚未接入');
  }

  authorizeTikTok(_merchantId: string, _params: TikTokAuthParams): Promise<IssuedToken> {
    throw new NotImplementedException('TikTok 授权客户端尚未接入');
  }

  refreshToken(
    _platform: AuthPlatformId,
    _refreshToken: string | null,
    _authModelMeta: Record<string, unknown>,
  ): Promise<RefreshedToken> {
    throw new NotImplementedException('令牌刷新客户端尚未接入');
  }

  detectRevocation(
    _platform: AuthPlatformId,
    _authModelMeta: Record<string, unknown>,
  ): Promise<'active' | 'revoked' | 'invalid'> {
    throw new NotImplementedException('撤销检测客户端尚未接入');
  }
}
