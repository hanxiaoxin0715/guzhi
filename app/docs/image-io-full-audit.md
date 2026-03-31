# 飞彩工作室 — 图片读写路径全面审计

> 生成日期：2026-02  
> 目的：评估从 IndexedDB → 本地文件系统存储的迁移工作量  
> 源文件总行数：studio/page.tsx ~5635 行, video/page.tsx ~3544 行, imageDB.ts ~203 行, local-file route.ts ~340 行

---

## 0. 架构总览：当前三重写入模式

```
用户操作 / AI生成
    │
    ├─① setGridImages()        ← React 内存状态 (Record<string, string>)
    ├─② saveGridImagesDB()     ← IndexedDB 持久化 (feicai-image-store / grid-images)
    └─③ persistGridImagesToLocal() ← POST /api/local-file → 磁盘文件 (outputs/grid-images/)
```

**读取优先级**：IndexedDB → 磁盘回退（diskRecover）→ 空

---

## 1. IndexedDB 全部用法（imageDB.ts）

| 函数 | 类型 | 调用文件:行 | 说明 |
|------|------|------------|------|
| `loadGridImagesDB()` | 全量读 | studio/page.tsx 无直接调用（改用 filter 版）; video/page.tsx:424,722,1209; pipeline/page.tsx:131; projects.ts:96,176,209,276 | 读取 IDB 中所有 key→dataURL |
| `loadGridImagesByFilterDB(fn)` | 过滤读 | studio/page.tsx:1333（cst-前缀）, 1472（当前集数）; seedance/page.tsx:189（非cst非composite） | 游标过滤，避免反序列全量数据 |
| `saveGridImagesDB(map)` | 批量写 | studio/page.tsx:1520（磁盘恢复回写）, 2730, 2802, 2891（九/四宫格生成）; projects.ts:107,188; consistency.ts:572 | 合并写入多条 |
| `saveGridImageDB(key,val)` | 单条写 | studio/page.tsx:2928,2995,3175,3217（重生成/超分/编辑/上传）; video/page.tsx:1825,1835,1862,2650,2701,2723,2724 | 写入单条 |
| `deleteGridImageDB(key)` | 删除 | studio/page.tsx:3729,3741（删除参考图）; video/page.tsx:1815,1850,2518,2760; projects.ts:217,282 | 删单条 |
| `clearGridImagesDB()` | 清空 | projects.ts:15（仅 import，未直接调用，改用逐条删除） | 清空整个 store |
| `migrateFromLocalStorage()` | 迁移 | studio/page.tsx:1323（初始化时一次性） | localStorage → IDB |

**小计**：6 个 API 函数，**34 个调用点**分布在 5 个文件中。

---

## 2. gridImages React 状态全部用法

### 2.1 状态声明

| 文件:行 | 类型 | 说明 |
|---------|------|------|
| studio/page.tsx:1038 | `Record<string, string>` | key→dataURL，key 格式如 `nine-ep01-0`, `four-ep01-2-1`, `nine-composite-ep01`, `cst-ref-xxx` |
| video/page.tsx:405 | `{key,url,label}[]` | 不同结构！数组形式，仅用于图片选择器 |

### 2.2 setGridImages 写入点（studio/page.tsx）

| 行号 | 场景 | 触发条件 |
|------|------|----------|
| 1385 | grid-op-update 事件监听 | 后台闭包通知新图片 |
| 1454 | 集数切换 — 内存驱逐 | episode 变更时只保留当前集图片 |
| 1478 | 集数切换 — IDB 异步加载 | loadGridImagesByFilterDB 结果合并 |
| 1522 | 磁盘恢复 — 合并到状态 | diskRecover 成功后 |
| 2729 | 九宫格生成完成 | composite + 9 cells |
| 2791 | 合成图上传（九宫格） | 用户上传自定义合成图 |
| 2880 | 四宫格生成完成 | composite + 4 cells |
| 2923 | 单格重新生成 | regenerateCell |
| 2990 | 单格超分 | upscaleCell |
| 3174 | 图片编辑 | editImage 完成 |
| 3216 | 上传替换 | handleUploadCellImage |

**共 12 个 setGridImages 调用**，全部在 studio/page.tsx 中。

### 2.3 gridImages[key] 读取点（studio/page.tsx，选取关键场景）

