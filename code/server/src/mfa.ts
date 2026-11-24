// 通行密钥（WebAuthn）和两步验证（TOTP），只用 Node 自带的 crypto：
//   通行密钥：登录（不用密码）、验证本人；只认 ES256 / RS256，不要证明（attestation none），一定要验证用户（指纹 / 面容 / PIN）。
//     域名 = 打开 Opero 的地址的主机名（要 HTTPS，localhost 除外）。挑战 32 字节、5 分钟、只用一次。签名计数要往上走。
//   两步验证：RFC 6238，SHA1、6 位、30 秒，前后各容一步；同一个时间步用过就不认（防重放）。密钥在保险箱里。
//     开的时候给 10 个恢复码（xxxx-xxxx，只存 sha256，用一个少一个）。开了以后密码登录还要输一个码。
import crypto from 'node:crypto'
import { kvGet, kvSet } from './db.ts'
import { delSecret, getSecret, setSecret } from './vault.ts'
import { owner, sha } from './auth.ts'

// ---------- 最小的 CBOR 解码（WebAuthn 用到的：整数、字节串、文本、数组、映射、简单值） ----------
function cbor(buf: Buffer): any {
  let i = 0
  const len = (ai: number): number => {
    if (ai < 24) return ai
    if (ai === 24) return buf[i++]
    if (ai === 25) { const v = buf.readUInt16BE(i); i += 2; return v }
    if (ai === 26) { const v = buf.readUInt32BE(i); i += 4; return v }
    if (ai === 27) { const v = Number(buf.readBigUInt64BE(i)); i += 8; return v }
    throw new Error('CBOR 长度不支持')
  }
  const item = (): any => {
    const b = buf[i++]
    const mt = b >> 5
    const ai = b & 31
    switch (mt) {
      case 0: return len(ai)
      case 1: return -1 - len(ai)
      case 2: { const n = len(ai); const v = buf.subarray(i, i + n); i += n; return Buffer.from(v) }
      case 3: { const n = len(ai); const v = buf.subarray(i, i + n).toString('utf8'); i += n; return v }
      case 4: { const n = len(ai); const a = []; for (let k = 0; k < n; k++) a.push(item()); return a }
      case 5: { const n = len(ai); const m = new Map<any, any>(); for (let k = 0; k < n; k++) { const key = item(); m.set(key, item()) } return m }
      case 7: return ai === 20 ? false : ai === 21 ? true : null
      default: throw new Error('CBOR 类型不支持')
    }
  }
  return item()
}

const b64u = (b: Buffer) => b.toString('base64url')
const unb64u = (s: string) => Buffer.from(String(s ?? ''), 'base64url')

// ---------- 通行密钥 ----------
export interface Passkey { id: string; pub: string; alg: number; counter: number; name: string; created: number; lastUsed?: number; rpId: string }
export const passkeys = () => kvGet<Passkey[]>('passkeys', [])
const savePasskeys = (l: Passkey[]) => kvSet('passkeys', l)

const challenges = new Map<string, { exp: number; kind: 'create' | 'get' }>()
function newChallenge(kind: 'create' | 'get') {
  const c = b64u(crypto.randomBytes(32))
  challenges.set(c, { exp: Date.now() + 5 * 60_000, kind })
  for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k)
  return c
}
function takeChallenge(c: string, kind: 'create' | 'get') {
  const v = challenges.get(c)
  challenges.delete(c)
  if (!v || v.exp < Date.now() || v.kind !== kind) throw new Error('验证过期了，再试一次')
}

/** 来源：浏览器发来的 Origin（要 https，localhost 例外）→ 域名 */
export function rpOf(origin: string | undefined): { origin: string; rpId: string } {
  let u: URL
  try { u = new URL(String(origin ?? '')) } catch { throw new Error('浏览器没带来源（Origin）') }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (u.protocol !== 'https:' && !local) throw new Error('通行密钥要用 HTTPS 打开 Opero 才能用')
  return { origin: u.origin, rpId: u.hostname }
}

