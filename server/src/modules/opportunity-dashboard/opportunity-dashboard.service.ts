import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';

import { FollowupRecord } from '../followup-routing/entities';
import { LevelChangeRecord } from '../opportunity-scoring/entities';
import { Opportunity, type IntentLevel } from '../opportunity-scoring/entities/opportunity.entity';
import type { Actor } from '../rbac/domain/rbac';
import { VerificationResult, VerifiedField } from '../verification/entities';
import type {
  ExportFile,
  OpportunityDetail,
  OpportunityFilter,
  OpportunityListItem,
} from '../dashboard/domain/dashboard';

/** 等级排序权重：L4 优先（需求 21.13）。 */
const LEVEL_RANK: Record<IntentLevel, number> = {
  L4: 4,
  L3: 3,
  L2: 2,
  L1: 1,
  未分级: 0,
};

/** 导出列定义（清单/导出共用，需求 21.14）。 */
const EXPORT_COLUMNS = [
  { header: '商机ID', key: 'opportunityId' },
  { header: '意向等级', key: 'intentLevel' },
  { header: '来源平台', key: 'sourcePlatform' },
  { header: '跟进状态', key: 'followupStatus' },
  { header: '可信度', key: 'credibilityScore' },
  { header: '公司名称', key: 'companyName' },
  { header: '电话', key: 'phone' },
  { header: '邮箱', key: 'email' },
  { header: '创建时间', key: 'createdAt' },
] as const;

/**
 * 商机清单/单客户详情/导出服务（任务 23.6-23.8，需求 21.13-21.17）。
 *
 * - 清单按等级（L4 优先）/平台/跟进状态/时间筛选排序；
 * - 详情聚合原始留资 + 质量标注 + 背调补全 + 等级轨迹 + 跟进剧本，
 *   越权返回 `{ error: '权限不足' }` 不泄露数据；
 * - 导出 Excel/CSV，空集生成仅含表头文件；三者一律 RBAC 数据隔离。
 */
@Injectable()
export class OpportunityDashboardService {
  constructor(
    @InjectRepository(Opportunity)
    private readonly opportunityRepo: Repository<Opportunity>,
    @InjectRepository(VerificationResult)
    private readonly verificationRepo: Repository<VerificationResult>,
    @InjectRepository(VerifiedField)
    private readonly verifiedFieldRepo: Repository<VerifiedField>,
    @InjectRepository(LevelChangeRecord)
    private readonly levelChangeRepo: Repository<LevelChangeRecord>,
    @InjectRepository(FollowupRecord)
    private readonly followupRepo: Repository<FollowupRecord>,
  ) {}

  /** 商机清单：筛选 + L4 优先排序（需求 21.13）。 */
  async listOpportunities(
    actor: Actor,
    filter: OpportunityFilter = {},
  ): Promise<OpportunityListItem[]> {
    const rows = await this.queryOpportunities(actor, filter);
    const results = await this.verificationRepo.find({
      where: { opportunityId: In(rows.map((r) => r.id)) },
    });
    const credibilityByOpp = new Map(results.map((r) => [r.opportunityId, r.credibilityScore]));
    return rows
      .map((row) => this.toListItem(row, credibilityByOpp.get(row.id) ?? null))
      .sort(
        (a, b) =>
          LEVEL_RANK[b.intentLevel] - LEVEL_RANK[a.intentLevel] ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      );
  }

  /** 单客户详情聚合；越权返回权限不足（需求 21.15、21.17）。 */
  async getOpportunityDetail(
    actor: Actor,
    opportunityId: string,
  ): Promise<OpportunityDetail | { error: '权限不足' }> {
    const opp = await this.opportunityRepo.findOne({
      where: { id: opportunityId },
      relations: { lead: true },
    });
    if (!opp || !this.canAccess(actor, opp)) {
      return { error: '权限不足' };
    }

    const result = await this.verificationRepo.findOne({ where: { opportunityId } });
    const fields = result
      ? await this.verifiedFieldRepo.find({ where: { verificationResultId: result.id } })
      : [];
    const levelHistory = await this.levelChangeRepo.find({ where: { opportunityId } });
    const followups = await this.followupRepo.find({ where: { opportunityId } });

    return {
      opportunityId: opp.id,
      intentLevel: opp.intentLevel,
      followupStatus: opp.followupStatus,
      lead: opp.lead
        ? {
            rawData: opp.lead.rawData,
            qualityStatus: opp.lead.qualityStatus,
            isValidLead: opp.lead.isValidLead,
            qualityFlags: opp.lead.qualityFlags,
          }
        : null,
      verifiedFields: fields.map((f) => ({
        field: f.field,
        originalValue: f.originalValue,
        verifiedValue: f.verifiedValue,
        conflict: f.conflict,
        needsReview: f.needsReview,
      })),
      levelHistory: levelHistory.map((r) => ({
        beforeLevel: r.beforeLevel,
        afterLevel: r.afterLevel,
        changedAt: r.changedAt,
      })),
      followups: followups.map((f) => ({
        status: f.status,
        playbook: f.playbook,
        failureReason: f.failureReason,
      })),
    };
  }

