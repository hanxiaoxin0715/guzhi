/**
 * IndexedDB-based storage for scripts.
 * localStorage has ~5-10MB limit which is easily exceeded when storing many scripts.
 * IndexedDB supports hundreds of MB to GB — perfect for storing up to 1000 scripts.
 */

const DB_NAME = "feicai-script-store";
const DB_VERSION = 1;
const STORE_NAME = "scripts";

export interface ScriptRecord {
  id: string;
  title: string;
  desc: string;
  status: string;
  content: string;
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
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Load all scripts from IndexedDB.
 * Returns an array of ScriptRecord ordered by insertion.
 */
export async function loadScriptsDB(): Promise<ScriptRecord[]> {
  if (typeof window === "undefined" || !window.indexedDB) return [];
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    return new Promise((resolve) => {
      const tx = db!.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        db!.close();
        resolve(req.result || []);
      };
      req.onerror = () => {
        db!.close();
        resolve([]);
      };
    });
  } catch {
    db?.close();
    return [];
  }
}

/**
 * Save all scripts to IndexedDB (replace all).
 * Clears the store first, then inserts all scripts in order.
 */
export async function saveAllScriptsDB(scripts: ScriptRecord[]): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    for (const script of scripts) {
      store.put(script);
    }
    return new Promise((resolve) => {
      tx.oncomplete = () => { db!.close(); resolve(); };
      tx.onerror = () => { db!.close(); resolve(); };
    });
  } catch {
    db?.close();
  }
}

/**
 * Save a single script (insert or update).
 */
export async function saveScriptDB(script: ScriptRecord): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(script);
    return new Promise((resolve) => {
      tx.oncomplete = () => { db!.close(); resolve(); };
      tx.onerror = () => { db!.close(); resolve(); };
    });
  } catch {
    db?.close();
  }
}

/**
 * Delete a specific script by id.
 */
export async function deleteScriptDB(id: string): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  let db: IDBDatabase | undefined;
  try {
    db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    return new Promise((resolve) => {
      tx.oncomplete = () => { db!.close(); resolve(); };
      tx.onerror = () => { db!.close(); resolve(); };
    });
  } catch {
    db?.close();
  }
}

/**
 * Migrate existing localStorage scripts to IndexedDB (one-time).
 * Called on first load — moves data from localStorage to IndexedDB, then clears localStorage entry.
 * Returns the migrated scripts array (empty if nothing to migrate).
 */
export async function migrateScriptsFromLocalStorage(): Promise<ScriptRecord[]> {
  if (typeof window === "undefined") return [];
  try {
    const saved = localStorage.getItem("feicai-scripts");
    if (!saved) return [];
    const scripts: ScriptRecord[] = JSON.parse(saved);
    if (Array.isArray(scripts) && scripts.length > 0) {
      await saveAllScriptsDB(scripts);
      localStorage.removeItem("feicai-scripts");
      return scripts;
    }
    return [];
  } catch {
    // If localStorage data is corrupted, just clear it
    try { localStorage.removeItem("feicai-scripts"); } catch { /* ignore */ }
    return [];
  }
}
