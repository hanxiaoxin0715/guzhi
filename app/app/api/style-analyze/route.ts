import { NextResponse } from "next/server";
import { STYLE_ANALYZE_PROMPT } from "@/app/lib/defaultPrompts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/style-analyze
 * Accepts an image URL and uses the LLM (vision) to identify the visual style
 * and output a style prompt that can drive consistent image generation.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { imageUrl, settings, customPrompt } = body;

    let apiKey = settings?.["llm-key"] || "";
    let baseUrl = settings?.["llm-url"] || "https://api.geeknow.top/v1";
    let model = settings?.["llm-model"] || "gemini-2.5-pro";

    // style-analyze requires VISION capability (image input)
    // If current LLM is text-only (dashscope-responses / qwen3-max), fall back to a vision-capable model
    const provider = settings?.["llm-provider"] || "";
    if (provider === "dashscope-responses") {
      // Try saved GeeKnow Gemini key first (per-preset key system)
      const geeknowKey = settings?.["llm-key--geeknow-gemini"];
      if (geeknowKey) {
        console.log(`[style-analyze] current LLM is text-only (${model}), falling back to GeeKnow Gemini for vision`);
        apiKey = geeknowKey;
        baseUrl = "https://api.geeknow.top/v1";
        model = "gemini-2.5-pro";
      } else {
        return NextResponse.json(
          { error: "当前文本模型 (qwen3-max) 不支持图像识别。请先在「设置」页配置 GeeKnow Gemini 的 API Key，然后再切换回来即可。" },
          { status: 400 }
        );
      }
    }

    if (!apiKey) {
      return NextResponse.json({ error: "未配置 LLM API Key" }, { status: 400 });
    }
    if (!imageUrl) {
      return NextResponse.json({ error: "请提供图片URL" }, { status: 400 });
    }

    let url = baseUrl;
    if (!url.includes("/chat/completions")) {
      url = url.replace(/\/+$/, "") + "/chat/completions";
    }

    const systemPrompt = customPrompt || STYLE_ANALYZE_PROMPT;

    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageUrl } },
          { type: "text", text: "请分析这张图片的视觉风格，返回JSON格式结果。" },
        ],
      },
    ];

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 4096,
        temperature: 0.3,
        stream: true,
      }),
      signal: AbortSignal.timeout(90000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `API 错误 (${res.status}): ${errText.slice(0, 300)}` },
        { status: 502 }
      );
    }

    // Collect streaming response
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let content = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") { buffer = ""; break; }
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) content += delta;
        } catch {
          /* skip */
        }
      }
    }
    // Process any remaining data in buffer after stream ends
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data: ")) {
        const payload = trimmed.slice(6);
        if (payload !== "[DONE]") {
          try {
            const chunk = JSON.parse(payload);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) content += delta;
          } catch { /* skip */ }
        }
      }
    }

    // Parse JSON from response
    console.log(`[style-analyze] collected content length: ${content.length}, preview: ${content.slice(0, 200)}`);
    if (!content.trim()) {
      console.warn(`[style-analyze] model returned empty content! model=${model}, imageUrl length=${imageUrl?.length}`);
      return NextResponse.json({ error: "模型返回空内容，可能不支持当前图片格式或图片过大", raw: "(empty)" }, { status: 422 });
    }
    let cleaned = content.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
    }

    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      try {
        const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
        return NextResponse.json(parsed);
      } catch {
        return NextResponse.json({ error: "无法解析风格分析JSON", raw: content.slice(0, 500) }, { status: 422 });
      }
    }

    // Fallback: model response may be truncated (hit max_tokens). Try to repair by closing braces.
    if (jsonStart >= 0 && jsonEnd <= jsonStart) {
      let partial = cleaned.slice(jsonStart);
      // Count unclosed braces and close them
      let depth = 0;
      for (const ch of partial) { if (ch === "{") depth++; else if (ch === "}") depth--; }
      while (depth > 0) { partial += "}"; depth--; }
      try {
        const parsed = JSON.parse(partial);
        console.warn("[style-analyze] repaired truncated JSON successfully");
        return NextResponse.json(parsed);
      } catch {
        return NextResponse.json({ error: "风格分析结果被截断且无法修复", raw: content.slice(0, 500) }, { status: 422 });
      }
    }

    return NextResponse.json({ error: "无法解析风格分析结果", raw: content }, { status: 422 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
