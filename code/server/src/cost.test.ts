// 跑：cd code/server && npm test。每轮花费：Claude Code 的 total_cost_usd 是累计值，不能加起来；续上会话会把之前的带回来，要减掉
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.OPERO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-cost-'))
const db = await import('./db.ts')
const { costOf } = await import('./runner.ts')
after(() => fs.rmSync(process.env.OPERO_DATA!, { recursive: true, force: true }))

const mu = (tok: number) => ({ 'claude-opus': { inputTokens: tok, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } })
const run = (resumedFrom?: string) => ({ cost: 0, costBase: undefined as number | undefined, resumedFrom })

test('一轮里插了话（几次结果）：取最新累计，不加起来', () => {
  const emp: any = { id: 'e1' }
  db.put('employees', emp)
  const l = run()
  assert.equal(costOf(emp, l, { total_cost_usd: 1.5, modelUsage: mu(50_000), session_id: 's1' }, 50_000), 1.5)
  assert.equal(costOf(emp, l, { total_cost_usd: 2.25, modelUsage: mu(80_000), session_id: 's1' }, 30_000), 2.25)
  assert.equal(costOf(emp, l, { total_cost_usd: 3, modelUsage: mu(100_000), session_id: 's1' }, 20_000), 3, '这一轮一共 3 块，不是 6.75')
  assert.deepEqual(emp.costMark, { sid: 's1', total: 3, tok: 100_000 })
})

test('续上同一个会话、执行器把之前的 3 块带回来：这一轮只算新花的', () => {
  const emp: any = { id: 'e1', costMark: { sid: 's1', total: 3, tok: 100_000 } }
  const l = run('s1')
  assert.equal(costOf(emp, l, { total_cost_usd: 3.4, modelUsage: mu(130_000), session_id: 's1' }, 30_000), 3.4 - 3)
  assert.ok(Math.abs(costOf(emp, l, { total_cost_usd: 4, modelUsage: mu(150_000), session_id: 's1' }, 20_000)! - 1) < 1e-9)
})

test('老版本 / Qwen 这类不带回来：照实算', () => {
  const emp: any = { id: 'e1', costMark: { sid: 's1', total: 3, tok: 100_000 } }
  const l = run('s1')
  // 累计比上次记的少 → 没带
  assert.equal(costOf(emp, l, { total_cost_usd: 0.8, modelUsage: mu(30_000), session_id: 's1' }, 30_000), 0.8)
  // 这一轮第一次就花得比上次多，但累计 token 和这一次的差不多 → 也是没带
  const emp2: any = { id: 'e1', costMark: { sid: 's1', total: 0.5, tok: 20_000 } }
  const l2 = run('s1')
  assert.equal(costOf(emp2, l2, { total_cost_usd: 0.9, modelUsage: mu(30_000), session_id: 's1' }, 30_000), 0.9)
})

test('换了会话（新话题）：不减', () => {
  const emp: any = { id: 'e1', costMark: { sid: 's1', total: 3, tok: 100_000 } }
  const l = run(undefined)
  assert.equal(costOf(emp, l, { total_cost_usd: 3.5, modelUsage: mu(200_000), session_id: 's2' }, 50_000), 3.5)
})

test('没报花费的执行器：不动', () => {
  const emp: any = { id: 'e1' }
  assert.equal(costOf(emp, run(), {}, 100), undefined)
})
