import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CredentialNotConfiguredError } from '../../common/errors/credential.error';
import { Opportunity } from '../opportunity-scoring/entities/opportunity.entity';
import { PlatformAdapterRegistry } from '../platform-adapter';
import type {
  LeadFormConfig as PlatformLeadFormConfig,
  PlatformId,
} from '../platform-adapter/domain/platform-adapter';
import { Lead } from './entities/lead.entity';
import { LeadForm, type LeadFormStatus } from './entities/lead-form.entity';
import {
  assessBatchAntiFraud,
  assessLeadQuality,
  findMissingRequiredFields,
  validateLeadFormConfig,
} from './pure';
import type {
  LeadFormConfigInput,
  LeadIngestResult,
  LeadQualityAssessment,
  LeadQualityFlag,
  LeadSubmission,
} from './domain/lead';

/** 表单配置非法错误（需求 14.1）。 */
export class InvalidLeadFormError extends Error {
  constructor(public readonly errors: ReturnType<typeof validateLeadFormConfig>) {
    super('高门槛留资表单配置非法');
    this.name = 'InvalidLeadFormError';
  }
}

/** 表单不存在错误。 */
export class LeadFormNotFoundError extends Error {
  constructor(public readonly leadFormId: string) {
    super('留资表单不存在');
    this.name = 'LeadFormNotFoundError';
  }
}

/** 表单挂载至平台的结果（需求 14.2、14.3）。 */
export interface AttachLeadFormResult {
  /** 是否挂载成功。 */
  attached: boolean;
  /** 表单状态：「已关联|关联失败」（需求 14.2、14.3）。 */
  status: LeadFormStatus;
  /** 平台侧返回的表单标识（成功时）。 */
  platformLeadFormId?: string | null;
  /** 失败原因（需求 14.3）。 */
  reason?: string;
}

/**
 * 线索收集服务（组件 8，需求 14）。
 *
 * 职责：
 *  - 配置高门槛留资表单（公司名/姓名/电话/邮箱必填，字段 1-30，需求 14.1）。
 *  - 经平台适配器 attachLeadForm 将表单提交至目标平台，置状态「已关联/关联失败」
 *    （需求 14.2、14.3）。
 *  - 买家提交回流：缺任一必填项拒绝回流（需求 14.4）；通过校验后回流并升格为商机
 *    （需求 14.5）；记录来源平台/来源广告/精确到秒采集时间（需求 14.6）；按来源平台
 *    线索标识去重保留最早、幂等（需求 14.7）；回流/存储失败保留原始数据待重试（需求 14.8）。
 *  - 质量闸门：邮箱/电话格式、一次性邮箱、无效占位、机器人/批量反作弊、企业身份初判；
 *    低质量/疑似作弊区分存储、不计入有效线索（需求 14.9-14.12）。
 *
 * 真实服务原则：表单经平台适配器调用真实官方 API 挂载；不以假数据顶替业务逻辑。
 */
@Injectable()
export class LeadService {
  private readonly logger = new Logger(LeadService.name);

  constructor(
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    @InjectRepository(LeadForm)
    private readonly leadFormRepo: Repository<LeadForm>,
    @InjectRepository(Opportunity)
    private readonly opportunityRepo: Repository<Opportunity>,
    private readonly adapters: PlatformAdapterRegistry,
  ) {}

  // ---------------------------------------------------------------------------
  // 14.1 配置高门槛留资表单
  // ---------------------------------------------------------------------------

  /**
   * 创建/配置高门槛留资表单（需求 14.1）。
   *
   * 校验：字段数量 1-30；公司名/姓名/电话/邮箱必须存在且标记为必填；字段键不重复。
   *
   * @throws InvalidLeadFormError 配置不符合高门槛要求。
   */
  async configureForm(config: LeadFormConfigInput): Promise<LeadForm> {
    const errors = validateLeadFormConfig(config);
    if (errors.length > 0) {
      throw new InvalidLeadFormError(errors);
    }
    const entity = this.leadFormRepo.create({
      adId: config.adId,
      fields: config.fields,
      status: null,
    });
    return this.leadFormRepo.save(entity);
  }

  // ---------------------------------------------------------------------------
  // 14.2 / 14.3 关联表单到广告：经平台适配器提交至目标平台
  // ---------------------------------------------------------------------------

