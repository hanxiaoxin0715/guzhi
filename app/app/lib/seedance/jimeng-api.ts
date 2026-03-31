/**
 * 即梦 API 核心逻辑
 * 包含：工具函数、图片上传、视频生成、结果轮询
 * 从 seedance2.0 开源项目的 server/index.js 移植为 TypeScript
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import browserService from "./browser-service";
import {
  JIMENG_BASE_URL,
  DEFAULT_ASSISTANT_ID,
  VERSION_CODE,
  PLATFORM_CODE,
  SEEDANCE_DRAFT_VERSION,
  VIDEOGEN_DRAFT_VERSION,
  isFirstLastFrameSupported,
  MODEL_MAP,
  BENEFIT_TYPE_MAP,
  VIDEO_RESOLUTION,
  FAKE_HEADERS,
  isVideoGenModel,
  type ModelId,
  type AspectRatio,
  type VideoQuality,
  type SeedanceTask,
  type UploadedImage,
  type UploadedAudio,
  type MetaItem,
} from "./types";

// ═══════════════════════════════════════════════════════════
// 文件日志（写入 outputs/seedance-log.txt）
// ═══════════════════════════════════════════════════════════
const LOG_FILE = path.join(process.cwd(), "outputs", "seedance-log.txt");
function fileLog(taskId: string, msg: string) {
  const ts = new Date().toLocaleString("zh-CN", { hour12: false });
  const line = `[${ts}] [${taskId}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch { /* ignore */ }
  console.log(`[${taskId}] ${msg}`);
}

// ═══════════════════════════════════════════════════════════
// 全局状态
// ═══════════════════════════════════════════════════════════

// 设备指纹由用户从浏览器 Cookie 中提供真实值
// 禁止随机生成，否则即梦风控系统会检测到设备不一致导致封号

/** 异步任务存储 */
const tasks = new Map<string, SeedanceTask>();
let taskCounter = 0;

/** 创建唯一任务ID */
export function createTaskId(): string {
  return `task_${++taskCounter}_${Date.now()}`;
}

/** 获取任务 */
export function getTask(taskId: string): SeedanceTask | undefined {
  return tasks.get(taskId);
}

/** 设置任务 */
export function setTask(taskId: string, task: SeedanceTask): void {
  tasks.set(taskId, task);
}

/** 删除任务 */
export function deleteTask(taskId: string): void {
  tasks.delete(taskId);
}

// 定期清理过期任务（30分钟）
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [id, task] of tasks) {
      if (now - task.startTime > 30 * 60 * 1000) {
        tasks.delete(id);
      }
    }
  }, 60000);
}

// ═══════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════

function generateUUID(): string {
  return crypto.randomUUID();
}

function unixTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

function md5(value: string): string {
  return crypto.createHash("md5").update(value).digest("hex");
}

function generateCookie(sessionId: string, webId: string, userId: string): string {
  return [
    `_tea_web_id=${webId}`,
    `is_staff_user=false`,
    `store-region=cn-gd`,
    `store-region-src=uid`,
    `uid_tt=${userId}`,
    `uid_tt_ss=${userId}`,
    `sid_tt=${sessionId}`,
    `sessionid=${sessionId}`,
    `sessionid_ss=${sessionId}`,
  ].join("; ");
}

function generateSign(uri: string): { deviceTime: number; sign: string } {
  const deviceTime = unixTimestamp();
  const sign = md5(
    `9e2c|${uri.slice(-7)}|${PLATFORM_CODE}|${VERSION_CODE}|${deviceTime}||11ac`,
  );
  return { deviceTime, sign };
}

// ═══════════════════════════════════════════════════════════
// 即梦 API 请求函数
// ═══════════════════════════════════════════════════════════

interface JimengRequestOptions {
  params?: Record<string, string | number>;
  headers?: Record<string, string>;
  data?: Record<string, unknown>;
}

