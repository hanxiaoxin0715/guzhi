import { supabase } from "./supabaseClient";

function isSupabaseConfigured(): boolean {
  return !!supabase;
}

export async function localDBSet(key: string, value: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  
  const { error } = await supabase!.from("kv_store").upsert({
    key,
    value,
    updated_at: Date.now()
  });
  if (error) console.error("[LocalDB] Supabase set error:", error);
}

export async function localDBGet(key: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  
  const { data } = await supabase!
    .from("kv_store")
    .select("value")
    .eq("key", key)
    .single();
  return data?.value ?? null;
}

export async function localDBRemove(key: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  
  const { error } = await supabase!.from("kv_store").delete().eq("key", key);
  if (error) console.error("[LocalDB] Supabase remove error:", error);
}

export async function localDBGetAll(): Promise<{ key: string; value: string; updated_at: number }[]> {
  if (!isSupabaseConfigured()) return [];
  
  const { data } = await supabase!
    .from("kv_store")
    .select("key, value, updated_at")
    .order("updated_at", { ascending: false });
  return data || [];
}

export function localDBClose(): void {}