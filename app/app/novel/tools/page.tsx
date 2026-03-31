"use client";

import { useState, useEffect } from "react";
import { 
  Wrench, 
  Sparkles, 
  FileText, 
  Search, 
  History, 
  Tags, 
  Save, 
  Loader2,
  Eraser,
  ListChecks,
  Wand2,
  Copy,
  Check,
  ArrowRight,
  RefreshCw
} from "lucide-react";

interface PromptTemplate {
    id: string;
    title: string;
    description: string;
    icon: any;
    category: "ai_prompts" | "ai_tools";
    defaultValue: string;
}

interface AIToolConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
}

const AI_TOOLS: PromptTemplate[] = [
    {
        id: "ai-remove-trace",
        title: "AI 消痕工具",
        description: "消除AI生成内容的机器味，让文字更自然流畅",
        icon: Eraser,
        category: "ai_tools",
        defaultValue: ""
    },
    {
        id: "ai-adjectives",
        title: "形容词挖掘",
        description: "批量生成高质量形容词，用于人物/场景/物品描写",
        icon: ListChecks,
        category: "ai_tools",
        defaultValue: ""
    }
];

const TEMPLATES: PromptTemplate[] = [
    { 
        id: "NOVEL_OUTLINE_PROMPT", 
        title: "AI 大纲提示词", 
        description: "生成小说分卷分章大纲的系统指令", 
        icon: Tags, 
        category: "ai_prompts",
        defaultValue: `你是一位深谙网文市场规律、擅长构建爽文节奏的金牌主编。
请根据以下核心创意，设计一份极具吸引力、节奏紧凑的小说分卷大纲。

【小说基础信息】
- 标题：{{title}}
- 题材标签：{{tags}}
- 核心梗概：{{description}}
- 预计篇幅：{{totalChapters}} 章（共 {{volumeCount}} 卷，每卷约 {{chaptersPerVolume}} 章）
- 写作风格：{{writingStyle}}

【设计要求 - 必须严格遵守】
1. **拒绝套路化**：避免使用"第一章：重生"、"第二章：复仇"这种干瘪的标题。章节标题必须具有**画面感**和**悬念感**（例如："第1章 雨夜，断刀，复仇少年" 而不是 "第1章 少年复仇"）。
2. **黄金三章法则**：前三章必须完成以下任务：
   - 第1章：抛出核心冲突/危机，主角陷入绝境或面临重大抉择，引出金手指/转机。
   - 第2章：展现金手指的初步威力或主角的独特破局方式，制造第一个爽点（打脸/震惊/反转）。
   - 第3章：解决当前小危机，引出更大的背景或主线悬念，拉高期待值。
3. **节奏把控**：每卷的结尾（卷末）必须有一个**高潮事件**或**重大转折**，为下一卷埋下伏笔。
4. **剧情密度**：每章的【简要剧情】不要只写一句话流水账。请用 3-5 句话描述具体的**冲突爆发**、**关键对话**、**伏笔揭晓**或**爽点呈现**。
5. **结构完整**：大纲需包含 {{volumeCount}} 个分卷，确保故事起承转合逻辑严密。

【输出格式 - 严格 JSON】
请仅输出一个 JSON 对象，根对象为 \`outline\`，不要包含任何"全书设定"、"人物小传"等额外字段。
**严禁**使用 \`全书核心信息\`、\`分卷与章节结构\` 等中文 Key 作为顶层字段。

\`\`\`json
{
  "outline": [
    {
      "title": "第一卷：[极具张力的卷名，如：潜龙勿用]",
      "chapters": [
        {
          "title": "第1章 [吸睛标题]",
          "summary": "[具体剧情：主角在什么场景下，遇到了什么危机，做出了什么反常举动，引发了什么后果...]"
        },
        {
          "title": "第2章 [吸睛标题]",
          "summary": "[具体剧情...]"
        }
      ]
    }
  ]
}
\`\`\`
不要使用 markdown 代码块包裹 JSON 之外的任何文字。不要输出 \`core_information\` 等多余字段。`
    },
    { 
        id: "NOVEL_CHAPTER_CONTENT_PROMPT", 
        title: "章节内容提示词", 
        description: "将细纲扩写为 2000-3000 字正文的指令", 
        icon: FileText, 
        category: "ai_prompts",
        defaultValue: `你是一位站在网文巅峰的大神级作家，你的文字极具张力，擅长通过细节描写调动读者的情绪。
现在，请你根据以下信息，撰写这一章的正文。

【核心信息】
{{contextStr}}

【本章剧情细纲 (Plot Points)】
{{plotPoints}}

【极重要：去 AI 化写作规范】
1. **禁止使用"AI 味"词汇**：
   - 严禁出现："随着"、"只见"、"不由得"、"心中暗想"、"紧接着"、"这一刻"、"不得不说"。
   - 严禁使用"当...的时候"这种翻译腔句式。
   - 严禁出现总结性的废话（如"一场大战一触即发"、"命运的齿轮开始转动"）。

2. **拒绝上帝视角说明**：
   - 错误："他感到非常恐惧。"（这是说明）
   - 正确："他的瞳孔骤然收缩，指尖止不住地颤抖，喉咙里发出咯咯的声响，却说不出一句完整的话。"（这是描写）
   - **Show, Don't Tell**：把所有的心理活动转化为肢体动作、微表情或环境投射。

3. **句式与节奏**：
   - 必须**长短句交替**。战斗和冲突时用短句（3-8字），日常和情感时用长句。
   - 禁止连续三句话使用相同的开头（如连续用"他..."开头）。
   - 对话必须口语化，符合人设，去掉书面语。

4. **沉浸式感官描写**：
   - 每一段至少包含两种感官描写（视觉、听觉、嗅觉、触觉、味觉）。
   - 环境描写必须与人物心境挂钩（如：心情好时阳光明媚，心情差时阴雨连绵，或者是反衬）。

5. **【极重要】真人化标点符号**：
   - 减少逗号使用，避免"一句话特别长"
   - 多用省略号"……"代替英文"..."
   - 对话中多用问号"？"和感叹号"！"，少用句号结尾
   - 适当使用破折号"——"增强语气
   - 禁止使用分号"；"，真人写作很少用
   - 场景转换时可用"……"留白
   - 减少冒号"："使用，多用"道"、"说"直接引出对话

【逻辑与剧情要求】
1. **严格贴合大纲**：不得遗漏大纲中的关键剧情点。
2. **逻辑闭环**：人物的行为动机必须合理，前文提到的伏笔必须有交代。
3. **字数要求**：2500-3500 字，必须写满，内容充实，禁止灌水。

【输出格式】
- 直接输出正文，不要标题，不要前言后语。
- 段落之间空一行，保持排版舒适。

正文开始：`
    },
    { 
        id: "NOVEL_PROFESSIONAL_STYLE_PROMPT", 
        title: "专业网文写手提示词", 
        description: "定义全局写作风格和文笔偏好", 
        icon: Sparkles, 
        category: "ai_prompts",
        defaultValue: `用词考究，富有画面感，擅长心理描写，节奏明快，多用短句。避开"然而"、"突然"、"总之"等 AI 常用词。

【标点符号规范】
1. 减少逗号使用，多用句号断句，避免"一句话特别长"
2. 多用省略号"……"代替"..."
3. 对话中多用问号"？"和感叹号"！"，少用句号
4. 适当使用破折号"——"增强语气
5. 减少分号"；"使用真人很少用
6. 场景转换时可用"……"留白
7. 减少冒号"："使用，多用"道"、"说"直接引出对话`
    },
];

