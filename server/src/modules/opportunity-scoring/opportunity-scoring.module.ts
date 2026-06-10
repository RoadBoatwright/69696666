import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LevelChangeRecord } from './entities/level-change-record.entity';
import { Opportunity } from './entities/opportunity.entity';
import { OpportunityScoringService } from './opportunity-scoring.service';

/**
 * 商机分级引擎（组件 10，需求 16）。
 *
 * 依据背调可信度、画像匹配度与行为数据输出唯一 L1-L4/未分级等级（纯函数），
 * 缺必需输入置「未分级」记缺失项；重算覆盖并记录等级变更轨迹；按等级查询
 * L4 优先且经 RBAC 数据隔离。
 */
@Module({
  imports: [TypeOrmModule.forFeature([Opportunity, LevelChangeRecord])],
  providers: [OpportunityScoringService],
  exports: [OpportunityScoringService],
})
export class OpportunityScoringModule {}
