// 网络出口：Opero 自己往外连（收发邮件、提醒渠道、AI Key、生图、DNS、流水线、代码托管平台的接口…）时，
// 有的地址这台连不上（比如在国内连 Gmail、Telegram），主人按域名设一条规则，让它经一台能连上的服务器（Agent）出去。
//   规则：kv egressRules，最具体的那条生效（imap.gmail.com 比 gmail.com 优先），写 gmail.com 也管它的子域名；via = 服务器编号，'direct' = 直连（给子域名开例外）。
//   HTTP（fetch）：全局分发器按目标域名挑——有规则就先经内部代理接到出口，再在上面做 TLS（端到端加密，出口看不到内容）。
//   邮件（imapflow / nodemailer）：给它们一个代理地址（proxyFor）。
//   内部代理只听 127.0.0.1、口令随机且只在这个进程里（不给执行器），用户名 = 出口编号（带 ~lan 表示许连内网）。
//   连不上的（网络错误）记在 recent，界面上「最近连不上的」一键换出口。
import crypto from 'node:crypto'
import http from 'node:http'
import net from 'node:net'
import tls from 'node:tls'
import { Agent, buildConnector, setGlobalDispatcher } from 'undici'
import { get, kvGet, kvSet, uid } from './db.ts'
import * as agents from './agents.ts'
import { ANY_MIN, openFromSocket } from './tunnel.ts'
import type { Server } from './types.ts'

export interface TestResult { ok: boolean; ms?: number; err?: string }
export interface EgressRule {
  id: string
  /** 域名（含子域名）或 IP，小写 */
  host: string
  /** 出口：服务器编号；'direct' = 直连 */
  via: string
  /** 许连内网地址（默认不许，防止被拿去探内网） */
  lan?: boolean
  note?: string
  at: number
  by?: string
  /** 最近一次测试（经这个出口） */
  test?: TestResult & { at: number; port: number }
}
export interface Failure { host: string; port: number; what: string; err: string; at: number; n: number }

// ---------- 规则 ----------
export const rules = (): EgressRule[] => kvGet<EgressRule[]>('egressRules', [])
const save = (l: EgressRule[]) => kvSet('egressRules', l)

