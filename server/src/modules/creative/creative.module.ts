import { Module } from '@nestjs/common';

import { ExtensionModule } from '../extension/extension.module';

/**
 * AI 创意增强（任务 37，需求 31）。
 *
 * 统一入口由 ExtensionService.generateCreatives 提供（TikTok Symphony / Google
 * 生成式资产 / Meta 动态创意），本模块仅做能力聚合再导出。
 */
@Module({
  imports: [ExtensionModule],
  exports: [ExtensionModule],
})
export class CreativeModule {}
