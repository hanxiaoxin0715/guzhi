/**
 * GET /api/seedance/task/[taskId]
 * 轮询 Seedance 视频生成任务状态
 */

import { NextRequest, NextResponse } from "next/server";
import { getTask, deleteTask } from "@/app/lib/seedance/jimeng-api";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const task = getTask(taskId);

  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  const elapsed = Math.floor((Date.now() - task.startTime) / 1000);

  if (task.status === "done") {
    // 5分钟后自动清理
    setTimeout(() => deleteTask(taskId), 300000);
    return NextResponse.json({ status: "done", elapsed, result: task.result });
  }

  if (task.status === "error") {
    setTimeout(() => deleteTask(taskId), 300000);
    return NextResponse.json({ status: "error", elapsed, error: task.error });
  }

  return NextResponse.json({
    status: "processing",
    elapsed,
    progress: task.progress,
  });
}
