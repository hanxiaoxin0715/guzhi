#!/bin/bash
# ═══════════════════════════════════════════════════════════
# FEICAI Studio — macOS 启动器
#
# 功能:
#   1. 授权验证 (Node.js HMAC-SHA256，与 Windows 同算法)
#   2. 在线热更新检查 (从 OSS mac/ 路径拉取补丁)
#   3. 启动 Next.js 服务 + 自动打开浏览器
#
# 用法: 双击此文件 或在终端运行 bash 启动飞彩工作室.command
# ═══════════════════════════════════════════════════════════

# 切换到脚本所在目录
cd "$(dirname "$0")"
SCRIPT_DIR="$(pwd)"
APP_DIR="$SCRIPT_DIR/app"
LIB_DIR="$SCRIPT_DIR/lib"
PORT=3000

echo ""
echo "  +================================================+"
echo "  |      FEICAI Studio - AI智能分镜系统 (macOS)     |"
echo "  +================================================+"
echo ""

# ── 检查 Node.js ──
if ! command -v node &>/dev/null; then
    echo "  [错误] 未安装 Node.js"
    echo "  请先双击 install.command 完成安装"
    echo ""
    echo "  按回车键退出..."
    read
    exit 1
fi

# ── Step 1: 授权验证 (已移除) ──
# echo "  [√] 授权验证已跳过"

# ── Step 2: 在线热更新 ──
if [ -f "$LIB_DIR/update-check.mjs" ]; then
    node "$LIB_DIR/update-check.mjs" "$APP_DIR" || true
fi

# ── Step 3: 检查关键文件 ──
if [ ! -f "$APP_DIR/server.js" ]; then
    echo ""
    echo "  [错误] app/server.js 不存在"
    echo "  请重新下载安装包或联系管理员。"
    echo ""
    echo "  按回车键退出..."
    read
    exit 1
fi

# ── Step 3.5: 检查 Playwright 浏览器 ──
echo ""
echo "  [检查] Playwright 浏览器..."

PLAYWRIGHT_INSTALLED=false
if [ -f "$APP_DIR/node_modules/playwright-core/cli.js" ]; then
    # 检查 chromium-headless-shell 是否已安装（Seedance 需要）
    if node "$APP_DIR/node_modules/playwright-core/cli.js" list 2>/dev/null | grep -q "chromium.*headless.*shell"; then
        PLAYWRIGHT_INSTALLED=true
        echo "  [√] Playwright 浏览器已安装"
    fi
fi

if [ "$PLAYWRIGHT_INSTALLED" = false ]; then
    echo "  [!] Playwright 浏览器未安装（Seedance 视频生成需要）"
    echo ""
    echo "  是否立即安装？(需要下载约 150MB，耗时 2-5 分钟)"
    echo "  输入 y 安装 / n 跳过 / q 退出"
    echo -n "  选择 [y/n/q]: "
    read -r CHOICE
    
    case "$CHOICE" in
        y|Y)
            echo ""
            echo "  正在安装 Playwright Chromium..."
            cd "$APP_DIR"
            export PLAYWRIGHT_DOWNLOAD_HOST="https://cdn.npmmirror.com/binaries/playwright"
            if node node_modules/playwright-core/cli.js install chromium chromium-headless-shell 2>&1 | tail -10; then
                echo "  [√] Playwright 浏览器安装成功"
            else
                echo "  [!] 安装失败，尝试官方 CDN..."
                unset PLAYWRIGHT_DOWNLOAD_HOST
                if node node_modules/playwright-core/cli.js install chromium chromium-headless-shell 2>&1 | tail -10; then
                    echo "  [√] Playwright 浏览器安装成功（官方 CDN）"
                else
                    echo "  [×] 安装失败，Seedance 功能将不可用"
                    echo "  可稍后手动运行 install.command 完成安装"
                    echo ""
                    echo "  按回车键继续启动（其他功能不受影响）..."
                    read
                fi
            fi
            cd "$SCRIPT_DIR"
            ;;
        q|Q)
            echo "  已取消启动"
            exit 0
            ;;
        *)
            echo "  跳过安装，Seedance 功能将不可用"
            echo "  可稍后双击 install.command 完成安装"
            sleep 2
            ;;
    esac
fi

# ── Step 4: 创建 outputs 目录 & 写入路径配置 ──
OUTPUTS_DIR="$SCRIPT_DIR/outputs"
mkdir -p "$OUTPUTS_DIR"
mkdir -p "$OUTPUTS_DIR/grid-images"
mkdir -p "$OUTPUTS_DIR/videos"
mkdir -p "$OUTPUTS_DIR/video-frames"
mkdir -p "$OUTPUTS_DIR/ref-images"

# 写入 feicai-paths.json
ESCAPED_OUTPUTS=$(echo "$OUTPUTS_DIR" | sed 's/\\/\\\\/g; s/"/\\"/g')
echo "{
  \"baseOutputDir\": \"$ESCAPED_OUTPUTS\"
}" > "$APP_DIR/feicai-paths.json"

# ── Step 5: 清理残留 node 进程 ──
echo ""
echo "  正在清理残留进程..."
pkill -f "server.js.*FEICAI" 2>/dev/null || true
sleep 0.5
echo "  [√] 进程清理完成"

# ── Step 6: 启动服务 ──
echo ""
echo "  正在启动服务 (端口 $PORT)..."
echo "  浏览器地址: http://localhost:$PORT"
echo ""
echo "  关闭此终端窗口即可停止服务。"
echo ""

# 延迟 3.5 秒后自动打开浏览器
(sleep 3.5 && open "http://localhost:$PORT") &

# 启动 Node.js 服务
cd "$APP_DIR"
PORT=$PORT HOSTNAME=0.0.0.0 NODE_ENV=production node server.js
