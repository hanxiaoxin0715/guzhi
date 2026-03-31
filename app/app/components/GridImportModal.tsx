"use client";

import { useState, useEffect, useRef } from "react";
import {
  Grid2X2, Grid3X3, X, Check, Film, Users, Sparkles,
  Loader, Image as ImageIcon, Maximize2, Upload, Download,
} from "lucide-react";
import { loadGridImageUrlsFromDisk } from "../lib/gridImageStore";
import { kvKeysByPrefix, kvLoad } from "../lib/kvDB";

// ═══════════════════════════════════════════════════════════
// ImageZoomModal — 图片放大预览
// ═══════════════════════════════════════════════════════════

export function ImageZoomModal({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-10 right-0 text-white/60 hover:text-white cursor-pointer"><X size={24} /></button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="zoom" className="max-w-full max-h-[85vh] object-contain rounded" />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// GridImportModal — 宫格导入图片弹窗
// ═══════════════════════════════════════════════════════════

export type GridTab = "four" | "nine" | "smartNine" | "ref";

export interface GridImportImage {
  key: string;
  url: string;
  label: string;
}

interface GridImportModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (images: GridImportImage[], deselectedKeys?: Set<string>) => void;
  defaultEpisode: string;
  defaultBeat: number;
  episodes: string[];
  existingKeys: Set<string>;
}

async function splitCompositeImageToDataUrls(compositeUrl: string, rows: number, cols: number): Promise<string[]> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const cellW = Math.floor(img.width / cols);
        const cellH = Math.floor(img.height / rows);
        if (cellW <= 0 || cellH <= 0) {
          resolve([]);
          return;
        }

        const urls: string[] = [];
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve([]);
          return;
        }

        canvas.width = cellW;
        canvas.height = cellH;

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            ctx.clearRect(0, 0, cellW, cellH);
            ctx.drawImage(img, c * cellW, r * cellH, cellW, cellH, 0, 0, cellW, cellH);
            urls.push(canvas.toDataURL("image/png", 0.92));
          }
        }

        resolve(urls);
      } catch {
        resolve([]);
      }
    };
    img.onerror = () => resolve([]);
    img.src = compositeUrl;
  });
}

