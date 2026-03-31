/**
 * POST /api/seedance/generate
 * 提交 Seedance 视频生成任务，立即返回 taskId
 */

import { NextRequest, NextResponse } from "next/server";
import {
  createTaskId,
  setTask,
  generateSeedanceVideo,
} from "@/app/lib/seedance/jimeng-api";
import type { SeedanceTask } from "@/app/lib/seedance/types";

export async function POST(request: NextRequest) {
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "请求格式错误，需要 multipart/form-data" },
        { status: 400 },
      );
    }

    const prompt = (formData.get("prompt") as string) || "";
    const model = (formData.get("model") as string) || "seedance-2.0";
    const ratio = (formData.get("ratio") as string) || "4:3";
    const duration = parseInt((formData.get("duration") as string) || "4") || 4;
    const quality = (formData.get("quality") as string) || "720P";
    const referenceMode = (formData.get("referenceMode") as string) || "全能参考";
    const sessionId = formData.get("sessionId") as string;
    const webId = formData.get("webId") as string;
    const userId = formData.get("userId") as string;

    // 认证检查
    if (!sessionId || !webId || !userId) {
      return NextResponse.json(
        { error: "请完整填写 sessionId、_tea_web_id 和 uid_tt" },
        { status: 401 },
      );
    }

    // 收集上传的文件
    const files: { buffer: Buffer; originalname: string; size: number; mimetype: string }[] = [];
    const fileEntries = formData.getAll("files");
    for (const entry of fileEntries) {
      if (entry instanceof File) {
        const arrayBuffer = await entry.arrayBuffer();
        files.push({
          buffer: Buffer.from(arrayBuffer),
          originalname: entry.name,
          size: entry.size,
          mimetype: entry.type,
        });
      }
    }

    // ── 即梦官网上传限制（Seedance 2.0）──
    //   图片: jpeg/png/webp/bmp/tiff/gif, 单文件 < 30MB, 最多 9 张
    //   视频: mp4/mov, 单文件 < 50MB, 最多 3 个, 时长 2~15s
    //   音频: mp3/wav, 单文件 < 15MB, 最多 3 个, 时长 ≤15s
    //   混合上传总数: 最多 12 个（图+视频+音频）
    // ──────────────────────────────────────

    // 需要至少一张图片
    if (files.length === 0) {
      return NextResponse.json(
        { error: "需要至少上传一张参考图片" },
        { status: 400 },
      );
    }

    if (files.length > 9) {
      return NextResponse.json(
        { error: "最多上传 9 个参考文件" },
        { status: 400 },
      );
    }

    // 按文件类型区分大小限制（与即梦官网同步：图片30MB / 视频50MB / 音频15MB）
    for (const f of files) {
      const isVideo = f.mimetype.startsWith("video/");
      const isAudio = f.mimetype.startsWith("audio/");
      const sizeLimit = isVideo ? 50 : isAudio ? 15 : 30; // MB
      if (f.size > sizeLimit * 1024 * 1024) {
        const typeLabel = isVideo ? "视频" : isAudio ? "音频" : "图片";
        return NextResponse.json(
          { error: `文件「${f.originalname}」超过 ${sizeLimit}MB（${typeLabel}限制）` },
          { status: 413 },
        );
      }
    }

    // 创建任务
    const taskId = createTaskId();
    const startTime = Date.now();
    const task: SeedanceTask = {
      id: taskId,
      status: "processing",
      progress: "正在准备...",
      startTime,
      result: null,
      error: null,
    };
    setTask(taskId, task);

    console.log(`\n========== [${taskId}] 收到视频生成请求 ==========`);
    console.log(`  prompt: ${prompt.substring(0, 80)}${prompt.length > 80 ? "..." : ""}`);
    console.log(`  model: ${model}, ratio: ${ratio}, duration: ${duration}秒, quality: ${quality}`);
    console.log(`  files: ${files.length}张`);
    files.forEach((f, i) => {
      console.log(`  file[${i}]: ${f.originalname} (${f.mimetype}, ${(f.size / 1024).toFixed(1)}KB)`);
    });

    // 后台异步执行视频生成（不阻塞响应）
    generateSeedanceVideo(taskId, {
      prompt,
      ratio,
      duration,
      quality,
      referenceMode,
      files,
      sessionId,
      webId,
      userId,
      model,
    })
      .then((videoUrl) => {
        task.status = "done";
        task.result = {
          created: Math.floor(Date.now() / 1000),
          data: [{ url: videoUrl, revised_prompt: prompt || "" }],
        };
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`========== [${taskId}] ✅ 视频生成成功 (${elapsed}秒) ==========\n`);
      })
      .catch((err: Error) => {
        task.status = "error";
        task.error = err.message || "视频生成失败";
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error(`========== [${taskId}] ❌ 视频生成失败 (${elapsed}秒): ${err.message} ==========\n`);
      });

    // 立即返回 taskId
    return NextResponse.json({ taskId });
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`请求处理错误: ${err.message}`);
    return NextResponse.json(
      { error: err.message || "服务器内部错误" },
      { status: 500 },
    );
  }
}
