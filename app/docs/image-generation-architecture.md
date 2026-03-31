# 图像生成架构 — 完整提示词流水线文档

> 本文档描述了 feicai-studio 中九宫格/四宫格图像生成时，从用户点击"生成"到实际提交给图像模型的完整数据流。

---

## 1. 总体架构概览

```
用户点击生成
    │
    ▼
┌─────────────────────────────┐
│  buildClean*Prompt()        │  ← 构建文本提示词（含一致性上下文）
│  consistency context + grid │
│  description + resolution   │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  参考图解析 (resolve refs)   │  ← 绑定 ID → URL / 智能匹配 fallback
│  nineGridRefIds / fourGrid  │
│  → resolveRefBindIds()      │
│  → collectMatchedRefImages()│
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  callImageApi(prompt, refs) │ ← 压缩参考图 + 组装 body
│  compress → 1024px/0.8      │
│  prompt ≤ 8000 chars + tail │
│  refs ≤ 14 images           │
└─────────────┬───────────────┘
              │  POST /api/image
              ▼
┌─────────────────────────────┐
│  Server: buildContents()    │  ← 构建 Gemini multimodal request
│  inlineData parts + text    │
│  → SSE streamGenerate       │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  返回合成图 → 裁剪/持久化     │
│  cropImageGrid(3×3 / 2×2)  │
└─────────────────────────────┘
```

---

## 2. 九宫格生成 (`generateNineGrid`)

### 2.1 文本提示词构建: `buildCleanNineGridPrompt()`

**结构:**
```
[一致性上下文 buildConsistencyContext()]
  ├── 【角色一致性要求】角色名：描述
  ├── 【场景一致性要求】场景名：描述
  ├── 【道具一致性要求】道具名：描述
  └── 【整体风格要求】画幅/分辨率/画风/色调/氛围

[九宫格描述]
  ├── 优先模式（有 **[IMG]** 标记时）:
  │     Shot 1 (top-left): <英文关键帧描述>
  │     Shot 2 (top-center): ...
  │     ... (共9格)
  │
  └── 降级模式（无 [IMG] 标记时）:
        格1：<中文叙事描述>.slice(0, 150)
        格2：...

[系统指令尾缀]
  "9 cells arranged in 3 rows × 3 columns, clear composition, 
   consistent lighting across all shots, no timecode, no subtitles."
```

### 2.2 参考图解析

**优先级链:**
1. **手动绑定（全局级）**: `nineGridRefIds.length > 0` → `resolveRefBindIds(consistency, nineGridRefIds)` → 得到当前最新 URL 列表
2. **智能匹配 fallback**: `collectMatchedReferenceImages(consistency, ninePrompts)` → 根据提示词文本匹配角色名/别名/场景名

**注意:** 九宫格生成时**不使用格级绑定**（因为是一张合成图），格级绑定仅在"重新生成单格"时生效。

### 2.3 实际提交示例

```json
{
  "apiKey": "sk-...",
  "baseUrl": "https://api.geeknow.top",
  "model": "gemini-3-pro-image-preview-4K",
  "prompt": "【角色一致性要求】...\n\nGenerate a 3×3 cinematic storyboard grid image...\nShot 1 (top-left): ...\n...\n\n[Reference images provided: 3. You MUST closely follow...]",
  "referenceImages": [
    "data:image/webp;base64,...(角色A 1024px)",
    "data:image/webp;base64,...(角色B 1024px)",
    "data:image/webp;base64,...(场景1 1024px)"
  ],
  "imageSize": "4K",
  "aspectRatio": "16:9"
}
```

---

## 3. 四宫格生成 (`generateFourGrid`)

### 3.1 文本提示词构建: `buildCleanFourGridPrompt(scenes)`

与九宫格类似，但只有4格描述:
```
[一致性上下文]

[四宫格描述]
  ├── 英文模式: Frame 1 (top-left): <英文关键帧描述>
  └── 中文降级: 左上：<叙事描述>

[尾缀] "4 frames showing continuous action/emotion sequence, 
        no timecode, no subtitles."
```

### 3.2 参考图解析

**优先级链（注意：四宫格总是前置九宫格格图片）:**
1. **前置必选:** `nineRef = gridImages[\`nine-${episode}-${beatIdx}\`]` — 当前beat对应的九宫格格图
2. **手动绑定（beat组级）:** `fourGridRefIds[beatIdx]` → `resolveRefBindIds()`
3. **智能匹配 fallback:** `collectMatchedReferenceImages(consistency, scenes)`

**最终参考图 = `[nineRef, ...manualRefs]`**

### 3.3 重要：nineRef 的作用

四宫格生成**始终**将对应的九宫格cell图片作为第一张参考图，确保四宫格展开的画面与九宫格保持视觉一致。

---

## 4. 单格重新生成 (`regenerateCell`)

### 4.1 文本提示词: `buildSingleCellPrompt(prompt)`

```
[一致性上下文]

[单格画面描述] — 英文 IMG prompt / 中文叙事 fallback

[尾缀] "Generate a high-quality cinematic storyboard frame..."
```

### 4.2 参考图解析: `resolveRefsForCell(cellKey, prompt, gridType, beatIdx?)`

