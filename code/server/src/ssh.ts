// 连服务器：用保险箱里的账号密码 / 私钥经 SSH 执行命令（Opero 自己连，AI 只拿到输出）。
// 主机指纹第一次连上时记下来，之后对不上就拒绝（防中间人）。「本机」= Opero 自己这台，直接跑。
import { spawn } from 'node:child_process'
import os from 'node:os'
import ssh2 from 'ssh2'
import { all, get, put } from './db.ts'
import { emit } from './bus.ts'
import { getSecret, scrub } from './vault.ts'
import * as agents from './agents.ts'
import type { Credential, Server } from './types.ts'
import { sysInfo } from './sysinfo.ts'

export const LOCAL_ID = 'local'

export interface ExecResult { code: number; out: string; ms: number }

const MAX_OUT = 200_000

export function execOn(sv: Server, command: string, timeoutMs = 60_000): Promise<ExecResult> {
  if (sv.id === LOCAL_ID) return execLocal(command, timeoutMs)
  if (agents.isAgent(sv)) return agents.exec(sv.id, command, { timeoutMs }) // 装了 Agent 的：经 Agent（root）跑，不用 SSH
  return execSsh(sv, command, timeoutMs)
}

function execLocal(command: string, timeoutMs: number): Promise<ExecResult> {
  const t0 = Date.now()
  return new Promise((resolve) => {
    const p = spawn('sh', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const add = (b: Buffer) => { if (out.length < MAX_OUT) out += b.toString() }
    p.stdout.on('data', add)
    p.stderr.on('data', add)
    const timer = setTimeout(() => { p.kill('SIGKILL'); out += '\n[超时，已停止]' }, timeoutMs)
    p.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out, ms: Date.now() - t0 }) })
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: String(e), ms: Date.now() - t0 }) })
  })
}

function execSsh(sv: Server, command: string, timeoutMs: number): Promise<ExecResult> {
  const t0 = Date.now()
  const cred = sv.credential ? get<Credential>('credentials', sv.credential) : undefined
  const secret = sv.credential ? getSecret(sv.credential) : undefined
  return new Promise((resolve) => {
    const c = new ssh2.Client()
    let out = ''
    let done = false
    const finish = (code: number, extra = '') => {
      if (done) return
      done = true
      clearTimeout(timer)
      c.end()
      resolve({ code, out: scrub(out + extra, [secret]), ms: Date.now() - t0 })
    }
    const timer = setTimeout(() => finish(-1, '\n[超时，已停止]'), timeoutMs)
    c.on('ready', () => {
      c.exec(command, (err, stream) => {
        if (err) { finish(-1, String(err.message)); return }
        const add = (b: Buffer) => { if (out.length < MAX_OUT) out += b.toString() }
        stream.on('data', add)
        stream.stderr.on('data', add)
        stream.on('close', (code: number | null) => finish(code ?? 0))
      })
    })
    c.on('error', (e) => finish(-1, `连不上：${e.message}`))
    const isKey = !!secret && /PRIVATE KEY/.test(secret)
    try {
      c.connect({
        host: sv.ip,
        port: sv.port || 22,
        username: sv.user || cred?.user || 'root',
        ...(isKey ? { privateKey: secret } : { password: secret }),
        readyTimeout: 12_000,
        hostHash: 'sha256',
        hostVerifier: (hash: string) => {
          const cur = get<Server>('servers', sv.id)
          if (!cur) return false
          if (!cur.hostKey) { put('servers', { ...cur, hostKey: hash }); return true }
          return cur.hostKey === hash
        },
      } as ssh2.ConnectConfig)
    } catch (e) {
      finish(-1, `连不上：${(e as Error).message}`)
    }
  })
}

// ---------- 健康：CPU / 内存 / 磁盘 / 系统 ----------
const HEALTH = `(. /etc/os-release 2>/dev/null; echo "OS=$PRETTY_NAME"); echo "CPUS=$(nproc 2>/dev/null)";
awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{print "MEM=" t " " a}' /proc/meminfo;
df -P / | awk 'NR==2{print "DISK=" $5}';
head -1 /proc/stat; sleep 1; head -1 /proc/stat`

export function parseHealth(out: string) {
  const get1 = (k: string) => out.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? ''
  const stats = [...out.matchAll(/^cpu\s+(.+)$/gm)].map((m) => m[1].trim().split(/\s+/).map(Number))
  let cpu = 0
  if (stats.length >= 2) {
    const idle = (a: number[]) => a[3] + (a[4] ?? 0)
    const total = (a: number[]) => a.reduce((x, y) => x + y, 0)
    const dt = total(stats[1]) - total(stats[0])
    cpu = dt > 0 ? Math.round(100 * (1 - (idle(stats[1]) - idle(stats[0])) / dt)) : 0
  }
  const [mt, ma] = get1('MEM').split(' ').map(Number)
  const mem = mt ? Math.round(100 * (1 - ma / mt)) : 0
  const disk = Number(get1('DISK').replace('%', '')) || 0
  const gb = mt ? Math.round(mt / 1048576) : 0
  const os = [get1('OS'), get1('CPUS') && `${get1('CPUS')} 核`, gb && `${gb}G`].filter(Boolean).join(' · ')
  return { cpu, mem, disk, os }
}

