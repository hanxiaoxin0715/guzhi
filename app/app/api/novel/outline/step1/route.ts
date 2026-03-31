import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    const { title, tags, description, volumeCount, chaptersPerVolume, narrativeStructure, writingStyle } = body;

    if (!title || !description) {
      return NextResponse.json({ error: "请填写小说标题和故事梗概" }, { status: 400 });
    }

    if (title.length < 2) {
      return NextResponse.json({ error: "标题至少需要2个字符" }, { status: 400 });
    }

    if (description.length < 10) {
      return NextResponse.json({ error: "故事梗概至少需要10个字符" }, { status: 400 });
    }

    const volumes = Number(volumeCount) || 3;
    const chapters = Number(chaptersPerVolume) || 10;
    const totalChapters = volumes * chapters;

    if (volumes < 1 || volumes > 20) {
      return NextResponse.json({ error: "分卷数应在1-20之间" }, { status: 400 });
    }

    if (chapters < 1 || chapters > 100) {
      return NextResponse.json({ error: "每卷章节数应在1-100之间" }, { status: 400 });
    }

    const summaryInfo = {
      title: title.trim(),
      tags: Array.isArray(tags) ? tags : (tags || "").split(/[,，]/).map((t: string) => t.trim()).filter(Boolean),
      description: description.trim(),
      volumeCount: volumes,
      chaptersPerVolume: chapters,
      totalChapters: totalChapters,
      narrativeStructure: narrativeStructure || "standard",
      writingStyle: writingStyle || "standard",
      estimatedWords: totalChapters * 3000
    };

    return NextResponse.json({ 
      success: true, 
      data: summaryInfo,
      message: "基础信息验证通过"
    });
  } catch (error: any) {
    console.error("Step1 API Error:", error);
    return NextResponse.json({ error: error.message || "验证失败" }, { status: 500 });
  }
}
