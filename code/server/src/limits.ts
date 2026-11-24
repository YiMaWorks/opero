// 员工进程的内存上限（只用 Node 自带的，agent.ts 也 import 它）：每 10 秒把执行器进程和它所有子进程的内存加起来，
// 超过这台总内存的 pct% 先提醒；连续超 2 分钟，或 10 分钟内超 5 次，就停掉其中占内存最大的那个进程（多半是它起的编译 / 服务），再提醒。
import fs from 'node:fs'
import os from 'node:os'

interface Proc { pid: number; ppid: number; rss: number; cmd: string }

function snapshot(): Proc[] {
  const out: Proc[] = []
  let ids: string[] = []
  try { ids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)) } catch { return out }
  for (const id of ids) {
    try {
      const stat = fs.readFileSync(`/proc/${id}/stat`, 'utf8')
      const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      const ppid = Number(rest[1])
      const rss = Number(rest[21]) * 4096
      let cmd = ''
      try { cmd = fs.readFileSync(`/proc/${id}/cmdline`, 'utf8').replace(/\0/g, ' ').trim().slice(0, 120) } catch { /* 读不到 */ }
      out.push({ pid: Number(id), ppid, rss, cmd })
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

export interface WatchEvents {
  /** 超了：提醒一下（每次超都会调，调用方自己决定多久提醒一次） */
  warn?: (usedPct: number) => void
  /** 停掉了一个进程 */
  killed?: (p: { pid: number; cmd: string; mb: number }, usedPct: number) => void
  /** 怎么停（本机的员工进程是 AI 用户的，Opero 要经 sudo 才停得了） */
  kill?: (pid: number) => void
}

/** 开始看着一个进程树；返回停止函数 */
export function watchMemory(rootPid: number | undefined, pct: number, ev: WatchEvents): () => void {
  if (!rootPid || !pct || process.platform !== 'linux') return () => {}
  const total = os.totalmem()
  const hits: number[] = []
  let over = 0 // 从什么时候开始一直超
  const t = setInterval(() => {
    const procs = tree(rootPid, snapshot())
    if (!procs.length) return
    const used = procs.reduce((n, p) => n + p.rss, 0)
    const usedPct = Math.round((100 * used) / total)
    const now = Date.now()
    if (usedPct < pct) { over = 0; return }
    if (!over) over = now
    hits.push(now)
    while (hits.length && now - hits[0] > 10 * 60_000) hits.shift()
    ev.warn?.(usedPct)
    if (now - over >= 120_000 || hits.length >= 5) {
      const big = procs.filter((p) => p.pid !== rootPid).sort((a, b) => b.rss - a.rss)[0] ?? procs[0]
      try { if (ev.kill) ev.kill(big.pid); else process.kill(big.pid, 'SIGKILL') } catch { /* 已经没了 */ }
      ev.killed?.({ pid: big.pid, cmd: big.cmd, mb: Math.round(big.rss / 1048576) }, usedPct)
      over = 0
      hits.length = 0
    }
  }, 10_000)
  t.unref()
  return () => clearInterval(t)
}
