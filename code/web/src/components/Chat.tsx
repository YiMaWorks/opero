// 聊天：顶栏 · 消息 · 「在做什么」+ 停止 · 底部菜单 · 输入（文字 / 按住说话 / 附件）
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Card, CardAction, Message, Session } from '../types'
import { append, compactContext, empName, getState, now, patchSession, removeMsg, sessionFor, setSettings, toast, newTopic, restartWork, saveFlowFromChat, sendFile, sendMessage, setWork, stopWorking, switchWork, toggleMute, togglePin, useStore } from '../store'
import { APPROVALS, EFFORTS, approvalShort, effortLabel, modelsFor } from '../work'
import { Markdown } from './Markdown'
import { editImage, fileToDataUrl, imageSize, pickImages } from './ImageEditor'
import { LIVE } from '../mode'
import { call, upload } from '../live'
import type { QAtt } from '../types'
import { WorkSheet } from './WorkSheet'
import { Avatar } from './Avatar'
import { CardView, RunFoot } from './cards'
import { Empty, Row, Sheet } from './ui'
import { canDictate, dictate, nativeHaptic } from '../native'
import { resolve as langOf, loadPref } from '../i18n'
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
  /** 「···」：右边滑出「聊天信息」（和员工资料一样从右边出来） */
  onMore: () => void
}

const EMPTY: Message[] = []
const NO_PHRASES: string[] = []

// 输入法在组字时按回车（拼音模式打英文、回车上屏）不算发送。有的浏览器这时 isComposing 已经是 false：
// Safari 先结束组字再给回车（keyCode 229），安卓输入法上屏后紧跟一个真回车——都按「刚组完字」挡掉
let composedAt = 0
const onComposeEnd = () => { composedAt = Date.now() }
const imeEnter = (e: React.KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229 || Date.now() - composedAt < 150

// 输入框草稿：切到别的会话 / 页面再回来还在。文字存本机（刷新、关掉再开也在），已传好的附件留在内存里
const DRAFTS = 'opero.drafts'
const loadDrafts = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(DRAFTS) ?? '{}') } catch { return {} } }
function saveDraft(sid: string, text: string) {
  const d = loadDrafts()
  if ((d[sid] ?? '') === text) return
  if (text) d[sid] = text
  else delete d[sid]
  try { localStorage.setItem(DRAFTS, JSON.stringify(d)) } catch { /* 存不了就算了 */ }
}
// 「上下文快满了」点了「先不换」：这一段上下文（员工 + 第几个 work）里不再提示，切页面、刷新也记得；开新会话后重新算
const CTX_OFF = 'opero.ctxDismissed'
const ctxKey = (empId: string, work?: number) => `${empId}:${work ?? 0}`
const ctxOff = (k: string): boolean => { try { return (JSON.parse(localStorage.getItem(CTX_OFF) ?? '[]') as string[]).includes(k) } catch { return false } }
function setCtxOff(k: string) {
  try {
    const list = (JSON.parse(localStorage.getItem(CTX_OFF) ?? '[]') as string[]).filter((x) => x !== k)
    localStorage.setItem(CTX_OFF, JSON.stringify([...list, k].slice(-200)))
  } catch { /* 存不了就只管这一次 */ }
}
type Pend = { key: string; name: string; image: boolean; preview?: string; busy: boolean; err?: string; att?: QAtt }
const pendDrafts = new Map<string, Pend[]>()

