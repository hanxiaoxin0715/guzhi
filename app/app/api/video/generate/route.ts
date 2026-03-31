import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Video generation can take up to 5 minutes

interface VideoGenerateRequest {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  inputImage: string;
  endImage?: string;
  referenceImages?: string[];
  duration?: number;
  ratio?: string;
  resolution?: string;
  motionStrength?: number;
  mode: "single" | "firstlast" | "multiref";
  provider: "third-party" | "official";
  testOnly?: boolean;  // For model testing: just validate the connection
}

/**
 * Convert ratio string (e.g. "16:9") to pixel size (e.g. "1280x720")
 * Resolution (480p/720p/1080p/4K) refers to the shorter side of the video.
 */
function ratioToSize(ratio: string, resolution: string): string {
  const resMap: Record<string, number> = { "480p": 480, "720p": 720, "1080p": 1080, "4K": 2160 };
  const shortSide = resMap[resolution] || 720;

  const [wRatio, hRatio] = (ratio || "16:9").split(":").map(Number);
  if (!wRatio || !hRatio) return `${Math.round(shortSide * 16 / 9)}x${shortSide}`;

  const isPortrait = wRatio < hRatio;
  let w: number, h: number;
  if (isPortrait) {
    // Portrait: width is the shorter side
    w = shortSide;
    h = Math.round(shortSide * hRatio / wRatio);
  } else {
    // Landscape or square: height is the shorter side
    h = shortSide;
    w = Math.round(shortSide * wRatio / hRatio);
  }
  // Round to nearest multiple of 8 for video encoding
  const w8 = Math.round(w / 8) * 8;
  const h8 = Math.round(h / 8) * 8;
  return `${w8}x${h8}`;
}

/**
 * Sora models only support specific fixed sizes through third-party APIs.
 * Returns true if the model is a sora variant.
 */
function isSoraModel(model: string): boolean {
  return model.toLowerCase().includes("sora");
}

/**
 * Map ratio to sora-supported fixed sizes.
 * Sora-2 only accepts: 1920x1080, 1080x1920, 1080x1080 (and a few others).
 * We pick the closest match based on the user-selected aspect ratio.
 */
function soraSize(ratio: string): string {
  const [w, h] = (ratio || "16:9").split(":").map(Number);
  if (!w || !h) return "1920x1080";
  const aspect = w / h;
  if (aspect > 1.2) return "1920x1080";   // landscape (16:9, 3:2, etc.)
  if (aspect < 0.8) return "1080x1920";   // portrait (9:16, 2:3, etc.)
  return "1080x1080";                      // square-ish (1:1, 4:3, 3:4)
}

/**
 * Doubao (豆包) models accept ratio strings as size, NOT pixel dimensions.
 * Valid values: "16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "keep_ratio", "adaptive"
 */
function isDoubaoModel(model: string): boolean {
  return model.toLowerCase().includes("doubao") || model.toLowerCase().includes("seedance");
}

/**
 * GeeKnow Grok 视频模型（grok-video-3 / grok-video-3-pro）
 * 接口与其他第三方模型的区别：
 * - size 参数要求 "720P" / "1080P" 字符串，而非像素尺寸
 * - 额外发送 aspect_ratio 参数（"2:3", "3:2", "1:1"）
 * - seconds 固定值（grok-video-3=6, grok-video-3-pro=10）
 */
function isGrokVideoModel(model: string): boolean {
  return model.toLowerCase().startsWith("grok-video");
}

/**
 * 阿里万象 wan2.6 视频模型
 * 模型名格式: wan2.6-t2v:1280*720 / wan2.6-i2v:1920*1080
 * 接口要求 JSON body（非 multipart），seconds 为字符串类型
 */
function isWanModel(model: string): boolean {
  return model.startsWith("wan2.6-");
}

/**
 * 解析 wan2.6 模型名，提取实际模型名和分辨率
 * "wan2.6-i2v:1280*720" → { model: "wan2.6-i2v", size: "1280*720" }
 */
function parseWanModel(model: string): { model: string; size: string } {
  if (model.includes(":")) {
    const [m, s] = model.split(":", 2);
    return { model: m, size: s };
  }
  return { model, size: "1280*720" };
}

/**
 * 可灵 Kling 视频模型
 * 额外需要 duration 和 audio/enable_audio 字段
 */
function isKlingModel(model: string): boolean {
  return model.startsWith("Kling-");
}

/**
 * 检测是否为 GeeKnow 中转平台
 */
function isGeeknowApi(baseUrl: string): boolean {
  return baseUrl.includes("geeknow.top") || baseUrl.includes("closeai.icu");
}

/**
 * 检测是否为 Veo 系列模型
 */
function isVeoModel(model: string): boolean {
  return model.toLowerCase().startsWith("veo");
}

/**
 * GeeKnow Veo 模型名转换：
 * - firstlast 模式: veo_3_1 → veo_3_1-fl
 * - multiref 模式: veo_3_1 → veo3.1-components / veo_3_1-fast → veo3.1-fast-components
 */
function geeknowVeoModelName(model: string, mode: string): string {
  if (mode === "firstlast") {
    return model.endsWith("-fl") ? model : `${model}-fl`;
  }
  if (mode === "multiref") {
    if (model === "veo_3_1") return "veo3.1-components";
    if (model === "veo_3_1-fast") return "veo3.1-fast-components";
    return model.endsWith("-components") ? model : `${model}-components`;
  }
  return model;
}

/**
 * 将用户选择的宽高比映射到 Grok 支持的 aspect_ratio
 * Grok 仅支持: 2:3, 3:2, 1:1
 */
