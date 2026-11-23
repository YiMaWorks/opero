// AI 出口（照 KidLock「走 agent 出海」：复用 Agent 本来就有的「Agent → Opero」连接，不用新开端口）。
// KidLock 是一次请求交给出海 Agent 代发；Claude Code / Codex 是长连接、流式的，所以这里做成「隧道」：
//   干活那台上，执行器的 HTTPS_PROXY 指向本机一个只听 127.0.0.1 的代理（Opero 这台：后台自己开；别的服务器：Agent 开），带口令；
//   代理收到 CONNECT api.anthropic.com:443 → 经 Opero 转给选作出口的那台（Agent，或 Opero 这台自己）→ 那台去连 → 两头原样转字节（TLS 端到端，中间看不到内容）。
//   出口只连 AI 相关的域名（ALLOW），连之前查一下解析出来的不是内网 / 本机 / 云元数据地址（防 SSRF），只许 443。
import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import http from 'node:http'
import net from 'node:net'
import { cfg } from './config.ts'
import { get, uid } from './db.ts'
import * as agents from './agents.ts'
import type { Server } from './types.ts'

/** 出口能连的域名（含子域名）：Claude / OpenAI 的接口、登录、安装包 */
export const ALLOW = ['anthropic.com', 'claude.ai', 'claude.com', 'openai.com', 'chatgpt.com', 'oaistatic.com', 'oaiusercontent.com', 'storage.googleapis.com', 'npmjs.org', 'npmjs.com']
export const allowedHost = (h: string) => ALLOW.some((d) => h === d || h.endsWith('.' + d))
export function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const x = ip.toLowerCase()
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:') && privateIp(x.slice(7))
}

/** Opero 这台本机的代理（给跑在本机的执行器用） */
export const LOCAL_PORT = Number(process.env.OPERO_PROXY_PORT || cfg.port + 1)
export const LOCAL_TOKEN = crypto.randomBytes(18).toString('hex')

type End = { kind: 'sock'; sock: net.Socket } | { kind: 'agent'; serverId: string }
interface Tunnel { id: string; client: End; server?: End; open: boolean; closed: boolean }
const tunnels = new Map<string, Tunnel>()

function send(end: End, t: Record<string, unknown>) { if (end.kind === 'agent') agents.sendTask(end.serverId, t as agents.Task) }

/** 客户端那头：连上了 / 失败 */
function clientOk(tn: Tunnel) {
  tn.open = true
  if (tn.client.kind === 'sock') tn.client.sock.write('HTTP/1.1 200 Connection Established\r\n\r\n')
  else send(tn.client, { t: 'tok', id: tn.id })
}
function fail(tn: Tunnel, msg: string) {
  if (tn.closed) return
  tn.closed = true
  tunnels.delete(tn.id)
  if (tn.client.kind === 'sock') { try { tn.client.sock.end(`HTTP/1.1 502 Bad Gateway\r\nX-Opero-Error: ${encodeURIComponent(msg)}\r\n\r\n`) } catch { /* 断了 */ } }
  else send(tn.client, { t: 'tclose', id: tn.id, err: msg })
  if (tn.server?.kind === 'sock') tn.server.sock.destroy()
  else if (tn.server) send(tn.server, { t: 'tclose', id: tn.id })
}
function close(tn: Tunnel) {
  if (tn.closed) return
  tn.closed = true
  tunnels.delete(tn.id)
  for (const end of [tn.client, tn.server]) {
    if (!end) continue
    if (end.kind === 'sock') end.sock.destroy()
    else send(end, { t: 'tclose', id: tn.id })
  }
}
function toClient(tn: Tunnel, buf: Buffer) {
  if (tn.client.kind === 'sock') tn.client.sock.write(buf)
  else send(tn.client, { t: 'tdata', id: tn.id, data: buf.toString('base64') })
}
function toServer(tn: Tunnel, buf: Buffer) {
  if (!tn.server) return
  if (tn.server.kind === 'sock') tn.server.sock.write(buf)
  else send(tn.server, { t: 'tdata', id: tn.id, data: buf.toString('base64') })
}

