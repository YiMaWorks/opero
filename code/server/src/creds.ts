// 凭证的「测试连接」：每一类都真的连一次，能用才算好；代码仓库顺便认出账号、列出能访问的仓库。
// 网页上的分类、类型、获取步骤和链接在 code/web/src/credmeta.ts；这里只管连。
import crypto from 'node:crypto'
import net from 'node:net'
import { Client as SshClient } from 'ssh2'
import { grantsOf, listDbs, loadSchema, runQuery } from './dbconn.ts'
import type { Credential, DataSource, DbKind } from './types.ts'

/** 测试连接的结果：能不能用 + 读到了什么（仓库、表、模型…），让主人一眼看到这个账号能看到哪些东西 */
export interface TestDetail { title: string; items: string[]; total?: number }
export interface TestResult { ok: boolean; msg: string; user?: string; details?: TestDetail[]; write?: boolean | null }
const detail = (title: string, all: string[], max = 30): TestDetail => ({ title, items: all.slice(0, max), ...(all.length > max ? { total: all.length } : {}) })
/** name：显示用的完整路径（不带 Codeup 的企业编号）；group：所在组；short：仓库名；updated：最近活动时间（毫秒） */
export interface RepoItem { name: string; url: string; branch?: string; private?: boolean; group?: string; short?: string; updated?: number }

const SQL_KINDS: DbKind[] = ['MySQL', 'MariaDB', 'PostgreSQL', 'SQL Server', 'Oracle']
export const isSqlKind = (k: string): k is DbKind => (SQL_KINDS as string[]).includes(k)
export const DEFAULT_PORT: Record<string, number> = { MySQL: 3306, MariaDB: 3306, PostgreSQL: 5432, 'SQL Server': 1433, Oracle: 1521, Redis: 6379, MongoDB: 27017 }

/** AI 厂商：接口地址（测 Key 用）。和网页 credmeta.ts 的 AI 列表对应 */
export const AI_BASE: Record<string, { base: string; style: 'anthropic' | 'openai' | 'google' }> = {
  Anthropic: { base: 'https://api.anthropic.com/v1', style: 'anthropic' },
  OpenAI: { base: 'https://api.openai.com/v1', style: 'openai' },
  DeepSeek: { base: 'https://api.deepseek.com/v1', style: 'openai' },
  '通义千问（阿里云百炼）': { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', style: 'openai' },
  '豆包（火山方舟）': { base: 'https://ark.cn-beijing.volces.com/api/v3', style: 'openai' },
  '智谱 GLM': { base: 'https://open.bigmodel.cn/api/paas/v4', style: 'openai' },
  'Kimi（月之暗面）': { base: 'https://api.moonshot.cn/v1', style: 'openai' },
  硅基流动: { base: 'https://api.siliconflow.cn/v1', style: 'openai' },
  OpenRouter: { base: 'https://openrouter.ai/api/v1', style: 'openai' },
  'Google Gemini': { base: 'https://generativelanguage.googleapis.com/v1beta', style: 'google' },
  xAI: { base: 'https://api.x.ai/v1', style: 'openai' },
}

const net400 = (e: unknown) => {
  const m = (e as Error).message || String(e)
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|timeout|aborted/i.test(m) ? `连不上（${m}）：这台 Opero 可能访问不到那边，检查地址和网络` : m
}
async function http(url: string, init: RequestInit = {}, ms = 12_000) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) })
  const text = await r.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* 不是 JSON */ }
  return { status: r.status, json, text }
}

/** 测一个凭证；secret 不给就用已经存的（调用方传进来） */
export async function testCred(c: Pick<Credential, 'group' | 'kind' | 'meta' | 'user'>, secret: string): Promise<TestResult> {
  const m = c.meta ?? {}
  try {
    switch (c.group) {
      case '数据库': return await testDb(c.kind, m, c.user ?? '', secret)
      case '代码仓库': return await gitWhoami(c.kind, m, secret)
      case '云账号': return await testCloud(c.kind, m, secret)
      case 'AI': return await testAi(c.kind, m, secret)
      case '服务器': return await testSsh(c.kind, m, c.user ?? '', secret)
      case '其它': if (c.kind === 'Jenkins') return await testJenkins(m, c.user ?? '', secret); return { ok: true, msg: '这一类不用测试：用的时候才知道对不对' }
      default: return { ok: true, msg: '这一类不用测试：用的时候才知道对不对' }
    }
  } catch (e) {
    return { ok: false, msg: net400(e) }
  }
}

