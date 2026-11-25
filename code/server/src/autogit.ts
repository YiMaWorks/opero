// 项目的自动 git（项目「干完自动提交推送」开着时，默认开）：
//   派活前：拉远端、带着没提交的改动变基到最新（--autostash）；有冲突就撤回，告诉员工先解决。
//   干完：有改动就提交（出错的、你点停止的都标「[未完成]」照样提交），再推送；被拒（别人先推了）就变基一次再推。
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
  // 停下的也提交推送（标「[未完成]」），和 KidLock 一样：远端随时是最新，做了一半的也不丢
  if (!autoOn(w)) return ''
  const done = o.ok && !o.stopped
  const lines: string[] = []
  try {
    await git(['add', '-A'], on(w))
    const st = await git(['status', '--porcelain'], on(w))
    if (st.out.trim()) {
      const subject = (o.ask.replace(/\s+/g, ' ').trim() || '按主人的要求修改').slice(0, 72)
      const msg = `${done ? '' : '[未完成] '}${subject}\n\n${emp.name} · Opero`
      const c = await git(['-c', `user.name=${emp.name}`, '-c', `user.email=${emp.id}@opero.local`, 'commit', '-q', '-m', msg], on(w))
      if (c.code !== 0) return `自动提交失败：${c.out.slice(-200)}`
      lines.push(`已提交${done ? '' : `（这一轮${o.stopped ? '你让停下了' : '没做完'}，标了「[未完成]」）`}`)
    }
    if (!w.credential) return lines.length ? `${lines[0]}（没配仓库令牌，没推送）` : ''
    const up = await git(['rev-parse', '--abbrev-ref', '@{u}'], on(w))
    const ahead = up.code === 0 ? Number((await git(['rev-list', '--count', '@{u}..HEAD'], on(w))).out) || 0 : 1
    if (!ahead) return lines.join('')
    const p = await pushHead(w)
    if (p.conflict) return `${lines.join('')}，但推送被拒、变基有冲突，没推上去：下次让员工先 git_sync 解决冲突`
    const head = (await git(['log', '-1', '--format=%h %s'], on(w))).out
    lines.push(p.code === 0 ? `${lines.length ? '并' : ''}推送到远端（${head}）` : `${lines.length ? '，' : ''}推送失败：${p.out.slice(-200)}`)
    return lines.join('')
  } finally {
    await handBackDir(w.server, w.dir)
    refreshInfo(w)
  }
}

/** 推送；被拒（别人先推了）就拉一次、变基再推。变基有冲突就撤回，conflict = true */
async function pushHead(w: Workspace): Promise<{ code: number; out: string; conflict?: boolean }> {
  let p = await git(['push', '-u', 'origin', 'HEAD'], withCred(w))
  if (p.code !== 0 && /rejected|fetch first|non-fast-forward/i.test(p.out)) {
    await git(['fetch', '--all', '--prune'], withCred(w))
    const r = await git(['-c', 'user.name=opero', '-c', 'user.email=opero@opero.local', 'rebase', '@{u}'], on(w))
    if (r.code !== 0) {
      await git(['rebase', '--abort'], on(w))
      return { code: 1, out: r.out, conflict: true }
    }
    p = await git(['push', '-u', 'origin', 'HEAD'], withCred(w))
  }
  return p
}

function refreshInfo(w: Workspace) {
  const cur = get<Workspace>('workspaces', w.id)
  if (cur) inspect(cur).then((info) => { const next = { ...cur, ...info }; put('workspaces', next); emit({ t: 'put', coll: 'workspaces', item: next }) }).catch(() => {})
}

/** 当前提交（开工时记下来，干完和它比，就是这一轮的改动） */
export async function head(w: Workspace): Promise<string> {
  const r = await git(['rev-parse', 'HEAD'], on(w)).catch(() => ({ code: 1, out: '' }))
  return r.code === 0 ? r.out.trim() : ''
}

