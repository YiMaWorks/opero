// 员工进程的资源保护（只用 Node 自带的，agent.ts 也 import 它）。照 KidLock：只算员工自己的进程（执行器和它所有子进程），整机被业务服务拉高不算；
// 超了先提醒，连续超 2 分钟、或 10 分钟内超了 5 回，才动手——不一碰就杀，免得误判。
//   内存：超过这台总内存的 memPct% → 停掉其中占内存最大的那个进程（多半是它起的编译 / 服务）。
//   CPU：超过这台总 CPU 的 cpuPct% → 先「暂停」最占 CPU 的那个进程（SIGSTOP，不是杀），整机降到 60% 以下、并且至少停了 1 分钟就继续（SIGCONT）；
//        停了 10 分钟还没法继续，就停掉它，告诉员工交给流水线编。
import fs from 'node:fs'
import os from 'node:os'

interface Proc { pid: number; ppid: number; rss: number; cpu: number; cmd: string }

function snapshot(): Proc[] {
  const out: Proc[] = []
  let ids: string[] = []
  try { ids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)) } catch { return out }
  for (const id of ids) {
    try {
      const stat = fs.readFileSync(`/proc/${id}/stat`, 'utf8')
      const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      const ppid = Number(rest[1])
      const cpu = Number(rest[11]) + Number(rest[12]) // utime + stime（时钟滴答）
      const rss = Number(rest[21]) * 4096
      let cmd = ''
      try { cmd = fs.readFileSync(`/proc/${id}/cmdline`, 'utf8').replace(/\0/g, ' ').trim().slice(0, 120) } catch { /* 读不到 */ }
      out.push({ pid: Number(id), ppid, rss, cpu, cmd })
    } catch { /* 进程刚好没了 */ }
  }
  return out
}

/** root 进程和它的所有子孙 */
function tree(root: number, all: Proc[]): Proc[] {
  const kids = new Map<number, Proc[]>()
  for (const p of all) { const l = kids.get(p.ppid) ?? []; l.push(p); kids.set(p.ppid, l) }
  const res: Proc[] = []
  const stack = [root]
  while (stack.length) {
    const pid = stack.pop()!
    const me = all.find((p) => p.pid === pid)
    if (me) res.push(me)
    for (const k of kids.get(pid) ?? []) stack.push(k.pid)
  }
  return res
}

/** 整机 CPU 用了多少（两次 /proc/stat 之间） */
let lastStat: { busy: number; total: number } | null = null
function machineCpu(): number {
  try {
    const n = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number)
    const idle = (n[3] ?? 0) + (n[4] ?? 0)
    const total = n.reduce((a, b) => a + b, 0)
    const prev = lastStat
    lastStat = { busy: total - idle, total }
    if (!prev || total <= prev.total) return 0
    return Math.round((100 * (total - idle - prev.busy)) / (total - prev.total))
  } catch { return 0 }
}

/** 执行器本身（claude / codex / node 跑的 MCP）不暂停、不先杀：动它们这一轮就断了 */
const isExecutor = (cmd: string) => /(^|\/)(claude|codex)(\s|$)|claude-code|@openai\/codex|opero-mcp|mcp\.ts/.test(cmd)

export interface WatchEvents {
  /** 内存超了：提醒（每次超都会调，调用方自己决定多久提醒一次） */
  warn?: (usedPct: number) => void
  /** 内存一直超，停掉了一个进程 */
  killed?: (p: { pid: number; cmd: string; mb: number }, usedPct: number) => void
  /** CPU 超了：提醒 */
  warnCpu?: (usedPct: number) => void
  /** CPU 一直超，暂停了一个进程 / 继续了 / 停太久停掉了 */
  paused?: (p: { pid: number; cmd: string }, usedPct: number) => void
  resumed?: (p: { pid: number; cmd: string }) => void
  stoppedCpu?: (p: { pid: number; cmd: string }) => void
  /** 怎么发信号（本机的员工进程是 AI 用户的，Opero 要经 sudo 才行）；不给就直接 process.kill */
  kill?: (pid: number) => void
  signal?: (pid: number, sig: 'SIGSTOP' | 'SIGCONT' | 'SIGKILL') => void
}

const SUSTAIN = 120_000
const WINDOW = 10 * 60_000
const HITS = 5

