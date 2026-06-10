import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Opportunity } from '../opportunity-scoring/entities/opportunity.entity';
import { PlatformAdapterModule } from '../platform-adapter/platform-adapter.module';
import { Lead } from './entities/lead.entity';
import { LeadForm } from './entities/lead-form.entity';
import { LeadService } from './lead.service';

/**
 * 线索收集服务（组件 8，需求 14）。
 *
 * 提供高门槛留资表单配置（公司名/姓名/电话/邮箱必填，字段 1-30）、经平台适配器
 * 挂载表单至目标平台（已关联/关联失败）、买家留资回流与升格商机、按来源平台线索
 * 标识去重保留最早、失败保留原始数据待重试，以及留资质量闸门（格式/一次性邮箱/
 * 占位值/机器人批量反作弊/企业身份初判，低质量/疑似作弊区分存储不计入有效线索）。
 *
 * 表单挂载经 {@link PlatformAdapterModule} 调用真实平台官方 API；升格商机写入
 * {@link Opportunity}（与背调/分级/跟进共享）。
 */
@Module({
  imports: [TypeOrmModule.forFeature([Lead, LeadForm, Opportunity]), PlatformAdapterModule],
  providers: [LeadService],
  exports: [LeadService],
})
export class LeadModule {}
