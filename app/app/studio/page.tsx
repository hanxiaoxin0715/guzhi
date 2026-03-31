"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../components/Toast";
import { useTaskQueue } from "../lib/taskQueue";
import Sidebar from "../components/Sidebar";
import {
  Sparkles, Grid3X3, Grid2X2, Download, Upload, Image as ImageIcon,
  Copy, Eye, Loader, Plus, Trash2, Wand2, ChevronDown, ChevronRight,
  User, Mountain, Sword, Palette, Play, ZoomIn, ArrowRight, RefreshCw,
  X, Maximize2, EyeOff, Lock, Link2, Pencil, FileText, Bot, Square, AlertTriangle, Languages,
  LayoutGrid, Undo2,
} from "lucide-react";
import {
  ConsistencyProfile, loadConsistency, loadConsistencyAsync, saveConsistency, defaultProfile,
  buildConsistencyContext, collectReferenceImages, loadSystemPrompts, loadSystemPromptsAsync,
  saveConsistencyImages, restoreConsistencyImagesFromDisk, resolveRefBindIds, itemMatchesPrompt, itemMatchesPromptRelaxed,
  isValidImageRef, exportConsistencyToFile,
} from "../lib/consistency";
import { kvLoad, kvSet, kvKeysByPrefix } from "../lib/kvDB";
import { migrateFromLocalStorage } from "../lib/imageDB";
import { loadGridImageUrlsFromDisk, saveGridImagesToDisk, saveOneGridImageToDisk, gridImageUrl, deleteGridImageFromDisk } from "../lib/gridImageStore";
import { loadScriptsDB, migrateScriptsFromLocalStorage } from "../lib/scriptDB";
import { UPSCALE_PROMPT } from "../lib/defaultPrompts";
import { usePipeline } from "../lib/pipelineContext";
import RefBindPanel, { type RefBindTarget, type EpisodeMentions } from "../components/RefBindPanel";
import ImageEditModal, { type ImageEditRequest } from "../components/ImageEditModal";
import CharacterLibrary, { type ImportItem } from "../components/CharacterLibrary";
import ImageFusionModal, { type FusionImageItem } from "../components/ImageFusionModal";
import ImageSourcePicker from "../components/ImageSourcePicker";
import JimengFAB from "../components/JimengFAB";
import JimengPickerModal, { type JimengPickerResult } from "../components/JimengPickerModal";
import { getJimengTaskStore } from "../lib/jimeng-image/clientTaskStore";
import type { JimengClientTask } from "../lib/jimeng-image/clientTaskStore";
import { JIMENG_IMAGE_MODEL_OPTIONS, type JimengImageModelId, type JimengImageResolution } from "../lib/jimeng-image/types";

// ═══════════════════════════════════════════════════════════
// Prompt Parsers
// ═══════════════════════════════════════════════════════════

/**
 * Extract JSON from markdown code block (```json ... ```) or raw JSON string.
 * Robust: strips BOM/zero-width chars, extracts by first '{' / last '}',
 * removes trailing commas — mirrors parseGemJson logic.
 * Returns null if content is not valid JSON.
 */
function tryParseJsonContent(content: string): unknown | null {
  let s = content.trim();
  // Remove BOM / zero-width chars
  s = s.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "");
  // Strip ```json ... ``` wrapper if present
  const codeBlockMatch = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) s = codeBlockMatch[1].trim();
  // Find the JSON object/array boundaries (handles leading/trailing text from LLM)
  const firstBrace = s.indexOf("{");
  const firstBracket = s.indexOf("[");
  let start = -1;
  let end = -1;
  if (firstBrace >= 0 && (firstBracket < 0 || firstBrace <= firstBracket)) {
    start = firstBrace;
    end = s.lastIndexOf("}");
  } else if (firstBracket >= 0) {
    start = firstBracket;
    end = s.lastIndexOf("]");
  }
  if (start < 0 || end <= start) return null;
  s = s.slice(start, end + 1);
  // Remove trailing commas before ] or }
  s = s.replace(/,\s*([\]}])/g, "$1");
  try { return JSON.parse(s); } catch { return null; }
}

function parseNineGridPrompts(content: string): string[] {
  const sections: string[] = [];

  // ★ JSON format: { shots: [{ shot_number, prompt_text, description }] }
  const json = tryParseJsonContent(content) as { shots?: { prompt_text?: string; description?: string }[] } | null;
  if (json && Array.isArray(json.shots) && json.shots.length > 0) {
    for (let i = 0; i < Math.min(json.shots.length, 9); i++) {
      const shot = json.shots[i];
      const desc = shot.description || "";
      const imgPrompt = shot.prompt_text || "";
      // Format as "description\n\n**[IMG]** prompt_text" so extractImagePrompt() works
      if (imgPrompt) {
        sections.push(desc ? `${desc}\n\n**[IMG]** ${imgPrompt}` : `**[IMG]** ${imgPrompt}`);
      } else {
        sections.push(desc);
      }
    }
    while (sections.length < 9) sections.push("");
    return sections;
  }

  // Split by ## 📍 格N or ## 格N (with or without emoji)
  const parts = content.split(/^##[^\n]*格\s*\d+[^\n]*/m);
  if (parts.length > 1) {
    for (let i = 1; i < parts.length && i <= 9; i++) {
      const raw = parts[i].split(/^---/m)[0].split(/^##(?!#)/m)[0].trim();
      if (raw) sections.push(raw);
    }
  }
  // Fallback: numbered format like 1（第1行左）——
  if (sections.length === 0) {
    const panelParts = content.split(/\d+（第\d+行[左中右]）——/);
    for (let i = 1; i < panelParts.length && i <= 9; i++) {
      sections.push(panelParts[i].split(/\d+（第\d+行/)[0]?.trim() || panelParts[i].trim());
    }
  }
  // Fallback: plain numbered like 1（ or N（ without row reference
  if (sections.length === 0) {
    const numParts = content.split(/(?:^|\n)\d+[（(]/);
    for (let i = 1; i < numParts.length && i <= 9; i++) {
      sections.push(numParts[i].split(/\d+[（(]/)[0]?.trim() || numParts[i].trim());
    }
  }
  // Pad to exactly 9 items so grid always has correct count
  while (sections.length < 9 && sections.length > 0) sections.push("");
  return sections;
}

function parseFourGridGroups(content: string): string[][] {
  const groups: string[][] = [];

  // ★ JSON format: { shots: [{ shot_number, prompt_text, description }] }
  // Pipeline now generates 9 groups × 4 shots = 36 shots per episode.
  // shots[0..3] = group 1 (nine-grid cell 1 expansion), shots[4..7] = group 2, etc.
  // Also handles legacy format with only 4 shots (single group).
  const json = tryParseJsonContent(content) as {
    shots?: { prompt_text?: string; description?: string }[];
    groups?: { shots?: { prompt_text?: string; description?: string }[] }[];
  } | null;

  if (json) {
    // Format A: { groups: [{ shots: [...] }, ...] } — explicit groups array
    if (Array.isArray(json.groups) && json.groups.length > 0) {
      for (const grp of json.groups) {
        if (!Array.isArray(grp.shots) || grp.shots.length === 0) continue;
        const scenes: string[] = [];
        for (let i = 0; i < Math.min(grp.shots.length, 4); i++) {
          const shot = grp.shots[i];
          const desc = shot.description || "";
          const imgPrompt = shot.prompt_text || "";
          if (imgPrompt) {
            scenes.push(desc ? `${desc}\n\n**[IMG]** ${imgPrompt}` : `**[IMG]** ${imgPrompt}`);
          } else {
            scenes.push(desc);
          }
        }
        while (scenes.length < 4) scenes.push("");
        groups.push(scenes);
      }
      if (groups.length > 0) return groups;
    }

    // Format B: { shots: [...] } — flat array, split into groups of 4
    if (Array.isArray(json.shots) && json.shots.length > 0) {
      const totalShots = json.shots.length;
      const numGroups = Math.ceil(totalShots / 4);
      for (let g = 0; g < numGroups && g < 9; g++) {
        const scenes: string[] = [];
        for (let i = 0; i < 4; i++) {
          const idx = g * 4 + i;
          if (idx >= totalShots) { scenes.push(""); continue; }
          const shot = json.shots[idx];
          const desc = shot.description || "";
          const imgPrompt = shot.prompt_text || "";
          if (imgPrompt) {
            scenes.push(desc ? `${desc}\n\n**[IMG]** ${imgPrompt}` : `**[IMG]** ${imgPrompt}`);
          } else {
            scenes.push(desc);
          }
        }
        while (scenes.length < 4) scenes.push("");
        groups.push(scenes);
      }
      return groups;
    }
  }

  // Split by ## 📍 组N or ## 组N or ## 格N展开 or ## 格N (bare — AI sometimes outputs this instead of 组N)
  const parts = content.split(/^##[^\n]*(?:格\s*\d+\s*展开|组\s*\d+|格\s*\d+)[^\n]*/m);
  for (let i = 1; i < parts.length && i <= 9; i++) {
    const raw = parts[i].split(/^---/m)[0].split(/^##(?!#)/m)[0].trim();
    const scenes: string[] = [];
    // Match ### 1（左上） or ### 1( or just ### 1 (no label)
    const sceneParts = raw.split(/^###\s*\d+[^\n]*/m);
    for (let j = 1; j < sceneParts.length && j <= 4; j++) {
      const s = sceneParts[j].trim();
      if (s) scenes.push(s);
    }
    // Fallback: N（左上）—— format
    if (scenes.length === 0) {
      const altParts = raw.split(/\d+[（(][左右上下]+[）)](?:——)?/);
      for (let j = 1; j < altParts.length && j <= 4; j++) {
        const s = altParts[j].trim();
        if (s) scenes.push(s);
      }
    }
    // Pad each group to exactly 4 scenes so four-grid always has correct count
    while (scenes.length < 4 && scenes.length > 0) scenes.push("");
    groups.push(scenes);
  }
  return groups;
}

// ═══════════════════════════════════════════════════════════
// Resolution → max pixel size mapping
// ═══════════════════════════════════════════════════════════

function getMaxCellSizeForResolution(resolution?: string): number {
  switch (resolution) {
    case "4K": return 4096;
    case "2K": return 2048;
    default:   return 1024; // 1K
  }
}

// ═══════════════════════════════════════════════════════════
// HTTP URL → Data URL (prevent image expiry)
// ═══════════════════════════════════════════════════════════

/**
 * Convert an HTTP image URL to a data URL by fetching the raw bytes.
 * This persists the image locally so it survives URL expiry.
 * Uses FileReader.readAsDataURL to preserve original bytes (no re-encoding).
 */
async function httpUrlToDataUrl(url: string): Promise<string> {
  try {
    const timeoutSignal = AbortSignal.timeout(30000); // 30s timeout
    // Try direct fetch first
    let resp: Response;
    try {
      resp = await fetch(url, { signal: timeoutSignal });
      if (!resp.ok) throw new Error("direct failed");
    } catch {
      // Fallback to server proxy for CORS-restricted URLs
      resp = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`, { signal: timeoutSignal });
      if (!resp.ok) return url; // give up, return original HTTP URL
    }
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    console.warn("[httpUrlToDataUrl] failed for", url.slice(0, 80));
    return url; // fallback: return original
  }
}

// ═══════════════════════════════════════════════════════════
// Canvas Crop Utility
// ═══════════════════════════════════════════════════════════

/**
 * Crop a composite image into rows×cols cells.
 * Fixes:
 * 1. Remote URLs → fetch as blob first to avoid CORS-tainted canvas
 * 2. JPEG 0.98 output — visually lossless while keeping data URLs manageable
 * 3. Scale down cells exceeding maxCellSize (resolution-aware) to keep data URLs small
 * 4. try/catch inside onload to prevent Promise from never settling
 */
interface CropResult { cells: string[]; cellWidth: number; cellHeight: number; format: string; }

function cropImageGrid(imageUrl: string, rows: number, cols: number, maxCellSize = 1024): Promise<CropResult> {
  return new Promise((resolve, reject) => {
    (async () => {
      let objectUrl: string | null = null;
      let imgSrc = imageUrl;

      // For HTTP URLs, fetch as blob → objectURL to bypass CORS canvas taint
      if (imageUrl.startsWith("http")) {
        try {
          const resp = await fetch(imageUrl);
          const blob = await resp.blob();
          objectUrl = URL.createObjectURL(blob);
          imgSrc = objectUrl;
        } catch {
          // Direct fetch failed (CORS), try server proxy
          try {
            const proxyResp = await fetch(`/api/proxy-image?url=${encodeURIComponent(imageUrl)}`);
            if (proxyResp.ok) {
              const blob = await proxyResp.blob();
              objectUrl = URL.createObjectURL(blob);
              imgSrc = objectUrl;
            }
          } catch { /* fall back to direct image load */ }
        }
      }

      const img = new window.Image();
      // Only set crossOrigin if still loading from HTTP (no objectUrl fallback)
      if (!objectUrl && imageUrl.startsWith("http")) {
        img.crossOrigin = "anonymous";
      }

      img.onload = () => {
        try {
          const srcCellW = Math.floor(img.width / cols);
          const srcCellH = Math.floor(img.height / rows);

          console.log(`[cropImageGrid] composite: ${img.width}×${img.height}, each cell: ${srcCellW}×${srcCellH}, maxCellSize: ${maxCellSize}`);

          // Scale down if cell exceeds maxCellSize to avoid huge data URLs
          let outW = srcCellW;
          let outH = srcCellH;
          if (outW > maxCellSize || outH > maxCellSize) {
            const scale = Math.min(maxCellSize / outW, maxCellSize / outH);
            outW = Math.round(outW * scale);
            outH = Math.round(outH * scale);
            console.log(`[cropImageGrid] scaled down to ${outW}×${outH}`);
          }

          const cells: string[] = [];
          const canvas = document.createElement("canvas");
          canvas.width = outW;
          canvas.height = outH;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            return reject(new Error("Canvas context failed"));
          }

          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              ctx.clearRect(0, 0, outW, outH);
              ctx.drawImage(img, c * srcCellW, r * srcCellH, srcCellW, srcCellH, 0, 0, outW, outH);
              // PNG 无损 for cells ≤2048px; JPEG 0.98 for larger cells to avoid >10MB data URLs
              if (outW <= 2048 && outH <= 2048) {
                cells.push(canvas.toDataURL("image/png"));
              } else {
                cells.push(canvas.toDataURL("image/jpeg", 0.98));
              }
            }
          }

          console.log(`[cropImageGrid] cropped ${cells.length} cells, first cell size: ${(cells[0].length / 1024).toFixed(0)}KB`);

          const fmt = (outW <= 2048 && outH <= 2048) ? "PNG" : "JPEG";
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          resolve({ cells, cellWidth: outW, cellHeight: outH, format: fmt });
        } catch (e) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          reject(e instanceof Error ? e : new Error("Canvas crop failed"));
        }
      };

      img.onerror = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        reject(new Error("Image load failed"));
      };

      img.src = imgSrc;
    })().catch(reject);
  });
}

/**
 * Stitch individual cell images back into a single grid composite (preserving original pixel sizes).
 * Loads each cell, draws them onto a canvas in row-major order, returns a PNG data URL.
 */
function stitchGridImages(cellUrls: string[], rows: number, cols: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const total = rows * cols;
    const urls = cellUrls.slice(0, total);
    if (urls.length === 0) return reject(new Error("No cell images to stitch"));

    // Load all cell images in parallel
    let loaded = 0;
    let errored = false;
    const imgs: (HTMLImageElement | null)[] = new Array(total).fill(null);

    urls.forEach((url, i) => {
      if (!url) { loaded++; return; }
      const img = new window.Image();
      img.onload = () => {
        imgs[i] = img;
        loaded++;
        if (loaded >= urls.length && !errored) finish();
      };
      img.onerror = () => {
        if (!errored) { errored = true; reject(new Error(`Failed to load cell ${i}`)); }
      };
      img.src = url;
    });

    if (urls.every(u => !u)) return reject(new Error("All cells are empty"));

    function finish() {
      // Find first non-null image to determine cell dimensions
      const sample = imgs.find(Boolean);
      if (!sample) return reject(new Error("No valid cell images"));
      const cellW = sample.width;
      const cellH = sample.height;

      const canvas = document.createElement("canvas");
      canvas.width = cellW * cols;
      canvas.height = cellH * rows;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas context failed"));

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const img = imgs[idx];
          if (img) {
            ctx.drawImage(img, c * cellW, r * cellH, cellW, cellH);
          }
        }
      }

      // PNG for ≤8K total, JPEG 0.98 for larger
      const totalPx = canvas.width * canvas.height;
      const dataUrl = totalPx <= 8192 * 8192
        ? canvas.toDataURL("image/png")
        : canvas.toDataURL("image/jpeg", 0.98);
      console.log(`[stitchGridImages] ${cols}×${rows} grid, ${canvas.width}×${canvas.height}px, ~${(dataUrl.length / 1024).toFixed(0)}KB`);
      resolve(dataUrl);
    }
  });
}

// ═══════════════════════════════════════════════════════════
// Download Utility — works for both data URLs and HTTP URLs
// ═══════════════════════════════════════════════════════════

/** Detect actual image format from data URL and return proper file extension */
function getImageExtension(url: string): string {
  if (url.startsWith("data:image/png")) return ".png";
  if (url.startsWith("data:image/webp")) return ".webp";
  if (url.startsWith("data:image/jpeg") || url.startsWith("data:image/jpg")) return ".jpg";
  if (url.startsWith("data:image/gif")) return ".gif";
  // HTTP URLs: try to detect from extension
  if (url.startsWith("http")) {
    const lower = url.toLowerCase();
    if (lower.includes(".png")) return ".png";
    if (lower.includes(".webp")) return ".webp";
    if (lower.includes(".gif")) return ".gif";
    if (lower.includes(".jpg") || lower.includes(".jpeg")) return ".jpg";
  }
  return ".png"; // default
}

/** Replace the extension in a filename to match the actual image format */
function fixDownloadFilename(filename: string, imageUrl: string): string {
  const ext = getImageExtension(imageUrl);
  return filename.replace(/\.[^.]+$/, ext);
}

// ═══════════════════════════════════════════════════════════
// Reference Image Server Persistence (Plan A)
// Save ref images to outputs/ref-images/ for 100% reliability
// ═══════════════════════════════════════════════════════════

/** Persist a reference image to the server file system */
async function persistRefImage(key: string, dataUrl: string): Promise<boolean> {
  if (!dataUrl || (!dataUrl.startsWith("data:") && !dataUrl.startsWith("http"))) return false;
  // Only persist data URLs (HTTP URLs are temporary and unreliable)
  if (!dataUrl.startsWith("data:")) return false;
  const sizeKB = Math.round(dataUrl.length / 1024);
  try {
    const res = await fetch("/api/ref-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, imageData: dataUrl }),
    });
    if (res.ok) {
      const result = await res.json().catch(() => ({}));
      console.log(`[persistRefImage] ✓ saved ${key} (${sizeKB}KB → disk ${result.sizeKB || "?"}KB, skipped=${result.skipped || false})`);
      return true;
    }
    const errBody = await res.text().catch(() => "");
    console.error(`[persistRefImage] ✗ server returned ${res.status} for ${key} (${sizeKB}KB): ${errBody.slice(0, 200)}`);
    return false;
  } catch (e) {
    console.error(`[persistRefImage] ✗ network error for ${key} (${sizeKB}KB):`, e);
    return false;
  }
}

/** Fuzzy-match two image data URLs: same if exact match OR (both data:, length within 5%, last 100 base64 chars identical) */
function fuzzyMatchImage(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a.startsWith("data:") || !b.startsWith("data:")) return false;
  if (b.length === 0) return false;
  const lenRatio = a.length / b.length;
  if (lenRatio < 0.95 || lenRatio > 1.05) return false;
  return a.slice(-100) === b.slice(-100);
}

// ═══════════════════════════════════════════════════════════
// Grid Image Persistence — Plan C: 磁盘为真实来源
// 写入由 gridImageStore.ts 中的 saveGridImagesToDisk 完成
// persistGridImagesToLocal 已移除——所有写入改为 await saveGridImagesToDisk
// ═══════════════════════════════════════════════════════════

// Compress/resize image to reduce data URL size for API calls
/**
 * Compress a data URL (or same-origin URL) image to fit within maxDim and maxBytes.
 * First scales to maxDim, then iteratively reduces JPEG quality if the
 * resulting data URL exceeds maxBytes (default ~1MB base64 ≈ ~750KB raw).
 */
function compressImage(dataUrl: string, maxDim = 1024, quality = 0.8, maxBytes = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    // 远程 URL 需要 crossOrigin 才能让 canvas.toDataURL() 正常工作
    if (!dataUrl.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0, w, h);

      // Iteratively reduce quality until data URL fits within maxBytes
      let q = quality;
      let result = canvas.toDataURL("image/jpeg", q);
      while (result.length > maxBytes && q > 0.3) {
        q -= 0.1;
        result = canvas.toDataURL("image/jpeg", q);
      }
      // If still too large after quality reduction, reduce dimensions further
      if (result.length > maxBytes && (w > 512 || h > 512)) {
        const shrink = Math.min(512 / w, 512 / h, 1);
        const sw = Math.round(w * shrink), sh = Math.round(h * shrink);
        canvas.width = sw;
        canvas.height = sh;
        ctx.drawImage(img, 0, 0, sw, sh);
        result = canvas.toDataURL("image/jpeg", 0.6);
      }
      if (q < quality) {
        console.log(`[compressImage] reduced quality ${quality}→${q.toFixed(1)}, ${(result.length / 1024).toFixed(0)}KB data URL`);
      }
      resolve(result);
    };
    img.onerror = () => reject(new Error("图片加载失败，无法压缩"));
    img.src = dataUrl;
  });
}

/**
 * Compose a vertical (top-bottom) reference image sheet from at most 2 images.
 * Layout rule:
 *   1 image  → original pixels + label, clamp to 4K
 *   2 images → vertically stacked (上下组合), width normalised to the wider one
 * Uses original pixel sizes, then down-scales so longest edge ≤ 2048px (Gemini-friendly).
 * Text labels are burned directly into the image pixels.
 */
const MAX_SHEET_PX = 2048; // Gemini-friendly long-edge limit (was 3840 4K)

async function composeRefImageSheet(
  items: { dataUrl: string; name: string }[],
  typeLabel: string,
): Promise<string> {
  if (items.length === 0) return "";

  // Load all images in parallel
  const loadedImages = await Promise.all(
    items.map(item => new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image for ${item.name}`));
      img.src = item.dataUrl;
    }))
  );

  const labelH = 36; // px for text label band at bottom of each image

  if (items.length === 1) {
    // Single image — draw at original size with label band, then clamp to 2048px
    const img = loadedImages[0];
    const rawW = img.width;
    const rawH = img.height + labelH;
    const canvas = document.createElement("canvas");
    canvas.width = rawW;
    canvas.height = rawH;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, rawW, rawH);
    ctx.drawImage(img, 0, 0);
    // Label
    ctx.fillStyle = "rgba(0,0,0,0.8)";
    ctx.fillRect(0, img.height, rawW, labelH);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px Arial, Helvetica, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${typeLabel}: ${items[0].name}`, rawW / 2, img.height + labelH / 2, rawW - 16);

    return downscaleTo4K(canvas, `${typeLabel}(1)`);
  }

  // Two images — vertically stacked (上下), normalise width to the wider one
  const [imgA, imgB] = loadedImages;
  const maxW = Math.max(imgA.width, imgB.width);
  // Scale each image so its width === maxW, keeping aspect ratio
  const scaleA = maxW / imgA.width;
  const scaleB = maxW / imgB.width;
  const drawHA = Math.round(imgA.height * scaleA);
  const drawHB = Math.round(imgB.height * scaleB);
  const canvasW = maxW;
  const canvasH = drawHA + labelH + drawHB + labelH;

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1a1a1a";
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Draw image A (top) at full width
  ctx.drawImage(imgA, 0, 0, maxW, drawHA);
  // Label band for A
  ctx.fillStyle = "rgba(0,0,0,0.8)";
  ctx.fillRect(0, drawHA, maxW, labelH);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px Arial, Helvetica, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${typeLabel}: ${items[0].name}`, maxW / 2, drawHA + labelH / 2, maxW - 16);

  // Draw image B (bottom) at full width
  const topB = drawHA + labelH;
  ctx.drawImage(imgB, 0, topB, maxW, drawHB);
  // Label band for B
  ctx.fillStyle = "rgba(0,0,0,0.8)";
  ctx.fillRect(0, topB + drawHB, maxW, labelH);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px Arial, Helvetica, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${typeLabel}: ${items[1].name}`, maxW / 2, topB + drawHB + labelH / 2, maxW - 16);

  return downscaleTo4K(canvas, `${typeLabel}(2)`);
}

/** Down-scale a canvas so its longest edge ≤ MAX_SHEET_PX (2048), output JPEG 0.92. */
function downscaleTo4K(srcCanvas: HTMLCanvasElement, debugTag: string): string {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const longest = Math.max(w, h);
  if (longest <= MAX_SHEET_PX) {
    console.log(`[composeRefSheet] ${debugTag}: ${w}×${h}px (within ${MAX_SHEET_PX}px, no downscale)`);
    return srcCanvas.toDataURL("image/jpeg", 0.92);
  }
  const scale = MAX_SHEET_PX / longest;
  const dstW = Math.round(w * scale);
  const dstH = Math.round(h * scale);
  const dst = document.createElement("canvas");
  dst.width = dstW;
  dst.height = dstH;
  const dctx = dst.getContext("2d")!;
  dctx.drawImage(srcCanvas, 0, 0, dstW, dstH);
  console.log(`[composeRefSheet] ${debugTag}: ${w}×${h}px → downscaled to ${dstW}×${dstH}px (${MAX_SHEET_PX}px limit)`);
  return dst.toDataURL("image/jpeg", 0.92);
}

function downloadImage(url: string, filename: string) {
  const fixedFilename = fixDownloadFilename(filename, url);
  // Log download info & actual dimensions for debugging
  const sizeKB = url.startsWith("data:") ? (url.length * 0.75 / 1024).toFixed(0) : "?";
  console.log(`[download] ${fixedFilename}, raw data ~${sizeKB}KB`);
  if (url.startsWith("data:")) {
    // Also log actual image dimensions
    const tmpImg = new window.Image();
    tmpImg.onload = () => console.log(`[download] ${fixedFilename} actual pixels: ${tmpImg.width}×${tmpImg.height}`);
    tmpImg.src = url;
    const link = document.createElement("a");
    link.href = url;
    link.download = fixedFilename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    // Use proxy to avoid CORS issues with remote images
    const proxyUrl = url.startsWith("/") ? url : `/api/proxy-image?url=${encodeURIComponent(url)}`;
    fetch(proxyUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = blobUrl;
        link.download = fixedFilename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
      })
      .catch(() => {
        // Last resort: try direct download with a[download] attribute
        const link = document.createElement("a");
        link.href = url;
        link.download = fixedFilename;
        link.target = "_blank";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });
  }
}

// ═══════════════════════════════════════════════════════════
// Image Preview Modal (Popup)
// ═══════════════════════════════════════════════════════════

function ImageModal({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    // Block background scroll while modal is open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}>
      <div className="relative max-w-[90vw] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2 bg-[#1a1a1a] border-b border-[var(--border-default)]">
          <span className="text-[13px] font-medium text-[var(--text-primary)]">{title}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => downloadImage(src, `${title}.png`)}
              className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-[var(--gold-primary)] border border-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer">
              <Download size={12} /> 下载
            </button>
            <button onClick={onClose}
              className="flex items-center justify-center w-7 h-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer">
              <X size={16} />
            </button>
          </div>
        </div>
        <img src={src} alt={title} className="max-w-[90vw] max-h-[calc(90vh-48px)] object-contain bg-[#0A0A0A]" />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

type LeftTab = "prompts" | "chars" | "scenes" | "props" | "style";
type GridMode = "nine" | "four" | "smartNine" | "custom";

// Studio-specific localStorage key to persist UI state across navigation
const STUDIO_STATE_KEY = "feicai-studio-state";

interface StudioState {
  episode: string;
  activeMode: GridMode;
  leftTab: LeftTab;
  fourBeat: number;
  selectedCell: number;
  showPromptDetail: boolean;
  showFourPromptDetail: boolean;
  // Ref-bind persistence: keyed by episode for isolation between episodes
  // nineGridRefIdsByEp: { "ep01": ["id1","id2"], "ep02": [...] }
  nineGridRefIdsByEp?: Record<string, string[]>;
  // fourGridRefIdsByEp: { "ep01": { 0: ["id1"], 3: ["id2"] }, ... }
  fourGridRefIdsByEp?: Record<string, Record<number, string[]>>;
  // cellRefIds key already contains episode (e.g. "nine-ep01-3") — no change needed
  cellRefIds?: Record<string, string[]>;
  // Whether to include the style reference image when submitting to image model
  includeStyleRefInModel?: boolean;
  // 智能分镜九宫格参考图绑定（与九宫格独立）
  smartNineGridRefIdsByEp?: Record<string, string[]>;
  showSmartNinePromptDetail?: boolean;
  // 自定义宫格（智能体驱动）
  customGridCount?: number;
  showCustomPromptDetail?: boolean;
  customGridRefIdsByEp?: Record<string, string[]>;
}

function loadStudioState(): Partial<StudioState> {
  if (typeof window === "undefined") return {};
  try {
    const saved = localStorage.getItem(STUDIO_STATE_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return {};
}

async function loadStudioStateAsync(): Promise<Partial<StudioState>> {
  try {
    const raw = await kvLoad(STUDIO_STATE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

async function saveStudioState(state: StudioState) {
  try { await kvSet(STUDIO_STATE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

// Stable empty references to avoid unnecessary re-renders from useMemo
const EMPTY_STR_ARR: string[] = [];
const EMPTY_NUM_STR_ARR: Record<number, string[]> = {};

// ═══════════════════════════════════════════════════════════
// Module-level: survive unmount/remount across page navigation
// ═══════════════════════════════════════════════════════════

/** Global generation lock — prevents double-click across page navigation.
 *  Using module-level Set instead of useRef so the lock survives component unmount/remount. */
const globalGeneratingLock = new Set<string>();

/** Notify any mounted StudioPage instance of grid image updates (from background generation). */
function notifyGridOpUpdate(detail: {
  images?: Record<string, string>;
  generatingDone?: string;
  regeneratingDone?: string;
  upscalingDone?: string;
}) {
  window.dispatchEvent(new CustomEvent('grid-op-update', { detail }));
}

// ═══════════════════════════════════════════════════════════
// Module-level State Cache — 跨导航保持状态（同 Seedance stateCache 模式）
// ═══════════════════════════════════════════════════════════

const studioCache = {
  _populated: false,
  gridImages: {} as Record<string, string>,
  imageDims: {} as Record<string, string>,
  consistency: null as ConsistencyProfile | null,
  isConsistencyImagesLoaded: false,
  ninePrompts: [] as string[],
  fourGroups: [] as string[][],
  episode: "",
  episodes: [] as string[],
  activeMode: "nine" as GridMode,
  selectedCell: 0,
  fourBeat: 0,
  leftTab: "prompts" as LeftTab,
  showPromptDetail: false,
  showFourPromptDetail: false,
  nineGridRefIdsByEp: {} as Record<string, string[]>,
  fourGridRefIdsByEp: {} as Record<string, Record<number, string[]>>,
  cellRefIds: {} as Record<string, string[]>,
  includeStyleRefInModel: true,
  smartNinePrompts: [] as string[],
  smartNineGridRefIdsByEp: {} as Record<string, string[]>,
  showSmartNinePromptDetail: false,
  customPrompts: [] as string[],
  customGridCount: 9,
  customGridRefIdsByEp: {} as Record<string, string[]>,
  showCustomPromptDetail: false,
  generatingSet: new Set<string>(),
  regeneratingSet: new Set<string>(),
  upscalingSet: new Set<string>(),
};

// ═══════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════

export default function StudioPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { addTask, removeTask, updateTask } = useTaskQueue();
  const { running: pipelineRunning, extractResult, clearExtractResult } = usePipeline();

  // Data — 从模块级缓存恢复（跨导航保持）
  const [episode, setEpisode] = useState(studioCache.episode || "");
  const [episodes, setEpisodes] = useState<string[]>(studioCache.episodes);
  const [ninePrompts, setNinePrompts] = useState<string[]>(studioCache.ninePrompts);
  const [fourGroups, setFourGroups] = useState<string[][]>(studioCache.fourGroups);
  const [smartNinePrompts, setSmartNinePrompts] = useState<string[]>(studioCache.smartNinePrompts);
  const [customPrompts, setCustomPrompts] = useState<string[]>(studioCache.customPrompts);
  const [customGridCount, setCustomGridCount] = useState<number>(studioCache.customGridCount);

  // UI — 从缓存恢复，冷启动时 useEffect 中从 localStorage/IDB 加载
  const [activeMode, setActiveMode] = useState<GridMode>(studioCache.activeMode);
  const [selectedCell, setSelectedCell] = useState(studioCache.selectedCell);
  const [fourBeat, setFourBeat] = useState(studioCache.fourBeat);
  const [leftTab, setLeftTab] = useState<LeftTab>(studioCache.leftTab);
  const [showPromptDetail, setShowPromptDetail] = useState(studioCache.showPromptDetail);
  const [showFourPromptDetail, setShowFourPromptDetail] = useState(studioCache.showFourPromptDetail);
  const [showSmartNinePromptDetail, setShowSmartNinePromptDetail] = useState(studioCache.showSmartNinePromptDetail);
  const [showCustomPromptDetail, setShowCustomPromptDetail] = useState(studioCache.showCustomPromptDetail);
  const [previewImage, setPreviewImage] = useState<{ src: string; title: string } | null>(null);
  const closePreview = useCallback(() => setPreviewImage(null), []);
  const [showCharacterLibrary, setShowCharacterLibrary] = useState(false);
  const [showFusionModal, setShowFusionModal] = useState(false);

  // ── 图片来源选择器状态（本地上传 / 即梦图库） ──
  const [showImageSourcePicker, setShowImageSourcePicker] = useState(false);
  const imageSourceCallbackRef = useRef<((dataUrl: string) => void) | null>(null);

  // ── 即梦历史选图弹窗状态 ──
  const [jimengHistoryPicker, setJimengHistoryPicker] = useState<{ task: JimengClientTask } | null>(null);

  // ── Image Generation Mode: "api" (standard API) or "geminiTab" (browser automation) or "jimeng" (即梦生图) ──
  const [imageGenMode, setImageGenMode] = useState<"api" | "geminiTab" | "jimeng">("api");
  const imageGenModeRef = useRef(imageGenMode);
  imageGenModeRef.current = imageGenMode; // Always track latest mode for useCallback closures

  // ── 即梦 API 工具栏参数 ──
  const [jimengModel, setJimengModel] = useState<JimengImageModelId>("seedream-5.0");
  const [jimengResolution, setJimengResolution] = useState<JimengImageResolution>("2K");
  const [jimengCount, setJimengCount] = useState<number>(4);
  const [jimengNegPrompt, setJimengNegPrompt] = useState<string>("");
  const [showJimengNegPrompt, setShowJimengNegPrompt] = useState(false);
  // ★ Ref 跟踪最新值，避免 useCallback 闭包过期（与 imageGenModeRef 同理）
  const jimengModelRef = useRef(jimengModel);
  jimengModelRef.current = jimengModel;
  const jimengResolutionRef = useRef(jimengResolution);
  jimengResolutionRef.current = jimengResolution;
  const jimengCountRef = useRef(jimengCount);
  jimengCountRef.current = jimengCount;
  const jimengNegPromptRef = useRef(jimengNegPrompt);
  jimengNegPromptRef.current = jimengNegPrompt;
  // 即梦模型显示名
  const jimengModelLabel = JIMENG_IMAGE_MODEL_OPTIONS.find(o => o.value === jimengModel)?.label || jimengModel;

  // Restore imageGenMode from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("feicai-image-gen-mode");
      if (saved === "api" || saved === "geminiTab" || saved === "jimeng") setImageGenMode(saved);
    } catch { /* ignore */ }
  }, []);

  // ★ Pipeline 智能分镜确认方案后自动切换到 smartNine 模式
  useEffect(() => {
    try {
      const smartMode = localStorage.getItem("feicai-studio-smart-mode");
      if (smartMode === "smartNine") {
        setActiveMode("smartNine");
        localStorage.removeItem("feicai-studio-smart-mode");
        // ★ 确认方案意味着用户已产生新数据 — 移除清除标记，允许检测新 EP
        localStorage.removeItem("feicai-new-project");
        console.log("[Studio] 从 Pipeline 智能分镜跳转，自动切换到智能分镜九宫格模式");
        // ★ 重新检测 EP（此时 mount effect 的 detectEpisodes 可能已因标记而跳过）
        detectEpisodes();
      }
    } catch { /* ignore */ }
  }, []);

  // Image Edit Modal state (completely independent from global refs)
  const [editingCell, setEditingCell] = useState<ImageEditRequest | null>(null);

  // Consistency — 缓存恢复或 localStorage 同步初始化
  const [consistency, setConsistency] = useState<ConsistencyProfile>(studioCache.consistency || defaultProfile);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState("");
  const isLoadedRef = useRef(false);
  const [isConsistencyImagesLoaded, setIsConsistencyImagesLoaded] = useState(studioCache.isConsistencyImagesLoaded);
  const restoredRef = useRef<Partial<StudioState>>({});
  const isRestoringRef = useRef(false); // Skip save during restore to prevent incomplete state persistence
  const loadPromptsAbortRef = useRef<AbortController | null>(null); // Cancel in-flight loadPrompts on episode switch
  const currentEpisodeRef = useRef(episode); // Track current episode for async race detection
  const styleAnalyzeAbortRef = useRef<AbortController | null>(null); // Cancel in-flight style analysis
  const geminiTabAbortRef = useRef<AbortController | null>(null); // Cancel in-flight Gemini Tab generation
  const unmountedRef = useRef(false); // Track component unmount — used to skip UI-only setState, NOT to abort operations
  const consistencyRef = useRef(consistency); // Always track latest consistency for background persistence
  consistencyRef.current = consistency;
  const consistencyImageFpRef = useRef(""); // Track image data fingerprint to avoid unnecessary IDB writes
  const diskSyncInProgressRef = useRef(false); // ★ 磁盘补取进行中时阻止 auto-save 写盘（防止旧缓存的空 styleImage 删除磁盘文件）
  const upscaleCellRef = useRef<(key: string, batchMode?: boolean) => Promise<void>>(async () => {}); // Latest upscaleCell ref for batch loops
  const generatingLockRef = useRef(globalGeneratingLock); // Points to module-level set — survives unmount/remount

  // Grid Images — 从缓存恢复
  const [gridImages, setGridImages] = useState<Record<string, string>>(studioCache.gridImages);
  // 格子图片历史栈（每个 key 最多保留 5 张历史）
  const [gridImageHistory, setGridImageHistory] = useState<Record<string, string[]>>({});
  const MAX_HISTORY = 5;
  const [imageDims, setImageDims] = useState<Record<string, string>>(studioCache.imageDims);
  const [generatingSet, setGeneratingSet] = useState<Set<string>>(studioCache.generatingSet);
  const [regeneratingSet, setRegeneratingSet] = useState<Set<string>>(studioCache.regeneratingSet);
  const [upscalingSet, setUpscalingSet] = useState<Set<string>>(studioCache.upscalingSet);
  const [uploadingRefId, setUploadingRefId] = useState<string | null>(null); // Track ref image being uploaded/processed
  const [generatingRefSet, setGeneratingRefSet] = useState<Set<string>>(new Set()); // Guard: prevent concurrent ref image generation
  const [analyzingStyle, setAnalyzingStyle] = useState(false); // Guard: prevent concurrent style analysis
  const [promptsEdited, setPromptsEdited] = useState(false); // Track if prompts were manually edited (unsaved)
  const [translatingPrompt, setTranslatingPrompt] = useState<Set<number>>(new Set()); // 正在 AI 翻译的格号集合
  const [translatingRefIds, setTranslatingRefIds] = useState<Set<string>>(new Set()); // 正在 AI 翻译的一致性条目 ID 集合
  const [batchTranslating, setBatchTranslating] = useState(false); // 批量翻译中
  const [generatingContinuousAction, setGeneratingContinuousAction] = useState(false); // 四宫格连续动作提示词生成中
  const [showMotionPromptModal, setShowMotionPromptModal] = useState(false); // 动态提示词弹窗
  const [showGeminiTabWarning, setShowGeminiTabWarning] = useState(false); // Gemini Tab 注意事项弹窗
  const [includeStyleRefInModel, setIncludeStyleRefInModel] = useState(studioCache.includeStyleRefInModel);

  // ── Reference Image Binding State (stores item IDs, keyed by episode for isolation) ──
  const [nineGridRefIdsByEp, setNineGridRefIdsByEp] = useState<Record<string, string[]>>(studioCache.nineGridRefIdsByEp);
  const [fourGridRefIdsByEp, setFourGridRefIdsByEp] = useState<Record<string, Record<number, string[]>>>(studioCache.fourGridRefIdsByEp);
  const [cellRefIds, setCellRefIds] = useState<Record<string, string[]>>(studioCache.cellRefIds);  // key = cellKey (already contains episode)
  const [smartNineGridRefIdsByEp, setSmartNineGridRefIdsByEp] = useState<Record<string, string[]>>(studioCache.smartNineGridRefIdsByEp);
  const [customGridRefIdsByEp, setCustomGridRefIdsByEp] = useState<Record<string, string[]>>(studioCache.customGridRefIdsByEp ?? {});

  // Derived: current episode's binding IDs (convenience accessors)
  // null = never set (smart matching), [] = explicitly cleared
  // ★ Global inheritance: if current episode has no explicit binding, inherit from the
  //   first episode (sorted) that has one. This way EP01 bindings auto-apply to EP02/03/04+.
  const nineGridRefIds = useMemo(() => {
    const v = nineGridRefIdsByEp[episode];
    if (v !== undefined) return v; // Explicit binding (or explicit clear [])
    // Inherit: find first episode with non-empty bindings
    for (const ep of Object.keys(nineGridRefIdsByEp).sort()) {
      const ids = nineGridRefIdsByEp[ep];
      if (ids && ids.length > 0) return ids;
    }
    return null;
  }, [nineGridRefIdsByEp, episode]);
  const fourGridRefIds = useMemo<Record<number, string[] | null>>(() => {
    const epBindings = fourGridRefIdsByEp[episode];
    if (epBindings && Object.keys(epBindings).length > 0) return epBindings;
    // Inherit: find first episode with non-empty four-grid bindings
    for (const ep of Object.keys(fourGridRefIdsByEp).sort()) {
      const bindings = fourGridRefIdsByEp[ep];
      if (bindings && Object.keys(bindings).length > 0) {
        // Only inherit if at least one beat has actual IDs
        const hasIds = Object.values(bindings).some(ids => ids && ids.length > 0);
        if (hasIds) return bindings;
      }
    }
    return EMPTY_NUM_STR_ARR;
  }, [fourGridRefIdsByEp, episode]);
  const smartNineGridRefIds = useMemo(() => {
    const v = smartNineGridRefIdsByEp[episode];
    if (v !== undefined) return v;
    for (const ep of Object.keys(smartNineGridRefIdsByEp).sort()) {
      const ids = smartNineGridRefIdsByEp[ep];
      if (ids && ids.length > 0) return ids;
    }
    return null;
  }, [smartNineGridRefIdsByEp, episode]);
  const [refBindOpen, setRefBindOpen] = useState(false);
  const [refBindTarget, setRefBindTarget] = useState<RefBindTarget | null>(null);

  // Track actual image dimensions for display in UI
  const handleImgLoad = useCallback((key: string, e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDims(prev => {
      const label = `${img.naturalWidth}×${img.naturalHeight}`;
      if (prev[key] === label) return prev;
      return { ...prev, [key]: label };
    });
  }, []);

  // ── 格子图片历史栈：撤回到上一张图 ──
  /** 将当前图片推入历史栈（在覆盖前调用） */
  const pushToHistory = useCallback((cellKey: string) => {
    const currentUrl = gridImages[cellKey];
    if (!currentUrl) return; // 无图片，不入栈
    setGridImageHistory(prev => {
      const stack = prev[cellKey] ? [...prev[cellKey]] : [];
      stack.push(currentUrl);
      // 限制历史深度
      while (stack.length > MAX_HISTORY) stack.shift();
      return { ...prev, [cellKey]: stack };
    });
  }, [gridImages]);

  /** 撤回：恢复到上一张图片 */
  const undoCellImage = useCallback(async (cellKey: string) => {
    const stack = gridImageHistory[cellKey];
    if (!stack || stack.length === 0) { toast("没有可撤回的历史", "info"); return; }
    const prevUrl = stack[stack.length - 1];
    // 从栈中弹出
    setGridImageHistory(prev => {
      const newStack = [...(prev[cellKey] || [])];
      newStack.pop();
      return { ...prev, [cellKey]: newStack };
    });
    // 恢复图片
    setGridImages(prev => ({ ...prev, [cellKey]: prevUrl }));
    notifyGridOpUpdate({ images: { [cellKey]: prevUrl } });
    // 如果是磁盘 URL 就不需要再存了；如果是 data URL 则保存到磁盘
    if (prevUrl.startsWith("data:")) {
      try {
        const diskUrlMap = await saveGridImagesToDisk({ [cellKey]: prevUrl });
        setGridImages(prev => ({ ...prev, ...diskUrlMap }));
      } catch { /* ignore */ }
    } else {
      // 恢复的是磁盘 URL，需要写回磁盘文件（覆盖当前文件）
      try {
        await saveOneGridImageToDisk(cellKey, prevUrl);
      } catch { /* ignore */ }
    }
    toast("已撤回到上一张图片 ✓", "success");
  }, [gridImageHistory, toast]);

  // ── Reference Image Binding Handlers ──
  // Snapshot episode at panel open time so confirm always writes to the correct episode
  const refBindEpisodeRef = useRef(episode);
  const openRefBind = useCallback((target: RefBindTarget) => {
    refBindEpisodeRef.current = episode;
    setRefBindTarget(target);
    setRefBindOpen(true);
  }, [episode]);

  const closeRefBind = useCallback(() => {
    setRefBindOpen(false);
    setRefBindTarget(null);
  }, []);

  // Clear ALL ref bindings (global + cell-level) for the current nine-grid page
  const clearAllNineRefs = useCallback(() => {
    setNineGridRefIdsByEp((prev) => ({ ...prev, [episode]: [] }));
    setCellRefIds((prev) => {
      const prefix = `nine-${episode}-`;
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (k.startsWith(prefix)) delete next[k];
      }
      return next;
    });
  }, [episode]);

  // Clear ALL ref bindings (global + cell-level) for the current four-grid page
  const clearAllFourRefs = useCallback(() => {
    setFourGridRefIdsByEp((prev) => ({
      ...prev,
      [episode]: { ...(prev[episode] || {}), [fourBeat]: [] },
    }));
    setCellRefIds((prev) => {
      const prefix = `four-${episode}-${fourBeat}-`;
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (k.startsWith(prefix)) delete next[k];
      }
      return next;
    });
  }, [episode, fourBeat]);

  // Clear ALL ref bindings for the current smartNine page
  const clearAllSmartNineRefs = useCallback(() => {
    setSmartNineGridRefIdsByEp((prev) => ({ ...prev, [episode]: [] }));
    setCellRefIds((prev) => {
      const prefix = `smartNine-${episode}-`;
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (k.startsWith(prefix)) delete next[k];
      }
      return next;
    });
  }, [episode]);

  const handleRefBindConfirm = useCallback((target: RefBindTarget, ids: string[]) => {
    // Use snapshotted episode (at panel open time) to prevent wrong-episode writes
    const ep = refBindEpisodeRef.current;
    if (target.type === "nine-global") {
      setNineGridRefIdsByEp((prev) => ({ ...prev, [ep]: ids }));
    } else if (target.type === "smartNine-global") {
      setSmartNineGridRefIdsByEp((prev) => ({ ...prev, [ep]: ids }));
    } else if (target.type === "custom-global") {
      setCustomGridRefIdsByEp((prev) => ({ ...prev, [ep]: ids }));
    } else if (target.type === "four-global") {
      setFourGridRefIdsByEp((prev) => ({
        ...prev,
        [ep]: { ...(prev[ep] || {}), [target.beatIdx]: ids },
      }));
    } else if (target.type === "cell") {
      setCellRefIds((prev) => ({ ...prev, [target.cellKey]: ids }));
    }
    closeRefBind();
  }, [closeRefBind]);

  /** Resolve effective ref images for a cell: cell-level overrides global.
   *  When a cell has custom bindings (key exists in cellRefIds), ONLY cell refs are used.
   *  When no custom bindings exist, global refs are inherited.
   *  If both are empty, returns empty array (no smart matching fallback). */
  const resolveRefsForCell = useCallback((cellKey: string, _promptText: string, gridType: "nine" | "four" | "smartNine" | "custom", beatIdx?: number): string[] => {
    // ★ Always use latest consistency (avoids stale closure from useCallback)
    const latestCst = consistencyRef.current;
    // Cell-level binding takes full precedence when customized (key exists in cellRefIds)
    if (cellKey in cellRefIds) {
      const cellRefs = resolveRefBindIds(latestCst, cellRefIds[cellKey]);
      return cellRefs; // even if empty — user explicitly set this
    }
    // Not customized → use global binding
    const merged = new Set<string>();
    if (gridType === "nine" && nineGridRefIds && nineGridRefIds.length > 0) {
      for (const u of resolveRefBindIds(latestCst, nineGridRefIds)) merged.add(u);
    }
    if (gridType === "smartNine" && smartNineGridRefIds && smartNineGridRefIds.length > 0) {
      for (const u of resolveRefBindIds(latestCst, smartNineGridRefIds)) merged.add(u);
    }
    if (gridType === "custom") {
      const ids = customGridRefIdsByEp[episode];
      if (ids && ids.length > 0) for (const u of resolveRefBindIds(latestCst, ids)) merged.add(u);
    }
    if (gridType === "four" && beatIdx !== undefined && fourGridRefIds[beatIdx] && fourGridRefIds[beatIdx].length > 0) {
      for (const u of resolveRefBindIds(latestCst, fourGridRefIds[beatIdx]!)) merged.add(u);
    }
    return Array.from(merged); // may be empty — no smart matching fallback
  }, [cellRefIds, nineGridRefIds, fourGridRefIds, smartNineGridRefIds, customGridRefIdsByEp, episode, consistency]);

  // ── Restore persisted UI state + consistency on mount (avoids hydration mismatch) ──
  // ★ 在 effect 执行前捕获缓存状态（sync-back effect 会立即把 _populated 设为 true，
  //   导致后续同次 mount 中的 consistency effect 误判为缓存恢复而跳过）
  const wasCachedOnMountRef = useRef(studioCache._populated);
  // 跨导航时跳过首次 episode effect 的 selectedCell/fourBeat/prompts 重置
  const skipFirstEpisodeEffectRef = useRef(studioCache._populated);
  // ★ 标记 extractResult 是否已被消费（防止 mount effect 异步 IDB 加载覆盖提取结果）
  const extractConsumedRef = useRef(false);

  useEffect(() => {
    // Reset unmount flag first — React StrictMode (dev) re-mounts after cleanup,
    // so the flag set by the previous cleanup must be cleared to avoid blocking all async ops.
    unmountedRef.current = false;

    // ★ 已有缓存（跨导航恢复）→ 跳过 IDB/localStorage 初始化，直接进入就绪状态
    if (wasCachedOnMountRef.current) {
      isLoadedRef.current = true;
      currentEpisodeRef.current = studioCache.episode;
      // ★ 告知 detectEpisodes 已有缓存 episode，不要跳到最后一集
      restoredRef.current = { episode: studioCache.episode };
      // 仍需检测新文件（但不覆盖 episode）
      detectEpisodes();
      return () => { unmountedRef.current = true; loadPromptsAbortRef.current?.abort(); };
    }

    isRestoringRef.current = true; // Prevent save effect from firing with incomplete state
    // Start with sync localStorage fallback for immediate render, then override from IndexedDB
    const syncSaved = loadStudioState();
    restoredRef.current = syncSaved;
    if (syncSaved.episode !== undefined) setEpisode(syncSaved.episode);
    if (syncSaved.activeMode) setActiveMode(syncSaved.activeMode);
    if (syncSaved.selectedCell !== undefined) setSelectedCell(syncSaved.selectedCell);
    if (syncSaved.fourBeat !== undefined) setFourBeat(syncSaved.fourBeat);
    if (syncSaved.leftTab) setLeftTab(syncSaved.leftTab);
    if (syncSaved.showPromptDetail !== undefined) setShowPromptDetail(syncSaved.showPromptDetail);
    if (syncSaved.showFourPromptDetail !== undefined) setShowFourPromptDetail(syncSaved.showFourPromptDetail);
    if (syncSaved.nineGridRefIdsByEp) setNineGridRefIdsByEp(syncSaved.nineGridRefIdsByEp);
    if (syncSaved.fourGridRefIdsByEp) setFourGridRefIdsByEp(syncSaved.fourGridRefIdsByEp);
    if (syncSaved.cellRefIds) setCellRefIds(syncSaved.cellRefIds);
    if (syncSaved.includeStyleRefInModel !== undefined) setIncludeStyleRefInModel(syncSaved.includeStyleRefInModel);
    // Sync consistency for initial render
    const syncConsistency = loadConsistency();
    setConsistency(syncConsistency);
    // Async: load authoritative data from IndexedDB (overrides sync read)
    (async () => {
      const saved = await loadStudioStateAsync();
      if (Object.keys(saved).length > 0) {
        restoredRef.current = saved;
        if (saved.episode !== undefined) setEpisode(saved.episode);
        if (saved.activeMode) setActiveMode(saved.activeMode);
        if (saved.selectedCell !== undefined) setSelectedCell(saved.selectedCell);
        if (saved.fourBeat !== undefined) setFourBeat(saved.fourBeat);
        if (saved.leftTab) setLeftTab(saved.leftTab);
        if (saved.showPromptDetail !== undefined) setShowPromptDetail(saved.showPromptDetail);
        if (saved.showFourPromptDetail !== undefined) setShowFourPromptDetail(saved.showFourPromptDetail);
        if (saved.nineGridRefIdsByEp) setNineGridRefIdsByEp(saved.nineGridRefIdsByEp);
        if (saved.fourGridRefIdsByEp) setFourGridRefIdsByEp(saved.fourGridRefIdsByEp);
        if (saved.cellRefIds) setCellRefIds(saved.cellRefIds);
        if (saved.includeStyleRefInModel !== undefined) setIncludeStyleRefInModel(saved.includeStyleRefInModel);
      }
      const loadedConsistency = await loadConsistencyAsync();
      // ★ 如果 extractResult 已被消费（异步等待期间流水线提取完成），
      //   不用旧 IDB 数据覆盖提取结果，仅补充参考图和风格信息
      if (extractConsumedRef.current) {
        console.log("[Studio mount] extractResult 已消费，跳过 IDB 一致性覆盖，仅补充参考图");
        setConsistency((prev) => {
          const merged = { ...prev };
          // ★ 风格信息始终从 IDB 取最新（流水线可能已更新）
          if (loadedConsistency.style.styleImage) {
            merged.style = { ...merged.style, styleImage: loadedConsistency.style.styleImage };
          }
          if (loadedConsistency.style.stylePrompt) {
            merged.style = { ...merged.style, stylePrompt: loadedConsistency.style.stylePrompt };
          }
          // 补充参考图（从旧 IDB 数据匹配同名条目的参考图）
          for (const listKey of ["characters", "scenes", "props"] as const) {
            merged[listKey] = prev[listKey].map((item) => {
              if (item.referenceImage) return item; // 已有图，不覆盖
              const idbItem = loadedConsistency[listKey].find((p: { name: string }) =>
                p.name.toLowerCase().trim() === item.name.toLowerCase().trim()
              );
              if (idbItem?.referenceImage) {
                return { ...item, referenceImage: idbItem.referenceImage };
              }
              return item;
            });
          }
          return merged;
        });
      } else {
        // 正常路径：从 IDB 恢复一致性数据，保留已有的参考图
        setConsistency((prev) => {
          const merged = { ...loadedConsistency };
          // Preserve style image / prompt if already restored
          if (prev.style.styleImage && !loadedConsistency.style.styleImage) {
            merged.style = { ...merged.style, styleImage: prev.style.styleImage };
          }
          if (prev.style.stylePrompt && !loadedConsistency.style.stylePrompt) {
            merged.style = { ...merged.style, stylePrompt: prev.style.stylePrompt };
          }
          // Preserve reference images for each item
          for (const listKey of ["characters", "scenes", "props"] as const) {
            merged[listKey] = loadedConsistency[listKey].map((item) => {
              const existing = prev[listKey].find((p: { id: string }) => p.id === item.id);
              if (existing?.referenceImage && !item.referenceImage) {
                return { ...item, referenceImage: existing.referenceImage };
              }
              return item;
            });
          }
          return merged;
        });
      }
      // 异步恢复完成后才释放保存锁，防止 save effect 在 IDB 数据到达前用不完整状态覆盖
      requestAnimationFrame(() => { isRestoringRef.current = false; });
    })();
    // Cleanup on unmount: mark unmounted for UI-only skips.
    // Do NOT abort extract/style-analyze/image ops — let them finish in background and persist results.
    return () => {
      unmountedRef.current = true;
      loadPromptsAbortRef.current?.abort(); // Load-time only, safe to abort
    };
  }, []);

  // ── Consume pipeline concurrent extraction result ──
  useEffect(() => {
    if (!extractResult) return;
    // ★ 标记提取结果已消费，防止 mount effect 的异步 IDB 加载覆盖
    extractConsumedRef.current = true;
    const data = extractResult as { characters?: { name: string; description: string; prompt?: string; aliases?: string[] }[]; scenes?: { name: string; description: string; prompt?: string; aliases?: string[] }[]; props?: { name: string; description: string; prompt?: string; aliases?: string[] }[]; style?: { artStyle?: string; colorPalette?: string; timeSetting?: string } };

    function mergeItems<T extends { id: string; name: string; referenceImage?: string; prompt?: string; aliases?: string[] }>(
      existing: T[],
      extracted: { name: string; description: string; prompt?: string; aliases?: string[] }[],
      idPrefix: string
    ): T[] {
      const matchedExistingIds = new Set<string>();
      const result = extracted.filter((n) => n.name).map((newItem, i) => {
        const normalName = (newItem.name || "").toLowerCase().trim();
        // ★ 仅精确匹配名称（不做子串模糊匹配，防止"林风"匹配"林风华"导致参考图张冠李戴）
        const matched = normalName ? existing.find((old) => {
          if (matchedExistingIds.has(old.id)) return false; // 已被前面的条目匹配，跳过
          const oldName = (old.name || "").toLowerCase().trim();
          return oldName === normalName;
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
      // ★ 保留未被匹配的已有条目（用户手动添加 + 之前提取的角色），防止参考图丢失
      const preserved = existing.filter(item => !matchedExistingIds.has(item.id));
      return [...result, ...preserved];
    }

    setConsistency((prev) => {
      const updated: ConsistencyProfile = { ...prev };
      if (data.characters?.length) updated.characters = mergeItems(prev.characters, data.characters, "char");
      if (data.scenes?.length) updated.scenes = mergeItems(prev.scenes, data.scenes, "scene");
      if (data.props?.length) updated.props = mergeItems(prev.props, data.props, "prop");
      if (data.style && !updated.style.styleLocked) {
        updated.style = { ...updated.style,
          artStyle: data.style.artStyle || updated.style.artStyle,
          colorPalette: data.style.colorPalette || updated.style.colorPalette,
          // ★ 自动填充 timeSetting，但保留用户已有的自定义值
          timeSetting: updated.style.timeSetting || data.style.timeSetting || "",
        };
      }
      saveConsistency(updated);
      return updated;
    });

    const charCount = data.characters?.length || 0;
    const sceneCount = data.scenes?.length || 0;
    const propCount = data.props?.length || 0;
    toast(`流水线自动提取完成！角色 ${charCount}，场景 ${sceneCount}，道具 ${propCount}`, "success");
    setLeftTab("chars");
    clearExtractResult();
  }, [extractResult, clearExtractResult, toast]);

  // ── Persist UI state on every change (includes ref-bind IDs keyed by episode) ──
  useEffect(() => {
    if (isRestoringRef.current) return; // Skip save during initial restore to avoid incomplete state
    saveStudioState({
      episode, activeMode, leftTab, fourBeat, selectedCell, showPromptDetail, showFourPromptDetail,
      nineGridRefIdsByEp, fourGridRefIdsByEp, cellRefIds, includeStyleRefInModel,
      smartNineGridRefIdsByEp, showSmartNinePromptDetail,
      customGridCount, customGridRefIdsByEp, showCustomPromptDetail,
    });
  }, [episode, activeMode, leftTab, fourBeat, selectedCell, showPromptDetail, showFourPromptDetail, nineGridRefIdsByEp, fourGridRefIdsByEp, cellRefIds, includeStyleRefInModel, smartNineGridRefIdsByEp, showSmartNinePromptDetail, customGridCount, customGridRefIdsByEp, showCustomPromptDetail]);

  // ── 将组件状态同步到模块级缓存（跨导航保持）──
  useEffect(() => {
    studioCache._populated = true;
    studioCache.gridImages = gridImages;
    studioCache.imageDims = imageDims;
    studioCache.consistency = consistency;
    studioCache.isConsistencyImagesLoaded = isConsistencyImagesLoaded;
    studioCache.ninePrompts = ninePrompts;
    studioCache.fourGroups = fourGroups;
    studioCache.episode = episode;
    studioCache.episodes = episodes;
    studioCache.activeMode = activeMode;
    studioCache.selectedCell = selectedCell;
    studioCache.fourBeat = fourBeat;
    studioCache.leftTab = leftTab;
    studioCache.showPromptDetail = showPromptDetail;
    studioCache.showFourPromptDetail = showFourPromptDetail;
    studioCache.nineGridRefIdsByEp = nineGridRefIdsByEp;
    studioCache.fourGridRefIdsByEp = fourGridRefIdsByEp;
    studioCache.cellRefIds = cellRefIds;
    studioCache.includeStyleRefInModel = includeStyleRefInModel;
    studioCache.smartNinePrompts = smartNinePrompts;
    studioCache.smartNineGridRefIdsByEp = smartNineGridRefIdsByEp;
    studioCache.showSmartNinePromptDetail = showSmartNinePromptDetail;
    studioCache.customPrompts = customPrompts;
    studioCache.customGridCount = customGridCount;
    studioCache.showCustomPromptDetail = showCustomPromptDetail;
    studioCache.customGridRefIdsByEp = customGridRefIdsByEp;
    studioCache.generatingSet = generatingSet;
    studioCache.regeneratingSet = regeneratingSet;
    studioCache.upscalingSet = upscalingSet;
  });

  // ── 自定义宫格提示词持久化（debounced KV + 磁盘镜像） ──
  useEffect(() => {
    if (!episode || customPrompts.length === 0) return;
    const timer = setTimeout(async () => {
      const key = `feicai-custom-grid-prompts-${episode}`;
      const data = JSON.stringify({ prompts: customPrompts, gridCount: customGridCount });
      try { await kvSet(key, data); } catch { /* ignore */ }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customPrompts, customGridCount, episode]);

  // ── 四宫格编辑提示词持久化（debounced KV + 磁盘） ──
  useEffect(() => {
    if (!episode || !promptsEdited || fourGroups.length === 0) return;
    const timer = setTimeout(async () => {
      const key = `feicai-four-groups-edited-${episode}`;
      const data = JSON.stringify(fourGroups);
      try { await kvSet(key, data); } catch { /* ignore */ }
      try {
        await fetch("/api/outputs", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: [{ name: `four-groups-edited-${episode}.json`, content: data }] }),
        });
      } catch { /* ignore */ }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fourGroups, episode, promptsEdited]);

  // ── Effects ──

  useEffect(() => {
    // ★ 缓存恢复 → 仍需检查磁盘上是否有新的一致性参考图（其他页面可能已更新）
    if (wasCachedOnMountRef.current) {
      // 轻量级检查：缓存中缺失的图片从磁盘补取
      diskSyncInProgressRef.current = true; // ★ 阻止 auto-save effect 在补取完成前用旧缓存写盘
      (async () => {
        try {
          const freshProfile = await restoreConsistencyImagesFromDisk(await loadConsistencyAsync());
          setConsistency((prev) => {
            let changed = false;
            const merged = { ...prev };
            // 同步画幅/画质（流水线可能已修改，缓存分支也要跟进）
            if (freshProfile.style.aspectRatio && freshProfile.style.aspectRatio !== prev.style.aspectRatio) {
              merged.style = { ...merged.style, aspectRatio: freshProfile.style.aspectRatio };
              changed = true;
            }
            if (freshProfile.style.resolution && freshProfile.style.resolution !== prev.style.resolution) {
              merged.style = { ...merged.style, resolution: freshProfile.style.resolution };
              changed = true;
            }
            // ★ 风格参考图/提示词：始终以 IDB+磁盘为事实来源，覆盖缓存值
            //   旧逻辑 `!prev.style.styleImage` 导致缓存有旧值时新值无法覆盖
            if (freshProfile.style.styleImage !== prev.style.styleImage) {
              merged.style = { ...merged.style, styleImage: freshProfile.style.styleImage || "" };
              changed = true;
            }
            if (freshProfile.style.stylePrompt !== prev.style.stylePrompt) {
              merged.style = { ...merged.style, stylePrompt: freshProfile.style.stylePrompt || "" };
              changed = true;
            }
            // 补取角色/场景/道具参考图（★ 仅补取缓存中已有条目的缺失图片，
            //   不再合并 freshProfile 中的「新增条目」— 那些可能是旧项目残留，
            //   跨项目切换时漏清的幽灵条目。新条目应通过 AI 提取或角色库导入。）
            for (const listKey of ["characters", "scenes", "props"] as const) {
              merged[listKey] = prev[listKey].map((item) => {
                const restored = freshProfile[listKey].find((r: { id: string }) => r.id === item.id);
                if (restored?.referenceImage && !item.referenceImage) {
                  changed = true;
                  return { ...item, referenceImage: restored.referenceImage };
                }
                return item;
              });
              // ★ 移除新增条目合并 — 防止跨项目幽灵条目混入
            }
            return changed ? merged : prev;
          });
        } catch { /* 磁盘不可用时忽略 */ } finally {
          diskSyncInProgressRef.current = false;
        }
      })();
      return;
    }

    // Plan B: Consistency images now loaded from disk via /api/ref-image.
    // One-time migration for legacy localStorage data
    migrateFromLocalStorage();

    (async () => {
      // Restore consistency profile with images from disk
      const fullyRestored = await restoreConsistencyImagesFromDisk(await loadConsistencyAsync());
      // Use functional update to merge ONLY image fields, preserving any user edits made during async load
      setConsistency((prev) => {
        const merged = { ...prev };
        // ★ 风格参考图/提示词：始终以磁盘恢复结果为事实来源
        if (fullyRestored.style.styleImage && fullyRestored.style.styleImage !== prev.style.styleImage) {
          merged.style = { ...merged.style, styleImage: fullyRestored.style.styleImage };
        }
        if (fullyRestored.style.stylePrompt && fullyRestored.style.stylePrompt !== prev.style.stylePrompt) {
          merged.style = { ...merged.style, stylePrompt: fullyRestored.style.stylePrompt };
        }
        // Merge reference images for each item — always merge, don't skip if prev already has it
        // This ensures images generated in background (while page was unmounted) are restored
        for (const listKey of ["characters", "scenes", "props"] as const) {
          merged[listKey] = prev[listKey].map((item) => {
            const restored = fullyRestored[listKey].find((r: { id: string }) => r.id === item.id);
            if (restored?.referenceImage && (!item.referenceImage || !item.referenceImage.startsWith("data:"))) {
              return { ...item, referenceImage: restored.referenceImage };
            }
            return item;
          });
        }
        return merged;
      });
      setIsConsistencyImagesLoaded(true);

      isLoadedRef.current = true;
    })();
    detectEpisodes();
  }, []);

  // ── ★ 风格参考图磁盘直读安全网 — 兜底检查确保磁盘图片一定显示 ──
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/ref-image?keys=style-image&check=1");
        if (!res.ok) return;
        const data = await res.json();
        if (data.exists?.["style-image"]) {
          setConsistency(prev => {
            if (!prev.style.styleImage) {
              console.log("[Studio] 安全网：从磁盘恢复风格参考图");
              return { ...prev, style: { ...prev.style, styleImage: `/api/ref-image?serve=style-image&_t=${Date.now()}` } };
            }
            return prev;
          });
        }
      } catch { /* 网络异常忽略 */ }
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  // ── Listen for background grid image saves (from closures that outlived previous mount) ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        images?: Record<string, string>;
        generatingDone?: string;
        regeneratingDone?: string;
        upscalingDone?: string;
      };
      if (detail.images) {
        setGridImages((prev) => ({ ...prev, ...detail.images! }));
      }
      if (detail.generatingDone) {
        setGeneratingSet((prev) => { const s = new Set(prev); s.delete(detail.generatingDone!); return s; });
      }
      if (detail.regeneratingDone) {
        setRegeneratingSet((prev) => { const s = new Set(prev); s.delete(detail.regeneratingDone!); return s; });
      }
      if (detail.upscalingDone) {
        setUpscalingSet((prev) => { const s = new Set(prev); s.delete(detail.upscalingDone!); return s; });
      }
    };
    window.addEventListener('grid-op-update', handler);

    // On mount: sync generating state from global lock (in case generation is still running from previous mount)
    if (globalGeneratingLock.size > 0) {
      const genKeys = new Set<string>();
      const regenKeys = new Set<string>();
      for (const k of globalGeneratingLock) {
        // nine-ep01 / four-ep01-0 are whole-grid generation keys; others are single-cell
        if (/^(?:nine|four)-[^-]+-?\d*$/.test(k) && !k.includes('-composite-')) {
          genKeys.add(k);
        } else {
          regenKeys.add(k);
        }
      }
      if (genKeys.size > 0) setGeneratingSet(genKeys);
      if (regenKeys.size > 0) setRegeneratingSet(regenKeys);
    }

    return () => { window.removeEventListener('grid-op-update', handler); };
  }, []);

  // ── AI 导演系统 — CustomEvent 命令监听 ──
  // 接收来自 director/orchestrator.ts 的画布操作命令
  useEffect(() => {
    // 处理画布上下文请求
    const ctxHandler = (e: Event) => {
      const { requestId } = (e as CustomEvent).detail;
      const ctx = {
        requestId,
        context: {
          currentPage: "/studio",
          gridMode: activeMode,
          episode,
          episodes,
          imageGenMode: imageGenMode,
          leftTab,
          customGridCount,
          customPrompts,
          filledCells: Object.keys(gridImages).length,
          totalCells: activeMode === "custom" ? customGridCount : activeMode === "four" ? 4 : 9,
          hasPrompts: ninePrompts.some(p => p.trim().length > 0) || fourGroups.some(g => g.some(p => p.trim().length > 0)),
          characterCount: consistency.characters?.length || 0,
          sceneCount: consistency.scenes?.length || 0,
          propCount: consistency.props?.length || 0,
          hasStyle: !!(consistency as unknown as Record<string, unknown>).styleImage || !!(consistency as unknown as Record<string, unknown>).styleKeywords,
          isGenerating: generatingSet.size > 0,
        },
      };
      window.dispatchEvent(new CustomEvent("director-context-response", { detail: ctx }));
    };

    // 处理画布操作命令
    const cmdHandler = async (e: Event) => {
      const { action, params, requestId } = (e as CustomEvent).detail as {
        action: string; params: Record<string, unknown>; requestId: string;
      };
      let success = true;
      let result = "";
      let error = "";

      try {
        switch (action) {
          case "switchGridMode":
            setActiveMode(params.mode as "nine" | "four" | "smartNine");
            result = `已切换到 ${params.mode} 模式`;
            break;
          case "switchEpisode":
            setEpisode(params.episode as string);
            result = `已切换到 ${params.episode}`;
            break;
          case "switchLeftTab":
            setLeftTab(params.tab as LeftTab);
            result = `左侧面板已切换到 ${params.tab}`;
            break;
          case "loadPrompts":
            loadPrompts(params.episode as string || episode);
            result = `正在加载 ${params.episode || episode} 提示词`;
            break;
          case "generateNineGrid":
            generateNineGrid();
            result = "九宫格生成已启动";
            break;
          case "generateFourGrid":
            generateFourGrid(typeof params.beatIdx === "number" ? params.beatIdx : 0);
            result = "四宫格生成已启动";
            break;
          case "generateSmartNineGrid":
            generateSmartNineGrid();
            result = "智能分镜生成已启动";
            break;
          case "regenerateCell":
            regenerateCell(`${activeMode}-${episode}-${params.cellIndex}`, (params.prompt as string) || "");
            result = `格 ${params.cellIndex} 重生已启动`;
            break;
          case "upscaleCell": {
            const cellKey = `${activeMode}-${episode}-${params.cellIndex}`;
            upscaleCellRef.current(cellKey);
            result = `格 ${params.cellIndex} 超分已启动`;
            break;
          }
          case "batchUpscale":
            if (activeMode === "nine") batchUpscaleNine();
            else batchUpscaleFour();
            result = "批量超分已启动";
            break;
          case "aiExtract":
            handleAiExtract();
            result = "AI提取已启动";
            break;
          case "styleUpload":
            handleStyleUpload();
            result = "请在弹出的对话框中选择风格图片";
            break;
          case "addConsistencyItem": {
            const cat = params.category as string;
            addItem(cat as "characters" | "scenes" | "props");
            result = `已添加 ${cat} 条目`;
            break;
          }
          case "translatePrompt":
            handleTranslatePrompt(params.cellIndex as number);
            result = `格 ${params.cellIndex} 翻译已启动`;
            break;
          case "navigateTo":
            router.push(params.path as string);
            result = `正在跳转到 ${params.path}`;
            break;
          case "openModal":
            if (params.modal === "characterLibrary") setShowCharacterLibrary(true);
            else if (params.modal === "motionPrompt") setShowMotionPromptModal(true);
            result = `已打开 ${params.modal} 弹窗`;
            break;
          case "clearAllImages":
            setGridImages({});
            result = "已清除所有图片";
            break;
          // ── EP 集数管理 ──
          case "addEpisode": {
            const newEp = (params.episode as string || "").toLowerCase();
            if (newEp) {
              setEpisodes(prev => prev.includes(newEp) ? prev : [...prev, newEp].sort());
              result = `已添加集数 ${newEp.toUpperCase()}`;
            } else { success = false; error = "缺少 episode 参数"; }
            break;
          }
          case "removeEpisode": {
            const rmEp = (params.episode as string || "").toLowerCase();
            if (rmEp) {
              setEpisodes(prev => prev.filter(e => e !== rmEp));
              if (episode === rmEp) {
                setEpisode(episodes.find(e => e !== rmEp) || "ep01");
              }
              result = `已删除集数 ${rmEp.toUpperCase()}`;
            } else { success = false; error = "缺少 episode 参数"; }
            break;
          }
          case "renameEpisode": {
            const oldE = (params.episode as string || "").toLowerCase();
            const newE = (params.newEpisode as string || "").toLowerCase();
            if (oldE && newE) {
              setEpisodes(prev => prev.map(e => e === oldE ? newE : e).sort());
              if (episode === oldE) setEpisode(newE);
              result = `已重命名 ${oldE.toUpperCase()} → ${newE.toUpperCase()}`;
            } else { success = false; error = "缺少 episode / newEpisode 参数"; }
            break;
          }
          case "moveShotsToEpisode": {
            // 接收从 Agent 移来的分镜 — 目前只记录日志（实际分镜数据已在 Agent 端处理）
            result = `已接收 ${(params.shots as unknown[])?.length || 0} 个分镜到 ${params.targetEpisode}`;
            break;
          }
          case "mergeEpisodes": {
            // 标记两个 EP 合并 — Agent 端已在本地处理了分镜数据
            result = `已标记合并 ${params.sourceEpisode} → ${params.targetEpisode}`;
            break;
          }
          // ── 风格/一致性增强 ──
          case "setArtStyle": {
            const artStyle = params.artStyle as string || "";
            setConsistency(prev => ({ ...prev, style: { ...prev.style, artStyle } }));
            result = `艺术风格已设置为: ${artStyle}`;
            break;
          }
          case "setColorPalette": {
            const palette = params.colorPalette as string || "";
            setConsistency(prev => ({ ...prev, style: { ...prev.style, colorPalette: palette } }));
            result = `色彩方案已设置为: ${palette}`;
            break;
          }
          // ── 智能体直写提示词到指定EP ──
          case "writePromptsToEpisode": {
            const ep = (params.episode as string || "").toLowerCase() || episode;
            const prompts = params.prompts as string[] | undefined;
            const count = params.gridCount as number | undefined;
            if (prompts && prompts.length > 0) {
              // 确保目标EP存在
              setEpisodes(prev => prev.includes(ep) ? prev : [...prev, ep].sort());
              // 如果是当前EP，直接更新 state
              if (ep === episode) {
                if (count && count >= 1 && count <= 25) setCustomGridCount(count);
                setCustomPrompts(prompts);
                setActiveMode("custom");
              }
              // 持久化到 KV（无论是否当前EP）
              try {
                const key = `feicai-custom-grid-prompts-${ep}`;
                const data = JSON.stringify({ prompts, gridCount: count || prompts.length });
                await kvSet(key, data);
              } catch { /* ignore */ }
              result = `已写入 ${prompts.length} 条提示词到 ${ep.toUpperCase()}`;
            } else { success = false; error = "缺少 prompts 参数"; }
            break;
          }
          default:
            success = false;
            error = `未实现的操作: ${action}`;
        }
      } catch (err) {
        success = false;
        error = err instanceof Error ? err.message : "执行异常";
      }

      // 回传结果
      window.dispatchEvent(new CustomEvent("director-result", {
        detail: { requestId, success, result, error },
      }));
    };

    window.addEventListener("director-context-request", ctxHandler);
    window.addEventListener("director-command", cmdHandler);
    return () => {
      window.removeEventListener("director-context-request", ctxHandler);
      window.removeEventListener("director-command", cmdHandler);
    };
  }); // 故意不加 deps — 每次渲染都用最新闭包

  // ── Re-detect episodes when pipeline transitions from running→stopped ──
  // This ensures newly generated EP files are picked up without manual refresh
  const prevPipelineRunning = useRef(pipelineRunning);
  useEffect(() => {
    if (prevPipelineRunning.current && !pipelineRunning) {
      // Pipeline just finished — 移除「新项目」标记，允许检测新生成的 EP 文件
      try { localStorage.removeItem("feicai-new-project"); } catch { /* ignore */ }
      // ★ 异步等待 EP 检测完成后再加载提示词，避免用旧 episode ref 加载错误集数
      (async () => {
        await detectEpisodes();
        // Force-reload prompts for current episode even if episode state didn't change
        // (e.g. re-running pipeline for same episode would generate new files
        //  but detectEpisodes wouldn't trigger setEpisode → [episode] effect wouldn't fire)
        if (currentEpisodeRef.current) {
          loadPrompts(currentEpisodeRef.current);
        }
      })();
    }
    prevPipelineRunning.current = pipelineRunning;
  }, [pipelineRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!episode) return;
    currentEpisodeRef.current = episode; // Update ref for async race detection

    // ★ 跨导航恢复时：跳过 UI 重置（selectedCell/fourBeat/清空提示词），
    //   但仍从磁盘加载最新提示词和图片，因为用户可能在其他页面（Pipeline）
    //   生成了新提示词/图片后返回 Studio。
    const skipUiReset = skipFirstEpisodeEffectRef.current;
    if (skipFirstEpisodeEffectRef.current) {
      skipFirstEpisodeEffectRef.current = false;
    }

    if (!skipUiReset) {
      // Cancel any in-flight loadPrompts request (prevents race on fast episode switching)
      loadPromptsAbortRef.current?.abort();
      // Clear stale prompts immediately so UI doesn't show old episode's data
      setNinePrompts([]);
      setFourGroups([]);
      setSmartNinePrompts([]);
      setCustomPrompts([]);
      setPromptsEdited(false); // Reset edit flag on episode switch
      // Reset selectedCell / fourBeat to 0 when episode changes to prevent out-of-bounds
      setSelectedCell(0);
      setFourBeat(0);
    }

    // Plan C: 从磁盘加载当前集数的宫格图片（URL 引用而非 data URL）
    const epPrefix1 = `-${episode}-`;
    const epSuffix = `-${episode}`;

    // ★ 同步：驱逐所有非当前集数的图片（无论当前集是否有缓存图片）
    //   修复：旧版在当前集无图片时 return prev 保留所有旧图片，
    //   导致切换EP时旧集图片残留、清画布后切回仍显示旧图。
    setGridImages((prev) => {
      const kept: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (k.includes(epPrefix1) || k.endsWith(epSuffix)) kept[k] = v;
      }
      const evicted = Object.keys(prev).length - Object.keys(kept).length;
      if (evicted > 0) {
        console.log(`[memEvict] Evicted ${evicted} non-${episode} images from state`);
      }
      return evicted > 0 ? kept : prev;
    });

    // 异步：从磁盘列出当前集数的所有图片，构建 URL 映射
    (async () => {
      const diskUrls = await loadGridImageUrlsFromDisk(episode);
      if (currentEpisodeRef.current !== episode) return; // 竞态保护
      if (Object.keys(diskUrls).length > 0) {
        setGridImages((prev) => {
          const merged = { ...prev };
          let added = 0;
          for (const [k, v] of Object.entries(diskUrls)) {
            if (!merged[k]) { merged[k] = v; added++; }
          }
          if (added === 0) return prev;
          console.log(`[diskLoad] Loaded ${added} grid image URLs for ${episode} from disk`);
          return merged;
        });
      }
    })();

    loadPrompts(episode);
    loadSmartNinePrompts(episode);
    loadCustomPrompts(episode);
  }, [episode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 即梦锁定选图 → 宫格自动同步（新标签/刷新后恢复锁定的选图到格子） ──
  const jimengLockSyncedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!episode) return;
    // 延迟执行，等待磁盘图片加载完成后再校对
    const timer = setTimeout(async () => {
      const store = getJimengTaskStore?.();
      if (!store) return;
      const tasks = store.getSnapshot();
      const toSync: Array<{ gridKey: string; imageUrl: string }> = [];
      const epPrefix = `-${episode}-`;

      for (const task of tasks) {
        if (!task.locked || task.selectedIndex == null || !task.targetGridKey) continue;
        if (jimengLockSyncedRef.current.has(task.taskId)) continue; // 已同步过
        const gk = task.targetGridKey;
        if (!gk.includes(epPrefix) && !gk.endsWith(`-${episode}`)) continue;
        const lockedUrl = task.images[task.selectedIndex];
        if (!lockedUrl) continue;
        // 仅当选中的不是第一张时才需要同步（第一张是自动保存的默认值）
        if (task.selectedIndex === 0) { jimengLockSyncedRef.current.add(task.taskId); continue; }
        toSync.push({ gridKey: gk, imageUrl: lockedUrl });
        jimengLockSyncedRef.current.add(task.taskId);
      }

      if (toSync.length === 0) return;
      console.log(`[jimengLockSync] 发现 ${toSync.length} 个锁定选图需同步到宫格`);

      const updates: Record<string, string> = {};
      for (const { gridKey, imageUrl } of toSync) {
        let dataUrl = imageUrl;
        if (imageUrl.startsWith("/api/")) {
          try {
            const resp = await fetch(imageUrl);
            if (!resp.ok) continue;
            const blob = await resp.blob();
            dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } catch { continue; }
        } else if (!imageUrl.startsWith("data:") && !imageUrl.startsWith("http")) {
          continue;
        }
        updates[gridKey] = dataUrl;
      }

      if (Object.keys(updates).length === 0) return;
      setGridImages((prev) => ({ ...prev, ...updates }));
      const diskUrlMap = await saveGridImagesToDisk(updates);
      if (Object.keys(diskUrlMap).length > 0) {
        setGridImages((prev) => ({ ...prev, ...diskUrlMap }));
        console.log(`[jimengLockSync] ✓ 已同步 ${Object.keys(diskUrlMap).length} 个锁定选图到宫格磁盘`);
      }
    }, 2500); // 等待 2.5 秒让磁盘图片先加载完
    return () => clearTimeout(timer);
  }, [episode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save: text → localStorage, images → disk via /api/ref-image
  // Plan B: saveConsistencyImages writes directly to disk, no debounced backup needed
  useEffect(() => {
    if (!isLoadedRef.current) return;
    // ★ 磁盘补取进行中时跳过全部保存（含 saveConsistency），
    //   防止旧缓存 consistency 覆盖 Pipeline 刚同步到 IDB 的新画幅/画质值
    if (diskSyncInProgressRef.current) {
      console.log(`[auto-save] ⏭ 磁盘补取进行中，跳过全部保存（防止旧缓存覆盖 IDB）`);
      return;
    }
    // Local saves are fast — run immediately
    console.log(`[auto-save] saveConsistency → 角色${consistency.characters.length} 场景${consistency.scenes.length} 道具${consistency.props.length}`);
    saveConsistency(consistency);
    // Only write images to disk when image data actually changes (avoid redundant writes on text edits)
    const imageFp = [
      `s:${consistency.style.styleImage?.length || 0}:${consistency.style.styleImage?.slice(-40) || ""}`,
      ...consistency.characters.map(c => `${c.id}:${c.referenceImage?.length || 0}:${c.referenceImage?.slice(-40) || ""}`),
      ...consistency.scenes.map(s => `${s.id}:${s.referenceImage?.length || 0}:${s.referenceImage?.slice(-40) || ""}`),
      ...consistency.props.map(p => `${p.id}:${p.referenceImage?.length || 0}:${p.referenceImage?.slice(-40) || ""}`),
    ].join("|");
    const imagesChanged = imageFp !== consistencyImageFpRef.current;
    if (imagesChanged) {
      consistencyImageFpRef.current = imageFp;
      // 统计当前有参考图的条目数量
      const withImages = [
        ...consistency.characters.filter(c => c.referenceImage && c.referenceImage.length > 200),
        ...consistency.scenes.filter(s => s.referenceImage && s.referenceImage.length > 200),
        ...consistency.props.filter(p => p.referenceImage && p.referenceImage.length > 200),
      ];
      const withoutImages = [
        ...consistency.characters.filter(c => !c.referenceImage || c.referenceImage.length <= 200),
        ...consistency.scenes.filter(s => !s.referenceImage || s.referenceImage.length <= 200),
        ...consistency.props.filter(p => !p.referenceImage || p.referenceImage.length <= 200),
      ];
      console.log(`[auto-save] 一致性图片变更 → saveConsistencyImages: 有图${withImages.length}项 (${withImages.map(i => i.id).join(",")}), 无图${withoutImages.length}项`);
      saveConsistencyImages(consistency);
      // Also persist stylePrompt to server as JSON for backup
      if (consistency.style.stylePrompt) {
        const jsonStr = JSON.stringify({ stylePrompt: consistency.style.stylePrompt });
        const b64 = btoa(unescape(encodeURIComponent(jsonStr)));
        const jsonData = `data:application/json;base64,${b64}`;
        fetch("/api/ref-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "style-prompt", imageData: jsonData }),
        }).catch(() => {});
      }
    }
  }, [consistency]);

  // ── Data Loading ──

  async function detectEpisodes() {
    // ★ 「新项目」标记持久化 — 不在此处消费（removeItem），而是仅只读检查。
    //   标记仅在用户产生新数据时才移除：
    //   - 流水线执行完成（pipelineRunning 转 false）
    //   - 智能分镜确认方案（feicai-studio-smart-mode 检测到）
    const isFreshStart = localStorage.getItem("feicai-new-project");
    if (isFreshStart) {
      restoredRef.current = { ...restoredRef.current, episode: undefined };
      setEpisodes([]);
      setEpisode("");
      setNinePrompts([]);
      setFourGroups([]);
      setSmartNinePrompts([]);
      setGridImages({});
      // ★ 必须同步清空模块级缓存，否则跨导航时 studioCache.gridImages 仍保留旧项目图片
      studioCache._populated = false;
      studioCache.gridImages = {};
      studioCache.ninePrompts = [];
      studioCache.fourGroups = [];
      studioCache.smartNinePrompts = [];
      studioCache.customPrompts = [];
      studioCache.episode = "";
      studioCache.episodes = [];
      return;
    }

    // ★ 第八十七次修复：EP 检测改为从 KV + grid-images 发现，
    //   不再扫描 outputs/ .md 文件。这样旧项目的 .md 文件可以永久保留，
    //   不会干扰新项目的 EP 下拉列表。
    //   EP 来源：
    //   1. KV: feicai-smart-nine-prompts-epXX（智能分镜提示词）
    //   2. KV: feicai-motion-prompts-nine-epXX / four-epXX（运镜提示词）
    //   3. grid-images/: nine-epXX-* / four-epXX-* / smartNine-epXX-*（宫格图片）
    try {
      const epSet = new Set<string>();

      // 来源1：KV 智能分镜提示词
      const smartKeys = await kvKeysByPrefix("feicai-smart-nine-prompts-");
      for (const k of smartKeys) {
        const m = k.match(/(ep\d+)$/);
        if (m) epSet.add(m[1]);
      }

      // 来源2：KV 运镜提示词
      const motionKeys = await kvKeysByPrefix("feicai-motion-prompts-");
      for (const k of motionKeys) {
        const m = k.match(/(ep\d+)/);
        if (m) epSet.add(m[1]);
      }

      // 来源3：grid-images 磁盘图片
      try {
        const res = await fetch("/api/grid-image?list=1");
        if (res.ok) {
          const data = await res.json();
          const keys: string[] = data.keys || [];
          for (const k of keys) {
            const m = k.match(/(ep\d+)/);
            if (m) epSet.add(m[1]);
          }
        }
      } catch { /* grid-image API 不可用时跳过 */ }

      // 来源4：KV 节拍拆解提示词标记（节拍拆解模式 — 流水线完成时写入）
      const beatKeys = await kvKeysByPrefix("feicai-beat-prompts-");
      for (const k of beatKeys) {
        const m = k.match(/(ep\d+)$/);
        if (m) epSet.add(m[1]);
      }

      // 来源5：KV 自定义宫格提示词（Agent 推送的自定义分镜）
      const customKeys = await kvKeysByPrefix("feicai-custom-grid-prompts-");
      for (const k of customKeys) {
        const m = k.match(/(ep\d+)$/);
        if (m) epSet.add(m[1]);
      }

      const eps = Array.from(epSet).sort();
      setEpisodes(eps);
      if (eps.length === 0) {
        setEpisode("");
        setNinePrompts([]);
        setFourGroups([]);
        return;
      }
      // Only set episode if not already restored from state
      if (!restoredRef.current.episode) {
        setEpisode(eps[eps.length - 1]);
      } else if (restoredRef.current.episode && !eps.includes(restoredRef.current.episode)) {
        setEpisode(eps[eps.length - 1]);
      }
    } catch { /* ignore */ }
  }

  async function loadPrompts(ep: string) {
    const controller = new AbortController();
    loadPromptsAbortRef.current = controller;
    try {
      const [ngResult, fgResult, editedFgResult] = await Promise.allSettled([
        fetch(`/api/outputs/beat-board-prompt-${ep}.md`, { signal: controller.signal }),
        fetch(`/api/outputs/sequence-board-prompt-${ep}.md`, { signal: controller.signal }),
        fetch(`/api/outputs/four-groups-edited-${ep}.json`, { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return; // Stale response, discard
      // Parse each independently so one failure doesn't block the other
      if (ngResult.status === "fulfilled" && ngResult.value.ok) {
        try {
          const d = await ngResult.value.json();
          // Guard: only skip THIS block on abort/stale — don't exit entire function
          if (!controller.signal.aborted && currentEpisodeRef.current === ep) {
            if (d.content) setNinePrompts(parseNineGridPrompts(d.content));
          }
        } catch { console.warn("[loadPrompts] Failed to parse nine-grid response"); }
      }
      if (controller.signal.aborted) return; // Re-check before four-grid

      // ★ 四宫格：优先加载用户编辑版本（KV/磁盘持久化），否则回退到 Pipeline 原始输出
      let usedEdited = false;
      if (editedFgResult.status === "fulfilled" && editedFgResult.value.ok) {
        try {
          const d = await editedFgResult.value.json();
          if (!controller.signal.aborted && currentEpisodeRef.current === ep && d.content) {
            const parsed = JSON.parse(d.content);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setFourGroups(parsed);
              setPromptsEdited(true);
              usedEdited = true;
              console.log(`[loadPrompts] ✓ 已恢复用户编辑的四宫格提示词 (${parsed.length} groups, ep=${ep})`);
            }
          }
        } catch { console.warn("[loadPrompts] Failed to parse edited four-grid"); }
      }

      if (!usedEdited && fgResult.status === "fulfilled" && fgResult.value.ok) {
        try {
          const d = await fgResult.value.json();
          if (!controller.signal.aborted && currentEpisodeRef.current === ep) {
            if (d.content) setFourGroups(parseFourGridGroups(d.content));
          }
        } catch { console.warn("[loadPrompts] Failed to parse four-grid response"); }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return; // Expected: cancelled by episode switch
      console.error("[loadPrompts] error:", err);
      toast("提示词加载失败，请检查网络", "error");
    }
  }

  /**
   * 加载智能分镜专用九宫格提示词（从 KV 读取 Pipeline 智能分析结果）
   * 数据由 Pipeline 页「确认方案」写入 KV，key: feicai-smart-nine-prompts-{ep}
   */
  async function loadSmartNinePrompts(ep: string) {
    try {
      const raw = await kvLoad(`feicai-smart-nine-prompts-${ep}`);
      if (!raw) {
        setSmartNinePrompts([]);
        return;
      }
      const data = JSON.parse(raw);
      if (Array.isArray(data.beats) && data.beats.length > 0) {
        setSmartNinePrompts(data.beats);
      } else {
        setSmartNinePrompts([]);
      }
    } catch (e) {
      console.warn("[loadSmartNinePrompts] parse error:", e);
      setSmartNinePrompts([]);
    }
  }

  /**
   * 加载自定义宫格提示词（从 KV 持久化数据恢复）
   * key: feicai-custom-grid-prompts-{ep}
   */
  async function loadCustomPrompts(ep: string) {
    try {
      const raw = await kvLoad(`feicai-custom-grid-prompts-${ep}`);
      if (!raw) {
        if (currentEpisodeRef.current === ep) setCustomPrompts([]);
        return;
      }
      const data = JSON.parse(raw);
      if (currentEpisodeRef.current !== ep) return; // 竞态保护
      if (Array.isArray(data.prompts) && data.prompts.length > 0) {
        setCustomPrompts(data.prompts);
        if (data.gridCount) setCustomGridCount(data.gridCount);
      } else {
        setCustomPrompts([]);
      }
    } catch (e) {
      console.warn("[loadCustomPrompts] parse error:", e);
      if (currentEpisodeRef.current === ep) setCustomPrompts([]);
    }
  }

  // ── Settings helper ──

  function getSettings(): Record<string, string> {
    try { return JSON.parse(localStorage.getItem("feicai-settings") || "{}"); }
    catch { return {}; }
  }

  /** Switch image generation mode and persist to localStorage */
  function switchImageGenMode(mode: "api" | "geminiTab" | "jimeng") {
    setImageGenMode(mode);
    try { localStorage.setItem("feicai-image-gen-mode", mode); } catch { /* ignore */ }
    // 切换到 Gemini Tab 模式时弹出注意事项（除非用户已关闭提示）
    if (mode === "geminiTab") {
      try {
        if (localStorage.getItem("feicai-gemini-tab-warning-dismissed") !== "1") {
          setShowGeminiTabWarning(true);
        }
      } catch { setShowGeminiTabWarning(true); }
    }
    // 切换到即梦模式时检查凭证（从 Seedance 设置读取）
    if (mode === "jimeng") {
      try {
        const seedanceSettings = JSON.parse(localStorage.getItem("feicai-seedance-settings") || "{}");
        if (!seedanceSettings.sessionId) {
          toast("请先在 Seedance 页面的设置弹窗中配置即梦登录凭证", "error");
        }
      } catch {
        toast("请先在 Seedance 页面的设置弹窗中配置即梦登录凭证", "error");
      }
    }
  }

  /** 停止所有 Gemini Tab 生图任务 */
  async function stopGeminiTab() {
    // 1. 取消前端的 in-flight fetch 请求
    if (geminiTabAbortRef.current) {
      geminiTabAbortRef.current.abort();
      geminiTabAbortRef.current = null;
    }
    // 2. ★ 强制清除所有生成状态（防止 UI 卡在「生成中」，即使 fetch 已完成但后处理仍在进行）
    setGeneratingSet(new Set());
    setRegeneratingSet(new Set());
    setUpscalingSet(new Set());
    generatingLockRef.current.clear();
    // 3. 通知 Gemini Tab 服务端取消所有任务
    try {
      const gtHeaders: Record<string, string> = { "Content-Type": "application/json" };
      try {
        const gtSettings = JSON.parse(localStorage.getItem("feicai-gemini-tab-settings") || "{}");
        if (gtSettings.serviceUrl) gtHeaders["x-gemini-tab-url"] = gtSettings.serviceUrl;
      } catch { /* ignore */ }
      const res = await fetch(`/api/gemini-tab?path=${encodeURIComponent("/api/stop")}`, {
        method: "POST",
        headers: gtHeaders,
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      toast(data.message || "已停止所有生图任务", "info");
      console.log("[stopGeminiTab]", data);
    } catch (e) {
      console.warn("[stopGeminiTab] 通知服务端失败:", e);
      toast("已取消前端请求（服务端可能仍在运行）", "info");
    }
  }

  function getResolutionText(resolution?: string): string {
    switch (resolution) {
      case "4K": return "Output resolution 4K (4096px), ultra high resolution, extremely detailed, 8K quality. ";
      case "2K": return "Output resolution 2K (2048px), high resolution, detailed, sharp. ";
      default: return "Output resolution 1K (1024px). ";
    }
  }

  // ── Build clean generation prompt for image models ──

  /**
   * Build brief reference image labels for image generation prompts.
   * Instead of full consistency descriptions, just list which ref images map to which characters/scenes/props.
   * This keeps prompts concise and reduces model processing time.
   */
  function buildBriefRefLabels(activeRefUrls?: string[], hasBaseFrame?: boolean): string {
    // Only describe the reference images that are ACTUALLY being sent (no fallback to all)
    const latestCst = consistencyRef.current;
    const urlToLabel = new Map<string, { type: string; name: string }>();
    for (const c of latestCst.characters) {
      if (c.referenceImage) urlToLabel.set(c.referenceImage, { type: "Character", name: c.name });
    }
    for (const s of latestCst.scenes) {
      if (s.referenceImage) urlToLabel.set(s.referenceImage, { type: "Scene", name: s.name });
    }
    for (const p of latestCst.props) {
      if (p.referenceImage) urlToLabel.set(p.referenceImage, { type: "Prop", name: p.name });
    }

    // Only use the provided activeRefUrls — do NOT fall back to listing all refs
    const urls = activeRefUrls && activeRefUrls.length > 0 ? activeRefUrls : [];

    // ★ Build ordered items matching callImageApi ordering: Characters → Scenes → Props → Others
    const typeOrder: Record<string, number> = { Character: 0, Scene: 1, Prop: 2, Other: 3 };
    const typeCNMap: Record<string, string> = { Character: "角色", Scene: "场景", Prop: "道具", Other: "参考" };
    const orderedItems: { type: string; name: string }[] = [];
    let otherCount = 0;
    for (const url of urls) {
      const info = urlToLabel.get(url);
      if (info) {
        orderedItems.push(info);
      } else {
        otherCount++;
      }
    }
    orderedItems.sort((a, b) => (typeOrder[a.type] ?? 3) - (typeOrder[b.type] ?? 3));

    if (orderedItems.length === 0 && otherCount === 0) {
      const style = latestCst.style;
      const parts: string[] = [];
      // ★ 不再单独输出 artStyle — stylePrompt JSON 中已包含完整风格信息，
      //   独立的 artStyle 行会与风格参考图识别出的提示词冲突/污染
      if (style.stylePrompt) parts.push(`风格: ${style.stylePrompt}`);
      return parts.join("\n");
    }

    // ★ Build numbered ref mapping (matching callImageApi’s sequential numbering)
    // baseFrame is always 参考图1 when present, then ordered items follow
    let refIdx = 1;
    const indexLines: string[] = [];
    if (hasBaseFrame) {
      indexLines.push(`参考图${refIdx}是【★ 基准场景垂图】`);
      refIdx++;
    }
    for (const item of orderedItems) {
      const cn = typeCNMap[item.type] || "参考";
      indexLines.push(`参考图${refIdx}是【${cn}：${item.name}】`);
      refIdx++;
    }

    // ★ Style reference image comes LAST (matching callImageApi order)
    // Check if the style image is the same as an existing character/scene/prop ref — if so, merge label, don't duplicate
    const styleImgUrl = latestCst.style.styleImage;
    const hasStyleImage = includeStyleRefInModel && isValidImageRef(styleImgUrl);
    const styleIsDuplicate = hasStyleImage && urls.some(u => fuzzyMatchImage(u, styleImgUrl!));
    if (hasStyleImage && !styleIsDuplicate) {
      indexLines.push(`参考图${refIdx}是【🎨 风格参考图】`);
      refIdx++;
    }

    // Summary line for model context
    const refTotal = (hasBaseFrame ? 1 : 0) + orderedItems.length + (hasStyleImage && !styleIsDuplicate ? 1 : 0);
    const charNames = orderedItems.filter(i => i.type === "Character").map(i => i.name);
    const sceneNames = orderedItems.filter(i => i.type === "Scene").map(i => i.name);
    const propNames = orderedItems.filter(i => i.type === "Prop").map(i => i.name);
    const briefParts: string[] = [];
    if (hasBaseFrame) briefParts.push(`Base frame ×1 (★ source scene)`);
    if (charNames.length > 0) briefParts.push(`Characters: ${charNames.join(", ")}`);
    if (sceneNames.length > 0) briefParts.push(`Scenes: ${sceneNames.join(", ")}`);
    if (propNames.length > 0) briefParts.push(`Props: ${propNames.join(", ")}`);
    if (hasStyleImage && !styleIsDuplicate) briefParts.push(`Style reference ×1 (🎨 art style)`);

    const parts: string[] = [];
    parts.push(`[${refTotal} REFERENCE IMAGES ATTACHED: ${briefParts.join(" | ")}. Each image has a text label (参考图1, 参考图2...) interleaved before it — follow those labels strictly.]`);
    parts.push(`参考图序号对应关系：${indexLines.join("；")}`);
    const style = latestCst.style;
    // ★ 不再单独输出 artStyle — stylePrompt JSON 中已包含完整风格信息
    if (style.stylePrompt) parts.push(`风格: ${style.stylePrompt}`);
    return parts.join("\n");
  }

  /**
   * Build full prompt preview (same as what goes to the image model) and open in a new tab.
   * Shows: refLabels + grid prompt + callImageApi reinforcement + reference labels list.
   */
  async function viewFullPrompt(mode: "nine" | "four" | "smartNine" | "custom", beatIdx?: number) {
    const settings = getSettings();
    // Build the prompt exactly like generateNineGrid / generateFourGrid does
    let refImages: string[];
    let promptText: string;
    let gridTitle: string;

    if (mode === "nine" || mode === "smartNine" || mode === "custom") {
      const isSmartNine = mode === "smartNine";
      const isCustom = mode === "custom";
      const globalRefIds = isCustom ? (customGridRefIdsByEp[episode] || []) : isSmartNine ? smartNineGridRefIds : nineGridRefIds;
      refImages = globalRefIds && globalRefIds.length > 0
        ? resolveRefBindIds(consistency, globalRefIds)
        : [];
      // ★ 智能分镜模式需传入 smartNinePrompts，否则会回退到普通九宫格的 ninePrompts
      promptText = buildCleanNineGridPrompt(refImages, isCustom ? customPrompts : isSmartNine ? smartNinePrompts : undefined, isCustom ? customGridCount : undefined);
      gridTitle = `${episode.toUpperCase()} ${isCustom ? `自定义宫格(${customGridCount}格)` : isSmartNine ? "智能分镜九宫格" : "九宫格"}生图提示词`;
    } else {
      const bi = beatIdx ?? fourBeat;
      const scenes = fourGroups[bi] || [];
      const nineRef = gridImages[`nine-${episode}-${bi}`] || gridImages[`smartNine-${episode}-${bi}`];
      let manualRefs: string[];
      if (fourGridRefIds[bi] && fourGridRefIds[bi]!.length > 0) {
        manualRefs = resolveRefBindIds(consistency, fourGridRefIds[bi]!);
      } else {
        manualRefs = []; // 四宫格没有绑定时，仅用垫图+提示词，不继承九宫格参考图
      }
      const seenUrls = new Set<string>(nineRef ? [nineRef] : []);
      const dedupedManual = manualRefs.filter(u => { if (seenUrls.has(u)) return false; seenUrls.add(u); return true; });
      refImages = nineRef ? [nineRef, ...dedupedManual] : dedupedManual;
      promptText = buildCleanFourGridPrompt(scenes, refImages);
      gridTitle = `${episode.toUpperCase()} 组${bi + 1} 四宫格生图提示词`;
    }

    // ── Run the SAME individual ref image pipeline as callImageApi ──
    const urlToInfo = new Map<string, { type: string; name: string; description: string }>();
    for (const c of consistency.characters) {
      if (c.referenceImage) urlToInfo.set(c.referenceImage, { type: "Character", name: c.name, description: c.description });
    }
    for (const s of consistency.scenes) {
      if (s.referenceImage) urlToInfo.set(s.referenceImage, { type: "Scene", name: s.name, description: s.description });
    }
    for (const p of consistency.props) {
      if (p.referenceImage) urlToInfo.set(p.referenceImage, { type: "Prop", name: p.name, description: p.description });
    }

    interface SheetEntry { type: string; typeCN: string; names: string[]; imageUrl: string; label: string; sizeKB: number }
    const sheetEntries: SheetEntry[] = [];

    // Detect base frame: for four-grid mode, nineRef is in refImages but not in urlToInfo
    const isViewFourGrid = mode === "four";
    const viewBaseFrameUrl = isViewFourGrid ? gridImages[`nine-${episode}-${(beatIdx ?? fourBeat)}`] : undefined;

    toast("正在准备参考图预览...", "info");

    // ★ BASE FRAME: push FIRST for four-grid mode (same as callImageApi)
    if (viewBaseFrameUrl && viewBaseFrameUrl.length > 200) {
      let baseData = viewBaseFrameUrl;
      try {
        if (viewBaseFrameUrl.startsWith("data:")) {
          baseData = await compressImage(viewBaseFrameUrl, 2048, 0.90, 3_000_000);
        }
      } catch { /* use original */ }
      sheetEntries.push({
        type: "BASE", typeCN: "★ 垫图",
        names: ["九宫格基础场景"],
        imageUrl: baseData,
        label: `[★ BASE FRAME — SOURCE SCENE] This is the source scene from the nine-grid storyboard.`,
        sizeKB: Math.round(baseData.length * 3 / 4 / 1024),
      });
    }

    // Send each reference image individually (ordered: characters → scenes → props → others)
    const orderedViewItems: { url: string; type: string; typeCN: string; name: string }[] = [];
    for (const u of refImages.slice(0, 14)) {
      if (viewBaseFrameUrl && u === viewBaseFrameUrl) continue;
      if (!u || u.length < 10) continue;
      const info = urlToInfo.get(u);
      if (info) {
        const typeCN = info.type === "Character" ? "角色" : info.type === "Scene" ? "场景" : "道具";
        orderedViewItems.push({ url: u, type: info.type, typeCN, name: info.name });
      } else {
        orderedViewItems.push({ url: u, type: "Other", typeCN: "参考", name: "" });
      }
    }
    const typeOrder: Record<string, number> = { Character: 0, Scene: 1, Prop: 2, Other: 3 };
    orderedViewItems.sort((a, b) => (typeOrder[a.type] ?? 3) - (typeOrder[b.type] ?? 3));

    for (const item of orderedViewItems) {
      const u = item.url;
      let imageUrl = u;
      let sizeKB = 0;
      if (u.startsWith("data:") && u.length > 200) {
        // ★ 参考图不压缩 — 保留原始质量（参考图对生成质量至关重要）
        sizeKB = Math.round(u.length * 3 / 4 / 1024);
      }
      const typeDesc = item.type === "Character" ? "keep identical face, hair, outfit, body proportions."
        : item.type === "Scene" ? "match environment, architecture, lighting."
        : item.type === "Prop" ? "reproduce exact design and material."
        : "Use as visual reference.";
      const label = item.name
        ? `【${item.typeCN}：${item.name}】${typeDesc}`
        : `【${item.typeCN}】${typeDesc}`;
      sheetEntries.push({
        type: item.type.toUpperCase(), typeCN: item.typeCN,
        names: item.name ? [item.name] : [item.typeCN],
        imageUrl,
        label,
        sizeKB,
      });
    }

    // Build a set of all original (pre-compression) ref URLs used in sheetEntries for style dedup
    const viewUsedOriginalUrls = new Set<string>();
    if (viewBaseFrameUrl) viewUsedOriginalUrls.add(viewBaseFrameUrl);
    for (const item of orderedViewItems) viewUsedOriginalUrls.add(item.url);

    // ★ STYLE REFERENCE IMAGE: append LAST (matching callImageApi order)
    // If same image as an existing ref, merge label instead of duplicating
    const viewStyleImg = consistency.style.styleImage;
    if (includeStyleRefInModel && isValidImageRef(viewStyleImg)) {
      const artDesc = consistency.style.artStyle ? ` (${consistency.style.artStyle})` : "";
      const styleLabel =
        `【🎨 风格参考图】This is also the STYLE / AESTHETIC reference image${artDesc}. ` +
        `You MUST match its art style, color palette, rendering technique, line quality, texture, and overall mood in the generated image. ` +
        `Apply this visual style consistently to ALL frames.`;
      const viewStyleIsDup = [...viewUsedOriginalUrls].some(u => fuzzyMatchImage(u, viewStyleImg));
      if (viewStyleIsDup) {
        // Style image is the same as an existing ref — find the matching sheetEntry by orderedViewItems index
        const matchItemIdx = orderedViewItems.findIndex(i => fuzzyMatchImage(i.url, viewStyleImg));
        // sheetEntries layout: [baseFrame?] + [orderedViewItems...]
        const sheetIdx = matchItemIdx >= 0 ? matchItemIdx + (viewBaseFrameUrl ? 1 : 0) : -1;
        if (sheetIdx >= 0 && sheetIdx < sheetEntries.length) {
          sheetEntries[sheetIdx].label += ` ${styleLabel}`;
        }
      } else {
        // ★ /api/ URL 引用需先解析为 data URL，风格参考图不压缩 — 保留原始质量
        let styleData = viewStyleImg;
        if (viewStyleImg.startsWith("/api/")) {
          try {
            styleData = await compressImage(viewStyleImg, 8192, 1.0, 50_000_000);
          } catch { /* 回退使用 URL */ }
        }
        sheetEntries.push({
          type: "STYLE", typeCN: "🎨 风格参考",
          names: ["风格参考"],
          imageUrl: styleData,
          label: styleLabel.replace('also the STYLE', 'the STYLE'),
          sizeKB: Math.round(styleData.length * 3 / 4 / 1024),
        });
      }
    }

    // ★ Add sequential numbering (参考图N) to each label — matches callImageApi order
    sheetEntries.forEach((entry, i) => {
      entry.label = `参考图${i + 1} ${entry.label}`;
    });

    const refLabelLines = sheetEntries.map(e => e.label);
    const totalRefs = sheetEntries.length;

    const finalPrompt = promptText.slice(0, 8000);

    // API request metadata
    const effectiveSize = consistency.style.resolution || "4K";
    const effectiveRatio = consistency.style.aspectRatio || "16:9";
    const apiMeta = {
      model: settings["img-model"] || "(未配置)",
      baseUrl: settings["img-url"] || "(未配置)",
      format: settings["img-format"] || "gemini",
      imageSize: effectiveSize,
      aspectRatio: effectiveRatio,
      refCount: totalRefs,
    };

    // Escape HTML
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(gridTitle)}</title>
<style>
  body { background: #0a0a0a; color: #e0e0e0; font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; padding: 40px; max-width: 1200px; margin: 0 auto; line-height: 1.7; }
  h1 { color: #d4a853; font-size: 24px; border-bottom: 2px solid #d4a853; padding-bottom: 12px; }
  h2 { color: #d4a853; font-size: 18px; margin-top: 32px; }
  .meta { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 16px; margin: 16px 0; font-size: 13px; }
  .meta span { color: #888; }
  .meta b { color: #d4a853; }
  .prompt-box { background: #111; border: 1px solid #444; border-radius: 8px; padding: 20px; margin: 16px 0; white-space: pre-wrap; font-family: 'Consolas', 'Courier New', monospace; font-size: 13px; line-height: 1.8; }
  .section-tag { display: inline-block; background: #d4a853; color: #000; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; margin-right: 8px; }
  .copy-btn { background: #d4a853; color: #000; border: none; padding: 8px 20px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; margin-top: 12px; }
  .copy-btn:hover { background: #e0b860; }
  .char-count { color: #888; font-size: 12px; margin-top: 4px; }
  .sheet-list { display: flex; flex-direction: column; gap: 20px; margin: 16px 0; }
  .sheet-card { background: #141414; border: 1px solid #333; border-radius: 8px; overflow: hidden; }
  .sheet-card:hover { border-color: #d4a853; }
  .sheet-card img { width: 100%; max-height: 500px; object-fit: contain; display: block; cursor: pointer; background: #0a0a0a; }
  .sheet-card img.expanded { max-height: none; }
  .sheet-card-body { padding: 12px 16px; border-top: 1px solid #333; }
  .sheet-badge { display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px; margin-right: 8px; }
  .sheet-badge.char { background: #2d4a2d; color: #7dca7d; }
  .sheet-badge.scene { background: #2d3a4a; color: #7db8ca; }
  .sheet-badge.prop { background: #4a3a2d; color: #ca9e7d; }
  .sheet-badge.style { background: #4a2d4a; color: #ca7dca; }
  .sheet-badge.other { background: #3a3a3a; color: #aaa; }
  .sheet-badge.base { background: #4a4a2d; color: #caca7d; }
  .sheet-names { font-size: 15px; font-weight: 600; color: #e0e0e0; }
  .sheet-label { font-size: 12px; color: #999; margin-top: 8px; line-height: 1.6; }
  .sheet-size { font-size: 11px; color: #555; margin-top: 4px; }
  .no-img { width: 100%; height: 120px; display: flex; align-items: center; justify-content: center; background: #1a1a1a; color: #555; font-size: 12px; }
</style></head><body>
<h1>${esc(gridTitle)}</h1>

<div class="meta">
  <span>模型: </span><b>${esc(apiMeta.model)}</b>&nbsp;&nbsp;
  <span>接口: </span><b>${esc(apiMeta.baseUrl)}</b>&nbsp;&nbsp;
  <span>格式: </span><b>${esc(apiMeta.format)}</b>&nbsp;&nbsp;
  <span>尺寸: </span><b>${esc(apiMeta.imageSize)}</b>&nbsp;&nbsp;
  <span>比例: </span><b>${esc(apiMeta.aspectRatio)}</b>&nbsp;&nbsp;
  <span>参考图: </span><b>${apiMeta.refCount} 张合成sheet</b>
</div>

${sheetEntries.length > 0 ? `
<h2><span class="section-tag">REFS</span> 合成参考图 (${sheetEntries.length} 张 · 与发送给模型的完全一致)</h2>
<p style="color:#888;font-size:12px;">以下为实际发送给图像模型的合成参考图（composite sheet）。角色/场景/道具名已烧入图片像素。点击图片可展开原尺寸查看。</p>
<div class="sheet-list">
${sheetEntries.map((entry, i) => {
  const badgeClass = entry.type === "CHARACTER" ? "char" : entry.type === "SCENE" ? "scene" : entry.type === "PROP" ? "prop" : entry.type === "STYLE" ? "style" : entry.type === "BASE" ? "base" : "other";
  const imgTag = entry.imageUrl.length > 100
    ? `<img src="${entry.imageUrl}" alt="${esc(entry.names.join(', '))}" onclick="this.classList.toggle('expanded')" />`
    : `<div class="no-img">图片数据不可用</div>`;
  return `<div class="sheet-card">
  ${imgTag}
  <div class="sheet-card-body">
    <span class="sheet-badge ${badgeClass}">${esc(entry.typeCN)}</span>
    <span class="sheet-names">[${i + 1}/${sheetEntries.length}] ${esc(entry.names.join(" · "))}</span>
    ${entry.sizeKB > 0 ? `<div class="sheet-size">合成后大小: ${entry.sizeKB} KB</div>` : ""}
    <div class="sheet-label">${esc(entry.label)}</div>
  </div>
</div>`;
}).join("\n")}
</div>
` : ""}

<h2><span class="section-tag">PROMPT</span> 完整提示词文本 (${finalPrompt.length} 字符)</h2>
<div class="prompt-box">${esc(finalPrompt)}</div>
<button class="copy-btn" onclick="navigator.clipboard.writeText(document.querySelector('.prompt-box').textContent).then(()=>this.textContent='已复制 ✓')">📋 复制提示词</button>
<p class="char-count">提示词长度: ${finalPrompt.length} / 8000 字符${finalPrompt.length > 7000 ? ' ⚠️ 接近上限' : ''}</p>

<h2><span class="section-tag">API</span> 请求体结构</h2>
<div class="prompt-box">${esc(JSON.stringify({
      apiKey: "sk-***",
      baseUrl: apiMeta.baseUrl,
      model: apiMeta.model,
      prompt: "(见上方完整提示词)",
      referenceImages: Array.from({ length: apiMeta.refCount }, (_, i) => `[参考图${i + 1} base64/URL data...]`),
      referenceLabels: refLabelLines.length > 0 ? refLabelLines.map(l => l.slice(0, 80) + "...") : undefined,
      imageSize: apiMeta.imageSize,
      aspectRatio: apiMeta.aspectRatio,
      format: apiMeta.format,
    }, null, 2))}</div>

</body></html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    // Clean up blob URL after a short delay
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /**
   * Extract English image prompt from a cell text containing **[IMG]** marker.
   * Returns empty string if no marker found (backward-compatible with old .md files).
   */
  function extractImagePrompt(cellText: string): string {
    const match = cellText.match(/\*\*\[IMG\]\*\*\s*(.+)/);
    return match ? match[1].trim() : "";
  }

  function buildCleanNineGridPrompt(refUrls?: string[], overridePrompts?: string[], gridCount?: number): string {
    const prompts = overridePrompts && overridePrompts.length > 0 ? overridePrompts : ninePrompts;
    const refLabels = buildBriefRefLabels(refUrls);
    const resTxt = getResolutionText(consistency.style.resolution);
    const isPortrait = consistency.style.aspectRatio === "9:16";

    // 动态计算宫格布局尺寸
    const totalCells = gridCount ?? 9;
    const cols = totalCells <= 4 ? 2 : totalCells <= 9 ? 3 : totalCells <= 16 ? 4 : 5;
    const rows = Math.ceil(totalCells / cols);

    // 动态生成 grid layout diagram
    function buildGridDiagram(c: number, r: number, total: number, portrait: boolean): string {
      const cellWidth = portrait ? 4 : 9;
      const lines: string[] = [];
      // 顶部边框
      lines.push("┌" + Array.from({ length: c }, () => "─".repeat(cellWidth)).join("┬") + "┐");
      for (let ri = 0; ri < r; ri++) {
        if (portrait) {
          // 竖版: 三行高度
          const topLine = "│" + Array.from({ length: c }, (_, ci) => {
            const idx = ri * c + ci + 1;
            return idx <= total ? " ".repeat(cellWidth) : " ".repeat(cellWidth);
          }).join("│") + "│";
          const midLine = "│" + Array.from({ length: c }, (_, ci) => {
            const idx = ri * c + ci + 1;
            if (idx > total) return " ".repeat(cellWidth);
            const label = `S${idx}`;
            const pad = cellWidth - label.length;
            const left = Math.floor(pad / 2);
            return " ".repeat(left) + label + " ".repeat(pad - left);
          }).join("│") + "│";
          lines.push(topLine, midLine, topLine);
        } else {
          // 横版: 单行
          const row = "│" + Array.from({ length: c }, (_, ci) => {
            const idx = ri * c + ci + 1;
            if (idx > total) return " ".repeat(cellWidth);
            const label = `Shot ${idx}`;
            const pad = cellWidth - label.length;
            const left = Math.floor(pad / 2);
            return " ".repeat(left) + label + " ".repeat(pad - left);
          }).join("│") + "│";
          lines.push(row);
        }
        // 行间分隔/底部边框
        if (ri < r - 1) {
          lines.push("├" + Array.from({ length: c }, () => "─".repeat(cellWidth)).join("┼") + "┤");
        }
      }
      lines.push("└" + Array.from({ length: c }, () => "─".repeat(cellWidth)).join("┴") + "┘");
      return lines.join("\n");
    }

    const diagramBody = buildGridDiagram(cols, rows, totalCells, isPortrait);
    const gridLayoutDiagram = isPortrait
      ? `GRID LAYOUT (${cols}×${rows} portrait cells, read left→right, top→bottom):\n${diagramBody}\nEach cell is PORTRAIT (taller than wide, 9:16 ratio).`
      : `GRID LAYOUT (read left→right, top→bottom):\n${diagramBody}`;

    // 动态生成 shot 位置标签
    function getShotLabel(idx: number): string {
      const ri = Math.floor(idx / cols) + 1;
      const ci = idx % cols;
      const colNames = cols === 2
        ? ["Left", "Right"]
        : cols === 3
        ? ["Left", "Center", "Right"]
        : cols === 4
        ? ["Left", "CenterLeft", "CenterRight", "Right"]
        : ["Col1", "Col2", "Col3", "Col4", "Col5"];
      return `Row${ri}-${colNames[ci] || `Col${ci + 1}`}`;
    }

    // ★ Consistency tail instruction — appended to all grid prompts
    const consistencyTail = `\n\nUse the reference images as the primary subject. Pay attention to the spatial layout of the environment, the relative positions of characters and all objects in the space. Generate coherent storyboard frames from different angles that follow the plot progression. Maintain strict consistency with the art style of the reference images.`;

    // ★ Era/world background hint — time-of-day/lighting is now determined per-shot by the LLM via Gem.txt
    const eraHint = consistency.style.timeSetting
      ? `\n\nERA / WORLD BACKGROUND: ${consistency.style.timeSetting}.`
      : "";

    const cellRatioHint = isPortrait ? ` CRITICAL: Each of the ${totalCells} cells must be PORTRAIT orientation (9:16 aspect ratio, taller than wide). Do NOT make landscape/wide cells.` : "";

    // 结尾指令
    const importantTail = `\n\nIMPORTANT: Place each shot EXACTLY in its designated grid cell as shown above. ${totalCells} cells arranged in ${rows} rows × ${cols} columns, clear composition, consistent lighting across all shots, no timecode, no subtitles.${cellRatioHint}${eraHint}${consistencyTail}`;

    // Try to extract English keyword prompts from **[IMG]** markers
    const imagePrompts = prompts.map(p => extractImagePrompt(p));
    const hasImagePrompts = imagePrompts.filter(p => p.length > 10).length >= Math.min(5, Math.ceil(totalCells * 0.5));

    const buildGridDesc = (useImagePrompts: boolean) => {
      return prompts.map((p, i) => {
        if (i >= totalCells) return null;
        const label = getShotLabel(i);
        if (useImagePrompts && imagePrompts[i] && imagePrompts[i].length > 10) {
          return `Shot ${i + 1} (${label}): ${imagePrompts[i]}`;
        }
        const clean = p.replace(/\*\*/g, "").replace(/#+\s*/g, "").replace(/\n+/g, " ").trim();
        return `Shot ${i + 1} (${label}): ${clean.slice(0, 150)}`;
      }).filter(Boolean).join("\n");
    };

    const gridDesc = buildGridDesc(hasImagePrompts);
    return `${refLabels ? refLabels + "\n\n" : ""}Generate a ${cols}×${rows} cinematic storyboard grid image. Overall image aspect ratio: ${consistency.style.aspectRatio}. Each cell aspect ratio: ${consistency.style.aspectRatio}. ${resTxt}\n\n${gridLayoutDiagram}\n\n${gridDesc}${importantTail}`;
  }

  function buildCleanFourGridPrompt(scenes: string[], refUrls?: string[]): string {
    const refLabels = buildBriefRefLabels(refUrls, true); // hasBaseFrame=true for four-grid
    const resTxt = getResolutionText(consistency.style.resolution);
    const isPortrait = consistency.style.aspectRatio === "9:16";

    // Visual grid layout diagram for 2×2 — 竖版用窄高格
    const fourGridDiagram = isPortrait
      ? `GRID LAYOUT (2×2 portrait cells, read left→right, top→bottom):
┌──────┬──────┐
│      │      │
│  F1  │  F2  │
│      │      │
├──────┼──────┤
│      │      │
│  F3  │  F4  │
│      │      │
└──────┴──────┘
Each cell is PORTRAIT (taller than wide, 9:16 ratio).`
      : `GRID LAYOUT (read left→right, top→bottom):
┌──────────┬──────────┐
│ Frame 1  │ Frame 2  │
├──────────┼──────────┤
│ Frame 3  │ Frame 4  │
└──────────┴──────────┘`;

    // ★ Era/world background hint — time-of-day/lighting is now determined per-shot by the LLM via Gem.txt
    const eraHint = consistency.style.timeSetting
      ? `\n\nERA / WORLD BACKGROUND: ${consistency.style.timeSetting}.`
      : "";

    // Sequential continuity constraint — each frame builds on the previous
    const continuityRule = `\n\nSEQUENTIAL CONTINUITY RULE:
- Frame 1: Establishing shot based on the source scene (base frame). Set up characters, environment, lighting.
- Frame 2: Continues DIRECTLY from Frame 1 — same characters, setting, lighting; only advance the action/camera.
- Frame 3: Continues DIRECTLY from Frame 2 — maintain all visual elements, progress the motion/emotion.
- Frame 4: Continues DIRECTLY from Frame 3 — final beat of the sequence, consistent with all previous frames.
Each frame MUST look like the NEXT MOMENT of the previous frame. No scene jumps, no new characters, no environment shifts between frames. Treat this as a continuous camera shot broken into 4 sequential moments.\n\nVISUAL PRIORITY: The attached BASE FRAME image is the ground truth for all visual elements. If the text descriptions below mention different characters, creatures, or environments than what appears in the base frame image, ALWAYS follow the base frame image. The text descriptions only guide the ACTION PROGRESSION, not the visual identity of characters/creatures/settings.`;

    const tail = `IMPORTANT: Place each frame EXACTLY in its designated grid cell as shown above. 4 frames showing continuous action/emotion sequence, no timecode, no subtitles.${continuityRule}`;

    // ★ Consistency tail instruction
    const consistencyTail = `\n\nUse the reference images as the primary subject. Pay attention to the spatial layout of the environment, the relative positions of characters and all objects in the space. Generate coherent storyboard frames from different angles that follow the plot progression. Maintain strict consistency with the art style of the reference images.`;

    // Try to extract English keyword prompts from **[IMG]** markers
    const imagePrompts = scenes.map(s => extractImagePrompt(s));
    const hasImagePrompts = imagePrompts.filter(p => p.length > 10).length >= 2;

    if (hasImagePrompts) {
      const frameLabels = ["Row1-Left", "Row1-Right", "Row2-Left", "Row2-Right"];
      const gridDesc = imagePrompts.map((p, i) => {
        if (p.length > 10) {
          return `Frame ${i + 1} (${frameLabels[i]}): ${p}`;
        }
        const clean = scenes[i].replace(/\*\*/g, "").replace(/#+\s*/g, "").replace(/\n+/g, " ").trim();
        return `Frame ${i + 1} (${frameLabels[i]}): ${clean.slice(0, 200)}`;
      }).join("\n");

      const cellRatioHint = isPortrait ? " CRITICAL: Each of the 4 cells must be PORTRAIT orientation (9:16 aspect ratio, taller than wide). Do NOT make landscape/wide cells." : "";
      return `${refLabels ? refLabels + "\n\n" : ""}Generate a 2×2 sequential action grid image. Overall image aspect ratio: ${consistency.style.aspectRatio}. Each cell aspect ratio: ${consistency.style.aspectRatio}. ${resTxt}\n\n${fourGridDiagram}\n\n${gridDesc}\n\n${tail}${cellRatioHint}${eraHint}${consistencyTail}`;
    }

    // Fallback: legacy format — still use English instructions
    const frameLabelsLegacy = ["Row1-Left", "Row1-Right", "Row2-Left", "Row2-Right"];
    const gridDesc = scenes.map((s, i) => {
      const clean = s.replace(/\*\*/g, "").replace(/#+\s*/g, "").replace(/\n+/g, " ").trim();
      return `Frame ${i + 1} (${frameLabelsLegacy[i]}): ${clean.slice(0, 200)}`;
    }).join("\n");

    const cellRatioHint = isPortrait ? " CRITICAL: Each of the 4 cells must be PORTRAIT orientation (9:16 aspect ratio, taller than wide). Do NOT make landscape/wide cells." : "";
    return `${refLabels ? refLabels + "\n\n" : ""}Generate a 2×2 sequential action grid image. Overall image aspect ratio: ${consistency.style.aspectRatio}. Each cell aspect ratio: ${consistency.style.aspectRatio}. ${resTxt}\n\n${fourGridDiagram}\n\n${gridDesc}\n\n${tail}${cellRatioHint}${eraHint}${consistencyTail}`;
  }

  function buildSingleCellPrompt(cellPrompt: string, refUrls?: string[]): string {
    const refLabels = buildBriefRefLabels(refUrls);
    const resTxt = getResolutionText(consistency.style.resolution);

    // Try to use English image prompt if available
    const imgPrompt = extractImagePrompt(cellPrompt);
    const consistencyTail = `\n\nUse the reference images as the primary subject. Pay attention to the spatial layout of the environment, the relative positions of characters and all objects in the space. Generate coherent storyboard frames from different angles that follow the plot progression. Maintain strict consistency with the art style of the reference images.`;
    // ★ Era/world background hint — time-of-day/lighting is already embedded per-shot by LLM
    const eraHint = consistency.style.timeSetting
      ? ` Era/world: ${consistency.style.timeSetting}.`
      : "";
    if (imgPrompt.length > 10) {
      return `${refLabels ? refLabels + "\n\n" : ""}${imgPrompt}\n\nGenerate a high-quality cinematic storyboard frame. Aspect ratio ${consistency.style.aspectRatio}. ${resTxt}Stable composition, realistic lighting, consistent characters, no timecode, no subtitles.${eraHint}${consistencyTail}`;
    }

    // Fallback: use narrative text — still wrap in English instructions
    const clean = cellPrompt.replace(/\*\*/g, "").replace(/#+\s*/g, "").replace(/\n+/g, " ").trim();
    return `${refLabels ? refLabels + "\n\n" : ""}${clean.slice(0, 800)}\n\nGenerate a high-quality cinematic storyboard frame. Aspect ratio ${consistency.style.aspectRatio}. ${resTxt}Stable composition, realistic lighting, consistent characters, no timecode, no subtitles.${eraHint}${consistencyTail}`;
  }

  // ── Gemini Tab 服务可用性前置检查 ──

  /**
   * 确保 GeminiTab 服务可达并就绪。
   * 先 GET /api/gemini-tab?path=/api/browser 快速探测，
   * 不可达则自动调用 /api/gemini-tab/start-service 启动服务并等待就绪。
   * @returns true=服务可用, false=无法启动
   */
  async function ensureGeminiTabReady(): Promise<boolean> {
    // 从 localStorage 读取自定义服务地址
    const gtHeaders: Record<string, string> = { "Content-Type": "application/json" };
    try {
      const gtSettings = JSON.parse(localStorage.getItem("feicai-gemini-tab-settings") || "{}");
      if (gtSettings.serviceUrl) gtHeaders["x-gemini-tab-url"] = gtSettings.serviceUrl;
    } catch { /* ignore */ }

    // 快速探测服务是否可达
    try {
      const probe = await fetch(`/api/gemini-tab?path=${encodeURIComponent("/api/browser")}`, {
        headers: gtHeaders,
        signal: AbortSignal.timeout(5000),
      });
      if (probe.ok) {
        const probeData = await probe.json().catch(() => null);
        // 代理层收到上游 JSON 即视为服务可达
        if (probeData && !probeData.error?.includes("无法连接")) return true;
      }
    } catch { /* 不可达 */ }

    // 服务未运行，尝试自动启动
    console.log("[ensureGeminiTabReady] 服务未就绪，正在自动启动...");
    toast("正在启动 Gemini Tab 服务...", "info");
    try {
      const startRes = await fetch("/api/gemini-tab/start-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const startData = await startRes.json();
      if (!startData.success) {
        toast(`Gemini Tab 服务启动失败: ${startData.error || "未知错误"}`, "error");
        return false;
      }
      // 等待服务完全就绪（最多 15 秒，每 1 秒探测一次）
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const check = await fetch(`/api/gemini-tab?path=${encodeURIComponent("/api/browser")}`, {
            headers: gtHeaders,
            signal: AbortSignal.timeout(3000),
          });
          if (check.ok) {
            const checkData = await check.json().catch(() => null);
            if (checkData && !checkData.error?.includes("无法连接")) {
              console.log(`[ensureGeminiTabReady] 服务就绪 (${i + 1}s)`);
              return true;
            }
          }
        } catch { /* 继续等待 */ }
      }
      toast("Gemini Tab 服务启动超时，请稍后重试或前往设置页手动启动", "error");
      return false;
    } catch (e) {
      toast(`Gemini Tab 服务启动异常: ${e instanceof Error ? e.message : String(e)}`, "error");
      return false;
    }
  }

  // ── Generate image helper ──

  async function callImageApi(prompt: string, refImages: string[] = [], baseFrameUrl?: string, cellLabel?: string, targetInfo?: { listKey: "characters" | "scenes" | "props"; itemId: string }, gridKey?: string): Promise<string | null> {
    const settings = getSettings();
    // ★ Read from ref to get the LATEST mode (avoids stale closure from useCallback)
    const currentImageGenMode = imageGenModeRef.current;
    // ── Gemini Tab / 即梦 mode: no API Key needed; API mode: require key ──
    if (currentImageGenMode !== "geminiTab" && currentImageGenMode !== "jimeng") {
      const apiKey = settings["img-key"];
      if (!apiKey) { toast("请先在设置页配置图像 API Key", "error"); return null; }
    }

    // ★ ALWAYS read latest consistency from ref (avoids stale closure from useCallback)
    const latestConsistency = consistencyRef.current;

    // ★ COMPOSITE REFERENCE IMAGES: group by type, compose into labeled sheets
    // This reduces 5-7 individual images → 1-3 composites with labels burned in.
    const urlToInfo = new Map<string, { type: string; name: string; description: string }>();
    for (const c of latestConsistency.characters) {
      if (c.referenceImage) urlToInfo.set(c.referenceImage, { type: "Character", name: c.name, description: c.description });
    }
    for (const s of latestConsistency.scenes) {
      if (s.referenceImage) urlToInfo.set(s.referenceImage, { type: "Scene", name: s.name, description: s.description });
    }
    for (const p of latestConsistency.props) {
      if (p.referenceImage) urlToInfo.set(p.referenceImage, { type: "Prop", name: p.name, description: p.description });
    }

    // ★ INDIVIDUAL REFERENCE IMAGES: compress each individually, no SHEET compositing
    // Each image gets its own label like "参考图N【角色:林旭】"
    const processedRefs: string[] = [];
    const referenceLabels: string[] = [];
    const originalRefUrls: string[] = []; // Track pre-compression URLs for dedup
    let skippedCount = 0;

    // ★ BASE FRAME: if provided, compress to 2048px and push FIRST (highest priority for model)
    // Plan C: baseFrameUrl 可以是 data URL、HTTP URL 或 /api/grid-image URL
    if (baseFrameUrl && (baseFrameUrl.length > 200 || baseFrameUrl.startsWith("/api/"))) {
      let baseFrameData = baseFrameUrl;
      try {
        // compressImage 支持 data URL 和同源 URL（/api/grid-image?key=xxx）
        if (baseFrameUrl.startsWith("data:") || baseFrameUrl.startsWith("/api/")) {
          baseFrameData = await compressImage(baseFrameUrl, 2048, 0.90, 3_000_000);
        }
      } catch (e) {
        console.warn(`[callImageApi] ⚠ Base frame compression failed, using original:`, e);
      }
      processedRefs.push(baseFrameData);
      originalRefUrls.push(baseFrameUrl);
      referenceLabels.push(
        `[★ BASE FRAME — SOURCE SCENE] This is the source scene from the nine-grid storyboard. Generate 4 sub-frames that are continuous action details of THIS exact scene. The visual elements in this image (characters, creatures, environment, lighting, props) are the GROUND TRUTH — they take PRIORITY over any text descriptions below. MUST maintain identical characters, creatures, environment, lighting, camera angle, and composition. Do NOT change the setting, swap creatures, or introduce new elements not present in this image.`
      );
      console.log(`[callImageApi] ✓ Base frame attached FIRST (${(baseFrameData.length / 1024).toFixed(0)}KB)`);
    }

    // Send each reference image individually (ordered: characters → scenes → props → others)
    const orderedItems: { url: string; type: string; typeCN: string; name: string }[] = [];
    for (const u of refImages.slice(0, 14)) {
      if (baseFrameUrl && u === baseFrameUrl) continue; // skip base frame (already processed)
      if (!u || u.length < 10) { skippedCount++; continue; }
      const info = urlToInfo.get(u);
      if (info) {
        const typeCN = info.type === "Character" ? "角色" : info.type === "Scene" ? "场景" : "道具";
        orderedItems.push({ url: u, type: info.type, typeCN, name: info.name });
      } else {
        orderedItems.push({ url: u, type: "Other", typeCN: "参考", name: "" });
      }
    }
    // Sort: Characters first, then Scenes, then Props, then Others
    const typeOrder: Record<string, number> = { Character: 0, Scene: 1, Prop: 2, Other: 3 };
    orderedItems.sort((a, b) => (typeOrder[a.type] ?? 3) - (typeOrder[b.type] ?? 3));

    for (const item of orderedItems) {
      const u = item.url;
      // Plan C: 支持 data URL、/api/ URL 和 HTTP URL
      // ★ 参考图不压缩 — 保留原始质量（参考图对生成质量至关重要）
      if ((u.startsWith("data:") && u.length > 200) || u.startsWith("/api/")) {
        try {
          // 对于 /api/ URL 仍需通过 compressImage 加载为 data URL，但使用最高质量
          const processed = u.startsWith("/api/")
            ? await compressImage(u, 8192, 1.0, 50_000_000)
            : u;
          processedRefs.push(processed);
          originalRefUrls.push(u);
          if (item.name) {
            const typeDesc = item.type === "Character" ? "keep identical face, hair, outfit, body proportions."
              : item.type === "Scene" ? "match environment, architecture, lighting."
              : item.type === "Prop" ? "reproduce exact design and material."
              : "Use as visual reference.";
            referenceLabels.push(`【${item.typeCN}：${item.name}】${typeDesc}`);
          } else {
            referenceLabels.push(`【${item.typeCN}】Use as visual reference.`);
          }
        } catch { skippedCount++; }
      } else if (u.startsWith("http") && u.length > 10) {
        processedRefs.push(u);
        originalRefUrls.push(u);
        if (item.name) {
          referenceLabels.push(`【${item.typeCN}：${item.name}】Use as visual reference.`);
        } else {
          referenceLabels.push(`【${item.typeCN}】Use as visual reference.`);
        }
      } else {
        skippedCount++;
      }
    }
    if (skippedCount > 0) {
      console.warn(`[callImageApi] ⚠ ${skippedCount} reference image(s) were invalid/empty and skipped`);
    }

    // ★ STYLE REFERENCE IMAGE: append LAST so character/scene refs have higher priority
    // If the style image is the same as an existing ref (e.g. character ref), merge the style label instead of duplicating
    // Note: styleImage is stored as raw FileReader output (original size), while character referenceImage
    // is stored compressed (2048px/0.85). So exact URL comparison fails even for the same source file.
    // Strategy: compress styleImage with the SAME params used in processedRefs, then compare compressed outputs.
    const styleImg = latestConsistency.style.styleImage;
    if (includeStyleRefInModel && isValidImageRef(styleImg)) {
      const artDesc = latestConsistency.style.artStyle ? ` (${latestConsistency.style.artStyle})` : "";
      const styleLabel =
        `【🎨 风格参考图】This is also the STYLE / AESTHETIC reference image${artDesc}. ` +
        `You MUST match its art style, color palette, rendering technique, line quality, texture, and overall mood in the generated image. ` +
        `Apply this visual style consistently to ALL frames.`;

      let mergeIdx = -1;
      // Step 1: try exact/fuzzy match against original URLs (works if user set same data URL for both)
      mergeIdx = originalRefUrls.findIndex(r => fuzzyMatchImage(r, styleImg));

      // Step 2: 直接用原始 data URL 比较（参考图不再压缩，所以直接对比原图）
      if (mergeIdx < 0 && processedRefs.length > 0) {
        mergeIdx = processedRefs.findIndex(r => {
          if (r === styleImg) return true;
          // 比较原始图片：长度 ±3% 且末尾 200 字符相同
          const lenRatio = r.length / styleImg.length;
          if (lenRatio < 0.97 || lenRatio > 1.03) return false;
          return r.slice(-200) === styleImg.slice(-200);
        });
        if (mergeIdx >= 0) {
          console.log(`[callImageApi] ✓ Style ref matched existing ref #${mergeIdx + 1} via direct comparison`);
        }
      }

      console.log(`[callImageApi] Style dedup: styleImg len=${styleImg.length}, originalRefUrls=[${originalRefUrls.map(r => r.length).join(",")}], match=${mergeIdx}`);
      if (mergeIdx >= 0) {
        // Same image already sent as character/scene/prop ref — just append style instruction to its label
        referenceLabels[mergeIdx] += ` ${styleLabel}`;
        console.log(`[callImageApi] ✓ Style ref merged into existing ref #${mergeIdx + 1} (same image, no duplicate upload)`);
      } else {
        // Unique style image — add as new reference
        // ★ /api/ URL 引用需先解析为 data URL，风格参考图不压缩 — 保留原始质量
        let resolvedStyle = styleImg;
        if (styleImg.startsWith("/api/")) {
          try {
            resolvedStyle = await compressImage(styleImg, 8192, 1.0, 50_000_000);
            console.log(`[callImageApi] ✓ Style ref resolved from URL: ${styleImg} → ${(resolvedStyle.length / 1024).toFixed(0)}KB`);
          } catch (e) {
            console.warn(`[callImageApi] ⚠ Style ref URL resolution failed, using raw URL:`, e);
          }
        }
        processedRefs.push(resolvedStyle);
        referenceLabels.push(styleLabel.replace('also the STYLE', 'the STYLE'));
        console.log(`[callImageApi] ✓ Style reference image attached (${(resolvedStyle.length / 1024).toFixed(0)}KB)`);
      }
    }

    // Use studio UI resolution/aspectRatio (consistency.style) as primary source,
    // fall back to settings page values for backward compatibility
    const effectiveSize = consistency.style.resolution || settings["img-size"] || "4K";
    const effectiveRatio = consistency.style.aspectRatio || settings["img-aspect-ratio"] || "16:9";

    // ★ Validate processedRefs/referenceLabels alignment
    if (processedRefs.length !== referenceLabels.length) {
      console.error(`[callImageApi] ❌ MISALIGNMENT: ${processedRefs.length} refs vs ${referenceLabels.length} labels — this may cause label/image desync!`);
      // Trim to shorter length to prevent misaligned labels
      while (referenceLabels.length > processedRefs.length) referenceLabels.pop();
      while (processedRefs.length > referenceLabels.length) processedRefs.pop();
    }

    // ★ Add sequential numbering (参考图N) prefix to each reference label
    for (let ri = 0; ri < referenceLabels.length; ri++) {
      referenceLabels[ri] = `参考图${ri + 1} ${referenceLabels[ri]}`;
    }

    // Truncate if needed (no reinforcement — labels are interleaved with images via referenceLabels)
    const truncated = prompt.length > 8000;
    let finalPrompt = prompt.slice(0, 8000);
    if (truncated) {
      console.warn(`[callImageApi] ⚠ Prompt truncated from ${prompt.length} to 8000 chars`);
      toast(`提示词超长(${prompt.length}字)，已截断至8000字，可能影响生图效果`, "error");
    }

    // ═══ Gemini Tab Mode: route through browser automation ═══
    if (currentImageGenMode === "geminiTab") {
      // ★ 前置服务可用性检查 — 首次使用时自动启动 GeminiTab 服务
      if (!(await ensureGeminiTabReady())) return null;

      console.log(`%c[callImageApi][GeminiTab] ═══ FULL PROMPT ═══`, "color: #00ccff; font-weight: bold; font-size: 14px;");
      console.log(finalPrompt);
      if (referenceLabels.length > 0) {
        console.log(`%c[callImageApi][GeminiTab] ═══ REFERENCE LABELS (${referenceLabels.length}) ═══`, "color: #66ccff; font-weight: bold;");
        referenceLabels.forEach((lbl, i) => console.log(`  [${i}] ${lbl.slice(0, 200)}${lbl.length > 200 ? "..." : ""}`));
      }
      console.log(`[callImageApi][GeminiTab] ${processedRefs.length} refs, prompt: ${finalPrompt.length} chars`);

      const taskId = `gt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      // 从 localStorage 读取自定义服务地址
      const gtHeaders: Record<string, string> = { "Content-Type": "application/json" };
      let geminiMode: string = "pro";
      let geminiDownloadMode: string = "manual"; // ★ 强制手动模式（自动模式已在 UI 锁定）
      try {
        const gtSettings = JSON.parse(localStorage.getItem("feicai-gemini-tab-settings") || "{}");
        if (gtSettings.serviceUrl) gtHeaders["x-gemini-tab-url"] = gtSettings.serviceUrl;
        if (gtSettings.geminiMode) geminiMode = gtSettings.geminiMode;
        // downloadMode 忽略用户旧设置，强制 manual
      } catch { /* ignore */ }
      try {
        // ★ 创建/复用 AbortController，支持停止按钮取消
        if (!geminiTabAbortRef.current) {
          geminiTabAbortRef.current = new AbortController();
        }
        // polyfill AbortSignal.any — 兼容低版本 Node/浏览器
        const _mc1 = new AbortController();
        const _timeout1 = setTimeout(() => _mc1.abort("timeout"), 900000);
        geminiTabAbortRef.current.signal.addEventListener("abort", () => _mc1.abort("user-stop"), { once: true });
        const combinedSignal = _mc1.signal;
        combinedSignal.addEventListener("abort", () => clearTimeout(_timeout1), { once: true });
        const res = await fetch(`/api/gemini-tab?path=${encodeURIComponent("/api/generate")}`, {
          method: "POST",
          headers: gtHeaders,
          body: JSON.stringify({
            tasks: [{
              prompt: finalPrompt,
              referenceImages: processedRefs.length > 0 ? processedRefs : undefined,
              referenceLabels: referenceLabels.length > 0 ? referenceLabels : undefined,
              taskId,
              mode: geminiMode,
              downloadMode: geminiDownloadMode,
            }],
          }),
          signal: combinedSignal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const errMsg = err.error || res.statusText || "未知错误";
          console.error(`[callImageApi][GeminiTab] failed: ${res.status}`, errMsg);
          toast(`Gemini Tab 生成失败: ${errMsg}`, "error");
          return null;
        }

        const data = await res.json();
        if (data.results && data.results.length > 0) {
          const result = data.results[0];
          if (result.imageBase64) {
            console.log(`[callImageApi][GeminiTab] ✓ 生成成功 (${result.elapsed?.toFixed(1)}s)`);
            return result.imageBase64;
          } else {
            const errMsg = result.error || "未能提取到图片";
            console.error(`[callImageApi][GeminiTab] ✗`, errMsg);
            toast(`Gemini Tab: ${errMsg}`, "error");
            return null;
          }
        }
        toast("Gemini Tab: 返回结果为空", "error");
        return null;
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[callImageApi][GeminiTab] exception:`, errMsg);
        toast(`Gemini Tab 生成异常: ${errMsg}`, "error");
        return null;
      }
    }

    // ═══ 即梦生图 Mode: 调用即梦 API 生成 4 张图，自动取第 1 张 ═══
    if (currentImageGenMode === "jimeng") {
      // 即梦凭证：优先从 feicai-seedance-settings 读取（与 Seedance 页面共用同一套凭证）
      let jimengSessionId = "", jimengWebId = "", jimengUserId = "", jimengRawCookies = "";
      try {
        const seedanceSettings = JSON.parse(localStorage.getItem("feicai-seedance-settings") || "{}");
        jimengSessionId = seedanceSettings.sessionId || "";
        jimengWebId = seedanceSettings.webId || "";
        jimengUserId = seedanceSettings.userId || "";
        jimengRawCookies = seedanceSettings.jimengRawCookies || "";
      } catch { /* ignore */ }
      if (!jimengSessionId || !jimengWebId || !jimengUserId) {
        toast("请先在 Seedance 页面的设置弹窗中配置即梦登录凭证", "error");
        return null;
      }

      console.log(`%c[callImageApi][Jimeng] ═══ FULL PROMPT ═══`, "color: #C9A962; font-weight: bold; font-size: 14px;");
      console.log(finalPrompt.slice(0, 500));
      // ★ 从 ref 读取最新值，避免 useCallback 闭包过期
      const curJimengModel = jimengModelRef.current;
      const curJimengResolution = jimengResolutionRef.current;
      const curJimengCount = jimengCountRef.current;
      const curJimengNegPrompt = jimengNegPromptRef.current;
      const curJimengModelLabel = JIMENG_IMAGE_MODEL_OPTIONS.find(o => o.value === curJimengModel)?.label || curJimengModel;
      console.log(`[callImageApi][Jimeng] model=${curJimengModel}, res=${curJimengResolution}, count=${curJimengCount}, refs=${processedRefs.length}`);

      try {
        // 使用工具栏参数（模型/分辨率/数量由即梦工具栏控制）
        const res = await fetch("/api/jimeng-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "generate",
            prompt: finalPrompt.slice(0, 1200),
            negativePrompt: curJimengNegPrompt || undefined,
            model: curJimengModel,
            ratio: effectiveRatio as string,
            resolution: curJimengResolution,
            count: curJimengCount,
            sessionId: jimengSessionId,
            webId: jimengWebId,
            userId: jimengUserId,
            rawCookies: jimengRawCookies || undefined,
            referenceImages: processedRefs.length > 0 ? processedRefs.slice(0, 7) : undefined,
          }),
          signal: AbortSignal.timeout(300000),
        });
        const startData = await res.json();
        if (!res.ok || !startData.taskId) {
          const errText = startData.error || "未知错误";
          toast(`即梦生图失败: ${errText}`, "error");
          return null;
        }
        const taskId = startData.taskId;

        // ★ 注册到全局任务管理器,开始后台轮询（页面切换不中断）
        const store = getJimengTaskStore();
        const taskLabel = cellLabel || prompt.slice(0, 20);
        store.addTask({
          taskId,
          label: taskLabel,
          model: curJimengModelLabel,
          resolution: curJimengResolution,
          startTime: Date.now(),
          targetListKey: targetInfo?.listKey,
          targetItemId: targetInfo?.itemId,
          targetGridKey: gridKey,
        });

        // 等待轮询结果（store 内部轮询独立于组件生命周期）
        const images = await store.pollUntilDone(taskId);

        if (images.length > 0) {
          console.log(`[callImageApi][Jimeng] ✓ 生成成功, ${images.length} images`);
          toast(`即梦生成完成！${images.length}张图片，已自动使用第1张`, "info");
          // 自动使用第一张，所有图片可在即梦 FAB 面板中查看
          const selectedUrl = images[0];
          // ★ 持久化默认选中索引
          try { store.updateSelectedIndex(taskId, 0); } catch { /* ignore */ }
          const key = `jimeng-studio-${Date.now()}`;
          fetch("/api/jimeng-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "save", imageUrl: selectedUrl, key }),
          }).catch(e => console.warn("[jimeng] save err:", e));
          return selectedUrl;
        } else {
          toast("即梦生图失败，请查看即梦面板中的错误信息", "error");
          return null;
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[callImageApi][Jimeng] exception:`, errMsg);
        toast(`即梦生图异常: ${errMsg}`, "error");
        return null;
      }
    }

    // ═══ Standard API Mode ═══
    const apiKey = settings["img-key"];

    const bodyStr = JSON.stringify({
      apiKey,
      baseUrl: settings["img-url"],
      model: settings["img-model"],
      prompt: finalPrompt,
      referenceImages: processedRefs,
      referenceLabels: processedRefs.length > 0 ? referenceLabels : undefined,
      imageSize: effectiveSize,
      aspectRatio: effectiveRatio,
      format: settings["img-format"] || "gemini",
    });
    // ★ Dump full prompt + labels to console for debugging/optimization
    console.log(`%c[callImageApi] ═══ FULL PROMPT ═══`, "color: #ffcc00; font-weight: bold; font-size: 14px;");
    console.log(finalPrompt);
    if (referenceLabels.length > 0) {
      console.log(`%c[callImageApi] ═══ REFERENCE LABELS (${referenceLabels.length}) ═══`, "color: #66ccff; font-weight: bold;");
      referenceLabels.forEach((lbl, i) => console.log(`  [${i}] ${lbl.slice(0, 200)}${lbl.length > 200 ? "..." : ""}`));
    }
    console.log(`[callImageApi] model=${settings["img-model"]}, url=${settings["img-url"]}, format=${settings["img-format"] || "gemini"}, size=${effectiveSize}, ratio=${effectiveRatio}, ${processedRefs.length} refs, body: ${(bodyStr.length / 1024 / 1024).toFixed(2)}MB`);

    const res = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyStr,
      signal: AbortSignal.timeout(600000), // 10 min frontend timeout
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errMsg = err.error || res.statusText || "未知错误";
      const detail = err.detail || "";
      const upstream = err.statusCode ? ` [上游${err.statusCode}]` : "";
      console.error(`[callImageApi] failed: ${res.status}${upstream}`, errMsg, detail);
      toast(`生成失败${upstream}: ${errMsg}`, "error");
      return null;
    }

    const data = await res.json();
    let resultImage = data.images?.[0] || null;

    // Fallback: if images array is empty, try to extract image from text content
    // This handles cases where some models (e.g. grok) return images embedded in content text
    if (!resultImage && data.content) {
      const b64Match = data.content.match(/(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/);
      if (b64Match) {
        resultImage = b64Match[1];
        console.log(`[callImageApi] extracted base64 image from content text (fallback)`);
      } else {
        const mdMatch = data.content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
        if (mdMatch) {
          resultImage = mdMatch[1];
          console.log(`[callImageApi] extracted markdown image URL from content text (fallback)`);
        } else {
          const urlMatch = data.content.match(/(https?:\/\/[^\s"'<>)]+\.(?:png|jpg|jpeg|webp|gif)(?:\?[^\s"'<>)]*)?)/i);
          if (urlMatch) {
            resultImage = urlMatch[1];
            console.log(`[callImageApi] extracted plain image URL from content text (fallback)`);
          }
        }
      }
    }

    return resultImage;
  }

  // Same as callImageApi but accepts a single reference that may be a data URL
  async function callImageApiWithRef(prompt: string, refImage: string): Promise<string | null> {
    const settings = getSettings();
    // ★ Read from ref to get the LATEST mode (avoids stale closure from useCallback)
    const currentImageGenMode = imageGenModeRef.current;
    // ── Gemini Tab / 即梦 mode: no API Key needed; API mode: require key ──
    if (currentImageGenMode !== "geminiTab" && currentImageGenMode !== "jimeng") {
      const apiKey = settings["img-key"];
      if (!apiKey) { toast("请先在设置页配置图像 API Key", "error"); return null; }
    }

    // Plan C: compressImage 支持 data URL 和同源 /api/ URL
    let imageUrl = refImage;
    if (refImage.startsWith("data:") || refImage.startsWith("/api/")) {
      imageUrl = await compressImage(refImage, 2048, 0.9);
    }

    const effectiveSize = consistency.style.resolution || settings["img-size"] || "4K";
    const effectiveRatio = consistency.style.aspectRatio || settings["img-aspect-ratio"] || "16:9";
    const truncatedRef = prompt.length > 8000;
    if (truncatedRef) {
      console.warn(`[callImageApiWithRef] ⚠ Prompt truncated from ${prompt.length} to 8000 chars`);
      toast(`超分提示词超长(${prompt.length}字)，已截断至8000字`, "error");
    }
    const finalRefPrompt = prompt.slice(0, 8000);

    // ═══ Gemini Tab Mode ═══
    if (currentImageGenMode === "geminiTab") {
      // ★ 前置服务可用性检查 — 首次使用时自动启动 GeminiTab 服务
      if (!(await ensureGeminiTabReady())) return null;

      const taskId = `gt-ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      console.log(`[callImageApiWithRef][GeminiTab] taskId=${taskId}, prompt: ${finalRefPrompt.length} chars`);
      try {
        // 从 localStorage 读取自定义服务地址和模式
        const gtRefHeaders: Record<string, string> = { "Content-Type": "application/json" };
        let geminiRefMode: string = "pro";
        let geminiRefDownloadMode: string = "auto";
        try {
          const gtRefSettings = JSON.parse(localStorage.getItem("feicai-gemini-tab-settings") || "{}");
          if (gtRefSettings.serviceUrl) gtRefHeaders["x-gemini-tab-url"] = gtRefSettings.serviceUrl;
          if (gtRefSettings.geminiMode) geminiRefMode = gtRefSettings.geminiMode;
          if (gtRefSettings.downloadMode) geminiRefDownloadMode = gtRefSettings.downloadMode;
        } catch { /* ignore */ }
        // ★ 创建/复用 AbortController，支持停止按钮取消
        if (!geminiTabAbortRef.current) {
          geminiTabAbortRef.current = new AbortController();
        }
        // polyfill AbortSignal.any — 兼容低版本 Node/浏览器
        const _mc2 = new AbortController();
        const _timeout2 = setTimeout(() => _mc2.abort("timeout"), 900000);
        geminiTabAbortRef.current.signal.addEventListener("abort", () => _mc2.abort("user-stop"), { once: true });
        const combinedRefSignal = _mc2.signal;
        combinedRefSignal.addEventListener("abort", () => clearTimeout(_timeout2), { once: true });
        const res = await fetch(`/api/gemini-tab?path=${encodeURIComponent("/api/generate")}`, {
          method: "POST",
          headers: gtRefHeaders,
          body: JSON.stringify({
            tasks: [{
              prompt: finalRefPrompt,
              referenceImages: [imageUrl],
              referenceLabels: ["[原图] 请基于此图进行超分放大"],
              taskId,
              mode: geminiRefMode,
              downloadMode: geminiRefDownloadMode,
            }],
          }),
          signal: combinedRefSignal,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toast(`Gemini Tab 超分失败: ${err.error || res.statusText}`, "error");
          return null;
        }
        const data = await res.json();
        const result = data.results?.[0];
        if (result?.imageBase64) {
          console.log(`[callImageApiWithRef][GeminiTab] ✓ 成功 (${result.elapsed?.toFixed(1)}s)`);
          return result.imageBase64;
        }
        toast(`Gemini Tab 超分: ${result?.error || "未能提取到图片"}`, "error");
        return null;
      } catch (e) {
        toast(`Gemini Tab 超分异常: ${e instanceof Error ? e.message : String(e)}`, "error");
        return null;
      }
    }

    // ═══ 即梦生图 Mode: 用参考图 + 超分提示词调用即梦 API ═══
    if (currentImageGenMode === "jimeng") {
      let jimengSessionId = "", jimengWebId = "", jimengUserId = "", jimengRawCookies = "";
      try {
        const seedanceSettings = JSON.parse(localStorage.getItem("feicai-seedance-settings") || "{}");
        jimengSessionId = seedanceSettings.sessionId || "";
        jimengWebId = seedanceSettings.webId || "";
        jimengUserId = seedanceSettings.userId || "";
        jimengRawCookies = seedanceSettings.jimengRawCookies || "";
      } catch { /* ignore */ }
      if (!jimengSessionId || !jimengWebId || !jimengUserId) {
        toast("请先在 Seedance 页面的设置弹窗中配置即梦登录凭证", "error");
        return null;
      }
      console.log(`[callImageApiWithRef][Jimeng] 超分调用, model=${jimengModelRef.current}, res=${jimengResolutionRef.current}`);
      try {
        const res = await fetch("/api/jimeng-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "generate",
            prompt: finalRefPrompt.slice(0, 1200),
            model: jimengModelRef.current,
            ratio: effectiveRatio as string,
            resolution: jimengResolutionRef.current,
            count: 1, // 超分只需1张
            sessionId: jimengSessionId,
            webId: jimengWebId,
            userId: jimengUserId,
            rawCookies: jimengRawCookies || undefined,
            referenceImages: [imageUrl],
          }),
          signal: AbortSignal.timeout(300000),
        });
        const startData = await res.json();
        if (!res.ok || !startData.taskId) {
          toast(`即梦超分失败: ${startData.error || "未知错误"}`, "error");
          return null;
        }
        const store = getJimengTaskStore();
        store.addTask({
          taskId: startData.taskId,
          label: "超分",
          model: JIMENG_IMAGE_MODEL_OPTIONS.find(o => o.value === jimengModelRef.current)?.label || jimengModelRef.current,
          resolution: jimengResolutionRef.current,
          startTime: Date.now(),
        });
        const images = await store.pollUntilDone(startData.taskId);
        if (images.length > 0) {
          console.log(`[callImageApiWithRef][Jimeng] ✓ 超分成功`);
          return images[0];
        }
        toast("即梦超分: 未返回图片", "error");
        return null;
      } catch (e) {
        toast(`即梦超分异常: ${e instanceof Error ? e.message : String(e)}`, "error");
        return null;
      }
    }

    // ═══ Standard API Mode ═══
    const apiKey = settings["img-key"];
    const refBody = JSON.stringify({
      apiKey,
      baseUrl: settings["img-url"],
      model: settings["img-model"],
      prompt: prompt.slice(0, 8000),
      referenceImages: [imageUrl],
      imageSize: effectiveSize,
      aspectRatio: effectiveRatio,
      format: settings["img-format"] || "gemini",
    });
    console.log(`[callImageApiWithRef] model=${settings["img-model"]}, format=${settings["img-format"] || "gemini"}, size=${effectiveSize}, body: ${(refBody.length / 1024 / 1024).toFixed(2)}MB`);

    const res = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: refBody,
      signal: AbortSignal.timeout(600000), // 10 min frontend timeout
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const errMsg = err.error || res.statusText || "未知错误";
      const upstream = err.statusCode ? ` [上游${err.statusCode}]` : "";
      console.error(`[callImageApiWithRef] failed: ${res.status}${upstream}`, errMsg);
      toast(`超分失败${upstream}: ${errMsg}`, "error");
      return null;
    }

    const data = await res.json();
    let refResultImage = data.images?.[0] || null;

    // Fallback: extract image from text content if images array is empty
    if (!refResultImage && data.content) {
      const b64Match = data.content.match(/(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/);
      if (b64Match) {
        refResultImage = b64Match[1];
      } else {
        const mdMatch = data.content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
        if (mdMatch) {
          refResultImage = mdMatch[1];
        } else {
          const urlMatch = data.content.match(/(https?:\/\/[^\s"'<>)]+\.(?:png|jpg|jpeg|webp|gif)(?:\?[^\s"'<>)]*)?)/i);
          if (urlMatch) {
            refResultImage = urlMatch[1];
          }
        }
      }
    }

    return refResultImage;
  }

  // ── Upload composite image → crop into grid cells ──

  function handleUploadComposite(mode: "nine" | "four" | "smartNine", beatIdx?: number) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 80 * 1024 * 1024) { toast("图片过大（>80MB），请压缩后重试", "error"); return; }

      const rows = (mode === "nine" || mode === "smartNine") ? 3 : 2;
      const cols = (mode === "nine" || mode === "smartNine") ? 3 : 2;
      const gridLabel = mode === "smartNine" ? "智能分镜九宫格" : mode === "nine" ? "九宫格" : "四宫格";

      toast(`正在读取并裁剪${gridLabel}合成图...`, "info");

      try {
        // Read file as data URL
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target?.result as string);
          reader.onerror = () => reject(new Error("文件读取失败"));
          reader.readAsDataURL(file);
        });

        // Crop into cells
        const maxCell = getMaxCellSizeForResolution(consistency.style.resolution);
        const cropResult = await cropImageGrid(dataUrl, rows, cols, maxCell);
        const croppedCells = cropResult.cells;
        const expectedCount = rows * cols;

        if (croppedCells.length < expectedCount) {
          toast(`裁剪异常：预期 ${expectedCount} 格，实际 ${croppedCells.length} 格`, "error");
          return;
        }

        // Build key map
        const compositeKey = mode === "smartNine"
          ? `smartNine-composite-${episode}`
          : mode === "nine"
            ? `nine-composite-${episode}`
            : `four-composite-${episode}-${beatIdx ?? fourBeat}`;
        const toSave: Record<string, string> = { [compositeKey]: dataUrl };

        for (let i = 0; i < croppedCells.length; i++) {
          const cellKey = mode === "smartNine"
            ? `smartNine-${episode}-${i}`
            : mode === "nine"
              ? `nine-${episode}-${i}`
              : `four-${episode}-${beatIdx ?? fourBeat}-${i}`;
          toSave[cellKey] = croppedCells[i];
        }

        // Phase 1: 立即用 data URL 显示裁剪结果
        setGridImages((prev) => ({ ...prev, ...toSave }));
        notifyGridOpUpdate({ images: toSave });
        toast(`${gridLabel}合成图上传成功 ✓ 已裁剪为 ${expectedCount} 格 (${cropResult.cellWidth}×${cropResult.cellHeight})`, "success");
        // Phase 2: 后台保存磁盘，完成后替换为磁盘 URL
        const diskUrlMap = await saveGridImagesToDisk(toSave);
        setGridImages((prev) => ({ ...prev, ...diskUrlMap }));
        notifyGridOpUpdate({ images: diskUrlMap });
      } catch (err) {
        console.error(`[handleUploadComposite] ${mode} error:`, err);
        toast(`合成图裁剪失败: ${err instanceof Error ? err.message : "未知错误"}`, "error");
      }
    };
    input.click();
  }

  // ── NINE GRID: one 3×3 composite → crop ──

  const generateNineGrid = useCallback(async () => {
    if (ninePrompts.length === 0) { toast("无提示词数据，请先运行流水线", "error"); return; }
    // ★ Guard: wait for reference images to finish loading from IndexedDB
    if (!isConsistencyImagesLoaded) { toast("参考图数据正在加载中，请稍候再试...", "info"); return; }
    // ★ Guard: 未绑定全局参考图时弹窗确认，避免浪费 API 配额
    const hasNineRefs = nineGridRefIds && nineGridRefIds.length > 0;
    if (!hasNineRefs) {
      const ok = window.confirm("⚠ 未绑定全局参考图！\n\n没有参考图的情况下生成九宫格，角色和场景一致性将无法保证，容易浪费 API 配额。\n\n建议：点击「全局参考图」按钮绑定角色/场景参考图后再生成。\n\n确定要继续生成吗？");
      if (!ok) return;
    }
    const genKey = `nine-${episode}`;
    // Synchronous lock to prevent TOCTOU double-click race
    if (generatingLockRef.current.has(genKey)) { toast("该集数九宫格正在生成中，请勿重复点击", "info"); return; }
    generatingLockRef.current.add(genKey);
    setGeneratingSet((prev) => new Set(prev).add(genKey));
    toast(imageGenModeRef.current === "jimeng" ? "即梦模式：正在逐格生成九宫格..." : "正在生成九宫格合成图（3×3一张图）...", "info");
    const taskId = `image-ninegrid-${episode}-${Date.now()}`;
    addTask({ id: taskId, type: "image", label: `${episode.toUpperCase()} 九宫格生成`, detail: imageGenModeRef.current === "jimeng" ? "即梦逐格" : "图像模型" });

    try {
      // ★ Always use latest consistency (avoids stale closure from useCallback)
      const latestCst = consistencyRef.current;
      // Collect ref images: only use explicit binding (no smart matching fallback)
      const refImages = nineGridRefIds && nineGridRefIds.length > 0
        ? resolveRefBindIds(latestCst, nineGridRefIds)
        : [];
      console.log(`[generateNineGrid] ${refImages.length} reference images (binding: ${nineGridRefIds?.length || 0})`);

      // ★ 即梦模式：逐格生成（即梦无法生成合成网格图）
      if (imageGenModeRef.current === "jimeng") {
        const total = Math.min(ninePrompts.length, 9);
        toast(`即梦逐格生成模式：共 ${total} 格，请耐心等待...`, "info");
        let successCount = 0;
        for (let i = 0; i < total; i++) {
          toast(`正在生成九宫格第 ${i + 1}/${total} 格...`, "info");
          const cellPrompt = buildSingleCellPrompt(ninePrompts[i], refImages);
          const cellGridKey = `nine-${episode}-${i}`;
          const url = await callImageApi(cellPrompt, refImages, undefined, `${episode.toUpperCase()} 九宫格 格${i + 1}/${total}`, undefined, cellGridKey);
          if (url) {
            const persistedUrl = url.startsWith("http") ? await httpUrlToDataUrl(url) : url;
            const key = `nine-${episode}-${i}`;
            const cellSave: Record<string, string> = { [key]: persistedUrl };
            setGridImages((prev) => ({ ...prev, ...cellSave }));
            notifyGridOpUpdate({ images: cellSave });
            const diskUrlMap = await saveGridImagesToDisk(cellSave);
            setGridImages((prev) => ({ ...prev, ...diskUrlMap }));
            notifyGridOpUpdate({ images: diskUrlMap });
            successCount++;
          } else {
            toast(`第 ${i + 1} 格生成失败，跳过`, "error");
          }
        }
        toast(`九宫格逐格生成完毕 ✓ 成功 ${successCount}/${total} 格`, "success");
      } else {
        // ★ API / Gemini Tab 模式：一张合成图 → 裁剪
        const prompt = buildCleanNineGridPrompt(refImages);
        const compositeUrl = await callImageApi(prompt, refImages);

        if (!compositeUrl) {
          throw new Error("API 未返回图片数据，请检查图像模型配置或重试");
        }

        // Persist HTTP URL as data URL so it survives URL expiry and can be reliably cropped
        const persistedComposite = compositeUrl.startsWith("http") ? await httpUrlToDataUrl(compositeUrl) : compositeUrl;
        toast("合成图已生成，正在裁剪为9格...", "info");

        let croppedCells: string[] = [];
        try {
          const maxCell = getMaxCellSizeForResolution(consistency.style.resolution);
          const cropResult = await cropImageGrid(persistedComposite, 3, 3, maxCell);
          croppedCells = cropResult.cells;
          const targetPx = getMaxCellSizeForResolution(consistency.style.resolution);
          if (cropResult.cellWidth < targetPx * 0.5 || cropResult.cellHeight < targetPx * 0.5) {
            toast(`⚠️ 模型实际输出 ${cropResult.cellWidth}×${cropResult.cellHeight}，远低于${consistency.style.resolution || '1K'}目标。可在设置页配置「输出尺寸(size)」或更换模型`, "info");
          }
          toast(`九宫格生成完毕 ✓ 每格 ${cropResult.cellWidth}×${cropResult.cellHeight} ${cropResult.format}无损`, "success");
        } catch {
          toast("裁剪失败（可能跨域限制），已保存合成图", "info");
        }

        // Plan C: 两阶段显示 — Phase 1 立即用 data URL 渲染，Phase 2 后台保存磁盘后替换
        const toSave: Record<string, string> = { [`nine-composite-${episode}`]: persistedComposite };
        for (let i = 0; i < croppedCells.length; i++) toSave[`nine-${episode}-${i}`] = croppedCells[i];
        // Phase 1: 立即将 data URL 写入 state → 图片即刻显示（不等磁盘保存）
        setGridImages((prev) => ({ ...prev, ...toSave }));
        notifyGridOpUpdate({ images: toSave });
        // Phase 2: 后台保存磁盘，完成后用磁盘 URL 替换 data URL（减少内存占用）
        const diskUrlMap = await saveGridImagesToDisk(toSave);
        setGridImages((prev) => ({ ...prev, ...diskUrlMap }));
        notifyGridOpUpdate({ images: diskUrlMap });
      }
    } catch (e: unknown) {
      toast(`生成错误: ${e instanceof Error ? e.message : "未知"}`, "error");
    } finally {
      generatingLockRef.current.delete(genKey);
      setGeneratingSet((prev) => { const s = new Set(prev); s.delete(genKey); return s; });
      notifyGridOpUpdate({ generatingDone: genKey });
      removeTask(taskId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode, ninePrompts, consistency, nineGridRefIds, isConsistencyImagesLoaded, toast, addTask, removeTask]);

  // ── SMART NINE GRID: 智能分镜专用九宫格（提示词来源于外部接口） ──

  const generateSmartNineGrid = useCallback(async () => {
    if (smartNinePrompts.length === 0) { toast("无智能分镜提示词数据，请先通过外部接口导入", "error"); return; }
    if (!isConsistencyImagesLoaded) { toast("参考图数据正在加载中，请稍候再试...", "info"); return; }
    const hasSmartNineRefs = smartNineGridRefIds && smartNineGridRefIds.length > 0;
    if (!hasSmartNineRefs) {
      const ok = window.confirm("⚠ 未绑定全局参考图！\n\n没有参考图的情况下生成智能分镜九宫格，角色和场景一致性将无法保证，容易浪费 API 配额。\n\n建议：点击「全局参考图」按钮绑定角色/场景参考图后再生成。\n\n确定要继续生成吗？");
      if (!ok) return;
    }
    const genKey = `smartNine-${episode}`;
    if (generatingLockRef.current.has(genKey)) { toast("该集数智能分镜九宫格正在生成中，请勿重复点击", "info"); return; }
    generatingLockRef.current.add(genKey);
    setGeneratingSet((prev) => new Set(prev).add(genKey));
    toast(imageGenModeRef.current === "jimeng" ? "即梦模式：正在逐格生成智能分镜九宫格..." : "正在生成智能分镜九宫格合成图（3×3一张图）...", "info");
    const taskId = `image-smartninegrid-${episode}-${Date.now()}`;
    addTask({ id: taskId, type: "image", label: `${episode.toUpperCase()} 智能分镜九宫格生成`, detail: imageGenModeRef.current === "jimeng" ? "即梦逐格" : "图像模型" });

    try {
      const latestCst = consistencyRef.current;
      const refImages = hasSmartNineRefs
        ? resolveRefBindIds(latestCst, smartNineGridRefIds)
        : [];
      console.log(`[generateSmartNineGrid] ${refImages.length} reference images (binding: ${smartNineGridRefIds?.length || 0})`);

      // ★ 即梦模式：逐格生成（即梦无法生成合成网格图）
      if (imageGenModeRef.current === "jimeng") {
        const total = Math.min(smartNinePrompts.length, 9);
        toast(`即梦逐格生成模式：共 ${total} 格，请耐心等待...`, "info");
        let successCount = 0;
        for (let i = 0; i < total; i++) {
          toast(`正在生成智能分镜九宫格第 ${i + 1}/${total} 格...`, "info");
          const cellPrompt = buildSingleCellPrompt(smartNinePrompts[i], refImages);
          const cellGridKey = `smartNine-${episode}-${i}`;
          const url = await callImageApi(cellPrompt, refImages, undefined, `${episode.toUpperCase()} 智能分镜 格${i + 1}/${total}`, undefined, cellGridKey);
          if (url) {
            const persistedUrl = url.startsWith("http") ? await httpUrlToDataUrl(url) : url;
            const key = `smartNine-${episode}-${i}`;
            const cellSave: Record<string, string> = { [key]: persistedUrl };
            setGridImages((prev) => ({ ...prev, ...cellSave }));
            notifyGridOpUpdate({ images: cellSave });
            const diskUrlMap = await saveGridImagesToDisk(cellSave);
            setGridImages((prev) => ({ ...prev, ...diskUrlMap }));
            notifyGridOpUpdate({ images: diskUrlMap });
            successCount++;
          } else {
            toast(`第 ${i + 1} 格生成失败，跳过`, "error");
          }
        }
        toast(`智能分镜九宫格逐格生成完毕 ✓ 成功 ${successCount}/${total} 格`, "success");
      } else {
        // ★ API / Gemini Tab 模式：一张合成图 → 裁剪
        const prompt = buildCleanNineGridPrompt(refImages, smartNinePrompts);
        const compositeUrl = await callImageApi(prompt, refImages);

        if (!compositeUrl) {
          throw new Error("API 未返回图片数据，请检查图像模型配置或重试");
        }

        const persistedComposite = compositeUrl.startsWith("http") ? await httpUrlToDataUrl(compositeUrl) : compositeUrl;
        toast("合成图已生成，正在裁剪为9格...", "info");

        let croppedCells: string[] = [];
        try {
          const maxCell = getMaxCellSizeForResolution(consistency.style.resolution);
          const cropResult = await cropImageGrid(persistedComposite, 3, 3, maxCell);
          croppedCells = cropResult.cells;
          const targetPx = getMaxCellSizeForResolution(consistency.style.resolution);
          if (cropResult.cellWidth < targetPx * 0.5 || cropResult.cellHeight < targetPx * 0.5) {
            toast(`⚠️ 模型实际输出 ${cropResult.cellWidth}×${cropResult.cellHeight}，远低于${consistency.style.resolution || '1K'}目标。可在设置页配置「输出尺寸(size)」或更换模型`, "info");
          }
          toast(`智能分镜九宫格生成完毕 ✓ 每格 ${cropResult.cellWidth}×${cropResult.cellHeight} ${cropResult.format}无损`, "success");
        } catch {
          toast("裁剪失败（可能跨域限制），已保存合成图", "info");
        }

        // 两阶段显示
        const toSave: Record<string, string> = { [`smartNine-composite-${episode}`]: persistedComposite };
        for (let i = 0; i < croppedCells.length; i++) toSave[`smartNine-${episode}-${i}`] = croppedCells[i];
        setGridImages((prev) => ({ ...prev, ...toSave }));
        notifyGridOpUpdate({ images: toSave });
        const diskUrlMap = await saveGridImagesToDisk(toSave);
        setGridImages((prev) => ({ ...prev, ...diskUrlMap }));
        notifyGridOpUpdate({ images: diskUrlMap });
      }
    } catch (e: unknown) {
      toast(`生成错误: ${e instanceof Error ? e.message : "未知"}`, "error");
    } finally {
      generatingLockRef.current.delete(genKey);
      setGeneratingSet((prev) => { const s = new Set(prev); s.delete(genKey); return s; });
      notifyGridOpUpdate({ generatingDone: genKey });
      removeTask(taskId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode, smartNinePrompts, consistency, smartNineGridRefIds, isConsistencyImagesLoaded, toast, addTask, removeTask]);

  // ★ Pipeline 确认方案后自动触发智能分镜九宫格生成
  const smartAutoGenTriggeredRef = useRef(false);
  useEffect(() => {
    if (smartAutoGenTriggeredRef.current) return;
    try {
      const autoGen = localStorage.getItem("feicai-studio-smart-auto-gen");
      if (!autoGen) return;
      // 等待提示词加载完毕 + 参考图就绪
      if (smartNinePrompts.length === 0 || !isConsistencyImagesLoaded) return;
      // 确认当前模式已切换到 smartNine
      if (activeMode !== "smartNine") return;
      smartAutoGenTriggeredRef.current = true;
      localStorage.removeItem("feicai-studio-smart-auto-gen");
      console.log("[Studio] 自动触发智能分镜九宫格生成（从 Pipeline 确认方案跳转）");
      // 延迟一帧确保所有状态已就绪
      requestAnimationFrame(() => { generateSmartNineGrid(); });
    } catch { /* ignore */ }
  }, [smartNinePrompts, isConsistencyImagesLoaded, activeMode, generateSmartNineGrid]);

  // ── FOUR GRID: nine-grid cell as ref → one 2×2 → crop ──

  const generateFourGrid = useCallback(async (beatIdx: number) => {
    const scenes = fourGroups[beatIdx];
    if (!scenes || scenes.length === 0) { toast("该组无提示词数据", "error"); return; }
    // ★ Guard: wait for reference images to finish loading from IndexedDB
    if (!isConsistencyImagesLoaded) { toast("参考图数据正在加载中，请稍候再试...", "info"); return; }
    // ★ Guard: 未绑定全局参考图时弹窗确认
    const hasFourRefs = fourGridRefIds[beatIdx] && fourGridRefIds[beatIdx]!.length > 0;
    if (!hasFourRefs) {
      const ok = window.confirm("⚠ 未绑定全局参考图！\n\n没有参考图的情况下生成四宫格，角色和场景一致性将无法保证，容易浪费 API 配额。\n\n建议：点击「全局参考图」按钮绑定角色/场景参考图后再生成。\n\n确定要继续生成吗？");
      if (!ok) return;
    }

    const nineGridCellKey = gridImages[`nine-${episode}-${beatIdx}`] ? `nine-${episode}-${beatIdx}` : `smartNine-${episode}-${beatIdx}`;
    const nineRef = gridImages[nineGridCellKey];
    if (!nineRef) {
      toast(`请先生成九宫格！需要格${beatIdx + 1}作为垫图`, "error");
      return;
    }

    const genKey = `four-${episode}-${beatIdx}`;
    // Synchronous lock to prevent TOCTOU double-click race
    if (generatingLockRef.current.has(genKey)) { toast("该组四宫格正在生成中，请勿重复点击", "info"); return; }
    generatingLockRef.current.add(genKey);
    setGeneratingSet((prev) => new Set(prev).add(genKey));
    toast(imageGenModeRef.current === "jimeng" ? `即梦模式：正在逐格生成组${beatIdx + 1}四宫格...` : `正在基于九宫格格${beatIdx + 1}生成四宫格...`, "info");
    const taskId = `image-fourgrid-${episode}-${beatIdx}-${Date.now()}`;
    addTask({ id: taskId, type: "image", label: `${episode.toUpperCase()} 组${beatIdx + 1} 四宫格生成`, detail: imageGenModeRef.current === "jimeng" ? "即梦逐格" : "图像模型" });

    try {
      // ★ Always use latest consistency (avoids stale closure from useCallback)
      const latestCst = consistencyRef.current;
      // Collect ref images: only use four-grid's own binding (no nine-grid inheritance)
      let manualRefs: string[];
      if (fourGridRefIds[beatIdx] && fourGridRefIds[beatIdx]!.length > 0) {
        manualRefs = resolveRefBindIds(latestCst, fourGridRefIds[beatIdx]!);
      } else {
        manualRefs = []; // 四宫格没有绑定时，仅用垫图+提示词，不继承九宫格参考图
      }
      // Deduplicate: remove refs already present in nineRef to avoid sending the same image twice
      const seenUrls = new Set<string>([nineRef]);
      const dedupedManual = manualRefs.filter(u => { if (seenUrls.has(u)) return false; seenUrls.add(u); return true; });
      const refImages = [nineRef, ...dedupedManual];
      console.log(`[generateFourGrid] ${refImages.length} ref images (1 nine-ref + ${dedupedManual.length} consistency, deduped from ${manualRefs.length})`);

      // ★ 即梦模式：逐格生成（即梦无法生成合成网格图）
      if (imageGenModeRef.current === "jimeng") {
        const total = Math.min(scenes.length, 4);
        toast(`即梦逐格生成模式：共 ${total} 格，请耐心等待...`, "info");
        let successCount = 0;
        for (let i = 0; i < total; i++) {
          toast(`正在生成四宫格第 ${i + 1}/${total} 格...`, "info");
          const cellPrompt = buildSingleCellPrompt(scenes[i], refImages);
          const cellGridKey = `four-${episode}-${beatIdx}-${i}`;
          const url = await callImageApi(cellPrompt, refImages, nineRef, `${episode.toUpperCase()} 组${beatIdx + 1} 四宫格 格${i + 1}/${total}`, undefined, cellGridKey);
          if (url) {
            const persistedUrl = url.startsWith("http") ? await httpUrlToDataUrl(url) : url;
            const key = `four-${episode}-${beatIdx}-${i}`;
            const cellSave: Record<string, string> = { [key]: persistedUrl };
            setGridImages((prev) => ({ ...prev, ...cellSave }));
            notifyGridOpUpdate({ images: cellSave });
            const diskUrlMap = await saveGridImagesToDisk(cellSave);
            setGridImages((prev) => ({ ...prev, ...diskUrlMap }));
            notifyGridOpUpdate({ images: diskUrlMap });
            successCount++;
          } else {
            toast(`第 ${i + 1} 格生成失败，跳过`, "error");
          }
        }
        toast(`四宫格逐格生成完毕 ✓ 成功 ${successCount}/${total} 格`, "success");
      } else {
        // ★ API / Gemini Tab 模式：一张合成图 → 裁剪
        const prompt = buildCleanFourGridPrompt(scenes, refImages);
        const compositeUrl = await callImageApi(prompt, refImages, nineRef);

        if (!compositeUrl) {
          throw new Error("API 未返回图片数据，请检查图像模型配置或重试");
        }

        // Persist HTTP URL as data URL so it survives URL expiry and can be reliably cropped
        const persistedComposite = compositeUrl.startsWith("http") ? await httpUrlToDataUrl(compositeUrl) : compositeUrl;
        toast("四宫格合成图已生成，正在裁剪...", "info");

        let croppedCells: string[] = [];
        try {
          const maxCell = getMaxCellSizeForResolution(consistency.style.resolution);
          const cropResult = await cropImageGrid(persistedComposite, 2, 2, maxCell);
          croppedCells = cropResult.cells;
          const targetPx = getMaxCellSizeForResolution(consistency.style.resolution);
          if (cropResult.cellWidth < targetPx * 0.5 || cropResult.cellHeight < targetPx * 0.5) {
            toast(`⚠️ 模型实际输出 ${cropResult.cellWidth}×${cropResult.cellHeight}，远低于${consistency.style.resolution || '1K'}目标。可在设置页配置「输出尺寸(size)」或更换模型`, "info");
          }
          toast(`四宫格生成完毕 ✓ 每格 ${cropResult.cellWidth}×${cropResult.cellHeight} ${cropResult.format}无损`, "success");
        } catch {
          toast("裁剪失败，已保存合成图", "info");
        }

        // Plan C: 两阶段显示 — Phase 1 立即用 data URL 渲染，Phase 2 后台保存磁盘后替换
        const toSave: Record<string, string> = { [`four-composite-${episode}-${beatIdx}`]: persistedComposite };
        for (let i = 0; i < croppedCells.length; i++) toSave[`four-${episode}-${beatIdx}-${i}`] = croppedCells[i];
        // Phase 1: 立即将 data URL 写入 state → 图片即刻显示
        setGridImages((prev) => ({ ...prev, ...toSave }));
        notifyGridOpUpdate({ images: toSave });
        // Phase 2: 后台保存磁盘，完成后用磁盘 URL 替换 data URL
        const diskUrlMap = await saveGridImagesToDisk(toSave);
        setGridImages((prev) => ({ ...prev, ...diskUrlMap }));
        notifyGridOpUpdate({ images: diskUrlMap });
      }
    } catch (e: unknown) {
      toast(`生成错误: ${e instanceof Error ? e.message : "未知"}`, "error");
    } finally {
      generatingLockRef.current.delete(genKey);
      setGeneratingSet((prev) => { const s = new Set(prev); s.delete(genKey); return s; });
      notifyGridOpUpdate({ generatingDone: genKey });
      removeTask(taskId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episode, fourGroups, consistency, fourGridRefIds, isConsistencyImagesLoaded, gridImages, toast, addTask, removeTask]);

  // ── Regenerate single cell ──

  const regenerateCell = useCallback(async (cellKey: string, prompt: string, refImages: string[] = []) => {
    // Synchronous lock to prevent TOCTOU double-click race
    if (generatingLockRef.current.has(cellKey)) { toast("该格正在重新生成中", "info"); return; }
    generatingLockRef.current.add(cellKey);
    setRegeneratingSet((prev) => new Set(prev).add(cellKey));
    toast("正在重新生成该格...", "info");
    const taskId = `image-regen-${cellKey}-${Date.now()}`;
    addTask({ id: taskId, type: "image", label: `重新生成 ${cellKey}`, detail: "图像模型" });

    try {
      const fullPrompt = buildSingleCellPrompt(prompt, refImages);
      const url = await callImageApi(fullPrompt, refImages, undefined, `重新生成 ${cellKey}`, undefined, cellKey);

      if (url) {
        // Persist HTTP URL as data URL to prevent expiry
        const persistedUrl = url.startsWith("http") ? await httpUrlToDataUrl(url) : url;
        // ★ 推入历史栈，支持撤回
        pushToHistory(cellKey);
        // Phase 1: 立即用 data URL 显示
        const dataUrlMap = { [cellKey]: persistedUrl };
        setGridImages((prev) => ({ ...prev, ...dataUrlMap }));
        notifyGridOpUpdate({ images: dataUrlMap });
        toast("重新生成完成 ✓", "success");
        // Phase 2: 后台保存磁盘，完成后替换为磁盘 URL
        const diskUrlMap = await saveGridImagesToDisk(dataUrlMap);
        setGridImages((prev) => ({ ...prev, ...diskUrlMap }));
        notifyGridOpUpdate({ images: diskUrlMap });
      }
    } catch {
      toast("重新生成失败", "error");
    } finally {
      generatingLockRef.current.delete(cellKey);
      setRegeneratingSet((prev) => { const s = new Set(prev); s.delete(cellKey); return s; });
      notifyGridOpUpdate({ regeneratingDone: cellKey });
      removeTask(taskId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consistency, toast, addTask, removeTask]);

  // ── Upscale single cell ──

  const upscaleCell = useCallback(async (cellKey: string, _batchMode = false) => {
    const cellImage = gridImages[cellKey];
    if (!cellImage) { toast("该格暂无图片", "error"); return; }
    // Synchronous lock to prevent TOCTOU double-click race
    if (generatingLockRef.current.has(cellKey)) { toast("该格正在超分中", "info"); return; }
    // Allow multiple cells to upscale concurrently (both manual clicks and batch mode)
    generatingLockRef.current.add(cellKey);

    setUpscalingSet((prev) => new Set(prev).add(cellKey));
    const taskId = `image-upscale-${cellKey}-${Date.now()}`;
    addTask({ id: taskId, type: "image", label: `超分放大 ${cellKey}`, detail: "图像模型" });

    const resLabel = consistency.style.resolution || "4K";
    const targetPx = resLabel === "4K" ? 4096 : resLabel === "2K" ? 2048 : 1024;

    // Get source image dimensions
    const srcDims = await new Promise<{ w: number; h: number }>((res) => {
      const tmp = new window.Image();
      tmp.onload = () => res({ w: tmp.width, h: tmp.height });
      tmp.onerror = () => res({ w: 0, h: 0 });
      tmp.src = cellImage;
    });
    console.log(`[upscaleCell] source: ${srcDims.w}×${srcDims.h}, target: ${resLabel} (${targetPx}px)`);

    try {
      toast(`正在超分放大至 ${resLabel}（模型 imageSize=${resLabel}）...`, "info");
      const systemPrompts = await loadSystemPromptsAsync();
      const resPixels = String(targetPx);
      const upscalePrompt = systemPrompts.upscale && systemPrompts.upscale.length > 10
        ? systemPrompts.upscale
        : `Upscale this AI-generated reference image to ${resLabel} resolution (at least ${resPixels}x${resPixels} pixels). This is NOT a simple resize — you must intelligently enhance the image:\n1. Sharpen blurry regions, reconstruct clear edges and fine textures\n2. Fix AI artifacts: blurry faces, fused fingers, smeared hair, color banding\n3. Enhance facial details: clear eyes, defined features, natural skin texture\n4. Remove noise and blocky artifacts while preserving meaningful texture\n5. Keep ALL visual elements identical: composition, colors, lighting, characters, style\n6. The output must look like a native ${resLabel} render, not an upscaled low-res image\n\n${UPSCALE_PROMPT}`;

      // ★ 追加画幅比例指令，确保超分后保持用户选择的比例
      const ratioHint = consistency.style.aspectRatio ? `\nIMPORTANT: Output image MUST be ${consistency.style.aspectRatio} aspect ratio (${consistency.style.aspectRatio === "9:16" ? "portrait, taller than wide" : "landscape, wider than tall"}).` : "";
      const url = await callImageApiWithRef(upscalePrompt + ratioHint, cellImage);

      if (url) {
        const persistedUrl = url.startsWith("http") ? await httpUrlToDataUrl(url) : url;
        const dims = await new Promise<{ w: number; h: number }>((res) => {
          const tmpImg = new window.Image();
          tmpImg.onload = () => res({ w: tmpImg.width, h: tmpImg.height });
          tmpImg.onerror = () => res({ w: 0, h: 0 });
          tmpImg.src = persistedUrl;
        });
        console.log(`[upscaleCell] model returned: ${dims.w}×${dims.h} (source was ${srcDims.w}×${srcDims.h})`);

        // ★ 推入历史栈，支持撤回
        pushToHistory(cellKey);
        // Phase 1: 立即用 data URL 显示
        const dataUrlMap = { [cellKey]: persistedUrl };
        setGridImages((prev) => ({ ...prev, ...dataUrlMap }));
        notifyGridOpUpdate({ images: dataUrlMap });
        const fmt = persistedUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
        toast(`超分完成 ✓ ${dims.w}×${dims.h} ${fmt}`, "success");
        // Phase 2: 后台保存磁盘，完成后替换为磁盘 URL
        const diskUrlMap = await saveGridImagesToDisk(dataUrlMap);
        setGridImages((prev) => ({ ...prev, ...diskUrlMap }));
        notifyGridOpUpdate({ images: diskUrlMap });
      } else {
        toast("超分失败：模型未返回图片", "error");
      }
    } catch {
      toast("超分请求错误", "error");
    } finally {
      generatingLockRef.current.delete(cellKey);
      setUpscalingSet((prev) => { const s = new Set(prev); s.delete(cellKey); return s; });
      notifyGridOpUpdate({ upscalingDone: cellKey });
      removeTask(taskId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridImages, consistency, toast, addTask, removeTask]);

  // Keep upscaleCellRef in sync so batchUpscale loops always call the latest version
  upscaleCellRef.current = upscaleCell;

  // ── Batch Upscale all cells in current grid ──

  /** Read Gemini Tab concurrency setting (maxConcurrentTabs) from localStorage */
  function getUpscaleConcurrency(): number {
    try {
      const raw = localStorage.getItem("feicai-gemini-tab-settings");
      if (raw) {
        const parsed = JSON.parse(raw);
        const n = parsed.maxConcurrentTabs;
        if (typeof n === "number" && n >= 1) return n;
      }
    } catch { /* ignore */ }
    return 3; // default
  }

  /** Run upscale tasks with concurrency control (semaphore pattern) */
  async function runConcurrentUpscale(keys: string[], concurrency: number) {
    let completed = 0;
    const total = keys.length;
    const queue = [...keys];
    const running: Promise<void>[] = [];

    const runOne = async () => {
      while (queue.length > 0) {
        const key = queue.shift()!;
        await upscaleCellRef.current(key, true); // batchMode = true
        completed++;
        toast(`超分进度: ${completed}/${total}`, "info");
      }
    };

    // Start `concurrency` workers in parallel
    for (let i = 0; i < Math.min(concurrency, keys.length); i++) {
      running.push(runOne());
    }
    await Promise.all(running);
  }

  async function batchUpscaleNine() {
    if (upscalingSet.size > 0) { toast("已有超分任务进行中，请等待完成", "info"); return; }
    const keys = Array.from({ length: 9 }, (_, i) => `nine-${episode}-${i}`);
    const toUpscale = keys.filter((k) => gridImages[k]);
    if (toUpscale.length === 0) { toast("无可超分的格子", "error"); return; }
    const concurrency = getUpscaleConcurrency();
    toast(`开始一键超分 ${toUpscale.length} 格（并发 ${concurrency}）...`, "info");
    await runConcurrentUpscale(toUpscale, concurrency);
    toast(`九宫格一键超分处理完毕（${toUpscale.length} 格）`, "success");
  }

  async function batchUpscaleFour() {
    if (upscalingSet.size > 0) { toast("已有超分任务进行中，请等待完成", "info"); return; }
    const keys = Array.from({ length: 4 }, (_, i) => `four-${episode}-${fourBeat}-${i}`);
    const toUpscale = keys.filter((k) => gridImages[k]);
    if (toUpscale.length === 0) { toast("无可超分的格子", "error"); return; }
    const concurrency = getUpscaleConcurrency();
    toast(`开始一键超分 ${toUpscale.length} 格（并发 ${concurrency}）...`, "info");
    await runConcurrentUpscale(toUpscale, concurrency);
    toast(`四宫格一键超分处理完毕（${toUpscale.length} 格）`, "success");
  }

  // ── Image Edit: open modal ──

  const openImageEdit = useCallback((cellKey: string, gridMode: "nine" | "four", prompt: string) => {
    const imgUrl = gridImages[cellKey];
    if (!imgUrl) { toast("该格暂无图片，无法编辑", "error"); return; }
    // Block if cell is already being processed
    if (generatingLockRef.current.has(cellKey)) { toast("该格正在处理中，请等待完成", "info"); return; }
    // Risk fix #3: close preview when opening edit modal
    setPreviewImage(null);
    setEditingCell({ cellKey, gridMode, imgUrl, cellPrompt: prompt });
  }, [gridImages, toast]);

  // ── Ref Image Edit: open modal for consistency reference images ──

  /** Open ImageEditModal for a consistency reference image (character/scene/prop).
   *  Uses the same modal as grid cells but routes the result back to the consistency profile. */
  const openRefImageEdit = useCallback((listKey: "characters" | "scenes" | "props", itemId: string, itemName: string, imgUrl: string, description: string) => {
    if (!imgUrl) { toast("该条目暂无参考图，无法编辑", "error"); return; }
    const refKey = `ref-${listKey}-${itemId}`;
    if (generatingLockRef.current.has(refKey)) { toast("该参考图正在处理中，请等待完成", "info"); return; }
    setPreviewImage(null);
    // Reuse editingCell with a special cellKey prefix "ref-" to distinguish from grid cells
    setEditingCell({ cellKey: refKey, gridMode: "nine", imgUrl, cellPrompt: description });
  }, [toast]);

  /** Submit handler for reference image editing — saves result back to consistency profile. */
  const handleRefOrGridImageEditSubmit = useCallback((
    description: string,
    annotatedImage: string | null,
    refImages: string[]
  ) => {
    if (!editingCell) return;
    const { cellKey, imgUrl: originalImgUrl } = editingCell;

    // Determine if this is a ref image edit or a grid cell edit
    const isRefEdit = cellKey.startsWith("ref-");

    if (generatingLockRef.current.has(cellKey)) {
      toast("该图正在处理中，请等待完成", "info");
      return;
    }

    setEditingCell(null);
    toast("图片编辑已提交，后台生成中...", "info");

    generatingLockRef.current.add(cellKey);
    if (!isRefEdit) {
      setRegeneratingSet((prev) => new Set(prev).add(cellKey));
    } else {
      // Extract itemId from "ref-characters-xxx" → "xxx"
      const parts = cellKey.split("-");
      const itemId = parts.slice(2).join("-");
      setGeneratingRefSet((prev) => new Set(prev).add(itemId));
    }

    const taskLabel = isRefEdit ? `编辑参考图 ${cellKey.replace("ref-", "")}` : `编辑 ${cellKey}`;
    const taskId = `image-edit-${cellKey}-${Date.now()}`;
    addTask({ id: taskId, type: "image", label: taskLabel, detail: "图像模型" });

    (async () => {
      try {
        // ★ 追加画幅比例指令，确保编辑后保持用户选择的比例
        const ratioSuffix = consistency.style.aspectRatio
          ? `\nIMPORTANT: Output image MUST be ${consistency.style.aspectRatio} aspect ratio (${consistency.style.aspectRatio === "9:16" ? "portrait, taller than wide" : "landscape, wider than tall"}).`
          : "";
        const editPrompt = description + ratioSuffix;
        const allRefImages = annotatedImage
          ? [annotatedImage, originalImgUrl, ...refImages.slice(0, 4)]
          : [originalImgUrl, ...refImages.slice(0, 4)];

        const result = await callImageApi(editPrompt, allRefImages);

        if (result) {
          const persistedUrl = result.startsWith("http") ? await httpUrlToDataUrl(result) : result;

          if (isRefEdit) {
            // Save back to consistency profile
            // cellKey format: "ref-characters-itemId" or "ref-scenes-itemId" or "ref-props-itemId"
            const parts = cellKey.split("-");
            const listKey = parts[1] as "characters" | "scenes" | "props";
            const itemId = parts.slice(2).join("-");

            setConsistency((prev) => {
              const next = { ...prev };
              next[listKey] = next[listKey].map((item) =>
                item.id === itemId ? { ...item, referenceImage: persistedUrl } : item
              );
              return next;
            });
            // ★ 直接持久化单项到磁盘（不使用 saveConsistencyImages 避免并发竞态删除其他项）
            await persistRefImage(itemId, persistedUrl);
            toast("参考图编辑完成 ✓", "success");
          } else {
            // Grid cell — Plan C: 保存到磁盘
            // ★ 推入历史栈，支持撤回
            pushToHistory(cellKey);
            const editUrlMap = await saveGridImagesToDisk({ [cellKey]: persistedUrl });
            setGridImages((prev) => ({ ...prev, ...editUrlMap }));
            notifyGridOpUpdate({ images: editUrlMap });
            toast("图片编辑完成 ✓", "success");
          }
        } else {
          toast("图片编辑失败，请重试", "error");
        }
      } catch (e) {
        toast(`图片编辑错误: ${e instanceof Error ? e.message : "未知"}`, "error");
      } finally {
        generatingLockRef.current.delete(cellKey);
        if (isRefEdit) {
          const parts = cellKey.split("-");
          const itemId = parts.slice(2).join("-");
          setGeneratingRefSet((prev) => { const s = new Set(prev); s.delete(itemId); return s; });
        } else {
          setRegeneratingSet((prev) => { const s = new Set(prev); s.delete(cellKey); return s; });
          notifyGridOpUpdate({ regeneratingDone: cellKey });
        }
        removeTask(taskId);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingCell, toast, addTask, removeTask]);

  /* ── Upload custom image to replace a grid cell（通过图片来源选择器） ── */
  const handleUploadCellImage = useCallback((cellKey: string) => {
    imageSourceCallbackRef.current = async (dataUrl: string) => {
      try {
        // Phase 1: 立即用 data URL 显示（不等磁盘保存）
        // ★ 推入历史栈，支持撤回
        pushToHistory(cellKey);
        setGridImages((prev) => ({ ...prev, [cellKey]: dataUrl }));
        notifyGridOpUpdate({ images: { [cellKey]: dataUrl } });
        // Phase 2: 后台保存磁盘，完成后用磁盘 URL 替换 data URL
        const uploadUrlMap = await saveGridImagesToDisk({ [cellKey]: dataUrl });
        if (Object.keys(uploadUrlMap).length > 0) {
          setGridImages((prev) => ({ ...prev, ...uploadUrlMap }));
          notifyGridOpUpdate({ images: uploadUrlMap });
          toast("图片导入成功 ✓", "success");
        } else {
          toast("图片已显示但磁盘保存失败，刷新后可能丢失", "info");
        }
      } catch (e) {
        toast(`导入失败: ${e instanceof Error ? e.message : "未知"}`, "error");
      }
    };
    setShowImageSourcePicker(true);
  }, [toast]);

  /** Collect consistency refs with images for the edit modal picker */
  const editConsistencyRefs = useMemo(() => {
    const refs: Array<{ id: string; name: string; image: string; type: "character" | "scene" | "prop" | "style" }> = [];
    for (const c of consistency.characters) {
      if (c.referenceImage) refs.push({ id: c.id, name: c.name, image: c.referenceImage, type: "character" });
    }
    for (const s of consistency.scenes) {
      if (s.referenceImage) refs.push({ id: s.id, name: s.name, image: s.referenceImage, type: "scene" });
    }
    for (const p of consistency.props) {
      if (p.referenceImage) refs.push({ id: p.id, name: p.name, image: p.referenceImage, type: "prop" });
    }
    if (consistency.style.styleImage) {
      refs.push({ id: "style", name: "风格参考", image: consistency.style.styleImage, type: "style" });
    }
    return refs;
  }, [consistency]);

  /** Collect grid cell images (nine-grid + all four-grid beats) for the edit modal storyboard picker */
  const editGridCellImages = useMemo(() => {
    const items: Array<{ key: string; label: string; group: string; image: string }> = [];
    // Nine-grid cells
    for (let i = 0; i < 9; i++) {
      const key = `nine-${episode}-${i}`;
      const img = gridImages[key];
      if (img) items.push({ key, label: `格${i + 1}`, group: `九宫格`, image: img });
    }
    // Four-grid cells — all beats for current episode
    for (let b = 0; b < fourGroups.length; b++) {
      for (let i = 0; i < 4; i++) {
        const key = `four-${episode}-${b}-${i}`;
        const img = gridImages[key];
        const subLabels = ["左上", "右上", "左下", "右下"];
        if (img) items.push({ key, label: subLabels[i], group: `四宫格 组${b + 1}`, image: img });
      }
    }
    return items;
  }, [episode, gridImages, fourGroups.length]);

  /** Compute which characters/scenes/props appear in current episode's prompts */
  const episodeMentions = useMemo((): EpisodeMentions => {
    // ★ 包含智能分镜提示词，确保 RefBindPanel 在 smartNine 模式下也能正确匹配
    const allPromptText = [...ninePrompts, ...fourGroups.flat(), ...smartNinePrompts].join("\n");
    if (!allPromptText.trim()) return { characters: [], scenes: [], props: [] };
    const characters = consistency.characters
      .filter((c) => itemMatchesPrompt(c, allPromptText))
      .map((c) => c.name);
    // Use relaxed matching for scenes: partial name match + lower description keyword threshold
    // Scene names (e.g., "妖兽谷第二层") often don't appear verbatim in prompts,
    // but partial matches (e.g., "妖兽谷") or single description keywords may appear.
    const scenes = consistency.scenes
      .filter((s) => itemMatchesPromptRelaxed(s, allPromptText))
      .map((s) => s.name);
    const props = consistency.props
      .filter((p) => itemMatchesPrompt(p, allPromptText))
      .map((p) => p.name);
    return { characters, scenes, props };
  }, [consistency, ninePrompts, fourGroups, smartNinePrompts]);

  // ── AI Extraction ──

  const extractAbortRef = useRef<AbortController | null>(null);

  async function handleAiExtract() {
    if (extracting) return; // Double-click guard
    setExtracting(true);
    setExtractProgress("");
    const taskId = `llm-extract-${Date.now()}`;
    addTask({ id: taskId, type: "llm", label: "AI提取角色/场景/道具", detail: "文本模型" });
    // Abort previous extract if still running
    extractAbortRef.current?.abort();
    const extractController = new AbortController();
    extractAbortRef.current = extractController;

    // Frontend-side 5-minute hard timeout to avoid infinite wait
    const EXTRACT_TIMEOUT_MS = 5 * 60 * 1000;
    const timeoutId = setTimeout(() => {
      extractController.abort();
      toast("AI提取超时（5分钟），请检查网络或换用更快的模型后重试", "error");
    }, EXTRACT_TIMEOUT_MS);
    // Elapsed time hint: update task detail every 30s so user sees progress
    const startTime = Date.now();
    const elapsedInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      updateTask(taskId, { detail: `文本模型 (已等待 ${elapsed}s)` });
    }, 30_000);

    try {
      let scripts = await loadScriptsDB();
      if (scripts.length === 0) {
        scripts = await migrateScriptsFromLocalStorage();
      }
      // Bug fix: prioritize the user's currently-active script instead of always using the first one.
      // 1) Check feicai-pipeline-script-id (set by scripts/pipeline pages)
      // 2) Try matching current episode id
      // 3) Fall back to last script with sufficient content
      const activeScriptId = localStorage.getItem("feicai-pipeline-script-id") || "";
      let script = activeScriptId
        ? scripts.find((s: { id?: string; content?: string }) => s.id === activeScriptId && s.content && s.content.length > 50)
        : null;
      if (!script && episode) {
        script = scripts.find((s: { id?: string; content?: string }) => s.id === episode && s.content && s.content.length > 50);
      }
      if (!script) {
        // Fall back: use the last script with content (most recently added), not the first
        script = [...scripts].reverse().find((s: { content?: string }) => s.content && s.content.length > 50);
      }
      // ★ Prioritize chapter selection from scripts page (stored in localStorage)
      let text = "";
      let textSource = ""; // 诊断：记录文本来源
      // ★ 0) 最优先：Agent 导入的剧本上下文（FC 智能体 import_script action 存入）
      try {
        const agentScript = localStorage.getItem("feicai-agent-script-context");
        if (agentScript && agentScript.length > 50) {
          text = agentScript;
          const agentTitle = localStorage.getItem("feicai-agent-script-title") || "";
          textSource = `智能体导入剧本${agentTitle ? `「${agentTitle}」` : ""}`;
        }
      } catch { /* ignore */ }
      // 1) 已选章节
      try {
        if (!text) {
          const chapterJson = localStorage.getItem("feicai-pipeline-script-chapter");
          if (chapterJson) {
            const ch = JSON.parse(chapterJson);
            if (ch?.content && ch.content.length > 50) {
              text = ch.content;
              textSource = `已选章节「${ch.title || "?"}」`;
            }
          }
        }
      } catch { /* ignore */ }
      // Fall back to full script content if no chapter selected
      if (!text && script) {
        text = script.content || "";
        textSource = `剧本「${(script as { title?: string }).title || script.id || "?"}」`;
      }
      if (!text && !script) {
        textSource = "无可用剧本";
      }
      if (ninePrompts.length > 0) {
        text += "\n\n---九宫格提示词---\n\n" + ninePrompts.join("\n\n---\n\n");
        if (!textSource) textSource = "九宫格提示词";
      }
      // ★ 诊断日志：打印实际使用的文本来源和前 100 字
      console.log(`[AI提取] 来源: ${textSource} | 总长: ${text.length}字 | 前100字: ${text.slice(0, 100).replace(/\n/g, "↵")}`);
      if (text.length < 50) {
        console.warn(`[AI提取] 文本过短 (${text.length}字)，来源: ${textSource}，scripts数量: ${scripts.length}`);
        toast(`没有可用的剧本内容（来源: ${textSource}，${text.length}字），请先在「剧本管理」中添加剧本`, "error");
        setExtracting(false); clearTimeout(timeoutId); clearInterval(elapsedInterval); return;
      }
      toast(`正在提取 · ${textSource} (${text.length.toLocaleString()}字)`, "info");

      const settings = getSettings();
      const apiKey = settings["llm-key"];
      if (!apiKey) {
        toast("请先在「设置」页配置 LLM API Key", "error");
        setExtracting(false);
        clearTimeout(timeoutId);
        clearInterval(elapsedInterval);
        return;
      }

      // Pass existing stylePrompt so AI extraction generates style-consistent prompts
      // 如果用户在提示词编辑页自定义了 extract 提示词，则传 customPrompt 走单阶段路径
      const existingStylePrompt = consistency.style.stylePrompt || "";
      let extractCustomPrompt: string | undefined;
      try {
        const savedRaw = await kvLoad("feicai-system-prompts");
        if (savedRaw) {
          const saved = JSON.parse(savedRaw);
          if (saved.extract && saved.extract.length > 50) extractCustomPrompt = saved.extract;
        }
      } catch { /* ignore */ }
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, settings, stylePrompt: existingStylePrompt || undefined, ...(extractCustomPrompt ? { customPrompt: extractCustomPrompt } : {}) }),
        signal: extractController.signal,
      });

      // SSE 流式响应（两阶段路径）或 JSON 响应（单阶段路径）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any = null;
      const contentType = res.headers.get("Content-Type") || "";
      if (res.ok && contentType.includes("text/event-stream")) {
        // 消费 SSE 流：实时接收进度事件 + 最终结果
        setExtractProgress("正在连接 AI 模型...");
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // 按 SSE 双换行分割事件
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === "progress") {
                setExtractProgress(evt.message || "");
              } else if (evt.type === "result") {
                data = evt.data;
              } else if (evt.type === "error") {
                toast(`提取失败: ${evt.error || "未知错误"}`, "error");
                return;
              }
            } catch { /* 忽略非JSON行 */ }
          }
        }
        if (!data) {
          toast("提取失败: 未收到 AI 结果", "error");
          return;
        }
      } else if (res.ok) {
        // 旧路径：单阶段 JSON 响应
        data = await res.json();
      } else {
        const err = await res.json().catch(() => ({}));
        const errDetail = (err as Record<string, string>).raw ? `\n(AI原始输出: ${(err as Record<string, string>).raw.slice(0, 100)}...)` : "";
        toast(`提取失败: ${(err as Record<string, string>).error || "未知错误"}${errDetail}`, "error");
        return;
      }

      if (data) {

        // ★ Overwrite mode: replace all existing items with fresh AI extraction results
        // Only referenceImage is NOT lost — if a new item matches an old one by name, keep the old image
        function freshItems<T extends { id: string; name: string; referenceImage?: string; prompt?: string; aliases?: string[] }>(
          existing: T[],
          extracted: { name: string; description: string; prompt?: string; aliases?: string[] }[],
          idPrefix: string
        ): T[] {
          return extracted.map((newItem, i) => {
            // Try to find an existing item with the same name to preserve its referenceImage
            const normalName = (newItem.name || "").toLowerCase().trim();
            const matched = normalName ? existing.find((old) => (old.name || "").toLowerCase().trim() === normalName) : undefined;
            return {
              id: matched?.id || `${idPrefix}-${Date.now()}-${i}`,  // ★ 匹配时保留原 ID，避免并发 generateRefImage 找不到 item
              name: newItem.name,
              description: newItem.description,
              prompt: newItem.prompt || "",
              aliases: newItem.aliases || [],
              referenceImage: matched?.referenceImage || undefined,
            } as unknown as T;
          });
        }

        // ★ 覆盖模式：有新数据时替换，空类别保留已有数据（防止截断导致清零）
        // ★ 从函数式更新器中捕获计算值，同步保存到 IDB（修复 queueMicrotask 竞态：
        //   旧代码 queueMicrotask 在 React 渲染前执行，consistencyRef.current 仍是旧值，导致旧数据覆盖 IDB）
        let extractedSnapshot: ConsistencyProfile | null = null;
        setConsistency((prev) => {
          const updated: ConsistencyProfile = { ...prev };
          if (data.characters?.length > 0) {
            updated.characters = freshItems(prev.characters, data.characters, "char");
          }
          // else: 保留 prev.characters，不清零
          if (data.scenes?.length > 0) {
            updated.scenes = freshItems(prev.scenes, data.scenes, "scene");
          }
          // else: 保留 prev.scenes，不清零
          if (data.props?.length > 0) {
            updated.props = freshItems(prev.props, data.props, "prop");
          }
          // else: 保留 prev.props，不清零
          if (data.style) {
            // ★ Skip style overwrite if locked
            if (!updated.style.styleLocked) {
              updated.style = { ...updated.style,
                artStyle: data.style.artStyle || updated.style.artStyle,
                colorPalette: data.style.colorPalette || updated.style.colorPalette,
                // ★ 自动填充 timeSetting，但保留用户已有的自定义值
                timeSetting: updated.style.timeSetting || data.style.timeSetting || "",
              };
            }
          }
          extractedSnapshot = updated;
          return updated;
        });
        // ★ 显式保存：防止页面卸载前 auto-save effect 未触发导致数据丢失
        // React 同步调用函数式更新器，extractedSnapshot 此时已是最新计算值
        if (extractedSnapshot) {
          saveConsistency(extractedSnapshot);
          console.log(`[AI提取] 显式保存 extractedSnapshot → 角色${(extractedSnapshot as ConsistencyProfile).characters.length} 场景${(extractedSnapshot as ConsistencyProfile).scenes.length} 道具${(extractedSnapshot as ConsistencyProfile).props.length}`);

          // ★ 清理孤儿 URL：标记过时的旧 ID，让磁盘文件不再被 UI 引用。
          //   仅 revoke URL 引用（从 consistency 状态中移除），不删除磁盘文件本身。
          //   对比提取前（prev captured via closure）和提取后的 ID，找出被淘汰的旧 ID。
          const csProfile = extractedSnapshot as ConsistencyProfile;
          const currentIds = new Set<string>();
          for (const c of csProfile.characters) currentIds.add(c.id);
          for (const s of csProfile.scenes) currentIds.add(s.id);
          for (const p of csProfile.props) currentIds.add(p.id);
          // 清理 nineGridRefIds / fourGridRefIds / cellRefIds 中引用已删除条目的绑定 ID
          setNineGridRefIdsByEp((prev) => {
            const next: typeof prev = {};
            for (const [ep, ids] of Object.entries(prev)) next[ep] = ids.filter(id => currentIds.has(id));
            return next;
          });
          setFourGridRefIdsByEp((prev) => {
            const next: typeof prev = {};
            for (const [ep, beats] of Object.entries(prev)) {
              next[ep] = {};
              for (const [b, ids] of Object.entries(beats)) next[ep][Number(b)] = (ids as string[]).filter(id => currentIds.has(id));
            }
            return next;
          });
          setCellRefIds((prev) => {
            const next: typeof prev = {};
            for (const [k, ids] of Object.entries(prev)) next[k] = ids.filter(id => currentIds.has(id));
            return next;
          });
          setSmartNineGridRefIdsByEp((prev) => {
            const next: typeof prev = {};
            for (const [ep, ids] of Object.entries(prev)) next[ep] = ids.filter(id => currentIds.has(id));
            return next;
          });
          setCustomGridRefIdsByEp((prev) => {
            const next: typeof prev = {};
            for (const [ep, ids] of Object.entries(prev)) next[ep] = ids.filter(id => currentIds.has(id));
            return next;
          });
        }
        const charCount = data.characters?.length || 0;
        const sceneCount = data.scenes?.length || 0;
        const propCount = data.props?.length || 0;
        toast(`提取完成！角色 ${charCount}，场景 ${sceneCount}，道具 ${propCount}`, "success");

        // ★ 显示 Phase 2 英文提示词生成失败的警告
        if (Array.isArray(data.warnings) && data.warnings.length > 0) {
          for (const w of data.warnings) {
            toast(w, "error");
          }
        }
        setLeftTab("chars");

        // ★ 自动导出提取数据到 outputs 目录
        if (extractedSnapshot) {
          exportConsistencyToFile(extractedSnapshot as ConsistencyProfile).then(ok => {
            if (ok) console.log("[AI提取] 提取数据已自动导出到 outputs/");
          });
        }
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // Timeout-triggered abort already shows its own toast; user-triggered abort is silent
        return;
      }
      toast(`提取错误: ${e instanceof Error ? e.message : "未知"}`, "error");
    } finally {
      clearTimeout(timeoutId);
      clearInterval(elapsedInterval);
      setExtracting(false);
      setExtractProgress("");
      removeTask(taskId);
    }
  }

  // ── Reference Image Generation ──

  async function generateRefImage(listKey: "characters" | "scenes" | "props", itemId: string, description: string) {
    // ★ Guard: wait for reference images to finish loading from IndexedDB
    if (!isConsistencyImagesLoaded) { toast("参考图数据正在加载中，请稍候再试...", "info"); return; }
    // Guard: prevent concurrent generation for the same item (synchronous lock to prevent TOCTOU)
    const refGenKey = `ref-${itemId}`;
    if (generatingLockRef.current.has(refGenKey)) { toast("该参考图正在生成中，请勿重复点击", "info"); return; }
    generatingLockRef.current.add(refGenKey);
    setGeneratingRefSet((prev) => new Set(prev).add(itemId));
    // Use extracted English prompt (has proper three-view / no-people / close-up rules from AI extraction)
    const item = consistency[listKey].find((i) => i.id === itemId);
    const extractedPrompt = item?.prompt || "";

    // Get the item name for the label overlay requirement
    const itemName = item?.name || description.slice(0, 10);
    const labelTypeMap: Record<string, string> = { characters: "Character", scenes: "Scene", props: "Prop" };
    // Scene refs are multi-angle panoramic — only need a small label in top-left corner
    // Characters and props need a large prominent red label
    const labelInstruction = listKey === "scenes"
      ? `\n\n[IMPORTANT] Place a red bold text label ONLY in the top-left corner of the image: "${labelTypeMap[listKey]}: ${itemName}". Use a moderate font size, not too large, do not obscure the main subject.`
      : `\n\n[IMPORTANT] Place a large red bold text label in the top-left corner of the image: "${labelTypeMap[listKey]}: ${itemName}". The text must be clearly legible, red (#FF0000), bold, and as large as possible.`;

    let prompt: string;
    if (extractedPrompt.length > 20) {
      // Extracted prompt already contains three-view/no-people rules
      // Only include style context (not ALL characters/scenes/props) to avoid noise
      const styleParts: string[] = [];
      styleParts.push("[Overall Style Requirements]");
      styleParts.push(`- Aspect Ratio: ${consistency.style.aspectRatio}`);
      styleParts.push(`- Resolution: ${consistency.style.resolution || "4K"}`);
      if (consistency.style.stylePrompt) {
        try {
          const sp = JSON.parse(consistency.style.stylePrompt);
          if (sp.artStyle) styleParts.push(`- 美术风格: ${sp.artStyle}`);
          if (sp.colorPalette) styleParts.push(`- Color Palette: ${sp.colorPalette}`);
          if (sp.styleKeywords) styleParts.push(`- Style Keywords: ${sp.styleKeywords}`);
          if (sp.mood) styleParts.push(`- Mood: ${sp.mood}`);
        } catch {
          styleParts.push(`- AI-Detected Style: ${consistency.style.stylePrompt}`);
        }
      } else {
        if (consistency.style.artStyle) styleParts.push(`- 美术风格: ${consistency.style.artStyle}`);
        if (consistency.style.colorPalette) styleParts.push(`- Color Palette: ${consistency.style.colorPalette}`);
      }
      prompt = `${styleParts.join("\n")}\n\n${extractedPrompt}${labelInstruction}`;
    } else {
      // Fallback with STRICT three-view / no-people / close-up rules
      // Only include THIS item's description + style context
      const styleParts: string[] = [];
      styleParts.push("[Overall Style Requirements]");
      styleParts.push(`- Aspect Ratio: ${consistency.style.aspectRatio}`);
      styleParts.push(`- Resolution: ${consistency.style.resolution || "4K"}`);
      if (consistency.style.stylePrompt) {
        try {
          const sp = JSON.parse(consistency.style.stylePrompt);
          if (sp.artStyle) styleParts.push(`- 美术风格: ${sp.artStyle}`);
          if (sp.colorPalette) styleParts.push(`- Color Palette: ${sp.colorPalette}`);
          if (sp.styleKeywords) styleParts.push(`- Style Keywords: ${sp.styleKeywords}`);
          if (sp.mood) styleParts.push(`- Mood: ${sp.mood}`);
        } catch {
          styleParts.push(`- AI-Detected Style: ${consistency.style.stylePrompt}`);
        }
      } else {
        if (consistency.style.artStyle) styleParts.push(`- 美术风格: ${consistency.style.artStyle}`);
        if (consistency.style.colorPalette) styleParts.push(`- Color Palette: ${consistency.style.colorPalette}`);
      }
      const fallbackPrompts: Record<string, string> = {
        characters: [
          `Character three-view reference sheet: ${description}`,
          "Requirements: character sheet, three views, (front view, side view, back view), t-pose, full body, isolated on white background, studio lighting",
          "Must show front view, side view, and back view simultaneously, white background, full body standing pose",
        ].join("\n"),
        scenes: [
          `Scene concept art: ${description}`,
          `Requirements: extreme long shot, panoramic view, wide angle, establishing shot, cinematic lighting, ${consistency.style.aspectRatio} aspect ratio`,
          "No characters allowed in the scene! scenery only, no people, no humans",
        ].join("\n"),
        props: [
          `Prop close-up reference: ${description}`,
          "Requirements: close up, object focus, product shot, concept art, centered composition, neutral background, 8k resolution",
          "No hands or humans allowed in the image. no hands, no humans",
        ].join("\n"),
      };
      prompt = `${styleParts.join("\n")}\n\n${fallbackPrompts[listKey]}${labelInstruction}`;
    }

    toast("正在生成参考图...", "info");
    const taskId = `image-ref-${listKey}-${itemId}-${Date.now()}`;
    addTask({ id: taskId, type: "image", label: `参考图 ${description.slice(0, 10)}`, detail: `${listKey === "characters" ? "角色" : listKey === "scenes" ? "场景" : "道具"} · 图像模型` });
    try {
      // ★ Only include style image as reference — do NOT include ALL character/scene/prop refs
      //   to avoid reference images accumulating with each generation
      const refImages: string[] = [];
      const si = consistency.style.styleImage;
      if (includeStyleRefInModel && si && (si.startsWith("data:") || si.startsWith("http"))) {
        refImages.push(si);
      }
      const typeLabel = listKey === "characters" ? "角色" : listKey === "scenes" ? "场景" : "道具";
      const pickerLabel = `${typeLabel}: ${itemName}`;
      console.log(`[generateRefImage] calling image API for ${listKey}/${itemId}, refImages=${refImages.length} (style only)`);
      const url = await callImageApi(prompt, refImages, undefined, pickerLabel, { listKey, itemId });
      console.log(`[generateRefImage] image API returned: ${url ? url.slice(0, 80) + '...' : 'null'}`);
      if (url) {
        // Persist HTTP URL as data URL to prevent expiry (model-generated URLs are temporary)
        const persistedUrl = url.startsWith("http") ? await httpUrlToDataUrl(url) : url;
        console.log(`[generateRefImage] ✓ ${listKey}/${itemId}: ${persistedUrl.startsWith("data:") ? "dataURL" : "httpURL"} (${Math.round(persistedUrl.length / 1024)}KB)`);
        let itemUpdated = false;
        let actualSaveId = itemId;
        setConsistency((prev) => {
          const next = { ...prev };
          let matched = next[listKey].find((item) => item.id === itemId);
          if (!matched) {
            // ★ ID 未找到时按 description 模糊匹配（handleAiExtract 可能已替换 ID）
            matched = next[listKey].find((item) => item.description === description || item.name === description.split(/[,，]/)[0]?.trim());
            if (matched) {
              console.warn(`[generateRefImage] ⚠ item ${itemId} ID 已变更，通过名称匹配到 ${matched.id}`);
              actualSaveId = matched.id;
            } else {
              console.warn(`[generateRefImage] ⚠ item ${itemId} not found in ${listKey} (${next[listKey].length} items: ${next[listKey].map(i => i.id).join(",")})`);
            }
          }
          if (matched) {
            next[listKey] = next[listKey].map((item) =>
              item.id === matched!.id ? { ...item, referenceImage: persistedUrl } : item
            );
            itemUpdated = true;
          }
          return next;
        });
        // ★ 直接持久化单项到磁盘（不使用 saveConsistencyImages 避免并发竞态删除其他项）
        // 自动保存 effect 会在 React 重渲染后用最新完整状态写盘
        if (itemUpdated) {
          const saved = await persistRefImage(actualSaveId, persistedUrl);
          if (!saved) {
            console.error(`[generateRefImage] ✗ 磁盘保存失败: ${actualSaveId} (${Math.round(persistedUrl.length / 1024)}KB)`);
          }
          toast("参考图已生成 ✓", "success");
        } else {
          toast("参考图已生成，但目标角色已变更，请重新点击生成", "info");
        }
      } else {
        toast("图像 API 返回为空，请检查图像模型配置", "error");
      }
    } catch (e) { console.error('[generateRefImage] error:', e); toast("参考图生成网络错误", "error"); } finally { generatingLockRef.current.delete(refGenKey); setGeneratingRefSet((prev) => { const s = new Set(prev); s.delete(itemId); return s; }); removeTask(taskId); }
  }

  // ── 即梦历史选图：从 FAB 历史任务中选图并应用到一致性项目 / 宫格格子 ──
  async function handleJimengHistoryPick(result: JimengPickerResult) {
    const task = jimengHistoryPicker?.task;
    if (!task) return;
    setJimengHistoryPicker(null);

    const selectedUrl = result.url;
    if (!selectedUrl) return;

    // ★ 持久化用户选中的图片索引，下次打开弹窗回显
    // ★ 同时锁定选图，防止切换页面后回退到第一张
    try {
      const store = getJimengTaskStore();
      store.updateSelectedIndex(task.taskId, result.index);
      store.lockSelection(task.taskId);
    } catch { /* ignore */ }

    // ★ URL → data URL 转换（确保 saveGridImagesToDisk 能正确写盘）
    //   _persistAllImages 会将 HTTP URL 替换为 /api/jimeng-image?key=... 本地 URL,
    //   而 saveGridImagesToDisk 仅接受 data: / http 开头的值，/api/ 会被跳过。
    async function toSavableUrl(url: string): Promise<string> {
      if (url.startsWith("data:")) return url;
      if (url.startsWith("http")) return await httpUrlToDataUrl(url);
      if (url.startsWith("/api/")) {
        try {
          const resp = await fetch(url);
          if (!resp.ok) return url;
          const blob = await resp.blob();
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch { return url; }
      }
      return url;
    }

    // ★ 优先：宫格格子目标（九宫格/智能分镜/四宫格/重新生成）
    if (task.targetGridKey) {
      try {
        const persistedUrl = await toSavableUrl(selectedUrl);
        const cellSave: Record<string, string> = { [task.targetGridKey]: persistedUrl };
        // ★ 推入历史栈，支持撤回
        pushToHistory(task.targetGridKey);
        setGridImages((prev) => ({ ...prev, ...cellSave }));
        notifyGridOpUpdate({ images: cellSave });
        // 后台持久化到磁盘
        const diskUrlMap = await saveGridImagesToDisk(cellSave);
        setGridImages((prev) => ({ ...prev, ...diskUrlMap }));
        notifyGridOpUpdate({ images: diskUrlMap });
        toast(`已应用选图到「${task.label}」 ✓`, "success");
      } catch (e) {
        console.error("[handleJimengHistoryPick] grid error:", e);
        toast("应用选图到格子失败", "error");
      }
      return;
    }

    // ★ 一致性项目目标（角色/场景/道具参考图）
    if (task.targetListKey && task.targetItemId) {
      const listKey = task.targetListKey;
      const itemId = task.targetItemId;
      try {
        // 将 HTTP / /api/ URL 转为 data URL 防止过期
        const persistedUrl = await toSavableUrl(selectedUrl);
        let itemUpdated = false;
        let actualSaveId = itemId;
        setConsistency((prev) => {
          const next = { ...prev };
          let matched = next[listKey].find((item) => item.id === itemId);
          if (!matched) {
            // 按名称模糊匹配（ID 可能已变更）
            const labelName = task.label.replace(/^(角色|场景|道具)[：:]\s*/, "");
            matched = next[listKey].find((item) => item.name === labelName);
            if (matched) actualSaveId = matched.id;
          }
          if (matched) {
            next[listKey] = next[listKey].map((item) =>
              item.id === matched!.id ? { ...item, referenceImage: persistedUrl } : item
            );
            itemUpdated = true;
          }
          return next;
        });
        if (itemUpdated) {
          const saved = await persistRefImage(actualSaveId, persistedUrl);
          if (!saved) console.error(`[handleJimengHistoryPick] ✗ 磁盘保存失败: ${actualSaveId}`);
          toast(`已应用选图到「${task.label}」 ✓`, "success");
        } else {
          toast("目标项目已删除或变更，无法应用", "error");
        }
      } catch (e) {
        console.error("[handleJimengHistoryPick] error:", e);
        toast("应用选图失败", "error");
      }
    } else {
      // ★ 无目标信息（旧任务）——自动应用到当前选中的格子
      try {
        let fallbackGridKey: string | undefined;
        if (activeMode === "nine") {
          fallbackGridKey = `nine-${episode}-${selectedCell}`;
        } else if (activeMode === "smartNine") {
          fallbackGridKey = `smartNine-${episode}-${selectedCell}`;
        } else if (activeMode === "four") {
          fallbackGridKey = `four-${episode}-${fourBeat}-${selectedCell}`;
        }

        if (fallbackGridKey) {
          const persistedUrl = await toSavableUrl(selectedUrl);
          const cellSave: Record<string, string> = { [fallbackGridKey]: persistedUrl };
          // ★ 推入历史栈，支持撤回
          pushToHistory(fallbackGridKey);
          setGridImages((prev) => ({ ...prev, ...cellSave }));
          notifyGridOpUpdate({ images: cellSave });
          const diskUrlMap = await saveGridImagesToDisk(cellSave);
          setGridImages((prev) => ({ ...prev, ...diskUrlMap }));
          notifyGridOpUpdate({ images: diskUrlMap });
          const modeLabel = activeMode === "nine" ? "九宫格" : activeMode === "smartNine" ? "智能分镜" : "四宫格";
          toast(`已应用到当前${modeLabel}格${selectedCell + 1} ✓`, "success");
        } else {
          // 终极兜底：复制到剪贴板
          await navigator.clipboard.writeText(selectedUrl);
          toast("图片 URL 已复制到剪贴板", "info");
        }
      } catch (e) {
        console.error("[handleJimengHistoryPick] fallback error:", e);
        toast("应用选图失败", "error");
      }
    }
  }

  // ── Style Image Analysis ──

  async function handleStyleAnalyze(imageUrl: string) {
    // Cancel any in-flight analysis (prevents race when user uploads multiple images quickly)
    styleAnalyzeAbortRef.current?.abort();
    const controller = new AbortController();
    styleAnalyzeAbortRef.current = controller;

    const settings = getSettings();
    if (!settings["llm-key"]) {
      toast("请先在「设置」页配置 LLM API Key", "error");
      return;
    }

    setAnalyzingStyle(true);
    toast("正在AI识别风格...", "info");
    const taskId = `llm-style-${Date.now()}`;
    addTask({ id: taskId, type: "llm", label: "AI风格识别", detail: "文本模型" });
    try {
      const systemPrompts = await loadSystemPromptsAsync();
      const res = await fetch("/api/style-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, settings, customPrompt: systemPrompts.styleAnalyze || undefined }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        setConsistency((prev) => ({
          ...prev, style: {
            ...prev.style,
            artStyle: data.artStyle || prev.style.artStyle,
            colorPalette: data.colorPalette || prev.style.colorPalette,
            stylePrompt: JSON.stringify({
              artStyle: data.artStyle || "",
              colorPalette: data.colorPalette || "",
              styleKeywords: data.styleKeywords || "",
              mood: data.mood || "",
            }),
          },
        }));
        // Explicit save for background operation support (auto-save effect won't fire if unmounted)
        {
          const prevC = consistencyRef.current;
          const updated = {
            ...prevC, style: {
              ...prevC.style,
              artStyle: data.artStyle || prevC.style.artStyle,
              colorPalette: data.colorPalette || prevC.style.colorPalette,
              stylePrompt: JSON.stringify({
                artStyle: data.artStyle || "",
                colorPalette: data.colorPalette || "",
                styleKeywords: data.styleKeywords || "",
                mood: data.mood || "",
              }),
            },
          };
          saveConsistency(updated);
        }
        toast("风格识别完成 ✓", "success");
      } else {
        const err = await res.json().catch(() => ({}));
        toast(`风格识别失败: ${err.error || "未知"}`, "error");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // Cancelled by newer upload
      toast("风格识别网络错误", "error");
    } finally {
      // Only clear loading state if this controller is still current (not superseded by newer analysis)
      if (styleAnalyzeAbortRef.current === controller) setAnalyzingStyle(false);
      removeTask(taskId);
    }
  }

  function handleStyleUpload() {
    imageSourceCallbackRef.current = async (dataUrl: string) => {
      try {
        // ★ Compress to same params as character referenceImage (2048px/0.85)
        // This ensures dedup works when the same source file is used for both style and character ref
        const normalizedStyleImg = await compressImage(dataUrl, 2048, 0.85);
        // Save normalized image for display AND dedup
        setConsistency((prev) => ({
          ...prev, style: { ...prev.style, styleImage: normalizedStyleImg },
        }));
        // ★ 立即保存到磁盘（与 Pipeline 一致，确保跨页面同步）
        try {
          await fetch("/api/ref-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: "style-image", imageData: normalizedStyleImg }),
          });
        } catch (err) { console.error("[handleStyleUpload] 风格图磁盘保存失败:", err); }
        // Compress further for AI style analysis (max 1024px, JPEG 80%)
        const compressed = await compressImage(dataUrl, 1024, 0.8);
        // Send compressed image to AI for analysis
        await handleStyleAnalyze(compressed);
      } catch (err) {
        console.error("[handleStyleUpload] compress/analyze error:", err);
        toast("风格图片处理失败，请尝试其他图片", "error");
      }
    };
    setShowImageSourcePicker(true);
  }

  // ── Consistency CRUD ──

  // ── 溶图合成：收集所有有参考图的一致性条目 ──
  const fusionItems = useMemo<FusionImageItem[]>(() => {
    const items: FusionImageItem[] = [];
    for (const c of consistency.characters) {
      if (c.referenceImage) items.push({ id: c.id, name: c.name, type: "character", imageUrl: c.referenceImage });
    }
    for (const s of consistency.scenes) {
      if (s.referenceImage) items.push({ id: s.id, name: s.name, type: "scene", imageUrl: s.referenceImage });
    }
    for (const p of consistency.props) {
      if (p.referenceImage) items.push({ id: p.id, name: p.name, type: "prop", imageUrl: p.referenceImage });
    }
    return items;
  }, [consistency.characters, consistency.scenes, consistency.props]);

  // ── 溶图合成回调：生成合成图后添加到当前标签页 ──
  const handleFusionComposite = useCallback(async (dataUrl: string, name: string) => {
    const listKey: "characters" | "scenes" | "props" =
      leftTab === "chars" ? "characters" : leftTab === "scenes" ? "scenes" : "props";
    const prefix = listKey.slice(0, 4);
    const newId = `${prefix}-${Date.now()}-fuse`;
    // 创建条目
    setConsistency((prev) => {
      const next = { ...prev, [listKey]: [...prev[listKey], { id: newId, name, description: "溶图合成", referenceImage: dataUrl }] };
      return next;
    });
    // 持久化到磁盘
    try {
      await fetch("/api/ref-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: newId, imageData: dataUrl }),
      });
    } catch (e) {
      console.warn("[handleFusionComposite] 保存合成图失败:", e);
    }
    toast(`溶图合成完成 → ${name}`, "success");
  }, [leftTab]);

  function addItem(listKey: "characters" | "scenes" | "props") {
    const typeNames = { characters: "新角色", scenes: "新场景", props: "新道具" };
    setConsistency((prev) => {
      const next = { ...prev };
      next[listKey] = [...next[listKey], { id: `${listKey.slice(0, 4)}-${Date.now()}`, name: typeNames[listKey], description: "" }];
      return next;
    });
  }

  // ── 从角色库导入参考图 ──
  const handleLibraryImport = useCallback(async (items: ImportItem[]) => {
    if (!items.length) return;
    // 1. 为每个导入项创建 consistency 条目
    setConsistency((prev) => {
      const next = { ...prev, characters: [...prev.characters], scenes: [...prev.scenes], props: [...prev.props] };
      for (const item of items) {
        const listKey = item.type === "character" ? "characters" : item.type === "scene" ? "scenes" : "props";
        const prefix = listKey.slice(0, 4);
        const newEntry = {
          id: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: item.name,
          description: item.description || "",
          prompt: item.prompt || "",
          referenceImage: item.imageDataUrl,
        };
        next[listKey] = [...next[listKey], newEntry];
      }
      return next;
    });
    // 2. 归档来源的图片需要物化到磁盘
    for (const item of items) {
      if (item.fromArchive && item.imageDataUrl) {
        // ★ 如果是 serve URL（文件已在磁盘），跳过物化
        if (item.imageDataUrl.startsWith("/api/ref-image?serve=")) continue;
        try {
          await fetch("/api/ref-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: item.sourceKey, imageData: item.imageDataUrl }),
          });
        } catch (e) {
          console.warn("[handleLibraryImport] 物化归档图片失败:", item.sourceKey, e);
        }
      }
    }
    toast(`已导入 ${items.length} 个参考项`, "success");
  }, []);

  function updateItem(listKey: "characters" | "scenes" | "props", itemId: string, field: string, value: string) {
    setConsistency((prev) => {
      const next = { ...prev };
      next[listKey] = next[listKey].map((item) => item.id === itemId ? { ...item, [field]: value } : item);
      return next;
    });
    // When clearing a reference image, clean up orphan binding IDs and persisted files
    if (field === "referenceImage" && !value) {
      const removeId = (ids: string[]) => ids.filter(id => id !== itemId);
      setNineGridRefIdsByEp((prev) => Object.fromEntries(
        Object.entries(prev).map(([ep, ids]) => [ep, removeId(ids)])
      ));
      setFourGridRefIdsByEp((prev) => Object.fromEntries(
        Object.entries(prev).map(([ep, beats]) => [ep, Object.fromEntries(
          Object.entries(beats).map(([b, ids]) => [b, removeId(ids as string[])])
        )])
      ));
      setCellRefIds((prev) => Object.fromEntries(
        Object.entries(prev).map(([k, ids]) => [k, removeId(ids)])
      ));
      // Clean up persisted files (disk)
      fetch(`/api/ref-image?key=${encodeURIComponent(itemId)}`, { method: "DELETE" }).catch(() => {});
    }
  }

  function deleteItem(listKey: "characters" | "scenes" | "props", itemId: string) {
    setConsistency((prev) => {
      const next = { ...prev };
      next[listKey] = next[listKey].filter((item) => item.id !== itemId);
      return next;
    });
    // Clean up orphan image on disk
    fetch(`/api/ref-image?key=${encodeURIComponent(itemId)}`, { method: "DELETE" }).catch(() => {});
    // Clean up binding state: remove deleted item ID from all ref binding maps
    const removeId = (ids: string[]) => ids.filter(id => id !== itemId);
    setNineGridRefIdsByEp((prev) => Object.fromEntries(
      Object.entries(prev).map(([ep, ids]) => [ep, removeId(ids)])
    ));
    setFourGridRefIdsByEp((prev) => Object.fromEntries(
      Object.entries(prev).map(([ep, beats]) => [ep, Object.fromEntries(
        Object.entries(beats).map(([b, ids]) => [b, removeId(ids as string[])])
      )])
    ));
    setCellRefIds((prev) => Object.fromEntries(
      Object.entries(prev).map(([k, ids]) => [k, removeId(ids)])
    ));
  }

  function handleUploadRef(listKey: "characters" | "scenes" | "props", itemId: string) {
    imageSourceCallbackRef.current = async (dataUrl: string) => {
      // Show loading state immediately
      setUploadingRefId(itemId);
      toast("图片正在处理中，请稍候...", "info");
      try {
        // Compress: 2048px max (good detail for reference), 0.85 quality
        const compressed = await compressImage(dataUrl, 2048, 0.85);
        const savedKB = Math.round((dataUrl.length - compressed.length) * 0.75 / 1024);
        console.log(`[handleUploadRef] ${listKey}/${itemId}: original=${Math.round(dataUrl.length * 0.75 / 1024)}KB → compressed=${Math.round(compressed.length * 0.75 / 1024)}KB (saved ${savedKB}KB)`);
        setConsistency((prev) => {
          const next = { ...prev };
          next[listKey] = next[listKey].map((item) => item.id === itemId ? { ...item, referenceImage: compressed } : item);
          return next;
        });
        toast("参考图已导入 ✓", "success");
      } catch (err) {
        console.error("[handleUploadRef] error:", err);
        toast("图片处理失败，请重试", "error");
      } finally {
        setUploadingRefId(null);
      }
    };
    setShowImageSourcePicker(true);
  }

  async function handleCopyPrompt(idx: number) {
    const prompt = activeMode === "smartNine" ? smartNinePrompts[idx] : activeMode === "nine" ? ninePrompts[idx] : fourGroups[fourBeat]?.[idx];
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      toast("提示词已复制", "success");
    } catch {
      toast("复制失败，浏览器不支持或权限不足", "error");
    }
  }

  /** AI 翻译：将一致性条目的中文描述翻译为英文 prompt */
  async function handleTranslateRefPrompt(category: "characters" | "scenes" | "props", itemId: string) {
    const list = category === "characters" ? consistency.characters : category === "scenes" ? consistency.scenes : consistency.props;
    const item = list.find((i) => i.id === itemId);
    if (!item) return;
    const desc = item.description?.trim();
    if (!desc) { toast("请先填写中文外观描述", "error"); return; }
    const settings = getSettings();
    if (!settings["llm-key"]) { toast("请先在设置页配置 LLM API Key", "error"); return; }
    setTranslatingRefIds((prev) => new Set(prev).add(itemId));
    const abortCtrl = new AbortController();
    const timer = setTimeout(() => abortCtrl.abort(), 60000); // 60s 总超时（含重试）
    try {
      // 优先从用户自定义提示词读取（提示词编辑页），否则用默认值
      let systemPrompt = "";
      try {
        const savedRaw = await kvLoad("feicai-system-prompts");
        if (savedRaw) {
          const saved = JSON.parse(savedRaw);
          if (saved.translatePrompt && saved.translatePrompt.length > 50) systemPrompt = saved.translatePrompt;
        }
      } catch { /* ignore */ }
      if (!systemPrompt) {
        const { TRANSLATE_PROMPT } = await import("../lib/defaultPrompts");
        systemPrompt = TRANSLATE_PROMPT;
      }
      const reqBody = JSON.stringify({
        apiKey: settings["llm-key"] || "",
        baseUrl: (settings["llm-url"] || "https://api.geeknow.top/v1").replace(/\/+$/, ""),
        model: settings["llm-model"] || "gemini-2.5-pro",
        provider: settings["llm-provider"] || "openAi",
        systemPrompt,
        prompt: desc,
        maxTokens: 3000,
      });
      // 支持 429 自动重试（最多 3 次，间隔递增 3s/6s/12s）
      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        res = await fetch("/api/llm", {
          signal: abortCtrl.signal, method: "POST",
          headers: { "Content-Type": "application/json" }, body: reqBody,
        });
        if (res.status !== 429) break;
        const wait = (attempt + 1) * 3000;
        console.log(`[AI翻译] 429 限流，${wait / 1000}s 后重试 (${attempt + 1}/3)`);
        toast(`API 限流，${wait / 1000}s 后自动重试…`, "info");
        await new Promise((r) => setTimeout(r, wait));
      }
      if (!res || !res.ok) {
        const errBody = await res?.text().catch(() => "") || "";
        console.error(`[AI翻译] API 失败: status=${res?.status}, body=${errBody.slice(0, 500)}`);
        throw new Error(`API 返回 ${res?.status || "无响应"}${errBody ? `: ${errBody.slice(0, 100)}` : ""}`);
      }
      const data = await res.json();
      console.log("[AI翻译] API 返回:", JSON.stringify(data).slice(0, 500));
      const fullText = (data.text || data.content || "").trim();
      if (!fullText) throw new Error("AI 返回空内容");
      // 解析双语输出：===英文=== ... ===中文=== ...（英文先行，中文为翻译）
      const enMatch = fullText.match(/===英文===\s*([\s\S]*?)(?====中文===|$)/);
      const cnMatch = fullText.match(/===中文===\s*([\s\S]*)/);
      const enPrompt = enMatch?.[1]?.trim() || "";
      const cnPrompt = cnMatch?.[1]?.trim() || "";
      if (cnPrompt && enPrompt) {
        // 双语都有：更新中文描述为完整中文提示词，英文写入 prompt
        updateItem(category, itemId, "description", cnPrompt);
        updateItem(category, itemId, "prompt", enPrompt);
        console.log(`[AI翻译] 双语解析成功: 中文${cnPrompt.length}字, 英文${enPrompt.length}字`);
      } else {
        // 兜底：无法解析双语格式，整体作为英文 prompt（兼容旧格式）
        console.warn("[AI翻译] 未检测到双语标记，整体作为英文 prompt");
        updateItem(category, itemId, "prompt", fullText);
      }
      toast("AI 翻译完成 ✓", "success");
    } catch (e) {
      const msg = e instanceof DOMException && e.name === "AbortError" ? "AI 翻译超时（60s）" : `AI 翻译失败: ${e instanceof Error ? e.message : "未知错误"}`;
      toast(msg, "error");
    } finally {
      clearTimeout(timer);
      setTranslatingRefIds((prev) => { const next = new Set(prev); next.delete(itemId); return next; });
    }
  }

  /** AI 批量翻译：将当前分类所有条目的中文描述翻译为英文 prompt */
  async function handleBatchTranslateRef(category: "characters" | "scenes" | "props") {
    const list = category === "characters" ? consistency.characters : category === "scenes" ? consistency.scenes : consistency.props;
    const itemsWithDesc = list.filter(item => item.description?.trim());
    if (itemsWithDesc.length === 0) { toast("没有可翻译的条目（请先填写中文描述）", "error"); return; }
    setBatchTranslating(true);
    let success = 0;
    for (const item of itemsWithDesc) {
      try {
        await handleTranslateRefPrompt(category, item.id);
        success++;
      } catch { /* 继续下一个 */ }
    }
    setBatchTranslating(false);
    toast(`批量翻译完成：${success}/${itemsWithDesc.length}`, "success");
  }

  /** AI 翻译：将中文描述翻译为英文提示词，自动填入 [IMG] 后 */
  async function handleTranslatePrompt(idx: number) {
    const fullPrompt = activeMode === "nine" ? ninePrompts[idx] : activeMode === "smartNine" ? smartNinePrompts[idx] : fourGroups[fourBeat]?.[idx];
    if (!fullPrompt) return;
    // 提取中文描述（[IMG] 之前的部分）
    const imgSplit = fullPrompt.split("**[IMG]**");
    const chineseDesc = (imgSplit[0] || "").trim();
    if (!chineseDesc) { toast("没有中文描述可翻译", "error"); return; }

    const settings = getSettings();
    if (!settings["llm-key"]) { toast("请先在设置页配置 LLM API Key", "error"); return; }

    setTranslatingPrompt((prev) => new Set(prev).add(idx));
    const abortCtrl = new AbortController();
    const timer = setTimeout(() => abortCtrl.abort(), 30000); // 30秒超时
    try {
      // 优先从用户自定义提示词读取（提示词编辑页），否则用默认值
      let systemPrompt = "";
      try {
        const savedRaw = await kvLoad("feicai-system-prompts");
        if (savedRaw) {
          const saved = JSON.parse(savedRaw);
          if (saved.translateGridPrompt && saved.translateGridPrompt.length > 50) systemPrompt = saved.translateGridPrompt;
        }
      } catch { /* ignore */ }
      if (!systemPrompt) {
        const { TRANSLATE_GRID_PROMPT } = await import("../lib/defaultPrompts");
        systemPrompt = TRANSLATE_GRID_PROMPT;
      }

      const res = await fetch("/api/llm", {
        signal: abortCtrl.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: settings["llm-key"] || "",
          baseUrl: (settings["llm-url"] || "https://api.geeknow.top/v1").replace(/\/+$/, ""),
          model: settings["llm-model"] || "gemini-2.5-pro",
          provider: settings["llm-provider"] || "openAi",
          systemPrompt,
          prompt: chineseDesc,
          maxTokens: 800,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `API 返回 ${res.status}`);
      }
      const data = await res.json();
      const fullText = (data.text || data.content || "").trim();
      if (!fullText) throw new Error("AI 返回空内容");

      // TRANSLATE_GRID_PROMPT 直接输出纯英文提示词，无需解析双语标记
      const translated = fullText;

      // 重建完整提示词：保留原始中文描述 + [IMG] + 英文提示词
      const newFull = `${chineseDesc}\n\n**[IMG]** ${translated}`;
      if (activeMode === "nine") {
        setPromptsEdited(true);
        setNinePrompts((prev) => { const next = [...prev]; next[idx] = newFull; return next; });
      } else if (activeMode === "smartNine") {
        setPromptsEdited(true);
        setSmartNinePrompts((prev) => { const next = [...prev]; next[idx] = newFull; return next; });
      } else {
        setPromptsEdited(true);
        setFourGroups((prev) => {
          const next = prev.map((g) => [...g]);
          if (next[fourBeat]) next[fourBeat][idx] = newFull;
          return next;
        });
      }
      toast("AI 翻译完成 ✓", "success");
    } catch (e) {
      const msg = e instanceof DOMException && e.name === "AbortError" ? "AI 翻译超时（30s）" : `AI 翻译失败: ${e instanceof Error ? e.message : "未知错误"}`;
      toast(msg, "error");
    } finally {
      clearTimeout(timer);
      setTranslatingPrompt((prev) => { const next = new Set(prev); next.delete(idx); return next; });
    }
  }

  // ── 一键生成连续动提示词（四宫格：九宫格单格 → 4个连续动作帧） ──
  async function handleGenerateContinuousAction() {
    // 获取九宫格源图（支持普通九宫格和智能分镜两种来源）
    const nineImgUrl = gridImages[`nine-${episode}-${fourBeat}`] || gridImages[`smartNine-${episode}-${fourBeat}`];
    if (!nineImgUrl) { toast("请先生成九宫格图片", "error"); return; }

    // 获取对应格子的中文场景描述
    const sourcePrompt = ninePrompts[fourBeat] || smartNinePrompts[fourBeat] || "";
    const chineseDesc = sourcePrompt.split("**[IMG]**")[0].trim();

    const settings = getSettings();
    if (!settings["llm-key"]) { toast("请先在设置页配置 LLM API Key", "error"); return; }

    setGeneratingContinuousAction(true);
    toast("AI 正在分析画面并生成连续动作提示词...", "info");
    const abortCtrl = new AbortController();
    const timer = setTimeout(() => abortCtrl.abort(), 60000); // 60秒超时

    try {
      // 压缩图片用于视觉分析
      const compressedImg = await compressImage(nineImgUrl, 768, 0.7, 500_000);

      // 加载系统提示词（优先从用户自定义 KV 读取，否则用默认值）
      let systemPrompt = "";
      try {
        const savedRaw = await kvLoad("feicai-system-prompts");
        if (savedRaw) {
          const saved = JSON.parse(savedRaw);
          if (saved.continuousAction && saved.continuousAction.length > 50) systemPrompt = saved.continuousAction;
        }
      } catch { /* ignore */ }
      if (!systemPrompt) {
        const { CONTINUOUS_ACTION_PROMPT } = await import("../lib/defaultPrompts");
        systemPrompt = CONTINUOUS_ACTION_PROMPT;
      }

      // 构建用户消息：包含场景描述
      const userMsg = chineseDesc
        ? `请分析这张分镜画面，并结合以下场景描述，将其展开为4个连续动作帧：\n\n${chineseDesc}`
        : "请分析这张分镜画面，将其展开为4个连续动作帧。";

      const res = await fetch("/api/llm", {
        signal: abortCtrl.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: settings["llm-key"] || "",
          baseUrl: (settings["llm-url"] || "https://api.geeknow.top/v1").replace(/\/+$/, ""),
          model: settings["llm-model"] || "gemini-2.5-pro",
          provider: settings["llm-provider"] || "openAi",
          systemPrompt,
          prompt: userMsg,
          images: [compressedImg],
          maxTokens: 2048,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `API 返回 ${res.status}`);
      }
      const data = await res.json();
      const rawText = (data.text || data.content || "").trim();
      if (!rawText) throw new Error("AI 返回空内容");

      // 解析 JSON 数组 — 支持 markdown 代码块包裹
      let jsonStr = rawText;
      const mdMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (mdMatch) jsonStr = mdMatch[1].trim();
      // 提取最外层 [ ... ]
      const bracketStart = jsonStr.indexOf("[");
      const bracketEnd = jsonStr.lastIndexOf("]");
      if (bracketStart >= 0 && bracketEnd > bracketStart) jsonStr = jsonStr.slice(bracketStart, bracketEnd + 1);

      const parsed: Array<{ cn: string; en: string }> = JSON.parse(jsonStr);
      if (!Array.isArray(parsed) || parsed.length < 4) throw new Error("AI 返回格式不正确（需要4个格子）");

      // 转换为四宫格提示词格式：中文描述 + [IMG] + 英文提示词
      const newScenes = parsed.slice(0, 4).map((item) => {
        const cn = (item.cn || "").trim();
        const en = (item.en || "").trim();
        return en ? `${cn}\n\n**[IMG]** ${en}` : cn;
      });

      // 更新 fourGroups
      setPromptsEdited(true);
      setFourGroups((prev) => {
        const next = prev.map((g) => [...g]);
        // 确保有足够的组
        while (next.length <= fourBeat) next.push([]);
        next[fourBeat] = newScenes;
        return next;
      });
      toast("连续动作提示词已生成 ✓（共4帧）", "success");
    } catch (e) {
      const msg = e instanceof DOMException && e.name === "AbortError"
        ? "生成超时（60s），请重试或缩短描述"
        : `生成失败: ${e instanceof Error ? e.message : "未知错误"}`;
      toast(msg, "error");
    } finally {
      clearTimeout(timer);
      setGeneratingContinuousAction(false);
    }
  }

  // ── 智能体 → Studio 自定义宫格桥接 ──
  useEffect(() => {
    function handleCustomGridUpdate(e: Event) {
      const detail = (e as CustomEvent).detail as { count?: number; prompts?: string[]; source?: string } | undefined;
      if (!detail) return;
      if (detail.count && detail.count >= 1 && detail.count <= 25) {
        setCustomGridCount(detail.count);
      }
      if (detail.prompts && Array.isArray(detail.prompts)) {
        setCustomPrompts(detail.prompts);
      }
      // 自动切换到自定义宫格模式
      setActiveMode("custom");
      toast(`已接收 ${detail.prompts?.length || 0} 个分镜提示词`, "success");
    }
    window.addEventListener("feicai-custom-grid-update", handleCustomGridUpdate);
    // 启动时检查是否有未消费的推送
    try {
      const pending = localStorage.getItem("feicai-custom-grid-push");
      if (pending) {
        const data = JSON.parse(pending);
        if (data && data.timestamp && Date.now() - data.timestamp < 60000) {
          handleCustomGridUpdate(new CustomEvent("feicai-custom-grid-update", { detail: data }));
        }
        localStorage.removeItem("feicai-custom-grid-push");
      }
    } catch { /* ignore */ }
    return () => window.removeEventListener("feicai-custom-grid-update", handleCustomGridUpdate);
  }, [toast]);

  // ── Render ──

  const isWide = consistency.style.aspectRatio === "16:9";
  const nineImageCount = Array.from({ length: 9 }, (_, i) => `nine-${episode}-${i}`).filter((k) => gridImages[k]).length;
  const smartNineImageCount = Array.from({ length: 9 }, (_, i) => `smartNine-${episode}-${i}`).filter((k) => gridImages[k]).length;
  const compositeNine = gridImages[`nine-composite-${episode}`];
  const compositeSmartNine = gridImages[`smartNine-composite-${episode}`];
  const compositeFour = gridImages[`four-composite-${episode}-${fourBeat}`];
  const compositeCustom = gridImages[`custom-composite-${episode}`];
  const isCurrentGenerating = generatingSet.has(
    activeMode === "nine" ? `nine-${episode}` : activeMode === "smartNine" ? `smartNine-${episode}` : activeMode === "custom" ? `custom-${episode}` : `four-${episode}-${fourBeat}`
  );
  // Any generation in progress → lock episode switching to prevent state confusion
  const isAnyGenerating = generatingSet.size > 0 || upscalingSet.size > 0 || regeneratingSet.size > 0;
  // Per-mode generating check（仅锁当前模式按钮，允许切换到其他模式）
  const isNineGenerating = [...generatingSet].some(k => k.startsWith("nine-")) || [...upscalingSet].some(k => k.startsWith("nine-")) || [...regeneratingSet].some(k => k.startsWith("nine-"));
  const isFourGenerating = [...generatingSet].some(k => k.startsWith("four-")) || [...upscalingSet].some(k => k.startsWith("four-")) || [...regeneratingSet].some(k => k.startsWith("four-"));
  const isSmartNineGenerating = [...generatingSet].some(k => k.startsWith("smartNine-")) || [...upscalingSet].some(k => k.startsWith("smartNine-")) || [...regeneratingSet].some(k => k.startsWith("smartNine-"));
  const isCustomGenerating = [...generatingSet].some(k => k.startsWith("custom-")) || [...upscalingSet].some(k => k.startsWith("custom-")) || [...regeneratingSet].some(k => k.startsWith("custom-"));
  // Four-grid requires the corresponding nine-grid cell to exist (check both nine + smartNine)
  const fourGridLocked = activeMode === "four" && !gridImages[`nine-${episode}-${fourBeat}`] && !gridImages[`smartNine-${episode}-${fourBeat}`];

  // Memoize ref binding resolutions to avoid re-computation on every render
  const nineBoundRefsMemo = useMemo(() => resolveRefBindIds(consistency, nineGridRefIds || []), [consistency, nineGridRefIds]);
  const smartNineBoundRefsMemo = useMemo(() => resolveRefBindIds(consistency, smartNineGridRefIds || []), [consistency, smartNineGridRefIds]);
  const customBoundRefsMemo = useMemo(() => resolveRefBindIds(consistency, customGridRefIdsByEp[episode] || []), [consistency, customGridRefIdsByEp, episode]);
  const cellRefsMemo = useMemo(() => {
    // Only resolve cell refs for current episode to avoid unnecessary work
    const prefix = activeMode === "nine" ? `nine-${episode}-` : activeMode === "smartNine" ? `smartNine-${episode}-` : activeMode === "custom" ? `custom-${episode}-` : `four-${episode}-`;
    return Object.fromEntries(
      Object.entries(cellRefIds)
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, ids]) => [k, resolveRefBindIds(consistency, ids)])
    );
  }, [consistency, cellRefIds, episode, activeMode]);
  const fourBoundRefsMemo = useMemo(() => {
    const nRef = gridImages[`nine-${episode}-${fourBeat}`];
    const manual = resolveRefBindIds(consistency, fourGridRefIds[fourBeat] || []);
    if (!nRef) return manual;
    const seen = new Set<string>([nRef]);
    return [nRef, ...manual.filter(u => { if (seen.has(u)) return false; seen.add(u); return true; })];
  }, [gridImages, episode, fourBeat, consistency, fourGridRefIds]);

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <div className="flex flex-col flex-1 h-full">
        {/* ── Top Bar ── */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--border-default)] shrink-0">
          <div className="flex items-center gap-3">
            <Sparkles size={20} className="text-[var(--gold-primary)]" />
            <span className="font-serif text-[22px] font-bold text-[var(--text-primary)]">生图工作台</span>
            <div className="w-px h-5 bg-[var(--border-default)]" />
            <select value={episode} onChange={(e) => setEpisode(e.target.value)}
              className="bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] px-2 py-1 outline-none">
              {episodes.map((ep) => (<option key={ep} value={ep}>{ep.toUpperCase()}</option>))}
              {episodes.length === 0 && <option value="">无数据</option>}
            </select>
            <span className="text-[13px] text-[var(--text-muted)]">
              {activeMode === "nine" ? "九宫格" : activeMode === "smartNine" ? "智能分镜" : activeMode === "custom" ? `自定义宫格(${customGridCount}格)` : "四宫格"} · {consistency.style.aspectRatio} · {consistency.style.resolution || "1K"}
              {imageGenMode === "geminiTab" ? " · 🤖Gemini Tab" : ""}
              {consistency.style.stylePrompt ? " · 🎨风格已锁定" : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setActiveMode("nine")}
              className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium border transition cursor-pointer ${
                activeMode === "nine" ? "bg-[var(--gold-transparent)] border-[var(--gold-primary)] text-[var(--gold-primary)]"
                  : "border-[var(--border-default)] text-[var(--text-secondary)]"}`}
              title="切换到九宫格模式">
              <Grid3X3 size={14} /> 节拍拆解九宫格
              {isNineGenerating && <Loader size={12} className="animate-spin ml-0.5 text-amber-400" />}
            </button>
            <button onClick={() => setActiveMode("four")}
              className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium border transition cursor-pointer ${
                activeMode === "four" ? "bg-[var(--gold-transparent)] border-[var(--gold-primary)] text-[var(--gold-primary)]"
                  : "border-[var(--border-default)] text-[var(--text-secondary)]"}`}
              title="切换到四宫格模式">
              <Grid2X2 size={14} /> 四宫格
              {isFourGenerating && <Loader size={12} className="animate-spin ml-0.5 text-amber-400" />}
            </button>
            <button onClick={() => setActiveMode("smartNine")}
              className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium border transition cursor-pointer ${
                activeMode === "smartNine" ? "bg-[var(--gold-transparent)] border-[var(--gold-primary)] text-[var(--gold-primary)]"
                  : "border-[var(--border-default)] text-[var(--text-secondary)]"}`}
              title="切换到智能分镜模式">
              <Sparkles size={14} /> 智能分镜九宫格
              {isSmartNineGenerating && <Loader size={12} className="animate-spin ml-0.5 text-amber-400" />}
            </button>
            <button onClick={() => setActiveMode("custom")}
              className={`flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium border transition cursor-pointer ${
                activeMode === "custom" ? "bg-[var(--gold-transparent)] border-[var(--gold-primary)] text-[var(--gold-primary)]"
                  : "border-[var(--border-default)] text-[var(--text-secondary)]"}`}
              title="切换到自定义分镜模式">
              <LayoutGrid size={14} /> 自定义分镜
              {isCustomGenerating && <Loader size={12} className="animate-spin ml-0.5 text-amber-400" />}
            </button>
            <button onClick={() => setShowMotionPromptModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer">
              <Wand2 size={14} /> 生成动态提示词
            </button>
            <div className="w-px h-5 bg-[var(--border-default)]" />
            {/* ── Image Gen Mode Toggle: API ↔ Gemini Tab ↔ 即梦 ── */}
            <div className="flex items-center bg-[var(--bg-base)] border border-[var(--border-default)] p-0.5">
              <button onClick={() => switchImageGenMode("api")}
                className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium transition cursor-pointer ${
                  imageGenMode === "api" ? "bg-[var(--gold-primary)] text-[#0A0A0A]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}>
                API
              </button>
              <button onClick={() => switchImageGenMode("geminiTab")}
                className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium transition cursor-pointer ${
                  imageGenMode === "geminiTab" ? "bg-[var(--gold-primary)] text-[#0A0A0A]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}>
                <Bot size={12} /> Gemini Tab
              </button>
              <button onClick={() => switchImageGenMode("jimeng")}
                className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium transition cursor-pointer ${
                  imageGenMode === "jimeng" ? "bg-[var(--gold-primary)] text-[#0A0A0A]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}>
                即梦
              </button>
            </div>
            {/* ── Gemini Tab 须知按钮：手动查看注意事项 ── */}
            {imageGenMode === "geminiTab" && (
              <button onClick={() => setShowGeminiTabWarning(true)}
                className="flex items-center gap-1 px-1.5 py-1.5 text-[11px] text-amber-400 hover:text-amber-300 transition cursor-pointer"
                title="查看 Gemini Tab 使用须知">
                <AlertTriangle size={13} />
              </button>
            )}
            {/* ── 停止 Gemini Tab 按钮：仅在 Gemini Tab 模式且有生成任务时显示 ── */}
            {imageGenMode === "geminiTab" && isCurrentGenerating && (
              <button onClick={stopGeminiTab}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium bg-red-600 hover:bg-red-700 text-white transition cursor-pointer"
                title="停止所有 Gemini Tab 生图任务">
                <Square size={10} fill="currentColor" /> 停止
              </button>
            )}
            {/* ── 即梦 API 专属工具栏：模型 / 分辨率 / 数量 / 负面提示词 ── */}
            {imageGenMode === "jimeng" && (<>
              <div className="w-px h-5 bg-[var(--border-default)]" />
              {/* 模型选择 */}
              <select value={jimengModel} onChange={(e) => setJimengModel(e.target.value as JimengImageModelId)}
                className="px-2 py-1.5 text-[11px] bg-[var(--bg-base)] border border-[var(--border-default)] text-[var(--text-secondary)] cursor-pointer focus:border-[var(--gold-primary)] outline-none">
                {JIMENG_IMAGE_MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {/* 分辨率选择 */}
              <div className="flex items-center bg-[var(--bg-base)] border border-[var(--border-default)] p-0.5">
                {(["2K", "4K"] as const).map((r) => (
                  <button key={r} onClick={() => setJimengResolution(r)}
                    className={`px-2 py-1 text-[11px] font-medium transition cursor-pointer ${
                      jimengResolution === r ? "bg-[var(--gold-primary)] text-[#0A0A0A]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}>
                    {r}
                  </button>
                ))}
              </div>
              {/* 生成数量 */}
              <select value={jimengCount} onChange={(e) => setJimengCount(Number(e.target.value))}
                className="px-2 py-1.5 text-[11px] bg-[var(--bg-base)] border border-[var(--border-default)] text-[var(--text-secondary)] cursor-pointer focus:border-[var(--gold-primary)] outline-none">
                {[4].map((n) => (
                  <option key={n} value={n}>{n} 张</option>
                ))}
              </select>
              {/* 负面提示词开关 */}
              <button onClick={() => setShowJimengNegPrompt(!showJimengNegPrompt)}
                className={`px-2 py-1.5 text-[11px] border transition cursor-pointer ${
                  showJimengNegPrompt ? "border-[var(--gold-primary)] text-[var(--gold-primary)]" : "border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
                title="负面提示词">
                <EyeOff size={12} />
              </button>
            </>)}
            <div className="w-px h-5 bg-[var(--border-default)]" />
            <button onClick={activeMode === "nine" ? generateNineGrid : activeMode === "smartNine" ? generateSmartNineGrid : () => generateFourGrid(fourBeat)}
              disabled={isCurrentGenerating || fourGridLocked || !isConsistencyImagesLoaded}
              className="flex items-center gap-1.5 px-4 py-2 bg-[var(--gold-primary)] text-[12px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-40">
              {!isConsistencyImagesLoaded ? <Loader size={14} className="animate-spin" /> : isCurrentGenerating ? <Loader size={14} className="animate-spin" /> : fourGridLocked ? <Lock size={14} /> : <Play size={14} />}
              {!isConsistencyImagesLoaded ? "参考图加载中..." : isCurrentGenerating ? "生成中..." : fourGridLocked ? "请先生成九宫格" : activeMode === "nine" ? "生成九宫格" : activeMode === "smartNine" ? "生成智能分镜" : "生成四宫格"}
            </button>
            <button onClick={() => handleUploadComposite(activeMode === "nine" ? "nine" : activeMode === "smartNine" ? "smartNine" : "four", activeMode === "four" ? fourBeat : undefined)}
              disabled={isCurrentGenerating}
              className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-40"
              title="上传API后台生成的合成图，自动裁剪分格 (解决504超时问题)">
              <Upload size={14} /> 上传合成图
            </button>
          </div>
          {/* ── 即梦负面提示词输入行（工具栏下方展开） ── */}
          {imageGenMode === "jimeng" && showJimengNegPrompt && (
            <div className="flex items-center gap-2 px-4 py-1.5 bg-[var(--bg-base)] border-t border-[var(--border-default)]">
              <EyeOff size={11} className="text-[var(--text-muted)] shrink-0" />
              <span className="text-[10px] text-[var(--text-muted)] shrink-0">反向:</span>
              <input type="text" value={jimengNegPrompt} onChange={(e) => setJimengNegPrompt(e.target.value)}
                placeholder="输入不想出现的内容，如：模糊、变形、低质量..."
                className="flex-1 px-2 py-1 text-[11px] bg-transparent border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--gold-primary)] outline-none" />
              {jimengNegPrompt && (
                <button onClick={() => setJimengNegPrompt("")} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer">
                  <X size={11} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Body ── */}
        <div className="flex flex-1 min-h-0">
          {/* ── Left Panel: Consistency Control (SHARED between nine & four) ── */}
          <div className="flex flex-col w-[290px] h-full border-r border-[var(--border-default)] shrink-0">
            {/* ── Step 1: Style Reference (read-only, managed in Pipeline) ── */}
            <div className="px-4 py-3 border-b border-[var(--border-default)]">
              <div className="flex items-center gap-1.5 mb-2">
                <Palette size={12} className="text-[var(--gold-primary)]" />
                <span className="text-[11px] font-medium text-[var(--text-secondary)]">① 风格参考</span>
                {consistency.style.stylePrompt && (
                  <span className="text-[9px] px-1 py-0.5 bg-green-500/20 text-green-400 rounded ml-auto">已识别</span>
                )}
              </div>
              {consistency.style.styleImage ? (
                <div className="flex gap-2 items-start mb-2">
                  <img src={consistency.style.styleImage} alt="style" className="w-16 h-16 object-cover rounded border border-[var(--border-default)] shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <div className="flex-1 min-w-0">
                    {consistency.style.stylePrompt ? (
                      <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed line-clamp-3">{consistency.style.stylePrompt}</p>
                    ) : (
                      <p className="text-[10px] text-[var(--text-muted)]">已上传，请在流水线页完成风格识别</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-[var(--text-muted)] mb-2">尚未设定风格参考图</p>
              )}
              <span
                onClick={() => router.push("/pipeline")}
                className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] text-[var(--text-muted)] border border-[var(--border-default)] cursor-pointer hover:text-[var(--gold-primary)] hover:border-[var(--gold-primary)] transition">
                <Lock size={10} />
                前往「分镜流水线」修改
              </span>
            </div>

            {/* ── Step 2: AI Extract ── */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-default)]">
              <button onClick={handleAiExtract} disabled={extracting || pipelineRunning}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-[var(--gold-primary)] text-[12px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-50">
                {extracting ? <Loader size={12} className="animate-spin" /> : pipelineRunning ? <Lock size={12} /> : <Wand2 size={12} />}
                {extracting ? "AI 提取中..." : pipelineRunning ? "流水线执行中…" : "② AI 一键提取"}
              </button>
              <button
                onClick={async () => {
                  const ok = await exportConsistencyToFile(consistency);
                  toast(ok ? "已导出到 outputs/前置设定-提取数据.md" : "导出失败", ok ? "success" : "error");
                }}
                disabled={consistency.characters.length === 0 && consistency.scenes.length === 0 && consistency.props.length === 0}
                title="导出角色/场景/道具数据到 outputs 文件"
                className="flex items-center justify-center p-2 text-[var(--text-muted)] hover:text-[var(--gold-primary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Download size={14} />
              </button>
            </div>

            <div className="flex border-b border-[var(--border-default)]">
              {([["prompts","提示词"],["style","画幅"],["chars","角色"],["scenes","场景"],["props","道具"]] as [LeftTab,string][]).map(([key,label]) => (
                <button key={key} onClick={() => setLeftTab(key)}
                  className={`flex-1 py-2.5 text-[11px] font-medium transition cursor-pointer ${
                    leftTab === key ? "text-[var(--gold-primary)] border-b-2 border-[var(--gold-primary)]" : "text-[var(--text-muted)]"}`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-auto">
              {leftTab === "prompts" && <PromptsTab mode={activeMode} ninePrompts={ninePrompts}
                fourGroups={fourGroups} fourBeat={fourBeat} selectedCell={selectedCell}
                onSelectCell={setSelectedCell} onSelectFourBeat={setFourBeat}
                smartNinePrompts={smartNinePrompts} customPrompts={customPrompts}
                customGridCount={customGridCount} />}
              {leftTab === "chars" && <ItemListTab items={consistency.characters} listKey="characters"
                onAdd={() => addItem("characters")} onUpdate={(id, f, v) => updateItem("characters", id, f, v)}
                onDelete={(id) => deleteItem("characters", id)} onUpload={(id) => handleUploadRef("characters", id)}
                onGenRef={(id, desc) => generateRefImage("characters", id, desc)}
                onImageEdit={(id, name, imgUrl, desc) => openRefImageEdit("characters", id, name, imgUrl, desc)}
                onTranslateRef={(id) => handleTranslateRefPrompt("characters", id)} translatingRefIds={translatingRefIds}
                icon={<User size={14} className="text-[var(--gold-primary)]" />} typeName="角色"
                onPreview={setPreviewImage} onDownload={downloadImage} uploadingRefId={uploadingRefId} generatingRefIds={generatingRefSet} />}
              {leftTab === "scenes" && <ItemListTab items={consistency.scenes} listKey="scenes"
                onAdd={() => addItem("scenes")} onUpdate={(id, f, v) => updateItem("scenes", id, f, v)}
                onDelete={(id) => deleteItem("scenes", id)} onUpload={(id) => handleUploadRef("scenes", id)}
                onGenRef={(id, desc) => generateRefImage("scenes", id, desc)}
                onImageEdit={(id, name, imgUrl, desc) => openRefImageEdit("scenes", id, name, imgUrl, desc)}
                onTranslateRef={(id) => handleTranslateRefPrompt("scenes", id)} translatingRefIds={translatingRefIds}
                icon={<Mountain size={14} className="text-[var(--gold-primary)]" />} typeName="场景"
                onPreview={setPreviewImage} onDownload={downloadImage} uploadingRefId={uploadingRefId} generatingRefIds={generatingRefSet} />}
              {leftTab === "props" && <ItemListTab items={consistency.props} listKey="props"
                onAdd={() => addItem("props")} onUpdate={(id, f, v) => updateItem("props", id, f, v)}
                onDelete={(id) => deleteItem("props", id)} onUpload={(id) => handleUploadRef("props", id)}
                onGenRef={(id, desc) => generateRefImage("props", id, desc)}
                onImageEdit={(id, name, imgUrl, desc) => openRefImageEdit("props", id, name, imgUrl, desc)}
                onTranslateRef={(id) => handleTranslateRefPrompt("props", id)} translatingRefIds={translatingRefIds}
                icon={<Sword size={14} className="text-[var(--gold-primary)]" />} typeName="道具"
                onPreview={setPreviewImage} onDownload={downloadImage} uploadingRefId={uploadingRefId} generatingRefIds={generatingRefSet} />}
              {/* ── 从角色库导入按钮 ── */}
              {["chars", "scenes", "props"].includes(leftTab) && (
                <button onClick={() => setShowCharacterLibrary(true)}
                  className="flex items-center justify-center gap-1.5 w-full py-2 border border-[var(--gold-primary)] text-[11px] text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer rounded">
                  📦 从角色库导入
                </button>
              )}
              {["chars", "scenes", "props"].includes(leftTab) && (
                <button
                  onClick={() => handleBatchTranslateRef(leftTab === "chars" ? "characters" : leftTab === "scenes" ? "scenes" : "props")}
                  disabled={batchTranslating || translatingRefIds.size > 0}
                  className="flex items-center justify-center gap-1.5 w-full py-2 border border-amber-500/30 text-[11px] text-amber-300 bg-amber-500/5 hover:bg-amber-500/10 transition cursor-pointer rounded disabled:opacity-40 disabled:cursor-not-allowed">
                  {batchTranslating ? <><Loader size={12} className="animate-spin" /> 批量翻译中...</> : <><Languages size={12} /> 一键批量中文转英文</>}
                </button>
              )}
              {["chars", "scenes", "props"].includes(leftTab) && fusionItems.length >= 2 && (
                <button onClick={() => setShowFusionModal(true)}
                  className="flex items-center justify-center gap-1.5 w-full py-2 border border-[var(--gold-dim)] text-[11px] text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer rounded">
                  🔗 溶图合成
                </button>
              )}
              {leftTab === "style" && <StyleTab style={consistency.style}
                router={router}
                onChange={(field, value) => {
                  setConsistency((prev) => {
                    const next = { ...prev, style: { ...prev.style, [field]: value } };
                    return next;
                  });
                  // Sync resolution/aspectRatio to settings page so both systems stay consistent
                  if (field === "resolution") {
                    try {
                      const s = JSON.parse(localStorage.getItem("feicai-settings") || "{}");
                      s["img-size"] = value;
                      localStorage.setItem("feicai-settings", JSON.stringify(s));
                    } catch { /* ignore */ }
                  }
                  if (field === "aspectRatio") {
                    try {
                      const s = JSON.parse(localStorage.getItem("feicai-settings") || "{}");
                      s["img-aspect-ratio"] = value;
                      localStorage.setItem("feicai-settings", JSON.stringify(s));
                    } catch { /* ignore */ }
                  }
                }} />}
            </div>

            <div className="px-4 py-2.5 border-t border-[var(--border-default)] text-[11px] text-[var(--text-muted)]">
              {consistency.characters.length} 角色 · {consistency.scenes.length} 场景 · {consistency.props.length} 道具
              {nineImageCount > 0 && ` · ${nineImageCount}/9 图`}
            </div>
          </div>

          {/* ── Grid Area ── */}
          <div className="flex flex-col flex-1 p-5 overflow-auto">
            {activeMode === "nine" ? (
              <NineGridArea episode={episode} ninePrompts={ninePrompts}
                gridImages={gridImages} compositeUrl={compositeNine}
                imageDims={imageDims} onImgLoad={handleImgLoad}
                generating={generatingSet.has(`nine-${episode}`)} regenerating={regeneratingSet}
                selectedCell={selectedCell} onSelectCell={setSelectedCell}
                onCopy={handleCopyPrompt} showDetail={showPromptDetail}
                onToggleDetail={() => setShowPromptDetail((v) => !v)}
                upscaling={upscalingSet} onUpscale={upscaleCell}
                onRegenerate={(idx) => {
                  const key = `nine-${episode}-${idx}`;
                  const prompt = ninePrompts[idx] || "";
                  const refs = resolveRefsForCell(key, prompt, "nine");
                  regenerateCell(key, prompt, refs);
                }}
                onPreview={setPreviewImage}
                onDownload={downloadImage}
                isWide={isWide}
                onGoFour={(idx) => { setFourBeat(idx); setActiveMode("four"); }}
                onBatchUpscale={batchUpscaleNine}
                onEditPrompt={(idx, value) => { setPromptsEdited(true); setNinePrompts((prev) => { const next = [...prev]; next[idx] = value; return next; }); }}
                boundRefs={nineBoundRefsMemo}
                cellRefs={cellRefsMemo}
                onOpenRefBind={openRefBind}
                onClearAllRefs={clearAllNineRefs}
                episodeKey={episode}
                promptsEdited={promptsEdited}
                refsLoading={!isConsistencyImagesLoaded}
                onStitch={async () => {
                  const cells = Array.from({ length: 9 }, (_, i) => gridImages[`nine-${episode}-${i}`]).filter(Boolean);
                  if (cells.length === 0) { toast("无可合成的格图", "error"); return; }
                  try {
                    toast("正在合成九宫格...", "info");
                    const composite = await stitchGridImages(cells, 3, 3);
                    downloadImage(composite, `nine-grid-${episode}.png`);
                    toast("九宫格合成图已下载 ✓", "success");
                  } catch (e) { toast(`合成失败: ${e instanceof Error ? e.message : "未知"}`, "error"); }
                }}
                onImageEdit={(idx) => {
                  const key = `nine-${episode}-${idx}`;
                  openImageEdit(key, "nine", ninePrompts[idx] || "");
                }}
                editingCellKey={editingCell?.cellKey || null}
                onUploadImage={(idx) => handleUploadCellImage(`nine-${episode}-${idx}`)}
                onViewPrompt={() => viewFullPrompt("nine")}
                includeStyleRef={includeStyleRefInModel}
                onToggleStyleRef={() => setIncludeStyleRefInModel((v) => !v)}
                onTranslate={handleTranslatePrompt}
                translating={translatingPrompt}
                onUndo={(idx) => undoCellImage(`nine-${episode}-${idx}`)}
                imageHistory={gridImageHistory}
                onDeleteCell={(idx) => {
                  const key = `nine-${episode}-${idx}`;
                  setGridImages(prev => { const next = {...prev}; delete next[key]; return next; });
                  deleteGridImageFromDisk(key);
                }}
                onClearAllImages={() => {
                  if (!confirm("确定清空当前EP所有九宫格图片？")) return;
                  const keysToDelete: string[] = [];
                  for (let i = 0; i < 9; i++) keysToDelete.push(`nine-${episode}-${i}`);
                  keysToDelete.push(`nine-composite-${episode}`);
                  setGridImages(prev => {
                    const next = {...prev};
                    for (const k of keysToDelete) delete next[k];
                    return next;
                  });
                  // ★ 同步删除磁盘文件，防止切换EP后从磁盘重新加载
                  for (const k of keysToDelete) deleteGridImageFromDisk(k);
                }} />
            ) : activeMode === "smartNine" ? (
              <NineGridArea episode={episode} ninePrompts={smartNinePrompts}
                gridImages={gridImages} compositeUrl={compositeSmartNine}
                imageDims={imageDims} onImgLoad={handleImgLoad}
                generating={generatingSet.has(`smartNine-${episode}`)} regenerating={regeneratingSet}
                selectedCell={selectedCell} onSelectCell={setSelectedCell}
                onCopy={handleCopyPrompt} showDetail={showSmartNinePromptDetail}
                onToggleDetail={() => setShowSmartNinePromptDetail((v) => !v)}
                upscaling={upscalingSet} onUpscale={upscaleCell}
                onRegenerate={(idx) => {
                  const key = `smartNine-${episode}-${idx}`;
                  const prompt = smartNinePrompts[idx] || "";
                  const refs = resolveRefsForCell(key, prompt, "smartNine");
                  regenerateCell(key, prompt, refs);
                }}
                onPreview={setPreviewImage}
                onDownload={downloadImage}
                isWide={isWide}
                onBatchUpscale={batchUpscaleNine}
                onEditPrompt={(idx, value) => { setPromptsEdited(true); setSmartNinePrompts((prev) => { const next = [...prev]; next[idx] = value; return next; }); }}
                boundRefs={smartNineBoundRefsMemo}
                cellRefs={cellRefsMemo}
                onOpenRefBind={openRefBind}
                onClearAllRefs={clearAllSmartNineRefs}
                episodeKey={episode}
                promptsEdited={promptsEdited}
                refsLoading={!isConsistencyImagesLoaded}
                onStitch={async () => {
                  const cells = Array.from({ length: 9 }, (_, i) => gridImages[`smartNine-${episode}-${i}`]).filter(Boolean);
                  if (cells.length === 0) { toast("无可合成的格图", "error"); return; }
                  try {
                    toast("正在合成智能分镜九宫格...", "info");
                    const composite = await stitchGridImages(cells, 3, 3);
                    downloadImage(composite, `smartNine-grid-${episode}.png`);
                    toast("智能分镜九宫格合成图已下载 ✓", "success");
                  } catch (e) { toast(`合成失败: ${e instanceof Error ? e.message : "未知"}`, "error"); }
                }}
                onImageEdit={(idx) => {
                  const key = `smartNine-${episode}-${idx}`;
                  openImageEdit(key, "nine", smartNinePrompts[idx] || "");
                }}
                editingCellKey={editingCell?.cellKey || null}
                onUploadImage={(idx) => handleUploadCellImage(`smartNine-${episode}-${idx}`)}
                onViewPrompt={() => viewFullPrompt("smartNine")}
                includeStyleRef={includeStyleRefInModel}
                onToggleStyleRef={() => setIncludeStyleRefInModel((v) => !v)}
                onTranslate={handleTranslatePrompt}
                translating={translatingPrompt}
                cellKeyPrefix="smartNine"
                globalRefBindType={{ type: "smartNine-global" }}
                gridLabel="智能分镜"
                onGoFour={(idx) => { setFourBeat(idx); setActiveMode("four"); }}
                onUndo={(idx) => undoCellImage(`smartNine-${episode}-${idx}`)}
                imageHistory={gridImageHistory}
                onDeleteCell={(idx) => {
                  const key = `smartNine-${episode}-${idx}`;
                  setGridImages(prev => { const next = {...prev}; delete next[key]; return next; });
                  deleteGridImageFromDisk(key);
                }}
                onClearAllImages={() => {
                  if (!confirm("确定清空当前EP所有智能分镜图片？")) return;
                  const keysToDelete: string[] = [];
                  for (let i = 0; i < 9; i++) keysToDelete.push(`smartNine-${episode}-${i}`);
                  keysToDelete.push(`smartNine-composite-${episode}`);
                  setGridImages(prev => {
                    const next = {...prev};
                    for (const k of keysToDelete) delete next[k];
                    return next;
                  });
                  // ★ 同步删除磁盘文件，防止切换EP后从磁盘重新加载
                  for (const k of keysToDelete) deleteGridImageFromDisk(k);
                }} />
            ) : activeMode === "custom" ? (
              <NineGridArea episode={episode} ninePrompts={customPrompts}
                gridImages={gridImages} compositeUrl={compositeCustom}
                imageDims={imageDims} onImgLoad={handleImgLoad}
                generating={generatingSet.has(`custom-${episode}`)} regenerating={regeneratingSet}
                selectedCell={selectedCell} onSelectCell={setSelectedCell}
                onCopy={handleCopyPrompt} showDetail={showCustomPromptDetail}
                onToggleDetail={() => setShowCustomPromptDetail((v) => !v)}
                upscaling={upscalingSet} onUpscale={upscaleCell}
                onRegenerate={(idx) => {
                  const key = `custom-${episode}-${idx}`;
                  const prompt = customPrompts[idx] || "";
                  const refs = resolveRefsForCell(key, prompt, "custom");
                  regenerateCell(key, prompt, refs);
                }}
                onPreview={setPreviewImage}
                onDownload={downloadImage}
                isWide={isWide}
                onBatchUpscale={() => {
                  const cells = Array.from({ length: customGridCount }, (_, i) => `custom-${episode}-${i}`).filter(k => gridImages[k]);
                  if (cells.length === 0) { toast("无可超分的格图", "error"); return; }
                  for (const k of cells) { if (!upscalingSet.has(k)) upscaleCell(k); }
                }}
                onEditPrompt={(idx, value) => { setPromptsEdited(true); setCustomPrompts((prev) => { const next = [...prev]; next[idx] = value; return next; }); }}
                boundRefs={customBoundRefsMemo}
                cellRefs={cellRefsMemo}
                onOpenRefBind={openRefBind}
                onClearAllRefs={() => { setCustomGridRefIdsByEp(prev => { const next = {...prev}; delete next[episode]; return next; }); }}
                episodeKey={episode}
                promptsEdited={promptsEdited}
                refsLoading={!isConsistencyImagesLoaded}
                onStitch={async () => {
                  const gridCols = customGridCount <= 4 ? 2 : customGridCount <= 9 ? 3 : customGridCount <= 16 ? 4 : 5;
                  const gridRows = Math.ceil(customGridCount / gridCols);
                  const cells = Array.from({ length: customGridCount }, (_, i) => gridImages[`custom-${episode}-${i}`]).filter(Boolean);
                  if (cells.length === 0) { toast("无可合成的格图", "error"); return; }
                  try {
                    toast("正在合成自定义宫格...", "info");
                    const composite = await stitchGridImages(cells, gridCols, gridRows);
                    downloadImage(composite, `custom-grid-${episode}.png`);
                    toast("自定义宫格合成图已下载 ✓", "success");
                  } catch (e) { toast(`合成失败: ${e instanceof Error ? e.message : "未知"}`, "error"); }
                }}
                onImageEdit={(idx) => {
                  const key = `custom-${episode}-${idx}`;
                  openImageEdit(key, "nine", customPrompts[idx] || "");
                }}
                editingCellKey={editingCell?.cellKey || null}
                onUploadImage={(idx) => handleUploadCellImage(`custom-${episode}-${idx}`)}
                onViewPrompt={() => viewFullPrompt("custom")}
                includeStyleRef={includeStyleRefInModel}
                onToggleStyleRef={() => setIncludeStyleRefInModel((v) => !v)}
                onTranslate={handleTranslatePrompt}
                translating={translatingPrompt}
                cellKeyPrefix="custom"
                globalRefBindType={{ type: "custom-global" } as RefBindTarget}
                gridLabel="自定义宫格"
                gridSize={customGridCount}
                onGoFour={(idx) => { setFourBeat(idx); setActiveMode("four"); }}
                onUndo={(idx) => undoCellImage(`custom-${episode}-${idx}`)}
                imageHistory={gridImageHistory}
                onDeleteCell={(idx) => {
                  const key = `custom-${episode}-${idx}`;
                  setGridImages(prev => { const next = {...prev}; delete next[key]; return next; });
                  deleteGridImageFromDisk(key);
                }}
                onClearAllImages={() => {
                  if (!confirm("确定清空当前EP所有自定义宫格图片？")) return;
                  const keysToDelete: string[] = [];
                  for (let i = 0; i < customGridCount; i++) keysToDelete.push(`custom-${episode}-${i}`);
                  keysToDelete.push(`custom-composite-${episode}`);
                  setGridImages(prev => {
                    const next = {...prev};
                    for (const k of keysToDelete) delete next[k];
                    return next;
                  });
                  for (const k of keysToDelete) deleteGridImageFromDisk(k);
                }} />
            ) : (
              <FourGridArea episode={episode} fourGroups={fourGroups}
                fourBeat={fourBeat} onBeatChange={setFourBeat}
                gridImages={gridImages} compositeUrl={compositeFour}
                imageDims={imageDims} onImgLoad={handleImgLoad}
                nineGridCellUrl={gridImages[`nine-${episode}-${fourBeat}`] || gridImages[`smartNine-${episode}-${fourBeat}`]}
                generating={generatingSet.has(`four-${episode}-${fourBeat}`)} regenerating={regeneratingSet}
                onCopy={handleCopyPrompt}
                showDetail={showFourPromptDetail}
                onToggleDetail={() => setShowFourPromptDetail((v) => !v)}
                upscaling={upscalingSet} onUpscale={upscaleCell}
                onRegenerate={(idx) => {
                  const key = `four-${episode}-${fourBeat}-${idx}`;
                  const prompt = fourGroups[fourBeat]?.[idx] || "";
                  const nineRef = gridImages[`nine-${episode}-${fourBeat}`] || gridImages[`smartNine-${episode}-${fourBeat}`];
                  const manualRefs = resolveRefsForCell(key, prompt, "four", fourBeat);
                  // Deduplicate nineRef from manualRefs
                  const seen = new Set<string>(nineRef ? [nineRef] : []);
                  const deduped = manualRefs.filter(u => { if (seen.has(u)) return false; seen.add(u); return true; });
                  const refs = nineRef ? [nineRef, ...deduped] : deduped;
                  regenerateCell(key, prompt, refs);
                }}
                onPreview={setPreviewImage}
                onDownload={downloadImage}
                isWide={isWide}
                onBatchUpscale={batchUpscaleFour}
                onEditPrompt={(idx, value) => { setPromptsEdited(true); setFourGroups((prev) => {
                  const next = prev.map((g) => [...g]);
                  if (next[fourBeat]) next[fourBeat][idx] = value;
                  return next;
                }); }}
                boundRefs={fourBoundRefsMemo}
                cellRefs={cellRefsMemo}
                onOpenRefBind={openRefBind}
                onClearAllRefs={clearAllFourRefs}
                promptsEdited={promptsEdited}
                refsLoading={!isConsistencyImagesLoaded}
                onStitch={async () => {
                  const cells = Array.from({ length: 4 }, (_, i) => gridImages[`four-${episode}-${fourBeat}-${i}`]).filter(Boolean);
                  if (cells.length === 0) { toast("无可合成的格图", "error"); return; }
                  try {
                    toast("正在合成四宫格...", "info");
                    const composite = await stitchGridImages(cells, 2, 2);
                    downloadImage(composite, `four-grid-${episode}-group${fourBeat + 1}.png`);
                    toast("四宫格合成图已下载 ✓", "success");
                  } catch (e) { toast(`合成失败: ${e instanceof Error ? e.message : "未知"}`, "error"); }
                }}
                onImageEdit={(idx) => {
                  const key = `four-${episode}-${fourBeat}-${idx}`;
                  openImageEdit(key, "four", fourGroups[fourBeat]?.[idx] || "");
                }}
                editingCellKey={editingCell?.cellKey || null}
                onUploadImage={(idx) => handleUploadCellImage(`four-${episode}-${fourBeat}-${idx}`)}
                onViewPrompt={() => viewFullPrompt("four", fourBeat)}
                includeStyleRef={includeStyleRefInModel}
                onToggleStyleRef={() => setIncludeStyleRefInModel((v) => !v)}
                onTranslate={handleTranslatePrompt}
                translating={translatingPrompt}
                onGenerateContinuousAction={handleGenerateContinuousAction}
                generatingContinuousAction={generatingContinuousAction}
                onUndo={(idx) => undoCellImage(`four-${episode}-${fourBeat}-${idx}`)}
                imageHistory={gridImageHistory}
                onDeleteCell={(idx) => {
                  const key = `four-${episode}-${fourBeat}-${idx}`;
                  setGridImages(prev => { const next = {...prev}; delete next[key]; return next; });
                  deleteGridImageFromDisk(key);
                }}
                onClearAllImages={() => {
                  if (!confirm("确定清空当前节拍所有四宫格图片？")) return;
                  const keysToDelete: string[] = [];
                  for (let i = 0; i < 4; i++) keysToDelete.push(`four-${episode}-${fourBeat}-${i}`);
                  keysToDelete.push(`four-composite-${episode}-${fourBeat}`);
                  setGridImages(prev => {
                    const next = {...prev};
                    for (const k of keysToDelete) delete next[k];
                    return next;
                  });
                  // ★ 同步删除磁盘文件，防止切换EP后从磁盘重新加载
                  for (const k of keysToDelete) deleteGridImageFromDisk(k);
                }} />
            )}
          </div>
        </div>
      </div>

      {/* ── RefBindPanel Modal ── */}
      <RefBindPanel
        open={refBindOpen}
        target={refBindTarget}
        consistency={consistency}
        currentBindIds={
          refBindTarget?.type === "nine-global" ? nineGridRefIds :
          refBindTarget?.type === "smartNine-global" ? smartNineGridRefIds :
          refBindTarget?.type === "custom-global" ? (customGridRefIdsByEp[episode] || null) :
          refBindTarget?.type === "four-global" ? (fourGridRefIds[refBindTarget.beatIdx] ?? null) :
          refBindTarget?.type === "cell" ? (() => {
            const ck = refBindTarget.cellKey;
            // If cell has explicit custom binding (even if empty/cleared), use it as-is
            if (ck in cellRefIds) return cellRefIds[ck];
            // Otherwise (not customized) → inherit global as starting point
            if (ck.startsWith("custom-")) return customGridRefIdsByEp[episode] || null;
            if (ck.startsWith("smartNine-")) return smartNineGridRefIds;
            if (ck.startsWith("nine-")) return nineGridRefIds;
            if (ck.startsWith("four-")) {
              const beatIdx = parseInt(ck.split("-")[2] || "0");
              return fourGridRefIds[beatIdx] ?? null;
            }
            return null;
          })() : null
        }
        promptTexts={
          refBindTarget?.type === "nine-global" ? ninePrompts :
          refBindTarget?.type === "smartNine-global" ? smartNinePrompts :
          refBindTarget?.type === "custom-global" ? customPrompts :
          refBindTarget?.type === "four-global" ? (fourGroups[refBindTarget.beatIdx] || []) :
          refBindTarget?.type === "cell" ? [
            // For cell-level, use the single cell's prompt
            (() => {
              const ck = refBindTarget.cellKey;
              if (ck.startsWith("custom-")) {
                const idx = parseInt(ck.split("-").pop() || "0");
                return customPrompts[idx] || "";
              }
              if (ck.startsWith("smartNine-")) {
                const idx = parseInt(ck.split("-").pop() || "0");
                return smartNinePrompts[idx] || "";
              }
              if (ck.startsWith("nine-")) {
                const idx = parseInt(ck.split("-").pop() || "0");
                return ninePrompts[idx] || "";
              }
              if (ck.startsWith("four-")) {
                const parts = ck.split("-");
                const beatIdx = parseInt(parts[2] || "0");
                const cellIdx = parseInt(parts[3] || "0");
                return fourGroups[beatIdx]?.[cellIdx] || "";
              }
              return "";
            })()
          ] : []
        }
        onConfirm={handleRefBindConfirm}
        onClose={closeRefBind}
        episodeMentions={episodeMentions}
        episodeLabel={episode}
      />

      {/* ── 参考图角色库弹窗 ── */}
      {showCharacterLibrary && (
        <CharacterLibrary
          open={showCharacterLibrary}
          onClose={() => setShowCharacterLibrary(false)}
          onImport={handleLibraryImport}
          currentConsistency={consistency}
        />
      )}

      {/* ── 溶图合成弹窗 ── */}
      {showFusionModal && (
        <ImageFusionModal
          open={showFusionModal}
          onClose={() => setShowFusionModal(false)}
          allItems={fusionItems}
          onComposite={handleFusionComposite}
        />
      )}

      {/* ── 图片来源选择器（本地上传 / 即梦图库） ── */}
      <ImageSourcePicker
        isOpen={showImageSourcePicker}
        onClose={() => { setShowImageSourcePicker(false); imageSourceCallbackRef.current = null; }}
        onImageSelected={(dataUrl) => {
          setShowImageSourcePicker(false);
          if (imageSourceCallbackRef.current) {
            imageSourceCallbackRef.current(dataUrl);
            imageSourceCallbackRef.current = null;
          }
        }}
      />

      {/* ── 即梦悬浮控制面板（任务监控 + 历史 + Cookie + 诊断） ── */}
      <JimengFAB
        visible={imageGenMode === "jimeng"}
        modelLabel={jimengModelLabel}
        resolution={jimengResolution}
        count={jimengCount}
        activeCellKey={
          activeMode === "nine" ? `nine-${episode}-${selectedCell}`
          : activeMode === "smartNine" ? `smartNine-${episode}-${selectedCell}`
          : activeMode === "custom" ? `custom-${episode}-${selectedCell}`
          : activeMode === "four" ? `four-${episode}-${fourBeat}-${selectedCell}`
          : undefined
        }
        onPreviewImage={(url, title) => setPreviewImage({ src: url, title })}
        onPickFromTask={(task) => setJimengHistoryPicker({ task })}
      />

      {/* ── 即梦历史选图弹窗 ── */}
      {jimengHistoryPicker && (
        <JimengPickerModal
          open={true}
          images={jimengHistoryPicker.task.images}
          label={jimengHistoryPicker.task.label}
          showRegenerate={false}
          initialSelected={jimengHistoryPicker.task.selectedIndex}
          isLocked={jimengHistoryPicker.task.locked}
          confirmText={(jimengHistoryPicker.task.targetListKey || jimengHistoryPicker.task.targetGridKey) ? "确认并应用（锁定）" : "确认应用到当前格（锁定）"}
          onConfirm={handleJimengHistoryPick}
          onClose={() => setJimengHistoryPicker(null)}
        />
      )}

      {/* ── Image Preview Modal ── */}
      {previewImage && (
        <ImageModal src={previewImage.src} title={previewImage.title}
          onClose={closePreview} />
      )}

      {/* ── Image Edit Modal ── */}
      {editingCell && (
        <ImageEditModal
          request={editingCell}
          onClose={() => setEditingCell(null)}
          onSubmit={handleRefOrGridImageEditSubmit}
          consistencyRefs={editConsistencyRefs}
          gridCellImages={editGridCellImages}
        />
      )}

      {/* ── Gemini Tab 注意事项弹窗 ── */}
      {showGeminiTabWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowGeminiTabWarning(false)}>
          <div className="bg-[#1A1A1A] border border-[var(--gold-primary)] rounded-lg w-[520px] max-w-[90vw] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-default)]">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-400" />
                <span className="text-[14px] font-medium text-[var(--gold-primary)]">Gemini Tab 使用须知</span>
              </div>
              <button onClick={() => setShowGeminiTabWarning(false)} className="text-[var(--text-muted)] hover:text-white transition cursor-pointer"><X size={16} /></button>
            </div>
            {/* Body */}
            <div className="px-5 py-4 space-y-3.5">
              <div className="flex gap-3 items-start">
                <span className="shrink-0 w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[11px] font-bold mt-0.5">1</span>
                <div>
                  <p className="text-[13px] text-[var(--text-primary)] font-medium">关闭浏览器翻译功能</p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">弹出的 Chromium 浏览器必须设置为「<span className="text-amber-300">一律不翻译英文</span>」，否则页面元素被翻译后<span className="text-red-400">无法上传参考图</span>。</p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <span className="shrink-0 w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[11px] font-bold mt-0.5">2</span>
                <div>
                  <p className="text-[13px] text-[var(--text-primary)] font-medium">按部署文档完成设置</p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">首次使用前请确保已按照<span className="text-[var(--gold-primary)]">使用文档</span>完成 Gemini Tab 的配置流程（登录 Google 账号、设置 Gem 地址等）。</p>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <span className="shrink-0 w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[11px] font-bold mt-0.5">3</span>
                <div>
                  <p className="text-[13px] text-[var(--text-primary)] font-medium">仅支持桌面级梯子/魔法</p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">内置 Chromium 不支持浏览器扩展（如 Ghelper 等扩展魔法），只支持 <span className="text-green-400">Clash / V2Ray 等桌面客户端</span>。如使用扩展梯子，请在设置页填写本地代理端口。</p>
                </div>
              </div>
            </div>
            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border-default)]">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" className="accent-[var(--gold-primary)] w-3.5 h-3.5 cursor-pointer" onChange={(e) => {
                  try { if (e.target.checked) localStorage.setItem("feicai-gemini-tab-warning-dismissed", "1"); else localStorage.removeItem("feicai-gemini-tab-warning-dismissed"); } catch { /* ignore */ }
                }} />
                <span className="text-[11px] text-[var(--text-muted)]">不再提示</span>
              </label>
              <button onClick={() => setShowGeminiTabWarning(false)}
                className="px-5 py-1.5 bg-[var(--gold-primary)] text-[#0A0A0A] text-[12px] font-medium rounded hover:brightness-110 transition cursor-pointer">我知道了</button>
            </div>
          </div>
        </div>
      )}

      {/* ── AI 一键提取 全页面锁定遮罩（实时进度） ── */}
      {extracting && (() => {
        // 解析进度文本，提取阶段和完成比例
        const prog = extractProgress;
        const isPhase1 = prog.includes("Phase 1/2") || !prog || prog.includes("连接");
        const isPhase2 = prog.includes("Phase 2/2");
        const isDone = prog.includes("提取完成");
        // 计算进度百分比
        let percent = 5;
        if (isPhase1 && prog.includes("识别完成")) percent = 30;
        else if (isPhase1 && prog.includes("正在识别")) percent = 15;
        if (isPhase2) {
          const m = prog.match(/已完成 (\d+)\/(\d+)/);
          if (m) {
            percent = 35 + Math.round((Number(m[1]) / Number(m[2])) * 60);
          } else {
            percent = 35;
          }
        }
        if (isDone) percent = 100;
        // 当前阶段步骤
        const phase1Done = isPhase2 || isDone;
        const phase2Done = isDone;
        return (
          <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center" style={{ pointerEvents: "auto" }}>
            <div className="bg-[#161616] border border-[var(--gold-primary)] rounded-lg w-[440px] max-w-[90vw] shadow-2xl animate-in fade-in">
              <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border-default)]">
                <Loader size={18} className="text-[var(--gold-primary)] animate-spin" />
                <span className="text-[15px] font-semibold text-[var(--gold-primary)]">AI 一键提取执行中</span>
                <span className="ml-auto text-[12px] text-[var(--text-muted)]">{percent}%</span>
              </div>
              <div className="px-5 py-4 space-y-3">
                {/* 进度条 */}
                <div className="w-full h-2 bg-[#222] rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-[var(--gold-primary)] to-amber-400 rounded-full transition-all duration-700 ease-out" style={{ width: `${percent}%` }} />
                </div>
                {/* 阶段步骤 */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5">
                    <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${phase1Done ? "bg-green-500/20 text-green-400" : "bg-[var(--gold-primary)]/20 text-[var(--gold-primary)]"}`}>{phase1Done ? "✓" : "1"}</span>
                    <span className={`text-[12px] ${phase1Done ? "text-green-400" : isPhase1 ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>Phase 1 · 识别角色 / 场景 / 道具</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${phase2Done ? "bg-green-500/20 text-green-400" : isPhase2 ? "bg-[var(--gold-primary)]/20 text-[var(--gold-primary)]" : "bg-[#222] text-[var(--text-muted)]"}`}>{phase2Done ? "✓" : "2"}</span>
                    <span className={`text-[12px] ${phase2Done ? "text-green-400" : isPhase2 ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}`}>Phase 2 · 并发生成英文提示词</span>
                  </div>
                </div>
                {/* 实时进度消息 */}
                {prog && (
                  <p className="text-[11px] text-[var(--gold-primary)] leading-relaxed bg-[var(--gold-primary)]/5 rounded px-3 py-1.5 border border-[var(--gold-primary)]/10">{prog}</p>
                )}
                <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">🔒 提取完成前页面已锁定，请勿切换页面或关闭浏览器。</p>
              </div>
              <div className="px-5 py-3 border-t border-[var(--border-default)] flex justify-between items-center">
                <span className="text-[10px] text-[var(--text-muted)]">⏳ 通常 10-60 秒</span>
                <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--gold-primary)] animate-pulse" />
                  {prog ? prog.slice(0, 30) + (prog.length > 30 ? "…" : "") : "等待 AI 响应中…"}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Motion Prompt Modal (动态提示词弹窗) ── */}
      {showMotionPromptModal && (
        <MotionPromptModal
          mode={activeMode}
          episode={episode}
          fourBeat={fourBeat}
          gridImages={gridImages}
          ninePrompts={ninePrompts}
          smartNinePrompts={smartNinePrompts}
          fourGroups={fourGroups}
          consistency={consistency}
          customPrompts={customPrompts}
          customGridCount={customGridCount}
          onClose={() => setShowMotionPromptModal(false)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Motion Prompt Modal (动态提示词弹窗)
// ═══════════════════════════════════════════════════════════

function MotionPromptModal({ mode, episode, fourBeat, gridImages, ninePrompts, smartNinePrompts, fourGroups, consistency, customPrompts, customGridCount, onClose }: {
  mode: GridMode;
  episode: string;
  fourBeat: number;
  gridImages: Record<string, string>;
  ninePrompts: string[];
  smartNinePrompts: string[];
  fourGroups: string[][];
  consistency: ConsistencyProfile;
  customPrompts?: string[];
  customGridCount?: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const cellCount = mode === "custom" ? (customGridCount || 9) : (mode === "nine" || mode === "smartNine") ? 9 : 4;
  const [motionPrompts, setMotionPrompts] = useState<string[]>(Array(cellCount).fill(""));
  const [generating, setGenerating] = useState(false);
  const [generatingCell, setGeneratingCell] = useState<number | null>(null); // which cell is generating
  const [generatingAllSeq, setGeneratingAllSeq] = useState(false); // sequential all-cell generation in progress
  const [copied, setCopied] = useState(false);

  // Storage key for persisting motion prompts
  const storageKey = mode === "custom"
    ? `feicai-motion-prompts-custom-${episode}`
    : mode === "smartNine"
      ? `feicai-motion-prompts-smartNine-${episode}`
      : mode === "nine"
        ? `feicai-motion-prompts-nine-${episode}`
        : `feicai-motion-prompts-four-${episode}-b${fourBeat}`;

  // 加载已保存的动态提示词：磁盘优先 → KV 回退
  useEffect(() => {
    (async () => {
      // 1. 磁盘文件优先
      try {
        const diskRes = await fetch(`/api/outputs/${encodeURIComponent(diskFilename)}`);
        if (diskRes.ok) {
          const diskData = await diskRes.json();
          if (diskData.content) {
            const parsed = JSON.parse(diskData.content);
            if (Array.isArray(parsed) && parsed.length === cellCount) {
              setMotionPrompts(parsed);
              return;
            }
          }
        }
      } catch { /* ignore */ }
      // 2. KV 回退
      try {
        const raw = await kvLoad(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length === cellCount) {
            setMotionPrompts(parsed);
            return;
          }
        }
      } catch { /* ignore */ }

      // 四宫格: try auto-loading from sequence-board-prompt
      if (mode === "four") {
        try {
          const res = await fetch(`/api/outputs/sequence-board-prompt-${episode}.md`);
          if (res.ok) {
            const data = await res.json();
            const content = data.content || "";
            if (content) {
              const groups = parseSequenceBoardPrompts(content);
              const scenes = groups[fourBeat];
              if (scenes && scenes.length > 0) {
                const prompts = scenes.map(s => s || "");
                while (prompts.length < 4) prompts.push("");
                setMotionPrompts(prompts.slice(0, 4));
              }
            }
          }
        } catch { /* ignore */ }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Parse sequence-board-prompt (same logic as video page)
  function parseSequenceBoardPrompts(content: string): string[][] {
    const groups: string[][] = [];
    const parts = content.split(/^##[^\n]*(?:格\s*\d+\s*展开|组\s*\d+|格\s*\d+)[^\n]*/m);
    for (let i = 1; i < parts.length && i <= 9; i++) {
      const raw = parts[i].split(/^---/m)[0].split(/^##(?!#)/m)[0].trim();
      const scenes: string[] = [];
      const sceneParts = raw.split(/^###\s*\d+[^\n]*/m);
      for (let j = 1; j < sceneParts.length && j <= 4; j++) {
        const s = sceneParts[j].trim();
        if (s) {
          const narrative = s.split(/\*\*\[IMG\]\*\*/)[0].replace(/\*\*/g, "").replace(/#+\s*/g, "").trim();
          scenes.push(narrative);
        }
      }
      while (scenes.length < 4 && scenes.length > 0) scenes.push("");
      groups.push(scenes);
    }
    return groups;
  }

  // 磁盘文件名
  const diskFilename = mode === "custom"
    ? `motion-prompts-custom-${episode}.json`
    : mode === "smartNine"
      ? `motion-prompts-smartNine-${episode}.json`
      : mode === "nine"
        ? `motion-prompts-nine-${episode}.json`
        : `motion-prompts-four-${episode}-b${fourBeat}.json`;

  // 保存动态提示词：磁盘持久化 + KV 兼容
  async function saveMotionPrompts(prompts: string[]) {
    // KV 保存（兼容其他页面读取）
    try {
      await kvSet(storageKey, JSON.stringify(prompts));
    } catch { /* ignore */ }
    // 磁盘持久化
    try {
      await fetch("/api/outputs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: [{ name: diskFilename, content: JSON.stringify(prompts) }] }),
      });
    } catch { /* ignore */ }
  }

  // Update a single cell's prompt
  function updateCellPrompt(idx: number, value: string) {
    setMotionPrompts(prev => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }

  // Get grid image key for a cell
  function getCellImageKey(idx: number): string {
    if (mode === "custom") return `custom-${episode}-${idx}`;
    if (mode === "smartNine") return `smartNine-${episode}-${idx}`;
    if (mode === "nine") return `nine-${episode}-${idx}`;
    return `four-${episode}-${fourBeat}-${idx}`;
  }

  // Get scene description for a cell (as context for AI)
  function getCellSceneDesc(idx: number): string {
    if (mode === "custom") {
      const p = customPrompts?.[idx];
      return p ? p.replace(/\*\*/g, "").replace(/\n/g, " ").slice(0, 300) : "";
    }
    if (mode === "smartNine") {
      const p = smartNinePrompts[idx];
      return p ? p.replace(/\*\*/g, "").replace(/\n/g, " ").slice(0, 300) : "";
    }
    if (mode === "nine") {
      const p = ninePrompts[idx];
      return p ? p.replace(/\*\*/g, "").replace(/\n/g, " ").slice(0, 300) : "";
    }
    const scenes = fourGroups[fourBeat];
    if (!scenes) return "";
    return (scenes[idx] || "").replace(/\*\*/g, "").replace(/\n/g, " ").slice(0, 300);
  }

  // Build context parts for AI generation (characters, scenes, style)
  function buildContextParts(): string[] {
    const parts: string[] = [];
    if (consistency.characters?.length > 0) {
      parts.push("【角色信息】\n" + consistency.characters.map(c => `- ${c.name}：${c.description}`).join("\n"));
    }
    if (consistency.scenes?.length > 0) {
      parts.push("【场景信息】\n" + consistency.scenes.map(s => `- ${s.name}：${s.description}`).join("\n"));
    }
    if (consistency.style) {
      const st = consistency.style;
      parts.push(`【视觉风格】画风：${st.artStyle || "未设定"}，色调：${st.colorPalette || "未设定"}${st.stylePrompt ? `，风格提示：${st.stylePrompt}` : ""}`);
    }
    return parts;
  }

  // Generate motion prompts via AI (batch for all cells)
  async function generateAllMotionPrompts() {
    // Check LLM settings
    let llmSettings: Record<string, string> = {};
    try { llmSettings = JSON.parse(localStorage.getItem("feicai-settings") || "{}"); } catch { /* ignore */ }
    if (!llmSettings["llm-key"]) { toast("请先在设置页配置 LLM API Key", "error"); return; }

    // Collect all cell images
    const imageUrls: string[] = [];
    const imageLabels: string[] = [];
    for (let i = 0; i < cellCount; i++) {
      const key = getCellImageKey(i);
      const url = gridImages[key];
      if (url) {
        imageUrls.push(url);
        imageLabels.push(`格${i + 1}`);
      }
    }

    if (imageUrls.length === 0) {
      toast("当前没有已生成的格子图片，请先生成图片", "error");
      return;
    }

    setGenerating(true);
    toast("AI正在批量分析图片并生成动态提示词...", "info");

    try {
      // Compress images for vision
      const resizedImages = await Promise.all(imageUrls.map(u => compressImage(u, 512, 0.6, 200_000)));

      // Load motion prompt system prompt
      let systemPrompt = "";
      try {
        const savedRaw = await kvLoad("feicai-system-prompts");
        if (savedRaw) {
          const saved = JSON.parse(savedRaw);
          systemPrompt = saved.motionPrompt || "";
        }
      } catch { /* ignore */ }
      if (!systemPrompt) {
        try {
          const promptRes = await fetch("/api/prompts");
          if (promptRes.ok) { const pd = await promptRes.json(); systemPrompt = pd.motionPrompt || ""; }
        } catch { /* ignore */ }
      }

      const contextParts = buildContextParts();

      // Build cell-level scene descriptions
      const cellDescs = Array.from({ length: cellCount }, (_, i) => {
        const desc = getCellSceneDesc(i);
        return desc ? `格${i + 1}：${desc}` : `格${i + 1}：(暂无场景描述)`;
      }).join("\n");

      const modeLabel = mode === "custom" ? `自定义宫格(${cellCount}格)` : mode === "smartNine" ? "智能分镜九宫格（3×3）" : mode === "nine" ? "九宫格（3×3）" : `四宫格组${fourBeat + 1}（2×2）`;

      const userMsg = [
        `请为以下${modeLabel}分镜的每个格子生成动态提示词（Motion Prompt），用于图生视频：`,
        ``,
        `【分镜信息】`,
        `- 当前EP：${episode.toUpperCase()}`,
        `- 模式：${modeLabel}`,
        `- 共${imageUrls.length}张图片（${imageLabels.join("、")}）`,
        ``,
        `【各格场景描述】`,
        cellDescs,
        ``,
        ...(contextParts.length > 0 ? [`【剧情上下文】`, ...contextParts.map(p => p + "\n")] : []),
        `【要求】`,
        `1. 为每张图片分别生成一段Motion Prompt（50-150字符）`,
        `2. 仔细观察每张图片的画面内容，作为动态提示词的基础`,
        `3. 结合场景描述和剧情上下文，让动态提示词服务于叙事推进`,
        `4. 包含：具体的镜头运动 + 主体动作 + 速度/节奏 + 氛围`,
        `5. 不要重复描述图片中已有的静态内容，只描述"变化"`,
        `6. 中英文结合，不要任何解释`,
        `7. 严格按以下格式输出，每格一行：`,
        `格1: [Motion Prompt]`,
        `格2: [Motion Prompt]`,
        `...`,
        `格${cellCount}: [Motion Prompt]`,
      ].join("\n");

      const res = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: llmSettings["llm-key"] || "",
          baseUrl: (llmSettings["llm-url"] || "https://api.geeknow.top/v1").replace(/\/+$/, ""),
          model: llmSettings["llm-model"] || "gemini-2.5-pro",
          provider: llmSettings["llm-provider"] || "openAi",
          ...(systemPrompt ? { systemPrompt } : {}),
          prompt: userMsg,
          images: resizedImages,
          maxTokens: 4096,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (res.ok) {
        const data = await res.json();
        let text = data.content || data.text || data.choices?.[0]?.message?.content || "";
        if (text) {
          // Parse "格N: ..." format
          const parsed = parseMotionPromptResponse(text, cellCount);
          setMotionPrompts(parsed);
          await saveMotionPrompts(parsed);
          const fallbackNote = data.visionFallback ? "（注：图片未被模型识别，已用纯文本生成）" : "";
          toast(`已生成${parsed.filter(p => p).length}/${cellCount}个动态提示词${fallbackNote}`, data.visionFallback ? "info" : "success");
        } else {
          toast("AI返回内容为空，请检查LLM模型是否支持Vision", "error");
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        const detail = errData.error || res.statusText || "未知错误";
        toast(`AI生成失败: ${typeof detail === "string" ? detail.slice(0, 120) : JSON.stringify(detail).slice(0, 120)}`, "error");
      }
    } catch (e) {
      toast(`AI生成异常: ${e instanceof Error ? e.message : "网络错误"}`, "error");
    } finally {
      setGenerating(false);
    }
  }

  // Generate motion prompt for a single cell
  async function generateSingleCellPrompt(idx: number) {
    let llmSettings: Record<string, string> = {};
    try { llmSettings = JSON.parse(localStorage.getItem("feicai-settings") || "{}"); } catch { /* ignore */ }
    if (!llmSettings["llm-key"]) { toast("请先在设置页配置 LLM API Key", "error"); return; }

    const key = getCellImageKey(idx);
    const url = gridImages[key];
    if (!url) { toast(`格${idx + 1}没有图片`, "error"); return; }

    setGeneratingCell(idx);
    try {
      const resized = await compressImage(url, 512, 0.6, 200_000);
      let systemPrompt = "";
      try {
        const savedRaw = await kvLoad("feicai-system-prompts");
        if (savedRaw) { const saved = JSON.parse(savedRaw); systemPrompt = saved.motionPrompt || ""; }
      } catch { /* ignore */ }
      if (!systemPrompt) {
        try {
          const promptRes = await fetch("/api/prompts");
          if (promptRes.ok) { const pd = await promptRes.json(); systemPrompt = pd.motionPrompt || ""; }
        } catch { /* ignore */ }
      }

      const sceneDesc = getCellSceneDesc(idx);
      const contextParts = buildContextParts();
      const modeLabel = mode === "custom" ? `自定义宫格(${cellCount}格)` : mode === "smartNine" ? "智能分镜九宫格" : mode === "nine" ? "九宫格" : `四宫格组${fourBeat + 1}`;

      const userMsg = [
        `请为此${modeLabel} · 格${idx + 1}的分镜图片生成动态提示词（Motion Prompt）：`,
        ``,
        sceneDesc ? `【场景描述】${sceneDesc}` : "",
        `【视频参数】当前EP：${episode.toUpperCase()}`,
        ...(contextParts.length > 0 ? [`【剧情上下文】`, ...contextParts.map(p => p + "\n")] : []),
        `【要求】`,
        `1. 观察图片画面内容，为图生视频设计自然的动态化方案`,
        `2. 生成一段Motion Prompt（50-150字符）`,
        `3. 包含：镜头运动 + 主体动作 + 速度/节奏 + 氛围`,
        `4. 不要重复描述静态内容，只描述"变化"`,
        `5. 中英文结合，直接输出提示词文本，不要任何解释`,
      ].filter(Boolean).join("\n");

      const res = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: llmSettings["llm-key"] || "",
          baseUrl: (llmSettings["llm-url"] || "https://api.geeknow.top/v1").replace(/\/+$/, ""),
          model: llmSettings["llm-model"] || "gemini-2.5-pro",
          provider: llmSettings["llm-provider"] || "openAi",
          ...(systemPrompt ? { systemPrompt } : {}),
          prompt: userMsg,
          images: [resized],
          maxTokens: 1024,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (res.ok) {
        const data = await res.json();
        let text = data.content || data.text || data.choices?.[0]?.message?.content || "";
        if (text) {
          // Clean: remove "格N:" prefix if present
          text = text.replace(/^格\d+[:：]\s*/i, "").trim();
          updateCellPrompt(idx, text);
          const updated = [...motionPrompts];
          updated[idx] = text;
          await saveMotionPrompts(updated);
          toast(`格${idx + 1}动态提示词已生成`, "success");
        } else {
          toast("AI返回内容为空", "error");
        }
      } else {
        toast("AI生成失败", "error");
      }
    } catch (e) {
      toast(`生成异常: ${e instanceof Error ? e.message : "网络错误"}`, "error");
    } finally {
      setGeneratingCell(null);
    }
  }

  // Generate all cells sequentially (one-by-one, better quality per cell)
  async function generateAllCellsSequentially() {
    let llmSettings: Record<string, string> = {};
    try { llmSettings = JSON.parse(localStorage.getItem("feicai-settings") || "{}"); } catch { /* ignore */ }
    if (!llmSettings["llm-key"]) { toast("请先在设置页配置 LLM API Key", "error"); return; }

    const cellsWithImages: number[] = [];
    for (let i = 0; i < cellCount; i++) {
      const key = getCellImageKey(i);
      if (gridImages[key]) cellsWithImages.push(i);
    }
    if (cellsWithImages.length === 0) {
      toast("当前没有格子图片，请先生成图片", "error");
      return;
    }

    setGenerating(true);
    setGeneratingAllSeq(true);
    const results = [...motionPrompts]; // snapshot current
    let successCount = 0;

    // Load system prompt once
    let systemPrompt = "";
    try {
      const savedRaw = await kvLoad("feicai-system-prompts");
      if (savedRaw) { const saved = JSON.parse(savedRaw); systemPrompt = saved.motionPrompt || ""; }
    } catch { /* ignore */ }
    if (!systemPrompt) {
      try {
        const promptRes = await fetch("/api/prompts");
        if (promptRes.ok) { const pd = await promptRes.json(); systemPrompt = pd.motionPrompt || ""; }
      } catch { /* ignore */ }
    }

    const contextParts = buildContextParts();
    const modeLbl = mode === "custom" ? `自定义宫格(${cellCount}格)` : mode === "smartNine" ? "智能分镜九宫格" : mode === "nine" ? "九宫格" : `四宫格组${fourBeat + 1}`;

    for (const idx of cellsWithImages) {
      setGeneratingCell(idx);
      try {
        const key = getCellImageKey(idx);
        const url = gridImages[key]!;
        const resized = await compressImage(url, 512, 0.6, 200_000);
        const sceneDesc = getCellSceneDesc(idx);

        const userMsg = [
          `请为此${modeLbl} · 格${idx + 1}的分镜图片生成动态提示词（Motion Prompt）：`,
          ``,
          sceneDesc ? `【场景描述】${sceneDesc}` : "",
          `【视频参数】当前EP：${episode.toUpperCase()}`,
          ...(contextParts.length > 0 ? [`【剧情上下文】`, ...contextParts.map(p => p + "\n")] : []),
          `【要求】`,
          `1. 观察图片画面内容，为图生视频设计自然的动态化方案`,
          `2. 生成一段Motion Prompt（50-150字符）`,
          `3. 包含：镜头运动 + 主体动作 + 速度/节奏 + 氛围`,
          `4. 不要重复描述静态内容，只描述"变化"`,
          `5. 中英文结合，直接输出提示词文本，不要任何解释`,
        ].filter(Boolean).join("\n");

        const res = await fetch("/api/llm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: llmSettings["llm-key"] || "",
            baseUrl: (llmSettings["llm-url"] || "https://api.geeknow.top/v1").replace(/\/+$/, ""),
            model: llmSettings["llm-model"] || "gemini-2.5-pro",
            provider: llmSettings["llm-provider"] || "openAi",
            ...(systemPrompt ? { systemPrompt } : {}),
            prompt: userMsg,
            images: [resized],
            maxTokens: 1024,
          }),
          signal: AbortSignal.timeout(120_000),
        });

        if (res.ok) {
          const data = await res.json();
          let text = data.content || data.text || data.choices?.[0]?.message?.content || "";
          if (text) {
            text = text.replace(/^格\d+[:：]\s*/i, "").trim();
            results[idx] = text;
            setMotionPrompts([...results]);
            successCount++;
          }
        }
      } catch { /* continue to next cell */ }
    }

    // Final save
    await saveMotionPrompts(results);
    setGeneratingCell(null);
    setGenerating(false);
    setGeneratingAllSeq(false);
    toast(`AI一键生成完成：${successCount}/${cellsWithImages.length}个提示词已生成`, "success");
  }

  // Parse batch response: "格1: xxx\n格2: yyy\n..."
  function parseMotionPromptResponse(text: string, count: number): string[] {
    const result: string[] = Array(count).fill("");
    // Try "格N: ..." pattern
    const lines = text.split("\n");
    for (const line of lines) {
      const match = line.match(/^格\s*(\d+)\s*[:：]\s*(.+)/);
      if (match) {
        const idx = parseInt(match[1]) - 1;
        if (idx >= 0 && idx < count) {
          result[idx] = match[2].trim();
        }
      }
    }
    // If pattern didn't match enough, try line-by-line fallback
    if (result.filter(r => r).length < Math.min(count, 2)) {
      const nonEmpty = lines.map(l => l.trim()).filter(l => l && !l.startsWith("#") && l.length > 10);
      for (let i = 0; i < Math.min(nonEmpty.length, count); i++) {
        result[i] = nonEmpty[i].replace(/^格\s*\d+\s*[:：]\s*/i, "").replace(/^\d+[.、)]\s*/, "").trim();
      }
    }
    return result;
  }

  // Copy all prompts to clipboard
  async function copyAllPrompts() {
    const text = motionPrompts.map((p, i) => `格${i + 1}: ${p || "(空)"}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast("已复制全部动态提示词", "success");
    } catch {
      toast("复制失败", "error");
    }
  }

  // Manual save
  async function handleSave() {
    await saveMotionPrompts(motionPrompts);
    toast("动态提示词已保存", "success");
  }

  // Handle escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const customCols = cellCount <= 4 ? 2 : cellCount <= 9 ? 3 : 4;
  const gridColsStyle = mode === "custom" ? { gridTemplateColumns: `repeat(${customCols}, minmax(0, 1fr))` } : undefined;
  const gridCols = mode === "custom" ? "grid" : (mode === "nine" || mode === "smartNine") ? "grid grid-cols-3" : "grid grid-cols-2";
  const modeLabel = mode === "custom" ? `自定义宫格(${cellCount}格)` : mode === "smartNine" ? "智能分镜 · 九宫格" : mode === "nine" ? "九宫格" : `四宫格 · 组${fourBeat + 1}`;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-[90vw] max-w-[1200px] max-h-[90vh] flex flex-col bg-[var(--bg-page)] border border-[var(--border-default)] rounded-lg shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-default)] shrink-0">
          <div className="flex items-center gap-3">
            <Wand2 size={18} className="text-[var(--gold-primary)]" />
            <span className="text-[16px] font-bold text-[var(--text-primary)]">动态提示词</span>
            <span className="text-[12px] text-[var(--text-muted)]">{episode.toUpperCase()} · {modeLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={generateAllMotionPrompts} disabled={generating}
              className="flex items-center gap-1.5 px-4 py-2 bg-[var(--gold-primary)] text-[12px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-40 rounded">
              {generating && !generatingAllSeq ? <Loader size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {generating && !generatingAllSeq ? "生成中..." : "AI批量生成"}
            </button>
            <button onClick={copyAllPrompts}
              className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer rounded">
              <Copy size={14} /> {copied ? "已复制 ✓" : "复制全部"}
            </button>
            <button onClick={async () => {
              if (!confirm(`确定清除 ${episode.toUpperCase()} · ${modeLabel} 的动态提示词缓存？\n清除后需重新AI生成。`)) return;
              setMotionPrompts(Array(cellCount).fill(""));
              try { await kvSet(storageKey, ""); } catch { /* ignore */ }
              toast("已清除动态提示词缓存", "success");
            }}
              className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium border border-red-400/40 text-red-400 hover:border-red-400 hover:bg-red-400/10 transition cursor-pointer rounded">
              <Trash2 size={14} /> 清除缓存
            </button>
            <button onClick={handleSave}
              className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer rounded">
              <Download size={14} /> 保存
            </button>
            <button onClick={onClose}
              className="flex items-center justify-center w-8 h-8 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer rounded">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body — Grid of cells with image + textarea */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className={`${gridCols} gap-4`} style={gridColsStyle}>
            {Array.from({ length: cellCount }, (_, idx) => {
              const imgKey = getCellImageKey(idx);
              const imgUrl = gridImages[imgKey];
              const isGenCell = generatingCell === idx;

              return (
                <div key={idx} className="flex flex-col gap-2 border border-[var(--border-default)] rounded-lg overflow-hidden bg-[var(--bg-surface)]">
                  {/* Cell image */}
                  <div className="relative aspect-video bg-[#111] flex items-center justify-center overflow-hidden">
                    {imgUrl ? (
                      <img src={imgUrl} alt={`格${idx + 1}`} className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center gap-1 text-[var(--text-muted)]">
                        <ImageIcon size={24} />
                        <span className="text-[11px]">暂无图片</span>
                      </div>
                    )}
                    <div className="absolute top-1.5 left-1.5 px-2 py-0.5 bg-black/70 text-[10px] text-white rounded">
                      格{idx + 1}
                    </div>
                  </div>

                  {/* Motion prompt textarea + per-cell generate button */}
                  <div className="flex flex-col gap-1.5 px-3 pb-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-[var(--text-secondary)]">Motion Prompt</span>
                      <button onClick={() => generateSingleCellPrompt(idx)} disabled={generating || isGenCell || !imgUrl}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] text-[var(--gold-primary)] border border-[var(--gold-primary)]/40 hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-40 rounded">
                        {isGenCell ? <Loader size={10} className="animate-spin" /> : <Wand2 size={10} />}
                        {isGenCell ? "生成中" : "AI生成"}
                      </button>
                    </div>
                    <textarea
                      value={motionPrompts[idx] || ""}
                      onChange={e => updateCellPrompt(idx, e.target.value)}
                      placeholder="输入或AI生成动态提示词..."
                      rows={3}
                      className="text-[12px] leading-relaxed text-[var(--text-secondary)] bg-[var(--bg-page)] border border-[var(--border-default)] focus:border-[var(--gold-primary)] outline-none p-2 rounded resize-y min-h-[60px] max-h-[140px]"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Prompts Tab
// ═══════════════════════════════════════════════════════════

function PromptsTab({ mode, ninePrompts, fourGroups, fourBeat, selectedCell, onSelectCell, onSelectFourBeat, smartNinePrompts, customPrompts, customGridCount }: {
  mode: GridMode; ninePrompts: string[]; fourGroups: string[][]; fourBeat: number;
  selectedCell: number; onSelectCell: (i: number) => void; onSelectFourBeat: (i: number) => void;
  smartNinePrompts?: string[]; customPrompts?: string[]; customGridCount?: number;
}) {
  // ★ 九宫格、智能分镜、自定义分镜 共用「格N」布局，数据源不同
  if (mode === "nine" || mode === "smartNine" || mode === "custom") {
    const count = mode === "custom" ? (customGridCount || 9) : 9;
    const prompts = mode === "custom" ? (customPrompts || []) : mode === "smartNine" ? (smartNinePrompts || []) : ninePrompts;
    return (
      <div className="flex flex-col gap-1 p-2">
        {mode === "custom" && <span className="text-[11px] text-[var(--text-muted)] px-2 mb-1">自定义分镜 · {count} 格</span>}
        {Array.from({ length: count }, (_, i) => {
          const prompt = prompts[i];
          // ★ Show Chinese description (before **[IMG]**) if available
          const cnDesc = prompt ? prompt.split(/\*\*\[IMG\]\*\*/)[0].replace(/\*\*/g, "").replace(/\n/g, " ").trim() : "";
          const excerpt = cnDesc
            ? (cnDesc.length > 60 ? cnDesc.slice(0, 60) + "..." : cnDesc)
            : (prompt ? prompt.replace(/\*\*\[IMG\]\*\*\s*/g, "").replace(/\*\*/g, "").replace(/\n/g, " ").slice(0, 60) + "..." : "暂无提示词");
          return (
            <button key={i} onClick={() => onSelectCell(i)}
              className={`flex flex-col gap-1 w-full px-3 py-2 text-left rounded transition cursor-pointer ${
                selectedCell === i ? "bg-[var(--gold-transparent)] border border-[var(--gold-primary)]" : "border border-transparent hover:bg-[var(--bg-surface)]"}`}>
              <span className={`text-[12px] font-semibold ${selectedCell === i ? "text-[var(--gold-primary)]" : "text-[var(--text-primary)]"}`}>
                格{i + 1}
              </span>
              <span className="text-[11px] text-[var(--text-muted)] line-clamp-2">{excerpt}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col p-2">
      <span className="text-[11px] text-[var(--text-muted)] px-2 mb-1">选择组（对应九宫格格子）</span>
      {Array.from({ length: Math.max(9, fourGroups.length) }, (_, i) => (
        <button key={i} onClick={() => onSelectFourBeat(i)}
          className={`flex items-center gap-2 px-3 py-1.5 text-[12px] rounded transition cursor-pointer ${
            fourBeat === i ? "text-[var(--gold-primary)] bg-[var(--gold-transparent)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"}`}>
          <ChevronRight size={10} />
          组{i + 1} → 格{i + 1}展开 {fourGroups[i]?.length ? `(${fourGroups[i].length}帧)` : ""}
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Item List Tab (chars / scenes / props)
// ═══════════════════════════════════════════════════════════

function ItemListTab({ items, onAdd, onUpdate, onDelete, onUpload, onGenRef, onImageEdit, onTranslateRef, translatingRefIds, icon, typeName, onPreview, onDownload, uploadingRefId, generatingRefIds }: {
  items: { id: string; name: string; description: string; referenceImage?: string; prompt?: string }[];
  listKey: string; onAdd: () => void;
  onUpdate: (id: string, field: string, value: string) => void;
  onDelete: (id: string) => void; onUpload: (id: string) => void;
  onGenRef: (id: string, desc: string) => void;
  onImageEdit?: (id: string, name: string, imgUrl: string, description: string) => void;
  onTranslateRef?: (id: string) => void;
  translatingRefIds?: Set<string>;
  icon: React.ReactNode; typeName: string;
  onPreview: (info: { src: string; title: string }) => void;
  onDownload: (url: string, filename: string) => void;
  uploadingRefId: string | null;
  generatingRefIds?: Set<string>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="flex flex-col p-2">
      {items.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-8 text-[var(--text-muted)]">
          {icon}
          <span className="text-[12px]">暂无{typeName}数据</span>
          <span className="text-[11px]">点击「AI 一键提取」或手动添加</span>
        </div>
      )}
      {items.map((item) => (
        <div key={item.id} className="flex flex-col border border-[var(--border-default)] mb-1.5 rounded">
          <button onClick={() => setExpanded(expanded === item.id ? null : item.id)}
            className="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-[var(--bg-surface)] transition cursor-pointer">
            {item.referenceImage ? (
              <img src={item.referenceImage} alt={item.name}
                onClick={(e) => { e.stopPropagation(); onPreview({ src: item.referenceImage!, title: item.name }); }}
                className="w-8 h-8 object-cover border border-[var(--border-default)] rounded shrink-0 cursor-zoom-in hover:ring-1 hover:ring-[var(--gold-primary)]" />
            ) : (
              <div className="flex items-center justify-center w-8 h-8 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded shrink-0">{icon}</div>
            )}
            <span className="flex-1 text-[12px] font-medium text-[var(--text-primary)] truncate">{item.name}</span>
            <ChevronDown size={12} className={`text-[var(--text-muted)] transition-transform ${expanded === item.id ? "rotate-180" : ""}`} />
          </button>

          {expanded === item.id && (
            <div className="flex flex-col gap-2 px-3 pb-3 border-t border-[var(--border-default)]">
              <input value={item.name} onChange={(e) => onUpdate(item.id, "name", e.target.value)}
                className="mt-2 px-2 py-1.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition w-full"
                placeholder="名称" />
              <textarea value={item.description} onChange={(e) => {
                  onUpdate(item.id, "description", e.target.value);
                  const t = e.target; t.style.height = "auto"; t.style.height = t.scrollHeight + "px";
                }}
                ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                rows={2} className="px-2 py-1.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[11px] text-[var(--text-secondary)] outline-none focus:border-[var(--gold-primary)] transition w-full resize-none leading-relaxed overflow-hidden"
                placeholder="详细外观描述（用于AI生图一致性）" />
              {/* AI 翻译按钮 */}
              {onTranslateRef && (
                <button onClick={() => onTranslateRef(item.id)}
                  disabled={!item.description?.trim() || !!translatingRefIds?.has(item.id)}
                  className="flex items-center justify-center gap-1 py-1 text-[10px] text-amber-300 border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 transition cursor-pointer rounded disabled:opacity-40 disabled:cursor-not-allowed">
                  {translatingRefIds?.has(item.id) ? <><Loader size={10} className="animate-spin" /> 生成中...</> : <><Languages size={10} /> AI 生成中英提示词</>}
                </button>
              )}
              {/* 英文提示词（只读） */}
              {item.prompt != null && item.prompt !== "" && (
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] text-[var(--text-muted)] font-medium">英文提示词（由 AI 生成，不可编辑）</span>
                  <div
                    className="px-2 py-1.5 bg-[#111] border border-[var(--border-default)] text-[10px] text-[var(--text-muted)] w-full font-mono leading-relaxed rounded opacity-70 select-text whitespace-pre-wrap break-words">
                    {item.prompt}
                  </div>
                </div>
              )}
              {item.referenceImage && (
                <div className="relative group/refimg w-full h-32 border border-[var(--border-default)] rounded overflow-hidden">
                  <img src={item.referenceImage} alt={item.name}
                    className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/refimg:opacity-100 transition-opacity flex items-center justify-center gap-3">
                    <button onClick={() => onPreview({ src: item.referenceImage!, title: item.name })}
                      className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition cursor-pointer" title="放大预览">
                      <Maximize2 size={16} />
                    </button>
                    {onImageEdit && (
                      <button onClick={() => onImageEdit(item.id, item.name, item.referenceImage!, item.description)}
                        className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition cursor-pointer" title="编辑图片">
                        <Pencil size={16} />
                      </button>
                    )}
                    <button onClick={() => onDownload(item.referenceImage!, `${item.name}-参考图.png`)}
                      className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition cursor-pointer" title="下载图片">
                      <Download size={16} />
                    </button>
                    <button onClick={() => onUpdate(item.id, "referenceImage", "")}
                      className="p-2 rounded-full bg-red-500/60 hover:bg-red-500/80 text-white transition cursor-pointer" title="删除参考图">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              )}
              <div className="flex gap-1.5">
                <button onClick={() => onUpload(item.id)} disabled={uploadingRefId === item.id}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] text-[var(--text-secondary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer disabled:opacity-50">
                  {uploadingRefId === item.id ? <><Loader size={10} className="animate-spin" /> 处理中...</> : <><Upload size={10} /> 上传图</>}
                </button>
                <button onClick={() => onGenRef(item.id, item.description)} disabled={!item.description || uploadingRefId === item.id || !!generatingRefIds?.has(item.id)}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] text-[var(--gold-primary)] border border-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-40">
                  {generatingRefIds?.has(item.id) ? <><Loader size={10} className="animate-spin" /> 生成中...</> : <><Wand2 size={10} /> AI 生图</>}
                </button>
                <button onClick={() => onDelete(item.id)}
                  className="flex items-center justify-center px-2 py-1.5 text-[10px] text-red-400 border border-[var(--border-default)] hover:border-red-400 transition cursor-pointer">
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
      <button onClick={onAdd}
        className="flex items-center justify-center gap-1.5 py-2 mt-1 border border-dashed border-[var(--border-default)] text-[11px] text-[var(--text-muted)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer">
        <Plus size={12} /> 添加{typeName}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Style Tab — AI style recognition only, no manual artStyle/colorPalette
// ═══════════════════════════════════════════════════════════

function StyleTab({ style, onChange, router }: {
  style: { artStyle: string; colorPalette: string; aspectRatio: string; resolution?: string; timeSetting?: string; additionalNotes: string; styleImage?: string; stylePrompt?: string };
  onChange: (field: string, value: string) => void;
  router?: { push: (url: string) => void };
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Aspect Ratio — locked */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-[var(--text-secondary)]">画幅比例</label>
        <div className="flex gap-2">
          {(["16:9", "9:16"] as const).map((r) => (
            <div key={r}
              className={`flex-1 py-2 text-[12px] font-medium border text-center select-none ${
                style.aspectRatio === r
                  ? "bg-[var(--gold-transparent)] border-[var(--gold-primary)] text-[var(--gold-primary)]"
                  : "border-[var(--border-default)] text-[var(--text-muted)] opacity-40"}`}>
              <ImageIcon size={14} className={`inline mr-1 ${r === "9:16" ? "rotate-90" : ""}`} />
              {r === "16:9" ? "横屏 16:9" : "竖屏 9:16"}
            </div>
          ))}
        </div>
      </div>

      {/* Resolution / Quality — locked */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-[var(--text-secondary)]">画质选择</label>
        <div className="flex gap-2">
          {(["1K", "2K", "4K"] as const).map((q) => (
            <div key={q}
              className={`flex-1 py-2 text-[12px] font-medium border text-center select-none ${
                (style.resolution || "1K") === q
                  ? "bg-[var(--gold-transparent)] border-[var(--gold-primary)] text-[var(--gold-primary)]"
                  : "border-[var(--border-default)] text-[var(--text-muted)] opacity-40"}`}>
              {q}
            </div>
          ))}
        </div>
        <span className="text-[10px] text-[var(--text-muted)]">
          {(style.resolution || "1K") === "1K" ? "1024px · 速度快" : (style.resolution || "1K") === "2K" ? "2048px · 平衡" : "4096px · 最高画质"}
        </span>
      </div>

      {/* Locked note */}
      <span
        onClick={() => router?.push("/pipeline")}
        className="flex items-center justify-center gap-1 py-1.5 text-[11px] text-[var(--text-muted)] border border-[var(--border-default)] cursor-pointer hover:text-[var(--gold-primary)] hover:border-[var(--gold-primary)] transition">
        <Lock size={10} />
        画幅 / 画质在「分镜流水线」修改
      </span>

      {/* Style Info — read-only, synced with pipeline */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-[var(--text-secondary)]">风格设定</label>
        <div
          className="px-2 py-1.5 bg-[#1a1a1a] border border-[var(--border-default)] text-[11px] text-[var(--text-secondary)] leading-relaxed rounded min-h-[60px] whitespace-pre-wrap"
        >{(() => {
            const raw = style.stylePrompt || "";
            if (!raw) return <span className="text-[var(--text-muted)]">尚未设定风格，请前往「分镜流水线」设置</span>;
            try {
              const sp = JSON.parse(raw);
              const lines: string[] = [];
              if (sp.artStyle) lines.push(`画风：${sp.artStyle}`);
              if (sp.colorPalette) lines.push(`色调：${sp.colorPalette}`);
              if (sp.styleKeywords) lines.push(`关键词：${sp.styleKeywords}`);
              if (sp.mood) lines.push(`氛围：${sp.mood}`);
              return lines.join("\n");
            } catch {
              return raw;
            }
          })()}</div>
        <span
          onClick={() => router?.push("/pipeline")}
          className="flex items-center justify-center gap-1 text-[10px] text-[var(--text-muted)] cursor-pointer hover:text-[var(--gold-primary)] transition">
          <Lock size={10} />
          风格设定在「分镜流水线」修改
        </span>
      </div>

      {/* Time Setting — repurposed as era/world background; per-shot time-of-day is handled by AI */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-[var(--text-secondary)]">时代/世界观背景</label>
        <input
          type="text"
          value={style.timeSetting || ""}
          onChange={(e) => onChange("timeSetting", e.target.value)}
          className="px-2 py-1.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] outline-none focus:border-[var(--gold-primary)] transition"
          placeholder="例：现代都市  /  古代中国  /  未来太空站  /  中世纪欧洲" />
        <span className="text-[10px] text-[var(--text-muted)]">
          💡 仅用于设定时代/世界观背景。具体时间段和光照（清晨、黄昏、深夜等）由 AI 根据剧本内容自动为每个分镜独立判断，确保符合剧情逻辑
        </span>
      </div>

      {/* Additional Notes — still editable */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[11px] font-medium text-[var(--text-secondary)]">补充说明</label>
        <textarea value={style.additionalNotes} onChange={(e) => onChange("additionalNotes", e.target.value)}
          rows={3} className="px-2 py-1.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] outline-none focus:border-[var(--gold-primary)] transition resize-none"
          placeholder="补充风格/氛围/特殊一致性要求..." />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Nine Grid Area — perfect image fill, no borders
// ═══════════════════════════════════════════════════════════

function NineGridArea({ episode, ninePrompts, gridImages, compositeUrl, imageDims, onImgLoad, generating, regenerating,
  selectedCell, onSelectCell, onCopy, showDetail, onToggleDetail, upscaling, onUpscale,
  onRegenerate, onPreview, onDownload, isWide, onGoFour, onBatchUpscale, onEditPrompt,
  boundRefs, cellRefs, onOpenRefBind, onClearAllRefs, episodeKey, promptsEdited, refsLoading, onStitch, onImageEdit, editingCellKey, onUploadImage, onViewPrompt,
  includeStyleRef, onToggleStyleRef, onTranslate, translating,
  cellKeyPrefix = "nine", globalRefBindType, gridLabel = "九宫格",
  gridSize, onDeleteCell, onClearAllImages, onUndo, imageHistory }: {
  episode: string; ninePrompts: string[]; gridImages: Record<string, string>;
  compositeUrl: string | undefined;
  imageDims: Record<string, string>; onImgLoad: (key: string, e: React.SyntheticEvent<HTMLImageElement>) => void;
  generating: boolean; regenerating: Set<string>;
  selectedCell: number; onSelectCell: (i: number) => void; onCopy: (i: number) => void;
  showDetail: boolean; onToggleDetail: () => void;
  upscaling: Set<string>; onUpscale: (key: string) => void;
  onRegenerate: (idx: number) => void;
  onPreview: (info: { src: string; title: string }) => void;
  onDownload: (url: string, filename: string) => void;
  isWide: boolean; onGoFour?: (idx: number) => void;
  onBatchUpscale: () => void;
  onEditPrompt: (idx: number, value: string) => void;
  boundRefs: string[];
  cellRefs: Record<string, string[]>;
  onOpenRefBind: (target: RefBindTarget) => void;
  onClearAllRefs: () => void;
  episodeKey: string;
  promptsEdited?: boolean;
  refsLoading?: boolean;
  onStitch: () => void;
  onImageEdit?: (idx: number) => void;
  editingCellKey?: string | null;
  onUploadImage?: (idx: number) => void;
  onViewPrompt?: () => void;
  includeStyleRef?: boolean;
  onToggleStyleRef?: () => void;
  onTranslate?: (idx: number) => void;
  translating?: Set<number>;
  cellKeyPrefix?: string;
  globalRefBindType?: RefBindTarget;
  gridLabel?: string;
  gridSize?: number;
  onDeleteCell?: (idx: number) => void;
  onClearAllImages?: () => void;
  onUndo?: (idx: number) => void;
  imageHistory?: Record<string, string[]>;
}) {
  const actualGridSize = gridSize ?? 9;
  const hasCells = Array.from({ length: actualGridSize }, (_, i) => gridImages[`${cellKeyPrefix}-${episode}-${i}`]).some(Boolean);
  // Aspect ratio for each cell: if composite is 16:9, each cell is (16/3):(9/3) = 16:9
  const cellAspect = isWide ? "16/9" : "9/16";
  const hasAnyRefs = boundRefs.length > 0 || Object.values(cellRefs).some(v => v.length > 0);
  // 动态列数
  const gridCols = actualGridSize <= 4 ? 2 : actualGridSize <= 9 ? 3 : actualGridSize <= 16 ? 4 : 5;

  return (
    <div className="flex flex-col gap-4 flex-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[15px] font-semibold text-[var(--text-primary)]">{gridLabel}预览</span>
        <span className="text-[11px] text-[var(--text-muted)]">
          {actualGridSize}格 · 每格支持放大/下载/重新生成/超分
        </span>
        <button onClick={onStitch} disabled={!hasCells}
          className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-[var(--gold-primary)] text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-40 rounded">
          <Grid3X3 size={12} /> 合成{gridLabel}
        </button>
        {onViewPrompt && (
          <button onClick={onViewPrompt}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer rounded">
            <FileText size={12} /> 查看提示词
          </button>
        )}
        <div className="flex-1" />
        <button onClick={() => onOpenRefBind(globalRefBindType ?? { type: "nine-global" })}
          className={`flex items-center gap-1 px-2 py-1 text-[11px] border transition cursor-pointer rounded ${
            refsLoading
              ? "text-[var(--text-muted)] border-[var(--border-default)] animate-pulse"
              : boundRefs.length > 0
              ? "text-[var(--gold-primary)] border-[var(--gold-primary)] bg-[var(--gold-transparent)]"
              : "text-amber-400 border-amber-400/70 bg-amber-400/10 animate-[pulse_2s_ease-in-out_infinite]"
          }`}
          title={boundRefs.length > 0 ? `已绑定 ${boundRefs.length} 张参考图` : "⚠ 未绑定参考图！生成前请先绑定角色/场景参考图，否则生成效果不佳"}>
          <Link2 size={12} /> {refsLoading ? "加载中..." : boundRefs.length > 0 ? `全局参考图 (${boundRefs.length})` : "⚠ 全局参考图"}
        </button>
        {onToggleStyleRef && (
          <button onClick={onToggleStyleRef}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] border transition cursor-pointer rounded ${
              includeStyleRef
                ? "text-[var(--gold-primary)] border-[var(--gold-primary)] bg-[var(--gold-transparent)]"
                : "text-[var(--text-muted)] border-[var(--border-default)] hover:border-[var(--text-secondary)]"
            }`}
            title={includeStyleRef ? "风格参考图将提交给模型（点击关闭）" : "风格参考图不会提交给模型（点击开启）"}>
            <Palette size={12} /> 风格参考图→模型{includeStyleRef ? " ✓" : ""}
          </button>
        )}
        {hasAnyRefs && (
          <button onClick={onClearAllRefs}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-red-400 border border-red-400/40 hover:bg-red-400/10 transition cursor-pointer rounded"
            title="清除本页所有参考图绑定（全局+格级）">
            <X size={12} /> 清除参考图
          </button>
        )}
        <button onClick={onBatchUpscale} disabled={!hasCells || upscaling.size > 0}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--gold-primary)] border border-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-40 rounded">
          <ZoomIn size={12} /> 一键超分
        </button>
        {onClearAllImages && (
          <button onClick={onClearAllImages} disabled={!hasCells}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-red-400 border border-red-400/40 hover:bg-red-400/10 transition cursor-pointer disabled:opacity-40 rounded"
            title="清空当前EP所有格图，方便重新工作">
            <Trash2 size={12} /> 清空画布
          </button>
        )}
        <button onClick={onToggleDetail}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--text-secondary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer">
          {showDetail ? <EyeOff size={12} /> : <Eye size={12} />} {showDetail ? "收起" : "提示词"}
        </button>
      </div>

      {/* Composite image preview (before crop completes) */}
      {compositeUrl && !hasCells && (
        <div className="relative border border-[var(--gold-primary)] cursor-pointer overflow-hidden rounded"
          onClick={() => onPreview({ src: compositeUrl, title: `${gridLabel}合成图` })}>
          <img src={compositeUrl} alt={`${gridLabel}合成图`} className="w-full" />
          <div className="absolute top-2 left-2 px-2 py-1 bg-[#0A0A0A]/80 text-[10px] text-[var(--gold-primary)] rounded">
            合成图（点击放大）
          </div>
        </div>
      )}

      {/* Grid — seamless, no gap, perfect fit */}
      {(hasCells || !compositeUrl) && (
        <div className="grid w-full overflow-hidden rounded" style={{ gap: "1px", background: "#222", gridTemplateColumns: `repeat(${gridCols}, 1fr)` }}>
          {Array.from({ length: actualGridSize }, (_, idx) => {
            const key = `${cellKeyPrefix}-${episode}-${idx}`;
            const imgUrl = gridImages[key];
            const isUpscaling = upscaling.has(key);
            const isRegen = regenerating.has(key);
            const prompt = ninePrompts[idx];
            // ★ Show Chinese description (before **[IMG]**) if available; otherwise show the full prompt
            const cnDesc = prompt ? prompt.split(/\*\*\[IMG\]\*\*/)[0].replace(/\*\*/g, "").replace(/\n/g, " ").trim() : "";
            const excerpt = cnDesc || (prompt ? prompt.replace(/\*\*\[IMG\]\*\*\s*/g, "").replace(/\*\*/g, "").replace(/\n/g, " ").slice(0, 40) : "");
            const isCustomized = key in cellRefs;
            const cellRefList = cellRefs[key] || [];
            // If cell has explicit custom binding (even if cleared to empty), use it; otherwise inherit global
            const effectiveRefs = isCustomized ? cellRefList : boundRefs;
            const hasBoundRefs = effectiveRefs.length > 0;

            return (
              <div key={idx} onClick={() => onSelectCell(idx)}
                className={`group relative bg-[#1a1a1a] overflow-hidden cursor-pointer transition-shadow ${
                  idx === selectedCell ? "ring-2 ring-[var(--gold-primary)] z-10" : "hover:ring-1 hover:ring-[var(--gold-primary)]/50"}`}
                style={{ aspectRatio: cellAspect }}>

                {imgUrl ? (
                  <img src={imgUrl} alt={`格${idx + 1}`} className="absolute inset-0 w-full h-full object-cover" onLoad={(e) => onImgLoad(key, e)} />
                ) : generating || isRegen ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader size={24} className="text-[var(--gold-primary)] animate-spin" />
                  </div>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-2">
                    <span className="px-2 py-0.5 text-[10px] font-semibold text-[var(--gold-primary)] bg-[var(--gold-transparent)] rounded">格{idx + 1}</span>
                    {excerpt && <span className="mt-1.5 px-2 text-[9px] text-[var(--text-muted)] text-center line-clamp-2">{excerpt}</span>}
                    {prompt && (
                      <button onClick={(e) => { e.stopPropagation(); onRegenerate(idx); }}
                        className="mt-2 flex items-center gap-1 px-3 py-1.5 text-[11px] text-[#0A0A0A] bg-[var(--gold-primary)] hover:brightness-110 transition cursor-pointer rounded shadow-sm">
                        <Sparkles size={12} /> 生成
                      </button>
                    )}
                  </div>
                )}

                {imgUrl && (
                  <div className="absolute top-0 left-0 px-1.5 py-0.5 bg-[#0A0A0A]/70 text-[9px] font-semibold text-[var(--gold-primary)]">格{idx + 1}</div>
                )}
                {imgUrl && imageDims[key] && (
                  <div className="absolute bottom-0 right-0 px-1 py-0.5 bg-[#0A0A0A]/70 text-[8px] text-[var(--text-muted)]">{imageDims[key]}</div>
                )}

                {/* Cell-level ref bind button (top-right, hover-reveal) */}
                <button onClick={(e) => { e.stopPropagation(); onOpenRefBind({ type: "cell", cellKey: key }); }}
                  className={`absolute top-0.5 right-0.5 z-20 flex items-center justify-center w-6 h-6 rounded transition-opacity duration-200 cursor-pointer ${
                    cellRefList.length > 0
                      ? "bg-[var(--gold-primary)] text-[#0A0A0A] opacity-80 group-hover:opacity-100"
                      : "bg-[#0A0A0A]/60 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--gold-primary)]"
                  }`}
                  title="绑定参考图">
                  <Link2 size={10} />
                </button>

                {/* Cell-level ref thumbnail bar (bottom, hover-reveal, scrollable) + bind button */}
                <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center bg-[#0A0A0A]/80 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <div className="flex items-center gap-1 px-1 py-1 overflow-x-auto scrollbar-thin" style={{ maxWidth: 'calc(100% - 28px)' }}>
                    {effectiveRefs.slice(0, 14).map((refUrl, ri) => (
                      <img key={ri} src={refUrl} alt="" className="w-[60px] h-[60px] object-contain rounded-sm border border-[var(--gold-primary)]/50 shrink-0 bg-[#0A0A0A]" />
                    ))}
                    <button onClick={(e) => { e.stopPropagation(); onOpenRefBind({ type: "cell", cellKey: key }); }}
                      className="shrink-0 w-[36px] h-[36px] flex items-center justify-center bg-[#1a1a1a]/80 hover:bg-[var(--gold-primary)] text-[var(--text-muted)] hover:text-[#0A0A0A] rounded-sm border border-dashed border-[var(--border-default)] hover:border-[var(--gold-primary)] cursor-pointer transition"
                      title="绑定参考图">
                      <Plus size={14} />
                    </button>
                  </div>
                  {hasBoundRefs && <span className="text-[7px] text-[var(--text-muted)] shrink-0 px-0.5">
                    {cellRefList.length > 0 ? "格" : "全"}
                  </span>}
                </div>

                {/* Hover action overlay */}
                <div className="absolute inset-0 flex flex-col items-center justify-start pt-3 gap-1 bg-[#0A0A0A]/75 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  {imgUrl && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); onPreview({ src: imgUrl, title: `${gridLabel} 格${idx + 1}` }); }}
                        className="flex items-center gap-1 px-2.5 py-1 text-[10px] text-[#0A0A0A] bg-[var(--gold-primary)] hover:brightness-110 transition cursor-pointer rounded">
                        <Maximize2 size={10} /> 放大
                      </button>
                      <div className="flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); onDownload(imgUrl, `nine-grid-${idx + 1}.png`); }}
                          className="flex items-center gap-0.5 px-2 py-1 text-[9px] text-[var(--text-primary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer rounded">
                          <Download size={9} /> 下载
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onUpscale(key); }} disabled={isUpscaling}
                          className="flex items-center gap-0.5 px-2 py-1 text-[9px] text-[var(--text-primary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer disabled:opacity-40 rounded">
                          {isUpscaling ? <Loader size={9} className="animate-spin" /> : <ZoomIn size={9} />} 超分
                        </button>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); onRegenerate(idx); }} disabled={!!isRegen || editingCellKey === key}
                          className="flex items-center gap-0.5 px-2 py-1 text-[9px] text-[var(--text-primary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer disabled:opacity-40 rounded">
                          {isRegen ? <Loader size={9} className="animate-spin" /> : <RefreshCw size={9} />} 重新生成
                        </button>
                        {onGoFour && (
                        <button onClick={(e) => { e.stopPropagation(); onGoFour(idx); }}
                          className="flex items-center gap-0.5 px-2 py-1 text-[9px] text-[var(--text-primary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer rounded">
                          <ArrowRight size={9} /> 四宫格
                        </button>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); onImageEdit?.(idx); }} disabled={editingCellKey === key}
                          className="flex items-center gap-0.5 px-2 py-1 text-[9px] text-[var(--gold-primary)] border border-[var(--gold-primary)]/50 hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-40 rounded">
                          <Pencil size={9} /> 图片编辑
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onUploadImage?.(idx); }}
                          className="flex items-center gap-0.5 px-2 py-1 text-[9px] text-[var(--text-primary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer rounded">
                          <Upload size={9} /> 上传图片
                        </button>
                        {onDeleteCell && (
                          <button onClick={(e) => { e.stopPropagation(); onDeleteCell(idx); }}
                            className="flex items-center gap-0.5 px-2 py-1 text-[9px] text-red-400 border border-red-400/40 hover:bg-red-400/10 transition cursor-pointer rounded"
                            title="删除此格图片">
                            <Trash2 size={9} /> 删除
                          </button>
                        )}
                        {onUndo && imageHistory?.[key]?.length ? (
                          <button onClick={(e) => { e.stopPropagation(); onUndo(idx); }}
                            className="flex items-center gap-0.5 px-2 py-1 text-[9px] text-amber-400 border border-amber-400/40 hover:bg-amber-400/10 transition cursor-pointer rounded"
                            title={`撤回到上一张 (${imageHistory[key].length})`}>
                            <Undo2 size={9} /> 撤回
                          </button>
                        ) : null}
                      </div>
                    </>
                  )}
                  {!imgUrl && (
                    <>
                      {prompt && (
                        <button onClick={(e) => { e.stopPropagation(); onRegenerate(idx); }} disabled={!!isRegen}
                          className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-[#0A0A0A] bg-[var(--gold-primary)] hover:brightness-110 transition cursor-pointer disabled:opacity-40 rounded">
                          {isRegen ? <Loader size={10} className="animate-spin" /> : <Sparkles size={10} />} 生成此格
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); onUploadImage?.(idx); }}
                        className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer rounded">
                        <Upload size={10} /> 上传图片
                      </button>
                      {prompt && (
                        <button onClick={(e) => { e.stopPropagation(); onCopy(idx); }}
                          className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer rounded">
                          <Copy size={10} /> 复制提示词
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Prompt Detail Panel — 中英文分离 + [IMG] 保护 */}
      {showDetail && ninePrompts[selectedCell] && (() => {
        const fullText = ninePrompts[selectedCell];
        const imgIdx = fullText.indexOf("**[IMG]**");
        const chineseDesc = imgIdx >= 0 ? fullText.slice(0, imgIdx).trim() : fullText.trim();
        const englishPrompt = imgIdx >= 0 ? fullText.slice(imgIdx + "**[IMG]**".length).trim() : "";
        const hasImg = imgIdx >= 0;
        const isTranslating = translating?.has(selectedCell);
        return (
          <div className="flex flex-col gap-3 p-4 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">格{selectedCell + 1} 完整提示词</span>
              <div className="flex items-center gap-2">
                {promptsEdited && <span className="text-[10px] text-amber-400">● 已编辑（仅本次会话有效）</span>}
                {onTranslate && (
                  <button onClick={() => onTranslate(selectedCell)} disabled={isTranslating || !chineseDesc}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] text-blue-400 border border-blue-400/60 hover:bg-blue-400/10 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed rounded">
                    {isTranslating ? <Loader size={12} className="animate-spin" /> : <Languages size={12} />} AI翻译
                  </button>
                )}
                <button onClick={() => onCopy(selectedCell)}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--gold-primary)] border border-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer rounded">
                  <Copy size={12} /> 复制
                </button>
              </div>
            </div>
            {/* 操作提示 */}
            <div className="flex items-center gap-2 px-3 py-2 rounded border border-amber-500/30 bg-amber-500/5">
              <span className="text-amber-400 text-sm shrink-0">💡</span>
              <span className="text-[11px] text-amber-300/90 leading-relaxed">在下方输入<strong className="text-amber-200">中文描述</strong>，点击右上角「<strong className="text-[var(--gold-primary)]">AI 翻译</strong>」可自动转为英文提示词提交给图像模型</span>
            </div>
            {/* 中文描述（可编辑） */}
            <div className="flex flex-col gap-1">
                <span className="text-[10px] text-[var(--text-muted)] font-medium">中文描述</span>
                <textarea value={chineseDesc}
                  onChange={(e) => {
                    const newChinese = e.target.value;
                    const newFull = hasImg ? `${newChinese}\n\n**[IMG]** ${englishPrompt}` : newChinese;
                    onEditPrompt(selectedCell, newFull);
                  }}
                  rows={2}
                  placeholder="输入中文分镜描述，点击「AI翻译」可自动生成英文提示词"
                  className="text-[12px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap font-mono max-h-[150px] min-h-[48px] overflow-auto bg-[var(--bg-page)] border border-[var(--border-default)] focus:border-[var(--gold-primary)] outline-none p-3 rounded resize-y" />
            </div>
            {/* [IMG] 标记 + 英文提示词（可编辑） */}
            {hasImg && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[var(--text-muted)] font-medium">英文提示词</span>
                  <span className="px-1.5 py-0.5 text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded select-none">[IMG]</span>
                </div>
                <textarea value={englishPrompt}
                  onChange={(e) => {
                    const newFull = chineseDesc ? `${chineseDesc}\n\n**[IMG]** ${e.target.value}` : `**[IMG]** ${e.target.value}`;
                    onEditPrompt(selectedCell, newFull);
                  }}
                  className="text-[12px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap font-mono max-h-[200px] min-h-[60px] overflow-auto bg-[var(--bg-page)] border border-[var(--border-default)] focus:border-[var(--gold-primary)] outline-none p-3 rounded resize-y" />
              </div>
            )}
            {/* 无 [IMG] 标记时显示整段可编辑 */}
            {!hasImg && !chineseDesc && (
              <textarea value={fullText}
                onChange={(e) => onEditPrompt(selectedCell, e.target.value)}
                placeholder="待生成英文提示词..."
                className="text-[12px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap font-mono max-h-[200px] min-h-[80px] overflow-auto bg-[var(--bg-page)] border border-[var(--border-default)] focus:border-[var(--gold-primary)] outline-none p-3 rounded resize-y" />
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Four Grid Area — seamless cells + prompt panel
// ═══════════════════════════════════════════════════════════

function FourGridArea({ episode, fourGroups, fourBeat, onBeatChange, gridImages, compositeUrl,
  imageDims, onImgLoad, nineGridCellUrl, generating, regenerating, onCopy, showDetail, onToggleDetail, upscaling, onUpscale,
  onRegenerate, onPreview, onDownload, isWide, onBatchUpscale, onEditPrompt,
  boundRefs, cellRefs, onOpenRefBind, onClearAllRefs, promptsEdited, refsLoading, onStitch, onImageEdit, editingCellKey, onUploadImage, onViewPrompt,
  includeStyleRef, onToggleStyleRef, onTranslate, translating, onGenerateContinuousAction, generatingContinuousAction,
  onDeleteCell, onClearAllImages, onUndo, imageHistory }: {
  episode: string; fourGroups: string[][]; fourBeat: number; onBeatChange: (i: number) => void;
  gridImages: Record<string, string>; compositeUrl: string | undefined;
  imageDims: Record<string, string>; onImgLoad: (key: string, e: React.SyntheticEvent<HTMLImageElement>) => void;
  nineGridCellUrl: string | undefined; generating: boolean; regenerating: Set<string>;
  onCopy: (cellIdx: number) => void;
  showDetail: boolean; onToggleDetail: () => void;
  upscaling: Set<string>; onUpscale: (key: string) => void;
  onRegenerate: (idx: number) => void;
  onPreview: (info: { src: string; title: string }) => void;
  onDownload: (url: string, filename: string) => void;
  isWide: boolean;
  onBatchUpscale: () => void;
  onEditPrompt: (idx: number, value: string) => void;
  boundRefs: string[];
  cellRefs: Record<string, string[]>;
  onOpenRefBind: (target: RefBindTarget) => void;
  onClearAllRefs: () => void;
  promptsEdited?: boolean;
  refsLoading?: boolean;
  onStitch: () => void;
  onImageEdit?: (idx: number) => void;
  editingCellKey?: string | null;
  onUploadImage?: (idx: number) => void;
  onViewPrompt?: () => void;
  includeStyleRef?: boolean;
  onToggleStyleRef?: () => void;
  onTranslate?: (idx: number) => void;
  translating?: Set<number>;
  onGenerateContinuousAction?: () => void;
  generatingContinuousAction?: boolean;
  onDeleteCell?: (idx: number) => void;
  onClearAllImages?: () => void;
  onUndo?: (idx: number) => void;
  imageHistory?: Record<string, string[]>;
}) {
  const scenes = fourGroups[fourBeat] || [];
  const sceneLabels = ["左上", "右上", "左下", "右下"];
  const hasCells = Array.from({ length: 4 }, (_, i) => gridImages[`four-${episode}-${fourBeat}-${i}`]).some(Boolean);
  const cellAspect = isWide ? "16/9" : "9/16";
  const [selectedFourCell, setSelectedFourCell] = useState(0);
  const hasAnyRefs = boundRefs.length > 0 || Object.values(cellRefs).some(v => v.length > 0);

  // Reset selected cell when switching beat groups
  useEffect(() => { setSelectedFourCell(0); }, [fourBeat]);

  return (
    <div className="flex flex-col gap-3 flex-1">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[15px] font-semibold text-[var(--text-primary)]">四宫格预览</span>
        <select value={fourBeat} onChange={(e) => onBeatChange(Number(e.target.value))}
          className="bg-[var(--bg-surface)] border border-[var(--border-default)] text-[12px] text-[var(--text-primary)] px-2 py-1 outline-none">
          {Array.from({ length: Math.max(9, fourGroups.length) }, (_, i) => (
            <option key={i} value={i}>组{i + 1} → 格{i + 1}展开 {fourGroups[i]?.length ? `(${fourGroups[i].length}帧)` : ""}</option>
          ))}
        </select>
        <span className="text-[11px] text-[var(--text-muted)]">
          {scenes.length}/4 场景
        </span>
        <button onClick={onStitch} disabled={!hasCells}
          className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-[var(--gold-primary)] text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-40 rounded">
          <Grid2X2 size={12} /> 合成四宫格
        </button>
        {onGenerateContinuousAction && (
          <button onClick={onGenerateContinuousAction} disabled={generatingContinuousAction || !nineGridCellUrl}
            title={nineGridCellUrl ? "AI分析九宫格画面，自动生成4个连续动作帧的中英提示词" : "请先生成九宫格图片"}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-purple-400/70 text-purple-400 hover:bg-purple-400/10 transition cursor-pointer disabled:opacity-40 rounded">
            {generatingContinuousAction ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />} 一键生成连续动提示词
          </button>
        )}
        {onViewPrompt && (
          <button onClick={onViewPrompt}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer rounded">
            <FileText size={12} /> 查看提示词
          </button>
        )}
        <div className="flex-1" />
        <button onClick={() => onOpenRefBind({ type: "four-global", beatIdx: fourBeat })}
          className={`flex items-center gap-1 px-2 py-1 text-[11px] border transition cursor-pointer rounded ${
            refsLoading
              ? "text-[var(--text-muted)] border-[var(--border-default)] animate-pulse"
              : boundRefs.length > 0
              ? "text-[var(--gold-primary)] border-[var(--gold-primary)] bg-[var(--gold-transparent)]"
              : "text-amber-400 border-amber-400/70 bg-amber-400/10 animate-[pulse_2s_ease-in-out_infinite]"
          }`}
          title={boundRefs.length > 0 ? `已绑定 ${boundRefs.length} 张参考图` : "⚠ 未绑定参考图！生成前请先绑定角色/场景参考图，否则生成效果不佳"}>
          <Link2 size={12} /> {refsLoading ? "加载中..." : boundRefs.length > 0 ? `全局参考图 (${boundRefs.length})` : "⚠ 全局参考图"}
        </button>
        {onToggleStyleRef && (
          <button onClick={onToggleStyleRef}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] border transition cursor-pointer rounded ${
              includeStyleRef
                ? "text-[var(--gold-primary)] border-[var(--gold-primary)] bg-[var(--gold-transparent)]"
                : "text-[var(--text-muted)] border-[var(--border-default)] hover:border-[var(--text-secondary)]"
            }`}
            title={includeStyleRef ? "风格参考图将提交给模型（点击关闭）" : "风格参考图不会提交给模型（点击开启）"}>
            <Palette size={12} /> 风格参考图→模型{includeStyleRef ? " ✓" : ""}
          </button>
        )}
        {hasAnyRefs && (
          <button onClick={onClearAllRefs}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-red-400 border border-red-400/40 hover:bg-red-400/10 transition cursor-pointer rounded"
            title="清除本页所有参考图绑定（全局+格级）">
            <X size={12} /> 清除参考图
          </button>
        )}
        <button onClick={onBatchUpscale} disabled={!hasCells || upscaling.size > 0}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--gold-primary)] border border-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-40 rounded">
          <ZoomIn size={12} /> 一键超分
        </button>
        {onClearAllImages && (
          <button onClick={onClearAllImages} disabled={!hasCells}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-red-400 border border-red-400/40 hover:bg-red-400/10 transition cursor-pointer disabled:opacity-40 rounded"
            title="清空当前节拍所有格图，方便重新工作">
            <Trash2 size={12} /> 清空画布
          </button>
        )}
        <button onClick={onToggleDetail}
          className="flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--text-secondary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer rounded">
          {showDetail ? <EyeOff size={12} /> : <Eye size={12} />} {showDetail ? "收起" : "提示词"}
        </button>
      </div>

      {/* Reference image (垫图) indicator */}
      <div className="flex items-center gap-3 px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded">
        <span className="text-[11px] text-[var(--text-muted)] shrink-0">垫图（九宫格格{fourBeat + 1}）：</span>
        {nineGridCellUrl ? (
          <img src={nineGridCellUrl} alt="垫图"
            className="w-16 h-10 object-cover border border-[var(--gold-primary)] cursor-pointer rounded"
            onClick={() => onPreview({ src: nineGridCellUrl, title: `垫图 - 九宫格格${fourBeat + 1}` })} />
        ) : (
          <span className="text-[11px] text-red-400">未生成 — 请先生成九宫格</span>
        )}
        <span className="text-[10px] text-[var(--text-muted)]">← 四宫格基于此格展开</span>
      </div>

      {/* Composite preview */}
      {compositeUrl && !hasCells && (
        <div className="relative border border-[var(--gold-primary)] cursor-pointer overflow-hidden rounded"
          onClick={() => onPreview({ src: compositeUrl, title: "四宫格合成图" })}>
          <img src={compositeUrl} alt="四宫格合成图" className="w-full max-h-[400px] object-contain" />
          <div className="absolute top-2 left-2 px-2 py-1 bg-[#0A0A0A]/80 text-[10px] text-[var(--gold-primary)] rounded">合成图（点击放大）</div>
        </div>
      )}

      {/* 2×2 Grid — seamless, tight gap */}
      {(hasCells || !compositeUrl) && (
        <div className="grid grid-cols-2 w-full overflow-hidden rounded" style={{ gap: "1px", background: "#222" }}>
          {Array.from({ length: 4 }, (_, idx) => {
            const key = `four-${episode}-${fourBeat}-${idx}`;
            const imgUrl = gridImages[key];
            const isUpscaling = upscaling.has(key);
            const isRegen = regenerating.has(key);
            const sceneText = scenes[idx] || "";
            // ★ Show Chinese description (before **[IMG]**) if available; otherwise show the full prompt
            const cnDesc = sceneText ? sceneText.split(/\*\*\[IMG\]\*\*/)[0].replace(/\*\*/g, "").replace(/\n/g, " ").trim() : "";
            const excerpt = cnDesc || sceneText.replace(/\*\*\[IMG\]\*\*\s*/g, "").replace(/\*\*/g, "").replace(/\n/g, " ").slice(0, 60);
            const isCustomized = key in cellRefs;
            const cellRefList = cellRefs[key] || [];
            // Build display refs: cell binding if customized, else global.
            // When cell is explicitly cleared to empty, still show nineRef (垫图) as minimum since it's always used in generation.
            let effectiveRefs: string[];
            if (isCustomized && cellRefList.length > 0) {
              effectiveRefs = cellRefList;
            } else if (!isCustomized) {
              effectiveRefs = boundRefs; // includes nineRef + global manual
            } else {
              // Customized but empty — show nineRef as fallback
              effectiveRefs = nineGridCellUrl ? [nineGridCellUrl] : [];
            }
            const hasBoundRefs = effectiveRefs.length > 0;

            return (
              <div key={idx} onClick={() => setSelectedFourCell(idx)}
                className={`group relative bg-[#1a1a1a] overflow-hidden cursor-pointer transition-shadow ${
                  idx === selectedFourCell ? "ring-2 ring-[var(--gold-primary)] z-10" : "hover:ring-1 hover:ring-[var(--gold-primary)]/50"}`}
                style={{ aspectRatio: cellAspect }}>
                {imgUrl ? (
                  <img src={imgUrl} alt={sceneLabels[idx]} className="absolute inset-0 w-full h-full object-cover" onLoad={(e) => onImgLoad(key, e)} />
                ) : generating || isRegen ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader size={32} className="text-[var(--gold-primary)] animate-spin" />
                  </div>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-4 gap-2">
                    <span className="text-[11px] text-[var(--text-muted)] text-center line-clamp-3">{excerpt || "暂无提示词"}</span>
                    {sceneText && (
                      <button onClick={(e) => { e.stopPropagation(); onRegenerate(idx); }}
                        className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-[#0A0A0A] bg-[var(--gold-primary)] hover:brightness-110 transition cursor-pointer rounded shadow-sm">
                        <Sparkles size={12} /> 生成
                      </button>
                    )}
                  </div>
                )}

                {/* Corner label */}
                <div className="absolute top-0 left-0 px-1.5 py-0.5 bg-[#0A0A0A]/70 text-[9px] font-semibold text-[var(--gold-primary)]">
                  {sceneLabels[idx]}
                </div>
                {imgUrl && imageDims[key] && (
                  <div className="absolute bottom-0 right-0 px-1.5 py-0.5 bg-[#0A0A0A]/70 text-[9px] text-[var(--text-muted)]">{imageDims[key]}</div>
                )}

                {/* Cell-level ref bind button (top-right, hover-reveal) */}
                <button onClick={(e) => { e.stopPropagation(); onOpenRefBind({ type: "cell", cellKey: key }); }}
                  className={`absolute top-0.5 right-0.5 z-20 flex items-center justify-center w-6 h-6 rounded transition-opacity duration-200 cursor-pointer ${
                    cellRefList.length > 0
                      ? "bg-[var(--gold-primary)] text-[#0A0A0A] opacity-80 group-hover:opacity-100"
                      : "bg-[#0A0A0A]/60 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--gold-primary)]"
                  }`}
                  title="绑定参考图">
                  <Link2 size={10} />
                </button>

                {/* Cell-level ref thumbnail bar (bottom, hover-reveal, scrollable) + bind button */}
                <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center bg-[#0A0A0A]/80 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <div className="flex items-center gap-1 px-1 py-1 overflow-x-auto scrollbar-thin" style={{ maxWidth: 'calc(100% - 28px)' }}>
                    {effectiveRefs.slice(0, 14).map((refUrl, ri) => (
                      <img key={ri} src={refUrl} alt="" className="w-[72px] h-[72px] object-contain rounded-sm border border-[var(--gold-primary)]/50 shrink-0 bg-[#0A0A0A]" />
                    ))}
                    <button onClick={(e) => { e.stopPropagation(); onOpenRefBind({ type: "cell", cellKey: key }); }}
                      className="shrink-0 w-[42px] h-[42px] flex items-center justify-center bg-[#1a1a1a]/80 hover:bg-[var(--gold-primary)] text-[var(--text-muted)] hover:text-[#0A0A0A] rounded-sm border border-dashed border-[var(--border-default)] hover:border-[var(--gold-primary)] cursor-pointer transition"
                      title="绑定参考图">
                      <Plus size={16} />
                    </button>
                  </div>
                  {hasBoundRefs && <span className="text-[7px] text-[var(--text-muted)] shrink-0 px-0.5">
                    {cellRefList.length > 0 ? "格" : "全"}
                  </span>}
                </div>

                {/* Hover action overlay */}
                <div className="absolute inset-0 flex flex-col items-center justify-start pt-3 gap-1.5 bg-[#0A0A0A]/75 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  {imgUrl && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); onPreview({ src: imgUrl, title: `四宫格 ${sceneLabels[idx]}` }); }}
                        className="flex items-center gap-1 px-2.5 py-1 text-[10px] text-[#0A0A0A] bg-[var(--gold-primary)] hover:brightness-110 transition cursor-pointer rounded">
                        <Maximize2 size={10} /> 放大
                      </button>
                      <div className="flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); onDownload(imgUrl, `four-grid-${fourBeat + 1}-${sceneLabels[idx]}.png`); }}
                          className="flex items-center gap-0.5 px-2 py-1 text-[9px] text-[var(--text-primary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer rounded">
                          <Download size={9} /> 下载
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onUpscale(key); }} disabled={isUpscaling}
                          className="flex items-center gap-0.5 px-2 py-1 text-[9px] text-[var(--text-primary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer disabled:opacity-40 rounded">
                          {isUpscaling ? <Loader size={9} className="animate-spin" /> : <ZoomIn size={9} />} 超分
                        </button>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); onRegenerate(idx); }} disabled={!!isRegen || editingCellKey === key}
                        className="flex items-center gap-0.5 px-2 py-1 text-[9px] text-[var(--text-primary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer disabled:opacity-40 rounded">
                        {isRegen ? <Loader size={9} className="animate-spin" /> : <RefreshCw size={9} />} 重新生成
                      </button>
                      <div className="flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); onImageEdit?.(idx); }} disabled={editingCellKey === key}
                          className="flex items-center gap-0.5 px-2 py-1 text-[9px] text-[var(--gold-primary)] border border-[var(--gold-primary)]/50 hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-40 rounded">
                          <Pencil size={9} /> 图片编辑
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onUploadImage?.(idx); }}
                          className="flex items-center gap-0.5 px-2 py-1 text-[9px] text-[var(--text-primary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer rounded">
                          <Upload size={9} /> 上传图片
                        </button>
                        {onDeleteCell && (
                          <button onClick={(e) => { e.stopPropagation(); onDeleteCell(idx); }}
                            className="flex items-center gap-0.5 px-2 py-1 text-[9px] text-red-400 border border-red-400/40 hover:bg-red-400/10 transition cursor-pointer rounded"
                            title="删除此格图片">
                            <Trash2 size={9} /> 删除
                          </button>
                        )}
                        {onUndo && imageHistory?.[key]?.length ? (
                          <button onClick={(e) => { e.stopPropagation(); onUndo(idx); }}
                            className="flex items-center gap-0.5 px-2 py-1 text-[9px] text-amber-400 border border-amber-400/40 hover:bg-amber-400/10 transition cursor-pointer rounded"
                            title={`撤回到上一张 (${imageHistory[key].length})`}>
                            <Undo2 size={9} /> 撤回
                          </button>
                        ) : null}
                      </div>
                    </>
                  )}
                  {!imgUrl && (
                    <>
                      {sceneText && (
                        <button onClick={(e) => { e.stopPropagation(); onRegenerate(idx); }} disabled={!!isRegen}
                          className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-[#0A0A0A] bg-[var(--gold-primary)] hover:brightness-110 transition cursor-pointer disabled:opacity-40 rounded">
                          {isRegen ? <Loader size={10} className="animate-spin" /> : <Sparkles size={10} />} 生成此格
                        </button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); onUploadImage?.(idx); }}
                        className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer rounded">
                        <Upload size={10} /> 上传图片
                      </button>
                      {sceneText && (
                        <button onClick={(e) => { e.stopPropagation(); onCopy(idx); }}
                          className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-[var(--text-secondary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer rounded">
                          <Copy size={10} /> 复制提示词
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ★ Four-grid Prompt Detail Panel — 中英文分离 + [IMG] 保护 */}
      {showDetail && scenes[selectedFourCell] && (() => {
        const fullText = scenes[selectedFourCell];
        const imgIdx = fullText.indexOf("**[IMG]**");
        const chineseDesc = imgIdx >= 0 ? fullText.slice(0, imgIdx).trim() : fullText.trim();
        const englishPrompt = imgIdx >= 0 ? fullText.slice(imgIdx + "**[IMG]**".length).trim() : "";
        const hasImg = imgIdx >= 0;
        const isTranslating = translating?.has(selectedFourCell);
        return (
          <div className="flex flex-col gap-3 p-4 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">{sceneLabels[selectedFourCell]} 完整提示词</span>
              <div className="flex items-center gap-2">
                {promptsEdited && <span className="text-[10px] text-amber-400">● 已编辑（仅本次会话有效）</span>}
                {onTranslate && (
                  <button onClick={() => onTranslate(selectedFourCell)} disabled={isTranslating || !chineseDesc}
                    className="flex items-center gap-1 px-2 py-1 text-[11px] text-blue-400 border border-blue-400/60 hover:bg-blue-400/10 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed rounded">
                    {isTranslating ? <Loader size={12} className="animate-spin" /> : <Languages size={12} />} AI翻译
                  </button>
                )}
                <button onClick={() => onCopy(selectedFourCell)}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--gold-primary)] border border-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer rounded">
                  <Copy size={12} /> 复制
                </button>
              </div>
            </div>
            {/* 操作提示 */}
            <div className="flex items-center gap-2 px-3 py-2 rounded border border-amber-500/30 bg-amber-500/5">
              <span className="text-amber-400 text-sm shrink-0">💡</span>
              <span className="text-[11px] text-amber-300/90 leading-relaxed">在下方输入<strong className="text-amber-200">中文描述</strong>，点击右上角「<strong className="text-[var(--gold-primary)]">AI 翻译</strong>」可自动转为英文提示词提交给图像模型</span>
            </div>
            {/* 中文描述（可编辑） */}
            <div className="flex flex-col gap-1">
                <span className="text-[10px] text-[var(--text-muted)] font-medium">中文描述</span>
                <textarea value={chineseDesc}
                  onChange={(e) => {
                    const newChinese = e.target.value;
                    const newFull = hasImg ? `${newChinese}\n\n**[IMG]** ${englishPrompt}` : newChinese;
                    onEditPrompt(selectedFourCell, newFull);
                  }}
                  rows={2}
                  placeholder="输入中文分镜描述，点击「AI翻译」可自动生成英文提示词"
                  className="text-[12px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap font-mono max-h-[150px] min-h-[48px] overflow-auto bg-[var(--bg-page)] border border-[var(--border-default)] focus:border-[var(--gold-primary)] outline-none p-3 rounded resize-y" />
            </div>
            {/* [IMG] 标记 + 英文提示词（可编辑） */}
            {hasImg && (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-[var(--text-muted)] font-medium">英文提示词</span>
                  <span className="px-1.5 py-0.5 text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded select-none">[IMG]</span>
                </div>
                <textarea value={englishPrompt}
                  onChange={(e) => {
                    const newFull = chineseDesc ? `${chineseDesc}\n\n**[IMG]** ${e.target.value}` : `**[IMG]** ${e.target.value}`;
                    onEditPrompt(selectedFourCell, newFull);
                  }}
                  className="text-[12px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap font-mono max-h-[200px] min-h-[60px] overflow-auto bg-[var(--bg-page)] border border-[var(--border-default)] focus:border-[var(--gold-primary)] outline-none p-3 rounded resize-y" />
              </div>
            )}
            {/* 无 [IMG] 标记时显示整段可编辑 */}
            {!hasImg && !chineseDesc && (
              <textarea value={fullText}
                onChange={(e) => onEditPrompt(selectedFourCell, e.target.value)}
                placeholder="待生成英文提示词..."
                className="text-[12px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap font-mono max-h-[200px] min-h-[80px] overflow-auto bg-[var(--bg-page)] border border-[var(--border-default)] focus:border-[var(--gold-primary)] outline-none p-3 rounded resize-y" />
            )}
          </div>
        );
      })()}

      {/* Video generation placeholder — future API interface */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-surface)] border border-dashed border-[var(--border-default)] rounded text-[11px] text-[var(--text-muted)]">
        🎬 动态提示词 → 后续在「生视频模块」中生成（基于每格图片 + motion prompt）
      </div>
    </div>
  );
}
