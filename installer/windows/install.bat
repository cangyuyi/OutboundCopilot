@echo off
chcp 65001 >nul
title Outbound Copilot v1.0.0 - 安装程序
color 0B

echo ================================================================
echo    ██████╗ ██╗   ██╗████████╗██████╗  ██████╗ ██╗   ██╗███╗   ██╗██████╗
echo   ██╔═══██╗██║   ██║╚══██╔══╝██╔══██╗██╔═══██╗██║   ██║████╗  ██║██╔══██╗
echo   ██║   ██║██║   ██║   ██║   ██████╔╝██║   ██║██║   ██║██╔██╗ ██║██║  ██║
echo   ██║   ██║██║   ██║   ██║   ██╔══██╗██║   ██║██║   ██║██║╚██╗██║██║  ██║
echo   ╚██████╔╝╚██████╔╝   ██║   ██████╔╝╚██████╔╝╚██████╔╝██║ ╚████║██████╔╝
echo    ╚═════╝  ╚═════╝    ╚═╝   ╚═════╝  ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚═════╝
echo.
echo                  外呼智能人工客服话术测试自动化流程
echo                           Windows 版 v1.0.0
echo ================================================================
echo.

set SCRIPT_DIR=%~dp0
set PROJECT_DIR=%SCRIPT_DIR%..\..

echo [1/5] 检查 AutoHotkey v2 运行环境...
where ahk >nul 2>&1
if %errorlevel% neq 0 (
    echo 正在下载 AutoHotkey v2...
    powershell -Command "Invoke-WebRequest -Uri 'https://www.autohotkey.com/download/ahk-v2.exe' -OutFile '%TEMP%\ahk-install.exe'"
    echo 正在静默安装 AutoHotkey...
    start /wait "" "%TEMP%\ahk-install.exe" /S
    echo ✓ AutoHotkey 安装完成
) else (
    echo ✓ AutoHotkey v2 已安装
)

echo.
echo [2/5] 部署程序文件...
set INSTALL_DIR=%APPDATA%\OutboundCopilot
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy "%PROJECT_DIR%\src\win-autohotkey.ahk" "%INSTALL_DIR%\outbound-copilot.ahk" >nul
echo ✓ 文件已部署到 %INSTALL_DIR%

echo.
echo [3/5] 创建快捷方式...
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\OutboundCopilot.lnk'); $s.TargetPath = '%INSTALL_DIR%\outbound-copilot.ahk'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.Save()"
echo ✓ 开机自启动已配置
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%USERPROFILE%\Desktop\OutboundCopilot.lnk'); $s.TargetPath = '%INSTALL_DIR%\outbound-copilot.ahk'; $s.WorkingDirectory = '%INSTALL_DIR%'; $s.Save()"
echo ✓ 桌面快捷方式已创建

echo.
echo [4/5] 启动服务...
start "" "%INSTALL_DIR%\outbound-copilot.ahk"
echo ✓ Outbound Copilot 已启动，右下角系统托盘出现图标

echo.
echo [5/5] Chrome 扩展安装
echo.
echo   1. 打开 Chrome 浏览器
echo   2. 地址栏输入:  chrome://extensions/
echo   3. 打开右上角「开发者模式」开关
echo   4. 点击「加载已解压的扩展程序」
echo   5. 选择文件夹: %PROJECT_DIR%\chrome-extension
echo.

echo ================================================================
echo    ✅ Outbound Copilot v1.0.0 安装完成！
echo ================================================================
echo.
echo 快速开始：
echo   1. 右键点击右下角托盘图标 → 启动服务
echo   2. 输入目标对话平台URL关键词
echo   3. 切换到对话页，鼠标放在输入框上按 Ctrl+Shift+P 记录位置
echo   4. 点击飞书单元格复制 → 按鼠标侧键自动跳转粘贴
echo.
echo 📚 详细文档见项目 docs/ 目录
echo.
pause
