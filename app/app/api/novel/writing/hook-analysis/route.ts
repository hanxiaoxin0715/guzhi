import { NextRequest, NextResponse } from "next/server";
import { analyzeHook, HookAnalysisRequest } from "../../../../lib/ai/outlineGenerator";

export async function POST(req: NextRequest) {
  try {
    const body: HookAnalysisRequest = await req.json();
    
    if (!body.content || !body.chapterTitle) {
      return NextResponse.json({ error: "Missing content or chapterTitle" }, { status: 400 });
    }

    const result = await analyzeHook(body);
    
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Hook Analysis API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to analyze hook" }, { status: 500 });
  }
}