export async function checkServer(sv: Server): Promise<Server> {
  if (agents.isAgent(sv)) return get<Server>('servers', sv.id) ?? sv // Agent 自己每 30 秒报一次
  const r = await execOn(sv, HEALTH, 20_000)
  const cur = get<Server>('servers', sv.id) ?? sv
  let next: Server
  if (r.code === 0 && /MEM=/.test(r.out)) {
    const h = parseHealth(r.out)
    next = { ...cur, ...h, online: true, checked: Date.now(), error: undefined, ...(sv.id === LOCAL_ID ? { sys: sysInfo() } : {}) }
  } else {
    next = { ...cur, online: false, checked: Date.now(), error: r.out.slice(-300) }
  }
  put('servers', next)
  emit({ t: 'put', coll: 'servers', item: next })
  return next
}

export function ensureLocal() {
  if (get<Server>('servers', LOCAL_ID)) return
  put<Server>('servers', {
    id: LOCAL_ID, name: '本机', ip: '127.0.0.1', env: '开发', os: `${os.type()} ${os.release()}`, agent: 'Opero 所在', online: true,
    cpu: 0, mem: 0, disk: 0, services: [{ name: 'opero', status: '运行中' }], logs: [],
  })
}

let busy = false
export function startHealthLoop() {
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      agents.sweep()
      await Promise.all(all<Server>('servers').filter((s) => !agents.isAgent(s) && s.via !== 'pending' && s.via !== 'rejected' && !s.agentFp).map((s) => checkServer(s).catch(() => {})))
    } finally { busy = false }
  }
  setTimeout(tick, 3000)
  setInterval(tick, 60_000).unref()
  setInterval(() => agents.sweep(), 30_000).unref()
}

// ---------- 只读命令判断（认不出的一律当写） ----------
const RO = /^(cat|head|tail|less|grep|egrep|zgrep|zcat|ls|ll|df|du|free|uptime|uname|whoami|id|hostname|date|ps|top|pgrep|ss|netstat|lsof|ip|ifconfig|ping|dig|nslookup|curl|wget|journalctl|systemctl|docker|nginx|stat|file|wc|sort|uniq|awk|sed|cut|tr|find|which|env|printenv|echo|pwd|nproc|lscpu|lsblk|mount|vmstat|iostat|dmesg|last|w|who|git|tree|md5sum|sha256sum|jq|crontab|kubectl)\b/
const WRITE_SUB: [RegExp, RegExp][] = [
  [/^systemctl\b/, /^systemctl\s+(status|is-active|is-enabled|list-units|list-timers|show|cat)\b/],
  [/^docker\b/, /^docker\s+(ps|logs|images|inspect|stats|top|version|info)\b/],
  [/^nginx\b/, /^nginx\s+-(t|T|v|V)\b/],
  [/^git\b/, /^git\s+(status|log|diff|show|branch|remote|rev-parse|describe|blame|ls-files)\b/],
  [/^crontab\b/, /^crontab\s+-l\b/],
  [/^kubectl\b/, /^kubectl\s+(get|describe|logs|top|version)\b/],
  [/^(curl|wget)\b/, /^(curl|wget)\s(?!.*\s-(X|d|F|T|-data|-upload|-request|O|o)\b)/],
  [/^(sed)\b/, /^sed\s(?!.*\s-i)/],
  [/^find\b/, /^find\s(?!.*\s-(delete|exec|execdir|ok)\b)/],
]
export function isReadOnly(cmd: string): boolean {
  const c = cmd.trim()
  if (!c || /[;&`]|\$\(|>|\|\s*(sh|bash|zsh|sudo|tee|xargs)\b|\bsudo\b/.test(c)) return false
  return c.split('|').every((part) => {
    const p = part.trim()
    if (!RO.test(p)) return false
    for (const [is, ok] of WRITE_SUB) if (is.test(p) && !ok.test(p)) return false
    return true
  })
}

/** 明显危险：不管审核方式，都要你本人确认 */
export const DANGER = /\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\*)|\bmkfs\b|\bdd\s+if=|\bshutdown\b|\breboot\b|\bpoweroff\b|\binit\s+0\b|:\(\)\s*\{|\bchmod\s+-R\s+777\s+\/|\bdrop\s+(database|table)\b|\btruncate\s+table\b|\bgit\s+push\s+.*--force\b|\biptables\s+-F\b/i
