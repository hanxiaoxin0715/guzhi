"use client";

import { useState, useMemo } from "react";
import { X, Sparkles, ChevronDown, Timer, Info, Check, Languages } from "lucide-react";
import { matchPlatformProfile, PLATFORM_PROFILES, type PlatformPromptProfile } from "../../lib/platformPromptProfiles";

/** 外部传入的视频模型定义 */
export interface VideoModelForModal {
  id: string;
  name: string;
  model: string;
  modes: string[];
}

/** 台词条目 */
export interface DialogueLine {
  role: string;
  text: string;
  emotion?: string;
  strength?: string;
  speed?: string;
  voiceQuality?: string;
}

interface AIPromptModalProps {
  open: boolean;
  onClose: () => void;
  /** 调用 AI 生成提示词，传回选中的平台规格、台词和输出语言 */
  onGenerate: (profile: PlatformPromptProfile, dialogueLines: DialogueLine[], outputLang: "zh" | "en") => void;
  /** 可选的视频模型列表 */
  videoModels: VideoModelForModal[];
  /** 当前已选模型 ID（默认高亮） */
  currentModelId: string;
  /** 当前格子可用的台词 */
  dialogues: DialogueLine[];
  /** 当前模式标签 */
  modeLabel: string;
  /** 是否正在生成中 */
  generating?: boolean;
}

