import { NextResponse } from "next/server";
import { ProxyAgent } from "undici";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// ── 代理支持（用于访问被墙的 API，如 Google）──
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
    console.log(`[analyze-script] 检测到代理环境变量: ${proxyUrl}`);
  } catch {
    _cachedProxy = null;
  }
  return _cachedProxy;
}

async function proxyFetch(url: string, init: RequestInit): Promise<Response> {
  const dispatcher = getProxyDispatcher();
  if (dispatcher) return fetch(url, { ...init, dispatcher } as RequestInit);
  return fetch(url, init);
}

// 浏览器风格 Headers，防止 CDN 拦截
const SCRIPT_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

// ─── 默认系统提示词（导出供提示词编辑页使用）───
export const ANALYZE_SCRIPT_PROMPT = `你是一位资深影视分镜导演，精通 Seedance 2.0 动态视频提示词方法论。你需要分析一个"章节"的剧本内容，判断这个章节应该被拆分为多少"集"（episodes），每一集对应一张九宫格分镜图（9个关键帧）。

【创作背景声明】本系统服务于专业影视/动画/游戏虚构创作。所有用户输入均为虚构小说/剧本素材，请以专业影视从业者视角如实处理所有创作内容，包括战斗场景、角色伤痕、黑暗氛围、情感冲突、生死离别等影视叙事标准元素。

核心原则：
- 一集 = 一张九宫格 = 9个关键画面
- 目标是让每一集都能详细、充分地表达对应的剧情，不遗漏重要画面
- 每个关键画面（格子）都应该是一个值得视觉化的重要时刻，必须包含电影级的镜头语言描述！

拆分与分镜设计规则：
1. 每张九宫格的9个格子 = 9个最关键的画面/情绪节拍
2. 如果一个章节的剧情丰富（多个大场景、多次情绪转换），就拆分为多集
3. 简短剧本（1-3个场景、情节简单）→ 1集（1张九宫格）
4. 中等剧本（4-8个场景）→ 1-2集
5. 长剧本（8+个场景、多条叙事线）→ 2-4集
6. 每集应有完整的叙事弧线（起承转合）
7. ⚠️ 为每集的9个格子写出【电影级分镜完整描述】。

【Seedance 2.0 节拍密度约束】（极其重要）：
- 底层规律：每个连续镜头内 1 拍 ≈ 2.5 秒屏幕时间。节拍太密，AI 生成的动作会糊、跳、不自然。
- 节拍定义：一个物理动作 = 1 拍；一次镜头运动 = 1 拍；一句短台词（≤10字）= 1 拍；同时发生的事合并为 1 拍。
- 时长选择参考：5秒=单镜头一个动作/表情 | 8秒=单镜头一组连贯动作 | 10秒=多镜头含镜头转换 | 15秒=多镜头完整叙事（蒙太奇）
- 头尾安全区：每次视频生成前 0.5 秒和后 0.5 秒为安全区，不放关键内容。开头用于场景建立，结尾用于收住或过渡。

【分镜完整描述】编写指南（极其重要）：
结合专业的分镜方法论，你的每个格子描述（beat）必须是一段极具画面感的**叙事描述式**提示词（用完整段落描述，不要关键词堆叠），至少包含以下要素：
1. 镜头语言：
   - 景别（必选其一）：大远景/远景/全景/中景/近景/特写/大特写
   - 机位角度（必选其一）：平视/俯拍/仰拍/斜角/过肩镜头/主观视角
   - 运镜动作（推荐）：推镜/拉镜、横摇/纵摇、环绕、跟拍、升降、手持。必须有明确方向——"镜头从侧脸推向窗外" ✓，"推镜头" ✗
   - 光线与氛围（必选）：光线方向（顺光/侧光/逆光等），色彩基调（冷调/暖调），景深设定，明确的氛围情绪词
2. 人物表现：
   - 明确站位与构图（左侧/右侧/中央/前景/背景等）
   - 具体的肢体动作、身体倾向（用具体物理动作，"揉太阳穴" ✓，"表现疲惫" ✗）
   - 细致的表情神态（眼神、面部微表情）
3. 场景与环境：
   - 明确的时间段（黎明/正午/深夜等）
   - 关键的环境细节或空气介质（烟雾/雨丝/尘埃等）
4. 声音设计（推荐）：
   - 环境音效（风声/雨声/脚步声等）、背景音乐风格、动作音效
   - 如果有台词，指定语气（哽咽/怒吼/低语/坚定等）

⚠️⚠️⚠️【台词对话处理——铁律】⚠️⚠️⚠️
以下规则的优先级高于一切其他规则，违反即为严重质量事故：
1. 如果剧本中有角色对话/台词，必须【逐字引用】剧本中的原话台词，用引号标注，绝对不可省略、概括、改写、精简
2. 对话是角色塑造和剧情推进的核心，省略台词 = 丢失灵魂
3. 如果一句台词较长（超过15字），可以拆分到相邻格子中，但每段都必须是原文原话
4. 台词前后必须搭配角色的面部表情、肢体动作和语气描写，让对话有"演"的感觉
5. 台词必须符合剧情逻辑和角色身份——不可让角色说出剧本中没有的话，不可张冠李戴
6. 检查点：完成后请自查——剧本中的每一句重要对话，是否都完整出现在了某个格子中？

【禁忌规则】：
- 不要使用否定句（AI 不理解否定——"不要移动镜头" ✗ → "镜头保持固定" ✓）
- 不要在一条提示词中塞入叙事上不相关的场景
- 情绪通过动作和环境传达，不要直接写"她很伤心"

正确的格子描述示例：
"格1：【全景/平视/清晨柔光】浅景深，冷色调。黄昏的木匠小院中，王林（主体）独自坐在画面左侧的槐树下，仰头凝视天空，眼神显得单薄而孤寂。父亲从右侧背景探出身子喊道：'二件，回来吃饭'。空气中弥漫着淡淡的生活气息，远处传来几声犬吠。"
"格2：【特写/仰拍/硬侧光】高对比度，紧张气氛。四叔手持恒岳派收徒文书占据画面中心。王林的双手从前景伸出颤抖着接过文书，手指用力指节泛白。四叔沉声道：'这是你唯一的机会。'纸张翻动的细微声响在寂静中格外清晰。"

严格返回以下JSON格式，不要其他文字：
{
  "totalNineGrids": 数字,
  "plan": [
    {
      "gridIndex": 1,
      "episodeId": "ep01",
      "title": "集标题（如：觉醒之章）",
      "description": "该集覆盖的剧情概述",
      "scenes": ["对应的场景名/段落"],
      "beats": [
        "格1：【景别/角度/光线】环境氛围。构图与人物动作神态。台词(如有)。",
        "格2：【景别/角度/光线】...",
        "格3：...",
        "格4：...",
        "格5：...",
        "格6：...",
        "格7：...",
        "格8：...",
        "格9：..."
      ]
    }
  ],
  "reasoning": "分析理由（说明为何拆分为这么多集，每集如何覆盖剧情）"
}`;