function grokAspectRatio(ratio: string): string {
  const [w, h] = (ratio || "16:9").split(":").map(Number);
  if (!w || !h) return "3:2";
  const aspect = w / h;
  if (aspect > 1.2) return "3:2";   // 横屏（16:9, 4:3 等）
  if (aspect < 0.8) return "2:3";   // 竖屏（9:16, 3:4 等）
  return "1:1";                      // 方形（1:1）
}

/**
 * 将分辨率设置映射到 Grok 支持的 size 字符串
 */
function grokSize(resolution: string): string {
  if (resolution === "1080p" || resolution === "4K") return "1080P";
  return "720P";
}

/**
 * Fetch an image URL and return an ArrayBuffer (for form-data upload)
 */
async function fetchImageBuffer(url: string): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  try {
    if (url.startsWith("data:")) {
      // Base64 data URL
      const match = url.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return null;
      const buf = Buffer.from(match[2], "base64");
      return { buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, contentType: match[1] };
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return { buffer: ab, contentType: res.headers.get("content-type") || "image/jpeg" };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body: VideoGenerateRequest = await request.json();
    const {
      apiKey, baseUrl, model, prompt, inputImage,
      endImage, referenceImages, duration, ratio, resolution,
      motionStrength, mode, provider, testOnly,
    } = body;

    if (!apiKey || (!model && !baseUrl?.includes("t8star.cn"))) {
      return NextResponse.json(
        { error: "缺少必要参数: apiKey, model" },
        { status: 400 }
      );
    }

    if (!inputImage && mode !== "multiref" && !testOnly) {
      return NextResponse.json(
        { error: "缺少输入图片" },
        { status: 400 }
      );
    }

    // Clean base URL: remove trailing slashes, handle /v1 suffix
    let cleanBase = (baseUrl || "").replace(/\/+$/, "");

    // grok-imagine 模型使用 chat/completions 接口（非 /v1/videos），
    // 无论 provider 配置为什么，都自动走官方路径
    const isGrokImagine = model.toLowerCase().startsWith("grok-imagine");
    const effectiveProvider = isGrokImagine ? "official" : provider;

    // ═══════════════════════════════════════════════════════════
    // 贞贞的AI工坊 — 统一格式接口 v2
    // Uses: POST {baseUrl}/v2/videos/generations  (JSON body)
    // Poll: GET {baseUrl}/v2/videos/generations/:task_id
    // Docs: https://ai.t8star.cn/api-set
    // ═══════════════════════════════════════════════════════════
    const isZhenzhenApi = cleanBase.includes("t8star.cn");

    if (isZhenzhenApi && effectiveProvider === "third-party") {
      const zzBase = cleanBase.replace(/\/+$/, "");
      const submitUrl = `${zzBase}/v2/videos/generations`;
      const queryUrl = (taskId: string) => `${zzBase}/v2/videos/generations/${taskId}`;

      // ── 测试连接 ──
      if (testOnly) {
        try {
          const testBody = { prompt: "test", model: model || "doubao-seedance-1-0-pro-250528", duration: 5 };
          const testRes = await fetch(submitUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(testBody),
            signal: AbortSignal.timeout(30000),
          });
          if (testRes.status === 401 || testRes.status === 403) {
            const errText = await testRes.text().catch(() => "");
            return NextResponse.json({ error: `API Key 认证失败 (${testRes.status}): ${errText.slice(0, 200)}` }, { status: testRes.status });
          }
          if (testRes.status >= 500) {
            const errText = await testRes.text().catch(() => "");
            return NextResponse.json({ error: `服务端错误 (${testRes.status}): ${errText.slice(0, 200)}` }, { status: testRes.status });
          }
          return NextResponse.json({ success: true, message: `贞贞工坊连接成功 (${testRes.status})`, endpoint: submitUrl });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "未知错误";
          return NextResponse.json({ error: `网络连接失败: ${msg}` }, { status: 500 });
        }
      }

      // ── 上传参考图：data:URL → 贞贞文件上传 → HTTP URL ──
      async function uploadToZhenzhen(dataUrl: string): Promise<string> {
        // 如果已经是 HTTP URL，直接返回
        if (dataUrl.startsWith("http://") || dataUrl.startsWith("https://")) return dataUrl;
        // data:URL → 上传到 /v1/files
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) return dataUrl;
        const buf = Buffer.from(match[2], "base64");
        const ext = match[1].includes("png") ? "png" : "jpg";
        const blob = new Blob([buf], { type: match[1] });
        const form = new FormData();
        form.append("file", blob, `image.${ext}`);
        form.append("purpose", "file-extract");
        try {
          const uploadRes = await fetch(`${zzBase}/v1/files`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
            signal: AbortSignal.timeout(60000),
          });
          if (uploadRes.ok) {
            const fileData = await uploadRes.json();
            // 返回文件 URL 或 ID（取决于 API 返回）
            const fileUrl = fileData.url || fileData.data?.url || fileData.download_url || "";
            if (fileUrl) return fileUrl;
            // 有些 API 返回 file ID，格式化为引用
            if (fileData.id) return fileData.id;
          }
          console.log(`[Video API] 贞贞文件上传失败: ${uploadRes.status}`);
        } catch (e) {
          console.log(`[Video API] 贞贞文件上传异常:`, e instanceof Error ? e.message : e);
        }
        // 上传失败，尝试直接发送 data:URL（部分 API 支持）
        return dataUrl;
      }

      // ── 构建图片数组 ──
      const images: string[] = [];
      if (inputImage) {
        images.push(await uploadToZhenzhen(inputImage));
      }
      if (endImage && mode === "firstlast") {
        images.push(await uploadToZhenzhen(endImage));
      }
      if (referenceImages && mode === "multiref") {
        for (const ref of referenceImages.slice(0, 5)) {
          images.push(await uploadToZhenzhen(ref));
        }
      }

      // ── 构建请求体 ──
      // model 为空时使用默认 Seedance Pro（贞贞工坊允许空 model 保存）
      const zzModel = model || "doubao-seedance-1-0-pro-250528";
      const zzBody: Record<string, unknown> = {
        prompt: prompt || "生成一段自然流畅的视频",
        model: zzModel,
        watermark: false,
      };
      if (images.length > 0) zzBody.images = images;
      if (duration) zzBody.duration = duration;
      if (resolution) zzBody.resolution = resolution;
      if (ratio) zzBody.ratio = ratio;

      const imgInfo = images.length > 0 ? `${images.length}张(${images.map(u => u.startsWith("http") ? "url" : "data").join(",")})` : "无";
      console.log(`[Video API] → 贞贞v2路径: POST ${submitUrl}, model=${model}, duration=${duration}, resolution=${resolution}, ratio=${ratio}, images=${imgInfo}`);

      // ── 提交任务 ──
      const submitRes = await fetch(submitUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(zzBody),
        signal: AbortSignal.timeout(60000),
      });

      if (!submitRes.ok) {
        const errText = await submitRes.text().catch(() => "");
        console.error(`[Video API] 贞贞提交错误: ${submitRes.status}:`, errText.slice(0, 500));
        return NextResponse.json(
          { error: `贞贞工坊 API 错误 (${submitRes.status}): ${errText.slice(0, 500)}`, errorPath: "zhenzhen-v2", requestUrl: submitUrl },
          { status: submitRes.status }
        );
      }

      const submitData = await submitRes.json();
      console.log("[Video API] 贞贞提交响应:", JSON.stringify(submitData).slice(0, 500));

      const taskId = submitData.task_id || submitData.id || submitData.data?.task_id || "";
      if (!taskId) {
        // 检查是否直接返回了视频 URL
        const directUrl = submitData.data?.output || submitData.data?.outputs?.[0] || submitData.video_url || "";
        if (directUrl) {
          return NextResponse.json({ videoUrl: directUrl, thumbnailUrl: inputImage || "", apiTaskId: "" });
        }
        return NextResponse.json({
          videoUrl: "", thumbnailUrl: "", rawResponse: submitData,
          message: "贞贞工坊未返回 task_id，请检查模型是否正确",
        }, { status: 422 });
      }

      // ── 轮询任务状态 ──
      console.log(`[Video API] 贞贞异步任务: task_id=${taskId}, 开始轮询...`);
      const maxAttempts = 360;    // 最长 30 分钟（360 × 5s）
      const pollInterval = 5000;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));

        try {
          const pollRes = await fetch(queryUrl(taskId), {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(30000),
          });

          if (!pollRes.ok) {
            console.log(`[Video API] 贞贞轮询 ${attempt + 1}/${maxAttempts}: status=${pollRes.status}`);
            continue;
          }

          const pollData = await pollRes.json();
          const pStatus = (pollData.status || "").toUpperCase();
          console.log(`[Video API] 贞贞轮询 ${attempt + 1}/${maxAttempts}: status=${pStatus}`);

          if (pStatus === "FAILURE" || pStatus === "FAILED" || pStatus === "ERROR") {
            const errMsg = pollData.error || pollData.message || pollData.data?.error || "任务失败";
            return NextResponse.json({
              videoUrl: "", thumbnailUrl: "", rawResponse: pollData,
              message: `贞贞视频生成失败: ${typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg).slice(0, 300)}`,
            }, { status: 422 });
          }

          if (pStatus === "SUCCESS") {
            const videoUrl = pollData.data?.output
              || pollData.data?.outputs?.[0]
              || pollData.video_url || pollData.url || "";

            if (videoUrl) {
              console.log(`[Video API] 贞贞视频完成! url=${videoUrl.slice(0, 100)}`);
              return NextResponse.json({ videoUrl, thumbnailUrl: inputImage || "", apiTaskId: taskId });
            }

            // SUCCESS 但没找到 URL，深度搜索
            const jsonStr = JSON.stringify(pollData);
            const deepMatch = jsonStr.match(/"(https?:\/\/[^"]+\.(mp4|webm|mov)[^"]*)"/i);
            if (deepMatch) {
              console.log(`[Video API] 贞贞深度搜索找到视频: ${deepMatch[1].slice(0, 100)}`);
              return NextResponse.json({ videoUrl: deepMatch[1], thumbnailUrl: inputImage || "", apiTaskId: taskId });
            }

            return NextResponse.json({
              videoUrl: "", thumbnailUrl: "", rawResponse: pollData,
              message: "贞贞视频生成成功但未找到视频 URL",
            }, { status: 422 });
          }

          // IN_PROGRESS / QUEUED / SUBMITTED / NOT_START — 继续轮询
        } catch (pollErr) {
          console.log(`[Video API] 贞贞轮询 ${attempt + 1} 异常:`, pollErr instanceof Error ? pollErr.message : pollErr);
        }
      }

      return NextResponse.json({
        videoUrl: "", thumbnailUrl: "",
        message: "贞贞视频生成超时（30分钟），任务可能仍在进行中",
      }, { status: 408 });
    }

    // ═══════════════════════════════════════════════════════════
    // Third-party provider (MagicAPI / GeeKnow etc.)
    // Uses: POST {baseUrl}/videos  with multipart/form-data
    // ═══════════════════════════════════════════════════════════
    if (effectiveProvider === "third-party") {
      // Build the video endpoint URL
      // If baseUrl already ends with /v1, use it; otherwise append /v1
      if (!cleanBase.match(/\/v1$/i)) {
        cleanBase += "/v1";
      }
      const videoUrl = `${cleanBase}/videos`;

      // For test-only mode, just do a minimal request to see if the endpoint responds
      if (testOnly) {
        try {
          const testForm = new FormData();
          testForm.append("model", model);
          testForm.append("prompt", "test connection");
          testForm.append("seconds", "3");
          testForm.append("size", "1280x720");

          const testRes = await fetch(videoUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: testForm,
            signal: AbortSignal.timeout(30000),
          });

          // Accept any response — even 400 means the endpoint is reachable
          if (testRes.status === 401 || testRes.status === 403) {
            const errText = await testRes.text().catch(() => "");
            return NextResponse.json({ error: `API Key 认证失败 (${testRes.status}): ${errText.slice(0, 200)}` }, { status: testRes.status });
          }
          if (testRes.status >= 500) {
            const errText = await testRes.text().catch(() => "");
            return NextResponse.json({ error: `服务端错误 (${testRes.status}): ${errText.slice(0, 200)}` }, { status: testRes.status });
          }

          return NextResponse.json({ success: true, message: `连接成功 (${testRes.status})`, endpoint: videoUrl });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "未知错误";
          return NextResponse.json({ error: `网络连接失败: ${msg}` }, { status: 500 });
        }
      }

      // ═══ 构建请求体（Grok/Wan 用 JSON，其他模型用 multipart/form-data） ═══
      let finalDuration = duration || 8;
      if (isDoubaoModel(model)) {
        finalDuration = Math.max(4, Math.min(finalDuration, 11));
      }
      const isGrok = isGrokVideoModel(model);
      const isWan = isWanModel(model);
      const isKling = isKlingModel(model);
      const isGeeknow = isGeeknowApi(cleanBase);
      const isVeo = isVeoModel(model);

      // GeeKnow Veo 模型名转换：firstlast 加 -fl，multiref 加 -components
      let effectiveModel = model;
      if (isVeo && isGeeknow) {
        effectiveModel = geeknowVeoModelName(model, mode);
        if (effectiveModel !== model) {
          console.log(`[Video API] GeeKnow Veo 模型名转换: ${model} → ${effectiveModel} (mode=${mode})`);
        }
        // GeeKnow Veo multiref 强制横屏
        if (mode === "multiref" && ratio && ratio !== "16:9") {
          console.log(`[Video API] GeeKnow Veo 参考生视频强制横屏 16:9`);
        }
      }

      const computedSize = isSoraModel(effectiveModel)
        ? soraSize(ratio || "16:9")
        : isDoubaoModel(effectiveModel)
        ? (ratio || "16:9")
        : isGrok
        ? grokSize(resolution || "720p")
        : isWan
        ? parseWanModel(model).size   // wan2.6 从模型名解析分辨率
        : ratioToSize(ratio || "16:9", resolution || "720p");

      let res: Response;

      if (isGrok) {
        // ─── Grok 视频模型：JSON 请求体（GeeKnow 等中转平台要求 JSON，multipart 会报 invalid_json/EOF）───
        const grokBody: Record<string, unknown> = {
          model: effectiveModel,
          prompt: prompt || "生成一段自然流畅的视频",
          seconds: String(finalDuration),
          size: computedSize,
          aspect_ratio: grokAspectRatio(ratio || "16:9"),
        };
        // 单图模式：图片以纯 base64 字符串传入（去掉 data:xxx;base64, 前缀）
        if (inputImage) {
          const b64Match = inputImage.match(/^data:[^;]+;base64,(.+)$/);
          grokBody.input_reference = b64Match ? b64Match[1] : inputImage;
        }
        // 首尾帧模式：附加尾图
        if (endImage && mode === "firstlast") {
          const b64Match = endImage.match(/^data:[^;]+;base64,(.+)$/);
          grokBody.end_reference = b64Match ? b64Match[1] : endImage;
        }
        // 多参考模式
        if (referenceImages && mode === "multiref") {
          grokBody.reference_images = referenceImages.slice(0, 5).map(ref => {
            const m = ref.match(/^data:[^;]+;base64,(.+)$/);
            return m ? m[1] : ref;
          });
        }
        const imgSizeKB = inputImage ? `${(inputImage.length / 1024).toFixed(0)}KB` : "none";
        console.log(`[Video API] → Grok JSON 路径: POST ${videoUrl}, model=${effectiveModel}, seconds=${finalDuration}, size=${computedSize}, aspect_ratio=${grokAspectRatio(ratio || "16:9")}, imagePayload=${imgSizeKB}`);

        res = await fetch(videoUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(grokBody),
          signal: AbortSignal.timeout(300000),
        });
      } else if (isWan) {
        // ─── wan2.6 模型：JSON 请求体，模型名解析分辨率 ───
        const parsed = parseWanModel(model);
        const wanBody: Record<string, unknown> = {
          model: parsed.model,
          prompt: prompt || "生成一段自然流畅的视频",
          seconds: String(finalDuration),
          size: parsed.size,
        };
        // wan2.6-i2v 支持首帧图片
        if (inputImage) {
          const b64Match = inputImage.match(/^data:[^;]+;base64,(.+)$/);
          wanBody.input_reference = b64Match ? `data:image/png;base64,${b64Match[1]}` : inputImage;
        }
        // 首尾帧模式：附加尾图
        if (endImage && mode === "firstlast") {
          const b64Match = endImage.match(/^data:[^;]+;base64,(.+)$/);
          wanBody.end_reference = b64Match ? `data:image/png;base64,${b64Match[1]}` : endImage;
        }
        const imgSizeKB = inputImage ? `${(inputImage.length / 1024).toFixed(0)}KB` : "none";
        console.log(`[Video API] → Wan2.6 JSON 路径: POST ${videoUrl}, model=${parsed.model}, size=${parsed.size}, seconds=${finalDuration}, imagePayload=${imgSizeKB}`);

        res = await fetch(videoUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(wanBody),
          signal: AbortSignal.timeout(300000),
        });
      } else {
        // ─── 其他模型：multipart/form-data（VEO / Sora / Doubao / Kling / Vidu / Hailuo 等）───
        const formData = new FormData();
        formData.append("model", effectiveModel);
        formData.append("prompt", prompt || "生成一段自然流畅的视频");
        formData.append("seconds", String(finalDuration));
        formData.append("size", computedSize);

        // Kling 模型额外字段
        if (isKling) {
          formData.append("duration", String(finalDuration));
          formData.append("audio", "true");
          formData.append("enable_audio", "true");
        }

        const isDoubao = isDoubaoModel(effectiveModel);
        const inputFieldName = isDoubao ? "first_frame_image" : "input_reference";
        const endFieldName = isDoubao ? "last_frame_image" : "end_reference";

        // 附加输入图片
        if (inputImage) {
          const imgData = await fetchImageBuffer(inputImage);
          if (imgData) {
            const ext = imgData.contentType.includes("png") ? "png" : "jpg";
            const blob = new Blob([imgData.buffer], { type: imgData.contentType });
            formData.append(inputFieldName, blob, `image.${ext}`);
          }
        }

        // 首尾帧模式：附加尾图
        if (endImage && mode === "firstlast") {
          const endData = await fetchImageBuffer(endImage);
          if (endData) {
            const ext = endData.contentType.includes("png") ? "png" : "jpg";
            const blob = new Blob([endData.buffer], { type: endData.contentType });
            formData.append(endFieldName, blob, `end_image.${ext}`);
          }
        }

        // 多参考模式：附加参考图
        if (referenceImages && mode === "multiref") {
          for (let i = 0; i < Math.min(referenceImages.length, 5); i++) {
            const refData = await fetchImageBuffer(referenceImages[i]);
            if (refData) {
              const ext = refData.contentType.includes("png") ? "png" : "jpg";
              const blob = new Blob([refData.buffer], { type: refData.contentType });
              formData.append(`reference_${i}`, blob, `ref_${i}.${ext}`);
            }
          }
        }

        const sizeInfo = isSoraModel(effectiveModel) ? `${computedSize}(sora-fixed)` : isDoubaoModel(effectiveModel) ? `${computedSize}(doubao-ratio)` : isKling ? `${computedSize}(kling)` : computedSize;
        const imgSizeKB = inputImage ? `${(inputImage.length / 1024).toFixed(0)}KB` : "none";
        const fieldInfo = isDoubaoModel(effectiveModel) ? `fields=first_frame_image/last_frame_image` : `fields=input_reference/end_reference`;
        console.log(`[Video API] → 第三方路径: POST ${videoUrl}, model=${effectiveModel}, seconds=${finalDuration}, size=${sizeInfo}, ${fieldInfo}, imagePayload=${imgSizeKB}`);

        res = await fetch(videoUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: formData,
          signal: AbortSignal.timeout(300000),
        });
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error(`[Video API] 第三方路径错误: POST ${videoUrl} → ${res.status}:`, errText.slice(0, 500));
        return NextResponse.json(
          { error: `第三方视频 API 错误 (${res.status}): ${errText.slice(0, 500)}`, errorPath: "third-party", requestUrl: videoUrl },
          { status: res.status }
        );
      }

      const data = await res.json();
      console.log("[Video API] Third-party response:", JSON.stringify(data).slice(0, 500));

      // Extract video URL from third-party response
      let videoResultUrl = "";
      let thumbnailUrl = "";

      // Common response formats — broadened to handle many providers:
      videoResultUrl = data.video_url || data.videoUrl || data.video
        || data.data?.video_url || data.data?.videoUrl || data.data?.url || data.data?.video
        || data.result?.video_url || data.result?.url || data.result?.video
        || data.output?.video_url || data.output?.url || data.output?.video
        || data.url || "";

      // Handle array-of-videos format: { data: { videos: [{ url }] } }
      if (!videoResultUrl && Array.isArray(data.data?.videos) && data.data.videos[0]?.url) {
        videoResultUrl = data.data.videos[0].url;
      }
      if (!videoResultUrl && Array.isArray(data.videos) && data.videos[0]?.url) {
        videoResultUrl = data.videos[0].url;
      }

      thumbnailUrl = data.thumbnail_url || data.thumbnailUrl
        || data.data?.thumbnail_url || data.data?.cover_url || data.data?.thumbnailUrl || "";

      // Try to find URL in string content
      if (!videoResultUrl && typeof data === "string") {
        const urlMatch = data.match(/https?:\/\/[^\s"'<>]+\.(mp4|webm|mov)/i);
        if (urlMatch) videoResultUrl = urlMatch[0];
      }

      // Check nested choices format (some providers wrap in OpenAI format)
      if (!videoResultUrl && data.choices?.[0]?.message?.content) {
        const content = data.choices[0].message.content;
        if (typeof content === "string") {
          // Try strict extension match first, then any URL
          const urlMatch = content.match(/https?:\/\/[^\s"'<>]+\.(mp4|webm|mov)[^\s"'<>]*/i)
            || content.match(/https?:\/\/[^\s"'<>]+/i);
          if (urlMatch) videoResultUrl = urlMatch[0];
        }
      }

      // Also try extracting URL from string response body
      if (!videoResultUrl && typeof data === "object") {
        const jsonStr = JSON.stringify(data);
        const deepMatch = jsonStr.match(/"(https?:\/\/[^"]+\.(mp4|webm|mov)[^"]*)"/i);
        if (deepMatch) videoResultUrl = deepMatch[1];
      }

      // ═══ Async polling: if response has a task ID but no video URL, poll for completion ═══
      if (!videoResultUrl) {
        const taskId = data.id || data.task_id || data.taskId || data.data?.id || data.data?.task_id || "";
        const taskStatus = data.status || data.data?.status || "";
        const isAsync = taskId && (!taskStatus || ["processing", "pending", "queued", "running", "in_progress", "submitted", "created"].includes(taskStatus));

        if (isAsync) {
          console.log(`[Video API] Async task detected: id=${taskId}, status=${taskStatus}. Starting poll...`);
          const pollUrl = `${cleanBase}/videos/${taskId}`;
          const maxAttempts = 360;   // 30 minutes max (360 * 5s)
          const pollInterval = 5000; // 5 seconds

          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));

            try {
              const pollRes = await fetch(pollUrl, {
                method: "GET",
                headers: { Authorization: `Bearer ${apiKey}` },
                signal: AbortSignal.timeout(30000),
              });

              if (!pollRes.ok) {
                console.log(`[Video API] Poll ${attempt + 1}/${maxAttempts}: status=${pollRes.status}`);
                continue;
              }

              const pollData = await pollRes.json();
              console.log(`[Video API] Poll ${attempt + 1}/${maxAttempts}:`, JSON.stringify(pollData).slice(0, 400));

              const pStatus = (pollData.status || pollData.data?.status || pollData.task_status || pollData.state || pollData.data?.state || "").toLowerCase();

              // Check if failed
              if (["failed", "error", "cancelled", "canceled", "failure"].includes(pStatus)) {
                const errMsg = pollData.error || pollData.message || pollData.data?.error || "任务失败";
                return NextResponse.json({
                  videoUrl: "",
                  thumbnailUrl: "",
                  rawResponse: pollData,
                  message: `视频生成失败: ${typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg).slice(0, 300)}`,
                }, { status: 422 });
              }

              // Check if completed
              if (["completed", "succeeded", "success", "succeed", "done", "finished", "complete"].includes(pStatus)) {
                videoResultUrl = pollData.video_url || pollData.videoUrl || pollData.video
                  || pollData.data?.video_url || pollData.data?.videoUrl || pollData.data?.url || pollData.data?.video
                  || pollData.result?.video_url || pollData.result?.url || pollData.result?.video
                  || pollData.url || "";
                thumbnailUrl = pollData.thumbnail_url || pollData.thumbnailUrl
                  || pollData.data?.thumbnail_url || pollData.data?.cover_url || pollData.data?.thumbnailUrl || thumbnailUrl;

                // Also try nested formats for completed tasks
                if (!videoResultUrl && pollData.output) {
                  videoResultUrl = pollData.output.video_url || pollData.output.url || pollData.output.video || "";
                }
                if (!videoResultUrl && pollData.result) {
                  videoResultUrl = pollData.result.video_url || pollData.result.url || pollData.result.video || "";
                }
                // Array of videos
                if (!videoResultUrl && Array.isArray(pollData.data?.videos)) {
                  videoResultUrl = pollData.data.videos[0]?.url || pollData.data.videos[0]?.video_url || "";
                }
                // Deep search: find any URL ending in video extension in JSON
                if (!videoResultUrl) {
                  const jsonStr = JSON.stringify(pollData);
                  const deepMatch = jsonStr.match(/"(https?:\/\/[^"]+\.(mp4|webm|mov)[^"]*)"/i);
                  if (deepMatch) videoResultUrl = deepMatch[1];
                }

                if (videoResultUrl) {
                  console.log(`[Video API] Poll complete! videoUrl=${videoResultUrl.slice(0, 100)}`);
                  break;
                } else {
                  console.log(`[Video API] Poll: status=${pStatus} but no video URL found. Response keys: ${Object.keys(pollData).join(",")}`);
                }
              }

              // Also check if video URL appeared even without explicit completion status
              const directUrl = pollData.video_url || pollData.videoUrl || pollData.video
                || pollData.data?.video_url || pollData.data?.url || pollData.data?.video
                || pollData.result?.video_url || pollData.result?.url || pollData.url || "";
              if (directUrl && typeof directUrl === "string" && directUrl.startsWith("http")) {
                videoResultUrl = directUrl;
                console.log(`[Video API] Found video URL during poll: ${videoResultUrl.slice(0, 100)}`);
                break;
              }
            } catch (pollErr) {
              console.log(`[Video API] Poll ${attempt + 1} error:`, pollErr instanceof Error ? pollErr.message : pollErr);
            }
          }
        }
      }

      if (!videoResultUrl) {
        return NextResponse.json({
          videoUrl: "",
          thumbnailUrl: "",
          rawResponse: data,
          message: "API返回成功但未找到视频URL，请检查API返回格式",
        }, { status: 422 });
      }

      return NextResponse.json({
        videoUrl: videoResultUrl,
        thumbnailUrl: thumbnailUrl || inputImage,
      });
    }

    // ═══════════════════════════════════════════════════════════
    // Gemini 原生视频生成（Veo 系列模型通过 generativelanguage.googleapis.com）
    // Uses: POST /v1beta/models/{model}:generateVideos → 轮询 operations/{name}
    // ═══════════════════════════════════════════════════════════
    const isGeminiNativeVideo = cleanBase.includes("generativelanguage.googleapis.com")
      || cleanBase.includes("googleapis.com");

    if (isGeminiNativeVideo) {
      const geminiVideoUrl = `${cleanBase}/v1beta/models/${model}:generateVideos`;
      console.log(`[Video API] → Gemini 原生视频路径: POST ${geminiVideoUrl}, model=${model}`);

      if (testOnly) {
        try {
          // 用 generateContent 测试连通性（generateVideos 不支持空请求）
          const testUrl = `${cleanBase}/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const testRes = await fetch(testUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: "test" }] }] }),
            signal: AbortSignal.timeout(30000),
          });
          if (testRes.status === 401 || testRes.status === 403) {
            const errText = await testRes.text().catch(() => "");
            return NextResponse.json({ error: `API Key 认证失败 (${testRes.status}): ${errText.slice(0, 200)}` }, { status: testRes.status });
          }
          return NextResponse.json({ success: true, message: `连接成功 (${testRes.status})`, endpoint: geminiVideoUrl });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "未知错误";
          return NextResponse.json({ error: `网络连接失败: ${msg}` }, { status: 500 });
        }
      }

      // 构建 Gemini generateVideos 请求体
      const geminiBody: Record<string, unknown> = {
        model: `models/${model}`,
        generateVideoConfig: {
          aspectRatio: ratio || "16:9",
          numberOfVideos: 1,
        },
      };

      // 图片 + 文字提示词
      const parts: Record<string, unknown>[] = [];
      if (inputImage) {
        const b64Match = inputImage.match(/^data:([^;]+);base64,(.+)$/);
        if (b64Match) {
          parts.push({ inlineData: { mimeType: b64Match[1], data: b64Match[2] } });
        }
      }
      parts.push({ text: prompt || "生成一段自然流畅的视频" });
      geminiBody.contents = [{ parts }];

      const imgSizeKB = inputImage ? `${(inputImage.length / 1024).toFixed(0)}KB` : "none";
      console.log(`[Video API] Gemini video: model=${model}, ratio=${ratio}, imagePayload=${imgSizeKB}`);

      const res = await fetch(`${geminiVideoUrl}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiBody),
        signal: AbortSignal.timeout(300000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error(`[Video API] Gemini 视频错误: ${res.status}:`, errText.slice(0, 500));
        return NextResponse.json(
          { error: `Gemini 视频 API 错误 (${res.status}): ${errText.slice(0, 500)}`, errorPath: "gemini-video", requestUrl: geminiVideoUrl },
          { status: res.status }
        );
      }

      const opData = await res.json();
      console.log("[Video API] Gemini video operation:", JSON.stringify(opData).slice(0, 500));

      // Gemini 返回 Long Running Operation，需要轮询
      const opName = opData.name; // e.g. "operations/xxx"
      if (!opName) {
        // 直接返回了结果（不太常见）
        const vid = opData.generatedVideos?.[0]?.video?.uri || "";
        return NextResponse.json({ videoUrl: vid, thumbnailUrl: inputImage || "" });
      }

      // 轮询 operation 直到完成
      const pollBase = `${cleanBase}/v1beta/${opName}?key=${apiKey}`;
      const maxAttempts = 360; // 最长 30 分钟（360 × 5s）
      const pollInterval = 5000;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));

        try {
          const pollRes = await fetch(pollBase, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(30000),
          });

          if (!pollRes.ok) {
            console.log(`[Video API] Gemini poll ${attempt + 1}/${maxAttempts}: status=${pollRes.status}`);
            continue;
          }

          const pollData = await pollRes.json();
          console.log(`[Video API] Gemini poll ${attempt + 1}/${maxAttempts}: done=${pollData.done}`);

          if (pollData.error) {
            return NextResponse.json({
              videoUrl: "",
              thumbnailUrl: "",
              rawResponse: pollData,
              message: `Gemini 视频生成失败: ${pollData.error.message || JSON.stringify(pollData.error).slice(0, 300)}`,
            }, { status: 422 });
          }

          if (pollData.done) {
            const videoUri = pollData.response?.generatedVideos?.[0]?.video?.uri || "";
            if (videoUri) {
              console.log(`[Video API] Gemini video complete! uri=${videoUri.slice(0, 100)}`);
              return NextResponse.json({ videoUrl: videoUri, thumbnailUrl: inputImage || "" });
            }
            // done 但没有视频
            return NextResponse.json({
              videoUrl: "",
              thumbnailUrl: "",
              rawResponse: pollData,
              message: "Gemini 视频生成完成但未返回视频 URL",
            }, { status: 422 });
          }
        } catch (pollErr) {
          console.log(`[Video API] Gemini poll ${attempt + 1} error:`, pollErr instanceof Error ? pollErr.message : pollErr);
          continue;
        }
      }

      return NextResponse.json({
        videoUrl: "",
        thumbnailUrl: "",
        message: "Gemini 视频生成超时（30分钟），请稍后在 Google AI Studio 查看结果",
      }, { status: 408 });
    }

    // ═══════════════════════════════════════════════════════════
    // Official provider / OpenAI-compatible chat completions
    // Uses: POST {baseUrl}/chat/completions with JSON body
    // ═══════════════════════════════════════════════════════════
    let chatUrl = cleanBase;
    if (!chatUrl.includes("/chat/completions")) {
      if (!chatUrl.match(/\/v1$/i)) chatUrl += "/v1";
      chatUrl += "/chat/completions";
    }
    console.log(`[Video API] → 官方路径: POST ${chatUrl}, model=${model}, provider=${provider}`);

    if (testOnly) {
      try {
        const testRes = await fetch(chatUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model, messages: [{ role: "user", content: "test" }], max_tokens: 5 }),
          signal: AbortSignal.timeout(30000),
        });
        if (testRes.status === 401 || testRes.status === 403) {
          const errText = await testRes.text().catch(() => "");
          return NextResponse.json({ error: `API Key 认证失败 (${testRes.status}): ${errText.slice(0, 200)}` }, { status: testRes.status });
        }
        return NextResponse.json({ success: true, message: `连接成功 (${testRes.status})`, endpoint: chatUrl });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "未知错误";
        return NextResponse.json({ error: `网络连接失败: ${msg}` }, { status: 500 });
      }
    }

    // Build multimodal message with image(s) + text prompt
    const contentParts: unknown[] = [];

    if (inputImage) {
      contentParts.push({ type: "image_url", image_url: { url: inputImage } });
    }
    if (endImage && mode === "firstlast") {
      contentParts.push({ type: "image_url", image_url: { url: endImage } });
    }
    if (referenceImages && mode === "multiref") {
      for (const refUrl of referenceImages.slice(0, 5)) {
        contentParts.push({ type: "image_url", image_url: { url: refUrl } });
      }
    }

    const fullPrompt = [
      prompt,
      `\n视频参数：时长${duration || 5}秒，比例${ratio || "16:9"}，分辨率${resolution || "1080p"}，运动强度${motionStrength || 50}%`,
      mode === "firstlast" ? "模式：首尾帧过渡，生成从第一张图到第二张图的平滑过渡视频" : "",
      mode === "multiref" ? "模式：多参考图融合，综合所有参考图的风格和内容生成视频" : "",
    ].filter(Boolean).join("\n");

    contentParts.push({ type: "text", text: fullPrompt });

    // grok-imagine 模型不需要 max_tokens，严格匹配 API 文档格式
    const chatBody: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: contentParts }],
      stream: false,
    };
    if (!model.toLowerCase().includes("grok")) {
      chatBody.max_tokens = 4096;
    }

    const res = await fetch(chatUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(chatBody),
      signal: AbortSignal.timeout(300000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[Video API] 官方路径错误: POST ${chatUrl} → ${res.status}:`, errText.slice(0, 500));
      return NextResponse.json(
        { error: `Chat API 错误 (${res.status}): ${errText.slice(0, 500)}`, errorPath: "official", requestUrl: chatUrl },
        { status: res.status }
      );
    }

    let data;
    try {
      const text = await res.text();
      console.log(`[Video API] Official raw (${text.length} chars):`, text.slice(0, 800));
      data = JSON.parse(text);
    } catch (parseErr) {
      console.error(`[Video API] 官方路径 JSON 解析失败:`, parseErr);
      return NextResponse.json(
        { error: `API 返回非 JSON 格式，无法解析` },
        { status: 502 }
      );
    }

    let videoUrl = "";
    let thumbnailUrl = "";

    const content = data.choices?.[0]?.message?.content;
    if (typeof content === "string") {
      // Try strict extension match first, then any URL
      const urlMatch = content.match(/https?:\/\/[^\s"'<>]+\.(mp4|webm|mov)[^\s"'<>]*/i)
        || content.match(/https?:\/\/[^\s"'<>]+/i);
      if (urlMatch) videoUrl = urlMatch[0];
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "video_url" || part.type === "video") {
          videoUrl = part.video_url?.url || part.url || "";
        }
        if (part.type === "image_url") {
          thumbnailUrl = part.image_url?.url || "";
        }
      }
    }

    // Broadened: check top-level and nested fields
    if (!videoUrl) {
      videoUrl = data.video_url || data.videoUrl || data.video
        || data.data?.video_url || data.data?.videoUrl || data.data?.url || data.data?.video
        || data.result?.video_url || data.result?.url || data.result?.video
        || data.output?.video_url || data.output?.url || data.output?.video
        || data.url || "";
    }
    // Array of videos
    if (!videoUrl && Array.isArray(data.data?.videos)) {
      videoUrl = data.data.videos[0]?.url || data.data.videos[0]?.video_url || "";
    }
    if (!videoUrl && Array.isArray(data.videos)) {
      videoUrl = data.videos[0]?.url || data.videos[0]?.video_url || "";
    }
    // Deep search: find video URL in entire JSON
    if (!videoUrl) {
      const jsonStr = JSON.stringify(data);
      const deepMatch = jsonStr.match(/"(https?:\/\/[^"]+\.(mp4|webm|mov)[^"]*)"/i);
      if (deepMatch) videoUrl = deepMatch[1];
    }

    if (!videoUrl) {
      console.log("[Video API] Official: no video URL found. Response keys:", Object.keys(data).join(","));
      return NextResponse.json({
        videoUrl: "",
        thumbnailUrl: "",
        rawResponse: data,
        message: "API返回成功但未找到视频URL，请检查API提供商的返回格式",
      }, { status: 422 });
    }

    return NextResponse.json({
      videoUrl,
      thumbnailUrl: thumbnailUrl || inputImage,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "未知错误";
    const stack = e instanceof Error ? e.stack?.slice(0, 300) : "";
    console.error(`[Video API] 未捕获异常: ${msg}`, stack);
    return NextResponse.json({ error: `服务端错误: ${msg}` }, { status: 500 });
  }
}
