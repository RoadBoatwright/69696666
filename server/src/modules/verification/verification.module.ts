import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CredentialModule } from '../credential/credential.module';
import { Opportunity } from '../opportunity-scoring/entities/opportunity.entity';
import { VerificationResult } from './entities/verification-result.entity';
import { VerifiedField } from './entities/verified-field.entity';
import { DefaultGeminiVerifier, GEMINI_VERIFIER } from './ports/gemini-verifier';
import { VerificationService } from './verification.service';

/**
 * Gemini 背调服务（组件 9，需求 15）。
 *
 * 经真实 Gemini API 对回流商机做背景调查与字段补全：凭据缺失降级仍存储商机
 *（需求 15.3）、失败保留原始数据待重试（需求 15.4）、冲突字段保留两值标待核实
 *（需求 15.5）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([VerificationResult, VerifiedField, Opportunity]),
    CredentialModule,
  ],
  providers: [
    VerificationService,
    DefaultGeminiVerifier,
    { provide: GEMINI_VERIFIER, useExisting: DefaultGeminiVerifier },
  ],
  exports: [VerificationService],
})
export class VerificationModule {}
