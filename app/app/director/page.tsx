"use client";

/**
 * ════════════════════════════════════════════════════════════
 * 智能体模式 — 主页面
 * ════════════════════════════════════════════════════════════
 *
 * 布局：左侧自定义宫格画布 + 右侧 Agent 聊天面板
 * 参考 Toonflow-app 的交互模式：
 * - 用户通过自然语言对话驱动分镜创作
 * - Agent 自动创建/编辑格子提示词 → 画布实时更新
 * - 内嵌生图功能（直接调用 /api/generate-image 等 Studio API）
 *
 * ★ 独立于现有 Studio 工作台，不影响 EP 模式功能 ★
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "../components/Sidebar";
import AgentCanvas from "../components/AgentCanvas";
import AgentChat from "../components/AgentChat";
import { useToast } from "../components/Toast";

import type { ChatMessage } from "../lib/director/types";
import type { CustomGridState, GridCell } from "../lib/director/grid-types";
import {
  createDefaultGridState,
  loadGridState,
  saveGridState,
  genGridCellId,
} from "../lib/director/grid-types";
import {
  chat,
  genId,
} from "../lib/director/orchestrator";

// ── 从 localStorage 读取 LLM 设置 ──
function getLLMSettings() {
  try {
    const raw = localStorage.getItem("feicai-settings");
    if (!raw) return null;
    const settings = JSON.parse(raw);
    return {
      apiKey: settings["llm-key"] || "",
      baseUrl: settings["llm-url"] || "https://api.geeknow.top/v1",
      model: settings["llm-model"] || "gemini-2.5-pro",
      provider: settings["llm-provider"] || "openAi",
    };
  } catch {
    return null;
  }
}

// ── 对话持久化 ──
const CHAT_STORAGE_KEY = "feicai-agent-chat";
function loadChatHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveChatHistory(messages: ChatMessage[]) {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-100)));
  } catch { /* ignore */ }
}

// ══════════════════════════════════════════════════════════
// 主页面组件
// ══════════════════════════════════════════════════════════