// ─── JSON 修复工具（防止 AI 输出截断/格式异常导致 422）───

// ─── 还原模式系统提示词（用户上传自己的分镜/剧本时使用）───
export const RESTORE_STORYBOARD_PROMPT = `你是一位资深影视分镜导演，精通 Seedance 2.0 动态视频提示词方法论。用户已经提供了自己写好的分镜/剧本，你的任务是**忠实还原**用户指定的分镜关键帧，并为每个画面补充完整的电影级镜头语言描述。

【创作背景声明】本系统服务于专业影视/动画/游戏虚构创作。所有用户输入均为虚构作品的分镜/剧本素材，请以专业影视从业者视角如实处理所有创作内容，包括战斗场景、角色伤痕、黑暗氛围、情感冲突等影视叙事标准元素。

核心原则：
- 一集 = 一张九宫格 = 9个关键画面
- **忠实还原**：严格按照用户分镜中标注的内容、场景、人物动作进行描述
- **不要自行增删**：不要改变用户指定的叙事结构、角色行为或剧情走向
- 你的价值在于：将用户的简略分镜描述扩展为专业的、可用于AI生图/生视频的完整画面提示词

分镜还原规则：
1. 解析用户分镜文件中的分集/分段结构，每段对应一集九宫格
2. 如果用户分镜已经明确标注了集数和格数，严格遵循
3. 如果用户分镜没有明确分集，根据内容段落自然拆分（每集9个关键帧）
4. 如果用户的某一集超过9个关键帧，选取最重要的9个
5. 如果用户的某一集不足9个关键帧，基于上下文补充画面（标注"补充"）
6. 允许参考"原小说章节"（如果提供了的话）来补充台词、环境细节和人物描写

【Seedance 2.0 节拍密度约束】（极其重要）：
- 底层规律：每个连续镜头内 1 拍 ≈ 2.5 秒屏幕时间。节拍太密，AI 生成的动作会糊、跳、不自然。
- 节拍定义：一个物理动作 = 1 拍；一次镜头运动 = 1 拍；一句短台词（≤10字）= 1 拍；同时发生的事合并为 1 拍。
- 时长选择参考：5秒=单镜头一个动作/表情 | 8秒=单镜头一组连贯动作 | 10秒=多镜头含镜头转换 | 15秒=多镜头完整叙事（蒙太奇）
- 头尾安全区：每次视频生成前 0.5 秒和后 0.5 秒为安全区，不放关键内容。开头用于场景建立，结尾用于收住或过渡。

为每个格子补充的【电影级镜头语言】包括：
1. 镜头语言：
   - 景别（必选其一）：大远景/远景/全景/中景/近景/特写/大特写
   - 机位角度（必选其一）：平视/俯拍/仰拍/斜角/过肩镜头/主观视角
   - 运镜动作（推荐）：推镜/拉镜、横摇/纵摇、环绕、跟拍、升降、手持。必须有明确方向——"镜头从侧脸推向窗外" ✓，"推镜头" ✗
   - 光线与氛围（必选）：光线方向（顺光/侧光/逆光等），色彩基调（冷调/暖调），景深设定，明确的氛围情绪词
2. 人物表现：
   - 明确站位与构图（左侧/右侧/中央/前景/背景等）
   - 具体的肢体动作、身体倾向（用具体物理动作，"揉太阳穴" ✓，"表现疲惫" ✗）
   - 细致的表情神态（眼神、面部微表情）
3. 场景与环境：
   - 明确的时间段（黎明/正午/深夜等）
   - 关键的环境细节或空气介质（烟雾/雨丝/尘埃等）
4. 声音设计（推荐）：
   - 环境音效（风声/雨声/脚步声等）、背景音乐风格、动作音效
   - 如果有台词，指定语气（哽咽/怒吼/低语/坚定等）

⚠️⚠️⚠️【台词对话处理——铁律】⚠️⚠️⚠️
以下规则的优先级高于一切其他规则，违反即为严重质量事故：
1. 如果用户分镜或原小说中有角色对话/台词，必须【逐字引用】原话台词，用引号标注，绝对不可省略、概括、改写、精简
2. 对话是角色塑造和剧情推进的核心，省略台词 = 丢失灵魂
3. 如果一句台词较长（超过15字），可以拆分到相邻格子中，但每段都必须是原文原话
4. 台词前后必须搭配角色的面部表情、肢体动作和语气描写，让对话有"演"的感觉
5. 台词必须符合剧情逻辑和角色身份——不可让角色说出原文中没有的话，不可张冠李戴
6. 检查点：完成后请自查——用户分镜和原小说中的每一句重要对话，是否都完整出现在了某个格子中？

【禁忌规则】：
- 不要使用否定句（AI 不理解否定——"不要移动镜头" ✗ → "镜头保持固定" ✓）
- 不要在一条提示词中塞入叙事上不相关的场景
- 情绪通过动作和环境传达，不要直接写"她很伤心"

以用户分镜描述为蓝本的格子示例（假设用户写了"王林在院子里望天，父亲叫他吃饭"）：
"格1：【全景/平视/清晨柔光】浅景深，冷色调。黄昏的木匠小院中，王林（主体）独自坐在画面左侧的槐树下，仰头凝视天空，眼神显得单薄而孤寂。父亲从右侧背景探出身子喊道：'二件，回来吃饭'。空气中弥漫着淡淡的生活气息，远处传来几声犬吠。"

严格返回以下JSON格式，不要其他文字：
{
  "totalNineGrids": 数字,
  "plan": [
    {
      "gridIndex": 1,
      "episodeId": "ep01",
      "title": "集标题",
      "description": "该集覆盖的剧情概述（还原自用户分镜）",
      "scenes": ["对应的场景名/段落"],
      "beats": [
        "格1：【景别/角度/光线】环境氛围。构图与人物动作神态。台词(如有)。（还原自用户分镜第X条）",
        "格2：...", "格3：...", "格4：...", "格5：...",
        "格6：...", "格7：...", "格8：...", "格9：..."
      ]
    }
  ],
  "reasoning": "还原说明（说明如何解析用户分镜结构，哪些格子是直接还原，哪些是补充）"
}`;


