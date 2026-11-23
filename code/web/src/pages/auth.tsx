// 登录 · 开机向导（第一次用：在聊天里一步一张卡片）
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { finishSetup, login, setSettings, toast, useStore } from '../store'
import { LangPicker } from '../components/LangPicker'
import { Mark, Wordmark } from '../components/brand'
import { Field, Segmented } from '../components/ui'
import { modelsFor } from '../work'
import { IconCheck, IconFingerprint } from '../components/icons'

export function LoginPage() {
  const me = useStore((s) => s.me)
  const [email, setEmail] = useState(me.email)
  const [pwd, setPwd] = useState('demo-password')
  const [busy, setBusy] = useState(false)
  const go = () => {
    if (!email || !pwd) { toast('填一下账号和密码'); return }
    setBusy(true)
    setTimeout(login, 600)
  }
  return (
    <div className="auth">
      <div className="auth-box">
        <div className="auth-logo"><Wordmark size={40} /></div>
        <p className="sub center">和 AI 团队聊天，搞定开发</p>
        <Field label="账号"><input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></Field>
        <Field label="密码"><input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="current-password"
          onKeyDown={(e) => e.key === 'Enter' && go()} /></Field>
        <button className="btn primary block lg" onClick={go} disabled={busy}>{busy ? '登录中…' : '登录'}</button>
        <button className="btn default block lg" onClick={() => { setBusy(true); setTimeout(login, 800) }}>
          <IconFingerprint size={20} /> 用通行密钥 / 指纹登录
        </button>
        <p className="hint center">演示：账号密码已经填好，直接点「登录」。</p>
        <div className="auth-lang"><LangPicker onPick={(p) => setSettings({ lang: p })} /></div>
      </div>
    </div>
  )
}

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
const STEPS = ['你的账号', '接入服务器', '接 AI 执行器', '带入权限', '拉 Opero 代码', '系统管家', '后台开发员工']
const PERMS = ['Codeup 个人令牌', '数据库账号', '云账号（AccessKey）', '其它服务器']

