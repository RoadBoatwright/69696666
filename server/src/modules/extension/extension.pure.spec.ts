import { CAPABILITY_IDS, CAPABILITY_SUPPORT } from './domain/extension';
import {
  PLATFORM_BIDDING_SUPPORT,
  resolveBiddingStrategy,
  routeCapability,
  validateAdvantagePlusControls,
  validateCreativeInputs,
  validateEstimateInputs,
  validateExperimentGroups,
  validateMessageAd,
  validateOfflineConversion,
  validatePmaxAssetGroup,
} from './pure';

describe('extension.pure', () => {
  describe('routeCapability（需求 22.2-22.4、34.3）', () => {
    it('LinkedIn 一律返回「该能力第二期提供」', () => {
      const result = routeCapability('linkedin_b2b', 'linkedin', 'filled');
      expect(result.kind).toBe('deferred');
      expect(result.kind === 'deferred' && result.error).toBe('该能力第二期提供');
    });

    it('平台不在支持集合 → 「该平台不支持此能力」', () => {
      const result = routeCapability('performance_max', 'meta', 'filled');
      expect(result.kind).toBe('unsupported');
      expect(result.kind === 'unsupported' && result.error).toBe('该平台不支持此能力');
    });

    it('凭据未填入 → 「该平台凭据未配置」', () => {
      const result = routeCapability('advantage_plus', 'meta', 'unfilled');
      expect(result.kind).toBe('credential_missing');
      expect(result.kind === 'credential_missing' && result.error).toBe('该平台凭据未配置');
    });

    it('支持且凭据已填入 → 路由', () => {
      expect(routeCapability('spark_ads', 'tiktok', 'filled').kind).toBe('route');
    });

    it('能力支持集合可被查询且每个能力都有至少一个支持平台（需求 22.1）', () => {
      for (const id of CAPABILITY_IDS) {
        expect(CAPABILITY_SUPPORT[id].length).toBeGreaterThan(0);
      }
    });
  });

  describe('validateAdvantagePlusControls（需求 23.4）', () => {
    it('合法硬控制项通过', () => {
      expect(
        validateAdvantagePlusControls({ geoLocations: ['TH'], languages: ['th'], minAge: 20 }).ok,
      ).toBe(true);
    });

    it('缺失项点名具体控制项与原因', () => {
      const result = validateAdvantagePlusControls({ geoLocations: ['TH'] });
      expect(result.ok).toBe(false);
      const fields = !result.ok ? result.errors.map((e) => e.field) : [];
      expect(fields).toEqual(expect.arrayContaining(['languages', 'minAge']));
    });

    it('最低年龄低于 18 被拒绝', () => {
      const result = validateAdvantagePlusControls({
        geoLocations: ['TH'],
        languages: ['th'],
        minAge: 16,
      });
      expect(result.ok).toBe(false);
      expect(!result.ok && result.errors[0].field).toBe('minAge');
    });
  });

  describe('validatePmaxAssetGroup（需求 25.3）', () => {
    it('一次性列出所有缺失资产类别', () => {
      const result = validatePmaxAssetGroup({ headlines: [] });
      expect(result.ok).toBe(false);
      const fields = !result.ok ? result.errors.map((e) => e.field) : [];
      expect(fields).toEqual(expect.arrayContaining(['headlines', 'descriptions', 'images']));
    });
  });

  describe('resolveBiddingStrategy（需求 26.2-26.4）', () => {
    it('不支持的策略 → 「出价方式不受支持」', () => {
      const result = resolveBiddingStrategy('tiktok', 'TARGET_ROAS');
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toBe('出价方式不受支持');
    });

    it('Target CPA 缺目标值 → 点名缺失项', () => {
      const result = resolveBiddingStrategy('meta', 'TARGET_CPA');
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error === '目标值缺失' && result.missing).toBe('targetCpa');
    });

    it('支持的策略转换为平台原生参数', () => {
      const result = resolveBiddingStrategy('meta', 'TARGET_CPA', 5);
      expect(result.ok).toBe(true);
      expect(result.ok && result.nativeParam).toBe('COST_CAP');
      expect(result.ok && result.targetValue).toBe(5);
    });

    it('每个平台支持集合内的策略都能解析出原生参数', () => {
      for (const platform of ['meta', 'google', 'tiktok'] as const) {
        for (const strategy of PLATFORM_BIDDING_SUPPORT[platform]) {
          const result = resolveBiddingStrategy(platform, strategy, 10);
          expect(result.ok).toBe(true);
        }
      }
    });
  });

  describe('其余校验纯函数', () => {
    it('实验分组少于两个 → 「实验分组数量不足」（需求 28.4）', () => {
      const result = validateExperimentGroups([{}]);
      expect(!result.ok && result.errors[0].reason).toBe('实验分组数量不足');
      expect(validateExperimentGroups([{}, {}]).ok).toBe(true);
    });

    it('预估缺定向/预算 → 点名缺失项（需求 29.4）', () => {
      const result = validateEstimateInputs({});
      expect(result.ok).toBe(false);
      const fields = !result.ok ? result.errors.map((e) => e.field) : [];
      expect(fields).toEqual(expect.arrayContaining(['targeting', 'budget']));
    });

    it('消息广告：WhatsApp 渠道未配置 → 「WhatsApp 渠道未配置」（需求 30.4）', () => {
      const result = validateMessageAd({
        destination: 'whatsapp',
        prefilledMessage: '您好',
        routing: {},
        whatsappConfigured: false,
      });
      expect(!result.ok && result.errors[0].reason).toBe('WhatsApp 渠道未配置');
    });

    it('消息广告：预填消息与路由配置必填（需求 30.3）', () => {
      const result = validateMessageAd({ destination: 'messenger' });
      expect(result.ok).toBe(false);
      const fields = !result.ok ? result.errors.map((e) => e.field) : [];
      expect(fields).toEqual(expect.arrayContaining(['prefilledMessage', 'routing']));
    });

    it('AI 创意：产品素材缺失被点名（需求 31.4）', () => {
      const result = validateCreativeInputs({ targetLanguages: ['th'] });
      expect(!result.ok && result.errors[0].field).toBe('productAssets');
    });

    it('离线转化：列出全部缺失必填项（需求 32.3）', () => {
      const result = validateOfflineConversion({});
      expect(result.ok).toBe(false);
      const fields = !result.ok ? result.errors.map((e) => e.field) : [];
      expect(fields).toEqual(['eventId', 'eventTime', 'value']);
    });
  });
});
