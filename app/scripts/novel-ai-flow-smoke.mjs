const base = process.env.FEICAI_BASE_URL || "http://127.0.0.1:3001";
const projectId = process.env.FEICAI_SMOKE_PROJECT_ID || `smoke_${Date.now()}`;

async function postJson(path, body) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = json?.error || text || `${res.status}`;
    throw new Error(`${path} failed: ${msg}`);
  }
  return json;
}

async function getJson(path) {
  const res = await fetch(base + path, { method: "GET" });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = json?.error || text || `${res.status}`;
    throw new Error(`${path} failed: ${msg}`);
  }
  return json;
}

async function putJson(path, body) {
  const res = await fetch(base + path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const msg = json?.error || text || `${res.status}`;
    throw new Error(`${path} failed: ${msg}`);
  }
  return json;
}

async function main() {
  const results = [];
  const step = async (name, fn) => {
    const t0 = Date.now();
    const out = await fn();
    results.push({ name, ms: Date.now() - t0 });
    return out;
  };

  const useMock = process.env.FEICAI_SMOKE_USE_MOCK === "1";
  await step(useMock ? "Enable Mock LLM" : "Disable Mock LLM", async () => {
    if (useMock) {
      await postJson("/api/workspace-file", { key: "MOCK_LLM", value: "true" });
      await postJson("/api/workspace-file", { key: "MOCK_LLM_MODE", value: "test" });
      return true;
    }
    await postJson("/api/workspace-file", { key: "MOCK_LLM", value: "" });
    await postJson("/api/workspace-file", { key: "MOCK_LLM_MODE", value: "" });
    return false;
  });

  const cfg = await step("Config Status", async () => {
    return await getJson("/api/ai/config-status");
  });

  const concept = await step("Random Concept", async () => {
    return await postJson("/api/novel/random-concept", {});
  });

  const outline = await step("Generate Outline", async () => {
    return await postJson("/api/novel/outline", {
      title: concept?.title || "冒烟测试",
      tags: concept?.tags || ["玄幻"],
      description: concept?.description || "一个关于力量与代价的故事。",
      totalChapters: 6,
    });
  });

  await step("Init Truth Files", async () => {
    return await postJson("/api/novel/truth/status", {
      projectId,
      meta: { title: concept?.title || "冒烟测试", genre: (concept?.tags || [])[0] || "xuanhuan" },
    });
  });

  const chapterTitle = "第1章 冒烟";
  const gen = await step("Generate Chapter", async () => {
    return await postJson("/api/novel/chapter/generate", {
      projectId,
      chapterTitle,
      points: ["制造冲突", "付出代价换情报", "结尾抛出新悬念"],
      novelContext: `小说标题：${concept?.title || "冒烟测试"}`,
    });
  });

  const rewrite = await step("Rewrite Chapter", async () => {
    return await postJson("/api/novel/chapter/rewrite", {
      content: gen?.content || "测试正文",
      style: "大神级（去AI味）",
    });
  });

  await step("AI Assist", async () => {
    return await postJson("/api/novel/writing/ai-assist", {
      action: "humanize",
      content: rewrite?.content || gen?.content || "测试正文",
      context: "测试上下文",
      instruction: "减少重复词",
    });
  });

  await step("Review", async () => {
    return await postJson("/api/novel/writing/review", {
      chapterTitle,
      content: gen?.content || "测试正文",
      context: "测试上下文",
    });
  });

  await step("Hook Analysis", async () => {
    return await postJson("/api/novel/writing/hook-analysis", {
      chapterTitle,
      content: gen?.content || "测试正文",
    });
  });

  await step("Memory Extract", async () => {
    return await postJson("/api/novel/memory/extract", {
      projectId,
      chapterTitle,
      content: gen?.content || "测试正文",
    });
  });

  await step("Script Convert", async () => {
    return await postJson("/api/novel/script/convert", {
      title: `冒烟测试 - ${chapterTitle}`,
      content: gen?.content || "测试正文",
    });
  });

  const snap = await step("Manual Snapshot", async () => {
    return await postJson("/api/novel/truth/snapshot", { projectId, label: "manual_smoke" });
  });

  const snaps = await step("List Snapshots", async () => {
    return await postJson("/api/novel/truth/snapshots", { projectId });
  });

  const snapshotId = snaps?.snapshots?.[0]?.id;
  if (snapshotId) {
    await step("Restore Snapshot", async () => {
      return await putJson("/api/novel/truth/snapshots", { projectId, snapshotId });
    });

    await step("Rewrite From Snapshot", async () => {
      return await postJson("/api/novel/chapter/rewrite-from-snapshot", {
        projectId,
        snapshotId,
        chapterTitle,
        points: ["制造冲突", "付出代价换情报", "结尾抛出新悬念"],
        novelContext: `小说标题：${concept?.title || "冒烟测试"}`,
      });
    });
  }

  console.log(JSON.stringify({ base, projectId, useMock, cfg, concept, outlineOk: !!outline, snapshotDir: snap?.snapshotDir, results }, null, 2));
}

main().catch((e) => {
  console.error(e?.stack || String(e));
  process.exitCode = 1;
});
