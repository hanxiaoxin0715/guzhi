import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from "fs";
import { join, basename } from "path";
import { getRefImagesDir } from "@/app/lib/paths";

export const dynamic = "force-dynamic";

function getRefDir() {
  return getRefImagesDir();
}

function ensureDir() {
  const dir = getRefDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Check if a buffer with identical content already exists somewhere in `dir`.
 * Uses size pre-filter for speed — only reads files whose size matches.
 */
function findDuplicateInDir(dir: string, buffer: Buffer): string | null {
  const targetSize = buffer.length;
  try {
    for (const file of readdirSync(dir)) {
      try {
        const filePath = join(dir, file);
        const stat = statSync(filePath);
        if (!stat.isFile() || stat.size !== targetSize) continue;
        const existing = readFileSync(filePath);
        if (buffer.equals(existing)) return filePath;
      } catch { continue; }
    }
  } catch { /* dir doesn't exist */ }
  return null;
}

/**
 * POST /api/ref-image
 * Save a reference image to disk.
 * Body: { key: string, imageData: string (data URL) }
 */
export async function POST(request: Request) {
  try {
    const { key: rawKey, imageData } = await request.json();
    // Sanitize key to prevent path traversal
    const key = String(rawKey || "").replace(/[^a-zA-Z0-9_\-\.]/g, "");
    if (!key || !imageData) {
      return NextResponse.json({ error: "Missing key or imageData" }, { status: 400 });
    }

    ensureDir();

    // Extract base64 from data URL (supports image/* and application/json for metadata)
    const match = imageData.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return NextResponse.json({ error: "Invalid data URL format" }, { status: 400 });
    }

    const mimeType = match[1].toLowerCase();
    let ext: string;
    if (mimeType === "application/json") {
      ext = "json";
    } else if (mimeType.startsWith("image/")) {
      const rawExt = mimeType.replace("image/", "");
      ext = rawExt === "jpeg" ? "jpg" : rawExt;
    } else {
      return NextResponse.json({ error: "Unsupported MIME type" }, { status: 400 });
    }
    const base64 = match[2];
    const buffer = Buffer.from(base64, "base64");

    // ★ Dedup: skip write only if the SAME key already has identical content
    const targetPath = join(getRefDir(), `${key}.${ext}`);
    const dup = findDuplicateInDir(getRefDir(), buffer);
    if (dup) {
      const dupBase = basename(dup).replace(/\.\w+$/, "");
      const sizeKB = Math.round(buffer.length / 1024);
      if (dupBase === key) {
        // 同 key 同内容 → 真正的重复，跳过
        console.log(`[ref-image] ⏭ Skipped ${key}.${ext} (${sizeKB}KB) — same key, identical content`);
        return NextResponse.json({ success: true, key, ext, sizeKB, skipped: true });
      }
      // 不同 key 但相同内容 → 仍需为此 key 创建文件（复制），否则 serve 时找不到
      console.log(`[ref-image] 📋 Copy-dedup ${key}.${ext} (${sizeKB}KB) — identical to ${basename(dup)}, creating for new key`);
    }

    // Remove any existing file with different extension
    for (const e of ["png", "jpg", "jpeg", "webp", "json"]) {
      const old = join(getRefDir(), `${key}.${e}`);
      if (existsSync(old)) {
        try { unlinkSync(old); } catch { /* ignore */ }
      }
    }

    const filePath = join(getRefDir(), `${key}.${ext}`);
    writeFileSync(filePath, buffer);
    const sizeKB = Math.round(buffer.length / 1024);
    console.log(`[ref-image] Saved ${key}.${ext} (${sizeKB}KB)`);

    return NextResponse.json({ success: true, key, ext, sizeKB });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/ref-image?key=xxx
 * Load a single reference image as data URL.
 *
 * GET /api/ref-image?keys=key1,key2,key3
 * Load multiple reference images in one call.
 * Returns { images: { [key]: dataUrl | null } }
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // ★ Serve mode: 返回二进制图片文件（供 <img src="..."> 直接使用）
    const serveKey = searchParams.get("serve");
    if (serveKey) {
      const sanitized = serveKey.replace(/[^a-zA-Z0-9_\-\.]/g, "");
      if (!sanitized) return new Response("Invalid key", { status: 400 });
      ensureDir();
      const fileInfo = findImageFile(sanitized);
      if (!fileInfo) return new Response("Not found", { status: 404 });
      const data = readFileSync(fileInfo.path);
      // ★ 使用 ETag + no-cache 替代 immutable——允许用户替换图片后浏览器能获取新版本
      // URL 带 _t 时间戳参数时浏览器会重新请求；不带时 ETag 验证避免重复传输
      const stat = statSync(fileInfo.path);
      const etag = `"${stat.size}-${stat.mtimeMs.toString(36)}"`;
      return new Response(data, {
        headers: {
          "Content-Type": fileInfo.mimeType,
          "Cache-Control": "public, max-age=300, must-revalidate",
          "ETag": etag,
          "Content-Length": String(data.length),
        },
      });
    }

    // Batch mode
    const keysParam = searchParams.get("keys");
    if (keysParam) {
      const rawKeys = keysParam.split(",").map((k) => k.trim()).filter(Boolean);
      ensureDir();

      // ★ check=1 模式：轻量检查，只返回文件是否存在（避免 300MB+ JSON 响应）
      if (searchParams.get("check") === "1") {
        const exists: Record<string, boolean> = {};
        for (const rawKey of rawKeys) {
          const sanitized = rawKey.replace(/[^a-zA-Z0-9_\-\.]/g, "");
          if (sanitized) exists[rawKey] = !!findImageFile(sanitized);
        }
        return NextResponse.json({ exists });
      }

      // 默认：返回完整 base64 数据（归档等场景使用）
      const images: Record<string, string | null> = {};
      for (const rawKey of rawKeys) {
        const sanitized = rawKey.replace(/[^a-zA-Z0-9_\-\.]/g, "");
        images[rawKey] = sanitized ? readImageAsDataUrl(sanitized) : null;
      }
      return NextResponse.json({ images });
    }

    // Single mode
    const key = searchParams.get("key")?.replace(/[^a-zA-Z0-9_\-\.]/g, "");
    if (!key) {
      // List all available keys
      ensureDir();
      const files = readdirSync(getRefDir());
      const keys = files.map((f) => f.replace(/\.\w+$/, ""));
      return NextResponse.json({ keys });
    }

    const dataUrl = readImageAsDataUrl(key);
    if (dataUrl) {
      return NextResponse.json({ imageData: dataUrl, key });
    }
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/ref-image?key=xxx
 * Delete a reference image file from disk.
 */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key")?.replace(/[^a-zA-Z0-9_\-\.]/g, "");
    if (!key) {
      return NextResponse.json({ error: "Missing key" }, { status: 400 });
    }
    let deleted = false;
    for (const ext of ["png", "jpg", "jpeg", "webp"]) {
      const filePath = join(getRefDir(), `${key}.${ext}`);
      if (existsSync(filePath)) {
        try { unlinkSync(filePath); deleted = true; } catch { /* ignore */ }
      }
    }
    console.log(`[ref-image] DELETE ${key}: ${deleted ? "removed" : "not found"}`);
    return NextResponse.json({ success: true, deleted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Find image file on disk by key, return path and mime type.
 */
function findImageFile(key: string): { path: string; mimeType: string } | null {
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    const filePath = join(getRefDir(), `${key}.${ext}`);
    if (existsSync(filePath)) {
      const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
      return { path: filePath, mimeType };
    }
  }
  return null;
}

function readImageAsDataUrl(key: string): string | null {
  for (const ext of ["png", "jpg", "jpeg", "webp", "json"]) {
    const filePath = join(getRefDir(), `${key}.${ext}`);
    if (existsSync(filePath)) {
      const data = readFileSync(filePath);
      if (ext === "json") {
        return `data:application/json;base64,${data.toString("base64")}`;
      }
      const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      return `data:${mimeType};base64,${data.toString("base64")}`;
    }
  }
  return null;
}
