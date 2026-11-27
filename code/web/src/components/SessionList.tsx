// 会话列表：像微信。置顶的在最上面（底色稍深，多了能折叠），其余按最近时间排；
// 要你处理的不单列一块，只在预览前面加红字「[要你确认]」+ 未读。长按（电脑右键）：置顶 / 免打扰。
import { useRef, useState } from 'react'
import type { Session } from '../types'
import { badgeOf, empName, useStore } from '../store'
import { Avatar } from './Avatar'
import { Wordmark } from './brand'
import { IconBellOff, IconChevron, IconPalette, IconPlus, IconSearch } from './icons'
import { EmpName } from './EmpName'

interface Props {
  sessions: Session[]
  current: string | null
  mobile: boolean
  onOpen: (id: string) => void
  onPin: (id: string) => void
  onMute: (id: string) => void
  onSearch: () => void
  onNew: () => void
  onTheme: () => void
}

const FOLD_AT = 4 // 置顶超过这么多个就可以折叠

export function SessionList({ sessions, current, mobile, onOpen, onPin, onMute, onSearch, onNew, onTheme }: Props) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [folded, setFolded] = useState(false)
  const sorted = [...sessions].sort((a, b) => b.ts - a.ts)
  const pinned = sorted.filter((s) => s.pinned)
  const rest = sorted.filter((s) => !s.pinned)
  const canFold = pinned.length >= FOLD_AT

  const openMenu = (id: string, x: number, y: number) => setMenu({ id, x, y })
  const menuSession = menu ? sessions.find((s) => s.id === menu.id) : null
  const employees = useStore((st) => st.employees)
  const menuMuted = menuSession ? employees.find((x) => x.id === menuSession.employee)?.notify === 'none' : false

  return (
    <section className="slist">
      {mobile ? (
        <header className="slist-head m">
          <span className="head-side"><button className="icon-btn" aria-label="换风格" onClick={onTheme}><IconPalette /></button></span>
          <span className="head-title"><Wordmark size={22} live onWaiting={() => { const w = sessions.find((x) => x.waiting); if (w) onOpen(w.id) }} /></span>
          <span className="head-side right">
            <button className="icon-btn" aria-label="搜索" onClick={onSearch}><IconSearch /></button>
            <button className="icon-btn" aria-label="找员工聊" onClick={onNew}><IconPlus /></button>
          </span>
        </header>
      ) : (
        <header className="slist-head">
          <button className="search" onClick={onSearch}><IconSearch /><span>搜索员工、聊天记录、项目</span></button>
          <button className="icon-btn boxed" aria-label="找员工聊" onClick={onNew}><IconPlus /></button>
        </header>
      )}

      <div className="slist-body">
        {canFold && (
          <button className="fold-row" onClick={() => setFolded(!folded)}>
            <span>{pinned.length} 个置顶聊天</span>
            <span className={'fold-arrow' + (folded ? '' : ' open')}><IconChevron /></span>
          </button>
        )}
        {!(canFold && folded) && pinned.map((s) => (
          <Item key={s.id} s={s} mobile={mobile} active={s.id === current} onOpen={onOpen} onMenu={openMenu} onPin={onPin} />
        ))}
        {rest.map((s) => <Item key={s.id} s={s} mobile={mobile} active={s.id === current} onOpen={onOpen} onMenu={openMenu} onPin={onPin} />)}
      </div>

      {menu && menuSession && (
        <div className="ctx-mask" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }}>
          <div className={'ctx' + (mobile ? ' sheet-like' : '')} style={mobile ? undefined : { left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}>
            {mobile && <div className="ctx-title">{empName(menuSession.employee)}</div>}
            <button onClick={() => { onPin(menu.id); setMenu(null) }}>{menuSession.pinned ? '取消置顶' : '置顶聊天'}</button>
            <button onClick={() => { onMute(menu.id); setMenu(null) }}>{menuMuted ? '取消免打扰' : '消息免打扰'}</button>
            {mobile && <button className="ctx-cancel" onClick={() => setMenu(null)}>取消</button>}
          </div>
        </div>
      )}
    </section>
  )
}

function Item({ s, mobile, active, onOpen, onMenu, onPin }: {
  s: Session; mobile: boolean; active: boolean; onOpen: (id: string) => void; onMenu: (id: string, x: number, y: number) => void; onPin: (id: string) => void
}) {
  const e = useStore((st) => st.employees.find((x) => x.id === s.employee))
  const press = useRef<number | null>(null)
  const long = useRef(false)

  // 长按 0.5 秒 = 打开菜单（手机）；右键同理（电脑）
  // 手机左滑 = 打开「置顶 / 免打扰」（和微信一样）
  const sx = useRef<number | null>(null)
  const start = (x: number, y: number) => {
    sx.current = x
    long.current = false
    press.current = window.setTimeout(() => { long.current = true; onMenu(s.id, x, y) }, 500)
  }
  const cancel = () => { if (press.current) { clearTimeout(press.current); press.current = null } }

  if (!e) return null
  const badge = badgeOf(s, e)
  return (
    <div role="button" tabIndex={0}
      className={'sitem' + (s.pinned ? ' pinned' : '') + (active ? ' active' : '')}
      onClick={() => { if (!long.current) onOpen(s.id) }}
      onKeyDown={(ev) => ev.key === 'Enter' && onOpen(s.id)}
      onContextMenu={(ev) => { ev.preventDefault(); cancel(); onMenu(s.id, ev.clientX, ev.clientY) }}
      onTouchStart={(ev) => start(ev.touches[0].clientX, ev.touches[0].clientY)}
      onTouchEnd={cancel}
      onTouchMove={(ev) => { cancel(); const x = ev.touches[0].clientX; if (sx.current !== null && sx.current - x > 60) { sx.current = null; long.current = true; onMenu(s.id, x, ev.touches[0].clientY) } }}
    >
      <span className="sitem-av">
        <Avatar id={e.id} size={mobile ? 48 : 44} />
        {badge === 'red' && <i className="badge" title={s.waiting ? '有事等你决定：点开聊天，最上面那条提示里「去看」或「以后再说」，红点就消' : '新消息：点开看了就消'}>{Math.max(1, s.unread ?? 0) > 99 ? '99+' : Math.max(1, s.unread ?? 0)}</i>}
        {badge === 'grey' && !s.working && <i className="grey-dot" />}
        {s.working && <i className="s-dot run" />}
      </span>
      <span className="sitem-main">
        <span className="sitem-top">
          <b><EmpName e={e} /></b>
          <time>{s.time}</time>
        </span>
        <span className="sitem-bottom">
          <span className={'sitem-last' + (s.working ? ' run' : '')}>
            {/* 要你决定的放最前面，员工在干活（比如正等你确认）也不能被盖住 */}
            {s.waiting && <em className="pfx-warn">[{s.waiting}]</em>}
            {s.working ? <><i className="pulse" />{s.working}</> : s.last}
          </span>
          {e.notify === 'none' && <span className="muted-icon"><IconBellOff /></span>}
        </span>
      </span>
      {!mobile && (
        <button type="button" className={'sitem-pin' + (s.pinned ? ' on' : '')} title={s.pinned ? '取消置顶' : '置顶'} onClick={(ev) => { ev.stopPropagation(); onPin(s.id) }}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill={s.pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5M9 3h6l-1 6 4 3v2H6v-2l4-3z" /></svg>
        </button>
      )}
    </div>
  )
}
