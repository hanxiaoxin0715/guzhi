"use client";

import { useState, useEffect } from "react";
import { 
  Plus, 
  Search, 
  BookOpen, 
  Loader2,
  Archive,
  RotateCcw,
  Trash2,
  X,
  ChevronUp,
  ChevronDown,
  Edit3,
  User,
  Users,
  Sparkles,
  RefreshCw,
  AlignLeft,
  FileText
} from "lucide-react";
import { loadNovelProjects, createNovelProject, deleteNovelProject, setActiveNovelProjectId, updateNovelProject, type NovelProject } from "../lib/novelProjects";
import { useRouter } from "next/navigation";
import GeneratingOverlay from "../components/GeneratingOverlay";

export default function NovelProjectOverview() {
  const router = useRouter();
  const [projects, setProjects] = useState<NovelProject[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"working" | "archived">("working");
  
  // New Project Form State
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newTags, setNewTags] = useState("");
  const [creating, setCreating] = useState(false);
  const [creatingRandom, setCreatingRandom] = useState(false);

  // Sub-item Modal
  const [showSubModal, setShowSubModal] = useState(false);
  const [parentProject, setParentProject] = useState<NovelProject | null>(null);
  const [subTitle, setSubTitle] = useState("");
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadNovelProjects().then(p => {
      setProjects(p);
      setLoading(false);
    });
  }, []);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
        const tags = newTags.split(/[,，]/).map(t => t.trim()).filter(Boolean);
        const p = await createNovelProject(newTitle, newDesc, tags);
        setProjects(prev => [p, ...prev]);
        setShowNewModal(false);
        setNewTitle("");
        setNewDesc("");
        setNewTags("");
    } catch (e) {
        alert("创建失败");
    } finally {
        setCreating(false);
    }
  };

  const handleRandomConcept = async () => {
      setCreatingRandom(true);
      try {
          const res = await fetch("/api/novel/random-concept", { method: "POST" });
          if (!res.ok) {
              throw new Error(`生成失败: ${res.status}`);
          }
          
          const data = await res.json();
          
          // Redirect to outline page with pre-filled data
          const params = new URLSearchParams({
              title: data.title,
              tags: data.tags.join("、"),
              description: data.description
          });
          
          router.push(`/novel/outline?${params.toString()}`);
          
      } catch (e: any) {
          console.error(e);
          alert(e.message || "创意生成失败，请重试");
      } finally {
          setCreatingRandom(false);
      }
  };

  const handleCreateSub = async () => {
      if (!parentProject || !subTitle.trim()) return;
      setCreating(true);
      try {
          const p = await createNovelProject(subTitle, `「${parentProject.title}」的续篇/子项`, parentProject.tags, undefined, parentProject.id);
          setProjects(prev => [p, ...prev]);
          setShowSubModal(false);
          setSubTitle("");
          setParentProject(null);
          // Auto-expand the parent
          setExpandedParents(prev => new Set(prev).add(parentProject.id));
      } catch (e) {
          alert("创建失败");
      } finally {
          setCreating(false);
      }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if(!confirm("确定删除该项目吗？此操作不可恢复。")) return;
      await deleteNovelProject(id);
      setProjects(prev => prev.filter(p => p.id !== id));
  }
  
  const handleArchive = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if(!confirm("确定归档该项目吗？归档后项目将移动到“已归档”列表。")) return;
      // We use '完结' as archived status for now based on available types
      await updateNovelProject(id, { status: "完结" });
      setProjects(prev => prev.map(p => p.id === id ? { ...p, status: "完结" } : p));
  }

  const handleRestore = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      // Restore to '连载中'
      await updateNovelProject(id, { status: "连载中" });
      setProjects(prev => prev.map(p => p.id === id ? { ...p, status: "连载中" } : p));
  }

  const handleEnterProject = async (id: string) => {
      await setActiveNovelProjectId(id);
      router.push("/novel/outline");
  }

  const toggleExpand = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setExpandedParents(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
      });
  }

  // Filter projects based on tab and search
  const filteredProjects = projects.filter(p => {
    const matchesSearch = p.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesTab = activeTab === "working" ? p.status !== "完结" : p.status === "完结";
    return matchesSearch && matchesTab;
  });

  // Flat tree for rendering
  const displayProjects = [];
  const roots = filteredProjects.filter(p => !p.parentId || !projects.some(p2 => p2.id === p.parentId));
  
  for (const root of roots) {
      displayProjects.push({ ...root, level: 0 });
      if (expandedParents.has(root.id)) {
          const children = filteredProjects.filter(p => p.parentId === root.id);
          for (const child of children) {
              displayProjects.push({ ...child, level: 1 });
          }
      }
  }

  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#0a0a0a] text-[#ededed]">
      <GeneratingOverlay
        open={creatingRandom}
        title="正在生成随机创意"
        detail="请稍候，页面已锁定以防误操作"
      />
      {/* Header Title */}
      <div className="flex items-center justify-between px-8 py-6 shrink-0 border-b border-[#1f1f1f]">
          <div className="flex flex-col gap-1">
            <h1 className="text-[24px] font-serif font-bold text-[#ededed] flex items-center gap-2 tracking-wide">
                项目总览
            </h1>
          </div>
          <button 
            onClick={() => setShowNewModal(true)}
            className="btn-primary"
          >
              <Plus size={16} />
              新建项目
          </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="max-w-[1200px] mx-auto p-8 flex flex-col gap-8">
              
              {/* Stats Cards */}
              <div className="grid grid-cols-4 gap-4">
                  {[
                      { label: "卷数", value: "0", icon: BookOpen },
                      { label: "章节", value: "0", icon: FileText },
                      { label: "总字数", value: "0", icon: FileText }, // Using FileText as placeholder for Word Count icon
                      { label: "角色", value: "0", icon: Users }
                  ].map((stat, idx) => (
                      <div key={idx} className="bg-[#0d0d0d] border border-[#1f1f1f] rounded p-6 flex items-center gap-4 hover:border-[#333] transition group">
                          <div className="w-12 h-12 rounded bg-[#141414] flex items-center justify-center text-[#e8c060] border border-[#2a2a2a] group-hover:border-[#e8c060]/30 transition">
                              <stat.icon size={20} />
                          </div>
                          <div className="flex flex-col">
                              <span className="text-[24px] font-bold text-[#ededed] font-mono">{stat.value}</span>
                              <span className="text-[12px] text-[#666]">{stat.label}</span>
                          </div>
                      </div>
                  ))}
              </div>

              {/* Quick Actions */}
              <div className="flex items-center gap-3">
                  {[
                      { label: "生成大纲", icon: Sparkles, path: "/novel/outline" },
                      { label: "写作工作台", icon: Edit3, path: "/novel/writing" },
                      { label: "角色管理", icon: Users, path: "/novel/characters" },
                      { label: "剧本转换", icon: RefreshCw, path: "/novel/script" }
                  ].map((action, idx) => (
                      <button 
                        key={idx}
                        onClick={() => router.push(action.path)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-[#0d0d0d] border border-[#1f1f1f] rounded text-[13px] text-[#999] hover:text-[#ededed] hover:border-[#444] transition"
                      >
                          <action.icon size={14} />
                          {action.label}
                      </button>
                  ))}
              </div>

              {/* Project List */}
              <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between text-[12px] text-[#666] mb-2">
                      <span>全部项目 ({projects.length})</span>
                  </div>

                  {projects.map(project => (
                      <div 
                        key={project.id}
                        onClick={() => handleEnterProject(project.id)}
                        className="group relative bg-[#0d0d0d] border border-[#1f1f1f] rounded-lg p-6 hover:border-[#e8c060]/50 transition cursor-pointer flex items-center justify-between"
                      >
                          <div className="flex flex-col gap-3">
                              <div className="flex items-center gap-3">
                                  <h3 className="text-[16px] font-bold text-[#ededed] group-hover:text-[#e8c060] transition">{project.title}</h3>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${project.status === '完结' ? 'bg-green-900/20 text-green-500 border-green-900/30' : 'bg-[#e8c060]/10 text-[#e8c060] border-[#e8c060]/20'}`}>
                                      {project.status || "大纲中"}
                                  </span>
                              </div>
                              <div className="flex items-center gap-4 text-[12px] text-[#666] font-mono">
                                  <span className="flex items-center gap-1.5"><BookOpen size={12}/> {project.outline?.length || 0} 卷</span>
                                  <span className="flex items-center gap-1.5"><FileText size={12}/> {project.chapters || 0} 章</span>
                                  <span className="flex items-center gap-1.5"><AlignLeft size={12}/> 0 字</span>
                                  <span className="flex items-center gap-1.5"><Users size={12}/> {project.characters?.length || 0} 角色</span>
                              </div>
                          </div>

                          <div className="flex flex-col items-end gap-3">
                              <div className="flex gap-2">
                                  {project.tags.map(tag => (
                                      <span key={tag} className="text-[11px] text-[#444] bg-[#141414] px-2 py-1 rounded border border-[#1f1f1f]">
                                          {tag}
                                      </span>
                                  ))}
                              </div>
                              <div className="opacity-0 group-hover:opacity-100 transition flex items-center gap-2">
                                  <button 
                                    onClick={(e) => handleDelete(project.id, e)}
                                    className="p-2 text-[#444] hover:text-red-500 transition"
                                    title="删除项目"
                                  >
                                      <Trash2 size={14} />
                                  </button>
                              </div>
                          </div>
                      </div>
                  ))}

                  {projects.length === 0 && (
                      <div className="py-20 flex flex-col items-center justify-center text-[#333] border border-dashed border-[#1f1f1f] rounded-lg">
                          <BookOpen size={40} className="mb-4 opacity-50" />
                          <p className="text-[13px]">暂无项目，点击右上角新建</p>
                      </div>
                  )}
              </div>
          </div>
      </div>

      {/* New Project Modal */}
      {showNewModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
              <div className="w-[500px] bg-[#0a0a0a] border border-[#1f1f1f] shadow-2xl rounded-lg flex flex-col animate-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between p-5 border-b border-[#1f1f1f]">
                      <h2 className="text-[16px] font-bold text-[#ededed]">新建小说项目</h2>
                      <button onClick={() => setShowNewModal(false)} className="text-[#666] hover:text-[#ededed] transition">
                          <X size={18} />
                      </button>
                  </div>
                  
                  {/* AI Random Generator */}
                  <div className="px-6 pt-6">
                      <button 
                          onClick={handleRandomConcept}
                          disabled={creatingRandom}
                          className="btn-primary w-full py-3 bg-gradient-to-r from-[#C9A962] to-[#8A6E2F] text-[#000]"
                      >
                          {creatingRandom ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} className="group-hover:rotate-12 transition" />}
                          AI 智能创建 · 随机热门题材
                      </button>
                  </div>
                  
                  {creating && (
                      <div className="p-4 bg-[#e8c060]/5 border-b border-[#e8c060]/10 flex items-center justify-center text-[#e8c060] text-[12px] gap-2 animate-pulse">
                          <Sparkles size={14} />
                          AI 正在构思创意...
                      </div>
                  )}

                  <div className="flex items-center gap-4 my-2 px-6">
                      <div className="h-[1px] flex-1 bg-[#2a2a2a]"></div>
                      <span className="text-[12px] text-[#666]">或手动创建</span>
                      <div className="h-[1px] flex-1 bg-[#2a2a2a]"></div>
                  </div>

                  <div className="px-6 pb-6 flex flex-col gap-6">
                      <div className="flex flex-col gap-2">
                          <label className="text-[12px] text-[#666]">小说名称 <span className="text-red-500">*</span></label>
                          <input 
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            placeholder="例如：都市之巅峰强者"
                            className="px-4 py-3 bg-[#141414] border border-[#2a2a2a] rounded text-[14px] text-[#ededed] outline-none focus:border-[#e8c060]/50 transition"
                          />
                      </div>
                      <div className="flex flex-col gap-2">
                          <label className="text-[12px] text-[#666]">题材类型</label>
                          <input 
                            value={newTags}
                            onChange={(e) => setNewTags(e.target.value)}
                            placeholder="例如：都市、玄幻、科幻、悬疑..."
                            className="px-4 py-3 bg-[#141414] border border-[#2a2a2a] rounded text-[14px] text-[#ededed] outline-none focus:border-[#e8c060]/50 transition"
                          />
                      </div>
                      <div className="flex flex-col gap-2">
                          <label className="text-[12px] text-[#666]">故事梗概</label>
                          <textarea 
                            value={newDesc}
                            onChange={(e) => setNewDesc(e.target.value)}
                            placeholder="故事简介、核心冲突、主角设定..."
                            className="px-4 py-3 bg-[#141414] border border-[#2a2a2a] rounded text-[14px] text-[#ededed] outline-none focus:border-[#e8c060]/50 transition min-h-[120px] resize-none"
                          />
                      </div>
                  </div>
                  <div className="px-6 py-5 border-t border-[#1f1f1f] flex items-center justify-end gap-3 bg-[#0a0a0a]">
                      <button 
                        onClick={() => setShowNewModal(false)}
                        className="btn-ghost"
                      >
                          取消
                      </button>
                      <button 
                        onClick={handleCreate}
                        disabled={creating || !newTitle.trim()}
                        className="btn-primary px-6 py-2 text-[12px]"
                      >
                          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                          创建项目
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Sub-item Modal */}
      {showSubModal && parentProject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
              <div className="w-[440px] bg-[#141414] border border-[#2a2a2a] shadow-2xl rounded-sm flex flex-col animate-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between p-5 border-b border-[#2a2a2a]">
                      <h2 className="text-[16px] font-bold text-[#ededed]">新增子项 / 续篇</h2>
                      <button onClick={() => setShowSubModal(false)} className="text-[#666] hover:text-[#ededed] transition">
                          <X size={18} />
                      </button>
                  </div>
                  <div className="p-6 flex flex-col gap-4">
                      <p className="text-[13px] text-[#999]">
                          正在为项目 <strong className="text-[#e8c060]">“{parentProject.title}”</strong> 创建关联子项。
                      </p>
                      <div className="flex flex-col gap-2">
                          <label className="text-[12px] text-[#999]">子项名称 <span className="text-red-500">*</span></label>
                          <input 
                            value={subTitle}
                            onChange={(e) => setSubTitle(e.target.value)}
                            placeholder="例如：第二部、外传、番外..."
                            className="px-3 py-2.5 bg-[#0a0a0a] border border-[#2a2a2a] rounded-sm text-[14px] text-[#ededed] outline-none focus:border-[#e8c060] transition"
                            autoFocus
                          />
                      </div>
                  </div>
                  <div className="p-5 border-t border-[#2a2a2a] flex items-center justify-end gap-3 bg-[#141414]">
                      <button 
                        onClick={() => setShowSubModal(false)}
                        className="btn-ghost"
                      >
                          取消
                      </button>
                      <button 
                        onClick={handleCreateSub}
                        disabled={creating || !subTitle.trim()}
                        className="btn-primary px-6 py-2 text-[12px]"
                      >
                          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                          确认创建
                      </button>
                  </div>
              </div>
          </div>
      )}
    </main>
  );
}
