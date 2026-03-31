import { NextRequest, NextResponse } from "next/server";
import { generateAIChat, AIChatRequest } from "@/app/lib/ai/outlineGenerator";

export async function POST(req: NextRequest) {
  try {
    const body: AIChatRequest = await req.json();
    
    if (!body.prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    const result = await generateAIChat(body);
    
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("AI Chat API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to process AI chat" }, { status: 500 });
  }
}
