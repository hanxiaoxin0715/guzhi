import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getBaseOutputDir } from "../../../lib/paths";

function getPromptsFilePath() {
    const workspaceDir = path.join(getBaseOutputDir(), "workspace");
    if (!fs.existsSync(workspaceDir)) {
        fs.mkdirSync(workspaceDir, { recursive: true });
    }
    return path.join(workspaceDir, "ai_prompts.json");
}

export async function GET() {
    try {
        const fp = getPromptsFilePath();
        if (fs.existsSync(fp)) {
            const content = fs.readFileSync(fp, "utf-8");
            return NextResponse.json(JSON.parse(content));
        }
        return NextResponse.json({});
    } catch (e) {
        return NextResponse.json({ error: "Failed to load prompts" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const fp = getPromptsFilePath();
        fs.writeFileSync(fp, JSON.stringify(body, null, 2), "utf-8");
        return NextResponse.json({ success: true });
    } catch (e) {
        return NextResponse.json({ error: "Failed to save prompts" }, { status: 500 });
    }
}
