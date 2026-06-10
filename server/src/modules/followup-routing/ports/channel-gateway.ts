import { Injectable } from '@nestjs/common';

import type { FollowUpChannel, FollowupPlaybook } from '../domain/followup-routing';

/** 触达载荷：买家联系方式 + 跟进剧本开场白。 */
export interface RoutePayload {
  opportunityId: string;
  phone?: string | null;
  email?: string | null;
  playbook: FollowupPlaybook;
}

/** 跟进通道网关端口（需求 17.3、17.4）。 */
export interface FollowUpChannelGateway {
  /** 通道是否已配置（需求 17.6）。 */
  isConfigured(channel: FollowUpChannel): boolean;
  /** 经真实通道发起触达（需求 17.3、17.4）。 */
  route(channel: FollowUpChannel, payload: RoutePayload): Promise<void>;
}

export const FOLLOWUP_CHANNEL_GATEWAY = Symbol('FOLLOWUP_CHANNEL_GATEWAY');

/** WhatsApp Cloud API 基址（Meta Graph API，真实服务）。 */
const WHATSAPP_API_BASE = 'https://graph.facebook.com/v19.0';

/** 通道调用超时（毫秒）。 */
const CHANNEL_TIMEOUT_MS = 15_000;

/**
 * 默认跟进通道网关（需求 17.3、17.4、17.6）。
 *
 * - WhatsApp：经**真实 WhatsApp Business Cloud API**（Meta Graph）发送模板消息；
 *   依赖环境变量 `WHATSAPP_PHONE_NUMBER_ID` 与 `WHATSAPP_ACCESS_TOKEN`（占位待填）。
 * - CRM：经环境变量 `CRM_WEBHOOK_URL` 指向的企业 CRM 入站接口直推商机（占位待填）。
 *
 * 任一变量未配置即视为通道未配置，路由层降级保持「待路由」（需求 17.6），
 * 绝不以假发送顶替业务逻辑。
 */
@Injectable()
export class DefaultFollowUpChannelGateway implements FollowUpChannelGateway {
  isConfigured(channel: FollowUpChannel): boolean {
    if (channel === 'whatsapp') {
      return (
        (process.env.WHATSAPP_PHONE_NUMBER_ID ?? '').trim() !== '' &&
        (process.env.WHATSAPP_ACCESS_TOKEN ?? '').trim() !== ''
      );
    }
    return (process.env.CRM_WEBHOOK_URL ?? '').trim() !== '';
  }

  async route(channel: FollowUpChannel, payload: RoutePayload): Promise<void> {
    if (channel === 'whatsapp') {
      await this.routeWhatsApp(payload);
      return;
    }
    await this.routeCrm(payload);
  }

  private async routeWhatsApp(payload: RoutePayload): Promise<void> {
    const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID ?? '').trim();
    const token = (process.env.WHATSAPP_ACCESS_TOKEN ?? '').trim();
    if (!phoneNumberId || !token) {
      throw new Error('WhatsApp 通道未配置');
    }
    if (!payload.phone) {
      throw new Error('买家电话缺失，无法经 WhatsApp 触达');
    }
    await this.post(
      `${WHATSAPP_API_BASE}/${phoneNumberId}/messages`,
      { authorization: `Bearer ${token}` },
      {
        messaging_product: 'whatsapp',
        to: payload.phone.replace(/[^+\d]/g, ''),
        type: 'text',
        text: { body: payload.playbook.opening },
      },
    );
  }

  private async routeCrm(payload: RoutePayload): Promise<void> {
    const url = (process.env.CRM_WEBHOOK_URL ?? '').trim();
    if (!url) {
      throw new Error('CRM 通道未配置');
    }
    await this.post(url, {}, payload);
  }

  private async post(url: string, headers: Record<string, string>, body: unknown): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHANNEL_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`通道调用失败：HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