/** 开一条隧道：egress = 'local'（Opero 这台出去）或 Agent 服务器编号 */
async function open(client: End, id: string, egress: string, host: string, port: number) {
  const tn: Tunnel = { id, client, open: false, closed: false }
  tunnels.set(id, tn)
  if (port !== 443 || !allowedHost(host)) return fail(tn, `出口只连 AI 的接口（${host}:${port} 不在名单里）`)
  if (egress === 'local') {
    try {
      const addrs = await dns.lookup(host, { all: true })
      if (!addrs.length || addrs.some((a) => privateIp(a.address))) return fail(tn, `${host} 解析到了内网地址，拒绝`)
      const sock = net.connect({ host: addrs[0].address, port })
      tn.server = { kind: 'sock', sock }
      sock.on('connect', () => clientOk(tn))
      sock.on('data', (b: Buffer) => toClient(tn, b))
      sock.on('error', (e) => (tn.open ? close(tn) : fail(tn, e.message)))
      sock.on('close', () => close(tn))
    } catch (e) { fail(tn, (e as Error).message) }
    return
  }
  const sv = get<Server>('servers', egress)
  if (!agents.agentOnline(sv)) return fail(tn, `出口「${sv?.name ?? egress}」的 Agent 不在线`)
  tn.server = { kind: 'agent', serverId: egress }
  send(tn.server, { t: 'tconn', id, host, port })
  setTimeout(() => { if (!tn.open && !tn.closed) fail(tn, '出口连不上（20 秒没回应）') }, 20_000)
}

/** Agent 报上来的隧道事件（tup：它那台的执行器要开隧道；topen / tdata / tclose） */
export function agentEvent(serverId: string, e: { id?: string; kind?: string; data?: string }) {
  const id = String(e.id ?? '')
  if (e.kind === 'tup') {
    let req: { host?: string; port?: number; egress?: string } = {}
    try { req = JSON.parse(e.data ?? '{}') } catch { /* 坏的 */ }
    open({ kind: 'agent', serverId }, id, String(req.egress ?? ''), String(req.host ?? ''), Number(req.port ?? 0))
    return
  }
  const tn = tunnels.get(id)
  if (!tn) return
  const isServer = tn.server?.kind === 'agent' && tn.server.serverId === serverId
  const isClient = tn.client.kind === 'agent' && tn.client.serverId === serverId
  if (e.kind === 'topen' && isServer) clientOk(tn)
  else if (e.kind === 'tdata' && e.data) {
    const buf = Buffer.from(e.data, 'base64')
    if (isServer) toClient(tn, buf)
    else if (isClient) toServer(tn, buf)
  } else if (e.kind === 'tclose') { if (tn.open) close(tn); else fail(tn, String((e as { err?: string }).err ?? '出口那边断了')) }
}

/** Agent 掉线：经它的隧道都断掉 */
export function dropAgent(serverId: string) {
  for (const tn of [...tunnels.values()]) {
    if ((tn.client.kind === 'agent' && tn.client.serverId === serverId) || (tn.server?.kind === 'agent' && tn.server.serverId === serverId)) close(tn)
  }
}

/** Opero 这台的本机代理：只听 127.0.0.1，口令 = LOCAL_TOKEN，用户名 = 出口（local / 服务器编号） */
export function startLocalProxy() {
  const srv = http.createServer((_req, res) => { res.writeHead(405); res.end('CONNECT only') })
  srv.on('connect', (req, sock: net.Socket, head: Buffer) => {
    const auth = String(req.headers['proxy-authorization'] ?? '').replace(/^Basic\s+/i, '')
    const [user, pass] = Buffer.from(auth, 'base64').toString().split(':')
    const ok = !!pass && pass.length === LOCAL_TOKEN.length && crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(LOCAL_TOKEN))
    if (!ok) { sock.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="opero"\r\n\r\n'); return }
    const [host, p] = String(req.url ?? '').split(':')
    const id = uid('t')
    sock.on('error', () => { const tn = tunnels.get(id); if (tn) close(tn) })
    sock.on('close', () => { const tn = tunnels.get(id); if (tn) close(tn) })
    sock.on('data', (b: Buffer) => { const tn = tunnels.get(id); if (tn?.open) toServer(tn, b) })
    open({ kind: 'sock', sock }, id, decodeURIComponent(user || ''), host, Number(p) || 443).then(() => {
      const tn = tunnels.get(id)
      if (tn && head?.length) toServer(tn, head)
    })
  })
  srv.on('error', (e) => console.error('本机出口代理起不来：', e.message))
  srv.listen(LOCAL_PORT, '127.0.0.1')
}

// 接到 agents.ts 上
agents.hooks.tunnelEvent = agentEvent
agents.hooks.dropped = dropAgent
