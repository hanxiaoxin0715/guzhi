import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { getBaseOutputDir } from "../paths";
import { StoryHook, StoryMemory } from "../novelProjects";

// ── Server-Side Config Loader ──

function loadConfig(key: string): string | null {
    try {
        const safeKey = key.replace(/[^a-zA-Z0-9_\-]/g, "_");
        const workspaceDir = path.join(getBaseOutputDir(), "workspace");
        const fp = path.join(workspaceDir, `${safeKey}.json`);
        
        if (fs.existsSync(fp)) {
            const content = fs.readFileSync(fp, "utf-8").trim();
            return content;
        }
    } catch (e) {
        console.warn(`[Config] Failed to load ${key}:`, e);
    }
    return null;
}

function parseWorkspaceScalar(raw: string | null): string {
    const text = (raw || "").trim();
    if (!text) return "";
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && typeof parsed.content === "string") return parsed.content;
        if (typeof parsed === "string") return parsed;
        return text;
    } catch {
        return text;
    }
}

function loadCustomPrompt(key: string): string | null {
    try {
        const fp = path.join(getBaseOutputDir(), "workspace", "ai_prompts.json");
        if (fs.existsSync(fp)) {
            const content = fs.readFileSync(fp, "utf-8");
            const prompts = JSON.parse(content);
            if (prompts[key] && typeof prompts[key] === "string" && prompts[key].trim().length > 0) {
                return prompts[key];
            }
        }
    } catch (e) {
        // ignore
    }
    return null;
}

export function getNovelStyleConstraints(): string {
    const stylePrompt = loadConfig("NOVEL_PROFESSIONAL_STYLE_PROMPT") || "";
    const avoidPrompt = loadConfig("NOVEL_AVOID_WORDS") || "";
    const parts: string[] = [];
    if (stylePrompt.trim()) parts.push(`【全局文风要求】\n${stylePrompt.trim()}`);
    
    // 整合 AI 痕迹消除处理规则
    const aiCleanRules = [
        "【强制去AI化与痕迹消除要求】",
        "1. 【违禁词扫雷】：严禁出现以下词汇/句式：",
        "   - 异常感官：血腥味、铁锈味、金属的甜腥味、周遭的空气仿佛凝固了、令人疯狂的窒息感、呼吸如破风箱。",
        "   - 模板动作：瞳孔骤缩、倒吸一口凉气、嘴角勾起了一抹弧度、修长的手指、深邃的眼眸、眉头微蹙、呢喃、叹息声空气中回荡。",
        "   - 抽象形容：宛如实质的杀气、恐怖如斯、不可名状。",
        "2. 【句式与结构】：",
        "   - 强行切除段落开头常见的“然而、因此、随着、总之”等过渡词。",
        "   - 严禁在章节末尾进行任何形式的情感总结、升华或说教。",
        "   - 避免模板化连接词：顿时、刹那间、下一刻、就在这时、与此同时。",
        "3. 【对话与描写平衡】：",
        "   - 去除长篇大论，确保对话短促、市井、带有强烈的目的性（试探、交易或挑衅）。",
        "   - 每一页（约300-500字）中，直接对话不宜超过三组。",
        "   - 优先原则：能用动作、环境、心理活动传达的信息，严禁使用直接对话。用描写来稀释对话密度。",
        "4. 【叙事调整】：句式要有长短变化，增加文学性，避免“剧本化”倾向（即大量对话交替而缺少环境描写）。"
    ].join("\n");

    parts.push(aiCleanRules);

    if (avoidPrompt.trim()) parts.push(`【用户自定义禁用词】\n${avoidPrompt.trim()}`);
    
    return parts.join("\n\n");
}

// ── AI Client Helper ──

interface AIClient {
    generateContent(prompt: string): Promise<string>;
}

function isMockLLMEnabled(): boolean {
    const v = (loadConfig("MOCK_LLM") || process.env.FEICAI_MOCK_LLM || "").trim().toLowerCase();
    const mode = (loadConfig("MOCK_LLM_MODE") || "").trim().toLowerCase();
    const allow = (process.env.FEICAI_ALLOW_MOCK_LLM || "").trim().toLowerCase();
    const enabled = v === "1" || v === "true" || v === "yes" || v === "on";
    if (!enabled) return false;
    if (allow === "true" || allow === "1" || allow === "yes" || allow === "on") return true;
    return mode === "test";
}

