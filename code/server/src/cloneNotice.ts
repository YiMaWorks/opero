// 项目拉代码失败：别只记在项目上（主人在聊天里看不到）——写进这个项目员工的聊天、推送给主人、项目上标出原因。
import { all, get, put } from './db.ts'
import { emit, push } from './bus.ts'
import { addMsg, sessionFor } from './chat.ts'
import type { Employee, Workspace } from './types.ts'

/** 常见原因翻成人话：令牌不对 / 没权限、仓库地址不对、分支没有、网络连不上、磁盘满 */
export function cloneHint(msg: string): string {
  if (/Authentication failed|could not read Username|403|401|invalid credentials|access denied|HTTP Basic/i.test(msg)) return '仓库账号的令牌不对或者没有读这个仓库的权限：到「凭证 → 代码仓库」换一个令牌（要勾读仓库的权限）'
  if (/not found|does not exist|Repository not found|404/i.test(msg)) return '仓库地址不对，或者这个账号看不到这个仓库'
  if (/Remote branch .* not found|couldn't find remote ref/i.test(msg)) return '选的分支在仓库里没有：换一个分支'
  if (/Could not resolve host|Connection timed out|Connection refused|Failed to connect|timed out|Recv failure|reset by peer/i.test(msg)) return '那台服务器连不上代码平台（网络 / 防火墙 / 代理）'
  if (/No space left/i.test(msg)) return '那台服务器磁盘满了'
  if (/Agent 没响应|Agent 断开|不在线/.test(msg)) return '那台服务器的 Agent 不在线'
  return ''
}

export function cloneFailed(w: Workspace, msg: string) {
  const cur = get<Workspace>('workspaces', w.id) ?? w
  const next = { ...cur, last: '拉取失败', error: msg.slice(-400) }
  put('workspaces', next)
  emit({ t: 'put', coll: 'workspaces', item: next })
  const hint = cloneHint(msg)
  const text = `项目「${w.name}」的代码没拉下来${hint ? `：${hint}` : ''}。\n原因：${msg.slice(-300)}\n处理好后到「项目 → ${w.name}」点「刷新」重新拉；或者直接给员工发消息，它开工前会再拉一次。`
  for (const e of all<Employee>('employees').filter((x) => x.workspace === w.id)) addMsg(sessionFor(e.id).id, { from: 'system', kind: 'system', text })
  push({ kind: 'info', error: true, title: `项目「${w.name}」拉代码失败`, body: hint || msg.slice(-120), route: `workspace/${w.id}` })
}
