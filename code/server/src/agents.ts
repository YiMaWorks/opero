// Agent 管理（Opero 这边）：别的服务器装上 Opero Agent（code/server/src/agent.ts），主动连回来，员工就能在那台上干活。
//   接入：网页生成一次性令牌（30 分钟）→ 那台服务器上用 root 跑安装命令 → Agent 用令牌注册，拿到自己的密钥（只存 sha256）。
//         同一台机器（/etc/machine-id）再注册就还是原来那台：重装、换令牌重跑都不会多出一台。
//   通道：Agent 长轮询 GET /api/agent/poll 取活，POST /api/agent/events 交输出，POST /api/agent/health 报心跳（CPU / 内存 / 装了哪些执行器）。
//   活：spawn（起一个进程，以 AI 用户或 root）、stdin、kill、write（放文件）。远程进程在这边包成 RemoteProc，用起来和本机子进程一样。
// 那台机器不用开端口；Opero 这边要能被它访问到（OPERO_URL / 安装命令里的地址）。
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { all, del, get, put, uid } from './db.ts'
import { emit } from './bus.ts'
import { cleanSys } from './sysinfo.ts'
import { audit } from './chat.ts'
import { sha } from './auth.ts'
import * as keys from './keys.ts'
import type { Server } from './types.ts'

export const REMOTE_WORK = '/srv/opero/work'
export const isAgent = (sv?: Server) => sv?.via === 'agent' || (!!sv?.agentKeyHash && sv?.via !== 'ssh' && sv?.via !== 'pending' && sv?.via !== 'rejected')
export const ONLINE_MS = 90_000
export const agentOnline = (sv?: Server) => !!sv && isAgent(sv) && Date.now() - (sv.lastSeen ?? 0) < ONLINE_MS

// ---------- 接入令牌 ----------
const joins = new Map<string, { exp: number; env: Server['env']; name?: string }>()
export function newJoinToken(env: Server['env'], name?: string) {
  const token = 'opj_' + crypto.randomBytes(18).toString('base64url')
  joins.set(token, { exp: Date.now() + 30 * 60_000, env, name })
  return token
}

export function register(b: { token?: string; machineId?: string; hostname?: string; os?: string; version?: string; server?: string; pub?: string }, ip: string, signedOk = false) {
  const j = joins.get(String(b.token ?? ''))
  if (!j || j.exp < Date.now()) throw new Error('接入令牌不对或者过期了：在 Opero 网页「应用 → 服务器 → 接入」重新生成')
  joins.delete(String(b.token))
  const machineId = String(b.machineId ?? '').slice(0, 80)
  const key = 'opa_' + crypto.randomBytes(32).toString('base64url')
  // 带了公钥并且用它签了名：按指纹认（同一对密钥 = 同一台），其次按机器编号
  const apub = signedOk && typeof b.pub === 'string' ? b.pub : ''
  const fp = apub ? keys.fingerprint(apub) : ''
  const old = (fp ? all<Server>('servers').find((s) => s.agentFp === fp) : undefined) ?? (machineId ? all<Server>('servers').find((s) => s.machineId === machineId) : undefined)
  const base: Server = old ?? {
    id: uid('sv'), name: j.name || String(b.hostname || ip || 'server').slice(0, 40), ip, env: j.env, os: '', agent: 'Opero Agent',
    online: false, cpu: 0, mem: 0, disk: 0, services: [], logs: [],
  }
  const sv: Server = {
    ...base, via: 'agent', agent: 'Opero Agent', agentKeyHash: sha(key), machineId, ...(apub ? { agentPub: apub, agentFp: fp } : {}), agentVersion: String(b.version ?? ''), agentUrl: String(b.server ?? ''),
    ip: ip || base.ip, os: String(b.os || base.os), lastSeen: Date.now(), joinedAt: Date.now(), online: true, credential: undefined, hostKey: undefined,
  }
  put('servers', sv)
  emit({ t: 'put', coll: 'servers', item: pub(sv) })
  audit({ via: '—', action: old ? 'agent.reconnect' : 'agent.add', target: `${sv.name} · ${ip}`, level: '写', result: '成功', how: old ? '同一台机器重新接入（重装 / 新令牌）' : '接入令牌' })
  return { key, serverId: sv.id, name: sv.name, serverPub: keys.SERVER_PUB, serverFp: keys.SERVER_FP }
}

