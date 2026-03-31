import { NextResponse, NextRequest } from "next/server";
import { readFileSync, existsSync, statSync, createReadStream } from "fs";
import { Readable } from "stream";
import { join } from "path";
import { getBaseOutputDir } from "@/app/lib/paths";

export const dynamic = "force-dynamic";

function getBaseDir() {
  return getBaseOutputDir();
}

/**
 * GET /api/local-file/[...path]
 * Serve a file directly from outputs/{category}/{filename}
 * E.g. /api/local-file/grid-images/nine-ep01-0  →  outputs/grid-images/nine-ep01-0.png
 *      /api/local-file/videos/video-ep01-1       →  outputs/videos/video-ep01-1.mp4
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const segments = (await params).path;
    if (!segments || segments.length < 2) {
      return NextResponse.json({ error: "Need category/key" }, { status: 400 });
    }

    const category = segments[0].replace(/[^a-zA-Z0-9_-]/g, "");
    const key = segments.slice(1).join("/").replace(/[^a-zA-Z0-9_\-\.]/g, "");
    const dir = join(getBaseDir(), category);

    // Try image extensions
    for (const ext of ["png", "jpg", "jpeg", "webp"]) {
      const filePath = join(dir, `${key}.${ext}`);
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

    // Try video extensions (with Range request support for <video> element)
    for (const ext of ["mp4", "webm", "mov"]) {
      const filePath = join(dir, `${key}.${ext}`);
      if (existsSync(filePath)) {
        const mimeType = ext === "mov" ? "video/quicktime" : `video/${ext}`;
        const stat = statSync(filePath);
        const total = stat.size;
        const rangeHeader = _request.headers.get("range");

        if (rangeHeader) {
          // Range request: 流式读取指定字节范围，避免将整个视频加载到内存
          const parts = rangeHeader.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
          const chunkSize = end - start + 1;
          const nodeStream = createReadStream(filePath, { start, end });
          const webStream = Readable.toWeb(nodeStream) as ReadableStream;
          return new NextResponse(webStream, {
            status: 206,
            headers: {
              "Content-Range": `bytes ${start}-${end}/${total}`,
              "Accept-Ranges": "bytes",
              "Content-Length": String(chunkSize),
              "Content-Type": mimeType,
              "Cache-Control": "public, max-age=86400",
            },
          });
        }

        // Full response: 流式读取，避免大视频文件 OOM
        const nodeStream = createReadStream(filePath);
        const webStream = Readable.toWeb(nodeStream) as ReadableStream;
        return new NextResponse(webStream, {
          headers: {
            "Content-Type": mimeType,
            "Content-Length": String(total),
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }
    }

    return NextResponse.json({ error: "File not found" }, { status: 404 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
