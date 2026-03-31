/**
 * 参考图角色库弹窗
 *
 * 功能：
 * - 从归档项目中浏览角色/场景/道具参考图
 * - 多选 + 一键导入到当前一致性面板
 *
 * Phase 1：只读扫描，不改变存储格式
 */
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  X, Package, User, Mountain, Sword, Check, Loader, ChevronDown, Search, Star, ZoomIn, Sparkles, RefreshCw,
} from "lucide-react";
import type { ConsistencyProfile } from "../lib/consistency";
import { loadProjects, type ArchivedProject } from "../lib/projects";
import { loadGridImagesByFilterDB } from "../lib/imageDB";
import { kvGet, kvSet } from "../lib/kvDB";

// ─── 类型定义 ───

export type LibraryItemType = "character" | "scene" | "prop" | "style";

export interface LibraryItem {
  /** 唯一标识（ref-image key） */
  key: string;
  type: LibraryItemType;
  /** 显示名称 */
  name: string;
  /** 中文描述 */
  description?: string;
  /** 英文提示词 */
  prompt?: string;
  /** 图片 URL（磁盘项 = /api/ref-image?key=xxx）或 data URL（归档项） */
  imageUrl?: string;
  /** 别名列表（用于智能匹配） */
  aliases?: string[];
}

export interface ImportItem {
  type: "character" | "scene" | "prop";
  name: string;
  description: string;
  prompt?: string;
  /** data URL，可直接放入 ConsistencyItem.referenceImage */
  imageDataUrl: string;
  /** 来源的 ref-image key（用于磁盘项避免重复写入） */
  sourceKey: string;
  /** 是否来自归档（需要物化到磁盘） */
  fromArchive: boolean;
}

interface ProjectSource {
  id: string;
  name: string;
  /** 来源类型 */
  source: "disk" | "archive" | "current";
  /** 该项目包含的参考图列表（惰性加载） */
  items: LibraryItem[];
  loaded: boolean;
}

/** 将当前工作台一致性数据转化为 ProjectSource（始终位于下拉列表顶部） */
function buildCurrentSource(consistency: ConsistencyProfile): ProjectSource {
  const items: LibraryItem[] = [];
  for (const c of consistency.characters || []) {
    items.push({
      key: c.id, type: "character", name: c.name || "未命名角色",
      description: c.description, prompt: c.prompt, aliases: c.aliases,
      imageUrl: (c.referenceImage && c.referenceImage.length > 10) ? c.referenceImage : undefined,
    });
  }
  for (const s of consistency.scenes || []) {
    items.push({
      key: s.id, type: "scene", name: s.name || "未命名场景",
      description: s.description, prompt: s.prompt, aliases: s.aliases,
      imageUrl: (s.referenceImage && s.referenceImage.length > 10) ? s.referenceImage : undefined,
    });
  }
  for (const p of consistency.props || []) {
    items.push({
      key: p.id, type: "prop", name: p.name || "未命名道具",
      description: p.description, prompt: p.prompt, aliases: p.aliases,
      imageUrl: (p.referenceImage && p.referenceImage.length > 10) ? p.referenceImage : undefined,
    });
  }
  return {
    id: "__current__",
    name: "★ 当前工作台",
    source: "current",
    items,
    loaded: true, // 图片已在 consistency 中
  };
}

interface CharacterLibraryProps {
  open: boolean;
  onClose: () => void;
  onImport: (items: ImportItem[]) => void;
  /** 当前一致性数据，用于名称匹配和去重 */
  currentConsistency: ConsistencyProfile;
}

// ─── 收藏持久化 ───

const FAVORITES_KEY = "feicai-library-favorites";

export interface FavoriteItem {
  /** 复合唯一键：projectId:itemKey */
  uid: string;
  type: "character" | "scene" | "prop";
  name: string;
  description?: string;
  prompt?: string;
  /** 图片 data URL（收藏时快照保存，保证离线可用） */
  imageDataUrl: string;
  /** 来源项目名 */
  sourceProject: string;
  /** 来源项目 ID */
  sourceProjectId: string;
  /** 原始 item key */
  originalKey: string;
  /** 收藏时间 */
  addedAt: number;
}