function extractJsonPayload(text: string): string | null {
    const t = (text || "").trim();
    const code = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (code) return code[1].trim();
    if (t.startsWith("```") && t.indexOf("```", 3) === -1) {
        const rest = t.replace(/^```(?:json)?/i, "").trim();
        const firstObj = rest.indexOf("{");
        const lastObj = rest.lastIndexOf("}");
        const firstArr = rest.indexOf("[");
        const lastArr = rest.lastIndexOf("]");
        const objOk = firstObj >= 0 && lastObj > firstObj;
        const arrOk = firstArr >= 0 && lastArr > firstArr;
        if (arrOk && (!objOk || firstArr < firstObj)) return rest.slice(firstArr, lastArr + 1).trim();
        if (objOk) return rest.slice(firstObj, lastObj + 1).trim();
        return rest;
    }
    const firstObj = t.indexOf("{");
    const lastObj = t.lastIndexOf("}");
    const firstArr = t.indexOf("[");
    const lastArr = t.lastIndexOf("]");
    const objOk = firstObj >= 0 && lastObj > firstObj;
    const arrOk = firstArr >= 0 && lastArr > firstArr;
    if (arrOk && (!objOk || firstArr < firstObj)) return t.slice(firstArr, lastArr + 1).trim();
    if (objOk) return t.slice(firstObj, lastObj + 1).trim();
    return null;
}

export function parseJsonLenient<T>(text: string): T {
    const payload = extractJsonPayload(text) || (text || "").trim();

    const strip = (s: string) =>
        (s || "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/(^|[^:])\/\/.*$/gm, "$1")
            .replace(/,(\s*[\]}])/g, "$1")
            .trim();

    const normalizeQuotes = (s: string) =>
        (s || "")
            .replace(/[“”]/g, "\"")
            .replace(/[‘’]/g, "'");

    const quoteUnquotedKeys = (s: string) =>
        (s || "").replace(/([{\s,])([A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\u4e00-\u9fa5-]*)(\s*:)/g, (m, p1, p2, p3) => {
            if (p2 === "true" || p2 === "false" || p2 === "null") return `${p1}${p2}${p3}`;
            return `${p1}"${p2}"${p3}`;
        });

    const singleToDoubleForJson = (s: string) => {
        let out = s || "";
        out = out.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'\s*:/g, (_m, g1) => `"${g1}":`);
        out = out.replace(/:\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, g1) => `:"${g1}"`);
        return out;
    };

    /**
     * 自动闭合截断的 JSON 字符串
     */
    const fixTruncatedJson = (s: string): string => {
        let fixed = s.trim();
        if (!fixed) return fixed;

        // 如果最后是一个开放的字符串引号，先闭合它
        const lastQuoteIndex = fixed.lastIndexOf('"');
        const lastBackslashIndex = fixed.lastIndexOf('\\');
        
        // 统计引号数量，判断是否在字符串内
        let quoteCount = 0;
        let inString = false;
        for (let i = 0; i < fixed.length; i++) {
            if (fixed[i] === '"' && (i === 0 || fixed[i-1] !== '\\')) {
                inString = !inString;
                quoteCount++;
            }
        }
        
        if (inString) {
            fixed += '"';
        }

        // 统计括号数量
        const stack: string[] = [];
        for (let i = 0; i < fixed.length; i++) {
            const char = fixed[i];
            const prevChar = i > 0 ? fixed[i-1] : '';
            
            // 跳过字符串内部的内容
            if (char === '"' && prevChar !== '\\') {
                let j = i + 1;
                while (j < fixed.length && (fixed[j] !== '"' || fixed[j-1] === '\\')) {
                    j++;
                }
                i = j;
                continue;
            }

            if (char === '{' || char === '[') {
                stack.push(char);
            } else if (char === '}') {
                if (stack.length > 0 && stack[stack.length - 1] === '{') {
                    stack.pop();
                }
            } else if (char === ']') {
                if (stack.length > 0 && stack[stack.length - 1] === '[') {
                    stack.pop();
                }
            }
        }

        // 按相反顺序闭合所有未闭合的括号
        while (stack.length > 0) {
            const open = stack.pop();
            if (open === '{') fixed += '}';
            else if (open === '[') fixed += ']';
        }

        return fixed;
    };

    const attempts: string[] = [];
    const base = strip(payload);
    attempts.push(base);
    attempts.push(strip(normalizeQuotes(payload)));
    attempts.push(strip(quoteUnquotedKeys(normalizeQuotes(payload))));
    attempts.push(strip(quoteUnquotedKeys(singleToDoubleForJson(normalizeQuotes(payload)))));
    
    // 增加自动闭合尝试
    attempts.push(fixTruncatedJson(base));
    attempts.push(fixTruncatedJson(strip(normalizeQuotes(payload))));
    attempts.push(fixTruncatedJson(strip(quoteUnquotedKeys(normalizeQuotes(payload)))));

    let lastErr: any = null;
    for (const candidate of attempts) {
        try {
            return JSON.parse(candidate) as T;
        } catch (e: any) {
            lastErr = e;
        }
    }
    throw lastErr || new Error("invalid json");
}

type StrictJsonResult<T> =
    | { ok: true; data: T; text: string; attempts: number }
    | { ok: false; text: string; attempts: number; error: string };

function toErrorString(e: any): string {
    if (!e) return "Unknown error";
    if (e instanceof Error) return e.message || e.name;
    return String(e);
}

export async function generateStrictJson<T>(args: {
    client: AIClient;
    prompt: string;
    validate: (x: any) => x is T;
    maxAttempts?: number;
    backoffBaseMs?: number;
    correctionHint?: string;
}): Promise<StrictJsonResult<T>> {
    const maxAttempts = typeof args.maxAttempts === "number" && args.maxAttempts > 0 ? Math.floor(args.maxAttempts) : 3;
    const backoffBaseMs = typeof args.backoffBaseMs === "number" && args.backoffBaseMs >= 0 ? args.backoffBaseMs : 600;
    const hint =
        (args.correctionHint || "").trim() ||
        "你上一次输出不是严格 JSON 或字段缺失。请只输出 JSON，不要任何解释文字，不要 Markdown 代码块标记。";

    let prompt = args.prompt;
    let lastText = "";
    let lastErr = "";

    for (let i = 0; i < maxAttempts; i++) {
        let text = "";
        try {
            text = await args.client.generateContent(prompt);
            lastText = text || "";
        } catch (e: any) {
            lastErr = toErrorString(e);
            if (i + 1 >= maxAttempts) return { ok: false, text: lastText, attempts: i + 1, error: lastErr };
            await new Promise((r) => setTimeout(r, backoffBaseMs * (i + 1)));
            continue;
        }

        try {
            const parsed = parseJsonLenient<any>(text);
            if (args.validate(parsed)) return { ok: true, data: parsed, text: lastText, attempts: i + 1 };
            lastErr = "invalid shape";
        } catch (e: any) {
            lastErr = toErrorString(e);
        }

        if (i + 1 >= maxAttempts) break;

        const bad = (lastText || "").trim().slice(0, 1200);
        prompt =
            args.prompt +
            `\n\n【系统纠错】${hint}\n` +
            (bad ? `【你上一次输出（节选）】\n${bad}\n` : "") +
            `\n请重新输出：\n`;
        await new Promise((r) => setTimeout(r, backoffBaseMs * (i + 1)));
    }

    return { ok: false, text: lastText, attempts: maxAttempts, error: lastErr || "invalid json" };
}

function safeOrigin(url: string): string {
    const u = (url || "").trim();
    if (!u) return "（未配置 BaseURL）";
    try {
        return new URL(u).origin;
    } catch {
        return u;
    }
}

function formatLLMError(args: { provider: string; baseURL?: string; model?: string; err: any }): Error {
    const msg = (args.err?.message || "Unknown error").toString();
    const origin = args.baseURL ? safeOrigin(args.baseURL) : "";
    const model = args.model ? `, model=${args.model}` : "";
    const prefix = `[${args.provider}${model}${origin ? `, base=${origin}` : ""}]`;

    const lower = msg.toLowerCase();
    const code = (args.err?.code || args.err?.cause?.code || "").toString();

    if (lower.includes("connection error") || lower.includes("fetch failed") || code) {
        const hint =
            args.provider === "Gemini"
                ? "可能是网络不可达/被拦截；建议在“系统设置→API 连接配置”配置可访问的 BaseURL（代理）或更换可用模型服务。"
                : "请检查 BaseURL 是否可访问、网络/代理是否正常、以及服务端是否支持 OpenAI 兼容接口。";
        return new Error(`${prefix} Connection error. ${hint}${code ? ` (code=${code})` : ""}`);
    }

    if (typeof args.err?.status === "number") {
        return new Error(`${prefix} HTTP ${args.err.status}: ${msg}`);
    }

    return new Error(`${prefix} ${msg}`);
}

class MockAIClient implements AIClient {
    async generateContent(prompt: string): Promise<string> {
        const p = prompt || "";

        if (p.includes("真相文件更新器") && p.includes("\"ledger\"") && p.includes("\"hooks\"")) {
            const titleMatch = p.match(/标题：([^\n\r]+)/);
            const title = titleMatch ? titleMatch[1].trim() : "未命名章节";
            const patch = {
                chapterSummary: [`${title}：本章关键事件已推进`, "角色关系发生变化", "埋下新的伏笔"],
                currentState: ["主角位置与目标明确", "关键道具已记录入账本"],
                ledger: [{ item: "灵石", delta: -10, note: "购买情报" }],
                hooks: [{ hook: "幕后黑手身份", status: "open", note: "线索仍不足" }],
                interactions: [{ a: "主角", b: "配角", relation: "达成交易", boundary: "配角不知道主角真实身份" }],
                emotionalArcs: [{ character: "主角", emotion: "克制转为决绝", trigger: "得知背叛" }],
                subplots: [{ subplot: "关键道具来历", status: "推进", risk: "线索过少" }],
            };
            return JSON.stringify(patch);
        }

        if (p.includes("提取所有出现的角色信息") && p.includes("JSON 结构如下") && p.includes("\"name\"")) {
            const out = [
                { name: "叶云", role: "主角", gender: "男", age: "18", personality: "冷静、果决", background: "出身平凡，被卷入阴谋" },
                { name: "韩长老", role: "配角", gender: "男", age: "中年", personality: "严厉、多疑", background: "宗门执事，掌握部分秘密" },
            ];
            return JSON.stringify(out);
        }

        if (p.includes("金牌编辑") && p.includes("网文市场规律") && p.includes("\"title\"") && p.includes("\"tags\"") && p.includes("\"description\"")) {
            const out = {
                title: "刚成首富，你告诉我这是规则怪谈？",
                tags: ["规则怪谈", "都市异能", "反套路"],
                description:
                    "主角刚靠投资翻身成了首富，却在一次慈善晚宴上收到一张“规则清单”：从此每晚十二点后，城市会变成遵循诡异规则的猎场。只要违反一条规则，财富会化为灰烬，身边的人也会被抹除。主角唯一的外挂，是能用“金钱”兑换一次规则豁免，但代价越来越高。他必须在财富与人性之间做选择，找出规则背后的制定者，撕开这座城市的真相。",
            };
            return JSON.stringify(out);
        }

        if (p.includes("连续性审计员") && p.includes("\"pass\"") && p.includes("\"issues\"")) {
            return JSON.stringify({ pass: true, issues: [] });
        }

        if (p.includes("网文设定整理助手") && p.includes("输出 JSON 数组")) {
            const out = [
                { content: "主角本章获得了一件关键物品，并付出代价。", tags: ["主角", "物品", "代价"], type: "item" },
                { content: "一个新的势力被提及，埋下后续冲突。", tags: ["势力", "冲突"], type: "plot" },
            ];
            return JSON.stringify(out);
        }

        if ((p.includes("结尾钩子") || p.includes("Hook")) && p.includes("\"hookScore\"") && p.includes("\"coolPointScore\"")) {
            return JSON.stringify({
                hookScore: 80,
                coolPointScore: 70,
                hookType: "期待感悬念",
                coolPointType: "震惊路人",
                analysis: "结尾抛出新的威胁并保持悬念。",
                suggestion: "将爽点前置一小段以强化情绪释放。",
            });
        }

        if (p.includes("输出要求") && p.includes("\"score\"") && p.includes("\"suggestions\"")) {
            return JSON.stringify({
                score: 85,
                plotAnalysis: "剧情推进明确，冲突点清晰。",
                pacingAnalysis: "节奏较紧，结尾有悬念。",
                characterAnalysis: "人设一致，动机合理。",
                suggestions: ["强化一处因果链解释", "减少高频词重复"],
            });
        }

        if (p.includes("严格 JSON") && p.includes("\"outline\"")) {
            return JSON.stringify({
                outline: [
                    {
                        title: "第一卷：起势",
                        chapters: [
                            {
                                title: "第1章 夜雨起刀",
                                summary: "主角遭遇危机，触发转机。",
                                detail: {
                                    sceneList: [
                                        { title: "雨巷逼近", summary: "夜雨中，主角被尾随者逼近，气息压迫。", location: "雨巷", goal: "摆脱跟踪", conflict: "尾随者步步紧逼", outcome: "主角发现线索" },
                                        { title: "交易开价", summary: "主角以代价换取情报，关系边界被试探。", location: "黑市角落", goal: "拿到情报", conflict: "对方坐地起价", outcome: "情报到手但埋伏笔" },
                                        { title: "门后影子", summary: "回到落脚处，门后有人无声等候，悬念拉起。", location: "客栈", goal: "确认安全", conflict: "未知威胁", outcome: "结尾抛悬念" },
                                    ],
                                },
                            },
                            {
                                title: "第2章 代价与交易",
                                summary: "主角付出代价换取线索，埋下伏笔。",
                                detail: {
                                    sceneList: [
                                        { title: "代价兑现", summary: "主角兑现承诺，付出代价，情绪走向更决绝。", location: "偏殿", goal: "换取承诺", conflict: "对方反悔", outcome: "冲突升级" },
                                        { title: "线索指向", summary: "线索指向更大的势力，主角意识到局更深。", location: "街市", goal: "确认线索", conflict: "被盯上", outcome: "引出主线" },
                                        { title: "暗线触发", summary: "一个旧人出现，揭开过往的一角。", location: "桥下", goal: "求证身份", conflict: "真假难辨", outcome: "埋新钩子" },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            });
        }

        if (p.includes("只撰写当前章节的一个【场景】") && p.includes("正文开始")) {
            const base = [
                "雨线斜斜压下来，巷口的灯火像被人捏住了喉咙，忽明忽暗。",
                "他把脚步放轻，鞋底踩过积水，溅起的冷意顺着裤脚往上爬。",
                "身后那点呼吸很稳，像刀背贴着脊梁，逼得人不敢回头。",
                "他抬手摸到袖中硬物，指腹一紧，心跳却故意慢了半拍。",
                "一声轻笑从雨里飘来，下一刻，影子贴上墙面，堵住了退路。",
                "他说话时没抬眼，声音却像钉子一样钉进对方耳朵里：\"想要我停下，你得先告诉我，你是谁。\"",
                "雨声更密了，像有人在屋顶上撒盐。",
            ].join("\n\n");
            return (base + "\n\n" + base).slice(0, 2200);
        }

        if (p.includes("修订者") && p.includes("【草稿正文】")) {
            const idx = p.indexOf("【草稿正文】");
            const draft = idx >= 0 ? p.slice(idx).replace(/^【草稿正文】\s*/, "").trim() : "";
            return draft || "（修订结果为空）";
        }

        if (p.includes("正文开始")) {
            const pointsMatch = p.match(/【本章剧情细纲[\s\S]*?\n([\s\S]*?)\n\n【写作要求|【极重要：去 AI 化写作规范】/);
            const points = pointsMatch ? pointsMatch[1].split("\n").map((x) => x.replace(/^\s*\d+\.\s*/, "").trim()).filter(Boolean) : [];
            const base = [
                "雨声贴着瓦檐滚下，冷得像刀。",
                "他抬手摸了摸袖中的东西，指腹一紧，心跳也跟着乱了节拍。",
                "街角灯火明灭，来人脚步很轻，却把整条巷子的呼吸都压住。",
            ].join("\n\n");
            const body = (points.length ? points : ["剧情推进", "冲突升级", "留下悬念"])
                .map((pt, i) => `${i + 1}）${pt}。\n\n他把话咽回去，换成一步踏前。风里有腥味，像是预告。`)
                .join("\n\n");
            const tail = [
                "他没有回头。",
                "因为他知道，回头就会把软弱留给黑暗。",
                "下一次见面，必须有人倒下。",
            ].join("\n\n");
            return [base, body, tail].join("\n\n").repeat(3).slice(0, 3000);
        }

        if (p.includes("你是一位专业的影视编剧") && p.includes("剧本 JSON 开始")) {
            const out = {
                scenes: [
                    {
                        sceneNumber: 1,
                        description: "夜雨巷口，霓虹在水面碎成一片。主角停步回望，手指紧扣袖中硬物。",
                        dialogue: [
                            { role: "主角", content: "十枚灵石，买你一句真话。" },
                            { role: "情报贩子", content: "真话很贵，但你现在别无选择。" },
                        ],
                    },
                    {
                        sceneNumber: 2,
                        description: "镜头拉近：一张写着规则的纸被雨水打湿，字迹却越发清晰。",
                        dialogue: [{ role: "主角", content: "原来从今晚开始，城就不一样了。" }],
                    },
                ],
            };
            return JSON.stringify(out);
        }

        return "（Mock LLM 响应）";
    }
}

class GeminiClient implements AIClient {
    private model: any;
    private modelName: string;

    constructor(apiKey: string, modelName: string) {
        const genAI = new GoogleGenerativeAI(apiKey);
        
        // 增加安全等级设置，减少因敏感词导致的截断
        const safetySettings = [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        ];

        this.model = genAI.getGenerativeModel({ 
            model: modelName,
            safetySettings: safetySettings as any,
            generationConfig: {
                maxOutputTokens: 8192, // 大纲生成需要较多 token
                temperature: 0.7,
            }
        });
        this.modelName = modelName;
    }

    async generateContent(prompt: string): Promise<string> {
        const timeoutMs = 120_000; // 2分钟超时
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            // 注意：Google SDK 目前不直接支持 AbortSignal 在 generateContent 中
            // 我们使用 Promise.race 来实现超时控制
            const resultPromise = this.model.generateContent(prompt);
            const timeoutPromise = new Promise<never>((_, reject) => 
                setTimeout(() => reject(new Error(`Gemini request timeout after ${timeoutMs}ms`)), timeoutMs)
            );

            const result = await Promise.race([resultPromise, timeoutPromise]) as any;
            const response = await result.response;
            return response.text();
        } catch (err: any) {
            console.error("[Gemini Client Error]", err);
            throw formatLLMError({ provider: "Gemini", model: this.modelName, err });
        } finally {
            clearTimeout(timeoutId);
        }
    }
}

class OpenAIClient implements AIClient {
    private client: OpenAI;
    private modelName: string;
    private baseURL: string;
    private maxTokens: number;
    private temperature: number | undefined;

    constructor(apiKey: string, baseURL: string, modelName: string, opts?: { maxTokens?: number; temperature?: number }) {
        this.baseURL = baseURL;
        this.client = new OpenAI({
            apiKey: apiKey,
            baseURL: baseURL,
            timeout: 120_000, // 增加到 120 秒
            maxRetries: 2,
            dangerouslyAllowBrowser: true 
        });
        this.modelName = modelName;
        this.maxTokens = typeof opts?.maxTokens === "number" && opts.maxTokens > 0 ? Math.floor(opts.maxTokens) : 2048;
        this.temperature = typeof opts?.temperature === "number" ? opts.temperature : undefined;
    }

    async generateContent(prompt: string): Promise<string> {
        try {
            const m = this.modelName || "";
            const isO1Family = /^o[13]-/i.test(m) || /^o1/i.test(m);
            const baseReq: any = {
                messages: [{ role: "user", content: prompt }],
                model: this.modelName,
            };
            if (this.temperature !== undefined && !isO1Family) baseReq.temperature = this.temperature;
            if (isO1Family) baseReq.max_completion_tokens = this.maxTokens;
            else baseReq.max_tokens = this.maxTokens;

            const completion = await this.client.chat.completions.create(baseReq);
            return completion.choices[0].message.content || "";
        } catch (err: any) {
            console.error("[OpenAI Client Error]", err);
            if (err.status) console.error("HTTP Status:", err.status);
            if (err.error) console.error("Error Body:", JSON.stringify(err.error));
            throw formatLLMError({ provider: "OpenAI-Compatible", baseURL: this.baseURL, model: this.modelName, err });
        }
    }
}

export async function getAIClient(): Promise<AIClient> {
    return getAIClientForRole("writer");
}

export type AIClientRole = "writer" | "analyst";

function getRoleConfig(role: AIClientRole): { apiKey: string; baseURL: string; modelName: string } {
    if (role === "writer") {
        const apiKey = parseWorkspaceScalar(loadConfig("GEMINI_API_KEY")) || (process.env.GEMINI_API_KEY || "");
        const baseURL = parseWorkspaceScalar(loadConfig("GEMINI_BASE_URL")) || "";
        const modelName = parseWorkspaceScalar(loadConfig("GEMINI_MODEL")) || "gemini-2.0-flash";
        return { apiKey, baseURL, modelName };
    }
    const apiKey = parseWorkspaceScalar(loadConfig("ANALYST_API_KEY")) || parseWorkspaceScalar(loadConfig("GEMINI_API_KEY")) || (process.env.GEMINI_API_KEY || "");
    const baseURL = parseWorkspaceScalar(loadConfig("ANALYST_BASE_URL")) || parseWorkspaceScalar(loadConfig("GEMINI_BASE_URL")) || "";
    const modelName = parseWorkspaceScalar(loadConfig("ANALYST_MODEL")) || parseWorkspaceScalar(loadConfig("GEMINI_MODEL")) || "gemini-2.0-flash";
    return { apiKey, baseURL, modelName };
}

export async function getAIClientForRole(role: AIClientRole): Promise<AIClient> {
    if (isMockLLMEnabled()) return new MockAIClient();

    const { apiKey, baseURL, modelName } = getRoleConfig(role);
    if (!apiKey) {
        throw new Error(`Missing API Key for ${role}. Please configure it in Settings.`);
    }

    const isGoogleOfficialUrl = baseURL.includes("googleapis.com");
    const isThirdPartyProxy = baseURL && baseURL.trim().length > 0 && !isGoogleOfficialUrl;
    const isNonGeminiModel = !modelName.toLowerCase().includes("gemini");

    if (isThirdPartyProxy || isNonGeminiModel) {
        const isWriter = role === "writer";
        return new OpenAIClient(apiKey, baseURL || "https://api.openai.com/v1", modelName, {
            maxTokens: 8192, // 提高 token 限制
            temperature: isWriter ? 0.8 : 0.2,
        });
    }
    return new GeminiClient(apiKey, modelName);
}

// Ensure getChatClient is also exported properly
export async function getChatClient(): Promise<AIClient> {
    if (isMockLLMEnabled()) {
        return new MockAIClient();
    }
    const useSeparate = loadConfig("USE_SEPARATE_CHAT_CONFIG") === "true";
    
    if (!useSeparate) {
        return getAIClient();
    }

    const apiKey = loadConfig("CHAT_API_KEY") || "";
    const baseURL = loadConfig("CHAT_BASE_URL") || "";
    const modelName = loadConfig("CHAT_MODEL") || "gpt-4o";

    if (!apiKey) {
        throw new Error("Missing Chat API Key. Please configure it in Settings or disable separate chat config.");
    }

    if ((baseURL && baseURL.trim().length > 0) || !modelName.toLowerCase().includes("gemini")) {
        return new OpenAIClient(apiKey, baseURL || "https://api.openai.com/v1", modelName, { maxTokens: 4096 });
    }

    return new GeminiClient(apiKey, modelName);
}

// ── Interfaces ──

export interface OutlineRequest {
  title: string;
  tags: string[];
  description: string;
  totalChapters?: number;
  volumeCount?: number;
  chaptersPerVolume?: number;
  narrativeStructure?: "standard" | "hero_journey" | "fast_paced" | "mystery" | "tragedy" | "infinite_loop" | "multi_thread" | "flashback" | "episodic" | "counterattack";
  writingStyle?: "standard" | "literary" | "fast" | "humor" | "serious" | "ruthless" | "atmospheric" | "dialogue" | "realistic" | "brainhole" | "dark" | "sweet" | "tech" | "martial" | "live";
  globalPlan?: string;
}

export interface GlobalPlan {
    corePlot: string;
    characterSettings: any[];
    worldSettings: string;
    majorArcs: { title: string; goal: string; highPoint: string }[];
}

export interface GeneratedChapter {
  title: string;
  summary: string;
  content?: string;
  detail?: any;
}

export interface GeneratedVolume {
  title: string;
  chapters: GeneratedChapter[];
}

export interface GeneratedDetailedOutline {
  outline: GeneratedVolume[];
  [key: string]: any;
}

export interface GeneratedCharacterInfo {
  name: string;
  role?: string;
  gender?: string;
  age?: string;
  personality?: string;
  appearance?: string;
  background?: string;
  [key: string]: any;
}

export interface GeneratedChapterContent {
    content: string;
}

export interface VolumeGenerationRequest {
    title: string;
    tags: string[];
    description: string;
    volumeTitle: string;
    volumeGoal: string;
    volumeHighPoint: string;
    globalPlan: string;
    previousVolumeSummary?: string;
    totalChapters?: number;
}

// ── Generators ──

/**
 * 生成全局故事规划
 */
export async function extractStoryMemories(args: {
    title: string;
    content: string;
    existingMemories?: StoryMemory[];
}): Promise<{ memories: StoryMemory[]; hooks: StoryHook[] }> {
    const client = await getAIClientForRole("analyst");
    const prompt = `你是一位严谨的连续性审计员。请阅读以下小说片段，提取其中涉及的“关键事实”和“新埋下的伏笔”。

【当前章节】：${args.title}
【正文内容】：
${args.content.slice(0, 3000)}

【提取要求】
1. memories: 提取本章发生的关键事实（如：主角获得某物、某人死亡、发现某真相）。
2. hooks: 提取本章新埋下的伏笔（type="pre"）或回收的伏笔（type="post"）。

请严格输出 JSON：
{
  "memories": [{ "content": "...", "type": "plot|character|world", "tags": ["..."], "importance": 5 }],
  "hooks": [{ "type": "pre|post", "content": "...", "status": "open|closed" }]
}`;

    const strict = await generateStrictJson<{ memories: StoryMemory[]; hooks: StoryHook[] }>({
        client,
        prompt,
        validate: (x): x is any => !!x && Array.isArray(x.memories),
        maxAttempts: 2
    });

    if (!strict.ok) return { memories: [], hooks: [] };
    return strict.data;
}

/**
 * 生成全局故事规划
 */
export async function generateGlobalPlan(req: OutlineRequest): Promise<GlobalPlan> {
    const client = await getAIClientForRole("writer");
    
    // 获取叙事结构指导
    const narrativeStructurePrompt = getNarrativeStructurePrompt(req.narrativeStructure);
    const writingStylePrompt = getWritingStylePrompt(req.writingStyle);
    
    const prompt = `你是一位顶级文学策划，请为以下小说构思全局规划。
标题：${req.title}
题材：${req.tags.join("、")}
初始梗概：${req.description}

【叙事结构指导 - 必须遵循】
${narrativeStructurePrompt}

${writingStylePrompt ? `【写作风格要求】\n${writingStylePrompt}\n` : ""}

请输出以下内容的 JSON 格式：
1. corePlot: 核心剧情走向（约 300 字），必须遵循上述叙事结构。
2. characterSettings: 主要角色设定（姓名、性格、动机、最终结局）。
3. worldSettings: 世界观设定（地理、力量体系、核心冲突规则）。
4. majorArcs: 故事大纲（分为 3-5 个主要阶段，每个阶段包含：阶段标题、核心目标、最高潮事件），必须符合叙事结构的阶段划分。

【输出要求（非常重要）】
1. 只输出 JSON 对象，不要任何解释文字，不要 Markdown。
2. 所有字符串必须是单行；如需换行，请用 \\n 转义，不要直接换行。
3. 字符串里若出现双引号，必须使用 \\\" 转义。
4. JSON 顶层 key 必须使用英文：corePlot, characterSettings, worldSettings, majorArcs。

请严格输出 JSON：
{
  "corePlot": "...",
  "characterSettings": [{ "name": "...", "personality": "...", "motivation": "...", "fate": "..." }],
  "worldSettings": "...",
  "majorArcs": [{ "title": "...", "goal": "...", "highPoint": "..." }]
}`;

    const pick = (obj: any, keys: string[]) => {
        for (const k of keys) {
            if (!obj) continue;
            if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined && obj[k] !== null) return obj[k];
        }
        return undefined;
    };

    const toText = (v: any): string => {
        if (typeof v === "string") return v.trim();
        if (Array.isArray(v)) return v.map((x) => String(x)).join("\n").trim();
        if (v === undefined || v === null) return "";
        if (typeof v === "object") return JSON.stringify(v);
        return String(v).trim();
    };

    const toArray = (v: any): any[] => {
        if (Array.isArray(v)) return v;
        if (v && typeof v === "object") {
            const maybe = Object.keys(v)
                .filter((k) => /^\d+$/.test(k))
                .sort((a, b) => Number(a) - Number(b))
                .map((k) => (v as any)[k]);
            if (maybe.length) return maybe;
        }
        return [];
    };

    const normalizeGlobalPlan = (raw: any): GlobalPlan | null => {
        if (!raw || typeof raw !== "object") return null;

        const corePlot = toText(pick(raw, ["corePlot", "core_plot", "plot", "核心剧情走向", "核心剧情", "主线剧情", "故事主线"]));
        const worldSettings = toText(pick(raw, ["worldSettings", "world_settings", "world", "世界观设定", "世界观", "设定", "规则设定"]));

        const characterSettingsRaw = pick(raw, ["characterSettings", "character_settings", "characters", "人物设定", "主要角色设定", "角色设定", "角色"]);
        const characterSettings = toArray(characterSettingsRaw).map((c: any) => {
            if (typeof c === "string") return { name: c.trim() };
            if (c && typeof c === "object") {
                const name = toText(pick(c, ["name", "姓名", "角色名", "角色", "人物"]));
                const personality = toText(pick(c, ["personality", "性格", "特点"]));
                const motivation = toText(pick(c, ["motivation", "动机", "目标", "欲望"]));
                const fate = toText(pick(c, ["fate", "结局", "命运", "归宿"]));
                return { ...(name ? { name } : {}), ...(personality ? { personality } : {}), ...(motivation ? { motivation } : {}), ...(fate ? { fate } : {}) };
            }
            return {};
        }).filter((c: any) => c && Object.keys(c).length);

        const majorArcsRaw = pick(raw, ["majorArcs", "major_arcs", "arcs", "stages", "故事大纲", "主要阶段", "主线阶段", "阶段"]);
        let majorArcs = toArray(majorArcsRaw).map((a: any) => {
            if (typeof a === "string") return { title: a.trim(), goal: "", highPoint: "" };
            if (a && typeof a === "object") {
                const title = toText(pick(a, ["title", "name", "阶段标题", "标题", "阶段"]));
                const goal = toText(pick(a, ["goal", "核心目标", "目标", "阶段目标"]));
                const highPoint = toText(pick(a, ["highPoint", "high_point", "最高潮事件", "高潮", "最高点", "转折点"]));
                return { title, goal, highPoint };
            }
            return { title: "", goal: "", highPoint: "" };
        }).filter((a: any) => a && a.title);

        if (!majorArcs.length) {
            const text = toText(majorArcsRaw);
            if (text) majorArcs = [{ title: "阶段 1", goal: text.slice(0, 200), highPoint: "" }];
        }

        if (!corePlot && !worldSettings && !characterSettings.length && !majorArcs.length) return null;

        return {
            corePlot,
            characterSettings,
            worldSettings,
            majorArcs
        };
    };

    const salvageGlobalPlanFromText = (text: string): GlobalPlan | null => {
        const raw = (text || "").trim();
        if (!raw) return null;

        const extractField = (key: string): string => {
            const re = new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,\\s*"(?:corePlot|characterSettings|worldSettings|majorArcs)"\\s*:|\\s*\\}|$)`, "i");
            const m = raw.match(re);
            if (m && m[1] !== undefined) return m[1].trim();

            const reLoose = new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*)$`, "i");
            const m2 = raw.match(reLoose);
            if (m2 && m2[1] !== undefined) return m2[1].trim();
            return "";
        };

        const corePlot = extractField("corePlot");
        const worldSettings = extractField("worldSettings");

        if (!corePlot && !worldSettings) return null;

        return {
            corePlot: corePlot.slice(0, 4000),
            characterSettings: [],
            worldSettings: worldSettings.slice(0, 4000),
            majorArcs: []
        };
    };

    const strict = await generateStrictJson<any>({
        client,
        prompt,
        validate: (x): x is any => !!x && typeof x === "object",
        maxAttempts: 1,
        backoffBaseMs: 900,
        correctionHint: "请只输出 JSON 对象，且顶层必须使用英文 key：corePlot, characterSettings, worldSettings, majorArcs。不要 Markdown。"
    });

    let plan: GlobalPlan | null = null;

    if (strict.ok) {
        plan = normalizeGlobalPlan(strict.data);
        if (!plan) {
            try {
                const reparsed = parseJsonLenient<any>(strict.text || "");
                plan = normalizeGlobalPlan(reparsed);
            } catch {}
        }
        if (!plan) plan = salvageGlobalPlanFromText(strict.text || "");
    } else {
        const rawText = (strict.text || "").trim();
        plan = salvageGlobalPlanFromText(rawText);
        if (!plan) throw new Error(`全局规划生成失败: ${strict.error}${rawText ? `; raw=${rawText.slice(0, 300)}` : ""}`);
    }

    const isComplete = (p: GlobalPlan) => {
        const arcOk = Array.isArray(p.majorArcs) && p.majorArcs.filter((a) => a && a.title).length >= 3;
        const charOk = Array.isArray(p.characterSettings) && p.characterSettings.length >= 2;
        const plotOk = typeof p.corePlot === "string" && p.corePlot.trim().length >= 120;
        const worldOk = typeof p.worldSettings === "string" && p.worldSettings.trim().length >= 80;
        return arcOk && charOk && plotOk && worldOk;
    };

    if (plan && !isComplete(plan)) {
        const patchPrompt = `你将获得一个“可能不完整”的全局规划草稿。请基于用户信息与草稿内容，补全为完整的全局规划。\n\n【用户信息】\n标题：${req.title}\n题材：${req.tags.join("、")}\n梗概：${req.description}\n\n【草稿（可能缺字段/内容不足）】\n${JSON.stringify(plan)}\n\n【输出要求】\n1. 只输出 JSON 对象，不要任何解释文字，不要 Markdown。\n2. 顶层 key 必须使用英文：corePlot, characterSettings, worldSettings, majorArcs。\n3. corePlot/worldSettings 必须是单行字符串；如需换行，用 \\n；引号用 \\\"。\n4. characterSettings 至少 3 人（主角/关键配角/反派或太奶），每人 name/personality/motivation/fate。\n5. majorArcs 3-5 段，每段 title/goal/highPoint 都要具体。\n\n请输出：\n{\n  \"corePlot\": \"...\",\n  \"characterSettings\": [{ \"name\": \"...\", \"personality\": \"...\", \"motivation\": \"...\", \"fate\": \"...\" }],\n  \"worldSettings\": \"...\",\n  \"majorArcs\": [{ \"title\": \"...\", \"goal\": \"...\", \"highPoint\": \"...\" }]\n}`;

        const strict2 = await generateStrictJson<any>({
            client,
            prompt: patchPrompt,
            validate: (x): x is any => !!x && typeof x === "object",
            maxAttempts: 1,
            backoffBaseMs: 900,
            correctionHint: "请只输出严格 JSON，并确保所有 key 都是双引号包裹，字符串不得截断。"
        });

        if (strict2.ok) {
            const normalized = normalizeGlobalPlan(strict2.data) || normalizeGlobalPlan(parseJsonLenient<any>(strict2.text || ""));
            if (normalized) return normalized;
        }
    }

    return plan || { corePlot: "", characterSettings: [], worldSettings: "", majorArcs: [] };
}

