// 聊天：顶栏 · 消息 · 「在做什么」+ 停止 · 底部菜单 · 输入（文字 / 按住说话 / 附件）
import { useEffect, useRef, useState } from 'react'
import type { Card, CardAction, Message, Session } from '../types'
import { append, compactContext, empName, getState, now, patchSession, removeMsg, sessionFor, toast, newTopic, restartWork, saveFlowFromChat, sendFile, sendMessage, setWork, stopWorking, switchWork, toggleMute, togglePin, useStore } from '../store'
import { APPROVALS, EFFORTS, approvalShort, effortLabel, modelsFor } from '../work'
import { Markdown } from './Markdown'
import { editImage, fileToDataUrl, imageSize, pickImages } from './ImageEditor'
import { LIVE } from '../mode'
import { WorkSheet } from './WorkSheet'
import { Avatar } from './Avatar'
import { CardView } from './cards'
import { Row, Sheet } from './ui'
import { nativeHaptic } from '../native'
import { IconBack, IconBell, IconBellOff, IconChevron, IconFlow, IconImage, IconMenu, IconMic, IconMore, IconPin, IconPlus, IconRefresh, IconSearch, IconSend, IconSliders } from './icons'

interface Props {
  session: Session
  mobile: boolean
  onBack: () => void
  onCardAction: (card: Card, action: CardAction, extra?: Record<string, unknown>) => void
  onMenu: (name: string) => void
  onProfile: () => void
  onSearch: () => void
  onSettings: () => void
}

const EMPTY: Message[] = []

