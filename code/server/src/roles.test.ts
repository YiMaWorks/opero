// 跑：cd code/server && npm test。名字兼职位的老员工：一次性把名字挪到职位、起人名
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.OPERO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-role-'))
const db = await import('./db.ts')
after(() => fs.rmSync(process.env.OPERO_DATA!, { recursive: true, force: true }))

test('名字挪到职位、按性别起不重名的人名、字头像跟着换；只做一次', async () => {
  db.kvSet('settings', { lang: 'zh-CN' })
  db.put('employees', { id: 'a', name: '运维', avatar: '运', gender: '男' } as any)
  db.put('employees', { id: 'b', name: 'opero开源-android', avatar: 'o', gender: '女' } as any)
  db.put('employees', { id: 'c', name: '日志值班', avatar: '🤖' } as any)
  db.put('employees', { id: 'd', name: '已有职位的', role: '测试' } as any)
  const { migrateRoles } = await import('./api.ts')
  migrateRoles()
  const all = db.all<any>('employees')
  const a = all.find((e) => e.id === 'a'), b = all.find((e) => e.id === 'b'), c = all.find((e) => e.id === 'c'), d = all.find((e) => e.id === 'd')
  assert.equal(a.role, '运维'); assert.equal(b.role, 'opero开源-android'); assert.equal(c.role, '日志值班')
  const names = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'names.json'), 'utf8'))
  assert.ok(names.zh.m.includes(a.name), '男的起男生名')
  assert.ok(names.zh.f.includes(b.name), '女的起女生名')
  assert.equal(new Set(all.map((e) => e.name)).size, all.length, '不重名')
  assert.equal(a.avatar, Array.from(a.name)[0], '字头像跟着新名字')
  assert.equal(c.avatar, '🤖', '表情头像不动')
  assert.equal(d.name, '已有职位的', '有职位的不动')
  const before = JSON.stringify(db.all('employees'))
  migrateRoles()
  assert.equal(JSON.stringify(db.all('employees')), before, '只做一次')
})
