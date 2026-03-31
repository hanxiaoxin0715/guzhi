"use client";

import { useState, useEffect, useCallback } from "react";
import { useToast } from "../components/Toast";
import Sidebar from "../components/Sidebar";
import MarkdownViewer from "../components/MarkdownViewer";
import { loadScriptsDB } from "../lib/scriptDB";
import {
  FolderOpen,
  FolderClosed,
  Search,
  FileText,
  Grid3X3,
  Grid2X2,
  Image,
  Film,
  ClipboardList,
  Copy,
  Download,
  Loader,
  Trash2,
  PackageOpen,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface OutputFile {
  name: string;
  size: number;
  modified: string;
}

function getFileInfo(name: string): { desc: string; Icon: typeof FileText } {
  if (name.startsWith("beat-breakdown")) return { desc: "节拍拆解", Icon: FileText };
  if (name.startsWith("beat-board-prompt")) return { desc: "九宫格提示词", Icon: Grid3X3 };
  if (name.startsWith("beat-board") && !name.includes("prompt")) return { desc: "九宫格图集", Icon: Image };
  if (name.startsWith("sequence-board-prompt")) return { desc: "四宫格提示词", Icon: Grid2X2 };
  if (name.startsWith("motion-prompt")) return { desc: "动态提示词", Icon: Film };
  if (name.startsWith("ai-generation-log")) return { desc: "生成日志", Icon: ClipboardList };
  return { desc: "文件", Icon: FileText };
}

function getEpisode(name: string): string {
  const m = name.match(/ep(\d+)/i);
  return m ? `EP${m[1].padStart(2, "0")}` : "";
}

/** 将英文文件名转换为中文短文件名（不含项目前缀，用于文件夹内显示） */
function toShortChineseName(name: string): string {
  const ep = name.match(/ep(\d+)/i);
  const epStr = ep ? `第${parseInt(ep[1])}集` : "";
  if (name.startsWith("beat-breakdown")) return `节拍拆解.md`;
  if (name.startsWith("beat-board-prompt") && epStr) return `九宫格提示词-${epStr}.md`;
  if (name.startsWith("beat-board") && !name.includes("prompt") && epStr) return `九宫格图集-${epStr}.md`;
  if (name.startsWith("sequence-board-prompt") && epStr) return `四宫格提示词-${epStr}.md`;
  if (name.startsWith("motion-prompt") && epStr) return `动态提示词-${epStr}.md`;
  if (name.startsWith("ai-generation-log")) return `生成日志.md`;
  return name;
}

/** 将英文文件名转换为带项目前缀的中文文件名（用于导出/标题） */
function toChineseName(name: string, prefix = ""): string {
  const short = toShortChineseName(name);
  return prefix && short !== name ? `${prefix}-${short}` : short;
}

/** 简易前端 ZIP 打包（不依赖第三方库） */
async function buildSimpleZip(entries: { name: string; data: Uint8Array }[]): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centralDir: Uint8Array[] = [];
  let offset = 0;

  function u16(val: number) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, val, true); return b; }
  function u32(val: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, val, true); return b; }

  // CRC32 计算
  const crcTable: number[] = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c;
  }
  function crc32(data: Uint8Array): number {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(entry.data);
    // Local file header (30 bytes + name)
    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, // signature
      ...u16(20), ...u16(1 << 11), // version=20, flags=UTF-8
      ...u16(0), // compression=STORE
      ...u16(0), ...u16(0), // mod time/date
      ...u32(crc),
      ...u32(entry.data.length), ...u32(entry.data.length), // compressed/uncompressed size
      ...u16(nameBytes.length), ...u16(0), // name length, extra length
    ]);
    parts.push(local, nameBytes, entry.data);

    // Central directory entry (46 bytes + name)
    const central = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02, // signature
      ...u16(20), ...u16(20), ...u16(1 << 11),
      ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc),
      ...u32(entry.data.length), ...u32(entry.data.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset), // offset to local header
    ]);
    centralDir.push(central, nameBytes);
    offset += local.length + nameBytes.length + entry.data.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const c of centralDir) cdSize += c.length;

  // End of central directory (22 bytes)
  const eocd = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06, // signature
    ...u16(0), ...u16(0), // disk numbers
    ...u16(entries.length), ...u16(entries.length),
    ...u32(cdSize), ...u32(cdOffset),
    ...u16(0), // comment length
  ]);

  // 合并所有 Uint8Array 为单个 ArrayBuffer，避免 TS 类型问题
  let totalLen = 0;
  const allParts = [...parts, ...centralDir, eocd];
  for (const p of allParts) totalLen += p.length;
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of allParts) { result.set(p, pos); pos += p.length; }
  return new Blob([result.buffer], { type: "application/zip" });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function OutputsPage() {
  const [files, setFiles] = useState<OutputFile[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [scriptPrefix, setScriptPrefix] = useState(""); // “小说名-章节” 前缀
  const [folderOpen, setFolderOpen] = useState(true); // 文件夹展开/收起
  const { toast } = useToast();

  // 加载当前剧本名称 + 章节名称，拼接为文件名前缀
  useEffect(() => {
    (async () => {
      try {
        let scriptName = "";
        const scriptId = localStorage.getItem("feicai-pipeline-script-id");
        if (scriptId) {
          const scripts = await loadScriptsDB();
          const found = scripts.find(s => s.id === scriptId);
          if (found) scriptName = found.title.trim();
        }
        let chapterName = "";
        try {
          const chJson = localStorage.getItem("feicai-pipeline-script-chapter");
          if (chJson) {
            const ch = JSON.parse(chJson);
            if (ch?.title) chapterName = ch.title.trim();
          }
        } catch { /* ignore */ }
        // 拼接：“神祁觉醒-第二章” 或 “神祁觉醒” 或 空
        const parts = [scriptName, chapterName].filter(Boolean);
        setScriptPrefix(parts.join("-"));
      } catch { /* ignore */ }
    })();
  }, []);

  // Fetch file list
  const loadFiles = useCallback(() => {
    setLoading(true);
    fetch("/api/outputs")
      .then((res) => res.json())
      .then((data: OutputFile[]) => {
        setFiles(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  // Fetch file content when selection changes
  useEffect(() => {
    if (files.length === 0 || !files[activeIdx]) return;
    setLoadingContent(true);
    fetch(`/api/outputs/${encodeURIComponent(files[activeIdx].name)}`)
      .then((res) => res.json())
      .then((data) => {
        setContent(data.content || "加载失败");
        setLoadingContent(false);
      })
      .catch(() => {
        setContent("加载失败");
        setLoadingContent(false);
      });
  }, [activeIdx, files]);

  // Delete file
  async function handleDelete(filename: string) {
    const displayName = toShortChineseName(filename);
    if (!confirm(`确定要删除「${displayName}」吗？此操作不可撤销。`)) return;
    setDeleting(filename);
    try {
      const res = await fetch(`/api/outputs/${encodeURIComponent(filename)}`, { method: "DELETE" });
      if (res.ok) {
        toast(`已删除 ${displayName}`, "success");
        const newFiles = files.filter((f) => f.name !== filename);
        setFiles(newFiles);
        if (activeIdx >= newFiles.length) setActiveIdx(Math.max(0, newFiles.length - 1));
        if (newFiles.length === 0) setContent("");
      } else {
        toast("删除失败", "error");
      }
    } catch {
      toast("删除失败", "error");
    } finally {
      setDeleting(null);
    }
  }

  // 导出全部文件（ZIP 打包，中文文件名）
  async function handleExportAll() {
    if (files.length === 0) { toast("没有可导出的文件", "error"); return; }
    toast("正在打包导出...", "info");
    try {
      const res = await fetch("/api/outputs", { method: "POST" });
      const allFiles: { name: string; content: string }[] = await res.json();
      const enc = new TextEncoder();
      const entries = allFiles.map((f) => ({
        name: toChineseName(f.name, scriptPrefix),
        data: enc.encode(f.content),
      }));
      const zip = await buildSimpleZip(entries);
      const url = URL.createObjectURL(zip);
      const a = document.createElement("a");
      a.href = url;
      a.download = scriptPrefix ? `${scriptPrefix}-分镜产出文件.zip` : `分镜产出文件.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`已导出 ${entries.length} 个文件`, "success");
    } catch {
      toast("导出失败", "error");
    }
  }

  const filteredFiles = searchQuery
    ? files.filter((f) => {
        const q = searchQuery.toLowerCase();
        return f.name.toLowerCase().includes(q)
          || getFileInfo(f.name).desc.includes(searchQuery)
          || toShortChineseName(f.name).includes(searchQuery);
      })
    : files;

  const activeFile = files[activeIdx];

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <div className="flex flex-1 h-full">
        {/* File List Panel */}
        <div className="flex flex-col w-[300px] h-full bg-[var(--bg-surface)] border-r border-[var(--border-subtle)]">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border-subtle)]">
            <div className="flex items-center gap-2">
              <FolderOpen size={18} className="text-[var(--gold-primary)]" />
              <span className="text-[15px] font-semibold text-[var(--text-primary)]">
                项目文件
              </span>
            </div>
            <span className="text-[11px] text-[var(--text-muted)]">
              {files.length} 个文件
            </span>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-subtle)]">
            <Search size={14} className="text-[var(--text-muted)] shrink-0" />
            <input
              className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              placeholder="搜索文件..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* File Items — 文件夹树状结构 */}
          <div className="flex flex-col gap-0.5 p-2 flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader size={20} className="text-[var(--gold-primary)] animate-spin" />
              </div>
            ) : filteredFiles.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-[13px] text-[var(--text-muted)]">
                暂无文件
              </div>
            ) : (
              <>
                {/* 文件夹头部 */}
                <button
                  onClick={() => setFolderOpen(!folderOpen)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded w-full text-left transition cursor-pointer hover:bg-[var(--bg-surface)] group/folder"
                >
                  {folderOpen
                    ? <ChevronDown size={14} className="text-[var(--gold-primary)] shrink-0" />
                    : <ChevronRight size={14} className="text-[var(--text-muted)] shrink-0" />
                  }
                  {folderOpen
                    ? <FolderOpen size={16} className="text-[var(--gold-primary)] shrink-0" />
                    : <FolderClosed size={16} className="text-[var(--text-muted)] shrink-0" />
                  }
                  <div className="flex flex-col gap-0 min-w-0 flex-1">
                    <span className="text-[13px] font-medium text-[var(--text-primary)] truncate">
                      {scriptPrefix || "当前项目"}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {filteredFiles.length} 个文件
                    </span>
                  </div>
                </button>

                {/* 文件夹内容（展开时） */}
                {folderOpen && filteredFiles.map((f) => {
                  const realIdx = files.indexOf(f);
                  const { desc, Icon } = getFileInfo(f.name);
                  const ep = getEpisode(f.name);
                  return (
                    <div key={f.name} className="group/file relative">
                      <button
                        onClick={() => setActiveIdx(realIdx)}
                        className={`flex items-center gap-2.5 pl-10 pr-3 py-2 rounded w-full text-left transition cursor-pointer ${
                          realIdx === activeIdx
                            ? "bg-[var(--gold-transparent)]"
                            : "hover:bg-[var(--bg-surface)]"
                        }`}
                      >
                        <Icon
                          size={15}
                          className={
                            realIdx === activeIdx
                              ? "text-[var(--gold-primary)]"
                              : "text-[var(--text-muted)]"
                          }
                        />
                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                          <span
                            className={`text-[13px] truncate ${
                              realIdx === activeIdx
                                ? "font-medium text-[var(--text-primary)]"
                                : "text-[var(--text-secondary)]"
                            }`}
                            title={toChineseName(f.name, scriptPrefix)}
                          >
                            {toShortChineseName(f.name)}
                          </span>
                          <span className="text-[11px] text-[var(--text-muted)]">
                            {desc}{ep ? ` · ${ep}` : ""} · {formatSize(f.size)}
                          </span>
                        </div>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(f.name); }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/file:opacity-100 p-1.5 rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer"
                        title="删除文件"
                      >
                        {deleting === f.name ? <Loader size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Document Viewer */}
        <div className="flex flex-col flex-1 h-full bg-[var(--bg-page)]">
          {/* Doc Header */}
          <div className="flex items-center justify-between px-8 py-4 border-b border-[var(--border-subtle)]">
            <div className="flex items-center gap-3">
              <FileText size={18} className="text-[var(--gold-primary)]" />
              <span className="text-[14px] text-[var(--text-primary)]" title={activeFile?.name}>
                {activeFile ? toChineseName(activeFile.name, scriptPrefix) : "选择文件"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              {activeFile && (
                <button
                  onClick={() => handleDelete(activeFile.name)}
                  className="flex items-center gap-1.5 px-3.5 py-2 border border-red-500/30 text-[12px] text-red-400 hover:border-red-400 hover:bg-red-500/10 transition cursor-pointer"
                >
                  <Trash2 size={12} />
                  删除
                </button>
              )}
              <button
                onClick={() => {
                  if (content) {
                    navigator.clipboard?.writeText(content);
                    toast("已复制到剪贴板", "success");
                  }
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 border border-[var(--border-default)] text-[12px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] transition cursor-pointer"
              >
                <Copy size={12} />
                复制
              </button>
              <button
                onClick={() => {
                  if (activeFile && content) {
                    const blob = new Blob([content], { type: "text/markdown" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = toChineseName(activeFile.name, scriptPrefix);
                    a.click();
                    URL.revokeObjectURL(url);
                  }
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-[var(--gold-primary)] text-[12px] text-[#0A0A0A] font-medium hover:brightness-110 transition cursor-pointer"
              >
                <Download size={12} />
                导出
              </button>
              <button
                onClick={handleExportAll}
                className="flex items-center gap-1.5 px-3.5 py-2 border border-[var(--gold-primary)] text-[12px] text-[var(--gold-primary)] hover:bg-[var(--gold-transparent)] transition cursor-pointer"
                title="将所有产出文件打包为 ZIP 下载"
              >
                <PackageOpen size={12} />
                导出全部
              </button>
            </div>
          </div>

          {/* Doc Body */}
          <div className="flex-1 overflow-auto px-12 py-8">
            {loadingContent ? (
              <div className="flex items-center justify-center h-full">
                <Loader size={24} className="text-[var(--gold-primary)] animate-spin" />
              </div>
            ) : content ? (
              <MarkdownViewer content={content} />
            ) : (
              <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-[14px]">
                选择左侧文件查看内容
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
