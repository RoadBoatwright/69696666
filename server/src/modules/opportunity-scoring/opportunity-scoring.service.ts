import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import type { Actor } from '../rbac/domain/rbac';
import { authorize } from '../rbac/pure';
import { LevelChangeRecord } from './entities/level-change-record.entity';
import { Opportunity } from './entities/opportunity.entity';
import { score, sortByLevelDesc } from './pure';
import type { IntentLevel, ScoringInput } from './domain/opportunity-scoring';

/** 商机不存在错误。 */
export class ScoringOpportunityNotFoundError extends Error {
  constructor(public readonly opportunityId: string) {
    super('商机不存在');
    this.name = 'ScoringOpportunityNotFoundError';
  }
}

/** 重算结果：覆盖后的商机 + 变化时的变更记录（需求 16.5、16.6）。 */
export interface RecomputeResult {
  opportunity: Opportunity;
  /** 等级未变化时为 null（幂等不重复记录）。 */
  changeRecord: LevelChangeRecord | null;
}

/**
 * 商机分级引擎（组件 10，需求 16）。
 *
 * - `score` 纯函数输出唯一等级（需求 16.1、16.2，Property 38）。
 * - 缺必需输入置「未分级」记缺失项（需求 16.3，Property 39）。
 * - 重算覆盖旧等级；变化时生成含旧/新等级与精确到秒时间的变更记录（需求 16.5、16.6，Property 41）。
 * - 按等级查询 L4 优先（需求 16.4，Property 40），经 RBAC 数据隔离（需求 7）。
 */
@Injectable()
export class OpportunityScoringService {
  constructor(
    @InjectRepository(Opportunity)
    private readonly opportunityRepo: Repository<Opportunity>,
    @InjectRepository(LevelChangeRecord)
    private readonly changeRepo: Repository<LevelChangeRecord>,
  ) {}

  /**
   * 重算商机意向等级并覆盖（需求 16.5、16.6）。
   *
   * @throws ScoringOpportunityNotFoundError 商机不存在。
   */
  async recompute(opportunityId: string, input: ScoringInput): Promise<RecomputeResult> {
    const opportunity = await this.opportunityRepo.findOne({ where: { id: opportunityId } });
    if (!opportunity) {
      throw new ScoringOpportunityNotFoundError(opportunityId);
    }
    const result = score(input);
    const before = opportunity.intentLevel;

    opportunity.intentLevel = result.level;
    opportunity.missingInputs = result.missingInputs.length > 0 ? [...result.missingInputs] : null;
    const saved = await this.opportunityRepo.save(opportunity);

    let changeRecord: LevelChangeRecord | null = null;
    if (before !== result.level) {
      changeRecord = await this.changeRepo.save(
        this.changeRepo.create({
          opportunityId,
          beforeLevel: before,
          afterLevel: result.level,
          changedAt: new Date(),
        }),
      );
    }
    return { opportunity: saved, changeRecord };
  }

  /**
   * 按等级查询商机清单，L4 优先排序，经 RBAC 数据隔离（需求 16.4、7）。
   *
   * 越权（未认证/角色不符）返回空集且无数据泄露。
   */
  async listByLevel(
    actor: Actor | null,
    filter?: { levels?: IntentLevel[] },
  ): Promise<Opportunity[]> {
    const where =
      filter?.levels && filter.levels.length > 0 ? { intentLevel: In(filter.levels) } : {};
    const all = await this.opportunityRepo.find({ where });
    const visible = all.filter(
      (o) =>
        authorize(actor, 'read', {
          type: 'opportunity',
          resourceId: o.id,
          ownerMerchantId: o.ownerMerchantId,
        }).allowed,
    );
    return sortByLevelDesc(visible);
  }

  /** 取某商机的等级变更轨迹（按时间正序，需求 16.6）。 */
  async listChangeRecords(opportunityId: string): Promise<LevelChangeRecord[]> {
    const records = await this.changeRepo.find({ where: { opportunityId } });
    return [...records].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime());
  }
}
