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
        <p className="hint">令牌、Webhook 地址、授权码直接在这里贴：加密存成「凭证 → 消息渠道」，AI 拿不到。</p>
      </div>
      {addIn && <AddInSheet kind={addIn} creds={creds.filter((c) => c.group === '消息渠道')} onClose={() => setAddIn(null)} />}
      {addOut && <AddOutSheet kind={addOut} creds={creds.filter((c) => c.group === '消息渠道')} onClose={() => setAddOut(null)} />}
    </div>
  )
}

// 常见邮箱：IMAP / SMTP 地址和「授权码 / 应用专用密码」去哪拿（都不是登录密码）
const MAIL: { name: string; imap: string; smtp: string; smtpPort: number; url?: string; steps: string }[] = [
  { name: 'QQ 邮箱', imap: 'imap.qq.com', smtp: 'smtp.qq.com', smtpPort: 465, url: 'https://wx.mail.qq.com/', steps: '网页版 QQ 邮箱 → 设置 → 账号与安全 → 安全设置 → 开启「POP3/IMAP/SMTP/Exchange/CardDAV 服务」→ 按提示用手机验证 → 复制生成的授权码' },
  { name: '163 邮箱', imap: 'imap.163.com', smtp: 'smtp.163.com', smtpPort: 465, url: 'https://mail.163.com/', steps: '网页版 163 邮箱 → 设置 → POP3/SMTP/IMAP → 开启「IMAP/SMTP 服务」→ 按提示验证 → 复制授权码（只显示一次）' },
  { name: 'Gmail', imap: 'imap.gmail.com', smtp: 'smtp.gmail.com', smtpPort: 465, url: 'https://myaccount.google.com/apppasswords', steps: '先开两步验证；打开「应用专用密码」页，名字填 Opero，点创建，复制 16 位密码（去掉空格）' },
  { name: 'Outlook', imap: 'outlook.office365.com', smtp: 'smtp.office365.com', smtpPort: 587, url: 'https://account.live.com/proofs/AppPassword', steps: '先开两步验证；在「应用密码」页创建一个，复制。公司的 Microsoft 365 账号要管理员允许 IMAP / SMTP' },
  { name: '腾讯企业邮', imap: 'imap.exmail.qq.com', smtp: 'smtp.exmail.qq.com', smtpPort: 465, url: 'https://exmail.qq.com/', steps: '企业邮网页版 → 设置 → 客户端设置 → 开启 IMAP/SMTP；开了「安全登录」的话在 微信绑定 → 生成客户端专用密码' },
  { name: '阿里企业邮', imap: 'imap.qiye.aliyun.com', smtp: 'smtp.qiye.aliyun.com', smtpPort: 465, url: 'https://qiye.aliyun.com/', steps: '企业邮网页版 → 设置 → 客户端设置 → 开启 IMAP/SMTP；开了二次验证就生成「三方客户端安全密码」' },
]
const SLACK_APP = 'https://api.slack.com/apps?new_app=1'
/** 提醒渠道：去哪拿、怎么拿（每一种都写明白） */
const OUT_GUIDE: Record<Notifier['kind'], { link?: { label: string; url: string }; steps: string[]; secret: string; ph?: string; signKey?: string }> = {
  telegram: {
    link: { label: '打开 @BotFather', url: 'https://t.me/BotFather' },
    steps: ['在 Telegram 里打开 @BotFather，发 /newbot', '按提示起一个名字，再起一个以 bot 结尾的用户名', '它会回你一串令牌（像 123456789:AAE…），复制贴到下面', '打开你刚建的机器人，给它发一句话（要发到群里：把机器人拉进群，在群里发一句）', '点「加上」：Opero 自动找到要发去的聊天（chat_id），不用你填'],
    secret: '机器人令牌', ph: '123456789:AAE…',
  },
  slack: {
    link: { label: '去 Slack 建 App', url: SLACK_APP },
    steps: ['点按钮 → Create New App → From scratch，名字填 Opero，选你的工作区', '左边点 Incoming Webhooks → 打开 Activate Incoming Webhooks', '点页面下面的 Add New Webhook to Workspace，选要收提醒的频道，点 Allow', '复制 https://hooks.slack.com/services/… 开头的地址，贴到下面'],
    secret: 'Webhook 地址', ph: 'https://hooks.slack.com/services/…',
  },
  wecom: {
    steps: ['在企业微信电脑版打开要收提醒的群', '右上角「…」→「消息推送」（老版本叫「群机器人」）→ 添加', '名字填 Opero，点添加', '复制 Webhook 地址（https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=… 开头），贴到下面'],
    secret: 'Webhook 地址', ph: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…',
  },
  dingtalk: {
    steps: ['在钉钉电脑版打开要收提醒的群 → 群设置 → 机器人 → 添加机器人 → 自定义', '名字填 Opero；安全设置勾「加签」，复制 SEC 开头的密钥，贴到下面的「加签密钥」', '同意协议点完成，复制 Webhook 地址（https://oapi.dingtalk.com/robot/send?access_token=… 开头），贴到下面'],
    secret: 'Webhook 地址', ph: 'https://oapi.dingtalk.com/robot/send?access_token=…', signKey: '加签密钥（SEC 开头）',
  },
  feishu: {
    steps: ['在飞书打开要收提醒的群 → 设置 → 群机器人 → 添加机器人 → 自定义机器人', '名字填 Opero；安全设置勾「签名校验」，复制密钥，贴到下面的「签名密钥」', '点完成，复制 Webhook 地址（https://open.feishu.cn/open-apis/bot/v2/hook/… 开头），贴到下面'],
    secret: 'Webhook 地址', ph: 'https://open.feishu.cn/open-apis/bot/v2/hook/…', signKey: '签名密钥',
  },
  email: { steps: ['选你的邮箱（不在里面的就自己填 SMTP 地址）', '照下面的说明拿「授权码 / 应用专用密码」（不是登录密码），贴到下面', '「发给谁」不填就发给自己'], secret: '授权码 / 应用专用密码' },
  webhook: { steps: ['填你自己服务的地址：有事时 Opero 往这里 POST 一个 JSON（title、text、link）', '要校验来源就填一个签名密钥：请求头 X-Opero-Signature = 用它对请求体做的 sha256 HMAC'], secret: '地址', ph: 'https://example.com/opero-hook', signKey: '签名密钥（可选）' },
}