/**
 * 获取叙事结构特定的 Prompt 指导
 * 结构名称: 核心关键词, 结构逻辑, 适用题材
 */
function getNarrativeStructurePrompt(structure: string = "standard"): string {
    const structures: Record<string, string> = {
        // 1. 标准三幕式
        standard: `【标准三幕式结构】
- 第一幕（1-25%）：铺垫背景，触发事件，主角进入新世界
- 第二幕（25-75%）：遭遇挫折，盟友/反派登场，冲突升级
- 第三幕（75-100%）：终极决战，解决核心矛盾，结局收尾
适用题材：都市、玄幻、言情、悬疑等绝大多数题材`,

        // 2. 英雄之旅
        hero_journey: `【英雄之旅结构】
- 1. 平凡世界：主角在普通世界的日常
- 2. 冒险召唤：意外事件打破平静，触发冒险
- 3. 跨越门槛：主角决定接受挑战，进入新世界
- 4. 试炼与盟友：遭遇考验，结识伙伴，能力成长
- 5. 接近深渊：面对最大挑战，盟友可能背叛或牺牲
- 6. 终极考验：最黑暗的时刻，获得蜕变
- 7. 归来与蜕变：带着宝藏/智慧回归，改变世界
适用题材：玄幻修仙、西幻冒险、都市逆袭、系统流`,

        // 3. 快节奏爽文
        fast_paced: `【快节奏爽文结构】
- 开篇：即爆发危机/羞辱，主角陷入绝境或面临抉择
- 金手指：主角获得独特能力/系统/机遇
- 循环打脸：小试牛刀打脸反派 -> 新冲突出现 -> 再升级打脸 -> 循环往复
- 爽点密集：每个冲突解决后必有收益（修为/地位/美女/宝物）
适用题材：都市系统、玄幻修仙、赘婿、战神流`,

        // 4. 悬疑解谜
        mystery: `【悬疑解谜结构】
- 抛出谜题：开篇抛出核心谜案（凶案/失踪/异常现象）
- 烟雾弹：层层线索，真假信息混淆，让读者猜错方向
- 逐步接近：主角通过调查逐步接近真相
- 真相大白：最终反转，揭露幕后黑手或隐藏真相
适用题材：刑侦、灵异、无限流、烧脑脑洞文`,

        // 5. 悲剧内核
        tragedy: `【悲剧内核结构】
- 美好撕裂：先塑造主角珍视的美好（亲情/爱情/理想）
- 命运不公：外力/命运逐步将其摧毁
- 遗憾收尾：主角反抗失败，留下遗憾或悲壮结局
适用题材：现实向、虐恋、古风权谋、暗黑奇幻`,

        // 6. 无限流循环（新增）
        infinite_loop: `【无限流循环结构】
- 副本迭代：主角进入无限循环/副本世界
- 规则杀：每个副本有独立规则与生存任务
- 奖励机制：完成任务获得奖励/解锁主线
- 记忆重置：部分副本需要利用之前副本的记忆/能力
- 打破循环：最终揭露真相，打破循环或进入更高层
适用题材：无限流、恐怖灵异、科幻生存`,

        // 7. 多线并进（新增）
        multi_thread: `【多线并进结构】
- 视角切换：多条人物线/事件线并行推进
- 伏笔埋入：每条线埋下独立伏笔与悬念
- 逐步交汇：中期各条线开始产生交集
- 高潮汇合：最终在高潮处所有线索收束，完成闭环
适用题材：群像文、权谋、科幻、史诗级玄幻`,

        // 8. 倒叙 + 插叙（新增）
        flashback: `【倒叙 + 插叙结构】
- 结局前置：先展示最具冲击力的结局/危机片段
- 悬念钩子：设置巨大悬念，吸引读者追看
- 倒回时间线：逐步解释前因后果
- 回忆补全：插叙关键回忆，补全人物动机与伏笔
适用题材：悬疑、复仇文、情感虐恋、人物传记`,

        // 9. 单元剧 + 主线（新增）
        episodic: `【单元剧 + 主线结构】
- 单元故事：每章/每卷一个独立单元故事（委托/案件/任务）
- 主线伏笔：每个单元暗藏主线伏笔
- 逐步揭秘：随着单元推进，主线谜团逐渐清晰
- 单元收束：最终单元收束所有伏笔，解决核心主线
适用题材：都市灵异、侦探、系统流、奇幻冒险`,

        // 10. 逆袭爽点流（新增）
        counterattack: `【逆袭爽点流结构】
- 低谷开局：主角从底层/屈辱/废物开局
- 隐藏实力：主角有隐藏身份/潜力/过往
- 扮猪吃虎：面对挑衅时低调隐藏，关键时刻爆发
- 越级反杀：实力不如对手时靠智慧/底牌反杀
- 地位攀升：每一次胜利都带来地位/实力提升
适用题材：赘婿、战神、废柴流、都市神医`
    };
    return structures[structure] || structures.standard;
}

