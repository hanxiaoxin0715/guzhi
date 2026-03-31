"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../components/Toast";
import { useTaskQueue } from "../lib/taskQueue";
import { usePipeline } from "../lib/pipelineContext";
import type { StageState } from "../lib/pipelineContext";
import Sidebar from "../components/Sidebar";
  import {
  Play,
  Check,
  Loader,
  Circle,
  FileText,
  Sparkles,
  Lock,
  RefreshCw,
  Square,
  Palette,
  Upload,
  Image as ImageIcon,
  BookOpen,
  ChevronDown,
  ChevronsDown,
  Trash2,
  Brain,
  AlertTriangle,
  ShieldAlert,
  Pencil,
  Info,
  ChevronRight,
  Video,
  Wand2,
  Grid3X3,
  Grid2X2,
  Languages,
  ScanEye,
  Clapperboard,
  Bot,
  FileUp,
  X,
} from "lucide-react";
import { loadConsistency, loadConsistencyAsync, saveConsistency, loadSystemPromptsAsync, saveConsistencyImages, restoreConsistencyImagesFromDisk, buildConsistencyContext, collectReferenceImagesWithStyle } from "../lib/consistency";
import type { ConsistencyProfile } from "../lib/consistency";
import { loadScriptsDB, migrateScriptsFromLocalStorage } from "../lib/scriptDB";
import { kvSet, kvLoad, kvRemove } from "../lib/kvDB";
import { parseChapters } from "../lib/chapterParser";
import { archiveCurrentWorkspace, overwriteProject, getActiveProjectId, hasWorkspaceData } from "../lib/projects";
import { readFileWithEncoding } from "../lib/fileEncoding";
import AgentStoryboardPanel from "../components/AgentStoryboardPanel";

// ═══ 智能分镜类型定义 ═══
interface AnalysisPlanItem {
  gridIndex: number;
  episodeId: string;
  title: string;
  description: string;
  scenes: string[];
  beats: string[];
}
interface AnalysisResult {
  totalNineGrids: number;
  plan: AnalysisPlanItem[];
  reasoning: string;
}

function StatusIcon({ status }: { status: StageState["status"] }) {
  if (status === "done") return <Check size={18} className="text-[var(--gold-primary)]" />;
  if (status === "active") return <Loader size={18} className="text-[var(--gold-primary)] animate-spin" />;
  if (status === "waiting") return <Circle size={18} className="text-[var(--text-secondary)]" />;
  return <Lock size={18} className="text-[var(--text-muted)]" />;
}

function BtnIcon({ icon }: { icon: StageState["btnIcon"] }) {
  if (icon === "file-text") return <FileText size={14} className="text-[var(--gold-primary)]" />;
  if (icon === "sparkles") return <Sparkles size={14} className="text-[var(--gold-primary)]" />;
  return <Lock size={14} className="text-[var(--text-muted)]" />;
}

