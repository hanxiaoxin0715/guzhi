/**
 * 活跃项目 ID 磁盘同步 API — 项目隔离核心
 *
 * PUT  /api/active-project  { projectId: "proj_xxx" | null }  → 设置/清除活跃项目
 * GET  /api/active-project                                     → 读取当前活跃项目 ID
 *
 * 活跃项目 ID 决定 grid-images/ 下使用哪个子目录，
 * 确保不同项目的宫格图片在磁盘上完全隔离。
 */
import { NextResponse } from "next/server";
import {
  getActiveProjectFileId,
  setActiveProjectFileId,
  clearActiveProjectFileId,
} from "@/app/lib/paths";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { projectId } = body;

    if (projectId && typeof projectId === "string") {
      // 安全检查：只接受合法字符
      const safe = projectId.replace(/[^a-zA-Z0-9_\-]/g, "");
      if (!safe) {
        return NextResponse.json(
          { error: "Invalid projectId: contains only illegal characters" },
          { status: 400 }
        );
      }
      setActiveProjectFileId(safe);
      return NextResponse.json({ success: true, projectId: safe });
    }

    // projectId 为 null/undefined/空 → 清除
    clearActiveProjectFileId();
    return NextResponse.json({ success: true, projectId: "_default" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  try {
    const projectId = getActiveProjectFileId();
    return NextResponse.json({ projectId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
