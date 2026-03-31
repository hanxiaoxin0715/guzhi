/**
 * 即梦生图 API 核心逻辑
 * 复用 jimeng-api.ts 的上传、请求、浏览器代理能力
 * 新增图片生成请求结构和轮询逻辑
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import browserService from "../seedance/browser-service";
import {
  JIMENG_BASE_URL,
  DEFAULT_ASSISTANT_ID,
  VERSION_CODE,
  PLATFORM_CODE,
  FAKE_HEADERS,
} from "../seedance/types";
import {
  JIMENG_IMAGE_MODEL_MAP,
  JIMENG_IMAGE_BENEFIT_TYPE,
  JIMENG_IMAGE_DRAFT_VERSION,
  JIMENG_IMAGE_RESOLUTION_2K,
  JIMENG_IMAGE_RESOLUTION_4K,
  JIMENG_IMAGE_RATIO_TYPE,
  IMAGES_PER_REQUEST,
  type JimengImageModelId,
  type JimengImageRatio,
  type JimengImageResolution,
  type JimengImageTask,
  type JimengImageResult,
} from "./types";

// ═══════════════════════════════════════════════════════════
// 文件日志
// ═══════════════════════════════════════════════════════════
const LOG_FILE = path.join(process.cwd(), "outputs", "jimeng-image-log.txt");
function fileLog(taskId: string, msg: string) {
  const ts = new Date().toLocaleString("zh-CN", { hour12: false });
  const line = `[${ts}] [${taskId}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch { /* ignore */ }
  console.log(`[jimeng-img][${taskId}] ${msg}`);
}

// ═══════════════════════════════════════════════════════════
// 全局任务存储
// ═══════════════════════════════════════════════════════════
const tasks = new Map<string, JimengImageTask>();
let taskCounter = 0;

export function createTaskId(): string {
  return `jimg_${++taskCounter}_${Date.now()}`;
}

export function getTask(taskId: string): JimengImageTask | undefined {
  return tasks.get(taskId);
}

export function setTask(taskId: string, task: JimengImageTask): void {
  tasks.set(taskId, task);
}

export function deleteTask(taskId: string): void {
  tasks.delete(taskId);
}

/**
 * 诊断浏览器代理环境——不发起实际生成请求
 * 检查 navigateTo 后 bdms SDK / msToken / a_bogus 注入状态
 */
