/**
 * Playwright 浏览器代理服务
 * 用于绕过即梦 shark 反爬机制（通过 bdms SDK 自动注入 a_bogus 签名）
 * 从 seedance2.0 开源项目的 browser-service.js 移植为 TypeScript
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// ═══════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════

/** 会话空闲超时: 10分钟 */
const SESSION_IDLE_TIMEOUT = 10 * 60 * 1000;
/** bdms SDK 就绪超时: 30秒 */
const BDMS_READY_TIMEOUT = 30000;

/** 屏蔽的资源类型（加速页面加载） */
const BLOCKED_RESOURCE_TYPES = ["image", "font", "stylesheet", "media"];
/** 允许加载的脚本域名（bdms SDK 所在域名） */
const SCRIPT_WHITELIST_DOMAINS = [
  "vlabstatic.com",
  "bytescm.com",
  "jianying.com",
  "byteimg.com",
  "bytedance.com",     // 字节跳动 CDN（可能有反欺诈/签名脚本）
  "pstatp.com",        // 头条系 CDN
  "toutiaostatic.com", // 头条静态资源
  "bytegoofy.com",     // 字节系 SDK 域名
  "ibytedapm.com",     // 字节 APM 监控（可能影响 msToken 生成）
  "byteacctimg.com",   // 字节账号相关
];

// ═══════════════════════════════════════════════════════════
// 会话类型
// ═══════════════════════════════════════════════════════════

interface BrowserSession {
  context: BrowserContext;
  page: Page;
  lastUsed: number;
  idleTimer: ReturnType<typeof setTimeout>;
}

// ═══════════════════════════════════════════════════════════
// 浏览器代理服务 单例
// ═══════════════════════════════════════════════════════════

class BrowserService {
  private browser: Browser | null = null;
  private sessions = new Map<string, BrowserSession>();
  /** 防止并发自动安装 */
  private installPromise: Promise<boolean> | null = null;

