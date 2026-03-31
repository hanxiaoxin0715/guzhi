"use client";

/**
 * ════════════════════════════════════════════════════════════
 * AgentCanvas — 自定义宫格画布组件
 * ════════════════════════════════════════════════════════════
 *
 * 参考 Toonflow 的可拖拽画布设计，展示 Agent 生成的分镜卡片。
 * 特性：
 * - 动态格子数量（Agent 推荐 + 用户 +/- 增减）
 * - 每格显示：标题、提示词摘要、图片、状态
 * - 支持点击编辑单格提示词
 * - 操作栏：添加格子、删除格子、一键生图、一键超分
 */

import { useState, useCallback, useRef } from "react";
import {
  Plus,
  Minus,
  Trash2,
  Image as ImageIcon,
  Loader,
  ZoomIn,
  Edit3,
  CheckCircle,
  XCircle,
  Sparkles,
  ArrowUp,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { CustomGridState, GridCell } from "../lib/director/grid-types";
import { createEmptyCell, genGridCellId } from "../lib/director/grid-types";

interface AgentCanvasProps {
  gridState: CustomGridState;
  onGridStateChange: (state: CustomGridState) => void;
  onGenerateCell: (cellId: string) => void;
  onUpscaleCell: (cellId: string) => void;
  onGenerateAll: () => void;
  isGenerating: boolean;
}

// ── 状态颜色/图标 ──
function CellStatusBadge({ status }: { status: GridCell["status"] }) {
  const map: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
    empty: { color: "#666", label: "空", icon: null },
    prompt: { color: "#A78BFA", label: "待生成", icon: <Edit3 size={10} /> },
    generating: { color: "#C9A962", label: "生成中", icon: <Loader size={10} className="animate-spin" /> },
    completed: { color: "#4CAF50", label: "已完成", icon: <CheckCircle size={10} /> },
    failed: { color: "#EF4444", label: "失败", icon: <XCircle size={10} /> },
    upscaling: { color: "#F59E0B", label: "超分中", icon: <Loader size={10} className="animate-spin" /> },
    upscaled: { color: "#10B981", label: "已超分", icon: <ArrowUp size={10} /> },
  };
  const s = map[status] || map.empty;
  return (
    <div className="flex items-center gap-1 text-[9px]" style={{ color: s.color }}>
      {s.icon}
      <span>{s.label}</span>
    </div>
  );
}

// ── 单格卡片 ──
function ShotCard({
  cell,
  onEdit,
  onDelete,
  onGenerate,
  onUpscale,
  isGenerating,
}: {
  cell: GridCell;
  onEdit: (cell: GridCell) => void;
  onDelete: (cellId: string) => void;
  onGenerate: (cellId: string) => void;
  onUpscale: (cellId: string) => void;
  isGenerating: boolean;
}) {
  const [showPrompt, setShowPrompt] = useState(false);

  return (
    <div className="group flex flex-col bg-[#111111] border border-[var(--border-default)] rounded-lg overflow-hidden hover:border-[var(--gold-primary)]/50 transition-all">
      {/* 图片区域 */}
      <div className="relative w-full aspect-[16/9] bg-[#0A0A0A] flex items-center justify-center overflow-hidden">
        {cell.imageUrl ? (
          <img
            src={cell.imageUrl}
            alt={cell.title}
            className="w-full h-full object-cover"
          />
        ) : cell.status === "generating" ? (
          <div className="flex flex-col items-center gap-2">
            <Loader size={24} className="text-[var(--gold-primary)] animate-spin" />
            <span className="text-[10px] text-[var(--text-muted)]">生成中...</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 text-[var(--text-muted)]">
            <ImageIcon size={20} className="opacity-30" />
            <span className="text-[9px] opacity-50">
              {cell.promptCN ? "点击生成" : "等待提示词"}
            </span>
          </div>
        )}

        {/* 序号标签 */}
        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-black/60 rounded text-[9px] text-white font-mono">
          #{cell.index}
        </div>

        {/* 悬浮操作 */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          {cell.promptCN && cell.status !== "generating" && cell.status !== "upscaling" && (
            <button
              onClick={() => onGenerate(cell.id)}
              disabled={isGenerating}
              className="p-2 bg-[var(--gold-primary)] text-[#0A0A0A] rounded-full hover:brightness-110 transition disabled:opacity-30 cursor-pointer"
              title="生成图片"
            >
              <Sparkles size={14} />
            </button>
          )}
          {cell.imageUrl && cell.status === "completed" && (
            <button
              onClick={() => onUpscale(cell.id)}
              disabled={isGenerating}
              className="p-2 bg-emerald-500 text-white rounded-full hover:brightness-110 transition disabled:opacity-30 cursor-pointer"
              title="超分放大"
            >
              <ZoomIn size={14} />
            </button>
          )}
          <button
            onClick={() => onEdit(cell)}
            className="p-2 bg-[#2A2A2A] text-white rounded-full hover:bg-[#3A3A3A] transition cursor-pointer"
            title="编辑"
          >
            <Edit3 size={14} />
          </button>
          <button
            onClick={() => onDelete(cell.id)}
            className="p-2 bg-red-500/80 text-white rounded-full hover:bg-red-500 transition cursor-pointer"
            title="删除"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* 信息区 */}
      <div className="px-3 py-2 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-[var(--text-primary)] truncate flex-1">
            {cell.title}
          </span>
          <CellStatusBadge status={cell.status} />
        </div>

        {/* 提示词预览 */}
        {cell.promptCN && (
          <button
            onClick={() => setShowPrompt(!showPrompt)}
            className="flex items-center gap-1 text-[9px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition cursor-pointer"
          >
            <span className="truncate">{showPrompt ? "收起提示词" : cell.promptCN.slice(0, 40) + "..."}</span>
            {showPrompt ? <ChevronUp size={8} /> : <ChevronDown size={8} />}
          </button>
        )}
        {showPrompt && cell.promptCN && (
          <div className="text-[10px] text-[var(--text-secondary)] leading-relaxed bg-[#0A0A0A] rounded p-2 max-h-[100px] overflow-auto whitespace-pre-wrap">
            {cell.promptCN}
          </div>
        )}

        {cell.error && (
          <span className="text-[9px] text-red-400 truncate">{cell.error}</span>
        )}
      </div>
    </div>
  );
}

