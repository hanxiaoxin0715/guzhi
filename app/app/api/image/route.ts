import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Standard browser-like headers to improve CDN compatibility
const COMMON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

interface ImageRequest {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  referenceImages?: string[];   // data URLs or HTTP URLs for image-to-image
  referenceLabels?: string[];   // per-image text labels (same length as referenceImages)
  imageSize?: string;           // "1K" | "2K" | "4K"
  aspectRatio?: string;         // e.g. "16:9", "1:1", "4:3"
  format?: "gemini" | "openai" | "openai-images" | "comfyui"; // API protocol format (default: "gemini")
}

// Import ComfyUI Client
import { ComfyUIClient } from "../../lib/comfyui/client";

/**
 * Handle image generation via ComfyUI API.
 */
async function handleComfyUIFormat(body: ImageRequest): Promise<Response> {
  const { baseUrl, model, prompt, referenceImages } = body;
  const clientId = "feicai-studio-" + Date.now();

  console.log(`[image API] ComfyUI format`);
  console.log(`[image API] URL: ${baseUrl}, model=${model}`);

  try {
    const client = new ComfyUIClient({ baseUrl: baseUrl || "http://127.0.0.1:8188", clientId });
    
    // Build Workflow
    // TODO: 目前仅支持基础文生图，未来可扩展支持参考图 (img2img)
    const workflow = client.buildTxt2ImgWorkflow(prompt, "", 1024, 1024, model);

    // Queue Prompt
    const promptId = await client.queuePrompt(workflow);
    console.log(`[image API] ComfyUI prompt queued: ${promptId}`);

    // Wait for Result
    const images = await client.waitForHistory(promptId);
    console.log(`[image API] ComfyUI finished: ${images.length} images`);

    return NextResponse.json({
      content: "",
      images,
      usage: null,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "ComfyUI Error";
    console.error(`[image API] ComfyUI exception: ${msg}`);
    return NextResponse.json({ error: `ComfyUI 生成失败: ${msg}` }, { status: 502 });
  }
}


/**
 * Extract base64 and mimeType from a data URL.
 * Returns null if not a valid data URL.
 */
function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const m = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

/**
 * Build the Gemini-format `contents` array.
 * Reference images → inlineData parts before text.
 * HTTP reference images → download and convert to base64 inlineData on the server side.
 * ★ When referenceLabels is provided, interleave text labels BEFORE each image
 *   so the model clearly associates Ref1/Ref2/... with the correct image.
 */
async function buildContents(
  prompt: string,
  referenceImages?: string[],
  referenceLabels?: string[]
): Promise<unknown[]> {
  const parts: unknown[] = [];

  if (referenceImages && referenceImages.length > 0) {
    for (let i = 0; i < Math.min(referenceImages.length, 14); i++) {
      const ref = referenceImages[i];
      const label = referenceLabels?.[i];
      // ★ Label is deferred until image is confirmed available
      // This prevents orphaned labels when HTTP image download fails
      if (ref.startsWith("data:")) {
        const parsed = parseDataUrl(ref);
        if (parsed) {
          if (label) parts.push({ text: label });
          parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
        } else {
          console.warn(`[buildContents] ⚠ 参考图${i + 1} data URL 解析失败，已跳过`);
        }
      } else if (ref.startsWith("http")) {
        // Download HTTP image and convert to base64 on the server
        try {
          const imgRes = await fetch(ref, { signal: AbortSignal.timeout(30000) });
          if (imgRes.ok) {
            const buf = await imgRes.arrayBuffer();
            const contentType = imgRes.headers.get("content-type") || "image/jpeg";
            const mimeType = contentType.split(";")[0].trim();
            const base64 = Buffer.from(buf).toString("base64");
            if (label) parts.push({ text: label });
            parts.push({ inlineData: { mimeType, data: base64 } });
          } else {
            console.warn(`[buildContents] ⚠ 参考图${i + 1} HTTP下载失败(${imgRes.status})，标签和图片均已跳过`);
          }
        } catch (e) {
          console.warn(`[buildContents] ⚠ 参考图${i + 1} HTTP下载异常，标签和图片均已跳过:`, e);
        }
      }
    }
  }

  parts.push({ text: prompt });

  return [{ role: "user", parts }];
}

// ═══════════════════════════════════════════════════════════
// Gemini SSE Stream Parser
// ═══════════════════════════════════════════════════════════

interface GeminiStreamResult {
  images: string[];
  textContent: string;
  usage: unknown;
}

/**
 * Parse Gemini streamGenerateContent SSE response.
 * Each SSE event contains a partial candidate with text or inlineData parts.
 * The streaming keeps the connection alive during long image generation,
 * preventing CDN/proxy gateway timeouts (504).
 */
async function parseGeminiSSEStream(res: Response): Promise<GeminiStreamResult> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body for streaming");

  const decoder = new TextDecoder();
  let buffer = "";
  const images: string[] = [];
  let textContent = "";
  let usage: unknown = null;

  function processJsonChunk(jsonStr: string) {
    try {
      const chunk = JSON.parse(jsonStr);
      const candidates = chunk.candidates;
      if (Array.isArray(candidates)) {
        for (const candidate of candidates) {
          const parts = candidate?.content?.parts;
          if (!Array.isArray(parts)) continue;
          for (const part of parts) {
            if (part.inlineData?.data) {
              const mime = part.inlineData.mimeType || "image/png";
              images.push(`data:${mime};base64,${part.inlineData.data}`);
            }
            if (part.text) {
              textContent += part.text;
            }
          }
        }
      }
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
    } catch { /* skip malformed chunks */ }
  }

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

      processJsonChunk(jsonStr);
    }
  }

  // Process any remaining data in buffer after stream ends
  if (buffer.trim()) {
    let jsonStr = buffer.trim();
    if (jsonStr.startsWith("data: ")) jsonStr = jsonStr.slice(6);
    else if (jsonStr.startsWith("data:")) jsonStr = jsonStr.slice(5);
    if (jsonStr !== "[DONE]") processJsonChunk(jsonStr);
  }

  return { images, textContent, usage };
}