/** 开机向导：从一台空服务器到能和系统管家聊天 */
export function Onboarding() {
  const me = useStore((s) => s.me)
  const [step, setStep] = useState<Step>(1)
  const [busy, setBusy] = useState(false)
  const [exec, setExec] = useState<'Claude Code' | 'Codex'>('Claude Code')
  const [model, setModel] = useState('Opus 5.5')
  const [auth, setAuth] = useState<'key' | 'sub'>('key')
  const [key, setKey] = useState('')
  const [picked, setPicked] = useState<string[]>(['Codeup 个人令牌'])
  const [repo, setRepo] = useState('https://github.com/your-name/opero.git')
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [step, busy])

  const next = (ms = 900) => {
    setBusy(true)
    setTimeout(() => { setBusy(false); setStep((s) => (s + 1) as Step) }, ms)
  }
  const cmd = 'curl -fsSL https://opero.yimakeji.cn/agent.sh | bash -s -- opr_x7k2m9q4'

  return (
    <div className="onboard">
      <header className="onboard-head">
        <Mark size={30} />
        <b>开机向导</b>
        <span className="grow" />
        <button className="btn ghost sm" onClick={finishSetup}>跳过</button>
      </header>
      <div className="onboard-steps">
        {STEPS.map((s, i) => (
          <span key={s} className={'ostep' + (i < step ? ' done' : i === step ? ' on' : '')}>{i < step ? '✓' : i + 1} {s}</span>
        ))}
      </div>
      <div className="onboard-body">
        <Bot>欢迎！我是 Opero，你的个人开发助理。跟着走 6 步，10 分钟内就能和你的 AI 员工聊天。</Bot>
        <DoneCard title="① 你的账号" text={`已登录：${me.email}。这套 Opero 只有你一个人用：你在公司有什么权限就带进来，没有的这里也没有；习惯不同就自己二开`} />

        {step >= 1 && (step > 1 ? <DoneCard title="② 接入服务器" text="已连接 AWS-dev · Ubuntu 24.04 · 2 核 8G · Agent 2.0.1" /> : (
          <StepCard title="② 接入服务器" desc="在要干活的服务器上用 root 跑这一条（装 Agent、建开发用户和工作区；服务器只主动连出，不开端口）：">
            <div className="cmd-box mono">{cmd}<button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(cmd).catch(() => {}); toast('已复制') }}>复制</button></div>
            <div className="row-actions"><button className="btn primary" disabled={busy} onClick={() => next(1400)}>{busy ? '等它连上来…' : '我已经运行了'}</button></div>
          </StepCard>
        ))}

        {step >= 2 && (step > 2 ? <DoneCard title="③ 接 AI 执行器" text={`${exec} · ${model} · ${auth === 'key' ? 'API Key' : '订阅'} · 测试通过（回复「你好」用了 2.1 秒）`} /> : (
          <StepCard title="③ 让员工能干活：接 AI 执行器" desc="密钥直接存进凭据中心，AI 员工看不到明文。">
            <Field label="执行器"><Segmented value={exec} onChange={(v) => { setExec(v); setModel(modelsFor(v)[0]) }} options={[{ value: 'Claude Code', label: 'Claude Code' }, { value: 'Codex', label: 'Codex' }]} /></Field>
            <Field label="默认模型" hint="新员工默认用它；每个员工以后还能单独改，选了就记住">
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {modelsFor(exec).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="认证" hint={auth === 'sub' ? '订阅只适合自己用；给别人提供服务请用 API Key' : undefined}>
              <Segmented value={auth} onChange={setAuth} options={[{ value: 'key', label: 'API Key' }, { value: 'sub', label: '订阅登录' }]} />
            </Field>
            {auth === 'key'
              ? <Field label="API Key"><input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-••••••••" /></Field>
              : <p className="sub">点「保存并测试」后，在服务器上按提示跑一次 <span className="mono">claude setup-token</span>。</p>}
            <div className="row-actions"><button className="btn primary" disabled={busy} onClick={() => next(1300)}>{busy ? '测试中…' : '保存并测试'}</button></div>
          </StepCard>
        ))}

        {step >= 3 && (step > 3 ? <DoneCard title="④ 带入你的权限" text={picked.length ? `带进来了：${picked.join('、')}（以后在「权限和凭证」里加减）` : '先跳过，以后在「权限和凭证」里加'} /> : (
          <StepCard title="④ 带入你在公司的权限" desc="Opero 不另设权限：你有哪些账号就带进来，员工就能用；没有的这里也没有。值都加密存，AI 只拿编号。">
            <div className="chips">
              {PERMS.map((p) => (
                <button key={p} className={'chip' + (picked.includes(p) ? ' on' : '')} onClick={() => setPicked((x) => (x.includes(p) ? x.filter((y) => y !== p) : [...x, p]))}>{p}</button>
              ))}
            </div>
            <p className="field-hint">原型里点选就算带进来；正式版每一项会让你填对应的令牌 / 账号。</p>
            <div className="row-actions">
              <button className="btn ghost" disabled={busy} onClick={() => { setPicked([]); next(300) }}>以后再加</button>
              <button className="btn primary" disabled={busy} onClick={() => next(900)}>{busy ? '加密保存中…' : '带进来'}</button>
            </div>
          </StepCard>
        ))}

        {step >= 4 && (step > 4 ? <DoneCard title="⑤ 拉 Opero 代码" text="已拉到 AWS-dev:/home/dev/work/opero，成了工作空间「opero」" /> : (
          <StepCard title="⑤ 把后台自己的代码拉到服务器" desc="填你 fork 的 Opero 仓库；以后「后台开发」员工就在这里给 Opero 加功能。">
            <Field label="仓库地址"><input value={repo} onChange={(e) => setRepo(e.target.value)} /></Field>
            <div className="row-actions"><button className="btn primary" disabled={busy} onClick={() => next(1100)}>{busy ? '拉代码中…' : '拉取'}</button></div>
          </StepCard>
        ))}

        {step >= 5 && (step > 5 ? <DoneCard title="⑥ 系统管家" text="建好了：建员工、改设置、管凭据和插件，以后这些事跟它说" /> : (
          <StepCard title="⑥ 建第一个员工：系统管家" desc="建员工、改设置、管凭据和插件，都可以跟它说。">
            <div className="row-actions"><button className="btn primary" disabled={busy} onClick={() => next(800)}>{busy ? '建中…' : '建好它'}</button></div>
          </StepCard>
        ))}

        {step >= 6 && (step > 6 ? <DoneCard title="⑦ 后台开发员工" text="建好了：缺功能就跟它说，先预览、你点「上线」才发" /> : (
          <StepCard title="⑦ 建「后台开发」员工" desc="它知道 Opero 的所有规矩；缺功能自己做成插件，先起预览给你看。">
            <div className="row-actions"><button className="btn primary" disabled={busy} onClick={() => next(800)}>{busy ? '建中…' : '建好它'}</button></div>
          </StepCard>
        ))}

        {step >= 7 && (
          <>
            <Bot>都好了 🎉 以后想要什么，直接跟员工说。</Bot>
            <div className="row-actions center"><button className="btn primary lg" onClick={finishSetup}>进入 Opero</button></div>
          </>
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}

function Bot({ children }: { children: ReactNode }) {
  return (
    <div className="row">
      <span className="avatar bot"><Mark size={22} /></span>
      <div className="bubble">{children}</div>
    </div>
  )
}

function StepCard({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="row">
      <span className="avatar bot"><Mark size={22} /></span>
      <div className="card k-primary step-card">
        <div className="card-head"><span className="card-title">{title}</span></div>
        <p className="note">{desc}</p>
        {children}
      </div>
    </div>
  )
}

function DoneCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="row">
      <span className="avatar bot"><Mark size={22} /></span>
      <div className="card done-card">
        <div className="card-head inline"><IconCheck size={16} /><span className="card-title">{title}</span></div>
        <p className="note sub">{text}</p>
      </div>
    </div>
  )
}
