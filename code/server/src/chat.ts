// 会话、消息、操作记录、用量：写库 + 推给网页。
import { all, db, get, put, uid } from './db.ts'
import { owner } from './auth.ts'
import { emit, push } from './bus.ts'
import type { Employee, Message, Session } from './types.ts'

export const hhmm = (ts = Date.now()) => new Date(ts).toTimeString().slice(0, 5)

/** 员工现在的会话（没归档的那个；没有就建一个） */
export function sessionFor(empId: string): Session {
  const found = all<Session>('sessions').find((s) => s.employee === empId && !s.archived)
  if (found) return found
  const s: Session = { id: uid('s'), employee: empId, last: '还没有消息', time: hhmm(), ts: Date.now() }
  put('sessions', s)
  emit({ t: 'put', coll: 'sessions', item: s })
  return s
}

/** 换一个会话接着做：现在的归档（员工档案「历史会话」能看），开一个新的；draft = 新会话输入框预填的交接 */
export function rotateSession(empId: string, title: string, o: { draft?: string; note?: string } = {}): Session {
  const old = sessionFor(empId)
  const archived: Session = { ...old, archived: Date.now(), title, working: undefined, waiting: undefined, unread: 0, draft: undefined }
  put('sessions', archived)
  emit({ t: 'put', coll: 'sessions', item: archived })
  const s: Session = { id: uid('s'), employee: empId, last: title, time: hhmm(), ts: Date.now(), pinned: old.pinned, ...(o.draft ? { draft: o.draft } : {}) }
  put('sessions', s)
  emit({ t: 'put', coll: 'sessions', item: s })
  system(s.id, o.note ?? `—— ${title}：新会话，员工从记忆仓库接着做 ——`)
  return s
}

export const historyOf = (empId: string) => all<Session>('sessions').filter((s) => s.employee === empId && s.archived).sort((a, b) => (b.archived ?? 0) - (a.archived ?? 0))

export function patchSession(sid: string, patch: Partial<Session> & { clear?: ('working' | 'waiting')[] }) {
  const s = get<Session>('sessions', sid)
  if (!s) return
  const { clear, ...rest } = patch
  const next: Session = { ...s, ...rest }
  if (rest.last !== undefined) { next.time = hhmm(); next.ts = Date.now() }
  for (const k of clear ?? []) delete next[k]
  put('sessions', next)
  emit({ t: 'put', coll: 'sessions', item: next })
}

const CARD_TITLE: Record<string, string> = { issue: '新问题', confirm: '要你确认', ask: '要你选', run: '这一轮做完了', generic: '卡片' }

export function addMsg(sid: string, m: Omit<Message, 'id' | 'at'> & { id?: string }): Message {
  const ts = Date.now()
  const msg = { ...m, id: m.id ?? uid('m'), at: hhmm(ts), ts } as Message
  // 卡片约定（docs/api/卡片.md）：每张都有 data.title，各端不认识的卡片按「标题 + 标签 + rows + 按钮」显示
  if (msg.card && !String(msg.card.data?.title ?? '').trim()) msg.card = { ...msg.card, data: { ...msg.card.data, title: CARD_TITLE[msg.card.type] ?? '卡片' } }
  db.prepare('INSERT INTO messages (id, sid, ts, data) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data').run(msg.id, sid, ts, JSON.stringify(msg))
  emit({ t: 'msg', sid, msg })
  return msg
}

export function getMsg(id: string): { sid: string; msg: Message } | undefined {
  const r = db.prepare('SELECT sid, data FROM messages WHERE id = ?').get(id) as { sid: string; data: string } | undefined
  return r ? { sid: r.sid, msg: JSON.parse(r.data) } : undefined
}

export function patchMsg(id: string, patch: Partial<Message>) {
  const cur = getMsg(id)
  if (!cur) return
  const msg = { ...cur.msg, ...patch }
  db.prepare('UPDATE messages SET data = ? WHERE id = ?').run(JSON.stringify(msg), id)
  emit({ t: 'msg', sid: cur.sid, msg })
}

export function delMsg(id: string) {
  const cur = getMsg(id)
  if (!cur) return
  db.prepare('DELETE FROM messages WHERE id = ?').run(id)
  emit({ t: 'msgDel', sid: cur.sid, id })
}

export function listMessages(sid: string, limit = 200): Message[] {
  const rows = db.prepare('SELECT data FROM messages WHERE sid = ? ORDER BY ts DESC, rowid DESC LIMIT ?').all(sid, limit) as { data: string }[]
  return rows.reverse().map((r) => JSON.parse(r.data))
}

