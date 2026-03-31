"use client";

import { useState } from "react";
import { Sparkles, Loader2, Download, Edit3, RefreshCw, Copy, Check, Wand2, FileText, ChevronDown } from "lucide-react";
import { Toaster, toast } from "sonner";

const shortStoryTags = [
  { value: "system", label: "系统流", desc: "系统任务、超能力、变强" },
  { value: "xianxia", label: "仙侠", desc: "修炼、灵根、秘境" },
  { value: "urban", label: "都市", desc: "豪门、神豪、职场" },
  { value: "romance", label: "甜宠", desc: "恋爱、宠溺、双向奔赴" },
  { value: "horror", label: "悬疑灵异", desc: "恐怖、规则怪谈" },
  { value: "mystery", label: "推理", desc: "破案、烧脑" },
  { value: "game", label: "游戏", desc: "虚拟世界、全息游戏" },
  { value: "scifi", label: "科幻", desc: "未来、AI、赛博" },
  { value: "war", label: "军事", desc: "兵王、特战" },
  { value: "reborn", label: "重生", desc: "回到过去、逆天改命" },
  { value: "wuxia", label: "武侠", desc: "江湖、武功、门派" },
  { value: "other", label: "其他", desc: "其他题材" },
];

const narrativeStructures = [
  { value: "standard", label: "标准短篇", desc: "开篇→发展→高潮→结尾" },
  { value: "fast_paced", label: "快节奏爽文", desc: "开篇暴击→连续打脸→反转结局" },
  { value: "mystery", label: "悬疑反转", desc: "抛出谜题→层层迷雾→真相大白" },
  { value: "sweet", label: "甜宠", desc: "相遇→甜→虐→甜→圆满" },
  { value: "dark", label: "暗黑", desc: "美好撕裂→绝望→反转→震撼" },
  { value: "thriller", label: "紧张", desc: "危机逼近→绝境求生→反杀" },
];

const wordCountOptions = [
  { value: "1500", label: "1.5千字" },
  { value: "3000", label: "3千字" },
  { value: "5000", label: "5千字" },
  { value: "8000", label: "8千字" },
  { value: "10000", label: "1万字" },
  { value: "15000", label: "1.5万字" },
  { value: "20000", label: "2万字" },
];

