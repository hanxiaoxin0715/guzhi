"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  X, Check, Maximize2, Layers, RotateCcw, SlidersHorizontal,
  Image as ImageIcon,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════
// 排版模板系统
// ═══════════════════════════════════════════════════════════

/** 单个 Cell 的相对区域（0~1 范围），用于 Canvas drawImage */
interface LayoutCell {
  x: number; // 左边距（相对画布宽度 0~1）
  y: number; // 顶边距（相对画布高度 0~1）
  w: number; // 宽度（相对画布宽度 0~1）
  h: number; // 高度（相对画布高度 0~1）
}

interface LayoutTemplate {
  id: string;
  name: string;
  /** 画布宽高比（width/height），如 1.0=正方形, 1.5=横版, 0.75=竖版 */
  aspect: number;
  cells: LayoutCell[];
}

/**
 * 自动生成排版模板（根据图片数量）
 * 每种数量提供 3-4 种排版，用户可选择切换
 */
function getTemplatesForCount(count: number): LayoutTemplate[] {
  if (count <= 0) return [];
  if (count === 1) return [{
    id: "1-full", name: "单图", aspect: 1.0,
    cells: [{ x: 0, y: 0, w: 1, h: 1 }],
  }];

  if (count === 2) return [
    {
      id: "2-h", name: "横排", aspect: 2.0,
      cells: [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }],
    },
    {
      id: "2-v", name: "竖排", aspect: 0.5,
      cells: [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }],
    },
    {
      id: "2-big-small", name: "1大+1小", aspect: 1.5,
      cells: [{ x: 0, y: 0, w: 0.667, h: 1 }, { x: 0.667, y: 0, w: 0.333, h: 1 }],
    },
  ];

  if (count === 3) return [
    {
      id: "3-h", name: "横排三等分", aspect: 3.0,
      cells: [
        { x: 0, y: 0, w: 1 / 3, h: 1 },
        { x: 1 / 3, y: 0, w: 1 / 3, h: 1 },
        { x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
      ],
    },
    {
      id: "3-1big-2small", name: "1大+2小", aspect: 1.5,
      cells: [
        { x: 0, y: 0, w: 0.667, h: 1 },
        { x: 0.667, y: 0, w: 0.333, h: 0.5 },
        { x: 0.667, y: 0.5, w: 0.333, h: 0.5 },
      ],
    },
    {
      id: "3-2small-1big", name: "2小+1大", aspect: 1.5,
      cells: [
        { x: 0, y: 0, w: 0.333, h: 0.5 },
        { x: 0, y: 0.5, w: 0.333, h: 0.5 },
        { x: 0.333, y: 0, w: 0.667, h: 1 },
      ],
    },
    {
      id: "3-top1-bot2", name: "上1下2", aspect: 1.0,
      cells: [
        { x: 0, y: 0, w: 1, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
      ],
    },
  ];

  if (count === 4) return [
    {
      id: "4-grid", name: "2×2 网格", aspect: 1.0,
      cells: [
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
      ],
    },
    {
      id: "4-1big-3small", name: "1大+3小", aspect: 1.5,
      cells: [
        { x: 0, y: 0, w: 0.667, h: 1 },
        { x: 0.667, y: 0, w: 0.333, h: 1 / 3 },
        { x: 0.667, y: 1 / 3, w: 0.333, h: 1 / 3 },
        { x: 0.667, y: 2 / 3, w: 0.333, h: 1 / 3 },
      ],
    },
    {
      id: "4-top3-bot1", name: "上3下1", aspect: 1.5,
      cells: [
        { x: 0, y: 0, w: 1 / 3, h: 0.5 },
        { x: 1 / 3, y: 0, w: 1 / 3, h: 0.5 },
        { x: 2 / 3, y: 0, w: 1 / 3, h: 0.5 },
        { x: 0, y: 0.5, w: 1, h: 0.5 },
      ],
    },
    {
      id: "4-h", name: "横排", aspect: 4.0,
      cells: [
        { x: 0, y: 0, w: 0.25, h: 1 },
        { x: 0.25, y: 0, w: 0.25, h: 1 },
        { x: 0.5, y: 0, w: 0.25, h: 1 },
        { x: 0.75, y: 0, w: 0.25, h: 1 },
      ],
    },
  ];

  if (count === 5) return [
    {
      id: "5-top2-bot3", name: "上2下3", aspect: 1.5,
      cells: [
        { x: 0, y: 0, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0.5, w: 1 / 3, h: 0.5 },
        { x: 1 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
        { x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
      ],
    },
    {
      id: "5-top3-bot2", name: "上3下2", aspect: 1.5,
      cells: [
        { x: 0, y: 0, w: 1 / 3, h: 0.5 },
        { x: 1 / 3, y: 0, w: 1 / 3, h: 0.5 },
        { x: 2 / 3, y: 0, w: 1 / 3, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
      ],
    },
    {
      id: "5-1big-4small", name: "1大+4小", aspect: 1.5,
      cells: [
        { x: 0, y: 0, w: 0.667, h: 1 },
        { x: 0.667, y: 0, w: 0.333, h: 0.25 },
        { x: 0.667, y: 0.25, w: 0.333, h: 0.25 },
        { x: 0.667, y: 0.5, w: 0.333, h: 0.25 },
        { x: 0.667, y: 0.75, w: 0.333, h: 0.25 },
      ],
    },
  ];

  if (count === 6) return [
    {
      id: "6-2x3", name: "2×3 网格", aspect: 1.5,
      cells: [
        { x: 0, y: 0, w: 1 / 3, h: 0.5 },
        { x: 1 / 3, y: 0, w: 1 / 3, h: 0.5 },
        { x: 2 / 3, y: 0, w: 1 / 3, h: 0.5 },
        { x: 0, y: 0.5, w: 1 / 3, h: 0.5 },
        { x: 1 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
        { x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
      ],
    },
    {
      id: "6-3x2", name: "3×2 网格", aspect: 0.667,
      cells: [
        { x: 0, y: 0, w: 0.5, h: 1 / 3 },
        { x: 0.5, y: 0, w: 0.5, h: 1 / 3 },
        { x: 0, y: 1 / 3, w: 0.5, h: 1 / 3 },
        { x: 0.5, y: 1 / 3, w: 0.5, h: 1 / 3 },
        { x: 0, y: 2 / 3, w: 0.5, h: 1 / 3 },
        { x: 0.5, y: 2 / 3, w: 0.5, h: 1 / 3 },
      ],
    },
    {
      id: "6-1big-5small", name: "1大+5小", aspect: 1.5,
      cells: [
        { x: 0, y: 0, w: 0.6, h: 1 },
        { x: 0.6, y: 0, w: 0.4, h: 0.2 },
        { x: 0.6, y: 0.2, w: 0.4, h: 0.2 },
        { x: 0.6, y: 0.4, w: 0.4, h: 0.2 },
        { x: 0.6, y: 0.6, w: 0.4, h: 0.2 },
        { x: 0.6, y: 0.8, w: 0.4, h: 0.2 },
      ],
    },
  ];

  if (count === 7) return [
    {
      id: "7-top3-bot4", name: "上3下4", aspect: 4 / 3,
      cells: [
        { x: 0, y: 0, w: 1 / 3, h: 0.5 }, { x: 1 / 3, y: 0, w: 1 / 3, h: 0.5 }, { x: 2 / 3, y: 0, w: 1 / 3, h: 0.5 },
        { x: 0, y: 0.5, w: 0.25, h: 0.5 }, { x: 0.25, y: 0.5, w: 0.25, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.25, h: 0.5 }, { x: 0.75, y: 0.5, w: 0.25, h: 0.5 },
      ],
    },
    {
      id: "7-top4-bot3", name: "上4下3", aspect: 4 / 3,
      cells: [
        { x: 0, y: 0, w: 0.25, h: 0.5 }, { x: 0.25, y: 0, w: 0.25, h: 0.5 }, { x: 0.5, y: 0, w: 0.25, h: 0.5 }, { x: 0.75, y: 0, w: 0.25, h: 0.5 },
        { x: 0, y: 0.5, w: 1 / 3, h: 0.5 }, { x: 1 / 3, y: 0.5, w: 1 / 3, h: 0.5 }, { x: 2 / 3, y: 0.5, w: 1 / 3, h: 0.5 },
      ],
    },
  ];

  if (count === 8) return [
    {
      id: "8-2x4", name: "2×4 网格", aspect: 2.0,
      cells: Array.from({ length: 8 }, (_, i) => ({
        x: (i % 4) * 0.25, y: Math.floor(i / 4) * 0.5, w: 0.25, h: 0.5,
      })),
    },
    {
      id: "8-4x2", name: "4×2 网格", aspect: 0.5,
      cells: Array.from({ length: 8 }, (_, i) => ({
        x: (i % 2) * 0.5, y: Math.floor(i / 2) * 0.25, w: 0.5, h: 0.25,
      })),
    },
    {
      id: "8-top3-mid3-bot2", name: "上3中3下2", aspect: 1.0,
      cells: [
        { x: 0, y: 0, w: 1 / 3, h: 1 / 3 }, { x: 1 / 3, y: 0, w: 1 / 3, h: 1 / 3 }, { x: 2 / 3, y: 0, w: 1 / 3, h: 1 / 3 },
        { x: 0, y: 1 / 3, w: 1 / 3, h: 1 / 3 }, { x: 1 / 3, y: 1 / 3, w: 1 / 3, h: 1 / 3 }, { x: 2 / 3, y: 1 / 3, w: 1 / 3, h: 1 / 3 },
        { x: 0, y: 2 / 3, w: 0.5, h: 1 / 3 }, { x: 0.5, y: 2 / 3, w: 0.5, h: 1 / 3 },
      ],
    },
  ];

  // count === 9
  return [
    {
      id: "9-3x3", name: "3×3 网格", aspect: 1.0,
      cells: Array.from({ length: 9 }, (_, i) => ({
        x: (i % 3) * (1 / 3), y: Math.floor(i / 3) * (1 / 3), w: 1 / 3, h: 1 / 3,
      })),
    },
    {
      id: "9-top2-mid3-bot4", name: "上2中3下4", aspect: 4 / 3,
      cells: [
        { x: 0, y: 0, w: 0.5, h: 1 / 3 }, { x: 0.5, y: 0, w: 0.5, h: 1 / 3 },
        { x: 0, y: 1 / 3, w: 1 / 3, h: 1 / 3 }, { x: 1 / 3, y: 1 / 3, w: 1 / 3, h: 1 / 3 }, { x: 2 / 3, y: 1 / 3, w: 1 / 3, h: 1 / 3 },
        { x: 0, y: 2 / 3, w: 0.25, h: 1 / 3 }, { x: 0.25, y: 2 / 3, w: 0.25, h: 1 / 3 }, { x: 0.5, y: 2 / 3, w: 0.25, h: 1 / 3 }, { x: 0.75, y: 2 / 3, w: 0.25, h: 1 / 3 },
      ],
    },
    {
      id: "9-1big-8small", name: "1大+8小", aspect: 1.5,
      cells: [
        { x: 0, y: 0, w: 0.5, h: 1 },
        { x: 0.5, y: 0, w: 0.25, h: 0.25 }, { x: 0.75, y: 0, w: 0.25, h: 0.25 },
        { x: 0.5, y: 0.25, w: 0.25, h: 0.25 }, { x: 0.75, y: 0.25, w: 0.25, h: 0.25 },
        { x: 0.5, y: 0.5, w: 0.25, h: 0.25 }, { x: 0.75, y: 0.5, w: 0.25, h: 0.25 },
        { x: 0.5, y: 0.75, w: 0.25, h: 0.25 }, { x: 0.75, y: 0.75, w: 0.25, h: 0.25 },
      ],
    },
  ];
}

// ═══════════════════════════════════════════════════════════
// Canvas 合成引擎
// ═══════════════════════════════════════════════════════════

/** 加载图片为 HTMLImageElement */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`加载图片失败: ${src.slice(0, 60)}`));
    img.src = src;
  });
}

/**
 * 将图片 drawImage 到 cell 区域，完整适配居中（object-fit: contain 模式）
 * 图片不裁剪，等比缩放至完全可见，空白区域保留背景色
 */
function drawContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number, dy: number, dw: number, dh: number,
  radius: number,
) {
  const imgAspect = img.width / img.height;
  const cellAspect = dw / dh;

  let drawX = dx, drawY = dy, drawW = dw, drawH = dh;
  if (imgAspect > cellAspect) {
    // 图片更宽 → 宽度铺满，高度缩小居中
    drawH = dw / imgAspect;
    drawY = dy + (dh - drawH) / 2;
  } else {
    // 图片更高 → 高度铺满，宽度缩小居中
    drawW = dh * imgAspect;
    drawX = dx + (dw - drawW) / 2;
  }

  ctx.save();
  if (radius > 0) {
    ctx.beginPath();
    ctx.roundRect(dx, dy, dw, dh, radius);
    ctx.clip();
  }
  // 绘制整张图片（无裁剪），居中放置
  ctx.drawImage(img, 0, 0, img.width, img.height, drawX, drawY, drawW, drawH);
  ctx.restore();
}

