"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X, Check, Trash2, ChevronDown, Loader, Upload,
  CheckCircle2, XCircle, Info, Image as ImageIcon,
} from "lucide-react";
import type { SoraCharacter, SoraCharCategory } from "../../lib/zhenzhen/types";
import { SORA_CHAR_CATEGORY_LABEL } from "../../lib/zhenzhen/types";
import { kvLoad } from "../../lib/kvDB";

// ═══════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════

/** 工作台一致性素材（来自生图工作台 IndexedDB） */
export interface StudioItem {
  id: string;
  name: string;
  description: string;
  referenceImage: string; // URL 或 data URI
  category: SoraCharCategory;
  source: "studio";
}

/** 上传适配器接口 — 可扩展支持不同 API */
export interface CharUploadAdapter {
  /** 适配器名称，如 "贞贞工坊" */
  name: string;
  /** 上传单个工作台素材（图→视频→角色提取），返回创建的 SoraCharacter */
  upload(item: StudioItem, apiKey: string, baseUrl: string): Promise<SoraCharacter>;
}

/** 统一列表项 — Sora 素材 或 工作台素材 */
type UnifiedItem =
  | { kind: "sora"; data: SoraCharacter }
  | { kind: "studio"; data: StudioItem };

/** 单个上传任务状态 */
interface UploadTask {
  itemId: string;
  itemName: string;
  category: SoraCharCategory;
  image?: string;
  status: "pending" | "uploading" | "success" | "error";
  progress: string;
  error?: string;
}

/** 弹窗页面 */
type ModalPage = "select" | "uploading";

/** 来源标签页 */
type SourceTab = "all" | "studio" | "sora";

interface SoraLibraryModalProps {
  open: boolean;
  onClose: () => void;
  /** Sora 已创建的素材 */
  characters: SoraCharacter[];
  /** 当前已选中注入提示词的角色 ID */
  selectedIds: string[];
  /** 切换注入提示词选中 */
  onToggleSelect: (charId: string) => void;
  /** 删除 Sora 角色 */
  onDelete: (charId: string) => void;
  /** 上传完成回调 */
  onUploadComplete?: (newChars: SoraCharacter[]) => void;
  /** API Key */
  apiKey: string;
  /** API Base URL */
  baseUrl: string;
  /** 上传适配器列表 */
  adapters?: CharUploadAdapter[];
}

// ═══════════════════════════════════════════════════════════
// 素材库弹窗组件
// ═══════════════════════════════════════════════════════════

