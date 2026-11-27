// 消息助理：把你的邮箱（IMAP）、Slack 收进一个收件箱，AI 分成「要你看 / 知道就行 / 不重要」并写一句摘要；
// 要的话给回复建议（用对方的语言 + 中文意思），你自己复制去回。**从不替你发**（没有发送的工具）。
//   邮箱：每 2 分钟收一次（第一次只收最近 50 封、不提醒），只存发件人 / 主题 / 摘要，正文要看时现取；
//   Slack：用你自己建的 Slack App 的用户令牌（xoxp-），每 2 分钟看一轮会话；私聊和 @你 的算要你看。
//   你定的规则（发件人 / 关键词 → 分类）优先，AI 不改你和规则定过的。
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { all, db, get, kvGet, put, uid } from './db.ts'
import { emit, push } from './bus.ts'
import { getSecret } from './vault.ts'
import * as runner from './runner.ts'
import type { Credential } from './types.ts'
import * as egress from './egress.ts'

export interface Channel {
  id: string
  kind: 'email' | 'slack'
  name: string
  cred: string
  enabled: boolean
  /** 邮箱：IMAP 服务器 / 端口 / 账号（密码在凭证里） */
  imapHost?: string
  imapPort?: number
  user?: string
  /** Slack：工作区域名（拼原消息链接用）、我的用户 id */
  team?: string
  me?: string
  status?: 'ok' | 'error'
  error?: string
  lastSync?: number
  /** 邮箱收到哪一封了（UID）；Slack 每个会话看到哪条了 */
  lastUid?: number
  uidValidity?: string
  seen?: Record<string, string>
  convs?: { id: string; name: string; im: boolean; at: number }[]
}

export interface InboxItem {
  id: string
  ch: string
  kind: 'email' | 'slack'
  from: string
  fromAddr?: string
  subject: string
  snippet: string
  at: number
  /** 原消息的链接（Slack）/ 邮件的 Message-ID 和 UID（要看正文时现取） */
  url?: string
  messageId?: string
  uidNum?: number
  conv?: string
  mention?: boolean
  /** 分类：need 要你看 / fyi 知道就行 / skip 不重要；by = 谁分的（ai / rule / me） */
  cat?: 'need' | 'fyi' | 'skip'
  by?: 'ai' | 'rule' | 'me'
  summary?: string
  important?: boolean
  done?: boolean
  draft?: string
  tries?: number
}

const saveCh = (c: Channel) => { put('channels', c); emit({ t: 'put', coll: 'channels', item: pubCh(c) }); return c }
export const pubCh = (c: Channel) => { const { seen: _s, convs, ...rest } = c; return { ...rest, convCount: convs?.length ?? 0 } }

function saveItem(i: InboxItem) {
  db.prepare('INSERT INTO inbox (id, ch, ts, data) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data').run(i.id, i.ch, i.at, JSON.stringify(i))
  emit({ t: 'inbox', item: i })
  return i
}
export function getItem(id: string): InboxItem | undefined {
  const r = db.prepare('SELECT data FROM inbox WHERE id = ?').get(id) as { data: string } | undefined
  return r ? JSON.parse(r.data) : undefined
}
export function list(o: { cat?: string; limit?: number; before?: number } = {}): InboxItem[] {
  const rows = db.prepare('SELECT data FROM inbox WHERE ts < ? ORDER BY ts DESC LIMIT ?').all(o.before || Date.now() + 86400_000, Math.min(o.limit ?? 200, 500)) as { data: string }[]
  return rows.map((r) => JSON.parse(r.data) as InboxItem).filter((i) => !o.cat || (o.cat === 'open' ? i.cat === 'need' && !i.done : i.cat === o.cat))
}
const exists = (id: string) => !!db.prepare('SELECT 1 FROM inbox WHERE id = ?').get(id)

// ---------- 规则：发件人 / 关键词 → 分类（你定的，AI 不改） ----------
interface Rule { match: string; cat: 'need' | 'fyi' | 'skip' }
function byRule(i: InboxItem): Rule['cat'] | undefined {
  const rules = kvGet<{ inboxRules?: Rule[] }>('settings', {}).inboxRules ?? []
  const hay = `${i.fromAddr ?? ''} ${i.from} ${i.subject}`.toLowerCase()
  return rules.find((r) => r.match && hay.includes(r.match.toLowerCase()))?.cat
}