/** 合成选中图片到 Canvas，返回 PNG data URL */
export async function compositeImages(
  imageUrls: string[],
  template: LayoutTemplate,
  options: {
    baseWidth?: number; // 画布基础宽度 px（默认 2048）
    gap?: number;       // 间距 px（默认 0）
    radius?: number;    // 圆角 px（默认 0）
    bgColor?: string;   // 背景色（默认 #0A0A0A）
  } = {},
): Promise<string> {
  const { baseWidth = 2048, gap = 0, radius = 0, bgColor = "#0A0A0A" } = options;

  const canvasW = baseWidth;
  const canvasH = Math.round(baseWidth / template.aspect);

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 创建失败");

  // 填充背景
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 加载所有图片
  const imgs = await Promise.all(
    imageUrls.slice(0, template.cells.length).map((url) => loadImage(url)),
  );

  // 绘制每个 cell
  const halfGap = gap / 2;
  for (let i = 0; i < Math.min(imgs.length, template.cells.length); i++) {
    const cell = template.cells[i];
    const dx = Math.round(cell.x * canvasW + halfGap);
    const dy = Math.round(cell.y * canvasH + halfGap);
    const dw = Math.round(cell.w * canvasW - gap);
    const dh = Math.round(cell.h * canvasH - gap);
    drawContain(ctx, imgs[i], dx, dy, dw, dh, radius);
  }

  return canvas.toDataURL("image/png");
}

