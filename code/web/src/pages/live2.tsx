// 真的一套：员工的记忆仓库 / 历史会话 / work 历史，问题清单，服务器给员工的规矩，工作空间的自动同步和发布，用量明细
import { useEffect, useState } from 'react'
import type { BuildCfg, Deploy, Employee, LiveIssue, Message, Policy, Server, ServerDir, Session, Workspace } from '../types'
import { requireVerify, toast, useStore } from '../store'
import { call } from '../live'
import { Markdown } from '../components/Markdown'
import { Empty, Field, PageHeader, Row, Section, Segmented, Tag, Toggle } from '../components/ui'
import { headNav, type PageProps } from './nav'

// ======================= 员工档案里的：记忆、会话、执行器 =======================
export function EmployeeWorkSections({ e, nav }: { e: Employee; nav: PageProps['nav'] }) {
  const working = useStore((s) => s.sessions.find((x) => x.employee === e.id)?.working)
  const sid = useStore((s) => s.sessions.find((x) => x.employee === e.id)?.id)
  const other = /codex/i.test(e.executor) ? 'Claude Code' : 'Codex'
  const handoff = async () => {
    if (!sid) return
    if (await call('POST', `/api/sessions/${sid}/handoff`, {}, '已开新会话：交接写在输入框里，看一下再发')) nav.openChat(e.id)
  }
  const switchTo = async () => {
    if (!confirm(`把「${e.name}」换成 ${other}？现在的会话归档，开一个新会话，${other} 从记忆仓库接着做`)) return
    if (await call('POST', `/api/employees/${e.id}/switch`, { executor: other }, `已换成 ${other}：交接写在输入框里，看一下再发`)) nav.openChat(e.id)
  }
  return (
    <>
      <Section title="记忆（它自己的 git 仓库）" right={<span className="sub">换会话、换执行器、换服务器都从这里接着做</span>}>
        <Row title="打开记忆仓库" sub={e.memRepo ? `远端 ${e.memRepo}` : '规矩、交接、记录、机器笔记（只在它干活那台机器上；要换服务器带着走，在「编辑」里配远端）'} chevron onClick={() => nav.push({ page: 'memory', params: { id: e.id } })} />
      </Section>
      <Section title={`work 历史 · 现在是第 ${e.works?.[0]?.no ?? 1} 个`}>
        {(e.works ?? []).slice(0, 8).map((w) => (
          <Row key={w.no} title={`第 ${w.no} 个${w.to ? '' : '（现在）'}`} sub={`${w.from}${w.to ? ' → ' + w.to : ' 起'}${w.host ? ' · ' + w.host : ''} · ${w.reason}`} right={!w.to ? <Tag tone="ok">在用</Tag> : undefined} />
        ))}
        <div className="pad row-actions wrap">
          <button className="btn default sm" disabled={!!working} onClick={handoff}>开新会话接着做</button>
          <button className="btn default sm" disabled={!!working} onClick={switchTo}>换成 {other}</button>
          <button className="btn ghost sm" onClick={() => nav.push({ page: 'history', params: { id: e.id } })}>历史会话</button>
        </div>
        {working && <p className="hint">员工在干活：这一轮做完或者停下后才能换。</p>}
      </Section>
    </>
  )
}

