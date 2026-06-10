import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthCenterModule } from '../auth-center/auth-center.module';
import { TokenRecord } from '../auth-center/entities';
import { FollowupRoutingModule } from '../followup-routing/followup-routing.module';
import { MetricsModule } from '../metrics/metrics.module';
import { Opportunity } from '../opportunity-scoring/entities/opportunity.entity';
import { OpportunityScoringModule } from '../opportunity-scoring/opportunity-scoring.module';
import { PlatformAdapterModule } from '../platform-adapter/platform-adapter.module';
import { VerificationModule } from '../verification/verification.module';
import { SCHEDULING_PROCESSORS } from './scheduling.processors';
import { SchedulingService } from './scheduling.service';

/**
 * 异步调度接线模块（任务 22，需求 2.4、5.2、15.2、15.6、16.5、17.3、17.7、18.5、20.1）。
 *
 * 把令牌保活/状态扫描、指标 15 分钟拉取、审核 15 分钟轮询接为 BullMQ 周期任务，
 * 并提供线索回流后背调触发（失败重试）、分级重算、自动跟进路由（失败重试）的
 * 事件入队入口；消费者把执行委派给对应业务服务（真实服务原则不变）。
 *
 * 队列注册由全局 {@link QueueModule} 统一提供。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([TokenRecord, Opportunity]),
    AuthCenterModule,
    MetricsModule,
    VerificationModule,
    OpportunityScoringModule,
    FollowupRoutingModule,
    PlatformAdapterModule,
  ],
  providers: [SchedulingService, ...SCHEDULING_PROCESSORS],
  exports: [SchedulingService],
})
export class SchedulingModule {}