async function jimengRequest(
  method: string,
  uri: string,
  sessionId: string,
  webId: string,
  userId: string,
  options: JimengRequestOptions = {},
): Promise<Record<string, unknown>> {
  const { deviceTime, sign } = generateSign(uri);
  const fullUrl = new URL(`${JIMENG_BASE_URL}${uri}`);

  const defaultParams: Record<string, string | number> = {
    aid: DEFAULT_ASSISTANT_ID,
    device_platform: "web",
    region: "cn",
    webId: webId,
    da_version: "3.3.2",
    web_component_open_flag: 1,
    web_version: "7.5.0",
    aigc_features: "app_lip_sync",
    ...(options.params || {}),
  };

  for (const [key, value] of Object.entries(defaultParams)) {
    fullUrl.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    ...FAKE_HEADERS,
    Cookie: generateCookie(sessionId, webId, userId),
    "Device-Time": String(deviceTime),
    Sign: sign,
    "Sign-Ver": "1",
    ...(options.headers || {}),
  };

  const fetchOptions: RequestInit = { method: method.toUpperCase(), headers };

  if (options.data) {
    headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(options.data);
  }

  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        console.log(`  [jimeng] 重试 ${uri} (第${attempt}次)`);
      }

      const response = await fetch(fullUrl.toString(), {
        ...fetchOptions,
        signal: AbortSignal.timeout(45000),
      });
      const data = await response.json() as Record<string, unknown>;

      if (isFinite(Number(data.ret))) {
        if (String(data.ret) === "0") return data.data as Record<string, unknown>;

        const errMsg = (data.errmsg as string) || String(data.ret);
        const retCode = String(data.ret);
        if (retCode === "5000") throw new Error("即梦积分不足，请前往即梦官网领取积分");
        const err = new Error(`即梦API错误 (ret=${retCode}): ${errMsg}`);
        (err as Error & { isApiError: boolean }).isApiError = true;
        throw err;
      }

      return data;
    } catch (err: unknown) {
      const error = err as Error & { isApiError?: boolean };
      if (error.isApiError) throw error;
      if (attempt === 3) throw error;
      console.log(`  [jimeng] 请求 ${uri} 失败 (第${attempt + 1}次): ${error.message}`);
    }
  }

  throw new Error(`即梦API请求失败: ${uri}`);
}

// ═══════════════════════════════════════════════════════════
// AWS4-HMAC-SHA256 签名
// ═══════════════════════════════════════════════════════════

function createAWSSignature(
  method: string,
  url: string,
  headers: Record<string, string>,
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken: string,
  payload = "",
): string {
  const urlObj = new URL(url);
  const pathname = urlObj.pathname || "/";
  const timestamp = headers["x-amz-date"];
  const date = timestamp.substring(0, 8);
  const region = "cn-north-1";
  const service = "imagex";

  // 规范化查询参数
  const queryParams: [string, string][] = [];
  urlObj.searchParams.forEach((value, key) => {
    queryParams.push([key, value]);
  });
  queryParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQueryString = queryParams.map(([k, v]) => `${k}=${v}`).join("&");

  // 签名头部
  const headersToSign: Record<string, string> = { "x-amz-date": timestamp };
  if (sessionToken) headersToSign["x-amz-security-token"] = sessionToken;

  let payloadHash = crypto.createHash("sha256").update("").digest("hex");
  if (method.toUpperCase() === "POST" && payload) {
    payloadHash = crypto.createHash("sha256").update(payload, "utf8").digest("hex");
    headersToSign["x-amz-content-sha256"] = payloadHash;
  }

  const signedHeaders = Object.keys(headersToSign).map((k) => k.toLowerCase()).sort().join(";");
  const canonicalHeaders = Object.keys(headersToSign)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map((k) => `${k.toLowerCase()}:${headersToSign[k].trim()}\n`)
    .join("");

  const canonicalRequest = [
    method.toUpperCase(),
    pathname,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
  ].join("\n");

  const kDate = crypto.createHmac("sha256", `AWS4${secretAccessKey}`).update(date).digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(region).digest();
  const kService = crypto.createHmac("sha256", kRegion).update(service).digest();
  const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

// ═══════════════════════════════════════════════════════════
// CRC32 计算
// ═══════════════════════════════════════════════════════════

function calculateCRC32(buffer: ArrayBuffer): string {
  const crcTable: number[] = [];
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    crcTable[i] = crc;
  }

  let crc = 0 ^ -1;
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
  }
  return ((crc ^ -1) >>> 0).toString(16).padStart(8, "0");
}

// ═══════════════════════════════════════════════════════════
// 图片上传 (4步 ImageX 流程)
// ═══════════════════════════════════════════════════════════

