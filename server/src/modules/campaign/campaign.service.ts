import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  AccountAuthorization,
  type AccountAuthStatus,
} from '../auth-center/entities/account-authorization.entity';
import { CredentialNotConfiguredError } from '../../common/errors/credential.error';
import { PlatformAdapterRegistry } from '../platform-adapter';
import type { UnifiedAdPlan } from '../platform-adapter/domain/platform-adapter';
import {
  validateBudgetSchedule,
  validateChildCount,
  validateCreateCampaign,
  validateTargeting,
} from './pure/campaign-validation.pure';
import {
  callWithTimeout,
  computeFirstPublishedAt,
  evaluatePublishGate,
  resolvePublishStatus,
  DEFAULT_PUBLISH_TIMEOUT_MS,
} from './pure/publish.pure';
import { buildTargetingDimensions } from './pure/targeting.pure';
import { Ad } from './entities/ad.entity';
import { AdGroup } from './entities/ad-group.entity';
import { BudgetSchedule } from './entities/budget-schedule.entity';
import { Campaign } from './entities/campaign.entity';
import { Targeting } from './entities/targeting.entity';
import type {
  BudgetScheduleInput,
  CampaignValidationError,
  CreateAdGroupInput,
  CreateAdInput,
  CreateCampaignInput,
  PlatformId,
  PublishOptions,
  PublishResultOutcome,
  TargetingInput,
} from './domain/campaign';

/** 校验失败结果（含全部不符合项，需求 8.7）。 */
export class CampaignValidationFailure extends Error {
  readonly errors: CampaignValidationError[];

  constructor(errors: CampaignValidationError[]) {
    super('广告计划校验失败');
    this.name = 'CampaignValidationFailure';
    this.errors = errors;
  }
}

/** 父级对象不存在错误（需求 8.6）。 */
export class ParentNotFoundError extends Error {
  constructor(parentField: string) {
    super('父级对象不存在');
    this.name = 'ParentNotFoundError';
    this.parentField = parentField;
  }

  readonly parentField: string;
}

/**
 * 广告计划服务（组件 6，需求 8、10、12、13）。
 *
 * 职责：
 *  - 三级 CRUD 与约束校验（父级不存在拒绝、必填缺失返回全集、名称 1-255、数量上限 5000，需求 8）。
 *  - 预算/出价/排期校验（需求 12），出价方式经平台适配器支持集校验（需求 12.7）。
 *  - 受众定向配置与校验，经适配器 applyTargeting 转换为平台原生定向（需求 10）。
 *  - 投放编排与状态机（30 秒超时/重复拦截/非有效授权阻止/first_published_at 写入，需求 13）。
 *
 * 真实服务原则：投放/定向经平台适配器调用真实官方 API；平台凭据未配置时由凭据管理器
 * 抛「该平台凭据未配置」优雅降级（需求 1.5），不以假数据顶替业务逻辑。
 */
