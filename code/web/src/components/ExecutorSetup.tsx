// 接 AI 执行器（傻瓜式）：① 一键安装 ② 登录（Claude 订阅：点按钮 → 浏览器里批准 → 贴回授权码；或者填 API Key）③ 测试。
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
  // 一个框：贴的是 sk-ant-oat 令牌就直接验证保存；在等授权码时贴的就当授权码
  const isTok = (v: string) => /^sk-ant-oat\d{2}-[A-Za-z0-9_-]{40,}$/.test(v)
  const submit = async (raw: string) => {
    const v = raw.trim()
    if (!v) { toast('先把码贴进来'); return }
    const waiting = mine?.type === 'login' && mine.state === 'waitCode'
    if (!waiting && !isTok(v)) { toast('这不是令牌（令牌是 sk-ant-oat 开头的）。没有令牌就点「登录 Claude 账号」'); return }
    const r = waiting
      ? await call<{ job: Job }>('POST', '/api/ai/login/code', { code: v })
      : await call<{ job: Job }>('POST', '/api/ai/login/token', { token: v, host })
    if (r?.job) { setCode(''); setJob(r.job) }
  }
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const v = e.clipboardData.getData('text').trim()
    if (!v) return
    e.preventDefault()
    setCode(v)
    if (isTok(v) || (mine?.state === 'waitCode' && v.length >= 20)) void submit(v)
  }
  const saveKey = async () => {
    if (!key.trim()) { toast('先把 Key 贴进来'); return }
    setBusy('save')
    const r = await call('PUT', '/api/ai', { host, ...(codex ? { codexKey: key.trim(), ...(adv ? { codexBaseUrl: base } : {}) } : { claudeKey: key.trim(), ...(adv ? { claudeBaseUrl: base } : {}) }) }, '已加密保存')
    setBusy('')
    if (r) { setKey(''); await reload(); void runTest() } // 存好了直接试一下
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
        {loggedIn && <p className="sub">已经登录（令牌加密存在这台服务器上）。要换账号，按下面重新来一遍。</p>}
        {!codex && <Segmented value={how} onChange={setHow} options={[{ value: 'sub', label: '用 Claude 账号登录（Pro / Max 订阅）' }, { value: 'key', label: '用 API Key（按量付费）' }]} />}

        {!codex && how === 'sub' && (
          !mine || mine.type !== 'login' || mine.state === 'ok' || mine.state === 'fail' ? (
            <>
              {mine?.type === 'login' && mine.state === 'fail' && <div className="banner b-warn">{mine.message}</div>}
              <button className="btn primary block" disabled={!installed || !!live} onClick={login}>{loggedIn ? '换账号 / 重新登录' : '登录 Claude 账号'}</button>
              <p className="field-hint">会自动打开 Claude 的登录页：登录 → 点 Authorize → 复制页面上的码 → 回来贴进框里，就好了。</p>
              <Field label="已经有令牌（sk-ant-oat 开头）？贴这里" hint="贴进来自动保存，不用再登录。没有令牌就点上面的按钮。">
                <input type="password" value={code} onChange={(e) => setCode(e.target.value)} onPaste={onPaste} placeholder="sk-ant-oat…" autoComplete="new-password" disabled={!installed || !!live} onKeyDown={(e) => e.key === 'Enter' && submit(code)} />
              </Field>
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
                ? <li>打开 <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>，登录 → 点 <b>Create new secret key</b> → 复制</li>
                : <li>打开 <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com/settings/keys</a>，登录 → 点 <b>Create Key</b> → 复制</li>}
              <li>粘贴到下面，点「保存」</li>
            </ol>
            <Field label={loggedIn ? 'API Key（已存，贴新的会替换）' : 'API Key'}>
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={codex ? 'sk-…' : 'sk-ant-…'} autoComplete="new-password" />
            </Field>
            <button className="btn ghost sm" onClick={() => { setAdv(!adv); setBase(codex ? info.codexBaseUrl : info.claudeBaseUrl) }}>{adv ? '收起' : '用代理 / 中转？'}</button>
            {adv && <Field label="接口地址" hint="不填用官方的"><input value={base} onChange={(e) => setBase(e.target.value)} placeholder={codex ? 'https://api.openai.com/v1' : 'https://api.anthropic.com'} /></Field>}
            <button className="btn primary" disabled={busy === 'save'} onClick={saveKey}>{busy === 'save' ? '保存中…' : '保存'}</button>
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
