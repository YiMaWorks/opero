// 跑：cd code/server && npm test。旧 Agent 不会传文件：先看版本，不够就直接说怎么办，不干等
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.OPERO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-agent-'))
const db = await import('./db.ts')
const agents = await import('./agents.ts')
after(() => fs.rmSync(process.env.OPERO_DATA!, { recursive: true, force: true }))

test('版本比较', () => {
  const sv = (v: string) => ({ agentVersion: v } as any)
  assert.equal(agents.agentAtLeast(sv('0.6.1'), '0.9.0'), false)
  assert.equal(agents.agentAtLeast(sv('0.9.0'), '0.9.0'), true)
  assert.equal(agents.agentAtLeast(sv('0.28.1'), '0.9.0'), true)
  assert.equal(agents.agentAtLeast(sv('1.0'), '0.9.0'), true)
  assert.equal(agents.agentAtLeast(sv(''), '0.9.0'), false)
})

test('旧 Agent 传文件马上回「要升级」，不等超时', async () => {
  db.put('servers', { id: 'sv1', name: 'old-box', env: '开发', agentVersion: '0.6.1', via: 'agent' } as any)
  const t0 = Date.now()
  const r = await agents.blobTask('sv1', { t: 'push', key: 'k', path: '/srv/opero/work/x' })
  assert.equal(r.code, 1)
  assert.match(r.out, /升级 Agent/)
  assert.ok(Date.now() - t0 < 1000)
})