  /**
   * 将高门槛留资表单关联到广告并提交至目标平台（需求 14.2、14.3）。
   *
   * 经平台适配器 `attachLeadForm` 提交真实平台 API：
   *  - 成功 → 表单状态置「已关联」、记录平台表单标识（需求 14.2）。
   *  - 失败 → 表单状态置「关联失败」、返回包含失败原因的错误（需求 14.3）。
   *
   * @throws LeadFormNotFoundError 表单不存在。
   */
  async attachFormToAd(leadFormId: string, platform: PlatformId): Promise<AttachLeadFormResult> {
    const form = await this.leadFormRepo.findOne({ where: { id: leadFormId } });
    if (!form) {
      throw new LeadFormNotFoundError(leadFormId);
    }

    const platformForm: PlatformLeadFormConfig = {
      fields: this.toFieldsRecord(form.fields),
    };

    try {
      const adapter = this.adapters.getAdapter(platform);
      const ctx = this.adapters.createContext(platform);
      const result = await adapter.attachLeadForm(ctx, form.adId, platformForm);
      form.status = '已关联';
      await this.leadFormRepo.save(form);
      return {
        attached: true,
        status: '已关联',
        platformLeadFormId: result.platformLeadFormId,
      };
    } catch (error) {
      const reason =
        error instanceof CredentialNotConfiguredError
          ? `平台「${platform}」凭据未配置`
          : error instanceof Error
            ? error.message
            : '表单提交至平台失败';
      form.status = '关联失败';
      await this.leadFormRepo.save(form);
      this.logger.warn(
        `留资表单关联失败：leadFormId=${leadFormId}, 平台=${platform}, 原因=${reason}`,
      );
      return { attached: false, status: '关联失败', reason };
    }
  }

  // ---------------------------------------------------------------------------
  // 14.4-14.12 买家留资回流：必填校验 → 去重 → 质量闸门 → 升格商机
  // ---------------------------------------------------------------------------

  /**
   * 回流单条买家留资（需求 14.4-14.12）。
   *
   * 流程：
   *  1. 必填校验：缺公司名/姓名/电话/邮箱任一 → 拒绝回流、不升格（需求 14.4，Property 30）。
   *  2. 去重：按来源平台 + 线索标识，已存在则保留最早记录、幂等返回（需求 14.7，Property 31）。
   *  3. 质量闸门：格式/一次性邮箱/占位值/企业身份初判（需求 14.9、14.10、14.12）。
   *  4. 高质量 → 15 分钟内升格为有效商机存储（需求 14.5、14.6）；
   *     低质量/疑似作弊 → 区分存储、不计入有效线索（需求 14.10、14.11）。
   *  5. 存储失败 → 记录原因、保留原始数据待重试（需求 14.8）。
   *
   * 注：机器人/批量反作弊（需求 14.11）依赖跨留资上下文，单条回流仅做格式与占位识别；
   * 批量回流请用 {@link ingestBatch} 以叠加反作弊判定。
   *
   * @param extraAntiFraudFlags 由批量反作弊补充的命中标记（内部使用，需求 14.11）。
   */
  async ingestLead(
    submission: LeadSubmission,
    extraAntiFraudFlags: LeadQualityFlag[] = [],
  ): Promise<LeadIngestResult> {
    // 1) 必填校验（需求 14.4，Property 30）。
    const missingRequired = findMissingRequiredFields(submission);
    if (missingRequired.length > 0) {
      return { outcome: 'rejected_missing_required', missingRequired };
    }

    try {
      // 2) 去重：保留最早采集记录，重复执行幂等（需求 14.7，Property 31）。
      const existing = await this.leadRepo.findOne({
        where: {
          sourcePlatform: submission.sourcePlatform,
          platformLeadId: submission.platformLeadId,
        },
      });
      if (existing) {
        // 若新提交采集时间更早，更新为最早记录（保留最早，需求 14.7）。
        if (submission.collectedAt.getTime() < existing.collectedAt.getTime()) {
          existing.collectedAt = submission.collectedAt;
          existing.rawData = submission.raw ?? existing.rawData;
          await this.leadRepo.save(existing);
        }
        const opp = await this.opportunityRepo.findOne({ where: { leadId: existing.id } });
        return {
          outcome: 'deduped',
          leadId: existing.id,
          opportunityId: opp?.id,
        };
      }

      // 3) 质量闸门（需求 14.9-14.12）。
      const quality = this.mergeAntiFraud(assessLeadQuality(submission), extraAntiFraudFlags);

      // 4) 存储线索（来源平台/来源广告/精确到秒采集时间，需求 14.6）。
      const leadId = randomUUID();
      const lead = this.leadRepo.create({
        id: leadId,
        leadFormId: submission.leadFormId ?? null,
        sourcePlatform: submission.sourcePlatform,
        sourceAdId: submission.sourceAdId ?? null,
        platformLeadId: submission.platformLeadId,
        collectedAt: submission.collectedAt,
        rawData: submission.raw ?? null,
        qualityStatus: quality.qualityStatus,
        isValidLead: quality.isValidLead,
        enterpriseIdentity: quality.enterpriseIdentity,
        qualityFlags: quality.flags,
      });
      const savedLead = await this.leadRepo.save(lead);

      // 低质量/疑似作弊：区分存储、不升格为有效商机（需求 14.10、14.11）。
      if (!quality.isValidLead) {
        return {
          outcome: 'stored_low_quality',
          leadId: savedLead.id,
          quality,
        };
      }

      // 高质量：升格为有效商机存储（需求 14.5）。
      const opportunity = this.opportunityRepo.create({
        leadId: savedLead.id,
        ownerMerchantId: submission.ownerMerchantId ?? null,
        sourceCampaignId: null,
        isQualified: true,
        intentLevel: '未分级',
        verificationStatus: '待背调',
        followupStatus: '待路由',
      } as Partial<Opportunity>);
      const savedOpp = await this.opportunityRepo.save(opportunity);

      return {
        outcome: 'upgraded',
        leadId: savedLead.id,
        opportunityId: savedOpp.id,
        quality,
      };
    } catch (error) {
      // 5) 回流/存储失败：记录原因、保留原始数据待重试（需求 14.8）。
      const reason = error instanceof Error ? error.message : '线索回流/存储失败';
      this.logger.error(
        `线索回流失败已保留原始数据待重试：sourcePlatform=${submission.sourcePlatform}, platformLeadId=${submission.platformLeadId}, 原因=${reason}`,
      );
      await this.persistFailedRaw(submission, reason);
      return { outcome: 'failed', reason };
    }
  }

