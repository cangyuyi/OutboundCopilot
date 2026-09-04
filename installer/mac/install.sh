#!/bin/bash
# ================================================
#   Outbound Copilot v1.0.0 - macOS 一键安装脚本
#   外呼智能人工客服话术测试自动化流程
# ================================================
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

clear
echo -e "${BLUE}"
echo "================================================================"
echo "     ██████╗ ██╗   ██╗████████╗██████╗  ██████╗ ██╗   ██╗███╗   ██╗██████╗"
echo "    ██╔═══██╗██║   ██║╚══██╔══╝██╔══██╗██╔═══██╗██║   ██║████╗  ██║██╔══██╗"
echo "    ██║   ██║██║   ██║   ██║   ██████╔╝██║   ██║██║   ██║██╔██╗ ██║██║  ██║"
echo "    ██║   ██║██║   ██║   ██║   ██╔══██╗██║   ██║██║   ██║██║╚██╗██║██║  ██║"
echo "    ╚██████╔╝╚██████╔╝   ██║   ██████╔╝╚██████╔╝╚██████╔╝██║ ╚████║██████╔╝"
echo "     ╚═════╝  ╚═════╝    ╚═╝   ╚═════╝  ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚═════╝"
echo ""
echo "                  外呼智能人工客服话术测试自动化流程"
echo "                           macOS 版 v1.0.0"
echo "================================================================"
echo -e "${NC}"
echo ""

# 1. 环境检查
echo -e "${YELLOW}[1/6] 检查系统环境...${NC}"
MACOS_VER=$(sw_vers -productVersion | cut -d '.' -f 1)
if [ $MACOS_VER -lt 12 ]; then
    echo -e "${RED}❌ 系统版本过低，需要 macOS 12 Monterey 或更高版本${NC}"
    exit 1
fi
echo "✓ macOS 版本: $(sw_vers -productVersion)"

if ! command -v brew &> /dev/null; then
    echo "Homebrew 未安装，正在安装..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
    echo "✓ Homebrew 已就绪"
fi

# 2. 检查Chrome
echo ""
echo -e "${YELLOW}[2/6] 检查 Chrome 浏览器...${NC}"
if [ ! -d "/Applications/Google Chrome.app" ]; then
    echo "Chrome 未安装，正在使用Homebrew安装..."
    brew install --cask google-chrome
else
    echo "✓ Google Chrome 已安装"
fi

# 3. 安装Hammerspoon
echo ""
echo -e "${YELLOW}[3/6] 安装 Hammerspoon 自动化引擎...${NC}"
if ! brew list --cask hammerspoon &> /dev/null; then
    brew install --cask hammerspoon
    echo "✓ Hammerspoon 安装完成"
else
    echo "✓ Hammerspoon 已安装"
fi

# 4. 部署核心脚本
echo ""
echo -e "${YELLOW}[4/6] 部署核心脚本...${NC}"
mkdir -p ~/.hammerspoon
cp "$PROJECT_DIR/src/mac-hammerspoon.lua" ~/.hammerspoon/init.lua
echo "✓ 配置文件已部署到 ~/.hammerspoon/init.lua"

# 5. 启动服务
echo ""
echo -e "${YELLOW}[5/6] 启动 Outbound Copilot 服务...${NC}"
if pgrep -x Hammerspoon > /dev/null; then
    killall Hammerspoon
    sleep 2
fi
open -a Hammerspoon
sleep 2
echo "✓ 服务已启动，右上角菜单栏应该出现 ⚪ 图标"

# 6. Chrome扩展提示
echo ""
echo -e "${YELLOW}[6/6] Chrome 扩展安装步骤${NC}"
echo -e "${GREEN}"
echo "  1. 打开 Chrome 浏览器"
echo "  2. 地址栏输入:  chrome://extensions/"
echo "  3. 打开右上角「开发者模式」开关"
echo "  4. 点击「加载已解压的扩展程序」"
echo -e "  5. 选择文件夹:  ${PROJECT_DIR}/chrome-extension${NC}"
echo ""

echo -e "${RED}⚠️  最后一步：授予辅助功能权限（必须！否则热键不工作）${NC}"
echo "  1. 打开「系统设置」→「隐私与安全性」→「辅助功能」"
echo "  2. 找到 Hammerspoon，勾选允许"
echo "  3. 如果已经勾选，请取消后重新勾选一次"
echo ""

echo -e "${GREEN}"
echo "================================================================"
echo "   ✅ Outbound Copilot v1.0.0 安装完成！"
echo "================================================================"
echo -e "${NC}"
echo "快速开始："
echo "  1. 点击屏幕右上角菜单栏的 ⚪ 图标 → 启动服务"
echo "  2. 输入目标对话平台URL关键词（如 sh.planet.byai.com）"
echo "  3. 切换到对话页，鼠标放在输入框上按 ⌘+Shift+P 记录位置"
echo "  4. 点击飞书单元格复制 → 按鼠标侧键自动跳转粘贴"
echo ""
echo "📚 详细文档见项目 docs/ 目录"
echo ""
