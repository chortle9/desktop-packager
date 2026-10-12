#!/usr/bin/env node
/**
 * site-desktop-packager —— 网页打包桌面 EXE 工具
 *
 * 给一个网址 + 网站名称 + 网站图标，生成 Windows 桌面应用：
 *   - 安装包（NSIS 安装程序，可安装到开始菜单/桌面快捷方式）
 *   - 便携版（单个 EXE，双击即用）
 *
 * 用法:
 *   node build-site-app.js                                   # 交互式引导（推荐）
 *   node build-site-app.js --url https://a.com --name 名称 --icon icon.png --out dist
 *
 * 参数:
 *   --url <网址>     要打包的网址（http/https，可省略协议头）
 *   --name <名称>    网站名称 / 桌面显示名（默认取网址域名）
 *   --icon <路径>    网站图标：PNG/JPG/WEBP/BMP/GIF/TIFF/ICO/SVG，任意尺寸自动放大
 *   --out <目录>     输出目录（默认 ./dist）
 *   --target <类型>  installer=仅安装包  portable=仅便携版  both=两者(默认)
 *   --no-toolbar     隐藏 Alt 键导航菜单（后退/前进/刷新/主页）
 *   --keep           保留临时工程（调试用）
 *   --yes            跳过交互确认
 *   -h, --help       帮助
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const readline = require('readline/promises');
const { toSquarePng512, icoMaxSize } = require('./scripts/iconlib');

const TOOL_ROOT = __dirname;
const TEMPLATE_DIR = path.join(TOOL_ROOT, 'app-template');
const DEFAULT_ICON = path.join(TEMPLATE_DIR, 'build', 'icon.png');
const ELECTRON_VERSION = '44.7.0'; // 打包所用的 Electron 版本（2026-10 最新稳定版）
const TARGETS = { installer: 'nsis', portable: 'portable', both: 'nsis portable' };

/* ---------------- 基础工具 ---------------- */

function fail(msg) {
  console.error('\n[错误] ' + msg);
  process.exit(1);
}

function printHelp() {
  console.log(`site-desktop-packager —— 网页打包桌面 EXE 工具

用法:
  node build-site-app.js                                   # 交互式引导
  node build-site-app.js --url https://a.com --name 名称 --icon icon.png

参数:
  --url <网址>     要打包的网址（可省略 https://）
  --name <名称>    网站名称（默认取网址域名）
  --icon <路径>    图标：PNG/JPG/WEBP/BMP/GIF/ICO/SVG 均可，任意尺寸自动放大到 512
  --out <目录>     输出目录（默认 ./dist）
  --target <类型>  installer | portable | both（默认 both）
  --no-toolbar     不显示 Alt 导航菜单
  --keep           保留临时工程
  --yes            跳过确认
`);
}

function parseArgs(argv) {
  const opts = { url: null, name: null, icon: null, out: null, target: 'both', toolbar: true, keep: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) fail(`缺少 ${a} 的值`); return v; };
    switch (a) {
      case '--url': opts.url = next(); break;
      case '--name': opts.name = next(); break;
      case '--icon': opts.icon = next(); break;
      case '--out': opts.out = next(); break;
      case '--target': opts.target = next().toLowerCase(); break;
      case '--no-toolbar': opts.toolbar = false; break;
      case '--keep': opts.keep = true; break;
      case '--yes': opts.yes = true; break;
      case '-h': case '--help': printHelp(); process.exit(0);
      default: fail(`未知参数: ${a}（用 --help 查看用法）`);
    }
  }
  if (!TARGETS[opts.target]) fail(`--target 可选值: ${Object.keys(TARGETS).join(' / ')}`);
  return opts;
}

function normalizeUrl(raw) {
  let u = String(raw).trim();
  if (!u) fail('网址不能为空');
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u)) u = 'https://' + u;
  let parsed;
  try { parsed = new URL(u); } catch { fail(`网址无效: ${raw}`); }
  if (!/^https?:$/.test(parsed.protocol)) fail('仅支持 http / https 网址');
  return parsed.href;
}

function slugify(name) {
  const s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^[0-9]+/, '');
  return s || 'siteapp';
}