function getWritingStylePrompt(style: string = "standard"): string {
    const styles: Record<string, string> = {
        standard: `【标准网文风格】
- 节奏明快，爽点密集
- 伏笔回收及时，情绪拉满
- 代入感强，情节紧凑
- 适合主流读者群体`,
        literary: `【文青风格要求】
- 语言优美流畅，描写细腻生动
- 注重情感表达和心理刻画
- 场景描写要有画面感
- 意象营造、氛围渲染、留白叙事
- 可以有更多内心独白和哲理思考`,
        fast: `【快节奏爽文要求】
- 开篇暴击，快速进入核心冲突
- 金手指秒用，不拖泥带水
- 循环打脸，越级反杀
- 减少冗余描写，每句话都要推进剧情
- 章节短小精悍，信息密度高`,
        humor: `【轻松幽默风格】
- 语言诙谐有趣，可以适当玩梗
- 主角可以有逗比属性或毒舌
- 沙雕队友制造反差萌
- 情节轻松愉快，避免太沉重
- 对话俏皮活泼，可有官方吐槽`,
        serious: `【严肃正剧风格】
- 逻辑严密，情节合理
- 世界观严谨，设定考据
- 人物行为要有深层动机
- 权谋博弈，人性探讨
- 有深度思想内涵，避免无脑降智`,
        ruthless: `【杀伐果断风格】
- 主角冷酷，不圣母
- 斩草除根，有仇必报
- 利益至上，绝不手软
- 绝不拖泥带水，处理果断
- 心狠手辣，但有底线`,
        atmospheric: `【氛围感拉满风格】
- 侧重环境与情绪渲染
- 光影描写、感官细节丰富
- 压抑/诡谲/浪漫氛围营造
- 情绪留白，给读者想象空间
- 适合悬疑灵异、克苏鲁、古风虐恋`,
        dialogue: `【对话流爽文风格】
- 以对话推动剧情为主
- 短句对白，针锋相对
- 爽点藏在对白里
- 一语破防，信息差碾压
- 适合都市职场、神豪文、赘婿文`,
        realistic: `【细节流写实风格】
- 注重现实细节，真实感拉满
- 生活细节丰富
- 职业科普，社会观察
- 人物微表情刻画
- 场景考据，适合现实向、职场文`,
        brainhole: `【脑洞解构风】
- 打破套路，反讽解构
- 反套路设定，吐槽套路
- 玩梗解构，逻辑鬼才
- 错位笑点层出不穷
- 适合无限流、系统流、搞笑文`,
        dark: `【暗黑压抑风】
- 基调阴暗，人性复杂
- 绝望氛围渲染
- 道德困境，人性挣扎
- 悲剧美学，宿命感
- 适合克苏鲁、末世文、暗黑修仙`,
        sweet: `【甜宠治愈风】
- 温柔细腻，糖分超标
- 双向奔赴，细节宠溺
- 温柔体贴，慢节奏甜
- 情绪治愈，压力释放
- 适合现言甜宠、校园恋爱`,
        tech: `【硬核科技风】
- 专业术语扎实，科技感十足
- 硬核设定，技术细节
- 逻辑自洽，无明显漏洞
- 未来畅想，科技伦理探讨
- 适合赛博朋克、AI觉醒、科幻机甲`,
        martial: `【江湖烟火气】
- 市井江湖，烟火人间
- 侠气与温情并存
- 市井百态，江湖恩怨
- 侠骨柔情，小人物传奇
- 适合武侠文、古风市井`,
        live: `【直播互动风】
- 模拟直播视角，弹幕互动感强
- 实时弹幕吐槽
- 观众视角，带入感强
- 整活整蛊，节奏带动
- 适合恐怖直播、规则怪谈`
    };
    return styles[style] || styles.standard;
}

/**
 * 针对特定分卷生成详细章节
 */
export async function generateChaptersForVolume(req: VolumeGenerationRequest): Promise<GeneratedChapter[]> {
    const client = await getAIClientForRole("writer");
    const prompt = `你是一位擅长把控节奏的金牌主编。请根据以下全局规划和本卷目标，为本卷设计详细的章节大纲。

【全局规划】
${req.globalPlan}

【前卷简述】
${req.previousVolumeSummary || "（本卷为开篇第一卷）"}

【本卷目标与高潮】
- 本卷标题：${req.volumeTitle}
- 核心目标：${req.volumeGoal}
- 最高潮事件：${req.volumeHighPoint}

【章节设计要求】
1. 篇幅：生成约 ${req.totalChapters || 10} 个章节。
2. 逻辑：每章必须有明确的剧情推进，且必须最终导向“最高潮事件”。
3. 伏笔：在本卷中埋下至少 1 个后续分卷会用到的伏笔。
4. 格式：严格输出 JSON。

请仅输出 JSON 对象：
{
  "chapters": [
    {
      "title": "第N章 [吸睛标题]",
      "summary": "[包含冲突、动作与结果的具体剧情]",
      "detail": {
        "sceneList": [
          { "title": "场景标题", "summary": "...", "location": "...", "goal": "...", "conflict": "...", "outcome": "..." }
        ]
      }
    }
  ]
}`;

    const strict = await generateStrictJson<{ chapters: GeneratedChapter[] }>({
        client,
        prompt,
        validate: (x): x is any => !!x && Array.isArray(x.chapters),
        maxAttempts: 3
    });

    if (!strict.ok) throw new Error(`分卷章节生成失败: ${strict.error}`);
    return strict.data.chapters;
}

