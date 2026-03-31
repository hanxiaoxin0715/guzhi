/**
 * ════════════════════════════════════════════════════════════
 * AI 导演系统 — 类型定义
 * ════════════════════════════════════════════════════════════
 *
 * 三个子智能体：StoryAgent（故事策划师）、ShotAgent（分镜师）、ImageAgent（画面师）
 * 通过 CustomEvent 消息总线与 Studio 画布通信
 */

// ── 智能体角色 ──
export type AgentRole = "director" | "story" | "shot" | "image";

export interface AgentInfo {
  role: AgentRole;
  name: string;
  description: string;
  icon: string; // emoji
  color: string; // 主题色 hex
}

export const AGENTS: Record<AgentRole, AgentInfo> = {
  director: {
    role: "director",
    name: "AI 导演",
    description: "总指挥，解析意图并调度子智能体完成任务",
    icon: "🎬",
    color: "#C9A962",
  },
  story: {
    role: "story",
    name: "故事策划师",
    description: "剧本分析、节拍拆解、一致性管理（角色/场景/道具）",
    icon: "📖",
    color: "#6EC6FF",
  },
  shot: {
    role: "shot",
    name: "分镜师",
    description: "分镜提示词编写、宫格模式管理、翻译与预览",
    icon: "🎯",
    color: "#A78BFA",
  },
  image: {
    role: "image",
    name: "画面师",
    description: "图片生成、超分、风格分析、图片编辑",
    icon: "🎨",
    color: "#F59E0B",
  },
};

// ── 聊天消息 ──
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  agent?: AgentRole; // 由哪个智能体回复
  actions?: CanvasAction[]; // 已执行或待执行的画布操作
  timestamp: number;
  thinking?: string; // 导演的思考过程（调度推理）
}

// ── 画布操作定义 ──
export interface CanvasAction {
  id: string;
  type: CanvasActionType;
  params: Record<string, unknown>;
  status: "pending" | "executing" | "completed" | "failed";
  result?: string; // 执行结果描述
}

// ── 画布操作类型 ──
export type CanvasActionType =
  // 模式切换
  | "switchGridMode"       // 切换宫格模式 (nine/four/smartNine)
  | "switchImageGenMode"   // 切换生图通道 (api/geminiTab/jimeng)
  | "switchEpisode"        // 切换当前集数
  | "switchLeftTab"        // 切换左侧面板 Tab
  // 提示词操作
  | "loadPrompts"          // 加载指定 EP 的提示词
  | "updateCellPrompt"     // 修改指定格的提示词
  | "translatePrompt"      // AI 翻译指定格提示词
  | "translateRefPrompt"   // AI 翻译一致性条目描述
  | "viewFullPrompt"       // 预览完整组合提示词
  // 图片生成
  | "generateNineGrid"     // 九宫格一键生成
  | "generateFourGrid"     // 四宫格指定节拍生成
  | "generateSmartNineGrid"// 智能分镜九宫格生成
  | "regenerateCell"       // 单格重新生成
  // 图片处理
  | "upscaleCell"          // 单格超分
  | "batchUpscale"         // 批量超分
  | "deleteCell"           // 删除单格图片
  | "clearAllImages"       // 清除所有图片
  // AI 操作
  | "aiExtract"            // AI 两阶段提取（角色/场景/道具）
  | "styleAnalyze"         // AI 风格分析
  | "styleUpload"          // 上传风格参考图
  // 一致性管理
  | "addConsistencyItem"   // 添加一致性条目
  | "updateConsistencyItem"// 更新一致性条目
  | "deleteConsistencyItem"// 删除一致性条目
  // 动态提示词
  | "generateMotionPrompts"// 生成全部运镜提示词
  | "generateSingleMotion" // 生成单格运镜提示词
  // 导航
  | "navigateTo"           // 跳转到指定页面
  | "openModal"            // 打开弹窗
  ;

// ── Director API 请求/响应 ──
export interface DirectorRequest {
  messages: ChatMessage[];
  userMessage: string;
  // 当前画布上下文（帮助智能体理解当前状态）
  canvasContext?: CanvasContext;
}

export interface DirectorResponse {
  reply: string;
  agent: AgentRole;
  actions?: CanvasAction[];
  thinking?: string;
}

// ── 画布上下文快照（发送给 LLM 做决策参考） ──
export interface CanvasContext {
  currentPage: string;        // 当前所在页面路径
  gridMode: string;           // 当前宫格模式
  episode: string;            // 当前集数
  episodes: string[];         // 可用集数列表
  imageGenMode: string;       // 当前生图通道
  leftTab: string;            // 左侧面板 Tab
  // 格子状态概要
  filledCells: number;        // 已有图片的格子数
  totalCells: number;         // 总格子数
  hasPrompts: boolean;        // 是否已加载提示词
  // 一致性概要
  characterCount: number;     // 角色条目数
  sceneCount: number;         // 场景条目数
  propCount: number;          // 道具条目数
  hasStyle: boolean;          // 是否有风格设置
  // 生成状态
  isGenerating: boolean;      // 是否正在生成
}

// ── CustomEvent 消息总线 ──
export interface DirectorCommandEvent {
  action: CanvasActionType;
  params: Record<string, unknown>;
  requestId: string; // 用于回调匹配
}

export interface DirectorResultEvent {
  requestId: string;
  success: boolean;
  result?: string;
  error?: string;
}

// CustomEvent 类型声明（挂载到 Window）
declare global {
  interface WindowEventMap {
    "director-command": CustomEvent<DirectorCommandEvent>;
    "director-result": CustomEvent<DirectorResultEvent>;
    "director-context-request": CustomEvent<{ requestId: string }>;
    "director-context-response": CustomEvent<{ requestId: string; context: CanvasContext }>;
  }
}
