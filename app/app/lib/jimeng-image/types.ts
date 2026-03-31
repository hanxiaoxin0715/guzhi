/**
 * 即梦生图类型定义
 * 基于即梦/Dreamina API 的图片生成能力
 */

// ═══════════════════════════════════════════════════════════
// 模型与参数类型
// ═══════════════════════════════════════════════════════════

/** 即梦生图模型ID */
export type JimengImageModelId = "seedream-5.0" | "image-4.6" | "image-4.5" | "image-4.1" | "image-4.0";

/** 即梦生图宽高比（比 Seedance 多 3:2 和 2:3） */
export type JimengImageRatio = "智能" | "21:9" | "16:9" | "4:3" | "3:2" | "1:1" | "2:3" | "3:4" | "9:16";

/** 即梦生图分辨率 */
export type JimengImageResolution = "2K" | "4K";

/** 生成数量（每次请求固定4张，数量决定请求批次） */
export type JimengImageCount = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** 生成任务状态 */
export type JimengImageTaskStatus = "uploading" | "generating" | "polling" | "done" | "error";

// ═══════════════════════════════════════════════════════════
// 常量配置
// ═══════════════════════════════════════════════════════════

/** 模型映射：前端ID → 即梦内部标识（来源: get_common_config 2026.03.02/05） */
export const JIMENG_IMAGE_MODEL_MAP: Record<JimengImageModelId, string> = {
  "seedream-5.0": "high_aes_general_v50",
  "image-4.6": "high_aes_general_v42",   // starling_key: web_image_model_name_46
  "image-4.5": "high_aes_general_v40l",  // Seedream 4.5
  "image-4.1": "high_aes_general_v41",
  "image-4.0": "high_aes_general_v40",
};

/** 模型权益类型（2K/4K 分别对应不同 benefit_type） */
export const JIMENG_IMAGE_BENEFIT_TYPE_2K = "image_basic_v5_2k";
export const JIMENG_IMAGE_BENEFIT_TYPE_4K = "image_basic_v5_4k";
/** @deprecated 使用 JIMENG_IMAGE_BENEFIT_TYPE_2K/4K */
export const JIMENG_IMAGE_BENEFIT_TYPE = "image_basic_v5_2k";

/** 图片生成使用的 draft 版本 */
export const JIMENG_IMAGE_DRAFT_VERSION = "3.3.10";

/** 积分消耗：4积分/张（非会员） */
export const JIMENG_IMAGE_CREDITS_PER_IMAGE = 4;

/** 每次请求固定出4张图 */
export const IMAGES_PER_REQUEST = 4;

/** 最大参考图数量 */
export const MAX_REFERENCE_IMAGES = 7;

/** 提示词最大长度 */
export const MAX_PROMPT_LENGTH = 1200;

/** 宽高比 → 即梦 API 的 image_ratio 数字编号（来源: get_common_config ratio_type 映射） */
export const JIMENG_IMAGE_RATIO_TYPE: Record<string, number> = {
  "1:1":  1,
  "3:4":  2,
  "16:9": 3,
  "4:3":  4,
  "9:16": 5,
  "2:3":  6,
  "3:2":  7,
  "21:9": 8,
  "智能": 1, // 智能默认 1:1
};

/** 宽高比对应分辨率（2K）——来源: get_common_config API 2026.03.02 */
export const JIMENG_IMAGE_RESOLUTION_2K: Record<string, { width: number; height: number }> = {
  "智能": { width: 2048, height: 2048 },
  "21:9": { width: 3024, height: 1296 },
  "16:9": { width: 2560, height: 1440 },
  "4:3": { width: 2304, height: 1728 },
  "3:2": { width: 2496, height: 1664 },
  "1:1": { width: 2048, height: 2048 },
  "2:3": { width: 1664, height: 2496 },
  "3:4": { width: 1728, height: 2304 },
  "9:16": { width: 1440, height: 2560 },
};

