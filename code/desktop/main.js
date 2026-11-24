// Opero 桌面端（Electron）：一个窗口打开你自己的 Opero 网页；托盘显示「等你处理」的数量；要你决定的事、出错弹系统通知，点了直达那个会话。
// 和安卓外壳一样用「设备配对」：网页「我 → 账号安全 → 接手机」拿配对码 → 这里填地址和配对码 → 拿到设备令牌（加密存在本机）。
// 之后：用设备令牌换一张一次性的票登进网页（/api/app/ticket → /api/app/enter），后台长轮询 /api/app/push 收提醒。
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, safeStorage, shell, dialog, session } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { pick } = require('./i18n.js')

const VERSION = require('./package.json').version
let t = pick('en')
const CONF = () => path.join(app.getPath('userData'), 'opero.json')
const TOKEN = () => path.join(app.getPath('userData'), 'device-token.bin')

let win = null
let tray = null
let conf = { server: '', deviceId: '' }
let token = ''
let waiting = 0
let quitting = false

// ---------- 本机保存：地址、设备编号（明文），设备令牌（系统钥匙串加密） ----------
function load() {
  try { conf = { ...conf, ...JSON.parse(fs.readFileSync(CONF(), 'utf8')) } } catch { /* 第一次 */ }
  if (!conf.deviceId) { conf.deviceId = `desk-${crypto.randomUUID()}`; save() }
  try {
    const raw = fs.readFileSync(TOKEN())
    token = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')
  } catch { token = '' }
}
function save() { fs.mkdirSync(path.dirname(CONF()), { recursive: true }); fs.writeFileSync(CONF(), JSON.stringify(conf, null, 1)) }
function saveToken(v) {
  token = v
  if (!v) { try { fs.unlinkSync(TOKEN()) } catch { /* 没有 */ } return }
  fs.writeFileSync(TOKEN(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(v) : Buffer.from(v), { mode: 0o600 })
}

async function api(method, p, body) {
  const r = await fetch(conf.server + p, {
    method, headers: { 'Content-Type': 'application/json', 'X-Opero': '1', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(p.startsWith('/api/app/push') ? 45_000 : 20_000),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(j.message || `HTTP ${r.status}`); e.status = r.status; throw e }
  return j
}

// ---------- 窗口 ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600, title: 'Opero', show: false,
    icon: iconPath(), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  })
  win.once('ready-to-show', () => win.show())
  // 关窗口 = 藏到托盘（还在收提醒）；托盘里「退出」才真的退出
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide() } })
  // 别的网站的链接交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e, url) => { if (conf.server && !url.startsWith(conf.server) && !url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url) } })
  openHome()
}

async function openHome(route = '') {
  if (!token || !conf.server) { win.loadFile(path.join(__dirname, 'pair.html'), { query: { server: conf.server || '' } }); return }
  try {
    const r = await api('POST', '/api/app/ticket', { route })
    await win.loadURL(conf.server + r.url)
  } catch (e) {
    if (e.status === 401) { saveToken(''); win.loadFile(path.join(__dirname, 'pair.html'), { query: { server: conf.server, msg: t.unpaired } }); return }
    win.loadFile(path.join(__dirname, 'pair.html'), { query: { server: conf.server, msg: e.message } })
  }
}

function show(route) {
  if (!win) return
  win.show()
  win.focus()
  if (route) win.webContents.executeJavaScript(`window.__operoNative && window.__operoNative.open(${JSON.stringify(route)})`).catch(() => openHome(route))
}

// ---------- 托盘：等你处理几件、打开、断开、退出 ----------
function iconPath() { const p = path.join(__dirname, 'assets', 'icon.png'); return fs.existsSync(p) ? p : undefined }
function trayMenu() {
  if (!tray) return
  tray.setToolTip(waiting ? `Opero · ${t.waiting.replace('%d', waiting)}` : 'Opero')
  if (process.platform === 'darwin') tray.setTitle(waiting ? String(waiting) : '')
  app.setBadgeCount?.(waiting)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t.waiting.replace('%d', waiting), enabled: waiting > 0, click: () => show('') },
    { label: t.open, click: () => show('') },
    { type: 'separator' },
    { label: t.unpair, enabled: !!token, click: unpair },
    { label: t.quit, click: () => { quitting = true; app.quit() } },
  ]))
}
function createTray() {
  const p = iconPath()
  const img = p ? nativeImage.createFromPath(p).resize({ width: 18, height: 18 }) : nativeImage.createEmpty()
  tray = new Tray(img)
  tray.on('click', () => show(''))
  trayMenu()
}

