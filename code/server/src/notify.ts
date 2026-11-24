// 提醒发到外部渠道（不装 App 也能收到）：邮件（SMTP）、Telegram 机器人、Slack / 企业微信 / 钉钉 / 飞书 群机器人、通用 Webhook（带签名）。
// 每个渠道选发哪些：要你决定的 / 出错的 / 全部。同样的提醒 10 分钟内不重复；发失败（网络、5xx、限流）隔 1、2、4 分钟重试，最多 3 次。
// 渠道的密钥（机器人令牌、Webhook 地址、SMTP 密码）都在保险箱里（notifier.cred 指向凭证）。
import crypto from 'node:crypto'
import nodemailer from 'nodemailer'
import { cfg } from './config.ts'
import { all, get, put } from './db.ts'
import { emit, pushHooks, type PushItem } from './bus.ts'
import { audit } from './chat.ts'
import { getSecret } from './vault.ts'
import type { Credential } from './types.ts'

export type NotifierKind = 'email' | 'telegram' | 'slack' | 'wecom' | 'dingtalk' | 'feishu' | 'webhook'
export interface Notifier {
  id: string
  kind: NotifierKind
  name: string
  /** 发哪些：decide = 要你决定的；error = 出错的（发布失败、执行器出错）；all = 全部提醒 */
  events: ('decide' | 'error' | 'all')[]
  enabled: boolean
  /** 密钥在哪个凭证：Telegram = 机器人令牌；Slack / 企业微信 / 钉钉 / 飞书 / Webhook = 机器人地址（钉钉 / 飞书加签的密钥填凭证的用户名）；邮件 = SMTP 密码 */
  cred: string
  /** Telegram 的 chat_id；邮件：SMTP 服务器、端口、账号、发给谁 */
  chatId?: string
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  to?: string
  lastOk?: number
  lastError?: string
}

interface Msg { title: string; body: string; level: 'decide' | 'error' | 'info'; link: string }

const recent = new Map<string, number>()

pushHooks.push((item) => {
  const level: Msg['level'] = item.kind === 'decide' && !item.error ? 'decide' : item.error || item.kind === 'alarm' ? 'error' : 'info'
  const key = `${item.title}\n${item.body ?? ''}`
  const now = Date.now()
  if ((recent.get(key) ?? 0) > now - 10 * 60_000) return
  recent.set(key, now)
  for (const [k, t] of recent) if (t < now - 10 * 60_000) recent.delete(k)
  const msg: Msg = { title: item.title, body: item.body ?? '', level, link: cfg.publicUrl || '' }
  for (const n of all<Notifier>('notifiers')) {
    if (!n.enabled) continue
    if (!n.events.includes('all') && !n.events.includes(level as 'decide' | 'error')) continue
    deliver(n, msg, 1)
  }
})

function deliver(n: Notifier, m: Msg, attempt: number) {
  send(n, m).then(() => mark(n.id, undefined)).catch((e: Error & { retry?: boolean }) => {
    if (e.retry && attempt < 3) setTimeout(() => deliver(n, m, attempt + 1), 2 ** (attempt - 1) * 60_000).unref()
    else mark(n.id, e.message)
  })
}

function mark(id: string, error?: string) {
  const n = get<Notifier>('notifiers', id)
  if (!n) return
  const next = { ...n, ...(error ? { lastError: error.slice(0, 300) } : { lastOk: Date.now(), lastError: undefined }) }
  put('notifiers', next)
  emit({ t: 'put', coll: 'notifiers', item: pub(next) })
}

export const pub = (n: Notifier) => ({ ...n, credName: get<Credential>('credentials', n.cred)?.name })

