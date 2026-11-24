// 网页和配对页能调的几个桌面功能（只开这几个，网页拿不到 Node / Electron）
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('OperoDesktop', {
  /** 配对页：连接你的 Opero */
  pair: (server, code) => ipcRenderer.invoke('pair', server, code),
  strings: () => ipcRenderer.invoke('strings'),
  /** 网页：托盘角标（等你处理的数量） */
  setBadge: (n) => ipcRenderer.send('badge', n),
  /** 网页：用系统浏览器打开（邮件、Slack 原消息） */
  openExternal: (url) => ipcRenderer.send('external', url),
})
