@echo off
rem ==============================================
rem  网页打包桌面 EXE 工具 - 一键启动
rem  本文件为 ANSI(GBK) 编码，请勿用记事本另存为 UTF-8
rem ==============================================
cd /d "%~dp0"

where node >nul 2>nul
if not %errorlevel%==0 (
  echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org/zh-cn
  echo 安装完成后重新双击本文件即可。
  pause
  exit /b 1
)

where npm >nul 2>nul
if not %errorlevel%==0 (
  echo [错误] 未检测到 npm，请重新安装 Node.js：https://nodejs.org/zh-cn
  pause
  exit /b 1
)

if exist node_modules goto run
echo 首次运行，正在安装依赖（约 1-2 分钟，请耐心等待）...
call npm install --no-audit --no-fund
if not %errorlevel%==0 (
  echo [错误] 依赖安装失败，请检查网络后重试。
  pause
  exit /b 1
)

:run
chcp 65001 >nul
node build-site-app.js %*
pause