export function Chat({ session, mobile, onBack, onCardAction, onMenu, onProfile, onSearch, onSettings }: Props) {
  const emp = useStore((s) => s.employees.find((e) => e.id === session.employee))
  const messages = useStore((s) => s.messages[session.id] ?? EMPTY)
  const aiDown = useStore((s) => s.settings.aiDown)
  const fallback = useStore((s) => s.settings.fallback)
  const listRef = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const [text, setText] = useState('')
  const [voice, setVoice] = useState(mobile && !LIVE) // 语音转文字还没接：真的一套默认打字
  const [sheet, setSheet] = useState<null | 'more' | 'attach' | 'work' | 'menus' | 'attachD'>(null)
  const [rec, setRec] = useState<null | { start: number; y: number; cancel: boolean; secs: number }>(null)
  // 像 IM：往上翻着看时来了新消息，右下角出「↓ N 条新消息」
  const [unseen, setUnseen] = useState(0)
  const seenLen = useRef(messages.length)
  // 长按 / 右键消息：复制、引用、转给别的员工、删除
  const [msgMenu, setMsgMenu] = useState<null | { m: Message; x: number; y: number }>(null)
  const [forward, setForward] = useState<Message | null>(null)
  const server = useStore((s) => s.servers.find((x) => x.name === emp?.host || x.id === emp?.host))

  useEffect(() => {
    // 照 KidLock：离底部 120px 以内才跟着滚到最新，往上翻着看的时候不打扰
    const el = listRef.current
    if (!el) return
    const added = messages.length - seenLen.current
    seenLen.current = messages.length
    if (!stuck.current) { if (added > 0) setUnseen((n) => n + added); return }
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])
  const toBottom = () => { const el = listRef.current; el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); stuck.current = true; setUnseen(0) }

  useEffect(() => {
    if (!rec) return
    const t = window.setInterval(() => setRec((r) => (r ? { ...r, secs: Math.floor((Date.now() - r.start) / 1000) } : r)), 250)
    return () => clearInterval(t)
  }, [rec?.start])

  if (!emp) return null
  const send = () => {
    const t = text.trim()
    if (!t) return
    sendMessage(session.id, t)
    setText('')
  }
  // 发图片：先过图片编辑器（裁剪 / 旋转 / 调色 / 压缩），一次选多张就一张张来；发文件不编辑
  const sendImages = async (files: File[]) => {
    for (const f of files) {
      const url = await fileToDataUrl(f)
      const { w, h } = await imageSize(url)
      sendFile(session.id, f.name, true, { size: f.size, url, w, h })
    }
  }
  const attach = async (kind: string) => {
    setSheet(null)
    if (kind === '文件') {
      const input = document.createElement('input')
      input.type = 'file'
      input.onchange = () => { const f = input.files?.[0]; if (f) sendFile(session.id, f.name, false, { size: f.size }, f) }
      input.click()
      return
    }
    sendImages(await pickImages({ multiple: kind !== '拍照', capture: kind === '拍照', title: kind === '截图' ? '编辑截图' : '编辑图片', okText: '发送' }))
  }
  // 电脑上直接粘贴截图：也先过编辑器
  const onPaste = async (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) return
    e.preventDefault()
    const out: File[] = []
    for (const f of imgs) { const r = await editImage(f, { title: '编辑截图', okText: '发送' }); if (r) out.push(r) }
    sendImages(out)
  }

  return (
    <section className="chat"
      onDragOver={(e) => { if (Array.from(e.dataTransfer.items).some((i) => i.type.startsWith('image/'))) e.preventDefault() }}
      onDrop={async (e) => {
        const imgs = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
        if (!imgs.length) return
        e.preventDefault()
        const out: File[] = []
        for (const f of imgs) { const r = await editImage(f, { title: '编辑图片', okText: '发送' }); if (r) out.push(r) }
        sendImages(out)
      }}>
      <header className="chat-head">
        {mobile && <button className="icon-btn" onClick={onBack} aria-label="返回"><IconBack /></button>}
        <span onClick={onProfile} className="click"><Avatar id={emp.id} size={mobile ? 36 : 44} dot={session.working ? 'ok' : undefined} /></span>
        <div className="chat-title" onClick={() => (mobile ? setSheet('work') : onProfile())}>
          <span className="chat-title-top">
            <b>{emp.name}</b>
            {session.working && <span className="run-pill"><i />在干活</span>}
            {!session.working && session.waiting && <span className="run-pill wait"><i />{session.waiting}</span>}
          </span>
          {mobile
            ? (
              <span className={'m-sub' + (session.working ? ' run-sub' : '')}>
                <em>{session.working ?? emp.title}</em>
                {server && !session.working && <ServerLoad cpu={server.cpu} mem={server.mem} online={server.online} compact />}
              </span>
            )
            : (
              <span className="meta-chips">
                <span className="meta-chip">{emp.title}</span>
                <span className="meta-chip">{emp.executor}</span>
                <span className="meta-chip">{emp.host}</span>
                {emp.workspace && <span className="meta-chip branch">⎇ {emp.workspace}</span>}
                {server && <ServerLoad cpu={server.cpu} mem={server.mem} online={server.online} />}
              </span>
            )}
        </div>
        {!mobile && <button className="btn default sm" onClick={onProfile}>档案</button>}
        <button className="icon-btn" aria-label="更多" onClick={() => setSheet('more')}><IconMore /></button>
      </header>

      {aiDown && (
        <div className="ai-down">
          {fallback
            ? <>{emp.executor} 暂时连不上（API 限流），已自动切到备用 <b>{fallback}</b>；面板和底部菜单照常能用。</>
            : <>{emp.executor} 暂时连不上，员工先歇着；面板和底部菜单照常能用，恢复后会接着做。</>}
        </div>
      )}
      <div className={'msgs msgs-bg-' + (emp.bg ?? 'plain')} ref={listRef}
        onScroll={(e) => { const el = e.currentTarget; stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; if (stuck.current) setUnseen(0) }}>
        {messages.length === 0 && <p className="hint center">还没有消息，跟「{emp.name}」说点什么吧。</p>}
        {messages.map((m, i) => (
          <MessageView key={m.id} m={m} owner={emp.id} showTime={!!m.at && m.at !== messages[i - 1]?.at && m.kind !== 'status'}
            onCardAction={onCardAction} onMenu={(x, y) => { nativeHaptic(); setMsgMenu({ m, x, y }) }} />
        ))}
        <div className="msgs-end" />
      </div>
      {unseen > 0 && <button className="new-pill" onClick={toBottom}>↓ {unseen} 条新消息</button>}
      {msgMenu && (
        <div className="ctx-mask" onClick={() => setMsgMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMsgMenu(null) }}>
          <div className={'ctx' + (mobile ? ' sheet-like' : '')} style={mobile ? undefined : { left: Math.min(msgMenu.x, window.innerWidth - 170), top: Math.min(msgMenu.y, window.innerHeight - 200) }}
            onClick={(e) => e.stopPropagation()}>
            {(msgMenu.m.text || msgMenu.m.card) && <button onClick={() => { navigator.clipboard?.writeText(msgText(msgMenu.m)); toast('已复制'); setMsgMenu(null) }}>复制</button>}
            <button onClick={() => { setText((t) => `「${msgText(msgMenu.m).slice(0, 80)}」\n${t}`); setVoice(false); setMsgMenu(null) }}>引用</button>
            <button onClick={() => { setForward(msgMenu.m); setMsgMenu(null) }}>转给别的员工</button>
            <button onClick={() => { removeMsg(session.id, msgMenu.m.id); setMsgMenu(null) }}>删除</button>
            {mobile && <button className="ctx-cancel" onClick={() => setMsgMenu(null)}>取消</button>}
          </div>
        </div>
      )}
      {forward && (
        <Sheet title="转给谁" onClose={() => setForward(null)}>
          <div className="sheet-list">
            {getState().employees.filter((x) => x.id !== emp.id).map((x) => (
              <Row key={x.id} icon={<Avatar id={x.id} size={36} />} title={x.name} sub={x.title} onClick={() => {
                const sid = sessionFor(x.id)
                append(sid, { from: 'me', kind: 'text', text: `转自「${emp.name}」：\n${msgText(forward)}` })
                patchSession(sid, { last: `[转发] ${msgText(forward).slice(0, 30)}`, time: now() })
                toast(`已转给「${x.name}」`)
                setForward(null)
              }} />
            ))}
          </div>
        </Sheet>
      )}

      {(emp.contextUsed ?? 0) >= 80 && !session.working && (
        <div className="ctx-warn">
          <span>上下文用了 {emp.contextUsed}%，快满了</span>
          <button className="btn ghost sm" onClick={() => compactContext(session.id, emp.id)}>压缩</button>
          <button className="btn primary sm" onClick={() => switchWork(session.id, emp.id, '上下文快满了')}>换 work</button>
        </div>
      )}
      {session.working && (
        <div className="working-bar">
          <i className="spinner" /><span>{session.working}</span>
          {!mobile && <button className="btn stop" onClick={() => stopWorking(session.id)}>停止</button>}
        </div>
      )}

      <footer className="chat-foot">
        {mobile ? (
          <>
            {emp.menus.length > 0 && (
              <nav className="menu-bar">
                <span className="menu-icon"><IconMenu /></span>
                {(emp.menus.length > 3 ? emp.menus.slice(0, 2).concat('更多') : emp.menus).map((m) => (
                  <button key={m} onClick={() => (m === '更多' ? setSheet('menus') : onMenu(m))}>{m}</button>
                ))}
              </nav>
            )}
            <div className="composer m">
              {!LIVE && (
                <button className="round-btn" onClick={() => setVoice(!voice)} aria-label={voice ? '打字' : '语音'}>
                  {voice ? <span className="kbd-icon">Aa</span> : <IconMic />}
                </button>
              )}
              {voice ? (
                <button className={'hold' + (rec ? ' on' : '')}
                  onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); nativeHaptic(); setRec({ start: Date.now(), y: e.clientY, cancel: false, secs: 0 }) }}
                  onPointerMove={(e) => setRec((r) => (r ? { ...r, cancel: r.y - e.clientY > 60 } : r))}
                  onPointerUp={() => {
                    if (rec && !rec.cancel) sendMessage(session.id, Date.now() - rec.start < 800 ? '（语音太短，原型里按住久一点）' : '（语音转文字）帮我看下 AWS-dev 的内存为什么这么高')
                    setRec(null)
                  }}
                  onPointerCancel={() => setRec(null)}>
                  {rec ? '松开 发送' : '按住 说话'}
                </button>
              ) : (
                <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send() }}
                  placeholder={session.working ? '在干活，这时发 = 插话' : `跟「${emp.name}」说点什么`} enterKeyHint="send" />
              )}
              {!voice && text.trim()
                ? <button className="round-btn primary" onClick={send} aria-label="发送"><IconSend /></button>
                : session.working
                  ? <button className="round-btn stop" onClick={() => stopWorking(session.id)} aria-label="停止"><i /></button>
                  : <button className="round-btn" onClick={() => setSheet('attach')} aria-label="附件"><IconPlus /></button>}
            </div>
          </>
        ) : (
          <>
            <div className="composer-ctl">
              <select className="ctl-select" value={emp.model} title="模型（选了就记住）" onChange={(e) => setWork(emp.id, { model: e.target.value })}>
                {modelsFor(emp.executor).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <select className="ctl-select" value={emp.effort} title="思考方式" onChange={(e) => setWork(emp.id, { effort: e.target.value as typeof emp.effort })}>
                {EFFORTS.map((x) => <option key={x.value} value={x.value}>思考{x.label}</option>)}
              </select>
              <div className="seg sm" title="审核方式">
                {APPROVALS.map((a) => (
                  <button key={a.value} className={emp.approval === a.value ? 'on' : ''} title={a.desc} onClick={() => setWork(emp.id, { approval: a.value })}>{a.short}</button>
                ))}
              </div>
              <button className={'ctx-chip' + ((emp.contextUsed ?? 0) >= 80 ? ' hot' : '')} onClick={() => setSheet('work')} title="上下文：压缩 / 新话题 / 换 work">上下文 {emp.contextUsed ?? 0}%</button>
              {emp.menus.length > 0 && (
                <>
                  <span className="grow" />
                  <nav className="menu-chips" aria-label="底部菜单">
                    <span className="menu-chips-icon"><IconMenu /></span>
                    {emp.menus.map((m) => <button key={m} onClick={() => onMenu(m)}>{m}</button>)}
                  </nav>
                </>
              )}
            </div>
            <div className="composer-send">
              <button className="icon-btn boxed" onClick={() => setSheet('attachD')} aria-label="发图片 / 文件" title="发图片 / 文件 / 截图"><IconPlus /></button>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2}
                onPaste={onPaste}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() } }}
                placeholder={session.working ? `「${emp.name}」在干活，这时发的话会插进去…` : `跟「${emp.name}」说点什么…`} />
              <button className="btn primary" onClick={send} disabled={!text.trim()}><IconSend />发送</button>
            </div>
            <span className="composer-hint">Enter 发送 · Shift + Enter 换行 · 截图粘贴 / 图片拖进来都会先裁剪再发{session.working ? ' · 在干活时发的话会插进去' : ''}</span>
          </>
        )}
      </footer>

      {rec && (
        <div className={'rec-overlay' + (rec.cancel ? ' cancel' : '')}>
          <div className="rec-box">
            <div className="rec-wave">{Array.from({ length: 9 }).map((_, i) => <i key={i} style={{ animationDelay: `${i * 0.08}s` }} />)}</div>
            <b>0:{String(rec.secs).padStart(2, '0')}</b>
            <span>{rec.cancel ? '松开 取消' : '松开 发送 · 上滑 取消'}</span>
          </div>
        </div>
      )}

      {sheet === 'more' && (
        // 「···」：照微信「聊天信息」分组——谁（点进档案）· 常用四个 · 这个 work · 不常用的
        <Sheet onClose={() => setSheet(null)}>
          <div className="more">
            <button className="more-who" onClick={() => { setSheet(null); onProfile() }}>
              <Avatar id={emp.id} size={48} />
              <span className="more-who-main"><b>{emp.name}</b><span>{emp.title}</span></span>
              <span className="row-chev"><IconChevron /></span>
            </button>
            <div className="more-grid">
              <button onClick={() => { setSheet(null); onSearch() }}><span><IconSearch /></span>搜索记录</button>
              <button className={session.pinned ? 'on' : ''} onClick={() => togglePin(session.id)}><span><IconPin /></span>{session.pinned ? '已置顶' : '置顶'}</button>
              <button className={emp.notify === 'none' ? 'on' : ''} onClick={() => toggleMute(session.id)}><span>{emp.notify === 'none' ? <IconBellOff /> : <IconBell />}</span>{emp.notify === 'none' ? '已免打扰' : '免打扰'}</button>
              <button onClick={() => { setSheet(null); onSettings() }}><span><IconSliders /></span>聊天设置</button>
            </div>
            <div className="more-box">
              <button className="more-work" onClick={() => setSheet('work')}>
                <span className="more-box-title">这个 work</span>
                <span className="more-work-v">{emp.model} · 思考{effortLabel(emp.effort)} · {approvalShort(emp.approval)}</span>
                <span className="row-chev"><IconChevron /></span>
              </button>
              <div className="more-ctx">
                <div className="meter-bar"><i className={(emp.contextUsed ?? 0) >= 80 ? 'm-warn' : 'm-ok'} style={{ width: `${Math.max(2, emp.contextUsed ?? 0)}%` }} /></div>
                <span>上下文 {emp.contextUsed ?? 0}%</span>
              </div>
              <div className="more-acts">
                <button onClick={() => { compactContext(session.id, emp.id); setSheet(null) }}>压缩</button>
                <button onClick={() => { newTopic(session.id, emp.id); setSheet(null) }}>新话题</button>
                <button className="hot" onClick={() => { switchWork(session.id, emp.id, '你让换的'); setSheet(null) }}>换一个 work</button>
              </div>
            </div>
            <div className="more-list">
              <button onClick={() => { saveFlowFromChat(emp.id); setSheet(null) }}><IconFlow /><span>把刚才做的存成流程<small>下次点一下就跑，不经过 AI</small></span></button>
              <button onClick={() => { restartWork(session.id); setSheet(null) }}><IconRefresh /><span>重启 work<small>卡住时用，会话和记忆都在</small></span></button>
            </div>
          </div>
        </Sheet>
      )}
      {sheet === 'menus' && (
        <Sheet title="菜单" onClose={() => setSheet(null)}>
          <div className="sheet-list">
            {emp.menus.map((m) => <Row key={m} title={m} chevron onClick={() => { setSheet(null); onMenu(m) }} />)}
          </div>
        </Sheet>
      )}
      {sheet === 'work' && <WorkSheet emp={emp} sid={session.id} onClose={() => setSheet(null)} />}
      {sheet === 'attachD' && (
        <Sheet title="发送" onClose={() => setSheet(null)}>
          <div className="sheet-list">
            {['图片', '截图', '文件'].map((k) => <Row key={k} title={k} onClick={() => attach(k)} />)}
          </div>
        </Sheet>
      )}
      {sheet === 'attach' && (
        <Sheet title="发送" onClose={() => setSheet(null)}>
          <div className="attach-grid">
            {['图片', '拍照', '截图', '文件'].map((k) => (
              <button key={k} onClick={() => attach(k)}><span className="ws-icon">{k.slice(0, 1)}</span>{k}</button>
            ))}
          </div>
        </Sheet>
      )}
    </section>
  )
}

