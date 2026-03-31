# FEICAI Studio 更新日志

## 2026-03-06 — V1.97 (Windows) / V2.03 (Mac)

### 修复
- **混淆策略修复**：从激进混淆（control-flow-flattening + transform-object-keys + RC4 string-array）改为轻量级保护（identifier-names-generator hexadecimal + base64 string-array），解决客户端 UI 缺失、交互丢失、Tailwind 样式错乱等问题

### 优化
- **构建产物与源码功能 100% 一致**：Turbopack 编译已提供足够保护（变量单字母化 + 模块合并 + CSS 哈希化），额外混淆仅做标识符重命名 + 部分字符串编码，确保所有页面功能、交互逻辑完整交付

---

## 2026-03-06 — V1.96 (Windows)

### 修复
- **FC 智能体多分集 JSON 截断修复**：maxTokens 从固定 8000 改为动态计算（多分集/分集关键词时自动升至 16384），解决 5 集 30 分镜 JSON 在 EP05 中途被截断的问题
- **截断 JSON 自动修复**：`extractJsonFromReply` 新增括号计数修复逻辑，自动检测未闭合的 `{` / `[` 并补全，即使 LLM 输出被截断也能正常解析
- **EP 相似度误判修复**：Jaccard bigram 相似度阈值从 0.55 提高至 0.70，避免同一世界观下共享角色/场景的分集被误判为重复内容
- **EP 集数减少保护**：校核智能体 LLM 修复后若集数少于原始集数则拒绝修复结果，防止 LLM 合并或删除集数
- **分集推送 stale state 修复**：移除 `episodeResults.length === 0` 前置检查，解决 React 异步 setState 导致第二次及后续分集生成后推送被跳过的问题
- **FC Actions 执行后自动推送**：新增 `actionsExecuted` 标记，write_prompt、clear_cell 等操作执行后自动推送更新到生图工作台，修复修改/删除格子后画布不更新的问题

### 优化
- **校核流程 LLM 能力增强**：校核审查 callLlm 的 maxTokens 从 8000 提升至 16384，确保多分集修复时有足够输出空间

---

## 2026-03-06 — V1.95 (Windows)

### 修复
- **LLM API HTML 响应解析崩溃修复**：当外部 LLM API 返回 HTML 页面（如 API 地址配错、CDN 拦截、认证跳转）而非 JSON 时，`res.json()` 直接抛出 `Unexpected token '<'` 原始错误。现三层防护：①失败路径 HTML 检测从仅覆盖 5xx 改为所有状态码；②成功路径 `res.json()` 前检查 `Content-Type: text/html`；③`res.json()` 加 try-catch 兜底，解析失败返回前 200 字符供调试

---

## 2026-03-15 — V2.01 (Mac) / V1.94 (Windows)

### 修复
- **私有字段混淆崩溃彻底修复**：V1.93 的检测正则 `this.#[a-zA-Z]` 仅匹配 `this.#field`，但 Turbopack 压缩后变量名从 `this` 变为 `e`/`t`/`n` 等（如 `e.#a`），导致检测遗漏。现改为 `.#[a-zA-Z]`，匹配任意对象的私有字段访问。同时 SSR chunks 和 app route handlers 区块也添加了跳过检测逻辑

---

## 2026-03-15 — V2.00 (Mac) / V1.93 (Windows)

### 新增
- **设置页「角色上传预设」**：独立配置角色上传 API 地址和 Key，不再依赖视频生成模型列表中碰巧含 Sora 的条目，配置更清晰可靠

### 优化
- **角色上传配置优先级提升**：`findSoraModelConfig()` 优先读取角色上传预设（`feicai-sora-upload-config`），再回退到视频模型列表三级匹配
- **API 测试 30 秒超时**：设置页「测试连接」增加 30 秒客户端超时，避免浏览器无限转圈；超时后显示友好提示"连接超时，请检查网络或API地址是否正确"

### 修复
- **undici 私有字段混淆崩溃**：`javascript-obfuscator` 把 undici 的 ES2022 私有类字段（`this.#field`）混淆后产生 `SyntaxError: Unexpected identifier '#a'`。构建脚本新增 `this.#[a-zA-Z]` + `ProxyAgent` 检测，自动跳过含私有字段的 chunks

---

## 2026-03-15 — V1.99 (Mac) / V1.92 (Windows)

