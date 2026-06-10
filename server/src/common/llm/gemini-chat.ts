/**
 * Gemini 中转（OpenAI 兼容 Chat Completions）调用助手。
 *
 * 经中转节点以 OpenAI Chat API 格式调用 Gemini 模型（旧版 API 文档）：
 * `POST {GEMINI_API_BASE}/v1/chat/completions`，`Authorization: Bearer <apiKey>`。
 * 中转服务以流式（SSE）响应为准，本助手聚合增量 delta 为完整文本。
 *
 * 配置（占位待填，绝不写死密钥）：
 * - `GEMINI_API_BASE`：中转 Host，默认国内直连 `https://grsai.dakka.com.cn`
 *   （海外可设 `https://grsaiapi.com`）。
 * - `GEMINI_MODEL`：模型名，默认 `gemini-3.1-flash-lite`。
 */

/** 默认中转 Host（国内直连）。 */
const DEFAULT_GEMINI_API_BASE = 'https://grsai.dakka.com.cn';

/** 默认模型。 */
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

/** 默认调用超时（毫秒），可经 `GEMINI_TIMEOUT_MS` 覆盖。 */
const DEFAULT_GEMINI_TIMEOUT_MS = 120_000;

function geminiTimeoutMs(): number {
  const raw = Number(process.env.GEMINI_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GEMINI_TIMEOUT_MS;
}

/** 当前生效的中转基址。 */
export function geminiApiBase(): string {
  return (process.env.GEMINI_API_BASE ?? '').trim() || DEFAULT_GEMINI_API_BASE;
}

/** 当前生效的模型名。 */
export function geminiModel(): string {
  return (process.env.GEMINI_MODEL ?? '').trim() || DEFAULT_GEMINI_MODEL;
}

interface ChatChunk {
  choices?: { delta?: { content?: string | null }; message?: { content?: string | null } }[];
}

/**
 * 以 OpenAI 兼容格式调用 Gemini 中转并返回完整助手文本。
 *
 * @throws Error `Gemini API 调用失败：HTTP {status}` 非 2xx 时。
 */
export async function geminiChatCompletion(apiKey: string, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), geminiTimeoutMs());
  try {
    const response = await fetch(`${geminiApiBase()}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: geminiModel(),
        stream: true,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Gemini API 调用失败：HTTP ${response.status}`);
    }
    return await readSseText(response.body);
  } finally {
    clearTimeout(timer);
  }
}

/** 聚合 SSE `data:` 行中的增量内容为完整文本。 */
async function readSseText(body: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder('utf-8');
  const reader = body.getReader();
  let buffer = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      text += parseSseLine(line);
    }
  }
  text += parseSseLine(buffer);
  return text;
}

function parseSseLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return '';
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === '[DONE]') return '';
  try {
    const chunk = JSON.parse(payload) as ChatChunk;
    const choice = chunk.choices?.[0];
    return choice?.delta?.content ?? choice?.message?.content ?? '';
  } catch {
    return '';
  }
}

/** 提取响应中的 JSON 文本（容忍 ```json 代码块包裹）。 */
export function extractJsonText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text.trim();
}
