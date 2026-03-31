"use client";

/**
 * 即梦图片库弹窗 — 从磁盘读取即梦生图历史图片
 * 用于在 feicai 工作台任何位置选择即梦生成的图片
 * 图片读取使用本地磁盘 URL（/api/jimeng-image?key=xxx），不依赖浏览器存储
 */

import { useState, useEffect, useCallback } from "react";
import { X, Search, Loader, FolderOpen, CheckCircle2, RefreshCw } from "lucide-react";

// ═══════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════

interface JimengLibraryItem {
  key: string;
  filename: string;
  size?: number;
  createdAt: number;
}

interface JimengLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 选择后回调，返回图片的 data URL（已从磁盘读取并转换） */
  onSelect: (imageDataUrl: string) => void;
  /** 是否支持多选（暂仅支持单选） */
  multiple?: boolean;
  /** 弹窗标题 */
  title?: string;
}

// ═══════════════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════════════

export default function JimengLibraryModal({
  isOpen,
  onClose,
  onSelect,
  multiple,
  title,
}: JimengLibraryModalProps) {
  const [images, setImages] = useState<JimengLibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  // 加载图片列表（从磁盘读取）
  useEffect(() => {
    if (!isOpen) return;
    setSelectedKeys(new Set());
    setSearch("");
    loadImages();
  }, [isOpen]);

  const loadImages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/jimeng-image?list=1");
      const data = await res.json();
      setImages(data.files || []);
    } catch (err) {
      console.error("[JimengLibraryModal] 加载图片库失败:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleSelect = useCallback(
    (key: string) => {
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else {
          if (!multiple) next.clear(); // 单选模式
          next.add(key);
        }
        return next;
      });
    },
    [multiple]
  );

  // 双击快速选择
  const handleDoubleClick = useCallback(
    async (key: string) => {
      setImporting(true);
      try {
        const imgUrl = `/api/jimeng-image?key=${key}`;
        const res = await fetch(imgUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        onSelect(dataUrl);
        onClose();
      } catch (err) {
        console.error("[JimengLibraryModal] 导入失败:", err);
      } finally {
        setImporting(false);
      }
    },
    [onSelect, onClose]
  );

  // 确认选择 — 获取图片并转为 data URL 返回
  const handleConfirm = useCallback(async () => {
    if (selectedKeys.size === 0) return;
    setImporting(true);
    try {
      const key = [...selectedKeys][0]; // 单选
      const imgUrl = `/api/jimeng-image?key=${key}`;
      const res = await fetch(imgUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      onSelect(dataUrl);
      onClose();
    } catch (err) {
      console.error("[JimengLibraryModal] 导入失败:", err);
      alert("图片导入失败，请重试");
    } finally {
      setImporting(false);
    }
  }, [selectedKeys, onSelect, onClose]);

  if (!isOpen) return null;

  // 按时间戳前缀分组（key 格式: jimeng-{timestamp}-{index}）
  const filtered = images.filter(
    (img) =>
      !search ||
      img.filename.toLowerCase().includes(search.toLowerCase()) ||
      img.key.toLowerCase().includes(search.toLowerCase())
  );
  const groupMap = new Map<string, JimengLibraryItem[]>();
  for (const img of filtered) {
    const m = img.key.match(/^jimeng-(\d+)-/);
    const groupKey = m ? m[1] : img.key;
    if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
    groupMap.get(groupKey)!.push(img);
  }
  const groups = [...groupMap.entries()].sort((a, b) => Number(b[0]) - Number(a[0]));

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="flex flex-col w-[820px] max-h-[80vh] bg-[var(--bg-page)] border border-[var(--border-default)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-default)] shrink-0">
          <span className="text-[15px] font-semibold text-[var(--text-primary)]">
            {title || "即梦图片库"}
          </span>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* 搜索 + 统计 */}
        <div className="flex items-center gap-3 px-5 py-2.5 border-b border-[var(--border-default)] shrink-0">
          <div className="flex items-center gap-2 flex-1 max-w-[300px] px-3 py-1.5 bg-[var(--bg-surface)] border border-[var(--border-default)]">
            <Search size={14} className="text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索图片..."
              className="flex-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
          <button
            onClick={loadImages}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-[var(--border-default)] transition cursor-pointer"
          >
            <RefreshCw size={12} /> 刷新
          </button>
          <span className="text-[11px] text-[var(--text-muted)] ml-auto">
            共 {filtered.length} 张
          </span>
        </div>

        {/* 图片列表 */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <Loader size={24} className="text-[var(--gold-primary)] animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <FolderOpen size={32} className="text-[var(--text-muted)]" />
              <span className="text-[13px] text-[var(--text-muted)]">
                {images.length === 0
                  ? "图片库为空，请先在即梦生图中生成图片"
                  : "无匹配结果"}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {groups.map(([groupKey, imgs]) => (
                <div key={groupKey} className="flex flex-col gap-2">
                  {/* 组标题 */}
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-[var(--text-muted)]">
                      {new Date(
                        Number(groupKey) || imgs[0].createdAt
                      ).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {imgs.length}张
                    </span>
                  </div>
                  {/* 组内图片网格 */}
                  <div className="grid grid-cols-5 gap-2">
                    {imgs.map((img) => {
                      const isSelected = selectedKeys.has(img.key);
                      return (
                        <div
                          key={img.key}
                          onClick={() => toggleSelect(img.key)}
                          onDoubleClick={() => handleDoubleClick(img.key)}
                          className={`relative overflow-hidden cursor-pointer transition border-2 ${
                            isSelected
                              ? "border-[var(--gold-primary)] shadow-[0_0_8px_rgba(201,169,98,0.3)]"
                              : "border-[var(--border-default)] hover:border-[var(--text-muted)]"
                          }`}
                        >
                          <div className="w-full aspect-[4/3] bg-black/20 flex items-center justify-center">
                            <img
                              src={`/api/jimeng-image?key=${img.key}`}
                              alt={img.filename}
                              className="max-w-full max-h-full object-contain"
                              loading="lazy"
                            />
                          </div>
                          {isSelected && (
                            <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-[var(--gold-primary)] flex items-center justify-center">
                              <CheckCircle2
                                size={12}
                                className="text-[#0A0A0A]"
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border-default)] shrink-0">
          <span className="text-[11px] text-[var(--text-muted)]">
            {selectedKeys.size > 0
              ? `已选 ${selectedKeys.size} 张 · 双击可快速导入`
              : "点击选择图片 · 双击可快速导入"}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-[12px] text-[var(--text-secondary)] border border-[var(--border-default)] hover:border-[var(--text-muted)] transition cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedKeys.size === 0 || importing}
              className="px-4 py-1.5 text-[12px] font-medium bg-[var(--gold-primary)] text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {importing ? "导入中..." : "确认导入"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