  /**
   * 批量回流买家留资（需求 14.4-14.12）。
   *
   * 先对整批执行机器人/批量提交反作弊判定（同源短时高频、字段内容雷同，需求 14.11），
   * 再逐条回流并叠加反作弊命中标记；命中项标记「疑似作弊」、不回流为有效商机。
   *
   * @returns 与输入等长、按序对应的回流结果数组。
   */
  async ingestBatch(submissions: LeadSubmission[]): Promise<LeadIngestResult[]> {
    const antiFraud = assessBatchAntiFraud(submissions);
    const results: LeadIngestResult[] = [];
    for (let i = 0; i < submissions.length; i += 1) {
      results.push(await this.ingestLead(submissions[i], antiFraud[i]));
    }
    return results;
  }

  /** 叠加批量反作弊命中标记，命中即标记「疑似作弊」且不计入有效线索（需求 14.11）。 */
  private mergeAntiFraud(
    quality: LeadQualityAssessment,
    antiFraudFlags: LeadQualityFlag[],
  ): LeadQualityAssessment {
    if (antiFraudFlags.length === 0) {
      return quality;
    }
    const flags = [...quality.flags, ...antiFraudFlags];
    return {
      qualityStatus: '疑似作弊',
      isValidLead: false,
      enterpriseIdentity: quality.enterpriseIdentity,
      flags,
    };
  }

  /** 持久化回流失败的原始数据以待重试（需求 14.8），持久化自身失败仅记录日志不抛出。 */
  private async persistFailedRaw(submission: LeadSubmission, reason: string): Promise<void> {
    try {
      const lead = this.leadRepo.create({
        leadFormId: submission.leadFormId ?? null,
        sourcePlatform: submission.sourcePlatform,
        sourceAdId: submission.sourceAdId ?? null,
        platformLeadId: submission.platformLeadId,
        collectedAt: submission.collectedAt,
        rawData: submission.raw ?? submission,
        qualityStatus: null,
        isValidLead: false,
        qualityFlags: [{ failure: reason }],
      });
      await this.leadRepo.save(lead);
    } catch (persistError) {
      const message = persistError instanceof Error ? persistError.message : String(persistError);
      this.logger.error(`保留失败线索原始数据时再次失败：${message}`);
    }
  }

  /** 将表单字段定义转换为平台适配器所需的字段映射。 */
  private toFieldsRecord(fields: unknown): Record<string, unknown> {
    if (Array.isArray(fields)) {
      return { fields };
    }
    if (fields && typeof fields === 'object') {
      return fields as Record<string, unknown>;
    }
    return { fields: [] };
  }
}
