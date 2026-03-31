/**
 * 角色库管理页面
 *
 * 功能：
 * - 管理当前工作台 + 所有归档项目的角色/场景/道具
 * - 当前工作台条目可增删改（与生图工作台一致性面板双向同步）
 * - 归档项目条目只读浏览
 * - 参考图上传、搜索、大图预览
 */
"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  User, Mountain, Sword, Search, Plus, Trash2, X, Loader,
  ZoomIn, Upload, Save, Package, ChevronDown, Star, Edit3, CheckSquare,
  RefreshCw, ExternalLink, Check, AlertCircle,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import type { ConsistencyProfile, CharacterRef, SceneRef, PropRef } from "../lib/consistency";
import { loadConsistencyAsync, saveConsistency, restoreConsistencyImagesFromDisk, isValidImageRef } from "../lib/consistency";
import { loadProjects, saveProjects, persistProjectToDisk, type ArchivedProject } from "../lib/projects";
import { isSoraModel, type SoraCharacter } from "../lib/zhenzhen/types";
import { kvLoad } from "../lib/kvDB";

// ─── 类型 ───

type TabKey = "characters" | "scenes" | "props";

interface DisplayItem {
  id: string;
  name: string;
  description: string;
  aliases?: string[];
  prompt?: string;
  referenceImage?: string;
  /** 来源标识 */
  source: "current" | string; // "current" 或归档项目 ID
  sourceName: string;
  type: TabKey;
}

/** Sora 上传任务状态 */
interface SoraUploadTask {
  itemId: string;
  itemName: string;
  platform: string;   // 平台名称，如 "贞贞工坊"
  status: "pending" | "uploading" | "success" | "error";
  progress: string;
  error?: string;
  result?: SoraCharacter;
}

/** 已上传到平台的角色状态 */
interface UploadedCharRecord {
  itemId: string;        // 角色库条目 ID
  platform: string;      // 上传平台
  soraId: string;        // Sora 角色 ID
  username: string;      // @username
  uploadedAt: number;
}

const UPLOADED_CHARS_KEY = "feicai-sora-uploaded-chars";
const VIDEO_MODELS_KEY = "feicai-video-models";
const SORA_UPLOAD_CONFIG_KEY = "feicai-sora-upload-config";