export async function generateNovelOutline(req: OutlineRequest): Promise<GeneratedVolume[]> {
    const client = await getAIClientForRole("writer");
    
    const customPrompt = loadConfig("NOVEL_OUTLINE_PROMPT");
    let prompt = "";

    const narrativeStructurePrompt = getNarrativeStructurePrompt(req.narrativeStructure);
    const writingStylePrompt = getWritingStylePrompt(req.writingStyle);

    if (customPrompt) {
        prompt = customPrompt
            .replace(/{{title}}/g, req.title)
            .replace(/{{tags}}/g, req.tags.join("、"))
            .replace(/{{description}}/g, req.description)
            .replace(/{{totalChapters}}/g, (req.totalChapters || 20).toString())
            .replace(/{{volumeCount}}/g, (req.volumeCount || 1).toString())
            .replace(/{{chaptersPerVolume}}/g, (req.chaptersPerVolume || req.totalChapters || 20).toString())
            .replace(/{{writingStyle}}/g, req.writingStyle || "standard")
            .replace(/{{narrativeStructure}}/g, narrativeStructurePrompt);
    } else {
        prompt = `你是一位深谙网文市场规律、擅长构建极致节奏与逻辑深度的金牌主编。
请根据以下核心创意，设计一份极具吸引力、逻辑自洽且充满张力的小说大纲。

【小说基础信息】
- 标题：${req.title}
- 题材标签：${req.tags.join("、")}
- 核心梗概：${req.description}
- 预计篇幅：${req.volumeCount || 1} 卷 x ${req.chaptersPerVolume || req.totalChapters || 20} 章 = ${(req.volumeCount || 1) * (req.chaptersPerVolume || req.totalChapters || 20)} 章

【核心架构指导】
${narrativeStructurePrompt}

${writingStylePrompt ? `【写作风格要求】\n${writingStylePrompt}\n` : ""}

${req.globalPlan ? `【全局规划（参考此设定）】\n${req.globalPlan}\n` : ""}

【设计要求 - 严禁敷衍】
1. **拒绝同质化标题**：章节名必须自带画面感、动作感与悬念感。严禁使用“第一章 发现”、“第二章 准备”这种AI感极强的无意义标题。
2. **伏笔与钩子 (Hooks & Foreshadowing)**：
   - 每卷必须包含至少 2 个长线伏笔，并在后续章节中明确标注“伏笔预埋”或“伏笔回收”。
   - 章节结尾必须设置强有力的“断章钩子”，让读者产生强烈的追更欲望。
3. **因果链逻辑**：
   - 剧情推进必须基于“因果”而非“巧合”。
   - 主角的行为必须符合人设，且面对危机时展现出独特的破局逻辑。
4. **黄金三章法则 (必须严格执行)**：
   - 第1章：核心冲突爆发，主角被逼入死角，金手指/转机以反直觉的方式出现。
   - 第2章：主角尝试掌控力量，遭遇第一次反转，制造第一个爽点。
   - 第3章：阶段性危机解决，引出更深层的世界观迷雾。
5. **内容安全与合规 (重要)**：
   - 在描述大纲和梗概时，请避免过于直白、血腥、暴力或色情的词汇。
   - 优先使用侧面描写、隐喻或专业术语来表达冲突，以确保生成的内容不会被安全过滤器拦截。

【输出格式 - 严格 JSON】
请仅输出一个 JSON 对象，根对象为 \`outline\`。
每一章必须包含 \`detail.sceneList\`，每个场景必须包含地点、目标、冲突与结果。
并在 \`detail\` 中增加 \`hooks\` 字段，用于管理伏笔。

\`\`\`json
{
  "outline": [
    {
      "title": "第一卷：[极具张力的卷名]",
      "chapters": [
        {
          "title": "第1章 [吸睛标题]",
          "summary": "[包含核心冲突、动作、结果的具体剧情，3-5句]",
          "detail": {
            "hooks": [
              { "type": "pre", "content": "预埋伏笔：主角在雨中捡到的铜钱其实是...", "target_chapter": 20 }
            ],
            "sceneList": [
              {
                "title": "场景标题",
                "summary": "具体发生了什么",
                "location": "地点",
                "goal": "目标",
                "conflict": "阻力",
                "outcome": "转折点"
              }
            ]
          }
        }
      ]
    }
  ]
}
\`\`\`
不要输出任何 Markdown 之外的解释文字。`;
    }

    let text = "";
    try {
        const strict = await generateStrictJson<any>({
            client,
            prompt,
            validate: (x): x is any => (Array.isArray(x) && x.length > 0) || (x && typeof x === "object" && Object.keys(x).length > 0),
            maxAttempts: 3,
            backoffBaseMs: 800,
            correctionHint: "请仅输出一个 JSON 对象（顶层包含 outline 数组）。每章必须包含 detail.sceneList（3-6 个场景）。不要 Markdown，不要解释文字。",
        });

        text = strict.text || "";
        console.log("AI Outline Response:", text);

        if (!strict.ok) {
            throw new Error(`AI JSON 结构化输出失败：${strict.error}`);
        }

        const data = strict.data;
        
        // Data Structure Normalization
        let outline = [];
        if (Array.isArray(data)) {
            outline = data;
        } else if (data.outline && Array.isArray(data.outline)) {
            outline = data.outline;
        } else if (data.core_information && data.volume_chapter_structure && Array.isArray(data.volume_chapter_structure)) {
             // 兼容 AI 使用 core_information 包裹的情况
             outline = data.volume_chapter_structure;
        } else if (data.volumes && Array.isArray(data.volumes)) {
            outline = data.volumes;
        } else if (data.volume_outline && Array.isArray(data.volume_outline)) {
             // 兼容 AI 使用下划线命名的情况
             outline = data.volume_outline;
        } else if (data.volumeOutline && Array.isArray(data.volumeOutline)) {
             // 兼容 AI 使用驼峰命名的情况
             outline = data.volumeOutline;
        } else if (data["分卷与章节结构"] && Array.isArray(data["分卷与章节结构"])) {
             // 兼容中文 Key
             outline = data["分卷与章节结构"];
        } else if (data["分卷大纲"] && Array.isArray(data["分卷大纲"])) {
             // 兼容中文 Key
             outline = data["分卷大纲"];
        } else if (data["全书核心信息"] && data["分卷与章节结构"]) {
             // 兼容 AI 使用中文 Key 包裹的情况
             outline = data["分卷与章节结构"];
        } else if (data.chapter_list && Array.isArray(data.chapter_list)) {
             // 兼容 AI 直接返回章节列表的情况
             outline = [{ title: "默认分卷", chapters: data.chapter_list }];
        } else if (data.chapterList && Array.isArray(data.chapterList)) {
             // 兼容 AI 直接返回章节列表的情况 (驼峰)
             outline = [{ title: "默认分卷", chapters: data.chapterList }];
        } else if (data.chapters && Array.isArray(data.chapters)) {
             // 兼容单卷结构
             outline = [{ title: "默认分卷", chapters: data.chapters }];
        }

        // Final Validation: Ensure outline is not empty
        if (outline.length === 0) {
            console.warn("Parsed outline is empty. Raw Data:", JSON.stringify(data));

            // Even if structure is empty, if we have raw data, return it for debugging
            if (data && Object.keys(data).length > 0) {
                 // 尝试从 story_synopsis 或其他字段中寻找可能的内容，或者提示用户 AI 生成了错误的内容
                 const keys = Object.keys(data).join(", ");
                 return [{
                    title: `AI 返回数据异常 (含字段: ${keys})`,
                    chapters: [{
                        title: "原始数据",
                        summary: JSON.stringify(data, null, 2)
                    }]
                 }];
            }
            throw new Error("解析成功但内容为空 (Empty Outline Structure)");
        }

    // 规范化数据结构
    // 有些模型返回的章节可能在 chapter_list, list, content 等字段中
    // 有些模型返回的卷可能在 volume_list, list 等字段中
    // 我们需要将它们统一为 { title: string, chapters: { title: string, summary: string }[] }[] 结构

    outline = outline.map((vol: any) => {
        // 1. 规范化卷标题
        const title = vol.title || vol.volume_title || vol.name || vol.volume_name || "未命名分卷";
        
        // 2. 查找章节列表
        let chapters: any[] = [];
        if (Array.isArray(vol.chapters)) chapters = vol.chapters;
        else if (Array.isArray(vol.chapter_list)) chapters = vol.chapter_list;
        else if (Array.isArray(vol.chapterList)) chapters = vol.chapterList;
        else if (Array.isArray(vol.list)) chapters = vol.list;
        else if (Array.isArray(vol.items)) chapters = vol.items;
        else if (Array.isArray(vol.content)) chapters = vol.content; // 有时 AI 把章节放在 content 里

        // 尝试从 "0", "1", "2"... 这样的字段中提取章节（如果 chapters 是个对象而不是数组）
        if (chapters.length === 0 && typeof vol.chapters === 'object' && vol.chapters !== null) {
            const extracted = [];
            for (const key in vol.chapters) {
                if (!isNaN(Number(key))) {
                    extracted.push(vol.chapters[key]);
                }
            }
            if (extracted.length > 0) {
                 console.log("[Outline Fix] Found chapters in object-like array");
                 chapters = extracted;
            }
        }

        // 【智能修复】如果仍未找到章节，尝试查找卷对象中任何看起来像数组的字段
        if (chapters.length === 0) {
            for (const key in vol) {
                if (Array.isArray(vol[key]) && vol[key].length > 0) {
                    // 启发式检查：数组元素是否包含 title/summary 或本身就是字符串
                    const firstItem = vol[key][0];
                    if (typeof firstItem === 'string' || (typeof firstItem === 'object' && (firstItem.title || firstItem.summary || firstItem.name || firstItem.desc || firstItem.chapter_title))) {
                         console.log(`[Outline Fix] Found potential chapters in field: ${key}`);
                         chapters = vol[key];
                         break;
                    }
                }
            }
        }

        // 【二次智能修复】如果数组里全是数字索引（AI有时会返回 { "0": {...}, "1": {...} } 这种对象而不是数组）
        if (chapters.length === 0) {
             const potentialChapters: any[] = [];
             for (const key in vol) {
                 if (!isNaN(Number(key)) && typeof vol[key] === 'object') {
                     potentialChapters.push(vol[key]);
                 }
             }
             if (potentialChapters.length > 0) {
                 console.log(`[Outline Fix] Found potential chapters in object keys`);
                 chapters = potentialChapters;
             }
        }

        // 【调试回显】如果最终还是没有章节，返回一个调试章节，方便用户反馈
        if (chapters.length === 0) {
             const keys = Object.keys(vol).join(", ");
             const rawDump = JSON.stringify(vol).slice(0, 500); // Increase dump size
             chapters = [{
                title: "【调试信息】AI 未生成本卷章节",
                summary: `本卷原始数据包含字段: [${keys}]。AI 可能未遵循指令生成 chapters 数组，或者使用了错误的字段名。原始片段: ${rawDump}`
             }];
        }

        // 3. 规范化章节内容
        const normalizedChapters = chapters.map((ch: any) => {
            if (typeof ch === 'string') {
                return { title: ch, summary: "（AI 未生成详细剧情，仅提供了标题）" };
            }
            const detailRaw = ch.detail || ch.chapterDetail || ch.chapter_detail || ch.outlineDetail || null;
            const sceneListRaw =
                detailRaw?.sceneList ||
                detailRaw?.scene_list ||
                ch.sceneList ||
                ch.scene_list ||
                null;
            const sceneList = Array.isArray(sceneListRaw)
                ? sceneListRaw
                      .map((s: any) => {
                          if (typeof s === "string") return { title: s, summary: "" };
                          return {
                              title: String(s?.title || s?.name || "").trim(),
                              summary: String(s?.summary || s?.desc || s?.description || "").trim(),
                              location: s?.location ? String(s.location).trim() : undefined,
                              goal: s?.goal ? String(s.goal).trim() : undefined,
                              conflict: s?.conflict ? String(s.conflict).trim() : undefined,
                              outcome: s?.outcome ? String(s.outcome).trim() : undefined,
                          };
                      })
                      .filter((s: any) => s && s.title)
                : undefined;
            const plotPointsRaw =
                detailRaw?.plotPoints ||
                detailRaw?.plot_points ||
                detailRaw?.keyPlots ||
                detailRaw?.key_plots ||
                ch.plotPoints ||
                ch.plot_points ||
                ch.points ||
                null;
            const plotPoints = Array.isArray(plotPointsRaw)
                ? plotPointsRaw.map((x: any) => String(x).trim()).filter(Boolean)
                : [];
            const scenesRaw = detailRaw?.scenes || ch.scenes || null;
            const scenes = Array.isArray(scenesRaw) ? scenesRaw.map((x: any) => String(x).trim()).filter(Boolean) : [];
            const sceneListFinal =
                sceneList && sceneList.length
                    ? sceneList
                    : scenes.length
                        ? scenes.map((s: string, idx: number) => ({ title: `场景${idx + 1}`, summary: s }))
                        : undefined;
            const charactersRaw = detailRaw?.characters || ch.characters || null;
            const characters = Array.isArray(charactersRaw) ? charactersRaw.map((x: any) => String(x).trim()).filter(Boolean) : [];
            const skillsRaw = detailRaw?.skills || ch.skills || null;
            const skills = Array.isArray(skillsRaw) ? skillsRaw.map((x: any) => String(x).trim()).filter(Boolean) : [];
            const itemsRaw = detailRaw?.items || ch.items || null;
            const items = Array.isArray(itemsRaw) ? itemsRaw.map((x: any) => String(x).trim()).filter(Boolean) : [];
            const worldRaw = detailRaw?.world || ch.world || null;
            const world = Array.isArray(worldRaw) ? worldRaw.map((x: any) => String(x).trim()).filter(Boolean) : [];

            return {
                title: ch.title || ch.chapter_title || ch.name || "未命名章节",
                summary: ch.summary || ch.brief || ch.plot || ch.description || ch.content || "",
                detail: sceneListFinal
                    ? {
                          plotPoints: plotPoints.length ? plotPoints : sceneListFinal.map((s: any) => s.summary || s.title).filter(Boolean),
                          scenes,
                          sceneList: sceneListFinal,
                          characters,
                          skills,
                          items,
                          world,
                          wordCount: detailRaw?.wordCount || detailRaw?.word_count || undefined,
                          mainPlot: detailRaw?.mainPlot || detailRaw?.main_plot || undefined,
                          keyPlots: Array.isArray(detailRaw?.keyPlots || detailRaw?.key_plots) ? (detailRaw?.keyPlots || detailRaw?.key_plots) : undefined,
                          dialogues: Array.isArray(detailRaw?.dialogues) ? detailRaw.dialogues : undefined,
                          ending: detailRaw?.ending || undefined,
                          suspense: detailRaw?.suspense || undefined,
                      }
                    : undefined
            };
        });

        return { title, chapters: normalizedChapters };
    });

    return outline;
    } catch (error: any) {
        console.error("Outline Gen Error:", error);
        // Return a visual error structure instead of throwing, so the user sees feedback in the UI
        return [{
            title: "生成异常 - 调试信息",
            chapters: [
                {
                    title: "错误原因",
                    summary: `系统错误：${error.message || "未知错误"}`
                },
                {
                    title: "原始返回内容 (Raw Response)",
                    summary: text ? text.slice(0, 3000) : "（AI 未返回任何文本，可能是网络超时或被拦截）"
                }
            ]
        }];
    }
}

export async function generateChapterContent(req: ChapterContentRequest): Promise<GeneratedChapterContent> {
    const client = await getAIClientForRole("writer");
    
    // Construct a richer prompt with new details
    let contextStr = `小说背景：${req.novelContext}\n章节标题：${req.chapterTitle}\n`;
    
    if (req.detail) {
        if (req.detail.scenes?.length) contextStr += `\n涉及场景：${req.detail.scenes.join("；")}`;
        if (req.detail.characters?.length) contextStr += `\n出场人物：${req.detail.characters.join("；")}`;
        if (req.detail.skills?.length) contextStr += `\n涉及技能：${req.detail.skills.join("；")}`;
        if (req.detail.items?.length) contextStr += `\n涉及物品：${req.detail.items.join("；")}`;
        if (req.detail.world?.length) contextStr += `\n世界观补充：${req.detail.world.join("；")}`;
    }

    // Context Memory Enhancement
    if (req.previousSummary) {
        contextStr += `\n\n【前文剧情摘要（重要参考）】\n${req.previousSummary}`;
    }

    // RAG Memory Injection (可关闭以减少tokens消耗)
    if (req.projectId && req.memoryEnhance !== false) {
        try {
            const memoryContext = await generateRelevantContext(req.projectId, req.chapterTitle, req.points);
            if (memoryContext) {
                contextStr += `\n\n【历史相关记忆（重要参考）】\n${memoryContext}`;
                console.log(`[RAG] Injected ${memoryContext.length} chars of memory context`);
            }
        } catch (e) {
            console.warn("[RAG] Failed to retrieve memory:", e);
        }
    }
    
    const plotPointsStr = req.points.map((p, i) => `${i + 1}. ${p}`).join("\n");
    const styleConstraints = getNovelStyleConstraints();
    
    // 动态字数要求
    const targetWords = req.targetWordCount || 2500;
    const minWords = Math.floor(targetWords * 0.8);
    const maxWords = Math.floor(targetWords * 1.3);

    const customPrompt = loadConfig("NOVEL_CHAPTER_CONTENT_PROMPT");
    let prompt = "";

    if (customPrompt) {
        prompt = customPrompt
            .replace(/{{contextStr}}/g, contextStr)
            .replace(/{{plotPoints}}/g, plotPointsStr)
            .replace(/{{narrativeStructure}}/g, "快节奏爽文结构")
            .replace(/{{writingStyle}}/g, styleConstraints);
    } else {
        prompt = `你是一位擅长连载的网文作者。请根据设定与细纲写本章正文，优先保证剧情清晰、人物稳定、叙事自然。

【核心信息】
${contextStr}

${styleConstraints ? `\n【风格与禁用约束（必须遵守）】\n${styleConstraints}\n` : ""}

【本章剧情细纲 (Plot Points)】
${plotPointsStr}

【写作硬约束】
1. 覆盖全部细纲要点，不遗漏，不篡改。
2. 人物行为符合既有动机与关系，不得无因果反转。
3. 以动作、对话、场景细节推进，严禁使用解释式总结。
4. 按"引入冲突 → 升级 → 兑现或反转 → 结尾钩子"推进。
5. 若核心信息含"真相文件"，其内容为唯一事实来源。
6. 目标字数 ${minWords}-${maxWords} 字，保证有效信息密度，避免注水。
7. **对话与描写平衡**：主动用描写（动作、环境、心理、转述）来稀释对话密度，避免剧本化倾向。

【输出规范】
- 仅输出正文，不要前言后语或解释。
- 严禁在章节末尾进行任何形式的情感总结、升华或说教。
- 不要重复输出章节标题。

正文开始：
`;
    }

    try {
        // Anti-Lazy Mechanism
        let attempts = 0;
        let content = "";
        const maxAttempts = 3; // 减少重试次数，提高反馈速度

        while (attempts < maxAttempts) {
            try {
                content = await client.generateContent(prompt);
                content = content.trim();
            } catch (err: any) {
                attempts++;
                if (attempts >= maxAttempts) throw err;
                await new Promise((r) => setTimeout(r, 600 * attempts));
                continue;
            }

            if (content.length < 60) {
                throw new Error("模型返回内容过短，可能是代理异常/限流/被拦截导致未生成正文");
            }

            // Check 1: Too short?
            if (content.length < 500) {
                console.warn(`[Anti-Lazy] Content too short (${content.length} chars). Retrying...`);
                prompt += "\n\n【系统警告】你生成的内容太短了！请务必扩写细节，增加环境、心理和动作描写，字数必须在2000字以上！重新生成：";
                attempts++;
                continue;
            }

            const aiMarkers = ["然而", "随着", "不由得", "顿时", "刹那间", "下一刻", "就在这时", "与此同时", "紧接着", "总之", "由此可见"];
            const markerHits = aiMarkers.reduce((n, p) => n + (content.includes(p) ? 1 : 0), 0);
            if (markerHits >= 6) {
                console.warn(`[Anti-AI] Detected many template markers (${markerHits}). Retrying...`);
                prompt += "\n\n【系统警告】你的文字“模板连接词/总结句”过多，读感像AI。请大幅减少连接词，改用动作与对话推进，句式更自然，避免讲道理式总结。重新生成：";
                attempts++;
                continue;
            }

            // Check 2: Lazy phrases?
            const lazyPhrases = ["略过", "此处省略", "下回分解", "生成完毕", "大纲如下"];
            if (lazyPhrases.some(p => content.includes(p))) {
                console.warn(`[Anti-Lazy] Detected lazy phrase. Retrying...`);
                prompt += "\n\n【系统警告】请输出完整的正文故事，不要包含“略过”或“大纲”等敷衍词汇！重新生成：";
                attempts++;
                continue;
            }

            break; // Pass
        }

        if (attempts >= maxAttempts && content.length < 200) {
             throw new Error("AI 生成内容质量过低，请重试");
        }

        return { content };
    } catch (error) {
        console.error("Chapter Content Gen Error:", error);
        throw new Error(error instanceof Error ? error.message : "正文生成失败");
    }
}

export interface SceneContentRequest {
    projectId?: string;
    novelContext: string;
    chapterTitle: string;
    sceneIndex: number;
    scene: {
        title: string;
        summary: string;
        location?: string;
        goal?: string;
        conflict?: string;
        outcome?: string;
    };
    previousSummary?: string;
    chapterSoFar?: string;
}

