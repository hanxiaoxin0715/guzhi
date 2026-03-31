// Consistency Control data model and helpers

import { kvLoad, kvSet, kvRemove } from "./kvDB";

export interface CharacterRef {
  id: string;
  name: string;
  description: string;
  aliases?: string[]; // Alternative names/synonyms for smart matching
  referenceImage?: string; // URL or data URI
  prompt?: string; // English prompt for MJ/SD (from extraction)
}

export interface SceneRef {
  id: string;
  name: string;
  description: string;
  aliases?: string[];
  referenceImage?: string;
  prompt?: string;
}

export interface PropRef {
  id: string;
  name: string;
  description: string;
  aliases?: string[];
  referenceImage?: string;
  prompt?: string;
}

export interface StyleConfig {
  artStyle: string;
  colorPalette: string;
  aspectRatio: "16:9" | "9:16";
  resolution: "1K" | "2K" | "4K";
  timeSetting: string; // 时代/世界观背景：如 "现代都市"、"古代中国"、"未来太空站"（不含具体时间段，时间由AI逐镜判断）
  additionalNotes: string;
  styleImage?: string; // User-uploaded style reference image (URL or data URI)
  stylePrompt?: string; // AI-identified style prompt from the uploaded image
  styleLocked?: boolean; // 🔒 When true, AI extraction / style analysis will NOT overwrite style fields
}

export interface ConsistencyProfile {
  characters: CharacterRef[];
  scenes: SceneRef[];
  props: PropRef[];
  style: StyleConfig;
}

const STORAGE_KEY = "feicai-consistency";
const GRID_IMAGES_KEY = "feicai-grid-images";
const PIPELINE_STATE_KEY = "feicai-pipeline-state";
const PROMPTS_KEY = "feicai-system-prompts";

/**
 * 判断 referenceImage 是否为有效图片引用。
 * 支持三种格式：data URL / HTTP URL / 本地 API URL（/api/ref-image?serve=xxx）
 */
export function isValidImageRef(url?: string): url is string {
  if (!url) return false;
  return url.startsWith("data:") || url.startsWith("http") || url.startsWith("/api/");
}

// ── Consistency Profile ──

/** Sync load from localStorage (for useState init / fallback). Will be empty after migration. */
export function loadConsistency(): ConsistencyProfile {
  if (typeof window === "undefined") return defaultProfile();
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const defaults = defaultProfile();
      return {
        ...defaults,
        ...parsed,
        characters: parsed.characters || defaults.characters,
        scenes: parsed.scenes || defaults.scenes,
        props: parsed.props || defaults.props,
        style: { ...defaults.style, ...parsed.style },
      };
    }
  } catch {
    /* ignore */
  }
  return defaultProfile();
}

/** Async load from IndexedDB (primary) with auto-migration from localStorage. */
export async function loadConsistencyAsync(): Promise<ConsistencyProfile> {
  if (typeof window === "undefined") return defaultProfile();
  try {
    const saved = await kvLoad(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const defaults = defaultProfile();
      return {
        ...defaults,
        ...parsed,
        characters: parsed.characters || defaults.characters,
        scenes: parsed.scenes || defaults.scenes,
        props: parsed.props || defaults.props,
        style: { ...defaults.style, ...parsed.style },
      };
    }
  } catch {
    /* ignore */
  }
  return defaultProfile();
}

/** Save to IndexedDB (primary). Fire-and-forget safe. */
export async function saveConsistency(profile: ConsistencyProfile) {
  // Clone and strip large data URLs to keep storage efficient
  // ★ 用 /api/ URL 引用替代空字符串，确保后续加载直接拿到有效图片引用
  //   URL 引用仅 ~40 字节，不影响 IDB 存储效率
  const stripped: ConsistencyProfile = JSON.parse(JSON.stringify(profile));
  const MAX_DATA_URL = 50_000; // ~37KB image
  const ts = Date.now(); // ★ 唯一时间戳 — 每次替换生成不同 URL，确保缓存击穿 + 合并检测
  if (stripped.style?.styleImage?.startsWith("data:") && stripped.style.styleImage.length > MAX_DATA_URL) {
    stripped.style.styleImage = `/api/ref-image?serve=style-image&_t=${ts}`;
  }
  for (const list of [stripped.characters, stripped.scenes, stripped.props] as { id: string; referenceImage?: string }[][]) {
    for (const item of list) {
      if (item.referenceImage?.startsWith("data:") && item.referenceImage.length > MAX_DATA_URL) {
        item.referenceImage = `/api/ref-image?serve=${encodeURIComponent(item.id)}&_t=${ts}`;
      }
    }
  }
  const strippedJson = JSON.stringify(stripped);
  // ★ 同步写 localStorage 缓存 — 确保同步版 loadConsistency() 也能拿到最新数据
  //   避免 Pipeline 重新挂载时 useState(loadConsistency) 读到旧的 localStorage 数据
  try { localStorage.setItem(STORAGE_KEY, strippedJson); } catch { /* localStorage 可能已满，忽略 */ }
  try {
    await kvSet(STORAGE_KEY, strippedJson);
  } catch (e1) {
    console.error("[saveConsistency] KV 保存失败（首次尝试），尝试剥离所有 data URL 图片:", e1);
    // Last resort: strip data URL images → replace with /api/ URL refs (tiny strings)
    if (stripped.style.styleImage?.startsWith("data:")) stripped.style.styleImage = `/api/ref-image?serve=style-image&_t=${ts}`;
    for (const list of [stripped.characters, stripped.scenes, stripped.props] as { id: string; referenceImage?: string }[][]) {
      for (const item of list) {
        if (item.referenceImage?.startsWith("data:")) {
          item.referenceImage = `/api/ref-image?serve=${encodeURIComponent(item.id)}&_t=${ts}`;
        }
      }
    }
    const fallbackJson = JSON.stringify(stripped);
    try { localStorage.setItem(STORAGE_KEY, fallbackJson); } catch { /* ignore */ }
    try { await kvSet(STORAGE_KEY, fallbackJson); } catch (e2) {
      console.error("[saveConsistency] KV 保存彻底失败（已剥离图片仍失败）:", e2);
    }
  }
}