@Injectable()
export class CampaignService {
  private readonly logger = new Logger(CampaignService.name);

  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepo: Repository<Campaign>,
    @InjectRepository(AdGroup)
    private readonly adGroupRepo: Repository<AdGroup>,
    @InjectRepository(Ad)
    private readonly adRepo: Repository<Ad>,
    @InjectRepository(Targeting)
    private readonly targetingRepo: Repository<Targeting>,
    @InjectRepository(BudgetSchedule)
    private readonly budgetRepo: Repository<BudgetSchedule>,
    @InjectRepository(AccountAuthorization)
    private readonly accountRepo: Repository<AccountAuthorization>,
    private readonly adapters: PlatformAdapterRegistry,
  ) {}

  // ---------------------------------------------------------------------------
  // 12.1 三级 CRUD 与约束校验（需求 8.2、8.3、8.6、8.8）
  // ---------------------------------------------------------------------------

  /**
   * 创建广告系列（需求 8.2）。
   *
   * 校验：名称 1-255、必填字段（商家/名称/目标/平台）缺失返回全部不符合项（需求 8.7）。
   * 校验通过后创建并返回持久化实体（含唯一标识）。
   */
  async createCampaign(input: CreateCampaignInput): Promise<Campaign> {
    const errors = validateCreateCampaign(input);
    if (errors.length > 0) {
      throw new CampaignValidationFailure(errors);
    }

    const campaign = this.campaignRepo.create({
      merchantId: input.merchantId,
      name: input.name,
      objective: input.objective,
      platform: input.platform,
      publishStatus: '未提交',
      platformObjectId: null,
      firstPublishedAt: null,
    });
    return this.campaignRepo.save(campaign);
  }

  /**
   * 在已存在的广告系列下创建广告组（需求 8.3、8.6、8.8）。
   *
   * - 父级广告系列不存在 → 抛 {@link ParentNotFoundError}，不创建（需求 8.6）。
   * - 父级下广告组数量达上限 5000 → 抛校验错误，不创建（需求 8.8）。
   */
  async createAdGroup(input: CreateAdGroupInput): Promise<AdGroup> {
    const parent = await this.campaignRepo.findOne({ where: { id: input.campaignId } });
    if (!parent) {
      throw new ParentNotFoundError('campaignId');
    }

    const existing = await this.adGroupRepo.count({ where: { campaignId: input.campaignId } });
    const countError = validateChildCount(existing, 'adGroup');
    if (countError) {
      throw new CampaignValidationFailure([countError]);
    }

    return this.adGroupRepo.save(this.adGroupRepo.create({ campaignId: input.campaignId }));
  }

  /**
   * 在已存在的广告组下创建广告（需求 8.3、8.6、8.8）。
   *
   * - 父级广告组不存在 → 抛 {@link ParentNotFoundError}，不创建（需求 8.6）。
   * - 父级下广告数量达上限 5000 → 抛校验错误，不创建（需求 8.8）。
   */
  async createAd(input: CreateAdInput): Promise<Ad> {
    const parent = await this.adGroupRepo.findOne({ where: { id: input.adGroupId } });
    if (!parent) {
      throw new ParentNotFoundError('adGroupId');
    }

    const existing = await this.adRepo.count({ where: { adGroupId: input.adGroupId } });
    const countError = validateChildCount(existing, 'ad');
    if (countError) {
      throw new CampaignValidationFailure([countError]);
    }

    return this.adRepo.save(this.adRepo.create({ adGroupId: input.adGroupId }));
  }

  // ---------------------------------------------------------------------------
  // 12.3 预算/出价/排期校验（需求 12.1-12.7）
  // ---------------------------------------------------------------------------

  /**
   * 为广告组设置预算/出价/排期（需求 12.1-12.7）。
   *
   * 校验：预算取值域、日预算≤总预算、排期结束不早于开始、出价方式须被目标平台支持
   * （出价支持集取自该广告组所属广告系列的平台适配器，需求 12.7）。任一不符合项即拒绝
   * 保存并返回全部不符合项（需求 12.4-12.7）。校验通过则 upsert 持久化。
   */
  async setBudgetSchedule(adGroupId: string, input: BudgetScheduleInput): Promise<BudgetSchedule> {
    const adGroup = await this.adGroupRepo.findOne({ where: { id: adGroupId } });
    if (!adGroup) {
      throw new ParentNotFoundError('adGroupId');
    }

    const platform = await this.resolvePlatformOfAdGroup(adGroup);
    const supported = this.adapters.getAdapter(platform).supportedBiddingStrategies();

    const errors = validateBudgetSchedule(input, supported);
    if (errors.length > 0) {
      throw new CampaignValidationFailure(errors);
    }

    const existing = await this.budgetRepo.findOne({ where: { adGroupId } });
    const entity = existing ?? this.budgetRepo.create({ adGroupId });
    entity.dailyBudget = input.dailyBudget.toFixed(2);
    entity.totalBudget = input.totalBudget.toFixed(2);
    entity.biddingStrategy = input.biddingStrategy;
    entity.biddingTargetValue =
      input.biddingTargetValue != null ? input.biddingTargetValue.toFixed(2) : null;
    entity.startAt = input.startAt ?? null;
    entity.endAt = input.endAt ?? null;
    return this.budgetRepo.save(entity);
  }

  // ---------------------------------------------------------------------------
  // 12.7 / 12.9 受众定向配置与校验（需求 10.1-10.9）
  // ---------------------------------------------------------------------------

  /**
   * 为广告组配置受众定向（需求 10.1-10.9）。
   *
   * 校验：年龄 13-65、性别「男/女/不限」、相似受众种子合法（需求 10.1、10.7、10.9）。
   * 校验通过后经平台适配器 `applyTargeting` 转换为目标平台原生定向参数（含排除/负向定向
   * 与高意向相似受众种子，需求 10.3、10.8、10.9），平台不适用维度记入返回（需求 10.4），
   * 并持久化定向设置。
   *
   * @returns 持久化的定向实体与平台不适用维度集合。
   */
  async configureTargeting(
    adGroupId: string,
    input: TargetingInput,
  ): Promise<{ targeting: Targeting; notApplicable: string[] }> {
    const adGroup = await this.adGroupRepo.findOne({ where: { id: adGroupId } });
    if (!adGroup) {
      throw new ParentNotFoundError('adGroupId');
    }

    const errors = validateTargeting(input);
    if (errors.length > 0) {
      throw new CampaignValidationFailure(errors);
    }

    const platform = await this.resolvePlatformOfAdGroup(adGroup);
    const dimensions = buildTargetingDimensions(input);

    // 经适配器转换为平台原生定向参数（真实 API），平台不适用维度回传（需求 10.3、10.4）。
    let notApplicable: string[] = [];
    try {
      const adapter = this.adapters.getAdapter(platform);
      const ctx = this.adapters.createContext(platform);
      const result = await adapter.applyTargeting(ctx, adGroupId, { dimensions });
      notApplicable = result.notApplicable;
    } catch (error) {
      // 凭据未配置：优雅降级——持久化定向设置但标记原生应用未完成（需求 1.5）。
      if (error instanceof CredentialNotConfiguredError) {
        this.logger.warn(
          `平台「${platform}」凭据未配置，定向暂未提交至平台：adGroupId=${adGroupId}`,
        );
      } else {
        throw error;
      }
    }

    const existing = await this.targetingRepo.findOne({ where: { adGroupId } });
    const entity = existing ?? this.targetingRepo.create({ adGroupId });
    entity.geo = input.geo ?? null;
    entity.industry = input.industry ?? null;
    entity.jobRole = input.jobRole ?? null;
    entity.ageMin = input.ageMin ?? null;
    entity.ageMax = input.ageMax ?? null;
    entity.gender = input.gender ?? null;
    entity.interests = input.interests ?? null;
    entity.behaviors = input.behaviors ?? null;
    entity.customAudiences = input.customAudiences ?? null;
    entity.lookalikeAudiences = input.lookalikeAudiences ?? null;
    entity.notApplicableDims = notApplicable.length > 0 ? notApplicable : null;
    const saved = await this.targetingRepo.save(entity);
    return { targeting: saved, notApplicable };
  }

  // ---------------------------------------------------------------------------
  // 12.5 投放编排与状态机（需求 13.1-13.6）
  // ---------------------------------------------------------------------------

  /**
   * 将广告计划投放至目标平台（需求 13.1-13.6）。
   *
   * 编排：
   *  1. 校验授权：非有效授权阻止投放、保持「未提交」（需求 13.4，Property 28）。
   *  2. 重复拦截：当前「提交中」拒绝重复提交（需求 13.6，Property 29）。
   *  3. 置「提交中」→ 经适配器调用真实平台 API，30 秒超时控制（需求 13.1、13.2、13.5）。
   *  4. 成功置「已提交」并记录平台对象标识 + 首次写入 first_published_at（需求 13.2、21）；
   *     失败置「投放失败」（需求 13.3）；超时置「投放超时」（需求 13.5）。
   */
  async publishCampaign(
    campaignId: string,
    options: PublishOptions = {},
  ): Promise<PublishResultOutcome> {
    const campaign = await this.campaignRepo.findOne({ where: { id: campaignId } });
    if (!campaign) {
      throw new ParentNotFoundError('campaignId');
    }

    const platform = campaign.platform as PlatformId;
    const authStatus = await this.resolveAuthStatus(campaign.merchantId, platform);

    // 1) + 2) 投放前置闸门（授权与重复提交，需求 13.4、13.6）。
    const gate = evaluatePublishGate(authStatus, campaign.publishStatus);
    if (!gate.canPublish) {
      // 保持闸门要求的状态不变（未提交/提交中）。
      if (campaign.publishStatus !== gate.keepStatus) {
        campaign.publishStatus = gate.keepStatus;
        await this.campaignRepo.save(campaign);
      }
      return { accepted: false, status: gate.keepStatus, reason: gate.reason };
    }

    // 3) 置「提交中」，避免并发重复（需求 13.1、13.6）。
    campaign.publishStatus = '提交中';
    await this.campaignRepo.save(campaign);

    const accountId =
      options.accountId ?? (await this.resolveAccountId(campaign.merchantId, platform));
    const timeoutMs = options.timeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS;

    const plan: UnifiedAdPlan = {
      planId: campaign.id,
      accountId: accountId ?? '',
      native: { campaign: { name: campaign.name, objective: campaign.objective } },
    };

    const outcome = await callWithTimeout(async () => {
      const adapter = this.adapters.getAdapter(platform);
      const ctx = this.adapters.createContext(platform);
      const result = await adapter.publishCampaign(ctx, plan);
      return result.platformCampaignId;
    }, timeoutMs);

    // 4) 依据投放结果更新状态机（需求 13.2、13.3、13.5）。
    const status = resolvePublishStatus(outcome);
    const now = new Date();
    campaign.publishStatus = status;
    if (outcome.kind === 'success') {
      campaign.platformObjectId = outcome.platformObjectId;
      campaign.firstPublishedAt = computeFirstPublishedAt(campaign.firstPublishedAt, outcome, now);
    }
    await this.campaignRepo.save(campaign);

    if (outcome.kind === 'success') {
      return { accepted: true, status, platformObjectId: outcome.platformObjectId };
    }
    if (outcome.kind === 'failure') {
      return { accepted: true, status, reason: outcome.reason };
    }
    return { accepted: true, status, reason: '投放请求超时' };
  }

  // ---------------------------------------------------------------------------
  // 内部辅助
  // ---------------------------------------------------------------------------

  /** 解析广告组所属广告系列的平台标识。 */
  private async resolvePlatformOfAdGroup(adGroup: AdGroup): Promise<PlatformId> {
    const campaign = await this.campaignRepo.findOne({ where: { id: adGroup.campaignId } });
    if (!campaign) {
      throw new ParentNotFoundError('campaignId');
    }
    return campaign.platform as PlatformId;
  }

  /** 解析某商家在某平台的账户授权状态（缺省视为「未授权」，需求 13.4）。 */
  private async resolveAuthStatus(
    merchantId: string,
    platform: PlatformId,
  ): Promise<AccountAuthStatus> {
    const account = await this.accountRepo.findOne({ where: { merchantId, platform } });
    return account?.authStatus ?? '未授权';
  }

  /** 解析某商家在某平台的有效账户标识（供投放使用）。 */
  private async resolveAccountId(
    merchantId: string,
    platform: PlatformId,
  ): Promise<string | undefined> {
    const account = await this.accountRepo.findOne({ where: { merchantId, platform } });
    return account?.id;
  }
}
