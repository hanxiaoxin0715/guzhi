"use client";

import { useState, useEffect } from "react";
import { useToast } from "../components/Toast";
import Sidebar from "../components/Sidebar";
import {
  FileCode,
  Save,
  RotateCcw,
  Loader,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  loadSystemPromptsAsync,
  saveSystemPrompts,
  SystemPrompts,
} from "../lib/consistency";

interface PromptItem {
  key: string;
  label: string;
  description: string;
  category: string;
  readonly?: boolean; // 仅供参考，不可编辑（编辑不会影响任何 AI 调用）
}

// 分类显示顺序
const CATEGORIES = [
  { id: "pipeline", label: "🔗 分镜流水线" },
  { id: "studio", label: "🎨 生图工作台" },
  { id: "video", label: "🎬 视频生成" },
  { id: "agent", label: "🤖 Agent 配置" },
];

const PROMPT_ITEMS: PromptItem[] = [
  // ── 分镜流水线 ──
  { key: "beatBreakdown", label: "节拍拆解提示词", description: "流水线 Stage 1 · 将小说/剧本拆分为分集节拍表", category: "pipeline" },
  { key: "nineGridGem", label: "★ 九宫格分镜 (Gem.txt)", description: "流水线核心 · 9宫格分镜Gem.txt · 作为系统提示词发送给LLM生成九宫格分镜JSON", category: "pipeline" },
  { key: "fourGridGem", label: "★ 四宫格分镜 (Gem.txt)", description: "流水线核心 · 4宫格分镜Gem.txt · 作为系统提示词发送给LLM生成四宫格分镜JSON", category: "pipeline" },
  { key: "extract", label: "提取系统提示词", description: "从剧本/文本中提取角色、场景、道具的AI系统提示词", category: "pipeline" },
  { key: "analyzeScript", label: "剧本智能分集", description: "分析剧本章节内容，判断应拆分为多少集（每集=1张九宫格）", category: "pipeline" },
  { key: "restoreStoryboard", label: "分镜还原智能体", description: "用户上传自己的分镜/剧本后，AI 按用户分镜指示还原关键帧并补充镜头语言", category: "pipeline" },
  // ── 生图工作台 ──
  { key: "styleAnalyze", label: "风格识别提示词", description: "分析上传图片的视觉风格，输出风格描述和关键词", category: "studio" },
  { key: "upscale", label: "超分系统提示词", description: "图片超分放大提示词（发送给图像API，保持原图不变仅提升分辨率）", category: "studio" },
  { key: "translatePrompt", label: "AI参考图翻译提示词", description: "将角色/场景/道具中文描述扩展翻译为英文 Design Reference Sheet 提示词（一致性面板「AI翻译」按钮调用）", category: "studio" },
  { key: "translateGridPrompt", label: "AI分镜翻译提示词", description: "将九宫格/四宫格分镜格内的中文描述翻译为英文生图提示词（分镜面板「AI翻译」按钮调用）", category: "studio" },
  { key: "continuousAction", label: "连续动作叙事智能体", description: "四宫格「一键生成连续动提示词」按钮调用 · 分析九宫格单格画面+描述，生成4个连续动作帧的中英文提示词", category: "studio" },
  // ── 视频生成 ──
  { key: "motionPrompt", label: "动态提示词模板", description: "图生视频动态提示词系统提示词（单图/首尾帧/多参考模式）· AI生成时自动追加目标平台规格补丁", category: "video" },
  { key: "seedanceOmni", label: "Seedance 全能参考", description: "Seedance 2.0 全能参考模式 AI 提示词生成（分析参考图→视频提示词）", category: "video" },
  { key: "seedanceSimple", label: "Seedance 普通AI生成", description: "Seedance 2.0 普通 AI 生成提示词（参考图+文字描述→即梦专用提示词，含违禁词过滤）", category: "video" },
  { key: "seedanceFirstFrame", label: "Seedance 首帧参考", description: "Seedance 2.0 首帧参考模式 AI 提示词生成（从首帧画面展开动态内容）", category: "video" },
  { key: "dialogueEmotion", label: "台词情绪分析", description: "从小说文本中提取角色台词并标注情绪、强度、语速和声色（音谷配音用）", category: "video" },
  // ── AI 导演智能体（可编辑，修改后影响 AI 导演工作台行为）──
  { key: "storyAgent", label: "★ 故事策划师", description: "AI导演系统·故事策划师提示词（剧本分析、节拍拆解、一致性管理）", category: "agent" },
  { key: "shotAgent", label: "★ 分镜师Agent", description: "AI导演系统·分镜师提示词（镜头设计、提示词编写、翻译与运镜）", category: "agent" },
  { key: "imageAgent", label: "★ 画面师Agent", description: "AI导演系统·画面师提示词（图片生成、超分、风格分析、通道管理）", category: "agent" },
  // ── Agent 参考文档（仅供参考，编辑不影响功能）──
  { key: "methodology", label: "分镜方法论", description: "影视分镜方法论手册（分镜师和导演共用）", category: "agent", readonly: true },
  { key: "geminiGuide", label: "Gemini生图指南", description: "Gemini原生图像生成的提示词最佳实践", category: "agent", readonly: true },
  { key: "director", label: "导演Agent (旧)", description: "旧版导演Agent配置（负责审核分镜）", category: "agent", readonly: true },
  { key: "storyboardArtist", label: "分镜师Agent (旧)", description: "旧版分镜师Agent配置（负责生成分镜提示词）", category: "agent", readonly: true },
  { key: "producer", label: "制片人Agent (CLAUDE.md)", description: "主Agent配置（负责流程调度）", category: "agent", readonly: true },
];

