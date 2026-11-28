// 发布（照 KidLock「研发 → 发布」）：看板（每个项目一张卡、每个环境一行）→ 项目的发布页（每个环境一张卡：线上版本、最近一次、发到哪、发布 / 回滚）
// → 发布 / 回滚弹窗（这次带上哪些提交、说明）→ 发布详情（步骤时间线、失败原因、输出）。员工能发的它也能发，发生产照旧要你验证本人。
import { useEffect, useState } from 'react'
import type { BuildComp, Deploy, LiveRelease, PkgPlatform, ReleaseStep, Server, Workspace } from '../types'
import { toast, useStore } from '../store'
import { call } from '../live'
import { Empty, PageHeader, Segmented, Sheet, Tag } from '../components/ui'
import { IconCheck } from '../components/icons'
import { headNav, type PageProps } from './nav'
import { PackagesSection, PLATS } from '../components/Packages'

type Nav = PageProps['nav']
const STEP: Record<ReleaseStep['k'], string> = { build: '编译', checkout: '核对产物', transfer: '发到服务器', sign: '签名', deploy: '部署', health: '检查', rollback: '退回上一版', store: '存进安装包' }
const ST: Record<LiveRelease['status'], { label: string; tone: 'primary' | 'ok' | 'danger' }> = { running: { label: '发布中', tone: 'primary' }, success: { label: '成功', tone: 'ok' }, failed: { label: '失败', tone: 'danger' } }
const KIND: Record<string, string> = { node: 'Node 服务', go: 'Go 程序', android: '安卓 App', spring: 'Java 程序', custom: '自定义' }
const PIPE: Record<string, string> = { yunxiao: '云效流水线', github: 'GitHub Actions', gitlab: 'GitLab CI', jenkins: 'Jenkins', local: '本地编' }
const AI: Record<string, string> = { auto: '员工能直接发', ask: '员工发前问你', off: '只能你来发' }
const pad = (n: number) => String(n).padStart(2, '0')
const at = (ts?: number) => { if (!ts) return ''; const d = new Date(ts); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` }
const ms = (n: number) => { const s = Math.max(0, Math.round(n / 1000)); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s` }
const took = (r: LiveRelease) => (r.ended ? ms(r.ended - r.started) : '')
const compText = (b: BuildComp) => `${KIND[b.kind] ?? b.kind} · ${b.where === 'local' || b.provider === 'local' ? '本地编' : b.where === 'pipeline' ? PIPE[b.provider] : `自动（本地 / ${PIPE[b.provider]}）`}`
/** 项目怎么编：一个组件写怎么编；好几个就列名字 */
const buildText = (w: Workspace) => { const l = w.builds ?? []; return !l.length ? '不编译 · 直接跑部署命令' : l.length === 1 ? compText(l[0]) : `${l.length} 个编译组件：${l.map((b) => b.name).join('、')}` }
/** 这个环境发哪个组件（不编译 / 没选清楚 = undefined） */
const compOfDeploy = (w: Workspace, d: Deploy) => (d.build === 'none' ? undefined : d.build ? w.builds?.find((x) => x.id === d.build) : w.builds?.length === 1 ? w.builds[0] : undefined)
// 仓库地址只留最后两段（AI/opero-yima）：Codeup 前面那串组织编号太长，看不出是什么
const repoShort = (u: string) => u.replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, '').split('/').slice(-2).join('/')

const PROD = /生产|正式|線上|线上|prod|production|live/i
/** 这个环境是什么、算不算生产：自己标了就用标的（Deploy.env），没标看发到的服务器；服务器是生产的照样算生产 */
function envLabel(d: Deploy, servers: Server[]) {
  const svs = d.servers.map((id) => servers.find((s) => s.id === id)).filter((x): x is Server => !!x)
  const envs = [...new Set(svs.map((s) => s.env).filter(Boolean))]
  const prod = (!!d.env && PROD.test(d.env)) || svs.some((s) => s.protect ?? PROD.test(s.env))
  return { text: d.env || envs.join(' / ') || '—', prod }
}
const releasesOf = (list: LiveRelease[], wid: string, did?: string) => list.filter((r) => r.ws === wid && (!did || r.target === did)).sort((a, b) => b.started - a.started)

