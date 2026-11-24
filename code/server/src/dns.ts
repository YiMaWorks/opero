// DNS：主人在「域名」里登记域名（哪家：Cloudflare / 阿里云，用哪个凭证），再在员工档案里给员工开哪些域名。
// 员工用 dns_list / dns_set / dns_delete 改解析；账号在保险箱里，员工拿不到。
//   Cloudflare：API 令牌（凭证的值）；阿里云：AccessKey（凭证的用户名 = AccessKeyId，值 = AccessKeySecret），RPC 签名 v1（HMAC-SHA1）。
import crypto from 'node:crypto'
import { get } from './db.ts'
import { getSecret } from './vault.ts'
import type { Credential } from './types.ts'

export interface Domain { id: string; domain: string; provider: 'cloudflare' | 'aliyun'; cred: string }
export interface DnsRecord { id: string; rr: string; type: string; value: string; ttl: number; priority?: number; proxied?: boolean }

export const TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA']

/** 检查要写的记录；不对返回原因 */
export function check(r: { rr: string; type: string; value: string; ttl?: number; priority?: number }): string {
  if (!TYPES.includes(r.type)) return `类型只能是 ${TYPES.join(' / ')}`
  if (!/^(@|\*|(\*\.)?[a-zA-Z0-9_]([a-zA-Z0-9_-]{0,62})(\.[a-zA-Z0-9_]([a-zA-Z0-9_-]{0,62}))*)$/.test(r.rr)) return '主机记录不对（@ 代表根域名，比如 www、api、*.app）'
  if (!r.value || r.value.length > 512) return '记录值不能空、最长 512'
  if (r.type === 'A' && !/^(\d{1,3}\.){3}\d{1,3}$/.test(r.value)) return 'A 记录要填 IPv4 地址'
  if (r.type === 'AAAA' && !/^[0-9a-fA-F:]+$/.test(r.value)) return 'AAAA 记录要填 IPv6 地址'
  if (r.type === 'MX' && r.priority !== undefined && (r.priority < 1 || r.priority > 50)) return 'MX 优先级 1～50'
  return ''
}

function creds(d: Domain): { c: Credential; secret: string } {
  const c = get<Credential>('credentials', d.cred)
  const secret = getSecret(d.cred)
  if (!c || !secret) throw new Error(`域名 ${d.domain} 用的凭证不在了`)
  return { c, secret }
}

