import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

// POST: Set config and scripts for testing
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === "import-script") {
      // Read a script file from the project root
      const { filename } = body;
      // Sanitize: only allow basename to prevent path traversal
      const safeFilename = path.basename(String(filename || ""));
      // standalone 部署时 cwd() 就是安装目录，开发时在 cwd()/..
      const candidates = [
        path.join(process.cwd(), safeFilename),
        path.join(process.cwd(), "..", safeFilename),
      ];
      const filePath = candidates.find(p => fs.existsSync(p));
      if (!filePath) {
        return NextResponse.json({ error: `File not found: ${filename}` }, { status: 404 });
      }
      const content = fs.readFileSync(filePath, "utf-8");
      return NextResponse.json({ content, filename });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "未知错误";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
