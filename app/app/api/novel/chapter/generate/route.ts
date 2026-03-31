import { NextRequest, NextResponse } from "next/server";
import { generateChapterContent, ChapterContentRequest } from "../../../../lib/ai/outlineGenerator";
import { applyMemoriesToTruthFiles, applyTruthPatch, createTruthSnapshot, ensureTruthFiles, readTruthFile, withNovelWriteLock, type TruthFileName } from "../../../../lib/novelTruth";
import { auditChapterContinuity, reviseChapterByAudit } from "../../../../lib/ai/continuityPipeline";
import { extractMemoryFromChapter } from "../../../../lib/ai/memoryAgent";
import { generateTruthUpdatePatch } from "../../../../lib/ai/truthUpdater";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      projectId,
      audit = true,
      updateTruth = true,
      truthMode,
      createSnapshots = true,
      memoryEnhance = true,
      targetWordCount,
      ...rest
    } = body as ChapterContentRequest & { projectId?: string; audit?: boolean; updateTruth?: boolean; truthMode?: "patch" | "heuristic"; createSnapshots?: boolean; memoryEnhance?: boolean; targetWordCount?: number };
    
    if (!rest.chapterTitle || !rest.points || rest.points.length === 0) {
      return NextResponse.json({ error: "Missing chapter title or points" }, { status: 400 });
    }

    // 将设置参数添加到请求中
    if (memoryEnhance !== undefined) {
      (rest as any).memoryEnhance = memoryEnhance;
    }
    if (targetWordCount) {
      (rest as any).targetWordCount = targetWordCount;
    }

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

    if (!projectId || typeof projectId !== "string" || audit === false) {
      const result = await generateChapterContent(rest);
      
      if (!projectId || typeof projectId !== "string" || updateTruth === false) {
        return NextResponse.json({ content: result.content });
      }

      // 更新真相文件（仅此部分加锁）
      ensureTruthFiles(projectId);
      const mode: "patch" | "heuristic" = truthMode || "heuristic";
      
      // 先在锁外提取记忆，减少锁持有时间
      let memories: any[] = [];
      try {
        memories = await extractMemoryFromChapter(projectId, rest.chapterTitle, result.content);
      } catch (e) {
        console.warn("[Memory] Failed to extract memory outside lock:", e);
      }

      const updated = await withNovelWriteLock(projectId, async () => {
        if (createSnapshots) createTruthSnapshot(projectId, `before_${rest.chapterTitle}`, { "draft.txt": "" });
        try {
          if (mode === "patch") {
            const patch = await generateTruthUpdatePatch({ projectId, chapterTitle: rest.chapterTitle, chapterContent: result.content });
            if (patch) applyTruthPatch({ projectId, chapterTitle: rest.chapterTitle, patch });
            else if (memories.length) applyMemoriesToTruthFiles({ projectId, chapterTitle: rest.chapterTitle, memories });
          } else {
            if (memories.length) applyMemoriesToTruthFiles({ projectId, chapterTitle: rest.chapterTitle, memories });
          }
        } catch (e) {
          console.error("[Truth] Failed to update truth in lock:", e);
        }
        if (createSnapshots) createTruthSnapshot(projectId, `after_${rest.chapterTitle}`, { "chapter.txt": result.content });
        return true;
      });
      return NextResponse.json({ content: result.content, updated });
    }

    // ── 带审计的生成流程 ──
    ensureTruthFiles(projectId);
    
    // 1. 在锁外读取真相内容作为上下文
    const truth = truthExcerpt(projectId);
    const enriched: ChapterContentRequest = {
      ...rest,
      novelContext: `${rest.novelContext || ""}\n\n【真相文件（唯一事实来源）】\n${truth}`,
      projectId,
    };

    // 2. 在锁外进行 AI 生成、审计与修订
    if (createSnapshots) {
      await withNovelWriteLock(projectId, async () => {
        createTruthSnapshot(projectId, `before_${rest.chapterTitle}`, { "draft.txt": "" });
      });
    }

    const draftRes = await generateChapterContent(enriched);
    const draft = draftRes.content;

    let audit1 = await auditChapterContinuity({ projectId, chapterTitle: rest.chapterTitle, draft });
    let finalContent = draft;
    let revised = false;

    if (!audit1.pass) {
      finalContent = await reviseChapterByAudit({ chapterTitle: rest.chapterTitle, draft, audit: audit1 });
      revised = true;
      // 修订后再审计一次
      const audit2 = await auditChapterContinuity({ projectId, chapterTitle: rest.chapterTitle, draft: finalContent });
      audit1 = audit2;
    }

    // 3. 在锁外提取记忆
    let memories: any[] = [];
    if (updateTruth !== false) {
      try {
        memories = await extractMemoryFromChapter(projectId, rest.chapterTitle, finalContent);
      } catch {}
    }

    // 4. 仅在最后更新真相文件时加锁
    const updateSuccess = await withNovelWriteLock(projectId, async () => {
      if (updateTruth !== false) {
        const mode: "patch" | "heuristic" = truthMode || "patch";
        if (mode === "patch") {
          const patch = await generateTruthUpdatePatch({ projectId, chapterTitle: rest.chapterTitle, chapterContent: finalContent });
          if (patch) applyTruthPatch({ projectId, chapterTitle: rest.chapterTitle, patch });
          else if (memories.length) applyMemoriesToTruthFiles({ projectId, chapterTitle: rest.chapterTitle, memories });
        } else {
          if (memories.length) applyMemoriesToTruthFiles({ projectId, chapterTitle: rest.chapterTitle, memories });
        }
      }
      if (createSnapshots) createTruthSnapshot(projectId, `after_${rest.chapterTitle}`, { "chapter.txt": finalContent });
      return true;
    });

    return NextResponse.json({ content: finalContent, audit: audit1, revised, updated: updateSuccess });
  } catch (error: any) {
    console.error("Chapter Content API Error:", error);
    return NextResponse.json({ error: error.message || "Failed to generate chapter content" }, { status: 500 });
  }
}
