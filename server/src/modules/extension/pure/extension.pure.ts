import type { CredentialConfigStatus } from '../../../common/domain/credential';
import type { BiddingStrategy, PlatformId } from '../../platform-adapter/domain/platform-adapter';
import {
  CAPABILITY_SUPPORT,
  type CapabilityId,
  type CapabilityRouting,
  type CapabilityValidation,
  type CapabilityValidationError,
} from '../domain/extension';

/**
 * 扩展能力路由判定纯函数（需求 22.2、22.3、22.4、34.3）。
 *
 * - LinkedIn 平台的任何调用在第二期实现前一律返回「该能力第二期提供」（需求 34.3）。
 * - 平台不在能力支持集合内 → 「该平台不支持此能力」且不执行调用（需求 22.3）。
 * - 平台凭据「未填入」→ 「该平台凭据未配置」并标记不可用，其余平台不受影响（需求 22.4）。
 * - 其余情况路由至对应平台适配器执行（需求 22.2）。
 */
export function routeCapability(
  capability: CapabilityId,
  platform: PlatformId,
  credentialStatus: CredentialConfigStatus,
): CapabilityRouting {
  if (platform === 'linkedin') {
    return { kind: 'deferred', error: '该能力第二期提供', capability, platform };
  }
  if (!CAPABILITY_SUPPORT[capability].includes(platform)) {
    return { kind: 'unsupported', error: '该平台不支持此能力', capability, platform };
  }
  if (credentialStatus !== 'filled') {
    return { kind: 'credential_missing', error: '该平台凭据未配置', capability, platform };
  }
  return { kind: 'route', capability, platform };
}

/** Advantage+ 必填硬控制项（需求 23.2、23.4）。 */
const ADVANTAGE_PLUS_REQUIRED = ['geoLocations', 'languages', 'minAge'] as const;

/**
 * 校验 Meta Advantage+ 系列硬控制项（需求 23.2、23.4）。
 *
 * 必填：地域、语言、最低年龄；最低年龄须为 ≥18 的有限数；排除条件与特殊广告
 * 类别为可选项但若提供须为合法集合。
 */
