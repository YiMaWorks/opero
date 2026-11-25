// 其它打包工具（GitLab CI、Jenkins…）：统一靠两个一次性地址和 Opero 打通，各家只要接「触发、查状态、看日志」——
//   源码地址：Opero 用自己的凭证拉好要编的那个提交（带 .git，脚本能读提交号），打成 tgz，打包工具下载（Jenkins 用；GitLab 自己会拉代码）。
//   产物地址：流水线最后一步把 out/ 打成 tgz，curl PUT 回 Opero。不依赖各家「下载产物」的接口。
// 地址都带随机令牌、30 分钟（产物 2 小时）有效、用一次就作废；Opero 要配外网地址（OPERO_URL），打包工具才连得回来。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { cfg } from './config.ts'
import { get } from './db.ts'
import { getSecret } from './vault.ts'
import { git } from './git.ts'
import type { Credential, Workspace } from './types.ts'

type Step = (msg: string) => void

// ---------- 一次性地址 ----------
interface Slot { kind: 'src' | 'out'; file: string; exp: number; done?: (ok: boolean) => void }
const slots = new Map<string, Slot>()
const newToken = () => crypto.randomBytes(24).toString('base64url')
function baseUrl(): string {
  if (!cfg.publicUrl) throw new Error('Opero 还没配外网地址（OPERO_URL）：GitLab、Jenkins 这类打包工具要能连回 Opero 拿源码、传产物')
  return cfg.publicUrl
}
setInterval(() => { const now = Date.now(); for (const [k, v] of slots) if (v.exp < now) { slots.delete(k); v.done?.(false) } }, 60_000).unref()