export function Chat({ session, mobile, onBack, onCardAction, onMenu, onProfile, onSearch, onSettings, onMore }: Props) {
  const emp = useStore((s) => s.employees.find((e) => e.id === session.employee))
  const raw = useStore((s) => s.messages[session.id] ?? EMPTY)
  // 「正在输入」气泡（这一轮开始时建的）永远放在最下面；空的系统行不显示
  const messages = useMemo(() => {
    const shown = raw.filter((m) => !((m.kind === 'system' || m.kind === 'status') && !m.spinning && !(m.text ?? '').trim()))
    return [...shown.filter((m) => !(m.kind === 'status' && m.spinning)), ...shown.filter((m) => m.kind === 'status' && m.spinning)]
  }, [raw])
  // 一轮的小结（run 卡片）跟在员工上一条消息下面当小字，不单独占一条：key = 那条消息的 id
  const feet = useMemo(() => {
    const at = new Map<string, Message>()
    messages.forEach((m, i) => {
      if (m.card?.type !== 'run') return
      for (let j = i - 1; j >= 0; j--) {
        const p = messages[j]
        if (p.kind === 'status' || p.kind === 'system') continue
        if (p.from === m.from && p.card?.type !== 'run' && !at.has(p.id)) at.set(p.id, m)
        break
      }
    })
    return at
  }, [messages])
  const attached = useMemo(() => new Set([...feet.values()].map((m) => m.id)), [feet])
  const aiDown = useStore((s) => s.settings.aiDown)
  const fallback = useStore((s) => s.settings.fallback)
  const listRef = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  const [text, setText] = useState(() => loadDrafts()[session.id] ?? '')
  useEffect(() => saveDraft(session.id, text), [session.id, text])
  const [voice, setVoice] = useState(mobile && !LIVE) // 语音转文字还没接：真的一套默认打字
  const [sheet, setSheet] = useState<null | 'attach' | 'work' | 'menus' | 'attachD' | 'phrases'>(null)
  const [dragging, setDragging] = useState(false)
  // 常用语直接摆在输入框上面：点一下填进去；「编辑」时能删、能把输入框里的存成常用语
  const [editPh, setEditPh] = useState(false)
  // 「先不换」：这一段上下文里不再提醒（记在本机）；换不换由主人决定
  const [, setCtxTick] = useState(0)
  const phrases = useStore((s) => s.settings.phrases) ?? NO_PHRASES
  const [rec, setRec] = useState<null | { start: number; y: number; cancel: boolean; secs: number }>(null)
  // 像 IM：往上翻着看时来了新消息，右下角出「↓ N 条新消息」
  const [unseen, setUnseen] = useState(0)
  const seenLen = useRef(messages.length)
  // 长按 / 右键消息：复制、引用、转给别的员工、删除
  const [msgMenu, setMsgMenu] = useState<null | { m: Message; x: number; y: number }>(null)
  const [forward, setForward] = useState<Message | null>(null)
  const server = useStore((s) => s.servers.find((x) => x.name === emp?.host || x.id === emp?.host))
  const ws = useStore((s) => s.workspaces.find((w) => w.id === emp?.workspace))
  /** 底部菜单「改动记录」显示成项目名：点开就是这个项目（提交、分支、编译和发布） */
  const menuLabel = (m: string) => (m === '改动记录' && ws ? ws.name : m)
  // 真的一套：附件先传（输入框上面一排），跟着下一句话一起发；员工在干活时可以排队（带着附件）
  const allQueue = useStore((s) => s.queue)
  const myQueue = allQueue.filter((q) => q.emp === session.employee).sort((a, b) => a.at - b.at)
  const [pend, setPendState] = useState<Pend[]>(() => pendDrafts.get(session.id) ?? [])
  // 附件可能在切走以后才传完：先改缓存，再改界面（界面已经不在了也没关系，回来从缓存拿）
  const setPend = (f: Pend[] | ((p: Pend[]) => Pend[])) => {
    const next = typeof f === 'function' ? f(pendDrafts.get(session.id) ?? []) : f
    if (next.length) pendDrafts.set(session.id, next)
    else pendDrafts.delete(session.id)
    setPendState(next)
  }
  const [sending, setSending] = useState(false)
  // 说话转文字（真的一套）：点一下说一句，文字接在输入框后面
  const [listening, setListening] = useState(false)
  const talk = async () => {
    if (listening) return
    setListening(true)
    try { const t = await dictate(langOf(loadPref())); if (t) setText((x) => (x ? `${x} ${t}` : t)) } catch (e) { toast((e as Error).message) } finally { setListening(false) }
  }
  // 排队的话点一下能改（附件不动）
  const [editQ, setEditQ] = useState<{ id: string; text: string } | null>(null)
  const saveQ = () => { if (!editQ) return; const cur = allQueue.find((q) => q.id === editQ.id); if (cur && cur.text !== editQ.text) call('PUT', `/api/queue/${editQ.id}`, { text: editQ.text }); setEditQ(null) }

  useEffect(() => {
    // 离底部 120px 以内才跟着滚到最新，往上翻着看的时候不打扰
    const el = listRef.current
    if (!el) return
    const added = messages.length - seenLen.current
    seenLen.current = messages.length
    // 自己刚发的（或排队的那句发出去了）：不管翻到哪都回到底部
    if (added > 0 && messages.slice(-added).some((m) => m.from === 'me')) { stuck.current = true; setUnseen(0) }
    if (!stuck.current) { if (added > 0) setUnseen((n) => n + added); return }
    pin()
  }, [messages])
  // 贴底：直接跳（不用平滑滚动——滚到一半内容又变高，会被当成「翻上去了」就不再跟），等这一帧排好版再跳一次
  const pin = () => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    requestAnimationFrame(() => { if (stuck.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight })
  }
  const toBottom = () => { stuck.current = true; setUnseen(0); pin() }
  // 贴在底部时，内容后来又变高（图片加载完、Markdown 排好、正在输入气泡出现、小结挂上）也跟着到底
  useEffect(() => {
    const el = listRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => { if (stuck.current) el.scrollTop = el.scrollHeight })
    for (const c of Array.from(el.children)) ro.observe(c)
    const mo = new MutationObserver(() => { for (const c of Array.from(el.children)) ro.observe(c); if (stuck.current) el.scrollTop = el.scrollHeight })
    mo.observe(el, { childList: true })
    return () => { ro.disconnect(); mo.disconnect() }
  }, [session.id])

  // 开新会话接着做：交接预填在输入框里，看一下再发
  useEffect(() => {
    if (LIVE && session.draft) { setText(session.draft); call('PUT', `/api/sessions/${session.id}`, { draft: '' }) }
  }, [session.id])

  useEffect(() => {
    if (!rec) return
    const t = window.setInterval(() => setRec((r) => (r ? { ...r, secs: Math.floor((Date.now() - r.start) / 1000) } : r)), 250)
    return () => clearInterval(t)
  }, [rec?.start])

  if (!emp) return null
  const codex = /codex/i.test(emp.executor)
  const readyAtts = pend.filter((p) => p.att)
  const canSend = !!text.trim() || readyAtts.length > 0
  /** mode = queue：员工在干活就排队；auto：能插话就插话，插不进去就排队 */
  const send = async (mode: 'auto' | 'queue' = 'auto') => {
    const t = text.trim()
    if (!LIVE) {
      if (!t) return
      toBottom()
      sendMessage(session.id, t)
      setText('')
      return
    }
    if (pend.some((p) => p.busy)) { toast('附件还在传，等一下'); return }
    if (!t && !readyAtts.length) return
    toBottom()
    setSending(true)
    const r = await call<{ queued?: { id: string }; sent?: boolean }>('POST', `/api/sessions/${session.id}/messages`, {
      text: t, files: readyAtts.map((p) => ({ id: p.att!.id, w: p.att!.w, h: p.att!.h })), mode,
    })
    setSending(false)
    if (!r) return
    setText('')
    setPend([])
    if (r.queued) toast('已排队：这一轮做完按顺序发')
  }
  const addPending = async (blob: Blob, name: string, image: boolean, preview?: string, w?: number, h?: number) => {
    const key = Math.random().toString(36).slice(2)
    setPend((p) => [...p, { key, name, image, preview, busy: true }])
    const r = await upload(session.id, blob, name, { w, h })
    setPend((p) => p.map((x) => (x.key !== key ? x : r?.att ? { ...x, busy: false, att: r.att } : { ...x, busy: false, err: '传失败了' })))
  }
  const dropPending = (key: string) => {
    const x = pend.find((p) => p.key === key)
    if (x?.att) call('DELETE', `/api/sessions/${session.id}/files/${encodeURIComponent(x.att.id)}`)
    setPend((p) => p.filter((y) => y.key !== key))
  }
  // 发图片：先过图片编辑器（裁剪 / 旋转 / 调色 / 压缩），一次选多张就一张张来；发文件不编辑
  const sendImages = async (files: File[]) => {
    for (const f of files) {
      const url = await fileToDataUrl(f)
      const { w, h } = await imageSize(url)
      if (LIVE) addPending(f, f.name, true, url, w, h)
      else sendFile(session.id, f.name, true, { size: f.size, url, w, h })
    }
  }
  const attach = async (kind: string) => {
    setSheet(null)
    if (kind === '文件') {
      const input = document.createElement('input')
      input.type = 'file'
      input.multiple = LIVE
      input.onchange = () => { for (const f of Array.from(input.files ?? [])) { if (LIVE) addPending(f, f.name, f.type.startsWith('image/')); else sendFile(session.id, f.name, false, { size: f.size }, f) } }
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
    <section className={'chat' + (dragging ? ' dropping' : '')}
      onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes('Files')) { e.preventDefault(); if (!dragging) setDragging(true) } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
      onDrop={async (e) => {
        setDragging(false)
        const files = Array.from(e.dataTransfer.files)
        if (!files.length) return
        e.preventDefault()
        // 图片先过编辑器（裁剪 / 压缩）；别的文件直接放到输入框上面，跟着下一句话一起发
        const imgs = files.filter((f) => f.type.startsWith('image/'))
        for (const f of files.filter((x) => !x.type.startsWith('image/'))) { if (LIVE) addPending(f, f.name, false); else sendFile(session.id, f.name, false, { size: f.size }, f) }
        const out: File[] = []
        for (const f of imgs) { const r = await editImage(f, { title: '编辑图片', okText: '发送' }); if (r) out.push(r) }
        if (out.length) sendImages(out)
      }}>
      {dragging && <div className="drop-hint">松开就发：图片先裁剪，文件跟着下一句话一起发</div>}
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
                <span className="meta-chip">{server ? (server.id === 'local' && server.name === '本机' ? 'Opero 这台' : server.name) : emp.host}</span>
                {ws && <span className="meta-chip branch" title={`${ws.name} · ${ws.branch || ''}`}>⎇ {ws.branch || '…'}</span>}
                {server && <ServerLoad cpu={server.cpu} mem={server.mem} online={server.online} />}
                <button type="button" className={'meta-chip work-chip' + ((emp.contextUsed ?? 0) >= 80 ? ' hot' : '')} title="模型、思考方式、审核方式、上下文：点开改" onClick={() => setSheet('work')}>
                  {emp.model} · 思考{effortLabel(emp.effort)} · {approvalShort(emp.approval)} · 上下文 {emp.contextUsed ?? 0}%
                </button>
              </span>
            )}
        </div>
        {!mobile && <button className="btn default sm" onClick={onProfile}>员工资料</button>}
        <button className="icon-btn" aria-label="聊天信息" title="聊天信息" onClick={onMore}><IconMore /></button>
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
        {messages.map((m, i) => attached.has(m.id) ? null : (
          <MessageView key={m.id} m={m} foot={feet.get(m.id)} owner={emp.id} showTime={!!m.at && m.at !== messages[i - 1]?.at && m.kind !== 'status'}
            onCardAction={onCardAction} onMenu={(x, y) => { nativeHaptic(); setMsgMenu({ m, x, y }) }}
            onCopy={() => { navigator.clipboard?.writeText(msgText(m)); toast('已复制') }} onForward={() => setForward(m)}
            working={session.working} onStop={() => stopWorking(session.id)} />
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
              <Row key={x.id} icon={<Avatar id={x.id} size={36} />} title={x.name} sub={x.title} onClick={async () => {
                if (LIVE) {
                  // 真的一套：发到那个员工的会话里，它会接着处理（在干活就插话 / 排队）
                  const to = await call<{ id: string }>('POST', `/api/sessions/for/${x.id}`)
                  if (!to) return
                  if (await call('POST', `/api/sessions/${to.id}/messages`, { text: `转自「${emp.name}」：\n${msgText(forward)}`, files: [] })) toast(`已转给「${x.name}」`)
                  setForward(null)
                  return
                }
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

      {((emp.contextUsed ?? 0) >= 80 || (LIVE && messages.length >= 300)) && !session.working && !ctxOff(ctxKey(emp.id, emp.works?.[0]?.no)) && (
        <div className="ctx-warn">
          <span>{(emp.contextUsed ?? 0) >= 80 ? `上下文用了 ${emp.contextUsed}%，快满了` : '这个会话很长了'}</span>
          {!LIVE && <button className="btn ghost sm" onClick={() => compactContext(session.id, emp.id)}>压缩</button>}
          <button className="btn ghost sm" onClick={() => { setCtxOff(ctxKey(emp.id, emp.works?.[0]?.no)); setCtxTick((n) => n + 1) }}>先不换</button>
          <button className="btn primary sm" onClick={() => switchWork(session.id, emp.id, '上下文快满了')}>{LIVE ? '开新会话接着做' : '换 work'}</button>
        </div>
      )}
      {session.working && !messages.some((x) => x.kind === 'status' && x.spinning) && (
        <div className="working-bar">
          <i className="spinner" /><span>{session.working}</span>
          {!mobile && <button className="btn stop" onClick={() => stopWorking(session.id)}>停止</button>}
        </div>
      )}

      {LIVE && myQueue.length > 0 && (
        <div className="queue-box">
          <div className="queue-head">
            <b>排队中 · {myQueue.length}</b>
            <span className="sub">{session.working ? '这一轮做完按顺序自动发' : '员工闲着，点右边开始'}</span>
            <span className="grow" />
            {!session.working && <button className="btn primary sm" onClick={() => call('POST', `/api/sessions/${session.id}/queue/run`)}>开始处理排队</button>}
          </div>
          {myQueue.map((q, i) => (
            <div key={q.id} className="queue-item">
              <span className="queue-n">{i + 1}</span>
              {editQ?.id === q.id
                ? <textarea className="queue-edit" autoFocus rows={2} value={editQ.text} onChange={(e) => setEditQ({ id: q.id, text: e.target.value })}
                    onCompositionEnd={onComposeEnd} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !imeEnter(e)) { e.preventDefault(); saveQ() } if (e.key === 'Escape') setEditQ(null) }} onBlur={saveQ} data-no-i18n="" />
                : <span className="queue-text" data-no-i18n="" title="点一下改" onClick={() => setEditQ({ id: q.id, text: q.text })}>{q.text || '（只有附件）'}</span>}
              {q.files.length > 0 && (
                <span className="queue-files">
                  {q.files.slice(0, 4).map((f) => (f.image ? <img key={f.id} src={f.url} alt={f.name} /> : <span key={f.id} className="queue-file" title={f.name}>📎</span>))}
                  {q.files.length > 4 && <em>+{q.files.length - 4}</em>}
                </span>
              )}
              <button className="queue-x" aria-label="删掉这条" title="删掉这条（连它的附件）" onClick={() => call('DELETE', `/api/queue/${q.id}`)}>×</button>
            </div>
          ))}
        </div>
      )}

      <footer className="chat-foot">
        {LIVE && pend.length > 0 && (
          <div className="pend-row">
            {pend.map((p) => (
              <div key={p.key} className={'pend' + (p.err ? ' err' : '') + (p.busy ? ' busy' : '')} title={p.name}>
                {p.image && p.preview ? <img src={p.preview} alt={p.name} /> : <span className="pend-icon">📎</span>}
                <span className="pend-name" data-no-i18n="">{p.busy ? '…' : p.err ? p.err : p.name}</span>
                <button aria-label="撤回" onClick={() => dropPending(p.key)}>×</button>
              </div>
            ))}
          </div>
        )}
        {mobile ? (
          <>
            {/* 手机：底部菜单（项目名等）+ 常用语合成输入框上面一排小标签，能左右滑；不再单独占一行菜单条 */}
            {(emp.menus.length > 0 || (LIVE && phrases.length > 0)) && (
              <div className="m-quick">
                {emp.menus.map((m) => <button key={m} type="button" className="m-menu-chip" onClick={() => onMenu(m)}>{menuLabel(m)}</button>)}
                {emp.menus.length > 0 && LIVE && phrases.length > 0 && <i className="m-quick-sep" />}
                {LIVE && phrases.length > 0 && <PhraseChips phrases={phrases} editing={editPh} setEditing={setEditPh} text={text} onPick={(p) => setText((t) => (t ? `${t}\n${p}` : p))} />}
              </div>
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
                    if (rec && !rec.cancel) sendMessage(session.id, Date.now() - rec.start < 800 ? '（语音太短，原型里按住久一点）' : '（语音转文字）帮我看下 dev-1 的内存为什么这么高')
                    setRec(null)
                  }}
                  onPointerCancel={() => setRec(null)}>
                  {rec ? '松开 发送' : '按住 说话'}
                </button>
              ) : (
                <input value={text} onChange={(e) => setText(e.target.value)} onCompositionEnd={onComposeEnd} onKeyDown={(e) => { if (e.key === 'Enter' && !imeEnter(e)) send() }}
                  placeholder={session.working ? (codex ? '在干活，这时发 = 排队' : '在干活，这时发 = 插话') : `跟「${emp.name}」说点什么`} enterKeyHint="send" />
              )}
              {!voice && (text.trim() || (LIVE && readyAtts.length > 0))
                ? (
                  <>
                    {LIVE && session.working && !codex && <button className="btn ghost sm queue-btn" disabled={sending} onClick={() => send('queue')}>排队</button>}
                    {LIVE && !session.working && <button className="round-btn" onClick={() => setSheet('attach')} aria-label="附件"><IconPlus /></button>}
                    {LIVE && canDictate() && <button className={'round-btn' + (listening ? ' on' : '')} onClick={talk} aria-label="说话"><IconMic /></button>}
                    <button className="round-btn primary" disabled={sending} onClick={() => send()} aria-label="发送"><IconSend /></button>
                  </>
                )
                : session.working
                  ? <button className="round-btn stop" onClick={() => stopWorking(session.id)} aria-label="停止"><i /></button>
                  : <>
                      {LIVE && canDictate() && <button className={'round-btn' + (listening ? ' on' : '')} onClick={talk} aria-label="说话"><IconMic /></button>}
                      <button className="round-btn" onClick={() => setSheet('attach')} aria-label="附件"><IconPlus /></button>
                    </>}
            </div>
          </>
        ) : (
          <>
            <div className="composer-ctl">
              {LIVE && <PhraseChips phrases={phrases} editing={editPh} setEditing={setEditPh} text={text} onPick={(p) => setText((t) => (t ? `${t}\n${p}` : p))} />}
              {emp.menus.length > 0 && (
                <>
                  <span className="grow" />
                  <nav className="menu-chips" aria-label="底部菜单">
                    <span className="menu-chips-icon"><IconMenu /></span>
                    {emp.menus.map((m) => <button key={m} onClick={() => onMenu(m)} title={m === '改动记录' && ws ? `${ws.name}：提交、分支、编译和发布` : m}>{menuLabel(m)}</button>)}
                  </nav>
                </>
              )}
            </div>
            <div className="composer-send">
              <button className="icon-btn boxed" onClick={() => setSheet('attachD')} aria-label="发图片 / 文件" title="发图片 / 文件 / 截图"><IconPlus /></button>
              {LIVE && canDictate() && <button className={'icon-btn boxed' + (listening ? ' on' : '')} onClick={talk} aria-label="说话" title={listening ? '在听…' : '说话转文字'}><IconMic /></button>}
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2}
                onPaste={onPaste} onCompositionEnd={onComposeEnd}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !imeEnter(e)) { e.preventDefault(); send() } }}
                placeholder={session.working ? (codex ? `「${emp.name}」在干活，这时发的话会排队…` : `「${emp.name}」在干活，这时发的话会插进去…`) : `跟「${emp.name}」说点什么…`} />
              {LIVE && session.working && !codex && <button className="btn default" disabled={sending || !canSend} onClick={() => send('queue')} title="等这一轮做完再发（图片、文件一起）">排队</button>}
              <button className="btn primary" onClick={() => send()} disabled={sending || !(LIVE ? canSend : text.trim())}><IconSend />{LIVE && session.working ? (codex ? '排队' : '插话') : '发送'}</button>
            </div>
            <span className="composer-hint">Enter 发送 · Shift + Enter 换行 · 截图粘贴 / 图片拖进来都会先裁剪再发{session.working ? (LIVE ? (codex ? ' · 在干活时发的话会排队，做完按顺序发' : ' · 回车 = 插话；点「排队」= 这一轮做完再发（附件一起）') : ' · 在干活时发的话会插进去') : ''}</span>
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

      {sheet === 'menus' && (
        <Sheet title="菜单" onClose={() => setSheet(null)}>
          <div className="sheet-list">
            {emp.menus.map((m) => <Row key={m} title={menuLabel(m)} chevron onClick={() => { setSheet(null); onMenu(m) }} />)}
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
            {['图片', '拍照', '截图', '文件', ...(LIVE ? ['常用语'] : [])].map((k) => (
              <button key={k} onClick={() => (k === '常用语' ? setSheet('phrases') : attach(k))}><span className="ws-icon">{k.slice(0, 1)}</span>{k}</button>
            ))}
          </div>
        </Sheet>
      )}
      {sheet === 'phrases' && (
        <Sheet title="常用语" onClose={() => setSheet(null)}>
          <div className="sheet-list">
            {phrases.length === 0 && <Empty>还没有：在输入框里写好，点下面「存成常用语」</Empty>}
            {phrases.map((p) => (
              <Row key={p} title={<span data-no-i18n="">{p}</span>} onClick={() => { setText((t) => (t ? `${t}\n${p}` : p)); setSheet(null) }}
                right={<button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); setSettings({ phrases: phrases.filter((x) => x !== p) }) }}>删</button>} />
            ))}
          </div>
          <div className="pad row-actions">
            <button className="btn primary sm" disabled={!text.trim() || phrases.includes(text.trim())} onClick={() => { setSettings({ phrases: [...phrases, text.trim()].slice(-30) }); toast('已存成常用语') }}>把输入框里的存成常用语</button>
          </div>
        </Sheet>
      )}
    </section>
  )
}

