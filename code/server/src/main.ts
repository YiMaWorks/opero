// Opero 后台入口：一个 HTTP 服务，/api/* 是接口，其它路径给网页（code/web/dist）。
// 网页是同一份打包：这里在 index.html 里注入 window.OPERO_MODE='instance'，网页就走真的接口（官网和 /demo 没有这句，用假数据）。
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { cfg } from './config.ts'
import { all } from './db.ts'
import { clientIp, HttpError, json, match, parseCookies, readBody, type Ctx } from './http.ts'
import * as auth from './auth.ts'
import { expireStaleCards } from './api.ts'
import * as runner from './runner.ts'
import { ensureLocal, startHealthLoop } from './ssh.ts'
import { startTriggerLoop } from './triggers.ts'
import type { Device } from './types.ts'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
}

let indexCache: { mtime: number; html: string } | null = null
function indexHtml(): string | null {
  const p = path.join(cfg.web, 'index.html')
  let st: fs.Stats
  try { st = fs.statSync(p) } catch { return null }
  if (indexCache?.mtime !== st.mtimeMs) {
    const raw = fs.readFileSync(p, 'utf8')
    indexCache = { mtime: st.mtimeMs, html: raw.replace('</head>', `<script>window.OPERO_MODE='instance'</script></head>`) }
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
  const html = indexHtml()
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
      const local = isLoopback(req.socket.remoteAddress ?? '') && !req.headers['x-forwarded-for'] && !req.headers['x-real-ip']
      const run = local ? runner.runOf(bearer) : undefined
      if (!run) throw new HttpError(401, '这一轮已经结束', 'RUN')
      c.run = run
    }
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE') {
      const buf = await readBody(req, m.r.raw ? 30 * 1024 * 1024 : 4 * 1024 * 1024)
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
expireStaleCards()
const server = http.createServer((req, res) => { handle(req, res).catch((e) => { console.error(e); try { json(res, 500, { message: '出错了' }) } catch { /* 已经断了 */ } }) })
server.requestTimeout = 0 // SSE、长轮询、上传
server.headersTimeout = 60_000
server.keepAliveTimeout = 65_000
server.listen(cfg.port, cfg.host, () => {
  console.log(`Opero ${cfg.version} 在 http://${cfg.host}:${cfg.port}（数据 ${cfg.data} · 工作目录 ${cfg.work} · AI 用户 ${cfg.aiUser || '（和 Opero 同一个用户）'}）`)
  if (!cfg.aiUser) console.warn('注意：没设 OPERO_AI_USER，AI 执行器和 Opero 是同一个系统用户，理论上能读到保险箱文件。正式用请用安装脚本装（会建 opero-ai 用户）。')
  startHealthLoop()
  startTriggerLoop()
})

const bye = () => { runner.stopAll(); server.close(); setTimeout(() => process.exit(0), 1500).unref() }
process.on('SIGTERM', bye)
process.on('SIGINT', bye)
