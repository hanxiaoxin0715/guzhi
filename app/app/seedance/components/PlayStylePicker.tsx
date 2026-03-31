"use client";

import { useState } from "react";
import { X, Sparkles, BookOpen } from "lucide-react";
import StoryboardPicker from "./StoryboardPicker";

// ═══════════════════════════════════════════════════════════
// 玩法配置
// ═══════════════════════════════════════════════════════════

export interface PlayStyleConfig {
  id: number;
  emoji: string;
  title: string;
  desc: string;
  /** 注入 AI 提示词的玩法方向说明 */
  direction: string;
  tags: string[];
  matType: "纯图片" | "图+视频" | "图+音频";
  /** 封面渐变色（图片加载失败时的兜底背景） */
  coverGradient: string;
}

export const PLAY_STYLES: PlayStyleConfig[] = [
  {
    id: 1,
    emoji: "🎭",
    title: "多图角色一致性",
    desc: "多张角色图锁定特征，防止角色漂移",
    direction:
      "多图角色一致性：重点保持角色外貌特征高度一致，强调面部细节、服装、发型的稳定性；" +
      "运用 @1 @2 等多张参考图锁定视觉特征，避免角色在运动中产生形变漂移",
    tags: ["多张图片"],
    matType: "纯图片",
    coverGradient: "from-[#2A1A2E] to-[#1A0A1E]",
  },
  {
    id: 2,
    emoji: "🌅",
    title: "场景+角色分离",
    desc: "角色图+场景图组合，灵活换背景换风格",
    direction:
      "场景与角色分离组合：将 @1 角色图与 @2 场景/背景图进行空间合成，" +
      "角色与环境无缝融合；保持角色主体完整性的同时让背景氛围与场景图一致",
    tags: ["角色图", "场景图"],
    matType: "纯图片",
    coverGradient: "from-[#1A2A1A] to-[#0A1A0A]",
  },
  {
    id: 3,
    emoji: "🎬",
    title: "视频运镜参考",
    desc: "参考视频复刻镜头运动轨迹",
    direction:
      "视频运镜参考：以 @2 参考视频的镜头运动方式为模板，对 @1 主体进行相似运镜拍摄；" +
      "精确还原推拉摇移的镜头语言，包括景别变化、焦距感和运动节奏",
    tags: ["图片", "参考视频"],
    matType: "图+视频",
    coverGradient: "from-[#1A1A2A] to-[#0A0A1A]",
  },
  {
    id: 4,
    emoji: "🎵",
    title: "音频驱动卡点",
    desc: "图片+音乐，视频节奏与音频拍点同步",
    direction:
      "音频驱动卡点：以 @2 音频的节拍为时间轴，@1 图片内容在音乐强拍处产生视觉冲击；" +
      "画面动效在鼓点/节拍时刻做出明显的运动或切换，实现音画同步",
    tags: ["图片", "音乐"],
    matType: "图+音频",
    coverGradient: "from-[#2A2A0A] to-[#1A1A00]",
  },
  {
    id: 5,
    emoji: "🎨",
    title: "风格参考迁移",
    desc: "风格截图+新内容，复刻电影感/画风",
    direction:
      "风格参考迁移：将 @1 风格参考图的色调、光影、构图美学迁移到新内容上；" +
      "完全还原参考图的视觉质感——胶片颗粒、色彩分级、景深效果",
    tags: ["风格截图", "内容图"],
    matType: "纯图片",
    coverGradient: "from-[#2A1800] to-[#1A0A00]",
  },
  {
    id: 6,
    emoji: "📖",
    title: "多图叙事串联",
    desc: "多张分镜图自然过渡，讲述完整故事",
    direction:
      "多图叙事串联：将 @1 @2 @3 等多张分镜图串联成连贯叙事，每幕画面自然过渡；" +
      "通过运镜衔接和时间流逝感，让多个静态画面形成完整的故事线",
    tags: ["多张分镜图"],
    matType: "纯图片",
    coverGradient: "from-[#1A2A2A] to-[#0A1A1A]",
  },
  {
    id: 7,
    emoji: "🎤",
    title: "角色+人声配音",
    desc: "角色图+人声音频，口型同步运动",
    direction:
      "角色人声配音驱动：以 @2 人声音频为口型驱动源，@1 角色图的嘴部运动与语音精确同步；" +
      "保持角色整体姿态自然，面部表情随声音情感做细微变化",
    tags: ["角色图", "人声音频"],
    matType: "图+音频",
    coverGradient: "from-[#2A0A1A] to-[#1A000A]",
  },
];

