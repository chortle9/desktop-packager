#!/usr/bin/env bash
# 网页打包桌面 EXE 工具（macOS / Linux 启动脚本）
set -e
cd "$(dirname "$0")"

command -v node >/dev/null 2>&1 || { echo "[错误] 未检测到 Node.js，请先安装: https://nodejs.org/zh-cn"; exit 1; }

if [ ! -d node_modules ]; then
  echo "首次运行，正在安装依赖（约 1-2 分钟）..."
  npm install --no-audit --no-fund
fi

exec node build-site-app.js "$@"
