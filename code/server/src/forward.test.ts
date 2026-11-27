// 跑：cd code/server && npm test。聊天里的图片 / 文件：转给别的员工时把文件本身复制过去；?dl=1 一律下载
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

process.env.OPERO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-fwd-'))
const db = await import('./db.ts')
await import('./api.ts') // 注册接口
const { match } = await import('./http.ts')
const { addMsg, listMessages, sessionFor } = await import('./chat.ts')
const { empHome } = await import('./runner.ts')
const { cfg } = await import('./config.ts')
after(() => fs.rmSync(process.env.OPERO_DATA!, { recursive: true, force: true }))

async function call(method: string, p: string, body?: unknown) {
  const url = new URL(p, 'http://opero.local')
  const m = match(method, url.pathname)!
  const heads: Record<string, unknown>[] = []
  const res = Object.assign(new PassThrough(), { writeHead: (_: number, h: Record<string, unknown>) => heads.push(h) })
  res.resume()
  const c = { req: { headers: {}, socket: {} }, res, url, params: m.params, body, sess: { verified: 0 } }
  const data = await m.r.h(c as any)
  if (heads.length) await new Promise((ok) => res.on('end', ok)) // 下载：等文件流完
  return { data, heads }
}

test('转发员工发的图片：对方收到的是文件本身（复制进它的 uploads/），聊天里是图片 + 一句「转自」', async () => {
  db.put('employees', { id: 'e1', name: '安澜', budget: -1 } as any)
  db.put('employees', { id: 'e2', name: '一鸣', budget: -1 } as any) // 预算用满：只看消息，不真的启动 AI（两个都是）
  const s1 = sessionFor('e1'), s2 = sessionFor('e2')
  fs.mkdirSync(path.join(cfg.data, 'files'), { recursive: true })
  fs.writeFileSync(path.join(cfg.data, 'files', 'f1'), 'PNGDATA')
  const m = addMsg(s1.id, { from: 'e1', kind: 'file', file: { name: '头像.png', size: '7 B', ext: 'PNG', image: true, url: 'api/files/f1?name=%E5%A4%B4%E5%83%8F.png' } })
  await call('POST', `/api/sessions/${s2.id}/forward`, { msg: m.id })
  const got = listMessages(s2.id)
  const f = got.find((x) => x.kind === 'file')
  assert.ok(f?.file?.image, '是图片')
  assert.match(f!.file!.url!, /^api\/uploads\/e2\//)
  const copied = fs.readdirSync(path.join(empHome({ id: 'e2' } as any), 'uploads')).find((x) => x.endsWith('-头像.png'))
  assert.ok(copied, '文件复制进了 e2 的 uploads/')
  assert.equal(fs.readFileSync(path.join(empHome({ id: 'e2' } as any), 'uploads', copied!), 'utf8'), 'PNGDATA')
  assert.ok(got.some((x) => x.kind === 'text' && /转自「安澜」的图片/.test(x.text ?? '')))

  // 再从 e2 转回 e1：主人传的（uploads/ 里的）也能转
  await call('POST', `/api/sessions/${s1.id}/forward`, { msg: f!.id })
  assert.ok(listMessages(s1.id).some((x) => x.kind === 'file' && x.file?.url?.startsWith('api/uploads/e1/')))
})

test('转发文字照转；文件没了说清楚', async () => {
  const s1 = sessionFor('e1'), s2 = sessionFor('e2')
  const t = addMsg(s1.id, { from: 'e1', kind: 'text', text: '部署好了' })
  await call('POST', `/api/sessions/${s2.id}/forward`, { msg: t.id })
  assert.ok(listMessages(s2.id).some((x) => x.text === '转自「安澜」：\n部署好了'))
  const gone = addMsg(s1.id, { from: 'e1', kind: 'file', file: { name: 'a.zip', size: '1 B', ext: 'ZIP', url: 'api/files/nothere?name=a.zip' } })
  await assert.rejects(call('POST', `/api/sessions/${s2.id}/forward`, { msg: gone.id }), /文件已经没了/)
})

test('?dl=1 图片也当附件下载', async () => {
  fs.writeFileSync(path.join(cfg.data, 'files', 'f2'), 'x')
  const a = await call('GET', '/api/files/f2?name=a.png')
  assert.match(String(a.heads[0]['Content-Disposition']), /^inline/)
  const b = await call('GET', '/api/files/f2?name=a.png&dl=1')
  assert.match(String(b.heads[0]['Content-Disposition']), /^attachment/)
})
