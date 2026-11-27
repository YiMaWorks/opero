// 真的一套：员工的记忆仓库 / 历史会话 / work 历史，问题清单，服务器给员工的规矩，项目的自动同步和发布，用量明细
import { useEffect, useState } from 'react'
import type { BuildCfg, BuildComp, Deploy, Employee, LiveIssue, Message, Policy, Server, ServerDir, Session, Workspace } from '../types'
import { requireVerify, toast, useStore } from '../store'
import { api, call } from '../live'
import { PathInput } from '../components/PathPicker'
import { Markdown } from '../components/Markdown'
import { Empty, Field, PageHeader, Row, Section, Segmented, Tag, Toggle } from '../components/ui'
import { headNav, type PageProps } from './nav'
import { AskBar } from '../components/AskBar'
import { PLATS } from '../components/Packages'

// ======================= 员工资料里的：记忆、会话、执行器 =======================
export function EmployeeWorkSections({ e, nav }: { e: Employee; nav: PageProps['nav'] }) {
  const working = useStore((s) => s.sessions.find((x) => x.employee === e.id)?.working)
  const sid = useStore((s) => s.sessions.find((x) => x.employee === e.id)?.id)
  const handoff = async () => {
    if (!sid) return
    if (await call('POST', `/api/sessions/${sid}/handoff`, {}, '已开新会话：交接写在输入框里，看一下再发')) nav.openChat(e.id)
  }
  return (
    <>
      <Section title={`work 历史 · 现在是第 ${e.works?.[0]?.no ?? 1} 个`}>
        {(e.works ?? []).slice(0, 8).map((w) => (
          <Row key={w.no} title={`第 ${w.no} 个${w.to ? '' : '（现在）'}`} sub={`${w.from}${w.to ? ' → ' + w.to : ' 起'}${w.host ? ' · ' + w.host : ''} · ${w.reason}`} right={!w.to ? <Tag tone="ok">在用</Tag> : undefined} />
        ))}
        <div className="pad row-actions wrap">
          <button className="btn default sm" disabled={!!working} onClick={handoff}>开新会话接着做</button>
          <button className="btn ghost sm" onClick={() => nav.push({ page: 'history', params: { id: e.id } })}>历史会话</button>
        </div>
        {working && <p className="hint">员工在干活：这一轮做完或者停下后才能开新会话。（换执行器：点上面的「执行器」）</p>}
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
  }  // 从项目页点某个文档进来：直接打开它
  useEffect(() => { if (params.file) void openFile(String(params.file)) }, [params.file]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!open) return
    setBusy(true)
    const r = await call<{ result: string }>('PUT', `/api/employees/${params.id}/memory/file`, { path: open, text })
    setBusy(false)
    if (r) toast(r.result || '已保存')
  }
  return (
    <div className="page">
      <PageHeader title={e?.workspace ? '项目文档（docs/）' : '记忆仓库'} sub={e?.workspace ? `${e.name} 和这个项目的其它员工共用` : e?.name} {...headNav(nav)} />
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
/** 各类编译大概要多少（和后台 policy.ts buildNeed 一致） */
const BUILD_NEEDS: { what: string; mem: number; disk: number; cores: number; cloud?: boolean }[] = [
  { what: '前端 / Node / Go / Python', mem: 2, disk: 3, cores: 2 },
  { what: 'Java（Gradle / Maven）、.NET', mem: 4, disk: 5, cores: 4 },
  { what: 'Rust、C / C++、Docker 镜像', mem: 4, disk: 10, cores: 4 },
  { what: 'Android / Flutter 打包', mem: 8, disk: 20, cores: 8, cloud: true },
  { what: 'iOS、Unity', mem: 16, disk: 50, cores: 8, cloud: true },
]
const DENY_PRESETS = ['rm -rf', 'docker system prune', 'git push -f', 'git push --force', 'git reset --hard', 'DROP ', 'TRUNCATE ', 'shutdown', 'reboot']
export function PolicySection({ s }: { s: Server }) {
  const p: Policy = s.policy ?? {}
  const [deny, setDeny] = useState((p.deny ?? []).join('\n'))
  const save = (patch: Policy, msg = '已保存') => call('PUT', `/api/servers/${s.id}`, { policy: { ...p, ...patch } }, msg)
  const buildMode = p.build ?? (p.allowBuild === false ? 'off' : 'auto')
  return (
    <Section title="给员工的规矩" right={<span className="sub">员工在这台干活时生效</span>}>
      <div className="pad">
        <div className="field-label">编译 / 打包（gradle、mvn、docker build、npm run build…）</div>
        <Segmented value={buildMode} onChange={(v) => save({ build: v, allowBuild: v !== 'off' })} options={[{ value: 'auto', label: '看资源决定（推荐）' }, { value: 'on', label: '总是允许' }, { value: 'off', label: '不允许' }]} />
        <p className="field-hint">{buildMode === 'auto' ? '每次编译前查这台现在的可用内存、磁盘、CPU：够才跑，不够就拒绝并告诉员工交给你在「发布」里编。跑的时候也少用一个核，不把机器打满。' : buildMode === 'on' ? '不查资源，员工想编就编（小心把机器跑满）。' : '员工只改代码，写清楚怎么编交给你。'}</p>
        {buildMode === 'auto' && s.sys && (
          <div className="res-table">
            {BUILD_NEEDS.map((n) => {
              const low = s.sys!.cores <= 2 || s.sys!.memGb <= 8.5
              const ok = !n.cloud && !(low && n.mem >= 4) && s.sys!.memGb >= n.mem + Math.max(1, s.sys!.memGb * 0.1) && s.sys!.cores >= n.cores
              return <div key={n.what} className="res-row"><span>{n.what}</span><span className="sub">约 {n.mem}G 内存 · {n.disk}G 磁盘 · {n.cores} 核</span>{n.cloud ? <Tag>默认走流水线</Tag> : ok ? <Tag tone="ok">空闲时能本地编</Tag> : <Tag tone="warn">走流水线</Tag>}</div>
            })}
            <p className="field-hint">这台：{s.sys.cores} 核 · {s.sys.memGb}G 内存 · {s.sys.diskGb}G 磁盘。真跑之前还会看那一刻的空闲情况。</p>
          </div>
        )}
      </div>
      <label className="lrow"><span className="row-main"><span className="row-title">允许自测</span><span className="row-sub">跑测试、起项目或服务来试；关了员工读代码、看 diff 自查</span></span><Toggle on={p.allowTest ?? true} onChange={(v) => save({ allowTest: v })} /></label>
      <div className="pad form">
        <Field label="禁止的命令（一行一个，按开头匹配）" hint="比如 rm -rf、docker system prune。不管怎么设，sudo、装系统软件、管系统服务、改 /etc 都不许">
          <div className="chips">{DENY_PRESETS.map((x) => {
            const cur = p.deny ?? []
            const on = cur.includes(x)
            return <button key={x} type="button" className={'chip mono' + (on ? ' on' : '')} onClick={() => { const next = on ? cur.filter((y) => y !== x) : [...cur, x]; setDeny(next.join('\n')); save({ deny: next }) }} data-no-i18n="">{on ? '✓ ' : ''}{x}</button>
          })}</div>
          <textarea className="mono" rows={2} value={deny} onChange={(v) => setDeny(v.target.value)} onBlur={() => deny !== (p.deny ?? []).join('\n') && save({ deny: deny.split('\n').map((x) => x.trim()).filter(Boolean) })} placeholder="别的（一行一个）" data-no-i18n="" />
        </Field>
        <Field label="内存上限" hint="只算员工自己的进程；超了先提醒，连续 2 分钟或 10 分钟内超 5 回才停掉最大的那个进程">
          <div className="chips">{[0, 60, 70, 80, 90].map((n) => <button key={n} type="button" className={'chip' + ((p.memPct ?? 80) === n ? ' on' : '')} onClick={() => save({ memPct: n })}>{n ? `${n}%` : '不管'}</button>)}</div>
        </Field>
        <Field label="CPU 上限" hint="只算员工自己的进程；超了先提醒，连续 2 分钟或 10 分钟内超 5 回，先暂停最占 CPU 的进程（多半是编译），机器降下来自动继续">
          <div className="chips">{[0, 60, 70, 80, 90].map((n) => <button key={n} type="button" className={'chip' + ((p.cpuPct ?? 80) === n ? ' on' : '')} onClick={() => save({ cpuPct: n })}>{n ? `${n}%` : '不管'}</button>)}</div>
        </Field>
        <Field label="同时最多几个员工" hint="多了排队">
          <div className="chips">{[0, 1, 2, 4, 8].map((n) => <button key={n} type="button" className={'chip' + ((p.maxConcurrent ?? 0) === n ? ' on' : '')} onClick={() => save({ maxConcurrent: n })}>{n ? `${n} 个员工` : '不限'}</button>)}</div>
        </Field>
      </div>
    </Section>
  )
}

// ======================= 项目：自动同步、编译、发布环境 =======================
export function WorkspaceAutoSections({ w, nav }: { w: Workspace; nav?: PageProps['nav'] }) {
  const servers = useStore((s) => s.servers)
  const releases = useStore((s) => s.liveReleases)
  const projEmp = useStore((s) => s.employees.find((e) => e.workspace === w.id)?.id)
  const [list, setList] = useState<Deploy[]>(w.deploys ?? [])
  const [editing, setEditing] = useState<Deploy | 'new' | null>(null)
  useEffect(() => { setList(w.deploys ?? []) }, [w.deploys])
  const saveDeploys = async (next: Deploy[], msg = '已保存') => !!(await call('PUT', `/api/workspaces/${w.id}`, { deploys: next }, msg))
  const sv = (id?: string) => servers.find((s) => s.id === id)?.name ?? id ?? ''
  const run = async (d: Deploy) => {
    const b = compOfDeploy(w, d)
    if (!confirm(`发布「${w.name} → ${d.name}」？\n\n${b ? `先编译「${b.name}」（${PROVIDER[b.provider]}），` : ''}发到 ${d.servers.map(sv).join('、')}${d.dir ? `（${d.dir}）` : ''}${d.health ? '，再检查 ' + d.health : ''}`)) return
    const r = await call<{ id: string }>('POST', `/api/workspaces/${w.id}/deploys/${d.id}/run`, {}, '已开始发布')
    if (r && nav) nav.push({ page: 'release', params: { id: r.id } })
  }
  return (
    <>
      {nav && (
        <AskBar nav={nav} emp={projEmp} title="编译、发布交给员工配" placeholder="比如：加一个测试环境，发到 aws-dev 的 /srv/shop"
          context={`（在项目「${w.name}」的设置页说的：编译 / 发布 / 流水线你自己配，先 setup_info 看现场；缺 key 用 request_credential 找我）`}
          suggestions={[
            { label: '把编译和发布配好', text: '把这个项目的编译和发布配好：已有流水线或部署脚本就照着配，没有就自己建，试编通过、建好发布目标后告诉我' },
            { label: '读出已有的流水线', text: '看看我平台上和仓库里已有的流水线 / 部署脚本，照着它配 Opero 的编译和发布' },
            { label: '试编一次', text: '试编一次，编不过就查日志修到通过' },
            { label: '加测试环境', text: '加一个测试环境的发布目标：先看有哪些服务器，挑测试 / 开发那台，部署目录按项目习惯定，建好告诉我' },
          ]} />
      )}
      <Section title="自动同步">
        <label className="lrow"><span className="row-main"><span className="row-title">干完自动提交推送</span><span className="row-sub">员工开工前拉到最新（冲突会告诉它先解决）；这一轮干完有改动就提交（出错的、你点停止的都标「[未完成]」照样提交，做了一半的不丢）再推送，被拒就变基一次再推。要配了令牌才推送</span></span><Toggle on={w.autoSync !== false} onChange={(v) => call('PUT', `/api/workspaces/${w.id}`, { autoSync: v }, v ? '已开自动同步' : '已关：员工自己用 git_sync')} /></label>
      </Section>
      <Section title={`发布环境 · ${list.length}`} right={<button className="btn ghost sm" onClick={() => setEditing('new')}>手动加</button>}>
        {list.length === 0 && !editing && <Empty>还没有：跟上面的员工说一句「加一个测试环境」，它会看好服务器、目录建好；发生产时会先问你</Empty>}
        {list.map((d) => {
          const lastR = releases.filter((r) => r.ws === w.id && r.target === d.id).sort((a, b) => b.started - a.started)[0]
          return editing && editing !== 'new' && editing.id === d.id
            ? <DeployForm key={d.id} init={d} servers={servers} builds={w.builds ?? []} onCancel={() => setEditing(null)} onSave={async (x) => { if (await saveDeploys(list.map((y) => (y.id === d.id ? x : y)))) setEditing(null) }} />
            : <Row key={d.id} title={d.name}
                sub={<>{(w.builds?.length ?? 0) > 1 || d.build === 'none' ? `${compOfDeploy(w, d) ? `发「${compOfDeploy(w, d)!.name}」` : d.build === 'none' ? '不编译' : '还没选发哪个组件'} · ` : ''}{d.package ? `存进安装包 · ${PLATS.find((x) => x.p === d.package!.platform)?.label} · ${d.package.channel === 'prod' ? '正式' : '测试'}` : <>发到 {d.servers.map(sv).join('、')}{d.dir ? `（${d.dir}）` : ''}</>}{d.sign ? ' · 签名' : ''}{d.health ? ' · 检查' : ''} · 员工{d.ai === 'auto' ? '直接发' : d.ai === 'off' ? '不许发' : '发前问你'}{lastR ? ` · 上次 ${lastR.status === 'success' ? '成功' : lastR.status === 'failed' ? '失败' : '发布中'}` : ''}</>}
                right={<span className="row-actions"><button className="btn primary sm" onClick={() => run(d)}>发布</button><button className="btn ghost sm" onClick={() => setEditing(d)}>改</button><button className="btn ghost sm" onClick={() => { if (confirm(`删掉发布环境「${d.name}」？`)) saveDeploys(list.filter((x) => x.id !== d.id), '已删') }}>删</button></span>} />
        })}
        {editing === 'new' && <DeployForm servers={servers} builds={w.builds ?? []} onCancel={() => setEditing(null)} onSave={async (d) => { if (await saveDeploys([...list, d], '已添加')) setEditing(null) }} />}
        {nav && releases.some((r) => r.ws === w.id) && <Row title="发布记录" chevron onClick={() => nav.push({ page: 'workspace', params: { id: w.id } })} />}
      </Section>
    </>
  )
}

/** 这个发布目标发哪个编译组件（'none' 或没选清楚 = 不编译 / undefined） */
const compOfDeploy = (w: Workspace, d: Deploy): BuildComp | undefined => (d.build === 'none' ? undefined : d.build ? w.builds?.find((x) => x.id === d.build) : w.builds?.length === 1 ? w.builds[0] : undefined)
const PROVIDER: Record<BuildCfg['provider'], string> = { yunxiao: '云效', github: 'GitHub Actions', gitlab: 'GitLab CI', jenkins: 'Jenkins', local: '不用流水线' }
const WHERE: Record<NonNullable<BuildCfg['where']>, string> = { auto: '自动（本地够就本地，不够走流水线）', local: '总是本地', pipeline: '总是流水线' }
const whereOf = (b: BuildCfg) => b.where ?? (b.provider === 'local' ? 'local' : 'auto')
const pipeReady = (b: BuildCfg) => (b.provider === 'yunxiao' ? !!b.yunxiao?.pipelineId : b.provider === 'github' ? !!b.github?.at : b.provider === 'gitlab' ? !!b.gitlab?.at : b.provider === 'jenkins' ? !!b.jenkins?.at : false)
const pipeAt = (b: BuildCfg) => b.yunxiao?.at ?? b.github?.at ?? b.gitlab?.at ?? b.jenkins?.at
const KIND: Record<BuildCfg['kind'], string> = { node: 'Node', go: 'Go', android: '安卓 App', spring: 'Java（Spring）', custom: '自定义命令' }

/** 编译组件（网页、安卓、后台…）：每个有自己的模板、在哪编、流水线，各自试编、各自生成流水线；发布目标选发哪个。放在项目页最上面 */
export function BuildSection({ w }: { w: Workspace }) {
  const list = w.builds ?? []
  const [editing, setEditing] = useState<string | null>(null) // 组件编号，或 'new'
  const save = async (next: BuildComp[], msg: string) => !!(await call('PUT', `/api/workspaces/${w.id}`, { builds: next }, msg))
  return (
    <Section title={`编译 · ${list.length}`} right={<button className="btn ghost sm" onClick={() => setEditing(editing === 'new' ? null : 'new')}>{editing === 'new' ? '收起' : '加一个组件'}</button>}>
      {list.length === 0 && editing !== 'new' && <Empty>还没配编译：跟上面的员工说「把编译和发布配好」，它会看仓库和已有的流水线配好。一个项目可以有好几个编译组件（网页、安卓、后台…），各自编、各自发；不编译的项目发布时直接跑部署命令</Empty>}
      {list.map((b) => (editing === b.id
        ? <BuildForm key={b.id} w={w} init={b} onCancel={() => setEditing(null)} onSave={async (x) => { if (await save(list.map((y) => (y.id === b.id ? x : y)), '编译组件已存')) setEditing(null) }} />
        : <BuildCard key={b.id} w={w} b={b} onEdit={() => setEditing(b.id)}
            onDelete={() => { if (confirm(`删掉编译组件「${b.name}」？（发它的发布目标要先换组件）`)) void save(list.filter((x) => x.id !== b.id), '已删') }} />))}
      {editing === 'new' && <BuildForm w={w} onCancel={() => setEditing(null)} onSave={async (x) => { if (await save([...list, x], '已加编译组件')) setEditing(null) }} />}
    </Section>
  )
}

/** 一个编译组件：怎么编、流水线好了没有；生成流水线、试编译（只编不发）、看上次的日志 */
function BuildCard({ w, b, onEdit, onDelete }: { w: Workspace; b: BuildComp; onEdit: () => void; onDelete: () => void }) {
  const [busy, setBusy] = useState(false)
  type Try = { status: 'running' | 'ok' | 'fail'; by: string; at: number; files?: string[]; error?: string; log: string[] }
  const [last, setLast] = useState<Try | null>(null)
  const [showLog, setShowLog] = useState(false)
  const base = `/api/workspaces/${w.id}/builds/${encodeURIComponent(b.id)}`
  const tryBusy = last?.status === 'running'
  // 没试编过时后台回的是 {ok:true}（不是一次试编）：当成没有
  const loadTry = () => call<Try | null>('GET', `${base}/try`).then((r) => setLast(r && 'status' in r && r.at ? r : null))
  useEffect(() => { void loadTry() }, [w.id, b.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!tryBusy) return; const t = window.setInterval(loadTry, 5000); return () => clearInterval(t) }, [tryBusy]) // eslint-disable-line react-hooks/exhaustive-deps
  const tryBuild = async () => { const r = await call<Try>('POST', `${base}/try`, undefined, `开始试编译「${b.name}」：编远端最新提交，只编不发`); if (r) { setLast(r); setShowLog(true) } }
  const gen = async () => { setBusy(true); await call('POST', `${base}/generate`, undefined, '流水线已建好 / 更新'); setBusy(false) }
  const used = (w.deploys ?? []).filter((d) => d.build === b.id || (!d.build && (w.builds ?? []).length === 1)).map((d) => d.name)
  return (
    <>
      <Row title={<>{b.name} <span className="sub">· {KIND[b.kind]} · {WHERE[whereOf(b)].replace(/（.*）/, '')}</span></>}
        sub={`${b.provider === 'local' ? '没有流水线：只能在服务器上编（资源不够就编不了）' : pipeReady(b) ? `流水线：${PROVIDER[b.provider]}，已建好${pipeAt(b) ? ` · ${new Date(pipeAt(b)!).toLocaleString('zh-CN')}` : ''}` : `流水线：${PROVIDER[b.provider]}，还没建好`}${used.length ? ` · 发布到 ${used.join('、')}` : ''}`}
        right={<span className="row-actions">
          {b.provider !== 'local' && <button className="btn default sm" disabled={busy} onClick={gen}>{busy ? '生成中…' : pipeReady(b) ? '更新流水线' : '生成流水线'}</button>}
          <button className="btn primary sm" disabled={tryBusy} onClick={tryBuild}>{tryBusy ? '在编…' : '试编译'}</button>
          <button className="btn ghost sm" onClick={onEdit}>改</button>
          <button className="btn ghost sm" onClick={onDelete}>删</button>
        </span>} />
      {b.pipelineError && <div className="pad"><div className="banner b-warn">{`「${b.name}」的流水线没建成：${b.pipelineError}`}</div></div>}
      {last && (
        <Row title={<>上次试编译 <Tag tone={last.status === 'ok' ? 'ok' : last.status === 'fail' ? 'danger' : 'primary'}>{last.status === 'ok' ? '编过了' : last.status === 'fail' ? '没编过' : '在编…'}</Tag></>}
          sub={`${new Date(last.at).toLocaleString('zh-CN')} · ${last.by}${last.files?.length ? ` · ${last.files.join('、')}` : ''}`}
          right={<button className="btn ghost sm" onClick={() => setShowLog(!showLog)}>{showLog ? '收起' : '看日志'}</button>} />
      )}
      {last && showLog && <pre className="console small" data-no-i18n="">{last.log.join('\n')}{last.error ? `\n\n${last.error}` : ''}</pre>}
    </>
  )
}

