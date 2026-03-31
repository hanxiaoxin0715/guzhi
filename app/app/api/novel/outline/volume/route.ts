import { NextRequest, NextResponse } from "next/server";
import { generateChaptersForVolume, VolumeGenerationRequest } from "../../../../lib/ai/outlineGenerator";

export async function POST(req: NextRequest) {
  try {
    const body: VolumeGenerationRequest = await req.json();
    
    if (!body.title || !body.volumeTitle || !body.globalPlan) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const chapters = await generateChaptersForVolume(body);
    
    return NextResponse.json({ chapters });
  } catch (error: any) {
    console.error("Volume Chapters API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to generate volume chapters" }, { status: 500 });
  }
}
