// 跑：cd code/server && npm test。应用功能的 MCP 工具：走网页那套接口；只读直接做、审核方式「自动」的改动直接做并记操作记录
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.OPERO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-app-'))
const db = await import('./db.ts')
await import('./api.ts') // 注册接口
const { callTool } = await import('./tools.ts')
const { listAudit } = await import('./chat.ts')
after(() => fs.rmSync(process.env.OPERO_DATA!, { recursive: true, force: true }))
const run = { emp: 'e1', sid: 's1', runId: 'r1' }
const text = (r: any) => String(r.text ?? '')

test('只读的直接返回；自动审核的员工改东西直接做、记到操作记录里', async () => {
  db.put('employees', { id: 'e1', name: '思琪', role: '运维', approval: 'auto' } as any)
  db.put('dataSources', { id: 'ds1', name: '订单库', env: '测试', tables: [] } as any)
  const st = await callTool(run, 'settings_get', {})
  assert.match(text(st), /prodProtect/)
  const saved = await callTool(run, 'saved_query', { action: 'save', name: '今天的订单', database: '订单库', sql: 'select 1' })
  assert.ok(!saved.isError, text(saved))
  const list = JSON.parse(text(await callTool(run, 'saved_query', { action: 'list' })))
  assert.equal(list.length, 1)
  assert.equal(list[0].name, '今天的订单')
  assert.ok(listAudit(20).some((x: any) => x.via === '思琪' && x.action === 'mcp.app'), '记了是哪个员工经 MCP 做的')
  const del = await callTool(run, 'saved_query', { action: 'delete', name: '今天的订单' })
  assert.ok(!del.isError, text(del))
  assert.equal(JSON.parse(text(await callTool(run, 'saved_query', { action: 'list' }))).length, 0)
})

test('只看不改的员工不能改', async () => {
  db.put('employees', { id: 'e2', name: '浩然', approval: 'plan' } as any)
  const r = await callTool({ ...run, emp: 'e2' }, 'saved_query', { action: 'save', database: '订单库', sql: 'select 1' })
  assert.ok(r.isError)
  assert.match(text(r), /只看不改/)
})
