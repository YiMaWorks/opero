// 员工按项目分组（员工页、侧栏员工栏共用）：项目按项目列表的顺序，没有项目的放最后；组里置顶的排前面
import type { Employee, Session, Workspace } from './types'

export interface EmpGroup { key: string; ws?: Workspace; name: string; list: Employee[] }

export function empGroups(emps: Employee[], wss: Workspace[], sessions: Session[]): EmpGroup[] {
  const pinned = (e: Employee) => !!sessions.find((s) => s.employee === e.id)?.pinned
  const sort = (l: Employee[]) => [...l].sort((a, b) => Number(pinned(b)) - Number(pinned(a)))
  const groups: EmpGroup[] = []
  for (const w of wss) {
    const list = emps.filter((e) => e.workspace === w.id)
    if (list.length) groups.push({ key: w.id, ws: w, name: w.name, list: sort(list) })
  }
  const rest = emps.filter((e) => !e.workspace || !wss.some((w) => w.id === e.workspace))
  if (rest.length) groups.push({ key: '', name: '没有项目', list: sort(rest) })
  return groups
}
