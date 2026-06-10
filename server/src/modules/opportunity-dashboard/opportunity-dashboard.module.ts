import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FollowupRecord } from '../followup-routing/entities';
import { LevelChangeRecord } from '../opportunity-scoring/entities';
import { Opportunity } from '../opportunity-scoring/entities/opportunity.entity';
import { VerificationResult, VerifiedField } from '../verification/entities';
import { OpportunityDashboardService } from './opportunity-dashboard.service';

/**
 * 商机清单/单客户详情/导出模块（任务 23.6-23.8，需求 21.13-21.17）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Opportunity,
      VerificationResult,
      VerifiedField,
      LevelChangeRecord,
      FollowupRecord,
    ]),
  ],
  providers: [OpportunityDashboardService],
  exports: [OpportunityDashboardService],
})
export class OpportunityDashboardModule {}
