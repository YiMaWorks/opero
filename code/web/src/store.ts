// 数据仓库：页面只从这里读数据、只调这里的动作。
// 现在数据来自 data/mock.ts（演示）；接后台时：初始数据改成调接口、消息改成服务器推送，动作改成调接口——页面不用改。
import { useSyncExternalStore } from 'react'
import type {
  AuditEntry, Card, QueueItem, Channel, Credential, Customization, DataSource, Flow, KbDoc, Employee, Issue, Message, Plugin, ReleaseApp,
  ReleaseRecord, SavedQuery, Server, Session, Settings, Trigger, Usage, User, Workspace,
} from './types'
import * as seed from './data/mock'
import { LIVE } from './mode'
import { normPref, resolve, setPref } from './i18n'
import * as live from './live'

export interface State {
  /** needOwner：装好后第一次打开，还没设主人；booting：正在从后台拉数据（只有真的一套有） */
  auth: { loggedIn: boolean; setupDone: boolean; needOwner?: boolean; booting?: boolean; error?: string }
  /** 真的一套：版本、AI 是不是跑在单独的系统用户下 */
  instance?: { version: string; isolated: boolean; aiUser: string }
  me: User // 单用户：只有主人
  employees: Employee[]
  sessions: Session[]
  messages: Record<string, Message[]>
  workspaces: Workspace[]
  issues: Issue[]
  servers: Server[]
  apps: ReleaseApp[]
  releases: ReleaseRecord[]
  credentials: Credential[]
  dataSources: DataSource[]
  savedQueries: SavedQuery[]
  triggers: Trigger[]
  plugins: Plugin[]
  audit: AuditEntry[]
  usage: Usage[]
  settings: Settings
  custom: Customization // 我的定制（fork + 二开）
  channels: Channel[] // 消息渠道
  kb: KbDoc[] // 知识库
  flows: Flow[] // 流程
  /** 真的一套：排队的消息（所有员工的） */
  queue: QueueItem[]
  toast: string | null
  verify: { title: string; desc?: string; onOk: () => void } | null
}

const KEY = LIVE ? 'opero.live.v1' : 'opero.proto.v2'
type WorkPrefs = Pick<Employee, 'model' | 'effort' | 'approval' | 'notify' | 'bg' | 'name' | 'avatar' | 'avatarImg' | 'color'>
type Saved = Pick<State, 'auth' | 'settings'> & {
  me?: Partial<User>
  prefs: Record<string, { pinned?: boolean }>
  work: Record<string, WorkPrefs> // 每个员工的模型 / 思考方式 / 审核方式：选了就记住
}

function load(): Partial<Saved> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved> } catch { return {} }
}

function init(): State {
  const saved = load()
  if (LIVE) {
    // 真的一套：数据都从后台来（live.boot），这里先空着；风格先用上次存在本机的，免得闪一下
    return {
      auth: { loggedIn: false, setupDone: false, booting: true },
      me: { id: 'owner', name: '', email: '', lastActive: '刚刚', cover: 'aurora', showGreeting: true, showToday: true },
      employees: [], sessions: [], messages: {}, workspaces: [], issues: [], servers: [], apps: [], releases: [], credentials: [],
      dataSources: [], savedQueries: [], triggers: [], plugins: [], audit: [], usage: [],
      settings: { ...seed.seedSettings, prodProtect: true, budget: 0, budgetStop: false, fallback: '', aiDown: false, notifyTo: ['App 推送'], ...(saved.settings ?? {}) },
      custom: seed.seedCustom, channels: [], kb: [], flows: [], queue: [], toast: null, verify: null,
    }
  }
  const prefs = saved.prefs ?? {}
  const work = saved.work ?? {}
  return {
    auth: saved.auth ?? { loggedIn: false, setupDone: false },
    me: { ...seed.seedMe, ...(saved.me ?? {}) },
    employees: seed.seedEmployees.map((e) => (work[e.id] ? { ...e, ...work[e.id] } : e)),
    sessions: seed.seedSessions.map((s) => (prefs[s.id] ? { ...s, ...prefs[s.id] } : s)),
    messages: seed.seedMessages,
    workspaces: seed.seedWorkspaces,
    issues: seed.seedIssues,
    servers: seed.seedServers,
    apps: seed.seedApps,
    releases: seed.seedReleases,
    credentials: seed.seedCredentials,
    dataSources: seed.seedDataSources,
    savedQueries: seed.seedSavedQueries,
    triggers: seed.seedTriggers,
    plugins: seed.seedPlugins,
    audit: seed.seedAudit,
    usage: seed.seedUsage,
    settings: { ...seed.seedSettings, ...(saved.settings ?? {}) },
    custom: seed.seedCustom,
    channels: seed.seedChannels,
    kb: seed.seedKb,
    flows: seed.seedFlows,
    queue: [],
    toast: null,
    verify: null,
  }
}

