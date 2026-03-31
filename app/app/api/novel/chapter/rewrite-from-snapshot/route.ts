import { NextRequest, NextResponse } from "next/server";
import { generateChapterContent, type ChapterContentRequest } from "../../../../lib/ai/outlineGenerator";
import { auditChapterContinuity, reviseChapterByAudit } from "../../../../lib/ai/continuityPipeline";
import { extractMemoryFromChapter } from "../../../../lib/ai/memoryAgent";
import { generateTruthUpdatePatch } from "../../../../lib/ai/truthUpdater";
import {
  applyMemoriesToTruthFiles,
  applyTruthPatch,
  createTruthSnapshot,
  ensureTruthFiles,
  readTruthFile,
  restoreTruthSnapshot,
  withNovelWriteLock,
  type TruthFileName,
} from "../../../../lib/novelTruth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      projectId,
      snapshotId,
      updateTruth = true,
      ...rest
    } = body as ChapterContentRequest & { projectId?: string; snapshotId?: string; updateTruth?: boolean };

    if (!projectId || typeof projectId !== "string" || !snapshotId || typeof snapshotId !== "string") {
      return NextResponse.json({ error: "Missing projectId or snapshotId" }, { status: 400 });
    }
    if (!rest.chapterTitle || !rest.points || rest.points.length === 0) {
      return NextResponse.json({ error: "Missing chapter title or points" }, { status: 400 });
    }

    ensureTruthFiles(projectId);

    const truthExcerpt = (pid: string) => {
      const names: TruthFileName[] = [
        "current_state.md",
        "particle_ledger.md",
        "pending_hooks.md",
        "chapter_summaries.md",
        "subplot_board.md",
        "emotional_arcs.md",
        "character_matrix.md",
        "book_rules.md",
        "story_bible.md",
      ];
      const blocks: string[] = [];
      for (const n of names) {
        const raw = readTruthFile(pid, n).trim();
        if (!raw) continue;
        const cap = raw.length > 2500 ? raw.slice(0, 2500) + "\n…(截断)" : raw;
        blocks.push(`【${n}】\n${cap}`);
      }
      return blocks.join("\n\n");
    };

    const result = await withNovelWriteLock(projectId, async () => {
      createTruthSnapshot(projectId, `pre_restore_${rest.chapterTitle}`);
      restoreTruthSnapshot(projectId, snapshotId);
      createTruthSnapshot(projectId, `restored_${rest.chapterTitle}`);

      const truth = truthExcerpt(projectId);
      const enriched: ChapterContentRequest = {
        ...rest,
        novelContext: `${rest.novelContext || ""}\n\n【真相文件（唯一事实来源）】\n${truth}`,
        projectId,
      };

      const draftRes = await generateChapterContent(enriched);
      const draft = draftRes.content;

      let audit1 = await auditChapterContinuity({ projectId, chapterTitle: rest.chapterTitle, draft });
      let finalContent = draft;
      let revised = false;

      if (!audit1.pass) {
        finalContent = await reviseChapterByAudit({ chapterTitle: rest.chapterTitle, draft, audit: audit1 });
        revised = true;
        audit1 = await auditChapterContinuity({ projectId, chapterTitle: rest.chapterTitle, draft: finalContent });
      }

      if (updateTruth !== false) {
        const memories = await extractMemoryFromChapter(projectId, rest.chapterTitle, finalContent);
        const patch = await generateTruthUpdatePatch({ projectId, chapterTitle: rest.chapterTitle, chapterContent: finalContent });
        if (patch) applyTruthPatch({ projectId, chapterTitle: rest.chapterTitle, patch });
        else if (memories.length) applyMemoriesToTruthFiles({ projectId, chapterTitle: rest.chapterTitle, memories });
      }

      createTruthSnapshot(projectId, `after_rewrite_${rest.chapterTitle}`, { "chapter.txt": finalContent });
      return { content: finalContent, audit: audit1, revised, restoredSnapshotId: snapshotId };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Rewrite From Snapshot API Error:", error);
    return NextResponse.json({ error: error?.message || "Failed" }, { status: 500 });
  }
}
