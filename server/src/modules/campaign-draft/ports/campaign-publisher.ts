import { Injectable } from '@nestjs/common';

import { CampaignService } from '../../campaign/campaign.service';
import type { PlatformDraft } from '../domain/ai-campaign';
import type { CampaignPublisher } from './index';

/**
 * 默认草案投放驱动器（组件 5 端口实现，需求 9.3、9.6）。
 *
 * 将各平台草案落地为广告计划服务的三级创建（系列/组/广告）与投放编排（需求 8、13），
 * 返回创建的广告计划标识集合。投放经平台适配器调用真实官方 API；平台凭据未配置时由广告
 * 计划服务优雅降级（需求 1.5）。
 */
@Injectable()
export class DefaultCampaignPublisher implements CampaignPublisher {
  constructor(private readonly campaigns: CampaignService) {}

  async publishFromDraft(input: {
    merchantId: string;
    platformDrafts: PlatformDraft[];
  }): Promise<string[]> {
    const campaignIds: string[] = [];

    for (const platformDraft of input.platformDrafts) {
      const name =
        (platformDraft.campaign.name as string | undefined) ?? `${platformDraft.platform}-草案计划`;
      const objective = (platformDraft.campaign.objective as string | undefined) ?? 'LEADS';

      // 三级创建：系列 → 组 → 广告（需求 8.2、8.3）。
      const campaign = await this.campaigns.createCampaign({
        merchantId: input.merchantId,
        name,
        objective,
        platform: platformDraft.platform,
      });
      const adGroup = await this.campaigns.createAdGroup({ campaignId: campaign.id });
      await this.campaigns.createAd({ adGroupId: adGroup.id });

      // 投放编排（需求 13）。
      await this.campaigns.publishCampaign(campaign.id);
      campaignIds.push(campaign.id);
    }

    return campaignIds;
  }
}
