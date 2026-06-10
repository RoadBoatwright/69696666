import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CredentialModule } from '../credential/credential.module';
import { CampaignModule } from '../campaign/campaign.module';
import { Ad } from '../campaign/entities/ad.entity';
import { AdGroup } from '../campaign/entities/ad-group.entity';
import { Metric } from '../metrics/entities/metric.entity';
import { Opportunity } from '../opportunity-scoring/entities/opportunity.entity';
import { AiCampaignService } from './ai-campaign.service';
import { CampaignDraft } from './entities/campaign-draft.entity';
import { ReviewModeConfig } from './entities/review-mode-config.entity';
import { CAMPAIGN_PUBLISHER, GEMINI_CLIENT, OPTIMIZATION_DATA_PROVIDER } from './ports';
import { DefaultGeminiClient } from './ports/gemini-client';
import { DefaultCampaignPublisher } from './ports/campaign-publisher';
import { DefaultOptimizationDataProvider } from './ports/optimization-data-provider';

/**
 * AI 辅助建广告引擎（组件 5，需求 9）。
 *
 * 提供买家画像 AI 自动推导、多平台草案生成、人工审核模式两级配置、草案确认状态机与
 * 投放优化（以「有效高意向商机数」为目标）。底层生成式 AI 经 {@link DefaultGeminiClient}
 * 调用真实 Google Gemini API（凭据经凭据管理器 `useDecrypted('gemini')` 取用）；优化数据经
 * {@link DefaultOptimizationDataProvider} 读取真实回传指标与商机回流统计；草案确认后经
 * {@link DefaultCampaignPublisher} 驱动广告计划服务进入创建+投放。
 *
 * 凭据为占位符未填入时，AI 能力降级为不可用，其余功能正常运行（需求 9.7）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CampaignDraft, ReviewModeConfig, Metric, Ad, AdGroup, Opportunity]),
    CredentialModule,
    CampaignModule,
  ],
  providers: [
    AiCampaignService,
    { provide: GEMINI_CLIENT, useClass: DefaultGeminiClient },
    { provide: OPTIMIZATION_DATA_PROVIDER, useClass: DefaultOptimizationDataProvider },
    { provide: CAMPAIGN_PUBLISHER, useClass: DefaultCampaignPublisher },
    // AUTO_ADJUSTMENT_APPLIER 为可选端口：默认不提供（仅记录应用决策），
    // 由平台扩展能力包在接线时按平台官方 API 提供真实实现（需求 9.11、9.14）。
  ],
  exports: [AiCampaignService],
})
export class CampaignDraftModule {}
