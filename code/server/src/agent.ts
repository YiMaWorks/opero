// Opero Agent：装在要干活的那台服务器上（安装脚本 --agent 模式，systemd 服务 opero-agent，root 跑），主动连回 Opero，不用开端口。
//   第一次用安装命令里的一次性令牌注册，拿到自己的密钥存在 /var/lib/opero-agent/agent.json（0600）；以后重启、重装都用它。
//   同一台机器（/etc/machine-id）用新令牌再跑一次安装命令：Opero 认得是同一台，换一把新密钥，不会多出一台。
//   干的活（Opero 派来的）：
//     spawn  起一个进程：as = ai 时以 opero-ai 用户跑（Claude Code / Codex / 装执行器 / 登录），as = root 时以 root 跑（服务器上的命令、git）
//     stdin  往进程里写 / 关掉输入；kill 停掉；write 放一个文件（聊天里发给员工的图片 / 文件）
//   输出攒一下（150ms）一起交回去；每 30 秒报一次心跳（CPU / 内存 / 磁盘 / 系统 / 装了哪些执行器）。
// 只用 Node 自带的东西，不 import 后台的模块（sysinfo.ts 除外：它也只用 Node 自带的）。
import { spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { sysInfo } from './sysinfo.ts'
import { watchResources } from './limits.ts'

const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')).version } catch { return '0.0.0' } })()
const DIR = process.env.OPERO_AGENT_DIR || '/var/lib/opero-agent'
const AI_USER = process.env.OPERO_AI_USER || 'opero-ai'
const WORK = '/srv/opero/work'
const MCP = path.join(import.meta.dirname, 'mcp.ts')
const NODE = process.execPath
const STATE = path.join(DIR, 'agent.json')
const ASKPASS = path.join(DIR, 'git-askpass.sh')

/** server：现在连的 Opero 地址；serverPub：认的 Opero 公钥（只执行它签过名的活）；key：旧版的密钥（兼容） */
interface State { server: string; key?: string; serverId?: string; usedToken?: string; serverPub?: string }
let state: State | null = null
const ENV_FILE = process.env.OPERO_AGENT_ENV_FILE || '/etc/opero/agent.env'
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const chown = (target: string) => { const c = spawn('chown', [`${AI_USER}:opero-work`, target]); c.on('error', () => {}) }

fs.mkdirSync(DIR, { recursive: true, mode: 0o700 })
fs.writeFileSync(ASKPASS, '#!/bin/sh\ncase "$1" in\n  Username*) printf "%s" "$OPERO_GIT_USER" ;;\n  *) printf "%s" "$OPERO_GIT_PASS" ;;\nesac\n', { mode: 0o700 })

// ---------- 这台 Agent 自己的密钥（指纹）：私钥不出这台机器，Opero 按指纹认它 ----------
const ID_FILE = path.join(DIR, 'id_ed25519.pem')
const idKey = (() => {
  if (!fs.existsSync(ID_FILE)) fs.writeFileSync(ID_FILE, crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  return crypto.createPrivateKey(fs.readFileSync(ID_FILE))
})()
const rawPub = (k: crypto.KeyObject) => (k.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32).toString('base64')
const fingerprint = (raw: string) => 'SHA256:' + crypto.createHash('sha256').update(Buffer.from(raw, 'base64')).digest('base64').replace(/=+$/, '')
const MY_PUB = rawPub(crypto.createPublicKey(idKey))
const MY_FP = fingerprint(MY_PUB)
function verifyWith(raw: string, data: string, sig: string) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(raw, 'base64')]), format: 'der', type: 'spki' })
    return crypto.verify(null, Buffer.from(data), key, Buffer.from(sig, 'base64'))
  } catch { return false }
}
/** 每个请求都签：方法、路径、时间、请求体的 sha256 */
function signedHeaders(method: string, url: string, body: string | Buffer) {
  const ts = String(Date.now())
  const u = new URL(url)
  // Opero 装在子路径下（https://x.com/opero/）时 nginx 会去掉前缀：签名只签 /api/... 这一段
  let base = ''
  try { base = new URL(state?.server ?? '').pathname.replace(/\/+$/, '') } catch { /* 还没地址 */ }
  const p = base && u.pathname.startsWith(base + '/') ? u.pathname.slice(base.length) : u.pathname
  const payload = `${method}\n${p}${u.search}\n${ts}\n${crypto.createHash('sha256').update(body).digest('hex')}`
  return {
    'X-Opero-Agent-Pub': MY_PUB, 'X-Opero-Ts': ts, 'X-Opero-Sig': crypto.sign(null, Buffer.from(payload), idKey).toString('base64'),
    'X-Opero-Host': encodeURIComponent(os.hostname()).slice(0, 60), 'X-Opero-Os': encodeURIComponent(osName()).slice(0, 120), 'X-Opero-Machine': machineId(),
  }
}