/**
 * 将 Pipeline 提取结果直接持久化到 IndexedDB。
 * 不依赖 Studio 页面打开，确保刷新页面后数据不丢失。
 * 内部逻辑：加载当前 profile → 合并提取数据 → 保存回 KV。
 */
export async function persistExtractResult(data: {
  characters?: { name: string; description: string; prompt?: string; aliases?: string[] }[];
  scenes?: { name: string; description: string; prompt?: string; aliases?: string[] }[];
  props?: { name: string; description: string; prompt?: string; aliases?: string[] }[];
  style?: { artStyle?: string; colorPalette?: string; timeSetting?: string };
}): Promise<void> {
  try {
    const current = await loadConsistencyAsync();

    // 智能追加合并：按名称模糊匹配已有条目，保留参考图，★ 保留未匹配的已有条目（防止丢失手动添加的数据和参考图）
    function mergeItems<T extends { id: string; name: string; referenceImage?: string; prompt?: string; aliases?: string[] }>(
      existing: T[],
      extracted: { name: string; description: string; prompt?: string; aliases?: string[] }[],
      idPrefix: string
    ): T[] {
      const matchedExistingIds = new Set<string>();
      const result = extracted.map((newItem, i) => {
        const normalName = (newItem.name || "").toLowerCase().trim();
        const matched = normalName ? existing.find((old) => {
          if (matchedExistingIds.has(old.id)) return false; // 已被前面的条目匹配，跳过
          const oldName = (old.name || "").toLowerCase().trim();
          if (oldName === normalName) return true;
          // 「·」形态后缀拆分匹配
          const baseNew = normalName.split("·")[0].trim();
          const baseOld = oldName.split("·")[0].trim();
          if (baseNew.length >= 2 && baseOld.length >= 2 && baseNew === baseOld) return true;
          const shorter = oldName.length < normalName.length ? oldName : normalName;
          const longer = oldName.length >= normalName.length ? oldName : normalName;
          if (shorter.length < 2) return false;
          return longer.includes(shorter) && shorter.length >= longer.length * 0.3;
        }) : undefined;
        if (matched) matchedExistingIds.add(matched.id);
        return {
          id: matched?.id || `${idPrefix}-${Date.now()}-${i}`,
          name: newItem.name,
          description: newItem.description,
          prompt: newItem.prompt || "",
          aliases: newItem.aliases || [],
          referenceImage: matched?.referenceImage || undefined,
        } as unknown as T;
      });
      // ★ 保留未被匹配的已有条目（用户手动添加的角色/场景/道具 + 之前提取的未在新提取中出现的条目）
      const preserved = existing.filter(item => !matchedExistingIds.has(item.id));
      return [...result, ...preserved];
    }

    const updated: ConsistencyProfile = { ...current };
    if (data.characters?.length) updated.characters = mergeItems(current.characters, data.characters, "char");
    if (data.scenes?.length) updated.scenes = mergeItems(current.scenes, data.scenes, "scene");
    if (data.props?.length) updated.props = mergeItems(current.props, data.props, "prop");
    if (data.style && !updated.style.styleLocked) {
      updated.style = {
        ...updated.style,
        artStyle: data.style.artStyle || updated.style.artStyle,
        colorPalette: data.style.colorPalette || updated.style.colorPalette,
        timeSetting: updated.style.timeSetting || data.style.timeSetting || "",
      };
    }

    await saveConsistency(updated);
    console.log(`[persistExtractResult] ✓ 提取结果已直接持久化到 KV — 角色${updated.characters.length} 场景${updated.scenes.length} 道具${updated.props.length}`);
  } catch (e) {
    console.error("[persistExtractResult] 持久化失败:", e);
  }
}

