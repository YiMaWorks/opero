// 连服务器：用保险箱里的账号密码 / 私钥经 SSH 执行命令（Opero 自己连，AI 只拿到输出）。
// 主机指纹第一次连上时记下来，之后对不上就拒绝（防中间人）。「本机」= Opero 自己这台，直接跑。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
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
  return execOnEnv(sv, command, {}, timeoutMs)
}

/** 带环境变量跑（密码这类放环境变量，不出现在命令行里）；SSH 的只能拼在命令前面，输出照样抹掉 */
export function execOnEnv(sv: Server, command: string, env: Record<string, string>, timeoutMs = 60_000, cwd?: string): Promise<ExecResult> {
  const secrets = Object.values(env).filter((v) => v.length >= 6)
  const clean = (r: ExecResult) => (secrets.length ? { ...r, out: scrub(r.out, secrets) } : r)
  if (sv.id === LOCAL_ID && !localRoot()) return execLocal(command, timeoutMs, env, cwd).then(clean)
  if (agents.isAgent(sv)) return agents.exec(sv.id, command, { timeoutMs, env, cwd }).then(clean) // 装了 Agent 的：经 Agent（root）跑，不用 SSH
  const exp = Object.entries(env).map(([k, v]) => `export ${k}='${v.replace(/'/g, `'\\''`)}'; `).join('')
  return execSsh(sv, `${exp}${cwd ? `cd '${cwd}' && ` : ''}${command}`, timeoutMs).then(clean)
}

function execLocal(command: string, timeoutMs: number, env: Record<string, string> = {}, cwd?: string): Promise<ExecResult> {
  const t0 = Date.now()
  return new Promise((resolve) => {
    const p = spawn('sh', ['-c', command], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } as Record<string, string>, cwd })
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

/** 这台机器的编号（和 Agent 读的同一个文件）：在这台上装 Agent 时，按它认出是「本机」，挂到本机上而不是多出一台 */
function localMachineId() {
  for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) { try { const v = fs.readFileSync(f, 'utf8').trim(); if (v) return v } catch { /* 下一个 */ } }
  return ''
}
export function ensureLocal() {
  const machineId = localMachineId()
  const cur = get<Server>('servers', LOCAL_ID)
  if (cur) { if (machineId && !cur.machineId) put('servers', { ...cur, machineId }); return }
  put<Server>('servers', {
    id: LOCAL_ID, name: '本机', ip: '127.0.0.1', env: '开发', os: `${os.type()} ${os.release()}`, agent: 'Opero 所在', online: true,
    cpu: 0, mem: 0, disk: 0, services: [{ name: 'opero', status: '运行中' }], logs: [], ...(machineId ? { machineId } : {}),
  })
}
/** 本机装了 Agent 并且在线：要 root 的活（部署、开目录权限、跑命令）经它跑；没装或掉线就用 Opero 自己的用户 */
export const localRoot = () => agents.agentOnline(get<Server>('servers', LOCAL_ID))

let busy = false
export function startHealthLoop() {
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      agents.sweep()
      // 本机一直自己查（装了 Agent 也查：Agent 掉线时本机照样在线）
      await Promise.all(all<Server>('servers').filter((s) => s.id === LOCAL_ID || (!agents.isAgent(s) && s.via !== 'pending' && s.via !== 'rejected' && !s.agentFp)).map((s) => checkServer(s).catch(() => {})))
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
/** 危险命令的规则，每条带一句人话：卡片上告诉主人「为什么要你确认」 */
const DANGER_RULES: [RegExp, string][] = [
  [/\bmkfs\b/i, '会格式化磁盘，上面的数据全没'],
  [/\bdd\s+if=/i, '会直接往磁盘 / 设备上写数据，写错了数据就没了'],
  [/\bshutdown\b|\bpoweroff\b|\binit\s+0\b/i, '会关掉这台服务器'],
  [/\breboot\b/i, '会重启这台服务器，上面的服务会断一会'],
  [/:\(\)\s*\{/, '会把服务器跑死（fork 炸弹）'],
  [/\bchmod\s+-R\s+777\s+\//i, '会把整个系统的权限改成谁都能改'],
  [/\bdrop\s+(database|table)\b/i, '会删掉数据库 / 表'],
  [/\btruncate\s+table\b/i, '会清空一张表'],
  [/\bgit\s+push\s+.*--force\b/i, '会强推，覆盖远端的提交（别人的代码可能被冲掉）'],
  [/\biptables\s+-F\b/i, '会清空防火墙规则'],
]
/** 删的东西危险不危险：根、家目录、系统目录、只有一两层的路径（/home、/srv/app）、带变量 / 通配根的才算；/tmp 下面、更深的子目录、相对路径不算。返回说明（不危险返回空） */
function dangerousRm(raw: string): string {
  // 先把命令里的简单赋值（D=/tmp/x、export D="/srv/a/b"）代进去：rm -rf $D 删的其实是 /tmp/x
  const vars = new Map<string, string>()
  for (const m of raw.matchAll(/(?:^|[;&|\s])(?:export\s+)?([A-Za-z_]\w*)=(["']?)([^\s;&|"'$`]+)\2(?=[\s;&|]|$)/g)) vars.set(m[1], m[3])
  const cmd = raw.replace(/"?\$\{?([A-Za-z_]\w*)\}?"?/g, (all, n) => vars.get(n) ?? all)
  for (const m of cmd.matchAll(/\brm\s+((?:-[a-zA-Z]+\s+)*)([^;&|]*)/g)) {
    if (!/r/i.test(m[1])) continue
    for (const t of m[2].trim().split(/\s+/).filter(Boolean)) {
      if (/^(\/|~|~\/|\*|\/\*)$/.test(t)) return `会删掉 ${t} 下面的全部东西`
      if (/^(\.|\.\.|\.\/\*?)$/.test(t)) return `会删掉当前目录（${t}）下面的全部东西`
      if (/\$|`/.test(t)) return `要删的目录是个变量（${t}），从命令里看不出到底删哪里`
      if (/^\/(tmp|var\/tmp)\/./.test(t)) continue
      if (t.startsWith('/') && t.replace(/\/+$/, '').split('/').filter(Boolean).length <= 2) return `会整个删掉 ${t}（层级很浅的大目录）`
      if (/^\/(etc|usr|bin|sbin|lib|lib64|boot|proc|sys|dev|root)(\/|$)/.test(t)) return `会删系统目录里的 ${t}`
    }
  }
  return ''
}
/** 灾难性命令（照 KidLock）：员工自己的终端里遇到直接拒绝、把原因告诉它，不弹卡片问主人（主人也不在这里批）。
 *  别的命令都直接跑：员工是没有 root 的 AI 用户，系统目录它本来就改不了；内存 / CPU 有看守兜底 */
const CATASTROPHIC_RULES: [RegExp, string][] = [
  [/\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rR][a-zA-Z]*\s+(-[a-zA-Z]+\s+)*("|')?(\/|\/\*|~|~\/|\$HOME|\$\{HOME\}|\*)("|')?(\s|$|;|&|\|)/, '会删掉根目录 / 家目录下的全部东西'],
  [/\bmkfs\b|\bfdisk\b|\bparted\b/i, '会格式化 / 重新分区磁盘'],
  [/\bdd\s+[^|;&]*\bof=\/dev\/|>\s*\/dev\/(sd|nvme|vd|xvd)/i, '会直接往磁盘设备上写数据'],
  [/:\(\)\s*\{/, '会把服务器跑死（fork 炸弹）'],
  [/\b(shutdown|poweroff|halt)\b|\breboot\b|\binit\s+0\b/i, '会关掉 / 重启这台服务器'],
  [/\bchmod\s+-R\s+777\s+\/(\s|$)/i, '会把整个系统改成谁都能改'],
  [/\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z)?sh\b/i, '会从网上下载脚本直接执行'],
]
export const CATASTROPHIC = { why: (cmd: string): string => CATASTROPHIC_RULES.find(([re]) => re.test(cmd))?.[1] ?? '' }

/** 危险命令（在别的服务器上以 root 跑的 server_exec 用，要主人确认）：删根 / 系统目录、格式化、关机、删库、强推……；why 给出人话原因（不危险返回空） */
export const DANGER = {
  why: (cmd: string): string => DANGER_RULES.find(([re]) => re.test(cmd))?.[1] ?? dangerousRm(cmd),
  test: (cmd: string) => !!DANGER.why(cmd),
}
