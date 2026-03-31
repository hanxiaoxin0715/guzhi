"use client";

import { useState, useEffect } from "react";
import { X, MessageSquareText, Grid2X2, Grid3X3, Sparkles, LayoutGrid, Info } from "lucide-react";
import { kvLoad } from "../../lib/kvDB";
import { loadGridImageUrlsFromDisk } from "../../lib/gridImageStore";
import type { DialogueLine } from "./AIPromptModal";

type GridTab = "four" | "nine" | "smartNine" | "custom";

interface CellData {
  imageUrl: string;
  dialogues: DialogueLine[];
}

// 从引号前文本中精确提取说话人角色名
function extractSpeaker(fullText: string, quoteIndex: number): string {
  const before = fullText.slice(Math.max(0, quoteIndex - 50), quoteIndex);
  // 定位说话动词（可含副词前缀）+ 冒号
  const verbRe = /(?:(?:低声|轻声|沉声|大声|朗声|厉声|柔声|高声|怒声|急声|悄声|冷声|恨声|嘶声|颤声|冷冷[地的]?|淡淡[地的]?|缓缓[地的]?|微微|结巴[地的]?|疑惑[地的]?|焦急[地的]?|不屑[地的]?|无奈[地的]?|哽咽着?|嘲笑着?))?(?:说道|喊道|叫道|问道|答道|笑道|怒道|叹道|嘟囔道|嘀咕道|嘱咐道|吩咐道|感叹道|低吼道|呢喃道|嗤笑道|冷哼道|怒喝道|大喝道|轻叹道|惊呼道|追问道|反问道|接口道|开口道|吼道|喝道|说|道|喊|叫|笑|怒|叹|问|答|嘟囔|嘱咐|吩咐|开口|出声|呢喃)[:：]\s*$/;
  const vm = before.match(verbRe);
  if (!vm || vm.index === undefined) return "角色";
  const preVerb = before.slice(0, vm.index).trim();
  if (!preVerb) return "角色";
  // 找最后一个标点边界
  let boundIdx = -1;
  for (const ch of "。！？\n，、；：") {
    const idx = preVerb.lastIndexOf(ch);
    if (idx > boundIdx) boundIdx = idx;
  }
  const seg = preVerb.slice(boundIdx + 1).trim();
  if (seg.length < 2) return "角色";
  // 从段落开头尝试提取2-4字角色名，名字后面通常接动作/方向词
  const BOUNDARY = "朝对向在被把从到往将站坐走跑转伸拉抬低回起急连赶突忽猛随立马正已又也就便却则才仍还只开上去用拿叫让使令替";
  const isName = (s: string) => s.length >= 2 && !/^[他她它我你其那这某有]/.test(s) && !/^(朝着|对着|向着|正在)/.test(s);
  for (let len = 2; len <= Math.min(4, seg.length); len++) {
    if (len === seg.length) { if (isName(seg)) return seg; break; }
    if (BOUNDARY.includes(seg[len])) {
      const name = seg.slice(0, len);
      if (isName(name)) return name;
      break;
    }
  }
  const fallback = seg.slice(0, 2);
  return isName(fallback) ? fallback : "角色";
}

// 从文本中提取台词和说话人
function extractDialogues(text: string): DialogueLine[] {
  if (!text) return [];
  const lines: DialogueLine[] = [];
  const quoteRe = /[「""\u201c\u2018'']([^」""\u201d\u2019'']+)[」""\u201d\u2019'']/g;
  let m: RegExpExecArray | null;
  while ((m = quoteRe.exec(text)) !== null) {
    if (m[1].trim().length < 2) continue;
    lines.push({ role: extractSpeaker(text, m.index), text: m[1].trim() });
  }
  return lines;
}

// 合并台词（按文本去重）
function mergeDialogues(existing: DialogueLine[], newer: DialogueLine[]): DialogueLine[] {
  const seen = new Set(existing.map(d => d.text));
  const merged = [...existing];
  for (const d of newer) {
    if (!seen.has(d.text)) { seen.add(d.text); merged.push(d); }
  }
  return merged;
}