function add(i: InboxItem, quiet: boolean) {
  const r = byRule(i)
  if (r) { i.cat = r; i.by = 'rule' }
  else if (i.kind === 'slack' && i.mention) { i.cat = 'need'; i.by = 'rule' } // 私聊和 @我 的一定要看
  saveItem(i)
  if (!quiet && i.cat === 'need') push({ kind: 'info', title: `${i.from}：${i.subject.slice(0, 40)}`, body: i.snippet.slice(0, 120), route: 'inbox' })
}

// ---------- 邮箱（IMAP） ----------
/** 连 IMAP：连不上记进「最近连不上的」，报错带上去哪换出口 */
async function imapConnect(client: ImapFlow, c: Channel) {
  try { await client.connect() } catch (e) {
    const err = (e as { _err?: unknown })._err ?? e
    if (egress.netErr(err)) egress.noteFail(c.imapHost!, c.imapPort || 993, `收件箱「${c.name}」`, err)
    throw new Error(egress.hint(c.imapHost!, err))
  }
}
async function pollEmail(c: Channel) {
  const pass = getSecret(c.cred)
  const cred = get<Credential>('credentials', c.cred)
  if (!pass || !c.imapHost) throw new Error('邮箱的服务器或密码没配好')
  const client = new ImapFlow({ host: c.imapHost, port: c.imapPort || 993, secure: (c.imapPort || 993) === 993, auth: { user: c.user || cred?.user || '', pass }, logger: false, socketTimeout: 60_000, proxy: egress.proxyFor(c.imapHost) })
  await imapConnect(client, c)
  try {
    const box = await client.mailboxOpen('INBOX', { readOnly: true })
    const validity = String(box.uidValidity)
    const first = !c.lastUid || c.uidValidity !== validity
    let from = first ? Math.max(1, Number(box.uidNext) - 50) : c.lastUid! + 1
    if (!first && Number(box.uidNext) - from > 200) from = Number(box.uidNext) - 200
    let maxUid = c.lastUid ?? 0
    if (Number(box.uidNext) > from) {
      for await (const m of client.fetch(`${from}:*`, { uid: true, envelope: true, internalDate: true, size: true, source: { start: 0, maxLength: 200_000 } }, { uid: true })) {
        if (m.uid <= (first ? 0 : c.lastUid ?? 0)) continue
        maxUid = Math.max(maxUid, m.uid)
        const id = `m-${c.id}-${validity}-${m.uid}`
        if (exists(id)) continue
        const env = m.envelope
        let snippet = ''
        try { const p = await simpleParser(m.source as Buffer); snippet = (p.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 400) } catch { /* 解不开就只有主题 */ }
        const fromA = env?.from?.[0]
        add({ id, ch: c.id, kind: 'email', from: fromA?.name || fromA?.address || '?', fromAddr: fromA?.address, subject: env?.subject || '（没有主题）', snippet, at: new Date(m.internalDate ?? Date.now()).getTime(), messageId: env?.messageId, uidNum: m.uid }, first)
      }
    }
    saveCh({ ...get<Channel>('channels', c.id)!, lastUid: maxUid, uidValidity: validity, status: 'ok', error: undefined, lastSync: Date.now() })
  } finally { await client.logout().catch(() => {}) }
}

/** 看邮件正文（现从邮箱取，不存） */
export async function emailBody(i: InboxItem): Promise<string> {
  const c = get<Channel>('channels', i.ch)
  const pass = c && getSecret(c.cred)
  if (!c || !pass || !i.uidNum) throw new Error('取不到原邮件')
  const cred = get<Credential>('credentials', c.cred)
  const client = new ImapFlow({ host: c.imapHost!, port: c.imapPort || 993, secure: (c.imapPort || 993) === 993, auth: { user: c.user || cred?.user || '', pass }, logger: false, proxy: egress.proxyFor(c.imapHost!) })
  await imapConnect(client, c)
  try {
    await client.mailboxOpen('INBOX', { readOnly: true })
    const m = await client.fetchOne(String(i.uidNum), { source: { start: 0, maxLength: 5_000_000 } }, { uid: true })
    if (!m || !m.source) throw new Error('邮件不在了')
    const p = await simpleParser(m.source)
    return (p.text ?? '').slice(0, 20_000)
  } finally { await client.logout().catch(() => {}) }
}

