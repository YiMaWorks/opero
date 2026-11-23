// 接 AI 执行器（傻瓜式，照 KidLock）：① 一键安装 ② 登录（Claude 订阅：点按钮 → 浏览器里批准 → 贴回授权码；或者填 API Key）③ 测试。
// 全程不用碰服务器命令行；安装、登录都由 Opero 在服务器上替你做（code/server/src/executors.ts）。
import { useEffect, useRef, useState } from 'react'
import { call } from '../live'
import { toast } from '../store'
import { Field, Segmented } from './ui'
import { IconCheck } from './icons'

export interface AiInfo {
  aiUser: string; isolated: boolean; claude: string | null; codex: string | null
  claudeKey: boolean; claudeBaseUrl: string; codexKey: boolean; codexBaseUrl: string
}
interface Job { id: string; type: 'install' | 'login'; executor: 'claude' | 'codex'; state: 'running' | 'waitCode' | 'verifying' | 'ok' | 'fail'; log: string; url?: string; message?: string }

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

export function ExecutorSetup({ info, reload, onReady }: { info: AiInfo; reload: () => Promise<unknown>; onReady?: (exec: string) => void }) {
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
  const [job, setJob] = useJob(async (j) => {
    await reload()
    toast(j.state === 'ok' ? (j.type === 'install' ? '装好了' : '登录成功') : (j.message ?? '没成功'))
  })
  const mine = job && job.executor === (codex ? 'codex' : 'claude') ? job : null
  const live = mine && (mine.state === 'running' || mine.state === 'waitCode' || mine.state === 'verifying')

  const install = async () => { setTest(null); const r = await call<{ job: Job }>('POST', '/api/ai/install', { executor: exec }); if (r) setJob(r.job) }
  const login = async () => { setCode(''); const r = await call<{ job: Job }>('POST', '/api/ai/login'); if (r) setJob(r.job) }
  const sendCode = async () => { if (!code.trim()) { toast('先把授权码贴进来'); return } const r = await call<{ job: Job }>('POST', '/api/ai/login/code', { code: code.trim() }); if (r?.job) setJob(r.job) }
  const saveKey = async () => {
    if (!key.trim()) { toast('先把 Key 贴进来'); return }
    setBusy('save')
    const r = await call('PUT', '/api/ai', codex ? { codexKey: key.trim(), ...(adv ? { codexBaseUrl: base } : {}) } : { claudeKey: key.trim(), ...(adv ? { claudeBaseUrl: base } : {}) }, '已加密保存')
    setBusy('')
    if (r) { setKey(''); await reload() }
  }
  const runTest = async () => {
    setBusy('test')
    setTest(null)
    const r = await call<{ ok: boolean; ms: number; out: string }>('POST', '/api/ai/test', { executor: exec })
    setBusy('')
    if (r) { setTest(r); if (r.ok) onReady?.(exec) }
  }

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

      <Step n={2} title="登录" ok={loggedIn}>
        {loggedIn && <p className="sub">已经登录（令牌加密存在这台服务器上）。要换账号，按下面重新来一遍。</p>}
        {!codex && <Segmented value={how} onChange={setHow} options={[{ value: 'sub', label: '用 Claude 账号登录（Pro / Max 订阅）' }, { value: 'key', label: '用 API Key（按量付费）' }]} />}

        {!codex && how === 'sub' && (
          !mine || mine.type !== 'login' || mine.state === 'ok' || mine.state === 'fail' ? (
            <>
              <ol className="exec-howto">
                <li>点下面的「开始登录」</li>
                <li>点「打开登录页」，在浏览器里登录你的 Claude 账号，点 <b>Authorize（授权）</b></li>
                <li>页面上会出现一串<b>授权码</b>，点它旁边的复制</li>
                <li>回到这里，粘贴，点「提交」，等几秒就好</li>
              </ol>
              <button className="btn primary" disabled={!installed || !!live} onClick={login}>开始登录</button>
              {!installed && <p className="field-hint">先完成第 1 步</p>}
              {mine?.type === 'login' && mine.state === 'fail' && <div className="banner b-warn">{mine.message}</div>}
            </>
          ) : mine.state === 'running' && !mine.url ? (
            <div className="banner b-info"><i className="spinner" /> 正在生成登录网址…</div>
          ) : mine.state === 'waitCode' ? (
            <>
              <a className="btn primary block" href={mine.url} target="_blank" rel="noreferrer">打开登录页 ↗</a>
              <p className="field-hint">在打开的页面里登录 Claude 账号 → 点 Authorize → 复制页面上的授权码</p>
              <Field label="授权码"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="粘贴到这里" autoComplete="off" onKeyDown={(e) => e.key === 'Enter' && sendCode()} /></Field>
              <div className="row-actions">
                <button className="btn ghost" onClick={() => call<{ job: Job }>('POST', '/api/ai/job/cancel').then((r) => r && setJob(r.job))}>取消</button>
                <button className="btn primary" onClick={sendCode}>提交</button>
              </div>
            </>
          ) : (
            <div className="banner b-info"><i className="spinner" /> {mine.state === 'verifying' ? '正在验证能不能用…' : '正在向 Anthropic 确认…'}</div>
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

      <Step n={3} title="试一下" ok={!!test?.ok}>
        <button className="btn default" disabled={!installed || !!busy || !!live} onClick={runTest}>{busy === 'test' ? '测试中（最多 2 分钟）…' : '让它回一句话'}</button>
        {test && <div className={'banner ' + (test.ok ? 'b-ok' : 'b-warn')}>{test.ok ? `能用了：回复用了 ${(test.ms / 1000).toFixed(1)} 秒` : '没成功，执行器说：'}</div>}
        {test && !test.ok && <pre className="console small">{test.out || '（没有输出）'}</pre>}
      </Step>
      <p className="field-hint">令牌和 Key 加密存在这台服务器上，只在员工干活时交给执行器；员工连服务器、数据库用的账号它都拿不到。</p>
    </div>
  )
}