  /** 查找可用的 Chromium 可执行文件（跨平台：Windows + macOS） */
  private resolveChromiumExecutablePath(): string | undefined {
    const isMac = process.platform === "darwin";
    const candidates: string[] = [];

    // 1. 环境变量优先（EXE/start.command 注入的 PLAYWRIGHT_BROWSERS_PATH）
    const envPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (envPath) candidates.push(envPath);

    // 2. 兼容本地安装目录（部分用户手动安装到 app 目录）
    const localBrowsers = path.join(process.cwd(), "node_modules", "playwright-core", ".local-browsers");
    const localMsPlaywright = path.join(process.cwd(), "ms-playwright");
    candidates.push(localBrowsers, localMsPlaywright);

    if (isMac) {
      // 3. macOS: Playwright 浏览器默认安装在 ~/Library/Caches/ms-playwright
      const home = process.env.HOME || "";
      if (home) candidates.push(path.join(home, "Library", "Caches", "ms-playwright"));
    } else {
      // 3. Windows: Playwright 浏览器默认安装在 %LOCALAPPDATA%\ms-playwright
      const localAppData = process.env.LOCALAPPDATA;
      if (localAppData) candidates.push(path.join(localAppData, "ms-playwright"));
    }

    for (const baseDir of candidates) {
      try {
        if (!fs.existsSync(baseDir)) continue;
        
        // 优先查找 chromium_headless_shell（Playwright 1.48+ 推荐的无头浏览器，更轻量）
        const headlessShellDirs = fs.readdirSync(baseDir)
          .filter((name) => name.startsWith("chromium_headless_shell-"))
          .sort((a, b) => b.localeCompare(a));
        
        for (const dir of headlessShellDirs) {
          if (isMac) {
            // macOS ARM64: chromium_headless_shell-XXXX/chrome-headless-shell-mac-arm64/chrome-headless-shell
            const macArm = path.join(baseDir, dir, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
            if (fs.existsSync(macArm)) return macArm;
            // macOS x64: chrome-headless-shell-mac/...
            const macX64 = path.join(baseDir, dir, "chrome-headless-shell-mac", "chrome-headless-shell");
            if (fs.existsSync(macX64)) return macX64;
            // 兼容少量旧目录命名
            const macFallback = path.join(baseDir, dir, "chrome-headless-shell");
            if (fs.existsSync(macFallback)) return macFallback;
          } else {
            // Windows: chromium_headless_shell-XXXX/chrome-headless-shell-win64/chrome-headless-shell.exe
            const winExe = path.join(baseDir, dir, "chrome-headless-shell-win64", "chrome-headless-shell.exe");
            if (fs.existsSync(winExe)) return winExe;
            const winFallback = path.join(baseDir, dir, "chrome-headless-shell.exe");
            if (fs.existsSync(winFallback)) return winFallback;
          }
        }
        
        // 降级：查找标准 chromium（UI 完整版，体积更大）
        const chromiumDirs = fs.readdirSync(baseDir)
          .filter((name) => name.startsWith("chromium-"))
          .sort((a, b) => b.localeCompare(a));

        for (const dir of chromiumDirs) {
          if (isMac) {
            // macOS 路径：chromium-XXXX/chrome-mac/Chromium.app/Contents/MacOS/Chromium
            const macApp = path.join(baseDir, dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium");
            if (fs.existsSync(macApp)) return macApp;
            // macOS ARM64: chrome-mac-arm64/...
            const macArm = path.join(baseDir, dir, "chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium");
            if (fs.existsSync(macArm)) return macArm;
          } else {
            // Windows 路径：chromium-XXXX/chrome-win/chrome.exe
            const chromeExe = path.join(baseDir, dir, "chrome-win", "chrome.exe");
            if (fs.existsSync(chromeExe)) return chromeExe;
            // 兼容历史目录结构
            const fallback = path.join(baseDir, dir, "chrome-win64", "chrome.exe");
            if (fs.existsSync(fallback)) return fallback;
          }
        }
      } catch {
        // 忽略路径读取异常，继续尝试下一个候选目录
      }
    }

    return undefined;
  }

  /**
   * 自动下载安装 Playwright 浏览器（国内 npmmirror 镜像加速）
   * 优先安装轻量的 chromium-headless-shell，失败则降级安装完整 chromium
   */
  private async autoInstallBrowser(): Promise<boolean> {
    if (this.installPromise) return this.installPromise;
    this.installPromise = this._doAutoInstall();
    try {
      return await this.installPromise;
    } finally {
      this.installPromise = null;
    }
  }

  private async _doAutoInstall(): Promise<boolean> {
    // 查找 playwright-core CLI（standalone 打包中位于 app/node_modules/playwright-core/cli.js）
    const cliCandidates = [
      path.join(process.cwd(), "node_modules", "playwright-core", "cli.js"),
      path.join(process.cwd(), "..", "node_modules", "playwright-core", "cli.js"),
    ];
    let cliPath = "";
    for (const c of cliCandidates) {
      if (fs.existsSync(c)) { cliPath = c; break; }
    }
    if (!cliPath) {
      console.error("[browser] playwright-core CLI 未找到，无法自动安装浏览器");
      return false;
    }

    // 国内镜像列表（按优先级）
    const mirrors = [
      "https://cdn.npmmirror.com/binaries/playwright",
      "https://npmmirror.com/mirrors/playwright",
      "",  // 空=官方 CDN
    ];

    // 尝试安装的浏览器类型（headless-shell 更轻量，chromium 作为兜底）
    const browserTypes = ["chromium-headless-shell", "chromium"];

    for (const mirror of mirrors) {
      for (const browserType of browserTypes) {
        try {
          const mirrorLabel = mirror ? mirror.split("//")[1]?.split("/")[0] : "official CDN";
          console.log(`[browser] 🔄 正在自动下载 ${browserType}（镜像: ${mirrorLabel}）...`);
          console.log("[browser] 首次使用需下载约 80~150MB 浏览器，请耐心等待...");

          const env = { ...process.env };
          if (mirror) {
            env.PLAYWRIGHT_DOWNLOAD_HOST = mirror;
          } else {
            delete env.PLAYWRIGHT_DOWNLOAD_HOST;
          }
          // 清除可能残留的代理设置（避免 ECONNREFUSED）
          delete env.HTTPS_PROXY;
          delete env.HTTP_PROXY;
          delete env.https_proxy;
          delete env.http_proxy;

          execSync(`node "${cliPath}" install ${browserType}`, {
            env,
            stdio: "inherit",
            timeout: 5 * 60 * 1000,  // 5分钟超时
            cwd: process.cwd(),
          });

          // 验证安装是否成功
          const newExePath = this.resolveChromiumExecutablePath();
          if (newExePath) {
            console.log(`[browser] ✅ ${browserType} 自动安装成功: ${newExePath}`);
            return true;
          }
          console.warn(`[browser] ${browserType} 安装命令执行完毕但未检测到可执行文件，尝试下一个...`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[browser] ${browserType} 安装失败（${mirror || "official"}）: ${msg.substring(0, 200)}`);
        }
      }
    }

    console.error("[browser] ❌ 所有镜像均下载失败");
    return false;
  }

  /** 确保浏览器已启动（含存活检测，死实例自动重建） */
  async ensureBrowser(): Promise<Browser> {
    if (this.browser) {
      if (this.browser.isConnected()) return this.browser;
      // 浏览器已断开，清理所有旧 session 后重建
      console.warn("[browser] Chromium 已断开，清理旧 session 并重启...");
      this.sessions.forEach((s) => { if (s.idleTimer) clearTimeout(s.idleTimer); });
      this.sessions.clear();
      this.browser = null;
    }

    console.log("[browser] 正在启动 Chromium...");
    const executablePath = this.resolveChromiumExecutablePath();
    try {
      this.browser = await chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missingExecutable = /Executable doesn't exist|Failed to launch/i.test(message);
      if (missingExecutable) {
        // 自动尝试下载安装浏览器
        console.log("[browser] 浏览器可执行文件未找到，启动自动安装...");
        const installed = await this.autoInstallBrowser();
        if (installed) {
          // 安装成功，重新查找可执行文件并启动
          const newExePath = this.resolveChromiumExecutablePath();
          console.log("[browser] 自动安装完成，重新启动浏览器...");
          try {
            this.browser = await chromium.launch({
              headless: true,
              ...(newExePath ? { executablePath: newExePath } : {}),
              args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no-first-run",
              ],
            });
            if (newExePath) console.log("[browser] 使用本地 Chromium 可执行文件: " + newExePath);
            console.log("[browser] Chromium 已启动（自动安装后）");
            return this.browser;
          } catch (retryErr) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            throw new Error(`浏览器自动安装成功但启动失败。\n原始错误: ${message}\n重试错误: ${retryMsg}`);
          }
        }
        // 自动安装失败，给出手动修复建议
        const isMac = process.platform === "darwin";
        const hint = isMac
          ? "\n\n[修复建议-Mac] 自动下载失败，请手动安装：\n1) 打开终端\n2) npm install -g playwright-core@1.58.2\n3) PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright playwright-core install chromium-headless-shell\n(若仍失败，可能需要科学上网)"
          : "\n\n[修复建议-Windows]\n1) cd app\n2) set PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright\n3) npx playwright-core@1.58.2 install chromium-headless-shell";
        throw new Error(`浏览器启动失败：自动下载浏览器也未成功。${hint}\n\n原始错误: ${message}`);
      }
      throw error;
    }
    if (executablePath) {
      console.log("[browser] 使用本地 Chromium 可执行文件: " + executablePath);
    }
    console.log("[browser] Chromium 已启动");
    return this.browser;
  }

  /** 获取或创建浏览器会话（含存活检测，死 session 自动重建） */
  async getSession(sessionId: string, webId: string, userId: string): Promise<BrowserSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      // 检测 session 是否仍然存活
      if (!existing.page.isClosed()) {
        existing.lastUsed = Date.now();
        if (existing.idleTimer) clearTimeout(existing.idleTimer);
        existing.idleTimer = setTimeout(
          () => this.closeSession(sessionId),
          SESSION_IDLE_TIMEOUT,
        );
        return existing;
      }
      // page 已死，清理旧 session 后重建
      console.warn(`[browser] 会话已失效，重新创建 (session: ${sessionId.substring(0, 8)}...)`);
      if (existing.idleTimer) clearTimeout(existing.idleTimer);
      this.sessions.delete(sessionId);
    }

    const browser = await this.ensureBrowser();
    // 根据运行平台选择匹配的 UA（避免即梦检测指纹不一致）
    const isMac = process.platform === "darwin";
    const platformUA = isMac
      ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
      : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
    const context = await browser.newContext({
      userAgent: platformUA,
    });

    // 注入 Cookie
    const cookies = [
      { name: "_tea_web_id", value: webId, domain: ".jianying.com", path: "/" },
      { name: "is_staff_user", value: "false", domain: ".jianying.com", path: "/" },
      { name: "store-region", value: "cn-gd", domain: ".jianying.com", path: "/" },
      { name: "uid_tt", value: String(userId), domain: ".jianying.com", path: "/" },
      { name: "sid_tt", value: sessionId, domain: ".jianying.com", path: "/" },
      { name: "sessionid", value: sessionId, domain: ".jianying.com", path: "/" },
      { name: "sessionid_ss", value: sessionId, domain: ".jianying.com", path: "/" },
    ];
    await context.addCookies(cookies);

    // 屏蔽非必要资源（加速加载）
    await context.route("**/*", (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      const url = request.url();

      if (BLOCKED_RESOURCE_TYPES.includes(resourceType)) {
        return route.abort();
      }

      if (resourceType === "script") {
        const isWhitelisted = SCRIPT_WHITELIST_DOMAINS.some((domain) =>
          url.includes(domain),
        );
        if (!isWhitelisted) return route.abort();
      }

      return route.continue();
    });

    const page = await context.newPage();

    console.log(`[browser] 正在导航到 jimeng.jianying.com (session: ${sessionId.substring(0, 8)}...)`);
    await page.goto("https://jimeng.jianying.com", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // 等待 bdms SDK 加载
    try {
      await page.waitForFunction(
        () => {
          const w = window as unknown as Record<string, unknown>;
          return (
            (w.bdms as Record<string, unknown>)?.init ||
            w.byted_acrawler ||
            (w.fetch as () => void).toString().indexOf("native code") === -1
          );
        },
        { timeout: BDMS_READY_TIMEOUT },
      );
      console.log("[browser] bdms SDK 已就绪");
    } catch {
      console.warn("[browser] bdms SDK 等待超时，继续尝试...");
    }

    const session: BrowserSession = {
      context,
      page,
      lastUsed: Date.now(),
      idleTimer: setTimeout(
        () => this.closeSession(sessionId),
        SESSION_IDLE_TIMEOUT,
      ),
    };

    this.sessions.set(sessionId, session);
    console.log(`[browser] 会话已创建 (session: ${sessionId.substring(0, 8)}...)`);
    return session;
  }

  /** 关闭指定会话 */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.idleTimer) clearTimeout(session.idleTimer);

    try {
      await session.context.close();
    } catch {
      // 忽略关闭错误
    }

    this.sessions.delete(sessionId);
    console.log(`[browser] 会话已关闭 (session: ${sessionId.substring(0, 8)}...)`);
  }

  /** 导航到指定页面（用于建立特定页面的会话上下文） */
  async navigateTo(
    sessionId: string,
    webId: string,
    userId: string,
    targetUrl: string,
  ): Promise<void> {
    const session = await this.getSession(sessionId, webId, userId);
    const currentUrl = session.page.url();
    // 如果已经在目标页面则跳过
    if (currentUrl.startsWith(targetUrl)) {
      console.log(`[browser] 已在目标页面: ${currentUrl.substring(0, 100)}`);
      return;
    }
    console.log(`[browser] 导航到: ${targetUrl} (当前: ${currentUrl.substring(0, 80)})`);
    await session.page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    // 等待 bdms SDK 重新就绪
    try {
      await session.page.waitForFunction(
        () => {
          const w = window as unknown as Record<string, unknown>;
          return (
            (w.bdms as Record<string, unknown>)?.init ||
            w.byted_acrawler ||
            (w.fetch as () => void).toString().indexOf("native code") === -1
          );
        },
        { timeout: 8000 },
      );
    } catch { /* bdms 可能已缓存, 继续 */ }
    console.log(`[browser] 导航完毕: ${session.page.url().substring(0, 100)}`);
  }

  /** 通过浏览器代理发送请求（自动注入 a_bogus 签名，含自动重试） */
  async fetch(
    sessionId: string,
    webId: string,
    userId: string,
    url: string,
    options: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<Record<string, unknown>> {
    const { method = "GET", headers = {}, body } = options;

    for (let attempt = 0; attempt < 2; attempt++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let diag: any = null;
      let capturedUrl = "";
      try {
        const session = await this.getSession(sessionId, webId, userId);
        console.log(`[browser] 通过浏览器代理请求: ${method} ${url.substring(0, 80)}... (attempt=${attempt})`);

        // ══ 诊断：检查 bdms SDK + msToken + 请求签名 ══
        try {
          diag = await session.page.evaluate(() => {
            const w = window as unknown as Record<string, unknown>;
            const fetchStr = (w.fetch as () => void)?.toString?.()?.substring(0, 120) || "N/A";
            const isPatched = fetchStr.indexOf("native code") === -1;
            const hasBdms = !!(w.bdms as Record<string, unknown>)?.init;
            const hasCrawler = !!w.byted_acrawler;
            const msMatch = document.cookie.match(/msToken=([^;]+)/);
            const msToken = msMatch ? msMatch[1].substring(0, 30) + "..." : null;
            const allCookieNames = document.cookie.split(";").map(c => c.trim().split("=")[0]).join(", ");
            const pageUrl = window.location.href;
            return { fetchStr, isPatched, hasBdms, hasCrawler, msToken, allCookieNames, pageUrl };
          });
          console.log(`[browser] ═══ BDMS 诊断 ═══`);
          console.log(`[browser]   当前页面: ${diag.pageUrl}`);
          console.log(`[browser]   fetch.toString() = "${diag.fetchStr}"`);
          console.log(`[browser]   fetch已patch: ${diag.isPatched}, bdms.init: ${diag.hasBdms}, acrawler: ${diag.hasCrawler}`);
          console.log(`[browser]   msToken: ${diag.msToken || "无(!)——可能导致签名失败"}`);
          console.log(`[browser]   页面Cookie列表: ${diag.allCookieNames}`);
        } catch (diagErr) {
          console.warn(`[browser] 诊断失败: ${diagErr}`);
        }

        // ══ 拦截实际发出的请求 URL（验证 a_bogus 是否被注入）══
        const urlCaptureHandler = (req: { url: () => string }) => {
          const reqUrl = req.url();
          if (reqUrl.includes("aigc_draft/generate")) {
            capturedUrl = reqUrl;
          }
        };
        session.page.on("request", urlCaptureHandler);

        // 给 page.evaluate 加 60 秒超时（防止永久挂死）
        const evaluatePromise = session.page.evaluate(
          async ({ url, method, headers, body }: { url: string; method: string; headers: Record<string, string>; body?: string }) => {
            // 给浏览器内 fetch 加 30 秒超时
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            try {
              const resp = await fetch(url, {
                method,
                headers,
                body: body || undefined,
                credentials: "include",
                signal: controller.signal,
              });
              clearTimeout(timeoutId);

              // 检查响应状态和类型
              const contentType = resp.headers.get("content-type") || "";
              const status = resp.status;
              const text = await resp.text();

              if (!contentType.includes("application/json")) {
                return {
                  __fetchError: true,
                  status,
                  contentType,
                  bodyPreview: text.substring(0, 500),
                };
              }

              try {
                return JSON.parse(text);
              } catch {
                return {
                  __fetchError: true,
                  status,
                  contentType,
                  parseError: "JSON.parse failed",
                  bodyPreview: text.substring(0, 500),
                };
              }
            } catch (e) {
              clearTimeout(timeoutId);
              return {
                __fetchError: true,
                message: (e as Error).message || String(e),
              };
            }
          },
          { url, method, headers, body },
        );

        // 外层再加 60 秒超时（防止 page.evaluate 自身卡死）
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("[browser] page.evaluate 超时(60s)")), 60000),
        );
        const result = await Promise.race([evaluatePromise, timeoutPromise]) as Record<string, unknown>;

        // ══ 输出拦截到的实际请求 URL（含 a_bogus 签名） ══
        session.page.off("request", urlCaptureHandler);
        if (capturedUrl) {
          const hasAbogus = capturedUrl.includes("a_bogus=");
          const hasMsToken = capturedUrl.includes("msToken=");
          console.log(`[browser] ═══ 实际请求URL ═══`);
          console.log(`[browser]   a_bogus: ${hasAbogus ? "✅ 已注入" : "❌ 未注入(!)"}`);
          console.log(`[browser]   msToken: ${hasMsToken ? "✅ 已注入" : "❌ 未注入(!)"}`);
          console.log(`[browser]   完整URL: ${capturedUrl.substring(0, 300)}`);
        } else {
          console.warn(`[browser] ⚠ 未拦截到 aigc_draft/generate 请求（可能 URL 没匹配）`);
        }

        // 检查是否是 fetch 内部错误
        if (result.__fetchError) {
          const errInfo = `status=${result.status}, contentType=${result.contentType}, msg=${result.message || ""}, parseError=${result.parseError || ""}, body=${(result.bodyPreview as string || "").substring(0, 200)}`;
          console.error(`[browser] fetch 内部错误: ${errInfo}`);
          throw new Error(`[browser] 即梦请求失败: ${errInfo}`);
        }

        // ★ 附加诊断元信息到结果（不影响原始响应字段，_browser_diag 前缀避免冲突）
        try {
          result.__browser_diag = {
            pageUrl: diag?.pageUrl,
            hasBdms: diag?.hasBdms,
            hasCrawler: diag?.hasCrawler,
            msToken: diag?.msToken,
            fetchPatched: diag?.isPatched,
            a_bogus: capturedUrl ? capturedUrl.includes("a_bogus=") : null,
            cookieNames: diag?.allCookieNames,
            capturedUrl: capturedUrl?.substring(0, 300),
          };
        } catch { /* ignore */ }

        return result;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isBrowserDead = errMsg.includes("has been closed") ||
          errMsg.includes("Target closed") ||
          errMsg.includes("Session closed") ||
          errMsg.includes("Connection closed") ||
          errMsg.includes("Browser has been disconnected") ||
          errMsg.includes("page.evaluate 超时");

        if (isBrowserDead && attempt === 0) {
          console.warn(`[browser] 浏览器已断开或超时，正在重建... (${errMsg})`);
          // 强制清理死浏览器和 session
          await this.close();
          continue; // 重试
        }

        throw err;
      }
    }

    throw new Error("[browser] fetch 重试耗尽");
  }

  /** 关闭所有会话和浏览器 */
  async close(): Promise<void> {
    for (const [sessionId] of this.sessions) {
      await this.closeSession(sessionId);
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // 忽略关闭错误
      }
      this.browser = null;
      console.log("[browser] Chromium 已关闭");
    }
  }

  /**
   * 注入用户完整 Cookie 字符串（解析后追加到浏览器 context）
   * 用于即梦生图等需要完整登录态的 API
   */
  async injectExtraCookies(sessionId: string, webId: string, userId: string, rawCookieStr: string): Promise<number> {
    const session = await this.getSession(sessionId, webId, userId);
    const pairs = rawCookieStr.split(";").map(s => s.trim()).filter(Boolean);
    const cookies: { name: string; value: string; domain: string; path: string }[] = [];
    for (const pair of pairs) {
      const idx = pair.indexOf("=");
      if (idx <= 0) continue;
      const name = pair.substring(0, idx).trim();
      const value = pair.substring(idx + 1).trim();
      if (!name || !value) continue;
      cookies.push({ name, value, domain: ".jianying.com", path: "/" });
    }
    if (cookies.length > 0) {
      await session.context.addCookies(cookies);
      console.log(`[browser] 注入额外 Cookie: ${cookies.length} 个 (${cookies.map(c => c.name).join(", ").substring(0, 200)})`);
    }
    return cookies.length;
  }
}

/** 全局单例 */
const browserService = new BrowserService();
export default browserService;