/** 源码：在 Opero 这台拉要编的那个提交，打成 tgz（带 .git） */
export async function sourceUrl(w: Workspace, sha: string, rid: string): Promise<string> {
  const base = path.join(cfg.data, 'tmp', `src-${rid}`)
  fs.rmSync(base, { recursive: true, force: true })
  fs.mkdirSync(base, { recursive: true })
  const src = path.join(base, 'src')
  for (const args of [['init', '-q', src], ['-C', src, 'remote', 'add', 'origin', w.repo]]) await git(args)
  const f = await git(['-C', src, 'fetch', '-q', '--depth', '1', 'origin', sha], { cred: w.credential, timeoutMs: 600_000 })
  if (f.code !== 0) throw new Error(`拉代码失败：${f.out.slice(-200)}`)
  await git(['-C', src, 'checkout', '-q', 'FETCH_HEAD'])
  const file = path.join(base, 'src.tgz')
  execFileSync('tar', ['czf', file, '-C', src, '.'])
  fs.rmSync(src, { recursive: true, force: true })
  const t = newToken()
  slots.set(t, { kind: 'src', file, exp: Date.now() + 30 * 60_000 })
  return `${baseUrl()}/api/build-src/${t}`
}
/** 产物：等打包工具 PUT 回来（放到 file） */
export function uploadUrl(rid: string): { url: string; file: string; wait: (ms: number) => Promise<boolean> } {
  const t = newToken()
  const file = path.join(cfg.data, 'tmp', `out-${rid}.tgz`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let resolve: (ok: boolean) => void = () => {}
  const p = new Promise<boolean>((r) => { resolve = r })
  slots.set(t, { kind: 'out', file, exp: Date.now() + 2 * 3600_000, done: resolve })
  return { url: `${baseUrl()}/api/build-upload/${t}`, file, wait: (ms) => Promise.race([p, new Promise<boolean>((r) => setTimeout(() => r(false), ms))]) }
}
/** 网页接口用：拿源码文件 / 收产物 */
export function takeSource(token: string): string | undefined {
  const s = slots.get(token)
  if (!s || s.kind !== 'src' || s.exp < Date.now()) return undefined
  return s.file
}
export function receiveUpload(token: string, buf: Buffer): boolean {
  const s = slots.get(token)
  if (!s || s.kind !== 'out' || s.exp < Date.now()) return false
  slots.delete(token)
  fs.writeFileSync(s.file, buf, { mode: 0o600 })
  s.done?.(true)
  return true
}
const uploadSteps = `tar czf /tmp/opero-out.tgz -C out .
curl -fsS --retry 3 -X PUT --data-binary @/tmp/opero-out.tgz "$OPERO_UPLOAD"`

// ---------- GitLab CI ----------
// 在仓库里放 .opero/gitlab-ci.yml（只在带 OPERO_UPLOAD 变量触发时跑），根目录 .gitlab-ci.yml include 它（没有就建）。
// 一个项目有几个走 GitLab 的编译组件，这个文件里就有几个任务（opero-build-<组件>），触发时带 OPERO_COMPONENT 只跑对应的那个。
// 跑：POST /projects/:id/pipeline 带变量；查状态；失败取出错 job 的日志。令牌用项目的 GitLab 凭证（api 权限）。
function gitlabOf(w: Workspace) {
  const m = /^(https?:\/\/[^/]+)\/(.+?)(?:\.git)?\/?$/.exec(w.repo.trim())
  if (!m) throw new Error('GitLab CI 要用 GitLab 的仓库（https 地址）')
  const token = w.credential ? getSecret(w.credential) : undefined
  if (!token) throw new Error('项目没配 GitLab 令牌（凭证 → 代码仓库 → GitLab，要有 api 权限）')
  const api = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(`${m[1]}/api/v4/projects/${encodeURIComponent(m[2])}${p}`, { method, headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) })
    const text = await r.text()
    if (!r.ok) throw new Error(`GitLab：${r.status} ${text.replaceAll(token, '***').slice(0, 200)}`)
    try { return JSON.parse(text) } catch { return text }
  }
  return { api }
}
export interface GitlabJob { id: string; name: string; script: string }
export function gitlabYaml(w: Workspace, jobs: GitlabJob[]): string {
  const indent = (t: string) => t.split('\n').map((l) => `      ${l}`).join('\n')
  return `# Opero 生成（项目 ${w.name}）：只在 Opero 触发（带 OPERO_UPLOAD 变量）时跑，编完把 out/ 传回 Opero。在 Opero 里改编译设置后重新生成会覆盖这里
` + jobs.map((j) => `
# 编译组件：${j.name}
opero-build-${j.id}:
  image: node:22-bookworm
  rules:
    - if: '$OPERO_UPLOAD && $OPERO_COMPONENT == "${j.id}"'
  script:
    - |
${indent(j.script)}
    - |
${indent(uploadSteps)}
`).join('')
}
export async function gitlabGenerate(w: Workspace, jobs: GitlabJob[]): Promise<void> {
  const { api } = gitlabOf(w)
  const ref = w.branch || 'main'
  const put = async (file: string, content: string, msg: string) => {
    const enc = encodeURIComponent(file)
    const exists = await api('GET', `/repository/files/${enc}?ref=${encodeURIComponent(ref)}`).then(() => true).catch(() => false)
    await api(exists ? 'PUT' : 'POST', `/repository/files/${enc}`, { branch: ref, content, commit_message: msg })
  }
  await put('.opero/gitlab-ci.yml', gitlabYaml(w, jobs), 'ci: Opero build jobs')
  const root = await api('GET', `/repository/files/.gitlab-ci.yml/raw?ref=${encodeURIComponent(ref)}`).catch(() => null)
  const inc = 'include:\n  - local: .opero/gitlab-ci.yml\n'
  if (root === null) await put('.gitlab-ci.yml', `# Opero：编译任务在 .opero/gitlab-ci.yml\n${inc}`, 'ci: include Opero build job')
  else if (!String(root).includes('.opero/gitlab-ci.yml')) {
    if (/^include:/m.test(String(root))) throw new Error('仓库的 .gitlab-ci.yml 已经有 include：请在里面加一行「- local: .opero/gitlab-ci.yml」，再重新生成')
    await put('.gitlab-ci.yml', `${String(root).replace(/\s*$/, '\n')}\n${inc}`, 'ci: include Opero build job')
  }
}
export async function gitlabRun(w: Workspace, component: string, rid: string, dir: string, step: Step, unpack: (file: string, dir: string) => void): Promise<void> {
  const { api } = gitlabOf(w)
  const up = uploadUrl(rid)
  const p = await api('POST', '/pipeline', { ref: w.branch || 'main', variables: [{ key: 'OPERO_UPLOAD', value: up.url }, { key: 'OPERO_RELEASE', value: rid }, { key: 'OPERO_COMPONENT', value: component }] })
  step(`GitLab 流水线 #${p.id} 开始了：${p.web_url ?? ''}`)
  const t0 = Date.now()
  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000))
    const s = await api('GET', `/pipelines/${p.id}`)
    if (s.status === 'success') break
    if (['failed', 'canceled', 'skipped'].includes(s.status)) {
      const jobs = (await api('GET', `/pipelines/${p.id}/jobs`).catch(() => [])) as any[]
      const bad = jobs.find((j) => j.status === 'failed')
      const log = bad ? String(await api('GET', `/jobs/${bad.id}/trace`).catch(() => '')).slice(-3000) : ''
      throw new Error(`GitLab 流水线没编过（${s.status}）${log ? `：\n${log}` : ''}`)
    }
    if (Date.now() - t0 > 90 * 60_000) throw new Error('GitLab 流水线跑了 90 分钟还没完')
  }
  if (!(await up.wait(120_000))) throw new Error('流水线跑完了，但产物没传回来（检查 Opero 的外网地址能不能从 GitLab 访问）')
  unpack(up.file, dir)
  fs.rmSync(up.file, { force: true })
}

