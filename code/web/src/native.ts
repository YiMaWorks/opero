// 在 Opero App（安卓外壳，code/android）里打开时，和外壳打交道。协议见 docs/规范/App外壳.md。
// 外壳的 WebView User-Agent 带「OperoApp/<版本> light|dark」，并注入 window.OperoNative；在浏览器里这些都没有，全部退回网页做法。

interface OperoNativeApi {
  version(): string
  /** 系统指纹 / 面容 / 锁屏密码；结果回调 window.__operoNative.onVerify(id, ok, err)。30 分钟内验过外壳直接回 ok */
  verify(id: string, title: string, subtitle: string): void
  /** 状态栏 / 导航栏跟着网页的深浅色 */
  setTheme(dark: boolean): void
  /** 状态栏 / 导航栏、底色跟着网页的风格（深浅 + 页面底色 + 面板色，#RRGGBB）；老外壳没有这个就退回 setTheme */
  setBars?(dark: boolean, bg: string, panel: string): void
  /** 桌面图标角标（红点数，只算要你决定的） */
  setBadge(n: number): void
  /** 用系统浏览器 / 别的 App 打开（邮件、Slack、Telegram 的原消息） */
  openExternal(url: string): void
  /** 轻震一下（长按出菜单、按住说话） */
  haptic(): void
  /** 断开这台手机（回到「连接你的 Opero」） */
  unpair(): void
  /** 正在看的会话（chat/<编号>）：推的就是它时外壳不弹通知 */
  setRoute(route: string): void
  /** 网页登录过期（接口 401）：外壳用设备令牌重新要票再打开 */
  relogin(): void
  /** 「这台手机」的设置：JSON 字符串 */
  getShell(): string
  setShell(json: string): void
  /** 说话转文字（手机自带的语音识别）；结果回 window.__operoNative.onVoice(text, err) */
  voice?(lang: string): void
  /** 嵌入页（?embed=1）里点到别的页面：交给 App 打开（原生页或再开一个嵌入页）。route 同票的 route（employee;id=e1、chat;emp=<员工>） */
  open?(route: string): void
  /** 嵌入页最外层点了关闭：App 退回上一层 */
  close?(): void
}

/** 这台手机（外壳）自己的设置，存在手机上 */
export interface ShellPrefs {
  version: string
  server: string
  paired: boolean
  lockOn: boolean
  /** 离开多少秒后回来要解锁（0 = 每次） */
  lockAfter: number
  pushEnabled: boolean
  /** 严重告警一直响到点开 */
  insistent: boolean
}

declare global {
  interface Window {
    OperoNative?: OperoNativeApi
    __operoNative?: { onVerify(id: string, ok: boolean, err?: string): void; open(route: string): void; onVoice?(text: string, err?: string): void; back(): boolean }
    SpeechRecognition?: any
    webkitSpeechRecognition?: any
  }
}

const native = () => window.OperoNative
export const inApp = /\bOperoApp\//.test(navigator.userAgent) && !!window.OperoNative
export const appVersion = inApp ? safe(() => native()!.version(), '') : ''

function safe<T>(fn: () => T, dflt: T): T {
  try { return fn() } catch { return dflt }
}

const waiting = new Map<string, (r: { ok: boolean; err?: string }) => void>()
const openHandlers = new Set<(route: string) => void>()

window.__operoNative = {
  onVerify(id, ok, err) {
    const cb = waiting.get(id)
    waiting.delete(id)
    cb?.({ ok, err })
  },
  // 点通知打开：外壳把路由交给网页（例如 chat/<会话>）
  open(route) { openHandlers.forEach((fn) => fn(route)) },
  // App 的返回键（嵌入页）：网页里还有能退的（弹窗、子页）就退一层回 true；到顶了回 false，App 自己退
  back() { try { return backHandler?.() ?? false } catch { return false } },
}
let backHandler: (() => boolean) | null = null
/** 嵌入页接管 App 的返回键 */
export function onNativeBack(fn: () => boolean) {
  backHandler = fn
  return () => { if (backHandler === fn) backHandler = null }
}
/** 嵌入页里要去别的页面：App 支持就交给 App（回 true），老外壳 / 浏览器里回 false，网页自己跳 */
export function nativeOpen(route: string): boolean {
  const n = native()
  if (!inApp || !n?.open) return false
  return safe(() => { n.open!(route); return true }, false)
}
/** App 能不能关掉嵌入页（老外壳 / 浏览器里不能，就不显示关闭按钮） */
export const canNativeClose = () => inApp && !!native()?.close
/** 嵌入页最外层关闭；不在 App 里回 false */
export function nativeClose(): boolean {
  const n = native()
  if (!inApp || !n?.close) return false
  return safe(() => { n.close!(); return true }, false)
}

