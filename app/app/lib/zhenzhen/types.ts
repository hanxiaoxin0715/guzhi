/**
 * 贞贞的AI工坊 API 类型定义
 * 官方文档: https://ai.t8star.cn/api-set
 *
 * 统一格式接口 v2:
 *   提交: POST /v2/videos/generations
 *   查询: GET /v2/videos/generations/:task_id
 *   图片: POST /v2/images/generations  /  GET /v2/images/generations/:task_id
 *
 * 文件上传: POST /v1/files
 * 角色创建: POST /sora/v1/characters
 */

// ═══════════════════════════════════════════════════════════
// 基础常量
// ═══════════════════════════════════════════════════════════

/** 贞贞 API 默认 Base URL */
export const ZHENZHEN_BASE_URL = "https://ai.t8star.cn";

/** 贞贞 API 端点 */
export const ZHENZHEN_ENDPOINTS = {
  // 统一视频接口 (v2)
  videoSubmit: "/v2/videos/generations",
  videoQuery: (taskId: string) => `/v2/videos/generations/${taskId}`,

  // 统一图片接口 (v2)
  imageSubmit: "/v2/images/generations",
  imageQuery: (taskId: string) => `/v2/images/generations/${taskId}`,

  // 文件上传 (v1)
  fileUpload: "/v1/files",

  // 角色创建 (Sora2 格式)
  characterCreate: "/sora/v1/characters",

  // 模型列表
  models: "/v1/models",

  // 可灵官方格式 (预留)
  klingOmniVideo: "/kling/v1/videos/omni-video",
} as const;

// ═══════════════════════════════════════════════════════════
// 视频生成
// ═══════════════════════════════════════════════════════════

/** 视频生成请求体 (统一格式 v2) */
export interface ZZVideoRequest {
  /** 文本提示词，支持中英文，最大 800 字符 */
  prompt: string;
  /** 模型名称，如 doubao-seedance-1-0-pro-250528 */
  model: string;
  /** 参考图 URL 数组 */
  images?: string[];
  /** 视频时长（秒），如 5 / 10 */
  duration?: number;
  /** 视频分辨率: 480p / 720p / 1080p */
  resolution?: string;
  /** 宽高比: 21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 / 9:21 / keep_ratio / adaptive */
  ratio?: string;
  /** 是否添加水印 */
  watermark?: boolean;
  /** 随机种子 0-2147483647 */
  seed?: number;
  /** 是否固定摄像头 */
  camerafixed?: boolean;
  /** 是否返回尾帧图像 (仅 lite-i2v 支持) */
  return_last_frame?: boolean;
  /** 是否生成音频 */
  generate_audio?: boolean;
}

/** 视频提交响应 */
export interface ZZVideoSubmitResponse {
  task_id: string;
}

/** 任务状态枚举 */
export type ZZTaskStatus =
  | "NOT_START"
  | "SUBMITTED"
  | "QUEUED"
  | "IN_PROGRESS"
  | "SUCCESS"
  | "FAILURE";

/** 视频查询响应 */
export interface ZZVideoQueryResponse {
  task_id: string;
  status: ZZTaskStatus;
  data?: {
    output?: string;      // 单个视频 URL
    outputs?: string[];   // 多个视频 URL
  };
  error?: string;
}

// ═══════════════════════════════════════════════════════════
// 图片生成
// ═══════════════════════════════════════════════════════════

/** 图片生成请求体 (统一格式 v2) */
export interface ZZImageRequest {
  prompt: string;
  model: string;
  images?: string[];
  size?: string;           // 如 "1024x1024"
  aspect_ratio?: string;
  watermark?: boolean;
}

/** 图片查询响应 */
export interface ZZImageQueryResponse {
  task_id: string;
  status: ZZTaskStatus;
  data?: {
    output?: string;
    outputs?: string[];
  };
  error?: string;
}

// ═══════════════════════════════════════════════════════════
// 文件上传
// ═══════════════════════════════════════════════════════════

/** 文件上传响应 (POST /v1/files) */
export interface ZZFileUploadResponse {
  id: string;
  object: string;
  bytes: number;
  created_at: number;
  filename: string;
  purpose: string;
  url?: string;
}

// ═══════════════════════════════════════════════════════════
// 角色创建 (Sora 专用 — 仅 Sora 模型使用)
// ═══════════════════════════════════════════════════════════

/**
 * Sora2 角色创建请求 (POST /sora/v1/characters)
 * ★ 仅供 Sora 模型使用（sora-2 等），其他模型不支持角色功能
 *
 * 贞贞实际 API 格式（JSON body）:
 *   { timestamps: "1,3", url: "视频URL" }
 *   { timestamps: "1,3", from_task: "任务ID" }
 *
 * 角色从已生成的视频中提取，NOT 从静态图片创建
 */
