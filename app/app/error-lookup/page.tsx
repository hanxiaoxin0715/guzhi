"use client";

import { useState, useMemo } from "react";
import {
  Search,
  AlertCircle,
  Wifi,
  KeyRound,
  Clock,
  Server,
  Monitor,
  Image,
  Film,
  MessageSquareText,
  Clapperboard,
  GitBranch,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
  ShieldAlert,
} from "lucide-react";
import Sidebar from "../components/Sidebar";

// ═══════════════════════════════════════════════════════════
// 错误码数据定义
// ═══════════════════════════════════════════════════════════

interface ErrorEntry {
  code: string;           // 错误码/关键词（用户搜索用）
  title: string;          // 简短标题
  message: string;        // 用户可能看到的提示信息
  cause: string;          // 原因
  solution: string;       // 解决方案
  module: string;         // 所属模块
  severity: "error" | "warning" | "info";
  tags: string[];         // 额外搜索标签
}

// ── HTTP 通用状态码 ──────────────────────────────────────
const HTTP_ERRORS: ErrorEntry[] = [
  {
    code: "400",
    title: "请求参数错误 (400 Bad Request)",
    message: "缺少必要参数 / 参数格式不正确",
    cause: "发送给服务器的请求数据不完整或格式有误。常见于未填写 API Key、未选择模型、提示词为空等情况。",
    solution: "1. 检查「设置」页面中 API Key、Model、Base URL 是否都已填写\n2. 确认提示词不为空\n3. 如果使用火山引擎，Model 需填接入点 ID（ep-xxxx），不是模型名",
    module: "通用",
    severity: "error",
    tags: ["Bad Request", "参数", "缺少"],
  },
  {
    code: "401",
    title: "API 认证失败 (401 Unauthorized)",
    message: "API Key 认证失败 / API Key 无效或已过期",
    cause: "API Key 不正确、已过期、或使用了错误类型的密钥。也可能是复制 Key 时带入了空格或换行符。",
    solution: "1. 重新复制 API Key，注意不要带入首尾的空格或换行\n2. 检查 API Key 是否已过期\n3. 火山引擎：需使用「方舟控制台 → API Key 管理」的 Key（而非 IAM 密钥）\n4. 七牛云：确认 Key 来自 https://s.qiniu.com/VZz67r\n5. Google：确认 Key 来自 https://aistudio.google.com/apikey",
    module: "通用",
    severity: "error",
    tags: ["Unauthorized", "认证", "密钥", "key", "apikey", "过期", "无效"],
  },
  {
    code: "403",
    title: "权限被拒绝 (403 Forbidden)",
    message: "服务器拒绝了请求 / 无权访问",
    cause: "API Key 权限不足，或者该模型未对你的账号开放。某些 API 可能需要开通特定服务。",
    solution: "1. 检查 API 服务商控制台，确认账号是否已开通对应服务\n2. 某些模型（如 Gemini 2.5 Pro）可能有地区限制\n3. 转售商 API 确认余额是否充足",
    module: "通用",
    severity: "error",
    tags: ["Forbidden", "权限", "拒绝", "禁止"],
  },
  {
    code: "404",
    title: "资源不存在 (404 Not Found)",
    message: "请求的 API 端点或资源不存在",
    cause: "Base URL 配置错误，或模型名称拼写错误。",
    solution: "1. 检查「设置」中的 Base URL 是否正确\n2. Gemini 格式的 URL 不含 /v1beta（系统会自动拼接）\n3. OpenAI 格式的 URL 不含 /v1（系统会自动拼接）\n4. 检查模型名称是否拼写正确",
    module: "通用",
    severity: "error",
    tags: ["Not Found", "不存在", "URL", "端点"],
  },
  {
    code: "408",
    title: "请求超时 (408 Timeout)",
    message: "视频生成超时 / 轮询超时",
    cause: "视频生成任务耗时过长，超过了设定的超时时间。",
    solution: "1. 这通常不是错误，视频生成本身耗时较长\n2. 可以尝试减少视频时长\n3. 检查网络是否稳定\n4. 重试即可",
    module: "视频生成",
    severity: "warning",
    tags: ["timeout", "超时", "等待"],
  },
  {
    code: "422",
    title: "请求无法处理 (422 Unprocessable)",
    message: "内容安全审核未通过 / 模型无法处理当前请求",
    cause: "提示词或图片触发了平台的内容安全审核，或者模型不支持当前参数组合。",
    solution: "1. 检查提示词是否包含敏感内容\n2. 检查参考图是否包含不当内容\n3. 视频生成中可能是分辨率/时长/模型组合不支持\n4. 尝试修改提示词后重试",
    module: "通用",
    severity: "error",
    tags: ["Unprocessable", "审核", "安全", "内容", "content safety"],
  },
  {
    code: "429",
    title: "请求频率过高 (429 Too Many Requests)",
    message: "API 频率限制 / 请稍后重试",
    cause: "短时间内请求次数超过了 API 服务商的速率限制。",
    solution: "1. 等待 30 秒后重试\n2. 避免短时间内大量并发请求\n3. 免费额度通常有较低的速率限制，升级付费计划可提升\n4. Gemini 免费版每分钟请求数有限，等待即可",
    module: "通用",
    severity: "warning",
    tags: ["rate limit", "频率", "限制", "太快", "too many"],
  },
  {
    code: "500",
    title: "服务端内部错误 (500 Internal Server Error)",
    message: "服务端错误 / 内部错误",
    cause: "服务端发生了未预期的错误。可能是本地服务出错或远端 API 出错。",
    solution: "1. 查看左上角终端/控制台日志获取详细错误信息\n2. 重启应用后重试\n3. 如果远端 API 持续 500，可能是服务商侧故障",
    module: "通用",
    severity: "error",
    tags: ["Internal Server Error", "内部错误", "服务端"],
  },
  {
    code: "502",
    title: "网关错误 (502 Bad Gateway)",
    message: "API 网关错误 / CDN 暂时不可用 / 图像代理失败",
    cause: "转售商的 CDN/API 网关暂时不可用，或 Google API 被墙导致连接失败。",
    solution: "1. 等待 1-2 分钟后重试（CDN 通常很快恢复）\n2. 如果反复出现，在「设置」页面切换到国内直连 API\n3. 使用 HTTPS_PROXY 环境变量配置代理\n4. 检查 VPN 或代理是否正常",
    module: "通用",
    severity: "error",
    tags: ["Bad Gateway", "网关", "CDN", "代理"],
  },
  {
    code: "503",
    title: "服务不可用 (503 Service Unavailable)",
    message: "API 服务暂时不可用",
    cause: "API 服务商正在维护或暂时过载。",
    solution: "1. 等待几分钟后重试\n2. 检查服务商状态页面\n3. 切换到备用 API 服务",
    module: "通用",
    severity: "warning",
    tags: ["Service Unavailable", "维护", "不可用", "过载"],
  },
  {
    code: "504",
    title: "网关超时 (504 Gateway Timeout)",
    message: "API 网关超时",
    cause: "请求在网关层超时，通常是转售商中转延迟过高或目标 API 响应慢。",
    solution: "1. 同 502 的处理方式\n2. 如果持续出现，可能是当前模型负载过高",
    module: "通用",
    severity: "warning",
    tags: ["Gateway Timeout", "网关超时"],
  },
];