/** 常用语：直接摆出来（每个最多显示 6 个字，悬停看全文），点一下填进输入框；「编辑」时每个带 ×，还能把输入框里的存成一条 */
function PhraseChips({ phrases, editing, setEditing, text, onPick }: { phrases: string[]; editing: boolean; setEditing: (v: boolean) => void; text: string; onPick: (p: string) => void }) {
  const short = (p: string) => { const a = Array.from(p.replace(/\s+/g, ' ').trim()); return a.length > 6 ? `${a.slice(0, 6).join('')}…` : a.join('') }
  const t = text.trim()
  return (
    <span className="phrase-chips">
      {phrases.map((p) => (
        <span key={p} className={'phrase-chip' + (editing ? ' edit' : '')}>
          <button type="button" title={p} onClick={() => (editing ? undefined : onPick(p))} data-no-i18n="">{short(p)}</button>
          {editing && <button type="button" className="phrase-x" aria-label="删掉" onClick={() => setSettings({ phrases: phrases.filter((x) => x !== p) })}>×</button>}
        </span>
      ))}
      {editing && <button type="button" className="phrase-chip add" disabled={!t || phrases.includes(t)} title={t ? '把输入框里的话存成常用语' : '先在输入框里写好'} onClick={() => { setSettings({ phrases: [...phrases, t].slice(-30) }); toast('已存成常用语') }}>+ 存输入框里的</button>}
      <button type="button" className="ctx-chip" onClick={() => setEditing(!editing)}>{editing ? '完成' : phrases.length ? '编辑' : '+ 常用语'}</button>
    </span>
  )
}