/** 按指纹认 Agent（每个请求都签名）：认识的就放行；不认识的记成「待接入」等你在网页上核对指纹后接受 */
export function authSigned(h: Record<string, string | string[] | undefined>, method: string, url: string, body: Buffer, ip: string):
  { ok: true; serverId: string } | { ok: false; status: number; code: string; msg: string } {
  const pub = String(h['x-opero-agent-pub'] ?? '')
  const ts = String(h['x-opero-ts'] ?? '')
  const sig = String(h['x-opero-sig'] ?? '')
  if (Math.abs(Date.now() - Number(ts)) > 5 * 60_000) return { ok: false, status: 401, code: 'CLOCK', msg: '这台机器的时间和 Opero 差了 5 分钟以上，先校准时间（timedatectl / ntp）' }
  if (!keys.verify(pub, keys.agentPayload(method, url, ts, body), sig)) return { ok: false, status: 401, code: 'SIG', msg: '签名不对' }
  const fp = keys.fingerprint(pub)
  const sv = all<Server>('servers').find((s) => s.agentFp === fp)
  if (sv?.via === 'agent') return { ok: true, serverId: sv.id }
  if (sv?.via === 'rejected') return { ok: false, status: 401, code: 'REJECTED', msg: '主人拒绝了这台机器接入' }
  if (sv && sv.via !== 'pending') return { ok: false, status: 401, code: 'AGENT', msg: '这台的 Agent 已被移除：在 Opero 网页「应用 → 服务器 → 接入」重新生成命令再跑一次' }
  if (!sv) {
    const pending: Server = {
      id: uid('sv'), name: String(h['x-opero-host'] ?? ip ?? 'server').slice(0, 40), ip, env: '测试', os: String(h['x-opero-os'] ?? ''), agent: 'Opero Agent',
      online: false, cpu: 0, mem: 0, disk: 0, services: [], logs: [], via: 'pending', agentPub: pub, agentFp: fp, machineId: String(h['x-opero-machine'] ?? '').slice(0, 80), lastSeen: Date.now(),
    }
    put('servers', pending)
    emit({ t: 'put', coll: 'servers', item: pub2(pending) })
    audit({ via: '—', action: 'agent.pending', target: `${pending.name} · ${ip} · ${fp}`, level: '写', result: '成功', how: '没有令牌、按指纹来接入，等主人接受' })
  } else if (Date.now() - (sv.lastSeen ?? 0) > 60_000) { const n = { ...sv, lastSeen: Date.now(), ip }; put('servers', n); emit({ t: 'put', coll: 'servers', item: pub2(n) }) }
  return { ok: false, status: 403, code: 'PENDING', msg: `等主人在 Opero 网页「应用 → 服务器和 Agent」里接受（核对指纹 ${fp}）` }
}
const pub2 = (s: Server) => pub(s)

/** 接受 / 拒绝一台「待接入」的 */
export function decide(id: string, accept: boolean) {
  const sv = get<Server>('servers', id)
  if (!sv || sv.via !== 'pending') throw new Error('不是待接入的机器')
  // 装在 Opero 这台上的：挂到「本机」上，不多出一台
  const local = get<Server>('servers', 'local')
  if (accept && local && sv.machineId && local.machineId === sv.machineId) {
    const merged: Server = { ...local, via: 'agent', agentPub: sv.agentPub, agentFp: sv.agentFp, lastSeen: Date.now(), joinedAt: Date.now(), online: true }
    put('servers', merged); del('servers', sv.id)
    emit({ t: 'put', coll: 'servers', item: pub(merged) }); emit({ t: 'del', coll: 'servers', id: sv.id })
    audit({ via: '—', action: 'agent.accept', target: `本机 · ${sv.agentFp}`, level: '危险', result: '成功', how: '本人核对指纹（已验证）· 装在 Opero 这台上，挂到本机' })
    return merged
  }
  const next: Server = { ...sv, via: accept ? 'agent' : 'rejected', lastSeen: accept ? Date.now() : sv.lastSeen, ...(accept ? { joinedAt: Date.now() } : {}) }
  put('servers', next)
  emit({ t: 'put', coll: 'servers', item: pub(next) })
  audit({ via: '—', action: accept ? 'agent.accept' : 'agent.reject', target: `${sv.name} · ${sv.agentFp}`, level: '危险', result: '成功', how: '本人核对指纹（已验证）' })
  return next
}

