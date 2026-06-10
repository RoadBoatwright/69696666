/**
 * LinkedIn B2B 能力接口定义（任务 40，需求 34.1）。
 *
 * 本期仅定义接口、不提供实现：任何调用经扩展能力网关路由到 LinkedIn 平台时一律返回
 * 「该能力第二期提供」（需求 34.3，见 `routeCapability` 的 deferred 分支）。第二期补充
 * 实现时只需新增 LinkedIn 执行器并在网关注册，无需修改现有平台实现（需求 34.4）。
 */

/** LinkedIn B2B 定向条件（行业/职位/资历/公司规模等）。 */
export interface LinkedInB2BTargeting {
  industries?: string[];
  jobTitles?: string[];
  seniorities?: string[];
  companySizes?: string[];
  companyNames?: string[];
}

/** LinkedIn B2B 能力集合接口（第二期实现）。 */
export interface LinkedInB2BCapabilities {
  /** B2B 精准定向（行业/职位/资历/公司）。 */
  applyB2BTargeting(
    campaignId: string,
    targeting: LinkedInB2BTargeting,
  ): Promise<{ applied: true }>;
  /** Predictive Audiences 预测受众。 */
  createPredictiveAudience(seedAudienceId: string): Promise<{ audienceId: string }>;
  /** 企业名单匹配（Matched Audiences / Company List Upload）。 */
  uploadCompanyList(companies: string[]): Promise<{ listId: string }>;
  /** Lead Gen Forms 原生线索表单。 */
  createLeadGenForm(form: Record<string, unknown>): Promise<{ formId: string }>;
  /** Document Ads 文档广告。 */
  createDocumentAd(documentUrl: string, copy: Record<string, unknown>): Promise<{ adId: string }>;
}