// ---------- Jenkins ----------
// 一个「自由风格」任务（不用装插件）：参数 OPERO_SRC / OPERO_UPLOAD，下载源码、跑同一个编译脚本、把产物传回。
// 凭证：「凭证 → 其它 → Jenkins」：地址、用户名、API Token。
function jenkinsOf(credId: string) {
  const c = get<Credential>('credentials', credId)
  const token = getSecret(credId)
  const base = (c?.meta?.site ?? c?.meta?.url ?? '').replace(/\/+$/, '')
  if (!c || !token || !base) throw new Error('Jenkins 凭证没配好（要地址、用户名、API Token）')
  const auth = `Basic ${Buffer.from(`${c.user ?? ''}:${token}`).toString('base64')}`
  const call = async (method: string, url: string, body?: string, type = 'application/xml') => {
    const r = await fetch(url.startsWith('http') ? url : `${base}${url}`, { method, headers: { Authorization: auth, ...(body ? { 'Content-Type': type } : {}) }, body, signal: AbortSignal.timeout(30_000), redirect: 'manual' })
    if (r.status >= 400) throw new Error(`Jenkins：${r.status} ${(await r.text()).slice(0, 200)}`)
    return r
  }
  return { base, call }
}
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export function jenkinsConfig(w: Workspace, script: string): string {
  const shell = `set -e
rm -rf opero-src && mkdir opero-src && cd opero-src
curl -fsSL "$OPERO_SRC" | tar xz
${script}
${uploadSteps}`
  const param = (n: string) => `<hudson.model.StringParameterDefinition><name>${n}</name><defaultValue></defaultValue></hudson.model.StringParameterDefinition>`
  return `<?xml version='1.1' encoding='UTF-8'?>
<project>
  <description>${xml(`Opero 生成（项目 ${w.name}）：由 Opero 触发，编完把 out/ 传回 Opero。在 Opero 里改编译设置后重新生成会覆盖`)}</description>
  <keepDependencies>false</keepDependencies>
  <properties><hudson.model.ParametersDefinitionProperty><parameterDefinitions>${param('OPERO_SRC')}${param('OPERO_UPLOAD')}${param('OPERO_RELEASE')}</parameterDefinitions></hudson.model.ParametersDefinitionProperty></properties>
  <scm class="hudson.scm.NullSCM"/>
  <canRoam>true</canRoam>
  <disabled>false</disabled>
  <concurrentBuild>false</concurrentBuild>
  <builders><hudson.tasks.Shell><command>${xml(shell)}</command></hudson.tasks.Shell></builders>
  <publishers/>
  <buildWrappers/>
</project>`
}
/** 主人 Jenkins 上已有的任务（接入时读出来，员工照着配 Opero 的编译） */
export async function jenkinsJobs(credId: string): Promise<{ name: string; url: string }[]> {
  const { call } = jenkinsOf(credId)
  const d: any = await (await call('GET', '/api/json?tree=jobs[name,url]')).json()
  return (d?.jobs ?? []).slice(0, 100).map((j: any) => ({ name: String(j.name), url: String(j.url ?? '') }))
}
/** 某个任务的配置（config.xml：里面的 shell 步骤就是它怎么编、怎么发的） */
export async function jenkinsJobConfig(credId: string, job: string): Promise<string> {
  const { call } = jenkinsOf(credId)
  const text = await (await call('GET', `/job/${encodeURIComponent(job)}/config.xml`)).text()
  return text.slice(0, 20_000)
}
/** Jenkins 任务名：opero-<项目>（组件不是 main 时再带 -<组件>） */
export const jenkinsJob = (w: Workspace, b: { id: string }, job?: string) => job || `opero-${w.name.replace(/[^\w.-]+/g, '-').toLowerCase()}${b.id !== 'main' ? `-${b.id}` : ''}`
export async function jenkinsGenerate(w: Workspace, credId: string, job: string, script: string): Promise<void> {
  const { call } = jenkinsOf(credId)
  const conf = jenkinsConfig(w, script)
  const exists = await call('GET', `/job/${encodeURIComponent(job)}/api/json`).then(() => true).catch(() => false)
  if (exists) await call('POST', `/job/${encodeURIComponent(job)}/config.xml`, conf)
  else await call('POST', `/createItem?name=${encodeURIComponent(job)}`, conf)
}
export async function jenkinsRun(w: Workspace, credId: string, job: string, sha: string, rid: string, dir: string, step: Step, unpack: (file: string, dir: string) => void): Promise<void> {
  const { base, call } = jenkinsOf(credId)
  const src = await sourceUrl(w, sha, rid)
  const up = uploadUrl(rid)
  const q = new URLSearchParams({ OPERO_SRC: src, OPERO_UPLOAD: up.url, OPERO_RELEASE: rid })
  const r = await call('POST', `/job/${encodeURIComponent(job)}/buildWithParameters?${q}`)
  const queue = r.headers.get('location')
  if (!queue) throw new Error('Jenkins 没给排队地址')
  step(`Jenkins 任务 ${job} 排上队了`)
  let build = ''
  const t0 = Date.now()
  for (;;) {
    await new Promise((res) => setTimeout(res, 10_000))
    if (!build) {
      const qi = await (await call('GET', `${queue.replace(/\/+$/, '')}/api/json`)).json() as any
      if (qi.cancelled) throw new Error('Jenkins 把这次排队取消了')
      if (qi.executable?.url) { build = String(qi.executable.url).replace(/\/+$/, ''); step(`Jenkins 开始编：${build}`) }
    } else {
      const b = await (await call('GET', `${build}/api/json`)).json() as any
      if (!b.building) {
        if (b.result === 'SUCCESS') break
        const log = await (await call('GET', `${build}/consoleText`)).text().catch(() => '')
        throw new Error(`Jenkins 没编过（${b.result}）：\n${log.slice(-3000)}`)
      }
    }
    if (Date.now() - t0 > 90 * 60_000) throw new Error(`Jenkins 跑了 90 分钟还没完：${build || base}`)
  }
  if (!(await up.wait(120_000))) throw new Error('Jenkins 编完了，但产物没传回来（检查 Opero 的外网地址能不能从 Jenkins 访问）')
  unpack(up.file, dir)
  fs.rmSync(up.file, { force: true })
  fs.rmSync(path.join(cfg.data, 'tmp', `src-${rid}`), { recursive: true, force: true })
}