/** 生成唯一应用ID（中文名等无法转英文时用哈希兜底，避免不同网站撞 ID） */
function appIdFor(name) {
  const s = slugify(name);
  if (s) return 'com.siteapp.' + s;
  const h = crypto.createHash('sha1').update(String(name)).digest('hex').slice(0, 10);
  return 'com.siteapp.app' + h;
}

function safeFilename(name) {
  return String(name).replace(/[\\/:*?"<>|\r\n]+/g, '-').replace(/\s+/g, ' ').trim() || 'app';
}

function pngSize(file) {
  try {
    const b = fs.readFileSync(file);
    if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  } catch { return null; }
}

/* ---------------- 交互式引导 ---------------- */

async function interactiveGather(opts) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const q = (msg, def) => rl.question(msg + (def ? `（默认: ${def}）` : '') + '：').then(a => a.trim() || def || '');
    if (!opts.url) opts.url = await q('① 请输入要打包的网址，例如 https://www.example.com');
    if (!opts.name) {
      let def = '';
      try { def = new URL(normalizeUrl(opts.url)).hostname; } catch {}
      opts.name = await q('② 请输入网站名称（桌面显示名）', def);
    }
    if (!opts.icon) opts.icon = (await q('③ 图标文件路径（回车使用默认图标）', null)) || null;
    if (!opts.target) opts.target = 'both';
    const ok = await q('确认开始打包？(y/n)', 'y');
    if (!/^y/i.test(ok)) fail('已取消');
  } finally { rl.close(); }
}

/* ---------------- 图标处理（三级引擎，支持任意格式与大小） ---------------- */

let sharpLib = undefined;
function getSharp() {
  if (sharpLib === undefined) {
    try { sharpLib = require('sharp'); } catch { sharpLib = null; }
  }
  return sharpLib;
}

/** 引擎一：sharp（全格式高质量，PNG/JPG/WEBP/BMP/GIF/TIFF/ICO/SVG） */
async function convertWithSharp(src, out) {
  const sharp = getSharp();
  const meta = await sharp(src).metadata();
  const pages = meta.pages || 1;
  let best = 0, bestIdx = 0;
  for (let i = 0; i < pages; i++) {
    const m = await sharp(src, { page: i }).metadata();
    const s = (m.width || 0) * (m.height || 0);
    if (s > best) { best = s; bestIdx = i; }
  }
  await sharp(src, { page: bestIdx })
    .resize(512, 512, { fit: 'cover', kernel: 'lanczos3' })
    .png()
    .toFile(out);
  return true;
}

/** 引擎三：python3+PIL / ImageMagick（系统工具回退） */
function convertImage(src, out, size) {
  const py = path.join(TOOL_ROOT, 'scripts', 'img_convert.py');
  const r1 = spawnSync('python3', [py, src, out, String(size)], { encoding: 'utf8' });
  if (r1.status === 0 && fs.existsSync(out)) return true;
  const r2 = spawnSync('convert', [src, '-resize', `${size}x${size}`, '-background', 'none', out], { encoding: 'utf8' });
  if (r2.status === 0 && fs.existsSync(out)) return true;
  return false;
}

/**
 * 返回应用工程内图标路径（build/icon.png 或 build/icon.ico）。
 * 处理链：合格大图直接用 → sharp → 内置纯JS引擎(png/ico) → 系统工具
 */
