// 跑：cd code/server && npm test。Agent 自动升级：旧了、在线、那台空闲才升；忙就等；15 分钟没升上来算失败、一小时后再试；能关
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.OPERO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-agup-'))
const db = await import('./db.ts')
const { cfg } = await import('./config.ts')
const up = await import('./agentupgrade.ts')
after(() => fs.rmSync(process.env.OPERO_DATA!, { recursive: true, force: true }))

const calls: string[] = []
const fakeExec = (async (id: string, cmd: string) => { calls.push(`${id}: ${cmd}`); return { code: 0, out: 'STARTED' } }) as any
const sv = (o: any = {}) => ({ id: 's1', name: 'aws-uat', env: '测试', via: 'agent', online: true, lastSeen: Date.now(), agentVersion: '0.25.6', ...o })
const now = Date.now()

test('旧了、在线、空闲：开始升级（和手动点一样的命令），记 running', async () => {
  db.put('servers', sv())
  assert.equal(await up.check(db.get('servers', 's1') as any, now, fakeExec), 'started')
  assert.match(calls[0], /systemd-run --unit=opero-agent-upgrade .*opero update/)
  const st = (db.get('servers', 's1') as any).agentUpgrade
  assert.equal(st.status, 'running'); assert.equal(st.target, cfg.version)
  // 升级中：不重复发
  assert.equal(await up.check(db.get('servers', 's1') as any, now + 60_000, fakeExec), 'running')
  assert.equal(calls.length, 1)
})

test('升上来了：记 ok；15 分钟没升上来：失败，一小时内不再试', async () => {
  db.put('servers', { ...(db.get('servers', 's1') as any), agentVersion: cfg.version })
  assert.equal(await up.check(db.get('servers', 's1') as any, now + 120_000, fakeExec), 'current')
  assert.equal((db.get('servers', 's1') as any).agentUpgrade.status, 'ok')
  db.put('servers', sv({ id: 's2', agentUpgrade: { target: cfg.version, at: now, status: 'running' } }))
  assert.equal(await up.check(db.get('servers', 's2') as any, now + 16 * 60_000, fakeExec), 'failed')
  assert.equal(await up.check(db.get('servers', 's2') as any, now + 30 * 60_000, fakeExec), 'wait-retry')
  assert.equal(await up.check(db.get('servers', 's2') as any, now + 80 * 60_000, fakeExec), 'started', '一小时后再试')
})

test('忙（正在发布到这台）：先等，不打断', async () => {
  db.put('servers', sv({ id: 's3' }))
  db.put('workspaces', { id: 'w1', name: 'app', deploys: [{ id: 'd1', name: '测试', servers: ['s3'] }] } as any)
  db.put('releases', { id: 'r1', ws: 'w1', target: 'd1', targetName: '测试', status: 'running', steps: [] } as any)
  const n = calls.length
  assert.equal(await up.check(db.get('servers', 's3') as any, now, fakeExec), 'busy')
  assert.equal(calls.length, n)
  assert.match((db.get('servers', 's3') as any).agentUpgrade.msg, /等空闲：正在发布到这台/)
})

test('关了、离线、Opero 这台自己：不管', async () => {
  db.put('servers', sv({ id: 's4', autoUpgrade: false }))
  assert.equal(await up.check(db.get('servers', 's4') as any, now, fakeExec), 'skip')
  db.put('servers', sv({ id: 's5', online: false, lastSeen: now - 3600_000 }))
  assert.equal(await up.check(db.get('servers', 's5') as any, now, fakeExec), 'offline')
  assert.equal(await up.check(sv({ id: 'local' }) as any, now, fakeExec), 'skip')
})
