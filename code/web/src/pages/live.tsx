// 真的一套（LIVE）用的页面：开机 / 登录、AI 执行器、服务器、凭证、数据、触发器、知识库、工作空间、员工档案、账号安全。
// 演示（/demo）还是用原来那些页面和假数据；没做完的功能在真的一套里显示「还在做」。
import { useEffect, useState, type ReactNode } from 'react'
import type { Credential, CredGroup, DataSource, EnvTag, KbDoc, Trigger, Workspace } from '../types'
import { empName, getState, logout, requireVerify, SOON, toast, toggleTrigger, useStore } from '../store'
import { api, boot, call } from '../live'
import { Avatar } from '../components/Avatar'
import { Mark, Wordmark } from '../components/brand'
import { Empty, Field, Meter, PageHeader, Row, Section, Segmented, Sheet, Stat, StatusDot, Table, Tag, Toggle } from '../components/ui'
import { IconCheck, IconPlus } from '../components/icons'
import { Markdown } from '../components/Markdown'
import { WorkSheet } from '../components/WorkSheet'
import { approvalLabel, effortLabel, modelsFor } from '../work'
import { ExecutorSetup, type AiInfo } from '../components/ExecutorSetup'
import { LangPicker } from '../components/LangPicker'
import { useLang } from '../i18n'
import { CUR } from '../mode'
import { headNav, type PageProps } from './nav'

// 环境是标签：随便起名、要几个都行；「改东西先确认」是单独的开关，没设过按标签猜（和后台 env.ts 一样）
const PROD_RE = /生产|正式|線上|线上|prod|production|live/i
const isProtected = (x: { env: string; protect?: boolean }) => x.protect ?? PROD_RE.test(x.env)
const envTone = (e: EnvTag) => (PROD_RE.test(e) ? 'danger' : /测试|測試|test|uat|staging|预发|預發/i.test(e) ? 'warn' : 'mute')

