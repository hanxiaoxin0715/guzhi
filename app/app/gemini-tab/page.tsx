"use client";

import { useState, useEffect, useRef } from "react";
import { useToast } from "../components/Toast";
import Sidebar from "../components/Sidebar";
import {
  Bot, Power, PowerOff, RefreshCw, Loader, CheckCircle, XCircle,
  Settings2, Monitor, Wifi, WifiOff, AlertTriangle, Rocket, RotateCcw, Square,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

interface BrowserStatus {
  isLaunched: boolean;
  isLoggedIn: boolean;
  activeTabs: number;
  /** Gemini 生图限制每天 1000 张，这是当日已生成数量 */
  dailyGenerated: number;
}

const GEMINI_TAB_SETTINGS_KEY = "feicai-gemini-tab-settings";

interface GeminiTabSettings {
  serviceUrl: string;
  maxConcurrentTabs: number;
  headless: boolean;
  chromePath: string;
  geminiMode: "pro" | "thinking";
  gemUrl: string;
  /** 代理地址（选填），供使用桌面 VPN 的用户填写本地代理端口 */
  proxyServer: string;
  /** Chrome 扩展目录路径，启动时加载到 Playwright 浏览器（如 Ghelper VPN 扩展） */
  extensionPath: string;
  /** 发送后等待图片开始生成的初始等待时间（毫秒），默认 5000 */
  initialWaitMs: number;
  /** 预热聊天触发概率（0-100），默认 30 表示 30% */
  warmupChance: number;
  /** 下载模式：auto=自动提取，manual=用户手动下载后自动导入 */
  downloadMode: "auto" | "manual";
}

function loadGeminiTabSettings(): GeminiTabSettings {
  try {
    const raw = localStorage.getItem(GEMINI_TAB_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        serviceUrl: parsed.serviceUrl || "http://localhost:3099",
        maxConcurrentTabs: parsed.maxConcurrentTabs || 3,
        headless: parsed.headless ?? false,
        chromePath: parsed.chromePath || "",
        geminiMode: parsed.geminiMode || "pro",
        gemUrl: parsed.gemUrl || "https://gemini.google.com/gem/3dbdda4a9e6a",
        proxyServer: parsed.proxyServer || "",
        extensionPath: parsed.extensionPath || "",
        initialWaitMs: parsed.initialWaitMs ?? 5000,
        warmupChance: parsed.warmupChance ?? 30,
        downloadMode: parsed.downloadMode || "auto",
      };
    }
  } catch { /* ignore */ }
  return { serviceUrl: "http://localhost:3099", maxConcurrentTabs: 3, headless: false, chromePath: "", geminiMode: "pro", gemUrl: "https://gemini.google.com/gem/3dbdda4a9e6a", proxyServer: "", extensionPath: "", initialWaitMs: 5000, warmupChance: 30, downloadMode: "auto" as const };
}

function saveGeminiTabSettings(settings: GeminiTabSettings) {
  localStorage.setItem(GEMINI_TAB_SETTINGS_KEY, JSON.stringify(settings));
}

// ═══════════════════════════════════════════════════════════
// Page Component
// ═══════════════════════════════════════════════════════════

