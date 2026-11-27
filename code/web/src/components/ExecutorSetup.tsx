// 接 AI 执行器（傻瓜式）：① 一键安装 ② 网络出口（只 Claude / Codex）③ 登录 = 加账号 ④ 测试。
// 登录：Claude 订阅点按钮 → 浏览器里批准 → 贴回授权码，或者直接贴订阅令牌 / API Key（可带自己的接口地址）；Codex 贴 OpenAI API Key；
// Qwen Code 贴百炼 API Key（可换接口地址、默认模型）；CodeBuddy Code 贴 CodeBuddy API Key（国内站 / 国际站）。
// 每种方式都是新加一个账号，每种执行器都能存好几个，设默认、改名、改接口地址、去掉。
// 全程不用碰服务器命令行；安装、登录都由 Opero 在服务器上替你做（code/server/src/executors.ts）。
import { useEffect, useRef, useState } from 'react'
import { call } from '../live'
import { toast, useStore } from '../store'
import { Field, Segmented } from './ui'
import { IconCheck } from './icons'
import { EXECUTORS, execKind, type ExecKind, type ExecName } from '../work'

export interface AiInfo {
  aiUser: string; isolated: boolean; claude: string | null; codex: string | null; qwen?: string | null; codebuddy?: string | null
  claudeKey: boolean; claudeBaseUrl: string; codexKey: boolean; codexBaseUrl: string
  /** 网络出口：'' = 直连；local = 经 Opero 这台；服务器编号 = 经那台 Agent */
  claudeEgress?: string; codexEgress?: string
  claudeAccounts?: AiAccount[]
  codexAccounts?: AiAccount[]
  qwenAccounts?: AiAccount[]
  codebuddyAccounts?: AiAccount[]
  /** Qwen Code 不填接口地址 / 模型时用的（百炼、qwen3-coder-plus） */
  qwenBase?: string; qwenModel?: string
}
export interface AiAccount { id: string; kind: ExecKind; name: string; user: string; updated: string; isDefault: boolean; baseUrl: string; region?: string; model?: string; limitedUntil: number; employees: string[]; sub: boolean
  /** Codex 订阅账号的 ChatGPT 套餐（Plus / Pro / Business…） */
  plan?: string }
/** 这种执行器装没装、有没有账号 */
export const execState = (info: AiInfo | null | undefined, k: ExecKind) => ({
  installed: info?.[k] ?? null,
  loggedIn: !!info && (k === 'claude' ? info.claudeKey : k === 'codex' ? info.codexKey : (info[`${k}Accounts`]?.length ?? 0) > 0),
})

/** 选执行器：2×2 的小卡片（名字、谁家的、一句话；给了 info 就标装没装、登没登录） */
export function ExecPicker({ value, onChange, info, compact }: { value: string; onChange: (v: ExecName) => void; info?: AiInfo | null; compact?: boolean }) {
  const cur = execKind(value)
  return (
    <div className={'exec-pick' + (compact ? ' compact' : '')} role="radiogroup">
      {EXECUTORS.map((x) => {
        const st = info ? execState(info, x.kind) : null
        return (
          <button key={x.value} type="button" role="radio" aria-checked={cur === x.kind} className={cur === x.kind ? 'on' : ''} onClick={() => onChange(x.value)}>
            <b>{x.value}</b>
            <span>{x.vendor}</span>
            {!compact && <small>{st ? (st.installed ? (st.loggedIn ? '能用了' : '装好了 · 还没登录') : '还没装') : x.desc}</small>}
            {st?.installed && st.loggedIn && <i className="exec-pick-ok"><IconCheck size={12} /></i>}
          </button>
        )
      })}
    </div>
  )
}
/** 员工 work 设置里选 Claude 账号用 */
export type ClaudeAccount = AiAccount

