// 保险箱：凭证的值用 AES-256-GCM 加密存进数据库，密钥是数据目录里的 vault.key（0600，只有 Opero 自己的系统用户能读）。
// AI 执行器跑在另一个系统用户下，读不到数据目录；它只能通过 MCP 工具让 Opero 代它去连，结果回给它，值永远不给。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { cfg } from './config.ts'
import { db } from './db.ts'

const keyFile = path.join(cfg.data, 'vault.key')

function loadKey(): Buffer {
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32), { mode: 0o600 })
  const k = fs.readFileSync(keyFile)
  if (k.length !== 32) throw new Error(`保险箱密钥不对：${keyFile}`)
  return k
}
const key = loadKey()

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')
}

export function decrypt(enc: string): string {
  const b = Buffer.from(enc, 'base64')
  const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12))
  d.setAuthTag(b.subarray(12, 28))
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')
}

export function setSecret(id: string, value: string) {
  db.prepare('INSERT INTO secrets (id, enc) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET enc = excluded.enc').run(id, encrypt(value))
}
export function getSecret(id: string): string | undefined {
  const r = db.prepare('SELECT enc FROM secrets WHERE id = ?').get(id) as { enc: string } | undefined
  return r ? decrypt(r.enc) : undefined
}
export function hasSecret(id: string) { return !!db.prepare('SELECT 1 FROM secrets WHERE id = ?').get(id) }
export function delSecret(id: string) { db.prepare('DELETE FROM secrets WHERE id = ?').run(id) }

/** 从文字里去掉所有已知的密钥值（执行器输出、命令结果回给 AI / 网页前过一遍） */
export function scrub(text: string, values: (string | undefined)[]): string {
  let s = text
  for (const v of values) if (v && v.length >= 6) s = s.split(v).join('••••')
  return s
}
