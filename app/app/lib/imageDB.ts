/**
 * IndexedDB-based storage for grid images.
 * localStorage has ~5MB limit which is easily exceeded by base64 data URL images.
 * IndexedDB supports hundreds of MB — perfect for storing cropped grid cells.
 */

const DB_NAME = "feicai-image-store";
const DB_VERSION = 1;
const STORE_NAME = "grid-images";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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
 * Load all grid images from IndexedDB.
 * Returns a Record<string, string> of image keys → data URLs / HTTP URLs.
 */
export async function loadGridImagesDB(): Promise<Record<string, string>> {
  if (typeof window === "undefined" || !window.indexedDB) return {};
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    return new Promise((resolve) => {
      const tx = db!.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      const keyReq = store.getAllKeys();

      const result: Record<string, string> = {};
      let values: string[] = [];
      let keys: IDBValidKey[] = [];

      req.onsuccess = () => { values = req.result; };
      keyReq.onsuccess = () => { keys = keyReq.result; };

      tx.oncomplete = () => {
        for (let i = 0; i < keys.length; i++) {
          result[String(keys[i])] = values[i];
        }
        db!.close();
        resolve(result);
      };
      tx.onerror = () => { db!.close(); resolve({}); };
    });
  } catch {
    db?.close();
    return {};
  }
}

/**
 * Load grid images from IndexedDB filtered by a predicate on keys.
 * Much faster than loadGridImagesDB() when only a subset of images is needed,
 * because it avoids deserializing large data URLs for irrelevant keys.
 */
export async function loadGridImagesByFilterDB(keyFilter: (key: string) => boolean): Promise<Record<string, string>> {
  if (typeof window === "undefined" || !window.indexedDB) return {};
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    return new Promise((resolve) => {
      const tx = db!.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const result: Record<string, string> = {};

      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const key = String(cursor.key);
          if (keyFilter(key)) {
            result[key] = cursor.value;
          }
          cursor.continue();
        }
      };

      tx.oncomplete = () => { db!.close(); resolve(result); };
      tx.onerror = () => { db!.close(); resolve({}); };
    });
  } catch {
    db?.close();
    return {};
  }
}

/**
 * Save grid images to IndexedDB.
 * Merges new entries with existing ones (put overwrites same keys).
 * ★ 配额不足或写入失败时 reject（调用方应 catch 并提示用户）。
 */
export async function saveGridImagesDB(images: Record<string, string>): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    for (const [key, value] of Object.entries(images)) {
      if (value) {
        store.put(value, key);
      }
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db!.close(); resolve(); };
      tx.onerror = () => {
        const err = tx.error;
        db!.close();
        console.error("[imageDB] saveGridImagesDB 事务失败:", err?.name, err?.message);
        reject(err || new Error("IDB transaction failed"));
      };
    });
  } catch (e) {
    db?.close();
    throw e;
  }
}

/**
 * Save a single grid image entry.
 */
export async function saveGridImageDB(key: string, value: string): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, key);
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => { db!.close(); resolve(); };
      tx.onerror = () => { const err = tx.error; db!.close(); reject(err || new Error("saveGridImageDB transaction failed")); };
    });
  } catch {
    db?.close();
  }
}

/**
 * Delete a specific grid image entry.
 */
export async function deleteGridImageDB(key: string): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => { db!.close(); resolve(); };
      tx.onerror = () => { const err = tx.error; db!.close(); reject(err || new Error("deleteGridImageDB transaction failed")); };
    });
  } catch {
    db?.close();
  }
}

/**
 * Load only KEYS from IndexedDB filtered by predicate (不加载 values，避免 OOM).
 * 用于 clearCurrentWorkspace / deleteProject 等只需要 key 列表的场景。
 */
export async function loadGridImageKeysByFilterDB(keyFilter: (key: string) => boolean): Promise<string[]> {
  if (typeof window === "undefined" || !window.indexedDB) return [];
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    return new Promise((resolve) => {
      const tx = db!.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const result: string[] = [];

      // 只读 key，不读 value（大幅节省内存）
      const cursorReq = store.openKeyCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const key = String(cursor.key);
          if (keyFilter(key)) result.push(key);
          cursor.continue();
        }
      };

      tx.oncomplete = () => { db!.close(); resolve(result); };
      tx.onerror = () => { db!.close(); resolve([]); };
    });
  } catch {
    db?.close();
    return [];
  }
}

/**
 * Clear all grid images from IndexedDB.
 */
export async function clearGridImagesDB(): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    return new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => { db!.close(); resolve(); };
      tx.onerror = () => { const err = tx.error; db!.close(); reject(err || new Error("clearGridImagesDB transaction failed")); };
    });
  } catch {
    db?.close();
  }
}

/**
 * Migrate existing localStorage grid images to IndexedDB (one-time).
 * Called on first load — moves data from localStorage to IndexedDB, then clears localStorage entry.
 */
export async function migrateFromLocalStorage(): Promise<Record<string, string>> {
  if (typeof window === "undefined") return {};
  try {
    const saved = localStorage.getItem("feicai-grid-images");
    if (!saved) return {};
    const images: Record<string, string> = JSON.parse(saved);
    if (Object.keys(images).length > 0) {
      await saveGridImagesDB(images);
      localStorage.removeItem("feicai-grid-images");
    }
    return images;
  } catch {
    // If localStorage data is corrupted, just clear it
    try { localStorage.removeItem("feicai-grid-images"); } catch { /* ignore */ }
    return {};
  }
}
