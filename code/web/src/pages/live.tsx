// 真的一套（LIVE）用的页面：开机 / 登录、AI 执行器、服务器、凭证、数据、触发器、知识库、项目、员工资料、账号安全。
// 演示（/demo）还是用原来那些页面和假数据；没做完的功能在真的一套里显示「还在做」。
import { useEffect, useState, type ReactNode } from 'react'
import type { Credential, CredGroup, DataSource, Employee, EnvTag, KbDoc, Trigger, Workspace } from '../types'
import { empName, getState, logout, requireVerify, saveEmployee, SOON, toast, togglePin, toggleTrigger, useStore } from '../store'
import { api, boot, call } from '../live'
import { Avatar } from '../components/Avatar'
import { Mark, Wordmark } from '../components/brand'
import { Empty, Field, InlineText, Meter, PageHeader, Row, Section, Segmented, Sheet, Stat, StatusDot, Table, Tag, Toggle } from '../components/ui'
import { IconCheck, IconChevron, IconPlus } from '../components/icons'
import { Markdown } from '../components/Markdown'
import { WorkSheet } from '../components/WorkSheet'
import { EditableAvatar } from '../components/AvatarPicker'
import { PackagesSection } from '../components/Packages'
import { EgressSection } from '../components/Egress'
import { ReleaseSection } from './release'
import { AskBar, Manual } from '../components/AskBar'
import { approvalLabel, effortLabel, execKind, modelsFor } from '../work'
import { ExecPicker, ExecutorSetup, execState, type AiInfo } from '../components/ExecutorSetup'
import { AppIcon } from '../components/AppIcon'
import { LangPicker } from '../components/LangPicker'
import { useLang } from '../i18n'
import { CUR } from '../mode'
import { headNav, type PageProps } from './nav'
import { BuildSection, DirsSection, EmployeeWorkSections, PolicySection, WorkspaceAutoSections } from './live2'
import { LogViewer } from './live3'
import { EmployeeCredsSection } from './creds'
import { getPasskey, passkeySupported, createPasskey, passkeyError, markPkHere } from '../webauthn'
import { EmpName } from '../components/EmpName'

// 环境是标签：随便起名、要几个都行；「改东西先确认」是单独的开关，没设过按标签猜（和后台 env.ts 一样）
const PROD_RE = /生产|正式|線上|线上|prod|production|live/i
const isProtected = (x: { env: string; protect?: boolean }) => x.protect ?? PROD_RE.test(x.env)
export const envTone = (e: EnvTag) => (PROD_RE.test(e) ? 'danger' : /测试|測試|test|uat|staging|预发|預發/i.test(e) ? 'warn' : 'mute')

/** 选环境标签：点已有的，或者写一个新的 */
export function EnvPicker({ value, onChange }: { value: EnvTag; onChange: (v: EnvTag) => void }) {
  // 只选 store 里本来就有的数组（选出新数组会让订阅一直重画）
  const servers = useStore((s) => s.servers)
  const sources = useStore((s) => s.dataSources)
  const creds = useStore((s) => s.credentials)
  const tags = [...new Set(['开发', '测试', '生产', ...servers.map((x) => x.env), ...sources.map((x) => x.env), ...creds.map((x) => x.env), value].filter(Boolean))]
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const add = () => { const t = text.trim().slice(0, 20); if (t) onChange(t); setText(''); setAdding(false) }
  return (
    <div className="chips">
      {tags.map((t) => <button key={t} type="button" className={`chip${t === value ? ' on' : ''}`} onClick={() => onChange(t)}>{t}</button>)}
      {adding
        ? <input autoFocus className="chip-input" value={text} maxLength={20} onChange={(e) => setText(e.target.value)} onBlur={add} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } if (e.key === 'Escape') setAdding(false) }} placeholder="比如：uat、海外生产" />
        : <button type="button" className="chip" onClick={() => setAdding(true)}>+ 新标签</button>}
    </div>
  )
}
const copy = (t: string) => { navigator.clipboard?.writeText(t).catch(() => {}); toast('已复制') }

// ======================= 登录 / 设主人 =======================
export function LiveLogin() {
  const a = useStore((s) => s.auth)
  // 记住上次登录的账号：下次只输密码
  const [email, setEmail] = useState(() => localStorage.getItem('opero.email') ?? '')
  const [pwd, setPwd] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [busy, setBusy] = useState(false)
  // 开了两步验证：输完密码还要输一个码
  const [ticket, setTicket] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const first = !!a.needOwner
  const go = async () => {
    if (!email.trim() || !pwd) { toast('账号和密码都要填'); return }
    if (first && pwd.length < 8) { toast('密码至少 8 位'); return }
    setBusy(true)
    try {
      const r = await api<{ mfa?: boolean; ticket?: string }>('POST', first ? '/api/auth/setup' : '/api/auth/login', first ? { email: email.trim(), name: email.trim().split('@')[0] || '主人', password: pwd } : { email: email.trim(), password: pwd })
      localStorage.setItem('opero.email', email.trim())
      if (r.mfa && r.ticket) { setTicket(r.ticket); return }
      await boot()
    } catch (e) {
      toast((e as Error).message)
    } finally { setBusy(false) }
  }
  const sendCode = async (v = code) => {
    if (!ticket || !v.trim()) return
    setBusy(true)
    try { await api('POST', '/api/auth/mfa', { ticket, code: v.trim() }); await boot() } catch (e) { toast((e as Error).message); if (/过期|太多/.test((e as Error).message)) setTicket(null) } finally { setBusy(false) }
  }
  const withPasskey = async () => {
    setBusy(true)
    try { const o = await api('POST', '/api/auth/passkey/options', {}); let cred; try { cred = await getPasskey(o) } catch (e) { toast(passkeyError(e)); return } await api('POST', '/api/auth/passkey/login', cred); markPkHere(); await boot() } catch (e) { toast((e as Error).message) } finally { setBusy(false) }
  }
  if (ticket) return (
    <div className="auth">
      <div className="auth-box">
        <div className="auth-logo"><Wordmark size={40} /></div>
        <p className="sub center">输入验证器 App 里的 6 位动态码（或者一个恢复码）</p>
        <Field label="动态码"><input autoFocus value={code} onChange={(e) => { const v = e.target.value; setCode(v); if (/^\d{6}$/.test(v.trim())) void sendCode(v) }} inputMode="numeric" autoComplete="one-time-code" onKeyDown={(e) => e.key === 'Enter' && sendCode()} /></Field>
        <button className="btn primary block" disabled={busy || !code.trim()} onClick={() => sendCode()}>{busy ? '…' : '登录'}</button>
        <button className="btn ghost block" onClick={() => { setTicket(null); setCode('') }}>返回</button>
      </div>
    </div>
  )
  return (
    <div className="auth">
      <div className="auth-box">
        <div className="auth-logo"><Wordmark size={40} /></div>
        <p className="sub center">{first ? '第一次打开：设一个主人账号（这套 Opero 只有你一个人用）' : '你自己部署的 AI 开发团队'}</p>
        {a.error && <div className="banner b-warn">连不上后台：{a.error}</div>}
        <Field label="账号（邮箱）"><input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" placeholder="you@example.com" /></Field>
        <Field label={first ? '密码（至少 8 位）' : '密码'}>
          <input type={showPwd ? 'text' : 'password'} value={pwd} autoFocus={!!email} onChange={(e) => setPwd(e.target.value)} autoComplete={first ? 'new-password' : 'current-password'}
            onKeyDown={(e) => e.key === 'Enter' && go()} />
        </Field>
        {first && <label className="nowrap sub"><input type="checkbox" checked={showPwd} onChange={(e) => setShowPwd(e.target.checked)} /> 显示密码（看清楚再创建）</label>}
        <button className="btn primary block lg" onClick={go} disabled={busy}>{busy ? '稍等…' : first ? '创建并进入' : '登录'}</button>
        {!first && passkeySupported() && <button className="btn default block" onClick={withPasskey} disabled={busy}>用通行密钥登录</button>}
        {!first && <p className="hint center">忘了密码：在服务器上运行 <span className="mono">opero reset-password</span></p>}
        <div className="auth-lang"><LangPicker /></div>
      </div>
    </div>
  )
}

// ======================= AI 执行器 =======================
function useAi(host = 'local') {
  const [info, setInfo] = useState<AiInfo | null>(null)
  const load = () => call<AiInfo>('GET', `/api/ai?host=${encodeURIComponent(host)}`).then((r) => { if (r) setInfo(r) })
  useEffect(() => { setInfo(null); load() }, [host]) // eslint-disable-line react-hooks/exhaustive-deps
  return { info, load }
}

function IsolationNote({ info }: { info: AiInfo }) {
  return info.isolated
    ? <div className="banner b-ok"><IconCheck size={14} /> AI 跑在单独的系统用户「{info.aiUser}」下，读不到 Opero 的数据目录和保险箱</div>
    : <div className="banner b-warn">AI 和 Opero 是同一个系统用户（开发模式）：理论上 AI 能读到保险箱文件。正式用请用安装脚本装（会建 opero-ai 用户）。</div>
}

/** 能让员工干活的机器：Opero 这台 + 装了 Agent 的 */
export function useWorkHosts() {
  const servers = useStore((s) => s.servers)
  return servers.filter((x) => x.id === 'local' || x.via === 'agent')
}
/** 服务器显示名：Opero 自己这台没改过名就叫「Opero 这台」 */
export const srvName = (x: { id: string; name: string }) => (x.id === 'local' && x.name === '本机' ? 'Opero 这台' : x.name)
const hostLabel = (x: { id: string; name: string; online: boolean; via?: string }) => (x.id === 'local' ? srvName(x) : `${x.name}${x.online ? '' : '（离线）'}`)

export function ExecutorsPage({ params, nav }: PageProps) {
  const workHosts = useWorkHosts()
  const [host, setHost] = useState<string>(params.host ?? 'local')
  const { info, load } = useAi(host)
  const cur = workHosts.find((x) => x.id === host)
  return (
    <div className="page">
      <PageHeader title="AI 执行器" sub="员工用哪个 AI 干活：每台干活的服务器各装一份，账号共用" {...headNav(nav)} />
      <div className="page-body">
        {workHosts.length > 1 && (
          <div className="pad">
            <Field label="在哪台服务器上"><select value={host} onChange={(e) => setHost(e.target.value)}>{workHosts.map((x) => <option key={x.id} value={x.id}>{hostLabel(x)}</option>)}</select></Field>
          </div>
        )}
        {cur && cur.via === 'agent' && !cur.online && <div className="pad"><div className="banner b-warn">这台的 Agent 现在不在线，装不了也登录不了：先看那台机器上的 opero-agent 服务</div></div>}
        {!info ? <Empty>Agent 在查服务器上装了什么…</Empty> : (
          <>
            <div className="pad"><IsolationNote info={info} /></div>
            <div className="pad"><ExecutorSetup key={host} info={info} reload={load} host={host} /></div>
          </>
        )}
        <p className="hint">没看到要装的那台？先在「应用 → 服务器 → 接入」给它装 Agent。</p>
      </div>
    </div>
  )
}

// ======================= 开机向导 =======================
const PRESETS: { key: string; name: string; desc: string }[] = [
  { key: 'butler', name: '系统管家', desc: '管 Opero 本身：怎么设置、整理知识库、转派' },
  { key: 'dev', name: '开发', desc: '在项目里改代码、提交、推送' },
  { key: 'ops', name: '运维', desc: '看服务器、查问题；改之前先问你' },
  { key: 'logwatch', name: '日志值班', desc: '配个触发器定时巡检日志，有问题发卡片' },
  { key: 'inbox', name: '消息助理', desc: '看邮件和 Slack，告诉你哪些要你看，写回复建议（不替你发）' },
]

