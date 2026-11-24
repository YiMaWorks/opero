// 全局弹层：搜索 · 找员工聊（新会话）· 验证本人 · 提示
import { useEffect, useMemo, useRef, useState } from 'react'
import { getState, set, toast, useStore } from '../store'
import { inApp, nativeVerify } from '../native'
import { Avatar } from './Avatar'
import { Row, Section, Sheet } from './ui'
import { IconBack, IconFingerprint, IconPlus, IconSearch } from './icons'
import { LIVE } from '../mode'
import { createPasskey, getPasskey, passkeySupported } from '../webauthn'
import { api } from '../live'

export function SearchOverlay({ onClose, onOpenChat, onOpen }: {
  onClose: () => void
  onOpenChat: (employeeId: string) => void
  onOpen: (page: 'workspace' | 'issue', id: string | number) => void
}) {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  const s = useStore((x) => x)
  const res = useMemo(() => {
    const k = q.trim().toLowerCase()
    if (!k) return null
    const has = (t?: string) => !!t && t.toLowerCase().includes(k)
    return {
      employees: s.employees.filter((e) => has(e.name) || has(e.title)),
      messages: s.sessions.flatMap((ss) => (s.messages[ss.id] ?? []).filter((m) => has(m.text) || has(m.card?.data?.title))
        .map((m) => ({ emp: ss.employee, text: m.text ?? String(m.card?.data?.title ?? ''), at: m.at, id: m.id }))).slice(0, 20),
      workspaces: s.workspaces.filter((w) => has(w.name) || has(w.repo)),
      issues: s.issues.filter((i) => has(i.title) || has(String(i.id)) || has(i.cause)),
    }
  }, [q, s])
  const empty = res && !res.employees.length && !res.messages.length && !res.workspaces.length && !res.issues.length
  return (
    <div className="overlay">
      <header className="search-head">
        <button className="icon-btn" onClick={onClose} aria-label="返回"><IconBack /></button>
        <div className="search live"><IconSearch /><input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜员工、聊天记录、项目、问题" /></div>
      </header>
      <div className="overlay-body">
        {!res && <p className="hint center">试试：签名、发布、crm、#41</p>}
        {empty && <p className="hint center">没找到「{q}」</p>}
        {res && res.employees.length > 0 && (
          <Section title="员工">
            {res.employees.map((e) => <Row key={e.id} icon={<Avatar id={e.id} size={36} />} title={e.name} sub={e.title} onClick={() => onOpenChat(e.id)} />)}
          </Section>
        )}
        {res && res.messages.length > 0 && (
          <Section title="聊天记录">
            {res.messages.map((m) => <Row key={m.id} icon={<Avatar id={m.emp} size={36} />} title={<Hl text={m.text} k={q} />} sub={m.at} onClick={() => onOpenChat(m.emp)} />)}
          </Section>
        )}
        {res && res.workspaces.length > 0 && (
          <Section title="项目">
            {res.workspaces.map((w) => <Row key={w.id} icon={<span className="ws-icon">{w.name.slice(0, 1).toUpperCase()}</span>} title={w.name} sub={w.repo} onClick={() => onOpen('workspace', w.id)} />)}
          </Section>
        )}
        {res && res.issues.length > 0 && (
          <Section title="问题">
            {res.issues.map((i) => <Row key={i.id} title={`#${i.id} ${i.title}`} sub={i.project} onClick={() => onOpen('issue', i.id)} />)}
          </Section>
        )}
      </div>
    </div>
  )
}

function Hl({ text, k }: { text: string; k: string }) {
  const i = text.toLowerCase().indexOf(k.trim().toLowerCase())
  if (i < 0 || !k.trim()) return <>{text}</>
  const n = k.trim().length
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + n)}</mark>{text.slice(i + n)}</>
}

export function NewChatSheet({ onClose, onPick, onNewEmployee }: { onClose: () => void; onPick: (employeeId: string) => void; onNewEmployee: () => void }) {
  const employees = useStore((s) => s.employees)
  return (
    <Sheet title="找员工聊" onClose={onClose}>
      <div className="sheet-list">
        {employees.map((e) => (
          <Row key={e.id} icon={<Avatar id={e.id} size={40} />} title={e.name} sub={e.title} onClick={() => onPick(e.id)} />
        ))}
        <Row icon={<span className="ws-icon"><IconPlus /></span>} title="新员工" sub="填表建，或者跟「系统管家」说" onClick={onNewEmployee} />
      </div>
    </Sheet>
  )
}

