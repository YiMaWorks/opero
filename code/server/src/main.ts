// Opero 后台入口：一个 HTTP 服务，/api/* 是接口，其它路径给网页（code/web/dist）。
// 网页是同一份打包：这里在 index.html 里注入 window.OPERO_MODE='instance'，网页就走真的接口（官网和 /demo 没有这句，用假数据）。
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { cfg } from './config.ts'
import { all, kvGet, kvSet } from './db.ts'
import { clientIp, HttpError, json, match, parseCookies, readBody, type Ctx } from './http.ts'
import * as auth from './auth.ts'
import { expireStaleCards, interruptedRuns, migrateEmployeeCreds } from './api.ts'
import * as runner from './runner.ts'
import * as agents from './agents.ts'
import { ensureLocal, startHealthLoop } from './ssh.ts'
import { startTriggerLoop } from './triggers.ts'
import { startLocalProxy } from './tunnel.ts'
import * as inbox from './inbox.ts'
import './notify.ts' // 推送同时转给外部提醒渠道
import type { Device } from './types.ts'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
}

let indexCache: { mtime: number; base: string; html: string } | null = null
/** 装在子路径下（https://x.com/opero/）：前缀来自 OPERO_URL 的路径，或 nginx 传的 X-Forwarded-Prefix；网页里的 <base href> 换成它，接口和资源都按它走 */
function basePath(req: http.IncomingMessage): string {
  let b = ''
  try { b = new URL(cfg.publicUrl).pathname } catch { /* 没配 */ }
  if (!b || b === '/') b = String(req.headers['x-forwarded-prefix'] ?? '')
  b = b.replace(/[^\w./-]/g, '').replace(/\/+$/, '')
  return `${b}/`.replace(/^(?!\/)/, '/')
}
function indexHtml(req: http.IncomingMessage): string | null {
  const p = path.join(cfg.web, 'index.html')
  let st: fs.Stats
  try { st = fs.statSync(p) } catch { return null }
  const base = basePath(req)
  if (indexCache?.mtime !== st.mtimeMs || indexCache.base !== base) {
    const raw = fs.readFileSync(p, 'utf8')
    indexCache = { mtime: st.mtimeMs, base, html: raw.replace(/<base href="[^"]*"\s*\/?>/, `<base href="${base}" />`).replace('</head>', `<script>window.OPERO_MODE='instance'</script></head>`) }
  }
  return indexCache.html
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  const rel = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '')
  const file = path.join(cfg.web, rel)
  if (rel && file.startsWith(cfg.web + path.sep) && !rel.endsWith('index.html')) {
    try {
      const st = fs.statSync(file)
      if (st.isFile()) {
        const immutable = rel.startsWith('assets/')
        res.writeHead(200, {
          'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': st.size,
          'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        })
        if (req.method === 'HEAD') { res.end(); return }
        fs.createReadStream(file).pipe(res)
        return
      }
    } catch { /* 不是文件就给首页 */ }
  }
  const html = indexHtml(req)
  if (!html) { res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(`还没有网页：先在 code/web 里 npm ci && npm run build（找的是 ${cfg.web}）`); return }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin' })
  res.end(html)
}

const isLoopback = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x')
  const p = url.pathname
  if (!p.startsWith('/api/') && !p.startsWith('/hook/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { message: '不支持' }); return }
    serveStatic(req, res, p)
    return
  }
  const m = match(req.method ?? 'GET', p)
  if (!m) { json(res, 404, { message: '没有这个接口', code: 'NOT_FOUND' }); return }
  const c: Ctx = { req, res, url, params: m.params, body: undefined, ip: clientIp(req) }
  try {
    const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
    // Agent 的请求要验签名（签的是请求体）：先把请求体读出来
    let pre: Buffer | null = null
    if ((m.r.auth === 'agent' || p === '/api/agent/register') && req.method !== 'GET' && req.method !== 'HEAD') pre = await readBody(req, m.r.raw ? 300 * 1024 * 1024 : 4 * 1024 * 1024) // raw = 发布产物
    if (m.r.auth === 'owner' || m.r.auth === 'none') c.sess = auth.findSession(parseCookies(req.headers.cookie)[auth.COOKIE]) ?? undefined
    if (m.r.auth === 'owner') {
      if (!c.sess) throw new HttpError(401, '要先登录', 'AUTH')
      // 防跨站：改东西的请求要带自定义头（别的网站的表单 / 图片带不了）
      if (req.method !== 'GET' && req.headers['x-opero'] !== '1') throw new HttpError(403, '缺少请求头', 'CSRF')
    } else if (m.r.auth === 'device') {
      const h = auth.sha(bearer)
      const d = bearer && all<Device>('devices').find((x) => x.tokenHash === h)
      if (!d) throw new HttpError(401, '这台手机没配对或者已经断开', 'DEVICE')
      c.device = { id: d.id }
    } else if (m.r.auth === 'mcp') {
      // MCP 只从本机来（Claude Code / Codex 在这台机器上拉起 mcp.ts）
      // 远程员工（跑在别的服务器的 Agent 上）的 MCP 从外面来：只认这一轮的令牌
      const local = isLoopback(req.socket.remoteAddress ?? '') && !req.headers['x-forwarded-for'] && !req.headers['x-real-ip']
      const r0 = runner.runOf(bearer)
      const run = r0 && (local || r0.remote) ? r0 : undefined
      if (!run) throw new HttpError(401, '这一轮已经结束', 'RUN')
      c.run = run
    } else if (m.r.auth === 'agent') {
      if (req.headers['x-opero-agent-pub']) {
        // 新的：按指纹认（每个请求带公钥 + 签名），换了上报地址也认得
        const r = agents.authSigned(req.headers, req.method ?? 'GET', req.url ?? '', pre ?? Buffer.alloc(0), c.ip)
        if (!r.ok) throw new HttpError(r.status, r.msg, r.code)
        c.agent = { serverId: r.serverId }
      } else {
        const sv = agents.byKey(bearer)
        if (!sv || !agents.isAgent(sv)) throw new HttpError(401, '这台的 Agent 已被移除或密钥不对：在 Opero 网页「应用 → 服务器 → 接入」重新生成命令再跑一次', 'AGENT')
        c.agent = { serverId: sv.id }
      }
    }
    if (pre) {
      c.raw = pre
      if (pre.length && !m.r.raw) { try { c.body = JSON.parse(pre.toString('utf8')) } catch { throw new HttpError(400, '不是 JSON') } }
    } else if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE') {
      const buf = await readBody(req, m.r.max ?? (m.r.raw ? 30 * 1024 * 1024 : 4 * 1024 * 1024))
      if (m.r.raw) c.raw = buf
      else if (buf.length) { try { c.body = JSON.parse(buf.toString('utf8')) } catch { throw new HttpError(400, '不是 JSON') } }
    }
    const out = await m.r.h(c)
    if (!res.headersSent && !res.writableEnded && !p.startsWith('/api/events')) json(res, 200, out)
  } catch (e) {
    if (e instanceof HttpError) json(res, e.status, { message: e.message, code: e.code })
    else { console.error(req.method, p, e); json(res, 500, { message: `出错了：${(e as Error).message}`, code: 'INTERNAL' }) }
  }
}

ensureLocal()
const interrupted = interruptedRuns()
expireStaleCards()
migrateEmployeeCreds()
const server = http.createServer((req, res) => { handle(req, res).catch((e) => { console.error(e); try { json(res, 500, { message: '出错了' }) } catch { /* 已经断了 */ } }) })
server.requestTimeout = 0 // SSE、长轮询、上传
server.headersTimeout = 60_000
server.keepAliveTimeout = 65_000
server.listen(cfg.port, cfg.host, () => {
  console.log(`Opero ${cfg.version} 在 http://${cfg.host}:${cfg.port}（数据 ${cfg.data} · 工作目录 ${cfg.work} · AI 用户 ${cfg.aiUser || '（和 Opero 同一个用户）'}）`)
  if (!cfg.aiUser) console.warn('注意：没设 OPERO_AI_USER，AI 执行器和 Opero 是同一个系统用户，理论上能读到保险箱文件。正式用请用安装脚本装（会建 opero-ai 用户）。')
  startHealthLoop()
  inbox.start()
  startLocalProxy()
  startTriggerLoop()
  // 被重启打断的员工：等几秒（Agent、执行器连好）让它接着做；10 分钟内同一个会话只续一次，免得「发版 → 重启 → 续上又发版」转圈
  setTimeout(() => {
    const last = kvGet<Record<string, number>>('resumedAt', {})
    for (const x of interrupted) {
      if (Date.now() - (last[x.sid] ?? 0) < 10 * 60_000) continue
      last[x.sid] = Date.now()
      void runner.send(x.emp, '（Opero 刚重启过，你上一轮做到一半被打断了：先看清楚做到哪一步，接着做完。要是在等发布结果，用 release_status 查，别再重新发；别用 sleep 干等。）')
    }
    kvSet('resumedAt', last)
  }, 5000)
})

const bye = () => { runner.stopAll(); server.close(); setTimeout(() => process.exit(0), 1500).unref() }
process.on('SIGTERM', bye)
process.on('SIGINT', bye)