export function GridImportModal({
  open, onClose, onImport, defaultEpisode, defaultBeat, episodes, existingKeys,
}: GridImportModalProps) {
  const [gridTab, setGridTab] = useState<GridTab>("four");
  const [browseEp, setBrowseEp] = useState(defaultEpisode);
  const [browseBeat, setBrowseBeat] = useState(defaultBeat);
  const [gridImages, setGridImages] = useState<GridImportImage[]>([]);
  const [uploadedImages, setUploadedImages] = useState<GridImportImage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [discoveredEps, setDiscoveredEps] = useState<string[]>([]);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // 打开弹窗时同步默认值 + 从磁盘宫格图片发现实际有图的 EP 列表
  useEffect(() => {
    if (!open) return;
    // 重置所有浏览状态，防止上次关闭时的 tab/数据残留
    setGridTab("four");
    setBrowseEp(defaultEpisode); setBrowseBeat(defaultBeat); setUploadedImages([]);
    setGridImages([]); setSelected(new Set()); setLoading(true);
    // ★ 新项目标记存在时，跳过磁盘 EP 发现，返回干净状态
    const isFresh = localStorage.getItem("feicai-new-project");
    if (isFresh) {
      setDiscoveredEps(["ep01"]);
      return;
    }
    // ★ 从 KV + 磁盘发现有图的 EP（项目隔离）
    (async () => {
      const kvEps = new Set<string>();   // KV 来源（当前项目活跃数据）
      const diskEps = new Set<string>(); // 磁盘来源（可能含旧项目残留）
      // 来源1：KV 智能分镜提示词
      try {
        const smartKeys = await kvKeysByPrefix("feicai-smart-nine-prompts-");
        for (const k of smartKeys) { const m = k.match(/(ep\d+)$/); if (m) kvEps.add(m[1]); }
      } catch {}
      // 来源2：KV 运镜提示词
      try {
        const motionKeys = await kvKeysByPrefix("feicai-motion-prompts-");
        for (const k of motionKeys) { const m = k.match(/(ep\d+)/); if (m) kvEps.add(m[1]); }
      } catch {}
      // 来源3：grid-images 磁盘图片
      try {
        const res = await fetch("/api/grid-image?list=1");
        if (res.ok) {
          const { keys } = (await res.json()) as { keys: string[] };
          for (const k of keys) { const m = k.match(/-(ep\d+)/); if (m) diskEps.add(m[1]); }
        }
      } catch { /* ignore */ }
      // 来源4：KV 节拍拆解提示词
      try {
        const beatKeys = await kvKeysByPrefix("feicai-beat-prompts-");
        for (const k of beatKeys) { const m = k.match(/(ep\d+)$/); if (m) kvEps.add(m[1]); }
      } catch {}
      // ★ 父组件传入 episodes 时信任所有来源；未传入时只信任 KV 来源（排除旧项目磁盘残留）
      const useKvOnly = episodes.length === 0;
      const epSet = useKvOnly ? kvEps : new Set([...kvEps, ...diskEps]);
      const sorted = Array.from(epSet).sort();
      setDiscoveredEps(sorted.length > 0 ? sorted : ["ep01"]);
      if (sorted.length > 0 && !sorted.includes(defaultEpisode)) {
        setBrowseEp(sorted[0]);
      }
    })();
  }, [open, defaultEpisode, defaultBeat, episodes.length]);

  // 切换 tab / EP / beat 时加载图片
  useEffect(() => {
    if (!open) return;
    setLoading(true);

    // ★ 新项目时不从磁盘加载旧图片
    const isFresh = localStorage.getItem("feicai-new-project");
    if (isFresh) {
      setGridImages([]);
      setSelected(new Set());
      setLoading(false);
      return;
    }

    (async () => {
      const items: GridImportImage[] = [];

      if (gridTab === "ref") {
        // 参考图模式：从 ref-images 磁盘加载，★ 仅显示当前项目一致性条目的参考图
        try {
          // 先加载当前项目的一致性数据，获取有效的 item ID 集合
          const currentIds = new Set<string>();
          try {
            const cstRaw = await kvLoad("feicai-consistency");
            if (cstRaw) {
              const cst = typeof cstRaw === "string" ? JSON.parse(cstRaw) : cstRaw;
              for (const c of cst.characters || []) if (c.id) currentIds.add(c.id);
              for (const s of cst.scenes || []) if (s.id) currentIds.add(s.id);
              for (const p of cst.props || []) if (p.id) currentIds.add(p.id);
              // 风格图也属于当前项目
              if (cst.style?.styleImage) currentIds.add("style");
            }
          } catch { /* 一致性数据加载失败则显示全部 */ }

          const res = await fetch("/api/ref-image");
          if (res.ok) {
            const { keys } = (await res.json()) as { keys: string[] };
            const refKeys = keys.filter(k => k !== "style-prompt"); // 排除 style-prompt.json
            for (const k of refKeys) {
              // ★ 仅保留当前项目的参考图（如果成功加载了一致性数据）
              if (currentIds.size > 0 && !currentIds.has(k)) continue;
              // 使用 [key] 动态路由直接获取二进制图片
              const url = `/api/ref-image/${encodeURIComponent(k)}`;
              // 推断标签：char-xxx → 角色, scene-xxx → 场景, prop-xxx → 道具, style → 风格
              let label = k;
              if (k.startsWith("char-")) label = `角色·${k.slice(5)}`;
              else if (k.startsWith("scene-")) label = `场景·${k.slice(6)}`;
              else if (k.startsWith("prop-")) label = `道具·${k.slice(5)}`;
              else if (k === "style" || k.startsWith("style-")) label = `风格·${k}`;
              items.push({ key: `ref-${k}`, url, label });
            }
          }
        } catch { /* ignore */ }
      } else {
        const db = await loadGridImageUrlsFromDisk(browseEp);

        if (gridTab === "four") {
          let fourCellCount = 0;
          for (let i = 0; i < 4; i++) {
            const key = `four-${browseEp}-${browseBeat}-${i}`;
            const url = db[key] || "";
            if (url) {
              items.push({ key, url, label: `四宫格·格${i + 1}` });
              fourCellCount++;
            }
          }
          const compositeKey = `four-composite-${browseEp}-${browseBeat}`;
          const compositeUrl = db[compositeKey] || "";
          if (compositeUrl) items.push({ key: compositeKey, url: compositeUrl, label: "四宫格·合成图" });

          // 兜底：仅有合成图时，前端即时切分为4格供用户选择
          if (fourCellCount === 0 && compositeUrl) {
            const splitUrls = await splitCompositeImageToDataUrls(compositeUrl, 2, 2);
            splitUrls.forEach((url, idx) => {
              items.push({
                key: `four-split-${browseEp}-${browseBeat}-${idx}`,
                url,
                label: `四宫格·格${idx + 1}`,
              });
            });
          }
        } else if (gridTab === "smartNine") {
          // 智能分镜模式：从磁盘加载 smartNine-ep-idx 图片
          let smartNineCellCount = 0;
          for (let i = 0; i < 9; i++) {
            const key = `smartNine-${browseEp}-${i}`;
            const url = db[key] || "";
            if (url) {
              items.push({ key, url, label: `智能分镜·格${i + 1}` });
              smartNineCellCount++;
            }
          }
          const smartCompositeKey = `smartNine-composite-${browseEp}`;
          const smartCompositeUrl = db[smartCompositeKey] || "";
          if (smartCompositeUrl) items.push({ key: smartCompositeKey, url: smartCompositeUrl, label: "智能分镜·合成图" });

          // 兜底：仅有合成图时，前端即时切分为9格供用户选择
          if (smartNineCellCount === 0 && smartCompositeUrl) {
            const splitUrls = await splitCompositeImageToDataUrls(smartCompositeUrl, 3, 3);
            splitUrls.forEach((url, idx) => {
              items.push({
                key: `smartNine-split-${browseEp}-${idx}`,
                url,
                label: `智能分镜·格${idx + 1}`,
              });
            });
          }
        } else {
          let nineCellCount = 0;
          for (let i = 0; i < 9; i++) {
            const key = `nine-${browseEp}-${i}`;
            const url = db[key] || "";
            if (url) {
              items.push({ key, url, label: `九宫格·格${i + 1}` });
              nineCellCount++;
            }
          }
          const nineCompositeKey = `nine-composite-${browseEp}`;
          const nineCompositeUrl = db[nineCompositeKey] || "";
          if (nineCompositeUrl) items.push({ key: nineCompositeKey, url: nineCompositeUrl, label: "九宫格·合成图" });

          // 兜底：仅有合成图时，前端即时切分为9格供用户选择
          if (nineCellCount === 0 && nineCompositeUrl) {
            const splitUrls = await splitCompositeImageToDataUrls(nineCompositeUrl, 3, 3);
            splitUrls.forEach((url, idx) => {
              items.push({
                key: `nine-split-${browseEp}-${idx}`,
                url,
                label: `九宫格·格${idx + 1}`,
              });
            });
          }
        }

        // 排序：格1, 格2, ... 合成图末尾
        items.sort((a, b) => {
          const aCompo = a.key.includes("composite") ? 1 : 0;
          const bCompo = b.key.includes("composite") ? 1 : 0;
          if (aCompo !== bCompo) return aCompo - bCompo;
          return a.key.localeCompare(b.key);
        });
      }

      setGridImages(items);
      // 预选已导入的图片
      const preSelected = new Set<string>();
      for (const img of items) {
        if (existingKeys.has(img.key)) preSelected.add(img.key);
      }
      setSelected(preSelected);
      setLoading(false);
    })();
  }, [open, gridTab, browseEp, browseBeat, existingKeys]);

  const allImages = [...gridImages, ...uploadedImages];

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === allImages.length) setSelected(new Set());
    else setSelected(new Set(allImages.map((g) => g.key)));
  };

  const handleImport = () => {
    const selectedImages = allImages.filter((g) => selected.has(g.key));
    const deselectedKeys = new Set<string>();
    for (const key of Array.from(existingKeys)) {
      if (!selected.has(key)) deselectedKeys.add(key);
    }
    onImport(selectedImages, deselectedKeys);
    onClose();
  };

  const handleUploadFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        if (!dataUrl) return;
        const key = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const label = file.name.replace(/\.[^.]+$/, "");
        setUploadedImages((prev) => [...prev, { key, url: dataUrl, label: `上传·${label}` }]);
        setSelected((prev) => new Set(prev).add(key));
      };
      reader.readAsDataURL(file);
    });
    if (uploadInputRef.current) uploadInputRef.current.value = "";
  };

  if (!open) return null;

  const epList = discoveredEps.length > 0 ? discoveredEps : (episodes.length > 0 ? episodes : ["ep01"]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex flex-col w-[620px] max-h-[640px] bg-[#1A1A1A] border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-6 shrink-0">
          <div className="flex items-center gap-2.5">
            <Grid2X2 size={18} className="text-[var(--gold-primary)]" />
            <span className="text-[16px] font-semibold text-[var(--text-primary)]">宫格导入图片</span>
          </div>
          <button onClick={onClose} className="flex items-center justify-center w-8 h-8 rounded-md bg-[#0A0A0A] hover:bg-[#2A2A2A] cursor-pointer">
            <X size={16} className="text-[var(--text-secondary)]" />
          </button>
        </div>
        <div className="h-px bg-[var(--border-default)]" />

        {/* Toolbar: EP/Beat selector + Grid type tabs */}
        <div className="flex items-center gap-3 h-11 px-6 bg-[#12121280] shrink-0">
          {/* EP selector（参考图模式隐藏）*/}
          {gridTab !== "ref" && (
            <select value={browseEp} onChange={(e) => setBrowseEp(e.target.value)} suppressHydrationWarning
              className="h-7 px-2 bg-[#0A0A0A] border border-[var(--border-default)] rounded text-[11px] font-medium text-[var(--gold-primary)] outline-none cursor-pointer appearance-none">
              {epList.map((ep) => <option key={ep} value={ep} className="bg-[#0A0A0A]">{ep.toUpperCase()}</option>)}
            </select>
          )}
          {/* Beat selector (only for four-grid) */}
          {gridTab === "four" && (
            <select value={browseBeat} onChange={(e) => setBrowseBeat(Number(e.target.value))} suppressHydrationWarning
              className="h-7 px-2 bg-[#0A0A0A] border border-[var(--border-default)] rounded text-[11px] text-[var(--text-secondary)] outline-none cursor-pointer appearance-none">
              {Array.from({ length: 9 }, (_, i) => (
                <option key={i} value={i} className="bg-[#0A0A0A]">组{i + 1}</option>
              ))}
            </select>
          )}
          <div className="flex-1" />
          {/* Grid type tabs */}
          <div className="flex items-center h-7 rounded border border-[var(--border-default)] overflow-hidden">
            <button onClick={() => { setGridTab("four"); setGridImages([]); setSelected(new Set()); setLoading(true); }}
              className={`flex items-center gap-1.5 px-3 h-full text-[11px] cursor-pointer transition ${gridTab === "four" ? "bg-[var(--gold-primary)] text-[#0A0A0A] font-medium" : "text-[var(--text-secondary)] hover:bg-[#2A2A2A]"}`}>
              <Grid2X2 size={12} />四宫格
            </button>
            <button onClick={() => { setGridTab("nine"); setGridImages([]); setSelected(new Set()); setLoading(true); }}
              className={`flex items-center gap-1.5 px-3 h-full text-[11px] cursor-pointer transition ${gridTab === "nine" ? "bg-[var(--gold-primary)] text-[#0A0A0A] font-medium" : "text-[var(--text-secondary)] hover:bg-[#2A2A2A]"}`}>
              <Grid3X3 size={12} />九宫格
            </button>
            <button onClick={() => { setGridTab("smartNine"); setGridImages([]); setSelected(new Set()); setLoading(true); }}
              className={`flex items-center gap-1.5 px-3 h-full text-[11px] cursor-pointer transition ${gridTab === "smartNine" ? "bg-[var(--gold-primary)] text-[#0A0A0A] font-medium" : "text-[var(--text-secondary)] hover:bg-[#2A2A2A]"}`}>
              <Sparkles size={12} />智能分镜
            </button>
            <button onClick={() => { setGridTab("ref"); setGridImages([]); setSelected(new Set()); setLoading(true); }}
              className={`flex items-center gap-1.5 px-3 h-full text-[11px] cursor-pointer transition ${gridTab === "ref" ? "bg-[var(--gold-primary)] text-[#0A0A0A] font-medium" : "text-[var(--text-secondary)] hover:bg-[#2A2A2A]"}`}>
              <Users size={12} />参考图
            </button>
          </div>
          {/* Select all */}
          <button onClick={toggleAll} className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#0A0A0A] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer">
            <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${selected.size === allImages.length && allImages.length > 0 ? "bg-[var(--gold-primary)] border-[var(--gold-primary)]" : "border-[var(--text-muted)]"}`}>
              {selected.size === allImages.length && allImages.length > 0 && <Check size={10} className="text-[#0A0A0A]" />}
            </div>
            <span className="text-[11px] text-[var(--text-secondary)]">全选</span>
          </button>
        </div>
        <div className="h-px bg-[var(--border-default)]" />

        {/* Status Bar */}
        <div className="flex items-center gap-2 h-8 px-6 bg-[#0D0D0D] shrink-0">
          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#C9A96215] border border-[var(--gold-transparent)]">
            <Film size={10} className="text-[var(--gold-primary)]" />
            <span className="text-[10px] font-medium text-[var(--gold-primary)]">
              {gridTab === "ref" ? "参考图" : `${browseEp.toUpperCase()}${gridTab === "four" ? ` · 组${browseBeat + 1}` : ""} · ${gridTab === "four" ? "四宫格" : gridTab === "smartNine" ? "智能分镜" : "九宫格"}`}
            </span>
          </span>
          <span className="text-[10px] text-[var(--text-muted)]">共 {allImages.length} 张图片{uploadedImages.length > 0 ? `（含 ${uploadedImages.length} 张上传）` : ""}</span>
        </div>
        <div className="h-px bg-[var(--border-default)]" />

        {/* Grid Area */}
        <div className="flex-1 overflow-auto p-4 px-6">
          {loading ? (
            <div className="flex items-center justify-center h-40"><Loader size={24} className="animate-spin text-[var(--gold-primary)]" /></div>
          ) : allImages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3">
              <ImageIcon size={32} className="text-[var(--text-muted)]" />
              <span className="text-[13px] text-[var(--text-muted)]">
                {gridTab === "ref" ? "暂无参考图" : gridTab === "four" ? `${browseEp.toUpperCase()} 组${browseBeat + 1} 暂无四宫格图片` : gridTab === "smartNine" ? `${browseEp.toUpperCase()} 暂无智能分镜图片` : `${browseEp.toUpperCase()} 暂无九宫格图片`}
              </span>
              <span className="text-[11px] text-[var(--text-muted)]">
                {gridTab === "ref" ? "请先在生图工作台的一致性面板中生成角色/场景/道具参考图" : gridTab === "smartNine" ? "请先在分镜流水线「智能分镜」中生成方案，然后在生图工作台生成图片" : "请先在生图工作台生成对应图片，或点击下方「上传图片」按钮自定义导入"}
              </span>
            </div>
          ) : (
            <div className={`grid gap-3 ${gridTab === "four" ? "grid-cols-2" : "grid-cols-3"}`}>
              {allImages.map((img) => {
                const isSel = selected.has(img.key);
                const isAlreadyImported = existingKeys.has(img.key);
                return (
                  <div key={img.key} onClick={() => toggleSelect(img.key)}
                    className={`relative rounded-md overflow-hidden cursor-pointer transition-all ${isSel ? "ring-2 ring-[var(--gold-primary)]" : isAlreadyImported ? "ring-1 ring-[var(--gold-primary)]/50" : "ring-1 ring-[#3A3A3A]"}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt={img.label} className={`w-full object-contain bg-[#0A0A0A] ${gridTab === "four" ? "h-[180px]" : "h-[140px]"}`} />
                    <button onClick={(e) => { e.stopPropagation(); setZoomUrl(img.url); }}
                      className="absolute top-2 left-2 w-6 h-6 flex items-center justify-center rounded bg-[#0A0A0A80] hover:bg-[#0A0A0AA0] cursor-pointer">
                      <Maximize2 size={12} className="text-[var(--gold-primary)]" />
                    </button>
                    <div className={`absolute top-2 right-2 w-[22px] h-[22px] rounded flex items-center justify-center ${isSel ? "bg-[var(--gold-primary)]" : "border border-[var(--text-muted)]"}`}>
                      {isSel && <Check size={14} className="text-[#0A0A0A]" />}
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-[#0A0A0A90] flex items-center justify-between">
                      <span className="text-[10px] text-white">{img.label}</span>
                      {isAlreadyImported && (
                        <span className="text-[8px] text-[var(--gold-primary)] bg-[#C9A96220] px-1.5 py-0.5 rounded">已导入</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="h-px bg-[var(--border-default)]" />

        {/* Footer */}
        <div className="flex items-center justify-between h-[60px] px-6 shrink-0">
          <div className="flex items-center gap-2">
            {selected.size > 0 && <Check size={14} className="text-[var(--gold-primary)]" />}
            <span className={`text-[12px] ${selected.size > 0 ? "text-[var(--gold-primary)]" : "text-[var(--text-muted)]"}`}>
              已选择 {selected.size} 张图片
            </span>
          </div>
          <div className="flex items-center gap-3">
            <input ref={uploadInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleUploadFiles(e.target.files)} />
            <button onClick={() => uploadInputRef.current?.click()}
              className="flex items-center gap-2 px-4 py-2 rounded-md border border-[var(--gold-primary)] text-[13px] font-medium text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer">
              <Upload size={14} />上传图片
            </button>
            <button onClick={onClose} className="px-5 py-2 rounded-md border border-[#3A3A3A] text-[13px] font-medium text-[var(--text-secondary)] hover:border-[var(--text-secondary)] transition cursor-pointer">取消</button>
            <button onClick={handleImport} disabled={selected.size === 0}
              className="flex items-center gap-2 px-5 py-2 rounded-md bg-[var(--gold-primary)] text-[13px] font-semibold text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-40">
              <Download size={14} />导入选中图片
            </button>
          </div>
        </div>
      </div>
      {zoomUrl && <ImageZoomModal url={zoomUrl} onClose={() => setZoomUrl(null)} />}
    </div>
  );
}
