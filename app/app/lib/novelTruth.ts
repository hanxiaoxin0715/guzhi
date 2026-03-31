import fs from "fs";
import path from "path";
import { ensureDir, getBaseOutputDir } from "./paths";
import crypto from "crypto";
import os from "os";

export type TruthFileName =
  | "current_state.md"
  | "particle_ledger.md"
  | "pending_hooks.md"
  | "chapter_summaries.md"
  | "subplot_board.md"
  | "emotional_arcs.md"
  | "character_matrix.md"
  | "book_rules.md"
  | "story_bible.md";

export interface TruthInitMeta {
  title?: string;
  genre?: string;
  platform?: string;
  brief?: string;
}

const DEFAULT_TRUTH_FILES: TruthFileName[] = [
  "current_state.md",
  "particle_ledger.md",
  "pending_hooks.md",
  "chapter_summaries.md",
  "subplot_board.md",
  "emotional_arcs.md",
  "character_matrix.md",
  "book_rules.md",
  "story_bible.md",
];

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 120) || "_default";
}

export function getNovelProjectDir(projectId: string): string {
  return path.join(getBaseOutputDir(), "novel-projects", safeId(projectId));
}

export function getTruthDir(projectId: string): string {
  return path.join(getNovelProjectDir(projectId), "truth");
}

export function getTruthFilePath(projectId: string, name: TruthFileName): string {
  return path.join(getTruthDir(projectId), name);
}

export function ensureTruthFiles(projectId: string, meta: TruthInitMeta = {}): void {
  const dir = getTruthDir(projectId);
  ensureDir(dir);

  const now = new Date().toISOString();
  const title = meta.title?.trim() || "未命名作品";
  const genre = meta.genre?.trim() || "";
  const platform = meta.platform?.trim() || "";
  const brief = meta.brief?.trim() || "";

  const headerLines: string[] = [];
  headerLines.push(`# ${title} · 真相文件`);
  headerLines.push(`- 创建时间: ${now}`);
  if (genre) headerLines.push(`- 题材: ${genre}`);
  if (platform) headerLines.push(`- 平台: ${platform}`);
  if (brief) headerLines.push(`- 简报: ${brief}`);
  const header = headerLines.join("\n") + "\n\n";

  const defaults: Record<TruthFileName, string> = {
    "current_state.md": header + `## 世界状态\n\n## 角色状态\n\n## 时间线\n`,
    "particle_ledger.md": header + `## 资源账本\n\n| 项目 | 变动 | 备注 | 章节 |\n|---|---|---|---|\n`,
    "pending_hooks.md": header + `## 未闭合伏笔\n\n| 伏笔/悬念 | 首次出现 | 当前状态 | 备注 |\n|---|---|---|---|\n`,
    "chapter_summaries.md": header + `## 章节摘要\n`,
    "subplot_board.md": header + `## 支线进度\n\n| 支线 | 当前状态 | 最近推进章节 | 停滞风险 |\n|---|---|---|---|\n`,
    "emotional_arcs.md": header + `## 情感弧线\n\n| 角色 | 当前情绪 | 触发事件 | 章节 |\n|---|---|---|---|\n`,
    "character_matrix.md": header + `## 角色交互矩阵\n\n| 角色A | 角色B | 关系/交互 | 信息边界 | 章节 |\n|---|---|---|---|---|\n`,
    "book_rules.md": header + `## 本书硬规则\n\n- 数值上限:\n- 禁写清单:\n- 叙事口吻:\n`,
    "story_bible.md": header + `## 世界观设定\n\n## 主要人物\n\n## 体系/规则\n`,
  };

  for (const f of DEFAULT_TRUTH_FILES) {
    const fp = getTruthFilePath(projectId, f);
    if (!fs.existsSync(fp)) {
      fs.writeFileSync(fp, defaults[f], "utf-8");
    }
  }
}

export function readTruthFile(projectId: string, name: TruthFileName): string {
  const fp = getTruthFilePath(projectId, name);
  if (!fs.existsSync(fp)) return "";
  return fs.readFileSync(fp, "utf-8");
}

