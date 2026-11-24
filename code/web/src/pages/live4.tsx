// 真的一套：消息渠道（收：邮箱、Slack；发提醒：邮件、Telegram、Slack、企业微信、钉钉、飞书、Webhook）、收件箱
import { useState } from 'react'
import type { InboxItem, InChannel, Notifier } from '../types'
import { toast, useStore } from '../store'
import { call } from '../live'
import { Empty, Field, PageHeader, Row, Section, Segmented, Sheet, Tag, Toggle } from '../components/ui'
import { Markdown } from '../components/Markdown'
import { headNav, type PageProps } from './nav'

const NK: Record<Notifier['kind'], { label: string; credHint: string }> = {
  telegram: { label: 'Telegram', credHint: '凭证的值填机器人令牌（找 @BotFather 建机器人拿）' },
  slack: { label: 'Slack', credHint: '凭证的值填 Incoming Webhook 地址' },
  wecom: { label: '企业微信群', credHint: '凭证的值填群机器人的 Webhook 地址' },
  dingtalk: { label: '钉钉群', credHint: '凭证的值填机器人 Webhook 地址；开了加签就把密钥填凭证的用户名' },
  feishu: { label: '飞书群', credHint: '凭证的值填机器人 Webhook 地址；开了签名校验就把密钥填凭证的用户名' },
  email: { label: '邮件', credHint: '凭证的值填 SMTP 密码 / 授权码，用户名填发件邮箱' },
  webhook: { label: 'Webhook', credHint: '凭证的值填你的地址；用户名填签名密钥（可选，X-Opero-Signature = sha256 HMAC）' },
}
const EV = [{ value: 'decide', label: '要你决定的' }, { value: 'error', label: '出错的' }, { value: 'all', label: '全部' }] as const

