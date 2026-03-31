"use client";

import { useState, useMemo, useRef } from "react";
import {
  GraduationCap,
  MessageSquareText,
  Image,
  Film,
  Zap,
  Star,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  ChevronRight,
  ExternalLink,
  Layers,
  Clapperboard,
  Search,
  X,
} from "lucide-react";
import Sidebar from "../components/Sidebar";

// ═══════════════════════════════════════════════════════════
// 数据定义
// ═══════════════════════════════════════════════════════════

interface ModelEntry {
  name: string;
  provider: string;
  badge?: "推荐" | "旗舰" | "快速" | "经济" | "新" | "稳定";
  description: string;
  features: string[];
  tips?: string;
  link?: string;
}

interface VideoModelEntry extends ModelEntry {
  modes: {
    single: boolean;       // 单图/提示词生成视频
    firstFrame: boolean;   // 首帧参考
    firstLast: boolean;    // 首尾帧模式
    multiRef: boolean;     // 多参考模式
    batchRelay: boolean;   // 批量接力
    audioRef: boolean;     // 音频参考
    videoRef: boolean;     // 视频参考
  };
  quality: string;
  duration: string;
  creditInfo?: string;
}

// ── 文本模型 ──────────────────────────────────────────────
const TEXT_MODELS: ModelEntry[] = [
  {
    name: "Gemini 2.5 Pro",
    provider: "Google",
    badge: "推荐",
    description: "Google 最强推理模型，100万 token 上下文窗口，适合长篇剧本分析、节拍拆解、智能分镜",
    features: ["超长上下文（100万 token）", "结构化输出优秀", "推理与创意兼顾", "支持 Gemini 原生格式与 OpenAI 兼容格式"],
    tips: "分镜流水线的首选模型。如果你的剧本超过 5 万字，优先选择此模型。",
    link: "https://ai.google.dev",
  },
  {
    name: "Gemini 2.5 Flash",
    provider: "Google",
    badge: "快速",
    description: "Gemini 系列的快速版本，速度快、成本低，适合日常任务",
    features: ["响应速度极快", "成本约为 Pro 的 1/10", "支持同等上下文窗口", "适合批量处理"],
    tips: "适合对速度敏感的场景，如批量提示词翻译等。质量略逊于 Pro。",
    link: "https://ai.google.dev",
  },
  {
    name: "DeepSeek V3 / R1",
    provider: "DeepSeek / 七牛云",
    badge: "经济",
    description: "国产开源大模型，R1 主打深度推理，V3 通用能力均衡",
    features: ["超长上下文支持", "R1 推理能力突出", "七牛云转售价格极低", "OpenAI 兼容格式"],
    tips: "R1 适合需要逻辑推理的节拍拆解；V3 适合通用文本生成。通过七牛云 API 接入最为便捷。",
  },
  {
    name: "Qwen3-Max",
    provider: "通义千问（阿里云）",
    badge: "稳定",
    description: "通义千问旗舰模型，中文理解能力优秀，通过 DashScope 接入",
    features: ["中文能力顶尖", "DashScope Responses 格式", "长文本支持", "免费额度可用"],
    tips: "适合纯中文剧本的分析。需注意使用 DashScope Responses 协议格式。",
    link: "https://dashscope.aliyuncs.com",
  },
  {
    name: "Doubao（豆包）",
    provider: "火山引擎（字节跳动）",
    badge: "稳定",
    description: "字节跳动大模型，通过火山引擎 Ark 接入，需配置 Endpoint ID",
    features: ["OpenAI 兼容格式", "火山引擎生态集成", "价格有竞争力"],
    tips: "配置时 Model 栏需填写你创建的接入点 ID（以 ep- 开头），而非模型名称。",
    link: "https://console.volcengine.com/ark",
  },
];

// ── 图像模型 ──────────────────────────────────────────────
const IMAGE_MODELS: ModelEntry[] = [
  {
    name: "Gemini 2.5 Flash Image",
    provider: "Google（官方直连）",
    badge: "推荐",
    description: "基于 Gemini 的原生图像生成能力，理解提示词能力强，适合九宫格/四宫格分镜图",
    features: ["文字理解精准", "构图遵循能力强", "Gemini 原生格式", "适合分镜场景"],
    tips: "生成九宫格分镜图的首选。如遇到网络问题可用代理或转售 API。",
    link: "https://ai.google.dev",
  },
  {
    name: "Gemini 3 Pro Image / 3.1 Flash Image",
    provider: "Google / 转售商",
    badge: "新",
    description: "Gemini 最新图像生成模型，画质与细节提升明显",
    features: ["画质大幅提升", "细节更丰富", "支持 Gemini 和 OpenAI 格式", "转售商可用"],
    tips: "3 Pro Image 画质最佳但较慢；3.1 Flash Image 速度和质量兼顾。",
  },
  {
    name: "Grok-4-1-Image",
    provider: "xAI（转售商）",
    description: "xAI 的图像生成模型，通过 OpenAI 兼容格式接入",
    features: ["创意风格独特", "OpenAI 兼容格式", "通过转售商接入"],
    tips: "风格偏艺术化，适合特定创意需求。",
  },
  {
    name: "Kling V2",
    provider: "七牛云转售",
    badge: "经济",
    description: "快手可灵图像模型，通过七牛云 OpenAI Images 格式接入",
    features: ["写实风格优秀", "OpenAI Images 格式", "性价比高"],
    tips: "使用 OpenAI 图像生成协议（v1/images/generations），不同于 Gemini 格式。",
  },
  {
    name: "即梦 Seedream 5.0 / 4.2",
    provider: "字节跳动（即梦浏览器代理）",
    badge: "旗舰",
    description: "字节跳动即梦原生图像模型，需登录即梦账号，通过浏览器代理调用",
    features: ["画质极高", "支持 2K/4K 分辨率", "中文理解优秀", "支持参考图"],
    tips: "需要先登录即梦账号，系统通过内置浏览器代理自动调用。每张消耗约 4 积分。",
    link: "https://jimeng.jianying.com",
  },
];

