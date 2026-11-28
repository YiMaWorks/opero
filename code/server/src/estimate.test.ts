// 跑：cd code/server && npm test。发布每一步的预估：最近几次成功的中位数，编译秒完的（缓存）不算
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.OPERO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-est-'))
const { estimate } = await import('./releases.ts')
after(() => fs.rmSync(process.env.OPERO_DATA!, { recursive: true, force: true }))

const rel = (build: number, deploy: number) => ({ steps: [{ k: 'build', s: 'done', t0: 1, t1: 1 + build }, { k: 'deploy', s: 'done', t0: 1, t1: 1 + deploy }] }) as any

test('上次编译命中缓存（1 秒）：不拿它当预估', () => {
  const e = estimate([rel(1000, 4000), rel(68_000, 4200), rel(72_000, 3900)])
  assert.equal(e.build, 68_000)
  assert.equal(e.deploy, 4000)
})
test('全都是秒完的：就按它', () => {
  assert.equal(estimate([rel(1000, 1), rel(2000, 1)]).build, 1000)
})
test('没有成功过：没有预估', () => {
  assert.deepEqual(estimate([]), {})
})