/** 员工说了话：存消息、更新会话预览和未读；按员工的提醒设置决定推不推到手机 */
export function empSays(empId: string, m: Omit<Message, 'id' | 'at' | 'from'>, preview: string, decide = false) {
  const s = sessionFor(empId)
  const msg = addMsg(s.id, { ...m, from: empId })
  patchSession(s.id, { last: preview.slice(0, 80), unread: (get<Session>('sessions', s.id)?.unread ?? 0) + 1, ...(decide ? { waiting: '要你决定' } : {}) })
  const emp = get<Employee>('employees', empId)
  const notify = emp?.notify ?? 'decide'
  if (notify !== 'none' && (decide || notify === 'all')) push({ kind: decide ? 'decide' : 'info', title: emp?.name ?? '员工', body: preview.slice(0, 120), route: `chat/${s.id}` })
  return msg
}

export function system(sid: string, text: string) { return addMsg(sid, { from: 'system', kind: 'system', text }) }

// ---------- 操作记录：只追加 ----------
export interface AuditIn { via: string; action: string; target: string; level: '读' | '写' | '危险'; result: '成功' | '失败' | '拒绝'; how: string }
export function audit(e: AuditIn) {
  const ts = Date.now()
  const r = db.prepare('INSERT INTO audit (ts, data) VALUES (?, ?)').run(ts, JSON.stringify(e))
  const item = { id: String(r.lastInsertRowid), when: fmtWhen(ts), who: owner()?.name || '主人', ...e }
  emit({ t: 'audit', item })
  return item
}
function fmtWhen(ts: number) {
  const d = new Date(ts)
  const today = new Date().toDateString() === d.toDateString()
  return today ? hhmm(ts) : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hhmm(ts)}`
}
export function listAudit(limit = 300) {
  const who = owner()?.name || '主人'
  return (db.prepare('SELECT id, ts, data FROM audit ORDER BY id DESC LIMIT ?').all(limit) as { id: number; ts: number; data: string }[])
    .map((r) => ({ id: String(r.id), when: fmtWhen(r.ts), who, ...JSON.parse(r.data) }))
}

// ---------- 用量：这个月每个员工跑了几轮、成功几轮、多少 token、多少钱（美元，执行器报的） ----------
export function recordRun(id: string, emp: string, ok: boolean, cost: number, tokens: number, ws = '') {
  db.prepare('INSERT INTO runs (id, emp, ts, ok, cost, tokens, ws) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING').run(id, emp, Date.now(), ok ? 1 : 0, cost, tokens, ws)
  emit({ t: 'usage', usage: usage() })
}
export function usage() {
  const d = new Date()
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const rows = db.prepare('SELECT emp, COUNT(*) AS n, SUM(ok) AS ok, SUM(cost) AS cost, SUM(tokens) AS tokens FROM runs WHERE ts >= ? GROUP BY emp').all(start) as
    { emp: string; n: number; ok: number; cost: number; tokens: number }[]
  return rows.map((r) => ({ employee: r.emp, tasks: r.n, success: r.ok, tokens: fmtTokens(r.tokens), cost: Math.round(r.cost * 100) / 100 }))
}
/** 用量明细：这个月按项目分、最近 30 天按天分 */
export function usageDetail() {
  const d = new Date()
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const byWs = (db.prepare("SELECT COALESCE(ws, '') AS ws, COUNT(*) AS n, SUM(cost) AS cost, SUM(tokens) AS tokens FROM runs WHERE ts >= ? GROUP BY COALESCE(ws, '')").all(start) as
    { ws: string; n: number; cost: number; tokens: number }[]).map((r) => ({ workspace: r.ws, tasks: r.n, tokens: fmtTokens(r.tokens), cost: Math.round(r.cost * 100) / 100 }))
  const since = Date.now() - 30 * 86400_000
  const rows = db.prepare('SELECT ts, emp, cost FROM runs WHERE ts >= ? ORDER BY ts').all(since) as { ts: number; emp: string; cost: number }[]
  const days = new Map<string, { day: string; tasks: number; cost: number }>()
  for (const r of rows) {
    const t = new Date(r.ts)
    const day = `${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
    const x = days.get(day) ?? { day, tasks: 0, cost: 0 }
    x.tasks++
    x.cost += r.cost
    days.set(day, x)
  }
  return { byWs, byDay: [...days.values()].map((x) => ({ ...x, cost: Math.round(x.cost * 100) / 100 })) }
}
/** 这个月某个员工 / 某个项目花了多少（美元） */
export function monthCostOf(o: { emp?: string; ws?: string }): number {
  const d = new Date()
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const r = o.emp
    ? db.prepare('SELECT SUM(cost) AS c FROM runs WHERE ts >= ? AND emp = ?').get(start, o.emp) as { c: number | null }
    : db.prepare("SELECT SUM(cost) AS c FROM runs WHERE ts >= ? AND COALESCE(ws, '') = ?").get(start, o.ws ?? '') as { c: number | null }
  return Math.round((r?.c ?? 0) * 100) / 100
}
export function monthCost() { return usage().reduce((a, u) => a + u.cost, 0) }
const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n))