const LEVEL = { decide: '要你决定', error: '出错了', info: '提醒' }

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<any> {
  let r: Response
  try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body), signal: AbortSignal.timeout(15_000) }) } catch (e) { throw Object.assign(new Error(`连不上：${(e as Error).message}`), { retry: true }) }
  const text = await r.text()
  let j: any = {}
  try { j = JSON.parse(text) } catch { /* 有的只回 ok */ }
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} ${text.slice(0, 200)}`), { retry: r.status >= 500 || r.status === 429 })
  // 企业微信 / 钉钉 / 飞书：HTTP 200 但 errcode / code 不是 0
  if ((j.errcode && j.errcode !== 0) || (j.code && j.code !== 0) || j.ok === false) throw Object.assign(new Error(`${j.errmsg ?? j.msg ?? j.description ?? JSON.stringify(j).slice(0, 200)}`), { retry: false })
  return j
}

export async function send(n: Notifier, m: Msg): Promise<void> {
  const c = get<Credential>('credentials', n.cred)
  const secret = getSecret(n.cred)
  if (!c || !secret) throw new Error('这个渠道用的凭证不在了')
  const head = `【Opero · ${LEVEL[m.level]}】${m.title}`
  const text = `${head}${m.body ? `\n${m.body}` : ''}${m.link ? `\n${m.link}` : ''}`
  switch (n.kind) {
    case 'telegram':
      await post(`https://api.telegram.org/bot${secret}/sendMessage`, { chat_id: n.chatId, text, disable_web_page_preview: true })
      return
    case 'slack':
      await post(secret, { text })
      return
    case 'wecom':
      await post(secret, { msgtype: 'markdown', markdown: { content: `**${head}**\n${m.body}${m.link ? `\n[打开 Opero](${m.link})` : ''}` } })
      return
    case 'dingtalk': {
      // 加签：timestamp + "\n" + 密钥，HMAC-SHA256，base64 再 URL 编码（密钥放凭证的用户名里；没开加签就留空）
      let url = secret
      if (c.user) {
        const ts = Date.now()
        const sign = crypto.createHmac('sha256', c.user).update(`${ts}\n${c.user}`).digest('base64')
        url += `${url.includes('?') ? '&' : '?'}timestamp=${ts}&sign=${encodeURIComponent(sign)}`
      }
      await post(url, { msgtype: 'markdown', markdown: { title: head, text: `**${head}**\n\n${m.body}${m.link ? `\n\n[打开 Opero](${m.link})` : ''}` } })
      return
    }
    case 'feishu': {
      const ts = Math.floor(Date.now() / 1000)
      const sign = c.user ? crypto.createHmac('sha256', `${ts}\n${c.user}`).update('').digest('base64') : undefined
      await post(secret, { ...(sign ? { timestamp: String(ts), sign } : {}), msg_type: 'text', content: { text } })
      return
    }
    case 'webhook': {
      const body = JSON.stringify({ title: m.title, body: m.body, level: m.level, link: m.link, at: new Date().toISOString() })
      const ts = String(Date.now())
      const sig = c.user ? crypto.createHmac('sha256', c.user).update(`${ts}.${body}`).digest('hex') : ''
      await post(secret, body, { 'X-Opero-Ts': ts, ...(sig ? { 'X-Opero-Signature': `sha256=${sig}` } : {}) })
      return
    }
    case 'email': {
      if (!n.smtpHost || !n.to) throw new Error('邮件渠道要填 SMTP 服务器和收件人')
      const port = n.smtpPort || 465
      const t = nodemailer.createTransport({ host: n.smtpHost, port, secure: port === 465, auth: { user: n.smtpUser || c.user || '', pass: secret }, connectionTimeout: 15_000 })
      try {
        await t.sendMail({ from: n.smtpUser || c.user, to: n.to, subject: head, text: `${m.body}${m.link ? `\n\n${m.link}` : ''}` })
      } catch (e) { throw Object.assign(new Error((e as Error).message), { retry: /ETIMEDOUT|ECONNRESET|ECONNREFUSED|421|451/.test((e as Error).message) }) }
      return
    }
  }
}

/** 网页「发一条试试」 */
export async function test(id: string): Promise<void> {
  const n = get<Notifier>('notifiers', id)
  if (!n) throw new Error('没有这个渠道')
  try {
    await send(n, { title: '测试提醒', body: '这是一条测试：收到说明这个渠道能用。', level: 'info', link: cfg.publicUrl || '' })
    mark(id)
    audit({ via: '—', action: 'notify.test', target: n.name, level: '读', result: '成功', how: '本人' })
  } catch (e) { mark(id, (e as Error).message); throw e }
}
