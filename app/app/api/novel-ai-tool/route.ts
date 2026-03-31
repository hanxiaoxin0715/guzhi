import { NextResponse } from "next/server";
import { ProxyAgent } from "undici";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function getProxyUrl(): string | null {
  return process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy
    || process.env.ALL_PROXY || process.env.all_proxy
    || null;
}

let _cachedProxy: ProxyAgent | null | false = false;
function getProxyDispatcher(): ProxyAgent | null {
  if (_cachedProxy !== false) return _cachedProxy;
  const proxyUrl = getProxyUrl();
  if (!proxyUrl) { _cachedProxy = null; return null; }
  try {
    _cachedProxy = new ProxyAgent(proxyUrl);
  } catch {
    _cachedProxy = null;
  }
  return _cachedProxy;
}

async function proxyFetch(url: string, init: RequestInit): Promise<Response> {
  const dispatcher = getProxyDispatcher();
  if (dispatcher) {
    return fetch(url, { ...init, dispatcher } as RequestInit);
  }
  return fetch(url, init);
}

const COMMON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

interface NovelAIToolRequest {
  type: "remove-ai-trace" | "extract-adjectives";
  apiKey: string;
  baseUrl: string;
  model: string;
  content: string;
  category?: string;
}

const REMOVE_AI_TRACE_PROMPT = `你是一位专注于网文写作的顶级编辑，擅长去除AI生成内容中的"机器味"和"AI痕迹"。

请对以下文本进行深度改写，消除AI生成痕迹，同时保持：
1. 原文的核心剧情和信息
2. 原文的风格倾向（如果原本是严肃的就保持严肃，如果是轻松的就保持轻松）
3. 适当保留有价值的形容词和描写

【必须消除的AI特征】
1. 机械性连接词："首先"、"其次"、"此外"、"同时"、"总的来说"、"需要注意的是"
2. 套话空话："可以看出"、"显而易见"、"毫无疑问"、"必须承认"
3. 过度完美的总结性句子："是一场...的体验"、"具有...的特点"
4. 翻译腔："当...的时候"、"在...的过程中"
5. 重复的句式结构
6. 过于工整的对仗
7. AI常用词汇："赋能"、"闭环"、"痛点"、"抓手"、"心智"

【改写技巧】
1. 用具体细节替代抽象总结
2. 用口语化表达替代书面语
3. 允许适当的不完美和"杂质"
4. 保持适度的信息密度，不要每个细节都解释

请直接输出改写后的文本，不要添加任何评论或说明。`;

const EXTRACT_ADJECTIVES_PROMPT = `你是一位语言学家和网文写作专家，擅长挖掘精准、有画面感、高质量的形容词。

请根据以下内容，批量生成适合用于描写的人物/场景/物品形容词的。要求：
1. 每个类别生成8-15个形容词
2. 形容词要有画面感、具体、可感知
3. 适合网文写作，避免过于文艺或学术的词汇
4. 可以包含一些新颖的组合词

【内容主题】
{{topic}}

【可选类别】（请按以下JSON格式输出，直接输出JSON，不要任何其他文字）
{{format}}

请生成JSON格式的形容词列表。`;

export async function POST(request: Request) {
  try {
    const body: NovelAIToolRequest = await request.json();
    const { type, apiKey, baseUrl, model, content, category } = body;

    if (!apiKey || !model || !content) {
      return NextResponse.json({ error: "缺少必要参数: apiKey, model, content" }, { status: 400 });
    }

    const cleanBase = (baseUrl && baseUrl.trim()) ? baseUrl.trim() : "https://api.geeknow.top/v1";
    const cleanApiKey = apiKey.trim();

    let systemPrompt: string;
    let userPrompt: string;

    if (type === "remove-ai-trace") {
      systemPrompt = REMOVE_AI_TRACE_PROMPT;
      userPrompt = content;
    } else if (type === "extract-adjectives") {
      const categories = category ? category.split(",").map(c => c.trim()) : ["外貌", "性格", "场景", "物品"];
      const formatJson = categories.map(cat => ({
        category: cat,
        adjectives: ["形容词1", "形容词2", "形容词3"]
      }));
      
      systemPrompt = EXTRACT_ADJECTIVES_PROMPT
        .replace("{{topic}}", content)
        .replace("{{format}}", JSON.stringify(formatJson, null, 2));
      userPrompt = "请直接输出JSON格式的形容词列表，不要任何前缀文字。";
    } else {
      return NextResponse.json({ error: "未知的工具类型" }, { status: 400 });
    }

    let url = cleanBase.replace(/\/+$/, "");
    if (!url.includes("/chat/completions")) {
      url += "/chat/completions";
    }

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];

    const res = await proxyFetch(url, {
      method: "POST",
      headers: {
        ...COMMON_HEADERS,
        Authorization: `Bearer ${cleanApiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: type === "remove-ai-trace" ? 8192 : 4096,
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
    const aiContent = data.choices?.[0]?.message?.content || "";

    return NextResponse.json({
      content: aiContent,
      usage: data.usage,
    });
  } catch (error) {
    console.error("[NovelAITool] Error:", error);
    return NextResponse.json(
      { error: `服务器错误: ${error instanceof Error ? error.message : "未知错误"}` },
      { status: 500 }
    );
  }
}