export function LiveSetup() {
  const me = useStore((s) => s.me)
  const emps = useStore((s) => s.employees)
  const local = useStore((s) => s.servers.find((x) => x.id === 'local'))
  const instance = useStore((s) => s.instance)
  const { info, load } = useAi()
  // 顺序：① 账号 → ② Agent（这台服务器）→ ③ 让 Agent 装好、登录 AI 执行器 → ④ 建员工
  const [step, setStep] = useState(1)
  const [exec, setExec] = useState('Claude Code')
  const [picked, setPicked] = useState<string[]>(['butler', 'dev', 'ops'])
  const [busy, setBusy] = useState(false)
  const ready = !!info && (({ installed, loggedIn }) => !!installed && loggedIn)(execState(info, execKind(exec)))
  const make = async () => {
    setBusy(true)
    const r = await call('POST', '/api/setup/employees', { presets: picked.filter((k) => !emps.some((e) => e.id === k)), executor: exec, model: modelsFor(exec)[0] })
    setBusy(false)
    if (r) setStep(4)
  }
  const finish = async () => { await call('POST', '/api/setup/done'); await boot() }
  return (
    <div className="onboard">
      <header className="onboard-head">
        <Mark size={30} /><b>开机向导</b><span className="grow" />
        <button className="btn ghost sm" onClick={finish}>跳过</button>
      </header>
      <div className="onboard-steps">
        {['你的账号', '服务器 Agent', '接 AI 执行器', '建员工'].map((s, i) => (
          <span key={s} className={'ostep' + (i < step ? ' done' : i === step ? ' on' : '')}>{i < step ? '✓' : i + 1} {s}</span>
        ))}
      </div>
      <div className="onboard-body">
        <Bot>欢迎！跟着点三步就能和 AI 员工聊天：确认服务器上的 Agent → 让 Agent 装好并登录 Claude Code → 建几个员工。全程点按钮，不用敲命令。</Bot>
        <Done title="① 你的账号" text={`${me.name || '主人'} · ${me.email}。这套 Opero 只有你一个人用。`} />

        {step === 1 && (
          <StepCard title="② 服务器 Agent" desc="Agent 是装在服务器上、替员工干活的那部分：装 AI 执行器、跑命令、连服务器和数据库都由它来做。">
            <div className={'banner ' + (local?.online !== false ? 'b-ok' : 'b-warn')}>
              <IconCheck size={14} /> Agent 已经在这台服务器上运行（装 Opero 时一起装好的）
            </div>
            <div className="sheet-list">
              <Row title="服务器" right={local ? `${local.os || '本机'}` : '本机'} />
              {local && local.online && <Row title="负载" right={`CPU ${local.cpu}% · 内存 ${local.mem}% · 磁盘 ${local.disk}%`} />}
              <Row title="Agent 版本" right={instance?.version ?? '—'} />
            </div>
            {info && <IsolationNote info={info} />}
            <p className="field-hint">员工就在这台服务器上干活；要它们连别的服务器跑命令，进 Opero 后在「应用 → 服务器」里用 SSH 接进来。</p>
            <div className="row-actions"><button className="btn primary" onClick={() => setStep(2)}>下一步：让 Agent 装 AI 执行器</button></div>
          </StepCard>
        )}
        {step > 1 && <Done title="② 服务器 Agent" text={`在线 · ${local?.os || '本机'} · Agent ${instance?.version ?? ''}`} />}

        {step === 2 && (
          <StepCard title="③ 接 AI 执行器" desc="员工靠它干活。下面三步都是点按钮：Agent 在服务器上替你装好、带你登录。">
            {!info ? <p className="sub">Agent 在查服务器上装了什么…</p> : (
              <>
                <ExecutorSetup info={info} reload={load} onReady={setExec} />
                <div className="row-actions">
                  {!ready && <button className="btn ghost" onClick={() => setStep(3)}>先跳过</button>}
                  <button className="btn primary" disabled={!ready} onClick={() => setStep(3)}>下一步</button>
                </div>
                {!ready && <p className="field-hint">装好并登录之后才能点「下一步」；也可以先跳过，以后在「我 → AI 执行器」里弄。</p>}
              </>
            )}
          </StepCard>
        )}
        {step > 2 && <Done title="③ 接 AI 执行器" text={ready ? `${exec} 已装好、已登录（以后在「我 → AI 执行器」改）` : '先跳过了：员工要干活前，去「我 → AI 执行器」装好并登录'} />}

        {step === 3 && (
          <StepCard title="④ 建几个员工" desc="每个员工是一个会话，有自己的角色；名字、职责以后都能改。">
            <Field label="它们用哪个执行器"><ExecPicker value={exec} onChange={setExec} info={info} /></Field>
            <div className="sheet-list">
              {PRESETS.map((p) => (
                <button key={p.key} className={'radio-row' + (picked.includes(p.key) ? ' on' : '')} onClick={() => setPicked((x) => (x.includes(p.key) ? x.filter((y) => y !== p.key) : [...x, p.key]))}>
                  <i className="radio" /><span><b>{p.name}</b><small>{p.desc}</small></span>
                </button>
              ))}
            </div>
            <div className="row-actions"><button className="btn primary" disabled={busy || !picked.length} onClick={make}>{busy ? '建中…' : `建好这 ${picked.length} 个`}</button></div>
          </StepCard>
        )}
        {step >= 4 && (
          <>
            <Done title="④ 建员工" text={`建好了：${emps.map((e) => e.name).join('、')}`} />
            <Bot>都好了 🎉 接下来可以在「应用」里接服务器、数据库、代码仓库，员工就能替你去查、去做。</Bot>
            <div className="row-actions center"><button className="btn primary lg" onClick={finish}>进入 Opero</button></div>
          </>
        )}
      </div>
    </div>
  )
}

function Bot({ children }: { children: ReactNode }) {
  return <div className="row"><span className="avatar bot"><Mark size={22} /></span><div className="bubble">{children}</div></div>
}
function StepCard({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="row"><span className="avatar bot"><Mark size={22} /></span>
      <div className="card k-primary step-card"><div className="card-head"><span className="card-title">{title}</span></div><p className="note">{desc}</p>{children}</div>
    </div>
  )
}
function Done({ title, text }: { title: string; text: string }) {
  return (
    <div className="row"><span className="avatar bot"><Mark size={22} /></span>
      <div className="card done-card"><div className="card-head inline"><IconCheck size={16} /><span className="card-title">{title}</span></div><p className="note sub">{text}</p></div>
    </div>
  )
}

// ======================= 还在做 =======================
export function ComingSoonPage({ params, nav }: PageProps) {
  const lang = useLang()
  const demo = lang.startsWith('zh') ? 'https://opero.yimakeji.cn/demo' : 'https://opero.yimaworks.com/demo'
  return (
    <div className="page">
      <PageHeader title={params.title ?? '还在做'} {...headNav(nav)} />
      <div className="page-body">
        <div className="pad"><div className="banner b-info">{SOON}。想先看看长什么样，打开官网的「在线试用」。</div></div>
        <div className="pad row-actions"><a className="btn default" href={demo} target="_blank" rel="noreferrer">看在线试用</a></div>
      </div>
    </div>
  )
}

// ======================= 应用首页 =======================
export const LIVE_APPS: { page: any; name: string; desc: string; letter: string }[] = [
  { page: 'servers', name: '服务器和 Agent', desc: '装 Agent 让员工在上面干活；或 SSH 跑命令', letter: '服' },
  { page: 'credentials', name: '凭证', desc: '代码仓库、数据库、服务器、云账号、AI 的账号和令牌，加密存着', letter: '凭' },
  { page: 'data', name: '数据', desc: 'MySQL / PostgreSQL，默认只读', letter: '数' },
  { page: 'issues', name: '问题清单', desc: '日志巡检记下来的线上问题', letter: '问' },
  { page: 'domains', name: '域名', desc: 'DNS 解析，开给员工改', letter: '域' },
  { page: 'inbox', name: '收件箱', desc: '邮件、Slack 分好类，回复建议只写不发', letter: '收' },
  { page: 'channels', name: '消息渠道', desc: '收邮件 / Slack；提醒发到 Telegram、企业微信、钉钉、飞书、邮件', letter: '渠' },
  { page: 'triggers', name: '触发器', desc: '定时 / Webhook → 员工', letter: '触' },
  { page: 'knowledge', name: '知识库', desc: '所有员工共用的资料', letter: '知' },
  { page: 'audit', name: '操作记录', desc: '员工做的每件事', letter: '记' },
]
/** 这套 Opero 的配置（不放在「我」里）：应用页下面一组、电脑侧栏「应用」下面一段 */
export const LIVE_CONFIG: { page: any; name: string; desc: string }[] = [
  { page: 'executors', name: 'AI 执行器', desc: 'Claude Code、Codex、Qwen Code、CodeBuddy：装、登录，多个账号、默认用哪个' },
  { page: 'usage', name: '用量和成本', desc: '每个员工花了多少、每月预算' },
  { page: 'system', name: '系统设置', desc: '生产保护、每轮小结、提醒发到哪、开机向导' },
  { page: 'about', name: '关于 Opero', desc: '版本、开源许可' },
]
const SOON_APPS = ['流程', '插件']

export function LiveAppsPage({ nav }: PageProps) {
  const s = useStore((x) => x)
  const n: Record<string, string> = {
    servers: `${s.servers.length} 台`, credentials: `${s.credentials.length} 个`, data: `${s.dataSources.length} 个库`,
    triggers: `${s.triggers.filter((t) => t.enabled).length} 个开着`, knowledge: `${s.kb.length} 份`, audit: `${s.audit.length} 条`,
  }
  return (
    <div className="page">
      <PageHeader title="应用" sub="员工用它们干活，你也可以直接看" {...headNav(nav)} />
      <div className="page-body">
        <div className="tiles">
          {LIVE_APPS.map((t) => (
            <button key={t.page} className="tile" onClick={() => nav.push({ page: t.page })}>
              <span className="tile-head"><AppIcon page={t.page} fallback={t.letter} /><b>{t.name}</b></span>
              <span className="sub">{t.desc}</span>{n[t.page] && <span className="tile-n">{n[t.page]}</span>}
            </button>
          ))}
        </div>
        <p className="hint">还在做：{SOON_APPS.join('、')}。</p>
        <Section title="这套 Opero 的配置">{LIVE_CONFIG.map((a) => <Row key={a.page} icon={<AppIcon page={a.page} size={34} />} title={a.name} sub={a.desc} chevron onClick={() => nav.push({ page: a.page })} />)}</Section>
      </div>
    </div>
  )
}

// ======================= 服务器和 Agent =======================
const ago = (ts?: number) => {
  if (!ts) return '从没连上过'
  const s = Math.round((Date.now() - ts) / 1000)
  return s < 60 ? '刚刚' : s < 3600 ? `${Math.round(s / 60)} 分钟前` : s < 86400 ? `${Math.round(s / 3600)} 小时前` : `${Math.round(s / 86400)} 天前`
}