/**
 * Extract images and text from a non-streaming Gemini JSON response.
 */
function parseGeminiJsonResponse(data: Record<string, unknown>): GeminiStreamResult {
  const images: string[] = [];
  let textContent = "";
  const candidates = data.candidates;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      const parts = (candidate as Record<string, unknown>)?.content as Record<string, unknown> | undefined;
      const partsList = parts?.parts;
      if (!Array.isArray(partsList)) continue;
      for (const part of partsList) {
        const p = part as Record<string, unknown>;
        const inlineData = p.inlineData as Record<string, string> | undefined;
        if (inlineData?.data) {
          const mime = inlineData.mimeType || "image/png";
          images.push(`data:${mime};base64,${inlineData.data}`);
        }
        if (typeof p.text === "string") {
          textContent += p.text;
        }
      }
    }
  }

  // Fallback: also check for OpenAI-style markdown URLs in text
  if (images.length === 0 && textContent) {
    const mdRegex = /!\[.*?\]\((https?:\/\/[^)]+)\)/g;
    let match;
    while ((match = mdRegex.exec(textContent)) !== null) {
      images.push(match[1]);
    }
    if (images.length === 0) {
      const urlRegex = /(https?:\/\/[^\s"'<>)]+\.(?:png|jpg|jpeg|webp|gif|bmp|svg)(?:\?[^\s"'<>)]*)?)/gi;
      while ((match = urlRegex.exec(textContent)) !== null) {
        images.push(match[1]);
      }
    }
  }

  return { images, textContent, usage: data.usageMetadata || null };
}

// ═══════════════════════════════════════════════════════════
// OpenAI-Compatible Format (for grok, GPT, etc.)
// ═══════════════════════════════════════════════════════════

/**
 * Build OpenAI-compatible messages array.
 * Reference images → image_url content parts before text.
 * ★ When referenceLabels is provided, interleave text labels BEFORE each image.
 */