const hhmm = (ts: number) => { const d = new Date(ts); return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
/** 存着的账号（Claude / Codex 各一组，可以好几个）：默认哪个、订阅还是 API Key、走哪个接口地址、谁在用、到没到上限；设默认、改名、改接口地址、从 Opero 去掉（令牌本身不作废） */
export function AiAccounts({ list, reload, kind }: { list: AiAccount[]; reload: () => Promise<unknown>; kind: ExecKind }) {
  if (!list.length) return null
  const act = async (id: string, body: Record<string, unknown>, msg: string) => { if (await call('PUT', `/api/ai/accounts/${id}`, body, msg)) await reload() }
  const rename = (a: AiAccount) => { const n = prompt('给这个账号起个名字（比如用的是谁的订阅）', a.name); if (n && n.trim() && n.trim() !== a.name) void act(a.id, { name: n.trim() }, '已改名') }
  const setBase = (a: AiAccount) => { const n = prompt(kind === 'qwen' ? '这个账号走哪个接口地址（OpenAI 兼容）？空着 = 百炼（国内）' : '这个账号走哪个接口地址（代理 / 中转）？空着 = 官方', a.baseUrl); if (n !== null && n.trim() !== a.baseUrl) void act(a.id, { baseUrl: n.trim() }, n.trim() ? '已设接口地址' : '已改回官方') }
  const setModel = (a: AiAccount) => { const n = prompt('员工没单独选模型时用哪个？空着 = qwen3-coder-plus', a.model ?? ''); if (n !== null && n.trim() !== (a.model ?? '')) void act(a.id, { model: n.trim() }, '已改默认模型') }
  const flipRegion = (a: AiAccount) => void act(a.id, { region: a.region === 'intl' ? '' : 'intl' }, a.region === 'intl' ? '已改成国内站' : '已改成国际站')
  const remove = async (a: AiAccount) => {
    if (!confirm(`从 Opero 去掉「${a.name}」？\n\n只是 Opero 不再用它：账号和令牌本身不受影响，别的项目照常能用。${a.employees.length ? `\n指定用它的员工（${a.employees.join('、')}）会改用默认账号。` : ''}`)) return
    if (await call('DELETE', `/api/ai/accounts/${a.id}`, undefined, '已从 Opero 去掉')) await reload()
  }
  return (
    <div className="acct-list">
      {list.map((a) => (
        <div key={a.id} className={'acct' + (a.isDefault ? ' on' : '')}>
          <div className="acct-main">
            <b>{a.name}</b>
            <span className="acct-tags">
              {a.isDefault && <span className="acct-tag def">默认</span>}
              <span className="acct-tag">{a.sub ? (kind === 'codex' ? `ChatGPT${a.plan ? ` ${a.plan}` : ''} 订阅` : '订阅') : 'API Key'}</span>
              {kind === 'qwen' && <span className="acct-tag">{a.model || 'qwen3-coder-plus'}</span>}
              {kind === 'codebuddy' && <span className="acct-tag">{a.region === 'intl' ? '国际站 codebuddy.ai' : '国内站 codebuddy.cn'}</span>}
              {a.baseUrl && <span className="acct-tag" title={a.baseUrl}>{`经 ${a.baseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`}</span>}
              {a.limitedUntil > 0 && <span className="acct-tag warn">{`用量到上限 · ${hhmm(a.limitedUntil)} 前先用别的`}</span>}
              {a.employees.length > 0 && <span className="acct-tag">{`${a.employees.join('、')} 指定用它`}</span>}
            </span>
          </div>
          <span className="acct-acts">
            {!a.isDefault && <button className="btn ghost sm" onClick={() => act(a.id, { isDefault: true }, '已设成默认')}>设成默认</button>}
            {a.limitedUntil > 0 && <button className="btn ghost sm" onClick={() => act(a.id, { clearLimit: true }, '已恢复')}>已恢复</button>}
            <button className="btn ghost sm" onClick={() => rename(a)}>改名</button>
            {!a.sub && <button className="btn ghost sm" onClick={() => setBase(a)}>接口地址</button>}
            {kind === 'qwen' && <button className="btn ghost sm" onClick={() => setModel(a)}>模型</button>}
            {kind === 'codebuddy' && <button className="btn ghost sm" onClick={() => flipRegion(a)}>{a.region === 'intl' ? '改国内站' : '改国际站'}</button>}
            <button className="btn ghost sm" onClick={() => remove(a)}>去掉</button>
          </span>
        </div>
      ))}
      <p className="field-hint">{kind === 'claude' || kind === 'codex' ? '员工默认用「默认」账号，也能在员工的 work 设置里单独指定；一个账号用量到上限，后面的活自动先换别的账号。' : '员工用「默认」账号。'}</p>
    </div>
  )
}
interface Job { id: string; type: 'install' | 'login'; executor: ExecKind; host?: string; screen?: string; state: 'running' | 'waitCode' | 'waitDevice' | 'verifying' | 'ok' | 'fail'; log: string; url?: string; userCode?: string; message?: string }

/** 后台的安装 / 登录进度：每秒问一次，做完停 */
function useJob(onDone: (j: Job) => void) {
  const [job, setJob] = useState<Job | null>(null)
  const done = useRef(onDone)
  done.current = onDone
  // 刷新了页面 / 换了设备：后台还在装或在登录，接着显示进度
  useEffect(() => {
    call<{ job: Job | null }>('GET', '/api/ai/job').then((r) => {
      const j = r?.job
      if (j && (j.state === 'running' || j.state === 'waitCode' || j.state === 'waitDevice' || j.state === 'verifying')) setJob(j)
    })
  }, [])
  useEffect(() => {
    if (!job || job.state === 'ok' || job.state === 'fail') return
    const t = window.setTimeout(async () => {
      const r = await call<{ job: Job | null }>('GET', '/api/ai/job')
      const j = r?.job
      if (!j || j.id !== job.id) return
      setJob(j)
      if (j.state === 'ok' || j.state === 'fail') done.current(j)
    }, 1000)
    return () => clearTimeout(t)
  }, [job])
  return [job, setJob] as const
}

function Step({ n, title, ok, children }: { n: number; title: string; ok?: boolean; children: React.ReactNode }) {
  return (
    <div className="exec-step">
      <div className="exec-step-head"><span className={'exec-n' + (ok ? ' ok' : '')}>{ok ? <IconCheck size={14} /> : n}</span><b>{title}</b></div>
      <div className="exec-step-body">{children}</div>
    </div>
  )
}

/** host：在哪台服务器上装 / 登录（local = Opero 这台，其它 = 装了 Agent 的服务器）；账号是所有服务器共用的 */
export function ExecutorSetup({ info, reload, onReady, host = 'local' }: { info: AiInfo; reload: () => Promise<unknown>; onReady?: (exec: string) => void; host?: string }) {
  // 默认停在已经装好的那个（都没装就 Claude Code）
  const [exec, setExec] = useState<ExecName>(() => EXECUTORS.find((x) => info[x.kind])?.value ?? 'Claude Code')
  const kind = execKind(exec)
  const claude = kind === 'claude'
  const codex = kind === 'codex'
  const egress = claude || codex // 国内的两家直连，不用出口
  const { installed, loggedIn } = execState(info, kind)
  // 登录方式：订阅登录（Claude / Codex 默认）· 贴 auth.json（Codex）· 贴 Key（国内两家只有这个）
  const [how, setHow] = useState<'sub' | 'file' | 'key'>(() => (kind === 'claude' || kind === 'codex' ? 'sub' : 'key'))
  const [region, setRegion] = useState<'cn' | 'intl'>('cn')
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [code, setCode] = useState('')
  const [base, setBase] = useState('')
  const [name, setName] = useState('')
  const [adv, setAdv] = useState(false)
  const [busy, setBusy] = useState('')
  const [test, setTest] = useState<{ ok: boolean; ms: number; out: string } | null>(null)
  const autoTest = useRef<() => void>(() => {})
  const [job, setJob] = useJob(async (j) => {
    await reload()
    toast(j.state === 'ok' ? (j.type === 'install' ? '装好了' : '登录成功，正在试一下') : (j.message ?? '没成功'))
    if (j.state === 'ok' && j.type === 'login') autoTest.current() // 登录好了直接帮他把第 4 步跑了
  })
  const mine = job && job.executor === kind && (job.host ?? 'local') === host ? job : null
  const live = mine && (mine.state === 'running' || mine.state === 'waitCode' || mine.state === 'waitDevice' || mine.state === 'verifying')

  const install = async () => { setTest(null); const r = await call<{ job: Job }>('POST', '/api/ai/install', { executor: exec, host }); if (r) setJob(r.job) }
  // 点登录时先同步开一个空白页（异步拿到网址后再开会被浏览器当弹窗拦掉），网址到了再跳过去
  const pop = useRef<Window | null>(null)
  const login = async () => {
    setCode('')
    const w = window.open('', '_blank')
    if (w) { try { w.document.title = 'Claude'; w.document.body.innerHTML = '<p style="font:16px sans-serif;padding:24px">正在打开 Claude 登录页…</p>' } catch { /* 跨域 / 不让写 */ } }
    pop.current = w
    const r = await call<{ job: Job }>('POST', '/api/ai/login', { host })
    if (r) setJob(r.job)
    else { w?.close(); pop.current = null }
  }
  useEffect(() => {
    const w = pop.current
    if (!mine?.url || !w) return
    pop.current = null
    if (!w.closed) { try { w.opener = null } catch { /* 无所谓 */ } w.location.href = mine.url }
  }, [mine?.url])
  useEffect(() => {
    if (mine?.type === 'login' && (mine.state === 'ok' || mine.state === 'fail')) { pop.current?.close(); pop.current = null }
  }, [mine?.state])
  // Codex：用 ChatGPT 账号登录（设备码，网址和码显示在页面上，不用开新窗口）
  const codexLogin = async () => { const r = await call<{ job: Job }>('POST', '/api/ai/login', { executor: 'codex', host }); if (r) setJob(r.job) }
  // Codex：贴别的电脑上 codex login 以后的 auth.json
  const addAuthFile = async () => {
    const v = key.trim()
    if (!v.startsWith('{') || !v.endsWith('}')) { toast('要贴 auth.json 的全部内容：从 { 开始，到 } 结束'); return }
    setBusy('save')
    const r = await call('POST', '/api/ai/accounts', { executor: 'codex', value: v, name: name.trim() || undefined, makeDefault: true, host }, '已加一个 ChatGPT 订阅账号')
    setBusy('')
    if (r) { setKey(''); setName(''); await reload(); void runTest() }
  }
  // 等授权码时：贴进来的就是授权码
  const submit = async (raw: string) => {
    const v = raw.trim()
    if (!v) { toast('先把码贴进来'); return }
    const r = await call<{ job: Job }>('POST', '/api/ai/login/code', { code: v })
    if (r?.job) { setCode(''); setJob(r.job) }
  }
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const v = e.clipboardData.getData('text').trim()
    if (!v) return
    e.preventDefault()
    setCode(v)
    if (mine?.state === 'waitCode' && v.length >= 20) void submit(v)
  }
  // 不登录了，改成贴已有的令牌 / API Key
  const toPaste = async () => {
    if (mine?.type === 'login' && (mine.state === 'waitCode' || mine.state === 'running')) { const r = await call<{ job: Job }>('POST', '/api/ai/job/cancel'); if (r) setJob(r.job) }
    setHow('key')
  }
  // 「凭证 → AI」里已经存的 Key：点一下加成一个账号，不用再贴
  const allCreds = useStore((s) => s.credentials)
  const accts = info[`${kind}Accounts`] ?? []
  const KEY_RE: Record<ExecKind, RegExp> = { claude: /anthropic/i, codex: /openai/i, qwen: /qwen|dashscope|百炼|通义/i, codebuddy: /codebuddy/i }
  const savedKeys = allCreds.filter((c) => c.group === 'AI' && c.hasSecret !== false && !accts.some((a) => a.id === c.id) && KEY_RE[kind].test(claude || codex ? c.kind : `${c.kind} ${c.name}`))
  const useSaved = async (id: string) => {
    setBusy('save')
    const r = await call('POST', '/api/ai/accounts', { executor: kind, credId: id, region: kind === 'codebuddy' ? region : undefined, makeDefault: true, host }, '已加一个账号')
    setBusy('')
    if (r) { await reload(); void runTest() }
  }
  // 贴进来的：Claude 订阅令牌先真跑一次验证再存（走登录那套进度）；API Key（sk-ant-api…、OpenAI 的、或者填了接口地址的）直接存
  const addPasted = async () => {
    const v = key.trim()
    if (!v) { toast('先把令牌或 API Key 贴进来'); return }
    if (v.includes('#')) { toast('这是浏览器给的一次性授权码，不是令牌：只能贴回发它的那次登录（用「用 Claude 账号登录」）'); return }
    if (/\s/.test(v) || v.length < 20) { toast('贴进来的不像令牌 / API Key：要一整串、中间没有空格'); return }
    if (claude && !base.trim() && !/^sk-ant-api/i.test(v)) {
      const r = await call<{ job: Job }>('POST', '/api/ai/login/token', { token: v, host })
      if (r?.job) { setKey(''); setJob(r.job); setHow('sub') } // 在「登录」那边看验证进度
      return
    }
    setBusy('save')
    const r = await call('POST', '/api/ai/accounts', {
      executor: kind, value: v, name: name.trim() || undefined, baseUrl: base.trim() || undefined, makeDefault: true, host,
      region: kind === 'codebuddy' ? region : undefined, model: kind === 'qwen' ? model.trim() || undefined : undefined,
    }, '已加一个账号')
    setBusy('')
    if (r) { setKey(''); setName(''); setBase(''); setModel(''); await reload(); void runTest() } // 加好了直接试一下
  }
  const runTest = async () => {
    setBusy('test')
    setTest(null)
    const r = await call<{ ok: boolean; ms: number; out: string }>('POST', '/api/ai/test', { executor: exec, host })
    setBusy('')
    if (r) { setTest(r); if (r.ok) onReady?.(exec) }
  }
  autoTest.current = runTest

  return (
    <div className="form exec-setup">
      <ExecPicker value={exec} info={info} onChange={(v) => { setExec(v); setTest(null); setHow(execKind(v) === 'claude' || execKind(v) === 'codex' ? 'sub' : 'key'); setKey(''); setBase(''); setAdv(false) }} />

      <Step n={1} title={`在服务器上装 ${exec}`} ok={!!installed}>
        {installed
          ? <p className="sub">已经装好了：{installed}</p>
          : (
            <>
              <p className="sub">点一下，Opero 自动在服务器上装好（1～3 分钟）。</p>
              <button className="btn primary" disabled={!!live} onClick={install}>{mine?.type === 'install' && live ? '正在装…' : `一键安装 ${exec}`}</button>
            </>
          )}
        {mine?.type === 'install' && (live || mine.state === 'fail') && <pre className="console small">{mine.log.trim().split('\n').slice(-12).join('\n') || '…'}</pre>}
        {mine?.type === 'install' && mine.state === 'fail' && <div className="banner b-warn">{mine.message}</div>}
      </Step>

      {egress && <EgressStep n={2} exec={codex ? 'Codex' : 'Claude Code'} host={host} info={info} reload={reload} />}

      <Step n={egress ? 3 : 2} title="登录" ok={loggedIn}>
        {loggedIn && !accts.length && <p className="sub">已经登录（令牌加密存在这台服务器上）。</p>}
        <AiAccounts kind={kind} list={accts} reload={reload} />
        {accts.length > 0 && <p className="field-hint">再加一个账号：下面任选一种，都是新加，原来的照常能用；新加的设成默认。</p>}
        {claude && <Segmented value={how === 'file' ? 'sub' : how} onChange={setHow} options={[{ value: 'sub', label: '用 Claude 账号登录（Pro / Max 订阅）' }, { value: 'key', label: '贴已有的订阅令牌或 API Key' }]} />}
        {codex && <Segmented value={how} onChange={(v) => { setHow(v); setKey('') }} options={[{ value: 'sub', label: '用 ChatGPT 登录（订阅）' }, { value: 'file', label: '贴 auth.json' }, { value: 'key', label: '贴 OpenAI API Key' }]} />}

        {codex && how === 'sub' && (
          <CodexDeviceLogin job={mine} installed={!!installed} again={accts.some((a) => a.sub)}
            start={codexLogin} cancel={() => call<{ job: Job }>('POST', '/api/ai/job/cancel').then((r) => r && setJob(r.job))} />
        )}

        {codex && how === 'file' && (
          <>
            <ol className="exec-howto">
              <li>在一台有浏览器的电脑上装 Codex：<code>npm install -g @openai/codex</code>（Mac 也可以 <code>brew install codex</code>）</li>
              <li>跑 <code>codex login</code>，在弹出的浏览器里选 <b>Sign in with ChatGPT</b>，登录要给 Opero 用的那个 ChatGPT 账号</li>
              <li>打开登录信息文件，全选复制：Mac / Linux 是 <code>~/.codex/auth.json</code>（终端里 <code>cat ~/.codex/auth.json</code>），Windows 是 <code>%USERPROFILE%\.codex\auth.json</code></li>
              <li>整段贴到下面（从 <code>{'{'}</code> 到 <code>{'}'}</code>），点「加上」</li>
            </ol>
            <div className="exec-need warn"><b>当密码对待</b><span>auth.json 里是这个 ChatGPT 账号的登录令牌：别发到聊天群、别提交进代码仓库。Opero 加密存在保险箱里，以后 Codex 自动续期，不用再贴。</span></div>
            <Field label="auth.json 的内容">
              <textarea className="mono" rows={5} value={key} onChange={(e) => setKey(e.target.value)} placeholder={'{\n  "tokens": { … }\n}'} spellCheck={false} autoComplete="off" />
            </Field>
            <Field label="名字（可选）" hint="不填就用「ChatGPT 套餐 · 邮箱」"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="比如：我的 ChatGPT Pro" /></Field>
            <button className="btn primary" disabled={busy === 'save'} onClick={addAuthFile}>{busy === 'save' ? '保存中…' : '加上'}</button>
          </>
        )}

        {claude && how === 'sub' && (
          !mine || mine.type !== 'login' || mine.state === 'ok' || mine.state === 'fail' ? (
            <>
              {mine?.type === 'login' && mine.state === 'fail' && <div className="banner b-warn">{mine.message}</div>}
              <button className="btn primary block" disabled={!installed || !!live} onClick={login}>{loggedIn ? '再登录一个账号' : '登录 Claude 账号'}</button>
              <p className="field-hint">会自动打开 Claude 的登录页：登录 → 点 Authorize → 复制页面上的码 → 回来贴进框里，就好了。{loggedIn ? '再登录一个账号是新加一个，原来的账号和令牌都留着、照常能用（别的项目在用的不受影响）；新登录的会设成默认。要登录的是另一个 Claude 账号：等登录页出来后点「复制链接」，在浏览器的无痕窗口里打开再登录（不然会直接用浏览器里已经登录的那个账号）。' : ''}</p>
              <button type="button" className="btn ghost sm" onClick={() => setHow('key')}>已经有订阅令牌或 API Key？直接贴</button>
              {!installed && <p className="field-hint">先完成第 1 步</p>}
            </>
          ) : mine.state === 'running' && !mine.url ? (
            <div className="banner b-info"><i className="spinner" /> 正在打开 Claude 登录页…</div>
          ) : mine.state === 'waitCode' ? (
            <>
              <ol className="exec-howto">
                <li>在刚打开的 Claude 页面里登录你的账号，点 Authorize（授权）</li>
                <li>页面上会出现一长串码，点旁边的复制</li>
                <li>回到这里，贴进下面的框（贴进来会自动提交）</li>
              </ol>
              <div className="row-actions">
                <a className="btn ghost" href={mine.url} target="_blank" rel="noreferrer">登录页没打开？点这里 ↗</a>
                <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(mine.url ?? ''); toast('已复制登录链接，到登录了 Claude 的浏览器里打开') }}>复制链接</button>
              </div>
              {mine.message && <div className="banner b-warn">{mine.message}</div>}
              <Field label="授权码"><input autoFocus value={code} onChange={(e) => setCode(e.target.value)} onPaste={onPaste} placeholder="在这里粘贴" autoComplete="off" onKeyDown={(e) => e.key === 'Enter' && submit(code)} /></Field>
              <div className="row-actions">
                <button className="btn ghost" onClick={() => call<{ job: Job }>('POST', '/api/ai/job/cancel').then((r) => r && setJob(r.job))}>取消</button>
                <button className="btn primary" onClick={() => submit(code)}>提交</button>
              </div>
              <button type="button" className="btn ghost sm" onClick={toPaste}>手里已经有订阅令牌或 API Key？不登录了，直接贴</button>
            </>
          ) : (
            <>
              <div className="banner b-info"><i className="spinner" /> {mine.state === 'verifying' ? '已拿到令牌，正在用它试跑一次 Claude Code（最多 2 分钟）…' : '授权码已提交，正在向 Anthropic 确认（一般几秒钟）…'}</div>
              {mine.screen && mine.state !== 'verifying' && <pre className="console small">{mine.screen}</pre>}
              <button className="btn ghost sm" onClick={() => call<{ job: Job }>('POST', '/api/ai/job/cancel').then((r) => r && setJob(r.job))}>等太久了，重新来</button>
            </>
          )
        )}

        {how === 'key' && (
          <>
            <KeyGuide kind={kind} region={region} />
            {kind === 'codebuddy' && <Field label="哪个站" hint="账号在哪个站注册的就选哪个"><Segmented value={region} onChange={setRegion} options={[{ value: 'cn', label: '国内站 codebuddy.cn' }, { value: 'intl', label: '国际站 codebuddy.ai' }]} /></Field>}
            {savedKeys.length > 0 && <Field label="或者用「凭证」里已经存的"><div className="chips">{savedKeys.map((c) => <button key={c.id} type="button" className="chip" disabled={busy === 'save'} onClick={() => useSaved(c.id)}>{c.name}</button>)}</div></Field>}
            <Field label={claude ? '订阅令牌或 API Key' : 'API Key'}>
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={claude ? 'sk-ant-…' : kind === 'codebuddy' ? '贴进来' : 'sk-…'} autoComplete="new-password" onKeyDown={(e) => e.key === 'Enter' && addPasted()} />
            </Field>
            <Field label="名字（可选）" hint="比如是谁的账号、给哪个项目用"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={ACCT_PH[kind]} /></Field>
            <button type="button" className="btn ghost sm" onClick={() => setAdv(!adv)}>{adv ? '收起' : kind === 'qwen' ? '换接口地址 / 默认模型？' : '这个账号走代理 / 中转？'}</button>
            {adv && <Field label="这个账号的接口地址" hint={kind === 'qwen' ? '不填用百炼北京地域；新加坡地域的 Key 填 https://dashscope-intl.aliyuncs.com/compatible-mode/v1，也能填别的 OpenAI 兼容接口（ModelScope、自建 vLLM…）' : '不填用官方的；填了就按 API Key 的方式调（每个账号可以不一样）'}>
              <input value={base} onChange={(e) => setBase(e.target.value)} placeholder={codex ? 'https://api.openai.com/v1' : kind === 'qwen' ? info.qwenBase ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1' : kind === 'codebuddy' ? '一般不用填' : 'https://api.anthropic.com'} /></Field>}
            {adv && kind === 'qwen' && <Field label="默认模型" hint="员工没单独选模型时用它"><input value={model} onChange={(e) => setModel(e.target.value)} placeholder={info.qwenModel ?? 'qwen3-coder-plus'} /></Field>}
            <button className="btn primary" disabled={busy === 'save'} onClick={addPasted}>{busy === 'save' ? '保存中…' : '加上'}</button>
          </>
        )}
      </Step>

      <Step n={egress ? 4 : 3} title="试一下" ok={!!test?.ok}>
        <button className="btn default" disabled={!installed || !!busy || !!live} onClick={runTest}>{busy === 'test' ? '测试中（最多 2 分钟）…' : '让它回一句话'}</button>
        {test && <div className={'banner ' + (test.ok ? 'b-ok' : 'b-warn')}>{test.ok ? `能用了：回复用了 ${(test.ms / 1000).toFixed(1)} 秒` : '没成功，执行器说：'}</div>}
        {test && !test.ok && <pre className="console small">{test.out || '（没有输出）'}</pre>}
      </Step>
      <p className="field-hint">令牌和 Key 加密存在这台服务器上，只在员工干活时交给执行器；员工连服务器、数据库用的账号它都拿不到。</p>
    </div>
  )
}