export default function PromptsPage() {
  const { toast } = useToast();
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeKey, setActiveKey] = useState("beatBreakdown");
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["beatBreakdown"]));

  useEffect(() => {
    loadAllPrompts();
  }, []);

  async function loadAllPrompts() {
    setLoading(true);
    try {
      // Load defaults from server (template files)
      const res = await fetch("/api/prompts");
      if (res.ok) {
        const data = await res.json();
        setDefaults(data);

        // Load user-customized versions from IndexedDB
        const saved = await loadSystemPromptsAsync();
        // Merge: use saved version if exists, otherwise use default
        const merged: Record<string, string> = {};
        for (const item of PROMPT_ITEMS) {
          merged[item.key] = saved[item.key] || data[item.key] || "";
        }
        setPrompts(merged);
      }
    } catch (e) {
      toast(`加载失败: ${e instanceof Error ? e.message : "未知"}`, "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveSystemPrompts(prompts as SystemPrompts);
      toast("所有提示词已保存", "success");
    } catch {
      toast("保存失败", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset(key: string) {
    if (!defaults[key]) {
      toast("没有默认模板可恢复", "error");
      return;
    }
    const updated = { ...prompts, [key]: defaults[key] };
    setPrompts(updated);
    await saveSystemPrompts(updated as SystemPrompts);
    toast(`已恢复「${PROMPT_ITEMS.find((p) => p.key === key)?.label}」为默认值`, "success");
  }

  async function handleResetAll() {
    setPrompts({ ...defaults });
    await saveSystemPrompts(defaults as SystemPrompts);
    toast("所有提示词已恢复为默认值", "success");
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setActiveKey(key);
  }

  const currentItem = PROMPT_ITEMS.find((p) => p.key === activeKey);
  const isModified = (key: string) => prompts[key] !== defaults[key] && !!prompts[key];
  const isCurrentReadonly = currentItem?.readonly === true;

  if (loading) {
    return (
      <div className="flex h-full w-full">
        <Sidebar />
        <div className="flex flex-1 items-center justify-center">
          <Loader size={24} className="text-[var(--gold-primary)] animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <div className="flex flex-col flex-1 h-full">
        {/* Top Bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-[var(--border-default)] shrink-0">
          <div className="flex items-center gap-3">
            <FileCode size={20} className="text-[var(--gold-primary)]" />
            <span className="font-serif text-[22px] font-bold text-[var(--text-primary)]">
              智能体提示词编辑器
            </span>
            <span className="text-[13px] text-[var(--text-muted)]">
              {PROMPT_ITEMS.length} 个提示词模板
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleResetAll}
              className="flex items-center gap-1.5 px-4 py-2 text-[12px] font-medium border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] transition cursor-pointer"
            >
              <RotateCcw size={14} />
              全部恢复默认
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-[var(--gold-primary)] text-[12px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-50"
            >
              {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
              保存全部
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left: Prompt List (grouped by category) */}
          <div className="flex flex-col w-[280px] h-full border-r border-[var(--border-default)] overflow-auto shrink-0">
            {CATEGORIES.map((cat) => {
              const items = PROMPT_ITEMS.filter((p) => p.category === cat.id);
              if (items.length === 0) return null;
              return (
                <div key={cat.id}>
                  <div className="px-4 py-2 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider bg-[var(--bg-surface)] border-b border-[var(--border-default)] sticky top-0 z-10">
                    {cat.label}
                  </div>
                  {items.map((item) => (
              <button
                key={item.key}
                onClick={() => { if (!item.readonly) toggleExpand(item.key); }}
                className={`flex items-center gap-2 w-full px-4 py-3 text-left border-b border-[var(--border-default)] transition ${
                  item.readonly
                    ? "opacity-40 cursor-not-allowed"
                    : activeKey === item.key
                      ? "bg-[var(--gold-transparent)] border-l-2 border-l-[var(--gold-primary)]"
                      : "hover:bg-[var(--bg-surface)] cursor-pointer"
                }`}
                disabled={item.readonly}
              >
                {item.readonly ? (
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0">—</span>
                ) : expanded.has(item.key) ? (
                  <ChevronDown size={12} className="text-[var(--text-muted)] shrink-0" />
                ) : (
                  <ChevronRight size={12} className="text-[var(--text-muted)] shrink-0" />
                )}
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[12px] font-medium truncate ${
                      item.readonly ? "text-[var(--text-muted)]" : activeKey === item.key ? "text-[var(--gold-primary)]" : "text-[var(--text-primary)]"
                    }`}>
                      {item.label}
                    </span>
                    {item.readonly ? (
                      <span className="text-[9px] px-1 py-0.5 border border-[var(--border-default)] text-[var(--text-muted)] rounded shrink-0">
                        不可编辑
                      </span>
                    ) : isModified(item.key) ? (
                      <span className="text-[9px] px-1 py-0.5 bg-[var(--gold-primary)] text-[#0A0A0A] font-bold rounded shrink-0">
                        已修改
                      </span>
                    ) : null}
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)] truncate">{item.description}</span>
                </div>
              </button>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Right: Editor */}
          <div className="flex flex-col flex-1 min-h-0">
            {/* Editor Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-default)] shrink-0">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium text-[var(--text-primary)]">
                    {currentItem?.label}
                  </span>
                  {isCurrentReadonly && (
                    <span className="text-[10px] px-1.5 py-0.5 border border-[var(--border-default)] text-[var(--text-muted)] rounded">
                      仅供参考 · 不可编辑
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {currentItem?.description}
                </span>
              </div>
              {!isCurrentReadonly && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--text-muted)]">
                  {(prompts[activeKey] || "").length} 字符
                </span>
                <button
                  onClick={() => handleReset(activeKey)}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--text-secondary)] border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer"
                >
                  <RotateCcw size={10} />
                  恢复默认
                </button>
              </div>
              )}
            </div>

            {/* Textarea */}
            <div className="flex-1 p-4 overflow-hidden">
              {isCurrentReadonly ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
                  <span className="text-[40px] opacity-20">🔒</span>
                  <span className="text-[13px]">此项为参考文档，不支持在线编辑</span>
                  <span className="text-[11px] opacity-60">如需修改，请直接编辑对应的 .md 源文件</span>
                </div>
              ) : (
              <textarea
                value={prompts[activeKey] || ""}
                onChange={(e) => setPrompts((prev) => ({ ...prev, [activeKey]: e.target.value }))}
                className="w-full h-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[12px] text-[var(--text-primary)] font-mono leading-relaxed p-4 outline-none focus:border-[var(--gold-primary)] transition resize-none overflow-auto"
                placeholder="输入系统提示词..."
                spellCheck={false}
              />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
