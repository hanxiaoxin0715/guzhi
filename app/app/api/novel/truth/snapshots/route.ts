import { NextRequest, NextResponse } from "next/server";
import { listTruthSnapshots, restoreTruthSnapshot, withNovelWriteLock } from "../../../../lib/novelTruth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const projectId = body?.projectId as string | undefined;
    if (!projectId || typeof projectId !== "string") return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    return NextResponse.json({ snapshots: listTruthSnapshots(projectId) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const projectId = body?.projectId as string | undefined;
    const snapshotId = body?.snapshotId as string | undefined;
    if (!projectId || typeof projectId !== "string" || !snapshotId || typeof snapshotId !== "string") {
      return NextResponse.json({ error: "Missing projectId or snapshotId" }, { status: 400 });
    }
    await withNovelWriteLock(projectId, async () => {
      restoreTruthSnapshot(projectId, snapshotId);
      return null;
    });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed" }, { status: 500 });
  }
}
