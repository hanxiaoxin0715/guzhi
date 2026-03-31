"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Loader, ImageIcon, Info, Check, Sparkles } from "lucide-react";
import { kvKeysByPrefix, kvLoad } from "../../lib/kvDB";
// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

interface CellData {
  index: number;
  imageUrl?: string;
  description: string;
  selectionKey: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 确认选择，回传合并后的描述文本 */
  onConfirm: (desc: string) => void;
  currentDesc?: string;
}

// ═══════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════

function epLabel(ep: string): string {
  return ep.replace(/^ep/, "EP").toUpperCase();
}

/** 生成跨模式唯一选择 key */
function cellSelKey(mode: "九宫格" | "四宫格" | "智能分镜", ep: string, beat: number, idx: number): string {
  return `${mode === "九宫格" ? "nine" : mode === "智能分镜" ? "smartNine" : "four"}|${ep}|${beat}|${idx}`;
}

/** 安全解析 JSON（支持 markdown 代码块包裹） */
function tryParseJson(content: string): Record<string, unknown> | null {
  try {
    // 移除 markdown 代码块包裹
    const cleaned = content.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
    return JSON.parse(cleaned);
  } catch { return null; }
}

/** 从 beat-board-prompt 文件提取九宫格叙事描述 */
function parseNineDescriptions(content: string): string[] {
  const descriptions: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = tryParseJson(content) as any;
  if (json?.shots && Array.isArray(json.shots)) {
    for (const shot of json.shots.slice(0, 9)) {
      descriptions.push(shot.description || "");
    }
    while (descriptions.length < 9) descriptions.push("");
    return descriptions;
  }
  // MD 格式回退：## 格N
  const parts = content.split(/^##[^\n]*格\s*\d+[^\n]*/m);
  for (let i = 1; i < parts.length && i <= 9; i++) {
    const raw = parts[i].split(/^---/m)[0].split(/^##(?!#)/m)[0].trim();
    const desc = raw.split(/\*\*\[IMG\]\*\*/)[0].replace(/\*\*/g, "").replace(/#+\s*/g, "").replace(/\n+/g, " ").trim();
    descriptions.push(desc);
  }
  while (descriptions.length < 9 && descriptions.length > 0) descriptions.push("");
  return descriptions;
}

/** 从 sequence-board-prompt 文件提取四宫格叙事描述（分组） */
function parseFourDescriptions(content: string): string[][] {
  const groups: string[][] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = tryParseJson(content) as any;
  if (json) {
    // 格式 A：{ groups: [{ shots: [...] }] }
    if (Array.isArray(json.groups)) {
      for (const grp of json.groups) {
        const scenes: string[] = [];
        for (const shot of (grp.shots || []).slice(0, 4)) {
          scenes.push(shot.description || "");
        }
        while (scenes.length < 4) scenes.push("");
        groups.push(scenes);
      }
      return groups;
    }
    // 格式 B：{ shots: [...] } 扁平数组，每 4 个一组
    if (Array.isArray(json.shots) && json.shots.length > 0) {
      for (let g = 0; g < Math.ceil(json.shots.length / 4); g++) {
        const scenes: string[] = [];
        for (let i = 0; i < 4; i++) {
          const shot = json.shots[g * 4 + i];
          scenes.push(shot?.description || "");
        }
        groups.push(scenes);
      }
      return groups;
    }
  }
  // MD 格式回退
  const parts = content.split(/^##[^\n]*(?:格\s*\d+\s*展开|组\s*\d+|格\s*\d+)[^\n]*/m);
  for (let i = 1; i < parts.length && i <= 9; i++) {
    const raw = parts[i].split(/^---/m)[0].split(/^##(?!#)/m)[0].trim();
    const scenes: string[] = [];
    const sceneParts = raw.split(/^###\s*\d+[^\n]*/m);
    for (let j = 1; j < sceneParts.length && j <= 4; j++) {
      const s = sceneParts[j].trim();
      if (s) {
        const narrative = s.split(/\*\*\[IMG\]\*\*/)[0].replace(/\*\*/g, "").replace(/#+\s*/g, "").replace(/\n+/g, " ").trim();
        scenes.push(narrative);
      }
    }
    while (scenes.length < 4 && scenes.length > 0) scenes.push("");
    groups.push(scenes);
  }
  return groups;
}

/** 解析智能分镜提示词文件（格式：# EP · Title\n\n1. desc1\n2. desc2\n...\n9. desc9）*/
function parseSmartNineDescriptions(content: string): string[] {
  const descriptions: string[] = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^\d+\.\s+(.+)/);
    if (m) descriptions.push(m[1].trim());
  }
  while (descriptions.length < 9) descriptions.push("");
  return descriptions.slice(0, 9);
}

// ═══════════════════════════════════════════════════════════
// StoryboardPicker 组件
// ═══════════════════════════════════════════════════════════

export default function StoryboardPicker({ open, onClose, onConfirm, currentDesc }: Props) {
  const [gridMode, setGridMode] = useState<"九宫格" | "四宫格" | "智能分镜">("九宫格");
  const [episodes, setEpisodes] = useState<string[]>([]);
  const [selectedEp, setSelectedEp] = useState("ep01");
  const [selectedBeat, setSelectedBeat] = useState(0);
  const [availableBeats, setAvailableBeats] = useState<number[]>([0]);
  const [loading, setLoading] = useState(false);
  const [cells, setCells] = useState<CellData[]>([]);
  // 多选：Map<selectionKey, rawDescription>
  const [selectedCells, setSelectedCells] = useState<Map<string, string>>(new Map());

  // 弹窗打开时：仅在无已保存选择时清空（保留 "更换关联分镜" 后的已选状态）
  useEffect(() => {
    if (open && !currentDesc) setSelectedCells(new Map());
  }, [open, currentDesc]);

  // 切换 EP / 格模式 / 组数时重新加载
  const loadCells = useCallback(async () => {
    setLoading(true);
    try {
      // 从磁盘获取所有宫格图片 key 列表
      const res = await fetch("/api/grid-image?list=1");
      const json = await res.json();
      const allKeys: string[] = json.keys || [];
      const prefix = gridMode === "九宫格" ? "nine" : gridMode === "智能分镜" ? "smartNine" : "four";
      const filteredKeys = allKeys.filter(
        (k) => k.startsWith(prefix + "-") && !k.includes("composite")
      );

      // ★ EP 检测：KV + grid-images（项目隔离，不再扫描 outputs/ .md 文件）
      const epSet = new Set<string>();
      // 来源1：KV 智能分镜提示词
      try {
        const smartKeys = await kvKeysByPrefix("feicai-smart-nine-prompts-");
        for (const k of smartKeys) { const m = k.match(/(ep\d+)$/); if (m) epSet.add(m[1]); }
      } catch {}
      // 来源2：KV 运镜提示词
      try {
        const motionKeys = await kvKeysByPrefix("feicai-motion-prompts-");
        for (const k of motionKeys) { const m = k.match(/(ep\d+)/); if (m) epSet.add(m[1]); }
      } catch {}
      // 来源3：grid-images 磁盘图片（已有 allKeys）
      for (const k of allKeys) { const m = k.match(/(ep\d+)/); if (m) epSet.add(m[1]); }
      // 来源4：KV 节拍拆解提示词
      try {
        const beatKeys = await kvKeysByPrefix("feicai-beat-prompts-");
        for (const k of beatKeys) { const m = k.match(/(ep\d+)$/); if (m) epSet.add(m[1]); }
      } catch {}
      const epList = Array.from(epSet).sort();
      setEpisodes(epList);

      const ep = epList.includes(selectedEp) ? selectedEp : (epList[0] || "ep01");
      if (!epList.includes(selectedEp) && epList[0]) setSelectedEp(epList[0]);

      // 当前 EP 下的图片 key
      const epKeys = filteredKeys.filter((k) => k.startsWith(`${prefix}-${ep}-`));

      // 提取可用组数（仅四宫格）
      let beat = 0;
      if (prefix === "four") {
        const beatSet = new Set<number>();
        for (const k of epKeys) {
          const parts = k.split("-");
          if (parts.length === 4) {
            const b = parseInt(parts[2]);
            if (!isNaN(b)) beatSet.add(b);
          }
        }
        const beats = Array.from(beatSet).sort((a, b) => a - b);
        setAvailableBeats(beats.length > 0 ? beats : [0]);
        beat = beats.includes(selectedBeat) ? selectedBeat : (beats[0] ?? 0);
        if (!beats.includes(selectedBeat)) setSelectedBeat(beats[0] ?? 0);
      } else {
        setAvailableBeats([0]);
      }

      // 构建图片 Map（key → URL）
      const imageMap = new Map<number, string>();
      for (const k of epKeys) {
        const parts = k.split("-");
        if ((prefix === "nine" || prefix === "smartNine") && parts.length === 3) {
          const idx = parseInt(parts[2]);
          if (!isNaN(idx)) imageMap.set(idx, `/api/grid-image?key=${encodeURIComponent(k)}`);
        } else if (prefix === "four" && parts.length === 4) {
          const b = parseInt(parts[2]);
          const idx = parseInt(parts[3]);
          if (b === beat && !isNaN(idx)) imageMap.set(idx, `/api/grid-image?key=${encodeURIComponent(k)}`);
        }
      }

      // ★ 加载叙事描述：KV 优先，回退到 outputs .md 文件
      let prompts: string[] = [];
      try {
        if (gridMode === "智能分镜") {
          // KV 优先：智能分镜提示词
          const kvRaw = await kvLoad(`feicai-smart-nine-prompts-${ep}`);
          if (kvRaw) {
            try {
              const parsed = JSON.parse(kvRaw);
              if (Array.isArray(parsed)) {
                prompts = parsed;
              } else if (parsed && Array.isArray(parsed.beats)) {
                prompts = parsed.beats;
              }
            } catch {}
          }
          // KV 无数据时回退到 outputs .md 文件
          if (prompts.length === 0) {
            const pRes = await fetch(`/api/outputs/smart-nine-prompt-${ep}.md`);
            if (pRes.ok) {
              const pData = await pRes.json();
              if (pData.content) prompts = parseSmartNineDescriptions(pData.content);
            }
          }
        } else if (gridMode === "九宫格") {
          // KV 优先：运镜提示词
          const kvRaw = await kvLoad(`feicai-motion-prompts-nine-${ep}`);
          if (kvRaw) { try { prompts = JSON.parse(kvRaw); } catch {} }
          if (prompts.length === 0) {
            const pRes = await fetch(`/api/outputs/beat-board-prompt-${ep}.md`);
            if (pRes.ok) {
              const pData = await pRes.json();
              if (pData.content) prompts = parseNineDescriptions(pData.content);
            }
          }
        } else {
          // KV 优先：运镜提示词
          const kvRaw = await kvLoad(`feicai-motion-prompts-four-${ep}-b${beat}`);
          if (kvRaw) { try { prompts = JSON.parse(kvRaw); } catch {} }
          if (prompts.length === 0) {
            const pRes = await fetch(`/api/outputs/sequence-board-prompt-${ep}.md`);
            if (pRes.ok) {
              const pData = await pRes.json();
              if (pData.content) {
                const groups = parseFourDescriptions(pData.content);
                prompts = groups[beat] || [];
              }
            }
          }
        }
      } catch { /* 忽略 */ }

      const cellCount = gridMode === "四宫格" ? 4 : 9;
      setCells(Array.from({ length: cellCount }, (_, i) => ({
        index: i,
        imageUrl: imageMap.get(i),
        description: prompts[i] || "",
        selectionKey: cellSelKey(gridMode, ep, beat, i),
      })));
    } catch (e) {
      console.error("[StoryboardPicker] 加载失败:", e);
      setCells([]);
    } finally {
      setLoading(false);
    }
  }, [gridMode, selectedEp, selectedBeat]);

  useEffect(() => {
    if (open) loadCells();
  }, [open, loadCells]);

  // 切换单格选择
  function toggleCell(key: string, rawDesc: string) {
    setSelectedCells((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, rawDesc);
      return next;
    });
  }

  // 确认选择：合并所有已选格的描述
  function handleConfirm() {
    if (selectedCells.size === 0) return;
    const combined = Array.from(selectedCells.values())
      .filter((d) => d.trim())
      .map((d) => d.replace(/\*\*/g, "").replace(/#+\s*/g, "").replace(/\n+/g, " ").trim())
      .filter(Boolean)
      .join("\n\n");
    onConfirm(combined || `已选 ${selectedCells.size} 格分镜`);
  }

  if (!open) return null;

  const cols = gridMode === "四宫格" ? 2 : 3;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col bg-[#161616] border border-[var(--border-default)] shadow-2xl"
        style={{ width: 720, maxWidth: "96vw", maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)] shrink-0">
          <span className="text-[16px] font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <span className="text-[var(--gold-primary)]">✦</span>
            选择分镜格
          </span>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Toolbar：EP + 组数 + 清除已选 + 格模式 ── */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--border-default)] shrink-0 flex-wrap">
          {/* EP 标签（无图片时也显示一个默认 EP01） */}
          <div className="flex items-center gap-2 overflow-x-auto">
            {(episodes.length > 0 ? episodes : ["ep01"]).map((ep) => (
              <button
                key={ep}
                onClick={() => setSelectedEp(ep)}
                className={`shrink-0 px-2.5 py-1 text-[11px] rounded-sm border transition cursor-pointer ${
                  selectedEp === ep
                    ? "border-[var(--gold-primary)] text-[var(--gold-primary)] bg-[var(--gold-primary)]/10"
                    : "border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {epLabel(ep)}
              </button>
            ))}
          </div>

          {/* 组数选择（仅四宫格） */}
          {gridMode === "四宫格" && (
            <select
              value={selectedBeat}
              onChange={(e) => setSelectedBeat(Number(e.target.value))}
              className="h-7 px-2 bg-[#0A0A0A] border border-[var(--border-default)] rounded text-[11px] text-[var(--text-secondary)] outline-none cursor-pointer appearance-none"
            >
              {availableBeats.map((b) => (
                <option key={b} value={b} className="bg-[#0A0A0A]">组{b + 1}</option>
              ))}
            </select>
          )}

          <div className="flex-1" />

          {/* 清除已选 */}
          {selectedCells.size > 0 && (
            <button
              onClick={() => setSelectedCells(new Map())}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-red-400/80 hover:text-red-400 border border-red-400/20 hover:border-red-400/40 rounded transition cursor-pointer"
            >
              <X size={12} />
              清除已选({selectedCells.size})
            </button>
          )}

          {/* 格模式切换 */}
          <div className="flex shrink-0 border border-[var(--border-default)]">
            {(["九宫格", "四宫格", "智能分镜"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setGridMode(m)}
                className={`px-3 py-1 text-[11px] transition cursor-pointer ${
                  gridMode === m
                    ? "bg-[var(--gold-primary)] text-[#0A0A0A] font-medium"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* ── 宫格内容 ── */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
              <Loader size={20} className="animate-spin mr-2" /> 加载中...
            </div>
          ) : cells.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--text-muted)] text-[13px]">
              <ImageIcon size={32} className="mb-2 opacity-40" />
              暂无分镜图片，请先在生图工作台生成
            </div>
          ) : (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
            >
              {cells.map((cell) => {
                const isSelected = selectedCells.has(cell.selectionKey);
                const hasDesc = Boolean(cell.description.trim());
                return (
                  <button
                    key={cell.selectionKey}
                    onClick={() => toggleCell(cell.selectionKey, cell.description)}
                    className={`relative flex flex-col border-2 text-left transition cursor-pointer overflow-hidden ${
                      isSelected
                        ? "border-[var(--gold-primary)] bg-[#1A1200]"
                        : "border-[var(--border-default)] bg-[#171717] hover:border-[var(--text-muted)]"
                    }`}
                  >
                    {/* 图片区 */}
                    <div className="relative w-full bg-[#181818]" style={{ aspectRatio: "16/9" }}>
                      {/* 格号 Badge */}
                      <span
                        className={`absolute top-1.5 left-1.5 z-10 text-[10px] px-1.5 py-0.5 rounded-sm font-medium leading-none ${
                          isSelected
                            ? "bg-[var(--gold-primary)] text-[#0A0A0A]"
                            : "bg-[#252525] text-[var(--text-muted)]"
                        }`}
                      >
                        格 {cell.index + 1}
                      </span>

                      {/* 多选勾选框 */}
                      <div className={`absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded flex items-center justify-center ${
                        isSelected
                          ? "bg-[var(--gold-primary)]"
                          : "border border-[var(--text-muted)]/40 bg-[#0A0A0A80]"
                      }`}>
                        {isSelected && <Check size={12} className="text-[#0A0A0A]" />}
                      </div>

                      {cell.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={cell.imageUrl}
                          alt={`格${cell.index + 1}`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon size={20} className="text-[var(--text-muted)] opacity-40" />
                        </div>
                      )}

                      {/* 选中遮罩 */}
                      {isSelected && hasDesc && (
                        <div className="absolute inset-0 bg-[var(--gold-primary)]/10 flex items-center justify-center">
                          <span className="text-[11px] text-[var(--gold-primary)] font-medium px-3 text-center leading-relaxed">
                            已选 · 描述将注入提示词
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 描述底栏 */}
                    <div
                      className={`px-2 py-1.5 text-[10px] leading-snug ${
                        isSelected
                          ? "text-[var(--gold-primary)]/80 bg-[#1A1200]"
                          : "text-[var(--text-muted)] bg-[#1B1B1B]"
                      }`}
                    >
                      {hasDesc
                        ? cell.description
                            .replace(/\*\*/g, "")
                            .replace(/#+/g, "")
                            .replace(/\n+/g, " ")
                            .slice(0, 60) + (cell.description.length > 60 ? "..." : "")
                        : "无提示词"}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Hint Bar ── */}
        <div className="flex items-center gap-2 px-6 py-2.5 bg-[#111111] border-t border-[var(--border-default)] shrink-0">
          <Info size={12} className="text-[var(--text-muted)] shrink-0" />
          <span className="text-[11px] text-[var(--text-muted)]">
            支持多选，切换宫格模式 / EP / 组数不会清除已选；灰色格子表示暂无描述
          </span>
        </div>

        {/* ── Footer 按钮 ── */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-[var(--border-default)] shrink-0">
          <span className="text-[12px] text-[var(--text-muted)]">
            {selectedCells.size > 0 ? (
              <span className="text-[var(--gold-primary)]">
                ✦ 已选 {selectedCells.size} 格分镜 · 描述将合并注入提示词
              </span>
            ) : (
              "未选择"
            )}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[12px] border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedCells.size === 0}
              className="px-4 py-2 text-[12px] bg-[var(--gold-primary)] text-[#0A0A0A] font-medium hover:brightness-110 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ✓ 确认选择
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
