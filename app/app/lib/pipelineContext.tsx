"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { useToast } from "../components/Toast";
import { useTaskQueue } from "./taskQueue";
import { loadPipelineStateAsync, savePipelineState, persistExtractResult } from "./consistency";
import { kvSet } from "./kvDB";

// ═══════════════════════════════════════════════════════════
// Global Pipeline Context — SSE 连接跨页面存活
// ═══════════════════════════════════════════════════════════

export interface StageState {
  num: number;
  title: string;
  desc: string;
  status: "done" | "active" | "locked" | "waiting";
  badgeText: string;
  btnText: string;
  btnIcon: "file-text" | "sparkles" | "lock";
}

export interface LogLine {
  time: string;
  msg: string;
  gold: boolean;
}

export const defaultStages: StageState[] = [
  {
    num: 1,
    title: "节拍拆解",
    desc: "从剧本识别叙事曲线，按时间公式拆解为多集节拍",
    status: "waiting",
    badgeText: "等待执行",
    btnText: "查看节拍拆解 →",
    btnIcon: "file-text",
  },
  {
    num: 2,
    title: "九宫格提示词",
    desc: "为每集生成9格关键帧提示词，覆盖完整叙事弧线",
    status: "locked",
    badgeText: "等待上游完成",
    btnText: "进入生图工作台 →",
    btnIcon: "sparkles",
  },
  {
    num: 3,
    title: "四宫格提示词",
    desc: "为每集的每个锚点展开4格连续动作",
    status: "locked",
    badgeText: "等待上游完成",
    btnText: "进入生图工作台 →",
    btnIcon: "sparkles",
  },
];