export default function DialoguePickerModal({
  open, onClose, onSelect, episode, selectedBeat, episodes,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (dialogues: DialogueLine[]) => void;
  episode: string;
  selectedBeat: number;
  episodes: string[];
}) {
  const [gridTab, setGridTab] = useState<GridTab>("nine");
  const [browseEp, setBrowseEp] = useState(episode);
  const [browseBeat, setBrowseBeat] = useState(selectedBeat);
  const [cells, setCells] = useState<CellData[]>([]);
  const [loading, setLoading] = useState(true);
  const [customCount, setCustomCount] = useState(9);

  // 打开时重置并自动检测有台词的 Tab
  useEffect(() => {
    if (!open) return;
    setCells([]); setLoading(true);
    setBrowseEp(episode); setBrowseBeat(selectedBeat);
    (async () => {
      const tabs: GridTab[] = ["smartNine", "nine", "four", "custom"];
      for (const tab of tabs) {
        try {
          let text = "";
          if (tab === "smartNine") {
            const raw = await kvLoad(`feicai-smart-nine-prompts-${episode}`);
            if (raw) text = raw;
          } else if (tab === "nine" || tab === "four") {
            const bbRes = await fetch("/api/outputs/beat-breakdown.md");
            if (bbRes.ok) { const d = await bbRes.json(); text = d.content || ""; }
          } else {
            const raw = await kvLoad(`feicai-motion-prompts-custom-${episode}`);
            if (raw) text = raw;
          }
          if (text && /[「""\u201c\u2018'']/.test(text)) {
            setGridTab(tab);
            return;
          }
        } catch { /* skip */ }
      }
      setGridTab("nine");
    })();
  }, [open, episode, selectedBeat]);

  // 加载台词数据
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      const db = await loadGridImageUrlsFromDisk(browseEp);
      let count = gridTab === "four" ? 4 : 9;
      if (gridTab === "custom") {
        try {
          const cpRaw = await kvLoad(`feicai-custom-grid-prompts-${browseEp}`);
          if (cpRaw) { const d = JSON.parse(cpRaw); if (d.gridCount) { count = d.gridCount; setCustomCount(d.gridCount); } }
        } catch { /* ignore */ }
      }

      // 来源1：动态提示词（可能嵌入台词描写）
      const motionKey = gridTab === "four"
        ? `feicai-motion-prompts-four-${browseEp}-b${browseBeat}`
        : gridTab === "custom"
        ? `feicai-motion-prompts-custom-${browseEp}`
        : `feicai-motion-prompts-${gridTab}-${browseEp}`;
      let motionTexts: string[] = [];
      try {
        const raw = await kvLoad(motionKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          motionTexts = Array.isArray(parsed) ? parsed : parsed?.beats || [];
        }
      } catch { /* ignore */ }

      // 来源2：节拍拆解 beat-breakdown.md（仅四宫格/九宫格使用）
      let beatSections: string[] = [];
      if (gridTab === "four" || gridTab === "nine") {
        try {
          const bbRes = await fetch("/api/outputs/beat-breakdown.md");
          if (bbRes.ok) {
            const bbData = await bbRes.json();
            const content: string = bbData.content || "";
            if (content) {
              beatSections = content.split(/##\s*格?\s*\d/i);
              beatSections.shift();
            }
          }
        } catch { /* ignore */ }
      }

      // 来源3：智能分镜 KV（仅智能分镜标签使用）
      let smartBeats: string[] = [];
      if (gridTab === "smartNine") {
        try {
          const raw = await kvLoad(`feicai-smart-nine-prompts-${browseEp}`);
          if (raw) {
            const data = JSON.parse(raw);
            smartBeats = data?.beats || (Array.isArray(data) ? data : []);
          }
        } catch { /* ignore */ }
      }

      // 组装每个格子的台词
      const result: CellData[] = [];
      for (let i = 0; i < count; i++) {
        const imgKey = gridTab === "four"
          ? `four-${browseEp}-${browseBeat}-${i}`
          : gridTab === "custom" ? `custom-${browseEp}-${i}`
          : gridTab === "smartNine" ? `smartNine-${browseEp}-${i}`
          : `nine-${browseEp}-${i}`;

        let dialogues: DialogueLine[] = [];

        // 动态提示词文本
        dialogues = mergeDialogues(dialogues, extractDialogues(motionTexts[i] || ""));

        // 节拍拆解（四宫格用组索引，其他用格子索引）
        const beatIdx = gridTab === "four" ? browseBeat : i;
        dialogues = mergeDialogues(dialogues, extractDialogues(beatSections[beatIdx] || ""));

        // 智能分镜
        dialogues = mergeDialogues(dialogues, extractDialogues(smartBeats[beatIdx] || ""));

        result.push({ imageUrl: db[imgKey] || "", dialogues });
      }

      // 当前标签页无任何台词时，清除图片避免显示其他模式的残留图片
      if (!result.some(c => c.dialogues.length > 0)) {
        result.forEach(c => { c.imageUrl = ""; });
      }

      setCells(result);
      setLoading(false);
    })();
  }, [open, gridTab, browseEp, browseBeat]);

  if (!open) return null;

  const epList = episodes.length > 0 ? episodes : ["ep01"];
  const gridCols = gridTab === "four" ? "grid-cols-2"
    : gridTab === "custom" ? (customCount <= 4 ? "grid-cols-2" : "grid-cols-3")
    : "grid-cols-3";
  const totalDialogues = cells.reduce((sum, c) => sum + c.dialogues.length, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="flex flex-col w-[620px] max-h-[80vh] bg-[#1A1A1A] border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden">
        {/* 标题栏 */}
        <div className="flex items-center justify-between h-14 px-6 shrink-0">
          <div className="flex items-center gap-2.5">
            <MessageSquareText size={18} className="text-[var(--gold-primary)]" />
            <span className="text-[16px] font-semibold text-[var(--text-primary)]">台词导入</span>
            {totalDialogues > 0 && (
              <span className="text-[11px] text-[var(--text-muted)] bg-[#0D0D0D] px-2 py-0.5 rounded">
                共 {totalDialogues} 条台词
              </span>
            )}
          </div>
          <button onClick={onClose} className="flex items-center justify-center w-8 h-8 rounded-md bg-[#0A0A0A] hover:bg-[#2A2A2A] cursor-pointer">
            <X size={16} className="text-[var(--text-secondary)]" />
          </button>
        </div>
        <div className="h-px bg-[var(--border-default)]" />

        {/* 工具栏：EP/组 + 标签页切换 */}
        <div className="flex items-center gap-3 h-11 px-6 bg-[#12121280] shrink-0">
          <select value={browseEp} onChange={e => setBrowseEp(e.target.value)} suppressHydrationWarning
            className="h-7 px-2 bg-[#0A0A0A] border border-[var(--border-default)] rounded text-[11px] font-medium text-[var(--gold-primary)] outline-none cursor-pointer appearance-none">
            {epList.map(ep => <option key={ep} value={ep} className="bg-[#0A0A0A]">{ep.toUpperCase()}</option>)}
          </select>
          {gridTab === "four" && (
            <select value={browseBeat} onChange={e => setBrowseBeat(Number(e.target.value))} suppressHydrationWarning
              className="h-7 px-2 bg-[#0A0A0A] border border-[var(--border-default)] rounded text-[11px] text-[var(--text-secondary)] outline-none cursor-pointer appearance-none">
              {Array.from({ length: 9 }, (_, i) => (
                <option key={i} value={i} className="bg-[#0A0A0A]">组{i + 1}</option>
              ))}
            </select>
          )}
          <div className="flex-1" />
          <div className="flex items-center h-7 rounded border border-[var(--border-default)] overflow-hidden">
            {([
              { tab: "four" as const, icon: Grid2X2, label: "四宫格" },
              { tab: "nine" as const, icon: Grid3X3, label: "九宫格" },
              { tab: "smartNine" as const, icon: Sparkles, label: "智能分镜" },
              { tab: "custom" as const, icon: LayoutGrid, label: "自定义" },
            ]).map(({ tab, icon: Icon, label }) => (
              <button key={tab} onClick={() => { setGridTab(tab); setCells([]); setLoading(true); }}
                className={`flex items-center gap-1.5 px-3 h-full text-[11px] cursor-pointer transition ${
                  gridTab === tab
                    ? "bg-[var(--gold-primary)] text-[#0A0A0A] font-medium"
                    : "text-[var(--text-secondary)] hover:bg-[#2A2A2A]"
                }`}>
                <Icon size={12} />{label}
              </button>
            ))}
          </div>
        </div>
        <div className="h-px bg-[var(--border-default)]" />

        {/* 宫格内容 */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-[var(--text-muted)] text-sm">加载中...</div>
          ) : (
            <div className={`grid ${gridCols} gap-3`}>
              {cells.map((cell, idx) => {
                const hasDialogue = cell.dialogues.length > 0;
                return (
                  <button key={idx} disabled={!hasDialogue}
                    onClick={() => { if (hasDialogue) { onSelect(cell.dialogues); onClose(); } }}
                    className={`group relative flex flex-col rounded-lg border overflow-hidden text-left transition-all ${
                      hasDialogue
                        ? "border-[var(--border-default)] hover:border-[var(--gold-primary)] hover:shadow-[0_0_12px_rgba(201,169,98,0.15)] cursor-pointer"
                        : "border-[#2A2A2A] opacity-40 cursor-not-allowed"
                    }`}>
                    {/* 缩略图 */}
                    <div className={`w-full aspect-[16/9] bg-[#0A0A0A] flex items-center justify-center ${hasDialogue ? "group-hover:brightness-110" : ""}`}>
                      {cell.imageUrl ? (
                        <img src={cell.imageUrl} alt={`格${idx + 1}`} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] text-[var(--text-muted)]">无图片</span>
                      )}
                    </div>
                    {/* 格子编号 + 台词数量标签 */}
                    <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                        hasDialogue ? "bg-[var(--gold-primary)] text-[#0A0A0A]" : "bg-[#2A2A2A] text-[var(--text-muted)]"
                      }`}>格{idx + 1}</span>
                      {hasDialogue && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-500/80 text-white text-[9px] font-medium">
                          {cell.dialogues.length}条
                        </span>
                      )}
                    </div>
                    {/* 台词预览 */}
                    <div className="px-2.5 py-2 bg-[#141414] min-h-[52px]">
                      {hasDialogue ? (
                        <div className="flex flex-col gap-1">
                          {cell.dialogues.slice(0, 2).map((d, di) => (
                            <p key={di} className="text-[10px] leading-relaxed text-[var(--text-secondary)] truncate">
                              <span className="text-[var(--gold-primary)] font-medium">{d.role}：</span>{d.text}
                            </p>
                          ))}
                          {cell.dialogues.length > 2 && (
                            <span className="text-[9px] text-[var(--text-muted)]">...还有 {cell.dialogues.length - 2} 条</span>
                          )}
                        </div>
                      ) : (
                        <p className="text-[10px] text-[var(--text-muted)]">无台词</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="h-px bg-[var(--border-default)]" />
        <div className="flex items-center gap-2 h-9 px-6 bg-[#0D0D0D] shrink-0">
          <Info size={10} className="text-[var(--text-muted)]" />
          <span className="text-[10px] text-[var(--text-muted)]">点击有台词的格子即可导入，台词将作为 AI 提示词生成的上下文。灰色格子表示无台词</span>
        </div>
      </div>
    </div>
  );
}
