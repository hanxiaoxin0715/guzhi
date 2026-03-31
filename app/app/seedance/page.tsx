"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useToast } from "../components/Toast";
import { useTaskQueue } from "../lib/taskQueue";
import Sidebar from "../components/Sidebar";
import {
  Upload, X, Play, Pause, Download, Volume2, VolumeX,
  Maximize2, Settings2, Loader, RefreshCw, Sparkles,
  ChevronDown, ChevronsUp, ChevronsDown, Image as ImageIcon, Film, Grid3X3,
} from "lucide-react";
import { GridImportModal, ImageZoomModal, type GridImportImage } from "../components/GridImportModal";
import JimengLibraryModal from "../components/JimengLibraryModal";
import PlayStylePicker, { type PlayStyleConfig } from "./components/PlayStylePicker";
import {
  MODEL_OPTIONS,
  RATIO_OPTIONS,
  REFERENCE_MODES,
  CREDIT_PER_SECOND,
  VIDEOGEN_DURATION_OPTIONS,
  estimateCredits,
  isVideoGenModel,
  isFirstLastFrameSupported,
  type ModelId,
  type AspectRatio,
  type Duration,
  type ReferenceMode,
  type VideoQuality,
  type GenerationStatus,
  type TaskStatusResponse,
} from "../lib/seedance/types";

// ═══════════════════════════════════════════════════════════
// 上传文件类型
// ═══════════════════════════════════════════════════════════

interface UploadedFile {
  id: string;
  file: File;
  previewUrl: string;
  type: "image" | "video" | "audio";
}

// ═══════════════════════════════════════════════════════════
// SessionID 本地存储
// ═══════════════════════════════════════════════════════════

const SEEDANCE_SETTINGS_KEY = "feicai-seedance-settings";

interface SeedanceSettings {
  sessionId: string;
  webId: string;
  userId: string;
}

function loadSettings(): SeedanceSettings {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(SEEDANCE_SETTINGS_KEY) : null;
    if (raw) return JSON.parse(raw);
  } catch { /* 忽略 */ }
  return { sessionId: "", webId: "", userId: "" };
}

function saveSettings(s: SeedanceSettings) {
  localStorage.setItem(SEEDANCE_SETTINGS_KEY, JSON.stringify(s));
}

// ═══════════════════════════════════════════════════════════
// 提示词模式
// ═══════════════════════════════════════════════════════════

type PromptMode = "全能模式AI提示词" | "首尾帧AI提示词" | "普通AI生成";

// ═══════════════════════════════════════════════════════════
// 模块级状态缓存（跨页面导航保持，客户端路由不重载 JS 模块）
// ═══════════════════════════════════════════════════════════

interface SeedanceStateCache {
  prompt: string;
  promptMode: PromptMode;
  model: ModelId;
  referenceMode: ReferenceMode;
  ratio: AspectRatio;
  duration: Duration;
  quality: VideoQuality;
  genStatus: GenerationStatus;
  genProgress: string;
  genElapsed: number;
  videoUrl: string;
  omniFiles: UploadedFile[];
  firstFrameFiles: UploadedFile[];
  activeTaskId: string | null;
}

const stateCache: SeedanceStateCache = {
  prompt: "",
  promptMode: "全能模式AI提示词",
  model: "seedance-2.0",
  referenceMode: "全能参考",
  ratio: "4:3",
  duration: 5,
  quality: "720P",
  genStatus: "idle",
  genProgress: "",
  genElapsed: 0,
  videoUrl: "",
  omniFiles: [],
  firstFrameFiles: [],
  activeTaskId: null,
};

// ═══════════════════════════════════════════════════════════
// 主页面组件
// ═══════════════════════════════════════════════════════════