/** 用手机的指纹验证本人；不在 App 里返回 null（走网页的验证弹窗） */
export function nativeVerify(title: string, subtitle = ''): Promise<{ ok: boolean; err?: string }> | null {
  const n = native()
  if (!inApp || !n) return null
  const id = Math.random().toString(36).slice(2)
  return new Promise((resolve) => {
    waiting.set(id, resolve)
    if (!safe(() => { n.verify(id, title, subtitle); return true }, false)) { waiting.delete(id); resolve({ ok: false, err: '外壳不支持' }) }
  })
}

export function nativeTheme(dark: boolean, bg?: string, panel?: string) {
  if (!inApp) return
  const n = native()!
  safe(() => (n.setBars && bg && panel ? n.setBars(dark, bg, panel) : n.setTheme(dark)), undefined)
}
/** 桌面端（code/desktop）给网页开的几个功能 */
const desk = () => (window as unknown as { OperoDesktop?: { setBadge(n: number): void; openExternal(u: string): void } }).OperoDesktop
export function nativeBadge(n: number) { if (inApp) safe(() => native()!.setBadge(n), undefined); else desk()?.setBadge(n) }
export function nativeRoute(route: string) { if (inApp) safe(() => native()!.setRoute(route), undefined) }
export function nativeUnpair() { if (inApp) safe(() => native()!.unpair(), undefined) }
export function getShell(): ShellPrefs | null {
  if (!inApp) return null
  return safe(() => JSON.parse(native()!.getShell()) as ShellPrefs, null)
}
export function setShell(p: Partial<ShellPrefs>) { if (inApp) safe(() => native()!.setShell(JSON.stringify(p)), undefined) }
export function nativeHaptic() { if (inApp) safe(() => native()!.haptic(), undefined) }

/** 到原处去（App 里交给系统打开对应的 App，浏览器里开新窗口） */
export function openExternal(url: string) {
  if (!inApp && desk()) { desk()!.openExternal(url); return }
  if (inApp) safe(() => native()!.openExternal(url), undefined)
  else window.open(url, '_blank', 'noopener')
}

export function onNativeOpen(fn: (route: string) => void) {
  openHandlers.add(fn)
  return () => { openHandlers.delete(fn) }
}

if (inApp) document.documentElement.classList.add('in-app')

// ---------- 说话转文字：App 里用手机自带的语音识别，浏览器里用 Web Speech（Chrome / Edge / Safari） ----------
let voiceWait: ((r: { text: string; err?: string }) => void) | null = null
if (window.__operoNative) window.__operoNative.onVoice = (text, err) => { voiceWait?.({ text, err }); voiceWait = null }

export const canDictate = () => (inApp && typeof window.OperoNative?.voice === 'function') || !!(window.SpeechRecognition || window.webkitSpeechRecognition)

/** 听一句话，返回文字（空 = 没听清 / 取消） */
export function dictate(lang: string): Promise<string> {
  if (inApp && typeof window.OperoNative?.voice === 'function') {
    return new Promise((resolve) => { voiceWait = (r) => resolve(r.text || ''); safe(() => window.OperoNative!.voice!(lang), undefined) })
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) return Promise.reject(new Error('这个浏览器不支持语音输入'))
  return new Promise((resolve, reject) => {
    const r = new SR()
    r.lang = lang
    r.interimResults = false
    r.continuous = false
    let out = ''
    r.onresult = (e: any) => { for (const x of e.results) out += x[0].transcript }
    r.onerror = (e: any) => (e.error === 'no-speech' || e.error === 'aborted' ? resolve('') : reject(new Error(e.error === 'not-allowed' ? '没给麦克风权限' : `语音识别出错：${e.error}`)))
    r.onend = () => resolve(out)
    r.start()
  })
}