async function prepareIcon(iconPath, appDir) {
  const buildDir = path.join(appDir, 'build');
  fs.mkdirSync(buildDir, { recursive: true });

  if (!iconPath) {
    fs.copyFileSync(DEFAULT_ICON, path.join(buildDir, 'icon.png'));
    return 'build/icon.png';
  }
  const iconAbs = path.resolve(iconPath);
  if (!fs.existsSync(iconAbs)) fail(`找不到图标文件: ${iconPath}`);
  const ext = path.extname(iconAbs).toLowerCase();
  const outPng = path.join(buildDir, 'icon.png');

  // 0) 本身已是合格大图（PNG≥256 / ICO 内含 ≥256 帧）→ 原样使用，保真最快
  if (ext === '.png') {
    const sz = pngSize(iconAbs);
    if (sz && sz.w >= 256 && sz.h >= 256) {
      fs.copyFileSync(iconAbs, outPng);
      return 'build/icon.png';
    }
  }
  if (ext === '.ico') {
    const max = icoMaxSize(fs.readFileSync(iconAbs));
    if (max && max.w >= 256 && max.h >= 256) {
      fs.copyFileSync(iconAbs, path.join(buildDir, 'icon.ico'));
      return 'build/icon.ico';
    }
  }

  // 1) sharp：任意格式、任意大小、自动取最大帧放大到 512
  if (getSharp()) {
    try {
      await convertWithSharp(iconAbs, outPng);
      console.log(`  [图标] 已用 sharp 处理 ${ext} 图标 → 512x512 PNG`);
      return 'build/icon.png';
    } catch (e) {
      console.warn(`  [提示] sharp 处理失败（${e.message}），尝试内置引擎...`);
    }
  }

  // 2) 内置纯 JS 引擎：PNG / ICO（含 DIB 位图解析）
  if (ext === '.png' || ext === '.ico') {
    const png = toSquarePng512(fs.readFileSync(iconAbs), ext);
    if (png) {
      fs.writeFileSync(outPng, png);
      console.log(`  [图标] 已用内置引擎把 ${ext} 图标放大为 512x512 PNG`);
      return 'build/icon.png';
    }
    console.warn('  [提示] 内置引擎无法解析该图标，尝试系统工具...');
  }

  // 3) 系统工具（python3+PIL / ImageMagick）
  if (['.png', '.ico', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.svg'].includes(ext)) {
    if (convertImage(iconAbs, outPng, 512)) {
      console.log('  [图标] 已用系统工具把图标处理为 512x512 PNG');
      return 'build/icon.png';
    }
  }

  fail(`无法处理图标: ${iconAbs}（支持 PNG/JPG/WEBP/BMP/GIF/TIFF/ICO/SVG，任意尺寸会自动放大）。`);
}

/* ---------------- 生成应用工程 ---------------- */

async function scaffoldApp(cfg) {
  const appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'siteapp-'));
  const readTpl = (f) => fs.readFileSync(path.join(TEMPLATE_DIR, f), 'utf8');

  let main = readTpl('main.js')
    .replace('__APP_NAME__', cfg.name)
    .replace('__APP_URL__', cfg.url)
    .replace('__APP_ID__', cfg.appId)
    .replace('__SHOW_MENU__', cfg.toolbar ? 'true' : 'false');
  let preload = readTpl('preload.js')
    .replace('__APP_NAME__', cfg.name)
    .replace('__APP_URL__', cfg.url);
  fs.writeFileSync(path.join(appDir, 'main.js'), main);
  fs.writeFileSync(path.join(appDir, 'preload.js'), preload);

  const iconInApp = await prepareIcon(cfg.icon, appDir);
  const files = ['main.js', 'preload.js', 'package.json', iconInApp];
  const artifactBase = safeFilename(cfg.name);

  const pkg = {
    name: cfg.slug,
    productName: cfg.name,
    version: '1.0.0',
    description: `${cfg.name} 桌面版（由 site-desktop-packager 生成）`,
    author: 'site-desktop-packager',
    license: 'MIT',
    main: 'main.js',
    build: {
      appId: cfg.appId,
      productName: cfg.name,
      directories: { output: 'release', buildResources: 'build' },
      files,
      asar: true,
      electronVersion: ELECTRON_VERSION,
      win: {
        icon: iconInApp,
        target: [
          { target: 'nsis', arch: ['x64'] },
          { target: 'portable', arch: ['x64'] },
        ],
      },
      nsis: {
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: cfg.name,
        deleteAppDataOnUninstall: false,
        artifactName: `${artifactBase}-安装包-${'${version}'}.${'${ext}'}`,
      },
      portable: {
        artifactName: `${artifactBase}-便携版-${'${version}'}.${'${ext}'}`,
      },
    },
  };
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(pkg, null, 2));
  return appDir;
}

