/**
 * 商机分级引擎领域类型（组件 10，需求 16）。
 */
import type { IntentLevel } from '../entities/opportunity.entity';

export type { IntentLevel };

/** 分级必需输入名称（缺失项记录用，需求 16.3）。 */
export type ScoringInputName = '背调结果' | '画像匹配度' | '行为数据';

/** 行为数据输入（需求 16.1）。 */
export interface BehaviorData {
  /** 是否完整提交高门槛留资表单。 */
  formCompleted: boolean;
  /** 是否对触达有过回复。 */
  repliedToContact: boolean;
  /** 互动强度 0-100（点击/停留等归一化）。 */
  engagementScore: number;
}

/** 分级输入：背调可信度 + 画像匹配度 + 行为数据（需求 16.1）。 */
export interface ScoringInput {
  /** 背调结果（可信度 0-100）；背调不可用/失败时缺失。 */
  verification?: { credibilityScore: number | null };
  /** 画像匹配度 0-1。 */
  personaMatch?: number;
  /** 行为数据。 */
  behavior?: BehaviorData;
}

/** 分级纯函数输出：唯一等级 + 缺失项（需求 16.2、16.3）。 */
export interface ScoreResult {
  level: IntentLevel;
  missingInputs: ScoringInputName[];
}
