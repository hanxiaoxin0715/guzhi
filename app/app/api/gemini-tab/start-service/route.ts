/**
 * API Route: 自动启动 Gemini Tab 服务
 * 
 * POST /api/gemini-tab/start-service
 * 
 * 当用户点击"启动浏览器"但 Gemini Tab 服务未运行时，
 * 自动在后台启动 GeminiTab 服务。
 * 
 * 查找优先级：
 * 1. GeminiTab-dist/ 目录（打包版：优先用 node.exe + server.js 直启，
 *    因 GeminiTab.exe 是 .NET 控制台程序，detached 模式下无控制台会崩溃）
 * 2. GeminiTab/ 目录（同上策略）
 * 3. Gemini Tab/ 开发目录（npm run dev）
 */

import { NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

// Gemini Tab 服务端口
const GEMINI_TAB_PORT = 3099;

/**
 * 检测 Gemini Tab 服务是否已在运行
 */
async function isServiceRunning(serviceUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${serviceUrl}/api/browser`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 查找 Gemini Tab 的可启动方式
 * 
 * 返回类型说明：
 * - "standalone": 找到 node.exe + server.js（打包版，直接用 node 启动）
 * - "dev": 找到开发目录（package.json + node_modules，用 npm run dev 启动）
 */
function findGeminiTab(): { type: "standalone" | "dev"; dir: string; nodeExe?: string; serverJs?: string } | null {
  const cwd = process.cwd(); // feicai-studio（开发）或打包根目录
  const parentDir = path.resolve(cwd, "..");

  // 优先级 1: 开发目录（源码最新，支持热更新，优先使用）
  const devPaths = [
    path.join(parentDir, "Gemini Tab"),
    path.join(parentDir, "gemini-tab"),
    path.join(parentDir, "GeminiTab"),
  ];
  for (const devPath of devPaths) {
    const pkgJson = path.join(devPath, "package.json");
    const nodeModules = path.join(devPath, "node_modules");
    // 排除有 server.js 的打包目录（如 GeminiTab 可能既有 package.json 又有 server.js）
    const serverJs = path.join(devPath, "server.js");
    const hasServerJs = fs.existsSync(serverJs);
    if (fs.existsSync(pkgJson) && fs.existsSync(nodeModules) && !hasServerJs) {
      return { type: "dev", dir: devPath };
    }
  }

  // 优先级 2: 在打包目录中查找 server.js（standalone 模式）
  // node.exe 优先用根目录的（打包后 GeminiTab-dist 内不再捆绑 node.exe，共享根目录的）
  const standaloneDirs = [
    path.join(cwd, "GeminiTab-dist"),       // 打包模式：GeminiTab-dist 作为子目录
    path.join(parentDir, "GeminiTab-dist"),  // 开发模式：GeminiTab-dist 在父目录
    path.join(cwd, "GeminiTab"),             // 打包模式
    path.join(parentDir, "GeminiTab"),       // 开发模式
  ];
  for (const dir of standaloneDirs) {
    const serverJs = path.join(dir, "server.js");
    if (!fs.existsSync(serverJs)) continue;
    // node.exe 查找顺序：GeminiTab-dist 内 → standalone 根目录(cwd) → 系统 PATH
    const localNodeExe = path.join(dir, "node.exe");
    const rootNodeExe = path.join(cwd, "node.exe");
    const nodeExe = fs.existsSync(localNodeExe) ? localNodeExe
      : fs.existsSync(rootNodeExe) ? rootNodeExe
      : "node"; // fallback 到系统 PATH
    return { type: "standalone", dir, nodeExe, serverJs };
  }

  return null;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const serviceUrl = (body.serviceUrl as string) || `http://localhost:${GEMINI_TAB_PORT}`;

  try {
    // 先检查是否已在运行
    const running = await isServiceRunning(serviceUrl);
    if (running) {
      return NextResponse.json({
        success: true,
        message: "Gemini Tab 服务已在运行中",
        alreadyRunning: true,
      });
    }

    // 查找 Gemini Tab
    const found = findGeminiTab();
    if (!found) {
      return NextResponse.json({
        success: false,
        error: "未找到 Gemini Tab 服务。请确认 GeminiTab-dist（含 server.js）或 Gemini Tab 开发目录位于飞彩工作室同级目录下。",
      }, { status: 404 });
    }

    // 启动服务
    let startLabel: string;

    if (found.type === "standalone") {
      // ── 打包版：直接用 bundled node.exe 启动 server.js ──
      // 注意：不能用 GeminiTab.exe，因为它是 .NET 控制台程序，
      // 以 detached + stdio:ignore 模式启动时无控制台，Console API 崩溃

      // 检查是否有内置 Playwright 浏览器（EXE 打包时自动包含）
      // 如果存在，设置 PLAYWRIGHT_BROWSERS_PATH 让 GeminiTab 直接使用内置浏览器
      const bundledBrowserPath = path.join(process.cwd(), "ms-playwright");
      const playwrightEnv = fs.existsSync(bundledBrowserPath)
        ? { PLAYWRIGHT_BROWSERS_PATH: bundledBrowserPath }
        : {};

      const child = spawn(found.nodeExe!, [found.serverJs!], {
        cwd: found.dir,
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          PORT: String(GEMINI_TAB_PORT),
          HOSTNAME: "0.0.0.0",
          NODE_ENV: "production",
          ...playwrightEnv,
        },
      });
      child.unref();
      startLabel = "standalone (node.exe + server.js)";
      console.log(`[start-service] 已启动 Gemini Tab 独立服务 (PID: ${child.pid}, dir: ${found.dir})`);
    } else {
      // ── 开发模式：用 npm run dev 启动 ──
      // 跨平台：Windows 用 cmd /c，Mac/Linux 用 bash -c
      const isWin = process.platform === "win32";
      const npmCmd = `npm run dev -- -p ${GEMINI_TAB_PORT}`;
      const child = isWin
        ? spawn("cmd", ["/c", npmCmd], {
            cwd: found.dir,
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          })
        : spawn("/bin/bash", ["-c", npmCmd], {
            cwd: found.dir,
            detached: true,
            stdio: "ignore",
          });
      child.unref();
      startLabel = "开发模式 (npm run dev)";
      console.log(`[start-service] 已启动 Gemini Tab 开发服务器 (PID: ${child.pid}, cwd: ${found.dir})`);
    }

    // 等待服务启动（最多 30 秒，开发模式需要编译，首次启动可能安装 Chromium）
    const maxWait = 30000;
    const interval = 1000;
    let waited = 0;
    while (waited < maxWait) {
      await new Promise(r => setTimeout(r, interval));
      waited += interval;
      if (await isServiceRunning(serviceUrl)) {
        return NextResponse.json({
          success: true,
          message: `Gemini Tab 服务已自动启动 (${startLabel})`,
          alreadyRunning: false,
          startedFrom: found.type,
          path: found.dir,
        });
      }
    }

    // 超时但进程已启动，可能还在初始化
    return NextResponse.json({
      success: true,
      message: `Gemini Tab 服务已启动，但尚未就绪，请稍后重试`,
      alreadyRunning: false,
      startedFrom: found.type,
      path: found.dir,
      warning: "服务启动时间较长，请等待几秒后重试连接",
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error(`[start-service] 启动失败:`, errMsg);
    return NextResponse.json({
      success: false,
      error: `启动 Gemini Tab 服务失败: ${errMsg}`,
    }, { status: 500 });
  }
}