// ── 即梦 API ret 错误码 ──────────────────────────────────
const JIMENG_RET_ERRORS: ErrorEntry[] = [
  {
    code: "ret=0",
    title: "即梦 API 成功",
    message: "请求成功（ret=0）",
    cause: "这不是错误。ret=0 表示即梦 API 请求正常完成。",
    solution: "无需处理，该状态表示成功。",
    module: "即梦",
    severity: "info",
    tags: ["即梦", "jimeng", "成功"],
  },
  {
    code: "ret=1000",
    title: "即梦 API 通用错误 (ret=1000)",
    message: "即梦API错误 (ret=1000)",
    cause: "即梦 API 的通用错误码。通常是请求参数不正确，或者请求体结构有误。对于 3.x 视频模型，常见原因是 extend 对象缺少必要的 m_video_commerce_info 字段。",
    solution: "1. 确保已登录即梦账号且 Cookie 有效\n2. 检查是否选择了正确的模型\n3. 如果是 3.x 系列，确认 extend 结构完整\n4. 重新登录即梦后重试",
    module: "即梦",
    severity: "error",
    tags: ["即梦", "jimeng", "1000", "通用错误"],
  },
  {
    code: "ret=1002",
    title: "即梦 Cookie 过期 (ret=1002)",
    message: "即梦API错误 (ret=1002) / 登录状态失效",
    cause: "即梦账号的登录 Cookie 已过期或失效。",
    solution: "1. 点击 Seedance 页面顶部的「登录即梦」按钮重新登录\n2. 如果浏览器窗口无法打开，检查 Playwright 是否已安装",
    module: "即梦",
    severity: "error",
    tags: ["即梦", "jimeng", "1002", "cookie", "登录", "过期"],
  },
  {
    code: "ret=1015",
    title: "即梦会话过期 (ret=1015)",
    message: "即梦API错误 (ret=1015) / 会话已过期",
    cause: "当前即梦会话已过期，需要刷新。",
    solution: "1. 重新登录即梦账号\n2. 清除浏览器缓存后重新登录",
    module: "即梦",
    severity: "error",
    tags: ["即梦", "jimeng", "1015", "会话", "session"],
  },
  {
    code: "ret=3018",
    title: "即梦权限拒绝 (ret=3018)",
    message: "即梦API错误 (ret=3018) / 权限不足",
    cause: "账号没有调用该 API 功能的权限。可能是未开通对应服务或账号等级不够。",
    solution: "1. 确认即梦账号已注册并完成实名认证\n2. 某些功能可能需要 VIP 会员\n3. 检查是否使用了正确的账号",
    module: "即梦",
    severity: "error",
    tags: ["即梦", "jimeng", "3018", "权限", "拒绝"],
  },
  {
    code: "ret=5000",
    title: "即梦积分不足 (ret=5000)",
    message: "即梦积分不足，请前往即梦官网领取积分",
    cause: "即梦账号积分不足，无法生成视频/图片。",
    solution: "1. 前往即梦官网 jimeng.jianying.com 领取每日免费积分\n2. 或购买即梦积分包\n3. Seedance 2.0 Pro: 720P 约 5积分/秒，1080P 约 8积分/秒\n4. 视频 3.0: 仅 2积分/秒，性价比最高",
    module: "即梦",
    severity: "error",
    tags: ["即梦", "jimeng", "5000", "积分", "不足", "余额"],
  },
];

