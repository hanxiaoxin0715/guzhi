/**
 * 宫格图片原始文件服务 — Plan C: 磁盘为真实来源
 *
 * GET /api/grid-image?key=xxx        → 返回原始图片二进制（Content-Type: image/xxx）
 * GET /api/grid-image?list=1         → 列出所有可用的图片 key
 * GET /api/grid-image?list=1&filter=ep01 → 列出匹配过滤条件的 key
 */
import { NextResponse } from "next/server";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { getGridImagesDir, ensureDir } from "@/app/lib/paths";

export const dynamic = "force-dynamic";

/** 在目录中查找指定 key 的图片文件，返回完整路径或 null */
function findImageFile(dir: string, key: string): string | null {
  if (!existsSync(dir)) return null;
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    const filePath = join(dir, `${key}.${ext}`);
    if (existsSync(filePath)) return filePath;
  }
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dir = getGridImagesDir();
  ensureDir(dir);

  // ── 列表模式 ──
  if (searchParams.has("list")) {
    const filter = searchParams.get("filter") || "";
    const files = existsSync(dir) ? readdirSync(dir) : [];
    const keys = files
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .map((f) => f.replace(/\.\w+$/, ""))
      .filter((k) => (filter ? k.includes(filter) : true));
    return NextResponse.json({ keys });
  }

  // ── 单图模式：返回原始二进制 ──
  const rawKey = searchParams.get("key");
  if (!rawKey) {
    return NextResponse.json({ error: "Missing key or list parameter" }, { status: 400 });
  }

  const key = rawKey.replace(/[^a-zA-Z0-9_\-\.]/g, "");
  const filePath = findImageFile(dir, key);
  if (!filePath) {
    return new Response("Not found", { status: 404 });
  }

  const data = readFileSync(filePath);
  const ext = filePath.split(".").pop()?.toLowerCase() || "png";
  const mimeType =
    ext === "jpg" || ext === "jpeg" ? "image/jpeg"
    : ext === "webp" ? "image/webp"
    : "image/png";

  // ETag 基于文件修改时间 + 大小，实现高效 304 缓存
  const stat = statSync(filePath);
  const etag = `"${stat.mtime.getTime().toString(16)}-${stat.size.toString(16)}"`;
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304 });
  }

  return new Response(data, {
    headers: {
      "Content-Type": mimeType,
      "Cache-Control": "no-cache",
      "ETag": etag,
      "Content-Length": String(data.length),
    },
  });
}
