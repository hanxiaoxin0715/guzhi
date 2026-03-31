import { NextResponse } from "next/server";
import { ProxyAgent } from "undici";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // allow up to 2 min for long LLM calls

// ── 代理支持（用于访问被墙的 API，如 Google） ──
// 读取环境变量: HTTPS_PROXY / HTTP_PROXY / ALL_PROXY（不区分大小写）
function getProxyUrl(): string | null {
  return process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy
    || process.env.ALL_PROXY || process.env.all_proxy
    || null;
}

let _cachedProxy: ProxyAgent | null | false = false; // false = not checked yet
function getProxyDispatcher(): ProxyAgent | null {
  if (_cachedProxy !== false) return _cachedProxy;
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) { _cachedProxy = null; return null; }
  try {
    _cachedProxy = new ProxyAgent(proxyUrl);
    console.log(`[LLM API] 检测到代理环境变量，将用于外网请求: ${proxyUrl}`);
  } catch {
    _cachedProxy = null;
  }
  return _cachedProxy;
}

/** 代理感知的 fetch：如果有代理配置则自动使用 */
async function proxyFetch(url: string, init: RequestInit): Promise<Response> {
  const dispatcher = getProxyDispatcher();
  if (dispatcher) {
    return fetch(url, { ...init, dispatcher } as RequestInit);
  }
  return fetch(url, init);
}

// Standard browser-like headers to improve CDN compatibility
// Some CDNs (e.g. cnmcdn.com) reject or 502 requests without proper User-Agent
const COMMON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

interface LLMRequest {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  images?: string[];  // Optional image URLs or data URIs for multimodal (vision) requests
  provider?: string;  // "openAi" | "dashscope" | "dashscope-responses"
}

/**
 * Detect if the provider uses DashScope Responses API.
 * Falls back to URL pattern detection if provider not specified.
 */
function isResponsesApi(provider?: string, baseUrl?: string): boolean {
  if (provider === "dashscope-responses") return true;
  if (baseUrl && baseUrl.includes("/api/v2/apps/protocols")) return true;
  return false;
}

