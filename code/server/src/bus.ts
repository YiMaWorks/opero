// 实时推送：网页开着一条 SSE（/api/events），后台有变化就推一条事件，网页按事件改自己的数据。
// 事件：put（某个集合里新增 / 改了一项）· del · msg（消息新增或改了）· msgDel · audit · settings · me · usage · toast
// 手机外壳收不到 SSE（WebView 在后台会被停）：要你决定的事另外进推送队列，外壳长轮询 /api/app/push 取。
import type { ServerResponse } from 'node:http'
import { db } from './db.ts'

const clients = new Set<ServerResponse>()

export function addClient(res: ServerResponse) {
  clients.add(res)
  res.on('close', () => clients.delete(res))
}

export function emit(ev: Record<string, unknown>) {
  const line = `data: ${JSON.stringify(ev)}\n\n`
  for (const c of clients) {
    try { c.write(line) } catch { clients.delete(c) }
  }
}

// 心跳：nginx 等代理 60 秒没数据会断
setInterval(() => { for (const c of clients) { try { c.write(': ping\n\n') } catch { clients.delete(c) } } }, 25_000).unref()

// ---------- 手机推送队列 ----------
export interface PushItem { id: number; kind: 'decide' | 'info' | 'alarm'; title: string; body?: string; route?: string; /** 出错类（发布失败、执行器出错）：外部提醒按它分 */ error?: boolean }
const waiters = new Set<() => void>()
/** 推送的同时转给外部提醒渠道（notify.ts 挂上来） */
export const pushHooks: ((item: Omit<PushItem, 'id'>) => void)[] = []

export function push(item: Omit<PushItem, 'id'>) {
  for (const h of pushHooks) { try { h(item) } catch { /* 外部渠道出错不影响推送 */ } }
  db.prepare('INSERT INTO push (ts, data) VALUES (?, ?)').run(Date.now(), JSON.stringify(item))
  db.prepare('DELETE FROM push WHERE ts < ?').run(Date.now() - 7 * 86400_000)
  for (const w of [...waiters]) w()
}

export function pushAfter(after: number): { last: number; items: PushItem[] } {
  const lastRow = db.prepare('SELECT MAX(id) AS m FROM push').get() as { m: number | null }
  const last = lastRow.m ?? 0
  if (after < 0) return { last, items: [] }
  const rows = db.prepare('SELECT id, data FROM push WHERE id > ? ORDER BY id LIMIT 20').all(after) as { id: number; data: string }[]
  return { last, items: rows.map((r) => ({ ...JSON.parse(r.data), id: r.id })) }
}

/** 长轮询：没有新的就等到有，或者等满 waitSec 秒 */
export function waitPush(after: number, waitSec: number): Promise<{ last: number; items: PushItem[] }> {
  const now = pushAfter(after)
  if (now.items.length || waitSec <= 0 || after < 0) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = () => { waiters.delete(done); clearTimeout(t); resolve(pushAfter(after)) }
    const t = setTimeout(done, Math.min(waitSec, 30) * 1000)
    waiters.add(done)
  })
}