export interface RunDiff { after: string; files: number; ins: number; del: number; list: { f: string; a: number; d: number }[]; pushed: boolean; revertible: boolean }

/** 这一轮改了什么：开工时的提交 → 现在（没开自动提交的，比到工作区） */
export async function runDiff(w: Workspace, before: string): Promise<RunDiff | null> {
  if (!before) return null
  try {
    const after = await head(w)
    const auto = autoOn(w)
    const range = auto ? [before, after] : [before]
    const num = await git(['diff', '--numstat', '-M', ...range], on(w))
    if (num.code !== 0) return null
    const all = num.out.split('\n').filter(Boolean).map((l) => { const [a, d, ...f] = l.split('\t'); return { f: f.join('\t'), a: Number(a) || 0, d: Number(d) || 0 } })
    const linear = auto && after !== before && (await git(['merge-base', '--is-ancestor', before, after], on(w))).code === 0
    const up = await git(['rev-parse', '@{u}'], on(w))
    const pushed = up.code === 0 && (await git(['merge-base', '--is-ancestor', after, '@{u}'], on(w))).code === 0
    return { after, files: all.length, ins: all.reduce((s, x) => s + x.a, 0), del: all.reduce((s, x) => s + x.d, 0), list: all.slice(0, 40), pushed, revertible: linear && all.length > 0 }
  } catch { return null } finally { await handBackDir(w.server, w.dir) }
}

/** 撤销一轮的改动：before..after 反着提交一次再推送（不改历史）；有冲突就放弃，原样不动 */
export async function revertRun(w: Workspace, before: string, after: string, title: string): Promise<string> {
  try {
    if ((await git(['status', '--porcelain'], on(w))).out.trim()) throw new Error('项目里有还没提交的改动，先让员工提交了再撤销')
    if ((await git(['merge-base', '--is-ancestor', after, 'HEAD'], on(w))).code !== 0) throw new Error('这次的提交已经不在当前分支上了（换过分支或被改过历史）')
    const r = await git(['revert', '--no-commit', '--no-edit', `${before}..${after}`], on(w))
    if (r.code !== 0) {
      await git(['revert', '--abort'], on(w))
      throw new Error(`后面的改动动过同样的地方，撤不干净，没动：${r.out.slice(-200)}`)
    }
    const msg = `撤销：${title.replace(/\s+/g, ' ').trim().slice(0, 60) || '上一轮的改动'}\n\nRevert ${before.slice(0, 7)}..${after.slice(0, 7)} · Opero`
    const c = await git(['-c', 'user.name=opero', '-c', 'user.email=opero@opero.local', 'commit', '-q', '-m', msg], on(w))
    if (c.code !== 0) throw new Error(`提交失败：${c.out.slice(-200)}`)
    if (!w.credential) return '已撤销（没配仓库令牌，没推送）'
    const p = await pushHead(w)
    return p.code === 0 ? '已撤销并推送' : p.conflict ? '已在本地撤销，推送时和远端冲突，没推上去' : `已在本地撤销，推送失败：${p.out.slice(-160)}`
  } finally {
    await handBackDir(w.server, w.dir)
    refreshInfo(w)
  }
}

/** 只读参考的项目：派活前也拉到最新（只快进，不动本地改动），员工每次看到的都是远端最新的代码。出错不挡派活 */
export async function refreshRead(w: Workspace): Promise<string> {
  if (!w.credential) return ''
  try {
    const f = await git(['fetch', '--all', '--prune'], withCred(w))
    if (f.code !== 0) return `（Opero：只读参考的「${w.name}」拉不到远端最新：${f.out.slice(-120)}）`
    const dirty = (await git(['status', '--porcelain'], on(w))).out.trim()
    const up = await git(['rev-parse', '--abbrev-ref', '@{u}'], on(w))
    if (!dirty && up.code === 0) await git(['merge', '--ff-only', '-q', '@{u}'], on(w))
    return ''
  } catch { return '' } finally {
    await handBackDir(w.server, w.dir)
  }
}
