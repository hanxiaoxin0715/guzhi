import { getAIClientForRole, getNovelStyleConstraints } from "./outlineGenerator";
import { readTruthFile, TruthFileName } from "../novelTruth";
import path from "path";
import fs from "fs";
import { getBaseOutputDir } from "../paths";

export interface ContinuityIssue {
  level: "critical" | "warning";
  category: string;
  message: string;
  evidence?: string;
  suggestion?: string;
}

export interface ContinuityAudit {
  pass: boolean;
  issues: ContinuityIssue[];
  vocabFatigue: { phrase: string; count: number }[];
}

function stripCodeFences(s: string): string {
  return s.replace(/```[\s\S]*?```/g, (m) => m.replace(/^```[a-zA-Z]*\s*/i, "").replace(/```$/i, "")).trim();
}

function extractJsonObject(text: string): string | null {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return text.slice(firstBrace, lastBrace + 1).trim();
  return null;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const next = haystack.indexOf(needle, idx);
    if (next === -1) break;
    count++;
    idx = next + needle.length;
  }
  return count;
}

function loadConfig(key: string): string | null {
  try {
    const safeKey = key.replace(/[^a-zA-Z0-9_\-]/g, "_");
    const workspaceDir = path.join(getBaseOutputDir(), "workspace");
    const fp = path.join(workspaceDir, `${safeKey}.json`);
    if (fs.existsSync(fp)) {
      const content = fs.readFileSync(fp, "utf-8").trim();
      return content;
    }
  } catch (e) {
    console.warn(`[Config] Failed to load ${key}:`, e);
  }
  return null;
}

export function detectVocabFatigue(content: string): { phrase: string; count: number }[] {
  const phrases = [
    // 旧词表
    "随着",
    "只见",
    "不由得",
    "顿时",
    "刹那间",
    "下一步",
    "就在这时",
    "与此同时",
    "紧接着",
    "然而",
    "可就在",
    "仿佛",
    "似乎",
    "仿若",
    "不禁",
    "微微",
    // 新增：去AI味禁用词
    "首先",
    "然后",
    "接下来",
    "最终",
    "最后",
    "于是",
    "因此",
    "所以",
    "不料",
    "不过",
    "但是",
    "但见",
    "但见那",
    "就在此时",
    "就在此刻",
    "不一会儿",
    "没过多久",
    "片刻之后",
    "心中想到",
    "心里暗暗想到",
    "心说",
    "不由得",
    "不自觉地",
  ];
  const hits = phrases
    .map((p) => ({ phrase: p, count: countOccurrences(content, p) }))
    .filter((x) => x.count >= 3)
    .sort((a, b) => b.count - a.count);
  return hits.slice(0, 15);
}

function buildTruthContext(projectId: string): string {
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
  for (const name of names) {
    const raw = readTruthFile(projectId, name);
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const cap = trimmed.length > 6000 ? trimmed.slice(0, 6000) + "\n…(截断)" : trimmed;
    blocks.push(`【${name}】\n${cap}`);
  }
  return blocks.join("\n\n");
}