export interface GeneratedSceneContent {
    content: string;
}

export async function generateSceneContent(req: SceneContentRequest): Promise<GeneratedSceneContent> {
    const client = await getAIClientForRole("writer");
    const styleConstraints = getNovelStyleConstraints();

    let contextStr = `小说背景：${req.novelContext}\n章节标题：${req.chapterTitle}\n当前场景序号：${req.sceneIndex + 1}\n当前场景标题：${req.scene.title}\n`;
    if (req.scene.location) contextStr += `场景地点：${req.scene.location}\n`;
    if (req.scene.goal) contextStr += `场景目标：${req.scene.goal}\n`;
    if (req.scene.conflict) contextStr += `场景冲突：${req.scene.conflict}\n`;
    if (req.scene.outcome) contextStr += `场景结果：${req.scene.outcome}\n`;

    if (req.previousSummary) {
        contextStr += `\n【前文剧情摘要（重要参考）】\n${req.previousSummary}\n`;
    }

    if (req.projectId) {
        try {
            const memoryContext = await generateRelevantContext(req.projectId, req.chapterTitle, [req.scene.title, req.scene.summary].filter(Boolean));
            if (memoryContext) contextStr += `\n【历史相关记忆（重要参考）】\n${memoryContext}\n`;
        } catch {}
    }

    const chapterSoFar = (req.chapterSoFar || "").trim();

    let prompt = `你是一位畅销榜大神级网文作家。请只撰写当前章节的一个【场景】，要求强画面、强节奏、强冲突。

【核心信息】
${contextStr}

【本场景简述】
${req.scene.summary}

${chapterSoFar ? `【本章已写内容（只用于承接，不要复述）】\n${chapterSoFar.slice(-1200)}\n` : ""}

${styleConstraints ? `【风格与禁用约束（必须遵守）】\n${styleConstraints}\n` : ""}

【写作要求】
1. 只写本场景，不要写下一场景。
2. 必须承接“本章已写内容”的情绪与动作（如果提供）。
3. 以“动作/对话/五感/潜台词”推进，严禁使用解释式旁白。
4. 输出 700-1200 字左右，段落清晰。
5. 直接输出正文，不要标题，不要前言后语，不要 Markdown。
6. **去AI化要求**：强行切除段落开头常见的过渡词，严禁在场景末尾进行情感升华。

正文开始：
`;

    try {
        let attempts = 0;
        let content = "";
        while (attempts < 4) {
            try {
                content = await client.generateContent(prompt);
                content = content.trim();
            } catch (err: any) {
                attempts++;
                if (attempts >= 4) throw err;
                await new Promise((r) => setTimeout(r, 600 * attempts));
                continue;
            }

            if (content.length < 120) {
                attempts++;
                prompt += "\n\n【系统警告】你输出太短或不完整。请按要求扩写到 700-1200 字并只输出正文. 重新输出：\n";
                continue;
            }

            const lazyPhrases = ["略过", "此处省略", "下回分解", "生成完毕", "大纲如下"];
            if (lazyPhrases.some((p) => content.includes(p))) {
                attempts++;
                prompt += "\n\n【系统警告】不要出现“略过/省略/下回分解”等敷衍词。请输出完整场景正文。重新输出：\n";
                continue;
            }

            break;
        }

        return { content };
    } catch (error) {
        console.error("Scene Content Gen Error:", error);
        throw new Error(error instanceof Error ? error.message : "场景生成失败");
    }
}

export interface RewriteRequest {
    content: string;
    style: string;
}

export async function rewriteChapterContent(req: RewriteRequest): Promise<string> {
    const client = await getAIClientForRole("writer");
    
    const customPrompt = loadConfig("NOVEL_REWRITE_STYLE_PROMPT");
    let prompt = "";

    if (customPrompt) {
        prompt = customPrompt
            .replace(/{{style}}/g, req.style)
            .replace(/{{content}}/g, req.content);
    } else {
        // Fallback if config is missing (though we just added it)
        prompt = `请使用【${req.style}】风格重写以下内容：\n\n${req.content}`;
    }

    try {
        let attempts = 0;
        let lastErr: any = null;
        while (attempts < 3) {
            try {
                const text = await client.generateContent(prompt);
                return text.trim();
            } catch (err: any) {
                lastErr = err;
                attempts++;
                if (attempts >= 3) break;
                await new Promise((r) => setTimeout(r, 600 * attempts));
            }
        }
        throw lastErr || new Error("rewrite failed");
    } catch (error) {
        console.error("Rewrite Error:", error);
        throw new Error("重写失败");
    }
}


export async function generateAIAssist(req: AIAssistRequest): Promise<AIAssistResponse> {
    const client = await getAIClientForRole("writer");
    
    // Load custom configurations
    const stylePrompt = loadConfig("NOVEL_PROFESSIONAL_STYLE_PROMPT") || "";
    const avoidPrompt = loadConfig("NOVEL_AVOID_WORDS") || "";
    
    const configContext = `
${stylePrompt ? `【全局文风要求】：${stylePrompt}` : ""}
${avoidPrompt ? `【禁止使用的词汇/风格】：${avoidPrompt}（请务必避开这些词汇，使表达更自然、去AI化）` : ""}
`.trim();

    const humanizePrompt = loadConfig("NOVEL_HUMANIZE_PROMPT");

    let prompt = "";
    if (req.action === "continue") {
        prompt = `你是一位专业的小说作家。请根据以下已有的剧情内容，继续向下续写。
要求：
1. 保持文风一致，角色性格连贯。
2. 续写内容大约 500-1000 字。
3. 如果提供了【背景信息/指令】，请务必遵循。
${configContext ? `4. 遵循以下个性化配置：\n${configContext}` : ""}
5. 直接输出续写内容，不要有任何前言、后语或 Markdown 标记。

【背景信息/指令】：${req.context || "无"}
【用户额外指令】：${req.instruction || "无"}

【已有内容】：
${req.content}

【续写开始】：
`;
    } else if (req.action === "polish") {
        prompt = `你是一位经验丰富的小说编辑。请对以下小说片段进行润色和优化。
要求：
1. 增强画面感，丰富细节描写。
2. 优化词句，使其更具表现力和张力。
3. 保持原有剧情和角色设定不变。
4. 如果提供了【修改指令】，请重点针对指令进行优化。
${configContext ? `5. 遵循以下个性化配置：\n${configContext}` : ""}
6. 直接输出润色后的内容，不要有任何前言、后语或 Markdown 标记。

【修改指令】：${req.instruction || "全面优化文笔"}

【待润色内容】：
${req.content}

【润色后内容】：
`;
    } else if (req.action === "humanize") {
        if (humanizePrompt) {
            prompt = humanizePrompt
                .replace(/{{context}}/g, req.context || "无")
                .replace(/{{content}}/g, req.content);
            if (configContext) prompt += `\n\n【补充配置要求】：\n${configContext}`;
        } else {
            prompt = `你是一位具有极高文学素养的小说家，擅长细腻的描写和情感表达。
请对以下内容进行【去 AI 化】重写。

要求：
1. 彻底消除 AI 写作常见的“翻译腔”、“说教感”和“机械化词汇”。
2. 增加中国网文语境下的遣词造句习惯，使其读起来像真人创作。
3. 增加更多关于【五感】（视觉、听觉、嗅觉、味觉、触觉）的描写，避免空洞的形容词。
4. 增强对话的自然感，使其符合人物性格设定。
5. 保持原有剧情大纲不变。
${configContext ? `6. 遵循以下个性化配置：\n${configContext}` : ""}
7. 直接输出重写后的内容，不要有任何解释性文字。

【背景信息】：${req.context || "无"}
【待优化内容】：
${req.content}

【重写后内容】：
`;
        }
    }

    try {
        const text = await client.generateContent(prompt);
        return { result: text.trim() };
    } catch (error) {
        console.error("AI Assist Error:", error);
        throw new Error("AI 处理失败");
    }
}

export async function generateRandomNovelConcept(): Promise<RandomNovelConcept> {
    const client = await getAIClientForRole("writer");
    let prompt = `你是一位深谙网文市场规律、擅长打造爆款IP的金牌编辑。
请结合当下最热门的网文题材（如：规则怪谈、克苏鲁修仙、赛博朋克、全民转职、反派重生、系统流、古言宅斗、年代文、末世囤货、悬疑探案、传统玄幻、都市异能等），随机构思一个极具商业价值和读者吸引力的小说创意。

【创意要求】
1. **随机性**：请务必从上述题材中随机选择一个，不要总是生成同一种类型。每次生成都要尝试不同的风格。
2. **书名要炸裂**：必须符合网文取名套路，让人看一眼就想点进去。
   - 错误示范：《修仙传》、《异界冒险》
   - 正确示范：《全球高武：开局签到神级灵宠》、《刚成首富，你告诉我这是规则怪谈？》、《长生：从斩妖除魔开始》
3. **题材要热门**：标签要精准，符合当前市场风向。
4. **梗概有钩子**：100-200字的故事梗概，必须包含：
   - **核心冲突**：主角面临什么绝境？
   - **金手指/外挂**：主角凭借什么逆风翻盘？
   - **期待感/爽点**：读者最期待看到什么？

请严格按照以下 JSON 格式输出，不要包含任何额外内容：
\`\`\`json
{
  "title": "小说标题",
  "tags": ["标签1", "标签2", "标签3"],
  "description": "故事梗概..."
}
\`\`\`
`;


    try {
        let attempts = 0;
        while (attempts < 3) {
            const text = await client.generateContent(prompt);
            try {
                const data = parseJsonLenient<RandomNovelConcept>(text);
                if (data && typeof data.title === "string" && Array.isArray(data.tags) && typeof data.description === "string") {
                    if (data.title.trim().length >= 2 && data.description.trim().length >= 60 && data.tags.length >= 2) {
                        return data;
                    }
                }
                throw new Error("invalid shape");
            } catch {
                attempts++;
                prompt += `\n\n【系统纠错】你上一次输出不是严格 JSON 或字段不完整。请只输出 JSON，不要任何解释文字，字段必须包含 title/tags/description，且 description 需 100-200 字。重新输出：\n`;
            }
        }
        throw new Error("invalid json");
    } catch (error) {
        console.error("Random Concept Error:", error);
        throw new Error("创意生成失败");
    }
}

export async function generateStoryboardScript(req: StoryboardScriptRequest): Promise<StoryboardScriptResponse> {
    const client = await getAIClientForRole("writer");
    
    let prompt = `你是一位专业的影视编剧。请将以下小说正文内容转换成适合制作分镜的【剧本格式】。
要求：
1. 将正文拆分为若干个【场景 (Scene)】。
2. 每个场景包含：
   - 场景描述 (description)：简洁的画面描述，包含环境、动作、神态。
   - 对话 (dialogue)：包含说话人和对话内容。
3. 保持原有剧情和台词的核心含义。
4. 严格按照 JSON 格式输出，不要有任何 Markdown 标记。

输出 JSON 格式示例：
{
  "scenes": [
    {
      "sceneNumber": 1,
      "description": "破庙内，雷雨交加。叶云虚弱地靠在佛像后，紧握着手中的断剑。",
      "dialogue": [
        { "role": "叶云", "content": "还是被追上了吗..." },
        { "role": "黑衣人", "content": "交出玉佩，留你全尸。" }
      ]
    }
  ]
}

小说标题：${req.title}
小说正文：
${req.content}

剧本 JSON 开始：
`;

    try {
        let attempts = 0;
        while (attempts < 3) {
            const text = await client.generateContent(prompt);
            try {
                const data = parseJsonLenient<StoryboardScriptResponse>(text);
                if (data && Array.isArray((data as any).scenes) && (data as any).scenes.length > 0) {
                    return data;
                }
                throw new Error("invalid shape");
            } catch {
                attempts++;
                prompt += `\n\n【系统纠错】你上一次输出不是严格 JSON 或 scenes 为空。请只输出 JSON，不要任何解释文字，必须包含 scenes 数组。重新输出：\n`;
            }
        }
        throw new Error("invalid json");
    } catch (error) {
        console.error("Storyboard Script Error:", error);
        throw new Error("剧本转换失败");
    }
}

export interface ChapterContentRequest {
    chapterTitle: string;
    points: string[];
    novelContext: string;
    detail?: {
        scenes?: string[];
        characters?: string[];
        skills?: string[];
        items?: string[];
        world?: string[];
    };
    previousSummary?: string;
    projectId?: string;
    memoryEnhance?: boolean;
    targetWordCount?: number;
}

export interface AIAssistRequest {
    action: "continue" | "polish" | "humanize";
    content: string;
    context?: string;
    instruction?: string;
}

export interface AIAssistResponse {
    result: string;
}

export interface StoryboardScriptRequest {
    剧本: string;
    正文: string;
}

export interface StoryboardScene {
    sceneNumber: number;
    description: string;
    dialogue: { role: string; content: string }[];
}

export interface StoryboardScriptResponse {
    scenes: StoryboardScene[];
}

export interface ReviewRequest {
    chapterTitle: string;
    content: string;
    context?: string;
}

export interface ReviewResponse {
    score: number;
    plotAnalysis: string;
    pacingAnalysis: string;
    characterAnalysis: string;
    suggestions: string[];
}

export interface HookAnalysisRequest {
    chapterTitle: string;
    content: string;
}

export interface HookAnalysisResponse {
    hookScore: number;
    coolPointScore: number;
    hookType: string;
    coolPointType: string;
    analysis: string;
    suggestion: string;
}

export interface StoryboardScriptRequest {
    title: string;
    content: string;
}

export interface AIChatRequest {
    prompt: string;
    history?: { role: "user" | "assistant"; content: string }[];
}

export interface AIChatResponse {
    result: string;
    action?: string;
    data?: any;
}

export interface RandomNovelConcept {
    title: string;
    tags: string[];
    description: string;
}

import { generateRelevantContext } from "./memoryAgent";

