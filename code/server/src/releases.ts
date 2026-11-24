// 发布：工作空间的发布环境（Workspace.deploys）一次一次地发，每次一条记录（coll releases），网页「发布」能看、能回滚。
//   编译（build.ts：云效 / GitHub Actions / 自己的服务器，产物约定 out/ + SHA256SUMS / VERSION / COMMIT）→ 拿到 Opero 这台、核对 SHA256
//   → 发到环境的每台服务器（Agent 从 Opero 拿，带 sha256；派活本身有 Opero 的签名，Agent 只认它）→ 解开 → 签名（apk / aab，可选）
//   → 部署：包里有部署脚本就 bash <脚本> <包目录> <发布编号>（OPERO_DIR = KL_DIR = 部署目录），没有就跑环境的部署命令，都没有就把产物复制进部署目录
//   → 检查（可选，在那台 curl 一个地址）。部署或检查失败：用上一个成功版本留着的包重新部署（自动回滚）。
//   部署目录必须是那台服务器「目录」里登记成「能部署」的（server.dirs）。每台留最近 keep 个成功版本的包，回滚不用重新编。
//   没设编译：只在每台跑部署命令（OPERO_REF = 远端最新提交），适合 git pull 型的项目。
//   员工发的：聊天里一张卡片跟着更新；环境设成「员工直接发」的失败了，把原因发回给员工接着修，3 小时内最多 3 次。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { cfg } from './config.ts'
import { all, get, kvGet, kvSet, put, uid } from './db.ts'
import { emit, push } from './bus.ts'
import { audit, empSays, patchMsg, system } from './chat.ts'
import { execOnEnv } from './ssh.ts'
import { git, q } from './git.ts'
import { scrub } from './vault.ts'
import { fillSecrets } from './secrets.ts'
import { signDir } from './signing.ts'
import * as build from './build.ts'
import * as agents from './agents.ts'
import * as hosts from './hosts.ts'
import * as runner from './runner.ts'
import type { Card, Deploy, Employee, Release, ReleaseStep, Server, Workspace } from './types.ts'

const save = (r: Release) => { put('releases', r); emit({ t: 'put', coll: 'releases', item: r }); return r }
export const list = (o: { ws?: string; limit?: number } = {}) => all<Release>('releases').filter((r) => !o.ws || r.ws === o.ws).sort((a, b) => b.started - a.started).slice(0, o.limit ?? 100)
const slug = (s: string) => s.replace(/[^\w.-]+/g, '-').slice(0, 60)
const hostOf = (serverId: string) => (serverId === 'local' ? hosts.LOCAL : serverId)
const pkgOn = (serverId: string, w: Workspace, rid: string) => path.posix.join(hosts.workRoot(hostOf(serverId)), 'releases', slug(w.name), rid)
export const serversOf = (d: Deploy) => (d.servers?.length ? d.servers : [])

// ---------- 产物在服务器之间搬：key → 谁能传 / 谁能拿、放哪（api.ts 的 /api/agent/blob/:key 用） ----------
const pulls = new Map<string, { to: string; file: string; exp: number }>()
export function blobAllowed(key: string, serverId: string, dir: 'push' | 'pull'): string | null {
  if (!/^[\w-]+$/.test(key)) return null
  if (dir === 'pull') { const k = pulls.get(key); return k && k.exp > Date.now() && k.to === serverId ? k.file : null }
  const k = build.pendingBlobs.get(key)
  return k && k.exp > Date.now() && k.from === serverId ? k.file : null
}

// Opero 重启时还在发的：后台跑的步骤已经断了，标成失败（线上可能只发了一半，要人看一眼）
for (const r of all<Release>('releases').filter((x) => x.status === 'running')) {
  put('releases', { ...r, status: 'failed', ended: Date.now(), error: 'Opero 重启了，这次发布中断（线上可能只发了一半，看一下再重新发）', steps: r.steps.map((s) => (s.s === 'running' || s.s === 'pending' ? { ...s, s: 'skipped' as const } : s)) })
}

export const running = (ws: string, target: string) => all<Release>('releases').some((r) => r.ws === ws && r.target === target && r.status === 'running')

