import { NextRequest, NextResponse } from "next/server";
import { generateAIAssist, AIAssistRequest } from "../../../../lib/ai/outlineGenerator";

export async function POST(req: NextRequest) {
  try {
    const body: AIAssistRequest = await req.json();
    
    if (!body.content || !body.action) {
      return NextResponse.json({ error: "Missing content or action" }, { status: 400 });
    }

    const result = await generateAIAssist(body);
    
    return NextResponse.json({ result: result.result });
  } catch (error: any) {
    console.error("AI Assist API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to process AI assist" }, { status: 500 });
  }
}