// ── 即梦任务状态码 ──────────────────────────────────────
const JIMENG_STATUS_ERRORS: ErrorEntry[] = [
  {
    code: "status=20",
    title: "即梦任务处理中",
    message: "任务正在生成中…",
    cause: "这不是错误。status=20 表示即梦后台正在处理你的任务。",
    solution: "耐心等待。视频生成通常需要 1-5 分钟。系统会自动轮询状态。",
    module: "即梦",
    severity: "info",
    tags: ["即梦", "处理中", "等待", "status 20"],
  },
  {
    code: "status=30",
    title: "即梦任务成功",
    message: "生成完成",
    cause: "任务已成功完成。",
    solution: "无需处理，视频/图片已生成完毕。",
    module: "即梦",
    severity: "info",
    tags: ["即梦", "成功", "完成", "status 30"],
  },
  {
    code: "status=42",
    title: "即梦内容审核不通过 (status=42)",
    message: "生成失败：内容审核不通过",
    cause: "提交的提示词或参考图片触发了即梦的内容安全审核。",
    solution: "1. 修改提示词，移除可能的敏感描述\n2. 更换参考图片\n3. 避免使用涉及暴力、色情等敏感内容的描述",
    module: "即梦",
    severity: "error",
    tags: ["即梦", "审核", "安全", "42", "fail_code 2038"],
  },
  {
    code: "status=50",
    title: "即梦任务失败 (status=50)",
    message: "生成失败 / fail_code 错误",
    cause: "即梦后台处理任务时发生错误。fail_code=2038 表示内容审核，fail_code=4011 表示系统排队超时。",
    solution: "1. fail_code=2038：修改提示词或参考图\n2. fail_code=4011：系统繁忙，稍后重试\n3. 其他 fail_code：重试 1-2 次，仍失败则换模型",
    module: "即梦",
    severity: "error",
    tags: ["即梦", "失败", "50", "fail_code", "2038", "4011"],
  },
];

// ── 网络与连接错误 ──────────────────────────────────────
const NETWORK_ERRORS: ErrorEntry[] = [
  {
    code: "ECONNREFUSED",
    title: "连接被拒绝",
    message: "网络连接失败 / Connection refused",
    cause: "无法连接到目标服务器。可能是 URL 配置错误或服务器未运行。",
    solution: "1. 检查 Base URL 是否正确（不要多加或少加路径）\n2. 如果是本地服务，确认本地服务已启动\n3. 检查防火墙设置",
    module: "网络",
    severity: "error",
    tags: ["connection refused", "连接拒绝", "ECONNREFUSED"],
  },
  {
    code: "ENOTFOUND",
    title: "域名无法解析",
    message: "网络连接失败 / DNS 解析失败",
    cause: "无法解析目标域名，通常是 URL 拼写错误或 DNS 问题。",
    solution: "1. 检查 Base URL 中的域名是否拼写正确\n2. 确认网络连接正常\n3. 尝试使用 8.8.8.8 等公共 DNS",
    module: "网络",
    severity: "error",
    tags: ["DNS", "域名", "解析", "ENOTFOUND"],
  },
  {
    code: "ETIMEDOUT",
    title: "连接超时",
    message: "网络连接失败 / 连接超时",
    cause: "连接到目标服务器超时。常见于 Google API 在中国大陆被墙。",
    solution: "1. 如果连接 Google API：设置 HTTPS_PROXY 或使用转售商 API\n2. 使用 VPN\n3. 切换到国内 API（通义千问、七牛云等）",
    module: "网络",
    severity: "error",
    tags: ["timeout", "超时", "连接超时", "ETIMEDOUT", "Google", "被墙"],
  },
  {
    code: "GOOGLE_API_BLOCKED",
    title: "Google API 无法连接",
    message: "无法连接 Google API 服务器 (generativelanguage.googleapis.com)",
    cause: "Google API（generativelanguage.googleapis.com）在中国大陆被墙。",
    solution: "1. 设置 HTTPS_PROXY 环境变量指向你的代理\n2. 使用 VPN（Clash 等需开启系统代理）\n3. 切换到转售商 API（USSN、GeeKnow 等提供国内中转地址）\n4. 使用国内 API（七牛云、通义千问等）",
    module: "网络",
    severity: "error",
    tags: ["Google", "被墙", "googleapis", "代理", "VPN", "proxy"],
  },
  {
    code: "CERT_ERROR",
    title: "SSL 证书错误",
    message: "SSL / TLS 证书验证失败",
    cause: "目标服务器的 SSL 证书无效，或代理/VPN 中间人证书问题。",
    solution: "1. 如果使用 VPN/代理：检查是否需要信任代理证书\n2. 检查系统时间是否正确\n3. 某些企业网络可能拦截 HTTPS",
    module: "网络",
    severity: "error",
    tags: ["SSL", "TLS", "证书", "CERT", "certificate"],
  },
];

// ── LLM 文本模型错误 ──────────────────────────────────
const LLM_ERRORS: ErrorEntry[] = [
  {
    code: "LLM_NO_CONFIG",
    title: "未配置 LLM API",
    message: "缺少必要参数: apiKey, model, prompt / 未配置 LLM API Key",
    cause: "分镜流水线需要 LLM 模型配置（API Key + Model + Base URL）才能进行剧本分析和节拍拆解。",
    solution: "1. 进入「设置」页面\n2. 在「LLM 配置」区域点击预设快速填入\n3. 填写你的 API Key\n4. 保存后回到流水线重试",
    module: "LLM",
    severity: "error",
    tags: ["LLM", "配置", "API Key", "未配置", "缺少"],
  },
  {
    code: "LLM_502_CDN",
    title: "LLM API 网关错误",
    message: "LLM API 网关错误 (502)，API代理服务的CDN暂时不可用",
    cause: "转售商（USSN、GeeKnow 等）的 CDN 暂时故障。系统会自动重试 3 次。",
    solution: "1. 通常会自动恢复，等待后重试\n2. 在「设置」页切换到国内直连 API 预设（如「通义千问」）\n3. 如果持续出现，联系转售商确认服务状态",
    module: "LLM",
    severity: "error",
    tags: ["LLM", "502", "CDN", "网关", "代理"],
  },
  {
    code: "LLM_VOLCENGINE_401",
    title: "火山引擎 API 认证失败",
    message: "火山引擎 API 认证失败 (401)",
    cause: "火山引擎的 API Key 配置有误。最常见的错误是使用了 IAM 密钥而非方舟平台密钥。",
    solution: "1. API Key 必须来自「火山方舟控制台 → API Key 管理」（不是 IAM 密钥）\n   → https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey\n2. Model 填接入点 ID（如 ep-2024xxxx）或直接填模型名\n3. 确认 Key 未过期",
    module: "LLM",
    severity: "error",
    tags: ["火山引擎", "volcengine", "401", "认证", "方舟", "ark", "IAM"],
  },
  {
    code: "LLM_STREAM_FAIL",
    title: "LLM 流式输出中断",
    message: "Streaming 失败 / 重试3次后仍然失败",
    cause: "LLM API 流式输出过程中断。可能是网络不稳定或 API 服务波动。",
    solution: "1. 检查网络稳定性\n2. 系统已自动重试 3 次，可手动再次触发\n3. 如果持续失败，切换到其他 LLM 预设",
    module: "LLM",
    severity: "error",
    tags: ["LLM", "streaming", "流式", "中断", "重试"],
  },
  {
    code: "LLM_EMPTY_RESPONSE",
    title: "LLM 返回空内容",
    message: "模型返回空内容",
    cause: "LLM 模型返回了空的响应。可能是安全过滤、模型过载或参数问题。",
    solution: "1. 检查提示词是否过短或包含敏感内容\n2. 重试一次\n3. 切换到其他模型试试",
    module: "LLM",
    severity: "warning",
    tags: ["LLM", "空", "empty", "响应"],
  },
];