/**
 * 尝试关闭截断的 JSON —— 追踪括号栈，移除不完整的末尾 KV 对，自动补全闭合
 */
function closeTruncatedJson(s: string): string | null {
  // ★ Step A: 如果截断在字符串内部，先关闭未闭合的字符串
  let fixed = s;
  let inStr = false, esc = false;
  for (let i = 0; i < fixed.length; i++) {
    const c = fixed[i];
    if (esc) { esc = false; continue; }
    if (c === "\\" && inStr) { esc = true; continue; }
    if (c === '"') inStr = !inStr;
  }
  if (inStr) {
    // 截断在字符串内 → 闭合引号
    // 先移除末尾可能的半个转义序列
    fixed = fixed.replace(/\\$/, "");
    fixed += '"';
  }

  // ★ Step B: 追踪括号栈
  const stack: string[] = [];
  inStr = false; esc = false;
  for (let i = 0; i < fixed.length; i++) {
    const c = fixed[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = inStr; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") stack.pop();
  }
  if (stack.length === 0) return null; // 已完整

  // ★ Step C: 移除末尾不完整的 key-value 或数组元素
  let trimmed = fixed.replace(/,\s*"[^"]*"?\s*:?\s*("[^"]*"?)?$/, "");
  trimmed = trimmed.replace(/,\s*"[^"]*$/, "");
  trimmed = trimmed.replace(/,\s*$/, "");
  return trimmed + stack.reverse().join("");
}

