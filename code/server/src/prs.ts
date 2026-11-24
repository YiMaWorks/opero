// 合并请求：员工在自己的分支上改（员工设置「在自己的分支上改」），干完用 pr_create 提到工作空间的主分支。
// 支持 GitHub / GitLab（含自建）/ Gitee / Codeup，用工作空间的仓库令牌（保险箱里的，员工拿不到）。状态不在后台轮询，看的时候现查。
import { get } from './db.ts'
import { getSecret } from './vault.ts'
import type { Credential, Workspace } from './types.ts'

export interface PrRef { provider: string; ws: string; id: string; url: string; source: string; target: string; title: string }
export interface PrState { state: 'open' | 'merged' | 'closed' | 'unknown'; conflict: boolean; url: string; title: string }

/** 仓库地址 → 平台、主机、owner/repo 路径 */
export function parseRepo(url: string): { provider: 'github' | 'gitlab' | 'gitee' | 'codeup' | ''; host: string; path: string } {
  const m = url.replace(/\.git$/, '').match(/^(?:https?:\/\/(?:[^@/]+@)?|git@)([^/:]+)[/:](.+)$/)
  if (!m) return { provider: '', host: '', path: '' }
  const host = m[1]
  const p = m[2].replace(/^\/+/, '')
  const provider = /github\.com$/i.test(host) ? 'github' : /gitee\.com$/i.test(host) ? 'gitee' : /codeup\.aliyun\.com$/i.test(host) ? 'codeup' : /gitlab/i.test(host) ? 'gitlab' : ''
  return { provider, host, path: p }
}

function token(w: Workspace): string {
  const t = w.credential ? getSecret(w.credential) : undefined
  if (!t) throw new Error('这个工作空间没配仓库令牌：在工作空间页选一个「代码仓库」凭证（要有建合并请求的权限）')
  return t
}

async function call(url: string, init: RequestInit & { json?: unknown }): Promise<any> {
  const r = await fetch(url, { ...init, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Opero', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(30_000) })
  const text = await r.text()
  let j: any = {}
  try { j = JSON.parse(text) } catch { /* 不是 JSON */ }
  if (!r.ok) throw new Error(`${r.status} ${j.message ?? j.errorMessage ?? j.error ?? text.slice(0, 200)}`)
  return j
}

export async function create(w: Workspace, o: { source: string; target: string; title: string; body: string }): Promise<PrRef> {
  const { provider, host, path } = parseRepo(w.repo)
  const t = token(w)
  const base = { provider, ws: w.id, source: o.source, target: o.target, title: o.title }
  if (provider === 'github') {
    const j = await call(`https://api.github.com/repos/${path}/pulls`, { method: 'POST', headers: { Authorization: `Bearer ${t}` }, json: { title: o.title, head: o.source, base: o.target, body: o.body } })
    return { ...base, id: String(j.number), url: j.html_url }
  }
  if (provider === 'gitlab') {
    const j = await call(`https://${host}/api/v4/projects/${encodeURIComponent(path)}/merge_requests`, { method: 'POST', headers: { 'PRIVATE-TOKEN': t }, json: { source_branch: o.source, target_branch: o.target, title: o.title, description: o.body } })
    return { ...base, id: String(j.iid), url: j.web_url }
  }
  if (provider === 'gitee') {
    const j = await call(`https://gitee.com/api/v5/repos/${path}/pulls`, { method: 'POST', json: { access_token: t, title: o.title, head: o.source, base: o.target, body: o.body } })
    return { ...base, id: String(j.number), url: j.html_url }
  }
  if (provider === 'codeup') {
    const [org] = path.split('/')
    const full = path.split('/').slice(1).join('/')
    const api = `https://openapi-rdc.aliyuncs.com/oapi/v1/codeup/organizations/${org}/repositories/${encodeURIComponent(full)}`
    const repo = await call(api, { headers: { 'x-yunxiao-token': t } })
    const j = await call(`${api}/changeRequests`, { method: 'POST', headers: { 'x-yunxiao-token': t }, json: { sourceBranch: o.source, targetBranch: o.target, title: o.title.slice(0, 200), description: o.body.slice(0, 4000), createFrom: 'WEB', sourceProjectId: repo.id, targetProjectId: repo.id } })
    return { ...base, id: String(j.localId ?? j.id), url: j.detailUrl ?? j.webUrl ?? `https://codeup.aliyun.com/${path}/change/${j.localId}` }
  }
  throw new Error('这个仓库的平台还不支持建合并请求（支持 GitHub、GitLab、Gitee、Codeup）')
}

export async function status(pr: PrRef): Promise<PrState> {
  const w = get<Workspace>('workspaces', pr.ws)
  if (!w) return { state: 'unknown', conflict: false, url: pr.url, title: pr.title }
  const { provider, host, path } = parseRepo(w.repo)
  const t = token(w)
  try {
    if (provider === 'github') {
      const j = await call(`https://api.github.com/repos/${path}/pulls/${pr.id}`, { headers: { Authorization: `Bearer ${t}` } })
      return { state: j.merged ? 'merged' : j.state === 'open' ? 'open' : 'closed', conflict: j.mergeable === false, url: j.html_url, title: j.title }
    }
    if (provider === 'gitlab') {
      const j = await call(`https://${host}/api/v4/projects/${encodeURIComponent(path)}/merge_requests/${pr.id}`, { headers: { 'PRIVATE-TOKEN': t } })
      return { state: j.state === 'merged' ? 'merged' : j.state === 'opened' ? 'open' : 'closed', conflict: !!j.has_conflicts, url: j.web_url, title: j.title }
    }
    if (provider === 'gitee') {
      const j = await call(`https://gitee.com/api/v5/repos/${path}/pulls/${pr.id}?access_token=${encodeURIComponent(t)}`, {})
      return { state: j.state === 'merged' || j.merged_at ? 'merged' : j.state === 'open' ? 'open' : 'closed', conflict: j.mergeable === false, url: j.html_url, title: j.title }
    }
    if (provider === 'codeup') {
      const [org] = path.split('/')
      const full = path.split('/').slice(1).join('/')
      const j = await call(`https://openapi-rdc.aliyuncs.com/oapi/v1/codeup/organizations/${org}/repositories/${encodeURIComponent(full)}/changeRequests/${pr.id}`, { headers: { 'x-yunxiao-token': t } })
      const st = String(j.state ?? j.status ?? '').toLowerCase()
      return { state: /merged/.test(st) ? 'merged' : /closed|abandon/.test(st) ? 'closed' : 'open', conflict: j.conflictCheckStatus === 'HAS_CONFLICT' || !!j.hasConflict || j.mergeStatus === 'cannot_be_merged', url: pr.url, title: j.title ?? pr.title }
    }
  } catch { /* 查不到就当不知道 */ }
  return { state: 'unknown', conflict: false, url: pr.url, title: pr.title }
}

export const credName = (w: Workspace) => (w.credential ? get<Credential>('credentials', w.credential)?.name : '') ?? ''
