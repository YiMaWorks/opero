// 触发器：到点了 / 有人调 Webhook，就给员工派一句活（日志巡检、每日汇总都靠它）。
// 定时规则（中文）：每 30 分钟 · 每 2 小时 · 每天 09:00 · 工作日 09:30 · 每周一 10:00
import { all, get, put } from './db.ts'
import { emit } from './bus.ts'
import { hhmm, sessionFor, system } from './chat.ts'
import * as runner from './runner.ts'
import type { Trigger } from './types.ts'

type Rule = { every: number } | { at: [number, number]; days: number[] }
const WEEK: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }

export function parseRule(rule: string): Rule | null {
  const r = rule.replace(/\s+/g, '')
  let m = r.match(/^每(\d+)分钟$/) ?? r.match(/^every(\d+)m(in(utes?)?)?$/i)
  if (m) return { every: Math.max(5, Number(m[1])) * 60_000 }
  m = r.match(/^每(\d+)(个)?小时$/) ?? r.match(/^every(\d+)h(ours?)?$/i)
  if (m) return { every: Number(m[1]) * 3600_000 }
  if (/^每(个)?小时$/.test(r)) return { every: 3600_000 }
  m = r.match(/^每天(\d{1,2})[:：](\d{2})$/)
  if (m) return { at: [Number(m[1]), Number(m[2])], days: [0, 1, 2, 3, 4, 5, 6] }
  m = r.match(/^工作日(\d{1,2})[:：](\d{2})$/)
  if (m) return { at: [Number(m[1]), Number(m[2])], days: [1, 2, 3, 4, 5] }
  m = r.match(/^每周([一二三四五六日天])(\d{1,2})[:：](\d{2})$/)
  if (m) return { at: [Number(m[2]), Number(m[3])], days: [WEEK[m[1]]] }
  return null
}

function due(t: Trigger, now: number): boolean {
  const r = parseRule(t.rule)
  if (!r) return false
  const last = t.lastTs ?? 0
  if ('every' in r) return now - last >= r.every
  const d = new Date(now)
  if (!r.days.includes(d.getDay())) return false
  const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), r.at[0], r.at[1]).getTime()
  return now >= at && now - at < 30 * 60_000 && last < at // 到点后 30 分钟内补跑一次（Opero 刚好重启也不漏）
}

export function fire(t: Trigger, extra?: string) {
  const s = sessionFor(t.employee)
  system(s.id, `⏰ 触发器「${t.name}」派活${extra ? '（Webhook）' : ''}`)
  const prompt = (t.prompt?.trim() || t.name) + (extra ? `\n\n收到的内容：\n${extra.slice(0, 8000)}` : '')
  runner.send(t.employee, `（这是触发器「${t.name}」派的活，不是主人刚说的；没有要主人知道的就简短说一句「正常」）\n\n${prompt}`)
  const next = { ...(get<Trigger>('triggers', t.id) ?? t), last: `今天 ${hhmm()}`, lastTs: Date.now() }
  put('triggers', next)
  emit({ t: 'put', coll: 'triggers', item: next })
}

export function startTriggerLoop() {
  // 第一次启动：间隔类的从现在开始算，别一开机全跑一遍
  for (const t of all<Trigger>('triggers')) if (!t.lastTs) put('triggers', { ...t, lastTs: Date.now() })
  setInterval(() => {
    const now = Date.now()
    for (const t of all<Trigger>('triggers')) if (t.enabled && t.kind === '定时' && due(t, now)) fire(t)
  }, 30_000).unref()
}
