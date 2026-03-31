/**
 * Universal key-value store backed by IndexedDB.
 *
 * localStorage has a hard ~5-10 MB browser limit that CANNOT be increased.
 * IndexedDB supports hundreds of MB to GB — perfect for large application state.
 *
 * This module provides a simple async get/set/remove API that replaces localStorage
 * for all heavy data (consistency profiles, video states, studio state, projects, etc.).
 *
 * Light flags (settings, active-episode IDs, new-project flag) can stay in localStorage.
 *
 * ★ Disk Mirror (Plan E): 重要 KV 数据自动镜像到 outputs/workspace/{key}.json
 *   - 每个 key 一个独立文件，互不干扰
 *   - kvSet 时自动异步写盘（500ms 防抖，fire-and-forget）
 *   - kvRemove/kvRemoveByPrefix 时自动删除对应磁盘文件
 *   - kvLoad 时若 IDB+localStorage 均为空，自动从磁盘恢复（一次性回写 IDB）
 */

const DB_NAME = "feicai-kv-store";
const DB_VERSION = 1;
const STORE_NAME = "kv";

// ═══════════════════════════════════════════════════════════
// ★ Disk Mirror Layer（Plan E）
// ═══════════════════════════════════════════════════════════

/** 需要镜像到磁盘的 KV key 前缀列表（所有数据都会备份到SQLite） */
const MIRROR_PREFIXES = [
  "feicai-",              // 所有飞彩相关数据
  "novel-",              // 所有小说相关数据
  "script-",             // 所有脚本相关数据
  "grid-",               // 所有格子图相关数据
  "video-",              // 所有视频相关数据
  "studio-",             // 所有工作室相关数据
  "pipeline-",           // 所有流程相关数据
  "writer-",             // 所有写作相关数据
];

/** 判断某个 key 是否需要磁盘镜像 */
function _shouldMirror(key: string): boolean {
  return MIRROR_PREFIXES.some(p => key === p || key.startsWith(p));
}

/** 正在从磁盘恢复的 key（防止恢复时触发无意义的回写） */
const _recovering = new Set<string>();

/** 防抖计时器 */
const _mirrorTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