/** 选环境标签：点已有的，或者写一个新的 */
function EnvPicker({ value, onChange }: { value: EnvTag; onChange: (v: EnvTag) => void }) {
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
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [busy, setBusy] = useState(false)
  const first = !!a.needOwner
  const go = async () => {
    if (!email.trim() || !pwd) { toast('账号和密码都要填'); return }
    if (first && pwd.length < 8) { toast('密码至少 8 位'); return }
    if (first && pwd !== pwd2) { toast('两次密码不一样'); return }
    setBusy(true)
    try {
      await api('POST', first ? '/api/auth/setup' : '/api/auth/login', first ? { email: email.trim(), name: name.trim() || '主人', password: pwd } : { email: email.trim(), password: pwd })
      await boot()
    } catch (e) {
      toast((e as Error).message)
    } finally { setBusy(false) }
  }
  return (
    <div className="auth">
      <div className="auth-box">
        <div className="auth-logo"><Wordmark size={40} /></div>
        <p className="sub center">{first ? '第一次打开：设一个主人账号（这套 Opero 只有你一个人用）' : '你自己部署的 AI 开发团队'}</p>
        {a.error && <div className="banner b-warn">连不上后台：{a.error}</div>}
        <Field label="账号（邮箱）"><input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" placeholder="you@example.com" /></Field>
        {first && <Field label="怎么称呼你"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="主人" /></Field>}
        <Field label={first ? '密码（至少 8 位）' : '密码'}>
          <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete={first ? 'new-password' : 'current-password'}
            onKeyDown={(e) => !first && e.key === 'Enter' && go()} />
        </Field>
        {first && <Field label="再输一次"><input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} autoComplete="new-password" onKeyDown={(e) => e.key === 'Enter' && go()} /></Field>}
        <button className="btn primary block lg" onClick={go} disabled={busy}>{busy ? '稍等…' : first ? '创建并进入' : '登录'}</button>
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
  { key: 'dev', name: '开发', desc: '在工作空间里改代码、提交、推送' },
  { key: 'ops', name: '运维', desc: '看服务器、查问题；改之前先问你' },
  { key: 'logwatch', name: '日志值班', desc: '配个触发器定时巡检日志，有问题发卡片' },
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
  const ready = !!info && (exec === 'Codex' ? !!info.codex && info.codexKey : !!info.claude && info.claudeKey)
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
            <Field label="它们用哪个执行器"><Segmented value={exec} onChange={setExec} options={[{ value: 'Claude Code', label: 'Claude Code' }, { value: 'Codex', label: 'Codex' }]} /></Field>
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
  { page: 'credentials', name: '权限和凭证', desc: '账号加密存着，AI 拿不到', letter: '权' },
  { page: 'data', name: '数据', desc: 'MySQL / PostgreSQL，默认只读', letter: '数' },
  { page: 'triggers', name: '触发器', desc: '定时 / Webhook → 员工', letter: '触' },
  { page: 'knowledge', name: '知识库', desc: '所有员工共用的资料', letter: '知' },
  { page: 'audit', name: '操作记录', desc: '员工做的每件事', letter: '记' },
]
const SOON_APPS = ['发布', '消息渠道', '流程', '插件']

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
              <span className="ws-icon">{t.letter}</span><b>{t.name}</b><span className="sub">{t.desc}</span><span className="tile-n">{n[t.page]}</span>
            </button>
          ))}
        </div>
        <p className="hint">还在做：{SOON_APPS.join('、')}。</p>
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
  const [newUrl, setNewUrl] = useState('')
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
  const joined = join ? servers.find((x) => x.via === 'agent' && (x.lastSeen ?? 0) >= join.since && x.online) : undefined
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
          <Field label="叫什么（可选）" hint="不填就用那台机器的主机名"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="比如：prod-web-1" /></Field>
          <Field label="环境标签" hint="随便起名，要几个都行；像生产的（生产 / prod…）默认改东西先确认，接入后能改"><EnvPicker value={env} onChange={setEnv} /></Field>
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
  const [f, setF] = useState({ name: '', ip: '', port: '22', user: 'root', env: '测试' as EnvTag, authKind: 'password' as 'password' | 'key' | 'cred', secret: '', credential: '' })
  const [busy, setBusy] = useState(false)
  const up = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }))
  const save = async () => {
    if (!f.name.trim() || !f.ip.trim()) { toast('名字和地址都要填'); return }
    setBusy(true)
    const r = await call<any>('POST', '/api/servers', { ...f, secret: f.authKind === 'cred' ? undefined : f.secret, credential: f.authKind === 'cred' ? f.credential : undefined })
    setBusy(false)
    if (r) { toast(r.online ? `已连上 ${r.name}` : `已加上，但还连不上：${(r.error ?? '').slice(0, 60)}`); nav.back() }
  }
  return (
    <>
      <p className="field-hint">只用 SSH 的服务器，员工能经 Opero 在上面跑命令（server_exec），但不能在上面干活（跑 Claude Code）。要在上面干活就装 Agent。</p>
      <Field label="名字"><input value={f.name} onChange={(e) => up({ name: e.target.value })} placeholder="比如：prod-db-1" /></Field>
      <Field label="地址（IP 或域名）"><input value={f.ip} onChange={(e) => up({ ip: e.target.value })} placeholder="203.0.113.10" /></Field>
      <div className="inline-form">
        <Field label="SSH 端口"><input value={f.port} onChange={(e) => up({ port: e.target.value })} inputMode="numeric" /></Field>
        <Field label="用户"><input value={f.user} onChange={(e) => up({ user: e.target.value })} /></Field>
      </div>
      <Field label="环境标签" hint="随便起名；像生产的默认改东西先确认，接入后能改"><EnvPicker value={f.env} onChange={(v) => up({ env: v })} /></Field>
      <Field label="登录方式"><Segmented value={f.authKind} onChange={(v) => up({ authKind: v })} options={[{ value: 'password', label: '密码' }, { value: 'key', label: '私钥' }, ...(creds.length ? [{ value: 'cred' as const, label: '已带进来的' }] : [])]} /></Field>
      {f.authKind === 'password' && <Field label="密码"><input type="password" value={f.secret} onChange={(e) => up({ secret: e.target.value })} autoComplete="new-password" /></Field>}
      {f.authKind === 'key' && <Field label="私钥（整段粘贴）"><textarea className="mono code-edit" rows={6} value={f.secret} onChange={(e) => up({ secret: e.target.value })} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" /></Field>}
      {f.authKind === 'cred' && (
        <Field label="用哪个账号"><select value={f.credential} onChange={(e) => up({ credential: e.target.value })}><option value="">选一个</option>{creds.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      )}
      <button className="btn primary block" disabled={busy} onClick={save}>{busy ? '连接中…' : '接入'}</button>
      <p className="field-hint">密码 / 私钥加密存进「权限和凭证」；第一次连上会记下主机指纹，之后对不上就拒绝。</p>
    </>
  )
}

export function LiveServerPage({ params, nav }: PageProps) {
  const s = useStore((x) => x.servers.find((v) => v.id === params.id))
  const emps = useStore((x) => x.employees)
  const [cmd, setCmd] = useState('df -h / && free -m && uptime')
  const [out, setOut] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rejoin, setRejoin] = useState(false)
  const [naming, setNaming] = useState<string | null>(null)
  const prodProtect = useStore((x) => x.settings.prodProtect)
  if (!s) return <div className="page"><PageHeader title="服务器" {...headNav(nav)} /><Empty>找不到</Empty></div>
  const agent = s.via === 'agent'
  const work = agent || s.id === 'local'
  const run = async () => {
    setBusy(true)
    setOut('…')
    const r = await call<{ code: number; out: string; ms: number }>('POST', `/api/servers/${s.id}/exec`, { command: cmd })
    setBusy(false)
    setOut(r ? `$ ${cmd}\n${r.out}\n[退出码 ${r.code} · ${r.ms} ms]` : null)
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
          <Row title="接入方式" right={s.id === 'local' ? 'Opero 所在的这台（自带 Agent）' : agent ? `Opero Agent ${s.agentVersion ?? ''} · 最后心跳 ${ago(s.lastSeen)}` : `SSH ${s.user ?? 'root'}@${s.ip}:${s.port ?? 22}`} />
          {s.agentFp && <Row title="Agent 指纹" sub="在那台上运行 opero fingerprint 能看到；Opero 按它认这台机器，换了上报地址也认得" right={<span className="mono small" data-no-i18n="">{s.agentFp}</span>} />}
        </Section>
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
        {work && (
          <Section title="AI 执行器（这台）" right={<button className="btn ghost sm" onClick={() => nav.push({ page: 'executors', params: { host: s.id } })}>装 / 登录</button>}>
            <Row title="Claude Code" right={s.executors?.claude ?? (s.id === 'local' ? '点右上角看' : '没装')} />
            <Row title="Codex" right={s.executors?.codex ?? (s.id === 'local' ? '点右上角看' : '没装')} />
          </Section>
        )}
        {work && (
          <Section title={`跑在这台的员工 · ${onIt.length}`} right={<span className="sub">在员工「编辑 → 跑在哪台服务器」里选</span>}>
            {onIt.length === 0 && <Empty>还没有</Empty>}
            {onIt.map((e) => <Row key={e.id} icon={<Avatar id={e.id} size={32} />} title={e.name} chevron onClick={() => nav.openChat(e.id)} />)}
          </Section>
        )}
        <Section title="跑命令" right={<span className="sub">只读命令直接跑；会改东西的要先验证本人</span>}>
          <div className="pad">
            <div className="inline-form">
              <input className="mono" value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} />
              <button className="btn primary" onClick={run} disabled={busy}>{busy ? '运行中…' : '运行'}</button>
            </div>
            {out && <pre className="console">{out}</pre>}
          </div>
        </Section>
        {agent && rejoin && <div className="pad form"><AgentJoin nav={nav} again={{ name: s.name, env: s.env }} /></div>}
        <div className="pad row-actions wrap">
          <button className="btn default" onClick={() => nav.openChat(getState().employees.find((e) => e.id === 'ops')?.id ?? getState().employees[0]?.id ?? '')}>让员工看看</button>
          {agent && !rejoin && <button className="btn ghost" onClick={() => setRejoin(true)}>重新接入（重装 / 换机器后用）</button>}
          {agent && <button className="btn ghost" onClick={removeAgent}>移除 Agent</button>}
          {s.id !== 'local' && <button className="btn ghost" onClick={remove}>去掉这台</button>}
        </div>
      </div>
    </div>
  )
}

