import fs from "fs";
import path from "path";
import { getBaseOutputDir, ensureDir } from "../../lib/paths";
import { getAIClientForRole, generateStrictJson } from "./outlineGenerator";

// ── Interfaces ──

export interface MemoryEntry {
    id: string;
    chapterTitle: string;
    content: string; // The memory content (fact/summary)
    tags: string[]; // Keywords for retrieval
    type: "plot" | "character" | "setting" | "item" | "hook"; // Added hook
    createdAt: number;
    status?: "open" | "closed"; // For hooks
}

export interface MemoryStore {
    projectId: string;
    memories: MemoryEntry[];
    lastUpdated: number;
}

// ── Memory Store Management ──

function getMemoryFilePath(projectId: string): string {
    const projectDir = path.join(getBaseOutputDir(), "novel-projects", projectId);
    ensureDir(projectDir);
    return path.join(projectDir, "memory.json");
}

function loadMemoryStore(projectId: string): MemoryStore {
    const fp = getMemoryFilePath(projectId);
    if (fs.existsSync(fp)) {
        try {
            return JSON.parse(fs.readFileSync(fp, "utf-8"));
        } catch (e) {
            console.error("Failed to load memory store", e);
        }
    }
    return { projectId, memories: [], lastUpdated: Date.now() };
}

function saveMemoryStore(store: MemoryStore) {
    const fp = getMemoryFilePath(store.projectId);
    fs.writeFileSync(fp, JSON.stringify(store, null, 2), "utf-8");
}

// ── AI Operations ──

export async function extractMemoryFromChapter(projectId: string, chapterTitle: string, content: string): Promise<MemoryEntry[]> {
    const client = await getAIClientForRole("analyst");
    
    let prompt = `你是一个专业的网文设定整理助手。请仔细阅读以下章节内容，提取出关键的【剧情事实】、【新登场人物】、【新设定】或【伏笔】。
    
【提取要求】
1. **剧情事实**：本章发生了什么关键事件？（例如：主角获得了xx宝物，主角与xx结仇）
2. **人物/设定**：如果有新人物登场，简要描述其特征。如果有新物品/功法，简要描述其功能。
3. **伏笔**：是否有未解的悬念？
4. **去重**：不要提取琐碎的对话或无关紧要的动作。只提取对后续剧情有影响的信息。
5. **格式**：请输出 JSON 数组，每条记忆包含 content (内容), tags (关键词列表), type (类型: plot/character/setting/item/hook), status (如果是 hook, 则为 open/closed)。

【章节内容】
标题：${chapterTitle}
正文：
${content.slice(0, 3000)} ${content.length > 3000 ? "..." : ""}

【输出 JSON 示例】
\`\`\`json
[
  {
    "content": "叶云在破庙中获得了断剑'霜寒'，剑身刻有古老符文，似乎与上古剑宗有关。",
    "tags": ["叶云", "断剑", "霜寒", "上古剑宗", "宝物"],
    "type": "item"
  },
  {
    "content": "埋下伏笔：主角在雨中捡到的铜钱其实是开启禁地的钥匙。",
    "tags": ["铜钱", "禁地", "钥匙"],
    "type": "hook",
    "status": "open"
  }
]
\`\`\`
`;

    try {
        const strict = await generateStrictJson<any[]>({
            client,
            prompt,
            validate: (x): x is any[] => Array.isArray(x),
            maxAttempts: 3,
            backoffBaseMs: 800,
            correctionHint: "请只输出 JSON 数组，每项包含 content, tags, type 字段。",
        });

        if (!strict.ok) return [];
        const extracted = strict.data;
        
        const newMemories: MemoryEntry[] = extracted.map((item: any) => ({
            id: Math.random().toString(36).substring(2, 15),
            chapterTitle,
            content: item.content,
            tags: item.tags || [],
            type: item.type || "plot",
            status: item.status,
            createdAt: Date.now()
        }));

        // Save to store
        const store = loadMemoryStore(projectId);
        // Optional: Deduplicate based on content similarity (simple exact match for now)
        // In a real RAG, we would use embeddings.
        store.memories.push(...newMemories);
        store.lastUpdated = Date.now();
        saveMemoryStore(store);

        return newMemories;
    } catch (error) {
        console.error("Memory Extraction Error:", error);
        return [];
    }
}

export async function searchMemory(projectId: string, query: string): Promise<MemoryEntry[]> {
    const store = loadMemoryStore(projectId);
    if (store.memories.length === 0) return [];

    // Simple Keyword Match (Client-side RAG simulation)
    // In the future, we can upgrade this to Embedding Similarity using a local library or API.
    
    // 1. Tokenize query
    const keywords = query.split(/[\s,，。;；]+/).filter(k => k.length > 1);
    if (keywords.length === 0) return [];

    // 2. Score memories
    const scored = store.memories.map(mem => {
        let score = 0;
        const text = (mem.content + " " + mem.tags.join(" ")).toLowerCase();
        
        keywords.forEach(k => {
            if (text.includes(k.toLowerCase())) score += 1;
        });

        return { ...mem, score };
    });

    // 3. Filter and Sort
    return scored
        .filter(m => m.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10); // Top 10 matches
}

export async function generateRelevantContext(projectId: string, currentChapterTitle: string, plotPoints: string[]): Promise<string> {
    // 1. Construct a query from plot points
    const query = currentChapterTitle + " " + plotPoints.join(" ");
    
    // 2. Search
    const memories = await searchMemory(projectId, query);
    
    if (memories.length === 0) return "";

    // 3. Format as string
    return memories.map(m => `- [${m.type}] ${m.content} (源自: ${m.chapterTitle})`).join("\n");
}