**三级优先:**
1. **格级绑定:** `cellRefIds[cellKey]` → `resolveRefBindIds(consistency, ids)`
2. **全局绑定:** 九宫格用 `nineGridRefIds` / 四宫格用 `fourGridRefIds[beatIdx]` → `resolveRefBindIds()`
3. **智能匹配:** `collectMatchedReferenceImages(consistency, promptText)`

**四宫格单格重新生成额外前置:** 
```javascript
const nineRef = gridImages[`nine-${episode}-${fourBeat}`];
const refs = nineRef ? [nineRef, ...manualRefs] : manualRefs;
```

---

## 5. 超分 (`callImageApiWithRef`)

单独的 API 调用，不走 `callImageApi`:
```
prompt = UPSCALE_PROMPT (固定提示词)
referenceImages = [原图(压缩到2048px/0.9)]
```
用于将单格图片进一步提升清晰度。

---

## 6. 参考图处理管线: `callImageApi()`

```
输入: refImages (URL 数组, 最多14张)
    │
    ▼
┌─ 逐张处理 ──────────────────┐
│ data: URL → compressImage()  │  1024px / 0.8quality (WebP)
│ http  URL → 直接保留         │  (server 端再下载转base64)
│ 其他       → 跳过并 warn     │
└──────────────────────────────┘
    │
    ▼
Prompt 尾缀追加:
  "[Reference images provided: N. You MUST closely follow 
   the character appearance, costume details, scene environment, 
   and visual style shown in the reference images. 
   Maintain strict visual consistency.]"
    │
    ▼
组装 JSON body → POST /api/image
```

### Server 端 (`/api/image/route.ts`):

```
buildContents(prompt, referenceImages)
    │
    ├── data: URL → parseDataUrl() → { inlineData: { mimeType, data } }
    ├── http  URL → fetch() → arrayBuffer → base64 → inlineData
    └── text prompt → { text: finalPrompt }

结构: [{ role: "user", parts: [inlineData1, inlineData2, ..., text] }]
    │
    ▼
POST Gemini API (SSE streaming)
    → streamGenerateContent?key=...&alt=sse
    → 解析 SSE chunks → 提取 inlineData 中的生成图片
```

---

## 7. 智能匹配算法: `collectMatchedReferenceImages()`

```
输入: ConsistencyProfile, promptTexts (string | string[])

匹配逻辑 (itemMatchesPrompt):
  1. 角色: name 包含在 prompt 中 → match
  2. 角色: aliases 中任一包含在 prompt 中 → match
  3. 角色: description 关键词(≥2字) 命中 → match
  4. 场景: 同上
  5. 道具: 同上

结果: 去重的 URL 数组
```

---

## 8. 参考图绑定系统（ID-based）

### 8.1 绑定层级

| 层级 | 状态变量 | 含义 | 用途 |
|------|---------|------|------|
| 九宫格全局 | `nineGridRefIds: string[]` | 九宫格全部格共用 | `generateNineGrid()` |
| 四宫格组级 | `fourGridRefIds: Record<number, string[]>` | 每个beat组独立 | `generateFourGrid(beatIdx)` |
| 格级 | `cellRefIds: Record<string, string[]>` | 每个格独立 | `regenerateCell()` |

### 8.2 ID vs URL

**过去（URL模式，已废弃）:**
- 绑定存储 data URL → 页面切换丢失、图片替换不同步

**现在（ID模式）:**
- 绑定存储 `ConsistencyProfile` 中的 `item.id`（如角色ID、场景ID）
- 使用时调用 `resolveRefBindIds(profile, ids)` 实时解析为当前最新 URL
- 新增/替换参考图后，因为 ID 不变，缩略图和生成自动同步

### 8.3 持久化

```
StudioState (localStorage) = {
  episode, activeMode, leftTab, fourBeat, selectedCell,
  showPromptDetail, showFourPromptDetail,
  nineGridRefIds: ["char-uuid-1", "scene-uuid-2"],
  fourGridRefIds: { 0: ["char-uuid-1"], 3: ["prop-uuid-5"] },
  cellRefIds: { "nine-ep01-3": ["char-uuid-1", "char-uuid-2"] }
}
```

---

## 9. 完整参考图数据流 (一图总览)

```
用户上传参考图
    ↓
ConsistencyProfile.characters[i].referenceImage = "data:..."
    ↓  (.id 稳定不变, referenceImage 可被替换)

用户打开参考图绑定面板
    ↓
RefBindPanel 显示所有角色/场景/道具的参考图
    ↓  用户勾选 → 返回 selected IDs

handleRefBindConfirm(target, ids)
    ↓
setNineGridRefIds(ids) / setFourGridRefIds / setCellRefIds
    ↓  (自动持久化到 localStorage via saveStudioState)

生成时:
    ↓
resolveRefBindIds(consistency, ids)
    ↓  (ID → 当前最新 referenceImage URL)
    ↓
callImageApi(prompt, resolvedUrls)
    ↓
compressImage(每张 → 1024px WebP 0.8)
    ↓
POST /api/image → buildContents() → Gemini SSE
    ↓
返回生成图 → cropImageGrid → setGridImages
```