// ═══════════════════════════════════════════════════════════
// 图片选项接口
// ═══════════════════════════════════════════════════════════

export interface FusionImageItem {
  id: string;         // consistency item ID
  name: string;       // item 名称
  type: "character" | "scene" | "prop";
  imageUrl: string;   // data URL 或 API URL
}

interface ImageFusionModalProps {
  open: boolean;
  onClose: () => void;
  /** 所有可选的参考图（跨标签页：角色+场景+道具） */
  allItems: FusionImageItem[];
  /** 合成完成回调：返回合成图 data URL 和拼接名称 */
  onComposite: (dataUrl: string, name: string) => void;
}

// ═══════════════════════════════════════════════════════════
// 溶图合成弹窗
// ═══════════════════════════════════════════════════════════

export default function ImageFusionModal({
  open, onClose, allItems, onComposite,
}: ImageFusionModalProps) {
  // 选中图片 ID 列表（有序）
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // 当前排版模板 ID
  const [templateId, setTemplateId] = useState("");
  // 间距（px）
  const [gap, setGap] = useState(8);
  // 圆角（px）
  const [radius, setRadius] = useState(12);
  // 预览 data URL
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // 合成中
  const [compositing, setCompositing] = useState(false);
  // 放大预览
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

  // 可用排版模板
  const templates = useMemo(
    () => getTemplatesForCount(selectedIds.length),
    [selectedIds.length],
  );

  // 选中图片数量变化时自动选第一个模板
  useEffect(() => {
    if (templates.length > 0) {
      setTemplateId(templates[0].id);
    } else {
      setTemplateId("");
    }
  }, [templates]);

  const currentTemplate = templates.find((t) => t.id === templateId) || templates[0] || null;

  // 选中的图片 URL 列表
  const selectedUrls = useMemo(
    () => selectedIds.map((id) => allItems.find((it) => it.id === id)?.imageUrl).filter(Boolean) as string[],
    [selectedIds, allItems],
  );

  // 选中的名称列表
  const selectedNames = useMemo(
    () => selectedIds.map((id) => allItems.find((it) => it.id === id)?.name).filter(Boolean) as string[],
    [selectedIds, allItems],
  );

  // 实时预览生成（debounce 150ms）
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!currentTemplate || selectedUrls.length === 0) {
      setPreviewUrl(null);
      return;
    }
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(async () => {
      try {
        // 预览用较小的基础宽度
        const url = await compositeImages(selectedUrls, currentTemplate, {
          baseWidth: 800,
          gap,
          radius,
        });
        setPreviewUrl(url);
      } catch (e) {
        console.warn("[ImageFusion] 预览生成失败:", e);
      }
    }, 150);
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); };
  }, [selectedUrls, currentTemplate, gap, radius]);

  // 勾选/取消勾选图片
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 9) return prev; // 最多 9 张
      return [...prev, id];
    });
  }, []);

  // 确认合成（使用高分辨率）
  const handleComposite = useCallback(async () => {
    if (!currentTemplate || selectedUrls.length === 0) return;
    setCompositing(true);
    try {
      const dataUrl = await compositeImages(selectedUrls, currentTemplate, {
        baseWidth: 2048,
        gap,
        radius,
      });
      const name = selectedNames.join("+");
      onComposite(dataUrl, name);
      onClose();
    } catch (e) {
      console.error("[ImageFusion] 合成失败:", e);
    } finally {
      setCompositing(false);
    }
  }, [currentTemplate, selectedUrls, gap, radius, selectedNames, onComposite, onClose]);

  // 重置弹窗状态
  useEffect(() => {
    if (open) {
      setSelectedIds([]);
      setPreviewUrl(null);
      setGap(8);
      setRadius(12);
    }
  }, [open]);

  if (!open) return null;

  const typeLabel = (type: "character" | "scene" | "prop") =>
    type === "character" ? "角色" : type === "scene" ? "场景" : "道具";

  const typeColor = (type: "character" | "scene" | "prop") =>
    type === "character" ? "text-blue-400" : type === "scene" ? "text-green-400" : "text-orange-400";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex flex-col w-[780px] max-h-[700px] bg-[#1A1A1A] border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden">
        {/* ── Header ── */}
        <div className="flex items-center justify-between h-14 px-6 shrink-0">
          <div className="flex items-center gap-2.5">
            <Layers size={18} className="text-[var(--gold-primary)]" />
            <span className="text-[16px] font-semibold text-[var(--text-primary)]">溶图合成</span>
            <span className="text-[11px] text-[var(--text-muted)] ml-2">跨角色/场景/道具选择参考图，合成为新条目</span>
          </div>
          <button onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-md bg-[#0A0A0A] hover:bg-[#2A2A2A] cursor-pointer">
            <X size={16} className="text-[var(--text-secondary)]" />
          </button>
        </div>
        <div className="h-px bg-[var(--border-default)]" />

        {/* ── Body: 左选图 + 右预览 ── */}
        <div className="flex flex-1 overflow-hidden">
          {/* 左栏：图片选择 */}
          <div className="w-[300px] flex flex-col border-r border-[var(--border-default)]">
            {/* 选择提示 */}
            <div className="flex items-center gap-2 h-9 px-4 bg-[#0D0D0D] shrink-0 border-b border-[var(--border-default)]">
              <span className="text-[11px] text-[var(--text-muted)]">
                选择 2~9 张参考图（已选 <span className="text-[var(--gold-primary)] font-medium">{selectedIds.length}</span>/9）
              </span>
              {selectedIds.length > 0 && (
                <button onClick={() => setSelectedIds([])}
                  className="ml-auto flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 cursor-pointer">
                  <RotateCcw size={10} />清除
                </button>
              )}
            </div>
            {/* 图片列表 */}
            <div className="flex-1 overflow-auto p-3 space-y-1">
              {allItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2">
                  <ImageIcon size={28} className="text-[var(--text-muted)]" />
                  <span className="text-[12px] text-[var(--text-muted)]">暂无参考图</span>
                  <span className="text-[10px] text-[var(--text-muted)]">请先生成角色/场景/道具参考图</span>
                </div>
              ) : allItems.map((item) => {
                const isSelected = selectedIds.includes(item.id);
                const idx = selectedIds.indexOf(item.id);
                return (
                  <div key={item.id} onClick={() => toggleSelect(item.id)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all ${isSelected
                      ? "bg-[#1A1200] ring-1 ring-[var(--gold-primary)]"
                      : "hover:bg-[#222222]"
                    }`}>
                    {/* 缩略图 */}
                    <div className="relative w-10 h-10 rounded-md overflow-hidden shrink-0 bg-[#0A0A0A]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                      {isSelected && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <span className="text-[12px] font-bold text-[var(--gold-primary)]">{idx + 1}</span>
                        </div>
                      )}
                    </div>
                    {/* 信息 */}
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] text-[var(--text-primary)] truncate">{item.name}</div>
                      <div className={`text-[10px] ${typeColor(item.type)}`}>{typeLabel(item.type)}</div>
                    </div>
                    {/* 勾选框 */}
                    <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${isSelected
                      ? "bg-[var(--gold-primary)]"
                      : "border border-[var(--text-muted)]"
                    }`}>
                      {isSelected && <Check size={12} className="text-[#0A0A0A]" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 右栏：排版选择 + 预览 */}
          <div className="flex-1 flex flex-col">
            {/* 排版模板选择器 */}
            {currentTemplate && templates.length > 0 && (
              <>
                <div className="flex items-center gap-2 h-9 px-4 bg-[#0D0D0D] shrink-0 border-b border-[var(--border-default)]">
                  <SlidersHorizontal size={12} className="text-[var(--gold-primary)]" />
                  <span className="text-[11px] text-[var(--text-muted)]">排版模板</span>
                </div>
                <div className="flex items-center gap-2 px-4 py-3 shrink-0 border-b border-[var(--border-default)] flex-wrap">
                  {templates.map((t) => (
                    <button key={t.id} onClick={() => setTemplateId(t.id)}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition cursor-pointer ${templateId === t.id
                        ? "bg-[var(--gold-primary)] text-[#0A0A0A]"
                        : "bg-[#0A0A0A] border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)]"
                      }`}>
                      {t.name}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* 间距 / 圆角 调节 */}
            {selectedIds.length >= 2 && (
              <div className="flex items-center gap-4 px-4 py-2.5 border-b border-[var(--border-default)] shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[var(--text-muted)] w-8">间距</span>
                  <input type="range" min={0} max={30} step={2} value={gap}
                    onChange={(e) => setGap(Number(e.target.value))}
                    className="w-20 h-1 accent-[var(--gold-primary)] cursor-pointer" />
                  <span className="text-[10px] text-[var(--text-secondary)] w-6 text-right">{gap}px</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[var(--text-muted)] w-8">圆角</span>
                  <input type="range" min={0} max={40} step={4} value={radius}
                    onChange={(e) => setRadius(Number(e.target.value))}
                    className="w-20 h-1 accent-[var(--gold-primary)] cursor-pointer" />
                  <span className="text-[10px] text-[var(--text-secondary)] w-6 text-right">{radius}px</span>
                </div>
              </div>
            )}

            {/* 预览区域 */}
            <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
              {selectedIds.length < 2 ? (
                <div className="flex flex-col items-center gap-3 text-center">
                  <Layers size={36} className="text-[var(--text-muted)]" />
                  <span className="text-[13px] text-[var(--text-muted)]">请在左侧选择至少 2 张图片</span>
                  <span className="text-[11px] text-[var(--text-muted)]">支持跨角色/场景/道具标签页混选</span>
                </div>
              ) : previewUrl ? (
                <div className="relative cursor-pointer group" onClick={() => setZoomUrl(previewUrl)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="预览" className="max-w-full max-h-[360px] object-contain rounded-lg" />
                  <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition">
                    <div className="w-7 h-7 flex items-center justify-center rounded bg-[#0A0A0A80] hover:bg-[#0A0A0AA0]">
                      <Maximize2 size={14} className="text-[var(--gold-primary)]" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-[var(--text-muted)]">
                  <div className="w-5 h-5 border-2 border-[var(--gold-primary)] border-t-transparent rounded-full animate-spin" />
                  <span className="text-[12px]">生成预览中...</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="h-px bg-[var(--border-default)]" />

        {/* ── Footer ── */}
        <div className="flex items-center justify-between h-[60px] px-6 shrink-0">
          <div className="flex items-center gap-2">
            {selectedNames.length >= 2 && (
              <span className="text-[12px] text-[var(--gold-primary)]">
                合成名称：{selectedNames.join(" + ")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onClose}
              className="px-5 py-2 rounded-md border border-[#3A3A3A] text-[13px] font-medium text-[var(--text-secondary)] hover:border-[var(--text-secondary)] transition cursor-pointer">
              取消
            </button>
            <button onClick={handleComposite}
              disabled={selectedIds.length < 2 || compositing || !currentTemplate}
              className="flex items-center gap-2 px-5 py-2 rounded-md bg-[var(--gold-primary)] text-[13px] font-semibold text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-40">
              {compositing ? (
                <><div className="w-4 h-4 border-2 border-[#0A0A0A] border-t-transparent rounded-full animate-spin" />合成中...</>
              ) : (
                <><Layers size={14} />生成合成图</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 放大预览 */}
      {zoomUrl && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80" onClick={() => setZoomUrl(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setZoomUrl(null)} className="absolute -top-10 right-0 text-white/60 hover:text-white cursor-pointer"><X size={24} /></button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={zoomUrl} alt="zoom" className="max-w-full max-h-[85vh] object-contain rounded" />
          </div>
        </div>
      )}
    </div>
  );
}