function machineId() {
  for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) { try { const v = fs.readFileSync(f, 'utf8').trim(); if (v) return v } catch { /* 下一个 */ } }
  const f = path.join(DIR, 'machine-id')
  try { return fs.readFileSync(f, 'utf8').trim() } catch { const v = crypto.randomUUID(); fs.writeFileSync(f, v); return v }
}
function osName() {
  try { const m = fs.readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]+)"?/m); if (m) return `${m[1]} · ${os.cpus().length} 核 · ${Math.round(os.totalmem() / 1073741824)}G` } catch { /* 用下面的 */ }
  return `${os.type()} ${os.release()}`
}

async function api(method: string, p: string, body?: unknown, timeoutMs = 30_000): Promise<any> {
  if (!state) throw new Error('还没注册')
  const b = body === undefined ? '' : JSON.stringify(body)
  const url = state.server + p
  const r = await fetch(url, {
    method, headers: { ...signedHeaders(method, url, b), 'Content-Type': 'application/json', 'User-Agent': `OperoAgent/${VERSION}` },
    body: body === undefined ? undefined : b, signal: AbortSignal.timeout(timeoutMs),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.message ?? `HTTP ${r.status}`), { status: r.status, code: j.code })
  return j
}

// ---------- 发布用的大文件：这台 ⇄ Opero（打包好的构建产物在服务器之间搬） ----------
const BLOB_MAX = 300 * 1024 * 1024
async function blobPush(t: any) {
  const id = String(t.id)
  try {
    const f = String(t.path)
    if (!f.startsWith(WORK + '/')) throw new Error('只能传工作目录里的文件')
    const buf = fs.readFileSync(f)
    if (buf.length > BLOB_MAX) throw new Error('文件超过 300 MB')
    const url = state!.server + `/api/agent/blob/${encodeURIComponent(String(t.key))}`
    const r = await fetch(url, { method: 'POST', headers: { ...signedHeaders('POST', url, buf), 'Content-Type': 'application/octet-stream', 'User-Agent': `OperoAgent/${VERSION}` }, body: buf, signal: AbortSignal.timeout(30 * 60_000) })
    if (!r.ok) throw new Error(`上传失败 HTTP ${r.status}：${(await r.text()).slice(0, 200)}`)
    emitOut(id, 'out', `已上传 ${buf.length} 字节\n`)
    emitOut(id, 'exit', undefined, 0)
  } catch (e: any) { emitOut(id, 'err', `${e.message}\n`); emitOut(id, 'exit', undefined, 1) }
}
async function blobPull(t: any) {
  const id = String(t.id)
  try {
    const f = String(t.path)
    if (!f.startsWith(WORK + '/')) throw new Error('只能放进工作目录')
    const url = state!.server + `/api/agent/blob/${encodeURIComponent(String(t.key))}`
    const r = await fetch(url, { headers: { ...signedHeaders('GET', url, ''), 'User-Agent': `OperoAgent/${VERSION}` }, signal: AbortSignal.timeout(30 * 60_000) })
    if (!r.ok) throw new Error(`下载失败 HTTP ${r.status}`)
    const buf = Buffer.from(await r.arrayBuffer())
    if (t.sha256 && crypto.createHash('sha256').update(buf).digest('hex') !== t.sha256) throw new Error('校验不对（sha256），文件可能坏了')
    mkdirFor(path.dirname(f))
    fs.writeFileSync(f, buf, { mode: 0o640 })
    emitOut(id, 'out', `已下载 ${buf.length} 字节\n`)
    emitOut(id, 'exit', undefined, 0)
  } catch (e: any) { emitOut(id, 'err', `${e.message}\n`); emitOut(id, 'exit', undefined, 1) }
}

const saveState = () => fs.writeFileSync(STATE, JSON.stringify(state), { mode: 0o600 })

