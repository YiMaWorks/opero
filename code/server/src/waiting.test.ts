// 跑：cd code/server && npm test。红点（会话的「要你决定」）一定有办法消掉：按还有没有没处理的「等你」卡片重算
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.OPERO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-wait-'))
const db = await import('./db.ts')
const chat = await import('./chat.ts')
after(() => fs.rmSync(process.env.OPERO_DATA!, { recursive: true, force: true }))

const card = (title: string) => ({ id: db.uid('c'), type: 'generic' as const, v: 1 as const, state: 'open' as const, level: 'warn' as const, data: { title }, actions: [{ id: 'later', label: '以后再说' }] })

test('等你的卡片在，红点就在；都处理完（或以后再说）红点就消', () => {
  db.put('employees', { id: 'e1', name: '测试员工', notify: 'none' } as any)
  const a = chat.empSays('e1', { kind: 'card', card: card('要一个签名证书') }, '要一个签名证书', true)
  const b = chat.empSays('e1', { kind: 'card', card: card('选一个方案') }, '选一个方案', true)
  const sid = chat.sessionFor('e1').id
  assert.equal(db.get<any>('sessions', sid)?.waiting, '要你决定')
  assert.equal(a.card?.data.needYou, true, '要你决定的卡片打上 needYou')
  chat.patchMsg(a.id, { card: { ...a.card!, state: 'done', result: '以后再说' } })
  assert.equal(db.get<any>('sessions', sid)?.waiting, '要你决定', '还有一张没处理，红点留着')
  chat.patchMsg(b.id, { card: { ...b.card!, state: 'done', result: '选了 A' } })
  assert.equal(db.get<any>('sessions', sid)?.waiting, undefined, '都处理完了，红点消掉')
})

test('普通消息不挂红点；重算是幂等的', () => {
  chat.empSays('e1', { kind: 'text', text: '做完了' }, '做完了')
  const sid = chat.sessionFor('e1').id
  chat.syncWaiting(sid)
  assert.equal(db.get<any>('sessions', sid)?.waiting, undefined)
})