/** 宽高比对应分辨率（4K）——来源: get_common_config API 2026.03.02 */
export const JIMENG_IMAGE_RESOLUTION_4K: Record<string, { width: number; height: number }> = {
  "智能": { width: 4096, height: 4096 },
  "21:9": { width: 6197, height: 2656 },
  "16:9": { width: 5404, height: 3040 },
  "4:3": { width: 4693, height: 3520 },
  "3:2": { width: 4992, height: 3328 },
  "1:1": { width: 4096, height: 4096 },
  "2:3": { width: 3328, height: 4992 },
  "3:4": { width: 3520, height: 4693 },
  "9:16": { width: 3040, height: 5404 },
};

// ═══════════════════════════════════════════════════════════
// 前端 UI 选项配置
// ═══════════════════════════════════════════════════════════

export interface JimengImageModelOption {
  value: JimengImageModelId;
  label: string;
  description: string;
  badge?: string;
}

export const JIMENG_IMAGE_MODEL_OPTIONS: JimengImageModelOption[] = [
  {
    value: "seedream-5.0",
    label: "图片 5.0 Lite",
    description: "指令响应更精准，生成效果更智能",
    badge: "NEW",
  },
  {
    value: "image-4.6",
    label: "图片 4.6",
    description: "人像一致性保持更好，性价比更高",
    badge: "NEW",
  },
  {
    value: "image-4.5",
    label: "图片 4.5",
    description: "强化一致性、风格与图文响应",
  },
  {
    value: "image-4.1",
    label: "图片 4.1",
    description: "更专业的创意、美学和一致性保持",
  },
  {
    value: "image-4.0",
    label: "图片 4.0",
    description: "支持多参考图、系列组图生成",
  },
];

export interface JimengImageRatioOption {
  value: JimengImageRatio;
  label: string;
  icon?: string;
}

export const JIMENG_IMAGE_RATIO_OPTIONS: JimengImageRatioOption[] = [
  { value: "智能", label: "智能" },
  { value: "21:9", label: "21:9" },
  { value: "16:9", label: "16:9" },
  { value: "4:3", label: "4:3" },
  { value: "3:2", label: "3:2" },
  { value: "1:1", label: "1:1" },
  { value: "2:3", label: "2:3" },
  { value: "3:4", label: "3:4" },
  { value: "9:16", label: "9:16" },
];

// ═══════════════════════════════════════════════════════════
// API 请求/响应类型
// ═══════════════════════════════════════════════════════════

/** 前端发送到后端的生成请求 */
export interface JimengImageGenerateRequest {
  prompt: string;
  negativePrompt?: string;
  model: JimengImageModelId;
  ratio: JimengImageRatio;
  resolution: JimengImageResolution;
  count: JimengImageCount;
  sessionId: string;
  webId: string;
  userId: string;
  referenceImages?: string[]; // base64 data URLs
}

/** 后端返回的任务ID */
export interface JimengImageGenerateResponse {
  taskId: string;
  batchCount: number; // 总批次数（每批4张）
}

/** 单张生成结果 */
export interface JimengImageResult {
  url: string;
  width: number;
  height: number;
  index: number; // 在批次中的序号 0-3
}

/** 轮询返回的任务状态 */
export interface JimengImageTaskResponse {
  status: JimengImageTaskStatus;
  progress: string;
  elapsed: number;
  results?: JimengImageResult[];
  error?: string;
  failCode?: number;
}

/** 内部任务对象（服务端） */
export interface JimengImageTask {
  id: string;
  status: JimengImageTaskStatus;
  progress: string;
  startTime: number;
  results: JimengImageResult[];
  error: string | null;
  failCode?: number;
  /** 总批次数 */
  batchCount: number;
  /** 已完成批次 */
  completedBatches: number;
}

/** 图片库条目（持久化存储） */
export interface JimengLibraryItem {
  id: string;
  prompt: string;
  negativePrompt?: string;
  model: JimengImageModelId;
  ratio: JimengImageRatio;
  resolution: JimengImageResolution;
  imageUrl: string; // 磁盘 URL：/api/jimeng-image?key=xxx
  width: number;
  height: number;
  createdAt: number; // timestamp
  batchId: string; // 同一批次的图片共享 batchId
}
