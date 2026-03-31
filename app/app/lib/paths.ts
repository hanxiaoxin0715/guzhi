/**
 * Centralized path configuration for all file storage.
 *
 * Reads from `feicai-paths.json` in the feicai-studio root.
 * Falls back to `../outputs` relative to process.cwd() when unconfigured.
 *
 * Config file format:
 * {
 *   "baseOutputDir": "D:\\custom\\path\\outputs"
 * }
 */
import fs from "fs";
import path from "path";

// Config file lives inside the feicai-studio folder
const CONFIG_FILE = path.join(process.cwd(), "feicai-paths.json");

// Default: ../outputs relative to feicai-studio
const DEFAULT_BASE = path.join(process.cwd(), "..", "outputs");

interface PathConfig {
  baseOutputDir: string;
}

/** Read the persisted path config (or return defaults). */
export function getPathConfig(): PathConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw) as Partial<PathConfig>;
      if (parsed.baseOutputDir && typeof parsed.baseOutputDir === "string") {
        return { baseOutputDir: parsed.baseOutputDir };
      }
    }
  } catch {
    // Corrupt or unreadable — fall back to default
  }
  return { baseOutputDir: DEFAULT_BASE };
}

/** Persist a new path config to disk. */
export function savePathConfig(config: PathConfig): void {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

/** Get the config file path (for debugging / display). */
export function getConfigFilePath(): string {
  return CONFIG_FILE;
}

/** Get the default base output directory. */
export function getDefaultBase(): string {
  return DEFAULT_BASE;
}

// ─── Convenience getters ──────────────────────────────────

/** Base output directory (user-configured or default). */
export function getBaseOutputDir(): string {
  return getPathConfig().baseOutputDir;
}

/** outputs/ref-images/ */
export function getRefImagesDir(): string {
  return path.join(getBaseOutputDir(), "ref-images");
}

// ─── 项目隔离：活跃项目 ID 磁盘同步 ─────────────────────────

/** 活跃项目标识文件路径 */
function getActiveProjectFilePath(): string {
  return path.join(getBaseOutputDir(), ".active-project");
}

/** 同步读取磁盘上的活跃项目 ID（服务端用，无项目时返回 "_default"） */
export function getActiveProjectFileId(): string {
  try {
    const fp = getActiveProjectFilePath();
    if (fs.existsSync(fp)) {
      const id = fs.readFileSync(fp, "utf-8").trim();
      // 只接受安全字符，防止路径注入
      if (id && /^[a-zA-Z0-9_\-]+$/.test(id)) return id;
    }
  } catch { /* 读取失败回退默认 */ }
  return "_default";
}

/** 写入活跃项目 ID 到磁盘（服务端用） */
export function setActiveProjectFileId(id: string): void {
  ensureDir(getBaseOutputDir());
  fs.writeFileSync(getActiveProjectFilePath(), id, "utf-8");
  console.log(`[paths] 活跃项目已切换: ${id}`);
}

/** 清除磁盘上的活跃项目 ID → 回退到 _default */
export function clearActiveProjectFileId(): void {
  try {
    const fp = getActiveProjectFilePath();
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    console.log("[paths] 活跃项目标识已清除 → _default");
  } catch { /* ignore */ }
}

// ─── 旧数据自动迁移（仅执行一次） ─────────────────────────

let _migrated = false;

/**
 * 检查 outputs/grid-images/ 根目录是否有散落的图片文件（旧版无隔离），
 * 如有则自动迁移到 _default/ 子目录。热更新后首次启动自动触发。
 */
function migrateGridImagesIfNeeded(): void {
  if (_migrated) return;
  _migrated = true;

  const baseGridDir = path.join(getBaseOutputDir(), "grid-images");
  if (!fs.existsSync(baseGridDir)) return;

  const entries = fs.readdirSync(baseGridDir, { withFileTypes: true });
  const flatFiles = entries.filter(
    (e) => e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name)
  );
  if (flatFiles.length === 0) return;

  // 有散落文件 → 迁移到 _default/
  const defaultDir = path.join(baseGridDir, "_default");
  ensureDir(defaultDir);

  let moved = 0;
  for (const file of flatFiles) {
    const src = path.join(baseGridDir, file.name);
    const dest = path.join(defaultDir, file.name);
    try {
      fs.renameSync(src, dest);
      moved++;
    } catch {
      // rename 可能跨分区失败，用 copy + delete 回退
      try {
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src);
        moved++;
      } catch { /* 跳过无法迁移的文件 */ }
    }
  }

  console.log(
    `[migration] ✓ 已迁移 ${moved}/${flatFiles.length} 张宫格图片到 grid-images/_default/`
  );
}

/**
 * outputs/grid-images/{projectId}/ — 按项目隔离的宫格图片目录
 *
 * 首次调用时自动执行旧数据迁移。
 */
export function getGridImagesDir(): string {
  migrateGridImagesIfNeeded();
  const projectId = getActiveProjectFileId();
  return path.join(getBaseOutputDir(), "grid-images", projectId);
}

/** outputs/videos/ */
export function getVideosDir(): string {
  return path.join(getBaseOutputDir(), "videos");
}

/** outputs/video-frames/ */
export function getVideoFramesDir(): string {
  return path.join(getBaseOutputDir(), "video-frames");
}

/**
 * Ensure a directory exists; create recursively if missing.
 */
export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