export default function SoraLibraryModal({
  open,
  onClose,
  characters,
  selectedIds,
  onToggleSelect,
  onDelete,
  onUploadComplete,
  apiKey,
  baseUrl,
  adapters = [],
}: SoraLibraryModalProps) {
  const [page, setPage] = useState<ModalPage>("select");
  const [filterCategory, setFilterCategory] = useState<SoraCharCategory | "all">("all");
  const [sourceTab, setSourceTab] = useState<SourceTab>("all");
  const [uploadSelection, setUploadSelection] = useState<Set<string>>(new Set());
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [uploadDone, setUploadDone] = useState(false);
  const [activeAdapter, setActiveAdapter] = useState(0);
  // 工作台一致性素材
  const [studioItems, setStudioItems] = useState<StudioItem[]>([]);
  const [studioLoading, setStudioLoading] = useState(false);

  // ── 打开弹窗时加载工作台素材 ──
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStudioLoading(true);

    (async () => {
      try {
        const raw = await kvLoad("feicai-consistency");
        if (cancelled || !raw) { setStudioLoading(false); return; }
        const profile = JSON.parse(raw);
        const items: StudioItem[] = [];

        for (const ch of profile.characters || []) {
          if (ch.referenceImage) {
            items.push({ id: `studio-char-${ch.id}`, name: ch.name, description: ch.description || "", referenceImage: ch.referenceImage, category: "character", source: "studio" });
          }
        }
        for (const sc of profile.scenes || []) {
          if (sc.referenceImage) {
            items.push({ id: `studio-scene-${sc.id}`, name: sc.name, description: sc.description || "", referenceImage: sc.referenceImage, category: "scene", source: "studio" });
          }
        }
        for (const pr of profile.props || []) {
          if (pr.referenceImage) {
            items.push({ id: `studio-prop-${pr.id}`, name: pr.name, description: pr.description || "", referenceImage: pr.referenceImage, category: "prop", source: "studio" });
          }
        }

        if (!cancelled) setStudioItems(items);
      } catch { /* ignore */ }
      if (!cancelled) setStudioLoading(false);
    })();

    return () => { cancelled = true; };
  }, [open]);

  // 重置关闭
  const resetAndClose = useCallback(() => {
    setPage("select");
    setUploadSelection(new Set());
    setUploadTasks([]);
    setUploadDone(false);
    setFilterCategory("all");
    setSourceTab("all");
    onClose();
  }, [onClose]);

  if (!open) return null;

  // ── 构建统一列表 ──
  const unifiedList: UnifiedItem[] = [];
  if (sourceTab !== "studio") {
    for (const c of characters) unifiedList.push({ kind: "sora", data: c });
  }
  if (sourceTab !== "sora") {
    for (const s of studioItems) unifiedList.push({ kind: "studio", data: s });
  }

  // 按分类筛选
  const getItemCategory = (item: UnifiedItem): SoraCharCategory =>
    item.kind === "sora" ? (item.data.category || "character") : item.data.category;
  const getItemId = (item: UnifiedItem) => item.kind === "sora" ? item.data.id : item.data.id;

  const filteredList = unifiedList.filter(item =>
    filterCategory === "all" || getItemCategory(item) === filterCategory
  );

  // 计数
  const soraCount = characters.length;
  const studioCount = studioItems.length;
  const totalCount = soraCount + studioCount;

  const countByCategory = (cat: SoraCharCategory | "all") =>
    unifiedList.filter(item => cat === "all" || getItemCategory(item) === cat).length;

  // 切换上传勾选
  const toggleUploadSelect = (id: string) => {
    setUploadSelection(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    const allIds = filteredList.map(getItemId);
    const allSelected = allIds.length > 0 && allIds.every(id => uploadSelection.has(id));
    setUploadSelection(prev => {
      const next = new Set(prev);
      if (allSelected) allIds.forEach(id => next.delete(id));
      else allIds.forEach(id => next.add(id));
      return next;
    });
  };

  // 工作台素材被勾选的数量（只有工作台素材需要上传）
  const studioSelectionCount = studioItems.filter(s => uploadSelection.has(s.id)).length;

  // ── 开始上传（仅上传工作台素材） ──
  const startUpload = async () => {
    if (studioSelectionCount === 0 || adapters.length === 0) return;
    const adapter = adapters[activeAdapter];
    if (!adapter) return;

    const itemsToUpload = studioItems.filter(s => uploadSelection.has(s.id));
    const tasks: UploadTask[] = itemsToUpload.map(s => ({
      itemId: s.id,
      itemName: s.name,
      category: s.category,
      image: s.referenceImage,
      status: "pending" as const,
      progress: "等待中...",
    }));
    setUploadTasks(tasks);
    setUploadDone(false);
    setPage("uploading");

    const newChars: SoraCharacter[] = [];

    for (let i = 0; i < itemsToUpload.length; i++) {
      const item = itemsToUpload[i];
      setUploadTasks(prev => prev.map((t, idx) =>
        idx === i ? { ...t, status: "uploading", progress: `图→视频→角色提取中... (${i + 1}/${itemsToUpload.length})` } : t
      ));

      try {
        const result = await adapter.upload(item, apiKey, baseUrl);
        newChars.push(result);
        setUploadTasks(prev => prev.map((t, idx) =>
          idx === i ? { ...t, status: "success", progress: `@${result.username} 创建成功` } : t
        ));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "未知错误";
        setUploadTasks(prev => prev.map((t, idx) =>
          idx === i ? { ...t, status: "error", progress: msg, error: msg } : t
        ));
      }
    }

    setUploadDone(true);
    if (newChars.length > 0) onUploadComplete?.(newChars);
  };

  // ── 渲染 ──
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={resetAndClose}>
      <div className="relative w-[600px] max-h-[80vh] bg-[#111111] border border-[var(--border-default)] rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>

        {/* ═══ 标题栏 ═══ */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-default)] bg-[#0D0D0D]">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-purple-400" />
            <span className="text-[14px] font-medium text-[var(--text-primary)]">Sora 素材库</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border text-purple-400/80 bg-purple-500/10 border-purple-500/20">
              {totalCount} 个素材
            </span>
          </div>
          <button onClick={resetAndClose} className="text-[var(--text-muted)] hover:text-white cursor-pointer p-1 rounded hover:bg-white/5 transition">
            <X size={16} />
          </button>
        </div>

        {/* ═══ 选择页面 ═══ */}
        {page === "select" && (
          <>
            {/* 来源标签 + 分类筛选 */}
            <div className="flex flex-col gap-0 border-b border-[var(--border-default)] bg-[#0A0A0A]">
              {/* 来源标签页 */}
              <div className="flex items-center gap-0 px-5 border-b border-[var(--border-default)]">
                {([
                  { key: "all" as SourceTab, label: "全部", count: totalCount },
                  { key: "studio" as SourceTab, label: "🎨 工作台", count: studioCount },
                  { key: "sora" as SourceTab, label: "✨ Sora", count: soraCount },
                ]).map(tab => (
                  <button key={tab.key} onClick={() => setSourceTab(tab.key)}
                    className={`text-[11px] px-4 py-2.5 border-b-2 cursor-pointer transition ${
                      sourceTab === tab.key
                        ? "border-purple-400 text-purple-300 font-medium"
                        : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    }`}>
                    {tab.label} ({tab.count})
                  </button>
                ))}
              </div>

              {/* 分类筛选标签 */}
              <div className="flex items-center gap-2 px-5 py-2">
                {(["all", "character", "scene", "prop"] as const).map(cat => (
                  <button key={cat} onClick={() => setFilterCategory(cat)}
                    className={`text-[10px] px-3 py-1 rounded-full border cursor-pointer transition ${
                      filterCategory === cat
                        ? "bg-purple-500/20 border-purple-500/40 text-purple-300 font-medium"
                        : "bg-transparent border-[var(--border-default)] text-[var(--text-muted)] hover:border-purple-500/30"
                    }`}>
                    {cat === "all" ? `全部 (${countByCategory("all")})` : `${SORA_CHAR_CATEGORY_LABEL[cat]} (${countByCategory(cat)})`}
                  </button>
                ))}

                <button onClick={toggleSelectAll}
                  className="ml-auto text-[9px] px-2 py-1 rounded border border-[var(--border-default)] text-[var(--text-muted)] hover:text-purple-300 hover:border-purple-500/30 cursor-pointer transition">
                  {filteredList.length > 0 && filteredList.every(i => uploadSelection.has(getItemId(i))) ? "取消全选" : "全选"}
                </button>
              </div>
            </div>

            {/* 列表 */}
            <div className="flex-1 overflow-auto px-3 py-2" style={{ maxHeight: "calc(80vh - 240px)" }}>
              {studioLoading ? (
                <div className="flex items-center justify-center py-12 gap-2">
                  <Loader size={16} className="animate-spin text-[var(--text-muted)]" />
                  <span className="text-[11px] text-[var(--text-muted)]">加载工作台素材...</span>
                </div>
              ) : filteredList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <span className="text-[11px] text-[var(--text-muted)]">暂无此类素材</span>
                  <span className="text-[9px] text-[var(--text-muted)]">
                    {sourceTab === "studio"
                      ? "请在生图工作台的一致性面板添加角色/场景/道具并上传参考图"
                      : sourceTab === "sora"
                        ? "从已生成的 Sora 视频中提取角色/场景/道具"
                        : "在生图工作台添加一致性素材，或从 Sora 视频中提取"}
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-1">
                  {filteredList.map(item => {
                    const id = getItemId(item);
                    const isUploadChecked = uploadSelection.has(id);
                    const cat = getItemCategory(item);
                    const catLabel = SORA_CHAR_CATEGORY_LABEL[cat];

                    if (item.kind === "sora") {
                      const char = item.data;
                      const isSelected = selectedIds.includes(char.id);
                      return (
                        <div key={id}
                          className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg transition border ${
                            isUploadChecked ? "bg-purple-500/10 border-purple-500/30" : "bg-transparent border-transparent hover:bg-[#1A1A1A]"
                          }`}>
                          {/* 勾选框（Sora 素材已在 API 侧，不参与上传） */}
                          <button onClick={() => toggleUploadSelect(id)}
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 cursor-pointer transition ${
                              isUploadChecked ? "bg-purple-500 border-purple-500" : "border-[var(--border-default)] hover:border-purple-400"
                            }`}>
                            {isUploadChecked && <Check size={12} className="text-white" />}
                          </button>

                          {char.profilePicture ? (
                            <img src={char.profilePicture} alt={char.username}
                              className="w-11 h-11 rounded-lg object-cover border border-[var(--border-default)] shrink-0" />
                          ) : (
                            <div className="w-11 h-11 rounded-lg bg-[#2A2A2A] flex items-center justify-center text-[16px] text-[var(--text-muted)] border border-[var(--border-default)] shrink-0">@</div>
                          )}

                          <button onClick={() => onToggleSelect(char.id)} className="flex flex-col flex-1 text-left min-w-0 cursor-pointer">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[12px] font-medium text-[var(--text-primary)] truncate">
                                {char.nickname || `@${char.username}`}
                              </span>
                              <span className={`text-[8px] px-1.5 py-0.5 rounded shrink-0 ${
                                cat === "scene" ? "bg-emerald-500/20 text-emerald-400" :
                                cat === "prop" ? "bg-amber-500/20 text-amber-400" :
                                "bg-purple-500/20 text-purple-400"
                              }`}>{catLabel}</span>
                              <span className="text-[8px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400/70 shrink-0">Sora</span>
                              {isSelected && (
                                <span className="text-[8px] px-1.5 py-0.5 rounded bg-purple-500/30 text-purple-300 shrink-0">已注入</span>
                              )}
                            </div>
                            <span className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">
                              @{char.username} · {new Date(char.createdAt).toLocaleDateString()}
                            </span>
                          </button>

                          <button onClick={() => onDelete(char.id)}
                            className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-red-400 cursor-pointer p-1.5 rounded hover:bg-red-500/10 transition shrink-0"
                            title="删除素材">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      );
                    }

                    // ── 工作台素材 ──
                    const studio = item.data;
                    return (
                      <div key={id}
                        className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg transition border ${
                          isUploadChecked ? "bg-amber-500/10 border-amber-500/30" : "bg-transparent border-transparent hover:bg-[#1A1A1A]"
                        }`}>
                        <button onClick={() => toggleUploadSelect(id)}
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 cursor-pointer transition ${
                            isUploadChecked ? "bg-amber-500 border-amber-500" : "border-[var(--border-default)] hover:border-amber-400"
                          }`}>
                          {isUploadChecked && <Check size={12} className="text-black" />}
                        </button>

                        {studio.referenceImage ? (
                          <img src={studio.referenceImage} alt={studio.name}
                            className="w-11 h-11 rounded-lg object-cover border border-amber-500/20 shrink-0" />
                        ) : (
                          <div className="w-11 h-11 rounded-lg bg-[#2A2A2A] flex items-center justify-center shrink-0 border border-[var(--border-default)]">
                            <ImageIcon size={16} className="text-[var(--text-muted)]" />
                          </div>
                        )}

                        <div className="flex flex-col flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12px] font-medium text-[var(--text-primary)] truncate">{studio.name}</span>
                            <span className={`text-[8px] px-1.5 py-0.5 rounded shrink-0 ${
                              cat === "scene" ? "bg-emerald-500/20 text-emerald-400" :
                              cat === "prop" ? "bg-amber-500/20 text-amber-400" :
                              "bg-purple-500/20 text-purple-400"
                            }`}>{catLabel}</span>
                            <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400/70 shrink-0">工作台</span>
                          </div>
                          <span className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">
                            {studio.description || "来自生图工作台一致性面板"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 底部操作栏 */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border-default)] bg-[#0D0D0D]">
              <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                <Info size={10} />
                <span>勾选工作台素材 → 图生视频 → 自动创建 Sora 角色（约1-3分钟/个）</span>
              </div>
              <div className="flex items-center gap-2">
                {adapters.length > 1 && (
                  <div className="relative">
                    <select value={activeAdapter} onChange={e => setActiveAdapter(Number(e.target.value))}
                      className="appearance-none text-[10px] px-3 py-1.5 pr-6 rounded border border-[var(--border-default)] bg-[#1A1A1A] text-[var(--text-primary)] cursor-pointer outline-none">
                      {adapters.map((a, i) => (
                        <option key={i} value={i}>{a.name}</option>
                      ))}
                    </select>
                    <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                  </div>
                )}

                <button onClick={resetAndClose}
                  className="text-[11px] px-4 py-1.5 rounded border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[#1A1A1A] cursor-pointer transition">
                  关闭
                </button>

                {adapters.length > 0 && (
                  <button onClick={startUpload}
                    disabled={studioSelectionCount === 0 || !apiKey}
                    className="flex items-center gap-1.5 text-[11px] px-4 py-1.5 rounded bg-amber-600/80 hover:bg-amber-600 text-black font-medium cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed">
                    <Upload size={12} />
                    <span>上传到 Sora {studioSelectionCount > 0 ? `(${studioSelectionCount})` : ""}</span>
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {/* ═══ 上传进度页面 ═══ */}
        {page === "uploading" && (
          <>
            <div className="flex flex-col items-center gap-2 px-5 pt-6 pb-3">
              {!uploadDone ? (
                <>
                  <Loader size={28} className="animate-spin text-amber-400" />
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">正在创建 Sora 素材...</span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    参考图 → 视频生成 → 角色提取 · {uploadTasks.filter(t => t.status === "success").length} / {uploadTasks.length} 完成
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={28} className="text-green-400" />
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">创建完成</span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    成功 {uploadTasks.filter(t => t.status === "success").length}，
                    失败 {uploadTasks.filter(t => t.status === "error").length}
                  </span>
                </>
              )}
            </div>

            {/* 总进度条 */}
            <div className="mx-5 mb-3">
              <div className="h-1.5 rounded-full bg-[#2A2A2A] overflow-hidden">
                <div className="h-full rounded-full bg-amber-500 transition-all duration-500"
                  style={{ width: `${uploadTasks.length > 0 ? (uploadTasks.filter(t => t.status === "success" || t.status === "error").length / uploadTasks.length) * 100 : 0}%` }} />
              </div>
            </div>

            {/* 任务列表 */}
            <div className="flex-1 overflow-auto px-5 pb-3" style={{ maxHeight: "calc(80vh - 260px)" }}>
              <div className="flex flex-col gap-1.5">
                {uploadTasks.map(task => {
                  const catLabel = SORA_CHAR_CATEGORY_LABEL[task.category];
                  return (
                    <div key={task.itemId} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#0D0D0D] border border-[var(--border-default)]">
                      <div className="shrink-0">
                        {task.status === "pending" && <div className="w-5 h-5 rounded-full border-2 border-[var(--border-default)]" />}
                        {task.status === "uploading" && <Loader size={18} className="animate-spin text-amber-400" />}
                        {task.status === "success" && <CheckCircle2 size={18} className="text-green-400" />}
                        {task.status === "error" && <XCircle size={18} className="text-red-400" />}
                      </div>

                      {task.image ? (
                        <img src={task.image} alt={task.itemName}
                          className="w-9 h-9 rounded-md object-cover border border-[var(--border-default)] shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-md bg-[#2A2A2A] flex items-center justify-center border border-[var(--border-default)] shrink-0">
                          <ImageIcon size={14} className="text-[var(--text-muted)]" />
                        </div>
                      )}

                      <div className="flex flex-col flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-medium text-[var(--text-primary)] truncate">{task.itemName}</span>
                          <span className={`text-[8px] px-1 py-px rounded shrink-0 ${
                            task.category === "scene" ? "bg-emerald-500/20 text-emerald-400" :
                            task.category === "prop" ? "bg-amber-500/20 text-amber-400" :
                            "bg-purple-500/20 text-purple-400"
                          }`}>{catLabel}</span>
                        </div>
                        <span className={`text-[9px] mt-0.5 ${
                          task.status === "error" ? "text-red-400" :
                          task.status === "success" ? "text-green-400/80" :
                          "text-[var(--text-muted)]"
                        }`}>{task.progress}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 底部按钮 */}
            <div className="flex items-center justify-end px-5 py-3 border-t border-[var(--border-default)] bg-[#0D0D0D]">
              {uploadDone ? (
                <button onClick={resetAndClose}
                  className="flex items-center gap-1.5 text-[11px] px-5 py-1.5 rounded bg-amber-600/80 hover:bg-amber-600 text-black font-medium cursor-pointer transition">
                  <Check size={12} />
                  <span>完成</span>
                </button>
              ) : (
                <span className="text-[10px] text-[var(--text-muted)] animate-pulse">图→视频→角色提取中，请耐心等待...</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
