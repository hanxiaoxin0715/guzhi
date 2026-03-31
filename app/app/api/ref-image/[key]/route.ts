import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getRefImagesDir } from "@/app/lib/paths";

export const dynamic = "force-dynamic";

function getRefDir() {
  return getRefImagesDir();
}

/**
 * GET /api/ref-image/[key]
 * Serve a reference image file directly (for <img src> display).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;

  // 防止路径遍历攻击：移除所有目录分隔符和特殊字符
  const safeKey = key.replace(/[\/\\:*?"<>|]/g, "").replace(/\.\./g, "");
  if (!safeKey) return NextResponse.json({ error: "Invalid key" }, { status: 400 });

  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    const filePath = join(getRefDir(), `${safeKey}.${ext}`);
    if (existsSync(filePath)) {
      const data = readFileSync(filePath);
      const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
      return new NextResponse(data, {
        headers: {
          "Content-Type": mimeType,
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
