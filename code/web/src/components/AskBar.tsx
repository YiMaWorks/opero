// 「交给员工」：配置类的事不让人填表，说一句话（或点一个常用的），员工用自己的工具去配好。
// 发出去后跳到和那个员工的聊天，看它做、回答它的问题。
import { useState } from 'react'
import { getState, toast, useStore } from '../store'
import { call } from '../live'
import { Avatar } from './Avatar'
import type { Nav } from '../pages/nav'

export interface AskSuggestion { label: string; text: string }

export function AskBar({ emp, pick, nav, context, placeholder, suggestions = [], title = '跟员工说一句，它来配' }: {
  /** 默认交给谁：给了 id 用 id；不然按名字 / 职责认（比如 /运维/）；都没有就挑一个不绑项目的 */
  emp?: string
  pick?: RegExp
  nav: Nav
  /** 发出去时加在前面，告诉员工是在哪个页面、针对什么说的 */
  context?: string
  placeholder?: string
  suggestions?: AskSuggestion[]
  title?: string
}) {
  const employees = useStore((s) => s.employees)
  const [who, setWho] = useState(() => (emp && employees.some((e) => e.id === emp) ? emp
    : (pick && employees.find((e) => pick.test(`${e.name} ${e.title ?? ''}`))?.id) ?? employees.find((e) => !e.workspace)?.id ?? employees[0]?.id ?? ''))
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async (t = text) => {
    const body = t.trim()
    if (!body || !who) return
    setBusy(true)
    const r = await call<{ sid: string; queued?: boolean }>('POST', `/api/employees/${who}/ask`, { text: context ? `${context}\n\n${body}` : body })
    setBusy(false)
    if (!r) return
    setText('')
    if (r.queued) toast('它在忙，这句排上队了')
    // 会话可能是刚建的：等它从后台推过来再跳
    for (let i = 0; i < 20 && !getState().sessions.some((s) => s.id === r.sid); i++) await new Promise((res) => setTimeout(res, 100))
    nav.openChat(who)
  }
  return (
    <div className="ask-bar">
      <div className="ask-head">
        <span className="ask-title">{title}</span>
        {employees.length > 1 && (
          <label className="ask-who">
            <Avatar id={who} size={20} />
            <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="交给谁">
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {suggestions.length > 0 && (
        <div className="chips">
          {suggestions.map((s) => <button key={s.label} type="button" className="chip" disabled={busy} onClick={() => send(s.text)} title={s.text}>{s.label}</button>)}
        </div>
      )}
      <div className="ask-input">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send() }}
          placeholder={placeholder ?? '要做什么，直接说'} disabled={busy} />
        <button className="btn primary sm" disabled={busy || !text.trim()} onClick={() => send()}>{busy ? '在发…' : '交给它'}</button>
      </div>
    </div>
  )
}

/** 以前的表单收在这里：一般不用，AI 用不了的时候兜底 */
export function Manual({ children, label = '手动改（一般不用）' }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="manual">
      <button type="button" className="manual-toggle" onClick={() => setOpen(!open)}>{open ? '收起' : label}</button>
      {open && <div className="manual-body">{children}</div>}
    </div>
  )
}
