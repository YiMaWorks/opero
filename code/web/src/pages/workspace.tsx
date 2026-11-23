// 工作空间（项目）：列表 · 详情（员工、分支、提交、问题、文档、预览）· 接入仓库 · 问题清单 / 问题详情
import { useState } from 'react'
import type { Issue, IssueStatus, Workspace } from '../types'
import { addWorkspace, empName, setIssueStatus, toast, useStore } from '../store'
import { Avatar } from '../components/Avatar'
import { Empty, Field, PageHeader, Row, Section, Segmented, Stat, Tag } from '../components/ui'
import { IconPlus } from '../components/icons'
import { headNav, type PageProps } from './nav'

export const ISSUE_STATUS: Record<IssueStatus, { label: string; tone: 'danger' | 'warn' | 'info' | 'ok' | 'mute' }> = {
  new: { label: '新问题', tone: 'danger' },
  watching: { label: '盯着', tone: 'warn' },
  fixing: { label: '修复中', tone: 'info' },
  fixed: { label: '已修复', tone: 'ok' },
  ignored: { label: '忽略', tone: 'mute' },
}

const branchTone = (s: string) => (s === '已合并' || s === '检查通过' ? 'ok' : s === '检查中' ? 'info' : s === '预览中' ? 'primary' : 'mute')

export function WorkspacesPage({ nav }: PageProps) {
  const list = useStore((s) => s.workspaces)
  const issues = useStore((s) => s.issues)
  return (
    <div className="page">
      <PageHeader title="工作空间" sub="员工干活的项目（git 仓库 + 服务器上的目录）" {...headNav(nav)}
        right={<button className="btn primary sm" onClick={() => nav.push({ page: 'workspaceAdd' })}><IconPlus /> 接入</button>} />
      <div className="page-body">
        <Section flush>
          {list.map((w) => {
            const open = issues.filter((i) => i.project === w.id && (i.status === 'new' || i.status === 'fixing')).length
            return (
              <Row key={w.id} icon={<span className="ws-icon">{w.name.slice(0, 1).toUpperCase()}</span>} chevron
                onClick={() => nav.push({ page: 'workspace', params: { id: w.id } })}
                title={<>{w.name} <Tag>{w.branch}</Tag> {open > 0 && <Tag tone="danger">{open} 个问题</Tag>}</>}
                sub={`${w.provider} · ${w.repo} · ${w.host}`} />
            )
          })}
        </Section>
        <Section title="问题清单">
          <Row title="所有项目的问题" sub="日志扫描发现 → 员工查 → 修 → 发布 → 关闭" chevron onClick={() => nav.push({ page: 'issues' })} />
        </Section>
      </div>
    </div>
  )
}

export function WorkspacePage({ params, nav }: PageProps) {
  const w = useStore((s) => s.workspaces.find((x) => x.id === params.id))
  const allIssues = useStore((s) => s.issues)
  if (!w) return <div className="page"><PageHeader title="工作空间" {...headNav(nav)} /><Empty>这个员工用的是它自己的仓库（只放记忆），没有业务代码。</Empty></div>
  const issues = allIssues.filter((i) => i.project === w.id)
  return (
    <div className="page">
      <PageHeader title={w.name} sub={`${w.provider} · ${w.repo}`} {...headNav(nav)} />
      <div className="page-body">
        <div className="stats">
          <Stat label="分支" value={w.branches.length} />
          <Stat label="待处理问题" value={issues.filter((i) => i.status === 'new' || i.status === 'fixing').length} />
          <Stat label="员工" value={w.employees.length} />
        </div>
        {w.preview && (
          <Section title="预览">
            <Row title={w.preview} sub="改完自动起的预览实例（测试库），用完自动回收" right={<button className="btn default sm" onClick={() => toast('原型：正式版在新窗口打开预览')}>打开</button>} />
          </Section>
        )}
        <Section title="在这里干活的员工">
          {w.employees.map((id) => (
            <Row key={id} icon={<Avatar id={id} size={36} />} title={empName(id)} chevron onClick={() => nav.openChat(id)} />
          ))}
        </Section>
        <Section title="分支" right={<span className="sub">改代码在工作分支上，检查通过自动合并</span>}>
          {w.branches.map((b) => (
            <Row key={b.name} title={<span className="mono">{b.name}</span>} sub={b.checks} right={<Tag tone={branchTone(b.status)}>{b.status}</Tag>} />
          ))}
        </Section>
        <Section title="最近提交">
          {w.commits.map((c) => (
            <Row key={c.sha} title={c.msg} sub={<><span className="mono">{c.sha}</span> · {c.who} · {c.when}</>} />
          ))}
        </Section>
        <Section title={`问题 · ${issues.length}`}>
          {issues.length === 0 && <Empty>没有问题</Empty>}
          {issues.map((i) => <IssueRow key={i.id} i={i} onClick={() => nav.push({ page: 'issue', params: { id: i.id } })} />)}
        </Section>
        <Section title="文档">
          {w.docs.map((d) => (
            <Row key={d.name} title={<span className="mono">{d.name}</span>} sub={`更新于 ${d.updated}`} chevron onClick={() => toast('原型：正式版在面板里打开文档')} />
          ))}
        </Section>
        <Section title="位置">
          <Row title="服务器" right={w.host} />
          <Row title="目录" right={<span className="mono">{w.dir}</span>} />
          <Row title="主分支" right={<span className="mono">{w.branch}</span>} />
        </Section>
      </div>
    </div>
  )
}

