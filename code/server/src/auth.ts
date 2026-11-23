// 登录：一套 Opero 只有一个主人。密码 scrypt 存；登录后发一个随机会话令牌放 HttpOnly cookie。
// 危险操作（看凭证明文、改凭证、点危险卡片）要「验证本人」：网页输一次密码 / App 用指纹，5 分钟内不再问。
import crypto from 'node:crypto'
import { db, kvGet, kvSet } from './db.ts'
import type { Owner } from './types.ts'

export const COOKIE = 'opero_sid'
export const VERIFY_MS = 5 * 60_000
const SESSION_DAYS = 30

export const owner = () => kvGet<Owner | null>('owner', null)

export function hashPassword(pwd: string, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pwd, salt, 64).toString('hex') }
}

export function checkPassword(pwd: string): boolean {
  const o = owner()
  if (!o) return false
  const h = crypto.scryptSync(pwd, o.salt, 64)
  const want = Buffer.from(o.hash, 'hex')
  return h.length === want.length && crypto.timingSafeEqual(h, want)
}

export function createOwner(email: string, name: string, pwd: string) {
  kvSet('owner', { email, name, ...hashPassword(pwd) } satisfies Owner)
}

export function setPassword(pwd: string) {
  const o = owner()
  if (o) kvSet('owner', { ...o, ...hashPassword(pwd) })
  db.prepare('DELETE FROM auth_sessions').run() // 改了密码：所有地方都要重新登录
}

export function newSession(device: string | null = null): string {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  db.prepare('INSERT INTO auth_sessions (token, created, seen, verified, device) VALUES (?, ?, ?, 0, ?)').run(sha(token), now, now, device)
  return token
}

export function findSession(token: string | undefined) {
  if (!token) return null
  const r = db.prepare('SELECT token, created, seen, verified, device FROM auth_sessions WHERE token = ?').get(sha(token)) as
    { token: string; created: number; seen: number; verified: number; device: string | null } | undefined
  if (!r) return null
  if (Date.now() - r.seen > SESSION_DAYS * 86400_000) { endSession(token); return null }
  if (Date.now() - r.seen > 60_000) db.prepare('UPDATE auth_sessions SET seen = ? WHERE token = ?').run(Date.now(), r.token)
  return { token, verified: r.verified, device: r.device }
}

export function endSession(token: string) { db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(sha(token)) }
export function markVerified(token: string) { db.prepare('UPDATE auth_sessions SET verified = ? WHERE token = ?').run(Date.now(), sha(token)) }
/** App 用指纹验过：这台手机打开的网页会话都算验过 */
export function markDeviceVerified(device: string) { db.prepare('UPDATE auth_sessions SET verified = ? WHERE device = ?').run(Date.now(), device) }
export function endDeviceSessions(device: string) { db.prepare('DELETE FROM auth_sessions WHERE device = ?').run(device) }

export const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

// 登录失败限流：同一个 IP 一分钟最多 8 次
const fails = new Map<string, number[]>()
export function tooManyFails(ip: string) {
  const now = Date.now()
  const list = (fails.get(ip) ?? []).filter((t) => now - t < 60_000)
  fails.set(ip, list)
  return list.length >= 8
}
export function noteFail(ip: string) { fails.set(ip, [...(fails.get(ip) ?? []), Date.now()]) }
