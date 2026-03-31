/**
 * 两阶段 AI 提取编排器
 *
 * Phase 1: 轻量级实体识别 — 提取名称+别名+详细中文描述（150-200字）
 *   - 输入: 剧本全文 + 风格参考
 *   - 输出: {characters, scenes, props, style} — 每条仅有 name/aliases/description
 *   - 预期耗时: ~20-40s（无需生成英文 prompt，思考阶段大幅缩短）
 *
 * Phase 2: 并发 Spec Sheet Prompt 生成 — 每个实体独立调用
 *   - 输入: 实体名称+描述 + 对应的 spec sheet 提示词模板
 *   - 输出: 英文 prompt（80-120词）
 *   - 并发度: 最多 5 个同时请求
 *   - 预期耗时: ~15-30s wall-clock（单个 ~5-15s，并发后取最慢）
 *
 * 总预期: ~35-70s（原单阶段 ~80-170s，提速 ~50-60%）
 */

import {
  PHASE1_EXTRACT_PROMPT,
  PHASE2_CHARACTER_PROMPT,
  PHASE2_SCENE_PROMPT,
  PHASE2_PROP_PROMPT,
} from "./extractPrompts";

// ── 类型定义 ──

export interface TwoPhaseConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  isResponsesApi: boolean;
  /** 风格参考文本（可选，注入到所有 prompt 中） */
  stylePrompt?: string;
  /** 进度回调（用于 SSE/UI） */
  onProgress?: (msg: string) => void;
  /** 外部取消信号 */
  signal?: AbortSignal;
}

export interface ExtractedEntity {
  name: string;
  aliases: string[];
  description: string;
  prompt: string;
}

export interface ExtractResult {
  characters: ExtractedEntity[];
  scenes: ExtractedEntity[];
  props: ExtractedEntity[];
  style: {
    artStyle: string;
    colorPalette: string;
    timeSetting: string;
  };
  /** Phase 2 失败的实体名称列表（用于前端提示） */
  warnings?: string[];
}

// ── 并发控制 ──

const PHASE2_CONCURRENCY = 5;

/** 带并发限制的 Promise.allSettled */
async function promiseAllWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      try {
        results[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (e) {
        results[i] = { status: "rejected", reason: e };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ── LLM 请求封装 ──

/**
 * 发送非流式 LLM 请求（Phase 1 和 Phase 2 共用）
 * Phase 1 用 temperature=0 保证确定性，Phase 2 用 temperature=0.3 允许微创造性
 */
async function callLLMNonStreaming(
  apiKey: string,
  baseUrl: string,
  model: string,
  systemPrompt: string,
  userContent: string,
  maxTokens: number,
  temperature: number,
  isResponsesApi: boolean,
  signal?: AbortSignal,
): Promise<string> {
  let url = baseUrl.replace(/\/+$/, "");
  if (isResponsesApi) {
    if (!url.endsWith("/responses")) url += "/responses";
  } else {
    if (!url.includes("/chat/completions")) url += "/chat/completions";
  }

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  const reqBody = isResponsesApi
    ? { model, input: messages, max_output_tokens: maxTokens, temperature }
    : { model, messages, max_tokens: maxTokens, temperature };

  // 合并外部 signal 和超时 — AbortSignal.any 兼容性不足，手动实现
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000); // 180s 超时
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify(reqBody),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`API 错误 (${res.status}): ${errText.slice(0, 300)}`);
    }

    const data = await res.json();

    if (isResponsesApi) {
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
      return content || data.output_text || "";
    }
    return data.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 发送流式 LLM 请求（仅 Phase 1 使用 — streaming 在客户端可提供更早反馈）
 */
async function callLLMStreaming(
  apiKey: string,
  baseUrl: string,
  model: string,
  systemPrompt: string,
  userContent: string,
  maxTokens: number,
  temperature: number,
  isResponsesApi: boolean,
  signal?: AbortSignal,
): Promise<string> {
  let url = baseUrl.replace(/\/+$/, "");
  if (isResponsesApi) {
    if (!url.endsWith("/responses")) url += "/responses";
  } else {
    if (!url.includes("/chat/completions")) url += "/chat/completions";
  }

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  const reqBody = isResponsesApi
    ? { model, input: messages, max_output_tokens: maxTokens, stream: true, temperature }
    : { model, messages, max_tokens: maxTokens, temperature, stream: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 240_000); // 240s — thinking 模型思考阶段可能较长
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify(reqBody),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const err = new Error(`API 错误 (${res.status}): ${errText.slice(0, 300)}`);
      (err as Error & { status: number }).status = res.status;
      throw err;
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let result = "";
    let buffer = "";

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
        if (jsonStr === "[DONE]") { buffer = ""; continue; }
        try {
          const chunk = JSON.parse(jsonStr);
          if (isResponsesApi) {
            if (chunk.type === "response.output_text.delta" && chunk.delta) result += chunk.delta;
          } else {
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) result += delta;
          }
        } catch { /* skip */ }
      }
    }
    // flush 残余 buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      let jsonStr = trimmed;
      if (trimmed.startsWith("data: ")) jsonStr = trimmed.slice(6);
      else if (trimmed.startsWith("data:")) jsonStr = trimmed.slice(5);
      if (jsonStr !== "[DONE]") {
        try {
          const chunk = JSON.parse(jsonStr);
          if (isResponsesApi) {
            if (chunk.type === "response.output_text.delta" && chunk.delta) result += chunk.delta;
          } else {
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) result += delta;
          }
        } catch { /* skip */ }
      }
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