export interface ZZCharacterCreateRequest {
  /** 时间戳范围，格式 "start,end"（秒），如 "1,3"，范围 1-3 秒 */
  timestamps: string;
  /** 视频 URL（与 from_task 二选一） */
  url?: string;
  /** 来源任务 ID（与 url 二选一） */
  from_task?: string;
}

/** 角色创建响应 */
export interface ZZCharacterCreateResponse {
  id: string;
  username: string;
  permalink?: string;
  profile_picture_url?: string;
}

/** 角色分类：角色（物品/生物）、场景、道具 */
export type SoraCharCategory = "character" | "scene" | "prop";

export const SORA_CHAR_CATEGORY_LABEL: Record<SoraCharCategory, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
};

/**
 * 前端存储的 Sora 角色/场景/道具（从视频中提取）
 * 存储在 localStorage: feicai-sora-characters
 * 使用方式: 在提示词中添加 @username 引用
 *
 * ★ 注意：Sora 的「角色」不限于人物，也包括宠物、物品、奇幻生物等
 *   场景和道具也通过同一个 API 创建，区别仅在前端分类标记
 */
export interface SoraCharacter {
  /** Sora 角色 ID */
  id: string;
  /** @username — 在提示词中用 @username 引用 */
  username: string;
  /** 角色头像 URL */
  profilePicture?: string;
  /** 角色链接 */
  permalink?: string;
  /** 创建时间 */
  createdAt: number;
  /** 来源视频 URL */
  fromVideoUrl?: string;
  /** 来源 API 任务 ID */
  fromTaskId?: string;
  /** 分类：角色/场景/道具（默认 character） */
  category?: SoraCharCategory;
  /** 用户自定义备注名称 */
  nickname?: string;
}

/**
 * 判断模型是否为 Sora 系列（仅 Sora 模型支持角色功能）
 */
export function isSoraModel(modelName: string): boolean {
  return modelName.toLowerCase().includes("sora");
}

// ═══════════════════════════════════════════════════════════
// 模型列表（贞贞支持的视频模型分类）
// ═══════════════════════════════════════════════════════════

/**
 * 贞贞统一格式支持的模型（部分常用）
 * 完整列表见 https://ai.t8star.cn/models
 * 用户可在模型名称字段填入任意贞贞支持的模型 ID
 */
export const ZHENZHEN_POPULAR_VIDEO_MODELS = [
  // Seedance (即梦视频)
  { id: "doubao-seedance-1-0-pro-250528", name: "Seedance Pro（最新）", category: "Seedance" },
  { id: "doubao-seedance-1-0-lite-t2v-250428", name: "Seedance Lite 文生视频", category: "Seedance" },
  { id: "doubao-seedance-1-0-lite-i2v-250428", name: "Seedance Lite 图生视频", category: "Seedance" },

  // Google Veo
  { id: "veo-3", name: "Google Veo 3", category: "Veo" },

  // 阿里 Wan (万相视频)
  { id: "wan-ai-1.3b", name: "Wan AI 1.3B", category: "Wan" },
  { id: "wan-ai-14b", name: "Wan AI 14B", category: "Wan" },

  // Grok 视频
  { id: "grok-video-3", name: "Grok Video 3", category: "Grok" },

  // Sora 2
  { id: "sora-2", name: "Sora 2", category: "Sora" },

  // Kling (可灵)
  { id: "kling-v2-6", name: "Kling V2.6", category: "Kling" },

  // Runway
  { id: "runway-gen4", name: "Runway Gen-4", category: "Runway" },

  // Luma
  { id: "luma-ray-2", name: "Luma Ray 2", category: "Luma" },

  // Pika
  { id: "pika-2.2", name: "Pika 2.2", category: "Pika" },

  // MiniMax
  { id: "minimax-video-01", name: "MiniMax Video 01", category: "MiniMax" },

  // Vidu
  { id: "viduq2", name: "Vidu Q2", category: "Vidu" },

  // Pixverse
  { id: "pixverse-v4.5", name: "Pixverse V4.5", category: "Pixverse" },

  // Higgsfield
  { id: "higgsfield", name: "Higgsfield", category: "Higgsfield" },

  // 智谱清影
  { id: "cogvideox", name: "智谱清影 CogVideoX", category: "智谱" },
] as const;

/**
 * 判断是否为贞贞 API 的 URL
 */
export function isZhenzhenUrl(url: string): boolean {
  return url.includes("t8star.cn") || url.includes("ai.t8star.cn");
}