### 修复
- **page.evaluate 混淆崩溃修复**：`javascript-obfuscator` 的 `--string-array` 将 `page.evaluate` 回调内字符串替换为全局 `_0x` 数组引用，但浏览器执行环境不存在该数组导致 `ReferenceError: _0x203e64 is not defined`。构建脚本现自动检测并跳过含 `page.evaluate` 的 chunks（影响 browser-service.ts 和 jimeng-image/api.ts）
- **分镜提示词文件缺失修复**：API 路由通过 `process.cwd()/..` 读取 Gem.txt 和 claude/ 提示词文件，但 standalone 部署中 `cwd()` 上级目录无这些文件。修复：①构建脚本新增 step 6c2 将 4 个 Gem.txt + claude/ 目录捆绑到补丁中 ②prompts/route.ts、pipeline/run/route.ts、util/route.ts 三处改为双路径搜索（先 cwd() 再 cwd()/..）
- **构建脚本 cpSync 原生崩溃**：Node.js v24 在 `cpSync` 复制 claude/ 目录时触发 STATUS_STACK_BUFFER_OVERRUN (0xC0000409)，改用 `robocopy` 替代

---

## 2026-03-15 — V1.98 (Mac) / V1.91 (Windows)

### 修复
- **Sora 上传 API Key 检测修复**：`findSoraModelConfig()` 从仅匹配模型名含 "sora" 改为三级降级（sora 模型 → t8star.cn 平台 → 任意有 apiKey 的模型），解决贞贞工坊预设配置下无法上传的问题

### 同步（V1.91 功能）
- 剧本管理页面 404 修复
- Sora 角色上传系统 + 视频页角色选择解锁

---

## 2026-03-15 — V1.91

### 新增
- Sora 角色上传系统：角色库支持「一键上传 Sora」批量上传 + 单独上传按钮，经 img2char API 流水线（参考图→生成视频→提取角色）上传到贞贞工坊平台
- 平台适配器模式：UploadedCharRecord 支持多平台扩展（platform 字段），已上传角色卡片显示平台名称徽章
- 视频页 Sora 角色选择：从注释还原 Sora 角色区块，改为仅展示已上传角色，新增选择确认弹窗

### 修复
- **剧本管理页面 404**：构建脚本 `copyDirExclude` 递归传递排除列表导致 `app/scripts/`（剧本管理页面）和 `app/api/scripts/`（剧本导入 API）被错误排除。修复为排除列表仅应用于项目根目录第一层
- 角色库 `tabLabel` 变量声明顺序导致的编译错误

---

## 2026-03-15 — V1.90

### 新增
- AI 提取双语输出强制：name 字段中文、prompt 字段纯英文，全路径统一约束

### 优化
- 角色美化规则（CHAR_BEAUTY_RULES）：强制包含美化关键词
- 提示词字符上限 700 → 750
- 参考图提示词统一模块 refSheetPrompts.ts：6 个 Builder 函数 + 3 个消费文件统一引用
- 提示词编辑器 IDB 优先读取，编辑即时生效

### 修复
- 修复部分提取结果缺少英文 prompt 的问题
- RefBindPanel 参考图过滤修复
- 宽高比计算偏移修复
- PromptPickerModal 弹窗显示异常修复
- 生图 API 超时延长至 8 分钟

---

## 2026-03-12 — V1.89

### 新功能
- **自定义分镜模式**：原「智能体分镜」重命名为「自定义分镜」，支持 1-25 宫格自由设置，提示词编辑/生图/超分/下载/参考图绑定全适配
- **宫格图片撤回**：每个格子支持最多 5 级撤回历史，琥珀色「撤回」按钮悬浮在格子左上角。覆盖触发场景：重新生成、超分、编辑、上传、即梦选图
- **即梦 Image 4.0 / 4.1 模型**：新增 `image-4.0`（v40）和 `image-4.1`（v41）两个即梦生图模型选项
- **即梦任务历史磁盘持久化**：任务历史同时写入 localStorage + 磁盘（`outputs/jimeng-task-history.json`），清除浏览器缓存后自动从磁盘恢复
- **即梦选图持久化显示**：历史任务缩略图中选中的图片显示金色边框 + ✓ 标记，重开面板仍可见
- **视频预览缩略图列表 + 弹窗播放器**：生成的视频直接在页面内缩略图预览和弹窗播放
- **智能对话导出音谷 JSON 格式**：支持导出为音谷兼容的台词 JSON
- **剪映草稿导出 + 剪映导入教程引导**
- **FC 智能体专业能力增强**：系统提示词优化、知识库增强、子智能体提示词升级、组合工作流支持
- **FC 智能体分集能力**：支持 episodes 格式输出，动态意图检测自动强制分集格式
- **AI 提取支持 Agent 导入剧本**：智能体导入的剧本自动同步到剧本库（IndexedDB），提取时优先使用
- **参考图提示词统一模块**：新建 `refSheetPrompts.ts` 单一数据源，6 个 Builder 函数统一管理角色/场景/道具参考图规格表规则，3 个消费文件统一引用，消除重复维护
- **提示词编辑器实时同步**：翻译参考图、翻译宫格、AI 提取三处消费者改为 IDB 优先读取用户自定义提示词，编辑器修改即时生效无需重启

