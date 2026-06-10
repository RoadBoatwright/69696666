import { Global, Module } from '@nestjs/common';

/**
 * 公共模块：承载跨模块共享的领域类型、纯函数、DTO 与错误定义。
 *
 * 标记为 @Global，使其导出的提供者在整个应用中可注入，
 * 避免在每个业务模块中重复导入。具体提供者将在后续任务中补充。
 */
@Global()
@Module({
  providers: [],
  exports: [],
})
export class CommonModule {}