export function writeTruthFile(projectId: string, name: TruthFileName, content: string): void {
  ensureDir(getTruthDir(projectId));
  fs.writeFileSync(getTruthFilePath(projectId, name), content, "utf-8");
}

export function listTruthFiles(projectId: string): { name: TruthFileName; bytes: number; updatedAt: number }[] {
  ensureDir(getTruthDir(projectId));
  const dir = getTruthDir(projectId);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const result: { name: TruthFileName; bytes: number; updatedAt: number }[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const name = e.name as TruthFileName;
    if (!DEFAULT_TRUTH_FILES.includes(name)) continue;
    const st = fs.statSync(path.join(dir, e.name));
    result.push({ name, bytes: st.size, updatedAt: st.mtimeMs });
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

function lockPath(projectId: string): string {
  return path.join(getNovelProjectDir(projectId), ".write.lock");
}

export async function withNovelWriteLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const projDir = getNovelProjectDir(projectId);
  ensureDir(projDir);
  const fp = lockPath(projectId);
  const token = crypto.randomBytes(8).toString("hex");
  const payload = JSON.stringify({ token, pid: process.pid, host: os.hostname(), createdAt: Date.now() });

  let fd: number | null = null;
  const start = Date.now();
  const timeoutMs = 45_000;
  const staleThresholdMs = 2 * 60 * 1000;

  while (true) {
    try {
      fd = fs.openSync(fp, "wx");
      fs.writeSync(fd, payload, 0, "utf-8");
      fs.closeSync(fd); // 写入后立即关闭，避免长期持有句柄
      fd = null;
      break;
    } catch (e: any) {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch {}
        fd = null;
      }
      // 检查是否为过期锁
      try {
        if (fs.existsSync(fp)) {
          const content = fs.readFileSync(fp, "utf-8").trim();
          if (!content) {
            console.warn(`[Lock] Found empty lock file for project ${projectId}, cleaning up...`);
            fs.unlinkSync(fp);
            continue;
          }
          const data = JSON.parse(content);
          if (data && typeof data.createdAt === "number") {
            const age = Date.now() - data.createdAt;
            let isStale = age > staleThresholdMs;

            // 额外检查 PID 是否还存活 (仅限同主机)
            if (!isStale && data.pid && data.host === os.hostname()) {
              try {
                process.kill(data.pid, 0);
              } catch (err: any) {
                // 如果错误码是 ESRCH，表示进程不存在
                if (err.code === "ESRCH") {
                  console.warn(`[Lock] Process ${data.pid} not found for lock ${projectId}, assuming stale.`);
                  isStale = true;
                }
              }
            }

            if (isStale) {
              console.warn(`[Lock] Found stale lock for project ${projectId} (age: ${Math.round(age/1000)}s), cleaning up...`);
              fs.unlinkSync(fp);
              // 删除后立即重试
              continue;
            }
          }
        }
      } catch (err) {
        // 如果解析失败，可能文件损坏或正在写入，忽略并继续等待
      }

      if (Date.now() - start > timeoutMs) {
        let lockInfo = "未知";
        try {
          if (fs.existsSync(fp)) {
            const content = fs.readFileSync(fp, "utf-8");
            const data = JSON.parse(content);
            lockInfo = `PID:${data.pid}, Host:${data.host}, Created:${new Date(data.createdAt).toLocaleString()}`;
          }
        } catch {}
        
        console.error(`[Lock] Lock acquisition timeout for project ${projectId}. Lock Info: ${lockInfo}`);
        throw new Error(`当前书籍正在写入中（持有者：${lockInfo}），请稍后再试或稍等片刻。`);
      }
      await new Promise((r) => setTimeout(r, 1000)); // 增加等待间隔到 1s
    }
  }

  try {
    return await fn();
  } finally {
    try {
      if (fd !== null) fs.closeSync(fd);
    } catch {}
    try {
      if (fs.existsSync(fp)) {
        const cur = fs.readFileSync(fp, "utf-8");
        if (cur.includes(token)) {
          fs.unlinkSync(fp);
        }
      }
    } catch {}
  }
}