// ── 图像生成错误 ──────────────────────────────────────
const IMAGE_ERRORS: ErrorEntry[] = [
  {
    code: "IMG_NO_CONFIG",
    title: "未配置图像 API",
    message: "未配置图像 API Key / 请在设置页面配置图像生成 API",
    cause: "生图工作台需要配置图像生成的 API Key 和模型才能使用。",
    solution: "1. 进入「设置」页面\n2. 在「图像生成」区域选择预设\n3. 填写 API Key 并保存\n4. 推荐使用 Gemini 2.5 Flash Image（九宫格效果最佳）",
    module: "图像生成",
    severity: "error",
    tags: ["图像", "配置", "API Key", "未配置"],
  },
  {
    code: "IMG_401",
    title: "图像 API Key 无效",
    message: "API Key 无效或已过期",
    cause: "图像生成 API 的 Key 不正确或已失效。",
    solution: "1. 进入「设置」→「图像生成」检查 API Key\n2. 确认 Key 对应的服务商正确\n3. Gemini 格式用 Google API Key，OpenAI 格式用对应服务商 Key",
    module: "图像生成",
    severity: "error",
    tags: ["图像", "401", "Key", "无效", "过期"],
  },
  {
    code: "IMG_429",
    title: "图像 API 频率限制",
    message: "图像 API 频率限制 (429)，请稍后重试",
    cause: "图像生成请求过于频繁，超出速率限制。Gemini 免费版每分钟限制约 10-15 次。",
    solution: "1. 等待 30-60 秒后重试\n2. 减少并发生成数量\n3. 升级 API 付费计划\n4. 分批生成（先生成几张，等完成后再生成下一批）",
    module: "图像生成",
    severity: "warning",
    tags: ["图像", "429", "频率", "限制", "rate limit"],
  },
  {
    code: "IMG_GATEWAY",
    title: "图像 API 网关错误",
    message: "图像 API 网关错误 / API代理服务的CDN暂时不可用",
    cause: "转售商 CDN 暂时不可用，或 Google API 被墙。如果返回的是 HTML 错误页面（非 JSON），通常是 CDN 问题。",
    solution: "1. 等待 1-2 分钟后重试\n2. 如果没有 VPN，联系管理员获取可用的国内图像 API 配置\n3. 切换到七牛云等国内 API",
    module: "图像生成",
    severity: "error",
    tags: ["图像", "网关", "CDN", "502", "503"],
  },
  {
    code: "IMG_NO_IMAGE",
    title: "图像生成无图片返回",
    message: "API 返回空内容 / 生成结果不包含图片",
    cause: "API 响应了但没有返回图片数据。可能是内容安全过滤或模型生成失败。",
    solution: "1. 检查提示词是否触发了内容审核\n2. 修改提示词后重试\n3. 换用不同的图像模型",
    module: "图像生成",
    severity: "warning",
    tags: ["图像", "空", "无图片", "没有图片"],
  },
  {
    code: "IMG_FORMAT_MISMATCH",
    title: "图像 API 格式不匹配",
    message: "API 返回格式无法解析 / 响应不是有效的 JSON",
    cause: "图像 API 的响应格式与配置的协议格式不匹配（如配了 Gemini 格式但 API 返回 OpenAI 格式）。",
    solution: "1. 在「设置」→「图像生成」检查 API 格式是否正确\n2. Google 直连用「Gemini」格式\n3. 七牛云的 Kling 用「OpenAI 图像生成」格式\n4. GeeKnow Grok 用「OpenAI」格式",
    module: "图像生成",
    severity: "error",
    tags: ["图像", "格式", "协议", "gemini", "openai", "openai-images"],
  },
];

