"use client";

import { useState, useEffect } from "react";
import { useTaskQueue, type TaskType } from "../lib/taskQueue";
import { Loader, Zap, Image as ImageIcon, Film, ListTodo } from "lucide-react";

function typeIcon(type: TaskType) {
  if (type === "llm") return <Zap size={11} className="text-blue-400" />;
  if (type === "image") return <ImageIcon size={11} className="text-green-400" />;
  return <Film size={11} className="text-[var(--gold-primary)]" />;
}

function typeLabel(type: TaskType) {
  if (type === "llm") return "文本";
  if (type === "image") return "图像";
  return "视频";
}

function elapsed(startedAt: number) {
  const sec = Math.floor((Date.now() - startedAt) / 1000);
  if (sec < 60) return `${sec}秒`;
  const min = Math.floor(sec / 60);
  return `${min}分${sec % 60}秒`;
}

export default function TaskQueuePanel() {
  const { tasks } = useTaskQueue();
  // Force re-render every second so elapsed timers update
  const [, setTick] = useState(0);
  useEffect(() => {
    if (tasks.length === 0) return;
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [tasks.length]);

  // Only show when there are active tasks
  if (tasks.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col w-[300px] bg-[#1A1A1A] border border-[var(--border-default)] rounded-lg shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between h-9 px-3.5 bg-[#0E0E0E] border-b border-[var(--border-default)]">
        <div className="flex items-center gap-2">
          <ListTodo size={13} className="text-[var(--gold-primary)]" />
          <span className="text-[11px] font-medium text-[var(--text-primary)]">正在生成</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--gold-primary)]/20 text-[var(--gold-primary)] font-medium">
            {tasks.length}
          </span>
        </div>
        <Loader size={12} className="animate-spin text-[var(--gold-primary)]" />
      </div>

      {/* Task list */}
      <div className="flex flex-col max-h-[200px] overflow-auto">
        {tasks.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-3.5 py-2 border-b border-[#222] last:border-b-0">
            {/* Icon */}
            <div className="flex items-center justify-center w-6 h-6 rounded bg-[#0A0A0A] shrink-0">
              {typeIcon(t.type)}
            </div>
            {/* Info */}
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium text-[var(--text-primary)] truncate">{t.label}</span>
              </div>
              {t.detail && (
                <span className="text-[9px] text-[var(--text-muted)] truncate">{t.detail}</span>
              )}
            </div>
            {/* Status */}
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-[var(--gold-primary)]/15 text-[var(--gold-primary)]">
                {typeLabel(t.type)}
              </span>
              <span className="text-[8px] text-[var(--text-muted)]">{elapsed(t.startedAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