export function LiveServersPage({ nav }: PageProps) {
  const list = useStore((s) => s.servers)
  const work = list.filter((x) => x.id === 'local' || x.via === 'agent')
  const pending = list.filter((x) => x.via === 'pending')
  const ssh = list.filter((x) => x.id !== 'local' && x.via !== 'agent' && x.via !== 'pending' && x.via !== 'rejected')
  const [fp, setFp] = useState('')
  const [moving, setMoving] = useState(false)
  const [newUrl, setNewUrl] = useState(() => location.origin)
  useEffect(() => { call<{ fingerprint: string }>('GET', '/api/agents/fingerprint').then((r) => r && setFp(r.fingerprint)) }, [])
  const decide = (id: string, ok: boolean) => call('POST', `/api/agents/${id}/${ok ? 'accept' : 'reject'}`, undefined, ok ? '已接受，这台马上连上' : '已拒绝')
  const move = async () => {
    const r = await call<{ sent: number }>('POST', '/api/agents/move', { url: newUrl.trim() })
    if (r) { toast(`已通知 ${r.sent} 台 Agent 改连新地址`); setMoving(false) }
  }
  const row = (s: (typeof list)[number]) => (
    <Row key={s.id} chevron onClick={() => nav.push({ page: 'server', params: { id: s.id } })}
      icon={<span className="ws-icon">{s.name.slice(0, 1)}</span>}
      title={<><StatusDot tone={s.online ? 'ok' : 'danger'} /> {srvName(s)} <Tag tone={envTone(s.env)}>{s.env}</Tag>{s.via === 'agent' && <Tag tone="primary">Agent {s.agentVersion}</Tag>}</>}
      sub={s.online
        ? `CPU ${s.cpu}% · 内存 ${s.mem}% · 磁盘 ${s.disk}%${s.via === 'agent' || s.id === 'local' ? ` · Claude Code ${s.executors?.claude ? '已装' : s.id === 'local' ? '看「AI 执行器」' : '没装'}` : ''}`
        : s.via === 'agent' ? `离线 · 最后心跳 ${ago(s.lastSeen)}` : '连不上'} />
  )
  return (
    <div className="page">
      <PageHeader title="服务器和 Agent" sub="装了 Agent 的服务器，员工能在上面干活；只用 SSH 的只能跑命令" {...headNav(nav)}
        right={<button className="btn primary sm" onClick={() => nav.push({ page: 'serverAdd' })}><IconPlus /> 接入</button>} />
      <div className="page-body">
        {pending.length > 0 && (
          <Section title={`等你接受 · ${pending.length}`} right={<span className="sub">没带令牌、按指纹来接入的机器</span>}>
            {pending.map((s) => (
              <div key={s.id} className="lrow col">
                <span className="row-main">
                  <span className="row-title">{s.name} <span className="sub">{s.ip}{s.os ? ` · ${s.os}` : ''}</span></span>
                  <span className="row-sub mono small" data-no-i18n="">{s.agentFp}</span>
                  <span className="row-sub">在那台上运行 opero fingerprint，指纹一样再接受</span>
                </span>
                <div className="row-actions">
                  <button className="btn ghost sm" onClick={() => decide(s.id, false)}>拒绝</button>
                  <button className="btn primary sm" onClick={() => decide(s.id, true)}>接受</button>
                </div>
              </div>
            ))}
          </Section>
        )}
        <Section title={`员工能在上面干活 · ${work.length}`}>{work.map(row)}</Section>
        {ssh.length > 0 && <Section title={`只用 SSH 连 · ${ssh.length}`}>{ssh.map(row)}</Section>}
        <EgressSection onJoin={() => nav.push({ page: 'serverAdd' })} />
        <p className="hint">接入别的服务器：点右上角「接入」→ 复制一条命令到那台机器用 root 跑 → 几秒后这里就出现。那台机器不用开端口；原来装的别的 Agent 不受影响。</p>
        <Section title="指纹和迁移">
          <Row title="这套 Opero 的指纹" sub="Agent 只执行这个指纹签过名的活；别人冒充这个地址也指挥不了你的机器" right={<span className="mono small" data-no-i18n="">{fp}</span>} />
          <Row title="换地址（迁移）" sub="Opero 搬到新域名 / 新服务器（数据目录带过去，指纹不变）：让所有在线的 Agent 改连新地址，不用重新接入" chevron onClick={() => setMoving(!moving)} />
          {moving && (
            <div className="pad form">
              <Field label="新地址" hint="先确认新地址能打开、是同一套（指纹一样），再点；Agent 会改配置并重启自己"><input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://opero.example.com" /></Field>
              <button className="btn primary" disabled={!/^https?:\/\//.test(newUrl.trim())} onClick={move}>让 Agent 改连新地址</button>
              <p className="field-hint">也可以在每台上自己改：sudo opero agent-url https://新地址</p>
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}

export function LiveServerAddPage({ nav }: PageProps) {
  const [mode, setMode] = useState<'agent' | 'ssh'>('agent')
  return (
    <div className="page">
      <PageHeader title="接入服务器" {...headNav(nav)} />
      <div className="page-body form">
        <Segmented value={mode} onChange={setMode} options={[{ value: 'agent', label: '装 Agent（推荐：员工能在上面干活）' }, { value: 'ssh', label: '只用 SSH（只跑命令）' }]} />
        {mode === 'agent' ? <AgentJoin nav={nav} /> : <SshAdd nav={nav} />}
      </div>
    </div>
  )
}

function AgentJoin({ nav, again }: { nav: PageProps['nav']; again?: { name: string; env: EnvTag } }) {
  const servers = useStore((s) => s.servers)
  const [name, setName] = useState(again?.name ?? '')
  const [env, setEnv] = useState<EnvTag>(again?.env ?? '测试')
  const [cn, setCn] = useState(false)
  const [join, setJoin] = useState<{ cmd: string; cmdCn: string; since: number; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const make = async () => {
    setBusy(true)
    const r = await call<{ cmd: string; cmdCn: string; since: number; url: string }>('POST', '/api/agents/join', { name: name.trim(), env })
    setBusy(false)
    if (r) setJoin(r)
  }
  // 命令生成之后才接进来（或重新接入）的那台
  // 按「这次接入」的时间认，不按心跳（别的机器的 Agent 一直在报心跳，不能当成刚接入的）
  const joined = join ? servers.find((x) => x.via === 'agent' && (x.joinedAt ?? 0) >= join.since) : undefined
  const cmd = join ? (cn ? join.cmdCn : join.cmd) : ''
  return (
    <>
      {!join ? (
        <>
          <ol className="exec-howto">
            <li>点「生成安装命令」</li>
            <li>登录那台服务器，用 root（或有 sudo 权限的账号）把命令粘贴进去回车</li>
            <li>等几秒，这里会显示「已接入」</li>
          </ol>
          {!again && <Field label="环境标签" hint="随便起名，要几个都行；像生产的（生产 / prod…）默认改东西先确认，接入后能改"><EnvPicker value={env} onChange={setEnv} /></Field>}
          <button className="btn primary block" disabled={busy} onClick={make}>{busy ? '生成中…' : '生成安装命令'}</button>
        </>
      ) : joined ? (
        <>
          <div className="banner b-ok"><IconCheck size={14} /> 已接入：{joined.name}（{joined.os || joined.ip}）</div>
          <ol className="exec-howto">
            <li>下一步：在这台上装 AI 执行器（一键安装、点按钮登录）</li>
            <li>然后在员工的「编辑 → 跑在哪台服务器」选它</li>
          </ol>
          <div className="row-actions">
            <button className="btn default" onClick={() => nav.push({ page: 'server', params: { id: joined.id } })}>看这台</button>
            <button className="btn primary" onClick={() => nav.push({ page: 'executors', params: { host: joined.id } })}>去装 AI 执行器</button>
          </div>
        </>
      ) : (
        <>
          <Field label="在那台服务器上用 root 跑（30 分钟内有效，用一次就作废）">
            <div className="cmd-box mono">{cmd}<button className="btn ghost sm" onClick={() => copy(cmd)}>复制</button></div>
          </Field>
          <label className="lrow"><span className="row-main"><span className="row-title">服务器在国内</span><span className="row-sub">Node 和 npm 包走国内镜像，装得快</span></span><Toggle on={cn} onChange={setCn} /></label>
          <div className="banner b-info"><i className="spinner" /> 等它连上来…（命令跑完几秒内这里会变成「已接入」）</div>
          <p className="field-hint">那台机器要能访问 {join.url}。重装、或者换一条新命令再跑一次都可以：Opero 认得是同一台机器，不会多出一台。原来装的别的 Agent 不受影响。</p>
          <button className="btn ghost sm" onClick={() => setJoin(null)}>重新生成</button>
        </>
      )}
    </>
  )
}

function SshAdd({ nav }: { nav: PageProps['nav'] }) {
  const creds = useStore((s) => s.credentials.filter((c) => c.group === '服务器'))
  const servers = useStore((s) => s.servers)
  const [f, setF] = useState({ name: '', ip: '', port: '22', user: 'root', env: '测试' as EnvTag, authKind: (creds.length ? 'cred' : 'password') as 'password' | 'key' | 'cred', secret: '', credential: creds[0]?.id ?? '' })
  // 常用的登录用户 + 已经接过的 SSH 服务器用过的
  const users = [...new Set(['root', 'ubuntu', 'ec2-user', 'admin', ...servers.map((x) => x.user).filter((x): x is string => !!x)])].slice(0, 6)
  const [busy, setBusy] = useState(false)
  const up = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }))
  const save = async () => {
    if (!f.ip.trim()) { toast('地址要填'); return }
    setBusy(true)
    const r = await call<any>('POST', '/api/servers', { ...f, secret: f.authKind === 'cred' ? undefined : f.secret, credential: f.authKind === 'cred' ? f.credential : undefined })
    setBusy(false)
    if (r) { toast(r.online ? `已连上 ${r.name}` : `已加上，但还连不上：${(r.error ?? '').slice(0, 60)}`); nav.back() }
  }
  return (
    <>
      <p className="field-hint">只用 SSH 的服务器，员工能经 Opero 在上面跑命令（server_exec），但不能在上面干活（跑 Claude Code）。要在上面干活就装 Agent。</p>
      <Field label="地址（IP 或域名）" hint="名字先用地址，接入后能改"><input value={f.ip} onChange={(e) => up({ ip: e.target.value })} placeholder="203.0.113.10" /></Field>
      <Field label="登录用户"><div className="chips">{users.map((u) => <button key={u} type="button" className={'chip' + (f.user === u ? ' on' : '')} onClick={() => up({ user: u })}>{u}</button>)}</div></Field>
      <Field label="SSH 端口"><div className="chips">{['22', '2222', '22022'].map((x) => <button key={x} type="button" className={'chip' + (f.port === x ? ' on' : '')} onClick={() => up({ port: x })}>{x}</button>)}<input className="chip-input" value={['22', '2222', '22022'].includes(f.port) ? '' : f.port} onChange={(e) => up({ port: e.target.value || '22' })} placeholder="别的" inputMode="numeric" /></div></Field>
      <Field label="环境标签" hint="随便起名；像生产的默认改东西先确认，接入后能改"><EnvPicker value={f.env} onChange={(v) => up({ env: v })} /></Field>
      <Field label="登录方式"><Segmented value={f.authKind} onChange={(v) => up({ authKind: v })} options={[{ value: 'password', label: '密码' }, { value: 'key', label: '私钥' }, ...(creds.length ? [{ value: 'cred' as const, label: '已带进来的' }] : [])]} /></Field>
      {f.authKind === 'password' && <Field label="密码"><input type="password" value={f.secret} onChange={(e) => up({ secret: e.target.value })} autoComplete="new-password" /></Field>}
      {f.authKind === 'key' && <label className="btn ghost sm">从文件读私钥<input type="file" hidden onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file && file.size < 64 * 1024) up({ secret: await file.text() }) }} /></label>}
      {f.authKind === 'key' && <Field label="私钥（整段粘贴，或者点上面从文件读）"><textarea className="mono code-edit" rows={6} value={f.secret} onChange={(e) => up({ secret: e.target.value })} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" /></Field>}
      {f.authKind === 'cred' && (
        <Field label="用哪个账号"><select value={f.credential} onChange={(e) => up({ credential: e.target.value })}><option value="">选一个</option>{creds.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      )}
      <button className="btn primary block" disabled={busy} onClick={save}>{busy ? '连接中…' : '接入'}</button>
      <p className="field-hint">密码 / 私钥加密存进「凭证」；第一次连上会记下主机指纹，之后对不上就拒绝。</p>
    </>
  )
}

// 服务器上常看的：点一下就跑（都是只读命令，不用确认）
const CMD_PRESETS: [string, string][] = [
  ['概况', 'uptime && df -h / && free -m'],
  ['磁盘', 'df -h'],
  ['占内存最多', 'ps aux --sort=-%mem | head -n 15'],
  ['占 CPU 最多', 'ps aux --sort=-%cpu | head -n 15'],
  ['在跑的服务', 'systemctl list-units --type=service --state=running --no-legend --plain | head -n 60'],
  ['开着的端口', 'ss -ltnp | head -n 40'],
  ['Docker 容器', 'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"'],
  ['最近登录', 'last -n 15'],
]
export function LiveServerPage({ params, nav }: PageProps) {
  const s = useStore((x) => x.servers.find((v) => v.id === params.id))
  const emps = useStore((x) => x.employees)
  const [cmd, setCmd] = useState('df -h / && free -m && uptime')
  const [out, setOut] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rejoin, setRejoin] = useState(false)
  useEffect(() => { setRejoin(false) }, [s?.via, s?.joinedAt])
  const [naming, setNaming] = useState<string | null>(null)
  const opVer = useStore((x) => x.instance?.version)
  const prodProtect = useStore((x) => x.settings.prodProtect)
  if (!s) return <div className="page"><PageHeader title="服务器" {...headNav(nav)} /><Empty>找不到</Empty></div>
  const agent = s.via === 'agent'
  const work = agent || s.id === 'local'
  const run = async (c = cmd) => {
    setCmd(c)
    setBusy(true)
    setOut('…')
    const r = await call<{ code: number; out: string; ms: number }>('POST', `/api/servers/${s.id}/exec`, { command: c })
    setBusy(false)
    setOut(r ? `$ ${c}\n${r.out}\n[退出码 ${r.code} · ${r.ms} ms]` : null)
  }
  const remove = () => { if (confirm(`从 Opero 里去掉「${s.name}」？（服务器本身不受影响）`)) call('DELETE', `/api/servers/${s.id}`, undefined, '已去掉').then(() => nav.back()) }
  const removeAgent = () => { if (confirm(`移除「${s.name}」的 Agent？那台的 Agent 会被拒绝连接，跑在上面的员工会停；以后可以重新接入`)) call('DELETE', `/api/agents/${s.id}`, undefined, '已移除 Agent') }
  const onIt = emps.filter((e) => e.host === s.id)
  const saveName = async () => {
    const n = (naming ?? '').trim()
    if (!n || n === s.name) { setNaming(null); return }
    if (await call('PUT', `/api/servers/${s.id}`, { name: n }, '已改名')) setNaming(null)
  }
  const setEnv = (env: EnvTag) => { if (env !== s.env) call('PUT', `/api/servers/${s.id}`, { env }, `已改成「${env}」`) }
  const setProtect = (protect: boolean) => call('PUT', `/api/servers/${s.id}`, { protect }, protect ? '这台改东西先确认' : '这台改东西不用确认')
  const sys = s.sys
  const up = (sec: number) => sec >= 86400 ? `${Math.floor(sec / 86400)} 天` : sec >= 3600 ? `${Math.floor(sec / 3600)} 小时` : `${Math.max(1, Math.floor(sec / 60))} 分钟`
  return (
    <div className="page">
      <PageHeader title={srvName(s)} sub={`${s.ip}${s.os ? ' · ' + s.os : ''}`} {...headNav(nav)}
        right={!agent ? <button className="btn default sm" onClick={() => call('POST', `/api/servers/${s.id}/check`, undefined, '已刷新')}>刷新</button> : undefined} />
      <div className="page-body">
        <div className="pad meters"><Meter label="CPU" value={s.cpu} /><Meter label="内存" value={s.mem} /><Meter label="磁盘" value={s.disk} /></div>
        {!s.online && s.error && <div className="pad"><div className="banner b-warn">{agent ? s.error : `连不上：${s.error}`}</div></div>}
        <Section title="基本">
          <Row title="状态" right={<><StatusDot tone={s.online ? 'ok' : 'danger'} /> {s.online ? '在线' : '离线'}</>} />
          {naming === null
            ? <Row title="名字" sub="只是在 Opero 里叫什么，不改那台机器的主机名" right={<>{srvName(s)} <button className="btn ghost sm" onClick={() => setNaming(s.name === '本机' && s.id === 'local' ? 'Opero 这台' : s.name)}>改名</button></>} />
            : (
              <div className="pad inline-form">
                <input autoFocus value={naming} maxLength={40} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setNaming(null) }} placeholder="比如：prod-web-1" />
                <button className="btn ghost sm" onClick={() => setNaming(null)}>取消</button>
                <button className="btn primary sm" disabled={!naming.trim()} onClick={saveName}>保存</button>
              </div>
            )}
          <div className="pad"><Field label="环境标签"><EnvPicker value={s.env} onChange={setEnv} /></Field></div>
          <label className="lrow"><span className="row-main"><span className="row-title">改东西先确认</span><span className="row-sub">员工在这台跑会改东西的命令前，先发卡片等你点。没单独设过：标签像生产（生产 / prod…）并且「我 → 设置」的生产保护开着就先确认</span></span><Toggle on={s.protect ?? (isProtected(s) && !!prodProtect)} onChange={setProtect} /></label>
          <Row title="接入方式" right={s.id === 'local' ? (agent ? `Opero 所在的这台 · Agent ${s.agentVersion ?? ''}（root 通道）` : <>没有 root · <button className="btn ghost sm" onClick={() => setRejoin(true)}>装 Agent</button></>) : agent ? `Opero Agent ${s.agentVersion ?? ''} · 最后心跳 ${ago(s.lastSeen)}` : `SSH ${s.user ?? 'root'}@${s.ip}:${s.port ?? 22}`} />
          {s.agentFp && <Row title="Agent 指纹" sub="在那台上运行 opero fingerprint 能看到；Opero 按它认这台机器，换了上报地址也认得" right={<span className="mono small" data-no-i18n="">{s.agentFp}</span>} />}
        </Section>
        {s.id === 'local' && !agent && (
          <Section title="给这台装 Agent（root 通道）">
            <div className="pad form">
              <p className="field-hint">Opero 在这台上是用自己的普通用户跑的：部署到这台、给员工开目录权限、跑要 root 的命令都做不了。装一个 Agent 就有了 root 通道（只加 Agent，不动 Opero 本身），和别的服务器一样用；Agent 停了也不影响 Opero。</p>
              {rejoin ? <AgentJoin nav={nav} again={{ name: s.name, env: s.env }} /> : <button className="btn primary" onClick={() => setRejoin(true)}>在这台装 Agent</button>}
            </div>
          </Section>
        )}
        {sys && (
          <Section title="机器信息" right={<span className="sub">{agent ? 'Agent 每 30 秒自动更新' : '自动读取'}</span>}>
            <Row title="主机名" right={<span className="mono small" data-no-i18n="">{sys.hostname}</span>} />
            <Row title="系统" right={<span data-no-i18n="">{sys.os}</span>} />
            <Row title="内核 / 架构" right={<span className="mono small" data-no-i18n="">{sys.kernel} · {sys.arch}</span>} />
            <Row title="CPU" right={<>{sys.cores} 核{sys.cpuModel && <span className="sub" data-no-i18n=""> · {sys.cpuModel}</span>}</>} />
            <Row title="内存 / 磁盘" right={`${sys.memGb}G / ${sys.diskGb}G`} />
            <Row title="内网地址" right={<span className="mono small" data-no-i18n="">{sys.ips.join(', ') || '—'}</span>} />
            {s.id !== 'local' && <Row title="连接 Opero 的地址" right={<span className="mono small" data-no-i18n="">{s.ip}</span>} />}
            <Row title="已开机" right={up(sys.uptime)} />
          </Section>
        )}
        <div className="pad">
          <AskBar nav={nav} pick={/运维|值班|ops|sre/i} title="这台要配什么，跟员工说" placeholder="比如：把 shop 的日志登记上；让员工能读 /srv/shop"
            context={`（在服务器「${srvName(s)}」的页面说的：登记目录用 server_dir_set、登记日志用 log_register，先自己上去看清楚路径）`}
            suggestions={[
              { label: '找出日志并登记', text: '看看这台上跑了哪些服务、日志在哪，把业务相关的日志都登记上（log_register），登记了什么告诉我' },
              { label: '登记项目目录', text: '看看这台上有哪些项目目录，把员工要看的登记成只读、要部署的登记成能部署（server_dir_set）' },
              { label: '看一下健康', text: '看一下这台的磁盘、内存、负载和关键服务，有问题告诉我' },
            ]} />
        </div>
        {s.via === 'agent' && <DirsSection s={s} />}
        {work && <PolicySection s={s} />}
        {work && (
          <Section title="AI 执行器（这台）" right={<button className="btn ghost sm" onClick={() => nav.push({ page: 'executors', params: { host: s.id } })}>装 / 登录</button>}>
            <Row title="Claude Code" right={s.executors?.claude ?? (s.id === 'local' ? '点右上角看' : '没装')} />
            <Row title="Codex" right={s.executors?.codex ?? (s.id === 'local' ? '点右上角看' : '没装')} />
            <Row title="Qwen Code" right={s.executors?.qwen ?? (s.id === 'local' ? '点右上角看' : '没装')} />
            <Row title="CodeBuddy Code" right={s.executors?.codebuddy ?? (s.id === 'local' ? '点右上角看' : '没装')} />
          </Section>
        )}
        {work && (
          <Section title={`跑在这台的员工 · ${onIt.length}`} right={<span className="sub">在员工「编辑 → 跑在哪台服务器」里选</span>}>
            {onIt.length === 0 && <Empty>还没有</Empty>}
            {onIt.map((e) => <Row key={e.id} icon={<Avatar id={e.id} size={32} />} title={<EmpName e={e} />} chevron onClick={() => nav.openChat(e.id)} />)}
          </Section>
        )}
        {s.online && <LogViewer s={s} />}
        <Section title="跑命令" right={<span className="sub">只读命令直接跑；会改东西的要先验证本人</span>}>
          <div className="pad">
            <div className="inline-form">
              <input className="mono" value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} />
              <button className="btn primary" onClick={() => run()} disabled={busy}>{busy ? '运行中…' : '运行'}</button>
            </div>
            <div className="chips">{CMD_PRESETS.map(([label, c]) => <button key={label} type="button" className="chip" disabled={busy} onClick={() => run(c)}>{label}</button>)}</div>
            {out && <pre className="console">{out}</pre>}
          </div>
        </Section>
        {agent && rejoin && (
          <Section title="重新接入" right={<button className="btn ghost sm" onClick={() => setRejoin(false)}>收起</button>}>
            <div className="pad form">
              <p className="field-hint">重装过系统、换了机器，或者 Agent 连不上了才用：在那台上重新跑一次命令，还是这一台，不会多出一台。</p>
              <AgentJoin nav={nav} again={{ name: s.name, env: s.env }} />
            </div>
          </Section>
        )}
        <div className="pad row-actions wrap">
          <button className="btn default" onClick={() => nav.openChat(getState().employees.find((e) => e.id === 'ops')?.id ?? getState().employees[0]?.id ?? '')}>让员工看看</button>
          {agent && s.id !== 'local' && s.online && s.agentVersion && opVer && s.agentVersion !== opVer && (
            <button className="btn primary" onClick={() => (call('POST', `/api/agents/${s.id}/upgrade`, undefined, '已开始升级：一两分钟后 Agent 会重新连上来'))}>升级 Agent（{s.agentVersion} → {opVer}）</button>
          )}
          {agent && !rejoin && <button className="btn ghost" onClick={() => setRejoin(true)}>重新接入（重装 / 换机器后用）</button>}
          {agent && <button className="btn ghost" onClick={removeAgent}>移除 Agent</button>}
          {s.id !== 'local' && <button className="btn ghost" onClick={remove}>去掉这台</button>}
        </div>
      </div>
    </div>
  )
}

