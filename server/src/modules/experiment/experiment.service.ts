import { Injectable } from '@nestjs/common';

import { GoogleCapabilitiesService } from '../extension/capabilities/google-capabilities.service';
import { MetaCapabilitiesService } from '../extension/capabilities/meta-capabilities.service';
import { TikTokCapabilitiesService } from '../extension/capabilities/tiktok-capabilities.service';
import type { CapabilityValidationError } from '../extension/domain/extension';
import {
  ExtensionGatewayService,
  type GatewayResult,
} from '../extension/extension-gateway.service';
import { validateExperimentGroups } from '../extension/pure';
import type { PlatformId } from '../platform-adapter/domain/platform-adapter';

/** 实验各组归一化效果指标（需求 28.3）。 */
export interface ExperimentGroupResult {
  group: string;
  raw: Record<string, unknown>;
}

/**
 * A/B 实验服务（任务 34，需求 28）。
 *
 * 统一实验抽象覆盖 Meta Split Test / Google Experiments / TikTok Split Test
 * （需求 28.1）；创建经各平台**真实 API** 完成并返回实验标识（需求 28.2）；结果按
 * 分组归一化回传（需求 28.3）；分组少于两个时返回「实验分组数量不足」（需求 28.4）。
 */
@Injectable()
export class ExperimentService {
  constructor(
    private readonly gateway: ExtensionGatewayService,
    private readonly meta: MetaCapabilitiesService,
    private readonly google: GoogleCapabilitiesService,
    private readonly tiktok: TikTokCapabilitiesService,
  ) {}

  /** 创建实验并返回实验标识（需求 28.2、28.4）。 */
  async createExperiment(
    platform: PlatformId,
    accountRef: string,
    name: string,
    groups: Record<string, unknown>[],
  ): Promise<
    | GatewayResult<{ experimentId: string }>
    | { kind: 'invalid'; errors: CapabilityValidationError[] }
  > {
    const validation = validateExperimentGroups(groups);
    if (!validation.ok) {
      return { kind: 'invalid', errors: validation.errors };
    }
    return this.gateway.invoke('ab_experiment', platform, () => {
      if (platform === 'meta') {
        return this.meta.createSplitTest(accountRef, name, groups);
      }
      if (platform === 'google') {
        return this.google.createExperiment(accountRef, name, groups);
      }
      return this.tiktok.createSplitTest(accountRef, name, groups);
    });
  }

  /** 读取实验结果并按分组归一化（需求 28.3）。 */
  async getResults(
    platform: PlatformId,
    accountRef: string,
    experimentId: string,
  ): Promise<GatewayResult<ExperimentGroupResult[]>> {
    return this.gateway.invoke('ab_experiment', platform, async () => {
      let rows: Record<string, unknown>[];
      if (platform === 'meta') {
        rows = await this.meta.getSplitTestResults(experimentId);
      } else if (platform === 'google') {
        rows = await this.google.getExperimentResults(accountRef, experimentId);
      } else {
        rows = await this.tiktok.getSplitTestResults(accountRef, experimentId);
      }
      return rows.map((raw, index) => ({
        group: String(
          (raw.name as string | undefined) ??
            (raw.split_test_group_name as string | undefined) ??
            `group_${index + 1}`,
        ),
        raw,
      }));
    });
  }
}