/** 开始看着一个进程树：memPct / cpuPct（占整机的百分比，0 = 不管）；返回停止函数 */
export function watchResources(rootPid: number | undefined, lim: { memPct?: number; cpuPct?: number }, ev: WatchEvents): () => void {
  const memPct = lim.memPct ?? 0
  const cpuPct = lim.cpuPct ?? 0
  if (!rootPid || (!memPct && !cpuPct) || process.platform !== 'linux') return () => {}
  const total = os.totalmem()
  const cores = os.cpus().length || 1
  const hz = 100
  const send = (pid: number, sig: 'SIGSTOP' | 'SIGCONT' | 'SIGKILL') => {
    try { if (ev.signal) ev.signal(pid, sig); else if (sig === 'SIGKILL' && ev.kill) ev.kill(pid); else process.kill(pid, sig) } catch { /* 已经没了 */ }
  }
  const mem = { over: 0, hits: [] as number[] }
  const cpu = { over: 0, wasOver: false, episodes: [] as number[], prev: new Map<number, number>(), prevAt: 0 }
  let paused: { pid: number; cmd: string; at: number } | null = null
  const tick = () => {
    const procs = tree(rootPid, snapshot())
    const now = Date.now()
    const box = machineCpu()
    // 暂停着的：整机降下来、并且停够 1 分钟就继续；停了 10 分钟还不行就停掉
    if (paused) {
      if (!fs.existsSync(`/proc/${paused.pid}`)) paused = null
      else if (now - paused.at >= 60_000 && box < 60) { send(paused.pid, 'SIGCONT'); ev.resumed?.(paused); paused = null; cpu.over = 0 }
      else if (now - paused.at >= WINDOW) { send(paused.pid, 'SIGCONT'); send(paused.pid, 'SIGKILL'); ev.stoppedCpu?.(paused); paused = null; cpu.over = 0 }
    }
    if (!procs.length) return
    // ---- 内存 ----
    if (memPct) {
      const usedPct = Math.round((100 * procs.reduce((n, p) => n + p.rss, 0)) / total)
      if (usedPct < memPct) mem.over = 0
      else {
        if (!mem.over) mem.over = now
        mem.hits.push(now)
        while (mem.hits.length && now - mem.hits[0] > WINDOW) mem.hits.shift()
        ev.warn?.(usedPct)
        if (now - mem.over >= SUSTAIN || mem.hits.length >= HITS) {
          const big = procs.filter((p) => p.pid !== rootPid && !isExecutor(p.cmd)).sort((a, b) => b.rss - a.rss)[0] ?? procs.filter((p) => p.pid !== rootPid).sort((a, b) => b.rss - a.rss)[0] ?? procs[0]
          send(big.pid, 'SIGKILL')
          ev.killed?.({ pid: big.pid, cmd: big.cmd, mb: Math.round(big.rss / 1048576) }, usedPct)
          mem.over = 0
          mem.hits.length = 0
        }
      }
    }
    // ---- CPU（员工自己的进程这几秒用掉的 CPU 时间 / 整机） ----
    if (cpuPct) {
      const dt = cpu.prevAt ? (now - cpu.prevAt) / 1000 : 0
      const per = procs.map((p) => ({ p, d: Math.max(0, p.cpu - (cpu.prev.get(p.pid) ?? p.cpu)) }))
      cpu.prev = new Map(procs.map((p) => [p.pid, p.cpu]))
      cpu.prevAt = now
      if (!dt) return
      const usedPct = Math.round((100 * per.reduce((n, x) => n + x.d, 0)) / hz / dt / cores)
      if (usedPct < cpuPct) { cpu.over = 0; cpu.wasOver = false; return }
      if (!cpu.over) cpu.over = now
      if (!cpu.wasOver) { cpu.episodes.push(now); cpu.wasOver = true }
      while (cpu.episodes.length && now - cpu.episodes[0] > WINDOW) cpu.episodes.shift()
      ev.warnCpu?.(usedPct)
      if (!paused && (now - cpu.over >= SUSTAIN || cpu.episodes.length >= HITS)) {
        const hot = per.filter((x) => x.p.pid !== rootPid && !isExecutor(x.p.cmd)).sort((a, b) => b.d - a.d)[0]
        if (hot) {
          send(hot.p.pid, 'SIGSTOP')
          paused = { pid: hot.p.pid, cmd: hot.p.cmd, at: now }
          ev.paused?.(paused, usedPct)
        }
        cpu.over = 0
        cpu.episodes.length = 0
      }
    }
  }
  const t = setInterval(tick, 5_000)
  t.unref()
  return () => { clearInterval(t); if (paused) send(paused.pid, 'SIGCONT') }
}

/** 以前只管内存的入口（agent.ts / runner.ts 旧调用） */
export function watchMemory(rootPid: number | undefined, pct: number, ev: WatchEvents): () => void {
  return watchResources(rootPid, { memPct: pct }, ev)
}
