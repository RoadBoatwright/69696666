import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CredentialModule } from '../credential/credential.module';
import { Metric } from '../metrics/entities';
import { Opportunity } from '../opportunity-scoring/entities/opportunity.entity';
import { DashboardService } from './dashboard.service';

/**
 * 效果看板模块（组件 14，任务 23，需求 21.1-21.12）。
 *
 * 提供按平台/时间范围的聚合看板、5 个业务指标纯函数与客户行业调查报告导出；
 * 缺失维度互相隔离，AI 洞察经凭据管理器调用真实 Gemini 中转。
 */
@Module({
  imports: [TypeOrmModule.forFeature([Metric, Opportunity]), CredentialModule],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