// ======================= 凭证 =======================
const GROUPS: CredGroup[] = ['服务器', '数据库', '代码仓库', '云账号', 'AI', '消息渠道', '其它']
const KINDS: Credential['kind'][] = ['账号密码', '密钥', 'Token', '证书', '数据库']
export function LiveCredentialEditPage({ params, nav }: PageProps) {
  const existing = useStore((s) => s.credentials.find((x) => x.id === params.id))
  const employees = useStore((s) => s.employees)
  const [c, setC] = useState<Credential & { user?: string }>(() => existing ?? { id: '', name: '', group: params.group ?? '代码仓库', kind: 'Token', env: '生产', scope: '', usedBy: [], updated: '', aiAllowed: true, user: '' })
  const [secret, setSecret] = useState('')
  const [shown, setShown] = useState<string | null>(null)
  const save = async () => {
    if (!c.name.trim()) { toast('先起个名字'); return }
    if (!existing && !secret) { toast('值要填'); return }
    const r = await call(existing ? 'PUT' : 'POST', existing ? `/api/credentials/${c.id}` : '/api/credentials', { ...c, secret: secret || undefined }, '已加密保存，AI 拿不到明文')
    if (r) nav.back()
  }
  const reveal = async () => {
    if (shown !== null) { setShown(null); return }
    const r = await call<{ value: string }>('POST', `/api/credentials/${c.id}/reveal`)
    if (r) setShown(r.value)
  }
  const remove = async () => {
    if (!confirm(`删掉「${c.name}」？用到它的服务器 / 库 / 仓库会连不上`)) return
    if (await call('DELETE', `/api/credentials/${c.id}`, undefined, '已删除')) nav.back()
  }
  const toggleUser = (id: string) => setC({ ...c, usedBy: c.usedBy.includes(id) ? c.usedBy.filter((x) => x !== id) : [...c.usedBy, id] })
  return (
    <div className="page">
      <PageHeader title={existing ? existing.name : '带进来一个账号'} {...headNav(nav)} right={<button className="btn primary sm" onClick={save}>保存</button>} />
      <div className="page-body form">
        <Field label="是什么"><Segmented value={c.group as CredGroup} onChange={(v) => setC({ ...c, group: v })} options={GROUPS.map((g) => ({ value: g, label: g }))} /></Field>
        <Field label="名字"><input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder={c.group === '代码仓库' ? '比如：GitHub 个人令牌' : '比如：prod 只读账号'} /></Field>
        <Field label="类型"><Segmented value={c.kind} onChange={(v) => setC({ ...c, kind: v })} options={KINDS.map((k) => ({ value: k, label: k }))} /></Field>
        <Field label="用户名（可选）" hint={c.group === '代码仓库' ? 'GitHub 不用填；Codeup / Gitee 填你的用户名' : '账号密码类填这里'}>
          <input value={c.user ?? ''} onChange={(e) => setC({ ...c, user: e.target.value })} autoComplete="off" />
        </Field>
        <Field label={existing ? '新的值（留空 = 不改）' : '值'} hint="直接加密存起来；员工要用时由 Opero 代它去连，值不给 AI">
          {c.kind === '密钥' || c.kind === '证书'
            ? <textarea className="mono code-edit" rows={5} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="-----BEGIN …" />
            : <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="••••••••" autoComplete="new-password" />}
        </Field>
        <Field label="它在那边能做什么" hint="照实写（只读 / 读写 / 能部署…），给你自己看"><input value={c.scope} onChange={(e) => setC({ ...c, scope: e.target.value })} placeholder="只读" /></Field>
        <Field label="环境标签"><EnvPicker value={c.env} onChange={(v) => setC({ ...c, env: v })} /></Field>
        <div className="field">
          <span className="field-label">哪些员工用它（给你自己看的标记）</span>
          <div className="chips">{employees.map((e) => <button key={e.id} className={'chip' + (c.usedBy.includes(e.id) ? ' on' : '')} onClick={() => toggleUser(e.id)}>{e.name}</button>)}</div>
        </div>
        <div className="lrow boxed">
          <span className="row-main"><span className="row-title">允许 AI 员工使用</span><span className="row-sub">关掉后员工用它连服务器 / 查库会被拒绝，只有你本人能用</span></span>
          <Toggle on={c.aiAllowed} onChange={(v) => setC({ ...c, aiAllowed: v })} />
        </div>
        {existing && (
          <Section title="明文">
            <Row title={shown !== null ? <span className="mono small">{shown || '（空）'}</span> : '••••••••••••'} right={<button className="btn default sm" onClick={reveal}>{shown !== null ? '隐藏' : '查看'}</button>} />
            <Row title="删掉这个账号" danger onClick={remove} />
          </Section>
        )}
        <p className="hint">看明文、改、删都要先验证本人，并记进操作记录。</p>
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
        right={<button className="btn primary sm" onClick={() => nav.push({ page: 'dataSourceAdd' })}><IconPlus /> 接入</button>} />
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

export function DataSourceAddPage({ nav }: PageProps) {
  const [f, setF] = useState({ name: '', kind: 'MySQL' as DataSource['kind'], host: '', port: '', db: '', user: '', password: '', env: '生产' as EnvTag, writable: false })
  const [busy, setBusy] = useState(false)
  const up = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }))
  const save = async () => {
    setBusy(true)
    const r = await call<any>('POST', '/api/data-sources', f)
    setBusy(false)
    if (r) { toast(r.error ? `已加上，但${r.error}` : `已接入，读到 ${r.tables.length} 张表`); nav.back() }
  }
  return (
    <div className="page">
      <PageHeader title="接入数据库" {...headNav(nav)} right={<button className="btn primary sm" disabled={busy} onClick={save}>{busy ? '连接中…' : '接入'}</button>} />
      <div className="page-body form">
        <Field label="名字"><input value={f.name} onChange={(e) => up({ name: e.target.value })} placeholder="比如：shop 生产库" /></Field>
        <Field label="类型"><Segmented value={f.kind} onChange={(v) => up({ kind: v })} options={[{ value: 'MySQL', label: 'MySQL' }, { value: 'PostgreSQL', label: 'PostgreSQL' }]} /></Field>
        <div className="inline-form">
          <Field label="地址"><input value={f.host} onChange={(e) => up({ host: e.target.value })} placeholder="10.0.0.5" /></Field>
          <Field label="端口"><input value={f.port} onChange={(e) => up({ port: e.target.value })} placeholder={f.kind === 'MySQL' ? '3306' : '5432'} inputMode="numeric" /></Field>
        </div>
        <Field label="库名"><input value={f.db} onChange={(e) => up({ db: e.target.value })} /></Field>
        <div className="inline-form">
          <Field label="用户"><input value={f.user} onChange={(e) => up({ user: e.target.value })} autoComplete="off" /></Field>
          <Field label="密码"><input type="password" value={f.password} onChange={(e) => up({ password: e.target.value })} autoComplete="new-password" /></Field>
        </div>
        <Field label="环境标签" hint="随便起名；像生产的，改数据的确认卡片标成红色"><EnvPicker value={f.env} onChange={(v) => up({ env: v })} /></Field>
        <div className="lrow boxed">
          <span className="row-main"><span className="row-title">允许改数据</span><span className="row-sub">关着 = 只能查（推荐给生产库接只读账号）；开着员工改数据也要你点确认</span></span>
          <Toggle on={f.writable} onChange={(v) => up({ writable: v })} />
        </div>
        <p className="field-hint">账号加密存进「权限和凭证」。员工查库由 Opero 代它连：只读事务、15 秒超时、最多 200 行，手机号 / 密码这类列自动打码。</p>
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
              <button className="btn ghost" onClick={() => { const name = prompt('起个名字', sql.slice(0, 18)); if (name) call('POST', '/api/saved-queries', { source: d.id, name, sql }, '已存成常用查询') }}>存成常用</button>
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
        right={<button className="btn primary sm" onClick={() => nav.push({ page: 'triggerEdit' })}><IconPlus /> 新增</button>} />
      <div className="page-body">
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
      {(v.kind === 'min' || v.kind === 'hour') && <input type="number" min={v.kind === 'min' ? 5 : 1} value={v.n} onChange={(e) => emit({ n: e.target.value })} style={{ width: 90 }} />}
      {v.kind === 'week' && <select value={v.day} onChange={(e) => emit({ day: e.target.value })}>{Object.keys(WEEKLY).map((d) => <option key={d} value={d}>{d}</option>)}</select>}
      {v.kind !== 'min' && v.kind !== 'hour' && <input type="time" value={v.hm} onChange={(e) => emit({ hm: e.target.value })} style={{ width: 130 }} />}
    </div>
  )
}