export async function analyzeHook(req: HookAnalysisRequest): Promise<HookAnalysisResponse> {
    const client = await getAIClientForRole("analyst");
    
    let prompt = `你是一位深谙网文爽点和读者心理的金牌编辑。请对以下章节的【结尾钩子 (Hook)】和【爽点 (Cool Point)】进行专项分析。

【分析维度】
1. **结尾钩子 (Hook)**：章节结尾是否留有悬念？读者是否迫切想看下一章？
   - 钩子类型：危机悬念、反转悬念、期待感悬念、情绪悬念、无钩子。
2. **爽点 (Cool Point)**：本章是否有明确的情绪释放点（打脸、震惊、期待达成、收获、升级）？
   - 爽点类型：装逼打脸、震惊路人、绝地反击、宝物收获、实力突破、无爽点。

【待分析章节】
标题：${req.chapterTitle}
内容片段（结尾 500 字）：
${req.content.slice(-1000)}

【输出要求】
请严格按照以下 JSON 格式输出，不要包含 Markdown 标记：

\`\`\`json
{
  "hookScore": 85, // 钩子强度 0-100
  "coolPointScore": 70, // 爽点强度 0-100
  "hookType": "危机悬念",
  "coolPointType": "无爽点",
  "analysis": "结尾主角突然遭遇偷袭，悬念较强，但本章整体比较平淡，缺乏爽点...",
  "suggestion": "建议在结尾前增加一个主角展示实力的情节，或者让偷袭者是之前铺垫过的强敌..."
}
\`\`\`
`;

    try {
        const strict = await generateStrictJson<any>({
            client,
            prompt,
            validate: (x): x is any => !!x && typeof x === "object",
            maxAttempts: 3,
            backoffBaseMs: 800,
            correctionHint:
                "请只输出一个 JSON 对象，必须包含 hookScore, coolPointScore, hookType, coolPointType, analysis, suggestion 字段。",
        });

        const raw = (strict.text || "").trim();
        if (!strict.ok) {
            if (raw) {
                return {
                    hookScore: 0,
                    coolPointScore: 0,
                    hookType: "unknown",
                    coolPointType: "unknown",
                    analysis: raw.slice(0, 2500),
                    suggestion: "",
                };
            }
            throw new Error(`invalid json: ${strict.error}`);
        }

        const obj = strict.data || {};
        const n = (v: any) => (typeof v === "number" ? v : typeof v === "string" ? Number((v.match(/\d+(\.\d+)?/) || [])[0] || NaN) : NaN);
        const hookScore = n(obj.hookScore);
        const coolPointScore = n(obj.coolPointScore);
        const hookType = String(obj.hookType ?? "").trim();
        const coolPointType = String(obj.coolPointType ?? "").trim();
        const analysis = String(obj.analysis ?? "").trim();
        const suggestion = String(obj.suggestion ?? "").trim();

        if (
            Number.isFinite(hookScore) &&
            Number.isFinite(coolPointScore) &&
            hookType &&
            coolPointType &&
            analysis
        ) {
            return { hookScore, coolPointScore, hookType, coolPointType, analysis, suggestion };
        }

        if (raw) {
            return {
                hookScore: Number.isFinite(hookScore) ? hookScore : 0,
                coolPointScore: Number.isFinite(coolPointScore) ? coolPointScore : 0,
                hookType: hookType || "unknown",
                coolPointType: coolPointType || "unknown",
                analysis: analysis || raw.slice(0, 2500),
                suggestion,
            };
        }

        return {
            hookScore: Number.isFinite(hookScore) ? hookScore : 0,
            coolPointScore: Number.isFinite(coolPointScore) ? coolPointScore : 0,
            hookType: hookType || "unknown",
            coolPointType: coolPointType || "unknown",
            analysis: analysis || JSON.stringify(obj).slice(0, 2500),
            suggestion,
        };
    } catch (error) {
        console.error("Hook Analysis Error:", error);
        throw new Error("钩子分析失败");
    }
}

export async function reviewChapter(req: ReviewRequest): Promise<ReviewResponse> {
    const client = await getAIClientForRole("analyst");
    
    let prompt = `你是一位严苛但专业的网文主编。请对以下章节内容进行深度审稿和评分。
    
【审稿标准】
1. **剧情逻辑**：是否存在逻辑漏洞？剧情是否推进合理？
2. **节奏把控**：是否有爽点（Cool Point）？结尾是否有钩子（Hook）？是否注水？
3. **人物塑造**：人物行为是否符合人设？对话是否自然？
4. **文笔质量**：描写是否生动？是否有画面感？

【待审章节】
标题：${req.chapterTitle}
背景：${req.context || "无"}
正文内容：
${req.content}

【输出要求】
请严格按照以下 JSON 格式输出审稿报告，不要包含任何 Markdown 标记或额外文字：

\`\`\`json
{
  "score": 85,
  "plotAnalysis": "剧情分析...",
  "pacingAnalysis": "节奏分析（爽点/钩子）...",
  "characterAnalysis": "人设分析...",
  "suggestions": [
    "建议1...",
    "建议2..."
  ]
}
\`\`\`
`;

    try {
        const strict = await generateStrictJson<any>({
            client,
            prompt,
            validate: (x): x is any => !!x && typeof x === "object",
            maxAttempts: 3,
            backoffBaseMs: 800,
            correctionHint:
                "请只输出一个 JSON 对象，必须包含 score, plotAnalysis, pacingAnalysis, characterAnalysis, suggestions 字段。",
        });

        const rawText = (strict.text || "").trim();

        if (!strict.ok) {
            if (rawText) {
                return { score: 0, plotAnalysis: rawText.slice(0, 2500), pacingAnalysis: "", characterAnalysis: "", suggestions: [] };
            }
            throw new Error(`invalid json: ${strict.error}`);
        }

        const raw = strict.data || {};
        const scoreRaw = raw?.score;
        const score =
            typeof scoreRaw === "number"
                ? scoreRaw
                : typeof scoreRaw === "string"
                    ? Number((scoreRaw.match(/\d+(\.\d+)?/) || [])[0] || NaN)
                    : NaN;
        const plotAnalysis = String(raw?.plotAnalysis ?? raw?.plot_analysis ?? raw?.plot ?? "").trim();
        const pacingAnalysis = String(raw?.pacingAnalysis ?? raw?.pacing_analysis ?? raw?.pacing ?? "").trim();
        const characterAnalysis = String(raw?.characterAnalysis ?? raw?.character_analysis ?? raw?.character ?? "").trim();
        const suggestionsRaw = raw?.suggestions ?? raw?.suggestion ?? raw?.advice ?? raw?.tips;
        let suggestions: string[] = [];
        if (Array.isArray(suggestionsRaw)) suggestions = suggestionsRaw.map((x) => String(x)).filter(Boolean);
        else if (typeof suggestionsRaw === "string")
            suggestions = suggestionsRaw.split(/\r?\n+/).map((x) => x.trim()).filter(Boolean);

        if (Number.isFinite(score) && plotAnalysis && pacingAnalysis && characterAnalysis) {
            return { score, plotAnalysis, pacingAnalysis, characterAnalysis, suggestions };
        }

        if (rawText) {
            return {
                score: Number.isFinite(score) ? score : 0,
                plotAnalysis: plotAnalysis || rawText.slice(0, 2500),
                pacingAnalysis,
                characterAnalysis,
                suggestions,
            };
        }

        return {
            score: Number.isFinite(score) ? score : 0,
            plotAnalysis: plotAnalysis || JSON.stringify(raw).slice(0, 2500),
            pacingAnalysis,
            characterAnalysis,
            suggestions,
        };
    } catch (error) {
        console.error("Chapter Review Error:", error);
        throw new Error("章节审查失败");
    }
}

export async function generateAIChat(req: AIChatRequest): Promise<AIChatResponse> {
    const client = await getChatClient();
    
    // Check if the user is asking to generate an outline
    const isOutlineRequest = /大纲|生成.*大纲|帮我写.*大纲/.test(req.prompt);

    // Construct chat prompt with history
    let prompt = "";
    if (req.history && req.history.length > 0) {
        prompt = "以下是之前的对话历史：\n\n";
        req.history.forEach(msg => {
            prompt += `${msg.role === "user" ? "用户" : "助手"}: ${msg.content}\n`;
        });
        prompt += `\n当前用户的新问题：${req.prompt}\n`;
    } else {
        prompt = req.prompt;
    }

    // Add specific instruction for outline generation
    if (isOutlineRequest) {
        prompt += `\n【特殊指令】：如果用户请求生成小说大纲，请在回复的最后，附带一个严格的 JSON 代码块，包含大纲的结构化数据。
JSON 格式要求如下：
\`\`\`json
{
  "title": "小说标题",
  "tags": ["标签1", "标签2"],
  "description": "故事梗概...",
  "highlights": "故事看点...",
  "characterSettings": "人物设定...",
  "conflict": "故事冲突...",
  "worldSettings": "世界设定补充...",
  "outline": [
    {
      "title": "第一卷：卷名",
      "chapters": [
        { "title": "第一章 标题", "summary": "章节简要剧情..." }
      ]
    }
  ]
}
\`\`\`
请确保 JSON 格式正确，不要在 JSON 代码块中包含任何注释。回复的文本部分可以正常与用户交流。
助手：`;
    } else {
        prompt += "助手：";
    }

    try {
        const text = await client.generateContent(prompt);
        
        // Try to extract JSON if present
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            try {
                const jsonData = JSON.parse(jsonMatch[1]);
                // Verify basic structure
                if (jsonData.title && Array.isArray(jsonData.outline)) {
                    return { 
                        result: text.trim(),
                        action: "outline_generated",
                        data: jsonData
                    };
                }
            } catch (e) {
                console.warn("Failed to parse outline JSON from chat response");
            }
        }

        return { result: text.trim() };
    } catch (error) {
        console.error("AI Chat Error:", error);
        throw new Error("对话请求失败");
    }
}

// ── 交互式写作模式 ──

export interface InteractiveSegmentRequest {
    previousContent: string;
    nextPlotPoint: string;
    context: string;
    segmentLength?: "short" | "medium" | "long";
    instruction?: string;
}

export interface InteractiveSegmentResponse {
    segment: string;
    suggestions?: string[];
    nextPlotPoints?: string[];
}

export async function generateInteractiveSegment(req: InteractiveSegmentRequest): Promise<InteractiveSegmentResponse> {
    const client = await getAIClientForRole("writer");
    
    const stylePrompt = loadConfig("NOVEL_PROFESSIONAL_STYLE_PROMPT") || "";
    const avoidPrompt = loadConfig("NOVEL_AVOID_WORDS") || "";
    
    const configContext = `
${stylePrompt ? `【全局文风要求】：${stylePrompt}` : ""}
${avoidPrompt ? `【禁止使用的词汇/风格】：${avoidPrompt}` : ""}
`.trim();

    const lengthMap = { short: "200-400", medium: "400-800", long: "800-1500" };
    const targetLength = req.segmentLength ? lengthMap[req.segmentLength] : "400-800";

    const prompt = `你是一位专业的小说作家。请根据以下信息，创作一个独立的段落（约 ${targetLength} 字）。

【创作要求】
1. 这是一个独立的写作段落，需要自然衔接前文
2. 必须在本段结尾留下悬念或钩子，迫使读者想继续看下一段
3. 如果提供了【特殊指令】，请严格遵循
4. 直接输出正文内容，不要有任何前言、后语或 Markdown 标记
${configContext ? `\n【个性化配置】\n${configContext}` : ""}

【前文内容】
${req.previousContent || "（开头，无前文）"}

【本章剧情要点】
${req.nextPlotPoint}

【本章背景信息】
${req.context || "无"}

【特殊指令】
${req.instruction || "无"}

【段落开始】：
`;

    try {
        const text = await client.generateContent(prompt);
        
        const suggestions = [
            "在此处埋下一个后续会回收的伏笔",
            "引入一个新的配角或势力",
            "制造一个危机或冲突",
            "为主角创造一个机遇或挑战"
        ];
        
        return {
            segment: text.trim(),
            suggestions,
        };
    } catch (error) {
        console.error("Interactive Segment Error:", error);
        throw new Error("分段生成失败");
    }
}

export interface RewriteSegmentRequest {
    content: string;
    rewriteStyle: string;
    instruction?: string;
    context?: string;
}

export async function rewriteSegment(req: RewriteSegmentRequest): Promise<string> {
    const client = await getAIClientForRole("writer");
    
    const stylePrompt = loadConfig("NOVEL_PROFESSIONAL_STYLE_PROMPT") || "";
    const avoidPrompt = loadConfig("NOVEL_AVOID_WORDS") || "";
    
    const configContext = `
${stylePrompt ? `【全局文风要求】：${stylePrompt}` : ""}
${avoidPrompt ? `【禁止使用的词汇/风格】：${avoidPrompt}` : ""}
`.trim();

    const prompt = `你是一位经验丰富的小说编辑。请根据指定的【重写风格】重写以下内容。

【重写风格】
${req.rewriteStyle}

【特殊指令】
${req.instruction || "无"}

【背景信息】
${req.context || "无"}

${configContext ? `【个性化配置】\n${configContext}` : ""}

【待重写内容】
${req.content}

【重写要求】
1. 严格遵循指定的重写风格
2. 保持原有剧情和核心信息不变
3. 只修改表达方式、语气和描写手法
4. 直接输出重写后的内容，不要有任何解释性文字

【重写后内容】：
`;

    try {
        const text = await client.generateContent(prompt);
        return text.trim();
    } catch (error) {
        console.error("Segment Rewrite Error:", error);
        throw new Error("段落重写失败");
    }
}

export interface StyleMigrateRequest {
    content: string;
    targetStyle: "jinyong" | "riqing" | "xuannian" | "tianyi" | "gongfu" | "humor";
    preservePlot?: boolean;
}

const STYLE_MIGRATION_PROMPTS: Record<string, string> = {
    jinyong: `【金庸风格】
- 语言古雅蕴藉，半文言半白话
- 招式描写注重意境，如"平平淡淡的一剑"
- 人物内力描写雄浑刚劲
- 对话简洁有力，少则数字，多则数十字
- 情感表达含蓄内敛，如山水画留白`,
    
    riqing: `【日本轻小说风格】
- 第一人称内心独白丰富
- 吐槽与幽默感并存
- 大量心理描写和情绪波动
- 场景描写偏二次元风格
- 对话口语化、年轻化
- 常用拟声词和感叹`,
    
    xuannian: `【玄幻仙侠风格】
- 天地灵气、修炼体系、功法法宝
- 境界描述（练气、筑基、金丹、元婴等）
- 天材地宝、灵兽坐骑
- 杀伐果断、弱肉强食的世界观
- 丹药、阵法、符箓等元素`,
    
    tianyi: `【天才流风格】
- 主角智商碾压旁人
- 通过智斗而非蛮力解决问题
- 布局深远，伏笔众多
- 敌人与配角震惊于主角的才能
- 节奏明快，爽点密集`,
    
    gongfu: `【武侠风格】
- 江湖恩怨、门派纷争
- 拳脚功夫、刀剑兵器、内功外功
- 侠义精神与儿女情长
- 招式有具体名称和套路
- 实战描写紧张刺激`,
    
    humor: `【幽默风趣风格】
- 搞笑的情节和对话
- 吐槽和自嘲
- 意外的转折和反转
- 轻松愉快的氛围
- 人物有鲜明的喜剧特点`
};

