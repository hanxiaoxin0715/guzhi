import { NextResponse } from "next/server";
import { getWorkspaceConfig } from "@/app/lib/workspace";

export async function GET() {
  try {
    const config = await getWorkspaceConfig();
    const hasKey = !!(config.ANALYST_API_KEY || config.GEMINI_API_KEY || config.CHAT_API_KEY);
    return NextResponse.json({ configured: hasKey });
  } catch (e) {
    return NextResponse.json({ configured: false });
  }
}
