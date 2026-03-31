import { NextRequest, NextResponse } from "next/server";
import { generateNovelOutline, OutlineRequest, GeneratedVolume } from "../../../../lib/ai/outlineGenerator";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    const { 
      title, 
      tags, 
      description, 
      volumeCount, 
      chaptersPerVolume, 
      narrativeStructure,
      writingStyle,
      globalPlan 
    } = body;

    if (!title || !description) {
      return NextResponse.json({ error: "缺少必要的输入信息" }, { status: 400 });
    }

    const totalChapters = (Number(volumeCount) || 3) * (Number(chaptersPerVolume) || 10);

    const request: OutlineRequest = {
      title: title.trim(),
      tags: Array.isArray(tags) ? tags : (tags || "").split(/[,，]/).map((t: string) => t.trim()).filter(Boolean),
      description: description.trim(),
      totalChapters: totalChapters,
      volumeCount: Number(volumeCount) || 3,
      chaptersPerVolume: Number(chaptersPerVolume) || 10,
      narrativeStructure: narrativeStructure || "standard",
      writingStyle: writingStyle || "standard",
      globalPlan: typeof globalPlan === 'string' ? globalPlan : JSON.stringify(globalPlan)
    };

    const outline = await generateNovelOutline(request);
    
    return NextResponse.json({ 
      success: true, 
      data: {
        outline,
        summary: {
          volumeCount: Number(volumeCount) || outline.length,
          chaptersPerVolume: Number(chaptersPerVolume) || 10,
          totalChapters: outline.reduce((acc, vol) => acc + vol.chapters.length, 0)
        }
      }
    });
  } catch (error: any) {
    console.error("Step3 API Error:", error);
    return NextResponse.json({ error: error.message || "详细大纲生成失败" }, { status: 500 });
  }
}
