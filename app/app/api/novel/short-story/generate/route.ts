import { NextRequest, NextResponse } from "next/server";
import { generateShortStory, reviseShortStory, type ShortStoryRequest, type ShortStoryReviseRequest } from "../../../../lib/ai/outlineGenerator";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, ...data } = body;

    if (action === "revise") {
      const reviseData = data as ShortStoryReviseRequest;
      const result = await reviseShortStory(reviseData);
      return NextResponse.json({ success: true, content: result });
    }

    // 默认执行生成
    const storyData = data as ShortStoryRequest;
    
    if (!storyData.title || !storyData.description) {
      return NextResponse.json({ error: "缺少标题或梗概" }, { status: 400 });
    }

    if (!storyData.tags || storyData.tags.length === 0) {
      return NextResponse.json({ error: "请选择至少一个题材标签" }, { status: 400 });
    }

    const result = await generateShortStory({
      title: storyData.title,
      tags: storyData.tags,
      description: storyData.description,
      targetWordCount: storyData.targetWordCount || 5000,
      narrativeStructure: storyData.narrativeStructure || "standard",
      writingStyle: storyData.writingStyle || "standard"
    });

    return NextResponse.json({ 
      success: true, 
      content: result.content,
      wordCount: result.wordCount
    });
  } catch (error: any) {
    console.error("Short Story API Error:", error);
    return NextResponse.json({ error: error.message || "生成失败" }, { status: 500 });
  }
}
