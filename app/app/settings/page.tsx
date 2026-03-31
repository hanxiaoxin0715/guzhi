"use client";

import { useState, useEffect } from "react";
import { useToast } from "../components/Toast";
import Sidebar from "../components/Sidebar";
import { Save, Zap, Image, Video, ExternalLink, Loader, Plus, Trash2, Check, ChevronDown, FolderOpen, Eye, EyeOff, Upload } from "lucide-react";
import { kvLoad, kvSet } from "../lib/kvDB";

// ═══════════════════════════════════════════════════════════
// LLM Presets
// ═══════════════════════════════════════════════════════════

interface LLMPreset {
  id: string;
  label: string;
  provider: string;
  model: string;
  url: string;
}

const LLM_PRESETS: LLMPreset[] = [
  {
    id: "google-gemini-25-pro",
    label: "Google · Gemini 2.5 Pro（官方直连）",
    provider: "gemini",
    model: "gemini-2.5-pro-preview-06-05",
    url: "https://generativelanguage.googleapis.com",
  },
  {
    id: "google-gemini-25-flash",
    label: "Google · Gemini 2.5 Flash（官方直连）",
    provider: "gemini",
    model: "gemini-2.5-flash-preview-05-20",
    url: "https://generativelanguage.googleapis.com",
  },
  {
    id: "ussn-gemini-25-pro",
    label: "USSN · Gemini 2.5 Pro",
    provider: "openAi",
    model: "gemini-2.5-pro",
    url: "https://api.ussn.cn/v1",
  },
  {
    id: "geeknow-gemini",
    label: "GeeKnow · Gemini 2.5 Pro",
    provider: "openAi",
    model: "gemini-2.5-pro",
    url: "",
  },
  {
    id: "dashscope-qwen3-max",
    label: "通义千问 · Qwen3-Max（长文本·官方）",
    provider: "dashscope-responses",
    model: "qwen3-max",
    url: "https://dashscope.aliyuncs.com/api/v2/apps/protocols/compatible-mode/v1",
  },
  {
    id: "qwen-vl-plus",
    label: "通义千问 · Qwen-VL-Plus",
    provider: "dashscope",
    model: "qwen-vl-plus",
    url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  {
    id: "volcengine-doubao-pro",
    label: "火山引擎 · Doubao（需填 Endpoint ID）",
    provider: "openAi",
    model: "ep-替换为你的接入点ID",
    url: "https://ark.cn-beijing.volces.com/api/v3",
  },
  // 七牛云官网获取 API Key: https://s.qiniu.com/VZz67r
  {
    id: "qiniu-llm",
    label: "七牛云",
    provider: "openAi",
    model: "deepseek-v3",
    url: "https://api.qnaigc.com/v1",
  },
  // 云雾 API（https://yunwu.ai）— OpenAI 兼容格式，588+ 全模型
  {
    id: "yunwu-llm",
    label: "⭐ 云雾 API（填写模型，GPT/Claude/Gemini/DeepSeek 等 342+ 模型）",
    provider: "openAi",
    model: "",
    url: "https://yunwu.ai/v1",
  },
  // 贞贞的AI工坊 — OpenAI 兼容格式 /v1/chat/completions，911+ 全模型
  {
    id: "zhenzhen-llm",
    label: "⭐ 贞贞的工作坊（填写模型，911+全模型）",
    provider: "openAi",
    model: "",
    url: "https://ai.t8star.cn/v1",
  },
];

// ═══════════════════════════════════════════════════════════
// Image Presets
// ═══════════════════════════════════════════════════════════

interface ImagePreset {
  id: string;
  label: string;
  model: string;
  url: string;
  format: "gemini" | "openai" | "openai-images";  // API protocol format
  urlHint: string;               // help text for the Base URL field
}

const IMAGE_PRESETS: ImagePreset[] = [
  {
    id: "google-gemini-image",
    label: "Google · Gemini 2.5 Flash Image（官方直连）",
    model: "gemini-2.5-flash-preview-image-generation",
    url: "https://generativelanguage.googleapis.com",
    format: "gemini",
    urlHint: "Base URL（不含 /v1beta）",
  },
  {
    id: "ussn-gemini-3-pro-image",
    label: "USSN · Gemini 3 Pro Image (Gemini格式)",
    model: "gemini-3-pro-image-preview",
    url: "https://api.ussn.cn",
    format: "gemini",
    urlHint: "Base URL（不含 /v1beta）",
  },
  {
    id: "geeknow-gemini-image",
    label: "GeeKnow · Gemini 3.1 Flash Image (Gemini格式)",
    model: "gemini-3.1-flash-image-preview",
    url: "",
    format: "gemini",
    urlHint: "Base URL（不含 /v1beta）",
  },
  {
    id: "geeknow-grok-image",
    label: "GeeKnow · Grok-4-1-Image (OpenAI格式)",
    model: "grok-4-1-image",
    url: "",
    format: "openai",
    urlHint: "Base URL（不含 /v1）",
  },
  // 七牛云官网获取 API Key: https://s.qiniu.com/VZz67r
  {
    id: "qiniu-image",
    label: "七牛云 · Kling V2",
    model: "kling-v2",
    url: "https://api.qnaigc.com",
    format: "openai-images",
    urlHint: "Base URL（不含 /v1）",
  },
  {
    id: "qiniu-gemini-image",
    label: "七牛云 · Gemini 3.1 Flash Image",
    model: "gemini-3.1-flash-image-preview",
    url: "https://api.qnaigc.com",
    format: "openai-images",
    urlHint: "Base URL（不含 /v1）",
  },
  // 云雾 API（https://yunwu.ai）— Dalle 格式 /v1/images/generations，支持 GPT-Image/Flux/DALL-E 等
  {
    id: "yunwu-image",
    label: "⭐ 云雾 API（填写模型，GPT-Image/Flux/DALL-E 等 127+ 模型）",
    model: "",
    url: "https://yunwu.ai",
    format: "openai-images",
    urlHint: "Base URL（不含 /v1）",
  },
  // 贞贞的AI工坊 — Dalle 格式 /v1/images/generations，支持 gpt-image-1/flux/dall-e-3/即梦等
  {
    id: "zhenzhen-image",
    label: "⭐ 贞贞的工作坊（填写模型，Dalle/Flux/即梦等）",
    model: "",
    url: "https://ai.t8star.cn",
    format: "openai-images",
    urlHint: "Base URL（不含 /v1）",
  },
];

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

type VideoMode = "single" | "firstlast" | "multiref" | "batchRelay";

interface VideoModelConfig {
  id: string;
  name: string;
  model: string;             // API model identifier, e.g. "veo_3_1-fast"
  url: string;
  apiKey: string;
  provider: "third-party" | "official";
  modes: VideoMode[];
}

interface ConfigField {
  key: string;
  label: string;
  defaultValue: string;
  type: "text" | "select" | "password";
}

interface ConfigSection {
  id: string;
  title: string;
  icon: "zap" | "image" | "video";
  fields: ConfigField[];
}

const configSections: ConfigSection[] = [
  {
    id: "image",
    title: "图像生成",
    icon: "image",
    fields: [
      { key: "img-format", label: "API 协议格式", defaultValue: "gemini", type: "select" },
      { key: "img-model", label: "Model", defaultValue: "gemini-2.5-flash-image-preview", type: "text" },
      { key: "img-key", label: "API Key", defaultValue: "", type: "password" },
      { key: "img-url", label: "Base URL（不含 /v1beta）", defaultValue: "", type: "text" },
    ],
  },
];

// ═══════════════════════════════════════════════════════════
// Video Presets (templates for quick-adding video models)
// ═══════════════════════════════════════════════════════════

interface VideoPreset {
  id: string;
  label: string;
  model: string;
  url: string;
  provider: "third-party" | "official";
  modes: VideoMode[];
}

const VIDEO_PRESETS: VideoPreset[] = [
  {
    id: "google-veo-3",
    label: "Google · Veo 3（官方直连·单图）",
    model: "veo-3",
    url: "https://generativelanguage.googleapis.com",
    provider: "official",
    modes: ["single"],
  },
  {
    id: "ussn-veo-31-fast-4k",
    label: "USSN · VEO 3.1 Fast 4K（单图、首尾帧、批量接力）",
    model: "veo_3_1-fast-4K",
    url: "https://api.ussn.cn/v1",
    provider: "third-party",
    modes: ["single", "firstlast", "batchRelay"],
  },
  // ═══ GeekNow 中转平台 — /v1/videos 接口 ═══
  // 官网: https://www.geeknow.top  CDN线路: https://api.geeknow.top  国内线路: https://geek.closeai.icu
  // 支持 Sora/Veo/Grok/Seedance/Wan2.6/Vidu/Kling/Hailuo 等 28+ 模型
  {
    id: "geeknow-video",
    label: "⭐ GeekNow 中转（填写模型，Sora/Veo/Grok/豆包/可灵/海螺等）",
    model: "",
    url: "",
    provider: "third-party",
    modes: ["single", "firstlast", "multiref", "batchRelay"],
  },
  // 七牛云官网获取 API Key: https://s.qiniu.com/VZz67r
  // 支持 ViduQ2 / Sora 2 / Kling V2.6 等视频模型
  {
    id: "qiniu-video",
    label: "七牛云（ViduQ2/Sora2/Kling，国内直连）",
    model: "",
    url: "https://api.qnaigc.com/v1",
    provider: "third-party",
    modes: ["single"],
  },
  // ═══ 云雾 API（https://yunwu.ai）— 全模型聚合，588+ 模型 ═══
  // 支持 Veo/Sora/Seedance/Kling/Vidu/Grok/Wan/Runway/Luma 等 73+ 视频模型
  // 官方获取 API Key: https://yunwu.ai → 登录后令牌管理
  {
    id: "yunwu-video",
    label: "⭐ 云雾 API（Veo/Sora/Seedance/可灵/Vidu/Grok 等 73+ 模型）",
    model: "",
    url: "https://yunwu.ai",
    provider: "third-party",
    modes: ["single", "firstlast", "multiref", "batchRelay"],
  },
  // 火山引擎控制台获取 API Key: https://console.volcengine.com/ark
  {
    id: "volcengine-video",
    label: "火山引擎（填写模型 ID）",
    model: "",
    url: "https://ark.cn-beijing.volces.com/api/v3",
    provider: "third-party",
    modes: ["single"],
  },
  // ═══ 贞贞的AI工坊（https://ai.t8star.cn）— 统一格式 v2 接口 ═══
  // 911+ 模型，支持 Seedance / Veo / Sora / Kling / Runway / Luma / Pika 等
  // 官方获取 API Key: https://ai.t8star.cn → 登录后个人中心
  {
    id: "zhenzhen-workshop",
    label: "⭐ 贞贞的工作坊（填写模型，911+全模型）",
    model: "",
    url: "https://ai.t8star.cn",
    provider: "third-party",
    modes: ["single", "firstlast", "multiref", "batchRelay"],
  },
];

// ═══════════════════════════════════════════════════════════
// 平台内置模型目录（子菜单选择）
// ═══════════════════════════════════════════════════════════

interface SubModelEntry {
  label: string;
  model: string;
  modes: VideoMode[];
  group: string;
}

// GeekNow 中转平台模型（来源: GeeKnow API 文档 _MODEL_DISPLAY_MAP）
const GEEKNOW_MODELS: SubModelEntry[] = [
  { group: "Sora", label: "Sora 2", model: "sora-2", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Sora", label: "Sora 2 [VIP]", model: "sora-2[vip]", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Sora", label: "Sora 3", model: "sora3", modes: ["single"] },
  { group: "Sora", label: "Sora2 Pro 横屏 25s", model: "sora2-pro-landscape-25s", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Sora", label: "Sora2 Pro 横屏HD 10s", model: "sora2-pro-landscape-hd-10s", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Sora", label: "Sora2 Pro 横屏HD 15s", model: "sora2-pro-landscape-hd-15s", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Sora", label: "Sora2 Pro 竖屏 25s", model: "sora2-pro-portrait-25s", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Sora", label: "Sora2 Pro 竖屏HD 10s", model: "sora2-pro-portrait-hd-10s", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Sora", label: "Sora2 Pro 竖屏HD 15s", model: "sora2-pro-portrait-hd-15s", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Veo", label: "VEO 3.1", model: "veo_3_1", modes: ["single", "firstlast", "multiref", "batchRelay"] },
  { group: "Veo", label: "VEO 3.1 Fast", model: "veo_3_1-fast", modes: ["single", "firstlast", "multiref", "batchRelay"] },
  { group: "Grok", label: "Grok Video 3", model: "grok-video-3", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Grok", label: "Grok Video 3 Pro (10s)", model: "grok-video-3-pro", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Grok", label: "Grok Video 3 Max (15s)", model: "grok-video-3-max", modes: ["single", "firstlast", "batchRelay"] },
  { group: "豆包 Seedance", label: "Seedance 1.5 Pro 480p", model: "doubao-seedance-1-5-pro_480p", modes: ["single", "firstlast", "batchRelay"] },
  { group: "豆包 Seedance", label: "Seedance 1.5 Pro 720p", model: "doubao-seedance-1-5-pro_720p", modes: ["single", "firstlast", "batchRelay"] },
  { group: "豆包 Seedance", label: "Seedance 1.5 Pro 1080p", model: "doubao-seedance-1-5-pro_1080p", modes: ["single", "firstlast", "batchRelay"] },
  { group: "万象 Wan", label: "Wan2.6 文生视频 720P", model: "wan2.6-t2v:1280*720", modes: ["single"] },
  { group: "万象 Wan", label: "Wan2.6 文生视频 1080P", model: "wan2.6-t2v:1920*1080", modes: ["single"] },
  { group: "万象 Wan", label: "Wan2.6 图生视频 720P", model: "wan2.6-i2v:1280*720", modes: ["single", "firstlast", "batchRelay"] },
  { group: "万象 Wan", label: "Wan2.6 图生视频 1080P", model: "wan2.6-i2v:1920*1080", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Vidu", label: "Vidu Q3 Pro", model: "Vidu-q3-pro", modes: ["single"] },
  { group: "Vidu", label: "Vidu Q3 Turbo", model: "Vidu-q3-turbo", modes: ["single"] },
  { group: "可灵 Kling", label: "Kling 2.6", model: "Kling-2.6", modes: ["single", "firstlast", "batchRelay"] },
  { group: "可灵 Kling", label: "Kling 3.0", model: "Kling-3.0", modes: ["single", "firstlast", "batchRelay"] },
  { group: "可灵 Kling", label: "Kling 3.0 Omni", model: "Kling-3.0-Omni", modes: ["single", "firstlast", "batchRelay"] },
  { group: "海螺 Hailuo", label: "Hailuo 2.3", model: "Hailuo-2.3", modes: ["single"] },
  { group: "海螺 Hailuo", label: "Hailuo 2.3 Fast", model: "Hailuo-2.3-fast", modes: ["single"] },
];

// 贞贞工坊模型（来源: ai.t8star.cn/models API文档，精选常用视频模型）
const ZHENZHEN_MODELS: SubModelEntry[] = [
  { group: "Veo", label: "VEO 3.1 Pro ($1)", model: "veo3.1-pro", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Veo", label: "VEO 3.1 Pro 4K ($2)", model: "veo3.1-pro-4k", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Veo", label: "VEO 3.1 ($0.3)", model: "veo3.1", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Veo", label: "VEO 3.1 Fast ($0.2)", model: "veo3.1-fast", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Veo", label: "VEO 3.1 4K ($0.5)", model: "veo3.1-4k", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Veo", label: "VEO 3.1 Components ($0.3)", model: "veo3.1-components", modes: ["single", "multiref"] },
  { group: "Veo", label: "VEO 3 ($1.5)", model: "veo3", modes: ["single"] },
  { group: "Veo", label: "VEO 3 Pro ($3)", model: "veo3-pro", modes: ["single"] },
  { group: "Veo", label: "VEO 3 Pro Frames ($3)", model: "veo3-pro-frames", modes: ["single", "firstlast", "batchRelay"] },
  { group: "即梦 Seedance", label: "Seedance 1.0 Pro 250528", model: "doubao-seedance-1-0-pro-250528", modes: ["single", "firstlast", "batchRelay"] },
  { group: "即梦 Seedance", label: "Seedance 1.5 Pro 251215", model: "doubao-seedance-1-5-pro-251215", modes: ["single", "firstlast", "batchRelay"] },
  { group: "即梦 Seedance", label: "Seedance 1.0 Pro Fast", model: "doubao-seedance-1-0-pro-fast-251015", modes: ["single", "firstlast", "batchRelay"] },
  { group: "即梦 Seedance", label: "Seedance 1.0 Lite T2V", model: "doubao-seedance-1-0-lite-t2v-250428", modes: ["single"] },
  { group: "即梦 Seedance", label: "Seedance 1.0 Lite I2V", model: "doubao-seedance-1-0-lite-i2v-250428", modes: ["single", "firstlast", "multiref", "batchRelay"] },
  { group: "Sora", label: "Sora 2 ($0.4)", model: "sora-2", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Sora", label: "Sora 2 Pro ($1.2/s)", model: "sora-2-pro", modes: ["single", "firstlast", "batchRelay"] },
  { group: "可灵 Kling", label: "可灵 Omni O1 ($0.8)", model: "kling-video-o1", modes: ["single", "firstlast", "batchRelay"] },
  { group: "可灵 Kling", label: "可灵 V3 ($1)", model: "kling-video-v3", modes: ["single", "firstlast", "batchRelay"] },
  { group: "可灵 Kling", label: "可灵 V3 Omni ($1)", model: "kling-video-v3-omni", modes: ["single", "firstlast", "batchRelay"] },
  { group: "可灵 Kling", label: "可灵 V2.6 ($2.5)", model: "kling-video-v2-6", modes: ["single", "firstlast", "batchRelay"] },
  { group: "海螺 MiniMax", label: "Hailuo 2.3 ($2)", model: "MiniMax-Hailuo-2.3", modes: ["single"] },
  { group: "海螺 MiniMax", label: "Hailuo 2.3 Fast ($1.35)", model: "MiniMax-Hailuo-2.3-Fast", modes: ["single"] },
  { group: "Runway", label: "Runway Aleph ($1.5)", model: "runway-aleph", modes: ["single"] },
  { group: "Runway", label: "Runway Generate ($0.6)", model: "runway-generate", modes: ["single", "firstlast", "batchRelay"] },
  { group: "万象 Wan", label: "Wan 2.6 文生视频 ($4)", model: "wan2.6-t2v", modes: ["single"] },
  { group: "万象 Wan", label: "Wan 2.6 图生视频 ($4)", model: "wan2.6-i2v", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Grok", label: "Grok Video 3 ($0.5)", model: "grok-video-3", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Vidu", label: "Vidu 2.0", model: "vidu2.0", modes: ["single"] },
  { group: "Vidu", label: "Vidu Q3 Pro", model: "viduq3-pro", modes: ["single"] },
  { group: "其他", label: "Luma AI ($2)", model: "luma_video_api", modes: ["single"] },
  { group: "其他", label: "PixVerse ($0.8)", model: "pixverse-video", modes: ["single"] },
  { group: "其他", label: "Pika ($0.6)", model: "pika-generate", modes: ["single"] },
];

// 七牛云模型（来源: api.qnaigc.com，国内直连）
const QINIU_MODELS: SubModelEntry[] = [
  { group: "Vidu", label: "ViduQ2", model: "viduq2", modes: ["single"] },
  { group: "Sora", label: "Sora 2", model: "sora-2", modes: ["single"] },
  { group: "可灵 Kling", label: "Kling V2.6", model: "kling-v2-6", modes: ["single"] },
];

// 云雾 API 模型（来源: yunwu.ai，588+ 全模型聚合平台）
const YUNWU_MODELS: SubModelEntry[] = [
  // ── Veo 3.1 系列 ──
  { group: "Veo 3.1", label: "VEO 3.1 Fast (⚡0.700)", model: "veo3.1-fast", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Veo 3.1", label: "VEO 3.1 (⚡0.700)", model: "veo3.1", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Veo 3.1", label: "VEO 3.1 Pro (⚡3.500)", model: "veo3.1-pro", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Veo 3.1", label: "VEO 3.1 4K (⚡1.000)", model: "veo3.1-4k", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Veo 3.1", label: "VEO 3.1 Pro 4K (⚡3.500)", model: "veo3.1-pro-4k", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Veo 3.1", label: "VEO 3.1 Components (⚡0.420)", model: "veo3.1-components", modes: ["single", "multiref"] },
  { group: "Veo 3.1", label: "VEO 3.1 Fast Components (⚡0.156)", model: "veo3.1-fast-components", modes: ["single", "multiref"] },
  { group: "Veo 3.1", label: "VEO 3.1 [低价] (⚡0.438)", model: "veo_3_1", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Veo 3.1", label: "VEO 3.1 Fast [低价] (⚡0.258)", model: "veo_3_1-fast", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Veo 3.1", label: "VEO 3.1 Components [低价] (⚡0.438)", model: "veo_3_1-components", modes: ["single", "multiref"] },
  { group: "Veo 3.1", label: "VEO 3.1 4K [低价] (⚡0.510)", model: "veo_3_1-4K", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Veo 3.1", label: "VEO 3.1 Fast 4K [低价] (⚡0.258)", model: "veo_3_1-fast-4K", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Veo 3.1", label: "VEO 3.1 Components 4K [低价] (⚡0.510)", model: "veo_3_1-components-4K", modes: ["single", "multiref"] },
  { group: "Veo 3.1", label: "VEO 3.1 Fast Components 4K [低价] (⚡0.516)", model: "veo_3_1-fast-components-4K", modes: ["single", "multiref"] },
  // ── Veo 3 系列 ──
  { group: "Veo 3", label: "VEO 3 (⚡0.900)", model: "veo3", modes: ["single", "batchRelay"] },
  { group: "Veo 3", label: "VEO 3 Fast (⚡0.900)", model: "veo3-fast", modes: ["single", "batchRelay"] },
  { group: "Veo 3", label: "VEO 3 Frames (⚡0.900)", model: "veo3-frames", modes: ["single", "firstlast"] },
  { group: "Veo 3", label: "VEO 3 Fast Frames (⚡0.900)", model: "veo3-fast-frames", modes: ["single", "firstlast"] },
  { group: "Veo 3", label: "VEO 3 Pro (⚡4.000)", model: "veo3-pro", modes: ["single", "batchRelay"] },
  { group: "Veo 3", label: "VEO 3 Pro Frames (⚡4.000)", model: "veo3-pro-frames", modes: ["single", "firstlast"] },
  // ── Veo 2 系列 ──
  { group: "Veo 2", label: "VEO 2 (⚡0.450)", model: "veo2", modes: ["single", "batchRelay"] },
  { group: "Veo 2", label: "VEO 2 Fast (⚡0.450)", model: "veo2-fast", modes: ["single", "batchRelay"] },
  { group: "Veo 2", label: "VEO 2 Fast Frames (⚡0.450)", model: "veo2-fast-frames", modes: ["single", "firstlast"] },
  { group: "Veo 2", label: "VEO 2 Fast Components (⚡0.450)", model: "veo2-fast-components", modes: ["single", "multiref"] },
  { group: "Veo 2", label: "VEO 2 Pro (⚡4.000)", model: "veo2-pro", modes: ["single", "batchRelay"] },
  { group: "Veo 2", label: "VEO 2 Pro Components (⚡4.000)", model: "veo2-pro-components", modes: ["single", "multiref"] },
  // ── Sora 系列 ──
  { group: "Sora", label: "Sora 2 All (⚡0.200)", model: "sora-2-all", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Sora", label: "Sora 2 Pro All (⚡3.600)", model: "sora-2-pro-all", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Sora", label: "Sora 2 VIP All (⚡2.500)", model: "sora-2-vip-all", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Sora", label: "Sora 2 (⚡0.100/s)", model: "sora-2", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Sora", label: "Sora 2 Pro (⚡2.400/s)", model: "sora-2-pro", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Sora", label: "Sora 2 Characters (⚡0.010)", model: "sora-2-characters", modes: ["single"] },
  // ── Seedance/豆包 系列 ──
  { group: "Seedance", label: "Seedance 1.5 Pro (⚡24.000)", model: "doubao-seedance-1-5-pro-251215", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Seedance", label: "Seedance 1.0 Pro (⚡22.500)", model: "doubao-seedance-1-0-pro-250528", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Seedance", label: "Seedance 1.0 Pro Fast (⚡6.300)", model: "doubao-seedance-1-0-pro-fast-251015", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Seedance", label: "Seedance 1.0 Lite I2V (⚡15.000)", model: "doubao-seedance-1-0-lite-i2v-250428", modes: ["single"] },
  { group: "Seedance", label: "Seedance 1.0 Lite T2V (⚡15.000)", model: "doubao-seedance-1-0-lite-t2v-250428", modes: ["single"] },
  // ── Kling/可灵 系列 ──
  { group: "Kling", label: "Kling Video (⚡1.700)", model: "kling-video", modes: ["single", "firstlast", "batchRelay"] },
  { group: "Kling", label: "Kling Omni Video (⚡1.700)", model: "kling-omni-video", modes: ["single"] },
  { group: "Kling", label: "Kling Video Extend (⚡1.700)", model: "kling-video-extend", modes: ["single"] },
  { group: "Kling", label: "Kling Multi Elements (⚡1.700)", model: "kling-multi-elements", modes: ["single", "multiref"] },
  { group: "Kling", label: "Kling Effects (⚡3.400)", model: "kling-effects", modes: ["single"] },
  { group: "Kling", label: "Kling Motion Control (⚡0.850/s)", model: "kling-motion-control", modes: ["single"] },
  { group: "Kling", label: "Kling Lip Sync (⚡0.850)", model: "kling-advanced-lip-sync", modes: ["single"] },
  { group: "Kling", label: "Kling Avatar I2V (⚡0.680)", model: "kling-avatar-image2video", modes: ["single"] },
  // ── Vidu 系列 ──
  { group: "Vidu", label: "ViduQ2 Turbo (⚡0.300)", model: "viduq2-turbo", modes: ["single"] },
  { group: "Vidu", label: "ViduQ2 (⚡0.300)", model: "viduq2", modes: ["single"] },
  { group: "Vidu", label: "ViduQ2 Pro (⚡0.400)", model: "viduq2-pro", modes: ["single"] },
  { group: "Vidu", label: "ViduQ1 (⚡1.000)", model: "viduq1", modes: ["single", "firstlast"] },
  { group: "Vidu", label: "ViduQ1 Classic (⚡4.000)", model: "viduq1-classic", modes: ["single", "firstlast"] },
  { group: "Vidu", label: "Vidu 2.0 (⚡1.000)", model: "vidu2.0", modes: ["single", "firstlast"] },
  { group: "Vidu", label: "ViduQ3 Pro (⚡3.500)", model: "viduq3-pro", modes: ["single"] },
  // ── Grok 系列 ──
  { group: "Grok", label: "Grok Video 3 (⚡0.200)", model: "grok-video-3", modes: ["single"] },
  { group: "Grok", label: "Grok Video 3 10s (⚡0.400)", model: "grok-video-3-10s", modes: ["single"] },
  { group: "Grok", label: "Grok Video 3 15s (⚡0.500)", model: "grok-video-3-15s", modes: ["single"] },
  // ── Wan/通义万象 系列 ──
  { group: "Wan", label: "Wan 2.6 I2V (⚡1.000/s)", model: "wan2.6-i2v", modes: ["single"] },
  { group: "Wan", label: "Wan 2.6 I2V Flash (⚡0.500/s)", model: "wan2.6-i2v-flash", modes: ["single"] },
  { group: "Wan", label: "Wan 2.5 I2V Preview (⚡1.000/s)", model: "wan2.5-i2v-preview", modes: ["single"] },
  // ── AIGC 聚合模型 ──
  { group: "AIGC", label: "AIGC Hailuo (⚡0.276)", model: "aigc-video-hailuo", modes: ["single"] },
  { group: "AIGC", label: "AIGC Kling (⚡0.360)", model: "aigc-video-kling", modes: ["single"] },
  { group: "AIGC", label: "AIGC Vidu (⚡0.225)", model: "aigc-video-vidu", modes: ["single"] },
  // ── Minimax/Hailuo ──
  { group: "Minimax", label: "Hailuo 02 (⚡3.200)", model: "MiniMax-Hailuo-02", modes: ["single"] },
  { group: "Minimax", label: "Hailuo 2.3 (⚡3.200)", model: "MiniMax-Hailuo-2.3", modes: ["single"] },
  // ── Luma ──
  { group: "Luma", label: "Luma Video API (⚡3.600)", model: "luma_video_api", modes: ["single"] },
  { group: "Luma", label: "Luma Video Extend (⚡3.600)", model: "luma_video_extend_api", modes: ["single"] },
  // ── Runway ──
  { group: "Runway", label: "Gen-4 Turbo 10s (⚡4.000)", model: "runwayml-gen4_turbo-10", modes: ["single"] },
  { group: "Runway", label: "Gen-4 Turbo 5s (⚡2.000)", model: "runwayml-gen4_turbo-5", modes: ["single"] },
  { group: "Runway", label: "Gen-3A Turbo 10s (⚡4.000)", model: "runwayml-gen3a_turbo-10", modes: ["single"] },
  { group: "Runway", label: "Gen-3A Turbo 5s (⚡2.000)", model: "runwayml-gen3a_turbo-5", modes: ["single"] },
  // ── Replicate ──
  { group: "Replicate", label: "Minimax Video-01 (⚡3.750)", model: "minimax/video-01", modes: ["single"] },
  { group: "Replicate", label: "Minimax Video-01 Live (⚡3.750)", model: "minimax/video-01-live", modes: ["single"] },
  { group: "Replicate", label: "VACE-14B (⚡5.175)", model: "prunaai/vace-14b", modes: ["single"] },
];

// 获取平台对应的子模型列表
function getSubModels(presetId: string): SubModelEntry[] {
  if (presetId === "geeknow-video") return GEEKNOW_MODELS;
  if (presetId === "zhenzhen-workshop") return ZHENZHEN_MODELS;
  if (presetId === "qiniu-video") return QINIU_MODELS;
  if (presetId === "yunwu-video") return YUNWU_MODELS;
  return [];
}

// 获取平台显示前缀
function getPlatformPrefix(presetId: string): string {
  if (presetId === "geeknow-video") return "GeekNow";
  if (presetId === "zhenzhen-workshop") return "贞贞";
  if (presetId === "qiniu-video") return "七牛云";
  if (presetId === "yunwu-video") return "云雾";
  return "";
}

// 按 group 分组子模型
function groupSubModels(models: SubModelEntry[]): { group: string; items: SubModelEntry[] }[] {
  const groups: { group: string; items: SubModelEntry[] }[] = [];
  for (const m of models) {
    const last = groups[groups.length - 1];
    if (last && last.group === m.group) {
      last.items.push(m);
    } else {
      groups.push({ group: m.group, items: [m] });
    }
  }
  return groups;
}

// ═══════════════════════════════════════════════════════════
// LLM / Image 平台子模型目录（子菜单选择）
// ═══════════════════════════════════════════════════════════

interface PlatformSubModel {
  label: string;
  model: string;
  group: string;
}

// ── 七牛云 LLM 模型（来源: api.qnaigc.com） ──
const QINIU_LLM_MODELS: PlatformSubModel[] = [
  { group: "DeepSeek", label: "DeepSeek V3.2", model: "deepseek-v3.2" },
  { group: "DeepSeek", label: "DeepSeek R1-0528", model: "deepseek-r1-0528" },
  { group: "DeepSeek", label: "DeepSeek V3", model: "deepseek-v3" },
  { group: "Kimi", label: "Kimi K2.5", model: "kimi-k2.5" },
  { group: "Kimi", label: "Kimi K2 Thinking", model: "kimi-k2-thinking" },
  { group: "GLM", label: "GLM 5", model: "glm-5" },
  { group: "GLM", label: "GLM 4.7", model: "glm-4.7" },
  { group: "Minimax", label: "Minimax M2.5", model: "minimax-m2.5" },
  { group: "Minimax", label: "Minimax M2.1", model: "minimax-m2.1" },
  { group: "通义千问", label: "Qwen3.5", model: "qwen3.5" },
  { group: "通义千问", label: "Qwen3 Max", model: "qwen3-max" },
  { group: "通义千问", label: "Qwen3 Turbo", model: "qwen3-turbo" },
  { group: "豆包", label: "Doubao Seed 2.0 Pro", model: "doubao-seed-2.0-pro" },
  { group: "豆包", label: "Doubao Seed 1.6 Pro", model: "doubao-seed-1.6-pro" },
  { group: "其他", label: "MiMo V2 Flash", model: "mimo-v2-flash" },
  { group: "其他", label: "Step 3.5 Flash", model: "step-3.5-flash" },
  { group: "其他", label: "GPT-OSS 120B", model: "gpt-oss-120b" },
];

// ── 贞贞工坊 LLM 模型（来源: ai.t8star.cn） ──
const ZHENZHEN_LLM_MODELS: PlatformSubModel[] = [
  { group: "OpenAI", label: "GPT-5.4 Pro", model: "gpt-5.4-pro" },
  { group: "OpenAI", label: "GPT-5.4", model: "gpt-5.4" },
  { group: "OpenAI", label: "GPT-5.2", model: "gpt-5.2" },
  { group: "OpenAI", label: "GPT-5.1", model: "gpt-5.1" },
  { group: "OpenAI", label: "GPT-4o", model: "gpt-4o" },
  { group: "OpenAI", label: "o4-mini", model: "o4-mini" },
  { group: "OpenAI", label: "GPT-OSS 120B", model: "gpt-oss-120b" },
  { group: "Claude", label: "Claude Sonnet 4.6", model: "claude-sonnet-4-6" },
  { group: "Claude", label: "Claude Opus 4.6", model: "claude-opus-4-6" },
  { group: "Claude", label: "Claude Opus 4.5", model: "claude-opus-4-5" },
  { group: "Claude", label: "Claude Haiku 4.5", model: "claude-haiku-4-5" },
  { group: "Google", label: "Gemini 3.1 Pro", model: "gemini-3.1-pro-preview" },
  { group: "Google", label: "Gemini 3.1 Flash Lite", model: "gemini-3.1-flash-lite-preview" },
  { group: "Google", label: "Gemini 2.5 Pro", model: "gemini-2.5-pro" },
  { group: "DeepSeek", label: "DeepSeek V3.2", model: "deepseek-v3.2" },
  { group: "DeepSeek", label: "DeepSeek R1-0528", model: "deepseek-r1-0528" },
  { group: "DeepSeek", label: "DeepSeek Chat", model: "deepseek-chat" },
  { group: "Minimax", label: "Minimax M2.1", model: "minimax-m2.1" },
  { group: "豆包", label: "Doubao Seed 2.0 Pro", model: "doubao-seed-2.0-pro" },
  { group: "豆包", label: "Doubao Seed 1.6 Pro", model: "doubao-seed-1.6-pro" },
  { group: "通义千问", label: "Qwen3.5 Plus", model: "qwen3.5-plus" },
  { group: "通义千问", label: "Qwen3 Max", model: "qwen3-max" },
  { group: "通义千问", label: "Qwen3 Coder Plus", model: "qwen3-coder-plus" },
];

// ── 云雾 API LLM 模型（来源: yunwu.ai） ──
const YUNWU_LLM_MODELS: PlatformSubModel[] = [
  { group: "OpenAI", label: "GPT-5.4", model: "gpt-5.4" },
  { group: "OpenAI", label: "GPT-5.4 Pro", model: "gpt-5.4-pro" },
  { group: "OpenAI", label: "GPT-5.3 Codex Spark", model: "gpt-5.3-codex-spark" },
  { group: "OpenAI", label: "GPT-5.2", model: "gpt-5.2" },
  { group: "OpenAI", label: "GPT-5.1", model: "gpt-5.1" },
  { group: "Claude", label: "Claude Sonnet 4.6", model: "claude-sonnet-4-6" },
  { group: "Claude", label: "Claude Opus 4.6", model: "claude-opus-4-6" },
  { group: "Claude", label: "Claude Opus 4.6 Thinking", model: "claude-opus-4-6-thinking" },
  { group: "Claude", label: "Claude Opus 4.5", model: "claude-opus-4-5-20251101" },
  { group: "Google", label: "Gemini 3.1 Pro", model: "gemini-3.1-pro-preview" },
  { group: "Google", label: "Gemini 3.1 Flash Lite", model: "gemini-3.1-flash-lite-preview" },
  { group: "Google", label: "Gemini 3 Pro", model: "gemini-3-pro-preview" },
  { group: "DeepSeek", label: "DeepSeek V3.2", model: "deepseek-v3.2" },
  { group: "DeepSeek", label: "DeepSeek R1-0528", model: "deepseek-r1-0528" },
  { group: "DeepSeek", label: "DeepSeek Chat", model: "deepseek-chat" },
  { group: "Grok", label: "Grok 4.2", model: "grok-4.2" },
  { group: "Grok", label: "Grok 4.1", model: "grok-4.1" },
  { group: "豆包", label: "Doubao Seed 2.0", model: "doubao-seed-2.0" },
  { group: "Minimax", label: "Minimax M2.5", model: "minimax-m2.5" },
  { group: "通义千问", label: "Qwen3.5 Plus", model: "qwen3.5-plus" },
  { group: "通义千问", label: "Qwen3 Max", model: "qwen3-max" },
];

// ── 七牛云 Image 模型（来源: api.qnaigc.com） ──
const QINIU_IMAGE_MODELS: PlatformSubModel[] = [
  { group: "可灵 Kling", label: "Kling V2-1", model: "kling-v2-1" },
  { group: "可灵 Kling", label: "Kling V2", model: "kling-v2" },
  { group: "可灵 Kling", label: "Kling V2 New", model: "kling-v2-new" },
  { group: "可灵 Kling", label: "Kling V1-5", model: "kling-v1-5" },
  { group: "可灵 Kling", label: "Kling V1", model: "kling-v1" },
  { group: "可灵 Kling", label: "Kling Image O1", model: "kling-image-o1" },
  { group: "Google", label: "Gemini 3.1 Flash Image", model: "gemini-3.1-flash-image-preview" },
];

// ── 贞贞工坊 Image 模型（来源: ai.t8star.cn） ──
const ZHENZHEN_IMAGE_MODELS: PlatformSubModel[] = [
  { group: "OpenAI", label: "GPT Image 1.5", model: "gpt-image-1.5" },
  { group: "OpenAI", label: "Sora Image", model: "sora_image" },
  { group: "OpenAI", label: "GPT Image 1", model: "gpt-image-1" },
  { group: "OpenAI", label: "DALL-E 3", model: "dall-e-3" },
  { group: "Google", label: "Gemini 3.1 Flash Image", model: "gemini-3.1-flash-image-preview" },
  { group: "Google", label: "Gemini 3 Pro Image", model: "gemini-3-pro-image-preview" },
  { group: "Google", label: "Gemini 2.5 Flash Image", model: "gemini-2.5-flash-image" },
  { group: "可灵 Kling", label: "Kling V2-1", model: "kling-image-v2-1" },
  { group: "可灵 Kling", label: "Kling V2", model: "kling-image-v2" },
  { group: "可灵 Kling", label: "Kling V1-5", model: "kling-image-v1-5" },
  { group: "Flux", label: "Flux Kontext Pro", model: "flux-kontext-pro" },
  { group: "Flux", label: "Flux Kontext Max", model: "flux-kontext-max" },
  { group: "Flux", label: "Flux Dev", model: "flux-dev" },
  { group: "Flux", label: "Flux Pro", model: "flux-pro" },
  { group: "豆包 Seedream", label: "Seedream 5", model: "doubao-seedream-5" },
  { group: "豆包 Seedream", label: "Seedream 4.5", model: "doubao-seedream-4.5" },
  { group: "通义千问", label: "Qwen Image", model: "qwen-image" },
  { group: "通义千问", label: "Z Image Turbo", model: "z-image-turbo" },
  { group: "Ideogram", label: "Ideogram V3", model: "ideogram-v3" },
  { group: "Recraft", label: "Recraft V3", model: "recraftv3" },
];

// ── 云雾 API Image 模型（来源: yunwu.ai） ──
const YUNWU_IMAGE_MODELS: PlatformSubModel[] = [
  { group: "OpenAI", label: "GPT Image 1.5", model: "gpt-image-1.5" },
  { group: "OpenAI", label: "GPT Image 1", model: "gpt-image-1" },
  { group: "OpenAI", label: "Sora Image", model: "sora_image" },
  { group: "Google", label: "Gemini 3.1 Flash Image", model: "gemini-3.1-flash-image-preview" },
  { group: "Google", label: "Gemini 3 Pro Image", model: "gemini-3-pro-image-preview" },
  { group: "Google", label: "Gemini 2.5 Flash Image", model: "gemini-2.5-flash-image" },
  { group: "Google", label: "Imagen 4", model: "google/imagen-4" },
  { group: "Google", label: "Imagen 4 Fast", model: "google/imagen-4-fast" },
  { group: "Grok", label: "Grok 4.2 Image", model: "grok-4.2-image" },
  { group: "Grok", label: "Grok 4.1 Image", model: "grok-4.1-image" },
  { group: "豆包 Seedream", label: "Seedream 5.0", model: "doubao-seedream-5-0-260128" },
  { group: "豆包 Seedream", label: "Seedream 4.5", model: "doubao-seedream-4-5-251128" },
  { group: "Flux", label: "Flux Kontext Pro", model: "flux-kontext-pro" },
  { group: "Flux", label: "Flux Kontext Max", model: "flux-kontext-max" },
  { group: "Flux", label: "Flux Dev", model: "flux-dev" },
  { group: "Flux", label: "Flux Pro", model: "flux-pro" },
  { group: "Ideogram", label: "Ideogram V3", model: "ideogram_generate_V_3_DEFAULT" },
  { group: "Ideogram", label: "Ideogram V3 Quality", model: "ideogram_generate_V_3_QUALITY" },
  { group: "可灵 Kling", label: "Kling Image", model: "kling-image" },
  { group: "通义千问", label: "AIGC Qwen Image", model: "aigc-image-qwen" },
  { group: "通义千问", label: "Z Image Turbo", model: "z-image-turbo" },
];

// 获取 LLM 平台子模型列表
function getLLMSubModels(presetId: string): PlatformSubModel[] {
  if (presetId === "qiniu-llm") return QINIU_LLM_MODELS;
  if (presetId === "yunwu-llm") return YUNWU_LLM_MODELS;
  if (presetId === "zhenzhen-llm") return ZHENZHEN_LLM_MODELS;
  return [];
}

// 获取 Image 平台子模型列表
function getImageSubModels(presetId: string): PlatformSubModel[] {
  if (presetId === "qiniu-image") return QINIU_IMAGE_MODELS;
  if (presetId === "yunwu-image") return YUNWU_IMAGE_MODELS;
  if (presetId === "zhenzhen-image") return ZHENZHEN_IMAGE_MODELS;
  return [];
}

// 按 group 分组平台子模型
function groupPlatformSubModels(models: PlatformSubModel[]): { group: string; items: PlatformSubModel[] }[] {
  const groups: { group: string; items: PlatformSubModel[] }[] = [];
  for (const m of models) {
    const last = groups[groups.length - 1];
    if (last && last.group === m.group) {
      last.items.push(m);
    } else {
      groups.push({ group: m.group, items: [m] });
    }
  }
  return groups;
}

const VIDEO_MODELS_STORAGE_KEY = "feicai-video-models";
const SORA_UPLOAD_CONFIG_KEY = "feicai-sora-upload-config";

function SectionIcon({ icon }: { icon: ConfigSection["icon"] }) {
  const cls = "text-[var(--gold-primary)]";
  if (icon === "zap") return <Zap size={18} className={cls} />;
  if (icon === "image") return <Image size={18} className={cls} />;
  return <Video size={18} className={cls} />;
}

function genId() {
  return `vm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

// ═══════════════════════════════════════════════════════════
// Page
// ═══════════════════════════════════════════════════════════

export default function SettingsPage() {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Video models
  const [videoModels, setVideoModels] = useState<VideoModelConfig[]>([]);
  const [editingModel, setEditingModel] = useState<VideoModelConfig | null>(null);

  // Key visibility toggles
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [showImgKey, setShowImgKey] = useState(false);
  const [showVideoKey, setShowVideoKey] = useState(false);

  // LLM preset selector state
  const [llmPresetOpen, setLlmPresetOpen] = useState(false);

  // Image preset selector state
  const [imgPresetOpen, setImgPresetOpen] = useState(false);

  // Video preset selector state
  const [videoPresetOpen, setVideoPresetOpen] = useState(false);
  const [expandedPresetId, setExpandedPresetId] = useState<string | null>(null);

  // LLM/Image 子模型展开状态
  const [expandedLLMPresetId, setExpandedLLMPresetId] = useState<string | null>(null);
  const [expandedImgPresetId, setExpandedImgPresetId] = useState<string | null>(null);

  // Sora 角色上传预设
  const [soraUploadApiKey, setSoraUploadApiKey] = useState("");
  const [soraUploadBaseUrl, setSoraUploadBaseUrl] = useState("https://ai.t8star.cn");
  const [showSoraKey, setShowSoraKey] = useState(false);

  // File storage path
  const [fileBasePath, setFileBasePath] = useState("");
  const [filePathDefault, setFilePathDefault] = useState("");
  const [filePathSaving, setFilePathSaving] = useState(false);

  function getActiveLLMPreset(): LLMPreset | null {
    // 优先用存储的 preset id（信任 preset-id，不再严格比对 URL）
    const presetId = getValue("llm-preset-id");
    if (presetId) {
      const found = LLM_PRESETS.find(p => p.id === presetId);
      if (found) return found;
    }
    // 向后兼容：用 model+url 匹配
    const model = getValue("llm-model");
    const url = getValue("llm-url");
    return LLM_PRESETS.find((p) => p.model === model && p.url === url) || null;
  }

  // 获取 LLM 预设的动态显示名（用户修改 model 后自动更新名称）
  function getActiveLLMLabel(): string {
    const preset = getActiveLLMPreset();
    if (!preset) return "自定义配置";
    const currentModel = getValue("llm-model");
    if (currentModel && currentModel !== preset.model) {
      const providerName = preset.label.split("·")[0]?.trim() || preset.label;
      return `${providerName} · ${currentModel}`;
    }
    return preset.label;
  }

  // 获取某个 LLM 预设在下拉列表中的显示名（含用户覆盖的 model）
  function getLLMPresetLabel(preset: LLMPreset): string {
    const savedModel = values[`llm-model--${preset.id}`];
    if (savedModel && savedModel !== preset.model) {
      const providerName = preset.label.split("·")[0]?.trim() || preset.label;
      return `${providerName} · ${savedModel}`;
    }
    return preset.label;
  }

  // 获取某个 LLM 预设的子文本
  function getLLMPresetSubtext(preset: LLMPreset): string {
    const savedModel = values[`llm-model--${preset.id}`];
    const savedUrl = values[`llm-url--${preset.id}`];
    const displayModel = savedModel || preset.model || "（用户自选模型）";
    const displayUrl = savedUrl || preset.url;
    return `${displayModel} · ${displayUrl}`;
  }

  // ── 预设分组标签（LLM / Image 下拉菜单分组显示） ──
  function getLLMGroup(id: string): string {
    if (id.startsWith("google-")) return "🔌 官方直连";
    if (id.startsWith("ussn-") || id.startsWith("geeknow-")) return "🔗 API 中转站";
    if (id.startsWith("dashscope-") || id.startsWith("qwen-") || id.startsWith("volcengine-")) return "🏢 国内大模型";
    return "⭐ 聚合平台";
  }
  function getImageGroup(id: string): string {
    if (id.startsWith("google-")) return "🔌 官方直连";
    if (id.startsWith("ussn-") || id.startsWith("geeknow-")) return "🔗 API 中转站";
    return "⭐ 聚合平台";
  }

  function handleSelectLLMPreset(preset: LLMPreset) {
    setValues((prev) => {
      const next = { ...prev };
      // 保存当前预设的 key + model + provider + url 覆盖
      const currentPresetId = prev["llm-preset-id"];
      if (currentPresetId) {
        if (prev["llm-key"]) next[`llm-key--${currentPresetId}`] = prev["llm-key"];
        if (prev["llm-model"]) next[`llm-model--${currentPresetId}`] = prev["llm-model"];
        if (prev["llm-provider"]) next[`llm-provider--${currentPresetId}`] = prev["llm-provider"];
        if (prev["llm-url"]) next[`llm-url--${currentPresetId}`] = prev["llm-url"];
      }
      // 切换到新预设（恢复已保存的覆盖值）
      next["llm-preset-id"] = preset.id;
      next["llm-provider"] = next[`llm-provider--${preset.id}`] || preset.provider;
      next["llm-model"] = next[`llm-model--${preset.id}`] || preset.model;
      // ★ URL 也按预设独立保存：用户手动改的 URL 下次切回时自动恢复
      next["llm-url"] = next[`llm-url--${preset.id}`] || preset.url;
      // ★ 新预设无历史 key 时保留当前 key（多数中转站共用同一 key）
      next["llm-key"] = next[`llm-key--${preset.id}`] || prev["llm-key"] || "";
      return next;
    });
    setLlmPresetOpen(false);
  }

  // 从子菜单选择 LLM 子模型（自动填充模型名称）
  function handleSelectLLMSubModel(preset: LLMPreset, sub: PlatformSubModel) {
    setValues((prev) => {
      const next = { ...prev };
      const currentPresetId = prev["llm-preset-id"];
      if (currentPresetId) {
        if (prev["llm-key"]) next[`llm-key--${currentPresetId}`] = prev["llm-key"];
        if (prev["llm-model"]) next[`llm-model--${currentPresetId}`] = prev["llm-model"];
        if (prev["llm-provider"]) next[`llm-provider--${currentPresetId}`] = prev["llm-provider"];
        if (prev["llm-url"]) next[`llm-url--${currentPresetId}`] = prev["llm-url"];
      }
      next["llm-preset-id"] = preset.id;
      next["llm-provider"] = next[`llm-provider--${preset.id}`] || preset.provider;
      next["llm-model"] = sub.model;
      next["llm-url"] = next[`llm-url--${preset.id}`] || preset.url;
      next["llm-key"] = next[`llm-key--${preset.id}`] || prev["llm-key"] || "";
      next[`llm-model--${preset.id}`] = sub.model;
      return next;
    });
    setLlmPresetOpen(false);
    setExpandedLLMPresetId(null);
  }

  function getActiveImagePreset(): ImagePreset | null {
    // 信任 preset-id，不再严格比对 URL
    const presetId = getValue("img-preset-id");
    if (presetId) {
      const found = IMAGE_PRESETS.find(p => p.id === presetId);
      if (found) return found;
    }
    const model = getValue("img-model");
    const url = getValue("img-url");
    const format = getValue("img-format") || "gemini";
    return IMAGE_PRESETS.find((p) => p.model === model && p.url === url && p.format === format) || null;
  }

  function getActiveImageLabel(): string {
    const preset = getActiveImagePreset();
    if (!preset) return "自定义配置";
    const currentModel = getValue("img-model");
    if (currentModel && currentModel !== preset.model) {
      const providerName = preset.label.split("·")[0]?.trim() || preset.label;
      return `${providerName} · ${currentModel}`;
    }
    return preset.label;
  }

  function getImagePresetLabel(preset: ImagePreset): string {
    const savedModel = values[`img-model--${preset.id}`];
    if (savedModel && savedModel !== preset.model) {
      const providerName = preset.label.split("·")[0]?.trim() || preset.label;
      return `${providerName} · ${savedModel}`;
    }
    return preset.label;
  }

  function getImagePresetSubtext(preset: ImagePreset): string {
    const savedModel = values[`img-model--${preset.id}`];
    const savedUrl = values[`img-url--${preset.id}`];
    const displayModel = savedModel || preset.model || "（用户自选模型）";
    const displayUrl = savedUrl || preset.url;
    const fmtLabel = preset.format === "openai" ? "OpenAI格式" : preset.format === "openai-images" ? "Dalle格式" : "Gemini格式";
    return `${displayModel} · ${fmtLabel} · ${displayUrl}`;
  }

  function handleSelectImagePreset(preset: ImagePreset) {
    setValues((prev) => {
      const next = { ...prev };
      // 保存当前预设的 key + model + format + url 覆盖
      const currentPresetId = prev["img-preset-id"];
      if (currentPresetId) {
        if (prev["img-key"]) next[`img-key--${currentPresetId}`] = prev["img-key"];
        if (prev["img-model"]) next[`img-model--${currentPresetId}`] = prev["img-model"];
        if (prev["img-format"]) next[`img-format--${currentPresetId}`] = prev["img-format"];
        if (prev["img-url"]) next[`img-url--${currentPresetId}`] = prev["img-url"];
      }
      // 切换到新预设（恢复已保存的覆盖值）
      next["img-preset-id"] = preset.id;
      next["img-format"] = next[`img-format--${preset.id}`] || preset.format;
      next["img-model"] = next[`img-model--${preset.id}`] || preset.model;
      // ★ URL 也按预设独立保存：用户手动改的 URL 下次切回时自动恢复
      next["img-url"] = next[`img-url--${preset.id}`] || preset.url;
      // ★ 新预设无历史 key 时保留当前 key（多数中转站共用同一 key）
      next["img-key"] = next[`img-key--${preset.id}`] || prev["img-key"] || "";
      return next;
    });
    setImgPresetOpen(false);
  }

  // 从子菜单选择 Image 子模型（自动填充模型名称）
  function handleSelectImageSubModel(preset: ImagePreset, sub: PlatformSubModel) {
    setValues((prev) => {
      const next = { ...prev };
      const currentPresetId = prev["img-preset-id"];
      if (currentPresetId) {
        if (prev["img-key"]) next[`img-key--${currentPresetId}`] = prev["img-key"];
        if (prev["img-model"]) next[`img-model--${currentPresetId}`] = prev["img-model"];
        if (prev["img-format"]) next[`img-format--${currentPresetId}`] = prev["img-format"];
        if (prev["img-url"]) next[`img-url--${currentPresetId}`] = prev["img-url"];
      }
      next["img-preset-id"] = preset.id;
      next["img-format"] = next[`img-format--${preset.id}`] || preset.format;
      next["img-model"] = sub.model;
      next["img-url"] = next[`img-url--${preset.id}`] || preset.url;
      next["img-key"] = next[`img-key--${preset.id}`] || prev["img-key"] || "";
      next[`img-model--${preset.id}`] = sub.model;
      return next;
    });
    setImgPresetOpen(false);
    setExpandedImgPresetId(null);
  }

  function handleLoadVideoPreset(preset: VideoPreset) {
    // Check if this preset model already exists (prevent duplicates)
    const exists = videoModels.some((m) => m.model === preset.model && m.url === preset.url);
    if (exists) {
      toast(`模型 ${preset.label} 已存在，请勿重复添加`, "info");
      setVideoPresetOpen(false);
      return;
    }
    // Pre-fill the edit form with preset values (user still needs to enter API Key)
    setEditingModel({
      id: genId(),
      name: preset.label.replace(/^Google · |^USSN · |^GeeKnow · |^GeekNow · /g, ""),
      model: preset.model,
      url: preset.url,
      apiKey: "", // user fills in
      provider: preset.provider,
      modes: [...preset.modes],
    });
    setVideoPresetOpen(false);
    toast("已加载预设模板，请填写 API Key 后点击确认", "info");
  }

  // 从子菜单加载内置模型（自动填充名称、模型ID、URL、模式）
  function handleLoadSubModel(preset: VideoPreset, sub: SubModelEntry) {
    const exists = videoModels.some((m) => m.model === sub.model && m.url === preset.url);
    if (exists) {
      toast(`模型 ${sub.label} 已存在，请勿重复添加`, "info");
      setVideoPresetOpen(false);
      setExpandedPresetId(null);
      return;
    }
    const prefix = getPlatformPrefix(preset.id);
    setEditingModel({
      id: genId(),
      name: `${prefix} · ${sub.label}`,
      model: sub.model,
      url: preset.url,
      apiKey: "",
      provider: preset.provider,
      modes: [...sub.modes],
    });
    setVideoPresetOpen(false);
    setExpandedPresetId(null);
    toast("已加载模型配置，请填写 API Key 后点击确认", "info");
  }

  useEffect(() => {
    let cancelled = false;
    // Load general settings (同步，无需守卫)
    const saved = localStorage.getItem("feicai-settings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // ★ 自动修复：预设存在但 URL 丢失时，从预设自动填充
        if (parsed["llm-preset-id"] && !parsed["llm-url"]) {
          const p = LLM_PRESETS.find(x => x.id === parsed["llm-preset-id"]);
          if (p) parsed["llm-url"] = p.url;
        }
        if (parsed["img-preset-id"] && !parsed["img-url"]) {
          const p = IMAGE_PRESETS.find(x => x.id === parsed["img-preset-id"]);
          if (p) parsed["img-url"] = p.url;
        }
        setValues(parsed);
      } catch { /* ignore */ }
    } else {
      const defaults: Record<string, string> = {
        "llm-provider": "openAi",
        "llm-model": "gemini-2.5-pro",
        "llm-key": "",
        "llm-url": "",
      };
      configSections.forEach((s) => s.fields.forEach((f) => { defaults[f.key] = f.defaultValue; }));
      setValues(defaults);
    }

    // Load video models from IndexedDB (with localStorage migration)
    (async () => {
      try {
        const raw = await kvLoad(VIDEO_MODELS_STORAGE_KEY);
        if (cancelled) return;
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) setVideoModels(arr);
        }
      } catch { /* ignore */ }
    })();

    // Load Sora upload preset from localStorage
    try {
      const soraRaw = localStorage.getItem(SORA_UPLOAD_CONFIG_KEY);
      if (soraRaw) {
        const cfg = JSON.parse(soraRaw);
        if (cfg.apiKey) setSoraUploadApiKey(cfg.apiKey);
        if (cfg.baseUrl) setSoraUploadBaseUrl(cfg.baseUrl);
      }
    } catch { /* ignore */ }

    // Load file path config from server
    fetch("/api/config/path")
      .then((r) => { if (!r.ok) throw new Error("fetch failed"); return r.json(); })
      .then((data) => {
        if (cancelled) return;
        if (data.baseOutputDir) setFileBasePath(data.baseOutputDir);
        if (data.defaultBase) setFilePathDefault(data.defaultBase);
      })
      .catch(() => {});

    setLoaded(true);
    return () => { cancelled = true; };
  }, []);

  function getValue(key: string) { return values[key] ?? ""; }
  function setValue(key: string, val: string) { setValues((prev) => ({ ...prev, [key]: val })); }

  async function handleSave() {
    let finalValues = { ...values };

    // ★ LLM: Key + Model + Provider + URL → 按预设独立保存
    const activePreset = getActiveLLMPreset();
    if (activePreset) {
      const pid = activePreset.id;
      finalValues["llm-preset-id"] = pid;
      if (finalValues["llm-key"]) finalValues[`llm-key--${pid}`] = finalValues["llm-key"];
      if (finalValues["llm-model"]) finalValues[`llm-model--${pid}`] = finalValues["llm-model"];
      if (finalValues["llm-provider"]) finalValues[`llm-provider--${pid}`] = finalValues["llm-provider"];
      if (finalValues["llm-url"]) finalValues[`llm-url--${pid}`] = finalValues["llm-url"];
    }

    // ★ Image: Key + Model + Format + URL → 按预设独立保存
    const activeImgPreset = getActiveImagePreset();
    if (activeImgPreset) {
      const pid = activeImgPreset.id;
      finalValues["img-preset-id"] = pid;
      if (finalValues["img-key"]) finalValues[`img-key--${pid}`] = finalValues["img-key"];
      if (finalValues["img-model"]) finalValues[`img-model--${pid}`] = finalValues["img-model"];
      if (finalValues["img-format"]) finalValues[`img-format--${pid}`] = finalValues["img-format"];
      if (finalValues["img-url"]) finalValues[`img-url--${pid}`] = finalValues["img-url"];
    }

    setValues(finalValues);
    localStorage.setItem("feicai-settings", JSON.stringify(finalValues));
    // 保存 Sora 角色上传预设
    localStorage.setItem(SORA_UPLOAD_CONFIG_KEY, JSON.stringify({ apiKey: soraUploadApiKey, baseUrl: soraUploadBaseUrl }));
    try {
      await kvSet(VIDEO_MODELS_STORAGE_KEY, JSON.stringify(videoModels));
      toast("全部配置已保存（含视频模型 + 角色上传预设）", "success");
    } catch {
      toast("视频模型配置保存失败，请重试", "error");
    }
  }

  // ── File path save ──
  async function handleSaveFilePath() {
    if (!fileBasePath.trim()) {
      toast("请输入文件保存路径", "error");
      return;
    }
    setFilePathSaving(true);
    try {
      const res = await fetch("/api/config/path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseOutputDir: fileBasePath.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || "保存失败", "error");
      } else {
        setFileBasePath(data.baseOutputDir);
        toast("文件存储路径已保存", "success");
      }
    } catch (e: unknown) {
      toast("保存失败: " + (e instanceof Error ? e.message : "网络错误"), "error");
    } finally {
      setFilePathSaving(false);
    }
  }

  function handleResetFilePath() {
    setFileBasePath(filePathDefault);
  }

  // ── Video model CRUD ──
  function handleAddModel() {
    setEditingModel({ id: genId(), name: "", model: "", url: "", apiKey: "", provider: "third-party", modes: ["single"] });
  }

  function handleSaveModel() {
    if (!editingModel) return;
    if (!editingModel.name.trim()) { toast("请填写模型显示名称", "error"); return; }
    // 贞贞工坊等聚合平台允许先不填模型（生成时在视频页选择）
    const isAggregate = editingModel.url.includes("t8star.cn") || editingModel.url.includes("geeknow.top") || editingModel.url.includes("closeai.icu") || editingModel.url.includes("qnaigc.com") || editingModel.url.includes("yunwu.ai");
    if (!isAggregate && !editingModel.model.trim()) { toast("请填写 API Model ID（如 veo_3_1-fast）", "error"); return; }
    if (!editingModel.url.trim()) { toast("请填写 API Base URL", "error"); return; }
    if (!editingModel.apiKey.trim()) { toast("请填写 API Key", "error"); return; }
    if (editingModel.modes.length === 0) { toast("请至少选择一种支持模式", "error"); return; }

    setVideoModels((prev) => {
      const idx = prev.findIndex((m) => m.id === editingModel.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = editingModel; return next; }
      return [...prev, editingModel];
    });
    setEditingModel(null);
    toast("模型已添加/更新（点击保存配置使其生效）", "info");
  }

  function handleDeleteModel(id: string) {
    if (!confirm("确定删除此视频模型配置？")) return;
    setVideoModels((prev) => prev.filter((m) => m.id !== id));
    // Clear editing form if the deleted model was being edited
    if (editingModel?.id === id) setEditingModel(null);
    toast("模型已删除（点击保存配置使其生效）", "info");
  }

  function toggleMode(mode: VideoMode) {
    if (!editingModel) return;
    const modes = editingModel.modes.includes(mode)
      ? editingModel.modes.filter((m) => m !== mode)
      : [...editingModel.modes, mode];
    setEditingModel({ ...editingModel, modes });
  }

  // ── Video model test ──
  const [testingVideoModel, setTestingVideoModel] = useState<string | null>(null);

  async function handleTestVideoModel(m: VideoModelConfig) {
    setTestingVideoModel(m.id);
    try {
      const res = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: m.apiKey,
          baseUrl: m.url,
          model: m.model || m.name,
          prompt: "test",
          inputImage: "",
          mode: "single",
          provider: m.provider || "third-party",
          testOnly: true,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          toast(`${m.name} 连接测试成功 ✓ (${data.endpoint || ""})`, "success");
        } else {
          toast(`${m.name} 测试异常: ${data.error || data.message || "未知"}`, "error");
        }
      } else {
        const err = await res.json().catch(() => ({}));
        toast(`${m.name} 连接失败: ${err.error || res.statusText}`, "error");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e.name === "TimeoutError" ? "连接超时，请检查网络或 API 地址是否正确" : e.message) : "未知";
      toast(`${m.name} 网络错误: ${msg}`, "error");
    }
    setTestingVideoModel(null);
  }

  async function handleTest(sectionId: string, sectionTitle: string) {
    setTesting(sectionId);
    let apiKey: string, baseUrl: string, model: string;
    if (sectionId === "llm") {
      apiKey = getValue("llm-key");
      baseUrl = getValue("llm-url");
      model = getValue("llm-model");
    } else {
      const section = configSections.find((s) => s.id === sectionId);
      const keyField = section?.fields.find((f) => f.type === "password");
      apiKey = keyField ? getValue(keyField.key) : "";
      const urlField = section?.fields.find((f) => f.key.endsWith("-url"));
      const modelField = section?.fields.find((f) => f.key.endsWith("-model"));
      baseUrl = urlField ? getValue(urlField.key) : "";
      model = modelField ? getValue(modelField.key) : "";
    }
    if (!apiKey) { toast(`${sectionTitle} 未配置 API Key，请先填写`, "error"); setTesting(null); return; }
    try {
      let res: Response;
      if (sectionId === "image") {
        const imgFormat = getValue("img-format") || "gemini";
        res = await fetch("/api/image", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey, baseUrl, model, prompt: "一只小猫咪，简笔画风格", format: imgFormat }),
          signal: AbortSignal.timeout(30000) });
      } else {
        const provider = getValue("llm-provider") || "openAi";
        res = await fetch("/api/llm", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey, baseUrl, model, prompt: "回复OK", maxTokens: 10, provider }),
          signal: AbortSignal.timeout(30000) });
      }
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (sectionId === "image" && data.images?.length > 0) toast(`${sectionTitle} 连接测试成功 ✓ 已生成图片`, "success");
        else toast(`${sectionTitle} 连接测试成功 ✓`, "success");
      } else {
        const err = await res.json().catch(() => ({}));
        toast(`${sectionTitle} 连接失败: ${err.error || res.statusText}`, "error");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? (e.name === "TimeoutError" ? "连接超时，请检查网络或 API 地址是否正确" : e.message) : "未知";
      toast(`${sectionTitle} 网络错误: ${msg}`, "error");
    }
    setTesting(null);
  }

  if (!loaded) return null;

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <main className="flex-1 flex flex-col gap-8 p-8 px-10 overflow-auto relative">
        {/* 浮动保存按钮 */}
        <button onClick={handleSave}
          className="fixed right-10 top-6 z-50 flex items-center gap-2 bg-[var(--gold-primary)] px-5 py-2.5 hover:brightness-110 transition cursor-pointer shadow-lg shadow-black/30">
          <Save size={16} className="text-[#0A0A0A]" />
          <span className="text-[13px] font-medium text-[#0A0A0A]">保存配置</span>
        </button>

        {/* Header */}
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-normal text-[var(--text-secondary)]">系统配置</span>
          <h1 className="font-serif text-[40px] font-medium text-[var(--text-primary)]">API 设置</h1>
        </div>

        <div className="flex flex-col gap-6 w-full">
          {/* ═══ LLM Section with Preset Dropdown ═══ */}
          <div className="flex flex-col w-full border border-[var(--border-default)]">
            <div className="flex items-center justify-between w-full px-6 py-[18px] border-b border-[var(--border-default)]">
              <div className="flex items-center gap-3">
                <Zap size={18} className="text-[var(--gold-primary)]" />
                <span className="text-[15px] font-semibold text-[var(--text-primary)]">LLM 大语言模型</span>
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-[10px] text-emerald-400/80 hover:text-emerald-300 font-medium transition">Google</a>
                <a href="https://www.geeknow.top/" target="_blank" rel="noopener noreferrer" className="text-[10px] text-amber-500/80 hover:text-amber-400 font-medium transition">GeeKnow</a>
                <a href="https://api.ussn.cn/" target="_blank" rel="noopener noreferrer" className="text-[10px] text-amber-500/80 hover:text-amber-400 font-medium transition">USSN</a>
                <a href="https://dashscope.console.aliyun.com/apiKey" target="_blank" rel="noopener noreferrer" className="text-[10px] text-orange-400/80 hover:text-orange-300 font-medium transition">通义千问</a>
                <a href="https://console.volcengine.com/ark" target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400/80 hover:text-blue-300 font-medium transition">火山引擎</a>
                <a href="https://s.qiniu.com/VZz67r" target="_blank" rel="noopener noreferrer" className="text-[10px] text-cyan-400/80 hover:text-cyan-300 font-medium transition">七牛云</a>
                <a href="https://ai.t8star.cn" target="_blank" rel="noopener noreferrer" className="text-[10px] text-yellow-400/80 hover:text-yellow-300 font-medium transition">⭐贞贞</a>
              </div>
              <button onClick={() => handleTest("llm", "LLM 大语言模型")} disabled={testing === "llm"}
                className="flex items-center gap-1.5 px-4 py-2 border border-[var(--gold-primary)] text-[12px] font-medium text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-50">
                {testing === "llm" ? <Loader size={12} className="animate-spin" /> : <ExternalLink size={12} />}
                {testing === "llm" ? "测试中..." : "测试连接"}
              </button>
            </div>
            <div className="flex flex-col gap-4 p-6">
              {/* Preset selector */}
              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-[12px] font-medium text-[var(--text-secondary)]">API 预设方案</label>
                <div className="relative">
                  <button
                    onClick={() => { setLlmPresetOpen(!llmPresetOpen); setExpandedLLMPresetId(null); }}
                    className="flex items-center justify-between w-full px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none hover:border-[var(--gold-primary)] transition cursor-pointer">
                    <span>{getActiveLLMLabel()}</span>
                    <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform ${llmPresetOpen ? "rotate-180" : ""}`} />
                  </button>
                  {llmPresetOpen && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[var(--bg-surface)] border border-[var(--border-default)] shadow-lg max-h-[70vh] overflow-y-auto">
                      {LLM_PRESETS.map((preset, idx) => {
                        const group = getLLMGroup(preset.id);
                        const prevGroup = idx > 0 ? getLLMGroup(LLM_PRESETS[idx - 1].id) : "";
                        const showHeader = group !== prevGroup;
                        const active = getActiveLLMPreset()?.id === preset.id;
                        const llmSubModels = getLLMSubModels(preset.id);
                        const hasSubModels = llmSubModels.length > 0;
                        const isExpanded = expandedLLMPresetId === preset.id;
                        return (
                          <div key={preset.id}>
                            {showHeader && (
                              <div className={`px-3 py-1.5 text-[10px] text-[var(--text-muted)] font-medium tracking-wider bg-[#0D0D0D] select-none ${idx > 0 ? "border-t border-[var(--border-default)]" : ""}`}>
                                {group}
                              </div>
                            )}
                            <button
                              onClick={() => {
                                if (hasSubModels) {
                                  setExpandedLLMPresetId(isExpanded ? null : preset.id);
                                } else {
                                  handleSelectLLMPreset(preset);
                                }
                              }}
                              className={`flex items-center gap-2 w-full px-3 py-2.5 text-left hover:bg-[#1A1A1A] transition cursor-pointer ${
                                active ? "bg-[#C9A96210]" : ""
                              } ${isExpanded ? "bg-[#C9A96210]" : ""}`}>
                              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  {active && <Check size={12} className="text-[var(--gold-primary)]" />}
                                  <span className={`text-[13px] ${active || isExpanded ? "text-[var(--gold-primary)] font-medium" : "text-[var(--text-primary)]"}`}>
                                    {getLLMPresetLabel(preset)}
                                  </span>
                                </div>
                                {!hasSubModels && (
                                  <span className="text-[10px] text-[var(--text-muted)] pl-[20px]">
                                    {getLLMPresetSubtext(preset)}
                                  </span>
                                )}
                                {hasSubModels && !isExpanded && (
                                  <span className="text-[10px] text-[var(--text-muted)] pl-[20px]">
                                    {llmSubModels.length} 个内置模型，点击展开选择
                                  </span>
                                )}
                              </div>
                              {hasSubModels && (
                                <ChevronDown size={14} className={`text-[var(--text-muted)] shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                              )}
                            </button>
                            {/* LLM 子模型展开列表 */}
                            {hasSubModels && isExpanded && (
                              <div className="bg-[#080808] border-t border-b border-[var(--border-subtle)]">
                                {groupPlatformSubModels(llmSubModels).map(({ group: g, items }) => (
                                  <div key={g}>
                                    <div className="px-4 pt-2.5 pb-1 text-[10px] font-semibold text-[var(--gold-primary)] tracking-wider uppercase">{g}</div>
                                    {items.map((sub) => (
                                      <button key={sub.model}
                                        onClick={() => handleSelectLLMSubModel(preset, sub)}
                                        className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-[#1A1A1A] transition cursor-pointer">
                                        <span className="text-[12px] text-[var(--text-primary)] flex-1 min-w-0 truncate">{sub.label}</span>
                                        <span className="text-[9px] text-[var(--text-muted)] shrink-0 font-mono">{sub.model}</span>
                                      </button>
                                    ))}
                                  </div>
                                ))}
                                {/* 自定义模型选项 */}
                                <div className="border-t border-[var(--border-subtle)]">
                                  <button
                                    onClick={() => { handleSelectLLMPreset(preset); setExpandedLLMPresetId(null); }}
                                    className="flex items-center gap-2 w-full px-4 py-2.5 text-left hover:bg-[#1A1A1A] transition cursor-pointer">
                                    <Plus size={12} className="text-[var(--text-muted)]" />
                                    <span className="text-[12px] text-[var(--text-secondary)]">自定义模型（手动输入模型ID）</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              {/* Model + Provider row */}
              <div className="flex gap-4 w-full">
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-[12px] font-medium text-[var(--text-secondary)]">API Provider</label>
                  <input value={getValue("llm-provider")} onChange={(e) => setValue("llm-provider", e.target.value)}
                    className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition w-full" />
                </div>
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-[12px] font-medium text-[var(--text-secondary)]">Model</label>
                  <input value={getValue("llm-model")} onChange={(e) => setValue("llm-model", e.target.value)}
                    className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition w-full" />
                </div>
              </div>
              {/* API Key */}
              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-[12px] font-medium text-[var(--text-secondary)]">API Key</label>
                <div className="flex items-center gap-0 w-full">
                  <input value={getValue("llm-key")} onChange={(e) => setValue("llm-key", e.target.value)}
                    type={showLlmKey ? "text" : "password"} placeholder="sk-..."
                    className="flex-1 px-3 py-2.5 bg-[var(--bg-surface)] border border-r-0 border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition" />
                  <button type="button" onClick={() => setShowLlmKey(!showLlmKey)}
                    className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--gold-primary)] transition cursor-pointer">
                    {showLlmKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              {/* Base URL */}
              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-[12px] font-medium text-[var(--text-secondary)]">Base URL</label>
                <input value={getValue("llm-url")} onChange={(e) => setValue("llm-url", e.target.value)}
                  className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition w-full" />
              </div>
            </div>
          </div>

          {/* ═══ Image Section with Preset Dropdown ═══ */}
          <div className="flex flex-col w-full border border-[var(--border-default)]">
            <div className="flex items-center justify-between w-full px-6 py-[18px] border-b border-[var(--border-default)]">
              <div className="flex items-center gap-3">
                <Image size={18} className="text-[var(--gold-primary)]" />
                <span className="text-[15px] font-semibold text-[var(--text-primary)]">图像生成</span>
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-[10px] text-emerald-400/80 hover:text-emerald-300 font-medium transition">Google</a>
                <a href="https://www.geeknow.top/" target="_blank" rel="noopener noreferrer" className="text-[10px] text-amber-500/80 hover:text-amber-400 font-medium transition">GeeKnow</a>
                <a href="https://api.ussn.cn/" target="_blank" rel="noopener noreferrer" className="text-[10px] text-amber-500/80 hover:text-amber-400 font-medium transition">USSN</a>
                <a href="https://s.qiniu.com/VZz67r" target="_blank" rel="noopener noreferrer" className="text-[10px] text-cyan-400/80 hover:text-cyan-300 font-medium transition">七牛云</a>
                <a href="https://ai.t8star.cn" target="_blank" rel="noopener noreferrer" className="text-[10px] text-yellow-400/80 hover:text-yellow-300 font-medium transition">⭐贞贞</a>
              </div>
              <button onClick={() => handleTest("image", "图像生成")} disabled={testing === "image"}
                className="flex items-center gap-1.5 px-4 py-2 border border-[var(--gold-primary)] text-[12px] font-medium text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-50">
                {testing === "image" ? <Loader size={12} className="animate-spin" /> : <ExternalLink size={12} />}
                {testing === "image" ? "测试中..." : "测试连接"}
              </button>
            </div>
            <div className="flex flex-col gap-4 p-6">
              {/* Image Preset selector */}
              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-[12px] font-medium text-[var(--text-secondary)]">API 预设方案</label>
                <div className="relative">
                  <button
                    onClick={() => { setImgPresetOpen(!imgPresetOpen); setExpandedImgPresetId(null); }}
                    className="flex items-center justify-between w-full px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none hover:border-[var(--gold-primary)] transition cursor-pointer">
                    <span>{getActiveImageLabel()}</span>
                    <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform ${imgPresetOpen ? "rotate-180" : ""}`} />
                  </button>
                  {imgPresetOpen && (
                    <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[var(--bg-surface)] border border-[var(--border-default)] shadow-lg max-h-[70vh] overflow-y-auto">
                      {IMAGE_PRESETS.map((preset, idx) => {
                        const group = getImageGroup(preset.id);
                        const prevGroup = idx > 0 ? getImageGroup(IMAGE_PRESETS[idx - 1].id) : "";
                        const showHeader = group !== prevGroup;
                        const active = getActiveImagePreset()?.id === preset.id;
                        const imgSubModels = getImageSubModels(preset.id);
                        const hasSubModels = imgSubModels.length > 0;
                        const isExpanded = expandedImgPresetId === preset.id;
                        return (
                          <div key={preset.id}>
                            {showHeader && (
                              <div className={`px-3 py-1.5 text-[10px] text-[var(--text-muted)] font-medium tracking-wider bg-[#0D0D0D] select-none ${idx > 0 ? "border-t border-[var(--border-default)]" : ""}`}>
                                {group}
                              </div>
                            )}
                            <button
                              onClick={() => {
                                if (hasSubModels) {
                                  setExpandedImgPresetId(isExpanded ? null : preset.id);
                                } else {
                                  handleSelectImagePreset(preset);
                                }
                              }}
                              className={`flex items-center gap-2 w-full px-3 py-2.5 text-left hover:bg-[#1A1A1A] transition cursor-pointer ${
                                active ? "bg-[#C9A96210]" : ""
                              } ${isExpanded ? "bg-[#C9A96210]" : ""}`}>
                              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  {active && <Check size={12} className="text-[var(--gold-primary)]" />}
                                  <span className={`text-[13px] ${active || isExpanded ? "text-[var(--gold-primary)] font-medium" : "text-[var(--text-primary)]"}`}>
                                    {getImagePresetLabel(preset)}
                                  </span>
                                </div>
                                {!hasSubModels && (
                                  <span className="text-[10px] text-[var(--text-muted)] pl-[20px]">
                                    {getImagePresetSubtext(preset)}
                                  </span>
                                )}
                                {hasSubModels && !isExpanded && (
                                  <span className="text-[10px] text-[var(--text-muted)] pl-[20px]">
                                    {imgSubModels.length} 个内置模型，点击展开选择
                                  </span>
                                )}
                              </div>
                              {hasSubModels && (
                                <ChevronDown size={14} className={`text-[var(--text-muted)] shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                              )}
                            </button>
                            {/* Image 子模型展开列表 */}
                            {hasSubModels && isExpanded && (
                              <div className="bg-[#080808] border-t border-b border-[var(--border-subtle)]">
                                {groupPlatformSubModels(imgSubModels).map(({ group: g, items }) => (
                                  <div key={g}>
                                    <div className="px-4 pt-2.5 pb-1 text-[10px] font-semibold text-[var(--gold-primary)] tracking-wider uppercase">{g}</div>
                                    {items.map((sub) => (
                                      <button key={sub.model}
                                        onClick={() => handleSelectImageSubModel(preset, sub)}
                                        className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-[#1A1A1A] transition cursor-pointer">
                                        <span className="text-[12px] text-[var(--text-primary)] flex-1 min-w-0 truncate">{sub.label}</span>
                                        <span className="text-[9px] text-[var(--text-muted)] shrink-0 font-mono">{sub.model}</span>
                                      </button>
                                    ))}
                                  </div>
                                ))}
                                {/* 自定义模型选项 */}
                                <div className="border-t border-[var(--border-subtle)]">
                                  <button
                                    onClick={() => { handleSelectImagePreset(preset); setExpandedImgPresetId(null); }}
                                    className="flex items-center gap-2 w-full px-4 py-2.5 text-left hover:bg-[#1A1A1A] transition cursor-pointer">
                                    <Plus size={12} className="text-[var(--text-muted)]" />
                                    <span className="text-[12px] text-[var(--text-secondary)]">自定义模型（手动输入模型ID）</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              {/* Format + Model row */}
              <div className="flex gap-4 w-full">
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-[12px] font-medium text-[var(--text-secondary)]">API 协议格式</label>
                  <select value={getValue("img-format") || "gemini"} onChange={(e) => setValue("img-format", e.target.value)}
                    className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition w-full">
                    <option value="gemini">Gemini 原生格式（v1beta）</option>
                    <option value="openai">OpenAI 兼容格式（v1/chat/completions）</option>
                    <option value="openai-images">OpenAI 图像生成（v1/images/generations）</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-[12px] font-medium text-[var(--text-secondary)]">Model</label>
                  <input value={getValue("img-model")} onChange={(e) => setValue("img-model", e.target.value)}
                    className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition w-full" />
                </div>
              </div>
              {/* API Key */}
              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-[12px] font-medium text-[var(--text-secondary)]">API Key</label>
                <div className="flex items-center gap-0 w-full">
                  <input value={getValue("img-key")} onChange={(e) => setValue("img-key", e.target.value)}
                    type={showImgKey ? "text" : "password"} placeholder="sk-..."
                    className="flex-1 px-3 py-2.5 bg-[var(--bg-surface)] border border-r-0 border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition" />
                  <button type="button" onClick={() => setShowImgKey(!showImgKey)}
                    className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--gold-primary)] transition cursor-pointer">
                    {showImgKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              {/* Base URL */}
              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-[12px] font-medium text-[var(--text-secondary)]">
                  {(getValue("img-format") || "gemini") === "gemini" ? "Base URL（不含 /v1beta）" : "Base URL（不含 /v1）"}
                </label>
                <input value={getValue("img-url")} onChange={(e) => setValue("img-url", e.target.value)}
                  className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition w-full" />
              </div>

            </div>
          </div>

          {/* ═══ Video Models Section ═══ */}
          <div className="flex flex-col w-full border border-[var(--border-default)]">
            <div className="flex items-center justify-between w-full px-6 py-[18px] border-b border-[var(--border-default)]">
              <div className="flex items-center gap-3">
                <Video size={18} className="text-[var(--gold-primary)]" />
                <span className="text-[15px] font-semibold text-[var(--text-primary)]">视频生成模型</span>
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-[10px] text-emerald-400/80 hover:text-emerald-300 font-medium transition">Google</a>
                <a href="https://www.geeknow.top/" target="_blank" rel="noopener noreferrer" className="text-[10px] text-amber-500/80 hover:text-amber-400 font-medium transition">GeeKnow</a>
                <a href="https://api.ussn.cn/" target="_blank" rel="noopener noreferrer" className="text-[10px] text-amber-500/80 hover:text-amber-400 font-medium transition">USSN</a>
                <a href="https://console.volcengine.com/ark" target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400/80 hover:text-blue-300 font-medium transition">火山引擎</a>
                <a href="https://s.qiniu.com/VZz67r" target="_blank" rel="noopener noreferrer" className="text-[10px] text-cyan-400/80 hover:text-cyan-300 font-medium transition">七牛云</a>
                <span className="text-[11px] text-[var(--text-muted)]">({videoModels.length} 个模型)</span>
              </div>
              <div className="flex items-center gap-2">
                {/* Video preset dropdown */}
                <div className="relative">
                  <button onClick={() => { setVideoPresetOpen(!videoPresetOpen); setExpandedPresetId(null); }}
                    className="flex items-center gap-1.5 px-4 py-2 border border-[var(--border-default)] text-[12px] font-medium text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer">
                    <Zap size={12} />从预设添加
                    <ChevronDown size={12} className={`transition-transform ${videoPresetOpen ? "rotate-180" : ""}`} />
                  </button>
                  {videoPresetOpen && (
                    <div className="absolute z-50 top-full right-0 mt-1 min-w-[340px] max-h-[70vh] overflow-y-auto bg-[var(--bg-surface)] border border-[var(--border-default)] shadow-lg">
                      {VIDEO_PRESETS.map((preset) => {
                        const subModels = getSubModels(preset.id);
                        const hasSubModels = subModels.length > 0;
                        const isExpanded = expandedPresetId === preset.id;

                        return (
                          <div key={preset.id}>
                            <button
                              onClick={() => {
                                if (hasSubModels) {
                                  setExpandedPresetId(isExpanded ? null : preset.id);
                                } else {
                                  handleLoadVideoPreset(preset);
                                }
                              }}
                              className={`flex items-center gap-2 w-full px-3 py-2.5 text-left hover:bg-[#1A1A1A] transition cursor-pointer ${isExpanded ? "bg-[#C9A96210]" : ""}`}>
                              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                <span className={`text-[13px] ${isExpanded ? "text-[var(--gold-primary)] font-medium" : "text-[var(--text-primary)]"}`}>{preset.label}</span>
                                {!hasSubModels && (
                                  <span className="text-[10px] text-[var(--text-muted)]">
                                    {preset.model} · {preset.modes.map(m => m === "single" ? "单图" : m === "firstlast" ? "首尾帧" : m === "batchRelay" ? "接力" : "多参考").join("、")}
                                  </span>
                                )}
                                {hasSubModels && !isExpanded && (
                                  <span className="text-[10px] text-[var(--text-muted)]">
                                    {subModels.length} 个内置模型，点击展开选择
                                  </span>
                                )}
                              </div>
                              {hasSubModels && (
                                <ChevronDown size={14} className={`text-[var(--text-muted)] shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                              )}
                            </button>
                            {/* 子模型展开列表 */}
                            {hasSubModels && isExpanded && (
                              <div className="bg-[#080808] border-t border-b border-[var(--border-subtle)]">
                                {groupSubModels(subModels).map(({ group, items }) => (
                                  <div key={group}>
                                    <div className="px-4 pt-2.5 pb-1 text-[10px] font-semibold text-[var(--gold-primary)] tracking-wider uppercase">{group}</div>
                                    {items.map((sub) => (
                                      <button key={sub.model}
                                        onClick={() => handleLoadSubModel(preset, sub)}
                                        className="flex items-center gap-2 w-full px-4 py-2 text-left hover:bg-[#1A1A1A] transition cursor-pointer">
                                        <span className="text-[12px] text-[var(--text-primary)] flex-1 min-w-0 truncate">{sub.label}</span>
                                        <span className="text-[9px] text-[var(--text-muted)] shrink-0 font-mono">{sub.model}</span>
                                      </button>
                                    ))}
                                  </div>
                                ))}
                                {/* 自定义模型选项 */}
                                <div className="border-t border-[var(--border-subtle)]">
                                  <button
                                    onClick={() => handleLoadVideoPreset(preset)}
                                    className="flex items-center gap-2 w-full px-4 py-2.5 text-left hover:bg-[#1A1A1A] transition cursor-pointer">
                                    <Plus size={12} className="text-[var(--text-muted)]" />
                                    <span className="text-[12px] text-[var(--text-secondary)]">自定义模型（手动输入模型ID）</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <button onClick={handleAddModel}
                  className="flex items-center gap-1.5 px-4 py-2 border border-[var(--gold-primary)] text-[12px] font-medium text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer">
                  <Plus size={12} />添加模型
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-0 p-0">
              {/* Existing model list */}
              {videoModels.length === 0 && !editingModel && (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <Video size={28} className="text-[var(--text-muted)]" />
                  <span className="text-[13px] text-[var(--text-muted)]">暂未添加视频模型，点击「添加模型」开始配置</span>
                  <span className="text-[11px] text-[var(--text-muted)]">添加后将同步到「图生视频」页面的模型选择器</span>
                </div>
              )}

              {videoModels.map((m) => (
                <div key={m.id} className="flex items-center gap-4 px-6 py-3 border-b border-[var(--border-subtle)] hover:bg-[#0D0D0D] transition">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">{m.name}</span>
                      <span className={`text-[8px] px-1.5 py-0.5 rounded ${m.provider === "third-party" ? "bg-blue-500/15 text-blue-400 border border-blue-500/30" : "bg-green-500/15 text-green-400 border border-green-500/30"}`}>
                        {m.provider === "third-party" ? "第三方" : "官方"}
                      </span>
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)] truncate">{m.model || m.name} · {m.url}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {m.modes.map((mode) => (
                      <span key={mode} className="text-[9px] px-1.5 py-0.5 rounded bg-[#C9A96215] text-[var(--gold-primary)] border border-[var(--gold-transparent)]">
                        {mode === "single" ? "单图" : mode === "firstlast" ? "首尾帧" : mode === "batchRelay" ? "接力" : "多参考"}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => handleTestVideoModel(m)} disabled={testingVideoModel === m.id}
                      className="flex items-center gap-1 text-[11px] px-2 py-1 border border-[var(--gold-primary)] text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] cursor-pointer transition disabled:opacity-50 rounded">
                      {testingVideoModel === m.id ? <Loader size={10} className="animate-spin" /> : <ExternalLink size={10} />}
                      {testingVideoModel === m.id ? "测试中" : "测试"}
                    </button>
                    <button onClick={() => setEditingModel({ ...m })}
                      className="text-[11px] px-2 py-1 text-[var(--text-secondary)] hover:text-[var(--gold-primary)] cursor-pointer transition">编辑</button>
                    <button onClick={() => handleDeleteModel(m.id)}
                      className="w-6 h-6 flex items-center justify-center hover:text-red-400 cursor-pointer transition text-[var(--text-muted)]">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}

              {/* Edit / Add form */}
              {editingModel && (
                <div className="flex flex-col gap-4 p-6 bg-[#0D0D0D] border-t border-[var(--gold-transparent)]">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--gold-primary)]">
                      {videoModels.some((m) => m.id === editingModel.id) ? "编辑模型" : "添加新模型"}
                    </span>
                  </div>
                  {/* Row 1: Display name + Provider type */}
                  <div className="flex gap-4">
                    <div className="flex flex-col gap-1.5 flex-1">
                      <label className="text-[12px] font-medium text-[var(--text-secondary)]">显示名称</label>
                      <input value={editingModel.name} onChange={(e) => setEditingModel({ ...editingModel, name: e.target.value })}
                        placeholder="如：VEO 3.1 fast、Sora 2、即梦2.0"
                        className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition w-full" />
                    </div>
                    <div className="flex flex-col gap-1.5 w-[180px]">
                      <label className="text-[12px] font-medium text-[var(--text-secondary)]">接入方式</label>
                      <div className="flex items-center h-[42px] rounded border border-[var(--border-default)] overflow-hidden">
                        <button onClick={() => setEditingModel({ ...editingModel, provider: "third-party" })}
                          className={`flex-1 h-full text-[12px] cursor-pointer transition ${editingModel.provider === "third-party" ? "bg-blue-500/20 text-blue-400 font-medium" : "text-[var(--text-muted)] hover:bg-[#1A1A1A]"}`}>
                          第三方中转
                        </button>
                        <button onClick={() => setEditingModel({ ...editingModel, provider: "official" })}
                          className={`flex-1 h-full text-[12px] cursor-pointer transition ${editingModel.provider === "official" ? "bg-green-500/20 text-green-400 font-medium" : "text-[var(--text-muted)] hover:bg-[#1A1A1A]"}`}>
                          官方直连
                        </button>
                      </div>
                    </div>
                  </div>
                  {/* Row 2: API Model ID */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] font-medium text-[var(--text-secondary)]">
                      API Model ID
                      <span className="text-[10px] text-[var(--text-muted)] ml-1.5">（实际传给API的模型标识符）</span>
                    </label>
                    <input value={editingModel.model} onChange={(e) => setEditingModel({ ...editingModel, model: e.target.value })}
                      placeholder="如：veo_3_1-fast、sora-2-latest"
                      className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition w-full font-mono" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] font-medium text-[var(--text-secondary)]">API Base URL</label>
                    <input value={editingModel.url} onChange={(e) => setEditingModel({ ...editingModel, url: e.target.value })}
                      placeholder={editingModel.provider === "third-party" ? "如：https://api.geeknow.top/v1" : "如：https://api.openai.com/v1"}
                      className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition w-full" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[12px] font-medium text-[var(--text-secondary)]">API Key</label>
                    <div className="flex items-center gap-0 w-full">
                      <input value={editingModel.apiKey} onChange={(e) => setEditingModel({ ...editingModel, apiKey: e.target.value })}
                        type={showVideoKey ? "text" : "password"} placeholder="sk-..."
                        className="flex-1 px-3 py-2.5 bg-[var(--bg-surface)] border border-r-0 border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition" />
                      <button type="button" onClick={() => setShowVideoKey(!showVideoKey)}
                        className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--gold-primary)] transition cursor-pointer">
                        {showVideoKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  {/* Provider hint */}
                  {editingModel.provider === "third-party" && (
                    <div className="flex items-start gap-2 px-3 py-2 bg-blue-500/5 border border-blue-500/20 rounded">
                      <ExternalLink size={12} className="text-blue-400 mt-0.5 shrink-0" />
                      <span className="text-[10px] text-blue-300/80 leading-relaxed">
                        第三方中转（如 GeeKnow/MagicAPI）使用 <code className="text-blue-300 bg-blue-500/10 px-1 rounded">POST /v1/videos</code> 端点，
                        需传入 multipart/form-data 格式。确保 Base URL 包含 /v1 后缀。
                      </span>
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <label className="text-[12px] font-medium text-[var(--text-secondary)]">支持模式</label>
                    <div className="flex items-center gap-3">
                      {(["single", "firstlast", "multiref", "batchRelay"] as VideoMode[]).map((mode) => {
                        const active = editingModel.modes.includes(mode);
                        const label = mode === "single" ? "单图生视频" : mode === "firstlast" ? "首尾帧过渡" : mode === "batchRelay" ? "批量接力" : "多参考图融合";
                        return (
                          <button key={mode} onClick={() => toggleMode(mode)}
                            className={`flex items-center gap-1.5 px-3 py-2 rounded border text-[12px] transition cursor-pointer ${
                              active
                                ? "border-[var(--gold-primary)] bg-[#C9A96215] text-[var(--gold-primary)]"
                                : "border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--text-secondary)]"
                            }`}>
                            {active && <Check size={12} />}
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={handleSaveModel}
                      className="flex items-center gap-1.5 px-4 py-2 bg-[var(--gold-primary)] text-[12px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer">
                      <Check size={12} />确认
                    </button>
                    <button onClick={() => setEditingModel(null)}
                      className="px-4 py-2 text-[12px] text-[var(--text-secondary)] border border-[var(--border-default)] hover:border-[var(--text-secondary)] transition cursor-pointer">
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* ═══ Sora 角色上传预设 Section ═══ */}
          <div className="flex flex-col w-full border border-[var(--border-default)]">
            <div className="flex items-center justify-between w-full px-6 py-[18px] border-b border-[var(--border-default)]">
              <div className="flex items-center gap-3">
                <Upload size={18} className="text-[var(--gold-primary)]" />
                <span className="text-[15px] font-semibold text-[var(--text-primary)]">角色上传预设</span>
                <span className="text-[11px] text-[var(--text-muted)]">用于「角色库 → 一键上传 Sora」功能</span>
              </div>
            </div>
            <div className="flex flex-col gap-4 p-6">
              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-[12px] font-medium text-[var(--text-secondary)]">API Base URL</label>
                <input value={soraUploadBaseUrl} onChange={(e) => setSoraUploadBaseUrl(e.target.value)}
                  placeholder="https://ai.t8star.cn"
                  className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition font-mono" />
              </div>
              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-[12px] font-medium text-[var(--text-secondary)]">API Key</label>
                <div className="flex items-center gap-2">
                  <input value={soraUploadApiKey} onChange={(e) => setSoraUploadApiKey(e.target.value)}
                    type={showSoraKey ? "text" : "password"}
                    placeholder="填写支持 Sora 角色上传的 API Key"
                    className="flex-1 px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition font-mono" />
                  <button onClick={() => setShowSoraKey(!showSoraKey)}
                    className="p-2.5 border border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer">
                    {showSoraKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2 px-3 py-2.5 bg-[#C9A96208] border border-[var(--gold-transparent)] rounded">
                <div className="flex items-start gap-2">
                  <Upload size={12} className="text-[var(--gold-primary)] mt-0.5 shrink-0" />
                  <span className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    配置后，角色库的「一键上传 Sora」将使用此处的 API Key 和 Base URL 进行上传。
                    如未配置，将自动从视频模型列表中查找可用配置。
                  </span>
                </div>
              </div>
            </div>
          </div>
          {/* ═══ File Storage Path Section ═══ */}
          <div className="flex flex-col w-full border border-[var(--border-default)]">
            <div className="flex items-center justify-between w-full px-6 py-[18px] border-b border-[var(--border-default)]">
              <div className="flex items-center gap-3">
                <FolderOpen size={18} className="text-[var(--gold-primary)]" />
                <span className="text-[15px] font-semibold text-[var(--text-primary)]">文件存储路径</span>
              </div>
              <button onClick={handleSaveFilePath} disabled={filePathSaving}
                className="flex items-center gap-1.5 px-4 py-2 bg-[var(--gold-primary)] text-[12px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-50">
                {filePathSaving ? <Loader size={12} className="animate-spin" /> : <Save size={12} />}
                {filePathSaving ? "保存中..." : "保存路径"}
              </button>
            </div>
            <div className="flex flex-col gap-4 p-6">
              <div className="flex flex-col gap-1.5 w-full">
                <label className="text-[12px] font-medium text-[var(--text-secondary)]">项目文件保存目录</label>
                <div className="flex gap-2">
                  <input value={fileBasePath} onChange={(e) => setFileBasePath(e.target.value)}
                    placeholder={filePathDefault || "输入文件保存路径..."}
                    className="px-3 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition flex-1 font-mono" />
                  <button onClick={handleResetFilePath}
                    className="px-3 py-2.5 text-[12px] text-[var(--text-secondary)] border border-[var(--border-default)] hover:border-[var(--text-secondary)] transition cursor-pointer whitespace-nowrap">
                    恢复默认
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2 px-3 py-2.5 bg-[#C9A96208] border border-[var(--gold-transparent)] rounded">
                <div className="flex items-start gap-2">
                  <FolderOpen size={12} className="text-[var(--gold-primary)] mt-0.5 shrink-0" />
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                      所有生成的文件（图片、视频、剧本、产出中心资料等）都将保存在此目录下。
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] leading-relaxed">
                      子目录结构：<code className="text-[var(--gold-primary)] bg-[#C9A96210] px-1 rounded">ref-images/</code>{" "}
                      <code className="text-[var(--gold-primary)] bg-[#C9A96210] px-1 rounded">grid-images/</code>{" "}
                      <code className="text-[var(--gold-primary)] bg-[#C9A96210] px-1 rounded">videos/</code>{" "}
                      <code className="text-[var(--gold-primary)] bg-[#C9A96210] px-1 rounded">video-frames/</code>{" "}
                      以及 .md 剧本文件
                    </span>
                    {filePathDefault && (
                      <span className="text-[10px] text-[var(--text-muted)]">
                        默认路径：<code className="text-[var(--text-secondary)] bg-[#1A1A1A] px-1 rounded font-mono">{filePathDefault}</code>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
