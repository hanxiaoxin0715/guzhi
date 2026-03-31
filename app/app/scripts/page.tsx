"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "../components/Toast";
import { useTaskQueue } from "../lib/taskQueue";
import { loadScriptsDB, saveAllScriptsDB, saveScriptDB, deleteScriptDB, migrateScriptsFromLocalStorage } from "../lib/scriptDB";
import Sidebar from "../components/Sidebar";
import {
  BookOpen,
  Search,
  ScrollText,
  Plus,
  Upload,
  Edit3,
  Play,
  Film,
  MapPin,
  Save,
  X,
  Trash2,
  Wand2,
  Loader,
  Grid3X3,
  ChevronDown,
  ChevronRight,
  FileText,
  List,
} from "lucide-react";

import { readFileWithEncoding } from "../lib/fileEncoding";

// ── CSV 解析工具 ──

/**
 * 将 CSV 文本拆分为完整逻辑行（RFC 4180 兼容）。
 * 正确处理引号内的换行符 —— Excel 导出的多行单元格不会被截断。
 */
function splitCsvRows(text: string): string[] {
  const rows: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '""';
          i++;
        } else {
          inQuotes = false;
          current += '"';
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        current += '"';
      } else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        if (current.trim()) rows.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  if (current.trim()) rows.push(current);
  return rows;
}

/** 解析 CSV 行（支持带引号的字段、嵌套逗号、换行等） */
function parseCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === delimiter) { fields.push(current.trim()); current = ""; }
      else { current += ch; }
    }
  }
  fields.push(current.trim());
  return fields;
}

/** 自动检测 CSV 分隔符 */
function detectDelimiter(text: string): string {
  const firstLine = text.split("\n")[0] || "";
  const tab = (firstLine.match(/\t/g) || []).length;
  const comma = (firstLine.match(/,/g) || []).length;
  const semicolon = (firstLine.match(/;/g) || []).length;
  if (tab >= comma && tab >= semicolon && tab > 0) return "\t";
  if (semicolon > comma && semicolon > 0) return ";";
  return ",";
}

/**
 * 将 CSV 内容转换为 Markdown 格式的剧本。
 * 自动检测格式：
 * - 单列：每行为一段文字
 * - 多列：智能合并各列，常见的「集数/场景/角色/台词/描述」拼为结构化 Markdown
 */
