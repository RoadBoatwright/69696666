import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import configuration from './config/configuration';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';
import { HealthModule } from './health/health.module';

// 领域核心层
import { CredentialModule } from './modules/credential/credential.module';
import { AuthCenterModule } from './modules/auth-center/auth-center.module';
import { UnifiedModelModule } from './modules/unified-model/unified-model.module';
import { PlatformAdapterModule } from './modules/platform-adapter/platform-adapter.module';

// 应用服务层
import { CampaignModule } from './modules/campaign/campaign.module';
import { AssetModule } from './modules/asset/asset.module';
import { LeadModule } from './modules/lead/lead.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { OptimizerModule } from './modules/optimizer/optimizer.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { RbacModule } from './modules/rbac/rbac.module';

// 平台扩展能力包
import { ExtensionModule } from './modules/extension/extension.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ExperimentModule } from './modules/experiment/experiment.module';
import { EstimateModule } from './modules/estimate/estimate.module';
import { CreativeModule } from './modules/creative/creative.module';

// 商机获客闭环 - 前半段
import { MaterialIntakeModule } from './modules/material-intake/material-intake.module';
import { KnowledgeBaseModule } from './modules/knowledge-base/knowledge-base.module';
import { IndustryReportModule } from './modules/industry-report/industry-report.module';
import { BuyerPersonaModule } from './modules/buyer-persona/buyer-persona.module';
import { CampaignDraftModule } from './modules/campaign-draft/campaign-draft.module';

// 商机获客闭环 - 后半段
import { LeadEnrichmentModule } from './modules/lead-enrichment/lead-enrichment.module';
import { VerificationModule } from './modules/verification/verification.module';
import { OpportunityScoringModule } from './modules/opportunity-scoring/opportunity-scoring.module';
import { FollowupRoutingModule } from './modules/followup-routing/followup-routing.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { OpportunityDashboardModule } from './modules/opportunity-dashboard/opportunity-dashboard.module';
import { BenchmarkModule } from './modules/benchmark/benchmark.module';
import { IndustrySurveyModule } from './modules/industry-survey/industry-survey.module';

/**
 * 根模块。
 *
 * 通过 ConfigModule 全局加载环境变量（数据库、Redis、KMS/加密配置项），
 * 凭据类配置项仅从配置接口/环境注入，禁止硬编码（需求 1.6）。
 * 各业务能力以独立 NestJS 模块组织，当前为骨架占位，逐步在后续任务中实现。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),
    CommonModule,

    // 基础设施层（任务 1.3）：PostgreSQL、Redis/BullMQ、健康检查
    DatabaseModule,
    QueueModule,
    HealthModule,

    // 领域核心层
    CredentialModule,
    AuthCenterModule,
    UnifiedModelModule,
    PlatformAdapterModule,

    // 应用服务层
    CampaignModule,
    AssetModule,
    LeadModule,
    MetricsModule,
    OptimizerModule,
    DashboardModule,
    RbacModule,

    // 平台扩展能力包
    ExtensionModule,
    CatalogModule,
    ExperimentModule,
    EstimateModule,
    CreativeModule,

    // 商机获客闭环 - 前半段
    MaterialIntakeModule,
    KnowledgeBaseModule,
    IndustryReportModule,
    BuyerPersonaModule,
    CampaignDraftModule,

    // 商机获客闭环 - 后半段
    LeadEnrichmentModule,
    VerificationModule,
    OpportunityScoringModule,
    FollowupRoutingModule,
    OpportunityDashboardModule,
    BenchmarkModule,
    IndustrySurveyModule,

    // 异步调度接线（任务 22）
    SchedulingModule,
  ],
})
export class AppModule {}
