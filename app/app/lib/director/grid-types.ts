/**
 * ════════════════════════════════════════════════════════════
 * 智能体模式 — 自定义宫格类型定义
 * ════════════════════════════════════════════════════════════
 *
 * 自定义宫格不受 EP 数量约束，格子数量由 Agent 推荐或用户自由增减。
 * 每格包含：标题、提示词(中/英)、生成的图片、状态信息。
 */

// ── 单个格子 ──
export interface GridCell {
  id: string;
  index: number;            // 显示序号（从1开始）
  title: string;            // 镜头标题（如 "镜头1 - 神殿内部"）
  promptCN: string;         // 中文提示词
  promptEN: string;         // 英文提示词（翻译后）
  imageUrl: string;         // 生成的图片 URL（空串表示未生成）
  status: GridCellStatus;   // 当前状态
  error?: string;           // 错误信息
}

export type GridCellStatus =
  | "empty"          // 空格（无提示词）
  | "prompt"         // 有提示词，未生成
  | "generating"     // 正在生成
  | "completed"      // 已生成图片
  | "failed"         // 生成失败
  | "upscaling"      // 正在超分
  | "upscaled"       // 已完成超分
  ;

// ── 自定义宫格状态 ──
export interface CustomGridState {
  cells: GridCell[];
  sceneTitle: string;       // 场景标题（如 "第一章 · 神殿内部"）
  style: string;            // 画风/风格描述
  // 一致性资产（由 Agent 管理）
  characters: AssetItem[];
  scenes: AssetItem[];
  props: AssetItem[];
}

export interface AssetItem {
  id: string;
  name: string;
  description: string;      // 中文外观描述
  descriptionEN: string;    // 英文外观描述
  imageUrl?: string;        // 参考图
  type: "character" | "scene" | "prop";
}

// ── 持久化存储 key ──
export const AGENT_GRID_STORAGE_KEY = "feicai-agent-grid";

// ── 工具函数 ──
let _gridIdCounter = 0;
export function genGridCellId(): string {
  return `gc-${Date.now()}-${++_gridIdCounter}`;
}

export function createEmptyCell(index: number): GridCell {
  return {
    id: genGridCellId(),
    index,
    title: `镜头 ${index}`,
    promptCN: "",
    promptEN: "",
    imageUrl: "",
    status: "empty",
  };
}

export function createDefaultGridState(): CustomGridState {
  return {
    cells: [],
    sceneTitle: "",
    style: "",
    characters: [],
    scenes: [],
    props: [],
  };
}

// ── 保存/加载 ──
export function saveGridState(state: CustomGridState): void {
  try {
    localStorage.setItem(AGENT_GRID_STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

export function loadGridState(): CustomGridState {
  try {
    const raw = localStorage.getItem(AGENT_GRID_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return createDefaultGridState();
}
