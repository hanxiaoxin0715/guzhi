/**
 * GET  /api/config/path  — Read current path configuration
 * POST /api/config/path  — Save new path configuration
 *
 * The config is persisted to feicai-paths.json inside feicai-studio/.
 */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  getPathConfig,
  savePathConfig,
  getConfigFilePath,
  getDefaultBase,
} from "@/app/lib/paths";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getPathConfig();
    return NextResponse.json({
      baseOutputDir: config.baseOutputDir,
      configFile: getConfigFilePath(),
      defaultBase: getDefaultBase(),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { baseOutputDir } = body as { baseOutputDir?: string };

    if (!baseOutputDir || typeof baseOutputDir !== "string" || !baseOutputDir.trim()) {
      return NextResponse.json({ error: "baseOutputDir 不能为空" }, { status: 400 });
    }

    const resolved = path.resolve(baseOutputDir.trim());

    // Try to create the directory if it doesn't exist
    try {
      if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true });
      }
    } catch (mkErr: unknown) {
      const msg = mkErr instanceof Error ? mkErr.message : String(mkErr);
      return NextResponse.json(
        { error: `无法创建目录: ${msg}` },
        { status: 400 }
      );
    }

    // Validate writable by creating a temp file
    const testFile = path.join(resolved, ".feicai-write-test");
    try {
      fs.writeFileSync(testFile, "test", "utf-8");
      fs.unlinkSync(testFile);
    } catch (wErr: unknown) {
      const msg = wErr instanceof Error ? wErr.message : String(wErr);
      return NextResponse.json(
        { error: `目录不可写: ${msg}` },
        { status: 400 }
      );
    }

    // Save config
    savePathConfig({ baseOutputDir: resolved });

    // Also ensure common sub-directories exist
    for (const sub of ["ref-images", "grid-images", "videos", "video-frames"]) {
      const subDir = path.join(resolved, sub);
      if (!fs.existsSync(subDir)) {
        fs.mkdirSync(subDir, { recursive: true });
      }
    }

    return NextResponse.json({
      success: true,
      baseOutputDir: resolved,
      message: "路径配置已保存",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