function loadUploadedChars(): UploadedCharRecord[] {
  try {
    const raw = localStorage.getItem(UPLOADED_CHARS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveUploadedChars(records: UploadedCharRecord[]) {
  localStorage.setItem(UPLOADED_CHARS_KEY, JSON.stringify(records));
}

/** 从设置页角色上传预设 / videoModels 中找到可用于 Sora 角色上传的 API 配置 */
function findSoraModelConfig(): { apiKey: string; baseUrl: string } | null {
  // ★ 优先：设置页独立的角色上传预设
  try {
    const preset = localStorage.getItem(SORA_UPLOAD_CONFIG_KEY);
    if (preset) {
      const cfg = JSON.parse(preset);
      if (cfg.apiKey) return { apiKey: cfg.apiKey, baseUrl: (cfg.baseUrl || "https://ai.t8star.cn").replace(/\/+$/, "") };
    }
  } catch { /* ignore */ }
  // 降级：从视频模型列表查找
  try {
    const raw = localStorage.getItem(VIDEO_MODELS_KEY);
    if (!raw) return null;
    const models = JSON.parse(raw);
    if (!Array.isArray(models)) return null;
    // 优先找 model 名含 sora 的
    const sora = models.find((m: { model?: string; name?: string; apiKey?: string }) => m.apiKey && isSoraModel(m.model || m.name || ""));
    if (sora) return { apiKey: sora.apiKey, baseUrl: (sora.url || "").replace(/\/+$/, "") };
    // 回退：任何贞贞工坊 URL 且有 apiKey 的模型（img2char 内部默认 sora-2）
    const zhenzhen = models.find((m: { url?: string; apiKey?: string }) => m.apiKey && (m.url || "").includes("t8star.cn"));
    if (zhenzhen) return { apiKey: zhenzhen.apiKey, baseUrl: (zhenzhen.url || "").replace(/\/+$/, "") };
    // 最后回退：任何有 apiKey 的模型
    const any = models.find((m: { apiKey?: string; url?: string }) => m.apiKey);
    if (any) return { apiKey: any.apiKey, baseUrl: (any.url || "").replace(/\/+$/, "") };
  } catch { /* ignore */ }
  return null;
}

const TABS: { key: TabKey; label: string; icon: typeof User }[] = [
  { key: "characters", label: "角色", icon: User },
  { key: "scenes", label: "场景", icon: Mountain },
  { key: "props", label: "道具", icon: Sword },
];

// ─── nano-id 替代 ───
function nanoId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ═══════════════════════════════════════════════════════════
// ★ 模块级内存缓存 — 页面切换后再回来瞬间渲染
// ═══════════════════════════════════════════════════════════
interface LibraryCache {
  consistency: ConsistencyProfile | null;
  projects: ArchivedProject[];
  diskImages: Record<string, Record<string, string>>;
  idbCache: Record<string, Record<string, string>>;
  /** 缓存时间戳 */
  ts: number;
}
let _libraryCache: LibraryCache | null = null;

/** 快速加载（Phase 1: IDB 数据 + 磁盘 URL check，不做 IDB 全表扫描） */
async function loadLibraryFast(): Promise<LibraryCache> {
  const [rawProfile, projects] = await Promise.all([
    loadConsistencyAsync(),
    loadProjects(),
  ]);

  // ★ 恢复当前工作台参考图（用 URL 引用模式，无需传输图片数据）
  const profile = await restoreConsistencyImagesFromDisk(rawProfile);

  // ★ 批量恢复归档项目的磁盘参考图 — 轻量 check API
  const archivedIds: string[] = [];
  const idToProjectMap: Record<string, string[]> = {};
  for (const proj of projects) {
    if (!proj.consistency) continue;
    for (const list of [proj.consistency.characters, proj.consistency.scenes, proj.consistency.props]) {
      for (const item of (list || []) as Array<{ id: string; referenceImage?: string }>) {
        if (item.id && (!item.referenceImage || item.referenceImage === "")) {
          if (!idToProjectMap[item.id]) {
            archivedIds.push(item.id);
            idToProjectMap[item.id] = [];
          }
          idToProjectMap[item.id].push(proj.id);
        }
      }
    }
  }

  const diskImages: Record<string, Record<string, string>> = {};
  if (archivedIds.length > 0) {
    try {
      const checkRes = await fetch(`/api/ref-image?keys=${encodeURIComponent(archivedIds.join(","))}&check=1`);
      if (checkRes.ok) {
        const { exists } = await checkRes.json();
        for (const itemId of archivedIds) {
          if (exists?.[itemId]) {
            const url = `/api/ref-image?serve=${itemId}`;
            for (const projId of idToProjectMap[itemId] || []) {
              if (!diskImages[projId]) diskImages[projId] = {};
              diskImages[projId][itemId] = url;
            }
          }
        }
      }
    } catch (e) {
      console.warn("[Library] 归档磁盘图片检查失败:", e);
    }
  }

  const cache: LibraryCache = {
    consistency: profile,
    projects,
    diskImages,
    idbCache: {},   // IDB 全表扫描推迟到用户手动同步
    ts: Date.now(),
  };
  _libraryCache = cache;
  return cache;
}

/** 深度加载（Phase 2: 额外 IDB 全表扫描归档图片，仅手动同步时调用） */
async function loadLibraryDeep(base: LibraryCache): Promise<LibraryCache> {
  const idbCache: Record<string, Record<string, string>> = {};
  try {
    const { loadGridImagesByFilterDB } = await import("../lib/imageDB");
    const archivePrefix = "archive:";
    const refInfix = ":ref:";
    const allArchiveImages = await loadGridImagesByFilterDB(
      (k: string) => k.startsWith(archivePrefix) && k.includes(refInfix)
    );
    for (const [k, v] of Object.entries(allArchiveImages)) {
      const afterPrefix = k.slice(archivePrefix.length);
      const refIdx = afterPrefix.indexOf(refInfix);
      if (refIdx === -1) continue;
      const projId = afterPrefix.slice(0, refIdx);
      const itemId = afterPrefix.slice(refIdx + refInfix.length);
      if (!idbCache[projId]) idbCache[projId] = {};
      idbCache[projId][itemId] = v;
    }
    console.log(`[Library] IDB 归档图片深度加载: ${Object.keys(allArchiveImages).length} 条`);
  } catch (e) {
    console.warn("[Library] IDB 归档图片加载失败:", e);
  }

  const updated: LibraryCache = {
    ...base,
    // ★ 重新加载最新数据（防止手动同步时数据过期）
    consistency: base.consistency,
    projects: base.projects,
    idbCache,
    ts: Date.now(),
  };
  _libraryCache = updated;
  return updated;
}

// ═══════════════════════════════════════════════════════════
// 主页面
// ═══════════════════════════════════════════════════════════

export default function LibraryPage() {
  // ── 标签页 ──
  const [activeTab, setActiveTab] = useState<TabKey>("characters");

  // ── 数据源 ──
  const [consistency, setConsistency] = useState<ConsistencyProfile | null>(null);
  const [archivedProjects, setArchivedProjects] = useState<ArchivedProject[]>([]);
  const [loading, setLoading] = useState(true);

  // ── 搜索 ──
  const [searchQuery, setSearchQuery] = useState("");

  // ── 来源筛选 ──
  const [sourceFilter, setSourceFilter] = useState<"all" | "current" | string>("current");
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);

  // ── 新增弹窗 ──
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", description: "", prompt: "" });
  const [addImageFile, setAddImageFile] = useState<string>(""); // data URL
  const addImageInputRef = useRef<HTMLInputElement>(null);

  // ── 编辑弹窗 ──
  const [editingItem, setEditingItem] = useState<DisplayItem | null>(null);
  const [editForm, setEditForm] = useState({ name: "", description: "", prompt: "" });
  const [editImageFile, setEditImageFile] = useState<string>("");
  const editImageInputRef = useRef<HTMLInputElement>(null);

  // ── Sora 角色上传 ──
  const [uploadedChars, setUploadedChars] = useState<UploadedCharRecord[]>(loadUploadedChars);
  const [soraUploadTasks, setSoraUploadTasks] = useState<SoraUploadTask[]>([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null); // 单独上传用

  // ── 多选模式 ──
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── 大图预览 ──
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);

  // ── 保存中 ──
  const [saving, setSaving] = useState(false);

  // ── 后台同步状态 ──
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(_libraryCache?.ts || 0);

  // ── 归档项目图片缓存 ──
  // archiveDiskImages: 磁盘 serve URL（初始化时一次性批量检查）
  const [archiveDiskImages, setArchiveDiskImages] = useState<Record<string, Record<string, string>>>(_libraryCache?.diskImages || {});
  // archiveImageCache: IDB 备份 data URL（惰性加载）
  const [archiveImageCache, setArchiveImageCache] = useState<Record<string, Record<string, string>>>(_libraryCache?.idbCache || {});
  const [loadingArchiveId, setLoadingArchiveId] = useState<string | null>(null);

  // ── 加载数据（缓存优先 + 后台静默刷新） ──
  useEffect(() => {
    let cancelled = false;

    // ★ Phase 0: 如果有缓存，立刻渲染（0ms 延迟）
    if (_libraryCache) {
      setConsistency(_libraryCache.consistency);
      setArchivedProjects(_libraryCache.projects);
      setArchiveDiskImages(_libraryCache.diskImages);
      setArchiveImageCache(_libraryCache.idbCache);
      setLastSyncTime(_libraryCache.ts);
      setLoading(false);

      // 后台静默刷新（不阻塞 UI）
      loadLibraryFast().then(cache => {
        if (!cancelled) {
          setConsistency(cache.consistency);
          setArchivedProjects(cache.projects);
          setArchiveDiskImages(cache.diskImages);
          setLastSyncTime(cache.ts);
          console.log("[Library] 后台静默刷新完成");
        }
      }).catch(err => console.warn("[Library] 后台刷新失败:", err));
      return () => { cancelled = true; };
    }

    // ★ Phase 1: 首次加载（无缓存）
    setLoading(true);
    loadLibraryFast().then(cache => {
      if (!cancelled) {
        setConsistency(cache.consistency);
        setArchivedProjects(cache.projects);
        setArchiveDiskImages(cache.diskImages);
        setArchiveImageCache(cache.idbCache);
        setLastSyncTime(cache.ts);
        setLoading(false);
        console.log("[Library] 首次加载完成");
      }
    }).catch(err => {
      console.error("[Library] 加载失败:", err);
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  // ── 手动同步（深度加载 = 快速加载 + IDB 全表扫描） ──
  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      // Phase 1: 快速刷新
      const fastCache = await loadLibraryFast();
      setConsistency(fastCache.consistency);
      setArchivedProjects(fastCache.projects);
      setArchiveDiskImages(fastCache.diskImages);

      // Phase 2: 深度 IDB 扫描
      const deepCache = await loadLibraryDeep(fastCache);
      setArchiveImageCache(deepCache.idbCache);
      setLastSyncTime(deepCache.ts);
      console.log("[Library] 手动同步完成（含深度 IDB 扫描）");
    } catch (err) {
      console.error("[Library] 同步失败:", err);
    } finally {
      setSyncing(false);
    }
  }, [syncing]);

  // ── 监听 Studio 一致性数据变更（通过 CustomEvent 桥接） ──
  useEffect(() => {
    const handler = () => {
      loadConsistencyAsync()
        .then((raw) => restoreConsistencyImagesFromDisk(raw))
        .then((profile) => {
          setConsistency(profile);
          // 同时更新模块缓存
          if (_libraryCache) _libraryCache.consistency = profile;
        })
        .catch(() => {});
    };
    // Studio 保存时可能触发的 storage 事件
    window.addEventListener("storage", handler);
    window.addEventListener("feicai-consistency-updated", handler);
    return () => {
      window.removeEventListener("storage", handler);
      window.removeEventListener("feicai-consistency-updated", handler);
    };
  }, []);

  // ── 持久化（保存到 KV + 触发 Studio 同步） ──
  const persistConsistency = useCallback(async (updated: ConsistencyProfile) => {
    setSaving(true);
    try {
      setConsistency(updated);
      await saveConsistency(updated);
      // 通知其他页面（如 Studio）数据已更新
      window.dispatchEvent(new CustomEvent("feicai-consistency-updated"));
    } catch (err) {
      console.error("[Library] 保存失败:", err);
    } finally {
      setSaving(false);
    }
  }, []);

  // ── 构建展示列表 ──
  const allItems = useMemo(() => {
    const items: DisplayItem[] = [];

    // 当前工作台
    if (consistency) {
      for (const c of consistency.characters) {
        items.push({ ...c, source: "current", sourceName: "当前工作台", type: "characters" });
      }
      for (const s of consistency.scenes) {
        items.push({ ...s, source: "current", sourceName: "当前工作台", type: "scenes" });
      }
      for (const p of consistency.props) {
        items.push({ ...p, source: "current", sourceName: "当前工作台", type: "props" });
      }
    }

    // 归档项目
    for (const proj of archivedProjects) {
      if (!proj.consistency) continue;
      const projName = proj.name || "未命名项目";
      for (const c of proj.consistency.characters || []) {
        // ★ 优先级：磁盘 serve URL → IDB data URL → 归档时残存的 referenceImage → 空
        const img = archiveDiskImages[proj.id]?.[c.id] || archiveImageCache[proj.id]?.[c.id] || c.referenceImage || "";
        items.push({ ...c, referenceImage: img, source: proj.id, sourceName: projName, type: "characters" });
      }
      for (const s of proj.consistency.scenes || []) {
        const img = archiveDiskImages[proj.id]?.[s.id] || archiveImageCache[proj.id]?.[s.id] || s.referenceImage || "";
        items.push({ ...s, referenceImage: img, source: proj.id, sourceName: projName, type: "scenes" });
      }
      for (const p of proj.consistency.props || []) {
        const img = archiveDiskImages[proj.id]?.[p.id] || archiveImageCache[proj.id]?.[p.id] || p.referenceImage || "";
        items.push({ ...p, referenceImage: img, source: proj.id, sourceName: projName, type: "props" });
      }
    }

    return items;
  }, [consistency, archivedProjects, archiveDiskImages, archiveImageCache]);

  // ── 惰性加载单个归档项目的 IDB 图片（仅在用户筛选到特定项目时触发） ──
  const loadArchiveImages = useCallback(async (projectId: string) => {
    if (archiveImageCache[projectId] || loadingArchiveId === projectId) return;
    setLoadingArchiveId(projectId);
    try {
      const { loadGridImagesByFilterDB } = await import("../lib/imageDB");
      const prefix = `archive:${projectId}:ref:`;
      const images = await loadGridImagesByFilterDB((k: string) => k.startsWith(prefix));
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(images)) {
        const itemKey = k.slice(prefix.length);
        mapped[itemKey] = v;
      }
      setArchiveImageCache((prev) => ({ ...prev, [projectId]: mapped }));
    } catch (err) {
      console.error("[Library] 加载归档图片失败:", err);
    } finally {
      setLoadingArchiveId(null);
    }
  }, [archiveImageCache, loadingArchiveId]);

  // 当切换到特定归档项目时，补充加载 IDB 图片（磁盘 + IDB 双重保障）
  useEffect(() => {
    if (sourceFilter !== "all" && sourceFilter !== "current") {
      loadArchiveImages(sourceFilter);
    }
  }, [sourceFilter, loadArchiveImages]);

  // ── 筛选 ──
  const filteredItems = useMemo(() => {
    let items = allItems.filter((i) => i.type === activeTab);

    // 来源筛选
    if (sourceFilter === "current") {
      items = items.filter((i) => i.source === "current");
    } else if (sourceFilter !== "all") {
      items = items.filter((i) => i.source === sourceFilter);
    }

    // 搜索
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      items = items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.description?.toLowerCase().includes(q) ||
          i.aliases?.some((a) => a.toLowerCase().includes(q))
      );
    }

    return items;
  }, [allItems, activeTab, sourceFilter, searchQuery]);

  // ── 统计 ──
  const stats = useMemo(() => {
    const current = { characters: 0, scenes: 0, props: 0 };
    const total = { characters: 0, scenes: 0, props: 0 };
    for (const item of allItems) {
      total[item.type]++;
      if (item.source === "current") current[item.type]++;
    }
    return { current, total };
  }, [allItems]);

  // ── 来源列表 ──
  const sourceOptions = useMemo(() => {
    const opts: { id: string; label: string; count: number }[] = [
      { id: "all", label: "全部来源", count: allItems.filter((i) => i.type === activeTab).length },
      { id: "current", label: "当前工作台", count: stats.current[activeTab] },
    ];
    for (const proj of archivedProjects) {
      if (!proj.consistency) continue;
      const list = proj.consistency[activeTab] || [];
      if (list.length > 0) {
        opts.push({ id: proj.id, label: proj.name || "未命名项目", count: list.length });
      }
    }
    return opts;
  }, [archivedProjects, allItems, activeTab, stats]);

  // ── 新增条目 ──
  const handleAdd = useCallback(async () => {
    if (!consistency || !addForm.name.trim()) return;
    const id = `${activeTab === "characters" ? "char" : activeTab === "scenes" ? "scene" : "prop"}-${nanoId()}`;

    // ★ 先保存图片到磁盘（在 persistConsistency 之前）
    let imgRef = "";
    if (addImageFile && addImageFile.startsWith("data:")) {
      try {
        console.log(`[Library:handleAdd] 上传参考图: key=${id}, dataUrl长度=${addImageFile.length}`);
        const postRes = await fetch("/api/ref-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: id, imageData: addImageFile }),
        });
        const postBody = await postRes.json().catch(() => null);
        if (!postRes.ok) {
          console.error(`[Library:handleAdd] 参考图上传失败: status=${postRes.status}`, postBody);
          imgRef = addImageFile; // 降级：使用 data URL
        } else {
          console.log(`[Library:handleAdd] 参考图上传成功:`, postBody);
          // ★ URL 引用 + 时间戳破缓存
          imgRef = `/api/ref-image?serve=${encodeURIComponent(id)}&_t=${Date.now()}`;
        }
      } catch (err) {
        console.error("[Library:handleAdd] 保存参考图失败(网络err):", err);
        imgRef = addImageFile; // 降级：使用 data URL
      }
    }

    const newItem = {
      id,
      name: addForm.name.trim(),
      description: addForm.description.trim(),
      prompt: addForm.prompt.trim(),
      referenceImage: imgRef,
      aliases: [],
    };

    const updated = { ...consistency };
    updated[activeTab] = [...updated[activeTab], newItem as CharacterRef & SceneRef & PropRef];
    await persistConsistency(updated);

    setShowAddModal(false);
    setAddForm({ name: "", description: "", prompt: "" });
    setAddImageFile("");
  }, [consistency, addForm, addImageFile, activeTab, persistConsistency]);

  // ── 删除条目（支持当前工作台 + 归档项目） ──
  const handleDelete = useCallback(async (item: DisplayItem) => {
    if (!confirm(`确定要删除「${item.name}」吗？\n\n此操作不可恢复。`)) return;

    // ★ 同时清理磁盘参考图文件
    try {
      await fetch(`/api/ref-image?key=${encodeURIComponent(item.id)}`, { method: "DELETE" });
    } catch { /* 忽略磁盘清理失败 */ }

    if (item.source === "current") {
      // 当前工作台条目
      if (!consistency) return;
      const updated = { ...consistency };
      updated[item.type] = updated[item.type].filter((i: { id: string }) => i.id !== item.id);
      await persistConsistency(updated);
    } else {
      // ★ 归档项目条目：从归档数据中移除
      try {
        const projects = await loadProjects();
        const proj = projects.find(p => p.id === item.source);
        if (proj?.consistency) {
          const listKey = item.type as keyof Pick<ConsistencyProfile, "characters" | "scenes" | "props">;
          proj.consistency[listKey] = (proj.consistency[listKey] || []).filter(
            (i: { id: string }) => i.id !== item.id
          ) as typeof proj.consistency[typeof listKey];
          await saveProjects(projects);
          // ★ 同步到磁盘
          persistProjectToDisk(proj).catch(() => {});
          // 刷新本地归档数据
          setArchivedProjects([...projects]);
        }
      } catch (err) {
        console.error("[Library] 删除归档条目失败:", err);
      }
    }
  }, [consistency, persistConsistency]);

  // ── 编辑条目（当前工作台 + 归档项目均可编辑） ──
  // ── 批量删除 ──
  const handleBatchDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(`确定要删除选中的 ${count} 个条目吗？\n\n此操作不可恢复。`)) return;
    const itemsToDelete = filteredItems.filter(i => selectedIds.has(`${i.source}-${i.id}`));
    // 按来源分组
    const currentItems = itemsToDelete.filter(i => i.source === "current");
    const archivedMap = new Map<string, DisplayItem[]>();
    for (const item of itemsToDelete) {
      if (item.source !== "current") {
        const list = archivedMap.get(item.source) || [];
        list.push(item);
        archivedMap.set(item.source, list);
      }
    }
    // 清理磁盘参考图
    for (const item of itemsToDelete) {
      try {
        await fetch(`/api/ref-image?key=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      } catch { /* 忽略 */ }
    }
    // 删除当前工作台条目
    if (currentItems.length > 0 && consistency) {
      const deleteIds = new Set(currentItems.map(i => i.id));
      const updated = { ...consistency };
      for (const listKey of ["characters", "scenes", "props"] as const) {
        updated[listKey] = updated[listKey].filter((i: { id: string }) => !deleteIds.has(i.id));
      }
      await persistConsistency(updated);
    }
    // 删除归档项目条目
    if (archivedMap.size > 0) {
      try {
        const projects = await loadProjects();
        for (const [projId, items] of archivedMap) {
          const proj = projects.find(p => p.id === projId);
          if (!proj?.consistency) continue;
          const deleteIds = new Set(items.map(i => i.id));
          for (const listKey of ["characters", "scenes", "props"] as const) {
            (proj.consistency as unknown as Record<string, { id: string }[]>)[listKey] = (proj.consistency[listKey] || []).filter(
              (i: { id: string }) => !deleteIds.has(i.id)
            );
          }
          persistProjectToDisk(proj).catch(() => {});
        }
        await saveProjects(projects);
        setArchivedProjects([...projects]);
      } catch (err) {
        console.error("[Library] 批量删除归档条目失败:", err);
      }
    }
    setSelectedIds(new Set());
    setMultiSelectMode(false);
  }, [selectedIds, filteredItems, consistency, persistConsistency]);

  // ── 编辑条目（当前工作台 + 归档项目均可编辑） ──
  const openEdit = useCallback((item: DisplayItem) => {
    setEditingItem(item);
    setEditForm({ name: item.name, description: item.description, prompt: item.prompt || "" });
    setEditImageFile(item.referenceImage || "");
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editingItem || !editForm.name.trim()) return;

    // ★ 先保存图片到磁盘
    let imgRef = editImageFile;
    if (editImageFile && editImageFile.startsWith("data:")) {
      try {
        console.log(`[Library:handleEditSave] 上传参考图: key=${editingItem.id}, dataUrl长度=${editImageFile.length}`);
        const postRes = await fetch("/api/ref-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: editingItem.id, imageData: editImageFile }),
        });
        const postBody = await postRes.json().catch(() => null);
        if (!postRes.ok) {
          console.error(`[Library:handleEditSave] 参考图上传失败: status=${postRes.status}`, postBody);
        } else {
          console.log(`[Library:handleEditSave] 参考图上传成功:`, postBody);
          imgRef = `/api/ref-image?serve=${encodeURIComponent(editingItem.id)}&_t=${Date.now()}`;
        }
      } catch (err) {
        console.error("[Library:handleEditSave] 保存参考图失败(网络err):", err);
      }
    } else {
      console.log(`[Library:handleEditSave] 无需上传图片: editImageFile=${editImageFile ? editImageFile.substring(0, 60) + '...' : '(empty)'}`);
    }

    if (editingItem.source === "current") {
      // ★ 当前工作台条目
      if (!consistency) return;
      const updated = { ...consistency };
      updated[editingItem.type] = updated[editingItem.type].map((i: CharacterRef & SceneRef & PropRef) => {
        if (i.id !== editingItem.id) return i;
        return { ...i, name: editForm.name.trim(), description: editForm.description.trim(), prompt: editForm.prompt.trim(), referenceImage: imgRef };
      });
      await persistConsistency(updated);
    } else {
      // ★ 归档项目条目：更新归档数据
      try {
        const projects = await loadProjects();
        const proj = projects.find(p => p.id === editingItem.source);
        if (proj?.consistency) {
          const listKey = editingItem.type as keyof Pick<ConsistencyProfile, "characters" | "scenes" | "props">;
          proj.consistency[listKey] = (proj.consistency[listKey] || []).map(
            (i: { id: string; name?: string; description?: string; prompt?: string; referenceImage?: string }) => {
              if (i.id !== editingItem.id) return i;
              return { ...i, name: editForm.name.trim(), description: editForm.description.trim(), prompt: editForm.prompt.trim(), referenceImage: imgRef };
            }
          ) as typeof proj.consistency[typeof listKey];
          await saveProjects(projects);
          // ★ 同步到磁盘
          persistProjectToDisk(proj).catch(() => {});
          // 刷新本地归档数据
          setArchivedProjects([...projects]);
          // 更新磁盘图片缓存（若上传了新图）
          if (imgRef && imgRef.startsWith("/api/ref-image?serve=")) {
            setArchiveDiskImages(prev => ({
              ...prev,
              [editingItem.source]: { ...(prev[editingItem.source] || {}), [editingItem.id]: imgRef }
            }));
          }
        }
      } catch (err) {
        console.error("[Library] 编辑归档条目失败:", err);
      }
    }

    setEditingItem(null);
  }, [editingItem, consistency, editForm, editImageFile, persistConsistency]);

  // ── 图片文件选择 ──
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>, target: "add" | "edit") => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert("图片不得超过 10MB"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (target === "add") setAddImageFile(dataUrl);
      else setEditImageFile(dataUrl);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  // ── Sora 单个上传 ──
  const handleSoraUploadOne = useCallback(async (item: DisplayItem) => {
    const soraConfig = findSoraModelConfig();
    if (!soraConfig) { alert("请先在设置页配置 Sora 系列模型（含 API Key）"); return; }
    if (!item.referenceImage || !isValidImageRef(item.referenceImage)) { alert("该条目没有参考图，无法上传"); return; }

    // 检查是否已上传
    const existing = uploadedChars.find(r => r.itemId === item.id && r.platform === "贞贞工坊");
    if (existing && !confirm(`「${item.name}」已上传到贞贞工坊（@${existing.username}），是否重新上传？`)) return;

    setUploadingItemId(item.id);
    try {
      // 获取图片 data URL（如果是 /api/ URL 需要先获取）
      let imageData = item.referenceImage;
      if (imageData.startsWith("/api/")) {
        const imgRes = await fetch(imageData);
        if (imgRes.ok) {
          const blob = await imgRes.blob();
          imageData = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        }
      }

      const res = await fetch("/api/zhenzhen/img2char", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: soraConfig.apiKey,
          baseUrl: soraConfig.baseUrl || undefined,
          imageData,
          category: item.type === "characters" ? "character" : item.type === "scenes" ? "scene" : "prop",
          nickname: item.name,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `上传失败 (${res.status})`);
      }
      const data = await res.json();
      const newChar: SoraCharacter = {
        id: data.id, username: data.username,
        profilePicture: data.profile_picture_url || "", permalink: data.permalink || "",
        createdAt: Date.now(), nickname: item.name,
        category: item.type === "characters" ? "character" : item.type === "scenes" ? "scene" : "prop",
      };
      // 持久化到 Sora 角色列表
      const soraChars: SoraCharacter[] = JSON.parse(localStorage.getItem("feicai-sora-characters") || "[]");
      const updated = [...soraChars.filter(c => c.id !== newChar.id), newChar];
      localStorage.setItem("feicai-sora-characters", JSON.stringify(updated));
      // 记录上传状态
      const record: UploadedCharRecord = {
        itemId: item.id, platform: "贞贞工坊", soraId: data.id,
        username: data.username, uploadedAt: Date.now(),
      };
      setUploadedChars(prev => {
        const next = [...prev.filter(r => !(r.itemId === item.id && r.platform === "贞贞工坊")), record];
        saveUploadedChars(next);
        return next;
      });
      alert(`✅ 「${item.name}」已成功上传到贞贞工坊-Sora\n角色 @${data.username} 已创建！`);
    } catch (e) {
      alert(`❌ 上传失败: ${e instanceof Error ? e.message : "网络错误"}`);
    } finally {
      setUploadingItemId(null);
    }
  }, [uploadedChars]);

  // ── Sora 批量上传 ──
  const handleSoraBatchUpload = useCallback(async () => {
    const soraConfig = findSoraModelConfig();
    if (!soraConfig) { alert("请先在设置页配置 Sora 系列模型（含 API Key）"); return; }

    // 当前标签页下有参考图的条目
    const uploadable = filteredItems.filter(i => i.source === "current" && i.referenceImage && isValidImageRef(i.referenceImage));
    if (uploadable.length === 0) { alert("当前没有可上传的条目（需要有参考图的当前工作台条目）"); return; }

    // 过滤已上传
    const notUploaded = uploadable.filter(i => !uploadedChars.some(r => r.itemId === i.id && r.platform === "贞贞工坊"));
    if (notUploaded.length === 0) {
      if (!confirm(`所有 ${uploadable.length} 个条目都已上传到贞贞工坊。要全部重新上传吗？`)) return;
    }
    const toUpload = notUploaded.length > 0 ? notUploaded : uploadable;

    const label = TABS.find((t) => t.key === activeTab)?.label || "条目";
    if (!confirm(`将${toUpload.length}个${label}上传到贞贞工坊-Sora\n\n每个条目需要先生成5秒视频再提取角色，会消耗积分，且需要较长时间。\n\n确定继续？`)) return;

    // 初始化任务列表
    const tasks: SoraUploadTask[] = toUpload.map(item => ({
      itemId: item.id, itemName: item.name, platform: "贞贞工坊",
      status: "pending" as const, progress: "等待中",
    }));
    setSoraUploadTasks(tasks);
    setShowUploadModal(true);

    // 逐个上传（避免并发过多）
    for (let i = 0; i < toUpload.length; i++) {
      const item = toUpload[i];
      setSoraUploadTasks(prev => prev.map((t, idx) =>
        idx === i ? { ...t, status: "uploading", progress: "上传参考图..." } : t
      ));
      try {
        let imageData = item.referenceImage!;
        if (imageData.startsWith("/api/")) {
          const imgRes = await fetch(imageData);
          if (imgRes.ok) {
            const blob = await imgRes.blob();
            imageData = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
          }
        }

        setSoraUploadTasks(prev => prev.map((t, idx) =>
          idx === i ? { ...t, progress: "生成视频中（约1-5分钟）..." } : t
        ));

        const res = await fetch("/api/zhenzhen/img2char", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: soraConfig.apiKey, baseUrl: soraConfig.baseUrl || undefined,
            imageData, category: item.type === "characters" ? "character" : item.type === "scenes" ? "scene" : "prop",
            nickname: item.name,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `上传失败 (${res.status})`);
        }
        const data = await res.json();
        const newChar: SoraCharacter = {
          id: data.id, username: data.username,
          profilePicture: data.profile_picture_url || "", permalink: data.permalink || "",
          createdAt: Date.now(), nickname: item.name,
          category: item.type === "characters" ? "character" : item.type === "scenes" ? "scene" : "prop",
        };
        // 持久化
        const soraChars: SoraCharacter[] = JSON.parse(localStorage.getItem("feicai-sora-characters") || "[]");
        localStorage.setItem("feicai-sora-characters", JSON.stringify([...soraChars.filter(c => c.id !== newChar.id), newChar]));
        const record: UploadedCharRecord = {
          itemId: item.id, platform: "贞贞工坊", soraId: data.id,
          username: data.username, uploadedAt: Date.now(),
        };
        setUploadedChars(prev => {
          const next = [...prev.filter(r => !(r.itemId === item.id && r.platform === "贞贞工坊")), record];
          saveUploadedChars(next);
          return next;
        });
        setSoraUploadTasks(prev => prev.map((t, idx) =>
          idx === i ? { ...t, status: "success", progress: `✅ @${data.username}`, result: newChar } : t
        ));
      } catch (e) {
        setSoraUploadTasks(prev => prev.map((t, idx) =>
          idx === i ? { ...t, status: "error", progress: "失败", error: e instanceof Error ? e.message : "未知错误" } : t
        ));
      }
    }
  }, [filteredItems, uploadedChars]);

  // ── 获取条目的上传状态标签 ──
  const getUploadBadge = useCallback((itemId: string): UploadedCharRecord | undefined => {
    return uploadedChars.find(r => r.itemId === itemId);
  }, [uploadedChars]);

  // ── 渲染 ──
  const tabLabel = TABS.find((t) => t.key === activeTab)?.label || "";
  const currentSourceLabel = sourceOptions.find((o) => o.id === sourceFilter)?.label || "全部来源";

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* ── 顶部标题栏 ── */}
        <header className="flex items-center justify-between px-8 py-5 border-b border-[var(--border-default)] shrink-0">
          <div className="flex items-center gap-3">
            <Package size={20} className="text-[var(--gold-primary)]" />
            <h1 className="text-[18px] font-semibold text-[var(--text-primary)]">角色库</h1>
            <span className="text-[12px] text-[var(--text-muted)] ml-2">
              管理所有项目的角色、场景、道具
            </span>
          </div>
          <div className="flex items-center gap-3">
            {saving && (
              <span className="flex items-center gap-1.5 text-[11px] text-[var(--gold-primary)]">
                <Loader size={12} className="animate-spin" /> 保存中...
              </span>
            )}
            {/* 同步按钮 */}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] transition-all
                border border-[var(--border-default)] hover:border-[var(--gold-primary)]
                text-[var(--text-muted)] hover:text-[var(--gold-primary)]
                disabled:opacity-50 disabled:cursor-not-allowed"
              title="同步刷新角色库数据（含深度 IDB 扫描）"
            >
              <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
              {syncing ? "同步中..." : "同步"}
            </button>
            {lastSyncTime > 0 && !syncing && (
              <span className="text-[10px] text-[var(--text-muted)] opacity-60">
                {Math.floor((Date.now() - lastSyncTime) / 1000) < 60
                  ? "刚刚同步"
                  : `${Math.floor((Date.now() - lastSyncTime) / 60000)}分钟前`}
              </span>
            )}
            {/* 统计 */}
            <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
              <span>角色 <span className="text-[var(--text-secondary)]">{stats.current.characters}</span><span className="text-[var(--text-muted)]">/{stats.total.characters}</span></span>
              <span>场景 <span className="text-[var(--text-secondary)]">{stats.current.scenes}</span><span className="text-[var(--text-muted)]">/{stats.total.scenes}</span></span>
              <span>道具 <span className="text-[var(--text-secondary)]">{stats.current.props}</span><span className="text-[var(--text-muted)]">/{stats.total.props}</span></span>
            </div>
          </div>
        </header>

        {/* ── 工具栏 ── */}
        <div className="flex items-center gap-3 px-8 py-3 border-b border-[var(--border-default)] shrink-0">
          {/* 标签页 */}
          <div className="flex gap-1">
            {TABS.map(({ key, label, icon: Icon }) => {
              const count = filteredItems.filter((i) => i.type === key).length || allItems.filter((i) => i.type === key && (sourceFilter === "all" || i.source === sourceFilter || (sourceFilter === "current" && i.source === "current"))).length;
              return (
                <button
                  key={key}
                  onClick={() => { setActiveTab(key); setSelectedIds(new Set()); }}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded text-[12px] font-medium transition cursor-pointer ${
                    activeTab === key
                      ? "bg-[var(--gold-primary)]/15 text-[var(--gold-primary)] border border-[var(--gold-primary)]/30"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-transparent hover:border-[var(--border-default)]"
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              );
            })}
          </div>

          <div className="w-px h-6 bg-[var(--border-default)]" />

          {/* 来源筛选 */}
          <div className="relative">
            <button
              onClick={() => setSourceDropdownOpen(!sourceDropdownOpen)}
              className="flex items-center gap-1.5 px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] transition cursor-pointer min-w-[140px]"
            >
              <span className="truncate">{currentSourceLabel}</span>
              <ChevronDown size={12} className={`text-[var(--text-muted)] transition-transform ml-auto ${sourceDropdownOpen ? "rotate-180" : ""}`} />
            </button>
            {sourceDropdownOpen && (
              <div className="absolute z-20 top-full left-0 mt-1 min-w-[200px] max-h-60 overflow-auto bg-[#1A1A1A] border border-[var(--border-default)] rounded shadow-lg">
                {sourceOptions.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => { setSourceFilter(opt.id); setSourceDropdownOpen(false); setSelectedIds(new Set()); }}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-[12px] text-left hover:bg-[var(--bg-surface)] transition cursor-pointer ${
                      sourceFilter === opt.id ? "text-[var(--gold-primary)] bg-[var(--gold-primary)]/5" : "text-[var(--text-secondary)]"
                    }`}
                  >
                    <span className="flex-1 truncate">{opt.label}</span>
                    <span className="text-[10px] text-[var(--text-muted)] shrink-0">{opt.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1" />

          {/* 多选按钮 */}
          {multiSelectMode ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--text-muted)]">
                已选 <span className="text-[var(--gold-primary)] font-medium">{selectedIds.size}</span> 项
              </span>
              <button
                onClick={() => {
                  // 全选/取消全选
                  if (selectedIds.size === filteredItems.length) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(filteredItems.map(i => `${i.source}-${i.id}`)));
                  }
                }}
                className="px-3 py-1.5 text-[11px] text-[var(--text-secondary)] border border-[var(--border-default)] rounded hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer"
              >
                {selectedIds.size === filteredItems.length ? "取消全选" : "全选"}
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] bg-red-500/80 text-white rounded hover:bg-red-500 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Trash2 size={11} />
                删除({selectedIds.size})
              </button>
              <button
                onClick={() => { setMultiSelectMode(false); setSelectedIds(new Set()); }}
                className="px-3 py-1.5 text-[11px] text-[var(--text-muted)] border border-[var(--border-default)] rounded hover:bg-[var(--bg-surface)] transition cursor-pointer"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setMultiSelectMode(true); setSelectedIds(new Set()); }}
              className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-[var(--text-secondary)] border border-[var(--border-default)] rounded hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer"
              title="多选模式"
            >
              <CheckSquare size={13} />
              多选
            </button>
          )}

          {/* 搜索 */}
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索名称..."
              className="pl-8 pr-3 py-2 w-48 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
            />
          </div>

          {/* 新增按钮 */}
          <button
            onClick={() => { setShowAddModal(true); setAddForm({ name: "", description: "", prompt: "" }); setAddImageFile(""); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-[var(--gold-primary)] text-[12px] font-medium text-[#0A0A0A] rounded hover:brightness-110 transition cursor-pointer"
          >
            <Plus size={14} />
            新增{tabLabel}
          </button>

          {/* 一键上传到贞贞工坊-Sora */}
          <button
            onClick={handleSoraBatchUpload}
            className="flex items-center gap-1.5 px-4 py-2 bg-purple-600/80 text-[12px] font-medium text-white rounded hover:bg-purple-600 transition cursor-pointer"
            title="将当前工作台有参考图的角色/场景/道具批量上传到贞贞工坊 Sora 平台"
          >
            <ExternalLink size={13} />
            一键上传 Sora
          </button>
        </div>

        {/* ── 内容区 ── */}
        <div className="flex-1 overflow-auto p-8">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-[var(--text-muted)]">
              <Loader size={24} className="animate-spin" />
              <span className="text-[13px]">加载中...</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-[var(--text-muted)]">
              {(() => { const Icon = TABS.find((t) => t.key === activeTab)?.icon || User; return <Icon size={32} />; })()}
              <span className="text-[13px]">
                {searchQuery ? `未找到匹配的${tabLabel}` : `暂无${tabLabel}数据`}
              </span>
              {!searchQuery && sourceFilter === "current" && (
                <span className="text-[11px]">可在生图工作台通过 AI 提取添加，或点击上方「新增{tabLabel}」手动添加</span>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {filteredItems.map((item) => {
                const isCurrent = item.source === "current";
                const itemKey = `${item.source}-${item.id}`;
                const isSelected = selectedIds.has(itemKey);
                return (
                  <div
                    key={itemKey}
                    onClick={multiSelectMode ? () => {
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        if (next.has(itemKey)) next.delete(itemKey); else next.add(itemKey);
                        return next;
                      });
                    } : undefined}
                    className={`flex flex-col rounded-lg overflow-hidden border bg-[#171717] transition group ${
                      multiSelectMode ? "cursor-pointer" : ""
                    } ${
                      isSelected
                        ? "border-[var(--gold-primary)] ring-1 ring-[var(--gold-primary)]"
                        : "border-[var(--border-default)] hover:border-[var(--text-muted)]"
                    }`}
                  >
                    {/* 图片 */}
                    <div className="relative w-full aspect-square bg-[#111]">
                      {/* 多选复选框 */}
                      {multiSelectMode && (
                        <div className={`absolute top-2 left-2 z-10 flex items-center justify-center w-6 h-6 rounded border-2 transition ${
                          isSelected
                            ? "bg-[var(--gold-primary)] border-[var(--gold-primary)] text-[#0A0A0A]"
                            : "bg-black/40 border-white/40 text-transparent"
                        }`}>
                          {isSelected && (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                      )}
                      {item.referenceImage ? (
                        <img
                          src={item.referenceImage}
                          alt={item.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            // ★ 图片加载失败时隐藏 <img>，显示占位符
                            const img = e.currentTarget;
                            img.style.display = "none";
                            const placeholder = img.nextElementSibling as HTMLElement | null;
                            if (placeholder) placeholder.style.display = "flex";
                          }}
                        />
                      ) : null}
                      <div
                        className="items-center justify-center w-full h-full text-[var(--text-muted)]"
                        style={{ display: item.referenceImage ? "none" : "flex" }}
                      >
                        {(() => { const Icon = TABS.find((t) => t.key === activeTab)?.icon || User; return <Icon size={28} />; })()}
                      </div>

                      {/* 操作按钮：多选模式下隐藏 */}
                      {!multiSelectMode && (
                      <div className="absolute top-2 right-2 flex gap-1">
                        {/* 上传到 Sora */}
                        {isCurrent && item.referenceImage && isValidImageRef(item.referenceImage) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSoraUploadOne(item); }}
                            disabled={uploadingItemId === item.id}
                            className={`flex items-center justify-center w-7 h-7 rounded-full transition cursor-pointer ${
                              getUploadBadge(item.id)
                                ? "bg-purple-600/80 text-white hover:bg-purple-600"
                                : "bg-black/60 text-purple-300 hover:bg-purple-600 hover:text-white"
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                            title={getUploadBadge(item.id) ? `已上传到${getUploadBadge(item.id)!.platform}（@${getUploadBadge(item.id)!.username}）点击重新上传` : "上传到贞贞工坊-Sora"}
                          >
                            {uploadingItemId === item.id ? <Loader size={12} className="animate-spin" /> : <ExternalLink size={11} />}
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(item)}
                          className="flex items-center justify-center w-7 h-7 rounded-full bg-black/60 text-white/70 hover:bg-[var(--gold-primary)] hover:text-black transition cursor-pointer"
                          title="编辑"
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(item); }}
                          className="flex items-center justify-center w-7 h-7 rounded-full bg-black/60 text-red-400 hover:bg-red-500 hover:text-white transition cursor-pointer"
                          title="删除"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      )}

                      {/* 大图预览 */}
                      {item.referenceImage && (
                        <button
                          onClick={() => setPreviewImage({ url: item.referenceImage!, name: item.name })}
                          className="absolute bottom-2 right-2 flex items-center justify-center w-7 h-7 rounded-full bg-black/50 text-white/60 opacity-0 group-hover:opacity-100 hover:bg-black/80 hover:text-white transition cursor-pointer"
                          title="放大查看"
                        >
                          <ZoomIn size={12} />
                        </button>
                      )}

                      {/* 来源标签：多选模式时右移避让复选框 */}
                      {!multiSelectMode && (
                      <div className={`absolute top-2 left-2 px-2 py-0.5 rounded text-[9px] font-medium ${
                        isCurrent
                          ? "bg-[var(--gold-primary)]/20 text-[var(--gold-primary)]"
                          : "bg-blue-500/20 text-blue-400"
                      }`}>
                        {isCurrent ? "当前" : "归档"}
                      </div>
                      )}
                    </div>

                    {/* 信息 */}
                    <div className="px-3 py-2.5 flex flex-col gap-1">
                      <p className="text-[12px] font-medium text-[var(--text-primary)] truncate">{item.name}</p>
                      {item.description && (
                        <p className="text-[10px] text-[var(--text-muted)] line-clamp-2 leading-relaxed">{item.description}</p>
                      )}
                      {!isCurrent && (
                        <p className="text-[9px] text-[var(--text-muted)] truncate mt-0.5">
                          来源: {item.sourceName}
                        </p>
                      )}
                      {/* 平台上传状态标签 */}
                      {(() => {
                        const badge = getUploadBadge(item.id);
                        if (!badge) return null;
                        return (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Check size={9} className="text-purple-400" />
                            <span className="text-[9px] text-purple-400 truncate" title={`@${badge.username} · ${new Date(badge.uploadedAt).toLocaleString()}`}>
                              {badge.platform} · @{badge.username}
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* ── 新增弹窗 ── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={(e) => { if (e.target === e.currentTarget) setShowAddModal(false); }}>
          <div className="flex flex-col gap-4 w-[480px] bg-[#161616] border border-[var(--border-default)] rounded-xl p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-semibold text-[var(--text-primary)]">新增{tabLabel}</span>
              <button onClick={() => setShowAddModal(false)} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"><X size={16} /></button>
            </div>

            {/* 名称 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">名称 *</label>
              <input
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
                placeholder={`输入${tabLabel}名称...`}
                autoFocus
              />
            </div>

            {/* 描述 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">描述</label>
              <textarea
                value={addForm.description}
                onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition resize-none"
                rows={3}
                placeholder={`描述${tabLabel}特征...`}
              />
            </div>

            {/* 英文提示词 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">英文提示词 (可选)</label>
              <textarea
                value={addForm.prompt}
                onChange={(e) => setAddForm((f) => ({ ...f, prompt: e.target.value }))}
                className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition resize-none font-mono"
                rows={2}
                placeholder="English prompt for image generation..."
              />
            </div>

            {/* 参考图上传 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">参考图 (可选)</label>
              {addImageFile ? (
                <div className="relative w-32 h-32 rounded-lg overflow-hidden border border-[var(--border-default)] group/img">
                  <img
                    src={addImageFile}
                    alt="preview"
                    className="w-full h-full object-cover"
                    onError={() => { console.warn("[Library:AddDialog] 图片预览加载失败"); setAddImageFile(""); }}
                  />
                  <div
                    onClick={() => addImageInputRef.current?.click()}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 opacity-0 group-hover/img:opacity-100 transition cursor-pointer"
                  >
                    <Upload size={16} className="text-white/90" />
                    <span className="text-[10px] text-white/80">点击替换图片</span>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); setAddImageFile(""); }} className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-full bg-black/70 text-white hover:bg-red-500 transition cursor-pointer opacity-0 group-hover/img:opacity-100">
                    <X size={10} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => addImageInputRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-3 border border-dashed border-[var(--border-default)] rounded text-[11px] text-[var(--text-muted)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer"
                >
                  <Upload size={14} />
                  点击上传参考图
                </button>
              )}
              <input ref={addImageInputRef} type="file" accept="image/*" onChange={(e) => handleImageUpload(e, "add")} className="hidden" />
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-3 pt-2">
              <button onClick={() => setShowAddModal(false)}
                className="flex-1 py-2.5 border border-[var(--border-default)] rounded text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer">
                取消
              </button>
              <button onClick={handleAdd} disabled={!addForm.name.trim() || saving}
                className="flex items-center gap-1.5 flex-1 justify-center py-2.5 bg-[var(--gold-primary)] rounded text-[13px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                <Save size={14} />
                {saving ? "保存中..." : "添加"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 编辑弹窗 ── */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={(e) => { if (e.target === e.currentTarget) setEditingItem(null); }}>
          <div className="flex flex-col gap-4 w-[480px] bg-[#161616] border border-[var(--border-default)] rounded-xl p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-semibold text-[var(--text-primary)]">编辑{tabLabel}</span>
              <button onClick={() => setEditingItem(null)} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"><X size={16} /></button>
            </div>

            {/* 名称 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">名称 *</label>
              <input
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
                autoFocus
              />
            </div>

            {/* 描述 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">描述</label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition resize-none"
                rows={3}
              />
            </div>

            {/* 英文提示词 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">英文提示词</label>
              <textarea
                value={editForm.prompt}
                onChange={(e) => setEditForm((f) => ({ ...f, prompt: e.target.value }))}
                className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition resize-none font-mono"
                rows={2}
              />
            </div>

            {/* 参考图 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">参考图</label>
              {editImageFile ? (
                <div className="relative w-32 h-32 rounded-lg overflow-hidden border border-[var(--border-default)] group/img">
                  <img
                    src={editImageFile}
                    alt="preview"
                    className="w-full h-full object-cover"
                    onError={() => {
                      console.warn(`[Library:EditDialog] 图片预览加载失败: ${editImageFile.substring(0, 80)}`);
                      setEditImageFile("");
                    }}
                  />
                  {/* ★ hover 覆盖层：点击整个图片区域重新上传（仿生图工作台） */}
                  <div
                    onClick={() => editImageInputRef.current?.click()}
                    className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 opacity-0 group-hover/img:opacity-100 transition cursor-pointer"
                  >
                    <Upload size={16} className="text-white/90" />
                    <span className="text-[10px] text-white/80">点击替换图片</span>
                  </div>
                  {/* 右上角清除按钮 */}
                  <button onClick={(e) => { e.stopPropagation(); setEditImageFile(""); }} className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center rounded-full bg-black/70 text-white hover:bg-red-500 transition cursor-pointer opacity-0 group-hover/img:opacity-100">
                    <X size={10} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => editImageInputRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-3 border border-dashed border-[var(--border-default)] rounded text-[11px] text-[var(--text-muted)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer"
                >
                  <Upload size={14} />
                  点击上传参考图
                </button>
              )}
              <input ref={editImageInputRef} type="file" accept="image/*" onChange={(e) => handleImageUpload(e, "edit")} className="hidden" />
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-3 pt-2">
              <button onClick={() => setEditingItem(null)}
                className="flex-1 py-2.5 border border-[var(--border-default)] rounded text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer">
                取消
              </button>
              <button onClick={handleEditSave} disabled={!editForm.name.trim() || saving}
                className="flex items-center gap-1.5 flex-1 justify-center py-2.5 bg-[var(--gold-primary)] rounded text-[13px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                <Save size={14} />
                {saving ? "保存中..." : "保存修改"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 大图预览 ── */}
      {previewImage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 cursor-pointer" onClick={() => setPreviewImage(null)}>
          <div className="relative max-w-[85vw] max-h-[85vh] flex flex-col items-center">
            <img
              src={previewImage.url}
              alt={previewImage.name}
              className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <p className="mt-3 text-[13px] text-white/80 font-medium">{previewImage.name}</p>
            <button onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 flex items-center justify-center w-8 h-8 rounded-full bg-black/60 text-white hover:bg-black/90 transition cursor-pointer">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── Sora 批量上传进度弹窗 ── */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={(e) => { if (e.target === e.currentTarget && soraUploadTasks.every(t => t.status !== "uploading")) setShowUploadModal(false); }}>
          <div className="flex flex-col gap-4 w-[520px] max-h-[70vh] bg-[#161616] border border-[var(--border-default)] rounded-xl p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ExternalLink size={16} className="text-purple-400" />
                <span className="text-[15px] font-semibold text-[var(--text-primary)]">上传到贞贞工坊-Sora</span>
              </div>
              {soraUploadTasks.every(t => t.status !== "uploading" && t.status !== "pending") && (
                <button onClick={() => setShowUploadModal(false)} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"><X size={16} /></button>
              )}
            </div>

            {/* 进度统计 */}
            <div className="flex items-center gap-4 text-[11px]">
              <span className="text-green-400">✅ 成功 {soraUploadTasks.filter(t => t.status === "success").length}</span>
              <span className="text-red-400">❌ 失败 {soraUploadTasks.filter(t => t.status === "error").length}</span>
              <span className="text-[var(--text-muted)]">⏳ 待处理 {soraUploadTasks.filter(t => t.status === "pending" || t.status === "uploading").length}</span>
            </div>

            {/* 任务列表 */}
            <div className="flex flex-col gap-2 overflow-auto max-h-[50vh] pr-1">
              {soraUploadTasks.map((task) => (
                <div key={task.itemId} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${
                  task.status === "success" ? "border-green-500/30 bg-green-500/5" :
                  task.status === "error" ? "border-red-500/30 bg-red-500/5" :
                  task.status === "uploading" ? "border-purple-500/30 bg-purple-500/5" :
                  "border-[var(--border-default)] bg-[#111]"
                }`}>
                  {/* 状态图标 */}
                  <div className="shrink-0">
                    {task.status === "uploading" && <Loader size={14} className="text-purple-400 animate-spin" />}
                    {task.status === "success" && <Check size={14} className="text-green-400" />}
                    {task.status === "error" && <AlertCircle size={14} className="text-red-400" />}
                    {task.status === "pending" && <div className="w-3.5 h-3.5 rounded-full border-2 border-[var(--text-muted)]" />}
                  </div>
                  {/* 信息 */}
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-medium text-[var(--text-primary)] truncate">{task.itemName}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 shrink-0">{task.platform}</span>
                    </div>
                    <span className={`text-[10px] truncate ${
                      task.status === "error" ? "text-red-400" : "text-[var(--text-muted)]"
                    }`}>{task.error || task.progress}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* 底部按钮 */}
            {soraUploadTasks.every(t => t.status !== "uploading" && t.status !== "pending") && (
              <button onClick={() => setShowUploadModal(false)}
                className="w-full py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-secondary)] rounded hover:text-[var(--text-primary)] transition cursor-pointer">
                关闭
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
