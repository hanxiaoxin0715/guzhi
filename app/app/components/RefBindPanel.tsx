"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { X, Check, Image as ImageIcon, User, Mountain, Sword, Info } from "lucide-react";
import type { ConsistencyProfile } from "../lib/consistency";
import { collectMatchedReferenceImages, isValidImageRef } from "../lib/consistency";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export type RefBindTarget =
  | { type: "nine-global" }
  | { type: "four-global"; beatIdx: number }
  | { type: "smartNine-global" }
  | { type: "custom-global" }
  | { type: "cell"; cellKey: string };

interface RefItem {
  id: string;
  category: "char" | "scene" | "prop";
  name: string;
  description: string;
  referenceImage: string;
  isSmartMatch: boolean; // pre-selected by smart matching
}

/** Episode-level mention info: which characters/scenes/props appear in current EP prompts */
export interface EpisodeMentions {
  characters: string[];  // names
  scenes: string[];
  props: string[];
}

interface RefBindPanelProps {
  open: boolean;
  target: RefBindTarget | null;
  consistency: ConsistencyProfile;
  /** Currently bound item IDs (NOT URLs) — null means "never set, use smart matching"; [] means "explicitly cleared" */
  currentBindIds: string[] | null;
  promptTexts: string[];       // prompts for smart matching context
  episodeMentions?: EpisodeMentions; // EP-level character/scene/prop mentions
  episodeLabel?: string; // e.g. "EP01"
  /** Callback returns selected item IDs (NOT URLs) */
  onConfirm: (target: RefBindTarget, selectedIds: string[]) => void;
  onClose: () => void;
}

type TabKey = "char" | "scene" | "prop";

const TAB_ITEMS: { key: TabKey; label: string; icon: typeof User }[] = [
  { key: "char", label: "角色", icon: User },
  { key: "scene", label: "场景", icon: Mountain },
  { key: "prop", label: "道具", icon: Sword },
];

// ═══════════════════════════════════════════════════════════
// RefBindPanel Component — binds by item ID for stability
// ═══════════════════════════════════════════════════════════

