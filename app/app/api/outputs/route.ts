import { NextResponse } from "next/server";
import { listOutputFiles, clearAllOutputFiles, readAllOutputFiles, writeOutputFile } from "@/app/lib/outputs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const files = listOutputFiles();
    return NextResponse.json(files);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}

/**
 * POST /api/outputs — Bulk read all output file contents (for archiving)
 */
export async function POST() {
  try {
    const files = readAllOutputFiles();
    return NextResponse.json(files);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}

/**
 * PUT /api/outputs — Bulk write output files (for restoring)
 * Body: { files: { name: string, content: string }[] }
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const files: { name: string; content: string }[] = body.files || [];
    let count = 0;
    for (const f of files) {
      if (f.name && f.content) {
        writeOutputFile(f.name, f.content);
        count++;
      }
    }
    return NextResponse.json({ restored: count });
  } catch {
    return NextResponse.json({ error: "恢复失败" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const count = clearAllOutputFiles();
    return NextResponse.json({ deleted: count });
  } catch {
    return NextResponse.json({ error: "清除失败" }, { status: 500 });
  }
}
