import { Module } from '@nestjs/common';

import { ExtensionModule } from '../extension/extension.module';
import { ExperimentService } from './experiment.service';

/**
 * A/B 实验服务（任务 34，需求 28）。
 *
 * 统一实验抽象（Meta Split Test / Google Experiments / TikTok Split Test），经
 * 扩展能力网关路由到各平台真实 API。
 */
@Module({
  imports: [ExtensionModule],
  providers: [ExperimentService],
  exports: [ExperimentService],
})
export class ExperimentModule {}
