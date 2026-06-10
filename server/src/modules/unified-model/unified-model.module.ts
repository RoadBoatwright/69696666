import { Module } from '@nestjs/common';

import { UnifiedModelService } from './unified-model.service';

/**
 * 统一广告模型层（组件 3，需求 6、8、10、33）。
 *
 * 负责「广告系列→广告组→广告」三级统一对象模型、统一字段↔平台原生
 * 字段映射、默认值与不适用标记、统一出价策略枚举与广告版位（自动/手动二选一）。
 * 提供 {@link UnifiedModelService} 供广告计划服务与平台适配器复用。
 */
@Module({
  providers: [UnifiedModelService],
  exports: [UnifiedModelService],
})
export class UnifiedModelModule {}
