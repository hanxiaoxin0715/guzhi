/**
 * 贞贞工坊 — 参考图 → 视频 → Sora 角色 全自动流水线
 *
 * 流程：
 * 1. 将参考图上传到贞贞文件服务 (/v1/files) 获取 URL
 * 2. 提交图生视频任务 (/v2/videos/generations)
 * 3. 轮询视频生成状态直到完成
 * 4. 用生成的视频 URL 创建 Sora 角色 (/sora/v1/characters)
 * 5. 返回角色信息
 *
 * POST /api/zhenzhen/img2char
 * Body: { apiKey, baseUrl?, imageData (data:URL or http URL), category, nickname, model? }
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 视频生成可能需要 5 分钟

const DEFAULT_BASE = "https://ai.t8star.cn";

interface Img2CharRequest {
  apiKey: string;
  baseUrl?: string;
  /** 参考图（data:URL 或 http URL） */
  imageData: string;
  /** 角色分类 */
  category?: "character" | "scene" | "prop";
  /** 备注名 */
  nickname?: string;
  /** 图生视频使用的模型（默认 sora-2） */
  model?: string;
}

/**
 * 上传 data:URL 到贞贞文件服务，返回 HTTP URL
 */
async function uploadImage(base: string, apiKey: string, dataUrl: string): Promise<string> {
  if (dataUrl.startsWith("http://") || dataUrl.startsWith("https://")) return dataUrl;

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("无效的图片格式");

  const buf = Buffer.from(match[2], "base64");
  const ext = match[1].includes("png") ? "png" : "jpg";
  const blob = new Blob([buf], { type: match[1] });
  const form = new FormData();
  form.append("file", blob, `ref-image.${ext}`);
  form.append("purpose", "file-extract");

  const res = await fetch(`${base}/v1/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`图片上传失败 (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const url = data.url || data.data?.url || data.download_url || "";
  if (url) return url;
  if (data.id) return data.id; // 部分 API 返回 file ID
  throw new Error("图片上传成功但未返回 URL");
}

/**
 * 提交图生视频任务并轮询直到完成
 */
async function generateVideo(
  base: string, apiKey: string, imageUrl: string, model: string
): Promise<{ videoUrl: string; taskId: string }> {
  const submitUrl = `${base}/v2/videos/generations`;

  // 提交任务
  const body = {
    prompt: "Generate a short smooth video that showcases this subject clearly with gentle motion",
    model,
    images: [imageUrl],
    duration: 5, // 最短时长，节省积分
    watermark: false,
  };

  console.log(`[img2char] → 提交视频任务: model=${model}`);

  const submitRes = await fetch(submitUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => "");
    throw new Error(`视频提交失败 (${submitRes.status}): ${errText.slice(0, 300)}`);
  }

  const submitData = await submitRes.json();
  const taskId = submitData.task_id || submitData.id || submitData.data?.task_id || "";

  // 检查是否直接返回了视频（同步模式）
  const directUrl = submitData.data?.output || submitData.data?.outputs?.[0] || "";
  if (directUrl) {
    console.log(`[img2char] ✓ 视频直接返回: ${directUrl.slice(0, 80)}`);
    return { videoUrl: directUrl, taskId: taskId || "" };
  }

  if (!taskId) {
    throw new Error("视频 API 未返回 task_id，请检查模型和 API Key");
  }

  // 轮询
  console.log(`[img2char] 视频任务已提交: task_id=${taskId}, 开始轮询...`);
  const queryUrl = `${base}/v2/videos/generations/${taskId}`;
  const maxAttempts = 120; // 最长 10 分钟（120 × 5s）
  const pollInterval = 5000;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, pollInterval));

    try {
      const pollRes = await fetch(queryUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30000),
      });

      if (!pollRes.ok) continue;

      const pollData = await pollRes.json();
      const status = (pollData.status || "").toUpperCase();
      console.log(`[img2char] 轮询 ${i + 1}/${maxAttempts}: status=${status}`);

      if (status === "FAILURE" || status === "FAILED" || status === "ERROR") {
        const msg = pollData.error || pollData.message || "视频生成失败";
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg).slice(0, 300));
      }

      if (status === "SUCCESS") {
        const videoUrl = pollData.data?.output
          || pollData.data?.outputs?.[0]
          || pollData.video_url || pollData.url || "";
        if (videoUrl) {
          console.log(`[img2char] ✓ 视频生成完成: ${videoUrl.slice(0, 80)}`);
          return { videoUrl, taskId };
        }
        // 深度搜索 URL
        const jsonStr = JSON.stringify(pollData);
        const deepMatch = jsonStr.match(/"(https?:\/\/[^"]+\.(mp4|webm|mov)[^"]*)"/i);
        if (deepMatch) return { videoUrl: deepMatch[1], taskId };
        throw new Error("视频生成成功但未找到 URL");
      }
    } catch (e) {
      if (e instanceof Error && (e.message.includes("失败") || e.message.includes("URL"))) throw e;
      // 网络波动，继续轮询
    }
  }

  throw new Error("视频生成超时（10分钟未完成）");
}

