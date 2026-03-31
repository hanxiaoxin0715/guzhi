import { NextRequest, NextResponse } from "next/server";
import { generateGlobalPlan, GlobalPlan, OutlineRequest } from "../../../../lib/ai/outlineGenerator";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    const { title, tags, description, volumeCount, chaptersPerVolume, narrativeStructure, writingStyle } = body;

    if (!title || !description) {
      return NextResponse.json({ error: "缺少必要的输入信息" }, { status: 400 });
    }

    const request: OutlineRequest = {
      title: title.trim(),
      tags: Array.isArray(tags) ? tags : (tags || "").split(/[,，]/).map((t: string) => t.trim()).filter(Boolean),
      description: description.trim(),
      totalChapters: (Number(volumeCount) || 3) * (Number(chaptersPerVolume) || 10),
      narrativeStructure: narrativeStructure || "standard",
      writingStyle: writingStyle || "standard"
    };

    const globalPlan = await generateGlobalPlan(request);
    
    return NextResponse.json({ 
      success: true, 
      data: globalPlan
    });
  } catch (error: any) {
    console.error("Step2 API Error:", error);
    return NextResponse.json({ error: error.message || "核心设定生成失败" }, { status: 500 });
  }
}