/** 部署目录能不能用：那台服务器「目录」里登记成「能部署」的（自己或它下面） */
export function dirAllowed(sv: Server, dir: string): boolean {
  const d = dir.replace(/\/+$/, '')
  return (sv.dirs ?? []).some((x) => x.mode === 'deploy' && (d === x.path.replace(/\/+$/, '') || d.startsWith(x.path.replace(/\/+$/, '') + '/')))
}

/** 开始一次发布（或回滚）：马上返回记录，后面的步骤在后台跑 */
export function start(w: Workspace, targetId: string, o: { by: string; emp?: Employee; sid?: string; note?: string; rollbackOf?: Release }): Release {
  const d = (w.deploys ?? []).find((x) => x.id === targetId)
  if (!d) throw new Error('没有这个发布环境')
  const svs = serversOf(d).map((id) => get<Server>('servers', id))
  if (!svs.length || svs.some((x) => !x)) throw new Error('发布环境的服务器不在了')
  if (running(w.id, d.id)) throw new Error(`「${w.name} → ${d.name}」正在发，等它发完`)
  if (d.dir) for (const sv of svs) if (!dirAllowed(sv!, d.dir)) throw new Error(`「${sv!.name}」没把 ${d.dir} 登记成「能部署」的目录：到服务器详情「目录」里加`)
  const rb = o.rollbackOf
  const b = w.buildCfg
  const reuse = !!(rb && (rb.kept || !b)) // 没编译的（命令型）回滚 = 用那个提交再跑一次部署命令
  const steps: ReleaseStep[] = reuse
    ? [{ k: 'deploy', s: 'pending' }, ...(d.health ? [{ k: 'health' as const, s: 'pending' as const }] : [])]
    : [
        { k: 'build', s: b ? 'pending' : 'skipped' },
        { k: 'checkout', s: b ? 'pending' : 'skipped' },
        { k: 'transfer', s: b ? 'pending' : 'skipped' },
        { k: 'sign', s: b && d.sign ? 'pending' : 'skipped' },
        { k: 'deploy', s: 'pending' },
        { k: 'health', s: d.health ? 'pending' : 'skipped' },
      ]
  const r: Release = {
    id: uid('rl'), ws: w.id, target: d.id, targetName: d.name, version: rb ? rb.version : '', sha: rb ? rb.sha : '', status: 'running', steps,
    note: o.note?.slice(0, 500), by: o.by, emp: o.emp?.id, sid: o.sid, rollbackOf: rb?.id, started: Date.now(), servers: serversOf(d),
  }
  save(r)
  if (o.emp) {
    const m = empSays(o.emp.id, { kind: 'card', card: card(r, w) }, `发布 ${w.name} → ${d.name}`)
    r.msgId = m.id
    save(r)
  }
  audit({ via: o.by, action: rb ? 'release.rollback' : 'release.start', target: `${w.name} → ${d.name}${rb ? `（回滚到 ${rb.version}）` : ''}`, level: '危险', result: '成功', how: o.note ?? '' })
  run(r, w, d, reuse ? rb : undefined).catch((e) => finish(r, w, d, false, (e as Error).message))
  return r
}

const STEP_NAME: Record<ReleaseStep['k'], string> = { build: '编译', checkout: '核对产物', transfer: '发到服务器', sign: '签名', deploy: '部署', health: '检查', rollback: '退回上一版' }
const MARK: Record<ReleaseStep['s'], string> = { pending: '…', running: '进行中', done: '✓', failed: '✗', skipped: '—' }
function card(r: Release, w: Workspace): Card {
  return {
    id: `c-${r.id}`, type: 'generic', v: 1, state: r.status === 'running' ? 'open' : 'done', level: r.status === 'failed' ? 'danger' : 'info',
    data: {
      title: `发布 ${w.name} → ${r.targetName}${r.rollbackOf ? '（回滚）' : ''}`, tag: r.status === 'running' ? '发布中' : r.status === 'success' ? '发布成功' : '发布失败',
      rows: [['版本', r.version || '…'], ...r.steps.filter((s) => s.s !== 'skipped').map((s) => [STEP_NAME[s.k], `${MARK[s.s]}${s.msg ? ' ' + s.msg : ''}`]), ...(r.error ? [['原因', r.error.slice(0, 300)]] : [])],
      ...(r.buildUrl ? { url: r.buildUrl } : {}),
    },
    actions: [], result: r.status === 'running' ? null : r.status === 'success' ? '发布成功' : `发布失败：${(r.error ?? '').slice(0, 120)}`,
  }
}