async function buildOpenAIMessages(
  prompt: string,
  referenceImages?: string[],
  referenceLabels?: string[]
): Promise<unknown[]> {
  const contentParts: unknown[] = [];

  if (referenceImages && referenceImages.length > 0) {
    for (let i = 0; i < Math.min(referenceImages.length, 14); i++) {
      const ref = referenceImages[i];
      const label = referenceLabels?.[i];
      // ★ Label is deferred until image is confirmed available
      // This prevents orphaned labels when HTTP image download fails
      if (ref.startsWith("http")) {
        try {
          const imgRes = await fetch(ref, { signal: AbortSignal.timeout(30000) });
          if (imgRes.ok) {
            const buf = await imgRes.arrayBuffer();
            const contentType = imgRes.headers.get("content-type") || "image/jpeg";
            const mimeType = contentType.split(";")[0].trim();
            const base64 = Buffer.from(buf).toString("base64");
            if (label) contentParts.push({ type: "text", text: label });
            contentParts.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } });
          } else {
            console.warn(`[buildOpenAIMessages] ⚠ 参考图${i + 1} HTTP下载失败(${imgRes.status})，标签和图片均已跳过`);
            continue;
          }
        } catch (e) {
          console.warn(`[buildOpenAIMessages] ⚠ 参考图${i + 1} HTTP下载异常，标签和图片均已跳过:`, e);
          continue;
        }
      } else {
        // data: URL — always available locally
        if (label) contentParts.push({ type: "text", text: label });
        contentParts.push({ type: "image_url", image_url: { url: ref } });
      }
    }
  }

  contentParts.push({ type: "text", text: prompt });

  return [{ role: "user", content: contentParts }];
}

interface OpenAIImageResult {
  images: string[];
  textContent: string;
  usage: unknown;
}

/**
 * Parse OpenAI-compatible SSE stream for image generation.
 * Handles both text delta and multimodal content parts.
 */
async function parseOpenAISSEStream(res: Response): Promise<OpenAIImageResult> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body for streaming");

  const decoder = new TextDecoder();
  let buffer = "";
  const images: string[] = [];
  let textContent = "";
  let usage: unknown = null;

  function processJsonChunk(jsonStr: string) {
    try {
      const chunk = JSON.parse(jsonStr);
      // Collect usage from stream end
      if (chunk.usage) usage = chunk.usage;

      const choices = chunk.choices;
      if (!Array.isArray(choices)) return;

      for (const choice of choices) {
        const delta = choice.delta;
        if (!delta) continue;

        // Case 1: delta.content is a string (text-only stream)
        if (typeof delta.content === "string") {
          textContent += delta.content;
          continue;
        }

        // Case 2: delta.content is an array of content parts (multimodal stream)
        if (Array.isArray(delta.content)) {
          for (const part of delta.content) {
            if (part.type === "text" && part.text) {
              textContent += part.text;
            }
            if (part.type === "image_url" && part.image_url?.url) {
              images.push(part.image_url.url);
            }
          }
        }
      }
    } catch { /* skip malformed chunks */ }
  }

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

      processJsonChunk(jsonStr);
    }
  }

  if (buffer.trim()) {
    let jsonStr = buffer.trim();
    if (jsonStr.startsWith("data: ")) jsonStr = jsonStr.slice(6);
    else if (jsonStr.startsWith("data:")) jsonStr = jsonStr.slice(5);
    if (jsonStr !== "[DONE]") processJsonChunk(jsonStr);
  }

  return { images, textContent, usage };
}

/**
 * Parse a non-streaming OpenAI-compatible JSON response.
 * Handles both string content and multimodal content array.
 */
