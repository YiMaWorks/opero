// 跑：cd code/server && npm test。员工建安装包发布目标时选签名证书（release_target_set 的 sign）：只认员工能用的安卓证书
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.OPERO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-sign-'))
const db = await import('./db.ts')
await import('./api.ts')
const { callTool } = await import('./tools.ts')
const { setSecret } = await import('./vault.ts')
after(() => fs.rmSync(process.env.OPERO_DATA!, { recursive: true, force: true }))

const run = { emp: 'e1', sid: 's1', runId: 'r1' }
const text = (r: any) => String(r.text ?? '')

test('sign：员工能用的安卓证书才行；none 去掉；回复里写签的是哪张', async () => {
  db.put('workspaces', { id: 'w1', name: 'app', repo: 'x', branch: 'main', builds: [{ id: 'b1', name: '安卓', kind: 'android', provider: 'local', where: 'local' }], deploys: [] } as any)
  db.put('credentials', { id: 'k1', name: '安卓发布证书', group: '签名证书', kind: '安卓签名', aiAllowed: true } as any)
  setSecret('k1', JSON.stringify({ type: 'android', jks: 'x', storePass: 'p', alias: 'a' }))
  db.put('credentials', { id: 'k2', name: '苹果证书', group: '签名证书', kind: '苹果证书', aiAllowed: true } as any)
  setSecret('k2', JSON.stringify({ type: 'apple' }))
  db.put('credentials', { id: 'k3', name: '没开的证书', group: '签名证书', kind: '安卓签名', aiAllowed: true } as any)
  setSecret('k3', JSON.stringify({ type: 'android' }))
  db.put('employees', { id: 'e1', name: '一鸣', workspace: 'w1', approval: 'auto', creds: ['k1', 'k2'] } as any)

  const r = await callTool(run, 'release_target_set', { name: '测试', package: 'android:test', sign: '安卓发布证书' })
  assert.ok(!r.isError, text(r))
  assert.match(text(r), /用证书「安卓发布证书」签名/)
  assert.equal((db.get('workspaces', 'w1') as any).deploys[0].sign, 'k1')

  const apple = await callTool(run, 'release_target_set', { name: '测试', sign: '苹果证书' })
  assert.ok(apple.isError)
  assert.match(text(apple), /不能签安卓包/)

  const notMine = await callTool(run, 'release_target_set', { name: '测试', sign: '没开的证书' })
  assert.ok(notMine.isError)
  assert.match(text(notMine), /没给你开/)

  const none = await callTool(run, 'release_target_set', { name: '测试', sign: 'none' })
  assert.ok(!none.isError, text(none))
  assert.match(text(none), /没签名/)
  assert.equal((db.get('workspaces', 'w1') as any).deploys[0].sign, undefined)

  const info = JSON.parse(text(await callTool(run, 'build_info', {})))
  assert.deepEqual(info.signingCerts.map((c: any) => c.name).sort(), ['安卓发布证书', '苹果证书'])
})