export default function AgentWorkspacePage() {
  const { toast } = useToast();
  const router = useRouter();

  // ── 状态 ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [gridState, setGridState] = useState<CustomGridState>(createDefaultGridState);
  const [loading, setLoading] = useState(false);
  const [settingsOk, setSettingsOk] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  // 引用以便回调函数中访问最新值
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const gridRef = useRef(gridState);
  gridRef.current = gridState;

  // ── 初始化 ──
  useEffect(() => {
    setMessages(loadChatHistory());
    setGridState(loadGridState());
    const settings = getLLMSettings();
    setSettingsOk(!!(settings?.apiKey));
  }, []);

  // ── 自动保存 grid ──
  useEffect(() => {
    saveGridState(gridState);
  }, [gridState]);

  // ── 处理 Agent 回复中的画布操作（直接本地处理，不走 CustomEvent 到 Studio） ──
  const applyAgentActions = useCallback((msg: ChatMessage): ChatMessage => {
    if (!msg.actions || msg.actions.length === 0) return msg;

    const updatedActions = [...msg.actions];
    const grid = { ...gridRef.current, cells: [...gridRef.current.cells] };

    for (let i = 0; i < updatedActions.length; i++) {
      const action = updatedActions[i];
      if (action.status !== "pending") continue;

      try {
        switch (action.type) {
          // ── 添加资产 ──
          case "addConsistencyItem": {
            const p = action.params as Record<string, string>;
            const itemType = (p.type || "character") as "character" | "scene" | "prop";
            const item = {
              id: genGridCellId(),
              name: p.name || "未命名",
              description: p.description || "",
              descriptionEN: p.descriptionEN || "",
              imageUrl: p.imageUrl || undefined,
              type: itemType,
            };
            if (itemType === "character") grid.characters = [...grid.characters, item];
            else if (itemType === "scene") grid.scenes = [...grid.scenes, item];
            else grid.props = [...grid.props, item];
            updatedActions[i] = { ...action, status: "completed", result: `已添加${itemType === "character" ? "角色" : itemType === "scene" ? "场景" : "道具"}：${item.name}` };
            break;
          }

          // ── 设置场景标题 ──
          case "switchEpisode": {
            const p = action.params as Record<string, string>;
            grid.sceneTitle = p.episode || p.title || "";
            updatedActions[i] = { ...action, status: "completed", result: `场景标题设为：${grid.sceneTitle}` };
            break;
          }

          // ── 更新格子提示词 ──
          case "updateCellPrompt": {
            const p = action.params as Record<string, unknown>;
            const cellIdx = (typeof p.cellIndex === "number" ? p.cellIndex : parseInt(String(p.cellIndex || "0"))) - 1;
            if (cellIdx >= 0 && cellIdx < grid.cells.length) {
              grid.cells[cellIdx] = {
                ...grid.cells[cellIdx],
                promptCN: (p.promptCN as string) || (p.prompt as string) || grid.cells[cellIdx].promptCN,
                promptEN: (p.promptEN as string) || grid.cells[cellIdx].promptEN,
                title: (p.title as string) || grid.cells[cellIdx].title,
                status: "prompt",
              };
              updatedActions[i] = { ...action, status: "completed", result: `已更新第${cellIdx + 1}格提示词` };
            } else {
              updatedActions[i] = { ...action, status: "failed", result: `格子索引 ${cellIdx + 1} 超出范围` };
            }
            break;
          }

          // ── 批量设置格子（Agent 一次创建多个格子） ──
          case "loadPrompts": {
            const p = action.params as Record<string, unknown>;
            const prompts = p.prompts as Array<{ title?: string; promptCN?: string; promptEN?: string }>;
            if (Array.isArray(prompts) && prompts.length > 0) {
              grid.cells = prompts.map((pr, idx) => ({
                id: genGridCellId(),
                index: idx + 1,
                title: pr.title || `镜头 ${idx + 1}`,
                promptCN: pr.promptCN || "",
                promptEN: pr.promptEN || "",
                imageUrl: "",
                status: (pr.promptCN?.trim() ? "prompt" : "empty") as GridCell["status"],
              }));
              updatedActions[i] = { ...action, status: "completed", result: `已创建 ${prompts.length} 个分镜格子` };
            } else {
              updatedActions[i] = { ...action, status: "failed", result: "prompts 数组为空" };
            }
            break;
          }

          // ── 删除格子 ──
          case "deleteCell": {
            const p = action.params as Record<string, unknown>;
            const delIdx = (typeof p.cellIndex === "number" ? p.cellIndex : parseInt(String(p.cellIndex || "0"))) - 1;
            if (delIdx >= 0 && delIdx < grid.cells.length) {
              grid.cells.splice(delIdx, 1);
              grid.cells = grid.cells.map((c, i) => ({ ...c, index: i + 1 }));
              updatedActions[i] = { ...action, status: "completed", result: `已删除第${delIdx + 1}格` };
            } else {
              updatedActions[i] = { ...action, status: "failed", result: "索引超出范围" };
            }
            break;
          }

          // ── 清除所有 ──
          case "clearAllImages": {
            grid.cells = grid.cells.map((c) => ({ ...c, imageUrl: "", status: c.promptCN ? "prompt" as const : "empty" as const }));
            updatedActions[i] = { ...action, status: "completed", result: "已清除所有图片" };
            break;
          }

          // ── 翻译提示词 ──
          case "translatePrompt": {
            updatedActions[i] = { ...action, status: "completed", result: "翻译需通过 Agent 对话完成" };
            break;
          }

          // ── 其他操作 ──
          default: {
            updatedActions[i] = { ...action, status: "completed", result: `智能体模式：${action.type} 已记录` };
            break;
          }
        }
      } catch (err) {
        updatedActions[i] = { ...action, status: "failed", result: err instanceof Error ? err.message : "执行异常" };
      }
    }

    setGridState(grid);
    return { ...msg, actions: updatedActions };
  }, []);

  // ── 发送消息 ──
  const handleSend = useCallback(async (text: string) => {
    const settings = getLLMSettings();
    if (!settings?.apiKey) {
      toast("请先在设置页面配置 LLM API Key", "error");
      return;
    }

    const userMsg: ChatMessage = {
      id: genId(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };

    const updated = [...messagesRef.current, userMsg];
    setMessages(updated);
    setLoading(true);

    try {
      const assistantMsg = await chat(settings, messagesRef.current, text);
      // 智能体模式中直接本地处理 actions
      const processed = applyAgentActions(assistantMsg);
      const all = [...updated, processed];
      setMessages(all);
      saveChatHistory(all);
    } catch (err) {
      const errMsg: ChatMessage = {
        id: genId(),
        role: "assistant",
        agent: "director",
        content: `出错了：${err instanceof Error ? err.message : "未知错误"}`,
        timestamp: Date.now(),
      };
      const all = [...updated, errMsg];
      setMessages(all);
      saveChatHistory(all);
    } finally {
      setLoading(false);
    }
  }, [toast, applyAgentActions]);

  // ── 手动执行操作 ──
  const handleExecuteActions = useCallback((msgId: string) => {
    const idx = messagesRef.current.findIndex((m) => m.id === msgId);
    if (idx === -1) return;
    const msg = messagesRef.current[idx];
    const processed = applyAgentActions(msg);
    const updatedMessages = [...messagesRef.current];
    updatedMessages[idx] = processed;
    setMessages(updatedMessages);
    saveChatHistory(updatedMessages);
  }, [applyAgentActions]);

  // ── 清除对话 ──
  const handleClear = useCallback(() => {
    setMessages([]);
    saveChatHistory([]);
    toast("对话已清除", "success");
  }, [toast]);

  // ── 单格生图 ──
  const handleGenerateCell = useCallback(async (cellId: string) => {
    const cell = gridRef.current.cells.find((c) => c.id === cellId);
    if (!cell || !cell.promptCN) return;

    setGridState((prev) => ({
      ...prev,
      cells: prev.cells.map((c) =>
        c.id === cellId ? { ...c, status: "generating" as const } : c
      ),
    }));
    setIsGenerating(true);

    try {
      const settings = getLLMSettings();
      const prompt = cell.promptEN || cell.promptCN;

      // 构建一致性前缀
      const charDescs = gridRef.current.characters.map((ch) =>
        `[${ch.name}]: ${ch.descriptionEN || ch.description}`
      ).join("\n");
      const fullPrompt = charDescs ? `${charDescs}\n\n${prompt}` : prompt;

      const rawSettings = localStorage.getItem("feicai-settings");
      const feicaiSettings = rawSettings ? JSON.parse(rawSettings) : {};

      const res = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: fullPrompt,
          apiKey: feicaiSettings["image-api-key"] || settings?.apiKey || "",
          baseUrl: feicaiSettings["image-api-url"] || settings?.baseUrl || "",
          model: feicaiSettings["image-model"] || "dall-e-3",
          size: "1792x1024",
          n: 1,
        }),
      });

      if (!res.ok) {
        throw new Error(`生图 API 返回 ${res.status}`);
      }

      const data = await res.json();
      const imageUrl = data.url || data.data?.[0]?.url || "";
      if (!imageUrl) throw new Error("未获取到图片 URL");

      setGridState((prev) => ({
        ...prev,
        cells: prev.cells.map((c) =>
          c.id === cellId ? { ...c, imageUrl, status: "completed" as const, error: undefined } : c
        ),
      }));
      toast(`第${cell.index}格生成完成`, "success");
    } catch (err) {
      setGridState((prev) => ({
        ...prev,
        cells: prev.cells.map((c) =>
          c.id === cellId
            ? { ...c, status: "failed" as const, error: err instanceof Error ? err.message : "生成失败" }
            : c
        ),
      }));
      toast(`第${cell.index}格生成失败`, "error");
    } finally {
      setIsGenerating(false);
    }
  }, [toast]);

  // ── 单格超分 ──
  const handleUpscaleCell = useCallback(async (cellId: string) => {
    const cell = gridRef.current.cells.find((c) => c.id === cellId);
    if (!cell || !cell.imageUrl) return;

    setGridState((prev) => ({
      ...prev,
      cells: prev.cells.map((c) =>
        c.id === cellId ? { ...c, status: "upscaling" as const } : c
      ),
    }));
    setIsGenerating(true);

    try {
      const res = await fetch("/api/upscale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: cell.imageUrl }),
      });
      if (!res.ok) throw new Error(`超分 API 返回 ${res.status}`);
      const data = await res.json();
      const upscaledUrl = data.url || data.data?.[0]?.url || cell.imageUrl;

      setGridState((prev) => ({
        ...prev,
        cells: prev.cells.map((c) =>
          c.id === cellId ? { ...c, imageUrl: upscaledUrl, status: "upscaled" as const } : c
        ),
      }));
      toast(`第${cell.index}格超分完成`, "success");
    } catch {
      setGridState((prev) => ({
        ...prev,
        cells: prev.cells.map((c) =>
          c.id === cellId ? { ...c, status: "completed" as const, error: "超分失败" } : c
        ),
      }));
      toast("超分失败", "error");
    } finally {
      setIsGenerating(false);
    }
  }, [toast]);

  // ── 一键全部生图 ──
  const handleGenerateAll = useCallback(async () => {
    const cells = gridRef.current.cells.filter((c) => c.promptCN.trim() && c.status !== "completed" && c.status !== "upscaled");
    if (cells.length === 0) {
      toast("没有待生成的格子", "error");
      return;
    }
    for (const cell of cells) {
      await handleGenerateCell(cell.id);
    }
  }, [handleGenerateCell, toast]);

  // ── Grid 状态变更 ──
  const handleGridStateChange = useCallback((newState: CustomGridState) => {
    setGridState(newState);
  }, []);

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <div className="flex flex-col flex-1 h-full min-w-0">
        {/* ── TopBar ── */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-[var(--border-default)] shrink-0 bg-[#0A0A0A]">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: "#1A1500", border: "1px solid #C9A96240" }}>
              <span className="text-[12px]">🤖</span>
              <span className="text-[12px] font-medium text-[var(--gold-primary)]">智能体模式</span>
            </div>
            <span className="text-[11px] text-[var(--text-muted)]">
              AI 驱动的自由分镜创作 · {gridState.cells.length} 格 · {messages.length} 条消息
            </span>
          </div>
          <div className="flex items-center gap-2">
            {gridState.style && (
              <span className="text-[10px] text-[var(--text-secondary)] px-2 py-0.5 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded">
                🎨 {gridState.style}
              </span>
            )}
            <span className="text-[10px] text-[var(--text-muted)]">
              {gridState.characters.length}角色 · {gridState.scenes.length}场景 · {gridState.props.length}道具
            </span>
          </div>
        </div>

        {/* ── 主体：左画布 + 右聊天 ── */}
        <div className="flex flex-1 min-h-0">
          {/* 左侧：自定义宫格画布 */}
          <div className="flex-1 min-w-0 border-r border-[var(--border-default)]">
            <AgentCanvas
              gridState={gridState}
              onGridStateChange={handleGridStateChange}
              onGenerateCell={handleGenerateCell}
              onUpscaleCell={handleUpscaleCell}
              onGenerateAll={handleGenerateAll}
              isGenerating={isGenerating}
            />
          </div>

          {/* 右侧：Agent 聊天面板 */}
          <div className="w-[380px] shrink-0">
            <AgentChat
              messages={messages}
              loading={loading}
              onSend={handleSend}
              onExecuteActions={handleExecuteActions}
              onClear={handleClear}
              settingsOk={settingsOk}
              onGoSettings={() => router.push("/settings")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