// ---------- 数据库 ----------
async function testDb(kind: string, m: Record<string, string>, user: string, password: string): Promise<TestResult> {
  const host = m.host?.trim()
  if (!host) return { ok: false, msg: '先填地址' }
  const port = Number(m.port) || DEFAULT_PORT[kind]
  if (kind === 'Redis') return redisPing(host, port, user, password)
  if (kind === 'MongoDB') { await tcp(host, port); return { ok: true, msg: `${host}:${port} 能连上（MongoDB 只测端口，账号在用的时候验证）` } }
  if (!isSqlKind(kind)) return { ok: false, msg: `不认识的数据库类型：${kind}` }
  const ds: DataSource = { id: 'test', name: 'test', kind, env: '测试', host, port, db: m.db ?? '', user, writable: false, tables: [] }
  const r = await runQuery(ds, kind === 'Oracle' ? 'SELECT 1 FROM DUAL' : 'SELECT 1', { password })
  // 连上了：读出能看到哪些表、这个账号能不能改数据
  const tables = await loadSchema(ds, password).catch(() => [] as DataSource['tables'])
  const g = await grantsOf(ds, password)
  // 没填库名 = 整个实例：列出这个账号能看到的库
  const dbs = ds.db ? [] : await listDbs(ds, password).catch(() => [] as string[])
  const details: TestDetail[] = [...(dbs.length ? [detail(`能看到的库（${dbs.length} 个）`, dbs)] : []), detail(`能看到的表（${tables.length}${tables.length >= 300 ? '+' : ''} 张）`, tables.map((t) => `${t.name}（约 ${t.rows} 行，${t.cols.length} 列）`))]
  if (g.lines.length) details.push(detail('这个账号的权限', g.lines, 10))
  const rw = g.write === true ? '能改数据' : g.write === false ? '只读' : ''
  return { ok: true, write: g.write, details, msg: `连上了（${r.ms} ms）· ${dbs.length ? `整个实例，${dbs.length} 个库、` : ''}能看到 ${tables.length} 张表${rw ? ` · 这个账号${rw}` : ''}` }
}
function tcp(host: string, port: number, ms = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host, port })
    const t = setTimeout(() => { s.destroy(); reject(new Error(`${host}:${port} 连不上（超时）`)) }, ms)
    s.once('connect', () => { clearTimeout(t); s.end(); resolve() })
    s.once('error', (e) => { clearTimeout(t); reject(e) })
  })
}
function redisPing(host: string, port: number, user: string, password: string): Promise<TestResult> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port })
    let buf = ''
    const t = setTimeout(() => { s.destroy(); resolve({ ok: false, msg: `${host}:${port} 连不上（超时）` }) }, 8000)
    const cmd = (...a: string[]) => `*${a.length}\r\n${a.map((x) => `$${Buffer.byteLength(x)}\r\n${x}\r\n`).join('')}`
    s.once('connect', () => s.write((password ? cmd('AUTH', ...(user ? [user] : []), password) : '') + cmd('PING') + cmd('INFO', 'keyspace')))
    s.on('data', (d) => {
      buf += d.toString('latin1')
      // 依次是：AUTH 的 +OK（有密码时）、PING 的 +PONG、INFO 的 $长度\r\n内容\r\n；任何一步 -ERR 就是失败
      const err = buf.match(/(?:^|\r\n)-([^\r]*)\r\n/)
      if (err) { clearTimeout(t); s.destroy(); resolve({ ok: false, msg: err[1] }); return }
      const i = buf.indexOf('+PONG\r\n')
      if (i < 0) return
      const bulk = buf.slice(i + 7).match(/^\$(\d+)\r\n/)
      if (!bulk) return
      const body = buf.slice(i + 7 + bulk[0].length)
      if (Buffer.byteLength(body, 'latin1') < Number(bulk[1])) return
      clearTimeout(t); s.destroy()
      const dbs = [...body.matchAll(/(db\d+):keys=(\d+)/g)].map((m) => `${m[1]}：${m[2]} 个键`)
      resolve({ ok: true, msg: `连上了（PING → PONG）· ${dbs.length ? `${dbs.length} 个库有数据` : '还没有数据'}`, details: dbs.length ? [detail('有数据的库', dbs)] : undefined })
    })
    s.once('error', (e) => { clearTimeout(t); resolve({ ok: false, msg: e.message }) })
  })
}