/** 加 / 改一个编译组件：名字 + 模板 + 在哪编 + 打包工具；新加的按仓库里的文件猜好 */
function BuildForm({ w, init, onSave, onCancel }: { w: Workspace; init?: BuildComp; onSave: (b: BuildComp) => void; onCancel: () => void }) {
  const servers = useStore((s) => s.servers)
  const creds = useStore((s) => s.credentials)
  const codeupCreds = creds.filter((c) => c.group === '代码仓库' && /codeup/i.test(c.kind))
  const jenkinsCreds = creds.filter((c) => c.group === '其它' && c.kind === 'Jenkins')
  const [b, setB] = useState<BuildComp | null>(init ?? null)
  const [adv, setAdv] = useState(false)
  const [script, setScript] = useState<string | null>(null)
  const up = (p: Partial<BuildComp>) => setB((x) => (x ? { ...x, ...p } : x))
  // 重启哪个服务：在要部署的第一台上列服务
  const svcServer = w.deploys?.[0]?.servers?.[0] ?? w.server ?? 'local'
  /** 新加的：按仓库里的文件猜项目类型、版本号文件、在哪编、用哪个账号 */
  useEffect(() => {
    if (init) return
    void (async () => {
      const provider: BuildCfg['provider'] = w.provider === 'Codeup' ? 'yunxiao' : w.provider === 'GitHub' ? 'github' : w.provider === 'GitLab' ? 'gitlab' : 'local'
      const cfg: BuildComp = { id: '', name: '', kind: 'node', provider, where: 'auto', ...(provider === 'yunxiao' ? { yunxiao: { cred: (w.credential && codeupCreds.some((c) => c.id === w.credential) ? w.credential : codeupCreds[0]?.id) ?? '' } } : {}), ...(provider === 'local' ? { local: { server: w.server ?? 'local' } } : {}) }
      const ls = async (dir: string) => (await api<{ entries: { name: string }[] }>('GET', `/api/servers/${w.server ?? 'local'}/ls?path=${encodeURIComponent(dir)}`).catch(() => ({ entries: [] }))).entries.map((e) => e.name)
      const top = w.dir ? await ls(w.dir) : []
      const has = (n: string) => top.includes(n)
      const GB = /^build\.gradle(\.kts)?$/
      let guess: BuildComp
      if (has('go.mod')) guess = { ...cfg, kind: 'go', ...(has('VERSION') ? { versionFile: 'VERSION' } : {}) }
      else if (has('pom.xml')) guess = { ...cfg, kind: 'spring', spring: { tool: 'maven', jdk: 17 }, versionFile: 'pom.xml' }
      else if (top.some((n) => GB.test(n) || /^settings\.gradle(\.kts)?$/.test(n))) {
        const app = has('app') ? await ls(`${w.dir}/app`) : []
        const appBuild = app.find((n) => GB.test(n))
        guess = appBuild ? { ...cfg, kind: 'android', versionFile: `app/${appBuild}` } : { ...cfg, kind: 'spring', spring: { tool: 'gradle', jdk: 17 }, versionFile: top.find((n) => GB.test(n)) }
      } else if (has('package.json')) guess = { ...cfg, kind: 'node', versionFile: 'package.json' }
      else guess = { ...cfg, kind: 'custom', ...(has('deploy') ? { cmd: 'bash deploy/build.sh' } : {}) }
      setB(guess)
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!b) return <div className="pad"><span className="sub">在看仓库里有什么…</span></div>
  return (
    <div className="pad form boxed">
      <Field label="名字" hint="一个项目可以有好几个组件，各自编、各自发（比如「网页」「安卓」「后台」）"><input value={b.name} onChange={(e) => up({ name: e.target.value })} placeholder={KIND[b.kind]} /></Field>
      <Field label="模板"><Segmented value={b.kind} onChange={(v) => up({ kind: v })} options={(Object.keys(KIND) as BuildCfg['kind'][]).map((k) => ({ value: k, label: KIND[k] }))} /></Field>
      <Field label="在哪编" hint="自动：编之前看本地那台的空闲内存、磁盘、CPU，够就本地编（快），不够交给流水线；Android 这类重的默认走流水线">
        <Segmented value={whereOf(b)} onChange={(v) => up({ where: v })} options={(Object.keys(WHERE) as NonNullable<BuildCfg['where']>[]).map((k) => ({ value: k, label: k === 'auto' ? '自动（推荐）' : WHERE[k] }))} />
      </Field>
      <Field label="流水线用哪个打包工具">
        <div className="chips">{(Object.keys(PROVIDER) as BuildCfg['provider'][]).map((k) => <button key={k} type="button" className={'chip' + (b.provider === k ? ' on' : '')} onClick={() => up({ provider: k, ...(k === 'local' ? { where: 'local' } : {}) })}>{PROVIDER[k]}</button>)}</div>
      </Field>
      {b.provider === 'gitlab' && <p className="field-hint">用项目的 GitLab 凭证（要有 api 权限）：「生成流水线」会在仓库的 .opero/gitlab-ci.yml 里给每个组件放一个任务，并在 .gitlab-ci.yml 里 include 它。GitLab 要能访问 Opero 的外网地址（传产物回来）。</p>}
      {b.provider === 'jenkins' && (
        <Field label="用哪个 Jenkins" hint="「凭证 → 其它 → Jenkins」：地址、用户名、API Token。「生成流水线」会在 Jenkins 里给这个组件建一个任务；Jenkins 要能访问 Opero 的外网地址（拿源码、传产物）">
          <div className="chips">{jenkinsCreds.map((c) => <button key={c.id} type="button" className={'chip' + (b.jenkins?.cred === c.id ? ' on' : '')} onClick={() => up({ jenkins: { ...(b.jenkins ?? {}), cred: c.id } })}>{c.name}</button>)}{jenkinsCreds.length === 0 && <span className="sub">还没有 Jenkins 凭证</span>}</div>
        </Field>
      )}
      {b.provider === 'yunxiao' && (
        <Field label="用哪个云效账号" hint="Codeup 的个人访问令牌就行（要有流水线读写）；没有就去「凭证 → 代码仓库 → Codeup」加">
          <div className="chips">{codeupCreds.map((c) => <button key={c.id} type="button" className={'chip' + (b.yunxiao?.cred === c.id ? ' on' : '')} onClick={() => up({ yunxiao: { ...(b.yunxiao ?? { cred: '' }), cred: c.id } })}>{c.name}</button>)}{codeupCreds.length === 0 && <span className="sub">还没有 Codeup 凭证</span>}</div>
        </Field>
      )}
      {whereOf(b) !== 'pipeline' && <Field label="本地编在哪台" hint="在那台拉一份干净的代码跑同一个脚本；工具装在 /root/.cache/opero"><div className="chips">{servers.filter((x) => x.id === 'local' || x.via === 'agent').map((x) => <button key={x.id} type="button" className={'chip' + ((b.local?.server ?? '') === x.id ? ' on' : '')} onClick={() => up({ local: { server: x.id } })}>{x.name}</button>)}</div></Field>}
      {b.kind === 'custom' && <Field label="编译命令" hint="在仓库根目录跑，把要发的东西放进 out/（包里放 deploy.sh 就由它来装）"><textarea className="mono" rows={3} value={b.cmd ?? ''} onChange={(e) => up({ cmd: e.target.value })} placeholder="bash deploy/build.sh" /></Field>}
      {(b.kind === 'node' || b.kind === 'go') && <Field label="部署完重启哪个服务（可选）"><ServicePick server={svcServer} value={b.service ?? ''} onChange={(v) => up({ service: v })} /></Field>}
      {b.kind === 'spring' && (
        <>
          <Field label="工具"><Segmented value={b.spring?.tool ?? 'maven'} onChange={(v) => up({ spring: { ...(b.spring ?? {}), tool: v } })} options={[{ value: 'maven', label: 'Maven' }, { value: 'gradle', label: 'Gradle' }]} /></Field>
          <Field label="JDK"><Segmented value={String(b.spring?.jdk ?? 17) as '17' | '21'} onChange={(v) => up({ spring: { ...(b.spring ?? {}), jdk: Number(v) as 17 } })} options={[{ value: '17', label: '17' }, { value: '21', label: '21' }]} /></Field>
        </>
      )}
      <button type="button" className="btn ghost sm" onClick={() => setAdv(!adv)}>{adv ? '收起高级设置' : '高级设置（一般不用动）'}</button>
      {adv && (
        <>
          {b.kind !== 'custom' && <Field label="代码在哪个子目录"><PathInput server={w.server ?? 'local'} base={w.dir} value={b.subdir ?? ''} onChange={(v) => up({ subdir: v })} placeholder="." /></Field>}
          <Field label="版本号文件" hint="自动认出来的；一般不用改"><PathInput server={w.server ?? 'local'} base={w.dir} files value={b.versionFile ?? ''} onChange={(v) => up({ versionFile: v })} placeholder="package.json" /></Field>
          <Field label="版本号正则（不填按版本号文件猜）"><input className="mono" value={b.versionRe ?? ''} onChange={(e) => up({ versionRe: e.target.value })} placeholder={'"version"\\s*:\\s*"([^"]+)"'} /></Field>
          <Field label="发哪个产物（不填按模板）"><input value={b.file ?? ''} onChange={(e) => up({ file: e.target.value })} placeholder={b.kind === 'android' ? '*.apk' : b.kind === 'spring' ? 'bundle.tgz' : '*.tgz'} /></Field>
          {b.kind === 'spring' && <Field label="编译命令"><div className="chips">{SPRING_TASKS.map((x) => <button key={x} type="button" className={'chip mono' + ((b.spring?.task ?? '') === x ? ' on' : '')} onClick={() => up({ spring: { ...(b.spring ?? {}), task: x } })} data-no-i18n="">{x}</button>)}</div></Field>}
          {b.provider === 'yunxiao' && (
            <>
              <Field label="组织编号（不填用 Codeup 地址里的）"><input value={b.yunxiao?.org ?? ''} onChange={(e) => up({ yunxiao: { ...(b.yunxiao ?? { cred: '' }), org: e.target.value } })} /></Field>
              <Field label="已有的流水线编号（不填 = 点「生成流水线」新建）"><input value={b.yunxiao?.pipelineId ?? ''} onChange={(e) => up({ yunxiao: { ...(b.yunxiao ?? { cred: '' }), pipelineId: e.target.value } })} /></Field>
              <Field label="构建镜像（不填用 alinux3）" hint="要装很多工具的项目用一个装好工具的镜像"><input value={b.yunxiao?.image ?? ''} onChange={(e) => up({ yunxiao: { ...(b.yunxiao ?? { cred: '' }), image: e.target.value } })} /></Field>
            </>
          )}
          {b.provider === 'github' && <Field label={`工作流文件名（不填用 opero-build-${b.id || '<组件>'}.yml）`}><input value={b.github?.workflow ?? ''} onChange={(e) => up({ github: { ...(b.github ?? {}), workflow: e.target.value } })} placeholder={`opero-build-${b.id || 'web'}.yml`} /></Field>}
        </>
      )}
      <div className="row-actions">
        {init && <button className="btn ghost" onClick={() => (script === null ? call<{ script: string }>('GET', `/api/workspaces/${w.id}/builds/${encodeURIComponent(init.id)}/script`).then((r) => r && setScript(r.script)) : setScript(null))}>{script === null ? '看编译脚本' : '收起脚本'}</button>}
        <button className="btn ghost" onClick={onCancel}>取消</button>
        <button className="btn primary" onClick={() => onSave({ ...b, name: b.name.trim() || KIND[b.kind] })}>保存</button>
      </div>
      {script !== null && <pre className="console" data-no-i18n="">{script}</pre>}
    </div>
  )
}

/** 不编译时常用的部署命令：点一个，再点要重启的服务 */
const DEPLOY_CMDS: [string, string][] = [
  ['拉最新代码', 'git pull'],
  ['Node：拉代码 + 装依赖', 'git pull && npm ci --omit=dev'],
  ['Docker Compose', 'docker compose pull && docker compose up -d'],
  ['PHP / 静态站：只拉代码', 'git pull --ff-only'],
]
/** 一个发布环境的设置：这是哪个环境、叫什么、发哪个组件、发到哪、怎么部署。项目设置页和发布页（环境卡片上的「编辑」）共用 */
export function DeployForm({ init, servers, builds, onSave, onCancel, bare }: { init?: Deploy; servers: Server[]; builds: BuildComp[]; onSave: (d: Deploy) => void; onCancel: () => void; bare?: boolean }) {
  // 发布时签名只能用安卓证书（苹果 / Windows 的要在 Mac / Windows 上用）
  const certs = useStore((s) => s.credentials).filter((c) => c.group === '签名证书' && !NOT_ANDROID.includes(c.kind))
  const [d, setD] = useState<Deploy>(init ?? { id: '', name: '', servers: [], keep: 5, autoRollback: true })
  // 发哪个编译组件：只有一个就默认它；'none' = 不编译只跑部署命令
  const sel = d.build ?? (builds.length === 1 ? builds[0].id : builds.length ? '' : 'none')
  const build = sel && sel !== 'none' ? builds.find((x) => x.id === sel) : undefined
  const [adv, setAdv] = useState(false)
  const up = (p: Partial<Deploy>) => setD((x) => ({ ...x, ...p }))
  const pkg = d.package
  const dirsOf = (ids: string[]) => [...new Set(ids.flatMap((id) => (servers.find((s) => s.id === id)?.dirs ?? []).filter((x) => x.mode === 'deploy').map((x) => x.path)))]
  // 选中的服务器上登记成「能部署」的目录：点一下填进去；只有一个就直接用
  const deployDirs = dirsOf(d.servers)
  const notAllowed = d.dir ? d.servers.map((id) => servers.find((s) => s.id === id)).filter((s) => s && !(s.dirs ?? []).some((x) => x.mode === 'deploy' && (d.dir === x.path || d.dir!.startsWith(x.path + '/')))) : []
  const toggleServer = (id: string) => {
    const next = d.servers.includes(id) ? d.servers.filter((x) => x !== id) : [...d.servers, id]
    const dirs = dirsOf(next)
    up({ servers: next, ...(!d.dir && dirs.length === 1 ? { dir: dirs[0] } : {}) })
  }
  // 这是哪个环境：自己标（生产 / 预发 / 测试 / 开发），不标就跟发到的服务器的环境标签走；名字不填就用它
  const envs = [...new Set(d.servers.map((id) => servers.find((s) => s.id === id)?.env).filter((x): x is string => !!x))]
  const autoName = d.env || envs.join(' + ') || '发布'
  const srvProd = d.servers.some((id) => { const s = servers.find((x) => x.id === id); return !!s && (s.protect ?? PROD.test(s.env)) })
  const prod = (!!d.env && PROD.test(d.env)) || srvProd
  const pickEnv = (e: string | undefined) => {
    // 名字还是空的、或者就是原来的环境名：跟着改
    const followName = !d.name.trim() || d.name === (d.env || envs.join(' + '))
    up({ env: e, ...(followName ? { name: e ?? '' } : {}) })
  }
  const svc = d.command?.match(/systemctl restart (\S+)/)?.[1] ?? ''
  const setSvc = (v: string) => up({ command: `${(d.command ?? '').replace(/\s*&&\s*systemctl restart \S+/, '')}${v ? `${d.command ? ' && ' : ''}systemctl restart ${v}` : ''}` || undefined })
  return (
    <div className={bare ? 'form' : 'pad form boxed'}>
      <Field label="这是哪个环境" hint={prod ? '按生产保护：每次发布要你验证本人，员工发之前先问你' : '测试 / 开发环境：员工可以直接发（下面能改）'}>
        <div className="chips">
          {ENVS.map((e) => <button key={e} type="button" className={'chip' + (d.env === e ? ' on' : '')} onClick={() => pickEnv(e)}>{e}</button>)}
          {d.env && !ENVS.includes(d.env) && <button type="button" className="chip on">{d.env}</button>}
          <button type="button" className={'chip' + (!d.env ? ' on' : '')} onClick={() => pickEnv(undefined)}>{`跟服务器${envs.length ? `（${envs.join(' / ')}）` : ''}`}</button>
        </div>
      </Field>
      {d.env && !PROD.test(d.env) && srvProd && <div className="banner b-warn">发到的服务器里有生产的：这个环境照样按生产保护（发布要验证本人）。要改的话去服务器详情把它的环境标签或「改东西先确认」改掉</div>}
      <Field label="名字" hint="发布页上显示的，员工说「发到某某」也用它"><input value={d.name} onChange={(v) => up({ name: v.target.value })} placeholder={autoName} /></Field>
      <Field label="编完发到哪" hint={pkg ? '不发服务器：编完（签好名）放进项目的「安装包」那一格，每格只留最新' : 'App（apk / ipa / msix…）选「存进安装包」'}>
        <Segmented value={pkg ? 'pkg' : 'srv'} onChange={(v) => up(v === 'pkg' ? { package: d.package ?? { platform: 'android', channel: 'test' }, servers: [] } : { package: undefined })}
          options={[{ value: 'srv', label: '发到服务器' }, { value: 'pkg', label: '存进安装包（App）' }]} />
      </Field>
      {pkg && (
        <Field label="放进哪一格">
          <div className="chips">{PLATS.map((x) => <button key={x.p} type="button" className={'chip' + (pkg.platform === x.p ? ' on' : '')} onClick={() => up({ package: { ...pkg, platform: x.p } })}>{x.label}</button>)}</div>
          <Segmented value={pkg.channel} onChange={(v) => up({ package: { ...pkg, channel: v } })} options={[{ value: 'test', label: '测试' }, { value: 'prod', label: '正式' }]} />
        </Field>
      )}
      {builds.length > 0 && (
        <Field label="发哪个编译组件" hint={pkg ? '编出安装包的那个组件' : '编出来的包发到下面这几台；「不编译」= 只在服务器上跑部署命令'}>
          <div className="chips">
            {builds.map((x) => <button key={x.id} type="button" className={'chip' + (sel === x.id ? ' on' : '')} onClick={() => up({ build: x.id })}>{x.name}<span className="sub"> · {KIND[x.kind]}</span></button>)}
            {!pkg && <button type="button" className={'chip' + (sel === 'none' ? ' on' : '')} onClick={() => up({ build: 'none' })}>不编译</button>}
          </div>
        </Field>
      )}
      {pkg && !builds.length && <div className="banner b-warn">存进安装包要先有编译组件：上面「编译」里加一个（或者跟员工说一句）</div>}
      {!pkg && <><div className="field"><span className="field-label">发到哪几台</span>
        <div className="chips">{servers.map((s) => <button key={s.id} type="button" className={'chip' + (d.servers.includes(s.id) ? ' on' : '')} onClick={() => toggleServer(s.id)}>{s.name}<span className="sub"> · {s.env}</span></button>)}</div>
      </div>
      <Field label="部署目录（OPERO_DIR = KL_DIR）" hint="点下面登记过「能部署」的目录，或者「选…」在第一台上浏览">
        {deployDirs.length > 0 && <div className="chips">{deployDirs.map((x) => <button key={x} type="button" className={'chip mono' + (d.dir === x ? ' on' : '')} onClick={() => up({ dir: x })} data-no-i18n="">{x}</button>)}</div>}
        <PathInput server={d.servers[0]} value={d.dir ?? ''} onChange={(v) => up({ dir: v || undefined })} placeholder="/home/project/myapp" />
      </Field>
      {notAllowed.length > 0 && <div className="banner b-warn">还没登记成能部署：{notAllowed.map((s) => s!.name).join('、')}（服务器详情 → 目录）</div>}</>}
      {(build?.kind === 'android' || pkg?.platform === 'android') && certs.length > 0 && (
        <Field label="给 apk / aab 签名"><div className="chips"><button type="button" className={'chip' + (!d.sign ? ' on' : '')} onClick={() => up({ sign: undefined })}>不签</button>{certs.map((c) => <button key={c.id} type="button" className={'chip' + (d.sign === c.id ? ' on' : '')} onClick={() => up({ sign: c.id })}>{c.name}</button>)}</div></Field>
      )}
      {!build && !pkg && (
        <Field label="部署命令" hint="在部署目录里跑；点一个常用的，再选要重启的服务">
          <div className="chips">{DEPLOY_CMDS.map(([label, c]) => <button key={label} type="button" className={'chip' + ((d.command ?? '').startsWith(c) ? ' on' : '')} onClick={() => up({ command: c + (svc ? ` && systemctl restart ${svc}` : '') })}>{label}</button>)}</div>
          {d.servers[0] && <ServicePick server={d.servers[0]} value={svc} onChange={setSvc} />}
          <textarea className="mono" rows={2} value={d.command ?? ''} onChange={(v) => up({ command: v.target.value || undefined })} placeholder="git pull && systemctl restart app" />
        </Field>
      )}
      <Field label="员工能不能发" hint="默认：发生产先问你，测试 / 开发直接发"><Segmented value={d.ai ?? (prod ? 'ask' : 'auto')} onChange={(v) => up({ ai: v })} options={[{ value: 'ask', label: '发前问你' }, { value: 'auto', label: '直接发（失败自动让它修）' }, { value: 'off', label: '不许' }]} /></Field>
      {!pkg && <><Field label="留几个版本（能回滚）"><div className="chips">{[3, 5, 10].map((n) => <button key={n} type="button" className={'chip' + ((d.keep ?? 5) === n ? ' on' : '')} onClick={() => up({ keep: n })}>{`${n} 个版本`}</button>)}</div></Field>
      <label className="lrow"><span className="row-main"><span className="row-title">失败自动退回上一版</span><span className="row-sub">部署或检查失败时，用上一个成功版本留着的包重新部署</span></span><Toggle on={d.autoRollback !== false} onChange={(v) => up({ autoRollback: v })} /></label>
      <button type="button" className="btn ghost sm" onClick={() => setAdv(!adv)}>{adv ? '收起高级设置' : '高级设置（一般不用动）'}</button></>}
      {adv && !pkg && (
        <>
          <Field label="发完检查的地址" hint="在每台上 curl，1 分钟内 2xx / 3xx 算好；不填不检查"><input value={d.health ?? ''} onChange={(v) => up({ health: v.target.value || undefined })} placeholder="http://127.0.0.1:8080/health" /></Field>
          {build && <Field label="包里的部署脚本（不填用 deploy.sh）"><input className="mono" value={d.script ?? ''} onChange={(v) => up({ script: v.target.value || undefined })} placeholder="deploy.sh" /></Field>}
          {build && <Field label="部署命令（包里没有部署脚本时用）" hint="包在 $OPERO_PKG，提交在 $OPERO_REF，要密码用 {{secret:凭证名}}"><textarea className="mono" rows={2} value={d.command ?? ''} onChange={(v) => up({ command: v.target.value || undefined })} /></Field>}
        </>
      )}
      <div className="row-actions"><button className="btn ghost" onClick={onCancel}>取消</button><button className="btn primary" disabled={pkg ? !builds.length || !sel || sel === 'none' : !d.servers.length || !sel} onClick={() => onSave({ ...d, name: d.name.trim() || autoName, build: builds.length ? sel || undefined : undefined })}>保存</button></div>
    </div>
  )
}

const ENVS = ['生产', '预发', '测试', '开发']
/** 不是安卓的签名证书（凭证的类型）：发布时不能用来签 apk / aab */
const NOT_ANDROID = ['苹果证书', 'App Store Connect API Key', 'Windows 代码签名']
const PROD = /生产|正式|線上|线上|prod|production|live/i

const SPRING_TASKS = ['clean package -DskipTests', 'clean package', 'bootJar']
/** 选这台在跑的系统服务（点开才去读），也能手填 */
export function ServicePick({ server, value, onChange }: { server: string; value: string; onChange: (v: string) => void }) {
  const [list, setList] = useState<string[] | null>(null)
  const load = () => { if (list === null) call<{ services: string[] }>('GET', `/api/servers/${server}/services`).then((r) => setList((r?.services ?? []).map((x) => x.replace(/\.service$/, '')).filter((x) => !SYS_SVC.test(x)))) }
  return (
    <div className="chips">
      {list === null && <button type="button" className="chip" onClick={load}>{value || '从这台在跑的服务里选…'}</button>}
      {list?.map((x) => <button key={x} type="button" className={'chip mono' + (value === x ? ' on' : '')} onClick={() => onChange(value === x ? '' : x)} data-no-i18n="">{x}</button>)}
      {list && <input className="chip-input" value={list.includes(value) ? '' : value} onChange={(e) => onChange(e.target.value)} placeholder="别的" />}
    </div>
  )
}
/** 系统自带的服务：不列出来 */
const SYS_SVC = /^(systemd-|getty@|serial-getty|user@|dbus|cron|crond|ssh|sshd|rsyslog|polkit|snapd|chronyd|irqbalance|unattended|multipathd|udisks|packagekit|accounts-daemon|atd|ModemManager|NetworkManager|networkd|wpa_supplicant|qemu-guest|cloud-|aliyun|AssistDaemon|tuned|firewalld|auditd|containerd|lvm2|blk-|rngd|acpid|kdump|postfix|getty)/

// ======================= 服务器：登记本地目录 =======================
const MODE: Record<ServerDir['mode'], string> = { read: '员工只读', write: '员工能改', deploy: '能部署' }
export function DirsSection({ s }: { s: Server }) {
  const [list, setList] = useState<ServerDir[]>(s.dirs ?? [])
  const [dirty, setDirty] = useState(false)
  useEffect(() => { setList(s.dirs ?? []); setDirty(false) }, [s.dirs])
  const up = (i: number, p: Partial<ServerDir>) => { setList((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x))); setDirty(true) }
  const save = () => (call('PUT', `/api/servers/${s.id}`, { dirs: list.map(({ path, mode, note }) => ({ path, mode, note })) }, '已保存，在给 AI 用户开权限…'))
  return (
    <Section title={`目录 · ${list.length}`} right={<span className="sub">员工能读 / 改哪些本地目录，发布能部署进哪些</span>}>
      {list.length === 0 && <Empty>还没登记：员工只能碰自己的工作目录；发布不能部署进任何目录</Empty>}
      {list.map((d, i) => (
        <div key={i} className="pad inline-form">
          <PathInput server={s.id} value={d.path} onChange={(v) => up(i, { path: v })} placeholder="/home/project/myapp" />
          <select value={d.mode} onChange={(e) => up(i, { mode: e.target.value as ServerDir['mode'] })}>{(Object.keys(MODE) as ServerDir['mode'][]).map((m) => <option key={m} value={m}>{MODE[m]}</option>)}</select>
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

