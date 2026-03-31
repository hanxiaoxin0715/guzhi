/**
 * API Route: Gemini Tab 代理
 * 
 * 将请求转发到 Gemini Tab 服务（默认 localhost:3099）
 * 避免前端直接跨域请求 Gemini Tab 服务
 * 
 * GET  /api/gemini-tab?path=/api/browser       → 转发 GET
 * POST /api/gemini-tab?path=/api/browser        → 转发 POST
 * POST /api/gemini-tab?path=/api/generate       → 转发 POST (生图)
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GEMINI_TAB_SETTINGS_KEY = "feicai-gemini-tab-settings";
const DEFAULT_SERVICE_URL = "http://localhost:3099";

/**
 * 从请求头中读取或从 query 中读取服务地址
 * 由于设置存在 localStorage（前端），API route 需要前端传递或使用默认值
 */
function getServiceUrl(req: NextRequest): string {
  const fromHeader = req.headers.get("x-gemini-tab-url");
  if (fromHeader) return fromHeader.replace(/\/$/, "");
  return DEFAULT_SERVICE_URL;
}

function getTargetPath(req: NextRequest): string {
  const { searchParams } = new URL(req.url);
  return searchParams.get("path") || "/api/browser";
}

export async function GET(req: NextRequest) {
  const serviceUrl = getServiceUrl(req);
  const targetPath = getTargetPath(req);

  // Forward query params (except 'path')
  const url = new URL(req.url);
  const forwardParams = new URLSearchParams();
  url.searchParams.forEach((v, k) => {
    if (k !== "path") forwardParams.set(k, v);
  });
  const qs = forwardParams.toString();
  const targetUrl = `${serviceUrl}${targetPath}${qs ? `?${qs}` : ""}`;

  try {
    const res = await fetch(targetUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30000),
    });
    // ★ 容错：检查响应是否为 JSON（服务启动中可能返回 HTML 错误页）
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return NextResponse.json(
        { error: `Gemini Tab 服务返回非 JSON 响应 (status=${res.status})，服务可能正在启动中` },
        { status: 502 }
      );
    }
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `无法连接 Gemini Tab 服务 (${serviceUrl}): ${msg}` },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  const serviceUrl = getServiceUrl(req);
  const targetPath = getTargetPath(req);
  const targetUrl = `${serviceUrl}${targetPath}`;

  try {
    const body = await req.text();
    // ★ 合并：既支持超时，也支持调用方断开连接时取消（polyfill，兼容低版本 Node）
    const _mc = new AbortController();
    const _to = setTimeout(() => _mc.abort("timeout"), 900000);
    req.signal.addEventListener("abort", () => _mc.abort("client-disconnect"), { once: true });
    const combinedSignal = _mc.signal;
    combinedSignal.addEventListener("abort", () => clearTimeout(_to), { once: true });
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: combinedSignal,
    });
    // ★ 容错：检查响应是否为 JSON（服务启动中可能返回 HTML 错误页）
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text().catch(() => "");
      const preview = text.slice(0, 200);
      console.warn(`[gemini-tab proxy] 上游返回非 JSON (status=${res.status}, content-type=${contentType}): ${preview}`);
      return NextResponse.json(
        { error: `Gemini Tab 服务返回非 JSON 响应 (status=${res.status})，服务可能正在启动中，请稍后重试` },
        { status: 502 }
      );
    }
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `无法连接 Gemini Tab 服务 (${serviceUrl}): ${msg}` },
      { status: 502 }
    );
  }
}