// ── 视频生成错误 ──────────────────────────────────────
const VIDEO_ERRORS: ErrorEntry[] = [
  {
    code: "VID_NO_MODEL",
    title: "未配置视频模型",
    message: "未配置模型 / 请在设置页面添加视频模型",
    cause: "图生视频功能需要先在「设置」中添加至少一个视频模型。",
    solution: "1. 进入「设置」→「视频生成」\n2. 点击预设列表快速添加（推荐 VEO 3.1 Fast 4K）\n3. 填写 API Key 并保存\n4. 回到图生视频页面",
    module: "视频生成",
    severity: "error",
    tags: ["视频", "模型", "未配置", "添加"],
  },
  {
    code: "VID_401",
    title: "视频 API Key 认证失败",
    message: "API Key 认证失败",
    cause: "视频模型的 API Key 不正确或已过期。",
    solution: "1. 进入「设置」→「视频生成」点击对应模型编辑 API Key\n2. 重新复制 Key（避免首尾空格）\n3. 确认 Key 对应正确的服务商",
    module: "视频生成",
    severity: "error",
    tags: ["视频", "401", "Key", "认证"],
  },
  {
    code: "VID_NETWORK",
    title: "视频 API 网络连接失败",
    message: "网络连接失败",
    cause: "无法连接到视频 API 服务器。",
    solution: "1. 检查网络连接\n2. 检查「设置」中的 Video API URL 是否正确\n3. 部分服务可能需要代理/VPN",
    module: "视频生成",
    severity: "error",
    tags: ["视频", "网络", "连接", "失败"],
  },
  {
    code: "VID_CONTENT_FILTER",
    title: "视频内容审核未通过",
    message: "视频生成被拒绝 / 内容安全",
    cause: "提示词或参考图片触发了视频平台的内容安全审核。",
    solution: "1. 修改视频提示词，移除敏感描述\n2. 更换参考图片\n3. 尝试不同的视频模型（各模型审核标准不同）",
    module: "视频生成",
    severity: "error",
    tags: ["视频", "审核", "安全", "内容", "422"],
  },
  {
    code: "VID_TIMEOUT",
    title: "视频生成超时",
    message: "视频生成超时 / 轮询超时",
    cause: "视频生成任务耗时过长。某些高质量模型单个视频可能需要 5-10 分钟。",
    solution: "1. 视频生成本身较慢，这可能是正常的\n2. 可以减少视频时长重试\n3. 使用 Fast 版本模型加速\n4. 检查网络是否稳定",
    module: "视频生成",
    severity: "warning",
    tags: ["视频", "超时", "timeout", "等待", "408"],
  },
  {
    code: "VID_MODE_UNSUPPORTED",
    title: "视频模型不支持当前模式",
    message: "该模型不支持首尾帧/多参考/批量接力模式",
    cause: "不同视频模型支持不同的生成模式。如 Veo 3 仅支持单图模式，Grok Video 3 不支持首尾帧模式。",
    solution: "1. 查看「模型学习指南」了解各模型支持的模式\n2. 切换到支持所需模式的模型\n3. 首尾帧：选 VEO 3.1 Fast 4K 或视频 3.5 Pro\n4. 多参考：选 Grok Video 3 或 Seedance 2.0\n5. 批量接力：选 VEO 3.1 Fast 4K",
    module: "视频生成",
    severity: "error",
    tags: ["视频", "模式", "首尾帧", "多参考", "批量接力", "不支持"],
  },
];

// ── Seedance / 即梦浏览器代理错误 ──────────────────────
const SEEDANCE_ERRORS: ErrorEntry[] = [
  {
    code: "SDCE_NO_LOGIN",
    title: "未登录即梦账号",
    message: "请先上传参考图片 / 请先登录即梦",
    cause: "Seedance 功能需要先登录即梦账号，系统通过浏览器代理获取登录凭证。",
    solution: "1. 在 Seedance 页面点击「登录即梦」按钮\n2. 在弹出的浏览器窗口中登录你的即梦账号\n3. 登录成功后关闭浏览器窗口，系统会自动获取凭证",
    module: "Seedance",
    severity: "error",
    tags: ["Seedance", "登录", "即梦", "未登录"],
  },
  {
    code: "SDCE_PLAYWRIGHT_MISSING",
    title: "Playwright 浏览器未安装",
    message: "找不到 Chromium 浏览器 / Playwright 未安装",
    cause: "Seedance 需要 Playwright 浏览器引擎（Chromium）来代理即梦 API 调用。首次使用需要安装。",
    solution: "1. 系统会尝试自动下载 Playwright 浏览器\n2. 如果自动下载失败，在终端运行：npx playwright install chromium\n3. Windows EXE 版：自带浏览器，不需要额外安装\n4. Mac 版：运行项目目录下的 install.command 安装",
    module: "Seedance",
    severity: "error",
    tags: ["Playwright", "Chromium", "浏览器", "安装", "未安装"],
  },
  {
    code: "SDCE_BROWSER_CRASH",
    title: "浏览器代理异常",
    message: "浏览器代理连接失败 / Browser disconnected",
    cause: "内置浏览器崩溃或异常关闭。",
    solution: "1. 重试操作（系统会自动重新启动浏览器）\n2. 如果反复失败，重启应用\n3. 检查系统可用内存是否充足（至少 2GB 空闲）",
    module: "Seedance",
    severity: "error",
    tags: ["Seedance", "浏览器", "崩溃", "disconnected", "代理"],
  },
  {
    code: "SDCE_UPLOAD_FAIL",
    title: "即梦文件上传失败",
    message: "获取上传令牌失败 / 申请上传权限失败 / 图片上传失败",
    cause: "上传参考文件到即梦服务器时失败。可能是网络问题或即梦服务端异常。",
    solution: "1. 检查网络连接\n2. 确认参考图/视频文件大小不超过限制（图片30MB, 视频50MB, 音频15MB）\n3. 重试 1-2 次\n4. 如果持续失败，重新登录即梦账号",
    module: "Seedance",
    severity: "error",
    tags: ["Seedance", "上传", "失败", "令牌", "权限"],
  },
  {
    code: "SDCE_FILE_LIMIT",
    title: "即梦文件数量/大小超限",
    message: "最多上传 9 个参考文件 / 文件超过大小限制",
    cause: "即梦 API 限制单次请求最多上传 9 个参考文件。图片最大 30MB，视频最大 50MB，音频最大 15MB。",
    solution: "1. 减少上传文件数量（最多 9 个）\n2. 压缩图片/视频文件大小\n3. 图片建议不超过 5MB，视频不超过 30MB",
    module: "Seedance",
    severity: "warning",
    tags: ["Seedance", "文件", "限制", "超限", "9个", "30MB", "50MB"],
  },
  {
    code: "SDCE_POLL_TIMEOUT",
    title: "Seedance 轮询超时",
    message: "连续网络错误，停止轮询",
    cause: "轮询视频生成状态时连续 60 次请求失败（约 3 分钟）。通常是网络中断。",
    solution: "1. 检查网络连接\n2. 刷新页面后检查任务是否实际已完成\n3. 如果网络恢复，重新提交任务",
    module: "Seedance",
    severity: "error",
    tags: ["Seedance", "轮询", "超时", "网络错误"],
  },
];

