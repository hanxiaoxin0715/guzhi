import fs from "fs";
import path from "path";
import sharp from "sharp";
import { getOutputsDir } from "@/app/lib/outputs";
import { twoPhaseExtract, type TwoPhaseConfig } from "@/app/lib/twoPhaseExtract";
import { ProxyAgent } from "undici";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min max for hobby plan

// ★ getOutputsDir 现在从 outputs.ts 导入，使用项目隔离路径 outputs/prompts/{projectId}/
//   修复：原先用 getBaseOutputDir() 写入根 outputs/，而 Studio 从 prompts/{projectId}/ 读取导致 404

// ── 代理支持（用于访问被墙的 API，如 Google） ──
function getProxyUrl(): string | null {
  return process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy
    || process.env.ALL_PROXY || process.env.all_proxy
    || null;
}

let _cachedPipelineProxy: ProxyAgent | null | false = false;
function getProxyDispatcher(): ProxyAgent | null {
  if (_cachedPipelineProxy !== false) return _cachedPipelineProxy;
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) { _cachedPipelineProxy = null; return null; }
  try {
    _cachedPipelineProxy = new ProxyAgent(proxyUrl);
    console.log(`[Pipeline] 检测到代理环境变量，将用于外网请求: ${proxyUrl}`);
  } catch {
    _cachedPipelineProxy = null;
  }
  return _cachedPipelineProxy;
}

/** 代理感知的 fetch：如果有代理配置则自动使用 */
async function proxyFetch(url: string, init: RequestInit): Promise<Response> {
  const dispatcher = getProxyDispatcher();
  if (dispatcher) {
    return fetch(url, { ...init, dispatcher } as RequestInit);
  }
  return fetch(url, init);
}

// 浏览器风格 Headers，防止 CDN 拦截（与 llm/route.ts 对齐）
const PIPELINE_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

// ═══════════════════════════════════════════════════════════
// 【备注】新增 API 提供商时，优先保持与 GeeKnow 等代理一致的长提示词输入能力。
// capMaxTokens() 会根据模型名自动裁剪，确保各平台兼容。
// 参考：GeeKnow Gemini 支持 16384 tokens，通义千问 Qwen 上限 8192 tokens。
// ═══════════════════════════════════════════════════════════

/**
 * Server-side image compression using sharp.
 * Resizes data-URI images to fit within maxDim and converts to JPEG.
 * This keeps multimodal payloads small enough for LLM API proxies.
 */
async function compressDataUri(dataUri: string, maxDim = 768, quality = 75): Promise<string> {
  if (!dataUri.startsWith("data:")) return dataUri; // not a data URI — return as-is
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return dataUri;
  const base64 = match[2];
  const buf = Buffer.from(base64, "base64");
  const compressed = await sharp(buf)
    .resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
  return `data:image/jpeg;base64,${compressed.toString("base64")}`;
}

interface PipelineRequest {
  script: string;
  episode: string;
  settings: Record<string, string>;
  consistencyContext?: string;
  referenceImages?: string[]; // base64 data URLs of reference images (multimodal)
  resume?: boolean; // ★ 断点续传：跳过已完成的阶段/集数
  customPrompts?: {
    nineGridGem?: string;
    fourGridGem?: string;
    beatBreakdown?: string;
  };
}

// ── Gem.txt system prompt loading ──
const gemPromptCache = new Map<string, string>();

/** Load a Gem.txt system prompt. Tries cwd() first (standalone), then cwd/.. (dev). Cached in memory. */
function loadGemPrompt(filename: string): string {
  if (gemPromptCache.has(filename)) return gemPromptCache.get(filename)!;
  // standalone 部署时文件在 cwd()，开发时在 cwd()/..
  const candidates = [
    path.join(process.cwd(), filename),
    path.join(process.cwd(), "..", filename),
  ];
  for (const filePath of candidates) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      gemPromptCache.set(filename, content);
      console.log(`[Pipeline] Loaded Gem prompt: ${filename} from ${filePath} (${content.length} chars)`);
      return content;
    } catch { /* try next */ }
  }
  console.error(`[Pipeline] Failed to load ${filename} from any path`);
  return "";
}

