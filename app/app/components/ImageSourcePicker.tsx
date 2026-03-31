"use client";

/**
 * 图片来源选择器 — 本地上传 / 即梦图库
 * 替代直接打开文件选择器，提供从即梦图库导入的选项
 * 所有上传图片按钮点击后弹出此组件
 */

import { useState, useCallback } from "react";
import { Upload, ImageIcon, X } from "lucide-react";
import JimengLibraryModal from "./JimengLibraryModal";

// ═══════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════

interface ImageSourcePickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** 选择完成回调，返回图片的 data URL */
  onImageSelected: (dataUrl: string) => void;
  /** 文件类型过滤，默认 "image/*" */
  accept?: string;
  /** 弹窗标题 */
  title?: string;
  /** 文件大小限制(MB)，默认 50 */
  maxSizeMB?: number;
}

// ═══════════════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════════════

export default function ImageSourcePicker({
  isOpen,
  onClose,
  onImageSelected,
  accept,
  title,
  maxSizeMB,
}: ImageSourcePickerProps) {
  const [showLibrary, setShowLibrary] = useState(false);

  // 本地上传
  const handleLocalUpload = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept || "image/*";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const limit = (maxSizeMB || 50) * 1024 * 1024;
      if (file.size > limit) {
        alert(`图片过大，请使用小于 ${maxSizeMB || 50}MB 的图片`);
        return;
      }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        onImageSelected(dataUrl);
        onClose();
      } catch (err) {
        console.error("[ImageSourcePicker] 文件读取失败:", err);
        alert("文件读取失败，请重试");
      }
    };
    input.click();
  }, [accept, maxSizeMB, onImageSelected, onClose]);

  // 即梦图库选中
  const handleLibrarySelect = useCallback(
    (dataUrl: string) => {
      onImageSelected(dataUrl);
      onClose();
      setShowLibrary(false);
    },
    [onImageSelected, onClose]
  );

  if (!isOpen && !showLibrary) return null;

  return (
    <>
      {/* 来源选择弹窗 */}
      {isOpen && !showLibrary && (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50"
          onClick={onClose}
        >
          <div
            className="flex flex-col w-[380px] bg-[var(--bg-page)] border border-[var(--border-default)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题 */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-default)]">
              <span className="text-[14px] font-semibold text-[var(--text-primary)]">
                {title || "选择图片来源"}
              </span>
              <button
                onClick={onClose}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* 两个选项 */}
            <div className="flex flex-col gap-3 p-5">
              {/* 本地上传 */}
              <button
                onClick={handleLocalUpload}
                className="flex items-center gap-3 px-4 py-4 border border-[var(--border-default)] hover:border-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer group"
              >
                <div className="flex items-center justify-center w-10 h-10 bg-[var(--bg-surface)] border border-[var(--border-default)] group-hover:border-[var(--gold-primary)] transition">
                  <Upload
                    size={20}
                    className="text-[var(--text-muted)] group-hover:text-[var(--gold-primary)] transition"
                  />
                </div>
                <div className="flex flex-col items-start gap-0.5">
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">
                    本地上传
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    从电脑中选择图片文件
                  </span>
                </div>
              </button>

              {/* 即梦图库 */}
              <button
                onClick={() => setShowLibrary(true)}
                className="flex items-center gap-3 px-4 py-4 border border-[var(--border-default)] hover:border-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer group"
              >
                <div className="flex items-center justify-center w-10 h-10 bg-[var(--bg-surface)] border border-[var(--border-default)] group-hover:border-[var(--gold-primary)] transition">
                  <ImageIcon
                    size={20}
                    className="text-[var(--text-muted)] group-hover:text-[var(--gold-primary)] transition"
                  />
                </div>
                <div className="flex flex-col items-start gap-0.5">
                  <span className="text-[13px] font-medium text-[var(--text-primary)]">
                    即梦图库
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    从即梦生图历史中选择
                  </span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 即梦图片库弹窗 */}
      <JimengLibraryModal
        isOpen={showLibrary}
        onClose={() => setShowLibrary(false)}
        onSelect={handleLibrarySelect}
      />
    </>
  );
}