// ── 流水线错误 ──────────────────────────────────────
const PIPELINE_ERRORS: ErrorEntry[] = [
  {
    code: "PIPE_NO_SCRIPT",
    title: "未导入剧本",
    message: "请先导入剧本 / 剧本内容为空",
    cause: "分镜流水线需要先在「剧本管理」导入剧本文本才能进行分析。",
    solution: "1. 进入「剧本管理」页面\n2. 粘贴或导入你的剧本文本\n3. 回到流水线选择章节开始",
    module: "流水线",
    severity: "error",
    tags: ["流水线", "剧本", "导入", "为空"],
  },
  {
    code: "PIPE_JSON_PARSE",
    title: "AI 输出格式解析失败",
    message: "JSON 解析失败 / 无法解析 AI 输出",
    cause: "LLM 返回的内容不是有效的 JSON 格式。可能是模型能力不足或提示词被截断。",
    solution: "1. 使用推荐的模型（Gemini 2.5 Pro 效果最佳）\n2. 检查是否因为 token 限制导致输出被截断\n3. 较弱的模型可能无法稳定输出 JSON 格式\n4. 系统会保存原始文本，可在日志中查看",
    module: "流水线",
    severity: "warning",
    tags: ["流水线", "JSON", "解析", "格式", "截断"],
  },
  {
    code: "PIPE_EXTRACT_FAIL",
    title: "一致性提取失败",
    message: "提取失败 / 角色/场景/道具提取失败",
    cause: "AI 一致性实体提取（角色、场景、道具）失败。可能是模型响应异常或网络中断。",
    solution: "1. 可手动点击「AI 一键提取」重试\n2. 提取失败不影响后续流程，可以跳过\n3. 也可以手动添加角色/场景信息",
    module: "流水线",
    severity: "warning",
    tags: ["流水线", "提取", "一致性", "角色", "场景", "道具"],
  },
  {
    code: "PIPE_LLM_FAIL",
    title: "流水线 LLM 调用失败",
    message: "LLM 调用失败（已重试）",
    cause: "分镜流水线中调用 LLM 分析剧本时失败。系统已自动进行多模态→纯文本降级重试。",
    solution: "1. 检查 LLM API 配置是否正确\n2. 查看「设置」页面的 API Key 和模型\n3. 重试或切换到其他 LLM 模型",
    module: "流水线",
    severity: "error",
    tags: ["流水线", "LLM", "调用", "失败", "降级"],
  },
];

// ── 风格分析错误 ──────────────────────────────────────
const STYLE_ERRORS: ErrorEntry[] = [
  {
    code: "STYLE_NO_KEY",
    title: "风格分析未配置 API",
    message: "未配置 LLM API Key / 请提供图片URL",
    cause: "风格分析功能需要 LLM API（文本模型带视觉能力）来分析图片风格。",
    solution: "1. 配置 LLM API（推荐 Gemini 2.5 Pro 或 Qwen-VL-Plus）\n2. 确保选择的模型支持图像识别",
    module: "风格分析",
    severity: "error",
    tags: ["风格", "分析", "API", "未配置"],
  },
  {
    code: "STYLE_PARSE_FAIL",
    title: "风格分析结果解析失败",
    message: "无法解析风格分析JSON / 风格分析结果被截断",
    cause: "LLM 模型返回的风格分析结果不是有效的 JSON 格式或被截断。",
    solution: "1. 重试分析\n2. 使用能力更强的模型（如 Gemini 2.5 Pro）\n3. 图片过大可能导致处理失败，尝试压缩图片",
    module: "风格分析",
    severity: "warning",
    tags: ["风格", "分析", "JSON", "解析", "截断"],
  },
];

// ── 授权/激活码错误 ──────────────────────────────────
const AUTH_ERRORS: ErrorEntry[] = [
  {
    code: "AUTH_MACHINE_CODE",
    title: "机器码变化",
    message: "机器码与激活码不匹配",
    cause: "VPN、虚拟网卡等网络设备的安装/卸载可能导致物理网卡地址变化，影响机器码。",
    solution: "1. 系统已优化为自动过滤 VPN 等虚拟网卡\n2. 已有激活码不受影响（支持多候选码兼容验证）\n3. 如仍然无法验证，联系管理员重新生成激活码",
    module: "授权",
    severity: "error",
    tags: ["机器码", "激活码", "VPN", "授权", "变化"],
  },
  {
    code: "AUTH_EXPIRED",
    title: "激活码已过期",
    message: "授权已过期",
    cause: "激活码有有效期，超过有效期后需要续期。",
    solution: "1. 联系管理员获取新的激活码\n2. 激活码格式：XXXX-XXXX-XXXX-XXXX-XXXX-YYYYMMDD（末段为到期日期）",
    module: "授权",
    severity: "error",
    tags: ["激活码", "过期", "授权", "续期"],
  },
];