// ======================= 看板 =======================
/** 「项目」页（项目和发布合在一起，2026-11-27 主人定的）：上面发布概况，中间每个项目一张卡（各环境线上是哪个版本、最近一次发布），下面全部发布记录。
 *  点卡片进项目页，发布是项目页最上面一块（ReleaseSection）。旧的 releases 路由在 pages/index.tsx 里转过来 */
export function ProjectsPage({ nav }: PageProps) {
  const list = useStore((s) => s.liveReleases)
  const wss = useStore((s) => s.workspaces)
  const servers = useStore((s) => s.servers)
  return <Board nav={nav} list={list} wss={wss} servers={servers} />
}

function Board({ nav, list, wss }: { nav: Nav; list: LiveRelease[]; wss: Workspace[]; servers: Server[] }) {
  const [tab, setTab] = useState<'all' | 'running' | 'success' | 'failed'>('all')
  const [ws, setWs] = useState('')
  const since = Date.now() - 30 * 86400_000
  const month = list.filter((r) => r.started >= since && !r.rollbackOf)
  const done = month.filter((r) => r.status !== 'running')
  const okN = done.filter((r) => r.status === 'success').length
  const avg = done.filter((r) => r.ended).reduce((a, r) => a + (r.ended! - r.started), 0) / Math.max(1, done.filter((r) => r.ended).length)
  const rows = [...list].filter((r) => (tab === 'all' || r.status === tab) && (!ws || r.ws === ws)).sort((a, b) => b.started - a.started).slice(0, 50)
  return (
    <div className="page">
      <PageHeader title="项目" sub="员工干活的代码仓库，和它们发到哪、线上是哪个版本；点一个项目进去发布、编译、管员工" {...headNav(nav)}
        right={<button className="btn primary sm" onClick={() => nav.push({ page: 'workspaceAdd' })}>+ 接入项目</button>} />
      <div className="page-body">
        <div className="rel-kpis">
          <div><b>{month.length}</b><span>近 30 天发布</span></div>
          <div><b className={done.length && okN / done.length < 0.8 ? 'bad' : 'ok'}>{done.length ? `${Math.round((okN / done.length) * 100)}%` : '—'}</b><span>成功率</span></div>
          <div><b className={done.length - okN ? 'bad' : ''}>{done.length - okN}</b><span>失败</span></div>
          <div><b>{list.filter((r) => r.rollbackOf && r.started >= since).length}</b><span>回滚</span></div>
          <div><b>{done.length ? ms(avg) : '—'}</b><span>平均耗时</span></div>
          <div><b className={list.some((r) => r.status === 'running') ? 'run' : ''}>{list.filter((r) => r.status === 'running').length}</b><span>正在发</span></div>
        </div>
        <div className="rel-note">发布 = 编译（本地或流水线）→ 核对产物 → 发到服务器 → 部署 → 检查，失败自动退回上一版；每一步都有记录。环境怎么配，在项目里跟员工说一句就行。</div>
        {wss.length === 0 && <Empty>还没有项目：点右上「+ 接入项目」，接一个 GitHub / Codeup / Gitee 仓库</Empty>}
        <div className="rel-grid">
          {wss.map((w) => {
            const deploys = w.deploys ?? []
            return (
              <div key={w.id} className="rel-card2" onClick={() => nav.push({ page: 'workspace', params: { id: w.id } })}>
                <div className="rel-card2-head">
                  <span className="rel-tile">{w.name.slice(0, 1).toUpperCase()}</span>
                  <span className="rel-card2-title"><b>{w.name}{(w as Workspace & { error?: string }).error && <Tag tone="danger">有问题</Tag>}</b><small className="mono" data-no-i18n="">{repoShort(w.repo)}</small></span>
                </div>
                <div className="rel-chips">
                  <span className="rel-chip">{buildText(w)}</span>
                  <span className="rel-chip mono" data-no-i18n="">{w.branch}</span>
                </div>
                <div className="rel-lines">
                  {deploys.length === 0 && <div className="rel-line idle"><span className="rel-line-name">还没有发布环境</span><span /><button className="rel-link" onClick={(e) => { e.stopPropagation(); nav.push({ page: 'workspace', params: { id: w.id } }) }}>让员工配</button></div>}
                  {deploys.slice(0, 5).map((d) => {
                    const rs = releasesOf(list, w.id, d.id)
                    const last = rs[0]
                    const online = rs.find((r) => r.status === 'success')
                    const st = !last ? 'idle' : last.status === 'running' ? 'run' : last.status === 'success' ? 'ok' : 'bad'
                    return (
                      <div key={d.id} className={'rel-line ' + st} title={last ? `线上 ${online?.version ?? '—'} · 最近一次 ${last.version || '…'} ${ST[last.status].label} · ${at(last.started)}` : '还没发布过'}
                        onClick={(e) => { e.stopPropagation(); nav.push(last ? { page: 'release', params: { id: last.id } } : { page: 'workspace', params: { id: w.id } }) }}>
                        <span className="rel-line-name">{d.name}</span>
                        <span className="rel-line-ver mono" data-no-i18n="">{online?.version || '—'}</span>
                        <span className="rel-line-when">{last ? (last.status === 'running' ? '发布中…' : at(last.started)) : '还没发布过'}</span>
                      </div>
                    )
                  })}
                  {deploys.length > 5 && <div className="rel-more">{`还有 ${deploys.length - 5} 个`}</div>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="rel-h3"><h3>发布记录</h3>
          <div className="rel-filter">
            <Segmented value={tab} onChange={setTab} options={[{ value: 'all', label: '全部' }, { value: 'running', label: '进行中' }, { value: 'success', label: '成功' }, { value: 'failed', label: '失败' }]} />
            <select value={ws} onChange={(e) => setWs(e.target.value)}><option value="">全部项目</option>{wss.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          </div>
        </div>
        <HistoryTable rows={rows} nav={nav} wss={wss} />
      </div>
    </div>
  )
}

/** 发布历史表：环境、版本、状态、说明、谁、时间、耗时；点一行看详情 */
function HistoryTable({ rows, nav, wss }: { rows: LiveRelease[]; nav: Nav; wss?: Workspace[] }) {
  if (!rows.length) return <Empty>还没有发布记录</Empty>
  return (
    <div className="rel-table">
      <div className="rel-tr head"><span>{wss ? '项目 / 环境' : '环境'}</span><span>版本</span><span>状态</span><span>说明</span><span>谁</span><span>时间</span><span>耗时</span></div>
      {rows.map((r) => (
        <div key={r.id} className="rel-tr" onClick={() => nav.push({ page: 'release', params: { id: r.id } })}>
          <span className="rel-td-env">{wss && <b>{wss.find((w) => w.id === r.ws)?.name ?? '?'}</b>}<span>{r.targetName}</span></span>
          <span className="mono" data-no-i18n="">{r.version || '…'}</span>
          <span><Tag tone={ST[r.status].tone}>{ST[r.status].label}</Tag>{r.rollbackOf && <span className="rel-mini">回滚</span>}</span>
          <span className="rel-td-note" data-no-i18n="">{r.note ?? ''}</span>
          <span>{r.by}</span>
          <span className="mono">{at(r.started)}</span>
          <span className="mono right">{r.status === 'running' ? '…' : took(r)}</span>
        </div>
      ))}
    </div>
  )
}

// ======================= 一个项目的发布 =======================
// ======================= 项目页最上面的「发布」 =======================
// 2026-11-28 主人定的（docs/规范/界面.md 原则 11–14）：按端分开（Web / 安卓 / iPhone…，系统自己认，不让人填），
// 每个端一个选项卡：它的环境（线上版本、发布、回滚）、最近 3 条发布（日期、端、版本号）、它的安装包。编译、环境怎么配都交给员工，这里不摆。
type Plat = 'web' | PkgPlatform
const PLAT_ORDER: Plat[] = ['web', 'android', 'ios', 'mac', 'windows', 'linux']
const platLabel = (p: Plat) => (p === 'web' ? 'Web' : PLATS.find((x) => x.p === p)?.label ?? p)
/** 这个发布环境属于哪个端：存进安装包的看格子；编译组件是安卓的就是安卓；名字里写了的认名字；其它是 Web（发到服务器的） */
export function platformOf(w: Workspace, d?: Deploy): Plat {
  if (!d) return 'web'
  if (d.package) return d.package.platform
  const b = compOfDeploy(w, d)
  if (b?.kind === 'android') return 'android'
  const t = `${d.name} ${b?.name ?? ''}`.toLowerCase()
  if (/安卓|android|\bapk\b/.test(t)) return 'android'
  if (/iphone|ipad|\bios\b|苹果/.test(t)) return 'ios'
  if (/\bmac\b|macos/.test(t)) return 'mac'
  if (/windows|\bwin\b/.test(t)) return 'windows'
  return 'web'
}

export function ReleaseSection({ w, nav }: { w: Workspace; nav: Nav }) {
  const list = useStore((s) => s.liveReleases)
  const servers = useStore((s) => s.servers)
  const pkgs = useStore((s) => s.packages)
  const emp = useStore((s) => s.employees.find((e) => e.workspace === w.id))
  const [dlg, setDlg] = useState<{ d: Deploy; mode: 'release' | 'rollback' } | null>(null)
  const [allRows, setAllRows] = useState(false)
  const deploys = w.deploys ?? []
  // 有哪些端：有发布环境的、有安装包的
  const plats = PLAT_ORDER.filter((p) => deploys.some((d) => platformOf(w, d) === p) || pkgs.some((x) => x.ws === w.id && x.platform === p))
  const [tab, setTab] = useState<Plat | null>(null)
  const cur: Plat | undefined = tab && plats.includes(tab) ? tab : plats[0]
  const mine = deploys.filter((d) => platformOf(w, d) === cur)
  const rows = releasesOf(list, w.id).filter((r) => platformOf(w, deploys.find((d) => d.id === r.target)) === cur)
  const sv = (id: string) => servers.find((x) => x.id === id)
  // 没配发布：一句话交给员工（编译、发布怎么配是员工的活）
  const askEmp = async () => {
    if (!emp) { toast('这个项目还没有员工：先在下面「员工」里加一个'); return }
    const r = await call<{ sid: string }>('POST', `/api/employees/${emp.id}/ask`, { text: `把项目「${w.name}」的编译和发布配好：已有流水线或部署脚本就照着配，没有就自己建；试编通过、建好发布目标后告诉我。` })
    if (r) nav.openChat(emp.id)
  }
  return (
    <div className="rel-section">
      <div className="rel-h3"><h3>发布</h3>{plats.length > 0 && <span className="rel-sec-sub">{`${deploys.length} 个环境 · 分支 ${w.branch}`}</span>}</div>
      {plats.length === 0 ? (
        <div className="rel-empty">
          <span>还没有发布：编译、发到哪，交给员工配就行</span>
          <button className="btn primary sm" onClick={askEmp}>让员工配好</button>
        </div>
      ) : (
        <>
          {plats.length > 1 && (
            <div className="plat-tabs" role="tablist">
              {plats.map((p) => {
                const n = deploys.filter((d) => platformOf(w, d) === p).length
                const running = list.some((r) => r.ws === w.id && r.status === 'running' && platformOf(w, deploys.find((d) => d.id === r.target)) === p)
                return (
                  <button key={p} role="tab" aria-selected={cur === p} className={'plat-tab' + (cur === p ? ' on' : '')} onClick={() => setTab(p)}>
                    {platLabel(p)}{n > 0 && <small>{n}</small>}{running && <i className="plat-run" title="发布中" />}
                  </button>
                )
              })}
            </div>
          )}
          {mine.length > 0 && (
            <div className="rel-envs">
              {mine.map((d) => {
                const rs = releasesOf(list, w.id, d.id)
                const last = rs[0]
                const online = rs.find((r) => r.status === 'success')
                const canRollback = rs.some((r) => r.status === 'success' && r.version !== online?.version)
                const env = envLabel(d, servers)
                const running = last?.status === 'running'
                const where = d.package ? `存进安装包 · ${d.package.channel === 'prod' ? '正式' : '测试'}` : d.servers.map((id) => sv(id)?.name ?? `${id}（不在了）`).join('、')
                return (
                  <div key={d.id} className={'rel-env-card' + (env.prod ? ' prod' : '')}>
                    <div className="rel-env-head">
                      <span className={'rel-env-tag' + (env.prod ? ' prod' : '')}>{env.text}</span>
                      <b>{d.name}</b>
                      {/* 属于哪个端：卡片上直接写（主人 2026-11-28：多个时一眼分得清） */}
                      <span className={'rel-env-plat p-' + platformOf(w, d)}>{platLabel(platformOf(w, d))}</span>
                    </div>
                    <div className="rel-cur">
                      <small>{d.package ? '最新的包' : '线上版本'}</small>
                      {online ? <><span className="rel-cur-ver mono" data-no-i18n="">{online.version}</span><span className="rel-cur-sub">{`${at(online.started)} · ${online.by}`}</span></>
                        : <span className="rel-cur-none">还没发布过</span>}
                    </div>
                    {last && last.id !== online?.id && (
                      <button className="rel-last" onClick={() => nav.push({ page: 'release', params: { id: last.id } })}>
                        <small>最近一次</small><span className="mono" data-no-i18n="">{last.version || '…'}</span><Tag tone={ST[last.status].tone}>{ST[last.status].label}</Tag><span className="rel-cur-sub">{at(last.started)}</span>
                      </button>
                    )}
                    <div className="rel-env-foot">
                      <button className="btn primary sm" disabled={running} onClick={() => setDlg({ d, mode: 'release' })}>{running ? '发布中…' : '发布'}</button>
                      {!d.package && <button className="btn default sm" disabled={!canRollback || running} onClick={() => setDlg({ d, mode: 'rollback' })}>回滚</button>}
                      <span className="rel-env-where" title={AI[d.ai ?? 'ask']}>{where}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {rows.length > 0 && (
            <div className="rel-recent">
              <div className="rel-recent-head"><b>最近发布</b>{rows.length > 3 && <button className="btn ghost sm" onClick={() => setAllRows(!allRows)}>{allRows ? '收起' : `全部 ${rows.length}`}</button>}</div>
              {rows.slice(0, allRows ? 30 : 3).map((r) => (
                <button key={r.id} className="rel-rec" onClick={() => nav.push({ page: 'release', params: { id: r.id } })}>
                  <span className="rel-rec-when mono">{at(r.started)}</span>
                  <span className="rel-rec-plat">{platLabel(cur!)}</span>
                  <span className="rel-rec-env">{r.targetName}</span>
                  <span className="rel-rec-ver mono" data-no-i18n="">{r.version || '…'}</span>
                  <span className="rel-rec-st"><Tag tone={ST[r.status].tone}>{r.rollbackOf ? '回滚' : ST[r.status].label}</Tag></span>
                </button>
              ))}
            </div>
          )}
          {cur && cur !== 'web' && <PackagesSection w={w} platform={cur} />}
        </>
      )}
      {dlg && <ReleaseSheet w={w} d={dlg.d} mode={dlg.mode} servers={servers} nav={nav} onClose={() => setDlg(null)} />}
    </div>
  )
}

// ======================= 发布 / 回滚弹窗 =======================
interface Changes {
  online: { id: string; version: string; sha: string; at: number; by: string } | null
  since: boolean
  commits: { sha: string; subject: string; author: string; at: number; unfinished: boolean }[]
  rollbacks: { id: string; version: string; at: number; by: string; note: string; kept: boolean }[]
}
function ReleaseSheet({ w, d, mode, servers, nav, onClose }: { w: Workspace; d: Deploy; mode: 'release' | 'rollback'; servers: Server[]; nav: Nav; onClose: () => void }) {
  const [c, setC] = useState<Changes | null>(null)
  const [note, setNote] = useState('')
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const env = envLabel(d, servers)
  useEffect(() => {
    void call<Changes>('GET', `/api/workspaces/${w.id}/deploys/${d.id}/changes`).then((x) => {
      // 读不到（后台还是旧版本、仓库连不上）也照样能发，只是看不到提交清单
      if (!x) { setC({ online: null, since: false, commits: [], rollbacks: [] }); return }
      setC(x)
      if (mode === 'release' && x.since) setNote(x.commits.filter((m) => !m.unfinished).slice(0, 5).map((m) => m.subject).join('；').slice(0, 300))
      if (mode === 'rollback') setPick(x.rollbacks[0]?.id ?? '')
    })
  }, [w.id, d.id, mode])
  const go = async () => {
    setBusy(true)
    const r = mode === 'release'
      ? await call<{ id: string }>('POST', `/api/workspaces/${w.id}/deploys/${d.id}/run`, { note: note.trim() || undefined }, '已开始发布')
      : await call<{ id: string }>('POST', `/api/releases/${pick}/rollback`, undefined, '已开始回滚')
    setBusy(false)
    if (r) { onClose(); nav.push({ page: 'release', params: { id: r.id } }) }
  }
  const unfinished = c?.commits.filter((m) => m.unfinished).length ?? 0
  return (
    <Sheet title={`${mode === 'release' ? '发布' : '回滚'} · ${w.name} → ${d.name}`} onClose={onClose} size="lg">
      <div className="rel-dlg">
        <div className="rel-envline"><span className={'rel-env-tag' + (env.prod ? ' prod' : '')}>{env.text}</span><b>{d.name}</b><small>线上版本</small><span className="mono" data-no-i18n="">{c?.online?.version ?? (c ? '还没发布过' : '…')}</span></div>
        {!c && <p className="sub">在读…</p>}
        {c && mode === 'release' && (
          <>
            <div className="rel-dlg-label">{c.since ? `这次会带上的提交 · ${c.commits.length}` : '线上版本对不上提交，下面是远端最近的提交'}</div>
            {c.commits.length === 0 ? <p className="sub">远端最新就是线上这个版本：再发一次等于重装同一版</p> : (
              <div className="rel-commits">
                {c.commits.map((m) => (
                  <div key={m.sha} className={'rel-commit' + (m.unfinished ? ' bad' : '')}>
                    <span className="mono" data-no-i18n="">{m.sha}</span><span className="rel-commit-sub" data-no-i18n="">{m.subject}</span><span className="rel-commit-who">{m.author} · {at(m.at)}</span>
                  </div>
                ))}
              </div>
            )}
            {unfinished > 0 && <div className="banner b-warn">{`有 ${unfinished} 个提交标着「[未完成]」（员工中途停下自动提交的），确认代码能用再发`}</div>}
            <div className="rel-dlg-label">说明（可选）</div>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="这次改了什么" />
            <p className="field-hint">{compOfDeploy(w, d) ? `会先编译「${compOfDeploy(w, d)!.name}」（远端最新提交）` : '会在服务器上跑部署命令'}，发到 {d.servers.map((id) => servers.find((s) => s.id === id)?.name ?? id).join('、')}{d.health ? '，发完检查' : ''}；失败自动退回上一版。{env.prod ? '这是生产环境，会要你验证本人。' : ''}</p>
          </>
        )}
        {c && mode === 'rollback' && (
          <>
            <div className="rel-dlg-label">回滚到</div>
            {c.rollbacks.length === 0 ? <p className="sub">没有别的发成功过的版本</p> : (
              <div className="rel-rbs">
                {c.rollbacks.map((r) => (
                  <label key={r.id} className={'rel-rb' + (pick === r.id ? ' on' : '')}>
                    <input type="radio" checked={pick === r.id} onChange={() => setPick(r.id)} />
                    <span className="mono" data-no-i18n="">{r.version}</span>
                    <span className="rel-commit-who">{at(r.at)} · {r.by}{r.note ? ` · ${r.note.slice(0, 40)}` : ''}</span>
                    <Tag tone={r.kept ? 'ok' : 'mute'}>{r.kept ? '产物还在' : '已清理，会重新编'}</Tag>
                  </label>
                ))}
              </div>
            )}
            {env.prod && <p className="field-hint">这是生产环境，会要你验证本人。</p>}
          </>
        )}
        <div className="row-actions">
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button className={'btn ' + (mode === 'rollback' ? 'danger' : 'primary')} disabled={busy || !c || (mode === 'rollback' && !pick)} onClick={go}>{busy ? '在开始…' : mode === 'release' ? '开始发布' : '开始回滚'}</button>
        </div>
      </div>
    </Sheet>
  )
}

// ======================= 发布详情 =======================
export function LiveReleasePage({ params, nav }: PageProps) {
  const r = useStore((s) => s.liveReleases.find((x) => x.id === params.id))
  const w = useStore((s) => s.workspaces.find((x) => x.id === r?.ws))
  const servers = useStore((s) => s.servers)
  const [full, setFull] = useState<LiveRelease | null>(null)
  const [, tick] = useState(0)
  useEffect(() => { call<LiveRelease>('GET', `/api/releases/${params.id}`).then((x) => x && setFull(x)) }, [params.id, r?.status])
  useEffect(() => { if (r?.status !== 'running') return; const t = window.setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [r?.status])
  const x = full && r && full.status === r.status ? { ...r, tail: full.tail } : r ?? full
  if (!x) return <div className="page"><PageHeader title="发布详情" {...headNav(nav)} /><Empty>找不到</Empty></div>
  const steps = x.steps.filter((s) => s.s !== 'skipped')
  const doneN = steps.filter((s) => s.s === 'done').length
  const failed = steps.find((s) => s.s === 'failed')
  const rollback = () => {
    if (!confirm(`回滚到 ${x.version}？会在目标服务器上${x.kept ? '用这个版本留着的产物' : '按这个提交重新编译后'}重新部署`)) return
    void call<LiveRelease>('POST', `/api/releases/${x.id}/rollback`, undefined, '已开始回滚').then((n) => n && nav.push({ page: 'release', params: { id: n.id } }))
  }
  const svNames = (x.servers ?? []).map((id) => servers.find((s) => s.id === id)?.name ?? id)
  return (
    <div className="page">
      <PageHeader title="发布详情" sub={`#${x.id.slice(-6)}`} {...headNav(nav)}
        right={x.status === 'success' ? <button className="btn default sm" onClick={rollback}>回滚到这个版本</button> : undefined} />
      <div className="page-body">
        <div className="rel-head">
          <div className="rel-head-line">
            {w ? <button className="rel-link strong" onClick={() => nav.push({ page: 'workspace', params: { id: w.id } })}>{w.name}</button> : <b>?</b>}
            <span className="rel-arrow">→</span><b>{x.targetName}</b>
            <span className="rel-head-ver mono" data-no-i18n="">{x.version || '…'}</span>
            <Tag tone={ST[x.status].tone}>{ST[x.status].label}</Tag>
            {x.rollbackOf && <span className="rel-mini">回滚</span>}
          </div>
          {x.note && <p className="rel-head-note" data-no-i18n="">{x.note}</p>}
          <div className="rel-meta">
            <span>{x.by}</span><span>{at(x.started)}</span>{x.ended && <span>耗时 {took(x)}</span>}
            {svNames.length > 0 && <span>发到 {svNames.join('、')}</span>}
            {x.sha && <span className="mono" data-no-i18n="">{x.sha.slice(0, 7)}</span>}
            {x.kept !== undefined && x.status === 'success' && <span>{x.kept ? '产物留着（能回滚）' : '产物已清掉'}</span>}
          </div>
        </div>
        {x.error && <div className="rel-err"><b>{failed ? `失败在「${STEP[failed.k]}」` : '失败了'}</b><span data-no-i18n="">{x.error}</span></div>}
        <div className={'rel-run' + (x.status === 'failed' ? ' bad' : '')}>
          <div className="rel-run-head"><b>步骤</b><span className="mono">{doneN} / {steps.length}</span></div>
          <div className="rel-bar"><i className={x.status} style={{ width: `${x.status === 'success' ? 100 : Math.round((doneN / Math.max(1, steps.length)) * 100)}%` }} /></div>
          <ol className="rel-steps">
            {steps.map((s) => (
              <li key={s.k} className={s.s}>
                <span className="rel-dot">{s.s === 'done' ? <IconCheck size={9} /> : null}</span>
                <span className="rel-step-main"><b>{STEP[s.k]}</b>{s.msg && <small data-no-i18n="">{s.msg}</small>}</span>
                <span className="rel-step-t mono">{s.s === 'done' && s.t0 && s.t1 ? ms(s.t1 - s.t0) : s.s === 'running' ? `进行中 ${s.t0 ? ms(Date.now() - s.t0) : ''}` : s.s === 'failed' ? '失败' : '等待'}</span>
              </li>
            ))}
          </ol>
        </div>
        {x.tail && <><h3 className="rel-h3-plain">输出（最后一段）</h3><pre className="rel-log" data-no-i18n="">{x.tail}</pre></>}
      </div>
    </div>
  )
}