async function loadFavorites(): Promise<FavoriteItem[]> {
  try {
    const raw = await kvGet(FAVORITES_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

async function saveFavorites(items: FavoriteItem[]): Promise<void> {
  try {
    await kvSet(FAVORITES_KEY, JSON.stringify(items));
  } catch (e) {
    console.warn("[Favorites] 保存失败:", e);
  }
}

// ─── 从 consistency 匹配名称 ───

/** 模糊名称匹配（精确 + 「·」形态后缀拆分 + 包含） */
function namesMatch(a: string, b: string): boolean {
  const na = a.trim().toLowerCase();
  const nb = b.trim().toLowerCase();
  if (!na || !nb) return false;
  if (na === nb) return true;

  // 「·」形态后缀拆分："林骁·觉醒态" → 基础名 "林骁"
  const baseA = na.split("·")[0].trim();
  const baseB = nb.split("·")[0].trim();
  if (baseA.length >= 2 && baseB.length >= 2 && baseA === baseB) return true;

  // 包含匹配（至少2字符，且短串占长串30%以上）
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (shorter.length < 2) return false;
  return longer.includes(shorter) && shorter.length >= longer.length * 0.3;
}

function enrichWithConsistency(
  items: LibraryItem[],
  consistency: ConsistencyProfile | null,
): LibraryItem[] {
  if (!consistency) return items;
  const allItems = [
    ...consistency.characters.map((c) => ({ ...c, _type: "character" as const })),
    ...consistency.scenes.map((s) => ({ ...s, _type: "scene" as const })),
    ...consistency.props.map((p) => ({ ...p, _type: "prop" as const })),
  ];
  return items.map((item) => {
    const match = allItems.find((ci) => ci.id === item.key);
    if (match) {
      return {
        ...item,
        name: match.name || item.name,
        description: match.description || item.description,
        prompt: match.prompt || item.prompt,
      };
    }
    return item;
  });
}

// ─── 从 key 推断类型（双格式兼容） ───

function inferType(key: string): LibraryItemType {
  if (key.startsWith("char-") || key.startsWith("角色-")) return "character";
  if (key.startsWith("scene-") || key.startsWith("场景-")) return "scene";
  if (key.startsWith("prop-") || key.startsWith("道具-")) return "prop";
  return "style";
}

function inferName(key: string, type: LibraryItemType): string {
  // 新格式：角色-林骁-1 → 林骁
  const cnMatch = key.match(/^(?:角色|场景|道具)-(.+?)(?:-\d+)?$/);
  if (cnMatch) return cnMatch[1];
  // 旧格式：char-1234-0 → 角色 #1
  const oldMatch = key.match(/^(?:char|scene|prop)-\d+-(\d+)$/);
  if (oldMatch) {
    const names = { character: "角色", scene: "场景", prop: "道具", style: "风格" };
    return `${names[type]} #${parseInt(oldMatch[1]) + 1}`;
  }
  if (key === "style-image") return "风格参考";
  return key;
}

// ─── Tab 配置 ───

type TabKey = "character" | "scene" | "prop";
const TABS: { key: TabKey; label: string; icon: typeof User }[] = [
  { key: "character", label: "角色", icon: User },
  { key: "scene", label: "场景", icon: Mountain },
  { key: "prop", label: "道具", icon: Sword },
];

// ═══════════════════════════════════════════════════════════
// ★ 模块级内存缓存 — 再次打开弹窗时瞬间渲染
// ═══════════════════════════════════════════════════════════
interface CharLibCache {
  projects: ProjectSource[];
  ts: number;
}
let _charLibCache: CharLibCache | null = null;

// ═══════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════

export default function CharacterLibrary({
  open, onClose, onImport, currentConsistency,
}: CharacterLibraryProps) {
  // ── 项目源列表 ──
  const [projects, setProjects] = useState<ProjectSource[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // ── 标签页 + 选择 ──
  const [activeTab, setActiveTab] = useState<TabKey>("character");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── 搜索 ──
  const [searchQuery, setSearchQuery] = useState("");

  // ── 下拉展开 ──
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // ── 收藏模式 ──
  const [favoritesMode, setFavoritesMode] = useState(false);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);

  /** 加载项目列表（复用逻辑，供初始化 + 同步共用） */
  const loadProjectSources = useCallback(async (): Promise<ProjectSource[]> => {
    const sources: ProjectSource[] = [];
    const archived = await loadProjects();
    for (const proj of archived) {
      const refKeys = (proj.imageKeys || []).filter((k) => k.startsWith("ref:"));
      if (refKeys.length === 0 && !proj.consistency) continue;
      const items: LibraryItem[] = [];
      if (proj.consistency) {
        for (const c of proj.consistency.characters || []) {
          items.push({ key: c.id, type: "character", name: c.name || "未命名角色", description: c.description, prompt: c.prompt, aliases: c.aliases });
        }
        for (const s of proj.consistency.scenes || []) {
          items.push({ key: s.id, type: "scene", name: s.name || "未命名场景", description: s.description, prompt: s.prompt, aliases: s.aliases });
        }
        for (const p of proj.consistency.props || []) {
          items.push({ key: p.id, type: "prop", name: p.name || "未命名道具", description: p.description, prompt: p.prompt, aliases: p.aliases });
        }
      }
      for (const rk of refKeys) {
        const actualKey = rk.slice(4);
        if (!items.some((i) => i.key === actualKey)) {
          const type = inferType(actualKey);
          if (type !== "style") {
            items.push({ key: actualKey, type, name: inferName(actualKey, type) });
          }
        }
      }
      if (items.length > 0) {
        sources.push({
          id: proj.id,
          name: `${proj.name}${proj.version ? ` v${proj.version}` : ""}`,
          source: "archive",
          items,
          loaded: false,
        });
      }
    }
    // 更新模块缓存
    _charLibCache = { projects: sources, ts: Date.now() };
    return sources;
  }, []);

  // ── 弹窗打开时加载项目列表（缓存优先 + 后台静默刷新） ──
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setSearchQuery("");
    setActiveTab("character");
    setDropdownOpen(false);

    let cancelled = false;

    // ★ Phase 0: 缓存命中 → 瞬间渲染
    if (_charLibCache) {
      const currentSrc = buildCurrentSource(currentConsistency);
      const merged = [currentSrc, ..._charLibCache.projects];
      setProjects(merged);
      setSelectedProjectId("__current__");
      setLoading(false);
      // 后台静默刷新归档项目
      loadProjectSources().then(sources => {
        if (!cancelled) {
          const freshCurrent = buildCurrentSource(currentConsistency);
          setProjects([freshCurrent, ...sources]);
        }
      }).catch(e => console.warn("[CharacterLibrary] 后台刷新失败:", e));
      return () => { cancelled = true; };
    }

    // ★ Phase 1: 无缓存，正常加载
    setLoading(true);
    loadProjectSources().then(sources => {
      if (!cancelled) {
        const currentSrc = buildCurrentSource(currentConsistency);
        setProjects([currentSrc, ...sources]);
        setSelectedProjectId("__current__");
      }
    }).catch(err => {
      console.error("[CharacterLibrary] 加载项目列表失败:", err);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, currentConsistency, loadProjectSources]);

  // ── 手动同步（重新加载项目列表 + 重置图片加载状态） ──
  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const sources = await loadProjectSources();
      const currentSrc = buildCurrentSource(currentConsistency);
      setProjects([currentSrc, ...sources]);
      console.log("[CharacterLibrary] 手动同步完成");
    } catch (e) {
      console.error("[CharacterLibrary] 同步失败:", e);
    } finally {
      setSyncing(false);
    }
  }, [syncing, currentConsistency, loadProjectSources]);

  // ── 选中项目变化时惰性加载图片 ──
  useEffect(() => {
    if (!selectedProjectId || !open) return;
    const proj = projects.find((p) => p.id === selectedProjectId);
    if (!proj || proj.loaded || proj.source === "current") return;

    let cancelled = false;
    (async () => {
      setLoadingItems(true);
      try {
        if (proj.source === "archive") {
          // ★ 先检查磁盘文件 — 与角色库页面相同的 serve URL 模式
          const itemsNeedImage = proj.items.filter(i => !i.imageUrl);
          const diskIds = itemsNeedImage.map(i => i.key).filter(Boolean);
          let diskExistsMap: Record<string, boolean> = {};
          if (diskIds.length > 0) {
            try {
              const checkRes = await fetch(`/api/ref-image?keys=${encodeURIComponent(diskIds.join(","))}&check=1`);
              if (checkRes.ok) {
                const checkData = await checkRes.json();
                diskExistsMap = checkData.exists || {};
              }
            } catch { /* ignore disk check failure */ }
          }

          // 再加载 IDB 备份（磁盘未覆盖的条目）
          const prefix = `archive:${proj.id}:ref:`;
          const images = await loadGridImagesByFilterDB((k) => k.startsWith(prefix));

          if (!cancelled) {
            setProjects((prev) =>
              prev.map((p) => {
                if (p.id !== proj.id) return p;
                const enrichedItems = p.items.map((item) => {
                  // 优先磁盘 serve URL（轻量 HTTP URL）
                  if (!item.imageUrl && diskExistsMap[item.key]) {
                    return { ...item, imageUrl: `/api/ref-image?serve=${item.key}` };
                  }
                  // 其次 IDB 备份（data URL）
                  const idbKey = `${prefix}${item.key}`;
                  const dataUrl = images[idbKey];
                  return dataUrl ? { ...item, imageUrl: dataUrl } : item;
                });
                return { ...p, items: enrichedItems, loaded: true };
              })
            );
          }
        }
      } catch (err) {
        console.error("[CharacterLibrary] 加载图片失败:", err);
      } finally {
        if (!cancelled) setLoadingItems(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedProjectId, open, projects]);

  // ── 加载收藏列表 ──
  useEffect(() => {
    if (!open) return;
    (async () => {
      const favs = await loadFavorites();
      setFavorites(favs);
      setFavoritesLoaded(true);
    })();
  }, [open]);

  // ── 当前项目 ──
  const currentProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  // ── 收藏操作 ──
  const favoriteUids = useMemo(() => new Set(favorites.map(f => f.uid)), [favorites]);

  const toggleFavorite = useCallback(async (item: LibraryItem, e: React.MouseEvent) => {
    e.stopPropagation(); // 不触发卡片选择
    if (!currentProject) return;
    const uid = `${currentProject.id}:${item.key}`;
    let updated: FavoriteItem[];
    if (favoriteUids.has(uid)) {
      // 取消收藏
      updated = favorites.filter(f => f.uid !== uid);
    } else {
      // 添加收藏
      const newFav: FavoriteItem = {
        uid,
        type: item.type as "character" | "scene" | "prop",
        name: item.name,
        description: item.description,
        prompt: item.prompt,
        imageDataUrl: item.imageUrl || "",
        sourceProject: currentProject.name,
        sourceProjectId: currentProject.id,
        originalKey: item.key,
        addedAt: Date.now(),
      };
      updated = [...favorites, newFav];
    }
    setFavorites(updated);
    await saveFavorites(updated);
  }, [currentProject, favorites, favoriteUids]);

  const removeFavorite = useCallback(async (uid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = favorites.filter(f => f.uid !== uid);
    setFavorites(updated);
    await saveFavorites(updated);
    // 同时从选中集合移除
    setSelected(prev => {
      const next = new Set(prev);
      next.delete(uid);
      return next;
    });
  }, [favorites]);

  // ── 按标签筛选 + 搜索（支持收藏模式）──
  const filteredItems = useMemo(() => {
    if (favoritesMode) {
      // 收藏模式：从收藏列表筛选
      let items = favorites.filter(f => f.type === activeTab);
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        items = items.filter(f => f.name.toLowerCase().includes(q) || f.description?.toLowerCase().includes(q));
      }
      // 转换为 LibraryItem 格式（使用 uid 作为 key）
      return items.map(f => ({
        key: f.uid,
        type: f.type as LibraryItemType,
        name: f.name,
        description: f.description,
        prompt: f.prompt,
        imageUrl: f.imageDataUrl,
        _favorite: f, // 附加收藏元数据
      }));
    }
    if (!currentProject) return [];
    let items = currentProject.items.filter((i) => i.type === activeTab);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      items = items.filter(
        (i) => i.name.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q)
      );
    }
    return items;
  }, [favoritesMode, favorites, currentProject, activeTab, searchQuery]);

  // ── 选择操作 ──
  const toggleSelect = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── 全选/全不选 ──
  const toggleSelectAll = useCallback(() => {
    const allKeys = filteredItems.map((i) => i.key);
    setSelected((prev) => {
      const allSelected = allKeys.every((k) => prev.has(k));
      const next = new Set(prev);
      if (allSelected) {
        allKeys.forEach((k) => next.delete(k));
      } else {
        allKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  }, [filteredItems]);

  // ── 导入 ──
  const [importing, setImporting] = useState(false);

  const handleImport = useCallback(async () => {
    if (selected.size === 0) return;
    setImporting(true);

    try {
      const importItems: ImportItem[] = [];

      if (favoritesMode) {
        // 从收藏列表导入
        for (const uid of selected) {
          const fav = favorites.find(f => f.uid === uid);
          if (!fav || !fav.imageDataUrl) continue;
          importItems.push({
            type: fav.type,
            name: fav.name,
            description: fav.description || "",
            prompt: fav.prompt,
            imageDataUrl: fav.imageDataUrl,
            sourceKey: fav.originalKey,
            fromArchive: true,
          });
        }
      } else {
        // 从项目列表导入（原逻辑）
        if (!currentProject) return;
        const isCurrent = currentProject.source === "current";
        for (const key of selected) {
          const item = currentProject.items.find((i) => i.key === key);
          if (!item || item.type === "style") continue;
          const imageDataUrl = item.imageUrl || "";
          if (!imageDataUrl) continue;
          importItems.push({
            type: item.type as "character" | "scene" | "prop",
            name: item.name,
            description: item.description || "",
            prompt: item.prompt,
            imageDataUrl,
            sourceKey: key,
            fromArchive: !isCurrent,
          });
        }
      }

      if (importItems.length > 0) {
        onImport(importItems);
      }
    } catch (err) {
      console.error("[CharacterLibrary] 导入失败:", err);
    } finally {
      setImporting(false);
      onClose();
    }
  }, [selected, favoritesMode, favorites, currentProject, onImport, onClose]);

  // ── ★ 一键智能匹配：扫描当前一致性的角色/场景/道具名，匹配归档项目中同名且有图的条目 ──
  const [smartMatching, setSmartMatching] = useState(false);

  const handleSmartMatch = useCallback(async () => {
    if (!currentProject?.loaded) return;
    setSmartMatching(true);

    try {
      // 收集当前一致性中所有实体名（分类型）
      const currentEntities: { type: TabKey; name: string; aliases?: string[]; hasImage: boolean }[] = [];
      for (const c of currentConsistency.characters || []) {
        currentEntities.push({ type: "character", name: c.name, aliases: c.aliases, hasImage: !!c.referenceImage });
      }
      for (const s of currentConsistency.scenes || []) {
        currentEntities.push({ type: "scene", name: s.name, aliases: s.aliases, hasImage: !!s.referenceImage });
      }
      for (const p of currentConsistency.props || []) {
        currentEntities.push({ type: "prop", name: p.name, aliases: p.aliases, hasImage: !!p.referenceImage });
      }

      // 在归档项目 items 中匹配（只要名称匹配且有图片）
      const matchedKeys = new Set<string>();
      const matchedNames: string[] = [];

      for (const entity of currentEntities) {
        for (const item of currentProject.items) {
          if (matchedKeys.has(item.key)) continue;
          if (!item.imageUrl) continue; // 无图片的不匹配
          // 类型约束：角色只匹配角色，场景只匹配场景
          if (item.type !== entity.type) continue;

          // 正向：当前实体名/别名 → 归档项目名
          let matched = namesMatch(entity.name, item.name);
          if (!matched && entity.aliases) {
            for (const alias of entity.aliases) {
              if (namesMatch(alias, item.name)) { matched = true; break; }
            }
          }
          // 反向：归档项目别名 → 当前实体名
          if (!matched && item.aliases) {
            for (const alias of item.aliases) {
              if (namesMatch(entity.name, alias)) { matched = true; break; }
            }
          }

          if (matched) {
            matchedKeys.add(item.key);
            matchedNames.push(item.name);
          }
        }
      }

      if (matchedKeys.size > 0) {
        // 自动选中匹配项
        setSelected(matchedKeys);
        console.log(`[SmartMatch] 匹配到 ${matchedKeys.size} 项: ${matchedNames.join(", ")}`);
      } else {
        // 无匹配：提示用户
        setSelected(new Set());
      }

      return matchedKeys.size;
    } finally {
      setSmartMatching(false);
    }
  }, [currentProject, currentConsistency]);

  // ── 一键智能导入（匹配 + 立即导入） ──
  const handleSmartImport = useCallback(async () => {
    if (!currentProject?.loaded) return;
    setSmartMatching(true);

    try {
      // 收集当前一致性中所有实体名
      const currentEntities: { type: TabKey; name: string; aliases?: string[] }[] = [];
      for (const c of currentConsistency.characters || []) {
        currentEntities.push({ type: "character", name: c.name, aliases: c.aliases });
      }
      for (const s of currentConsistency.scenes || []) {
        currentEntities.push({ type: "scene", name: s.name, aliases: s.aliases });
      }
      for (const p of currentConsistency.props || []) {
        currentEntities.push({ type: "prop", name: p.name, aliases: p.aliases });
      }

      const importItems: ImportItem[] = [];
      const importedKeys = new Set<string>();

      for (const entity of currentEntities) {
        for (const item of currentProject.items) {
          if (importedKeys.has(item.key)) continue;
          if (!item.imageUrl) continue;
          if (item.type === "style") continue;
          // 类型约束：角色只匹配角色，场景只匹配场景
          if (item.type !== entity.type) continue;

          // 正向：当前实体名/别名 → 归档项目名
          let matched = namesMatch(entity.name, item.name);
          if (!matched && entity.aliases) {
            for (const alias of entity.aliases) {
              if (namesMatch(alias, item.name)) { matched = true; break; }
            }
          }
          // 反向：归档项目别名 → 当前实体名
          if (!matched && item.aliases) {
            for (const alias of item.aliases) {
              if (namesMatch(entity.name, alias)) { matched = true; break; }
            }
          }

          if (matched) {
            importedKeys.add(item.key);
            importItems.push({
              type: item.type as "character" | "scene" | "prop",
              name: item.name,
              description: item.description || "",
              prompt: item.prompt,
              imageDataUrl: item.imageUrl,
              sourceKey: item.key,
              fromArchive: true,
            });
          }
        }
      }

      if (importItems.length > 0) {
        onImport(importItems);
        onClose();
      }

      return importItems.length;
    } finally {
      setSmartMatching(false);
    }
  }, [currentProject, currentConsistency, onImport, onClose]);

  // ── 图片预览 ──
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);

  // ── 不渲染 ──
  if (!open) return null;

  // ── 统计 ──
  const selectedInTab = filteredItems.filter((i) => selected.has(i.key)).length;
  const totalSelected = selected.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex flex-col w-[640px] max-h-[80vh] bg-[#161616] border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-default)]">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-[var(--gold-primary)]" />
            <span className="text-[14px] font-semibold text-[var(--text-primary)]">参考图角色库</span>
            {totalSelected > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-[var(--gold-primary)]/15 text-[var(--gold-primary)]">
                已选 {totalSelected} 项
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] transition-all
                border border-[var(--border-default)] hover:border-[var(--gold-primary)]
                text-[var(--text-muted)] hover:text-[var(--gold-primary)]
                disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              title="同步刷新归档项目数据"
            >
              <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
              {syncing ? "同步中..." : "同步"}
            </button>
            <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── 项目选择器（收藏模式下隐藏） ── */}
        {!favoritesMode && (
        <div className="px-5 py-3 border-b border-[var(--border-default)]">
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center justify-between w-full px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[12px] text-[var(--text-primary)] hover:border-[var(--gold-primary)] transition cursor-pointer"
            >
              <span className="truncate">
                {loading ? "加载中..." : currentProject?.name || "选择归档项目"}
              </span>
              <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
            </button>

            {dropdownOpen && !loading && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 max-h-48 overflow-auto bg-[#1A1A1A] border border-[var(--border-default)] rounded shadow-lg">
                {projects.map((proj, idx) => (
                  <div key={proj.id}>
                    {/* 在当前工作台和归档项目之间添加分隔线 */}
                    {idx === 1 && proj.source === "archive" && (
                      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-[var(--border-default)]">
                        <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">归档项目</span>
                      </div>
                    )}
                    <button
                      onClick={() => { setSelectedProjectId(proj.id); setDropdownOpen(false); }}
                      className={`flex items-center gap-2 w-full px-3 py-2 text-[12px] text-left hover:bg-[var(--bg-surface)] transition cursor-pointer ${
                        selectedProjectId === proj.id ? "text-[var(--gold-primary)] bg-[var(--gold-primary)]/5" : "text-[var(--text-secondary)]"
                      }`}
                    >
                      <span className="flex-1 truncate">{proj.name}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {proj.items.length} 项
                      </span>
                    </button>
                  </div>
                ))}
                {projects.length === 0 && (
                  <div className="px-3 py-4 text-[11px] text-[var(--text-muted)] text-center">
                    暂无归档项目，请先在「项目总览」中归档项目
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        )}

        {/* ── 标签页 + 收藏 + 搜索 ── */}
        <div className="flex items-center gap-2 px-5 py-2 border-b border-[var(--border-default)]">
          <div className="flex gap-1">
            {TABS.map(({ key, label, icon: Icon }) => {
              const count = favoritesMode
                ? favorites.filter(f => f.type === key).length
                : (currentProject?.items.filter((i) => i.type === key).length || 0);
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded text-[11px] font-medium transition cursor-pointer ${
                    activeTab === key
                      ? "bg-[var(--gold-primary)]/15 text-[var(--gold-primary)] border border-[var(--gold-primary)]/30"
                      : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-transparent"
                  }`}
                >
                  <Icon size={12} />
                  {label}
                  {count > 0 && <span className="text-[9px] opacity-60">({count})</span>}
                </button>
              );
            })}
          </div>
          {/* ⭐ 收藏按钮 */}
          <div className="w-px h-5 bg-[var(--border-default)] mx-1" />
          <button
            onClick={() => { setFavoritesMode(!favoritesMode); setSelected(new Set()); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-medium transition cursor-pointer border ${
              favoritesMode
                ? "bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.15)]"
                : "text-amber-400/70 hover:text-amber-400 border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-500/30"
            }`}
            title={favoritesMode ? "退出收藏模式" : "查看收藏"}
          >
            <Star size={13} fill={favoritesMode || favorites.length > 0 ? "currentColor" : "none"} />
            收藏
            {favorites.length > 0 && <span className="text-[9px] opacity-70">({favorites.length})</span>}
          </button>
          <div className="flex-1" />
          {/* 搜索框 */}
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索..."
              className="pl-7 pr-2 py-1.5 w-36 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
            />
          </div>
        </div>

        {/* ── 图片网格 ── */}
        <div className="flex-1 overflow-auto p-4 min-h-[240px]">
          {loading || loadingItems ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-[var(--text-muted)]">
              <Loader size={20} className="animate-spin" />
              <span className="text-[12px]">加载中...</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-[var(--text-muted)]">
              {favoritesMode ? (
                <>
                  <Star size={24} />
                  <span className="text-[12px]">
                    {searchQuery ? "未找到匹配的收藏项" : `暂无${TABS.find((t) => t.key === activeTab)?.label}收藏`}
                  </span>
                  <span className="text-[10px] mt-1">在项目浏览中点击卡片左上角的 ⭐ 即可收藏</span>
                </>
              ) : (
                <>
                  {TABS.find((t) => t.key === activeTab)?.icon &&
                    (() => { const Icon = TABS.find((t) => t.key === activeTab)!.icon; return <Icon size={24} />; })()}
                  <span className="text-[12px]">
                    {projects.length === 0 ? "暂无归档项目，请先在「项目总览」中归档项目" :
                      searchQuery ? "未找到匹配项" : `该项目暂无${TABS.find((t) => t.key === activeTab)?.label}数据`}
                  </span>
                </>
              )}
            </div>
          ) : (
            <>
              {/* 全选 */}
              <div className="flex items-center justify-between mb-3">
                <button onClick={toggleSelectAll}
                  className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--gold-primary)] transition cursor-pointer">
                  <div className={`flex items-center justify-center w-4 h-4 rounded border transition ${
                    selectedInTab === filteredItems.length && selectedInTab > 0
                      ? "bg-[var(--gold-primary)] border-[var(--gold-primary)]"
                      : "border-[var(--border-default)]"
                  }`}>
                    {selectedInTab === filteredItems.length && selectedInTab > 0 && <Check size={10} className="text-black" />}
                  </div>
                  全选（{filteredItems.length}）
                </button>
                {selectedInTab > 0 && (
                  <span className="text-[10px] text-[var(--gold-primary)]">
                    当前标签已选 {selectedInTab} 项
                  </span>
                )}
              </div>

              {/* 网格 */}
              <div className="grid grid-cols-4 gap-3">
                {filteredItems.map((item) => {
                  const isSelected = selected.has(item.key);
                  // 当前 item 是否已收藏（非收藏模式下需要判断）
                  const isFavorited = favoritesMode || (currentProject ? favoriteUids.has(`${currentProject.id}:${item.key}`) : false);
                  // 收藏模式下获取来源项目名
                  const favMeta = (item as { _favorite?: FavoriteItem })._favorite;
                  return (
                    <button
                      key={item.key}
                      onClick={() => toggleSelect(item.key)}
                      className={`flex flex-col rounded-lg overflow-hidden border-2 transition cursor-pointer group ${
                        isSelected
                          ? "border-[var(--gold-primary)] bg-[#1A1200]"
                          : "border-[var(--border-default)] bg-[#171717] hover:border-[var(--text-muted)]"
                      }`}
                    >
                      {/* 图片 */}
                      <div className="relative w-full aspect-square bg-[#111]">
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex items-center justify-center w-full h-full text-[var(--text-muted)]">
                            {(() => { const Icon = TABS.find((t) => t.key === activeTab)?.icon || User; return <Icon size={24} />; })()}
                          </div>
                        )}
                        {/* ⭐ 收藏星标（左上角） */}
                        {!favoritesMode && (
                          <div
                            onClick={(e) => toggleFavorite(item, e)}
                            className={`absolute top-2 left-2 flex items-center justify-center w-6 h-6 rounded-full transition ${
                              isFavorited
                                ? "bg-amber-500/80 text-black"
                                : "bg-black/40 text-white/40 opacity-0 group-hover:opacity-100 hover:text-amber-400 hover:bg-black/60"
                            }`}
                            title={isFavorited ? "取消收藏" : "收藏"}
                          >
                            <Star size={12} fill={isFavorited ? "currentColor" : "none"} />
                          </div>
                        )}
                        {/* 收藏模式下：移除收藏按钮（左上角） */}
                        {favoritesMode && favMeta && (
                          <div
                            onClick={(e) => removeFavorite(favMeta.uid, e)}
                            className="absolute top-2 left-2 flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/80 text-black hover:bg-red-500/80 transition"
                            title="移除收藏"
                          >
                            <Star size={12} fill="currentColor" />
                          </div>
                        )}
                        {/* 🔍 放大查看（右下角） */}
                        {item.imageUrl && (
                          <div
                            onClick={(e) => { e.stopPropagation(); setPreviewImage({ url: item.imageUrl!, name: item.name }); }}
                            className="absolute bottom-2 right-2 flex items-center justify-center w-6 h-6 rounded-full bg-black/50 text-white/60 opacity-0 group-hover:opacity-100 hover:bg-black/80 hover:text-white transition cursor-pointer"
                            title="放大查看"
                          >
                            <ZoomIn size={12} />
                          </div>
                        )}
                        {/* 勾选框（右上角） */}
                        <div className={`absolute top-2 right-2 flex items-center justify-center w-5 h-5 rounded-full border-2 transition ${
                          isSelected
                            ? "bg-[var(--gold-primary)] border-[var(--gold-primary)]"
                            : "border-white/40 bg-black/40 group-hover:border-white/60"
                        }`}>
                          {isSelected && <Check size={11} className="text-black" strokeWidth={3} />}
                        </div>
                      </div>
                      {/* 名称 */}
                      <div className="px-2 py-1.5">
                        <p className={`text-[11px] font-medium truncate ${
                          isSelected ? "text-[var(--gold-primary)]" : "text-[var(--text-secondary)]"
                        }`}>
                          {item.name}
                        </p>
                        {favoritesMode && favMeta ? (
                          <p className="text-[9px] text-[var(--text-muted)] truncate mt-0.5">
                            来源: {favMeta.sourceProject}
                          </p>
                        ) : item.description ? (
                          <p className="text-[9px] text-[var(--text-muted)] truncate mt-0.5">
                            {item.description.slice(0, 30)}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ── 底栏 ── */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border-default)] bg-[#111]">
          <div className="text-[11px] text-[var(--text-muted)]">
            {totalSelected > 0 ? (
              <span>已选 <span className="text-[var(--gold-primary)] font-medium">{totalSelected}</span> 项参考图</span>
            ) : favoritesMode ? (
              <span>从收藏中选择要导入的参考图</span>
            ) : (
              <span>点击图片选择要导入的参考图</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* ★ 一键智能匹配按钮（仅归档项目可用） */}
            {!favoritesMode && currentProject?.loaded && currentProject.source !== "current" && (
              <button
                onClick={handleSmartImport}
                disabled={smartMatching || !currentProject}
                className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-medium text-[var(--gold-primary)] border border-[var(--gold-primary)]/40 bg-[var(--gold-primary)]/10 rounded hover:bg-[var(--gold-primary)]/20 hover:border-[var(--gold-primary)]/60 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                title="根据当前一致性面板的角色/场景/道具名称，自动匹配归档项目中的同名参考图并一键导入"
              >
                {smartMatching ? (
                  <><Loader size={11} className="animate-spin" /> 匹配中...</>
                ) : (
                  <><Sparkles size={11} /> ✦ 智能匹配导入</>
                )}
              </button>
            )}
            {favoritesMode && (
              <button
                onClick={() => { setFavoritesMode(false); setSelected(new Set()); }}
                className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-medium text-amber-400 border border-amber-500/30 bg-amber-500/10 rounded hover:bg-amber-500/20 transition cursor-pointer"
              >
                ← 返回项目
              </button>
            )}
            <button onClick={onClose}
              className="px-4 py-1.5 text-[11px] text-[var(--text-muted)] border border-[var(--border-default)] rounded hover:text-[var(--text-primary)] transition cursor-pointer">
              取消
            </button>
            <button
              onClick={handleImport}
              disabled={totalSelected === 0 || importing}
              className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-medium text-black bg-[var(--gold-primary)] rounded hover:brightness-110 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {importing ? <><Loader size={11} className="animate-spin" /> 导入中...</> : <>导入 {totalSelected > 0 ? `(${totalSelected})` : ""}</>}
            </button>
          </div>
        </div>
      </div>

      {/* ── 图片预览遮罩 ── */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 cursor-pointer"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-[85vw] max-h-[85vh] flex flex-col items-center">
            <img
              src={previewImage.url}
              alt={previewImage.name}
              className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <p className="mt-3 text-[13px] text-white/80 font-medium">{previewImage.name}</p>
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 flex items-center justify-center w-8 h-8 rounded-full bg-black/60 text-white hover:bg-black/90 transition cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