// ---------- Cloudflare ----------
async function cf(token: string, method: string, p: string, body?: unknown): Promise<any> {
  const r = await fetch(`https://api.cloudflare.com/client/v4${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok || j.success === false) throw new Error(`Cloudflare：${(j.errors ?? []).map((e: any) => e.message).join('；') || r.status}`)
  return j.result
}
const zoneCache = new Map<string, string>()
async function zone(token: string, domain: string): Promise<string> {
  const k = `${domain}:${token.slice(-6)}`
  if (zoneCache.has(k)) return zoneCache.get(k)!
  const z = await cf(token, 'GET', `/zones?name=${encodeURIComponent(domain)}`)
  if (!z?.[0]?.id) throw new Error(`Cloudflare 里没有 ${domain}（或者令牌没这个域名的权限）`)
  zoneCache.set(k, z[0].id)
  return z[0].id
}
const fqdn = (rr: string, domain: string) => (rr === '@' ? domain : `${rr}.${domain}`)
const rrOf = (name: string, domain: string) => (name === domain ? '@' : name.endsWith('.' + domain) ? name.slice(0, -domain.length - 1) : name)

// ---------- 阿里云（alidns 2015-01-09，RPC 签名 v1） ----------
const pct = (s: string) => encodeURIComponent(s).replace(/!/g, '%21').replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\*/g, '%2A')
async function ali(keyId: string, secret: string, action: string, params: Record<string, string | number>): Promise<any> {
  const all: Record<string, string> = {
    Format: 'JSON', Version: '2015-01-09', AccessKeyId: keyId, SignatureMethod: 'HMAC-SHA1', SignatureVersion: '1.0', SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), Action: action, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  }
  const qs = Object.keys(all).sort().map((k) => `${pct(k)}=${pct(all[k])}`).join('&')
  const sig = crypto.createHmac('sha1', `${secret}&`).update(`GET&%2F&${pct(qs)}`).digest('base64')
  const r = await fetch(`https://alidns.aliyuncs.com/?${qs}&Signature=${pct(sig)}`, { signal: AbortSignal.timeout(20_000) })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok || j.Code) throw new Error(`阿里云：${j.Message ?? j.Code ?? r.status}`)
  return j
}

export async function list(d: Domain): Promise<DnsRecord[]> {
  const { c, secret } = creds(d)
  if (d.provider === 'cloudflare') {
    const z = await zone(secret, d.domain)
    const rs = await cf(secret, 'GET', `/zones/${z}/dns_records?per_page=500`)
    return (rs ?? []).map((x: any) => ({ id: x.id, rr: rrOf(x.name, d.domain), type: x.type, value: x.content, ttl: x.ttl, priority: x.priority, proxied: x.proxied }))
  }
  const j = await ali(c.user ?? '', secret, 'DescribeDomainRecords', { DomainName: d.domain, PageSize: 500 })
  return (j.DomainRecords?.Record ?? []).map((x: any) => ({ id: x.RecordId, rr: x.RR, type: x.Type, value: x.Value, ttl: x.TTL, priority: x.Priority }))
}

/** 有同主机记录 + 类型的就改，没有就加；返回改前 / 改后 */
export async function set(d: Domain, r: { rr: string; type: string; value: string; ttl?: number; priority?: number }): Promise<{ before?: DnsRecord; after: DnsRecord }> {
  const bad = check(r)
  if (bad) throw new Error(bad)
  const { c, secret } = creds(d)
  const old = (await list(d)).find((x) => x.rr === r.rr && x.type === r.type)
  if (d.provider === 'cloudflare') {
    const z = await zone(secret, d.domain)
    const ttl = r.ttl && r.ttl >= 60 ? Math.min(r.ttl, 86400) : 1
    const body = { type: r.type, name: fqdn(r.rr, d.domain), content: r.value, ttl, ...(r.type === 'MX' ? { priority: r.priority ?? 10 } : {}), ...(old?.proxied !== undefined ? { proxied: old.proxied } : {}) }
    const x = old ? await cf(secret, 'PUT', `/zones/${z}/dns_records/${old.id}`, body) : await cf(secret, 'POST', `/zones/${z}/dns_records`, body)
    return { before: old, after: { id: x.id, rr: r.rr, type: r.type, value: r.value, ttl } }
  }
  const ttl = [600, 1800, 3600, 43200, 86400].includes(Number(r.ttl)) ? Number(r.ttl) : 600
  const base = { RR: r.rr, Type: r.type, Value: r.value, TTL: ttl, ...(r.type === 'MX' ? { Priority: r.priority ?? 10 } : {}) }
  const j = old ? await ali(c.user ?? '', secret, 'UpdateDomainRecord', { RecordId: old.id, ...base }) : await ali(c.user ?? '', secret, 'AddDomainRecord', { DomainName: d.domain, ...base })
  return { before: old, after: { id: j.RecordId ?? old?.id, rr: r.rr, type: r.type, value: r.value, ttl } }
}

export async function remove(d: Domain, id: string): Promise<DnsRecord | undefined> {
  const { c, secret } = creds(d)
  const old = (await list(d)).find((x) => x.id === id)
  if (!old) throw new Error('没有这条记录（dns_list 看 id）')
  if (d.provider === 'cloudflare') await cf(secret, 'DELETE', `/zones/${await zone(secret, d.domain)}/dns_records/${id}`)
  else await ali(c.user ?? '', secret, 'DeleteDomainRecord', { RecordId: id })
  return old
}