export async function auditChapterContinuity(args: {
  projectId: string;
  chapterTitle: string;
  draft: string;
}): Promise<ContinuityAudit> {
  const vocabFatigue = detectVocabFatigue(args.draft);
  const client = await getAIClientForRole("analyst");
  const truth = buildTruthContext(args.projectId);

  // 尝试加载自定义审计提示词
  const customAuditPrompt = loadConfig("NOVEL_AUDIT_PROMPT");

  let prompt: string;
  if (customAuditPrompt) {
    // 使用新的33维度审计提示词
    prompt = customAuditPrompt
      .replace(/{{chapterContent}}/g, args.draft)
      .replace(/{{truthFiles}}/g, truth || "（暂无真相文件内容）");
  } else {
    // 使用旧的审计提示词（向后兼容）
    prompt = `你是一位"连续性审计员"，专门查错长篇网文的设定、自洽、信息边界、人物言行与资源账本。

你会收到：
1) 真相文件：唯一事实来源
2) 本章草稿：可能存在幻觉、穿帮，信息泄漏

任务：找出草稿与真相文件的冲突、缺口、和潜在读者出戏点，并给出可执行的修复建议。

【审计重点】
- 世界状态：地点/时间/人物在场关系/伤势/修为/立场是否跳变
- 资源账本：物品/钱财/消耗是否凭空出现或无限背包
- 伏笔：是否断裂、重复承诺、或提前泄露
- 信息边界：角色是否知道他们没见过/没听过的事（反信息泄漏）
- 前后矛盾：称谓/能力/因果链/动机
 - 人物一致性：台词口吻/习惯/情绪变化是否符合人设与关系（师徒/上下级/仇敌）
 - 情节推进：本章是否按"冲突引入→升级→兑现/反转→钩子"推进，是否存在注水与无意义段落

【输出要求】
只输出一个 JSON 对象，不要输出任何多余文字或 Markdown。

JSON 结构：
{
  "pass": true,
  "issues": [
    {
      "level": "critical",
      "category": "resource|knowledge|state|timeline|hook|character|plot|style|other",
      "message": "问题描述",
      "evidence": "草稿中相关句子片段",
      "suggestion": "修复方式（可直接改句/补一句/删一句）"
    }
  ]
}

判定规则：
- 只要存在会导致后续连锁崩塌的矛盾，pass 必须为 false，并至少给 1 条 critical。
- issues 控制在 3-12 条，优先列最关键的。

【真相文件】
${truth || "（暂无真相文件内容）"}

【本章草稿】
标题：${args.chapterTitle}
正文：
${args.draft}
`;
  }

  try {
    const text = await client.generateContent(prompt);
    const jsonStr = extractJsonObject(text) || stripCodeFences(text);
    const parsed = JSON.parse(jsonStr);
    const issues: ContinuityIssue[] = Array.isArray(parsed.issues)
      ? parsed.issues.map((i: any) => ({
          level: i.level === "critical" ? "critical" : "warning",
          category: typeof i.category === "string" ? i.category : "other",
          message: typeof i.message === "string" ? i.message : "",
          evidence: typeof i.evidence === "string" ? i.evidence : undefined,
          suggestion: typeof i.suggestion === "string" ? i.suggestion : undefined,
        }))
      : [];
    const pass = typeof parsed.pass === "boolean" ? parsed.pass : issues.every((i) => i.level !== "critical");
    return { pass, issues, vocabFatigue };
  } catch {
    const issues: ContinuityIssue[] = [
      {
        level: "warning",
        category: "other",
        message: "连续性审计解析失败，建议手动复核设定与资源一致性",
      },
    ];
    return { pass: true, issues, vocabFatigue };
  }
}

export async function reviseChapterByAudit(args: {
  chapterTitle: string;
  draft: string;
  audit: ContinuityAudit;
}): Promise<string> {
  const client = await getAIClientForRole("writer");
  const issueLines = args.audit.issues
    .map((i, idx) => `${idx + 1}. [${i.level}](${i.category}) ${i.message}${i.suggestion ? `；修复建议：${i.suggestion}` : ""}`)
    .join("\n");
  const vocabLines = args.audit.vocabFatigue.map((v) => `- ${v.phrase}: ${v.count}`).join("\n");
  const styleConstraints = getNovelStyleConstraints();

  // 尝试加载自定义修订提示词
  const customRewritePrompt = loadConfig("NOVEL_REWRITE_PROMPT");

  let prompt: string;
  if (customRewritePrompt) {
    // 使用新的修订提示词
    prompt = customRewritePrompt
      .replace(/{{chapterContent}}/g, args.draft)
      .replace(/{{auditIssues}}/g, issueLines || "（无）");
  } else {
    // 使用旧的修订提示词（向后兼容）
    prompt = `你是一位修订者，需要在不改变本章核心剧情的前提下，修复连续性审计指出的问题，并尽量降低 AI 味。

要求：
- 保留原有剧情点、角色动机与节奏，不要新增与本章无关的大剧情。
- 仅为修复问题而改动，优先"最小改动"。
- 若有资源/设定矛盾，必须在正文中补上合理来源或消耗，或删去穿帮内容。
- 严格遵守以下风格与禁用约束，避免模板化连接词与总结句。
- 输出只包含修订后的正文，不要输出任何解释或 Markdown。

本章标题：${args.chapterTitle}

【风格与禁用约束（必须遵守）】
${styleConstraints}

【审计问题清单】
${issueLines || "（无）"}

【词汇疲劳（可选优化）】
${vocabLines || "（无）"}

【草稿正文】
${args.draft}
`;
  }

  const text = await client.generateContent(prompt);
  return text.trim();
}