export default function GeminiTabPage() {
  const { toast } = useToast();

  // Settings
  const [serviceUrl, setServiceUrl] = useState("http://localhost:3099");
  const [maxConcurrentTabs, setMaxConcurrentTabs] = useState(3);
  const [headless, setHeadless] = useState(false);
  const [chromePath, setChromePath] = useState("");
  const [geminiMode, setGeminiMode] = useState<"pro" | "thinking">("pro");
  const [gemUrl, setGemUrl] = useState("https://gemini.google.com/gem/3dbdda4a9e6a");
  const [gemUrlSynced, setGemUrlSynced] = useState(false);
  // ── 代理地址（选填），供使用桌面 VPN 的用户填写 ──
  const [proxyServer, setProxyServer] = useState("");
  const [proxySynced, setProxySynced] = useState(true); // 默认为空=已同步
  // ── Chrome 扩展加载路径（如 Ghelper VPN 扩展目录） ──
  const [extensionPath, setExtensionPath] = useState("");
  const [extensionSynced, setExtensionSynced] = useState(true);
  // ── 下载等待时间和预热概率 ──
  const [initialWaitMs, setInitialWaitMs] = useState(5000);
  const [warmupChance, setWarmupChance] = useState(30); // 百分比 0-100
  const [downloadMode, setDownloadMode] = useState<"auto" | "manual">("auto");

  // Status
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [loading, setLoading] = useState<string | null>(null); // "launch" | "close" | "check" | "status" | "start-service"
  const [serviceReachable, setServiceReachable] = useState<boolean | null>(null);
  // 用于检测服务从不可达→可达的变化，自动重同步用户配置
  const prevReachableRef = useRef<boolean | null>(null);

  // Logs
  const [logs, setLogs] = useState<{ level: string; message: string; timestamp: number }[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load settings on mount
  useEffect(() => {
    const saved = loadGeminiTabSettings();
    setServiceUrl(saved.serviceUrl);
    setMaxConcurrentTabs(saved.maxConcurrentTabs);
    setHeadless(saved.headless);
    setChromePath(saved.chromePath);
    setGeminiMode(saved.geminiMode || "pro");
    setGemUrl(saved.gemUrl || "https://gemini.google.com/gem/3dbdda4a9e6a");
    setProxyServer(saved.proxyServer || "");
    setExtensionPath(saved.extensionPath || "");
    setInitialWaitMs(saved.initialWaitMs ?? 5000);
    setWarmupChance(saved.warmupChance ?? 30);
    setDownloadMode(saved.downloadMode || "auto");
  }, []);

  // Auto-fetch status on mount and periodically
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => {
      clearInterval(interval);
      // 组件卸载时清理日志轮询，避免内存/网络泄漏
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceUrl]);

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // ── API Helpers ──

  async function callGeminiTabAPI(path: string, options?: RequestInit) {
    const extraHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (serviceUrl && serviceUrl !== "http://localhost:3099") {
      extraHeaders["x-gemini-tab-url"] = serviceUrl;
    }
    const res = await fetch(`/api/gemini-tab?path=${encodeURIComponent(path)}`, {
      ...options,
      headers: { ...extraHeaders, ...(options?.headers || {}) },
    });
    return res;
  }

  async function fetchStatus() {
    try {
      const res = await callGeminiTabAPI("/api/browser");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        const wasReachable = prevReachableRef.current;
        prevReachableRef.current = true;
        setServiceReachable(true);

        // ★ 不再从后端反向覆盖 gemUrl/proxyServer/extensionPaths
        // 前端 localStorage 是用户配置的唯一 source of truth
        // 后端内存在服务重启后会丢失，反向同步会用默认值污染前端

        // ★ 检测到服务从「不可达→可达」（即服务刚重启），自动重同步用户配置到后端
        if (wasReachable === false) {
          console.log("[GeminiTab] 服务恢复连接，自动重同步用户配置...");
          const saved = loadGeminiTabSettings();
          const trimmedGem = (saved.gemUrl || "").trim();
          if (trimmedGem) {
            callGeminiTabAPI("/api/browser", { method: "POST", body: JSON.stringify({ action: "set-gem-url", gemUrl: trimmedGem }) }).catch(() => {});
            setGemUrlSynced(true);
          }
          if ((saved.proxyServer || "").trim()) {
            callGeminiTabAPI("/api/browser", { method: "POST", body: JSON.stringify({ action: "set-proxy", proxyServer: saved.proxyServer.trim() }) }).catch(() => {});
            setProxySynced(true);
          }
          callGeminiTabAPI("/api/browser", { method: "POST", body: JSON.stringify({ action: "set-initial-wait", initialWaitMs: saved.initialWaitMs ?? 5000 }) }).catch(() => {});
          callGeminiTabAPI("/api/browser", { method: "POST", body: JSON.stringify({ action: "set-warmup-chance", warmupChance: (saved.warmupChance ?? 30) / 100 }) }).catch(() => {});
          callGeminiTabAPI("/api/browser", { method: "POST", body: JSON.stringify({ action: "set-download-mode", downloadMode: saved.downloadMode || "auto" }) }).catch(() => {});
        }
      } else {
        prevReachableRef.current = false;
        setServiceReachable(false);
        setStatus(null);
      }
    } catch {
      prevReachableRef.current = false;
      setServiceReachable(false);
      setStatus(null);
    }
  }

  async function fetchLogs() {
    try {
      const since = logs.length > 0 ? logs[logs.length - 1].timestamp : 0;
      const res = await callGeminiTabAPI(`/api/generate?since=${since}`);
      if (res.ok) {
        const data = await res.json();
        if (data.logs?.length > 0) {
          setLogs(prev => [...prev, ...data.logs]);
        }
      }
    } catch { /* ignore */ }
  }

  // ── Actions ──

  /**
   * 尝试自动启动 Gemini Tab 服务（调用 /api/gemini-tab/start-service）
   * @returns true 如果服务已可用
   */
  async function ensureServiceRunning(): Promise<boolean> {
    // 先快速检测一次
    try {
      const res = await callGeminiTabAPI("/api/browser");
      if (res.ok) {
        setServiceReachable(true);
        return true;
      }
    } catch { /* not reachable */ }

    // 服务未运行，尝试自动启动
    setLoading("start-service");
    try {
      const res = await fetch("/api/gemini-tab/start-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceUrl }),
      });
      const data = await res.json();
      if (data.success) {
        toast(data.message, "success");
        setServiceReachable(true);
        // 给服务一点额外的稳定时间
        if (!data.alreadyRunning) {
          await new Promise(r => setTimeout(r, 1000));
        }
        return true;
      } else {
        toast(data.error || "启动 Gemini Tab 服务失败", "error");
        return false;
      }
    } catch (e) {
      toast(`无法自动启动服务: ${e instanceof Error ? e.message : String(e)}`, "error");
      return false;
    } finally {
      // 注意: 如果是 handleLaunch 调用的，loading 会被覆盖为 "launch"
      if (loading === "start-service") setLoading(null);
    }
  }

  /** 手动启动 Gemini Tab 服务（服务连接区按钮） */
  async function handleStartService() {
    const ok = await ensureServiceRunning();
    if (ok) {
      await fetchStatus();
    }
    setLoading(null);
  }

  async function handleLaunch() {
    setLoading("launch");
    try {
      // 如果服务不可达，先自动启动服务
      if (serviceReachable !== true) {
        const serviceOk = await ensureServiceRunning();
        if (!serviceOk) {
          setLoading(null);
          return;
        }
      }

      setLoading("launch");
      const res = await callGeminiTabAPI("/api/browser", {
        method: "POST",
        body: JSON.stringify({ action: "launch", headless, maxConcurrentTabs, chromePath: chromePath || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus(data.status);
        toast("浏览器启动成功", "success");
        // 同步所有用户配置到后端（Gem链接、代理、等待时间、预热概率、下载模式）
        const trimmedGem = gemUrl.trim();
        if (trimmedGem) callGeminiTabAPI("/api/browser", { method: "POST", body: JSON.stringify({ action: "set-gem-url", gemUrl: trimmedGem }) }).catch(() => {});
        if (proxyServer.trim()) callGeminiTabAPI("/api/browser", { method: "POST", body: JSON.stringify({ action: "set-proxy", proxyServer: proxyServer.trim() }) }).catch(() => {});
        callGeminiTabAPI("/api/browser", { method: "POST", body: JSON.stringify({ action: "set-initial-wait", initialWaitMs }) }).catch(() => {});
        callGeminiTabAPI("/api/browser", { method: "POST", body: JSON.stringify({ action: "set-warmup-chance", warmupChance: warmupChance / 100 }) }).catch(() => {});
        callGeminiTabAPI("/api/browser", { method: "POST", body: JSON.stringify({ action: "set-download-mode", downloadMode }) }).catch(() => {});
        // Start log polling
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = setInterval(fetchLogs, 2000);
      } else {
        toast(`启动失败: ${data.error}`, "error");
      }
    } catch (e) {
      toast(`启动失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setLoading(null);
    }
  }

  async function handleClose() {
    setLoading("close");
    try {
      const res = await callGeminiTabAPI("/api/browser", {
        method: "POST",
        body: JSON.stringify({ action: "close" }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus(data.status);
        toast("浏览器已关闭", "success");
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      } else {
        toast(`关闭失败: ${data.error}`, "error");
      }
    } catch (e) {
      toast(`关闭失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setLoading(null);
    }
  }

  /** 停止 Gemini Tab 服务进程（终止 3099 端口），方便修改代码后重启 */
  async function handleStopService() {
    if (!confirm("确认关闭 Gemini Tab 终端？\n\n这将终止 3099 端口的服务进程，包括浏览器和所有生图任务。")) return;
    setLoading("stop-service");
    try {
      const res = await fetch("/api/gemini-tab/stop-service", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast(data.message || "终端已关闭", "success");
        setStatus(null);
        setServiceReachable(false);
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      } else {
        toast(`关闭失败: ${data.error}`, "error");
      }
    } catch (e) {
      toast(`关闭失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setLoading(null);
    }
  }

  async function handleCheckLogin() {
    setLoading("check");
    try {
      const res = await callGeminiTabAPI("/api/browser", {
        method: "POST",
        body: JSON.stringify({ action: "check-login" }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus(data.status);
        toast(data.loggedIn ? "已登录 Google ✓" : "未登录，请在浏览器窗口中手动登录", data.loggedIn ? "success" : "error");
      } else {
        toast(`检查失败: ${data.error}`, "error");
      }
    } catch (e) {
      toast(`检查失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setLoading(null);
    }
  }

  async function handleSetConcurrency() {
    try {
      const res = await callGeminiTabAPI("/api/browser", {
        method: "POST",
        body: JSON.stringify({ action: "set-concurrency", maxConcurrentTabs }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus(data.status);
        toast(`并发数已设置为 ${maxConcurrentTabs}`, "success");
      }
    } catch (e) {
      toast(`设置失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  function handleSaveSettings() {
    saveGeminiTabSettings({ serviceUrl, maxConcurrentTabs, headless, chromePath, geminiMode, gemUrl, proxyServer, extensionPath, initialWaitMs, warmupChance, downloadMode });
    toast("Gemini Tab 配置已保存", "success");
  }

  async function handleSaveGemUrl() {
    const trimmed = gemUrl.trim();
    if (!trimmed) {
      toast("请输入有效的 Gem 链接", "error");
      return;
    }
    try {
      const res = await callGeminiTabAPI("/api/browser", {
        method: "POST",
        body: JSON.stringify({ action: "set-gem-url", gemUrl: trimmed }),
      });
      const data = await res.json();
      if (data.success) {
        setGemUrlSynced(true);
        saveGeminiTabSettings({ serviceUrl, maxConcurrentTabs, headless, chromePath, geminiMode, gemUrl: trimmed, proxyServer, extensionPath, initialWaitMs, warmupChance, downloadMode });
        toast("Gem 链接已同步到服务", "success");
      } else {
        toast(`同步失败: ${data.error}`, "error");
      }
    } catch (e) {
      toast(`同步失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  /**
   * 同步代理地址到 GeminiTab 后端
   * 
   * 用户使用浏览器扩展 VPN（如 Ghelper）时，扩展在本地监听一个代理端口，
   * 我们将此端口地址传给 GeminiTab 后端，后端在启动 Playwright 浏览器时注入 proxy 参数，
   * 使 Playwright 的网络请求走扩展 VPN 的代理通道。
   * 
   * 注意：代理参数只在浏览器启动时生效，运行中的浏览器需要重启才能应用新代理。
   */
  async function handleSyncProxy() {
    try {
      const res = await callGeminiTabAPI("/api/browser", {
        method: "POST",
        body: JSON.stringify({ action: "set-proxy", proxyServer: proxyServer.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setProxySynced(true);
        saveGeminiTabSettings({ serviceUrl, maxConcurrentTabs, headless, chromePath, geminiMode, gemUrl, proxyServer: proxyServer.trim(), extensionPath, initialWaitMs, warmupChance, downloadMode });
        // 如果浏览器正在运行，提示用户需要重启浏览器
        if (isLaunched) {
          toast(proxyServer.trim()
            ? "代理地址已保存，请关闭并重新启动浏览器以生效"
            : "代理已清除，请关闭并重新启动浏览器以生效",
            "success"
          );
        } else {
          toast(proxyServer.trim() ? "代理地址已同步" : "代理已清除", "success");
        }
      } else {
        toast(`同步失败: ${data.error}`, "error");
      }
    } catch (e) {
      toast(`同步失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  /**
   * 同步 Chrome 扩展路径到 GeminiTab 后端
   * 
   * 用户的 VPN 扩展（如 Ghelper）安装在系统 Chrome 中，
   * 将扩展目录路径填入后，Playwright 下次启动时会通过 --load-extension 加载该扩展。
   * 扩展的登录状态保存在 browser-data/ 中，只需首次在 Playwright 浏览器内登录一次。
   * 
   * 修改扩展路径后需重启浏览器才能生效。
   */
  async function handleSyncExtension() {
    try {
      const paths = extensionPath.split("\n").map(p => p.trim()).filter(Boolean);
      const res = await callGeminiTabAPI("/api/browser", {
        method: "POST",
        body: JSON.stringify({ action: "set-extension-paths", extensionPaths: paths }),
      });
      const data = await res.json();
      if (data.success) {
        setExtensionSynced(true);
        saveGeminiTabSettings({ serviceUrl, maxConcurrentTabs, headless, chromePath, geminiMode, gemUrl, proxyServer, extensionPath: extensionPath.trim(), initialWaitMs, warmupChance, downloadMode });
        if (isLaunched) {
          toast(paths.length > 0
            ? "扩展路径已保存，请关闭并重新启动浏览器以加载扩展"
            : "扩展已清除，请关闭并重新启动浏览器以生效",
            "success"
          );
        } else {
          toast(paths.length > 0 ? "扩展路径已同步，下次启动浏览器时将自动加载" : "扩展已清除", "success");
        }
      } else {
        toast(`同步失败: ${data.error}`, "error");
      }
    } catch (e) {
      toast(`同步失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  // ── Render ──

  function handleResetSettings() {
    if (!confirm("确认恢复所有设置为默认值？\n\n• 服务地址→ localhost:3099\n• 并发数→ 3\n• 下载等待→ 5s\n• 预热概率→ 30%\n• 下载模式→ 自动\n• 代理/扩展/Chrome 路径→ 清空")) return;
    const defaults = loadGeminiTabSettings(); // 从一个空 localStorage 读取即是默认值
    localStorage.removeItem(GEMINI_TAB_SETTINGS_KEY);
    const d = loadGeminiTabSettings();
    setServiceUrl(d.serviceUrl);
    setMaxConcurrentTabs(d.maxConcurrentTabs);
    setHeadless(d.headless);
    setChromePath(d.chromePath);
    setGeminiMode(d.geminiMode);
    setGemUrl(d.gemUrl);
    setProxyServer(d.proxyServer);
    setExtensionPath(d.extensionPath);
    setInitialWaitMs(d.initialWaitMs);
    setWarmupChance(d.warmupChance);
    setDownloadMode(d.downloadMode);
    setGemUrlSynced(false);
    setProxySynced(true);
    setExtensionSynced(true);
    // 如果浏览器已启动，同步默认参数到后端
    if (status?.isLaunched) {
      callGeminiTabAPI("/api/browser", { method: "POST", body: JSON.stringify({ action: "set-concurrency", maxConcurrentTabs: d.maxConcurrentTabs }) }).catch(() => {});
      callGeminiTabAPI("/api/browser", { method: "POST", body: JSON.stringify({ action: "set-initial-wait", initialWaitMs: d.initialWaitMs }) }).catch(() => {});
      callGeminiTabAPI("/api/browser", { method: "POST", body: JSON.stringify({ action: "set-warmup-chance", warmupChance: d.warmupChance / 100 }) }).catch(() => {});
      callGeminiTabAPI("/api/browser", { method: "POST", body: JSON.stringify({ action: "set-download-mode", downloadMode: d.downloadMode }) }).catch(() => {});
    }
    saveGeminiTabSettings(d);
    toast("所有设置已恢复为默认值", "success");
  }

  const isLaunched = status?.isLaunched ?? false;
  const isLoggedIn = status?.isLoggedIn ?? false;

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <div className="flex flex-col flex-1 h-full overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-[var(--border-default)] shrink-0">
          <div className="flex items-center gap-3">
            <Bot size={24} className="text-[var(--gold-primary)]" />
            <span className="font-serif text-[22px] font-bold text-[var(--text-primary)]">
              Gemini Tab
            </span>
            <span className="text-[13px] text-[var(--text-muted)]">
              浏览器自动化生图管理
            </span>
          </div>
          <button
            onClick={handleSaveSettings}
            className="fixed right-10 top-6 z-50 flex items-center gap-1.5 px-4 py-2 bg-[var(--gold-primary)] text-[12px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer shadow-lg"
          >
            <Settings2 size={14} /> 保存配置
          </button>
          <button
            onClick={handleResetSettings}
            className="fixed right-40 top-6 z-50 flex items-center gap-1.5 px-3 py-2 border border-[var(--border-default)] bg-[var(--bg-surface)] text-[12px] text-[var(--text-secondary)] hover:border-red-500 hover:text-red-400 transition cursor-pointer shadow-lg"
          >
            <RotateCcw size={13} /> 恢复默认
          </button>
        </div>

        <div className="p-8 space-y-6 max-w-4xl">
          {/* ── Service Connection ── */}
          <div className="border border-[var(--border-default)] bg-[var(--bg-surface)]">
            <div className="px-5 py-3 border-b border-[var(--border-default)] flex items-center gap-2">
              {serviceReachable === true ? (
                <Wifi size={16} className="text-green-400" />
              ) : serviceReachable === false ? (
                <WifiOff size={16} className="text-red-400" />
              ) : (
                <Loader size={16} className="animate-spin text-[var(--text-muted)]" />
              )}
              <span className="text-[14px] font-medium text-[var(--text-primary)]">服务连接</span>
              {serviceReachable === false && (
                <span className="text-[11px] text-red-400 ml-2">
                  无法连接 Gemini Tab 服务
                </span>
              )}
              {serviceReachable === false && (
                <button
                  onClick={handleStartService}
                  disabled={loading !== null}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-[var(--gold-primary)] text-[11px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-40"
                >
                  {loading === "start-service" ? <Loader size={12} className="animate-spin" /> : <Rocket size={12} />}
                  {loading === "start-service" ? "启动中..." : "启动服务"}
                </button>
              )}
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[12px] text-[var(--text-muted)] mb-1">
                  Gemini Tab 服务地址
                </label>
                <input
                  type="text"
                  value={serviceUrl}
                  onChange={(e) => setServiceUrl(e.target.value)}
                  className="w-full bg-[var(--bg-base)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] px-3 py-2 outline-none focus:border-[var(--gold-primary)]"
                  placeholder="http://localhost:3099"
                />
                <p className="text-[11px] text-[var(--text-muted)] mt-1 space-y-0.5">
                  <span className="block">本机运行时保持默认 <span className="font-mono text-[var(--text-secondary)]">http://localhost:3099</span> 即可，无需修改。</span>
                  <span className="block">如连接失败请确认：① 已运行 <span className="font-mono text-[var(--text-secondary)]">GeminiTab.exe</span> 或 <span className="font-mono text-[var(--text-secondary)]">npm run dev</span> 启动服务 ② 端口未被占用。</span>
                  <span className="block text-[var(--text-muted)]">远程部署时修改为服务端 IP + 端口，如 <span className="font-mono">http://192.168.1.100:3099</span></span>
                </p>
              </div>

              {/* Gem URL */}
              <div>
                <label className="block text-[12px] text-[var(--text-muted)] mb-1">
                  Gem 链接
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={gemUrl}
                    onChange={(e) => { setGemUrl(e.target.value); setGemUrlSynced(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveGemUrl(); }}
                    className="flex-1 bg-[var(--bg-base)] text-[13px] text-[var(--text-primary)] px-3 py-2 outline-none transition"
                    style={{
                      border: gemUrlSynced
                        ? "1px solid var(--border-default)"
                        : "1px solid #eab308",
                    }}
                    placeholder="https://gemini.google.com/gem/..."
                  />
                  <button
                    onClick={handleSaveGemUrl}
                    disabled={gemUrlSynced}
                    className="shrink-0 flex items-center gap-1 px-3 py-2 text-[12px] font-medium transition cursor-pointer disabled:opacity-40 disabled:cursor-default"
                    style={{
                      background: gemUrlSynced ? "var(--bg-base)" : "var(--gold-primary)",
                      color: gemUrlSynced ? "var(--text-muted)" : "#0A0A0A",
                      border: gemUrlSynced ? "1px solid var(--border-default)" : "none",
                    }}
                  >
                    {gemUrlSynced ? "✓ 已同步" : "同步"}
                  </button>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">
                  浏览器自动化使用的 Gem 地址。更换 Gem 后填入新链接并点击「同步」，下次生图将使用新地址。
                </p>
              </div>

              {/* ── 代理地址（选填）── */}
              {/* 适用场景：用户使用 Ghelper 等浏览器扩展 VPN，这类扩展无法被 Playwright 加载，
                  但扩展会在本地监听一个代理端口（如 127.0.0.1:10808），
                  填入该端口后 Playwright 浏览器会通过此代理访问 Gemini。
                  使用桌面级 VPN（Clash、V2RayN 等）的用户无需填写，系统代理会自动生效。 */}
              <div>
                <label className="block text-[12px] text-[var(--text-muted)] mb-1">
                  代理地址（选填）
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={proxyServer}
                    onChange={(e) => { setProxyServer(e.target.value); setProxySynced(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSyncProxy(); }}
                    className="flex-1 bg-[var(--bg-base)] text-[13px] text-[var(--text-primary)] px-3 py-2 outline-none transition"
                    style={{
                      border: proxySynced
                        ? "1px solid var(--border-default)"
                        : "1px solid #eab308",
                    }}
                    placeholder="127.0.0.1:10808"
                  />
                  <button
                    onClick={handleSyncProxy}
                    disabled={proxySynced}
                    className="shrink-0 flex items-center gap-1 px-3 py-2 text-[12px] font-medium transition cursor-pointer disabled:opacity-40 disabled:cursor-default"
                    style={{
                      background: proxySynced ? "var(--bg-base)" : "var(--gold-primary)",
                      color: proxySynced ? "var(--text-muted)" : "#0A0A0A",
                      border: proxySynced ? "1px solid var(--border-default)" : "none",
                    }}
                  >
                    {proxySynced ? (proxyServer.trim() ? "✓ 已同步" : "无代理") : "同步"}
                  </button>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-1 space-y-0.5">
                  <span className="block">使用桌面 VPN（Clash、V2RayN 等）的用户，可填写本地代理端口。系统级代理一般<span className="text-[var(--text-secondary)]">无需填写</span>。</span>
                  <span className="block text-[var(--text-muted)]">修改代理后需<span className="text-yellow-500">重启浏览器</span>才能生效。留空表示不使用代理。</span>
                </p>
              </div>

              {/* ── Chrome 扩展加载（推荐方案 — 适用 Ghelper 等浏览器 VPN 扩展）── */}
              <div>
                <label className="block text-[12px] text-[var(--text-muted)] mb-1">
                  Chrome 扩展加载（选填）
                </label>
                <div className="flex items-start gap-2">
                  <input
                    type="text"
                    value={extensionPath}
                    onChange={(e) => { setExtensionPath(e.target.value); setExtensionSynced(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSyncExtension(); }}
                    className="flex-1 bg-[var(--bg-base)] text-[13px] text-[var(--text-primary)] px-3 py-2 outline-none transition font-mono"
                    style={{
                      border: extensionSynced
                        ? "1px solid var(--border-default)"
                        : "1px solid #eab308",
                    }}
                    placeholder="C:\Users\你的用户名\AppData\Local\Google\Chrome\User Data\Default\Extensions\扩展ID\版本号"
                  />
                  <button
                    onClick={handleSyncExtension}
                    disabled={extensionSynced}
                    className="shrink-0 flex items-center gap-1 px-3 py-2 text-[12px] font-medium transition cursor-pointer disabled:opacity-40 disabled:cursor-default"
                    style={{
                      background: extensionSynced ? "var(--bg-base)" : "var(--gold-primary)",
                      color: extensionSynced ? "var(--text-muted)" : "#0A0A0A",
                      border: extensionSynced ? "1px solid var(--border-default)" : "none",
                    }}
                  >
                    {extensionSynced ? (extensionPath.trim() ? "✓ 已同步" : "未加载") : "同步"}
                  </button>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-1 space-y-0.5">
                  <span className="block"><span className="text-[var(--gold-primary)]">★ 推荐</span> 使用 <span className="font-mono text-[var(--text-secondary)]">Ghelper</span> 等浏览器 VPN 扩展的用户，填写扩展目录路径即可在 Playwright 中加载扩展。</span>
                  <span className="block">查找方法：Chrome 地址栏输入 <span className="font-mono text-[var(--text-secondary)]">chrome://extensions</span> → 开启「开发者模式」→ 复制<span className="text-[var(--text-secondary)]">扩展 ID</span>。</span>
                  <span className="block">扩展目录一般在：<span className="font-mono text-[var(--text-secondary)]">%LOCALAPPDATA%\Google\Chrome\User Data\Default\Extensions\扩展ID\版本号\</span></span>
                  <span className="block">首次加载后需在弹出的浏览器中<span className="text-yellow-500">登录扩展账号</span>，之后登录状态会自动保存。</span>
                  <span className="block text-[var(--text-muted)]">修改路径后需<span className="text-yellow-500">重启浏览器</span>才能生效。留空表示不加载扩展。</span>
                </p>
              </div>
            </div>
          </div>

          {/* ── Browser Status & Control ── */}
          <div className="border border-[var(--border-default)] bg-[var(--bg-surface)]">
            <div className="px-5 py-3 border-b border-[var(--border-default)] flex items-center gap-2">
              <Monitor size={16} className="text-[var(--gold-primary)]" />
              <span className="text-[14px] font-medium text-[var(--text-primary)]">浏览器控制</span>
            </div>
            <div className="p-5 space-y-4">
              {/* Status indicators */}
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  {isLaunched ? (
                    <CheckCircle size={14} className="text-green-400" />
                  ) : (
                    <XCircle size={14} className="text-[var(--text-muted)]" />
                  )}
                  <span className="text-[13px] text-[var(--text-primary)]">
                    浏览器: {isLaunched ? "已启动" : "未启动"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {isLoggedIn ? (
                    <CheckCircle size={14} className="text-green-400" />
                  ) : (
                    <XCircle size={14} className="text-[var(--text-muted)]" />
                  )}
                  <span className="text-[13px] text-[var(--text-primary)]">
                    登录状态: {isLoggedIn ? "已登录" : "未登录"}
                  </span>
                </div>
                {isLaunched && (
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-[var(--text-muted)]">
                      活跃标签页: {status?.activeTabs ?? 0}
                    </span>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3">
                {!isLaunched ? (
                  <button
                    onClick={handleLaunch}
                    disabled={loading !== null}
                    className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-[12px] font-medium text-white hover:bg-green-500 transition cursor-pointer disabled:opacity-40"
                  >
                    {loading === "start-service" ? <Loader size={14} className="animate-spin" /> :
                     loading === "launch" ? <Loader size={14} className="animate-spin" /> : <Power size={14} />}
                    {loading === "start-service" ? "正在启动服务..." :
                     loading === "launch" ? "启动中..." : "启动浏览器"}
                  </button>
                ) : (
                  <button
                    onClick={handleClose}
                    disabled={loading !== null}
                    className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-[12px] font-medium text-white hover:bg-red-500 transition cursor-pointer disabled:opacity-40"
                  >
                    {loading === "close" ? <Loader size={14} className="animate-spin" /> : <PowerOff size={14} />}
                    {loading === "close" ? "关闭中..." : "关闭浏览器"}
                  </button>
                )}
                <button
                  onClick={handleCheckLogin}
                  disabled={loading !== null || !isLaunched}
                  className="flex items-center gap-1.5 px-4 py-2 border border-[var(--border-default)] text-[12px] font-medium text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-40"
                >
                  {loading === "check" ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  检查登录
                </button>
                <button
                  onClick={handleStopService}
                  disabled={loading !== null}
                  className="flex items-center gap-1.5 px-4 py-2 border border-red-800 text-[12px] font-medium text-red-400 hover:bg-red-900/30 hover:border-red-600 transition cursor-pointer disabled:opacity-40"
                  title="终止 3099 端口服务进程，方便修改代码后重启"
                >
                  {loading === "stop-service" ? <Loader size={14} className="animate-spin" /> : <Square size={14} />}
                  关闭终端
                </button>
              </div>

              {/* ── Gemini Mode Toggle: Pro / Thinking ── */}
              <div className="flex items-center gap-4 pt-2">
                <span className="text-[12px] text-[var(--text-muted)]">生图模式</span>
                <div className="flex items-center gap-0 border border-[var(--border-default)] rounded overflow-hidden">
                  <button
                    onClick={() => {
                      setGeminiMode("pro");
                      saveGeminiTabSettings({ serviceUrl, maxConcurrentTabs, headless, chromePath, geminiMode: "pro", gemUrl, proxyServer, extensionPath, initialWaitMs, warmupChance, downloadMode });
                    }}
                    className={`px-4 py-1.5 text-[12px] font-medium transition cursor-pointer ${
                      geminiMode === "pro"
                        ? "bg-[var(--gold-primary)] text-[#0A0A0A]"
                        : "bg-[var(--bg-base)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    Pro
                  </button>
                  <button
                    onClick={() => {
                      setGeminiMode("thinking");
                      saveGeminiTabSettings({ serviceUrl, maxConcurrentTabs, headless, chromePath, geminiMode: "thinking", gemUrl, proxyServer, extensionPath, initialWaitMs, warmupChance, downloadMode });
                    }}
                    className={`px-4 py-1.5 text-[12px] font-medium transition cursor-pointer ${
                      geminiMode === "thinking"
                        ? "bg-blue-600 text-white"
                        : "bg-[var(--bg-base)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    Thinking
                  </button>
                </div>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {geminiMode === "pro"
                    ? "Pro 模式：每天 100 次额度，生图质量最高"
                    : "Thinking 模式：无额度限制，若返回文字会自动追问获取图片"}
                </span>
              </div>

              {/* Login hint */}
              {isLaunched && !isLoggedIn && (
                <div className="flex items-start gap-2 px-4 py-3 bg-yellow-900/20 border border-yellow-700/30 text-[12px]">
                  <AlertTriangle size={14} className="text-yellow-400 shrink-0 mt-0.5" />
                  <span className="text-yellow-200">
                    请在自动打开的浏览器窗口中手动登录 Google 账号。登录完成后点击「检查登录」确认状态。
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ── Concurrency Settings ── */}
          <div className="border border-[var(--border-default)] bg-[var(--bg-surface)]">
            <div className="px-5 py-3 border-b border-[var(--border-default)] flex items-center gap-2">
              <Settings2 size={16} className="text-[var(--gold-primary)]" />
              <span className="text-[14px] font-medium text-[var(--text-primary)]">生成参数</span>
              {/* Gemini 生图限制每天 1000 张 */}
              {status && (
                <span className={`ml-auto text-[13px] font-mono ${
                  (status.dailyGenerated ?? 0) >= 900 ? "text-red-400" :
                  (status.dailyGenerated ?? 0) >= 500 ? "text-yellow-400" :
                  "text-[var(--text-muted)]"
                }`}>
                  已生成 {status.dailyGenerated ?? 0} / 1000
                </span>
              )}
            </div>
            <div className="p-5 space-y-4">
              {/* ── 参数生效方式提示 ── */}
              <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-500/5 border border-amber-500/20 rounded">
                <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-[11px] text-amber-300/90 leading-relaxed">
                  <span className="font-semibold text-amber-300">参数即时生效</span> — 滑块拖动时自动同步到后端，无需重启浏览器。修改后下一次生图任务即按新参数执行。
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-[12px] text-[var(--text-muted)] mb-1">
                    最大并发标签页数
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={9}
                      value={maxConcurrentTabs}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setMaxConcurrentTabs(val);
                        // 热更新：如果浏览器已启动，自动同步并发数到后端
                        if (status?.isLaunched) {
                          callGeminiTabAPI("/api/browser", {
                            method: "POST",
                            body: JSON.stringify({ action: "set-concurrency", maxConcurrentTabs: val }),
                          }).catch(() => {});
                        }
                        // 同时保存到 localStorage
                        saveGeminiTabSettings({ serviceUrl, maxConcurrentTabs: val, headless, chromePath, geminiMode, gemUrl, proxyServer, extensionPath, initialWaitMs, warmupChance, downloadMode });
                      }}
                      className="flex-1 accent-[var(--gold-primary)]"
                    />
                    <span className="text-[14px] font-mono text-[var(--gold-primary)] w-6 text-center">
                      {maxConcurrentTabs}
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">
                    同时打开多少个浏览器标签页进行并发生图。建议 2-4，过高可能触发 Google 限流。
                  </p>
                </div>
                {isLaunched && (
                  <button
                    onClick={handleSetConcurrency}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer mt-4"
                  >
                    应用
                  </button>
                )}
              </div>

              {/* ── 图片提取模式切换 ── */}
              <div>
                <label className="block text-[12px] text-[var(--text-muted)] mb-1.5">
                  图片提取模式
                </label>
                <div className="flex items-center gap-2">
                  <button
                    disabled
                    title="自动提取模式已锁定，当前仅支持手动下载模式"
                    className="px-3 py-1.5 text-[12px] border border-[var(--border-default)] text-[var(--text-muted)]/40 cursor-not-allowed opacity-50"
                  >
                    🔒 自动提取
                  </button>
                  <button
                    onClick={() => {
                      setDownloadMode("manual");
                      if (status?.isLaunched) {
                        callGeminiTabAPI("/api/browser", {
                          method: "POST",
                          body: JSON.stringify({ action: "set-download-mode", downloadMode: "manual" }),
                        }).catch(() => {});
                      }
                      saveGeminiTabSettings({ serviceUrl, maxConcurrentTabs, headless, chromePath, geminiMode, gemUrl, proxyServer, extensionPath, initialWaitMs, warmupChance, downloadMode: "manual" });
                    }}
                    className="px-3 py-1.5 text-[12px] border transition cursor-pointer border-[var(--gold-primary)] bg-[var(--gold-primary)]/10 text-[var(--gold-primary)]"
                  >
                    手动下载
                  </button>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                  生成完成后，请在浏览器中手动点击「下载」按钮，软件会自动捕获并导入。最长等待 5 分钟。
                </p>
              </div>

              {/* ── 下载等待时间滑块（仅自动模式显示） ── */}
              {downloadMode === "auto" && (
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-[12px] text-[var(--text-muted)] mb-1">
                    下载等待时间
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={15}
                      step={0.5}
                      value={initialWaitMs / 1000}
                      onChange={(e) => {
                        const sec = Number(e.target.value);
                        const ms = Math.round(sec * 1000);
                        setInitialWaitMs(ms);
                        // 热更新
                        if (status?.isLaunched) {
                          callGeminiTabAPI("/api/browser", {
                            method: "POST",
                            body: JSON.stringify({ action: "set-initial-wait", initialWaitMs: ms }),
                          }).catch(() => {});
                        }
                        saveGeminiTabSettings({ serviceUrl, maxConcurrentTabs, headless, chromePath, geminiMode, gemUrl, proxyServer, extensionPath, initialWaitMs: ms, warmupChance, downloadMode });
                      }}
                      className="flex-1 accent-[var(--gold-primary)]"
                    />
                    <span className="text-[14px] font-mono text-[var(--gold-primary)] w-10 text-center">
                      {(initialWaitMs / 1000).toFixed(1)}s
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">
                    发送提示词后等待 Gemini 开始生成图片的时间。Gemini 响应快时可调低（如 2-3s），响应慢时调高。默认 5s。
                  </p>
                </div>
              </div>
              )}

              {/* ── 预热聊天概率滑块 ── */}
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-[12px] text-[var(--text-muted)] mb-1">
                    预热聊天概率
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={10}
                      value={warmupChance}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setWarmupChance(val);
                        // 热更新
                        if (status?.isLaunched) {
                          callGeminiTabAPI("/api/browser", {
                            method: "POST",
                            body: JSON.stringify({ action: "set-warmup-chance", warmupChance: val / 100 }),
                          }).catch(() => {});
                        }
                        saveGeminiTabSettings({ serviceUrl, maxConcurrentTabs, headless, chromePath, geminiMode, gemUrl, proxyServer, extensionPath, initialWaitMs, warmupChance: val, downloadMode });
                      }}
                      className="flex-1 accent-[var(--gold-primary)]"
                    />
                    <span className="text-[14px] font-mono text-[var(--gold-primary)] w-10 text-center">
                      {warmupChance}%
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">
                    每次生图前随机发送「预热」聊天的概率，模拟真人操作降低自动化检测风险。0% = 从不预热，100% = 每次都预热。默认 30%。
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={headless}
                    onChange={(e) => setHeadless(e.target.checked)}
                    className="accent-[var(--gold-primary)]"
                  />
                  <span className="text-[13px] text-[var(--text-primary)]">无头模式（Headless）</span>
                </label>
                <span className="text-[11px] text-[var(--text-muted)]">
                  首次使用请取消勾选，以便手动登录 Google 账号
                </span>
              </div>

              {/* Chrome 可执行文件路径（可选） */}
              <div>
                <label className="block text-[12px] text-[var(--text-muted)] mb-1">
                  Chrome 可执行文件路径（可选）
                </label>
                <input
                  type="text"
                  value={chromePath}
                  onChange={(e) => setChromePath(e.target.value)}
                  placeholder="留空自动检测，如: C:\Program Files\Google\Chrome\Application\chrome.exe"
                  className="w-full px-3 py-2 bg-[var(--bg-base)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--gold-primary)] outline-none transition"
                />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">
                  启动优先级：自定义路径 → Google Chrome → Microsoft Edge → 内置 Chromium。留空时自动按优先级探测。
                </p>
              </div>
            </div>
          </div>

          {/* ── Logs ── */}
          <div className="border border-[var(--border-default)] bg-[var(--bg-surface)]">
            <div className="px-5 py-3 border-b border-[var(--border-default)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-medium text-[var(--text-primary)]">运行日志</span>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {logs.length} 条
                </span>
              </div>
              <button
                onClick={() => setLogs([])}
                className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
              >
                清空
              </button>
            </div>
            <div
              ref={logContainerRef}
              className="h-[200px] overflow-auto p-4 font-mono text-[11px] leading-5 bg-[var(--bg-base)]"
            >
              {logs.length === 0 ? (
                <span className="text-[var(--text-muted)]">暂无日志。启动浏览器后将显示实时日志。</span>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className={`${
                    log.level === "error" ? "text-red-400"
                      : log.level === "success" ? "text-green-400"
                      : log.level === "warn" ? "text-yellow-400"
                      : "text-[var(--text-secondary)]"
                  }`}>
                    <span className="text-[var(--text-muted)] mr-2">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    {log.message}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── Usage Guide ── */}
          <div className="border border-[var(--border-default)] bg-[var(--bg-surface)]">
            <div className="px-5 py-3 border-b border-[var(--border-default)]">
              <span className="text-[14px] font-medium text-[var(--text-primary)]">使用说明</span>
            </div>
            <div className="p-5 text-[12px] text-[var(--text-secondary)] space-y-3 leading-relaxed">
              <p>
                <strong className="text-[var(--text-primary)]">Gemini Tab</strong> 通过浏览器自动化操作
                Google Gemini 的 Imagen 3 (nanobananan PRO) 进行生图，<strong>无需 API Key</strong>，仅需登录 Google 账号。
              </p>
              <ol className="list-decimal list-inside space-y-1.5 pl-2">
                <li>确保 Gemini Tab 服务已启动（默认端口 3099）</li>
                <li>点击「启动浏览器」，在弹出的 Chrome 窗口中登录 Google 账号</li>
                <li>点击「检查登录」确认状态变绿</li>
                <li>回到「生图工作台」，在顶部栏切换为「Gemini Tab」模式即可开始生图</li>
              </ol>
              <p className="text-[var(--text-muted)]">
                提示：Gemini Tab 模式下，提示词和参考图通过浏览器自动提交给 Gemini 网页端处理，生成结果自动回传。
                原有的提示词输入、参考图绑定等面板完全复用，无需额外配置。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
