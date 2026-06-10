import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccountAuthorization } from '../auth-center/entities/account-authorization.entity';
import { PlatformAdapterModule } from '../platform-adapter/platform-adapter.module';
import { CampaignService } from './campaign.service';
import { Ad } from './entities/ad.entity';
import { AdGroup } from './entities/ad-group.entity';
import { BudgetSchedule } from './entities/budget-schedule.entity';
import { Campaign } from './entities/campaign.entity';
import { Targeting } from './entities/targeting.entity';

/**
 * 广告计划服务（组件 6，需求 8、10、12、13）。
 *
 * 提供三级 CRUD 与约束校验、预算/出价/排期校验、受众定向配置与投放编排状态机。
 * 出价支持集与投放/定向经平台适配器（{@link PlatformAdapterModule}）调用真实官方 API；
 * 授权状态读取自账户授权中心的 {@link AccountAuthorization}。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Campaign,
      AdGroup,
      Ad,
      Targeting,
      BudgetSchedule,
      AccountAuthorization,
    ]),
    PlatformAdapterModule,
  ],
  providers: [CampaignService],
  exports: [CampaignService],
})
export class CampaignModule {}
