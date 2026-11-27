// 「···」聊天信息：谁（点进员工资料）· 常用四个 · 这个 work（执行器、模型、思考、审核直接摊开 + 上下文）· 不常用的。
// 和员工资料、聊天设置一样从右边滑出来（电脑：聊天右侧面板；手机：整页滑进来），交互统一。一块一张卡片，统一留边。
import type { PageProps } from '../pages/nav'
import { headNav } from '../pages/nav'
import { compactContext, newTopic, restartWork, saveFlowFromChat, switchWork, toggleMute, togglePin, useStore } from '../store'
import { LIVE } from '../mode'
import { EditableAvatar } from './AvatarPicker'
import { WorkSettings } from './WorkSheet'
import { Empty, PageHeader } from './ui'
import { IconBell, IconBellOff, IconChevron, IconFlow, IconPin, IconRefresh, IconSearch, IconSliders } from './icons'
import { EmpName } from './EmpName'

export function ChatInfoPage({ params, nav }: PageProps) {
  const session = useStore((s) => s.sessions.find((x) => x.id === params.sid))
  const emp = useStore((s) => s.employees.find((x) => x.id === session?.employee))
  if (!session || !emp) return <div className="page"><PageHeader title="聊天信息" {...headNav(nav)} /><Empty>这个会话不在了</Empty></div>
  const onSearch = typeof params.onSearch === 'function' ? (params.onSearch as () => void) : undefined
  const ctx = emp.contextUsed ?? 0
  const hot = ctx >= 80
  const muted = emp.notify === 'none'
  return (
    <div className="page">
      <PageHeader title="聊天信息" {...headNav(nav)} />
      <div className="page-body ci">
        <div className="ci-card ci-who">
          <EditableAvatar id={emp.id} size={48} />
          <button className="ci-who-link" onClick={() => nav.push({ page: 'profile', params: { id: emp.id } })}>
            <span className="ci-who-main"><b><EmpName e={emp} /></b><span>{emp.title}</span></span>
            <span className="ci-who-go">员工资料<IconChevron /></span>
          </button>
        </div>

        <div className="ci-acts">
          {onSearch && <button onClick={onSearch}><IconSearch /><span>搜索记录</span></button>}
          <button className={session.pinned ? 'on' : ''} onClick={() => togglePin(session.id)}><IconPin /><span>{session.pinned ? '已置顶' : '置顶'}</span></button>
          <button className={muted ? 'on' : ''} onClick={() => toggleMute(session.id)}>{muted ? <IconBellOff /> : <IconBell />}<span>{muted ? '已免打扰' : '免打扰'}</span></button>
          <button onClick={() => nav.push({ page: 'chatSettings', params: { id: emp.id } })}><IconSliders /><span>聊天设置</span></button>
        </div>

        <section className="ci-card">
          <div className="ci-head"><b>这个 work</b><span>{`第 ${emp.works?.[0]?.no ?? 1} 个 · ${emp.executor}`}</span></div>
          <WorkSettings emp={emp} />
          <div className={'ci-ctx' + (hot ? ' hot' : '')}>
            <span>上下文</span>
            <i className="ci-bar"><b style={{ width: `${Math.max(2, Math.min(100, ctx))}%` }} /></i>
            <span className="ci-pct">{ctx}%</span>
          </div>
          <div className="ci-ctx-acts">
            <button className="btn default sm" onClick={() => compactContext(session.id, emp.id)}>压缩</button>
            <button className="btn default sm" onClick={() => newTopic(session.id, emp.id)}>新话题</button>
            <button className={'btn sm ' + (hot ? 'primary' : 'default')} onClick={() => switchWork(session.id, emp.id, '你让换的')}>{LIVE ? '开新会话接着做' : '换一个 work'}</button>
          </div>
        </section>

        <section className="ci-card ci-list">
          <button onClick={() => saveFlowFromChat(emp.id)}><IconFlow /><span><b>把刚才做的存成流程</b><small>下次点一下就跑，不经过 AI</small></span><IconChevron /></button>
          <button onClick={() => restartWork(session.id)}><IconRefresh /><span><b>重启 work</b><small>卡住时用，会话和记忆都在</small></span><IconChevron /></button>
        </section>
      </div>
    </div>
  )
}