export function defaultProfile(): ConsistencyProfile {
  return {
    characters: [],
    scenes: [],
    props: [],
    style: {
      artStyle: "真人写实电影风格",
      colorPalette: "冷蓝过渡到暖金",
      aspectRatio: "16:9",
      resolution: "4K",
      timeSetting: "",
      additionalNotes: "",
    },
  };
}

export function buildConsistencyContext(profile: ConsistencyProfile): string {
  const parts: string[] = [];

  // 截取 description 前 150 字符，防止中英同步长描述导致 context token 膨胀
  const brief = (s: string) => s.length > 150 ? s.slice(0, 150) + "…" : s;

  if (profile.characters.length > 0) {
    parts.push("【角色一致性要求 - 所有画面中同一角色外观必须严格保持一致】");
    for (const c of profile.characters) {
      parts.push(`- ${c.name}：${brief(c.description)}`);
    }
  }

  if (profile.scenes.length > 0) {
    parts.push("\n【场景一致性要求】");
    for (const s of profile.scenes) {
      parts.push(`- ${s.name}：${brief(s.description)}`);
    }
  }

  if (profile.props.length > 0) {
    parts.push("\n【道具一致性要求】");
    for (const p of profile.props) {
      parts.push(`- ${p.name}：${brief(p.description)}`);
    }
  }

  parts.push("\n【整体风格要求】");
  parts.push(`- 画幅：${profile.style.aspectRatio}`);
  parts.push(`- 分辨率：${profile.style.resolution || "4K"}`);
  if (profile.style.stylePrompt) {
    // stylePrompt may be JSON string — parse and format
    try {
      const sp = JSON.parse(profile.style.stylePrompt);
      if (sp.artStyle) parts.push(`- 画风：${sp.artStyle}`);
      if (sp.colorPalette) parts.push(`- 色调：${sp.colorPalette}`);
      if (sp.styleKeywords) parts.push(`- 风格关键词：${sp.styleKeywords}`);
      if (sp.mood) parts.push(`- 氛围：${sp.mood}`);
    } catch {
      parts.push(`- AI识别风格：${profile.style.stylePrompt}`);
    }
  } else {
    if (profile.style.artStyle) {
      parts.push(`- 画风：${profile.style.artStyle}`);
    }
    if (profile.style.colorPalette) {
      parts.push(`- 色调：${profile.style.colorPalette}`);
    }
  }
  if (profile.style.timeSetting) {
    parts.push(`- 时代/世界观背景：${profile.style.timeSetting}`);
  }
  if (profile.style.additionalNotes) {
    parts.push(`- 补充：${profile.style.additionalNotes}`);
  }

  return parts.join("\n");
}

/**
 * Collect reference image URLs from the profile for multimodal image generation.
 * Includes both HTTP URLs and data URLs (caller is responsible for compressing data URLs).
 * NOTE: Style image is intentionally EXCLUDED — it confuses the image model.
 *       Style guidance should only come from text prompts (artStyle/colorPalette).
 *       For the TEXT LLM pipeline, use collectReferenceImagesWithStyle() instead.
 */
export function collectReferenceImages(profile: ConsistencyProfile): string[] {
  const urls: string[] = [];

  // Style image intentionally NOT included as reference image.
  // Sending the style image to the image model confuses prompt interpretation.
  // Style guidance is provided via text (artStyle, colorPalette keywords in prompt).

  for (const c of profile.characters) {
    if (isValidImageRef(c.referenceImage)) urls.push(c.referenceImage);
  }
  for (const s of profile.scenes) {
    if (isValidImageRef(s.referenceImage)) urls.push(s.referenceImage);
  }
  for (const p of profile.props) {
    if (isValidImageRef(p.referenceImage)) urls.push(p.referenceImage);
  }
  return urls;
}

/**
 * Collect ALL reference images INCLUDING the style image.
 * The style image is placed FIRST so the text LLM sees it prominently
 * and can extract style tags (as required by Gem.txt system prompt).
 *
 * Use this for the TEXT LLM pipeline (nine-grid / four-grid generation),
 * where the LLM needs to "see" the art style to produce matching prompts.
 * Do NOT use this for the image model — use collectReferenceImages() instead.
 */
