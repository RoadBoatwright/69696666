import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { levelRank } from '../opportunity-scoring/pure';
import { Opportunity } from '../opportunity-scoring/entities/opportunity.entity';
import type { IntentLevel } from '../opportunity-scoring/entities/opportunity.entity';
import type { Actor } from '../rbac/domain/rbac';
import { authorize } from '../rbac/pure';
import { BuyerReplyEvent } from './entities/buyer-reply-event.entity';
import { FollowupRecord } from './entities/followup-record.entity';
import {
  FOLLOWUP_CHANNEL_GATEWAY,
  type FollowUpChannelGateway,
  type RoutePayload,
} from './ports/channel-gateway';
import { generatePlaybook, nextStatus } from './pure';
import type {
  ChannelUnconfigured,
  FollowUpChannel,
  PlaybookInputs,
  ReplyChannel,
} from './domain/followup-routing';

/** 商机不存在错误。 */
export class RoutingOpportunityNotFoundError extends Error {
  constructor(public readonly opportunityId: string) {
    super('商机不存在');
    this.name = 'RoutingOpportunityNotFoundError';
  }
}

/** 越权错误（需求 7.4）。 */
export class RoutingForbiddenError extends Error {
  constructor() {
    super('权限不足');
    this.name = 'RoutingForbiddenError';
  }
}

/**
 * 跟进路由服务（组件 11，需求 17、21.6）。
 *
 * - 状态机 `nextStatus` 纯函数：四态唯一（需求 17.1，Property 42）。
 * - 达阈值且通道配置自动路由置「已触达」（需求 17.3）。
 * - 通道未配置保持「待路由」不丢商机（需求 17.6）。
 * - 失败置「路由失败」记录原因待重试（需求 17.7）。
 * - 成功路由后生成销售跟进剧本（需求 17.5）。
 * - `recordBuyerReply` 记录买家回复供有效联络率判定（需求 21.6）。
 */
@Injectable()
export class FollowUpRoutingService {
  private readonly logger = new Logger(FollowUpRoutingService.name);

  constructor(
    @InjectRepository(FollowupRecord)
    private readonly recordRepo: Repository<FollowupRecord>,
    @InjectRepository(BuyerReplyEvent)
    private readonly replyRepo: Repository<BuyerReplyEvent>,
    @InjectRepository(Opportunity)
    private readonly opportunityRepo: Repository<Opportunity>,
    @Inject(FOLLOWUP_CHANNEL_GATEWAY)
    private readonly gateway: FollowUpChannelGateway,
  ) {}

  /** 生成销售跟进剧本（纯函数转发，需求 17.5）。 */
  generatePlaybook(inputs: PlaybookInputs): ReturnType<typeof generatePlaybook> {
    return generatePlaybook(inputs);
  }

  /**
   * 达阈值自动路由（需求 17.2、17.3、17.6、17.7）。
   *
   * 等级未达阈值不路由；达阈值优先 WhatsApp，未配置回退 CRM；均未配置降级
   * 保持「待路由」（需求 17.6）。
   */
  async autoRoute(
    opp: Opportunity,
    threshold: IntentLevel,
    contact: { phone?: string | null; email?: string | null } = {},
  ): Promise<FollowupRecord | ChannelUnconfigured | { kind: 'below_threshold' }> {
    if (levelRank(opp.intentLevel) < levelRank(threshold)) {
      return { kind: 'below_threshold' };
    }
    const channels: FollowUpChannel[] = this.gateway.isConfigured('whatsapp')
      ? ['whatsapp']
      : this.gateway.isConfigured('crm')
        ? ['crm']
        : [];
    if (channels.length === 0) {
      await this.applyTransition(opp, { channelsConfigured: false });
      return { kind: 'channel_unconfigured', channels: ['whatsapp', 'crm'] };
    }
    return this.routeThrough(opp, channels, contact);
  }

  /** 手动路由到指定通道集（需求 17.4、17.6、17.7）。 */
  async manualRoute(
    actor: Actor | null,
    oppId: string,
    channels: FollowUpChannel[],
    contact: { phone?: string | null; email?: string | null } = {},
  ): Promise<FollowupRecord | ChannelUnconfigured> {
    const opp = await this.opportunityRepo.findOne({ where: { id: oppId } });
    if (!opp) {
      throw new RoutingOpportunityNotFoundError(oppId);
    }
    const decision = authorize(actor, 'update', {
      type: 'opportunity',
      resourceId: opp.id,
      ownerMerchantId: opp.ownerMerchantId,
    });
    if (!decision.allowed) {
      throw new RoutingForbiddenError();
    }
    const unconfigured = channels.filter((c) => !this.gateway.isConfigured(c));
    if (unconfigured.length === channels.length) {
      await this.applyTransition(opp, { channelsConfigured: false });
      return { kind: 'channel_unconfigured', channels: unconfigured };
    }
    return this.routeThrough(
      opp,
      channels.filter((c) => this.gateway.isConfigured(c)),
      contact,
    );
  }

  /** 记录买家回复，状态推进为「跟进中」（需求 21.6）。 */
  async recordBuyerReply(
    oppId: string,
    channel: ReplyChannel,
    repliedAt: Date,
  ): Promise<BuyerReplyEvent> {
    const opp = await this.opportunityRepo.findOne({ where: { id: oppId } });
    if (!opp) {
      throw new RoutingOpportunityNotFoundError(oppId);
    }
    const event = await this.replyRepo.save(
      this.replyRepo.create({ opportunityId: oppId, channel, repliedAt }),
    );
    if (opp.followupStatus === '已触达') {
      await this.applyTransition(opp, { channelsConfigured: true, routeSucceeded: true });
    }
    return event;
  }

  private async routeThrough(
    opp: Opportunity,
    channels: FollowUpChannel[],
    contact: { phone?: string | null; email?: string | null },
  ): Promise<FollowupRecord> {
    const playbook = generatePlaybook({
      intentLevel: opp.intentLevel,
      companyName: null,
      industry: null,
      jobTitle: null,
    });
    const payload: RoutePayload = {
      opportunityId: opp.id,
      phone: contact.phone ?? null,
      email: contact.email ?? null,
      playbook,
    };
    try {
      for (const channel of channels) {
        await this.gateway.route(channel, payload);
      }
      const status = await this.applyTransition(opp, {
        channelsConfigured: true,
        routeSucceeded: true,
      });
      return this.upsertRecord(opp.id, {
        status,
        channels,
        playbook,
        failureReason: null,
        reachedAt: new Date(),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : '路由调用失败';
      this.logger.warn(`路由失败待重试：opportunityId=${opp.id}, 原因=${reason}`);
      const status = await this.applyTransition(opp, {
        channelsConfigured: true,
        routeSucceeded: false,
      });
      return this.upsertRecord(opp.id, { status, channels, failureReason: reason });
    }
  }

  private async applyTransition(
    opp: Opportunity,
    e: { channelsConfigured: boolean; routeSucceeded?: boolean },
  ): Promise<Opportunity['followupStatus']> {
    const next = nextStatus(opp.followupStatus, e);
    if (next !== opp.followupStatus) {
      opp.followupStatus = next;
      await this.opportunityRepo.save(opp);
    }
    return next;
  }

  private async upsertRecord(
    opportunityId: string,
    patch: Partial<FollowupRecord>,
  ): Promise<FollowupRecord> {
    const existing = await this.recordRepo.findOne({ where: { opportunityId } });
    if (existing) {
      Object.assign(existing, patch);
      return this.recordRepo.save(existing);
    }
    return this.recordRepo.save(this.recordRepo.create({ opportunityId, ...patch }));
  }
}