/** 主人随手贴的：网址、邮箱、host:port、*.example.com → { host, port? } */
export function parseTarget(input: string): { host: string; port?: number } | string {
  let s = String(input ?? '').trim().toLowerCase()
  if (!s) return '填要连的地址，比如 imap.gmail.com'
  if (s.includes('@') && !s.includes('/')) s = s.slice(s.lastIndexOf('@') + 1) // 邮箱地址 → 域名
  let port: number | undefined
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) {
    try { const u = new URL(s); s = u.hostname; port = Number(u.port) || ({ 'https:': 443, 'http:': 80, 'imaps:': 993, 'smtps:': 465, 'wss:': 443, 'ws:': 80 } as Record<string, number>)[u.protocol] } catch { return '地址看不懂' }
  } else {
    s = s.replace(/[/?#].*$/, '')
    const m = s.match(/^(.*):(\d{1,5})$/)
    if (m && !m[1].includes(':')) { s = m[1]; port = Number(m[2]) }
  }
  s = s.replace(/^\*\./, '').replace(/^\.+|\.+$/g, '').replace(/^\[|\]$/g, '')
  if (!(net.isIP(s) || /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(s))) return `「${input}」不像域名或 IP`
  if (port !== undefined && !(port >= 1 && port <= 65535)) return '端口要在 1 到 65535 之间'
  return { host: s, port }
}

/** 这个地址走哪条规则：最具体的（完全一样 > 后缀最长）；没有就 undefined（直连） */
export function ruleFor(host: string, list = rules()): EgressRule | undefined {
  const h = host.toLowerCase().replace(/\.$/, '')
  let best: EgressRule | undefined
  for (const r of list) {
    const hit = h === r.host || (!net.isIP(r.host) && h.endsWith('.' + r.host))
    if (hit && (!best || r.host.length > best.host.length)) best = r
  }
  return best
}
const viaOf = (host: string) => { const r = ruleFor(host); return r && r.via !== 'direct' ? r : undefined }

export function upsert(x: { host: string; via: string; lan?: boolean; note?: string; by?: string }, test?: EgressRule['test']): EgressRule {
  const l = rules()
  const old = l.find((r) => r.host === x.host)
  const r: EgressRule = { id: old?.id ?? uid('eg'), host: x.host, via: x.via, lan: x.lan || undefined, note: x.note?.trim() || undefined, at: Date.now(), by: x.by, test: test ?? (old && old.via === x.via ? old.test : undefined) }
  save(old ? l.map((y) => (y.id === r.id ? r : y)) : [...l, r])
  recent.delete(x.host)
  for (const k of [...recent.keys()]) if (ruleFor(k)?.id === r.id) recent.delete(k)
  return r
}
export function patch(id: string, p: Partial<Pick<EgressRule, 'host' | 'via' | 'lan' | 'note' | 'test'>>): EgressRule | undefined {
  const l = rules()
  const r = l.find((x) => x.id === id)
  if (!r) return
  const n: EgressRule = { ...r, ...p, at: p.test ? r.at : Date.now() }
  if (p.via !== undefined && p.via !== r.via && !p.test) delete n.test
  if (!n.lan) delete n.lan
  save(l.map((x) => (x.id === id ? n : x)))
  return n
}
export function remove(id: string) { save(rules().filter((x) => x.id !== id)) }

/** 出口能不能用（在不在线、Agent 够不够新）：'' = 能用 */
export function viaProblem(via: string): string {
  if (via === 'direct') return ''
  const sv = get<Server>('servers', via)
  if (!sv || sv.via !== 'agent') return '这台不是装了 Agent 的服务器，当不了出口'
  if (!agents.agentOnline(sv)) return `「${sv.name}」的 Agent 不在线`
  if (!agents.agentAtLeast(sv, ANY_MIN)) return `「${sv.name}」的 Agent 是 ${sv.agentVersion || '很旧的版本'}，要 ${ANY_MIN} 以上：到「应用 → 服务器和 Agent → ${sv.name}」点「升级 Agent」`
  return ''
}

// ---------- 连不上的记录 ----------
const recent = new Map<string, Failure>()
/** 网络层的错（连不上 / 超时 / 解析不了），不是对方回了错误 */
export function netErr(e: unknown): boolean {
  const x = e as { code?: string; message?: string; cause?: { code?: string; message?: string } }
  const s = `${x?.code ?? ''} ${x?.message ?? ''} ${x?.cause?.code ?? ''} ${x?.cause?.message ?? ''}`
  return /ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|Connect Timeout|connect timeout|socket hang up|timed out|Timeout|ESOCKET|ECONNECTION|ETIMEOUT/i.test(s)
}
const errText = (e: unknown) => { const x = e as { message?: string; cause?: { message?: string } }; return String(x?.cause?.message || x?.message || e).slice(0, 200) }
/** 记一次连不上（同一个地址合并，留最近 30 个） */
export function noteFail(host: string, port: number, what: string, e: unknown) {
  if (!host || net.isIP(host) && /^(127\.|::1$)/.test(host)) return
  const old = recent.get(host)
  recent.set(host, { host, port, what: what || old?.what || '', err: errText(e), at: Date.now(), n: (old?.n ?? 0) + 1 })
  if (recent.size > 30) recent.delete([...recent.values()].sort((a, b) => a.at - b.at)[0].host)
}
export const failures = () => [...recent.values()].sort((a, b) => b.at - a.at)
export const ignoreFail = (host: string) => recent.delete(host)
/** 网络错误的报错后面加一句去哪里换出口（主人在哪看到报错，就知道下一步怎么办） */
export function hint(host: string, e: unknown): string {
  const base = errText(e)
  if (!netErr(e)) return base
  const r = viaOf(host)
  return r ? `${base}（这个地址经出口「${get<Server>('servers', r.via)?.name ?? r.via}」出去也没连上：看看那台的网络，或者在「应用 → 服务器和 Agent → 网络出口」换一台）`
    : `${base}（这台 Opero 可能连不上 ${host}：到「应用 → 服务器和 Agent → 网络出口」让它经别的服务器出去）`
}

// ---------- 内部代理（只给这个进程自己用）----------
const TOKEN = crypto.randomBytes(18).toString('hex')
let port = 0
export function startInternalProxy(): Promise<void> {
  const srv = http.createServer((_q, r) => { r.writeHead(405); r.end() })
  srv.on('connect', (req, sock: net.Socket, head: Buffer) => {
    const auth = String(req.headers['proxy-authorization'] ?? '').replace(/^Basic\s+/i, '')
    const [user, pass] = Buffer.from(auth, 'base64').toString().split(':')
    if (!pass || pass.length !== TOKEN.length || !crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(TOKEN))) { sock.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return }
    const m = String(req.url ?? '').match(/^\[?([^\]]+?)\]?:(\d+)$/)
    if (!m) { sock.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return }
    const [via, flag] = decodeURIComponent(user || '').split('~')
    openFromSocket(sock, head, via, m[1], Number(m[2]), { any: true, lan: flag === 'lan' })
  })
  srv.unref() // 不拖住进程退出（正式运行时主服务一直在）
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => { port = (srv.address() as net.AddressInfo).port; ok() }))
}
const proxyUrl = (via: string, lan?: boolean) => `http://${encodeURIComponent(via + (lan ? '~lan' : ''))}:${TOKEN}@127.0.0.1:${port}`
/** 给 imapflow / nodemailer：这个地址有出口规则就回代理地址，没有回 undefined（直连） */
export function proxyFor(host: string): string | undefined {
  const r = viaOf(host)
  return r && port ? proxyUrl(r.via, r.lan) : undefined
}

