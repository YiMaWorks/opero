// 工作空间 = 一个 git 仓库拉到员工干活的目录。拉取 / 同步 / 推送由 Opero 用保险箱里的令牌做（经 GIT_ASKPASS 传，不写进 URL、不进 .git/config），
// AI 在里面改代码、commit，要同步远端就调 MCP 工具 git_sync，令牌永远不给它。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { cfg } from './config.ts'
import { get } from './db.ts'
import { getSecret, scrub } from './vault.ts'
import type { Credential, Workspace } from './types.ts'

const askpass = path.join(cfg.data, 'git-askpass.sh')
fs.writeFileSync(askpass, '#!/bin/sh\ncase "$1" in\n  Username*) printf "%s" "$OPERO_GIT_USER" ;;\n  *) printf "%s" "$OPERO_GIT_PASS" ;;\nesac\n', { mode: 0o700 })

export function git(args: string[], opts: { cwd?: string; cred?: string; timeoutMs?: number } = {}): Promise<{ code: number; out: string }> {
  const env: Record<string, string> = { ...process.env as Record<string, string>, GIT_TERMINAL_PROMPT: '0' }
  let secret: string | undefined
  if (opts.cred) {
    const c = get<Credential>('credentials', opts.cred)
    secret = getSecret(opts.cred)
    if (secret) Object.assign(env, { GIT_ASKPASS: askpass, OPERO_GIT_USER: c?.user || 'x-access-token', OPERO_GIT_PASS: secret })
  }
  return new Promise((resolve) => {
    const p = spawn('git', ['-c', 'safe.directory=*', '-c', 'credential.helper=', ...args], { cwd: opts.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (b) => { out += b })
    p.stderr.on('data', (b) => { out += b })
    const t = setTimeout(() => p.kill('SIGKILL'), opts.timeoutMs ?? 120_000)
    p.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? -1, out: scrub(out, [secret]).trim() }) })
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: String(e) }) })
  })
}

export const providerOf = (url: string) => (/github\.com/i.test(url) ? 'GitHub' : /codeup\.aliyun/i.test(url) ? 'Codeup' : /gitee\.com/i.test(url) ? 'Gitee' : /gitlab/i.test(url) ? 'GitLab' : 'Git')

export function workspaceDir(name: string) {
  return path.join(cfg.work, 'ws', name.replace(/[^\w.-]+/g, '-'))
}

export async function cloneWorkspace(w: Workspace): Promise<string> {
  fs.mkdirSync(path.dirname(w.dir), { recursive: true, mode: 0o2770 })
  if (fs.existsSync(path.join(w.dir, '.git'))) return '已经拉过了'
  const r = await git(['clone', ...(w.branch ? ['--branch', w.branch] : []), w.repo, w.dir], { cred: w.credential, timeoutMs: 600_000 })
  if (r.code !== 0) throw new Error(r.out.slice(-600) || '拉取失败')
  await git(['config', 'core.sharedRepository', 'group'], { cwd: w.dir })
  return r.out
}

/** 读分支、最近提交、docs 下的文档 */
export async function inspect(w: Workspace): Promise<Partial<Workspace>> {
  if (!fs.existsSync(path.join(w.dir, '.git'))) return { error: '还没拉下来' }
  const [br, log, cur] = await Promise.all([
    git(['for-each-ref', '--sort=-committerdate', '--count=12', '--format=%(refname:short)\t%(committerdate:relative)', 'refs/heads', 'refs/remotes'], { cwd: w.dir }),
    git(['log', '-15', '--format=%h%x09%s%x09%an%x09%cr'], { cwd: w.dir }),
    git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: w.dir }),
  ])
  const branches = br.out.split('\n').filter((l) => l && !l.endsWith('/HEAD') && !l.startsWith('origin\t')).map((l) => {
    const [name, when] = l.split('\t')
    return { name, status: name === cur.out ? `当前 · ${when}` : when }
  })
  const commits = log.out.split('\n').filter(Boolean).map((l) => { const [sha, msg, who, when] = l.split('\t'); return { sha, msg, who, when } })
  let docs: Workspace['docs'] = []
  const dd = path.join(w.dir, 'docs')
  try {
    docs = fs.readdirSync(dd).filter((f) => f.endsWith('.md')).slice(0, 30).map((f) => ({ name: f, updated: new Date(fs.statSync(path.join(dd, f)).mtimeMs).toLocaleDateString('zh-CN') }))
  } catch { /* 没有 docs */ }
  return { branches, commits, docs, branch: cur.out || w.branch, last: commits[0]?.when ?? w.last, error: undefined }
}

/** 同步：拉远端（可选变基到远端）、可选推送 */
export async function syncWorkspace(w: Workspace, o: { rebase?: boolean; push?: boolean }): Promise<string> {
  const lines: string[] = []
  const f = await git(['fetch', '--all', '--prune'], { cwd: w.dir, cred: w.credential })
  lines.push(f.code === 0 ? '已拉取远端' : `拉取失败：${f.out.slice(-300)}`)
  if (f.code !== 0) return lines.join('\n')
  if (o.rebase !== false) {
    const st = await git(['status', '--porcelain'], { cwd: w.dir })
    if (st.out) lines.push('有没提交的改动，没有变基（先 commit）')
    else {
      const r = await git(['pull', '--rebase'], { cwd: w.dir, cred: w.credential })
      if (r.code !== 0) { await git(['rebase', '--abort'], { cwd: w.dir }); lines.push(`变基有冲突，已撤回，原样不动：${r.out.slice(-300)}`) } else lines.push('已变基到远端最新')
    }
  }
  if (o.push) {
    const p = await git(['push', '-u', 'origin', 'HEAD'], { cwd: w.dir, cred: w.credential })
    lines.push(p.code === 0 ? '已推送' : `推送失败：${p.out.slice(-300)}`)
  }
  const ab = await git(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], { cwd: w.dir })
  if (ab.code === 0) { const [a, b] = ab.out.split(/\s+/); lines.push(`本地领先 ${a}，落后 ${b}`) }
  const rb = await git(['branch', '-r'], { cwd: w.dir })
  lines.push('远端分支：' + rb.out.split('\n').map((x) => x.trim()).filter((x) => x && !x.includes('->')).join('、'))
  return lines.join('\n')
}
