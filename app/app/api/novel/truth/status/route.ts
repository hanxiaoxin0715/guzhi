import { NextRequest, NextResponse } from "next/server";
import { ensureTruthFiles, listTruthFiles, type TruthInitMeta } from "../../../../lib/novelTruth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const projectId = body?.projectId as string | undefined;
    const meta = (body?.meta || {}) as TruthInitMeta;
    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }
    ensureTruthFiles(projectId, meta);
    return NextResponse.json({ files: listTruthFiles(projectId) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed" }, { status: 500 });
  }
}
