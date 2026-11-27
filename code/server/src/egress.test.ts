// 跑：cd code/server && npm test。网络出口：地址怎么认、规则怎么挑、fetch / 内部代理真的经隧道走、连不上的记下来
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

process.env.OPERO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-egress-'))
const egress = await import('./egress.ts')
const { kvSet } = await import('./db.ts')
after(() => fs.rmSync(process.env.OPERO_DATA!, { recursive: true, force: true }))

test('贴什么都认得：网址、邮箱、host:port、*.域名', () => {
  assert.deepEqual(egress.parseTarget('https://api.telegram.org/bot123/sendMessage'), { host: 'api.telegram.org', port: 443 })
  assert.deepEqual(egress.parseTarget('someone@Gmail.com'), { host: 'gmail.com', port: undefined })
  assert.deepEqual(egress.parseTarget('imap.gmail.com:993'), { host: 'imap.gmail.com', port: 993 })
  assert.deepEqual(egress.parseTarget('*.slack.com'), { host: 'slack.com', port: undefined })
  assert.deepEqual(egress.parseTarget('imaps://imap.qq.com'), { host: 'imap.qq.com', port: 993 })
  assert.equal(typeof egress.parseTarget('不是域名'), 'string')
  assert.equal(typeof egress.parseTarget(''), 'string')
})

test('最具体的规则生效；写域名也管子域名；direct 开例外', () => {
  const list = [
    { id: 'a', host: 'google.com', via: 's1', at: 0 },
    { id: 'b', host: 'mail.google.com', via: 'direct', at: 0 },
    { id: 'c', host: 'imap.mail.google.com', via: 's2', at: 0 },
  ]
  assert.equal(egress.ruleFor('www.google.com', list)?.id, 'a')
  assert.equal(egress.ruleFor('google.com', list)?.id, 'a')
  assert.equal(egress.ruleFor('mail.google.com', list)?.id, 'b')
  assert.equal(egress.ruleFor('x.mail.google.com', list)?.id, 'b')
  assert.equal(egress.ruleFor('imap.mail.google.com', list)?.id, 'c')
  assert.equal(egress.ruleFor('notgoogle.com', list), undefined)
})

// 本机起一个 HTTP 服务当「外面的网站」，出口用 local（Opero 这台自己，走的是同一条隧道代码）
const site = http.createServer((_q, r) => { r.end('hello from site') })
await new Promise<void>((ok) => site.listen(0, '127.0.0.1', () => ok()))
const sitePort = (site.address() as net.AddressInfo).port
after(() => site.close())
await egress.startInternalProxy()
egress.installFetch()

test('经出口连：内网地址默认拒绝，勾了「允许内网」才通', async () => {
  await assert.rejects(egress.dialVia('local', '127.0.0.1', sitePort, false), /内网/)
  const s = await egress.dialVia('local', '127.0.0.1', sitePort, true)
  s.write('GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')
  const body = await new Promise<string>((ok) => { let b = ''; s.on('data', (d) => (b += d)); s.on('end', () => ok(b)) })
  assert.match(body, /hello from site/)
})

test('fetch 按规则走：有规则经隧道（证据：没勾内网就被拒），勾了就通；没规则直连', async () => {
  const url = `http://127.0.0.1:${sitePort}/`
  assert.equal(await (await fetch(url)).text(), 'hello from site', '没规则：直连')
  kvSet('egressRules', [{ id: 'r1', host: '127.0.0.1', via: 'local', at: 0 }])
  await assert.rejects(fetch(url), (e: any) => /内网/.test(String(e?.cause?.message ?? e)))
  kvSet('egressRules', [{ id: 'r1', host: '127.0.0.1', via: 'local', lan: true, at: 0 }])
  assert.equal(await (await fetch(url)).text(), 'hello from site')
  assert.ok(egress.proxyFor('127.0.0.1')?.startsWith('http://local~lan:'), '邮件用的代理地址')
  kvSet('egressRules', [])
})

test('直连连不上的记进「最近连不上的」，报错带上去哪换出口；忽略能消掉', async () => {
  // 找一个没人听的端口（fetch 不许连 1 这类端口，所以现找）
  const tmp = net.createServer()
  await new Promise<void>((ok) => tmp.listen(0, '127.0.0.1', () => ok()))
  const closed = (tmp.address() as net.AddressInfo).port
  await new Promise((ok) => tmp.close(ok))
  await assert.rejects(fetch(`http://localhost:${closed}/`))
  const f = egress.failures().find((x) => x.host === 'localhost')
  assert.ok(f, '记下来了')
  assert.equal(f!.port, closed)
  assert.match(egress.hint('localhost', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })), /网络出口/)
  egress.ignoreFail('localhost')
  assert.ok(!egress.failures().some((x) => x.host === 'localhost'))
})

test('测试：直连和经出口各连一次', async () => {
  const r = await egress.test('127.0.0.1', sitePort)
  assert.equal(r.direct.ok, true)
  assert.equal(r.via, undefined)
  const bad = await egress.test('127.0.0.1', sitePort, 'nope')
  assert.equal(bad.via?.ok, false)
  assert.match(bad.via!.err!, /当不了出口/)
})