/** 等你处理的数量：会话里「要你决定」的个数（用网页登录的 cookie 读） */
async function refreshWaiting() {
  if (!token || !conf.server) return
  try {
    const r = await session.defaultSession.fetch(conf.server + '/api/bootstrap', { headers: { 'X-Opero': '1' } })
    const b = await r.json()
    if (!b?.auth?.loggedIn) return
    waiting = (b.sessions || []).filter((s) => s.waiting).length
    trayMenu()
  } catch { /* 下次再看 */ }
}

// ---------- 提醒：长轮询 /api/app/push ----------
let after = -1
async function pushLoop() {
  for (;;) {
    if (!token || !conf.server) { await sleep(5000); continue }
    try {
      const r = await api('GET', `/api/app/push?after=${after}&wait=25&device=${encodeURIComponent(conf.deviceId)}`)
      if (after < 0) after = r.last
      else for (const it of r.items || []) {
        after = Math.max(after, it.id)
        if (Notification.isSupported()) {
          const n = new Notification({ title: it.title || 'Opero', body: it.body || '', urgency: it.kind === 'decide' || it.error ? 'critical' : 'normal', icon: iconPath() })
          n.on('click', () => show(it.route || ''))
          n.show()
        }
      }
      refreshWaiting()
    } catch (e) {
      if (e.status === 401 || e.status === 404) { saveToken(''); trayMenu(); continue }
      await sleep(10_000)
    }
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- 配对（pair.html 调） ----------
ipcMain.handle('pair', async (_e, server, code) => {
  const base = String(server || '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\/[^\s/]+/.test(base)) throw new Error(t.notOpero)
  conf.server = base
  save()
  let h
  try { h = await api('GET', '/api/health') } catch (e) { throw new Error(`${t.notOpero}：${e.message}`) }
  if (!h || !h.ok) throw new Error(t.notOpero)
  const r = await api('POST', '/api/app/pair', { code: String(code || '').trim(), deviceId: conf.deviceId, name: `${require('node:os').hostname()}（${t.open.replace(/^.* /, '')}）`.slice(0, 60), platform: `desktop-${process.platform}`, appVersion: VERSION })
  saveToken(r.deviceToken)
  trayMenu()
  openHome()
  return true
})
ipcMain.handle('strings', () => t)

async function unpair() {
  const r = await dialog.showMessageBox(win, { type: 'question', buttons: [t.unpair, 'Cancel'], defaultId: 1, message: t.confirmUnpair })
  if (r.response !== 0) return
  try { await api('DELETE', `/api/app/devices/${encodeURIComponent(conf.deviceId)}`) } catch { /* 后台那边可能已经断了 */ }
  saveToken('')
  await session.defaultSession.clearStorageData({ storages: ['cookies'] })
  waiting = 0
  trayMenu()
  openHome()
}

// 网页调（preload 里的 OperoDesktop）：角标、外部链接
ipcMain.on('badge', (_e, n) => { waiting = Math.max(0, Number(n) || 0); trayMenu() })
ipcMain.on('external', (_e, url) => { if (/^(https?:|mailto:)/.test(String(url))) shell.openExternal(String(url)) })

// ---------- 启动 ----------
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => show(''))
  app.whenReady().then(() => {
    t = pick(app.getLocale())
    app.setAppUserModelId?.('cn.yimakeji.opero.desktop')
    load()
    createTray()
    createWindow()
    pushLoop()
    setInterval(refreshWaiting, 60_000)
    app.on('activate', () => show(''))
  })
  app.on('before-quit', () => { quitting = true })
  app.on('window-all-closed', () => { /* 留在托盘里 */ })
}