let state: State = init()
const listeners = new Set<() => void>()

function persist() {
  try {
    const prefs = Object.fromEntries(state.sessions.map((s) => [s.id, { pinned: !!s.pinned }]))
    const work = Object.fromEntries(state.employees.map((e) => [e.id, { model: e.model, effort: e.effort, approval: e.approval, notify: e.notify, bg: e.bg, name: e.name, avatar: e.avatar, avatarImg: e.avatarImg, color: e.color }]))
    if (LIVE) { const { theme, themeLight, themeDark, customTheme } = state.settings; localStorage.setItem(KEY, JSON.stringify({ settings: { theme, themeLight, themeDark, customTheme } })); return }
    localStorage.setItem(KEY, JSON.stringify({ auth: state.auth, settings: state.settings, prefs, work, me: state.me }))
  } catch { /* 隐私模式存不了就算了 */ }
}

export function getState() { return state }

export function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...p }
  persist()
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

/** 选取 state 里的一块。选择器要返回 state 里已有的引用（不要在里面 new 对象 / 数组），否则会一直重绘。 */
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state), () => sel(state))
}

// ---------- 小工具 ----------
let seq = 0
export const uid = (p = 'id') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`
export const now = () => new Date().toTimeString().slice(0, 5)
const timers: number[] = []
export const later = (ms: number, fn: () => void) => { timers.push(window.setTimeout(fn, ms)) }

export const empOf = (id: string) => state.employees.find((e) => e.id === id)
export const empName = (id: string) => empOf(id)?.name ?? id

export function toast(msg: string) {
  set({ toast: msg })
  const m = msg
  later(2600, () => { if (state.toast === m) set({ toast: null }) })
}

/** 危险操作：先验证本人（指纹 / 通行密钥），过了再执行 */
export function requireVerify(title: string, onOk: () => void, desc?: string) {
  set({ verify: { title, desc, onOk } })
}

export function audit(e: Omit<AuditEntry, 'id' | 'when' | 'who'> & { who?: string }) {
  if (LIVE) return // 真的一套：后台自己记
  set((s) => ({ audit: [{ id: uid('au'), when: now(), who: s.me.name, ...e }, ...s.audit] }))
}

// ---------- 账号 / 开机 ----------
export function login() { set((s) => ({ auth: { ...s.auth, loggedIn: true } })) }
export function logout() {
  if (LIVE) { live.api('POST', '/api/auth/logout').finally(() => location.reload()); return }
  set((s) => ({ auth: { ...s.auth, loggedIn: false } }))
}
export function finishSetup() {
  if (LIVE) live.call('POST', '/api/setup/done')
  set((s) => ({ auth: { ...s.auth, setupDone: true } }))
}
export function replaySetup() { set((s) => ({ auth: { ...s.auth, setupDone: false } })) }

// ---------- 会话和消息 ----------
export function append(sid: string, m: Omit<Message, 'id' | 'at'> & { id?: string }) {
  const msg = { at: now(), ...m, id: m.id ?? uid('m') } as Message
  set((s) => ({ messages: { ...s.messages, [sid]: [...(s.messages[sid] ?? []), msg] } }))
}
export function removeMsg(sid: string, id: string) {
  set((s) => ({ messages: { ...s.messages, [sid]: (s.messages[sid] ?? []).filter((m) => m.id !== id) } }))
}
export function patchMsg(sid: string, id: string, patch: Partial<Message>) {
  set((s) => ({ messages: { ...s.messages, [sid]: (s.messages[sid] ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)) } }))
}
export function patchCard(sid: string, cardId: string, patch: Partial<Card> | ((c: Card) => Partial<Card>)) {
  set((s) => ({
    messages: {
      ...s.messages,
      [sid]: (s.messages[sid] ?? []).map((m) => {
        if (m.card?.id !== cardId) return m
        const p = typeof patch === 'function' ? patch(m.card) : patch
        return { ...m, card: { ...m.card, ...p } }
      }),
    },
  }))
}
export function patchSession(sid: string, patch: Partial<Session>) {
  set((s) => ({ sessions: s.sessions.map((x) => (x.id === sid ? { ...x, ...patch, ...(patch.time ? { ts: Date.now() } : {}) } : x)) }))
}
export function togglePin(sid: string) {
  if (LIVE) { const x = state.sessions.find((v) => v.id === sid); if (x) live.call('PUT', `/api/sessions/${sid}`, { pinned: !x.pinned }); return }
  set((s) => ({ sessions: s.sessions.map((x) => (x.id === sid ? { ...x, pinned: !x.pinned } : x)) })) }
/** 免打扰 = 把这个员工的提醒设成「不提醒」；再点一次回到「只提醒要我决定的」 */
export function toggleMute(sid: string) {
  const emp = state.sessions.find((x) => x.id === sid)?.employee
  const e = state.employees.find((x) => x.id === emp)
  if (e) setLook(e.id, { notify: e.notify === 'none' ? 'decide' : 'none' })
}
/** 聊天设置：头像、名字、背景、提醒（按员工记住） */
export function setLook(empId: string, patch: Partial<Pick<Employee, 'notify' | 'bg' | 'name' | 'avatar' | 'avatarImg' | 'color'>>) {
  if (LIVE) live.saveLater(`/api/employees/${empId}`, patch)
  set((s) => ({ employees: s.employees.map((e) => (e.id === empId ? { ...e, ...patch } : e)) }))
}
/** 会话该不该冒红点：all 有未读就红；decide 只有要你决定的才红；none 不红 */
export function badgeOf(sess: Session, emp?: Employee): 'red' | 'grey' | null {
  const n = emp?.notify ?? 'decide'
  if (n === 'none') return sess.unread ? 'grey' : null
  if (sess.waiting) return 'red'
  if (!sess.unread) return null
  return n === 'all' ? 'red' : 'grey'
}
export function markRead(sid: string) {
  const x = state.sessions.find((v) => v.id === sid)
  if (LIVE && x?.unread) live.call('POST', `/api/sessions/${sid}/read`)
  patchSession(sid, { unread: 0 })
}

/** 找到（没有就建）和某个员工的会话 */
export function sessionFor(empId: string): string {
  const found = state.sessions.find((s) => s.employee === empId)
  if (found) return found.id
  if (LIVE) { live.call('POST', `/api/sessions/for/${empId}`); return '' }
  const id = uid('s')
  set((s) => ({
    sessions: [...s.sessions, { id, employee: empId, last: '还没有消息', time: now(), ts: Date.now() }],
    messages: { ...s.messages, [id]: [] },
  }))
  return id
}

export function sendMessage(sid: string, text: string) {
  if (LIVE) { live.call('POST', `/api/sessions/${sid}/messages`, { text }); return }
  const ss = state.sessions.find((x) => x.id === sid)
  const emp = ss?.employee ?? ''
  append(sid, { from: 'me', kind: 'text', text })
  if (ss?.working) {
    // 员工正在干活：这句是插话，直接送进正在跑的 work，它下一步就会看到
    append(sid, { from: 'system', kind: 'system', text: '已插话：员工下一步会看到这句' })
    return
  }
  patchSession(sid, { last: text, time: now() })
  const st = uid('st')
  later(300, () => append(sid, { id: st, from: 'system', kind: 'status', spinning: true, text: `${empName(emp)} 在想…` }))
  later(1300, () => {
    removeMsg(sid, st)
    append(sid, { from: emp, kind: 'text', text: '收到。（这是界面原型，还没接上 AI 员工；试试点卡片上的按钮。）' })
    patchSession(sid, { last: '收到。', time: now() })
  })
}

export function sendFile(sid: string, name: string, image = false, real?: { size: number; url?: string; w?: number; h?: number }, blob?: Blob) {
  if (LIVE) {
    const b = blob ?? (real?.url ? dataUrlBlob(real.url) : null)
    if (b) live.upload(sid, b, name, { w: real?.w, h: real?.h })
    else toast('读不到这个文件')
    return
  }
  const ext = name.split('.').pop()?.toUpperCase().slice(0, 4) ?? 'FILE'
  const size = real ? (real.size > 1048576 ? `${(real.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(real.size / 1024))} KB`) : image ? '1.2 MB' : '18 KB'
  append(sid, { from: 'me', kind: 'file', file: { name, size, ext, image, url: real?.url, w: real?.w, h: real?.h } })
  patchSession(sid, { last: image ? '[图片]' : `[文件] ${name}`, time: now() })
}

function dataUrlBlob(url: string): Blob {
  const [head, b64] = url.split(',')
  const type = head.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type })
}

export function stopWorking(sid: string) {
  if (LIVE) { live.call('POST', `/api/sessions/${sid}/stop`); return }
  timers.splice(0).forEach(clearTimeout)
  set((s) => ({ messages: { ...s.messages, [sid]: (s.messages[sid] ?? []).filter((m) => m.kind !== 'status') } }))
  patchSession(sid, { working: undefined })
  append(sid, { from: 'system', kind: 'system', text: '你让员工停下了' })
}

// 主线演示：点「修复」后，派活 → 改代码 → 检查 → 自动合并 → 发布 → 观察 → 关问题（约 14 秒）
export function runFixDemo(sid: string) {
  const st = uid('st')
  patchSession(sid, { working: '在修 #42…' })
  later(300, () => append(sid, { id: st, from: 'system', kind: 'status', spinning: true, text: '派给「mov 开发」…' }))
  later(1700, () => patchMsg(sid, st, { text: '「mov 开发」在改 PayService.java、WechatSigner.java…' }))
  later(3300, () => patchMsg(sid, st, { text: 'CI 检查中：编译 · 类型检查 · 单元测试…' }))
  later(4900, () => {
    removeMsg(sid, st)
    append(sid, { from: 'mov-log', kind: 'card', card: {
      id: 'c-change-42', type: 'change', v: 1, state: 'open', level: 'info',
      data: { project: 'mov-market', branch: 'fix/pay-sign-42', merged: true,
        files: [{ name: 'PayService.java', add: 12, del: 3 }, { name: 'WechatSigner.java', add: 8, del: 2 }],
        checks: ['编译', '类型检查', '单元测试 48'], ci: 'CI #1832 · 2 分 14 秒' },
      actions: [
        { id: 'revert', label: '撤销合并', style: 'ghost', tool: 'workspace.revert_merge' },
        { id: 'view', label: '看改动', panel: 'diff' },
      ] } })
    set((s) => ({ issues: s.issues.map((i) => (i.id === 42 ? { ...i, status: 'fixing' } : i)) }))
  })
  later(5900, () => {
    append(sid, { from: 'mov-log', kind: 'card', card: {
      id: 'c-rel-42', type: 'release', v: 1, state: 'open', level: 'info',
      data: { app: 'mov-market', env: '生产', version: 'v1.4.2', steps: ['编译', '签名', '部署', '观察'], step: 0, watched: 0, total: 10, watchFor: 'SIGN_ERR' },
      actions: [{ id: 'rollback', label: '回滚到 v1.4.1', tool: 'release.rollback' }] } })
    patchSession(sid, { working: '在发布 v1.4.2…' })
  })
  ;[1, 2, 3].forEach((n, i) => later(6900 + i * 900, () => patchCard(sid, 'c-rel-42', (c) => ({ data: { ...c.data, step: n } }))))
  for (let w = 1; w <= 10; w++) later(9600 + w * 350, () => patchCard(sid, 'c-rel-42', (c) => ({ data: { ...c.data, watched: w } })))
  later(13500, () => {
    patchCard(sid, 'c-rel-42', (c) => ({ data: { ...c.data, step: 4 } }))
    append(sid, { from: 'mov-log', kind: 'text', text: '已发布 v1.4.2，盯了 10 分钟没有新的 SIGN_ERR。问题 #42 已关闭，交接和变更记录 mov 开发已经写好。' })
    patchSession(sid, { working: undefined, last: '#42 已修复，v1.4.2 已上生产', time: now() })
    set((s) => ({
      issues: s.issues.map((i) => (i.id === 42 ? { ...i, status: 'fixed' } : i)),
      releases: [{ id: 372, app: 'mov-market', env: '生产', version: 'v1.4.2', status: '成功', by: '发布', when: now(), duration: '3 分 40 秒',
        steps: [{ name: '编译', ok: true }, { name: '签名', ok: true }, { name: '部署', ok: true }, { name: '发布后观察 10 分钟', ok: true }] }, ...s.releases],
    }))
    audit({ via: 'mov 日志值班', action: 'release.publish', target: 'mov-market · 生产 v1.4.2', level: '写', result: '成功', how: '直接做（审核方式：自动）' })
  })
}

export function revertMerge(sid: string) {
  patchCard(sid, 'c-change-42', (c) => ({ data: { ...c.data, reverted: true } }))
  append(sid, { from: 'system', kind: 'system', text: '你撤销了 fix/pay-sign-42 的合并' })
  audit({ via: 'mov 日志值班', action: 'workspace.revert_merge', target: 'mov-market · fix/pay-sign-42', level: '写', result: '成功', how: '本人点「撤销合并」' })
}

// ---------- work 基本操作 ----------
/** 改员工的模型 / 思考方式 / 审核方式：立刻生效，下次派活也用它（记住） */
export function setWork(empId: string, patch: Partial<WorkPrefs>) {
  if (LIVE) live.saveLater(`/api/employees/${empId}`, patch)
  set((s) => ({ employees: s.employees.map((e) => (e.id === empId ? { ...e, ...patch } : e)) }))
}
/** 新话题：开一个新的执行器会话（上下文清空），员工的记忆（git）还在 */
export function newTopic(sid: string, empId: string) {
  if (LIVE) { live.call('POST', `/api/sessions/${sid}/new-topic`); return }
  append(sid, { from: 'system', kind: 'system', text: '—— 新话题：上下文已清空，记忆还在 ——' })
  set((s) => ({ employees: s.employees.map((e) => (e.id === empId ? { ...e, contextUsed: 2 } : e)) }))
}
/** 压缩上下文：把前面的对话总结成一段，腾出空间 */
export function compactContext(sid: string, empId: string) {
  if (LIVE) { toast('压缩上下文还在做；上下文太长就点「新话题」'); return }
  const st = uid('st')
  append(sid, { id: st, from: 'system', kind: 'status', spinning: true, text: '在压缩上下文…' })
  later(1200, () => {
    removeMsg(sid, st)
    append(sid, { from: 'system', kind: 'system', text: '上下文已压缩（前面的对话总结成了一段）' })
    set((s) => ({ employees: s.employees.map((e) => (e.id === empId ? { ...e, contextUsed: Math.min(e.contextUsed ?? 0, 18) } : e)) }))
  })
}
/** 换 work：旧的先把交接写进员工的 git，新的读交接接着干（上下文满了 / 卡住了 / 换服务器） */
export function switchWork(sid: string, empId: string, reason = '上下文满了') {
  if (LIVE) { live.call('POST', `/api/sessions/${sid}/new-topic`, { reason }); return }
  const e = state.employees.find((x) => x.id === empId)
  if (!e) return
  const no = (e.works?.[0]?.no ?? 0) + 1
  const st = uid('st')
  append(sid, { id: st, from: 'system', kind: 'status', spinning: true, text: '旧 work 在写交接、提交到它的 git…' })
  later(1300, () => patchMsg(sid, st, { text: `新 work（第 ${no} 个）在读交接…` }))
  later(2600, () => {
    removeMsg(sid, st)
    append(sid, { from: 'system', kind: 'system', text: `—— 换到第 ${no} 个 work（${reason}）：记忆在 ${e.repo}，接着干 ——` })
    append(sid, { from: empId, kind: 'text', text: '我是新的 work，交接读完了：手上的事我都知道，接着来。' })
    const works = [{ no, from: now(), reason, host: e.host }, ...(e.works ?? []).map((w, i) => (i === 0 && !w.to ? { ...w, to: now() } : w))]
    set((s) => ({ employees: s.employees.map((x) => (x.id === empId ? { ...x, works, contextUsed: 4, repoSynced: '刚刚' } : x)) }))
  })
}

/** 重启 work：执行器进程重来（卡住时用），会话和记忆都在 */
export function restartWork(sid: string) {
  if (LIVE) { live.call('POST', `/api/sessions/${sid}/stop`, undefined, '已停下，再发一句就重新开始'); return }
  const st = uid('st')
  append(sid, { id: st, from: 'system', kind: 'status', spinning: true, text: '在重启 work…' })
  later(1400, () => { removeMsg(sid, st); append(sid, { from: 'system', kind: 'system', text: 'work 已重启' }) })
}

// ---------- 员工 ----------
export function saveEmployee(e: Employee) {
  if (LIVE) {
    const exists = state.employees.some((x) => x.id === e.id)
    live.call(exists ? 'PUT' : 'POST', exists ? `/api/employees/${e.id}` : '/api/employees', exists ? e : { ...e, id: undefined }, exists ? '已保存' : `员工「${e.name}」建好了`)
    return
  }
  const exists = state.employees.some((x) => x.id === e.id)
  if (!exists) e = { ...e, repo: e.repo || `codeup.aliyun.com/owner/emp-${e.id}`, repoSynced: '刚刚', works: [{ no: 1, from: now(), reason: '刚建', host: e.host }] }
  set((s) => ({ employees: exists ? s.employees.map((x) => (x.id === e.id ? e : x)) : [...s.employees, e] }))
  if (!exists) {
    const sid = sessionFor(e.id)
    append(sid, { from: e.id, kind: 'text', text: `我是「${e.name}」，${e.title}。记忆仓库 ${e.repo} 已经建好，换 work、换服务器都不会丢。有事直接跟我说。` })
    patchSession(sid, { last: '我是「' + e.name + '」', time: now(), unread: 1 })
  }
  audit({ via: '系统管家', action: exists ? 'employee.update' : 'employee.create', target: e.name, level: '写', result: '成功', how: '直接做' })
  toast(exists ? '已保存' : `员工「${e.name}」建好了`)
}

// ---------- 工作空间 / 问题 ----------
export function addWorkspace(w: Workspace) {
  set((s) => ({ workspaces: [...s.workspaces, w] }))
  audit({ via: '—', action: 'workspace.add', target: w.name, level: '写', result: '成功', how: '本人添加' })
  toast(`已接入 ${w.name}，正在拉代码…`)
}
export function setIssueStatus(id: number, status: Issue['status']) {
  set((s) => ({ issues: s.issues.map((i) => (i.id === id ? { ...i, status } : i)) }))
}

// ---------- 应用 ----------
export function addServer(sv: Server) { set((s) => ({ servers: [...s.servers, sv] })) }
export function saveCredential(c: Credential) {
  const exists = state.credentials.some((x) => x.id === c.id)
  set((s) => ({ credentials: exists ? s.credentials.map((x) => (x.id === c.id ? c : x)) : [...s.credentials, c] }))
  audit({ via: '—', action: exists ? 'credential.update' : 'credential.create', target: c.name, level: '危险', result: '成功', how: '本人 + 指纹' })
  toast('凭证已加密保存，AI 只能拿到编号')
}
export function saveTrigger(t: Trigger) {
  if (LIVE) { const exists = state.triggers.some((x) => x.id === t.id); live.call(exists ? 'PUT' : 'POST', exists ? `/api/triggers/${t.id}` : '/api/triggers', t, '触发器已保存'); return }
  const exists = state.triggers.some((x) => x.id === t.id)
  set((s) => ({ triggers: exists ? s.triggers.map((x) => (x.id === t.id ? t : x)) : [...s.triggers, t] }))
  toast('触发器已保存')
}
export function toggleTrigger(id: string) {
  if (LIVE) { const t = state.triggers.find((x) => x.id === id); if (t) live.call('PUT', `/api/triggers/${id}`, { enabled: !t.enabled }); return }
  set((s) => ({ triggers: s.triggers.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)) })) }
export function togglePlugin(id: string) {
  if (LIVE) { toast(SOON); return }
  set((s) => ({ plugins: s.plugins.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)) })) }
export function saveQuery(q: SavedQuery) {
  if (LIVE) { live.call('POST', '/api/saved-queries', q, `「${q.name}」已存成常用查询`); return }
  set((s) => ({ savedQueries: [...s.savedQueries, q] })); toast(`「${q.name}」已存成菜单`) }

// ---------- 定制（二开） ----------
/** 官方出新版：交给「后台开发」合并到你的 fork，先起预览，你点「上线」才换 */
/** 真的一套里还没做的功能 */
export const SOON = '这个功能还在做，下个版本见'

export function mergeOfficialUpdate() {
  if (LIVE) { toast(SOON); return }
  const up = state.custom.update
  if (!up) return
  const sid = sessionFor('dev-opero')
  append(sid, { from: 'me', kind: 'text', text: `把${up.version}合并上来` })
  const st = uid('st')
  later(400, () => append(sid, { id: st, from: 'system', kind: 'status', spinning: true, text: `「后台开发」在合并${up.version}，检查你的 ${state.custom.mine.length} 处改动有没有冲突…` }))
  later(2600, () => {
    removeMsg(sid, st)
    append(sid, { from: 'dev-opero', kind: 'card', card: {
      id: uid('c'), type: 'generic', v: 1, state: 'open', level: 'info',
      data: { title: `合并${up.version} · 预览中`, tag: '检查通过', rows: [['冲突', '没有（你的插件和菜单都在）'], ['预览', 'https://pre-4.opero.yimakeji.cn'], ['上线后', '保留上一版，健康检查不过自动回滚']] },
      actions: [{ id: 'online', label: '上线', style: 'primary', tool: 'opero.promote' }] } })
    patchSession(sid, { last: `${up.version} 合并好了，预览中`, time: now(), unread: 1 })
    set((s) => ({ custom: { ...s.custom, update: undefined, base: `${up.version}（预览中）` } }))
  })
  toast('已交给「后台开发」，合并好了在它的会话里点「上线」')
}

/** 点「上线」：预览版换成正式版（保留上一版，健康检查不过自动回滚） */
export function promotePreview() {
  set((s) => ({
    custom: {
      ...s.custom,
      base: s.custom.base.replace('（预览中）', ''),
      mine: s.custom.mine.map((m) => (m.status === '预览中' ? { ...m, status: '已上线' } : m)),
    },
    plugins: s.plugins.map((p) => (p.builtin ? p : { ...p, enabled: true })),
  }))
  audit({ via: '后台开发', action: 'opero.promote', target: 'Opero 自己', level: '写', result: '成功', how: '本人点「上线」' })
}

// ---------- 消息渠道 ----------
export function toggleChannel(id: string, field: 'inbound' | 'notifyMe' | 'allowSend') {
  if (LIVE) { toast(SOON); return }
  set((s) => ({ channels: s.channels.map((c) => (c.id === id ? { ...c, [field]: !c[field] } : c)) }))
}
export function addChannel(c: Channel) { set((s) => ({ channels: [...s.channels, c] })); toast(`已接入 ${c.kind}`) }

// ---------- 知识库 / 流程 / 模板 ----------
export function addKbDoc(d: KbDoc) { set((s) => ({ kb: [d, ...s.kb] })); toast(`「${d.name}」已加进知识库，所有员工都能查`) }

/** 跑一个流程：照步骤执行，不经过 AI */
export function runFlow(id: string) {
  if (LIVE) { toast(SOON); return }
  const f = state.flows.find((x) => x.id === id)
  if (!f) return
  const sid = sessionFor(f.employee)
  const st = uid('st')
  append(sid, { id: st, from: 'system', kind: 'status', spinning: true, text: `在跑流程「${f.name}」（不经过 AI）…` })
  later(1400, () => {
    removeMsg(sid, st)
    append(sid, { from: f.employee, kind: 'card', card: {
      id: uid('c'), type: 'generic', v: 1, state: 'open', level: 'info',
      data: { title: `流程「${f.name}」跑完了`, tag: '没用 AI', rows: f.steps.map((x, i) => [`第 ${i + 1} 步`, `✓ ${x}`]).concat([['用时', '3 秒 · 0 token']]) },
      actions: [] } })
    patchSession(sid, { last: `流程「${f.name}」跑完了`, time: now() })
    set((s) => ({ flows: s.flows.map((x) => (x.id === id ? { ...x, runs: x.runs + 1, last: now() } : x)) }))
  })
  toast(`在跑「${f.name}」，结果发在「${empName(f.employee)}」的会话里`)
}

/** 把刚才在聊天里做的事存成流程 */
export function saveFlowFromChat(empId: string) {
  if (LIVE) { toast(SOON); return }
  const f: Flow = { id: uid('f'), name: '刚才做的事（可改名）', employee: empId, steps: ['员工把刚才的步骤整理成脚本', '你确认后存进它的记忆仓库 flows/'], runs: 0, last: '还没跑过' }
  set((s) => ({ flows: [f, ...s.flows] }))
  toast('已存成流程：以后点一下就跑，不经过 AI')
}

/** 从模板建员工（模板 = 记忆仓库里的 CLAUDE.md + 设置） */
export function employeeFromTemplate(name: string, from: string) {
  const base = state.employees.find((e) => e.name === name) ?? state.employees[0]
  const id = 'emp-' + Date.now().toString(36)
  saveEmployee({ ...base, id, name: base.name + '（新）', repo: '', works: undefined, contextUsed: 0, avatarImg: undefined })
  toast(`已从模板「${name}」建好（来源：${from}）`)
}

// ---------- 设置 ----------
/** 个人页顶部：头像、名字、签名、封面、显示什么 */
export function setMe(patch: Partial<User>) {
  if (LIVE) live.saveLater('/api/me', patch)
  set((s) => ({ me: { ...s.me, ...patch } }))
}

export function setSettings(patch: Partial<Settings>) {
  if (patch.lang !== undefined) {
    // 换语言：本机马上换、记住；装好的一套同步到后台（手机 App、别的电脑打开也用这个）
    const p = normPref(patch.lang)
    patch = { ...patch, lang: p, langResolved: resolve(p) }
    setPref(p)
  }
  if (LIVE) live.saveLater('/api/settings', patch)
  set((s) => ({ settings: { ...s.settings, ...patch } }))
}
