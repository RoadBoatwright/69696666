import { Injectable } from '@nestjs/common';

import { GoogleCapabilitiesService } from '../extension/capabilities/google-capabilities.service';
import { MetaCapabilitiesService } from '../extension/capabilities/meta-capabilities.service';
import type { CapabilityValidationError } from '../extension/domain/extension';
import {
  ExtensionGatewayService,
  type GatewayResult,
} from '../extension/extension-gateway.service';
import { validateEstimateInputs } from '../extension/pure';
import type { PlatformId } from '../platform-adapter/domain/platform-adapter';

/** 统一口径预估结果（需求 29.2）：预计触达与预计询盘区间。 */
export interface UnifiedEstimate {
  reach: { lowerBound: number; upperBound: number };
  inquiries: { lowerBound: number; upperBound: number };
}

/**
 * 询盘量级与预算建议（投前预估）服务（任务 35，需求 29）。
 *
 * 对接 Meta Reach Estimate 与 Google Reach Forecasting **真实 API**，归一化为统一
 * 口径的「预计触达 / 预计询盘区间」（需求 29.2）；TikTok 不支持时经网关返回
 * 「该平台不支持此能力」（需求 29.3）；定向或预算缺失时点名缺失项（需求 29.4）。
 */
@Injectable()
export class EstimateService {
  /** 触达 → 询盘换算系数区间（行业经验保守口径，可经环境变量覆盖）。 */
  private static readonly INQUIRY_RATE_LOW = 0.001;
  private static readonly INQUIRY_RATE_HIGH = 0.01;

  constructor(
    private readonly gateway: ExtensionGatewayService,
    private readonly meta: MetaCapabilitiesService,
    private readonly google: GoogleCapabilitiesService,
  ) {}

  /** 投前预估（需求 29.2-29.4）。 */
  async estimate(
    platform: PlatformId,
    accountRef: string,
    targeting: Record<string, unknown> | undefined,
    budget: number | undefined,
  ): Promise<
    GatewayResult<UnifiedEstimate> | { kind: 'invalid'; errors: CapabilityValidationError[] }
  > {
    const validation = validateEstimateInputs({ targeting, budget });
    if (!validation.ok) {
      return { kind: 'invalid', errors: validation.errors };
    }
    return this.gateway.invoke('pre_estimate', platform, async () => {
      const reach =
        platform === 'meta'
          ? await this.meta.reachEstimate(
              accountRef,
              targeting as Record<string, unknown>,
              budget as number,
            )
          : await this.google.generateReachForecast(
              accountRef,
              targeting as Record<string, unknown>,
              Math.round((budget as number) * 1e6),
            );
      return this.normalize(reach);
    });
  }

  /** 平台触达区间 → 统一口径预估（需求 29.2）。 */
  private normalize(reach: { lowerBound: number; upperBound: number }): UnifiedEstimate {
    const lower = Math.max(0, reach.lowerBound);
    const upper = Math.max(lower, reach.upperBound);
    return {
      reach: { lowerBound: lower, upperBound: upper },
      inquiries: {
        lowerBound: Math.floor(lower * EstimateService.INQUIRY_RATE_LOW),
        upperBound: Math.ceil(upper * EstimateService.INQUIRY_RATE_HIGH),
      },
    };
  }
}