function ensureOutputDir() {
  const dir = getOutputsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Cap max_tokens based on known model limits */
function capMaxTokens(model: string, requestedTokens: number): number {
  const lower = model.toLowerCase();
  // Qwen3-Max: supports 16384 output tokens — long-context model
  if (lower.includes("qwen3-max")) return Math.min(requestedTokens, 16384);
  // Older Qwen series: max_tokens upper limit is 8192
  if (lower.includes("qwen")) return Math.min(requestedTokens, 8192);
  // DashScope / Alibaba models
  if (lower.includes("dashscope")) return Math.min(requestedTokens, 8192);
  return requestedTokens;
}

// Progress callback type for detailed logging
type ProgressFn = (msg: string) => void;

/** Concurrency limit for per-episode parallel LLM calls */
const PARALLEL_CONCURRENCY = 3;

/** Result of a single per-episode LLM call */
type EpResult = { epId: string; content: string; error?: string };

/** Simple semaphore for controlling parallel execution */
class Semaphore {
  private queue: (() => void)[] = [];
  private current = 0;
  constructor(private max: number) {}
  async acquire(): Promise<void> {
    if (this.current < this.max) { this.current++; return; }
    return new Promise<void>(resolve => this.queue.push(resolve));
  }
  release(): void {
    this.current--;
    if (this.queue.length > 0) { this.current++; this.queue.shift()!(); }
  }
}

async function callLLMOnce(
  apiKey: string,
  baseUrl: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 8192,
  isResponsesApi = false,
  onProgress?: ProgressFn,
  temperature = 0.7,
  images?: string[]
): Promise<string> {
  // Apply model-specific token cap for both API formats
  const effectiveTokens = capMaxTokens(model, maxTokens);

  // ── Decide whether to use Gemini native API for multimodal ──
  // GeeKnow proxy's /v1/chat/completions does NOT properly forward image_url to Gemini.
  // When images are present and the base URL looks like a Gemini-compatible endpoint,
  // use Gemini native API format (inlineData + parts) instead.
  const hasImages = images && images.length > 0;
  const urlLower = baseUrl.toLowerCase();
  const useGeminiNative = hasImages && !isResponsesApi && (
    urlLower.includes("geeknow") ||
    urlLower.includes("generativelanguage.googleapis.com") ||
    urlLower.includes("gemini")
  );

  if (useGeminiNative && hasImages) {
    return callLLMGeminiNative(baseUrl, apiKey, model, systemPrompt, userPrompt, images, effectiveTokens, temperature, onProgress);
  }

  // ── Standard OpenAI Chat Completions / DashScope Responses path ──
  let url = baseUrl.replace(/\/+$/, "");
  if (isResponsesApi) {
    if (!url.endsWith("/responses")) url += "/responses";
  } else {
    if (!url.includes("/chat/completions")) url += "/chat/completions";
  }

  // Compress images server-side to keep payloads small for API proxies
  let compressedImages = images;
  if (hasImages) {
    try {
      compressedImages = await Promise.all(
        images.map(img => compressDataUri(img, 768, 75))
      );
    } catch (e) {
      console.warn(`[Pipeline LLM] Image compression failed, using originals:`, (e as Error).message?.slice(0, 100));
      compressedImages = images;
    }
  }

  // Build user content: multimodal (images + text) or text-only
  const userContent: unknown = compressedImages && compressedImages.length > 0
    ? [
        ...compressedImages.map(img => ({
          type: "image_url" as const,
          image_url: { url: img, detail: "low" as const },
        })),
        { type: "text" as const, text: userPrompt },
      ]
    : userPrompt;

  const messages: { role: string; content: unknown }[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  if (compressedImages && compressedImages.length > 0) {
    const imgSizes = compressedImages.map((img, i) => `img${i + 1}=${(img.length / 1024).toFixed(0)}KB`).join(", ");
    console.log(`[Pipeline LLM] Multimodal call (Chat Completions): ${compressedImages.length} images (${imgSizes})`);
    onProgress?.(`    └ 多模态调用 (Chat Completions): 附带 ${compressedImages.length} 张参考图 (${imgSizes})`);
  }

  const sysLen = systemPrompt.length;
  const usrLen = userPrompt.length;
  const totalPromptChars = sysLen + usrLen;
  const estimatedTokens = Math.round(totalPromptChars / 2.5);

  console.log(`[Pipeline LLM] model=${model}, url=${url}, max_tokens=${effectiveTokens}, prompt_len=${usrLen}, api=${isResponsesApi ? "responses" : "chat"}`);
  onProgress?.(`    └ 模型: ${model} | API: ${isResponsesApi ? "Responses" : "Chat Completions"}`);
  onProgress?.(`    └ 提示词: 系统 ${sysLen.toLocaleString()} 字 + 用户 ${usrLen.toLocaleString()} 字 = ${totalPromptChars.toLocaleString()} 字 (≈${estimatedTokens.toLocaleString()} tokens)`);
  onProgress?.(`    └ max_tokens: ${effectiveTokens.toLocaleString()} | temperature: ${temperature}`);

  const t0 = Date.now();

  // First try streaming to avoid upstream gateway 504 timeouts
  let content = "";
  let streamTruncated = false;

  // Streaming progress handler: reports thinking/generating state to caller
  let streamFirstContent = false;
  const handleStreamProgress = onProgress ? (chars: number) => {
    if (chars === 0) {
      onProgress(`    └ 模型思考中...`);
    } else if (!streamFirstContent) {
      streamFirstContent = true;
      const thinkSec = ((Date.now() - t0) / 1000).toFixed(0);
      onProgress(`    └ 模型开始输出 (思考耗时 ${thinkSec}s)`);
    } else {
      onProgress(`    └ 输出中... (已收到 ${chars.toLocaleString()} 字)`);
    }
  } : undefined;

  try {
    onProgress?.(`    └ 尝试 Streaming 调用...`);
    const streamResult = await callLLMStreaming(url, apiKey, model, messages, effectiveTokens, isResponsesApi, handleStreamProgress, temperature);
    content = streamResult.content;
    streamTruncated = streamResult.truncated;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[Pipeline LLM] streaming returned ${content.length} chars${streamTruncated ? " (TRUNCATED)" : ""}`);
    onProgress?.(`    └ Streaming 成功: ${content.length.toLocaleString()} 字 | 耗时 ${elapsed}s${streamTruncated ? " ⚠截断" : ""}`);
  } catch (e) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const errMsg = e instanceof Error ? e.message.slice(0, 120) : String(e);
    console.warn(`[Pipeline LLM] streaming failed: ${errMsg}`);
    onProgress?.(`    └ Streaming 失败 (${elapsed}s): ${errMsg}`);
  }

  // If streaming returned empty/too short/truncated, fallback to non-streaming
  if (content.trim().length <= 10 || streamTruncated) {
    const reason = streamTruncated ? "输出被截断" : "内容过短";
    console.log(`[Pipeline LLM] falling back to non-streaming (${reason})...`);
    onProgress?.(`    └ 回退到非流式调用 (${reason})...`);
    const t1 = Date.now();
    content = await callLLMNonStreaming(url, apiKey, model, messages, effectiveTokens, isResponsesApi, temperature);
    const elapsed = ((Date.now() - t1) / 1000).toFixed(1);
    console.log(`[Pipeline LLM] non-streaming returned ${content.length} chars`);
    onProgress?.(`    └ 非流式成功: ${content.length.toLocaleString()} 字 | 耗时 ${elapsed}s`);
  }

  return content;
}

// ═══════════════════════════════════════════════════════════
// Gemini Native API — for multimodal calls to Gemini-compatible endpoints
// Uses inlineData + parts format (same as image API), bypassing Chat Completions proxy limitations
// ═══════════════════════════════════════════════════════════

function parseDataUrl(dataUri: string): { mimeType: string; data: string } | null {
  const m = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

async function callLLMGeminiNative(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  images: string[],
  maxTokens: number,
  temperature: number,
  onProgress?: ProgressFn,
): Promise<string> {
  // Compress images first
  let compressed: string[];
  try {
    compressed = await Promise.all(images.map(img => compressDataUri(img, 768, 75)));
  } catch {
    compressed = images;
  }

  const imgSizes = compressed.map((img, i) => `img${i + 1}=${(img.length / 1024).toFixed(0)}KB`).join(", ");
  onProgress?.(`    └ Gemini 原生多模态: ${compressed.length} 张参考图 (${imgSizes})`);
  console.log(`[Pipeline LLM] Gemini native multimodal: ${compressed.length} images (${imgSizes})`);

  // Build Gemini native contents format
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = [];
  for (const img of compressed) {
    if (img.startsWith("data:")) {
      const parsed = parseDataUrl(img);
      if (parsed) {
        parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
      }
    }
  }
  parts.push({ text: userPrompt });

  const contents = [{ role: "user", parts }];

  // Clean base URL and build Gemini API URL
  const cleanBase = baseUrl.replace(/\/+$/, "").replace(/\/v1\/?$/i, "").replace(/\/v1beta.*$/i, "");
  const geminiUrl = `${cleanBase}/v1beta/models/${model}:generateContent`;
  const geminiStreamUrl = `${cleanBase}/v1beta/models/${model}:streamGenerateContent?alt=sse`;

  const reqBody = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
    },
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };

  const sysLen = systemPrompt.length;
  const usrLen = userPrompt.length;
  onProgress?.(`    └ 模型: ${model} | API: Gemini Native`);
  onProgress?.(`    └ 提示词: 系统 ${sysLen.toLocaleString()} 字 + 用户 ${usrLen.toLocaleString()} 字`);
  onProgress?.(`    └ max_tokens: ${maxTokens.toLocaleString()} | temperature: ${temperature}`);

  const t0 = Date.now();

  // Try streaming first
  let content = "";
  try {
    onProgress?.(`    └ 尝试 Gemini Streaming...`);
    const res = await proxyFetch(geminiStreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(300000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini API 错误 (${res.status}): ${errText.slice(0, 300)}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    onProgress?.(`    └ 模型思考中...`);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("event:")) continue;
        let jsonStr = trimmed;
        if (trimmed.startsWith("data: ")) jsonStr = trimmed.slice(6);
        else if (trimmed.startsWith("data:")) jsonStr = trimmed.slice(5);
        if (jsonStr === "[DONE]") continue;

        try {
          const chunk = JSON.parse(jsonStr);
          const parts2 = chunk.candidates?.[0]?.content?.parts;
          if (Array.isArray(parts2)) {
            for (const part of parts2) {
              if (part.text) content += part.text;
            }
          }
        } catch { /* skip */ }
      }
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[Pipeline LLM] Gemini streaming returned ${content.length} chars`);
    onProgress?.(`    └ Gemini Streaming 成功: ${content.length.toLocaleString()} 字 | 耗时 ${elapsed}s`);
  } catch (e) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const errMsg = e instanceof Error ? e.message.slice(0, 120) : String(e);
    console.warn(`[Pipeline LLM] Gemini streaming failed: ${errMsg}`);
    onProgress?.(`    └ Gemini Streaming 失败 (${elapsed}s): ${errMsg}`);
  }

  // Fallback to non-streaming if needed
  if (content.trim().length <= 10) {
    onProgress?.(`    └ 回退到 Gemini 非流式...`);
    const t1 = Date.now();
    const res = await proxyFetch(geminiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(300000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini API 错误 (${res.status}): ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const parts2 = data.candidates?.[0]?.content?.parts;
    if (Array.isArray(parts2)) {
      for (const p of parts2) {
        if (p.text) content += p.text;
      }
    }

    if (!content) {
      const blockReason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason;
      console.warn(`[Pipeline LLM] Gemini non-streaming empty. finishReason=${blockReason}, keys=${Object.keys(data).join(",")}`);
      console.warn(`[Pipeline LLM] Full response:`, JSON.stringify(data).slice(0, 500));
      onProgress?.(`    └ Gemini 返回空内容 (finishReason=${blockReason})`);
    }

    const elapsed = ((Date.now() - t1) / 1000).toFixed(1);
    onProgress?.(`    └ Gemini 非流式: ${content.length.toLocaleString()} 字 | 耗时 ${elapsed}s`);
  }

  return content;
}

async function callLLMStreaming(
  url: string,
  apiKey: string,
  model: string,
  messages: { role: string; content: unknown }[],
  maxTokens: number,
  isResponsesApi = false,
  onStreamProgress?: (charsSoFar: number) => void,
  temperature = 0.7
): Promise<{ content: string; truncated: boolean }> {
  // Build request body based on API format
  const reqBody = isResponsesApi
    ? { model, input: messages, max_output_tokens: maxTokens, stream: true, temperature }
    : { model, messages, max_tokens: maxTokens, temperature, stream: true };

  const res = await proxyFetch(url, {
    method: "POST",
    headers: {
      ...PIPELINE_HEADERS,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(reqBody),
    signal: AbortSignal.timeout(300000), // 5 min timeout
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LLM API 错误 (${res.status}): ${errText.slice(0, 300)}`);
  }

  // Signal: stream connected, model is now processing (thinking phase)
  onStreamProgress?.(0);

  // Parse SSE stream to collect full content
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let content = "";
  let buffer = "";
  let lastProgressChars = 0;
  let lastProgressTime = Date.now();
  let lastFinishReason = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("event:")) continue;

      // Handle SSE data prefix
      let jsonStr = trimmed;
      if (trimmed.startsWith("data: ")) jsonStr = trimmed.slice(6);
      else if (trimmed.startsWith("data:")) jsonStr = trimmed.slice(5);
      if (jsonStr === "[DONE]") continue;

      try {
        const chunk = JSON.parse(jsonStr);
        if (isResponsesApi) {
          // DashScope Responses API: response.output_text.delta events
          if (chunk.type === "response.output_text.delta" && chunk.delta) {
            content += chunk.delta;
          }
        } else {
          // Chat Completions API
          const delta = chunk.choices?.[0]?.delta;
          // Handle both standard content and reasoning_content (Qwen thinking models)
          // Use ?? to avoid treating empty string content as falsy and leaking reasoning text
          const text = delta?.content ?? "";
          if (text) content += text;
          // 追踪 finish_reason（仅最后一个 chunk 有值）
          const fr = chunk.choices?.[0]?.finish_reason;
          if (fr) lastFinishReason = fr;
        }
      } catch {
        // skip malformed chunks
      }
    }

    // Report streaming progress periodically (throttled: every 2s or 2000 chars)
    if (onStreamProgress && content.length > lastProgressChars) {
      const now = Date.now();
      if (now - lastProgressTime >= 2000 || content.length - lastProgressChars >= 2000) {
        onStreamProgress(content.length);
        lastProgressChars = content.length;
        lastProgressTime = now;
      }
    }
  }

  // Process any remaining data in buffer after stream ends
  if (buffer.trim()) {
    const trimmed = buffer.trim();
    let jsonStr = trimmed;
    if (trimmed.startsWith("data: ")) jsonStr = trimmed.slice(6);
    else if (trimmed.startsWith("data:")) jsonStr = trimmed.slice(5);
    if (jsonStr !== "[DONE]") {
      try {
        const chunk = JSON.parse(jsonStr);
        if (isResponsesApi) {
          if (chunk.type === "response.output_text.delta" && chunk.delta) {
            content += chunk.delta;
          }
        } else {
          const text = chunk.choices?.[0]?.delta?.content ?? "";
          if (text) content += text;
        }
        // 捕获 finish_reason（最后一个 chunk 才有）
        const fr2 = chunk.choices?.[0]?.finish_reason;
        if (fr2) lastFinishReason = fr2;
        // Diagnostic: if final chunk has finish_reason, log it when content is empty
        if (!content && fr2) {
          console.warn(`[Pipeline LLM] Stream finished with empty content, finish_reason=${fr2}`);
        }
      } catch { /* skip */ }
    }
  }

  // Diagnostic: if streaming returned nothing, log the fact
  if (!content) {
    console.warn(`[Pipeline LLM] Streaming returned empty content — model may not support multimodal or content was filtered`);
  }

  // ★ 检测输出截断：finish_reason="length" 表示因 max_tokens 被截断
  const truncated = lastFinishReason === "length";
  if (truncated) {
    console.warn(`[Pipeline LLM] ⚠ 输出被截断 (finish_reason=length, content=${content.length} chars) — max_tokens 可能不足`);
  } else if (lastFinishReason && lastFinishReason !== "stop") {
    console.warn(`[Pipeline LLM] 异常结束: finish_reason=${lastFinishReason}`);
  }

  return { content, truncated };
}

async function callLLMNonStreaming(
  url: string,
  apiKey: string,
  model: string,
  messages: { role: string; content: unknown }[],
  maxTokens: number,
  isResponsesApi = false,
  temperature = 0.7
): Promise<string> {
  const reqBody = isResponsesApi
    ? { model, input: messages, max_output_tokens: maxTokens, temperature }
    : { model, messages, max_tokens: maxTokens, temperature, stream: false };

  const res = await proxyFetch(url, {
    method: "POST",
    headers: {
      ...PIPELINE_HEADERS,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(reqBody),
    signal: AbortSignal.timeout(300000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LLM API 错误 (${res.status}): ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  if (isResponsesApi) {
    // Responses API: output[].content[].text where type === "output_text"
    let content = "";
    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === "output_text" && c.text) content += c.text;
          }
        }
      }
    }
    const result = content || data.output_text || "";
    if (!result) {
      console.warn(`[Pipeline LLM] Non-streaming (Responses API) returned empty. Full response:`, JSON.stringify(data).slice(0, 500));
    }
    return result;
  }
  const result = data.choices?.[0]?.message?.content || "";
  if (!result) {
    // Diagnostic: log finish_reason, error, and partial response to help debug
    const finishReason = data.choices?.[0]?.finish_reason;
    const errorInfo = data.error;
    console.warn(`[Pipeline LLM] Non-streaming returned empty content. finish_reason=${finishReason}, error=${JSON.stringify(errorInfo)}, data_keys=${Object.keys(data).join(",")}`);
    console.warn(`[Pipeline LLM] Full response (first 500 chars):`, JSON.stringify(data).slice(0, 500));
  }
  return result;
}

async function callLLM(
  apiKey: string,
  baseUrl: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxRetries = 2,
  maxTokens = 8192,
  isResponsesApi = false,
  onProgress?: ProgressFn,
  temperature = 0.7,
  images?: string[]
): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = 3000 * (attempt);
        onProgress?.(`    └ 第 ${attempt + 1} 次重试 (等待 ${delay / 1000}s)...`);
        await new Promise(r => setTimeout(r, delay));
      }
      console.log(`[Pipeline LLM] callLLM attempt ${attempt + 1}/${maxRetries + 1}`);
      const result = await callLLMOnce(apiKey, baseUrl, model, systemPrompt, userPrompt, maxTokens, isResponsesApi, onProgress, temperature, images);
      if (result.trim().length > 10) return result;
      throw new Error("LLM 返回内容过短或为空");
    } catch (e) {
      lastError = e as Error;
      console.error(`[Pipeline LLM] attempt ${attempt + 1} failed: ${lastError.message.slice(0, 200)}`);
      onProgress?.(`    └ ✗ 尝试 ${attempt + 1}/${maxRetries + 1} 失败: ${lastError.message.slice(0, 100)}`);
    }
  }

  // ── Multimodal fallback: if all attempts failed WITH images, retry WITHOUT images ──
  if (images && images.length > 0) {
    onProgress?.(`    └ ⚠ 多模态调用全部失败，降级为纯文本重试 (不含参考图)...`);
    console.warn(`[Pipeline LLM] Multimodal failed ${maxRetries + 1} times — falling back to text-only`);
    try {
      const result = await callLLMOnce(apiKey, baseUrl, model, systemPrompt, userPrompt, maxTokens, isResponsesApi, onProgress, temperature, undefined);
      if (result.trim().length > 10) {
        onProgress?.(`    └ ✓ 纯文本降级成功 (${result.length.toLocaleString()} 字)`);
        return result;
      }
    } catch (e) {
      console.error(`[Pipeline LLM] Text-only fallback also failed:`, (e as Error).message?.slice(0, 200));
    }
  }

  throw lastError || new Error("LLM 调用失败（已重试）");
}

// ═══════════════════════════════════════════════════════════
// Stage 1: Beat Breakdown — convert novel to structured screenplay with episode splits
// ═══════════════════════════════════════════════════════════
export const BEAT_BREAKDOWN_PROMPT = `你是一名专业的影视编剧兼导演。你的任务是将用户提供的小说/剧本文本转化为结构化的分集剧本节拍拆解表。

━━ 核心任务 ━━
1. 通读全文，理解故事脉络
2. 将故事拆分为若干集（每集对应一张九宫格 = 9个关键画面 = 约27秒视频）
3. 每集包含9个节拍（Beat），每个节拍对应一个关键画面
4. 确保每集的内容各不相同，覆盖故事的不同段落

━━ 时间规则 ━━
- 每个分镜画面 = 3 秒
- 一集 = 9 格 = 27 秒
- 根据情节密度和动作量估算集数

━━ 分集原则（必须遵守） ━━
• 每集聚焦故事的一个连续段落，禁止重复已在其他集使用过的剧情
• 集与集之间的剧情必须是递进的——第2集从第1集结束的地方继续
• 严格按照原文的时间线/叙事顺序分配内容
• 如果原文较短不足以支撑多集，减少集数，不要编造或重复内容
• 场景切换频繁时可以以场景为自然分界切集

━━ 忠实原作规则 ━━
• 所有内容必须严格来源于原文，禁止添加原文中不存在的角色、场景、对话、情节
• 禁止自行补充或推测原文未描述的细节
• 每个节拍都必须能在原文中找到对应段落

━━ 判断集数参考 ━━
- 极短/单场景：1-2 集
- 短篇/简单：3-5 集
- 中等篇幅：6-9 集
- 长篇/多场景：10-15 集

━━ 输出格式（严格遵守） ━━
第一行必须是：<!-- EPISODES: N -->（N为总集数）

然后每集用以下格式：

## 第1集 · 集标题
【剧情概要】用2-3句话概括本集讲述的故事段落（向导演说明本集覆盖原文的哪一部分）

### Beat 1：节拍标题
节拍描述（简洁明了，30-50字，描述这个画面中发生什么）

### Beat 2：节拍标题
...

（每集9个Beat，共N集）

===（集间分隔符）

## 第2集 · 集标题
【剧情概要】...
（从第1集结束的地方继续）

### Beat 1：...
...`;

/**
 * Parse beat breakdown output into per-episode screenplay segments.
 * Returns an array where index 0 = EP01's content, index 1 = EP02's content, etc.
 */
function parseBeatBreakdownEpisodes(raw: string): { totalEps: number; episodes: string[] } {
  // Extract total episode count
  const epMatch = raw.match(/<!--\s*EPISODES:\s*(\d+)\s*-->/i);
  const totalEps = epMatch ? Math.max(1, Math.min(30, parseInt(epMatch[1], 10))) : 1;

  // Split by episode headers: ## 第N集
  // ★ Bug fix: LLM sometimes outputs Chinese numerals (第一集) instead of Arabic (第1集)
  //   Support both: 第1集, 第一集, 第壹集, etc.
  const CJK_NUM = "[\\d一二三四五六七八九十百千零壹贰叁肆伍陆柒捌玖拾]+";
  const epSplitPattern = new RegExp(`(?=^## 第${CJK_NUM}集)`, "m");
  const epTestPattern = new RegExp(`^## 第${CJK_NUM}集`);
  let parts = raw.split(epSplitPattern).filter(p => epTestPattern.test(p.trim()));

  // Fallback: try "# 第 N 集" (single #) or "第 N 集：" without # prefix
  if (parts.length === 0) {
    const altPattern = new RegExp(`(?=^#+ 第${CJK_NUM}集)`, "m");
    const altTest = new RegExp(`^#+ 第${CJK_NUM}集`);
    parts = raw.split(altPattern).filter(p => altTest.test(p.trim()));
  }

  if (parts.length === 0) {
    // Fallback: couldn't split, treat entire output as one episode
    return { totalEps: 1, episodes: [raw] };
  }

  return { totalEps: parts.length, episodes: parts.map(p => p.trim()) };
}

/**
 * Parse JSON from Gem.txt-based LLM output.
 * The model returns JSON with { shots: [{ shot_number, prompt_text }] }.
 * Robust extraction handles markdown code blocks, extra text, etc.
 */
function parseGemJson(raw: string): { shots: { shot_number: string; description?: string; prompt_text: string }[] } | null {
  let s = raw.trim();
  // Remove BOM / zero-width chars
  s = s.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "");
  // Extract from ```json ... ``` code block
  const cbMatch = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (cbMatch) s = cbMatch[1].trim();
  // Find the JSON object
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  // Remove trailing commas before ] or }
  s = s.replace(/,\s*([\]}])/g, "$1");
  try {
    const json = JSON.parse(s);
    if (json.shots && Array.isArray(json.shots)) return json;
    return null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body: PipelineRequest = await request.json();
    const { settings, episode, referenceImages } = body;
    const script = typeof body.script === "string" ? body.script : String(body.script || "");
    const isResume = !!body.resume; // ★ 断点续传标记

    const apiKey = settings["llm-key"] || "";
    const baseUrl = settings["llm-url"] || "https://api.geeknow.top/v1";
    const model = settings["llm-model"] || "gemini-2.5-pro";
    const isResponsesApi = (settings["llm-provider"] || "") === "dashscope-responses";

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "未配置 LLM API Key，请先在设置页配置" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!script || script.trim().length < 50) {
      return new Response(
        JSON.stringify({ error: "剧本内容过短，请先导入剧本" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    ensureOutputDir();

    // ★ Bug fix: Clear stale Gem.txt cache so file edits take effect immediately
    gemPromptCache.clear();

    // Load Gem.txt system prompts — prefer user-edited version from customPrompts,
    // fallback to filesystem Gem.txt file
    const nineGridGemPrompt = (body.customPrompts?.nineGridGem && body.customPrompts.nineGridGem.length > 50)
      ? body.customPrompts.nineGridGem
      : loadGemPrompt("9宫格分镜Gem.txt");
    const fourGridGemPrompt = (body.customPrompts?.fourGridGem && body.customPrompts.fourGridGem.length > 50)
      ? body.customPrompts.fourGridGem
      : loadGemPrompt("4宫格分镜Gem.txt");

    if (!nineGridGemPrompt) {
      return new Response(
        JSON.stringify({ error: "无法加载九宫格系统提示词，请在提示词编辑器中配置或确认 9宫格分镜Gem.txt 存在于项目根目录" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Reference images for multimodal calls
    const refImages = referenceImages && referenceImages.length > 0 ? referenceImages : undefined;

    // Use SSE for streaming progress
    const encoder = new TextEncoder();
    let cancelled = false;
    const stream = new ReadableStream({
      async start(controller) {
        function send(event: string, data: unknown) {
          if (cancelled) return;
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          } catch { /* stream closed */ cancelled = true; }
        }
        // ★ 提取结果专用发送 — 即使流水线被取消/出错，也尝试推送 extract-done
        // 因为提取是并发任务，其结果不应因后续步骤失败而丢失
        function sendExtract(event: string, data: unknown) {
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          } catch { /* stream already closed, extract result lost */ }
        }

        try {
          const pipelineStart = Date.now();
          const logDetail = (stage: number, msg: string) => {
            send("progress", { stage, status: "running", message: msg });
          };

          // === Pre-flight info ===
          send("progress", { stage: 0, status: "running", message: `[制片人] 📋 接收剧本，启动分镜流水线${isResume ? "（断点续传模式）" : ""}` });
          if (isResume) {
            send("progress", { stage: 0, status: "running", message: `[制片人] ♻ 断点续传: 已完成的阶段/集数将自动跳过，仅重新生成缺失部分` });
          }
          send("progress", { stage: 0, status: "running", message: `[制片人] 模型: ${model} | API: ${isResponsesApi ? "Responses" : "Chat Completions"} | 端点: ${baseUrl}` });
          send("progress", { stage: 0, status: "running", message: `[制片人] 剧本: ${script.length.toLocaleString()} 字${refImages ? ` | 参考图: ${refImages.length} 张 (多模态)` : " | 无参考图 (纯文本)"}` });

          // ════════════════════════════════════════════════════════════════
          // Stage 1: Beat Breakdown — 编剧将小说转为分集剧本
          // ════════════════════════════════════════════════════════════════
          send("progress", { stage: 1, status: "running", message: `[编剧] → 分析剧本结构，拆解节拍，分配集数...` });

          const t1 = Date.now();

          // ★ 断点续传：检查已有节拍拆解文件
          const bbFilename = "beat-breakdown.md";
          const bbFilePath = path.join(getOutputsDir(), bbFilename);
          let beatResult: string;
          let skipStage1 = false;

          // 优先使用用户自定义提示词（来自提示词编辑页）— 提升到 if/else 外，续写也需要
          const beatPrompt = (body.customPrompts?.beatBreakdown && body.customPrompts.beatBreakdown.length > 50)
            ? body.customPrompts.beatBreakdown
            : BEAT_BREAKDOWN_PROMPT;

          if (isResume && fs.existsSync(bbFilePath)) {
            // 直接读取已有文件，跳过 LLM 调用
            beatResult = fs.readFileSync(bbFilePath, "utf-8");
            skipStage1 = true;
            send("progress", { stage: 1, status: "running", message: `[编剧] ✓ 发现已有节拍拆解文件 (${beatResult.length.toLocaleString()} 字)，跳过 Stage 1` });
          } else {
          // ★ Bug fix: Include consistencyContext (characters/scenes/props) so the LLM
          //   knows which elements the user considers important and won't overlook them.
          const contextBlock = body.consistencyContext
            ? `\n\n── 角色/场景/道具参考（用户已定义的重要元素，拆解时请确保覆盖） ──\n${body.consistencyContext}\n\n── 小说/剧本正文 ──\n`
            : "";
          if (cancelled) throw new Error("__CANCELLED__");
          const beatBreakdownResult = await callLLM(
            apiKey, baseUrl, model,
            beatPrompt,
            `请阅读以下小说/剧本文本，将其拆分为分集节拍拆解表。注意每集的剧情必须各不相同，按照故事时间线递进。禁止跳过或省略任何段落，确保原文每一段内容都被某个节拍覆盖。${contextBlock}\n\n${script}`,
            2, 16384, isResponsesApi,
            (msg) => logDetail(1, msg),
            0.5
          );

          // Save beat breakdown
          beatResult = beatBreakdownResult;
          fs.writeFileSync(path.join(getOutputsDir(), bbFilename), beatResult, "utf-8");
          } // end else (non-resume)

          // Parse into per-episode segments
          let { totalEps, episodes: epScripts } = parseBeatBreakdownEpisodes(beatResult);

          // ════════════════════════════════════════════════════════════════
          // ★ 截断自动续写（仅非 resume 时执行，resume 已有完整文件不需要续写）
          // ════════════════════════════════════════════════════════════════
          if (!skipStage1) {
          const declaredEpMatch = beatResult.match(/<!--\s*EPISODES:\s*(\d+)\s*-->/i);
          const declaredEps = declaredEpMatch ? Math.max(1, Math.min(30, parseInt(declaredEpMatch[1], 10))) : epScripts.length;

          if (declaredEps > epScripts.length && epScripts.length > 0) {
            const missingStart = epScripts.length + 1;
            send("progress", { stage: 1, status: "running", message: `[编剧] ⚠ 检测到输出截断: 声明 ${declaredEps} 集，仅输出 ${epScripts.length} 集 → 自动续写第 ${missingStart}~${declaredEps} 集...` });

            try {
              if (cancelled) throw new Error("__CANCELLED__");
              // 续写提示词：携带原始小说（保证故事上下文）+ 已完成拆解的尾部（保证格式一致）
              const tailRef = beatResult.slice(-3000);
              const continuationUserPrompt = [
                `你之前将以下小说拆解为 ${declaredEps} 集的节拍表，但由于输出长度限制，只完成了前 ${epScripts.length} 集。`,
                `请严格从第 ${missingStart} 集开始，继续输出剩余 ${declaredEps - epScripts.length} 集的节拍拆解。`,
                ``,
                `要求：`,
                `1. 从第 ${epScripts.length} 集结束的地方继续，不要重复已有内容`,
                `2. 保持完全相同的格式（## 第N集 · 标题 / 【剧情概要】/ Beat 1~9）`,
                `3. 每集剧情从前一集结束处继续递进`,
                `4. 不要输出 <!-- EPISODES: N --> 标记（已有）`,
                ``,
                `── 原始小说/剧本 ──`,
                script,
                ``,
                `── 已完成的拆解（末尾参考格式） ──`,
                tailRef,
              ].join("\n");

              const continuationResult = await callLLM(
                apiKey, baseUrl, model,
                beatPrompt,
                continuationUserPrompt,
                1, 16384, isResponsesApi,
                (msg) => logDetail(1, `[续写] ${msg}`),
                0.5
              );

              // 合并续写结果
              beatResult = beatResult + "\n\n===\n\n" + continuationResult;
              fs.writeFileSync(path.join(getOutputsDir(), bbFilename), beatResult, "utf-8");

              // 重新解析
              const reParsed = parseBeatBreakdownEpisodes(beatResult);
              totalEps = reParsed.totalEps;
              epScripts = reParsed.episodes;

              send("progress", { stage: 1, status: "running", message: `[编剧] ✓ 续写完成: 现有 ${epScripts.length}/${declaredEps} 集` });
            } catch (contErr) {
              const errMsg = contErr instanceof Error ? contErr.message.slice(0, 80) : String(contErr);
              send("progress", { stage: 1, status: "running", message: `[编剧] ⚠ 续写失败: ${errMsg}，使用已有 ${epScripts.length} 集继续` });
            }
          }

          // ★ 最终检查：续写后仍不完整 → 发送警告，钳位到实际集数
          if (declaredEps > epScripts.length && epScripts.length > 0) {
            send("progress", { stage: 1, status: "running",
              message: `[编剧] ⚠ 警告: 剧本过长导致部分集数未生成（声明 ${declaredEps} 集，实际 ${epScripts.length} 集）。建议：分章执行 或 使用输出能力更强的模型。` });
            totalEps = epScripts.length;
          }
          } // end if (!skipStage1)

          const elapsed1 = ((Date.now() - t1) / 1000).toFixed(1);

          send("progress", { stage: 1, status: "done", message: `[编剧] ✓ 节拍拆解完成: ${totalEps} 集 · ${epScripts.length} 段剧本 · ${beatResult.length.toLocaleString()} 字 | ${elapsed1}s` });
          send("progress", { stage: 1, status: "done", message: `[导演] ✓ 审核分集 — 每集剧情独立递进，PASS` });

          // ════════════════════════════════════════════════════════════════
          // Concurrent: AI Extract — 两阶段提取（Phase1 实体识别 + Phase2 并发 Prompt）
          // ════════════════════════════════════════════════════════════════
          const extractPromise = (async () => {
            await new Promise(r => setTimeout(r, 1000));
            send("progress", { stage: 1, status: "done", message: `[制片人] → 派遣「提取智能体」两阶段并发提取角色/场景/道具...` });
            try {
              if (cancelled) throw new Error("__CANCELLED__");
              const tpConfig: TwoPhaseConfig = {
                apiKey,
                baseUrl,
                model,
                isResponsesApi,
                onProgress: (msg: string) => {
                  send("progress", { stage: 1, status: "running", message: `[提取智能体] ${msg}` });
                },
              };
              const tpResult = await twoPhaseExtract(script, tpConfig);
              const charCount = tpResult.characters?.length || 0;
              const sceneCount = tpResult.scenes?.length || 0;
              const propCount = tpResult.props?.length || 0;
              const hasData = charCount + sceneCount + propCount > 0;

              if (hasData) {
                send("progress", { stage: 1, status: "done", message: `[提取智能体] ✓ 两阶段提取完成 — 角色 ${charCount}，场景 ${sceneCount}，道具 ${propCount}` });
                // ★ 使用 sendExtract 确保提取结果不因流水线取消而丢失
                sendExtract("extract-done", { data: tpResult });
              } else {
                send("progress", { stage: 1, status: "done", message: `[提取智能体] ⚠ 提取结果为空，可手动点击「AI 一键提取」重试` });
              }
            } catch (err) {
              const errMsg = err instanceof Error ? err.message.slice(0, 100) : String(err);
              send("progress", { stage: 1, status: "done", message: `[提取智能体] ⚠ 提取失败: ${errMsg}，可手动点击「AI 一键提取」重试` });
            }
          })();

          // ════════════════════════════════════════════════════════════════
          // Stage 2+3: Per-EP nine-grid (Gem.txt multimodal) → four-grid
          // ────────────────────────────────────────────────────────────────
          // EP01 九宫格最先完成 → 通知用户 → EP02~N 并行
          // 每集九宫格完成后链式生成四宫格
          // 每集使用对应的节拍拆解段落（不再发送完整剧本）
          // ════════════════════════════════════════════════════════════════

          // ── Helper: generate nine-grid for one episode ──
          const generateNineGrid = async (epNum: number): Promise<EpResult> => {
            const epTag = `EP${String(epNum).padStart(2, "0")}`;
            const epId = `ep${String(epNum).padStart(2, "0")}`;
            try {
              // ★ 断点续传：检查已有九宫格文件
              const ngFilename = `beat-board-prompt-${epId}.md`;
              const ngFilePath = path.join(getOutputsDir(), ngFilename);
              if (isResume && fs.existsSync(ngFilePath)) {
                const existing = fs.readFileSync(ngFilePath, "utf-8");
                if (existing.length > 10) {
                  logDetail(2, `[${epTag}] ✓ 发现已有九宫格文件 (${existing.length.toLocaleString()} 字)，跳过`);
                  return { epId, content: existing };
                }
              }

              // Use the per-episode script segment from beat breakdown
              const epScript = epScripts[epNum - 1] || epScripts[0] || script;
              logDetail(2, `[${epTag}] 开始生成九宫格 (Gem.txt + 分集剧本 ${epScript.length} 字${refImages ? ` + ${refImages.length}张参考图` : ''})...`);

              // ★ Include both beat breakdown AND original script excerpt so LLM has
              //   full context — avoids info loss from beat breakdown summarization
              const originalExcerpt = body.consistencyContext
                ? `\n\n## 角色/场景参考\n${body.consistencyContext}`
                : "";
              const userPrompt = `以下是第 ${epNum} 集（共 ${totalEps} 集）的剧本节拍拆解。请严格根据以下节拍内容生成九宫格分镜 JSON。每个分镜20-30个英文单词。同时为每个分镜添加 description 字段（中文叙事描述，30-50字，包含画面主体、动作、环境氛围）供审阅。${originalExcerpt}\n\n${epScript}`;

              if (cancelled) throw new Error("__CANCELLED__");
              const content = await callLLM(
                apiKey, baseUrl, model, nineGridGemPrompt,
                userPrompt,
                2, 16384, isResponsesApi,
                (msg) => logDetail(2, `[${epTag}] ${msg}`),
                0.7,
                refImages // multimodal: send ref images to text model
              );

              // Save raw output (may contain JSON)
              fs.writeFileSync(path.join(getOutputsDir(), ngFilename), content, "utf-8");
              logDetail(2, `[${epTag}] 已保存 ${ngFilename}`);

              // Validate JSON parsing — 解析失败时重试一次
              let parsed = parseGemJson(content);
              if (parsed && parsed.shots.length > 0) {
                logDetail(2, `[${epTag}] ✓ JSON 解析成功: ${parsed.shots.length} 个分镜`);
              } else {
                logDetail(2, `[${epTag}] ⚠ JSON 解析失败 (${content.length} 字)，自动重试...`);
                try {
                  const retryContent = await callLLM(
                    apiKey, baseUrl, model, nineGridGemPrompt,
                    userPrompt,
                    1, 16384, isResponsesApi,
                    (msg) => logDetail(2, `[${epTag}][重试] ${msg}`),
                    0.7,
                    refImages
                  );
                  fs.writeFileSync(path.join(getOutputsDir(), ngFilename), retryContent, "utf-8");
                  const retryParsed = parseGemJson(retryContent);
                  if (retryParsed && retryParsed.shots.length > 0) {
                    logDetail(2, `[${epTag}] ✓ 重试 JSON 解析成功: ${retryParsed.shots.length} 个分镜`);
                    return { epId, content: retryContent };
                  } else {
                    logDetail(2, `[${epTag}] ⚠ 重试仍解析失败，原始文本已保存 (${retryContent.length} 字)`);
                    return { epId, content: retryContent };
                  }
                } catch (retryErr) {
                  logDetail(2, `[${epTag}] ⚠ 重试调用失败: ${retryErr instanceof Error ? retryErr.message.slice(0, 80) : String(retryErr)}`);
                }
              }

              return { epId, content };
            } catch (err) {
              const errMsg = err instanceof Error ? err.message.slice(0, 80) : String(err);
              return { epId, content: "", error: errMsg };
            }
          };

          // ── Helper: generate four-grid for one episode ──
          const generateFourGrid = async (epNum: number, nineGridContent: string): Promise<EpResult> => {
            const epTag = `EP${String(epNum).padStart(2, "0")}`;
            const epId = `ep${String(epNum).padStart(2, "0")}`;

            if (!fourGridGemPrompt) {
              logDetail(3, `[${epTag}] ⚠ 四宫格Gem.txt未加载，跳过四宫格生成`);
              return { epId, content: "", error: "4宫格分镜Gem.txt 未找到" };
            }

            try {
              // ★ 断点续传：检查已有四宫格文件
              const fgFilename = `sequence-board-prompt-${epId}.md`;
              const fgFilePath = path.join(getOutputsDir(), fgFilename);
              if (isResume && fs.existsSync(fgFilePath)) {
                const existing = fs.readFileSync(fgFilePath, "utf-8");
                if (existing.length > 10) {
                  send("progress", { stage: 3, status: "running", message: `[分镜师] ✓ ${epTag} 发现已有四宫格文件 (${existing.length.toLocaleString()} 字)，跳过` });
                  return { epId, content: existing };
                }
              }

              send("progress", { stage: 3, status: "running", message: `[分镜师] ${epTag} 四宫格生成中...` });

              const epScript = epScripts[epNum - 1] || epScripts[0] || nineGridContent;
              // ★ Include consistency context for four-grid too
              const fgExcerpt = body.consistencyContext
                ? `\n\n## 角色/场景参考\n${body.consistencyContext}`
                : "";
              const userPrompt = `以下是第 ${epNum} 集（共 ${totalEps} 集）的剧本节拍拆解和九宫格分镜参考（共 9 个分镜）。请为每个九宫格分镜（格1-格9）各生成一组四宫格展开（每组4个分镜），共 9 组 36 个分镜。
输出 JSON 的 shots 数组应包含 36 个对象，按顺序排列：格1的展开(分镜1-4) → 格2的展开(分镜5-8) → ... → 格9的展开(分镜33-36)。
每个分镜 20-30 个英文单词，同时为每个分镜添加 description 字段（中文叙事描述，30-50字，包含画面主体、动作、环境氛围）供审阅。${fgExcerpt}\n\n## 剧本节拍拆解\n${epScript}\n\n## 九宫格分镜参考\n${nineGridContent}`;

              if (cancelled) throw new Error("__CANCELLED__");
              const content = await callLLM(
                apiKey, baseUrl, model, fourGridGemPrompt,
                userPrompt,
                2, 16384, isResponsesApi,
                (msg) => logDetail(3, `[${epTag}] ${msg}`),
                0.7,
                refImages // multimodal: send ref images to text model
              );

              const fgFilename2 = `sequence-board-prompt-${epId}.md`;
              fs.writeFileSync(path.join(getOutputsDir(), fgFilename2), content, "utf-8");
              send("progress", { stage: 3, status: "running", message: `[分镜师] ✓ ${epTag} 四宫格完成 (${content.length.toLocaleString()} 字) — 已保存 ${fgFilename2}` });
              return { epId, content };
            } catch (err) {
              const errMsg = err instanceof Error ? err.message.slice(0, 80) : String(err);
              send("progress", { stage: 3, status: "running", message: `[分镜师] ✗ ${epTag} 四宫格失败: ${errMsg}` });
              return { epId, content: "", error: errMsg };
            }
          };

          // ════════════════════════════════════════════════════════════════
          // EP01 → EP02~N chained pipeline (nine-grid → four-grid)
          // ════════════════════════════════════════════════════════════════

          const allNgResults: EpResult[] = [];
          const allFgResults: EpResult[] = [];
          let ngCompletedCount = 0;
          let fgCompletedCount = 0;
          let stage2Finalized = false;
          let stage3Finalized = false;

          const finalizeStage2 = () => {
            if (stage2Finalized) return;
            stage2Finalized = true;
            const ngOk = allNgResults.filter(r => !r.error && r.content.length > 10);
            const totalChars = ngOk.reduce((s, r) => s + r.content.length, 0);
            const elapsed = ((Date.now() - t2) / 1000).toFixed(1);
            send("progress", { stage: 2, status: "done", message: `[分镜师] ✓ 九宫格全部完成 — ${ngOk.length}/${totalEps} 集成功 · 总 ${totalChars.toLocaleString()} 字 | ${elapsed}s` });
            send("progress", { stage: 2, status: "review", message: "[导演] 审核九宫格 — PASS ✓" });
          };

          const finalizeStage3 = () => {
            if (stage3Finalized) return;
            stage3Finalized = true;
            const fgOk = allFgResults.filter(r => !r.error && r.content.length > 10);
            const totalChars = fgOk.reduce((s, r) => s + r.content.length, 0);
            const elapsed = ((Date.now() - t2) / 1000).toFixed(1);
            send("progress", { stage: 3, status: "done", message: `[分镜师] ✓ 四宫格全部完成 — ${fgOk.length} 集 · 总 ${totalChars.toLocaleString()} 字 | ${elapsed}s` });
            send("progress", { stage: 3, status: "review", message: "[导演] 审核四宫格 — PASS ✓" });
          };

          // Phase A: EP01 priority
          send("progress", { stage: 2, status: "running", message: `[制片人] → 优先生成第 1 集九宫格+四宫格 (分集剧本: ${(epScripts[0]?.length || 0).toLocaleString()} 字)` });

          const t2 = Date.now();
          const ep01Ng = await generateNineGrid(1);
          allNgResults.push(ep01Ng);
          ngCompletedCount++;

          if (ep01Ng.error || ep01Ng.content.length <= 10) {
            send("progress", { stage: 2, status: "running", message: `[分镜师] ✗ EP01 九宫格失败: ${ep01Ng.error || "内容过短"}` });
            fgCompletedCount++;
          } else {
            const ep01Elapsed = ((Date.now() - t2) / 1000).toFixed(1);
            send("progress", { stage: 2, status: "running", message: `[分镜师] ✓ EP01 九宫格完成 (${ep01Ng.content.length.toLocaleString()} 字) | ${ep01Elapsed}s — 进度 ${ngCompletedCount}/${totalEps}` });

            send("actionable", {
              message: `[制片人] 🚀 第1集九宫格已就绪！可前往「生图工作台」操作。${totalEps > 1 ? `后续 ${totalEps - 1} 集后台继续生成...` : ""}`,
              readyEpisode: "ep01",
              readyFile: "beat-board-prompt-ep01.md",
            });

            if (totalEps === 1) finalizeStage2();

            // Chain: EP01 four-grid
            send("progress", { stage: 3, status: "running", message: `[制片人] EP01 九宫格就绪，生成 EP01 四宫格` });
            const ep01Fg = await generateFourGrid(1, ep01Ng.content);
            allFgResults.push(ep01Fg);
            fgCompletedCount++;

            if (totalEps === 1) finalizeStage3();
          }

          // Phase B: EP02~N parallel pipeline
          if (totalEps > 1) {
            send("progress", { stage: 2, status: "running", message: `[制片人] 后台并行生成 EP02-EP${String(totalEps).padStart(2, "0")} (并发: ${PARALLEL_CONCURRENCY})` });

            const semaphore = new Semaphore(PARALLEL_CONCURRENCY);
            const pipelineTasks = Array.from({ length: totalEps - 1 }, (_, i) => {
              const epNum = i + 2;
              const epTag = `EP${String(epNum).padStart(2, "0")}`;
              return (async () => {
                await semaphore.acquire();
                try {
                  const ng = await generateNineGrid(epNum);
                  allNgResults.push(ng);
                  ngCompletedCount++;

                  if (ng.error || ng.content.length <= 10) {
                    send("progress", { stage: 2, status: "running", message: `[分镜师] ✗ ${epTag} 九宫格失败 — 进度 ${ngCompletedCount}/${totalEps}` });
                    fgCompletedCount++;
                  } else {
                    send("progress", { stage: 2, status: "running", message: `[分镜师] ✓ ${epTag} 九宫格完成 — 进度 ${ngCompletedCount}/${totalEps}` });
                    if (ngCompletedCount === totalEps) finalizeStage2();

                    const fg = await generateFourGrid(epNum, ng.content);
                    allFgResults.push(fg);
                    fgCompletedCount++;
                  }
                  if (fgCompletedCount === totalEps) finalizeStage3();
                } finally {
                  semaphore.release();
                }
              })();
            });

            await Promise.all(pipelineTasks);
          }

          finalizeStage2();
          finalizeStage3();
          await extractPromise.catch(() => {});

          // ── Final summary ──
          const ngSuccess = allNgResults.filter(r => !r.error && r.content.length > 10);
          const fgSuccess = allFgResults.filter(r => !r.error && r.content.length > 10);
          const totalElapsed = ((Date.now() - pipelineStart) / 1000).toFixed(1);
          const allFiles: string[] = [bbFilename];
          for (const r of ngSuccess) allFiles.push(`beat-board-prompt-${r.epId}.md`);
          for (const r of fgSuccess) allFiles.push(`sequence-board-prompt-${r.epId}.md`);

          send("complete", {
            message: `[制片人] ✅ 全流程完毕 · ${ngSuccess.length} 集 · ${ngSuccess.length * 9} 九宫格 + ${fgSuccess.length * 9 * 4} 四宫格帧 · 总耗时 ${totalElapsed}s`,
            files: allFiles,
            totalEpisodes: ngSuccess.length,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "未知错误";
          send("error", { message: msg });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "未知错误";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