// ── 视频模型 ──────────────────────────────────────────────
const VIDEO_MODELS_JIMENG: VideoModelEntry[] = [
  {
    name: "Seedance 2.0 Pro",
    provider: "即梦（浏览器代理）",
    badge: "旗舰",
    description: "即梦最强视频模型，唯一支持「全能参考」模式——可同时上传图片、音频、视频作为参考，灵活性最高",
    features: ["全能参考模式（图+音+视频混合）", "首帧参考模式", "4~15 秒连续时长", "720P / 1080P 画质可选"],
    modes: { single: true, firstFrame: true, firstLast: false, multiRef: true, batchRelay: false, audioRef: true, videoRef: true },
    quality: "720P / 1080P",
    duration: "4~15 秒",
    creditInfo: "720P: 5积分/秒 | 1080P: 8积分/秒",
    tips: "全能模式可以上传角色参考图+音乐+动作视频，一次性生成高一致性长镜头。适合有充足积分的精品创作。",
    link: "https://jimeng.jianying.com",
  },
  {
    name: "Seedance 2.0 Fast",
    provider: "即梦（浏览器代理）",
    badge: "快速",
    description: "Seedance 2.0 的快速版本，精简时长但速度更快",
    features: ["全能参考模式", "生成速度约快 2 倍", "4~15 秒时长"],
    modes: { single: true, firstFrame: true, firstLast: false, multiRef: true, batchRelay: false, audioRef: true, videoRef: true },
    quality: "720P / 1080P",
    duration: "4~15 秒",
    creditInfo: "720P: 3积分/秒 | 1080P: 5积分/秒",
    tips: "日常测试和快速迭代时使用。画质略逊于 Pro，但速度提升明显。",
  },
  {
    name: "视频 3.5 Pro",
    provider: "即梦（浏览器代理）",
    badge: "新",
    description: "即梦 3.x 系列最新旗舰，支持首尾帧模式——可同时指定视频的开始画面和结束画面",
    features: ["✅ 首帧参考", "✅ 首尾帧模式", "固定时长选项 5/10/12 秒", "720P 画质"],
    modes: { single: true, firstFrame: true, firstLast: true, multiRef: false, batchRelay: false, audioRef: false, videoRef: false },
    quality: "720P",
    duration: "5 / 10 / 12 秒",
    creditInfo: "8积分/秒",
    tips: "首尾帧模式非常适合制作转场——指定首帧为场景A，尾帧为场景B，AI会自动生成流畅的过渡动画。",
  },
  {
    name: "视频 3.0 Pro",
    provider: "即梦（浏览器代理）",
    description: "3.0 系列高质量版本，仅支持单图首帧参考",
    features: ["✅ 首帧参考", "❌ 不支持首尾帧", "固定时长 5/10 秒", "720P 画质"],
    modes: { single: true, firstFrame: true, firstLast: false, multiRef: false, batchRelay: false, audioRef: false, videoRef: false },
    quality: "720P",
    duration: "5 / 10 秒",
    creditInfo: "10积分/秒",
    tips: "价格最高但质量稳定。如果不需要首尾帧，可以用这个追求单帧画质。",
  },
  {
    name: "视频 3.0",
    provider: "即梦（浏览器代理）",
    badge: "经济",
    description: "3.0 标准版，支持首尾帧模式，性价比高",
    features: ["✅ 首帧参考", "✅ 首尾帧模式", "固定时长 5/10 秒", "720P 画质"],
    modes: { single: true, firstFrame: true, firstLast: true, multiRef: false, batchRelay: false, audioRef: false, videoRef: false },
    quality: "720P",
    duration: "5 / 10 秒",
    creditInfo: "2积分/秒",
    tips: "性价比之王。同样支持首尾帧，积分消耗仅为 3.5 Pro 的四分之一。适合批量生成。",
  },
  {
    name: "视频 3.0 Fast",
    provider: "即梦（浏览器代理）",
    badge: "快速",
    description: "3.0 快速版，速度优先，不支持首尾帧",
    features: ["✅ 首帧参考", "❌ 不支持首尾帧", "固定时长 5/10 秒", "720P 画质"],
    modes: { single: true, firstFrame: true, firstLast: false, multiRef: false, batchRelay: false, audioRef: false, videoRef: false },
    quality: "720P",
    duration: "5 / 10 秒",
    creditInfo: "2积分/秒",
    tips: "速度最快、最便宜的 3.x 模型。适合快速验证提示词效果。",
  },
];