/** 签名回给 Agent 的活：Agent 认 Opero 的指纹才执行 */
export function signedTasks(tasks: Task[]) {
  const ts = String(Date.now())
  const body = JSON.stringify(tasks)
  return { tasks, ts, server: keys.SERVER_PUB, sig: keys.sign(`${ts}\n${body}`) }
}

export function byKey(key: string) {
  if (!key) return undefined
  const h = sha(key)
  return all<Server>('servers').find((s) => s.agentKeyHash === h)
}

export function remove(id: string) {
  const sv = get<Server>('servers', id)
  if (!sv) return
  const { agentKeyHash: _k, ...rest } = sv
  // 只是作废密钥：那台机器的 Agent 下一次来就会被拒；服务器记录留着（员工、项目还指着它），可以再接入
  // 本机去掉 Agent：回到「Opero 自己的用户」，本机还是在线的
  const next: Server = sv.id === 'local' ? { ...rest, via: undefined, online: true } : { ...rest, online: false, via: 'ssh' } // 指纹留着：这台再用同一对密钥来就拒绝，除非重新用令牌接入
  put('servers', next)
  emit({ t: 'put', coll: 'servers', item: pub(next) })
  for (const p of procs.values()) if (p.serverId === id) p.fail('Agent 已被移除')
}

export function pub(sv: Server) {
  const { agentKeyHash: _k, hostKey: _h, proxyToken: _p, agentPub: _ap, ...rest } = sv
  return { ...rest, via: sv.via ?? (sv.id === 'local' ? 'local' : isAgent(sv) ? 'agent' : 'ssh') }
}

export function health(sv: Server, b: any, ip?: string) {
  const next: Server = {
    ...sv, lastSeen: Date.now(), online: true, error: undefined, ip: ip || sv.ip, sys: cleanSys(b.sys) ?? sv.sys,
    cpu: num(b.cpu), mem: num(b.mem), disk: num(b.disk), os: String(b.os || sv.os || ''), agentVersion: String(b.version || sv.agentVersion || ''),
    executors: b.executors && typeof b.executors === 'object' ? { claude: b.executors.claude ?? null, codex: b.executors.codex ?? null, qwen: b.executors.qwen ?? null, codebuddy: b.executors.codebuddy ?? null } : sv.executors,
    // 那台本机的出口代理（只听 127.0.0.1）：端口和口令，给跑在那台的执行器配 HTTPS_PROXY
    proxyPort: Number(b.proxy?.port) || sv.proxyPort, proxyToken: typeof b.proxy?.token === 'string' ? b.proxy.token : sv.proxyToken,
  }
  put('servers', next)
  emit({ t: 'put', coll: 'servers', item: pub(next) })
}
const num = (v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)))

/** 心跳断了 90 秒：标成离线 */
export function sweep() {
  for (const sv of all<Server>('servers')) {
    // 本机的 Agent 掉线只是少了 root 通道，本机（和上面的员工）照常：不算离线
    if (sv.id !== 'local' && isAgent(sv) && sv.online && !agentOnline(sv)) {
      const next = { ...sv, online: false, error: 'Agent 没有心跳（机器关了、网络断了，或 opero-agent 服务停了）' }
      put('servers', next)
      emit({ t: 'put', coll: 'servers', item: pub(next) })
      for (const p of procs.values()) if (p.serverId === sv.id) p.fail('那台服务器的 Agent 断开了，这一轮停了')
      hooks.dropped?.(sv.id)
    }
  }
}