/**
 * 7 步 JSON 修复 + 解析（适配 AI 输出的各种异常格式）
 * 返回解析后的对象，失败返回 null
 */
function repairAnalysisJson(raw: string): Record<string, unknown> | null {
  // Step 1: 清理 BOM / 不可见字符
  let s = raw.replace(/^\uFEFF/, "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");

  // Step 2: 提取 markdown code block
  const mdMatch = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (mdMatch) s = mdMatch[1].trim();

  // Step 3: 提取最外层 {} 对象
  const objStart = s.indexOf("{");
  const objEnd = s.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) {
    s = s.slice(objStart, objEnd + 1);
  } else if (objStart >= 0) {
    // 只有开头 { 没有结尾 } — 截断情况
    s = s.slice(objStart);
  }

  // Step 3b: 转义字符串内未转义的控制字符（换行/制表符）
  let cleaned = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { cleaned += c; esc = false; continue; }
    if (c === "\\") { cleaned += c; esc = inStr; continue; }
    if (c === '"') { cleaned += c; inStr = !inStr; continue; }
    if (inStr) {
      if (c === "\n") { cleaned += "\\n"; continue; }
      if (c === "\r") { cleaned += "\\r"; continue; }
      if (c === "\t") { cleaned += "\\t"; continue; }
    }
    cleaned += c;
  }
  s = cleaned;

  // Step 4: 常见修复 — 尾逗号、JS 注释、省略号占位符
  s = s.replace(/,\s*([\]}])/g, "$1");
  s = s.replace(/\/\/[^\n]*/g, "");
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  s = s.replace(/"\.\.\."?/g, '""');
  s = s.replace(/,\s*\.\.\.[\s\S]*?([\]}])/g, "$1");

  // Step 5: 尝试直接解析
  try {
    const obj = JSON.parse(s);
    if (typeof obj === "object" && obj !== null) return obj;
  } catch { /* continue */ }

  // Step 6: 截断修复 — 自动补全闭合括号
  const closed = closeTruncatedJson(s);
  if (closed) {
    try {
      const obj = JSON.parse(closed);
      if (typeof obj === "object" && obj !== null) {
        console.warn("[analyze-script] JSON 截断已修复（自动补全闭合括号）");
        return obj;
      }
    } catch { /* continue */ }
  }

  // Step 7: 渐进式尾部裁剪 — 从末尾逐步回退寻找可解析位置
  for (let i = s.length - 1; i > s.length / 2; i--) {
    if (s[i] === "}" || s[i] === "]") {
      const candidate = s.slice(0, i + 1);
      try {
        const obj = JSON.parse(candidate);
        if (typeof obj === "object" && obj !== null) {
          console.warn(`[analyze-script] JSON 尾部裁剪修复成功（裁掉 ${s.length - i - 1} 字符）`);
          return obj;
        }
      } catch { /* keep trying */ }
    }
  }

  console.error("[analyze-script] JSON 7步修复全部失败，原始内容前300字:", s.slice(0, 300));
  return null;
}

