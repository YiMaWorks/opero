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
    __operoNative?: { onVerify(id: string, ok: boolean, err?: string): void; open(route: string): void }
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
export function nativeBadge(n: number) { if (inApp) safe(() => native()!.setBadge(n), undefined) }
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
  if (inApp) safe(() => native()!.openExternal(url), undefined)
  else window.open(url, '_blank', 'noopener')
}

export function onNativeOpen(fn: (route: string) => void) {
  openHandlers.add(fn)
  return () => { openHandlers.delete(fn) }
}

if (inApp) document.documentElement.classList.add('in-app')
