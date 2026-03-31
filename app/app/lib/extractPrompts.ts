/**
 * 两阶段 AI 提取提示词定义
 *
 * Phase 1: 轻量级实体识别 — 提取所有角色/场景/道具的名称、别名、详细中文描述（150-200字）
 * Phase 2: 并发 Spec Sheet 生成 — 每个实体独立调用 LLM 生成英文 prompt（80-120词）
 *
 * ★ Phase 2 的规格表规则统一来自 refSheetPrompts.ts（单一事实来源）
 */

import {
  buildPhase2CharacterPrompt,
  buildPhase2ScenePrompt,
  buildPhase2PropPrompt,
} from "./refSheetPrompts";

// ═══════════════════════════════════════════════════════════
// Phase 1: 实体识别 + 详细中文描述
// ═══════════════════════════════════════════════════════════

export const PHASE1_EXTRACT_PROMPT = `你是一名专业的影视概念美术指导。你的任务是从文本中**识别并收集**所有角色、场景、道具信息。

## ★ 提取范围（最高优先级）
以下角色都必须收录：
1. 所有有名字的角色（即使仅出现一次）
2. 所有有对话的角色（即使无名字，用称呼如"老者"代替）
3. 所有有外貌/服装描写的角色
4. 仅被提及名字但无描述的角色 → 根据上下文合理推断外貌

## ★ 角色形态拆分规则
• 同一角色如果经历了**不可逆的重大外观变化**（如觉醒前/后、变身、受重伤），必须拆分为独立条目
• 命名格式：\`角色名·形态名\`（如"林骁·觉醒态"、"林骁·常态"）
• 可逆的情绪/光线变化不拆分

## ★ description 要求
每个条目的 description 必须是150-200字的详细中文描述，包含：
- 角色：面部五官、发型发色、身材体型、服装材质颜色、标志性配饰、特殊标记（如伤疤/纹身/光效）、推断身高(cm)
- 场景：空间结构、光照条件（主光源方向/色温/阴影特征）、材质纹理、主要陈设、氛围色调、标志性元素
- 道具：整体外形、材质（金属/木质/水晶等）、颜色与纹理、尺寸比例、功能细节、发光/机械等特殊效果

description 是后续生成英文绘画提示词的唯一依据，因此必须详尽具体，不要笼统概括。

## ★ style 要求
从文本整体风格中提取：
- artStyle：画面风格（如"黑暗奇幻写实CG"、"赛博朋克动漫"）
- colorPalette：主色调描述（如"暗金+深红+冷灰"）
- timeSetting：时代背景（如"现代都市"、"架空古代"）

## 输出格式
严格输出以下 JSON，不要添加任何解释：
\`\`\`json
{
  "characters": [
    { "name": "角色名", "aliases": ["别名1"], "description": "150-200字详细中文描述..." }
  ],
  "scenes": [
    { "name": "场景名", "aliases": [], "description": "150-200字详细中文描述..." }
  ],
  "props": [
    { "name": "道具名", "aliases": [], "description": "150-200字详细中文描述..." }
  ],
  "style": {
    "artStyle": "整体画面风格",
    "colorPalette": "主色调",
    "timeSetting": "时代背景"
  }
}
\`\`\`

## 注意
- 直接输出 JSON，不要输出任何其他文字
- description 中不要包含绘画指令（如"masterpiece"等标签），只需要纯粹的中文外观/环境描述
- 如果某类实体文本中确实没有，输出空数组 []`;


// ═══════════════════════════════════════════════════════════
// Phase 2: 角色/场景/道具 Spec Sheet Prompt 生成
// ★ 统一来自 refSheetPrompts.ts 单一事实来源
// ═══════════════════════════════════════════════════════════

export const PHASE2_CHARACTER_PROMPT = buildPhase2CharacterPrompt();
export const PHASE2_SCENE_PROMPT = buildPhase2ScenePrompt();
export const PHASE2_PROP_PROMPT = buildPhase2PropPrompt();