// ── 其他常见错误 ──────────────────────────────────────
const OTHER_ERRORS: ErrorEntry[] = [
  {
    code: "GEMINI_VL_UNSUPPORTED",
    title: "当前模型不支持图像识别",
    message: "当前文本模型不支持图像识别",
    cause: "AI 提示词生成或风格分析等需要视觉理解能力的功能，但当前配置的 LLM 模型不支持图像输入。",
    solution: "1. 切换到支持视觉的模型（Gemini 系列、Qwen-VL 等）\n2. 在「设置」→「LLM 配置」中更换模型",
    module: "其他",
    severity: "error",
    tags: ["视觉", "图像识别", "多模态", "VL", "不支持"],
  },
  {
    code: "TASK_NOT_FOUND",
    title: "任务不存在",
    message: "任务不存在 / Task not found",
    cause: "查询的生成任务 ID 不存在。可能是任务已过期被清理（30分钟自动清理）或页面刷新后丢失。",
    solution: "1. 重新提交生成任务\n2. 生成中途不要刷新页面\n3. 任务超过 30 分钟会被自动清理",
    module: "其他",
    severity: "warning",
    tags: ["任务", "不存在", "404", "过期", "清理"],
  },
  {
    code: "VIDEO_PROXY_DOMAIN",
    title: "视频来源不被允许",
    message: "不允许的视频来源域名",
    cause: "视频代理只允许特定域名的视频源。",
    solution: "这是安全限制，通常不应出现在正常操作中。如果持续遇到，请联系管理员。",
    module: "其他",
    severity: "warning",
    tags: ["视频代理", "域名", "403", "安全"],
  },
];

// ── 汇总所有错误 ──
const ALL_ERRORS: ErrorEntry[] = [
  ...HTTP_ERRORS,
  ...JIMENG_RET_ERRORS,
  ...JIMENG_STATUS_ERRORS,
  ...NETWORK_ERRORS,
  ...LLM_ERRORS,
  ...IMAGE_ERRORS,
  ...VIDEO_ERRORS,
  ...SEEDANCE_ERRORS,
  ...PIPELINE_ERRORS,
  ...STYLE_ERRORS,
  ...AUTH_ERRORS,
  ...OTHER_ERRORS,
];

// ═══════════════════════════════════════════════════════════
// 模块分组定义
// ═══════════════════════════════════════════════════════════

interface ModuleGroup {
  key: string;
  label: string;
  icon: React.ReactNode;
  errors: ErrorEntry[];
}

const MODULE_GROUPS: ModuleGroup[] = [
  { key: "all", label: "全部", icon: <AlertCircle size={16} />, errors: ALL_ERRORS },
  { key: "http", label: "HTTP 状态码", icon: <Server size={16} />, errors: HTTP_ERRORS },
  { key: "jimeng-ret", label: "即梦 API 码", icon: <Clapperboard size={16} />, errors: [...JIMENG_RET_ERRORS, ...JIMENG_STATUS_ERRORS] },
  { key: "network", label: "网络/连接", icon: <Wifi size={16} />, errors: NETWORK_ERRORS },
  { key: "llm", label: "LLM 文本", icon: <MessageSquareText size={16} />, errors: LLM_ERRORS },
  { key: "image", label: "图像生成", icon: <Image size={16} />, errors: IMAGE_ERRORS },
  { key: "video", label: "视频生成", icon: <Film size={16} />, errors: VIDEO_ERRORS },
  { key: "seedance", label: "Seedance", icon: <Clapperboard size={16} />, errors: SEEDANCE_ERRORS },
  { key: "pipeline", label: "流水线", icon: <GitBranch size={16} />, errors: PIPELINE_ERRORS },
  { key: "other", label: "其他", icon: <KeyRound size={16} />, errors: [...STYLE_ERRORS, ...AUTH_ERRORS, ...OTHER_ERRORS] },
];

// ═══════════════════════════════════════════════════════════
// 渲染辅助
// ═══════════════════════════════════════════════════════════

