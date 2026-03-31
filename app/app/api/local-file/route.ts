import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from "fs";
import { join, basename } from "path";
import { getBaseOutputDir, getGridImagesDir } from "@/app/lib/paths";

export const dynamic = "force-dynamic";

// Dynamic base directory: honours user-configured path
function getBaseDir() {
  return getBaseOutputDir();
}

/**
 * Check if a buffer with identical content already exists somewhere in `dir`.
 * Uses size pre-filter for speed — only reads files whose size matches.
 * Returns the matching file path if found, null otherwise.
 */
function findDuplicateInDir(dir: string, buffer: Buffer): string | null {
  const targetSize = buffer.length;
  try {
    for (const file of readdirSync(dir)) {
      try {
        const filePath = join(dir, file);
        const stat = statSync(filePath);
        if (!stat.isFile() || stat.size !== targetSize) continue;
        // Size matches — compare full content
        const existing = readFileSync(filePath);
        if (buffer.equals(existing)) return filePath;
      } catch { continue; }
    }
  } catch { /* dir doesn't exist or not readable */ }
  return null;
}

/**
 * Resolve a sub-directory inside outputs/ for the given category.
 * E.g. "grid-images" → outputs/grid-images/{projectId}/  (★ 项目隔离)
 *      "videos"      → outputs/videos/
 *      "ref-images"  → outputs/ref-images/
 */
