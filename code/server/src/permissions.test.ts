// 跑：cd code/server && npm test。员工的权限：都能看到有哪些、申请了主人一点就给；确认卡不过期，员工没等到、主人晚点点了照样算
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.OPERO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-perm-'))
const db = await import('./db.ts')
await import('./api.ts')
const { callTool } = await import('./tools.ts')
const runner = await import('./runner.ts')
const { match } = await import('./http.ts')
const { listMessages, sessionFor } = await import('./chat.ts')
after(() => fs.rmSync(process.env.OPERO_DATA!, { recursive: true, force: true }))

// 预算用满：runner.send 只记消息、不真的启动 AI
db.put('employees', { id: 'e1', name: '一鸣', approval: 'ask', budget: -1, creds: ['k1'] } as any)
db.put('credentials', { id: 'k1', name: '阿里云 OSS', group: '云账号', kind: '阿里云', env: '生产', aiAllowed: true } as any)
db.put('credentials', { id: 'k2', name: 'Codeup 令牌', group: '代码仓库', kind: 'Codeup', env: '生产', scope: '读写仓库', aiAllowed: true } as any)
db.put('credentials', { id: 'k3', name: '生产库 root', group: '数据库', kind: 'MySQL', env: '生产', aiAllowed: false } as any)
db.put('domains', { id: 'd1', domain: 'example.com', provider: 'cloudflare', cred: 'k1' } as any)
const run = { emp: 'e1', sid: sessionFor('e1').id, runId: 'r1' }
const text = (r: any) => String(r.text ?? '')
async function click(msgId: string, action: string) {
  const url = new URL(`http://x/api/messages/${msgId}/action`)
  const m = match('POST', url.pathname)!
  return (await m.r.h({ req: { headers: {}, socket: {} }, res: {}, url, params: m.params, body: { action }, sess: { verified: Date.now(), token: "t" } } as any)) as any
}
const lastCard = () => listMessages(run.sid).filter((m) => m.kind === 'card').pop()!
// runner.send 交给员工（这里预算用满，它会记一条「预算用满」的系统消息）：数这个就知道通知员工了没有
const told = () => listMessages(run.sid).filter((m) => m.kind === 'system' && /预算/.test(m.text ?? '')).length

test('my_permissions：全都看得到，标清楚给没给，没有值', async () => {
  const c = JSON.parse(text(await callTool(run, 'my_permissions', {})))
  const st = Object.fromEntries(c.credentials.map((x: any) => [x.name, x.status]))
  assert.deepEqual(st, { '阿里云 OSS': 'granted', 'Codeup 令牌': 'not-granted', '生产库 root': 'owner-only' })
  assert.equal(c.domains[0].status, 'not-granted')
  assert.doesNotMatch(JSON.stringify(c), /secret|password|value"/i)
})

test('request_permission：发卡片不等；同一件事不重发；主人同意就给上并告诉员工', async () => {
  const r = await callTool(run, 'request_permission', { kind: 'credential', name: 'Codeup 令牌', why: '配流水线' })
  assert.ok(!r.isError, text(r))
  const card = lastCard()
  assert.equal(card.card!.data.needYou, true)
  const again = await callTool(run, 'request_permission', { kind: 'credential', name: 'Codeup 令牌', why: '再要一次' })
  assert.match(text(again), /已经在申请了/)
  const n = told()
  const res = await click(card.id, 'allow')
  assert.ok((db.get('employees', 'e1') as any).creds.includes('k2'))
  assert.match(String(res.result), /它已经知道了/)
  assert.equal(told(), n + 1, '告诉员工了')
})

test('只有主人本人能用的：能申请，同意时改成员工能用', async () => {
  await callTool(run, 'request_permission', { kind: 'credential', name: '生产库 root', why: '查一个线上问题' })
  const card = lastCard()
  assert.equal(card.card!.level, 'danger')
  await click(card.id, 'allow')
  assert.equal((db.get('credentials', 'k3') as any).aiAllowed, true)
})

test('确认卡：员工没等到（这一轮结束）卡片留着；主人晚点同意，同一件事再做直接放行', async () => {
  const p = callTool(run, 'confirm', { title: '重启 nginx', detail: 'systemctl restart nginx' })
  await new Promise((ok) => setTimeout(ok, 50))
  runner.cancelPending(run.runId, '这一轮结束')
  assert.match(text(await p), /主人还没回「重启 nginx」/)
  const card = lastCard()
  assert.equal(card.card!.state, 'open', '卡片不关')
  assert.equal(card.card!.data.late, true)
  const n = told()
  const r = await click(card.id, 'allow')
  assert.match(String(r.result), /30 分钟内再做就直接放行/)
  assert.equal(told(), n + 1, '告诉员工了')
  assert.equal(text(await callTool(run, 'confirm', { title: '重启 nginx', detail: 'systemctl restart nginx' })), 'approved', '不再问')
})