// ---------- 派活：每台一个队列，Agent 长轮询来取 ----------
export interface Task { t: 'spawn' | 'stdin' | 'kill' | 'write' | 'tconn' | 'tdata' | 'tclose' | 'tok' | 'move' | 'push' | 'pull'; id: string; [k: string]: unknown }
const queues = new Map<string, Task[]>()
const waiters = new Map<string, () => void>()

/** 给 tunnel.ts 等别的模块派活 */
export function sendTask(serverId: string, task: Task) { send(serverId, task) }
/** 隧道事件和掉线交给 tunnel.ts（它 import 这里，这里不能反过来 import 它） */
export const hooks: { tunnelEvent?: (serverId: string, e: { id?: string; kind?: string; data?: string }) => void; dropped?: (serverId: string) => void } = {}

function send(serverId: string, task: Task) {
  const q = queues.get(serverId) ?? []
  q.push(task)
  queues.set(serverId, q)
  waiters.get(serverId)?.()
}

export function poll(serverId: string, waitMs = 25_000): Promise<Task[]> {
  const take = () => { const q = queues.get(serverId) ?? []; queues.set(serverId, []); return q }
  const now = take()
  if (now.length) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = () => { waiters.delete(serverId); clearTimeout(t); resolve(take()) }
    waiters.get(serverId)?.() // 同一台只留最新的一个长轮询
    const t = setTimeout(done, waitMs)
    waiters.set(serverId, done)
  })
}

// ---------- 远程进程 ----------
class RemoteProc extends EventEmitter {
  readonly remote = true
  pid = undefined
  stdin: Writable
  stdout = new PassThrough()
  stderr = new PassThrough()
  private ended = false
  serverId: string
  id: string
  constructor(serverId: string, id: string) {
    super()
    this.serverId = serverId
    this.id = id
    this.stdin = new Writable({
      write: (chunk, _enc, cb) => { if (!this.ended) send(serverId, { t: 'stdin', id, data: chunk.toString('utf8') }); cb() },
      final: (cb) => { if (!this.ended) send(serverId, { t: 'stdin', id, end: true }); cb() },
    })
  }
  kill() { if (!this.ended) send(this.serverId, { t: 'kill', id: this.id }); return true }
  out(kind: string, data: string) { (kind === 'err' ? this.stderr : this.stdout).write(data) }
  exit(code: number) {
    if (this.ended) return
    this.ended = true
    procs.delete(this.id)
    this.stdout.end()
    this.stderr.end()
    this.emit('exit', code)
    setImmediate(() => this.emit('close', code))
  }
  fail(msg: string) { this.stderr.write(msg + '\n'); this.exit(-1) }
}
const procs = new Map<string, RemoteProc>()

export interface SpawnOpts { as: 'ai' | 'root'; bin: string; args: string[]; env?: Record<string, string>; cwd: string; mkdirs?: string[]; /** 内存上限 %（Agent 看着，超了停最大的进程） */ memPct?: number; /** CPU 上限 %（一直超先暂停最占 CPU 的进程） */ cpuPct?: number }

/** 在那台服务器上起一个进程；返回的东西当 ChildProcess 用（stdin / stdout / stderr / close / kill） */
export function spawnRemote(serverId: string, o: SpawnOpts): ChildProcess {
  const id = uid('p')
  const p = new RemoteProc(serverId, id)
  procs.set(id, p)
  const sv = get<Server>('servers', serverId)
  if (!agentOnline(sv)) setImmediate(() => p.fail(`「${sv?.name ?? serverId}」的 Agent 不在线：看一下那台机器上的 opero-agent 服务（systemctl status opero-agent）`))
  else send(serverId, { t: 'spawn', id, ...o })
  return p as unknown as ChildProcess
}