function step(r: Release, w: Workspace, k: ReleaseStep['k'], s: ReleaseStep['s'], msg?: string) {
  const st = r.steps.find((x) => x.k === k) ?? (r.steps.push({ k, s: 'pending' }), r.steps[r.steps.length - 1])
  st.s = s
  if (msg !== undefined) st.msg = msg.slice(0, 200)
  if (s === 'running') st.t0 = Date.now()
  if (s === 'done' || s === 'failed') st.t1 = Date.now()
  save(r)
  if (r.msgId) patchMsg(r.msgId, { card: card(r, w) })
}
const tail = (s: string, n = 8000) => (s.length > n ? '…' + s.slice(-n) : s)
const addTail = (r: Release, head: string, out: string) => { r.tail = tail(`${r.tail ? r.tail + '\n\n' : ''}—— ${head} ——\n${out}`) }

/** 产物里挑要发的那个文件（*.tgz / *.apk / 文件名） */
function pickFile(files: string[], pattern: string): string | undefined {
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
  return files.find((f) => re.test(f))
}

async function run(r: Release, w: Workspace, d: Deploy, reuse?: Release) {
  const svs = serversOf(d).map((id) => get<Server>('servers', id)!)
  const b = w.buildCfg
  let pkgName = ''
  if (reuse) {
    // 回滚：每台用留着的包，不重新编
    r.version = reuse.version
    r.sha = reuse.sha
    pkgName = reuse.pkgName ?? ''
    save(r)
  } else if (b) {
    // 编译（远端最新提交）
    const lr = await git(['ls-remote', w.repo, w.branch || 'HEAD'], { cred: w.credential, timeoutMs: 60_000 })
    const sha = lr.out.split(/\s+/)[0]
    if (!/^[0-9a-f]{7,40}$/.test(sha ?? '')) throw new Error(`拿不到远端最新提交：${lr.out.slice(-200)}`)
    r.sha = sha
    save(r)
    step(r, w, 'build', 'running', build.providerName(b))
    let res: build.BuildRun
    try {
      res = await build.run(w, b, r.id, sha, (msg) => step(r, w, 'build', 'running', msg))
    } catch (e) {
      step(r, w, 'build', 'failed', (e as Error).message.split('\n')[0])
      throw e
    }
    const blog = path.join(res.dir, 'BUILD.log')
    if (fs.existsSync(blog)) addTail(r, '编译', fs.readFileSync(blog, 'utf8'))
    r.version = res.version || `${sha.slice(0, 7)}`
    if (res.commit) r.sha = res.commit
    step(r, w, 'build', 'done')
    // 核对 + 挑包
    step(r, w, 'checkout', 'running')
    pkgName = pickFile(res.files, build.fileOf(b)) ?? ''
    if (!pkgName) { step(r, w, 'checkout', 'failed', `没有 ${build.fileOf(b)}`); throw new Error(`产物里没有 ${build.fileOf(b)}（有：${res.files.join('、')}）`) }
    r.pkgName = pkgName
    step(r, w, 'checkout', 'done', `${pkgName} · SHA256 对上了`)
    // 发到每台服务器、解开
    step(r, w, 'transfer', 'running')
    const file = path.join(res.dir, pkgName)
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    for (const sv of svs) {
      const m = await sendTo(sv, w, r.id, file, pkgName, sha256)
      if (!m.ok) { step(r, w, 'transfer', 'failed', `${sv.name}：${m.msg}`); throw new Error(`发到 ${sv.name} 失败：${m.msg}`) }
    }
    step(r, w, 'transfer', 'done', svs.map((x) => x.name).join('、'))
    fs.rmSync(res.dir, { recursive: true, force: true })
    // 签名（apk / aab）
    if (d.sign) {
      step(r, w, 'sign', 'running')
      for (const sv of svs) {
        const s = await signDir(sv, path.posix.join(pkgOn(sv.id, w, r.id), 'pkg'), d.sign)
        if (!s.ok) { step(r, w, 'sign', 'failed', `${sv.name}：${s.msg}`); throw new Error(`签名失败（${sv.name}）：${s.msg}`) }
        step(r, w, 'sign', 'running', s.msg)
      }
      step(r, w, 'sign', 'done')
    }
  } else {
    const lr = await git(['ls-remote', w.repo, w.branch || 'HEAD'], { cred: w.credential, timeoutMs: 60_000 })
    r.sha = lr.out.split(/\s+/)[0] || ''
    r.version = r.sha.slice(0, 7)
    save(r)
  }

  // 部署（每台）
  step(r, w, 'deploy', 'running')
  for (const sv of svs) {
    const res = await deployOn(sv, w, d, r, reuse ? reuse.id : r.id)
    addTail(r, `部署 ${sv.name}`, res.out)
    if (!res.ok) { step(r, w, 'deploy', 'failed', `${sv.name} 退出码 ${res.code}`); return fail(r, w, d, `部署失败（${sv.name}，退出码 ${res.code}）：${res.out.slice(-400)}`) }
  }
  r.kept = !!b || !!reuse
  step(r, w, 'deploy', 'done', svs.map((x) => x.name).join('、'))
  // 检查（每台）
  if (d.health) {
    step(r, w, 'health', 'running')
    for (const sv of svs) {
      const h = await health(sv, d.health)
      if (!h.ok) { step(r, w, 'health', 'failed', `${sv.name} HTTP ${h.code}`); return fail(r, w, d, `发完检查 ${d.health} 不通过（${sv.name}：${h.code}）`) }
    }
    step(r, w, 'health', 'done')
  }
  finish(r, w, d, true)
}

