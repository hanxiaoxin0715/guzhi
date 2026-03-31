"use client";

/**
 * ════════════════════════════════════════════════════════════
 * AgentStoryboardPanel — 智能体分镜面板
 * ════════════════════════════════════════════════════════════
 *
 * 嵌入到分镜流水线页面的"智能体分镜"标签下。
 * 参考 Toonflow 的多智能体编排架构：
 *   故事师（剧本解析）→ 大纲师（分集规划）→ 导演（分镜拆解）
 *
 * 产出物：自定义宫格提示词 → 推送到生图工作台 custom 模式
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Send,
  Loader,
  Trash2,
  Bot,
  Sparkles,
  Play,
  BookOpen,
  ArrowRight,
  Grid3X3,
  CheckCircle,
  XCircle,
  User,
  ChevronDown,
  ChevronUp,
  Brain,
  Clapperboard,
  Settings,
  Zap,
  FileText,
  Check,
  ShieldCheck,
} from "lucide-react";
import { saveScriptDB } from "../lib/scriptDB";

// ═══ 智能体角色定义 ═══
const AGENT_ROLES = {
  story: { name: "故事师", icon: "📖", color: "#8B5CF6", desc: "解析剧本结构、识别角色关系和叙事弧线" },
  outline: { name: "大纲师", icon: "📋", color: "#3B82F6", desc: "根据剧本规划分集方案和关键节拍" },
  director: { name: "导演", icon: "🎬", color: "#F59E0B", desc: "将大纲拆解为具体分镜画面描述" },
} as const;

type AgentRoleKey = keyof typeof AGENT_ROLES;

interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system";
  agent?: AgentRoleKey;
  content: string;
  timestamp: number;
  actions?: AgentAction[];
  thinking?: string;
}

interface AgentAction {
  type: string;
  status: "pending" | "executing" | "completed" | "failed";
  params?: Record<string, unknown>;
  result?: string;
}

// ═══ FC Action 类型（66 种） ═══
interface FCAction {
  type: "write_prompt" | "batch_rewrite" | "delete_shot" | "add_shot" | "reorder_shots"
    | "push_to_studio" | "set_grid_count" | "clear_all_shots" | "duplicate_shot" | "swap_shots" | "replace_shot" | "navigate"
    | "generate_grid" | "regenerate_cell" | "upscale_cell" | "batch_upscale" | "batch_generate"
    | "translate_prompt" | "batch_translate"
    | "ai_extract" | "set_style" | "add_consistency_item" | "toggle_style_ref"
    | "switch_grid_mode" | "switch_episode" | "switch_left_tab" | "switch_image_gen_mode" | "select_cell"
    | "analyze_script" | "switch_pipeline_tab" | "load_prompts"
    | "open_modal" | "clear_all_images" | "copy_prompt" | "generate_video"
    // ── Video 页（7种） ──
    | "save_video_state" | "clear_video_state" | "switch_video_ep" | "quick_relay"
    | "ai_video_prompt" | "export_dialogue" | "switch_video_model"
    // ── Pipeline 页（4种） ──
    | "run_pipeline" | "stop_pipeline" | "sync_to_studio" | "confirm_plan"
    // ── Seedance 页（3种） ──
    | "generate_seedance" | "set_seedance_params" | "ai_seedance_prompt"
    // ── Studio 补充（4种） ──
    | "generate_motion_prompts" | "translate_ref_prompt" | "delete_consistency_item" | "open_ref_bind"
    // ── 剧本/文件操作（3种） ──
    | "import_script" | "parse_script_to_shots" | "set_script_title"
    // ── EP 集数管理（3种） ──
    | "add_episode" | "remove_episode" | "rename_episode"
    // ── 分镜内容增强（4种） ──
    | "batch_write_prompts" | "insert_shot" | "move_shots_to_episode" | "merge_episodes"
    // ── 风格/一致性增强（3种） ──
    | "set_art_style" | "set_color_palette" | "batch_inject_style";
  cellIndex?: number;
  description?: string;
  prompt?: string;
  scene?: string;
  characters?: string[];
  instruction?: string;
  cells?: number[];
  from?: number;
  to?: number;
  gridCount?: number;
  indexA?: number;
  indexB?: number;
  target?: string;
  gridMode?: string;
  beatIdx?: number;
  episode?: string;
  tab?: string;
  mode?: string;
  category?: string;
  enabled?: boolean;
  // ── 新增字段 ──
  modelId?: string;
  ratio?: string;
  duration?: number;
  quality?: string;
  seedanceModel?: string;
  itemName?: string;
  // ── 剧本/EP/分镜增强字段 ──
  scriptContent?: string;
  scriptTitle?: string;
  newEpisode?: string;
  targetEpisode?: string;
  sourceEpisode?: string;
  position?: number;
  prompts?: { cellIndex: number; description?: string; prompt?: string; scene?: string; characters?: string[] }[];
  artStyle?: string;
  colorPalette?: string;
  styleSuffix?: string;
}

// ═══ 分镜结果 ═══
interface ShotResult {
  index: number;
  description: string;   // 中文画面描述
  prompt: string;         // 英文生图提示词
  scene?: string;
  characters?: string[];
}

// ═══ 分集结果 ═══
interface EpisodeResult {
  episode: string;        // ep01, ep02, ...
  title?: string;         // 集标题
  gridCount?: number;     // 该集格数
  shots: ShotResult[];
}

interface AgentStoryboardPanelProps {
  scriptContent: string;
  scriptTitle: string;
  hasScript: boolean;
}

// 消息 ID 生成
let _msgId = 0;
function genMsgId() { return `msg-${Date.now()}-${++_msgId}`; }

// 从 localStorage 读取 LLM 设置
function getLLMSettings() {
  try {
    const raw = localStorage.getItem("feicai-settings");
    if (!raw) return null;
    const s = JSON.parse(raw);
    return {
      apiKey: s["llm-key"] || "",
      baseUrl: s["llm-url"] || "https://api.geeknow.top/v1",
      model: s["llm-model"] || "gemini-2.5-pro",
      provider: s["llm-provider"] || "openAi",
    };
  } catch {
    return null;
  }
}

// ═══ 消息气泡组件 ═══
function MessageBubble({ msg }: { msg: AgentMessage }) {
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";
  const agent = msg.agent ? AGENT_ROLES[msg.agent] : null;
  const [showThinking, setShowThinking] = useState(false);

  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <span className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-surface)] px-3 py-1 rounded-full border border-[var(--border-default)]">
          {msg.content}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      {/* 头像 */}
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[12px]"
        style={{
          background: isUser ? "var(--gold-transparent)" : agent ? `${agent.color}20` : "var(--bg-surface)",
          border: `1px solid ${isUser ? "var(--gold-primary)" : agent?.color || "var(--border-default)"}`,
        }}
      >
        {isUser ? <User size={12} className="text-[var(--gold-primary)]" /> : agent?.icon || "🤖"}
      </div>

      {/* 内容 */}
      <div className={`flex flex-col gap-1 max-w-[85%] ${isUser ? "items-end" : "items-start"}`}>
        {!isUser && agent && (
          <span className="text-[10px] font-medium" style={{ color: agent.color }}>{agent.name}</span>
        )}

        {/* 思考过程 */}
        {msg.thinking && (
          <button onClick={() => setShowThinking(!showThinking)}
            className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition cursor-pointer">
            {showThinking ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            思考过程
          </button>
        )}
        {msg.thinking && showThinking && (
          <div className="text-[10px] text-[var(--text-muted)] bg-[#0A0A0A] border border-[var(--border-default)] rounded p-2 font-mono whitespace-pre-wrap max-h-[120px] overflow-auto">
            {msg.thinking}
          </div>
        )}

        {/* 消息文本 */}
        <div className={`px-3 py-2 rounded-lg text-[12px] leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-[var(--gold-transparent)] text-[var(--text-primary)] border border-[var(--gold-primary)]/30"
            : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-default)]"
        }`}>
          {msg.content}
        </div>

        {/* 操作卡片 */}
        {msg.actions && msg.actions.length > 0 && (
          <div className="flex flex-col gap-1 w-full">
            {msg.actions.map((action, i) => {
              // FC action 友好显示
              const actionLabels: Record<string, string> = {
                write_prompt: "✏️ 修改提示词",
                batch_rewrite: "📝 批量改写",
                delete_shot: "🗑️ 删除格子",
                add_shot: "➕ 新增格子",
                reorder_shots: "↔ 移动格子",
                push_to_studio: "📤 推送到工作台",
                set_grid_count: "🔢 设置格数",
                clear_all_shots: "🧹 清空分镜",
                duplicate_shot: "📋 复制格子",
                swap_shots: "🔀 交换格子",
                replace_shot: "🔄 替换格子",
                navigate: "🔗 页面跳转",
                pushToStudio: "📤 推送到工作台",
              };
              const label = actionLabels[action.type] || action.type;
              return (
                <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-page)] border border-[var(--border-default)] rounded text-[11px]">
                  {action.status === "pending" && <div className="w-3 h-3 rounded-full border-2 border-[var(--text-muted)]" />}
                  {action.status === "executing" && <Loader size={12} className="text-[var(--gold-primary)] animate-spin" />}
                  {action.status === "completed" && <CheckCircle size={12} className="text-emerald-400" />}
                  {action.status === "failed" && <XCircle size={12} className="text-red-400" />}
                  <span className="text-[var(--text-secondary)]">{label}</span>
                  {action.result && (
                    <span className={`ml-auto truncate max-w-[200px] ${action.status === "failed" ? "text-red-400" : "text-[var(--text-muted)]"}`}>
                      {action.result.slice(0, 80)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══ 持久化 Key ═══
const STORAGE_KEY = "feicai-agent-storyboard";
const AUTO_EXEC_KEY_PANEL = "feicai-panel-autoexec";

// FC Action 可读描述
const ACTION_LABELS: Record<string, string> = {
  write_prompt: "修改提示词", batch_rewrite: "批量改写", delete_shot: "删除格子",
  add_shot: "新增格子", reorder_shots: "移动格子", push_to_studio: "推送到工作台",
  set_grid_count: "设置宫格数", clear_all_shots: "清空分镜", duplicate_shot: "复制格子",
  swap_shots: "交换格子", replace_shot: "替换格子", navigate: "页面跳转",
  generate_grid: "生成宫格图", regenerate_cell: "重新生成", upscale_cell: "超分辨率",
  batch_upscale: "批量超分", batch_generate: "批量生成", translate_prompt: "翻译提示词",
  batch_translate: "批量翻译", ai_extract: "AI提取", set_style: "设置风格",
  add_consistency_item: "添加一致性", toggle_style_ref: "风格参考开关",
  switch_grid_mode: "切换模式", switch_episode: "切换集数", switch_left_tab: "切换面板",
  switch_image_gen_mode: "切换引擎", select_cell: "选中格子", analyze_script: "剧本分析",
  switch_pipeline_tab: "切换标签", load_prompts: "加载提示词", open_modal: "打开弹窗",
  clear_all_images: "清除图片", copy_prompt: "复制提示词", generate_video: "生成视频",
  // ── Video 页 ──
  save_video_state: "保存视频状态", clear_video_state: "清除视频数据",
  switch_video_ep: "切换视频集数", quick_relay: "尾帧接力",
  ai_video_prompt: "AI视频提示词", export_dialogue: "导出台词",
  switch_video_model: "切换视频模型",
  // ── Pipeline 页 ──
  run_pipeline: "运行流水线", stop_pipeline: "停止流水线",
  sync_to_studio: "同步到工作台", confirm_plan: "确认方案",
  // ── Seedance 页 ──
  generate_seedance: "生成Seedance", set_seedance_params: "设置Seedance参数",
  ai_seedance_prompt: "AI优化Seedance",
  // ── Studio 补充 ──
  generate_motion_prompts: "运动提示词", translate_ref_prompt: "翻译参考描述",
  delete_consistency_item: "删除一致性条目", open_ref_bind: "参考图绑定",
  // ── 剧本/文件操作 ──
  import_script: "导入剧本", parse_script_to_shots: "剧本拆分镜",
  set_script_title: "设置剧本标题",
  // ── EP 集数管理 ──
  add_episode: "新增集数", remove_episode: "删除集数", rename_episode: "重命名集数",
  // ── 分镜内容增强 ──
  batch_write_prompts: "批量写入提示词", insert_shot: "插入分镜",
  move_shots_to_episode: "移动分镜到集", merge_episodes: "合并集数",
  // ── 风格增强 ──
  set_art_style: "设置艺术风格", set_color_palette: "设置色彩方案",
  batch_inject_style: "批量注入风格",
};
function describeAction(a: FCAction): string {
  const label = ACTION_LABELS[a.type] || a.type;
  const parts = [label];
  if (a.cellIndex) parts.push(`格${a.cellIndex}`);
  if (a.cells?.length) parts.push(`格${a.cells.join(",")}`);
  if (a.gridMode) parts.push(a.gridMode);
  if (a.episode) parts.push(a.episode);
  if (a.target) parts.push(a.target);
  if (a.tab) parts.push(a.tab);
  if (a.gridCount) parts.push(`${a.gridCount}格`);
  if (a.instruction) parts.push(`「${a.instruction.slice(0, 20)}」`);
  if (a.indexA && a.indexB) parts.push(`格${a.indexA}↔格${a.indexB}`);
  if (a.from && a.to) parts.push(`格${a.from}→格${a.to}`);
  if (a.modelId) parts.push(a.modelId);
  if (a.ratio) parts.push(a.ratio);
  if (a.itemName) parts.push(a.itemName);
  return parts.join(" · ");
}

function loadAutoExecPanel(): boolean {
  try { return localStorage.getItem(AUTO_EXEC_KEY_PANEL) !== "false"; } catch { return true; }
}

function loadPersistedState(): { messages: AgentMessage[]; shotResults: ShotResult[]; customGridCount: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      messages: Array.isArray(data.messages) ? data.messages : [],
      shotResults: Array.isArray(data.shotResults) ? data.shotResults : [],
      customGridCount: typeof data.customGridCount === "number" ? data.customGridCount : 9,
    };
  } catch { return null; }
}

function persistState(messages: AgentMessage[], shotResults: ShotResult[], customGridCount: number) {
  try {
    // 只保留最近 200 条消息，避免 localStorage 过大
    const trimmed = messages.slice(-200);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: trimmed, shotResults, customGridCount }));
  } catch { /* quota exceeded — 静默忽略 */ }
}

// ═══ 主组件 ═══
export default function AgentStoryboardPanel({
  scriptContent,
  scriptTitle,
  hasScript,
}: AgentStoryboardPanelProps) {
  const [messages, setMessages] = useState<AgentMessage[]>(() => {
    const saved = loadPersistedState();
    return saved?.messages?.length ? saved.messages : [];
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [shotResults, setShotResults] = useState<ShotResult[]>(() => {
    const saved = loadPersistedState();
    return saved?.shotResults || [];
  });
  const [customGridCount, setCustomGridCount] = useState(() => {
    const saved = loadPersistedState();
    return saved?.customGridCount || 9;
  });
  const [episodeResults, setEpisodeResults] = useState<EpisodeResult[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // ── 确认门控 ──
  const [autoExecute, setAutoExecute] = useState(() => loadAutoExecPanel());
  const [pendingActions, setPendingActions] = useState<FCAction[] | null>(null);

  // 持久化到 localStorage（消息、分镜结果、格数变化时自动保存）
  useEffect(() => {
    persistState(messages, shotResults, customGridCount);
  }, [messages, shotResults, customGridCount]);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 初始化欢迎消息（仅首次无持久化数据时）
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{
        id: genMsgId(),
        role: "system",
        content: "自定义分镜系统已就绪 — 请导入剧本开始，或直接描述你想要的分镜",
        timestamp: Date.now(),
      }]);
    }
  }, [messages.length]);

  // ── 发送消息到 Agent ──
  const handleSend = useCallback(async (text?: string) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput("");

    const userMsg: AgentMessage = {
      id: genMsgId(),
      role: "user",
      content: msg,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const llmSettings = getLLMSettings();
      if (!llmSettings?.apiKey) {
        throw new Error("未配置 LLM API Key，请先到设置页面配置");
      }

      const res = await fetch("/api/director", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          scriptContext: scriptContent ? scriptContent.slice(0, 8000) : undefined,
          scriptTitle,
          mode: "agentStoryboard",
          customGridCount,
          llmSettings,
          currentShots: shotResults.length > 0 ? shotResults : undefined,
          history: messages.filter(m => m.role !== "system").slice(-10).map(m => ({
            role: m.role,
            content: m.content,
            agent: m.agent,
          })),
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `API 错误: ${res.status}`);
      }
      const data = await res.json();

      const assistantMsg: AgentMessage = {
        id: genMsgId(),
        role: "assistant",
        agent: data.agent || "director",
        content: data.reply || "（无回复）",
        timestamp: Date.now(),
        thinking: data.thinking,
        actions: data.actions?.map((a: { type: string; params?: Record<string, unknown> }) => ({
          ...a,
          status: "pending" as const,
        })),
      };
      setMessages(prev => [...prev, assistantMsg]);

      // 如果有分镜结果（完整重新生成），更新
      if (data.shots && Array.isArray(data.shots)) {
        setShotResults(data.shots);
        setEpisodeResults([]);  // 清除分集结果，避免混淆
      }

      // 如果有分集结果，更新
      if (data.episodes && Array.isArray(data.episodes) && data.episodes.length > 0) {
        setEpisodeResults(data.episodes);
        // 把第一集的 shots 作为当前显示
        const firstEp = data.episodes[0];
        if (firstEp?.shots) {
          setShotResults(firstEp.shots);
        }
      }

      // 如果有 FC actions（修改操作），支持确认门控
      if (data.actions && Array.isArray(data.actions) && data.actions.length > 0) {
        const actions = data.actions as FCAction[];
        if (autoExecute) {
          executeFCActions(actions);
        } else {
          setPendingActions(actions);
          setMessages(prev => [...prev, {
            id: genMsgId(), role: "system",
            content: `⏸ ${actions.length} 个操作待确认 — 请在下方卡片中确认或取消`,
            timestamp: Date.now(),
          }]);
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        id: genMsgId(),
        role: "assistant",
        agent: "director",
        content: `❌ 请求失败: ${err instanceof Error ? err.message : "未知错误"}\n\n请检查设置页面的 LLM API 配置是否正确。`,
        timestamp: Date.now(),
      }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, scriptContent, scriptTitle, customGridCount, messages]);

  // ── FC Action 执行器（53 种） ──
  const executeFCActions = useCallback((actions: FCAction[]) => {
    let updated = [...shotResults];
    const logs: string[] = [];

    for (const action of actions) {
      switch (action.type) {
        case "write_prompt": {
          const idx = (action.cellIndex || 1) - 1; // cellIndex 从1开始
          if (idx >= 0 && idx < updated.length) {
            if (action.description) updated[idx] = { ...updated[idx], description: action.description };
            if (action.prompt) updated[idx] = { ...updated[idx], prompt: action.prompt };
            if (action.scene) updated[idx] = { ...updated[idx], scene: action.scene };
            if (action.characters) updated[idx] = { ...updated[idx], characters: action.characters };
            logs.push(`✅ 格${action.cellIndex}: 提示词已更新`);
          } else {
            logs.push(`⚠ 格${action.cellIndex}: 索引超出范围（当前共${updated.length}格）`);
          }
          break;
        }
        case "batch_rewrite": {
          if (action.cells && action.cells.length > 0 && action.prompts && action.prompts.length > 0) {
            for (const p of action.prompts) {
              const idx = (p.cellIndex || 1) - 1;
              if (idx >= 0 && idx < updated.length) {
                updated[idx] = {
                  ...updated[idx],
                  ...(p.description ? { description: p.description } : {}),
                  ...(p.prompt ? { prompt: p.prompt } : {}),
                  ...(p.scene ? { scene: p.scene } : {}),
                  ...(p.characters ? { characters: p.characters } : {}),
                };
              }
            }
            logs.push(`✅ 批量改写: 已更新 ${action.prompts.length} 格`);
          } else if (action.cells && action.instruction) {
            for (const ci of action.cells) {
              const idx = ci - 1;
              if (idx >= 0 && idx < updated.length) {
                const existing = updated[idx].prompt || "";
                updated[idx] = { ...updated[idx], prompt: existing + ", " + action.instruction };
              }
            }
            logs.push(`✅ 批量改写: 「${action.instruction}」→ 格${action.cells.join(",")}`);
          }
          break;
        }
        case "delete_shot": {
          const idx = (action.cellIndex || 1) - 1;
          if (idx >= 0 && idx < updated.length) {
            const removed = updated[idx];
            updated = updated.filter((_, i) => i !== idx);
            updated = updated.map((s, i) => ({ ...s, index: i + 1 }));
            logs.push(`🗑 已删除格${action.cellIndex}（${removed.description?.slice(0, 20) || "..."}）`);
          }
          break;
        }
        case "add_shot": {
          const newShot: ShotResult = {
            index: updated.length + 1,
            description: action.description || "",
            prompt: action.prompt || "",
            scene: action.scene,
            characters: action.characters,
          };
          updated.push(newShot);
          logs.push(`➕ 新增格${newShot.index}：${newShot.description?.slice(0, 30) || newShot.prompt?.slice(0, 30) || "..."}`);
          break;
        }
        case "reorder_shots": {
          const from = (action.from || 1) - 1;
          const to = (action.to || 1) - 1;
          if (from >= 0 && from < updated.length && to >= 0 && to < updated.length && from !== to) {
            const [moved] = updated.splice(from, 1);
            updated.splice(to, 0, moved);
            updated = updated.map((s, i) => ({ ...s, index: i + 1 }));
            logs.push(`⇄ 格${action.from} → 格${action.to}`);
          }
          break;
        }
        case "push_to_studio": {
          // 优先推送分集结果
          if (episodeResults.length > 0) {
            pushEpisodesToStudio(episodeResults);
            logs.push(`📤 已推送 ${episodeResults.length} 集分镜到生图工作台`);
          } else if (updated.length > 0) {
            const prompts = updated.map(s => {
              if (s.prompt && s.description) return `${s.description}\n\n**[IMG]** ${s.prompt}`;
              return s.prompt || s.description || "";
            });
            const payload = { count: updated.length, prompts, source: "agent", timestamp: Date.now() };
            localStorage.setItem("feicai-custom-grid-push", JSON.stringify(payload));
            window.dispatchEvent(new CustomEvent("feicai-custom-grid-update", { detail: payload }));
            logs.push(`📤 已推送 ${updated.length} 格分镜到生图工作台`);
          } else {
            logs.push(`⚠ 当前没有分镜可推送`);
          }
          break;
        }
        case "set_grid_count": {
          const count = action.gridCount || 9;
          const clamped = Math.max(1, Math.min(25, count));
          setCustomGridCount(clamped);
          logs.push(`🔢 宫格数量已设置为 ${clamped}`);
          break;
        }
        case "clear_all_shots": {
          updated = [];
          logs.push(`🧹 已清空所有分镜`);
          break;
        }
        case "duplicate_shot": {
          const idx = (action.cellIndex || 1) - 1;
          if (idx >= 0 && idx < updated.length) {
            const copy = { ...updated[idx], index: updated.length + 1 };
            updated.push(copy);
            logs.push(`📋 已复制格${action.cellIndex} → 格${copy.index}`);
          } else {
            logs.push(`⚠ 格${action.cellIndex}: 索引超出范围`);
          }
          break;
        }
        case "swap_shots": {
          const a = (action.indexA || 1) - 1;
          const b = (action.indexB || 1) - 1;
          if (a >= 0 && a < updated.length && b >= 0 && b < updated.length && a !== b) {
            [updated[a], updated[b]] = [updated[b], updated[a]];
            updated = updated.map((s, i) => ({ ...s, index: i + 1 }));
            logs.push(`🔀 格${action.indexA} ↔ 格${action.indexB} 已交换`);
          } else {
            logs.push(`⚠ 交换失败: 索引 ${action.indexA}/${action.indexB} 无效`);
          }
          break;
        }
        case "replace_shot": {
          const idx = (action.cellIndex || 1) - 1;
          if (idx >= 0 && idx < updated.length) {
            updated[idx] = {
              index: idx + 1,
              description: action.description || "",
              prompt: action.prompt || "",
              scene: action.scene,
              characters: action.characters,
            };
            logs.push(`🔄 格${action.cellIndex} 已整体替换`);
          } else {
            logs.push(`⚠ 格${action.cellIndex}: 索引超出范围`);
          }
          break;
        }
        case "navigate": {
          const target = action.target || "studio";
          const routes: Record<string, string> = {
            studio: "/studio", video: "/video", pipeline: "/pipeline", settings: "/settings",
          };
          const route = routes[target] || `/${target}`;
          try {
            window.location.href = route;
            logs.push(`🔗 正在跳转到 ${target}...`);
          } catch {
            logs.push(`⚠ 跳转失败: ${target}`);
          }
          break;
        }

        // ═══ 以下为新增 FC Actions（23种） ═══

        case "generate_grid": {
          const mode = action.gridMode || "nine";
          const cmdMap: Record<string, string> = { nine: "generateNineGrid", four: "generateFourGrid", smartNine: "generateSmartNineGrid", custom: "generateNineGrid" };
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: cmdMap[mode] || "generateNineGrid", params: { beatIdx: action.beatIdx || 0 }, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🖼 ${mode} 宫格生成已启动`);
          break;
        }
        case "regenerate_cell": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "regenerateCell", params: { cellIndex: action.cellIndex || 1, prompt: action.prompt || "" }, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🔄 格${action.cellIndex || 1} 重新生成已启动`);
          break;
        }
        case "upscale_cell": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "upscaleCell", params: { cellIndex: action.cellIndex || 1 }, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🔍 格${action.cellIndex || 1} 超分已启动`);
          break;
        }
        case "batch_upscale": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "batchUpscale", params: {}, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🔍 批量超分已启动`);
          break;
        }
        case "batch_generate": {
          if (action.cells?.length) {
            for (const ci of action.cells) {
              window.dispatchEvent(new CustomEvent("director-command", {
                detail: { action: "regenerateCell", params: { cellIndex: ci }, requestId: `panel-${Date.now()}-${ci}` },
              }));
            }
            logs.push(`🖼 批量生成格 ${action.cells.join(",")} 已启动`);
          }
          break;
        }
        case "translate_prompt": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "translatePrompt", params: { cellIndex: action.cellIndex || 1 }, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🌐 格${action.cellIndex || 1} 翻译已启动`);
          break;
        }
        case "batch_translate": {
          const cellList = action.cells?.length ? action.cells : updated.map((_, i) => i + 1);
          for (const ci of cellList) {
            window.dispatchEvent(new CustomEvent("director-command", {
              detail: { action: "translatePrompt", params: { cellIndex: ci }, requestId: `panel-${Date.now()}-${ci}` },
            }));
          }
          logs.push(`🌐 批量翻译 ${cellList.length} 格已启动`);
          break;
        }
        case "ai_extract": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "aiExtract", params: {}, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🧠 AI 两阶段提取已启动`);
          break;
        }
        case "set_style": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "styleUpload", params: {}, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🎨 请在弹出的对话框中选择风格图片`);
          break;
        }
        case "add_consistency_item": {
          const cat = action.category || "characters";
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "addConsistencyItem", params: { category: cat }, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`➕ 已添加 ${cat === "characters" ? "角色" : cat === "scenes" ? "场景" : "道具"} 条目`);
          break;
        }
        case "toggle_style_ref": {
          logs.push(`🎨 风格参考图已${action.enabled ? "启用" : "禁用"}`);
          break;
        }
        case "switch_grid_mode": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "switchGridMode", params: { mode: action.gridMode || "nine" }, requestId: `panel-${Date.now()}` },
          }));
          const modeNames: Record<string, string> = { nine: "九宫格", four: "四宫格", smartNine: "智能分镜", custom: "自定义" };
          logs.push(`🔀 已切换到 ${modeNames[action.gridMode || "nine"] || action.gridMode} 模式`);
          break;
        }
        case "switch_episode": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "switchEpisode", params: { episode: action.episode || "ep01" }, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`📺 已切换到 ${action.episode || "ep01"}`);
          break;
        }
        case "switch_left_tab": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "switchLeftTab", params: { tab: action.tab || "prompts" }, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`📑 左侧面板已切换到 ${action.tab || "prompts"}`);
          break;
        }
        case "switch_image_gen_mode": {
          try {
            const raw = localStorage.getItem("feicai-settings");
            if (raw) { const s = JSON.parse(raw); s["image-gen-mode"] = action.mode || "jimeng"; localStorage.setItem("feicai-settings", JSON.stringify(s)); }
          } catch { /* */ }
          logs.push(`🔧 生图引擎已切换为 ${action.mode || "jimeng"}`);
          break;
        }
        case "select_cell": {
          window.dispatchEvent(new CustomEvent("feicai-select-cell", { detail: { cellIndex: action.cellIndex || 1 } }));
          logs.push(`👆 已选中格${action.cellIndex || 1}`);
          break;
        }
        case "analyze_script": {
          try { localStorage.setItem("feicai-pipeline-tab", "beatBreakdown"); } catch { /* */ }
          window.location.href = "/pipeline";
          logs.push(`📊 正在跳转到流水线进行剧本分析...`);
          break;
        }
        case "switch_pipeline_tab": {
          try { localStorage.setItem("feicai-pipeline-tab", action.tab || "agentStoryboard"); } catch { /* */ }
          logs.push(`📑 流水线标签已切换到 ${action.tab || "agentStoryboard"}`);
          break;
        }
        case "load_prompts": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "loadPrompts", params: { episode: action.episode || "" }, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`📄 正在加载 ${action.episode || "当前集"} 提示词`);
          break;
        }
        case "open_modal": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "openModal", params: { modal: action.tab || "characterLibrary" }, requestId: `panel-${Date.now()}` },
          }));
          const modalNames: Record<string, string> = { characterLibrary: "角色库", motionPrompt: "动态提示词", gridImport: "宫格导入", playStyle: "玩法选择" };
          logs.push(`📂 已打开 ${modalNames[action.tab || "characterLibrary"] || action.tab} 弹窗`);
          break;
        }
        case "clear_all_images": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "clearAllImages", params: {}, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🧹 已清除所有生成的图片`);
          break;
        }
        case "copy_prompt": {
          const ci = (action.cellIndex || 1) - 1;
          if (ci >= 0 && ci < updated.length) {
            try { navigator.clipboard.writeText(updated[ci].prompt || updated[ci].description || ""); } catch { /* */ }
            logs.push(`📋 格${action.cellIndex} 提示词已复制到剪贴板`);
          }
          break;
        }
        case "generate_video": {
          window.location.href = "/video";
          logs.push(`🎥 正在跳转到图生视频页面...`);
          break;
        }

        // ═══ Video 页操作（7种） ═══

        case "save_video_state": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "saveVideoState", params: {}, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`💾 视频状态保存已触发`);
          if (!window.location.pathname.includes("/video")) window.location.href = "/video";
          break;
        }
        case "clear_video_state": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "clearVideoState", params: {}, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🧹 视频数据清除已触发`);
          if (!window.location.pathname.includes("/video")) window.location.href = "/video";
          break;
        }
        case "switch_video_ep": {
          const ep = action.episode || "ep01";
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "switchVideoEp", params: { episode: ep }, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`📺 视频页已切换到 ${ep}`);
          if (!window.location.pathname.includes("/video")) window.location.href = "/video";
          break;
        }
        case "quick_relay": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "quickRelay", params: {}, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🔗 快捷尾帧接力已启动`);
          if (!window.location.pathname.includes("/video")) window.location.href = "/video";
          break;
        }
        case "ai_video_prompt": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "aiVideoPrompt", params: {}, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🤖 AI视频提示词生成已启动`);
          if (!window.location.pathname.includes("/video")) window.location.href = "/video";
          break;
        }
        case "export_dialogue": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "exportDialogue", params: {}, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`📝 台词文稿导出已启动`);
          if (!window.location.pathname.includes("/video")) window.location.href = "/video";
          break;
        }
        case "switch_video_model": {
          const mid = action.modelId || "";
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "switchVideoModel", params: { modelId: mid }, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🎬 视频模型已切换为 ${mid}`);
          break;
        }

        // ═══ Pipeline 页操作（4种） ═══

        case "run_pipeline": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "runPipeline", params: {}, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`▶ 分镜流水线已启动`);
          if (!window.location.pathname.includes("/pipeline")) window.location.href = "/pipeline";
          break;
        }
        case "stop_pipeline": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "stopPipeline", params: {}, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`⏹ 分镜流水线已停止`);
          break;
        }
        case "sync_to_studio": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "syncToStudio", params: {}, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`📤 正在同步到Studio工作台`);
          if (!window.location.pathname.includes("/pipeline")) window.location.href = "/pipeline";
          break;
        }
        case "confirm_plan": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "confirmPlan", params: {}, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`✅ 分镜方案确认已触发`);
          if (!window.location.pathname.includes("/pipeline")) window.location.href = "/pipeline";
          break;
        }

        // ═══ Seedance 页操作（3种） ═══

        case "generate_seedance": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "generateSeedance", params: {}, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🎞 Seedance视频生成已启动`);
          if (!window.location.pathname.includes("/seedance")) window.location.href = "/seedance";
          break;
        }
        case "set_seedance_params": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "setSeedanceParams", params: { ratio: action.ratio, duration: action.duration, quality: action.quality, model: action.seedanceModel }, requestId: `panel-${Date.now()}` },
          }));
          const parts2: string[] = [];
          if (action.ratio) parts2.push(`比例${action.ratio}`);
          if (action.duration) parts2.push(`时长${action.duration}s`);
          if (action.quality) parts2.push(action.quality);
          if (action.seedanceModel) parts2.push(action.seedanceModel);
          logs.push(`⚙ Seedance参数已设置: ${parts2.join(", ") || "已更新"}`);
          break;
        }
        case "ai_seedance_prompt": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "aiSeedancePrompt", params: {}, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🤖 Seedance AI提示词优化已启动`);
          if (!window.location.pathname.includes("/seedance")) window.location.href = "/seedance";
          break;
        }

        // ═══ Studio 补充操作（4种） ═══

        case "generate_motion_prompts": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "openModal", params: { modal: "motionPrompt" }, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🎭 运动提示词弹窗已打开`);
          if (!window.location.pathname.includes("/studio")) window.location.href = "/studio";
          break;
        }
        case "translate_ref_prompt": {
          const ci = action.cellIndex || 1;
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "translateRefPrompt", params: { cellIndex: ci }, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🌐 一致性参考描述翻译已启动`);
          break;
        }
        case "delete_consistency_item": {
          const cat = action.category || "characters";
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "deleteConsistencyItem", params: { category: cat, name: action.itemName || "" }, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🗑 已删除 ${cat === "characters" ? "角色" : cat === "scenes" ? "场景" : "道具"}: ${action.itemName || ""}`);
          break;
        }
        case "open_ref_bind": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "openRefBind", params: {}, requestId: `panel-${Date.now()}` },
          }));
          logs.push(`🔗 参考图绑定面板已打开`);
          if (!window.location.pathname.includes("/studio")) window.location.href = "/studio";
          break;
        }
        // ── 剧本/文件操作（3种） ──
        case "import_script": {
          if (action.scriptContent) {
            // 存入 localStorage 供后续使用
            localStorage.setItem("feicai-agent-script-context", action.scriptContent);
            if (action.scriptTitle) localStorage.setItem("feicai-agent-script-title", action.scriptTitle);
            // ★ 同步保存到剧本管理系统（IndexedDB），让流水线分析、AI提取等功能也能访问
            const _scriptId = `agent-${Date.now()}`;
            const _scriptTitle = action.scriptTitle || "智能体导入剧本";
            const _scriptContent = action.scriptContent;
            saveScriptDB({ id: _scriptId, title: _scriptTitle, desc: `由AI助手导入 (${_scriptContent.length}字)`, status: "active", content: _scriptContent }).then(() => {
              localStorage.setItem("feicai-pipeline-script-id", _scriptId);
            }).catch(() => { /* ignore */ });
            logs.push(`📄 已导入剧本「${_scriptTitle}」（${action.scriptContent.length}字）并同步到剧本库`);
          } else {
            logs.push(`⚠ import_script 缺少 scriptContent`);
          }
          break;
        }
        case "parse_script_to_shots": {
          // 使用已导入的剧本上下文，让 LLM 自动拆解为分镜格
          // 这里触发一次新的 LLM 调用，通过 agent 消息驱动
          const scriptCtx = localStorage.getItem("feicai-agent-script-context") || "";
          if (scriptCtx) {
            logs.push(`🎬 正在根据剧本拆解分镜...请等待 AI 完成分析`);
            // 用系统消息提示用户后续再发
            setMessages(prev => [...prev, {
              id: genMsgId(), role: "system",
              content: "💡 剧本已加载，AI 将自动拆解为分镜。如果分镜未自动生成，请发送「开始拆分镜」来触发。",
              timestamp: Date.now(),
            }]);
          } else {
            logs.push(`⚠ 尚未导入剧本，请先导入剧本文本`);
          }
          break;
        }
        case "set_script_title": {
          if (action.scriptTitle) {
            localStorage.setItem("feicai-agent-script-title", action.scriptTitle);
            logs.push(`📝 剧本标题已设置为: ${action.scriptTitle}`);
          }
          break;
        }
        // ── EP 集数管理（3种） ──
        case "add_episode": {
          const ep = action.newEpisode || action.episode || "";
          if (ep) {
            window.dispatchEvent(new CustomEvent("director-command", {
              detail: { action: "addEpisode", params: { episode: ep }, requestId: `panel-${Date.now()}` },
            }));
            logs.push(`➕ 已添加新集数: ${ep.toUpperCase()}`);
          }
          break;
        }
        case "remove_episode": {
          const ep = action.episode || "";
          if (ep) {
            window.dispatchEvent(new CustomEvent("director-command", {
              detail: { action: "removeEpisode", params: { episode: ep }, requestId: `panel-${Date.now()}` },
            }));
            logs.push(`🗑 已删除集数: ${ep.toUpperCase()}`);
          }
          break;
        }
        case "rename_episode": {
          const oldEp = action.episode || "";
          const newEp = action.newEpisode || "";
          if (oldEp && newEp) {
            window.dispatchEvent(new CustomEvent("director-command", {
              detail: { action: "renameEpisode", params: { episode: oldEp, newEpisode: newEp }, requestId: `panel-${Date.now()}` },
            }));
            logs.push(`✏ 已重命名 ${oldEp.toUpperCase()} → ${newEp.toUpperCase()}`);
          }
          break;
        }
        // ── 分镜内容增强（4种） ──
        case "batch_write_prompts": {
          if (action.prompts && action.prompts.length > 0) {
            for (const p of action.prompts) {
              const idx = (p.cellIndex || 1) - 1;
              if (idx >= 0 && idx < updated.length) {
                updated = [...updated];
                updated[idx] = {
                  ...updated[idx],
                  ...(p.description ? { description: p.description } : {}),
                  ...(p.prompt ? { prompt: p.prompt } : {}),
                  ...(p.scene ? { scene: p.scene } : {}),
                  ...(p.characters ? { characters: p.characters } : {}),
                };
              }
            }
            logs.push(`📝 已批量写入 ${action.prompts.length} 个格子的提示词`);
          }
          break;
        }
        case "insert_shot": {
          const pos = Math.max(0, Math.min((action.position || 1) - 1, updated.length));
          const newShot: ShotResult = {
            index: pos + 1,
            description: action.description || "",
            prompt: action.prompt || "",
            scene: action.scene,
            characters: action.characters,
          };
          updated = [...updated];
          updated.splice(pos, 0, newShot);
          // 重编号
          updated = updated.map((s, i) => ({ ...s, index: i + 1 }));
          logs.push(`📌 已在第${pos + 1}格插入新分镜`);
          break;
        }
        case "move_shots_to_episode": {
          const targetEp = action.targetEpisode || "";
          const cellsToMove = action.cells || [];
          if (targetEp && cellsToMove.length > 0) {
            // 提取要移动的分镜
            const movedShots = cellsToMove.map(c => updated[c - 1]).filter(Boolean);
            // 从当前列表移除
            const remaining = updated.filter((_, i) => !cellsToMove.includes(i + 1));
            updated = remaining.map((s, i) => ({ ...s, index: i + 1 }));
            // 通过 CustomEvent 把分镜推到目标 EP
            window.dispatchEvent(new CustomEvent("director-command", {
              detail: { action: "moveShotsToEpisode", params: { targetEpisode: targetEp, shots: movedShots }, requestId: `panel-${Date.now()}` },
            }));
            logs.push(`📦 已将 ${movedShots.length} 个分镜移至 ${targetEp.toUpperCase()}`);
          }
          break;
        }
        case "merge_episodes": {
          const src = action.sourceEpisode || "";
          const tgt = action.targetEpisode || "";
          if (src && tgt) {
            window.dispatchEvent(new CustomEvent("director-command", {
              detail: { action: "mergeEpisodes", params: { sourceEpisode: src, targetEpisode: tgt }, requestId: `panel-${Date.now()}` },
            }));
            logs.push(`🔀 已合并 ${src.toUpperCase()} 到 ${tgt.toUpperCase()}`);
          }
          break;
        }
        // ── 风格/一致性增强（3种） ──
        case "set_art_style": {
          if (action.artStyle) {
            window.dispatchEvent(new CustomEvent("director-command", {
              detail: { action: "setArtStyle", params: { artStyle: action.artStyle }, requestId: `panel-${Date.now()}` },
            }));
            logs.push(`🎨 艺术风格已设置为: ${action.artStyle}`);
          }
          break;
        }
        case "set_color_palette": {
          if (action.colorPalette) {
            window.dispatchEvent(new CustomEvent("director-command", {
              detail: { action: "setColorPalette", params: { colorPalette: action.colorPalette }, requestId: `panel-${Date.now()}` },
            }));
            logs.push(`🎨 色彩方案已设置为: ${action.colorPalette}`);
          }
          break;
        }
        case "batch_inject_style": {
          if (action.styleSuffix) {
            // 给所有分镜的 prompt 追加统一风格后缀
            updated = updated.map(s => ({
              ...s,
              prompt: s.prompt ? `${s.prompt}, ${action.styleSuffix}` : action.styleSuffix || "",
            }));
            logs.push(`🎨 已给所有分镜注入风格后缀: "${action.styleSuffix}"`);
          }
          break;
        }
      }
    }

    if (updated !== shotResults) {
      setShotResults(updated);
    }

    // 显示操作日志
    if (logs.length > 0) {
      setMessages(prev => [...prev, {
        id: genMsgId(),
        role: "system",
        content: `执行了 ${logs.length} 个操作：\n${logs.join("\n")}`,
        timestamp: Date.now(),
      }]);
    }
  }, [shotResults]);

  // ── 确认/取消 pending actions ──
  const confirmPendingActions = useCallback(() => {
    if (!pendingActions) return;
    executeFCActions(pendingActions);
    setMessages(prev => [...prev, {
      id: genMsgId(), role: "system",
      content: `✅ 已确认执行 ${pendingActions.length} 个操作`,
      timestamp: Date.now(),
    }]);
    setPendingActions(null);
  }, [pendingActions, executeFCActions]);

  const cancelPendingActions = useCallback(() => {
    setPendingActions(null);
    setMessages(prev => [...prev, {
      id: genMsgId(), role: "system",
      content: "❌ 已取消执行",
      timestamp: Date.now(),
    }]);
  }, []);

  const toggleAutoExecute = useCallback(() => {
    setAutoExecute(prev => {
      const next = !prev;
      try { localStorage.setItem(AUTO_EXEC_KEY_PANEL, String(next)); } catch { /* */ }
      return next;
    });
  }, []);

  // ── 推送分镜到Studio自定义宫格 ──
  const pushShotsToStudio = useCallback((shots: ShotResult[]) => {
    const prompts = shots.map(s => {
      if (s.prompt && s.description) return `${s.description}\n\n**[IMG]** ${s.prompt}`;
      return s.prompt || s.description || "";
    });

    // 通过 localStorage + CustomEvent 桥接到 Studio
    const payload = {
      count: shots.length,
      prompts,
      source: "agent",
      timestamp: Date.now(),
    };
    localStorage.setItem("feicai-custom-grid-push", JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent("feicai-custom-grid-update", { detail: payload }));

    setMessages(prev => [...prev, {
      id: genMsgId(),
      role: "system",
      content: `✅ 已推送 ${shots.length} 个分镜到生图工作台「自定义宫格」模式`,
      timestamp: Date.now(),
    }]);
  }, []);

  // ── 推送多集分镜到Studio ──
  const pushEpisodesToStudio = useCallback((episodes: EpisodeResult[]) => {
    if (episodes.length === 0) return;

    let totalShots = 0;
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    (async () => {
      for (let i = 0; i < episodes.length; i++) {
        const ep = episodes[i];
        const epId = ep.episode || `ep${String(i + 1).padStart(2, "0")}`;

        // 1. 确保集数存在（addEpisode）
        window.dispatchEvent(new CustomEvent("director-command", {
          detail: { action: "addEpisode", params: { episode: epId }, requestId: `push-ep-add-${epId}` },
        }));
        await delay(100);

        // 2. 切换到该集
        window.dispatchEvent(new CustomEvent("director-command", {
          detail: { action: "switchEpisode", params: { episode: epId }, requestId: `push-ep-switch-${epId}` },
        }));
        await delay(200);

        // 3. 推送该集的 shots
        const prompts = ep.shots.map(s => {
          if (s.prompt && s.description) return `${s.description}\n\n**[IMG]** ${s.prompt}`;
          return s.prompt || s.description || "";
        });
        const payload = {
          count: ep.shots.length,
          prompts,
          source: "agent",
          timestamp: Date.now(),
        };
        localStorage.setItem("feicai-custom-grid-push", JSON.stringify(payload));
        window.dispatchEvent(new CustomEvent("feicai-custom-grid-update", { detail: payload }));
        totalShots += ep.shots.length;
        await delay(300);
      }

      // 切回第一集
      const firstEp = episodes[0].episode || "ep01";
      window.dispatchEvent(new CustomEvent("director-command", {
        detail: { action: "switchEpisode", params: { episode: firstEp }, requestId: "push-ep-back" },
      }));

      setMessages(prev => [...prev, {
        id: genMsgId(),
        role: "system",
        content: `✅ 已推送 ${episodes.length} 集共 ${totalShots} 个分镜到生图工作台（${episodes.map(e => `${(e.episode || "").toUpperCase()}: ${e.shots.length}格`).join("、")}）`,
        timestamp: Date.now(),
      }]);
    })();
  }, []);

  // ── 一键解析剧本 ──
  const handleQuickParse = useCallback(() => {
    if (!scriptContent) return;
    const prompt = `请解析以下剧本，拆分为 ${customGridCount} 个分镜画面。每个分镜需要包含：中文画面描述、英文生图提示词、涉及的角色和场景。\n\n剧本标题：${scriptTitle}\n剧本内容（前8000字）：\n${scriptContent.slice(0, 8000)}`;
    handleSend(prompt);
  }, [scriptContent, scriptTitle, customGridCount, handleSend]);

  // ── 推送到Studio ──
  const handlePushToStudio = useCallback(() => {
    // 优先推送分集结果
    if (episodeResults.length > 0) {
      pushEpisodesToStudio(episodeResults);
      return;
    }
    if (shotResults.length === 0) return;
    pushShotsToStudio(shotResults);
  }, [shotResults, episodeResults, pushShotsToStudio, pushEpisodesToStudio]);

  // ── 清空对话 ──
  const handleClear = useCallback(() => {
    setMessages([{
      id: genMsgId(),
      role: "system",
      content: "对话已清空 — 请重新开始",
      timestamp: Date.now(),
    }]);
    setShotResults([]);
    setEpisodeResults([]);
    setPendingActions(null);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
  }, []);

  // Enter 发送
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="flex flex-col gap-4 flex-1">
      {/* ═══ 操作栏 ═══ */}
      <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-default)] flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[var(--text-muted)]">宫格数量:</span>
          <input
            type="number"
            min={1}
            max={25}
            value={customGridCount}
            onChange={(e) => setCustomGridCount(Math.max(1, Math.min(25, parseInt(e.target.value) || 9)))}
            className="w-14 px-2 py-1 text-[12px] text-[var(--text-primary)] bg-[var(--bg-page)] border border-[var(--border-default)] focus:border-[var(--gold-primary)] outline-none rounded text-center"
          />
        </div>

        <button
          onClick={handleQuickParse}
          disabled={loading || !hasScript}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--gold-primary)] hover:brightness-110 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed rounded"
        >
          {loading ? <Loader size={14} className="text-[#0A0A0A] animate-spin" /> : <Brain size={14} className="text-[#0A0A0A]" />}
          <span className="text-[12px] font-medium text-[#0A0A0A]">
            {loading ? "AI 解析中..." : "✦ 一键解析剧本"}
          </span>
        </button>

        {shotResults.length > 0 && (
          <button
            onClick={handlePushToStudio}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:brightness-110 transition cursor-pointer rounded"
          >
            <ArrowRight size={14} className="text-white" />
            <span className="text-[12px] font-medium text-white">推送到生图工作台 ({shotResults.length}格)</span>
          </button>
        )}

        <div className="flex-1" />

        <button onClick={handleClear}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-red-400 border border-red-400/40 hover:bg-red-400/10 transition cursor-pointer rounded">
          <Trash2 size={12} /> 清空对话
        </button>
        <button onClick={toggleAutoExecute}
          className={`flex items-center gap-1 px-2 py-1 text-[11px] border transition cursor-pointer rounded ${
            autoExecute ? "text-[var(--text-muted)] border-[var(--border-default)] hover:text-amber-400" : "text-amber-400 border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10"
          }`}
          title={autoExecute ? "当前：自动执行（点击切换为确认后执行）" : "当前：确认后执行（点击切换为自动执行）"}>
          {autoExecute ? <Zap size={12} /> : <ShieldCheck size={12} />}
          {autoExecute ? "自动" : "确认"}
        </button>
      </div>

      {/* ═══ 聊天区域 ═══ */}
      <div className="flex flex-col border border-[var(--border-default)] rounded-lg bg-[var(--bg-base)] overflow-hidden" style={{ minHeight: "400px", maxHeight: "600px" }}>
        {/* 智能体状态栏 */}
        <div className="flex items-center gap-4 px-4 py-2 border-b border-[var(--border-default)] bg-[#0D0D0D]">
          {(Object.entries(AGENT_ROLES) as [AgentRoleKey, typeof AGENT_ROLES[AgentRoleKey]][]).map(([key, agent]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-[12px]">{agent.icon}</span>
              <span className="text-[11px] font-medium" style={{ color: agent.color }}>{agent.name}</span>
            </div>
          ))}
          <div className="flex-1" />
          {hasScript && (
            <span className="text-[10px] text-[var(--text-muted)]">
              📄 {scriptTitle || "未选择剧本"} · {scriptContent ? `${Math.ceil(scriptContent.length / 1000)}K字` : "无内容"}
            </span>
          )}
          {!hasScript && (
            <span className="text-[10px] text-amber-400">⚠ 请先在左侧选择剧本</span>
          )}
        </div>

        {/* 消息列表 */}
        <div ref={scrollRef} className="flex-1 overflow-auto p-4 flex flex-col gap-3" style={{ minHeight: "300px" }}>
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
              <Loader size={14} className="text-[var(--gold-primary)] animate-spin" />
              智能体思考中...
            </div>
          )}
        </div>

        {/* 预设快捷提示 */}
        {messages.length <= 1 && (
          <div className="px-4 pb-2 flex flex-wrap gap-2">
            {[
              { icon: "📖", label: "解析剧本结构", prompt: "请分析这个剧本的叙事结构、主要角色和场景" },
              { icon: "🎬", label: "生成分镜画面", prompt: `请将剧本拆解为 ${customGridCount} 个关键分镜画面，每个画面都要有详细的画面描述和英文提示词` },
              { icon: "✏️", label: "全部翻译英文", prompt: "把所有格子的中文描述翻译成更专业的英文提示词，保持画面风格一致" },
              { icon: "🎨", label: "改写为赛博朋克", prompt: "把所有分镜的画面风格改写为赛博朋克风格，加入霓虹灯、雨夜、高科技元素" },
              { icon: "🗑️", label: "清理多余格子", prompt: "帮我分析哪些格子画面重复或不重要，可以删除精简" },
            ].map((hint, i) => (
              <button key={i} onClick={() => handleSend(hint.prompt)}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-[var(--bg-surface)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] text-[var(--text-secondary)] transition cursor-pointer rounded disabled:opacity-50">
                <span>{hint.icon}</span> {hint.label}
              </button>
            ))}
          </div>
        )}

        {/* 待确认操作卡片 */}
        {pendingActions && pendingActions.length > 0 && (
          <div className="mx-4 mb-2 border border-amber-500/40 bg-amber-500/5 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-amber-500/10 border-b border-amber-500/20">
              <span className="text-[12px] font-medium text-amber-400">⏸ {pendingActions.length} 个待执行操作</span>
              <div className="flex items-center gap-1.5">
                <button onClick={confirmPendingActions}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-green-600 hover:bg-green-500 text-white rounded transition cursor-pointer">
                  <Check size={12} /> 确认执行
                </button>
                <button onClick={cancelPendingActions}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-red-600/80 hover:bg-red-500 text-white rounded transition cursor-pointer">
                  <XCircle size={12} /> 取消
                </button>
              </div>
            </div>
            <div className="px-3 py-2 max-h-[150px] overflow-auto flex flex-col gap-1">
              {pendingActions.map((action, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                  <span className="text-amber-400 font-mono">{i + 1}.</span>
                  <span>{describeAction(action)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 输入框 */}
        <div className="flex items-end gap-2 px-3 py-2.5 border-t border-[var(--border-default)] bg-[#0D0D0D]">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasScript ? "输入指令或描述你想要的分镜效果..." : "请先选择剧本，或直接描述分镜需求..."}
            rows={1}
            className="flex-1 resize-none text-[12px] text-[var(--text-primary)] bg-[var(--bg-page)] border border-[var(--border-default)] focus:border-[var(--gold-primary)] outline-none px-3 py-2 rounded max-h-[100px]"
            style={{ minHeight: "36px" }}
          />
          <button onClick={() => handleSend()}
            disabled={loading || !input.trim()}
            className="flex items-center justify-center w-9 h-9 bg-[var(--gold-primary)] hover:brightness-110 transition cursor-pointer disabled:opacity-40 rounded shrink-0">
            {loading ? <Loader size={16} className="text-[#0A0A0A] animate-spin" /> : <Send size={16} className="text-[#0A0A0A]" />}
          </button>
        </div>
      </div>

      {/* ═══ 分镜预览（有结果时显示）═══ */}
      {episodeResults.length > 0 ? (
        /* ── 多集分镜预览 ── */
        <div className="flex flex-col gap-3 p-4 border border-[var(--border-default)] bg-[#0D0D0D] rounded">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clapperboard size={14} className="text-[var(--gold-primary)]" />
              <span className="text-[13px] font-medium text-[var(--text-primary)]">
                分集预览 · {episodeResults.length} 集 · 共 {episodeResults.reduce((s, ep) => s + ep.shots.length, 0)} 格
              </span>
            </div>
            <button onClick={handlePushToStudio}
              className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium bg-emerald-500 hover:brightness-110 text-white transition cursor-pointer rounded">
              <ArrowRight size={12} /> 推送全部集到工作台
            </button>
          </div>
          {episodeResults.map((ep, epIdx) => (
            <div key={epIdx} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 px-2 py-1.5 bg-[#151515] rounded border-l-2 border-[var(--gold-primary)]">
                <span className="text-[11px] font-bold text-[var(--gold-primary)]">{(ep.episode || `ep${String(epIdx + 1).padStart(2, "0")}`).toUpperCase()}</span>
                {ep.title && <span className="text-[11px] text-[var(--text-secondary)]">{ep.title}</span>}
                <span className="text-[10px] text-[var(--text-muted)]">· {ep.shots.length} 格</span>
                <button onClick={() => pushShotsToStudio(ep.shots)}
                  className="ml-auto flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--gold-primary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] rounded transition cursor-pointer">
                  <ArrowRight size={10} /> 单集推送
                </button>
              </div>
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(Math.ceil(Math.sqrt(ep.shots.length)), 5)}, 1fr)` }}>
                {ep.shots.map((shot, i) => (
                  <div key={i} className="flex flex-col gap-1 p-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded">
                    <div className="flex items-center gap-1">
                      <span className="px-1.5 py-0.5 text-[9px] font-bold text-[var(--gold-primary)] bg-[var(--gold-transparent)] rounded">格{i + 1}</span>
                      {shot.scene && <span className="text-[9px] text-[var(--text-muted)]">{shot.scene}</span>}
                    </div>
                    <span className="text-[10px] text-[var(--text-secondary)] line-clamp-3">{shot.description || shot.prompt}</span>
                    {shot.characters && shot.characters.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {shot.characters.map((c, ci) => (
                          <span key={ci} className="text-[8px] px-1 py-0.5 bg-purple-500/10 text-purple-400 rounded">{c}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : shotResults.length > 0 ? (
        /* ── 单集分镜预览 ── */
        <div className="flex flex-col gap-3 p-4 border border-[var(--border-default)] bg-[#0D0D0D] rounded">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clapperboard size={14} className="text-[var(--gold-primary)]" />
              <span className="text-[13px] font-medium text-[var(--text-primary)]">分镜预览 · {shotResults.length} 格</span>
            </div>
            <button onClick={handlePushToStudio}
              className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium bg-emerald-500 hover:brightness-110 text-white transition cursor-pointer rounded">
              <ArrowRight size={12} /> 推送到生图工作台
            </button>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(Math.ceil(Math.sqrt(shotResults.length)), 5)}, 1fr)` }}>
            {shotResults.map((shot, i) => (
              <div key={i} className="flex flex-col gap-1 p-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded">
                <div className="flex items-center gap-1">
                  <span className="px-1.5 py-0.5 text-[9px] font-bold text-[var(--gold-primary)] bg-[var(--gold-transparent)] rounded">格{i + 1}</span>
                  {shot.scene && <span className="text-[9px] text-[var(--text-muted)]">{shot.scene}</span>}
                </div>
                <span className="text-[10px] text-[var(--text-secondary)] line-clamp-3">{shot.description || shot.prompt}</span>
                {shot.characters && shot.characters.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {shot.characters.map((c, ci) => (
                      <span key={ci} className="text-[8px] px-1 py-0.5 bg-purple-500/10 text-purple-400 rounded">{c}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