/**
 * 从视频中提取 Sora 角色
 */
async function extractCharacter(
  base: string, apiKey: string, videoUrl: string
): Promise<{ id: string; username: string; profilePicture: string; permalink: string }> {
  const endpoint = `${base}/sora/v1/characters`;

  console.log(`[img2char] → 提取角色: url=${videoUrl.slice(0, 80)}`);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ timestamps: "1,3", url: videoUrl }),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    let hint = "";
    if (res.status === 401) hint = "（需要 sora2-vip 分组）";
    throw new Error(`角色提取失败 (${res.status}): ${errText.slice(0, 200)} ${hint}`.trim());
  }

  const data = await res.json();
  if (!data.id || !data.username) {
    throw new Error("角色提取响应无效: " + JSON.stringify(data).slice(0, 200));
  }

  console.log(`[img2char] ✓ 角色提取成功: @${data.username}`);

  return {
    id: data.id,
    username: data.username,
    profilePicture: data.profile_picture_url || "",
    permalink: data.permalink || "",
  };
}

export async function POST(request: Request) {
  try {
    const body: Img2CharRequest = await request.json();
    const { apiKey, imageData, category, nickname } = body;
    const base = (body.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
    // 使用 sora-2 模型（因为角色提取只支持 Sora 生成的视频）
    const model = body.model || "sora-2";

    if (!apiKey) {
      return NextResponse.json({ error: "缺少 apiKey" }, { status: 400 });
    }
    if (!imageData) {
      return NextResponse.json({ error: "缺少参考图" }, { status: 400 });
    }

    // ── Step 1: 上传图片 ──
    console.log(`[img2char] 开始流水线: model=${model}, category=${category || "character"}`);
    let imageUrl: string;
    try {
      imageUrl = await uploadImage(base, apiKey, imageData);
      console.log(`[img2char] ✓ 图片已上传: ${imageUrl.slice(0, 80)}`);
    } catch (e) {
      return NextResponse.json(
        { error: `图片上传失败: ${e instanceof Error ? e.message : "未知错误"}`, step: "upload" },
        { status: 500 }
      );
    }

    // ── Step 2: 图生视频 ──
    let videoResult: { videoUrl: string; taskId: string };
    try {
      videoResult = await generateVideo(base, apiKey, imageUrl, model);
    } catch (e) {
      return NextResponse.json(
        { error: `视频生成失败: ${e instanceof Error ? e.message : "未知错误"}`, step: "video" },
        { status: 500 }
      );
    }

    // ── Step 3: 提取角色 ──
    let charData: { id: string; username: string; profilePicture: string; permalink: string };
    try {
      charData = await extractCharacter(base, apiKey, videoResult.videoUrl);
    } catch (e) {
      return NextResponse.json(
        {
          error: `角色提取失败: ${e instanceof Error ? e.message : "未知错误"}`,
          step: "character",
          videoUrl: videoResult.videoUrl, // 返回视频 URL 以便用户手动重试
        },
        { status: 500 }
      );
    }

    // ── 成功 ──
    return NextResponse.json({
      id: charData.id,
      username: charData.username,
      profile_picture_url: charData.profilePicture,
      permalink: charData.permalink,
      videoUrl: videoResult.videoUrl,
      category: category || "character",
      nickname: nickname || "",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "未知错误";
    console.error(`[img2char] 流水线异常: ${msg}`);
    return NextResponse.json({ error: `服务端错误: ${msg}` }, { status: 500 });
  }
}
