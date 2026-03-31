"use client";

/**
 * ════════════════════════════════════════════════════════════
 * AgentFAB — 智能体悬浮聊天窗口（可拖拽 + 增强UI）
 * ════════════════════════════════════════════════════════════
 *
 * 全局悬浮按钮 + 展开为完整聊天面板
 * 使用 /api/director agentStoryboard 模式（与 AgentStoryboardPanel 同源）
 * 支持 35 种 FC Action
 * 支持拖拽移动位置 + 自适应输入框 + 图片上传 + 可调大小
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { readFileWithEncoding } from "../lib/fileEncoding";
import {
  Bot,
  X,
  Send,
  Loader,
  ChevronRight,
  Trash2,
  User,
  Minimize2,
  Maximize2,
  GripVertical,
  ImagePlus,
  Maximize,
  Check,
  XCircle,
  ShieldCheck,
  Zap,
  Paperclip,
  FileText,
} from "lucide-react";

// ═══ 类型定义 ═══
interface FabMessage {
  id: string;
  role: "user" | "assistant" | "system";
  agent?: "story" | "outline" | "director";
  content: string;
  timestamp: number;
  images?: string[]; // base64 data URL 图片
  files?: { name: string; preview: string }[]; // 文件附件预览
}

// 分镜数据（与 AgentStoryboardPanel 同构）
interface ShotResult {
  index: number;
  description?: string;
  prompt?: string;
  scene?: string;
  characters?: string[];
}

// 分集数据
interface EpisodeResult {
  episode: string;
  title?: string;
  gridCount?: number;
  shots: ShotResult[];
}

// FC Action（与 route.ts 53种 action 对齐）
interface FCAction {
  type: "write_prompt" | "batch_rewrite" | "delete_shot" | "add_shot" | "reorder_shots"
    | "push_to_studio" | "set_grid_count" | "clear_all_shots" | "duplicate_shot"
    | "swap_shots" | "replace_shot" | "navigate"
    | "generate_grid" | "regenerate_cell" | "upscale_cell" | "batch_upscale" | "batch_generate"
    | "translate_prompt" | "batch_translate"
    | "ai_extract" | "set_style" | "add_consistency_item" | "toggle_style_ref"
    | "switch_grid_mode" | "switch_episode" | "switch_left_tab" | "switch_image_gen_mode" | "select_cell"
    | "analyze_script" | "switch_pipeline_tab" | "load_prompts"
    | "open_modal" | "clear_all_images" | "copy_prompt" | "generate_video"
    // Video 页操作
    | "save_video_state" | "clear_video_state" | "switch_video_ep" | "quick_relay"
    | "ai_video_prompt" | "export_dialogue" | "switch_video_model"
    // Pipeline 页操作
    | "run_pipeline" | "stop_pipeline" | "sync_to_studio" | "confirm_plan"
    // Seedance 页操作
    | "generate_seedance" | "set_seedance_params" | "ai_seedance_prompt"
    // Studio 补充
    | "generate_motion_prompts" | "translate_ref_prompt" | "delete_consistency_item" | "open_ref_bind"
    // 剧本/文件操作
    | "import_script" | "parse_script_to_shots" | "set_script_title"
    // EP 集数管理
    | "add_episode" | "remove_episode" | "rename_episode"
    // 分镜内容增强
    | "batch_write_prompts" | "insert_shot" | "move_shots_to_episode" | "merge_episodes"
    // 风格增强
    | "set_art_style" | "set_color_palette" | "batch_inject_style"
    // EP 直写
    | "write_prompts_to_episode";
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
  modelId?: string;
  ratio?: string;
  duration?: string;
  quality?: string;
  seedanceModel?: string;
  itemName?: string;
  // 新增字段（剧本/EP/风格）
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

// 角色颜色
const AGENT_COLORS: Record<string, { name: string; icon: string; color: string }> = {
  story: { name: "故事师", icon: "📖", color: "#8B5CF6" },
  outline: { name: "大纲师", icon: "📋", color: "#3B82F6" },
  director: { name: "导演", icon: "🎬", color: "#F59E0B" },
};

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

// 持久化
const FAB_STORAGE_KEY = "feicai-fab-chat";
function loadFabMessages(): FabMessage[] {
  try {
    const raw = localStorage.getItem(FAB_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveFabMessages(msgs: FabMessage[]) {
  try {
    localStorage.setItem(FAB_STORAGE_KEY, JSON.stringify(msgs.slice(-100)));
  } catch { /* quota */ }
}

let _fabMsgId = 0;
function genId() { return `fab-${Date.now()}-${++_fabMsgId}`; }

// 不在以下页面显示
const HIDDEN_ROUTES = ["/settings"];

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
  // Video 页
  save_video_state: "保存视频状态", clear_video_state: "清除视频数据",
  switch_video_ep: "切换视频集数", quick_relay: "尾帧接力",
  ai_video_prompt: "AI视频提示词", export_dialogue: "导出台词",
  switch_video_model: "切换视频模型",
  // Pipeline 页
  run_pipeline: "启动流水线", stop_pipeline: "停止流水线",
  sync_to_studio: "同步到工作台", confirm_plan: "确认分镜方案",
  // Seedance 页
  generate_seedance: "Seedance生成", set_seedance_params: "设置Seedance参数",
  ai_seedance_prompt: "AI优化Seedance提示词",
  // Studio 补充
  generate_motion_prompts: "生成运动提示词", translate_ref_prompt: "翻译参考描述",
  delete_consistency_item: "删除一致性条目", open_ref_bind: "绑定参考图",
  // 剧本/文件操作
  import_script: "导入剧本", parse_script_to_shots: "剧本拆分镜",
  set_script_title: "设置剧本标题",
  // EP 集数管理
  add_episode: "新增集数", remove_episode: "删除集数", rename_episode: "重命名集数",
  // 分镜内容增强
  batch_write_prompts: "批量写入提示词", insert_shot: "插入分镜",
  move_shots_to_episode: "移动分镜到集", merge_episodes: "合并集数",
  // 风格增强
  set_art_style: "设置艺术风格", set_color_palette: "设置色彩方案",
  batch_inject_style: "批量注入风格",
  write_prompts_to_episode: "写入EP提示词",
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

// autoExecute 持久化
const AUTO_EXEC_KEY = "feicai-fab-autoexec";
function loadAutoExec(): boolean {
  try { return localStorage.getItem(AUTO_EXEC_KEY) !== "false"; } catch { return true; }
}