// ---------- 注册 ----------
async function ensureRegistered() {
  try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { state = null }
  const server = (process.env.OPERO_SERVER || state?.server || '').replace(/\/+$/, '')
  const token = process.env.OPERO_JOIN_TOKEN || ''
  const trust = process.env.OPERO_TRUST_SERVER || '' // 换到另一套 Opero（指纹不同）时，在这里写它的指纹才认
  if (!server) throw new Error('不知道连哪套 Opero：在 /etc/opero/agent.env 里写 OPERO_SERVER=https://…，或者重新跑一次网页给的安装命令')
  if (!state) state = { server }
  if (state.server !== server) { log(`上报地址换了：${state.server} → ${server}（按指纹接上，不用重新注册）`); state.server = server }
  if (trust && state.serverPub && fingerprint(state.serverPub) !== trust) { log(`改认另一套 Opero：${trust}`); state.serverPub = undefined }
  saveState()
  log(`这台 Agent 的指纹：${MY_FP}`)
  if (!token || token === state.usedToken) return
  // 新令牌：带公钥、签名注册，马上就是「已接入」
  for (;;) {
    try {
      const url = server + '/api/agent/register'
      const body = JSON.stringify({ token, machineId: machineId(), hostname: os.hostname(), os: osName(), version: VERSION, server, pub: MY_PUB })
      const r = await fetch(url, { method: 'POST', headers: { ...signedHeaders('POST', url, body), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30_000), body })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw Object.assign(new Error(j.message ?? `HTTP ${r.status}`), { status: r.status })
      if (j.serverPub && !pinOk(j.serverPub)) throw new Error(`Opero 的指纹（${fingerprint(j.serverPub)}）和这台认的不一样：确认后在 agent.env 写 OPERO_TRUST_SERVER=那个指纹`)
      state = { ...state, server, usedToken: token, serverId: j.serverId, ...(j.serverPub ? { serverPub: j.serverPub } : {}) }
      saveState()
      log(`已接入 ${server}，在 Opero 里叫「${j.name}」；Opero 的指纹 ${j.serverFp ?? ''}`)
      return
    } catch (e: any) {
      if (e.status === 403) { log(`令牌用不了（${e.message}），按指纹接：在 Opero 网页上接受这台（指纹 ${MY_FP}）`); state.usedToken = token; saveState(); return }
      log('注册失败，30 秒后再试：', e.message)
      await sleep(30_000)
    }
  }
}

/** 认 Opero：第一次见到就记下（之后只认它）；配了 OPERO_TRUST_SERVER 就只认那个指纹 */
function pinOk(serverPub: string) {
  const trust = process.env.OPERO_TRUST_SERVER || ''
  if (trust) return fingerprint(serverPub) === trust
  if (!state!.serverPub) { state!.serverPub = serverPub; saveState(); log(`记下了 Opero 的指纹：${fingerprint(serverPub)}`); return true }
  return state!.serverPub === serverPub
}

/** Opero 让这台改连新地址（迁移）：改 agent.env，重启自己 */
function moveTo(url: string) {
  if (!/^https?:\/\/[^\s/]+/.test(url)) return
  try {
    let env = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : ''
    env = /^OPERO_SERVER=.*$/m.test(env) ? env.replace(/^OPERO_SERVER=.*$/m, `OPERO_SERVER=${url}`) : env + `\nOPERO_SERVER=${url}\n`
    fs.writeFileSync(ENV_FILE, env, { mode: 0o600 })
    state!.server = url.replace(/\/+$/, '')
    saveState()
    log(`Opero 让这台改连 ${url}，重启一下`)
    setTimeout(() => process.exit(0), 500) // systemd 会马上拉起来，读新的 agent.env
  } catch (e: any) { log('改地址失败：', e.message) }
}

// ---------- 输出攒一下再交 ----------
let outbox: { id: string; kind: string; data?: string; code?: number }[] = []
let flushing = false
async function flush() {
  if (flushing || !outbox.length) return
  flushing = true
  const batch = outbox
  outbox = []
  try { await api('POST', '/api/agent/events', { events: batch }) } catch (e: any) { log('交输出失败：', e.message); outbox = batch.concat(outbox) }
  flushing = false
}
setInterval(flush, 150).unref()
let soon: NodeJS.Timeout | null = null
function emitOut(id: string, kind: string, data?: string, code?: number) {
  const last = outbox[outbox.length - 1]
  const tunnel = kind.startsWith('t') // 隧道的数据是 base64，不能拼在一起；也要快点交（流式回复）
  if (!tunnel && data !== undefined && last && last.id === id && last.kind === kind && (last.data?.length ?? 0) < 32_000) last.data += data
  else outbox.push({ id, kind, data, code })
  if (kind === 'exit') flush()
  else if (tunnel && !soon) soon = setTimeout(() => { soon = null; flush() }, 10)
}

