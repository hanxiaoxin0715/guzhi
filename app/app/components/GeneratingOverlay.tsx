"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

function useFakeProgress(active: boolean, stepMs: number = 180) {
  const [p, setP] = useState(0);

  useEffect(() => {
    if (!active) {
      setP(0);
      return;
    }
    setP(6);
    const id = setInterval(() => {
      setP((prev) => {
        const cap = 99; // 提高上限到 99
        if (prev >= cap) return prev;
        // 92% 之前正常增长，92% 之后极慢增长表示后续处理
        const inc = prev < 40 ? 4 : prev < 70 ? 2 : prev < 92 ? 1 : 0.1;
        return Math.min(cap, prev + inc);
      });
    }, stepMs);
    return () => clearInterval(id);
  }, [active, stepMs]);

  return p;
}

export default function GeneratingOverlay(props: {
  open: boolean;
  title?: string;
  detail?: string;
  progress?: number | null;
}) {
  const fake = useFakeProgress(props.open);
  const progress = useMemo(() => {
    if (!props.open) return 0;
    if (typeof props.progress === "number" && Number.isFinite(props.progress)) {
      return Math.max(0, Math.min(100, props.progress));
    }
    return fake;
  }, [props.open, props.progress, fake]);

  useEffect(() => {
    if (!props.open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [props.open]);

  if (!props.open) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center px-6">
      <div className="w-full max-w-[520px] bg-[#0d0d0d] border border-[#1f1f1f] rounded-2xl shadow-2xl p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#e8c060]/10 text-[#e8c060] flex items-center justify-center">
            <Loader2 size={18} className="animate-spin" />
          </div>
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="text-[15px] font-bold text-[#ededed] truncate">
              {props.title || "正在生成中"}
            </div>
            <div className="text-[12px] text-[#777] truncate">
              {props.detail || "请稍候，页面已锁定以防误操作"}
            </div>
          </div>
          <div className="ml-auto text-[12px] font-mono text-[#999]">{Math.round(progress)}%</div>
        </div>

        <div className="mt-5">
          <div className="h-2 w-full bg-[#141414] border border-[#1f1f1f] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#e8c060] transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-3 text-[11px] text-[#666] leading-relaxed">
            长任务建议保持页面开启；如需中止，请等待当前请求结束后再操作。
          </div>
        </div>
      </div>
    </div>
  );
}

