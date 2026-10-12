# 网页打包桌面 EXE 工具（desktop-packager）

输入 **网址 + 网站名称 + 网站图标**，一键打包成 Windows 桌面软件：

| 产物 | 说明 |
|---|---|
| `xxx-安装包-1.0.0.exe` | NSIS 安装程序。双击安装，自动创建**桌面快捷方式**和**开始菜单**，支持自定义安装目录、卸载 |
| `xxx-便携版-1.0.0.exe` | 单文件便携版。双击即用，无需安装 |

打包出来的应用基于 Chromium（Electron），内置完整浏览器内核：支持登录、Cookie 记忆、下载、快捷键（`Alt+Left/Right` 后退前进、`Ctrl+R` 刷新、`Alt+Home` 回主页），网页弹出的新窗口会自动转到系统浏览器打开。

---

## 快速开始

### 方式一：交互式引导（推荐）

**Windows**：双击 `打包.bat`

> 注意：`打包.bat` 为 ANSI（GBK）编码，用记事本打开可能显示乱码，**属正常现象，不影响双击运行**；请勿在记事本中"另存为 UTF-8"，否则会再次出现命令报错。

**macOS / Linux**：

```bash
./打包.sh
```

首次运行会自动安装依赖（约 1–2 分钟）。随后按提示输入：

```
① 请输入要打包的网址，例如 https://www.example.com
② 请输入网站名称（桌面显示名）
③ 图标文件路径（回车使用默认图标）
确认开始打包？(y/n)
```

打包完成后，产物在 `dist/` 目录。

### 方式二：命令行（适合批量/脚本化）

```bash
node build-site-app.js --url "https://www.example.com" --name "我的网站" --icon logo.png
```

### 方式三：Windows 一键脚本传参

```bat
打包.bat --url "https://www.example.com" --name "我的网站" --icon logo.png --yes
```

---

## 全部参数

```
--url <网址>     要打包的网址（可省略 https://）
--name <名称>    网站名称 / 桌面显示名（默认取网址域名）
--icon <路径>    图标：PNG/JPG/WEBP/BMP/GIF/TIFF/ICO/SVG，任意尺寸自动放大到 512
--out <目录>     输出目录（默认 ./dist）
--target <类型>  installer=仅安装包  portable=仅便携版  both=两者（默认）
--no-toolbar     不显示 Alt 键导航菜单
--keep           保留临时工程（调试用）
--yes            跳过交互确认
```

示例：换一个网址、名称、图标再打一个包：

```bash
node build-site-app.js --url "https://news.example.com" --name "新闻早报" --icon news-icon.png
```

---

## 图标要求

**支持所有常见格式和任意大小**，一律自动处理为 Windows 需要的 512×512 图标：

| 格式 | 说明 |
|---|---|
| PNG / JPG / WEBP / BMP / GIF / TIFF / SVG | 任意尺寸|
| ICO |

处理引擎（自动选择）：
1. **sharp**（高质量，随依赖自动安装）——全格式
2. **内置零依赖引擎**（纯 JS，无需安装任何东西）——PNG / ICO
3. 系统工具（python3+PIL / ImageMagick）——兜底

需要图标则将图标上传到desktop-packager目录下即可

不传图标时使用内置默认图标（蓝青渐变地球）。打包时图标会自动生成 16/24/32/48/64/128/256 全套 Windows 尺寸。

## 环境要求

- Node.js ≥ 18：https://nodejs.org/zh-cn（安装时勾选"Add to PATH"）
- **Windows 上直接使用，无需任何额外依赖**
- macOS / Linux 上交叉打包 Windows 安装包时，需要 wine（工具会自动检测并给出安装提示）

## 工作原理

1. 用 Electron 应用模板生成桌面壳（`app-template/`），把网址、名称、图标注入配置
2. 调用 electron-builder 打包为 Windows x64 应用，自动生成安装包（NSIS）与便携版
3. 产物从 GitHub/国内镜像自动下载 Electron 运行时（首次约 110MB，之后有缓存）

## 常见问题

- **图标报 "Icon must be at least 256x256 pixels"？** 旧版本不支持小图标（如 48×48 的 ICO）。**v1.0.2 起已解决**：任意格式、任意大小的图标都会自动放大到 512×512，请下载最新版。
- **双击 `打包.bat` 报一串"xxx 不是内部或外部命令"？** 这是旧版 `打包.bat` 的编码问题（UTF-8 批处理在中文 Windows 的 GBK 代码页下解析错乱）。请使用本次修复后的版本：ANSI(GBK) 编码 + CRLF 行尾。若仍报错，请确认 `打包.bat` 没有被记事本另存为 UTF-8。
- **首次打包很慢？** 正在下载 Electron 运行时（约 110MB），工具已默认走国内镜像（npmmirror），完成后有本地缓存，之后很快。
- **杀毒软件报毒/拦截？** 打包产物未做代码签名，个别杀软会对未签名的新 EXE 误报。属正常现象，添加信任即可；正式对外分发建议申请代码签名证书。
- **桌面图标不更新？** Windows 有图标缓存，重装后若图标未刷新，重启资源管理器（任务管理器 → 重启"Windows 资源管理器"）即可。
- **网页需要最新浏览器特性？** 内置的是最新稳定版 Chromium（Electron 44），支持现代 Web 标准。


## 目录结构

```
desktop-packager/
├── build-site-app.js      # 打包工具主程序（CLI）
├── 打包.bat               # Windows 一键启动
├── 打包.sh                # macOS/Linux 一键启动
├── app-template/          # Electron 应用模板
│   ├── main.js
│   ├── preload.js
│   └── build/icon.png     # 默认图标
├── scripts/               # 图标生成 / 转换 / 产物校验脚本
└── dist/                  # 打包产物输出目录
```
