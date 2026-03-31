/**
 * ════════════════════════════════════════════════════════════
 * AI 导演系统 — 画布操作目录
 * ════════════════════════════════════════════════════════════
 *
 * 定义所有可通过聊天调用的画布操作，包括参数模式和描述
 * 用于生成 LLM function-calling schema + 前端 dispatch 验证
 */

import type { CanvasActionType } from "./types";

export interface ActionDefinition {
  type: CanvasActionType;
  name: string;           // 中文名称
  description: string;    // 中文描述（供 LLM 理解）
  agent: "story" | "shot" | "image" | "any"; // 归属智能体
  params: ActionParam[];
  example?: string;       // JSON 示例
}

interface ActionParam {
  name: string;
  type: "string" | "number" | "boolean" | "string[]";
  required: boolean;
  description: string;
  enum?: string[];
}

// ── 完整操作目录 ──

export const ACTION_CATALOG: ActionDefinition[] = [
  // ══ 模式切换 ══
  {
    type: "switchGridMode",
    name: "切换宫格模式",
    description: "切换生图工作台的宫格模式：nine（九宫格）、four（四宫格）、smartNine（智能分镜）",
    agent: "shot",
    params: [
      { name: "mode", type: "string", required: true, description: "目标模式", enum: ["nine", "four", "smartNine"] },
    ],
    example: '{"type":"switchGridMode","params":{"mode":"nine"}}',
  },
  {
    type: "switchImageGenMode",
    name: "切换生图通道",
    description: "切换图片生成的通道：api（第三方API）、geminiTab（Gemini浏览器自动化）、jimeng（即梦生图）",
    agent: "image",
    params: [
      { name: "mode", type: "string", required: true, description: "目标通道", enum: ["api", "geminiTab", "jimeng"] },
    ],
    example: '{"type":"switchImageGenMode","params":{"mode":"api"}}',
  },
  {
    type: "switchEpisode",
    name: "切换集数",
    description: "切换当前工作的集数（EP编号）",
    agent: "story",
    params: [
      { name: "episode", type: "string", required: true, description: "集数标识，如 EP01" },
    ],
    example: '{"type":"switchEpisode","params":{"episode":"EP01"}}',
  },
  {
    type: "switchLeftTab",
    name: "切换左侧面板",
    description: "切换生图工作台左侧面板的Tab：prompts（提示词）、chars（角色）、scenes（场景）、props（道具）、style（风格）",
    agent: "any",
    params: [
      { name: "tab", type: "string", required: true, description: "面板Tab", enum: ["prompts", "chars", "scenes", "props", "style"] },
    ],
  },

  // ══ 提示词操作 ══
  {
    type: "loadPrompts",
    name: "加载提示词",
    description: "从磁盘加载指定EP的分镜提示词到工作台",
    agent: "shot",
    params: [
      { name: "episode", type: "string", required: false, description: "EP编号，不传则加载当前EP" },
    ],
    example: '{"type":"loadPrompts","params":{"episode":"EP03"}}',
  },
  {
    type: "updateCellPrompt",
    name: "修改格子提示词",
    description: "修改九宫格/四宫格中指定格子的提示词文本",
    agent: "shot",
    params: [
      { name: "cellIndex", type: "number", required: true, description: "格子索引（0-8 for 九宫格，0-3 for 四宫格）" },
      { name: "prompt", type: "string", required: true, description: "新的提示词文本" },
      { name: "language", type: "string", required: false, description: "提示词语言", enum: ["cn", "en"] },
    ],
  },
  {
    type: "translatePrompt",
    name: "AI翻译分镜提示词",
    description: "将指定格子的中文分镜描述AI翻译为英文生图提示词",
    agent: "shot",
    params: [
      { name: "cellIndex", type: "number", required: true, description: "格子索引" },
    ],
  },
  {
    type: "translateRefPrompt",
    name: "AI翻译参考图描述",
    description: "将一致性条目的中文描述AI翻译为英文Design Reference Sheet提示词",
    agent: "shot",
    params: [
      { name: "category", type: "string", required: true, description: "类别", enum: ["characters", "scenes", "props"] },
      { name: "itemId", type: "string", required: true, description: "条目ID" },
    ],
  },
  {
    type: "viewFullPrompt",
    name: "预览完整提示词",
    description: "预览当前模式下的完整组合提示词（含系统提示词+参考图注入）",
    agent: "shot",
    params: [
      { name: "mode", type: "string", required: false, description: "预览模式", enum: ["nine", "four", "smartNine"] },
      { name: "beatIdx", type: "number", required: false, description: "四宫格节拍索引" },
    ],
  },

  // ══ 图片生成 ══
  {
    type: "generateNineGrid",
    name: "九宫格一键生成",
    description: "使用当前EP的提示词一键生成九宫格分镜图（组合提示词→调API→裁切9格→存盘）",
    agent: "image",
    params: [],
    example: '{"type":"generateNineGrid","params":{}}',
  },
  {
    type: "generateFourGrid",
    name: "四宫格指定节拍生成",
    description: "生成四宫格指定节拍的分镜图",
    agent: "image",
    params: [
      { name: "beatIdx", type: "number", required: false, description: "节拍索引，默认当前节拍" },
    ],
  },
  {
    type: "generateSmartNineGrid",
    name: "智能分镜生成",
    description: "使用智能分镜模式生成九宫格",
    agent: "image",
    params: [],
  },
  {
    type: "regenerateCell",
    name: "单格重新生成",
    description: "重新生成指定格子的分镜图片",
    agent: "image",
    params: [
      { name: "cellIndex", type: "number", required: true, description: "格子索引" },
      { name: "prompt", type: "string", required: false, description: "自定义提示词（不传则用当前格的提示词）" },
    ],
  },

  // ══ 图片处理 ══
  {
    type: "upscaleCell",
    name: "超分放大",
    description: "将指定格子的图片超分辨率放大到4K",
    agent: "image",
    params: [
      { name: "cellIndex", type: "number", required: true, description: "格子索引" },
    ],
  },
  {
    type: "batchUpscale",
    name: "批量超分",
    description: "批量超分当前模式下所有有图片的格子",
    agent: "image",
    params: [],
  },
  {
    type: "deleteCell",
    name: "删除格子图片",
    description: "删除指定格子的图片",
    agent: "image",
    params: [
      { name: "cellIndex", type: "number", required: true, description: "格子索引" },
    ],
  },
  {
    type: "clearAllImages",
    name: "清除所有图片",
    description: "清除当前模式下所有格子的图片",
    agent: "image",
    params: [],
  },

  // ══ AI 操作 ══
  {
    type: "aiExtract",
    name: "AI提取角色/场景/道具",
    description: "从当前EP的剧本文本中AI提取角色、场景和道具信息，自动填入一致性面板",
    agent: "story",
    params: [],
    example: '{"type":"aiExtract","params":{}}',
  },
  {
    type: "styleAnalyze",
    name: "AI风格分析",
    description: "分析上传的风格参考图，提取画风、色调、风格关键词",
    agent: "image",
    params: [
      { name: "imageUrl", type: "string", required: false, description: "图片URL（不传则弹出上传对话框）" },
    ],
  },
  {
    type: "styleUpload",
    name: "上传风格参考图",
    description: "弹出文件选择对话框上传风格参考图",
    agent: "image",
    params: [],
  },

  // ══ 一致性管理 ══
  {
    type: "addConsistencyItem",
    name: "添加一致性条目",
    description: "添加新的角色/场景/道具一致性条目",
    agent: "story",
    params: [
      { name: "category", type: "string", required: true, description: "类别", enum: ["characters", "scenes", "props"] },
      { name: "name", type: "string", required: false, description: "条目名称" },
      { name: "description", type: "string", required: false, description: "条目描述" },
    ],
    example: '{"type":"addConsistencyItem","params":{"category":"characters","name":"叶云","description":"男主角，20岁，黑发红眸，剑客"}}',
  },
  {
    type: "updateConsistencyItem",
    name: "更新一致性条目",
    description: "更新已有的一致性条目的名称或描述",
    agent: "story",
    params: [
      { name: "category", type: "string", required: true, description: "类别", enum: ["characters", "scenes", "props"] },
      { name: "itemId", type: "string", required: true, description: "条目ID" },
      { name: "field", type: "string", required: true, description: "更新字段", enum: ["name", "description"] },
      { name: "value", type: "string", required: true, description: "新值" },
    ],
  },
  {
    type: "deleteConsistencyItem",
    name: "删除一致性条目",
    description: "删除指定的一致性条目",
    agent: "story",
    params: [
      { name: "category", type: "string", required: true, description: "类别", enum: ["characters", "scenes", "props"] },
      { name: "itemId", type: "string", required: true, description: "条目ID" },
    ],
  },

  // ══ 动态提示词 ══
  {
    type: "generateMotionPrompts",
    name: "生成全部运镜提示词",
    description: "为所有格子一键生成运镜/动态提示词（用于图生视频）",
    agent: "shot",
    params: [],
  },
  {
    type: "generateSingleMotion",
    name: "生成单格运镜提示词",
    description: "为指定格子生成运镜/动态提示词",
    agent: "shot",
    params: [
      { name: "cellIndex", type: "number", required: true, description: "格子索引" },
    ],
  },

  // ══ 导航 ══
  {
    type: "navigateTo",
    name: "页面导航",
    description: "跳转到指定页面",
    agent: "any",
    params: [
      { name: "path", type: "string", required: true, description: "目标路径", enum: ["/", "/scripts", "/pipeline", "/studio", "/video", "/outputs", "/seedance", "/prompts", "/settings"] },
    ],
  },
  {
    type: "openModal",
    name: "打开弹窗",
    description: "打开指定的功能弹窗",
    agent: "any",
    params: [
      { name: "modal", type: "string", required: true, description: "弹窗名称", enum: ["characterLibrary", "fusion", "motionPrompt", "gridImport"] },
    ],
  },
];