async function uploadImageBuffer(buffer: Buffer, sessionId: string, webId: string, userId: string): Promise<string> {
  console.log(`  [upload] 开始上传图片, 大小: ${buffer.length} 字节`);

  // 第1步: 获取上传令牌
  const tokenResult = await jimengRequest("post", "/mweb/v1/get_upload_token", sessionId, webId, userId, {
    data: { scene: 2 },
  }) as Record<string, string>;

  const { access_key_id, secret_access_key, session_token, service_id } = tokenResult;
  if (!access_key_id || !secret_access_key || !session_token) {
    throw new Error("获取上传令牌失败");
  }
  const actualServiceId = service_id || "tb4s082cfz";
  console.log(`  [upload] 上传令牌获取成功: serviceId=${actualServiceId}`);

  const fileSize = buffer.length;
  const crc32 = calculateCRC32(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
  );

  // 第2步: 申请上传权限
  const timestamp = new Date().toISOString().replace(/[:-]/g, "").replace(/\.\d{3}Z$/, "Z");
  const randomStr = Math.random().toString(36).substring(2, 12);
  const applyUrl = `https://imagex.bytedanceapi.com/?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=${actualServiceId}&FileSize=${fileSize}&s=${randomStr}`;

  const reqHeaders: Record<string, string> = {
    "x-amz-date": timestamp,
    "x-amz-security-token": session_token,
  };
  const authorization = createAWSSignature(
    "GET", applyUrl, reqHeaders, access_key_id, secret_access_key, session_token,
  );

  const applyResponse = await fetch(applyUrl, {
    method: "GET",
    headers: {
      accept: "*/*",
      authorization,
      origin: "https://jimeng.jianying.com",
      referer: "https://jimeng.jianying.com/ai-tool/video/generate",
      "user-agent": FAKE_HEADERS["User-Agent"],
      "x-amz-date": timestamp,
      "x-amz-security-token": session_token,
    },
  });

  if (!applyResponse.ok) throw new Error(`申请上传权限失败: ${applyResponse.status}`);
  const applyResult = await applyResponse.json() as Record<string, unknown>;
  if ((applyResult?.ResponseMetadata as Record<string, unknown>)?.Error)
    throw new Error(`申请上传权限失败: ${JSON.stringify((applyResult.ResponseMetadata as Record<string, unknown>).Error)}`);

  const uploadAddress = (applyResult?.Result as Record<string, unknown>)?.UploadAddress as Record<string, unknown>;
  if (
    !(uploadAddress?.StoreInfos as unknown[])?.length ||
    !(uploadAddress?.UploadHosts as unknown[])?.length
  ) {
    throw new Error("获取上传地址失败");
  }

  const storeInfo = (uploadAddress.StoreInfos as Record<string, string>[])[0];
  const uploadHost = (uploadAddress.UploadHosts as string[])[0];
  const uploadUrl = `https://${uploadHost}/upload/v1/${storeInfo.StoreUri}`;

  console.log(`  [upload] 上传图片到: ${uploadHost}`);

  // 第3步: 上传图片文件
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Accept: "*/*",
      Authorization: storeInfo.Auth,
      "Content-CRC32": crc32,
      "Content-Disposition": 'attachment; filename="undefined"',
      "Content-Type": "application/octet-stream",
      Origin: "https://jimeng.jianying.com",
      Referer: "https://jimeng.jianying.com/ai-tool/video/generate",
      "User-Agent": FAKE_HEADERS["User-Agent"],
    },
    body: new Blob([new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength)]),
  });

  if (!uploadResponse.ok) throw new Error(`图片上传失败: ${uploadResponse.status}`);
  console.log(`  [upload] 图片文件上传成功`);

  // 第4步: 提交上传
  const commitUrl = `https://imagex.bytedanceapi.com/?Action=CommitImageUpload&Version=2018-08-01&ServiceId=${actualServiceId}`;
  const commitTimestamp = new Date().toISOString().replace(/[:-]/g, "").replace(/\.\d{3}Z$/, "Z");
  const commitPayload = JSON.stringify({
    SessionKey: (uploadAddress as Record<string, unknown>).SessionKey,
    SuccessActionStatus: "200",
  });
  const payloadHash = crypto.createHash("sha256").update(commitPayload, "utf8").digest("hex");

  const commitReqHeaders: Record<string, string> = {
    "x-amz-date": commitTimestamp,
    "x-amz-security-token": session_token,
    "x-amz-content-sha256": payloadHash,
  };
  const commitAuth = createAWSSignature(
    "POST", commitUrl, commitReqHeaders, access_key_id, secret_access_key, session_token, commitPayload,
  );

  const commitResponse = await fetch(commitUrl, {
    method: "POST",
    headers: {
      accept: "*/*",
      authorization: commitAuth,
      "content-type": "application/json",
      origin: "https://jimeng.jianying.com",
      referer: "https://jimeng.jianying.com/ai-tool/video/generate",
      "user-agent": FAKE_HEADERS["User-Agent"],
      "x-amz-date": commitTimestamp,
      "x-amz-security-token": session_token,
      "x-amz-content-sha256": payloadHash,
    },
    body: commitPayload,
  });

  if (!commitResponse.ok) throw new Error(`提交上传失败: ${commitResponse.status}`);
  const commitResult = await commitResponse.json() as Record<string, unknown>;
  if ((commitResult?.ResponseMetadata as Record<string, unknown>)?.Error)
    throw new Error(`提交上传失败: ${JSON.stringify((commitResult.ResponseMetadata as Record<string, unknown>).Error)}`);

  const results = ((commitResult?.Result as Record<string, unknown>)?.Results as Record<string, unknown>[]);
  if (!results?.length) throw new Error("提交上传响应缺少结果");
  const result = results[0];
  if (result.UriStatus !== 2000) throw new Error(`图片上传状态异常: UriStatus=${result.UriStatus}`);

  const imageUri =
    ((commitResult.Result as Record<string, unknown>)?.PluginResult as Record<string, unknown>[])?.[0]?.ImageUri as string ||
    result.Uri as string;
  console.log(`  [upload] 图片上传完成: ${imageUri}`);
  return imageUri;
}

