"use client";

import { useState, useEffect } from "react";
import { 
  Users, 
  Loader2, 
  BookOpen, 
  Plus, 
  Search, 
  X, 
  Save, 
  Trash2,
  Edit,
  User,
  MoreVertical,
  RefreshCw,
  Sparkles
} from "lucide-react";
import { getActiveNovelProject, updateNovelProject, type NovelProject, type Character } from "../../lib/novelProjects";
import { useRouter } from "next/navigation";
import GeneratingOverlay from "../../components/GeneratingOverlay";

export default function NovelCharactersPage() {
  const router = useRouter();
  const [project, setProject] = useState<NovelProject | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Characters State
  const [characters, setCharacters] = useState<Character[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingChar, setEditingChar] = useState<Character | null>(null);

  // Sync State
  const [syncing, setSyncing] = useState(false);

  // Form State
  const [formData, setFormData] = useState<Partial<Character>>({});

  useEffect(() => {
    getActiveNovelProject().then(p => {
      setProject(p);
      if (p) {
          setCharacters(p.characters || []);
      }
      setLoading(false);
    });
  }, []);

  const filteredCharacters = characters.filter(c => 
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      c.role.includes(searchQuery)
  );

  const openModal = (char?: Character) => {
      if (char) {
          setEditingChar(char);
          setFormData({ ...char });
      } else {
          setEditingChar(null);
          setFormData({
              role: "配角",
              gender: "未知"
          });
      }
      setShowModal(true);
  };

  const handleSave = async () => {
      if (!project || !formData.name) return;

      const newChar: Character = {
          id: editingChar?.id || `char_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: formData.name,
          role: formData.role || "配角",
          gender: formData.gender || "未知",
          age: formData.age,
          personality: formData.personality,
          appearance: formData.appearance,
          background: formData.background,
          avatar: formData.avatar
      } as Character;

      let newCharacters = [...characters];
      
      if (editingChar) {
          const idx = newCharacters.findIndex(c => c.id === editingChar.id);
          if (idx !== -1) newCharacters[idx] = newChar;
      } else {
          newCharacters.push(newChar);
      }

      await updateNovelProject(project.id, { characters: newCharacters });
      setCharacters(newCharacters);
      setProject({ ...project, characters: newCharacters });
      setShowModal(false);
  };

  const handleDelete = async (id: string) => {
      if (!project || !confirm("确定删除该角色吗？")) return;
      const newCharacters = characters.filter(c => c.id !== id);
      await updateNovelProject(project.id, { characters: newCharacters });
      setCharacters(newCharacters);
      setProject({ ...project, characters: newCharacters });
  };

  const handleSyncFromOutlines = async () => {
      if (!project || !project.outline) return;
      
      if (!confirm("确定要从当前大纲中智能提取角色信息吗？")) return;

      setSyncing(true);
      try {
          // 1. Gather all text content from outline
          let fullText = "";
          project.outline.forEach(vol => {
              fullText += `【${vol.title}】\n`;
              vol.chapters.forEach(ch => {
                  fullText += `${ch.title}\n${ch.summary}\n`;
                  if (ch.detail?.characters) {
                      fullText += `涉及人物：${ch.detail.characters.join("，")}\n`;
                  }
              });
          });

          // 2. Call AI to extract characters
          const res = await fetch("/api/ai/chat", { // Reuse chat API or create specific one
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                  prompt: `你是一个专业的文学助手。请分析以下小说大纲，提取所有出现的角色信息。
请以 JSON 格式返回，不要包含其他文字。
JSON 结构如下：
[
  {
    "name": "角色名",
    "role": "主角" | "配角" | "反派" | "龙套",
    "gender": "男" | "女" | "未知",
    "age": "推测年龄或修为",
    "personality": "性格关键词",
    "background": "简要背景或人际关系"
  }
]

小说大纲内容：
${fullText.slice(0, 15000)}`
              })
          });

          if (!res.ok) throw new Error("AI 提取失败");
          
          const data = await res.json();
          let extractedChars: any[] = [];
          const raw = (data?.result || "").toString();
          const pickJson = (s: string) => {
              let t = s.trim();
              const match = t.match(/```json\s*([\s\S]*?)\s*```/) || t.match(/```\s*([\s\S]*?)\s*```/);
              if (match) t = match[1].trim();
              const firstArr = t.indexOf("[");
              const lastArr = t.lastIndexOf("]");
              if (firstArr >= 0 && lastArr > firstArr) t = t.slice(firstArr, lastArr + 1);
              t = t.replace(/,(\s*[\]}])/g, "$1");
              return t.trim();
          };
          try {
              const jsonStr = pickJson(raw);
              extractedChars = JSON.parse(jsonStr);
          } catch (e) {
              console.error("JSON Parse Error", e, { raw });
              alert("AI 返回内容不是合法 JSON（请在设置里关闭 Mock LLM 或检查模型/提示词）。");
              return;
          }

          // 3. Merge with existing characters
          let newCharsFound: Character[] = [];
          
          if (Array.isArray(extractedChars)) {
              extractedChars.forEach(info => {
                  if (!info.name) return;
                  
                  // Check existence
                  const exists = project.characters?.some(c => c.name === info.name) || 
                               newCharsFound.some(c => c.name === info.name);
                  
                  if (!exists) {
                      newCharsFound.push({
                          id: `char_ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                          name: info.name,
                          role: info.role || "配角",
                          gender: info.gender || "未知",
                          age: info.age,
                          personality: info.personality,
                          background: info.background
                      } as Character);
                  }
              });
          }

          if (newCharsFound.length === 0) {
              alert("AI 未发现新角色，或角色已存在。");
          } else {
              const updatedChars = [...(project.characters || []), ...newCharsFound];
              await updateNovelProject(project.id, { characters: updatedChars });
              setCharacters(updatedChars);
              setProject({ ...project, characters: updatedChars });
              alert(`成功从大纲提取并同步了 ${newCharsFound.length} 个新角色！`);
          }

      } catch (e) {
          console.error(e);
          alert("提取失败，请重试");
      } finally {
          setSyncing(false);
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
              <button 
                onClick={() => router.push("/novel")}
                className="px-4 py-2 bg-[var(--gold-primary)] text-[#0A0A0A] rounded hover:brightness-110 transition"
              >
                  返回项目列表
              </button>
          </div>
      );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden p-8 gap-6">
      <GeneratingOverlay
        open={syncing}
        title="正在提取角色"
        detail="请稍候，页面已锁定以防误操作"
      />
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
          <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-serif font-medium text-[var(--text-primary)]">角色管理</h1>
              <p className="text-[13px] text-[var(--text-secondary)]">
                  当前项目：{project.title} · 共 {characters.length} 个角色
              </p>
          </div>
          <div className="flex gap-3">
              <button 
                onClick={handleSyncFromOutlines}
                disabled={syncing}
                className="btn-secondary"
                title="扫描所有章节细纲，提取未录入的角色"
              >
                  {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  从大纲获取角色
              </button>
              <button 
                onClick={() => openModal()}
                className="btn-primary"
              >
                  <Plus size={16} />
                  添加角色
              </button>
          </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-4 shrink-0">
          <div className="relative w-[300px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input 
                  type="text" 
                  placeholder="搜索角色姓名或身份..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
              />
          </div>
      </div>

      {/* Character Grid */}
      <div className="flex-1 overflow-y-auto">
          {filteredCharacters.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] opacity-50">
                  <Users size={48} className="mb-4" />
                  <p>暂无角色数据，点击右上角添加或从细纲同步</p>
              </div>
          ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-10">
                  {filteredCharacters.map(char => (
                      <div key={char.id} className="group bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-lg p-5 hover:border-[var(--gold-primary)]/50 transition flex flex-col gap-4 relative">
                          <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition flex gap-2">
                              <button 
                                onClick={() => openModal(char)}
                                className="p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-page)] rounded transition"
                              >
                                  <Edit size={14} />
                              </button>
                              <button 
                                onClick={() => handleDelete(char.id)}
                                className="p-1.5 text-[var(--text-secondary)] hover:text-red-400 hover:bg-red-500/10 rounded transition"
                              >
                                  <Trash2 size={14} />
                              </button>
                          </div>

                          <div className="flex items-start gap-4">
                              <div className="w-12 h-12 rounded-full bg-[var(--bg-page)] border border-[var(--border-default)] flex items-center justify-center text-[var(--text-secondary)] shrink-0 overflow-hidden">
                                  {char.avatar ? <img src={char.avatar} alt={char.name} className="w-full h-full object-cover" /> : <User size={20} />}
                              </div>
                              <div className="flex flex-col gap-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                      <h3 className="text-[16px] font-medium text-[var(--text-primary)] truncate">{char.name}</h3>
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                                          char.role === '主角' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' : 
                                          char.role === '反派' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 
                                          'bg-[var(--bg-page)] text-[var(--text-secondary)] border-[var(--border-default)]'
                                      }`}>
                                          {char.role}
                                      </span>
                                  </div>
                                  <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                                      <span>{char.gender}</span>
                                      {char.age && <span>· {char.age}</span>}
                                  </div>
                              </div>
                          </div>
                          
                          {(char.personality || char.appearance || char.background) && (
                              <div className="flex flex-col gap-2 pt-3 border-t border-[var(--border-subtle)] text-[12px] text-[var(--text-secondary)]">
                                  {char.personality && (
                                      <p className="line-clamp-1"><span className="text-[var(--text-muted)]">性格：</span>{char.personality}</p>
                                  )}
                                  {char.appearance && (
                                      <p className="line-clamp-1"><span className="text-[var(--text-muted)]">外貌：</span>{char.appearance}</p>
                                  )}
                                  {char.background && (
                                      <p className="line-clamp-2 mt-1 text-[var(--text-muted)]">{char.background}</p>
                                  )}
                              </div>
                          )}
                      </div>
                  ))}
              </div>
          )}
      </div>

      {/* Edit/Add Modal */}
      {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
              <div className="w-[600px] max-h-full bg-[var(--bg-page)] border border-[var(--border-default)] shadow-2xl rounded-lg flex flex-col animate-in zoom-in-95 duration-200">
                  <div className="flex items-center justify-between p-5 border-b border-[var(--border-default)] bg-[var(--bg-surface)] rounded-t-lg">
                      <h2 className="text-[16px] font-medium text-[var(--text-primary)]">
                          {editingChar ? "编辑角色" : "添加新角色"}
                      </h2>
                      <button onClick={() => setShowModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition">
                          <X size={18} />
                      </button>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">
                      <div className="grid grid-cols-2 gap-5">
                          <div className="flex flex-col gap-2">
                              <label className="text-[12px] text-[var(--text-secondary)]">姓名 <span className="text-red-400">*</span></label>
                              <input 
                                  value={formData.name || ""}
                                  onChange={e => setFormData({...formData, name: e.target.value})}
                                  placeholder="角色姓名"
                                  className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
                              />
                          </div>
                          <div className="flex flex-col gap-2">
                              <label className="text-[12px] text-[var(--text-secondary)]">身份类型</label>
                              <select 
                                  value={formData.role || "配角"}
                                  onChange={e => setFormData({...formData, role: e.target.value as any})}
                                  className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
                              >
                                  <option value="主角">主角</option>
                                  <option value="配角">配角</option>
                                  <option value="反派">反派</option>
                                  <option value="龙套">龙套</option>
                              </select>
                          </div>
                      </div>

                      <div className="grid grid-cols-2 gap-5">
                          <div className="flex flex-col gap-2">
                              <label className="text-[12px] text-[var(--text-secondary)]">性别</label>
                              <select 
                                  value={formData.gender || "未知"}
                                  onChange={e => setFormData({...formData, gender: e.target.value as any})}
                                  className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
                              >
                                  <option value="男">男</option>
                                  <option value="女">女</option>
                                  <option value="未知">未知</option>
                              </select>
                          </div>
                          <div className="flex flex-col gap-2">
                              <label className="text-[12px] text-[var(--text-secondary)]">年龄/修为</label>
                              <input 
                                  value={formData.age || ""}
                                  onChange={e => setFormData({...formData, age: e.target.value})}
                                  placeholder="例如：18岁，金丹期"
                                  className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
                              />
                          </div>
                      </div>

                      <div className="flex flex-col gap-2">
                          <label className="text-[12px] text-[var(--text-secondary)]">性格特征</label>
                          <input 
                              value={formData.personality || ""}
                              onChange={e => setFormData({...formData, personality: e.target.value})}
                              placeholder="例如：腹黑，冷静，热血..."
                              className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
                          />
                      </div>

                      <div className="flex flex-col gap-2">
                          <label className="text-[12px] text-[var(--text-secondary)]">外貌描写</label>
                          <textarea 
                              value={formData.appearance || ""}
                              onChange={e => setFormData({...formData, appearance: e.target.value})}
                              placeholder="例如：身穿白衣，剑眉星目..."
                              className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition resize-none h-[80px]"
                          />
                      </div>

                      <div className="flex flex-col gap-2">
                          <label className="text-[12px] text-[var(--text-secondary)]">背景故事/备注</label>
                          <textarea 
                              value={formData.background || ""}
                              onChange={e => setFormData({...formData, background: e.target.value})}
                              placeholder="人物生平、特殊能力、伏笔..."
                              className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition resize-none h-[100px]"
                          />
                      </div>
                  </div>

                  <div className="p-5 border-t border-[var(--border-default)] flex items-center justify-end gap-3 bg-[var(--bg-surface)] rounded-b-lg">
                      <button 
                          onClick={() => setShowModal(false)}
                          className="btn-ghost"
                      >
                          取消
                      </button>
                      <button 
                          onClick={handleSave}
                          disabled={!formData.name}
                          className="btn-primary"
                      >
                          <Save size={14} />
                          保存角色
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