// ── 国际视频模型 ──────────────────────────────────────
const VIDEO_MODELS_INTERNATIONAL: VideoModelEntry[] = [
  {
    name: "VEO 3.1 Fast 4K",
    provider: "Google · USSN 转售",
    badge: "推荐",
    description: "Google 最新视频模型，支持单图、首尾帧、批量接力全模式，4K 超高清画质",
    features: ["✅ 单图模式", "✅ 首尾帧模式", "✅ 批量接力模式", "4K 超高清画质", "带音频"],
    modes: { single: true, firstFrame: true, firstLast: true, multiRef: false, batchRelay: true, audioRef: false, videoRef: false },
    quality: "4K",
    duration: "~8 秒",
    tips: "目前最全能的第三方视频模型。支持批量接力——ABCD 四张图自动生成 A→B→C→D 的连续视频。通过 USSN 转售接入。",
  },
  {
    name: "Google Veo 3",
    provider: "Google（官方直连 / fal.ai）",
    badge: "旗舰",
    description: "Google 旗舰视频模型，画质顶级，支持同步音频生成",
    features: ["画质极高", "原生音频生成", "Google 官方 API / fal.ai 可用"],
    modes: { single: true, firstFrame: true, firstLast: false, multiRef: false, batchRelay: false, audioRef: false, videoRef: false },
    quality: "高画质",
    duration: "~8 秒",
    tips: "画质顶级但需要 Google API 或 fal.ai 接入。官方直连需配置代理或 VPN。",
    link: "https://ai.google.dev",
  },
  {
    name: "Grok Video 3",
    provider: "xAI · GeeKnow 转售",
    badge: "经济",
    description: "xAI 视频模型，6秒/¥0.1，支持单图和多参考模式，价格极低",
    features: ["✅ 单图模式", "✅ 多参考模式", "超低价格 ¥0.1/个", "约 6 秒时长"],
    modes: { single: true, firstFrame: true, firstLast: false, multiRef: true, batchRelay: false, audioRef: false, videoRef: false },
    quality: "标准画质",
    duration: "~6 秒",
    tips: "价格最低的视频模型（每个视频约 ¥0.1）。多参考模式可上传多张图让 AI 综合参考。通过 GeeKnow 转售接入。",
  },
  {
    name: "Runway Gen-4 Turbo",
    provider: "Runway · fal.ai / 转售商",
    badge: "旗舰",
    description: "Runway 最新一代旗舰视频模型，运动质量和时间一致性行业领先",
    features: ["✅ 单图模式", "运动质量极高", "时间一致性强", "10 秒时长"],
    modes: { single: true, firstFrame: true, firstLast: false, multiRef: false, batchRelay: false, audioRef: false, videoRef: false },
    quality: "高画质 (768p / 1080p)",
    duration: "~10 秒",
    tips: "动态效果行业一流，适合需要复杂运动的镜头。通过 fal.ai 或 RunwayML API 接入。暂不支持首尾帧。",
    link: "https://runwayml.com",
  },
  {
    name: "Luma Ray 3",
    provider: "Luma · fal.ai / API",
    badge: "新",
    description: "Luma 最新视频模型，支持首尾帧插值和图片驱动，以自然运动著称",
    features: ["✅ 单图模式", "✅ 首尾帧模式", "自然运动质量", "支持关键帧插值"],
    modes: { single: true, firstFrame: true, firstLast: true, multiRef: false, batchRelay: false, audioRef: false, videoRef: false },
    quality: "高画质 (1080p)",
    duration: "5~9 秒",
    tips: "首尾帧插值质量非常好，适合转场镜头。通过 Luma API 或 fal.ai 接入。",
    link: "https://lumalabs.ai",
  },
  {
    name: "Pika 2.2",
    provider: "Pika · fal.ai / API",
    description: "Pika 视频模型，支持文生视频和图生视频，风格化能力强",
    features: ["✅ 单图模式", "✅ 首尾帧模式", "风格化能力强", "Effects 特效功能"],
    modes: { single: true, firstFrame: true, firstLast: true, multiRef: false, batchRelay: false, audioRef: false, videoRef: false },
    quality: "标准画质 (720p)",
    duration: "3~5 秒",
    tips: "短视频生成速度较快，有丰富的 Effects 特效可选（爆炸、溶解等）。通过 Pika API 或 fal.ai 接入。",
    link: "https://pika.art",
  },
  {
    name: "Sora 2",
    provider: "OpenAI · 七牛云转售",
    badge: "旗舰",
    description: "OpenAI 视频模型，创意表现力极强，仅支持单图模式",
    features: ["✅ 单图模式", "创意表现力顶级", "高清画质", "OpenAI API"],
    modes: { single: true, firstFrame: true, firstLast: false, multiRef: false, batchRelay: false, audioRef: false, videoRef: false },
    quality: "高画质 (1080p)",
    duration: "5~20 秒",
    tips: "创意性和叙事感强，但不支持首尾帧。可通过七牛云 API 或 fal.ai 接入（国内可直连）。",
    link: "https://openai.com",
  },
  {
    name: "MiniMax Hailuo-02",
    provider: "MiniMax（海螺）· fal.ai / API",
    badge: "稳定",
    description: "MiniMax 海螺视频模型，支持首尾帧模式，运动流畅度高",
    features: ["✅ 单图模式", "✅ 首尾帧模式", "运动流畅", "6 秒时长"],
    modes: { single: true, firstFrame: true, firstLast: true, multiRef: false, batchRelay: false, audioRef: false, videoRef: false },
    quality: "720p / 1080p",
    duration: "~6 秒",
    tips: "首尾帧模式表现稳定，运动过渡自然。可通过 MiniMax 开放平台或 fal.ai 接入。",
    link: "https://hailuoai.video",
  },
];

