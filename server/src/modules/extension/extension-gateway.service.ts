import { Injectable } from '@nestjs/common';

import type { CredentialConfigStatus, CredentialKey } from '../../common/domain/credential';
import { CredentialManagerService } from '../credential/credential-manager.service';
import type { PlatformId } from '../platform-adapter/domain/platform-adapter';
import {
  CAPABILITY_IDS,
  CAPABILITY_SUPPORT,
  type CapabilityId,
  type CapabilityRouting,
} from './domain/extension';
import { routeCapability } from './pure';

/** 网关调用结果：成功值或带明确原因的不可用错误（需求 22.3、22.4、22.6、34.3）。 */
export type GatewayResult<T> =
  | { kind: 'ok'; value: T }
  | {
      kind: 'unavailable';
      capability: CapabilityId;
      platform: PlatformId;
      error: '该平台不支持此能力' | '该平台凭据未配置' | '该能力第二期提供';
    };

/**
 * 扩展能力调用网关（任务 28，需求 22）。
 *
 * 统一受理各平台扩展能力调用：
 * - 维护能力 → 支持平台集合，可被查询（需求 22.1，{@link listCapabilities}）。
 * - 支持且凭据「已填入」→ 路由至对应平台执行器（需求 22.2）。
 * - 平台不支持 → 「该平台不支持此能力」且不执行（需求 22.3、23.5、25.4、27.4 等）。
 * - 凭据「未填入」→ 「该平台凭据未配置」、标记不可用、其余平台与统一核心功能不受影响
 *   （需求 22.4、24.4）。
 * - LinkedIn 调用 → 「该能力第二期提供」（需求 34.3）。
 * - 能力注册不改变统一广告对象模型字段定义（需求 22.5）：网关只做路由，不触碰统一模型。
 */
@Injectable()
export class ExtensionGatewayService {
  constructor(private readonly credentials: CredentialManagerService) {}

  /** 查询每个扩展能力的可用平台范围（需求 22.1）。 */
  listCapabilities(): Record<CapabilityId, readonly PlatformId[]> {
    const result = {} as Record<CapabilityId, readonly PlatformId[]>;
    for (const id of CAPABILITY_IDS) {
      result[id] = CAPABILITY_SUPPORT[id];
    }
    return result;
  }

  /** 判定某能力在某平台的路由结果（需求 22.2-22.4、34.3）。 */
  async resolve(capability: CapabilityId, platform: PlatformId): Promise<CapabilityRouting> {
    const status = await this.credentialStatus(platform);
    return routeCapability(capability, platform, status);
  }

  /**
   * 受理一次扩展能力调用：路由通过则执行 executor，否则返回带能力名称与平台标识的
   * 不可用错误且**不执行**调用（需求 22.2、22.3、22.4、22.6）。
   */
  async invoke<T>(
    capability: CapabilityId,
    platform: PlatformId,
    executor: () => Promise<T>,
  ): Promise<GatewayResult<T>> {
    const routing = await this.resolve(capability, platform);
    if (routing.kind !== 'route') {
      return { kind: 'unavailable', capability, platform, error: routing.error };
    }
    return { kind: 'ok', value: await executor() };
  }

  /** 查询平台凭据配置状态；LinkedIn 本期无凭据配置项，按「未填入」处理（需求 34.3）。 */
  private async credentialStatus(platform: PlatformId): Promise<CredentialConfigStatus> {
    if (platform === 'linkedin') {
      return 'unfilled';
    }
    return this.credentials.getConfigStatus(platform as CredentialKey);
  }
}