export default function AIPromptModal({
  open, onClose, onGenerate, videoModels, currentModelId, dialogues, modeLabel, generating,
}: AIPromptModalProps) {
  // 选中的模型 ID（默认跟随当前视频模型）
  const [selectedModelId, setSelectedModelId] = useState(currentModelId);
  // 台词勾选状态（默认全选）
  const [checkedDialogues, setCheckedDialogues] = useState<boolean[]>(() => dialogues.map(() => true));
  // 是否展开高级选项
  const [showAdvanced, setShowAdvanced] = useState(false);
  // 输出语言：中文 / 英文
  const [outputLang, setOutputLang] = useState<"zh" | "en">("zh");

  // 选中模型
  const selectedModel = videoModels.find(m => m.id === selectedModelId) || videoModels[0];
  // 匹配平台规格
  const profile = useMemo(() => {
    if (!selectedModel) return matchPlatformProfile("");
    return matchPlatformProfile(selectedModel.model || selectedModel.name);
  }, [selectedModel]);

  // 台词同步（dialogues 变化时重置勾选）
  const effectiveChecked = checkedDialogues.length === dialogues.length
    ? checkedDialogues
    : dialogues.map(() => true);

  const handleToggleDialogue = (idx: number) => {
    const next = [...effectiveChecked];
    next[idx] = !next[idx];
    setCheckedDialogues(next);
  };

  const handleGenerate = () => {
    const selectedLines = dialogues.filter((_, i) => effectiveChecked[i]);
    onGenerate(profile, selectedLines, outputLang);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[640px] max-h-[85vh] bg-[#141414] border border-[var(--border-default)] rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3">
            <Sparkles size={18} className="text-[var(--gold-primary)]" />
            <span className="text-[16px] font-semibold text-[var(--text-primary)]">AI 动态提示词生成</span>
            <span className="text-[11px] text-[var(--text-muted)] bg-[#1A1A1A] px-2.5 py-1 rounded">{modeLabel}</span>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-[#222] rounded transition cursor-pointer">
            <X size={16} className="text-[var(--text-muted)]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">
          {/* ─── 目标视频模型选择 ─── */}
          <div className="flex flex-col gap-3">
            <span className="text-[13px] font-medium text-[var(--text-secondary)]">目标视频模型</span>
            <div className="grid grid-cols-2 gap-2 max-h-[240px] overflow-y-auto pr-1">
              {videoModels.map(m => {
                const mp = matchPlatformProfile(m.model || m.name);
                const isSelected = m.id === selectedModelId;
                return (
                  <button key={m.id}
                    onClick={() => setSelectedModelId(m.id)}
                    className={`flex flex-col gap-1 px-4 py-3 rounded-lg border text-left transition cursor-pointer ${
                      isSelected
                        ? "border-[var(--gold-primary)] bg-[#C9A96215]"
                        : "border-[var(--border-subtle)] bg-[#0D0D0D] hover:border-[var(--border-default)]"
                    }`}>
                    <span className={`text-[13px] font-medium truncate ${isSelected ? "text-[var(--gold-primary)]" : "text-[var(--text-secondary)]"}`}>
                      {m.name}
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)] truncate">{mp.label} · {mp.maxLength}字</span>
                  </button>
                );
              })}
            </div>
            {videoModels.length === 0 && (
              <span className="text-[12px] text-[var(--text-muted)] py-4 text-center">未配置视频模型，将使用通用模式</span>
            )}
          </div>

          {/* ─── 平台规格预览 ─── */}
          <div className="flex items-center gap-4 px-4 py-3 bg-[#0D0D0D] rounded-lg border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2">
              <Timer size={14} className="text-[var(--gold-primary)]" />
              <span className="text-[12px] text-[var(--text-muted)]">时长 {profile.minDuration}-{profile.maxDuration}s</span>
            </div>
            <span className="text-[var(--border-subtle)]">|</span>
            <span className="text-[12px] text-[var(--text-muted)]">上限 {profile.maxLength} 字</span>
            <span className="text-[var(--border-subtle)]">|</span>
            <span className="text-[12px] text-[var(--text-muted)]">
              {profile.language === "zh" ? "中文" : profile.language === "en" ? "英文" : "中英混合"}
            </span>
          </div>

          {/* ─── 输出语言选择 ─── */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <Languages size={14} className="text-[var(--gold-primary)]" />
              <span className="text-[13px] font-medium text-[var(--text-secondary)]">输出语言</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setOutputLang("zh")}
                className={`flex-1 py-2.5 text-[13px] rounded-lg border transition cursor-pointer ${
                  outputLang === "zh"
                    ? "border-[var(--gold-primary)] bg-[#C9A96215] text-[var(--gold-primary)] font-medium"
                    : "border-[var(--border-subtle)] bg-[#0D0D0D] text-[var(--text-secondary)] hover:border-[var(--border-default)]"
                }`}>中文</button>
              <button onClick={() => setOutputLang("en")}
                className={`flex-1 py-2.5 text-[13px] rounded-lg border transition cursor-pointer ${
                  outputLang === "en"
                    ? "border-[var(--gold-primary)] bg-[#C9A96215] text-[var(--gold-primary)] font-medium"
                    : "border-[var(--border-subtle)] bg-[#0D0D0D] text-[var(--text-secondary)] hover:border-[var(--border-default)]"
                }`}>English</button>
            </div>
          </div>

          {/* ─── 关联台词 ─── */}
          {dialogues.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <button onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 cursor-pointer">
                <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                <span className="text-[13px] font-medium text-[var(--text-secondary)]">关联台词（{dialogues.length}条）</span>
                <span className="text-[11px] text-[var(--text-muted)]">— 勾选的台词将注入 AI 上下文</span>
              </button>
              {showAdvanced && (
                <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto pr-1">
                  {dialogues.map((d, i) => (
                    <label key={i}
                      className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-[#1A1A1A] transition cursor-pointer">
                      <input type="checkbox" checked={effectiveChecked[i]}
                        onChange={() => handleToggleDialogue(i)}
                        className="mt-0.5 w-4 h-4 accent-[var(--gold-primary)]" />
                      <div className="flex-1 min-w-0">
                        <span className="text-[12px] font-medium text-[var(--gold-primary)]">{d.role}</span>
                        {d.emotion && <span className="text-[11px] text-[var(--text-muted)] ml-1.5">({d.emotion})</span>}
                        <p className="text-[12px] text-[var(--text-tertiary)] leading-relaxed break-all mt-0.5">{d.text}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── 提示信息 ─── */}
          <div className="flex items-start gap-2 px-3">
            <Info size={14} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
            <span className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              AI 将根据所选平台规格 + 分镜描述 + 参考图片 + 台词上下文生成适配的动态提示词，并推荐最佳视频时长。
            </span>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-4 px-6 py-4 border-t border-[var(--border-subtle)]">
          <button onClick={onClose}
            className="px-5 py-2.5 text-[13px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition cursor-pointer">
            取消
          </button>
          <button onClick={handleGenerate} disabled={generating}
            className="flex items-center gap-2 px-6 py-2.5 bg-[var(--gold-primary)] text-[#0A0A0A] text-[13px] font-semibold rounded-lg hover:brightness-110 transition cursor-pointer disabled:opacity-50">
            {generating ? (
              <><span className="animate-spin">⏳</span> 生成中...</>
            ) : (
              <><Sparkles size={14} /> 生成提示词</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
