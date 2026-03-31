/**
 * API Route: 停止 Gemini Tab 服务
 *
 * POST /api/gemini-tab/stop-service
 *
 * 查找并终止监听 3099 端口的 node 进程，方便开发者修改代码后重启服务。
 */

import { NextResponse } from "next/server";
import { execSync } from "child_process";

export const dynamic = "force-dynamic";

const GEMINI_TAB_PORT = 3099;

/**
 * 跨平台查找监听指定端口的 PID
 */
function findPidsOnPort(port: number): string[] {
  const isWin = process.platform === "win32";
  try {
    if (isWin) {
      // Windows: netstat -ano | findstr ":3099" | findstr "LISTENING"
      const output = execSync(
        `netstat -ano | findstr ":${port}" | findstr "LISTENING"`,
        { encoding: "utf-8", timeout: 5000 }
      ).trim();
      if (!output) return [];
      const pids = new Set<string>();
      for (const line of output.split("\n")) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid) && pid !== "0") {
          pids.add(pid);
        }
      }
      return Array.from(pids);
    } else {
      // macOS/Linux: lsof -ti:3099
      const output = execSync(
        `lsof -ti:${port}`,
        { encoding: "utf-8", timeout: 5000 }
      ).trim();
      if (!output) return [];
      return output.split("\n").map(s => s.trim()).filter(s => /^\d+$/.test(s));
    }
  } catch {
    // 无匹配时命令返回非零退出码，属正常情况
    return [];
  }
}

/**
 * 跨平台终止进程
 */
function killPid(pid: string): boolean {
  const isWin = process.platform === "win32";
  try {
    if (isWin) {
      execSync(`taskkill /f /pid ${pid} /t`, { encoding: "utf-8", timeout: 5000 });
    } else {
      execSync(`kill -9 ${pid}`, { encoding: "utf-8", timeout: 5000 });
    }
    return true;
  } catch {
    return false;
  }
}

export async function POST() {
  try {
    const pids = findPidsOnPort(GEMINI_TAB_PORT);

    if (pids.length === 0) {
      return NextResponse.json({ success: true, message: "未发现运行中的 Gemini Tab 服务" });
    }

    // 终止进程
    const killed: string[] = [];
    const failed: string[] = [];
    for (const pid of pids) {
      if (killPid(pid)) {
        killed.push(pid);
      } else {
        failed.push(pid);
      }
    }

    console.log(`[stop-service] 已终止 Gemini Tab 服务 — killed: [${killed}], failed: [${failed}]`);

    return NextResponse.json({
      success: true,
      message: `已终止 ${killed.length} 个进程 (PID: ${killed.join(", ")})`,
      killed,
      failed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