export function registerOptions(origin: string | undefined, name: string) {
  const { rpId } = rpOf(origin)
  const o = owner()
  return {
    challenge: newChallenge('create'),
    rp: { id: rpId, name: 'Opero' },
    user: { id: b64u(crypto.createHash('sha256').update(o?.email ?? 'owner').digest().subarray(0, 16)), name: o?.email ?? 'owner', displayName: name || o?.name || '主人' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
    attestation: 'none',
    timeout: 120_000,
    excludeCredentials: passkeys().filter((p) => p.rpId === rpId).map((p) => ({ type: 'public-key', id: p.id })),
  }
}

function clientData(json: string, kind: 'webauthn.create' | 'webauthn.get', origin: string) {
  const cd = JSON.parse(unb64u(json).toString('utf8'))
  if (cd.type !== kind) throw new Error('类型不对')
  if (cd.origin !== origin) throw new Error('来源不对')
  takeChallenge(cd.challenge, kind === 'webauthn.create' ? 'create' : 'get')
}

function authData(buf: Buffer, rpId: string) {
  if (!buf.subarray(0, 32).equals(crypto.createHash('sha256').update(rpId).digest())) throw new Error('域名不对')
  const flags = buf[32]
  if (!(flags & 0x01)) throw new Error('没有确认在场')
  if (!(flags & 0x04)) throw new Error('没有验证用户（指纹 / 面容 / PIN）')
  return { flags, counter: buf.readUInt32BE(33), rest: buf.subarray(37) }
}

/** COSE 公钥 → SPKI（base64） */
function coseToSpki(m: Map<number, any>): { pub: string; alg: number } {
  const kty = m.get(1)
  const alg = m.get(3)
  let jwk: crypto.JsonWebKey
  if (kty === 2 && alg === -7 && m.get(-1) === 1) jwk = { kty: 'EC', crv: 'P-256', x: b64u(m.get(-2)), y: b64u(m.get(-3)) }
  else if (kty === 3 && alg === -257) jwk = { kty: 'RSA', n: b64u(m.get(-1)), e: b64u(m.get(-2)) }
  else throw new Error('这种密钥不支持（只认 ES256 / RS256）')
  const der = crypto.createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'der' })
  return { pub: der.toString('base64'), alg }
}

export function registerVerify(origin: string | undefined, body: any, name: string): Passkey {
  const { origin: o, rpId } = rpOf(origin)
  clientData(body?.response?.clientDataJSON, 'webauthn.create', o)
  const att = cbor(unb64u(body?.response?.attestationObject)) as Map<string, any>
  const ad = authData(att.get('authData'), rpId)
  if (!(ad.flags & 0x40)) throw new Error('没有带密钥')
  const credLen = ad.rest.readUInt16BE(16)
  const credId = ad.rest.subarray(18, 18 + credLen)
  const key = coseToSpki(cbor(ad.rest.subarray(18 + credLen)))
  const id = b64u(credId)
  const list = passkeys()
  if (list.some((p) => p.id === id)) throw new Error('这个通行密钥已经加过了')
  const pk: Passkey = { id, ...key, counter: ad.counter, name: name.slice(0, 40) || '通行密钥', created: Date.now(), rpId }
  savePasskeys([...list, pk])
  return pk
}

export function loginOptions(origin: string | undefined) {
  const { rpId } = rpOf(origin)
  const list = passkeys().filter((p) => p.rpId === rpId)
  if (!list.length) throw new Error('还没有在这个地址加过通行密钥：先用密码登录，到「我 → 账号安全」加一个')
  return { challenge: newChallenge('get'), rpId, userVerification: 'required', timeout: 120_000, allowCredentials: list.map((p) => ({ type: 'public-key', id: p.id })) }
}

/** 验一次通行密钥（登录 / 验证本人） */
export function assertVerify(origin: string | undefined, body: any): Passkey {
  const { origin: o, rpId } = rpOf(origin)
  const list = passkeys()
  const pk = list.find((p) => p.id === body?.id && p.rpId === rpId)
  if (!pk) throw new Error('不认识这个通行密钥')
  clientData(body?.response?.clientDataJSON, 'webauthn.get', o)
  const ad = unb64u(body?.response?.authenticatorData)
  const a = authData(ad, rpId)
  if (a.counter !== 0 && pk.counter !== 0 && a.counter <= pk.counter) throw new Error('签名计数不对（这个密钥可能被复制过）')
  const data = Buffer.concat([ad, crypto.createHash('sha256').update(unb64u(body?.response?.clientDataJSON)).digest()])
  const key = crypto.createPublicKey({ key: Buffer.from(pk.pub, 'base64'), format: 'der', type: 'spki' })
  const ok = pk.alg === -7 ? crypto.verify('sha256', data, { key, dsaEncoding: 'der' }, unb64u(body?.response?.signature)) : crypto.verify('sha256', data, key, unb64u(body?.response?.signature))
  if (!ok) throw new Error('签名不对')
  const next = { ...pk, counter: a.counter, lastUsed: Date.now() }
  savePasskeys(list.map((p) => (p.id === pk.id ? next : p)))
  return next
}