export async function diagnoseBrowserProxy(
  sessionId: string,
  webId: string,
  userId: string,
): Promise<Record<string, unknown>> {
  const steps: Record<string, unknown>[] = [];
  try {
    // Step 1: 确保浏览器和会话存在
    steps.push({ step: "getSession", status: "starting" });
    const session = await browserService.getSession(sessionId, webId, userId);
    const initialUrl = session.page.url();
    steps.push({ step: "getSession", status: "ok", pageUrl: initialUrl });

    // Step 2: 导航到图片生成页面
    steps.push({ step: "navigateTo", status: "starting", target: "https://jimeng.jianying.com/ai-tool/image/generate" });
    await browserService.navigateTo(
      sessionId, webId, userId,
      "https://jimeng.jianying.com/ai-tool/image/generate",
    );
    const afterNavUrl = session.page.url();
    steps.push({ step: "navigateTo", status: "ok", pageUrl: afterNavUrl });

    // Step 3: 检查 bdms SDK 状态、msToken、fetch patch 状态
    steps.push({ step: "bdmsDiag", status: "starting" });
    const diag = await session.page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const fetchStr = (w.fetch as () => void)?.toString?.()?.substring(0, 200) || "N/A";
      const isPatched = fetchStr.indexOf("native code") === -1;
      const hasBdms = !!(w.bdms as Record<string, unknown>)?.init;
      const bdmsKeys = w.bdms ? Object.keys(w.bdms as Record<string, unknown>).join(", ") : "N/A";
      const hasCrawler = !!w.byted_acrawler;
      const msMatch = document.cookie.match(/msToken=([^;]+)/);
      const msToken = msMatch ? msMatch[1] : null;
      const allCookies = document.cookie.split(";").map((c: string) => c.trim().split("=")[0]).join(", ");
      const cookieCount = document.cookie.split(";").length;
      const pageUrl = window.location.href;
      return {
        pageUrl, fetchStr, isPatched, hasBdms, bdmsKeys, hasCrawler,
        msToken: msToken ? msToken.substring(0, 40) + "..." : null,
        msTokenLen: msToken?.length || 0,
        allCookies, cookieCount,
      };
    });
    steps.push({ step: "bdmsDiag", status: "ok", ...diag });

    // Step 4: 验证 a_bogus 注入——发一个轻量级 GET 请求到已知端点
    steps.push({ step: "testFetch", status: "starting" });
    const testUrl = `https://jimeng.jianying.com/mweb/v1/get_common_config?aid=513695&device_platform=web&region=cn&webId=${webId}`;
    let capturedTestUrl = "";
    const captureHandler = (req: { url: () => string }) => {
      const reqUrl = req.url();
      if (reqUrl.includes("get_common_config")) capturedTestUrl = reqUrl;
    };
    session.page.on("request", captureHandler);

    const testResult = await session.page.evaluate(
      async ({ url }: { url: string }) => {
        try {
          const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config_type: "image_model_commerce_config" }), credentials: "include" });
          const text = await resp.text();
          return { status: resp.status, bodyLen: text.length, bodyPreview: text.substring(0, 200) };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
      { url: testUrl },
    );
    session.page.off("request", captureHandler);

    const testHasAbogus = capturedTestUrl ? capturedTestUrl.includes("a_bogus=") : null;
    const testHasMsToken = capturedTestUrl ? capturedTestUrl.includes("msToken=") : null;
    steps.push({
      step: "testFetch", status: "ok",
      a_bogus: testHasAbogus, msToken_in_url: testHasMsToken,
      capturedUrl: capturedTestUrl?.substring(0, 400),
      result: testResult,
    });

    return { success: true, steps };
  } catch (err) {
    steps.push({ step: "error", message: (err as Error).message });
    return { success: false, steps };
  }
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
// 工具函数（复用 jimeng-api.ts 逻辑）
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
// 即梦 API 请求（直连，不经过浏览器代理）
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
        fileLog("req", `重试 ${uri} (第${attempt}次)`);
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
        (err as Error & { isApiError: boolean; retCode: string }).isApiError = true;
        (err as Error & { retCode: string }).retCode = retCode;
        throw err;
      }

      return data;
    } catch (err: unknown) {
      const error = err as Error & { isApiError?: boolean };
      if (error.isApiError) throw error;
      if (attempt === 3) throw error;
    }
  }

  throw new Error(`即梦API请求失败: ${uri}`);
}

// ═══════════════════════════════════════════════════════════
// 动态获取图片模型的 commerce config（benefit_type）
// ═══════════════════════════════════════════════════════════

let cachedImageBenefitType: string | null = null;

/**
 * 从即梦 API 动态获取图片生成的 benefit_type
 * 调用 /mweb/v1/get_common_config 接口获取模型商业化配置
 */