export function VerifyModal() {
  const v = useStore((s) => s.verify)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setBusy(false)
    if (!v) return
    // App 里直接弹手机的指纹（外壳 30 分钟内验过就直接过），不显示网页的弹窗
    nativeVerify('验证本人', v.title)?.then((r) => {
      if (getState().verify !== v) return
      set({ verify: null })
      // 真的一套：外壳验过指纹后会告诉后台（/api/app/verified），稍等它到了再继续
      if (r.ok) window.setTimeout(v.onOk, LIVE ? 700 : 0)
      else if (r.err) toast(`没验证成功：${r.err}`)
    })
  }, [v])
  if (!v || inApp) return null
  if (LIVE) return <PasswordVerify title={v.title} desc={v.desc} />
  const go = () => {
    setBusy(true)
    window.setTimeout(() => {
      const cur = getState().verify
      set({ verify: null })
      cur?.onOk()
    }, 900)
  }
  return (
    <div className="modal-mask top" onClick={() => set({ verify: null })}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <b>验证本人</b>
        <p className="sub center">{v.title}{v.desc ? ` · ${v.desc}` : ''}</p>
        <button className={'fp' + (busy ? ' busy' : '')} onClick={go} aria-label="指纹">
          <IconFingerprint />
        </button>
        <p className="sub center">{busy ? '验证中…' : '点一下模拟指纹（正式版：手机指纹 / 电脑通行密钥；30 分钟内不再问）'}</p>
        <button className="btn default" onClick={() => set({ verify: null })}>取消</button>
      </div>
    </div>
  )
}

/** 这台设备叫什么（加指纹时的名字）：「Mac · Chrome」 */
function deviceName() {
  const u = navigator.userAgent
  const dev = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android 手机' : /Mac OS X/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows 电脑' : '这台设备'
  const br = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : ''
  return br ? `${dev} · ${br}` : dev
}
const SKIP_KEY = `opero.pk.skip.${typeof location !== 'undefined' ? location.hostname : ''}`

/** 真的一套在网页里验证本人：有指纹（通行密钥）就点一下指纹；没有就输密码，输完问一句「下次用指纹？」。5 分钟内不再问 */
function PasswordVerify({ title, desc }: { title: string; desc?: string }) {
  const [pwd, setPwd] = useState('')
  const [busy, setBusy] = useState(false)
  const [byCode, setByCode] = useState(false)
  const [usePwd, setUsePwd] = useState(false)
  // 这个地址加过通行密钥（指纹 / 面容）才给「用指纹」；没加过就输密码，输完可以顺手加上
  const supported = passkeySupported()
  const [pk, setPk] = useState(false)
  const [offer, setOffer] = useState(false)
  useEffect(() => {
    if (!supported) return
    api<{ passkeys: { rpId: string }[] }>('GET', '/api/auth/passkeys').then((r) => setPk(r.passkeys.some((x) => x.rpId === location.hostname))).catch(() => {})
  }, [supported])
  const close = () => set({ verify: null })
  const done = () => { const cur = getState().verify; set({ verify: null }); cur?.onOk() }
  const withPasskey = async () => {
    setBusy(true)
    try { const o = await api('POST', '/api/auth/passkey/options', {}); await api('POST', '/api/auth/passkey/verify', await getPasskey(o)); done() } catch (e) { toast((e as Error).message); setBusy(false) }
  }
  const go = async () => {
    if (!pwd) return
    setBusy(true)
    try {
      await api('POST', '/api/auth/verify', byCode ? { code: pwd } : { password: pwd })
      setBusy(false)
      // 这台还没加指纹：问一句要不要加（加了下次点一下就行）；说过「以后再说」就不问
      if (supported && !pk && !localStorage.getItem(SKIP_KEY)) setOffer(true)
      else done()
    } catch (e) {
      toast((e as Error).message)
      setBusy(false)
    }
  }
  const addPasskey = async () => {
    setBusy(true)
    try {
      const o = await api('POST', '/api/auth/passkey/register-options', {})
      await api('POST', '/api/auth/passkey/register', { credential: await createPasskey(o), name: deviceName() })
      toast('已加上：下次点一下指纹就行')
    } catch (e) { toast((e as Error).message) }
    done()
  }
  const lock = <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
  if (offer) return (
    <div className="modal-mask top">
      <div className="verify-box" onClick={(e) => e.stopPropagation()}>
        <span className="verify-ico ok"><IconFingerprint /></span>
        <b>下次用指纹确认？</b>
        <p className="verify-what">在这台设备上加一个通行密钥（指纹 / 面容 / 设备密码），以后验证本人点一下就行，不用再输密码。</p>
        <button className="btn primary lg block" disabled={busy} onClick={addPasskey}>{busy ? '在加…' : '加上指纹'}</button>
        <button className="btn ghost block" disabled={busy} onClick={() => { localStorage.setItem(SKIP_KEY, '1'); done() }}>以后再说</button>
      </div>
    </div>
  )
  const showPk = pk && !usePwd
  return (
    <div className="modal-mask top" onClick={close}>
      <div className="verify-box" onClick={(e) => e.stopPropagation()}>
        <span className="verify-ico">{showPk ? <IconFingerprint /> : lock}</span>
        <b>验证本人</b>
        <p className="verify-what">{title}{desc && <span>{desc}</span>}</p>
        {showPk ? (
          <>
            <button className="btn primary lg block" disabled={busy} onClick={withPasskey}><IconFingerprint /> {busy ? '验证中…' : '用指纹 / 面容确认'}</button>
            <button className="btn ghost block" onClick={() => setUsePwd(true)}>改用密码</button>
          </>
        ) : (
          <>
            <input className="verify-input" type={byCode ? 'text' : 'password'} autoFocus value={pwd} onChange={(e) => { setPwd(e.target.value); if (byCode && /^\d{6}$/.test(e.target.value)) void go() }} onKeyDown={(e) => e.key === 'Enter' && go()}
              placeholder={byCode ? '两步验证的 6 位码' : '登录密码'} autoComplete={byCode ? 'one-time-code' : 'current-password'} inputMode={byCode ? 'numeric' : undefined} />
            <div className="verify-acts">
              <button className="btn default" onClick={close}>取消</button>
              <button className="btn primary" disabled={busy || !pwd} onClick={go}>{busy ? '验证中…' : '确认'}</button>
            </div>
            <div className="verify-links">
              <button className="link" onClick={() => { setByCode(!byCode); setPwd('') }}>{byCode ? '改用密码' : '改用两步验证码'}</button>
              {pk && <button className="link" onClick={() => setUsePwd(false)}>用指纹</button>}
            </div>
            {supported && !pk && <p className="verify-tip">输完密码可以把这台设备的指纹加上，下次点一下就行</p>}
          </>
        )}
      </div>
    </div>
  )
}