/** 把包发到那台：本机直接拷，别的经 Agent 从 Opero 拿（带 sha256）；放进 <工作根>/releases/<项目>/<发布>/，tgz 解到 pkg/ */
async function sendTo(sv: Server, w: Workspace, rid: string, file: string, name: string, sha256: string): Promise<{ ok: boolean; msg: string }> {
  const dir = pkgOn(sv.id, w, rid)
  const dst = path.posix.join(dir, name)
  if (sv.id === 'local') {
    fs.mkdirSync(path.join(dir, 'pkg'), { recursive: true })
    fs.copyFileSync(file, dst)
  } else {
    const key = crypto.randomBytes(16).toString('hex')
    pulls.set(key, { to: sv.id, file, exp: Date.now() + 2 * 3600_000 })
    try {
      const t = await agents.blobTask(sv.id, { t: 'pull', key, path: dst, sha256 })
      if (t.code !== 0) return { ok: false, msg: t.out.slice(-200) || '传不过去（Agent 要升级到 0.9 以上）' }
    } finally { pulls.delete(key) }
  }
  const x = await execOnEnv(sv, /\.(tgz|tar\.gz)$/i.test(name)
    ? `mkdir -p ${q(dir + '/pkg')} && tar xzf ${q(dst)} -C ${q(dir + '/pkg')} --no-same-owner && rm -f ${q(dst)}`
    : `mkdir -p ${q(dir + '/pkg')} && mv ${q(dst)} ${q(dir + '/pkg/')}`, {}, 10 * 60_000)
  return x.code === 0 ? { ok: true, msg: '' } : { ok: false, msg: `解开失败：${x.out.slice(-200)}` }
}