function Guide({ link, steps }: { link?: { label: string; url: string }; steps: string[] }) {
  return (
    <div className="cred-guide">
      <b>怎么拿</b>
      {link && <a className="btn primary" href={link.url} target="_blank" rel="noreferrer">{link.label} ↗</a>}
      <ol className="exec-howto">{steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
    </div>
  )
}
/** 直接贴（存成凭证），或者用已经存过的 */
function SecretOrCred({ label, ph, creds, f, setF }: { label: string; ph?: string; creds: { id: string; name: string }[]; f: { cred: string; secret: string }; setF: (p: Partial<{ cred: string; secret: string }>) => void }) {
  const [old, setOld] = useState(false)
  return old
    ? <Field label="用已经存过的凭证"><select value={f.cred} onChange={(e) => setF({ cred: e.target.value })}><option value="">选一个</option>{creds.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button type="button" className="btn ghost sm" onClick={() => { setOld(false); setF({ cred: '' }) }}>改成直接贴</button></Field>
    : (
      <Field label={label} hint="加密存成一个「消息渠道」凭证，AI 拿不到">
        <input type="password" value={f.secret} onChange={(e) => setF({ secret: e.target.value })} placeholder={ph} autoComplete="new-password" />
        {creds.length > 0 && <button type="button" className="btn ghost sm" onClick={() => { setOld(true); setF({ secret: '' }) }}>用已经存过的</button>}
      </Field>
    )
}

function AddInSheet({ kind, creds, onClose }: { kind: 'email' | 'slack'; creds: { id: string; name: string; user?: string }[]; onClose: () => void }) {
  const [f, setF] = useState({ name: '', cred: '', secret: '', imapHost: '', imapPort: '993', user: '' })
  const up = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }))
  const mail = MAIL.find((m) => m.imap === f.imapHost)
  const save = async () => { if (await call('POST', '/api/channels', { kind, ...f, imapPort: Number(f.imapPort) || 993 }, '已接上，2 分钟内开始收')) onClose() }
  return (
    <Sheet title={kind === 'email' ? '接一个邮箱' : '接 Slack'} onClose={onClose}>
      <div className="pad form">
        {kind === 'email' ? (
          <>
            <Field label="哪家邮箱"><div className="chips">{MAIL.map((m) => <button key={m.name} type="button" className={'chip' + (f.imapHost === m.imap ? ' on' : '')} onClick={() => up({ imapHost: m.imap, imapPort: '993' })}>{m.name}</button>)}<button type="button" className={'chip' + (f.imapHost && !mail ? ' on' : '')} onClick={() => up({ imapHost: '' })}>其它</button></div></Field>
            {mail && <Guide link={mail.url ? { label: `打开${mail.name}`, url: mail.url } : undefined} steps={[mail.steps, '邮箱账号填完整的邮箱地址，授权码贴到下面']} />}
            {!mail && (
              <div className="inline-form">
                <Field label="IMAP 服务器"><input value={f.imapHost} onChange={(e) => up({ imapHost: e.target.value })} placeholder="imap.example.com" /></Field>
                <Field label="端口"><input value={f.imapPort} onChange={(e) => up({ imapPort: e.target.value })} inputMode="numeric" /></Field>
              </div>
            )}
            <Field label="邮箱账号"><input value={f.user} onChange={(e) => up({ user: e.target.value })} placeholder="you@example.com" /></Field>
            <SecretOrCred label="授权码 / 应用专用密码（不是登录密码）" creds={creds} f={f} setF={up} />
          </>
        ) : (
          <>
            <Guide link={{ label: '去 Slack 建 App', url: SLACK_APP }} steps={[
              '点按钮 → Create New App → From scratch，名字填 Opero，选你的工作区',
              '左边点 OAuth & Permissions，在 User Token Scopes 里加上：channels:history、groups:history、im:history、mpim:history、channels:read、groups:read、im:read、mpim:read、users:read',
              '页面上面点 Install to Workspace → Allow',
              '复制 User OAuth Token（xoxp- 开头），贴到下面',
            ]} />
            <SecretOrCred label="User OAuth Token" ph="xoxp-…" creds={creds} f={f} setF={up} />
          </>
        )}
        <Field label="名字（可选）"><input value={f.name} onChange={(e) => up({ name: e.target.value })} placeholder={kind === 'email' ? f.user || '工作邮箱' : '公司 Slack'} /></Field>
        <button className="btn primary" disabled={!f.cred && !f.secret.trim()} onClick={save}>接上</button>
      </div>
    </Sheet>
  )
}

