// 接 AI 执行器（傻瓜式）：① 一键安装 ② 登录 = 加账号（Claude 订阅：点按钮 → 浏览器里批准 → 贴回授权码；或者直接贴已有的订阅令牌 / API Key，可带自己的接口地址；Codex 贴 API Key）③ 测试。
// 每种方式都是新加一个账号，Claude / Codex 都能存好几个，设默认、改名、改接口地址、去掉。
// 全程不用碰服务器命令行；安装、登录都由 Opero 在服务器上替你做（code/server/src/executors.ts）。
import { useEffect, useRef, useState } from 'react'
import { call } from '../live'
import { toast, useStore } from '../store'
import { Field, Segmented } from './ui'
import { IconCheck } from './icons'

export interface AiInfo {
  aiUser: string; isolated: boolean; claude: string | null; codex: string | null
  claudeKey: boolean; claudeBaseUrl: string; codexKey: boolean; codexBaseUrl: string
  /** 网络出口：'' = 直连；local = 经 Opero 这台；服务器编号 = 经那台 Agent */
  claudeEgress?: string; codexEgress?: string
  claudeAccounts?: AiAccount[]
  codexAccounts?: AiAccount[]
}
export interface AiAccount { id: string; kind: 'claude' | 'codex'; name: string; user: string; updated: string; isDefault: boolean; baseUrl: string; limitedUntil: number; employees: string[]; sub: boolean }
/** 员工 work 设置里选 Claude 账号用 */
export type ClaudeAccount = AiAccount

const hhmm = (ts: number) => { const d = new Date(ts); return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
/** 存着的账号（Claude / Codex 各一组，可以好几个）：默认哪个、订阅还是 API Key、走哪个接口地址、谁在用、到没到上限；设默认、改名、改接口地址、从 Opero 去掉（令牌本身不作废） */
export function AiAccounts({ list, reload, kind }: { list: AiAccount[]; reload: () => Promise<unknown>; kind: 'claude' | 'codex' }) {
  if (!list.length) return null
  const act = async (id: string, body: Record<string, unknown>, msg: string) => { if (await call('PUT', `/api/ai/accounts/${id}`, body, msg)) await reload() }
  const rename = (a: AiAccount) => { const n = prompt('给这个账号起个名字（比如用的是谁的订阅）', a.name); if (n && n.trim() && n.trim() !== a.name) void act(a.id, { name: n.trim() }, '已改名') }
  const setBase = (a: AiAccount) => { const n = prompt('这个账号走哪个接口地址（代理 / 中转）？空着 = 官方', a.baseUrl); if (n !== null && n.trim() !== a.baseUrl) void act(a.id, { baseUrl: n.trim() }, n.trim() ? '已设接口地址' : '已改回官方') }
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
              <span className="acct-tag">{a.sub ? '订阅' : 'API Key'}</span>
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
            <button className="btn ghost sm" onClick={() => remove(a)}>去掉</button>
          </span>
        </div>
      ))}
      <p className="field-hint">{kind === 'claude' ? '员工默认用「默认」账号，也能在员工的 work 设置里单独指定；一个账号用量到上限，后面的活自动先换别的账号。' : '员工用「默认」账号。'}</p>
    </div>
  )
}
interface Job { id: string; type: 'install' | 'login'; executor: 'claude' | 'codex'; host?: string; screen?: string; state: 'running' | 'waitCode' | 'verifying' | 'ok' | 'fail'; log: string; url?: string; message?: string }

