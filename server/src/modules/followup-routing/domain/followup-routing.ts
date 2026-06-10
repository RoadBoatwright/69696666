/**
 * 跟进路由服务领域类型（组件 11，需求 17、21.6）。
 */
import type { FollowUpStatus } from '../entities/followup-record.entity';
import type { ReplyChannel } from '../entities/buyer-reply-event.entity';

export type { FollowUpStatus, ReplyChannel };

/** 跟进通道取值域。 */
export type FollowUpChannel = 'whatsapp' | 'crm';

/** 状态机事件（需求 17.1、17.3、17.6、17.7）。 */
export interface RouteEvent {
  /** 目标通道是否已配置（需求 17.6）。 */
  channelsConfigured: boolean;
  /** 路由调用是否成功（仅通道已配置时有意义，需求 17.3、17.7）。 */
  routeSucceeded?: boolean;
}

/** 跟进剧本输入（需求 17.5）。 */
export interface PlaybookInputs {
  /** 商机意向等级。 */
  intentLevel: string;
  /** 买家公司名。 */
  companyName?: string | null;
  /** 买家行业。 */
  industry?: string | null;
  /** 买家职位。 */
  jobTitle?: string | null;
  /** 背调摘要。 */
  verificationSummary?: string | null;
}

/** 销售跟进剧本（需求 17.5）。 */
export interface FollowupPlaybook {
  /** 开场白建议。 */
  opening: string;
  /** 跟进要点。 */
  talkingPoints: string[];
  /** 建议跟进节奏。 */
  cadence: string;
}

/** 路由降级结果：通道未配置保持「待路由」（需求 17.6）。 */
export interface ChannelUnconfigured {
  kind: 'channel_unconfigured';
  /** 未配置的通道集合。 */
  channels: FollowUpChannel[];
}
