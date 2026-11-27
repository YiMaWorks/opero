// 网络出口（「应用 → 服务器和 Agent」里的一块）：Opero 自己连外面时，有的地址这台连不上，就让它经一台能连上的服务器出去。
// 怕主人不会用，所以：一张图讲清楚是怎么回事；「最近连不上的」直接列出来、一点「换个出口」就带好地址；
// 加的时候常见的地址点一下就填好、贴网址 / 邮箱也认得；选出口是一张张卡片（离线、Agent 太旧的直接说为什么不能选）；
// 先测再存（直连通不通、经它通不通都摆出来），不通不让存（除非点「仍然保存」）。规则就地改（出口、备注、域名、允许内网）。
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, Globe, Plus, Server as ServerIcon, ShieldAlert, Trash2, X, Zap } from 'lucide-react'
import { call } from '../live'
import { toast, useStore } from '../store'
import { Field, InlineText, Section, Sheet, StatusDot, Tag } from './ui'

interface TestResult { ok: boolean; ms?: number; err?: string }
interface Rule { id: string; host: string; via: string; lan?: boolean; note?: string; at: number; by?: string; test?: TestResult & { at: number; port: number } }
interface Failure { host: string; port: number; what: string; err: string; at: number; n: number }
interface View { rules: Rule[]; failures: Failure[]; min: string }

const COMMON: { label: string; host: string; port: number }[] = [
  { label: 'Gmail 收信', host: 'imap.gmail.com', port: 993 },
  { label: 'Gmail 发信', host: 'smtp.gmail.com', port: 465 },
  { label: 'Telegram', host: 'api.telegram.org', port: 443 },
  { label: 'Slack', host: 'slack.com', port: 443 },
  { label: 'Discord', host: 'discord.com', port: 443 },
  { label: 'OpenAI', host: 'api.openai.com', port: 443 },
  { label: 'Google Gemini', host: 'generativelanguage.googleapis.com', port: 443 },
  { label: 'GitHub', host: 'github.com', port: 443 },
]
const PORTS: { p: number; label: string }[] = [{ p: 443, label: '443 网页 / 接口' }, { p: 993, label: '993 收信' }, { p: 465, label: '465 发信' }, { p: 587, label: '587 发信' }]