const msgText = (m: Message) => m.text ?? (m.card ? String(m.card.data.title ?? '') : m.file?.name ?? '')

/** 状态那行字超过 10 秒没变，就在后面走秒：长时间思考 / 跑长命令时也看得出它还在动 */
function Since() {
  const [t0] = useState(() => Date.now())
  const [now, setNow] = useState(t0)
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const sec = Math.floor((now - t0) / 1000)
  if (sec < 10) return null
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return <span className="typing-since">{m ? `已 ${m} 分 ${s} 秒` : `已 ${s} 秒`}</span>
}

// 像微信：每条消息左边（对方）/ 右边（我）带头像，气泡带小尖角；时间不一样时中间插一条时间
function MessageView({ m, foot, owner, showTime, onCardAction, onMenu, onCopy, onForward, working, onStop }: {
  m: Message; foot?: Message; owner: string; showTime: boolean; onCardAction: Props['onCardAction']; onMenu: (x: number, y: number) => void; onCopy: () => void; onForward: () => void
  working?: string; onStop?: () => void
}) {
  const press = useRef<number | null>(null)
  const time = showTime ? <div className="time-sep">{m.at}</div> : null
  if (m.kind === 'system') return <>{time}<div className="sys-line"><span>{m.text}</span></div></>
  if (m.kind === 'status') {
    // 员工在干活：和消息一样带它的头像，气泡里跳三个点 + 它现在在做什么，旁边「停止」（像聊天软件的「对方正在输入」）
    if (m.spinning) {
      const what = (working || m.text || '').replace(new RegExp(`^${empName(owner).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`), '')
      return (
        <div className="msg-row typing-row">
          <span className="msg-av"><Avatar id={owner} size={38} /></span>
          <div className="msg-col">
            <div className="bubble typing">
              <span className="typing-dots"><i /><i /><i /></span>
              <span className="typing-what">{what || '在想…'}</span>
              <Since key={what} />
              {onStop && <button type="button" className="typing-stop" onClick={onStop} title="让它停下">停止</button>}
            </div>
          </div>
        </div>
      )
    }
    return <div className="status-line"><i className="dot-ok" /><span>{m.text}</span></div>
  }
  const me = m.from === 'me'
  // 前面没有员工的话可挂：小结自己一行小字（和头像对齐，不要气泡）
  if (m.card?.type === 'run') return <div className="msg-row run-row"><span className="msg-av" /><div className="msg-col"><RunFoot card={m.card} onAction={onCardAction} /></div></div>
  // 长按 0.5 秒（手机）/ 右键（电脑）出菜单
  const hold = {
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); onMenu(e.clientX, e.clientY) },
    onTouchStart: (e: React.TouchEvent) => { const t = e.touches[0]; press.current = window.setTimeout(() => onMenu(t.clientX, t.clientY), 500) },
    onTouchEnd: () => { if (press.current) clearTimeout(press.current) },
    onTouchMove: () => { if (press.current) clearTimeout(press.current) },
  }
  const body = me
    ? (m.kind === 'file' && m.file ? <FileBubble f={m.file} /> : <div className="bubble me" data-no-i18n={LIVE ? '' : undefined} {...hold}>{m.text}</div>)
    : (
      <>
        {m.kind === 'text' && <div className="bubble" data-no-i18n={LIVE && m.from !== 'system' ? '' : undefined} {...hold}><Markdown text={m.text ?? ''} /></div>}
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
          {/* 复制 / 转发：有小结时和它放一行末尾（鼠标放上去才出现，不单独占一行） */}
          {foot?.card ? (
            <div className="msg-under">
              <RunFoot card={foot.card} onAction={onCardAction} />
              <span className="msg-acts">
              {(m.text || m.card) && <button type="button" title="复制" onClick={onCopy}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>复制</button>}
                <button type="button" title="转发给别的员工" onClick={onForward}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l6 6-6 6" /><path d="M21 11H9a6 6 0 0 0-6 6v2" /></svg>转发</button>
              </span>
            </div>
          ) : (m.text || m.card || m.file) && (
            <span className="msg-acts">
              {(m.text || m.card) && <button type="button" title="复制" onClick={onCopy}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>复制</button>}
              <button type="button" title="转发给别的员工" onClick={onForward}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l6 6-6 6" /><path d="M21 11H9a6 6 0 0 0-6 6v2" /></svg>转发</button>
            </span>
          )}
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