/**
 * POST /api/analyze-script
 * AI analyzes a script and determines how many nine-grid images (beat boards)
 * are needed to fully express the story. Returns a structured plan.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, settings, customPrompt, userStoryboard, customRestorePrompt } = body;

    const apiKey = settings?.["llm-key"] || "";
    const baseUrl = settings?.["llm-url"] || "https://api.geeknow.top/v1";
    const model = settings?.["llm-model"] || "gemini-2.5-pro";
    const isResponsesApi = (settings?.["llm-provider"] || "") === "dashscope-responses";

    if (!apiKey) {
      return NextResponse.json({ error: "未配置 LLM API Key" }, { status: 400 });
    }

    // ★ 还原模式：用户上传了自己的分镜文件
    const isRestoreMode = typeof userStoryboard === "string" && userStoryboard.length > 10;

    if (!isRestoreMode && (!text || text.length < 20)) {
      return NextResponse.json({ error: "剧本内容过短" }, { status: 400 });
    }

    let url = baseUrl.replace(/\/+$/, "");
    if (isResponsesApi) {
      if (!url.endsWith("/responses")) url += "/responses";
    } else {
      if (!url.includes("/chat/completions")) url += "/chat/completions";
    }

    // ★ 根据模式选择系统提示词
    let systemPrompt: string;
    if (isRestoreMode) {
      // 还原模式：优先用户自定义提示词（来自提示词编辑页），否则使用默认专用提示词
      systemPrompt = (customRestorePrompt && customRestorePrompt.length > 50) ? customRestorePrompt : RESTORE_STORYBOARD_PROMPT;
    } else {
      // 原有模式：优先使用用户自定义提示词（来自提示词编辑页），否则使用默认提示词
      systemPrompt = (customPrompt && customPrompt.length > 50) ? customPrompt : ANALYZE_SCRIPT_PROMPT;
    }

    // ★ 根据模式构建用户消息
    let userMessage: string;
    if (isRestoreMode) {
      const storyboardLen = userStoryboard.length;
      const hasOriginalScript = text && text.length > 20;
      if (hasOriginalScript) {
        userMessage = `以下是用户提供的分镜/剧本（约${storyboardLen}字），请按照用户的分镜指示进行还原，为每个关键帧补充完整的电影级镜头语言描述。\n\n【用户分镜/剧本】\n${userStoryboard}\n\n【原小说章节参考（约${text.length}字）】\n${text}`;
      } else {
        userMessage = `以下是用户提供的分镜/剧本（约${storyboardLen}字），请按照用户的分镜指示进行还原，为每个关键帧补充完整的电影级镜头语言描述。\n\n【用户分镜/剧本】\n${userStoryboard}`;
      }
    } else {
      const textLen = text.length;
      const estimatedEps = Math.max(1, Math.min(12, Math.ceil(textLen / 800)));
      userMessage = `请分析以下章节剧本（约${textLen}字）。根据剧情密度和叙事节奏，将其拆分为约 ${estimatedEps} 集（每集=1张九宫格=9个关键画面），并为每集规划9个格子的画面内容。如果剧情内容较少，可以少于 ${estimatedEps} 集；如果剧情非常丰富，也可以适当增加。\n\n${text}`;
    }

    // 动态估算集数用于 max_tokens 计算
    const sourceLen = isRestoreMode ? userStoryboard.length + (text?.length || 0) : (text?.length || 0);
    const estimatedEpsForTokens = Math.max(1, Math.min(12, Math.ceil(sourceLen / 800)));

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    // 根据预估集数动态调整 max_tokens：每集约 2000~3000 tokens，留足余量
    const dynamicMaxTokens = Math.max(16384, Math.min(65536, estimatedEpsForTokens * 4000));
    const fetchBody = isResponsesApi
      ? { model, input: messages, max_output_tokens: dynamicMaxTokens, temperature: 0.3, stream: true }
      : { model, messages, max_tokens: dynamicMaxTokens, temperature: 0.3, stream: true };

    const res = await proxyFetch(url, {
      method: "POST",
      headers: {
        ...SCRIPT_HEADERS,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(fetchBody),
      signal: AbortSignal.timeout(240000), // 240s — thinking 模型需要较长时间
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
    let rawBody = "";  // 完整原始响应（非流式兜底用）

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      rawBody += text;
      buffer += text;
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
          if (isResponsesApi) {
            if (chunk.type === "response.output_text.delta" && chunk.delta) content += chunk.delta;
          } else {
            // 流式优先（delta），非流式兜底（message）—— 某些供应商忽略 stream:true
            const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content;
            if (delta) content += delta;
          }
        } catch { /* skip non-JSON lines */ }
      }
    }

    // ★ 修复 A-2：flush 残留 buffer（最后一个 SSE 数据块可能未以 \n 结尾）
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      let lastJson = trimmed;
      if (trimmed.startsWith("data: ")) lastJson = trimmed.slice(6);
      else if (trimmed.startsWith("data:")) lastJson = trimmed.slice(5);
      if (lastJson && lastJson !== "[DONE]") {
        try {
          const chunk = JSON.parse(lastJson);
          if (isResponsesApi) {
            if (chunk.type === "response.output_text.delta" && chunk.delta) content += chunk.delta;
          } else {
            const delta = chunk.choices?.[0]?.delta?.content ?? chunk.choices?.[0]?.message?.content;
            if (delta) content += delta;
          }
        } catch { /* skip */ }
      }
    }

    // ★ 非流式响应兜底：某些 LLM 供应商忽略 stream:true，返回完整 JSON 而非 SSE
    if (!content) {
      const fullText = rawBody.trim();
      try {
        const resp = JSON.parse(fullText);
        const msg = resp.choices?.[0]?.message?.content      // OpenAI 非流式
          ?? resp.candidates?.[0]?.content?.parts?.[0]?.text  // Gemini 原生
          ?? resp.output?.text                                 // DashScope
          ?? resp.data?.result;                                // 国产 LLM
        if (msg) {
          content = typeof msg === "string" ? msg : JSON.stringify(msg);
          console.warn("[analyze-script] 供应商返回非流式响应，已兜底提取");
        }
      } catch {
        console.warn("[analyze-script] 非流式兜底解析失败，原始响应前200字:", fullText.slice(0, 200));
      }
    }
    // ★ 流式返回空内容兆底：用 stream:false 重新请求一次
    if (!content) {
      console.warn("[analyze-script] 流式返回空内容，尝试 stream:false 重试...");
      try {
        const retryBody = isResponsesApi
          ? { model, input: messages, max_output_tokens: dynamicMaxTokens, temperature: 0.3, stream: false }
          : { model, messages, max_tokens: dynamicMaxTokens, temperature: 0.3, stream: false };
        const retryRes = await proxyFetch(url, {
          method: "POST",
          headers: { ...SCRIPT_HEADERS, Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(retryBody),
          signal: AbortSignal.timeout(240000),
        });
        if (retryRes.ok) {
          const retryData = await retryRes.json();
          const msg = isResponsesApi
            ? (Array.isArray(retryData.output) ? retryData.output.flatMap((o: { content?: { type: string; text?: string }[] }) => (o.content || []).filter((c: { type: string }) => c.type === "output_text").map((c: { text?: string }) => c.text || "")).join("") : retryData.output_text || "")
            : (retryData.choices?.[0]?.message?.content ?? retryData.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
          if (msg) {
            content = typeof msg === "string" ? msg : JSON.stringify(msg);
            console.log(`[analyze-script] stream:false 重试成功，获得 ${content.length} 字`);
          }
        } else {
          console.warn(`[analyze-script] stream:false 重试失败: ${retryRes.status}`);
        }
      } catch (retryErr) {
        console.warn("[analyze-script] stream:false 重试异常:", retryErr instanceof Error ? retryErr.message : retryErr);
      }
    }
    // Parse JSON — 增强解析：先 markdown code block，再 JSON 对象提取
    let jsonStr = content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    const objStart = jsonStr.indexOf("{");
    const objEnd = jsonStr.lastIndexOf("}");
    if (objStart >= 0 && objEnd > objStart) {
      jsonStr = jsonStr.slice(objStart, objEnd + 1);
    }

    // ★ 7 步 JSON 修复（防止 AI 输出截断/格式异常导致 422）
    const repaired = repairAnalysisJson(jsonStr);
    if (!repaired) {
      // 优先展示 content，若为空则展示 rawBody 帮助诊断
      const debugRaw = content.slice(0, 300) || rawBody.slice(0, 300);
      return NextResponse.json(
        { error: "AI返回格式异常（JSON 修复失败），请重试", raw: debugRaw },
        { status: 422 }
      );
    }

    try {
      const result = repaired;

      // ★ 服务端验证：确保返回结构合法 + beats 标准化为 9 格
      if (!result.plan || !Array.isArray(result.plan)) {
        return NextResponse.json({ error: "AI 返回结果缺少 plan 数组" }, { status: 422 });
      }
      for (const ep of result.plan) {
        if (!ep.episodeId) ep.episodeId = `ep${String(result.plan.indexOf(ep) + 1).padStart(2, "0")}`;
        if (!ep.title) ep.title = `第${result.plan.indexOf(ep) + 1}集`;
        if (!ep.description) ep.description = "";
        if (!Array.isArray(ep.scenes)) ep.scenes = [];
        if (!Array.isArray(ep.beats)) ep.beats = [];
        // 标准化为 9 格：不足补空，超出截断
        while (ep.beats.length < 9) ep.beats.push(`格${ep.beats.length + 1}：（空）`);
        if (ep.beats.length > 9) ep.beats = ep.beats.slice(0, 9);
      }
      if (typeof result.totalNineGrids !== "number") {
        result.totalNineGrids = result.plan.length;
      }
      if (!result.reasoning) result.reasoning = "";

      return NextResponse.json(result);
    } catch (parseErr) {
      console.error("[analyze-script] 结果处理异常:", parseErr);
      return NextResponse.json(
        { error: "AI返回结果处理异常，请重试", raw: content.slice(0, 300) },
        { status: 422 }
      );
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