async function fetchImageBenefitType(sessionId: string, webId: string, userId: string, model: string): Promise<string | null> {
  if (cachedImageBenefitType) return cachedImageBenefitType;
  try {
    const result = await jimengRequest("post", "/mweb/v1/get_common_config", sessionId, webId, userId, {
      data: { config_type: "image_model_commerce_config" },
    });
    const fullConfig = JSON.stringify(result);
    fileLog("config", `get_common_config 完整返回 (${fullConfig.length}字): ${fullConfig.substring(0, 3000)}`);
    // 尝试从返回结果提取 benefit_type
    const configStr = fullConfig;
    // 匹配 model 对应的 benefit_type
    const modelPattern = new RegExp(`"${model.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}"[^}]*?benefit_type["':\\s]*["']([^"']+)["']`);
    const m = configStr.match(modelPattern);
    if (m) {
      cachedImageBenefitType = m[1];
      fileLog("config", `模型 ${model} 的 benefit_type: ${m[1]}`);
      return m[1];
    }
    // 通用匹配
    const genericMatch = configStr.match(/benefit_type["':\s]*["']([^"']+)["']/); 
    if (genericMatch) {
      cachedImageBenefitType = genericMatch[1];
      fileLog("config", `通用 benefit_type: ${genericMatch[1]}`);
      return genericMatch[1];
    }
    fileLog("config", `未找到 benefit_type，将不发送 commerce_info`);
    return null;
  } catch (err) {
    fileLog("config", `get_common_config 失败: ${(err as Error).message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// AWS4 签名、CRC32、图片上传（完全复用 jimeng-api.ts）
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

  const queryParams: [string, string][] = [];
  urlObj.searchParams.forEach((value, key) => {
    queryParams.push([key, value]);
  });
  queryParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalQueryString = queryParams.map(([k, v]) => `${k}=${v}`).join("&");

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
    method.toUpperCase(), pathname, canonicalQueryString,
    canonicalHeaders, signedHeaders, payloadHash,
  ].join("\n");

  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256", timestamp, credentialScope,
    crypto.createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
  ].join("\n");

  const kDate = crypto.createHmac("sha256", `AWS4${secretAccessKey}`).update(date).digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(region).digest();
  const kService = crypto.createHmac("sha256", kRegion).update(service).digest();
  const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

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

async function uploadImageBuffer(buffer: Buffer, sessionId: string, webId: string, userId: string): Promise<string> {
  fileLog("upload", `开始上传图片, 大小: ${buffer.length} 字节`);

  // 第1步: 获取上传令牌
  const tokenResult = await jimengRequest("post", "/mweb/v1/get_upload_token", sessionId, webId, userId, {
    data: { scene: 2 },
  }) as Record<string, string>;

  const { access_key_id, secret_access_key, session_token, service_id } = tokenResult;
  if (!access_key_id || !secret_access_key || !session_token) {
    throw new Error("获取上传令牌失败");
  }
  const actualServiceId = service_id || "tb4s082cfz";

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
      referer: "https://jimeng.jianying.com/ai-tool/image/generate",
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
      Referer: "https://jimeng.jianying.com/ai-tool/image/generate",
      "User-Agent": FAKE_HEADERS["User-Agent"],
    },
    body: new Blob([new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength)]),
  });

  if (!uploadResponse.ok) throw new Error(`图片上传失败: ${uploadResponse.status}`);

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
      referer: "https://jimeng.jianying.com/ai-tool/image/generate",
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
  fileLog("upload", `图片上传完成: ${imageUri}`);
  return imageUri;
}

// ═══════════════════════════════════════════════════════════
// 核心：即梦图片生成（完整流程）
// ═══════════════════════════════════════════════════════════

interface GenerateImageOptions {
  prompt: string;
  negativePrompt?: string;
  ratio: JimengImageRatio;
  resolution: JimengImageResolution;
  count: number; // 总张数（1-8），每4张一个请求
  model: JimengImageModelId;
  sessionId: string;
  webId: string;
  userId: string;
  rawCookies?: string; // 用户完整 Cookie 字符串（用于浏览器代理注入完整登录态）
  referenceBuffers?: { buffer: Buffer; originalname: string; size: number }[];
}

/** 获取分辨率配置 */
function getResolution(ratio: JimengImageRatio, resolution: JimengImageResolution): { width: number; height: number } {
  const table = resolution === "4K" ? JIMENG_IMAGE_RESOLUTION_4K : JIMENG_IMAGE_RESOLUTION_2K;
  return table[ratio] || table["1:1"];
}

/**
 * 执行图片生成（异步，后台运行）
 * 支持多批次：count > 4 时自动拆分为多个请求
 */
export async function generateJimengImage(
  taskId: string,
  options: GenerateImageOptions,
): Promise<JimengImageResult[]> {
  const { prompt, negativePrompt, ratio, resolution, count, model: modelId, sessionId, webId, userId, rawCookies, referenceBuffers } = options;
  const task = tasks.get(taskId);
  if (!task) throw new Error("任务不存在");

  const model = JIMENG_IMAGE_MODEL_MAP[modelId] || JIMENG_IMAGE_MODEL_MAP["seedream-5.0"];
  const { width, height } = getResolution(ratio, resolution);

  fileLog(taskId, `开始生成: ${modelId}(${model}) ${width}x${height} (${ratio}) ${resolution} 共${count}张`);

  // 第1步: 上传参考图（如果有）
  const uploadedImageUris: string[] = [];
  if (referenceBuffers && referenceBuffers.length > 0) {
    task.progress = "正在上传参考图片...";
    for (let i = 0; i < referenceBuffers.length; i++) {
      task.progress = `正在上传第 ${i + 1}/${referenceBuffers.length} 张参考图...`;
      fileLog(taskId, `上传参考图 ${i + 1}/${referenceBuffers.length}: ${referenceBuffers[i].originalname}`);
      const uri = await uploadImageBuffer(referenceBuffers[i].buffer, sessionId, webId, userId);
      uploadedImageUris.push(uri);
    }
    fileLog(taskId, `全部 ${uploadedImageUris.length} 张参考图上传完成`);
  }

  // 第2步: 按批次生成（每批4张）
  const batchCount = Math.ceil(count / IMAGES_PER_REQUEST);
  task.batchCount = batchCount;
  const allResults: JimengImageResult[] = [];

  for (let batch = 0; batch < batchCount; batch++) {
    const batchSize = Math.min(IMAGES_PER_REQUEST, count - batch * IMAGES_PER_REQUEST);
    task.progress = batchCount > 1
      ? `正在生成第 ${batch + 1}/${batchCount} 批 (${batchSize}张)...`
      : `正在生成 ${batchSize} 张图片...`;
    task.status = "generating";

    fileLog(taskId, `第 ${batch + 1}/${batchCount} 批: 生成 ${batchSize} 张`);

    try {
      const batchResults = await generateOneBatch(taskId, {
        prompt,
        negativePrompt,
        model,
        modelId,
        width,
        height,
        ratio,
        resolution,
        generateCount: batchSize,
        sessionId,
        webId,
        userId,
        rawCookies,
        uploadedImageUris,
      });

      allResults.push(...batchResults);
      task.completedBatches = batch + 1;
      task.results = allResults;

      fileLog(taskId, `第 ${batch + 1} 批完成: ${batchResults.length} 张`);
    } catch (err: unknown) {
      const error = err as Error & { failCode?: number };
      fileLog(taskId, `第 ${batch + 1} 批失败: ${error.message}`);
      // 如果有已完成的图片，不终止整个任务
      if (allResults.length > 0) {
        task.error = `第 ${batch + 1} 批生成失败: ${error.message}`;
        task.failCode = error.failCode;
        break;
      }
      throw error;
    }
  }

  return allResults;
}

// ═══════════════════════════════════════════════════════════
// 单批次生成（4张）
// ═══════════════════════════════════════════════════════════

interface BatchOptions {
  prompt: string;
  negativePrompt?: string;
  model: string; // 即梦内部模型标识
  modelId: JimengImageModelId;
  width: number;
  height: number;
  ratio: JimengImageRatio;
  resolution: JimengImageResolution;
  generateCount: number;
  sessionId: string;
  webId: string;
  userId: string;
  rawCookies?: string;
  uploadedImageUris: string[];
}

async function generateOneBatch(
  taskId: string,
  opts: BatchOptions,
): Promise<JimengImageResult[]> {
  const {
    prompt, negativePrompt, model, modelId, width, height, ratio,
    resolution, generateCount, sessionId, webId, userId, rawCookies, uploadedImageUris,
  } = opts;

  const componentId = generateUUID();
  const submitId = generateUUID();

  // ★ image_ratio 使用数字编号（对齐官方 API：1=1:1, 2=3:4, 3=16:9, ...）
  const imageRatioNum = JIMENG_IMAGE_RATIO_TYPE[ratio] || JIMENG_IMAGE_RATIO_TYPE["1:1"];
  const resolutionStr = resolution.toLowerCase(); // "2k" | "4k"
  const hasRefImages = uploadedImageUris.length > 0;

  // ★ metrics_extra — 对齐官方格式
  //   有参考图时 abilityList 需要包含 byte_edit 能力
  const abilityList = hasRefImages
    ? uploadedImageUris.map(uri => ({
        abilityName: "byte_edit",
        strength: 0.5,
        source: { imageUrl: uri },
      }))
    : [];

  const metricsExtra = JSON.stringify({
    promptSource: "custom",
    generateCount: 1,
    enterFrom: "click",
    position: "page_bottom_box",
    sceneOptions: JSON.stringify([{
      type: "image",
      scene: "ImageBasicGenerate",
      modelReqKey: model,
      resolutionType: resolutionStr,
      abilityList,
      benefitCount: generateCount,
      reportParams: {
        enterSource: "generate",
        vipSource: "generate",
        extraVipFunctionKey: `${model}-${resolutionStr}`,
        useVipFunctionDetailsReporterHoc: true,
      },
    }]),
    isBoxSelect: false,
    isCutout: false,
    generateId: submitId,
    isRegenerate: false,
  });

  // ★ 构建 draft_content —
  //   无参考图：使用 generate 能力（纯文生图）
  //   有参考图：使用 blend 能力 + ability_list（对齐官网 2026-03 抓包结构）
  const coreParam = {
    type: "",
    id: generateUUID(),
    model: model,
    prompt: hasRefImages
      ? uploadedImageUris.map(() => "##").join("") + (prompt || "")
      : (prompt || ""),
    ...(negativePrompt && !hasRefImages ? { negative_prompt: negativePrompt } : {}),
    ...(!hasRefImages ? { seed: Math.floor(Math.random() * 4294967295) } : {}),
    sample_strength: 0.5,
    image_ratio: imageRatioNum,
    large_image_info: {
      type: "",
      id: generateUUID(),
      height,
      width,
      resolution_type: resolutionStr,
    },
    intelligent_ratio: false, // ★ 强制使用用户指定的 image_ratio / width / height，避免 API 从参考图自动检测比例导致画幅错误
    generate_type: 0,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let abilitiesContent: Record<string, any>;
  if (hasRefImages) {
    // ★ blend 模式：参考图作为 ability_list 中的 byte_edit 能力
    abilitiesContent = {
      blend: {
        type: "",
        id: generateUUID(),
        min_features: [],
        core_param: coreParam,
        ability_list: uploadedImageUris.map((uri, idx) => ({
          type: "",
          id: generateUUID(),
          name: "byte_edit",
          image_uri_list: [uri],
          image_list: [{
            type: "image",
            id: generateUUID(),
            source_from: "upload",
            platform_type: 1,
            name: "",
            image_uri: uri,
            width: 0,
            height: 0,
            format: "",
            uri,
          }],
          strength: 0.5,
        })),
        prompt_placeholder_info_list: uploadedImageUris.map((_, idx) => ({
          type: "",
          id: generateUUID(),
          ability_index: idx,
        })),
        postedit_param: {
          type: "",
          id: generateUUID(),
          generate_type: 0,
        },
      },
    };
  } else {
    // ★ generate 模式：纯文生图
    abilitiesContent = {
      generate: {
        type: "",
        id: generateUUID(),
        core_param: coreParam,
      },
    };
  }

  const draftContent = JSON.stringify({
    type: "draft",
    id: generateUUID(),
    min_version: "3.0.2",
    min_features: [],
    is_from_tsn: true,
    version: JIMENG_IMAGE_DRAFT_VERSION,
    main_component_id: componentId,
    component_list: [{
      type: "image_base_component",
      id: componentId,
      min_version: "3.0.2",
      aigc_mode: "workbench",
      metadata: {
        type: "",
        id: generateUUID(),
        created_platform: 3,
        created_platform_version: "",
        created_time_in_ms: String(Date.now()),
        created_did: "",
      },
      generate_type: hasRefImages ? "blend" : "generate",
      abilities: {
        type: "",
        id: generateUUID(),
        ...abilitiesContent,
        gen_option: {
          type: "",
          id: generateUUID(),
          generate_all: false,
        },
      },
    }],
  });

  // ★ extend — 对齐官方网站：仅 root_model，不包含 commerce_info
  const extendObj = { root_model: model };

  const generateQueryParams = new URLSearchParams({
    aid: String(DEFAULT_ASSISTANT_ID),
    device_platform: "web",
    region: "cn",
    webId: String(webId),
    da_version: JIMENG_IMAGE_DRAFT_VERSION,
    os: "windows",
    web_component_open_flag: "1",
    web_version: "7.5.0",
    aigc_features: "app_lip_sync",
  });
  const generateUrl = `${JIMENG_BASE_URL}/mweb/v1/aigc_draft/generate?${generateQueryParams}`;

  const generateBody = {
    extend: extendObj,
    submit_id: submitId,
    metrics_extra: metricsExtra,
    draft_content: draftContent,
    http_common_info: { aid: DEFAULT_ASSISTANT_ID },
  };

  fileLog(taskId, `提交生成请求: model=${model}, ${width}x${height}, ratio=${ratio}(${imageRatioNum}), res=${resolutionStr}`);
  const fullBodyJson = JSON.stringify(generateBody);
  fileLog(taskId, `=== 完整请求体 (${fullBodyJson.length}字) ===`);
  fileLog(taskId, fullBodyJson);
  fileLog(taskId, `=== 请求URL ===`);
  fileLog(taskId, generateUrl);

  // ★ 策略：浏览器代理优先（自动携带 a_bogus + msToken）
  let generateResult: Record<string, unknown>;
  try {
    fileLog(taskId, `>>> 路径1: 浏览器代理请求 (a_bogus + msToken)...`);

    // ★ 关键修复：注入用户完整 Cookie（3018 根因：仅 7 个基础 Cookie 不够，需要 passport_csrf_token、ttwid 等登录态）
    if (rawCookies) {
      try {
        const injected = await browserService.injectExtraCookies(sessionId, webId, userId, rawCookies);
        fileLog(taskId, `✓ 已注入用户完整 Cookie (${injected} 个)`);
      } catch (cookieErr) {
        fileLog(taskId, `⚠ Cookie 注入失败: ${(cookieErr as Error).message}`);
      }
    } else {
      fileLog(taskId, `⚠ 未提供完整 Cookie，仅使用基础 7 个 Cookie（可能导致 3018）`);
    }

    // 先导航到即梦生图页面
    try {
      await browserService.navigateTo(
        sessionId, webId, userId,
        "https://jimeng.jianying.com/ai-tool/image/generate",
      );
      fileLog(taskId, `✓ 已导航到即梦生图页面`);
    } catch (navErr) {
      fileLog(taskId, `⚠ 导航到生图页面失败: ${(navErr as Error).message}，继续尝试...`);
    }

    fileLog(taskId, `正在通过浏览器代理请求生图API...`);
    // ★ 关键修复：必须带上 Sign / Device-Time / App-Sdk-Version / Appvr / Pf 等头
    //   否则即使 Cookie 和 a_bogus 都对，服务端依然返回 3018
    const { deviceTime, sign } = generateSign("/mweb/v1/aigc_draft/generate");
    generateResult = await browserService.fetch(
      sessionId, webId, userId, generateUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Sign": sign,
          "Sign-Ver": "1",
          "Device-Time": String(deviceTime),
          "App-Sdk-Version": "48.0.0",
          "Appvr": VERSION_CODE,
          "Pf": PLATFORM_CODE,
          "Lan": "zh-Hans",
          "Loc": "cn",
          "Appid": String(DEFAULT_ASSISTANT_ID),
        },
        body: fullBodyJson,
      },
    );

    // 记录浏览器诊断信息
    const browserDiag = generateResult.__browser_diag as Record<string, unknown> | undefined;
    if (browserDiag) {
      fileLog(taskId, `[browser诊断] 页面URL: ${browserDiag.pageUrl}`);
      fileLog(taskId, `[browser诊断] bdms: ${browserDiag.hasBdms}, crawler: ${browserDiag.hasCrawler}, fetchPatched: ${browserDiag.fetchPatched}`);
      fileLog(taskId, `[browser诊断] a_bogus: ${browserDiag.a_bogus ? "✅已注入" : "❌未注入"}, msToken: ${browserDiag.msToken || "无"}`);
      fileLog(taskId, `[browser诊断] Cookie列表: ${browserDiag.cookieNames}`);
      if (browserDiag.capturedUrl) {
        fileLog(taskId, `[browser诊断] 实际请求URL: ${(browserDiag.capturedUrl as string).substring(0, 300)}`);
      }
      delete generateResult.__browser_diag;
    }

    const browserRetStr = JSON.stringify(generateResult).substring(0, 500);
    fileLog(taskId, `浏览器代理返回: ${browserRetStr}`);

    // 3018 降级到直连
    if (String(generateResult.ret) === "3018") {
      fileLog(taskId, `⚠ 浏览器代理返回 3018，尝试直连...`);
      throw new Error("browser_3018");
    }
  } catch (browserErr) {
    const browserErrMsg = (browserErr as Error).message;
    if (browserErrMsg !== "browser_3018") {
      fileLog(taskId, `浏览器代理失败: ${browserErrMsg}`);
    }

    // 路径2: 直连（不含 a_bogus，大概率 ret=1000 但作为兜底）
    fileLog(taskId, `>>> 路径2: 直连请求 (headers + Sign)...`);
    try {
      const directResult = await jimengRequest("post", "/mweb/v1/aigc_draft/generate", sessionId, webId, userId, {
        params: {
          da_version: JIMENG_IMAGE_DRAFT_VERSION,
          aigc_features: "app_lip_sync",
        },
        data: generateBody as unknown as Record<string, unknown>,
      });
      generateResult = directResult;
      if (directResult && (directResult as Record<string, unknown>).aigc_data) {
        generateResult = { ret: "0", data: directResult };
      }
      fileLog(taskId, `✅ 直连请求返回: ${JSON.stringify(generateResult).substring(0, 500)}`);
    } catch (directErr) {
      const directErrMsg = (directErr as Error).message;
      fileLog(taskId, `❌ 直连也失败: ${directErrMsg}`);
      if (browserErrMsg === "browser_3018") {
        throw new Error(`即梦权限拒绝 (ret=3018)。\n可能原因：\n1) Cookie 已过期或不完整，请重新从即梦网站复制完整 Cookie\n2) 请打开「设置」→ 粘贴即梦完整 Cookie`);
      }
      throw new Error(`即梦请求失败: 浏览器代理(${browserErrMsg}) + 直连(${directErrMsg})`);
    }
  }

  const resultStr = JSON.stringify(generateResult);
  fileLog(taskId, `返回 (${resultStr.length}字): ${resultStr.substring(0, 1000)}`);

  // 检查错误
  if (generateResult.ret !== undefined && String(generateResult.ret) !== "0") {
    const retCode = String(generateResult.ret);
    const errMsg = (generateResult.errmsg as string) || retCode;
    fileLog(taskId, `❌ API错误 ret=${retCode}: ${errMsg}`);
    if (retCode === "5000") throw new Error("即梦积分不足，请前往即梦官网领取积分");
    if (retCode === "3018") {
      cachedImageBenefitType = null;
      throw new Error(`即梦权限拒绝 (ret=3018)。\n可能原因：\n1) Cookie 已过期或不完整，请重新从即梦网站复制完整 Cookie\n2) 请打开「设置」→ 粘贴即梦完整 Cookie`);
    }
    const err = new Error(`即梦API错误 (ret=${retCode}): ${errMsg}`);
    (err as Error & { failCode: number }).failCode = parseInt(retCode);
    throw err;
  }

  const aigcData = (generateResult.data as Record<string, unknown>)?.aigc_data as Record<string, unknown>;
  const historyId = aigcData?.history_record_id as string;
  if (!historyId) {
    fileLog(taskId, `❌ 未获取到 historyId`);
    throw new Error("未获取到记录ID");
  }

  fileLog(taskId, `✅ 生成请求已提交, historyId: ${historyId}`);

  // 第3步: 轮询获取结果
  const task = tasks.get(taskId);
  if (task) task.status = "polling";
  await new Promise((r) => setTimeout(r, 3000));

  // 即梦状态码: 20=排队, 42=处理中, 50=成功, 30=失败
  let status = 0;
  let failCode: number | undefined;
  let itemList: Record<string, unknown>[] = [];
  const maxRetries = 60; // 最多轮询60次，覆盖5分钟+

  for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
    try {
      const result = await jimengRequest("post", "/mweb/v1/get_history_by_ids", sessionId, webId, userId, {
        data: { history_ids: [historyId] },
      });

      const historyList = result?.history_list as Record<string, unknown>[] | undefined;
      const historyData = historyList?.[0] || (result as Record<string, Record<string, unknown>>)?.[historyId];

      if (!historyData) {
        fileLog(taskId, `轮询 #${retryCount + 1}: 无数据，等待重试...`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      status = historyData.status as number;
      failCode = historyData.fail_code as number | undefined;
      itemList = (historyData.item_list as Record<string, unknown>[]) || [];

      const elapsed = Math.floor((Date.now() - (task?.startTime || Date.now())) / 1000);
      fileLog(taskId, `轮询 #${retryCount + 1}: status=${status}, items=${itemList.length}, ${elapsed}秒`);

      // 终态: 成功（50）
      if (status === 50) {
        break;
      }

      // 终态: 失败（30）
      if (status === 30) {
        const err = new Error(
          failCode === 2038
            ? "内容被安全审核过滤，请修改提示词后重试"
            : failCode === 4011
            ? "图片未通过安全审核（错误码4011），请调整生成参数或提示词"
            : `图片生成失败，错误码: ${failCode}`,
        );
        (err as Error & { failCode: number }).failCode = failCode || 0;
        throw err;
      }

      // 非终态（20=排队, 42=处理中, 其他）继续轮询
      if (task) task.progress = `AI正在生成图片...（${elapsed}秒, status=${status}）`;
      await new Promise((r) => setTimeout(r, Math.min(3000 + retryCount * 500, 6000)));
    } catch (error: unknown) {
      const err = error as Error & { failCode?: number };
      if (err.message?.includes("安全审核") || err.message?.includes("生成失败")) throw err;
      fileLog(taskId, `轮询异常: ${err.message}, 重试...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  if (status !== 50) throw new Error(`图片生成超时或未完成 (最终status=${status})，请稍后重试`);

  // 第4步: 提取图片URL
  const results: JimengImageResult[] = [];
  for (let i = 0; i < itemList.length; i++) {
    const item = itemList[i];
    const imageObj = item?.image as Record<string, unknown> | undefined;
    const largeImage = imageObj?.large_images as Record<string, unknown>[] | undefined;

    let imageUrl: string | undefined;
    let imgWidth = width;
    let imgHeight = height;

    if (largeImage && largeImage.length > 0) {
      imageUrl = largeImage[0]?.image_url as string || largeImage[0]?.url as string;
      imgWidth = (largeImage[0]?.width as number) || width;
      imgHeight = (largeImage[0]?.height as number) || height;
    }

    if (!imageUrl) {
      imageUrl = imageObj?.image_url as string || imageObj?.url as string;
      imgWidth = (imageObj?.width as number) || width;
      imgHeight = (imageObj?.height as number) || height;
    }

    if (!imageUrl) {
      const itemStr = JSON.stringify(item);
      const urlMatch = itemStr.match(/https:\/\/[^"\\]+\.(png|jpg|jpeg|webp)/i);
      if (urlMatch) imageUrl = urlMatch[0];
    }

    if (imageUrl) {
      results.push({ url: imageUrl, width: imgWidth, height: imgHeight, index: i });
    }
  }

  fileLog(taskId, `✅ 生成完成: ${results.length} 张图片`);
  return results;
}