// ======================= 消息渠道 =======================
export function LiveChannelsPage({ nav }: PageProps) {
  const chans = useStore((s) => s.inChannels)
  const nts = useStore((s) => s.notifiers)
  const creds = useStore((s) => s.credentials)
  const [addIn, setAddIn] = useState<null | 'email' | 'slack'>(null)
  const [addOut, setAddOut] = useState<Notifier['kind'] | null>(null)
  const ago = (t?: number) => (t ? new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '还没收过')
  return (
    <div className="page">
      <PageHeader title="消息渠道" sub="收消息进收件箱；提醒发到外面（不装 App 也收得到）" {...headNav(nav)} />
      <div className="page-body">
        <Section title={`收消息 · ${chans.length}`} right={<span className="row-actions"><button className="btn ghost sm" onClick={() => setAddIn('email')}>+ 邮箱</button><button className="btn ghost sm" onClick={() => setAddIn('slack')}>+ Slack</button></span>}>
          {chans.length === 0 && <Empty>还没有：接上邮箱或 Slack，消息助理帮你分「要你看 / 知道就行」，要的话写回复建议（只写，不替你发）</Empty>}
          {chans.map((c) => (
            <Row key={c.id} title={<>{c.kind === 'email' ? '邮箱' : 'Slack'} · {c.name} {c.status === 'error' ? <Tag tone="danger">收不了</Tag> : null}</>}
              sub={c.error ? <span data-no-i18n="">{c.error}</span> : `上次收：${ago(c.lastSync)}`}
              right={<span className="row-actions"><Toggle on={c.enabled} onChange={(v) => call('PUT', `/api/channels/${c.id}`, { enabled: v })} /><button className="btn ghost sm" onClick={() => { if (confirm(`去掉「${c.name}」？收进来的消息也删掉`)) call('DELETE', `/api/channels/${c.id}`, undefined, '已去掉') }}>删</button></span>} />
          ))}
          <Row title="收件箱" chevron onClick={() => nav.push({ page: 'inbox' })} />
        </Section>
        <Section title={`提醒发到哪 · ${nts.length}`} right={<select className="sm" value="" onChange={(e) => e.target.value && setAddOut(e.target.value as Notifier['kind'])}><option value="">+ 加一个</option>{Object.entries(NK).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>}>
          {nts.length === 0 && <Empty>还没有：要你决定的事、出错（发布失败、员工出错）会同时发到这里；同样的 10 分钟内不重复</Empty>}
          {nts.map((n) => (
            <div key={n.id}>
              <Row title={<>{NK[n.kind].label} · {n.name} {n.lastError ? <Tag tone="danger">发不出去</Tag> : n.lastOk ? <Tag tone="ok">好的</Tag> : null}</>}
                sub={n.lastError ? <span data-no-i18n="">{n.lastError}</span> : `发：${n.events.map((e) => EV.find((x) => x.value === e)?.label).join('、')} · 凭证 ${n.credName ?? '不在了'}`}
                right={<span className="row-actions"><button className="btn ghost sm" onClick={() => call('POST', `/api/notifiers/${n.id}/test`, undefined, '已发一条测试')}>试一下</button><Toggle on={n.enabled} onChange={(v) => call('PUT', `/api/notifiers/${n.id}`, { enabled: v })} /><button className="btn ghost sm" onClick={() => { if (confirm(`去掉「${n.name}」？`)) call('DELETE', `/api/notifiers/${n.id}`, undefined, '已去掉') }}>删</button></span>} />
              <div className="pad chips">
                {EV.map((e) => {
                  const on = n.events.includes(e.value)
                  return <button key={e.value} className={'chip' + (on ? ' on' : '')} onClick={() => call('PUT', `/api/notifiers/${n.id}`, { events: on ? n.events.filter((x) => x !== e.value) : [...n.events, e.value] })}>{e.label}</button>
                })}
              </div>
            </div>
          ))}
        </Section>
        <p className="hint">账号、令牌、Webhook 地址先放进「权限和凭证」（消息渠道组），这里选它；值加密存着，AI 拿不到。</p>
      </div>
      {addIn && <AddInSheet kind={addIn} creds={creds.filter((c) => c.group === '消息渠道')} onClose={() => setAddIn(null)} />}
      {addOut && <AddOutSheet kind={addOut} creds={creds.filter((c) => c.group === '消息渠道')} onClose={() => setAddOut(null)} />}
    </div>
  )
}

const PRESETS: Record<string, { host: string; port: number }> = { Gmail: { host: 'imap.gmail.com', port: 993 }, 'QQ 邮箱': { host: 'imap.qq.com', port: 993 }, '163 邮箱': { host: 'imap.163.com', port: 993 }, Outlook: { host: 'outlook.office365.com', port: 993 }, 腾讯企业邮: { host: 'imap.exmail.qq.com', port: 993 }, 阿里企业邮: { host: 'imap.qiye.aliyun.com', port: 993 } }

function AddInSheet({ kind, creds, onClose }: { kind: 'email' | 'slack'; creds: { id: string; name: string; user?: string }[]; onClose: () => void }) {
  const [f, setF] = useState({ name: '', cred: '', imapHost: '', imapPort: '993', user: '' })
  const save = async () => { if (await call('POST', '/api/channels', { kind, ...f, imapPort: Number(f.imapPort) || 993 }, '已接上，2 分钟内开始收')) onClose() }
  return (
    <Sheet title={kind === 'email' ? '接一个邮箱' : '接 Slack'} onClose={onClose}>
      <div className="pad form">
        <Field label="名字"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={kind === 'email' ? '比如：工作邮箱' : '比如：公司 Slack'} /></Field>
        {kind === 'email' ? (
          <>
            <div className="chips">{Object.entries(PRESETS).map(([k, v]) => <button key={k} className={'chip' + (f.imapHost === v.host ? ' on' : '')} onClick={() => setF({ ...f, imapHost: v.host, imapPort: String(v.port) })}>{k}</button>)}</div>
            <div className="inline-form">
              <Field label="IMAP 服务器"><input value={f.imapHost} onChange={(e) => setF({ ...f, imapHost: e.target.value })} placeholder="imap.example.com" /></Field>
              <Field label="端口"><input value={f.imapPort} onChange={(e) => setF({ ...f, imapPort: e.target.value })} inputMode="numeric" /></Field>
            </div>
            <Field label="邮箱账号"><input value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} placeholder="you@example.com" /></Field>
            <Field label="密码 / 授权码在哪个凭证" hint="Gmail、QQ、163 要用「应用专用密码 / 授权码」，不是登录密码"><CredSelect creds={creds} value={f.cred} onChange={(v) => setF({ ...f, cred: v })} /></Field>
          </>
        ) : (
          <>
            <p className="field-hint">在你的 Slack 工作区建一个自己的 App，给它用户权限（channels:history、groups:history、im:history、mpim:history、users:read、channels:read、groups:read、im:read、mpim:read），装到工作区，拿 User OAuth Token（xoxp- 开头）放进凭证。</p>
            <Field label="用户令牌在哪个凭证"><CredSelect creds={creds} value={f.cred} onChange={(v) => setF({ ...f, cred: v })} /></Field>
          </>
        )}
        <button className="btn primary" disabled={!f.name.trim() || !f.cred} onClick={save}>接上</button>
      </div>
    </Sheet>
  )
}

