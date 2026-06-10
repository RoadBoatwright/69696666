/**
 * 投放编排状态机纯函数库（组件 6，需求 13.1-13.6）。
 *
 * 无副作用，表达投放状态机 `未提交→提交中→已提交/投放失败/投放超时` 的迁移规则、
 * 非有效授权阻止（需求 13.4，Property 28）、提交中拒绝重复（需求 13.6，Property 29）
 * 与首次投放时间写入规则（需求 21/45）。
 */
import type { AccountAuthStatus } from '../../auth-center/entities/account-authorization.entity';
import type { CampaignPublishStatus } from '../entities/campaign.entity';

/** 默认平台响应超时阈值：30 秒（需求 13.2、13.5）。 */
export const DEFAULT_PUBLISH_TIMEOUT_MS = 30_000;

/** 投放前置闸门判定结果。 */
export type PublishGateDecision =
  | { canPublish: true }
  | { canPublish: false; reason: string; keepStatus: CampaignPublishStatus };

/**
 * 判定授权状态是否允许投放（需求 13.4，Property 28）。
 *
 * 仅「有效」授权允许投放；「需重新授权」「授权已撤销」「未授权」均阻止投放
 * 并保持投放状态为「未提交」。
 */
export function isAuthValidForPublish(authStatus: AccountAuthStatus): boolean {
  return authStatus === '有效';
}

/**
 * 投放前置闸门：综合授权状态与当前投放状态判定能否发起本次投放（需求 13.4、13.6）。
 *
 * 判定顺序：
 *  1. 非有效授权 → 阻止，保持「未提交」（需求 13.4，Property 28）。
 *  2. 当前处于「提交中」 → 拒绝重复提交，保持「提交中」（需求 13.6，Property 29）。
 *  3. 否则允许发起投放。
 *
 * @param authStatus 目标平台账户授权状态。
 * @param currentStatus 该计划当前投放状态。
 */
export function evaluatePublishGate(
  authStatus: AccountAuthStatus,
  currentStatus: CampaignPublishStatus,
): PublishGateDecision {
  if (!isAuthValidForPublish(authStatus)) {
    return {
      canPublish: false,
      reason: '目标平台账户授权无效，请先恢复授权',
      keepStatus: '未提交',
    };
  }
  if (currentStatus === '提交中') {
    return {
      canPublish: false,
      reason: '该计划正在投放中',
      keepStatus: '提交中',
    };
  }
  return { canPublish: true };
}

/** 投放调用的归一化结果（成功/失败/超时）。 */
export type PublishCallOutcome =
  | { kind: 'success'; platformObjectId: string }
  | { kind: 'failure'; reason: string }
  | { kind: 'timeout' };

/**
 * 由投放调用结果推导投放后的状态（需求 13.2、13.3、13.5）。
 *
 * - 成功 → 「已提交」。
 * - 失败 → 「投放失败」。
 * - 超时 → 「投放超时」。
 */
export function resolvePublishStatus(outcome: PublishCallOutcome): CampaignPublishStatus {
  switch (outcome.kind) {
    case 'success':
      return '已提交';
    case 'failure':
      return '投放失败';
    case 'timeout':
      return '投放超时';
  }
}

/**
 * 计算首次投放成功时间写入值（需求 21/45：仅首次写入，后续不覆盖）。
 *
 * 当本次投放成功且既有 `firstPublishedAt` 为空时返回本次成功时间；
 * 否则返回既有值（不覆盖）。
 *
 * @param current 既有首次投放时间（可空）。
 * @param outcome 本次投放结果。
 * @param now 本次投放成功的时间。
 */
export function computeFirstPublishedAt(
  current: Date | null,
  outcome: PublishCallOutcome,
  now: Date,
): Date | null {
  if (outcome.kind === 'success' && current == null) {
    return now;
  }
  return current;
}

/**
 * 以超时阈值包裹一个投放调用 Promise（需求 13.2、13.5）。
 *
 * 在 `timeoutMs` 内返回平台响应（成功/失败）；超过阈值未响应则归一化为 `timeout`，
 * 并清理计时器避免悬挂句柄。平台调用抛错时归一化为 `failure`（携带原因）。
 *
 * @param call 实际的平台投放调用，解析为平台对象标识。
 * @param timeoutMs 超时阈值（毫秒），缺省 30 秒。
 */
export async function callWithTimeout(
  call: () => Promise<string>,
  timeoutMs: number = DEFAULT_PUBLISH_TIMEOUT_MS,
): Promise<PublishCallOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PublishCallOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
  });

  const invocation: Promise<PublishCallOutcome> = call()
    .then((platformObjectId) => ({ kind: 'success', platformObjectId }) as PublishCallOutcome)
    .catch(
      (error: unknown) =>
        ({
          kind: 'failure',
          reason: error instanceof Error ? error.message : String(error),
        }) as PublishCallOutcome,
    );

  try {
    return await Promise.race([invocation, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
