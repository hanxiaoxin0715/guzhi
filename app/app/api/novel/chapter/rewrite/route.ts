import { NextRequest, NextResponse } from "next/server";
import { rewriteChapterContent, getAIClientForRole } from "../../../../lib/ai/outlineGenerator";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { content, style, action, targetWordCount } = body;

        if (!content) {
            return NextResponse.json({ error: "Missing content" }, { status: 400 });
        }

        // 续写功能
        if (action === "continue") {
            if (!targetWordCount) {
                return NextResponse.json({ error: "Missing targetWordCount" }, { status: 400 });
            }

            const minWords = Math.floor(targetWordCount * 0.8);
            const maxWords = Math.floor(targetWordCount * 1.3);

            const prompt = `你是一位擅长连载的网文作者。当前章节内容如下，请在结尾处继续续写，保持相同的风格和叙事节奏。

【当前章节结尾（请以此为基础续写）】
${content.slice(-2000)}

【续写要求】
1. 保持前文的风格、人物性格和叙事节奏
2. 继续当前的剧情线，不要突然转折
3. 目标续写 ${minWords}-${maxWords} 字
4. 内容要有信息密度，避免水文
5. 结尾要设置悬念或钩子，吸引读者继续阅读
6. 直接输出续写内容，不要前缀或解释

续写内容：
`;

            const client = await getAIClientForRole("writer");
            const continued = await client.generateContent(prompt);
            return NextResponse.json({ content: continued.trim() });
        }

        // 原来的重写功能
        if (!style) {
            return NextResponse.json({ error: "Missing style" }, { status: 400 });
        }

        const rewritten = await rewriteChapterContent({ content, style });
        return NextResponse.json({ content: rewritten });
    } catch (error: any) {
        console.error("Rewrite API Error:", error);
        return NextResponse.json({ error: error.message || "Operation failed" }, { status: 500 });
    }
}