// ======================= 记忆仓库 =======================
export function LiveMemoryPage({ params, nav }: PageProps) {
  const e = useStore((s) => s.employees.find((x) => x.id === params.id))
  const [info, setInfo] = useState<{ dir: string; files: string[]; remote: string } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => call<typeof info>('GET', `/api/employees/${params.id}/memory`).then((r) => r && setInfo(r))
  useEffect(() => { load() }, [params.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const openFile = async (f: string) => {
    if (open === f) { setOpen(null); return }
    const r = await call<{ text: string }>('GET', `/api/employees/${params.id}/memory/file?path=${encodeURIComponent(f)}`)
    if (r) { setOpen(f); setText(r.text) }
  }
  const save = async () => {
    if (!open) return
    setBusy(true)
    const r = await call<{ result: string }>('PUT', `/api/employees/${params.id}/memory/file`, { path: open, text })
    setBusy(false)
    if (r) toast(r.result || '已保存')
  }
  return (
    <div className="page">
      <PageHeader title="记忆仓库" sub={e?.name} {...headNav(nav)} />
      <div className="page-body">
        {!info && <Empty>在读…</Empty>}
        {info && (
          <>
            <Section title="在哪">
              <Row title="目录" right={<span className="mono small" data-no-i18n="">{info.dir}</span>} />
              <Row title="远端" right={info.remote ? <span className="mono small" data-no-i18n="">{info.remote}</span> : '没配（在员工「编辑」里配）'} />
            </Section>
            <Section title={`文件 · ${info.files.length}`} right={<span className="sub">改了保存就自动提交；「我的角色」那段按员工设置自动写</span>}>
              {info.files.map((f) => (
                <div key={f}>
                  <Row title={<span className="mono" data-no-i18n="">{f}</span>} chevron onClick={() => openFile(f)} />
                  {open === f && (
                    <div className="pad">
                      <textarea className="mono code-edit" rows={14} value={text} onChange={(v) => setText(v.target.value)} data-no-i18n="" />
                      <div className="row-actions"><button className="btn primary sm" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存并提交'}</button></div>
                    </div>
                  )}
                </div>
              ))}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

// ======================= 历史会话 =======================
export function LiveHistoryPage({ params, nav }: PageProps) {
  const e = useStore((s) => s.employees.find((x) => x.id === params.id))
  const [list, setList] = useState<Session[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<Message[]>([])
  useEffect(() => { call<Session[]>('GET', `/api/employees/${params.id}/history`).then((r) => setList(r ?? [])) }, [params.id])
  const show = async (sid: string) => {
    if (open === sid) { setOpen(null); return }
    const r = await call<Message[]>('GET', `/api/sessions/${sid}/messages`)
    setOpen(sid)
    setMsgs(r ?? [])
  }
  return (
    <div className="page">
      <PageHeader title="历史会话" sub={e?.name} {...headNav(nav)} />
      <div className="page-body">
        {list && list.length === 0 && <Empty>还没有：开新会话接着做、换执行器时，旧的会话会放到这里</Empty>}
        {(list ?? []).map((s) => (
          <Section key={s.id}>
            <Row title={s.title ?? '会话'} sub={`${new Date(s.archived ?? s.ts).toLocaleString('zh-CN')} 归档`} chevron onClick={() => show(s.id)} />
            {open === s.id && (
              <div className="pad history-msgs">
                {msgs.length === 0 && <Empty>没有消息</Empty>}
                {msgs.filter((m) => m.kind === 'text' || m.kind === 'system').map((m) => (
                  <div key={m.id} className={'hist-msg ' + (m.from === 'me' ? 'me' : m.from === 'system' ? 'sys' : 'emp')}>
                    <span className="sub">{m.from === 'me' ? '我' : m.from === 'system' ? '系统' : e?.name} · {m.at}</span>
                    {m.from === 'system' ? <p className="sub">{m.text}</p> : <div data-no-i18n=""><Markdown text={m.text ?? ''} /></div>}
                  </div>
                ))}
              </div>
            )}
          </Section>
        ))}
      </div>
    </div>
  )
}

// ======================= 问题清单 =======================
const ST: Record<LiveIssue['status'], { label: string; tone: 'danger' | 'warn' | 'ok' | 'mute' | 'primary' }> = {
  new: { label: '新问题', tone: 'danger' }, fixing: { label: '在修', tone: 'primary' }, fixed: { label: '已修', tone: 'ok' }, known: { label: '已知', tone: 'mute' }, ignored: { label: '忽略中', tone: 'mute' },
}
const SEV: Record<LiveIssue['severity'], string> = { high: '严重', mid: '一般', low: '轻微' }
const ago = (ts: number) => { const m = Math.round((Date.now() - ts) / 60000); return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前` }

export function LiveIssuesPage({ nav }: PageProps) {
  const issues = useStore((s) => s.liveIssues)
  const emps = useStore((s) => s.employees)
  const triggers = useStore((s) => s.triggers)
  const [tab, setTab] = useState<'open' | 'all'>('open')
  const list = [...issues].sort((a, b) => b.last - a.last).filter((i) => tab === 'all' || i.status === 'new' || i.status === 'fixing')
  const watcher = emps.find((e) => /日志|巡检|log/i.test(e.name + e.title))
  const patrol = watcher && triggers.some((t) => t.employee === watcher.id)
  return (
    <div className="page">
      <PageHeader title="问题清单" sub="日志巡检记下来的线上问题" {...headNav(nav)} />
      <div className="page-body">
        {!patrol && (
          <div className="pad"><div className="banner b-info">
            还没有定时巡检：{watcher ? `给「${watcher.name}」加一个定时触发器（比如每 30 分钟），让它用 log_scan 看日志、把问题记到这里。` : '先建一个「日志值班」员工（开机向导里有），再给它加一个定时触发器。'}
            {watcher && <button className="btn primary sm" onClick={() => nav.push({ page: 'triggerEdit', params: { employee: watcher.id } })}>加触发器</button>}
          </div></div>
        )}
        <div className="pad"><Segmented value={tab} onChange={setTab} options={[{ value: 'open', label: `要处理 · ${issues.filter((i) => i.status === 'new' || i.status === 'fixing').length}` }, { value: 'all', label: `全部 · ${issues.length}` }]} /></div>
        <Section flush>
          {list.length === 0 && <Empty>{tab === 'open' ? '没有要处理的问题' : '还没有记下过问题'}</Empty>}
          {list.map((i) => (
            <Row key={i.id} chevron onClick={() => nav.push({ page: 'issue', params: { id: i.id } })}
              title={<><Tag tone={ST[i.status].tone}>{ST[i.status].label}</Tag> <span data-no-i18n="">{i.title}</span></>}
              sub={`${SEV[i.severity]} · ${i.count} 次 · 最近 ${ago(i.last)}`} />
          ))}
        </Section>
      </div>
    </div>
  )
}

export function LiveIssuePage({ params, nav }: PageProps) {
  const i = useStore((s) => s.liveIssues.find((x) => x.id === params.id))
  const emps = useStore((s) => s.employees)
  const servers = useStore((s) => s.servers)
  const wss = useStore((s) => s.workspaces)
  const [fixer, setFixer] = useState('')
  if (!i) return <div className="page"><PageHeader title="问题" {...headNav(nav)} /><Empty>找不到</Empty></div>
  const act = (action: string, msg: string) => call('POST', `/api/issues/${i.id}/action`, { action, fixer: fixer || undefined }, msg)
  const who = (id?: string) => emps.find((e) => e.id === id)?.name ?? '—'
  return (
    <div className="page">
      <PageHeader title="问题" sub={SEV[i.severity]} {...headNav(nav)} />
      <div className="page-body">
        <div className="pad"><b data-no-i18n="">{i.title}</b> <Tag tone={ST[i.status].tone}>{ST[i.status].label}</Tag></div>
        <Section>
          <Row title="次数" right={String(i.count)} />
          <Row title="第一次 / 最近" right={`${new Date(i.first).toLocaleString('zh-CN')} / ${ago(i.last)}`} />
          <Row title="在哪" right={[servers.find((s) => s.id === i.server)?.name, wss.find((w) => w.id === i.workspace)?.name].filter(Boolean).join(' · ') || '—'} />
          <Row title="谁报的 / 谁在修" right={`${who(i.reporter)} / ${who(i.fixer)}`} />
          {i.cause && <Row title="原因" sub={<span data-no-i18n="">{i.cause}</span>} />}
          {i.note && <Row title="备注" sub={<span data-no-i18n="">{i.note}</span>} />}
        </Section>
        {i.sample && <Section title="日志样例"><pre className="console" data-no-i18n="">{i.sample}</pre></Section>}
        <Section title="处理">
          <div className="pad form">
            <Field label="交给谁修" hint="不选 = 用这个项目的员工，没有就交给报问题的员工">
              <select value={fixer} onChange={(v) => setFixer(v.target.value)}>
                <option value="">自动</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
            <div className="row-actions wrap">
              <button className="btn primary" onClick={() => act('fix', '已交给员工去修')}>修复</button>
              <button className="btn default" onClick={() => act('known', '标成已知')}>已知</button>
              <button className="btn default" onClick={() => act('ignore', '7 天内不再提醒')}>忽略 7 天</button>
              {i.status !== 'fixed' && <button className="btn default" onClick={() => act('fixed', '标成已修')}>标成已修</button>}
              {(i.status === 'fixed' || i.status === 'known' || i.status === 'ignored') && <button className="btn ghost" onClick={() => act('reopen', '重新打开')}>重新打开</button>}
              <button className="btn ghost" onClick={() => { if (confirm('删掉这条问题记录？')) call('DELETE', `/api/issues/${i.id}`, undefined, '已删').then(() => nav.back()) }}>删掉</button>
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}

// ======================= 服务器：给员工的规矩 =======================
export function PolicySection({ s }: { s: Server }) {
  const p: Policy = s.policy ?? {}
  const [deny, setDeny] = useState((p.deny ?? []).join('\n'))
  const save = (patch: Policy, msg = '已保存') => call('PUT', `/api/servers/${s.id}`, { policy: { ...p, ...patch } }, msg)
  return (
    <Section title="给员工的规矩" right={<span className="sub">员工在这台干活时生效</span>}>
      <label className="lrow"><span className="row-main"><span className="row-title">允许编译 / 打包</span><span className="row-sub">gradle、mvn、docker build、npm run build 这类；关了员工只能改代码，写清楚怎么编交给你</span></span><Toggle on={p.allowBuild ?? true} onChange={(v) => save({ allowBuild: v })} /></label>
      <label className="lrow"><span className="row-main"><span className="row-title">允许自测</span><span className="row-sub">跑测试、起项目或服务来试；关了员工读代码、看 diff 自查</span></span><Toggle on={p.allowTest ?? true} onChange={(v) => save({ allowTest: v })} /></label>
      <div className="pad form">
        <Field label="禁止的命令（一行一个，按开头匹配）" hint="比如 rm -rf、docker system prune。不管怎么设，sudo、装系统软件、管系统服务、改 /etc 都不许">
          <textarea className="mono" rows={3} value={deny} onChange={(v) => setDeny(v.target.value)} onBlur={() => deny !== (p.deny ?? []).join('\n') && save({ deny: deny.split('\n').map((x) => x.trim()).filter(Boolean) })} data-no-i18n="" />
        </Field>
        <div className="inline-form">
          <Field label="内存上限（%）" hint="员工进程加起来超了先提醒，一直超就停掉最大的进程；0 = 不管">
            <input inputMode="numeric" defaultValue={String(p.memPct ?? 80)} onBlur={(v) => save({ memPct: Number(v.target.value) || 0 })} />
          </Field>
          <Field label="同时最多几个员工" hint="多了排队；0 = 不限">
            <input inputMode="numeric" defaultValue={String(p.maxConcurrent ?? 0)} onBlur={(v) => save({ maxConcurrent: Number(v.target.value) || 0 })} />
          </Field>
        </div>
      </div>
    </Section>
  )
}

// ======================= 工作空间：自动同步、编译、发布环境 =======================
export function WorkspaceAutoSections({ w, nav }: { w: Workspace; nav?: PageProps['nav'] }) {
  const servers = useStore((s) => s.servers)
  const releases = useStore((s) => s.liveReleases)
  const [list, setList] = useState<Deploy[]>(w.deploys ?? [])
  const [editing, setEditing] = useState<Deploy | 'new' | null>(null)
  useEffect(() => { setList(w.deploys ?? []) }, [w.deploys])
  const saveDeploys = async (next: Deploy[], msg = '已保存') => !!(await call('PUT', `/api/workspaces/${w.id}`, { deploys: next }, msg))
  const sv = (id?: string) => servers.find((s) => s.id === id)?.name ?? id ?? ''
  const run = async (d: Deploy) => {
    if (!confirm(`发布「${w.name} → ${d.name}」？\n\n${w.buildCfg ? `先编译（${PROVIDER[w.buildCfg.provider]}），` : ''}发到 ${d.servers.map(sv).join('、')}${d.dir ? `（${d.dir}）` : ''}${d.health ? '，再检查 ' + d.health : ''}`)) return
    const r = await call<{ id: string }>('POST', `/api/workspaces/${w.id}/deploys/${d.id}/run`, {}, '已开始发布')
    if (r && nav) nav.push({ page: 'release', params: { id: r.id } })
  }
  return (
    <>
      <Section title="自动同步">
        <label className="lrow"><span className="row-main"><span className="row-title">干完自动提交推送</span><span className="row-sub">员工开工前拉到最新（冲突会告诉它先解决）；这一轮干完有改动就提交（出错的标「[未完成]」，你点停止的不提交）再推送，被拒就变基一次再推。要配了令牌才推送</span></span><Toggle on={w.autoSync !== false} onChange={(v) => call('PUT', `/api/workspaces/${w.id}`, { autoSync: v }, v ? '已开自动同步' : '已关：员工自己用 git_sync')} /></label>
      </Section>
      <BuildSection w={w} />
      <Section title={`发布环境 · ${list.length}`} right={<button className="btn ghost sm" onClick={() => setEditing('new')}>添加</button>}>
        {list.length === 0 && !editing && <Empty>还没有：一个发布环境 = 发到哪几台 + 部署目录（要在那台的「目录」里登记成「能部署」）。有编译设置时，发的是编出来的包（包里的部署脚本自己装）；没有就在每台跑部署命令</Empty>}
        {list.map((d) => {
          const lastR = releases.filter((r) => r.ws === w.id && r.target === d.id).sort((a, b) => b.started - a.started)[0]
          return editing && editing !== 'new' && editing.id === d.id
            ? <DeployForm key={d.id} init={d} servers={servers} onCancel={() => setEditing(null)} onSave={async (x) => { if (await saveDeploys(list.map((y) => (y.id === d.id ? x : y)))) setEditing(null) }} />
            : <Row key={d.id} title={d.name}
                sub={<>发到 {d.servers.map(sv).join('、')}{d.dir ? `（${d.dir}）` : ''}{d.sign ? ' · 签名' : ''}{d.health ? ' · 检查' : ''} · 员工{d.ai === 'auto' ? '直接发' : d.ai === 'off' ? '不许发' : '发前问你'}{lastR ? ` · 上次 ${lastR.status === 'success' ? '成功' : lastR.status === 'failed' ? '失败' : '发布中'}` : ''}</>}
                right={<span className="row-actions"><button className="btn primary sm" onClick={() => run(d)}>发布</button><button className="btn ghost sm" onClick={() => setEditing(d)}>改</button><button className="btn ghost sm" onClick={() => { if (confirm(`删掉发布环境「${d.name}」？`)) saveDeploys(list.filter((x) => x.id !== d.id), '已删') }}>删</button></span>} />
        })}
        {editing === 'new' && <DeployForm servers={servers} onCancel={() => setEditing(null)} onSave={async (d) => { if (await saveDeploys([...list, d], '已添加')) setEditing(null) }} />}
        {nav && releases.some((r) => r.ws === w.id) && <Row title="发布记录" chevron onClick={() => nav.push({ page: 'releases', params: { ws: w.id } })} />}
      </Section>
    </>
  )
}

const PROVIDER: Record<BuildCfg['provider'], string> = { yunxiao: '云效流水线', github: 'GitHub Actions', local: '自己的服务器' }
const KIND: Record<BuildCfg['kind'], string> = { node: 'Node', go: 'Go', android: '安卓 App', spring: 'Java（Spring）', custom: '自定义命令' }

/** 编译设置：模板 + 在哪编；云效 / GitHub 能一键生成流水线 */
function BuildSection({ w }: { w: Workspace }) {
  const servers = useStore((s) => s.servers)
  const creds = useStore((s) => s.credentials)
  const [b, setB] = useState<BuildCfg | null>(w.buildCfg ?? null)
  const [open, setOpen] = useState(false)
  const [script, setScript] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setB(w.buildCfg ?? null) }, [w.buildCfg])
  const up = (p: Partial<BuildCfg>) => setB((x) => ({ ...(x ?? { kind: 'node', provider: 'yunxiao' }), ...p }))
  const save = () => call('PUT', `/api/workspaces/${w.id}`, { buildCfg: b }, b ? '编译设置已存' : '已改成不编译').then((r) => r && setOpen(false))
  const gen = async () => { setBusy(true); await call('POST', `/api/workspaces/${w.id}/build/generate`, undefined, b?.provider === 'yunxiao' ? '云效流水线已生成 / 更新' : '工作流文件已提交进仓库'); setBusy(false) }
  const cur = w.buildCfg
  return (
    <Section title="编译" right={<button className="btn ghost sm" onClick={() => setOpen(!open)}>{open ? '收起' : cur ? '改' : '设置'}</button>}>
      {!open && (cur
        ? <Row title={`${KIND[cur.kind]} · ${PROVIDER[cur.provider]}`} sub={cur.provider === 'yunxiao' ? (cur.yunxiao?.pipelineId ? `流水线 ${cur.yunxiao.pipelineId}${cur.yunxiao.at ? ` · ${new Date(cur.yunxiao.at).toLocaleString('zh-CN')} 生成` : ''}` : '还没生成流水线') : cur.provider === 'github' ? (cur.github?.at ? `工作流 ${cur.github.workflow}` : '还没生成工作流') : `在 ${servers.find((x) => x.id === cur.local?.server)?.name ?? '?'} 上编`}
            right={cur.provider !== 'local' ? <button className="btn primary sm" disabled={busy} onClick={gen}>{busy ? '生成中…' : (cur.provider === 'yunxiao' ? cur.yunxiao?.pipelineId : cur.github?.at) ? '更新流水线' : '生成流水线'}</button> : undefined} />
        : <Empty>不编译：发布时直接在服务器上跑部署命令（适合 git pull 型的项目）。要编译就点「设置」：模板和以前在云效上用的一样，产物放 out/</Empty>)}
      {open && (
        <div className="pad form boxed">
          <label className="lrow"><span className="row-main"><span className="row-title">要编译</span><span className="row-sub">编出来的包（out/ 里，带 SHA256SUMS / VERSION / COMMIT）发到每台服务器，包里的 deploy.sh 自己装</span></span><Toggle on={!!b} onChange={(v) => setB(v ? (b ?? { kind: 'node', provider: 'yunxiao' }) : null)} /></label>
          {b && (
            <>
              <Field label="模板"><Segmented value={b.kind} onChange={(v) => up({ kind: v })} options={(Object.keys(KIND) as BuildCfg['kind'][]).map((k) => ({ value: k, label: KIND[k] }))} /></Field>
              <Field label="在哪编"><Segmented value={b.provider} onChange={(v) => up({ provider: v })} options={(Object.keys(PROVIDER) as BuildCfg['provider'][]).map((k) => ({ value: k, label: PROVIDER[k] }))} /></Field>
              {b.provider === 'yunxiao' && (
                <>
                  <Field label="云效个人访问令牌在哪个凭证" hint="云效「个人设置 → 个人访问令牌」，权限要有流水线读写、代码库读"><select value={b.yunxiao?.cred ?? ''} onChange={(e) => up({ yunxiao: { ...(b.yunxiao ?? { cred: '' }), cred: e.target.value } })}><option value="">选一个</option>{creds.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                  <div className="inline-form">
                    <Field label="组织编号（默认用 Codeup 地址里的）"><input value={b.yunxiao?.org ?? ''} onChange={(e) => up({ yunxiao: { ...(b.yunxiao ?? { cred: '' }), org: e.target.value } })} /></Field>
                    <Field label="已有的流水线编号（可选）"><input value={b.yunxiao?.pipelineId ?? ''} onChange={(e) => up({ yunxiao: { ...(b.yunxiao ?? { cred: '' }), pipelineId: e.target.value } })} placeholder="空 = 点「生成流水线」新建" /></Field>
                  </div>
                  <Field label="构建镜像（可选）" hint="要装很多工具的项目用一个装好工具的镜像（放在国内能快速拉的仓库）"><input value={b.yunxiao?.image ?? ''} onChange={(e) => up({ yunxiao: { ...(b.yunxiao ?? { cred: '' }), image: e.target.value } })} placeholder="默认 alinux3" /></Field>
                </>
              )}
              {b.provider === 'github' && <Field label="工作流文件名" hint="「生成流水线」会用工作空间的令牌把它提交进仓库（令牌要有 workflow 权限）"><input value={b.github?.workflow ?? ''} onChange={(e) => up({ github: { ...(b.github ?? {}), workflow: e.target.value } })} placeholder="opero-build.yml" /></Field>}
              {b.provider === 'local' && <Field label="在哪台编" hint="在那台拉一份干净的代码跑同一个脚本；工具装在 /root/.cache/opero"><select value={b.local?.server ?? ''} onChange={(e) => up({ local: { server: e.target.value } })}><option value="">选一台</option>{servers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
              {b.kind !== 'custom' && <Field label="代码在哪个子目录（可选）"><input value={b.subdir ?? ''} onChange={(e) => up({ subdir: e.target.value })} placeholder="." /></Field>}
              {b.kind === 'custom' && <Field label="编译命令" hint="在仓库根目录跑，把要发的东西放进 out/（包里放 deploy.sh 就由它来装）"><textarea className="mono" rows={4} value={b.cmd ?? ''} onChange={(e) => up({ cmd: e.target.value })} placeholder="bash deploy/build.sh" /></Field>}
              {(b.kind === 'node' || b.kind === 'go') && <Field label="部署完重启哪个服务（可选）"><input value={b.service ?? ''} onChange={(e) => up({ service: e.target.value })} placeholder="myapp" /></Field>}
              {b.kind === 'spring' && (
                <div className="inline-form">
                  <Field label="工具"><select value={b.spring?.tool ?? 'maven'} onChange={(e) => up({ spring: { ...(b.spring ?? {}), tool: e.target.value as 'maven' } })}><option value="maven">Maven</option><option value="gradle">Gradle</option></select></Field>
                  <Field label="JDK"><select value={String(b.spring?.jdk ?? 17)} onChange={(e) => up({ spring: { ...(b.spring ?? {}), jdk: Number(e.target.value) as 17 } })}><option value="17">17</option><option value="21">21</option></select></Field>
                  <Field label="编译命令（可选）"><input value={b.spring?.task ?? ''} onChange={(e) => up({ spring: { ...(b.spring ?? {}), task: e.target.value } })} placeholder="clean package -DskipTests" /></Field>
                </div>
              )}
              <div className="inline-form">
                <Field label="版本号文件（可选）"><input value={b.versionFile ?? ''} onChange={(e) => up({ versionFile: e.target.value })} placeholder="package.json" /></Field>
                <Field label="版本号正则"><input className="mono" value={b.versionRe ?? ''} onChange={(e) => up({ versionRe: e.target.value })} placeholder={'"version"\\s*:\\s*"([^"]+)"'} /></Field>
                <Field label="发哪个产物"><input value={b.file ?? ''} onChange={(e) => up({ file: e.target.value })} placeholder={b.kind === 'android' ? '*.apk' : b.kind === 'spring' ? 'bundle.tgz' : '*.tgz'} /></Field>
              </div>
            </>
          )}
          <div className="row-actions">
            {cur && <button className="btn ghost" onClick={() => (script === null ? call<{ script: string }>('GET', `/api/workspaces/${w.id}/build/script`).then((r) => r && setScript(r.script)) : setScript(null))}>{script === null ? '看编译脚本' : '收起脚本'}</button>}
            <button className="btn primary" onClick={save}>保存</button>
          </div>
          {script !== null && <pre className="console" data-no-i18n="">{script}</pre>}
        </div>
      )}
    </Section>
  )
}

function DeployForm({ init, servers, onSave, onCancel }: { init?: Deploy; servers: Server[]; onSave: (d: Deploy) => void; onCancel: () => void }) {
  const certs = useStore((s) => s.credentials).filter((c) => c.group === '签名证书')
  const [d, setD] = useState<Deploy>(init ?? { id: '', name: '', servers: [], ai: 'ask', keep: 5, autoRollback: true })
  const up = (p: Partial<Deploy>) => setD((x) => ({ ...x, ...p }))
  const notAllowed = d.dir ? d.servers.map((id) => servers.find((s) => s.id === id)).filter((s) => s && !(s.dirs ?? []).some((x) => x.mode === 'deploy' && (d.dir === x.path || d.dir!.startsWith(x.path + '/')))) : []
  return (
    <div className="pad form boxed">
      <Field label="名字"><input value={d.name} onChange={(v) => up({ name: v.target.value })} placeholder="比如：生产、测试" /></Field>
      <div className="field"><span className="field-label">发到哪几台</span>
        <div className="chips">{servers.map((s) => { const on = d.servers.includes(s.id); return <button key={s.id} className={'chip' + (on ? ' on' : '')} onClick={() => up({ servers: on ? d.servers.filter((x) => x !== s.id) : [...d.servers, s.id] })}>{s.name}</button> })}</div>
      </div>
      <Field label="部署目录（OPERO_DIR = KL_DIR）" hint="每台都要在服务器详情「目录」里把它（或它的上层）登记成「能部署」"><input className="mono" value={d.dir ?? ''} onChange={(v) => up({ dir: v.target.value || undefined })} placeholder="/home/project/myapp" /></Field>
      {notAllowed.length > 0 && <div className="banner b-warn">还没登记成能部署：{notAllowed.map((s) => s!.name).join('、')}</div>}
      <div className="inline-form">
        <Field label="包里的部署脚本"><input className="mono" value={d.script ?? ''} onChange={(v) => up({ script: v.target.value || undefined })} placeholder="deploy.sh" /></Field>
        <Field label="给 apk / aab 签名"><select value={d.sign ?? ''} onChange={(v) => up({ sign: v.target.value || undefined })}><option value="">不签</option>{certs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </div>
      <Field label="部署命令（包里没有部署脚本、或者不编译时用）" hint="在部署目录里跑；包在 $OPERO_PKG，提交在 $OPERO_REF，要密码用 {{secret:凭证名}}"><textarea className="mono" rows={3} value={d.command ?? ''} onChange={(v) => up({ command: v.target.value || undefined })} placeholder="git pull && npm ci && systemctl restart app" /></Field>
      <Field label="发完检查的地址（可选）" hint="在每台上 curl，1 分钟内 2xx / 3xx 算好"><input value={d.health ?? ''} onChange={(v) => up({ health: v.target.value || undefined })} placeholder="http://127.0.0.1:8080/health" /></Field>
      <div className="inline-form">
        <Field label="留几个版本（能回滚）"><input inputMode="numeric" value={String(d.keep ?? 5)} onChange={(v) => up({ keep: Number(v.target.value) || 5 })} /></Field>
        <Field label="员工能不能发"><select value={d.ai ?? 'ask'} onChange={(v) => up({ ai: v.target.value as Deploy['ai'] })}><option value="ask">发前问你</option><option value="auto">直接发（失败自动让它修）</option><option value="off">不许</option></select></Field>
      </div>
      <label className="lrow"><span className="row-main"><span className="row-title">失败自动退回上一版</span><span className="row-sub">部署或检查失败时，用上一个成功版本留着的包重新部署</span></span><Toggle on={d.autoRollback !== false} onChange={(v) => up({ autoRollback: v })} /></label>
      <div className="row-actions"><button className="btn ghost" onClick={onCancel}>取消</button><button className="btn primary" disabled={!d.name.trim() || !d.servers.length} onClick={() => onSave(d)}>保存</button></div>
    </div>
  )
}

// ======================= 服务器：登记本地目录 =======================
const MODE: Record<ServerDir['mode'], string> = { read: '员工只读', write: '员工能改', deploy: '能部署' }
export function DirsSection({ s }: { s: Server }) {
  const [list, setList] = useState<ServerDir[]>(s.dirs ?? [])
  const [dirty, setDirty] = useState(false)
  useEffect(() => { setList(s.dirs ?? []); setDirty(false) }, [s.dirs])
  const up = (i: number, p: Partial<ServerDir>) => { setList((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x))); setDirty(true) }
  const save = () => requireVerify(`改「${s.name}」登记的目录`, () => call('PUT', `/api/servers/${s.id}`, { dirs: list.map(({ path, mode, note }) => ({ path, mode, note })) }, '已保存，在给 AI 用户开权限…'))
  return (
    <Section title={`目录 · ${list.length}`} right={<span className="sub">员工能读 / 改哪些本地目录，发布能部署进哪些</span>}>
      {list.length === 0 && <Empty>还没登记：员工只能碰自己的工作目录；发布不能部署进任何目录</Empty>}
      {list.map((d, i) => (
        <div key={i} className="pad inline-form">
          <input className="mono" value={d.path} onChange={(e) => up(i, { path: e.target.value })} placeholder="/home/project/myapp" />
          <select value={d.mode} onChange={(e) => up(i, { mode: e.target.value as ServerDir['mode'] })}>{(Object.keys(MODE) as ServerDir['mode'][]).map((m) => <option key={m} value={m}>{MODE[m]}</option>)}</select>
          <input value={d.note ?? ''} onChange={(e) => up(i, { note: e.target.value })} placeholder="备注（可选）" />
          {!dirty && d.error && <Tag tone={d.error === '在设权限…' ? 'primary' : 'danger'}>{d.error === '在设权限…' ? '在设' : '没设好'}</Tag>}
          {!dirty && d.ok && <Tag tone="ok">好了</Tag>}
          <button className="btn ghost sm" onClick={() => { setList((l) => l.filter((_, j) => j !== i)); setDirty(true) }}>删</button>
        </div>
      ))}
      {!dirty && list.filter((d) => d.error && d.error !== '在设权限…').map((d) => <p key={d.path} className="hint" data-no-i18n="">{d.path}：{d.error}</p>)}
      <div className="pad row-actions">
        <button className="btn ghost sm" onClick={() => { setList((l) => [...l, { path: '', mode: 'read' }]); setDirty(true) }}>+ 加一个目录</button>
        {dirty && <button className="btn primary sm" disabled={list.some((d) => !d.path.trim())} onClick={save}>保存</button>}
      </div>
      <p className="hint">只读 / 能改：Agent 用 ACL 给 AI 用户（opero-ai）开这个目录的权限（那台要装 acl），去掉就收回。能部署：发布时 Agent 以 root 把包装进这里，不给员工开权限。系统目录（/etc、/usr…）只能登记成只读。</p>
    </Section>
  )
}

// ======================= 用量明细 =======================
export function UsageDetail() {
  const wss = useStore((s) => s.workspaces)
  const [d, setD] = useState<{ byWs: { workspace: string; tasks: number; tokens: string; cost: number }[]; byDay: { day: string; tasks: number; cost: number }[] } | null>(null)
  useEffect(() => { call<typeof d>('GET', '/api/usage/detail').then((r) => r && setD(r)) }, [])
  if (!d) return null
  const max = Math.max(0.01, ...d.byDay.map((x) => x.cost))
  return (
    <>
      <Section title="按项目（本月）">
        {d.byWs.length === 0 && <Empty>这个月还没有</Empty>}
        {d.byWs.map((x) => <Row key={x.workspace || '-'} title={wss.find((w) => w.id === x.workspace)?.name ?? (x.workspace ? x.workspace : '员工自己的目录')} sub={`${x.tasks} 轮 · ${x.tokens} token`} right={`$${x.cost.toFixed(2)}`} />)}
      </Section>
      <Section title="最近 30 天">
        <div className="pad usage-days">
          {d.byDay.map((x) => (
            <div key={x.day} className="usage-day" title={`${x.day} · ${x.tasks} 轮 · $${x.cost.toFixed(2)}`}>
              <i style={{ height: `${Math.max(3, (x.cost / max) * 100)}%` }} /><span>{x.day.slice(3)}</span>
            </div>
          ))}
          {d.byDay.length === 0 && <Empty>还没有</Empty>}
        </div>
      </Section>
    </>
  )
}

