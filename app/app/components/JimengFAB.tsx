"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Diamond, X, AlertCircle, CheckCircle, Loader, GripVertical,
  Stethoscope, Cookie, Trash2, ChevronRight, ChevronDown, ChevronUp, Clock, Eye,
  HelpCircle, ImageIcon, ChevronsUpDown, Lock, Unlock,
} from "lucide-react";
import { getJimengTaskStore, type JimengClientTask } from "../lib/jimeng-image/clientTaskStore";

// ═══════════════════════════════════════════════════════════
// JimengFAB — 即梦生图悬浮控制面板（可拖拽）
// 功能：后台任务监控、生成历史（缩略图）、Cookie管理、诊断
// ═══════════════════════════════════════════════════════════

interface JimengFABProps {
  visible: boolean;
  modelLabel: string;
  resolution: string;
  count: number;
  /** 当前选中的格子 key，如 "nine-ep01-3" */
  activeCellKey?: string;
  /** 点击缩略图预览 */
  onPreviewImage?: (url: string, title: string) => void;
  /** 点击历史任务"选图"按钮，打开四选一弹窗 */
  onPickFromTask?: (task: JimengClientTask) => void;
}

const POS_KEY = "feicai-jimeng-fab-pos";

function loadSavedPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) { const p = JSON.parse(raw); if (typeof p.x === "number" && typeof p.y === "number") return p; }
  } catch { /* */ }
  return null;
}

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}秒`;
  return `${Math.floor(s / 60)}分${s % 60}秒`;
}

export default function JimengFAB({ visible, modelLabel, resolution, count, activeCellKey, onPreviewImage, onPickFromTask }: JimengFABProps) {
  const [expanded, setExpanded] = useState(false);
  const [tasks, setTasks] = useState<JimengClientTask[]>([]);
  const [newCount, setNewCount] = useState(0);

  // Cookie
  const [cookieStr, setCookieStr] = useState("");
  const [cookieSaved, setCookieSaved] = useState(false);
  const [showCookie, setShowCookie] = useState(false);
  const [showCookieHelp, setShowCookieHelp] = useState(false);

  // Diagnostics
  const [diagRunning, setDiagRunning] = useState(false);
  const [diagResult, setDiagResult] = useState<string | null>(null);
  const [showDiag, setShowDiag] = useState(false);

  // Tick 刷新活跃任务耗时
  const [, setTick] = useState(0);

  // ── 订阅全局任务管理器 ──
  useEffect(() => {
    const store = getJimengTaskStore();
    if (!store) return;
    const sync = () => {
      setTasks(store.getSnapshot());
      setNewCount(store.getNewCompletedCount());
    };
    sync();
    return store.subscribe(sync);
  }, []);

  // ── 安全兜底：定期重同步任务状态（防止首次添加任务时 React batching 丢失更新） ──
  useEffect(() => {
    const iv = setInterval(() => {
      const store = getJimengTaskStore();
      if (store) setTasks(store.getSnapshot());
    }, 2000);
    return () => clearInterval(iv);
  }, []);

  // 每秒刷新（活跃任务实时耗时）
  useEffect(() => {
    if (!tasks.some(t => t.status === "polling")) return;
    const iv = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, [tasks]);

  // 读取已存的 Cookie
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("feicai-seedance-settings") || "{}");
      if (s.jimengRawCookies) setCookieStr(s.jimengRawCookies);
    } catch { /* */ }
  }, []);

  // 打开面板时清除新完成计数 + 申请通知权限
  useEffect(() => {
    if (!expanded) return;
    const store = getJimengTaskStore();
    store?.clearNewCompleted();
    setNewCount(0);
    store?.requestNotificationPermission();
  }, [expanded]);

  // ── 拖拽逻辑 ──
  const containerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => loadSavedPos() || { x: 24, y: 24 });
  const drag = useRef({ sx: 0, sy: 0, px: 0, py: 0, active: false, moved: false });

  const savePos = useCallback((p: { x: number; y: number }) => {
    try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* */ }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const d = drag.current;
    d.sx = e.clientX; d.sy = e.clientY; d.px = pos.x; d.py = pos.y;
    d.active = true; d.moved = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.active) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    d.moved = true;
    setPos({
      x: Math.max(8, Math.min(d.px - dx, window.innerWidth - 80)),
      y: Math.max(8, Math.min(d.py - dy, window.innerHeight - 60)),
    });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ }
    if (d.moved) {
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      const final = {
        x: Math.max(8, Math.min(d.px - dx, window.innerWidth - 80)),
        y: Math.max(8, Math.min(d.py - dy, window.innerHeight - 60)),
      };
      setPos(final);
      savePos(final);
    }
  }, [savePos]);

  const handleClick = useCallback(() => { if (!drag.current.moved) setExpanded(v => !v); }, []);

  useEffect(() => {
    const h = () => setPos(p => ({
      x: Math.min(p.x, window.innerWidth - 80),
      y: Math.min(p.y, window.innerHeight - 60),
    }));
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);

  // ── Cookie 保存 ──
  const handleSaveCookie = useCallback(() => {
    try {
      const raw = localStorage.getItem("feicai-seedance-settings");
      const s = raw ? JSON.parse(raw) : {};
      s.jimengRawCookies = cookieStr.trim();
      localStorage.setItem("feicai-seedance-settings", JSON.stringify(s));
      setCookieSaved(true);
      setTimeout(() => setCookieSaved(false), 2000);
    } catch { /* */ }
  }, [cookieStr]);

  // ── 浏览器代理诊断 ──
  const handleDiagnose = useCallback(async () => {
    if (diagRunning) return;
    setDiagRunning(true);
    setDiagResult(null);
    try {
      const raw = localStorage.getItem("feicai-seedance-settings");
      if (!raw) { setDiagResult("❌ 未找到凭证，请先在设置页配置"); return; }
      const cred = JSON.parse(raw);
      if (!cred.sessionId || !cred.webId || !cred.userId) { setDiagResult("❌ 凭证不完整"); return; }
      const resp = await fetch("/api/jimeng-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "diagnose", sessionId: cred.sessionId, webId: cred.webId, userId: cred.userId }),
      });
      const data = await resp.json();
      const lines: string[] = [];
      for (const s of data.steps || []) {
        if (s.step === "navigateTo" && s.status === "ok") lines.push(`✅ 导航: ${s.pageUrl}`);
        if (s.step === "bdmsDiag" && s.status === "ok") {
          lines.push(`🔧 bdms: ${s.hasBdms ? "✅" : "❌"} | crawler: ${s.hasCrawler ? "✅" : "❌"} | fetchPatch: ${s.isPatched ? "✅" : "❌"}`);
          lines.push(`🔑 msToken: ${s.msToken || "❌ 无"}`);
          lines.push(`🍪 Cookies(${s.cookieCount}): ${s.allCookies}`);
        }
        if (s.step === "testFetch" && s.status === "ok") {
          lines.push(`🔗 a_bogus: ${s.a_bogus ? "✅" : "❌"} | msToken: ${s.msToken_in_url ? "✅" : "❌"}`);
          if (s.result?.status) lines.push(`📡 HTTP ${s.result.status} (${s.result.bodyLen}字)`);
        }
        if (s.step === "error") lines.push(`❌ ${s.message}`);
      }
      setDiagResult(lines.join("\n") || JSON.stringify(data, null, 2));
    } catch (err) {
      setDiagResult(`❌ ${(err as Error).message}`);
    } finally {
      setDiagRunning(false);
    }
  }, [diagRunning]);

  // ── 分类任务 ──
  const activeTasks = tasks.filter(t => t.status === "polling");
  const historyTasks = [...tasks].filter(t => t.status !== "polling").reverse();
  const isGenerating = activeTasks.length > 0;

  // ── 当前选中格子匹配的任务 ID（用于高亮+自动滚动） ──
  const matchedTaskId = useMemo(() => {
    if (!activeCellKey) return null;
    // 优先找锁定的，其次找最近的匹配任务
    const locked = historyTasks.find(t => t.targetGridKey === activeCellKey && t.locked && t.status !== "error");
    if (locked) return locked.taskId;
    const recent = historyTasks.find(t => t.targetGridKey === activeCellKey && t.status !== "error");
    return recent?.taskId ?? null;
  }, [activeCellKey, historyTasks]);

  // ── 自动滚动到匹配的历史卡片 ──
  const matchedCardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expanded || !matchedTaskId || !matchedCardRef.current) return;
    // 延迟一帧确保 DOM 已渲染
    requestAnimationFrame(() => {
      matchedCardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }, [expanded, matchedTaskId]);

  if (!visible && !isGenerating) return null;

  return (
    <div
      ref={containerRef}
      className="fixed z-50 flex flex-col items-end gap-2 select-none"
      style={{ right: `${pos.x}px`, bottom: `${pos.y}px` }}
    >
      {/* ═══ 展开面板 ═══ */}
      {expanded && (
        <div className="bg-[#111] border border-[var(--gold-primary)]/30 rounded-xl shadow-2xl w-[440px] max-h-[75vh] flex flex-col
          animate-in fade-in slide-in-from-bottom-2 duration-200">

          {/* ── 头部 ── */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#222] shrink-0">
            <span className="text-[14px] font-bold text-[var(--gold-primary)] flex items-center gap-1.5">
              <Diamond size={15} /> 即梦生图引擎
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-[var(--text-muted)]">{modelLabel} · {resolution} · {count}张</span>
              <button
                onClick={() => setExpanded(false)}
                className="text-white/40 hover:text-white p-1 rounded hover:bg-white/10 transition cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* ── 前置条件提示 ── */}
          <div className="px-4 pt-2.5 pb-0 shrink-0">
            <div className="p-2.5 bg-amber-500/5 border border-amber-500/15 rounded-lg text-[12px] leading-relaxed text-[var(--text-secondary)]">
              <span className="text-amber-400 font-medium">⚡ 前置条件：</span>
              需先到 <span className="text-[var(--gold-primary)]">左侧 Seedance 页面 → 设置弹窗</span> 中填写即梦的
              <span className="text-cyan-400"> sessionId / webId / userId </span>
              三项登录凭证（F12 → Application → localStorage → <code className="text-[11px] bg-black/30 px-0.5 rounded">feicai-seedance-settings</code>）。
              下方 Cookie 仅在遇到 3018 错误时需要补充。
            </div>
          </div>

          {/* ── 任务列表（可滚动） ── */}
          <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-2.5">

            {/* 活跃任务 */}
            {activeTasks.map(t => {
              const elapsed = Date.now() - t.startTime;
              return (
                <div key={t.taskId} className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <Loader size={14} className="animate-spin text-amber-400 shrink-0" />
                    <span className="text-[13px] text-white/90 font-medium truncate flex-1">{t.label}</span>
                    <span className="text-[12px] text-amber-400/70 flex items-center gap-0.5">
                      <Clock size={11} /> {fmtElapsed(elapsed)}
                    </span>
                  </div>
                  <div className="mt-1.5 text-[12px] text-[var(--text-muted)] flex items-center gap-2">
                    <span>{t.model}</span>
                    <span>·</span>
                    <span>{t.resolution}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500/40 to-amber-400/70 rounded-full transition-all duration-1000"
                        style={{ width: `${Math.min(95, (elapsed / 120000) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-amber-400/50 whitespace-nowrap">生成中</span>
                  </div>
                </div>
              );
            })}

            {/* 历史标题 */}
            {historyTasks.length > 0 && (
              <div>
                <div className="flex items-center justify-between pt-2 pb-0.5">
                  <span className="text-[12px] text-[var(--text-muted)] font-medium">
                    生成历史 ({historyTasks.length})
                  </span>
                  <button
                    onClick={() => getJimengTaskStore()?.clearHistory()}
                    className="text-[11px] text-[var(--text-muted)] hover:text-red-400 transition cursor-pointer flex items-center gap-0.5"
                  >
                    <Trash2 size={11} /> 清除
                  </button>
                </div>
                <p className="text-[11px] text-[var(--text-muted)]/60 leading-tight pb-1">
                  💡 先在右侧点选目标格子，再点「选图应用到当前格」即可替换
                </p>
              </div>
            )}

            {/* 历史任务卡片 */}
            {historyTasks.map(t => {
              const elapsed = (t.endTime || Date.now()) - t.startTime;
              const isErr = t.status === "error";
              const hasTarget = !!(t.targetListKey && t.targetItemId) || !!t.targetGridKey;
              const isMatched = t.taskId === matchedTaskId;
              return (
                <div
                  key={t.taskId}
                  ref={isMatched ? matchedCardRef : undefined}
                  className={`rounded-lg p-3 relative group/card transition-all duration-300 ${
                    isMatched
                      ? "bg-[var(--gold-primary)]/10 border-2 border-[var(--gold-primary)] ring-1 ring-[var(--gold-primary)]/30 shadow-[0_0_12px_rgba(201,169,98,0.25)]"
                      : isErr
                        ? "bg-red-500/5 border border-red-500/15"
                        : "bg-emerald-500/5 border border-emerald-500/15"
                  }`}
                >
                  {/* ★ 单条删除按钮（悬浮显示） */}
                  <button
                    onClick={() => getJimengTaskStore()?.removeTask(t.taskId)}
                    className="absolute top-2 right-2 p-0.5 rounded bg-black/60 text-white/30
                      hover:text-red-400 hover:bg-black/80 transition opacity-0 group-hover/card:opacity-100 cursor-pointer z-10"
                    title="删除此条记录"
                  >
                    <X size={12} />
                  </button>

                  {/* ★ 当前格匹配标记 */}
                  {isMatched && (
                    <span className="absolute top-2 left-3 text-[10px] font-bold text-[var(--gold-primary)] bg-[var(--gold-primary)]/15 border border-[var(--gold-primary)]/40 px-1.5 py-0.5 rounded-full animate-in fade-in duration-300">
                      ◆ 当前格
                    </span>
                  )}

                  <div className="flex items-center gap-2 pr-6">
                    {isErr
                      ? <AlertCircle size={13} className="text-red-400 shrink-0" />
                      : <CheckCircle size={13} className="text-emerald-400 shrink-0" />}
                    <span className="text-[13px] text-white/90 font-medium truncate flex-1">{t.label}</span>
                    <span className="text-[12px] text-[var(--text-muted)] flex items-center gap-0.5">
                      <Clock size={11} /> {fmtElapsed(elapsed)}
                    </span>
                    {!isErr && (
                      <span className="text-[12px] text-emerald-400/70 whitespace-nowrap">{t.images.length}张</span>
                    )}
                  </div>

                  {/* 模型信息 */}
                  <div className="mt-1.5 text-[12px] text-[var(--text-muted)]">
                    {t.model} · {t.resolution}
                  </div>

                  {/* 错误信息 */}
                  {isErr && t.error && (
                    <p className="mt-1.5 text-[12px] text-red-400/70 leading-tight">{t.error}</p>
                  )}

                  {/* 缩略图网格 */}
                  {!isErr && t.images.length > 0 && (
                    <div className="mt-2.5 grid grid-cols-4 gap-2">
                      {t.images.map((url, i) => {
                        const isSelected = (t.selectedIndex ?? -1) === i;
                        const isLocked = isSelected && t.locked;
                        return (
                        <button
                          key={i}
                          onClick={() => onPreviewImage?.(url, `${t.label} #${i + 1}`)}
                          className={`aspect-[4/3] rounded-md overflow-hidden bg-black/40 border
                            hover:border-[var(--gold-primary)]/60 hover:shadow-[0_0_8px_rgba(201,169,98,0.15)]
                            transition cursor-pointer group relative ${
                              isSelected
                                ? "border-[var(--gold-primary)] ring-1 ring-[var(--gold-primary)]/40 shadow-[0_0_6px_rgba(201,169,98,0.2)]"
                                : "border-white/5"
                            }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt={`#${i + 1}`} className="w-full h-full object-contain" draggable={false} />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition flex items-center justify-center">
                            <Eye size={16} className="text-white/0 group-hover:text-white/80 transition drop-shadow" />
                          </div>
                          <span className="absolute bottom-0.5 right-0.5 text-[10px] text-white/50 bg-black/50 rounded px-0.5">
                            {i + 1}
                          </span>
                          {/* 选中标记 + 锁定指示 */}
                          {isSelected && (
                            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full flex items-center justify-center shadow ${
                              isLocked ? "bg-emerald-500" : "bg-[var(--gold-primary)]"
                            }`}>
                              {isLocked
                                ? <Lock size={10} className="text-white" />
                                : <CheckCircle size={12} className="text-black" />
                              }
                            </span>
                          )}
                        </button>
                        );
                      })}
                    </div>
                  )}

                  {/* 选图并应用按钮 + 锁定状态 */}
                  {!isErr && t.images.length > 0 && (
                    <div className="mt-2.5 flex gap-2">
                      <button
                        onClick={() => onPickFromTask?.(t)}
                        className="flex-1 py-2 text-[12px] font-medium rounded-md border transition cursor-pointer flex items-center justify-center gap-1.5
                          text-[var(--gold-primary)] border-[var(--gold-primary)]/30 bg-[var(--gold-primary)]/5 hover:bg-[var(--gold-primary)]/15"
                      >
                        <ImageIcon size={13} />
                        {hasTarget ? "选图并应用" : "选图应用到当前格"}
                      </button>
                      {/* 锁定/解锁按钮 */}
                      {t.selectedIndex != null && t.selectedIndex >= 0 && (
                        <button
                          onClick={() => {
                            const store = getJimengTaskStore();
                            if (t.locked) store.unlockSelection(t.taskId);
                            else store.lockSelection(t.taskId);
                          }}
                          title={t.locked ? "点击解锁，允许重新选图" : "点击锁定当前选图"}
                          className={`px-2 py-2 text-[12px] rounded-md border transition cursor-pointer flex items-center justify-center gap-1 ${
                            t.locked
                              ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20"
                              : "text-[var(--text-muted)] border-white/10 bg-white/[.03] hover:bg-white/[.06]"
                          }`}
                        >
                          {t.locked ? <Lock size={12} /> : <Unlock size={12} />}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* 空状态 */}
            {activeTasks.length === 0 && historyTasks.length === 0 && (
              <div className="py-10 text-center">
                <Diamond size={28} className="mx-auto mb-2 text-[var(--gold-primary)]/20" />
                <p className="text-[13px] text-[var(--text-muted)]">暂无生成记录</p>
                <p className="text-[12px] text-[var(--text-muted)]/50 mt-1">在角色/场景/道具卡片中点击「AI 生图」使用即梦</p>
              </div>
            )}
          </div>

          {/* ── Cookie 区域（折叠） ── */}
          <div className="border-t border-[#222] shrink-0">
            <button
              onClick={() => setShowCookie(!showCookie)}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[.03] transition cursor-pointer"
            >
              <span className="text-[12px] text-amber-400 flex items-center gap-1">
                <Cookie size={12} /> 完整 Cookie（解决 3018）
                {cookieStr && (
                  <span className="text-[var(--text-muted)]">
                    · {cookieStr.split(";").filter(Boolean).length}个
                  </span>
                )}
              </span>
              <ChevronRight
                size={12}
                className={`text-[var(--text-muted)] transition-transform duration-200 ${showCookie ? "rotate-90" : ""}`}
              />
            </button>
            {showCookie && (
              <div className="px-4 pb-3 space-y-2">
                {/* Cookie 获取教程 */}
                <button
                  onClick={() => setShowCookieHelp(!showCookieHelp)}
                  className="flex items-center gap-1 text-[12px] text-[var(--gold-primary)]/70 hover:text-[var(--gold-primary)] transition cursor-pointer"
                >
                  <HelpCircle size={12} />
                  <span>{showCookieHelp ? "收起" : "如何获取 Cookie？"}</span>
                </button>
                {showCookieHelp && (
                  <div className="p-2.5 bg-[var(--gold-primary)]/5 border border-[var(--gold-primary)]/15 rounded text-[12px] text-[var(--text-secondary)] leading-relaxed space-y-1">
                    <p className="font-medium text-[var(--gold-primary)]">获取即梦 Cookie 步骤：</p>
                    <p>① 打开浏览器，访问 <span className="text-cyan-400">jimeng.jianying.com</span>，确保已登录</p>
                    <p>② 按 <kbd className="px-1 py-0.5 bg-black/30 rounded text-[11px] text-white/80">F12</kbd> 打开开发者工具</p>
                    <p>③ 切换到 <span className="text-cyan-400">Network（网络）</span> 标签页</p>
                    <p>④ 在即梦页面上随意操作（如刷新页面、点击功能），让网络面板出现请求</p>
                    <p>⑤ 点击任意一个请求 → 在右侧 <span className="text-cyan-400">Headers（标头）</span> 中找到 <span className="text-amber-400">Cookie</span> 字段</p>
                    <p>⑥ 全选并复制整个 Cookie 值（一长串文本），粘贴到下方输入框</p>
                    <p className="text-[var(--text-muted)] italic mt-1">⚠ Cookie 有时效性，过期后需重新获取</p>
                  </div>
                )}
                <textarea
                  rows={3}
                  placeholder="从即梦网站 F12 → Network → 复制请求头中的 Cookie 值粘贴到此处"
                  value={cookieStr}
                  onChange={e => { setCookieStr(e.target.value); setCookieSaved(false); }}
                  className="w-full text-[12px] p-2.5 bg-black/40 border border-[var(--border-default)] rounded
                    text-[var(--text-secondary)] placeholder-[var(--text-muted)]/50 resize-none
                    focus:outline-none focus:border-[var(--gold-primary)]/50"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveCookie}
                    className="text-[12px] px-3 py-1 bg-[var(--gold-primary)]/20 text-[var(--gold-primary)]
                      border border-[var(--gold-primary)]/30 rounded hover:bg-[var(--gold-primary)]/30 transition cursor-pointer"
                  >
                    保存
                  </button>
                  {cookieSaved && <span className="text-[12px] text-emerald-400">✅ 已保存</span>}
                </div>
              </div>
            )}
          </div>

          {/* ── 诊断区域（折叠） ── */}
          <div className="border-t border-[#222] shrink-0">
            <button
              onClick={() => { setShowDiag(!showDiag); if (!showDiag && !diagResult) handleDiagnose(); }}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[.03] transition cursor-pointer"
            >
              <span className="text-[12px] text-cyan-400 flex items-center gap-1">
                <Stethoscope size={12} /> 浏览器代理诊断
                {diagRunning && <Loader size={11} className="animate-spin ml-1" />}
              </span>
              <div className="flex items-center gap-1">
                {showDiag && (
                  <span className="text-[11px] text-[var(--text-muted)]">收起</span>
                )}
                <ChevronsUpDown
                  size={12}
                  className={`text-[var(--text-muted)] transition-transform duration-200 ${showDiag ? "rotate-180" : ""}`}
                />
              </div>
            </button>
            {showDiag && (
              <div className="px-4 pb-3">
                {diagResult ? (
                  <pre className="p-2.5 text-[11px] bg-black/50 rounded border border-[var(--border-default)]
                    text-[var(--text-secondary)] whitespace-pre-wrap max-h-[180px] overflow-y-auto leading-relaxed">
                    {diagResult}
                  </pre>
                ) : (
                  <div className="py-3 text-center text-[12px] text-[var(--text-muted)]">
                    {diagRunning ? "诊断中..." : "点击运行诊断"}
                  </div>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={handleDiagnose}
                    disabled={diagRunning}
                    className="flex-1 py-1.5 text-[12px] text-cyan-400 border border-cyan-500/20 rounded
                      hover:bg-cyan-500/10 transition cursor-pointer disabled:opacity-40"
                  >
                    {diagRunning ? "诊断中..." : "重新诊断"}
                  </button>
                  <button
                    onClick={() => setShowDiag(false)}
                    className="px-3 py-1.5 text-[12px] text-[var(--text-muted)] border border-[#333] rounded
                      hover:bg-white/5 hover:text-white/70 transition cursor-pointer"
                  >
                    收起
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ 主浮动按钮（可拖拽） ═══ */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={handleClick}
        className={`group relative flex items-center gap-1.5 px-3.5 py-2.5 rounded-full shadow-lg transition-colors duration-200 touch-none
          cursor-grab active:cursor-grabbing
          ${isGenerating
            ? "bg-gradient-to-r from-amber-600/90 to-amber-500/90 border border-amber-400/50"
            : "bg-gradient-to-r from-[#1a1508] to-[#141414] border border-[var(--gold-primary)]/40 hover:border-[var(--gold-primary)]/80"
          }`}
      >
        <GripVertical size={12} className="text-white/20 group-hover:text-white/40 transition shrink-0" />
        {isGenerating && (
          <span className="absolute inset-0 rounded-full animate-ping bg-amber-500/20 pointer-events-none" />
        )}
        <Diamond size={16} className={`shrink-0 ${isGenerating ? "text-white animate-pulse" : "text-[var(--gold-primary)]"}`} />
        <span className={`text-[14px] font-semibold whitespace-nowrap ${isGenerating ? "text-white" : "text-[var(--gold-primary)]"}`}>
          即梦
        </span>
        <span className={`text-[12px] whitespace-nowrap ${isGenerating ? "text-white/70" : "text-[var(--text-muted)]"}`}>
          {resolution}
        </span>
        {expanded
          ? <ChevronDown size={14} className="text-[var(--text-muted)] shrink-0" />
          : <ChevronUp size={14} className="text-[var(--text-muted)] shrink-0" />}

        {/* 新任务完成徽标（面板关闭时显示） */}
        {newCount > 0 && !expanded && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-[20px] rounded-full bg-emerald-500
            text-[11px] text-white font-bold flex items-center justify-center px-1 shadow-md
            animate-in zoom-in duration-300">
            {newCount}
          </span>
        )}

        {/* 活跃任务数徽标 */}
        {isGenerating && activeTasks.length > 0 && (
          <span className="absolute -top-1 -left-1 min-w-[18px] h-[18px] rounded-full bg-amber-500
            text-[11px] text-black font-bold flex items-center justify-center px-0.5 shadow">
            {activeTasks.length}
          </span>
        )}
      </div>
    </div>
  );
}