/** 发布产物在服务器之间搬：这台把文件传给 Opero（push）/ 从 Opero 拿（pull）；返回 Agent 的输出和退出码 */
/** 这台 Agent 的版本够不够（a ≥ b，按 x.y.z 比）；没报版本的当不够 */
export function agentAtLeast(sv: Server | undefined, min: string): boolean {
  const v = String(sv?.agentVersion ?? '').match(/\d+(\.\d+)*/)?.[0]
  if (!v) return false
  const a = v.split('.').map(Number), b = min.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d) return d > 0 }
  return true
}
/** 传文件（push：那台 → Opero；pull：Opero → 那台）是 Agent 0.9.0 加的：旧 Agent 收到不认识的活不回话，会一直等到超时，所以先看版本，不够直接说怎么办 */
const BLOB_MIN = '0.9.0'
export function blobTask(serverId: string, task: { t: 'push' | 'pull'; key: string; path: string; sha256?: string }, timeoutMs = 30 * 60_000): Promise<{ code: number; out: string }> {
  const sv0 = get<Server>('servers', serverId)
  if (sv0 && !agentAtLeast(sv0, BLOB_MIN)) return Promise.resolve({ code: 1, out: `「${sv0.name}」的 Agent 是 ${sv0.agentVersion || '很旧的版本'}，不会传文件（要 ${BLOB_MIN} 以上）：到「应用 → 服务器和 Agent → ${sv0.name}」点「升级 Agent」（升级时这台上在干活的员工会被打断，挑空闲的时候点）` })
  const id = uid('p')
  const p = new RemoteProc(serverId, id)
  procs.set(id, p)
  return new Promise((resolve) => {
    let out = ''
    p.stdout.on('data', (b: Buffer) => { out += b })
    p.stderr.on('data', (b: Buffer) => { out += b })
    const t = setTimeout(() => { p.fail('传文件超时') }, timeoutMs)
    p.on('close', (code: number | null) => { clearTimeout(t); resolve({ code: code ?? -1, out: out.trim() }) })
    const sv = get<Server>('servers', serverId)
    if (!agentOnline(sv)) setImmediate(() => p.fail(`「${sv?.name ?? serverId}」的 Agent 不在线`))
    else send(serverId, { ...task, id })
  })
}

/** Agent 交回来的输出 */
export function events(serverId: string, list: { id?: string; kind?: string; data?: string; code?: number }[]) {
  for (const e of list ?? []) {
    if (typeof e.kind === 'string' && /^t(up|open|data|close)$/.test(e.kind)) { hooks.tunnelEvent?.(serverId, e); continue }
    const p = procs.get(String(e.id ?? ''))
    if (!p || p.serverId !== serverId) continue
    if (e.kind === 'exit') p.exit(Number(e.code ?? -1))
    else if (typeof e.data === 'string') p.out(String(e.kind), e.data)
  }
}

/** 把一个文件放到那台服务器上（聊天里发给远程员工的图片 / 文件） */
export function writeFile(serverId: string, path: string, data: Buffer) {
  send(serverId, { t: 'write', id: uid('w'), path, data: data.toString('base64') })
}

/** 在那台服务器上以 root 跑一条 shell 命令，拿输出 */
export function exec(serverId: string, command: string, o: { timeoutMs?: number; env?: Record<string, string>; cwd?: string } = {}): Promise<{ code: number; out: string; ms: number }> {
  const t0 = Date.now()
  return new Promise((resolve) => {
    const p = spawnRemote(serverId, { as: 'root', bin: 'sh', args: ['-c', command], env: o.env, cwd: o.cwd ?? '/' })
    let out = ''
    const add = (b: Buffer) => { if (out.length < 200_000) out += b.toString() }
    p.stdout!.on('data', add)
    p.stderr!.on('data', add)
    p.stdin!.end()
    let done = false
    const end = (code: number) => { if (done) return; done = true; clearTimeout(t); resolve({ code, out, ms: Date.now() - t0 }) }
    // 超时先停；Agent 那边连不上时可能永远等不到「已退出」，再等 5 秒还没有就按超时返回，别把调用方（比如员工开工前的准备）挂死
    const t = setTimeout(() => { p.kill(); out += '\n[超时，已停止]'; setTimeout(() => end(-1), 5000).unref() }, o.timeoutMs ?? 60_000)
    p.on('close', (code: number | null) => end(code ?? -1))
  })
}
