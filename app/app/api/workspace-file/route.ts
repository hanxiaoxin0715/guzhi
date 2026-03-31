/**
 * /api/workspace-file — 工作区 KV 数据磁盘镜像 API
 *
 * 每个 KV key 对应一个独立的 JSON 文件：outputs/workspace/{key}.json
 * 文件之间完全独立，互不影响。
 *
 * GET  ?key=xxx          → 读取单个文件
 * GET  ?list=1           → 列出所有 workspace 文件
 * POST { key, value }    → 写入/更新文件
 * DELETE ?key=xxx        → 删除单个文件
 * DELETE ?prefix=xxx     → 删除所有匹配前缀的文件
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getBaseOutputDir } from "@/app/lib/paths";

function getWorkspaceDir(): string {
  return path.join(getBaseOutputDir(), "workspace");
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** 把 KV key 映射为安全文件名（保留字母数字和连字符） */
function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_\-]/g, "_");
}

function getFilePath(key: string): string {
  return path.join(getWorkspaceDir(), `${sanitizeKey(key)}.json`);
}

// ── GET: 读取单个 workspace 文件 或 列出所有文件 ──
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  const list = req.nextUrl.searchParams.get("list");

  if (list) {
    const dir = getWorkspaceDir();
    if (!fs.existsSync(dir)) return NextResponse.json({ files: [] });
    const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
    return NextResponse.json({
      files: files.map(f => f.replace(/\.json$/, "")),
    });
  }

  if (!key) {
    return NextResponse.json({ error: "missing key" }, { status: 400 });
  }

  const fp = getFilePath(key);
  if (!fs.existsSync(fp)) return NextResponse.json({ value: null });

  try {
    const raw = fs.readFileSync(fp, "utf-8");
    return NextResponse.json({ value: raw });
  } catch {
    return NextResponse.json({ value: null });
  }
}

// ── POST: 写入/更新 workspace 文件 ──
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { key, value } = body;
    if (!key || typeof key !== "string") {
      return NextResponse.json({ error: "missing key" }, { status: 400 });
    }

    const dir = getWorkspaceDir();
    ensureDir(dir);

    const fp = getFilePath(key);

    // value 为空或明确清除时删除文件
    if (value === null || value === undefined || value === "") {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      return NextResponse.json({ ok: true, action: "deleted" });
    }

    // Pretty-print if valid JSON, else write raw
    let content: string;
    try {
      const parsed = JSON.parse(value);
      content = JSON.stringify(parsed, null, 2);
    } catch {
      content = String(value);
    }

    fs.writeFileSync(fp, content, "utf-8");
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[workspace-file] POST error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ── DELETE: 删除单个文件 或 按前缀批量删除 ──
export async function DELETE(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  const prefix = req.nextUrl.searchParams.get("prefix");

  const dir = getWorkspaceDir();
  if (!fs.existsSync(dir)) return NextResponse.json({ deleted: 0 });

  if (key) {
    const fp = getFilePath(key);
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
      return NextResponse.json({ deleted: 1 });
    }
    return NextResponse.json({ deleted: 0 });
  }

  if (prefix) {
    const sanitized = sanitizeKey(prefix);
    const files = fs.readdirSync(dir).filter(f => f.startsWith(sanitized) && f.endsWith(".json"));
    let deleted = 0;
    for (const f of files) {
      try {
        fs.unlinkSync(path.join(dir, f));
        deleted++;
      } catch { /* skip */ }
    }
    return NextResponse.json({ deleted });
  }

  return NextResponse.json({ error: "missing key or prefix" }, { status: 400 });
}
