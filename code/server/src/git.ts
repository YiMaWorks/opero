// 工作空间 = 一个 git 仓库拉到员工干活的目录。拉取 / 同步 / 推送由 Opero 用保险箱里的令牌做（经 GIT_ASKPASS 传，不写进 URL、不进 .git/config），
// AI 在里面改代码、commit，要同步远端就调 MCP 工具 git_sync，令牌永远不给它。
// 工作空间可以在 Opero 这台（local），也可以在装了 Agent 的服务器上（经 Agent 以 root 跑 git，跑完把目录还给 AI 用户）。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { cfg } from './config.ts'
import { get } from './db.ts'
import { getSecret, scrub } from './vault.ts'
import * as agents from './agents.ts'
import * as hosts from './hosts.ts'
import type { Credential, Workspace } from './types.ts'

const askpass = path.join(cfg.data, 'git-askpass.sh')
fs.writeFileSync(askpass, '#!/bin/sh\ncase "$1" in\n  Username*) printf "%s" "$OPERO_GIT_USER" ;;\n  *) printf "%s" "$OPERO_GIT_PASS" ;;\nesac\n', { mode: 0o700 })

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export async function git(args: string[], opts: { cwd?: string; cred?: string; timeoutMs?: number; host?: string } = {}): Promise<{ code: number; out: string }> {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' }
  let secret: string | undefined
  if (opts.cred) {
    const c = get<Credential>('credentials', opts.cred)
    secret = getSecret(opts.cred)
    if (secret) Object.assign(env, { OPERO_GIT_USER: c?.user || 'x-access-token', OPERO_GIT_PASS: secret })
  }
  const all = ['-c', 'safe.directory=*', '-c', 'credential.helper=', ...args]
  if (!hosts.isLocal(opts.host)) {
    // Agent 看到 OPERO_GIT_PASS 会自己配 GIT_ASKPASS（它那台上的）
    const r = await agents.exec(opts.host!, `git ${all.map(q).join(' ')}`, { cwd: opts.cwd ?? '/', env, timeoutMs: opts.timeoutMs ?? 120_000 })
    return { code: r.code, out: scrub(r.out, [secret]).trim() }
  }
  if (secret) env.GIT_ASKPASS = askpass
  return new Promise((resolve) => {
    const p = spawn('git', all, { cwd: opts.cwd, env: { ...process.env as Record<string, string>, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (b) => { out += b })
    p.stderr.on('data', (b) => { out += b })
    const t = setTimeout(() => p.kill('SIGKILL'), opts.timeoutMs ?? 120_000)
    p.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? -1, out: scrub(out, [secret]).trim() }) })
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: String(e) }) })
  })
}

/** 远程的工作空间：root 跑完 git 后把目录还给 AI 用户（不然它改不了） */
async function handBack(w: Workspace) {
  if (hosts.isLocal(w.server)) return
  await agents.exec(w.server!, `chown -R opero-ai:opero-work ${q(w.dir)} 2>/dev/null; chmod -R g+rwX ${q(w.dir)} 2>/dev/null; true`, { timeoutMs: 120_000 })
}

export const providerOf = (url: string) => (/github\.com/i.test(url) ? 'GitHub' : /codeup\.aliyun/i.test(url) ? 'Codeup' : /gitee\.com/i.test(url) ? 'Gitee' : /gitlab/i.test(url) ? 'GitLab' : 'Git')

export function workspaceDir(name: string, host?: string) {
  return path.posix.join(hosts.workRoot(host), 'ws', name.replace(/[^\w.-]+/g, '-'))
}

const on = (w: Workspace) => ({ host: w.server, cwd: w.dir })

