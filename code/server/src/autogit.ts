// 工作空间的自动 git（工作空间「干完自动提交推送」开着时，默认开）：
//   派活前：拉远端、带着没提交的改动变基到最新（--autostash）；有冲突就撤回，告诉员工先解决。
//   干完：有改动就提交（这一轮出错的标「[未完成]」，你点停止的不提交），再推送；被拒（别人先推了）就变基一次再推。
// 令牌只在 Opero 这边用（git.ts），员工拿不到。
import { git, handBackDir, inspect } from './git.ts'
import { get, put } from './db.ts'
import { emit } from './bus.ts'
import type { Employee, Workspace } from './types.ts'

const on = (w: Workspace) => ({ host: w.server, cwd: w.dir })
const withCred = (w: Workspace) => ({ ...on(w), cred: w.credential, timeoutMs: 180_000 })
export const autoOn = (w?: Workspace) => !!w && w.autoSync !== false

/** 派活前同步；返回要告诉员工的话（没事返回空）。员工设了自己的分支就先切过去（没有就从主分支拉一个），没设就切回主分支 */
export async function preSync(w: Workspace, emp?: Employee): Promise<string> {
  if (!autoOn(w)) return ''
  try {
    const notes: string[] = []
    if (w.credential) {
      const f = await git(['fetch', '--all', '--prune'], withCred(w))
      if (f.code !== 0) return `（Opero：开工前拉远端失败，先用本地代码干：${f.out.slice(-200)}）`
    }
    const want = emp?.workBranch || w.branch
    const cur = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], on(w))).out.trim()
    if (want && cur !== want) {
      const dirty = (await git(['status', '--porcelain'], on(w))).out.trim()
      if (dirty) notes.push(`（Opero：工作区有没提交的改动，没切到分支 ${want}，现在在 ${cur}）`)
      else {
        const local = (await git(['rev-parse', '--verify', '-q', `refs/heads/${want}`], on(w))).code === 0
        const remote = (await git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${want}`], on(w))).code === 0
        const base = w.branch && (await git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${w.branch}`], on(w))).code === 0 ? `origin/${w.branch}` : 'HEAD'
        const r = local ? await git(['checkout', '-q', want], on(w)) : remote ? await git(['checkout', '-q', '-b', want, '--track', `origin/${want}`], on(w)) : await git(['checkout', '-q', '-b', want, base], on(w))
        notes.push(r.code === 0 ? (emp?.workBranch ? `（Opero：你在自己的分支 ${want} 上干活${local || remote ? '' : `，刚从 ${base} 拉出来`}；做完用 pr_create 提合并请求）` : '') : `（Opero：切到分支 ${want} 失败：${r.out.slice(-200)}）`)
      }
    } else if (emp?.workBranch) notes.push(`（Opero：你在自己的分支 ${want} 上干活；做完用 pr_create 提合并请求）`)
    if (!w.credential) return notes.filter(Boolean).join('\n')
    const up = await git(['rev-parse', '--abbrev-ref', '@{u}'], on(w))
    if (up.code !== 0) return notes.filter(Boolean).join('\n')
    const r = await git(['-c', 'user.name=opero', '-c', 'user.email=opero@opero.local', 'rebase', '--autostash', '@{u}'], on(w))
    if (r.code !== 0) {
      await git(['rebase', '--abort'], on(w))
      notes.push(`（Opero：远端有新提交，和本地改动冲突，没能自动变基。先用 git_sync 拉最新、解决冲突再干：${r.out.slice(-300)}）`)
    }
    return notes.filter(Boolean).join('\n')
  } finally { await handBackDir(w.server, w.dir) }
}

/** 干完提交推送；返回给聊天看的一句话（没东西可提交 / 推送就返回空） */
export async function postSync(w: Workspace, emp: Employee, o: { ok: boolean; stopped: boolean; ask: string }): Promise<string> {
  if (!autoOn(w) || o.stopped) return ''
  const lines: string[] = []
  try {
    await git(['add', '-A'], on(w))
    const st = await git(['status', '--porcelain'], on(w))
    if (st.out.trim()) {
      const subject = (o.ask.replace(/\s+/g, ' ').trim() || '按主人的要求修改').slice(0, 72)
      const msg = `${o.ok ? '' : '[未完成] '}${subject}\n\n${emp.name} · Opero`
      const c = await git(['-c', `user.name=${emp.name}`, '-c', `user.email=${emp.id}@opero.local`, 'commit', '-q', '-m', msg], on(w))
      if (c.code !== 0) return `自动提交失败：${c.out.slice(-200)}`
      lines.push(`已提交${o.ok ? '' : '（这一轮没做完，标了「[未完成]」）'}`)
    }
    if (!w.credential) return lines.length ? `${lines[0]}（没配仓库令牌，没推送）` : ''
    const up = await git(['rev-parse', '--abbrev-ref', '@{u}'], on(w))
    const ahead = up.code === 0 ? Number((await git(['rev-list', '--count', '@{u}..HEAD'], on(w))).out) || 0 : 1
    if (!ahead) return lines.join('')
    let p = await git(['push', '-u', 'origin', 'HEAD'], withCred(w))
    if (p.code !== 0 && /rejected|fetch first|non-fast-forward/i.test(p.out)) {
      await git(['fetch', '--all', '--prune'], withCred(w))
      const r = await git(['-c', 'user.name=opero', '-c', 'user.email=opero@opero.local', 'rebase', '@{u}'], on(w))
      if (r.code !== 0) {
        await git(['rebase', '--abort'], on(w))
        return `${lines.join('')}，但推送被拒、变基有冲突，没推上去：下次让员工先 git_sync 解决冲突`
      }
      p = await git(['push', '-u', 'origin', 'HEAD'], withCred(w))
    }
    const head = (await git(['log', '-1', '--format=%h %s'], on(w))).out
    lines.push(p.code === 0 ? `${lines.length ? '并' : ''}推送到远端（${head}）` : `${lines.length ? '，' : ''}推送失败：${p.out.slice(-200)}`)
    return lines.join('')
  } finally {
    await handBackDir(w.server, w.dir)
    const cur = get<Workspace>('workspaces', w.id)
    if (cur) inspect(cur).then((info) => { const next = { ...cur, ...info }; put('workspaces', next); emit({ t: 'put', coll: 'workspaces', item: next }) }).catch(() => {})
  }
}
