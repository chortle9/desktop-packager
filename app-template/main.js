// 本文件由 site-desktop-packager 生成，请勿直接修改
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_NAME = '__APP_NAME__';
const APP_URL = '__APP_URL__';
const APP_ID = '__APP_ID__';
const SHOW_MENU = __SHOW_MENU__;

let win = null;

function buildMenu() {
  if (!SHOW_MENU) return null;
  const go = (fn) => () => { if (win && !win.isDestroyed()) fn(); };
  const template = [
    {
      label: '导航',
      submenu: [
        { label: '后退', accelerator: 'Alt+Left', click: go(() => win.webContents.goBack()) },
        { label: '前进', accelerator: 'Alt+Right', click: go(() => win.webContents.goForward()) },
        { label: '刷新', accelerator: 'CmdOrCtrl+R', click: go(() => win.webContents.reload()) },
        { label: '主页', accelerator: 'Alt+Home', click: go(() => win.loadURL(APP_URL)) },
        { type: 'separator' },
        { label: '在系统浏览器中打开', click: () => { const u = win.webContents.getURL() || APP_URL; if (u) shell.openExternal(u); } },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

function createWindow() {
  const iconFile = fs.existsSync(path.join(__dirname, 'build', 'icon.png'))
    ? path.join(__dirname, 'build', 'icon.png')
    : path.join(__dirname, 'build', 'icon.ico');

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 360,
    title: APP_NAME,
    icon: iconFile,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.setMenu(buildMenu());

  // 窗口标题固定为应用名，避免被网页标题覆盖
  win.on('page-title-updated', (e) => e.preventDefault());

  // 网页里打开的弹窗一律交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 阻止导航到非 http(s) 地址（防止被引导到本地文件等）
  const guard = (e, url) => { if (!/^https?:/i.test(url)) e.preventDefault(); };
  win.webContents.on('will-navigate', guard);
  win.webContents.on('will-redirect', guard);

  win.on('closed', () => { win = null; });
  win.loadURL(APP_URL);
}

// Windows 任务栏图标分组
app.setAppUserModelId(APP_ID);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