// ── JSON 解析与修复（复用 extract/route.ts 7 步修复逻辑的轻量版） ──

function repairAndParseJson(raw: string): Record<string, unknown> | null {
  let s = raw.trim();
  // Step 1: 清理 BOM 和不可见字符
  s = s.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "");
  // Step 2: 提取 markdown 代码块
  const cbMatch = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (cbMatch) s = cbMatch[1].trim();

  // Step 3: 提取最外层 {}
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    s = s.slice(first, last + 1);
  } else if (first >= 0) {
    s = s.slice(first);
  } else {
    return null;
  }

  // Step 3b: 转义控制字符（状态机）
  function escapeControlChars(input: string): string {
    let out = "";
    let inStr = false;
    let escaped = false;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === "\\") { out += ch; escaped = true; continue; }
      if (ch === '"') { inStr = !inStr; out += ch; continue; }
      if (inStr) {
        const code = ch.charCodeAt(0);
        if (ch === "\n") { out += "\\n"; continue; }
        if (ch === "\r") { out += "\\r"; continue; }
        if (ch === "\t") { out += "\\t"; continue; }
        if (code < 0x20) { out += "\\u" + code.toString(16).padStart(4, "0"); continue; }
      }
      out += ch;
    }
    return out;
  }
  s = escapeControlChars(s);

  // Step 4: 常见修复
  s = s.replace(/,\s*([}\]])/g, "$1"); // 尾逗号
  s = s.replace(/\/\/[^\n]*/g, ""); // JS 注释
  s = s.replace(/"\.\.\."/g, '""').replace(/"…"/g, '""'); // 省略号占位

  // Step 5: 尝试直接解析
  try { return JSON.parse(s) as Record<string, unknown>; } catch { /* continue */ }

  // Step 6: 截断修复 — 自动关闭未闭合的括号
  function closeTruncatedJson(input: string): string {
    const stack: string[] = [];
    let inStr2 = false;
    let esc = false;
    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { inStr2 = !inStr2; continue; }
      if (inStr2) continue;
      if (c === "{") stack.push("}");
      else if (c === "[") stack.push("]");
      else if (c === "}" || c === "]") stack.pop();
    }
    if (inStr2) input += '"';
    // 移除尾部不完整 KV
    input = input.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "");
    input = input.replace(/,\s*$/, "");
    return input + stack.reverse().join("");
  }

  const attempt = closeTruncatedJson(s);
  try { return JSON.parse(attempt) as Record<string, unknown>; } catch { /* continue */ }

  // Step 7: 逐步裁剪尾部
  for (let i = s.length - 1; i > 0; i--) {
    if (s[i] === "}" || s[i] === "]") {
      const cut = closeTruncatedJson(s.slice(0, i + 1));
      try { return JSON.parse(cut) as Record<string, unknown>; } catch { continue; }
    }
  }

  return null;
}