export async function migrateStyle(req: StyleMigrateRequest): Promise<string> {
    const client = await getAIClientForRole("writer");
    
    const stylePrompt = STYLE_MIGRATION_PROMPTS[req.targetStyle] || STYLE_MIGRATION_PROMPTS.xuannian;
    const preserveNote = req.preservePlot !== false ? "保持原有剧情主线和关键信息不变" : "";

    const prompt = `你是一位擅长多种写作风格的作家。请将以下内容改写为指定风格。

【目标风格】
${stylePrompt}

【重要约束】
${preserveNote}
严格遵守去AI化要求，避免模板化词汇

【待转换内容】
${req.content}

【转换要求】
1. 完全采用目标风格的写作手法
2. ${preserveNote || "可以适当调整剧情节奏以适应风格"}
3. 直接输出转换后的内容，不要有任何解释性文字

【转换后内容】：
`;

    try {
        const text = await client.generateContent(prompt);
        return text.trim();
    } catch (error) {
        console.error("Style Migration Error:", error);
        throw new Error("风格转换失败");
    }
}

export interface BatchGenerateRequest {
    points: string[];
    context: string;
    eachLength?: number;
}

export async function batchGenerateSegments(req: BatchGenerateRequest): Promise<string[]> {
    const client = await getAIClientForRole("writer");
    
    const stylePrompt = loadConfig("NOVEL_PROFESSIONAL_STYLE_PROMPT") || "";
    const avoidPrompt = loadConfig("NOVEL_AVOID_WORDS") || "";
    
    const configContext = `
${stylePrompt ? `【全局文风要求】：${stylePrompt}` : ""}
${avoidPrompt ? `【禁止使用的词汇/风格】：${avoidPrompt}` : ""}
`.trim();

    const eachLength = req.eachLength || 500;

    const prompt = `你是一位专业的小说作家。请根据以下多个剧情要点，连续创作多个小段落。

【创作要求】
1. 每个段落约 ${eachLength} 字，形成连贯的故事
2. 段落之间要自然衔接，层层推进
3. 整体要有节奏感：铺垫 -> 冲突 -> 转折 -> 悬念
4. 严格遵守去AI化要求
${configContext ? `\n【个性化配置】\n${configContext}` : ""}

【剧情要点（按顺序创作）】
${req.points.map((p, i) => `${i + 1}. ${p}`).join("\n")}

【背景信息】
${req.context || "无"}

【输出格式】
请直接输出多个段落，每个段落之间用 "===段落分隔符===" 分隔，不要有任何前缀或后缀说明。

【正文开始】：
`;

    try {
        const text = await client.generateContent(prompt);
        const segments = text.split("===段落分隔符===").map(s => s.trim()).filter(Boolean);
        return segments;
    } catch (error) {
        console.error("Batch Generate Error:", error);
        throw new Error("批量生成失败");
    }
}

// ════════════════════════════════════════════════════════════
// 短篇小说生成
// ════════════════════════════════════════════════════════════

export interface ShortStoryRequest {
    title: string;
    tags: string[];
    description: string;
    targetWordCount: number;
    narrativeStructure?: string;
    writingStyle?: string;
}

export interface ShortStoryResponse {
    content: string;
    wordCount: number;
}

interface ShortStoryV2Config {
    version?: string;
    通用基础提示词?: {
        核心约束?: string;
        人设要求?: string;
        叙事要求?: string;
        AI优化参数?: string;
    };
    题材专属提示词?: {
        [key: string]: {
            description?: string;
            核心提示?: string;
            爽点悬念?: string;
            爽点?: string;
            情绪?: string;
            禁忌?: string;
        };
    };
    AI生成优化提示词?: {
        人设防崩塌?: string;
        情节防断裂?: string;
        风格统一?: string;
        结尾优化?: string;
        局部修改?: string;
    };
}

function loadShortStoryV2Config(): ShortStoryV2Config | null {
    try {
        const fp = path.join(getBaseOutputDir(), "workspace", "NOVEL_SHORT_STORY_V2_PROMPT.json");
        if (fs.existsSync(fp)) {
            const content = fs.readFileSync(fp, "utf-8");
            return JSON.parse(content);
        }
    } catch (e) {
        console.warn("[ShortStoryV2] Failed to load config:", e);
    }
    return null;
}

function getGenrePromptFromTags(tags: string[], config: ShortStoryV2Config): string {
    if (!config || !config.题材专属提示词) return "";
    
    // 页面选项值与题材的映射
    const tagToGenre: Record<string, string> = {
        "system": "轻量化爽文",
        "xianxia": "轻量化爽文",
        "urban": "轻量化爽文",
        "reborn": "轻量化爽文",
        "wuxia": "轻量化爽文",
        "game": "轻量化爽文",
        "war": "轻量化爽文",
        "romance": "情绪向短篇",
        "horror": "规则怪谈",
        "mystery": "规则怪谈",
        "scifi": "科普科幻",
        "other": "新志怪"
    };

    // 尝试根据标签值直接匹配
    for (const tag of tags) {
        const genre = tagToGenre[tag];
        if (genre && config.题材专属提示词[genre]) {
            const genreConfig = config.题材专属提示词[genre];
            return `
【${genre}题材专属要求】
- 题材说明：${genreConfig.description || ""}
- 核心提示：${genreConfig.核心提示 || ""}
- 爽点/情绪：${genreConfig.爽点悬念 || genreConfig.爽点 || genreConfig.情绪 || ""}
- 禁忌注意：${genreConfig.禁忌 || ""}
`;
        }
    }
    
    // 备用：中文关键词匹配
    const genreMap: Record<string, string[]> = {
        "新志怪": ["志怪", "怪谈", "灵异", "民间传说", "神州志异"],
        "科普科幻": ["科幻", "科普", "科学", "未来", "太空", "AI"],
        "轻量化爽文": ["爽文", "逆袭", "系统", "捡属性", "打脸", "升级", "修仙", "都市"],
        "情绪向短篇": ["甜宠", "救赎", "治愈", "温暖", "情感", "爱情", "亲情", "遗憾"],
        "规则怪谈": ["规则怪谈", "密室", "逃脱", "悬疑", "诡异", "恐怖"]
    };

    const tagStr = tags.join("").toLowerCase();
    
    for (const [genre, keywords] of Object.entries(genreMap)) {
        if (keywords.some(k => tagStr.includes(k.toLowerCase()))) {
            const genreConfig = config.题材专属提示词[genre];
            if (genreConfig) {
                return `
【${genre}题材专属要求】
- 题材说明：${genreConfig.description || ""}
- 核心提示：${genreConfig.核心提示 || ""}
- 爽点/情绪：${genreConfig.爽点悬念 || genreConfig.爽点 || genreConfig.情绪 || ""}
- 禁忌注意：${genreConfig.禁忌 || ""}
`;
            }
        }
    }
    return "";
}

function getShortStoryNarrativePrompt(structure: string): string {
    const structures: Record<string, string> = {
        standard: "标准短篇：开篇冲突→发展升级→高潮反转→结尾收束",
        fast_paced: "快节奏短篇：开篇暴击→金手指落地→连续打脸→反转结局",
        mystery: "悬疑短篇：抛出谜题→层层迷雾→真相大白→反转",
        sweet: "甜宠短篇：相遇→甜→虐→甜→圆满",
        dark: "暗黑短篇：美好撕裂→绝望→反转→震撼",
        thriller: "紧张短篇：危机逼近→绝境求生→反杀→结尾悬念",
        xinzhiguai: "新志怪短篇：日常奇事→诡异氛围→谜题展开→真相揭示/科学解释",
        kexuekehuan: "科普科幻短篇：科技谜团→科学探索→真相大白→主题升华",
        qingxuhua: "轻量化爽文：绝境开篇→金手指落地→连续打脸→反转收束",
        qingxuxiang: "情绪向短篇：情感铺垫→情绪积累→情感爆发→温暖收尾",
        guizeguitan: "规则怪谈短篇：规则揭示→规则试探→规则破解→真相揭示"
    };
    return structures[structure] || structures.standard;
}

export async function generateShortStory(req: ShortStoryRequest): Promise<ShortStoryResponse> {
    const client = await getAIClientForRole("writer");
    
    // 加载2026 V2提示词配置
    const v2Config = loadShortStoryV2Config();
    const customPrompt = loadConfig("NOVEL_SHORT_STORY_PROMPT");
    
    const narrativePrompt = getShortStoryNarrativePrompt(req.narrativeStructure || "standard");
    const styleConstraints = getNovelStyleConstraints();
    
    // 篇幅分类
    let category = "标准短篇";
    let structure = "";
    if (req.targetWordCount <= 3000) {
        category = "极短篇";
        structure = "无分章，单一线索，1个核心爽点，1个反转结尾";
    } else if (req.targetWordCount <= 10000) {
        category = "标准短篇";
        structure = "2-3章，1条暗线，2个核心爽点，1个反转";
    } else {
        category = "长篇短篇";
        structure = "3-10章，2条暗线，3个核心爽点，1-2个反转";
    }
    
    let prompt: string;
    
    // 优先使用2026 V2配置
    if (v2Config) {
        const base = v2Config.通用基础提示词 || {};
        const aiOpt = v2Config.AI生成优化提示词 || {};
        const genrePrompt = getGenrePromptFromTags(req.tags, v2Config);
        
        prompt = `你是擅长写短篇小说的网文作者，擅长2026年最新网文趋势写作。请根据以下信息，创作一篇${req.targetWordCount}字的短篇小说。

【小说信息】
标题：${req.title}
题材：${req.tags.join("、")}
核心梗概：${req.description}

【篇幅类型】
${category}（${structure}）

【叙事结构】
${narrativePrompt}

【2026核心约束】
${base.核心约束 || ""}

【人设要求】
${base.人设要求 || ""}

【叙事要求】
${base.叙事要求 || ""}

${genrePrompt}

${styleConstraints ? `【写作风格】\n${styleConstraints}\n` : ""}

【AI优化要求】
${aiOpt.人设防崩塌 || ""}
${aiOpt.情节防断裂 || ""}
${aiOpt.风格统一 || ""}
${aiOpt.结尾优化 || ""}

【输出要求】
直接输出正文，不要有任何说明、前缀、标题。
正文开头直接进入冲突场景。
目标字数：${req.targetWordCount} 字
`;
    } else if (customPrompt) {
        prompt = customPrompt
            .replace(/{{title}}/g, req.title)
            .replace(/{{tags}}/g, req.tags.join("、"))
            .replace(/{{description}}/g, req.description)
            .replace(/{{targetWordCount}}/g, req.targetWordCount.toString())
            .replace(/{{narrativeStructure}}/g, narrativePrompt)
            .replace(/{{writingStyle}}/g, styleConstraints);
    } else {
        prompt = `你是擅长写短篇小说的网文作者。请根据以下信息，创作一篇${req.targetWordCount}字的短篇小说。

【小说信息】
标题：${req.title}
题材：${req.tags.join("、")}
核心梗概：${req.description}

【篇幅类型】
${category}（${structure}）

【叙事结构】
${narrativePrompt}

${styleConstraints ? `【写作风格】\n${styleConstraints}\n` : ""}

【核心要求】

1. 开篇法则：前300字必须抛出核心冲突，主角立即陷入绝境或面临抉择
2. 节奏法则：每500字至少1个爽点或悬念，禁止连续3段无冲突
3. 结尾法则：必须有明确结局（反转/升华），禁止开放式结局
4. 篇幅分配：开篇10%、发展40%、高潮40%、结尾10%

【爽点设计】
每篇至少包含1个核心爽点（打脸/逆袭/揭秘/情感）

【伏笔与反转】
- 篇幅<5000字：1-2个伏笔
- 篇幅>5000字：2-3个伏笔，1-2个反转

【去AI味规则】
- 禁用：首先、然后、接下来、最终、于是
- 禁用：只见、但见、就在此时
- 禁用：XXX心中想到、XXX心说
- 场景描写简洁有力
- 对话要体现人物性格

【输出要求】
直接输出正文，不要有任何说明、前缀、标题。
正文开头直接进入冲突场景。
目标字数：${req.targetWordCount} 字
`;
    }
    
    try {
        const minWords = Math.floor(req.targetWordCount * 0.85);
        const maxWords = Math.floor(req.targetWordCount * 1.15);
        
        const text = await client.generateContent(prompt);
        
        // 清理输出
        const cleanContent = text
            .replace(/^【[\s\S]*?】/g, "")
            .replace(/^[\d\.\s]*字数[\s\S]*?$/gm, "")
            .replace(/^以下为生成内容[\s\S]*?$/gm, "")
            .trim();
        
        const wordCount = cleanContent.length;
        
        // 如果字数不足，补充生成
        if (wordCount < minWords) {
            const supplementPrompt = `请继续续写以下小说内容，补充约 ${minWords - wordCount} 字，使总字数达到 ${minWords}-${maxWords} 字：

${cleanContent.slice(-500)}

要求：
- 保持原有风格和剧情
- 不要偏离主线
- 结尾要有收束感`;
            
            const supplement = await client.generateContent(supplementPrompt);
            return {
                content: cleanContent + "\n\n" + supplement.trim(),
                wordCount: cleanContent.length + supplement.length
            };
        }
        
        return {
            content: cleanContent,
            wordCount
        };
    } catch (error) {
        console.error("Short Story Generate Error:", error);
        throw new Error("短篇生成失败");
    }
}

export interface ShortStoryReviseRequest {
    content: string;
    instruction: string;
    targetRange?: string;
}

export async function reviseShortStory(req: ShortStoryReviseRequest): Promise<string> {
    const client = await getAIClientForRole("writer");
    const styleConstraints = getNovelStyleConstraints();
    
    const prompt = `你是小说编辑。请根据用户指令修改以下小说内容。

【用户指令】
${req.instruction}

${req.targetRange ? `【指定修改区域】\n${req.targetRange}\n` : ""}

【原文】
${req.content}

${styleConstraints ? `【风格约束】\n${styleConstraints}\n` : ""}

【要求】
1. 仅修改指定区域，不要改动其他部分
2. 保持剧情连贯性
3. 符合原文风格

直接输出修改后的完整内容，不要有任何说明。`;
    
    try {
        const text = await client.generateContent(prompt);
        return text.trim();
    } catch (error) {
        console.error("Short Story Revise Error:", error);
        throw new Error("修改失败");
    }
}