export function WorkspaceAddPage({ nav }: PageProps) {
  const servers = useStore((s) => s.servers)
  const [provider, setProvider] = useState<Workspace['provider']>('Codeup')
  const [url, setUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [host, setHost] = useState(servers[0]?.name ?? '')
  const name = url.replace(/\.git$/, '').split('/').filter(Boolean).pop() ?? ''
  const save = () => {
    if (!name) { toast('先填仓库地址'); return }
    addWorkspace({ id: name, name, provider, repo: url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, ''), branch, host,
      dir: `/home/dev/work/${name}`, last: '刚接入，正在拉代码', employees: [], branches: [{ name: branch, status: '主分支' }], commits: [], docs: [] })
    nav.back()
  }
  return (
    <div className="page">
      <PageHeader title="接入仓库" {...headNav(nav)} right={<button className="btn primary sm" onClick={save}>接入</button>} />
      <div className="page-body form">
        <Field label="代码托管">
          <Segmented value={provider} options={[{ value: 'Codeup', label: 'Codeup' }, { value: 'GitHub', label: 'GitHub' }, { value: 'Gitea', label: 'Gitea' }]} onChange={setProvider} />
        </Field>
        <Field label="仓库地址" hint="用你带进来的「Codeup 个人令牌」拉代码：你能看的仓库员工就能看；没有就先去「权限和凭证」带进来">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://codeup.aliyun.com/xxx/AI/my-app.git" />
        </Field>
        <Field label="主分支"><input value={branch} onChange={(e) => setBranch(e.target.value)} /></Field>
        <Field label="拉到哪台服务器">
          <select value={host} onChange={(e) => setHost(e.target.value)}>
            {servers.map((s) => <option key={s.id} value={s.name}>{s.name}（{s.env}）</option>)}
          </select>
        </Field>
        {name && <p className="hint">会拉到 <span className="mono">{host}:/home/dev/work/{name}</span>，然后可以给它配员工。</p>}
      </div>
    </div>
  )
}

function IssueRow({ i, onClick }: { i: Issue; onClick: () => void }) {
  const st = ISSUE_STATUS[i.status]
  return (
    <Row title={<>#{i.id} {i.title} {i.severity === '严重' && <Tag tone="danger">严重</Tag>}</>} sub={`${i.project} · ${i.count} 次 · 最近 ${i.last}`}
      right={<Tag tone={st.tone}>{st.label}</Tag>} chevron onClick={onClick} />
  )
}

type IssueFilter = 'open' | 'fixed' | 'all'
export function IssuesPage({ params, nav }: PageProps) {
  const all = useStore((s) => s.issues)
  const [f, setF] = useState<IssueFilter>('open')
  const list = all.filter((i) => (params.project ? i.project === params.project || i.project.startsWith(params.project) : true))
    .filter((i) => (f === 'all' ? true : f === 'fixed' ? i.status === 'fixed' || i.status === 'ignored' : i.status !== 'fixed' && i.status !== 'ignored'))
  return (
    <div className="page">
      <PageHeader title="问题清单" sub={params.project ? `${params.project} 相关` : '所有项目'} {...headNav(nav)} />
      <div className="page-body">
        <div className="pad"><Segmented value={f} onChange={setF} options={[{ value: 'open', label: '没解决' }, { value: 'fixed', label: '已解决' }, { value: 'all', label: '全部' }]} /></div>
        <Section flush>
          {list.length === 0 && <Empty>没有</Empty>}
          {list.map((i) => <IssueRow key={i.id} i={i} onClick={() => nav.push({ page: 'issue', params: { id: i.id } })} />)}
        </Section>
        <p className="hint">同一个原因只算一条。「盯着 / 忽略」只有人能定，员工不会改掉你的决定。</p>
      </div>
    </div>
  )
}

export function IssuePage({ params, nav }: PageProps) {
  const i = useStore((s) => s.issues.find((x) => x.id === Number(params.id)))
  if (!i) return <div className="page"><PageHeader title="问题" {...headNav(nav)} /><Empty>找不到</Empty></div>
  const st = ISSUE_STATUS[i.status]
  return (
    <div className="page">
      <PageHeader title={`#${i.id} ${i.title}`} sub={i.project} {...headNav(nav)} />
      <div className="page-body">
        <div className="pad chips"><Tag tone={st.tone}>{st.label}</Tag><Tag tone={i.severity === '严重' ? 'danger' : 'mute'}>{i.severity}</Tag></div>
        <Section title="情况">
          <Row title="次数" right={`${i.count} 次`} />
          <Row title="第一次" right={i.first} />
          <Row title="最近" right={i.last} />
          <Row title="原因" sub={i.cause ?? '还在查'} />
          <Row title="负责" icon={<Avatar id={i.owner} size={30} />} right={empName(i.owner)} />
        </Section>
        <div className="pad row-actions wrap">
          <button className="btn primary" onClick={() => nav.openChat(i.owner)}>去会话</button>
          {i.status !== 'watching' && <button className="btn default" onClick={() => { setIssueStatus(i.id, 'watching'); toast('先盯着') }}>先盯着</button>}
          {i.status !== 'ignored' && <button className="btn default" onClick={() => { setIssueStatus(i.id, 'ignored'); toast('已忽略，同类异常不再提醒') }}>忽略</button>}
          {(i.status === 'fixed' || i.status === 'ignored') && <button className="btn ghost" onClick={() => setIssueStatus(i.id, 'new')}>重新打开</button>}
        </div>
      </div>
    </div>
  )
}
