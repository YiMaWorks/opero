// 「···」聊天信息：照微信分组——谁（点进员工资料）· 常用四个 · 这个 work（执行器、模型、思考、审核直接摊开）· 不常用的。
// 和员工资料、聊天设置一样从右边滑出来（电脑：聊天右侧面板；手机：整页滑进来），交互统一。
import type { PageProps } from '../pages/nav'
import { headNav } from '../pages/nav'
import { compactContext, newTopic, restartWork, saveFlowFromChat, switchWork, toggleMute, togglePin, useStore } from '../store'
import { LIVE } from '../mode'
import { Avatar } from './Avatar'
import { WorkSettings } from './WorkSheet'
import { Empty, PageHeader } from './ui'
import { IconBell, IconBellOff, IconChevron, IconFlow, IconPin, IconRefresh, IconSearch, IconSliders } from './icons'

export function ChatInfoPage({ params, nav }: PageProps) {
  const session = useStore((s) => s.sessions.find((x) => x.id === params.sid))
  const emp = useStore((s) => s.employees.find((x) => x.id === session?.employee))
  if (!session || !emp) return <div className="page"><PageHeader title="聊天信息" {...headNav(nav)} /><Empty>这个会话不在了</Empty></div>
  const onSearch = typeof params.onSearch === 'function' ? (params.onSearch as () => void) : undefined
  return (
    <div className="page">
      <PageHeader title="聊天信息" {...headNav(nav)} />
      <div className="page-body">
        <div className="more">
          <button className="more-who" onClick={() => nav.push({ page: 'profile', params: { id: emp.id } })}>
            <Avatar id={emp.id} size={48} />
            <span className="more-who-main"><b>{emp.name}</b><span>{emp.title}</span></span>
            <span className="row-chev"><IconChevron /></span>
          </button>
          <div className="more-grid">
            {onSearch && <button onClick={onSearch}><span><IconSearch /></span>搜索记录</button>}
            <button className={session.pinned ? 'on' : ''} onClick={() => togglePin(session.id)}><span><IconPin /></span>{session.pinned ? '已置顶' : '置顶'}</button>
            <button className={emp.notify === 'none' ? 'on' : ''} onClick={() => toggleMute(session.id)}><span>{emp.notify === 'none' ? <IconBellOff /> : <IconBell />}</span>{emp.notify === 'none' ? '已免打扰' : '免打扰'}</button>
            <button onClick={() => nav.push({ page: 'chatSettings', params: { id: emp.id } })}><span><IconSliders /></span>聊天设置</button>
          </div>
          <div className="more-box">
            <span className="more-box-title">这个 work</span>
            <WorkSettings emp={emp} />
            <div className="more-ctx">
              <div className="meter-bar"><i className={(emp.contextUsed ?? 0) >= 80 ? 'm-warn' : 'm-ok'} style={{ width: `${Math.max(2, emp.contextUsed ?? 0)}%` }} /></div>
              <span>上下文 {emp.contextUsed ?? 0}%</span>
            </div>
            <div className="more-acts">
              <button onClick={() => compactContext(session.id, emp.id)}>压缩</button>
              <button onClick={() => newTopic(session.id, emp.id)}>新话题</button>
              <button className="hot" onClick={() => switchWork(session.id, emp.id, '你让换的')}>{LIVE ? '开新会话接着做' : '换一个 work'}</button>
            </div>
          </div>
          <div className="more-list">
            <button onClick={() => saveFlowFromChat(emp.id)}><IconFlow /><span>把刚才做的存成流程<small>下次点一下就跑，不经过 AI</small></span></button>
            <button onClick={() => restartWork(session.id)}><IconRefresh /><span>重启 work<small>卡住时用，会话和记忆都在</small></span></button>
          </div>
        </div>
      </div>
    </div>
  )
}