export default function SeedancePage() {
  const { toast } = useToast();
  const { addTask, removeTask, updateTask } = useTaskQueue();

  // — 设置状态 —
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<SeedanceSettings>(() => loadSettings());

  // — 参考文件（按模式独立存储，从缓存恢复）—
  const [omniFiles, setOmniFiles] = useState<UploadedFile[]>(stateCache.omniFiles);
  const [firstFrameFiles, setFirstFrameFiles] = useState<UploadedFile[]>(stateCache.firstFrameFiles);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // — 提示词（从缓存恢复）—
  const [prompt, setPrompt] = useState(stateCache.prompt);
  const [promptMode, setPromptMode] = useState<PromptMode>(stateCache.promptMode);
  const [textareaExpanded, setTextareaExpanded] = useState(false);
  const [aiPromptLoading, setAiPromptLoading] = useState(false);

  // — 生成参数（从缓存恢复）—
  const [model, setModel] = useState<ModelId>(stateCache.model);
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>(stateCache.referenceMode);

  // 根据当前参考模式计算当前文件列表和 setter
  const uploadedFiles = referenceMode === "全能参考" ? omniFiles : firstFrameFiles;
  const setUploadedFiles = referenceMode === "全能参考" ? setOmniFiles : setFirstFrameFiles;
  const [ratio, setRatio] = useState<AspectRatio>(stateCache.ratio);
  const [duration, setDuration] = useState<Duration>(stateCache.duration);
  const [quality, setQuality] = useState<VideoQuality>(stateCache.quality);

  // — 生成状态（从缓存恢复）—
  const [genStatus, setGenStatus] = useState<GenerationStatus>(stateCache.genStatus);
  const [genProgress, setGenProgress] = useState(stateCache.genProgress);
  const [genElapsed, setGenElapsed] = useState(stateCache.genElapsed);

  // — 视频播放（从缓存恢复 videoUrl）—
  const [videoUrl, setVideoUrl] = useState(stateCache.videoUrl);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // — 轮询 ref —
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // — 宫格导入 —
  const [showGridPicker, setShowGridPicker] = useState(false);
  // — 即梦图库 —
  const [showJimengLibrary, setShowJimengLibrary] = useState(false);
  // — 图片放大预览 —
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

  // — 玩法选择弹窗 —
  const [showPlayStylePicker, setShowPlayStylePicker] = useState(false);

  // ═══════════════════════════════════════════════════════════
  // 文件上传
  // ───────────────────────────────────────────────────────────
  // 即梦官网上传限制（Seedance 2.0 全能参考模式）：
  //   图片: jpeg/png/webp/bmp/tiff/gif, 单文件 < 30MB, 最多 9 张
  //   视频: mp4/mov, 单文件 < 50MB, 最多 3 个, 时长 2~15s
  //   音频: mp3/wav, 单文件 < 15MB, 最多 3 个, 时长 ≤15s
  //   混合上传总数: 最多 12 个（图+视频+音频）
  // ═══════════════════════════════════════════════════════════

  const handleFileUpload = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const currentFiles = referenceMode === "全能参考" ? omniFiles : firstFrameFiles;
    const setCurrentFiles = referenceMode === "全能参考" ? setOmniFiles : setFirstFrameFiles;
    const newFiles: UploadedFile[] = [];
    for (const file of Array.from(fileList)) {
      if (currentFiles.length + newFiles.length >= 9) {
        toast("最多上传 9 个参考文件", "error");
        break;
      }
      // 按文件类型区分大小限制（与即梦官网同步）
      const type = file.type.startsWith("image/")
        ? "image" as const
        : file.type.startsWith("video/")
          ? "video" as const
          : file.type.startsWith("audio/")
            ? "audio" as const
            : "image" as const;
      const sizeLimit = type === "video" ? 50 : type === "audio" ? 15 : 30; // MB
      if (file.size > sizeLimit * 1024 * 1024) {
        toast(`「${file.name}」超过 ${sizeLimit}MB（${type === "video" ? "视频" : type === "audio" ? "音频" : "图片"}限制）`, "error");
        continue;
      }
      newFiles.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        type,
      });
    }
    setCurrentFiles((prev) => [...prev, ...newFiles]);
  }, [omniFiles, firstFrameFiles, referenceMode, toast]);

  const removeFile = useCallback((id: string) => {
    const setCurrentFiles = referenceMode === "全能参考" ? setOmniFiles : setFirstFrameFiles;
    setCurrentFiles((prev) => {
      const f = prev.find((x) => x.id === id);
      if (f) URL.revokeObjectURL(f.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  }, [referenceMode]);

  // ═══════════════════════════════════════════════════════════
  // 宫格图片导入
  // ═══════════════════════════════════════════════════════════

  const handleGridImport = useCallback(async (images: GridImportImage[]) => {
    const remaining = 9 - uploadedFiles.length;
    if (remaining <= 0) {
      toast("已达 9 个文件上限", "error");
      return;
    }
    const toAdd = images.slice(0, remaining);
    const newFiles: UploadedFile[] = [];
    for (const img of toAdd) {
      try {
        const res = await fetch(img.url);
        if (!res.ok) { console.warn(`[GridImport] 加载失败: ${img.key} (${res.status})`); continue; }
        const blob = await res.blob();
        const file = new File([blob], `${img.key}.png`, { type: blob.type || "image/png" });
        newFiles.push({
          id: `grid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          previewUrl: URL.createObjectURL(file),
          type: "image" as const,
        });
      } catch (e) {
        console.warn(`[GridImport] 导入失败: ${img.key}`, e);
        toast(`图片导入失败: ${img.key}`, "error");
      }
    }
    if (newFiles.length > 0) {
      setUploadedFiles((prev) => [...prev, ...newFiles]);
      toast(`已导入 ${newFiles.length} 张宫格图片`, "success");
    }
  }, [uploadedFiles, setUploadedFiles, toast]);

  // ═══════════════════════════════════════════════════════════
  // AI 提示词生成
  // ═══════════════════════════════════════════════════════════

  const handleAiPrompt = useCallback(async (
    overrideMode?: PromptMode,
    playStyleDirection?: string,
    storyDescription?: string,
  ) => {
    if (uploadedFiles.length === 0) {
      toast("请先上传参考图片", "error");
      return;
    }
    if (aiPromptLoading) return;

    const activeMode = overrideMode || promptMode;
    setAiPromptLoading(true);
    try {
      // ── 从 localStorage 读取 LLM 设置 ──
      const raw = localStorage.getItem("feicai-settings");
      const llmSettings = raw ? JSON.parse(raw) : {};
      let apiKey = llmSettings["llm-key"] || "";
      let baseUrl = llmSettings["llm-url"] || "https://api.geeknow.top/v1";
      let llmModel = llmSettings["llm-model"] || "gemini-2.5-pro";
      const provider = llmSettings["llm-provider"] || "openAi";

      // 如果是纯文本模型(如 qwen3-max)，回退到 Gemini 视觉模型
      if (provider === "dashscope-responses") {
        const geeknowKey = llmSettings["llm-key--geeknow-gemini"];
        if (geeknowKey) {
          apiKey = geeknowKey;
          baseUrl = "https://api.geeknow.top/v1";
          llmModel = "gemini-2.5-pro";
        } else {
          toast("当前文本模型不支持图像识别，请先配置 GeeKnow Gemini 的 API Key", "error");
          setAiPromptLoading(false);
          return;
        }
      }

      if (!apiKey) {
        toast("未配置 LLM API Key，请在「设置」页面配置", "error");
        setAiPromptLoading(false);
        return;
      }

      // 根据提示词模式映射到参考模式
      const aiMode = activeMode === "普通AI生成" ? "普通生成" : activeMode === "首尾帧AI提示词" ? "首帧参考" : "全能参考";

      const formData = new FormData();
      formData.append("mode", aiMode);
      formData.append("apiKey", apiKey);
      formData.append("baseUrl", baseUrl);
      formData.append("model", llmModel);
      formData.append("provider", provider);
      formData.append("duration", String(duration));

      for (const uf of uploadedFiles) {
        formData.append("files", uf.file);
      }
      // 普通AI生成：传入用户当前输入的提示词文本
      if (activeMode === "普通AI生成" && prompt.trim()) {
        formData.append("userPromptText", prompt.trim());
      }
      // 玩法方向 & 剧情描述（由 PlayStylePicker 传入）
      if (playStyleDirection) formData.append("playStyleDirection", playStyleDirection);
      if (storyDescription) formData.append("storyDescription", storyDescription);

      // 用户自定义提示词（来自提示词编辑页）
      const { loadSystemPromptsAsync } = await import("../lib/consistency");
      const savedPrompts = await loadSystemPromptsAsync();
      if (savedPrompts.seedanceOmni) formData.append("customOmniPrompt", savedPrompts.seedanceOmni);
      if (savedPrompts.seedanceFirstFrame) formData.append("customFirstFramePrompt", savedPrompts.seedanceFirstFrame);
      if (savedPrompts.seedanceSimple) formData.append("customSimplePrompt", savedPrompts.seedanceSimple);

      const res = await fetch("/api/seedance/ai-prompt", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "AI 提示词生成失败");
      }

      setPrompt(data.prompt);
      toast("AI 提示词生成成功", "success");
    } catch (err: unknown) {
      const error = err as Error;
      toast(error.message, "error");
    } finally {
      setAiPromptLoading(false);
    }
  }, [uploadedFiles, promptMode, aiPromptLoading, duration, toast]);
  // ═══════════════════════════════════════════════════════════
  // 视频生成
  // ═══════════════════════════════════════════════════════════

  // ── 轮询逻辑（提取为独立函数，支持恢复轮询）──
  const startPolling = useCallback((taskId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    stateCache.activeTaskId = taskId;
    let errorCount = 0;
    const MAX_POLL_ERRORS = 60; // 连续网络错误60次(约3分钟)后停止轮询

    pollingRef.current = setInterval(async () => {
      try {
        const taskRes = await fetch(`/api/seedance/task/${taskId}`);
        if (!taskRes.ok) {
          // 任务不存在或服务端错误
          errorCount++;
          if (errorCount >= MAX_POLL_ERRORS) {
            if (pollingRef.current) clearInterval(pollingRef.current);
            pollingRef.current = null;
            stateCache.activeTaskId = null;
            setGenStatus("error");
            setGenProgress(`任务查询失败 (${taskRes.status})，请重新生成`);
            removeTask(`seedance-${taskId}`);
          }
          return;
        }
        const taskData: TaskStatusResponse = await taskRes.json();
        errorCount = 0; // 成功后重置计数器

        setGenElapsed(taskData.elapsed);

        if (taskData.status === "done" && taskData.result) {
          // 生成成功
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          stateCache.activeTaskId = null;
          setGenStatus("success");
          setGenProgress("");
          removeTask(`seedance-${taskId}`);

          const url = taskData.result.data[0]?.url;
          if (url) {
            // 通过代理播放
            setVideoUrl(`/api/seedance/video-proxy?url=${encodeURIComponent(url)}`);
            toast("视频生成完成！", "success");

            // 自动保存到 outputs/videos/
            const videoKey = `seedance-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
            fetch("/api/local-file", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ category: "videos", key: videoKey, data: url, type: "video" }),
            })
              .then((r) => r.json())
              .then((res) => {
                if (res.success) {
                  console.log(`[Seedance] 视频已自动保存: ${res.path}`);
                  toast("视频已自动保存到 outputs/videos/", "success");
                } else {
                  console.warn(`[Seedance] 视频自动保存失败: ${res.error}`);
                }
              })
              .catch((e) => console.warn("[Seedance] 视频自动保存异常:", e));
          }
        } else if (taskData.status === "error") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          stateCache.activeTaskId = null;
          setGenStatus("error");
          setGenProgress(taskData.error || "生成失败");
          removeTask(`seedance-${taskId}`);
          toast(taskData.error || "生成失败", "error");
        } else {
          setGenProgress(taskData.progress || "处理中...");
          updateTask(`seedance-${taskId}`, {
            detail: `${taskData.elapsed}s · ${taskData.progress || ""}`,
          });
        }
      } catch {
        // 轮询网络错误，计数并在超过上限时停止
        errorCount++;
        if (errorCount >= MAX_POLL_ERRORS) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          stateCache.activeTaskId = null;
          setGenStatus("error");
          setGenProgress("轮询超时：网络持续断开，请检查网络后重试");
        }
      }
    }, 3000);
  }, [toast, removeTask, updateTask]);

  const handleGenerate = useCallback(async () => {
    if (!settings.sessionId || !settings.webId || !settings.userId) {
      setShowSettings(true);
      toast("请先完整填写即梦 Cookie 信息", "error");
      return;
    }
    if (uploadedFiles.length === 0) {
      toast("请至少上传一张参考图片", "error");
      return;
    }

    setGenStatus("generating");
    setGenProgress("正在提交...");
    setGenElapsed(0);
    setVideoUrl("");

    try {
      const formData = new FormData();
      formData.append("prompt", prompt);
      formData.append("model", model);
      formData.append("ratio", ratio);
      formData.append("duration", String(duration));
      formData.append("quality", quality);
      formData.append("referenceMode", referenceMode);
      formData.append("sessionId", settings.sessionId);
      formData.append("webId", settings.webId);
      formData.append("userId", settings.userId);

      // 只上传图片文件
      for (const uf of uploadedFiles) {
        formData.append("files", uf.file);
      }

      const res = await fetch("/api/seedance/generate", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "提交失败");
      }

      const taskId = data.taskId as string;
      toast("生成任务已提交", "success");

      // 加入全局任务队列
      addTask({ id: `seedance-${taskId}`, type: "video", label: "Seedance 生成中" });

      // 开始轮询
      startPolling(taskId);
    } catch (err: unknown) {
      const error = err as Error;
      setGenStatus("error");
      setGenProgress(error.message);
      toast(error.message, "error");
    }
  }, [settings.sessionId, settings.webId, settings.userId, uploadedFiles, prompt, model, ratio, duration, quality, referenceMode, toast, addTask, startPolling]);

  // ── 恢复轮询：mount 时如果有活跃任务且正在生成中，自动恢复 ──
  useEffect(() => {
    if (stateCache.activeTaskId && genStatus === "generating" && !pollingRef.current) {
      console.log(`[Seedance] 恢复轮询: taskId=${stateCache.activeTaskId}`);
      startPolling(stateCache.activeTaskId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 将组件状态同步到模块级缓存（每次 render）──
  useEffect(() => {
    stateCache.prompt = prompt;
    stateCache.promptMode = promptMode;
    stateCache.model = model;
    stateCache.referenceMode = referenceMode;
    stateCache.ratio = ratio;
    stateCache.duration = duration;
    stateCache.quality = quality;
    stateCache.genStatus = genStatus;
    stateCache.genProgress = genProgress;
    stateCache.genElapsed = genElapsed;
    stateCache.videoUrl = videoUrl;
    stateCache.omniFiles = omniFiles;
    stateCache.firstFrameFiles = firstFrameFiles;
  });

  // ── 清理轮询（unmount）──
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = null;
    };
  }, []);

  const handleReset = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    stateCache.activeTaskId = null;
    setGenStatus("idle");
    setGenProgress("");
    setGenElapsed(0);
    setVideoUrl("");
    setIsPlaying(false);
    setPrompt("");
    setOmniFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.previewUrl));
      return [];
    });
    setFirstFrameFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.previewUrl));
      return [];
    });
  }, []);

  // ═══════════════════════════════════════════════════════════
  // 视频控制
  // ═══════════════════════════════════════════════════════════

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) videoRef.current.pause();
    else videoRef.current.play();
    setIsPlaying(!isPlaying);
  };

  const handleDownload = () => {
    if (!videoUrl) return;
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = `seedance-${Date.now()}.mp4`;
    a.click();
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // ═══════════════════════════════════════════════════════════
  // AgentFAB director-command 事件监听（支持FC全自动助手）
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    const cmdHandler = (e: Event) => {
      const ce = e as CustomEvent;
      const { action, params = {}, requestId } = ce.detail || {};
      let success = true;
      let result = "";
      let error = "";
      try {
        switch (action) {
          case "generateSeedance":
            handleGenerate();
            result = "Seedance 视频生成已启动";
            break;
          case "resetSeedance":
            handleReset();
            result = "Seedance 已重置";
            break;
          case "downloadSeedanceVideo":
            handleDownload();
            result = "视频下载已启动";
            break;
          case "setSeedanceParams": {
            if (params.ratio) setRatio(params.ratio as AspectRatio);
            if (params.duration) setDuration(params.duration as Duration);
            if (params.quality) setQuality(params.quality as VideoQuality);
            if (params.model) setModel(params.model as ModelId);
            result = "Seedance 参数已设置";
            break;
          }
          case "aiSeedancePrompt":
            handleAiPrompt();
            result = "AI提示词优化已启动";
            break;
          default:
            success = false;
            error = `Seedance页未实现的操作: ${action}`;
        }
      } catch (err) {
        success = false;
        error = err instanceof Error ? err.message : "执行异常";
      }
      window.dispatchEvent(new CustomEvent("director-result", {
        detail: { requestId, success, result, error },
      }));
    };
    window.addEventListener("director-command", cmdHandler);
    return () => { window.removeEventListener("director-command", cmdHandler); };
  }); // 不加 deps — 每次渲染都用最新闭包

  // ═══════════════════════════════════════════════════════════
  // 渲染
  // ═══════════════════════════════════════════════════════════

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <main className="flex-1 flex h-full overflow-hidden">
        {/* ═══════ 左面板: 控制区 ═══════ */}
        <div className="w-[480px] shrink-0 flex flex-col h-full border-r border-[var(--border-default)] bg-[var(--bg-page)]">
          {/* 标题栏 */}
          <div className="flex items-center justify-between px-7 pt-6 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 flex items-center justify-center border border-[var(--gold-primary)]">
                <Film size={16} className="text-[var(--gold-primary)]" />
              </div>
              <span className="font-serif text-[20px] font-medium text-[var(--text-primary)]">
                Seedance 2.0
              </span>
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 text-[var(--text-secondary)] hover:text-[var(--gold-primary)] transition cursor-pointer"
              title="设置 Session ID"
            >
              <Settings2 size={18} />
            </button>
          </div>

          {/* 可滚动内容区 */}
          <div className="flex-1 overflow-y-auto px-7 pb-6 space-y-5">
            {/* ── 参考文件上传 ── */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-medium text-[var(--text-secondary)]">参考素材</span>
                <span className="text-[11px] text-[var(--text-muted)]">{uploadedFiles.length}/9</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {uploadedFiles.map((uf, idx) => (
                  <div key={uf.id} className="relative w-[80px] h-[80px] bg-[var(--bg-surface)] border border-[var(--border-default)] group">
                    {uf.type === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={uf.previewUrl} alt="" className="w-full h-full object-cover cursor-pointer" onClick={() => setZoomUrl(uf.previewUrl)} />
                    ) : uf.type === "video" ? (
                      <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">
                        <Film size={24} />
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">
                        <Volume2 size={24} />
                      </div>
                    )}
                    {/* 编号标签 */}
                    <div className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/70 rounded text-[10px] text-white font-mono">
                      @{idx + 1}
                    </div>
                    {/* 缩放按钮（仅图片） */}
                    {uf.type === "image" && (
                      <button
                        onClick={() => setZoomUrl(uf.previewUrl)}
                        className="absolute top-1 left-1 w-5 h-5 flex items-center justify-center bg-black/60 text-white opacity-0 group-hover:opacity-100 transition cursor-pointer"
                      >
                        <Maximize2 size={10} />
                      </button>
                    )}
                    {/* 删除按钮 */}
                    <button
                      onClick={() => removeFile(uf.id)}
                      className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-black/60 text-white opacity-0 group-hover:opacity-100 transition cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {uploadedFiles.length < 9 && (
                  <>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-[80px] h-[80px] flex flex-col items-center justify-center gap-1 border border-dashed border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer"
                    >
                      <Upload size={16} />
                      <span className="text-[10px]">上传</span>
                    </button>
                    <button
                      onClick={() => setShowJimengLibrary(true)}
                      className="w-[80px] h-[80px] flex flex-col items-center justify-center gap-1 border border-dashed border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer"
                    >
                      <ImageIcon size={16} />
                      <span className="text-[10px]">即梦图库</span>
                    </button>
                    <button
                      onClick={() => setShowGridPicker(true)}
                      className="w-[80px] h-[80px] flex flex-col items-center justify-center gap-1 border border-dashed border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer"
                    >
                      <Grid3X3 size={16} />
                      <span className="text-[10px]">从宫格导入</span>
                    </button>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,audio/*"
                multiple
                className="hidden"
                onChange={(e) => handleFileUpload(e.target.files)}
              />
            </section>

            {/* ── 提示词 ── */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-medium text-[var(--text-secondary)]">提示词 Prompt</span>
              </div>
              {/* AI 提示词生成按钮 */}
              <div className="flex gap-2 mb-2">
                {(["全能模式AI提示词", "普通AI生成", "首尾帧AI提示词"] as PromptMode[]).map((mode) => {
                  const isOmni = mode === "全能模式AI提示词";
                  const isSimple = mode === "普通AI生成";
                  const displayLabel = isOmni ? "✦ 全能模式玩法选择" : isSimple ? "✦ 普通AI生成" : "✨ 首尾帧AI提示词";
                  const isActive = aiPromptLoading && promptMode === mode;
                  return (
                  <button
                    key={mode}
                    onClick={() => {
                      setPromptMode(mode);
                      // 全能模式：打开玩法选择弹窗；普通/首尾帧：直接生成
                      if (isOmni) {
                        setShowPlayStylePicker(true);
                      } else {
                        handleAiPrompt(mode);
                      }
                    }}
                    disabled={aiPromptLoading}
                    className={`flex-1 h-[30px] flex items-center justify-center gap-1 text-[12px] rounded-sm transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                      isActive
                        ? isOmni
                          ? "bg-[#7C3AED20] text-[#A78BFA] border border-[#7C3AED]/30"
                          : isSimple
                            ? "bg-[#065f4620] text-[#34d399] border border-[#059669]/30"
                            : "bg-[#C9A96220] text-[var(--gold-primary)] border border-[var(--gold-primary)]/20"
                        : isOmni
                          ? "bg-gradient-to-r from-[#4C1D95]/20 to-[#7C3AED]/10 text-[#A78BFA] border border-[#7C3AED]/30 hover:from-[#4C1D95]/30 hover:to-[#7C3AED]/20 hover:text-[#C4B5FD]"
                          : isSimple
                            ? "bg-gradient-to-r from-[#064e3b]/20 to-[#059669]/10 text-[#34d399] border border-[#059669]/30 hover:from-[#064e3b]/30 hover:to-[#059669]/20 hover:text-[#6ee7b7]"
                            : "bg-transparent text-[var(--text-muted)] border border-[var(--border-default)] hover:text-[var(--text-secondary)]"
                    }`}
                  >
                    {isActive ? (
                      <Loader size={12} className="animate-spin" />
                    ) : (
                      <Sparkles size={12} />
                    )}
                    {isActive ? "分析中..." : displayLabel}
                  </button>
                  );
                })}
              </div>
              <div className="relative">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="描述视频场景，使用 @1 @2 @3 引用对应的参考素材..."
                  className={`w-full ${textareaExpanded ? "h-[160px]" : "h-[80px]"} px-4 py-3 pr-10 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none outline-none focus:border-[var(--gold-primary)] transition leading-relaxed`}
                />
                {/* 展开/收起按钮 — 固定在文本框右侧外部，不被内容遮挡 */}
                <button
                  onClick={() => setTextareaExpanded(!textareaExpanded)}
                  className="absolute bottom-1 right-1 w-7 h-7 flex items-center justify-center bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[var(--text-muted)] hover:text-[var(--gold-primary)] hover:border-[var(--gold-primary)] cursor-pointer transition z-10"
                  title={textareaExpanded ? "收起文本框" : "展开文本框"}
                >
                  {textareaExpanded ? <ChevronsUp size={14} /> : <ChevronsDown size={14} />}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                使用 @1 @2 @3 引用对应的参考素材。AI 提示词会根据当前设定的时长生成，请先设置好时长再点击生成
              </p>
            </section>

            {/* ── 模型选择 ── */}
            <section>
              <span className="text-[13px] font-medium text-[var(--text-secondary)] mb-2 block">模型 Model</span>
              <div className="relative">
                <select
                  value={model}
                  onChange={(e) => {
                    const newModel = e.target.value as ModelId;
                    setModel(newModel);
                    // 3.x 模型仅支持首帧参考，自动切换
                    if (isVideoGenModel(newModel) && referenceMode !== "首帧参考") {
                      setReferenceMode("首帧参考");
                    }
                    // 3.x 模型使用固定时长选项，自动对齐到最近的有效时长
                    const fixedOpts = VIDEOGEN_DURATION_OPTIONS[newModel];
                    if (fixedOpts && !fixedOpts.includes(duration)) {
                      const closest = fixedOpts.reduce((a, b) => Math.abs(b - duration) < Math.abs(a - duration) ? b : a);
                      setDuration(closest);
                    }
                  }}
                  className="w-full h-[40px] px-3 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition appearance-none cursor-pointer"
                >
                  {MODEL_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label} — {m.description}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
              </div>
            </section>

            {/* ── 参考模式 ── */}
            <section>
              <span className="text-[13px] font-medium text-[var(--text-secondary)] mb-2 block">参考模式</span>
              <div className="flex gap-2">
                {REFERENCE_MODES.map((mode) => {
                  const isVG = isVideoGenModel(model);
                  const disabled = isVG && mode === "全能参考";
                  return (
                    <button
                      key={mode}
                      onClick={() => !disabled && setReferenceMode(mode)}
                      disabled={disabled}
                      className={`flex-1 h-[36px] text-[12px] rounded-sm transition ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"} ${
                        referenceMode === mode
                          ? "bg-[var(--gold-primary)] text-[#0A0A0A] font-medium"
                          : "bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)]"
                      }`}
                    >
                      {mode}
                    </button>
                  );
                })}
              </div>
              {isVideoGenModel(model) && (
                <p className="mt-1.5 text-[11px] text-amber-500/80">
                  {isFirstLastFrameSupported(model)
                    ? "当前模型支持首尾帧模式，上传一张图同时作为首帧和尾帧"
                    : "3.0 Pro / 3.0 Fast 仅支持单图模式（不支持首尾帧）"}
                </p>
              )}
            </section>

            {/* ── 画面比例 ── */}
            <section>
              <span className="text-[13px] font-medium text-[var(--text-secondary)] mb-2 block">画面比例</span>
              <div className="grid grid-cols-3 gap-2">
                {RATIO_OPTIONS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setRatio(r.value)}
                    className={`h-[32px] text-[12px] rounded-sm transition cursor-pointer ${
                      ratio === r.value
                        ? "bg-[var(--gold-primary)] text-[#0A0A0A] font-medium"
                        : "bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)]"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </section>

            {/* ── 视频时长 ── */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-medium text-[var(--text-secondary)]">时长</span>
                <span className="text-[12px] font-mono text-[var(--gold-primary)]">{duration}s</span>
              </div>
              {(() => {
                const fixedOpts = VIDEOGEN_DURATION_OPTIONS[model];
                if (fixedOpts) {
                  // 3.x 模型：固定时长按钮
                  return (
                    <div className="flex gap-2">
                      {fixedOpts.map((d) => (
                        <button
                          key={d}
                          onClick={() => setDuration(d)}
                          className={`flex-1 h-[32px] text-[12px] font-mono rounded-sm transition cursor-pointer ${
                            duration === d
                              ? "bg-[var(--gold-primary)] text-[#0A0A0A] font-medium"
                              : "bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)]"
                          }`}
                        >
                          {d}s
                        </button>
                      ))}
                    </div>
                  );
                }
                // Seedance 2.0：连续滑块 4-15s
                return (
                  <>
                    <input
                      type="range"
                      min={4} max={15} step={1}
                      value={duration}
                      onChange={(e) => setDuration(parseInt(e.target.value) as Duration)}
                      className="w-full h-1 accent-[var(--gold-primary)] cursor-pointer"
                    />
                    <div className="flex justify-between mt-1">
                      <span className="text-[10px] text-[var(--text-muted)]">4s</span>
                      <span className="text-[10px] text-[var(--text-muted)]">15s</span>
                    </div>
                  </>
                );
              })()}
            </section>

            {/* ── 视频画质 ── */}
            <section>
              <span className="text-[13px] font-medium text-[var(--text-secondary)] mb-2 block">画质</span>
              <div className="flex gap-2">
                {(["720P", "1080P"] as VideoQuality[]).map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuality(q)}
                    className={`flex-1 h-[32px] text-[12px] font-mono rounded-sm transition cursor-pointer ${
                      quality === q
                        ? "bg-[var(--gold-primary)] text-[#0A0A0A] font-medium"
                        : "bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)]"
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </section>

            {/* ── 积分显示 + 生成按钮 ── */}
            <section className="pt-3 border-t border-[var(--border-default)] space-y-3">
              {/* 积分消耗预估 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[var(--text-muted)]">预估消耗</span>
                  <span className="text-[16px] font-mono font-semibold text-[var(--gold-primary)]">
                    {estimateCredits(model, duration, quality)}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">积分</span>
                </div>
                <span className="text-[10px] text-[var(--text-muted)]">
                  {CREDIT_PER_SECOND[model]?.[quality] ?? 5} 积分/秒 × {duration}s
                </span>
              </div>
              {/* 操作按钮 */}
              <div className="flex gap-3">
                <button
                  onClick={handleGenerate}
                  disabled={genStatus === "generating"}
                  className="flex-1 h-[44px] flex items-center justify-center gap-2 bg-[var(--gold-primary)] text-[#0A0A0A] text-[14px] font-medium hover:brightness-110 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {genStatus === "generating" ? (
                    <>
                      <Loader size={16} className="animate-spin" />
                      生成中...
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      生成视频
                    </>
                  )}
                </button>
                <button
                  onClick={handleReset}
                  className="w-[44px] h-[44px] flex items-center justify-center border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--gold-primary)] hover:border-[var(--gold-primary)] transition cursor-pointer"
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            </section>
          </div>
        </div>

        {/* ═══════ 右面板: 视频预览 ═══════ */}
        <div className="flex-1 flex flex-col bg-[#0A0A0A]">
          {/* 视频区域 */}
          <div className="flex-1 flex items-center justify-center relative">
            {videoUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  className="max-w-full max-h-full"
                  loop
                  muted={isMuted}
                  onTimeUpdate={(e) => setVideoTime((e.target as HTMLVideoElement).currentTime)}
                  onLoadedMetadata={(e) => setVideoDuration((e.target as HTMLVideoElement).duration)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                />
                {/* 播放按钮覆盖层 */}
                {!isPlaying && (
                  <button
                    onClick={togglePlay}
                    className="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer transition hover:bg-black/40"
                  >
                    <div className="w-[56px] h-[56px] flex items-center justify-center rounded-full bg-[var(--gold-primary)]/80 hover:bg-[var(--gold-primary)]">
                      <Play size={24} className="text-[#0A0A0A] ml-1" />
                    </div>
                  </button>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-4 text-[var(--text-muted)]">
                {genStatus === "generating" ? (
                  <>
                    <Loader size={48} className="animate-spin text-[var(--gold-primary)]" />
                    <span className="text-[14px]">{genProgress}</span>
                    <span className="text-[12px] font-mono">{genElapsed}s</span>
                  </>
                ) : genStatus === "error" ? (
                  <>
                    <X size={48} className="text-red-400" />
                    <span className="text-[14px] text-red-400">{genProgress}</span>
                  </>
                ) : (
                  <>
                    <ImageIcon size={48} />
                    <span className="text-[14px]">预览区域</span>
                    <span className="text-[12px]">上传参考素材并生成视频</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 进度条 */}
          {videoUrl && (
            <div className="px-6">
              <div className="relative h-1 bg-[#2A2A2A] cursor-pointer" onClick={(e) => {
                if (!videoRef.current) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const pos = (e.clientX - rect.left) / rect.width;
                videoRef.current.currentTime = pos * videoDuration;
              }}>
                <div
                  className="absolute left-0 top-0 h-full bg-[var(--gold-primary)]"
                  style={{ width: `${videoDuration ? (videoTime / videoDuration) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {/* 底部控制栏 */}
          <div className="h-[48px] px-6 flex items-center justify-between border-t border-[#1A1A1A]">
            <div className="flex items-center gap-3">
              {/* 播放/暂停 */}
              {videoUrl && (
                <button onClick={togglePlay} className="text-[var(--text-secondary)] hover:text-[var(--gold-primary)] transition cursor-pointer">
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                </button>
              )}
              {/* 时间码 */}
              {videoUrl && (
                <span className="text-[11px] font-mono text-[var(--text-muted)]">
                  {formatTime(videoTime)} / {formatTime(videoDuration)}
                </span>
              )}
              {/* 生成状态 */}
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  genStatus === "generating" ? "bg-yellow-400 animate-pulse" :
                  genStatus === "success" ? "bg-green-400" :
                  genStatus === "error" ? "bg-red-400" :
                  "bg-[var(--text-muted)]"
                }`} />
                <span className="text-[11px] text-[var(--text-muted)]">
                  {genStatus === "generating" ? "生成中" :
                   genStatus === "success" ? "生成完成" :
                   genStatus === "error" ? "生成失败" :
                   "就绪"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* 音量 */}
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition cursor-pointer"
              >
                {isMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              {/* 全屏 */}
              <button
                onClick={() => videoRef.current?.requestFullscreen?.()}
                className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition cursor-pointer"
              >
                <Maximize2 size={14} />
              </button>
              {/* 下载 */}
              {videoUrl && (
                <button
                  onClick={handleDownload}
                  className="text-[var(--text-muted)] hover:text-[var(--gold-primary)] transition cursor-pointer"
                >
                  <Download size={14} />
                </button>
              )}
              {/* Session 状态 */}
              <span className="text-[11px] text-[var(--text-muted)]">
                Session: {settings.sessionId && settings.webId ? "Active" : "未设置"}
              </span>
            </div>
          </div>
        </div>

        {/* ═══════ 宫格图片选择弹窗（共享组件） ═══════ */}
        <GridImportModal
          open={showGridPicker}
          onClose={() => setShowGridPicker(false)}
          onImport={(images) => { handleGridImport(images); setShowGridPicker(false); }}
          defaultEpisode="ep01"
          defaultBeat={0}
          episodes={[]}
          existingKeys={new Set()}
        />

        {/* ═══════ 即梦图片库弹窗 ═══════ */}
        <JimengLibraryModal
          isOpen={showJimengLibrary}
          onClose={() => setShowJimengLibrary(false)}
          onSelect={async (dataUrl) => {
            setShowJimengLibrary(false);
            // 将 data URL 转为 File 对象，接入已有上传流程
            try {
              const res = await fetch(dataUrl);
              const blob = await res.blob();
              const file = new File([blob], `jimeng-import-${Date.now()}.png`, { type: blob.type || "image/png" });
              const dt = new DataTransfer();
              dt.items.add(file);
              handleFileUpload(dt.files);
            } catch (err) {
              console.error("[Seedance] 即梦图库导入失败:", err);
              toast("即梦图库导入失败", "error");
            }
          }}
        />

        {/* ═══════ 玩法选择弹窗 ═══════ */}
        <PlayStylePicker
          open={showPlayStylePicker}
          onClose={() => setShowPlayStylePicker(false)}
          onConfirm={(style: PlayStyleConfig, storyDesc?: string) => {
            setShowPlayStylePicker(false);
            handleAiPrompt("全能模式AI提示词", style.direction, storyDesc);
          }}
        />

        {/* ═══════ Cookie 设置弹窗 ═══════ */}
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="flex flex-col gap-5 w-[460px] bg-[var(--bg-page)] border border-[var(--border-default)] p-6 shadow-2xl">
              <div className="flex items-center justify-between">
                <span className="text-[16px] font-semibold text-[var(--text-primary)]">Seedance 设置</span>
                <button
                  onClick={() => setShowSettings(false)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-3 bg-[#1a1500] border border-[#3d3000] text-[11px] text-[#d4a739] leading-relaxed">
                <strong>安全提示：</strong>以下三个值必须从你登录即梦的浏览器中获取真实值，否则会导致账号被风控系统检测。
                <br />操作路径：访问 <a href="https://jimeng.jianying.com" target="_blank" rel="noreferrer" className="text-[var(--gold-primary)] hover:underline font-medium">jimeng.jianying.com</a> → F12 → Application → Cookies → 找到对应字段并复制值。
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-medium text-[var(--text-muted)]">sessionid <span className="text-red-400">*</span></label>
                <input
                  value={settings.sessionId}
                  onChange={(e) => setSettings((s) => ({ ...s, sessionId: e.target.value.trim() }))}
                  className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition font-mono"
                  placeholder="Cookie 中 sessionid 的值"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-medium text-[var(--text-muted)]">_tea_web_id <span className="text-red-400">*</span></label>
                <input
                  value={settings.webId}
                  onChange={(e) => setSettings((s) => ({ ...s, webId: e.target.value.trim() }))}
                  className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition font-mono"
                  placeholder="Cookie 中 _tea_web_id 的值（纯数字）"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-medium text-[var(--text-muted)]">uid_tt <span className="text-red-400">*</span></label>
                <input
                  value={settings.userId}
                  onChange={(e) => setSettings((s) => ({ ...s, userId: e.target.value.trim() }))}
                  className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition font-mono"
                  placeholder="Cookie 中 uid_tt 的值"
                />
              </div>

              <button
                onClick={() => {
                  if (!settings.sessionId || !settings.webId || !settings.userId) {
                    toast("请填写全部三个字段", "error");
                    return;
                  }
                  saveSettings(settings);
                  setShowSettings(false);
                  toast("设置已保存", "success");
                }}
                className="h-[40px] bg-[var(--gold-primary)] text-[#0A0A0A] text-[13px] font-medium hover:brightness-110 transition cursor-pointer"
              >
                保存设置
              </button>
            </div>
          </div>
        )}

        {/* ═══════ 图片放大预览 ═══════ */}
        {zoomUrl && <ImageZoomModal url={zoomUrl} onClose={() => setZoomUrl(null)} />}
      </main>
    </div>
  );
}
