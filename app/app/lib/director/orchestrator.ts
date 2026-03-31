/**
 * ════════════════════════════════════════════════════════════
 * AI 导演系统 — 编排器
 * ════════════════════════════════════════════════════════════
 *
 * 客户端编排逻辑：
 * 1. 用户输入 → 导演分析意图 → 选择子智能体
 * 2. 子智能体回复包含 [ACTIONS] → 解析并通过 CustomEvent 派发到画布
 * 3. 画布执行后回传结果
 */

import type {
  AgentRole,
  ChatMessage,
  CanvasAction,
  CanvasContext,
  DirectorCommandEvent,
} from "./types";
import { AGENTS } from "./types";
import { parseActionsFromReply, ACTION_CATALOG } from "./actions";
import { DIRECTOR_SYSTEM_PROMPT, buildStoryAgentPrompt, buildShotAgentPrompt, buildImageAgentPrompt } from "./agents";

// ── 生成唯一ID ──
let _idCounter = 0;
export function genId(): string {
  return `${Date.now()}-${++_idCounter}`;
}

// ── 获取画布上下文（通过 CustomEvent 请求） ──

export function requestCanvasContext(): Promise<CanvasContext | null> {
  return new Promise((resolve) => {
    const requestId = genId();
    const timeout = setTimeout(() => {
      window.removeEventListener("director-context-response", handler);
      resolve(null);
    }, 2000);

    function handler(e: CustomEvent<{ requestId: string; context: CanvasContext }>) {
      if (e.detail.requestId === requestId) {
        clearTimeout(timeout);
        window.removeEventListener("director-context-response", handler);
        resolve(e.detail.context);
      }
    }

    window.addEventListener("director-context-response", handler);
    window.dispatchEvent(new CustomEvent("director-context-request", { detail: { requestId } }));
  });
}

// ── 向画布派发操作命令 ──

export function dispatchCanvasAction(action: CanvasAction): Promise<{ success: boolean; result?: string; error?: string }> {
  return new Promise((resolve) => {
    const requestId = genId();
    const timeout = setTimeout(() => {
      window.removeEventListener("director-result", handler);
      resolve({ success: false, error: "操作超时（30秒）" });
    }, 30_000);

    function handler(e: CustomEvent<{ requestId: string; success: boolean; result?: string; error?: string }>) {
      if (e.detail.requestId === requestId) {
        clearTimeout(timeout);
        window.removeEventListener("director-result", handler);
        resolve({ success: e.detail.success, result: e.detail.result, error: e.detail.error });
      }
    }

    window.addEventListener("director-result", handler);

    const event: DirectorCommandEvent = {
      action: action.type,
      params: action.params,
      requestId,
    };
    window.dispatchEvent(new CustomEvent("director-command", { detail: event }));
  });
}

// ── 构建发送给 LLM 的消息 ──

function buildContextSnippet(ctx: CanvasContext | null): string {
  if (!ctx) return "[CANVAS_CONTEXT] 当前不在生图工作台页面";
  return `[CANVAS_CONTEXT]
- 当前页面: ${ctx.currentPage}
- 宫格模式: ${ctx.gridMode}
- 当前集数: ${ctx.episode}
- 可用集数: ${ctx.episodes.join(", ") || "无"}
- 生图通道: ${ctx.imageGenMode}
- 左侧面板: ${ctx.leftTab}
- 格子状态: ${ctx.filledCells}/${ctx.totalCells} 已有图片
- 提示词: ${ctx.hasPrompts ? "已加载" : "未加载"}
- 一致性: ${ctx.characterCount}角色 / ${ctx.sceneCount}场景 / ${ctx.propCount}道具
- 风格: ${ctx.hasStyle ? "已设置" : "未设置"}
- 生成中: ${ctx.isGenerating ? "是" : "否"}`;
}

// ── 导演意图分析：判断应调度哪个子智能体 ──

const INTENT_KEYWORDS: Record<AgentRole, string[]> = {
  director: [],
  story: ["剧本", "小说", "节拍", "拆解", "分集", "EP", "集数", "角色", "场景", "道具", "一致性", "提取", "人物", "背景设定", "世界观"],
  shot: ["分镜", "镜头", "宫格", "九宫格", "四宫格", "智能分镜", "提示词", "翻译", "运镜", "动态提示词", "景别", "特写", "中景", "远景"],
  image: ["生成", "生图", "图片", "超分", "放大", "4K", "风格", "画风", "色调", "重生", "删除图", "清除", "API", "GeminiTab", "即梦"],
};