export function createTruthSnapshot(projectId: string, label: string, extraFiles: Record<string, string> = {}): string {
  const baseDir = path.join(getNovelProjectDir(projectId), "snapshots");
  ensureDir(baseDir);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = label
    .trim()
    .slice(0, 60)
    .replace(/[^\p{L}\p{N}\-_ ]/gu, "")
    .replace(/\s+/g, "_");
  const snapDir = path.join(baseDir, `${ts}_${slug || "snapshot"}`);
  ensureDir(snapDir);

  const truthDir = getTruthDir(projectId);
  ensureDir(truthDir);
  const files = fs.readdirSync(truthDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  for (const f of files) {
    const src = path.join(truthDir, f);
    const dest = path.join(snapDir, f);
    try {
      fs.copyFileSync(src, dest);
    } catch {}
  }

  for (const [name, content] of Object.entries(extraFiles)) {
    const dest = path.join(snapDir, name);
    try {
      fs.writeFileSync(dest, content, "utf-8");
    } catch {}
  }

  return snapDir;
}

export function listTruthSnapshots(projectId: string): { id: string; name: string; createdAt: number }[] {
  const baseDir = path.join(getNovelProjectDir(projectId), "snapshots");
  if (!fs.existsSync(baseDir)) return [];
  const entries = fs.readdirSync(baseDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const out: { id: string; name: string; createdAt: number }[] = [];
  for (const e of entries) {
    const fp = path.join(baseDir, e.name);
    try {
      const st = fs.statSync(fp);
      out.push({ id: e.name, name: e.name.replace(/^\d{4}-\d{2}-\d{2}T/, ""), createdAt: st.mtimeMs });
    } catch {}
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

function safeSnapshotId(id: string): string {
  if (!id) throw new Error("Missing snapshotId");
  if (id.includes("..") || id.includes("/") || id.includes("\\") || id.includes(":")) {
    throw new Error("Invalid snapshotId");
  }
  return id;
}

export function restoreTruthSnapshot(projectId: string, snapshotId: string): void {
  ensureTruthFiles(projectId);
  const sid = safeSnapshotId(snapshotId);
  const snapDir = path.join(getNovelProjectDir(projectId), "snapshots", sid);
  if (!fs.existsSync(snapDir)) throw new Error("Snapshot not found");
  const truthDir = getTruthDir(projectId);
  ensureDir(truthDir);

  for (const f of DEFAULT_TRUTH_FILES) {
    const src = path.join(snapDir, f);
    if (!fs.existsSync(src)) continue;
    try {
      fs.copyFileSync(src, path.join(truthDir, f));
    } catch {}
  }
}

export type SimpleMemoryType = "plot" | "character" | "setting" | "item" | "hook";

export interface SimpleMemoryEntry {
  content: string;
  tags?: string[];
  type?: SimpleMemoryType;
  status?: "open" | "closed"; // For hooks
}

function escapeMdCell(s: string): string {
  return (s || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function ensureSection(fileContent: string, heading: string): string {
  if (fileContent.includes(heading)) return fileContent;
  const trimmed = fileContent.trimEnd();
  return trimmed + (trimmed.endsWith("\n") ? "" : "\n") + "\n" + heading + "\n";
}

function normalizeForMatch(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[\s\r\n\t]/g, "")
    .replace(/[，。！？；：、"“”'‘’（）()[\]【】<>《》]/g, "");
}

function upsertChapterBlock(md: string, sectionHeading: string, chapterTitle: string, lines: string[]): string {
  let content = ensureSection(md, sectionHeading);
  const chap = chapterTitle.trim() || "未命名章节";
  const h = `### ${chap}`;

  const idx = content.indexOf(h);
  const block = [h, ...lines.map((l) => `- ${l.trim()}`)].join("\n") + "\n";
  if (idx === -1) {
    return content.trimEnd() + "\n\n" + block;
  }

  const afterStart = idx + h.length;
  const nextHeadingIdx = content.indexOf("\n### ", afterStart);
  const end = nextHeadingIdx === -1 ? content.length : nextHeadingIdx + 1;
  const before = content.slice(0, idx).trimEnd();
  const after = content.slice(end).trimStart();
  return before + "\n\n" + block + "\n" + after;
}

function parseTableRows(md: string): { head: string; rows: string[]; tail: string } {
  const lines = md.split("\n");
  const rows: string[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("|") && line.includes("|---")) {
      i++;
      break;
    }
  }
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) break;
    if (line.includes("|---")) continue;
    rows.push(line);
  }
  const head = lines.slice(0, i - rows.length).join("\n");
  const tail = lines.slice(i).join("\n");
  return { head, rows, tail };
}

function ensureLedgerHeader(md: string): string {
  if (md.includes("| 项目 | 变动 | 备注 | 章节 |")) return md;
  const base = ensureSection(md, "## 资源账本");
  const parts = base.split("## 资源账本");
  if (parts.length < 2) return base;
  const after = parts.slice(1).join("## 资源账本");
  const header = "\n\n| 项目 | 变动 | 备注 | 章节 |\n|---|---|---|---|\n";
  if (after.includes("|---|---|---|---|")) return base;
  return parts[0] + "## 资源账本" + header + after.replace(/^\s*\n?/, "");
}

function ensureHooksHeader(md: string): string {
  if (md.includes("| 伏笔/悬念 | 首次出现 | 当前状态 | 备注 |")) return md;
  const base = ensureSection(md, "## 未闭合伏笔");
  const parts = base.split("## 未闭合伏笔");
  if (parts.length < 2) return base;
  const after = parts.slice(1).join("## 未闭合伏笔");
  const header = "\n\n| 伏笔/悬念 | 首次出现 | 当前状态 | 备注 |\n|---|---|---|---|\n";
  if (after.includes("|---|---|---|---|")) return base;
  return parts[0] + "## 未闭合伏笔" + header + after.replace(/^\s*\n?/, "");
}

function ensureMatrixHeader(md: string): string {
  if (md.includes("| 角色A | 角色B | 关系/交互 | 信息边界 | 章节 |")) return md;
  const base = ensureSection(md, "## 角色交互矩阵");
  const parts = base.split("## 角色交互矩阵");
  if (parts.length < 2) return base;
  const after = parts.slice(1).join("## 角色交互矩阵");
  const header = "\n\n| 角色A | 角色B | 关系/交互 | 信息边界 | 章节 |\n|---|---|---|---|---|\n";
  if (after.includes("|---|---|---|---|---|")) return base;
  return parts[0] + "## 角色交互矩阵" + header + after.replace(/^\s*\n?/, "");
}

function ensureEmotionalHeader(md: string): string {
  if (md.includes("| 角色 | 当前情绪 | 触发事件 | 章节 |")) return md;
  const base = ensureSection(md, "## 情感弧线");
  const parts = base.split("## 情感弧线");
  if (parts.length < 2) return base;
  const after = parts.slice(1).join("## 情感弧线");
  const header = "\n\n| 角色 | 当前情绪 | 触发事件 | 章节 |\n|---|---|---|---|\n";
  if (after.includes("|---|---|---|---|")) return base;
  return parts[0] + "## 情感弧线" + header + after.replace(/^\s*\n?/, "");
}

function ensureSubplotHeader(md: string): string {
  if (md.includes("| 支线 | 当前状态 | 最近推进章节 | 停滞风险 |")) return md;
  const base = ensureSection(md, "## 支线进度");
  const parts = base.split("## 支线进度");
  if (parts.length < 2) return base;
  const after = parts.slice(1).join("## 支线进度");
  const header = "\n\n| 支线 | 当前状态 | 最近推进章节 | 停滞风险 |\n|---|---|---|---|\n";
  if (after.includes("|---|---|---|---|")) return base;
  return parts[0] + "## 支线进度" + header + after.replace(/^\s*\n?/, "");
}

export interface TruthUpdatePatch {
  chapterSummary?: string[];
  currentState?: string[];
  ledger?: { item: string; delta: number; note?: string }[];
  hooks?: { hook: string; status: "open" | "closed"; note?: string }[];
  interactions?: { a: string; b: string; relation: string; boundary?: string; note?: string }[];
  emotionalArcs?: { character: string; emotion: string; trigger?: string }[];
  subplots?: { subplot: string; status: string; risk?: string }[];
}

export function applyTruthPatch(args: { projectId: string; chapterTitle: string; patch: TruthUpdatePatch }): void {
  ensureTruthFiles(args.projectId);
  const chapter = args.chapterTitle.trim() || "未命名章节";
  const patch = args.patch || {};

  if (patch.chapterSummary && patch.chapterSummary.length) {
    const fp = getTruthFilePath(args.projectId, "chapter_summaries.md");
    const old = fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : "";
    const updated = upsertChapterBlock(old, "## 章节摘要", chapter, patch.chapterSummary.slice(0, 12));
    fs.writeFileSync(fp, updated, "utf-8");
  }

  if (patch.currentState && patch.currentState.length) {
    const fp = getTruthFilePath(args.projectId, "current_state.md");
    const old = fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : "";
    const updated = upsertChapterBlock(old, "## 更新记录", chapter, patch.currentState.slice(0, 12));
    fs.writeFileSync(fp, updated, "utf-8");
  }

  if (patch.ledger && patch.ledger.length) {
    const fp = getTruthFilePath(args.projectId, "particle_ledger.md");
    let md = fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : "";
    md = ensureLedgerHeader(md);
    const { head, rows, tail } = parseTableRows(md);
    const existing = new Set(rows.map((r) => normalizeForMatch(r)));
    const addRows: string[] = [];
    for (const e of patch.ledger) {
      const item = (e.item || "").trim();
      if (!item) continue;
      const delta = Number.isFinite(e.delta) ? (e.delta >= 0 ? `+${e.delta}` : `${e.delta}`) : "?";
      const note = e.note ? escapeMdCell(e.note) : "";
      const row = `| ${escapeMdCell(item)} | ${escapeMdCell(delta)} | ${note} | ${escapeMdCell(chapter)} |`;
      if (existing.has(normalizeForMatch(row))) continue;
      addRows.push(row);
    }
    if (addRows.length) {
      const updated = head.trimEnd() + "\n" + rows.join("\n") + (rows.length ? "\n" : "") + addRows.join("\n") + "\n" + tail.trimStart();
      fs.writeFileSync(fp, updated.trimEnd() + "\n", "utf-8");
    }
  }

  if (patch.hooks && patch.hooks.length) {
    const fp = getTruthFilePath(args.projectId, "pending_hooks.md");
    let md = fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : "";
    md = ensureHooksHeader(md);
    const lines = md.split("\n");

    const parse = (line: string) => line.split("|").map((x) => x.trim()).filter((x, idx, arr) => !(idx === 0 || idx === arr.length - 1));
    const updates = patch.hooks
      .map((h) => ({
        hook: (h.hook || "").trim(),
        status: h.status === "closed" ? "closed" : "open",
        note: (h.note || "").trim(),
      }))
      .filter((h) => h.hook.length >= 2);

    const normUpdates = updates.map((u) => ({ ...u, key: normalizeForMatch(u.hook) }));
    const hookToUpdate = new Map(normUpdates.map((u) => [u.key, u]));

    let inTable = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("| 伏笔/悬念 |") && line.trim().startsWith("|")) {
        inTable = true;
        continue;
      }
      if (!inTable) continue;
      if (!line.trim().startsWith("|")) break;
      if (line.includes("|---")) continue;

      const cols = parse(line);
      if (cols.length < 4) continue;
      const hook = cols[0];
      const key = normalizeForMatch(hook);
      const upd = hookToUpdate.get(key);
      if (!upd) continue;
      cols[2] = upd.status;
      if (upd.note) cols[3] = escapeMdCell(upd.note);
      lines[i] = `| ${cols[0]} | ${cols[1]} | ${cols[2]} | ${cols[3]} |`;
      hookToUpdate.delete(key);
    }

    const remaining = Array.from(hookToUpdate.values());
    if (remaining.length) {
      const rows = remaining.map((u) => `| ${escapeMdCell(u.hook)} | ${escapeMdCell(chapter)} | ${u.status} | ${escapeMdCell(u.note || "")} |`);
      const headerIdx = lines.findIndex((l) => l.trim().startsWith("|") && l.includes("| 伏笔/悬念 |"));
      if (headerIdx === -1) {
        md = lines.join("\n").trimEnd() + "\n" + rows.join("\n") + "\n";
      } else {
        let sepIdx = -1;
        for (let i = headerIdx + 1; i < lines.length; i++) {
          if (lines[i].trim().startsWith("|") && lines[i].includes("|---")) {
            sepIdx = i;
            break;
          }
          if (!lines[i].trim()) break;
        }
        let insertAt = sepIdx >= 0 ? sepIdx + 1 : headerIdx + 1;
        while (insertAt < lines.length && lines[insertAt].trim().startsWith("|")) insertAt++;
        lines.splice(insertAt, 0, ...rows);
        md = lines.join("\n");
      }
    } else {
      md = lines.join("\n");
    }
    fs.writeFileSync(fp, md.trimEnd() + "\n", "utf-8");
  }

  if (patch.interactions && patch.interactions.length) {
    const fp = getTruthFilePath(args.projectId, "character_matrix.md");
    let md = fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : "";
    md = ensureMatrixHeader(md);
    const { head, rows, tail } = parseTableRows(md);
    const existing = new Set(rows.map((r) => normalizeForMatch(r)));
    const addRows: string[] = [];
    for (const it of patch.interactions) {
      const a = (it.a || "").trim();
      const b = (it.b || "").trim();
      const rel = (it.relation || "").trim();
      if (!a || !b || !rel) continue;
      const row = `| ${escapeMdCell(a)} | ${escapeMdCell(b)} | ${escapeMdCell(rel)} | ${escapeMdCell(it.boundary || "")} | ${escapeMdCell(chapter)} |`;
      if (existing.has(normalizeForMatch(row))) continue;
      addRows.push(row);
    }
    if (addRows.length) {
      const updated = head.trimEnd() + "\n" + rows.join("\n") + (rows.length ? "\n" : "") + addRows.join("\n") + "\n" + tail.trimStart();
      fs.writeFileSync(fp, updated.trimEnd() + "\n", "utf-8");
    }
  }

  if (patch.emotionalArcs && patch.emotionalArcs.length) {
    const fp = getTruthFilePath(args.projectId, "emotional_arcs.md");
    let md = fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : "";
    md = ensureEmotionalHeader(md);
    const { head, rows, tail } = parseTableRows(md);
    const existing = new Set(rows.map((r) => normalizeForMatch(r)));
    const addRows: string[] = [];
    for (const e of patch.emotionalArcs) {
      const c = (e.character || "").trim();
      const emo = (e.emotion || "").trim();
      if (!c || !emo) continue;
      const row = `| ${escapeMdCell(c)} | ${escapeMdCell(emo)} | ${escapeMdCell(e.trigger || "")} | ${escapeMdCell(chapter)} |`;
      if (existing.has(normalizeForMatch(row))) continue;
      addRows.push(row);
    }
    if (addRows.length) {
      const updated = head.trimEnd() + "\n" + rows.join("\n") + (rows.length ? "\n" : "") + addRows.join("\n") + "\n" + tail.trimStart();
      fs.writeFileSync(fp, updated.trimEnd() + "\n", "utf-8");
    }
  }

  if (patch.subplots && patch.subplots.length) {
    const fp = getTruthFilePath(args.projectId, "subplot_board.md");
    let md = fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : "";
    md = ensureSubplotHeader(md);
    const { head, rows, tail } = parseTableRows(md);
    const existing = new Set(rows.map((r) => normalizeForMatch(r)));
    const addRows: string[] = [];
    for (const s of patch.subplots) {
      const subplot = (s.subplot || "").trim();
      const status = (s.status || "").trim();
      if (!subplot || !status) continue;
      const row = `| ${escapeMdCell(subplot)} | ${escapeMdCell(status)} | ${escapeMdCell(chapter)} | ${escapeMdCell(s.risk || "")} |`;
      if (existing.has(normalizeForMatch(row))) continue;
      addRows.push(row);
    }
    if (addRows.length) {
      const updated = head.trimEnd() + "\n" + rows.join("\n") + (rows.length ? "\n" : "") + addRows.join("\n") + "\n" + tail.trimStart();
      fs.writeFileSync(fp, updated.trimEnd() + "\n", "utf-8");
    }
  }
}

function guessItemName(m: SimpleMemoryEntry): string {
  const text = (m.content || "").trim();
  const quoted = text.match(/[“"‘']([^“"‘'”]{2,16})[”"’']/);
  if (quoted) return quoted[1];
  const book = text.match(/《([^《》]{2,16})》/);
  if (book) return book[1];
  const bracket = text.match(/【([^【】]{2,16})】/);
  if (bracket) return bracket[1];
  if (m.tags && m.tags.length) {
    const t = m.tags.find((x) => typeof x === "string" && x.trim().length >= 2 && x.trim().length <= 10);
    if (t) return t.trim();
  }
  const fallback = text.split(/[，。；：、\s]/)[0];
  return fallback && fallback.length >= 2 ? fallback.slice(0, 12) : "物品";
}

function derivePatchFromMemories(chapter: string, memories: SimpleMemoryEntry[]): TruthUpdatePatch {
  const patch: TruthUpdatePatch = {};
  const lines = memories.map((m) => (m.content || "").trim()).filter(Boolean);
  if (lines.length) patch.chapterSummary = lines.slice(0, 8);

  const state = memories
    .filter((m) => m.type === "character" || m.type === "setting")
    .map((m) => (m.content || "").trim())
    .filter(Boolean)
    .slice(0, 8);
  if (state.length) patch.currentState = state;

  const ledger: { item: string; delta: number; note?: string }[] = [];
  for (const m of memories.filter((x) => x.type === "item")) {
    const c = (m.content || "").trim();
    if (!c) continue;
    const item = guessItemName(m);
    let delta = 0;
    if (/获得|得到|捡到|买到|收获|夺得|入手|拿到|缴获|赢得/.test(c)) delta = 1;
    if (/消耗|使用|花费|付出|丢失|遗失|损坏|卖掉|交出|耗尽|碎裂|报废/.test(c)) delta = -1;
    const amount = c.match(/([+\-]?\d+)\s*(灵石|金币|银两|积分|点|枚|块|颗|两|个|件)/);
    if (amount) {
      const n = parseInt(amount[1], 10);
      if (Number.isFinite(n) && n !== 0) {
        const sign = delta === -1 ? -1 : delta === 1 ? 1 : n < 0 ? -1 : 1;
        delta = Math.abs(n) * sign;
      }
    }
    if (delta === 0) continue;
    ledger.push({ item, delta, note: c });
  }
  if (ledger.length) patch.ledger = ledger.slice(0, 12);

  const isHook = (m: SimpleMemoryEntry) => {
    if (m.type === "hook") return true;
    const c = m.content || "";
    const tags = (m.tags || []).join(" ");
    return /伏笔|悬念|未解|谜团|承诺/.test(c) || /伏笔|悬念|未解|谜团|承诺/.test(tags);
  };
  const hooks: { hook: string; status: "open" | "closed"; note?: string }[] = [];
  for (const m of memories.filter(isHook)) {
    const c = (m.content || "").trim();
    if (!c) continue;
    const closed = m.status === "closed" || /回收|揭晓|真相|解决|了结|收束|圆满|揭开|查清|水落石出/.test(c);
    hooks.push({ hook: c.slice(0, 80), status: closed ? "closed" : "open" });
  }
  if (hooks.length) patch.hooks = hooks.slice(0, 12);

  return patch;
}

export function applyMemoriesToTruthFiles(args: {
  projectId: string;
  chapterTitle: string;
  memories: SimpleMemoryEntry[];
}): void {
  ensureTruthFiles(args.projectId);
  const chapter = args.chapterTitle.trim() || "未命名章节";
  const memories = Array.isArray(args.memories) ? args.memories : [];
  const patch = derivePatchFromMemories(chapter, memories);
  applyTruthPatch({ projectId: args.projectId, chapterTitle: chapter, patch });
}
