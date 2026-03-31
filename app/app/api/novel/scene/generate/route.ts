import { NextRequest, NextResponse } from "next/server";
import { generateSceneContent } from "@/app/lib/ai/outlineGenerator";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const {
            projectId,
            novelContext,
            chapterTitle,
            sceneIndex,
            scene,
            previousSummary,
            chapterSoFar,
        } = body || {};

        if (!novelContext || !chapterTitle || typeof sceneIndex !== "number" || !scene || !scene.title) {
            return NextResponse.json({ error: "Missing novelContext/chapterTitle/sceneIndex/scene" }, { status: 400 });
        }

        const out = await generateSceneContent({
            projectId,
            novelContext,
            chapterTitle,
            sceneIndex,
            scene,
            previousSummary,
            chapterSoFar,
        });

        return NextResponse.json(out);
    } catch (error: any) {
        console.error("Scene Generate API Error:", error);
        return NextResponse.json({ error: error?.message || "场景生成失败" }, { status: 500 });
    }
}