// ── 提示词编辑弹窗 ──
function CellEditModal({
  cell,
  onSave,
  onClose,
}: {
  cell: GridCell;
  onSave: (updated: GridCell) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(cell.title);
  const [promptCN, setPromptCN] = useState(cell.promptCN);
  const [promptEN, setPromptEN] = useState(cell.promptEN);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-[var(--bg-page)] border border-[var(--border-default)] rounded-xl w-[600px] max-h-[80vh] overflow-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[var(--border-default)] flex items-center justify-between">
          <span className="text-[14px] font-bold text-[var(--text-primary)]">
            编辑 #{cell.index} — {cell.title}
          </span>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer">✕</button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="text-[11px] text-[var(--text-muted)] mb-1 block">标题</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-[36px] bg-[var(--bg-surface)] border border-[var(--border-default)] text-[12px] text-[var(--text-primary)] px-3 outline-none focus:border-[var(--gold-primary)] transition rounded"
            />
          </div>
          <div>
            <label className="text-[11px] text-[var(--text-muted)] mb-1 block">中文提示词</label>
            <textarea
              value={promptCN}
              onChange={(e) => setPromptCN(e.target.value)}
              className="w-full min-h-[120px] bg-[var(--bg-surface)] border border-[var(--border-default)] text-[12px] text-[var(--text-primary)] px-3 py-2 outline-none focus:border-[var(--gold-primary)] transition rounded resize-y"
            />
          </div>
          <div>
            <label className="text-[11px] text-[var(--text-muted)] mb-1 block">英文提示词（可由 Agent 翻译）</label>
            <textarea
              value={promptEN}
              onChange={(e) => setPromptEN(e.target.value)}
              className="w-full min-h-[120px] bg-[var(--bg-surface)] border border-[var(--border-default)] text-[12px] text-[var(--text-primary)] px-3 py-2 outline-none focus:border-[var(--gold-primary)] transition rounded resize-y"
            />
          </div>
        </div>
        <div className="px-6 py-3 border-t border-[var(--border-default)] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[12px] text-[var(--text-secondary)] border border-[var(--border-default)] rounded hover:border-[var(--text-muted)] transition cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={() => {
              onSave({
                ...cell,
                title,
                promptCN,
                promptEN,
                status: promptCN.trim() ? (cell.imageUrl ? cell.status : "prompt") : "empty",
              });
            }}
            className="px-4 py-2 text-[12px] bg-[var(--gold-primary)] text-[#0A0A0A] rounded hover:brightness-110 transition cursor-pointer"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// 主画布组件
// ══════════════════════════════════════════════════════════

