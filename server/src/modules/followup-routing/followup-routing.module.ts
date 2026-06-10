import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Opportunity } from '../opportunity-scoring/entities/opportunity.entity';
import { BuyerReplyEvent } from './entities/buyer-reply-event.entity';
import { FollowupRecord } from './entities/followup-record.entity';
import { FollowUpRoutingService } from './followup-routing.service';
import { DefaultFollowUpChannelGateway, FOLLOWUP_CHANNEL_GATEWAY } from './ports/channel-gateway';

/**
 * 跟进路由服务（组件 11，需求 17、21.6）。
 *
 * 高意向商机自动/手动路由至企业 WhatsApp（真实 WhatsApp Business Cloud API）
 * 或 CRM（入站 Webhook）：通道未配置保持「待路由」不丢商机、失败置「路由失败」
 * 待重试、成功路由后生成销售跟进剧本；记录买家回复供有效联络率判定。
 */
@Module({
  imports: [TypeOrmModule.forFeature([FollowupRecord, BuyerReplyEvent, Opportunity])],
  providers: [
    FollowUpRoutingService,
    DefaultFollowUpChannelGateway,
    { provide: FOLLOWUP_CHANNEL_GATEWAY, useExisting: DefaultFollowUpChannelGateway },
  ],
  exports: [FollowUpRoutingService],
})
export class FollowupRoutingModule {}