// ---------- 代码仓库：认出账号 + 列仓库 ----------
const CODEUP = 'https://openapi-rdc.aliyuncs.com'
function gitApi(kind: string, m: Record<string, string>, token: string) {
  const site = (m.site?.trim() || '').replace(/\/+$/, '')
  switch (kind) {
    case 'GitHub': return { base: 'https://api.github.com', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Opero' } as Record<string, string>, q: '' }
    case 'GitLab': return { base: `${site || 'https://gitlab.com'}/api/v4`, headers: { 'PRIVATE-TOKEN': token } as Record<string, string>, q: '' }
    case 'Gitee': return { base: 'https://gitee.com/api/v5', headers: {} as Record<string, string>, q: `access_token=${encodeURIComponent(token)}` }
    case 'Gitea': if (!site) throw new Error('先填 Gitea 的地址'); return { base: `${site}/api/v1`, headers: { Authorization: `token ${token}` } as Record<string, string>, q: '' }
    case 'Codeup': return { base: `${CODEUP}/oapi/v1`, headers: { 'x-yunxiao-token': token } as Record<string, string>, q: '' }
    default: throw new Error(`不认识的平台：${kind}`)
  }
}
const withQ = (url: string, q: string) => (q ? url + (url.includes('?') ? '&' : '?') + q : url)

export async function gitWhoami(kind: string, m: Record<string, string>, token: string): Promise<TestResult> {
  const a = gitApi(kind, m, token)
  const r = await http(withQ(`${a.base}${kind === 'Codeup' ? '/platform/user' : '/user'}`, a.q), { headers: a.headers })
  if (r.status === 401 || r.status === 403) return { ok: false, msg: `令牌不对或权限不够（${r.status}）：${String(r.json?.message ?? r.json?.errorMessage ?? r.text).slice(0, 160)}` }
  if (r.status >= 400) return { ok: false, msg: `${r.status}：${String(r.json?.message ?? r.json?.errorMessage ?? r.text).slice(0, 160)}` }
  const j = r.json ?? {}
  const user = String(j.login ?? j.username ?? j.name ?? '')
  // 读出能访问哪些仓库（读不到不算失败：可能只是少了列仓库的权限）
  let repos: RepoItem[] = []
  let repoErr = ''
  try { repos = await gitRepos(kind, m, token) } catch (e) { repoErr = (e as Error).message }
  const details = repos.length ? [detail(`能访问的仓库（${repos.length} 个）`, repos.map((x) => `${x.name}${x.private ? '（私有）' : ''}${x.branch ? ` · ${x.branch}` : ''}`))] : undefined
  return { ok: true, user, details, msg: `令牌能用${user ? `，账号：${user}` : ''} · ${repoErr ? `列不出仓库（${repoErr.slice(0, 80)}），检查令牌有没有勾「读仓库 / 组织」权限` : `能访问 ${repos.length} 个仓库`}` }
}

export async function gitRepos(kind: string, m: Record<string, string>, token: string): Promise<RepoItem[]> {
  const a = gitApi(kind, m, token)
  const get = async (path: string) => {
    const r = await http(withQ(`${a.base}${path}`, a.q), { headers: a.headers })
    if (r.status >= 400) throw new Error(`${r.status}：${String(r.json?.message ?? r.json?.errorMessage ?? r.text).slice(0, 160)}`)
    return r.json
  }
  const ts = (v: unknown) => (v ? Date.parse(String(v)) || undefined : undefined)
  const split = (path: string) => { const p = path.split('/').filter(Boolean); return { group: p.slice(0, -1).join('/'), short: p[p.length - 1] ?? path } }
  let out: RepoItem[] = []
  switch (kind) {
    case 'GitHub': out = ((await get('/user/repos?per_page=100&sort=updated')) as any[]).map((x) => ({ name: x.full_name, ...split(x.full_name), url: x.clone_url, branch: x.default_branch, private: x.private, updated: ts(x.pushed_at) })); break
    case 'GitLab': out = ((await get('/projects?membership=true&per_page=100&order_by=last_activity_at&simple=true')) as any[]).map((x) => ({ name: x.path_with_namespace, ...split(x.path_with_namespace), url: x.http_url_to_repo, branch: x.default_branch, private: x.visibility !== 'public', updated: ts(x.last_activity_at) })); break
    case 'Gitee': out = ((await get('/user/repos?per_page=100&sort=updated')) as any[]).map((x) => ({ name: x.full_name, ...split(x.full_name), url: `${x.html_url}.git`, branch: x.default_branch, private: x.private, updated: ts(x.pushed_at ?? x.updated_at) })); break
    case 'Gitea': out = ((await get('/user/repos?limit=50')) as any[]).map((x) => ({ name: x.full_name, ...split(x.full_name), url: x.clone_url, branch: x.default_branch, private: x.private, updated: ts(x.updated_at) })); break
    case 'Codeup': {
      const orgs = ((await get('/platform/organizations')) as any[]) ?? []
      for (const o of orgs.slice(0, 5)) {
        const list = ((await get(`/codeup/organizations/${encodeURIComponent(o.id)}/repositories?perPage=100&orderBy=last_activity_at`).catch(() => [])) as any[]) ?? []
        for (const x of list) {
          const web = String(x.webUrl ?? '')
          // pathWithNamespace 开头是企业编号（一长串），显示时去掉；多个企业时在前面带企业名
          const path = String(x.pathWithNamespace ?? x.name).split('/').filter((seg, i) => !(i === 0 && seg === o.id)).join('/')
          const shown = orgs.length > 1 ? `${o.name ?? o.id}/${path}` : path
          out.push({ name: shown, ...split(shown), url: String(x.httpUrlToRepo ?? (web ? `${web}.git` : '')), branch: x.defaultBranch, private: x.visibility ? x.visibility !== 'public' : undefined, updated: ts(x.lastActivityAt ?? x.updatedAt) })
        }
      }
      out = out.filter((x) => x.url)
      break
    }
  }
  return out.sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
}

// ---------- AI ----------
async function testAi(kind: string, m: Record<string, string>, key0: string): Promise<TestResult> {
  const key = key0.trim()
  // Claude 订阅令牌（claude setup-token 拿到的 sk-ant-oat…）：不是 API Key，按订阅的方式验
  // Anthropic / 令牌类里不是 sk-ant-api 开头的，就当订阅令牌验（令牌格式变了也认）
  const oat = key.match(/sk-ant-oat\d{2}-[A-Za-z0-9_-]{40,}/)?.[0] ?? (/anthropic|claude|token/i.test(kind) && !m.base?.trim() && !/^sk-ant-api/i.test(key) && !key.includes('#') && key.length >= 40 ? key : undefined)
  if (key.includes('#') && /anthropic|claude|token/i.test(kind)) return { ok: false, msg: '这是浏览器给的一次性授权码，不是令牌：到「AI 执行器」里点登录，用那里打开的登录页拿码贴回去' }
  if (oat) {
    const r = await http('https://api.anthropic.com/v1/models?limit=100', { headers: { Authorization: `Bearer ${oat}`, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'oauth-2025-04-20' } })
    if (r.status === 401 || r.status === 403) return { ok: false, msg: `订阅令牌不对或者已经失效（${r.status}）：重新在「AI 执行器」里登录一次拿新的` }
    if (r.status >= 400) return { ok: false, msg: `${r.status}：${String(r.json?.error?.message ?? r.text).slice(0, 160)}` }
    const ids: string[] = (r.json?.data ?? []).map((x: any) => String(x.id ?? '')).filter(Boolean)
    return { ok: true, msg: `Claude 订阅令牌能用${ids.length ? ` · 能用 ${ids.length} 个模型` : ''}；会出现在「AI 执行器」的账号列表里` }
  }
  const v = AI_BASE[kind]
  const base = (m.base?.trim() || v?.base || '').replace(/\/+$/, '')
  if (!base) return { ok: false, msg: '这个厂商要填接口地址' }
  const style = v?.style ?? 'openai'
  const r = style === 'anthropic'
    ? await http(`${base}/models`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } })
    : style === 'google'
      ? await http(`${base}/models?key=${encodeURIComponent(key)}`)
      : await http(`${base}/models`, { headers: { Authorization: `Bearer ${key}` } })
  if (r.status === 401 || r.status === 403) return { ok: false, msg: `Key 不对或没权限（${r.status}）` }
  if (r.status >= 400) return { ok: false, msg: `${r.status}：${String(r.json?.error?.message ?? r.text).slice(0, 160)}` }
  const ids: string[] = (r.json?.data ?? r.json?.models ?? []).map((x: any) => String(x.id ?? x.name ?? '').replace(/^models\//, '')).filter(Boolean)
  return { ok: true, msg: ids.length ? `Key 能用 · 能用 ${ids.length} 个模型` : 'Key 能用', details: ids.length ? [detail(`能用的模型（${ids.length} 个）`, ids, 40)] : undefined }
}

// ---------- 服务器（SSH） ----------
function testSsh(kind: string, m: Record<string, string>, user: string, secret: string): Promise<TestResult> {
  const host = m.host?.trim()
  if (!host) return Promise.resolve({ ok: false, msg: '先填地址' })
  if (!user) return Promise.resolve({ ok: false, msg: '先填登录用户' })
  return new Promise((resolve) => {
    const c = new SshClient()
    const done = (r: TestResult) => { try { c.end() } catch { /* 已经断了 */ } resolve(r) }
    c.on('ready', () => {
      // 登上去看一眼：系统、主机名、磁盘、内存、在跑的服务数
      c.exec('uname -sr; hostname; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"); df -h / | tail -1; free -h 2>/dev/null | sed -n 2p; systemctl list-units --type=service --state=running --no-legend 2>/dev/null | wc -l', (err, st) => {
        if (err) return done({ ok: true, msg: `能登录 ${user}@${host}` })
        let out = ''
        st.on('data', (b: Buffer) => { out += b.toString() }).on('close', () => {
          const l = out.trim().split('\n')
          const items = [`系统：${l[2] || l[0] || '?'}（${l[0] ?? ''}）`, `主机名：${l[1] ?? '?'}`, `根分区：${(l[3] ?? '').split(/\s+/).slice(1, 5).join(' ')}（总 / 已用 / 剩 / 占用）`, `内存：${(l[4] ?? '').split(/\s+/).slice(1, 4).join(' ')}（总 / 已用 / 空闲）`, `在跑的服务：${(l[5] ?? '').trim() || '?'} 个`]
          done({ ok: true, msg: `能登录 ${user}@${host}`, details: [detail('这台服务器', items)] })
        })
      })
    })
    c.on('error', (e) => done({ ok: false, msg: /authentication/i.test(e.message) ? '用户名或密码 / 私钥不对' : e.message }))
    c.connect({ host, port: Number(m.port) || 22, username: user, readyTimeout: 10_000, ...(kind === 'SSH 私钥' ? { privateKey: secret } : { password: secret }) })
  })
}

// ---------- 云账号：调一次「我是谁」 ----------
async function testCloud(kind: string, m: Record<string, string>, secret: string): Promise<TestResult> {
  if (kind === 'Cloudflare') return cloudflareCheck(secret)
  const id = m.akId?.trim()
  if (!id) return { ok: false, msg: '先填 AccessKey ID' }
  if (kind === '阿里云') return aliyunWhoami(id, secret)
  if (kind === 'AWS') return awsWhoami(id, secret)
  if (kind === '腾讯云') return tencentWhoami(id, secret)
  return { ok: true, msg: `${kind} 暂时不能一键测试：用的时候才知道对不对` }
}
const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
async function aliyunWhoami(id: string, secret: string): Promise<TestResult> {
  const p: Record<string, string> = {
    Action: 'GetCallerIdentity', Format: 'JSON', Version: '2015-04-01', AccessKeyId: id, SignatureMethod: 'HMAC-SHA1',
    Timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), SignatureVersion: '1.0', SignatureNonce: crypto.randomUUID(),
  }
  const q = Object.keys(p).sort().map((k) => `${pct(k)}=${pct(p[k])}`).join('&')
  const sig = crypto.createHmac('sha1', `${secret}&`).update(`GET&%2F&${pct(q)}`).digest('base64')
  const r = await http(`https://sts.aliyuncs.com/?${q}&Signature=${pct(sig)}`)
  if (r.status >= 400) return { ok: false, msg: `${r.json?.Code ?? r.status}：${String(r.json?.Message ?? r.text).slice(0, 160)}` }
  return { ok: true, msg: `能用：账号 ${r.json?.AccountId ?? ''}（${String(r.json?.Arn ?? '').split(':').pop()}）` }
}
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
const hmac = (k: crypto.BinaryLike, s: string) => crypto.createHmac('sha256', k).update(s).digest()
async function awsWhoami(id: string, secret: string): Promise<TestResult> {
  const body = 'Action=GetCallerIdentity&Version=2011-06-15'
  const t = new Date().toISOString().replace(/[-:]|\.\d+/g, '')
  const day = t.slice(0, 8)
  const host = 'sts.amazonaws.com'
  const headers = `content-type:application/x-www-form-urlencoded; charset=utf-8\nhost:${host}\nx-amz-date:${t}\n`
  const signed = 'content-type;host;x-amz-date'
  const req = `POST\n/\n\n${headers}\n${signed}\n${sha256(body)}`
  const scope = `${day}/us-east-1/sts/aws4_request`
  const sts = `AWS4-HMAC-SHA256\n${t}\n${scope}\n${sha256(req)}`
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), 'us-east-1'), 'sts'), 'aws4_request')
  const sig = crypto.createHmac('sha256', key).update(sts).digest('hex')
  const r = await http(`https://${host}/`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8', 'x-amz-date': t, authorization: `AWS4-HMAC-SHA256 Credential=${id}/${scope}, SignedHeaders=${signed}, Signature=${sig}` } })
  if (r.status >= 400) return { ok: false, msg: `${r.status}：${(r.text.match(/<Message>([^<]*)/)?.[1] ?? r.text).slice(0, 160)}` }
  return { ok: true, msg: `能用：${r.text.match(/<Arn>([^<]*)/)?.[1] ?? ''}` }
}
async function tencentWhoami(id: string, secret: string): Promise<TestResult> {
  const host = 'sts.tencentcloudapi.com'
  const body = '{}'
  const ts = Math.floor(Date.now() / 1000)
  const day = new Date(ts * 1000).toISOString().slice(0, 10)
  const req = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:${host}\n\ncontent-type;host\n${sha256(body)}`
  const scope = `${day}/sts/tc3_request`
  const sts = `TC3-HMAC-SHA256\n${ts}\n${scope}\n${sha256(req)}`
  const key = hmac(hmac(hmac(`TC3${secret}`, day), 'sts'), 'tc3_request')
  const sig = crypto.createHmac('sha256', key).update(sts).digest('hex')
  const r = await http(`https://${host}/`, { method: 'POST', body, headers: {
    'content-type': 'application/json; charset=utf-8', 'X-TC-Action': 'GetCallerIdentity', 'X-TC-Version': '2018-08-13', 'X-TC-Timestamp': String(ts), 'X-TC-Region': 'ap-guangzhou',
    Authorization: `TC3-HMAC-SHA256 Credential=${id}/${scope}, SignedHeaders=content-type;host, Signature=${sig}`,
  } })
  const e = r.json?.Response?.Error
  if (r.status >= 400 || e) return { ok: false, msg: `${e?.Code ?? r.status}：${String(e?.Message ?? r.text).slice(0, 160)}` }
  return { ok: true, msg: `能用：账号 ${r.json?.Response?.AccountId ?? ''}` }
}