export function validateAdvantagePlusControls(controls: {
  geoLocations?: unknown;
  languages?: unknown;
  minAge?: unknown;
  exclusions?: unknown;
  specialAdCategories?: unknown;
}): CapabilityValidation {
  const errors: CapabilityValidationError[] = [];
  for (const field of ADVANTAGE_PLUS_REQUIRED) {
    if (controls[field] === undefined || controls[field] === null) {
      errors.push({ field, reason: '硬控制项缺失' });
    }
  }
  if (controls.minAge !== undefined && controls.minAge !== null) {
    const age = Number(controls.minAge);
    if (!Number.isFinite(age) || age < 18) {
      errors.push({ field: 'minAge', reason: '最低年龄须为不小于 18 的数值' });
    }
  }
  if (controls.geoLocations !== undefined && controls.geoLocations !== null) {
    if (!Array.isArray(controls.geoLocations) || controls.geoLocations.length === 0) {
      errors.push({ field: 'geoLocations', reason: '地域须为非空列表' });
    }
  }
  if (controls.languages !== undefined && controls.languages !== null) {
    if (!Array.isArray(controls.languages) || controls.languages.length === 0) {
      errors.push({ field: 'languages', reason: '语言须为非空列表' });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/** PMax 资产组必填资产类别（需求 25.2、25.3）。 */
const PMAX_REQUIRED_ASSETS = ['headlines', 'descriptions', 'images'] as const;

/** 校验 Google Performance Max 资产组（需求 25.3）：列出**全部**不符合项。 */
export function validatePmaxAssetGroup(assets: {
  headlines?: unknown;
  descriptions?: unknown;
  images?: unknown;
  videos?: unknown;
}): CapabilityValidation {
  const errors: CapabilityValidationError[] = [];
  for (const field of PMAX_REQUIRED_ASSETS) {
    const value = assets[field];
    if (!Array.isArray(value) || value.length === 0) {
      errors.push({ field, reason: '必填资产缺失或为空' });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/** 各平台支持的智能出价策略集合（需求 26.2、26.4）。 */
export const PLATFORM_BIDDING_SUPPORT: Readonly<
  Record<Exclude<PlatformId, 'linkedin'>, readonly BiddingStrategy[]>
> = {
  meta: ['TARGET_CPA', 'TARGET_ROAS', 'MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CONVERSION_VALUE'],
  google: [
    'TARGET_CPA',
    'TARGET_ROAS',
    'MAXIMIZE_CONVERSIONS',
    'MAXIMIZE_CONVERSION_VALUE',
    'MAXIMIZE_CLICKS',
    'MANUAL_CPC',
  ],
  tiktok: ['TARGET_CPA', 'MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CLICKS', 'MANUAL_CPC'],
};

/** 要求目标值的出价策略 → 目标值名称（需求 26.3）。 */
export const BIDDING_TARGET_FIELD: Partial<Record<BiddingStrategy, string>> = {
  TARGET_CPA: 'targetCpa',
  TARGET_ROAS: 'targetRoas',
};

/** 出价策略 → 各平台原生参数键（需求 26.2）。 */
const BIDDING_NATIVE_PARAM: Readonly<
  Record<Exclude<PlatformId, 'linkedin'>, Partial<Record<BiddingStrategy, string>>>
> = {
  meta: {
    TARGET_CPA: 'COST_CAP',
    TARGET_ROAS: 'LOWEST_COST_WITH_MIN_ROAS',
    MAXIMIZE_CONVERSIONS: 'LOWEST_COST_WITHOUT_CAP',
    MAXIMIZE_CONVERSION_VALUE: 'HIGHEST_VALUE',
  },
  google: {
    TARGET_CPA: 'TARGET_CPA',
    TARGET_ROAS: 'TARGET_ROAS',
    MAXIMIZE_CONVERSIONS: 'MAXIMIZE_CONVERSIONS',
    MAXIMIZE_CONVERSION_VALUE: 'MAXIMIZE_CONVERSION_VALUE',
    MAXIMIZE_CLICKS: 'TARGET_SPEND',
    MANUAL_CPC: 'MANUAL_CPC',
  },
  tiktok: {
    TARGET_CPA: 'BID_TYPE_CUSTOM',
    MAXIMIZE_CONVERSIONS: 'BID_TYPE_NO_BID',
    MAXIMIZE_CLICKS: 'BID_TYPE_NO_BID',
    MANUAL_CPC: 'BID_TYPE_CUSTOM',
  },
};

/** 智能出价设置转换结果（需求 26）。 */
export type BiddingResolution =
  | { ok: true; nativeParam: string; targetValue?: number }
  | { ok: false; error: '出价方式不受支持' }
  | { ok: false; error: '目标值缺失'; missing: string };

/**
 * 校验并转换出价策略为目标平台原生参数（需求 26.2、26.3、26.4）。
 */
export function resolveBiddingStrategy(
  platform: Exclude<PlatformId, 'linkedin'>,
  strategy: BiddingStrategy,
  targetValue?: number,
): BiddingResolution {
  if (!PLATFORM_BIDDING_SUPPORT[platform].includes(strategy)) {
    return { ok: false, error: '出价方式不受支持' };
  }
  const targetField = BIDDING_TARGET_FIELD[strategy];
  if (
    targetField &&
    (targetValue === undefined || !Number.isFinite(targetValue) || targetValue <= 0)
  ) {
    return { ok: false, error: '目标值缺失', missing: targetField };
  }
  const nativeParam = BIDDING_NATIVE_PARAM[platform][strategy];
  if (!nativeParam) {
    return { ok: false, error: '出价方式不受支持' };
  }
  return targetField ? { ok: true, nativeParam, targetValue } : { ok: true, nativeParam };
}

/** 校验 A/B 实验分组数量（需求 28.4）。 */
export function validateExperimentGroups(groups: readonly unknown[]): CapabilityValidation {
  if (!Array.isArray(groups) || groups.length < 2) {
    return { ok: false, errors: [{ field: 'groups', reason: '实验分组数量不足' }] };
  }
  return { ok: true };
}

/** 校验投前预估输入：受众定向与预算缺一不可（需求 29.4）。 */
export function validateEstimateInputs(input: {
  targeting?: unknown;
  budget?: unknown;
}): CapabilityValidation {
  const errors: CapabilityValidationError[] = [];
  if (input.targeting === undefined || input.targeting === null) {
    errors.push({ field: 'targeting', reason: '受众定向缺失' });
  }
  const budget = Number(input.budget);
  if (
    input.budget === undefined ||
    input.budget === null ||
    !Number.isFinite(budget) ||
    budget <= 0
  ) {
    errors.push({ field: 'budget', reason: '预算缺失或非法' });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/** 校验消息广告配置（需求 30.3、30.4）。 */
export function validateMessageAd(input: {
  destination: 'whatsapp' | 'messenger';
  prefilledMessage?: unknown;
  routing?: unknown;
  whatsappConfigured?: boolean;
}): CapabilityValidation {
  const errors: CapabilityValidationError[] = [];
  if (typeof input.prefilledMessage !== 'string' || input.prefilledMessage.trim().length === 0) {
    errors.push({ field: 'prefilledMessage', reason: '预填消息缺失' });
  }
  if (input.routing === undefined || input.routing === null) {
    errors.push({ field: 'routing', reason: '会话路由配置缺失' });
  }
  if (input.destination === 'whatsapp' && input.whatsappConfigured !== true) {
    errors.push({ field: 'whatsappChannel', reason: 'WhatsApp 渠道未配置' });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/** 校验 AI 创意生成输入：产品素材必填（需求 31.4）。 */
export function validateCreativeInputs(input: {
  productAssets?: unknown;
  targetLanguages?: unknown;
}): CapabilityValidation {
  const errors: CapabilityValidationError[] = [];
  if (!Array.isArray(input.productAssets) || input.productAssets.length === 0) {
    errors.push({ field: 'productAssets', reason: '产品素材缺失' });
  }
  if (!Array.isArray(input.targetLanguages) || input.targetLanguages.length === 0) {
    errors.push({ field: 'targetLanguages', reason: '目标语言列表缺失' });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/** 离线转化必填项（需求 32.3）。 */
const OFFLINE_CONVERSION_REQUIRED = ['eventId', 'eventTime', 'value'] as const;

/** 校验离线/CRM 转化数据：列出**全部**缺失项（需求 32.3）。 */
export function validateOfflineConversion(event: {
  eventId?: unknown;
  eventTime?: unknown;
  value?: unknown;
}): CapabilityValidation {
  const errors: CapabilityValidationError[] = [];
  for (const field of OFFLINE_CONVERSION_REQUIRED) {
    if (event[field] === undefined || event[field] === null || event[field] === '') {
      errors.push({ field, reason: '必填项缺失' });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