function AddOutSheet({ kind, creds, onClose }: { kind: Notifier['kind']; creds: { id: string; name: string }[]; onClose: () => void }) {
  const [f, setF] = useState({ name: NK[kind].label, cred: '', chatId: '', smtpHost: '', smtpPort: '465', smtpUser: '', to: '', events: ['decide', 'error'] as string[] })
  const save = async () => { if (await call('POST', '/api/notifiers', { kind, ...f, smtpPort: Number(f.smtpPort) || 465 }, '已加上：点「试一下」发一条看看')) onClose() }
  return (
    <Sheet title={`提醒发到${NK[kind].label}`} onClose={onClose}>
      <div className="pad form">
        <Field label="名字"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="凭证" hint={NK[kind].credHint}><CredSelect creds={creds} value={f.cred} onChange={(v) => setF({ ...f, cred: v })} /></Field>
        {kind === 'telegram' && <Field label="chat_id" hint="先给机器人发一句话，再打开 https://api.telegram.org/bot<令牌>/getUpdates 看 chat.id"><input value={f.chatId} onChange={(e) => setF({ ...f, chatId: e.target.value })} /></Field>}
        {kind === 'email' && (
          <>
            <div className="inline-form">
              <Field label="SMTP 服务器"><input value={f.smtpHost} onChange={(e) => setF({ ...f, smtpHost: e.target.value })} placeholder="smtp.example.com" /></Field>
              <Field label="端口"><input value={f.smtpPort} onChange={(e) => setF({ ...f, smtpPort: e.target.value })} inputMode="numeric" /></Field>
            </div>
            <Field label="发件邮箱（留空用凭证的用户名）"><input value={f.smtpUser} onChange={(e) => setF({ ...f, smtpUser: e.target.value })} /></Field>
            <Field label="发给谁"><input value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} placeholder="you@example.com" /></Field>
          </>
        )}
        <div className="field"><span className="field-label">发哪些</span>
          <div className="chips">{EV.map((e) => <button key={e.value} className={'chip' + (f.events.includes(e.value) ? ' on' : '')} onClick={() => setF({ ...f, events: f.events.includes(e.value) ? f.events.filter((x) => x !== e.value) : [...f.events, e.value] })}>{e.label}</button>)}</div>
        </div>
        <button className="btn primary" disabled={!f.cred} onClick={save}>加上</button>
      </div>
    </Sheet>
  )
}

