/**
 * GET /api/seedance/video-proxy?url=...
 * 代理即梦 CDN 视频流，绕过 CORS 限制
 */

import { NextRequest, NextResponse } from "next/server";
import { FAKE_HEADERS } from "@/app/lib/seedance/types";

export async function GET(request: NextRequest) {
  const videoUrl = request.nextUrl.searchParams.get("url");

  if (!videoUrl) {
    return NextResponse.json({ error: "缺少 url 参数" }, { status: 400 });
  }

  // SSRF 防护：仅允许即梦/字节 CDN 域名
  const ALLOWED_HOSTS = ["byteimg.com", "volccdn.com", "jianying.com", "bytecdn.cn", "ibytedtos.com"];
  try {
    const parsedUrl = new URL(videoUrl);
    if (!ALLOWED_HOSTS.some(h => parsedUrl.hostname.endsWith(h))) {
      return NextResponse.json({ error: "不允许的视频来源域名" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "无效的 URL" }, { status: 400 });
  }

  try {
    console.log(`[video-proxy] 代理视频: ${videoUrl.substring(0, 100)}...`);

    const response = await fetch(videoUrl, {
      headers: {
        "User-Agent": FAKE_HEADERS["User-Agent"],
        Referer: "https://jimeng.jianying.com/",
      },
    });

    if (!response.ok) {
      console.error(`[video-proxy] 上游错误: ${response.status}`);
      return NextResponse.json(
        { error: `视频获取失败: ${response.status}` },
        { status: response.status },
      );
    }

    // 构建响应头
    const headers = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    const contentLength = response.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "public, max-age=3600");

    // 流式转发视频数据
    return new NextResponse(response.body, {
      status: 200,
      headers,
    });
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`[video-proxy] 错误: ${err.message}`);
    return NextResponse.json({ error: "视频代理失败" }, { status: 500 });
  }
}
