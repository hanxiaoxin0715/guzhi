export default function StudioLoading() {
  return (
    <div className="flex h-full bg-[var(--bg-page)]">
      {/* Sidebar placeholder */}
      <div className="w-[260px] h-full bg-[var(--bg-page)] border-r border-[var(--border-default)] shrink-0" />
      {/* Main content skeleton */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-[var(--gold-primary)] border-t-transparent rounded-full animate-spin" />
          <span className="text-[13px] text-[var(--text-muted)]">加载工作台...</span>
        </div>
      </div>
    </div>
  );
}
