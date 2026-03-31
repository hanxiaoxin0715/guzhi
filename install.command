#!/bin/bash
# ═══════════════════════════════════════════════════════════
# FEICAI Studio — macOS 首次安装脚本
#
# 功能:
#   1. 检查/安装 Node.js (通过 Homebrew)
#   2. 安装 macOS 平台 sharp 原生模块
#   3. 安装 Playwright Chromium 浏览器
#
# 用法: 双击 install.command 或在终端运行 bash install.command
# ═══════════════════════════════════════════════════════════

set -e
set -o pipefail

# 切换到脚本所在目录
cd "$(dirname "$0")"
SCRIPT_DIR="$(pwd)"
APP_DIR="$SCRIPT_DIR/app"

echo ""
echo "  +================================================+"
echo "  |      FEICAI Studio — macOS 环境安装             |"
echo "  +================================================+"
echo ""

# ── Step 1: 检查 Node.js ──
echo "  [1/3] 检查 Node.js..."
if command -v node &>/dev/null; then
    NODE_VER=$(node --version)
    echo "  [√] Node.js 已安装: $NODE_VER"
else
    echo "  [!] 未检测到 Node.js，正在安装..."
    
    # 检查 Homebrew
    if command -v brew &>/dev/null; then
        echo "  使用 Homebrew 安装 Node.js..."
        brew install node
    else
        echo ""
        echo "  ╔════════════════════════════════════════════╗"
        echo "  ║  需要先安装 Homebrew 和 Node.js            ║"
        echo "  ║                                            ║"
        echo "  ║  请在终端中运行以下命令:                   ║"
        echo "  ║                                            ║"
        echo "  ║  1. 安装 Homebrew:                         ║"
        echo "  ║  /bin/bash -c \"\$(curl -fsSL              ║"
        echo "  ║    https://raw.githubusercontent.com/      ║"
        echo "  ║    Homebrew/install/HEAD/install.sh)\"      ║"
        echo "  ║                                            ║"
        echo "  ║  2. 安装 Node.js:                          ║"
        echo "  ║  brew install node                         ║"
        echo "  ║                                            ║"
        echo "  ║  3. 重新运行本安装脚本                     ║"
        echo "  ╚════════════════════════════════════════════╝"
        echo ""
        echo "  按回车键退出..."
        read
        exit 1
    fi
fi

# ── Step 2: 安装 sharp 原生模块 ──
echo ""
echo "  [2/3] 安装 sharp 原生模块 (图片处理)..."
cd "$APP_DIR"

# sharp 需要平台特定的二进制，Windows 构建的不能用于 Mac
# 重新安装 sharp 获取 macOS 版本
if [ -d "node_modules/sharp" ]; then
    echo "  重新安装 sharp 获取 macOS 原生绑定..."
    npm install sharp --no-save 2>&1 | tail -3
    echo "  [√] sharp 安装完成"
else
    echo "  安装 sharp..."
    npm install sharp --no-save 2>&1 | tail -3
    echo "  [√] sharp 安装完成"
fi

# ── Step 3: 安装 Playwright Chromium ──
echo ""
echo "  [3/3] 安装 Playwright Chromium 浏览器..."
echo "  此过程需要下载约 80~150MB，请耐心等待..."

# 检查 playwright-core 是否存在
if [ -f "node_modules/playwright-core/cli.js" ]; then
    INSTALL_OK=false

    # 优先尝试 npmmirror 国内镜像
    echo "  尝试国内镜像加速下载..."
    export PLAYWRIGHT_DOWNLOAD_HOST="https://cdn.npmmirror.com/binaries/playwright"
    # 清除残留代理（避免 ECONNREFUSED）
    unset HTTPS_PROXY HTTP_PROXY https_proxy http_proxy

    if node node_modules/playwright-core/cli.js install chromium-headless-shell 2>&1; then
        echo "  [√] chromium-headless-shell 安装完成（国内镜像）"
        INSTALL_OK=true
    else
        echo "  [!] headless-shell 镜像下载失败，尝试完整 chromium..."
        if node node_modules/playwright-core/cli.js install chromium 2>&1; then
            echo "  [√] Chromium 安装完成（国内镜像）"
            INSTALL_OK=true
        fi
    fi

    # 镜像全部失败，回退官方 CDN
    if [ "$INSTALL_OK" = false ]; then
        echo "  [!] 国内镜像均失败，尝试官方 CDN..."
        unset PLAYWRIGHT_DOWNLOAD_HOST
        if node node_modules/playwright-core/cli.js install chromium-headless-shell 2>&1; then
            echo "  [√] chromium-headless-shell 安装完成（官方 CDN）"
            INSTALL_OK=true
        elif node node_modules/playwright-core/cli.js install chromium 2>&1; then
            echo "  [√] Chromium 安装完成（官方 CDN）"
            INSTALL_OK=true
        fi
    fi

    if [ "$INSTALL_OK" = false ]; then
        echo ""
        echo "  ╔════════════════════════════════════════════════════════════╗"
        echo "  ║  浏览器下载失败（网络问题），但不影响其他功能。           ║"
        echo "  ║  Seedance 视频生成功能首次使用时会自动重试下载。         ║"
        echo "  ║  如需手动安装，请在终端运行:                             ║"
        echo "  ║  npm install -g playwright-core                          ║"
        echo "  ║  PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/     ║"
        echo "  ║  binaries/playwright playwright-core install             ║"
        echo "  ║  chromium-headless-shell                                 ║"
        echo "  ╚════════════════════════════════════════════════════════════╝"
        echo ""
    fi
else
    echo "  [!] playwright-core 未找到，Seedance 视频生成将在首次使用时自动下载浏览器"
    echo "  其他功能不受影响"
fi

cd "$SCRIPT_DIR"

echo ""
echo "  +================================================+"
echo "  |      安装完成!                                  |"
echo "  +================================================+"
echo ""
echo "  现在可以双击「启动飞彩工作室.command」启动软件"
echo ""
echo "  按回车键退出..."
read
