"use client";

import { ScrollText, ArrowLeft, Rocket, Bug, Sparkles, Wrench } from "lucide-react";
import Link from "next/link";

// ── 更新日志数据 ──
// 每次发布热更新补丁前，在这里追加新版本条目
interface ChangeItem {
  type: "feature" | "fix" | "improve" | "refactor";
  text: string;
}
interface VersionEntry {
  version: string;
  date: string;
  label: string;
  platform: "all" | "windows" | "mac";
  changes: ChangeItem[];
}

const CURRENT_VERSION = "V1.99";

const changelog: VersionEntry[] = [
  {
    version: "V1.99",
    date: "2026-03-07",
    label: "热更新补丁",
    platform: "all",
    changes: [
      { type: "feature", text: "GeeKnow 全量视频接口集成（28 个预设）— 覆盖 Sora / Veo / Grok / Seedance / Wan2.6 / Vidu / Kling / Hailuo 全平台" },
      { type: "feature", text: "LLM 预设子菜单模型选择 — 七牛云（17）、贞贞工坊（23）、云雾 API（21）子模型一键切换" },
      { type: "feature", text: "Image 预设子菜单模型选择 — 七牛云（7）、贞贞工坊（20）、云雾 API（21）子模型一键切换" },
      { type: "feature", text: "AI 提示词增强系统 — 10 个平台规格 Profile + AIPromptModal 目标模型选择 + 平台规格预览" },
      { type: "feature", text: "台词导入功能 — DialoguePickerModal 组件，支持四宫格 / 九宫格 / 智能分镜 / 自定义多源台词提取" },
      { type: "feature", text: "AI 生成输出语言选择 — 中文 / English 一键切换" },
      { type: "feature", text: "台词内联编辑 — 已导入台词标签可点击编辑角色名和台词内容，Enter 保存 / Esc 取消" },
      { type: "feature", text: "分镜提示词系统 — 替代旧「动态提示词」，从 StoryboardPicker 选择分镜描述，数据源对齐工作台" },
      { type: "fix", text: "Grok / Wan2.6 视频首尾帧模式 end_reference 缺失修复" },
      { type: "fix", text: "智能分镜台词丢失修复 — 正则扩展支持 6 种引号类型（中英文双引号 + 中英文单引号）" },
      { type: "fix", text: "台词角色名提取重写 — extractSpeaker 两步算法（50 字回溯 + 动词检测 + 标点边界分析）" },
      { type: "fix", text: "台词弹窗数据源隔离 — 四宫格 / 九宫格与智能分镜各自独立，不再交叉显示台词" },
      { type: "fix", text: "AI 生成提示词台词缺失修复 — 台词原文强制嵌入提示词，不可省略 / 改写 / 概括" },
      { type: "improve", text: "视频预览宽高比全面适配 — 支持 9:16 / 1:1 / 16:9 动态宽高比显示" },
      { type: "improve", text: "视频预览页顶栏 UI 重构 — 操作按钮移至标题栏，底部精简为计数条" },
      { type: "improve", text: "分镜流水线 UI 优化 — LLM 图像识别模型注释 + 上传按钮移至 Header + 引导弹窗持久化" },
      { type: "improve", text: "台词 6 维情感分析 — 新增强度 / 语速 / 声色维度，AI 上下文注入更精准" },
      { type: "improve", text: "台词缓存磁盘镜像 — feicai-dialogues 和 feicai-video-models 前缀自动同步到磁盘" },
    ],
  },
  {
    version: "V1.98",
    date: "2026-03-06",
    label: "热更新补丁",
    platform: "all",
    changes: [
      { type: "fix", text: "LLM baseUrl 空值修复：14 处客户端调用点新增默认回退地址，解决 'Failed to parse URL' 报错" },
      { type: "fix", text: "四宫格一键生成连续分镜提示词 CORS 修复：远程图片压缩新增 crossOrigin 设置，解决 canvas 污染报错" },
      { type: "fix", text: "LLM 错误信息透明化：台词翻译和连续分镜生成显示服务端实际错误详情，替代仅显示 'API 返回 500'" },
      { type: "fix", text: "动态提示词弹窗标签页切换竞态修复：Tab 切换时同步清空旧数据，解决四宫格显示智能分镜图片" },
      { type: "fix", text: "宫格导入弹窗重开状态修复：每次打开自动重置所有状态，解决上次关闭的数据残留" },
      { type: "fix", text: "分镜台词导出修复：智能分镜台词导出和小说原台词导出均修复 baseUrl 空值问题" },
      { type: "fix", text: "分镜流水线剖析脚本流式解析修复：新增message.content回退+非流式响应回退" },
      { type: "fix", text: "Gemini PROHIBITED_CONTENT 友好提示：内容审查触发时显示中文引导信息，而非原始报错" },
      { type: "fix", text: "首尾帧独立模式导入勾选修复：首尾帧导入图片时不再预选已有源图片" },
      { type: "fix", text: "Seedance 宫格导入项目隔离：GridImportModal 区分 KV/磁盘 EP 来源，排除旧项目图片残留" },
      { type: "fix", text: "Seedance 生成链路修复：画质/参考模式闭包修复 + 轮询任务不存在时友好错误提示" },
      { type: "improve", text: "服务端 LLM baseUrl 空值自动回退默认地址，减少配置遗漏导致的报错" },
      { type: "improve", text: "设置页预设方案自动填充 URL，切换预设时自动同步对应的 API 地址" },
      { type: "improve", text: "10 个系统提示词新增创作背景声明，降低内容审查触发率" },
    ],
  },
  {
    version: "V1.97",
    date: "2026-03-06",
    label: "热更新补丁",
    platform: "all",
    changes: [
      { type: "fix", text: "混淆策略修复：从激进混淆改为轻量级保护，解决客户端 UI 缺失、交互丢失、样式错乱等问题" },
      { type: "improve", text: "构建产物与源码功能 100% 一致：移除 control-flow-flattening / transform-object-keys / RC4 string-array 等破坏性选项" },
    ],
  },
  {
    version: "V1.96",
    date: "2026-03-06",
    label: "热更新补丁",
    platform: "windows",
    changes: [
      { type: "fix", text: "FC 智能体多分集 JSON 截断：maxTokens 动态计算（多分集自动升至 16384），解决 5 集 30 分镜 JSON 被截断" },
      { type: "fix", text: "截断 JSON 自动修复：括号计数修复逻辑，自动补全未闭合的 { / [" },
      { type: "fix", text: "EP 相似度误判：阈值 0.55 → 0.70，避免同一世界观分集被误判为重复" },
      { type: "fix", text: "EP 集数减少保护：校核智能体修复后若集数减少则拒绝，防止 LLM 合并/删除集数" },
      { type: "fix", text: "分集推送 stale state：移除 episodeResults 前置检查，解决多次生成后推送被跳过" },
      { type: "fix", text: "FC Actions 执行后自动推送：write_prompt/clear_cell 等操作后自动推送到工作台" },
      { type: "improve", text: "校核流程 LLM maxTokens 8000 → 16384，多分集修复有足够输出空间" },
    ],
  },
  {
    version: "V1.95",
    date: "2026-03-06",
    label: "增量补丁",
    platform: "windows",
    changes: [
      { type: "fix", text: "LLM API HTML 响应解析崩溃修复：三层防护（HTML 检测全状态码 + Content-Type 预检 + JSON 解析兜底）" },
    ],
  },
  {
    version: "V1.90",
    date: "2026-03-15",
    label: "热更新补丁",
    platform: "all",
    changes: [
      { type: "feature", text: "AI 提取双语输出强制：name 字段中文、prompt 字段纯英文，全路径（单阶段/两阶段/翻译）统一约束" },
      { type: "improve", text: "角色美化规则（CHAR_BEAUTY_RULES）：强制包含 beautiful, attractive, refined facial features 等美化关键词" },
      { type: "improve", text: "提示词字符上限从 700 → 750，所有 Builder 函数同步更新" },
      { type: "improve", text: "参考图提示词统一模块 refSheetPrompts.ts：6 个 Builder 函数单一数据源，3 个消费文件统一引用" },
      { type: "fix", text: "修复部分 AI 提取结果缺少英文 prompt 的问题（强化 JSON schema 双语约束）" },
      { type: "fix", text: "修复提示词编辑器修改不即时生效的问题（IDB 优先读取用户自定义值）" },
      { type: "fix", text: "RefBindPanel 参考图过滤修复" },
      { type: "fix", text: "宽高比计算偏移修复" },
      { type: "fix", text: "PromptPickerModal 弹窗显示异常修复" },
      { type: "fix", text: "生图 API 超时从 5 分钟延长至 8 分钟" },
    ],
  },
  {
    version: "V1.89",
    date: "2026-03-12",
    label: "热更新补丁",
    platform: "all",
    changes: [
      { type: "feature", text: "自定义分镜模式：原「智能体分镜」重命名为「自定义分镜」，支持 1-25 宫格自由设置，提示词编辑/生图/超分/下载/参考图绑定全适配" },
      { type: "feature", text: "自定义宫格分集持久化：自定义宫格提示词按 EP 独立存储，切换分集不丢失" },
      { type: "feature", text: "宫格图片撤回：每个格子支持最多 5 级撤回历史，琥珀色「撤回」按钮悬浮在格子左上角" },
      { type: "feature", text: "即梦 Image 4.0 / 4.1 模型：新增两个即梦生图模型选项" },
      { type: "feature", text: "即梦任务历史磁盘持久化：任务历史 localStorage + 磁盘双通道，清除浏览器缓存后自动恢复" },
      { type: "feature", text: "即梦选图持久化显示：历史任务缩略图中选中图片显示金色边框 + ✓ 标记" },
      { type: "feature", text: "视频预览缩略图列表 + 弹窗播放器：生成的视频直接在页面内缩略图预览和播放" },
      { type: "feature", text: "智能对话导出音谷 JSON 格式：支持导出为音谷兼容的台词 JSON" },
      { type: "feature", text: "剪映草稿导出 + 剪映导入教程引导" },
      { type: "feature", text: "FC 智能体专业能力增强：系统提示词优化、知识库增强、子智能体提示词升级、组合工作流支持" },
      { type: "feature", text: "FC 智能体分集能力：支持 episodes 格式输出，动态意图检测自动强制分集格式" },
      { type: "feature", text: "AI 提取支持 Agent 导入剧本：智能体导入的剧本自动同步到剧本库，提取时优先使用" },
      { type: "feature", text: "Review Agent 防重复分集：FC 智能体生成分镜后自动审核，检测相似度 >60% 的重复 EP 并触发重写" },
      { type: "feature", text: "参考图提示词统一模块：新建 refSheetPrompts.ts 单一数据源，6 个 Builder 函数统一管理角色/场景/道具参考图规则，消除重复维护" },
      { type: "feature", text: "提示词编辑器实时同步：翻译参考图/翻译宫格/AI 提取三处消费者改为 IDB 优先读取用户自定义提示词，编辑器修改即时生效" },
      { type: "fix",     text: "TXT 文件导入乱码修复：6 级编码自动检测（UTF-8 BOM / UTF-16 LE / UTF-16 BE / GBK），支持 Windows 记事本各种保存格式" },
      { type: "fix",     text: "CSV 文件导入修复：RFC 4180 兼容处理 Excel 导出的多行单元格，不再截断含换行的字段" },
      { type: "fix",     text: "动态提示词弹窗自定义模式适配：格数/布局/存储键/图片键/描述读取全部匹配自定义宫格" },
      { type: "fix",     text: "PromptsTab 自定义宫格适配：提示词标签页正确显示自定义格数" },
      { type: "fix",     text: "智能分镜九宫格布局修复：smartNine 错误使用 4 宫格改为 3×3 布局" },
      { type: "fix",     text: "视频页动态提示词弹窗 key 不匹配修复" },
      { type: "fix",     text: "Seedance 分镜选择器描述读取修复" },
      { type: "fix",     text: "即梦 FAB getSnapshot 引用修复：返回新数组引用触发 React 重渲染" },
      { type: "fix",     text: "即梦轮询超时从 5 分钟延长到 10 分钟" },
      { type: "fix",     text: "RefBindPanel 参考图过滤修复：解决部分参考图无法绑定显示的问题" },
      { type: "fix",     text: "宽高比计算偏移修复：修复画面比例不准确" },
      { type: "fix",     text: "PromptPickerModal 弹窗显示异常修复" },
      { type: "fix",     text: "生图 API 超时从 5 分钟延长到 8 分钟，减少大模型生图时的超时中断" },
      { type: "improve", text: "模式切换解锁：各模式按钮独立显示生成状态，互不阻塞" },
      { type: "improve", text: "视频页按钮 UI 放大，操作更便捷" },
      { type: "improve", text: "参考图批量翻译按钮 + 缩略图点击放大" },
      { type: "improve", text: "Seedance 提示词 ≤750 字符限制 + 超限警告" },
      { type: "improve", text: "角色美化规则：角色参考图提示词强制包含美化关键词（beautiful, attractive, refined facial features），确保角色五官精致" },
      { type: "improve", text: "AI 提取参考图提示词统一：标题红色粗体、矩形面板中文标注、80-120 词限制" },
      { type: "improve", text: "文件编码处理模块化：提取共享 fileEncoding.ts，消除代码重复" },
    ],
  },
  {
    version: "V1.88",
    date: "2026-03-04",
    label: "热更新补丁",
    platform: "all",
    changes: [
      { type: "fix",     text: "VPN 导致机器码变化：物理网卡过滤 + 多候选码兼容验证，已有激活码不受影响" },
      { type: "fix",     text: "角色库智能匹配修复：支持「·」形态后缀拆分匹配，双向别名匹配，类型约束" },
      { type: "fix",     text: "清空画布图片时合成图残留：九宫格/四宫格/智能分镜均已修复，仅清画布不删磁盘文件" },
      { type: "feature", text: "左侧导航栏新增「更新日志」页面" },
      { type: "feature", text: "七牛云 API 全模型集成：LLM（44+模型）、图像生成（Kling/Gemini）、视频生成（ViduQ2/Sora2/Kling V2.6）" },
      { type: "feature", text: "图像生成新增「OpenAI 图像生成」协议格式（v1/images/generations），适配七牛云等专用接口" },
      { type: "feature", text: "LLM API 代理支持：通过 HTTPS_PROXY 环境变量代理访问 Google 等被墙 API" },
      { type: "improve", text: "即梦生图标签锁定为「即梦生图后续开发」（暂停维护）" },
      { type: "improve", text: "火山引擎 401 错误增加 Ark API Key 来源指引" },
      { type: "improve", text: "错误提示 Toast 加宽 + 支持多行 + 显示时间延长" },
    ],
  },
  {
    version: "V1.86",
    date: "2026-03-03",
    label: "热更新补丁",
    platform: "windows",
    changes: [
      { type: "feature", text: "Playwright 浏览器自动下载（首次使用 Seedance 时通过 npmmirror CDN 下载）" },
      { type: "fix",     text: "9:16 竖版宫格提示词修复（窄高格子布局 + CRITICAL 比例提示）" },
      { type: "fix",     text: "GridImportModal EP 数量修复（从 API 自发现实际有图的 EP）" },
    ],
  },
  {
    version: "V1.91",
    date: "2026-03-03",
    label: "热更新补丁",
    platform: "mac",
    changes: [
      { type: "feature", text: "Playwright 浏览器自动下载 + install.command 多镜像回退重写" },
      { type: "fix",     text: "9:16 竖版宫格提示词修复 + EP 数量修复" },
    ],
  },
  {
    version: "V1.85",
    date: "2026-03-02",
    label: "热更新补丁",
    platform: "windows",
    changes: [
      { type: "feature", text: "宫格导入合成图自动切分预览（4/9格检测 + 预览切换）" },
      { type: "improve", text: "Playwright 安装指引优化（报错时给出下载链接）" },
    ],
  },
  {
    version: "V1.84",
    date: "2026-03-01",
    label: "热更新补丁",
    platform: "windows",
    changes: [
      { type: "feature", text: "角色库收藏功能 + 缩放预览" },
      { type: "fix",     text: "火山引擎 API 预设修正" },
      { type: "fix",     text: "导出按钮重命名（智能分镜台词导出 / 小说原台词导出）" },
      { type: "improve", text: "设置页精简（删除 imageSize / aspectRatio）" },
    ],
  },
  {
    version: "V1.83",
    date: "2026-03-01",
    label: "热更新补丁",
    platform: "windows",
    changes: [
      { type: "feature", text: "智能分镜全功能上线（分析→节拍拆解→B路径锁定→格子编辑→自动生成→翻译→跨模式）" },
    ],
  },
];

