/**
 * 线索收集服务领域类型（组件 8，需求 14）。
 *
 * 定义高门槛留资表单配置、买家留资提交、质量闸门判定结果与回流结果等领域模型，
 * 供纯函数校验（{@link '../pure'}）与线索服务（{@link '../lead.service'}）共用。
 */

/** 高门槛留资表单必填字段键（公司名/姓名/电话/邮箱，需求 14.1、14.4）。 */
export const REQUIRED_LEAD_FIELDS = ['companyName', 'name', 'phone', 'email'] as const;

/** 必填字段键类型。 */
export type RequiredLeadField = (typeof REQUIRED_LEAD_FIELDS)[number];

/** 表单字段项数量下限（需求 14.1）。 */
export const FORM_FIELD_COUNT_MIN = 1;

/** 表单字段项数量上限（需求 14.1）。 */
export const FORM_FIELD_COUNT_MAX = 30;

/** 单个表单字段定义（需求 14.1）。 */
export interface LeadFormFieldDef {
  /** 字段键（如 companyName、name、phone、email 及其余自定义字段）。 */
  key: string;
  /** 字段展示名。 */
  label?: string;
  /** 是否必填；公司名/姓名/电话/邮箱恒为必填（需求 14.1）。 */
  required: boolean;
}

/** 高门槛留资表单配置（需求 14.1）。 */
export interface LeadFormConfigInput {
  /** 关联广告标识。 */
  adId: string;
  /** 字段定义集合，数量 1-30；须包含公司名/姓名/电话/邮箱且均为必填（需求 14.1）。 */
  fields: LeadFormFieldDef[];
}

/** 表单配置校验错误（需求 14.1）。 */
export interface LeadFormValidationError {
  /** 出错字段或维度名。 */
  field: string;
  /** 错误分类码。 */
  code:
    | 'field_count_out_of_range'
    | 'required_field_missing'
    | 'required_field_not_required'
    | 'duplicate_field_key';
  /** 中文错误说明。 */
  message: string;
}

/**
 * 买家留资提交（需求 14.4-14.12）。
 *
 * `platformLeadId` + `sourcePlatform` 构成去重键（需求 14.7）；`collectedAt` 精确到秒
 *（需求 14.6）；`raw` 保留原始留资数据，回流/存储失败时持久化以待重试（需求 14.8）。
 */
export interface LeadSubmission {
  /** 来源平台（去重键之一，需求 14.6、14.7）。 */
  sourcePlatform: string;
  /** 平台线索标识（去重键之一，需求 14.7）。 */
  platformLeadId: string;
  /** 来源广告标识（需求 14.6）。 */
  sourceAdId?: string | null;
  /** 关联回流来源表单标识（可空）。 */
  leadFormId?: string | null;
  /** 资产归属商家标识，升格商机时写入（需求 21.9）。 */
  ownerMerchantId?: string | null;
  /** 采集时间，精确到秒；去重保留最早（需求 14.6、14.7）。 */
  collectedAt: Date;
  /** 公司名（必填，需求 14.4）。 */
  companyName?: string | null;
  /** 姓名（必填，需求 14.4）。 */
  name?: string | null;
  /** 电话（必填，需求 14.4、14.9）。 */
  phone?: string | null;
  /** 邮箱（必填，需求 14.4、14.9）。 */
  email?: string | null;
  /** 其余表单字段值。 */
  extraFields?: Record<string, unknown>;
  /** 原始留资数据，失败时保留以待重试（需求 14.8）。 */
  raw?: unknown;
}

/** 质量分类取值域（需求 14.10、14.11）。 */
export type LeadQualityStatus = '高质量' | '低质量/疑似无效' | '疑似作弊';

/** 企业身份初判取值域（需求 14.12）。 */
export type EnterpriseIdentity = '疑似真实企业' | '疑似个人/免费邮箱';

/** 质量命中明细标记码（需求 14.9-14.11）。 */
export type LeadQualityFlag =
  | 'email_format_invalid'
  | 'phone_format_invalid'
  | 'disposable_email'
  | 'placeholder_value'
  | 'bot_high_frequency'
  | 'bot_duplicate_content';

/** 质量闸门判定结果（需求 14.9-14.12）。 */
export interface LeadQualityAssessment {
  /** 质量分类（需求 14.10、14.11）。 */
  qualityStatus: LeadQualityStatus;
  /** 是否计入有效线索（高质量为真，低质量/疑似作弊为假，需求 14.10、14.11）。 */
  isValidLead: boolean;
  /** 企业身份初判标注（需求 14.12）。 */
  enterpriseIdentity: EnterpriseIdentity | null;
  /** 质量命中明细，区分存储以供追溯（需求 14.10、14.11）。 */
  flags: LeadQualityFlag[];
}

/** 回流结果分类（需求 14.4-14.8）。 */
export type LeadIngestOutcome =
  | 'upgraded' // 通过校验与质量闸门 → 升格为有效商机（需求 14.5）
  | 'stored_low_quality' // 低质量/疑似作弊 → 区分存储不计入有效线索（需求 14.10、14.11）
  | 'deduped' // 命中去重 → 保留最早记录（需求 14.7）
  | 'rejected_missing_required' // 缺必填项 → 拒绝回流（需求 14.4）
  | 'failed'; // 回流/存储失败 → 保留原始数据待重试（需求 14.8）

/** 回流结果（需求 14.4-14.12）。 */
export interface LeadIngestResult {
  /** 回流结果分类。 */
  outcome: LeadIngestOutcome;
  /** 升格/存储后的线索标识（成功时）。 */
  leadId?: string;
  /** 升格生成的商机标识（仅 upgraded 时）。 */
  opportunityId?: string;
  /** 缺失的必填项（仅 rejected_missing_required 时，需求 14.4）。 */
  missingRequired?: RequiredLeadField[];
  /** 质量判定（已存储时携带，需求 14.9-14.12）。 */
  quality?: LeadQualityAssessment;
  /** 失败原因（仅 failed 时，需求 14.8）。 */
  reason?: string;
}