// ---------- AI 出口（隧道，见 server/src/tunnel.ts）----------
// 1) 这台当「干活的」：本机代理只听 127.0.0.1，执行器的 HTTPS_PROXY 指过来；CONNECT 到 AI 接口 → 报给 Opero（tup）→ Opero 接到选的出口
// 2) 这台当「出口」：Opero 派 tconn → 这台去连 AI 接口 → 两头原样转字节
const ALLOW = ['anthropic.com', 'claude.ai', 'claude.com', 'openai.com', 'chatgpt.com', 'oaistatic.com', 'oaiusercontent.com', 'storage.googleapis.com', 'npmjs.org', 'npmjs.com']
const allowedHost = (h: string) => ALLOW.some((d) => h === d || h.endsWith('.' + d))
function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  }
  const x = ip.toLowerCase()
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || (x.startsWith('::ffff:') && privateIp(x.slice(7)))
}
const PROXY_PORT = Number(process.env.OPERO_PROXY_PORT || 18089)
const PROXY_TOKEN = crypto.randomBytes(18).toString('hex')
const tsocks = new Map<string, { sock: net.Socket; client: boolean; ready: boolean }>()
let proxyUp = false

function startProxy() {
  const srv = http.createServer((_q, r) => { r.writeHead(405); r.end('CONNECT only') })
  srv.on('connect', (req, sock: net.Socket, head: Buffer) => {
    const auth = String(req.headers['proxy-authorization'] ?? '').replace(/^Basic\s+/i, '')
    const [user, pass] = Buffer.from(auth, 'base64').toString().split(':')
    if (!pass || pass.length !== PROXY_TOKEN.length || !crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(PROXY_TOKEN))) {
      sock.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="opero"\r\n\r\n'); return
    }
    const [host, p] = String(req.url ?? '').split(':')
    const id = crypto.randomUUID()
    tsocks.set(id, { sock, client: true, ready: false })
    sock.on('data', (b: Buffer) => { const t = tsocks.get(id); if (t?.ready) emitOut(id, 'tdata', b.toString('base64')) })
    sock.on('error', () => {})
    sock.on('close', () => { if (tsocks.delete(id)) emitOut(id, 'tclose') })
    if (head?.length) setTimeout(() => emitOut(id, 'tdata', head.toString('base64')), 0)
    emitOut(id, 'tup', JSON.stringify({ host, port: Number(p) || 443, egress: decodeURIComponent(user || '') }))
    setTimeout(() => { const t = tsocks.get(id); if (t && !t.ready) { tsocks.delete(id); sock.end('HTTP/1.1 504 Gateway Timeout\r\n\r\n') } }, 25_000)
  })
  srv.on('error', (e) => { log('本机出口代理起不来：', e.message); proxyUp = false })
  srv.listen(PROXY_PORT, '127.0.0.1', () => { proxyUp = true })
}

// any：Opero 自己往外连（主人设的网络出口规则）——任意域名、端口；lan：规则上勾了「允许内网」才连内网地址
async function tconn(id: string, host: string, port: number, o: { any?: boolean; lan?: boolean } = {}) {
  try {
    if (!o.any && (port !== 443 || !allowedHost(host))) throw new Error(`出口只连 AI 的接口（${host}:${port} 不在名单里）`)
    if (!host || !(port >= 1 && port <= 65535)) throw new Error(`地址不对：${host}:${port}`)
    const addrs = await dns.lookup(host, { all: true })
    if (!addrs.length) throw new Error(`${host} 解析不出地址`)
    if (!o.lan && addrs.some((a) => privateIp(a.address))) throw new Error(`${host} 解析到了内网地址，拒绝（要连内网，在出口规则上勾「允许内网」）`)
    const sock = net.connect({ host: addrs[0].address, port })
    tsocks.set(id, { sock, client: false, ready: false })
    sock.on('connect', () => { const t = tsocks.get(id); if (t) t.ready = true; emitOut(id, 'topen') })
    sock.on('data', (b: Buffer) => emitOut(id, 'tdata', b.toString('base64')))
    sock.on('error', () => {})
    sock.on('close', () => { if (tsocks.delete(id)) emitOut(id, 'tclose') })
  } catch (e: any) {
    outbox.push({ id, kind: 'tclose', data: undefined, code: undefined, ...({ err: e.message } as object) })
    flush()
  }
}

