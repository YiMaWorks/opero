// 员工的权限：所有员工都能知道 Opero 里有哪些权限（凭证、能改解析的域名、自己的审核方式），但只是知道、不是给；
// 要用哪个就申请（request_permission）：聊天里出一张卡片，主人点「同意」就给上、Opero 告诉员工，主人不用进员工资料去勾。
// 2026-11-28 主人定的。卡片不过期（一直留着，红点按真实状态算），「只有主人本人能用」的凭证同意时要验证本人。
import { all, db, get, put, uid } from './db.ts'
import { emit } from './bus.ts'
import { audit, empSays, patchSession, sessionFor, syncWaiting } from './chat.ts'
import * as runner from './runner.ts'
import type { Card, Credential, Employee } from './types.ts'
import type { Domain } from './dns.ts'

export type PermKind = 'credential' | 'domain'
const has = (e: Employee, kind: PermKind, id: string) => (kind === 'credential' ? e.creds ?? [] : e.dns ?? []).includes(id)

/** 这个员工眼里的全部权限：有什么、给没给它（凭证只给名字和说明，永远没有值） */
export function catalog(emp: Employee) {
  const creds = all<Credential>('credentials').map((c) => ({
    name: c.name, group: c.group, kind: c.kind, env: c.env, scope: c.scope || undefined, user: c.user || undefined,
    status: !c.aiAllowed ? 'owner-only' : has(emp, 'credential', c.id) ? 'granted' : 'not-granted',
  }))
  const domains = all<Domain>('domains').map((d) => ({ name: d.domain, provider: d.provider, status: has(emp, 'domain', d.id) ? 'granted' : 'not-granted' }))
  return {
    approval: emp.approval,
    approvalMeans: ({ auto: '改动直接做（危险的、生产的照样问主人）', edits: '改文件直接做，跑命令要问', ask: '每一步都问', plan: '只看不改' } as Record<string, string>)[emp.approval ?? 'auto'] ?? '',
    credentials: creds,
    domains,
    how: '要用没给你的：request_permission（kind + name + why），主人点「同意」就给上，Opero 会在聊天里告诉你。owner-only 的是主人设成只有本人能用的，也能申请，主人同意时要验证本人。凭证的值你永远拿不到，用法见 list_credentials。',
  }
}

function find(kind: PermKind, name: string): { id: string; name: string; ownerOnly: boolean } | undefined {
  const k = name.trim()
  if (kind === 'credential') {
    const c = all<Credential>('credentials').find((x) => x.id === k || x.name === k)
    return c && { id: c.id, name: c.name, ownerOnly: !c.aiAllowed }
  }
  const d = all<Domain>('domains').find((x) => x.id === k || x.domain === k.toLowerCase().replace(/\.$/, ''))
  return d && { id: d.id, name: d.domain, ownerOnly: false }
}
/** 同一件事已经有一张没点的申请卡片 */
function openPermCard(sid: string, kind: PermKind, id: string): boolean {
  const rows = db.prepare(`SELECT data FROM messages WHERE sid = ? AND data LIKE '%"perm":%' AND data LIKE '%"state":"open"%'`).all(sid) as { data: string }[]
  return rows.some((r) => { const p = JSON.parse(r.data).card?.data?.perm; return p && p.kind === kind && p.id === id })
}
const label = (kind: PermKind) => (kind === 'credential' ? '凭证' : '改这个域名的解析')

