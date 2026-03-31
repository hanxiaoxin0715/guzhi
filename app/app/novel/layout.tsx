"use client";

import NovelSidebar from "./_components/NovelSidebar";

export default function NovelLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex h-screen w-full text-[var(--text-primary)] font-ui overflow-hidden bg-[var(--bg-page)]">
      <NovelSidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {children}
      </div>
    </div>
  );
}
