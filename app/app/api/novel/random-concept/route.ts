import { NextRequest, NextResponse } from "next/server";
import { generateRandomNovelConcept } from "../../../lib/ai/outlineGenerator";

export async function POST(req: NextRequest) {
  try {
    const data = await generateRandomNovelConcept();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error("Generate Random Concept API Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate random concept" },
      { status: 500 }
    );
  }
}
