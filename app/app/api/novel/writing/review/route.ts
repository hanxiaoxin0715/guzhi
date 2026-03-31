import { NextRequest, NextResponse } from "next/server";
import { reviewChapter, ReviewRequest } from "../../../../lib/ai/outlineGenerator";

export async function POST(req: NextRequest) {
  try {
    const body: ReviewRequest = await req.json();
    
    if (!body.content || !body.chapterTitle) {
      return NextResponse.json({ error: "Missing content or chapterTitle" }, { status: 400 });
    }

    const result = await reviewChapter(body);
    
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Chapter Review API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to generate chapter review" }, { status: 500 });
  }
}