// ── 主入口 ──

/**
 * 两阶段提取主函数
 *
 * @returns ExtractResult — 完整的角色/场景/道具数据（含 description + prompt）
 */
export async function twoPhaseExtract(
  text: string,
  config: TwoPhaseConfig,
): Promise<ExtractResult> {
  const { apiKey, baseUrl, model, isResponsesApi, stylePrompt, onProgress, signal } = config;

  const totalStart = Date.now();

  // ═══════ Phase 1: 实体识别 ═══════
  onProgress?.("Phase 1/2 · 正在识别角色/场景/道具...");
  console.log(`[twoPhaseExtract] Phase 1 开始: model=${model}, textLen=${text.length}`);

  let userContent = "请从以下文本中提取角色、场景、道具信息，直接返回JSON：\n\n" + text;
  if (stylePrompt && stylePrompt.length > 5) {
    userContent = [
      `【风格参考】`,
      stylePrompt,
      ``,
      userContent,
    ].join("\n");
  }

  const p1Start = Date.now();
  let p1Raw = "";

  // 先尝试流式，失败回退非流式
  try {
    p1Raw = await callLLMStreaming(
      apiKey, baseUrl, model, PHASE1_EXTRACT_PROMPT, userContent,
      8192, // max_tokens — Phase 1 输出比原来小很多
      0,    // temperature — 确定性提取
      isResponsesApi, signal,
    );
  } catch (streamErr) {
    console.warn(`[twoPhaseExtract] Phase 1 流式失败，回退非流式:`, (streamErr as Error).message?.slice(0, 200));
    p1Raw = await callLLMNonStreaming(
      apiKey, baseUrl, model, PHASE1_EXTRACT_PROMPT, userContent,
      8192, 0, isResponsesApi, signal,
    );
  }

  const p1Elapsed = ((Date.now() - p1Start) / 1000).toFixed(1);
  console.log(`[twoPhaseExtract] Phase 1 完成: ${p1Elapsed}s, rawLen=${p1Raw.length}`);

  if (!p1Raw.trim()) {
    throw new Error("Phase 1 提取结果为空");
  }

  // 解析 Phase 1 JSON
  const p1Parsed = repairAndParseJson(p1Raw);
  if (!p1Parsed) {
    throw new Error("Phase 1 JSON 解析失败");
  }

  // 提取实体列表
  type P1Entity = { name: string; aliases?: string[]; description: string };
  const p1Chars = (Array.isArray(p1Parsed.characters) ? p1Parsed.characters : []) as P1Entity[];
  const p1Scenes = (Array.isArray(p1Parsed.scenes) ? p1Parsed.scenes : []) as P1Entity[];
  const p1Props = (Array.isArray(p1Parsed.props) ? p1Parsed.props : []) as P1Entity[];
  const p1Style = (p1Parsed.style || {}) as Record<string, string>;

  const totalEntities = p1Chars.length + p1Scenes.length + p1Props.length;
  onProgress?.(`Phase 1/2 · 识别完成: ${p1Chars.length}角色 ${p1Scenes.length}场景 ${p1Props.length}道具 (${p1Elapsed}s)`);
  console.log(`[twoPhaseExtract] Phase 1 实体: chars=${p1Chars.length}, scenes=${p1Scenes.length}, props=${p1Props.length}`);

  if (totalEntities === 0) {
    // 返回空结果（但带 style）
    return {
      characters: [],
      scenes: [],
      props: [],
      style: {
        artStyle: p1Style.artStyle || "",
        colorPalette: p1Style.colorPalette || "",
        timeSetting: p1Style.timeSetting || "",
      },
    };
  }

  // ═══════ Phase 2: 并发 Spec Sheet 生成 ═══════
  onProgress?.(`Phase 2/2 · 正在并发生成 ${totalEntities} 个英文提示词...`);
  console.log(`[twoPhaseExtract] Phase 2 开始: ${totalEntities} 个实体, 并发度=${PHASE2_CONCURRENCY}`);

  const p2Start = Date.now();

  // 风格前缀（注入到每个 Phase 2 请求）
  const stylePrefix = stylePrompt && stylePrompt.length > 5
    ? `【风格参考】\n${stylePrompt}\n\n`
    : "";

  // 构建 Phase 2 任务列表
  type Phase2Task = {
    type: "character" | "scene" | "prop";
    index: number;
    name: string;
    description: string;
    systemPrompt: string;
  };

  const tasks: Phase2Task[] = [];
  for (let i = 0; i < p1Chars.length; i++) {
    tasks.push({ type: "character", index: i, name: p1Chars[i].name, description: p1Chars[i].description || "", systemPrompt: PHASE2_CHARACTER_PROMPT });
  }
  for (let i = 0; i < p1Scenes.length; i++) {
    tasks.push({ type: "scene", index: i, name: p1Scenes[i].name, description: p1Scenes[i].description || "", systemPrompt: PHASE2_SCENE_PROMPT });
  }
  for (let i = 0; i < p1Props.length; i++) {
    tasks.push({ type: "prop", index: i, name: p1Props[i].name, description: p1Props[i].description || "", systemPrompt: PHASE2_PROP_PROMPT });
  }

  let completed = 0;

  /** 带重试的 Phase 2 单任务执行（最多 3 次尝试，含指数退避） */
  const PHASE2_MAX_RETRIES = 2; // 最多额外重试 2 次（总共 3 次尝试）
  const PHASE2_RETRY_BASE_DELAY = 2000; // 首次重试等 2s，第二次等 4s

  const taskFns = tasks.map((t, taskIdx) => async () => {
    // 错峰延迟：每个任务开始前按索引错开 300ms，避免并发请求同时到达触发限流
    if (taskIdx > 0) {
      await new Promise(r => setTimeout(r, taskIdx * 300));
    }

    const userMsg = `${stylePrefix}【${t.type === "character" ? "角色" : t.type === "scene" ? "场景" : "道具"}名称】${t.name}\n\n【中文描述】\n${t.description}`;

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= PHASE2_MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const delay = PHASE2_RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
          console.log(`[twoPhaseExtract] Phase 2 重试 ${attempt}/${PHASE2_MAX_RETRIES}: ${t.type}「${t.name}」 等待 ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
        }

        const promptText = await callLLMNonStreaming(
          apiKey, baseUrl, model, t.systemPrompt, userMsg,
          3072,  // max_tokens — JSON 含 prompt + description 双语输出
          0.3,   // temperature — 微创造性
          isResponsesApi, signal,
        );

        const trimmed = promptText.trim();
        // 如果 API 返回 200 但内容为空，视为失败并重试
        if (!trimmed && attempt < PHASE2_MAX_RETRIES) {
          console.warn(`[twoPhaseExtract] Phase 2 [attempt ${attempt}]: ${t.type}「${t.name}」返回空内容，将重试`);
          lastError = new Error("API 返回空内容");
          continue;
        }

        // 解析 Phase 2 返回的 JSON（含 prompt + description）
        let parsedPrompt = trimmed;
        let parsedDescription = "";
        try {
          // 提取 JSON 部分（允许前后有多余文字）
          const jsonStart = trimmed.indexOf("{");
          const jsonEnd = trimmed.lastIndexOf("}");
          if (jsonStart >= 0 && jsonEnd > jsonStart) {
            const jsonStr = trimmed.slice(jsonStart, jsonEnd + 1);
            const parsed = JSON.parse(jsonStr);
            if (parsed.prompt && typeof parsed.prompt === "string") {
              parsedPrompt = parsed.prompt.trim();
              parsedDescription = (parsed.description || "").trim();
            }
          }
        } catch {
          // JSON 解析失败，回退为原始文本作为 prompt
          console.warn(`[twoPhaseExtract] Phase 2: ${t.type}「${t.name}」JSON 解析失败，使用原始文本`);
        }

        completed++;
        onProgress?.(`Phase 2/2 · 已完成 ${completed}/${totalEntities}`);
        console.log(`[twoPhaseExtract] Phase 2 [${completed}/${totalEntities}]: ${t.type}「${t.name}」 → prompt=${parsedPrompt.length}字 desc=${parsedDescription.length}字 (attempt ${attempt})`);

        return { task: t, prompt: parsedPrompt, description: parsedDescription };
      } catch (err) {
        lastError = err;
        const errMsg = (err as Error).message?.slice(0, 200) || String(err);
        console.warn(`[twoPhaseExtract] Phase 2 [attempt ${attempt}/${PHASE2_MAX_RETRIES}]: ${t.type}「${t.name}」失败: ${errMsg}`);
        // 如果是取消信号，立即停止重试
        if (signal?.aborted) throw err;
      }
    }

    // 所有重试都失败
    completed++;
    onProgress?.(`Phase 2/2 · 已完成 ${completed}/${totalEntities} (${t.name} 失败)`);
    console.error(`[twoPhaseExtract] Phase 2 最终失败: ${t.type}「${t.name}」`, lastError);
    return { task: t, prompt: "", description: "" };
  });

  const p2Results = await promiseAllWithConcurrency(taskFns, PHASE2_CONCURRENCY);

  const p2Elapsed = ((Date.now() - p2Start) / 1000).toFixed(1);
  const successCount = p2Results.filter(r => r.status === "fulfilled" && r.value.prompt).length;
  console.log(`[twoPhaseExtract] Phase 2 完成: ${p2Elapsed}s, 成功=${successCount}/${totalEntities}`);

  // ═══════ 合并 Phase 1 + Phase 2 结果 ═══════

  // 初始化结果数组（从 Phase 1 复制 description，prompt 待填充）
  const characters: ExtractedEntity[] = p1Chars.map(c => ({
    name: c.name,
    aliases: c.aliases || [],
    description: c.description || "",
    prompt: "",
  }));
  const scenes: ExtractedEntity[] = p1Scenes.map(s => ({
    name: s.name,
    aliases: s.aliases || [],
    description: s.description || "",
    prompt: "",
  }));
  const props: ExtractedEntity[] = p1Props.map(p => ({
    name: p.name,
    aliases: p.aliases || [],
    description: p.description || "",
    prompt: "",
  }));

  // 填充 Phase 2 生成的 prompt + description，记录失败实体
  const failedNames: string[] = [];

  for (const r of p2Results) {
    if (r.status !== "fulfilled") {
      console.error(`[twoPhaseExtract] Phase 2 unexpected rejection:`, r.reason);
      continue;
    }
    const { task, prompt, description } = r.value;
    if (!prompt) {
      failedNames.push(task.name);
      continue;
    }

    const target =
      task.type === "character" ? characters[task.index] :
      task.type === "scene" ? scenes[task.index] :
      props[task.index];

    if (target) {
      target.prompt = prompt;
      // Phase 2 返回了中文翻译版 description 时，覆盖 Phase 1 的纯文学描述
      if (description) {
        target.description = description;
      }
    }
  }

  // 记录 Phase 2 失败项（仅旧逻辑兼容日志）
  for (const r of p2Results) {
    if (r.status === "rejected") {
      console.error(`[twoPhaseExtract] Phase 2 失败:`, r.reason);
    }
  }

  const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
  const failSummary = failedNames.length > 0 ? ` (${failedNames.length}个实体英文提示词生成失败: ${failedNames.join(", ")})` : "";
  onProgress?.(`提取完成: ${p1Chars.length}角色 ${p1Scenes.length}场景 ${p1Props.length}道具 · ${totalElapsed}s${failSummary}`);
  console.log(`[twoPhaseExtract] 总耗时: ${totalElapsed}s (Phase1: ${p1Elapsed}s, Phase2: ${p2Elapsed}s)${failSummary}`);

  // 构建警告信息
  const warnings: string[] = [];
  if (failedNames.length > 0) {
    warnings.push(`以下 ${failedNames.length} 个实体的英文提示词生成失败（可展开角色卡点击"AI 生成中英提示词"单独重试）: ${failedNames.join("、")}`);
  }

  return {
    characters,
    scenes,
    props,
    style: {
      artStyle: p1Style.artStyle || "",
      colorPalette: p1Style.colorPalette || "",
      timeSetting: p1Style.timeSetting || "",
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
