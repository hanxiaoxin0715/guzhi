/**
 * Seedance 2.0 类型定义
 * 从 seedance2.0 开源项目移植，适配 feicai-studio
 */

// ═══════════════════════════════════════════════════════════
// 模型与参数类型
// ═══════════════════════════════════════════════════════════

export type AspectRatio = "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
export type Duration = 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;
export type ModelId = "seedance-2.0" | "seedance-2.0-fast" | "video-3.0" | "video-3.0-fast" | "video-3.0-pro" | "video-3.5-pro";
export type ReferenceMode = "全能参考" | "首帧参考";
export type VideoQuality = "720P" | "1080P";

export type GenerationStatus = "idle" | "generating" | "success" | "error";

// ═══════════════════════════════════════════════════════════
// 常量配置
// ═══════════════════════════════════════════════════════════

/** 即梦 API 基础 URL */
export const JIMENG_BASE_URL = "https://jimeng.jianying.com";
export const DEFAULT_ASSISTANT_ID = 513695;
export const VERSION_CODE = "8.4.0";
export const PLATFORM_CODE = "7";
export const SEEDANCE_DRAFT_VERSION = "3.3.9";
/** 即梦视频 3.x 系列使用的 draft 版本（来源官网拦截 2026.02.26） */
export const VIDEOGEN_DRAFT_VERSION = "3.3.10";

/** 模型映射：前端模型ID → 即梦内部模型标识 */
export const MODEL_MAP: Record<ModelId, string> = {
  "seedance-2.0": "dreamina_seedance_40_pro",
  "seedance-2.0-fast": "dreamina_seedance_40",
  "video-3.0": "dreamina_ic_generate_video_model_vgfm_3.0",
  "video-3.0-fast": "dreamina_ic_generate_video_model_vgfm_3.0_fast",
  "video-3.0-pro": "dreamina_ic_generate_video_model_vgfm_3.0_pro",
  "video-3.5-pro": "dreamina_ic_generate_video_model_vgfm_3.5_pro",
};

/** 权益类型映射（来源官网拦截 2026.02.26） */
export const BENEFIT_TYPE_MAP: Record<ModelId, string> = {
  "seedance-2.0": "dreamina_video_seedance_20_pro",
  "seedance-2.0-fast": "dreamina_seedance_20_fast",
  "video-3.0": "basic_video_operation_vgfm_v_three",
  "video-3.0-fast": "basic_video_operation_vgfm_v_three",
  "video-3.0-pro": "basic_video_operation_vgfm_v_three",
  "video-3.5-pro": "basic_video_operation_vgfm_v_three",
};

/** 判断是否为即梦视频 3.x 系列模型（非 Seedance，使用 first_frame_image 结构） */
export function isVideoGenModel(modelId: ModelId): boolean {
  return modelId.startsWith("video-");
}

/** 不支持首尾帧的 3.x 模型（仅支持单图模式） */
const NO_FIRST_LAST_FRAME: Set<string> = new Set(["video-3.0-pro", "video-3.0-fast"]);

/** 判断 3.x 模型是否支持首尾帧模式（3.0 Pro/Fast 不支持，仅单图） */
export function isFirstLastFrameSupported(modelId: ModelId): boolean {
  return isVideoGenModel(modelId) && !NO_FIRST_LAST_FRAME.has(modelId);
}

/** 视频分辨率配置（按画质+宽高比查表） */
export const VIDEO_RESOLUTION: Record<VideoQuality, Record<AspectRatio, { width: number; height: number }>> = {
  "720P": {
    "1:1": { width: 720, height: 720 },
    "4:3": { width: 960, height: 720 },
    "3:4": { width: 720, height: 960 },
    "16:9": { width: 1280, height: 720 },
    "9:16": { width: 720, height: 1280 },
    "21:9": { width: 1680, height: 720 },
  },
  "1080P": {
    "1:1": { width: 1080, height: 1080 },
    "4:3": { width: 1440, height: 1080 },
    "3:4": { width: 1080, height: 1440 },
    "16:9": { width: 1920, height: 1080 },
    "9:16": { width: 1080, height: 1920 },
    "21:9": { width: 2520, height: 1080 },
  },
};

/** 伪造请求头，模拟浏览器访问 */
export const FAKE_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-language": "zh-CN,zh;q=0.9",
  "App-Sdk-Version": "48.0.0",
  "Cache-control": "no-cache",
  Appid: String(DEFAULT_ASSISTANT_ID),
  Appvr: VERSION_CODE,
  Lan: "zh-Hans",
  Loc: "cn",
  Origin: "https://jimeng.jianying.com",
  Pragma: "no-cache",
  Priority: "u=1, i",
  Referer: "https://jimeng.jianying.com",
  Pf: PLATFORM_CODE,
  "Sec-Ch-Ua": '"Google Chrome";v="132", "Chromium";v="132", "Not_A Brand";v="8"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
};