| 行号范围 | 读取目的 |
|----------|----------|
| 4758 | Motion Prompt 面板 — 获取格图渲染 |
| 5198 | 九宫格面板 — gridImages[key] 获取每格 URL |
| 5481-5509 | 四宫格面板 — gridImages[key] |
| 3810-3831 | 宫格单格预览弹窗数据 |
| 3058-3080 | editImage 取原图 |
| 2947 | upscaleCell 取原图 |
| 2825 | 四宫格 buildPrompt 拿垫图 |

**共 ~27 个读取位置**。

---

## 3. `<img src={...}>` 渲染点 — 使用 gridImages 数据

| 文件:行 | 场景 | src 来源 |
|---------|------|----------|
| studio/page.tsx:4766 | Motion Prompt 面板格子图片 | `gridImages[imgKey]` |
| studio/page.tsx:5186 | 九宫格合成图预览 | `gridImages["nine-composite-" + episode]` |
| studio/page.tsx:5218 | 九宫格 3×3 每格图片 | `gridImages["nine-" + episode + "-" + idx]` |
| studio/page.tsx:5458 | 四宫格垫图显示 | `gridImages["nine-" + episode + "-" + fourBeat]` |
| studio/page.tsx:5471 | 四宫格合成图预览 | `gridImages["four-composite-" + episode + "-" + beatIdx]` |
| studio/page.tsx:5509 | 四宫格 2×2 每格图片 | `gridImages["four-" + episode + "-" + beat + "-" + idx]` |
| studio/page.tsx:899 | 图片放大预览弹窗 | 传入的 src（来自 gridImages 或 consistency） |
| studio/page.tsx:3929 | 风格参考图缩略图 | `consistency.style.styleImage` |
| studio/page.tsx:4894,4926 | 参考图列表 | `item.referenceImage`（从 IDB cst- 键恢复） |

**共 11 个 `<img>` 渲染位置**，src 全部来自内存中的 data URL 或 HTTP URL。

---

## 4. `/api/local-file` 路由全部调用点

### 4.1 路由定义（app/api/local-file/route.ts）

| HTTP 方法 | 功能 | 数据格式 |
|-----------|------|----------|
| **POST** | 保存文件到磁盘 | Body: `{category, key, data, type}`, data = base64 dataURL 或 HTTP URL |
| **GET** `?key=` | 读取单文件 → dataURL | 返回 `{data: "data:image/png;base64,..."}` |
| **GET** `?keys=a,b,c` | 批量读取 → dataURL map | 返回 `{images: {key: dataUrl}}` |
| **GET** `?category=` | 列出分类目录文件 | 返回 `{files: [{name,key,size,modified}]}` |
| **DELETE** `?key=` | 删除单文件 | |
| **DELETE** `?category=` | 清空整个分类目录 | |

支持的 category：`grid-images`, `videos`, `ref-images`, `video-frames`

### 4.2 调用点汇总

| 文件:行 | 方法 | category | 方向 | 场景 |
|---------|------|----------|------|------|
| studio/page.tsx:629 | POST | grid-images | 写 | `persistGridImagesToLocal` — 每次图片变更后异步串行写盘 |
| studio/page.tsx:1508 | GET (batch) | grid-images | 读 | `diskRecover` — IDB 缺失时从磁盘恢复 |
| seedance/page.tsx:390 | POST | videos | 写 | Seedance 视频生成完成后自动保存 |
| video/page.tsx:30 | import | - | - | 仅用于类型 |
| video/page.tsx:342,354 | POST/GET | videos | 写/读 | 视频卡片保存/加载 |
| video/page.tsx:1392-1401 | POST | videos | 写 | 下载视频到磁盘 |
| video/page.tsx:1517-1546 | POST | video-frames | 写 | 视频帧截图保存 |
| video/page.tsx:1639-1647 | GET | video-frames | 读 | 缩略图加载 |
| projects.ts:256-258 | DELETE | grid-images,videos,video-frames | 删 | `clearCurrentWorkspace` 清理三个目录 |

**共 ~15 个 API 调用点**。

### 4.3 静态文件服务路由（app/api/local-file/[...path]/route.ts）

提供 `outputs/{category}/{filename}` 的直接二进制访问，如：
- `/api/local-file/grid-images/nine-ep01-0` → `outputs/grid-images/nine-ep01-0.png`
- `/api/local-file/videos/seedance-xxx` → `outputs/videos/seedance-xxx.mp4`

---

## 5. persistGridImagesToLocal 函数详解

**定义**：studio/page.tsx:614-652