export function removePasskey(id: string) { savePasskeys(passkeys().filter((p) => p.id !== id)) }

// ---------- 两步验证（TOTP） ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function b32enc(b: Buffer) { let bits = ''; for (const x of b) bits += x.toString(2).padStart(8, '0'); let out = ''; for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out }
function b32dec(s: string) { let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) { const v = B32.indexOf(c); if (v >= 0) bits += v.toString(2).padStart(5, '0') } const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out) }
function totp(secret: Buffer, step: number) {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(step))
  const h = crypto.createHmac('sha1', secret).update(msg).digest()
  const o = h[h.length - 1] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

interface MfaState { enabled: boolean; recovery: string[]; lastStep?: number }
export const mfa = () => kvGet<MfaState>('mfa', { enabled: false, recovery: [] })
const SECRET_ID = 'mfa-totp'
const PENDING_ID = 'mfa-totp-pending'

/** 开两步验证第一步：生成密钥（还没生效），给 otpauth:// 地址和密钥原文 */
export function setup(): { secret: string; uri: string } {
  const secret = b32enc(crypto.randomBytes(20))
  setSecret(PENDING_ID, secret)
  const o = owner()
  const label = encodeURIComponent(`Opero:${o?.email ?? 'owner'}`)
  return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=Opero&algorithm=SHA1&digits=6&period=30` }
}

function checkCode(secretB32: string, code: string, st: MfaState): number | null {
  const now = Math.floor(Date.now() / 30_000)
  for (const d of [0, -1, 1]) {
    const step = now + d
    if (st.lastStep && step <= st.lastStep) continue
    if (totp(b32dec(secretB32), step) === code.replace(/\s/g, '')) return step
  }
  return null
}

/** 开两步验证第二步：输对一个码才生效，回 10 个恢复码（只显示这一次） */
export function enable(code: string): string[] {
  const pending = getSecret(PENDING_ID)
  if (!pending) throw new Error('先点「开两步验证」拿密钥')
  const step = checkCode(pending, code, { enabled: false, recovery: [] })
  if (step === null) throw new Error('码不对：看看手机时间准不准')
  setSecret(SECRET_ID, pending)
  delSecret(PENDING_ID)
  const codes = Array.from({ length: 10 }, () => { const r = crypto.randomBytes(4).toString('hex'); return `${r.slice(0, 4)}-${r.slice(4)}` })
  kvSet('mfa', { enabled: true, recovery: codes.map((c) => sha(c)), lastStep: step } satisfies MfaState)
  return codes
}

export function disable() { delSecret(SECRET_ID); kvSet('mfa', { enabled: false, recovery: [] } satisfies MfaState) }

/** 验一个码：6 位动态码，或者一个恢复码（用了就作废）；返回用的哪种 */
export function verifyCode(code: string): 'totp' | 'recovery' | null {
  const st = mfa()
  if (!st.enabled) return null
  const c = String(code ?? '').trim()
  const secret = getSecret(SECRET_ID)
  if (secret && /^\d{6}$/.test(c.replace(/\s/g, ''))) {
    const step = checkCode(secret, c, st)
    if (step !== null) { kvSet('mfa', { ...st, lastStep: step }); return 'totp' }
    return null
  }
  const h = sha(c.toLowerCase())
  if (st.recovery.includes(h)) { kvSet('mfa', { ...st, recovery: st.recovery.filter((x) => x !== h) }); return 'recovery' }
  return null
}

export function newRecovery(): string[] {
  const st = mfa()
  const codes = Array.from({ length: 10 }, () => { const r = crypto.randomBytes(4).toString('hex'); return `${r.slice(0, 4)}-${r.slice(4)}` })
  kvSet('mfa', { ...st, recovery: codes.map((c) => sha(c)) })
  return codes
}

// ---------- 密码登录后、还要输码的那一步：票 5 分钟、最多错 5 次 ----------
const tickets = new Map<string, { exp: number; fails: number }>()
export function newTicket() { const t = b64u(crypto.randomBytes(24)); tickets.set(t, { exp: Date.now() + 5 * 60_000, fails: 0 }); return t }
export function useTicket(t: string, ok: boolean): boolean {
  const v = tickets.get(t)
  if (!v || v.exp < Date.now()) { tickets.delete(t); throw new Error('登录过期了，重新输密码') }
  if (ok) { tickets.delete(t); return true }
  v.fails++
  if (v.fails >= 5) { tickets.delete(t); throw new Error('错太多次了，重新输密码') }
  return false
}
