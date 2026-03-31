import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { SINGLE_PASS_EXTRACT_PROMPT } from "@/app/api/extract/route";
import { BEAT_BREAKDOWN_PROMPT } from "@/app/api/pipeline/run/route";
import { ANALYZE_SCRIPT_PROMPT, RESTORE_STORYBOARD_PROMPT } from "@/app/api/analyze-script/route";
import { SEEDANCE_OMNI_PROMPT, SEEDANCE_FIRST_FRAME_PROMPT, SEEDANCE_SIMPLE_PROMPT } from "@/app/api/seedance/ai-prompt/route";
import { DIALOGUE_EMOTION_PROMPT, TRANSLATE_PROMPT, TRANSLATE_GRID_PROMPT, CONTINUOUS_ACTION_PROMPT } from "@/app/lib/defaultPrompts";
import {
  STYLE_ANALYZE_PROMPT, UPSCALE_PROMPT,
  STORY_AGENT_DEFAULT_PROMPT, SHOT_AGENT_DEFAULT_PROMPT, IMAGE_AGENT_DEFAULT_PROMPT,
} from "@/app/lib/defaultPrompts";

export const dynamic = "force-dynamic";

/**
 * Build the Motion Prompt system prompt for video generation.
 * Combines methodology + template into a single system prompt
 * that can drive AI to generate motion prompts for all 3 modes.
 */
function buildMotionPromptSystemPrompt(methodology: string, template: string): string {
  return `# 角色
你是一名专业的AI视频动态提示词专家（Motion Prompt Specialist）。你的任务是根据用户提供的图片内容、小说分析和剧本节拍拆解，为图生视频（Image-to-Video）生成精准、简洁、可执行的动态提示词。

# 核心原则
1. **图片已见原则**：AI视频模型能"看到"输入图片，不需要重复描述图片中的静态内容。只描述"变化"：动作、运动、情绪转变。
2. **简洁优先原则**：最佳长度50-200字符，聚焦2-3个核心元素。
3. **具体动作原则**：用具体的物理动作，避免抽象概念。
4. **叙事推进原则**：每个Motion Prompt必须服务于剧情推进，体现该节拍的叙事目的和情绪变化。

# 三种模式

## 单图模式（Single Image → Video）
- 输入：1张静态图片
- 重点：为这张图片设计自然的动态化方案
- 公式：镜头运动 + 主体动作 + 速度/节奏 + 氛围
- 示例："Slow dolly in, eyes open slowly, hair flowing gently in wind, cinematic lighting"

## 首尾帧模式（First-Last Frame → Video）
- 输入：首帧图片 + 尾帧图片（可选）
- 重点：描述从首帧到尾帧之间的过渡动态
- 公式：过渡描述 + 核心变化 + 运动轨迹 + 节奏
- 示例："Smooth transition, subject walks forward, camera slowly rises, daylight transitioning to golden hour"

## 多参考图模式（Multi-Reference → Video）
- 输入：多张参考图片（主体+风格参考）
- 重点：融合多图信息，生成一致性动态描述
- 公式：主体动作 + 风格参考融合 + 镜头运动 + 氛围统一
- 示例："Character walks through misty forest referencing the dark fantasy aesthetic, tracking shot, leaves falling, volumetric lighting"

# 生成规则
1. 必须基于用户提供的上下文（图片内容描述、小说分析、节拍拆解）生成
2. 每个Motion Prompt对应一个视频片段（通常5-10秒）
3. 镜头运动最多1-2种，主体运动最多1-2种
4. 禁止使用否定句（AI不理解否定）
5. 禁止重复描述图片中已有的静态元素
6. 禁止抽象概念，只用具体物理动作

${methodology ? `\n# 方法论参考\n${methodology}` : ""}

${template ? `\n# 输出模板参考\n${template}` : ""}

# 输出格式
根据用户的模式和需求，直接输出可用的Motion Prompt文本。如需批量生成，按"格N-M: [Motion Prompt]"格式输出。不要输出任何额外解释或设计理由，直接给可复制的提示词文本。`;
}

/**
 * GET /api/prompts
 * Returns all default system prompts so the editor page can load them.
 */
export async function GET() {
  try {
  // standalone 部署时外部资源文件被复制到 cwd() 目录，开发时在 cwd()/..
  const cwdDir = process.cwd();
  const parentDir = join(cwdDir, "..");

  function readFile(relativePath: string): string {
    // 优先检查 cwd()（standalone 打包后的路径）
    const cwdPath = join(cwdDir, relativePath);
    try {
      return readFileSync(cwdPath, "utf-8");
    } catch { /* fallback */ }
    // 回退到 cwd()/..（开发环境的工作区根目录）
    const parentPath = join(parentDir, relativePath);
    try {
      return readFileSync(parentPath, "utf-8");
    } catch {
      return "";
    }
  }

  // ★ Reuse prompts from shared constants (single source of truth)
  const extract = SINGLE_PASS_EXTRACT_PROMPT;

  // ★ Gem.txt system prompts — the actual prompts used by the pipeline
  const nineGridGem = readFile("9宫格分镜Gem.txt");
  const fourGridGem = readFile("4宫格分镜Gem.txt");
  const methodology = readFile("claude/film-storyboard-skill/storyboard-methodology-playbook.md");
  const geminiGuide = readFile("claude/film-storyboard-skill/gemini-image-prompt-guide.md");
  const director = readFile("claude/director.md");
  const storyboardArtist = readFile("claude/storyboard-artist.md");
  const producer = readFile("claude/CLAUDE.md");

  // Motion Prompt — 动态提示词系统提示词（图生视频，单图/首尾帧/多参考模式）
  const motionMethodology = readFile("claude/animator-skill/motion-prompt-methodology.md");
  const motionTemplate = readFile("claude/animator-skill/templates/motion-prompt-template.md");
  const motionPrompt = buildMotionPromptSystemPrompt(motionMethodology, motionTemplate);

  const styleAnalyze = STYLE_ANALYZE_PROMPT;

  const upscale = UPSCALE_PROMPT;

  return NextResponse.json({
    extract,
    nineGridGem,
    fourGridGem,
    motionPrompt,
    styleAnalyze,
    upscale,
    methodology,
    geminiGuide,
    director,
    storyboardArtist,
    producer,
    // ── 新增：流水线/视频/剧本分析提示词 ──
    beatBreakdown: BEAT_BREAKDOWN_PROMPT,
    analyzeScript: ANALYZE_SCRIPT_PROMPT,
    restoreStoryboard: RESTORE_STORYBOARD_PROMPT,
    seedanceOmni: SEEDANCE_OMNI_PROMPT,
    seedanceSimple: SEEDANCE_SIMPLE_PROMPT,
    seedanceFirstFrame: SEEDANCE_FIRST_FRAME_PROMPT,
    dialogueEmotion: DIALOGUE_EMOTION_PROMPT,
    translatePrompt: TRANSLATE_PROMPT,
    translateGridPrompt: TRANSLATE_GRID_PROMPT,
    continuousAction: CONTINUOUS_ACTION_PROMPT,
    // ── AI 导演系统智能体提示词 ──
    storyAgent: STORY_AGENT_DEFAULT_PROMPT,
    shotAgent: SHOT_AGENT_DEFAULT_PROMPT,
    imageAgent: IMAGE_AGENT_DEFAULT_PROMPT,
  });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