// ======================= 数据 =======================
export function LiveDataPage({ nav }: PageProps) {
  const sources = useStore((s) => s.dataSources)
  const queries = useStore((s) => s.savedQueries)
  return (
    <div className="page">
      <PageHeader title="数据" sub="查库走只读事务；改数据要库是可写的、并且你验证本人" {...headNav(nav)}
        right={<button className="btn primary sm" onClick={() => nav.push({ page: 'credentialEdit', params: { group: '数据库' } })}><IconPlus /> 接入数据库</button>} />
      <div className="page-body">
        <Section title="数据库">
          {sources.length === 0 && <Empty>还没有：点「接入」加一个 MySQL / PostgreSQL</Empty>}
          {sources.map((d) => (
            <Row key={d.id} chevron onClick={() => nav.push({ page: 'query', params: { source: d.id } })} icon={<span className="ws-icon">{d.kind === 'MySQL' ? 'M' : 'P'}</span>}
              title={<>{d.name} <Tag tone={envTone(d.env)}>{d.env}</Tag> {!d.writable && <Tag>只读</Tag>}</>} sub={`${d.kind} · ${d.host}/${d.db} · ${d.tables.length} 张表`} />
          ))}
        </Section>
        {queries.length > 0 && (
          <Section title="常用查询">
            {queries.map((q) => <Row key={q.id} title={q.name} sub={<span className="mono small">{q.sql}</span>} chevron onClick={() => nav.push({ page: 'query', params: { source: q.source, sql: q.sql } })} />)}
          </Section>
        )}
      </div>
    </div>
  )
}