### 修复
- **动态提示词弹窗自定义模式适配**：格数/布局/存储键/图片键/描述读取全部匹配自定义宫格
- **PromptsTab 自定义宫格适配**：提示词标签页正确显示自定义格数
- **智能分镜九宫格**：smartNine 模式错误使用 4 宫格布局，改为正确调用 9 宫格提示词构建 + 3×3 裁剪
- **视频页动态提示词弹窗**：弹窗显示的提示词与实际宫格 key 不匹配，修复 episode/beat 路由逻辑
- **Seedance 分镜选择器**：分镜格描述文字未从提示词数组中提取，修复描述读取逻辑
- **动态提示词磁盘持久化**：KV 存储 + 磁盘双写，browserDB 清除后自动恢复
- **即梦悬浮按钮实时更新**：修复 `getSnapshot()` 返回同一数组引用导致 React 不触发重渲染的问题
- **即梦轮询超时**：从 5 分钟延长到 10 分钟，减少即梦 API 繁忙时的超时中断
- **FC 智能体分集格式修复**：LLM 不遵守 episodes 规则 → 交互规范强制 + 动态意图检测注入提醒
- **RefBindPanel 参考图过滤**：URL 过滤条件修复，解决部分参考图无法绑定显示的问题
- **宽高比计算偏移**：修复宽高比计算误差导致的画面比例不准确
- **PromptPickerModal 弹窗异常**：修复提示词选择弹窗显示问题
- **生图 API 超时延长至 8 分钟**：从 5 分钟延长到 8 分钟，减少大模型生图时的超时中断

### 优化
- **模式切换解锁**：各模式按钮独立显示生成状态，互不阻塞
- **视频页按钮 UI 放大**：操作更便捷
- **参考图批量翻译按钮**：一键翻译全部参考图提示词为英文
- **参考图缩略图点击放大**：支持缩略图单击预览大图
- **Seedance 提示词 ≤750 字符限制**：超限时显示计数警告
- **角色美化规则（CHAR_BEAUTY_RULES）**：角色参考图提示词强制包含美化关键词（beautiful, attractive, refined facial features），确保生成角色五官精致、符合大众审美

### AI 提取参考图提示词统一（V1.88 → V1.89）
- 标题格式统一为 `Character: / Scene: / Prop: {名}` 红色粗体
- 角色底部细节从圆形改为矩形面板 + 中文标注
- 词数限制 80-120 词（≤750 字符）
- 道具从多角度格式重构为规格参考表格式
- Phase 2 重试机制（3 次 + 指数退避）

---

## 2026-03-04 — V1.88 热更新补丁

### 新功能
- **七牛云 API 全模型集成**：LLM（44+ 模型）、图像生成（Kling/Gemini）、视频生成（ViduQ2/Sora2/Kling V2.6）
- **OpenAI 图像生成协议**：新增 `v1/images/generations` 格式，适配七牛云等专用图像接口
- **LLM API 代理**：通过 `HTTPS_PROXY` 环境变量代理访问 Google 等被墙 API
- **更新日志页面**：左侧导航新增「更新日志」入口

### 修复
- **VPN 机器码变化**：物理网卡过滤 + 多候选码兼容验证，已有激活码不受影响
- **角色库智能匹配**：支持「·」形态后缀拆分匹配、双向别名匹配、类型约束
- **清空画布合成图残留**：九宫格/四宫格/智能分镜均已修复，仅清画布不删磁盘文件

### 优化
- **即梦生图标签锁定**为「后续开发」（暂停维护）
- **火山引擎 401 错误**增加 Ark API Key 来源指引
- **错误 Toast 加宽**：支持多行 + 显示时间延长

