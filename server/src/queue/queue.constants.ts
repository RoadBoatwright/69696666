/**
 * 队列名称常量（统一注册入口）。
 *
 * 所有 BullMQ 队列名集中在此定义，作为「队列名 → 注册」的单一事实来源。
 * 后续任务（令牌保活、指标拉取、审核轮询、线索回流、商机闭环异步任务等）
 * 注册具体队列与消费者时，必须复用此处常量，避免散落的魔法字符串。
 *
 * 本任务仅建立连接与注册框架，不实现任何具体消费者（Processor）。
 */
export const QUEUE_NAMES = {
  /** 令牌保活与刷新（需求 3.3、3.4、5.4、5.5）。 */
  TOKEN_KEEPALIVE: 'token-keepalive',
  /** 令牌状态扫描：预警/过期/失败计数（需求 5.2、5.3、5.5）。 */
  TOKEN_STATUS_SCAN: 'token-status-scan',
  /** 指标拉取（需求 13.5、13.6）。 */
  METRICS_PULL: 'metrics-pull',
  /** 审核状态轮询（需求 16.1、16.2）。 */
  REVIEW_STATUS_POLL: 'review-status-poll',
  /** 线索回流与重试（需求 12.4、12.7）。 */
  LEAD_INGEST: 'lead-ingest',
} as const;

/** 已登记的队列名联合类型。 */
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * 本批纳入注册框架的队列名集合。
 *
 * {@link QueueModule} 据此批量注册队列（仅建立队列基础设施，
 * 不绑定消费者）。后续任务按需向 {@link QUEUE_NAMES} 与本数组追加。
 */
export const REGISTERED_QUEUE_NAMES: readonly QueueName[] = [
  QUEUE_NAMES.TOKEN_KEEPALIVE,
  QUEUE_NAMES.TOKEN_STATUS_SCAN,
  QUEUE_NAMES.METRICS_PULL,
  QUEUE_NAMES.REVIEW_STATUS_POLL,
  QUEUE_NAMES.LEAD_INGEST,
];
