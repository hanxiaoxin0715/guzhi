import { NextResponse } from "next/server";
import { readOutputFile, deleteOutputFile } from "@/app/lib/outputs";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const content = readOutputFile(filename);
  if (!content) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  return NextResponse.json({ name: filename, content });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const ok = deleteOutputFile(filename);
  if (!ok) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
