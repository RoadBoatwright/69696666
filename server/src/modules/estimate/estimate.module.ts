import { Module } from '@nestjs/common';

import { ExtensionModule } from '../extension/extension.module';
import { EstimateService } from './estimate.service';

/**
 * 询盘量级与预算建议（投前预估）服务（任务 35，需求 29）。
 *
 * Meta Reach Estimate + Google Reach Forecasting 真实 API，归一化为统一口径区间；
 * TikTok 不支持时经网关降级。
 */
@Module({
  imports: [ExtensionModule],
  providers: [EstimateService],
  exports: [EstimateService],
})
export class EstimateModule {}