### 打包信息
| 项目 | 值 |
|------|-----|
| Windows 补丁 | `patch-V1.88-2026-03-03T16-10-15.zip` (67.5 MB) |
| Windows SHA-256 | `9976c7d5b9da749b0335be3765ffcc610c7a89f9cff77afe7c25770a47d458e9` |
| Mac 补丁 | `mac-patch-V1.94-2026-03-03T16-19-23.zip` (59.6 MB) |
| Mac SHA-256 | `337eacb5a51794d97b162118121988d9392f0b453cfea502a366efea573e0fea` |
| 构建日期 | 2026-03-04 |
| OSS Windows | `oss://feicai-update/patches/patch-V1.88-2026-03-03T16-10-15.zip` |
| OSS Mac | `oss://feicai-update/mac/patches/mac-patch-V1.94-2026-03-03T16-19-23.zip` |

---

## 2026-03-03 — V1.87 热更新补丁

### 新功能
- **模型学习指南搜索**：模型指南页新增搜索框，支持模糊匹配筛选文生视频/图生视频/即梦/国际/国内/FAQ 全部分类
- **代码报错查询页**：新增 `/error-lookup` 页面，收录 60+ 常见错误码及解决方案
- **14 个第三方视频模型**：模型指南新增 8 个国际模型 + 6 个国内模型详细参数说明
- **即梦生图 API**：集成即梦 v50/v42 模型生图、2K/4K 分辨率、浏览器代理优先 + 直连降级

### 修复
- **侧边栏定位修复**：`sticky top-0 h-screen shrink-0`，13 个页面统一布局规范化
- **SourceImage 类型错误**：修复 `video/page.tsx` 两处 `setSourceImages` 缺少 `key` 属性

### 打包信息
| 项目 | 值 |
|------|-----|
| 补丁文件 | `patch-V1.87-2026-03-02T21-17-39.zip` |
| 大小 | 60.6 MB |
| SHA-256 | `f0220427f072019473164a18014e7e84a53039c30d91a68e0d318cda6d574d68` |
| OSS 路径 | `oss://feicai-update/patches/patch-V1.87-2026-03-02T21-17-39.zip` |

### Mac V1.92 热更新补丁
| 项目 | 值 |
|------|-----|
| 补丁文件 | `mac-patch-V1.92-2026-03-02T21-34-26.zip` |
| 大小 | 52.7 MB |
| SHA-256 | `ccca0de0c7e9b3456a017f58e087138f7f072356be789d2e166daf4a7c6a33a6` |
| OSS 路径 | `oss://feicai-update/mac/patches/mac-patch-V1.92-2026-03-02T21-34-26.zip` |

### 完整客户端包
| 平台 | 文件 | 大小 |
|------|------|------|
| Windows | `FEICAI-Studio-V1.87.exe` | 374.3 MB |
| macOS | `FEICAI-Studio-Mac-V1.92.zip` | 52.8 MB |

---

## 2026-02-17

### Bug Fix: Gemini Tab 打包遗漏

**问题**：客户反馈发行包中缺少 Gemini Tab 服务，导致 Gemini Tab 页面报错「未找到 Gemini Tab 服务」。

**根因**：
1. `build-package.mjs` 打包脚本 Step 6（组装 standalone）遗漏了 GeminiTab-dist 目录
2. `findGeminiTab()` 仅在 `process.cwd()` 的父目录搜索 GeminiTab-dist，打包后 cwd 为解压目录（`%LOCALAPPDATA%\FEICAI-Studio\app\`），GeminiTab-dist 作为子目录存在，搜索路径不匹配

**修复内容**：

| 文件 | 修改 |
|------|------|
| `FeiCai work/build-tools/build-package.mjs` | Step 6 新增 GeminiTab-dist 捆绑步骤：使用 copyDirExclude 复制（排除 browser-data/debug-screenshots/temp-uploads），清理 .map 文件，新增 recommendedDirs 验证 |
| `feicai-studio/app/api/gemini-tab/start-service/route.ts` | `findGeminiTab()` 新增 `path.join(cwd, "GeminiTab-dist")` 和 `path.join(cwd, "GeminiTab")` 搜索路径，兼容打包后目录结构 |

**打包产物**：`D:\BaiduNetdiskDownload\FeiCai work\FEICAI-Studio.exe`（93.6 MB，含 GeminiTab-dist）
