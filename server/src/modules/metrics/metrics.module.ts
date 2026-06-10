import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PlatformAdapterModule } from '../platform-adapter/platform-adapter.module';
import { ConversionConfig, ConversionEvent, Metric, ReviewStatus } from './entities';
import { MetricsService } from './metrics.service';

/**
 * 数据回传服务与审核同步（组件 12、13，需求 18、19、20）。
 *
 * 指标拉取/归一化/ROI（花费为零标「不可计算」）、单平台失败隔离、转化追踪配置与
 * 事件关联（matched|unmatched）、审核状态三态归一化与变更通知，全部经平台适配器
 * 调用真实官方 API。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Metric, ConversionConfig, ConversionEvent, ReviewStatus]),
    PlatformAdapterModule,
  ],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