function parseCSVToMarkdown(csvText: string): string {
  const delimiter = detectDelimiter(csvText);
  // 用 RFC 4180 兼容的拆行（正确处理引号内换行）
  const lines = splitCsvRows(csvText);
  if (lines.length === 0) return "";

  // 解析所有行
  const rows = lines.map(l => parseCsvLine(l, delimiter));
  const maxCols = Math.max(...rows.map(r => r.length));

  // 单列：直接拼接
  if (maxCols <= 1) {
    return rows.map(r => r[0] || "").join("\n\n");
  }

  // 多列：检测是否第一行为表头
  const firstRow = rows[0];
  const isHeader = firstRow.every(cell => {
    // 表头通常是短字段（<20字）且不含换行
    return cell.length < 20 && !cell.includes("\n");
  }) && firstRow.some(cell => /[一-鿿]|scene|episode|desc|content|title|character/i.test(cell));

  const headers = isHeader ? firstRow : null;
  const dataRows = isHeader ? rows.slice(1) : rows;

  // 尝试识别特定列：集数/章节、标题、内容/描述
  let epCol = -1, titleCol = -1, contentCol = -1;
  if (headers) {
    headers.forEach((h, i) => {
      const hl = h.toLowerCase();
      if (/集|章|幕|episode|ep|chapter|act|scene|\b(#|no\.)/.test(hl)) epCol = i;
      else if (/标题|title|name|名称|场景名/.test(hl) && titleCol === -1) titleCol = i;
      else if (/内容|描述|正文|content|desc|body|text|台词|剧情/.test(hl) && contentCol === -1) contentCol = i;
    });
  }

  const mdParts: string[] = [];

  // 有表头且能识别内容列：生成结构化 Markdown
  if (headers && contentCol !== -1) {
    for (const row of dataRows) {
      const ep = epCol >= 0 ? row[epCol] : "";
      const title = titleCol >= 0 ? row[titleCol] : "";
      const content = row[contentCol] || "";
      // 章节标题
      const heading = [ep, title].filter(Boolean).join(" · ");
      if (heading) mdParts.push(`## ${heading}`);
      // 其他列作为元数据
      const meta: string[] = [];
      headers.forEach((h, i) => {
        if (i === epCol || i === titleCol || i === contentCol) return;
        if (row[i]) meta.push(`**${h}**: ${row[i]}`);
      });
      if (meta.length > 0) mdParts.push(meta.join(" | "));
      mdParts.push(content);
      mdParts.push(""); // 空行分隔
    }
  }
  // 有表头但无法识别内容列：将表头作为标签拼接
  else if (headers) {
    for (const row of dataRows) {
      const parts: string[] = [];
      headers.forEach((h, i) => {
        if (row[i]) parts.push(`**${h}**: ${row[i]}`);
      });
      mdParts.push(parts.join("\n"));
      mdParts.push("");
    }
  }
  // 无表头：多列用「 | 」拼接每行
  else {
    for (const row of dataRows) {
      mdParts.push(row.filter(Boolean).join(" | "));
      mdParts.push("");
    }
  }

  return mdParts.join("\n").trim();
}

const DEFAULT_SCRIPT = `# 神祗第一集 · 孙悟空觉醒

## 项目信息
- 视觉风格：真人写实
- 画幅比例：16:9（横屏）
- 故事类型：奇幻战争·史诗
- 时间设定：异变历103年

## 故事概述

异界入侵异变历103年，西方众神庇佑各自子民，而龙国沦为"神弃之地"。在绝境长城防线上，人类面临S级兽潮绝境。主人公在战壕中发现被遗弃的石像乃是孙悟空，当工兵班长欲炸毁石像开辟火力时，主人公挺身护卫，通过念诵《西游记》开篇诗句唤醒大圣灵魂。大圣苏醒后势如破竹击溃怪兽，以霸气宣言重振龙国士气——龙国的神，终于回来了。

## 场景一 · 绝境长城战壕

苍穹裂开蜈蚣状的空间缝隙，暗紫色能量火球从裂缝中坠落。战壕中的主人公在剧痛中睁眼——右肩膀有新鲜的伤口，左腿被碎石压住。

远处，数尊西方金色神祗的虚影高坐在不可见的神座上，蔑视地俯瞰战场。无数黑甲妖兽如潮水般冲击人类最后的防线。

## 场景二 · 发现石像

工兵班长嘶哑怒吼，命令炸掉挡在重机枪射界前的石头。主人公凑近检查，发现这尊灰白色石像呈半蹲半坐姿态，嘴角呈雷公嘴型，身上残留着锁子黄金甲痕迹，头顶有破碎的凤翅紫金冠。

他认出了——这是齐天大圣孙悟空。

## 场景三 · 护卫石像

班长举起炸药，主人公挥起工兵铲挡在石像前："这块石头不能炸！"两人在绝境中对峙。主人公坚信这尊被遗忘50年的石像，是龙国最后的希望。

## 场景四 · S级兽潮

防线全面崩塌，指挥部被摧毁，通讯中断。天空裂缝扩大，更多妖兽涌出。士兵们在绝望中战斗，弹药即将耗尽。

## 场景五 · 唤醒大圣

主人公单膝跪地，以额头触碰石像手背，开始嘶吼《西游记》开篇诗句："混沌未分天地乱，茫茫渺渺无人见……覆载群生仰至仁，发明万物皆成善！欲知造化会元功——须看！西游！释厄传！"

金色暖流从无形的灵魂平面涌出，灌入石像。战场的风骤然停止，金色光柱从石像天灵盖直冲九霄。

## 场景六 · 大圣苏醒

石皮寸寸剥落，凤翅紫金冠随风狂舞，锁子黄金甲光芒万丈。火眼金睛驤然张开，金红色光芒照射整个战场。齐天大圣，活了。

## 场景七 · 横扫战场

大圣金箍棒从耳中取出，化为万丈长棍。一棒横扫，前方百米内所有妖兽化为齑粉。冰凉的战壕爆发出山呼海啸般的欢呼。

## 场景八 · 霸气宣言

大圣屈身金箍棒之上，俯瞰满地妖兽残骸，韵白入云霄——**"龙国的神，回来了。"**`;

const MAX_SCRIPTS = 1000;

interface Script {
  id: string;
  title: string;
  desc: string;
  status: string;
  content: string;
}

import { parseChapters, type ParsedChapter, type ParsedVolume } from "../lib/chapterParser";

export default function ScriptsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { addTask, removeTask } = useTaskQueue();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [chapterAnalyzing, setChapterAnalyzing] = useState(false);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null); // null = 全文
  const [collapsedVolumes, setCollapsedVolumes] = useState<Set<string>>(new Set());
  const [analysisResult, setAnalysisResult] = useState<{
    totalNineGrids: number;
    plan: { gridIndex: number; episodeId?: string; title: string; description: string; scenes: string[]; beats?: string[] }[];
    reasoning: string;
  } | null>(null);

  // ── 挂载时恢复上次选中的剧本/章节 ──
  const restoredRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Migrate from localStorage if needed, then load from IndexedDB
      await migrateScriptsFromLocalStorage();
      const dbScripts = await loadScriptsDB();
      if (cancelled) return;
      if (dbScripts.length > 0) {
        setScripts(dbScripts);
        // 恢复上次选中的剧本
        const savedId = localStorage.getItem("feicai-scripts-active-id");
        if (savedId) {
          const idx = dbScripts.findIndex(s => s.id === savedId);
          if (idx >= 0) {
            setActiveIdx(idx);
            restoredRef.current = true;
            // 恢复选中章节
            const savedChId = localStorage.getItem("feicai-scripts-chapter-id");
            if (savedChId) setSelectedChapterId(savedChId);
          }
        }
      } else {
        initDefault();
      }
      // Check for pending imports from AI Novel Workshop
      try {
        const res = await fetch("/api/scripts/import");
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          const pending: { id: string; title: string; desc: string; content: string; source: string }[] = data.pending || [];
          if (pending.length > 0) {
            const currentScripts = dbScripts.length > 0 ? dbScripts : [];
            let added = 0;
            for (const p of pending) {
              // Skip if a script with same id already exists
              if (currentScripts.some((s) => s.id === p.id)) continue;
              const newScript: Script = {
                id: p.id,
                title: p.title,
                desc: p.desc || `来自 ${p.source || "外部应用"}`,
                status: "已导入 · 待处理",
                content: p.content,
              };
              currentScripts.push(newScript);
              await saveScriptDB(newScript);
              added++;
            }
            if (cancelled) return;
            if (added > 0) {
              setScripts([...currentScripts]);
              setActiveIdx(currentScripts.length - 1);
              toast(`已自动导入 ${added} 个来自小说工作坊的剧本`, "success");
              // Clear pending list
              await fetch("/api/scripts/import?action=clear");
            }
          }
        }
      } catch { /* pending import check failed — ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  function initDefault() {
    const defaultScripts: Script[] = [
      {
        id: "ep01",
        title: "神祗 · 第一集",
        desc: "孙悟空觉醒",
        status: "EP01 · 分镜完成",
        content: DEFAULT_SCRIPT,
      },
    ];
    setScripts(defaultScripts);
    saveAllScriptsDB(defaultScripts).catch(() => {});
  }

  function saveScripts(updated: Script[], silent = false): boolean {
    setScripts(updated);
    saveAllScriptsDB(updated).catch((e) => {
      console.error("IndexedDB save failed:", e);
      if (!silent) {
        const sizeMB = (new Blob([JSON.stringify(updated)]).size / 1024 / 1024).toFixed(1);
        toast(`剧本保存失败：存储空间不足（数据约 ${sizeMB} MB）`, "error");
      }
    });
    return true;
  }

  const activeScript = scripts[activeIdx];

  // Parse chapter structure for the active script
  const parsedStructure = useMemo(() => {
    if (!activeScript) return null;
    const result = parseChapters(activeScript.content);
    // Only show chapter list if there are 2+ real chapters
    if (result.chapters.length < 2) return null;
    return result;
  }, [activeScript?.id, activeScript?.content]);

  // Reset chapter selection when switching scripts（跳过首次恢复）
  useEffect(() => {
    if (restoredRef.current) {
      restoredRef.current = false;
      return;
    }
    setSelectedChapterId(null);
    setCollapsedVolumes(new Set());
  }, [activeIdx]);

  // ── 持久化：当前选中剧本和章节 ──
  useEffect(() => {
    const s = scripts[activeIdx];
    if (s) localStorage.setItem("feicai-scripts-active-id", s.id);
  }, [activeIdx, scripts]);
  useEffect(() => {
    if (selectedChapterId) localStorage.setItem("feicai-scripts-chapter-id", selectedChapterId);
    else localStorage.removeItem("feicai-scripts-chapter-id");
  }, [selectedChapterId]);

  // Get the content to display (full or selected chapter)
  const displayContent = useMemo(() => {
    if (!activeScript) return "";
    if (!selectedChapterId || !parsedStructure) return activeScript.content;
    const ch = parsedStructure.chapters.find((c) => c.id === selectedChapterId);
    if (!ch) return activeScript.content;
    return `## ${ch.fullTitle || ch.title}\n\n${ch.content}`;
  }, [activeScript?.content, selectedChapterId, parsedStructure]);

  // Content for storyboard generation (selected chapter or full text)
  const storyboardContent = useMemo(() => {
    if (!activeScript) return "";
    if (!selectedChapterId || !parsedStructure) return activeScript.content;
    const ch = parsedStructure.chapters.find((c) => c.id === selectedChapterId);
    return ch ? `## ${ch.fullTitle || ch.title}\n\n${ch.content}` : activeScript.content;
  }, [activeScript?.content, selectedChapterId, parsedStructure]);

  const filteredScripts = useMemo(() => {
    if (!searchQuery) return scripts.map((s, i) => ({ script: s, realIdx: i }));
    return scripts
      .map((s, i) => ({ script: s, realIdx: i }))
      .filter(({ script: s }) => s.title.includes(searchQuery) || s.desc.includes(searchQuery));
  }, [scripts, searchQuery]);

  const handleSelectScript = useCallback((idx: number) => {
    setActiveIdx(idx);
    setEditing(false);
  }, []);

  function handleImport() {
    fileInputRef.current?.click();
  }

  // readFileWithEncoding 已提取到 app/lib/fileEncoding.ts（支持 UTF-8/UTF-16/GBK/BOM 检测）

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    (async () => {
      try {
        let text = await readFileWithEncoding(file);
        const name = file.name.replace(/\.[^.]+$/, "");
        const ext = file.name.split(".").pop()?.toLowerCase();
        // CSV 文件自动解析转 Markdown
        if (ext === "csv") {
          text = parseCSVToMarkdown(text);
          if (!text.trim()) {
            toast("CSV 文件为空或格式无法识别", "error");
            return;
          }
        }
        if (scripts.length >= MAX_SCRIPTS) {
          toast(`剧本数量已达上限（${MAX_SCRIPTS} 个），请删除不需要的剧本后重试`, "error");
          return;
        }
        const newScript: Script = {
          id: `import-${Date.now()}`,
          title: name,
          desc: ext === "csv" ? `CSV导入 · ${file.name}` : `导入自 ${file.name}`,
          status: "已导入 · 待处理",
          content: text,
        };
        const updated = [...scripts, newScript];
        setScripts(updated);
        await saveScriptDB(newScript);
        setActiveIdx(updated.length - 1);
        toast(`已导入「${file.name}」作为新剧本${ext === "csv" ? "（CSV已转换为Markdown）" : ""}`, "success");
      } catch (err) {
        toast(`导入失败: ${err instanceof Error ? err.message : "未知错误"}`, "error");
      }
    })();
    e.target.value = "";
  }

  function handleEdit() {
    if (!activeScript) return;
    setEditContent(activeScript.content);
    setEditTitle(activeScript.title);
    setEditDesc(activeScript.desc);
    setEditing(true);
  }

  async function handleSave() {
    if (!activeScript) return;
    const updatedScript = { ...activeScript, title: editTitle, desc: editDesc, content: editContent };
    const updated = [...scripts];
    updated[activeIdx] = updatedScript;
    // Batch both state updates so React 18 only triggers ONE re-render
    setScripts(updated);
    setEditing(false);
    toast("剧本已保存", "success");
    // Fire-and-forget IndexedDB write — don't block UI
    saveScriptDB(updatedScript).catch(e => console.error("Save failed:", e));
  }

  async function handleNewScript() {
    if (scripts.length >= MAX_SCRIPTS) {
      toast(`剧本数量已达上限（${MAX_SCRIPTS} 个），请删除不需要的剧本后重试`, "error");
      return;
    }
    const newScript: Script = {
      id: `script-${Date.now()}`,
      title: "新建剧本",
      desc: "点击编辑",
      status: "草稿",
      content: "# 新建剧本\n\n在此输入剧本内容...\n",
    };
    const updated = [...scripts, newScript];
    setScripts(updated);
    // Incremental save: only insert the new script
    await saveScriptDB(newScript);
    setActiveIdx(updated.length - 1);
    toast("已创建新剧本", "success");
  }

  async function handleDelete() {
    if (scripts.length <= 1) {
      toast("至少需要保留一个剧本", "error");
      return;
    }
    const script = activeScript;
    if (!script) return;
    const updated = scripts.filter((_, i) => i !== activeIdx);
    setScripts(updated);
    // Incremental delete: only remove the one script
    await deleteScriptDB(script.id);
    setActiveIdx(Math.max(0, activeIdx - 1));
    setEditing(false);
    toast(`已删除「${script.title}」`, "info");
  }

  async function handleAnalyze() {
    const textToAnalyze = storyboardContent;
    if (!activeScript || textToAnalyze.length < 50) {
      toast("剧本内容过短，无法分析", "error");
      return;
    }
    setAnalyzing(true);
    const taskId = `llm-analyze-${Date.now()}`;
    addTask({ id: taskId, type: "llm", label: `剧本分析「${activeScript.title.slice(0, 8)}」`, detail: "文本模型" });
    try {
      const settings = JSON.parse(localStorage.getItem("feicai-settings") || "{}");
      if (!settings["llm-key"]) {
        toast("请先在「设置」页配置 LLM API Key", "error");
        setAnalyzing(false);
        return;
      }
      // 读取用户自定义提示词（来自提示词编辑页）
      const { loadSystemPromptsAsync } = await import("../lib/consistency");
      const savedPrompts = await loadSystemPromptsAsync();
      const res = await fetch("/api/analyze-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textToAnalyze,
          settings,
          customPrompt: savedPrompts.analyzeScript || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAnalysisResult(data);
        toast(`分析完成！建议 ${data.totalNineGrids} 张九宫格`, "success");
      } else {
        const err = await res.json().catch(() => ({}));
        toast(`分析失败: ${err.error || "未知错误"}`, "error");
      }
    } catch (e: unknown) {
      toast(`分析错误: ${e instanceof Error ? e.message : "未知"}`, "error");
    } finally {
      setAnalyzing(false);
      removeTask(taskId);
    }
  }

  // ── AI 智能分析章节：识别并拆分未格式化的小说章节 ──
  async function handleAnalyzeChapters() {
    if (!activeScript || activeScript.content.length < 100) {
      toast("内容过短，无法分析章节", "error");
      return;
    }
    // 如果已经有章节，无需重复分析
    if (parsedStructure && parsedStructure.chapters.length >= 2) {
      toast(`已检测到 ${parsedStructure.chapters.length} 个章节，无需重复分析`, "info");
      return;
    }

    setChapterAnalyzing(true);
    const taskId = `llm-chapters-${Date.now()}`;
    addTask({ id: taskId, type: "llm", label: `章节拆分「${activeScript.title.slice(0, 8)}」`, detail: "智能识别章节" });

    try {
      const settings = JSON.parse(localStorage.getItem("feicai-settings") || "{}");
      if (!settings["llm-key"]) {
        toast("请先在「设置」页配置 LLM API Key", "error");
        setChapterAnalyzing(false);
        removeTask(taskId);
        return;
      }

      // 从文本中截取前 6000 字 + 后 2000 字送给 LLM 分析（节省 token）
      const fullText = activeScript.content;
      const sampleText = fullText.length > 10000
        ? fullText.slice(0, 6000) + "\n\n...(中间省略)...\n\n" + fullText.slice(-2000)
        : fullText;

      const prompt = [
        "你是一个小说/剧本章节分析专家。请分析以下文本，识别出所有章节边界。",
        "",
        "要求：",
        "1. 识别每个章节的标题行（如 \"第一章 xxx\"、\"Chapter 1\"、\"序章\"、\"楔子\" 等）",
        "2. 如果文本中没有明显的章节标题，则根据内容转折点智能拆分",
        "3. 返回一个 JSON 数组，每个元素包含：",
        "   - title: 章节标题（如 \"第1章 死而复生，废物女婿回来了\"）",
        "   - marker: 该章节起始位置的原文关键短语（用于定位，10-30字，必须是原文中出现的内容）",
        "",
        "4. 按章节在文中出现的先后顺序排列",
        "5. 只返回 JSON 数组，不要任何解释文字",
        "",
        "示例输出：",
        '[{"title":"第1章 死而复生","marker":"林骁死了。死得极惨。"},{"title":"第2章 第一场直播","marker":"一声脆响，火辣辣的耳光"}]',
        "",
        "以下是待分析的文本：",
        "---",
        sampleText,
      ].join("\n");

      const res = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: settings["llm-key"] || "",
          baseUrl: (settings["llm-url"] || "https://api.geeknow.top/v1").replace(/\/+$/, ""),
          model: settings["llm-model"] || "gemini-2.5-flash",
          provider: settings["llm-provider"] || "openAi",
          prompt,
          maxTokens: 8192,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast(`章节分析失败: ${err.error || res.statusText}`, "error");
        return;
      }

      const data = await res.json();
      let text = data.content || data.text || data.choices?.[0]?.message?.content || "";
      // 提取 JSON 数组
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        toast("AI 返回内容中未找到章节数据，请重试", "error");
        return;
      }

      const chapterList: { title: string; marker: string }[] = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(chapterList) || chapterList.length < 2) {
        toast("AI 识别到的章节数量不足，可能文本没有明确的章节划分", "info");
        return;
      }

      // 根据 marker 在原文中定位章节边界，插入 ## 标记
      let newContent = fullText;
      let insertCount = 0;

      // 倒序处理，避免插入后位移影响后续定位
      const insertions: { pos: number; heading: string }[] = [];
      for (const ch of chapterList) {
        if (!ch.marker) continue;
        // 在原文中查找 marker
        const markerClean = ch.marker.replace(/\s+/g, "").slice(0, 50);
        // 尝试精确匹配和模糊匹配
        let pos = -1;
        // 先找原始 marker
        pos = fullText.indexOf(ch.marker);
        if (pos < 0) {
          // 尝试去空格匹配
          const noSpaceContent = fullText.replace(/\s+/g, "");
          const noSpacePos = noSpaceContent.indexOf(markerClean);
          if (noSpacePos >= 0) {
            // 映射回原始位置（粗略方式：按比例映射）
            pos = Math.round((noSpacePos / noSpaceContent.length) * fullText.length);
            // 调整到行首
            const prevNewline = fullText.lastIndexOf("\n", pos);
            pos = prevNewline >= 0 ? prevNewline + 1 : 0;
          }
        } else {
          // 调整到行首
          const prevNewline = fullText.lastIndexOf("\n", pos);
          pos = prevNewline >= 0 ? prevNewline + 1 : 0;
        }

        if (pos >= 0) {
          // 检查上下文确认这不是重复的
          const alreadyHasHeading = fullText.slice(Math.max(0, pos - 5), pos + 5).includes("## ");
          if (!alreadyHasHeading) {
            insertions.push({ pos, heading: `## ${ch.title}` });
          }
        }
      }

      // 去重并按位置倒序排列
      const uniqueInsertions = insertions
        .filter((v, i, arr) => arr.findIndex((a) => Math.abs(a.pos - v.pos) < 20) === i)
        .sort((a, b) => b.pos - a.pos);

      for (const ins of uniqueInsertions) {
        newContent = newContent.slice(0, ins.pos) + ins.heading + "\n\n" + newContent.slice(ins.pos);
        insertCount++;
      }

      if (insertCount === 0) {
        toast("未能在原文中定位章节位置，请尝试手动添加章节标题", "error");
        return;
      }

      // 保存更新后的内容
      const updatedScript = { ...activeScript, content: newContent, status: "已导入 · 章节已拆分" };
      const updated = [...scripts];
      updated[activeIdx] = updatedScript;
      setScripts(updated);
      saveScriptDB(updatedScript).catch(e => console.error("Save failed:", e));
      toast(`AI 成功识别并拆分了 ${insertCount} 个章节！`, "success");

    } catch (e: unknown) {
      console.error("[ChapterAnalysis]", e);
      toast(`章节分析出错: ${e instanceof Error ? e.message : "未知错误"}`, "error");
    } finally {
      setChapterAnalyzing(false);
      removeTask(taskId);
    }
  }

  // Convert markdown content to HTML string for dangerouslySetInnerHTML
  // This is MUCH faster than creating thousands of React elements for long texts
  // (novels/scripts can have thousands of lines → thousands of createElement calls freeze the page)
  const renderedContentHtml = useMemo(() => {
    if (!activeScript || editing) return "";
    const content = displayContent;
    const lines = content.split("\n");
    const htmlParts: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("## ")) {
        htmlParts.push(`<h3 class="text-[18px] font-semibold text-[var(--text-primary)] mt-6 mb-2">${escHtml(line.slice(3))}</h3>`);
      } else if (line.startsWith("# ")) {
        htmlParts.push(`<h2 class="font-serif text-[24px] font-bold text-[var(--text-primary)] mb-4">${escHtml(line.slice(2))}</h2>`);
      } else if (line.startsWith("- ")) {
        htmlParts.push(`<div class="flex gap-2 ml-4 my-0.5"><span class="text-[var(--gold-primary)]">&bull;</span><span class="text-[13px] text-[var(--text-secondary)]">${escHtml(line.slice(2))}</span></div>`);
      } else if (line.trim() === "") {
        htmlParts.push(`<div class="h-2"></div>`);
      } else {
        // Handle **bold** inline
        const escaped = escHtml(line);
        const withBold = escaped.replace(/\*\*([^*]+)\*\*/g,
          `<strong class="font-semibold text-[var(--gold-primary)]">$1</strong>`);
        htmlParts.push(`<p class="text-[14px] leading-relaxed text-[var(--text-secondary)]">${withBold}</p>`);
      }
    }
    return htmlParts.join("");
  }, [activeScript?.id, displayContent, editing]);

  // Minimal HTML entity escaping for safe dangerouslySetInnerHTML rendering
  function escHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  return (
    <div className="flex h-full w-full">
      <Sidebar />
      <div className="flex flex-1 h-full">
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.text,.csv"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Script List */}
        <div className="flex flex-col w-[300px] h-full border-r border-[var(--border-default)] shrink-0">
          <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border-default)]">
            <div className="flex items-center gap-2">
              <BookOpen size={20} className="text-[var(--gold-primary)]" />
              <span className="text-[16px] font-semibold text-[var(--text-primary)]">
                剧本列表
              </span>
              <span className="text-[12px] text-[var(--text-muted)]">
                {scripts.length}/{MAX_SCRIPTS}
              </span>
            </div>
            <button
              onClick={handleNewScript}
              className="flex items-center gap-1.5 bg-[var(--gold-primary)] px-3.5 py-2 text-[12px] font-medium text-[#0A0A0A] hover:brightness-110 transition cursor-pointer"
            >
              <Plus size={14} />
              新建剧本
            </button>
          </div>

          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-default)]">
            <Search size={14} className="text-[var(--text-muted)] shrink-0" />
            <input
              className="flex-1 bg-transparent text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              placeholder="搜索剧本..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1 p-2 flex-1 overflow-auto">
            {filteredScripts.map(({ script: s, realIdx }) => (
              <button
                key={s.id}
                onClick={() => handleSelectScript(realIdx)}
                className={`flex items-center gap-3.5 px-4 py-3.5 rounded w-full text-left transition cursor-pointer ${
                  realIdx === activeIdx
                    ? "bg-[var(--gold-transparent)]"
                    : "hover:bg-[var(--bg-surface)]"
                }`}
              >
                <ScrollText
                  size={18}
                  className={
                    realIdx === activeIdx
                      ? "text-[var(--gold-primary)]"
                      : "text-[var(--text-muted)]"
                  }
                />
                <div className="flex flex-col gap-1 flex-1">
                  <span
                    className={`text-[14px] font-medium ${
                      realIdx === activeIdx
                        ? "text-[var(--text-primary)]"
                        : "text-[var(--text-secondary)]"
                    }`}
                  >
                    {s.title}
                  </span>
                  <span className="text-[12px] text-[var(--text-muted)]">
                    {s.desc} · {s.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Chapter Outline Panel — only shown for multi-chapter content */}
        {activeScript && parsedStructure && !editing && (
          <div className="flex flex-col w-[220px] h-full border-r border-[var(--border-default)] shrink-0">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-default)]">
              <List size={14} className="text-[var(--gold-primary)]" />
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">章节目录</span>
              <span className="text-[10px] text-[var(--text-muted)] ml-auto">
                {parsedStructure.chapters.length} 章
              </span>
            </div>

            {/* "全文" toggle */}
            <button
              onClick={() => setSelectedChapterId(null)}
              className={`flex items-center gap-2 px-4 py-2.5 text-left border-b border-[var(--border-subtle)] transition cursor-pointer ${
                !selectedChapterId ? "bg-[#C9A96210] text-[var(--gold-primary)]" : "hover:bg-[#FFFFFF03] text-[var(--text-secondary)]"
              }`}
            >
              <FileText size={12} className={!selectedChapterId ? "text-[var(--gold-primary)]" : "text-[var(--text-muted)]"} />
              <span className="text-[12px] font-medium">全文阅览</span>
              <span className="text-[10px] text-[var(--text-muted)] ml-auto">
                {activeScript.content.replace(/\s/g, "").length.toLocaleString()} 字
              </span>
            </button>

            {/* Volume + Chapter tree */}
            <div className="flex-1 overflow-auto">
              {parsedStructure.volumes.map((vol) => (
                <div key={vol.name}>
                  {/* Volume header — collapsible */}
                  {parsedStructure.volumes.length > 1 && (
                    <button
                      onClick={() => setCollapsedVolumes((prev) => {
                        const next = new Set(prev);
                        if (next.has(vol.name)) next.delete(vol.name); else next.add(vol.name);
                        return next;
                      })}
                      className="flex items-center gap-1.5 w-full px-4 py-2 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] hover:bg-[#1A1A1A] transition cursor-pointer"
                    >
                      {collapsedVolumes.has(vol.name) ? (
                        <ChevronRight size={10} className="text-[var(--text-muted)]" />
                      ) : (
                        <ChevronDown size={10} className="text-[var(--text-muted)]" />
                      )}
                      <span className="text-[11px] font-medium text-[var(--text-secondary)] truncate flex-1 text-left">{vol.name}</span>
                      <span className="text-[9px] text-[var(--text-muted)]">{vol.chapters.length} 章</span>
                    </button>
                  )}
                  {/* Chapter list */}
                  {!collapsedVolumes.has(vol.name) && vol.chapters.map((ch) => (
                    <button
                      key={ch.id}
                      onClick={() => setSelectedChapterId(ch.id === selectedChapterId ? null : ch.id)}
                      className={`flex items-center gap-2 w-full px-4 py-2 text-left border-b border-[var(--border-subtle)] transition cursor-pointer ${
                        ch.id === selectedChapterId
                          ? "bg-[#C9A96210] border-l-2 border-l-[var(--gold-primary)]"
                          : "hover:bg-[#FFFFFF03]"
                      }`}
                    >
                      <span className={`text-[11px] flex-1 truncate ${
                        ch.id === selectedChapterId ? "text-[var(--gold-primary)] font-medium" : "text-[var(--text-primary)]"
                      }`}>
                        {ch.title}
                      </span>
                      <span className="text-[9px] text-[var(--text-muted)] shrink-0">
                        {ch.wordCount.toLocaleString()} 字
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Script Viewer */}
        {activeScript ? (
          <div className="flex flex-col flex-1 h-full min-w-0">
            <div className="flex flex-wrap items-center gap-y-2 px-6 py-3 border-b border-[var(--border-default)]">
              <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
                <span className="font-serif text-[18px] font-bold text-[var(--text-primary)] truncate">
                  {activeScript.title}
                </span>
                <span className="px-2 py-0.5 text-[10px] text-[var(--gold-primary)] bg-[var(--gold-transparent)] border border-[var(--border-gold)] shrink-0">
                  {activeScript.status}
                </span>
                {selectedChapterId && parsedStructure && (() => {
                  const ch = parsedStructure.chapters.find((c) => c.id === selectedChapterId);
                  if (!ch) return null;
                  return (
                    <span className="px-2 py-0.5 text-[10px] text-[var(--text-secondary)] bg-[var(--bg-surface)] border border-[var(--border-default)] shrink-0 truncate max-w-[160px]">
                      📖 {ch.title}
                    </span>
                  );
                })()}
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-1 px-2.5 py-1.5 border border-[var(--border-default)] text-[11px] text-[var(--text-secondary)] hover:border-[#ef4444] hover:text-[#ef4444] transition cursor-pointer"
                >
                  <Trash2 size={11} />
                  删除
                </button>
                <button
                  onClick={handleImport}
                  className="flex items-center gap-1 px-2.5 py-1.5 border border-[var(--border-default)] text-[11px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] transition cursor-pointer"
                >
                  <Upload size={11} />
                  导入剧本
                </button>
                {editing ? (
                  <>
                    <button
                      onClick={() => setEditing(false)}
                      className="flex items-center gap-1 px-2.5 py-1.5 border border-[var(--border-default)] text-[11px] text-[var(--text-secondary)] hover:border-[var(--gold-primary)] transition cursor-pointer"
                    >
                      <X size={11} />
                      取消
                    </button>
                    <button
                      onClick={handleSave}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-[var(--gold-primary)] text-[11px] text-[#0A0A0A] font-medium hover:brightness-110 transition cursor-pointer"
                    >
                      <Save size={11} />
                      保存
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleEdit}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-[var(--gold-primary)] text-[11px] text-[#0A0A0A] font-medium hover:brightness-110 transition cursor-pointer"
                  >
                    <Edit3 size={11} />
                    编辑
                  </button>
                )}
                <button
                  onClick={() => {
                    if (activeScript) {
                      localStorage.setItem("feicai-pipeline-script-id", activeScript.id);
                      if (selectedChapterId && parsedStructure) {
                        const ch = parsedStructure.chapters.find((c) => c.id === selectedChapterId);
                        if (ch) {
                          localStorage.setItem("feicai-pipeline-script-chapter", JSON.stringify({
                            title: ch.fullTitle || ch.title,
                            content: ch.content,
                          }));
                        }
                      } else {
                        localStorage.removeItem("feicai-pipeline-script-chapter");
                      }
                    }
                    router.push("/pipeline");
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 bg-[var(--gold-primary)] text-[11px] text-[#0A0A0A] font-medium hover:brightness-110 transition cursor-pointer"
                >
                  <Play size={11} />
                  开始节拍拆解分镜
                </button>
                <button
                  onClick={() => {
                    // 保存当前剧本/章节到 localStorage 供智能分镜页面使用
                    if (activeScript) {
                      localStorage.setItem("feicai-pipeline-script-id", activeScript.id);
                      if (selectedChapterId && parsedStructure) {
                        const ch = parsedStructure.chapters.find((c) => c.id === selectedChapterId);
                        if (ch) {
                          localStorage.setItem("feicai-pipeline-script-chapter", JSON.stringify({
                            title: ch.fullTitle || ch.title,
                            content: ch.content,
                          }));
                        }
                      } else {
                        localStorage.removeItem("feicai-pipeline-script-chapter");
                      }
                    }
                    // 标记打开智能分镜标签页
                    localStorage.setItem("feicai-pipeline-tab", "smartStoryboard");
                    router.push("/pipeline");
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 bg-[var(--gold-primary)] text-[11px] text-[#0A0A0A] font-medium hover:brightness-110 transition cursor-pointer"
                >
                  <Wand2 size={11} />
                  开始智能分析分镜
                </button>
                {/* AI 分析章节按钮 — 仅在未检测到章节时显示 */}
                {!editing && !parsedStructure && activeScript && activeScript.content.length > 200 && (
                  <button
                    onClick={handleAnalyzeChapters}
                    disabled={chapterAnalyzing}
                    className="flex items-center gap-1 px-2.5 py-1.5 border border-cyan-500/60 text-[11px] text-cyan-400 hover:bg-cyan-500/10 transition cursor-pointer disabled:opacity-50"
                  >
                    {chapterAnalyzing ? <Loader size={11} className="animate-spin" /> : <BookOpen size={11} />}
                    {chapterAnalyzing ? "识别中..." : "分析章节"}
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-auto px-6 py-6">
              {editing && (
                <div className="flex flex-col gap-3 mb-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-medium text-[var(--text-muted)]">剧本名称</label>
                    <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)}
                      className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[16px] font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)] transition"
                      placeholder="输入剧本名称..." />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] font-medium text-[var(--text-muted)]">剧本描述</label>
                    <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
                      className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[13px] text-[var(--text-secondary)] outline-none focus:border-[var(--gold-primary)] transition"
                      placeholder="简要描述..." />
                  </div>
                </div>
              )}
              {!editing && (
                <div className="flex gap-6 w-full mb-6">
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="text-[var(--text-muted)]" />
                    <span className="text-[12px] text-[var(--text-secondary)]">
                      {displayContent.replace(/\s/g, "").length.toLocaleString()} 字
                    </span>
                  </div>
                  {parsedStructure && (
                    <div className="flex items-center gap-2">
                      <BookOpen size={14} className="text-[var(--text-muted)]" />
                      <span className="text-[12px] text-[var(--text-secondary)]">
                        共 {parsedStructure.chapters.length} 章{selectedChapterId ? " · 已选单章" : " · 全文预览"}
                      </span>
                    </div>
                  )}
                  {!parsedStructure && (
                    <>
                      <div className="flex items-center gap-2">
                        <Film size={14} className="text-[var(--text-muted)]" />
                        <span className="text-[12px] text-[var(--text-secondary)]">
                          目标：电影
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MapPin size={14} className="text-[var(--text-muted)]" />
                        <span className="text-[12px] text-[var(--text-secondary)]">
                          风格：真人写实
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )}
              {editing ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full h-full min-h-[600px] bg-[var(--bg-surface)] border border-[var(--border-default)] p-6 text-[14px] leading-relaxed text-[var(--text-primary)] font-mono outline-none focus:border-[var(--gold-primary)] transition resize-none"
                  placeholder="在此编辑剧本内容..."
                />
              ) : (
                <div className="flex flex-col break-words overflow-hidden"
                  dangerouslySetInnerHTML={{ __html: renderedContentHtml }}
                />
              )}

              {/* ── AI Analysis Result Panel ── */}
              {analysisResult && !editing && (
                <div className="flex flex-col gap-4 mt-8 pt-6 border-t border-[var(--border-default)]">
                  <div className="flex items-center gap-3">
                    <Grid3X3 size={18} className="text-[var(--gold-primary)]" />
                    <span className="text-[16px] font-semibold text-[var(--text-primary)]">
                      智能分镜分析
                    </span>
                    <span className="px-2.5 py-1 text-[12px] text-[var(--gold-primary)] bg-[var(--gold-transparent)] border border-[var(--border-gold)] font-medium">
                      建议 {analysisResult.totalNineGrids} 集 · 每集1张九宫格
                    </span>
                    <span className="px-2 py-0.5 text-[10px] text-[var(--text-muted)] border border-[var(--border-default)]">
                      4分钟/章 · 3秒/格 · 27秒/九宫格
                    </span>
                  </div>

                  <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                    {analysisResult.reasoning}
                  </p>

                  <div className="flex flex-col gap-4">
                    {analysisResult.plan?.map((item) => (
                      <div key={item.gridIndex}
                        className="flex flex-col gap-3 p-5 bg-[var(--bg-surface)] border border-[var(--border-default)]">
                        <div className="flex items-center gap-3">
                          <span className="flex items-center justify-center w-7 h-7 bg-[var(--gold-primary)] text-[#0A0A0A] text-[12px] font-bold">
                            {item.gridIndex}
                          </span>
                          <span className="text-[14px] font-semibold text-[var(--text-primary)]">
                            {item.episodeId ? `${item.episodeId.toUpperCase()} · ` : ""}{item.title}
                          </span>
                          <span className="px-2 py-0.5 text-[10px] text-[var(--gold-primary)] border border-[var(--border-gold)]">
                            9格关键帧
                          </span>
                        </div>
                        <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                          {item.description}
                        </p>
                        {item.beats && item.beats.length > 0 && (
                          <div className="grid grid-cols-3 gap-2 mt-1">
                            {item.beats.map((beat, bi) => (
                              <div key={bi} className="flex gap-2 p-2 bg-[#0a0a0a] border border-[var(--border-default)]">
                                <span className="text-[10px] font-bold text-[var(--gold-primary)] shrink-0">格{bi + 1}</span>
                                <span className="text-[10px] text-[var(--text-secondary)] leading-relaxed">{beat.replace(/^格\d+[：:]\s*/, "")}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {item.scenes?.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {item.scenes.map((s, i) => (
                              <span key={i} className="px-2 py-0.5 text-[10px] text-[var(--text-muted)] bg-[#1a1a1a] border border-[var(--border-default)]">
                                {s}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center flex-1 text-[var(--text-muted)]">
            选择或创建剧本
          </div>
        )}
      </div>
    </div>
  );
}