export async function POST(request: Request) {
  try {
    const body: LLMRequest = await request.json();
    const { model, prompt, systemPrompt, maxTokens, images, provider } = body;
    // 兜底 API 地址：用户未配置时使用默认中转
    const baseUrl = (body.baseUrl && body.baseUrl.trim()) ? body.baseUrl.trim() : "https://api.geeknow.top/v1";
    // 清理 API Key：去除首尾空白和不可见字符（防止粘贴时带入换行/空格导致 401）
    const apiKey = (body.apiKey || "").trim();

    if (!apiKey || !model || !prompt) {
      return NextResponse.json({ error: "缺少必要参数: apiKey, model, prompt" }, { status: 400 });
    }

    const useResponsesApi = isResponsesApi(provider, baseUrl);

    // Build the endpoint URL
    let url = baseUrl;
    if (useResponsesApi) {
      url = url.replace(/\/+$/, "");
      if (!url.endsWith("/responses")) url += "/responses";
    } else {
      if (!url.includes("/chat/completions")) {
        url = url.replace(/\/+$/, "");
        // Google Gemini 官方直连需要 /v1beta/openai 前缀
        // 只有当 URL 是 Google 官方地址时才使用特殊路径，否则（如第三方中转）一律按 OpenAI 格式处理
        const isGoogleHost = /generativelanguage\.googleapis\.com/i.test(url);
        if (isGoogleHost && !url.includes("/v1beta")) {
          url += "/v1beta/openai/chat/completions";
        } else {
          url += "/chat/completions";
        }
      }
    }

    if (useResponsesApi) {
      // ── DashScope Responses API format ──
      // Note: Responses API doesn't support multimodal images in input
      const input = [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        { role: "user", content: prompt },
      ];

      const res = await proxyFetch(url, {
        method: "POST",
        headers: {
          ...COMMON_HEADERS,
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(180000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        return NextResponse.json(
          { error: `LLM API 错误 (${res.status}): ${errText.slice(0, 500)}` },
          { status: res.status }
        );
      }

      const data = await res.json();
      // Parse Responses API output: output[].content[].text
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
      return NextResponse.json({
        content: content || data.output_text || "",
        usage: data.usage,
      });
    }

    // ── Standard OpenAI Chat Completions format ──
    // Build messages — support multimodal if images are provided
    const messages: { role: string; content: string | Array<Record<string, unknown>> }[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    // Detect Gemini model — may need special image handling
    const isGeminiModel = /gemini/i.test(model);

    if (images && images.length > 0) {
      // Multimodal: send images + text as content array
      const contentParts: Array<Record<string, unknown>> = [];

      for (const imgUrl of images.slice(0, 14)) {
        // Parse data URI: data:image/jpeg;base64,/9j/4AAQ...
        const dataUriMatch = imgUrl.match(/^data:([^;]+);base64,(.+)$/);

        if (isGeminiModel && dataUriMatch) {
          // Gemini native inline_data format — many Gemini proxies handle this better
          // than the OpenAI image_url format with data URIs
          contentParts.push({
            type: "image_url",
            image_url: {
              url: imgUrl,
            },
          });
          // Also try adding Gemini-native format as fallback in a separate field
          // Some proxies auto-detect and use whichever format they support
        } else {
          contentParts.push({ type: "image_url", image_url: { url: imgUrl } });
        }
      }

      contentParts.push({ type: "text", text: prompt });
      messages.push({ role: "user", content: contentParts });
    } else {
      messages.push({ role: "user", content: prompt });
    }

    // Build the request body
    // Ensure sufficient output tokens — multimodal requests need more headroom
    const effectiveMaxTokens = Math.max(maxTokens || 4096, images && images.length > 0 ? 4096 : 2048);
    const reqBody: Record<string, unknown> = {
      model,
      messages,
      max_tokens: effectiveMaxTokens,
      temperature: 0.7,
    };

    const bodyStr = JSON.stringify(reqBody);
    console.log(`[LLM API] Sending to ${url} | model=${model} | images=${images?.length || 0} | bodySize=${Math.round(bodyStr.length / 1024)}KB`);
    if (images && images.length > 0) {
      console.log(`[LLM API] Image details: ${images.map((img, i) => `img${i}=${img.startsWith("data:") ? "base64" : "url"}(${Math.round(img.length / 1024)}KB)`).join(", ")}`);
    }

    // Retry logic for transient CDN/gateway errors (502, 503, 504)
    let res: Response | null = null;
    let lastErrText = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await proxyFetch(url, {
          method: "POST",
          headers: {
            ...COMMON_HEADERS,
            Authorization: `Bearer ${apiKey}`,
          },
          body: bodyStr,
          signal: AbortSignal.timeout(180000), // 3 minutes timeout
        });

        if (res.ok) break; // success

        lastErrText = await res.text().catch(() => "");
        const isHtmlError = /<!DOCTYPE|<html/i.test(lastErrText);
        const isRetryable = res.status >= 500 && res.status <= 504;

        if (isRetryable && attempt < 2) {
          const delay = 3000 * (attempt + 1);
          console.log(`[LLM API] Got ${res.status}${isHtmlError ? " (CDN error page)" : ""}, retrying in ${delay}ms (attempt ${attempt + 1}/3)`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // Non-retryable error or final attempt — return error
        if (isHtmlError) {
          const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
          return NextResponse.json(
            { error: `LLM API 返回了 HTML 页面而非 JSON (${res.status})。\n\n可能原因：\n1. API 地址填写错误（指向了网页而非API端点）\n2. API 服务需要认证/跳转\n3. CDN 网关错误（${host}）\n\n请检查【设置】页面的 API 地址是否正确。` },
            { status: 502 }
          );
        }
        // 火山引擎 401 专项提示
        if (res.status === 401 && /volces\.com|volcengine\.com/i.test(url)) {
          return NextResponse.json(
            { error: `火山引擎 API 认证失败 (401)。\n\n请确认：\n1. API Key 来自「火山方舟控制台 → API Key 管理」（非 IAM 密钥）\n   → https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey\n2. 模型填写接入点 ID（如 ep-2024xxxx）或直接填模型名\n3. API Key 是否已过期或失效` },
            { status: 401 }
          );
        }
        // Gemini 安全过滤专项提示（PROHIBITED_CONTENT / SAFETY / RECITATION 等）
        if (res.status === 400 && /PROHIBITED_CONT|SAFETY|blocked/i.test(lastErrText)) {
          return NextResponse.json(
            { error: `Gemini 安全过滤拦截：输入内容触发了 Google 的内容安全策略。\n\n解决方案：\n1. 修改角色描述，减少暴力/血腥/敏感词汇（如"血迹""伤痕"等）\n2. 在【设置】页切换为国内中转 API（GeeKnow / USSN），中转通常不受此限制\n3. 或换用其他模型（如 DeepSeek、Qwen）` },
            { status: 400 }
          );
        }
        return NextResponse.json(
          { error: `LLM API 错误 (${res.status}): ${lastErrText.slice(0, 500)}` },
          { status: res.status }
        );
      } catch (fetchErr) {
        if (attempt < 2) {
          console.log(`[LLM API] fetch error (attempt ${attempt + 1}/3): ${fetchErr instanceof Error ? fetchErr.message : fetchErr}`);
          await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
          continue;
        }
        // Google API 连接失败专项提示
        const isGoogleApi = /googleapis\.com/i.test(url);
        if (isGoogleApi) {
          const proxyHint = getProxyUrl()
            ? `已检测到代理 ${getProxyUrl()} 但仍无法连接，请检查代理是否正常工作。`
            : `Node.js 不会自动使用系统代理。\n解决方案：\n1. VPN 开启 TUN/全局模式（而非仅系统代理）\n2. 或设置环境变量: set HTTPS_PROXY=http://127.0.0.1:7890 然后重启\n3. 或在设置页切换为国内中转 API（GeeKnow / USSN）`;
          throw new Error(`无法连接 Google API 服务器 (generativelanguage.googleapis.com)。\n\n${proxyHint}`);
        }
        throw fetchErr;
      }
    }

    if (!res || !res.ok) {
      return NextResponse.json(
        { error: `LLM API 错误: 重试3次后仍然失败。${lastErrText.slice(0, 200)}` },
        { status: 502 }
      );
    }

    // 检查 Content-Type 防止 HTML 响应被当作 JSON 解析
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/html")) {
      const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
      return NextResponse.json(
        { error: `LLM API 返回了 HTML 页面而非 JSON（${host}）。\n\n请检查 API 地址是否正确，应指向 API 端点而非网页。` },
        { status: 502 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let data: any;
    try {
      data = await res.json();
    } catch {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `LLM API 返回了无效的 JSON 响应。\n\n响应内容前200字符: ${text.slice(0, 200)}` },
        { status: 502 }
      );
    }
    const finishReason = data.choices?.[0]?.finish_reason || data.candidates?.[0]?.finishReason || "";
    console.log("[LLM API] Raw response:", JSON.stringify(data).slice(0, 1000));
    console.log(`[LLM API] finish_reason=${finishReason}`);

    // Robust content extraction: handle various provider formats
    let content = "";

    // 1. OpenAI standard: choices[0].message.content
    const rawContent = data.choices?.[0]?.message?.content;
    if (typeof rawContent === "string") {
      content = rawContent;
    } else if (Array.isArray(rawContent)) {
      // Some models return content as [{type:"text", text:"..."}]
      content = rawContent.map((c: Record<string, unknown>) => (c.text || c.content || "") as string).join("");
    }

    // 2. Gemini native format: candidates[0].content.parts[0].text
    if (!content && data.candidates) {
      try {
        const parts = data.candidates[0]?.content?.parts;
        if (Array.isArray(parts)) {
          content = parts.map((p: Record<string, unknown>) => (p.text || "") as string).join("");
        }
      } catch { /* ignore malformed candidates */ }
    }

    // 3. Chinese LLM providers: data.result
    if (!content && data.result) {
      content = typeof data.result === "string" ? data.result : JSON.stringify(data.result);
    }

    // 4. DashScope-like format: output.text
    if (!content && data.output?.text) {
      content = data.output.text;
    }

    // 5. Direct content field
    if (!content && typeof data.content === "string") {
      content = data.content;
    }

    // 6. Other common formats
    if (!content && typeof data.text === "string") {
      content = data.text;
    }
    if (!content && typeof data.response === "string") {
      content = data.response;
    }
    if (!content && typeof data.message === "string" && data.message.length > 20) {
      // Some providers put content in "message" — but only if it looks like real content, not an error
      content = data.message;
    }

    // 7. Choices with delta (streaming-compatible endpoints)
    if (!content && data.choices?.[0]?.delta?.content) {
      const dc = data.choices[0].delta.content;
      content = typeof dc === "string" ? dc : "";
    }

    // 8. Check for refusal (OpenAI safety filter)
    if (!content && data.choices?.[0]?.message?.refusal) {
      const refusal = data.choices[0].message.refusal;
      console.log("[LLM API] Model refused:", refusal);
      content = ""; // Keep empty — will trigger error on frontend
    }

    // 9. Deep fallback: search for natural-language text in the JSON
    // Must contain spaces/CJK chars to look like real content, not IDs or keys
    if (!content) {
      const jsonStr = JSON.stringify(data);
      const allStrings = jsonStr.match(/"([^"]{30,})"/g);
      if (allStrings) {
        const looksLikeContent = (s: string) =>
          !s.startsWith("http") && !s.includes(":\\/\\/") && !s.startsWith("{")
          && !s.match(/^(chatcmpl|cmpl|run|thread|msg|asst|file|org|sk)-/i)
          && (s.includes(" ") || /[\u4e00-\u9fff]/.test(s)); // Must contain spaces or CJK
        const candidates = allStrings
          .map(s => s.slice(1, -1))
          .filter(looksLikeContent);
        if (candidates.length > 0) {
          content = candidates.sort((a, b) => b.length - a.length)[0];
          console.log("[LLM API] Content extracted via deep fallback:", content.slice(0, 100));
        }
      }
    }

    console.log(`[LLM API] Extracted content (${content.length} chars):`, content.slice(0, 200) || "<EMPTY>");

    // ── Vision fallback: if content is empty and we sent images, retry text-only ──
    if (!content && images && images.length > 0) {
      console.log("[LLM API] Vision request returned empty. Retrying text-only as fallback...");
      const textOnlyMessages: { role: string; content: string }[] = [];
      if (systemPrompt) textOnlyMessages.push({ role: "system", content: systemPrompt });
      textOnlyMessages.push({ role: "user", content: prompt });

      try {
        const retryRes = await proxyFetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: textOnlyMessages,
            max_tokens: Math.max(maxTokens || 4096, 4096),
            temperature: 0.7,
          }),
          signal: AbortSignal.timeout(120000),
        });

        if (retryRes.ok) {
          const retryData = await retryRes.json();
          console.log("[LLM API] Text-only fallback response:", JSON.stringify(retryData).slice(0, 500));
          const retryContent = retryData.choices?.[0]?.message?.content
            || retryData.candidates?.[0]?.content?.parts?.map((p: Record<string, unknown>) => p.text || "").join("")
            || retryData.result || retryData.output?.text || retryData.content || retryData.text || "";
          if (retryContent && typeof retryContent === "string" && retryContent.length > 5) {
            console.log(`[LLM API] Text-only fallback succeeded (${retryContent.length} chars)`);
            return NextResponse.json({
              content: retryContent,
              visionFallback: true,
              usage: retryData.usage,
            });
          }
        }
      } catch (retryErr) {
        console.log("[LLM API] Text-only fallback failed:", retryErr instanceof Error ? retryErr.message : retryErr);
      }
    }

    return NextResponse.json({
      content,
      rawResponse: !content ? data : undefined,
      finishReason: !content ? finishReason : undefined,
      usage: data.usage,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