function resolveDir(category: string): string {
  // Prevent path traversal
  const safe = category.replace(/[^a-zA-Z0-9_-]/g, "");

  // ★ 项目隔离：grid-images 使用当前活跃项目的专属子目录
  if (safe === "grid-images") {
    const dir = getGridImagesDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  const dir = join(getBaseDir(), safe);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// ═══════════════════════════════════════════════════════════
// POST /api/local-file — Save a file (image or video) to disk
// Body: { category, key, data, type }
//   category: "grid-images" | "videos" | "ref-images" | "video-frames"
//   key:      filename without extension (e.g. "nine-ep01-0")
//   data:     base64 data URL or raw base64 string
//   type:     "image" | "video" (determines file handling)
// ═══════════════════════════════════════════════════════════
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { category, key: rawKey, data, type, copyFrom } = body;

    if (!category || !rawKey) {
      return NextResponse.json({ error: "Missing category or key" }, { status: 400 });
    }

    // Sanitize key to prevent path traversal
    const key = String(rawKey).replace(/[^a-zA-Z0-9_\-\.]/g, "");
    if (!key) {
      return NextResponse.json({ error: "Invalid key" }, { status: 400 });
    }

    const dir = resolveDir(category);

    // ── 服务端文件拷贝：copyFrom 指定源 key ──
    if (copyFrom) {
      const srcKey = String(copyFrom).replace(/[^a-zA-Z0-9_\-\.]/g, "");
      for (const ext of ["png", "jpg", "jpeg", "webp"]) {
        const srcPath = join(dir, `${srcKey}.${ext}`);
        if (existsSync(srcPath)) {
          // 清理同 key 旧文件
          for (const e of ["png", "jpg", "jpeg", "webp"]) {
            const old = join(dir, `${key}.${e}`);
            if (existsSync(old)) try { unlinkSync(old); } catch { /* ignore */ }
          }
          const buf = readFileSync(srcPath);
          const destPath = join(dir, `${key}.${ext}`);
          writeFileSync(destPath, buf);
          const sizeKB = Math.round(buf.length / 1024);
          console.log(`[local-file] Copied ${srcKey}.${ext} → ${key}.${ext} (${sizeKB}KB)`);
          return NextResponse.json({ success: true, key, ext, sizeKB, copied: true });
        }
      }
      return NextResponse.json({ error: `Source key "${srcKey}" not found in ${category}` }, { status: 404 });
    }

    if (!data) {
      return NextResponse.json({ error: "Missing data" }, { status: 400 });
    }

    if (type === "video" || category === "videos") {
      // Video: data can be a URL (fetch & save) or base64 data URL
      const result = await saveVideoFile(dir, key, data);
      if (result.error) return NextResponse.json(result, { status: 400 });
      return NextResponse.json(result);
    }

    // Image: data URL or HTTP URL
    const result = await saveImageFile(dir, key, data);
    if (result.error) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Save an image from data URL or HTTP URL to disk.
 * ★ Deduplication: if an identical file already exists in the directory, skip writing.
 */
async function saveImageFile(dir: string, key: string, dataUrl: string) {
  // Handle HTTP URLs: fetch and save
  if (dataUrl.startsWith("http")) {
    try {
      const res = await fetch(dataUrl, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return { error: `Failed to fetch image: ${res.status}`, success: false };
      const contentType = res.headers.get("content-type") || "image/jpeg";
      let ext = "jpg";
      if (contentType.includes("png")) ext = "png";
      else if (contentType.includes("webp")) ext = "webp";
      const buffer = Buffer.from(await res.arrayBuffer());

      // ★ Dedup: 仅当同 key 文件内容完全一致时跳过；不同 key 的相同内容仍需写入
      const dup = findDuplicateInDir(dir, buffer);
      const dupIsSameKey = dup ? basename(dup).replace(/\.[^.]+$/, "") === key : false;
      if (dup && dupIsSameKey) {
        const sizeKB = Math.round(buffer.length / 1024);
        console.log(`[local-file] ⏭ Skipped ${key} (${sizeKB}KB) — identical content already exists: ${basename(dup)}`);
        return { success: true, key, ext, sizeKB, path: dup, skipped: true };
      }

      // Clean up old files with same key but different extension
      for (const e of ["png", "jpg", "jpeg", "webp"]) {
        const old = join(dir, `${key}.${e}`);
        if (existsSync(old)) try { unlinkSync(old); } catch { /* ignore */ }
      }

      const filePath = join(dir, `${key}.${ext}`);
      writeFileSync(filePath, buffer);
      const sizeKB = Math.round(buffer.length / 1024);
      console.log(`[local-file] Saved image ${key}.${ext} (${sizeKB}KB) from URL → ${filePath}${dup ? ` (dup of ${basename(dup)})` : ""}`);
      return { success: true, key, ext, sizeKB, path: filePath };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Fetch failed";
      return { error: `Image download failed: ${msg}`, success: false };
    }
  }

  // Handle data URLs
  const match = dataUrl.match(/^data:image\/([^;]+);base64,(.+)$/);
  if (!match) {
    return { error: "Invalid image data URL format", success: false };
  }

  const rawExt = match[1].toLowerCase();
  const ext = rawExt === "jpeg" ? "jpg" : rawExt;
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");

  // ★ Dedup: 若目录中已存在相同内容，且恰好是同 key，则跳过；否则仍需写入新 key 文件
  const dup = findDuplicateInDir(dir, buffer);
  const dupIsSameKey = dup ? basename(dup).replace(/\.[^.]+$/, "") === key : false;
  if (dup && dupIsSameKey) {
    const sizeKB = Math.round(buffer.length / 1024);
    console.log(`[local-file] ⏭ Skipped ${key}.${ext} (${sizeKB}KB) — identical content already exists: ${basename(dup)}`);
    return { success: true, key, ext, sizeKB, path: dup, skipped: true };
  }

  // Clean up old files with same key but different extension
  for (const e of ["png", "jpg", "jpeg", "webp"]) {
    const old = join(dir, `${key}.${e}`);
    if (existsSync(old)) try { unlinkSync(old); } catch { /* ignore */ }
  }

  const filePath = join(dir, `${key}.${ext}`);
  writeFileSync(filePath, buffer);
  const sizeKB = Math.round(buffer.length / 1024);
  console.log(`[local-file] Saved image ${key}.${ext} (${sizeKB}KB) → ${filePath}${dup ? ` (dup of ${basename(dup)})` : ""}`);

  return { success: true, key, ext, sizeKB, path: filePath };
}

/**
 * Save a video file to disk.
 * Input `data` can be:
 *   - HTTP URL: fetch and save
 *   - data URL: decode base64 and save
 */
async function saveVideoFile(dir: string, key: string, data: string) {
  // Clean up old video files with same key
  for (const e of ["mp4", "webm", "mov"]) {
    const old = join(dir, `${key}.${e}`);
    if (existsSync(old)) try { unlinkSync(old); } catch { /* ignore */ }
  }

  if (data.startsWith("data:")) {
    // Base64 data URL
    const match = data.match(/^data:video\/([^;]+);base64,(.+)$/);
    if (!match) return { error: "Invalid video data URL", success: false };
    const ext = match[1] === "quicktime" ? "mov" : match[1];
    const filePath = join(dir, `${key}.${ext}`);
    const buffer = Buffer.from(match[2], "base64");
    writeFileSync(filePath, buffer);
    const sizeMB = Math.round(buffer.length / 1024 / 1024 * 100) / 100;
    console.log(`[local-file] Saved video ${key}.${ext} (${sizeMB}MB) → ${filePath}`);
    return { success: true, key, ext, sizeMB, path: filePath };
  }

  if (data.startsWith("http")) {
    // Fetch from URL and save
    try {
      const res = await fetch(data, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) return { error: `Failed to fetch video: ${res.status}`, success: false };

      const contentType = res.headers.get("content-type") || "video/mp4";
      let ext = "mp4";
      if (contentType.includes("webm")) ext = "webm";
      else if (contentType.includes("quicktime") || contentType.includes("mov")) ext = "mov";

      const buffer = Buffer.from(await res.arrayBuffer());
      const filePath = join(dir, `${key}.${ext}`);
      writeFileSync(filePath, buffer);
      const sizeMB = Math.round(buffer.length / 1024 / 1024 * 100) / 100;
      console.log(`[local-file] Saved video ${key}.${ext} (${sizeMB}MB) → ${filePath}`);
      return { success: true, key, ext, sizeMB, path: filePath };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Fetch failed";
      return { error: `Video download failed: ${msg}`, success: false };
    }
  }

  return { error: "Video data must be a URL or data URL", success: false };
}

// ═══════════════════════════════════════════════════════════
// GET /api/local-file?category=xxx&key=yyy — Load a single file
// GET /api/local-file?category=xxx&keys=a,b,c — Load multiple
// GET /api/local-file?category=xxx — List all files in category
// ═══════════════════════════════════════════════════════════
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    if (!category) {
      return NextResponse.json({ error: "Missing category parameter" }, { status: 400 });
    }

    const dir = resolveDir(category);

    // Batch mode
    const keysParam = searchParams.get("keys");
    if (keysParam) {
      const keys = keysParam.split(",").map((k) => k.trim().replace(/[^a-zA-Z0-9_\-\.]/g, "")).filter(Boolean);
      const images: Record<string, string | null> = {};
      for (const key of keys) {
        images[key] = readFileAsDataUrl(dir, key);
      }
      return NextResponse.json({ images });
    }

    // Single mode
    const rawKey = searchParams.get("key");
    if (rawKey) {
      const key = rawKey.replace(/[^a-zA-Z0-9_\-\.]/g, "");
      const dataUrl = readFileAsDataUrl(dir, key);
      if (dataUrl) return NextResponse.json({ data: dataUrl, key });
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // List all
    if (!existsSync(dir)) return NextResponse.json({ files: [] });
    const files = readdirSync(dir).map((name) => {
      const stat = statSync(join(dir, name));
      return {
        name,
        key: name.replace(/\.\w+$/, ""),
        size: stat.size,
        modified: stat.mtime.toISOString(),
      };
    });
    return NextResponse.json({ files });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Read a file and return as data URL (for images)
 * For videos, returns a file:// path or info
 */
function readFileAsDataUrl(dir: string, key: string): string | null {
  // Try image extensions first
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    const filePath = join(dir, `${key}.${ext}`);
    if (existsSync(filePath)) {
      const data = readFileSync(filePath);
      const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      return `data:${mimeType};base64,${data.toString("base64")}`;
    }
  }
  // Try video extensions
  for (const ext of ["mp4", "webm", "mov"]) {
    const filePath = join(dir, `${key}.${ext}`);
    if (existsSync(filePath)) {
      const data = readFileSync(filePath);
      const mimeType = ext === "mov" ? "video/quicktime" : `video/${ext}`;
      return `data:${mimeType};base64,${data.toString("base64")}`;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// DELETE /api/local-file?category=xxx&key=yyy — Delete a single file
// DELETE /api/local-file?category=xxx          — Clear entire category
// ═══════════════════════════════════════════════════════════
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    if (!category) {
      return NextResponse.json({ error: "Missing category" }, { status: 400 });
    }

    const dir = resolveDir(category);
    const key = searchParams.get("key");

    // 批量清空整个分类目录
    if (!key) {
      if (!existsSync(dir)) return NextResponse.json({ success: true, deleted: 0 });
      let count = 0;
      for (const file of readdirSync(dir)) {
        try {
          const fp = join(dir, file);
          if (statSync(fp).isFile()) { unlinkSync(fp); count++; }
        } catch { /* 跳过无法删除的文件 */ }
      }
      console.log(`[local-file] Cleared category "${category}": ${count} files deleted`);
      return NextResponse.json({ success: true, deleted: count });
    }

    // 删除单个文件
    let deleted = false;
    for (const ext of ["png", "jpg", "jpeg", "webp", "mp4", "webm", "mov"]) {
      const filePath = join(dir, `${key}.${ext}`);
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        deleted = true;
      }
    }
    return NextResponse.json({ success: deleted, key });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