/** Codex 用 ChatGPT 账号登录（设备码）：要什么 → 点按钮 → 页面上出网址和一次性码 → 在任何设备上打开、登录、输码 → 自动完成 */
function CodexDeviceLogin({ job, installed, again, start, cancel }: { job: Job | null; installed: boolean; again: boolean; start: () => void; cancel: () => void }) {
  const j = job?.type === 'login' ? job : null
  const copy = (t: string, msg: string) => { navigator.clipboard?.writeText(t).then(() => toast(msg), () => toast('复制不了，手动选中复制')) }
  if (j && j.state === 'waitDevice' && j.userCode) {
    return (
      <>
        <div className="device-box">
          <span className="device-k">一次性码（15 分钟内有效）</span>
          <b className="device-code mono">{j.userCode}</b>
          <div className="row-actions">
            <button className="btn primary" onClick={() => copy(j.userCode!, '已复制码')}>复制码</button>
            <a className="btn default" href={j.url} target="_blank" rel="noreferrer">打开登录页 ↗</a>
            <button className="btn ghost" onClick={() => copy(j.url ?? '', '已复制登录网址，在手机或别的电脑上打开也行')}>复制网址</button>
          </div>
        </div>
        <ol className="exec-howto">
          <li>打开 <a href={j.url} target="_blank" rel="noreferrer">{(j.url ?? '').replace(/^https:\/\//, '')}</a>（手机、别的电脑都行）</li>
          <li>登录要给 Opero 用的那个 ChatGPT 账号（浏览器里已经登录了别的账号：先退出，或者用无痕窗口）</li>
          <li>输入上面的码，确认授权</li>
          <li>回到这里等几秒，Opero 自动保存、试跑一次</li>
        </ol>
        <div className="banner b-info"><i className="spinner" /> 等你在浏览器里输码…</div>
        <button className="btn ghost sm" onClick={cancel}>取消</button>
      </>
    )
  }
  if (j && (j.state === 'running' || j.state === 'verifying')) {
    return (
      <>
        <div className="banner b-info"><i className="spinner" /> {j.state === 'verifying' ? '浏览器里已经批准，正在保存登录信息…' : '正在向 OpenAI 要一次性码…'}</div>
        {j.state === 'running' && j.screen && <pre className="console small">{j.screen}</pre>}
        <button className="btn ghost sm" onClick={cancel}>等太久了，重新来</button>
      </>
    )
  }
  return (
    <>
      {j?.state === 'fail' && <div className="banner b-warn">{j.message}</div>}
      <div className="exec-need">
        <b>要什么</b>
        <ul>
          <li>ChatGPT <b>Plus、Pro、Business、Enterprise 或 Edu</b> 订阅：Codex 的用量算在套餐里，不另外按量收费（Plus 和 Business 每 5 小时有额度、可能还有每周额度，Pro 没有 5 小时限制）。Free、Go 套餐 OpenAI 没写包含命令行版 Codex。</li>
          <li>先打开「设备码登录」：个人账号在 ChatGPT 的 <a href="https://chatgpt.com/#settings/Security" target="_blank" rel="noreferrer">设置 → 安全</a> 里打开（Enable device code login）；Business / Enterprise / Edu 工作区要管理员在工作区权限里打开。</li>
          <li>这台服务器要连得上 auth.openai.com 和 chatgpt.com（连不上就先设上面第 2 步的网络出口）。</li>
        </ul>
      </div>
      <button className="btn primary block" disabled={!installed} onClick={start}>{again ? '再登录一个 ChatGPT 账号' : '用 ChatGPT 账号登录'}</button>
      <p className="field-hint">点了之后这里会出现一个网址和一次性码：在任何设备的浏览器里打开网址、登录 ChatGPT、输入码，就登录好了，服务器不用开端口。{again ? '同一个 ChatGPT 账号再登录一次 = 更新它的登录；换一个账号就是新加一个，原来的照常能用。' : ''}一个账号用量到上限，后面的活自动先换别的账号；登录令牌 Codex 自己续期，Opero 存回保险箱。</p>
      {!installed && <p className="field-hint">先完成第 1 步</p>}
    </>
  )
}

/** 贴 API Key 的说明：去哪儿建、要什么套餐、注意什么（措辞对照各家官方页面，2026-11 查的） */
function KeyGuide({ kind, region }: { kind: ExecKind; region: 'cn' | 'intl' }) {
  if (kind === 'claude') return (
    <ol className="exec-howto">
      <li>订阅令牌（Pro / Max）：在装了 Claude Code 的电脑上跑 <code>claude setup-token</code>，复制打印出来的那一整串</li>
      <li>或者 API Key（按量付费）：打开 <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com/settings/keys</a>，登录 → 点 <b>Create Key</b> → 复制</li>
      <li>贴到下面，点「加上」：订阅令牌会先真跑一次验证；都是新加一个账号</li>
    </ol>
  )
  if (kind === 'codex') return (
    <>
      <div className="exec-need"><b>按量计费</b><span>用 API Key 时 Codex 按 OpenAI API 的标准价格收费，不用 ChatGPT 套餐里的额度；账户里要先有余额（<a href="https://platform.openai.com/settings/organization/billing" target="_blank" rel="noreferrer">Billing</a>）。有 ChatGPT 订阅的，用上面的「用 ChatGPT 登录」更划算。</span></div>
      <ol className="exec-howto">
        <li>打开 <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>，登录 → 点 <b>Create new secret key</b></li>
        <li>马上复制（sk- 开头）：关掉对话框就看不到完整的了</li>
        <li>贴到下面，点「加上」</li>
      </ol>
    </>
  )
  if (kind === 'qwen') return (
    <>
      <div className="exec-need">
        <b>要什么</b>
        <ul>
          <li>阿里云账号，开通「阿里云百炼」。按调用量（token）计费，不是包月。</li>
          <li>要普通的百炼 API Key，别用「百炼 Coding Plan」的专属 Key：Coding Plan 的条款不允许程序自动调用。</li>
          <li>Key 分地域、不能混用：北京地域用默认接口地址；新加坡地域的 Key 要在下面「换接口地址」里填国际站地址。</li>
        </ul>
      </div>
      <ol className="exec-howto">
        <li>打开百炼控制台的 <a href="https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key" target="_blank" rel="noreferrer">API Key 页（华北2 北京）</a>，登录阿里云</li>
        <li>点 <b>创建 API Key</b>：归属账号、归属业务空间用默认的就行，权限选 <b>全部</b> → 确定</li>
        <li>马上复制完整的 Key（sk- 开头）：只在创建成功时完整显示一次，关掉就只剩打码的，丢了只能重置或新建</li>
        <li>贴到下面，点「加上」</li>
      </ol>
      <p className="field-hint">点不了「创建」：子账号（RAM 用户）要主账号或业务空间管理员给权限。一个账号每个地域最多 50 个 Key。</p>
    </>
  )
  const cn = region !== 'intl'
  return (
    <>
      <div className="exec-need warn">
        <b>要付费版</b>
        {cn
          ? <span>CodeBuddy 的 API Key 要 <b>个人标准版</b> 或更高才能建（定价页上叫「个人专业版」，¥58 / 人 / 月；企业的旗舰版、专享版也行）。免费的「个人体验版」建不了，页面上会提示「该功能为标准版以上用户可用」。企业账号找企业管理员。<a href="https://www.codebuddy.cn/pricing/" target="_blank" rel="noreferrer">看套餐和价格 ↗</a></span>
          : <span>国际站的 API Key 要 <b>Pro</b>（可以先 7 天免费试用，之后 10 美元 / 月）；Free 建不了。<a href="https://www.codebuddy.ai/pricing" target="_blank" rel="noreferrer">看套餐和价格 ↗</a></span>}
      </div>
      <ol className="exec-howto">
        <li>打开「访问密钥」页 <a href={cn ? 'https://www.codebuddy.cn/profile/keys' : 'https://www.codebuddy.ai/profile/keys'} target="_blank" rel="noreferrer">{cn ? 'codebuddy.cn/profile/keys' : 'codebuddy.ai/profile/keys'}</a>，登录</li>
        <li>点 <b>创建密钥</b>：名字随便起（比如 Opero）；有效期建议选 <b>永久有效</b>（选 7 天 / 30 天 / 1 年的，到期后员工会突然用不了，要回来换一个）</li>
        <li>马上复制：密钥只显示一次，丢了只能重新建</li>
        <li>贴到下面，点「加上」</li>
      </ol>
      <p className="field-hint">CodeBuddy 按积分扣费（不同模型扣得不一样），剩多少在 <a href={cn ? 'https://www.codebuddy.cn/profile/plans-usage' : 'https://www.codebuddy.ai/profile/plans-usage'} target="_blank" rel="noreferrer">套餐与用量</a> 里看。</p>
    </>
  )
}

const ACCT_PH: Record<ExecKind, string> = { claude: 'Claude 的 API Key', codex: 'Codex 的 OpenAI API Key', qwen: 'Qwen Code 的百炼 API Key', codebuddy: 'CodeBuddy 的 API Key' }

/** 网络出口：服务器连不上 Anthropic / OpenAI（比如国内）时，让执行器的请求经另一台 Agent（比如海外那台）出去；那台不用开端口 */
function EgressStep({ n, exec, host, info, reload }: { n: number; exec: 'Claude Code' | 'Codex'; host: string; info: AiInfo; reload: () => Promise<unknown> }) {
  const servers = useStore((s) => s.servers)
  const codex = exec === 'Codex'
  const cur = (codex ? info.codexEgress : info.claudeEgress) ?? ''
  const [busy, setBusy] = useState('')
  const [res, setRes] = useState<{ ok: boolean; via: string; status: string; secs: number; out: string } | null>(null)
  const options = [
    { value: '', label: '直连（从员工干活的那台直接出去）' },
    ...(host !== 'local' ? [{ value: 'local', label: '经 Opero 这台出去' }] : []),
    ...servers.filter((x) => x.via === 'agent' && x.id !== host).map((x) => ({ value: x.id, label: `经「${x.name}」出去${x.online ? '' : '（离线）'}` })),
  ]
  const pick = async (v: string) => {
    setBusy('save')
    setRes(null)
    await call('PUT', '/api/ai', { host, [codex ? 'codexEgress' : 'claudeEgress']: v }, '已保存，之后安装、登录、干活都走这个出口')
    await reload()
    setBusy('')
  }
  const testIt = async () => {
    setBusy('test')
    setRes(null)
    const r = await call<{ ok: boolean; via: string; status: string; secs: number; out: string }>('POST', '/api/ai/egress-test', { executor: exec, host })
    setBusy('')
    if (r) setRes(r)
  }
  return (
    <Step n={n} title="网络出口" ok={!!res?.ok}>
      <p className="sub">{`服务器连不上 ${codex ? 'OpenAI' : 'Anthropic'}（比如在国内）时，选一台能连上的服务器（装了 Agent 的）当出口。出口那台不用开端口，只帮忙连 AI 的接口。`}</p>
      <select value={cur} disabled={!!busy} onChange={(e) => pick(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button className="btn default sm" disabled={!!busy} onClick={testIt}>{busy === 'test' ? '测试中…' : '测一下通不通'}</button>
      {res && (res.ok
        ? <div className="banner b-ok">{res.via === 'egress' ? `通了：经出口访问 ${codex ? 'OpenAI' : 'Anthropic'} 接口用了 ${res.secs.toFixed(1)} 秒` : `通了：直连访问 ${codex ? 'OpenAI' : 'Anthropic'} 接口用了 ${res.secs.toFixed(1)} 秒`}</div>
        : <div className="banner b-warn">{`不通：${res.out || '连不上'}。换一个出口再试。`}</div>)}
    </Step>
  )
}
