import { Injectable } from '@nestjs/common';

import { CredentialManagerService } from '../../credential/credential-manager.service';
import { extractJsonText, geminiChatCompletion } from '../../../common/llm/gemini-chat';
import type { AssetRef } from '../../platform-adapter/domain/platform-adapter';
import type { BuyerPersona, PlatformDraft } from '../domain/ai-campaign';
import { ACTIVE_PLATFORMS } from '../../unified-model/domain/unified-model';
import type { GeminiClient } from './index';

/**
 * 默认 Gemini 客户端（组件 5 端口实现，需求 9.1、9.2、9.7）。
 *
 * 经凭据管理器 `useDecrypted('gemini', 'apiKey', …)` 在内存中取 API Key，经 **Gemini
 * 中转（OpenAI 兼容 Chat Completions）**调用真实模型，用后立即清理（需求 6.3、6.4）。凭据未填入时
 * 由凭据管理器抛「该平台凭据未配置」，调用方（AI 辅助建广告服务）据此降级为不可用，
 * 绝不以假数据顶替业务逻辑（需求 9.7）。
 *
 * 职责边界：本客户端只把 AI 推理结果结构化为画像/草案骨架；草案中的素材项为对**已上传
 * 成品素材**的引用挂载，引擎不对素材内容做创意设计或改写（需求 9.2）。
 */
@Injectable()
export class DefaultGeminiClient implements GeminiClient {
  constructor(private readonly credentials: CredentialManagerService) {}

  /** 据产品定位描述 + 成品素材自动推导买家画像（需求 9.1）。 */
  async derivePersona(input: {
    positioning: string;
    materials: AssetRef[];
  }): Promise<BuyerPersona> {
    const prompt = this.buildPersonaPrompt(input.positioning, input.materials);
    const text = await this.generate(prompt);
    return this.parsePersona(text);
  }

  /** 据成品素材 + 买家画像生成多平台广告计划草案内容（需求 9.2）。 */
  async generatePlatformDrafts(input: {
    materials: AssetRef[];
    persona: BuyerPersona;
  }): Promise<PlatformDraft[]> {
    const prompt = this.buildDraftPrompt(input.persona, input.materials);
    const text = await this.generate(prompt);
    return this.parsePlatformDrafts(text, input);
  }

  /**
   * 经 Gemini 中转（OpenAI 兼容）调用真实模型（需求 9.1、9.2）。
   *
   * 经凭据管理器解密取 API Key 注入 Bearer 头，用后立即清理（需求 6.3、6.4）；
   * 凭据未配置时由 `useDecrypted` 抛「该平台凭据未配置」向上传播触发降级（需求 9.7）。
   */
  private async generate(prompt: string): Promise<string> {
    return this.credentials.useDecrypted('gemini', 'apiKey', (apiKey) =>
      geminiChatCompletion(apiKey, prompt),
    );
  }

  private buildPersonaPrompt(positioning: string, materials: AssetRef[]): string {
    const hasPositioning = positioning.trim().length > 0;
    return [
      '你是资深外贸 B2B 投放策略专家。',
      hasPositioning
        ? '请依据以下产品定位描述与成品广告素材，推导目标买家画像。'
        : '产品信息未提供：请先从成品广告素材（广告视频/推广素材）推理出产品信息，再据此推导目标买家画像。',
      '仅输出 JSON：{"geo":"国家/地区","industry":"行业","jobRole":"职位"}。',
      '若无法确定国家/地区，默认输出「泰国」。',
      ...(hasPositioning ? [`产品定位描述：${positioning}`] : []),
      `成品素材引用：${JSON.stringify(materials.map((m) => m.assetId))}`,
    ].join('\n');
  }

  private buildDraftPrompt(persona: BuyerPersona, materials: AssetRef[]): string {
    return [
      '你是资深多平台投放策略专家。',
      '请依据买家画像与成品素材，为 Meta/Google/TikTok 各平台生成广告计划草案骨架，',
      '以「单位花费所获有效高意向商机数最大化」为目标给出受众定向、预算与出价建议。',
      '素材仅做引用挂载，不要改写素材创意。',
      `买家画像：${JSON.stringify(persona)}`,
      `成品素材引用：${JSON.stringify(materials.map((m) => m.assetId))}`,
    ].join('\n');
  }

  /** 解析画像 JSON；字段缺失时回退为空串由上层判定缺失（需求 9.8）。 */
  private parsePersona(text: string): BuyerPersona {
    const obj = safeParseObject(extractJsonText(text));
    return {
      geo: stringOf(obj.geo),
      industry: stringOf(obj.industry),
      jobRole: stringOf(obj.jobRole),
    };
  }

  /**
   * 解析草案 JSON 为各平台草案；AI 输出仅作建议字段，素材引用以入参为准（需求 9.2）。
   * 解析失败时回退为各平台最小可用骨架，保证「凭据已填入即可生成」。
   */
  private parsePlatformDrafts(
    text: string,
    input: { materials: AssetRef[]; persona: BuyerPersona },
  ): PlatformDraft[] {
    const parsed = safeParseObject(extractJsonText(text));
    const byPlatform = (parsed.platforms ?? {}) as Record<string, Record<string, unknown>>;

    return ACTIVE_PLATFORMS.map((platform) => {
      const node = byPlatform[platform] ?? {};
      return {
        platform,
        campaign: (node.campaign as Record<string, unknown>) ?? {
          objective: 'LEADS',
          name: `${input.persona.industry}-${input.persona.geo}`,
        },
        adGroup: (node.adGroup as Record<string, unknown>) ?? {
          targeting: {
            geo: input.persona.geo,
            industry: input.persona.industry,
            jobRole: input.persona.jobRole,
          },
        },
        ad: (node.ad as Record<string, unknown>) ?? {},
        // 素材以入参为准：引用挂载、不改写（需求 9.2）。
        assetRefs: input.materials,
        leadFormSuggestion: (node.leadFormSuggestion as Record<string, unknown>) ?? {
          fields: { companyName: true, name: true, phone: true, email: true },
        },
      };
    });
  }
}

/** 安全解析 JSON 对象；失败返回空对象（不抛错，由上层判定缺失/回退）。 */
function safeParseObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 取字符串值，非字符串回退空串。 */
function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
