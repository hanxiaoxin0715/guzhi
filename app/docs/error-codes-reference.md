# feicai-studio 错误码与错误处理完整参考

> 自动生成于 2026-03-03，覆盖全部源代码模块

---

## 目录

1. [即梦 API 错误码（ret / fail_code / status）](#1-即梦-api-错误码)
2. [HTTP 状态码（API Routes）](#2-http-状态码api-routes)
3. [图像 API 错误（/api/image）](#3-图像-api-错误)
4. [视频 API 错误（/api/video/generate）](#4-视频-api-错误)
5. [LLM API 错误（/api/llm）](#5-llm-api-错误)
6. [Seedance 视频生成错误](#6-seedance-视频生成错误)
7. [即梦生图错误（jimeng-image）](#7-即梦生图错误)
8. [浏览器代理 / Playwright 错误](#8-浏览器代理--playwright-错误)
9. [分镜流水线错误（pipeline）](#9-分镜流水线错误)
10. [两阶段提取错误（twoPhaseExtract）](#10-两阶段提取错误)
11. [AI 提示词生成错误（seedance/ai-prompt）](#11-ai-提示词生成错误)
12. [生图工作台 UI 错误（studio）](#12-生图工作台-ui-错误)
13. [图生视频工作台 UI 错误（video）](#13-图生视频工作台-ui-错误)
14. [即梦生图页 UI 错误（jimeng）](#14-即梦生图页-ui-错误)
15. [其他 API Routes 错误](#15-其他-api-routes-错误)

---

## 1. 即梦 API 错误码

### 1.1 ret 码（业务返回码）

| ret 码 | 含义 | 错误消息 | 来源文件 |
|--------|------|----------|----------|
| `"0"` | 成功 | — | jimeng-api.ts, api.ts |
| `"1000"` | 请求被拒绝 / 无效参数 | `即梦API错误 (ret=1000): ...` | jimeng-api.ts:854, api.ts:938 |
| `"1002"` | 通用错误 | `即梦API错误 (ret=1002): ...` | 日志: jimeng-image-log.txt |
| `"1015"` | 登录错误 | `即梦API错误 (ret=1015): ...` | 日志: jimeng-image-log.txt |
| `"3018"` | 权限拒绝（Cookie 无效/不完整） | `即梦权限拒绝 (ret=3018)。可能原因：1) Cookie 已过期...` | api.ts:890-936 |
| `"5000"` | 积分不足 | `即梦积分不足，请前往即梦官网领取积分` | jimeng-api.ts:196,853; api.ts:276,933 |

### 1.2 fail_code（生成失败码，status=30 时）

| fail_code | 含义 | 错误消息 | 来源 |
|-----------|------|----------|------|
| `2038` | 安全审核过滤（视频） | `内容被过滤，请修改提示词后重试` | jimeng-api.ts:903 |
| `2038` | 安全审核过滤（图片） | `内容被安全审核过滤，请修改提示词后重试` | api.ts:993-994 |
| `4011` | 图片安全审核失败 | `图片未通过安全审核（错误码4011），请调整生成参数或提示词` | api.ts:995-996 |
| 其他 | 通用生成失败 | `视频生成失败，错误码: ${failCode}` / `图片生成失败，错误码: ${failCode}` | jimeng-api.ts:906, api.ts:997 |

### 1.3 status 码（轮询状态码）

| status | 含义 | 处理逻辑 |
|--------|------|----------|
| `20` | 排队中 | 继续轮询；超时抛异常 |
| `42` | 处理中 | 继续轮询 |
| `50` | 成功 | 退出轮询，提取结果 |
| `30` | 失败 | 抛异常，携带 fail_code |

### 1.4 UriStatus（上传状态码）

| UriStatus | 含义 | 错误消息 |
|-----------|------|----------|
| `2000` | 上传成功 | — |
| 其他 | 上传异常 | `图片上传状态异常: UriStatus=${result.UriStatus}` |

---

## 2. HTTP 状态码（API Routes）

| 状态码 | 含义 | 使用位置 | 典型错误消息 |
|--------|------|----------|-------------|
| **400** | 请求参数错误 | 几乎所有路由 | `prompt is required`, `缺少必要参数`, `请求格式错误` |
| **401** | 认证失败 | seedance/generate, llm | `请完整填写 sessionId...`, `API Key 无效或已过期` |
| **403** | 权限禁止 | video-proxy | `不允许的视频来源域名` |
| **404** | 资源不存在 | jimeng-image, ref-image, outputs, util | `Task not found`, `File not found`, `Image not found` |
| **408** | 请求超时 | video/generate | `Gemini 视频生成超时（10分钟）` |
| **413** | 请求体过大 | seedance/generate | `文件「xxx」超过 ${sizeLimit}MB` |
| **422** | 无法处理 | video/generate, style-analyze | `模型返回空内容`, `无法解析风格分析JSON` |
| **429** | 频率限制 | image | `图像 API 频率限制 (429)，请稍后重试` |
| **502** | 网关错误 | image, llm, gemini-tab, style-analyze, ai-prompt | `图像生成失败（已重试3次）`, `LLM API 网关错误` |
| **500** | 服务端错误 | 通用 catch | `服务端错误: ${msg}` |

---

## 3. 图像 API 错误（/api/image）

**文件**: `app/api/image/route.ts`

### 3.1 参数校验

| 错误消息 | 状态码 |
|----------|--------|
| `缺少必要参数: apiKey, model, prompt` | 400 |
| `缺少图像 API 地址 (baseUrl)，请在设置页配置` | 400 |

### 3.2 API 调用错误（含 3 次重试）

| 错误消息模板 | 状态码 | 触发条件 |
|-------------|--------|----------|
| `API Key 无效或已过期 (${status})。${detail}` | 502 | HTTP 401/403 |
| `模型或接口不存在 (404)，请检查模型名称 "${model}" 和 Base URL` | 502 | HTTP 404 |
| `图像 API 频率限制 (429)，请稍后重试` | 502 | HTTP 429 |
| `图像 API 频率限制或额度不足 (429)，请稍后重试` | 502 | HTTP 429（响应/聊天模式） |
| `图像 API 网关超时 (${status})` | 502 | HTTP 504 |
| `图像 API 网关错误 (${status})，API代理服务的CDN暂时不可用` | 502 | HTML 错误响应 >= 500 |
| `请求体过大 (${MB}MB)，请减少参考图数量或降低图片质量` | 502 | HTTP 413 |
| `图像 API 错误 (${status}): ${detail}` | 502 | 其他 HTTP 错误 |
| `API 返回空内容` | — | 响应为空 |
| `图像生成失败（已重试3次）: ${lastError}` | 502 | 3 次重试全部失败 |
| `图像请求错误: ${msg}` | 500 | 未捕获异常 |

### 3.3 流式错误

| 错误消息 | 触发条件 |
|----------|----------|
| `No response body for streaming` | 流式响应无 body |

---

## 4. 视频 API 错误（/api/video/generate）

**文件**: `app/api/video/generate/route.ts`

### 4.1 参数校验

| 错误消息 | 状态码 |
|----------|--------|
| `缺少必要参数: apiKey, model` | 400 |
| `缺少输入图片` | 400 |

### 4.2 连接测试

| 错误消息模板 | 状态码 | 触发条件 |
|-------------|--------|----------|
| `API Key 认证失败 (${status}): ${detail}` | 原始状态码 | HTTP 401/403 |
| `服务端错误 (${status}): ${detail}` | 原始状态码 | HTTP 5xx |
| `网络连接失败: ${msg}` | 500 | fetch 异常 |

### 4.3 第三方视频路径

| 错误消息模板 | 状态码 |
|-------------|--------|
| `第三方视频 API 错误 (${status}): ${detail}` | 502 |
| `任务失败`（轮询 status=failed/error/cancelled） | 422 |
| `第三方视频生成超时（10分钟），请在API平台查看` | 422 |
| `第三方视频 API 未返回标准格式` | 422 |

### 4.4 Gemini 视频路径

| 错误消息模板 | 状态码 |
|-------------|--------|
| `Gemini 视频 API 错误 (${status}): ${detail}` | 502 |
| `Gemini 视频生成失败: ${error.message}` | 422 |
| `Gemini 视频生成超时（10分钟），请稍后在 Google AI Studio 查看结果` | 408 |
| `Gemini 视频未返回视频结果` | 422 |

### 4.5 官方 Chat 路径

| 错误消息模板 | 状态码 |
|-------------|--------|
| `Chat API 错误 (${status}): ${detail}` | 502 |
| `API 返回非 JSON 格式，无法解析` | 502 |
| `Chat API 未返回可用视频` | 422 |

### 4.6 通用

| 错误消息模板 | 状态码 |
|-------------|--------|
| `服务端错误: ${msg}` | 500 |

---

## 5. LLM API 错误（/api/llm）

**文件**: `app/api/llm/route.ts`

| 错误消息模板 | 状态码 | 触发条件 |
|-------------|--------|----------|
| `LLM API 网关错误 (${status})，API代理服务（${host}）的CDN暂时不可用。建议：切换到国内直连API预设` | 502 | HTML 错误 + status >= 500 |
| `火山引擎 API 认证失败 (401)。请确认：1. API Key 来自「火山方舟控制台→API Key管理」...` | 401 | volces.com/volcengine.com + 401 |
| `LLM API 错误 (${status}): ${text}` | 原始状态码 | 其他 HTTP 错误 |
| `LLM API 错误: 重试3次后仍然失败` | 502 | 3 次均失败 |
| `无法连接 Google API 服务器 (generativelanguage.googleapis.com)。${proxyHint}` | 500 | Google API fetch 失败 |

**代理提示逻辑**:
- 有代理: `已检测到代理 ${url} 但仍无法连接，请检查代理是否正常工作`
- 无代理: `Node.js 不会自动使用系统代理。解决方案：1. VPN 开启 TUN/全局模式 2. 或设置 HTTPS_PROXY 环境变量 3. 或切换为国内中转 API`

---

## 6. Seedance 视频生成错误

### 6.1 API 路由（/api/seedance/generate）

**文件**: `app/api/seedance/generate/route.ts`

| 错误消息 | 状态码 |
|----------|--------|
| `请求格式错误，需要 multipart/form-data` | 400 |
| `请完整填写 sessionId、_tea_web_id 和 uid_tt` | 401 |
| `需要至少上传一张参考图片` | 400 |
| `最多上传 9 个参考文件` | 400 |
| `文件「${name}」超过 ${limit}MB（${type}限制）` | 413 |
| `视频生成失败` / `err.message` | 500（异步任务） |
| `服务器内部错误` / `err.message` | 500 |

### 6.2 任务轮询（/api/seedance/task/[taskId]）

**文件**: `app/api/seedance/task/[taskId]/route.ts`

| 错误消息 | 状态码 |
|----------|--------|
| `任务不存在` | 404 |

### 6.3 视频代理（/api/seedance/video-proxy）

**文件**: `app/api/seedance/video-proxy/route.ts`

| 错误消息 | 状态码 |
|----------|--------|
| `缺少 url 参数` | 400 |
| `不允许的视频来源域名` | 403 |
| `无效的 URL` | 400 |
| `视频代理失败` | 500 |

### 6.4 核心生成逻辑（jimeng-api.ts）

**文件**: `app/lib/seedance/jimeng-api.ts`

| 错误消息 | 触发条件 |
|----------|----------|
| `即梦积分不足，请前往即梦官网领取积分` | ret="5000" |
| `即梦API请求失败: ${uri}` | 3 次重试全部失败 |
| `获取上传令牌失败` | imageToken 为空 |
| `申请上传权限失败: ${status}` | HTTP 非 200 |
| `获取上传地址失败` | 响应缺少上传地址 |
| `图片上传失败: ${status}` | HTTP 非 200 |
| `提交上传失败: ${status}` | HTTP 非 200 |
| `提交上传响应缺少结果` | results 为空 |
| `图片上传状态异常: UriStatus=${status}` | UriStatus ≠ 2000 |
| `任务不存在` | 任务 ID 未找到 |
| `即梦API错误 (ret=${code}): ${msg}` | ret ≠ "0" |
| `未获取到记录ID` | historyId 为空 |
| `内容被过滤，请修改提示词后重试` | status=30 + fail_code=2038 |
| `视频生成失败，错误码: ${failCode}` | status=30 + 其他 fail_code |
| `视频生成超时 (约20分钟)，请稍后重试` | 轮询超限 + status 仍为 20 |
| `未能获取视频URL` | videoUrl 为空 |

---

## 7. 即梦生图错误（jimeng-image）

### 7.1 核心 API（api.ts）

**文件**: `app/lib/jimeng-image/api.ts`

| 错误消息 | 触发条件 |
|----------|----------|
| `即梦积分不足，请前往即梦官网领取积分` | ret="5000" |
| `即梦API请求失败: ${uri}` | 3 次重试全部失败 |
| `获取上传令牌失败` | imageToken 为空 |
| `申请上传权限失败: ${status}` | HTTP 非 200 |
| `获取上传地址失败` | 响应缺少上传地址 |
| `图片上传失败: ${status}` | HTTP 非 200 |
| `提交上传失败: ${status}` | HTTP 非 200 |
| `提交上传响应缺少结果` | results 为空 |
| `图片上传状态异常: UriStatus=${status}` | UriStatus ≠ 2000 |
| `任务不存在` | 任务 ID 未找到 |
| `browser_3018`（内部标记） | 浏览器代理返回 3018 |
| `即梦权限拒绝 (ret=3018)。可能原因：1) Cookie 已过期或不完整...` | 3018 降级后仍失败 |
| `即梦请求失败: 浏览器代理(${err}) + 直连(${err})` | 双路径均失败 |
| `即梦API错误 (ret=${code}): ${msg}` | ret ≠ "0" |
| `未获取到记录ID` | historyId 为空 |
| `内容被安全审核过滤，请修改提示词后重试` | status=30 + fail_code=2038 |
| `图片未通过安全审核（错误码4011），请调整生成参数或提示词` | status=30 + fail_code=4011 |
| `图片生成失败，错误码: ${failCode}` | status=30 + 其他 fail_code |
| `图片生成超时或未完成 (最终status=${status})，请稍后重试` | 轮询超限 + status ≠ 50 |

### 7.2 客户端任务存储（clientTaskStore.ts）

**文件**: `app/lib/jimeng-image/clientTaskStore.ts`

| 错误消息 | 触发条件 |
|----------|----------|
| `生成超时（5分钟）` | 5 分钟后未完成 |

### 7.3 API 路由（/api/jimeng-image）

**文件**: `app/api/jimeng-image/route.ts`

| 错误消息 | 状态码 |
|----------|--------|
| `Missing key or list parameter` | 400 |
| `prompt is required` | 400 |
| `请先在设置页配置即梦登录凭证（sessionId, webId, userId）` | 400 |
| `taskId is required` | 400 |
| `Task not found` | 404 |
| `imageUrl and key are required` | 400 |
| `Invalid data URL` | 400（内部） |
| `Unsupported image URL format` | 400 |
| `Unknown action: ${action}` | 400 |
| `请先配置即梦登录凭证` | 400 |

---

## 8. 浏览器代理 / Playwright 错误

**文件**: `app/lib/seedance/browser-service.ts`

### 8.1 浏览器启动

| 错误消息 | 触发条件 |
|----------|----------|
| `浏览器自动安装成功但启动失败。原始错误: ${msg} 重试错误: ${retryMsg}` | 自动安装后启动失败 |
| `浏览器启动失败：自动下载浏览器也未成功。${hint} 原始错误: ${msg}` | 自动安装也失败 |

**修复建议（Mac）**: `npm install -g playwright-core@1.58.2` → `PLAYWRIGHT_DOWNLOAD_HOST=... playwright-core install chromium-headless-shell`

**修复建议（Windows）**: `cd app` → `set PLAYWRIGHT_DOWNLOAD_HOST=...` → `npx playwright-core@1.58.2 install chromium-headless-shell`

### 8.2 页面执行

| 错误消息 | 触发条件 |
|----------|----------|
| `[browser] page.evaluate 超时(60s)` | page.evaluate 60 秒超时 |
| `[browser] 即梦请求失败: ${errInfo}` | 浏览器内 fetch 返回非 200 |
| `[browser] fetch 重试耗尽` | 3 次重试均失败 |

### 8.3 会话管理

| 日志消息 | 触发条件 |
|----------|----------|
| `[browser] bdms SDK 等待超时，继续尝试...` | SDK 30 秒未就绪 |
| `[browser] 浏览器已断开或超时，正在重建...` | 连接丢失或超时 |

---

## 9. 分镜流水线错误（pipeline）

**文件**: `app/api/pipeline/run/route.ts`

### 9.1 参数校验

| 错误消息 | 状态码 |
|----------|--------|
| 验证失败消息 | 400 |

### 9.2 LLM 调用

| 错误消息模板 | 触发条件 |
|-------------|----------|
| `Gemini API 错误 (${status}): ${text}` | Gemini API HTTP 错误 |
| `LLM API 错误 (${status}): ${text}` | OpenAI 兼容 API HTTP 错误 |
| `No response body` | 流式响应无 body |
| `LLM 返回内容过短或为空` | 响应为空或过短 |
| `__CANCELLED__` | 用户取消 |

### 9.3 通用错误

| 错误消息 | 状态码 |
|----------|--------|
| `{ error: msg }` | 500 |

---

## 10. 两阶段提取错误（twoPhaseExtract）

**文件**: `app/lib/twoPhaseExtract.ts`

| 错误消息 | 触发条件 |
|----------|----------|
| `API 错误 (${status}): ${text}` | HTTP 非 200 |
| `No response body` | 流式响应无 body |
| `Phase 1 提取结果为空` | P1 流式收集为空 |
| `Phase 1 JSON 解析失败` | P1 JSON 解析失败 |

**超时**: 180 秒（AbortController）

---

## 11. AI 提示词生成错误（seedance/ai-prompt）

**文件**: `app/api/seedance/ai-prompt/route.ts`

### 11.1 参数校验

| 错误消息 | 状态码 |
|----------|--------|
| `请求格式错误，需要 FormData` | 400 |
| 缺少必要参数 | 400 |

### 11.2 LLM 调用

| 错误消息模板 | 状态码 | 触发条件 |
|-------------|--------|----------|
| `Gemini API 错误 (${status}): ${text}` | — | Gemini 非流式失败 |
| `Gemini streaming 错误 (${status}): ${text}` | — | Gemini 流式失败 |
| `No response body` | — | 无响应体 |
| `流式响应被截断 (finishReason=${reason}，已收到 ${len} 字)` | — | 非正常结束 |
| `流式响应为空 (finishReason=${reason})` | — | 内容为空 |
| `LLM API 错误 (${status}): ${text}` | — | OpenAI 兼容 API 失败 |
| `AI 返回为空，可能原因：1)API Key 无效 2)模型不支持多模态 3)代理超时` | 502 | 响应为空 |
| `生成提示词失败: ${msg}` | 500 | 通用异常 |

---

## 12. 生图工作台 UI 错误（studio）

**文件**: `app/studio/page.tsx`

### 12.1 配置检查

| Toast 消息 | 级别 |
|------------|------|
| `请先在设置页配置图像 API Key` | error |
| `请先在「设置」页配置 LLM API Key` | error |
| `请先在 Seedance 页面的设置弹窗中配置即梦登录凭证` | error |

### 12.2 生图错误

| Toast 消息模板 | 级别 |
|---------------|------|
| `提示词加载失败，请检查网络` | error |
| `生成失败${upstream}: ${errMsg}` | error |
| `第 ${i} 格生成失败，跳过` | error |
| `裁剪失败（可能跨域限制），已保存合成图` | info |
| `裁剪异常：预期 ${n} 格，实际 ${m} 格` | error |
| `合成图裁剪失败: ${msg}` | error |
| `重新生成失败` | error |
| `生成错误: ${msg}` | error |
| `图像 API 返回为空，请检查图像模型配置` | error |
| `参考图生成网络错误` | error |

### 12.3 超分错误

| Toast 消息 | 级别 |
|------------|------|
| `超分失败${upstream}: ${errMsg}` | error |
| `超分失败：模型未返回图片` | error |
| `超分请求错误` | error |
| `无可超分的格子` | error |

### 12.4 Gemini Tab 错误

| Toast 消息模板 | 级别 |
|---------------|------|
| `Gemini Tab 服务启动失败: ${error}` | error |
| `Gemini Tab 服务启动超时，请稍后重试或前往设置页手动启动` | error |
| `Gemini Tab 生成失败: ${errMsg}` | error |
| `Gemini Tab: ${errMsg}` | error |
| `Gemini Tab: 返回结果为空` | error |
| `Gemini Tab 生成异常: ${errMsg}` | error |
| `Gemini Tab 超分失败: ${error}` | error |

### 12.5 即梦生图错误

| Toast 消息模板 | 级别 |
|---------------|------|
| `即梦生图失败: ${errText}` | error |
| `即梦生图失败，请查看即梦面板中的错误信息` | error |
| `即梦生图异常: ${errMsg}` | error |

### 12.6 AI 提取错误

| Toast 消息模板 | 级别 |
|---------------|------|
| `AI提取超时（5分钟），请检查网络或换用更快的模型后重试` | error |
| `没有可用的剧本内容（来源: ${src}，${len}字）...` | error |
| `提取失败: ${err.error}` | error |
| `提取错误: ${msg}` | error |

### 12.7 编辑 / 上传错误

| Toast 消息 | 级别 |
|------------|------|
| `该格暂无图片` | error |
| `该条目暂无参考图，无法编辑` | error |
| `图片编辑失败，请重试` | error |
| `图片编辑错误: ${msg}` | error |
| `图片已显示但磁盘保存失败，刷新后可能丢失` | info |
| `上传失败: ${msg}` | error |
| `图片过大（>80MB），请压缩后重试` | error |
| `该格暂无图片，无法编辑` | error |

### 12.8 其他错误

| Toast 消息 | 级别 |
|------------|------|
| `无提示词数据，请先运行流水线` | error |
| `无智能分镜提示词数据，请先通过外部接口导入` | error |
| `该组无提示词数据` | error |
| `请先生成九宫格！需要格${n}作为垫图` | error |
| `无可合成的格图` | error |
| `合成失败: ${msg}` | error |
| `应用选图到格子失败` | error |
| `应用选图失败` | error |
| `目标项目已删除或变更，无法应用` | error |
| `风格识别失败: ${err}` | error |
| `风格识别网络错误` | error |
| `风格图片处理失败，请尝试其他图片` | error |
| `图片过大，请使用小于50MB的图片` | error |
| `图片处理失败，请重试` | error |
| `复制失败，浏览器不支持或权限不足` | error |
| `复制失败` | error |
| `请先填写中文外观描述` | error |
| `没有中文描述可翻译` | error |
| `请先生成九宫格图片` | error |
| `当前没有已生成的格子图片，请先生成图片` | error |
| `当前没有格子图片，请先生成图片` | error |
| `AI返回内容为空，请检查LLM模型是否支持Vision` | error |
| `AI返回内容为空` | error |
| `AI生成失败` / `AI生成失败: ${detail}` | error |
| `AI生成异常: ${msg}` / `生成异常: ${msg}` | error |

---

## 13. 图生视频工作台 UI 错误（video）

**文件**: `app/video/page.tsx`

### 13.1 配置检查

| Toast 消息 | 级别 |
|------------|------|
| `请先在设置页配置视频模型的 API Key` | error |
| `请先在设置页配置 LLM API Key` | error |

### 13.2 视频生成

| Toast 消息模板 | 级别 |
|---------------|------|
| `请先选择一张源图片` | error |
| `请先选择首帧图片` | error |
| `请至少添加一张参考图` | error |
| `批量接力需要4张源图片，当前仅有${n}张` | error |
| `缺少接力图片 ${label}` | error |
| `${label} 视频生成完成！` | success |
| `${label} 视频生成异常: ${msg}` | error |
| `${label} 生成失败: ${msg}` | error |
| `视频生成异常: ${msg}` | error |
| `视频生成失败: ${msg}` | error |
| `生成失败: ${msg}` | error |

### 13.3 视频合成 / 导出

| Toast 消息 | 级别 |
|------------|------|
| `没有已完成的视频可合成` | error |
| `视频合成失败: ${msg}` | error |
| `没有可导出的视频` | error |
| `导出 ${label} 失败` | error |

### 13.4 帧截取

| Toast 消息 | 级别 |
|------------|------|
| `当前没有可用视频` | error |
| `截帧失败: ${msg}` | error |

### 13.5 AI 提示词生成

| Toast 消息模板 | 级别 |
|---------------|------|
| `单图模式请使用「选择提示词」获取提示词` | info |
| `请先选择或上传图片，再生成动态提示词` | error |
| `AI返回内容为空...可能原因：当前API代理不支持多模态(Vision)图片识别` | error |
| `AI生成失败: ${detail}` | error |
| `AI生成异常: ${msg}` | error |

### 13.6 台词导出

| Toast 消息 | 级别 |
|------------|------|
| `未找到节拍拆解文件，请先运行分镜流水线` | error |
| `节拍拆解内容为空` | error |
| `第 ${n} 批 LLM 请求失败` | error |
| `第 ${n} 批解析失败，已跳过` | error |
| `LLM 未提取到任何台词，请检查分镜内容` | error |
| `导出失败: ${msg}` | error |
| `没有找到智能分镜数据，请先在分镜流水线中完成智能分析` | error |

### 13.7 文件限制

| Toast 消息 | 级别 |
|------------|------|
| `文件 ${name} 超过 50MB 限制` | error |

---

## 14. 即梦生图页 UI 错误（jimeng）

**文件**: `app/jimeng/page.tsx`

| 错误消息 | 显示方式 | 触发条件 |
|----------|----------|----------|
| `${data.error}` 或 `生成失败` | alert() | POST 即梦生图请求失败 |
| `${data.error}` + `failCode` | 内联显示 | 轮询返回 status=error |

---

## 15. 其他 API Routes 错误

### 15.1 风格分析（/api/style-analyze）

**文件**: `app/api/style-analyze/route.ts`

| 错误消息 | 状态码 |
|----------|--------|
| `未配置 LLM API Key` | 400 |
| `请提供图片URL` | 400 |
| LLM API 错误 | 502 |
| `模型返回空内容，可能不支持当前图片格式或图片过大` | 422 |
| `无法解析风格分析JSON` | 422 |
| `风格分析结果被截断且无法修复` | 422 |
| `无法解析风格分析结果` | 422 |

### 15.2 剧本分析（/api/analyze-script）

**文件**: `app/api/analyze-script/route.ts`

| 错误消息 | 状态码 |
|----------|--------|
| `未配置 LLM API Key` | 400 |
| `剧本内容过短` | 400 |

### 15.3 参考图（/api/ref-image）

**文件**: `app/api/ref-image/route.ts`, `app/api/ref-image/[key]/route.ts`

| 错误消息 | 状态码 |
|----------|--------|
| `Missing key or imageData` | 400 |
| `Invalid data URL format` | 400 |
| `Unsupported MIME type` | 400 |
| `Image not found` | 404 |
| `Missing key` | 400 |
| `Invalid key` | 400 |
| `Not found` | 404 |

### 15.4 本地文件（/api/local-file）

**文件**: `app/api/local-file/route.ts`, `app/api/local-file/[...path]/route.ts`

| 错误消息 | 状态码 |
|----------|--------|
| `Missing category or key` | 400 |
| `Invalid key` | 400 |
| `Source key "${key}" not found in ${cat}` | 404 |
| `Missing data` | 400 |
| `Missing category parameter` | 400 |
| `Missing category` | 400 |
| `File not found` | 404 |
| `Need category/key` | 400 |

### 15.5 输出文件（/api/outputs）

**文件**: `app/api/outputs/route.ts`, `app/api/outputs/[filename]/route.ts`

| 错误消息 | 状态码 |
|----------|--------|
| `恢复失败` | 500 |
| `清除失败` | 500 |
| `File not found` | 404 |

### 15.6 提示词（/api/prompts）

**文件**: `app/api/prompts/route.ts`

| 错误消息 | 状态码 |
|----------|--------|
| `${msg}` | 500 |

### 15.7 代理图片（/api/proxy-image）

**文件**: `app/api/proxy-image/route.ts`

| 错误消息 | 状态码 |
|----------|--------|
| `Invalid URL` | 400 |
| `URL does not point to an image` | 400 |
| `Image proxy failed` | 502 |

### 15.8 工具（/api/util）

**文件**: `app/api/util/route.ts`

| 错误消息 | 状态码 |
|----------|--------|
| `File not found: ${filename}` | 404 |
| `Unknown action` | 400 |

### 15.9 剧本导入（/api/scripts/import）

**文件**: `app/api/scripts/import/route.ts`

| 错误消息 | 状态码 |
|----------|--------|
| 解析失败消息 | 400 |
| 服务端错误 | 500 |

### 15.10 GeminiTab（/api/gemini-tab）

**文件**: `app/api/gemini-tab/route.ts`, `stop-service/route.ts`

| 错误消息 | 状态码 |
|----------|--------|
| 服务错误 | 502 |
| 停止服务错误 | 500 |

---

## 附录：错误处理模式总结

### A. 通用重试模式

```
for (attempt = 0; attempt < 3; attempt++) {
  try { ... return; }
  catch { await sleep(delay * (attempt + 1)); }
}
throw new Error("重试耗尽");
```

- **即梦 API**: 3 次重试，指数退避 `1000ms * attempt`
- **图像 API**: 3 次重试，429 有 10s 最小延迟
- **LLM API**: 3 次重试，固定 `3000ms * (attempt+1)`
- **浏览器 fetch**: 3 次重试，含自动重建 session

### B. 降级策略

| 场景 | 降级路径 |
|------|----------|
| 即梦生图 3018 | 浏览器代理 → 直连降级 |
| 图像 API 504 | 重试 3 次后返回 502 |
| Gemini API 连接失败 | 提示切换国内中转 API |
| LLM HTML 错误 | 提示切换国内直连 API 预设 |

### C. 超时配置

| 组件 | 超时时间 |
|------|----------|
| 即梦 API fetch | 45 秒 |
| 即梦图片轮询 | 60 次 × 3-6s ≈ 5 分钟 |
| 即梦视频轮询 | 约 20 分钟 |
| 浏览器 page.evaluate | 60 秒 |
| 浏览器内 fetch | 30 秒 |
| bdms SDK 就绪 | 30 秒 |
| 会话空闲超时 | 10 分钟 |
| 两阶段提取 | 180 秒 |
| 客户端即梦任务 | 5 分钟 |
| Gemini 视频轮询 | 10 分钟 |
