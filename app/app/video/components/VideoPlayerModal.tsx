"use client";

/**
 * VideoPlayerModal — 视频弹窗播放器
 * 点击缩略图后弹出，包含播放/暂停、进度条、音量、全屏等控制
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  X, Play, Pause, Volume2, VolumeX, Maximize, Download, SkipForward,
} from "lucide-react";

interface VideoPlayerModalProps {
  open: boolean;
  onClose: () => void;
  videoUrl: string;
  title?: string;
  /** 尾帧接力回调 */
  onQuickRelay?: () => void;
  /** 下载文件名 */
  downloadName?: string;
  /** 视频宽高比，如 "16:9" "9:16" "1:1"，默认 "16:9" */
  aspectRatio?: string;
}

export default function VideoPlayerModal({
  open, onClose, videoUrl, title, onQuickRelay, downloadName, aspectRatio = "16:9",
}: VideoPlayerModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  // 打开时自动播放
  useEffect(() => {
    if (open && videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
    if (!open) {
      setIsPlaying(false);
      setCurrentTime(0);
    }
  }, [open, videoUrl]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const next = !isMuted;
    v.muted = next;
    setIsMuted(next);
  }, [isMuted]);

  const handleVolumeChange = useCallback((val: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = val;
    setVolume(val);
    if (val === 0) { v.muted = true; setIsMuted(true); }
    else if (isMuted) { v.muted = false; setIsMuted(false); }
  }, [isMuted]);

  const handleSeek = useCallback((time: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = time;
    setCurrentTime(time);
  }, []);

  const handleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen().catch(() => {});
  }, []);

  const handleDownload = useCallback(() => {
    if (!videoUrl) return;
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = downloadName || "video.mp4";
    a.click();
  }, [videoUrl, downloadName]);

  // 键盘快捷键
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === " ") { e.preventDefault(); togglePlay(); }
      if (e.key === "f" || e.key === "F") handleFullscreen();
      if (e.key === "m" || e.key === "M") toggleMute();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, togglePlay, handleFullscreen, toggleMute]);

  if (!open) return null;

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div ref={containerRef}
        className={`relative flex flex-col bg-[#0A0A0A] rounded-lg overflow-hidden border border-[var(--border-default)] shadow-2xl ${
          aspectRatio === "9:16" ? "w-[50vw] max-w-[420px]" : aspectRatio === "1:1" ? "w-[80vw] max-w-[720px]" : "w-[90vw] max-w-[960px]"
        }`}
        onClick={(e) => e.stopPropagation()}>
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between h-10 px-4 bg-[#0D0D0D] border-b border-[var(--border-default)]">
          <span className="text-[12px] font-medium text-[var(--text-secondary)]">{title || "视频播放"}</span>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#1A1A1A] transition cursor-pointer">
            <X size={14} className="text-[var(--text-muted)]" />
          </button>
        </div>

        {/* 视频区域 */}
        <div className="relative bg-black flex items-center justify-center" style={{ aspectRatio: aspectRatio.replace(":", "/") }}>
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full object-contain"
            muted={isMuted}
            onTimeUpdate={() => {
              const v = videoRef.current;
              if (v) { setCurrentTime(v.currentTime); setDuration(v.duration || 0); }
            }}
            onLoadedMetadata={() => {
              const v = videoRef.current;
              if (v) setDuration(v.duration || 0);
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
          />
          {/* 点击视频播放/暂停 */}
          <div onClick={togglePlay}
            className={`absolute inset-0 flex items-center justify-center cursor-pointer transition-opacity ${isPlaying ? "opacity-0 hover:opacity-100" : "opacity-100"}`}>
            {!isPlaying && (
              <div className="w-16 h-16 rounded-full bg-[#C9A96230] border border-[#C9A96260] flex items-center justify-center hover:bg-[#C9A96240] transition">
                <Play size={28} className="text-[var(--gold-primary)] ml-1" />
              </div>
            )}
          </div>
        </div>

        {/* 进度条 */}
        <div className="h-1 bg-[#1A1A1A] cursor-pointer group relative"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            handleSeek(ratio * duration);
          }}>
          <div className="h-full bg-[var(--gold-primary)] transition-all" style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : "0%" }} />
          {/* 拖动手柄 */}
          <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[var(--gold-primary)] opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: duration > 0 ? `calc(${(currentTime / duration) * 100}% - 6px)` : "0" }} />
        </div>

        {/* 底部控制栏 */}
        <div className="flex items-center justify-between h-11 px-4 bg-[#0D0D0D]">
          <div className="flex items-center gap-3">
            {/* 播放/暂停 */}
            <button onClick={togglePlay} className="cursor-pointer hover:scale-110 transition">
              {isPlaying ? <Pause size={18} className="text-white" /> : <Play size={18} className="text-white ml-0.5" />}
            </button>
            {/* 时间 */}
            <span className="text-[11px] font-mono text-[var(--text-muted)]">{fmt(currentTime)} / {fmt(duration)}</span>
          </div>

          <div className="flex items-center gap-3">
            {/* 尾帧接力 */}
            {onQuickRelay && (
              <button onClick={onQuickRelay} className="flex items-center gap-1 cursor-pointer group" title="截取尾帧接力">
                <SkipForward size={14} className="text-[var(--gold-primary)] opacity-70 group-hover:opacity-100 transition" />
                <span className="text-[9px] text-[var(--gold-primary)] opacity-70 group-hover:opacity-100 transition">尾帧接力</span>
              </button>
            )}
            {/* 音量 */}
            <div className="relative flex items-center"
              onMouseEnter={() => setShowVolumeSlider(true)}
              onMouseLeave={() => setShowVolumeSlider(false)}>
              <button onClick={toggleMute} className="cursor-pointer">
                {isMuted || volume === 0
                  ? <VolumeX size={16} className="text-[var(--text-muted)] hover:text-white transition" />
                  : <Volume2 size={16} className="text-white hover:text-[var(--gold-primary)] transition" />
                }
              </button>
              {showVolumeSlider && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-8 h-24 bg-[#1A1A1A] border border-[var(--border-default)] rounded-md p-1.5 flex items-center justify-center">
                  <input type="range" min={0} max={1} step={0.05} value={isMuted ? 0 : volume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    className="w-20 h-1 accent-[var(--gold-primary)] cursor-pointer"
                    style={{ transform: "rotate(-90deg)", transformOrigin: "center" }} />
                </div>
              )}
            </div>
            {/* 下载 */}
            <button onClick={handleDownload} className="cursor-pointer" title="下载视频">
              <Download size={16} className="text-[var(--text-muted)] hover:text-white transition" />
            </button>
            {/* 全屏 */}
            <button onClick={handleFullscreen} className="cursor-pointer" title="全屏 (F)">
              <Maximize size={16} className="text-[var(--text-muted)] hover:text-white transition" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