export function collectReferenceImagesWithStyle(profile: ConsistencyProfile): string[] {
  const urls: string[] = [];

  // Style image goes FIRST — Gem.txt instructs the LLM to extract style tags from reference images
  const si = profile.style?.styleImage;
  if (isValidImageRef(si)) {
    urls.push(si);
  }

  // Then character / scene / prop reference images
  for (const c of profile.characters) {
    if (isValidImageRef(c.referenceImage)) urls.push(c.referenceImage);
  }
  for (const s of profile.scenes) {
    if (isValidImageRef(s.referenceImage)) urls.push(s.referenceImage);
  }
  for (const p of profile.props) {
    if (isValidImageRef(p.referenceImage)) urls.push(p.referenceImage);
  }
  return urls;
}

// ═══════════════════════════════════════════════════════════
// Smart Reference Image Matching
// ═══════════════════════════════════════════════════════════

/**
 * Check if a consistency item (character/scene/prop) matches a given prompt text.
 * Strategy: aliases (exact substring) → name (substring) → description keywords (fallback).
 * Returns true if any match is found.
 */
export function itemMatchesPrompt(
  item: { name: string; aliases?: string[]; description: string },
  promptText: string
): boolean {
  const text = promptText.toLowerCase();

  // 1. Check aliases — highest confidence
  if (item.aliases && item.aliases.length > 0) {
    for (const alias of item.aliases) {
      if (alias.length >= 2 && text.includes(alias.toLowerCase())) return true;
    }
  }

  // 2. Check name — direct match
  if (item.name.length >= 2 && text.includes(item.name.toLowerCase())) return true;

  // 3. Fallback: extract keywords (≥2 chars) from description, check if any appear
  // Only if name and aliases didn't match — this catches "石雕" matching "石雕守卫" in description
  // 过滤高频停用词，防止中英同步长描述产生过多关键词导致误匹配
  const _stopwords = new Set([
    "一个", "一种", "进行", "可以", "通过", "其中", "作为", "以及", "或者",
    "具有", "位于", "用于", "成为", "属于", "来自", "关于", "之间", "之上",
    "画面", "背景", "环境", "整体", "效果", "风格", "采用", "呈现", "展现",
    "强调", "突出", "营造", "色调", "光影", "构图", "镜头", "特写", "广角",
    "的是", "这个", "那个", "什么", "怎么", "如何", "为了", "因为", "所以",
    "面板", "布局", "左侧", "右侧", "底部", "顶部", "中央", "上方", "下方",
    "包含", "显示", "设计", "部分", "区域", "参考", "细节", "质感", "纹理",
  ]);
  const descWords = item.description
    .replace(/[，。、！？；：""''（）\[\]【】\s]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 2 && !_stopwords.has(w));
  // Need at least 3 keyword matches (raised from 2) to reduce false positives with longer descriptions
  let descHits = 0;
  for (const word of descWords) {
    if (text.includes(word.toLowerCase())) {
      descHits++;
      if (descHits >= 3) return true;
    }
  }

  return false;
}

/**
 * Relaxed matching for scenes — used when standard `itemMatchesPrompt` finds no match.
 * Additional strategy:
 * 1. Partial name matching: check consecutive substrings from the START of the name (length ≥ 3)
 *    e.g., "天剑宗后山" → "天剑宗" could match if prompt mentions "天剑宗"
 *    ★ 仅从头部截取（不枚举所有子串），避免 "林风" 误匹配 "疾风" 等尾部重合
 * 2. Description keyword threshold: 2 hits (raised from 1 to reduce false positives)
 */
export function itemMatchesPromptRelaxed(
  item: { name: string; aliases?: string[]; description: string },
  promptText: string
): boolean {
  // Standard matching first
  if (itemMatchesPrompt(item, promptText)) return true;

  const text = promptText.toLowerCase();
  const name = item.name.toLowerCase();

  // ★ Partial name matching: only check prefixes of decreasing length (from name start)
  // e.g., "妖兽谷第二层" → try "妖兽谷第二", "妖兽谷第", "妖兽谷" — NOT "第二层", "二层" etc.
  if (name.length > 3) {
    for (let len = name.length - 1; len >= 3; len--) {
      if (text.includes(name.slice(0, len))) return true;
    }
  }

  // ★ Description keywords with threshold 2 (raised from 1 to prevent single-keyword false positives)
  const commonWords = new Set([
    "一个", "一种", "进行", "可以", "通过", "其中", "作为", "以及", "或者",
    "具有", "位于", "用于", "成为", "属于", "来自", "关于", "之间", "之上",
    "画面", "背景", "环境", "整体", "效果", "风格", "采用", "呈现", "展现",
    "强调", "突出", "营造", "色调", "光影", "构图", "镜头", "特写", "广角",
    "的是", "这个", "那个", "什么", "怎么", "如何", "为了", "因为", "所以",
    "面板", "布局", "左侧", "右侧", "底部", "顶部", "中央", "上方", "下方",
    "包含", "显示", "设计", "部分", "区域", "参考", "细节", "质感", "纹理",
  ]);
  const descWords = item.description
    .replace(/[，。、！？；：""''（）\[\]【】\s]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 2 && !commonWords.has(w));
  let descHits = 0;
  for (const word of descWords) {
    if (text.includes(word.toLowerCase())) {
      descHits++;
      if (descHits >= 2) return true;
    }
  }

  return false;
}