const typeIcon = {
  feature: Rocket,
  fix: Bug,
  improve: Sparkles,
  refactor: Wrench,
};
const typeLabel = {
  feature: "新功能",
  fix: "修复",
  improve: "优化",
  refactor: "重构",
};
const typeColor = {
  feature: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  fix: "text-red-400 bg-red-500/10 border-red-500/20",
  improve: "text-[var(--gold-primary)] bg-[var(--gold-transparent)] border-[var(--gold-primary)]/20",
  refactor: "text-blue-400 bg-blue-500/10 border-blue-500/20",
};
const platformBadge = {
  all: { label: "全平台", cls: "text-[var(--text-muted)] border-[var(--border-default)]" },
  windows: { label: "Windows", cls: "text-blue-400 border-blue-500/30" },
  mac: { label: "macOS", cls: "text-purple-400 border-purple-500/30" },
};

export default function ChangelogPage() {
  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto py-10 px-6">
      {/* 头部 */}
      <div className="flex items-center gap-4">
        <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition">
          <ArrowLeft size={20} />
        </Link>
        <ScrollText size={22} className="text-[var(--gold-primary)]" />
        <div>
          <h1 className="text-[20px] font-semibold text-[var(--text-primary)]">更新日志</h1>
          <p className="text-[12px] text-[var(--text-muted)]">当前版本: {CURRENT_VERSION}</p>
        </div>
      </div>

      {/* 时间线 */}
      <div className="flex flex-col gap-0">
        {changelog.map((entry, idx) => {
          const pb = platformBadge[entry.platform];
          const isDev = entry.label === "开发中";
          return (
            <div key={entry.version} className="relative flex gap-4 pb-8 last:pb-0">
              {/* 时间线竖线 */}
              {idx < changelog.length - 1 && (
                <div className="absolute left-[11px] top-[28px] bottom-0 w-px bg-[var(--border-default)]" />
              )}
              {/* 时间线圆点 */}
              <div className={`relative z-10 mt-1.5 w-[23px] h-[23px] rounded-full border-2 flex items-center justify-center shrink-0 ${
                isDev ? "border-[var(--gold-primary)] bg-[var(--gold-transparent)]" : "border-[var(--border-default)] bg-[var(--bg-surface)]"
              }`}>
                <div className={`w-2 h-2 rounded-full ${isDev ? "bg-[var(--gold-primary)]" : "bg-[var(--text-muted)]"}`} />
              </div>
              {/* 内容 */}
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={`text-[15px] font-semibold ${isDev ? "text-[var(--gold-primary)]" : "text-[var(--text-primary)]"}`}>
                    {entry.version}
                  </span>
                  {isDev && (
                    <span className="px-2 py-0.5 text-[10px] font-medium text-[var(--gold-primary)] border border-[var(--gold-primary)]/30 bg-[var(--gold-transparent)] rounded-full animate-pulse">
                      开发中
                    </span>
                  )}
                  {!isDev && (
                    <span className="text-[11px] text-[var(--text-muted)]">{entry.label}</span>
                  )}
                  <span className={`px-1.5 py-0.5 text-[10px] border rounded ${pb.cls}`}>{pb.label}</span>
                  <span className="text-[11px] text-[var(--text-muted)]">{entry.date}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {entry.changes.map((c, ci) => {
                    const Icon = typeIcon[c.type];
                    return (
                      <div key={ci} className="flex items-start gap-2">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium border rounded shrink-0 mt-0.5 ${typeColor[c.type]}`}>
                          <Icon size={10} />
                          {typeLabel[c.type]}
                        </span>
                        <span className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{c.text}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
