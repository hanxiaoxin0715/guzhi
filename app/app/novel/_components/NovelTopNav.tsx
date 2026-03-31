"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  LayoutDashboard,
  BookOpen,
  PenTool,
  Users,
  Settings,
  Sparkles,
  RefreshCw,
  Feather,
} from "lucide-react";

const navItems = [
  { icon: LayoutDashboard, label: "项目", href: "/novel" },
  { icon: Sparkles, label: "大纲", href: "/novel/outline" },
  { icon: Feather, label: "短篇", href: "/novel/short-story" },
  { icon: BookOpen, label: "章节", href: "/novel/chapter" },
  { icon: PenTool, label: "写作", href: "/novel/writing" },
  { icon: Users, label: "角色", href: "/novel/characters" },
  { icon: RefreshCw, label: "剧本", href: "/novel/script" },
  { icon: Settings, label: "设置", href: "/novel/settings" },
];

export default function NovelTopNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 h-12 border-b border-[#1a1a1a] bg-[#0d0d0d] flex items-center justify-between px-5 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded bg-[#272727] flex items-center justify-center">
          <span className="text-[12px] font-semibold text-[#888]">N</span>
        </div>
        <span className="text-[13px] text-[#666]">AI创作</span>
      </div>

      {/* Navigation */}
      <nav className="flex items-center gap-0.5 h-full">
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
              className={`flex items-center gap-1.5 px-3 h-full text-[12px] transition-all duration-150 no-underline border-b-2 ${
                isActive
                  ? "text-[#e0e0e0] border-b-[#444]"
                  : "text-[#666] border-b-transparent hover:text-[#888] hover:bg-[#151515]"
              }`}
            >
              <Icon size={13} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Right side */}
      <div className="w-14"></div>
    </header>
  );
}
