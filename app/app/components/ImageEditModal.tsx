"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  X, Upload, Plus, ZoomIn, LayoutGrid, MousePointer, Trash2, Undo2,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface ImageEditRequest {
  cellKey: string;
  gridMode: "nine" | "four";
  imgUrl: string;          // original cell image (data URL or http)
  cellPrompt: string;      // existing prompt for context
}

export interface ImageEditResult {
  cellKey: string;
  imageUrl: string;        // new image data URL
}

/** A numbered coordinate marker placed on the image */
interface CoordMarker {
  id: number;              // sequential number 1, 2, 3...
  /** Normalised coordinates 0-1 relative to image dimensions */
  nx: number;
  ny: number;
  description: string;
}

interface ImageEditModalProps {
  request: ImageEditRequest;
  onClose: () => void;
  /** Fire-and-forget: modal closes immediately after calling this. */
  onSubmit: (description: string, annotatedImage: string | null, refImages: string[]) => void;
  /** Consistency profile reference images for picker */
  consistencyRefs: Array<{ id: string; name: string; image: string; type: "character" | "scene" | "prop" | "style" }>;
  /** Storyboard grid cell images for picker */
  gridCellImages?: Array<{ key: string; label: string; group: string; image: string }>;
}

// ═══════════════════════════════════════════════════════════
// Coordinate Marker Canvas Hook
// ═══════════════════════════════════════════════════════════

function useMarkerCanvas(canvasRef: React.RefObject<HTMLCanvasElement | null>, imgUrl: string) {
  const baseImageRef = useRef<HTMLImageElement | null>(null);
  const isLoadedRef = useRef(false);
  const [markers, setMarkers] = useState<CoordMarker[]>([]);
  const nextIdRef = useRef(1);

  /** Draw base image + all markers */
  const redraw = useCallback((currentMarkers?: CoordMarker[]) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const img = baseImageRef.current;
    if (!ctx || !canvas || !img) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const ms = currentMarkers ?? markers;
    for (const marker of ms) {
      const px = marker.nx * canvas.width;
      const py = marker.ny * canvas.height;
      const radius = Math.max(16, Math.min(canvas.width, canvas.height) * 0.025);

      // Outer ring
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(201, 169, 98, 0.35)";
      ctx.fill();
      ctx.strokeStyle = "#C9A962";
      ctx.lineWidth = 3;
      ctx.stroke();

      // Centre dot
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#C9A962";
      ctx.fill();

      // Number label
      const label = String(marker.id);
      const fontSize = Math.max(14, radius * 0.9);
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // badge background
      const tw = ctx.measureText(label).width;
      const badgeW = tw + 10;
      const badgeH = fontSize + 6;
      const bx = px + radius * 0.7;
      const by = py - radius * 0.7;
      ctx.fillStyle = "#C9A962";
      ctx.beginPath();
      ctx.roundRect(bx - badgeW / 2, by - badgeH / 2, badgeW, badgeH, 4);
      ctx.fill();
      ctx.fillStyle = "#0A0A0A";
      ctx.fillText(label, bx, by + 1);
    }
  }, [canvasRef, markers]);

  // Load image
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      baseImageRef.current = img;
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      isLoadedRef.current = true;
    };
    img.onerror = () => {
      canvas.width = 1024;
      canvas.height = 1024;
      ctx.fillStyle = "#1a1a1a";
      ctx.fillRect(0, 0, 1024, 1024);
      isLoadedRef.current = true;
    };
    img.src = imgUrl;
  }, [canvasRef, imgUrl]);

  // Redraw whenever markers change
  useEffect(() => {
    if (isLoadedRef.current) redraw();
  }, [markers, redraw]);

  /** Get canvas-relative normalised coords from mouse event */
  const getPos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { nx: 0, ny: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      nx: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      ny: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }, [canvasRef]);

  /** Add a marker at click position */
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isLoadedRef.current) return;
    const { nx, ny } = getPos(e);
    const newMarker: CoordMarker = { id: nextIdRef.current++, nx, ny, description: "" };
    setMarkers((prev) => [...prev, newMarker]);
  }, [getPos]);

  /** Update description for a marker */
  const updateDescription = useCallback((id: number, desc: string) => {
    setMarkers((prev) => prev.map((m) => m.id === id ? { ...m, description: desc } : m));
  }, []);

  /** Remove a marker */
  const removeMarker = useCallback((id: number) => {
    setMarkers((prev) => {
      const filtered = prev.filter((m) => m.id !== id);
      // Re-number sequentially
      const renumbered = filtered.map((m, i) => ({ ...m, id: i + 1 }));
      nextIdRef.current = renumbered.length + 1;
      return renumbered;
    });
  }, []);

  /** Remove last marker */
  const undoLastMarker = useCallback(() => {
    setMarkers((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      nextIdRef.current = next.length + 1;
      return next;
    });
  }, []);

  /** Clear all markers */
  const clearAllMarkers = useCallback(() => {
    setMarkers([]);
    nextIdRef.current = 1;
  }, []);

  /**
   * Get an annotated version of the original image with numbered markers drawn on it.
   * This is sent to the AI model so it can see exactly which positions the user wants to modify.
   */
  const getAnnotatedImage = useCallback((): string | null => {
    if (markers.length === 0) return null;
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.toDataURL("image/jpeg", 0.85);
  }, [markers, canvasRef]);

  return {
    markers,
    handleClick,
    updateDescription,
    removeMarker,
    undoLastMarker,
    clearAllMarkers,
    getAnnotatedImage,
  };
}

