/**
 * 商机分级纯函数库（组件 10，需求 16.1-16.4）。
 */
import type {
  IntentLevel,
  ScoreResult,
  ScoringInput,
  ScoringInputName,
} from '../domain/opportunity-scoring';

/** 等级权重：L4=4 > L3=3 > L2=2 > L1=1 > 未分级=0（需求 16.4）。 */
export function levelRank(level: IntentLevel): number {
  switch (level) {
    case 'L4':
      return 4;
    case 'L3':
      return 3;
    case 'L2':
      return 2;
    case 'L1':
      return 1;
    default:
      return 0;
  }
}

/** 限幅到 [0, 1]。 */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * 计算商机意向等级（确定性纯函数，需求 16.1-16.3）。
 *
 * - 任一必需输入缺失（背调可信度/画像匹配度/行为数据）→「未分级」并记缺失项（需求 16.3）。
 * - 综合分 = 背调可信度(0-1)×0.4 + 画像匹配度(0-1)×0.3 + 行为分(0-1)×0.3。
 *   行为分 = 表单完整提交 0.4 + 有回复 0.4 + 互动强度(0-1)×0.2。
 * - 阈值：≥0.8→L4，≥0.6→L3，≥0.4→L2，其余→L1。输出唯一等级（需求 16.2）。
 */
export function score(input: ScoringInput): ScoreResult {
  const missingInputs: ScoringInputName[] = [];
  if (
    input.verification === undefined ||
    input.verification.credibilityScore === null ||
    !Number.isFinite(input.verification.credibilityScore)
  ) {
    missingInputs.push('背调结果');
  }
  if (input.personaMatch === undefined || !Number.isFinite(input.personaMatch)) {
    missingInputs.push('画像匹配度');
  }
  if (input.behavior === undefined) {
    missingInputs.push('行为数据');
  }
  if (missingInputs.length > 0) {
    return { level: '未分级', missingInputs };
  }

  const credibility = clamp01(input.verification!.credibilityScore! / 100);
  const personaMatch = clamp01(input.personaMatch!);
  const b = input.behavior!;
  const behaviorScore =
    (b.formCompleted ? 0.4 : 0) +
    (b.repliedToContact ? 0.4 : 0) +
    clamp01(b.engagementScore / 100) * 0.2;

  const composite = credibility * 0.4 + personaMatch * 0.3 + behaviorScore * 0.3;
  const level: IntentLevel =
    composite >= 0.8 ? 'L4' : composite >= 0.6 ? 'L3' : composite >= 0.4 ? 'L2' : 'L1';
  return { level, missingInputs: [] };
}

/** 按意向等级降序排序（L4 优先，权重非递增，需求 16.4）。 */
export function sortByLevelDesc<T extends { intentLevel: IntentLevel }>(items: T[]): T[] {
  return [...items].sort((a, b) => levelRank(b.intentLevel) - levelRank(a.intentLevel));
}
