/**
 * 视频平台提示词规格配置
 * 每个平台对提示词的偏好、长度限制、语言、安全规则都不同
 * handleAIPrompt 根据用户选择的视频模型自动匹配对应的平台规格
 */

export interface PlatformPromptProfile {
  id: string;
  label: string;
  matchPattern: RegExp;           // 从视频模型名自动匹配
  maxLength: number;              // 提示词最大字符数
  language: "zh" | "en" | "both"; // 偏好语言
  minDuration: number;            // 平台最小时长（秒）
  maxDuration: number;            // 平台最大时长（秒）
  supportsRefSyntax: boolean;     // 是否支持 @1 @2 引用语法
  systemPromptPatch: string;      // 追加到通用系统提示词末尾的平台专用段落
}

// ═══ 平台配置表 ═══

const SEEDANCE_PATCH = `
## 目标平台：即梦 Seedance（豆包）
- 提示词使用中文
- 长度控制在 50-450 字，硬限 700 字
- 禁止血腥暴力、自残、色情、恐怖、政治敏感内容
- 如遇暴力描写，自动替换为温和表述（如"鲜血涌出"→"伤处泛红"）
- 动作描述具体化，避免抽象概念
- 镜头运动最多 1-2 种`;

const VEO_PATCH = `
## 目标平台：Google Veo 3.1
- 偏好电影化镜头语言（cinematic language）
- 支持较长提示词（最多 2000 字符）
- 中英文混合，关键镜头术语用英文（dolly in, tracking shot, crane up 等）
- 对光影、色彩渐变描述敏感
- 支持自然语言时间线描述（"镜头从...缓缓过渡到..."）
- 建议描述环境音效暗示（如"伴随风声"）以提升生成质量`;

const SORA_PATCH = `
## 目标平台：OpenAI Sora
- 偏好简洁自然语言，避免过度技术化
- 长度控制在 100-500 字符
- 注重物理真实性描述（重力、惯性、碰撞等）
- 用英文或中英混合
- 场景描述优先于镜头术语
- 强调画面质感关键词（cinematic, photorealistic, 8K 等）`;

const KLING_PATCH = `
## 目标平台：可灵 Kling
- 中文友好，优先使用中文描述
- 长度控制在 80-500 字符
- 偏好"动作描述 + 镜头运动"的组合格式
- 支持运动强度控制，提示词中注明节奏（快速/缓慢/匀速）
- 对人物动作和表情变化描述效果好`;

const GROK_PATCH = `
## 目标平台：Grok Video
- 简洁风格，长度控制在 50-300 字符
- 英文或中英混合
- 强调核心动作，每段提示词聚焦 1-2 个关键变化
- 镜头语言简明扼要`;

const WAN_PATCH = `
## 目标平台：阿里万象 Wan 2.6
- 中文原生，偏好叙事性描述
- 长度控制在 50-300 字符
- 动作描述要自然流畅，像讲故事一样
- 适合描写情绪变化和环境氛围`;

const HAILUO_PATCH = `
## 目标平台：海螺 MiniMax Hailuo
- 中文友好
- 长度控制在 80-400 字符
- 偏好分步骤的动态描述
- 对场景转换和光影变化效果好`;

const RUNWAY_PATCH = `
## 目标平台：Runway Gen
- 英文或中英混合
- 长度控制在 50-300 字符
- 偏好艺术化、风格化描述
- 关键词式表达效果好（词组用逗号分隔）`;

const GENERIC_PATCH = `
## 目标平台：通用
- 中英文混合
- 长度控制在 50-300 字符
- 使用通用的镜头语言和动作描述
- 兼顾各平台的共性偏好`;

export const PLATFORM_PROFILES: PlatformPromptProfile[] = [
  {
    id: "seedance",
    label: "即梦 Seedance（豆包）",
    matchPattern: /doubao|seedance/i,
    maxLength: 700,
    language: "zh",
    minDuration: 4,
    maxDuration: 15,
    supportsRefSyntax: false,
    systemPromptPatch: SEEDANCE_PATCH,
  },
  {
    id: "veo",
    label: "Google Veo 3.1",
    matchPattern: /^veo|veo_|veo3/i,
    maxLength: 2000,
    language: "both",
    minDuration: 5,
    maxDuration: 8,
    supportsRefSyntax: false,
    systemPromptPatch: VEO_PATCH,
  },
  {
    id: "sora",
    label: "OpenAI Sora",
    matchPattern: /^sora/i,
    maxLength: 1500,
    language: "both",
    minDuration: 5,
    maxDuration: 25,
    supportsRefSyntax: false,
    systemPromptPatch: SORA_PATCH,
  },
  {
    id: "kling",
    label: "可灵 Kling",
    matchPattern: /^kling/i,
    maxLength: 1500,
    language: "zh",
    minDuration: 5,
    maxDuration: 10,
    supportsRefSyntax: false,
    systemPromptPatch: KLING_PATCH,
  },
  {
    id: "grok",
    label: "Grok Video",
    matchPattern: /^grok-video/i,
    maxLength: 1000,
    language: "both",
    minDuration: 6,
    maxDuration: 15,
    supportsRefSyntax: false,
    systemPromptPatch: GROK_PATCH,
  },
  {
    id: "wan",
    label: "阿里万象 Wan",
    matchPattern: /^wan\d/i,
    maxLength: 1000,
    language: "zh",
    minDuration: 3,
    maxDuration: 10,
    supportsRefSyntax: false,
    systemPromptPatch: WAN_PATCH,
  },
  {
    id: "hailuo",
    label: "海螺 Hailuo",
    matchPattern: /hailuo|minimax/i,
    maxLength: 1500,
    language: "zh",
    minDuration: 5,
    maxDuration: 10,
    supportsRefSyntax: false,
    systemPromptPatch: HAILUO_PATCH,
  },
  {
    id: "vidu",
    label: "Vidu",
    matchPattern: /^vidu/i,
    maxLength: 1000,
    language: "both",
    minDuration: 4,
    maxDuration: 8,
    supportsRefSyntax: false,
    systemPromptPatch: GENERIC_PATCH,
  },
  {
    id: "runway",
    label: "Runway",
    matchPattern: /^runway/i,
    maxLength: 1000,
    language: "en",
    minDuration: 5,
    maxDuration: 10,
    supportsRefSyntax: false,
    systemPromptPatch: RUNWAY_PATCH,
  },
  {
    id: "luma",
    label: "Luma AI",
    matchPattern: /^luma/i,
    maxLength: 1000,
    language: "en",
    minDuration: 4,
    maxDuration: 10,
    supportsRefSyntax: false,
    systemPromptPatch: GENERIC_PATCH,
  },
];

/** 根据视频模型名匹配平台规格，未匹配返回通用规格 */
export function matchPlatformProfile(modelName: string): PlatformPromptProfile {
  if (!modelName) return GENERIC_PROFILE;
  for (const p of PLATFORM_PROFILES) {
    if (p.matchPattern.test(modelName)) return p;
  }
  return GENERIC_PROFILE;
}

/** 通用平台兜底规格 */
export const GENERIC_PROFILE: PlatformPromptProfile = {
  id: "generic",
  label: "通用模式",
  matchPattern: /.*/,
  maxLength: 1500,
  language: "both",
  minDuration: 3,
  maxDuration: 15,
  supportsRefSyntax: false,
  systemPromptPatch: GENERIC_PATCH,
};

/** 将推荐时长 clamp 到平台有效范围 */
export function clampDuration(seconds: number, profile: PlatformPromptProfile): number {
  return Math.max(profile.minDuration, Math.min(profile.maxDuration, seconds));
}
