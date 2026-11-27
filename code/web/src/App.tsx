import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Card, CardAction, Route, Tab } from './types'
import {
  append, audit, badgeOf, empName, getState, later, markRead, now, patchCard, patchSession, promotePreview, requireVerify, revertMerge, runFixDemo,
  saveQuery, sessionFor, set, setIssueStatus, toast, toggleMute, togglePin, uid, useStore,
} from './store'
import { Mark, Splash } from './components/brand'
import { SessionList } from './components/SessionList'
import { Chat } from './components/Chat'
import { ThemeQuick } from './components/ThemeQuick'
import { SideNav } from './components/SideNav'
import { ImageEditHost } from './components/ImageEditor'
import { NewChatSheet, ReplySuggestSheet, SearchOverlay, Toast, VerifyModal } from './components/overlays'
import { IconGlobe, IconPalette, TabIcon } from './components/icons'
import { LangSheet } from './components/LangPicker'
import { PageView } from './pages'
import { menuRoute } from './menus'
import { LoginPage, Onboarding } from './pages/auth'
import type { Nav } from './pages/nav'
import { ErrorBoundary } from './components/ErrorBoundary'
import { nativeBadge, nativeRoute, nativeTheme, onNativeOpen } from './native'
import { applyTheme, resolveTheme, themeVars } from './themes'
import { LIVE } from './mode'
import { cardAction } from './live'
import { LiveLogin, LiveSetup } from './pages/live'
import { fromHash, toHash } from './router'
import { EMBED, EmbedView } from './components/Embed'