const verGte = (a = '', b = '') => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) }
  return true
}
const ago = (ts: number) => {
  const s = Math.round((Date.now() - ts) / 1000)
  return s < 60 ? '刚刚' : s < 3600 ? `${Math.round(s / 60)} 分钟前` : s < 86400 ? `${Math.round(s / 3600)} 小时前` : `${Math.round(s / 86400)} 天前`
}
/** 和后台 egress.parseTarget 一样的认法（只用来即时提示，存的时候以后台为准） */
function parse(input: string): { host: string; port?: number } | null {
  let s = input.trim().toLowerCase()
  if (!s) return null
  if (s.includes('@') && !s.includes('/')) s = s.slice(s.lastIndexOf('@') + 1)
  let port: number | undefined
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) {
    try { const u = new URL(s); s = u.hostname; port = Number(u.port) || ({ 'https:': 443, 'http:': 80, 'imaps:': 993, 'smtps:': 465 } as Record<string, number>)[u.protocol] } catch { return null }
  } else {
    s = s.replace(/[/?#].*$/, '')
    const m = s.match(/^(.*):(\d{1,5})$/)
    if (m && !m[1].includes(':')) { s = m[1]; port = Number(m[2]) }
  }
  s = s.replace(/^\*\./, '').replace(/^\.+|\.+$/g, '')
  if (!/^[a-z0-9.-]+$|^[0-9a-f:]+$/.test(s) || !s.includes('.') && !s.includes(':')) return null
  return { host: s, port }
}

export function EgressSection({ onJoin }: { onJoin: () => void }) {
  const servers = useStore((s) => s.servers)
  const [v, setV] = useState<View | null>(null)
  const [adding, setAdding] = useState<null | { host: string; port?: number }>(null)
  const [why, setWhy] = useState(false)
  const [testing, setTesting] = useState('')
  const load = () => call<View>('GET', '/api/egress').then((r) => r && setV(r))
  useEffect(() => { load() }, [])
  const agents = servers.filter((x) => x.via === 'agent' && x.id !== 'local')
  const nameOf = (id: string) => (id === 'direct' ? '直连' : servers.find((x) => x.id === id)?.name ?? id)
  if (!v) return null
  const save = async (id: string, p: Partial<Rule>, msg?: string) => { const r = await call<View>('PUT', `/api/egress/${id}`, p, msg); if (r) setV(r) }
  const del = async (r: Rule) => { if (!confirm(`删掉「${r.host}」这条？删了以后 ${r.host} 直连。`)) return; const x = await call<View>('DELETE', `/api/egress/${r.id}`, undefined, '已删，之后直连'); if (x) setV(x) }
  const retest = async (r: Rule) => {
    setTesting(r.id)
    await call('POST', '/api/egress/test', { host: r.host, port: r.test?.port, id: r.id })
    setTesting('')
    load()
  }
  const showIntro = why || v.rules.length === 0
  return (
    <Section title={`网络出口${v.rules.length ? ` · ${v.rules.length}` : ''}`}
      right={agents.length > 0 ? <button className="btn ghost sm" onClick={() => setAdding({ host: '' })}><Plus size={14} /> 加一条</button> : undefined}>
      {showIntro ? (
        <div className="eg-intro">
          <p><b>Opero 自己连外面时</b>（收发邮件、提醒渠道、AI Key、生图、DNS、流水线、代码平台的接口…），有的地址这台连不上，比如在国内连 Gmail、Telegram。设一条规则，让它<b>经一台能连上的服务器出去</b>：</p>
          <div className="eg-diagram" aria-hidden>
            <div className="eg-line bad"><span className="eg-node"><Zap size={13} />Opero</span><span className="eg-arrow"><X size={13} /></span><span className="eg-node mono">imap.gmail.com</span><small>直连不通</small></div>
            <div className="eg-line good"><span className="eg-node"><Zap size={13} />Opero</span><ArrowRight size={14} className="eg-arrow" /><span className="eg-node via"><ServerIcon size={13} />{agents[0]?.name ?? '海外那台'}<em>Agent</em></span><ArrowRight size={14} className="eg-arrow" /><span className="eg-node mono">imap.gmail.com</span><small>通了</small></div>
          </div>
          <ul className="eg-points">
            <li>那台只要装了 Agent，<b>不用开端口</b>；内容全程加密，它<b>看不到</b>邮件和密钥。</li>
            <li>写一个域名，<b>它的子域名也一起管</b>（写 gmail.com 就包括 imap.gmail.com）；没写的照常直连。</li>
            <li>不知道是哪个地址？下面「最近连不上的」会自动列出来，点「换个出口」就行。</li>
          </ul>
          {v.rules.length > 0 && <button className="btn ghost sm" onClick={() => setWhy(false)}>收起</button>}
        </div>
      ) : (
        <p className="eg-brief"><Globe size={14} />{'Opero 连不上的地址，经别的服务器出去。'}<button className="link-btn" onClick={() => setWhy(true)}>怎么回事？</button></p>
      )}

      {agents.length === 0 && (
        <div className="banner b-warn eg-noagent">
          <span>要先接入一台<b>能连上那些地址</b>的服务器（装 Agent），才能当出口。</span>
          <button className="btn primary sm" onClick={onJoin}>去接入</button>
        </div>
      )}

      {v.failures.length > 0 && (
        <div className="eg-fails">
          <div className="eg-sub"><AlertTriangle size={14} />最近连不上的<small>（Opero 这次启动以来，自动记的）</small></div>
          {v.failures.map((f) => (
            <div key={f.host} className="eg-fail">
              <span className="eg-fail-main">
                <b className="mono" data-no-i18n="">{f.host}<i>:{f.port}</i></b>
                <small>{[f.what, f.err, `${ago(f.at)}${f.n > 1 ? ` · ${f.n} 次` : ''}`].filter(Boolean).join(' · ')}</small>
              </span>
              {agents.length > 0 && <button className="btn primary sm" onClick={() => setAdding({ host: f.host, port: f.port })}>换个出口</button>}
              <button className="btn ghost sm" title="不管它，从列表里拿掉" onClick={async () => { const r = await call<View>('DELETE', `/api/egress/failures/${encodeURIComponent(f.host)}`); if (r) setV(r) }}>忽略</button>
            </div>
          ))}
        </div>
      )}

      {v.rules.length > 0 && (
        <div className="eg-rules">
          {v.rules.map((r) => {
            const sv = servers.find((x) => x.id === r.via)
            const problem = r.via === 'direct' ? '' : !sv ? '这台服务器没了' : !sv.online ? `「${sv.name}」离线：连 ${r.host} 会失败` : !verGte(sv.agentVersion, v.min) ? `「${sv.name}」的 Agent 要升到 ${v.min} 以上` : ''
            return (
              <div key={r.id} className={'eg-rule' + (problem ? ' warn' : '')}>
                <div className="eg-rule-top">
                  <span className="eg-host">
                    <InlineText className="mono" value={r.host} max={80} onSave={(x) => save(r.id, { host: x }, '已改')} />
                    <small>{/^[\d.:]+$/.test(r.host) ? '这个 IP' : '含子域名'}</small>
                  </span>
                  <ArrowRight size={15} className="eg-arrow" />
                  <select className="eg-via" value={r.via} onChange={(e) => save(r.id, { via: e.target.value }, '已换出口')}>
                    {agents.map((a) => <option key={a.id} value={a.id} disabled={!verGte(a.agentVersion, v.min)}>{`经「${a.name}」${a.online ? '' : '（离线）'}${verGte(a.agentVersion, v.min) ? '' : '（Agent 太旧）'}`}</option>)}
                    <option value="direct">直连（例外，不走出口）</option>
                  </select>
                  <span className="eg-state">
                    {testing === r.id ? <Tag>测试中…</Tag>
                      : r.via === 'direct' ? <Tag>直连</Tag>
                      : r.test ? (r.test.ok ? <Tag tone="ok">{`通 · ${r.test.ms} ms`}</Tag> : <span title={r.test.err}><Tag tone="danger">不通</Tag></span>)
                      : <Tag>没测过</Tag>}
                  </span>
                  <span className="eg-acts">
                    {r.via !== 'direct' && <button className="btn ghost sm" disabled={testing === r.id} onClick={() => retest(r)}>测试</button>}
                    <button className="icon-btn" aria-label="删掉" title="删掉这条（之后直连）" onClick={() => del(r)}><Trash2 size={15} /></button>
                  </span>
                </div>
                <div className="eg-rule-sub">
                  <InlineText value={r.note ?? ''} placeholder="加个备注（比如：工作邮箱）" max={60} onSave={(x) => save(r.id, { note: x })} />
                  <label className={'eg-lan' + (r.lan ? ' on' : '')} title="许经这个出口连内网地址（10.x、192.168.x 这些）。默认不许，防止被拿去探内网；要验证本人">
                    <input type="checkbox" checked={!!r.lan} onChange={(e) => save(r.id, { lan: e.target.checked }, e.target.checked ? '已允许连内网地址' : '已关掉')} />
                    允许内网
                  </label>
                  {r.test && !r.test.ok && r.test.err && <span className="eg-err">{r.test.err}</span>}
                  {problem && <span className="eg-err">{problem}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {adding && <EgressAdd init={adding} min={v.min} onClose={() => setAdding(null)} onSaved={(x) => { setV(x); setAdding(null) }} />}
    </Section>
  )
}

/** 加一条：连哪里（常见的点一下）→ 经哪台（卡片）→ 测试并保存 */
function EgressAdd({ init, min, onClose, onSaved }: { init: { host: string; port?: number }; min: string; onClose: () => void; onSaved: (v: View) => void }) {
  const servers = useStore((s) => s.servers)
  const agents = servers.filter((x) => x.via === 'agent' && x.id !== 'local')
  const usable = (a: (typeof agents)[number]) => a.online && verGte(a.agentVersion, min)
  const [text, setText] = useState(init.host)
  const [port, setPort] = useState<number | undefined>(init.port)
  const [via, setVia] = useState(() => agents.find(usable)?.id ?? '')
  const [lan, setLan] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ direct: TestResult; via?: TestResult } | null>(null)
  const t = useMemo(() => parse(text), [text])
  const testPort = port ?? t?.port ?? 443
  const go = async (force = false) => {
    if (!t || !via) return
    setBusy(true)
    const r = await call<{ saved: boolean; test?: { direct: TestResult; via?: TestResult } } & Partial<View>>('POST', '/api/egress', { host: text, port: testPort, via, lan, note, force })
    setBusy(false)
    if (!r) return
    if (r.test) setRes(r.test)
    if (r.saved) {
      toast(via === 'direct' ? `已保存：${t.host} 直连` : `已保存：以后连 ${t.host} 都经「${servers.find((x) => x.id === via)?.name}」出去`)
      onSaved(r as View)
    }
  }
  const viaName = servers.find((x) => x.id === via)?.name ?? ''
  return (
    <Sheet title="加一条网络出口" onClose={onClose}>
      <div className="pad form eg-add">
        <Field label="1. 连哪里" hint={t ? `会管 ${t.host}${/^[\d.:]+$/.test(t.host) ? '' : ` 和它的子域名（比如 x.${t.host}）`}` : '贴网址、邮箱地址、域名都行，比如 https://api.telegram.org 或 me@gmail.com'}>
          <input value={text} autoFocus={!init.host} onChange={(e) => { setText(e.target.value); setRes(null) }} placeholder="imap.gmail.com" autoComplete="off" spellCheck={false} />
        </Field>
        {!init.host && (
          <div className="eg-chips">
            <small>常见的：</small>
            {COMMON.map((c) => <button key={c.label} type="button" className={'chip' + (t?.host === c.host ? ' on' : '')} onClick={() => { setText(c.host); setPort(c.port); setRes(null) }}>{c.label}</button>)}
          </div>
        )}
        <div className="eg-chips">
          <small>测试用的端口：</small>
          {PORTS.map((x) => <button key={x.p} type="button" className={'chip' + (testPort === x.p ? ' on' : '')} onClick={() => { setPort(x.p); setRes(null) }}>{x.label}</button>)}
          {!PORTS.some((x) => x.p === testPort) && <span className="chip on">{testPort}</span>}
        </div>
        <p className="field-hint">端口只用来测通不通；规则对这个地址的所有端口都生效。</p>

        <div className="field">
          <span className="field-label">2. 经哪台出去</span>
          <div className="eg-cards">
            {agents.map((a) => {
              const why = !a.online ? '离线' : !verGte(a.agentVersion, min) ? `Agent ${a.agentVersion || '太旧'}，要升到 ${min}（服务器详情里点「升级 Agent」）` : ''
              return (
                <button key={a.id} type="button" disabled={!!why} className={'eg-card' + (via === a.id ? ' on' : '')} onClick={() => { setVia(a.id); setRes(null) }}>
                  <span className="eg-card-top"><StatusDot tone={a.online ? 'ok' : 'danger'} /><b>{a.name}</b>{via === a.id && <Check size={15} />}</span>
                  <small>{why || [a.env, a.ip, `Agent ${a.agentVersion}`].filter(Boolean).join(' · ')}</small>
                </button>
              )
            })}
          </div>
          <button type="button" className={'link-btn eg-direct' + (via === 'direct' ? ' on' : '')} onClick={() => { setVia('direct'); setRes(null) }}>
            {via === 'direct' ? '✓ ' : ''}直连（例外：上级域名设了出口，这个子域名不走）
          </button>
        </div>

        <details className="eg-more">
          <summary>更多</summary>
          <Field label="备注" hint="写给自己看的，比如：工作邮箱"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={60} /></Field>
          <label className="eg-lan-big"><input type="checkbox" checked={lan} onChange={(e) => setLan(e.target.checked)} />
            <span><b><ShieldAlert size={14} /> 允许连内网地址</b><small>只有要连公司内网的邮件服务器这类才勾。默认不许（防止被拿去探内网），勾了要验证本人。</small></span>
          </label>
        </details>

        {res && (
          <div className="eg-result">
            <div className={res.direct.ok ? 'ok' : 'bad'}>{res.direct.ok ? <Check size={15} /> : <X size={15} />}<span>{`直连：${res.direct.ok ? `通 · ${res.direct.ms} ms` : res.direct.err}`}</span></div>
            {res.via && <div className={res.via.ok ? 'ok' : 'bad'}>{res.via.ok ? <Check size={15} /> : <X size={15} />}<span>{`经「${viaName}」：${res.via.ok ? `通 · ${res.via.ms} ms` : res.via.err}`}</span></div>}
            {res.via && !res.via.ok && <p className="field-hint">{`经「${viaName}」也连不上：换一台试试；或者地址、端口不对。`}</p>}
            {res.direct.ok && res.via?.ok && <p className="field-hint">直连其实也通，可能只是偶尔不稳；存了以后都经出口走。</p>}
          </div>
        )}
        <div className="row-actions">
          {res?.via && !res.via.ok && <button className="btn ghost" disabled={busy} onClick={() => go(true)}>仍然保存</button>}
          <button className="btn primary" disabled={busy || !t || !via} onClick={() => go()}>{busy ? '测试中…' : via === 'direct' ? '保存' : '测试并保存'}</button>
        </div>
      </div>
    </Sheet>
  )
}