function AddOutSheet({ kind, creds, onClose }: { kind: Notifier['kind']; creds: { id: string; name: string }[]; onClose: () => void }) {
  const g = OUT_GUIDE[kind]
  const [f, setF] = useState({ name: NK[kind].label, cred: '', secret: '', secretUser: '', chatId: '', smtpHost: '', smtpPort: '465', smtpUser: '', to: '', events: ['decide', 'error'] as string[] })
  const up = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }))
  const mail = MAIL.find((m) => m.smtp === f.smtpHost)
  const save = async () => { if (await call('POST', '/api/notifiers', { kind, ...f, to: f.to || f.smtpUser, smtpPort: Number(f.smtpPort) || 465 }, '已加上：点「试一下」发一条看看')) onClose() }
  return (
    <Sheet title={`提醒发到${NK[kind].label}`} onClose={onClose}>
      <div className="pad form">
        {kind === 'email' && <Field label="哪家邮箱"><div className="chips">{MAIL.map((m) => <button key={m.name} type="button" className={'chip' + (f.smtpHost === m.smtp ? ' on' : '')} onClick={() => up({ smtpHost: m.smtp, smtpPort: String(m.smtpPort) })}>{m.name}</button>)}<button type="button" className={'chip' + (f.smtpHost && !mail ? ' on' : '')} onClick={() => up({ smtpHost: '' })}>其它</button></div></Field>}
        <Guide link={kind === 'email' && mail?.url ? { label: `打开${mail.name}`, url: mail.url } : g.link} steps={kind === 'email' && mail ? [mail.steps, ...g.steps.slice(2)] : g.steps} />
        {kind === 'email' && (
          <>
            {!mail && (
              <div className="inline-form">
                <Field label="SMTP 服务器"><input value={f.smtpHost} onChange={(e) => up({ smtpHost: e.target.value })} placeholder="smtp.example.com" /></Field>
                <Field label="端口"><input value={f.smtpPort} onChange={(e) => up({ smtpPort: e.target.value })} inputMode="numeric" /></Field>
              </div>
            )}
            <Field label="发件邮箱"><input value={f.smtpUser} onChange={(e) => up({ smtpUser: e.target.value })} placeholder="you@example.com" /></Field>
          </>
        )}
        <SecretOrCred label={g.secret} ph={g.ph} creds={creds} f={f} setF={up} />
        {g.signKey && !f.cred && <Field label={g.signKey}><input type="password" value={f.secretUser} onChange={(e) => up({ secretUser: e.target.value })} autoComplete="new-password" /></Field>}
        {kind === 'email' && <Field label="发给谁（不填发给自己）"><input value={f.to} onChange={(e) => up({ to: e.target.value })} placeholder={f.smtpUser || 'you@example.com'} /></Field>}
        <div className="field"><span className="field-label">发哪些</span>
          <div className="chips">{EV.map((e) => <button key={e.value} className={'chip' + (f.events.includes(e.value) ? ' on' : '')} onClick={() => up({ events: f.events.includes(e.value) ? f.events.filter((x) => x !== e.value) : [...f.events, e.value] })}>{e.label}</button>)}</div>
        </div>
        <button className="btn primary" disabled={!f.cred && !f.secret.trim()} onClick={save}>加上</button>
      </div>
    </Sheet>
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
  const draft = async (h = hint) => { setHint(h); setBusy(true); await call('POST', `/api/inbox/${i.id}/draft`, { hint: h }); setBusy(false) }
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
          <div className="chips">{['同意', '婉拒', '问清细节', '稍后回复', '转给同事'].map((x) => <button key={x} type="button" className={'chip' + (hint === x ? ' on' : '')} disabled={busy} onClick={() => draft(x)}>{x}</button>)}</div>
          <div className="inline-form"><input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="或者自己说想怎么回（可选）" /><button className="btn primary sm" disabled={busy} onClick={() => draft()}>{busy ? '在写…' : i.draft ? '重写' : '写一条'}</button></div>
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
