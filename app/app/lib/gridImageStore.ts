/**
 * 磁盘图片存储 API — Plan C: 磁盘为真实来源
 *
 * 所有宫格图片通过 /api/grid-image 提供原始文件访问，
 * 通过 /api/local-file POST/DELETE 进行写入和删除。
 * IndexedDB 仅用于一致性参考图(cst-*)和项目归档(archive:*)。
 */

/** 构建宫格图片的显示 URL（可直接用于 <img src>）
 *  @param cacheBust 传入时间戳等参数，强制浏览器/React 重新加载（覆盖写入同 key 时必须传） */
export function gridImageUrl(key: string, cacheBust?: number): string {
  const base = `/api/grid-image?key=${encodeURIComponent(key)}`;
  return cacheBust ? `${base}&_t=${cacheBust}` : base;
}

/**
 * 从磁盘列出可用的宫格图片，返回 key → URL 映射。
 * @param filter 可选的过滤字符串（如 "ep01"），服务端匹配 key 包含该字符串
 */
export async function loadGridImageUrlsFromDisk(filter?: string): Promise<Record<string, string>> {
  try {
    const params = new URLSearchParams({ list: "1" });
    if (filter) params.set("filter", filter);
    const res = await fetch(`/api/grid-image?${params}`);
    if (!res.ok) return {};
    const { keys } = (await res.json()) as { keys: string[] };
    const result: Record<string, string> = {};
    for (const key of keys) {
      result[key] = gridImageUrl(key);
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * 批量保存图片到磁盘（串行避免连接池饱和），返回 key → URL 映射。
 * 输入值可以是 data URL 或 HTTP URL。
 */
export async function saveGridImagesToDisk(
  images: Record<string, string>,
  options?: { log?: boolean }
): Promise<Record<string, string>> {
  const log = options?.log !== false;
  const entries = Object.entries(images).filter(
    ([, v]) => v && (v.startsWith("data:") || v.startsWith("http"))
  );
  if (entries.length === 0) {
    if (log) console.warn("[saveGridToDisk] 跳过：无有效图片", Object.keys(images).length, "keys");
    return {};
  }
  if (log) console.log(`[saveGridToDisk] 开始保存 ${entries.length} 张图片到磁盘...`);

  const urlMap: Record<string, string> = {};
  let ok = 0,
    fail = 0;

  for (const [key, data] of entries) {
    const sizeMB = (data.length / 1024 / 1024).toFixed(1);
    try {
      const res = await fetch("/api/local-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "grid-images", key, data, type: "image" }),
      });
      if (res.ok) {
        const result = await res.json();
        urlMap[key] = gridImageUrl(key, Date.now());
        if (log)
          console.log(
            `[saveGridToDisk] ✓ ${key} (${sizeMB}MB → ${result.sizeKB}KB${result.skipped ? " 跳过去重" : ""})`
          );
        ok++;
      } else {
        const err = await res.text().catch(() => "");
        if (log)
          console.error(`[saveGridToDisk] ✗ ${key} (${sizeMB}MB): HTTP ${res.status} ${err.slice(0, 200)}`);
        fail++;
      }
    } catch (e) {
      if (log) console.error(`[saveGridToDisk] ✗ ${key} (${sizeMB}MB): 网络错误`, e);
      fail++;
    }
  }

  if (log)
    console.log(`[saveGridToDisk] 完成: ${ok}/${entries.length} 成功${fail > 0 ? `, ${fail} 失败` : ""}`);
  return urlMap;
}

/**
 * 保存单张图片到磁盘，返回其显示 URL。
 * 支持 data URL、HTTP URL、磁盘 URL 路径（/api/grid-image?key=xxx 会做服务端拷贝）
 */
export async function saveOneGridImageToDisk(key: string, data: string): Promise<string> {
  // 已是磁盘 URL：提取源 key，做服务端文件拷贝
  if (data.startsWith("/api/grid-image?key=")) {
    const sourceKey = new URL(data, "http://localhost").searchParams.get("key");
    if (sourceKey && sourceKey !== key) {
      try {
        const res = await fetch("/api/local-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: "grid-images", key, copyFrom: sourceKey }),
        });
        if (res.ok) return gridImageUrl(key, Date.now());
      } catch {
        /* 拷贝失败 → fallback */
      }
    }
    // 同 key 或拷贝失败 → 图片已存在磁盘
    return gridImageUrl(key, Date.now());
  }

  if (!data.startsWith("data:") && !data.startsWith("http")) return data;

  try {
    const res = await fetch("/api/local-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "grid-images", key, data, type: "image" }),
    });
    if (res.ok) return gridImageUrl(key, Date.now());
  } catch {
    /* ignore */
  }
  return "";
}

/**
 * 删除磁盘上的宫格图片
 */
export async function deleteGridImageFromDisk(key: string): Promise<void> {
  try {
    await fetch(`/api/local-file?category=grid-images&key=${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
  } catch {
    /* ignore */
  }
}