// ── 国内视频模型 ──────────────────────────────────────
const VIDEO_MODELS_DOMESTIC: VideoModelEntry[] = [
  {
    name: "可灵 Kling 2.6",
    provider: "快手 · 七牛云转售",
    badge: "推荐",
    description: "快手可灵最新版本，支持首尾帧模式，画质稳定，国内直连",
    features: ["✅ 单图模式", "✅ 首尾帧模式", "国内直连", "快手官方出品"],
    modes: { single: true, firstFrame: true, firstLast: true, multiRef: false, batchRelay: false, audioRef: false, videoRef: false },
    quality: "720p / 1080p",
    duration: "5~10 秒",
    tips: "国内视频模型的标杆之作。通过七牛云 API 接入（模型名 kling-v2-6），首尾帧质量优秀。",
    link: "https://klingai.kuaishou.com",
  },
  {
    name: "可灵 Kling O3",
    provider: "快手 · 官方 API",
    badge: "旗舰",
    description: "快手可灵旗舰版，三轮优化推理，支持 Elements 多参考系统",
    features: ["✅ 单图模式", "✅ 首尾帧模式", "✅ 多参考模式 (Elements)", "3~15 秒可变时长"],
    modes: { single: true, firstFrame: true, firstLast: true, multiRef: true, batchRelay: false, audioRef: false, videoRef: false },
    quality: "1080p",
    duration: "3~15 秒",
    tips: "Kling O3 的 Elements 功能类似多参考——可上传角色/场景/物品 reference，保持一致性。通过快手官方 API 接入。",
    link: "https://klingai.kuaishou.com",
  },
  {
    name: "Vidu 2.0",
    provider: "生数科技 · 官方 API",
    badge: "新",
    description: "生数科技视频模型，支持首尾帧模式，以流畅运动和高清画质见长",
    features: ["✅ 单图模式", "✅ 首尾帧模式", "流畅运动", "1080p 高清"],
    modes: { single: true, firstFrame: true, firstLast: true, multiRef: false, batchRelay: false, audioRef: false, videoRef: false },
    quality: "1080p",
    duration: "4~8 秒",
    tips: "首尾帧质量不错，动态流畅度高。通过七牛云或 Vidu 官方 API 接入。",
    link: "https://www.vidu.com",
  },
  {
    name: "PixVerse V5",
    provider: "PixVerse · fal.ai / 官方",
    badge: "稳定",
    description: "PixVerse 最新模型，支持首尾帧模式，动漫和真人风格均好",
    features: ["✅ 单图模式", "✅ 首尾帧模式", "动漫/真人双场景", "720p/1080p"],
    modes: { single: true, firstFrame: true, firstLast: true, multiRef: false, batchRelay: false, audioRef: false, videoRef: false },
    quality: "720p / 1080p",
    duration: "5~8 秒",
    tips: "动漫场景表现尤为出色。可通过 PixVerse 官方 API 或 fal.ai 接入。",
    link: "https://pixverse.ai",
  },
  {
    name: "智谱 CogVideoX-5B",
    provider: "智谱清影 · 开源",
    badge: "经济",
    description: "智谱开源视频模型，可本地部署，仅支持单图 / 文生视频模式",
    features: ["✅ 单图/文生视频", "开源可本地部署", "零 API 成本（自部署）"],
    modes: { single: true, firstFrame: true, firstLast: false, multiRef: false, batchRelay: false, audioRef: false, videoRef: false },
    quality: "720p",
    duration: "~6 秒",
    tips: "适合有 GPU 资源的用户自行部署，零成本生成。不支持首尾帧。",
    link: "https://github.com/THUDM/CogVideo",
  },
  {
    name: "通义万相 Wan 2.2",
    provider: "阿里云 · 开源 / API",
    badge: "经济",
    description: "阿里通义开源视频模型，支持单图和文生视频，可本地或 API 使用",
    features: ["✅ 单图/文生视频", "开源可部署", "阿里云 DashScope API 可用"],
    modes: { single: true, firstFrame: true, firstLast: false, multiRef: false, batchRelay: false, audioRef: false, videoRef: false },
    quality: "720p",
    duration: "~5 秒",
    tips: "阿里开源模型，通过 DashScope API 可直接调用，国内无需代理。也可本地部署。",
    link: "https://tongyi.aliyun.com",
  },
];

// ── 模式说明 ──────────────────────────────────────────────
interface ModeExplainer {
  key: string;
  name: string;
  icon: string;
  description: string;
  howItWorks: string;
  bestFor: string;
}

const VIDEO_MODES: ModeExplainer[] = [
  {
    key: "single",
    name: "单图模式",
    icon: "🖼️",
    description: "上传一张参考图 + 文字提示词，AI 基于首帧图片生成视频",
    howItWorks: "图片作为视频第一帧，AI 根据提示词推演后续运动和变化",
    bestFor: "最常用模式，适合大多数分镜场景。一张分镜图 → 一段动态视频",
  },
  {
    key: "firstlast",
    name: "首尾帧模式",
    icon: "🔄",
    description: "同时指定视频的开始画面（首帧）和结束画面（尾帧），AI 自动生成中间过渡",
    howItWorks: "上传两张图：首帧 A 和尾帧 B，AI 生成从 A 到 B 的自然过渡动画",
    bestFor: "转场镜头、角色动作衔接、场景切换。如：从远景过渡到特写，或人物从站立到奔跑",
  },
  {
    key: "multiref",
    name: "多参考模式",
    icon: "📚",
    description: "上传多张参考图片，AI 综合所有图片的风格、角色、场景信息生成视频",
    howItWorks: "多张图同时作为参考输入，AI 理解角色外观、环境风格后生成一致性更强的视频",
    bestFor: "角色一致性要求高的场景。可以上传角色正面照 + 侧面照 + 场景图作为参考",
  },
  {
    key: "batchRelay",
    name: "批量接力模式",
    icon: "⛓️",
    description: "上传 A、B、C、D 四张图，自动生成 A→B、B→C、C→D 三段连续视频",
    howItWorks: "系统自动拆分为三个首尾帧任务并行生成，最终组成连贯的视频序列",
    bestFor: "需要多个镜头衔接的完整片段。如：四个分镜格连续生成为一组流畅的视频",
  },
  {
    key: "allRef",
    name: "全能参考模式（Seedance 2.0 独有）",
    icon: "✨",
    description: "可以同时上传图片、音频、视频文件作为参考，AI 综合所有素材生成视频",
    howItWorks: "上传角色图 + 背景音乐 + 动作参考视频，AI 融合所有信息生成高一致性视频",
    bestFor: "高端创作需求。如：导入角色设计图 + 节奏音乐 + 动作 reference，一次性出成品",
  },
];

// ═══════════════════════════════════════════════════════════
// 渲染辅助
// ═══════════════════════════════════════════════════════════