// ═══════════════════════════════════════════════════════════
// 解析 prompt 占位符，构建 meta_list
// ═══════════════════════════════════════════════════════════

function buildMetaListFromPrompt(prompt: string, imageCount: number, audioCount = 0, audioStartIdx = 0): MetaItem[] {
  const metaList: MetaItem[] = [];
  const placeholderRegex = /@(?:图|image)?(\d+)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = placeholderRegex.exec(prompt)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = prompt.substring(lastIndex, match.index);
      if (textBefore.trim()) {
        metaList.push({ meta_type: "text", text: textBefore });
      }
    }

    const imageIndex = parseInt(match[1]) - 1;
    if (imageIndex >= 0 && imageIndex < imageCount) {
      metaList.push({
        meta_type: "image",
        text: "",
        material_ref: { material_idx: imageIndex },
      });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < prompt.length) {
    const remainingText = prompt.substring(lastIndex);
    if (remainingText.trim()) {
      metaList.push({ meta_type: "text", text: remainingText });
    }
  }

  // 没有占位符时，构建默认 meta_list（含图片引用 + 提示词）
  if (metaList.length === 0) {
    for (let i = 0; i < imageCount; i++) {
      if (i === 0) metaList.push({ meta_type: "text", text: "使用" });
      metaList.push({ meta_type: "image", text: "", material_ref: { material_idx: i } });
      if (i < imageCount - 1) metaList.push({ meta_type: "text", text: "和" });
    }
    if (prompt && prompt.trim()) {
      metaList.push({ meta_type: "text", text: `图片，${prompt}` });
    } else {
      metaList.push({ meta_type: "text", text: "图片生成视频" });
    }
  }

  // ★ 无论哪条路径，始终追加音频素材引用到 meta_list
  for (let i = 0; i < audioCount; i++) {
    metaList.push({
      meta_type: "audio",
      text: "",
      material_ref: { material_idx: audioStartIdx + i },
    });
  }

  return metaList;
}

// ═══════════════════════════════════════════════════════════
// 核心：Seedance 2.0 视频生成（完整流程）
// ═══════════════════════════════════════════════════════════

interface GenerateOptions {
  prompt: string;
  ratio: string;
  duration: number;
  quality?: string;
  referenceMode?: string;
  files: { buffer: Buffer; originalname: string; size: number; mimetype?: string }[];
  sessionId: string;
  webId: string;
  userId: string;
  model: string;
}