async function cloudflareCheck(token: string): Promise<TestResult> {
  const h = { Authorization: `Bearer ${token}` }
  const v = await http('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers: h })
  if (v.status >= 400 || v.json?.success === false) return { ok: false, msg: `令牌不对：${(v.json?.errors ?? []).map((e: any) => e.message).join('；') || v.status}` }
  const z = await http('https://api.cloudflare.com/client/v4/zones?per_page=50', { headers: h })
  const names: string[] = (z.json?.result ?? []).map((x: any) => String(x.name))
  return { ok: true, msg: `令牌能用 · 能管 ${names.length} 个域名`, details: names.length ? [detail(`能管的域名（${names.length} 个）`, names)] : undefined }
}

// ---------- Jenkins：地址 + 用户名 + API Token，列出任务 ----------
async function testJenkins(m: Record<string, string>, user: string, token: string): Promise<TestResult> {
  const base = (m.site ?? m.url ?? '').replace(/\/+$/, '')
  if (!base) return { ok: false, msg: '先填 Jenkins 地址' }
  const r = await http(`${base}/api/json?tree=jobs[name]`, { headers: { Authorization: `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}` } })
  if (r.status === 401 || r.status === 403) return { ok: false, msg: `用户名或 API Token 不对（${r.status}）` }
  if (r.status >= 400) return { ok: false, msg: `${r.status}：${r.text.slice(0, 160)}` }
  const jobs: string[] = (r.json?.jobs ?? []).map((j: any) => String(j.name))
  return { ok: true, msg: `能连上 · 能看到 ${jobs.length} 个任务`, details: jobs.length ? [detail(`任务（${jobs.length} 个）`, jobs)] : undefined }
}