// ---------- 活 ----------
const procs = new Map<string, ChildProcess>()
const fill = (s: string) => s.replaceAll('{{NODE}}', NODE).replaceAll('{{MCP}}', MCP).replaceAll('{{SRC}}', path.dirname(MCP)).replaceAll('{{API}}', state?.server ?? '')

function mkdirFor(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  if (dir.startsWith(WORK)) {
    // 从 WORK 往下一层层交给 AI 用户（组可读写、新文件跟组走）
    let d = dir
    while (d.startsWith(WORK) && d.length >= WORK.length) {
      try { chown(d); fs.chmodSync(d, 0o2770) } catch { /* 尽量 */ }
      if (d === WORK) break
      d = path.dirname(d)
    }
  }
}

function doSpawn(t: any) {
  const id = String(t.id)
  const args: string[] = (t.args ?? []).map((a: unknown) => fill(String(a)))
  const env: Record<string, string> = Object.fromEntries(Object.entries(t.env ?? {}).map(([k, v]) => [k, fill(String(v))]))
  for (const d of t.mkdirs ?? []) { try { mkdirFor(String(d)) } catch { /* 下面会报错 */ } }
  let cwd = String(t.cwd || '/')
  if (!fs.existsSync(cwd)) { try { mkdirFor(cwd) } catch { cwd = '/' } }
  let p: ChildProcess
  try {
    if (t.as === 'root') {
      if (env.OPERO_GIT_PASS) env.GIT_ASKPASS = ASKPASS
      p = spawn(String(t.bin), args, { cwd, env: { ...process.env, ...env } as Record<string, string>, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    } else {
      const wrapper = `export PATH="\${OPERO_SHIMS:+\$OPERO_SHIMS:}$HOME/.local/bin:$PATH:${path.dirname(NODE)}"; umask 007; exec nice -n 10 "$0" "$@"`
      const keep = Object.keys(env)
      p = spawn('sudo', ['-n', '-u', AI_USER, '-H', ...(keep.length ? [`--preserve-env=${keep.join(',')}`] : []), '--', 'bash', '-lc', wrapper, String(t.bin), ...args],
        { cwd, env: { ...process.env, ...env } as Record<string, string>, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    }
  } catch (e: any) {
    emitOut(id, 'err', `起不来：${e.message}\n`)
    emitOut(id, 'exit', undefined, -1)
    return
  }
  procs.set(id, p)
  // 内存上限（Opero 那边这台的规矩）：超了在 stderr 里说一句，Opero 转到聊天里
  const pct = Number(t.memPct) || 0
  const cpuPct = Number(t.cpuPct) || 0
  const unwatch = watchResources(p.pid, { memPct: pct, cpuPct }, {
    warnCpu: (() => { let at = 0; return (u: number) => { if (Date.now() - at > 5 * 60_000) { at = Date.now(); emitOut(id, 'err', `[opero] ⚠ 员工的进程用了这台 ${u}% CPU（上限 ${cpuPct}%），一直这样会先暂停最占 CPU 的进程\n`) } } })(),
    paused: (k, u) => emitOut(id, 'err', `[opero] ⏸ CPU 一直超过上限（${u}% > ${cpuPct}%），先暂停了：${k.cmd || k.pid}。机器降下来会自动继续\n`),
    resumed: (k) => emitOut(id, 'err', `[opero] ▶ 机器降下来了，继续：${k.cmd || k.pid}\n`),
    stoppedCpu: (k) => emitOut(id, 'err', `[opero] ⚠ 暂停了 10 分钟机器还是忙，停掉了：${k.cmd || k.pid}。要编译就交给流水线\n`),
    warn: (() => { let at = 0; return (u: number) => { if (Date.now() - at > 5 * 60_000) { at = Date.now(); emitOut(id, 'err', `[opero] ⚠ 员工的进程用了这台 ${u}% 内存（上限 ${pct}%），一直这样会停掉最大的那个进程\n`) } } })(),
    killed: (k, u) => emitOut(id, 'err', `[opero] ⚠ 内存超过上限（${u}% > ${pct}%），停掉了最大的进程：${k.cmd || k.pid}（${k.mb} MB）\n`),
  })
  p.on('close', unwatch)
  const dOut = new StringDecoder('utf8')
  const dErr = new StringDecoder('utf8')
  p.stdout!.on('data', (b: Buffer) => emitOut(id, 'out', dOut.write(b)))
  p.stderr!.on('data', (b: Buffer) => emitOut(id, 'err', dErr.write(b)))
  p.stdin!.on('error', () => {})
  p.on('error', (e) => emitOut(id, 'err', `${e.message}\n`))
  p.on('close', (code) => { procs.delete(id); emitOut(id, 'exit', undefined, code ?? -1) })
}

function kill(p: ChildProcess) {
  try { if (p.pid) process.kill(-p.pid, 'SIGTERM') } catch { try { p.kill('SIGTERM') } catch { /* 没了 */ } }
  setTimeout(() => { try { if (p.pid) process.kill(-p.pid, 'SIGKILL') } catch { /* 没了 */ } }, 5000).unref()
}

function handle(t: any) {
  switch (t.t) {
    case 'spawn': return doSpawn(t)
    case 'push': blobPush(t); return
    case 'pull': blobPull(t); return
    case 'stdin': {
      const p = procs.get(String(t.id))
      if (!p) return
      if (typeof t.data === 'string') p.stdin!.write(t.data)
      if (t.end) p.stdin!.end()
      return
    }
    case 'kill': { const p = procs.get(String(t.id)); if (p) kill(p); return }
    case 'tconn': tconn(String(t.id), String(t.host ?? ''), Number(t.port ?? 0), { any: t.any === true, lan: t.lan === true }); return
    case 'tok': {
      const x = tsocks.get(String(t.id))
      if (x && x.client) { x.ready = true; x.sock.write('HTTP/1.1 200 Connection Established\r\n\r\n') }
      return
    }
    case 'tdata': { const x = tsocks.get(String(t.id)); if (x && typeof t.data === 'string') x.sock.write(Buffer.from(t.data, 'base64')); return }
    case 'tclose': {
      const x = tsocks.get(String(t.id))
      if (!x) return
      tsocks.delete(String(t.id))
      if (x.client && !x.ready) x.sock.end(`HTTP/1.1 502 Bad Gateway\r\nX-Opero-Error: ${encodeURIComponent(String(t.err ?? ''))}\r\n\r\n`)
      else x.sock.destroy()
      return
    }
    case 'write': {
      try {
        const f = String(t.path)
        if (!f.startsWith(WORK + '/')) return // 只往工作目录里放
        mkdirFor(path.dirname(f))
        fs.writeFileSync(f, Buffer.from(String(t.data ?? ''), 'base64'), { mode: 0o660 })
        chown(f)
      } catch (e: any) { log('放文件失败：', e.message) }
      return
    }
    default:
      // 不认识的活（Opero 比这个 Agent 新）：回一句并结束，别让 Opero 干等到超时
      if (t.id) { emitOut(String(t.id), 'err', `这个 Agent（${VERSION}）不认识「${String(t.t)}」：在 Opero 的服务器详情里点「升级 Agent」\n`); emitOut(String(t.id), 'exit', undefined, 1) }
      return
  }
}

// ---------- 心跳 ----------
let lastCpu: number[] | null = null
function cpuPct() {
  try {
    const a = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number)
    const prev = lastCpu
    lastCpu = a
    if (!prev) return 0
    const total = a.reduce((x, y) => x + y, 0) - prev.reduce((x, y) => x + y, 0)
    const idle = (a[3] + (a[4] ?? 0)) - (prev[3] + (prev[4] ?? 0))
    return total > 0 ? Math.round(100 * (1 - idle / total)) : 0
  } catch { return 0 }
}
function memPct() {
  try {
    const m = fs.readFileSync('/proc/meminfo', 'utf8')
    const t = Number(m.match(/MemTotal:\s+(\d+)/)?.[1]); const a = Number(m.match(/MemAvailable:\s+(\d+)/)?.[1])
    return t ? Math.round(100 * (1 - a / t)) : 0
  } catch { return 0 }
}
function diskPct() { try { const s = fs.statfsSync('/'); return Math.round(100 * (1 - s.bavail / s.blocks)) } catch { return 0 } }

function version(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const wrapper = `export PATH="$HOME/.local/bin:$PATH:${path.dirname(NODE)}"; exec "$0" "$@"`
    const p = spawn('sudo', ['-n', '-u', AI_USER, '-H', '--', 'bash', '-lc', wrapper, bin, '--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (b) => { out += b })
    const t = setTimeout(() => p.kill('SIGKILL'), 15_000)
    p.on('close', (code) => { clearTimeout(t); resolve(code === 0 ? out.trim().split('\n').pop() ?? '' : null) })
    p.on('error', () => { clearTimeout(t); resolve(null) })
  })
}
let execs: { claude: string | null; codex: string | null; qwen: string | null; codebuddy: string | null } | null = null
let execsAt = 0
async function beat() {
  if (!execs || Date.now() - execsAt > 5 * 60_000) { execs = { claude: await version('claude'), codex: await version('codex'), qwen: await version('qwen'), codebuddy: await version('codebuddy') }; execsAt = Date.now() }
  await api('POST', '/api/agent/health', { cpu: cpuPct(), mem: memPct(), disk: diskPct(), os: osName(), version: VERSION, hostname: os.hostname(), sys: sysInfo(), executors: execs, proxy: proxyUp ? { port: PROXY_PORT, token: PROXY_TOKEN } : null })
}

// ---------- 主循环 ----------
async function main() {
  log(`Opero Agent ${VERSION} 启动`)
  await ensureRegistered()
  startProxy()
  cpuPct()
  setInterval(() => { beat().catch((e) => log('心跳失败：', e.message)) }, 30_000).unref()
  setTimeout(() => { execsAt = 0; beat().catch(() => {}) }, 2000)
  let fails = 0
  for (;;) {
    try {
      const r = await api('GET', `/api/agent/poll?v=${VERSION}`, undefined, 40_000)
      fails = 0
      if (r.sig && r.server) {
        // 新版 Opero：活都签了名，认指纹、验签名、时间不能太旧，才执行
        const ok = pinOk(r.server) && verifyWith(r.server, `${r.ts}\n${JSON.stringify(r.tasks ?? [])}`, r.sig) && Math.abs(Date.now() - Number(r.ts)) < 5 * 60_000
        if (!ok) { log(`收到的活签名不对或者不是认的那套 Opero（${fingerprint(r.server)}），不执行`); await sleep(10_000); continue }
      } else if (state?.serverPub) { log('收到的活没有签名，不执行（这台认的 Opero 是签名的）'); await sleep(10_000); continue }
      for (const t of r.tasks ?? []) { try { if (t.t === 'move') moveTo(String(t.url ?? '')); else handle(t) } catch (e: any) { log('处理出错：', e.message) } }
      if ((r.tasks ?? []).some((t: any) => t.t === 'spawn' && /install|npm/.test(JSON.stringify(t.args ?? '')))) execsAt = 0 // 装了执行器：下次心跳重新看版本
    } catch (e: any) {
      if (e.status === 403 && e.code === 'PENDING') { log(`等主人在 Opero 网页上接受这台（指纹 ${MY_FP}）`); await sleep(15_000); continue }
      if (e.status === 401) { log(`Opero 不认这台（${e.message}）。5 分钟后再试`); await sleep(300_000); continue }
      fails++
      log('连不上 Opero：', e.message)
      await sleep(Math.min(30_000, 2000 * fails))
    }
  }
}

if (process.argv.includes('--fingerprint')) {
  let st: State | null = null
  try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { /* 还没连过 */ }
  console.log(`这台 Agent 的指纹：${MY_FP}`)
  console.log(`连的 Opero：${st?.server ?? process.env.OPERO_SERVER ?? '（没配）'}`)
  console.log(`认的 Opero 指纹：${st?.serverPub ? fingerprint(st.serverPub) : '（还没连上过）'}`)
  process.exit(0)
}
main().catch((e) => { log('Agent 停了：', e.message); process.exit(1) })
process.on('SIGTERM', () => { for (const p of procs.values()) kill(p); setTimeout(() => process.exit(0), 1000) })