function SeverityBadge({ severity }: { severity: "error" | "warning" | "info" }) {
  const map = {
    error: { label: "错误", cls: "bg-red-500/20 text-red-400 border-red-500/30" },
    warning: { label: "警告", cls: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
    info: { label: "提示", cls: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  };
  const { label, cls } = map[severity];
  return <span className={`inline-block px-2 py-0.5 text-[10px] font-bold border rounded ${cls}`}>{label}</span>;
}

function ErrorCard({ entry, searchQuery }: { entry: ErrorEntry; searchQuery: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = `[${entry.code}] ${entry.title}\n\n原因：${entry.cause}\n\n解决方案：\n${entry.solution}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 高亮匹配词
  const highlight = (text: string) => {
    if (!searchQuery.trim()) return text;
    const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = text.split(new RegExp(`(${escaped})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === searchQuery.toLowerCase()
        ? <mark key={i} className="bg-[var(--gold-primary)]/30 text-[var(--text-primary)] rounded px-0.5">{part}</mark>
        : part
    );
  };

  return (
    <div className={`flex flex-col border rounded-lg overflow-hidden transition-colors ${
      expanded ? "border-[var(--gold-primary)]/30 bg-[var(--bg-surface)]" : "border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--border-default)]"
    }`}>
      {/* 头部 - 总是展示 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-start gap-3 p-4 text-left cursor-pointer w-full hover:bg-[#ffffff04] transition"
      >
        <div className="mt-0.5 text-[var(--text-muted)]">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="px-2 py-0.5 text-[12px] font-mono bg-[#ffffff08] border border-[var(--border-subtle)] rounded text-[var(--gold-primary)]">
              {highlight(entry.code)}
            </code>
            <SeverityBadge severity={entry.severity} />
            <span className="text-[11px] text-[var(--text-muted)]">{entry.module}</span>
          </div>
          <span className="text-[14px] font-medium text-[var(--text-primary)]">{highlight(entry.title)}</span>
          <span className="text-[12px] text-[var(--text-muted)] truncate">{highlight(entry.message)}</span>
        </div>
      </button>

      {/* 展开详情 */}
      {expanded && (
        <div className="flex flex-col gap-3 px-4 pb-4 pt-0 ml-[28px] border-t border-[var(--border-subtle)]">
          <div className="pt-3" />

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-[var(--gold-primary)] uppercase tracking-wide">📌 原因</span>
            <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{entry.cause}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-semibold text-green-400 uppercase tracking-wide">✅ 解决方案</span>
            <div className="text-[13px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap p-3 bg-[#ffffff04] border border-[var(--border-subtle)] rounded">
              {entry.solution}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--gold-primary)] border border-[var(--border-subtle)] rounded hover:border-[var(--gold-primary)]/30 transition cursor-pointer"
            >
              {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
              {copied ? "已复制" : "复制解决方案"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 主页面
// ═══════════════════════════════════════════════════════════

export default function ErrorLookupPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeModule, setActiveModule] = useState("all");

  // 搜索过滤
  const filteredErrors = useMemo(() => {
    const group = MODULE_GROUPS.find((g) => g.key === activeModule) || MODULE_GROUPS[0];
    const source = group.errors;

    if (!searchQuery.trim()) return source;

    const q = searchQuery.toLowerCase().trim();
    return source.filter((entry) => {
      return (
        entry.code.toLowerCase().includes(q) ||
        entry.title.toLowerCase().includes(q) ||
        entry.message.toLowerCase().includes(q) ||
        entry.cause.toLowerCase().includes(q) ||
        entry.solution.toLowerCase().includes(q) ||
        entry.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [searchQuery, activeModule]);

  const activeGroup = MODULE_GROUPS.find((g) => g.key === activeModule) || MODULE_GROUPS[0];

  return (
    <div className="flex h-full w-full bg-[var(--bg-page)]">
      <Sidebar />

      <main className="flex-1 flex flex-col overflow-auto">
        {/* 页头 */}
        <header className="sticky top-0 z-20 flex flex-col gap-4 px-8 py-5 bg-[var(--bg-page)]/95 backdrop-blur-sm border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3">
            <ShieldAlert size={24} className="text-[var(--gold-primary)]" />
            <div className="flex flex-col">
              <h1 className="text-[20px] font-bold text-[var(--text-primary)]">代码报错查询</h1>
              <p className="text-[13px] text-[var(--text-muted)]">
                搜索错误码或关键词，快速定位原因和解决方案 · 共收录 {ALL_ERRORS.length} 个错误码
              </p>
            </div>
          </div>

          {/* 搜索框 */}
          <div className="relative max-w-[600px]">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="输入错误码、报错信息或关键词（如 401、积分不足、Playwright、网关 …）"
              className="w-full pl-10 pr-4 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--gold-primary)] transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
              >
                ×
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-[900px] mx-auto px-8 py-6 flex flex-col gap-5">

            {/* 模块筛选 */}
            <div className="flex flex-wrap gap-2">
              {MODULE_GROUPS.map((group) => (
                <button
                  key={group.key}
                  onClick={() => setActiveModule(group.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-full border transition cursor-pointer ${
                    activeModule === group.key
                      ? "bg-[var(--gold-transparent)] border-[var(--gold-primary)]/30 text-[var(--gold-primary)]"
                      : "bg-transparent border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--border-default)]"
                  }`}
                >
                  {group.icon}
                  {group.label}
                  <span className="text-[10px] opacity-60">
                    ({group.key === "all" ? ALL_ERRORS.length : group.errors.length})
                  </span>
                </button>
              ))}
            </div>

            {/* 搜索结果统计 */}
            {searchQuery && (
              <div className="text-[13px] text-[var(--text-muted)]">
                在「{activeGroup.label}」中找到 <span className="text-[var(--gold-primary)] font-medium">{filteredErrors.length}</span> 个匹配结果
              </div>
            )}

            {/* 错误列表 */}
            <div className="flex flex-col gap-2">
              {filteredErrors.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <Search size={40} className="text-[var(--text-muted)] opacity-30" />
                  <span className="text-[14px] text-[var(--text-muted)]">
                    没有找到匹配的错误码
                  </span>
                  <span className="text-[12px] text-[var(--text-muted)] opacity-60">
                    尝试输入不同的关键词，或切换到「全部」分类
                  </span>
                </div>
              ) : (
                filteredErrors.map((entry) => (
                  <ErrorCard key={`${entry.code}-${entry.module}`} entry={entry} searchQuery={searchQuery} />
                ))
              )}
            </div>

            {/* 底部提示 */}
            <div className="flex items-start gap-3 p-4 bg-[var(--gold-transparent)] border border-[var(--gold-primary)]/15 rounded-lg mt-4">
              <AlertCircle size={16} className="text-[var(--gold-primary)] shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1 text-[12px] text-[var(--gold-secondary)]">
                <span className="font-semibold">找不到你的报错？</span>
                <span>
                  如果以上信息未能解决你的问题，请将完整的报错截图和操作步骤发送给客服，我们会尽快协助处理。
                  在报错信息中通常包含状态码（如 401、502）和错误描述，可以用这些关键词搜索。
                </span>
              </div>
            </div>

            <div className="h-8" />
          </div>
        </div>
      </main>
    </div>
  );
}
