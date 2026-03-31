import { getAIClientForRole } from "./outlineGenerator";
import { readTruthFile, type TruthFileName } from "../novelTruth";

export interface TruthLedgerEvent {
  item: string;
  delta: number;
  note?: string;
}

export interface TruthHookUpdate {
  hook: string;
  status: "open" | "closed";
  note?: string;
}

export interface TruthInteraction {
  a: string;
  b: string;
  relation: string;
  boundary?: string;
  note?: string;
}

export interface TruthEmotionalUpdate {
  character: string;
  emotion: string;
  trigger?: string;
}

export interface TruthSubplotUpdate {
  subplot: string;
  status: string;
  risk?: string;
}

export interface TruthUpdatePatch {
  chapterSummary?: string[];
  currentState?: string[];
  ledger?: TruthLedgerEvent[];
  hooks?: TruthHookUpdate[];
  interactions?: TruthInteraction[];
  emotionalArcs?: TruthEmotionalUpdate[];
  subplots?: TruthSubplotUpdate[];
}

function extractJsonObject(text: string): string | null {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return text.slice(firstBrace, lastBrace + 1).trim();
  return null;
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
    const raw = readTruthFile(projectId, name).trim();
    if (!raw) continue;
    const cap = raw.length > 6000 ? raw.slice(0, 6000) + "\n…(截断)" : raw;
    blocks.push(`【${name}】\n${cap}`);
  }
  return blocks.join("\n\n");
}

export async function generateTruthUpdatePatch(args: {
  projectId: string;
  chapterTitle: string;
  chapterContent: string;
}): Promise<TruthUpdatePatch | null> {
  const client = await getAIClientForRole("analyst");
  const truth = buildTruthContext(args.projectId);

  const prompt = `你是一个“真相文件更新器”，用于把最新章节内容沉淀到长期记忆（真相文件）。

你会得到：
1) 真相文件（唯一事实来源）
2) 本章正文

任务：根据本章新增/变更的事实，输出一个 JSON Patch，指导如何更新真相文件。
要求：
- 只提取会影响后续剧情的“事实”，不要写流水账。
- ledger 只记录明确发生的获得/消耗/丢失（delta 必须是整数，正为获得，负为消耗/丢失）。
- hooks：能明确“回收/揭晓/解决”的标记为 closed，否则是 open（新增或继续悬而未决）。
- interactions：只记录本章明确发生的关键互动（冲突/结盟/交易/欺瞒/救助等）。
- emotionalArcs：只记录主角/关键角色的情绪变化与触发。
- subplots：只记录主线/支线推进或卡住的状态。

只输出一个 JSON 对象，不要输出任何多余文字或 Markdown。

JSON 结构：
{
  "chapterSummary": ["..."],
  "currentState": ["..."],
  "ledger": [{ "item": "灵石", "delta": -50, "note": "购买情报" }],
  "hooks": [{ "hook": "血煞门追查玉佩", "status": "open", "note": "线索指向城南当铺" }],
  "interactions": [{ "a": "叶云", "b": "韩长老", "relation": "冲突升级", "boundary": "韩长老不知断剑来历" }],
  "emotionalArcs": [{ "character": "叶云", "emotion": "压抑转为决绝", "trigger": "得知师门背叛" }],
  "subplots": [{ "subplot": "断剑来历", "status": "推进", "risk": "线索过少" }]
}

【真相文件】
${truth || "（暂无真相文件内容）"}

【本章正文】
标题：${args.chapterTitle}
正文：
${args.chapterContent}
`;

  try {
    const text = await client.generateContent(prompt);
    const jsonStr = extractJsonObject(text);
    if (!jsonStr) return null;
    const parsed = JSON.parse(jsonStr);
    return parsed as TruthUpdatePatch;
  } catch {
    return null;
  }
}