/* ---------------- 执行打包 ---------------- */

function checkWineOnNonWindows() {
  // 在 macOS / Linux 上交叉打包 Windows 安装包时，NSIS 构建需要 wine
  if (process.platform === 'win32') return;
  const r = spawnSync('wine', ['--version'], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('');
    console.error('[提示] 当前系统未安装 wine，构建 Windows 安装包需要它（仅首次需要）。');
    console.error('       安装方法（任选其一）：');
    console.error('       · macOS:  brew install --cask wine-stable');
    console.error('       · Debian/Ubuntu:  sudo dpkg --add-architecture i386 && sudo apt update && sudo apt install -y wine64 wine32');
    console.error('       · 或者直接在 Windows 电脑上运行本工具，无需 wine');
    console.error('');
  }
}

function runBuilder(appDir, target) {
  const cli = path.join(TOOL_ROOT, 'node_modules', 'electron-builder', 'cli.js');
  if (!fs.existsSync(cli)) fail('未安装 electron-builder，请先运行: npm install');
  checkWineOnNonWindows();
  const targets = TARGETS[target];
  const args = [cli, '--win', ...targets.split(' '), '--x64'];
  // 默认走国内镜像，避免 GitHub 直连不稳定导致下载失败（可用环境变量覆盖）
  const env = {
    ...process.env,
    npm_config_yes: 'true',
    ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
    ELECTRON_BUILDER_BINARIES_MIRROR: process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/',
  };
  console.log(`\n开始打包（Electron ${ELECTRON_VERSION}，首次运行需下载约 110MB 运行时，请耐心等待）...`);
  const r = spawnSync(process.execPath, args, { cwd: appDir, stdio: 'inherit', env });
  return r.status === 0;
}

function collectArtifacts(appDir, outDir) {
  const release = path.join(appDir, 'release');
  if (!fs.existsSync(release)) fail('打包流程异常结束：未找到产物目录');
  const exes = fs.readdirSync(release).filter(f => f.endsWith('.exe'));
  if (!exes.length) fail('未找到 .exe 产物');
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];
  for (const f of exes) {
    const src = path.join(release, f);
    const dst = path.join(outDir, f);
    fs.copyFileSync(src, dst);
    const st = fs.statSync(dst);
    results.push({ file: f, sizeMB: (st.size / 1024 / 1024).toFixed(1), abs: dst });
  }
  return results;
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.yes && process.stdin.isTTY && (!opts.url || !opts.name)) {
    await interactiveGather(opts);
  }
  if (!opts.url) fail('缺少网址。请用 --url 指定，或直接运行命令进入交互式引导');

  const url = normalizeUrl(opts.url);
  const name = (opts.name || new URL(url).hostname).trim();
  const cfg = {
    url,
    name,
    slug: slugify(name),
    appId: appIdFor(name),
    icon: opts.icon,
    toolbar: opts.toolbar,
  };

  const outDir = path.resolve(TOOL_ROOT, opts.out || 'dist');
  console.log(`\n======== 打包配置 ========
网址   : ${url}
名称   : ${name}
应用ID : ${cfg.appId}
图标   : ${cfg.icon || '默认内置图标'}
输出   : ${outDir}
目标   : ${TARGETS[opts.target].split(' ').join(' + ')}
============================`);

  const appDir = await scaffoldApp(cfg);
  const ok = runBuilder(appDir, opts.target);
  if (!ok) {
    console.error('\n[错误] 打包失败，详见上方日志。临时工程保留在: ' + appDir);
    process.exit(1);
  }
  const results = collectArtifacts(appDir, outDir);
  console.log('\n======== 打包完成 ========');
  for (const r of results) console.log(`✓ ${r.file}  (${r.sizeMB} MB)\n  ${r.abs}`);
  console.log('==========================\n');
  console.log('安装包: 在 Windows 上双击安装，会自动创建桌面与开始菜单快捷方式。');
  console.log('便携版: 在 Windows 上双击直接运行，无需安装。');
  if (!opts.keep) fs.rmSync(appDir, { recursive: true, force: true });
}

main().catch((e) => fail(e && e.message ? e.message : String(e)));