export async function cloneWorkspace(w: Workspace): Promise<string> {
  if (hosts.isLocal(w.server)) {
    fs.mkdirSync(path.dirname(w.dir), { recursive: true, mode: 0o2770 })
    if (fs.existsSync(path.join(w.dir, '.git'))) return '已经拉过了'
  } else {
    const r = await agents.exec(w.server!, `mkdir -p ${q(path.posix.dirname(w.dir))} && test -d ${q(w.dir + '/.git')} && echo HAVE || true`)
    if (r.code !== 0) throw new Error(r.out.slice(-300) || '那台服务器的 Agent 没响应')
    if (r.out.includes('HAVE')) return '已经拉过了'
  }
  const r = await git(['clone', ...(w.branch ? ['--branch', w.branch] : []), w.repo, w.dir], { cred: w.credential, timeoutMs: 600_000, host: w.server })
  if (r.code !== 0) throw new Error(r.out.slice(-600) || '拉取失败')
  await git(['config', 'core.sharedRepository', 'group'], on(w))
  await handBack(w)
  return r.out
}

/** 读分支、最近提交、docs 下的文档 */
export async function inspect(w: Workspace): Promise<Partial<Workspace>> {
  if (hosts.isLocal(w.server) && !fs.existsSync(path.join(w.dir, '.git'))) return { error: '还没拉下来' }
  const [br, log, cur, dl] = await Promise.all([
    git(['for-each-ref', '--sort=-committerdate', '--count=12', '--format=%(refname:short)\t%(committerdate:relative)', 'refs/heads', 'refs/remotes'], on(w)),
    git(['log', '-15', '--format=%h%x09%s%x09%an%x09%cr'], on(w)),
    git(['rev-parse', '--abbrev-ref', 'HEAD'], on(w)),
    git(['ls-files', 'docs'], on(w)),
  ])
  if (cur.code !== 0) return { error: cur.out.slice(-300) || '还没拉下来' }
  const branches = br.out.split('\n').filter((l) => l && !l.endsWith('/HEAD') && !l.startsWith('origin\t')).map((l) => {
    const [name, when] = l.split('\t')
    return { name, status: name === cur.out ? `当前 · ${when}` : when }
  })
  const commits = log.out.split('\n').filter(Boolean).map((l) => { const [sha, msg, who, when] = l.split('\t'); return { sha, msg, who, when } })
  const docs = dl.out.split('\n').filter((f) => /^docs\/[^/]+\.md$/.test(f)).slice(0, 30).map((f) => ({ name: f.slice(5), updated: '' }))
  return { branches, commits, docs, branch: cur.out || w.branch, last: commits[0]?.when ?? w.last, error: undefined }
}

/** 同步：拉远端（可选变基到远端）、可选推送 */
export async function syncWorkspace(w: Workspace, o: { rebase?: boolean; push?: boolean }): Promise<string> {
  const lines: string[] = []
  const withCred = { ...on(w), cred: w.credential }
  const f = await git(['fetch', '--all', '--prune'], withCred)
  lines.push(f.code === 0 ? '已拉取远端' : `拉取失败：${f.out.slice(-300)}`)
  if (f.code !== 0) { await handBack(w); return lines.join('\n') }
  if (o.rebase !== false) {
    const st = await git(['status', '--porcelain'], on(w))
    if (st.out) lines.push('有没提交的改动，没有变基（先 commit）')
    else {
      const r = await git(['pull', '--rebase'], withCred)
      if (r.code !== 0) { await git(['rebase', '--abort'], on(w)); lines.push(`变基有冲突，已撤回，原样不动：${r.out.slice(-300)}`) } else lines.push('已变基到远端最新')
    }
  }
  if (o.push) {
    const p = await git(['push', '-u', 'origin', 'HEAD'], withCred)
    lines.push(p.code === 0 ? '已推送' : `推送失败：${p.out.slice(-300)}`)
  }
  const ab = await git(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], on(w))
  if (ab.code === 0) { const [a, b] = ab.out.split(/\s+/); lines.push(`本地领先 ${a}，落后 ${b}`) }
  const rb = await git(['branch', '-r'], on(w))
  lines.push('远端分支：' + rb.out.split('\n').map((x) => x.trim()).filter((x) => x && !x.includes('->')).join('、'))
  await handBack(w)
  return lines.join('\n')
}