/** 经出口连到 host:port，回一个已经通了的 socket（上面跑什么协议都行） */
export function dialVia(via: string, host: string, p: number, lan?: boolean, timeout = 25_000): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    if (!port) return reject(new Error('出口代理还没起来'))
    const sock = net.connect(port, '127.0.0.1')
    const timer = setTimeout(() => { sock.destroy(); reject(new Error(`经出口连 ${host}:${p} 超时`)) }, timeout)
    let buf = ''
    const onData = (b: Buffer) => {
      buf += b.toString('latin1')
      const end = buf.indexOf('\r\n\r\n')
      if (end < 0) return
      sock.off('data', onData)
      clearTimeout(timer)
      const status = Number(buf.slice(9, 12))
      if (status === 200) {
        const rest = Buffer.from(buf.slice(end + 4), 'latin1')
        if (rest.length) sock.unshift(rest)
        return resolve(sock)
      }
      const why = decodeURIComponent(buf.match(/X-Opero-Error: ([^\r\n]*)/i)?.[1] ?? '') || `出口回了 ${status}`
      sock.destroy()
      reject(Object.assign(new Error(why), { code: 'EGRESS' }))
    }
    sock.on('data', onData)
    sock.on('error', (e) => { clearTimeout(timer); reject(e) })
    sock.on('connect', () => {
      const target = net.isIPv6(host) ? `[${host}]:${p}` : `${host}:${p}`
      sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: Basic ${Buffer.from(`${encodeURIComponent(via + (lan ? '~lan' : ''))}:${TOKEN}`).toString('base64')}\r\n\r\n`)
    })
  })
}

// ---------- fetch：全局分发器按规则挑路 ----------
export function installFetch() {
  const direct = buildConnector({ timeout: 15_000 })
  const connect: buildConnector.connector = (opts, cb) => {
    const host = opts.hostname
    const p = Number(opts.port) || (opts.protocol === 'https:' ? 443 : 80)
    const r = viaOf(host)
    if (!r) {
      return direct(opts, (err, sock) => {
        if (err && netErr(err)) noteFail(host, p, '', err)
        cb(err as Error, sock as never)
      })
    }
    dialVia(r.via, host, p, r.lan).then((raw) => {
      if (opts.protocol !== 'https:') return cb(null, raw)
      const s = tls.connect({ socket: raw, servername: opts.servername || (net.isIP(host) ? undefined : host), ALPNProtocols: ['http/1.1'] })
      s.once('secureConnect', () => cb(null, s))
      s.once('error', (e) => cb(e, null))
    }, (e) => cb(e, null))
  }
  setGlobalDispatcher(new Agent({ connect }))
}

// ---------- 测试：直连和经出口各连一次（只连 TCP，不发内容）----------
function tcpDirect(host: string, p: number, timeout = 8000): Promise<TestResult> {
  const t0 = Date.now()
  return new Promise((ok) => {
    const s = net.connect({ host, port: p })
    const done = (r: TestResult) => { clearTimeout(timer); s.destroy(); ok(r) }
    const timer = setTimeout(() => done({ ok: false, err: `${timeout / 1000} 秒没连上（超时）` }), timeout)
    s.on('connect', () => done({ ok: true, ms: Date.now() - t0 }))
    s.on('error', (e) => done({ ok: false, err: friendly(e) }))
  })
}
function friendly(e: unknown): string {
  const code = (e as { code?: string }).code
  return ({ ENOTFOUND: '域名解析不了', EAI_AGAIN: '域名暂时解析不了', ECONNREFUSED: '对方拒绝连接（端口没开）', ETIMEDOUT: '超时', EHOSTUNREACH: '到不了那台主机', ENETUNREACH: '网络不通', ECONNRESET: '连接被重置' } as Record<string, string>)[code ?? ''] ?? errText(e)
}
export async function test(host: string, p: number, via?: string, lan?: boolean): Promise<{ direct: TestResult; via?: TestResult }> {
  const [d, v] = await Promise.all([
    tcpDirect(host, p),
    via && via !== 'direct' ? (async (): Promise<TestResult> => {
      const bad = viaProblem(via)
      if (bad) return { ok: false, err: bad }
      const t0 = Date.now()
      try { const s = await dialVia(via, host, p, lan, 15_000); s.destroy(); return { ok: true, ms: Date.now() - t0 } } catch (e) { return { ok: false, err: errText(e) } }
    })() : Promise.resolve(undefined),
  ])
  if (!d.ok && !via) noteFail(host, p, '测试', new Error(d.err))
  return { direct: d, via: v }
}
