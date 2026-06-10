import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CredentialManagerService } from '../credential/credential-manager.service';
import { Opportunity } from '../opportunity-scoring/entities/opportunity.entity';
import { VerificationResult } from './entities/verification-result.entity';
import { VerifiedField } from './entities/verified-field.entity';
import { GEMINI_VERIFIER, type GeminiVerifier } from './ports/gemini-verifier';
import { leadToVerifiableFields, mergeFields } from './pure';
import type { RawLead, VerifyOutcome } from './domain/verification';

/** 商机不存在错误。 */
export class OpportunityNotFoundError extends Error {
  constructor(public readonly opportunityId: string) {
    super('商机不存在');
    this.name = 'OpportunityNotFoundError';
  }
}

/**
 * Gemini 背调服务（组件 9，需求 15）。
 *
 * - `isAvailable` 复用凭据管理器 Gemini 二态状态（需求 15.1）。
 * - 凭据缺失降级：商机仍存储、背调能力标「背调不可用」，不发起调用（需求 15.3，Property 35）。
 * - 调用失败：保留原始留资数据、置「背调失败」并记录原因待重试（需求 15.4，Property 36）。
 * - 冲突字段同时保留两值标「待核实」（需求 15.5，Property 37，mergeFields 纯函数）。
 *
 * 真实服务原则：经真实 Gemini API 背调，绝不以假数据顶替。
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    @InjectRepository(VerificationResult)
    private readonly resultRepo: Repository<VerificationResult>,
    @InjectRepository(VerifiedField)
    private readonly fieldRepo: Repository<VerifiedField>,
    @InjectRepository(Opportunity)
    private readonly opportunityRepo: Repository<Opportunity>,
    private readonly credentials: CredentialManagerService,
    @Inject(GEMINI_VERIFIER) private readonly gemini: GeminiVerifier,
  ) {}

  /** Gemini 背调能力是否可用（凭据二态，需求 15.1）。 */
  async isAvailable(): Promise<boolean> {
    return this.credentials.isGeminiAvailable();
  }

  /**
   * 对商机执行 Gemini 背调并落库（需求 15.2-15.5）。
   *
   * @throws OpportunityNotFoundError 商机不存在。
   */
  async verify(opportunityId: string, lead: RawLead): Promise<VerifyOutcome> {
    const opportunity = await this.opportunityRepo.findOne({ where: { id: opportunityId } });
    if (!opportunity) {
      throw new OpportunityNotFoundError(opportunityId);
    }

    // 凭据缺失：降级标「背调不可用」，商机保持已存储、不发起调用（需求 15.3）。
    if (!(await this.isAvailable())) {
      const result = await this.upsertResult(opportunityId, {
        status: '背调不可用',
        failureReason: null,
        verifiedAt: null,
      });
      await this.setOpportunityStatus(opportunity, '背调不可用');
      return { outcome: 'unavailable', verificationResultId: result.id };
    }

    await this.setOpportunityStatus(opportunity, '背调中');
    try {
      const output = await this.gemini.verify(lead);
      const merged = mergeFields(leadToVerifiableFields(lead), output.fields);

      const result = await this.upsertResult(opportunityId, {
        status: '背调完成',
        credibilityScore: output.credibilityScore === null ? null : String(output.credibilityScore),
        summary: output.summary,
        failureReason: null,
        verifiedAt: new Date(),
      });

      // 重试成功覆盖旧字段比对结果。
      await this.fieldRepo.delete({ verificationResultId: result.id });
      for (const f of merged) {
        await this.fieldRepo.save(
          this.fieldRepo.create({
            verificationResultId: result.id,
            field: f.field,
            originalValue: f.originalValue ?? null,
            verifiedValue: f.verifiedValue ?? null,
            conflict: f.conflict,
            needsReview: f.needsReview,
          }),
        );
      }
      await this.setOpportunityStatus(opportunity, '背调完成');
      return { outcome: 'completed', verificationResultId: result.id, fields: merged };
    } catch (error) {
      // 调用失败：保留原始留资数据、置「背调失败」并记录原因待重试（需求 15.4）。
      const reason = error instanceof Error ? error.message : 'Gemini 背调调用失败';
      this.logger.warn(`背调失败待重试：opportunityId=${opportunityId}, 原因=${reason}`);
      const result = await this.upsertResult(opportunityId, {
        status: '背调失败',
        failureReason: reason,
        verifiedAt: null,
      });
      await this.setOpportunityStatus(opportunity, '背调失败');
      return { outcome: 'failed', verificationResultId: result.id, reason };
    }
  }

  /** 取某商机的背调结果（含字段比对），不存在返回 null。 */
  async getResult(
    opportunityId: string,
  ): Promise<{ result: VerificationResult; fields: VerifiedField[] } | null> {
    const result = await this.resultRepo.findOne({ where: { opportunityId } });
    if (!result) {
      return null;
    }
    const fields = await this.fieldRepo.find({ where: { verificationResultId: result.id } });
    return { result, fields };
  }

  private async upsertResult(
    opportunityId: string,
    patch: Partial<VerificationResult>,
  ): Promise<VerificationResult> {
    const existing = await this.resultRepo.findOne({ where: { opportunityId } });
    if (existing) {
      Object.assign(existing, patch);
      return this.resultRepo.save(existing);
    }
    return this.resultRepo.save(this.resultRepo.create({ opportunityId, ...patch }));
  }

  private async setOpportunityStatus(
    opportunity: Opportunity,
    status: Opportunity['verificationStatus'],
  ): Promise<void> {
    opportunity.verificationStatus = status;
    await this.opportunityRepo.save(opportunity);
  }
}