// ═══════════════════════════════════════════════════════════
// 筛选器
// ═══════════════════════════════════════════════════════════

const FILTER_LABELS = ["全部", "纯图片", "图+视频", "图+音频"] as const;
type FilterLabel = (typeof FILTER_LABELS)[number];

const PAGE_SIZE = 4;

// ═══════════════════════════════════════════════════════════
// Props
// ═══════════════════════════════════════════════════════════

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * 用户点击「生成提示词」后回调
   * @param style 选中的玩法配置
   * @param storyDesc 关联的剧情描述（可选）
   */
  onConfirm: (style: PlayStyleConfig, storyDesc?: string) => void;
}

// ═══════════════════════════════════════════════════════════
// PlayStylePicker 组件
// ═══════════════════════════════════════════════════════════

export default function PlayStylePicker({ open, onClose, onConfirm }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<FilterLabel>("全部");
  const [page, setPage] = useState(1);
  const [showStoryboard, setShowStoryboard] = useState(false);
  const [storyDesc, setStoryDesc] = useState("");

  if (!open) return null;

  // 筛选后的玩法列表
  const filtered =
    filter === "全部"
      ? PLAY_STYLES
      : PLAY_STYLES.filter((s) =>
          filter === "图+视频"
            ? s.matType === "图+视频"
            : filter === "图+音频"
              ? s.matType === "图+音频"
              : s.matType === "纯图片",
        );

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedStyle = PLAY_STYLES.find((s) => s.id === selectedId);

  // 筛选切换时重置页码和选中
  function handleFilterChange(f: FilterLabel) {
    setFilter(f);
    setPage(1);
    setSelectedId(null);
  }

  function handleConfirm() {
    if (!selectedStyle) return;
    onConfirm(selectedStyle, storyDesc || undefined);
  }

  return (
    <>
      {/* 主弹窗 */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
        onClick={onClose}
      >
        <div
          className="relative flex flex-col bg-[#161616] border border-[var(--border-default)] shadow-2xl"
          style={{ width: 1200, maxWidth: "96vw", maxHeight: "90vh" }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header ── */}
          <div className="flex items-start justify-between px-8 pt-6 pb-4 border-b border-[var(--border-default)] shrink-0">
            <div>
              <h2 className="text-[18px] font-semibold text-[var(--text-primary)] flex items-center gap-2">
                <span className="text-[var(--gold-primary)]">✦</span>
                选择主玩法
              </h2>
              <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                AI 将结合你的&nbsp;
                <span className="text-[var(--text-secondary)]">
                  参考图 + 时长 + 玩法方向 + 剧情内容（可选）
                </span>
                &nbsp;生成提示词
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer mt-1"
            >
              <X size={18} />
            </button>
          </div>

          {/* ── 筛选栏 ── */}
          <div className="flex items-center gap-2 px-8 py-3 border-b border-[var(--border-default)] shrink-0">
            {FILTER_LABELS.map((f) => {
              const count =
                f === "全部"
                  ? PLAY_STYLES.length
                  : PLAY_STYLES.filter((s) =>
                      f === "图+视频"
                        ? s.matType === "图+视频"
                        : f === "图+音频"
                          ? s.matType === "图+音频"
                          : s.matType === "纯图片",
                    ).length;
              return (
                <button
                  key={f}
                  onClick={() => handleFilterChange(f)}
                  className={`px-3 py-1 text-[12px] rounded-full border transition cursor-pointer ${
                    filter === f
                      ? "border-[var(--gold-primary)] text-[var(--gold-primary)] bg-[var(--gold-primary)]/10"
                      : "border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  {f}
                  {f !== "全部" ? ` ${count}` : ` ${count}`}
                </button>
              );
            })}
          </div>

          {/* ── 卡片区 ── */}
          <div className="px-8 py-6 shrink-0">
            {pageItems.length === 0 ? (
              <div className="flex items-center justify-center h-[270px] text-[var(--text-muted)] text-[13px]">
                暂无匹配的玩法
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-4">
                {pageItems.map((style) => {
                  const isSelected = selectedId === style.id;
                  return (
                    <button
                      key={style.id}
                      onClick={() => setSelectedId(isSelected ? null : style.id)}
                      className={`relative flex flex-col border-2 transition cursor-pointer text-left ${
                        isSelected
                          ? "border-[var(--gold-primary)] bg-[#1A1200]"
                          : "border-[var(--border-default)] bg-[#1A1A1A] hover:border-[var(--text-muted)]"
                      }`}
                      style={{ height: 270 }}
                    >
                      {/* 封面图区 */}
                      <div
                        className={`relative w-full bg-gradient-to-br ${style.coverGradient} flex items-center justify-center shrink-0 overflow-hidden`}
                        style={{ height: 120 }}
                      >
                        {/* 封面图片（如已生成，放在 public/play-styles/ 目录） */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/play-styles/style-0${style.id}.jpg`}
                          alt={style.title}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.display = "none";
                          }}
                        />
                        {/* Emoji 兜底（封面图不存在时显示） */}
                        <span className="absolute text-5xl select-none pointer-events-none opacity-60">
                          {style.emoji}
                        </span>
                      </div>

                      {/* 内容区 */}
                      <div className="flex flex-col flex-1 px-4 py-3 gap-2 min-h-0">
                        {/* 标题行 */}
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                            {style.emoji} {style.title}
                          </span>
                          {isSelected && (
                            <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-sm bg-[var(--gold-primary)] text-[#0A0A0A] font-medium leading-none">
                              已选中
                            </span>
                          )}
                        </div>

                        {/* 描述 */}
                        <p className="text-[12px] text-[var(--text-muted)] leading-relaxed flex-1 overflow-hidden">
                          {style.desc}
                        </p>

                        {/* 素材标签 */}
                        <div className="flex gap-1 flex-wrap">
                          {style.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[10px] px-1.5 py-0.5 rounded-sm bg-[#252525] text-[var(--text-muted)] border border-[var(--border-default)]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── 分页控件 ── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pb-2 shrink-0">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-7 h-7 flex items-center justify-center text-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition"
              >
                ‹
              </button>
              {Array.from({ length: totalPages }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i + 1)}
                  className={`rounded-full transition cursor-pointer ${
                    page === i + 1
                      ? "bg-[var(--gold-primary)] w-2 h-2"
                      : "bg-[var(--text-muted)] opacity-40 w-1.5 h-1.5"
                  }`}
                />
              ))}
              <span className="text-[11px] text-[var(--text-muted)]">
                第 {page} 页 / 共 {totalPages} 页
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="w-7 h-7 flex items-center justify-center text-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition"
              >
                ›
              </button>
            </div>
          )}

          {/* ── 底栏 ── */}
          <div className="flex items-center justify-between gap-4 px-8 py-4 border-t border-[var(--border-default)] shrink-0 bg-[#111111]">
            {/* 左：已选信息 */}
            <div className="flex items-center gap-2 text-[12px] min-w-0 flex-1">
              {selectedStyle ? (
                <span className="text-[var(--gold-primary)] truncate">
                  ✦ {selectedStyle.title}
                </span>
              ) : (
                <span className="text-[var(--text-muted)]">请选择一种玩法</span>
              )}
              {storyDesc && (
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-sm bg-[#1A1200] border border-[var(--gold-primary)]/40 text-[var(--gold-primary)]/80">
                  已关联分镜
                </span>
              )}
            </div>

            {/* 中：关联分镜按钮 */}
            <button
              onClick={() => setShowStoryboard(true)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[12px] border transition cursor-pointer ${
                storyDesc
                  ? "border-[var(--gold-primary)]/60 text-[var(--gold-primary)]/80 bg-[#1A1200]"
                  : "border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
              }`}
            >
              <BookOpen size={12} />
              {storyDesc ? "更换关联分镜" : "📋 关联剧情分镜（可选）"}
            </button>

            {/* 右：操作按钮 */}
            <div className="flex gap-2 shrink-0">
              <button
                onClick={onClose}
                className="px-4 py-2 text-[12px] border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                disabled={!selectedStyle}
                className="px-4 py-2 text-[12px] bg-[var(--gold-primary)] text-[#0A0A0A] font-semibold hover:brightness-110 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                <Sparkles size={12} />
                ✦ 生成提示词
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 嵌套分镜选择弹窗（z-[60]，高于主弹窗 z-50） */}
      <StoryboardPicker
        open={showStoryboard}
        onClose={() => setShowStoryboard(false)}
        onConfirm={(desc) => {
          setStoryDesc(desc);
          setShowStoryboard(false);
        }}
        currentDesc={storyDesc}
      />
    </>
  );
}
