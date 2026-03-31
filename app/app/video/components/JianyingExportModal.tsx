"use client";

/**
 * JianyingExportModal — 剪映草稿导出弹窗（含操作教程）
 */

import { useState } from "react";
import { X, FolderOpen, Copy, CheckCircle2, Film, ArrowRight, Info, ExternalLink } from "lucide-react";

interface JianyingExportModalProps {
  open: boolean;
  onClose: () => void;
  result: {
    draftPath: string;
    videoCount: number;
    totalDurationSec: number;
    draftName: string;
  } | null;
  isExporting: boolean;
}

export default function JianyingExportModal({ open, onClose, result, isExporting }: JianyingExportModalProps) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleCopyPath = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.draftPath.replace(/\//g, "\\")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-[640px] max-h-[85vh] flex flex-col bg-[#0A0A0A] rounded-xl overflow-hidden border border-[var(--border-default)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between h-12 px-5 bg-[#0D0D0D] border-b border-[var(--border-default)]">
          <div className="flex items-center gap-2">
            <Film size={16} className="text-[var(--gold-primary)]" />
            <span className="text-[14px] font-medium text-[var(--text-primary)]">导出剪映草稿</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#1A1A1A] transition cursor-pointer">
            <X size={14} className="text-[var(--text-muted)]" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* 导出中状态 */}
          {isExporting && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <div className="w-10 h-10 border-2 border-[var(--gold-primary)] border-t-transparent rounded-full animate-spin" />
              <span className="text-[13px] text-[var(--text-secondary)]">正在生成剪映草稿文件...</span>
            </div>
          )}

          {/* 导出结果 */}
          {result && !isExporting && (
            <>
              <div className="flex items-center gap-3 p-4 rounded-lg bg-[#0D1F0D] border border-green-500/20">
                <CheckCircle2 size={20} className="text-green-400 shrink-0" />
                <div>
                  <p className="text-[13px] font-medium text-green-300">草稿生成成功</p>
                  <p className="text-[11px] text-green-400/60 mt-0.5">
                    共 {result.videoCount} 个视频片段，总时长 {result.totalDurationSec.toFixed(1)} 秒
                  </p>
                </div>
              </div>

              {/* 草稿路径 */}
              <div className="space-y-2">
                <span className="text-[12px] font-medium text-[var(--text-secondary)]">草稿文件位置</span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded bg-[#111] border border-[var(--border-default)] overflow-hidden">
                    <FolderOpen size={14} className="text-[var(--gold-primary)] shrink-0" />
                    <span className="text-[11px] text-[var(--text-secondary)] truncate font-mono">
                      {result.draftPath.replace(/\//g, "\\")}
                    </span>
                  </div>
                  <button onClick={handleCopyPath}
                    className="flex items-center gap-1.5 px-3 py-2 rounded border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer shrink-0">
                    {copied ? <CheckCircle2 size={12} className="text-green-400" /> : <Copy size={12} className="text-[var(--text-tertiary)]" />}
                    <span className="text-[11px] text-[var(--text-secondary)]">{copied ? "已复制" : "复制路径"}</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* 操作教程 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Info size={14} className="text-[var(--gold-primary)]" />
              <span className="text-[13px] font-medium text-[var(--text-primary)]">导入剪映教程</span>
            </div>

            {/* 方法一 */}
            <div className="p-4 rounded-lg bg-[#111] border border-[var(--border-default)] space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded bg-[var(--gold-primary)] text-black text-[11px] font-bold flex items-center justify-center">1</span>
                <span className="text-[12px] font-medium text-[var(--text-primary)]">推荐方法：直接导入</span>
              </div>
              <div className="space-y-2 pl-7">
                <Step num="①" text="打开剪映专业版" />
                <Step num="②" text="在首页找到「导入草稿」或「导入项目」按钮" />
                <Step num="③" text='选择上方显示的草稿文件夹路径' />
                <Step num="④" text="剪映会自动加载视频到时间线，即可开始编辑" />
              </div>
            </div>

            {/* 方法二 */}
            <div className="p-4 rounded-lg bg-[#111] border border-[var(--border-default)] space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded bg-[#333] text-[var(--text-secondary)] text-[11px] font-bold flex items-center justify-center">2</span>
                <span className="text-[12px] font-medium text-[var(--text-primary)]">备选方法：手动复制</span>
              </div>
              <div className="space-y-2 pl-7">
                <Step num="①" text="打开剪映 → 设置 → 找到「草稿存储位置」并复制路径" />
                <Step num="②" text="将生成的草稿文件夹整体复制到剪映的草稿目录中" />
                <Step num="③" text="重启剪映，草稿将自动出现在首页项目列表中" />
              </div>
              <div className="mt-2 p-2.5 rounded bg-[#1A1510] border border-[#C9A96220]">
                <p className="text-[10px] text-[var(--gold-primary)] leading-relaxed">
                  💡 默认草稿路径：C:\Users\你的用户名\AppData\Local\JianyingPro\User Data\Projects\com.lveditor.draft\
                </p>
              </div>
            </div>

            {/* 注意事项 */}
            <div className="p-3 rounded-lg bg-[#0A0A0A] border border-[var(--border-default)] space-y-1.5">
              <span className="text-[11px] font-medium text-[var(--text-secondary)]">注意事项</span>
              <ul className="space-y-1 text-[10px] text-[var(--text-muted)] leading-relaxed list-disc list-inside">
                <li>草稿引用了原始视频文件的绝对路径，请勿移动或删除 outputs/videos/ 中的源文件</li>
                <li>如果剪映版本过新（2024年末+），可能需要使用「导入草稿」而非手动复制</li>
                <li>导入后画布比例将自动匹配视频生成时的设置</li>
                <li>多个视频会按生成顺序排列在时间线上</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-[var(--border-default)] bg-[#0D0D0D]">
          {result && (
            <button onClick={() => {
              // 用系统文件管理器打开草稿目录
              window.open(`/api/local-file?action=open-folder&path=${encodeURIComponent(result.draftPath)}`, "_blank");
            }} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-default)] hover:border-[var(--gold-primary)] transition cursor-pointer">
              <ExternalLink size={12} className="text-[var(--text-tertiary)]" />
              <span className="text-[11px] text-[var(--text-secondary)]">打开文件夹</span>
            </button>
          )}
          <button onClick={onClose}
            className="px-4 py-1.5 rounded bg-[var(--gold-primary)] text-black text-[12px] font-medium hover:brightness-110 transition cursor-pointer">
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

// 教程步骤组件
function Step({ num, text }: { num: string; text: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[11px] text-[var(--gold-primary)] font-mono shrink-0">{num}</span>
      <ArrowRight size={10} className="text-[var(--text-muted)] mt-0.5 shrink-0" />
      <span className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{text}</span>
    </div>
  );
}
