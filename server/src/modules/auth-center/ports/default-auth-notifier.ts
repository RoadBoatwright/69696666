import { Injectable, Logger } from '@nestjs/common';

import type { AuthNotifier } from './index';

/**
 * 默认管理员通知器（需求 3.4、5.2、5.5）。
 *
 * 当前以日志形式投递通知，恒返回发送成功；后续可替换为邮件/IM/站内信通道。
 * 通知文本不含凭据明文。
 */
@Injectable()
export class DefaultAuthNotifier implements AuthNotifier {
  private readonly logger = new Logger(DefaultAuthNotifier.name);

  async notify(message: string): Promise<boolean> {
    this.logger.warn(`[授权预警] ${message}`);
    return true;
  }
}
