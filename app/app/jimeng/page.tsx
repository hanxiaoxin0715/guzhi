"use client";

/**
 * 即梦生图 — 自由模式页面
 * 独立 /jimeng 路由，包含：
 * - 顶部导航（生图工作台/图生视频/即梦生图/项目管理）
 * - 子导航（生成 Tab / 图片库 Tab + 积分信息 + 设置入口）
 * - 左侧参数面板（提示词、参考图、模型、比例、分辨率、数量）
 * - 右侧预览区（生成结果展示）
 */

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Sparkles,
  ImageIcon,
  FolderOpen,
  Settings,
  Loader,
  Play,
  Plus,
  X,
  CheckCircle2,
  AlertTriangle,
  Search,
  RefreshCw,
  ZoomIn,
  Trash2,
  Download,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import {
  JIMENG_IMAGE_MODEL_OPTIONS,
  JIMENG_IMAGE_RATIO_OPTIONS,
  JIMENG_IMAGE_CREDITS_PER_IMAGE,
  MAX_PROMPT_LENGTH,
  MAX_REFERENCE_IMAGES,
  IMAGES_PER_REQUEST,
  type JimengImageModelId,
  type JimengImageRatio,
  type JimengImageResolution,
  type JimengImageResult,
  type JimengImageTaskResponse,
} from "../lib/jimeng-image/types";
import ImageSourcePicker from "../components/ImageSourcePicker";

// ═══════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════

interface GenerationBatch {
  id: string;
  taskId: string;
  prompt: string;
  model: JimengImageModelId;
  ratio: JimengImageRatio;
  resolution: JimengImageResolution;
  status: "generating" | "done" | "error";
  results: JimengImageResult[];
  error?: string;
  failCode?: number;
  startTime: number;
}

// ═══════════════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════════════