export function inferAgent(userMessage: string): AgentRole {
  const scores: Record<AgentRole, number> = { director: 0, story: 0, shot: 0, image: 0 };

  for (const [role, keywords] of Object.entries(INTENT_KEYWORDS) as [AgentRole, string[]][]) {
    for (const kw of keywords) {
      if (userMessage.includes(kw)) scores[role] += 1;
    }
  }

  // 选得分最高的子智能体
  let best: AgentRole = "director";
  let bestScore = 0;
  for (const role of ["story", "shot", "image"] as AgentRole[]) {
    if (scores[role] > bestScore) {
      bestScore = scores[role];
      best = role;
    }
  }

  // 没有明确匹配 → 导演直接回复
  return bestScore > 0 ? best : "director";
}

// ── 获取智能体的系统提示词 ──

export function getAgentSystemPrompt(agent: AgentRole): string {
  switch (agent) {
    case "story": return buildStoryAgentPrompt();
    case "shot": return buildShotAgentPrompt();
    case "image": return buildImageAgentPrompt();
    case "director":
    default: return DIRECTOR_SYSTEM_PROMPT;
  }
}

// ── 调用 LLM（通过已有的 /api/llm 代理） ──

interface LLMSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider?: string;
}

export async function callLLM(
  settings: LLMSettings,
  systemPrompt: string,
  messages: ChatMessage[],
  userMessage: string,
  canvasContext: CanvasContext | null,
): Promise<{ content: string; agent: AgentRole }> {
  // 构建完整 prompt：system + 历史 + 当前用户消息（含画布上下文）
  const contextSnippet = buildContextSnippet(canvasContext);
  const fullUserMessage = `${userMessage}\n\n${contextSnippet}`;

  // 将历史消息转为 prompt（LLM API 只接受 prompt 字段）
  const historyParts: string[] = [];
  for (const msg of messages.slice(-10)) { // 最多保留最近10条
    const role = msg.role === "user" ? "用户" : `${AGENTS[msg.agent || "director"].icon} ${AGENTS[msg.agent || "director"].name}`;
    historyParts.push(`[${role}]: ${msg.content}`);
  }
  const historyText = historyParts.length > 0 ? `# 对话历史\n${historyParts.join("\n\n")}\n\n` : "";
  const prompt = `${historyText}[用户]: ${fullUserMessage}`;

  const res = await fetch("/api/llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      model: settings.model,
      provider: settings.provider,
      systemPrompt,
      prompt,
      maxTokens: 4096,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM 调用失败 (${res.status}): ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data.text || data.content || "";
  const agentRole = inferAgent(userMessage);

  return { content, agent: agentRole };
}

// ── 完整对话循环 ──

export async function chat(
  settings: LLMSettings,
  messages: ChatMessage[],
  userMessage: string,
): Promise<ChatMessage> {
  // 1. 获取画布上下文
  const ctx = await requestCanvasContext();

  // 2. 推断目标智能体
  const targetAgent = inferAgent(userMessage);

  // 3. 获取对应系统提示词
  const systemPrompt = getAgentSystemPrompt(targetAgent);

  // 4. 调用 LLM
  const { content } = await callLLM(settings, systemPrompt, messages, userMessage, ctx);

  // 5. 解析回复中的 [ACTIONS] 块
  const { cleanReply, actions: rawActions } = parseActionsFromReply(content);

  // 6. 构建 CanvasAction 数组
  const canvasActions: CanvasAction[] = rawActions.map((a) => ({
    id: genId(),
    type: a.type as CanvasAction["type"],
    params: a.params || {},
    status: "pending" as const,
  }));

  // 7. 验证操作类型是否合法
  const validTypes = new Set(ACTION_CATALOG.map((ac) => ac.type));
  for (const action of canvasActions) {
    if (!validTypes.has(action.type)) {
      action.status = "failed";
      action.result = `未知操作类型: ${action.type}`;
    }
  }

  // 8. 构建助手消息
  const assistantMsg: ChatMessage = {
    id: genId(),
    role: "assistant",
    content: cleanReply,
    agent: targetAgent,
    actions: canvasActions.length > 0 ? canvasActions : undefined,
    timestamp: Date.now(),
  };

  return assistantMsg;
}

// ── 执行消息中的待处理操作 ──

export async function executeActions(message: ChatMessage): Promise<ChatMessage> {
  if (!message.actions || message.actions.length === 0) return message;

  const updated = { ...message, actions: [...message.actions] };

  for (let i = 0; i < updated.actions.length; i++) {
    const action = updated.actions[i];
    if (action.status !== "pending") continue;

    // 标记为执行中
    updated.actions[i] = { ...action, status: "executing" };

    try {
      const result = await dispatchCanvasAction(action);
      updated.actions[i] = {
        ...action,
        status: result.success ? "completed" : "failed",
        result: result.result || result.error,
      };
    } catch (err) {
      updated.actions[i] = {
        ...action,
        status: "failed",
        result: err instanceof Error ? err.message : "执行异常",
      };
    }
  }

  return updated;
}