/** 在一台上部署：包里有部署脚本就跑它；没有就跑部署命令；都没有就把包里的东西复制进部署目录 */
async function deployOn(sv: Server, w: Workspace, d: Deploy, r: Release, pkgRid: string): Promise<{ ok: boolean; code: number; out: string }> {
  const pkg = path.posix.join(pkgOn(sv.id, w, pkgRid), 'pkg')
  const scriptName = (d.script || 'deploy.sh').replace(/[^\w./-]/g, '')
  const env: Record<string, string> = {
    OPERO_REF: r.sha, OPERO_VERSION: r.version, OPERO_RELEASE: r.id, KL_DEPLOY: r.id,
    ...(d.dir ? { OPERO_DIR: d.dir, KL_DIR: d.dir } : {}),
    ...(w.buildCfg || r.rollbackOf ? { OPERO_PKG: pkg, KL_PKG: pkg } : {}),
  }
  const cmd = d.command ? fillSecrets(d.command) : undefined
  if (cmd && 'error' in cmd) return { ok: false, code: -1, out: cmd.error }
  let sh: string
  if (w.buildCfg || r.rollbackOf) {
    const hasScript = (await execOnEnv(sv, `test -f ${q(pkg + '/' + scriptName)} && echo YES || true`, {}, 30_000)).out.includes('YES')
    sh = hasScript ? `cd ${q(pkg)} && bash ${q(pkg + '/' + scriptName)} ${q(pkg)} ${q(r.id)}`
      : cmd ? `${d.dir ? `mkdir -p ${q(d.dir)} && cd ${q(d.dir)} && ` : ''}${cmd.text}`
      : d.dir ? `mkdir -p ${q(d.dir)} && cp -a ${q(pkg)}/. ${q(d.dir)}/ && echo "已复制到 ${d.dir}"` : 'echo "包里没有部署脚本，也没设部署命令和部署目录" && exit 1'
  } else {
    if (!cmd) return { ok: false, code: -1, out: '没设部署命令' }
    sh = `${d.dir ? `mkdir -p ${q(d.dir)} && cd ${q(d.dir)} && ` : ''}${cmd.text}`
  }
  const x = await execOnEnv(sv, sh, env, 60 * 60_000)
  const out = cmd && !('error' in cmd) ? scrub(x.out, cmd.secrets) : x.out
  return { ok: x.code === 0, code: x.code, out }
}

async function health(sv: Server, url: string): Promise<{ ok: boolean; code: string }> {
  let code = ''
  for (let i = 0; i < 10; i++) {
    const h = await execOnEnv(sv, `curl -sS -o /dev/null -w '%{http_code}' --max-time 10 ${q(url)}`, {}, 20_000)
    code = h.out.trim()
    if (/^[23]\d\d$/.test(code)) return { ok: true, code }
    await new Promise((res) => setTimeout(res, 6000))
  }
  return { ok: false, code }
}

/** 部署 / 检查失败：自动退回上一个成功的版本（包还留着、环境开着自动回滚） */
async function fail(r: Release, w: Workspace, d: Deploy, why: string) {
  const prev = last(w.id, d.id, r.id)
  if (d.autoRollback !== false && prev && (prev.kept || !w.buildCfg) && !r.rollbackOf) {
    step(r, w, 'rollback', 'running', `退回 ${prev.version}`)
    const outs: string[] = []
    let ok = true
    for (const sv of serversOf(d).map((id) => get<Server>('servers', id)!)) {
      const x = await deployOn(sv, w, d, { ...r, sha: prev.sha, version: prev.version, rollbackOf: prev.id }, prev.id)
      outs.push(`${sv.name}：${x.ok ? '已退回' : `退回失败（${x.code}）`}`)
      if (!x.ok) ok = false
    }
    step(r, w, 'rollback', ok ? 'done' : 'failed', outs.join('；'))
    return finish(r, w, d, false, `${why}\n${ok ? `已自动退回上一个版本 ${prev.version}` : '自动退回上一个版本也失败了，线上可能不完整，要人看'}`)
  }
  finish(r, w, d, false, why)
}

/** 这个环境上一个发成功的（不算 except 那次） */
function last(ws: string, target: string, except?: string): Release | undefined {
  return all<Release>('releases').filter((x) => x.ws === ws && x.target === target && x.status === 'success' && x.id !== except).sort((a, b) => b.started - a.started)[0]
}

