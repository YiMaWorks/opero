// 订阅账号还剩多少用量（5 小时窗口、本周）：Claude Code、Codex 的订阅账号都有，API Key 按量计费没有。
//   Claude Code：① 官方用量接口 /api/oauth/usage（Claude Code 的 /usage 就问它；不花额度，两个窗口一起回）——打开页面、每 10 分钟、点刷新都问（readClaude）；
//     ② 干活时它在 stream-json 里报 rate_limit_event（unifiedWindows.five_hour / seven_day：utilization 0–1、resetsAt 秒），有变化才报，收到就记（noteClaude）；
//     ③ 接口不认这个令牌时，主人点「刷新」才退回发一条最小的测试请求拿 ②（runner.probeClaudeQuota）。
//   Codex：能主动问——`codex app-server` 的 account/rateLimits/read（一行一个 JSON：initialize → initialized → 请求），
//     primary / secondary 各有 usedPercent、windowDurationMins、resetsAt（秒）。不花钱、不占额度，打开页面和每 10 分钟问一次。
// 派活挑账号时也看这个（runner.pickAccount）：剩得多的优先，员工指定的账号快用完（剩 < 5%）就先用别的。
import { kvGet, kvSet, get } from './db.ts'
import * as hosts from './hosts.ts'
import type { Credential } from './types.ts'

export interface Win { used: number; resetsAt?: number; mins?: number }
export interface Quota { kind: 'claude' | 'codex'; five?: Win; week?: Win; limited?: boolean; at: number; src: 'run' | 'poll' | 'probe'; err?: string; plan?: string
  /** 官方用量接口限流（429）：这个时间之前不再问；backoff = 这次等了多久（连着被限流就翻倍，最多 1 小时） */
  retryAt?: number; backoff?: number }

const all = () => kvGet<Record<string, Quota>>('quota', {})
const save = (id: string, q: Quota) => kvSet('quota', { ...all(), [id]: q })
export const quotaOf = (id: string): Quota | undefined => all()[id]

const ms = (t: unknown) => { const n = Number(t); return !n ? undefined : n < 1e12 ? n * 1000 : n }
const pct = (v: unknown, fraction: boolean) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.round((fraction ? n * 100 : n) * 10) / 10) : undefined }
/** 过了重置时间的窗口：当作满的 */
const fresh = (w?: Win) => (w && (!w.resetsAt || w.resetsAt > Date.now()) ? w : undefined)

/** Claude Code 报的 rate_limit_event */
export function noteClaude(cred: string | undefined, info: any, src: 'run' | 'probe' = 'run') {
  if (!cred || !info || typeof info !== 'object') return
  const old = quotaOf(cred)
  const q: Quota = { kind: 'claude', five: old?.five, week: old?.week, at: Date.now(), src }
  const u = info.unifiedWindows ?? {}
  const win = (x: any): Win | undefined => (x && x.utilization !== undefined ? { used: pct(x.utilization, true) ?? 0, resetsAt: ms(x.resetsAt) } : undefined)
  q.five = win(u.five_hour) ?? q.five
  q.week = win(u.seven_day) ?? q.week
  // 只报了一个窗口（老版本）：按 rateLimitType 放
  if (info.utilization !== undefined && (info.rateLimitType === 'five_hour' || info.rateLimitType === 'seven_day')) {
    const w = { used: pct(info.utilization, true) ?? 0, resetsAt: ms(info.resetsAt) }
    if (info.rateLimitType === 'five_hour') q.five = w; else q.week = w
  }
  q.limited = info.status === 'rejected'
  save(cred, q)
}

/** Claude 订阅账号：直接问官方的用量接口（Claude Code 的 /usage 就是问它）——不花额度、两个窗口一起回。
 *  GET https://api.anthropic.com/api/oauth/usage（订阅令牌），回 { five_hour: { utilization: 0–100, resets_at: ISO }, seven_day: {…} }。
 *  回 'ok' 记好了；回字符串 = 没问到的原因（status 是 HTTP 状态，0 = 连不上），调用方决定要不要退回「发一条最小的」 */
const hhmm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
export async function readClaude(id: string, token: string): Promise<{ ok: true } | { ok: false; status: number; why: string }> {
  const before = quotaOf(id)
  if (before?.retryAt && before.retryAt > Date.now()) return { ok: false, status: 429, why: `官方暂时不让查（查得太勤），${hhmm(before.retryAt)} 后自动再查` }
  let r: Response
  try {
    r = await fetch('https://api.anthropic.com/api/oauth/usage', { headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'opero' }, signal: AbortSignal.timeout(15_000) })
  } catch (e) {
    const x = e as Error & { cause?: { message?: string } }
    return { ok: false, status: 0, why: `连不上 api.anthropic.com（${x.cause?.message ?? x.message}）：Opero 这台连不上的话，到「应用 → 服务器和 Agent → 网络出口」让 anthropic.com 经别的服务器出去` }
  }
  if (r.status === 429) {
    // 限流：按对方说的等（Retry-After 秒数或时间），没说就 10 分钟；连着被限流翻倍，最多 1 小时
    const ra = r.headers.get('retry-after')
    const said = ra ? (/^\d+$/.test(ra) ? Number(ra) * 1000 : Date.parse(ra) - Date.now()) : NaN
    const wait = Math.min(60 * 60_000, Math.max(Number.isFinite(said) && said > 0 ? said : 0, before?.backoff ? before.backoff * 2 : 10 * 60_000))
    const retryAt = Date.now() + wait
    save(id, { ...(before ?? { kind: 'claude', at: 0, src: 'poll' }), kind: 'claude', retryAt, backoff: wait, err: `官方暂时不让查（查得太勤），${hhmm(retryAt)} 后自动再查` })
    return { ok: false, status: 429, why: `官方暂时不让查（查得太勤），${hhmm(retryAt)} 后自动再查` }
  }
  const text = await r.text()
  let j: any = null
  try { j = JSON.parse(text) } catch { /* 不是 JSON */ }
  if (!r.ok || !j || typeof j !== 'object') return { ok: false, status: r.status, why: `${r.status} ${String(j?.error?.message ?? text).slice(0, 120)}` }
  const win = (x: any): Win | undefined => {
    if (!x || x.utilization === undefined || x.utilization === null) return undefined
    const t = typeof x.resets_at === 'string' ? Date.parse(x.resets_at) : ms(x.resets_at)
    return { used: pct(x.utilization, false) ?? 0, resetsAt: Number.isFinite(t) ? t : undefined }
  }
  const five = win(j.five_hour), week = win(j.seven_day)
  if (!five && !week) return { ok: false, status: r.status, why: '接口回了，但里面没有用量（这个账号可能不是订阅账号）' }
  const old = quotaOf(id)
  save(id, { kind: 'claude', five: five ?? old?.five, week: week ?? old?.week, at: Date.now(), src: 'poll', limited: (five?.used ?? 0) >= 100 || (week?.used ?? 0) >= 100 })
  return { ok: true }
}