// ---------- Slack（用户令牌，轮询） ----------
async function slack(token: string, method: string, params: Record<string, string | number> = {}): Promise<any> {
  const r = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
  const j: any = await r.json().catch(() => ({}))
  if (r.status === 429) throw new Error('Slack 限流了，等一会儿')
  if (!j.ok) throw new Error(`Slack：${j.error ?? r.status}`)
  return j
}
export async function slackCheck(token: string): Promise<{ team: string; me: string; name: string }> {
  if (!token.startsWith('xoxp-')) throw new Error('要用户令牌（xoxp- 开头），不是机器人令牌')
  const a = await slack(token, 'auth.test')
  const host = String(a.url ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')
  return { team: host, me: a.user_id, name: a.team }
}
async function pollSlack(c: Channel) {
  const token = getSecret(c.cred)
  if (!token) throw new Error('Slack 的令牌没配好')
  let convs = c.convs ?? []
  if (!convs.length || Date.now() - (c.lastSync ?? 0) > 15 * 60_000 || !c.convs) {
    const j = await slack(token, 'users.conversations', { types: 'im,mpim,public_channel,private_channel', exclude_archived: 'true', limit: 200 })
    convs = (j.channels ?? []).map((x: any) => ({ id: x.id, name: x.name ?? (x.is_im ? '私聊' : x.id), im: !!x.is_im || !!x.is_mpim, at: convs.find((o) => o.id === x.id)?.at ?? 0 }))
  }
  const seen = { ...(c.seen ?? {}) }
  const first = !c.lastSync
  const users = new Map<string, string>()
  const who = async (u: string) => {
    if (!u) return '?'
    if (!users.has(u)) { try { const j = await slack(token, 'users.info', { user: u }); users.set(u, j.user?.real_name || j.user?.name || u) } catch { users.set(u, u) } }
    return users.get(u)!
  }
  // 最近有动静的先看；每轮最多 25 个会话
  for (const cv of [...convs].sort((a, b) => b.at - a.at).slice(0, 25)) {
    const oldest = seen[cv.id] ?? String(first ? Date.now() / 1000 - 3600 : Date.now() / 1000 - 86400)
    let j: any
    try { j = await slack(token, 'conversations.history', { channel: cv.id, oldest, limit: 30 }) } catch (e) { if (/限流/.test((e as Error).message)) break; continue }
    const msgs: any[] = (j.messages ?? []).filter((m: any) => m.ts && !m.subtype && m.user !== c.me)
    if (!msgs.length) continue
    seen[cv.id] = msgs.reduce((mx: string, m: any) => (Number(m.ts) > Number(mx) ? m.ts : mx), oldest)
    cv.at = Date.now()
    for (const m of msgs.reverse()) {
      const id = `s-${c.id}-${cv.id}-${m.ts}`
      if (exists(id)) continue
      const text = String(m.text ?? '')
      const mention = cv.im || text.includes(`<@${c.me}>`) || /<!(here|channel)>/.test(text)
      const link = c.team ? `https://${c.team}/archives/${cv.id}/p${String(m.ts).replace('.', '')}${m.thread_ts && m.thread_ts !== m.ts ? `?thread_ts=${m.thread_ts}&cid=${cv.id}` : ''}` : undefined
      add({ id, ch: c.id, kind: 'slack', from: await who(m.user), subject: cv.im ? '私聊' : `#${cv.name}`, snippet: text.replace(/\s+/g, ' ').slice(0, 400), at: Math.round(Number(m.ts) * 1000), url: link, conv: cv.id, mention }, first)
    }
  }
  saveCh({ ...get<Channel>('channels', c.id)!, convs, seen, status: 'ok', error: undefined, lastSync: Date.now() })
}

// ---------- 轮询：每 2 分钟收一轮，每分钟让 AI 分一批 ----------
let polling = false
async function tick() {
  if (polling) return
  polling = true
  try {
    for (const c of all<Channel>('channels').filter((x) => x.enabled)) {
      if (Date.now() - (c.lastSync ?? 0) < 110_000) continue
      try { await (c.kind === 'email' ? pollEmail(c) : pollSlack(c)) } catch (e) { saveCh({ ...get<Channel>('channels', c.id)!, status: 'error', error: (e as Error).message.slice(0, 300), lastSync: Date.now() }) }
    }
    await classify().catch(() => {})
    // 只留 60 天
    db.prepare('DELETE FROM inbox WHERE ts < ?').run(Date.now() - 60 * 86400_000)
  } finally { polling = false }
}
export function start() { setTimeout(tick, 15_000); setInterval(tick, 60_000).unref() }

/** AI 分类：每批最多 15 条（规则 / 你定过的不动），每条最多试 3 次 */
async function classify() {
  const todo = list({ limit: 300 }).filter((i) => !i.cat && (i.tries ?? 0) < 3 && Date.now() - i.at < 14 * 86400_000).slice(0, 15)
  if (!todo.length) return
  const habits = kvGet<{ habits?: string }>('settings', {}).habits ?? ''
  const prompt = [
    '你是主人的消息助理。下面是收进来的邮件 / Slack 消息，逐条判断：',
    '- cat：need（要主人看或处理：直接找他、要回复、要决定、有截止时间）、fyi（知道就行：通知、周报、抄送）、skip（不重要：广告、营销、自动通知、垃圾）',
    '- summary：一句话中文摘要（30 字以内，说清谁要什么）',
    '- important：true / false（很急或很重要）',
    habits && `主人的习惯：\n${habits}`,
    '只输出一个 JSON 数组，不要别的字：[{"id":"…","cat":"need","summary":"…","important":false}]',
    '',
    JSON.stringify(todo.map((i) => ({ id: i.id, from: `${i.from}${i.fromAddr ? ` <${i.fromAddr}>` : ''}`, where: i.subject, text: i.snippet.slice(0, 500), mention: i.mention }))),
  ].filter(Boolean).join('\n')
  let out = ''
  try { out = await runner.oneShot(prompt) } catch { for (const i of todo) saveItem({ ...i, tries: (i.tries ?? 0) + 1 }); return }
  let arr: any[] = []
  try { arr = JSON.parse(out.slice(out.indexOf('['), out.lastIndexOf(']') + 1)) } catch { /* 下面按没分处理 */ }
  for (const i of todo) {
    const r = arr.find((x) => x?.id === i.id)
    const cat = ['need', 'fyi', 'skip'].includes(r?.cat) ? r.cat : undefined
    const next: InboxItem = cat ? { ...i, cat, by: 'ai', summary: String(r.summary ?? '').slice(0, 120), important: !!r.important } : { ...i, tries: (i.tries ?? 0) + 1 }
    saveItem(next)
    if (cat === 'need' && (r.important || i.kind === 'email')) push({ kind: 'info', title: `${i.from}：${String(r.summary ?? i.subject).slice(0, 60)}`, body: i.subject.slice(0, 80), route: 'inbox' })
  }
}

/** 你改分类 / 标处理过 */
export function mark(id: string, p: { cat?: InboxItem['cat']; done?: boolean }): InboxItem {
  const i = getItem(id)
  if (!i) throw new Error('没有这条')
  return saveItem({ ...i, ...(p.cat ? { cat: p.cat, by: 'me' as const } : {}), ...(p.done !== undefined ? { done: p.done } : {}) })
}

/** 回复建议：用对方的语言写，附中文意思；只存草稿，不发 */
export async function draft(id: string, hint = ''): Promise<InboxItem> {
  const i = getItem(id)
  if (!i) throw new Error('没有这条')
  let body = i.snippet
  if (i.kind === 'email') { try { body = await emailBody(i) } catch { /* 用摘要 */ } }
  const habits = kvGet<{ habits?: string }>('settings', {}).habits ?? ''
  const out = await runner.oneShot([
    '你是主人的消息助理。替主人起草一条回复（主人自己复制去发，你不发）。',
    '用对方用的语言写；回复写完后另起一行写「——中文意思：」加中文翻译（对方本来就是中文就不用）。只输出回复本身。',
    habits && `主人的习惯：\n${habits}`,
    hint && `主人的要求：${hint}`,
    `来自：${i.from}${i.fromAddr ? ` <${i.fromAddr}>` : ''}\n在：${i.subject}\n内容：\n${body.slice(0, 6000)}`,
  ].filter(Boolean).join('\n\n'))
  return saveItem({ ...i, draft: out.slice(0, 8000) })
}

export const newChannelId = () => uid('ch')