export default function NovelToolsPage() {
  const [activeTemplate, setActiveTemplate] = useState<PromptTemplate>(AI_TOOLS[0]);
  const [promptValues, setPromptValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  
  const [aiConfig, setAiConfig] = useState<AIToolConfig>({
    apiKey: "",
    baseUrl: "",
    model: ""
  });
  
  const [toolInput, setToolInput] = useState("");
  const [toolOutput, setToolOutput] = useState("");
  const [toolLoading, setToolLoading] = useState(false);
  const [adjectiveCategory, setAdjectiveCategory] = useState("外貌,性格,场景,物品");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Load all prompt values from storage
    const loadPrompts = async () => {
        const results = await Promise.all(
            TEMPLATES.map(t => 
                fetch(`/api/workspace-file?key=${t.id}`)
                    .then(res => res.ok ? res.json() : { value: t.defaultValue })
                    .catch(() => ({ value: t.defaultValue }))
            )
        );

        const newValues: Record<string, string> = {};
        results.forEach((res, i) => {
            const t = TEMPLATES[i];
            let val = res.value;
            if (val && typeof val === 'string') {
                try {
                    const parsed = JSON.parse(val);
                    if (parsed && typeof parsed === 'object' && parsed.content) val = parsed.content;
                } catch {}
            }
            newValues[t.id] = val || t.defaultValue;
        });
        setPromptValues(newValues);
        setLoading(false);
    };
    loadPrompts();
  }, []);

  useEffect(() => {
    const loadAiConfig = async () => {
      try {
        const keys = ["GEMINI_API_KEY", "GEMINI_BASE_URL", "GEMINI_MODEL"];
        const results = await Promise.all(
          keys.map(key => 
            fetch(`/api/workspace-file?key=${key}`)
              .then(res => res.ok ? res.json() : { value: "" })
              .catch(() => ({ value: "" }))
          )
        );
        
        const parseValue = (val: any) => {
          if (!val) return "";
          if (typeof val !== 'string') return String(val);
          try {
            const parsed = JSON.parse(val);
            if (parsed && typeof parsed === 'object' && parsed.content) return parsed.content;
            return typeof parsed === 'string' ? parsed : val;
          } catch {
            return val;
          }
        };
        
        setAiConfig({
          apiKey: parseValue(results[0].value),
          baseUrl: parseValue(results[1].value),
          model: parseValue(results[2].value) || "gemini-2.0-flash"
        });
      } catch (e) {
        console.error("AI config load error:", e);
      }
    };
    loadAiConfig();
  }, []);

  const handleToolExecute = async () => {
    if (!toolInput.trim()) {
      alert("请输入内容");
      return;
    }
    if (!aiConfig.apiKey || !aiConfig.model) {
      alert("请先在设置页面配置AI API");
      return;
    }
    
    setToolLoading(true);
    setToolOutput("");
    
    try {
      const toolType = activeTemplate.id === "ai-remove-trace" ? "remove-ai-trace" : "extract-adjectives";
      
      const res = await fetch("/api/novel-ai-tool", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: toolType,
          apiKey: aiConfig.apiKey,
          baseUrl: aiConfig.baseUrl,
          model: aiConfig.model,
          content: toolInput,
          category: toolType === "extract-adjectives" ? adjectiveCategory : undefined
        })
      });
      
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "处理失败");
        return;
      }
      
      const data = await res.json();
      setToolOutput(data.content || "");
    } catch (e) {
      alert("请求失败: " + (e instanceof Error ? e.message : "未知错误"));
    } finally {
      setToolLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!toolOutput) return;
    await navigator.clipboard.writeText(toolOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
      setSaving(true);
      try {
          await fetch("/api/workspace-file", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ 
                  key: activeTemplate.id, 
                  value: promptValues[activeTemplate.id] 
              })
          });
          alert("保存成功");
      } catch (e) {
          alert("保存失败");
      } finally {
          setSaving(false);
      }
  };

  const filteredTemplates = TEMPLATES.filter(t => 
    t.title.includes(searchQuery) || t.description.includes(searchQuery)
  );

  if (loading) {
      return <div className="flex items-center justify-center h-full text-[var(--text-muted)]"><Loader2 size={24} className="animate-spin mr-2"/> 加载中...</div>;
  }

  return (
    <main className="flex h-full bg-[#0a0a0a] overflow-hidden">
      {/* Left Sidebar: Categories & Templates */}
      <div className="w-[320px] border-r border-[#1f1f1f] flex flex-col h-full bg-[#0a0a0a] shrink-0">
          <div className="p-5 border-b border-[#1f1f1f]">
              <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 bg-[#e8c060]/10 flex items-center justify-center rounded text-[#e8c060]">
                      <Wrench size={18} />
                  </div>
                  <h1 className="text-[16px] font-bold text-[#ededed]">创作工具</h1>
                  <span className="text-[10px] text-[#666] ml-auto">{TEMPLATES.length} 个模板</span>
              </div>
              <div className="relative">
                  <input 
                    type="text" 
                    placeholder="搜索模板..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-[#141414] border border-[#2a2a2a] rounded text-[13px] text-[#ededed] outline-none focus:border-[#e8c060] transition"
                  />
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666]" />
              </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
              {/* AI 提示词分类 */}
              <div className="px-5 py-3 text-[11px] font-bold text-[#666] tracking-widest uppercase">
                  AI 智能提示词
              </div>
              {filteredTemplates.filter(t => t.category === "ai_prompts").map(t => (
                  <button 
                    key={t.id}
                    onClick={() => setActiveTemplate(t)}
                    className={`w-full flex items-start gap-3 px-5 py-4 text-left transition group border-l-2 ${
                        activeTemplate.id === t.id 
                        ? "bg-[#e8c060]/5 border-[#e8c060]" 
                        : "border-transparent hover:bg-[#141414] hover:border-[#333]"
                    }`}
                  >
                      <div className={`mt-0.5 shrink-0 ${activeTemplate.id === t.id ? "text-[#e8c060]" : "text-[#666] group-hover:text-[#999]"}`}>
                          <t.icon size={18} />
                      </div>
                      <div className="flex flex-col gap-1 min-w-0">
                          <span className={`text-[13px] font-bold truncate ${activeTemplate.id === t.id ? "text-[#ededed]" : "text-[#999] group-hover:text-[#ededed]"}`}>
                              {t.title}
                          </span>
                          <span className="text-[11px] text-[#555] line-clamp-2 leading-relaxed">
                              {t.description}
                          </span>
                      </div>
                  </button>
              ))}
              
              <div className="px-5 py-3 text-[11px] font-bold text-[#666] tracking-widest uppercase">
                  AI 创作工具
              </div>
              {AI_TOOLS.map(t => (
                  <button 
                    key={t.id}
                    onClick={() => setActiveTemplate(t)}
                    className={`w-full flex items-start gap-3 px-5 py-4 text-left transition group border-l-2 ${
                        activeTemplate.id === t.id 
                        ? "bg-[#e8c060]/5 border-[#e8c060]" 
                        : "border-transparent hover:bg-[#141414] hover:border-[#333]"
                    }`}
                  >
                      <div className={`mt-0.5 shrink-0 ${activeTemplate.id === t.id ? "text-[#e8c060]" : "text-[#666] group-hover:text-[#999]"}`}>
                          <t.icon size={18} />
                      </div>
                      <div className="flex flex-col gap-1 min-w-0">
                          <span className={`text-[13px] font-bold truncate ${activeTemplate.id === t.id ? "text-[#ededed]" : "text-[#999] group-hover:text-[#ededed]"}`}>
                              {t.title}
                          </span>
                          <span className="text-[11px] text-[#555] line-clamp-2 leading-relaxed">
                              {t.description}
                          </span>
                      </div>
                  </button>
              ))}
          </div>
      </div>

      {/* Right Content: Editor */}
      <div className="flex-1 flex flex-col h-full bg-[#0a0a0a]">
          {activeTemplate.category === "ai_tools" ? (
            <div className="h-[68px] border-b border-[#1f1f1f] flex items-center justify-between px-8 bg-[#0a0a0a]">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-bold text-[#ededed]">{activeTemplate.title}</h2>
                  <span className="text-[10px] px-1.5 py-0.5 bg-[#e8c060]/10 border border-[#e8c060]/20 text-[#e8c060] rounded uppercase tracking-wider">
                    AI Tool
                  </span>
                </div>
                <p className="text-[11px] text-[#666] mt-0.5">{activeTemplate.description}</p>
              </div>
              <div className="text-[10px] text-[#666]">
                当前模型: <span className="text-[#e8c060]">{aiConfig.model || "未配置"}</span>
              </div>
            </div>
          ) : (
            <div className="h-[68px] border-b border-[#1f1f1f] flex items-center justify-between px-8 bg-[#0a0a0a]">
              <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                      <h2 className="text-[15px] font-bold text-[#ededed]">{activeTemplate.title}</h2>
                      <span className="text-[10px] px-1.5 py-0.5 bg-[#1a1a1a] border border-[#2a2a2a] text-[#666] rounded uppercase tracking-wider">
                          Prompt Template
                      </span>
                  </div>
                  <p className="text-[11px] text-[#666] mt-0.5">{activeTemplate.description}</p>
              </div>
              <button 
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 bg-[#e8c060] text-[#000] text-[12px] font-bold rounded hover:brightness-110 transition disabled:opacity-50"
              >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  保存修改
              </button>
            </div>
          )}

          <div className="flex-1 p-8 overflow-y-auto">
            {activeTemplate.category === "ai_tools" ? (
              <div className="max-w-[900px] mx-auto flex flex-col gap-6">
                {activeTemplate.id === "ai-adjectives" && (
                  <div className="flex flex-col gap-3">
                    <label className="text-[12px] font-bold text-[#666] uppercase tracking-widest">
                      形容词类别
                    </label>
                    <input 
                      type="text"
                      value={adjectiveCategory}
                      onChange={(e) => setAdjectiveCategory(e.target.value)}
                      className="w-full px-4 py-3 bg-[#0d0d0d] border border-[#1f1f1f] rounded-lg text-[14px] text-[#ededed] outline-none focus:border-[#e8c060]/50 transition"
                      placeholder="外貌,性格,场景,物品"
                    />
                    <p className="text-[11px] text-[#666]">多个类别用逗号分隔</p>
                  </div>
                )}
                
                <div className="flex flex-col gap-3">
                  <label className="text-[12px] font-bold text-[#666] uppercase tracking-widest">
                    {activeTemplate.id === "ai-remove-trace" ? "待处理文本" : "内容主题"}
                  </label>
                  <textarea 
                    value={toolInput}
                    onChange={(e) => setToolInput(e.target.value)}
                    className="w-full h-[200px] p-4 bg-[#0d0d0d] border border-[#1f1f1f] rounded-lg text-[14px] text-[#ededed] leading-relaxed outline-none focus:border-[#e8c060]/50 transition resize-none"
                    placeholder={activeTemplate.id === "ai-remove-trace" 
                      ? "请粘贴需要消除AI痕迹的文本..." 
                      : "请输入需要生成形容词的主题内容..."}
                  />
                </div>

                <button 
                  onClick={handleToolExecute}
                  disabled={toolLoading}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-[#e8c060] text-[#000] text-[14px] font-bold rounded hover:brightness-110 transition disabled:opacity-50"
                >
                  {toolLoading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      处理中...
                    </>
                  ) : (
                    <>
                      <Wand2 size={18} />
                      {activeTemplate.id === "ai-remove-trace" ? "开始消痕" : "生成形容词"}
                    </>
                  )}
                </button>

                {toolOutput && (
                  <div className="flex flex-col gap-3 mt-4">
                    <div className="flex items-center justify-between">
                      <label className="text-[12px] font-bold text-[#666] uppercase tracking-widest">
                        处理结果
                      </label>
                      <button 
                        onClick={handleCopy}
                        className="flex items-center gap-1 px-3 py-1.5 bg-[#1a1a1a] text-[#999] hover:text-[#e8c060] text-[12px] rounded transition"
                      >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? "已复制" : "复制"}
                      </button>
                    </div>
                    <div className="p-4 bg-[#0d0d0d] border border-[#1f1f1f] rounded-lg text-[14px] text-[#ededed] whitespace-pre-wrap leading-relaxed max-h-[400px] overflow-y-auto">
                      {toolOutput}
                    </div>
                  </div>
                )}

                <div className="p-5 bg-[#e8c060]/5 border border-[#e8c060]/10 rounded-lg flex gap-4">
                  <div className="text-[#e8c060] shrink-0">
                    <Sparkles size={20} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <h4 className="text-[13px] font-bold text-[#ededed]">使用说明</h4>
                    <p className="text-[12px] text-[#999] leading-relaxed">
                      {activeTemplate.id === "ai-remove-trace" 
                        ? "将AI生成的文本粘贴到上方输入框，系统将自动消除机器味，使文字更加自然流畅。请确保已在设置页面配置好AI API。"
                        : "输入内容主题或场景描述，系统将批量生成高质量的形容词。支持自定义类别，多个类别用逗号分隔。"}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="max-w-[900px] mx-auto flex flex-col gap-6">
                  {/* Prompt Editor */}
                  <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                          <label className="text-[12px] font-bold text-[#666] uppercase tracking-widest">
                              提示词内容 (System Prompt)
                          </label>
                          {activeTemplate.id === "NOVEL_OUTLINE_PROMPT" && (
                              <div className="flex gap-2">
                                  <span className="text-[10px] text-[#444] px-1.5 py-0.5 border border-[#222] rounded">可用变量: {"{{title}}"}, {"{{tags}}"}, {"{{description}}"}, {"{{totalChapters}}"}, {"{{volumeCount}}"}, {"{{chaptersPerVolume}}"}, {"{{writingStyle}}"}</span>
                              </div>
                          )}
                          {activeTemplate.id === "NOVEL_CHAPTER_CONTENT_PROMPT" && (
                              <div className="flex gap-2">
                                  <span className="text-[10px] text-[#444] px-1.5 py-0.5 border border-[#222] rounded">可用变量: {"{{contextStr}}"}, {"{{plotPoints}}"} (风格约束自动注入)</span>
                              </div>
                          )}
                          {activeTemplate.id === "NOVEL_PROFESSIONAL_STYLE_PROMPT" && (
                              <div className="flex gap-2">
                                  <span className="text-[10px] text-[#444] px-1.5 py-0.5 border border-[#222] rounded">短描述风格提示词，会自动注入到正文生成</span>
                              </div>
                          )}
                      </div>
                      <div className="relative group">
                          <textarea 
                            value={promptValues[activeTemplate.id] || ""}
                            onChange={(e) => setPromptValues({...promptValues, [activeTemplate.id]: e.target.value})}
                            className="w-full h-[600px] p-6 bg-[#0d0d0d] border border-[#1f1f1f] rounded-lg text-[14px] text-[#ededed] font-mono leading-relaxed outline-none focus:border-[#e8c060]/50 transition shadow-2xl resize-none"
                            placeholder="在这里编写您的提示词内容..."
                          />
                          <div className="absolute top-4 right-4 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition">
                              <button 
                                onClick={() => setPromptValues({...promptValues, [activeTemplate.id]: activeTemplate.defaultValue})}
                                className="p-2 bg-[#1a1a1a] text-[#666] hover:text-[#e8c060] rounded border border-[#2a2a2a] transition"
                                title="重置为默认值"
                              >
                                  <History size={16} />
                              </button>
                          </div>
                      </div>
                  </div>

                  {/* Warning/Info Box */}
                  <div className="p-5 bg-[#e8c060]/5 border border-[#e8c060]/10 rounded-lg flex gap-4">
                      <div className="text-[#e8c060] shrink-0">
                          <Sparkles size={20} />
                      </div>
                      <div className="flex flex-col gap-1">
                          <h4 className="text-[13px] font-bold text-[#ededed]">编写建议</h4>
                          <p className="text-[12px] text-[#999] leading-relaxed">
                              修改后的提示词将立即生效于全站的 AI 任务。请确保保持指令的完整性，尤其是保留变量占位符，以确保 AI 能正确理解上下文。建议使用结构化指令（如：任务、背景、要求、输出格式）。
                          </p>
                      </div>
                  </div>
              </div>
            )}
          </div>
      </div>
    </main>
  );
}
