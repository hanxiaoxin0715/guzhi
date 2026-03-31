"use client";

import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { 
  Loader2, 
  BookOpen, 
  ChevronRight, 
  Save, 
  FileText,
  Copy,
  Check,
  PanelRightOpen,
  PanelRightClose,
  Sparkles,
  Users,
  Settings,
  History,
  Maximize2,
  Minimize2,
  PenTool,
  Type,
  Minus,
  Plus
} from "lucide-react";
import { getActiveNovelProject, updateNovelProject, type NovelProject, type Character } from "../../lib/novelProjects";
import { useRouter } from "next/navigation";
import GeneratingOverlay from "../../components/GeneratingOverlay";

// Dynamically import Editor to avoid SSR issues
const Editor = dynamic(() => import('./_components/Editor'), { 
  ssr: false,
  loading: () => <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">初始化编辑器...</div>
});

export default function NovelWritingPage() {
  const router = useRouter();
  const [project, setProject] = useState<NovelProject | null>(null);
  const [loading, setLoading] = useState(true);

  // Selection
  const [selectedVolumeIdx, setSelectedVolumeIdx] = useState<number>(0);
  const [selectedChapterIdx, setSelectedChapterIdx] = useState<number>(0);
  
  // Editor State
  const [content, setContent] = useState("");
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Sidebar State
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [rightPanelTab, setRightPanelTab] = useState<"outline" | "characters">("outline");
  const [fullScreen, setFullScreen] = useState(false);

  // Display Settings
  const [showDisplaySettings, setShowDisplaySettings] = useState(false);
  const [fontSize, setFontSize] = useState(18);
  const [lineHeight, setLineHeight] = useState(1.8);
  const [fontFamily, setFontFamily] = useState<"serif" | "sans" | "mono">("serif");

  // Auto-save timer
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initial load and chapter switch synchronization
  // Convert plain text to HTML paragraphs
  const convertToHtml = (text: string): string => {
    if (!text) return "";
    // If already contains HTML tags, return as-is
    if (text.includes('<p>') || text.includes('<br>')) return text;
    // Convert double newlines to paragraphs
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
    if (paragraphs.length === 0) return text;
    return paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  };

  useEffect(() => {
    getActiveNovelProject().then(p => {
      setProject(p);
      setLoading(false);
      
      // Load current chapter content if available
      if (p && p.outline && p.outline[selectedVolumeIdx]?.chapters[selectedChapterIdx]) {
        const currentChap = p.outline[selectedVolumeIdx].chapters[selectedChapterIdx];
        // Convert plain text to HTML paragraphs
        const formattedContent = convertToHtml(currentChap.content || "");
        setContent(formattedContent);
        setUnsavedChanges(false);
      }
    });

    // Load display settings
    try {
      const savedSettings = localStorage.getItem("novel-studio-display-settings");
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        if (parsed.fontSize) setFontSize(parsed.fontSize);
        if (parsed.lineHeight) setLineHeight(parsed.lineHeight);
        if (parsed.fontFamily) setFontFamily(parsed.fontFamily);
      }
    } catch (e) {
      console.error("Failed to load display settings", e);
    }
  }, [selectedVolumeIdx, selectedChapterIdx]);

  // Save settings when changed
  useEffect(() => {
    localStorage.setItem("novel-studio-display-settings", JSON.stringify({
      fontSize,
      lineHeight,
      fontFamily
    }));
  }, [fontSize, lineHeight, fontFamily]);

  // Ctrl+S 快捷保存
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (unsavedChanges && content) {
          handleSave(content);
        }
      }
      // ESC 退出全屏
      if (e.key === 'Escape' && fullScreen) {
        toggleFullScreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [unsavedChanges, content, fullScreen]);

  // Handle Chapter Selection Change
  const handleChapterSelect = (vIdx: number, cIdx: number) => {
      if (unsavedChanges) {
          if (!confirm("当前章节有未保存的修改，是否直接切换？切换后未保存内容将丢失。")) return;
      }
      
      setSelectedVolumeIdx(vIdx);
      setSelectedChapterIdx(cIdx);
      // Data loading will be handled by useEffect [selectedVolumeIdx, selectedChapterIdx]
  };

  // Handle Content Change
  const handleContentChange = (newContent: string) => {
      setContent(newContent);
      setUnsavedChanges(true);

      // Debounce Auto-save
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
          handleSave(newContent);
      }, 3000); // Auto-save after 3s idle
  };

  const handleSave = async (contentToSave: string = content) => {
      if (!project || !project.outline) return;
      
      setSaving(true);
      const newOutline = [...project.outline];
      
      // Update specific chapter content
      if (newOutline[selectedVolumeIdx]?.chapters[selectedChapterIdx]) {
          newOutline[selectedVolumeIdx].chapters[selectedChapterIdx].content = contentToSave;
          
          // Recalculate word count (strip HTML tags for accurate count)
          const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
          let totalWords = 0;
          newOutline.forEach(vol => {
              vol.chapters.forEach(ch => {
                  totalWords += stripHtml(ch.content || '').length;
              });
          });

          await updateNovelProject(project.id, { 
              outline: newOutline,
              words: totalWords
          });
          
          setProject(prev => prev ? ({ ...prev, outline: newOutline, words: totalWords }) : null);
          setUnsavedChanges(false);

          // Trigger Memory Extraction (Async)
          if (contentToSave.length > 500) {
              // Fire and forget
              fetch("/api/novel/memory/extract", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                      projectId: project.id,
                      chapterTitle: newOutline[selectedVolumeIdx].chapters[selectedChapterIdx].title,
                      content: contentToSave
                  })
              }).catch(e => console.error("Memory extraction trigger failed", e));
          }
      }
      setSaving(false);
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setFullScreen(true);
    } else {
      document.exitFullscreen();
      setFullScreen(false);
    }
  };

  const toggleEditorFullscreen = () => {
    // 切换编辑器专注模式（隐藏左右侧边栏）
    setFullScreen(!fullScreen);
  };

  if (loading) {
      return (
          <div className="flex items-center justify-center h-full">
              <div className="flex items-center gap-3 text-white/40">
                  <Loader2 size={20} className="animate-spin" />
                  <span className="text-[14px]">加载中...</span>
              </div>
          </div>
      );
  }

  if (!project) {
      return (
          <div className="flex flex-col items-center justify-center h-full gap-6">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-500/20 to-purple-500/20 flex items-center justify-center border border-white/10">
                  <BookOpen size={36} className="text-white/30" />
              </div>
              <p className="text-white/40 text-[14px]">请先在项目总览中选择一个项目</p>
              <button onClick={() => router.push("/novel")} className="px-6 py-2.5 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-400/30 hover:bg-amber-500/30 transition-all text-[13px] font-medium">
                  返回项目列表
              </button>
          </div>
      );
  }

  const currentChapter = project.outline?.[selectedVolumeIdx]?.chapters?.[selectedChapterIdx];
  const currentChapterPlotPoints = currentChapter?.detail?.plotPoints ?? currentChapter?.points ?? [];

  const getFontFamilyClass = () => {
    switch(fontFamily) {
        case "sans": return "font-sans";
        case "mono": return "font-mono";
        default: return "font-serif";
    }
  };

  return (
    <div className="flex h-full overflow-hidden bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f0f23]">
      {/* Left Sidebar: Navigation */}
      <div className={`w-[260px] flex flex-col h-full shrink-0 transition-all duration-500 ${fullScreen ? '-ml-[260px]' : ''}`}>
        <div className="p-5 flex items-center justify-between bg-white/5 backdrop-blur-sm border-b border-white/5">
            <h2 className="text-[15px] font-semibold text-white/90 truncate" title={project.title}>
                {project.title}
            </h2>
            <div className="text-[11px] text-white/40 bg-white/5 px-2.5 py-1 rounded-full">
                {(project.words / 10000).toFixed(1)}万字
            </div>
        </div>
        
        <div className="flex-1 overflow-y-auto py-3 px-2">
            {project.outline?.map((volume, vIdx) => (
                <div key={vIdx} className="flex flex-col mb-4">
                    <div className="px-3 py-2 text-[11px] font-medium text-white/30 uppercase tracking-wider sticky top-0 z-10">
                        {volume.title}
                    </div>
                    {volume.chapters.map((chapter, cIdx) => (
                        <button
                            key={cIdx}
                            onClick={() => handleChapterSelect(vIdx, cIdx)}
                            className={`flex items-center gap-3 px-3 py-2.5 text-left transition-all duration-200 rounded-lg mx-1 group ${
                                selectedVolumeIdx === vIdx && selectedChapterIdx === cIdx
                                ? "bg-gradient-to-r from-amber-500/20 to-transparent text-white border-l-2 border-l-amber-400"
                                : "text-white/50 hover:bg-white/5 hover:text-white/80 border-l-2 border-l-transparent"
                            }`}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full shrink-0 transition ${
                                chapter.content ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" : "bg-white/20 group-hover:bg-white/40"
                            }`} />
                            <span className="text-[13px] truncate">{chapter.title}</span>
                        </button>
                    ))}
                </div>
            ))}
        </div>
      </div>

      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col h-full relative">
          {/* Editor Toolbar */}
          <div className="h-[56px] bg-white/[0.02] backdrop-blur-md border-b border-white/5 flex items-center justify-between px-5 shrink-0 z-20">
              <div className="flex items-center gap-3 text-white/60 text-[13px]">
                  <span className="text-white/30">✦</span>
                  <span>{currentChapter?.title}</span>
                  {unsavedChanges && <span className="text-amber-400 text-[10px] bg-amber-400/10 px-2 py-0.5 rounded-full animate-pulse">未保存</span>}
                  {saving && <span className="text-white/40 text-[10px] flex items-center gap-1"><Loader2 size={10} className="animate-spin"/> 保存中...</span>}
              </div>
              
              <div className="flex items-center gap-1 relative">
                  <span className="text-[10px] text-white/30 mr-3">Ctrl+S</span>
                  
                  <button onClick={toggleEditorFullscreen} className={`p-2.5 rounded-lg transition-all duration-200 ${fullScreen ? 'text-amber-400 bg-amber-400/10' : 'text-white/50 hover:text-white hover:bg-white/10'}`} title="编辑器专注模式（隐藏侧边栏）">
                      {fullScreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>
                  
                  <button 
                    onClick={() => setShowDisplaySettings(!showDisplaySettings)} 
                    className={`p-2.5 rounded-lg transition-all duration-200 ${showDisplaySettings ? "text-amber-400 bg-amber-400/10" : "text-white/50 hover:text-white hover:bg-white/10"}`}
                    title="显示设置"
                  >
                      <Type size={16} />
                  </button>
                  
                  {showDisplaySettings && (
                      <div className="absolute top-full right-0 mt-3 w-[260px] bg-[#1e1e3f]/90 backdrop-blur-xl rounded-2xl shadow-2xl shadow-black/30 border border-white/10 p-5 flex flex-col gap-5 animate-in fade-in zoom-in-95 duration-200 z-50">
                          <div className="flex flex-col gap-2">
                              <label className="text-[11px] text-white/40 flex justify-between">
                                  字号 <span className="text-white/60">{fontSize}px</span>
                              </label>
                              <div className="flex items-center gap-3">
                                  <button onClick={() => setFontSize(Math.max(12, fontSize - 1))} className="p-1.5 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition"><Minus size={12} /></button>
                                  <input 
                                      type="range" min="12" max="32" step="1" 
                                      value={fontSize} 
                                      onChange={(e) => setFontSize(parseInt(e.target.value))}
                                      className="flex-1 accent-amber-400 h-1 bg-white/10 rounded-full"
                                  />
                                  <button onClick={() => setFontSize(Math.min(32, fontSize + 1))} className="p-1.5 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition"><Plus size={12} /></button>
                              </div>
                          </div>
                          
                          <div className="flex flex-col gap-2">
                              <label className="text-[11px] text-white/40 flex justify-between">
                                  行高 <span className="text-white/60">{lineHeight}</span>
                              </label>
                              <div className="flex items-center gap-3">
                                  <button onClick={() => setLineHeight(Math.max(1.0, lineHeight - 0.1))} className="p-1.5 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition"><Minus size={12} /></button>
                                  <input 
                                      type="range" min="1.0" max="3.0" step="0.1" 
                                      value={lineHeight} 
                                      onChange={(e) => setLineHeight(parseFloat(e.target.value))}
                                      className="flex-1 accent-amber-400 h-1 bg-white/10 rounded-full"
                                  />
                                  <button onClick={() => setLineHeight(Math.min(3.0, lineHeight + 0.1))} className="p-1.5 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 hover:text-white transition"><Plus size={12} /></button>
                              </div>
                          </div>
                          
                          <div className="flex flex-col gap-2">
                              <label className="text-[11px] text-white/40">字体</label>
                              <div className="grid grid-cols-3 gap-2">
                                  <button 
                                      onClick={() => setFontFamily("serif")}
                                      className={`px-3 py-2 text-[12px] rounded-lg font-serif transition-all ${fontFamily === "serif" ? "bg-amber-400/20 text-amber-400 border border-amber-400/30" : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"}`}
                                  >
                                      宋体
                                  </button>
                                  <button 
                                      onClick={() => setFontFamily("sans")}
                                      className={`px-3 py-2 text-[12px] rounded-lg font-sans transition-all ${fontFamily === "sans" ? "bg-amber-400/20 text-amber-400 border border-amber-400/30" : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"}`}
                                  >
                                      黑体
                                  </button>
                                  <button 
                                      onClick={() => setFontFamily("mono")}
                                      className={`px-3 py-2 text-[12px] rounded-lg font-mono transition-all ${fontFamily === "mono" ? "bg-amber-400/20 text-amber-400 border border-amber-400/30" : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"}`}
                                  >
                                      等宽
                                  </button>
                              </div>
                          </div>
                      </div>
                  )}

                  <button onClick={() => setShowRightPanel(!showRightPanel)} className="p-2.5 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-all duration-200" title="切换右侧面板">
                      {showRightPanel ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                  </button>
              </div>
          </div>

          {/* Editor */}
          <div className="flex-1 overflow-y-auto bg-gradient-to-b from-transparent via-[#0a0a0a]/50 to-transparent flex justify-center cursor-text">
              <div className="w-full max-w-4xl px-8 py-12">
                  <Editor 
                      content={content}
                      onUpdate={handleContentChange}
                      project={project}
                      fontSize={fontSize}
                      lineHeight={lineHeight}
                      fontFamily={fontFamily}
                  />
              </div>
          </div>
          
          {/* Status Bar */}
          <div className="h-[28px] bg-white/[0.02] backdrop-blur-sm border-t border-white/5 flex items-center justify-between px-5 text-[10px] text-white/30 shrink-0">
               <span>{content ? content.replace(/<[^>]*>/g, '').length : 0} 字</span>
               <span>Reading Time: {Math.ceil((content?.replace(/<[^>]*>/g, '').length || 0) / 500)} min</span>
          </div>
      </div>

      {/* Right Panel: Context & Tools */}
      {!fullScreen && (
          <div className="w-[360px] flex flex-col h-full shrink-0 animate-in slide-in-from-right-10 duration-300 bg-gradient-to-l from-white/[0.03] to-transparent border-l border-white/5 z-10">
              {/* Tabs */}
              <div className="flex items-center px-2 pt-3 gap-1">
                  <button 
                    onClick={() => setRightPanelTab("outline")}
                    className={`flex-1 py-3 text-[13px] font-medium transition-all duration-200 rounded-xl ${rightPanelTab === "outline" ? "bg-amber-400/15 text-amber-400 shadow-lg shadow-amber-400/10" : "text-white/40 hover:text-white/70 hover:bg-white/5"}`}
                  >
                      本章细纲
                  </button>
                  <button 
                    onClick={() => setRightPanelTab("characters")}
                    className={`flex-1 py-3 text-[13px] font-medium transition-all duration-200 rounded-xl ${rightPanelTab === "characters" ? "bg-amber-400/15 text-amber-400 shadow-lg shadow-amber-400/10" : "text-white/40 hover:text-white/70 hover:bg-white/5"}`}
                  >
                      角色资料
                  </button>
              </div>

              {/* Panel Content */}
              <div className="flex-1 overflow-y-auto p-4">
                  {rightPanelTab === "outline" && (
                      <div className="flex flex-col gap-4">
                          <div className="p-5 bg-gradient-to-br from-amber-500/10 to-transparent rounded-2xl border border-amber-400/20 backdrop-blur-sm">
                              <h3 className="text-[12px] font-medium text-amber-400/80 mb-3 flex items-center gap-2">
                                  <FileText size={13} />
                                  章节简介
                              </h3>
                              <p className="text-[14px] text-white/70 leading-relaxed font-serif">
                                  {currentChapter?.summary || "暂无简介"}
                              </p>
                          </div>
                          
                          <div className="flex flex-col gap-3">
                              <h3 className="text-[12px] font-medium text-white/40 mb-2 flex items-center justify-between">
                                  <span className="flex items-center gap-2"><History size={13} /> 剧情细纲</span>
                                  <button onClick={() => router.push("/novel/outline")} className="text-amber-400/70 hover:text-amber-400 text-[11px] transition-colors">去修改</button>
                              </h3>
                              {currentChapterPlotPoints.length > 0 ? (
                                  <div className="flex flex-col gap-2.5">
                                      {currentChapterPlotPoints.map((p: string, i: number) => (
                                          <div key={i} className="flex gap-3 text-[13px] p-4 bg-white/[0.02] rounded-xl border border-white/5 hover:border-amber-400/20 hover:bg-white/[0.04] transition-all duration-200">
                                              <span className="text-amber-400/60 font-medium shrink-0 min-w-[20px]">{i+1}</span>
                                              <span className="text-white/60 leading-normal">{p}</span>
                                          </div>
                                      ))}
                                  </div>
                              ) : (
                                  <div className="text-center py-14 text-white/30 text-[13px] border border-dashed border-white/10 rounded-2xl bg-white/[0.02]">
                                      暂无细纲
                                  </div>
                              )}
                          </div>
                      </div>
                  )}

                  {rightPanelTab === "characters" && (
                      <div className="flex flex-col gap-3">
                          <h3 className="text-[12px] font-medium text-white/40 mb-1 flex items-center gap-2">
                              <Users size={13} /> 登场角色
                          </h3>
                          {project.characters && project.characters.length > 0 ? (
                              project.characters.map(char => (
                                  <div key={char.id} className="p-4 bg-white/[0.02] rounded-2xl border border-white/5 hover:border-amber-400/30 hover:bg-white/[0.04] transition-all duration-200 cursor-pointer group">
                                      <div className="flex items-center justify-between mb-3">
                                          <span className="font-medium text-[15px] text-white/80 group-hover:text-amber-400 transition-colors">{char.name}</span>
                                          <span className="text-[10px] px-2.5 py-1 bg-amber-400/10 rounded-full text-amber-400/80 border border-amber-400/20">{char.role}</span>
                                      </div>
                                      <div className="text-[12px] text-white/40 line-clamp-3 leading-relaxed">
                                          <span className="text-white/30">性格:</span> {char.personality}
                                          <br/>
                                          <span className="text-white/30">外貌:</span> {char.appearance}
                                      </div>
                                  </div>
                              ))
                          ) : (
                              <div className="text-center py-20 text-white/25 flex flex-col items-center gap-4 border border-dashed border-white/10 rounded-2xl bg-white/[0.02]">
                                  <Users size={36} className="opacity-20"/>
                                  <p className="text-[13px]">暂无角色资料</p>
                                  <button onClick={() => router.push("/novel/characters")} className="text-amber-400/70 text-[13px] font-medium hover:text-amber-400 transition-colors">去添加角色</button>
                              </div>
                          )}
                      </div>
                  )}
              </div>
          </div>
      )}
    </div>
  );
}
