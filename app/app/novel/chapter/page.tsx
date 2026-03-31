"use client";

import { useState, useEffect } from "react";
import { 
  Sparkles, 
  Loader2, 
  BookOpen, 
  ChevronRight, 
  Save, 
  ChevronDown,
  FileText,
  Copy,
  Check,
  RotateCcw,
  PlayCircle,
  PauseCircle,
  Settings2
} from "lucide-react";
import { getActiveNovelProject, updateNovelProject, type NovelProject, type VolumeOutline, type ChapterOutline } from "../../lib/novelProjects";
import { useRouter } from "next/navigation";
import { Toaster, toast } from 'sonner';
import GeneratingOverlay from "../../components/GeneratingOverlay";

export default function NovelChapterPage() {
  const router = useRouter();
  const [project, setProject] = useState<NovelProject | null>(null);
  const [loading, setLoading] = useState(true);

  // Selection
  const [selectedVolumeIdx, setSelectedVolumeIdx] = useState<number>(0);
  const [selectedChapterIdx, setSelectedChapterIdx] = useState<number>(0);
  
  // Generation
  const [generating, setGenerating] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [auditReport, setAuditReport] = useState<any>(null);
  const [snapshots, setSnapshots] = useState<{ id: string; name: string; createdAt: number }[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>("");
  const [rewritingFromSnapshot, setRewritingFromSnapshot] = useState(false);

  // Batch Generation State
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number} | null>(null);
  const [batchStopSignal, setBatchStopSignal] = useState(false);

  const [sceneMode, setSceneMode] = useState(false);
  const [selectedSceneIdx, setSelectedSceneIdx] = useState(0);
  const [sceneGeneratingIdx, setSceneGeneratingIdx] = useState<number | null>(null);

  // Generation Settings (默认优化：关闭审计、真相更新、记忆增强以提升速度)
  const [memoryEnhance, setMemoryEnhance] = useState(false);
  const [targetWordCount, setTargetWordCount] = useState(2500);
  const [enableAudit, setEnableAudit] = useState(false);
  const [updateTruth, setUpdateTruth] = useState(false);

  const wordCountOptions = [
    { value: 1500, label: "1500字(短章)" },
    { value: 2000, label: "2000字(标准)" },
    { value: 2500, label: "2500字(中章)" },
    { value: 3000, label: "3000字(长章)" },
    { value: 5000, label: "5000字(大章)" },
  ];

  // 设置选项配置
  const generationOptions = [
    { 
      key: "enableAudit", 
      label: "连续性审计", 
      desc: "AI检查前后章节是否连贯，生成后自动修订（增加生成时间）",
      checked: enableAudit, 
      onChange: setEnableAudit 
    },
    { 
      key: "memoryEnhance", 
      label: "记忆增强", 
      desc: "AI读取前文相关记忆，提升连贯性（增加token消耗）",
      checked: memoryEnhance, 
      onChange: setMemoryEnhance 
    },
    { 
      key: "updateTruth", 
      label: "更新真相文件", 
      desc: "保存本章内容到真相文件，影响后续章节生成（增加生成时间）",
      checked: updateTruth, 
      onChange: setUpdateTruth 
    },
  ];

  const handleContinue = async () => {
      if (!generatedContent || !project || !currentChapter) return;
      
      const continueWordCount = Math.floor(targetWordCount * 0.6);
      
      try {
          const res = await fetch("/api/novel/chapter/rewrite", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                  content: generatedContent,
                  action: "continue",
                  targetWordCount: continueWordCount
              })
          });

          if (!res.ok) throw new Error("续写失败");
          
          const data = await res.json();
          if (data.content) {
              const newContent = generatedContent + "\n" + data.content;
              setGeneratedContent(newContent);
              toast.success(`已续写约 ${continueWordCount} 字`);
               
              if (project?.outline) {
                  const newOutline = [...project.outline];
                  newOutline[selectedVolumeIdx].chapters[selectedChapterIdx].content = newContent;
                  await updateNovelProject(project.id, { outline: newOutline });
                  setProject({ ...project, outline: newOutline });
              }
          }
      } catch (e) {
          toast.error("续写失败，请重试");
      }
  };

  const refreshSnapshots = async (projectId: string) => {
      try {
          const res = await fetch("/api/novel/truth/snapshots", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectId })
          });
          if (!res.ok) return;
          const data = await res.json();
          const list = Array.isArray(data.snapshots) ? data.snapshots : [];
          setSnapshots(list);
          if (list.length > 0 && !selectedSnapshotId) setSelectedSnapshotId(list[0].id);
          if (list.length === 0) setSelectedSnapshotId("");
      } catch {}
  };

  useEffect(() => {
    const loadProject = async () => {
      // Dynamic import
      const { getNovelProjects, getActiveNovelProject } = await import("../../lib/novelProjects");
      
      let p: NovelProject | null = null;
      
      // Check URL for project ID
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const projectId = params.get('id');
        if (projectId) {
          const projects = await getNovelProjects();
          p = projects.find((proj) => proj.id === projectId) || null;
        }
      }

      if (!p) {
        // Fallback 1: Try to load the project that was just created/edited (active project)
        p = await getActiveNovelProject();
      }
      
      // Fallback 2: If still no active project, but URL has ID (maybe data sync issue), try find again in list force refresh
      if (!p && typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          const projectId = params.get('id');
          if (projectId) {
             const projects = await getNovelProjects(); // This might need a force refresh param if implemented
             p = projects.find((proj) => proj.id === projectId) || null;
          }
      }

      setProject(p);
      setLoading(false);
      if (p?.id) refreshSnapshots(p.id);
    };
    loadProject();
  }, []);

  // Get current selection
  const currentVolume = project?.outline?.[selectedVolumeIdx];
  const currentChapter = currentVolume?.chapters?.[selectedChapterIdx];

  const getPreviousSummary = (outline: VolumeOutline[], volumeIdx: number, chapterIdx: number) => {
      let previousSummary = "";
      const lookBackCount = 3;
      let contextChapters: ChapterOutline[] = [];
      let currentV = volumeIdx;
      let currentC = chapterIdx - 1;
      while (contextChapters.length < lookBackCount && currentV >= 0) {
          if (currentC >= 0) {
              const ch = outline[currentV].chapters[currentC];
              contextChapters.unshift(ch);
              currentC--;
          } else {
              currentV--;
              if (currentV >= 0) currentC = outline[currentV].chapters.length - 1;
          }
      }
      if (contextChapters.length > 0) {
          previousSummary = contextChapters
              .map((ch, i) => `【前${contextChapters.length - i}章剧情 (${ch.title})】\n摘要：${ch.summary}\n${ch.content ? `正文片段：${ch.content.slice(-500)}` : ""}`)
              .join("\n\n");
      }
      return previousSummary;
  };

  const assembleChapterFromScenes = (ch: ChapterOutline) => {
      const list = ch.detail?.sceneList || [];
      const contents = ch.detail?.sceneContents || [];
      const parts = list.map((_, i) => (contents[i] || "").trim()).filter(Boolean);
      return parts.join("\n\n");
  };
  
  // Helper to get plot points (fallback to summary if no details)
  const getChapterPoints = (ch: ChapterOutline) => {
      const points = ch.detail?.plotPoints || ch.points || [];
      if (points.length === 0 && ch.summary) {
          return [ch.summary];
      }
      return points;
  };
  
  const hasPoints = true; // Always true now since we have summary
  const hasContent = !!currentChapter?.content;

  // Load existing content when selection changes
  useEffect(() => {
      if (currentChapter?.content) {
          setGeneratedContent(currentChapter.content);
          
          // Auto-select if not set initially
          // This ensures when we land on page, we see the first chapter
      } else {
          setGeneratedContent("");
      }
  }, [selectedVolumeIdx, selectedChapterIdx, project]); // Depend on project to refresh when saved

  useEffect(() => {
      const hasScenes = !!currentChapter?.detail?.sceneList?.length;
      setSceneMode(hasScenes);
      setSelectedSceneIdx(0);
  }, [selectedVolumeIdx, selectedChapterIdx]);

  const handleGenerateScene = async (sceneIdx: number) => {
      if (!project || !currentChapter || !project.outline) return;
      const scene = currentChapter.detail?.sceneList?.[sceneIdx];
      if (!scene) return;

      setSceneGeneratingIdx(sceneIdx);
      try {
          const outline = project.outline;
          const previousSummary = getPreviousSummary(outline, selectedVolumeIdx, selectedChapterIdx);

          const existingContents = currentChapter.detail?.sceneContents || [];
          const chapterSoFar = existingContents.slice(0, sceneIdx).filter(Boolean).join("\n\n");

          const res = await fetch("/api/novel/scene/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                  projectId: project.id,
                  chapterTitle: currentChapter.title,
                  sceneIndex: sceneIdx,
                  scene,
                  novelContext: `小说标题：${project.title}。题材：${project.tags.join(",")}。梗概：${project.description}`,
                  previousSummary,
                  chapterSoFar,
              }),
          });

          if (!res.ok) throw new Error("生成失败");
          const data = await res.json();
          if (!data.content) throw new Error("生成失败");

          const newOutline = [...project.outline];
          const ch = newOutline[selectedVolumeIdx].chapters[selectedChapterIdx];
          const oldDetail = ch.detail || { plotPoints: [], scenes: [], characters: [], skills: [], items: [], world: [] };
          const sceneContents = Array.isArray(oldDetail.sceneContents) ? [...oldDetail.sceneContents] : [];
          while (sceneContents.length < (oldDetail.sceneList?.length || 0)) sceneContents.push("");
          sceneContents[sceneIdx] = data.content;
          const nextDetail = { ...oldDetail, sceneContents };
          ch.detail = nextDetail;
          ch.content = assembleChapterFromScenes({ ...ch, detail: nextDetail });

          await updateNovelProject(project.id, { outline: newOutline });
          setProject({ ...project, outline: newOutline });
          setGeneratedContent(ch.content || "");
          toast.success(`场景 ${sceneIdx + 1} 已生成并拼接到正文`);
      } catch (e) {
          toast.error("场景生成失败，请重试");
      } finally {
          setSceneGeneratingIdx(null);
      }
  };

  const handleGenerate = async () => {
    if (!project || !currentChapter || !hasPoints) return;
    if (!project.outline) return;
    const outline = project.outline;
    
    setGenerating(true);
    setGeneratedContent(""); // Clear previous content
    setAuditReport(null);

    try {
      const points = getChapterPoints(currentChapter);
      
      // Get previous summaries for context memory
      let previousSummary = "";
      // Look back up to 3 previous chapters for better context
      const lookBackCount = 3;
      let contextChapters: ChapterOutline[] = [];
      
      let currentV = selectedVolumeIdx;
      let currentC = selectedChapterIdx - 1;
      
      while (contextChapters.length < lookBackCount && currentV >= 0) {
          if (currentC >= 0) {
              const ch = outline[currentV].chapters[currentC];
              contextChapters.unshift(ch); // Add to beginning
              currentC--;
          } else {
              currentV--;
              if (currentV >= 0) {
                  currentC = outline[currentV].chapters.length - 1;
              }
          }
      }
      
      if (contextChapters.length > 0) {
          previousSummary = contextChapters.map((ch, i) => 
              `【前${contextChapters.length - i}章剧情 (${ch.title})】\n摘要：${ch.summary}\n${ch.content ? `正文片段：${ch.content.slice(-500)}` : ""}`
          ).join("\n\n");
      }
      
      const res = await fetch("/api/novel/chapter/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          chapterTitle: currentChapter.title,
          points: points,
          novelContext: `小说标题：${project.title}。题材：${project.tags.join(",")}。梗概：${project.description}`,
          detail: currentChapter.detail,
          previousSummary,
          memoryEnhance,
          targetWordCount,
          audit: enableAudit,
          updateTruth: updateTruth
        }),
      });

      if (!res.ok) throw new Error("生成失败");
      
      const data = await res.json();
      if (data.content) {
        setGeneratedContent(data.content);
        setAuditReport(data.audit || null);
        refreshSnapshots(project.id);
        
        // Auto-save logic
        const newOutline = [...project.outline];
        newOutline[selectedVolumeIdx].chapters[selectedChapterIdx].content = data.content;
        await updateNovelProject(project.id, { outline: newOutline });
        setProject({ ...project, outline: newOutline });
        
        // Auto-save success feedback
        console.log("Generated content auto-saved.");
      }
    } catch (e) {
      alert("生成正文出错，请重试");
    } finally {
      setGenerating(false);
    }
  };

  const handleRollbackRewrite = async () => {
      if (!project || !currentChapter || !project.outline) return;
      if (!selectedSnapshotId) {
          toast.error("没有可用快照");
          return;
      }
      if (!confirm("确定要回滚真相文件到所选快照，并重写本章吗？这会覆盖当前本章正文。")) return;

      setRewritingFromSnapshot(true);
      setAuditReport(null);
      try {
          const points = getChapterPoints(currentChapter);

          let previousSummary = "";
          const lookBackCount = 3;
          let contextChapters: ChapterOutline[] = [];
          let currentV = selectedVolumeIdx;
          let currentC = selectedChapterIdx - 1;
          const outline = project.outline;

          while (contextChapters.length < lookBackCount && currentV >= 0) {
              if (currentC >= 0) {
                  const ch = outline[currentV].chapters[currentC];
                  contextChapters.unshift(ch);
                  currentC--;
              } else {
                  currentV--;
                  if (currentV >= 0) currentC = outline[currentV].chapters.length - 1;
              }
          }

          if (contextChapters.length > 0) {
              previousSummary = contextChapters.map((ch, i) =>
                  `【前${contextChapters.length - i}章剧情 (${ch.title})】\n摘要：${ch.summary}\n${ch.content ? `正文片段：${ch.content.slice(-500)}` : ""}`
              ).join("\n\n");
          }

          const res = await fetch("/api/novel/chapter/rewrite-from-snapshot", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                  projectId: project.id,
                  snapshotId: selectedSnapshotId,
                  chapterTitle: currentChapter.title,
                  points,
                  novelContext: `小说标题：${project.title}。题材：${project.tags.join(",")}。梗概：${project.description}`,
                  detail: currentChapter.detail,
                  previousSummary
              })
          });
          if (!res.ok) throw new Error("重写失败");
          const data = await res.json();
          if (data.content) {
              setGeneratedContent(data.content);
              setAuditReport(data.audit || null);
              const newOutline = [...project.outline];
              newOutline[selectedVolumeIdx].chapters[selectedChapterIdx].content = data.content;
              await updateNovelProject(project.id, { outline: newOutline });
              setProject({ ...project, outline: newOutline });
              toast.success("回滚并重写完成");
              refreshSnapshots(project.id);
          }
      } catch (e) {
          toast.error("回滚重写失败，请重试");
      } finally {
          setRewritingFromSnapshot(false);
      }
  };

  const handleSaveContent = async () => {
      if (!project || !project.outline || !generatedContent) return;
      
      const newOutline = [...project.outline];
      newOutline[selectedVolumeIdx].chapters[selectedChapterIdx].content = generatedContent;
      
      await updateNovelProject(project.id, { outline: newOutline });
      setProject({ ...project, outline: newOutline }); // Local update
      toast.success("保存成功", { duration: 2000 });
  };

  const handleCopy = () => {
      navigator.clipboard.writeText(generatedContent);
      setCopied(true);
      toast.success("已复制到剪贴板");
      setTimeout(() => setCopied(false), 2000);
  };

  // Batch Generate Chapter Content
  const handleBatchGenerateContent = async () => {
      if (!project || !project.outline) return;
      if (batchGenerating) return;

      if (!confirm("确定要为所有未完成的章节批量生成正文吗？这将花费较长时间，请保持页面开启。")) return;

      setBatchGenerating(true);
      setBatchStopSignal(false);

      // Collect all tasks (chapters without content)
      let tasks: {vIdx: number, cIdx: number}[] = [];
      project.outline.forEach((vol, vIdx) => {
          vol.chapters.forEach((ch, cIdx) => {
              // Only generate if no content exists
              if (!ch.content) {
                  tasks.push({vIdx, cIdx});
              }
          });
      });

      if (tasks.length === 0) {
          alert("所有章节都已生成正文，无需操作。");
          setBatchGenerating(false);
          return;
      }

      setBatchProgress({ current: 0, total: tasks.length });

      // Process sequentially
      let newOutline = JSON.parse(JSON.stringify(project.outline)); // Deep copy
      
      try {
          for (let i = 0; i < tasks.length; i++) {
              if (batchStopSignal) break; // Check stop signal

              const task = tasks[i];
              const chapter = newOutline[task.vIdx].chapters[task.cIdx];
              
              // Prepare points (fallback to summary)
              const points = getChapterPoints(chapter);

              // Call API
              const res = await fetch("/api/novel/chapter/generate", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                      projectId: project.id,
                      audit: false,
                      updateTruth: true,
                      truthMode: "heuristic",
                      createSnapshots: false,
                      chapterTitle: chapter.title,
                      points: points,
                      novelContext: `小说标题：${project.title}。题材：${project.tags.join(",")}。梗概：${project.description}`,
                      detail: chapter.detail 
                  })
              });

              if (res.ok) {
                  const data = await res.json();
                  if (data.content) {
                      // Update structure
                      newOutline[task.vIdx].chapters[task.cIdx].content = data.content;

                      // Save incrementally to DB (safer)
                      await updateNovelProject(project.id, { outline: newOutline });
                      // Update local state to reflect progress in UI
                      setProject(prev => prev ? ({ ...prev, outline: newOutline }) : null);
                  }
              }

              setBatchProgress({ current: i + 1, total: tasks.length });
          }
      } catch (e) {
          console.error(e);
          alert("批量生成过程中出错，已停止。");
      } finally {
          setBatchGenerating(false);
          setBatchProgress(null);
          setBatchStopSignal(false);
      }
  };

  const stopBatch = () => {
      setBatchStopSignal(true);
      setBatchGenerating(false); // Force UI reset immediately
  };


  if (loading) {
      return <div className="flex items-center justify-center h-full text-[var(--text-muted)]"><Loader2 size={24} className="animate-spin mr-2"/> 加载中...</div>;
  }

  if (!project) {
      return (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-[var(--text-secondary)]">
              <BookOpen size={48} className="opacity-20" />
              <p>请先在项目总览中选择一个项目</p>
              <button 
                onClick={() => router.push("/novel")}
                className="btn-primary"
              >
                  返回项目列表
              </button>
          </div>
      );
  }

  if (!project.outline || project.outline.length === 0) {
      return (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-[var(--text-secondary)]">
              <FileText size={48} className="opacity-20" />
              <p>该项目还没有大纲，请先生成大纲</p>
              <button 
                onClick={() => router.push("/novel/outline")}
                className="btn-secondary border-[var(--gold-primary)] text-[var(--gold-primary)] hover:bg-[var(--gold-primary)] hover:text-[#0A0A0A]"
              >
                  去生成大纲
              </button>
          </div>
      );
  }

  // Calculate Progress
  const totalChapters = project?.outline?.reduce((acc, vol) => acc + vol.chapters.length, 0) || 0;
  const completedChapters = project?.outline?.reduce((acc, vol) => acc + vol.chapters.filter(c => !!c.content).length, 0) || 0;
  const progressPercentage = totalChapters > 0 ? (completedChapters / totalChapters) * 100 : 0;

  return (
    <div className="flex h-full overflow-hidden">
      <GeneratingOverlay
        open={generating || rewritingFromSnapshot || batchGenerating}
        title={
          batchGenerating
            ? "正在批量生成正文"
            : rewritingFromSnapshot
              ? "正在回滚并重写"
              : "正在生成正文"
        }
        detail={
          batchGenerating && batchProgress
            ? `进度 ${batchProgress.current}/${batchProgress.total}`
            : "请稍候，页面已锁定以防误操作"
        }
        progress={
          batchGenerating && batchProgress && batchProgress.total > 0
            ? (batchProgress.current / batchProgress.total) * 100
            : null
        }
      />
      <Toaster position="top-center" theme="dark" />
      {/* Left: Chapter Sidebar */}
      <div className="w-[300px] border-r border-[var(--border-default)] flex flex-col h-full bg-[var(--bg-surface)] shrink-0">
        <div className="p-4 border-b border-[var(--border-default)] flex flex-col gap-4">
            <div>
                <p className="text-[12px] text-[var(--text-secondary)] mb-1 truncate" title={project.title}>
                    {project.title}
                </p>
                <h2 className="text-[20px] font-bold text-[var(--text-primary)]">
                    章节内容
                </h2>
            </div>

            {/* Progress Bar */}
            <div className="flex flex-col gap-1.5">
                <div className="h-1.5 w-full bg-[#1f1f1f] rounded-full overflow-hidden">
                    <div 
                        className="h-full bg-[var(--gold-primary)] transition-all duration-500 ease-out"
                        style={{ width: `${progressPercentage}%` }}
                    />
                </div>
                <div className="flex justify-end text-[10px] text-[var(--text-secondary)] font-mono">
                    {completedChapters}/{totalChapters}
                </div>
            </div>
            
            {/* Batch Action */}
            <div className="grid grid-cols-2 gap-2">
                {!batchGenerating ? (
                    <button 
                        onClick={handleBatchGenerateContent}
                        className="btn-secondary w-full py-2 border-[var(--gold-primary)] text-[var(--gold-primary)] hover:bg-[var(--gold-primary)] hover:text-[#0A0A0A] text-[12px]"
                        title="自动为所有未完成的章节生成正文"
                    >
                        <Sparkles size={14} />
                        批量生成
                    </button>
                ) : (
                    <div className="col-span-2 flex items-center gap-2 w-full py-2 bg-[var(--bg-page)] border border-[var(--gold-primary)] rounded text-[12px] px-3">
                        <Loader2 size={14} className="animate-spin text-[var(--gold-primary)]" />
                        <span className="flex-1 text-[var(--text-primary)] truncate">
                            {batchProgress?.current}/{batchProgress?.total}
                        </span>
                        <button onClick={stopBatch} className="text-red-400 hover:text-red-500">
                            <PauseCircle size={16} />
                        </button>
                    </div>
                )}
            </div>

            {/* Batch Progress Bar (Visible only when generating) */}
            {batchGenerating && batchProgress && (
                <div className="flex flex-col gap-1 animate-in fade-in slide-in-from-top-2">
                    <div className="flex justify-between text-[10px] text-[var(--text-secondary)]">
                        <span>正在批量生成...</span>
                        <span>{Math.round((batchProgress.current / batchProgress.total) * 100)}%</span>
                    </div>
                    <div className="h-1 w-full bg-[#1f1f1f] rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-[var(--gold-primary)] transition-all duration-300"
                            style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                        />
                    </div>
                </div>
            )}
        </div>
        
        <div className="flex-1 overflow-y-auto">
            {project.outline.map((volume, vIdx) => (
                <div key={vIdx} className="flex flex-col">
                    <div className="px-4 py-2 text-[12px] font-bold text-[var(--text-secondary)] bg-[var(--bg-page)] border-b border-[var(--border-subtle)] sticky top-0 z-10">
                        {volume.title}
                    </div>
                    {volume.chapters.map((chapter, cIdx) => {
                        const hasDetail = getChapterPoints(chapter).length > 0;
                        return (
                            <button
                                key={cIdx}
                                onClick={() => {
                                    setSelectedVolumeIdx(vIdx);
                                    setSelectedChapterIdx(cIdx);
                                }}
                                className={`flex items-center gap-3 px-4 py-3 text-left transition border-b border-[var(--border-subtle)] group ${
                                    selectedVolumeIdx === vIdx && selectedChapterIdx === cIdx
                                    ? "bg-[var(--gold-primary)]/10 text-[var(--text-primary)] border-l-2 border-l-[var(--gold-primary)]"
                                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-page)] hover:text-[var(--text-primary)] border-l-2 border-l-transparent"
                                }`}
                            >
                                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${chapter.content ? "bg-green-500" : hasDetail ? "bg-[var(--gold-primary)]" : "bg-[var(--border-default)]"}`} />
                                <div className="flex flex-col gap-0.5 overflow-hidden flex-1">
                                    <span className="text-[13px] font-medium truncate">{chapter.title}</span>
                                    <span className="text-[11px] text-[var(--text-muted)] truncate">{chapter.summary.slice(0, 15)}...</span>
                                </div>
                                {hasDetail && <Sparkles size={10} className="text-[var(--gold-primary)] opacity-50" />}
                            </button>
                        );
                    })}
                </div>
            ))}
        </div>
      </div>

      {/* Middle: Context & Outline View */}
      <div className="w-[350px] border-r border-[var(--border-default)] flex flex-col h-full bg-[var(--bg-page)] shrink-0 overflow-hidden">
          <div className="p-5 border-b border-[var(--border-default)] bg-[var(--bg-surface)]">
              <h2 className="text-[16px] font-medium text-[var(--text-primary)] mb-1">
                  {currentChapter?.title}
              </h2>
              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                  {currentChapter?.summary}
              </p>
          </div>
          
          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-[var(--text-secondary)]">本章摘要 & 灵感</span>
              </div>
              
              <div className="flex flex-col gap-3">
                  {getChapterPoints(currentChapter!).map((point, idx) => (
                      <div key={idx} className="flex gap-3 text-[13px] text-[var(--text-primary)] leading-relaxed bg-[var(--bg-surface)] p-3 rounded border border-[var(--border-default)]">
                          <span className="text-[var(--gold-primary)] font-mono shrink-0">{idx + 1}.</span>
                          <span>{point}</span>
                      </div>
                  ))}

                  {sceneMode && currentChapter?.detail?.sceneList && currentChapter.detail.sceneList.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] flex flex-col gap-3">
                          <div className="flex items-center justify-between">
                              <span className="text-[13px] font-medium text-[var(--text-secondary)]">场景列表</span>
                              <span className="text-[11px] text-[var(--text-muted)]">
                                  {currentChapter.detail.sceneContents?.filter(Boolean).length || 0}/{currentChapter.detail.sceneList.length}
                              </span>
                          </div>
                          {currentChapter.detail.sceneList.map((s, idx) => {
                              const done = !!currentChapter.detail?.sceneContents?.[idx];
                              const selected = selectedSceneIdx === idx;
                              return (
                                  <div
                                      key={idx}
                                      className={`flex items-start gap-3 p-3 rounded border transition ${
                                          selected
                                              ? "border-[var(--gold-primary)]/40 bg-[var(--gold-primary)]/10"
                                              : "border-[var(--border-default)] bg-[var(--bg-surface)]"
                                      }`}
                                  >
                                      <button
                                          onClick={() => setSelectedSceneIdx(idx)}
                                          className="flex-1 text-left"
                                      >
                                          <div className="flex items-center gap-2">
                                              <div className={`w-1.5 h-1.5 rounded-full ${done ? "bg-green-500" : "bg-[var(--border-default)]"}`} />
                                              <span className="text-[13px] font-medium text-[var(--text-primary)]">
                                                  {idx + 1}. {s.title}
                                              </span>
                                          </div>
                                          <div className="text-[12px] text-[var(--text-secondary)] mt-1 leading-relaxed">
                                              {s.summary}
                                          </div>
                                      </button>
                                      <button
                                          onClick={() => handleGenerateScene(idx)}
                                          disabled={sceneGeneratingIdx !== null || generating || batchGenerating}
                                          className="btn-secondary shrink-0 p-2 text-[12px] border-[var(--gold-primary)]/30 text-[var(--gold-primary)] hover:bg-[var(--gold-primary)] hover:text-[#0A0A0A]"
                                      >
                                          {sceneGeneratingIdx === idx ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                                      </button>
                                  </div>
                              );
                          })}
                      </div>
                  )}
                  
                  {/* Show other details if available */}
                  {currentChapter?.detail && (
                      <div className="mt-4 pt-4 border-t border-[var(--border-subtle)] flex flex-col gap-2">
                          {currentChapter.detail.scenes && currentChapter.detail.scenes.length > 0 && (
                              <div className="text-[12px] text-[var(--text-secondary)]">
                                  <span className="font-bold mr-2">场景:</span> {currentChapter.detail.scenes.join("、")}
                              </div>
                          )}
                          {currentChapter.detail.characters && currentChapter.detail.characters.length > 0 && (
                              <div className="text-[12px] text-[var(--text-secondary)]">
                                  <span className="font-bold mr-2">人物:</span> {currentChapter.detail.characters.join("、")}
                              </div>
                          )}
                      </div>
                  )}
              </div>
          </div>

          <div className="p-5 border-t border-[var(--border-default)] bg-[var(--bg-surface)] flex flex-col gap-3">
              {/* Generation Settings */}
              <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                      <span className="text-[12px] text-[var(--text-secondary)]">生成设置：</span>
                      <select 
                          value={targetWordCount}
                          onChange={(e) => setTargetWordCount(Number(e.target.value))}
                          className="bg-[var(--bg-page)] text-[var(--text-primary)] text-[12px] border border-[var(--border-default)] rounded px-2 py-1 outline-none focus:border-[var(--gold-primary)]"
                      >
                          {wordCountOptions.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                      </select>
                  </div>
                  
                  {/* 高级选项 */}
                  <div className="p-4 bg-[var(--bg-page)] rounded-lg border border-[var(--border-subtle)]">
                      <div className="flex items-center justify-between mb-3">
                          <span className="text-[13px] font-medium text-[var(--text-primary)] flex items-center gap-1">
                              <Settings2 size={14} className="text-[var(--gold-primary)]" />
                              高级选项
                          </span>
                          <span className="text-[11px] text-[var(--text-muted)]">影响生成速度</span>
                      </div>
                      <div className="grid grid-cols-1 gap-3">
                          {generationOptions.map((opt) => (
                              <button
                                  key={opt.key}
                                  onClick={() => opt.onChange(!opt.checked)}
                                  className={`p-3 rounded border text-left transition ${
                                      opt.checked 
                                          ? 'border-[var(--gold-primary)]/50 bg-[var(--gold-primary)]/10' 
                                          : 'border-[var(--border-default)] hover:border-[var(--gold-primary)]/30'
                                  }`}
                              >
                                  <div className="flex items-center gap-2 mb-1">
                                      <div className={`w-4 h-4 rounded border flex items-center justify-center ${opt.checked ? 'border-[var(--gold-primary)] bg-[var(--gold-primary)]' : 'border-[var(--border-default)]'}`}>
                                          {opt.checked && <Check size={12} className="text-[#0A0A0A]" />}
                                      </div>
                                      <span className={`text-[13px] font-medium ${opt.checked ? 'text-[var(--gold-primary)]' : 'text-[var(--text-secondary)]'}`}>
                                          {opt.label}
                                      </span>
                                  </div>
                                  <p className="text-[11px] text-[var(--text-muted)] leading-relaxed pl-6">{opt.desc}</p>
                              </button>
                          ))}
                      </div>
                  </div>
              </div>

              <button 
                onClick={handleGenerate}
                disabled={generating || batchGenerating}
                className="btn-primary w-full py-3"
              >
                {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {generating ? "正在撰写正文..." : hasContent ? "重新生成正文 (覆盖)" : "开始生成正文"}
              </button>

              {hasContent && (
                  <button
                      onClick={handleContinue}
                      disabled={generating}
                      className="w-full btn-secondary px-3 py-2 border-[var(--gold-primary)]/50 text-[var(--gold-primary)] hover:bg-[var(--gold-primary)] hover:text-[#0A0A0A] text-[13px]"
                  >
                      <ChevronRight size={14} className="mr-2" />
                      续写本章
                  </button>
              )}

              {snapshots.length > 0 && (
                  <div className="flex gap-2">
                      <select
                          value={selectedSnapshotId}
                          onChange={(e) => setSelectedSnapshotId(e.target.value)}
                          className="flex-1 bg-[var(--bg-page)] text-[var(--text-primary)] text-[13px] border border-[var(--border-default)] rounded px-3 outline-none focus:border-[var(--gold-primary)]"
                          disabled={rewritingFromSnapshot || generating || batchGenerating}
                      >
                          {snapshots.map(s => (
                              <option key={s.id} value={s.id}>{s.id}</option>
                          ))}
                      </select>
                      <button
                          onClick={handleRollbackRewrite}
                          disabled={rewritingFromSnapshot || generating || batchGenerating || !selectedSnapshotId}
                          className="btn-danger px-4 py-2 border-red-500/40 text-red-300 text-[13px]"
                      >
                          {rewritingFromSnapshot ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                          {rewritingFromSnapshot ? "回滚中" : "回滚重写"}
                      </button>
                  </div>
              )}

              {auditReport && (
                  <div className="mt-2 p-4 bg-[var(--bg-page)] border border-[var(--gold-primary)]/20 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                          <span className="text-[12px] font-bold text-[var(--text-primary)]">连续性审计</span>
                          <span className={`text-[11px] px-2 py-0.5 rounded border ${auditReport.pass ? "text-green-400 border-green-400/30 bg-green-400/5" : "text-yellow-400 border-yellow-400/30 bg-yellow-400/5"}`}>
                              {auditReport.pass ? "通过" : "未通过（已自动修订）"}
                          </span>
                      </div>
                      <div className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                          <div className="flex gap-3 flex-wrap">
                              <span>关键问题：{(auditReport.issues || []).filter((i: any) => i.level === "critical").length}</span>
                              <span>提示：{(auditReport.issues || []).filter((i: any) => i.level !== "critical").length}</span>
                              <span>词汇疲劳：{(auditReport.vocabFatigue || []).length}</span>
                          </div>
                          {(auditReport.issues || []).slice(0, 3).map((i: any, idx: number) => (
                              <div key={idx} className="mt-2">
                                  <span className={`${i.level === "critical" ? "text-red-400" : "text-[var(--gold-primary)]"} font-bold mr-2`}>
                                      {i.level === "critical" ? "关键" : "提示"}
                                  </span>
                                  <span className="text-[var(--text-primary)]">{i.message}</span>
                              </div>
                          ))}
                      </div>
                  </div>
              )}
          </div>
      </div>

      {/* Right: Content Editor/Preview */}
      <div className="flex-1 flex flex-col h-full bg-[var(--bg-surface)] overflow-hidden">
          <div className="h-[60px] border-b border-[var(--border-default)] flex items-center justify-between px-6 shrink-0">
              <h2 className="text-[14px] font-medium text-[var(--text-primary)] flex items-center gap-2">
                  <FileText size={16} className="text-[var(--gold-primary)]" />
                  正文预览
                  {generatedContent && (
                      <span className="text-[10px] text-[var(--text-secondary)] font-mono ml-2 px-1.5 py-0.5 bg-[var(--bg-page)] rounded border border-[var(--border-subtle)]">
                          {generatedContent.length} 字
                      </span>
                  )}
              </h2>
              <div className="flex items-center gap-2">
                  {generatedContent && (
                      <>
                        <button 
                            onClick={handleCopy}
                            className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded transition"
                            title="复制全文"
                        >
                            {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                        </button>
                        <div className="h-4 w-[1px] bg-[var(--border-default)]"></div>
                        <button 
                            onClick={handleSaveContent}
                            className="btn-primary px-4 py-1.5 text-[12px] bg-[var(--text-primary)] text-[var(--bg-page)]"
                        >
                            <Save size={14} />
                            保存正文
                        </button>
                      </>
                  )}
              </div>
          </div>

          <div className="flex-1 overflow-y-auto p-8 bg-[#0a0a0a]">
              {generatedContent ? (
                  <div className="max-w-[800px] mx-auto prose prose-invert">
                      <div className="whitespace-pre-wrap text-[16px] leading-relaxed text-[var(--text-primary)] font-serif">
                          {generatedContent}
                      </div>
                  </div>
              ) : (
                  <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] opacity-50">
                      <Sparkles size={48} className="mb-4" />
                      <p>点击“开始生成正文”，AI 将为您撰写精彩故事</p>
                  </div>
              )}
          </div>
      </div>
    </div>
  );
}
