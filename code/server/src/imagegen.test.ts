// 跑：cd code/server && npm test。生图工具：挑员工能用的 Key、通义万相的异步任务、OpenAI 风格、限流重试、图放进员工目录并发到聊天
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.OPERO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-img-'))
const db = await import('./db.ts')
await import('./api.ts')
const { callTool } = await import('./tools.ts')
const { setSecret } = await import('./vault.ts')
const { listMessages, sessionFor } = await import('./chat.ts')
const { parseSize } = await import('./imagegen.ts')
const { empHome } = await import('./runner.ts')
after(() => fs.rmSync(process.env.OPERO_DATA!, { recursive: true, force: true }))

// 1×1 的 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const realFetch = globalThis.fetch
after(() => { globalThis.fetch = realFetch })
const calls: string[] = []
function fake(h: (url: string, body: any) => unknown) {
  calls.length = 0
  globalThis.fetch = (async (u: string | URL, init?: RequestInit) => {
    const url = String(u)
    calls.push(url)
    if (url.startsWith('https://img.example/')) return new Response(PNG)
    const out = h(url, init?.body ? JSON.parse(String(init.body)) : undefined)
    if (out instanceof Response) return out
    return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
}
const run = { emp: 'e1', sid: 's1', runId: 'r1' }
const text = (r: any) => String(r.text ?? '')

test('尺寸', () => {
  assert.deepEqual(parseSize('1024x768'), { width: 1024, height: 768 })
  assert.deepEqual(parseSize('1280*720'), { width: 1280, height: 720 })
  assert.equal(typeof parseSize('4096x4096'), 'string')
  assert.equal(typeof parseSize('大一点'), 'string')
})

test('没有能生图的 Key / 没授权：说清楚找谁要', async () => {
  db.put('employees', { id: 'e1', name: '安澜', creds: [] } as any)
  assert.match(text(await callTool(run, 'image_generate', { prompt: '一只猫' })), /request_credential/)
  db.put('credentials', { id: 'c1', name: '百炼', group: 'AI', kind: '通义千问（阿里云百炼）', aiAllowed: true, usedBy: [] } as any)
  setSecret('c1', 'sk-test-123')
  const r = await callTool(run, 'image_generate', { prompt: '一只猫' })
  assert.ok(r.isError)
  assert.match(text(r), /没给你开/)
})

test('通义万相：提交 → 限流一次自动重试 → 轮询 → 下载；图放进 images/、发到聊天，Key 不外露', async () => {
  db.put('employees', { id: 'e1', name: '安澜', creds: ['c1'] } as any)
  let submits = 0
  fake((url, body) => {
    if (url.endsWith('/image-synthesis')) {
      submits++
      if (submits === 1) return new Response(JSON.stringify({ code: 'Throttling.RateQuota', message: 'rate limit' }), { status: 429 })
      assert.equal(body.parameters.size, '1024*1024')
      assert.equal(body.parameters.n, 2)
      assert.equal(body.input.negative_prompt, '文字')
      return { output: { task_id: 't1', task_status: 'PENDING' } }
    }
    if (url.endsWith('/api/v1/tasks/t1')) return { output: { task_status: 'SUCCEEDED', results: [{ url: 'https://img.example/1.png' }, { url: 'https://img.example/2.png' }] } }
    throw new Error('没想到的请求 ' + url)
  })
  const r = await callTool(run, 'image_generate', { prompt: '写实头像', negative_prompt: '文字', n: 2, name: 'avatar-f01' })
  assert.ok(!r.isError, text(r))
  assert.equal(submits, 2, '限流后重试了')
  assert.ok(calls.some((u) => u === 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis'))
  const dir = path.join(empHome({ id: 'e1' } as any), 'images')
  const files = fs.readdirSync(dir)
  assert.equal(files.length, 2)
  assert.ok(files.every((f) => /^avatar-f01-\d{14}-[12]\.png$/.test(f)))
  const imgs = listMessages(sessionFor('e1').id).filter((m) => m.kind === 'file')
  assert.equal(imgs.length, 2)
  assert.equal(imgs[0].file?.w, 1)
  assert.ok(!text(r).includes('sk-test-123'))
})

test('OpenAI 风格（b64）、send=false 不发聊天、选指定凭证', async () => {
  db.put('credentials', { id: 'c2', name: 'OpenAI 生图', group: 'AI', kind: 'OpenAI', aiAllowed: true, usedBy: [] } as any)
  setSecret('c2', 'sk-openai')
  db.put('employees', { id: 'e1', name: '安澜', creds: ['c1', 'c2'] } as any)
  const before = listMessages(sessionFor('e1').id).length
  fake((url, body) => {
    assert.equal(url, 'https://api.openai.com/v1/images/generations')
    assert.equal(body.size, '1536x1024', '挑最接近的比例')
    return { data: [{ b64_json: PNG.toString('base64') }] }
  })
  const r = await callTool(run, 'image_generate', { prompt: 'a banner', size: '1600x1000', credential: 'OpenAI 生图', send: false })
  assert.ok(!r.isError, text(r))
  assert.match(text(r), /gpt-image-1/)
  assert.equal(listMessages(sessionFor('e1').id).length, before)
})

test('接口报错：返回原因，记操作记录', async () => {
  fake(() => new Response(JSON.stringify({ code: 'InvalidApiKey', message: 'bad key sk-test-123' }), { status: 401 }))
  const r = await callTool(run, 'image_generate', { prompt: '一只猫', credential: '百炼' })
  assert.ok(r.isError)
  assert.match(text(r), /Key 不对/)
})
