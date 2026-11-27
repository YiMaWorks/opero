// 电脑上「会话」以外的页签：照微信电脑版，左边一栏是这个页签的目录（员工 / 项目 / 应用 / 我），右边是选中的那一页。
// 和会话页一样的三栏：左边窄栏 · 目录 340 · 内容。手机不用它（手机还是一页一页进）。
import { useState, type ReactNode } from 'react'
import type { Route, Tab } from '../types'
import { logout, togglePin, useStore } from '../store'
import { Avatar } from './Avatar'
import { IconPlus, IconSearch, TabIcon } from './icons'
import { LIVE_CONFIG } from '../pages/live'
import { DEMO_CONFIG } from '../pages/apps'
import { LIVE } from '../mode'
import { AppIcon } from './AppIcon'

interface Props {
  tab: Exclude<Tab, 'chat'>
  /** 现在右边显示的根页面（栈底） */
  active: Route
  onPick: (r: Route) => void
}

const same = (a: Route, b: Route) => a.page === b.page && (a.params?.id ?? null) === (b.params?.id ?? null)

export function SideNav({ tab, active, onPick }: Props) {
  const [q, setQ] = useState('')
  const s = useStore((x) => x)
  const match = (t: string) => !q || t.toLowerCase().includes(q.toLowerCase())

  const item = (r: Route, label: string, icon: ReactNode, extra?: ReactNode, sub?: string) => (
    <button key={r.page + (r.params?.id ?? '')} className={'side-item' + (same(r, active) ? ' on' : '')} onClick={() => onPick(r)}>
      <span className="side-icon">{icon}</span>
      <span className="side-main"><b>{label}</b>{sub && <small>{sub}</small>}</span>
      {extra && <span className="side-extra">{extra}</span>}
    </button>
  )
  const letter = (t: string) => <span className="side-letter">{t}</span>

  let title = ''
  let action: { label: string; route: Route } | null = null
  let body: ReactNode = null

  if (tab === 'people') {
    title = '员工'
    action = { label: '新建员工', route: { page: 'employeeEdit' } }
    body = (
      <>
        {item({ page: 'employees' }, '全部员工', <TabIcon tab="people" />, <em>{s.employees.length}</em>)}
        <div className="side-sep" />
        {s.employees.filter((e) => match(e.name + e.title))
          // 置顶的（和会话列表同一个置顶）排前面
          .map((e) => ({ e, ss: s.sessions.find((x) => x.employee === e.id) }))
          .sort((a, b) => Number(!!b.ss?.pinned) - Number(!!a.ss?.pinned))
          .map(({ e, ss }) => item({ page: 'employee', params: { id: e.id } }, e.name, <Avatar id={e.id} size={32} />,
            ss ? <span role="button" tabIndex={0} className={'side-pin' + (ss.pinned ? ' on' : '')} title={ss.pinned ? '取消置顶' : '置顶'} onClick={(ev) => { ev.stopPropagation(); togglePin(ss.id) }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill={ss.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5M9 3h6l-1 6 4 3v2H6v-2l4-3z" /></svg>
            </span> : undefined, e.title))}
      </>
    )
  } else if (tab === 'workspace') {
    title = '项目'
    action = { label: '接入仓库', route: { page: 'workspaceAdd' } }
    const open = LIVE ? s.liveIssues.filter((i) => i.status === 'new' || i.status === 'fixing').length : s.issues.filter((i) => i.status === 'new' || i.status === 'watching' || i.status === 'fixing').length
    body = (
      <>
        {item({ page: 'workspaces' }, '全部项目', <TabIcon tab="workspace" />, <em>{s.workspaces.length}</em>)}
        {item({ page: 'issues' }, '问题清单', <AppIcon page="issues" size={21} plain />, open ? <em className="hot" title="没处理的线上问题：点进去每个点「修复 / 已知 / 忽略 7 天」，数字就减">{open}</em> : undefined)}
        <div className="side-sep" />
        {s.workspaces.filter((w) => match(w.name + w.repo)).map((w) =>
          item({ page: 'workspace', params: { id: w.id } }, w.name, letter(w.name.slice(0, 1).toUpperCase()), LIVE && s.liveReleases.some((r) => r.ws === w.id && r.status === 'running') ? <em className="hot">发布中</em> : undefined, `${w.branch} · ${w.last}`))}
      </>
    )
  } else if (tab === 'apps') {
    title = '应用'
    action = LIVE ? null : { label: '定制和二开', route: { page: 'customize' } }
    const list: [Route['page'], string, string, string][] = LIVE ? [
      ['servers', '服务器和 Agent', '服', `${s.servers.length}`],
      ['credentials', '凭证', '凭', `${s.credentials.length}`],
      ['data', '数据', '数', `${s.dataSources.length}`],
      ['triggers', '触发器', '触', `${s.triggers.filter((t) => t.enabled).length}`],
      ['knowledge', '知识库', '知', `${s.kb.length}`],
      ['domains', '域名', '域', ''],
      ['inbox', '收件箱', '收', ''],
      ['channels', '消息渠道', '渠', ''],
      ['audit', '操作记录', '记', ''],
    ] : [
      ['servers', '服务器和电脑', '服', `${s.servers.length}`],
      ['releases', '发布', '发', `${s.apps.length}`],
      ['credentials', '凭证', '凭', `${s.credentials.length}`],
      ['channels', '消息渠道', '信', `${s.channels.filter((c) => c.inbound).length}`],
      ['inbox', '收件箱', '收', ''],
      ['knowledge', '知识库', '知', `${s.kb.length}`],
      ['flows', '流程', '流', `${s.flows.length}`],
      ['data', '数据', '数', `${s.dataSources.length}`],
      ['triggers', '触发器', '触', `${s.triggers.filter((t) => t.enabled).length}`],
      ['plugins', '插件', '插', `${s.plugins.length}`],
      ['audit', '操作记录', '记', ''],
    ]
    body = (
      <>
        {item({ page: 'apps' }, '全部应用', <TabIcon tab="apps" />)}
        <div className="side-sep" />
        {list.filter(([, n]) => match(n)).map(([page, name, l, n]) => item({ page }, name, <AppIcon page={String(page)} size={21} plain fallback={l} />, n ? <em>{n}</em> : undefined))}
        <div className="side-sep" />
        {(LIVE ? LIVE_CONFIG : DEMO_CONFIG).filter((a) => match(a.name)).map((a) => item({ page: a.page }, a.name, <AppIcon page={a.page} size={21} plain fallback={a.name.slice(0, 1)} />, undefined, a.desc))}
      </>
    )
  } else {
    title = '我'
    const list: [Route['page'], string, string, string][] = [
      ['meEdit', '编辑资料', '资', '头像、签名、封面'],
      ['habits', '我的习惯', '习', '所有员工都遵守'],
      ['settings', '外观和通知', '观', '风格、语言、推送什么'],
      ['security', '账号安全', '安', LIVE ? '改密码、通行密钥、设备' : '通行密钥、手机'],
    ]
    body = (
      <>
        <button className={'side-me' + (active.page === 'me' ? ' on' : '')} onClick={() => onPick({ page: 'me' })}>
          <Avatar id="me" size={44} />
          <span className="side-main"><b>{s.me.name}</b><small>一人一套 · 只有你一个账号</small></span>
        </button>
        <div className="side-sep" />
        {list.filter(([, n]) => match(n)).map(([page, name, l, sub]) => item({ page }, name, letter(l), undefined, sub))}
      </>
    )
  }

  return (
    <section className="side">
      <div className="side-head">
        <label className="side-search"><IconSearch /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`搜索${title}`} /></label>
      </div>
      {action && (
        <button className="side-action" onClick={() => onPick(action!.route)}><IconPlus />{action.label}</button>
      )}
      <div className="side-body">{body}</div>
      {tab === 'me' && <button className="side-foot" onClick={() => logout()}>退出登录</button>}
    </section>
  )
}