```typescript
function persistGridImagesToLocal(images: Record<string, string>) {
  // 过滤：仅保存 data: 开头的图片（跳过 HTTP URL、空值）
  // 串行 POST /api/local-file，每张一个请求
  // 去重机制：服务端对比文件内容，相同则跳过
}
```

**调用点**（全部在 studio/page.tsx）：

| 行号 | 场景 | 写入内容 |
|------|------|----------|
| 2731 | 九宫格生成 | composite + 9 cells（最多 10 张） |
| 2803 | 合成图上传裁剪 | composite + N cells |
| 2892 | 四宫格生成 | composite + 4 cells（最多 5 张） |
| 2929 | 单格重新生成 | 1 张 |
| 2996 | 单格超分 | 1 张 |
| 3176 | 图片编辑 | 1 张 |
| 3218 | 上传替换 | 1 张 |

**特点**：
- Fire-and-forget（不 await），不影响 UI 响应
- 串行发送避免连接池饱和
- 服务端有去重（`findDuplicateInDir`，按文件大小+内容比对）

---

## 6. 磁盘恢复机制（diskRecover）

**位置**：studio/page.tsx:1488-1535（episode 切换 effect 内）

```
流程：
1. 构建当前集数的所有 expectedKeys（9格+合成+36四宫格格+9合成 = 55 keys）
2. 过滤出 IDB 中不存在的 missingKeys
3. 分批（每批 30 keys）GET /api/local-file?category=grid-images&keys=...
4. 服务端读取磁盘文件 → 转 base64 data URL 返回
5. 恢复到 IDB（saveGridImagesDB）
6. 合并到 React 状态（setGridImages merge）
```

**注意**：此恢复仅在 studio 页面的 `[episode]` effect 中触发。  
video/page.tsx 注释了磁盘回退逻辑（"不再从磁盘回退加载 — 仅显示 IndexedDB 中的图片"）。

---

## 7. 内存管理模式

### 7.1 集数切换驱逐
- **位置**：studio/page.tsx:1445-1460
- **策略**：episode 变更时，`setGridImages` 内同步过滤，只保留包含当前集数前缀的 key
- **目的**：防止 7 集 × 55 张图全部驻留内存（每张 ~1-3MB data URL）

### 7.2 按需加载
- studio: `loadGridImagesByFilterDB` 仅加载当前集 + cst- 前缀
- video: `loadGridImagesDB` 全量加载（用于图片选择器）
- seedance: `loadGridImagesByFilterDB` 过滤非合成图

### 7.3 内存峰值估算
- 单集最多：9（九宫格）+ 1（composite）+ 9×4（四宫格）+ 9（composite）= 55 张
- 每张 ~1-3MB data URL → 单集 ~55-165MB 内存占用
- 加上 cst- 参考图（角色/场景/道具，通常 <20 张）→ 最高 ~200MB

---

## 8. 跨页面共享分析

### 8.1 共享存储层（IndexedDB `feicai-image-store`）

| 页面 | 读操作 | 写操作 | 删操作 |
|------|--------|--------|--------|
| **studio** | loadGridImagesByFilterDB ×2 | saveGridImagesDB ×4, saveGridImageDB ×4 | deleteGridImageDB ×2 |
| **video** | loadGridImagesDB ×3 | saveGridImageDB ×5 | deleteGridImageDB ×4 |
| **seedance** | loadGridImagesByFilterDB ×1 | 无 | 无 |
| **pipeline** | loadGridImagesDB ×1 | 无 | 无 |
| **projects.ts** | loadGridImagesDB ×4 | saveGridImagesDB ×2 | deleteGridImageDB ×批量 |
| **consistency.ts** | 无直接 | saveGridImagesDB ×1 | deleteGridImageDB ×批量 |

### 8.2 数据流方向

```
studio  ──写入──→  IndexedDB  ←──读取──  video / seedance / pipeline
   │                  ↑
   └──写入──→ 磁盘 ──恢复──→ IndexedDB（diskRecover）
                      ↑
               projects.ts 归档/恢复
```

### 8.3 不同页面的 gridImages 类型差异

| 页面 | 类型 | 问题 |
|------|------|------|
| studio | `Record<string, string>` | key→dataURL 映射 |
| video | `{key, url, label}[]` | 数组结构，含显示标签 |

迁移时需注意 video 页面的重新适配。

---

## 9. 一致性参考图的特殊路径

一致性参考图（角色、场景、道具）使用 `cst-ref-{itemId}` 作为 key，存储在同一个 IndexedDB store 中，但有**额外**的服务端备份路径：

