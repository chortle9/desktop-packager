// 本文件由 site-desktop-packager 生成，请勿直接修改
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('siteApp', {
  name: '__APP_NAME__',
  url: '__APP_URL__',
});
