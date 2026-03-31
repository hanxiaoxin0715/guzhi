import Database from "better-sqlite3";
import path from "path";
import { getBaseOutputDir } from "./paths";
import { supabase } from "./supabaseClient";

let db: Database.Database | null = null;

function isSupabaseConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export function getLocalDB(): Database.Database {
  if (db) return db;

  const dbPath = path.join(getBaseOutputDir(), "local-db.sqlite");
  db = new Database(dbPath);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_updated_at ON kv_store(updated_at);
  `);

  console.log("[LocalDB] 数据库初始化完成:", dbPath);
  return db;
}

export function localDBSet(key: string, value: string): void {
  if (isSupabaseConfigured()) {
    supabase.from("kv_store").upsert({
      key,
      value,
      updated_at: Date.now()
    }).throwOnError();
    return;
  }

  const database = getLocalDB();
  const stmt = database.prepare(`
    INSERT OR REPLACE INTO kv_store (key, value, updated_at)
    VALUES (?, ?, ?)
  `);
  stmt.run(key, value, Date.now());
}

export function localDBGet(key: string): string | null {
  if (isSupabaseConfigured()) {
    const { data } = supabase
      .from("kv_store")
      .select("value")
      .eq("key", key)
      .single();
    return data?.value ?? null;
  }

  const database = getLocalDB();
  const stmt = database.prepare("SELECT value FROM kv_store WHERE key = ?");
  const row = stmt.get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function localDBRemove(key: string): void {
  if (isSupabaseConfigured()) {
    supabase.from("kv_store").delete().eq("key", key).throwOnError();
    return;
  }

  const database = getLocalDB();
  const stmt = database.prepare("DELETE FROM kv_store WHERE key = ?");
  stmt.run(key);
}

export function localDBGetAll(): { key: string; value: string; updated_at: number }[] {
  if (isSupabaseConfigured()) {
    const { data } = supabase
      .from("kv_store")
      .select("key, value, updated_at")
      .order("updated_at", { ascending: false });
    return data || [];
  }

  const database = getLocalDB();
  const stmt = database.prepare("SELECT key, value, updated_at FROM kv_store ORDER BY updated_at DESC");
  return stmt.all() as { key: string; value: string; updated_at: number }[];
}

export function localDBClose(): void {
  if (db) {
    db.close();
    db = null;
  }
}