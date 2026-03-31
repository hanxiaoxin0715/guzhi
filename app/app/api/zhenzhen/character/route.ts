/**
 * 贞贞工坊 — Sora 角色创建 API 路由
 *
 * ★ 此接口仅供 Sora 模型使用（sora-2 等）
 *
 * Sora2 角色创建: POST /sora/v1/characters
 * 角色从已生成的视频中提取（NOT 从静态图片创建）:
 *   1. 从视频 URL 创建: { timestamps: "1,3", url: "视频URL" }
 *   2. 从任务 ID 创建: { timestamps: "1,3", from_task: "任务ID" }
 *
 * 使用方式:
 *   POST /api/zhenzhen/character
 *   Body: { apiKey, baseUrl?, timestamps?, url?, fromTask? }
 *
 * 响应: { id, username, permalink, profile_picture_url }
 * 后续在提示词中用 @username 引用角色
 *
 * ⚠ 注意: 贞贞要求角色创建必须使用 sora2-vip 分组，default 分组会 401
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const DEFAULT_BASE = "https://ai.t8star.cn";

interface CharacterRequest {
  apiKey: string;
  baseUrl?: string;
  /** 时间戳范围，格式 "start,end"（秒），默认 "1,3" */
  timestamps?: string;
  /** 视频 URL（与 fromTask 二选一） */
  url?: string;
  /** 来源任务 ID（与 url 二选一） */
  fromTask?: string;
}

export async function POST(request: Request) {
  try {
    const body: CharacterRequest = await request.json();
    const { apiKey, baseUrl, url, fromTask } = body;
    const timestamps = body.timestamps || "1,3";

    if (!apiKey) {
      return NextResponse.json({ error: "缺少 apiKey" }, { status: 400 });
    }
    if (!url && !fromTask) {
      return NextResponse.json(
        { error: "缺少 url 或 fromTask（角色需从已生成的视频中提取）" },
        { status: 400 }
      );
    }

    const base = (baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
    const endpoint = `${base}/sora/v1/characters`;

    // ── 构建 JSON body（贞贞 Sora 角色 API 格式） ──
    const reqBody: Record<string, string> = { timestamps };
    if (fromTask) {
      reqBody.from_task = fromTask;
    } else if (url) {
      reqBody.url = url;
    }

    console.log(`[Character API] → POST ${endpoint}, timestamps="${timestamps}", fromTask=${!!fromTask}, url=${url ? url.slice(0, 80) : "无"}`);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(reqBody),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[Character API] 错误: ${res.status}:`, errText.slice(0, 500));

      // 特殊提示 401 分组限制
      let hint = "";
      if (res.status === 401) {
        hint = "（⚠ 贞贞角色创建需要 sora2-vip 分组，请检查 API Key 的分组设置）";
      }

      return NextResponse.json(
        { error: `角色创建失败 (${res.status}): ${errText.slice(0, 300)} ${hint}`.trim() },
        { status: res.status }
      );
    }

    const data = await res.json();
    console.log("[Character API] 响应:", JSON.stringify(data).slice(0, 500));

    // 返回标准化响应
    return NextResponse.json({
      id: data.id || "",
      username: data.username || "",
      permalink: data.permalink || "",
      profile_picture_url: data.profile_picture_url || "",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "未知错误";
    console.error(`[Character API] 异常: ${msg}`);
    return NextResponse.json({ error: `服务端错误: ${msg}` }, { status: 500 });
  }
}
