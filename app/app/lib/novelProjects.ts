import { kvLoad, kvSet, kvRemove } from "./kvDB";

// ── Types ──

export interface ChapterDetail {
  plotPoints: string[]; // 剧情细纲
  scenes: string[];     // 场景设定
  sceneList?: ChapterScene[]; // 场景列表（结构化）
  sceneContents?: string[]; // 按 sceneList 下标存储的场景正文
  characters: string[]; // 出场人物 (简单列表)
  characterList?: Partial<Character>[]; // 出场人物 (详细结构化)
  skills: string[];     // 技能/功法
  items: string[];      // 物品/道具
  world: string[];      // 世界观/背景
  wordCount?: string;   // 字数预估
  mainPlot?: string;    // 主要剧情 (AI生成摘要)
  keyPlots?: string[];  // 关键情节 (Diff from plotPoints?)
  dialogues?: string[]; // 关键对话/独白
  ending?: string;      // 章节结尾
  suspense?: string;    // 悬念设置
  hooks?: StoryHook[];  // 新增：章节内的伏笔管理
}

export interface StoryHook {
    id: string;
    type: "pre" | "post"; // pre: 预埋, post: 回收
    content: string;
    sourceChapterIndex?: number;
    targetChapterIndex?: number;
    status: "open" | "closed";
}

export interface StoryMemory {
    id: string;
    content: string;
    type: "character" | "plot" | "world";
    tags: string[];
    importance: number; // 1-10
}

export interface ChapterScene {
  title: string;
  summary: string;
  location?: string;
  goal?: string;
  conflict?: string;
  outcome?: string;
}

export interface ChapterOutline {
  title: string;
  summary: string;
  points?: string[]; // Deprecated: legacy support
  detail?: ChapterDetail; // 新的细纲结构
  content?: string; // 正文
}

export interface VolumeOutline {
  title: string;
  chapters: ChapterOutline[];
}

export interface Character {
    id: string;
    name: string;
    role: "主角" | "配角" | "反派" | "龙套";
    gender: "男" | "女" | "未知";
    age?: string;
    personality?: string;
    appearance?: string;
    background?: string;
    foreshadowing?: string; // 伏笔
    growthArc?: string;     // 成长线
    avatar?: string; // URL or base64
}

export interface NovelProject {
  id: string;
  title: string;
  status: "大纲中" | "连载中" | "完结" | "草稿";
  tags: string[];
  volumes: number;
  chapters: number;
  words: number;
  characterCount: number;
  createdAt: string;
  updatedAt: string;
  description?: string;
  cover?: string;
  outline?: VolumeOutline[]; // 存储大纲结构
  characters?: Character[]; // 角色列表
  globalPlan?: any; // 新增：全局故事规划
  memories?: StoryMemory[]; // 新增：长效记忆管理
  parentId?: string; // 父项目 ID
}

const NOVEL_PROJECTS_KEY = "novel-projects";
const ACTIVE_NOVEL_PROJECT_KEY = "novel-active-project";

// ── CRUD ──

export async function loadNovelProjects(): Promise<NovelProject[]> {
  if (typeof window === "undefined") return [];
  try {
    const saved = await kvLoad(NOVEL_PROJECTS_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch { /* ignore */ }
  return [];
}

export const getNovelProjects = loadNovelProjects;

export async function saveNovelProjects(projects: NovelProject[]) {
  try {
    await kvSet(NOVEL_PROJECTS_KEY, JSON.stringify(projects));
  } catch { /* ignore */ }
}

export async function createNovelProject(title: string, description: string = "", tags: string[] = [], outline?: VolumeOutline[], parentId?: string): Promise<NovelProject> {
  const id = `novel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  // Calculate stats if outline is provided
  let volumes = 0;
  let chapters = 0;
  
  if (outline) {
      volumes = outline.length;
      chapters = outline.reduce((acc, v) => acc + v.chapters.length, 0);
  }

  const project: NovelProject = {
    id,
    title,
    status: outline ? "大纲中" : "草稿",
    tags,
    volumes,
    chapters,
    words: 0,
    characterCount: 0,
    createdAt: now,
    updatedAt: now,
    description,
    outline,
    characters: [],
    parentId
  };

  const projects = await loadNovelProjects();
  projects.unshift(project);
  await saveNovelProjects(projects);
  
  return project;
}

export async function updateNovelProject(id: string, updates: Partial<NovelProject>): Promise<void> {
  const projects = await loadNovelProjects();
  const idx = projects.findIndex(p => p.id === id);
  if (idx === -1) return;

  // Recalculate stats if outline is updated
  if (updates.outline) {
      updates.volumes = updates.outline.length;
      updates.chapters = updates.outline.reduce((acc, v) => acc + v.chapters.length, 0);
  }
  
  // Recalculate character count if characters updated
  if (updates.characters) {
      updates.characterCount = updates.characters.length;
  }

  projects[idx] = { ...projects[idx], ...updates, updatedAt: new Date().toISOString() };
  await saveNovelProjects(projects);
}

export async function deleteNovelProject(id: string): Promise<void> {
  const projects = await loadNovelProjects();
  const filtered = projects.filter(p => p.id !== id);
  await saveNovelProjects(filtered);
  
  // Also clear active project if it was the deleted one
  const activeId = await getActiveNovelProjectId();
  if (activeId === id) {
    await clearActiveNovelProjectId();
  }
}

// ── Active Project ──

export async function getActiveNovelProjectId(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  return await kvLoad(ACTIVE_NOVEL_PROJECT_KEY);
}

export async function setActiveNovelProjectId(id: string): Promise<void> {
  await kvSet(ACTIVE_NOVEL_PROJECT_KEY, id);
}

export async function clearActiveNovelProjectId(): Promise<void> {
  await kvRemove(ACTIVE_NOVEL_PROJECT_KEY);
}

// ── Helpers ──

export async function getActiveNovelProject(): Promise<NovelProject | null> {
    const id = await getActiveNovelProjectId();
    if (!id) return null;
    const projects = await loadNovelProjects();
    return projects.find(p => p.id === id) || null;
}
