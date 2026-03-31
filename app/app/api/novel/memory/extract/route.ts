import { NextRequest, NextResponse } from "next/server";
import { extractMemoryFromChapter } from "../../../../lib/ai/memoryAgent";
import { applyMemoriesToTruthFiles, ensureTruthFiles, withNovelWriteLock } from "../../../../lib/novelTruth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, chapterTitle, content } = body;
    
    if (!projectId || !chapterTitle || !content) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const memories = await extractMemoryFromChapter(projectId, chapterTitle, content);
    try {
      ensureTruthFiles(projectId);
      await withNovelWriteLock(projectId, async () => {
        if (memories.length) {
          applyMemoriesToTruthFiles({ projectId, chapterTitle, memories });
        }
        return null;
      });
    } catch {}
    
    return NextResponse.json({ memories });
  } catch (error: any) {
    console.error("Memory Extraction API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to extract memory" }, { status: 500 });
  }
}