function Select({ value, onChange, options, placeholder }: { 
  value: string; 
  onChange: (v: string) => void; 
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-3 bg-[#0a0a0a] border border-[#1f1f1f] rounded-lg text-[14px] text-[#ededed] outline-none focus:border-[#e8c060]/50 cursor-pointer"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-[#0a0a0a]">{opt.label}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#666] pointer-events-none" />
    </div>
  );
}

export default function ShortStoryPage() {
  const [title, setTitle] = useState("");
  const [tag1, setTag1] = useState("");
  const [tag2, setTag2] = useState("");
  const [description, setDescription] = useState("");
  const [targetWordCount, setTargetWordCount] = useState("5000");
  const [narrativeStructure, setNarrativeStructure] = useState("standard");
  
  const [generating, setGenerating] = useState(false);
  const [content, setContent] = useState("");
  const [wordCount, setWordCount] = useState(0);
  
  const [editing, setEditing] = useState(false);
  const [editedContent, setEditedContent] = useState("");
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    if (!title.trim()) {
      toast.error("请输入标题");
      return;
    }
    if (!tag1) {
      toast.error("请选择主要题材");
      return;
    }
    if (!description.trim()) {
      toast.error("请输入故事梗概");
      return;
    }

    const tags = [tag1];
    if (tag2) tags.push(tag2);

    setGenerating(true);
    setContent("");
    
    try {
      const res = await fetch("/api/novel/short-story/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          tags,
          description: description.trim(),
          targetWordCount: parseInt(targetWordCount),
          narrativeStructure
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "生成失败");
      }

      const data = await res.json();
      setContent(data.content);
      setWordCount(data.wordCount);
      toast.success("生成完成！");
    } catch (err: any) {
      toast.error(err.message || "生成失败，请重试");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success("已复制到剪贴板");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("复制失败");
    }
  };

  const handleExport = () => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title || "短篇小说"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已导出 TXT 文件");
  };

  const handleSaveEdit = () => {
    setEditedContent(content);
    setEditing(true);
  };

  const handleConfirmEdit = () => {
    setContent(editedContent);
    setWordCount(editedContent.length);
    setEditing(false);
    toast.success("修改已保存");
  };

  const handleCancelEdit = () => {
    setEditing(false);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#ededed] overflow-y-auto">
      <Toaster position="top-center" />
      
      {/* Header */}
      <div className="border-b border-[#1f1f1f] bg-[#0d0d0d] px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Sparkles className="text-[#e8c060]" />
            短篇小说生成
            <span className="text-[12px] text-[#666] bg-[#141414] px-2 py-1 rounded ml-2">
              1000-20000字
            </span>
          </h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-6 pb-20">
        {/* 输入区域 */}
        <div className="bg-[#0d0d0d] rounded-xl border border-[#1f1f1f] p-6 space-y-5">
          <h2 className="text-[14px] font-bold text-[#e8c060] flex items-center gap-2">
            <FileText size={16} /> 创作信息
          </h2>
          
          {/* 标题 */}
          <div>
            <label className="text-[12px] text-[#666] block mb-2">
              小说标题 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="请输入标题，建议包含爆款关键词，如：系统、重生、甜宠"
              className="w-full px-4 py-3 bg-[#0a0a0a] border border-[#1f1f1f] rounded-lg text-[14px] outline-none focus:border-[#e8c060]/50"
            />
          </div>

          {/* 题材选择 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[12px] text-[#666] block mb-2">
                主要题材 <span className="text-red-500">*</span>
              </label>
              <Select
                value={tag1}
                onChange={setTag1}
                options={shortStoryTags}
                placeholder="选择主要题材"
              />
              <p className="text-[10px] text-[#444] mt-1">
                {shortStoryTags.find(t => t.value === tag1)?.desc}
              </p>
            </div>
            <div>
              <label className="text-[12px] text-[#666] block mb-2">
                辅助题材 <span className="text-[#444]">(可选)</span>
              </label>
              <Select
                value={tag2}
                onChange={setTag2}
                options={shortStoryTags.filter(t => t.value !== tag1)}
                placeholder="选择辅助题材"
              />
            </div>
          </div>

          {/* 篇幅和结构 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[12px] text-[#666] block mb-2">目标字数</label>
              <Select
                value={targetWordCount}
                onChange={setTargetWordCount}
                options={wordCountOptions}
              />
            </div>
            <div>
              <label className="text-[12px] text-[#666] block mb-2">叙事结构</label>
              <Select
                value={narrativeStructure}
                onChange={setNarrativeStructure}
                options={narrativeStructures}
              />
              <p className="text-[10px] text-[#444] mt-1">
                {narrativeStructures.find(s => s.value === narrativeStructure)?.desc}
              </p>
            </div>
          </div>

          {/* 故事梗概 */}
          <div>
            <label className="text-[12px] text-[#666] block mb-2">
              故事梗概 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="请用1-3句话概括故事核心：主角+核心冲突+爽点&#10;&#10;例：外卖员主角意外救下豪门千金，被嫌贫爱富的岳母刁难，最终用隐藏身份打脸所有人"
              className="w-full h-32 px-4 py-3 bg-[#0a0a0a] border border-[#1f1f1f] rounded-lg text-[14px] outline-none focus:border-[#e8c060]/50 resize-none"
            />
          </div>
        </div>

        {/* 生成按钮 */}
        <button
          onClick={handleGenerate}
          disabled={generating || !title || !tag1 || !description}
          className="w-full py-4 bg-[#e8c060] text-black font-bold rounded-xl flex items-center justify-center gap-2 hover:brightness-110 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              AI 创作中...
            </>
          ) : (
            <>
              <Sparkles size={20} />
              开始生成短篇小说
            </>
          )}
        </button>

        {/* 生成结果 */}
        <div className="bg-[#0d0d0d] rounded-xl border border-[#1f1f1f] p-6 min-h-[400px]">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[14px] font-bold text-[#e8c060]">
              生成结果
              {wordCount > 0 && (
                <span className="text-[12px] font-normal text-[#666] ml-2">
                  {wordCount} 字
                </span>
              )}
            </h2>
            
            {content && !editing && (
              <div className="flex gap-2">
                <button onClick={handleCopy} className="p-2 hover:bg-[#1a1a1a] rounded-lg">
                  {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} className="text-[#666]" />}
                </button>
                <button onClick={handleExport} className="p-2 hover:bg-[#1a1a1a] rounded-lg">
                  <Download size={16} className="text-[#666]" />
                </button>
                <button onClick={handleSaveEdit} className="p-2 hover:bg-[#1a1a1a] rounded-lg">
                  <Edit3 size={16} className="text-[#666]" />
                </button>
                <button onClick={handleGenerate} className="p-2 hover:bg-[#1a1a1a] rounded-lg">
                  <RefreshCw size={16} className="text-[#666]" />
                </button>
              </div>
            )}
          </div>

          {generating && (
            <div className="flex flex-col items-center justify-center h-[300px]">
              <Loader2 size={48} className="text-[#e8c060] animate-spin mb-4" />
              <p className="text-[14px] text-[#666]">AI 正在创作中...</p>
              <p className="text-[12px] text-[#444] mt-2">预计 {Math.ceil(parseInt(targetWordCount) / 500)} 分钟</p>
            </div>
          )}

          {!generating && !content && (
            <div className="flex flex-col items-center justify-center h-[300px] text-center">
              <Sparkles size={48} className="text-[#333] mb-4" />
              <p className="text-[14px] text-[#666]">填写上方信息，点击生成按钮</p>
              <p className="text-[12px] text-[#444] mt-1">AI 将创作一篇完整的短篇小说</p>
            </div>
          )}

          {editing ? (
            <div className="space-y-4">
              <textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                className="w-full h-[400px] px-4 py-3 bg-[#0a0a0a] border border-[#1f1f1f] rounded-lg text-[14px] outline-none focus:border-[#e8c060]/50 resize-none font-serif leading-relaxed"
              />
              <div className="flex gap-2">
                <button onClick={handleConfirmEdit} className="flex-1 py-2 bg-[#e8c060] text-black font-bold rounded-lg">
                  保存修改
                </button>
                <button onClick={handleCancelEdit} className="flex-1 py-2 bg-[#1a1a1a] text-[#666] font-bold rounded-lg">
                  取消
                </button>
              </div>
            </div>
          ) : content && (
            <div className="h-[400px] overflow-y-auto">
              <div className="text-[15px] leading-8 font-serif whitespace-pre-wrap text-[#999]">
                {content}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