/**
 * Collect reference images that are relevant to the given prompt(s).
 * - Style image is intentionally EXCLUDED (it confuses the image model).
 * - Characters/scenes/props are only included if they match the prompt text.
 * - promptTexts can be a single prompt or array of prompts (e.g., all 9 grid prompts for nine-grid).
 */
export function collectMatchedReferenceImages(
  profile: ConsistencyProfile,
  promptTexts: string | string[]
): string[] {
  const urls: string[] = [];
  const combined = Array.isArray(promptTexts) ? promptTexts.join("\n") : promptTexts;

  // Style image intentionally NOT included as reference image.
  // Sending the style image to the image model confuses prompt interpretation.
  // Style guidance is provided via text (artStyle, colorPalette keywords in prompt).

  // Characters — match by name/aliases/description keywords
  for (const c of profile.characters) {
    if (isValidImageRef(c.referenceImage)) {
      if (itemMatchesPrompt(c, combined)) urls.push(c.referenceImage);
    }
  }

  // Scenes — match by name/aliases/description keywords
  for (const s of profile.scenes) {
    if (isValidImageRef(s.referenceImage)) {
      if (itemMatchesPrompt(s, combined)) urls.push(s.referenceImage);
    }
  }

  // Props — match by name/aliases/description keywords
  for (const p of profile.props) {
    if (isValidImageRef(p.referenceImage)) {
      if (itemMatchesPrompt(p, combined)) urls.push(p.referenceImage);
    }
  }

  return urls;
}

/**
 * Resolve an array of item IDs to their current reference image URLs.
 * Used by the ref-binding system: bindings store IDs (stable) → resolve to URLs (may change) at use time.
 * This ensures thumbnails and generation always use the LATEST uploaded image.
 */
export function resolveRefBindIds(profile: ConsistencyProfile, ids: string[]): string[] {
  if (ids.length === 0) return [];
  // Build a quick id→image lookup from all items
  const lookup = new Map<string, string>();
  for (const c of profile.characters) {
    if (isValidImageRef(c.referenceImage)) lookup.set(c.id, c.referenceImage);
  }
  for (const s of profile.scenes) {
    if (isValidImageRef(s.referenceImage)) lookup.set(s.id, s.referenceImage);
  }
  for (const p of profile.props) {
    if (isValidImageRef(p.referenceImage)) lookup.set(p.id, p.referenceImage);
  }
  // Resolve IDs → URLs, skip any that no longer exist or have no image
  const urls: string[] = [];
  for (const id of ids) {
    const url = lookup.get(id);
    if (url) urls.push(url);
  }
  return urls;
}

// ── Grid Images Storage ──
// Stores composite images and cropped cells
// key format: "nine-{ep}" for composite, "nine-{ep}-{idx}" for cell, "four-{ep}-{beat}" for composite, etc.

/** @deprecated Use loadGridImagesDB from imageDB.ts instead */
export function loadGridImages(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const saved = localStorage.getItem(GRID_IMAGES_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    /* ignore */
  }
  return {};
}

/** @deprecated Use saveGridImagesDB from imageDB.ts instead */
export function saveGridImages(images: Record<string, string>) {
  try {
    localStorage.setItem(GRID_IMAGES_KEY, JSON.stringify(images));
  } catch {
    // localStorage full — prune old entries
    const keys = Object.keys(images);
    if (keys.length > 20) {
      const trimmed: Record<string, string> = {};
      for (const k of keys.slice(-20)) trimmed[k] = images[k];
      localStorage.setItem(GRID_IMAGES_KEY, JSON.stringify(trimmed));
    }
  }
}

// ── Pipeline State Persistence ──

export interface PipelineState {
  stages: unknown[];
  logs: unknown[];
  imageUrl: string;
  episode: string;
  timestamp: number;
}

export function loadPipelineState(): PipelineState | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(PIPELINE_STATE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    /* ignore */
  }
  return null;
}

