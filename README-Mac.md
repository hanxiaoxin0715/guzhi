# FEICAI Studio — macOS 安装指南

## 版本信息
- 版本: V1.92
- 构建号: 2026-03-02T21-59-59
- 构建时间: 2026-03-02T22:05:09.148Z

## 系统要求
- macOS 12 (Monterey) 或更高版本
- 8 GB 以上内存
- 2 GB 以上磁盘空间（首次安装浏览器需额外 ~200 MB）

## 首次安装

### 1. 解压
将 `FEICAI-Studio-Mac-V1.92.zip` 解压到任意目录（如 `~/Applications/`）

### 2. 安装依赖
双击 **`install.command`**（或在终端运行 `bash install.command`）

该脚本会自动:
- 检查 / 安装 Node.js（通过 Homebrew）
- 安装 sharp 图像处理模块（macOS 原生版）
- 安装 Playwright Chromium 浏览器（Gemini Tab 需要）



## 日常使用

### 启动
双击 **`启动飞彩工作室.command`**（或 `start.command`）

启动后自动:
2. 检查在线更新
3. 启动服务（端口 3000）
4. 打开浏览器 http://localhost:3000

### 停止
关闭终端窗口即可停止服务。

## 更新
软件启动时自动检查更新。如需手动更新，详见管理员通知。

## 常见问题

### Q: 双击 .command 文件无反应？
A: 右键 → 打开 → 确认打开。或在终端中运行 `bash 启动飞彩工作室.command`

### Q: 提示 "无法验证开发者"？
A: 系统偏好设置 → 安全性与隐私 → 通用 → 仍要打开

### Q: Gemini Tab 浏览器无法启动？
A: 重新运行 `bash install.command`，确保 Playwright Chromium 安装成功。

### Q: 端口 3000 被占用？
A: 运行 `lsof -i :3000` 查看占用进程，`kill -9 <PID>` 结束后重试。

## 目录结构
```
FEICAI-Studio-Mac-V1.92/
├── install.command          ← 首次安装（安装 Node.js / sharp / Chromium）
├── 启动飞彩工作室.command    ← 日常启动（授权 → 更新 → 服务）
├── start.command             ← 英文启动器（同上）

├── README-Mac.md             ← 本文档
├── lib/

│   └── update-check.mjs     ← 在线热更新模块
├── app/
│   ├── server.js             ← Next.js 服务入口
│   ├── .next/                ← 编译产物
│   ├── node_modules/         ← 依赖（不含原生模块）
│   ├── public/               ← 静态资源
│   ├── claude/               ← AI Agent 提示词
│   ├── GeminiTab-dist/       ← Gemini 生图服务
│   ├── *.txt                 ← 系统提示词
│   └── outputs/              ← 输出目录
└── outputs/                  ← 用户输出目录（自动创建）
```

## 联系方式
微信: lysadni