// ── 按智能体角色筛选操作 ──

export function getActionsForAgent(agent: "story" | "shot" | "image"): ActionDefinition[] {
  return ACTION_CATALOG.filter((a) => a.agent === agent || a.agent === "any");
}

// ── 生成 LLM function-calling schema 文本（嵌入系统提示词） ──

export function buildActionSchemaText(actions: ActionDefinition[]): string {
  const lines: string[] = [];
  lines.push("## 可用操作（Function Calling）");
  lines.push("");
  lines.push("当你需要执行画布操作时，在回复末尾附加 `[ACTIONS]` 块，格式如下：");
  lines.push("```");
  lines.push("[ACTIONS]");
  lines.push('[{"type":"操作类型","params":{...参数}}]');
  lines.push("```");
  lines.push("");
  lines.push("可用操作列表：");
  lines.push("");

  for (const action of actions) {
    lines.push(`### \`${action.type}\` — ${action.name}`);
    lines.push(`${action.description}`);
    if (action.params.length > 0) {
      lines.push("参数：");
      for (const p of action.params) {
        const req = p.required ? "必填" : "可选";
        const enumStr = p.enum ? `，可选值：${p.enum.join(" | ")}` : "";
        lines.push(`- \`${p.name}\` (${p.type}, ${req}): ${p.description}${enumStr}`);
      }
    } else {
      lines.push("参数：无");
    }
    if (action.example) {
      lines.push(`示例：\`${action.example}\``);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── 从 LLM 回复中解析 [ACTIONS] 块 ──

export function parseActionsFromReply(reply: string): { cleanReply: string; actions: Array<{ type: string; params: Record<string, unknown> }> } {
  const actionBlockRegex = /\[ACTIONS\]\s*\n?```?\s*\n?(\[[\s\S]*?\])\s*\n?```?/;
  const match = reply.match(actionBlockRegex);

  if (!match) {
    // 也尝试不带代码块的格式
    const simpleRegex = /\[ACTIONS\]\s*\n?(\[[\s\S]*?\])\s*$/;
    const simpleMatch = reply.match(simpleRegex);
    if (!simpleMatch) {
      return { cleanReply: reply.trim(), actions: [] };
    }
    try {
      const actions = JSON.parse(simpleMatch[1]);
      const cleanReply = reply.replace(simpleRegex, "").trim();
      return { cleanReply, actions };
    } catch {
      return { cleanReply: reply.trim(), actions: [] };
    }
  }

  try {
    const actions = JSON.parse(match[1]);
    const cleanReply = reply.replace(actionBlockRegex, "").trim();
    return { cleanReply, actions };
  } catch {
    return { cleanReply: reply.trim(), actions: [] };
  }
}