function finish(r: Release, w: Workspace, d: Deploy, ok: boolean, error?: string) {
  r.status = ok ? 'success' : 'failed'
  r.ended = Date.now()
  if (!ok) r.kept = false
  if (error) r.error = error.slice(0, 2000)
  for (const s of r.steps) if (s.s === 'pending' || s.s === 'running') s.s = ok ? 'done' : 'skipped'
  save(r)
  if (r.msgId) patchMsg(r.msgId, { card: card(r, w) })
  const cur = get<Workspace>('workspaces', w.id)
  if (cur) {
    const next = { ...cur, deploys: (cur.deploys ?? []).map((x) => (x.id === d.id ? { ...x, last: new Date().toLocaleString('zh-CN'), lastOk: ok } : x)) }
    put('workspaces', next)
    emit({ t: 'put', coll: 'workspaces', item: next })
  }
  fs.rmSync(path.join(cfg.data, 'releases', r.id), { recursive: true, force: true })
  audit({ via: r.by, action: 'release.end', target: `${w.name} → ${d.name} ${r.version}`, level: '危险', result: ok ? '成功' : '失败', how: (error ?? '').slice(0, 80) })
  if (ok) prune(w, d).catch(() => {})
  else {
    push({ kind: 'decide', error: true, title: `发布失败：${w.name} → ${d.name}`, body: (error ?? '').slice(0, 120), route: r.sid ? `chat/${r.sid}` : '' })
    backToEmployee(r, w, d)
  }
}

/** 员工发的、环境是「员工直接发」：把失败原因发回给它接着修；3 小时内最多 3 次，多了停下等你 */
function backToEmployee(r: Release, w: Workspace, d: Deploy) {
  if (!r.emp || !r.sid || (d.ai ?? 'ask') !== 'auto' || r.rollbackOf) return
  const emp = get<Employee>('employees', r.emp)
  if (!emp) return
  const hist = kvGet<Record<string, number[]>>('relAuto', {})
  const recent = (hist[r.sid] ?? []).filter((t) => Date.now() - t < 3 * 3600_000)
  if (recent.length >= 3) {
    system(r.sid, `发布又失败了（3 小时内已经自动让员工修了 3 次），先停下等你看：${(r.error ?? '').slice(0, 200)}`)
    return
  }
  hist[r.sid] = [...recent, Date.now()]
  kvSet('relAuto', hist)
  system(r.sid, '发布失败了，已把原因发给员工接着修')
  runner.send(emp.id, [
    `【系统自动】发布 ${w.name} → ${d.name}（${r.version}）失败了：`,
    (r.error ?? '').slice(0, 800),
    '先用 release_status 看完整的步骤和输出；是代码或编译脚本的问题就改好、提交推送，再用 release_publish 重新发；是配置问题（流水线、部署目录、签名证书、部署命令）就告诉我要改什么。',
    '同样的问题修不好、或者要我开权限的，停下来告诉我。修好了简短说一声。',
  ].join('\n\n'))
}

/** 每台只留最近 keep 个成功版本的包，旧的删掉 */
async function prune(w: Workspace, d: Deploy) {
  const keep = Math.max(1, Math.min(d.keep ?? 5, 30))
  const ok = all<Release>('releases').filter((x) => x.ws === w.id && x.target === d.id && x.status === 'success' && x.kept && !x.rollbackOf).sort((a, b) => b.started - a.started)
  for (const old of ok.slice(keep)) {
    for (const sid of serversOf(d)) {
      const sv = get<Server>('servers', sid)
      if (sv) await execOnEnv(sv, `rm -rf ${q(pkgOn(sid, w, old.id))}`, {}, 60_000).catch(() => {})
    }
    save({ ...old, kept: false })
  }
}

export const summary = (r: Release) => ({ id: r.id, target: r.targetName, version: r.version, status: r.status, by: r.by, started: new Date(r.started).toLocaleString('zh-CN'), steps: r.steps.filter((s) => s.s !== 'skipped').map((s) => `${STEP_NAME[s.k]} ${MARK[s.s]}${s.msg ? ' ' + s.msg : ''}`).join(' · '), error: r.error })
