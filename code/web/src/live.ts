// 接真的后台（code/server）：调接口、开机拉一次全部数据、开着 SSE 收变化。只在 LIVE（装好的一套）里用。
import type { Card, CardAction, Message } from './types'
import { setLiveModels } from './work'
import { getState, requireVerify, set, setSettings, toast, type State } from './store'
import { loadPref, normPref, resolve, setPref } from './i18n'

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, message: string, code = '') { super(message); this.status = status; this.code = code }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const raw = body instanceof Blob
  // 相对地址（去掉开头的 /）：按 <base href> 走，装在子路径下也对
  const r = await fetch(path.replace(/^\//, ''), {
    method,
    credentials: 'same-origin',
    headers: { 'X-Opero': '1', ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    if (r.status === 401 && j.code === 'AUTH') set((s) => ({ auth: { ...s.auth, loggedIn: false } }))
    throw new ApiError(r.status, j.message ?? `出错了（${r.status}）`, j.code ?? '')
  }
  return j as T
}

/** 调接口，出错弹提示；要验证本人的先弹验证，过了再调一次 */
export async function call<T = any>(method: string, path: string, body?: unknown, okMsg?: string): Promise<T | undefined> {
  try {
    const r = await api<T>(method, path, body)
    if (okMsg) toast(okMsg)
    return r
  } catch (e) {
    if (e instanceof ApiError && e.code === 'VERIFY') {
      return new Promise((resolve) => requireVerify('这一步要验证本人', () => { call<T>(method, path, body, okMsg).then(resolve) }))
    }
    toast((e as Error).message)
    return undefined
  }
}

// ---------- 开机：拉全部数据 ----------
export async function boot() {
  try {
    const b = await api<any>('GET', '/api/bootstrap')
    if (!b.auth.loggedIn) {
      set((s) => ({ auth: { ...b.auth, booting: false }, instance: b.instance, me: s.me }))
      return
    }
    set((s) => ({
      auth: { ...b.auth, booting: false },
      instance: b.instance,
      me: { ...s.me, ...b.me },
      employees: b.employees, sessions: b.sessions, messages: b.messages, servers: b.servers, credentials: b.credentials,
      dataSources: b.dataSources, savedQueries: b.savedQueries, triggers: b.triggers, kb: b.kb, workspaces: b.workspaces, queue: b.queue ?? [], liveIssues: b.issues ?? [], liveReleases: b.releases ?? [], domains: b.domains ?? [], inbox: b.inbox ?? [], inChannels: b.channels ?? [], notifiers: b.notifiers ?? [],
      audit: b.audit, usage: b.usage, settings: { ...s.settings, ...b.settings },
    }))
    syncLang(b.settings?.lang)
    connect()
    api<{ claude: string[]; codex: string[] }>('GET', '/api/ai/models').then(setLiveModels).catch(() => {})
  } catch (e) {
    set((s) => ({ auth: { ...s.auth, booting: false, error: (e as Error).message } }))
  }
}

/** 语言：后台存过（在别的设备上选过）就用后台的；后台还是「跟随系统」而这台选过，就把这台的存上去 */
function syncLang(server: unknown) {
  const local = loadPref()
  const sp = server === undefined ? 'auto' : normPref(server)
  if (sp !== 'auto' && sp !== local) setPref(sp)
  else if (sp === 'auto' && local !== 'auto') setSettings({ lang: local })
  else if (getState().settings.langResolved !== resolve(local)) setSettings({ lang: local })
}

// ---------- SSE：后台推过来的变化 ----------
let es: EventSource | null = null
let broken = false
function connect() {
  es?.close()
  es = new EventSource('api/events')
  es.onmessage = (m) => { try { apply(JSON.parse(m.data)) } catch { /* 坏的一条不管 */ } }
  es.onerror = () => { broken = true }
  es.onopen = () => {
    if (broken) { broken = false; boot() } // 断过：重新拉一次，别漏东西
  }
}

type Coll = 'employees' | 'sessions' | 'servers' | 'credentials' | 'dataSources' | 'savedQueries' | 'triggers' | 'kb' | 'workspaces' | 'queue' | 'liveIssues' | 'liveReleases' | 'domains' | 'inChannels' | 'notifiers'
const COLLS: Coll[] = ['inChannels', 'notifiers', 'employees', 'sessions', 'servers', 'credentials', 'dataSources', 'savedQueries', 'triggers', 'kb', 'workspaces', 'queue', 'liveIssues', 'liveReleases', 'domains']
/** 后台的集合名 → 本地 store 的字段（问题清单在 store 里叫 liveIssues，issues 是试用版的） */
const collOf = (c: string) => (c === 'issues' ? 'liveIssues' : c === 'releases' ? 'liveReleases' : c === 'channels' ? 'inChannels' : c) as Coll

function apply(ev: any) {
  switch (ev.t) {
    case 'put': {
      const coll = collOf(ev.coll)
      if (!COLLS.includes(coll)) return
      // 归档的会话不在会话列表里（员工档案「历史会话」按需拉）
      if (coll === 'sessions' && ev.item.archived) { set((s) => ({ sessions: s.sessions.filter((x) => x.id !== ev.item.id) })); return }
      set((s) => {
        const list = s[coll] as { id: string }[]
        const i = list.findIndex((x) => x.id === ev.item.id)
        return { [coll]: i >= 0 ? list.map((x, j) => (j === i ? ev.item : x)) : [...list, ev.item] } as Partial<State>
      })
      return
    }
    case 'del': {
      const coll = collOf(ev.coll)
      if (!COLLS.includes(coll)) return
      set((s) => ({ [coll]: (s[coll] as { id: string }[]).filter((x) => x.id !== ev.id) } as Partial<State>))
      return
    }
    case 'msg':
      set((s) => {
        const list = s.messages[ev.sid] ?? []
        const i = list.findIndex((m) => m.id === ev.msg.id)
        return { messages: { ...s.messages, [ev.sid]: i >= 0 ? list.map((m, j) => (j === i ? ev.msg : m)) : [...list, ev.msg] } }
      })
      return
    case 'msgDel':
      set((s) => ({ messages: { ...s.messages, [ev.sid]: (s.messages[ev.sid] ?? []).filter((m: Message) => m.id !== ev.id) } }))
      return
    case 'audit': set((s) => ({ audit: [ev.item, ...s.audit].slice(0, 500) })); return
    case 'settings':
      set((s) => ({ settings: { ...s.settings, ...ev.settings } }))
      if (ev.settings?.lang && normPref(ev.settings.lang) !== loadPref()) setPref(normPref(ev.settings.lang)) // 别的设备上换了语言
      return
    case 'me': set((s) => ({ me: { ...s.me, ...ev.me } })); return
    case 'usage': set({ usage: ev.usage }); return
    case 'toast': toast(ev.text); return
    case 'inbox': set((s) => { const i = s.inbox.findIndex((x) => x.id === ev.item.id); return { inbox: i >= 0 ? s.inbox.map((x, j) => (j === i ? ev.item : x)) : [ev.item, ...s.inbox].slice(0, 500) } }); return
  }
}

// ---------- 卡片按钮 ----------
export function cardAction(card: Card, action: CardAction, extra?: Record<string, unknown>) {
  const msg = Object.values(getState().messages).flat().find((m) => m.card?.id === card.id)
  if (!msg) return
  const go = () => call('POST', `/api/messages/${msg.id}/action`, { action: action.id, answer: extra?.answer })
  if (action.style === 'danger') requireVerify(String(card.data.title ?? '确认'), go, String(card.data.why ?? ''))
  else go()
}

// ---------- 发文件：先传到员工的目录（还没发），显示在输入框上面，跟着下一句话一起发 / 一起排队 ----------
export async function upload(sid: string, file: Blob, name: string, meta: { w?: number; h?: number } = {}) {
  const q = new URLSearchParams({ name, type: file.type || 'application/octet-stream', ...(meta.w ? { w: String(meta.w), h: String(meta.h ?? 0) } : {}) })
  return call<{ att: import('./types').QAtt }>('POST', `/api/sessions/${sid}/files?${q}`, file)
}

// 改设置 / 个人资料：本地先改，停手 600ms 再存到后台
const timers: Record<string, number> = {}
const pendingBody: Record<string, Record<string, unknown>> = {}
export function saveLater(path: string, patch: Record<string, unknown>) {
  // 清掉的字段（undefined）要发 null，不然 JSON 里没有这个键，后台以为没改（比如「不用图片」头像）
  const p = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === undefined ? null : v]))
  pendingBody[path] = { ...(pendingBody[path] ?? {}), ...p }
  clearTimeout(timers[path])
  timers[path] = window.setTimeout(() => { const b = pendingBody[path]; delete pendingBody[path]; call('PUT', path, b) }, 600)
}