// ═══════════════════════════════════════════════════════════
// 前端 UI 选项配置
// ═══════════════════════════════════════════════════════════

export interface ModelOption {
  value: ModelId;
  label: string;
  description: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    value: "seedance-2.0",
    label: "Seedance 2.0",
    description: "高质量，全能主角，音视频图均可参考",
  },
  {
    value: "seedance-2.0-fast",
    label: "Seedance 2.0 Fast",
    description: "快速生成，精简时长",
  },
  {
    value: "video-3.5-pro",
    label: "视频 3.5 Pro",
    description: "最新旗舰，仅首帧参考",
  },
  {
    value: "video-3.0-pro",
    label: "视频 3.0 Pro",
    description: "高质量，仅首帧参考",
  },
  {
    value: "video-3.0",
    label: "视频 3.0",
    description: "标准质量，仅首帧参考",
  },
  {
    value: "video-3.0-fast",
    label: "视频 3.0 Fast",
    description: "快速生成，仅首帧参考",
  },
];

export interface RatioOption {
  value: AspectRatio;
  label: string;
}

export const RATIO_OPTIONS: RatioOption[] = [
  { value: "21:9", label: "21:9" },
  { value: "16:9", label: "16:9" },
  { value: "4:3", label: "4:3" },
  { value: "1:1", label: "1:1" },
  { value: "3:4", label: "3:4" },
  { value: "9:16", label: "9:16" },
];

export const DURATION_OPTIONS: Duration[] = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/** 3.x 系列可选时长：固定按钮（非连续滑块），数据来源即梦官网 */
export const VIDEOGEN_DURATION_OPTIONS: Partial<Record<ModelId, Duration[]>> = {
  "video-3.5-pro": [5, 10, 12],
  "video-3.0-pro": [5, 10],
  "video-3.0":     [5, 10],
  "video-3.0-fast": [5, 10],
};

export const REFERENCE_MODES: ReferenceMode[] = ["全能参考", "首帧参考"];

// ═══════════════════════════════════════════════════════════
// API 请求/响应类型
// ═══════════════════════════════════════════════════════════

/** 前端发送到后端的生成请求 */
export interface GenerateVideoRequest {
  prompt: string;
  model: ModelId;
  ratio: AspectRatio;
  duration: Duration;
  sessionId: string;
  files: File[];
}

/** 后端返回的任务ID */
export interface GenerateVideoResponse {
  taskId: string;
}

/** 轮询返回的任务状态 */
export interface TaskStatusResponse {
  status: "processing" | "done" | "error";
  elapsed: number;
  progress?: string;
  result?: {
    created: number;
    data: Array<{ url: string; revised_prompt: string }>;
  };
  error?: string;
}

/** 内部任务对象 */
export interface SeedanceTask {
  id: string;
  status: "processing" | "done" | "error";
  progress: string;
  startTime: number;
  result: {
    created: number;
    data: Array<{ url: string; revised_prompt: string }>;
  } | null;
  error: string | null;
}

/** 已上传的图片信息 */
export interface UploadedImage {
  uri: string;
  width: number;
  height: number;
}

/** 已上传的音频信息 */
export interface UploadedAudio {
  uri: string;
  name: string;
}

/** meta_list 中的条目 */
export interface MetaItem {
  meta_type: "text" | "image" | "audio";
  text: string;
  material_ref?: { material_idx: number };
}

// ═══════════════════════════════════════════════════════════
// 积分消耗估算（数据来源：即梦官网 2026.02.26 实测）
// ───────────────────────────────────────────────────────────
// Seedance 2.0 Pro:  720P=5/秒  1080P=8/秒
// Seedance 2.0 Fast: 720P=3/秒  1080P=5/秒
// 视频 3.5 Pro:      8积分/秒（仅720P）
// 视频 3.0 Pro:      10积分/秒（仅720P）
// 视频 3.0:          2积分/秒（仅720P）
// 视频 3.0 Fast:     2积分/秒（仅720P）
// 3.x 系列仅支持720P自动匹配，1080P列保留兼容但值同720P
// ═══════════════════════════════════════════════════════════

/** 每秒积分消耗表：[模型][画质] → 积分/秒 */
export const CREDIT_PER_SECOND: Record<ModelId, Record<VideoQuality, number>> = {
  "seedance-2.0":      { "720P": 5, "1080P": 8 },
  "seedance-2.0-fast": { "720P": 3, "1080P": 5 },
  "video-3.5-pro":     { "720P": 8, "1080P": 8 },
  "video-3.0-pro":     { "720P": 10, "1080P": 10 },
  "video-3.0":         { "720P": 2, "1080P": 2 },
  "video-3.0-fast":    { "720P": 2, "1080P": 2 },
};

/** 计算当前参数组合的预估积分消耗 */
export function estimateCredits(
  model: ModelId,
  duration: Duration,
  quality: VideoQuality,
): number {
  const perSec = CREDIT_PER_SECOND[model]?.[quality] ?? 5;
  return perSec * duration;
}
