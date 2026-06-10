import { Injectable } from '@nestjs/common';

import { CredentialManagerService } from '../../credential/credential-manager.service';
import {
  VERIFIABLE_FIELDS,
  type GeminiVerificationOutput,
  type RawLead,
  type VerifiableField,
} from '../domain/verification';

/** Gemini 背调端口（组件 9，需求 15.2）。 */
export interface GeminiVerifier {
  verify(lead: RawLead): Promise<GeminiVerificationOutput>;
}

export const GEMINI_VERIFIER = Symbol('GEMINI_VERIFIER');

/** Gemini REST API 基址（generativelanguage，真实服务）。 */
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** 默认使用的 Gemini 模型。 */
const GEMINI_MODEL = 'gemini-1.5-flash';

/** Gemini 调用超时（毫秒）。 */
const GEMINI_TIMEOUT_MS = 30_000;

/**
 * 默认 Gemini 背调端口实现（需求 15.2）。
 *
 * 经凭据管理器 `useDecrypted('gemini', 'apiKey', …)` 在内存中取 API Key 调用**真实
 * Google Gemini API**，用后立即清理（需求 6.3、6.4）。凭据未填入时由凭据管理器抛
 * 「该平台凭据未配置」，调用方据此降级（需求 15.3），绝不以假数据顶替业务逻辑。
 */
@Injectable()
export class DefaultGeminiVerifier implements GeminiVerifier {
  constructor(private readonly credentials: CredentialManagerService) {}

  async verify(lead: RawLead): Promise<GeminiVerificationOutput> {
    const prompt = this.buildPrompt(lead);
    const text = await this.generate(prompt);
    return this.parse(text);
  }

  private async generate(prompt: string): Promise<string> {
    return this.credentials.useDecrypted('gemini', 'apiKey', async (apiKey) => {
      const url = `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(
        apiKey,
      )}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Gemini API 调用失败：HTTP ${response.status}`);
        }
        const data = (await response.json()) as GeminiResponse;
        return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      } finally {
        clearTimeout(timer);
      }
    });
  }

  private buildPrompt(lead: RawLead): string {
    return [
      '你是企业背景调查专家。请基于公开网络信息对以下买家留资做背景调查与补全：',
      '核实/补全字段：companyName（公司名）、phone（电话）、email（邮箱）、industry（行业）、jobTitle（职位）。',
      '同时给出 0-100 的可信度评估 credibilityScore 与一句话摘要 summary。',
      '仅输出 JSON：{"fields":{"companyName":"…","phone":"…","email":"…","industry":"…","jobTitle":"…"},"credibilityScore":0,"summary":"…"}。',
      '无法核实的字段省略，不要编造。',
      `留资数据：${JSON.stringify(lead)}`,
    ].join('\n');
  }

  private parse(text: string): GeminiVerificationOutput {
    const obj = safeParseObject(text);
    const rawFields =
      typeof obj.fields === 'object' && obj.fields !== null
        ? (obj.fields as Record<string, unknown>)
        : {};
    const fields: Partial<Record<VerifiableField, string>> = {};
    for (const field of VERIFIABLE_FIELDS) {
      const v = rawFields[field];
      if (typeof v === 'string' && v.trim().length > 0) {
        fields[field] = v.trim();
      }
    }
    const score = obj.credibilityScore;
    return {
      fields,
      credibilityScore:
        typeof score === 'number' && Number.isFinite(score)
          ? Math.min(100, Math.max(0, score))
          : null,
      summary: typeof obj.summary === 'string' ? obj.summary : null,
    };
  }
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/** 安全解析 JSON 对象；失败返回空对象。 */
function safeParseObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