// ═══ 模式玩法说明组件（紧凑单行 + hover 弹窗） ═══
function ModeGuide({ mode }: { mode: "pipeline" | "smart" }) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!show) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [show]);

  const isPipeline = mode === "pipeline";
  const title = isPipeline
    ? "🎬 全自动流水线：剧本 → 节拍拆解 → 九宫格 → 四宫格，一键完成"
    : "🧠 AI 出方案，你来微调：分析剧本 → 编辑每格画面 → 确认翻译 → 生图";

  return (
    <div ref={ref} className="relative flex items-center gap-2 px-3 py-2 bg-[#0D0D0D] border border-[var(--border-default)]">
      <Info size={13} className="text-[var(--gold-primary)] shrink-0" />
      <span className="text-[12px] text-[var(--text-muted)] truncate">{title}</span>
      <button
        onClick={() => setShow(!show)}
        className="ml-auto shrink-0 px-2 py-0.5 text-[11px] text-[var(--gold-primary)] border border-[var(--gold-primary)]/30 bg-transparent hover:bg-[var(--gold-transparent)] transition cursor-pointer"
      >
        {show ? "收起" : "了解更多"}
      </button>
      {show && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 p-4 bg-[#111] border border-[var(--border-default)] shadow-lg shadow-black/40">
          {isPipeline ? (
            <div className="flex flex-col gap-2 text-[12px] text-[var(--text-muted)] leading-relaxed">
              <p className="text-[var(--text-secondary)]"><span className="text-[var(--gold-primary)]">适合：</span>长篇小说/剧本，一键从剧本到完整分镜。</p>
              <p>① <span className="text-[var(--text-secondary)]">AI 编剧</span> 拆分集数 + 提取节拍 → ② <span className="text-[var(--text-secondary)]">AI 分镜师</span> 生成九宫格 → ③ 展开四宫格（每格 4 个连续镜头）</p>
              <p className="text-[11px]">💡 耗时约 3-10 分钟。产出：<span className="text-[var(--text-secondary)]">节拍拆解 + 九宫格 + 四宫格提示词</span></p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 text-[12px] text-[var(--text-muted)] leading-relaxed">
              <p className="text-[var(--text-secondary)]"><span className="text-[var(--gold-primary)]">适合：</span>精细控制镜头语言，先看方案再手动调整。</p>
              <p>① 点击「✦ AI 智能分析」获取方案 → ② <span className="text-[var(--text-secondary)]">逐格编辑</span>画面描述（景别/角度/光影/台词）→ ③ 确认后自动翻译，跳转生图</p>
              <p className="text-[11px]">💡 出图质量更高，适合对画面有明确想法的创作者。目前只生成<span className="text-[var(--text-secondary)]">九宫格</span>，不含四宫格展开。</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PipelinePage() {
  const router = useRouter();
  const { toast } = useToast();
  const { addTask, removeTask } = useTaskQueue();

  //  Global pipeline state (SSE 连接在 context 层存活，跨页面不断开) 
  const {
    stages, setStages, logs, running, imageUrl, episode, setEpisode,
    startPipeline, stopPipeline, resumePipeline, canResume,
  } = usePipeline();

  const logEndRef = useRef<HTMLDivElement>(null);

  //  Script selector state 
  const [allScripts, setAllScripts] = useState<{ id: string; title: string; desc: string; content: string }[]>([]);
  const [activeScriptId, setActiveScriptId] = useState<string>("");
  const [scriptDropdownOpen, setScriptDropdownOpen] = useState(false);
  const scriptDropRef = useRef<HTMLDivElement>(null);
  const [chapterDropdownOpen, setChapterDropdownOpen] = useState(false);
  const chapterDropRef = useRef<HTMLDivElement>(null);

  // ═══ 智能分镜状态 ═══
  const [activeTab, setActiveTab] = useState<"pipeline" | "smartStoryboard" | "agentStoryboard">(() => {
    if (typeof window !== "undefined") {
      const tab = localStorage.getItem("feicai-pipeline-tab");
      if (tab === "smartStoryboard" || tab === "agentStoryboard") {
        localStorage.removeItem("feicai-pipeline-tab");
        return tab as "smartStoryboard" | "agentStoryboard";
      }
    }
    return "pipeline";
  });
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [translateProgress, setTranslateProgress] = useState(""); // "翻译中 3/27..."
  const analyzeAbortRef = useRef<AbortController | null>(null);
  // ★ 分析完成引导弹窗
  const [showAnalysisGuide, setShowAnalysisGuide] = useState(false);
  const analysisResultRef = useRef<HTMLDivElement>(null);
  const analysisGuideRef = useRef<HTMLDivElement>(null);

  // ═══ 用户分镜/剧本上传（还原模式）═══
  const [userStoryboardText, setUserStoryboardText] = useState("");
  const [userStoryboardFileName, setUserStoryboardFileName] = useState("");
  const userStoryboardInputRef = useRef<HTMLInputElement>(null);

  // ═══ 伪进度条状态：智能分镜分析 ═══
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const analyzeSteps = useMemo(() => [
    "正在解析剧本结构...",
    "识别叙事弧线与转折点...",
    "规划分集方案...",
    "分配场景与节拍...",
    "优化九宫格布局...",
    "生成分镜描述...",
    "最终校验中...",
  ], []);
  const analyzeStepIndex = useMemo(() => Math.min(Math.floor(analyzeProgress / (90 / analyzeSteps.length)), analyzeSteps.length - 1), [analyzeProgress, analyzeSteps]);

  // 智能分镜分析：伪进度条定时推进（0→90%，完成后跳100%）
  useEffect(() => {
    if (!analyzing) { setAnalyzeProgress(0); return; }
    setAnalyzeProgress(2);
    const iv = setInterval(() => {
      setAnalyzeProgress((prev) => {
        if (prev >= 90) { clearInterval(iv); return 90; }
        // 越接近90越慢：每次推进 0.3~1.5
        const step = Math.max(0.3, 1.5 * (1 - prev / 90));
        return Math.min(prev + step, 90);
      });
    }, 400);
    return () => clearInterval(iv);
  }, [analyzing]);

  // ★ 分析引导弹窗：仅用户手动点击「知道了」关闭
  // （不再自动消失、不再点击外部关闭）

  // 流水线执行：阶段内子进度（定时推进，阶段切换时重置）
  const [pipelineSubProgress, setPipelineSubProgress] = useState(0);
  const prevActiveStageNum = useRef<number | null>(null);
  useEffect(() => {
    if (!running) { setPipelineSubProgress(0); prevActiveStageNum.current = null; return; }
    const curNum = stages.find(s => s.status === "active")?.num ?? null;
    if (curNum !== prevActiveStageNum.current) {
      prevActiveStageNum.current = curNum;
      setPipelineSubProgress(2);
    }
    const iv = setInterval(() => {
      setPipelineSubProgress((prev) => {
        if (prev >= 85) return 85;
        const step = Math.max(0.2, 1.2 * (1 - prev / 85));
        return Math.min(prev + step, 85);
      });
    }, 500);
    return () => clearInterval(iv);
  }, [running, stages]);

  // ═══ 智能分镜：格子编辑状态 ═══
  const [editingCell, setEditingCell] = useState<{ epIdx: number; beatIdx: number } | null>(null);
  const [editText, setEditText] = useState("");

  /** 保存格子编辑结果 → 更新 analysisResult + KV 持久化 */
  function handleSaveCellEdit() {
    if (!editingCell || !analysisResult) return;
    const { epIdx, beatIdx } = editingCell;
    const updated: AnalysisResult = {
      ...analysisResult,
      plan: analysisResult.plan.map((ep, i) =>
        i === epIdx
          ? { ...ep, beats: ep.beats.map((b, j) => (j === beatIdx ? editText : b)) }
          : ep
      ),
    };
    setAnalysisResult(updated);
    setEditingCell(null);
    setEditText("");
    // 异步持久化到 KV（不阻塞 UI）
    kvSet("feicai-smart-analysis-result", JSON.stringify(updated)).catch(() => {});
  }

  //  Chapter selection state (set from scripts page via localStorage) 
  const [selectedChapter, setSelectedChapter] = useState<{ title: string; content: string } | null>(null);

  // ═══ 智能分镜结果持久化恢复 ═══
  useEffect(() => {
    (async () => {
      try {
        const saved = await kvLoad("feicai-smart-analysis-result");
        if (saved) {
          const parsed: AnalysisResult = JSON.parse(saved);
          if (parsed?.plan?.length) {
            setAnalysisResult(parsed);
          }
        }
      } catch { /* ignore */ }
    })();
  }, []);

  // ═══ 场景A防护：分析期间关闭浏览器标签警告 ═══
  useEffect(() => {
    if (!analyzing) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 现代浏览器忽略自定义消息，但仍会弹出标准确认框
      e.returnValue = "智能分镜 AI 分析正在进行中，关闭页面将中断分析。确定离开吗？";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [analyzing]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!scriptDropdownOpen && !chapterDropdownOpen) return;
    function handler(e: MouseEvent) {
      if (scriptDropdownOpen && scriptDropRef.current && !scriptDropRef.current.contains(e.target as Node)) {
        setScriptDropdownOpen(false);
      }
      if (chapterDropdownOpen && chapterDropRef.current && !chapterDropRef.current.contains(e.target as Node)) {
        setChapterDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [scriptDropdownOpen, chapterDropdownOpen]);

  // Load scripts + selected script on mount
  useEffect(() => {
    (async () => {
      try {
        let loaded = await loadScriptsDB();
        if (loaded.length === 0) {
          loaded = await migrateScriptsFromLocalStorage();
        }
        if (Array.isArray(loaded) && loaded.length > 0) {
          setAllScripts(loaded as { id: string; title: string; desc: string; content: string }[]);
          const selectedId = localStorage.getItem("feicai-pipeline-script-id");
          if (selectedId && loaded.some((s) => s.id === selectedId)) {
            setActiveScriptId(selectedId);
          } else {
            setActiveScriptId(loaded[0].id);
          }
          // Restore chapter selection if set from scripts page
          try {
            const chapterJson = localStorage.getItem("feicai-pipeline-script-chapter");
            if (chapterJson) {
              const ch = JSON.parse(chapterJson);
              if (ch && ch.title && ch.content) setSelectedChapter(ch);
            }
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const activeScript = allScripts.find(s => s.id === activeScriptId);

  // ★ 从当前剧本内容解析章节列表（共享解析器）
  const parsedChapters = useMemo(
    () => (activeScript?.content ? parseChapters(activeScript.content).chapters : []),
    [activeScript?.content],
  );

  function selectScript(id: string) {
    setActiveScriptId(id);
    localStorage.setItem("feicai-pipeline-script-id", id);
    // Switching script clears chapter selection
    setSelectedChapter(null);
    localStorage.removeItem("feicai-pipeline-script-chapter");
    setScriptDropdownOpen(false);
  }

  function clearChapter() {
    setSelectedChapter(null);
    localStorage.removeItem("feicai-pipeline-script-chapter");
  }

  //  Style / consistency state 
  const [consistency, setConsistency] = useState<ConsistencyProfile>(loadConsistency);
  const [analyzingStyle, setAnalyzingStyle] = useState(false);
  const [syncingStyle, setSyncingStyle] = useState(false);
  const isConsistencyLoaded = useRef(false);
  const pendingStyleRef = useRef<Pick<ConsistencyProfile["style"], "aspectRatio" | "resolution"> | null>(null);
  const consistencyRef = useRef<ConsistencyProfile>(consistency);

  useEffect(() => {
    consistencyRef.current = consistency;
  }, [consistency]);

  useEffect(() => {
    (async () => {
      // Plan B: 从磁盘恢复一致性参考图（代替 IDB）
      const restored = await restoreConsistencyImagesFromDisk(await loadConsistencyAsync());
      // 以 settings 中的画幅/画质为高优先级回填，避免 UI 回弹到默认 16:9/4K
      let settingsStyle: Partial<ConsistencyProfile["style"]> = {};
      try {
        const rawSettings = localStorage.getItem("feicai-settings");
        const parsedSettings = rawSettings ? JSON.parse(rawSettings) : {};
        const ratio = parsedSettings?.["img-aspect-ratio"];
        const size = parsedSettings?.["img-size"];
        if (ratio === "16:9" || ratio === "9:16") settingsStyle.aspectRatio = ratio;
        if (size === "1K" || size === "2K" || size === "4K") settingsStyle.resolution = size;
      } catch { /* ignore */ }

      const restoredWithSettings: ConsistencyProfile = {
        ...restored,
        style: {
          ...restored.style,
          ...settingsStyle,
          styleLocked: false,
        },
      };
      setConsistency((prev) => {
        // 若用户在异步恢复完成前已修改画幅/画质，优先保留用户修改，避免被旧数据覆盖
        if (pendingStyleRef.current) {
          const pendingStyle = pendingStyleRef.current;
          pendingStyleRef.current = null;
          return {
            ...restoredWithSettings,
            style: {
              ...restoredWithSettings.style,
              aspectRatio: pendingStyle.aspectRatio,
              resolution: pendingStyle.resolution,
            },
          };
        }
        return restoredWithSettings;
      });
      // 若从 settings 回填了画幅/画质，立即反写到 consistency 存储，统一数据源
      if (
        restoredWithSettings.style.aspectRatio !== restored.style.aspectRatio ||
        restoredWithSettings.style.resolution !== restored.style.resolution
      ) {
        saveConsistency(restoredWithSettings);
      }
      isConsistencyLoaded.current = true;
    })();
  }, []);

  // Auto-save consistency after state changes (replaces fire-and-forget in updateConsistency)
  const consistencyFpRef = useRef("");
  useEffect(() => {
    if (!isConsistencyLoaded.current) return;
    // Fingerprint to avoid redundant saves
    const fp = JSON.stringify({
      s: consistency.style.artStyle,
      c: consistency.style.colorPalette,
      sp: consistency.style.stylePrompt?.slice(0, 60),
      si: consistency.style.styleImage?.length || 0,
      r: consistency.style.resolution,
      a: consistency.style.aspectRatio,
      chars: consistency.characters.length,
      scenes: consistency.scenes.length,
      props: consistency.props.length,
    });
    if (fp === consistencyFpRef.current) return;
    consistencyFpRef.current = fp;
    saveConsistency(consistency);
    saveConsistencyImages(consistency);
  }, [consistency]);

  const updateConsistency = useCallback((updater: (prev: ConsistencyProfile) => ConsistencyProfile) => {
    setConsistency((prev) => {
      const next = updater(prev);
      const styleSyncChanged =
        prev.style.aspectRatio !== next.style.aspectRatio ||
        prev.style.resolution !== next.style.resolution;
      // 异步恢复完成前，先缓存用户改动并立即持久化，避免返回旧数据时发生“自动还原”
      if (!isConsistencyLoaded.current) {
        pendingStyleRef.current = {
          aspectRatio: next.style.aspectRatio,
          resolution: next.style.resolution,
        };
        saveConsistency(next);
        saveConsistencyImages(next);
      } else if (styleSyncChanged) {
        // 关键设定（画幅/画质）变化时立即落盘，避免快速切页丢失
        saveConsistency(next);
        saveConsistencyImages(next);
      }
      // Saves now handled by useEffect above — no fire-and-forget needed
      try {
        const s = JSON.parse(localStorage.getItem("feicai-settings") || "{}");
        s["img-size"] = next.style.resolution;
        s["img-aspect-ratio"] = next.style.aspectRatio;
        localStorage.setItem("feicai-settings", JSON.stringify(s));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  async function handleSyncToStudio() {
    try {
      setSyncingStyle(true);
      // 同步时优先读取 feicai-settings，避免“刚点选参数马上点同步”时拿到旧 state
      let latestRatio: "16:9" | "9:16" | undefined;
      let latestResolution: "1K" | "2K" | "4K" | undefined;
      try {
        const raw = localStorage.getItem("feicai-settings");
        const parsed = raw ? JSON.parse(raw) : {};
        const ratio = parsed?.["img-aspect-ratio"];
        const size = parsed?.["img-size"];
        if (ratio === "16:9" || ratio === "9:16") latestRatio = ratio;
        if (size === "1K" || size === "2K" || size === "4K") latestResolution = size;
      } catch { /* ignore */ }

      const latest = {
        ...consistencyRef.current,
        style: {
          ...consistencyRef.current.style,
          aspectRatio: latestRatio || consistencyRef.current.style.aspectRatio,
          resolution: latestResolution || consistencyRef.current.style.resolution,
          styleLocked: false,
        },
      };
      consistencyRef.current = latest;
      setConsistency(latest);

      const s = JSON.parse(localStorage.getItem("feicai-settings") || "{}");
      s["img-size"] = latest.style.resolution;
      s["img-aspect-ratio"] = latest.style.aspectRatio;
      localStorage.setItem("feicai-settings", JSON.stringify(s));
      localStorage.setItem("feicai-style-sync-ts", String(Date.now()));

      await saveConsistency(latest);
      await saveConsistencyImages(latest);
      toast(`已同步到生图工作台：${latest.style.aspectRatio} · ${latest.style.resolution}`, "success");
    } catch {
      toast("同步失败，请重试", "error");
    } finally {
      setSyncingStyle(false);
    }
  }

  function compressImageForApi(dataUrl: string, maxDim = 1024, quality = 0.8): Promise<string> {
    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(dataUrl); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  async function handleStyleAnalyze(imgUrl: string) {
    setAnalyzingStyle(true);
    const taskId = `llm-style-pipeline-${Date.now()}`;
    addTask({ id: taskId, type: "llm", label: "AI风格识别", detail: "文本模型" });
    try {
      const savedSettings = localStorage.getItem("feicai-settings");
      const settings: Record<string, string> = savedSettings ? JSON.parse(savedSettings) : {};
      if (!settings["llm-key"]) {
        toast("请先在「设置」页配置 LLM API Key", "error");
        return;
      }
      const systemPrompts = await loadSystemPromptsAsync();
      const res = await fetch("/api/style-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: imgUrl, settings, customPrompt: systemPrompts.styleAnalyze || undefined }),
      });
      if (res.ok) {
        const data = await res.json();
        updateConsistency((prev) => ({
          ...prev,
          style: {
            ...prev.style,
            artStyle: data.artStyle || prev.style.artStyle,
            colorPalette: data.colorPalette || prev.style.colorPalette,
            stylePrompt: JSON.stringify({
              artStyle: data.artStyle || "",
              colorPalette: data.colorPalette || "",
              styleKeywords: data.styleKeywords || "",
              mood: data.mood || "",
            }),
          },
        }));
        // Also persist stylePrompt to server for cross-page sync reliability
        try {
          const promptData = JSON.stringify({
            artStyle: data.artStyle || "",
            colorPalette: data.colorPalette || "",
            styleKeywords: data.styleKeywords || "",
            mood: data.mood || "",
          });
          await fetch("/api/ref-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: "style-prompt", imageData: `data:application/json;base64,${btoa(unescape(encodeURIComponent(promptData)))}` }),
          });
        } catch { /* best effort */ }
        toast("风格识别完成 ", "success");
      } else {
        const err = await res.json().catch(() => ({}));
        const rawHint = err.raw ? ` [raw: ${String(err.raw).slice(0, 80)}]` : "";
        toast(`风格识别失败: ${err.error || "未知"}${rawHint}`, "error");
      }
    } catch { toast("风格识别网络错误", "error"); } finally { removeTask(taskId); setAnalyzingStyle(false); }
  }

  function handleStyleUpload() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 50 * 1024 * 1024) { toast("图片过大，请使用小于50MB的图片", "error"); return; }
      const fileReader = new FileReader();
      fileReader.onload = async (ev) => {
        const dataUrl = ev.target?.result as string;
        updateConsistency((prev) => ({
          ...prev, style: { ...prev.style, styleImage: dataUrl },
        }));
        // Also persist to server file system so studio page stays in sync
        try {
          await fetch("/api/ref-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: "style-image", imageData: dataUrl }),
          });
        } catch (err) { console.error("[handleStyleUpload] 风格图磁盘保存失败:", err); }
        const compressed = await compressImageForApi(dataUrl, 1024, 0.8);
        await handleStyleAnalyze(compressed);
      };
      fileReader.readAsDataURL(file);
    };
    input.click();
  }

  // Local state for style prompt textarea (avoids heavy saveConsistency on every keystroke)
  const [localStylePrompt, setLocalStylePrompt] = useState("");
  const localStylePromptInited = useRef(false);
  const stylePromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localStylePromptRef = useRef(""); // tracks latest value for unmount flush

  // Sync from consistency → local (on mount or external changes)
  useEffect(() => {
    const raw = consistency.style.stylePrompt || "";
    let display: string;
    try {
      const sp = JSON.parse(raw);
      const lines: string[] = [];
      if (sp.artStyle) lines.push(`画风：${sp.artStyle}`);
      if (sp.colorPalette) lines.push(`色调：${sp.colorPalette}`);
      if (sp.styleKeywords) lines.push(`关键词：${sp.styleKeywords}`);
      if (sp.mood) lines.push(`氛围：${sp.mood}`);
      display = lines.join("\n");
    } catch {
      display = raw;
    }
    // Only overwrite if not user-initiated (avoid cursor jumps)
    if (!localStylePromptInited.current || display !== localStylePrompt) {
      setLocalStylePrompt(display);
      localStylePromptInited.current = true;
    }
  }, [consistency.style.stylePrompt]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStylePromptChange = useCallback((value: string) => {
    setLocalStylePrompt(value);
    localStylePromptRef.current = value; // keep ref in sync for unmount flush
    // Debounce: only persist after 500ms idle
    if (stylePromptTimerRef.current) clearTimeout(stylePromptTimerRef.current);
    stylePromptTimerRef.current = setTimeout(() => {
      updateConsistency((prev) => ({
        ...prev,
        style: { ...prev.style, stylePrompt: value },
      }));
    }, 500);
  }, [updateConsistency]);

  // Flush pending style prompt on unmount (prevents data loss on fast navigation)
  useEffect(() => {
    return () => {
      // ★ 清理未触发的 debounce 定时器
      if (stylePromptTimerRef.current) {
        clearTimeout(stylePromptTimerRef.current);
      }
      // ★ 如果有未保存的风格文本，先合并到 consistencyRef 内存态
      const pendingValue = localStylePromptRef.current;
      if (pendingValue && consistencyRef.current.style.stylePrompt !== pendingValue) {
        consistencyRef.current = {
          ...consistencyRef.current,
          style: { ...consistencyRef.current.style, stylePrompt: pendingValue },
        };
      }
      // ★ 一次性保存完整内存态（含已合并的风格文本），避免两个 async flush 竞态
      (async () => {
        try {
          const latest = consistencyRef.current;
          await saveConsistency(latest);
          await saveConsistencyImages(latest);
        } catch { /* best effort */ }
      })();
    };
  }, []);

  // Delete style image handler
  function handleDeleteStyleImage() {
    updateConsistency((prev) => ({
      ...prev, style: { ...prev.style, styleImage: "" },
    }));
    // Delete from server (both image and prompt)
    fetch("/api/ref-image?key=style-image", { method: "DELETE" }).catch(() => {});
    fetch("/api/ref-image?key=style-prompt", { method: "DELETE" }).catch(() => {});
  }

  //  Auto-scroll log 
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ═══ 智能分镜：AI 智能分析 ═══

  // ── 自动存档：启动节拍拆解/智能分镜时自动保存项目快照 ──
  async function autoSaveProject() {
    try {
      const has = await hasWorkspaceData();
      if (!has) return;
      const activeId = await getActiveProjectId();
      if (activeId) {
        // 已有活跃项目，覆盖更新
        await overwriteProject(activeId);
        console.log("[自动存档] 已覆盖保存到现有项目", activeId);
      } else {
        // 新建存档，名称 = 剧本名 + 章节名
        const scriptName = activeScript?.title || "未命名剧本";
        const chapterName = selectedChapter?.title || "";
        const archiveName = chapterName ? `${scriptName}·${chapterName}` : scriptName;
        await archiveCurrentWorkspace(archiveName);
        console.log("[自动存档] 已新建存档:", archiveName);
      }
    } catch (e) {
      console.error("[自动存档] 失败:", e);
    }
  }

  // ═══ AgentFAB director-command 事件监听（支持FC全自动助手）═══
  useEffect(() => {
    const cmdHandler = (e: Event) => {
      const ce = e as CustomEvent;
      const { action, params = {}, requestId } = ce.detail || {};
      let success = true;
      let result = "";
      let error = "";
      try {
        switch (action) {
          case "runPipeline":
            handleRunPipeline();
            result = "流水线已启动";
            break;
          case "stopPipeline":
            stopPipeline();
            result = "流水线已停止";
            break;
          case "smartAnalyze":
            handleSmartAnalyze();
            result = "智能分镜分析已启动";
            break;
          case "confirmPlan":
            handleConfirmPlan();
            result = "分镜方案确认已启动";
            break;
          case "syncToStudio":
            handleSyncToStudio();
            result = "正在同步到Studio";
            break;
          case "selectScript": {
            const sid = params.scriptId as string;
            if (sid) { selectScript(sid); result = `已选择剧本 ${sid}`; }
            break;
          }
          case "switchPipelineTab": {
            const tab = params.tab as string;
            if (tab) { setActiveTab(tab as "pipeline" | "smartStoryboard" | "agentStoryboard"); result = `已切换到 ${tab}`; }
            break;
          }
          default:
            success = false;
            error = `Pipeline页未实现的操作: ${action}`;
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

  async function handleSmartAnalyze() {
    const savedSettings = localStorage.getItem("feicai-settings");
    if (!savedSettings) {
      toast("请先在设置页配置 API Key", "error");
      router.push("/settings");
      return;
    }
    let settings: Record<string, string>;
    try {
      settings = JSON.parse(savedSettings);
    } catch {
      toast("设置数据损坏，请重新配置", "error");
      return;
    }
    if (!settings["llm-key"]) {
      toast("请先在设置页配置 LLM API Key", "error");
      router.push("/settings");
      return;
    }

    // ★ 还原模式判断：用户上传了分镜文件时走还原路径
    const isRestoreMode = userStoryboardText.length > 0;
    const scriptContent = selectedChapter?.content || activeScript?.content || "";
    if (!isRestoreMode && (!scriptContent || scriptContent.length < 50)) {
      toast("请先选择一个剧本，或在剧本管理页导入剧本", "error");
      return;
    }
    if (isRestoreMode && userStoryboardText.length < 20) {
      toast("上传的分镜文件内容过短，请检查文件", "error");
      return;
    }

    setAnalyzing(true);
    setAnalysisError("");
    setAnalysisResult(null);

    // ★ 自动存档（fire-and-forget，不阻塞分析流程）
    autoSaveProject();

    // 取消上一次分析请求
    analyzeAbortRef.current?.abort();
    const abortCtrl = new AbortController();
    analyzeAbortRef.current = abortCtrl;

    try {
      const systemPrompts = await loadSystemPromptsAsync();

      // ★ 提取角色/场景/道具已移到「确认方案」步骤（带锁定 UI），此处仅做分析

      const res = await fetch("/api/analyze-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: scriptContent,
          settings,
          customPrompt: systemPrompts.analyzeScript || undefined,
          ...(isRestoreMode ? {
            userStoryboard: userStoryboardText,
            customRestorePrompt: systemPrompts.restoreStoryboard || undefined,
          } : {}),
        }),
        signal: abortCtrl.signal,
      });

      if (abortCtrl.signal.aborted) return;

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API 错误 (${res.status}): ${errText}`);
      }

      const data = await res.json();
      if (!data.plan || !Array.isArray(data.plan)) {
        throw new Error("分析结果格式异常：缺少 plan 数组");
      }
      // 客户端二次验证（服务端已做主要验证+标准化）
      const validated: AnalysisResult = {
        totalNineGrids: typeof data.totalNineGrids === "number" ? data.totalNineGrids : data.plan.length,
        plan: data.plan.map((ep: AnalysisPlanItem, i: number) => ({
          gridIndex: ep.gridIndex || i + 1,
          episodeId: ep.episodeId || `ep${String(i + 1).padStart(2, "0")}`,
          title: ep.title || `第${i + 1}集`,
          description: ep.description || "",
          scenes: Array.isArray(ep.scenes) ? ep.scenes : [],
          beats: Array.isArray(ep.beats) ? ep.beats.slice(0, 9) : [],
        })),
        reasoning: typeof data.reasoning === "string" ? data.reasoning : "",
      };

      setAnalysisResult(validated);
      // 持久化分析结果到 KV，供切换页面后恢复
      kvSet("feicai-smart-analysis-result", JSON.stringify(validated)).catch(() => {});
      toast(`✓ 分析完成 · 建议 ${validated.plan.length} 集 · 共 ${validated.totalNineGrids} 个九宫格`, "success");
      // ★ 弹出引导提示
      setShowAnalysisGuide(true);
      // 延迟滚动到结果区域
      setTimeout(() => {
        analysisResultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
    } catch (e: unknown) {
      if (abortCtrl.signal.aborted) return; // 用户主动取消，不显示错误
      const msg = e instanceof Error ? e.message : String(e);
      setAnalysisError(msg);
      toast(`分析失败: ${msg}`, "error");
    } finally {
      setAnalyzing(false);
    }
  }

  // ═══ 智能分镜：确认方案 → AI翻译中英双语 → 保存 KV + 输出文件 → 跳转 Studio ═══
  async function handleConfirmPlan() {
    if (!analysisResult?.plan?.length || confirming) return;
    setConfirming(true);
    setTranslateProgress("");

    try {
      // ★ Step 1: 验证 LLM 设置
      const savedSettings = localStorage.getItem("feicai-settings");
      const settings: Record<string, string> = savedSettings ? JSON.parse(savedSettings) : {};
      const apiKey = settings["llm-key"];
      if (!apiKey) {
        toast("请先在设置页配置 LLM API Key，才能翻译提示词", "error");
        setConfirming(false);
        return;
      }

      // ★ Step 1.5: 跳过提取（智能分镜模式不自动提取角色/场景/道具，用户可在生图工作台手动提取）
      setTranslateProgress("准备翻译分镜提示词...");

      const { TRANSLATE_GRID_PROMPT } = await import("../lib/defaultPrompts");

      // ★ Step 2: 收集需要翻译的 beats（过滤空格子）
      const allBeats: { epIdx: number; beatIdx: number; chinese: string }[] = [];
      for (let epIdx = 0; epIdx < analysisResult.plan.length; epIdx++) {
        const ep = analysisResult.plan[epIdx];
        for (let beatIdx = 0; beatIdx < ep.beats.length; beatIdx++) {
          const beat = ep.beats[beatIdx];
          if (beat && beat.trim() && !beat.includes("（空）")) {
            allBeats.push({ epIdx, beatIdx, chinese: beat.trim() });
          }
        }
      }

      const totalBeats = allBeats.length;
      if (totalBeats === 0) {
        toast("没有可翻译的分镜内容", "error");
        setConfirming(false);
        return;
      }

      // 深拷贝 plan 用于存放翻译结果
      const translatedPlan = analysisResult.plan.map(ep => ({
        ...ep,
        beats: [...ep.beats],
      }));

      // ★ Step 3: 并发翻译（5 并发池）
      let doneCount = 0;
      setTranslateProgress(`翻译中 0/${totalBeats}`);

      const translateOne = async (item: typeof allBeats[0]) => {
        try {
          const res = await fetch("/api/llm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              apiKey,
              baseUrl: (settings["llm-url"] || "https://api.geeknow.top/v1").replace(/\/+$/, ""),
              model: settings["llm-model"] || "gemini-2.5-flash",
              provider: settings["llm-provider"] || "openAi",
              systemPrompt: TRANSLATE_GRID_PROMPT,
              prompt: item.chinese,
              maxTokens: 800,
            }),
            signal: AbortSignal.timeout(120_000),
          });
          if (!res.ok) throw new Error(`API ${res.status}`);
          const data = await res.json();
          const translated = (data.text || data.content || "").trim();
          if (translated) {
            // ★ 格式与 Studio handleTranslatePrompt 一致：中文 + [IMG] + 英文
            translatedPlan[item.epIdx].beats[item.beatIdx] =
              `${item.chinese}\n\n**[IMG]** ${translated}`;
          }
        } catch (e) {
          console.warn(`[翻译] EP${item.epIdx + 1} 格${item.beatIdx + 1} 失败:`, e);
          // 翻译失败保留原始中文，不中断流程
        }
        doneCount++;
        setTranslateProgress(`翻译中 ${doneCount}/${totalBeats}（EP${item.epIdx + 1} 格${item.beatIdx + 1}）`);
      };

      const CONCURRENCY = 5;
      const queue = [...allBeats];
      const workers = Array.from(
        { length: Math.min(CONCURRENCY, queue.length) },
        async () => {
          while (queue.length > 0) {
            const item = queue.shift()!;
            await translateOne(item);
          }
        }
      );
      await Promise.all(workers);

      setTranslateProgress("保存分镜数据到本地...");

      // ★ Step 4: 保存翻译后的 beats 到 KV（供 Studio loadSmartNinePrompts 读取）
      for (let epIdx = 0; epIdx < translatedPlan.length; epIdx++) {
        const ep = translatedPlan[epIdx];
        setTranslateProgress(`保存 EP${epIdx + 1}/${translatedPlan.length} 到本地...`);
        const key = `feicai-smart-nine-prompts-${ep.episodeId}`;
        await kvSet(key, JSON.stringify({
          episodeId: ep.episodeId,
          title: ep.title,
          description: ep.description,
          scenes: ep.scenes,
          beats: ep.beats,
        }));
      }

      // 同时写入磁盘输出文件（持久化 + 供 detectEpisodes 发现 EP）
      const outputFiles = translatedPlan.map(ep => ({
        name: `smart-nine-prompt-${ep.episodeId}.md`,
        content: [
          `# ${ep.title}`,
          `> ${ep.description}`,
          "",
          ...ep.beats.map((b: string, i: number) => `## 格${i + 1}\n${b}`),
          "",
          `场景: ${ep.scenes.join(", ")}`,
        ].join("\n"),
      }));

      await fetch("/api/outputs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: outputFiles }),
      });

      const failCount = allBeats.length - translatedPlan.reduce((sum, ep) =>
        sum + ep.beats.filter(b => b.includes("**[IMG]**")).length, 0);
      const successMsg = failCount > 0
        ? `✓ 已翻译 ${totalBeats - failCount}/${totalBeats} 格（${failCount} 格保留中文），跳转生图工作台...`
        : `✓ 已翻译全部 ${totalBeats} 格分镜（${translatedPlan.length} 集），跳转生图工作台...`;
      toast(successMsg, "success");

      // ★ 不清除分析结果缓存 — 用户导航回来时仍可查看
      // 标记 Studio 进入智能分镜模式（不自动生成九宫格，用户手动触发）
      localStorage.setItem("feicai-studio-smart-mode", "smartNine");
      router.push("/studio");
    } catch (e) {
      toast(`保存失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setConfirming(false);
      setTranslateProgress("");
    }
  }

  //  Run pipeline via global context 
  async function handleRunPipeline() {
    const savedSettings = localStorage.getItem("feicai-settings");
    if (!savedSettings) {
      toast("请先在设置页配置 API Key", "error");
      router.push("/settings");
      return;
    }
    let settings: Record<string, string>;
    try {
      settings = JSON.parse(savedSettings);
    } catch {
      toast("设置数据损坏，请重新配置", "error");
      router.push("/settings");
      return;
    }
    if (!settings["llm-key"]) {
      toast("请先在设置页配置 LLM API Key", "error");
      router.push("/settings");
      return;
    }

    // Use chapter content if a chapter is selected, otherwise full script
    const scriptContent = selectedChapter?.content || activeScript?.content || "";
    if (!scriptContent || scriptContent.length < 50) {
      toast("请先选择一个剧本，或在剧本管理页导入剧本", "error");
      if (allScripts.length === 0) router.push("/scripts");
      return;
    }

    const systemPromptsPipeline = await loadSystemPromptsAsync();

    // ★ 自动存档（fire-and-forget，不阻塞流水线）
    autoSaveProject();

    // Collect reference images INCLUDING style image for text LLM (Gem.txt requires style tag extraction)
    const refImages = collectReferenceImagesWithStyle(consistency);

    startPipeline({
      script: scriptContent,
      scriptTitle: selectedChapter ? `${activeScript?.title || "?"} · ${selectedChapter.title}` : (activeScript?.title || "?"),
      episode,
      settings,
      consistencyContext: buildConsistencyContext(consistency),
      referenceImages: refImages.length > 0 ? refImages : undefined,
      customPrompts: {
        nineGridGem: systemPromptsPipeline.nineGridGem || undefined,
        fourGridGem: systemPromptsPipeline.fourGridGem || undefined,
        beatBreakdown: systemPromptsPipeline.beatBreakdown || undefined,
      },
    });
  }

  const allDone = stages.every((s) => s.status === "done");
  // 节拍拆解流水线是否已有内容（任何阶段完成即视为有内容）—— 用于对称锁定智能分镜
  const hasPipelineContent = stages.some((s) => s.status === "done");

  // 当前正在执行的阶段（用于提示面板动态文案）
  const activeStage = stages.find((s) => s.status === "active");
  const activeStageDesc = activeStage
    ? `正在执行：${activeStage.title}（${activeStage.num}/${stages.length}）`
    : "等待下一阶段...";

  return (
    <div className="flex h-full w-full relative">
      <Sidebar />

      {/* ★ 流水线执行中全页面锁定遮罩 — 仅「停止执行」按钮可点击 */}
      {running && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" />
      )}

      {/* ★ 智能分镜分析中全页面锁定遮罩 — 与流水线执行一致 */}
      {analyzing && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" />
      )}

      {/* ★ 确认方案执行中全页面锁定遮罩 */}
      {confirming && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" />
      )}
      {confirming && (() => {
        // 解析翻译进度 "翻译中 3/27" → percent
        const m = translateProgress.match(/(\d+)\/(\d+)/);
        const tDone = m ? parseInt(m[1]) : 0;
        const tTotal = m ? parseInt(m[2]) : 0;
        const tPct = tTotal > 0 ? Math.round((tDone / tTotal) * 100) : 0;
        // 动态标题：根据当前阶段显示不同文案
        const phaseTitle = translateProgress.startsWith("保存")
          ? "正在保存分镜数据"
          : tTotal > 0
            ? `正在翻译分镜专用英文提示词（${tDone}/${tTotal}）`
            : "正在准备翻译分镜提示词";
        return (
          <div className="fixed inset-0 z-[45] flex items-start justify-center pointer-events-none" style={{ paddingTop: "80px" }}>
            <div className="pointer-events-auto flex flex-col gap-0 bg-[#1A1200]/95 border border-[var(--gold-primary)] shadow-[0_0_30px_rgba(201,169,98,0.15)] backdrop-blur-sm max-w-[600px] w-[500px] overflow-hidden">
              <div className="flex items-center gap-4 px-6 py-4">
                <Loader size={20} className="text-[var(--gold-primary)] animate-spin shrink-0" />
                <div className="flex flex-col gap-1 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] font-medium text-[var(--gold-primary)]">
                      {phaseTitle}
                    </span>
                    {tTotal > 0 && <span className="text-[13px] font-mono text-[var(--gold-primary)]">{tPct}%</span>}
                  </div>
                  <span className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                    {translateProgress || "准备中..."}
                  </span>
                </div>
              </div>
              {/* 翻译进度条 */}
              <div className="px-4 pb-3">
                <div className="h-[6px] w-full bg-[#2A2000] rounded-full overflow-hidden">
                  <div className="h-full bg-[var(--gold-primary)] rounded-full transition-all duration-300 ease-out" style={{ width: tTotal > 0 ? `${tPct}%` : '0%' }} />
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      {/* 智能分镜分析提示面板（浮动在遮罩之上） */}
      {analyzing && (
        <div className="fixed inset-0 z-[45] flex items-start justify-center pointer-events-none" style={{ paddingTop: "80px" }}>
          <div className="pointer-events-auto flex flex-col gap-0 bg-[#1A1200]/95 border border-[var(--gold-primary)] shadow-[0_0_30px_rgba(201,169,98,0.15)] backdrop-blur-sm max-w-[600px] w-[500px] overflow-hidden">
            <div className="flex items-center gap-4 px-6 py-4">
              <Loader size={20} className="text-[var(--gold-primary)] animate-spin shrink-0" />
              <div className="flex flex-col gap-1 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-medium text-[var(--gold-primary)]">
                    智能分镜 AI 分析中 · 页面已锁定
                  </span>
                  <span className="text-[13px] font-mono text-[var(--gold-primary)]">{Math.round(analyzeProgress)}%</span>
                </div>
                <span className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                  {analyzeSteps[analyzeStepIndex]}
                </span>
              </div>
            </div>
            {/* 分析进度条 */}
            <div className="px-4 pb-3">
              <div className="h-[6px] w-full bg-[#2A2000] rounded-full overflow-hidden">
                <div className="h-full bg-[var(--gold-primary)] rounded-full transition-all duration-300 ease-out" style={{ width: `${analyzeProgress}%` }} />
              </div>
            </div>
            {/* 步骤指示器 */}
            <div className="flex gap-[3px] px-4 pb-3">
              {analyzeSteps.map((step, i) => (
                <div key={i} className={`flex-1 h-[3px] rounded-full transition-all duration-300 ${
                  i < analyzeStepIndex ? 'bg-[var(--gold-primary)]' :
                  i === analyzeStepIndex ? 'bg-[var(--gold-primary)]/60' :
                  'bg-[#2A2000]'
                }`} title={step} />
              ))}
            </div>
          </div>
        </div>
      )}
      {/* 流水线执行提示面板（浮动在遮罩之上，整个执行期间持续显示） */}
      {running && (() => {
        const doneCount = stages.filter(s => s.status === "done").length;
        const totalPct = Math.round(((doneCount * 100) + (activeStage ? pipelineSubProgress : 0)) / stages.length);
        return (
          <div className="fixed inset-0 z-[45] flex items-start justify-center pointer-events-none" style={{ paddingTop: "80px" }}>
            <div className="pointer-events-auto flex flex-col gap-0 bg-[#1A1200]/95 border border-[var(--gold-primary)] shadow-[0_0_30px_rgba(201,169,98,0.15)] backdrop-blur-sm max-w-[600px] w-[500px] overflow-hidden">
              <div className="flex items-center gap-4 px-6 py-4">
                <Loader size={20} className="text-[var(--gold-primary)] animate-spin shrink-0" />
                <div className="flex flex-col gap-1 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[14px] font-medium text-[var(--gold-primary)]">
                      流水线执行中 · 页面已锁定
                    </span>
                    <span className="text-[13px] font-mono text-[var(--gold-primary)]">{totalPct}%</span>
                  </div>
                  <span className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                    {activeStageDesc}，点击右上角「停止执行」可中断
                  </span>
                </div>
              </div>
              {/* 总进度条 */}
              <div className="px-4 pb-2">
                <div className="h-[6px] w-full bg-[#2A2000] rounded-full overflow-hidden">
                  <div className="h-full bg-[var(--gold-primary)] rounded-full transition-all duration-500 ease-out" style={{ width: `${totalPct}%` }} />
                </div>
              </div>
              {/* 阶段分段进度条 */}
              <div className="flex gap-[3px] px-4 pb-2">
                {stages.map((s) => (
                  <div key={s.num} className="flex-1 h-[4px] bg-[#2A2000] rounded-full overflow-hidden">
                    {s.status === "done" ? (
                      <div className="h-full w-full bg-[var(--gold-primary)] rounded-full" />
                    ) : s.status === "active" ? (
                      <div className="h-full bg-[var(--gold-primary)]/70 rounded-full transition-all duration-500 ease-out" style={{ width: `${pipelineSubProgress}%` }} />
                    ) : null}
                  </div>
                ))}
              </div>
              {/* 阶段文字标签 */}
              <div className="flex gap-[3px] px-4 pb-3">
                {stages.map((s) => (
                  <span key={s.num} className={`flex-1 text-center text-[10px] ${
                    s.status === "done" ? "text-[var(--gold-primary)]" :
                    s.status === "active" ? "text-[var(--text-secondary)]" :
                    "text-[var(--text-muted)]"
                  }`}>
                    {s.status === "done" ? `✓ ${s.title}` : s.title}
                  </span>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      <main className="flex-1 flex flex-col gap-7 p-8 px-10 overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between w-full">
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-normal text-[var(--text-secondary)]">
              集数由 AI 根据剧本时长智能划分  3秒/格  27秒/九宫格
            </span>
            <h1 className="font-serif text-[40px] font-medium text-[var(--text-primary)]">
              分镜流水线
            </h1>
          </div>

          {/* Script selector — 二级选择：小说 + 章节 */}
          <div className="flex items-center gap-2">
            {/* 一级：小说选择 */}
            <div className="relative" ref={scriptDropRef}>
              <button
                onClick={() => setScriptDropdownOpen(!scriptDropdownOpen)}
                className="flex items-center gap-2 px-4 py-2.5 border border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--gold-primary)] transition cursor-pointer min-w-[180px] max-w-[300px]"
              >
                <BookOpen size={14} className="text-[var(--gold-primary)] shrink-0" />
                <div className="flex flex-col items-start flex-1 min-w-0">
                  <span className="text-[10px] text-[var(--text-muted)]">选择小说</span>
                  <span className="text-[13px] font-medium text-[var(--text-primary)] truncate w-full text-left">
                    {activeScript?.title || "未选择"}
                  </span>
                </div>
                <ChevronDown size={14} className={`text-[var(--text-muted)] transition ${scriptDropdownOpen ? "rotate-180" : ""}`} />
              </button>
              {scriptDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 w-[280px] max-h-[300px] overflow-auto bg-[var(--bg-surface)] border border-[var(--border-default)] shadow-lg z-50">
                  {allScripts.length === 0 ? (
                    <div className="px-4 py-3 text-[12px] text-[var(--text-muted)]">暂无剧本，请先在剧本管理页导入</div>
                  ) : allScripts.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => selectScript(s.id)}
                      className={`w-full flex flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-[var(--gold-transparent)] transition cursor-pointer ${
                        s.id === activeScriptId ? "bg-[var(--gold-transparent)] border-l-2 border-[var(--gold-primary)]" : ""
                      }`}
                    >
                      <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">{s.title}</span>
                      <span className="text-[11px] text-[var(--text-muted)] truncate">{s.desc}  {(s.content?.length || 0).toLocaleString()}字</span>
                    </button>
                  ))}
                  <button
                    onClick={() => { setScriptDropdownOpen(false); router.push("/scripts"); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-[12px] text-[var(--gold-primary)] border-t border-[var(--border-default)] hover:bg-[var(--gold-transparent)] transition cursor-pointer"
                  >
                    <BookOpen size={12} />
                    前往剧本管理
                  </button>
                </div>
              )}
            </div>

            {/* 二级：章节选择 */}
            {activeScript && parsedChapters.length > 0 && (
              <div className="relative" ref={chapterDropRef}>
                <button
                  onClick={() => setChapterDropdownOpen(!chapterDropdownOpen)}
                  className={`flex items-center gap-2 px-4 py-2.5 border transition cursor-pointer min-w-[180px] max-w-[320px] ${
                    selectedChapter
                      ? "border-[var(--gold-primary)] bg-[var(--gold-transparent)]"
                      : "border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--gold-primary)]"
                  }`}
                >
                  <FileText size={14} className="text-[var(--gold-primary)] shrink-0" />
                  <div className="flex flex-col items-start flex-1 min-w-0">
                    <span className="text-[10px] text-[var(--text-muted)]">选择章节</span>
                    <span className="text-[13px] font-medium text-[var(--text-primary)] truncate w-full text-left">
                      {selectedChapter ? selectedChapter.title : "全文（未选择章节）"}
                    </span>
                    {selectedChapter && (
                      <span className="text-[10px] text-[var(--gold-primary)]">
                        {selectedChapter.content.replace(/\s/g, "").length.toLocaleString()}字
                      </span>
                    )}
                  </div>
                  <ChevronDown size={14} className={`text-[var(--text-muted)] transition ${chapterDropdownOpen ? "rotate-180" : ""}`} />
                </button>
                {chapterDropdownOpen && (
                  <div className="absolute right-0 top-full mt-1 w-[300px] max-h-[320px] overflow-auto bg-[var(--bg-surface)] border border-[var(--border-default)] shadow-lg z-50">
                    {/* 使用全文选项 */}
                    <button
                      onClick={() => { clearChapter(); setChapterDropdownOpen(false); }}
                      className={`w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--gold-transparent)] transition cursor-pointer ${
                        !selectedChapter ? "bg-[var(--gold-transparent)] border-l-2 border-[var(--gold-primary)]" : ""
                      }`}
                    >
                      <span className="text-[12px] text-[var(--text-primary)]">📄 使用全文</span>
                      <span className="text-[10px] text-[var(--text-muted)] ml-auto">{(activeScript.content?.replace(/\s/g, "").length || 0).toLocaleString()}字</span>
                    </button>
                    {/* 章节列表 */}
                    {parsedChapters.map((ch) => (
                      <button
                        key={ch.id}
                        onClick={() => {
                          setSelectedChapter({ title: ch.fullTitle, content: ch.content });
                          localStorage.setItem("feicai-pipeline-script-chapter", JSON.stringify({ title: ch.fullTitle, content: ch.content }));
                          setChapterDropdownOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-[var(--gold-transparent)] transition cursor-pointer ${
                          selectedChapter?.title === ch.fullTitle ? "bg-[var(--gold-transparent)] border-l-2 border-[var(--gold-primary)]" : ""
                        }`}
                      >
                        <span className="text-[12px] text-[var(--text-primary)] truncate flex-1">📖 {ch.fullTitle}</span>
                        <span className="text-[10px] text-[var(--text-muted)] shrink-0">{ch.wordCount.toLocaleString()}字</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className={`flex items-center gap-3 ${running ? "relative z-50" : ""}`}>
            {/* ═══ 智能分镜模式 — 右上角按钮组 ═══ */}
            {activeTab === "smartStoryboard" && (
              <div className="flex items-center gap-2">
                {/* 上传分镜/剧本（紧凑按钮） */}
                {userStoryboardText ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 border border-[var(--border-default)] bg-[var(--bg-surface)]">
                    <FileText size={13} className="text-[var(--gold-primary)]" />
                    <span className="text-[12px] text-[var(--text-secondary)] truncate max-w-[160px]">{userStoryboardFileName}</span>
                    <span className="text-[10px] text-[var(--text-muted)]">({userStoryboardText.length.toLocaleString()}字)</span>
                    <button
                      onClick={() => { setUserStoryboardText(""); setUserStoryboardFileName(""); }}
                      disabled={analyzing}
                      className="ml-1 flex items-center text-red-400 hover:text-red-300 transition cursor-pointer bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                      title="清除已上传文件"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => userStoryboardInputRef.current?.click()}
                    disabled={analyzing}
                    className="flex items-center gap-2 px-4 py-2.5 border border-[var(--gold-primary)]/60 hover:border-[var(--gold-primary)] transition cursor-pointer bg-[var(--gold-transparent)] text-[var(--text-primary)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="上传分镜/剧本文件 (.txt)，AI 将按照你的指示还原关键帧"
                  >
                    <Upload size={16} className="text-[var(--gold-primary)]" />
                    <span className="text-[13px] font-medium">上传分镜/剧本</span>
                    <span className="text-[11px] text-[var(--text-secondary)]">可选，智能体将严格锁定集数和分镜</span>
                  </button>
                )}
                {/* AI 智能分析按钮 */}
                <button
                  onClick={handleSmartAnalyze}
                  disabled={analyzing || (!activeScript && !userStoryboardText) || running || hasPipelineContent}
                  title={running ? "节拍拆解流水线执行中，无法同时进行智能分析" : hasPipelineContent ? "节拍拆解流水线已有内容，请先清除后再使用智能分镜" : undefined}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[var(--gold-primary)] hover:brightness-110 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {analyzing ? <Loader size={16} className="text-[#0A0A0A] animate-spin" /> : <Sparkles size={16} className="text-[#0A0A0A]" />}
                  <span className="text-[13px] font-medium text-[#0A0A0A]">
                    {analyzing ? "AI 分析中..." : userStoryboardText ? "✦ AI 还原分析" : "✦ AI 智能分析"}
                  </span>
                </button>
              </div>
            )}
            {activeTab === "pipeline" && (
              <>
                {running ? (
                  <button
                    onClick={stopPipeline}
                    className="flex items-center gap-2 bg-red-600 px-5 py-2.5 hover:bg-red-700 transition cursor-pointer shadow-[0_0_20px_rgba(239,68,68,0.4)] animate-pulse"
                  >
                    <Square size={16} className="text-white" />
                    <span className="text-[13px] font-medium text-white">停止执行</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    {/* ★ 断点续传按钮 — 流水线出错后显示 */}
                    {canResume && (
                      <button
                        onClick={resumePipeline}
                        disabled={analyzing || !!analysisResult}
                        className="flex items-center gap-2 bg-amber-600 px-5 py-2.5 hover:bg-amber-500 transition cursor-pointer shadow-[0_0_16px_rgba(217,119,6,0.3)] disabled:opacity-40 disabled:cursor-not-allowed"
                        title="从上次中断处继续执行，已完成的阶段/集数将自动跳过"
                      >
                        <RefreshCw size={16} className="text-white" />
                        <span className="text-[13px] font-medium text-white">继续执行</span>
                      </button>
                    )}
                    <button
                      onClick={handleRunPipeline}
                      disabled={analyzing || !!analysisResult}
                      title={
                        analyzing
                          ? "智能分镜 AI 分析进行中，请等待完成或取消分析"
                          : analysisResult
                          ? "存在未确认的智能分镜分析结果 — 请先到「智能分镜」标签确认方案或点击「重新分析」清除"
                          : undefined
                      }
                      className="flex items-center gap-2 bg-[var(--gold-primary)] px-5 py-2.5 hover:brightness-110 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
                    >
                      {(analyzing || analysisResult) ? <Lock size={16} className="text-[#0A0A0A]" /> : <Play size={16} className="text-[#0A0A0A]" />}
                      <span className="text-[13px] font-medium text-[#0A0A0A]">
                        {canResume ? "重新执行" : "一键执行全流程"}
                      </span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ═══ 标签栏（分析中/执行中/有分析结果时锁定切换） ═══ */}
        <div className="flex items-center gap-6 border-b border-[var(--border-default)]">
          <button
            onClick={() => { if (!analyzing && !running && !analysisResult) setActiveTab("pipeline"); }}
            disabled={analyzing || running || !!analysisResult}
            title={
              analyzing ? "智能分镜 AI 分析中，标签切换已锁定"
                : running ? "流水线执行中，标签切换已锁定"
                : analysisResult ? "存在未确认的智能分镜分析结果 — 请先到「智能分镜」标签确认方案，或点击左上角「重新开始创作」按钮清除数据后再切换模式"
                : undefined
            }
            className={`flex items-center gap-2 pb-3 text-[14px] font-medium transition border-b-2 -mb-[1px] bg-transparent ${
              analyzing || running || !!analysisResult
                ? "opacity-40 cursor-not-allowed"
                : "cursor-pointer"
            } ${
              activeTab === "pipeline"
                ? "text-[var(--gold-primary)] border-[var(--gold-primary)]"
                : "text-[var(--text-muted)] border-transparent hover:text-[var(--text-secondary)]"
            }`}
          >
            <Play size={14} />
            节拍拆解流水线
            {(analyzing || !!analysisResult) && activeTab !== "pipeline" && <Lock size={10} className="ml-1 text-[var(--text-muted)]" />}
          </button>
          <button
            onClick={() => { if (!analyzing && !running && !hasPipelineContent) setActiveTab("smartStoryboard"); }}
            disabled={analyzing || running || hasPipelineContent}
            title={
              analyzing ? "智能分镜 AI 分析中，标签切换已锁定"
                : running ? "流水线执行中，标签切换已锁定"
                : hasPipelineContent ? "节拍拆解流水线已有内容 — 请点击左上角「重新开始创作」按钮清除数据后再切换模式"
                : undefined
            }
            className={`flex items-center gap-2 pb-3 text-[14px] font-medium transition border-b-2 -mb-[1px] bg-transparent ${
              analyzing || running || hasPipelineContent
                ? "opacity-40 cursor-not-allowed"
                : "cursor-pointer"
            } ${
              activeTab === "smartStoryboard"
                ? "text-[var(--gold-primary)] border-[var(--gold-primary)]"
                : "text-[var(--text-muted)] border-transparent hover:text-[var(--text-secondary)]"
            }`}
          >
            <Brain size={14} />
            智能分镜
            {(running || hasPipelineContent) && activeTab !== "smartStoryboard" && <Lock size={10} className="ml-1 text-[var(--text-muted)]" />}
          </button>
          <button
            disabled
            className="flex items-center gap-2 pb-3 text-[14px] font-medium transition border-b-2 -mb-[1px] bg-transparent cursor-not-allowed opacity-40 text-[var(--text-muted)] border-transparent"
            title="智能体分镜模式正在开发中，敬请期待"
          >
            <Bot size={14} />
            智能体分镜模式（等待开发）
            <Lock size={10} className="ml-0.5 text-[var(--text-muted)]" />
          </button>
        </div>

        {/* ═══ 操作流程说明 ═══ */}
        <div className="p-4 border border-[var(--border-default)] bg-[#0D0D0D]">
          {activeTab === "pipeline" ? (
            /* ── 节拍拆解模式流程 ── */
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 mb-1">
                <Clapperboard size={16} className="text-[var(--gold-primary)]" />
                <span className="text-[14px] font-medium text-[var(--text-primary)]">节拍拆解流水线 — 操作流程</span>
                <span className="text-[12px] text-[var(--text-secondary)] ml-2">全自动一键完成，适合长篇小说快速出分镜</span>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {[
                  { icon: <BookOpen size={15} />, label: "导入剧本", desc: "剧本管理中上传" },
                  { icon: <FileText size={15} />, label: "选择章节", desc: "选择要拆解的章节" },
                  { icon: <Palette size={15} />, label: "前置设定", desc: "风格 / 画幅 / 分辨率" },
                  { icon: <Sparkles size={15} />, label: "节拍拆解", desc: "AI 自动拆分集数+节拍" },
                  { icon: <Grid3X3 size={15} />, label: "九宫格生图", desc: "每集 9 格分镜提示词" },
                  { icon: <Grid2X2 size={15} />, label: "四宫格展开", desc: "每格展开 4 连续镜头" },
                  { icon: <ImageIcon size={15} />, label: "生图工作台", desc: "AI 生成分镜图" },
                  { icon: <Video size={15} />, label: "图生视频", desc: "分镜图 → Seedance 视频" },
                ].map((step, i, arr) => (
                  <div key={i} className="flex items-center gap-1">
                    <div className="flex items-center gap-2 px-3 py-2 bg-[#141414] border border-[var(--border-default)] hover:border-[var(--gold-primary)]/40 transition group">
                      <span className="text-[var(--gold-primary)] group-hover:scale-110 transition-transform">{step.icon}</span>
                      <div className="flex flex-col">
                        <span className="text-[13px] font-medium text-[var(--text-primary)] leading-tight">{step.label}</span>
                        <span className="text-[11px] text-[var(--text-secondary)] leading-tight">{step.desc}</span>
                      </div>
                    </div>
                    {i < arr.length - 1 && <ChevronRight size={14} className="text-[var(--gold-primary)]/60 shrink-0 mx-0.5" />}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* ── 智能分镜模式流程 ── */
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 mb-1">
                <Brain size={16} className="text-[var(--gold-primary)]" />
                <span className="text-[14px] font-medium text-[var(--text-primary)]">智能分镜 — 操作流程</span>
                <span className="text-[12px] text-[var(--text-secondary)] ml-2">AI 出方案你来微调，精细控制每格画面</span>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {[
                  { icon: <BookOpen size={15} />, label: "导入剧本", desc: "剧本管理中上传" },
                  { icon: <FileText size={15} />, label: "选择章节", desc: "选择要分析的章节" },
                  { icon: <Palette size={15} />, label: "前置设定", desc: "风格 / 画幅 / 分辨率" },
                  { icon: <ScanEye size={15} />, label: "AI 分析", desc: "智能拆解画面方案" },
                  { icon: <Pencil size={15} />, label: "逐格编辑", desc: "调整景别/角度/台词" },
                  { icon: <Languages size={15} />, label: "确认翻译", desc: "中→英提示词翻译" },
                  { icon: <Wand2 size={15} />, label: "生成九宫格", desc: "跳转生图工作台" },
                  { icon: <ImageIcon size={15} />, label: "AI 生图", desc: "生成分镜画面" },
                  { icon: <Video size={15} />, label: "图生视频", desc: "分镜图 → Seedance 视频" },
                ].map((step, i, arr) => (
                  <div key={i} className="flex items-center gap-1">
                    <div className="flex items-center gap-2 px-3 py-2 bg-[#141414] border border-[var(--border-default)] hover:border-[var(--gold-primary)]/40 transition group">
                      <span className="text-[var(--gold-primary)] group-hover:scale-110 transition-transform">{step.icon}</span>
                      <div className="flex flex-col">
                        <span className="text-[13px] font-medium text-[var(--text-primary)] leading-tight">{step.label}</span>
                        <span className="text-[11px] text-[var(--text-secondary)] leading-tight">{step.desc}</span>
                      </div>
                    </div>
                    {i < arr.length - 1 && <ChevronRight size={14} className="text-[var(--gold-primary)]/60 shrink-0 mx-0.5" />}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/*  Pre-requisite: Style Config  */}
        <div className="flex flex-col gap-4 p-5 border border-[var(--border-default)] bg-[var(--bg-surface)]">
          <div className="flex items-center gap-2 mb-1">
            <Palette size={16} className="text-[var(--gold-primary)]" />
            <span className="font-serif text-[18px] font-medium text-[var(--text-primary)]">前置设定</span>
            <span className="text-[12px] text-[var(--text-muted)] ml-2">执行前请确认风格 / 画幅 / 分辨率</span>
            <span className="text-[11px] text-[var(--gold-primary)] opacity-80 ml-2">⚠ LLM模型需要具有图像识别能力（Gemini、Claude等）</span>
            <div className="flex-1" />
            <button
              onClick={handleSyncToStudio}
              disabled={syncingStyle}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium border border-[var(--gold-primary)] text-[var(--gold-primary)] bg-[var(--gold-transparent)] hover:brightness-110 transition cursor-pointer rounded disabled:opacity-60 disabled:cursor-not-allowed"
              title="点击将前置设定（画幅/画质）同步到生图工作台"
            >
              {syncingStyle ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {syncingStyle ? "同步中..." : "同步到生图"}
            </button>
          </div>

          <div className="grid grid-cols-[220px_1fr] gap-5">
            {/* Left: Style image */}
            <div className="flex flex-col items-center gap-3">
              {consistency.style.styleImage ? (
                <>
                  <div className="relative w-full aspect-[4/3] border border-[var(--border-default)] overflow-hidden group">
                    <img src={consistency.style.styleImage} alt="风格参考" className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    <div
                      className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition cursor-pointer"
                      onClick={handleStyleUpload}
                    >
                      <span className="text-[12px] text-white">更换风格图</span>
                    </div>
                  </div>
                  <button
                    onClick={handleDeleteStyleImage}
                    className="flex items-center justify-center gap-1.5 w-full py-1.5 text-[11px] text-red-400 border border-[var(--border-default)] hover:border-red-400 hover:bg-red-400/10 transition cursor-pointer bg-transparent"
                  >
                    <Trash2 size={12} />
                    删除风格参考图
                  </button>
                </>
              ) : (
                <button
                  onClick={handleStyleUpload}
                  disabled={analyzingStyle}
                  className="flex flex-col items-center justify-center gap-2 w-full aspect-[4/3] border border-dashed border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer bg-transparent"
                >
                  <Upload size={20} className="text-[var(--text-muted)]" />
                  <span className="text-[12px] text-[var(--text-muted)]">上传风格参考图</span>
                </button>
              )}
              {analyzingStyle && (
                <span className="flex items-center gap-1.5 text-[11px] text-[var(--gold-primary)]">
                  <Loader size={12} className="animate-spin" /> AI 识别中
                </span>
              )}
              {/* ★ 风格参考图注意事项 — 醒目警告 */}
              <div className="flex items-start gap-1.5 mt-1 px-1">
                <AlertTriangle size={13} className="text-red-500 shrink-0 mt-[1px]" />
                <span className="text-[11px] text-red-400 font-medium leading-tight">
                  风景参考图不要出现人物正脸，否则破坏一致性！！
                </span>
              </div>
            </div>

            {/* Right: selectors + recognized style */}
            <div className="flex flex-col gap-4">
              {/* Row 1: Aspect ratio + Resolution + Target media */}
              <div className="flex gap-6 flex-wrap">
                {/* Aspect Ratio */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">画面比例</span>
                  <div className="flex gap-1.5">
                    {(["16:9", "9:16"] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => updateConsistency((prev) => ({ ...prev, style: { ...prev.style, aspectRatio: r } }))}
                        className={`px-3 py-1.5 text-[12px] border transition cursor-pointer ${
                          consistency.style.aspectRatio === r
                            ? "border-[var(--gold-primary)] text-[var(--gold-primary)] bg-[var(--gold-transparent)]"
                            : "border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Resolution */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">分辨率</span>
                  <div className="flex gap-1.5">
                    {(["1K", "2K", "4K"] as const).map((q) => {
                      return (
                        <button
                          key={q}
                          onClick={() => updateConsistency((prev) => ({ ...prev, style: { ...prev.style, resolution: q } }))}
                          className={`px-3 py-1.5 text-[12px] border transition cursor-pointer ${
                            consistency.style.resolution === q
                              ? "border-[var(--gold-primary)] text-[var(--gold-primary)] bg-[var(--gold-transparent)]"
                              : "border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
                          }`}
                        >
                          {q}
                        </button>
                      );
                    })}
                  </div>
                </div>


              </div>

              {/* Row 2: Style prompt */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">风格设定</span>
                </div>
                <textarea
                  value={localStylePrompt}
                  onChange={(e) => handleStylePromptChange(e.target.value)}
                  rows={4}
                  className="px-3 py-2 bg-[#0A0A0A] border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] outline-none focus:border-[var(--gold-primary)] transition resize-y leading-relaxed"
                  placeholder="手动输入风格描述，或上传参考图由 AI 自动识别填充..."
                />
                <span className="text-[10px] text-[var(--text-muted)]">可手动输入风格描述；上传参考图后 AI 识别会自动覆盖此内容</span>
              </div>
            </div>
          </div>

          {/* ── 模型使用建议 ── */}
          <div className="flex items-start gap-3 px-4 py-3 bg-[#0D0D0D] border border-[var(--border-default)]">
            <Info size={15} className="text-[var(--gold-primary)] shrink-0 mt-0.5" />
            {activeTab === "pipeline" ? (
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-[var(--text-primary)]">模型建议 — 节拍拆解流水线</span>
                <span className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                  节拍拆解需要提交完整章节长文本（数千~数万字），AI 需要深度理解叙事结构并拆分节拍。
                  请选择 <span className="text-[var(--gold-primary)] font-medium">上下文窗口大、推理能力强</span> 的模型：
                </span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {[
                    { name: "Gemini 2.5 Pro", tag: "推荐", tip: "100万 tokens，推理能力极强" },
                    { name: "DeepSeek R1", tag: "推荐", tip: "深度推理，中文理解出色" },
                    { name: "Claude Sonnet 4", tag: "可选", tip: "20万 tokens，结构化输出精准" },
                    { name: "GPT-4o", tag: "可选", tip: "12.8万 tokens，综合能力均衡" },
                    { name: "Gemini 2.5 Flash", tag: "快速", tip: "100万 tokens，速度快成本低" },
                  ].map((m) => (
                    <span key={m.name} title={m.tip} className="inline-flex items-center gap-1 px-2 py-1 text-[11px] border border-[var(--border-default)] bg-[#141414] hover:border-[var(--gold-primary)]/40 transition cursor-default">
                      <span className="text-[var(--text-primary)]">{m.name}</span>
                      <span className={`text-[9px] px-1 py-0.5 leading-none ${m.tag === "推荐" ? "bg-[var(--gold-primary)]/20 text-[var(--gold-primary)]" : "bg-white/5 text-[var(--text-muted)]"}`}>{m.tag}</span>
                    </span>
                  ))}
                </div>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5">⚠️ 避免使用小参数模型（如 GPT-4o mini、Gemini Flash 8B），长文本易丢失细节或生成质量不佳</span>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-[var(--text-primary)]">模型建议 — 智能分镜</span>
                <span className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                  智能分镜输入文本较短，但需要 AI 精确输出影视化描述（景别、机位、光影、台词）。
                  请选择 <span className="text-[var(--gold-primary)] font-medium">结构化输出精准、视觉描述能力强</span> 的模型：
                </span>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {[
                    { name: "Claude Sonnet 4", tag: "推荐", tip: "结构化输出最稳定，镜头语言精准" },
                    { name: "Gemini 2.5 Pro", tag: "推荐", tip: "多模态理解强，画面描述细腻" },
                    { name: "DeepSeek R1", tag: "可选", tip: "推理能力强，中文影视描述出色" },
                    { name: "GPT-4o", tag: "可选", tip: "综合能力均衡，指令遵循度高" },
                    { name: "Gemini 2.5 Flash", tag: "快速", tip: "速度快可作为快速预览" },
                  ].map((m) => (
                    <span key={m.name} title={m.tip} className="inline-flex items-center gap-1 px-2 py-1 text-[11px] border border-[var(--border-default)] bg-[#141414] hover:border-[var(--gold-primary)]/40 transition cursor-default">
                      <span className="text-[var(--text-primary)]">{m.name}</span>
                      <span className={`text-[9px] px-1 py-0.5 leading-none ${m.tag === "推荐" ? "bg-[var(--gold-primary)]/20 text-[var(--gold-primary)]" : "bg-white/5 text-[var(--text-muted)]"}`}>{m.tag}</span>
                    </span>
                  ))}
                </div>
                <span className="text-[11px] text-[var(--text-muted)] mt-0.5">💡 智能分镜对模型要求不如节拍拆解严格，中等模型即可胜任，优先保证结构化输出稳定性</span>
              </div>
            )}
          </div>
        </div>

        {/* ═══ 场景B防护：A路径锁定提示（存在未确认的智能分镜分析结果） ═══ */}
        {activeTab === "pipeline" && !running && (analyzing || analysisResult) && (
          <div className="flex items-center gap-3 px-4 py-3 border border-amber-500/40 bg-amber-500/5">
            <ShieldAlert size={18} className="text-amber-400 shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium text-amber-300">
                {analyzing ? "智能分镜 AI 分析中 — A 路径已锁定" : "存在未确认的智能分镜分析结果 — A 路径已锁定"}
              </span>
              <span className="text-[11px] text-[var(--text-muted)]">
                {analyzing
                  ? "请等待分析完成或到「智能分镜」标签取消分析。分析完成后请先确认或清除结果，再执行节拍拆解流水线。"
                  : "请切换到「智能分镜」标签，点击「确认方案 → 开始生成」保存结果，或点击「重新分析」清除。清除后即可使用节拍拆解流水线。"
                }
              </span>
            </div>
          </div>
        )}

        {/* ═══ 节拍拆解流水线内容 ═══ */}
        {activeTab === "pipeline" && (
          <>
        {/* 模式说明 */}
        <ModeGuide mode="pipeline" />
        {/* Pipeline Stages */}
        <div className="flex gap-4 w-full">
          {stages.map((s) => {
            const isDone = s.status === "done";
            const isActive = s.status === "active";
            const isLocked = s.status === "locked";
            const btnEnabled = isDone;
            return (
              <div
                key={s.num}
                className={`flex flex-col gap-4 flex-1 p-5 border ${
                  isActive
                    ? "border-2 border-[var(--gold-primary)] bg-[var(--bg-surface)]"
                    : isDone
                    ? "border-[var(--gold-primary)]"
                    : "border-[var(--border-default)]"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div
                    className={`flex items-center justify-center w-7 h-7 text-[13px] font-semibold ${
                      isLocked
                        ? "border border-[var(--border-default)] text-[var(--text-secondary)]"
                        : "bg-[var(--gold-primary)] text-[#0A0A0A]"
                    }`}
                  >
                    {s.num}
                  </div>
                  <StatusIcon status={s.status} />
                </div>

                <span
                  className={`font-serif text-[20px] font-medium ${
                    isLocked ? "text-[var(--text-secondary)]" : "text-[var(--text-primary)]"
                  }`}
                >
                  {s.title}
                </span>

                <span
                  className={`text-[12px] leading-relaxed ${
                    isLocked ? "text-[var(--text-muted)]" : "text-[var(--text-tertiary)]"
                  }`}
                >
                  {s.desc}
                </span>

                <span
                  className={`inline-block w-fit px-2.5 py-1 text-[11px] font-medium border ${
                    isLocked
                      ? "text-[var(--text-muted)] border-[var(--border-default)]"
                      : isDone
                      ? "text-[var(--gold-primary)] bg-[var(--gold-transparent)]"
                      : isActive
                      ? "text-[var(--gold-primary)] border-[var(--gold-primary)]"
                      : "text-[var(--text-secondary)] border-[var(--border-default)]"
                  }`}
                >
                  {s.badgeText}
                </span>

                <button
                  onClick={() => {
                    if (btnEnabled) {
                      const target = s.num === 1 ? "/outputs" : "/studio";
                      if (running) {
                        window.open(target, "_blank");
                      } else {
                        router.push(target);
                      }
                    }
                  }}
                  className={`flex items-center justify-center gap-2 w-full py-2.5 px-3.5 text-[12px] font-medium border transition ${
                    btnEnabled
                      ? "border-[var(--gold-primary)] text-[var(--gold-primary)] bg-[#1a1a0a] hover:bg-[var(--gold-transparent)] cursor-pointer"
                      : "opacity-50 border-[var(--border-default)] text-[var(--text-muted)] bg-[#0F0F0F] cursor-not-allowed"
                  }`}
                  disabled={!btnEnabled}
                >
                  <BtnIcon icon={btnEnabled ? s.btnIcon : "lock"} />
                  {s.btnText}
                </button>
              </div>
            );
          })}
        </div>

        {/* Execution Log */}
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          <div className="flex items-center justify-between w-full">
            <h2 className="font-serif text-[24px] font-medium text-[var(--text-primary)]">
              执行日志
            </h2>
            <div className="flex items-center gap-2">
              {running ? (
                <>
                  <Loader size={14} className="text-[var(--gold-primary)] animate-spin" />
                  <span className="text-[13px] font-normal text-[var(--gold-primary)]">
                    执行中...
                  </span>
                </>
              ) : allDone && logs.length > 0 ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-[#4ade80]" />
                  <span className="text-[13px] font-normal text-[#4ade80]">
                    全部阶段已完成 
                  </span>
                </>
              ) : (
                <span className="text-[13px] font-normal text-[var(--text-muted)]">
                  就绪
                </span>
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-1.5 p-5 bg-[var(--bg-surface)] border border-[var(--border-default)] overflow-auto min-h-[180px]">
            {logs.length === 0 && (
              <span className="text-[13px] text-[var(--text-muted)]">
                点击「一键执行全流程」开始。请确保已在设置页配置 API Key，并选择要创作的剧本。
              </span>
            )}
            {logs.map((l, i) => {
              const isDetail = l.msg.startsWith("    ");
              return (
                <div key={i} className={`flex items-start gap-3 ${isDetail ? "ml-6" : ""}`}>
                  <span className={`font-mono shrink-0 ${isDetail ? "text-[10px] text-[var(--text-muted)]/50" : "text-[12px] text-[var(--text-muted)]"}`}>
                    {l.time}
                  </span>
                  <span
                    className={`font-normal whitespace-pre-wrap ${
                      isDetail
                        ? "text-[11px] font-mono text-[var(--text-muted)]"
                        : l.gold
                        ? "text-[13px] text-[var(--gold-primary)]"
                        : "text-[13px] text-[var(--text-secondary)]"
                    }`}
                  >
                    {l.msg}
                  </span>
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>
        </div>
          </>
        )}

        {/* ═══ 智能分镜内容 ═══ */}
        {activeTab === "smartStoryboard" && (
          <>
            {/* 模式说明 */}
            <ModeGuide mode="smart" />

            {/* ═══ A路径执行中或已有内容，B路径锁定提示 ═══ */}
            {(running || hasPipelineContent) && (
              <div className="flex items-center gap-3 px-4 py-3 border border-amber-500/40 bg-amber-500/5">
                <ShieldAlert size={18} className="text-amber-400 shrink-0" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-medium text-amber-300">
                    {running ? "节拍拆解流水线执行中" : "节拍拆解流水线已有内容"} — 智能分镜已锁定
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {running
                      ? "请等待节拍拆解流水线执行完成，或到「节拍拆解流水线」标签停止执行后，再使用智能分镜。"
                      : "请先到「节拍拆解流水线」标签清除已有内容（点击「直接清除」），再使用智能分镜。"
                    }
                  </span>
                </div>
              </div>
            )}

            {/* ═══ 隐藏文件输入 + 上传预览（还原模式） ═══ */}
            <input
              ref={userStoryboardInputRef}
              type="file"
              accept=".txt"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (!file.name.toLowerCase().endsWith(".txt")) {
                  toast("仅支持 TXT 文件格式", "error");
                  e.target.value = "";
                  return;
                }
                try {
                  const text = await readFileWithEncoding(file);
                  if (!text || text.trim().length < 10) {
                    toast("文件内容为空或过短", "error");
                    e.target.value = "";
                    return;
                  }
                  setUserStoryboardText(text.trim());
                  setUserStoryboardFileName(file.name);
                  toast(`✓ 已加载 ${file.name} (${text.length.toLocaleString()}字)`, "success");
                } catch (err) {
                  toast("文件读取失败: " + (err instanceof Error ? err.message : "未知错误"), "error");
                }
                e.target.value = "";
              }}
            />
            {/* 上传后的内容预览 */}
            {userStoryboardText && (
              <div className="flex flex-col gap-2 p-4 border border-[var(--border-default)] bg-[var(--bg-surface)]">
                <div className="flex items-start gap-1.5">
                  <Info size={12} className="text-[var(--gold-primary)] shrink-0 mt-[1px]" />
                  <span className="text-[11px] text-[var(--text-muted)] leading-tight">
                    已切换为 <span className="text-[var(--gold-primary)] font-medium">还原模式</span> — AI 将按照你的分镜指示还原关键帧，补充完整镜头语言描述。
                    {(selectedChapter || activeScript) && " 当前选中的剧本/章节将作为原著参考。"}
                  </span>
                </div>
                <div className="p-3 bg-[#0F0F0F] border border-[var(--border-default)] text-[11px] text-[var(--text-muted)] leading-relaxed max-h-[120px] overflow-auto whitespace-pre-wrap">
                  {userStoryboardText.slice(0, 500)}{userStoryboardText.length > 500 ? "..." : ""}
                </div>
              </div>
            )}

            {/* 分析错误 */}
            {analysisError && (
              <div className="p-4 border border-red-500/30 bg-red-500/10 text-[13px] text-red-400">
                分析失败：{analysisError}
              </div>
            )}

            {/* 分析结果 */}
            {analysisResult && (
              <div ref={analysisResultRef} className="flex flex-col gap-5 relative">
                {/* 汇总栏 */}
                <div className="relative">
                  <div className="flex items-center gap-3 px-4 py-3 border border-[var(--border-default)] bg-[var(--bg-surface)]">
                    <Check size={16} className="text-[var(--gold-primary)]" />
                    <span className="text-[13px] text-[var(--text-primary)]">
                      分析完成 · 建议{" "}
                      <span className="text-[var(--gold-primary)] font-medium">{analysisResult.plan.length}</span> 集 · 共{" "}
                      <span className="text-[var(--gold-primary)] font-medium">{analysisResult.totalNineGrids}</span> 个九宫格
                    </span>
                  </div>

                  {/* ★ 分析完成引导弹窗 — 向下箭头 + 提示 */}
                  {showAnalysisGuide && (
                    <div ref={analysisGuideRef} className="absolute left-1/2 -translate-x-1/2 top-full mt-0 z-50 flex flex-col items-center animate-in fade-in slide-in-from-top-2 duration-300">
                      {/* 朝上的三角箭头 */}
                      <div className="w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-b-[10px] border-b-[var(--gold-primary)]" />
                      {/* 弹窗主体 */}
                      <div className="flex flex-col gap-3 px-5 py-4 bg-[#1A1200] border border-[var(--gold-primary)] shadow-[0_0_24px_rgba(201,169,98,0.2)] max-w-[360px] w-[340px]">
                        <div className="flex items-start gap-3">
                          <ChevronsDown size={20} className="text-[var(--gold-primary)] shrink-0 mt-0.5 animate-bounce" />
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[14px] font-medium text-[var(--gold-primary)]">AI 分析完成！</span>
                            <span className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                              请向下滚动查看每集的分镜方案，包含场景分配和节拍内容。<br/>
                              确认无误后，点击底部 <span className="text-[var(--gold-primary)] font-medium">「确认方案 → 翻译并生成」</span> 按钮进入下一步。
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            onClick={() => setShowAnalysisGuide(false)}
                            className="px-4 py-1.5 text-[12px] font-medium text-[#0A0A0A] bg-[var(--gold-primary)] hover:brightness-110 transition cursor-pointer"
                          >
                            知道了
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* AI 推理过程 */}
                {analysisResult.reasoning && (
                  <div className="p-4 border border-[var(--border-default)] bg-[#0F0F0F] text-[12px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-auto">
                    {analysisResult.reasoning}
                  </div>
                )}

                {/* 方案卡片 */}
                <div className="flex flex-col gap-4">
                  {analysisResult.plan.map((ep, idx) => (
                    <div key={ep.episodeId} className="flex flex-col gap-4 p-5 border border-[var(--border-default)] bg-[#141414]">
                      {/* 卡片头 */}
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 flex items-center justify-center bg-[var(--gold-primary)] text-[#0A0A0A] text-[13px] font-bold rounded-full shrink-0">
                          {idx + 1}
                        </div>
                        <span className="font-serif text-[18px] font-medium text-[var(--text-primary)]">
                          {ep.episodeId.toUpperCase()} · {ep.title}
                        </span>
                        <span className="ml-auto px-2.5 py-1 text-[11px] text-[var(--gold-primary)] bg-[var(--gold-transparent)] border border-[var(--gold-primary)]/30">
                          {ep.beats.length}格
                        </span>
                      </div>

                      {/* 描述 */}
                      {ep.description && (
                        <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">{ep.description}</p>
                      )}

                      {/* 节拍网格 3×3 */}
                      <div className="grid grid-cols-3 gap-2.5">
                        {ep.beats.map((beat, bi) => {
                          const isEditing = editingCell?.epIdx === idx && editingCell?.beatIdx === bi;
                          return (
                            <div
                              key={bi}
                              className={`group relative flex flex-col gap-1.5 p-3 bg-[#0F0F0F] border rounded-[4px] ${
                                isEditing ? "border-[var(--gold-primary)]" : "border-[var(--border-default)]"
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-medium text-[var(--gold-primary)]">格{bi + 1}</span>
                                {!isEditing && (
                                  <button
                                    type="button"
                                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-[var(--text-muted)] hover:text-[var(--gold-primary)] cursor-pointer"
                                    title="编辑分镜内容"
                                    onClick={() => { setEditingCell({ epIdx: idx, beatIdx: bi }); setEditText(beat); }}
                                  >
                                    <Pencil size={11} />
                                  </button>
                                )}
                              </div>
                              {isEditing ? (
                                <div className="flex flex-col gap-1.5">
                                  <textarea
                                    className="w-full min-h-[60px] p-1.5 text-[11px] bg-[#0A0A0A] border border-[var(--gold-primary)]/40 text-[var(--text-primary)] leading-relaxed rounded resize-y outline-none focus:border-[var(--gold-primary)]"
                                    value={editText}
                                    onChange={(e) => setEditText(e.target.value)}
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && e.ctrlKey) handleSaveCellEdit();
                                      if (e.key === "Escape") { setEditingCell(null); setEditText(""); }
                                    }}
                                  />
                                  <div className="flex items-center gap-1.5 justify-end">
                                    <button
                                      type="button"
                                      className="px-2 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-default)] rounded cursor-pointer"
                                      onClick={() => { setEditingCell(null); setEditText(""); }}
                                    >
                                      取消
                                    </button>
                                    <button
                                      type="button"
                                      className="px-2 py-0.5 text-[10px] text-[#0A0A0A] bg-[var(--gold-primary)] hover:brightness-110 rounded cursor-pointer"
                                      onClick={handleSaveCellEdit}
                                    >
                                      保存
                                    </button>
                                  </div>
                                  <span className="text-[9px] text-[var(--text-muted)]">Ctrl+Enter 保存 · Esc 取消</span>
                                </div>
                              ) : (
                                <span className="text-[11px] text-[var(--text-secondary)] leading-relaxed line-clamp-3">{beat}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* 场景标签 */}
                      {ep.scenes?.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] text-[var(--text-muted)]">🎬</span>
                          {ep.scenes.map((sc, si) => (
                            <span key={si} className="px-2 py-0.5 text-[11px] text-[var(--text-secondary)] bg-[#1A1200] border border-[var(--gold-primary)]/20">
                              {sc}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* 底部操作栏 */}
                <div className="flex items-center justify-between py-4 border-t border-[var(--border-default)]">
                  <span className="text-[12px] text-[var(--text-muted)]">
                    ✓ 分析完成 · 建议 {analysisResult.plan.length} 集 · 共 {analysisResult.totalNineGrids} 个九宫格
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => { setAnalysisResult(null); kvRemove("feicai-smart-analysis-result").catch(() => {}); }}
                      className="flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium text-[var(--text-secondary)] border border-[var(--border-default)] hover:border-[var(--text-muted)] transition cursor-pointer bg-transparent"
                    >
                      重新分析
                    </button>
                    <button
                      onClick={handleConfirmPlan}
                      disabled={confirming}
                      className="flex items-center gap-2 px-5 py-2.5 bg-[var(--gold-primary)] hover:brightness-110 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {confirming && <Loader size={16} className="text-[#0A0A0A] animate-spin" />}
                      <span className="text-[13px] font-medium text-[#0A0A0A]">{confirming ? (translateProgress || "保存中...") : "确认方案 → 翻译并生成"}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══ 自定义分镜内容 ═══ */}
        {activeTab === "agentStoryboard" && (
          <>
            {/* 模式说明 */}
            <div className="p-4 border border-[var(--border-default)] bg-[#0D0D0D]">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 mb-1">
                  <Bot size={16} className="text-[var(--gold-primary)]" />
                  <span className="text-[14px] font-medium text-[var(--text-primary)]">自定义分镜 — AI Agent 驱动</span>
                  <span className="text-[12px] text-[var(--text-secondary)] ml-2">参考 Toonflow 编排架构，多智能体协作完成剧本→大纲→分镜</span>
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  {[
                    { icon: <BookOpen size={15} />, label: "导入剧本", desc: "选择已有剧本" },
                    { icon: <Brain size={15} />, label: "AI 解析", desc: "故事师分析结构" },
                    { icon: <FileText size={15} />, label: "大纲生成", desc: "大纲师规划分集" },
                    { icon: <Clapperboard size={15} />, label: "分镜拆解", desc: "导演拆解镜头" },
                    { icon: <Grid3X3 size={15} />, label: "自定义宫格", desc: "推送到生图工作台" },
                    { icon: <ImageIcon size={15} />, label: "AI 生图", desc: "自动生成分镜图" },
                  ].map((step, i, arr) => (
                    <div key={i} className="flex items-center gap-1">
                      <div className="flex items-center gap-2 px-3 py-2 bg-[#141414] border border-[var(--border-default)] hover:border-[var(--gold-primary)]/40 transition group">
                        <span className="text-[var(--gold-primary)] group-hover:scale-110 transition-transform">{step.icon}</span>
                        <div className="flex flex-col">
                          <span className="text-[13px] font-medium text-[var(--text-primary)] leading-tight">{step.label}</span>
                          <span className="text-[10px] text-[var(--text-muted)] leading-tight">{step.desc}</span>
                        </div>
                      </div>
                      {i < arr.length - 1 && <ChevronRight size={14} className="text-[var(--text-muted)] mx-0.5" />}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 智能体聊天区域 */}
            <AgentStoryboardPanel
              scriptContent={selectedChapter?.content || activeScript?.content || ""}
              scriptTitle={selectedChapter ? `${activeScript?.title || ""} · ${selectedChapter.title}` : (activeScript?.title || "")}
              hasScript={!!activeScript}
            />
          </>
        )}
      </main>
    </div>
  );
}