const msgText = (m: Message) => m.text ?? (m.card ? String(m.card.data.title ?? '') : m.file?.name ?? '')

// 像微信：每条消息左边（对方）/ 右边（我）带头像，气泡带小尖角；时间不一样时中间插一条时间
function MessageView({ m, owner, showTime, onCardAction, onMenu }: {
  m: Message; owner: string; showTime: boolean; onCardAction: Props['onCardAction']; onMenu: (x: number, y: number) => void
}) {
  const press = useRef<number | null>(null)
  const time = showTime ? <div className="time-sep">{m.at}</div> : null
  if (m.kind === 'system') return <>{time}<div className="sys-line"><span>{m.text}</span></div></>
  if (m.kind === 'status') {
    return (
      <div className="status-line">
        {m.spinning ? <i className="spinner" /> : <i className="dot-ok" />}
        <span>{m.text}</span>
      </div>
    )
  }
  const me = m.from === 'me'
  // 长按 0.5 秒（手机）/ 右键（电脑）出菜单
  const hold = {
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); onMenu(e.clientX, e.clientY) },
    onTouchStart: (e: React.TouchEvent) => { const t = e.touches[0]; press.current = window.setTimeout(() => onMenu(t.clientX, t.clientY), 500) },
    onTouchEnd: () => { if (press.current) clearTimeout(press.current) },
    onTouchMove: () => { if (press.current) clearTimeout(press.current) },
  }
  const body = me
    ? (m.kind === 'file' && m.file ? <FileBubble f={m.file} /> : <div className="bubble me" {...hold}>{m.text}</div>)
    : (
      <>
        {m.kind === 'text' && <div className="bubble" {...hold}><Markdown text={m.text ?? ''} /></div>}
        {m.kind === 'file' && m.file && <div {...hold}><FileBubble f={m.file} /></div>}
        {m.kind === 'card' && m.card && <div className="msg-card" {...hold}><CardView card={m.card} onAction={onCardAction} /></div>}
      </>
    )
  return (
    <>
      {time}
      <div className={'msg-row' + (me ? ' me' : '') + (m.kind === 'card' ? ' wide' : '')}>
        <span className="msg-av"><Avatar id={me ? 'me' : m.from} size={38} /></span>
        <div className="msg-col">
          {!me && m.from !== owner && <span className="bubble-who">{empName(m.from)}</span>}
          {body}
        </div>
      </div>
    </>
  )
}

