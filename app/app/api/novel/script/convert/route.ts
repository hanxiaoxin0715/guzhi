import { NextRequest, NextResponse } from "next/server";
import { generateStoryboardScript, StoryboardScriptRequest } from "../../../../lib/ai/outlineGenerator";

export async function POST(req: NextRequest) {
  try {
    const body: StoryboardScriptRequest = await req.json();
    
    if (!body.content || !body.title) {
      return NextResponse.json({ error: "Missing content or title" }, { status: 400 });
    }

    const result = await generateStoryboardScript(body);
    
    return NextResponse.json({ scenes: result.scenes });
  } catch (error: any) {
    console.error("Storyboard Script API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to convert script" }, { status: 500 });
  }
}
