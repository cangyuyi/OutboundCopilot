# 自动化部署指南
## For AI Agent / DevOps

本文档用于自动化部署脚本/AI Agent自主完成项目安装部署。

---

## 部署前检查

### macOS 环境检查
```bash
# 检查系统版本
sw_vers -productVersion  # 需要 >= 12.0

# 检查Homebrew
command -v brew || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 检查Chrome
ls /Applications/Google\ Chrome.app || brew install --cask google-chrome
```

### Windows 环境检查
```powershell
# 检查Chrome
Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe"
# 如不存在，下载安装：https://dl.google.com/chrome/install/googlechromestandaloneenterprise64.msi
```

---

## macOS 全自动部署脚本
```bash
#!/bin/bash
set -e
PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"

# 1. 安装Hammerspoon
brew install --cask hammerspoon

# 2. 部署配置
mkdir -p ~/.hammerspoon
cp "$PROJECT_DIR/src/mac-hammerspoon.lua" ~/.hammerspoon/init.lua

# 3. 启动Hammerspoon
pkill Hammerspoon || true
sleep 1
open -a Hammerspoon

# 4. 提示用户配置辅助功能权限（必须用户手动点击确认）
osascript -e 'display dialog "请授予辅助功能权限：
系统设置 → 隐私与安全性 → 辅助功能
勾选 Hammerspoon（如已勾选请取消重选）

完成后点击确定" buttons {"确定"} default button 1 with title "权限配置提示"'

echo "部署完成，请安装Chrome扩展：$PROJECT_DIR/chrome-extension"
```

---

## Windows 全自动部署脚本（PowerShell）
```powershell
$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# 1. 安装AutoHotkey v2
if (-not (Get-Command ahk -ErrorAction SilentlyContinue)) {
    Invoke-WebRequest -Uri 'https://www.autohotkey.com/download/ahk-v2.exe' -OutFile "$env:TEMP\ahk-install.exe"
    Start-Process -Wait "$env:TEMP\ahk-install.exe" -ArgumentList '/S'
}

# 2. 复制脚本到AppData
$dest = "$env:APPDATA\OutboundCopilot"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item "$projectDir\src\win-autohotkey.ahk" "$dest\outbound-copilot.ahk"

# 3. 创建启动快捷方式
$ws = New-Object -ComObject WScript.Shell
$startup = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup"
$sc = $ws.CreateShortcut("$startup\OutboundCopilot.lnk")
$sc.TargetPath = "$dest\outbound-copilot.ahk"
$sc.Save()

# 4. 启动
Start-Process "$dest\outbound-copilot.ahk"

Write-Host "部署完成，请安装Chrome扩展：$projectDir\chrome-extension"
```

---

## Chrome扩展企业批量部署
对于团队批量使用，可通过Chrome企业策略强制安装扩展：
1. 将扩展打包为crx，托管在内部服务器
2. 通过组策略配置`ExtensionInstallForcelist`自动推送安装
3. 无需用户手动开启开发者模式

---

## 安装后验收标准

部署完成后，按以下步骤验证：
- [ ] Chrome扩展已加载，在`chrome://extensions/`中可见且启用
- [ ] Hammerspoon/AHK已启动，菜单栏/托盘可见图标
- [ ] 点击菜单栏图标可以正常开启，输入URL后状态变🟢
- [ ] 打开飞书表格，点击单元格出现绿色"已复制"Toast
- [ ] 打开目标对话页，按`⌘/Ctrl+Shift+P`可以记录坐标
- [ ] 复制单元格内容后，按快捷键可以正常跳转、粘贴

---

## 企业部署注意事项
1. **辅助功能权限**：macOS企业管控设备可能需要MDM配置隐私权限策略，允许Hammerspoon控制电脑
2. **Chrome策略**：部分企业禁止开发者模式扩展，需要将扩展发布到Chrome应用商店或通过企业策略推送
3. **杀毒软件**：AHK脚本可能被部分杀毒软件误报，需要加白名单
4. **鼠标驱动**：部分办公鼠标的驱动软件会接管侧键功能，需要在驱动中将侧键设为默认的"浏览器后退/前进"