/** 这次没问到：记原因（之前的数留着） */
export function noteError(id: string, kind: 'claude' | 'codex', err: string): Quota {
  const old = quotaOf(id)
  const q: Quota = { ...(old ?? { kind, at: 0, src: 'poll' }), kind, err }
  save(id, q)
  return q
}

/** 问 Codex 这个 ChatGPT 订阅账号还剩多少（本机的 codex；没装 / 没登录记下原因） */
export async function pollCodex(id: string, env: Record<string, string>, cmd: [string, string[]], host: string = hosts.LOCAL): Promise<Quota> {
  const req = [
    { id: 1, method: 'initialize', params: { clientInfo: { name: 'opero', title: 'Opero', version: '1' }, capabilities: null } },
    { method: 'initialized' },
    { id: 2, method: 'account/rateLimits/read' },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n'
  // 等到回了 id 2 就关（stdin 一关 app-server 就退）；最多 25 秒
  const out = await new Promise<string>((resolve) => {
    const p = hosts.spawnAiOn(host, cmd[0], [...cmd[1], 'app-server'], env, hosts.workRoot(host))
    let buf = ''
    const done = () => { clearTimeout(t); try { p.stdin!.end() } catch { /* 关了 */ } hosts.killTree(p); resolve(buf) }
    const t = setTimeout(done, 25_000)
    p.stdout!.on('data', (b) => { buf += b; if (/"id"\s*:\s*2\b/.test(buf) && buf.endsWith('\n')) done() })
    p.stderr!.on('data', () => {})
    p.on('close', () => { clearTimeout(t); resolve(buf) })
    p.stdin!.on('error', () => {})
    p.stdin!.write(req)
  })
  let res: any
  for (const line of out.split('\n')) { try { const j = JSON.parse(line); if (j.id === 2) res = j } catch { /* 不是 JSON */ } }
  const old = quotaOf(id)
  if (!res || res.error) {
    const q: Quota = { ...(old ?? { kind: 'codex', src: 'poll' }), kind: 'codex', at: old?.at ?? 0, src: 'poll', err: res?.error?.message ? String(res.error.message).slice(0, 200) : (out ? '没读到用量' : '这台没装 Codex，或者账号没登录好') }
    save(id, q)
    return q
  }
  const snap = res.result?.rateLimitsByLimitId?.codex ?? res.result?.rateLimits ?? {}
  const win = (x: any): Win | undefined => (x ? { used: pct(x.usedPercent, false) ?? 0, resetsAt: ms(x.resetsAt), mins: Number(x.windowDurationMins) || undefined } : undefined)
  const a = win(snap.primary), b = win(snap.secondary)
  // 一般 primary 是 5 小时、secondary 是一周；按窗口长度认，认不出就按顺序
  const isWeek = (w?: Win) => !!w?.mins && w.mins >= 24 * 60
  const q: Quota = { kind: 'codex', at: Date.now(), src: 'poll', plan: snap.planType ?? undefined,
    five: [a, b].find((w) => w && !isWeek(w)) ?? (isWeek(a) ? undefined : a), week: [a, b].find((w) => isWeek(w)) ?? (isWeek(a) ? a : b),
    limited: !!snap.rateLimitReachedType || res.result?.ordinaryUsageAllowed === false }
  save(id, q)
  return q
}

/** 还剩多少（%）：两个窗口里少的那个；没有数据回 undefined */
export function remaining(id: string): number | undefined {
  const q = quotaOf(id)
  if (!q) return
  const ws = [fresh(q.five), fresh(q.week)].filter((w): w is Win => !!w)
  if (q.limited && ws.some((w) => w.used >= 100)) return 0
  if (!ws.length) return q.at ? 100 : undefined
  return Math.max(0, 100 - Math.max(...ws.map((w) => w.used)))
}

/** 给界面：去掉过期窗口 */
export function view(id: string): Quota | undefined {
  const q = quotaOf(id)
  if (!q) return
  return { ...q, five: fresh(q.five), week: fresh(q.week) }
}
export const credName = (id: string) => get<Credential>('credentials', id)?.name ?? id