export function Toast() {
  const t = useStore((s) => s.toast)
  return t ? <div className="toast">{t}</div> : null
}

// 回复建议：只给模板让你复制，不替你发（AI 会弄错，商业场景要严谨）；可以换语言
const LANGS = ['中文', 'English', '日本語', '한국어'] as const
type Lang = (typeof LANGS)[number]
const TEMPLATES: Record<string, Record<Lang, string>> = {
  邮件: {
    中文: '张总好，可以的，明天下午 3 点评审。我会把 shop-api 的发布计划一起带上。',
    English: 'Hi Zhang, 3 PM tomorrow works for me. I will bring the shop-api release plan as well.',
    日本語: '張さん、明日の午後3時で大丈夫です。shop-api のリリース計画も持っていきます。',
    한국어: '장 대표님, 내일 오후 3시 괜찮습니다. shop-api 배포 계획도 함께 준비하겠습니다.',
  },
  Slack: {
    中文: '上了，今天 11:56 发的生产，盯了 10 分钟没有新报错。',
    English: 'Yes — v1.4.2 went to production at 11:56 today, no new errors after 10 minutes of watching.',
    日本語: 'はい、今日 11:56 に本番へリリースしました。10分間監視して新しいエラーはありません。',
    한국어: '네, 오늘 11:56에 운영에 배포했고 10분 동안 새 오류는 없었습니다.',
  },
  Telegram: {
    中文: 'Lily 你好，抱歉给你带来不便。我们已经在查导出 403 的问题，修好后第一时间告诉你。',
    English: 'Hi Lily, sorry for the trouble. We are looking into the 403 error on export and will let you know as soon as it is fixed.',
    日本語: 'Lily さん、ご不便をおかけして申し訳ありません。エクスポート時の 403 エラーを調査中です。修正でき次第ご連絡します。',
    한국어: 'Lily 님, 불편을 드려 죄송합니다. 내보내기 403 오류를 확인 중이며 해결되는 대로 바로 알려드리겠습니다.',
  },
}
export function ReplySuggestSheet({ title, ch, original, onClose }: { title: string; ch: string; original?: string; onClose: () => void }) {
  const [lang, setLang] = useState<Lang>(original && /^[\x00-\x7F\s]+$/.test(original) ? 'English' : '中文')
  const text = (TEMPLATES[ch] ?? TEMPLATES['邮件'])[lang]
  return (
    <Sheet title="回复建议" onClose={onClose}>
      <p className="sub">{title}</p>
      {original && <div className="quote">{original}</div>}
      <div className="seg">{LANGS.map((l) => <button key={l} className={l === lang ? 'on' : ''} onClick={() => setLang(l)}>{l}</button>)}</div>
      <textarea className="code-edit suggest" rows={4} defaultValue={text} key={lang} />
      <p className="field-hint">只是建议：复制后到原处自己发。消息助理不会替你回（要开代发去「消息渠道」，默认关）。</p>
      <div className="row-actions">
        <button className="btn default" onClick={() => { navigator.clipboard?.writeText(text).catch(() => {}); toast('已复制') }}>复制</button>
        <button className="btn primary" onClick={() => { navigator.clipboard?.writeText(text).catch(() => {}); toast(`已复制，原型：正式版接着跳到 ${ch} 里那条消息`); onClose() }}>复制并去回复</button>
      </div>
    </Sheet>
  )
}