/** 员工申请：出卡片（不等，员工接着干别的），同一件事已经在等就不再发 */
export function request(emp: Employee, kind: PermKind, name: string, why: string): string {
  if (kind !== 'credential' && kind !== 'domain') return 'kind 只能是 credential（凭证）或 domain（改解析的域名）'
  const x = find(kind, name)
  if (!x) return `没有叫「${name}」的${kind === 'credential' ? '凭证' : '域名'}（my_permissions 看有哪些）；要一个新的凭证用 request_credential`
  if (has(emp, kind, x.id) && !x.ownerOnly) return `你已经能用「${x.name}」了，不用申请`
  if (openPermCard(sessionFor(emp.id).id, kind, x.id)) return `「${x.name}」已经在申请了，主人还没点；不用再发，主人点了会告诉你`
  const card: Card = {
    id: uid('c'), type: 'generic', v: 1, state: 'open', level: x.ownerOnly ? 'danger' : 'warn',
    data: {
      title: `${emp.name}申请用${label(kind)}「${x.name}」`, tag: '要你同意',
      rows: [['要什么', `${label(kind)}「${x.name}」${x.ownerOnly ? '（你设成了只有本人能用：同意的话它会改成员工可以用）' : ''}`], ['为什么', why.trim().slice(0, 400) || '（没写）'], ['给了以后', kind === 'credential' ? '它能经 Opero 用这个凭证（连服务器、查库、{{secret:名字}}），永远拿不到值；在员工资料「能用的凭证」里随时能收回' : '它能改这个域名的解析（改之前照它的审核方式问你）；在员工资料里随时能收回']],
      perm: { emp: emp.id, kind, id: x.id }, needYou: true,
    },
    actions: [{ id: 'deny', label: '不给', style: 'ghost' }, { id: 'allow', label: '同意', style: x.ownerOnly ? 'danger' : 'primary' }],
  }
  empSays(emp.id, { kind: 'card', card }, `要你同意：${card.data.title}`, true)
  audit({ via: emp.name, action: 'perm.request', target: `${label(kind)}「${x.name}」`, level: '读', result: '成功', how: why.slice(0, 80) })
  return `已经发给主人了（聊天里一张「要你同意」的卡片，一直留着不过期）。不用等：先做不需要它的部分；主人点了 Opero 会在聊天里告诉你，那时接着做。`
}

/** 主人点了申请卡片（api.ts 卡片按钮）：给上 / 不给，告诉员工；回卡片上写的结果 */
export function decide(card: Card, yes: boolean, verified: boolean): string {
  const p = card.data.perm as { emp: string; kind: PermKind; id: string }
  const emp = get<Employee>('employees', p.emp)
  if (!emp) return '这个员工已经不在了'
  const x = p.kind === 'credential' ? get<Credential>('credentials', p.id) : get<Domain>('domains', p.id)
  const name = p.kind === 'credential' ? (x as Credential | undefined)?.name : (x as Domain | undefined)?.domain
  if (!x || !name) return '这个已经没了'
  if (!yes) {
    runner.send(emp.id, `主人没同意你申请的${label(p.kind)}「${name}」。换个办法，或者跟主人说清楚为什么需要。`)
    audit({ via: '—', action: 'perm.deny', target: `${emp.name} · ${label(p.kind)}「${name}」`, level: '写', result: '拒绝', how: '本人点「不给」' })
    return '没给，员工已经知道了'
  }
  if (p.kind === 'credential') {
    const c = x as Credential
    if (!c.aiAllowed) { const c2 = { ...c, aiAllowed: true }; put('credentials', c2); emit({ t: 'put', coll: 'credentials', item: c2 }) }
    const e2 = { ...emp, creds: [...new Set([...(emp.creds ?? []), c.id])] }
    put('employees', e2); emit({ t: 'put', coll: 'employees', item: e2 })
  } else {
    const e2 = { ...emp, dns: [...new Set([...(emp.dns ?? []), p.id])] }
    put('employees', e2); emit({ t: 'put', coll: 'employees', item: e2 })
  }
  audit({ via: '—', action: 'perm.grant', target: `${emp.name} · ${label(p.kind)}「${name}」`, level: card.level === 'danger' ? '危险' : '写', result: '成功', how: verified ? '本人验证后同意（员工申请的）' : '本人点「同意」（员工申请的）' })
  runner.send(emp.id, `主人同意了你申请的${label(p.kind)}「${name}」，现在可以用了，接着做。`)
  const s = sessionFor(emp.id)
  patchSession(s.id, {})
  syncWaiting(s.id)
  return `已给「${emp.name}」，它已经知道了（员工资料里随时能收回）`
}
