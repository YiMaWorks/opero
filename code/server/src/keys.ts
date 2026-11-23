// 指纹（ed25519，和 SSH 一样的 SHA256:… 写法）：
//   Opero 自己一对密钥（数据目录 opero_ed25519.pem，0600）：派给 Agent 的活都签名，Agent 认这个指纹才执行——换了地址（迁移）指纹不变就无痕接上；别人冒充地址也执行不了。
//   每台 Agent 自己一对密钥（私钥不出那台机器）：每个请求都签名，Opero 按指纹认机器，不靠地址、不靠一次性令牌。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { cfg } from './config.ts'

const file = path.join(cfg.data, 'opero_ed25519.pem')
function load(): crypto.KeyObject {
  if (!fs.existsSync(file)) {
    const { privateKey } = crypto.generateKeyPairSync('ed25519')
    fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  }
  return crypto.createPrivateKey(fs.readFileSync(file))
}
const priv = load()
const pub = crypto.createPublicKey(priv)

/** 公钥的原始 32 字节（base64） */
export const rawPub = (k: crypto.KeyObject) => (k.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32).toString('base64')
export const fingerprint = (rawB64: string) => 'SHA256:' + crypto.createHash('sha256').update(Buffer.from(rawB64, 'base64')).digest('base64').replace(/=+$/, '')

export const SERVER_PUB = rawPub(pub)
export const SERVER_FP = fingerprint(SERVER_PUB)
export const sign = (data: string | Buffer) => crypto.sign(null, Buffer.from(data), priv).toString('base64')

/** 用 Agent 的公钥（原始 32 字节 base64）验签名 */
export function verify(rawB64: string, data: string | Buffer, sigB64: string) {
  try {
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(rawB64, 'base64')])
    const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' })
    return crypto.verify(null, Buffer.from(data), key, Buffer.from(sigB64, 'base64'))
  } catch { return false }
}

/** Agent 请求要签的内容：方法、路径（带查询）、时间、请求体的 sha256 */
export const agentPayload = (method: string, url: string, ts: string, body: Buffer) =>
  `${method}\n${url}\n${ts}\n${crypto.createHash('sha256').update(body).digest('hex')}`