export default function RefBindPanel({ open, target, consistency, currentBindIds, promptTexts, episodeMentions, episodeLabel, onConfirm, onClose }: RefBindPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("char");
  /** Selected item IDs (not URLs) */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** Prevent useEffect from resetting selection after initial open */
  const initDoneRef = useRef(false);

  // Build available ref items with smart-match flags
  const allItems = useMemo(() => {
    const items: RefItem[] = [];

    // Compute smart-matched image URLs → then map to IDs
    const smartMatchedUrls = new Set(
      collectMatchedReferenceImages(consistency, promptTexts)
    );

    for (const c of consistency.characters) {
      if (isValidImageRef(c.referenceImage)) {
        items.push({
          id: c.id,
          category: "char",
          name: c.name,
          description: c.description,
          referenceImage: c.referenceImage,
          isSmartMatch: smartMatchedUrls.has(c.referenceImage),
        });
      }
    }
    for (const s of consistency.scenes) {
      if (isValidImageRef(s.referenceImage)) {
        items.push({
          id: s.id,
          category: "scene",
          name: s.name,
          description: s.description,
          referenceImage: s.referenceImage,
          isSmartMatch: smartMatchedUrls.has(s.referenceImage),
        });
      }
    }
    for (const p of consistency.props) {
      if (isValidImageRef(p.referenceImage)) {
        items.push({
          id: p.id,
          category: "prop",
          name: p.name,
          description: p.description,
          referenceImage: p.referenceImage,
          isSmartMatch: smartMatchedUrls.has(p.referenceImage),
        });
      }
    }

    return items;
  }, [consistency, promptTexts]);

  // Initialize selection ONCE per panel open; skip subsequent re-renders to avoid resetting user edits
  useEffect(() => {
    if (!open) { initDoneRef.current = false; return; }
    if (initDoneRef.current) return; // Already initialized for this open session
    initDoneRef.current = true;

    if (currentBindIds !== null && currentBindIds.length > 0) {
      // Preserve existing bindings (by ID)
      setSelectedIds(new Set(currentBindIds));
    } else if (currentBindIds === null) {
      // Never set — smart pre-selection (convert smart-matched items to IDs)
      const smartIds = allItems.filter((i) => i.isSmartMatch).map((i) => i.id);
      setSelectedIds(new Set(smartIds));
    } else {
      // Explicitly cleared to empty
      setSelectedIds(new Set());
    }
    // Default to first tab that has items
    const firstTab = TAB_ITEMS.find((t) => allItems.some((i) => i.category === t.key));
    if (firstTab) setActiveTab(firstTab.key);
  }, [open, currentBindIds, allItems]);

  const toggleItem = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (!target) return;
    onConfirm(target, Array.from(selectedIds));
  }, [target, selectedIds, onConfirm]);

  // Escape key to close panel
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Filter items by active tab
  const tabItems = useMemo(() => allItems.filter((i) => i.category === activeTab), [allItems, activeTab]);

  // Tab counts
  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { char: 0, scene: 0, prop: 0 };
    for (const i of allItems) counts[i.category]++;
    return counts;
  }, [allItems]);

  if (!open || !target) return null;

  const targetLabel =
    target.type === "nine-global" ? "九宫格全局参考图" :
    target.type === "smartNine-global" ? "智能分镜全局参考图" :
    target.type === "custom-global" ? "自定义宫格全局参考图" :
    target.type === "four-global" ? `四宫格组${target.beatIdx + 1}参考图` :
    `格级参考图 (${target.cellKey})`;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}>
      <div className="relative flex flex-col w-[520px] max-h-[80vh] bg-[#141414] border border-[var(--border-default)] rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-default)]">
          <div className="flex flex-col gap-0.5">
            <span className="text-[14px] font-semibold text-[var(--text-primary)]">参考图绑定</span>
            <span className="text-[11px] text-[var(--text-muted)]">{targetLabel}</span>
          </div>
          <button onClick={onClose}
            className="flex items-center justify-center w-7 h-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer rounded">
            <X size={16} />
          </button>
        </div>

        {/* Episode Mentions Info Box */}
        {episodeMentions && (episodeMentions.characters.length > 0 || episodeMentions.scenes.length > 0 || episodeMentions.props.length > 0) && (
          <div className="mx-4 mt-3 p-3 bg-[#1e1e2e] border border-[var(--gold-primary)]/30 rounded-lg">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Info size={13} className="text-[var(--gold-primary)] shrink-0" />
              <span className="text-[11px] font-semibold text-[var(--gold-primary)]">
                {episodeLabel ? `${episodeLabel.toUpperCase()} 本集出场` : "本集出场"}
              </span>
            </div>
            <div className="flex flex-col gap-1 text-[10px] leading-relaxed">
              {episodeMentions.characters.length > 0 && (
                <div className="flex items-start gap-1.5">
                  <User size={11} className="text-[var(--text-muted)] shrink-0 mt-0.5" />
                  <span className="text-[var(--text-secondary)]">
                    <span className="text-[var(--text-muted)]">角色：</span>
                    {episodeMentions.characters.join("、")}
                  </span>
                </div>
              )}
              {episodeMentions.scenes.length > 0 && (
                <div className="flex items-start gap-1.5">
                  <Mountain size={11} className="text-[var(--text-muted)] shrink-0 mt-0.5" />
                  <span className="text-[var(--text-secondary)]">
                    <span className="text-[var(--text-muted)]">场景：</span>
                    {episodeMentions.scenes.join("、")}
                  </span>
                </div>
              )}
              {episodeMentions.props.length > 0 && (
                <div className="flex items-start gap-1.5">
                  <Sword size={11} className="text-[var(--text-muted)] shrink-0 mt-0.5" />
                  <span className="text-[var(--text-secondary)]">
                    <span className="text-[var(--text-muted)]">道具：</span>
                    {episodeMentions.props.join("、")}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-0 border-b border-[var(--border-default)]">
          {TAB_ITEMS.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium border-b-2 transition cursor-pointer ${
                activeTab === key
                  ? "text-[var(--gold-primary)] border-[var(--gold-primary)]"
                  : "text-[var(--text-muted)] border-transparent hover:text-[var(--text-secondary)]"
              }`}>
              <Icon size={13} />
              {label}
              {tabCounts[key] > 0 && (
                <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${
                  activeTab === key ? "bg-[var(--gold-transparent)] text-[var(--gold-primary)]" : "bg-[#2a2a2a] text-[var(--text-muted)]"
                }`}>{tabCounts[key]}</span>
              )}
            </button>
          ))}
        </div>

        {/* Content — scrollable grid of ref items */}
        <div className="flex-1 overflow-y-auto p-4 min-h-[240px] max-h-[50vh]">
          {tabItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-muted)]">
              <ImageIcon size={32} className="opacity-30" />
              <span className="text-[12px]">该分类下无可用参考图</span>
              <span className="text-[10px]">请先在左侧面板上传参考图</span>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {tabItems.map((item) => {
                const isSelected = selectedIds.has(item.id);
                return (
                  <button key={item.id} onClick={() => toggleItem(item.id)}
                    className={`group relative flex flex-col gap-1.5 p-2 rounded-lg border-2 transition cursor-pointer overflow-hidden ${
                      isSelected
                        ? "border-[var(--gold-primary)] bg-[var(--gold-transparent)]"
                        : "border-[#2a2a2a] bg-[#1a1a1a] hover:border-[var(--gold-primary)]/40"
                    }`}>
                    {/* Thumbnail */}
                    <div className="relative w-full aspect-square rounded overflow-hidden bg-[#0a0a0a]">
                      <img src={item.referenceImage} alt={item.name}
                        className="w-full h-full object-cover" />
                      {/* Selection check */}
                      {isSelected && (
                        <div className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-[var(--gold-primary)] rounded-full">
                          <Check size={12} className="text-[#0A0A0A]" />
                        </div>
                      )}
                      {/* Smart match badge */}
                      {item.isSmartMatch && (
                        <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-[#0A0A0A]/80 text-[8px] text-[var(--gold-primary)] rounded">
                          智能推荐
                        </div>
                      )}
                    </div>
                    {/* Name + description */}
                    <span className="text-[11px] font-medium text-[var(--text-primary)] truncate w-full text-left">{item.name}</span>
                    <span className="text-[9px] text-[var(--text-muted)] truncate w-full text-left">{item.description.slice(0, 30)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Hint notes */}
        <div className="flex flex-col gap-1 px-5 pt-2.5 text-[10px] text-[var(--text-muted)] leading-relaxed">
          <span>💡 全局参考图：根据「本集出场」智能推荐绑定，适用于整页所有格子。</span>
          <span>💡 单格参考图：需人工识别对应提示词内容，手动绑定最匹配的参考图。</span>
          {selectedIds.size > 5 && (
            <span className="text-amber-400">⚠ 选择大于 5 张参考图会降低图像模型的注意力，一致性大概率无法保持，建议根据当前集数选择参考图。</span>
          )}
        </div>

        {/* Footer — count + actions */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border-default)]">
          <span className="text-[11px] text-[var(--text-muted)]">
            已选 <span className="text-[var(--gold-primary)] font-semibold">{selectedIds.size}</span> 张参考图
            {allItems.filter((i) => i.isSmartMatch).length > 0 && selectedIds.size === 0 && (
              <span className="ml-2 text-[var(--text-muted)]">
                （智能推荐 {allItems.filter((i) => i.isSmartMatch).length} 张）
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedIds(new Set())}
              className="px-3 py-1.5 text-[11px] text-[var(--text-secondary)] border border-[var(--border-default)] hover:border-[var(--text-muted)] transition cursor-pointer rounded">
              清空
            </button>
            <button onClick={onClose}
              className="px-3 py-1.5 text-[11px] text-[var(--text-secondary)] border border-[var(--border-default)] hover:border-[var(--text-muted)] transition cursor-pointer rounded">
              取消
            </button>
            <button onClick={handleConfirm}
              className="px-4 py-1.5 text-[11px] font-medium text-[#0A0A0A] bg-[var(--gold-primary)] hover:brightness-110 transition cursor-pointer rounded">
              确认绑定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