export async function loadPipelineStateAsync(): Promise<PipelineState | null> {
  if (typeof window === "undefined") return null;
  try {
    const saved = await kvLoad(PIPELINE_STATE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    /* ignore */
  }
  return null;
}

export async function savePipelineState(state: PipelineState) {
  await kvSet(PIPELINE_STATE_KEY, JSON.stringify(state));
}

// ── System Prompts Storage ──

export interface SystemPrompts {
  extract: string;
  nineGridGem: string;
  fourGridGem: string;
  styleAnalyze: string;
  upscale: string;
  [key: string]: string;
}

export const DEFAULT_PROMPTS: SystemPrompts = {
  extract: "",
  nineGridGem: "",
  fourGridGem: "",
  styleAnalyze: "",
  upscale: "",
};

export function loadSystemPrompts(): SystemPrompts {
  if (typeof window === "undefined") return { ...DEFAULT_PROMPTS };
  try {
    const saved = localStorage.getItem(PROMPTS_KEY);
    if (saved) return { ...DEFAULT_PROMPTS, ...JSON.parse(saved) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_PROMPTS };
}

export async function loadSystemPromptsAsync(): Promise<SystemPrompts> {
  if (typeof window === "undefined") return { ...DEFAULT_PROMPTS };
  try {
    const saved = await kvLoad(PROMPTS_KEY);
    if (saved) return { ...DEFAULT_PROMPTS, ...JSON.parse(saved) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_PROMPTS };
}

export async function saveSystemPrompts(prompts: SystemPrompts) {
  await kvSet(PROMPTS_KEY, JSON.stringify(prompts));
}

// ── Consistency Images ↔ IndexedDB ──
// Large images (style image, reference images) are saved to IndexedDB
// to avoid localStorage 5MB quota overflow. Text data stays in localStorage.

/**
 * Save consistency profile images to disk via /api/ref-image.
 * Plan B: disk as source of truth, memory retains data URLs.
 */
export async function saveConsistencyImages(profile: ConsistencyProfile): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  const saveToDisk = async (key: string, dataUrl: string) => {
    if (!dataUrl.startsWith("data:")) return; // 仅持久化 data URL
    try {
      await fetch("/api/ref-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, imageData: dataUrl }),
      });
    } catch { /* ignore */ }
  };

  // ★ 仅保存有图片的条目，不删除无图片条目的磁盘文件
  // 删除操作统一由 clearCurrentWorkspace() 和项目归档/还原处理
  // 避免 auto-save 在图片尚未加载到内存时误删磁盘文件
  if (profile.style.styleImage) {
    tasks.push(saveToDisk("style-image", profile.style.styleImage));
  }
  for (const c of profile.characters) {
    if (c.referenceImage) tasks.push(saveToDisk(c.id, c.referenceImage));
  }
  for (const s of profile.scenes) {
    if (s.referenceImage) tasks.push(saveToDisk(s.id, s.referenceImage));
  }
  for (const p of profile.props) {
    if (p.referenceImage) tasks.push(saveToDisk(p.id, p.referenceImage));
  }
  await Promise.all(tasks);
}

/**
 * Restore consistency profile images from disk via /api/ref-image.
 * Plan B: fetches images as data URLs and fills into the profile.
 * 
 * 增强：当精确 ID 匹配失败时，按前缀（char-/scene-/prop-）扫描磁盘文件，
 * 按创建顺序分配给缺图的条目，确保重新提取后 ID 变化不会导致参考图丢失。
 */
export async function restoreConsistencyImagesFromDisk(
  profile: ConsistencyProfile
): Promise<ConsistencyProfile> {
  const p: ConsistencyProfile = JSON.parse(JSON.stringify(profile));
  const keyMap: { key: string; target: "style" | "char" | "scene" | "prop"; id?: string }[] = [];

  // ★ 跳过已有有效 URL 引用的条目（/api/ 或 http 开头 = 已恢复或已设置）
  const needsRestore = (img?: string) => !img || (img.length < 200 && !img.startsWith("/api/") && !img.startsWith("http"));

  if (needsRestore(p.style.styleImage)) {
    keyMap.push({ key: "style-image", target: "style" });
  }
  // stylePrompt 仍用 data URL（JSON 很小）
  if (!p.style.stylePrompt) {
    keyMap.push({ key: "style-prompt", target: "style" });
  }
  for (const c of p.characters) {
    if (needsRestore(c.referenceImage)) {
      keyMap.push({ key: c.id, target: "char", id: c.id });
    }
  }
  for (const s of p.scenes) {
    if (needsRestore(s.referenceImage)) {
      keyMap.push({ key: s.id, target: "scene", id: s.id });
    }
  }
  for (const pr of p.props) {
    if (needsRestore(pr.referenceImage)) {
      keyMap.push({ key: pr.id, target: "prop", id: pr.id });
    }
  }

  if (keyMap.length === 0) return p;

  try {
    console.log(`[restoreConsistencyImages] 需恢复 ${keyMap.length} 个条目:`, keyMap.map(k => `${k.target}:${k.key}`));
    // ★ 轻量批量查询：只检查文件是否存在，不传输图片数据（避免 300MB+ JSON 响应）
    const res = await fetch(`/api/ref-image?keys=${encodeURIComponent(keyMap.map(k => k.key).join(","))}&check=1`);
    if (!res.ok) {
      console.warn("[restoreConsistencyImages] check API 失败:", res.status, res.statusText);
      return p;
    }
    const data = await res.json();
    console.log("[restoreConsistencyImages] check 响应:", JSON.stringify(data).substring(0, 500));

    // 兼容两种响应格式：新版 { exists: { key: boolean } } 和旧版 { images: { key: dataUrl } }
    const existsMap: Record<string, boolean> = data.exists || {};
    const imagesMap: Record<string, string | null> = data.images || {};
    const useUrlMode = !!data.exists; // 新版 URL 模式

    const unmatchedChars: typeof p.characters = [];
    const unmatchedScenes: typeof p.scenes = [];
    const unmatchedProps: typeof p.props = [];

    for (const km of keyMap) {
      const hasImage = useUrlMode ? existsMap[km.key] : !!imagesMap[km.key];
      if (!hasImage) {
        if (km.target === "char") {
          const item = p.characters.find(c => c.id === km.id);
          if (item) unmatchedChars.push(item);
        } else if (km.target === "scene") {
          const item = p.scenes.find(s => s.id === km.id);
          if (item) unmatchedScenes.push(item);
        } else if (km.target === "prop") {
          const item = p.props.find(pr => pr.id === km.id);
          if (item) unmatchedProps.push(item);
        }
        continue;
      }

      // ★ 使用 HTTP URL 引用而非 data URL，浏览器按需加载图片
      const imgValue = useUrlMode
        ? `/api/ref-image?serve=${encodeURIComponent(km.key)}`
        : imagesMap[km.key]!;

      if (km.key === "style-image") {
        p.style.styleImage = imgValue;
      } else if (km.key === "style-prompt") {
        // stylePrompt 需要解析 JSON 内容，必须用 data URL
        const promptDataUrl = useUrlMode ? null : imagesMap[km.key];
        if (promptDataUrl) {
          try {
            const base64 = promptDataUrl.split(",")[1];
            const json = decodeURIComponent(escape(atob(base64)));
            const parsed = JSON.parse(json);
            if (parsed.stylePrompt) p.style.stylePrompt = parsed.stylePrompt;
          } catch { /* ignore */ }
        }
        // URL 模式下单独获取 stylePrompt
        if (useUrlMode) {
          try {
            const spRes = await fetch(`/api/ref-image?key=style-prompt`);
            if (spRes.ok) {
              const spData = await spRes.json();
              if (spData.imageData) {
                const base64 = spData.imageData.split(",")[1];
                const json = decodeURIComponent(escape(atob(base64)));
                const parsed = JSON.parse(json);
                if (parsed.stylePrompt) p.style.stylePrompt = parsed.stylePrompt;
              }
            }
          } catch { /* ignore */ }
        }
      } else {
        const charItem = p.characters.find(c => c.id === km.id);
        if (charItem) { charItem.referenceImage = imgValue; continue; }
        const sceneItem = p.scenes.find(s => s.id === km.id);
        if (sceneItem) { sceneItem.referenceImage = imgValue; continue; }
        const propItem = p.props.find(pr => pr.id === km.id);
        if (propItem) { propItem.referenceImage = imgValue; continue; }
      }
    }

    const hasUnmatched = unmatchedChars.length > 0 || unmatchedScenes.length > 0 || unmatchedProps.length > 0;
    if (hasUnmatched) {
      console.log(`[restoreConsistencyImages] ${unmatchedChars.length} 角色 + ${unmatchedScenes.length} 场景 + ${unmatchedProps.length} 道具 缺图（ID 变化），跳过回退匹配。请通过角色库手动导入参考图。`);
    }

    // 统计恢复结果
    const restoredCount = keyMap.filter(km => {
      if (km.key === "style-image") return isValidImageRef(p.style.styleImage);
      if (km.key === "style-prompt") return !!p.style.stylePrompt;
      const item = [...p.characters, ...p.scenes, ...p.props].find(i => i.id === km.id);
      return item && isValidImageRef(item.referenceImage);
    }).length;
    console.log(`[restoreConsistencyImages] 恢复完成: ${restoredCount}/${keyMap.length} 个条目成功恢复图片`);

    // ★ 回写 URL 引用到 IndexedDB — 后续加载直接读取，不再重复查磁盘
    if (restoredCount > 0) {
      saveConsistency(p).catch(() => {});
    }
  } catch (e) {
    console.warn("[restoreConsistencyImages] 磁盘恢复失败:", e);
  }

  return p;
}

/**
 * @deprecated 已被 restoreConsistencyImagesFromDisk 取代。保留供归档恢复使用。
 * Restore consistency profile images from an IndexedDB images map.
 */
export function restoreConsistencyImages(
  profile: ConsistencyProfile,
  allImages: Record<string, string>
): ConsistencyProfile {
  const p: ConsistencyProfile = JSON.parse(JSON.stringify(profile));
  // Only restore style image if the saved profile has a non-empty placeholder
  // (empty string "" means intentionally cleared, undefined means never set or stripped)
  if (allImages["cst-style"] && !p.style.styleImage) {
    // Check if this was intentionally cleared: saveConsistency strips large images to "",
    // but if the saved value is exactly "" it could be intentional deletion.
    // We rely on the IndexedDB key being deleted by saveConsistencyImages when cleared.
    // If the key still exists in allImages, it means it wasn't cleared — restore it.
    p.style.styleImage = allImages["cst-style"];
  }
  for (const c of p.characters) {
    const img = allImages[`cst-ref-${c.id}`];
    if (img && (!c.referenceImage || !c.referenceImage.startsWith("data:"))) c.referenceImage = img;
  }
  for (const s of p.scenes) {
    const img = allImages[`cst-ref-${s.id}`];
    if (img && (!s.referenceImage || !s.referenceImage.startsWith("data:"))) s.referenceImage = img;
  }
  for (const pr of p.props) {
    const img = allImages[`cst-ref-${pr.id}`];
    if (img && (!pr.referenceImage || !pr.referenceImage.startsWith("data:"))) pr.referenceImage = img;
  }
  return p;
}

// ── 提取数据导出到 outputs 文件 ──

/**
 * 将角色/场景/道具提取数据格式化为 Markdown 并写入 outputs 目录。
 * 在 AI 提取完成后自动调用，用户也可手动触发。
 */
export async function exportConsistencyToFile(profile: ConsistencyProfile): Promise<boolean> {
  try {
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const lines: string[] = [];
    lines.push(`# 前置设定提取数据`);
    lines.push(`> 导出时间：${ts}`);
    lines.push("");

    // 风格
    if (profile.style.artStyle || profile.style.colorPalette || profile.style.timeSetting) {
      lines.push(`## 🎨 风格设定`);
      if (profile.style.artStyle) lines.push(`- **画风**：${profile.style.artStyle}`);
      if (profile.style.colorPalette) lines.push(`- **色调**：${profile.style.colorPalette}`);
      if (profile.style.timeSetting) lines.push(`- **时代背景**：${profile.style.timeSetting}`);
      if (profile.style.stylePrompt) lines.push(`- **风格提示词**：${profile.style.stylePrompt}`);
      lines.push(`- **画幅**：${profile.style.aspectRatio} · ${profile.style.resolution}`);
      lines.push("");
    }

    // 角色
    if (profile.characters.length > 0) {
      lines.push(`## 👤 角色（${profile.characters.length}个）`);
      lines.push("");
      for (const c of profile.characters) {
        lines.push(`### ${c.name}`);
        if (c.aliases?.length) lines.push(`- **别名**：${c.aliases.join("、")}`);
        lines.push(`- **描述**：${c.description}`);
        if (c.prompt) lines.push(`- **提示词**：${c.prompt}`);
        const hasRef = isValidImageRef(c.referenceImage);
        lines.push(`- **参考图**：${hasRef ? "✅ 已上传" : "❌ 未上传"}`);
        lines.push("");
      }
    }

    // 场景
    if (profile.scenes.length > 0) {
      lines.push(`## 🏞️ 场景（${profile.scenes.length}个）`);
      lines.push("");
      for (const s of profile.scenes) {
        lines.push(`### ${s.name}`);
        if (s.aliases?.length) lines.push(`- **别名**：${s.aliases.join("、")}`);
        lines.push(`- **描述**：${s.description}`);
        if (s.prompt) lines.push(`- **提示词**：${s.prompt}`);
        const hasRef = isValidImageRef(s.referenceImage);
        lines.push(`- **参考图**：${hasRef ? "✅ 已上传" : "❌ 未上传"}`);
        lines.push("");
      }
    }

    // 道具
    if (profile.props.length > 0) {
      lines.push(`## 🔧 道具（${profile.props.length}个）`);
      lines.push("");
      for (const p of profile.props) {
        lines.push(`### ${p.name}`);
        if (p.aliases?.length) lines.push(`- **别名**：${p.aliases.join("、")}`);
        lines.push(`- **描述**：${p.description}`);
        if (p.prompt) lines.push(`- **提示词**：${p.prompt}`);
        const hasRef = isValidImageRef(p.referenceImage);
        lines.push(`- **参考图**：${hasRef ? "✅ 已上传" : "❌ 未上传"}`);
        lines.push("");
      }
    }

    const content = lines.join("\n");
    const filename = "前置设定-提取数据.md";

    const res = await fetch("/api/outputs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ name: filename, content }] }),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    console.log(`[exportConsistency] ✓ 提取数据已导出到 outputs/${filename}`);
    return true;
  } catch (e) {
    console.error("[exportConsistency] 导出失败:", e);
    return false;
  }
}
