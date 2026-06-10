import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { HealthIndicator, type HealthIndicatorResult } from '@nestjs/terminus';
import { Queue } from 'bullmq';

import { QUEUE_NAMES } from '../queue/queue.constants';

/**
 * Redis / BullMQ 连接健康指示器。
 *
 * 通过对已注册队列的底层 Redis 客户端执行 `PING` 判定连通性。
 * 失败时返回 `status: 'down'` 而非抛错使整体启动崩溃，符合优雅
 * 降级原则（需求 1.4）：基础设施不可用时清晰反映在健康检查结果中。
 */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(
    @InjectQueue(QUEUE_NAMES.TOKEN_KEEPALIVE)
    private readonly probeQueue: Queue,
  ) {
    super();
  }

  /**
   * 探测 Redis 连通性。
   *
   * @param key 健康检查结果中的键名。
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // 等待队列底层连接就绪，再以 PING 验证 Redis 连通性。
      await this.probeQueue.waitUntilReady();
      const client = (await this.probeQueue.client) as unknown as {
        ping(): Promise<string>;
      };
      const pong = await client.ping();
      const isUp = pong === 'PONG';
      return this.getStatus(key, isUp, { ping: pong });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.getStatus(key, false, { message });
    }
  }
}
