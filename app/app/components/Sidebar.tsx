"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  GitBranch,
  Sparkles,
  Film,
  FileText,
  BookOpen,
  Settings,
  Wrench,
  FileCode,
  X,
  Archive,
  Trash2,
  Bot,
  Clapperboard,
  Save,
  Loader,
  ImageIcon,
  ScrollText,
  Lock,
  GraduationCap,
  ShieldAlert,
  Package,
} from "lucide-react";
import {
  archiveCurrentWorkspace,
  clearCurrentWorkspace,
  hasWorkspaceData,
  loadProjects,
  overwriteProject,
  getActiveProjectId,
  type ArchivedProject,
} from "@/app/lib/projects";

const navItems = [
  { icon: LayoutDashboard, label: "小说项目总览", href: "/novel" },
  { icon: Sparkles, label: "AI 写作助手", href: "/novel/writing" },
  { icon: Clapperboard, label: "剧本转换器", href: "/novel/script" },
  { icon: Wrench, label: "创作工具", href: "/novel/tools" },
  { icon: Settings, label: "设置", href: "/settings" },
  { icon: ScrollText, label: "更新日志", href: "/changelog" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [resetting, setResetting] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [archiveName, setArchiveName] = useState("");
  const [projectsList, setProjectsList] = useState<ArchivedProject[]>([]);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showNewProjectModal) {
      setTimeout(() => inputRef.current?.focus(), 100);
      loadProjects().then(setProjectsList);
    }
  }, [showNewProjectModal]);

  // Escape key to close new project modal
  useEffect(() => {
    if (!showNewProjectModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowNewProjectModal(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showNewProjectModal]);

  const doReset = useCallback(async () => {
    await clearCurrentWorkspace();
    // Mark fresh start so studio won't auto-load old episodes
    localStorage.setItem("feicai-new-project", "1");
    window.location.href = "/";
  }, []);

  const handleArchiveAndReset = async () => {
    const name = archiveName.trim();
    if (!name) return;
    setResetting(true);
    try {
      await archiveCurrentWorkspace(name);
      await doReset();
    } catch (e) {
      console.error("归档失败:", e);
      alert("归档失败，请重试");
      setResetting(false);
    }
  };

  const handleSkipAndReset = async () => {
    setResetting(true);
    try {
      await doReset();
    } catch (e) {
      console.error("重置失败:", e);
      alert("重置失败，请重试");
      setResetting(false);
    }
  };

  const handleOverwrite = async (projectId: string, projectName: string) => {
    if (!confirm(`确定要将当前工作台数据覆盖保存到「${projectName}」吗？\n\n原有的归档数据将被替换。`)) return;
    setResetting(true);
    try {
      await overwriteProject(projectId);
      await doReset();
    } catch (e) {
      console.error("覆盖保存失败:", e);
      alert("覆盖保存失败，请重试");
      setResetting(false);
    }
  };

  const handleNewProject = async () => {
    if (!(await hasWorkspaceData())) {
      // No data, just reset directly
      handleSkipAndReset();
      return;
    }
    setShowNewProjectModal(true);
  };

  // ── 手动保存：快速存档当前工作台 ──
  const handleManualSave = async () => {
    if (saving || resetting) return;
    const has = await hasWorkspaceData();
    if (!has) return;
    setSaving(true);
    try {
      const activeId = await getActiveProjectId();
      if (activeId) {
        await overwriteProject(activeId);
      } else {
        // 无活跃项目，自动创建存档，名称从当前剧本获取
        const scriptId = localStorage.getItem("feicai-pipeline-script-id");
        const chapterJson = localStorage.getItem("feicai-pipeline-script-chapter");
        let name = "未命名项目";
        if (scriptId) {
          try {
            const { loadScriptsDB } = await import("@/app/lib/scriptDB");
            const scripts = await loadScriptsDB();
            const s = scripts.find(sc => sc.id === scriptId);
            if (s) name = s.title;
          } catch { /* ignore */ }
        }
        if (chapterJson) {
          try {
            const ch = JSON.parse(chapterJson);
            if (ch?.title) name = `${name}·${ch.title}`;
          } catch { /* ignore */ }
        }
        await archiveCurrentWorkspace(name);
      }
    } catch (e) {
      console.error("手动保存失败:", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <aside className="sticky top-0 flex flex-col justify-between w-[260px] h-screen bg-[var(--bg-page)] border-r border-[var(--border-default)] px-6 pt-7 pb-6 shrink-0">
      {/* Top Section */}
      <div className="flex flex-col gap-8 w-full flex-1 min-h-0">
        {/* Logo + 手动保存 */}
        <div className="flex items-center gap-3 w-full">
            <div className="flex items-center justify-center w-9 h-9 border border-[var(--gold-primary)]">
              <span className="font-serif text-[18px] font-semibold text-[var(--gold-primary)]">
                F
              </span>
            </div>
            <span className="font-ui text-[16px] font-medium text-[var(--text-primary)] tracking-[3px]">
              FEICAI
            </span>
            <button
              onClick={handleManualSave}
              disabled={saving || resetting}
              title="保存当前工作台"
              className="flex items-center justify-center w-8 h-8 ml-auto border border-[var(--border-default)] text-[var(--text-muted)] hover:border-[var(--gold-primary)] hover:text-[var(--gold-primary)] transition cursor-pointer disabled:opacity-40 disabled:cursor-default rounded"
            >
              {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />}
            </button>
        </div>

        {/* 归档 / 清除 快捷操作 */}
        <div className="flex items-center gap-2 w-full -mt-4">
          <button
            onClick={handleNewProject}
            disabled={resetting}
            className="flex items-center gap-1.5 flex-1 justify-center py-2 bg-[var(--gold-primary)] text-[11px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-50 rounded"
          >
            <Archive size={12} />
            归档并新建
          </button>
          <button
            onClick={() => {
              if (!hasWorkspaceData()) { handleSkipAndReset(); return; }
              if (confirm("确定要直接清除当前工作台所有数据吗？\n\n此操作不可恢复！")) handleSkipAndReset();
            }}
            disabled={resetting}
            className="flex items-center gap-1.5 flex-1 justify-center py-2 border border-red-500/40 text-[11px] font-medium text-red-400 hover:bg-red-500/10 transition cursor-pointer disabled:opacity-50 rounded"
          >
            <Trash2 size={12} />
            重新开始创作
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex flex-col gap-1 w-full overflow-y-auto overflow-x-hidden scrollbar-thin">
          {navItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            const isLocked = !!(item as { locked?: boolean }).locked;

            if (isLocked) {
              return (
                <div
                  key={item.href}
                  title="此功能暂停维护，后续版本开放"
                  className="group flex items-center gap-4 py-3 px-3 -mx-3 w-[calc(100%+24px)] rounded opacity-40 cursor-not-allowed select-none"
                >
                  <Icon size={20} className="text-[var(--text-muted)]" />
                  <span className="text-[13px] text-[var(--text-muted)] flex-1 truncate">
                    {item.label}
                  </span>
                  <Lock size={12} className="text-[var(--text-muted)] shrink-0" />
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={true}
                className={`group flex items-center gap-4 py-3 px-3 -mx-3 w-[calc(100%+24px)] text-left rounded transition-all duration-200 no-underline ${
                  isActive
                    ? "bg-[#C9A96212] shadow-[inset_0_0_12px_rgba(201,169,98,0.08)]"
                    : "hover:bg-[#ffffff08] hover:shadow-[inset_0_0_20px_rgba(201,169,98,0.06)]"
                }`}
              >
                <Icon
                  size={20}
                  className={`transition-all duration-200 ${
                    isActive
                      ? "text-[var(--gold-primary)] drop-shadow-[0_0_6px_rgba(201,169,98,0.4)]"
                      : "text-[var(--text-secondary)] group-hover:text-[var(--gold-primary)] group-hover:drop-shadow-[0_0_4px_rgba(201,169,98,0.3)]"
                  }`}
                />
                <span
                  className={`text-[14px] transition-all duration-200 ${
                    isActive
                      ? "font-medium text-[var(--text-primary)]"
                      : "font-normal text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]"
                  }`}
                >
                  {item.label}
                </span>
                {(item as { badge?: string }).badge && (
                  <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--gold-primary)] text-[#0A0A0A] tracking-wider shrink-0">
                    {(item as { badge?: string }).badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Bottom - User */}
      <div className="flex items-center gap-3 pt-4 border-t border-[var(--border-subtle)] w-full shrink-0">
        <div className="flex items-center justify-center w-10 h-10 bg-[var(--gold-transparent)] border border-[var(--gold-primary)]">
          <span className="font-serif text-[16px] font-semibold text-[var(--gold-primary)]">
            U
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[14px] font-medium text-[var(--text-primary)]">
            Creator
          </span>
          <span className="text-[12px] font-normal text-[var(--text-secondary)]">
            制片人
          </span>
        </div>
      </div>
    </aside>

    {/* New Project Modal — 必须在 <aside> 外部，避免 sticky 产生的层叠上下文遮挡 */}
    {showNewProjectModal && (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60">
        <div className="flex flex-col gap-5 w-[440px] bg-[var(--bg-page)] border border-[var(--border-default)] rounded-lg p-6 shadow-2xl">
          <div className="flex items-center justify-between">
            <span className="text-[16px] font-semibold text-[var(--text-primary)]">开始新项目</span>
            <button onClick={() => setShowNewProjectModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer"><X size={18} /></button>
          </div>
          <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
            选择归档保存当前数据后再新建，或直接清除开始新章节。
          </p>

          {/* 归档区域 */}
          <div className="flex flex-col gap-2">
            <label className="text-[11px] font-medium text-[var(--text-muted)]">归档项目名称</label>
            <input ref={inputRef} value={archiveName} onChange={(e) => setArchiveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleArchiveAndReset(); }}
              className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
              placeholder="输入项目名称..." />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowNewProjectModal(false)} disabled={resetting}
              className="flex items-center gap-2 flex-1 justify-center py-2.5 border border-[var(--border-default)] rounded text-[13px] font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition cursor-pointer disabled:opacity-50">
              取消
            </button>
            <button onClick={handleArchiveAndReset} disabled={resetting || !archiveName.trim()}
              className="flex items-center gap-2 flex-1 justify-center py-2.5 bg-[var(--gold-primary)] rounded text-[13px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer disabled:opacity-50">
              <Archive size={14} />
              {resetting ? "处理中..." : "归档并新建"}
            </button>
          </div>

          {/* 覆盖已有项目 */}
          {projectsList.length > 0 && (
            <>
              <div className="flex items-center gap-3 text-[12px] text-[var(--text-muted)]">
                <div className="flex-1 h-px bg-[var(--border-default)]" />
                <span>或覆盖已有项目</span>
                <div className="flex-1 h-px bg-[var(--border-default)]" />
              </div>
              <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
                {projectsList.map(p => (
                  <div key={p.id} className="flex items-center justify-between px-3 py-2 bg-[var(--bg-surface)] rounded hover:bg-[#ffffff08] transition">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[13px] text-[var(--text-primary)] truncate">{p.name}</span>
                      <span className="text-[11px] text-[var(--text-muted)] shrink-0">v{p.version || 1}</span>
                    </div>
                    <button onClick={() => handleOverwrite(p.id, p.name)} disabled={resetting}
                      className="px-2 py-1 text-[11px] text-[var(--gold-primary)] border border-[var(--gold-primary)]/30 rounded hover:bg-[var(--gold-transparent)] transition cursor-pointer disabled:opacity-40 shrink-0 ml-2">
                      覆盖
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* 开始新的章节（直接清除） */}
          <div className="flex items-center gap-3 text-[12px] text-[var(--text-muted)]">
            <div className="flex-1 h-px bg-[var(--border-default)]" />
            <span>或不保存直接开始</span>
            <div className="flex-1 h-px bg-[var(--border-default)]" />
          </div>
          <button
            onClick={() => {
              if (confirm("确定要直接清除当前工作台所有数据吗？\n\n此操作不可恢复！")) {
                setShowNewProjectModal(false);
                handleSkipAndReset();
              }
            }}
            disabled={resetting}
            className="flex items-center gap-2 justify-center py-2.5 border border-red-500/40 rounded text-[13px] font-medium text-red-400 hover:bg-red-500/10 transition cursor-pointer disabled:opacity-50"
          >
            <Trash2 size={14} />
            开始新的章节（清除当前数据）
          </button>
        </div>
      </div>
    )}
    </>
  );
}