function parseOpenAIJsonResponse(data: Record<string, unknown>): OpenAIImageResult {
  const images: string[] = [];
  let textContent = "";

  const choices = data.choices;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      const msg = (choice as Record<string, unknown>).message as Record<string, unknown> | undefined;
      if (!msg) continue;

      // Case 1: content is a string
      if (typeof msg.content === "string") {
        textContent += msg.content;
      }

      // Case 2: content is a multimodal array
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          const p = part as Record<string, unknown>;
          if (p.type === "text" && typeof p.text === "string") {
            textContent += p.text;
          }
          if (p.type === "image_url") {
            const imgUrl = p.image_url as Record<string, string> | undefined;
            if (imgUrl?.url) images.push(imgUrl.url);
          }
        }
      }
    }
  }

  // Fallback: extract image URLs/base64 from text content
  if (images.length === 0 && textContent) {
    // Check for base64 data URL patterns
    const b64Regex = /(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/g;
    let match;
    while ((match = b64Regex.exec(textContent)) !== null) {
      images.push(match[1]);
    }
    // Check for markdown image URLs
    if (images.length === 0) {
      const mdRegex = /!\[.*?\]\((https?:\/\/[^)]+)\)/g;
      while ((match = mdRegex.exec(textContent)) !== null) {
        images.push(match[1]);
      }
    }
    // Check for plain image URLs
    if (images.length === 0) {
      const urlRegex = /(https?:\/\/[^\s"'<>)]+\.(?:png|jpg|jpeg|webp|gif|bmp|svg)(?:\?[^\s"'<>)]*)?)/gi;
      while ((match = urlRegex.exec(textContent)) !== null) {
        images.push(match[1]);
      }
    }
  }

  return { images, textContent, usage: data.usage || null };
}

/**
 * Handle image generation via OpenAI Images API (/v1/images/generations).
 * 适用于七牛云 kling / gemini-image 等专用图像生成接口。
 */
async function handleOpenAIImagesFormat(body: ImageRequest): Promise<Response> {
  const { apiKey, baseUrl, model, prompt, referenceImages, imageSize, aspectRatio } = body;

  let cleanBase = (baseUrl || "").replace(/\/+$/, "");
  cleanBase = cleanBase
    .replace(/\/v1\/images\/generations$/i, "")
    .replace(/\/v1\/chat\/completions$/i, "")
    .replace(/\/v1$/i, "");

  const url = `${cleanBase}/v1/images/generations`;

  const requestBody: Record<string, unknown> = { model, prompt };

  // ★ 参考图支持：将 data URL / HTTP URL 转为 base64 数组传入 image 字段
  if (referenceImages && referenceImages.length > 0) {
    const imageInputs: string[] = [];
    for (const ref of referenceImages.slice(0, 7)) {
      if (!ref || ref.length < 10) continue;
      const parsed = parseDataUrl(ref);
      if (parsed) {
        // data URL → 纯 base64
        imageInputs.push(parsed.data);
      } else if (ref.startsWith("http")) {
        // HTTP URL 直接传递
        imageInputs.push(ref);
      }
    }
    if (imageInputs.length > 0) {
      requestBody.image = imageInputs;
      console.log(`[image API] OpenAI Images: 附加 ${imageInputs.length} 张参考图`);
    }
  }

  // 添加图像配置（宽高比和分辨率）
  if (imageSize || aspectRatio) {
    const imageConfig: Record<string, string> = {};
    if (imageSize) imageConfig.image_size = imageSize;
    if (aspectRatio) imageConfig.aspect_ratio = aspectRatio;
    requestBody.image_config = imageConfig;
  }

  console.log(`[image API] OpenAI Images format (v1/images/generations)`);
  console.log(`[image API] URL: ${url}, model=${model}, imageSize=${imageSize || "default"}, aspectRatio=${aspectRatio || "default"}, refs=${referenceImages?.length || 0}`);

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          ...COMMON_HEADERS,
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(480000), // 8 min timeout
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error(`[image API] OpenAI Images error (attempt ${attempt + 1}/3): status=${res.status}, body=${errText.slice(0, 500)}`);

        let errorDetail = "";
        try {
          const errJson = JSON.parse(errText);
          errorDetail = errJson?.error?.message || errJson?.error || errJson?.message || "";
        } catch {
          errorDetail = errText.slice(0, 300);
        }

        if (res.status === 401 || res.status === 403) {
          return NextResponse.json(
            { error: `API Key 无效或已过期 (${res.status})。${errorDetail}`, statusCode: res.status, detail: errorDetail },
            { status: 502 }
          );
        }
        if (res.status === 429) {
          if (attempt < 2) {
            const delay = 5000 * (attempt + 1);
            console.log(`[image API] rate limited, retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          return NextResponse.json(
            { error: `图像 API 频率限制 (429)，请稍后重试。${errorDetail}`, statusCode: 429, detail: errorDetail },
            { status: 502 }
          );
        }
        lastError = `图像 API 错误 (${res.status}): ${errorDetail || errText.slice(0, 200)}`;
        if (res.status >= 500 && attempt < 2) {
          await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
          continue;
        }
        return NextResponse.json({ error: lastError, statusCode: res.status, detail: errorDetail }, { status: 502 });
      }

      const data = await res.json();
      console.log(`[image API] OpenAI Images response: ${JSON.stringify(data).slice(0, 300)}`);

      // 解析 /v1/images/generations 响应: { data: [{ b64_json / url }], output_format, usage }
      const images: string[] = [];
      const outputFormat = data.output_format || "png";
      const mimeType = /jpe?g/i.test(outputFormat) ? "image/jpeg" : "image/png";

      if (Array.isArray(data.data)) {
        for (const item of data.data) {
          if (item.b64_json) {
            images.push(`data:${mimeType};base64,${item.b64_json}`);
          } else if (item.url) {
            images.push(item.url);
          }
        }
      }

      console.log(`[image API] OpenAI Images result: ${images.length} image(s)`);

      if (images.length === 0 && attempt < 2) {
        lastError = "API 返回空内容";
        continue;
      }

      return NextResponse.json({
        content: "",
        images,
        usage: data.usage || null,
      });
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : "网络错误";
      console.error(`[image API] OpenAI Images attempt ${attempt + 1}/3 exception: ${lastError.slice(0, 200)}`);
      if (attempt < 2) continue;
    }
  }

  return NextResponse.json({ error: `图像生成失败（已重试3次）: ${lastError}` }, { status: 502 });
}

/**
 * Handle image generation via OpenAI-compatible /v1/chat/completions endpoint.
 */
async function handleOpenAIFormat(body: ImageRequest): Promise<Response> {
  const { apiKey, baseUrl, model, prompt, referenceImages, referenceLabels } = body;

  let cleanBase = (baseUrl || "").replace(/\/+$/, "");
  cleanBase = cleanBase
    .replace(/\/v1\/chat\/completions$/i, "")
    .replace(/\/v1\/images\/generations$/i, "")
    .replace(/\/v1$/i, "")
    .replace(/\/v1beta.*$/i, "");

  const chatUrl = `${cleanBase}/v1/chat/completions`;
  const messages = await buildOpenAIMessages(prompt, referenceImages, referenceLabels);

  const requestBody = {
    model,
    messages,
    stream: true,
    max_tokens: 16384,
  };

  const bodyStr = JSON.stringify(requestBody);
  const bodySizeMB = (bodyStr.length / 1024 / 1024).toFixed(2);
  console.log(`[image API] OpenAI-compatible format (streaming)`);
  console.log(`[image API] chat URL: ${chatUrl}`);
  console.log(`[image API] model=${model}, refs=${referenceImages?.length || 0}, bodySize=${bodySizeMB}MB`);

  if (bodyStr.length > 10 * 1024 * 1024) {
    console.warn(`[image API] ⚠ Request body is ${bodySizeMB}MB — upstream API may reject large payloads`);
  }

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    // attempt 0,1 = streaming; attempt 2 = non-streaming fallback
    const useStreaming = attempt < 2;
    const currentBody = useStreaming ? bodyStr : JSON.stringify({ ...requestBody, stream: false });
    const modeLabel = useStreaming ? "streaming" : "non-streaming";

    try {
      console.log(`[image API] OpenAI attempt ${attempt + 1}/3 (${modeLabel})`);

      const res = await fetch(chatUrl, {
        method: "POST",
        headers: {
          ...COMMON_HEADERS,
          Authorization: `Bearer ${apiKey}`,
        },
        body: currentBody,
        signal: AbortSignal.timeout(480000), // 8 min timeout
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error(`[image API] OpenAI upstream error (attempt ${attempt + 1}/3 ${modeLabel}): status=${res.status}, body=${errText.slice(0, 500)}`);

        let errorDetail = "";
        const isHtmlError = /<!DOCTYPE|<html/i.test(errText);
        try {
          const errJson = JSON.parse(errText);
          errorDetail = errJson?.error?.message || errJson?.error || errJson?.message || "";
        } catch {
          errorDetail = isHtmlError ? "" : errText.slice(0, 300);
        }

        if (isHtmlError && res.status >= 500) {
          if (useStreaming) {
            lastError = `图像 API 网关超时 (${res.status} ${modeLabel})`;
            attempt = 1;
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          return NextResponse.json(
            { error: `图像 API 网关错误 (${res.status})，API代理服务的CDN暂时不可用。\n\n如果您没有VPN，建议联系管理员获取可用的国内图像API配置。`, statusCode: res.status, detail: "gateway timeout" },
            { status: 502 }
          );
        }

        lastError = `图像 API 错误 (${res.status}): ${errorDetail || errText.slice(0, 200)}`;

        if (res.status === 401 || res.status === 403) {
          return NextResponse.json(
            { error: `API Key 无效或已过期 (${res.status})。${errorDetail}`, statusCode: res.status, detail: errorDetail },
            { status: 502 }
          );
        }
        if (res.status === 404) {
          return NextResponse.json(
            { error: `模型或接口不存在 (404)，请检查模型名称 "${model}" 和 Base URL。${errorDetail}`, statusCode: res.status, detail: errorDetail },
            { status: 502 }
          );
        }
        if (res.status === 429) {
          if (attempt < 2) {
            const delay = 10000 * (attempt + 1);
            console.log(`[image API] rate limited, retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          return NextResponse.json(
            { error: "图像 API 频率限制或额度不足 (429)，请稍后重试。" + errorDetail, statusCode: 429, detail: errorDetail },
            { status: 502 }
          );
        }

        if ((res.status >= 500 || res.status === 429) && attempt < 2) {
          const delay = 3000 * (attempt + 1);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        return NextResponse.json(
          { error: lastError, statusCode: res.status, detail: errorDetail },
          { status: 502 }
        );
      }

      // ── Success — parse response ──
      let result: OpenAIImageResult;

      if (useStreaming) {
        console.log(`[image API] OpenAI streaming response OK, parsing SSE chunks...`);
        result = await parseOpenAISSEStream(res);
      } else {
        console.log(`[image API] OpenAI non-streaming response OK, parsing JSON...`);
        const data = await res.json();
        result = parseOpenAIJsonResponse(data);
      }

      console.log(`[image API] OpenAI ${modeLabel} result: ${result.images.length} image(s), text: ${result.textContent.length} chars`);

      if (result.images.length === 0 && result.textContent.length === 0) {
        lastError = "API 返回空内容";
        if (attempt < 2) {
          console.warn(`[image API] OpenAI empty response in ${modeLabel} mode, will retry...`);
          continue;
        }
      }

      return NextResponse.json({
        content: result.textContent,
        images: result.images,
        usage: result.usage,
      });
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : "网络错误";
      console.error(`[image API] OpenAI ${modeLabel} attempt ${attempt + 1}/3 exception: ${lastError.slice(0, 200)}`);
      if (attempt < 2) continue;
    }
  }

  return NextResponse.json({ error: `图像生成失败（已重试3次）: ${lastError}` }, { status: 502 });
}

export async function POST(request: Request) {
  try {
    const body: ImageRequest = await request.json();
    const { apiKey, baseUrl, model, prompt, referenceImages, referenceLabels, imageSize, aspectRatio, format } = body;

    if (!apiKey || !model || !prompt) {
    if (format === "comfyui") {
      if (!prompt) {
         return NextResponse.json({ error: "缺少 prompt" }, { status: 400 });
      }
    } else {
      return NextResponse.json(
        { error: "缺少必要参数: apiKey, model, prompt" },
        { status: 400 }
      );
    }
  }

    if (!baseUrl) {
      return NextResponse.json(
        { error: "缺少图像 API 地址 (baseUrl)，请在设置页配置" },
        { status: 400 }
      );
    }

    // ── Route to OpenAI-compatible handlers ──
    if (format === "openai-images") {
      return handleOpenAIImagesFormat(body);
    }
    if (format === "openai") {
    return handleOpenAIFormat(body);
  }
  if (format === "comfyui") {
    return handleComfyUIFormat(body);
  }

  // ═══ Gemini native format (default) ═══
    let cleanBase = baseUrl.replace(/\/+$/, "");
    cleanBase = cleanBase
      .replace(/\/v1\/chat\/completions$/i, "")
      .replace(/\/v1\/images\/generations$/i, "")
      .replace(/\/v1$/i, "")
      .replace(/\/v1beta.*$/i, "");

    // Two endpoints: streaming (prevents gateway timeout) and non-streaming (fallback)
    const streamUrl = `${cleanBase}/v1beta/models/${model}:streamGenerateContent?alt=sse`;
    const nonStreamUrl = `${cleanBase}/v1beta/models/${model}:generateContent`;

    const contents = await buildContents(prompt, referenceImages, referenceLabels);

    // Build generationConfig with imageConfig
    const imageConfig: Record<string, string> = {};
    if (imageSize) imageConfig.imageSize = imageSize;
    if (aspectRatio) imageConfig.aspectRatio = aspectRatio;

    const requestBody = {
      contents,
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
      },
    };

    // Log body size for diagnostics
    const bodySize = JSON.stringify(requestBody).length;
    const bodySizeMB = (bodySize / 1024 / 1024).toFixed(2);
    console.log(`[image API] Gemini native format (streaming-first)`);
    console.log(`[image API] baseUrl input: ${baseUrl}`);
    console.log(`[image API] stream URL: ${streamUrl}`);
    console.log(`[image API] model=${model}, imageSize=${imageSize || "default"}, aspectRatio=${aspectRatio || "default"}, refs=${referenceImages?.length || 0}, bodySize=${bodySizeMB}MB`);

    // Warn if body is very large (>10MB), upstream may reject
    if (bodySize > 10 * 1024 * 1024) {
      console.warn(`[image API] ⚠ Request body is ${bodySizeMB}MB — upstream API may reject large payloads`);
    }

    const bodyStr = JSON.stringify(requestBody);

    // ── Retry loop: attempt 0,1 = streaming; attempt 2 = non-streaming fallback ──
    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const useStreaming = attempt < 2;
      const targetUrl = useStreaming ? streamUrl : nonStreamUrl;
      const modeLabel = useStreaming ? "streaming" : "non-streaming";

      try {
        console.log(`[image API] attempt ${attempt + 1}/3 (${modeLabel}) → ${targetUrl.split("/models/")[1] || targetUrl}`);

        const res = await fetch(targetUrl, {
          method: "POST",
          headers: {
            ...COMMON_HEADERS,
            Authorization: `Bearer ${apiKey}`,
          },
          body: bodyStr,
          signal: AbortSignal.timeout(480000), // 8 min timeout
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          console.error(`[image API] upstream error (attempt ${attempt + 1}/3 ${modeLabel}): status=${res.status}, body=${errText.slice(0, 500)}`);

          // Parse error detail from response
          let errorDetail = "";
          const isHtmlError = /<!DOCTYPE|<html/i.test(errText);
          try {
            const errJson = JSON.parse(errText);
            errorDetail = errJson?.error?.message || errJson?.error || errJson?.message || "";
          } catch {
            errorDetail = isHtmlError ? "" : errText.slice(0, 300);
          }

          // ── Gateway timeout (HTML 504/502) ──
          if (isHtmlError && res.status >= 500) {
            if (useStreaming) {
              // Streaming also got gateway timeout — skip to non-streaming fallback immediately
              lastError = `图像 API 网关超时 (${res.status} ${modeLabel})`;
              console.warn(`[image API] gateway timeout in ${modeLabel} mode, skipping to non-streaming fallback...`);
              attempt = 1; // next iteration will be attempt=2 (non-streaming)
              await new Promise(r => setTimeout(r, 2000));
              continue;
            }
            // Non-streaming fallback also timed out — give up
            lastError = `图像 API 网关错误 (${res.status})，API代理服务的CDN暂时不可用。\n\n如果您没有VPN，建议联系管理员获取可用的国内图像API配置。`;
            console.warn(`[image API] gateway timeout (${modeLabel} fallback), giving up`);
            return NextResponse.json(
              { error: lastError, statusCode: res.status, detail: "gateway timeout" },
              { status: 502 }
            );
          }

          lastError = `图像 API 错误 (${res.status}): ${errorDetail || errText.slice(0, 200)}`;

          // ── Channel not found (503) — streaming endpoint not supported for this model ──
          if (res.status === 503 && /channel not found/i.test(errText) && useStreaming) {
            console.warn(`[image API] streaming channel not found for model, skipping to non-streaming fallback...`);
            attempt = 1; // next iteration will be attempt=2 (non-streaming)
            continue;
          }

          if (res.status === 401 || res.status === 403) {
            return NextResponse.json(
              { error: `API Key 无效或已过期 (${res.status})。${errorDetail}`, statusCode: res.status, detail: errorDetail },
              { status: 502 }
            );
          }

          if (res.status === 404) {
            if (useStreaming && attempt === 0) {
              // streamGenerateContent endpoint might not be supported — fall through to retry
              console.warn(`[image API] streaming endpoint returned 404, will try again...`);
              continue;
            }
            return NextResponse.json(
              { error: `模型或接口不存在 (404)，请检查模型名称 "${model}" 和 Base URL 配置。${errorDetail}`, statusCode: res.status, detail: errorDetail },
              { status: 502 }
            );
          }

          if (res.status === 429) {
            const retryMatch = errText.match(/retry\s+in\s+([\d.]+)s/i);
            const retryDelay = retryMatch ? Math.min(Math.ceil(parseFloat(retryMatch[1])) * 1000, 40000) : 0;

            if (retryDelay > 0 && attempt < 2) {
              console.log(`[image API] rate limited, retrying in ${retryDelay}ms (attempt ${attempt + 1}/3)...`);
              await new Promise((r) => setTimeout(r, retryDelay));
              continue;
            }

            return NextResponse.json(
              { error: "图像 API 频率限制或额度不足 (429)，请稍后重试。" + errorDetail, statusCode: 429, detail: errorDetail },
              { status: 502 }
            );
          }

          if (res.status === 413 || (/too large|payload/i.test(errText) && !/<!DOCTYPE/i.test(errText))) {
            return NextResponse.json(
              { error: `请求体过大 (${bodySizeMB}MB)，请减少参考图数量或降低图片质量。${errorDetail}`, statusCode: res.status, detail: errorDetail },
              { status: 502 }
            );
          }

          if ((res.status >= 500 || res.status === 429) && attempt < 2) {
            const delay = res.status === 429 ? 10000 * (attempt + 1) : 3000 * (attempt + 1);
            console.log(`[image API] retrying in ${delay}ms (attempt ${attempt + 1}/3)...`);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          return NextResponse.json(
            { error: lastError, statusCode: res.status, detail: errorDetail },
            { status: 502 }
          );
        }

        // ── Success — parse response based on mode ──
        let result: GeminiStreamResult;

        if (useStreaming) {
          console.log(`[image API] streaming response OK, parsing SSE chunks...`);
          result = await parseGeminiSSEStream(res);
        } else {
          console.log(`[image API] non-streaming response OK, parsing JSON...`);
          const data = await res.json();
          result = parseGeminiJsonResponse(data);
        }

        console.log(`[image API] ${modeLabel} result: ${result.images.length} image(s), text: ${result.textContent.length} chars`);

        if (result.images.length === 0 && result.textContent.length === 0) {
          lastError = "API 返回空内容";
          if (attempt < 2) {
            console.warn(`[image API] empty response in ${modeLabel} mode, will retry...`);
            continue;
          }
        }

        return NextResponse.json({
          content: result.textContent,
          images: result.images,
          usage: result.usage,
        });
      } catch (e: unknown) {
        lastError = e instanceof Error ? e.message : "网络错误";
        console.error(`[image API] ${modeLabel} attempt ${attempt + 1}/3 exception: ${lastError.slice(0, 200)}`);
        if (attempt < 2) continue;
      }
    }

    return NextResponse.json({ error: `图像生成失败（已重试3次）: ${lastError}` }, { status: 502 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ error: `图像请求错误: ${msg}` }, { status: 500 });
  }
}