/** 异步写盘（fire-and-forget，500ms 防抖合并快速连续写入） */
function _mirrorToDisk(key: string, value: string): void {
  if (typeof window === "undefined") return;
  if (_recovering.has(key)) return; // 恢复期间不回写
  const existing = _mirrorTimers.get(key);
  if (existing) clearTimeout(existing);
  _mirrorTimers.set(key, setTimeout(async () => {
    _mirrorTimers.delete(key);
    try {
      await fetch("/api/workspace-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
    } catch { /* fire-and-forget: 磁盘写入失败不影响 IDB 主流程 */ }
  }, 500));

  // 同时备份到SQLite本地数据库
  _backupToSQLite(key, value);
}

/** 备份到SQLite本地数据库 */
function _backupToSQLite(key: string, value: string): void {
  if (typeof window === "undefined") return;
  fetch("/api/local-db-backup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  }).catch(() => {});
}

/** 从磁盘删除单个文件 */
function _mirrorDeleteFromDisk(key: string): void {
  if (typeof window === "undefined") return;
  fetch(`/api/workspace-file?key=${encodeURIComponent(key)}`, { method: "DELETE" }).catch(() => {});
}

/** 按前缀批量删除磁盘文件 */
function _mirrorDeletePrefixFromDisk(prefix: string): void {
  if (typeof window === "undefined") return;
  fetch(`/api/workspace-file?prefix=${encodeURIComponent(prefix)}`, { method: "DELETE" }).catch(() => {});
}

/** 从磁盘读取（仅在 IDB+localStorage 均为空时调用） */
async function _loadFromDisk(key: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(`/api/workspace-file?key=${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.value === null || data.value === undefined) return null;
    // 磁盘文件可能是 pretty-printed JSON，原样返回（caller 会 JSON.parse）
    return data.value;
  } catch { return null; }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get a value by key from IndexedDB.
 */
export async function kvGet(key: string): Promise<string | null> {
  if (typeof window === "undefined" || !window.indexedDB) return null;
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    return new Promise((resolve) => {
      const tx = db!.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        db!.close();
        resolve(req.result ?? null);
      };
      req.onerror = () => {
        db!.close();
        resolve(null);
      };
    });
  } catch {
    db?.close();
    return null;
  }
}

/**
 * Set a value by key in IndexedDB.
 */
export async function kvSet(key: string, value: string): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => { db!.close(); resolve(); };
      tx.onerror = () => { const err = tx.error; db!.close(); reject(err || new Error("kvSet transaction failed")); };
    });
  } catch {
    db?.close();
  }
  // ★ Plan E: 自动镜像到磁盘（异步 fire-and-forget，不阻塞主流程）
  if (_shouldMirror(key)) _mirrorToDisk(key, value);
}

/**
 * Remove a value by key from IndexedDB.
 */
export async function kvRemove(key: string): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => { db!.close(); resolve(); };
      tx.onerror = () => { const err = tx.error; db!.close(); reject(err || new Error("kvRemove transaction failed")); };
    });
  } catch {
    db?.close();
  }
  // ★ Plan E: 同步删除磁盘镜像文件
  if (_shouldMirror(key)) _mirrorDeleteFromDisk(key);
}

/**
 * Check if a key exists in IndexedDB (without reading the full value).
 */
export async function kvHas(key: string): Promise<boolean> {
  const val = await kvGet(key);
  return val !== null;
}

/**
 * Migrate a single key from localStorage to IndexedDB.
 * If the key exists in localStorage, copies it to IndexedDB and removes it from localStorage.
 * Returns the value (or null if not found).
 */
export async function kvMigrateKey(key: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const val = localStorage.getItem(key);
    if (val !== null) {
      await kvSet(key, val);
      localStorage.removeItem(key);
      return val;
    }
  } catch {
    // localStorage might be corrupted or empty
  }
  return null;
}

/**
 * Load a value with automatic migration from localStorage.
 * Tries IndexedDB first; if not found, checks localStorage and migrates.
 * Returns the raw string value or null.
 */
/** 已完成"初始种子回写"的 key（每个 key 每次会话仅补写一次磁盘） */
const _seeded = new Set<string>();

export async function kvLoad(key: string): Promise<string | null> {
  // 1. Try IndexedDB (primary source)
  const fromDB = await kvGet(key);
  if (fromDB !== null) {
    // ★ Plan E 初始种子：IDB 有数据但磁盘可能没有（Plan E 上线前的旧数据），
    //   每个 key 每次会话仅触发一次补写，确保磁盘备份存在。
    if (_shouldMirror(key) && !_seeded.has(key)) {
      _seeded.add(key);
      _mirrorToDisk(key, fromDB);
    }
    return fromDB;
  }

  // 2. Fallback: try localStorage and migrate if found
  const fromLS = await kvMigrateKey(key);
  if (fromLS !== null) return fromLS;

  // 3. ★ Plan E: 从磁盘文件恢复（IDB + localStorage 均为空时的最后防线）
  if (_shouldMirror(key)) {
    const fromDisk = await _loadFromDisk(key);
    if (fromDisk !== null) {
      console.log(`[kvDB] ✓ 从磁盘恢复 key: ${key} (${(fromDisk.length / 1024).toFixed(1)}KB)`);
      // 回写到 IDB（后续访问直接从 IDB 读取，不再走磁盘）
      _recovering.add(key);
      try { await kvSet(key, fromDisk); } catch { /* ignore */ }
      _recovering.delete(key);
      _seeded.add(key); // 已有磁盘文件，不需要种子
      return fromDisk;
    }
  }

  return null;
}

/**
 * 删除所有以指定前缀开头的 key。
 * 用于批量清理动态提示词等按 episode/beat 分散存储的数据。
 */
/**
 * 返回所有匹配指定前缀的 key 列表（只读，不删除）。
 * 用于 EP 检测等场景，需要知道哪些 EP 在 KV 中有数据。
 */
export async function kvKeysByPrefix(prefix: string): Promise<string[]> {
  if (typeof window === "undefined" || !window.indexedDB) return [];
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    return new Promise((resolve) => {
      const tx = db!.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => {
        db!.close();
        const all = req.result as string[];
        resolve(all.filter(k => typeof k === "string" && k.startsWith(prefix)));
      };
      req.onerror = () => { db!.close(); resolve([]); };
    });
  } catch { return []; }
}

export async function kvRemoveByPrefix(prefix: string): Promise<number> {
  if (typeof window === "undefined" || !window.indexedDB) return 0;
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    // 1. 先收集匹配的 key
    const matchedKeys: IDBValidKey[] = await new Promise((resolve) => {
      const tx = db!.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => {
        db!.close();
        const all = req.result as string[];
        resolve(all.filter(k => typeof k === "string" && k.startsWith(prefix)));
      };
      req.onerror = () => { db!.close(); resolve([]); };
    });
    if (matchedKeys.length === 0) return 0;
    // 2. 批量删除
    db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const key of matchedKeys) store.delete(key);
    const count = await new Promise<number>((resolve, reject) => {
      tx.oncomplete = () => { db!.close(); resolve(matchedKeys.length); };
      tx.onerror = () => {
        const err = tx.error;
        db!.close();
        console.error("[kvDB] kvRemoveByPrefix 事务失败:", err?.name, err?.message);
        reject(err || new Error("kvRemoveByPrefix transaction failed"));
      };
    });
    // ★ Plan E: 同步删除磁盘镜像文件（按前缀批量）
    _mirrorDeletePrefixFromDisk(prefix);
    return count;
  } catch (e) {
    db?.close();
    console.error("[kvDB] kvRemoveByPrefix 异常:", e);
    throw e;
  }
}