| 操作 | IDB | 磁盘 |
|------|-----|------|
| 保存 | `saveGridImagesDB({"cst-ref-xxx": dataUrl})` | `persistRefImage(itemId, dataUrl)` → POST /api/ref-image |
| 恢复 | `loadGridImagesByFilterDB(k => k.startsWith("cst-"))` | `restoreRefImagesFromServer()` → GET /api/ref-image |
| 删除 | `deleteGridImageDB("cst-ref-xxx")` | DELETE /api/ref-image?key=xxx |

注意：cst- 图片走的是 `/api/ref-image` 而非 `/api/local-file`，是一个独立的 API 路由。

---

## 10. 迁移评估：IndexedDB → 全本地文件系统

### 10.1 需要修改的文件

| 文件 | 改动量 | 说明 |
|------|--------|------|
| `app/lib/imageDB.ts` | **重写** | 所有 6 个函数改为调用 `/api/local-file` |
| `app/studio/page.tsx` | **中等** | 移除 persistGridImagesToLocal（不再需要双写）；diskRecover 变为主读取路径；内存驱逐逻辑保留 |
| `app/video/page.tsx` | **轻** | loadGridImagesDB → 改为 API 调用 |
| `app/seedance/page.tsx` | **轻** | loadGridImagesByFilterDB → 改为 API 调用 |
| `app/pipeline/page.tsx` | **轻** | loadGridImagesDB → 改为 API 调用 |
| `app/lib/projects.ts` | **中等** | 归档/恢复逻辑需重新设计（当前基于 IDB key 前缀） |
| `app/lib/consistency.ts` | **轻** | saveConsistencyImages / 恢复改为 API |
| `app/api/local-file/route.ts` | **扩展** | 可能需要增加过滤读取、批量删除等 API |

### 10.2 核心挑战

1. **延迟问题**：IDB 读写 ~1-5ms，HTTP API 读写 ~20-100ms。频繁小操作（如 video 页面拖拽排序连续 saveGridImageDB）会变慢。
2. **内存占用不变**：即使去掉 IDB，`gridImages` 状态仍然持有 data URL 在内存中。真正减少内存需改为 URL 引用（如 `/api/local-file/grid-images/nine-ep01-0`）。
3. **data URL → HTTP URL 渲染变更**：所有 `<img src={dataUrl}>` 需改为 `<img src="/api/local-file/grid-images/xxx">`，11 个渲染点全部需要修改。
4. **项目归档**：当前基于 IDB key 前缀 `archive:projectId:` 的归档机制需要改为文件系统目录结构。
5. **离线可用性**：IDB 在浏览器关闭后仍可用；纯文件系统依赖 Next.js dev server 运行。

### 10.3 推荐迁移策略

**方案 A：IDB 作为缓存层，文件系统作为真实来源（推荐）**
- 保留 IDB 做读取缓存（快速渲染）
- 写入时：先写 API（真实来源），成功后更新 IDB 缓存
- 移除 `persistGridImagesToLocal`（不再是"额外备份"而是主存储）
- 改动量：中等，无需改 `<img>` 渲染

**方案 B：完全去掉 IDB，所有读写走 API**
- imageDB.ts 6 个函数改为 fetch 调用
- 需要服务端增加过滤能力（当前 GET 只支持精确 key 或全量 list）
- 改动量：大，需要解决延迟和批量操作问题

**方案 C：去掉 IDB + 去掉内存 dataURL，改用 HTTP URL 引用**
- 最彻底：`<img src="/api/local-file/grid-images/xxx">` 而非 data URL
- 内存占用从 ~200MB 降到 ~几KB（仅存 URL 字符串）
- 改动量：最大（所有渲染、裁剪、压缩逻辑需适配）
- 收益：最大（内存、启动速度、浏览器稳定性）

---

## 附录：Key 命名规范

| 前缀 | 格式 | 说明 |
|------|------|------|
| `nine-` | `nine-{ep}-{0-8}` | 九宫格单格 |
| `nine-composite-` | `nine-composite-{ep}` | 九宫格合成原图 |
| `four-` | `four-{ep}-{beat}-{0-3}` | 四宫格单格 |
| `four-composite-` | `four-composite-{ep}-{beat}` | 四宫格合成图 |
| `cst-ref-` | `cst-ref-{itemId}` | 一致性参考图 |
| `archive:` | `archive:{projectId}:{originalKey}` | 归档快照 |