export function LiveTriggerEditPage({ params, nav }: PageProps) {
  const existing = useStore((s) => s.triggers.find((x) => x.id === params.id)) as (Trigger & { prompt?: string; hookPath?: string }) | undefined
  const employees = useStore((s) => s.employees)
  const [t, setT] = useState<Trigger & { prompt?: string }>(() => existing ?? { id: '', name: '', kind: '定时', rule: '每 30 分钟', employee: params.employee ?? employees[0]?.id ?? '', enabled: true, last: '还没触发', prompt: '' })
  const save = async () => {
    const r = await call(existing ? 'PUT' : 'POST', existing ? `/api/triggers/${t.id}` : '/api/triggers', t, '触发器已保存')
    if (r) nav.back()
  }
  const hook = existing?.hookPath ? `${location.origin}${existing.hookPath}` : ''
  return (
    <div className="page">
      <PageHeader title={existing ? existing.name : '新触发器'} {...headNav(nav)} right={<button className="btn primary sm" onClick={save}>保存</button>} />
      <div className="page-body form">
        <Field label="名字"><input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="比如：生产日志巡检" /></Field>
        <Field label="什么时候"><Segmented value={t.kind as '定时' | 'Webhook'} onChange={(v) => setT({ ...t, kind: v })} options={[{ value: '定时', label: '定时' }, { value: 'Webhook', label: 'Webhook' }]} /></Field>
        {t.kind === '定时'
          ? <Field label="规则"><RulePicker rule={t.rule} onChange={(rule) => setT({ ...t, rule })} /></Field>
          : <Field label="地址" hint="别的系统（报警、CI、表单）POST 到这个地址，收到的内容会一起交给员工">
              {hook ? <div className="cmd-box mono">{hook}<button className="btn ghost sm" onClick={() => copy(hook)}>复制</button></div> : <p className="sub">保存后生成（地址里带密钥，别外传）</p>}
            </Field>}
        <Field label="交给哪个员工">
          <select value={t.employee} onChange={(e) => setT({ ...t, employee: e.target.value })}>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
        </Field>
        <Field label="要它做什么" hint="每次触发都把这段话交给员工">
          <textarea rows={5} value={t.prompt ?? ''} onChange={(e) => setT({ ...t, prompt: e.target.value })}
            placeholder={'比如：用 server_exec 看 prod-web-1 上 shop 服务最近 30 分钟的日志（journalctl -u shop --since "30 min ago"），有 ERROR 就合并同类、查原因，发卡片给我；没有就说「正常」。'} />
        </Field>
        <div className="lrow"><span className="row-main"><span className="row-title">启用</span></span><Toggle on={t.enabled} onChange={(v) => setT({ ...t, enabled: v })} /></div>
        {existing && (
          <div className="row-actions wrap">
            <button className="btn default" onClick={() => call('POST', `/api/triggers/${t.id}/run`, undefined, `已派给「${empName(t.employee)}」`)}>现在跑一次</button>
            <button className="btn ghost" onClick={() => { if (confirm('删掉这个触发器？')) call('DELETE', `/api/triggers/${t.id}`, undefined, '已删除').then(() => nav.back()) }}>删除</button>
          </div>
        )}
      </div>
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
    const r = await call(edit.id ? 'PUT' : 'POST', edit.id ? `/api/kb/${edit.id}` : '/api/kb', edit, '已保存，所有员工马上能查到')
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
            <Field label="名字"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="比如：退款流程说明" /></Field>
            <Field label="类型"><Segmented value={edit.kind} onChange={(v) => setEdit({ ...edit, kind: v })} options={KB_KINDS.map((k) => ({ value: k, label: k }))} /></Field>
            <Field label="内容（Markdown）"><textarea className="code-edit" rows={12} value={edit.body ?? ''} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
            <button className="btn primary block" onClick={save}>保存</button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

// ======================= 工作空间 =======================
export function LiveWorkspacesPage({ nav }: PageProps) {
  const list = useStore((s) => s.workspaces)
  return (
    <div className="page">
      <PageHeader title="工作空间" sub="员工干活的代码仓库（拉到这台服务器上）" {...headNav(nav)}
        right={<button className="btn primary sm" onClick={() => nav.push({ page: 'workspaceAdd' })}><IconPlus /> 接入</button>} />
      <div className="page-body">
        <Section flush>
          {list.length === 0 && <Empty>还没有。接一个 GitHub / Codeup / Gitee 仓库，再在员工设置里选它当工作空间</Empty>}
          {list.map((w) => (
            <Row key={w.id} icon={<span className="ws-icon">{w.name.slice(0, 1).toUpperCase()}</span>} chevron onClick={() => nav.push({ page: 'workspace', params: { id: w.id } })}
              title={<>{w.name} {w.branch && <Tag>{w.branch}</Tag>} {(w as Workspace & { error?: string }).error && <Tag tone="danger">有问题</Tag>}</>} sub={`${w.provider} · ${w.repo} · ${w.last}`} />
          ))}
        </Section>
      </div>
    </div>
  )
}

export function LiveWorkspaceAddPage({ nav }: PageProps) {
  const creds = useStore((s) => s.credentials.filter((c) => c.group === '代码仓库'))
  const [repo, setRepo] = useState('')
  const [branch, setBranch] = useState('')
  const [name, setName] = useState('')
  const [credential, setCredential] = useState(creds[0]?.id ?? '')
  const workHosts = useWorkHosts()
  const [server, setServer] = useState('local')
  const auto = repo.replace(/\.git$/, '').split('/').filter(Boolean).pop() ?? ''
  const save = async () => {
    const r = await call('POST', '/api/workspaces', { repo: repo.trim(), branch: branch.trim(), name: name.trim() || auto, credential, server }, '在拉代码，好了会显示分支和提交')
    if (r) nav.back()
  }
  return (
    <div className="page">
      <PageHeader title="接入仓库" {...headNav(nav)} right={<button className="btn primary sm" onClick={save}>接入</button>} />
      <div className="page-body form">
        <Field label="仓库地址（HTTPS）"><input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/you/app.git" /></Field>
        <Field label="名字" hint="留空用仓库名"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={auto} /></Field>
        <Field label="分支" hint="留空用默认分支"><input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" /></Field>
        {workHosts.length > 1 && (
          <Field label="拉到哪台服务器" hint="要和用它的员工在同一台">
            <select value={server} onChange={(e) => setServer(e.target.value)}>{workHosts.map((x) => <option key={x.id} value={x.id}>{hostLabel(x)}</option>)}</select>
          </Field>
        )}
        <Field label="用哪个令牌" hint="公开仓库可以不选；私有仓库先在「权限和凭证 → 代码仓库」带进来">
          <select value={credential} onChange={(e) => setCredential(e.target.value)}>
            <option value="">不用（公开仓库）</option>
            {creds.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <div className="row-actions"><button className="btn ghost sm" onClick={() => nav.push({ page: 'credentialEdit', params: { group: '代码仓库' } })}>带进来一个令牌</button></div>
        <p className="field-hint">令牌只在 Opero 拉取 / 推送时用（不写进仓库配置），员工要同步远端就调 git_sync，拿不到令牌。</p>
      </div>
    </div>
  )
}

export function LiveWorkspacePage({ params, nav }: PageProps) {
  const w = useStore((s) => s.workspaces.find((x) => x.id === params.id)) as (Workspace & { error?: string }) | undefined
  const emps = useStore((s) => s.employees)
  const creds = useStore((s) => s.credentials.filter((c) => c.group === '代码仓库'))
  const [busy, setBusy] = useState(false)
  const refresh = async () => { if (!w) return; setBusy(true); await call('POST', `/api/workspaces/${w.id}/refresh`); setBusy(false) }
  useEffect(() => { refresh() }, [params.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!w) return <div className="page"><PageHeader title="工作空间" {...headNav(nav)} /><Empty>找不到（员工没选工作空间时在它自己的目录里干活）</Empty></div>
  const users = emps.filter((e) => e.workspace === w.id)
  return (
    <div className="page">
      <PageHeader title={w.name} sub={`${w.provider} · ${w.repo}`} {...headNav(nav)} right={<button className="btn default sm" disabled={busy} onClick={refresh}>{busy ? '刷新中…' : '刷新'}</button>} />
      <div className="page-body">
        {w.error && <div className="pad"><div className="banner b-warn">{w.error}</div></div>}
        <div className="stats"><Stat label="分支" value={w.branches.length} /><Stat label="最近提交" value={w.commits.length} /><Stat label="员工" value={users.length} /></div>
        <Section title="在这里干活的员工" right={<span className="sub">在员工的「编辑」里选工作空间</span>}>
          {users.length === 0 && <Empty>还没有员工用它</Empty>}
          {users.map((e) => <Row key={e.id} icon={<Avatar id={e.id} size={36} />} title={e.name} chevron onClick={() => nav.openChat(e.id)} />)}
        </Section>
        <Section title="分支">{w.branches.map((b) => <Row key={b.name} title={<span className="mono">{b.name}</span>} right={<span className="sub">{b.status}</span>} />)}</Section>
        <Section title="最近提交">{w.commits.map((c) => <Row key={c.sha} title={c.msg} sub={<><span className="mono">{c.sha}</span> · {c.who} · {c.when}</>} />)}</Section>
        {w.docs.length > 0 && <Section title="文档（docs/）">{w.docs.map((d) => <Row key={d.name} title={<span className="mono">{d.name}</span>} sub={`更新于 ${d.updated}`} />)}</Section>}
        <Section title="位置">
          <Row title="目录" right={<span className="mono small">{w.dir}</span>} />
          <Row title="令牌" right={
            <select value={w.credential ?? ''} onChange={(e) => call('PUT', `/api/workspaces/${w.id}`, { credential: e.target.value }, '已改')}>
              <option value="">不用</option>{creds.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>} />
        </Section>
        <div className="pad row-actions"><button className="btn ghost" onClick={() => { if (confirm(`从 Opero 里去掉「${w.name}」？（服务器上的目录留着）`)) call('DELETE', `/api/workspaces/${w.id}`, undefined, '已去掉').then(() => nav.back()) }}>去掉</button></div>
      </div>
    </div>
  )
}

// ======================= 员工档案 =======================
export function LiveEmployeePage({ params, nav }: PageProps) {
  const e = useStore((s) => s.employees.find((x) => x.id === params.id))
  const usage = useStore((s) => s.usage)
  const triggers = useStore((s) => s.triggers)
  const ws = useStore((s) => s.workspaces.find((w) => w.id === e?.workspace))
  const servers = useStore((s) => s.servers)
  const [work, setWork] = useState(false)
  if (!e) return <div className="page"><PageHeader title="员工" {...headNav(nav)} /><Empty>找不到这个员工</Empty></div>
  const u = usage.find((x) => x.employee === e.id)
  const mine = triggers.filter((t) => t.employee === e.id)
  const sv = servers.find((x) => x.id === e.host)
  const hostName = !sv ? 'Opero 这台' : sv.id === 'local' ? srvName(sv) : `${sv.name}${sv.online ? '' : '（离线）'}`
  const remove = async () => {
    if (!confirm(`删掉「${e.name}」？它的聊天记录也会删掉（工作空间里的代码不受影响）`)) return
    if (await call('DELETE', `/api/employees/${e.id}`, undefined, '已删除')) nav.back()
  }
  return (
    <div className="page">
      <PageHeader title={e.name} sub="员工档案" {...headNav(nav)} right={<button className="btn default sm" onClick={() => nav.push({ page: 'employeeEdit', params: { id: e.id } })}>编辑</button>} />
      <div className="page-body">
        <div className="hero">
          <Avatar id={e.id} size={64} />
          <div className="hero-main"><b>{e.name}</b><span className="sub">{e.title}</span></div>
          <button className="btn primary" onClick={() => nav.openChat(e.id)}>发消息</button>
        </div>
        {u && (
          <div className="stats">
            <Stat label="本月轮数" value={u.tasks} />
            <Stat label="成功率" value={u.tasks ? `${Math.round((u.success / u.tasks) * 100)}%` : '—'} />
            <Stat label="本月花费" value={`${CUR}${u.cost.toFixed(2)}`} sub={u.tokens + ' token'} />
          </div>
        )}
        <Section title="work" right={<span className="sub">选了就记住</span>}>
          <Row title="执行器" right={e.executor} />
          <Row title="模型" right={e.model} chevron onClick={() => setWork(true)} />
          <Row title="思考方式" right={effortLabel(e.effort)} chevron onClick={() => setWork(true)} />
          <Row title="审核方式" right={approvalLabel(e.approval)} chevron onClick={() => setWork(true)} />
          <Row title="上下文" right={`${e.contextUsed ?? 0}%`} />
        </Section>
        <Section title="在哪干活">
          <Row title="服务器" right={hostName} />
          <Row title="工作空间" right={ws ? ws.name : '它自己的目录'} chevron={!!ws} onClick={ws ? () => nav.push({ page: 'workspace', params: { id: ws.id } }) : undefined} />
        </Section>
        {e.prompt && <Section title="职责"><p className="prose">{e.prompt}</p></Section>}
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