export async function generateSeedanceVideo(
  taskId: string,
  options: GenerateOptions,
): Promise<string> {
  const { prompt, ratio, duration, quality, files, sessionId, webId, userId, model: requestModel } = options;
  const task = tasks.get(taskId);
  if (!task) throw new Error("任务不存在");

  const modelKey = (requestModel && MODEL_MAP[requestModel as ModelId] ? requestModel : "seedance-2.0") as ModelId;
  const model = MODEL_MAP[modelKey];
  const benefitType = BENEFIT_TYPE_MAP[modelKey];
  const actualDuration = duration || 4;
  const videoQuality = (quality === "1080P" ? "1080P" : "720P") as VideoQuality;
  const resTable = VIDEO_RESOLUTION[videoQuality] || VIDEO_RESOLUTION["720P"];
  const resConfig = resTable[ratio as AspectRatio] || resTable["4:3"];
  const { width, height } = resConfig;

  fileLog(taskId, `${modelKey}: ${width}x${height} (${ratio}) ${actualDuration}秒 ${videoQuality}`);

  // 第1步: 上传图片
  // 第1步: 按 mimetype 分离图片/音频文件并分别上传
  task.progress = "正在上传参考文件...";
  const imageFiles = files.filter(f => !f.mimetype?.startsWith("audio/"));
  const audioFiles = files.filter(f => f.mimetype?.startsWith("audio/"));

  const uploadedImages: UploadedImage[] = [];
  const uploadedAudios: UploadedAudio[] = [];

  for (let i = 0; i < imageFiles.length; i++) {
    task.progress = `正在上传第 ${i + 1}/${imageFiles.length} 张图片...`;
    fileLog(taskId, `上传图片 ${i + 1}/${imageFiles.length}: ${imageFiles[i].originalname} (${(imageFiles[i].size / 1024).toFixed(1)}KB)`);
    const imageUri = await uploadImageBuffer(imageFiles[i].buffer, sessionId, webId, userId);
    uploadedImages.push({ uri: imageUri, width, height });
    fileLog(taskId, `图片 ${i + 1} 上传成功`);
  }

  for (let i = 0; i < audioFiles.length; i++) {
    task.progress = `正在上传第 ${i + 1}/${audioFiles.length} 个音频...`;
    fileLog(taskId, `上传音频 ${i + 1}/${audioFiles.length}: ${audioFiles[i].originalname} (${(audioFiles[i].size / 1024).toFixed(1)}KB)`);
    const audioUri = await uploadImageBuffer(audioFiles[i].buffer, sessionId, webId, userId);
    uploadedAudios.push({ uri: audioUri, name: audioFiles[i].originalname });
    fileLog(taskId, `音频 ${i + 1} 上传成功`);
  }

  fileLog(taskId, `上传完成: ${uploadedImages.length} 张图片, ${uploadedAudios.length} 个音频`);

  // 第2步: 构建请求体（Seedance 2.0 与视频 3.x 结构不同）
  const componentId = generateUUID();
  const submitId = generateUUID();
  const isVGModel = isVideoGenModel(modelKey);

  // 计算视频宽高比
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  const aspectRatio = `${width / divisor}:${height / divisor}`;

  // 所有 3.x 模型 functionMode 统一 first_last_frames（官网拦截确认）
  // 但 end_frame_image/ending_control 仅支持首尾帧的模型才发（3.0/3.5Pro）
  // 3.0 Pro / 3.0 Fast 官网 payload 无 end_frame_image 字段
  const supportsFL = isVGModel && isFirstLastFrameSupported(modelKey);
  const functionMode = isVGModel
    ? "first_last_frames"
    : (options.referenceMode === "首帧参考" ? "first_frame_reference" : "omni_reference");

  const resolutionStr = videoQuality.toLowerCase(); // "720p" | "1080p"——即梦官网使用小写

  const metricsExtra = JSON.stringify({
    promptSource: "custom",
    isDefaultSeed: 1,
    originSubmitId: submitId,
    isRegenerate: false,
    enterFrom: "click",
    position: "page_bottom_box",
    functionMode,
    sceneOptions: JSON.stringify([{
      type: "video",
      scene: "BasicVideoGenerateButton",
      ...(isVGModel ? { resolution: resolutionStr } : {}),
      modelReqKey: model,
      videoDuration: actualDuration,
      reportParams: {
        enterSource: "generate",
        vipSource: "generate",
        extraVipFunctionKey: isVGModel ? `${model}-${resolutionStr}` : model,
        useVipFunctionDetailsReporterHoc: true,
      },
      materialTypes: supportsFL ? [1, 1] : [1],
    }]),
  });

  // 第3步: 提交生成请求（通过浏览器代理绕过 shark 反爬）
  task.progress = "正在提交视频生成请求...";
  fileLog(taskId, `提交生成请求: model=${model}, isVGModel=${isVGModel}, benefitType=${benefitType}`);

  const draftVersion = isVGModel ? VIDEOGEN_DRAFT_VERSION : SEEDANCE_DRAFT_VERSION;
  const generateQueryParams = new URLSearchParams({
    aid: String(DEFAULT_ASSISTANT_ID),
    device_platform: "web",
    region: "cn",
    webId: String(webId),
    da_version: draftVersion,
    os: "windows",
    web_component_open_flag: "1",
    web_version: "7.5.0",
    aigc_features: "app_lip_sync",
  });
  const generateUrl = `${JIMENG_BASE_URL}/mweb/v1/aigc_draft/generate?${generateQueryParams}`;

  let draftContent: string;

  if (isVGModel) {
    // ── 视频 3.x 系列：使用 first_frame_image + end_frame_image 结构（官网拦截匹配） ──
    const firstImage = uploadedImages[0];
    // 构建图片对象（首帧和尾帧共用同一结构，官网也是如此）
    const makeImageObj = () => ({
      type: "image" as const,
      id: generateUUID(),
      source_from: "upload",
      platform_type: 1,
      name: "",
      image_uri: firstImage.uri,
      aigc_image: { type: "", id: generateUUID() },
      width: firstImage.width,
      height: firstImage.height,
      format: "",
      uri: firstImage.uri,
    });
    draftContent = JSON.stringify({
      type: "draft",
      id: generateUUID(),
      min_version: "3.0.5",
      min_features: [],
      is_from_tsn: true,
      version: draftVersion,
      main_component_id: componentId,
      component_list: [{
        type: "video_base_component",
        id: componentId,
        min_version: "1.0.0",
        aigc_mode: "workbench",
        metadata: {
          type: "",
          id: generateUUID(),
          created_platform: 3,
          created_platform_version: "",
          created_time_in_ms: String(Date.now()),
          created_did: "",
        },
        generate_type: "gen_video",
        abilities: {
          type: "",
          id: generateUUID(),
          gen_video: {
            type: "",
            id: generateUUID(),
            text_to_video_params: {
              type: "",
              id: generateUUID(),
              video_gen_inputs: [{
                type: "",
                id: generateUUID(),
                min_version: "3.0.5",
                prompt: prompt || "",
                first_frame_image: makeImageObj(),
                ...(supportsFL ? { end_frame_image: makeImageObj(), ending_control: "1.0" } : {}),
                video_mode: 2,
                fps: 24,
                duration_ms: actualDuration * 1000,
                resolution: resolutionStr,
                idip_meta_list: [],
              }],
              video_aspect_ratio: aspectRatio,
              seed: Math.floor(Math.random() * 1000000000),
              model_req_key: model,
              priority: 0,
            },
            video_task_extra: metricsExtra,
          },
        },
        process_type: 1,
      }],
    });
  } else {
    // ── Seedance 2.0 系列：使用 unified_edit_input 结构（多图 + meta_list） ──
    const imageMaterials = uploadedImages.map((img) => ({
      type: "",
      id: generateUUID(),
      material_type: "image",
      image_info: {
        type: "image",
        id: generateUUID(),
        source_from: "upload",
        platform_type: 1,
        name: "",
        image_uri: img.uri,
        aigc_image: { type: "", id: generateUUID() },
        width: img.width,
        height: img.height,
        format: "",
        uri: img.uri,
      },
    }));
    // ★ 追加音频素材到 material_list
    const audioMaterials = uploadedAudios.map((aud) => ({
      type: "",
      id: generateUUID(),
      material_type: "audio",
      audio_info: {
        type: "audio",
        id: generateUUID(),
        source_from: "upload",
        platform_type: 1,
        name: aud.name,
        audio_uri: aud.uri,
        uri: aud.uri,
        format: "",
      },
    }));
    const materialList = [...imageMaterials, ...audioMaterials];
    const metaList = buildMetaListFromPrompt(prompt || "", uploadedImages.length, uploadedAudios.length, uploadedImages.length);

    draftContent = JSON.stringify({
      type: "draft",
      id: generateUUID(),
      min_version: SEEDANCE_DRAFT_VERSION,
      min_features: ["AIGC_Video_UnifiedEdit"],
      is_from_tsn: true,
      version: SEEDANCE_DRAFT_VERSION,
      main_component_id: componentId,
      component_list: [{
        type: "video_base_component",
        id: componentId,
        min_version: "1.0.0",
        aigc_mode: "workbench",
        metadata: {
          type: "",
          id: generateUUID(),
          created_platform: 3,
          created_platform_version: "",
          created_time_in_ms: String(Date.now()),
          created_did: "",
        },
        generate_type: "gen_video",
        abilities: {
          type: "",
          id: generateUUID(),
          gen_video: {
            type: "",
            id: generateUUID(),
            text_to_video_params: {
              type: "",
              id: generateUUID(),
              video_gen_inputs: [{
                type: "",
                id: generateUUID(),
                min_version: SEEDANCE_DRAFT_VERSION,
                prompt: "",
                video_mode: 2,
                fps: 24,
                duration_ms: actualDuration * 1000,
                idip_meta_list: [],
                unified_edit_input: {
                  type: "",
                  id: generateUUID(),
                  material_list: materialList,
                  meta_list: metaList,
                },
              }],
              video_aspect_ratio: aspectRatio,
              seed: Math.floor(Math.random() * 1000000000),
              model_req_key: model,
              priority: 0,
            },
            video_task_extra: metricsExtra,
          },
        },
        process_type: 1,
      }],
    });
  }

  // 构建请求体（所有模型均需 benefit_type，来源官网 2026.02.26 拦截确认）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extendObj: Record<string, any> = { root_model: model };
  if (benefitType) {
    extendObj.m_video_commerce_info = {
      benefit_type: benefitType,
      resource_id: "generate_video",
      resource_id_type: "str",
      resource_sub_type: "aigc",
    };
    extendObj.m_video_commerce_info_list = [{
      benefit_type: benefitType,
      resource_id: "generate_video",
      resource_id_type: "str",
      resource_sub_type: "aigc",
    }];
  }

  const generateBody = {
    extend: extendObj,
    submit_id: submitId,
    metrics_extra: metricsExtra,
    draft_content: draftContent,
    http_common_info: { aid: DEFAULT_ASSISTANT_ID },
  };

  fileLog(taskId, `正在通过浏览器代理提交生成请求... webId=${webId}, userId=${userId}`);
  // 记录完整请求体，便于与官网 payload 对比排查 invalid parameter
  const fullBodyJson = JSON.stringify(generateBody);
  fileLog(taskId, `=== 完整请求体 (${fullBodyJson.length}字) ===`);
  fileLog(taskId, fullBodyJson);
  fileLog(taskId, `=== 请求URL ===`);
  fileLog(taskId, generateUrl);
  const generateResult = await browserService.fetch(
    sessionId, webId, userId, generateUrl,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(generateBody) },
  );

  // 将完整返回结果写入日志（截断到2000字符防止过大）
  const resultStr = JSON.stringify(generateResult);
  fileLog(taskId, `browserService.fetch 原始返回 (${resultStr.length}字): ${resultStr.substring(0, 2000)}`);

  // 解析浏览器代理返回结果
  if (generateResult.ret !== undefined && String(generateResult.ret) !== "0") {
    const retCode = String(generateResult.ret);
    const errMsg = (generateResult.errmsg as string) || retCode;
    fileLog(taskId, `❌ 即梦API返回错误 ret=${retCode}, errmsg=${errMsg}`);
    if (retCode === "5000") throw new Error("即梦积分不足，请前往即梦官网领取积分");
    throw new Error(`即梦API错误 (ret=${retCode}): ${errMsg}`);
  }

  const aigcData = (generateResult.data as Record<string, unknown>)?.aigc_data as Record<string, unknown>;
  const historyId = aigcData?.history_record_id as string;
  if (!historyId) {
    fileLog(taskId, `❌ 未获取到 historyId, aigcData=${JSON.stringify(aigcData)?.substring(0, 500)}`);
    throw new Error("未获取到记录ID");
  }

  fileLog(taskId, `✅ 生成请求已提交, historyId: ${historyId}`);

  // 第4步: 轮询获取结果
  task.progress = "已提交，等待AI生成视频...";
  await new Promise((r) => setTimeout(r, 5000));

  let status = 20;
  let failCode: number | undefined;
  let itemList: Record<string, unknown>[] = [];
  const maxRetries = 60;

  for (let retryCount = 0; retryCount < maxRetries && status === 20; retryCount++) {
    try {
      const result = await jimengRequest("post", "/mweb/v1/get_history_by_ids", sessionId, webId, userId, {
        data: { history_ids: [historyId] },
      });

      const historyList = result?.history_list as Record<string, unknown>[] | undefined;
      const historyData = historyList?.[0] || (result as Record<string, Record<string, unknown>>)?.[historyId];

      if (!historyData) {
        const waitTime = Math.min(2000 * (retryCount + 1), 30000);
        fileLog(taskId, `轮询 #${retryCount + 1}: 数据不存在，等待 ${waitTime}ms`);
        await new Promise((r) => setTimeout(r, waitTime));
        continue;
      }

      status = historyData.status as number;
      failCode = historyData.fail_code as number | undefined;
      itemList = (historyData.item_list as Record<string, unknown>[]) || [];

      const elapsed = Math.floor((Date.now() - task.startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;

      fileLog(taskId, `轮询 #${retryCount + 1}: status=${status}, ${mins}分${secs}秒`);

      if (status === 30) {
        throw new Error(
          failCode === 2038
            ? "内容被过滤，请修改提示词后重试"
            : `视频生成失败，错误码: ${failCode}`,
        );
      }

      if (status === 20) {
        if (elapsed < 120) {
          task.progress = "AI正在生成视频，请耐心等待...";
        } else {
          task.progress = `视频生成中，已等待 ${mins} 分钟...`;
        }
        const waitTime = 2000 * Math.min(retryCount + 1, 5);
        await new Promise((r) => setTimeout(r, waitTime));
      }
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message?.includes("内容被过滤") || err.message?.includes("生成失败")) throw err;
      fileLog(taskId, `轮询出错: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * (retryCount + 1)));
    }
  }

  if (status === 20) throw new Error("视频生成超时 (约20分钟)，请稍后重试");

  // 第5步: 获取高清视频URL
  task.progress = "正在获取高清视频...";
  const firstItem = itemList?.[0];
  const itemId =
    (firstItem?.item_id as string) ||
    (firstItem?.id as string) ||
    (firstItem?.local_item_id as string) ||
    ((firstItem?.common_attr as Record<string, unknown>)?.id as string);

  if (itemId) {
    try {
      const hqResult = await jimengRequest("post", "/mweb/v1/get_local_item_list", sessionId, webId, userId, {
        data: {
          item_id_list: [String(itemId)],
          pack_item_opt: { scene: 1, need_data_integrity: true },
          is_for_video_download: true,
        },
      });

      const hqItemList =
        (hqResult?.item_list as Record<string, unknown>[]) ||
        (hqResult?.local_item_list as Record<string, unknown>[]) ||
        [];
      const hqItem = hqItemList[0];
      const video = hqItem?.video as Record<string, unknown> | undefined;
      const hqUrl =
        ((video?.transcoded_video as Record<string, unknown>)?.origin as Record<string, unknown>)?.video_url as string ||
        video?.download_url as string ||
        video?.play_url as string ||
        video?.url as string;

      if (hqUrl) {
        fileLog(taskId, `高清视频URL获取成功`);
        return hqUrl;
      }

      // 正则匹配兜底
      const responseStr = JSON.stringify(hqResult);
      const urlMatch =
        responseStr.match(/https:\/\/v[0-9]+-dreamnia\.jimeng\.com\/[^"\s\\]+/) ||
        responseStr.match(/https:\/\/v[0-9]+-[^"\\]*\.jimeng\.com\/[^"\s\\]+/);
      if (urlMatch?.[0]) {
        fileLog(taskId, `正则提取到高清视频URL`);
        return urlMatch[0];
      }
    } catch (err: unknown) {
      const error = err as Error;
      fileLog(taskId, `获取高清URL失败，使用预览URL: ${error.message}`);
    }
  }

  // 回退使用预览URL
  const firstVideo = firstItem?.video as Record<string, unknown> | undefined;
  const videoUrl =
    ((firstVideo?.transcoded_video as Record<string, unknown>)?.origin as Record<string, unknown>)?.video_url as string ||
    firstVideo?.play_url as string ||
    firstVideo?.download_url as string ||
    firstVideo?.url as string;

  if (!videoUrl) throw new Error("未能获取视频URL");

  fileLog(taskId, `视频URL (预览): ${videoUrl}`);
  return videoUrl;
}
