import fs from "fs";
import path from "path";
import { getBaseOutputDir, getActiveProjectFileId, ensureDir } from "./paths";

// ─── 旧数据自动迁移（仅执行一次） ─────────────────────────

let _promptsMigrated = false;

/**
 * 检查 outputs/ 根目录是否有散落的 .md 文件（旧版无隔离），
 * 如有则自动迁移到 prompts/_default/ 子目录。
 */
function migratePromptsIfNeeded(): void {
  if (_promptsMigrated) return;
  _promptsMigrated = true;

  const baseDir = getBaseOutputDir();
  if (!fs.existsSync(baseDir)) return;

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const mdFiles = entries.filter(
    (e) => e.isFile() && e.name.endsWith(".md")
  );
  if (mdFiles.length === 0) return;

  const defaultDir = path.join(baseDir, "prompts", "_default");
  ensureDir(defaultDir);

  let moved = 0;
  for (const file of mdFiles) {
    const src = path.join(baseDir, file.name);
    const dest = path.join(defaultDir, file.name);
    try {
      fs.renameSync(src, dest);
      moved++;
    } catch {
      try {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
        moved++;
      } catch { /* 跳过无法迁移的文件 */ }
    }
  }

  if (moved > 0) {
    console.log(
      `[migration] ✓ 已迁移 ${moved}/${mdFiles.length} 个输出文件到 prompts/_default/`
    );
  }
}

/**
 * 获取当前项目的输出文件目录（项目隔离）。
 * outputs/prompts/{projectId}/
 *
 * 首次调用时自动执行旧数据迁移。
 */
export function getOutputsDir(): string {
  migratePromptsIfNeeded();
  const projectId = getActiveProjectFileId();
  const dir = path.join(getBaseOutputDir(), "prompts", projectId);
  ensureDir(dir);
  return dir;
}

export function listOutputFiles() {
  const dir = getOutputsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") || f.endsWith(".json"))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return {
        name,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readOutputFile(filename: string): string | null {
  const dir = getOutputsDir();
  // Prevent path traversal
  const safe = path.basename(filename);
  const filePath = path.join(dir, safe);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf-8");
}

export function deleteOutputFile(filename: string): boolean {
  const dir = getOutputsDir();
  const safe = path.basename(filename);
  const filePath = path.join(dir, safe);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

export function clearAllOutputFiles(): number {
  const dir = getOutputsDir();
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".md") || f.endsWith(".json"));
  for (const f of files) {
    try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
  }
  return files.length;
}

export function writeOutputFile(filename: string, content: string): boolean {
  const dir = getOutputsDir();
  const safe = path.basename(filename);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, safe);
  fs.writeFileSync(filePath, content, "utf-8");
  return true;
}

export function readAllOutputFiles(): { name: string; content: string }[] {
  const dir = getOutputsDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") || f.endsWith(".json"))
    .map((name) => ({
      name,
      content: fs.readFileSync(path.join(dir, name), "utf-8"),
    }));
}