function timeStr() {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

export interface PipelineStartParams {
  script: string;
  scriptTitle: string;
  episode: string;
  settings: Record<string, string>;
  consistencyContext: string;
  referenceImages?: string[]; // base64 data URLs of reference images for multimodal LLM
  customPrompts: { nineGridGem?: string; fourGridGem?: string; beatBreakdown?: string };
}

interface PipelineContextType {
  stages: StageState[];
  setStages: React.Dispatch<React.SetStateAction<StageState[]>>;
  logs: LogLine[];
  running: boolean;
  imageUrl: string;
  episode: string;
  setEpisode: (ep: string) => void;
  startPipeline: (params: PipelineStartParams) => void;
  stopPipeline: () => void;
  resumePipeline: () => void;
  canResume: boolean;
  extractResult: Record<string, unknown> | null;
  clearExtractResult: () => void;
}

const PipelineContext = createContext<PipelineContextType>({
  stages: defaultStages,
  setStages: () => {},
  logs: [],
  running: false,
  imageUrl: "",
  episode: "ep01",
  setEpisode: () => {},
  startPipeline: () => {},
  stopPipeline: () => {},
  resumePipeline: () => {},
  canResume: false,
  extractResult: null,
  clearExtractResult: () => {},
});

export function usePipeline() {
  return useContext(PipelineContext);
}

export function PipelineProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const { addTask, removeTask } = useTaskQueue();

  const [stages, setStages] = useState<StageState[]>(defaultStages);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [episode, setEpisode] = useState("ep01");
  const [extractResult, setExtractResult] = useState<Record<string, unknown> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const restoredRef = useRef(false);
  const lastParamsRef = useRef<PipelineStartParams | null>(null);
  const [pipelineErrored, setPipelineErrored] = useState(false); // ★ 流水线是否因错误停止

  // ─── addLog helper (stable callback) ───
  const addLog = useCallback((msg: string, gold = false) => {
    setLogs((prev) => [...prev, { time: timeStr(), msg, gold }]);
  }, []);

  // ─── Restore persisted state on mount ───
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    (async () => {
      const saved = await loadPipelineStateAsync();
      if (saved && saved.logs && (saved.logs as LogLine[]).length > 0) {
        if (saved.stages) {
          setStages(
            (saved.stages as StageState[]).map((s) =>
              s.status === "active" ? { ...s, status: "done", badgeText: "✓ 已完成" } : s
            )
          );
        }
        setLogs(saved.logs as LogLine[]);
        if (saved.imageUrl) setImageUrl(saved.imageUrl);
        if (saved.episode) setEpisode(saved.episode);
        return;
      }

      // No saved state — check existing output files
      // ★ 如果刚执行了「直接清除」，跳过 outputs 文件恢复（outputs 文件永久保留，不应当影响新项目）
      const isNewProject = localStorage.getItem("feicai-new-project") === "1";
      if (isNewProject) return;

      fetch("/api/outputs")
        .then((r) => r.json())
        .then((files: { name: string }[]) => {
        const names = files.map((f) => f.name);
        const epSet = new Set<string>();
        for (const n of names) {
          const m = n.match(/-(ep\d+)/);
          if (m) epSet.add(m[1]);
        }
        const eps = Array.from(epSet).sort();
        const ep = eps[eps.length - 1] || "ep02";
        setEpisode(ep);

        const hasBB = names.some((n) => n.includes("beat-breakdown"));
        const hasNG = names.some((n) => n.includes(`beat-board-prompt-${ep}`));
        const hasFG = names.some((n) => n.includes(`sequence-board-prompt-${ep}`));
        if (hasBB || hasNG || hasFG) {
          setStages((prev) =>
            prev.map((s) => {
              if (s.num === 1 && hasBB) return { ...s, status: "done", badgeText: "✓ 已完成 · 导演审核通过" };
              if (s.num === 2 && hasNG) return { ...s, status: "done", badgeText: "✓ 已完成 · 导演审核通过" };
              if (s.num === 3 && hasFG) return { ...s, status: "done", badgeText: "✓ 已完成 · 导演审核通过" };
              return s;
            })
          );
        }
      })
      .catch(() => {});
    })();
  }, []);

  // ─── Persist state to localStorage ───
  useEffect(() => {
    if (logs.length === 0 && stages === defaultStages) return;
    savePipelineState({ stages, logs, imageUrl, episode, timestamp: Date.now() });
  }, [stages, logs, imageUrl, episode]);

  // ─── Start pipeline (SSE streaming) ───
  const startPipeline = useCallback(
    async (params: PipelineStartParams) => {
      lastParamsRef.current = params; // ★ 保存参数供断点续传使用
      setPipelineErrored(false);
      setRunning(true);
      setLogs([]);
      setImageUrl("");
      setEpisode(params.episode);
      setStages(defaultStages.map((s) => (s.num === 1 ? { ...s, status: "active", badgeText: "执行中..." } : s)));

      const logNow = (msg: string, gold = false) => {
        setLogs((prev) => [...prev, { time: timeStr(), msg, gold }]);
      };

      logNow(`[系统] 流水线启动 — 剧本「${params.scriptTitle}」(${params.script.length.toLocaleString()} 字)`);
      logNow(`[系统] 模型: ${params.settings["llm-model"] || "gemini-2.5-pro"} | 端点: ${params.settings["llm-url"] || "默认"}`);

      const taskId = `llm-pipeline-${params.episode}-${Date.now()}`;
      addTask({ id: taskId, type: "llm", label: `${params.episode.toUpperCase()} 流水线执行`, detail: "节拍拆解 → 九宫格 → 四宫格" });

      const abort = new AbortController();
      abortRef.current = abort;

      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const res = await fetch("/api/pipeline/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            script: params.script,
            episode: params.episode,
            settings: params.settings,
            consistencyContext: params.consistencyContext,
            referenceImages: params.referenceImages,
            customPrompts: params.customPrompts,
          }),
          signal: abort.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "未知错误" }));
          throw new Error(err.error || `HTTP ${res.status}`);
        }

        reader = res.body?.getReader();
        if (!reader) throw new Error("无法读取响应流");

        const decoder = new TextDecoder();
        let buffer = "";
        let streamFinished = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            // Process remaining data in buffer (Bug #20 fix)
            if (buffer.trim()) {
              let eventType2 = "";
              for (const line of buffer.split("\n")) {
                if (line.startsWith("event: ")) {
                  eventType2 = line.slice(7).trim();
                } else if (line.startsWith("data: ")) {
                  try {
                    const data = JSON.parse(line.slice(6).trim());
                    if (eventType2 === "complete") {
                      logNow(`[系统] ${data.message}`, true);
                      setStages((prev) => prev.map((s) => ({ ...s, status: "done", badgeText: "✓ 已完成" })));
                      toast("全流程执行完成！", "success");
                      // ★ 写入所有 EP 的 KV 标记（节拍拆解模式，供 Studio detectEpisodes 发现）
                      if (data.files && Array.isArray(data.files)) {
                        for (const f of data.files) {
                          const m2 = (f as string).match(/beat-board-prompt-(ep\d+)\.md/);
                          if (m2) kvSet(`feicai-beat-prompts-${m2[1]}`, "1").catch(() => {});
                        }
                      }
                    } else if (eventType2 === "actionable") {
                      logNow(data.message, true);
                      logNow("[制片人] 💡 EP01九宫格已就绪！请从左侧导航栏进入「生图工作台」开始制作，流水线将继续运行", true);
                      toast("EP01九宫格已就绪！请从左侧导航栏进入生图工作台", "success");
                      // ★ EP01 就绪时立即写入 KV 标记
                      if (data.readyEpisode) {
                        kvSet(`feicai-beat-prompts-${data.readyEpisode}`, "1").catch(() => {});
                      }
                    } else if (eventType2 === "extract-done") {
                      if (data.data) {
                        setExtractResult(data.data as Record<string, unknown>);
                        // ★ 直接持久化到 KV，不依赖 Studio 页面消费
                        persistExtractResult(data.data as Record<string, unknown>);
                      }
                    } else if (eventType2 === "progress") {
                      logNow(data.message, false);
                    }
                  } catch { /* skip */ }
                }
              }
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let eventType = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              const dataStr = line.slice(6).trim();
              try {
                const data = JSON.parse(dataStr);
                if (eventType === "progress") {
                  const isGold = data.message?.includes("导演") || data.message?.includes("PASS") || data.message?.includes("审核");
                  logNow(data.message, isGold);

                  // ★ 每集完成toast提醒 + 写入 KV 标记（节拍拆解模式）
                  const epDoneMatch = data.message?.match(/✓\s*(EP\d+)\s*(九宫格|四宫格)完成/);
                  if (epDoneMatch) {
                    // ★ 每集九宫格/四宫格完成时写入 KV 标记，供 Studio detectEpisodes 发现此 EP
                    const epId = epDoneMatch[1].toLowerCase();
                    kvSet(`feicai-beat-prompts-${epId}`, "1").catch(() => {});
                    toast(`${epDoneMatch[1]} ${epDoneMatch[2]}已完成 ✓`, "success");
                  }

                  // Update stage status
                  setStages((prev) =>
                    prev.map((s) => {
                      if (s.num === data.stage && data.status === "running") {
                        return { ...s, status: "active", badgeText: "执行中..." };
                      }
                      if (s.num === data.stage && (data.status === "done" || data.status === "review")) {
                        return { ...s, status: "done", badgeText: "✓ 已完成 · 导演审核通过" };
                      }
                      if (s.num === data.stage + 1 && data.status === "done") {
                        return { ...s, status: "active", badgeText: "执行中..." };
                      }
                      return s;
                    })
                  );

                  if (data.imageUrl) {
                    setImageUrl(data.imageUrl);
                  }
                } else if (eventType === "actionable") {
                  logNow(data.message, true);
                  logNow("[制片人] 💡 EP01九宫格已就绪！请从左侧导航栏进入「生图工作台」开始制作，流水线将继续运行", true);
                  toast("EP01九宫格已就绪！请从左侧导航栏进入生图工作台", "success");
                  // ★ EP01 就绪时立即写入 KV 标记（节拍拆解模式）
                  if (data.readyEpisode) {
                    kvSet(`feicai-beat-prompts-${data.readyEpisode}`, "1").catch(() => {});
                  }
                } else if (eventType === "complete") {
                  logNow(`[系统] ${data.message}`, true);
                  setStages((prev) => prev.map((s) => ({ ...s, status: "done", badgeText: "✓ 已完成" })));
                  if (data.imageUrl) setImageUrl(data.imageUrl);
                  toast("全流程执行完成！", "success");
                  streamFinished = true;
                  // ★ 写入所有 EP 的 KV 标记（节拍拆解模式，供 Studio detectEpisodes 发现）
                  if (data.files && Array.isArray(data.files)) {
                    for (const f of data.files) {
                      const m2 = (f as string).match(/beat-board-prompt-(ep\d+)\.md/);
                      if (m2) kvSet(`feicai-beat-prompts-${m2[1]}`, "1").catch(() => {});
                    }
                  }
                } else if (eventType === "extract-done") {
                  // Concurrent extraction completed — store result for studio page to consume
                  if (data.data) {
                    setExtractResult(data.data as Record<string, unknown>);
                    // ★ 直接持久化到 KV，不依赖 Studio 页面消费（修复刷新后数据丢失）
                    persistExtractResult(data.data as Record<string, unknown>);
                    logNow("[提取智能体] ✓ 角色/场景/道具已自动提取，切换到生图工作台查看", true);
                  }
                } else if (eventType === "error") {
                  logNow(`[错误] ${data.message}`, false);
                  toast(`流水线错误: ${data.message}`, "error");
                  setPipelineErrored(true); // ★ 标记可续传
                  streamFinished = true;
                }
              } catch { /* skip malformed JSON */ }
            }
          }
          if (streamFinished) break;
        }
      } catch (e: unknown) {
        if ((e as Error).name === "AbortError") {
          logNow("[系统] 流水线已手动停止");
        } else {
          const msg = e instanceof Error ? e.message : "未知错误";
          logNow(`[错误] ${msg}`);
          toast(`执行失败: ${msg}`, "error");
          setPipelineErrored(true); // ★ 标记可续传
        }
      } finally {
        reader?.releaseLock();
        setRunning(false);
        abortRef.current = null;
        removeTask(taskId);
        // ★ 流水线结束后清除「新项目」标记，确保 Studio 的 detectEpisodes()
        //   能正常检测新生成的 EP 文件，而不会因残留标记返回空状态
        try { localStorage.removeItem("feicai-new-project"); } catch { /* ignore */ }
      }
    },
    [toast, addTask, removeTask]
  );

  const stopPipeline = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
    toast("已停止执行", "info");
  }, [toast]);

  // ─── Resume pipeline (断点续传) ───
  const allDone = stages.every((s) => s.status === "done");
  const canResume = !running && pipelineErrored && !!lastParamsRef.current && !allDone;

  const resumePipeline = useCallback(async () => {
    const savedParams = lastParamsRef.current;
    if (!savedParams || running) return;

    // ★ 保留现有日志，不清空
    setPipelineErrored(false);
    setRunning(true);
    // 恢复 stages 中已完成的不变，未完成的重置为 waiting
    setStages((prev) =>
      prev.map((s) =>
        s.status === "done" ? s : { ...s, status: "waiting" as const, badgeText: "等待执行" }
      )
    );

    const logNow = (msg: string, gold = false) => {
      setLogs((prev) => [...prev, { time: timeStr(), msg, gold }]);
    };

    logNow(`[系统] ♻ 断点续传 — 从上次中断处继续，已完成的阶段/集数将自动跳过`, true);

    const taskId = `llm-pipeline-resume-${Date.now()}`;
    addTask({ id: taskId, type: "llm", label: "流水线断点续传", detail: "跳过已完成 → 继续生成" });

    const abort = new AbortController();
    abortRef.current = abort;

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const res = await fetch("/api/pipeline/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: savedParams.script,
          episode: savedParams.episode,
          settings: savedParams.settings,
          consistencyContext: savedParams.consistencyContext,
          referenceImages: savedParams.referenceImages,
          customPrompts: savedParams.customPrompts,
          resume: true, // ★ 断点续传标记
        }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "未知错误" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应流");

      const decoder = new TextDecoder();
      let buffer = "";
      let streamFinished = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // Process remaining buffer (same as startPipeline)
          if (buffer.trim()) {
            let eventType2 = "";
            for (const line of buffer.split("\n")) {
              if (line.startsWith("event: ")) {
                eventType2 = line.slice(7).trim();
              } else if (line.startsWith("data: ")) {
                try {
                  const data = JSON.parse(line.slice(6).trim());
                  if (eventType2 === "complete") {
                    logNow(`[系统] ${data.message}`, true);
                    setStages((prev) => prev.map((s) => ({ ...s, status: "done", badgeText: "✓ 已完成" })));
                    toast("断点续传完成！", "success");
                    if (data.files && Array.isArray(data.files)) {
                      for (const f of data.files) {
                        const m2 = (f as string).match(/beat-board-prompt-(ep\d+)\.md/);
                        if (m2) kvSet(`feicai-beat-prompts-${m2[1]}`, "1").catch(() => {});
                      }
                    }
                  } else if (eventType2 === "actionable") {
                    logNow(data.message, true);
                    if (data.readyEpisode) kvSet(`feicai-beat-prompts-${data.readyEpisode}`, "1").catch(() => {});
                  } else if (eventType2 === "extract-done") {
                    if (data.data) {
                      setExtractResult(data.data as Record<string, unknown>);
                      persistExtractResult(data.data as Record<string, unknown>);
                    }
                  } else if (eventType2 === "progress") {
                    logNow(data.message, false);
                  }
                } catch { /* skip */ }
              }
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            try {
              const data = JSON.parse(dataStr);
              if (eventType === "progress") {
                const isGold = data.message?.includes("导演") || data.message?.includes("PASS") || data.message?.includes("审核");
                logNow(data.message, isGold);

                const epDoneMatch = data.message?.match(/✓\s*(EP\d+)\s*(九宫格|四宫格)完成/);
                if (epDoneMatch) {
                  const epId = epDoneMatch[1].toLowerCase();
                  kvSet(`feicai-beat-prompts-${epId}`, "1").catch(() => {});
                  toast(`${epDoneMatch[1]} ${epDoneMatch[2]}已完成 ✓`, "success");
                }

                setStages((prev) =>
                  prev.map((s) => {
                    if (s.num === data.stage && data.status === "running") return { ...s, status: "active", badgeText: "执行中..." };
                    if (s.num === data.stage && (data.status === "done" || data.status === "review")) return { ...s, status: "done", badgeText: "✓ 已完成 · 导演审核通过" };
                    if (s.num === data.stage + 1 && data.status === "done") return { ...s, status: "active", badgeText: "执行中..." };
                    return s;
                  })
                );
                if (data.imageUrl) setImageUrl(data.imageUrl);
              } else if (eventType === "actionable") {
                logNow(data.message, true);
                if (data.readyEpisode) kvSet(`feicai-beat-prompts-${data.readyEpisode}`, "1").catch(() => {});
              } else if (eventType === "complete") {
                logNow(`[系统] ${data.message}`, true);
                setStages((prev) => prev.map((s) => ({ ...s, status: "done", badgeText: "✓ 已完成" })));
                if (data.imageUrl) setImageUrl(data.imageUrl);
                toast("断点续传完成！", "success");
                streamFinished = true;
                if (data.files && Array.isArray(data.files)) {
                  for (const f of data.files) {
                    const m2 = (f as string).match(/beat-board-prompt-(ep\d+)\.md/);
                    if (m2) kvSet(`feicai-beat-prompts-${m2[1]}`, "1").catch(() => {});
                  }
                }
              } else if (eventType === "extract-done") {
                if (data.data) {
                  setExtractResult(data.data as Record<string, unknown>);
                  persistExtractResult(data.data as Record<string, unknown>);
                  logNow("[提取智能体] ✓ 角色/场景/道具已自动提取", true);
                }
              } else if (eventType === "error") {
                logNow(`[错误] ${data.message}`, false);
                toast(`流水线错误: ${data.message}`, "error");
                setPipelineErrored(true);
                streamFinished = true;
              }
            } catch { /* skip malformed JSON */ }
          }
        }
        if (streamFinished) break;
      }
    } catch (e: unknown) {
      if ((e as Error).name === "AbortError") {
        logNow("[系统] 流水线已手动停止");
      } else {
        const msg = e instanceof Error ? e.message : "未知错误";
        logNow(`[错误] ${msg}`);
        toast(`续传失败: ${msg}`, "error");
        setPipelineErrored(true);
      }
    } finally {
      reader?.releaseLock();
      setRunning(false);
      abortRef.current = null;
      removeTask(taskId);
      try { localStorage.removeItem("feicai-new-project"); } catch { /* ignore */ }
    }
  }, [running, toast, addTask, removeTask]);

  const clearExtractResult = useCallback(() => {
    setExtractResult(null);
  }, []);

  return (
    <PipelineContext.Provider
      value={{
        stages,
        setStages,
        logs,
        running,
        imageUrl,
        episode,
        setEpisode,
        startPipeline,
        stopPipeline,
        resumePipeline,
        canResume,
        extractResult,
        clearExtractResult,
      }}
    >
      {children}
    </PipelineContext.Provider>
  );
}