export default function AgentCanvas({
  gridState,
  onGridStateChange,
  onGenerateCell,
  onUpscaleCell,
  onGenerateAll,
  isGenerating,
}: AgentCanvasProps) {
  const [editingCell, setEditingCell] = useState<GridCell | null>(null);

  // 添加格子
  const addCell = useCallback(() => {
    const newIndex = gridState.cells.length + 1;
    const newCell = createEmptyCell(newIndex);
    onGridStateChange({
      ...gridState,
      cells: [...gridState.cells, newCell],
    });
  }, [gridState, onGridStateChange]);

  // 删除格子
  const deleteCell = useCallback((cellId: string) => {
    const cells = gridState.cells
      .filter((c) => c.id !== cellId)
      .map((c, i) => ({ ...c, index: i + 1, title: c.title.startsWith("镜头 ") ? `镜头 ${i + 1}` : c.title }));
    onGridStateChange({ ...gridState, cells });
  }, [gridState, onGridStateChange]);

  // 保存编辑
  const saveCellEdit = useCallback((updated: GridCell) => {
    const cells = gridState.cells.map((c) => (c.id === updated.id ? updated : c));
    onGridStateChange({ ...gridState, cells });
    setEditingCell(null);
  }, [gridState, onGridStateChange]);

  const hasPromptCells = gridState.cells.some((c) => c.promptCN.trim());
  const completedCount = gridState.cells.filter((c) => c.status === "completed" || c.status === "upscaled").length;

  return (
    <div className="flex flex-col h-full">
      {/* ── 工具栏 ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-default)] shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-medium text-[var(--text-primary)]">
            {gridState.sceneTitle || "自定义宫格"}
          </span>
          <span className="text-[10px] text-[var(--text-muted)] px-2 py-0.5 bg-[var(--bg-surface)] rounded">
            {gridState.cells.length} 格 · {completedCount} 已生成
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* 增减格子 */}
          <button
            onClick={() => {
              if (gridState.cells.length > 1) {
                const cells = gridState.cells.slice(0, -1);
                onGridStateChange({ ...gridState, cells });
              }
            }}
            disabled={gridState.cells.length <= 1 || isGenerating}
            className="p-1.5 text-[var(--text-muted)] border border-[var(--border-default)] rounded hover:border-[var(--gold-primary)] transition cursor-pointer disabled:opacity-30"
            title="减少一格"
          >
            <Minus size={12} />
          </button>
          <span className="text-[11px] text-[var(--text-secondary)] font-mono min-w-[24px] text-center">
            {gridState.cells.length}
          </span>
          <button
            onClick={addCell}
            disabled={isGenerating}
            className="p-1.5 text-[var(--text-muted)] border border-[var(--border-default)] rounded hover:border-[var(--gold-primary)] transition cursor-pointer disabled:opacity-30"
            title="添加一格"
          >
            <Plus size={12} />
          </button>

          {/* 分隔 */}
          <div className="w-px h-5 bg-[var(--border-default)] mx-1" />

          {/* 一键生图 */}
          <button
            onClick={onGenerateAll}
            disabled={!hasPromptCells || isGenerating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] bg-[var(--gold-primary)] text-[#0A0A0A] rounded hover:brightness-110 transition cursor-pointer disabled:opacity-30"
          >
            {isGenerating ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
            一键生图
          </button>
        </div>
      </div>

      {/* ── 格子网格 ── */}
      <div className="flex-1 overflow-auto p-4">
        {gridState.cells.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-muted)]">
            <ImageIcon size={40} className="opacity-20" />
            <span className="text-[13px]">暂无分镜格子</span>
            <span className="text-[10px]">与智能体对话来创建分镜，或手动添加格子</span>
            <button
              onClick={addCell}
              className="flex items-center gap-1.5 px-4 py-2 text-[11px] border border-[var(--gold-primary)] text-[var(--gold-primary)] rounded hover:bg-[var(--gold-transparent)] transition cursor-pointer"
            >
              <Plus size={12} />
              添加第一个格子
            </button>
          </div>
        ) : (
          <div className="grid gap-4" style={{
            gridTemplateColumns: `repeat(${
              gridState.cells.length <= 3 ? gridState.cells.length
              : gridState.cells.length <= 6 ? 3
              : gridState.cells.length <= 12 ? 4
              : 5
            }, 1fr)`,
          }}>
            {gridState.cells.map((cell) => (
              <ShotCard
                key={cell.id}
                cell={cell}
                onEdit={setEditingCell}
                onDelete={deleteCell}
                onGenerate={onGenerateCell}
                onUpscale={onUpscaleCell}
                isGenerating={isGenerating}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── 编辑弹窗 ── */}
      {editingCell && (
        <CellEditModal
          cell={editingCell}
          onSave={saveCellEdit}
          onClose={() => setEditingCell(null)}
        />
      )}
    </div>
  );
}