  /** 商机清单导出 Excel/CSV；空集生成仅含表头文件（需求 21.14、21.16）。 */
  async exportOpportunities(
    actor: Actor,
    filter: OpportunityFilter = {},
    format: 'excel' | 'csv' = 'csv',
  ): Promise<ExportFile> {
    const items = await this.listOpportunities(actor, filter);
    const rows = items.map((item) => ({
      opportunityId: item.opportunityId,
      intentLevel: item.intentLevel,
      sourcePlatform: item.sourcePlatform ?? '',
      followupStatus: item.followupStatus,
      credibilityScore: item.credibilityScore ?? '',
      companyName: item.contact.companyName ?? '',
      phone: item.contact.phone ?? '',
      email: item.contact.email ?? '',
      createdAt: item.createdAt.toISOString(),
    }));

    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('商机清单');
      sheet.columns = EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key }));
      for (const row of rows) {
        sheet.addRow(row);
      }
      const content = Buffer.from(await workbook.xlsx.writeBuffer());
      return {
        filename: 'opportunities.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        content,
      };
    }

    const header = EXPORT_COLUMNS.map((c) => c.header).join(',');
    const lines = rows.map((row) =>
      EXPORT_COLUMNS.map((c) => escapeCsv(String(row[c.key]))).join(','),
    );
    // 带 BOM 便于 Excel 正确识别 UTF-8 中文。
    const content = Buffer.from('\uFEFF' + [header, ...lines].join('\n'), 'utf-8');
    return { filename: 'opportunities.csv', mimeType: 'text/csv; charset=utf-8', content };
  }

  private canAccess(actor: Actor, opp: Opportunity): boolean {
    return (
      actor.role === 'administrator' ||
      actor.role === 'operator' ||
      (actor.role === 'merchant' && actor.merchantId === opp.ownerMerchantId)
    );
  }

  private async queryOpportunities(
    actor: Actor,
    filter: OpportunityFilter,
  ): Promise<Opportunity[]> {
    const where: Record<string, unknown> = {};
    if (actor.role === 'merchant') {
      where.ownerMerchantId = actor.merchantId;
    }
    if (filter.level) {
      where.intentLevel = filter.level;
    }
    if (filter.followupStatus) {
      where.followupStatus = filter.followupStatus;
    }
    if (filter.start && filter.end) {
      where.createdAt = Between(filter.start, filter.end);
    } else if (filter.start) {
      where.createdAt = MoreThanOrEqual(filter.start);
    } else if (filter.end) {
      where.createdAt = LessThanOrEqual(filter.end);
    }
    const rows = await this.opportunityRepo.find({ where, relations: { lead: true } });
    if (!filter.platform) {
      return rows;
    }
    return rows.filter((row) => row.lead?.sourcePlatform === filter.platform);
  }

  private toListItem(opp: Opportunity, credibilityScore: string | null): OpportunityListItem {
    const raw = (opp.lead?.rawData ?? {}) as Record<string, unknown>;
    const str = (key: string): string | undefined =>
      typeof raw[key] === 'string' ? (raw[key] as string) : undefined;
    return {
      opportunityId: opp.id,
      intentLevel: opp.intentLevel,
      sourcePlatform: opp.lead?.sourcePlatform ?? null,
      followupStatus: opp.followupStatus,
      credibilityScore,
      contact: { companyName: str('companyName'), phone: str('phone'), email: str('email') },
      createdAt: opp.createdAt,
    };
  }
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
