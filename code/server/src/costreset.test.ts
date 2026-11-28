// 跑：cd code/server && npm test。清掉 0.31.1 以前算错的花费：只清金额，轮数和 token 留着；只跑一次
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.OPERO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-costreset-'))
const db = await import('./db.ts')
const { migrateCostReset } = await import('./api.ts')
const { recordRun, usage } = await import('./chat.ts')
after(() => fs.rmSync(process.env.OPERO_DATA!, { recursive: true, force: true }))

test('金额清零、轮数和 token 不动、会话累计清掉；第二次不再清', () => {
  recordRun('r1', 'e1', true, 7322.83, 1000)
  recordRun('r2', 'e1', false, 12.5, 500)
  db.put('sessions', { id: 's1', employee: 'e1', cost: 596.1 } as any)
  migrateCostReset()
  const u = usage().find((x) => x.employee === 'e1')!
  assert.equal(u.cost, 0)
  assert.equal(u.tasks, 2)
  assert.equal(u.success, 1)
  assert.equal((db.get('sessions', 's1') as any).cost, undefined)
  // 之后按新算法记的不再被清
  recordRun('r3', 'e1', true, 1.25, 100)
  migrateCostReset()
  assert.equal(usage().find((x) => x.employee === 'e1')!.cost, 1.25)
})