/** 顶栏：work 所在服务器的 CPU / 内存（≥80% 变橙，≥90% 变红） */
function ServerLoad({ cpu, mem, online, compact }: { cpu: number; mem: number; online: boolean; compact?: boolean }) {
  if (!online) return <span className="srv-load off">服务器离线</span>
  const tone = (v: number) => (v >= 90 ? 'bad' : v >= 80 ? 'hot' : '')
  if (compact) return <span className="srv-load compact"><b className={tone(cpu)}>CPU {cpu}%</b><b className={tone(mem)}>内存 {mem}%</b></span>
  return (
    <span className="srv-load" title="work 所在服务器的负载">
      {([['CPU', cpu], ['内存', mem]] as const).map(([k, v]) => (
        <span key={k} className={'srv-meter ' + tone(v)}><em>{k}</em><i><b style={{ width: `${v}%` }} /></i><span>{v}%</span></span>
      ))}
    </span>
  )
}

function FileBubble({ f }: { f: NonNullable<Message['file']> }) {
  if (f.image && f.url) return <img className="img-real" src={f.url} alt={f.name} style={f.w && f.h ? { aspectRatio: `${f.w} / ${f.h}` } : undefined} />
  if (f.image) return <div className="img-bubble"><IconImage /><span>{f.name}</span></div>
  return (
    <div className="card file-card">
      <span className="file-ext">{f.ext}</span>
      <div><b>{f.name}</b><span className="sub">{f.size} · 点开预览</span></div>
    </div>
  )
}
