"use client";

import { useState, useEffect } from "react";
import { 
  Loader2, 
  BookOpen, 
  Sparkles, 
  ChevronRight, 
  Save, 
  FileText,
  Copy,
  Check,
  RefreshCw,
  Layout,
  Download
} from "lucide-react";
import { getActiveNovelProject, type NovelProject, type ChapterOutline } from "../../lib/novelProjects";
import { saveScriptDB, type ScriptRecord } from "../../lib/scriptDB";
import { useRouter } from "next/navigation";
import GeneratingOverlay from "../../components/GeneratingOverlay";

interface StoryboardScene {
    sceneNumber: number;
    description: string;
    dialogue: { role: string; content: string }[];
}

export default function NovelScriptPage() {
  const router = useRouter();
  const [project, setProject] = useState<NovelProject | null>(null);
  const [loading, setLoading] = useState(true);

  // Selection
  const [selectedVolumeIdx, setSelectedVolumeIdx] = useState<number>(0);
  const [selectedChapterIdx, setSelectedChapterIdx] = useState<number>(0);
  
  // Conversion State
  const [converting, setConverting] = useState(false);
  const [scenes, setScenes] = useState<StoryboardScene[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    getActiveNovelProject().then(p => {
      setProject(p);
      setLoading(false);
    });
  }, []);

  const currentChapter = project?.outline?.[selectedVolumeIdx]?.chapters?.[selectedChapterIdx];

  const handleConvert = async () => {
    if (!currentChapter?.content || !project) return;
    
    setConverting(true);
    setScenes(null);

    try {
      const res = await fetch("/api/novel/script/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${project.title} - ${currentChapter.title}`,
          content: currentChapter.content
        }),
      });

      if (!res.ok) throw new Error("转换失败");
      
      const data = await res.json();
      if (data.scenes) {
        setScenes(data.scenes);
      }
    } catch (e) {
      alert("剧本转换出错，请重试");
    } finally {
      setConverting(false);
    }
  };

  const handleExportToMain = async () => {
      if (!scenes || !project || !currentChapter) return;
      
      setExporting(true);
      try {
          // Construct text version
          let text = "";
          scenes.forEach(s => {
              text += `[场景 ${s.sceneNumber}]\n${s.description}\n\n`;
              s.dialogue.forEach(d => {
                  text += `${s.dialogue.length > 0 ? d.role + '：' : ''}${d.content}\n`;
              });
              text += "\n---\n\n";
          });
          
          const scriptRecord: ScriptRecord = {
              id: `novel_script_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              title: `${project.title} - ${currentChapter.title}`,
              desc: `从小说工作室转换生成的剧本 (${scenes.length} 个场景)`,
              status: "draft",
              content: text
          };

          await saveScriptDB(scriptRecord);
          
          // Also copy to clipboard for convenience
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);

          alert("剧本已成功导出到主工作室剧本库！同时也已复制到剪贴板。");
          
      } catch (e) {
          console.error(e);
          alert("导出失败");
      } finally {
          setExporting(false);
      }
  };

  if (loading) {
      return <div className="flex items-center justify-center h-full text-[var(--text-muted)]"><Loader2 size={24} className="animate-spin mr-2"/> 加载中...</div>;
  }

  if (!project) {
      return (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-[var(--text-secondary)]">
              <BookOpen size={48} className="opacity-20" />
              <p>请先在项目总览中选择一个项目</p>
              <button onClick={() => router.push("/novel")} className="btn-primary">返回项目列表</button>
          </div>
      );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <GeneratingOverlay
        open={converting}
        title="正在转换分镜剧本"
        detail="请稍候，页面已锁定以防误操作"
      />
      {/* Left Chapter Selector */}
      <div className="w-[280px] border-r border-[var(--border-default)] flex flex-col h-full bg-[var(--bg-surface)] shrink-0">
        <div className="p-4 border-b border-[var(--border-default)]">
            <h2 className="text-[14px] font-medium text-[var(--text-primary)]">选择章节</h2>
            <p className="text-[11px] text-[var(--text-secondary)] mt-1">将选中的章节正文转换为分镜剧本</p>
        </div>
        <div className="flex-1 overflow-y-auto">
            {project.outline?.map((volume, vIdx) => (
                <div key={vIdx} className="flex flex-col">
                    <div className="px-4 py-2 text-[11px] font-bold text-[var(--text-secondary)] bg-[var(--bg-page)] border-b border-[var(--border-subtle)]">
                        {volume.title}
                    </div>
                    {volume.chapters.map((chapter, cIdx) => (
                        <button
                            key={cIdx}
                            onClick={() => {
                                setSelectedVolumeIdx(vIdx);
                                setSelectedChapterIdx(cIdx);
                                setScenes(null);
                            }}
                            className={`flex items-center gap-3 px-4 py-3 text-left transition border-b border-[var(--border-subtle)] group ${
                                selectedVolumeIdx === vIdx && selectedChapterIdx === cIdx
                                ? "bg-[var(--gold-primary)]/10 text-[var(--text-primary)] border-l-2 border-l-[var(--gold-primary)]"
                                : "text-[var(--text-secondary)] hover:bg-[var(--bg-page)] hover:text-[var(--text-primary)] border-l-2 border-l-transparent"
                            }`}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${chapter.content ? "bg-green-500" : "bg-[var(--border-default)]"}`} />
                            <div className="flex flex-col gap-0.5 overflow-hidden flex-1">
                                <span className="text-[13px] font-medium truncate">{chapter.title}</span>
                                <span className="text-[11px] text-[var(--text-muted)] truncate">{chapter.content ? `${chapter.content.length} 字` : "无正文"}</span>
                            </div>
                        </button>
                    ))}
                </div>
            ))}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full bg-[var(--bg-page)] overflow-hidden">
          {/* Header */}
          <div className="h-[60px] border-b border-[var(--border-default)] flex items-center justify-between px-6 bg-[var(--bg-surface)] shrink-0">
              <div className="flex items-center gap-2">
                  <RefreshCw size={18} className="text-[var(--gold-primary)]" />
                  <h2 className="text-[14px] font-medium text-[var(--text-primary)]">剧本转换器</h2>
              </div>
              
              <div className="flex items-center gap-3">
                  <button 
                    onClick={handleConvert}
                    disabled={converting || !currentChapter?.content}
                    className="btn-primary px-4 py-1.5 text-[12px]"
                  >
                      {converting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      {scenes ? "重新转换" : "开始转换"}
                  </button>
                  {scenes && (
                      <button 
                        onClick={handleExportToMain}
                        disabled={exporting}
                        className="btn-secondary px-4 py-1.5 text-[12px] border-[var(--gold-primary)] text-[var(--gold-primary)] hover:bg-[var(--gold-primary)] hover:text-[#0A0A0A]"
                      >
                          {exporting ? <Loader2 size={14} className="animate-spin" /> : copied ? <Check size={14} /> : <Download size={14} />}
                          导出到剧本库
                      </button>
                  )}
              </div>
          </div>

          <div className="flex-1 flex overflow-hidden">
              {/* Left: Original Content */}
              <div className="flex-1 border-r border-[var(--border-default)] flex flex-col overflow-hidden">
                  <div className="px-4 py-2 bg-[var(--bg-surface)] border-b border-[var(--border-default)] text-[11px] text-[var(--text-secondary)] font-medium">
                      章节正文
                  </div>
                  <div className="flex-1 overflow-y-auto p-6 bg-[#0a0a0a]">
                      {currentChapter?.content ? (
                          <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-[var(--text-primary)] font-serif max-w-[600px] mx-auto">
                              {currentChapter.content}
                          </div>
                      ) : (
                          <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] opacity-50">
                              <FileText size={48} className="mb-4" />
                              <p>请先在“章节内容生成”中生成正文</p>
                          </div>
                      )}
                  </div>
              </div>

              {/* Right: Generated Script */}
              <div className="flex-1 flex flex-col overflow-hidden bg-[var(--bg-page)]">
                  <div className="px-4 py-2 bg-[var(--bg-surface)] border-b border-[var(--border-default)] text-[11px] text-[var(--text-secondary)] font-medium">
                      转换结果 (分镜剧本)
                  </div>
                  <div className="flex-1 overflow-y-auto p-6">
                      {converting ? (
                          <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)]">
                              <Loader2 size={32} className="animate-spin mb-4 text-[var(--gold-primary)]" />
                              <p>AI 正在分析剧情并拆解场景...</p>
                          </div>
                      ) : scenes ? (
                          <div className="flex flex-col gap-6 max-w-[600px] mx-auto pb-10">
                              {scenes.map((scene, idx) => (
                                  <div key={idx} className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg overflow-hidden animate-in fade-in slide-in-from-right-4 duration-300" style={{animationDelay: `${idx * 100}ms`}}>
                                      <div className="px-4 py-2 bg-[var(--bg-page)] border-b border-[var(--border-default)] flex items-center justify-between">
                                          <span className="text-[12px] font-bold text-[var(--gold-primary)]">场景 {scene.sceneNumber}</span>
                                          <Layout size={14} className="text-[var(--text-muted)]" />
                                      </div>
                                      <div className="p-4 flex flex-col gap-4">
                                          <div className="flex gap-3">
                                              <div className="w-1 h-auto bg-[var(--gold-primary)]/30 rounded-full shrink-0" />
                                              <p className="text-[13px] text-[var(--text-primary)] leading-relaxed italic">
                                                  {scene.description}
                                              </p>
                                          </div>
                                          
                                          {scene.dialogue.length > 0 && (
                                              <div className="flex flex-col gap-2 mt-2 pl-4">
                                                  {scene.dialogue.map((d, dIdx) => (
                                                      <div key={dIdx} className="flex gap-2 text-[13px]">
                                                          <span className="font-bold text-[var(--gold-primary)] shrink-0">{d.role}：</span>
                                                          <span className="text-[var(--text-secondary)]">{d.content}</span>
                                                      </div>
                                                  ))}
                                              </div>
                                          )}
                                      </div>
                                  </div>
                              ))}
                          </div>
                      ) : (
                          <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] opacity-50">
                              <Sparkles size={48} className="mb-4" />
                              <p>点击上方“开始转换”生成分镜剧本</p>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      </div>
    </div>
  );
}
