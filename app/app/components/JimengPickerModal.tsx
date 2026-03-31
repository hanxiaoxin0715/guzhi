"use client";

import { useState, useCallback, useEffect } from "react";
import { X, Check, RefreshCw, Loader, Lock } from "lucide-react";

// ═══════════════════════════════════════════════════════════
// JimengPickerModal — 即梦选图结果弹窗
// 支持任意数量的图片选择（2×2 / 3×2 / 自适应网格）
// 用于即梦生图后的四选一，或从生成历史中选图回填
// ═══════════════════════════════════════════════════════════

export interface JimengPickerResult {
  /** 用户选中的图片 URL */
  url: string;
  /** 选中的图片索引 (0-based) */
  index: number;
}

interface JimengPickerModalProps {
  /** 是否显示 */
  open: boolean;
  /** 生成图的 URL 列表（支持任意数量） */
  images: string[];
  /** 当前任务标签，如 "格1 · 角色" */
  label: string;
  /** 是否正在重新生成中 */
  regenerating?: boolean;
  /** 是否显示重新生成按钮（历史选图模式下隐藏） */
  showRegenerate?: boolean;
  /** 确认按钮文字（默认"确认选图"） */
  confirmText?: string;  /** 初始选中索引（持久化回显） */
  initialSelected?: number;
  /** 当前选图是否已锁定 */
  isLocked?: boolean;  /** 用户确认选图 */
  onConfirm: (result: JimengPickerResult) => void;
  /** 重新生成 */
  onRegenerate?: () => void;
  /** 关闭/跳过 */
  onClose: () => void;
}

export default function JimengPickerModal({
  open, images, label, regenerating, showRegenerate = true, confirmText, initialSelected, isLocked,
  onConfirm, onRegenerate, onClose,
}: JimengPickerModalProps) {
  const [selected, setSelected] = useState(initialSelected ?? 0);
  const [zoomIdx, setZoomIdx] = useState<number | null>(null);

  // 重置选中状态当图片列表变化（优先用持久化的索引）
  useEffect(() => { setSelected(initialSelected ?? 0); setZoomIdx(null); }, [images, initialSelected]);

  const handleConfirm = useCallback(() => {
    if (images[selected]) {
      onConfirm({ url: images[selected], index: selected });
    }
  }, [images, selected, onConfirm]);

  // 双击放大预览
  const handleDoubleClick = useCallback((idx: number) => {
    setZoomIdx((prev) => (prev === idx ? null : idx));
  }, []);

  if (!open || images.length === 0) return null;

  // 动态网格列数：1张=1列，2-4张=2列，5-6张=3列，7+=4列
  const gridCols = images.length <= 1 ? 1 : images.length <= 4 ? 2 : images.length <= 6 ? 3 : 4;
  const gridClass = gridCols === 1 ? "grid-cols-1" : gridCols === 2 ? "grid-cols-2" : gridCols === 3 ? "grid-cols-3" : "grid-cols-4";
  // 当图片多于 8 张时限制高度并允许滚动
  const needScroll = images.length > 8;

  return (
    <>
      {/* 遮罩层 */}
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70">
        {/* 弹窗主体 */}
        <div
          className="relative bg-[#111111] border border-[#C9A962]/40 rounded-lg shadow-2xl w-[560px] max-w-[95vw] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#2A2A2A]">
            <div className="flex items-center gap-2.5">
              <span className="px-2 py-0.5 rounded bg-[#C9A962]/20 text-[#C9A962] text-[11px] font-bold tracking-wide">
                即梦选图
              </span>
              {isLocked && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-medium">
                  <Lock size={10} /> 已锁定
                </span>
              )}
              <span className="text-[13px] text-white/90 font-medium truncate max-w-[220px]">
                {label}
              </span>
              <span className="text-[11px] text-white/40">{images.length}张</span>
            </div>
            <button
              onClick={onClose}
              className="text-white/40 hover:text-white transition cursor-pointer p-1 rounded hover:bg-white/10"
              title="关闭"
            >
              <X size={16} />
            </button>
          </div>

          {/* ── 图片网格 ── */}
          <div className="p-4">
            <div className={`grid ${gridClass} gap-2.5 ${needScroll ? "max-h-[50vh] overflow-y-auto pr-1" : ""}`}>
              {images.map((url, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelected(idx)}
                  onDoubleClick={() => handleDoubleClick(idx)}
                  className={`
                    relative aspect-[4/3] rounded-md overflow-hidden cursor-pointer
                    border-2 transition-all duration-200
                    ${selected === idx
                      ? "border-[#C9A962] shadow-[0_0_12px_rgba(201,169,98,0.3)]"
                      : "border-[#2A2A2A] hover:border-[#C9A962]/50"
                    }
                  `}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`选项 ${idx + 1}`}
                    className="w-full h-full object-contain bg-[#0A0A0A]"
                    draggable={false}
                  />
                  {/* 选中标记 */}
                  {selected === idx && (
                    <div className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-[#C9A962] flex items-center justify-center shadow-lg">
                      <Check size={14} className="text-black" strokeWidth={3} />
                    </div>
                  )}
                  {/* 序号标记 */}
                  <div className={`
                    absolute bottom-1.5 left-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                    ${selected === idx
                      ? "bg-[#C9A962] text-black"
                      : "bg-black/60 text-white/70"
                    }
                  `}>
                    {idx + 1}
                  </div>
                </button>
              ))}
            </div>

            {/* 提示文字 */}
            <p className="text-[11px] text-white/30 mt-3 text-center">
              点击选择 · 双击放大 · 确认后应用到宫格
            </p>
          </div>

          {/* ── Action Bar ── */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#2A2A2A] bg-[#0A0A0A]">
            {showRegenerate && onRegenerate ? (
              <button
                onClick={onRegenerate}
                disabled={regenerating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-medium
                  border border-[#C9A962]/40 text-[#C9A962] hover:bg-[#C9A962]/10 transition
                  disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {regenerating ? <Loader size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                重新生成
              </button>
            ) : (
              <div /> /* 占位，确保确认按钮靠右 */
            )}
            <button
              onClick={handleConfirm}
              disabled={regenerating || !images[selected]}
              className="flex items-center gap-1.5 px-5 py-1.5 rounded text-[12px] font-bold
                bg-[#C9A962] text-black hover:bg-[#D4B96E] transition shadow
                disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Check size={14} strokeWidth={3} />
              {confirmText || "确认选图并锁定"}
            </button>
          </div>
        </div>
      </div>

      {/* ── 放大预览浮层 ── */}
      {zoomIdx !== null && images[zoomIdx] && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 cursor-pointer"
          onClick={() => setZoomIdx(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setZoomIdx(null)}
              className="absolute -top-10 right-0 text-white/60 hover:text-white cursor-pointer"
            >
              <X size={24} />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={images[zoomIdx]}
              alt={`放大预览 ${zoomIdx + 1}`}
              className="max-w-full max-h-[85vh] object-contain rounded"
            />
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-white/70 text-[12px]">
              {zoomIdx + 1} / {images.length}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