/** 后台的安装 / 登录进度：每秒问一次，做完停 */
function useJob(onDone: (j: Job) => void) {
  const [job, setJob] = useState<Job | null>(null)
  const done = useRef(onDone)
  done.current = onDone
  // 刷新了页面 / 换了设备：后台还在装或在登录，接着显示进度
  useEffect(() => {
    call<{ job: Job | null }>('GET', '/api/ai/job').then((r) => {
      const j = r?.job
      if (j && (j.state === 'running' || j.state === 'waitCode' || j.state === 'verifying')) setJob(j)
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
  const [exec, setExec] = useState<'Claude Code' | 'Codex'>(info.claude || !info.codex ? 'Claude Code' : 'Codex')
  const codex = exec === 'Codex'
  const installed = codex ? info.codex : info.claude
  const loggedIn = codex ? info.codexKey : info.claudeKey
  const [how, setHow] = useState<'sub' | 'key'>('sub')
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
  const mine = job && job.executor === (codex ? 'codex' : 'claude') && (job.host ?? 'local') === host ? job : null
  const live = mine && (mine.state === 'running' || mine.state === 'waitCode' || mine.state === 'verifying')

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
  const accts = (codex ? info.codexAccounts : info.claudeAccounts) ?? []
  const savedKeys = allCreds.filter((c) => c.group === 'AI' && c.hasSecret !== false && !accts.some((a) => a.id === c.id) && (codex ? /openai/i.test(c.kind) : /anthropic/i.test(c.kind)))
  const useSaved = async (id: string) => {
    setBusy('save')
    const r = await call('POST', '/api/ai/accounts', { executor: codex ? 'codex' : 'claude', credId: id, makeDefault: true, host }, '已加一个账号')
    setBusy('')
    if (r) { await reload(); void runTest() }
  }
  // 贴进来的：Claude 订阅令牌先真跑一次验证再存（走登录那套进度）；API Key（sk-ant-api…、OpenAI 的、或者填了接口地址的）直接存
  const addPasted = async () => {
    const v = key.trim()
    if (!v) { toast('先把令牌或 API Key 贴进来'); return }
    if (v.includes('#')) { toast('这是浏览器给的一次性授权码，不是令牌：只能贴回发它的那次登录（用「用 Claude 账号登录」）'); return }
    if (/\s/.test(v) || v.length < 20) { toast('贴进来的不像令牌 / API Key：要一整串、中间没有空格'); return }
    if (!codex && !base.trim() && !/^sk-ant-api/i.test(v)) {
      const r = await call<{ job: Job }>('POST', '/api/ai/login/token', { token: v, host })
      if (r?.job) { setKey(''); setJob(r.job); setHow('sub') } // 在「登录」那边看验证进度
      return
    }
    setBusy('save')
    const r = await call('POST', '/api/ai/accounts', { executor: codex ? 'codex' : 'claude', value: v, name: name.trim() || undefined, baseUrl: base.trim() || undefined, makeDefault: true, host }, '已加一个账号')
    setBusy('')
    if (r) { setKey(''); setName(''); await reload(); void runTest() } // 加好了直接试一下
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
      <Field label="用哪个 AI"><Segmented value={exec} onChange={(v) => { setExec(v); setTest(null); setHow(v === 'Codex' ? 'key' : 'sub') }}
        options={[{ value: 'Claude Code', label: 'Claude Code（推荐）' }, { value: 'Codex', label: 'Codex' }]} /></Field>

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

      <EgressStep n={2} exec={exec} host={host} info={info} reload={reload} />

      <Step n={3} title="登录" ok={loggedIn}>
        {loggedIn && !accts.length && <p className="sub">已经登录（令牌加密存在这台服务器上）。</p>}
        <AiAccounts kind={codex ? 'codex' : 'claude'} list={accts} reload={reload} />
        {accts.length > 0 && <p className="field-hint">再加一个账号：下面任选一种，都是新加，原来的照常能用；新加的设成默认。</p>}
        {!codex && <Segmented value={how} onChange={setHow} options={[{ value: 'sub', label: '用 Claude 账号登录（Pro / Max 订阅）' }, { value: 'key', label: '贴已有的订阅令牌或 API Key' }]} />}

        {!codex && how === 'sub' && (
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

        {(codex || how === 'key') && (
          <>
            <ol className="exec-howto">
              {codex
                ? <li>OpenAI API Key：打开 <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>，登录 → 点 <b>Create new secret key</b> → 复制</li>
                : <>
                    <li>订阅令牌（Pro / Max）：在装了 Claude Code 的电脑上跑 <code>claude setup-token</code>，复制打印出来的那一整串</li>
                    <li>或者 API Key（按量付费）：打开 <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com/settings/keys</a>，登录 → 点 <b>Create Key</b> → 复制</li>
                  </>}
              <li>贴到下面，点「加上」：{codex ? '' : '订阅令牌会先真跑一次验证；'}都是新加一个账号</li>
            </ol>
            {savedKeys.length > 0 && <Field label="或者用「凭证」里已经存的"><div className="chips">{savedKeys.map((c) => <button key={c.id} type="button" className="chip" disabled={busy === 'save'} onClick={() => useSaved(c.id)}>{c.name}</button>)}</div></Field>}
            <Field label={codex ? 'API Key' : '订阅令牌或 API Key'}>
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={codex ? 'sk-…' : 'sk-ant-…'} autoComplete="new-password" onKeyDown={(e) => e.key === 'Enter' && addPasted()} />
            </Field>
            <Field label="名字（可选）" hint="比如是谁的订阅、给哪个项目用"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={codex ? 'Codex 的 OpenAI API Key' : 'Claude 的 API Key'} /></Field>
            <button type="button" className="btn ghost sm" onClick={() => setAdv(!adv)}>{adv ? '收起' : '这个账号走代理 / 中转？'}</button>
            {adv && <Field label="这个账号的接口地址" hint="不填用官方的；填了就按 API Key 的方式调（每个账号可以不一样）"><input value={base} onChange={(e) => setBase(e.target.value)} placeholder={codex ? 'https://api.openai.com/v1' : 'https://api.anthropic.com'} /></Field>}
            <button className="btn primary" disabled={busy === 'save'} onClick={addPasted}>{busy === 'save' ? '保存中…' : '加上'}</button>
          </>
        )}
      </Step>

      <Step n={4} title="试一下" ok={!!test?.ok}>
        <button className="btn default" disabled={!installed || !!busy || !!live} onClick={runTest}>{busy === 'test' ? '测试中（最多 2 分钟）…' : '让它回一句话'}</button>
        {test && <div className={'banner ' + (test.ok ? 'b-ok' : 'b-warn')}>{test.ok ? `能用了：回复用了 ${(test.ms / 1000).toFixed(1)} 秒` : '没成功，执行器说：'}</div>}
        {test && !test.ok && <pre className="console small">{test.out || '（没有输出）'}</pre>}
      </Step>
      <p className="field-hint">令牌和 Key 加密存在这台服务器上，只在员工干活时交给执行器；员工连服务器、数据库用的账号它都拿不到。</p>
    </div>
  )
}

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
