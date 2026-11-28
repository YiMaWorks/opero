// 跑：cd code/server && npm test。订阅账号用量：Claude 的 rate_limit_event 怎么记、还剩多少、挑账号看剩余、Codex app-server 怎么问
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.OPERO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-quota-'))
const db = await import('./db.ts')
const quota = await import('./quota.ts')
const runner = await import('./runner.ts')
const { setSecret } = await import('./vault.ts')
after(() => fs.rmSync(process.env.OPERO_DATA!, { recursive: true, force: true }))

const inH = (h: number) => Math.round((Date.now() + h * 3600_000) / 1000) // 秒

test('Claude 的 rate_limit_event：utilization 是 0–1，resetsAt 是秒', () => {
  quota.noteClaude('c1', { status: 'allowed_warning', unifiedWindows: { five_hour: { utilization: 0.62, resetsAt: inH(3) }, seven_day: { utilization: 0.3, resetsAt: inH(72) } } })
  const q = quota.view('c1')!
  assert.equal(q.five?.used, 62)
  assert.equal(q.week?.used, 30)
  assert.ok(q.five!.resetsAt! > Date.now() + 2.9 * 3600_000)
  assert.equal(quota.remaining('c1'), 38, '两个窗口里少的那个')
  // 只报一个窗口（老版本）：另一个留着
  quota.noteClaude('c1', { status: 'allowed', rateLimitType: 'seven_day', utilization: 0.5, resetsAt: inH(70) })
  assert.equal(quota.view('c1')!.week?.used, 50)
  assert.equal(quota.view('c1')!.five?.used, 62)
})

test('过了重置时间的窗口当满的；到上限是 0', () => {
  quota.noteClaude('c2', { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.99, resetsAt: inH(-1) } } })
  assert.equal(quota.remaining('c2'), 100)
  quota.noteClaude('c3', { status: 'rejected', unifiedWindows: { five_hour: { utilization: 1, resetsAt: inH(2) } } })
  assert.equal(quota.remaining('c3'), 0)
  assert.equal(quota.remaining('nope'), undefined)
})

test('挑账号：员工指定的快用完了先用别的；其它剩得多的优先', () => {
  for (const id of ['a1', 'a2', 'a3']) { db.put('credentials', { id, name: id, group: 'AI', kind: 'Token' } as any); setSecret(id, 'sk-ant-oat01-' + 'x'.repeat(60)) }
  db.kvSet('ai', { claudeAccounts: ['a1', 'a2', 'a3'], claudeCred: 'a1' })
  quota.noteClaude('a1', { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.9, resetsAt: inH(2) } } })
  quota.noteClaude('a2', { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.2, resetsAt: inH(2) } } })
  quota.noteClaude('a3', { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.97, resetsAt: inH(2) } } })
  assert.equal(runner.pickAccount('claude'), 'a2', '默认的 a1 只剩 10%，a2 剩 80%')
  assert.equal(runner.pickAccount('claude', { claudeAccount: 'a1' } as any), 'a1', '员工指定的还剩 10%，照用')
  assert.equal(runner.pickAccount('claude', { claudeAccount: 'a3' } as any), 'a2', '员工指定的只剩 3%，先用别的')
})

test('Codex：一行一个 JSON 问 app-server，primary / secondary 按窗口长度认', async () => {
  // 假的 codex：读到 id 2 的请求就回用量
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-fakecodex-'))
  after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const fake = path.join(dir, 'codex')
  fs.writeFileSync(fake, `#!/usr/bin/env node
let buf = ''
process.stdin.on('data', (b) => {
  buf += b
  for (const line of buf.split('\\n').slice(0, -1)) {
    const j = JSON.parse(line)
    if (j.id === 1) console.log(JSON.stringify({ id: 1, result: { userAgent: 'x' } }))
    if (j.id === 2) console.log(JSON.stringify({ id: 2, result: { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: ${inH(100)} }, secondary: { usedPercent: 40, windowDurationMins: 300, resetsAt: ${inH(4)} }, planType: 'plus' } } }))
  }
  buf = buf.split('\\n').pop()
})
`, { mode: 0o755 })
  const q = await quota.pollCodex('x1', {}, [fake, []])
  assert.equal(q.five?.used, 40, '300 分钟那个是 5 小时')
  assert.equal(q.week?.used, 12, '10080 分钟那个是一周')
  assert.equal(q.plan, 'plus')
  assert.equal(quota.remaining('x1'), 60)
  // 没装 / 回不了话：记原因，不报错
  const bad = await quota.pollCodex('x2', {}, ['/bin/true', []])
  assert.ok(bad.err)
})