// FAB 位置持久化
const FAB_POS_KEY = "feicai-fab-pos";
function loadFabPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(FAB_POS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveFabPos(pos: { x: number; y: number }) {
  try { localStorage.setItem(FAB_POS_KEY, JSON.stringify(pos)); } catch { /* */ }
}

export default function AgentFAB() {
  const router = useRouter();
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState<FabMessage[]>(() => loadFabMessages());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [shots, setShots] = useState<ShotResult[]>([]);
  const [episodeResults, setEpisodeResults] = useState<EpisodeResult[]>([]);
  // ── FAB 动态状态 ──
  type FabStatus = "idle" | "thinking" | "success" | "error";
  const [fabStatus, setFabStatus] = useState<FabStatus>("idle");
  const fabStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // ── 确认门控 ──
  const [autoExecute, setAutoExecute] = useState(() => loadAutoExec());
  const [pendingActions, setPendingActions] = useState<FCAction[] | null>(null);
  const [pendingShots, setPendingShots] = useState<ShotResult[] | null>(null); // pending 时暂存的 shots 快照
  // ── 图片上传 ──
  const [uploadImages, setUploadImages] = useState<string[]>([]); // base64 data URLs
  const fileInputRef = useRef<HTMLInputElement>(null);
  // ── 文件附件 ──
  const [uploadFiles, setUploadFiles] = useState<{ name: string; content: string }[]>([]);
  const textFileInputRef = useRef<HTMLInputElement>(null);
  // ── 窗口大小 ──
  type ChatSize = "normal" | "large" | "fullscreen";
  const [chatSize, setChatSize] = useState<ChatSize>("normal");
  const CHAT_SIZES: Record<ChatSize, { w: number; h: number; msgMin: number; msgMax: number }> = {
    normal: { w: 520, h: 720, msgMin: 350, msgMax: 520 },
    large: { w: 680, h: 860, msgMin: 420, msgMax: 660 },
    fullscreen: { w: Math.min(960, typeof window !== "undefined" ? window.innerWidth - 80 : 960), h: typeof window !== "undefined" ? window.innerHeight - 100 : 900, msgMin: 500, msgMax: 2000 },
  };
  const sizeConfig = CHAT_SIZES[chatSize];

  // ═══ 拖拽逻辑（高性能：拖拽中用 DOM 直接操作，释放时同步 state）═══
  // position 表示 FAB 按钮的 bottom/right 偏移（px）
  const [fabPos, setFabPos] = useState<{ x: number; y: number }>({ x: 24, y: 24 });
  const fabBtnRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    startPosX: number;
    startPosY: number;
    moved: boolean;
    currentX: number;
    currentY: number;
  }>({ dragging: false, startX: 0, startY: 0, startPosX: 0, startPosY: 0, moved: false, currentX: 24, currentY: 24 });

  // 加载保存的位置
  useEffect(() => {
    const saved = loadFabPos();
    if (saved) {
      setFabPos(saved);
      dragRef.current.currentX = saved.x;
      dragRef.current.currentY = saved.y;
    }
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startPosX: dragRef.current.currentX,
      startPosY: dragRef.current.currentY,
      moved: false,
      currentX: dragRef.current.currentX,
      currentY: dragRef.current.currentY,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.dragging) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    // 超过 5px 才算移动（避免误触）
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) d.moved = true;
    if (!d.moved) return;
    // right 减去 dx（向右拖 dx>0 → right 变小），bottom 减去 dy
    const newX = Math.max(8, Math.min(window.innerWidth - 64, d.startPosX - dx));
    const newY = Math.max(8, Math.min(window.innerHeight - 64, d.startPosY - dy));
    d.currentX = newX;
    d.currentY = newY;
    // 直接操作 DOM 避免 React 重渲染，保证拖拽流畅
    if (fabBtnRef.current) {
      fabBtnRef.current.style.right = newX + "px";
      fabBtnRef.current.style.bottom = newY + "px";
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    d.dragging = false;
    if (d.moved) {
      // 拖拽结束：一次性同步到 state + 持久化
      const pos = { x: d.currentX, y: d.currentY };
      setFabPos(pos);
      saveFabPos(pos);
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  // textarea 自适应高度
  const autoResizeTextarea = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  useEffect(() => { autoResizeTextarea(); }, [input, autoResizeTextarea]);

  // ── 图片上传处理 ──
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const promises = Array.from(files).slice(0, 4).map(file => new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    }));
    Promise.all(promises).then(dataUrls => {
      setUploadImages(prev => [...prev, ...dataUrls].slice(0, 4));
    });
    // 重置 input 以允许重复选择同一文件
    e.target.value = "";
  }, []);

  const removeUploadImage = useCallback((idx: number) => {
    setUploadImages(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const removeUploadFile = useCallback((idx: number) => {
    setUploadFiles(prev => prev.filter((_, i) => i !== idx));
  }, []);

  // readFileWithEncoding 已提取到 app/lib/fileEncoding.ts（支持 UTF-8/UTF-16/GBK/BOM 检测）

  /** 文件导入处理（txt/md/csv/json） */
  const handleTextFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    for (const file of Array.from(files).slice(0, 3)) {
      try {
        const content = await readFileWithEncoding(file);
        setUploadFiles(prev => [...prev, { name: file.name, content: content.slice(0, 30000) }].slice(0, 3));
      } catch { /* 忽略无法读取的文件 */ }
    }
    e.target.value = "";
  }, []);

  /** 粘贴处理（支持图片/文件） */
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    let hasImage = false;
    for (const item of Array.from(items)) {
      // 粘贴图片
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        hasImage = true;
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => {
          setUploadImages(prev => [...prev, reader.result as string].slice(0, 4));
        };
        reader.readAsDataURL(file);
      }
      // 粘贴文件（非图片）
      if (item.kind === "file" && !item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (["txt", "md", "csv", "json", "text"].includes(ext || "")) {
          readFileWithEncoding(file).then(content => {
            setUploadFiles(prev => [...prev, { name: file.name, content: content.slice(0, 30000) }].slice(0, 3));
          });
        }
      }
    }
    // 纯文本粘贴不拦截，让 textarea 默认处理
    if (hasImage) return;
  }, [readFileWithEncoding]);

  // ── 窗口大小切换 ──
  const cycleChatSize = useCallback(() => {
    setChatSize(prev => prev === "normal" ? "large" : prev === "large" ? "fullscreen" : "normal");
  }, []);

  // 展开时聚焦 + 清未读
  useEffect(() => {
    if (expanded && !minimized) {
      setTimeout(() => inputRef.current?.focus(), 150);
      setHasUnread(false);
    }
  }, [expanded, minimized]);

  // 自动滚动 — 仅新消息时滚到底部，重新打开面板时保留滚动位置
  const prevMsgCountRef = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      // 有新消息到达 → 滚到底部
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevMsgCountRef.current = messages.length;
  }, [messages]);

  // 持久化
  useEffect(() => { saveFabMessages(messages); }, [messages]);

  // 欢迎消息
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{ id: genId(), role: "system", content: "✨ 飞彩 AI 助手已就绪", timestamp: Date.now() }]);
    }
  }, [messages.length]);

  // 隐藏路由（仅计算标志，不能 early return，否则跳过后续 hooks 违反 Rules of Hooks）
  const isHidden = HIDDEN_ROUTES.some(r => pathname === r || pathname.startsWith(r + "/"));

  // ── 推送分镜到 Studio 自定义宫格 ──
  const pushShotsToStudio = (shotsArr: ShotResult[]) => {
    if (shotsArr.length === 0) return;
    const prompts = shotsArr.map(s => {
      if (s.prompt && s.description) return `${s.description}\n\n**[IMG]** ${s.prompt}`;
      return s.prompt || s.description || "";
    });
    const payload = { count: shotsArr.length, prompts, source: "agent", timestamp: Date.now() };
    localStorage.setItem("feicai-custom-grid-push", JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent("feicai-custom-grid-update", { detail: payload }));
  };

  // ── 推送多集分镜到 Studio ──
  const pushEpisodesToStudio = (episodes: EpisodeResult[]) => {
    if (episodes.length === 0) return;
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
    let totalShots = 0;

    (async () => {
      for (let i = 0; i < episodes.length; i++) {
        const ep = episodes[i];
        const epId = ep.episode || `ep${String(i + 1).padStart(2, "0")}`;

        // 1. 确保集数存在
        window.dispatchEvent(new CustomEvent("director-command", {
          detail: { action: "addEpisode", params: { episode: epId }, requestId: `fab-ep-add-${epId}` },
        }));
        await delay(100);

        // 2. 切换到该集
        window.dispatchEvent(new CustomEvent("director-command", {
          detail: { action: "switchEpisode", params: { episode: epId }, requestId: `fab-ep-switch-${epId}` },
        }));
        await delay(200);

        // 3. 推送该集的 shots
        const prompts = ep.shots.map(s => {
          if (s.prompt && s.description) return `${s.description}\n\n**[IMG]** ${s.prompt}`;
          return s.prompt || s.description || "";
        });
        const payload = { count: ep.shots.length, prompts, source: "agent", timestamp: Date.now() };
        localStorage.setItem("feicai-custom-grid-push", JSON.stringify(payload));
        window.dispatchEvent(new CustomEvent("feicai-custom-grid-update", { detail: payload }));
        totalShots += ep.shots.length;
        await delay(300);
      }

      // 切回第一集
      const firstEp = episodes[0].episode || "ep01";
      window.dispatchEvent(new CustomEvent("director-command", {
        detail: { action: "switchEpisode", params: { episode: firstEp }, requestId: "fab-ep-back" },
      }));

      setMessages(prev => [...prev, {
        id: genId(), role: "system",
        content: `✅ 已推送 ${episodes.length} 集共 ${totalShots} 个分镜到生图工作台`,
        timestamp: Date.now(),
      }]);
    })();
  };

  // ── 执行 FC Actions（35种） ──
  const executeFCActions = (actions: FCAction[], currentShots: ShotResult[]): { updated: ShotResult[]; logs: string[] } => {
    let updated = [...currentShots];
    const logs: string[] = [];

    for (const action of actions) {
      switch (action.type) {
        case "write_prompt": {
          const idx = (action.cellIndex || 1) - 1;
          if (idx >= 0 && idx < updated.length) {
            if (action.description) updated[idx] = { ...updated[idx], description: action.description };
            if (action.prompt) updated[idx] = { ...updated[idx], prompt: action.prompt };
            if (action.scene) updated[idx] = { ...updated[idx], scene: action.scene };
            if (action.characters) updated[idx] = { ...updated[idx], characters: action.characters };
            logs.push(`✅ 格${action.cellIndex}: 提示词已更新`);
          } else {
            logs.push(`⚠ 格${action.cellIndex}: 索引超出范围（共${updated.length}格）`);
          }
          break;
        }
        case "batch_rewrite": {
          if (action.cells && action.cells.length > 0 && action.prompts && action.prompts.length > 0) {
            // 有具体 prompts → 按 prompts 精确改写
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
            // 仅有 instruction → 追加风格/指令后缀到 prompt
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
            updated = updated.filter((_, i) => i !== idx).map((s, i) => ({ ...s, index: i + 1 }));
            logs.push(`🗑 已删除格${action.cellIndex}（${removed.description?.slice(0, 20) || "..."}）`);
          }
          break;
        }
        case "add_shot": {
          updated.push({
            index: updated.length + 1,
            description: action.description || "",
            prompt: action.prompt || "",
            scene: action.scene,
            characters: action.characters,
          });
          logs.push(`➕ 新增格${updated.length}`);
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
            setTimeout(() => router.push("/studio"), 500);
          } else if (updated.length > 0) {
            pushShotsToStudio(updated);
            logs.push(`📤 已推送 ${updated.length} 格分镜到生图工作台`);
            setTimeout(() => router.push("/studio"), 300);
          } else {
            logs.push(`⚠ 当前没有分镜可推送`);
          }
          break;
        }
        case "set_grid_count": {
          const count = Math.max(1, Math.min(25, action.gridCount || 9));
          // 通过 CustomEvent 通知 Studio 设置宫格数
          window.dispatchEvent(new CustomEvent("feicai-set-grid-count", { detail: { count } }));
          logs.push(`🔢 宫格数量已设置为 ${count}`);
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
          }
          break;
        }
        case "navigate": {
          const target = action.target || "studio";
          const routes: Record<string, string> = {
            studio: "/studio", video: "/video", pipeline: "/pipeline", settings: "/settings",
          };
          const route = routes[target] || `/${target}`;
          setTimeout(() => router.push(route), 300);
          logs.push(`🔗 正在跳转到 ${target}...`);
          break;
        }

        // ═══ 以下为新增 FC Actions（23种） ═══

        case "generate_grid": {
          const mode = action.gridMode || "nine";
          const cmdMap: Record<string, string> = {
            nine: "generateNineGrid",
            four: "generateFourGrid",
            smartNine: "generateSmartNineGrid",
            custom: "generateNineGrid", // 自定义模式也用九宫格生成
          };
          const cmd = cmdMap[mode] || "generateNineGrid";
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: cmd, params: { beatIdx: action.beatIdx || 0 }, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🖼 ${mode} 宫格生成已启动`);
          // 确保在 Studio 页面
          if (!window.location.pathname.includes("/studio")) setTimeout(() => router.push("/studio"), 300);
          break;
        }
        case "regenerate_cell": {
          const ci = action.cellIndex || 1;
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "regenerateCell", params: { cellIndex: ci, prompt: action.prompt || "" }, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🔄 格${ci} 重新生成已启动`);
          break;
        }
        case "upscale_cell": {
          const ci = action.cellIndex || 1;
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "upscaleCell", params: { cellIndex: ci }, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🔍 格${ci} 超分已启动`);
          break;
        }
        case "batch_upscale": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "batchUpscale", params: {}, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🔍 批量超分已启动`);
          break;
        }
        case "batch_generate": {
          if (action.cells?.length) {
            for (const ci of action.cells) {
              window.dispatchEvent(new CustomEvent("director-command", {
                detail: { action: "regenerateCell", params: { cellIndex: ci }, requestId: `fab-${Date.now()}-${ci}` },
              }));
            }
            logs.push(`🖼 批量生成格 ${action.cells.join(",")} 已启动`);
          }
          break;
        }
        case "translate_prompt": {
          const ci = action.cellIndex || 1;
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "translatePrompt", params: { cellIndex: ci }, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🌐 格${ci} 翻译已启动`);
          break;
        }
        case "batch_translate": {
          if (action.cells?.length) {
            for (const ci of action.cells) {
              window.dispatchEvent(new CustomEvent("director-command", {
                detail: { action: "translatePrompt", params: { cellIndex: ci }, requestId: `fab-${Date.now()}-${ci}` },
              }));
            }
            logs.push(`🌐 批量翻译格 ${action.cells.join(",")} 已启动`);
          } else {
            // 没指定 cells 则翻译全部
            for (let i = 0; i < updated.length; i++) {
              window.dispatchEvent(new CustomEvent("director-command", {
                detail: { action: "translatePrompt", params: { cellIndex: i + 1 }, requestId: `fab-${Date.now()}-${i}` },
              }));
            }
            logs.push(`🌐 全部 ${updated.length} 格翻译已启动`);
          }
          break;
        }
        case "ai_extract": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "aiExtract", params: {}, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🧠 AI 两阶段提取已启动`);
          break;
        }
        case "set_style": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "styleUpload", params: {}, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🎨 请在弹出的对话框中选择风格图片`);
          break;
        }
        case "add_consistency_item": {
          const cat = action.category || "characters";
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "addConsistencyItem", params: { category: cat }, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`➕ 已添加 ${cat === "characters" ? "角色" : cat === "scenes" ? "场景" : "道具"} 条目`);
          break;
        }
        case "toggle_style_ref": {
          logs.push(`🎨 风格参考图已${action.enabled ? "启用" : "禁用"}`);
          break;
        }
        case "switch_grid_mode": {
          const gm = action.gridMode || "nine";
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "switchGridMode", params: { mode: gm }, requestId: `fab-${Date.now()}` },
          }));
          const modeNames: Record<string, string> = { nine: "九宫格", four: "四宫格", smartNine: "智能分镜", custom: "自定义" };
          logs.push(`🔀 已切换到 ${modeNames[gm] || gm} 模式`);
          break;
        }
        case "switch_episode": {
          const ep = action.episode || "ep01";
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "switchEpisode", params: { episode: ep }, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`📺 已切换到 ${ep}`);
          break;
        }
        case "switch_left_tab": {
          const tab = action.tab || "prompts";
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "switchLeftTab", params: { tab }, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`📑 左侧面板已切换到 ${tab}`);
          break;
        }
        case "switch_image_gen_mode": {
          const genMode = action.mode || "jimeng";
          // 通过 localStorage 切换生图引擎
          try {
            const raw = localStorage.getItem("feicai-settings");
            if (raw) {
              const s = JSON.parse(raw);
              s["image-gen-mode"] = genMode;
              localStorage.setItem("feicai-settings", JSON.stringify(s));
            }
          } catch { /* */ }
          logs.push(`🔧 生图引擎已切换为 ${genMode}`);
          break;
        }
        case "select_cell": {
          const ci = action.cellIndex || 1;
          // 发送选中事件（Studio 可监听此事件滚动到对应格子）
          window.dispatchEvent(new CustomEvent("feicai-select-cell", { detail: { cellIndex: ci } }));
          logs.push(`👆 已选中格${ci}`);
          break;
        }
        case "analyze_script": {
          // 跳转到 Pipeline 页面触发剧本分析
          try { localStorage.setItem("feicai-pipeline-tab", "beatBreakdown"); } catch { /* */ }
          setTimeout(() => router.push("/pipeline"), 300);
          logs.push(`📊 正在跳转到流水线进行剧本分析...`);
          break;
        }
        case "switch_pipeline_tab": {
          const pTab = action.tab || "agentStoryboard";
          try { localStorage.setItem("feicai-pipeline-tab", pTab); } catch { /* */ }
          if (!window.location.pathname.includes("/pipeline")) {
            setTimeout(() => router.push("/pipeline"), 300);
          }
          logs.push(`📑 流水线标签已切换到 ${pTab}`);
          break;
        }
        case "load_prompts": {
          const ep = action.episode || "";
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "loadPrompts", params: { episode: ep }, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`📄 正在加载 ${ep || "当前集"} 提示词`);
          break;
        }
        case "open_modal": {
          const modal = action.tab || "characterLibrary";
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "openModal", params: { modal }, requestId: `fab-${Date.now()}` },
          }));
          const modalNames: Record<string, string> = {
            characterLibrary: "角色库", motionPrompt: "动态提示词", gridImport: "宫格导入", playStyle: "玩法选择",
          };
          logs.push(`📂 已打开 ${modalNames[modal] || modal} 弹窗`);
          break;
        }
        case "clear_all_images": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "clearAllImages", params: {}, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🧹 已清除所有生成的图片`);
          break;
        }
        case "copy_prompt": {
          const ci = (action.cellIndex || 1) - 1;
          if (ci >= 0 && ci < updated.length) {
            const text = updated[ci].prompt || updated[ci].description || "";
            try { navigator.clipboard.writeText(text); } catch { /* */ }
            logs.push(`📋 格${action.cellIndex} 提示词已复制到剪贴板`);
          }
          break;
        }
        case "generate_video": {
          setTimeout(() => router.push("/video"), 300);
          logs.push(`🎥 正在跳转到图生视频页面...`);
          break;
        }

        // ═══ Video 页操作（7种） ═══

        case "save_video_state": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "saveVideoState", params: {}, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`💾 视频状态保存已触发`);
          if (!window.location.pathname.includes("/video")) setTimeout(() => router.push("/video"), 300);
          break;
        }
        case "clear_video_state": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "clearVideoState", params: {}, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🧹 视频数据清除已触发`);
          if (!window.location.pathname.includes("/video")) setTimeout(() => router.push("/video"), 300);
          break;
        }
        case "switch_video_ep": {
          const ep = action.episode || "ep01";
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "switchVideoEp", params: { episode: ep }, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`📺 视频页已切换到 ${ep}`);
          if (!window.location.pathname.includes("/video")) setTimeout(() => router.push("/video"), 300);
          break;
        }
        case "quick_relay": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "quickRelay", params: {}, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🔗 快捷尾帧接力已启动`);
          if (!window.location.pathname.includes("/video")) setTimeout(() => router.push("/video"), 300);
          break;
        }
        case "ai_video_prompt": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "aiVideoPrompt", params: {}, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🤖 AI视频提示词生成已启动`);
          if (!window.location.pathname.includes("/video")) setTimeout(() => router.push("/video"), 300);
          break;
        }
        case "export_dialogue": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "exportDialogue", params: {}, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`📝 台词文稿导出已启动`);
          if (!window.location.pathname.includes("/video")) setTimeout(() => router.push("/video"), 300);
          break;
        }
        case "switch_video_model": {
          const mid = action.modelId || "";
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "switchVideoModel", params: { modelId: mid }, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🎬 视频模型已切换为 ${mid}`);
          break;
        }

        // ═══ Pipeline 页操作（4种） ═══

        case "run_pipeline": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "runPipeline", params: {}, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`▶ 分镜流水线已启动`);
          if (!window.location.pathname.includes("/pipeline")) setTimeout(() => router.push("/pipeline"), 300);
          break;
        }
        case "stop_pipeline": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "stopPipeline", params: {}, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`⏹ 分镜流水线已停止`);
          break;
        }
        case "sync_to_studio": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "syncToStudio", params: {}, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`📤 正在同步到Studio工作台`);
          if (!window.location.pathname.includes("/pipeline")) setTimeout(() => router.push("/pipeline"), 300);
          break;
        }
        case "confirm_plan": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "confirmPlan", params: {}, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`✅ 分镜方案确认已触发`);
          if (!window.location.pathname.includes("/pipeline")) setTimeout(() => router.push("/pipeline"), 300);
          break;
        }

        // ═══ Seedance 页操作（3种） ═══

        case "generate_seedance": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "generateSeedance", params: {}, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🎞 Seedance视频生成已启动`);
          if (!window.location.pathname.includes("/seedance")) setTimeout(() => router.push("/seedance"), 300);
          break;
        }
        case "set_seedance_params": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "setSeedanceParams", params: { ratio: action.ratio, duration: action.duration, quality: action.quality, model: action.seedanceModel }, requestId: `fab-${Date.now()}` },
          }));
          const parts: string[] = [];
          if (action.ratio) parts.push(`比例${action.ratio}`);
          if (action.duration) parts.push(`时长${action.duration}s`);
          if (action.quality) parts.push(action.quality);
          if (action.seedanceModel) parts.push(action.seedanceModel);
          logs.push(`⚙ Seedance参数已设置: ${parts.join(", ") || "已更新"}`);
          break;
        }
        case "ai_seedance_prompt": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "aiSeedancePrompt", params: {}, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🤖 Seedance AI提示词优化已启动`);
          if (!window.location.pathname.includes("/seedance")) setTimeout(() => router.push("/seedance"), 300);
          break;
        }

        // ═══ Studio 补充操作（4种） ═══

        case "generate_motion_prompts": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "openModal", params: { modal: "motionPrompt" }, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🎭 运动提示词弹窗已打开`);
          if (!window.location.pathname.includes("/studio")) setTimeout(() => router.push("/studio"), 300);
          break;
        }
        case "translate_ref_prompt": {
          const ci = action.cellIndex || 1;
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "translateRefPrompt", params: { cellIndex: ci }, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🌐 一致性参考描述翻译已启动`);
          break;
        }
        case "delete_consistency_item": {
          const cat = action.category || "characters";
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "deleteConsistencyItem", params: { category: cat, name: action.itemName || "" }, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🗑 已删除 ${cat === "characters" ? "角色" : cat === "scenes" ? "场景" : "道具"}: ${action.itemName || ""}`);
          break;
        }
        case "open_ref_bind": {
          window.dispatchEvent(new CustomEvent("director-command", {
            detail: { action: "openRefBind", params: {}, requestId: `fab-${Date.now()}` },
          }));
          logs.push(`🔗 参考图绑定面板已打开`);
          if (!window.location.pathname.includes("/studio")) setTimeout(() => router.push("/studio"), 300);
          break;
        }

        // ═══ 剧本/文件操作（3种） ═══

        case "import_script": {
          if (action.scriptContent) {
            localStorage.setItem("feicai-agent-script-context", action.scriptContent);
            if (action.scriptTitle) localStorage.setItem("feicai-agent-script-title", action.scriptTitle);
            // ★ 同步保存到剧本管理系统（IndexedDB），让流水线分析、AI提取等功能也能访问
            const _scriptId = `agent-${Date.now()}`;
            const _scriptTitle = action.scriptTitle || "智能体导入剧本";
            const _scriptContent = action.scriptContent;
            import("../lib/scriptDB").then(({ saveScriptDB }) => {
              saveScriptDB({ id: _scriptId, title: _scriptTitle, desc: `由AI助手导入 (${_scriptContent.length}字)`, status: "active", content: _scriptContent }).then(() => {
                localStorage.setItem("feicai-pipeline-script-id", _scriptId);
              });
            }).catch(() => { /* ignore */ });
            logs.push(`📄 已导入剧本「${_scriptTitle}」（${action.scriptContent.length}字）并同步到剧本库`);
          } else {
            logs.push(`⚠ import_script 缺少 scriptContent`);
          }
          break;
        }
        case "parse_script_to_shots": {
          const scriptCtx = localStorage.getItem("feicai-agent-script-context") || "";
          if (scriptCtx) {
            logs.push(`🎬 正在根据剧本拆解分镜...请等待 AI 完成分析`);
            setMessages(prev => [...prev, {
              id: genId(), role: "system",
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

        // ═══ EP 集数管理（3种） ═══

        case "add_episode": {
          const ep = action.newEpisode || action.episode || "";
          if (ep) {
            window.dispatchEvent(new CustomEvent("director-command", {
              detail: { action: "addEpisode", params: { episode: ep }, requestId: `fab-${Date.now()}` },
            }));
            logs.push(`➕ 已添加新集数: ${ep.toUpperCase()}`);
          }
          break;
        }
        case "remove_episode": {
          const ep = action.episode || "";
          if (ep) {
            window.dispatchEvent(new CustomEvent("director-command", {
              detail: { action: "removeEpisode", params: { episode: ep }, requestId: `fab-${Date.now()}` },
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
              detail: { action: "renameEpisode", params: { episode: oldEp, newEpisode: newEp }, requestId: `fab-${Date.now()}` },
            }));
            logs.push(`✏ 已重命名 ${oldEp.toUpperCase()} → ${newEp.toUpperCase()}`);
          }
          break;
        }

        // ═══ 分镜内容增强（4种） ═══

        case "batch_write_prompts": {
          if (action.prompts && action.prompts.length > 0) {
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
          updated.splice(pos, 0, newShot);
          updated = updated.map((s, i) => ({ ...s, index: i + 1 }));
          logs.push(`📌 已在第${pos + 1}格插入新分镜`);
          break;
        }
        case "move_shots_to_episode": {
          const targetEp = action.targetEpisode || "";
          const cellsToMove = action.cells || [];
          if (targetEp && cellsToMove.length > 0) {
            const movedShots = cellsToMove.map(c => updated[c - 1]).filter(Boolean);
            const remaining = updated.filter((_, i) => !cellsToMove.includes(i + 1));
            updated = remaining.map((s, i) => ({ ...s, index: i + 1 }));
            window.dispatchEvent(new CustomEvent("director-command", {
              detail: { action: "moveShotsToEpisode", params: { targetEpisode: targetEp, shots: movedShots }, requestId: `fab-${Date.now()}` },
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
              detail: { action: "mergeEpisodes", params: { sourceEpisode: src, targetEpisode: tgt }, requestId: `fab-${Date.now()}` },
            }));
            logs.push(`🔀 已合并 ${src.toUpperCase()} 到 ${tgt.toUpperCase()}`);
          }
          break;
        }

        // ═══ 风格增强（3种） ═══

        case "set_art_style": {
          if (action.artStyle) {
            window.dispatchEvent(new CustomEvent("director-command", {
              detail: { action: "setArtStyle", params: { artStyle: action.artStyle }, requestId: `fab-${Date.now()}` },
            }));
            logs.push(`🎨 艺术风格已设置为: ${action.artStyle}`);
          }
          break;
        }
        case "set_color_palette": {
          if (action.colorPalette) {
            window.dispatchEvent(new CustomEvent("director-command", {
              detail: { action: "setColorPalette", params: { colorPalette: action.colorPalette }, requestId: `fab-${Date.now()}` },
            }));
            logs.push(`🎨 色彩方案已设置为: ${action.colorPalette}`);
          }
          break;
        }
        case "batch_inject_style": {
          if (action.styleSuffix) {
            updated = updated.map(s => ({
              ...s,
              prompt: s.prompt ? `${s.prompt}, ${action.styleSuffix}` : action.styleSuffix || "",
            }));
            logs.push(`🎨 已给所有分镜注入风格后缀: "${action.styleSuffix}"`);
          }
          break;
        }
        // EP 直写：通过 director-command 直接写入 Studio 指定EP的提示词
        case "write_prompts_to_episode": {
          if (action.prompts && action.prompts.length > 0 && action.episode) {
            const prompts = action.prompts.map(p => p.prompt || p.description || "");
            window.dispatchEvent(new CustomEvent("director-command", {
              detail: {
                action: "writePromptsToEpisode",
                params: { episode: action.episode, prompts, gridCount: prompts.length },
                requestId: `fab-write-ep-${Date.now()}`,
              },
            }));
            logs.push(`📝 已写入 ${prompts.length} 条提示词到 ${action.episode.toUpperCase()}`);
          }
          break;
        }
      }
    }

    return { updated, logs };
  };

  // ── 从 Studio 获取当前上下文（EP、宫格数、提示词等）──
  const getStudioContext = (): Promise<Record<string, unknown> | null> => {
    return new Promise((resolve) => {
      const reqId = `fab-ctx-${Date.now()}`;
      const timeout = setTimeout(() => { resolve(null); }, 500);
      const handler = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (detail?.requestId === reqId) {
          clearTimeout(timeout);
          window.removeEventListener("director-context-response", handler);
          resolve(detail.context || null);
        }
      };
      window.addEventListener("director-context-response", handler);
      window.dispatchEvent(new CustomEvent("director-context-request", { detail: { requestId: reqId } }));
    });
  };

  // ── 发送消息 ──
  const handleSend = async (text?: string) => {
    const msg = text || input.trim();
    if ((!msg && uploadImages.length === 0 && uploadFiles.length === 0) || loading) return;
    setInput("");

    // 携带图片数据
    const currentImages = [...uploadImages];
    setUploadImages([]);
    // 携带文件数据
    const currentFiles = [...uploadFiles];
    setUploadFiles([]);

    const userMsg: FabMessage = {
      id: genId(), role: "user", content: msg || (currentImages.length > 0 ? "(图片)" : "(文件)"), timestamp: Date.now(),
      images: currentImages.length > 0 ? currentImages : undefined,
      files: currentFiles.length > 0 ? currentFiles.map(f => ({ name: f.name, preview: f.content.slice(0, 200) + (f.content.length > 200 ? "..." : "") })) : undefined,
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    setFabStatus("thinking");

    try {
      const llmSettings = getLLMSettings();
      if (!llmSettings?.apiKey) throw new Error("未配置 LLM API Key，请到设置页面配置");

      // 构建消息内容（含图片/文件描述）
      let fullMessage = msg || "";
      if (currentImages.length > 0) {
        fullMessage += `\n[用户上传了 ${currentImages.length} 张图片]`;
      }
      if (currentFiles.length > 0) {
        for (const f of currentFiles) {
          fullMessage += `\n\n=== 文件：${f.name} ===\n${f.content}\n=== 文件结束 ===`;
        }
      }

      // 获取 Studio 当前状态（EP、宫格数、提示词等）
      const studioCtx = await getStudioContext();
      const gridCount = (studioCtx?.customGridCount as number) || (studioCtx?.totalCells as number) || shots.length || 9;

      const res = await fetch("/api/director", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: fullMessage,
          mode: "agentStoryboard",
          customGridCount: gridCount,
          llmSettings,
          pathname, // 当前页面路径，用于知识库上下文注入
          images: currentImages.length > 0 ? currentImages : undefined,
          currentShots: shots.length > 0 ? shots : undefined,
          studioContext: studioCtx ? {
            currentEpisode: studioCtx.episode,
            episodes: studioCtx.episodes,
            gridMode: studioCtx.gridMode,
            customGridCount: studioCtx.customGridCount,
            customPrompts: studioCtx.customPrompts,
            isGenerating: studioCtx.isGenerating,
            filledCells: studioCtx.filledCells,
            totalCells: studioCtx.totalCells,
          } : undefined,
          history: messages.filter(m => m.role !== "system").slice(-8).map(m => ({
            role: m.role, content: m.content, agent: m.agent,
          })),
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `API 错误: ${res.status}`);
      }

      const data = await res.json();

      setMessages(prev => [...prev, {
        id: genId(),
        role: "assistant",
        agent: data.agent || "director",
        content: data.reply || "（无回复）",
        timestamp: Date.now(),
      }]);

      // 1. 接收 LLM 返回的分镜并存储
      let currentShots = shots;
      let hasEpisodes = false;
      if (data.episodes?.length > 0) {
        // 分集模式
        hasEpisodes = true;
        setEpisodeResults(data.episodes as EpisodeResult[]);
        const firstEp = data.episodes[0];
        if (firstEp?.shots) {
          const newShots = (firstEp.shots as ShotResult[]).map((s: ShotResult, i: number) => ({ ...s, index: i + 1 }));
          currentShots = newShots;
          setShots(newShots);
        }
        const totalShots = (data.episodes as EpisodeResult[]).reduce((s: number, ep: EpisodeResult) => s + ep.shots.length, 0);
        setMessages(prev => [...prev, {
          id: genId(), role: "system",
          content: `🎬 已生成 ${data.episodes.length} 集共 ${totalShots} 个分镜`,
          timestamp: Date.now(),
        }]);
      } else if (data.shots?.length > 0) {
        const newShots = (data.shots as ShotResult[]).map((s: ShotResult, i: number) => ({ ...s, index: i + 1 }));
        currentShots = newShots;
        setShots(newShots);
        setEpisodeResults([]); // 清除分集
        setMessages(prev => [...prev, {
          id: genId(), role: "system",
          content: `🎬 已生成 ${newShots.length} 个分镜`,
          timestamp: Date.now(),
        }]);
      }

      // 2. 执行 FC Actions（实际操作页面）— 支持确认门控
      let actionsExecuted = false;
      if (data.actions?.length > 0) {
        const actions = data.actions as FCAction[];
        if (autoExecute) {
          actionsExecuted = true;
          // 自动模式：立即执行
          const { updated, logs } = executeFCActions(actions, currentShots);
          if (updated !== currentShots) {
            setShots(updated);
            currentShots = updated;
          }
          if (logs.length > 0) {
            setMessages(prev => [...prev, {
              id: genId(), role: "system",
              content: logs.join("\n"),
              timestamp: Date.now(),
            }]);
          }
        } else {
          // 确认模式：暂存待确认
          setPendingActions(actions);
          setPendingShots(currentShots);
          setMessages(prev => [...prev, {
            id: genId(), role: "system",
            content: `⏸ ${actions.length} 个操作待确认 — 请在下方卡片中确认或取消`,
            timestamp: Date.now(),
          }]);
          // 不自动推送，等确认后再推
          if (!expanded) setHasUnread(true);
          return; // 跳过下面的自动推送逻辑
        }
      }

      // 3. 如果有分镜但没有 push_to_studio action，自动推送到 Studio
      const hasPush = data.actions?.some((a: FCAction) => a.type === "push_to_studio");
      if (!hasPush) {
        if (hasEpisodes && data.episodes?.length > 0) {
          // 分集模式：自动推送所有集（不检查旧 episodeResults 状态，因为 React setState 异步）
          pushEpisodesToStudio(data.episodes as EpisodeResult[]);
        } else if (currentShots.length > 0 && !hasEpisodes && (data.shots?.length > 0 || actionsExecuted)) {
          // Actions 修改了 shots 或有新 shots 数据时，自动推送到工作台
          pushShotsToStudio(currentShots);
          setMessages(prev => [...prev, {
            id: genId(), role: "system",
            content: `📤 ${currentShots.length} 格分镜已自动推送到生图工作台`,
            timestamp: Date.now(),
          }]);
        }
      }

      if (!expanded) setHasUnread(true);
      setFabStatus("success");
    } catch (err) {
      setFabStatus("error");
      setMessages(prev => [...prev, {
        id: genId(), role: "assistant", agent: "director",
        content: `❌ ${err instanceof Error ? err.message : "请求失败"}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setLoading(false);
      // 非 thinking 状态3秒后自动回归 idle
      if (fabStatusTimerRef.current) clearTimeout(fabStatusTimerRef.current);
      fabStatusTimerRef.current = setTimeout(() => setFabStatus("idle"), 3000);
    }
  };

  const goToAgent = () => {
    try { localStorage.setItem("feicai-pipeline-tab", "agentStoryboard"); } catch { /* */ }
    router.push("/pipeline");
    setExpanded(false);
  };

  // ── 确认/取消 pending actions ──
  const confirmPendingActions = useCallback(() => {
    if (!pendingActions) return;
    const base = pendingShots || shots;
    const { updated, logs } = executeFCActions(pendingActions, base);
    if (updated !== base) setShots(updated);
    if (logs.length > 0) {
      setMessages(prev => [...prev, {
        id: genId(), role: "system",
        content: `✅ 已执行 ${logs.length} 个操作：\n${logs.join("\n")}`,
        timestamp: Date.now(),
      }]);
    }
    // 自动推送（如果有 shots 且没有 push action）
    const hasPush = pendingActions.some(a => a.type === "push_to_studio");
    if (updated.length > 0 && !hasPush) {
      pushShotsToStudio(updated);
      setMessages(prev => [...prev, {
        id: genId(), role: "system",
        content: `📤 ${updated.length} 格分镜已推送到生图工作台`,
        timestamp: Date.now(),
      }]);
    }
    setPendingActions(null);
    setPendingShots(null);
  }, [pendingActions, pendingShots, shots]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelPendingActions = useCallback(() => {
    setPendingActions(null);
    setPendingShots(null);
    setMessages(prev => [...prev, {
      id: genId(), role: "system",
      content: "❌ 已取消执行",
      timestamp: Date.now(),
    }]);
  }, []);

  const toggleAutoExecute = useCallback(() => {
    setAutoExecute(prev => {
      const next = !prev;
      try { localStorage.setItem(AUTO_EXEC_KEY, String(next)); } catch { /* */ }
      return next;
    });
  }, []);

  // 所有 hooks 已调用，现在可以安全返回 null
  if (isHidden) return null;

  const handleClear = () => {
    setMessages([{ id: genId(), role: "system", content: "对话已清空", timestamp: Date.now() }]);
    setPendingActions(null);
    setPendingShots(null);
    try { localStorage.removeItem(FAB_STORAGE_KEY); } catch { /* */ }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <>
      {/* ═══ 展开的聊天面板 ═══ */}
      {expanded && !minimized && (
        <div className="fixed bg-[var(--bg-page)] border border-[var(--border-default)] rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col transition-all duration-200"
          style={{ width: sizeConfig.w, maxHeight: sizeConfig.h, right: fabPos.x, bottom: fabPos.y + 64 }}>
          {/* 头部 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)] bg-[#0D0D0D]">
            <div className="flex items-center gap-2.5">
              <span className="text-[16px]">🎬</span>
              <span className="text-[14px] font-semibold text-[var(--text-primary)]">飞彩 AI 助手</span>
              {loading && <Loader size={14} className="text-[var(--gold-primary)] animate-spin" />}
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={goToAgent}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] rounded transition cursor-pointer"
                title="打开自定义分镜工作台">
                自定义分镜 <ChevronRight size={12} />
              </button>
              <button onClick={toggleAutoExecute}
                className={`p-1.5 transition cursor-pointer ${autoExecute ? "text-[var(--text-muted)] hover:text-amber-400" : "text-amber-400 hover:text-amber-300"}`}
                title={autoExecute ? "当前：自动执行（点击切换为确认后执行）" : "当前：确认后执行（点击切换为自动执行）"}>
                {autoExecute ? <Zap size={14} /> : <ShieldCheck size={14} />}
              </button>
              <button onClick={cycleChatSize}
                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer" title={`窗口大小: ${chatSize === "normal" ? "普通" : chatSize === "large" ? "大" : "全屏"}（点击切换）`}>
                <Maximize size={14} />
              </button>
              <button onClick={() => setMinimized(true)}
                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer" title="最小化">
                <Minimize2 size={14} />
              </button>
              <button onClick={() => setExpanded(false)}
                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer" title="关闭">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* 消息列表 */}
          <div ref={scrollRef} className="flex-1 overflow-auto p-4 flex flex-col gap-3" style={{ minHeight: sizeConfig.msgMin, maxHeight: sizeConfig.msgMax }}>
            {messages.map((msg) => {
              const isUser = msg.role === "user";
              const isSystem = msg.role === "system";
              const agent = msg.agent ? AGENT_COLORS[msg.agent] : null;

              if (isSystem) {
                return (
                  <div key={msg.id} className="flex justify-center py-0.5">
                    <span className="text-[11px] text-[var(--text-muted)] bg-[var(--bg-surface)] px-3 py-1 rounded-full border border-[var(--border-default)]">
                      {msg.content}
                    </span>
                  </div>
                );
              }

              return (
                <div key={msg.id} className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[13px]"
                    style={{
                      background: isUser ? "var(--gold-transparent)" : agent ? `${agent.color}20` : "var(--bg-surface)",
                      border: `1px solid ${isUser ? "var(--gold-primary)" : agent?.color || "var(--border-default)"}`,
                    }}>
                    {isUser ? <User size={14} className="text-[var(--gold-primary)]" /> : agent?.icon || "🤖"}
                  </div>
                  <div className={`flex flex-col gap-0.5 max-w-[80%] ${isUser ? "items-end" : "items-start"}`}>
                    {!isUser && agent && (
                      <span className="text-[11px] font-medium" style={{ color: agent.color }}>{agent.name}</span>
                    )}
                    <div className={`px-3 py-2 rounded-lg text-[13px] leading-[1.6] whitespace-pre-wrap ${
                      isUser
                        ? "bg-[var(--gold-transparent)] text-[var(--text-primary)] border border-[var(--gold-primary)]/30"
                        : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-default)]"
                    }`}>
                      {/* 显示上传的图片缩略图 */}
                      {msg.images && msg.images.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {msg.images.map((img, idx) => (
                            <img key={idx} src={img} alt={`上传图片${idx + 1}`}
                              className="w-16 h-16 object-cover rounded border border-[var(--border-default)]" />
                          ))}
                        </div>
                      )}
                      {/* 显示文件附件 */}
                      {msg.files && msg.files.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {msg.files.map((f, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 px-2 py-1 bg-[var(--bg-page)] rounded border border-[var(--border-default)] max-w-[200px]">
                              <FileText size={12} className="text-[var(--gold-primary)] shrink-0" />
                              <span className="text-[10px] text-[var(--text-muted)] truncate">{f.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            })}
            {loading && (
              <div className="flex items-center gap-2 text-[13px] text-[var(--text-muted)]">
                <Loader size={14} className="text-[var(--gold-primary)] animate-spin" />
                思考中...
              </div>
            )}
          </div>

          {/* 快捷提示 */}
          {messages.length <= 1 && (
            <div className="px-4 pb-2 flex flex-wrap gap-2">
              {[
                { icon: "🎬", label: "生成分镜", prompt: "帮我生成9格分镜" },
                { icon: "✏️", label: "改写提示词", prompt: "把所有提示词改写为电影级画面" },
                { icon: "🧹", label: "清理格子", prompt: "帮我分析哪些格子可以删除" },
              ].map((h, i) => (
                <button key={i} onClick={() => handleSend(h.prompt)} disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] bg-[var(--bg-surface)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] text-[var(--text-secondary)] transition cursor-pointer rounded-md disabled:opacity-50">
                  <span>{h.icon}</span> {h.label}
                </button>
              ))}
            </div>
          )}

          {/* ═══ 待确认操作卡片 ═══ */}
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

          {/* 文件附件预览条 */}
          {uploadFiles.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 border-t border-[var(--border-default)] bg-[#0D0D0D]">
              {uploadFiles.map((f, idx) => (
                <div key={idx} className="relative group flex items-center gap-1.5 px-2 py-1.5 bg-[var(--bg-surface)] rounded border border-[var(--border-default)] max-w-[180px]">
                  <FileText size={14} className="text-[var(--gold-primary)] shrink-0" />
                  <span className="text-[11px] text-[var(--text-secondary)] truncate">{f.name}</span>
                  <button onClick={() => removeUploadFile(idx)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-[10px] opacity-0 group-hover:opacity-100 transition cursor-pointer">
                    ×
                  </button>
                </div>
              ))}
              <span className="text-[11px] text-[var(--text-muted)]">{uploadFiles.length}/3</span>
            </div>
          )}

          {/* 图片预览条 */}
          {uploadImages.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 border-t border-[var(--border-default)] bg-[#0D0D0D]">
              {uploadImages.map((img, idx) => (
                <div key={idx} className="relative group">
                  <img src={img} alt={`待发送${idx + 1}`} className="w-12 h-12 object-cover rounded border border-[var(--border-default)]" />
                  <button onClick={() => removeUploadImage(idx)}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-[10px] opacity-0 group-hover:opacity-100 transition cursor-pointer">
                    ×
                  </button>
                </div>
              ))}
              <span className="text-[11px] text-[var(--text-muted)]">{uploadImages.length}/4</span>
            </div>
          )}

          {/* 输入栏 */}
          <div className="flex items-end gap-2 px-4 py-3 border-t border-[var(--border-default)] bg-[#0D0D0D]">
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
            <input ref={textFileInputRef} type="file" accept=".txt,.md,.csv,.json,.text" multiple className="hidden" onChange={handleTextFileUpload} />
            <button onClick={handleClear}
              className="p-1.5 text-[var(--text-muted)] hover:text-red-400 transition cursor-pointer shrink-0 mb-0.5" title="清空对话">
              <Trash2 size={16} />
            </button>
            <button onClick={() => fileInputRef.current?.click()}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--gold-primary)] transition cursor-pointer shrink-0 mb-0.5" title="上传图片（最多4张）">
              <ImagePlus size={16} />
            </button>
            <button onClick={() => textFileInputRef.current?.click()}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--gold-primary)] transition cursor-pointer shrink-0 mb-0.5" title="导入文件（txt/md/csv/json，最多3个）">
              <Paperclip size={16} />
            </button>
            <textarea ref={inputRef} value={input}
              onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} onPaste={handlePaste}
              placeholder="输入指令...（Shift+Enter 换行，Ctrl+V 粘贴图片/文件）" rows={1}
              className="flex-1 resize-none text-[13px] text-[var(--text-primary)] bg-[var(--bg-surface)] border border-[var(--border-default)] focus:border-[var(--gold-primary)] outline-none px-3 py-2 rounded-lg overflow-y-auto"
              style={{ minHeight: "38px", maxHeight: "120px" }} />
            <button onClick={() => handleSend()} disabled={loading || (!input.trim() && uploadImages.length === 0 && uploadFiles.length === 0)}
              className="flex items-center justify-center w-9 h-9 bg-[var(--gold-primary)] hover:brightness-110 transition cursor-pointer disabled:opacity-40 rounded-lg shrink-0 mb-0.5">
              {loading ? <Loader size={16} className="text-[#0A0A0A] animate-spin" /> : <Send size={16} className="text-[#0A0A0A]" />}
            </button>
          </div>
        </div>
      )}

      {/* ═══ 最小化模式 ═══ */}
      {expanded && minimized && (
        <div className="fixed w-[260px] bg-[var(--bg-page)] border border-[var(--border-default)] rounded-lg shadow-lg z-50"
          style={{ right: fabPos.x, bottom: fabPos.y + 64 }}>
          <div className="flex items-center justify-between px-3 py-2.5 cursor-pointer" onClick={() => setMinimized(false)}>
            <div className="flex items-center gap-2">
              <span className="text-[14px]">🎬</span>
              <span className="text-[13px] text-[var(--text-primary)]">飞彩 AI 助手</span>
              {loading && <Loader size={12} className="text-[var(--gold-primary)] animate-spin" />}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={(e) => { e.stopPropagation(); setMinimized(false); }}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer">
                <Maximize2 size={14} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); setExpanded(false); setMinimized(false); }}
                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer">
                <X size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ FAB 主按钮（可拖拽） ═══ */}
      <button
        ref={fabBtnRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => {
          handlePointerUp(e);
          // 只有没拖动才触发点击
          if (!dragRef.current.moved) {
            setExpanded(prev => !prev);
            setMinimized(false);
          }
        }}
        className={`fixed w-[56px] h-[56px] rounded-full flex items-center justify-center shadow-lg z-50 cursor-grab active:cursor-grabbing select-none touch-none ${
          fabStatus === "thinking" ? "animate-pulse shadow-amber-400/50 shadow-xl" :
          fabStatus === "success" ? "shadow-emerald-400/40 shadow-xl" :
          fabStatus === "error" ? "shadow-red-400/40 shadow-xl" : ""
        }`}
        style={{
          right: fabPos.x,
          bottom: fabPos.y,
          background: expanded ? "var(--gold-primary)" :
            fabStatus === "thinking" ? "linear-gradient(135deg, #C9A962, #FFD700)" :
            fabStatus === "success" ? "linear-gradient(135deg, #34D399, #6EE7B7)" :
            fabStatus === "error" ? "linear-gradient(135deg, #F87171, #FCA5A5)" :
            "linear-gradient(135deg, #C9A962, #E5D49B)",
        }}
        title="飞彩 AI 助手（可拖拽移动）"
      >
        {expanded ? (
          <X size={24} className="text-[#0A0A0A]" />
        ) : fabStatus === "thinking" ? (
          <>
            <Loader size={24} className="text-[#0A0A0A] animate-spin" />
          </>
        ) : fabStatus === "success" ? (
          <>
            <Check size={24} className="text-[#0A0A0A]" />
            {hasUnread && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-emerald-400 rounded-full border-2 border-[var(--bg-page)] animate-pulse" />
            )}
          </>
        ) : fabStatus === "error" ? (
          <>
            <XCircle size={24} className="text-[#0A0A0A]" />
          </>
        ) : (
          <>
            <Bot size={24} className="text-[#0A0A0A]" />
            {hasUnread && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full border-2 border-[var(--bg-page)] animate-pulse" />
            )}
          </>
        )}
        {/* 拖拽指示器 */}
        <span className="absolute -top-1 -left-1 opacity-0 hover:opacity-60 transition-opacity">
          <GripVertical size={10} className="text-[var(--text-muted)]" />
        </span>
      </button>
    </>
  );
}