function CredSelect({ creds, value, onChange }: { creds: { id: string; name: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <>
      <select value={value} onChange={(e) => onChange(e.target.value)}><option value="">选一个</option>{creds.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      {creds.length === 0 && <span className="field-hint">还没有「消息渠道」组的凭证：先去「权限和凭证」加一个</span>}
    </>
  )
}

// ======================= 收件箱 =======================
const CAT: Record<NonNullable<InboxItem['cat']>, string> = { need: '要你看', fyi: '知道就行', skip: '不重要' }
export function LiveInboxPage({ nav }: PageProps) {
  const items = useStore((s) => s.inbox)
  const chans = useStore((s) => s.inChannels)
  const [tab, setTab] = useState<'open' | 'fyi' | 'all'>('open')
  const [open, setOpen] = useState<InboxItem | null>(null)
  const list = [...items].sort((a, b) => b.at - a.at).filter((i) => tab === 'all' || (tab === 'open' ? i.cat === 'need' && !i.done : i.cat === 'fyi'))
  const when = (t: number) => new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="page">
      <PageHeader title="收件箱" sub="消息助理分好类的邮件和 Slack；回复建议只写不发" {...headNav(nav)} right={<button className="btn ghost sm" onClick={() => nav.push({ page: 'channels' })}>渠道</button>} />
      <div className="page-body">
        {chans.length === 0 && <div className="pad"><div className="banner b-info">还没接邮箱或 Slack：去「消息渠道」接一个。<button className="btn primary sm" onClick={() => nav.push({ page: 'channels' })}>去接</button></div></div>}
        <div className="pad"><Segmented value={tab} onChange={setTab} options={[{ value: 'open', label: `要你看 · ${items.filter((i) => i.cat === 'need' && !i.done).length}` }, { value: 'fyi', label: '知道就行' }, { value: 'all', label: '全部' }]} /></div>
        <Section flush>
          {list.length === 0 && <Empty>{tab === 'open' ? '没有要你看的' : '没有'}</Empty>}
          {list.map((i) => (
            <Row key={i.id} chevron onClick={() => setOpen(i)}
              title={<>{i.important && <Tag tone="danger">急</Tag>} <span data-no-i18n="">{i.from}</span> <span className="sub">· {i.kind === 'email' ? '邮件' : 'Slack'} · {when(i.at)}</span></>}
              sub={<span data-no-i18n="">{i.summary || `${i.subject} · ${i.snippet.slice(0, 80)}`}</span>}
              right={i.cat ? <Tag tone={i.cat === 'need' ? 'primary' : 'mute'}>{i.done ? '处理过' : CAT[i.cat]}</Tag> : <Tag>在分</Tag>} />
          ))}
        </Section>
      </div>
      {open && <InboxSheet item={items.find((x) => x.id === open.id) ?? open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function InboxSheet({ item: i, onClose }: { item: InboxItem; onClose: () => void }) {
  const [body, setBody] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState('')
  const mark = (p: { cat?: string; done?: boolean }, msg: string) => call('PUT', `/api/inbox/${i.id}`, p, msg)
  const draft = async () => { setBusy(true); await call('POST', `/api/inbox/${i.id}/draft`, { hint }); setBusy(false) }
  return (
    <Sheet title={i.subject} onClose={onClose}>
      <div className="pad form">
        <p className="sub" data-no-i18n="">{i.from}{i.fromAddr ? ` <${i.fromAddr}>` : ''} · {new Date(i.at).toLocaleString('zh-CN')}</p>
        {i.summary && <div className="banner b-info" data-no-i18n="">{i.summary}</div>}
        <div className="prose" data-no-i18n="">{body ?? i.snippet}</div>
        <div className="row-actions wrap">
          {i.kind === 'email' && body === null && <button className="btn ghost sm" onClick={() => call<{ text: string }>('GET', `/api/inbox/${i.id}/body`).then((r) => r && setBody(r.text))}>看全文</button>}
          {i.url && <a className="btn ghost sm" href={i.url} target="_blank" rel="noreferrer">去原处 ↗</a>}
          <button className="btn default sm" onClick={() => mark({ done: !i.done }, i.done ? '标回没处理' : '标成处理过')}>{i.done ? '还没处理' : '处理过了'}</button>
          {(['need', 'fyi', 'skip'] as const).filter((c) => c !== i.cat).map((c) => <button key={c} className="btn ghost sm" onClick={() => mark({ cat: c }, `改成「${CAT[c]}」`)}>改成{CAT[c]}</button>)}
        </div>
        <Field label="回复建议（只写不发，你复制去回）">
          <div className="inline-form"><input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="想怎么回（可选）：比如 婉拒、问清预算" /><button className="btn primary sm" disabled={busy} onClick={draft}>{busy ? '在写…' : i.draft ? '重写' : '写一条'}</button></div>
        </Field>
        {i.draft && (
          <div className="boxed pad">
            <div data-no-i18n=""><Markdown text={i.draft} /></div>
            <div className="row-actions"><button className="btn default sm" onClick={() => { navigator.clipboard?.writeText(i.draft!.split('——中文意思')[0].trim()); toast('已复制回复') }}>复制回复</button></div>
          </div>
        )}
      </div>
    </Sheet>
  )
}
