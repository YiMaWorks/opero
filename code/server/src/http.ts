// 很小的路由：不用框架。route(方法, '/api/x/:id', 处理函数, 选项)；处理函数返回的对象当 JSON 回。
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

export class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, message: string, code = '') { super(message); this.status = status; this.code = code }
}
export const bad = (msg: string, code = 'BAD_REQUEST') => new HttpError(400, msg, code)

export interface Ctx {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  params: Record<string, string>
  body: any
  raw?: Buffer
  ip: string
  /** 登录的会话（auth = owner 时有） */
  sess?: { token: string; verified: number; device: string | null }
  /** 手机外壳的设备（auth = device 时有） */
  device?: { id: string }
  /** MCP 调用的那一轮（auth = mcp 时有） */
  run?: { emp: string; sid: string; runId: string }
  /** Agent 来的请求（auth = agent 时有）：是哪台服务器 */
  agent?: { serverId: string }
}

export type Auth = 'none' | 'owner' | 'device' | 'mcp' | 'agent'
type Handler = (c: Ctx) => unknown
interface Route { method: string; re: RegExp; keys: string[]; h: Handler; auth: Auth; raw?: boolean; max?: number; stream?: boolean }
const routes: Route[] = []

/** stream：不读请求体，处理函数自己从 c.req 里流式读（大文件上传，比如安装包） */
export function route(method: string, pattern: string, h: Handler, opts: { auth?: Auth; raw?: boolean; max?: number; stream?: boolean } = {}) {
  const keys: string[] = []
  const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)' }) + '/?$')
  routes.push({ method, re, keys, h, auth: opts.auth ?? 'owner', raw: opts.raw, max: opts.max, stream: opts.stream })
}

export function match(method: string, path: string) {
  for (const r of routes) {
    if (r.method !== method) continue
    const m = r.re.exec(path)
    if (m) return { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }
  }
  return null
}

export function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let n = 0
    req.on('data', (c: Buffer) => {
      n += c.length
      if (n > max) { reject(new HttpError(413, '太大了')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export function json(res: ServerResponse, status: number, body: unknown) {
  if (res.writableEnded) return
  const s = JSON.stringify(body ?? { ok: true })
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(s)
}

export function parseCookies(h?: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of (h ?? '').split(';')) {
    const i = p.indexOf('=')
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim())
  }
  return out
}

export function clientIp(req: IncomingMessage) {
  const xf = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
  return xf || req.socket.remoteAddress || ''
}

export function isHttps(req: IncomingMessage) { return req.headers['x-forwarded-proto'] === 'https' || (req.socket as any).encrypted === true }

export function baseUrl(req: IncomingMessage, fixed: string) {
  if (fixed) return fixed
  return `${isHttps(req) ? 'https' : 'http'}://${req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost'}`
}

/** 把请求体流式写进文件（最多 max 字节，超了报 413、删掉写了一半的） */
export function saveBody(req: IncomingMessage, file: string, max: number): Promise<number> {
  return new Promise((resolve, reject) => {
    let n = 0
    const out = fs.createWriteStream(file, { mode: 0o600 })
    const fail = (e: Error) => { req.unpipe(out); out.destroy(); fs.rm(file, { force: true }, () => {}); reject(e) }
    req.on('data', (c: Buffer) => { n += c.length; if (n > max) { fail(new HttpError(413, '太大了')); req.destroy() } })
    req.on('error', fail)
    out.on('error', fail)
    out.on('finish', () => resolve(n))
    req.pipe(out)
  })
}
