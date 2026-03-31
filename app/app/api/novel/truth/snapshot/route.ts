import { NextRequest, NextResponse } from "next/server";
import { createTruthSnapshot, withNovelWriteLock } from "../../../../lib/novelTruth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const projectId = body?.projectId as string | undefined;
    const label = body?.label as string | undefined;
    if (!projectId || typeof projectId !== "string") return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    const dir = await withNovelWriteLock(projectId, async () => createTruthSnapshot(projectId, label || "manual"));
    return NextResponse.json({ snapshotDir: dir });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed" }, { status: 500 });
  }
}
