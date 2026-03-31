import { NextRequest, NextResponse } from "next/server";
import { getPathConfig, savePathConfig, getDefaultBase } from "@/app/lib/paths";

export async function GET() {
  try {
    const config = getPathConfig();
    return NextResponse.json({ 
      path: config.baseOutputDir,
      defaultPath: getDefaultBase()
    });
  } catch (e) {
    return NextResponse.json({ error: "Failed to load path config" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { path } = await req.json();
    if (path && typeof path === "string") {
      savePathConfig({ baseOutputDir: path });
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: "Failed to save path config" }, { status: 500 });
  }
}