export default function JimengPage() {
  // ── Tab 切换 ──
  const [activeTab, setActiveTab] = useState<"generate" | "library">("generate");

  // ── 生成参数 ──
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [model, setModel] = useState<JimengImageModelId>("seedream-5.0");
  const [ratio, setRatio] = useState<JimengImageRatio>("16:9");
  const [resolution, setResolution] = useState<JimengImageResolution>("2K");
  const [groups, setGroups] = useState<1 | 2>(1);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);

  // ── 生成状态 ──
  const [isGenerating, setIsGenerating] = useState(false);
  const [batches, setBatches] = useState<GenerationBatch[]>([]);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsedTick, setElapsedTick] = useState(0); // 驱动进度条刷新
  const [stateLoaded, setStateLoaded] = useState(false); // 磁盘状态是否已加载

  // ── 图片库 ──
  const [libraryImages, setLibraryImages] = useState<Array<{ key: string; filename: string; createdAt: number }>>([]);
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySelected, setLibrarySelected] = useState<Set<string>>(new Set());
  const [libraryDeleting, setLibraryDeleting] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);

  // ── 放大查看 ──
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // ── 凭证 ──
  const [credentials, setCredentials] = useState({ sessionId: "", webId: "", userId: "" });
  const [showSettings, setShowSettings] = useState(false);

  // ── 磁盘持久化：页面状态保存/加载 ──
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 加载磁盘状态（首次挂载）
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/jimeng-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "load-page-state" }),
        });
        const data = await res.json();
        if (data.state) {
          const s = data.state;
          if (s.prompt) setPrompt(s.prompt);
          if (s.negativePrompt) setNegativePrompt(s.negativePrompt);
          if (s.model) setModel(s.model);
          if (s.ratio) setRatio(s.ratio);
          if (s.resolution) setResolution(s.resolution);
          if (s.groups) setGroups(s.groups);
          // 恢复已完成的批次（结果使用磁盘 URL）
          if (s.batches && Array.isArray(s.batches)) {
            setBatches(s.batches.filter((b: GenerationBatch) => b.status === "done"));
          }
          console.log("[jimeng] 磁盘状态已恢复");
        }
      } catch (err) {
        console.warn("[jimeng] 加载磁盘状态失败:", err);
      } finally {
        setStateLoaded(true);
      }
    })();
  }, []);

  // 保存状态到磁盘（防抖 2 秒）
  const savePageState = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const state = {
        prompt,
        negativePrompt,
        model,
        ratio,
        resolution,
        groups,
        // 仅保存已完成的批次（结果使用磁盘 URL，刷新后可恢复显示）
        batches: batches.filter(b => b.status === "done").slice(-20),
        savedAt: Date.now(),
      };
      fetch("/api/jimeng-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-page-state", state }),
      }).catch(err => console.warn("[jimeng] 保存状态失败:", err));
    }, 2000);
  }, [prompt, negativePrompt, model, ratio, resolution, groups, batches]);

  // 状态变更时自动保存
  useEffect(() => {
    if (!stateLoaded) return; // 等初始加载完成后才开始保存
    savePageState();
  }, [prompt, negativePrompt, model, ratio, resolution, groups, batches, stateLoaded, savePageState]);

  // 加载凭证（与 Seedance 共用 feicai-seedance-settings）
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("feicai-seedance-settings") || "{}");
      setCredentials({ sessionId: s.sessionId || "", webId: s.webId || "", userId: s.userId || "" });
    } catch { /* ignore */ }
  }, []);

  // 保存凭证
  const saveCredentials = useCallback((creds: typeof credentials) => {
    // 读取已有设置，合并写入（保留 Seedance 可能存的其他字段）
    let existing: Record<string, unknown> = {};
    try { existing = JSON.parse(localStorage.getItem("feicai-seedance-settings") || "{}"); } catch { /* */ }
    const merged = { ...existing, sessionId: creds.sessionId, webId: creds.webId, userId: creds.userId };
    localStorage.setItem("feicai-seedance-settings", JSON.stringify(merged));
    setCredentials(creds);
  }, []);

  // 加载图片库（切换到图片库 Tab 时）
  useEffect(() => {
    if (activeTab === "library") loadLibrary();
  }, [activeTab]);

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const res = await fetch("/api/jimeng-image?list=1");
      const data = await res.json();
      setLibraryImages(data.files || []);
    } catch (err) {
      console.error("[jimeng] 加载图片库失败:", err);
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  // ── 清理轮询 ──
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // ── 实时进度计时器（每秒 tick 驱动进度条渲染） ──
  useEffect(() => {
    const hasGenerating = batches.some(b => b.status === "generating");
    if (!hasGenerating) return;
    const timer = setInterval(() => setElapsedTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [batches]);

  // ── 图片来源选择器状态 ──
  const [showImageSourcePicker, setShowImageSourcePicker] = useState(false);

  // ── 参考图上传（通过图片来源选择器） ──
  const handleRefImageUpload = useCallback(() => {
    if (referenceImages.length >= MAX_REFERENCE_IMAGES) return;
    setShowImageSourcePicker(true);
  }, [referenceImages.length]);

  // 处理选中的图片
  const handleRefImageSelected = useCallback((dataUrl: string) => {
    setShowImageSourcePicker(false);
    setReferenceImages(prev => [...prev, dataUrl].slice(0, MAX_REFERENCE_IMAGES));
  }, []);

  // ── 开始生成 ──
  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    if (!credentials.sessionId || !credentials.webId || !credentials.userId) {
      setShowSettings(true);
      return;
    }
    if (isGenerating) return;

    setIsGenerating(true);
    const batchId = `batch-${Date.now()}`;

    try {
      const res = await fetch("/api/jimeng-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          prompt: prompt.slice(0, MAX_PROMPT_LENGTH),
          negativePrompt,
          model,
          ratio,
          resolution,
          count: groups * IMAGES_PER_REQUEST,
          sessionId: credentials.sessionId,
          webId: credentials.webId,
          userId: credentials.userId,
          referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "生成失败");
        setIsGenerating(false);
        return;
      }

      const newBatch: GenerationBatch = {
        id: batchId,
        taskId: data.taskId,
        prompt,
        model,
        ratio,
        resolution,
        status: "generating",
        results: [],
        startTime: Date.now(),
      };

      setBatches(prev => [...prev, newBatch]);

      // 开始轮询
      startPolling(data.taskId, batchId);
    } catch (err) {
      console.error("[jimeng] 生成请求失败:", err);
      alert("生成请求发送失败，请检查网络连接");
      setIsGenerating(false);
    }
  }, [prompt, negativePrompt, model, ratio, resolution, groups, referenceImages, credentials, isGenerating, batches.length]);

  // ── 轮询任务状态 ──
  const startPolling = useCallback((taskId: string, batchId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/jimeng-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status", taskId }),
        });
        const data: JimengImageTaskResponse = await res.json();

        if (data.status === "done") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          setIsGenerating(false);

          // 先用原始 URL 立即显示结果
          setBatches(prev => prev.map(b =>
            b.id === batchId
              ? { ...b, status: "done", results: data.results || [] }
              : b
          ));

          // 自动保存到磁盘，完成后用磁盘 URL 替换（持久化可显示）
          if (data.results && data.results.length > 0) {
            const batchTimestamp = Date.now();
            const diskResults = await Promise.all(
              data.results.map(async (img, i) => {
                const key = `jimeng-${batchTimestamp}-${i}`;
                try {
                  const saveRes = await fetch("/api/jimeng-image", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "save", imageUrl: img.url, key }),
                  });
                  const saveData = await saveRes.json();
                  return { ...img, url: saveData.diskUrl || `/api/jimeng-image?key=${key}`, diskKey: key };
                } catch (err) {
                  console.warn("[jimeng] 保存图片失败:", err);
                  return img;
                }
              })
            );
            // 用磁盘 URL 更新批次结果（刷新后仍可显示）
            setBatches(prev => prev.map(b =>
              b.id === batchId ? { ...b, results: diskResults } : b
            ));
          }
        } else if (data.status === "error") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          setIsGenerating(false);

          setBatches(prev => prev.map(b =>
            b.id === batchId
              ? { ...b, status: "error", error: data.error, failCode: data.failCode }
              : b
          ));
        }
        // else still generating — continue polling
      } catch (err) {
        console.warn("[jimeng] 轮询失败:", err);
      }
    }, 3000);
  }, []);

  // ── 切换图片选中 ──
  const toggleSelectImage = useCallback((url: string) => {
    setSelectedImages(prev => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }, []);

  // ── 积分估算 ──
  const estimatedCredits = groups * IMAGES_PER_REQUEST * JIMENG_IMAGE_CREDITS_PER_IMAGE;

  // ── 删除生成结果中的单张图片 ──
  const removeResultImage = useCallback((batchId: string, imgUrl: string) => {
    setBatches(prev => prev.map(b =>
      b.id === batchId
        ? { ...b, results: b.results.filter(r => r.url !== imgUrl) }
        : b
    ));
    setSelectedImages(prev => {
      const next = new Set(prev);
      next.delete(imgUrl);
      return next;
    });
  }, []);

  // ── 图片库删除（单张） ──
  const deleteLibraryImage = useCallback(async (key: string) => {
    try {
      await fetch("/api/jimeng-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-file", keys: key }),
      });
      setLibraryImages(prev => prev.filter(img => img.key !== key));
    } catch (err) {
      console.error("[即梦] 删除失败:", err);
    }
  }, []);

  // ── 图片库批量删除 ──
  const deleteLibrarySelected = useCallback(async () => {
    if (librarySelected.size === 0) return;
    if (!confirm(`确定删除已选的 ${librarySelected.size} 张图片？该操作不可撤销。`)) return;
    setLibraryDeleting(true);
    try {
      await fetch("/api/jimeng-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-file", keys: [...librarySelected] }),
      });
      setLibraryImages(prev => prev.filter(img => !librarySelected.has(img.key)));
      setLibrarySelected(new Set());
    } catch (err) {
      console.error("[即梦] 批量删除失败:", err);
    } finally {
      setLibraryDeleting(false);
    }
  }, [librarySelected]);

  // ── 图片库多选切换 ──
  const toggleLibrarySelect = useCallback((key: string) => {
    setLibrarySelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ── 下载图片 ──
  const downloadImage = useCallback((url: string, filename?: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "jimeng-image.png";
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  // ═══════════════════════════════════════════════════════════
  // 渲染
  // ═══════════════════════════════════════════════════════════

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {/* ── 子导航栏 ── */}
        <div className="flex items-center justify-between h-12 px-6 border-b border-[var(--border-default)] bg-[var(--bg-base)] shrink-0">
          <div className="flex items-center gap-1">
            {/* Tab 切换 */}
            <button
              onClick={() => setActiveTab("generate")}
              className={`flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium transition cursor-pointer ${
                activeTab === "generate"
                  ? "text-[var(--gold-primary)] border-b-2 border-[var(--gold-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <Sparkles size={14} /> 生成
            </button>
            <button
              onClick={() => setActiveTab("library")}
              className={`flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium transition cursor-pointer ${
                activeTab === "library"
                  ? "text-[var(--gold-primary)] border-b-2 border-[var(--gold-primary)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <FolderOpen size={14} /> 图片库
            </button>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[12px] text-[var(--text-muted)]">
              💎 预估 {estimatedCredits} 积分
            </span>
            <button
              onClick={() => setShowSettings(true)}
              className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition cursor-pointer"
              title="即梦凭证设置"
            >
              <Settings size={16} />
            </button>
          </div>
        </div>

        {/* ── 主内容区 ── */}
        {activeTab === "generate" ? (
          <div className="flex flex-1 min-h-0">
            {/* ── 左侧参数面板 ── */}
            <div className="flex flex-col w-[360px] h-full border-r border-[var(--border-default)] bg-[var(--bg-base)] shrink-0 overflow-y-auto">
              <div className="flex flex-col gap-5 p-5">
                {/* 提示词 */}
                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-medium text-[var(--text-secondary)]">
                    提示词 <span className="text-[var(--text-muted)]">({prompt.length}/{MAX_PROMPT_LENGTH})</span>
                  </label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value.slice(0, MAX_PROMPT_LENGTH))}
                    placeholder="描述你想要生成的图片内容..."
                    className="w-full h-[120px] px-3 py-2.5 text-[13px] bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--gold-primary)] transition resize-none"
                  />
                </div>

                {/* 反向提示词 */}
                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-medium text-[var(--text-secondary)]">反向提示词（可选）</label>
                  <textarea
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    placeholder="不想出现的内容..."
                    className="w-full h-[60px] px-3 py-2 text-[12px] bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--gold-primary)] transition resize-none"
                  />
                </div>

                {/* 参考图 */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[12px] font-medium text-[var(--text-secondary)]">
                      参考图 ({referenceImages.length}/{MAX_REFERENCE_IMAGES})
                    </label>
                    {referenceImages.length > 0 && (
                      <button onClick={() => setReferenceImages([])} className="text-[10px] text-red-400 hover:text-red-300 cursor-pointer">
                        全部清除
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {referenceImages.map((img, i) => (
                      <div key={i} className="relative w-[60px] h-[60px] border border-[var(--border-default)] overflow-hidden group">
                        <img src={img} alt={`参考图${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          onClick={() => setReferenceImages(prev => prev.filter((_, idx) => idx !== i))}
                          className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition cursor-pointer"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                    {referenceImages.length < MAX_REFERENCE_IMAGES && (
                      <button
                        onClick={handleRefImageUpload}
                        className="flex items-center justify-center w-[60px] h-[60px] border border-dashed border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer"
                      >
                        <Plus size={16} />
                      </button>
                    )}
                  </div>
                </div>

                {/* 模型选择 */}
                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-medium text-[var(--text-secondary)]">模型</label>
                  <div className="flex flex-col gap-1">
                    {JIMENG_IMAGE_MODEL_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setModel(opt.value)}
                        className={`flex items-center justify-between px-3 py-2.5 text-[12px] border transition cursor-pointer ${
                          model === opt.value
                            ? "border-[var(--gold-primary)] bg-[var(--gold-transparent)] text-[var(--text-primary)]"
                            : "border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
                        }`}
                      >
                        <div className="flex flex-col items-start gap-0.5">
                          <span className="font-medium">{opt.label}</span>
                          <span className="text-[10px] text-[var(--text-muted)]">{opt.description}</span>
                        </div>
                        {opt.badge && (
                          <span className="text-[9px] px-1.5 py-0.5 bg-[var(--gold-transparent)] text-[var(--gold-primary)] border border-[var(--gold-primary)]/30">
                            {opt.badge}
                          </span>
                        )}
                        {model === opt.value && <CheckCircle2 size={14} className="text-[var(--gold-primary)] shrink-0" />}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 宽高比 */}
                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-medium text-[var(--text-secondary)]">宽高比</label>
                  <div className="flex flex-wrap gap-1.5">
                    {JIMENG_IMAGE_RATIO_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setRatio(opt.value)}
                        className={`px-3 py-1.5 text-[11px] font-medium border transition cursor-pointer ${
                          ratio === opt.value
                            ? "border-[var(--gold-primary)] bg-[var(--gold-primary)] text-[#0A0A0A]"
                            : "border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 分辨率 */}
                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-medium text-[var(--text-secondary)]">分辨率</label>
                  <div className="flex gap-2">
                    {(["2K", "4K"] as JimengImageResolution[]).map((r) => (
                      <button
                        key={r}
                        onClick={() => setResolution(r)}
                        className={`flex-1 py-2 text-[12px] font-medium border transition cursor-pointer ${
                          resolution === r
                            ? "border-[var(--gold-primary)] bg-[var(--gold-primary)] text-[#0A0A0A]"
                            : "border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 生成组数 */}
                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-medium text-[var(--text-secondary)]">
                    生成组数 <span className="text-[var(--text-muted)]">（每组4张）</span>
                  </label>
                  <div className="flex gap-2">
                    {([1, 2] as const).map((g) => (
                      <button
                        key={g}
                        onClick={() => setGroups(g)}
                        className={`flex-1 py-2 text-[12px] font-medium border transition cursor-pointer ${
                          groups === g
                            ? "border-[var(--gold-primary)] bg-[var(--gold-primary)] text-[#0A0A0A]"
                            : "border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                        }`}
                      >
                        {g}组（{g * IMAGES_PER_REQUEST}张）
                      </button>
                    ))}
                  </div>
                </div>

                {/* 积分预估 */}
                <div className="flex items-center justify-between px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)]">
                  <span className="text-[11px] text-[var(--text-muted)]">预估消耗</span>
                  <span className="text-[13px] font-semibold text-[var(--gold-primary)]">
                    💎 {estimatedCredits} 积分
                  </span>
                </div>

                {/* 生成按钮 */}
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !prompt.trim()}
                  className="flex items-center justify-center gap-2 w-full py-3 bg-[var(--gold-primary)] text-[14px] font-semibold text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isGenerating ? (
                    <>
                      <Loader size={16} className="animate-spin" /> 生成中...
                    </>
                  ) : (
                    <>
                      <Play size={16} /> 开始生成
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* ── 右侧预览区 ── */}
            <div className="flex flex-col flex-1 min-w-0 h-full bg-[var(--bg-page)]">
              {batches.length === 0 ? (
                // 空状态
                <div className="flex flex-col items-center justify-center flex-1 gap-4">
                  <div className="flex items-center justify-center w-20 h-20 border border-[var(--border-default)]">
                    <ImageIcon size={32} className="text-[var(--text-muted)]" />
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[16px] font-medium text-[var(--text-secondary)]">即梦生图 · 自由模式</span>
                    <span className="text-[12px] text-[var(--text-muted)]">
                      填写提示词并点击「开始生成」，即梦将为你生成高质量图片
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-6">
                  {/* 已选数量 */}
                  {selectedImages.size > 0 && (
                    <div className="text-[11px] text-[var(--gold-primary)] font-medium text-right">
                      已选 {selectedImages.size} 张
                    </div>
                  )}
                  {/* 逐批展示 — 最新批次在最上方 */}
                  {[...batches].reverse().map((batch, revIdx) => {
                    const batchIdx = batches.length - 1 - revIdx;
                    return (
                      <div key={batch.id} className="flex flex-col gap-3">
                        {/* 批次标题 */}
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium text-[var(--text-muted)]">
                            第{batchIdx + 1}批
                          </span>
                          <span className="text-[10px] text-[var(--text-muted)]">
                            {batch.model} · {batch.ratio}
                          </span>
                          {batch.status === "done" && (
                            <span className="text-[10px] text-green-400">✓ {batch.results.length}张</span>
                          )}
                          {batch.status === "error" && (
                            <span className="text-[10px] text-red-400">✕ 失败</span>
                          )}
                        </div>

                        {/* 生成中 — 进度条 */}
                        {batch.status === "generating" && (() => {
                          void elapsedTick; // 触发每秒重渲染
                          const elapsed = Math.floor((Date.now() - batch.startTime) / 1000);
                          const estimatedTotal = 60;
                          const pct = Math.min((elapsed / estimatedTotal) * 100, 95);
                          return (
                            <div className="flex flex-col gap-3 p-4 border border-dashed border-amber-500/40 bg-amber-500/5">
                              <div className="flex items-center gap-3">
                                <Loader size={16} className="text-[var(--gold-primary)] animate-spin shrink-0" />
                                <div className="flex-1">
                                  <div className="h-2 bg-[var(--bg-surface)] rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-gradient-to-r from-[var(--gold-primary)] to-amber-400 rounded-full transition-all duration-1000"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                                <span className="text-[11px] text-[var(--text-muted)] shrink-0 w-20 text-right tabular-nums">
                                  {elapsed}s / ~{estimatedTotal}s
                                </span>
                              </div>
                              <span className="text-[12px] text-amber-400/80 text-center">
                                AI 正在生成图片，请稍候...
                              </span>
                            </div>
                          );
                        })()}

                        {/* 错误 */}
                        {batch.status === "error" && (
                          <div className="flex items-center gap-3 p-4 border border-red-500/30 bg-red-500/5">
                            <AlertTriangle size={16} className="text-red-400 shrink-0" />
                            <div className="flex-1 flex flex-col gap-1">
                              <span className="text-[12px] text-red-400">{batch.error}</span>
                              {batch.failCode && (
                                <span className="text-[10px] text-[var(--text-muted)]">错误码: {batch.failCode}</span>
                              )}
                            </div>
                            <button
                              onClick={handleGenerate}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 text-[11px] font-medium text-white hover:bg-red-600 transition cursor-pointer shrink-0"
                            >
                              <RefreshCw size={12} /> 重试
                            </button>
                          </div>
                        )}

                        {/* 完成 — 横排一行展示 */}
                        {batch.status === "done" && batch.results.length > 0 && (
                          <div className="flex flex-col gap-2">
                            {/* 提示词摘要 */}
                            <div className="px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[11px] text-[var(--text-muted)] truncate">
                              📝 {batch.prompt.slice(0, 80)}{batch.prompt.length > 80 ? "..." : ""}
                            </div>
                            <div className="grid grid-cols-4 gap-3">
                              {batch.results.map((img, i) => {
                                const isSelected = selectedImages.has(img.url);
                                return (
                                  <div
                                    key={i}
                                    className={`relative border-2 transition overflow-hidden group ${
                                      isSelected
                                        ? "border-[var(--gold-primary)] shadow-[0_0_12px_rgba(201,169,98,0.3)]"
                                        : "border-[var(--border-default)] hover:border-[var(--text-muted)]"
                                    }`}
                                  >
                                    <div className="w-full aspect-[4/3] bg-black/20 flex items-center justify-center cursor-pointer" onClick={() => toggleSelectImage(img.url)}>
                                      <img
                                        src={img.url}
                                        alt={`生成图片 ${i + 1}`}
                                        className="max-w-full max-h-full object-contain"
                                      />
                                    </div>
                                    {isSelected && (
                                      <div className="absolute top-2 right-2 w-6 h-6 bg-[var(--gold-primary)] flex items-center justify-center pointer-events-none">
                                        <CheckCircle2 size={14} className="text-[#0A0A0A]" />
                                      </div>
                                    )}
                                    {/* hover 操作按钮 — 居中显示 */}
                                    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 group-hover:opacity-100 transition">
                                      <button onClick={(e) => { e.stopPropagation(); setLightboxUrl(img.url); }} className="w-8 h-8 flex items-center justify-center bg-white/20 hover:bg-white/30 text-white rounded-full transition cursor-pointer backdrop-blur-sm" title="放大查看">
                                        <ZoomIn size={16} />
                                      </button>
                                      <button onClick={(e) => { e.stopPropagation(); downloadImage(img.url, `jimeng-${batch.id}-${i}.png`); }} className="w-8 h-8 flex items-center justify-center bg-white/20 hover:bg-white/30 text-white rounded-full transition cursor-pointer backdrop-blur-sm" title="下载">
                                        <Download size={16} />
                                      </button>
                                      <button onClick={(e) => { e.stopPropagation(); removeResultImage(batch.id, img.url); }} className="w-8 h-8 flex items-center justify-center bg-white/20 hover:bg-red-500/50 text-white rounded-full transition cursor-pointer backdrop-blur-sm" title="删除">
                                        <Trash2 size={16} />
                                      </button>
                                    </div>
                                    {/* 尺寸信息 */}
                                    <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/60 text-[9px] text-white/60 pointer-events-none">
                                      {img.width}×{img.height}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── 图片库 Tab ── */
          <div className="flex flex-col flex-1 min-h-0 bg-[var(--bg-page)]">
            {/* 筛选栏 */}
            <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--border-default)]">
              <div className="flex items-center gap-2 flex-1 max-w-[300px] px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border-default)]">
                <Search size={14} className="text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  placeholder="搜索图片..."
                  className="flex-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                />
              </div>
              <button
                onClick={loadLibrary}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-[var(--border-default)] transition cursor-pointer"
              >
                <RefreshCw size={12} /> 刷新
              </button>
              {/* 多选按钮 */}
              <button
                onClick={() => {
                  if (multiSelectMode) { setMultiSelectMode(false); setLibrarySelected(new Set()); }
                  else setMultiSelectMode(true);
                }}
                className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium border transition cursor-pointer ${
                  multiSelectMode
                    ? "border-[var(--gold-primary)] bg-[var(--gold-transparent)] text-[var(--gold-primary)]"
                    : "border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                }`}
              >
                <CheckCircle2 size={12} /> {multiSelectMode ? `已选 ${librarySelected.size}` : "多选"}
              </button>
              {multiSelectMode && librarySelected.size > 0 && (
                <button
                  onClick={deleteLibrarySelected}
                  disabled={libraryDeleting}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-red-400 hover:text-red-300 border border-red-500/40 hover:border-red-400/60 transition cursor-pointer disabled:opacity-40"
                >
                  {libraryDeleting ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  删除已选 ({librarySelected.size})
                </button>
              )}
              <span className="text-[11px] text-[var(--text-muted)] ml-auto">
                共 {libraryImages.length} 张
              </span>
            </div>

            {/* 图片分组展示 */}
            <div className="flex-1 overflow-y-auto p-6">
              {libraryLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader size={24} className="text-[var(--gold-primary)] animate-spin" />
                </div>
              ) : libraryImages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <FolderOpen size={32} className="text-[var(--text-muted)]" />
                  <span className="text-[13px] text-[var(--text-muted)]">图片库为空</span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    生成的图片将自动保存到这里
                  </span>
                </div>
              ) : (() => {
                // 按时间戳前缀分组（同一批生成的图片 key 格式为 jimeng-{timestamp}-{index}）
                const filtered = libraryImages.filter(img => !librarySearch || img.filename.toLowerCase().includes(librarySearch.toLowerCase()));
                const groupMap = new Map<string, typeof filtered>();
                for (const img of filtered) {
                  // 提取时间戳前缀（jimeng-1741234567890 → “1741234567890”）
                  const m = img.key.match(/^jimeng-(\d+)-/);
                  const groupKey = m ? m[1] : img.key;
                  if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
                  groupMap.get(groupKey)!.push(img);
                }
                const groups = [...groupMap.entries()].sort((a, b) => Number(b[0]) - Number(a[0]));
                return (
                  <div className="flex flex-col gap-6">
                    {groups.map(([groupKey, imgs]) => (
                      <div key={groupKey} className="flex flex-col gap-2">
                        {/* 组标题 */}
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium text-[var(--text-muted)]">
                            {new Date(Number(groupKey) || imgs[0].createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <span className="text-[10px] text-[var(--text-muted)]">{imgs.length}张</span>
                        </div>
                        {/* 组内图片横排 */}
                        <div className="grid grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                          {imgs.map((img) => {
                            const isChecked = librarySelected.has(img.key);
                            const imgSrc = `/api/jimeng-image?key=${img.key}`;
                            return (
                              <div
                                key={img.key}
                                onClick={multiSelectMode ? () => toggleLibrarySelect(img.key) : undefined}
                                className={`relative overflow-hidden group transition border-2 ${
                                  isChecked
                                    ? "border-[var(--gold-primary)] shadow-[0_0_8px_rgba(201,169,98,0.3)]"
                                    : "border-[var(--border-default)] hover:border-[var(--text-muted)]"
                                } ${multiSelectMode ? "cursor-pointer" : ""}`}
                              >
                                {/* 多选模式下的勾选标记 */}
                                {multiSelectMode && isChecked && (
                                  <div className="absolute top-1.5 right-1.5 z-10 w-5 h-5 bg-[var(--gold-primary)] flex items-center justify-center pointer-events-none">
                                    <CheckCircle2 size={12} className="text-[#0A0A0A]" />
                                  </div>
                                )}
                                {/* 图片 — 完全适配 */}
                                <div className="w-full aspect-[4/3] bg-black/20 flex items-center justify-center">
                                  <img
                                    src={imgSrc}
                                    alt={img.filename}
                                    className="max-w-full max-h-full object-contain"
                                    loading="lazy"
                                  />
                                </div>
                                {/* hover 操作按钮 — 居中显示 */}
                                {!multiSelectMode && (
                                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 group-hover:opacity-100 transition">
                                    <button onClick={() => setLightboxUrl(imgSrc)} className="w-8 h-8 flex items-center justify-center bg-white/20 hover:bg-white/30 text-white rounded-full transition cursor-pointer backdrop-blur-sm" title="放大查看">
                                      <ZoomIn size={16} />
                                    </button>
                                    <button onClick={() => downloadImage(imgSrc, img.filename)} className="w-8 h-8 flex items-center justify-center bg-white/20 hover:bg-white/30 text-white rounded-full transition cursor-pointer backdrop-blur-sm" title="下载">
                                      <Download size={16} />
                                    </button>
                                    <button onClick={() => { if (confirm("确定删除这张图片？")) deleteLibraryImage(img.key); }} className="w-8 h-8 flex items-center justify-center bg-white/20 hover:bg-red-500/50 text-white rounded-full transition cursor-pointer backdrop-blur-sm" title="删除">
                                      <Trash2 size={16} />
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* ═══════ 图片放大查看 Lightbox ═══════ */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 cursor-zoom-out"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center bg-black/60 text-white/80 hover:text-white transition cursor-pointer z-10"
          >
            <X size={20} />
          </button>
          <img
            src={lightboxUrl}
            alt="放大查看"
            className="max-w-[90vw] max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* ═══════ 即梦凭证设置弹窗 ═══════ */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex flex-col gap-5 w-[460px] bg-[var(--bg-page)] border border-[var(--border-default)] p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <span className="text-[16px] font-semibold text-[var(--text-primary)]">即梦生图 · 凭证设置</span>
              <button
                onClick={() => setShowSettings(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-3 bg-[#1a1500] border border-[#3d3000] text-[11px] text-[#d4a739] leading-relaxed">
              <strong>安全提示：</strong>以下三个值必须从你登录即梦的浏览器中获取真实值。
              <br />操作路径：访问 <a href="https://jimeng.jianying.com" target="_blank" rel="noreferrer" className="text-[var(--gold-primary)] hover:underline font-medium">jimeng.jianying.com</a> → F12 → Application → Cookies → 复制对应字段值。
              <br />此设置与 Seedance 视频共用，修改后两处均生效。
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">sessionid <span className="text-red-400">*</span></label>
              <input
                value={credentials.sessionId}
                onChange={(e) => setCredentials(c => ({ ...c, sessionId: e.target.value.trim() }))}
                className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition font-mono"
                placeholder="Cookie 中 sessionid 的值"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">_tea_web_id <span className="text-red-400">*</span></label>
              <input
                value={credentials.webId}
                onChange={(e) => setCredentials(c => ({ ...c, webId: e.target.value.trim() }))}
                className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition font-mono"
                placeholder="Cookie 中 _tea_web_id 的值（纯数字）"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-medium text-[var(--text-muted)]">uid_tt <span className="text-red-400">*</span></label>
              <input
                value={credentials.userId}
                onChange={(e) => setCredentials(c => ({ ...c, userId: e.target.value.trim() }))}
                className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition font-mono"
                placeholder="Cookie 中 uid_tt 的值"
              />
            </div>

            <button
              onClick={() => {
                if (!credentials.sessionId || !credentials.webId || !credentials.userId) {
                  alert("请填写全部三个字段");
                  return;
                }
                saveCredentials(credentials);
                setShowSettings(false);
              }}
              className="h-[40px] bg-[var(--gold-primary)] text-[#0A0A0A] text-[13px] font-medium hover:brightness-110 transition cursor-pointer"
            >
              保存设置
            </button>
          </div>
        </div>
      )}

      {/* ═══════ 图片来源选择器 ═══════ */}
      <ImageSourcePicker
        isOpen={showImageSourcePicker}
        onClose={() => setShowImageSourcePicker(false)}
        onImageSelected={handleRefImageSelected}
      />
    </div>
  );
}