export function LiveQueryPage({ params, nav }: PageProps) {
  const d = useStore((s) => s.dataSources.find((x) => x.id === params.source))
  const queries = useStore((s) => s.savedQueries)
  const [sql, setSql] = useState<string>(params.sql ?? '')
  const [res, setRes] = useState<{ cols: string[]; rows: string[][]; ms: number; total: number; affected?: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [table, setTable] = useState<string | null>(null)
  if (!d) return <div className="page"><PageHeader title="数据" {...headNav(nav)} /><Empty>找不到这个库</Empty></div>
  const write = !/^\s*(select|show|describe|desc|explain|with|values|table)\b/i.test(sql)
  const run = async () => {
    if (!sql.trim()) return
    setBusy(true)
    const r = await call<typeof res>('POST', `/api/data-sources/${d.id}/query`, { sql })
    setBusy(false)
    if (r) setRes(r)
  }
  const remove = () => { if (confirm(`从 Opero 里去掉「${d.name}」？`)) call('DELETE', `/api/data-sources/${d.id}`, undefined, '已去掉').then(() => nav.back()) }
  return (
    <div className="page">
      <PageHeader title={d.name} sub={`${d.kind} · ${d.db} · ${d.env}`} {...headNav(nav)}
        right={<button className="btn default sm" onClick={() => call('POST', `/api/data-sources/${d.id}/schema`, undefined, '表结构已刷新')}>刷新表</button>} />
      <div className="page-body">
        <Section title={`表 · ${d.tables.length}`}>
          <div className="pad chips">
            {d.tables.length === 0 && <span className="sub">还没读到表（点右上角「刷新表」）</span>}
            {d.tables.map((t) => (
              <button key={t.name} className={'chip' + (table === t.name ? ' on' : '')} onClick={() => { setTable(table === t.name ? null : t.name); if (!sql) setSql(`SELECT * FROM ${t.name} LIMIT 20`) }}>
                {t.name} <span className="sub">{t.rows}</span>
              </button>
            ))}
          </div>
          {table && <div className="pad mono small">{d.tables.find((t) => t.name === table)?.cols.join(' · ')}</div>}
        </Section>
        <Section title="SQL" right={sql.trim() && write ? <Tag tone="warn">写操作：要验证本人</Tag> : <Tag>只读</Tag>}>
          <div className="pad">
            <textarea className="mono code-edit" rows={4} value={sql} onChange={(e) => setSql(e.target.value)} placeholder="SELECT …" />
            <div className="chips">{queries.filter((q) => q.source === d.id).map((q) => <button key={q.id} className="chip" onClick={() => setSql(q.sql)}>{q.name}</button>)}</div>
            <div className="row-actions">
              <button className="btn ghost" onClick={() => { const name = sql.replace(/\s+/g, ' ').trim().slice(0, 24); if (name) call('POST', '/api/saved-queries', { source: d.id, name, sql }, '已存成常用查询') }}>存成常用</button>
              <button className="btn primary" onClick={run} disabled={busy}>{busy ? '运行中…' : '运行'}</button>
            </div>
          </div>
        </Section>
        {res && (
          <Section title={res.cols.length ? `结果 · ${res.total} 行${res.total > res.rows.length ? `（显示前 ${res.rows.length}）` : ''} · ${res.ms} ms` : '结果'}>
            {res.cols.length ? <div className="pad"><Table cols={res.cols} rows={res.rows} /></div>
              : <div className="pad"><div className="banner b-ok">执行完成，影响 {res.affected ?? 0} 行 · {res.ms} ms</div></div>}
          </Section>
        )}
        <div className="pad row-actions"><button className="btn ghost" onClick={remove}>去掉这个库</button></div>
      </div>
    </div>
  )
}

// ======================= 触发器 =======================
export function LiveTriggersPage({ nav }: PageProps) {
  const list = useStore((s) => s.triggers)
  return (
    <div className="page">
      <PageHeader title="触发器" sub="到点了 / 有人调 Webhook，员工自己开始干活" {...headNav(nav)}
        right={<button className="btn ghost sm" onClick={() => nav.push({ page: 'triggerEdit' })}>手动建</button>} />
      <div className="page-body">
        <AskBar nav={nav} pick={/管家|助理|秘书|butler|assistant/i} title="要定时做什么，跟员工说一句" placeholder="比如：工作日每天 18:00 总结今天各员工做了什么发给我"
          context="（在「触发器」页面说的：用 schedule_set 建 / 改定时任务，建好告诉我一句什么时候、交给谁）"
          suggestions={[
            { label: '每天 18:00 发小结', text: '每天 18:00 总结今天各员工做了什么、还有什么在等我决定，发给我' },
            { label: '每 30 分钟巡检日志', text: '每 30 分钟巡检一遍所有登记了日志的服务器，有新错误记进问题清单，严重的告诉我' },
            { label: '工作日 9:30 看服务器', text: '工作日 9:30 看一遍所有服务器的磁盘、内存、负载和关键服务，有异常告诉我' },
            { label: '收到报警就查', text: '建一个 Webhook：报警系统调它的时候，把报警内容交给运维去查原因，查到了告诉我' },
          ]} />
        <Section flush>
          {list.length === 0 && <Empty>还没有。比如：每 30 分钟让「日志值班」看一眼生产日志</Empty>}
          {list.map((t) => (
            <Row key={t.id} icon={<Avatar id={t.employee} size={36} />} onClick={() => nav.push({ page: 'triggerEdit', params: { id: t.id } })}
              title={<>{t.name} <Tag tone="primary">{t.kind}</Tag></>} sub={`${t.rule} · 交给 ${empName(t.employee)} · ${t.last}`}
              right={<Toggle on={t.enabled} onChange={() => toggleTrigger(t.id)} label="启用" />} />
          ))}
        </Section>
      </div>
    </div>
  )
}

/** 定时规则：点选，不用手写（存的格式后台认得：每 30 分钟 / 每 2 小时 / 每天 09:00 / 工作日 09:30 / 每周一 10:00） */
// 每一种都写成完整的模板，翻译时按整句对（「每周一 {0}」）
const WEEKLY: Record<string, (hm: string) => string> = {
  周一: (hm) => `每周一 ${hm}`, 周二: (hm) => `每周二 ${hm}`, 周三: (hm) => `每周三 ${hm}`, 周四: (hm) => `每周四 ${hm}`,
  周五: (hm) => `每周五 ${hm}`, 周六: (hm) => `每周六 ${hm}`, 周日: (hm) => `每周日 ${hm}`,
}
function RulePicker({ rule, onChange }: { rule: string; onChange: (r: string) => void }) {
  const m = rule.replace(/\s+/g, '')
  const init = (() => {
    let x = m.match(/^每(\d+)分钟$/); if (x) return { kind: 'min', n: x[1], hm: '09:00', day: '周一' }
    x = m.match(/^每(\d+)(个)?小时$/); if (x) return { kind: 'hour', n: x[1], hm: '09:00', day: '周一' }
    x = m.match(/^每天(\d{1,2}[:：]\d{2})$/); if (x) return { kind: 'day', n: '30', hm: x[1].replace('：', ':'), day: '周一' }
    x = m.match(/^工作日(\d{1,2}[:：]\d{2})$/); if (x) return { kind: 'workday', n: '30', hm: x[1].replace('：', ':'), day: '周一' }
    x = m.match(/^每周([一二三四五六日天])(\d{1,2}[:：]\d{2})$/); if (x) return { kind: 'week', n: '30', hm: x[2].replace('：', ':'), day: '周' + (x[1] === '天' ? '日' : x[1]) }
    return { kind: 'min', n: '30', hm: '09:00', day: '周一' }
  })()
  const [v, setV] = useState(init)
  const emit = (p: Partial<typeof v>) => {
    const x = { ...v, ...p }
    setV(x)
    const n = String(Math.max(1, Number(x.n) || 1))
    onChange(x.kind === 'min' ? `每 ${n} 分钟` : x.kind === 'hour' ? `每 ${n} 小时` : x.kind === 'day' ? `每天 ${x.hm}` : x.kind === 'workday' ? `工作日 ${x.hm}` : WEEKLY[x.day](x.hm))
  }
  useEffect(() => { emit({}) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="inline-form wrap">
      <select value={v.kind} onChange={(e) => emit({ kind: e.target.value })}>
        <option value="min">每隔几分钟</option>
        <option value="hour">每隔几小时</option>
        <option value="day">每天</option>
        <option value="workday">工作日（周一到周五）</option>
        <option value="week">每周</option>
      </select>
      {(v.kind === 'min' || v.kind === 'hour') && <div className="chips">{(v.kind === 'min' ? ['5', '10', '15', '30'] : ['1', '2', '6', '12']).map((n) => <button key={n} type="button" className={'chip' + (v.n === n ? ' on' : '')} onClick={() => emit({ n })}>{n} {v.kind === 'min' ? '分钟' : '小时'}</button>)}</div>}
      {v.kind === 'week' && <select value={v.day} onChange={(e) => emit({ day: e.target.value })}>{Object.keys(WEEKLY).map((d) => <option key={d} value={d}>{d}</option>)}</select>}
      {v.kind !== 'min' && v.kind !== 'hour' && <div className="chips">{['09:00', '12:00', '18:00', '22:00'].map((h) => <button key={h} type="button" className={'chip' + (v.hm === h ? ' on' : '')} onClick={() => emit({ hm: h })}>{h}</button>)}<input type="time" value={v.hm} onChange={(e) => emit({ hm: e.target.value })} style={{ width: 120 }} /></div>}
    </div>
  )
}

/** 触发器常用的活：按员工角色先填好，点一下换 */
const TRIGGER_TPL: { key: string; label: string; text: string }[] = [
  { key: 'logwatch', label: '巡检日志', text: '扫一遍所有登记了日志的服务器（log_scan 只给 server，会扫那台登记的全部日志）。新出现的错误合并同类、记进问题清单，严重的发卡片给我；没有新问题就回一句「正常」。' },
  { key: 'ops', label: '看服务器健康', text: '看一下所有服务器的磁盘、内存、负载和关键服务是不是都在跑。有异常发卡片给我（写清楚哪台、什么问题、建议怎么处理）；都正常就一句话汇总。' },
  { key: 'inbox', label: '整理收件箱', text: '看收件箱里新来的消息，把要我看的列出来（谁、什么事、急不急），知道就行的归类，不用回复。' },
  { key: 'dev', label: '每日构建检查', text: '拉最新代码，跑一遍构建和测试。有失败就查原因并修好、提交推送，告诉我改了什么；都通过就说「正常」。' },
  { key: 'butler', label: '每日小结', text: '总结一下今天各员工做了什么、还有什么在等我决定，列成几条发给我。' },
]
export function LiveTriggerEditPage({ params, nav }: PageProps) {
  const existing = useStore((s) => s.triggers.find((x) => x.id === params.id)) as (Trigger & { prompt?: string; hookPath?: string }) | undefined
  if (!existing) return <TriggerForm params={params} nav={nav} />
  // 已有的：看清楚是什么、开关、跑一次；要改就跟员工说，表单收起来兜底
  const hook = existing.hookPath ? `${location.origin}${existing.hookPath}` : ''
  return (
    <div className="page">
      <PageHeader title={existing.name} sub={`${existing.rule} · 交给 ${empName(existing.employee)} · ${existing.last}`} {...headNav(nav)}
        right={<Toggle on={existing.enabled} onChange={() => toggleTrigger(existing.id)} label="启用" />} />
      <div className="page-body form">
        <div className="trigger-view">
          <Row icon={<Avatar id={existing.employee} size={36} />} title={existing.kind === 'Webhook' ? '有人调 Webhook 地址时' : existing.rule} sub={`交给 ${empName(existing.employee)}`} />
          {hook && <div className="cmd-box mono">{hook}<button className="btn ghost sm" onClick={() => copy(hook)}>复制</button></div>}
          {existing.prompt && <div className="trigger-prompt">{existing.prompt}</div>}
          <div className="row-actions wrap">
            <button className="btn default" onClick={() => call('POST', `/api/triggers/${existing.id}/run`, undefined, `已派给「${empName(existing.employee)}」`)}>现在跑一次</button>
            <button className="btn ghost" onClick={() => { if (confirm('删掉这个触发器？')) call('DELETE', `/api/triggers/${existing.id}`, undefined, '已删除').then(() => nav.back()) }}>删除</button>
          </div>
        </div>
        <AskBar nav={nav} emp={existing.employee} title="要改什么，跟员工说" placeholder="比如：改成工作日 9:00；或者让它顺便看一下磁盘"
          context={`（改定时任务「${existing.name}」，id ${existing.id}：用 schedule_set 改，改好告诉我一句）`} />
        <Manual><TriggerForm params={params} nav={nav} embedded /></Manual>
      </div>
    </div>
  )
}

function TriggerForm({ params, nav, embedded }: PageProps & { embedded?: boolean }) {
  const existing = useStore((s) => s.triggers.find((x) => x.id === params.id)) as (Trigger & { prompt?: string; hookPath?: string }) | undefined
  const employees = useStore((s) => s.employees)
  const servers = useStore((s) => s.servers)
  const tplFor = (empId: string) => TRIGGER_TPL.find((x) => x.key === empId) ?? TRIGGER_TPL.find((x) => (employees.find((e) => e.id === empId)?.menus ?? []).includes('服务器') && x.key === 'ops')
  const [t, setT] = useState<Trigger & { prompt?: string }>(() => {
    if (existing) return existing
    const emp = params.employee ?? employees[0]?.id ?? ''
    return { id: '', name: '', kind: '定时', rule: '每 30 分钟', employee: emp, enabled: true, last: '还没触发', prompt: tplFor(emp)?.text ?? '' }
  })
  const autoName = `${empName(t.employee)} · ${t.kind === 'Webhook' ? 'Webhook' : t.rule}`
  const save = async () => {
    const r = await call(existing ? 'PUT' : 'POST', existing ? `/api/triggers/${t.id}` : '/api/triggers', { ...t, name: t.name.trim() || autoName }, '触发器已保存')
    if (r) nav.back()
  }
  const hook = existing?.hookPath ? `${location.origin}${existing.hookPath}` : ''
  const body = (
      <>
        <Field label="什么时候"><Segmented value={t.kind as '定时' | 'Webhook'} onChange={(v) => setT({ ...t, kind: v })} options={[{ value: '定时', label: '定时' }, { value: 'Webhook', label: 'Webhook' }]} /></Field>
        {t.kind === '定时'
          ? <Field label="规则"><RulePicker rule={t.rule} onChange={(rule) => setT({ ...t, rule })} /></Field>
          : <Field label="地址" hint="别的系统（报警、CI、表单）POST 到这个地址，收到的内容会一起交给员工">
              {hook ? <div className="cmd-box mono">{hook}<button className="btn ghost sm" onClick={() => copy(hook)}>复制</button></div> : <p className="sub">保存后生成（地址里带密钥，别外传）</p>}
            </Field>}
        <Field label="交给哪个员工">
          <div className="chips">{employees.map((e) => <button key={e.id} type="button" className={'chip' + (t.employee === e.id ? ' on' : '')} onClick={() => setT({ ...t, employee: e.id, prompt: !t.prompt || TRIGGER_TPL.some((x) => x.text === t.prompt) ? tplFor(e.id)?.text ?? t.prompt : t.prompt })}>{e.name}</button>)}</div>
        </Field>
        <Field label="要它做什么" hint="点一个常用的，或者自己改；每次触发都把这段话交给员工">
          <div className="chips">{TRIGGER_TPL.map((x) => <button key={x.key} type="button" className={'chip' + (t.prompt === x.text ? ' on' : '')} onClick={() => setT({ ...t, prompt: x.text })}>{x.label}</button>)}</div>
          <textarea rows={5} value={t.prompt ?? ''} onChange={(e) => setT({ ...t, prompt: e.target.value })}
            placeholder={'比如：用 server_exec 看 prod-web-1 上 shop 服务最近 30 分钟的日志（journalctl -u shop --since "30 min ago"），有 ERROR 就合并同类、查原因，发卡片给我；没有就说「正常」。'} />
        </Field>
        {servers.length > 1 && <div className="chips">{servers.map((x) => <button key={x.id} type="button" className="chip" title="把服务器名加进上面的话里" onClick={() => setT({ ...t, prompt: `${t.prompt ?? ''}${t.prompt ? ' ' : ''}「${srvName(x)}」` })}>+ {srvName(x)}</button>)}</div>}
        <Field label="名字（可选）"><input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder={autoName} /></Field>
        <div className="lrow"><span className="row-main"><span className="row-title">启用</span></span><Toggle on={t.enabled} onChange={(v) => setT({ ...t, enabled: v })} /></div>
        {existing && !embedded && (
          <div className="row-actions wrap">
            <button className="btn default" onClick={() => call('POST', `/api/triggers/${t.id}/run`, undefined, `已派给「${empName(t.employee)}」`)}>现在跑一次</button>
            <button className="btn ghost" onClick={() => { if (confirm('删掉这个触发器？')) call('DELETE', `/api/triggers/${t.id}`, undefined, '已删除').then(() => nav.back()) }}>删除</button>
          </div>
        )}
      </>
  )
  if (embedded) return <>{body}<div className="row-actions"><button className="btn primary sm" onClick={save}>保存</button></div></>
  return (
    <div className="page">
      <PageHeader title="新触发器" {...headNav(nav)} right={<button className="btn primary sm" onClick={save}>保存</button>} />
      <div className="page-body form">{body}</div>
    </div>
  )
}

// ======================= 知识库 =======================
const KB_KINDS: KbDoc['kind'][] = ['产品说明', '接口文档', '客户信息', '规范', '其它']
export function LiveKnowledgePage({ nav }: PageProps) {
  const docs = useStore((s) => s.kb) as (KbDoc & { body?: string })[]
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<(KbDoc & { body?: string }) | null>(null)
  const [view, setView] = useState<(KbDoc & { body?: string }) | null>(null)
  const shown = docs.filter((d) => !q.trim() || (d.name + d.summary + (d.body ?? '')).toLowerCase().includes(q.trim().toLowerCase()))
  const blank = { id: '', name: '', kind: '规范' as KbDoc['kind'], updated: '', by: '', summary: '', body: '' }
  const save = async () => {
    if (!edit) return
    // 没起名字：用正文的第一个标题 / 第一行
    const first = (edit.body ?? '').split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) ?? ''
    const r = await call(edit.id ? 'PUT' : 'POST', edit.id ? `/api/kb/${edit.id}` : '/api/kb', { ...edit, name: edit.name.trim() || first.slice(0, 40) }, '已保存，所有员工马上能查到')
    if (r) setEdit(null)
  }
  return (
    <div className="page">
      <PageHeader title="知识库" sub="所有员工共用；员工用 kb_search / kb_get 按需查" {...headNav(nav)}
        right={<button className="btn primary sm" onClick={() => setEdit(blank)}><IconPlus /> 加资料</button>} />
      <div className="page-body">
        <div className="pad"><input className="kb-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜资料…" /></div>
        {shown.length === 0 && <Empty>{docs.length ? '没搜到' : '还没有资料。规范、接口文档、产品说明放这里，员工按需查；也可以跟员工说「把 xx 整理进知识库」'}</Empty>}
        {KB_KINDS.map((k) => {
          const items = shown.filter((d) => d.kind === k)
          if (!items.length) return null
          return <Section key={k} title={k}>{items.map((d) => <Row key={d.id} title={d.name} sub={`${d.summary} · ${d.by} · ${d.updated}`} chevron onClick={() => setView(d)} />)}</Section>
        })}
      </div>
      {view && (
        <Sheet title={view.name} onClose={() => setView(null)} size="lg">
          <div className="prose"><Markdown text={view.body || view.summary} /></div>
          <div className="row-actions">
            <button className="btn ghost" onClick={() => { if (confirm('删掉这份资料？')) { call('DELETE', `/api/kb/${view.id}`, undefined, '已删除'); setView(null) } }}>删除</button>
            <button className="btn primary" onClick={() => { setEdit(view); setView(null) }}>改</button>
          </div>
        </Sheet>
      )}
      {edit && (
        <Sheet title={edit.id ? `改「${edit.name}」` : '加一份资料'} onClose={() => setEdit(null)} size="lg">
          <div className="form">
            <Field label="名字（可选）" hint="不填就用正文的第一个标题"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="比如：退款流程说明" /></Field>
            <Field label="类型"><Segmented value={edit.kind} onChange={(v) => setEdit({ ...edit, kind: v })} options={KB_KINDS.map((k) => ({ value: k, label: k }))} /></Field>
            <Field label="内容（Markdown）"><textarea className="code-edit" rows={12} value={edit.body ?? ''} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
            <button className="btn primary block" onClick={save}>保存</button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

// ======================= 项目 =======================
type RepoItem = { name: string; url: string; branch?: string; private?: boolean; group?: string; short?: string; updated?: number }
const agoText = (t?: number) => {
  if (!t) return ''
  const d = (Date.now() - t) / 60_000
  return d < 60 ? `${Math.max(1, Math.round(d))} 分钟前` : d < 1440 ? `${Math.round(d / 60)} 小时前` : d < 43200 ? `${Math.round(d / 1440)} 天前` : new Date(t).toLocaleDateString('zh-CN')
}
const lastSeg = (u: string) => u.replace(/\.git$/, '').split('/').filter(Boolean).pop() ?? ''

/** 接入仓库：点账号 → 点仓库 → 分支、名字、服务器都自动选好，点「接入」。仓库不在列表里才手填地址 */
export function LiveWorkspaceAddPage({ params, nav }: PageProps) {
  const creds = useStore((s) => s.credentials).filter((c) => c.group === '代码仓库')
  const workHosts = useWorkHosts()
  const [credential, setCredential] = useState<string>(params.credential ?? creds[0]?.id ?? '')
  const [repos, setRepos] = useState<RepoItem[] | null>(null)
  const [q, setQ] = useState('')
  // 先选分组（组织 / 命名空间），再选里面的仓库：令牌能看到的仓库可能很多、跨好几个组织，不一股脑全列出来
  const [grp, setGrp] = useState<string | null>(null)
  const [manual, setManual] = useState(false)
  const [url, setUrl] = useState('')
  const [br, setBr] = useState<{ def?: string; branches: string[] } | null>(null)
  const [brErr, setBrErr] = useState('')
  const [branch, setBranch] = useState('')
  const [name, setName] = useState('')
  const [editName, setEditName] = useState(false)
  const [server, setServer] = useState(workHosts.find((x) => x.id === 'local')?.id ?? workHosts[0]?.id ?? 'local')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setRepos(null); setUrl(''); setManual(false); setGrp(null); setQ('')
    if (!credential) { setRepos([]); return }
    call<{ repos: RepoItem[] }>('GET', `/api/credentials/${credential}/repos`).then((r) => setRepos(r?.repos ?? []))
  }, [credential])
  // 选了仓库：读分支，默认分支自动选上；名字用仓库名
  useEffect(() => {
    setBr(null); setBrErr(''); setBranch('')
    if (!/^https:\/\/.+/.test(url)) return
    if (!editName) setName(lastSeg(url))
    const t = window.setTimeout(() => {
      api<{ def?: string; branches: string[] }>('GET', `/api/repo-branches?url=${encodeURIComponent(url)}${credential ? `&cred=${credential}` : ''}`)
        .then((r) => { setBr(r); setBranch(r.def ?? r.branches[0] ?? '') })
        .catch((e) => setBrErr((e as Error).message))
    }, manual ? 600 : 0)
    return () => clearTimeout(t)
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps
  const picked = repos?.find((x) => x.url === url)
  const groupOf = (x: RepoItem) => x.group || '（没有分组）'
  /** 分组：仓库数、最近更新；最近动过的排前面。只有一个分组就不分层 */
  const groups = (() => {
    const m = new Map<string, { name: string; n: number; updated: number }>()
    for (const x of repos ?? []) { const g = groupOf(x); const cur = m.get(g) ?? { name: g, n: 0, updated: 0 }; cur.n++; cur.updated = Math.max(cur.updated, x.updated ?? 0); m.set(g, cur) }
    return [...m.values()].sort((a, b) => b.updated - a.updated || a.name.localeCompare(b.name))
  })()
  const layered = groups.length > 1
  const inGroup = layered ? grp : groups[0]?.name ?? null
  // 搜索：在分组里就只搜这个分组；还没进分组时跨所有分组搜（结果带分组名）
  const shown = (repos ?? []).filter((x) => (inGroup ? groupOf(x) === inGroup : !!q) && (!q || `${x.name} ${x.group ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const showGroups = layered && !inGroup && !q
  const save = async () => {
    setBusy(true)
    const r = await call('POST', '/api/workspaces', { repo: url.trim(), branch, name: name.trim() || lastSeg(url), credential, server }, '在拉代码，好了会显示分支和提交')
    setBusy(false)
    if (r) nav.back()
  }
  const credOf = creds.find((c) => c.id === credential)
  const platform = (k?: string) => (k ? k.replace(/（.*）/, '') : '')
  const emps = useStore((s) => s.employees)
  const ok = /^https:\/\/.+/.test(url)
  return (
    <div className="page">
      <PageHeader title="接入项目" sub="选账号、选仓库，分支、名字、服务器都自动选好；接入后员工就能在上面干活" {...headNav(nav)} />
      <div className="page-body wsadd">
        {/* ① 账号 */}
        <div className="wsadd-step">
          <div className="wsadd-head"><span className={'wsadd-n' + (credential || manual ? ' ok' : '')}>1</span><b>用哪个代码平台账号</b><span className="sub">私有仓库要账号；公开仓库可以不用</span></div>
          <div className="wsadd-accts">
            {creds.map((c) => (
              <button key={c.id} className={'wsadd-acct' + (credential === c.id ? ' on' : '')} onClick={() => setCredential(c.id)}>
                <span className="wsadd-plat">{platform(c.kind).slice(0, 2)}</span>
                <span className="wsadd-acct-main"><b>{c.name}</b><small>{platform(c.kind)}{c.user ? ` · ${c.user}` : ''}</small></span>
                {credential === c.id && <IconCheck size={14} />}
              </button>
            ))}
            <button className={'wsadd-acct' + (!credential ? ' on' : '')} onClick={() => setCredential('')}>
              <span className="wsadd-plat">公</span><span className="wsadd-acct-main"><b>公开仓库</b><small>不用账号，手填地址</small></span>{!credential && <IconCheck size={14} />}
            </button>
            <button className="wsadd-acct add" onClick={() => nav.push({ page: 'credentialEdit', params: { group: '代码仓库' } })}>
              <span className="wsadd-plat">＋</span><span className="wsadd-acct-main"><b>新增账号</b><small>GitHub / GitLab / Gitee / Codeup / Gitea，贴个令牌</small></span>
            </button>
          </div>
        </div>

        {/* ② 仓库 */}
        <div className="wsadd-step">
          <div className="wsadd-head">
            <span className={'wsadd-n' + (ok ? ' ok' : '')}>2</span><b>选仓库</b>
            {credential && !manual && repos && <span className="sub">{`${credOf?.name ?? ''} 能访问的 ${repos.length} 个`}</span>}
            {credential && <button className="btn ghost sm wsadd-switch" onClick={() => { setManual(!manual); setUrl('') }}>{manual ? '回到列表' : '不在列表里？手填地址'}</button>}
          </div>
          {credential && !manual ? (
            <>
              {repos === null && <div className="sub wsadd-wait"><i className="spinner" /> 在读这个账号能访问的仓库…</div>}
              {repos && repos.length === 0 && <Empty>这个账号没读到仓库：检查令牌有没有勾读仓库的权限，或者手填地址</Empty>}
              {layered && inGroup && (
                <div className="wsadd-crumb">
                  <button type="button" className="btn ghost sm" onClick={() => { setGrp(null); setQ('') }}>← 全部分组</button>
                  <b data-no-i18n="">{inGroup}</b><span className="sub">{`${groups.find((g) => g.name === inGroup)?.n ?? 0} 个仓库`}</span>
                </div>
              )}
              {repos && repos.length > 6 && <input className="wsadd-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={inGroup && layered ? `在「${inGroup}」里搜` : layered ? `搜全部 ${repos.length} 个仓库（先选分组更清楚）` : `搜 ${repos.length} 个仓库`} />}
              {showGroups ? (
                <div className="wsadd-repos">
                  {groups.map((g) => (
                    <button key={g.name} className="wsadd-repo grp" onClick={() => { setGrp(g.name); setQ('') }}>
                      <span className="wsadd-repo-ico">{g.name.replace(/^（.*）$/, '·').slice(0, 1).toUpperCase()}</span>
                      <span className="wsadd-repo-main"><b data-no-i18n="">{g.name}</b><small>{`${g.n} 个仓库`}</small></span>
                      <span className="wsadd-repo-meta"><small>{agoText(g.updated)}</small><span className="row-chev"><IconChevron /></span></span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="wsadd-repos">
                  {shown.slice(0, 80).map((x) => {
                    const on = x.url === url
                    const short = x.short ?? lastSeg(x.url)
                    return (
                      <button key={x.url} className={'wsadd-repo' + (on ? ' on' : '')} onClick={() => setUrl(x.url)}>
                        <span className="wsadd-repo-ico">{on ? <IconCheck size={14} /> : short.slice(0, 1).toUpperCase()}</span>
                        <span className="wsadd-repo-main"><b data-no-i18n="">{short}</b><small data-no-i18n="">{inGroup ? '' : x.group || ' '}</small></span>
                        <span className="wsadd-repo-meta">{x.private && <span className="wsadd-tag">私有</span>}<small>{agoText(x.updated)}</small></span>
                      </button>
                    )
                  })}
                  {q && shown.length === 0 && <span className="sub">没搜到</span>}
                </div>
              )}
              {!showGroups && shown.length > 80 && <p className="hint">还有 {shown.length - 80} 个，搜一下名字</p>}
            </>
          ) : (
            <input className="mono wsadd-url" value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="https://github.com/you/app.git" autoFocus />
          )}
        </div>

        {/* ③ 确认 */}
        {ok && (
          <div className="wsadd-step final">
            <div className="wsadd-head"><span className="wsadd-n">3</span><b>确认一下</b><span className="sub">都自动选好了，要改再点</span></div>
            <div className="wsadd-summary">
              <span className="wsadd-big-ico">{(name || lastSeg(url)).slice(0, 1).toUpperCase()}</span>
              <div className="wsadd-summary-main">
                {editName
                  ? <input autoFocus className="wsadd-name-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setEditName(false)} onKeyDown={(e) => e.key === 'Enter' && setEditName(false)} />
                  : <button className="wsadd-name" onClick={() => setEditName(true)} title="改名字"><b data-no-i18n="">{name || lastSeg(url)}</b><span className="sub">改名</span></button>}
                <small className="mono" data-no-i18n="">{picked?.name ?? url.replace(/^https:\/\//, '')}</small>
              </div>
            </div>
            <div className="wsadd-field">
              <span className="wsadd-label">分支</span>
              {!br && !brErr && <span className="sub"><i className="spinner" /> 在读分支…</span>}
              {brErr && <span className="sub">读不到分支（{brErr}），用仓库的默认分支</span>}
              {br && <div className="chips">{br.branches.slice(0, 30).map((x) => <button key={x} className={'chip' + (branch === x ? ' on' : '')} onClick={() => setBranch(x)} data-no-i18n="">{x}{x === br.def ? ' · 默认' : ''}</button>)}</div>}
            </div>
            {workHosts.length > 1 && (
              <div className="wsadd-field">
                <span className="wsadd-label">拉到哪台 <span className="sub">（员工在这台上干活）</span></span>
                <div className="wsadd-hosts">
                  {workHosts.map((x) => {
                    const n = emps.filter((e) => (e.host || 'local') === x.id).length
                    return (
                      <button key={x.id} className={'wsadd-host' + (server === x.id ? ' on' : '')} onClick={() => setServer(x.id)}>
                        <span className={'wsadd-dot' + (x.online ? ' ok' : '')} />
                        <span className="wsadd-host-main"><b>{hostLabel(x)}</b><small>{[x.env, x.sys ? `${x.sys.cores} 核 · ${x.sys.memGb}G` : '', n ? `${n} 个员工` : ''].filter(Boolean).join(' · ')}</small></span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="wsadd-auto">
              <b>接入后自动做</b>
              <span>拉代码到那台</span><span>认出项目类型、建好编译和流水线</span><span>建一个项目员工，能马上派活</span>
            </div>
            <button className="btn primary block wsadd-go" disabled={busy} onClick={save}>{busy ? '在接入…' : `接入「${name || lastSeg(url)}」`}</button>
          </div>
        )}
        <p className="hint wsadd-foot">令牌只在 Opero 拉取 / 推送时用（不写进仓库配置），员工拿不到。</p>
      </div>
    </div>
  )
}

export function LiveWorkspacePage({ params, nav }: PageProps) {
  const w = useStore((s) => s.workspaces.find((x) => x.id === params.id)) as (Workspace & { error?: string }) | undefined
  const emps = useStore((s) => s.employees)
  const creds = useStore((s) => s.credentials.filter((c) => c.group === '代码仓库'))
  const [busy, setBusy] = useState(false)
  const [allCommits, setAllCommits] = useState(false)
  const [brOpen, setBrOpen] = useState(false)
  const [remote, setRemote] = useState<{ def?: string; branches: string[] } | null>(null)
  const [switching, setSwitching] = useState('')
  const [workOf, setWorkOf] = useState('') // 点员工那一行的「执行器 · 模型」：弹出它的 work 设置，不用进员工资料
  const refresh = async () => { if (!w) return; setBusy(true); await call('POST', `/api/workspaces/${w.id}/refresh`); setBusy(false) }
  useEffect(() => { refresh() }, [params.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!w) return <div className="page"><PageHeader title="项目" {...headNav(nav)} /><Empty>找不到这个项目</Empty></div>
  const users = emps.filter((e) => e.workspace === w.id)
  const short = w.repo.replace(/^https?:\/\//, '').replace(/\.git$/, '').split('/').slice(-2).join('/')
  const addEmp = async () => { const r = await call<Employee>('POST', `/api/workspaces/${w.id}/employees`, undefined); if (r) toast(`已加上「${r.name}」：点它改名、发消息`) }
  const openBranches = () => {
    setBrOpen(!brOpen)
    if (!remote) api<{ def?: string; branches: string[] }>('GET', `/api/repo-branches?url=${encodeURIComponent(w.repo)}${w.credential ? `&cred=${w.credential}` : ''}`).then(setRemote).catch(() => setRemote({ branches: w.branches.map((x) => x.name.replace(/^origin\//, '')) }))
  }
  const switchTo = async (b: string) => {
    if (b === w.branch) return
    if (!confirm(`把「${w.name}」切到分支 ${b}？${users.length > 1 ? `这个项目的 ${users.length} 个员工都会一起切过去。` : ''}没提交的改动会先存进 stash。`)) return
    setSwitching(b)
    const r = await call<{ msg: string }>('POST', `/api/workspaces/${w.id}/branch`, { branch: b })
    setSwitching('')
    if (r) { toast(r.msg); setBrOpen(false) }
  }
  const remove = async () => {
    if (!confirm(`从 Opero 里去掉「${w.name}」？（服务器上的目录留着）`)) return
    const withEmps = users.length > 0 && confirm(`它的 ${users.length} 个员工（${users.map((e) => e.name).join('、')}）也一起删掉吗？\n\n确定 = 一起删（聊天记录也删）\n取消 = 留着，变成没有项目的普通员工`)
    if (await call('DELETE', `/api/workspaces/${w.id}${withEmps ? '?withEmployees=1' : ''}`, undefined, '已去掉')) nav.back()
  }
  return (
    <div className="page">
      <PageHeader title={<InlineText value={w.name} onSave={(v) => call('PUT', `/api/workspaces/${w.id}`, { name: v }, '已改名')} />} sub={`${w.provider} · ${short}`} {...headNav(nav)} right={<span className="row-actions"><button className="btn ghost sm" onClick={() => copy(w.repo)}>复制地址</button><button className="btn default sm" disabled={busy} onClick={refresh}>{busy ? '刷新中…' : '刷新'}</button></span>} />
      <div className="page-body">
        {w.error && <div className="pad"><div className="banner b-warn">{w.error}</div></div>}
        {/* 发布放最上面（项目和发布合在一起）：各环境线上版本、发布 / 回滚、发布记录 */}
        <ReleaseSection w={w} nav={nav} />
        <BuildSection w={w} />
        <PackagesSection w={w} />
        <Section title={`员工 · ${users.length}`} right={<button className="btn ghost sm" onClick={addEmp}>+ 加一个员工</button>}>
          {users.length === 0 && <Empty>还没有员工：点右上角「+ 加一个员工」，点了就建好</Empty>}
          {users.map((e) => (
            <Row key={e.id} icon={<EditableAvatar id={e.id} size={36} />} onClick={() => nav.push({ page: 'employee', params: { id: e.id } })}
              title={<><InlineText value={e.name} onSave={(v) => call('PUT', `/api/employees/${e.id}`, { name: v }, '已改名')} /><InlineText className="role-tag" value={e.role ?? ''} placeholder="加职位" max={20} onSave={(v) => call('PUT', `/api/employees/${e.id}`, { role: v }, '已改职位')} /></>}
              sub={<InlineText value={e.title} placeholder="写一句它负责什么" max={80} onSave={(v) => call('PUT', `/api/employees/${e.id}`, { title: v }, '已保存')} />}
              right={<span className="row-actions">
                <button className="btn ghost sm" onClick={(ev) => { ev.stopPropagation(); setWorkOf(e.id) }} title="执行器、模型、思考、审核">{`${e.executor.replace(' Code', '')} · ${e.model}`}</button>
                <button className="btn primary sm" onClick={(ev) => { ev.stopPropagation(); nav.openChat(e.id) }}>发消息</button>
              </span>} />
          ))}
          {users.length > 0 && <p className="hint">同一个项目的员工共用项目目录和 docs/ 里的交接；切分支大家一起切。</p>}
        </Section>
        <Section title="分支" right={<button className="btn ghost sm" onClick={openBranches}>{brOpen ? '收起' : '切换分支'}</button>}>
          <Row title={<span className="mono" data-no-i18n="">{w.branch || '…'}</span>} sub={`当前分支 · ${users.length ? '员工都在这个分支上干活' : ''}`} />
          {brOpen && (
            <div className="pad">
              {!remote && <span className="sub"><i className="spinner" /> 在读分支…</span>}
              {remote && <div className="chips">{remote.branches.slice(0, 40).map((b) => <button key={b} className={'chip mono' + (b === w.branch ? ' on' : '')} disabled={!!switching} onClick={() => switchTo(b)} data-no-i18n="">{switching === b ? '切换中…' : b}{b === remote.def ? ' · 默认' : ''}</button>)}</div>}
              <p className="hint">也可以直接跟员工说「切到 xxx 分支」，它会自己切（所有员工一起换）。</p>
            </div>
          )}
        </Section>
        {w.docs.length > 0 && (
          <Section title="文档（docs/）" right={users[0] ? <button className="btn ghost sm" onClick={() => nav.push({ page: 'memory', params: { id: users[0].id } })}>打开</button> : undefined}>
            {w.docs.slice(0, 8).map((d) => <Row key={d.name} title={<span className="mono" data-no-i18n="">{d.name}</span>} chevron={!!users[0]} onClick={users[0] ? () => nav.push({ page: 'memory', params: { id: users[0].id, file: `docs/${d.name}` } }) : undefined} />)}
          </Section>
        )}
        <Section title={`最近提交 · ${w.commits.length}`} right={w.commits.length > 3 ? <button className="btn ghost sm" onClick={() => setAllCommits(!allCommits)}>{allCommits ? '收起' : '全部'}</button> : undefined}>
          {(allCommits ? w.commits : w.commits.slice(0, 3)).map((c) => <Row key={c.sha} title={c.msg} sub={<><span className="mono">{c.sha}</span> · {c.who} · {c.when}</>} />)}
        </Section>
        <WorkspaceAutoSections w={w} nav={nav} />
        <Section title="预算">
          <Row title="这个项目每月预算（美元）" sub="用满了在这个项目里干活的员工先停下；到 80% 提醒一次" />
          <div className="pad chips">{[0, 20, 50, 100, 300].map((n) => <button key={n} className={'chip' + ((w.budget ?? 0) === n ? ' on' : '')} onClick={() => call('PUT', `/api/workspaces/${w.id}`, { budget: n }, '已保存')}>{n ? `$${n}` : '不单独限'}</button>)}</div>
        </Section>
        <Section title="位置">
          <Row title="目录" sub={<span className="mono small" data-no-i18n="">{w.dir}</span>} right={<button className="btn ghost sm" onClick={() => copy(w.dir)}>复制</button>} />
          <Row title="仓库账号" right={
            <select value={w.credential ?? ''} onChange={(e) => call('PUT', `/api/workspaces/${w.id}`, { credential: e.target.value }, '已改')}>
              <option value="">不用（公开仓库）</option>{creds.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>} />
        </Section>
        <div className="pad row-actions"><button className="btn ghost danger" onClick={remove}>去掉这个项目</button></div>
      </div>
      {workOf && users.find((x) => x.id === workOf) && <WorkSheet emp={users.find((x) => x.id === workOf)!} onClose={() => setWorkOf('')} />}
    </div>
  )
}

// ======================= 员工资料 =======================
export function LiveEmployeePage({ params, nav }: PageProps) {
  const e = useStore((s) => s.employees.find((x) => x.id === params.id))
  const usage = useStore((s) => s.usage)
  const triggers = useStore((s) => s.triggers)
  const ws = useStore((s) => s.workspaces.find((w) => w.id === e?.workspace))
  const servers = useStore((s) => s.servers)
  const sess = useStore((s) => s.sessions.find((x) => x.employee === params.id))
  const [work, setWork] = useState(false)
  // 在哪干活：工作目录、记忆放哪（后台算的）
  const [where, setWhere] = useState<{ host: string; cwd: string; project?: string; mem: string } | null>(null)
  useEffect(() => { if (params.id) call<{ host: string; cwd: string; project?: string; mem: string }>('GET', `/api/employees/${params.id}/where`).then((r) => r && setWhere(r)) }, [params.id, e?.host, e?.workspace])
  if (!e) return <div className="page"><PageHeader title="员工" {...headNav(nav)} /><Empty>找不到这个员工</Empty></div>
  const u = usage.find((x) => x.employee === e.id)
  const mine = triggers.filter((t) => t.employee === e.id)
  const sv = servers.find((x) => x.id === e.host)
  const hostName = !sv ? 'Opero 这台' : sv.id === 'local' ? srvName(sv) : `${sv.name}${sv.online ? '' : '（离线）'}`
  const remove = async () => {
    if (!confirm(`删掉「${e.name}」？它的聊天记录也会删掉（项目里的代码不受影响）`)) return
    if (await call('DELETE', `/api/employees/${e.id}`, undefined, '已删除')) nav.back()
  }
  return (
    <div className="page">
      <PageHeader title={e.name} sub="员工资料" {...headNav(nav)} right={<button className="btn default sm" onClick={() => nav.push({ page: 'employeeEdit', params: { id: e.id } })}>更多设置</button>} />
      <div className="page-body">
        <div className="hero">
          <EditableAvatar id={e.id} size={64} />
          <div className="hero-main">
            <b><InlineText value={e.name} onSave={(v) => call('PUT', `/api/employees/${e.id}`, { name: v }, '已改名')} /><InlineText className="role-tag" value={e.role ?? ''} placeholder="加职位" max={20} onSave={(v) => call('PUT', `/api/employees/${e.id}`, { role: v }, '已改职位')} /></b>
            <span className="sub"><InlineText value={e.title} placeholder="写一句它负责什么" max={80} onSave={(v) => call('PUT', `/api/employees/${e.id}`, { title: v }, '已保存')} /></span>
          </div>
          <div className="row-actions">
            {sess && <button className="btn default" onClick={() => togglePin(sess.id)}>{sess.pinned ? '取消置顶' : '置顶'}</button>}
            <button className="btn primary" onClick={() => nav.openChat(e.id)}>发消息</button>
          </div>
        </div>
        {u && (
          <div className="stats">
            <Stat label="本月轮数" value={u.tasks} />
            <Stat label="成功率" value={u.tasks ? `${Math.round((u.success / u.tasks) * 100)}%` : '—'} />
            <Stat label="本月花费" value={`${CUR}${u.cost.toFixed(2)}`} sub={u.tokens + ' token'} />
          </div>
        )}
        <Section title="work" right={<span className="sub">选了就记住</span>}>
          <Row title="执行器" right={e.executor} chevron onClick={() => setWork(true)} />
          <Row title="模型" right={e.model} chevron onClick={() => setWork(true)} />
          <Row title="思考方式" right={effortLabel(e.effort)} chevron onClick={() => setWork(true)} />
          <Row title="审核方式" right={approvalLabel(e.approval)} chevron onClick={() => setWork(true)} />
          <Row title="上下文" right={`${e.contextUsed ?? 0}%`} />
        </Section>
        <Section title="在哪干活">
          <Row title="服务器" sub="它在哪台机器上干活：Opero 这台，或装了 Agent 的服务器（那台要先装好 AI 执行器）" right={
            <select className="row-select" value={sv ? sv.id : 'local'} aria-label={hostName} onChange={(ev) => {
              const to = servers.find((x) => x.id === ev.target.value)
              if (!to || to.id === (sv?.id ?? 'local')) return
              if (!to.online && to.id !== 'local' && !confirm(`「${to.name}」现在离线，还是换过去？`)) return
              if (!confirm(`让「${e.name}」换到「${to.id === 'local' ? 'Opero 这台' : to.name}」干活？\n\n会开一个新会话接着做，它的记忆仓库跟着搬过去。`)) return
              saveEmployee({ ...e, host: to.id })
            }}>
              {servers.filter((x) => x.id === 'local' || x.via === 'agent').map((x) => (
                <option key={x.id} value={x.id}>{x.id === 'local' ? srvName(x) : `${x.name}${x.online ? '' : '（离线）'}`}</option>
              ))}
            </select>
          } />
          <Row title="项目" right={ws ? ws.name : '没有（在它自己的目录里干活）'} chevron={!!ws} onClick={ws ? () => nav.push({ page: 'workspace', params: { id: ws.id } }) : undefined} />
          {where && <Row title="工作目录" sub={<span className="mono small" data-no-i18n="">{where.cwd}</span>} right={<button className="btn ghost sm" onClick={() => copy(where.cwd)}>复制</button>} />}
          {where && <Row title="记忆" sub={where.project ? '项目的 docs/（交接、规矩都在这里，同项目的员工共用）' : <span className="mono small" data-no-i18n="">{where.mem}</span>} chevron onClick={() => nav.push({ page: 'memory', params: { id: e.id } })} />}
        </Section>
        {e.prompt && <Section title="职责"><p className="prose">{e.prompt}</p></Section>}
        {(e.gender || e.persona) && <Section title="人设"><Row title="性别" right={e.gender || '—'} /><Row title="性格 / 说话风格" right={e.persona || '—'} /></Section>}
        <EmployeeWorkSections e={e} nav={nav} />
        <EmployeeCredsSection e={e} nav={nav} />
        <Section title={`触发器 · ${mine.length}`} right={<button className="btn ghost sm" onClick={() => nav.push({ page: 'triggerEdit', params: { employee: e.id } })}>添加</button>}>
          {mine.length === 0 && <Empty>没有触发器：你叫它才干活</Empty>}
          {mine.map((t) => <Row key={t.id} title={t.name} sub={`${t.kind} · ${t.rule}`} chevron onClick={() => nav.push({ page: 'triggerEdit', params: { id: t.id } })} right={<Tag tone={t.enabled ? 'ok' : 'mute'}>{t.enabled ? '开' : '关'}</Tag>} />)}
        </Section>
        <Section>
          <Row title="聊天设置" sub="头像、名字、背景、提醒" chevron onClick={() => nav.push({ page: 'chatSettings', params: { id: e.id } })} />
          <Row title="删掉这个员工" danger onClick={remove} />
        </Section>
      </div>
      {work && <WorkSheet emp={e} onClose={() => setWork(false)} />}
    </div>
  )
}

// ======================= 账号安全 =======================
export function LiveSecurityPage({ nav }: PageProps) {
  const [old, setOld] = useState('')
  const [pwd, setPwd] = useState('')
  const [pair, setPair] = useState<string | null>(null)
  const [devices, setDevices] = useState<{ id: string; name: string; platform: string; appVersion?: string; paired: number; seen?: number }[]>([])
  const load = () => call<typeof devices>('GET', '/api/app/list').then((r) => r && setDevices(r))
  useEffect(() => { load() }, [])
  const change = async () => {
    if (pwd.length < 8) { toast('新密码至少 8 位'); return }
    if (await call('POST', '/api/auth/password', { old, password: pwd }, '密码已改，其它地方要重新登录')) { setOld(''); setPwd('') }
  }
  return (
    <div className="page">
      <PageHeader title="账号安全" {...headNav(nav)} />
      <div className="page-body">
        <Section title="接手机" right={<span className="sub">Opero App（安卓）</span>}>
          {pair
            ? <div className="pad"><div className="pair-code">{pair}</div><p className="sub center">在手机上打开 Opero App，填这套的地址（{location.origin}）和这个配对码。10 分钟内有效，用一次就作废。</p></div>
            : <Row title="生成配对码" sub="配对后手机能收提醒、用指纹验证本人；手机丢了在这里断开" chevron
                onClick={() => requireVerify('生成手机配对码', () => call<{ code: string }>('POST', '/api/app/pair-code').then((r) => r && setPair(r.code)))} />}
          {devices.map((d) => (
            <Row key={d.id} title={d.name} sub={`${d.platform}${d.appVersion ? ' · App ' + d.appVersion : ''} · ${new Date(d.paired).toLocaleDateString('zh-CN')} 配对`}
              right={<button className="btn ghost sm" onClick={() => call('DELETE', `/api/app/list/${d.id}`, undefined, '已断开，这台手机要重新配对才能用').then(load)}>断开</button>} />
          ))}
        </Section>
        <PasskeySection />
        <MfaSection />
        <Section title="改密码">
          <div className="pad form">
            <Field label="原密码"><input type="password" value={old} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" /></Field>
            <Field label="新密码（至少 8 位）"><input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" /></Field>
            <button className="btn primary" onClick={change}>改密码</button>
          </div>
        </Section>
        <Section><Row title="退出登录" danger onClick={() => logout()} /></Section>
        <p className="hint">危险操作（看凭证明文、改凭证、确认危险命令）会让你再输一次密码，5 分钟内不再问；App 里用指纹。忘了密码在服务器上运行 opero reset-password。</p>
      </div>
    </div>
  )
}


// ======================= 通行密钥、两步验证（账号安全页） =======================
interface PkInfo { passkeys: { id: string; name: string; created: number; lastUsed?: number; rpId: string }[]; mfa: { enabled: boolean; recoveryLeft: number } }
function usePk() {
  const [info, setInfo] = useState<PkInfo | null>(null)
  const load = () => call<PkInfo>('GET', '/api/auth/passkeys').then((r) => r && setInfo(r))
  useEffect(() => { load() }, [])
  return [info, load] as const
}
/** 这台设备叫什么（通行密钥的名字，不用你起）：「iPhone · Safari」「Mac · Chrome」 */
function deviceName() {
  const u = navigator.userAgent
  const dev = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android 手机' : /Mac OS X/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows 电脑' : /Linux/.test(u) ? 'Linux 电脑' : '这台设备'
  const br = /Edg\//.test(u) ? 'Edge' : /OPR\//.test(u) ? 'Opera' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : ''
  return br ? `${dev} · ${br}` : dev
}
function PasskeySection() {
  const [info, load] = usePk()
  const add = () => requireVerify('加一个通行密钥', async () => {
    try {
      const o = await api('POST', '/api/auth/passkey/register-options', {})
      const cred = await createPasskey(o)
      const name = deviceName()
      await api('POST', '/api/auth/passkey/register', { credential: cred, name })
      markPkHere()
      toast('已加上：以后能用它登录、验证本人')
      load()
    } catch (e) { if ((e as DOMException)?.name === 'InvalidStateError') markPkHere(); toast(passkeyError(e, true)) }
  })
  return (
    <Section title="通行密钥" right={<span className="sub">指纹 / 面容 / 设备 PIN 登录，不用输密码</span>}>
      {!passkeySupported() && <Empty>这个浏览器不支持通行密钥</Empty>}
      {(info?.passkeys ?? []).map((p) => (
        <Row key={p.id} title={p.name} sub={`${p.rpId} · ${new Date(p.created).toLocaleDateString('zh-CN')} 加的${p.lastUsed ? ` · 上次用 ${new Date(p.lastUsed).toLocaleDateString('zh-CN')}` : ''}`}
          right={<button className="btn ghost sm" onClick={() => { if (confirm(`删掉通行密钥「${p.name}」？`)) requireVerify('删通行密钥', () => call('DELETE', `/api/auth/passkeys/${encodeURIComponent(p.id)}`, undefined, '已删').then(load)) }}>删</button>} />
      ))}
      {passkeySupported() && <Row title="加一个通行密钥" sub="要用 HTTPS 打开 Opero；每台设备加一个" chevron onClick={add} />}
    </Section>
  )
}
function MfaSection() {
  const [info, load] = usePk()
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const start = () => requireVerify('开两步验证', () => call<{ secret: string; uri: string }>('POST', '/api/auth/mfa/setup').then((r) => r && setSetup(r)))
  const enable = async (v = code) => { const r = await call<{ recovery: string[] }>('POST', '/api/auth/mfa/enable', { code: v.trim() }); if (r) { setCodes(r.recovery); setSetup(null); setCode(''); load() } }
  // 关掉 / 换恢复码：在这里输动态码（输满 6 位自动提交），不弹框
  const [ask, setAsk] = useState<'disable' | 'regen' | null>(null)
  const [askCode, setAskCode] = useState('')
  const sendAsk = (v: string) => { const c = v.trim(); if (!c || !ask) return; setAsk(null); setAskCode(''); if (ask === 'disable') disable(c); else regen(c) }
  const disable = (c: string) => requireVerify('关两步验证', () => call('POST', '/api/auth/mfa/disable', { code: c }, '已关').then(load))
  const regen = (c: string) => requireVerify('换恢复码', () => call<{ recovery: string[] }>('POST', '/api/auth/mfa/recovery', { code: c }).then((r) => { if (r) { setCodes(r.recovery); load() } }))
  return (
    <Section title="两步验证" right={<span className="sub">密码登录后还要输验证器 App 里的动态码</span>}>
      {info?.mfa.enabled
        ? <>
            <Row title="已开" sub={`恢复码还剩 ${info.mfa.recoveryLeft} 个`} right={<span className="row-actions"><button className="btn ghost sm" onClick={() => setAsk('regen')}>换恢复码</button><button className="btn ghost sm" onClick={() => setAsk('disable')}>关掉</button></span>} />
            {ask && <div className="pad"><Field label={ask === 'disable' ? '输一个动态码或恢复码，关掉两步验证' : '输一个动态码，换一批恢复码（旧的作废）'}><input autoFocus value={askCode} onChange={(e) => { const v = e.target.value; setAskCode(v); if (/^\d{6}$/.test(v.trim())) sendAsk(v) }} onKeyDown={(e) => { if (e.key === 'Enter') sendAsk(askCode); if (e.key === 'Escape') setAsk(null) }} inputMode="numeric" autoComplete="one-time-code" /></Field></div>}
          </>
        : !setup && <Row title="开两步验证" sub="用 Google Authenticator、1Password、微软 Authenticator 这类 App" chevron onClick={start} />}
      {setup && (
        <div className="pad form">
          <p className="field-hint">在验证器 App 里「手动输入密钥」，或者在手机上点下面的链接：</p>
          <div className="cmd-box mono" data-no-i18n="">{setup.secret}<button className="btn ghost sm" onClick={() => copy(setup.secret)}>复制</button></div>
          <a className="btn ghost sm" href={setup.uri}>在手机上打开验证器</a>
          <Field label="输入 App 里现在显示的 6 位码（输满自动开启）"><input value={code} onChange={(e) => { const v = e.target.value; setCode(v); if (/^\d{6}$/.test(v.trim())) void enable(v) }} inputMode="numeric" autoComplete="one-time-code" /></Field>
        </div>
      )}
      {codes && (
        <div className="pad">
          <div className="banner b-warn">恢复码只显示这一次：抄下来放好。手机丢了用它登录，每个用一次。</div>
          <pre className="console" data-no-i18n="">{codes.join('\n')}</pre>
          <button className="btn default sm" onClick={() => copy(codes.join('\n'))}>复制全部</button>
        </div>
      )}
    </Section>
  )
}