test('Claude 官方用量接口：两个窗口一起记（utilization 是 0–100，resets_at 是时间字符串），不通说清楚原因', async () => {
  const real = globalThis.fetch
  try {
    let auth = ''
    globalThis.fetch = (async (u: string, init?: RequestInit) => {
      assert.equal(String(u), 'https://api.anthropic.com/api/oauth/usage')
      auth = String((init?.headers as Record<string, string>).Authorization)
      return new Response(JSON.stringify({ five_hour: { utilization: 6, resets_at: new Date(Date.now() + 2 * 3600_000).toISOString() }, seven_day: { utilization: 36, resets_at: new Date(Date.now() + 5 * 86400_000).toISOString() }, seven_day_opus: null }))
    }) as typeof fetch
    const r = await quota.readClaude('c9', 'sk-ant-oat01-x')
    assert.ok(r.ok)
    assert.equal(auth, 'Bearer sk-ant-oat01-x')
    const q = quota.view('c9')!
    assert.equal(q.five?.used, 6)
    assert.equal(q.week?.used, 36)
    assert.equal(q.src, 'poll')
    assert.ok(q.five!.resetsAt! > Date.now() + 1.9 * 3600_000)
    globalThis.fetch = (async () => new Response('{"error":{"message":"OAuth token does not meet scope requirement"}}', { status: 403 })) as typeof fetch
    const bad = await quota.readClaude('c9', 't')
    assert.ok(!bad.ok && bad.status === 403 && /scope/.test(bad.why))
    assert.equal(quota.view('c9')!.week?.used, 36, '没问到不动原来的数')
    globalThis.fetch = (async () => { throw Object.assign(new TypeError('fetch failed'), { cause: new Error('connect ETIMEDOUT') }) }) as typeof fetch
    const down = await quota.readClaude('c9', 't')
    assert.ok(!down.ok && down.status === 0 && /网络出口/.test(down.why), '连不上指到网络出口')
  } finally { globalThis.fetch = real }
})

test('官方用量接口限流（429）：按 Retry-After 等，等的时候不再去问，连着限流翻倍；问到了就清掉', async () => {
  const real = globalThis.fetch
  let calls = 0
  try {
    globalThis.fetch = (async () => { calls++; return new Response('Rate limited. Please try again later.', { status: 429, headers: { 'retry-after': '120' } }) }) as typeof fetch
    const a = await quota.readClaude('c10', 't')
    assert.ok(!a.ok && a.status === 429 && /查得太勤/.test(a.why))
    const q1 = quota.quotaOf('c10')!
    assert.ok(q1.retryAt! >= Date.now() + 9 * 60_000, '没说多久就至少 10 分钟（120 秒比 10 分钟短）')
    const b = await quota.readClaude('c10', 't')
    assert.ok(!b.ok && b.status === 429)
    assert.equal(calls, 1, '等的时候不去问')
    // 到点再问又被限流：翻倍
    db.kvSet('quota', { ...db.kvGet<Record<string, unknown>>('quota', {}), c10: { ...q1, retryAt: Date.now() - 1 } })
    await quota.readClaude('c10', 't')
    assert.equal(quota.quotaOf('c10')!.backoff, 2 * q1.backoff!)
    // 到点问到了：清掉
    db.kvSet('quota', { ...db.kvGet<Record<string, unknown>>('quota', {}), c10: { ...quota.quotaOf('c10')!, retryAt: Date.now() - 1 } })
    globalThis.fetch = (async () => new Response(JSON.stringify({ five_hour: { utilization: 10, resets_at: new Date(Date.now() + 3600_000).toISOString() }, seven_day: null }))) as typeof fetch
    assert.ok((await quota.readClaude('c10', 't')).ok)
    const q = quota.quotaOf('c10')!
    assert.equal(q.retryAt, undefined)
    assert.equal(q.err, undefined)
    assert.equal(q.five?.used, 10)
  } finally { globalThis.fetch = real }
})