function useMobile() {
  const q = '(max-width: 860px)'
  const [m, setM] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const fn = () => setM(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return m
}

const TABS: { tab: Tab; label: string; desktopOnly?: boolean }[] = [
  { tab: 'chat', label: '会话' },
  { tab: 'people', label: '员工' },
  { tab: 'workspace', label: '项目' },
  { tab: 'apps', label: '应用' },
  { tab: 'me', label: '我' },
]

// 每个页签一摞页面（会话页签是「会话列表 → 聊天」，单独管）
const ROOTS: Record<Tab, Route[]> = {
  chat: [],
  people: [{ page: 'employees' }],
  workspace: [{ page: 'workspaces' }],
  apps: [{ page: 'apps' }],
  me: [{ page: 'me' }],
}

export default function App() {
  const mobile = useMobile()
  const authState = useStore((s) => s.auth)
  const sessions = useStore((s) => s.sessions)
  const verify = useStore((s) => s.verify)
  const [splash, setSplash] = useState(!EMBED) // 嵌在 App 里的单页不播开屏
  const hideSplash = useCallback(() => setSplash(false), [])
  // 刷新 / 重载后回到网址里记的那页（router.ts）
  const [start] = useState(() => fromHash(location.hash))
  const [tab, setTab] = useState<Tab>(start?.tab ?? 'chat')
  const [stacks, setStacks] = useState<Record<Tab, Route[]>>(() => {
    if (!start || start.tab === 'chat' || !start.stack.length) return ROOTS
    const root = ROOTS[start.tab][0]
    // 手机上每个页签最底下是根页（返回回到它）；电脑上左边菜单选的那页就是底
    const st = mobile && start.stack[0].page !== root.page ? [root, ...start.stack] : start.stack
    return { ...ROOTS, [start.tab]: st }
  })
  const [current, setCurrent] = useState<string | null>(start?.session ?? null)
  const [panel, setPanel] = useState<Route[] | null>(start?.panel ?? null)
  const [search, setSearch] = useState(false)
  const [newChat, setNewChat] = useState(false)
  const [themeSheet, setThemeSheet] = useState(false)
  const [langSheet, setLangSheet] = useState(false)
  const [suggest, setSuggest] = useState<{ title: string; ch: string; original?: string } | null>(null)

  // 风格：跟随系统（浅色 / 深色各用一套）/ 固定一套 / 自己挑的三个颜色（themes.ts）
  const themePrefs = useStore((s) => s.settings)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const t = resolveTheme(themePrefs, mq.matches)
      applyTheme(t)
      const v = themeVars(t)
      nativeTheme(t.mode === 'dark', v['--bg-solid'], v['--panel-solid'])
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [themePrefs.theme, themePrefs.themeLight, themePrefs.themeDark, themePrefs.customTheme])

  // 电脑上默认打开一个会话；手机上停在列表
  useEffect(() => {
    if (!mobile && !current && sessions.length) setCurrent(sessions.find((s) => s.id === 's-shop-log')?.id ?? sessions[0].id)
  }, [mobile, current, sessions])

  // 开着的会话被归档了（开新会话接着做 / 换执行器）：跳到这个员工的新会话
  const curEmp = useRef<string | null>(null)
  useEffect(() => {
    const s = sessions.find((x) => x.id === current)
    if (s) { curEmp.current = s.employee; return }
    const n = current && curEmp.current ? sessions.find((x) => x.employee === curEmp.current) : undefined
    if (n) setCurrent(n.id)
    else if (current && !curEmp.current && sessions.length) setCurrent(null) // 网址里的会话已经没了
  }, [current, sessions])

  const stack = stacks[tab]
  const pushTab = (r: Route) => setStacks((st) => ({ ...st, [tab]: [...st[tab], r] }))
  const popTab = () => setStacks((st) => ({ ...st, [tab]: st[tab].length > 1 ? st[tab].slice(0, -1) : st[tab] }))
  const switchTab = (t: Tab) => { setTab(t); setPanel(null); if (mobile && t !== 'chat') setCurrent(null) }

  const openSession = (sid: string) => {
    markRead(sid)
    setCurrent(sid)
    setTab('chat')
    setPanel(null)
  }
  const openChat = (empId: string) => {
    setSearch(false)
    setNewChat(false)
    openSession(sessionFor(empId))
  }

  const tabNav: Nav = { push: pushTab, back: popTab, canBack: stack.length > 1, openChat, mobile }
  const panelNav: Nav = {
    push: (r) => setPanel((p) => (p ? [...p, r] : [r])),
    back: () => setPanel((p) => (p && p.length > 1 ? p.slice(0, -1) : null)),
    canBack: (panel?.length ?? 0) > 1,
    close: () => setPanel(null),
    openChat,
    mobile,
  }

  // 消息助理的草稿都处理完了，就不再显示「要你回」
  const clearIfDone = (sid: string) => later(50, () => {
    const left = (getState().messages[sid] ?? []).some((m) => m.card && m.card.state === 'open' && String(m.card.data.tag) === '要你看')
    if (!left) patchSession(sid, { waiting: undefined, unread: 0 })
  })

  // 卡片按钮 = 工具调用（正式版走网关：判定 → 审计 → 执行）；这里按原型演示处理
  const onCardAction = (sid: string) => (card: Card, action: CardAction, extra?: Record<string, unknown>) => {
    if (action.panel === 'diff') { setPanel([{ page: 'diff', params: { sid } }]); return }
    if (action.panel === 'credentialEdit') { setPanel([{ page: 'credentialEdit', params: (action.args ?? {}) as Record<string, string> }]); return }
    if (action.panel === 'query') { setPanel([{ page: 'queryResult', params: { sid, cardId: card.id } }]); return }
    if (LIVE) { cardAction(card, action, extra); return }
    const emp = sessions.find((s) => s.id === sid)?.employee ?? ''
    switch (card.type) {
      case 'issue':
        if (action.id === 'fix') {
          patchCard(sid, card.id, { state: 'done', result: '你选了「修复」· 已交给「shop 开发」' })
          runFixDemo(sid)
        } else {
          setIssueStatus(Number(card.data.no), action.id === 'watch' ? 'watching' : 'ignored')
          patchCard(sid, card.id, { state: 'done', result: action.id === 'watch' ? '你选了「先盯着」，再出现会告诉你' : '你选了「忽略」，同类异常不再提醒' })
        }
        return
      case 'confirm':
        if (action.style === 'danger') {
          requireVerify(card.data.title, () => {
            patchCard(sid, card.id, { state: 'done', result: '已执行 · 你用指纹确认 · 7 天内可撤销' })
            patchSession(sid, { waiting: undefined, last: `已完成：${card.data.title}`, time: now() })
            audit({ via: empName(emp), action: action.tool ?? 'confirm', target: card.data.title, level: '危险', result: '成功', how: '本人 + 指纹' })
            later(600, () => append(sid, { from: emp, kind: 'text', text: '做完了，快照留 7 天，要恢复跟我说一声。' }))
          }, card.data.why)
        } else {
          patchCard(sid, card.id, { state: 'done', result: `你选了「${action.label}」，员工已停下` })
          patchSession(sid, { waiting: undefined, last: '没做，已停下', time: now() })
        }
        return
      case 'ask':
        patchCard(sid, card.id, { state: 'done', result: `你选了：${String(extra?.answer ?? '')}` })
        patchSession(sid, { waiting: undefined, last: '收到，按你选的继续做', time: now() })
        later(700, () => append(sid, { from: emp, kind: 'text', text: '收到，按这个方案继续做，做完发预览链接给你。' }))
        return
      case 'change':
        if (action.id === 'revert') revertMerge(sid)
        return
      case 'query':
        if (action.id === 'save') saveQuery({ id: uid('q'), source: 'shop-prod', name: '用户最近的订单', sql: card.data.sql })
        else toast('已导出 CSV（原型）')
        return
      case 'release':
        toast(`「${action.label}」：有异常会自动回滚，现在不用点`)
        return
      default:
        if (action.tool === 'inbox.open') { setPanel([{ page: 'inbox' }]); return }
        // 消息助理默认只查不回：「去回复」到原处你自己回；「给我个回复建议」才给模板（可多语言），复制过去
        if (action.tool === 'msg.open') {
          patchCard(sid, card.id, { state: 'done', result: `已带你去 ${card.data.ch ?? '原处'}，你自己回（原型：正式版直接跳到那条消息）` })
          clearIfDone(sid); return
        }
        if (action.tool === 'msg.suggest') { setSuggest({ title: String(card.data.title), ch: String(card.data.ch ?? '邮件'), original: card.data.original }); return }
        if (action.tool === 'msg.ignore') {
          patchCard(sid, card.id, { state: 'done', result: '标成「不关我事」：同类消息以后放进「知道就行」' })
          clearIfDone(sid); return
        }
        if (action.tool === 'msg.send') {
          patchCard(sid, card.id, { state: 'done', result: '已用你的账号发出 · 记进操作记录' })
          audit({ via: empName(emp), action: 'msg.send', target: String(card.data.title ?? ''), level: '写', result: '成功', how: '本人点「发送」' })
          clearIfDone(sid); return
        }
        if (action.tool === 'msg.edit') { toast('原型：正式版在这里弹出草稿让你改，改完再发'); return }
        if (action.tool === 'msg.snooze') { patchCard(sid, card.id, { state: 'done', result: '先放着，明早 9 点再提醒你' }); clearIfDone(sid); return }
        if (action.tool === 'employee.delegate') {
          patchCard(sid, card.id, { state: 'done', result: '已转给「后台开发」，它看完会回到这里' })
          const dsid = sessionFor('dev-opero')
          append(dsid, { from: 'system', kind: 'system', text: '消息助理 转来：客户 Lily 导出 10 月订单报 403' })
          patchSession(dsid, { last: '消息助理转来：导出报 403', time: now(), unread: 1, working: '在查导出 403…' })
          clearIfDone(sid); return
        }
        if (action.tool === 'opero.promote') {
          promotePreview()
          patchCard(sid, card.id, { state: 'done', result: '已上线 · 上一版保留着，健康检查不过会自动回滚' })
          later(700, () => append(sid, { from: emp, kind: 'text', text: '上线了，健康检查通过。要回到上一版跟我说一声。' }))
          return
        }
        patchCard(sid, card.id, { state: 'done', result: `你点了「${action.label}」· 已交给员工去做` })
        later(800, () => append(sid, { from: emp, kind: 'text', text: '好的，开始了，做完告诉你。' }))
        audit({ via: empName(emp), action: action.tool ?? 'card', target: String(card.data.title ?? ''), level: '写', result: '成功', how: '本人点卡片' })
    }
  }

  // ---- 侧滑 / 返回键：每打开一层记一步浏览器历史，返回时只关最上面一层 ----
  const depth = (mobile ? (tab === 'chat' ? (current ? 1 : 0) : stack.length - 1) : (tab === 'chat' ? 0 : stack.length - 1))
    + (panel?.length ?? 0) + (search ? 1 : 0) + (newChat ? 1 : 0) + (suggest ? 1 : 0) + (verify ? 1 : 0) + (themeSheet ? 1 : 0)
  const histDepth = useRef(0)
  const ignorePop = useRef(false)
  const closeTop = useRef<() => void>(() => {})
  closeTop.current = () => {
    if (verify) set({ verify: null })
    else if (langSheet) setLangSheet(false)
    else if (themeSheet) setThemeSheet(false)
    else if (suggest) setSuggest(null)
    else if (newChat) setNewChat(false)
    else if (search) setSearch(false)
    else if (panel) setPanel(panel.length > 1 ? panel.slice(0, -1) : null)
    else if (tab === 'chat') { if (mobile && current) setCurrent(null) }
    else popTab()
  }
  useEffect(() => {
    if (depth > histDepth.current) {
      for (let i = histDepth.current; i < depth; i++) history.pushState({ opero: i + 1 }, '')
      histDepth.current = depth
    } else if (depth < histDepth.current) {
      ignorePop.current = true
      history.go(depth - histDepth.current)
      histDepth.current = depth
    }
  }, [depth])
  // 界面变了就改网址（替换当前这一条，不多记历史；返回键那套照旧）。没登录时不动，登录完还回到原来那页
  const hash = toHash({ tab, session: current, stack, panel })
  const hashRef = useRef(hash)
  hashRef.current = hash
  const ready = authState.loggedIn && authState.setupDone
  const syncUrl = useCallback(() => {
    if (location.hash !== hashRef.current) history.replaceState(history.state, '', location.pathname + location.search + hashRef.current)
  }, [])
  useEffect(() => { if (ready) syncUrl() }, [hash, ready, syncUrl])
  useEffect(() => {
    const onPop = () => {
      // 退回到的那条历史带着旧网址：等这一层关完再写成现在的
      window.setTimeout(() => { if (getState().auth.loggedIn) syncUrl() }, 0)
      if (ignorePop.current) { ignorePop.current = false; return }
      if (histDepth.current > 0) histDepth.current -= 1
      closeTop.current()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const session = sessions.find((s) => s.id === current) ?? null
  const employees = useStore((s) => s.employees)
  // 页签角标只算「红点」：要你决定的 + 设成「全部提醒」的员工的未读（少红点）
  const unread = sessions.reduce((a, s) => a + (badgeOf(s, employees.find((e) => e.id === s.employee)) === 'red' ? Math.max(1, s.unread ?? 0) : 0), 0)
  const badge = (t: Tab) => (t === 'chat' ? unread : 0)
  useEffect(() => { nativeBadge(unread) }, [unread])
  useEffect(() => { nativeRoute(current && tab === 'chat' ? `chat/${current}` : '') }, [current, tab])
  // App 里点通知：外壳把路由交过来（chat/<会话编号>）
  const openRef = useRef(openSession)
  openRef.current = openSession
  useEffect(() => onNativeOpen((route) => {
    const [kind, id] = route.split('/')
    if (kind === 'chat' && id && getState().sessions.some((s) => s.id === id)) openRef.current(id)
  }), [])
  // 正在看的会话来了新消息：直接算已读
  useEffect(() => { if (session?.unread && (!mobile || tab === 'chat')) markRead(session.id) }, [session?.id, session?.unread, mobile, tab])
  // App 点通知打开（票地址带 ?route=chat/<会话>）
  useEffect(() => {
    if (!authState.loggedIn || EMBED) return // 嵌入模式的 ?route= 是给 EmbedView 的，别拿走
    const r = new URLSearchParams(location.search).get('route')
    if (!r) return
    history.replaceState(history.state, '', location.pathname)
    const [kind, id] = r.split('/')
    if (kind === 'chat' && id && getState().sessions.some((s) => s.id === id)) openRef.current(id)
  }, [authState.loggedIn])
  const top = stack[stack.length - 1]
  const routeOf = (r: Route): Route => (r.page === 'me' ? { ...r, params: { ...r.params, onReplaySplash: () => setSplash(true) } } : r)

  const chatEl = session && (
    <Chat key={session.id} session={session} mobile={mobile}
      onBack={() => { setCurrent(null); setPanel(null) }}
      onCardAction={onCardAction(session.id)}
      onMenu={(m) => {
        const e = getState().employees.find((x) => x.id === session.employee)
        setPanel([menuRoute(m, session.employee, e?.workspace ?? '')])
      }}
      onProfile={() => setPanel([{ page: 'profile', params: { id: session.employee } }])}
      onSearch={() => setSearch(true)}
      onSettings={() => setPanel([{ page: 'chatSettings', params: { id: session.employee } }])}
      onMore={() => setPanel([{ page: 'chatInfo', params: { sid: session.id, onSearch: () => setSearch(true) } }])} />
  )
  const listEl = (
    <SessionList sessions={sessions} current={current} mobile={mobile} onOpen={openSession}
      onPin={togglePin} onMute={toggleMute} onSearch={() => setSearch(true)} onNew={() => setNewChat(true)} onTheme={() => setThemeSheet(true)} />
  )
  const tabbar = (
    <nav className="tabbar">
      {TABS.filter((t) => !t.desktopOnly).map((t) => (
        <button key={t.tab} className={tab === t.tab ? 'on' : ''} onClick={() => switchTab(t.tab)}>
          <TabIcon tab={t.tab} />
          <span>{t.label}</span>
          {badge(t.tab) > 0 && <i className="nav-badge">{badge(t.tab)}</i>}
        </button>
      ))}
    </nav>
  )

  let main: ReactNode
  if (authState.booting) main = null
  else if (!authState.loggedIn) main = LIVE ? <LiveLogin /> : <LoginPage />
  else if (!authState.setupDone) main = LIVE ? <LiveSetup /> : <Onboarding />
  else if (EMBED) main = <EmbedView start={EMBED.route} />
  else if (mobile) {
    main = (
      <div className="app mobile">
        {tab === 'chat'
          ? (session ? chatEl : <div className="m-main">{listEl}{tabbar}</div>)
          : (stack.length === 1
            ? <div className="m-main"><div className="m-page"><PageView route={routeOf(top)} nav={tabNav} /></div>{tabbar}</div>
            : <div className="m-page full"><PageView route={routeOf(top)} nav={tabNav} /></div>)}
        {panel && <aside className="panel m"><ErrorBoundary key={panel.length}><PageView route={panel[panel.length - 1]} nav={panelNav} /></ErrorBoundary></aside>}
      </div>
    )
  } else {
    main = (
      <div className={'app desktop' + (panel && tab === 'chat' ? ' with-panel' : '')}>
        <nav className="nav">
          <div className="nav-logo"><Mark size={40} /></div>
          {TABS.filter((t) => t.tab !== 'me').map((t) => (
            <button key={t.tab} className={'nav-btn' + (tab === t.tab ? ' on' : '')} onClick={() => switchTab(t.tab)}>
              <TabIcon tab={t.tab} /><span>{t.label}</span>
              {badge(t.tab) > 0 && <i className="nav-badge">{badge(t.tab)}</i>}
            </button>
          ))}
          <span className="grow" />
          <button className={'nav-btn' + (langSheet ? ' on' : '')} onClick={() => setLangSheet(true)} title="界面语言"><IconGlobe /><span>语言</span></button>
          <button className="nav-btn" onClick={() => setThemeSheet(true)} title="换风格"><IconPalette /><span>风格</span></button>
          <button className={'nav-btn' + (tab === 'me' ? ' on' : '')} onClick={() => switchTab('me')}>
            <TabIcon tab="me" /><span>我</span>
          </button>
        </nav>
        {tab === 'chat' ? (
          <>
            {listEl}
            {chatEl || <div className="chat empty-chat"><Mark size={64} /><p className="sub">选一个员工开始聊</p></div>}
            {panel && <aside className="panel"><ErrorBoundary key={panel.length}><PageView route={panel[panel.length - 1]} nav={panelNav} /></ErrorBoundary></aside>}
          </>
        ) : (
          <>
            <SideNav tab={tab} active={stack[0]} onPick={(r) => setStacks((st) => ({ ...st, [tab]: [r] }))} />
            <div className="page-wrap"><ErrorBoundary key={tab + stack.length}><PageView route={routeOf(top)} nav={tabNav} /></ErrorBoundary></div>
          </>
        )}
      </div>
    )
  }

  return (
    <>
      {main}
      {search && (
        <SearchOverlay onClose={() => setSearch(false)} onOpenChat={openChat}
          onOpen={(page, id) => {
            setSearch(false)
            setPanel(null)
            setTab('workspace')
            setStacks((st) => ({ ...st, workspace: mobile ? [...ROOTS.workspace, { page, params: { id } }] : [{ page, params: { id } }] }))
          }} />
      )}
      {newChat && (
        <NewChatSheet onClose={() => setNewChat(false)} onPick={openChat}
          onNewEmployee={() => {
            setNewChat(false)
            setTab('people')
            setStacks((st) => ({ ...st, people: mobile ? [...ROOTS.people, { page: 'employeeEdit' }] : [{ page: 'employeeEdit' }] }))
          }} />
      )}
      {langSheet && <LangSheet onClose={() => setLangSheet(false)} />}
      {themeSheet && (
        <ThemeQuick onClose={() => setThemeSheet(false)}
          onMore={() => {
            setThemeSheet(false)
            setPanel(null)
            setTab('me')
            setStacks((st) => ({ ...st, me: mobile ? [...ROOTS.me, { page: 'settings' }] : [{ page: 'settings' }] }))
          }} />
      )}
      {suggest && <ReplySuggestSheet {...suggest} onClose={() => setSuggest(null)} />}
      <VerifyModal />
      <ImageEditHost />
      {!LIVE && !mobile && authState.loggedIn && <a className="demo-pill" href="/" title="试用版：假数据，不连任何服务器">试用版 · 假数据 · 回官网</a>}
      <Toast />
      {splash && <Splash onDone={hideSplash} />}
    </>
  )
}
