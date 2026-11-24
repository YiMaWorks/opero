// 问题清单：员工巡检日志（log_scan）发现的线上问题记在这里（issue_report），同一个问题按 key 合并计数。
// 新出现的严重问题发一张卡片给主人：修复（交给负责那个项目的员工）/ 已知 / 忽略 7 天；别的只记着，不打扰。
import { all, get, put, uid } from './db.ts'
import { emit } from './bus.ts'
import { audit, empSays } from './chat.ts'
import * as runner from './runner.ts'
import type { Card, Employee, Issue, Server, Workspace } from './types.ts'

const save = (i: Issue) => { put('issues', i); emit({ t: 'put', coll: 'issues', item: i }); return i }
const SEV: Record<string, Issue['severity']> = { high: 'high', mid: 'mid', low: 'low', 严重: 'high', 一般: 'mid', 轻微: 'low' }
const SEV_ZH = { high: '严重', mid: '一般', low: '轻微' }

export function list(o: { status?: string } = {}): Issue[] {
  return all<Issue>('issues').filter((i) => !o.status || i.status === o.status).sort((a, b) => b.last - a.last)
}

/** 员工报一个问题：有同 key 的就加次数，没有就新建；新的严重问题发卡片给主人 */
export function report(emp: Employee, a: { title?: string; key?: string; severity?: string; server?: string; workspace?: string; sample?: string; cause?: string; count?: number }): { issue: Issue; isNew: boolean } {
  const title = String(a.title ?? '').trim().slice(0, 120)
  if (!title) throw new Error('要有标题')
  const key = String(a.key ?? title).trim().slice(0, 200)
  const now = Date.now()
  const n = Math.max(1, Math.round(Number(a.count) || 1))
  const sv = a.server ? all<Server>('servers').find((s) => s.id === a.server || s.name === a.server) : undefined
  const ws = a.workspace ? all<Workspace>('workspaces').find((w) => w.id === a.workspace || w.name === a.workspace) : undefined
  const old = all<Issue>('issues').find((i) => i.key === key)
  if (old) {
    const ignored = old.status === 'ignored' && (old.ignoreUntil ?? 0) > now
    const reopened = old.status === 'fixed' || (old.status === 'ignored' && !ignored)
    const next = save({ ...old, count: old.count + n, last: now, sample: a.sample ? String(a.sample).slice(0, 4000) : old.sample, cause: a.cause ? String(a.cause).slice(0, 1000) : old.cause, ...(reopened ? { status: 'new', note: old.status === 'fixed' ? '修过以后又出现了' : old.note } : {}) })
    if (reopened && next.severity === 'high') ask(emp, next)
    return { issue: next, isNew: false }
  }
  const issue = save({
    id: uid('is'), title, key, severity: SEV[String(a.severity ?? '')] ?? 'mid', status: 'new', count: n, first: now, last: now,
    server: sv?.id, workspace: ws?.id, sample: String(a.sample ?? '').slice(0, 4000), cause: a.cause ? String(a.cause).slice(0, 1000) : undefined, reporter: emp.id,
  })
  audit({ via: emp.name, action: 'issue.new', target: title, level: '读', result: '成功', how: SEV_ZH[issue.severity] })
  if (issue.severity === 'high') ask(emp, issue)
  return { issue, isNew: true }
}

/** 严重问题：发卡片让主人决定 */
function ask(emp: Employee, i: Issue) {
  const card: Card = {
    id: uid('c'), type: 'issue', v: 1, state: 'open', level: 'danger',
    data: { title: i.title, tag: i.note ?? '新问题', issueId: i.id, rows: [['次数', String(i.count)], ['在哪', place(i)], ...(i.cause ? [['可能原因', i.cause]] : [])], sample: i.sample.slice(0, 600) },
    actions: [{ id: 'fix', label: '修复', style: 'primary' }, { id: 'known', label: '已知', style: 'default' }, { id: 'ignore', label: '忽略 7 天', style: 'ghost' }],
  }
  empSays(emp.id, { kind: 'card', card }, `新问题：${i.title}`, true)
}

const place = (i: Issue) => [i.server && get<Server>('servers', i.server)?.name, i.workspace && get<Workspace>('workspaces', i.workspace)?.name].filter(Boolean).join(' · ') || '—'

/** 谁来修：指定的 > 用这个项目的员工 > 报问题的员工 */
function fixerOf(i: Issue, want?: string): Employee | undefined {
  const emps = all<Employee>('employees')
  if (want) return emps.find((e) => e.id === want || e.name === want)
  if (i.workspace) { const e = emps.find((x) => x.workspace === i.workspace); if (e) return e }
  return emps.find((e) => e.id === i.reporter)
}

/** 主人（卡片 / 问题清单页）或员工改状态：fix = 交给员工去修 */
export function act(id: string, action: string, o: { by: string; fixer?: string; note?: string } = { by: '主人' }): Issue {
  const i = get<Issue>('issues', id)
  if (!i) throw new Error('没有这个问题')
  let next: Issue = { ...i, ...(o.note ? { note: o.note.slice(0, 500) } : {}) }
  if (action === 'fix') {
    const f = fixerOf(i, o.fixer)
    if (!f) throw new Error('没有员工能修：先建一个用这个项目的员工')
    next = { ...next, status: 'fixing', fixer: f.id }
    runner.send(f.id, [
      `修这个线上问题（问题清单 ${i.id}）：${i.title}`,
      `在哪：${place(i)}；出现 ${i.count} 次，最近一次 ${new Date(i.last).toLocaleString('zh-CN')}`,
      i.cause && `可能原因：${i.cause}`,
      i.sample && `日志样例：\n\`\`\`\n${i.sample.slice(0, 2000)}\n\`\`\``,
      '先查清原因再改；修好后用 issue_update 把它标成 fixed 并写上原因，没把握的用 ask_owner 问我。',
    ].filter(Boolean).join('\n\n'))
  } else if (action === 'known') next = { ...next, status: 'known' }
  else if (action === 'ignore') next = { ...next, status: 'ignored', ignoreUntil: Date.now() + 7 * 86400_000 }
  else if (action === 'fixed') next = { ...next, status: 'fixed' }
  else if (action === 'reopen') next = { ...next, status: 'new', ignoreUntil: undefined }
  else throw new Error('不认识的操作')
  audit({ via: o.by, action: `issue.${action}`, target: i.title, level: '写', result: '成功', how: o.by === '主人' ? '本人' : '员工' })
  return save(next)
}

/** 员工改问题（修好了、补原因） */
export function update(emp: Employee, a: { id?: string; status?: string; cause?: string; note?: string }): Issue {
  const i = get<Issue>('issues', String(a.id ?? ''))
  if (!i) throw new Error('没有这个问题（用 issue_list 看）')
  if (a.cause) save({ ...i, cause: String(a.cause).slice(0, 1000) })
  if (a.status && a.status !== i.status) return act(i.id, a.status === 'new' ? 'reopen' : String(a.status), { by: emp.name, note: a.note })
  return a.note ? save({ ...get<Issue>('issues', i.id)!, note: String(a.note).slice(0, 500) }) : get<Issue>('issues', i.id)!
}

export const summary = (i: Issue) => ({ id: i.id, title: i.title, status: i.status, severity: i.severity, count: i.count, where: place(i), last: new Date(i.last).toLocaleString('zh-CN'), cause: i.cause })
