/**
 * 跟进路由纯函数库（组件 11，需求 17.1、17.3、17.5-17.7）。
 */
import type {
  FollowUpStatus,
  FollowupPlaybook,
  PlaybookInputs,
  RouteEvent,
} from '../domain/followup-routing';

/**
 * 跟进状态机（确定性纯函数，需求 17.1、17.3、17.6、17.7）。
 *
 * - 通道未配置：保持「待路由」不丢商机（需求 17.6）。
 * - 通道已配置且路由成功：置「已触达」（需求 17.3）；已在「已触达/跟进中」则保持「跟进中」推进。
 * - 通道已配置且路由失败：置「路由失败」保留待重试（需求 17.7）。
 * - 输出唯一且属于四态（需求 17.1）。
 */
export function nextStatus(current: FollowUpStatus, e: RouteEvent): FollowUpStatus {
  if (!e.channelsConfigured) {
    return current === '待路由' || current === '路由失败' ? '待路由' : current;
  }
  if (e.routeSucceeded === true) {
    return current === '已触达' || current === '跟进中' ? '跟进中' : '已触达';
  }
  if (e.routeSucceeded === false) {
    return '路由失败';
  }
  return current;
}

/** 生成销售跟进剧本（确定性纯函数，需求 17.5）。 */
export function generatePlaybook(inputs: PlaybookInputs): FollowupPlaybook {
  const company = inputs.companyName?.trim() || '贵公司';
  const role = inputs.jobTitle?.trim() || '负责人';
  const industry = inputs.industry?.trim() || '相关行业';
  const highIntent = inputs.intentLevel === 'L3' || inputs.intentLevel === 'L4';
  return {
    opening: `您好，${company} 的${role}，看到您对我们${industry}解决方案的咨询，想跟您进一步沟通需求。`,
    talkingPoints: [
      `客户意向等级：${inputs.intentLevel}`,
      ...(inputs.verificationSummary ? [`背调摘要：${inputs.verificationSummary}`] : []),
      `行业切入点：围绕${industry}的痛点与方案价值展开`,
      highIntent ? '高意向客户：直接推进报价/样品/会议邀约' : '中低意向客户：以价值内容培育为主',
    ],
    cadence: highIntent ? '24 小时内首次触达，48 小时内跟进' : '72 小时内首次触达，每周跟进',
  };
}
