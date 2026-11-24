// 排队：员工在干活时新消息先排着，这一轮做完按顺序发；每条带着自己的图片 / 文件。
//   员工在干活时你说的话：默认插话（Claude Code 输入通道开着）；点「排队」或者插不进去（Codex、输入通道关了）就排队。
//   排队的每一条带着它自己的图片和文件（已经传到员工目录的 uploads/，存的是文件名，轮到时一起交给员工）；
//   排队的东西存数据库，重启不丢；所有设备都看得到（SSE coll = queue），能删、能手动开始。
//   这一轮正常结束就按顺序自动发下一条；你点了「停止」就不自动发（等你点「开始处理排队」）。
//   排队的话轮到时才出现在聊天里（不然顺序会乱）。
import fs from 'node:fs'
import path from 'node:path'
import { all, del, get, put, uid } from './db.ts'
import { emit } from './bus.ts'
import { addMsg, patchSession, sessionFor, system } from './chat.ts'
import * as runner from './runner.ts'
import type { Employee } from './types.ts'

/** 一个附件：员工目录 uploads/ 里的文件名 + 给网页显示的信息 */
export interface QAtt { id: string; name: string; size: string; ext: string; image: boolean; mediaType: string; url: string; w?: number; h?: number }
export interface QItem { id: string; emp: string; sid: string; text: string; files: QAtt[]; at: number; source: 'me' | 'auto' }

export const MAX = 20

export const list = (emp: string) => all<QItem>('queue').filter((q) => q.emp === emp).sort((a, b) => a.at - b.at)

export function enqueue(emp: string, text: string, files: QAtt[], source: QItem['source'] = 'me'): QItem {
  if (list(emp).length >= MAX) throw new Error(`排队最多 ${MAX} 条，先等它做完或删几条`)
  const s = sessionFor(emp)
  const item: QItem = { id: uid('q'), emp, sid: s.id, text, files, at: Date.now(), source }
  put('queue', item)
  emit({ t: 'put', coll: 'queue', item })
  return item
}

/** 改一条还没发的（只改文字，附件不动） */
export function edit(id: string, text: string): QItem {
  const q = get<QItem>('queue', id)
  if (!q) throw new Error('这条已经发出去了')
  const next = { ...q, text: text.slice(0, 20000) }
  put('queue', next)
  emit({ t: 'put', coll: 'queue', item: next })
  return next
}

/** 删掉一条；dropFiles = 连它带的、还没发出去的文件一起删 */
export function remove(id: string, dropFiles = false) {
  const q = get<QItem>('queue', id)
  if (!q) return
  del('queue', id)
  emit({ t: 'del', coll: 'queue', id })
  if (dropFiles) {
    const emp = get<Employee>('employees', q.emp)
    if (emp) for (const f of q.files) { try { fs.unlinkSync(uploadPath(emp, f.id)) } catch { /* 已经没了 */ } }
  }
}

export const uploadPath = (emp: Employee, id: string) => path.join(runner.empHome(emp), 'uploads', path.basename(id))

/** 附件 → 交给执行器的样子（路径） */
export function toAttachments(emp: Employee, files: QAtt[]): runner.Attachment[] {
  return files.filter((f) => fs.existsSync(uploadPath(emp, f.id))).map((f) => ({ path: uploadPath(emp, f.id), name: f.name, mediaType: f.mediaType, image: f.image }))
}

/** 你的话（带图片 / 文件）出现在聊天里 */
export function post(sid: string, text: string, files: QAtt[]) {
  for (const f of files) addMsg(sid, { from: 'me', kind: 'file', file: { name: f.name, size: f.size, ext: f.ext, image: f.image, url: f.url, w: f.w, h: f.h } })
  if (text) addMsg(sid, { from: 'me', kind: 'text', text })
  patchSession(sid, { last: (text || (files[0]?.image ? '[图片]' : `[文件] ${files[0]?.name ?? ''}`)).slice(0, 80), unread: 0 })
}

/** 发一条排队的：先在聊天里出现，再交给员工 */
function dispatch(q: QItem) {
  const emp = get<Employee>('employees', q.emp)
  if (!emp) return
  if (q.source === 'me') post(q.sid, q.text, q.files)
  runner.send(emp.id, q.text || defaultText(q.files), toAttachments(emp, q.files))
}

export const defaultText = (files: QAtt[]) => (files.length > 1 ? '看一下这几个文件' : files[0]?.image ? '看一下这张图' : files.length ? '看一下这个文件' : '')

/** 员工闲了：发下一条 */
export function drain(emp: string) {
  if (runner.isWorking(emp)) return false
  const next = list(emp)[0]
  if (!next) return false
  remove(next.id)
  const left = list(emp).length
  if (left) system(next.sid, `开始处理排队的消息（后面还有 ${left} 条）`)
  dispatch(next)
  return true
}

// 接到执行器上：插不进去的话进队；一轮正常结束就发下一条
runner.setHooks({
  busy: (emp, text, files, why) => {
    const e = get<Employee>('employees', emp)
    const atts: QAtt[] = files.map((f) => ({ id: path.basename(f.local ?? f.path), name: f.name, size: '', ext: (f.name.split('.').pop() ?? '').toUpperCase().slice(0, 4), image: f.image, mediaType: f.mediaType, url: e ? `api/uploads/${e.id}/${encodeURIComponent(path.basename(f.local ?? f.path))}` : '' }))
    try { enqueue(emp, text, atts, 'auto'); system(sessionFor(emp).id, why ?? '员工在忙，已排队：这一轮做完接着做') } catch (err) { system(sessionFor(emp).id, (err as Error).message) }
  },
  idle: (emp, stopped) => { if (!stopped) setTimeout(() => drain(emp), 300) },
  // 这台有员工做完了：因为「同时最多几个」在排队的员工，轮到一个
  freed: (host) => setTimeout(() => {
    const waiting = [...new Set(all<QItem>('queue').map((q) => q.emp))].filter((id) => !runner.isWorking(id))
    for (const id of waiting) {
      const e = get<Employee>('employees', id)
      if (e && runner.hostOf(e) === host && drain(id)) return
    }
  }, 500),
})