function BadgeTag({ badge }: { badge?: string }) {
  if (!badge) return null;
  const colorMap: Record<string, string> = {
    "推荐": "bg-[var(--gold-primary)] text-[#0A0A0A]",
    "旗舰": "bg-purple-500/80 text-white",
    "快速": "bg-blue-500/80 text-white",
    "经济": "bg-green-500/80 text-white",
    "新": "bg-pink-500/80 text-white",
    "稳定": "bg-slate-500/80 text-white",
  };
  return (
    <span className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase rounded ${colorMap[badge] || "bg-gray-500 text-white"}`}>
      {badge}
    </span>
  );
}

function SupportIcon({ supported }: { supported: boolean }) {
  return supported ? (
    <CheckCircle size={14} className="text-green-400 shrink-0" />
  ) : (
    <XCircle size={14} className="text-red-400/60 shrink-0" />
  );
}

function ModelCard({ model, index }: { model: ModelEntry; index: number }) {
  return (
    <div className="flex flex-col gap-3 p-4 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg hover:border-[var(--gold-primary)]/30 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px] font-semibold text-[var(--text-primary)]">{model.name}</span>
            <BadgeTag badge={model.badge} />
          </div>
          <span className="text-[12px] text-[var(--text-muted)]">{model.provider}</span>
        </div>
        {model.link && (
          <a href={model.link} target="_blank" rel="noopener noreferrer"
            className="text-[var(--text-muted)] hover:text-[var(--gold-primary)] transition shrink-0">
            <ExternalLink size={14} />
          </a>
        )}
      </div>
      <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{model.description}</p>
      <div className="flex flex-wrap gap-1.5">
        {model.features.map((f, i) => (
          <span key={i} className="px-2 py-1 text-[11px] text-[var(--text-secondary)] bg-[#ffffff06] border border-[var(--border-subtle)] rounded">
            {f}
          </span>
        ))}
      </div>
      {model.tips && (
        <div className="flex items-start gap-2 p-2.5 bg-[var(--gold-transparent)] border border-[var(--gold-primary)]/15 rounded">
          <Info size={13} className="text-[var(--gold-primary)] shrink-0 mt-0.5" />
          <span className="text-[12px] text-[var(--gold-secondary)] leading-relaxed">{model.tips}</span>
        </div>
      )}
    </div>
  );
}

function VideoModelCard({ model }: { model: VideoModelEntry }) {
  return (
    <div className="flex flex-col gap-3 p-4 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg hover:border-[var(--gold-primary)]/30 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px] font-semibold text-[var(--text-primary)]">{model.name}</span>
            <BadgeTag badge={model.badge} />
          </div>
          <span className="text-[12px] text-[var(--text-muted)]">{model.provider}</span>
        </div>
        {model.link && (
          <a href={model.link} target="_blank" rel="noopener noreferrer"
            className="text-[var(--text-muted)] hover:text-[var(--gold-primary)] transition shrink-0">
            <ExternalLink size={14} />
          </a>
        )}
      </div>
      <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{model.description}</p>

      {/* 参数信息 */}
      <div className="flex flex-wrap gap-3 text-[12px]">
        <span className="flex items-center gap-1 text-[var(--text-secondary)]">
          <Star size={12} className="text-[var(--gold-primary)]" /> {model.quality}
        </span>
        <span className="flex items-center gap-1 text-[var(--text-secondary)]">
          <Clock size={12} className="text-[var(--gold-primary)]" /> {model.duration}
        </span>
        {model.creditInfo && (
          <span className="flex items-center gap-1 text-[var(--text-secondary)]">
            <Zap size={12} className="text-[var(--gold-primary)]" /> {model.creditInfo}
          </span>
        )}
      </div>

      {/* 支持模式 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div className="flex items-center gap-1.5">
          <SupportIcon supported={model.modes.single} />
          <span className="text-[var(--text-secondary)]">单图/首帧</span>
        </div>
        <div className="flex items-center gap-1.5">
          <SupportIcon supported={model.modes.firstLast} />
          <span className="text-[var(--text-secondary)]">首尾帧</span>
        </div>
        <div className="flex items-center gap-1.5">
          <SupportIcon supported={model.modes.multiRef} />
          <span className="text-[var(--text-secondary)]">多参考</span>
        </div>
        <div className="flex items-center gap-1.5">
          <SupportIcon supported={model.modes.batchRelay} />
          <span className="text-[var(--text-secondary)]">批量接力</span>
        </div>
        <div className="flex items-center gap-1.5">
          <SupportIcon supported={model.modes.audioRef} />
          <span className="text-[var(--text-secondary)]">音频参考</span>
        </div>
        <div className="flex items-center gap-1.5">
          <SupportIcon supported={model.modes.videoRef} />
          <span className="text-[var(--text-secondary)]">视频参考</span>
        </div>
      </div>

      {/* 特性标签 */}
      <div className="flex flex-wrap gap-1.5">
        {model.features.map((f, i) => (
          <span key={i} className="px-2 py-1 text-[11px] text-[var(--text-secondary)] bg-[#ffffff06] border border-[var(--border-subtle)] rounded">
            {f}
          </span>
        ))}
      </div>

      {model.tips && (
        <div className="flex items-start gap-2 p-2.5 bg-[var(--gold-transparent)] border border-[var(--gold-primary)]/15 rounded">
          <Info size={13} className="text-[var(--gold-primary)] shrink-0 mt-0.5" />
          <span className="text-[12px] text-[var(--gold-secondary)] leading-relaxed">{model.tips}</span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 主页面
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// 搜索过滤
// ═══════════════════════════════════════════════════════════

/** 模糊匹配：将关键词拆分后全部命中才算匹配 */
function fuzzyMatch(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.every((kw) => lower.includes(kw));
}

/** 将 ModelEntry / VideoModelEntry 的所有文本字段拼接为一个可搜索字符串 */
function modelSearchText(m: ModelEntry | VideoModelEntry): string {
  const parts = [m.name, m.provider, m.description, m.badge || "", m.tips || "", ...m.features];
  if ("quality" in m) parts.push(m.quality, m.duration, m.creditInfo || "");
  return parts.join(" ");
}

export default function ModelGuidePage() {
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // 将搜索词拆分为关键词数组（空格分隔、去重）
  const keywords = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [] as string[];
    return [...new Set(q.split(/\s+/))];
  }, [searchQuery]);

  const isSearching = keywords.length > 0;

  // 预过滤各模型列表
  const filteredText = useMemo(() => isSearching ? TEXT_MODELS.filter((m) => fuzzyMatch(modelSearchText(m), keywords)) : TEXT_MODELS, [keywords, isSearching]);
  const filteredImage = useMemo(() => isSearching ? IMAGE_MODELS.filter((m) => fuzzyMatch(modelSearchText(m), keywords)) : IMAGE_MODELS, [keywords, isSearching]);
  const filteredJimeng = useMemo(() => isSearching ? VIDEO_MODELS_JIMENG.filter((m) => fuzzyMatch(modelSearchText(m), keywords)) : VIDEO_MODELS_JIMENG, [keywords, isSearching]);
  const filteredInternational = useMemo(() => isSearching ? VIDEO_MODELS_INTERNATIONAL.filter((m) => fuzzyMatch(modelSearchText(m), keywords)) : VIDEO_MODELS_INTERNATIONAL, [keywords, isSearching]);
  const filteredDomestic = useMemo(() => isSearching ? VIDEO_MODELS_DOMESTIC.filter((m) => fuzzyMatch(modelSearchText(m), keywords)) : VIDEO_MODELS_DOMESTIC, [keywords, isSearching]);

  // FAQ 过滤
  const ALL_FAQ = [
    { q: "首尾帧和单图模式有什么区别？", a: "单图模式只指定第一帧，AI 自由发挥后续画面；首尾帧模式同时指定起始和结束画面，AI 生成中间的平滑过渡。首尾帧更适合转场和动作衔接。" },
    { q: "为什么有些视频模型不支持首尾帧？", a: "每个模型的架构不同。国际模型中 Runway Gen-4、Sora 2 仅支持单图输入；国内模型中 CogVideoX、Wan 2.2 也只支持单图/文生。支持首尾帧的推荐：VEO 3.1 Fast 4K、Luma Ray 3、MiniMax Hailuo-02（国际）；可灵 Kling 2.6/O3、Vidu 2.0、PixVerse V5（国内）。" },
    { q: "「全能参考」和「多参考模式」有什么区别？", a: "全能参考是 Seedance 2.0 的独有能力，可以混合上传图片+音频+视频；多参考模式（如 Grok Video 3）只支持多张图片参考，不支持音频和视频。" },
    { q: "即梦模型和第三方 API 模型怎么选？", a: "即梦模型在 Seedance 页面使用，需登录即梦账号（免配置 API Key，消耗即梦积分）。第三方 API 模型在图生视频页面使用，需配置 API Key（按量付费）。两者可以并行使用。" },
    { q: "批量接力模式怎么用？", a: "在图生视频页面选择支持批量接力的模型（如 VEO 3.1 Fast 4K），切换到「批量接力」模式，上传 4 张连续的分镜图（如从宫格导入），系统会自动生成 A→B、B→C、C→D 三段视频。" },
    { q: "七牛云的模型需要怎么配置？", a: "在七牛云官网注册并获取 API Key（https://s.qiniu.com/VZz67r），然后在「设置」页面使用预设一键导入。七牛云同时提供 LLM、图像、视频三类模型，API 统一为 https://api.qnaigc.com 。" },
    { q: "Google API 无法连接怎么办？", a: "如果你在中国大陆，Google API 可能需要代理。在「设置」中设置好 HTTPS_PROXY 环境变量，或者使用 USSN / GeeKnow 等转售商的 API（他们提供国内直连的中转地址）。" },
    { q: "fal.ai 是什么？怎么用？", a: "fal.ai 是一个 AI 模型聚合平台，一个 API Key 即可调用 Veo 3.1、Kling、Sora 2、MiniMax、PixVerse、Luma Ray 3 等几十个视频模型。在「设置」→「视频生成」中使用 fal.ai 的 Base URL 和 Key 即可。对于想要尝试多种模型的用户非常方便。" },
    { q: "国内用户不想用代理，有哪些视频模型可选？", a: "不需要代理的选择：即梦全系列（Seedance 页面，登录即用）、七牛云转售的 Kling/Vidu/Sora 2（国内直连）、可灵官方 API、PixVerse、CogVideoX、通义万相 Wan 2.2。这些都支持国内网络直连。" },
  ];
  const filteredFaq = useMemo(() => isSearching ? ALL_FAQ.filter((f) => fuzzyMatch(f.q + " " + f.a, keywords)) : ALL_FAQ, [keywords, isSearching]);

  const totalResults = filteredText.length + filteredImage.length + filteredJimeng.length + filteredInternational.length + filteredDomestic.length + filteredFaq.length;

  return (
    <div className="flex h-full w-full bg-[var(--bg-page)]">
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-auto">
        {/* 页头 */}
        <header className="sticky top-0 z-20 flex items-center gap-3 px-8 py-5 bg-[var(--bg-page)]/95 backdrop-blur-sm border-b border-[var(--border-subtle)]">
          <GraduationCap size={24} className="text-[var(--gold-primary)] shrink-0" />
          <div className="flex flex-col flex-1 min-w-0">
            <h1 className="text-[20px] font-bold text-[var(--text-primary)]">模型学习指南</h1>
            <p className="text-[13px] text-[var(--text-muted)]">了解本项目用到的所有 AI 模型及其能力差异，快速上手配置</p>
          </div>
          {/* 搜索框 */}
          <div className="relative flex items-center shrink-0">
            <Search size={15} className="absolute left-3 text-[var(--text-muted)] pointer-events-none" />
            <input
              ref={inputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索模型、功能、FAQ…"
              className="w-[260px] pl-9 pr-8 py-2 text-[13px] bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--gold-primary)] transition"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); inputRef.current?.focus(); }}
                className="absolute right-2.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[1000px] mx-auto px-8 py-8 flex flex-col gap-12">

            {/* ═══ 搜索结果摘要 ═══ */}
            {isSearching && (
              <div className="flex items-center gap-2 px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg">
                <Search size={15} className="text-[var(--gold-primary)] shrink-0" />
                <span className="text-[13px] text-[var(--text-secondary)]">
                  搜索 <strong className="text-[var(--text-primary)]">"{searchQuery.trim()}"</strong> — 找到
                  <strong className="text-[var(--gold-primary)] mx-1">{totalResults}</strong>条匹配结果
                  {totalResults === 0 && "，试试其他关键词？"}
                </span>
                <button onClick={() => { setSearchQuery(""); inputRef.current?.focus(); }}
                  className="ml-auto text-[12px] text-[var(--text-muted)] hover:text-[var(--gold-primary)] transition cursor-pointer">
                  清除搜索
                </button>
              </div>
            )}

            {/* ═══ 快速指引（搜索时隐藏） ═══ */}
            {!isSearching && <section className="flex flex-col gap-4">
              <div className="flex items-start gap-3 p-4 bg-[var(--gold-transparent)] border border-[var(--gold-primary)]/20 rounded-lg">
                <AlertTriangle size={18} className="text-[var(--gold-primary)] shrink-0 mt-0.5" />
                <div className="flex flex-col gap-2">
                  <span className="text-[14px] font-semibold text-[var(--gold-primary)]">快速入门提示</span>
                  <ul className="flex flex-col gap-1.5 text-[13px] text-[var(--text-secondary)] leading-relaxed">
                    <li className="flex items-start gap-2">
                      <ChevronRight size={14} className="text-[var(--gold-primary)] shrink-0 mt-0.5" />
                      <span><strong>文本模型</strong>用于分镜流水线的剧本分析和节拍拆解，推荐 Gemini 2.5 Pro</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <ChevronRight size={14} className="text-[var(--gold-primary)] shrink-0 mt-0.5" />
                      <span><strong>图像模型</strong>用于生图工作台的九宫格/四宫格分镜图生成，推荐 Gemini 2.5 Flash Image</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <ChevronRight size={14} className="text-[var(--gold-primary)] shrink-0 mt-0.5" />
                      <span><strong>第三方视频模型</strong>用于图生视频工作台，将分镜图转为动态视频。推荐 VEO 3.1 Fast 4K</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <ChevronRight size={14} className="text-[var(--gold-primary)] shrink-0 mt-0.5" />
                      <span><strong>即梦视频模型</strong>用于 Seedance 页面，需登录即梦账号。推荐 Seedance 2.0 Pro</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <ChevronRight size={14} className="text-[var(--gold-primary)] shrink-0 mt-0.5" />
                      <span>所有第三方 API 模型需在<strong>「设置」</strong>页配置 API Key 和端点地址</span>
                    </li>
                  </ul>
                </div>
              </div>
            </section>}

            {/* ═══ 视频模式详解（搜索时隐藏） ═══ */}
            {!isSearching && <section className="flex flex-col gap-5">
              <div className="flex items-center gap-2">
                <Layers size={20} className="text-[var(--gold-primary)]" />
                <h2 className="text-[18px] font-bold text-[var(--text-primary)]">视频生成模式详解</h2>
                <span className="text-[12px] text-[var(--gold-primary)] bg-[var(--gold-transparent)] px-2 py-0.5 rounded font-medium">重点</span>
              </div>
              <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                不同视频模型支持的生成模式不同。理解模式差异是正确使用的关键。以下是本项目支持的 5 种视频生成模式：
              </p>
              <div className="grid grid-cols-1 gap-3">
                {VIDEO_MODES.map((mode) => (
                  <div key={mode.key} className="flex flex-col gap-2 p-4 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-[20px]">{mode.icon}</span>
                      <span className="text-[15px] font-semibold text-[var(--text-primary)]">{mode.name}</span>
                    </div>
                    <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{mode.description}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px]">
                      <div className="flex items-start gap-2 p-2 bg-[#ffffff06] rounded">
                        <span className="text-[var(--gold-primary)] font-medium shrink-0">原理：</span>
                        <span className="text-[var(--text-secondary)]">{mode.howItWorks}</span>
                      </div>
                      <div className="flex items-start gap-2 p-2 bg-[#ffffff06] rounded">
                        <span className="text-[var(--gold-primary)] font-medium shrink-0">适用：</span>
                        <span className="text-[var(--text-secondary)]">{mode.bestFor}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>}

            {/* ═══ 即梦视频模型 ═══ */}
            {filteredJimeng.length > 0 && <section className="flex flex-col gap-5">
              <div className="flex items-center gap-2">
                <Clapperboard size={20} className="text-[var(--gold-primary)]" />
                <h2 className="text-[18px] font-bold text-[var(--text-primary)]">即梦视频模型（Seedance 页面）</h2>
                {isSearching && <span className="text-[12px] text-[var(--text-muted)]">{filteredJimeng.length} 条匹配</span>}
              </div>
              {!isSearching && <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                即梦模型需要登录即梦账号，系统通过内置浏览器代理自动调用 API。在 Seedance 页面使用。
              </p>}

              {/* 模型对比表 */}
              <div className="overflow-x-auto">
                <table className="w-full text-[12px] border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg-surface)]">
                      <th className="text-left p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">模型</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">首帧</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">首尾帧</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">全能参考</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">音频</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">画质</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">时长</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">积分/秒</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJimeng.map((m) => (
                      <tr key={m.name} className="border-b border-[var(--border-subtle)] hover:bg-[#ffffff04]">
                        <td className="p-2.5 text-[var(--text-primary)] font-medium">
                          <div className="flex items-center gap-1.5">{m.name} <BadgeTag badge={m.badge} /></div>
                        </td>
                        <td className="text-center p-2.5"><SupportIcon supported={m.modes.firstFrame} /></td>
                        <td className="text-center p-2.5"><SupportIcon supported={m.modes.firstLast} /></td>
                        <td className="text-center p-2.5"><SupportIcon supported={m.modes.multiRef || m.modes.audioRef} /></td>
                        <td className="text-center p-2.5"><SupportIcon supported={m.modes.audioRef} /></td>
                        <td className="text-center p-2.5 text-[var(--text-secondary)]">{m.quality}</td>
                        <td className="text-center p-2.5 text-[var(--text-secondary)]">{m.duration}</td>
                        <td className="text-center p-2.5 text-[var(--text-secondary)]">{m.creditInfo?.split("|")[0]?.trim()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {filteredJimeng.map((m) => (
                  <VideoModelCard key={m.name} model={m} />
                ))}
              </div>
            </section>}

            {/* ═══ 第三方视频模型 — 国际 ═══ */}
            {filteredInternational.length > 0 && <section className="flex flex-col gap-5">
              <div className="flex items-center gap-2">
                <Film size={20} className="text-[var(--gold-primary)]" />
                <h2 className="text-[18px] font-bold text-[var(--text-primary)]">国际视频模型（图生视频页面）</h2>
                {isSearching && <span className="text-[12px] text-[var(--text-muted)]">{filteredInternational.length} 条匹配</span>}
              </div>
              {!isSearching && <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                通过 OpenAI 兼容 API / fal.ai / 转售商接入的国际模型。需在<strong>「设置」→「视频生成」</strong>中添加配置。部分模型需要代理或 VPN。
              </p>}

              {/* 国际模型模式对比表 */}
              <div className="overflow-x-auto">
                <table className="w-full text-[12px] border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg-surface)]">
                      <th className="text-left p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">模型</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">单图</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">首尾帧</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">多参考</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">接力</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">画质</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">时长</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInternational.map((m) => (
                      <tr key={m.name} className="border-b border-[var(--border-subtle)] hover:bg-[#ffffff04]">
                        <td className="p-2.5 text-[var(--text-primary)] font-medium">
                          <div className="flex items-center gap-1.5">{m.name} <BadgeTag badge={m.badge} /></div>
                        </td>
                        <td className="text-center p-2.5"><SupportIcon supported={m.modes.single} /></td>
                        <td className="text-center p-2.5"><SupportIcon supported={m.modes.firstLast} /></td>
                        <td className="text-center p-2.5"><SupportIcon supported={m.modes.multiRef} /></td>
                        <td className="text-center p-2.5"><SupportIcon supported={m.modes.batchRelay} /></td>
                        <td className="text-center p-2.5 text-[var(--text-secondary)]">{m.quality}</td>
                        <td className="text-center p-2.5 text-[var(--text-secondary)]">{m.duration}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {filteredInternational.map((m) => (
                  <VideoModelCard key={m.name} model={m} />
                ))}
              </div>
            </section>}

            {/* ═══ 第三方视频模型 — 国内 ═══ */}
            {filteredDomestic.length > 0 && <section className="flex flex-col gap-5">
              <div className="flex items-center gap-2">
                <Film size={20} className="text-[var(--gold-primary)]" />
                <h2 className="text-[18px] font-bold text-[var(--text-primary)]">国内视频模型（图生视频页面）</h2>
                {isSearching && <span className="text-[12px] text-[var(--text-muted)]">{filteredDomestic.length} 条匹配</span>}
              </div>
              {!isSearching && <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                国内可直连、无需代理的视频模型。通过官方 API / 七牛云 / fal.ai 接入。即梦模型请看上方的 Seedance 专区。
              </p>}

              {/* 国内模型模式对比表 */}
              <div className="overflow-x-auto">
                <table className="w-full text-[12px] border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg-surface)]">
                      <th className="text-left p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">模型</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">单图</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">首尾帧</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">多参考</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">画质</th>
                      <th className="text-center p-2.5 text-[var(--text-muted)] font-medium border-b border-[var(--border-default)]">时长</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDomestic.map((m) => (
                      <tr key={m.name} className="border-b border-[var(--border-subtle)] hover:bg-[#ffffff04]">
                        <td className="p-2.5 text-[var(--text-primary)] font-medium">
                          <div className="flex items-center gap-1.5">{m.name} <BadgeTag badge={m.badge} /></div>
                        </td>
                        <td className="text-center p-2.5"><SupportIcon supported={m.modes.single} /></td>
                        <td className="text-center p-2.5"><SupportIcon supported={m.modes.firstLast} /></td>
                        <td className="text-center p-2.5"><SupportIcon supported={m.modes.multiRef} /></td>
                        <td className="text-center p-2.5 text-[var(--text-secondary)]">{m.quality}</td>
                        <td className="text-center p-2.5 text-[var(--text-secondary)]">{m.duration}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {filteredDomestic.map((m) => (
                  <VideoModelCard key={m.name} model={m} />
                ))}
              </div>
            </section>}

            {/* ═══ 文本模型 ═══ */}
            {filteredText.length > 0 && <section className="flex flex-col gap-5">
              <div className="flex items-center gap-2">
                <MessageSquareText size={20} className="text-[var(--gold-primary)]" />
                <h2 className="text-[18px] font-bold text-[var(--text-primary)]">文本模型（分镜流水线）</h2>
                {isSearching && <span className="text-[12px] text-[var(--text-muted)]">{filteredText.length} 条匹配</span>}
              </div>
              {!isSearching && <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                文本模型用于分镜流水线中的剧本分析、节拍拆解、智能分镜。需在<strong>「设置」→「LLM 配置」</strong>中配置。
              </p>}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {filteredText.map((m, i) => (
                  <ModelCard key={m.name} model={m} index={i} />
                ))}
              </div>
            </section>}

            {/* ═══ 图像模型 ═══ */}
            {filteredImage.length > 0 && <section className="flex flex-col gap-5">
              <div className="flex items-center gap-2">
                <Image size={20} className="text-[var(--gold-primary)]" />
                <h2 className="text-[18px] font-bold text-[var(--text-primary)]">图像模型（生图工作台）</h2>
                {isSearching && <span className="text-[12px] text-[var(--text-muted)]">{filteredImage.length} 条匹配</span>}
              </div>
              {!isSearching && <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                图像模型用于生图工作台的九宫格/四宫格分镜图生成。需在<strong>「设置」→「图像生成」</strong>中配置。
                即梦生图在 Seedance / 即梦生图页面独立使用。
              </p>}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {filteredImage.map((m, i) => (
                  <ModelCard key={m.name} model={m} index={i} />
                ))}
              </div>
            </section>}

            {/* ═══ 常见问题 ═══ */}
            {filteredFaq.length > 0 && <section className="flex flex-col gap-5">
              <div className="flex items-center gap-2">
                <AlertTriangle size={20} className="text-[var(--gold-primary)]" />
                <h2 className="text-[18px] font-bold text-[var(--text-primary)]">常见问题</h2>
                {isSearching && <span className="text-[12px] text-[var(--text-muted)]">{filteredFaq.length} 条匹配</span>}
              </div>
              <div className="flex flex-col gap-3">
                {filteredFaq.map(({ q, a }) => (
                  <div key={q} className="flex flex-col gap-2 p-4 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg">
                    <span className="text-[14px] font-semibold text-[var(--text-primary)]">{q}</span>
                    <span className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{a}</span>
                  </div>
                ))}
              </div>
            </section>}

            {/* 底部留白 */}
            <div className="h-12" />
          </div>
        </div>
      </main>
    </div>
  );
}
