// 项目切分支：所有员工共用项目目录，切了大家一起换；主人在网页上切，或者员工用 switch_branch 切
import { all, put } from './db.ts'
import { emit } from './bus.ts'
import { audit, sessionFor, system } from './chat.ts'
import { inspect, switchBranch } from './git.ts'
import type { Employee, Workspace } from './types.ts'

export async function switchAndTell(w: Workspace, branch: string, by: string): Promise<{ workspace: Workspace; msg: string }> {
  const msg = await switchBranch(w, branch)
  const next = { ...w, ...(await inspect(w)) }
  put('workspaces', next)
  emit({ t: 'put', coll: 'workspaces', item: next })
  for (const e of all<Employee>('employees').filter((x) => x.workspace === w.id)) system(sessionFor(e.id).id, `${by}把项目「${w.name}」切到了分支 ${branch}`)
  audit({ via: by === '主人' ? '—' : by, action: 'workspace.branch', target: `${w.name} → ${branch}`, level: '写', result: '成功', how: by })
  return { workspace: next, msg }
}
