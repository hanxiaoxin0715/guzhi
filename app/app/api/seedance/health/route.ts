/**
 * GET /api/seedance/health
 * 健康检查
 */

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    mode: "direct-jimeng-api",
    timestamp: Date.now(),
  });
}
