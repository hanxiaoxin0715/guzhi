/**
 * 剧本章节解析共享模块
 * 从 scripts/page.tsx 提取，供 scripts 页面和 pipeline 页面共用
 */

// ── 章节结构类型 ──

export interface ParsedChapter {
  id: string;        // e.g. "ch-0", "ch-1"
  volume: string;    // 卷名 (from "卷名 · 章节" pattern)
  title: string;     // 章节标题
  fullTitle: string;  // 完整的 ## 标题
  content: string;   // 章节正文 (不含标题行)
  wordCount: number;
  startLine: number;
}

export interface ParsedVolume {
  name: string;
  chapters: ParsedChapter[];
}

/**
 * 解析剧本/小说内容，提取卷·章结构。
 * 支持的格式：
 * 1. "## 卷名 · 章节名" (小说工坊导出格式)
 * 2. "## 场景一 · xxx" (原始剧本格式)  
 * 3. "## 第X章 标题" (通用格式)
 * 4. 以 --- 分隔的多章节 (通用分隔)
 * 5. 中文数字章节如 "## 第一章 xxx"
 * 6. 纯文本 "第X章 标题" / "第一章 标题" (无 ## 前缀)
 * 7. 纯文本 "第X回/节/集 标题"
 * 8. 纯文本 "第X卷 卷名" (作为卷标记)
 * 9. "Chapter X title" (英文格式)
 */
// 匹配中文章节标题的正则
const RAW_CHAPTER_RE = /^第([一二三四五六七八九十百千万零〇\d]+)([章回节集])\s*(.*)/;
const RAW_VOLUME_RE = /^第([一二三四五六七八九十百千万零〇\d]+)卷\s*(.*)/;
const ENGLISH_CHAPTER_RE = /^Chapter\s+(\d+)[.:：\s]\s*(.*)/i;

export function parseChapters(content: string): { volumes: ParsedVolume[]; chapters: ParsedChapter[] } {
  const lines = content.split("\n");
  const chapters: ParsedChapter[] = [];
  let currentTitle = "";
  let currentVolume = "";
  let currentContent: string[] = [];
  let currentStartLine = 0;
  let chIdx = 0;
  // Buffer for content that appeared before the first chapter heading
  let preambleContent: string[] = [];
  let hasFoundFirstChapter = false;

  function flushChapter() {
    // Only create chapter entries for content that has a proper heading title
    if (!currentTitle) {
      // No heading → store as preamble or merge into previous chapter
      if (chapters.length > 0) {
        // Append orphan content to the previous chapter
        const prev = chapters[chapters.length - 1];
        const extra = currentContent.join("\n").trim();
        if (extra) {
          prev.content = prev.content + "\n\n" + extra;
          prev.wordCount = prev.content.replace(/\s/g, "").length;
        }
      } else {
        // Content before first heading — save as preamble
        preambleContent.push(...currentContent);
      }
      return;
    }
    const text = currentContent.join("\n").trim();
    // For the first real chapter, prepend any preamble content
    const fullText = (!hasFoundFirstChapter && preambleContent.length > 0)
      ? preambleContent.join("\n").trim() + (text ? "\n\n" + text : "")
      : text;
    hasFoundFirstChapter = true;
    preambleContent = [];
    chapters.push({
      id: `ch-${chIdx++}`,
      volume: currentVolume,
      title: currentTitle,
      fullTitle: currentTitle,
      content: fullText,
      wordCount: fullText.replace(/\s/g, "").length,
      startLine: currentStartLine,
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect ## heading as chapter boundary
    if (trimmed.startsWith("## ")) {
      flushChapter();
      const heading = trimmed.slice(3).trim();
      // Try to split "卷名 · 章节名" or "卷名·章节名"
      const dotSplit = heading.match(/^(.+?)\s*[·・]\s*(.+)$/);
      if (dotSplit) {
        currentVolume = dotSplit[1].trim();
        currentTitle = dotSplit[2].trim();
      } else {
        currentTitle = heading;
        // Keep previous volume if any
      }
      currentContent = [];
      currentStartLine = i;
      continue;
    }

    // --- separator: skip it (not treated as chapter boundary; only ## headings create chapters)
    if (trimmed === "---" || trimmed === "***" || trimmed === "* * *") {
      continue;
    }

    // 检测纯文本章节标题 (无 ## 前缀): 第X章/回/节/集 标题
    const rawChM = trimmed.match(RAW_CHAPTER_RE);
    if (rawChM) {
      flushChapter();
      const numPart = rawChM[1];
      const typePart = rawChM[2]; // 章/回/节/集
      const titlePart = rawChM[3]?.trim() || "";
      currentTitle = `第${numPart}${typePart}${titlePart ? " " + titlePart : ""}`;
      currentContent = [];
      currentStartLine = i;
      continue;
    }

    // 检测纯文本卷标记: 第X卷 卷名
    const rawVolM = trimmed.match(RAW_VOLUME_RE);
    if (rawVolM) {
      flushChapter();
      const volTitle = rawVolM[2]?.trim() || "";
      currentVolume = `第${rawVolM[1]}卷${volTitle ? " " + volTitle : ""}`;
      currentTitle = "";
      currentContent = [];
      currentStartLine = i + 1;
      continue;
    }

    // 英文 Chapter 格式
    const engChM = trimmed.match(ENGLISH_CHAPTER_RE);
    if (engChM) {
      flushChapter();
      currentTitle = `Chapter ${engChM[1]}${engChM[2] ? " " + engChM[2].trim() : ""}`;
      currentContent = [];
      currentStartLine = i;
      continue;
    }

    // Skip # top-level title (book title) — treat as volume marker
    if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
      flushChapter();
      currentVolume = trimmed.slice(2).trim();
      currentTitle = "";
      currentContent = [];
      currentStartLine = i + 1;
      continue;
    }

    currentContent.push(line);
  }
  // Flush last chapter
  flushChapter();

  // Group by volume
  const volumeMap = new Map<string, ParsedChapter[]>();
  for (const ch of chapters) {
    const vol = ch.volume || "全文";
    if (!volumeMap.has(vol)) volumeMap.set(vol, []);
    volumeMap.get(vol)!.push(ch);
  }
  const volumes: ParsedVolume[] = Array.from(volumeMap.entries()).map(([name, chs]) => ({
    name,
    chapters: chs,
  }));

  return { volumes, chapters };
}
