/**
 * POST /api/scripts/import — 接收来自外部应用（如 AI 小说工作坊）的剧本导入
 *
 * Body: { title: string, desc: string, content: string, source?: string }
 * 
 * 将剧本写入 pending-scripts.json 文件，飞彩工作室前端会自动检测并导入到 IndexedDB。
 */
import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

const PENDING_FILE = join(process.cwd(), "pending-scripts.json");

interface PendingScript {
  id: string;
  title: string;
  desc: string;
  content: string;
  source: string;
  importedAt: number;
}

// CORS headers for cross-origin requests (novel workshop → feicai studio)
// 仅允许 localhost 来源，防止外部网站跨域注入脚本
function corsHeaders(request?: Request) {
  const origin = request?.headers?.get("origin") || "";
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : "http://localhost:5021";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, desc, content, source } = body;

    if (!title || !content) {
      return NextResponse.json(
        { error: "Missing required fields: title, content" },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    // Read existing pending scripts
    let pending: PendingScript[] = [];
    if (existsSync(PENDING_FILE)) {
      try {
        pending = JSON.parse(readFileSync(PENDING_FILE, "utf-8"));
      } catch { pending = []; }
    }

    // Add new script
    const newScript: PendingScript = {
      id: `novel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title || "未命名剧本",
      desc: desc || "来自 AI 小说工作坊",
      content,
      source: source || "novel-workshop",
      importedAt: Date.now(),
    };
    pending.push(newScript);

    // Write back
    writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2), "utf-8");

    return NextResponse.json(
      { success: true, id: newScript.id, message: `剧本「${newScript.title}」已发送到飞彩工作台` },
      { headers: corsHeaders(request) }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: msg },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}

// GET — 获取待导入列表 + 清除已导入
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");

    if (action === "clear") {
      // Clear all pending scripts
      if (existsSync(PENDING_FILE)) {
        writeFileSync(PENDING_FILE, "[]", "utf-8");
      }
      return NextResponse.json({ success: true }, { headers: corsHeaders(request) });
    }

    // Return pending scripts
    let pending: PendingScript[] = [];
    if (existsSync(PENDING_FILE)) {
      try {
        pending = JSON.parse(readFileSync(PENDING_FILE, "utf-8"));
      } catch { pending = []; }
    }
    return NextResponse.json({ pending }, { headers: corsHeaders(request) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { error: msg },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