// ═══════════════════════════════════════════════════════════
// ImageEditModal Component
// ═══════════════════════════════════════════════════════════

export default function ImageEditModal({ request, onClose, onSubmit, consistencyRefs, gridCellImages = [] }: ImageEditModalProps) {
  const { cellKey, imgUrl, cellPrompt } = request;

  // Global description (整体描述，可选)
  const [globalDesc, setGlobalDesc] = useState("");

  // Independent reference images (max 4, NOT connected to global refs)
  const [editRefs, setEditRefs] = useState<string[]>([]);

  // Show consistency ref picker
  const [showRefPicker, setShowRefPicker] = useState(false);

  // Show grid cell image picker
  const [showGridPicker, setShowGridPicker] = useState(false);

  // Zoomed reference image preview
  const [zoomedRef, setZoomedRef] = useState<string | null>(null);

  // Canvas ref
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const {
    markers,
    handleClick,
    updateDescription,
    removeMarker,
    undoLastMarker,
    clearAllMarkers,
    getAnnotatedImage,
  } = useMarkerCanvas(canvasRef, imgUrl);

  // Circle cursor state — no longer needed (was for brush)

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (zoomedRef) { setZoomedRef(null); return; }
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, zoomedRef]);

  // Add reference image from file upload
  const handleUploadRef = useCallback(() => {
    if (editRefs.length >= 4) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (ev: Event) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setEditRefs((prev) => prev.length >= 4 ? prev : [...prev, dataUrl]);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, [editRefs.length]);

  // Add from consistency profile
  const handleAddConsistencyRef = useCallback((image: string) => {
    setEditRefs((prev) => {
      if (prev.length >= 4 || prev.includes(image)) return prev;
      return [...prev, image];
    });
    setShowRefPicker(false);
  }, []);

  // Add from grid cell images (storyboard)
  const handleAddGridRef = useCallback((image: string) => {
    setEditRefs((prev) => {
      if (prev.length >= 4 || prev.includes(image)) return prev;
      return [...prev, image];
    });
    setShowGridPicker(false);
  }, []);

  // Remove ref
  const handleRemoveRef = useCallback((idx: number) => {
    setEditRefs((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // Build the combined description from markers + global
  const buildDescription = useCallback(() => {
    const parts: string[] = [];

    // If there are coordinate markers, build positional instructions
    if (markers.length > 0) {
      const markerDescs = markers
        .filter((m) => m.description.trim())
        .map((m) => {
          const xPct = Math.round(m.nx * 100);
          const yPct = Math.round(m.ny * 100);
          return `坐标${m.id}（位置：从左${xPct}%，从上${yPct}%）：${m.description.trim()}`;
        });
      if (markerDescs.length > 0) {
        parts.push("请根据以下坐标位置的修改要求，对图片中对应位置进行精确修改。图片中已用金色圆圈和编号标记了各坐标位置：\n" + markerDescs.join("\n"));
      }
    }

    // Global description
    if (globalDesc.trim()) {
      parts.push(globalDesc.trim());
    }

    if (parts.length === 0) return "";

    // When markers exist, add explicit instruction to remove marker overlays from output
    const markerCleanup = markers.length > 0
      ? "\n\n重要：参考图中的金色圆圈、编号标记（1、2、3…）仅用于标示修改位置，不是图片内容的一部分。生成的最终图片中绝对不能出现这些坐标标记、圆圈或数字编号，必须完全去除。"
      : "";

    return parts.join("\n\n") + "\n\n注意：保持图片整体构图和风格一致性，仅按照描述进行指定的调整。未提及的区域保持不变。" + markerCleanup;
  }, [markers, globalDesc]);

  // Submit handler — fire-and-forget, modal closes immediately via onSubmit callback
  const handleSubmit = useCallback(() => {
    const desc = buildDescription();
    if (!desc) return;
    const annotated = getAnnotatedImage(); // image with markers drawn on it, or null
    onSubmit(desc, annotated, editRefs);
  }, [buildDescription, getAnnotatedImage, onSubmit, editRefs]);

  const hasMarkerDescs = markers.some((m) => m.description.trim());
  const canSubmit = hasMarkerDescs || globalDesc.trim().length > 0;

  // Parse cellKey to get readable title
  const cellLabel = (() => {
    if (cellKey.startsWith("nine-")) {
      const idx = parseInt(cellKey.split("-").pop() || "0");
      return `九宫格 格${idx + 1}`;
    }
    if (cellKey.startsWith("four-")) {
      const parts = cellKey.split("-");
      const labels = ["左上", "右上", "左下", "右下"];
      const cellIdx = parseInt(parts[parts.length - 1] || "0");
      return `四宫格 ${labels[cellIdx] || `格${cellIdx + 1}`}`;
    }
    return "图片编辑";
  })();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="relative flex bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg shadow-2xl overflow-hidden"
        style={{ width: "min(1120px, 95vw)", height: "min(780px, 92vh)" }}>

        {/* Close button */}
        <button onClick={onClose}
          className="absolute top-3 right-3 z-50 flex items-center justify-center w-8 h-8 rounded-full bg-[#2A2A2A] hover:bg-[#3A3A3A] text-[#999] hover:text-white transition cursor-pointer"
          title="关闭 (Esc)">
          <X size={16} />
        </button>

        {/* ═══ Left: Canvas Area ═══ */}
        <div className="flex flex-col flex-1 min-w-0 border-r border-[#2A2A2A]">
          {/* Title bar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2A2A2A]">
            <MousePointer size={14} className="text-[#C9A962]" />
            <span className="text-[13px] font-semibold text-white">{cellLabel} — 图片编辑</span>
            <span className="px-2 py-0.5 text-[10px] bg-[#C9A962]/20 text-[#C9A962] rounded">
              坐标标记模式
            </span>
            {markers.length > 0 && (
              <span className="text-[10px] text-[#999]">已标记 {markers.length} 个坐标</span>
            )}
          </div>

          {/* Canvas */}
          <div className="flex-1 flex items-center justify-center bg-[#111] overflow-hidden p-4">
            <canvas
              ref={canvasRef}
              className="max-w-full max-h-full object-contain rounded cursor-crosshair"
              style={{ imageRendering: "auto" }}
              onClick={handleClick}
            />
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-t border-[#2A2A2A] bg-[#0A0A0A]">
            <button onClick={undoLastMarker} disabled={markers.length === 0}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-[#999] hover:text-white bg-[#1a1a1a] hover:bg-[#2a2a2a] rounded cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed">
              <Undo2 size={11} /> 撤销
            </button>
            <button onClick={clearAllMarkers} disabled={markers.length === 0}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-[#999] hover:text-white bg-[#1a1a1a] hover:bg-[#2a2a2a] rounded cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed">
              <Trash2 size={11} /> 清除所有标记
            </button>
            <div className="flex-1" />
            <span className="text-[10px] text-[#666]">
              💡 点击图片放置坐标标记，在右侧输入每个坐标的修改描述
            </span>
          </div>
        </div>

        {/* ═══ Right: Control Panel ═══ */}
        <div className="flex flex-col w-[340px] shrink-0 bg-[#0A0A0A]">
          {/* Coordinate marker descriptions */}
          <div className="flex flex-col gap-2 p-4 border-b border-[#2A2A2A] flex-1 overflow-auto">
            <label className="text-[12px] font-semibold text-white">
              坐标修改描述
            </label>

            {markers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <MousePointer size={24} className="text-[#333] mb-2" />
                <span className="text-[11px] text-[#555]">点击左侧图片添加坐标标记</span>
                <span className="text-[10px] text-[#444] mt-1">每个标记可输入对应位置的修改描述</span>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {markers.map((marker) => (
                  <div key={marker.id} className="flex flex-col gap-1 p-2 bg-[#141414] border border-[#2A2A2A] rounded">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold bg-[#C9A962] text-[#0A0A0A] rounded">
                          {marker.id}
                        </span>
                        <span className="text-[10px] text-[#666]">
                          ({Math.round(marker.nx * 100)}%, {Math.round(marker.ny * 100)}%)
                        </span>
                      </div>
                      <button onClick={() => removeMarker(marker.id)}
                        className="w-5 h-5 flex items-center justify-center text-[#666] hover:text-red-400 cursor-pointer transition">
                        <X size={12} />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={marker.description}
                      onChange={(e) => updateDescription(marker.id, e.target.value)}
                      placeholder={`坐标${marker.id}：描述此处要修改的内容...`}
                      className="w-full px-2 py-1.5 text-[11px] text-white bg-[#0E0E0E] border border-[#2A2A2A] rounded outline-none focus:border-[#C9A962] placeholder:text-[#444] transition"
                      autoFocus
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Global description (optional) */}
            <div className="flex flex-col gap-1 mt-2">
              <label className="text-[11px] text-[#999]">整体描述（可选）</label>
              <textarea
                value={globalDesc}
                onChange={(e) => setGlobalDesc(e.target.value)}
                placeholder="其他不针对特定坐标的整体修改描述..."
                className="w-full h-[60px] px-2 py-1.5 text-[11px] leading-relaxed text-white bg-[#141414] border border-[#2A2A2A] rounded resize-none outline-none focus:border-[#C9A962] placeholder:text-[#444] transition"
              />
            </div>
          </div>

          {/* Reference Images */}
          <div className="flex flex-col gap-2 p-4 border-b border-[#2A2A2A]">
            <div className="flex items-center justify-between">
              <label className="text-[12px] font-semibold text-white">参考图（可选）</label>
              <span className="text-[10px] text-[#666]">💡 最多可添加 4 张参考图</span>
            </div>

            {/* Ref image grid */}
            <div className="flex flex-wrap gap-2 mt-1">
              {editRefs.map((refUrl, idx) => (
                <div key={idx} className="relative w-[72px] h-[72px] bg-[#141414] border border-[#2A2A2A] rounded overflow-hidden group">
                  <img src={refUrl} alt="" className="w-full h-full object-contain" />
                  {/* Order badge — always visible at bottom-right */}
                  <span className="absolute bottom-0 right-0 min-w-[18px] h-[16px] flex items-center justify-center text-[9px] font-bold bg-[#C9A962] text-[#0A0A0A] rounded-tl z-10">
                    参{idx + 1}
                  </span>
                  {/* Zoom button (visible on hover) */}
                  <button onClick={() => setZoomedRef(refUrl)}
                    className="absolute bottom-0 left-0 w-5 h-5 flex items-center justify-center bg-black/60 hover:bg-black/80 text-white/70 hover:text-white rounded-tr opacity-0 group-hover:opacity-100 cursor-pointer transition z-10">
                    <ZoomIn size={10} />
                  </button>
                  {/* Always-visible delete button */}
                  <button onClick={() => handleRemoveRef(idx)}
                    className="absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center bg-red-500 hover:bg-red-600 text-white rounded-full shadow cursor-pointer transition z-10">
                    <X size={10} />
                  </button>
                </div>
              ))}
              {editRefs.length < 4 && (
                <div className="flex gap-1.5">
                  <button onClick={handleUploadRef}
                    className="w-[72px] h-[72px] flex flex-col items-center justify-center gap-1 bg-[#141414] border border-dashed border-[#2A2A2A] hover:border-[#C9A962] rounded cursor-pointer transition text-[#666] hover:text-[#C9A962]">
                    <Upload size={14} />
                    <span className="text-[9px]">上传</span>
                  </button>
                  {consistencyRefs.length > 0 && (
                    <button onClick={() => { setShowRefPicker(!showRefPicker); setShowGridPicker(false); }}
                      className="w-[72px] h-[72px] flex flex-col items-center justify-center gap-1 bg-[#141414] border border-dashed border-[#2A2A2A] hover:border-[#C9A962] rounded cursor-pointer transition text-[#666] hover:text-[#C9A962]">
                      <Plus size={14} />
                      <span className="text-[9px]">一致性</span>
                    </button>
                  )}
                  {gridCellImages.length > 0 && (
                    <button onClick={() => { setShowGridPicker(!showGridPicker); setShowRefPicker(false); }}
                      className="w-[72px] h-[72px] flex flex-col items-center justify-center gap-1 bg-[#141414] border border-dashed border-[#2A2A2A] hover:border-[#C9A962] rounded cursor-pointer transition text-[#666] hover:text-[#C9A962]">
                      <LayoutGrid size={14} />
                      <span className="text-[9px]">分镜图</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Consistency ref picker */}
            {showRefPicker && (
              <div className="flex flex-col gap-1.5 mt-2 p-2 bg-[#141414] border border-[#2A2A2A] rounded max-h-[160px] overflow-auto">
                <span className="text-[10px] text-[#999] mb-1">从一致性档案选择：</span>
                {consistencyRefs.map((ref) => (
                  <button key={ref.id} onClick={() => handleAddConsistencyRef(ref.image)}
                    disabled={editRefs.includes(ref.image) || editRefs.length >= 4}
                    className="flex items-center gap-2 p-1.5 hover:bg-[#1a1a1a] rounded cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed">
                    <img src={ref.image} alt="" className="w-8 h-8 object-cover rounded border border-[#2A2A2A]" />
                    <div className="flex flex-col">
                      <span className="text-[11px] text-white">{ref.name}</span>
                      <span className="text-[9px] text-[#666]">{ref.type === "character" ? "角色" : ref.type === "scene" ? "场景" : ref.type === "prop" ? "道具" : "风格"}</span>
                    </div>
                    {editRefs.includes(ref.image) && <span className="text-[9px] text-[#C9A962] ml-auto">已添加</span>}
                  </button>
                ))}
                {consistencyRefs.length === 0 && (
                  <span className="text-[10px] text-[#666]">暂无可用参考图</span>
                )}
              </div>
            )}

            {/* Grid cell image picker (storyboard) */}
            {showGridPicker && (
              <div className="flex flex-col gap-1.5 mt-2 p-2 bg-[#141414] border border-[#2A2A2A] rounded max-h-[220px] overflow-auto">
                <span className="text-[10px] text-[#999] mb-1">从分镜图选择：</span>
                {(() => {
                  const groups = new Map<string, typeof gridCellImages>();
                  for (const item of gridCellImages) {
                    if (!groups.has(item.group)) groups.set(item.group, []);
                    groups.get(item.group)!.push(item);
                  }
                  return Array.from(groups.entries()).map(([group, items]) => (
                    <div key={group} className="flex flex-col gap-1">
                      <span className="text-[10px] text-[#C9A962] font-semibold">{group}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {items.map((item) => {
                          const isAdded = editRefs.includes(item.image);
                          const isSelf = item.key === cellKey;
                          return (
                            <button key={item.key} onClick={() => handleAddGridRef(item.image)}
                              disabled={isAdded || isSelf || editRefs.length >= 4}
                              title={isSelf ? "当前编辑图片" : item.label}
                              className="relative w-[52px] flex flex-col items-center gap-0.5 p-1 hover:bg-[#1a1a1a] rounded cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed">
                              <img src={item.image} alt="" className={`w-10 h-10 object-cover rounded border ${isSelf ? "border-[#C9A962]" : "border-[#2A2A2A]"}`} />
                              <span className="text-[8px] text-[#999] truncate w-full text-center">{item.label}</span>
                              {isAdded && <span className="absolute top-0 right-0 w-3 h-3 bg-[#C9A962] rounded-full flex items-center justify-center text-[7px] text-black font-bold">✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()}
                {gridCellImages.length === 0 && (
                  <span className="text-[10px] text-[#666]">暂无可用分镜图</span>
                )}
              </div>
            )}

            {/* Tip */}
            <p className="text-[10px] text-[#555] mt-1 leading-relaxed">
              参考图完全独立于全局绑定，仅用于本次编辑。关闭后自动清除。
            </p>
          </div>

          {/* Submit / Cancel */}
          <div className="flex flex-col gap-2 p-4">
            {/* Mode indicator */}
            <div className="flex items-center gap-2 px-3 py-2 bg-[#141414] border border-[#2A2A2A] rounded text-[10px]">
              {markers.length > 0 ? (
                <span className="text-[#C9A962]">📍 坐标模式 — 原图 + 标记坐标 + 描述 + 参考图 → AI精确修改</span>
              ) : (
                <span className="text-[#999]">✨ 整体模式 — 原图 + 描述 + 参考图 → AI整体调整</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button onClick={onClose}
                className="flex-1 flex items-center justify-center gap-1 px-4 py-2.5 text-[12px] text-[#999] bg-[#1a1a1a] hover:bg-[#2a2a2a] border border-[#2A2A2A] rounded cursor-pointer transition">
                取消
              </button>
              <button onClick={handleSubmit} disabled={!canSubmit}
                className="flex-1 flex items-center justify-center gap-1 px-4 py-2.5 text-[12px] text-[#0A0A0A] bg-[#C9A962] hover:brightness-110 rounded cursor-pointer transition disabled:opacity-40 font-semibold">
                提交编辑
              </button>
            </div>

            {/* Context info */}
            <p className="text-[9px] text-[#444] mt-1 leading-relaxed">
              提交后弹窗自动关闭，后台生成图片。
              {cellPrompt ? ` 原始提示词: ${cellPrompt.slice(0, 50)}...` : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Zoomed reference image preview */}
      {zoomedRef && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm cursor-pointer"
          onClick={() => setZoomedRef(null)}>
          <img src={zoomedRef} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl" />
          <button onClick={() => setZoomedRef(null)}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition cursor-pointer">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
