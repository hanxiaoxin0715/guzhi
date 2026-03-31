"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  BookOpen,
  FileText,
  PenTool,
  Users,
  Settings,
  Sparkles,
  RefreshCw,
  Feather,
} from "lucide-react";

const navItems = [
  { icon: LayoutDashboard, label: "项目总览", href: "/novel" },
  { icon: Sparkles, label: "AI 大纲生成", href: "/novel/outline" },
  { icon: Feather, label: "短篇小说", href: "/novel/short-story" },
  { icon: BookOpen, label: "章节内容生成", href: "/novel/chapter" },
  { icon: PenTool, label: "写作工作台", href: "/novel/writing" },
  { icon: Users, label: "角色管理", href: "/novel/characters" },
  { icon: RefreshCw, label: "剧本转换", href: "/novel/script" },
  { icon: Settings, label: "设置", href: "/novel/settings" },
];

export default function NovelSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 flex flex-col justify-between w-[240px] h-screen bg-[var(--bg-page)] border-r border-[var(--border-default)] px-4 pt-6 pb-5 shrink-0">
      {/* Top Section */}
      <div className="flex flex-col gap-6 w-full flex-1 min-h-0">
        {/* Logo */}
        <div className="flex items-center gap-3 w-full px-2">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--gold-primary)] via-[#D4B777] to-[#8B7355] shadow-lg shadow-[var(--gold-primary)]/30">
              <span className="font-serif text-[16px] font-bold text-white drop-shadow-sm">
                M
              </span>
            </div>
            <div className="flex flex-col">
              <span className="font-serif text-[15px] font-semibold text-[var(--text-primary)] tracking-wide">
                AI 创作工作坊
              </span>
              <span className="font-ui text-[9px] text-[var(--text-secondary)] tracking-[2px]">
                NOVEL WORKSHOP
              </span>
            </div>
        </div>

        {/* Navigation */}
        <nav className="flex flex-col gap-1 w-full overflow-y-auto overflow-x-hidden scrollbar-thin">
          {navItems.map((item) => {
            const isActive =
              item.href === "/novel"
                ? pathname === "/novel"
                : pathname.startsWith(item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={true}
                className={`group relative flex items-center gap-3 py-2.5 px-3 rounded-lg text-[13px] transition-all duration-300 no-underline ${
                  isActive
                    ? "text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {/* 渐变背景 */}
                {isActive && (
                  <div className="absolute inset-0 bg-gradient-to-r from-[var(--gold-primary)]/20 to-transparent rounded-lg -z-10" />
                )}
                
                <Icon
                  size={18}
                  className={`transition-all duration-300 ${
                    isActive
                      ? "text-[var(--gold-primary)] drop-shadow-[0_0_8px_rgba(201,169,98,0.5)]"
                      : "group-hover:text-[var(--gold-primary)]/70"
                  }`}
                />
                <span
                  className={`transition-all duration-300 ${
                    isActive
                      ? "font-medium"
                      : "font-normal group-hover:translate-x-1"
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Bottom - User */}
      <div className="flex items-center gap-3 pt-4 border-t border-[var(--border-subtle)] w-full shrink-0 px-2">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--gold-primary)]/20 to-transparent border border-[var(--gold-primary)]/30">
          <span className="font-serif text-[12px] font-semibold text-[var(--gold-primary)]">
            M
          </span>
        </div>
        <div className="flex flex-col gap-0">
          <span className="text-[12px] font-medium text-[var(--text-primary)]">
            孤执 / 小说创作者
          </span>
        </div>
      </div>
    </aside>
  );
}
