// 跑：cd code/server && npm test。用一个临时数据目录，不碰真的数据
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.OPERO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-pkg-'))
const P = await import('./packages.ts')
after(() => fs.rmSync(process.env.OPERO_DATA!, { recursive: true, force: true }))
const w = { id: 'wsT', name: '测试项目' } as any
const tmp = (n: string, body: string) => { const f = path.join(process.env.OPERO_DATA!, n); fs.writeFileSync(f, body); return f }

test('按扩展名认端、按文件名认版本', () => {
  assert.equal(P.guessPlatform('app-release-1.2.3.apk'), 'android')
  assert.equal(P.guessPlatform('Opero_0.4.0_x64.msix'), 'windows')
  assert.equal(P.guessPlatform('Opero.AppImage'), 'linux')
  assert.equal(P.guessPlatform('Opero.ipa'), 'ios')
  assert.equal(P.guessPlatform('a.zip'), undefined)
  assert.equal(P.guessVersion('opero-1.2.3-unsigned.apk'), '1.2.3')
  assert.equal(P.guessVersion('Opero_0.4.0_x64.msix'), '0.4.0')
  assert.equal(P.guessVersion('app-v2.1.0-release.ipa'), '2.1.0')
  assert.equal(P.guessVersion('app.apk'), undefined)
})

test('每格只留最新；分享链接换包后照样能用；删掉就没了', () => {
  P.store(w, 'android', 'test', tmp('a1', 'AAA'), { name: 'app-1.0.0.apk', by: '测试' })
  const b = P.store(w, 'android', 'test', tmp('a2', 'BBBB'), { name: 'app-1.0.1.apk', by: '测试' })
  assert.equal(P.list('wsT').length, 1)
  assert.deepEqual(fs.readdirSync(path.dirname(P.fileOf(b))), ['app-1.0.1.apk'])
  assert.equal(b.size, 4)
  const s = P.share(b.id, 7, '测试')
  assert.ok(P.byShare(s.share!.token))
  assert.equal(P.byShare('x'.repeat(24)), undefined)
  const c = P.store(w, 'android', 'test', tmp('a3', 'CC'), { name: 'app-1.0.2.apk', by: '测试' })
  assert.equal(P.byShare(s.share!.token)?.version, '1.0.2')
  P.store(w, 'android', 'prod', tmp('a4', 'D'), { name: 'app-1.0.2.apk', by: '测试' })
  assert.equal(P.list('wsT').length, 2, '测试和正式是两格')
  P.remove(c.id, '测试')
  assert.equal(P.list('wsT').length, 1)
  assert.equal(P.share(P.idOf('wsT', 'android', 'prod'), 0, '测试').share, undefined, 'days=0 关掉')
})
