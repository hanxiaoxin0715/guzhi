"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/novel");
  }, [router]);

  return (
    <div className="flex items-center justify-center h-screen bg-[#0a0a0a] text-[#e8c060]">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-[#e8c060] border-t-transparent rounded-full animate-spin"></div>
        <p className="text-[14px] font-medium tracking-widest">正在进入小说工作坊...</p>
      </div>
    </div>
  );
}
