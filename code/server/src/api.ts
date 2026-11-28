// 接口：网页（cookie 登录）、手机外壳（设备令牌）、MCP（每轮的令牌，只认本机）。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { cfg, ROOT } from './config.ts'
import { all, db, del, get, kvGet, kvSet, put, uid } from './db.ts'
import { addClient, emit, push, waitPush } from './bus.ts'
import { bad, baseUrl, HttpError, isHttps, route, saveBody, type Ctx } from './http.ts'
import * as auth from './auth.ts'
import { addMsg, audit, delMsg, getMsg, historyOf, listAudit, listMessages, patchMsg, patchSession, rotateSession, sessionFor, syncWaiting, system, usage, usageDetail } from './chat.ts'
import * as runner from './runner.ts'
import { callTool, fmtSize, prCard, TOOLS, type ToolResult } from './tools.ts'
import * as prs from './prs.ts'
import * as dns from './dns.ts'
import * as inbox from './inbox.ts'
import * as mfa from './mfa.ts'
import * as notify from './notify.ts'
import * as releases from './releases.ts'
import * as packages from './packages.ts'
import * as egress from './egress.ts'
import * as quota from './quota.ts'
import * as permissions from './permissions.ts'
import * as tunnel from './tunnel.ts'
import * as autogit from './autogit.ts'
import { cloneFailed } from './cloneNotice.ts'
import * as build from './build.ts'
import { checkServer, execOn, isReadOnly, LOCAL_ID } from './ssh.ts'
import { applyDirs, cleanDirs, cleanLogs, shq } from './serverdirs.ts'
import { isReadSql, runQuery, schemaOf } from './dbconn.ts'
import { gitRepos, isSqlKind, testCred } from './creds.ts'
import { cloneWorkspace, git, handBackDir, inspect, providerOf, remoteBranches, workspaceDir } from './git.ts'
import { switchAndTell } from './branch.ts'
import * as pipes from './pipelines.ts'
import * as buildjobs from './buildjobs.ts'
import { fire, makeTrigger } from './triggers.ts'
import { PRESETS } from './presets.ts'
import * as execs from './executors.ts'
import * as agents from './agents.ts'
import * as hosts from './hosts.ts'
import * as queue from './queue.ts'
import * as keys from './keys.ts'
import { delSecret, getSecret, hasSecret, setSecret } from './vault.ts'
import type { Card, Credential, DataSource, Deploy, Device, Employee, Issue, KbDoc, Message, Release, SavedQuery, LogSource, Server, ServerDir, Session, Trigger, Workspace } from './types.ts'
import * as memory from './memory.ts'
import * as issues from './issues.ts'
import { cleanPolicy } from './policy.ts'
import { deployProtected, envOf, isProtected } from './env.ts'
import { certType } from './signing.ts'
import { randomName } from './names.ts'

const now = () => new Date().toLocaleString('zh-CN', { hour12: false }).slice(0, 16)
const put1 = <T extends { id: string }>(coll: Parameters<typeof put>[0], item: T): T => { put(coll, item); emit({ t: 'put', coll, item: pub(coll, item) }); return item }
const del1 = (coll: Parameters<typeof del>[0], id: string) => { del(coll, id); emit({ t: 'del', coll, id }) }

/** 给网页看的样子：去掉内部字段 */
function pub(coll: string, item: any): any {
  if (coll === 'servers') return agents.pub(item)
  if (coll === 'credentials') return { ...item, hasSecret: hasSecret(item.id) }
  if (coll === 'triggers' && item.kind === 'Webhook' && item.hookToken) return { ...item, hookPath: `/hook/${item.hookToken}` }
  return item
}

function needVerify(c: Ctx) {
  if (!c.sess || Date.now() - c.sess.verified > auth.VERIFY_MS) throw new HttpError(403, '要先验证本人', 'VERIFY')
}

function setCookie(c: Ctx, token: string | null) {
  const secure = isHttps(c.req) ? '; Secure' : ''
  c.res.setHeader('Set-Cookie', token
    ? `${auth.COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure}`
    : `${auth.COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`)
}

// ---------- 开机 / 登录 ----------
const defaultSettings = {
  runSummary: true, prodProtect: true, theme: 'system', themeLight: 'amethyst', themeDark: 'slate', customTheme: { mode: 'light', bg: '#F3EEE3', ink: '#111111', accent: '#D9541E' },
  lang: 'auto', notify: 'decide', notifyTo: ['App 推送'], budget: 0, budgetStop: false, fallback: '', aiDown: false,
  phrases: ['继续', '先说方案，我确认了再改', '改完看一遍 diff，写清楚怎么测', '把这次做的写进交接'],
  habits: '- 先给结论再说原因\n- 改代码在分支上做，改完自己看一遍 diff\n- 不确定的先问我',
}
export const settings = () => ({ ...defaultSettings, ...kvGet<Record<string, unknown>>('settings', {}) })

function bootstrap(c: Ctx) {
  const o = auth.owner()
  const sess = c.sess
  const setupDone = kvGet('setupDone', false)
  if (!o || !sess) return { auth: { needOwner: !o, loggedIn: false, setupDone }, instance: instanceInfo() }
  // 记下主人是从哪个地址打开的：没配 OPERO_URL 时，员工给的分享链接用它（packages.publicBase）
  const seen = baseUrl(c.req, cfg.publicUrl)
  if (seen !== kvGet('seenBase', '')) kvSet('seenBase', seen)
  const sessions = all<Session>('sessions').filter((s) => !s.archived) // 归档的在员工资料「历史会话」里按需拉
  return {
    auth: { needOwner: false, loggedIn: true, setupDone },
    instance: instanceInfo(),
    me: { id: 'owner', name: o.name, email: o.email, lastActive: '刚刚', ...kvGet('me', {}) },
    employees: all<Employee>('employees'),
    sessions,
    messages: Object.fromEntries(sessions.map((s) => [s.id, listMessages(s.id, 120)])),
    servers: all<Server>('servers').map((x) => pub('servers', x)),
    credentials: all<Credential>('credentials').map((x) => pub('credentials', x)),
    dataSources: all<DataSource>('dataSources'),
    savedQueries: all<SavedQuery>('savedQueries'),
    triggers: all<Trigger>('triggers').map((x) => pub('triggers', x)),
    kb: all<KbDoc>('kb'),
    workspaces: all<Workspace>('workspaces'),
    queue: all<queue.QItem>('queue'),
    issues: issues.list().slice(0, 300),
    releases: releases.list({ limit: 100 }),
    packages: packages.list().map(packages.pub),
    domains: all<dns.Domain>('domains'),
    channels: all<inbox.Channel>('channels').map(inbox.pubCh),
    notifiers: all<notify.Notifier>('notifiers').map(notify.pub),
    inbox: inbox.list({ limit: 200 }),
    audit: listAudit(),
    usage: usage(),
    settings: settings(),
  }
}
const instanceInfo = () => ({ version: cfg.version, web: webVersion(), notes: latestNotes(), isolated: !!cfg.aiUser, aiUser: cfg.aiUser })
/** 网页包的版本（单独换了网页也要让开着的页面刷新）：看打包出来的 index.html 改没改，用它的修改时间 */
function webVersion() {
  if (!cfg.web) return ''
  try { return String(Math.floor(fs.statSync(path.join(cfg.web, 'index.html')).mtimeMs)) } catch { return '' }
}
// 开着的网页隔一会 / 切回来时问一下：版本变了就刷新（不用登录，只有版本号）
route('GET', '/api/version', () => ({ version: cfg.version, web: webVersion(), notes: latestNotes() }), { auth: 'none' })
/** 新版本提示里的「更新了什么」：docs/变更记录.md 最上面那一节的标题和前 3 条（开源的，不怕看；没有这个文件就不给） */
let notesCache: { at: number; v: { title: string; items: string[] } | null } = { at: 0, v: null }
function latestNotes() {
  if (Date.now() - notesCache.at < 60_000) return notesCache.v
  let v: { title: string; items: string[] } | null = null
  try {
    const md = fs.readFileSync(path.join(ROOT, 'docs/变更记录.md'), 'utf8')
    const sec = md.split(/\n## /)[1]
    if (sec) {
      const [head, ...rest] = sec.split('\n')
      const items = rest.filter((l) => l.startsWith('- ')).slice(0, 3).map((l) => { const t = l.slice(2).replace(/\*\*|`/g, '').trim(); const head = t.split(/[：:]/)[0]; const x = head.length >= 4 && head.length < t.length ? head : t; return x.length > 48 ? `${x.slice(0, 46)}…` : x })
      v = { title: head.trim(), items }
    }
  } catch { /* 没有就算了 */ }
  notesCache = { at: Date.now(), v }
  return v
}

route('GET', '/api/health', () => ({ ok: true, version: cfg.version }), { auth: 'none' })
route('GET', '/api/bootstrap', (c) => bootstrap(c), { auth: 'none' })

route('POST', '/api/auth/setup', (c) => {
  if (auth.owner()) throw bad('已经有主人了，直接登录')
  const { email, name, password } = c.body ?? {}
  if (!email || !password || String(password).length < 8) throw bad('账号要填，密码至少 8 位')
  auth.createOwner(String(email).trim(), String(name || '主人').trim(), String(password))
  const token = auth.newSession()
  setCookie(c, token)
  auth.markVerified(token)
  audit({ via: '—', action: 'owner.create', target: String(email), level: '写', result: '成功', how: '开机向导' })
  return { ok: true }
}, { auth: 'none' })

route('POST', '/api/auth/login', (c) => {
  if (auth.tooManyFails(c.ip)) throw new HttpError(429, '试太多次了，一分钟后再试')
  const o = auth.owner()
  const { email, password } = c.body ?? {}
  if (!o || String(email ?? '').trim().toLowerCase() !== o.email.toLowerCase() || !auth.checkPassword(String(password ?? ''))) {
    auth.noteFail(c.ip)
    audit({ via: '—', action: 'login', target: c.ip, level: '读', result: '拒绝', how: '账号或密码不对' })
    throw new HttpError(401, '账号或密码不对', 'LOGIN')
  }
  // 开了两步验证：先给一张票，再输一个码才登进去
  if (mfa.mfa().enabled) return { mfa: true, ticket: mfa.newTicket() }
  const token = auth.newSession()
  setCookie(c, token)
  audit({ via: '—', action: 'login', target: c.ip, level: '读', result: '成功', how: '密码' })
  return { ok: true }
}, { auth: 'none' })
route('POST', '/api/auth/mfa', (c) => {
  if (auth.tooManyFails(c.ip)) throw new HttpError(429, '试太多次了，一分钟后再试')
  const how = mfa.verifyCode(String(c.body?.code ?? ''))
  let passed: boolean
  try { passed = mfa.useTicket(String(c.body?.ticket ?? ''), !!how) } catch (e) { throw new HttpError(401, (e as Error).message, 'LOGIN') }
  if (!passed) { auth.noteFail(c.ip); throw new HttpError(401, '码不对', 'MFA') }
  const token = auth.newSession()
  setCookie(c, token)
  auth.markVerified(token)
  audit({ via: '—', action: 'login', target: c.ip, level: '读', result: '成功', how: how === 'recovery' ? `密码 + 恢复码（还剩 ${mfa.mfa().recovery.length} 个）` : '密码 + 两步验证' })
  if (how === 'recovery') push({ kind: 'info', title: '用了一个恢复码登录', body: `还剩 ${mfa.mfa().recovery.length} 个，不是你的话马上改密码` })
  return { ok: true }
}, { auth: 'none' })

// ---------- 通行密钥：登录（不用密码）、验证本人、加 / 删 ----------
const origin = (c: Ctx) => String(c.req.headers.origin ?? '')
route('POST', '/api/auth/passkey/options', (c) => { try { return mfa.loginOptions(origin(c)) } catch (e) { throw bad((e as Error).message) } }, { auth: 'none' })
route('POST', '/api/auth/passkey/login', (c) => {
  if (auth.tooManyFails(c.ip)) throw new HttpError(429, '试太多次了，一分钟后再试')
  let pk: mfa.Passkey
  try { pk = mfa.assertVerify(origin(c), c.body) } catch (e) { auth.noteFail(c.ip); throw new HttpError(401, (e as Error).message, 'LOGIN') }
  const token = auth.newSession()
  setCookie(c, token)
  auth.markVerified(token)
  audit({ via: '—', action: 'login', target: c.ip, level: '读', result: '成功', how: `通行密钥「${pk.name}」` })
  return { ok: true }
}, { auth: 'none' })
route('POST', '/api/auth/passkey/verify', (c) => {
  try { mfa.assertVerify(origin(c), c.body) } catch (e) { auth.noteFail(c.ip); throw new HttpError(401, (e as Error).message, 'VERIFY_FAIL') }
  auth.markVerified(c.sess!.token)
  return { ok: true }
})
route('GET', '/api/auth/passkeys', () => ({ passkeys: mfa.passkeys().map(({ pub: _p, ...x }) => x), mfa: { enabled: mfa.mfa().enabled, recoveryLeft: mfa.mfa().recovery.length } }))
route('POST', '/api/auth/passkey/register-options', (c) => { needVerify(c); try { return mfa.registerOptions(origin(c), auth.owner()?.name ?? '') } catch (e) { throw bad((e as Error).message) } })
route('POST', '/api/auth/passkey/register', (c) => {
  needVerify(c)
  try {
    const pk = mfa.registerVerify(origin(c), c.body?.credential, String(c.body?.name ?? ''))
    audit({ via: '—', action: 'passkey.add', target: pk.name, level: '危险', result: '成功', how: '本人（已验证）' })
    return { ok: true }
  } catch (e) { throw bad((e as Error).message) }
})
route('DELETE', '/api/auth/passkeys/:id', (c) => { needVerify(c); mfa.removePasskey(c.params.id); audit({ via: '—', action: 'passkey.remove', target: c.params.id.slice(0, 12), level: '危险', result: '成功', how: '本人（已验证）' }); return { ok: true } })

// ---------- 两步验证 ----------
route('POST', '/api/auth/mfa/setup', (c) => { needVerify(c); return mfa.setup() })
route('POST', '/api/auth/mfa/enable', (c) => {
  needVerify(c)
  try { const codes = mfa.enable(String(c.body?.code ?? '')); audit({ via: '—', action: 'mfa.enable', target: '两步验证', level: '危险', result: '成功', how: '本人（已验证）' }); return { recovery: codes } } catch (e) { throw bad((e as Error).message) }
})
route('POST', '/api/auth/mfa/disable', (c) => {
  needVerify(c)
  if (!mfa.verifyCode(String(c.body?.code ?? ''))) throw bad('要输一个两步验证码或恢复码才能关')
  mfa.disable()
  audit({ via: '—', action: 'mfa.disable', target: '两步验证', level: '危险', result: '成功', how: '本人（已验证 + 动态码）' })
  return { ok: true }
})
route('POST', '/api/auth/mfa/recovery', (c) => {
  needVerify(c)
  if (!mfa.verifyCode(String(c.body?.code ?? ''))) throw bad('要输一个两步验证码')
  return { recovery: mfa.newRecovery() }
})

route('POST', '/api/auth/logout', (c) => { auth.endSession(c.sess!.token); setCookie(c, null); return { ok: true } })

route('POST', '/api/auth/verify', (c) => {
  if (auth.tooManyFails(c.ip)) throw new HttpError(429, '试太多次了，一分钟后再试')
  // 验证本人：密码，或者两步验证的码
  const ok = c.body?.code ? !!mfa.verifyCode(String(c.body.code)) : auth.checkPassword(String(c.body?.password ?? ''))
  if (!ok) { auth.noteFail(c.ip); throw new HttpError(401, c.body?.code ? '码不对' : '密码不对', 'VERIFY_FAIL') }
  auth.markVerified(c.sess!.token)
  return { ok: true }
})

route('POST', '/api/auth/password', (c) => {
  const { old, password } = c.body ?? {}
  if (!auth.checkPassword(String(old ?? ''))) throw new HttpError(401, '原密码不对')
  if (String(password ?? '').length < 8) throw bad('新密码至少 8 位')
  auth.setPassword(String(password))
  const token = auth.newSession()
  setCookie(c, token)
  audit({ via: '—', action: 'owner.password', target: '主人', level: '危险', result: '成功', how: '本人' })
  return { ok: true }
})

route('GET', '/api/events', (c) => {
  c.res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  c.res.write(`data: ${JSON.stringify({ t: 'hello', working: runner.workingList() })}\n\n`)
  addClient(c.res)
})

// ---------- 我 / 设置 ----------
route('PUT', '/api/me', (c) => {
  const { name, email, ...rest } = c.body ?? {}
  const me = { ...kvGet<Record<string, unknown>>('me', {}), ...rest }
  kvSet('me', me)
  const o = auth.owner()
  if (o && (name || email)) kvSet('owner', { ...o, ...(name ? { name: String(name) } : {}), ...(email ? { email: String(email) } : {}) })
  const o2 = auth.owner()!
  const full = { id: 'owner', name: o2.name, email: o2.email, lastActive: '刚刚', ...me }
  emit({ t: 'me', me: full })
  return full
})
route('PUT', '/api/settings', (c) => {
  const next = { ...settings(), ...(c.body ?? {}) }
  kvSet('settings', next)
  emit({ t: 'settings', settings: next })
  return next
})
route('POST', '/api/setup/done', () => { kvSet('setupDone', true); return { ok: true } })

// ---------- AI 执行器 ----------
/** host：在哪台机器上看（local 或装了 Agent 的服务器）；账号 / Key 是所有机器共用的 */
const hostParam = (v: unknown) => {
  const h = String(v ?? '') || hosts.LOCAL
  if (hosts.isLocal(h)) return hosts.LOCAL
  const sv = get<Server>('servers', h)
  if (!agents.isAgent(sv)) throw bad('这台服务器没装 Agent')
  return h
}
const EXEC_KINDS: runner.ExecKind[] = ['claude', 'codex', 'qwen', 'codebuddy']
async function executors(host = hosts.LOCAL) {
  const vers = await Promise.all(EXEC_KINDS.map((k) => hosts.runAiOn(host, hosts.execBin(k, host), ['--version'], { timeoutMs: 15_000 })))
  const ver = (i: number) => (vers[i].code === 0 ? vers[i].out.split('\n').filter(Boolean).pop() ?? '' : null)
  const c = runner.aiConf()
  const remote = !hosts.isLocal(host)
  const as = (cmd: string) => `${cfg.aiUser ? `sudo -u ${cfg.aiUser} -H bash -lc ` : 'bash -lc '}'${cmd}'`
  return {
    host, aiUser: remote ? 'opero-ai' : cfg.aiUser, isolated: remote || !!cfg.aiUser,
    claude: ver(0), codex: ver(1), qwen: ver(2), codebuddy: ver(3),
    claudeKey: !!(c.claudeCred && hasSecret(c.claudeCred)),
    claudeAccounts: accountList('claude'), codexAccounts: accountList('codex'), qwenAccounts: accountList('qwen'), codebuddyAccounts: accountList('codebuddy'),
    claudeBaseUrl: c.claudeBaseUrl ?? '', claudeEgress: c.claudeEgress ?? '', codexEgress: c.codexEgress ?? '',
    codexKey: runner.codexAccounts().length > 0, codexBaseUrl: c.codexBaseUrl ?? '',
    qwenBase: runner.QWEN_BASE, qwenModel: runner.QWEN_MODEL,
    install: {
      claude: as('curl -fsSL https://claude.ai/install.sh | bash'),
      codex: as('npm install -g @openai/codex --prefix ~/.local'),
      qwen: as('npm install -g @qwen-code/qwen-code --prefix ~/.local'),
      codebuddy: as('npm install -g @tencent-ai/codebuddy-code --prefix ~/.local'),
      login: as('claude setup-token'),
    },
  }
}
/** AI 执行器的账号（每种执行器一组）：默认哪个、订阅还是 API Key、走哪个接口地址、谁在用、到没到用量上限 */
function accountList(kind: runner.ExecKind) {
  const lim = kvGet<Record<string, number>>('claudeLimited', {})
  const def = runner.defaultOf(kind)
  return runner.accountsOf(kind).map((id) => {
    const cr = get<Credential>('credentials', id)
    return { id, kind, name: cr?.name ?? id, user: cr?.user ?? '', updated: cr?.updated ?? '', isDefault: id === def,
      baseUrl: String(cr?.meta?.baseUrl ?? ''), region: String(cr?.meta?.region ?? ''), model: String(cr?.meta?.model ?? ''),
      limitedUntil: (lim[id] ?? 0) > Date.now() ? lim[id] : 0,
      employees: kind === 'claude' || kind === 'codex' ? all<Employee>('employees').filter((e) => (kind === 'claude' ? e.claudeAccount : e.codexAccount) === id).map((e) => e.name) : [],
      plan: String(cr?.meta?.plan ?? ''),
      sub: kind === 'claude' ? runner.isOat(runner.claudeKey(id), id) : kind === 'codex' ? runner.codexMode(id) === 'chatgpt' : false,
      // 订阅账号的 5 小时 / 本周用量（quota.ts）
      quota: kind === 'claude' || kind === 'codex' ? quota.view(id) : undefined }
  })
}

// ---------- 订阅账号还剩多少（左边的用量框、「我」页面）----------
/** Claude、Codex 的账号：订阅的带 5 小时 / 本周用量，API Key 的标「按量计费」 */
route('GET', '/api/ai/quota', () => ({ accounts: [...accountList('claude'), ...accountList('codex')].map(({ id, kind, name, user, isDefault, limitedUntil, sub, quota: q, plan }) => ({ id, kind, name, user, isDefault, limitedUntil, sub, quota: q, plan })) }))
/** 刷新：Codex 订阅账号马上问（一分钟内问过的不重复问）；Claude 订阅账号 claude=1 时各发一条最小的（3 分钟内发过的不重发），用它报回来的用量。
 *  打开页面时网页只问 Codex（不花钱）；点「刷新」才带 claude=1（会用一点点额度）——主人 2026-11-28 定的 */
route('POST', '/api/ai/quota/refresh', async (c) => {
  const jobs: Promise<unknown>[] = []
  for (const id of runner.codexAccounts()) {
    const q = quota.quotaOf(id)
    if (q?.src === 'poll' && Date.now() - (q.at || 0) < 60_000 && !q.err) continue
    jobs.push(runner.pollCodexQuota(id).catch(() => {}))
  }
  // Claude：先问官方用量接口（不花额度，打开页面也问，一分钟内问过的跳过）；点了「刷新」（claude = true）接口不认时才发测试请求
  for (const id of runner.claudeAccounts()) {
    const q = quota.quotaOf(id)
    // 官方接口有限流：打开页面时 5 分钟内问过的不问；点刷新时 1 分钟内问过的不问；被限流的等到点（readClaude 里管）
    if (q?.src === 'poll' && !q.err && Date.now() - (q.at || 0) < (c.body?.claude === true ? 60_000 : 5 * 60_000)) continue
    jobs.push(runner.probeClaudeQuota(id, c.body?.claude === true).catch(() => {}))
  }
  await Promise.all(jobs)
  return { accounts: [...accountList('claude'), ...accountList('codex')].map(({ id, kind, name, user, isDefault, limitedUntil, sub, quota: q, plan }) => ({ id, kind, name, user, isDefault, limitedUntil, sub, quota: q, plan })) }
})
/** 这个账号是哪种执行器的 */
const kindOfAccount = (id: string): runner.ExecKind | undefined => EXEC_KINDS.find((k) => runner.accountsOf(k).includes(id))
/** 存一种执行器的账号列表和默认账号 */
function saveAccounts(kind: runner.ExecKind, list: string[], def?: string) {
  const conf = runner.aiConf()
  const d = def && list.includes(def) ? def : list[0]
  if (kind === 'claude') kvSet('ai', { ...conf, claudeAccounts: list, claudeCred: d })
  else if (kind === 'codex') kvSet('ai', { ...conf, codexAccounts: list, codexCred: d })
  else kvSet('ai', { ...conf, accounts: { ...(conf.accounts ?? {}), [kind]: list }, defaults: { ...(conf.defaults ?? {}), [kind]: d } })
}
const ACCT_NAME: Record<runner.ExecKind, string> = { claude: 'Claude 的 API Key', codex: 'Codex 的 OpenAI API Key', qwen: 'Qwen Code 的百炼 API Key', codebuddy: 'CodeBuddy 的 API Key' }
/** 加一个账号（贴进来的 API Key / 订阅令牌，或凭证里已经存的）：都是新加，原来的不动；还没有默认的就设成默认。
 *  baseUrl：这个账号的接口地址；region：CodeBuddy 国内站 cn（默认）/ 国际站 intl；model：Qwen Code 默认用的模型 */
function addAiAccount(kind: runner.ExecKind, o: { value?: string; credId?: string; name?: string; baseUrl?: string; region?: string; model?: string; makeDefault?: boolean }): string {
  const base = String(o.baseUrl ?? '').trim()
  if (base && !/^https?:\/\/\S+$/.test(base)) throw bad('接口地址要以 http:// 或 https:// 开头')
  const extra = { ...(base ? { baseUrl: base } : {}), ...(o.region === 'intl' ? { region: 'intl' } : {}), ...(o.model ? { model: String(o.model).trim().slice(0, 80) } : {}) }
  let id: string
  if (o.credId) {
    const cr = get<Credential>('credentials', o.credId)
    if (!cr || !hasSecret(o.credId)) throw bad('这个凭证不在了或没有值')
    id = o.credId
    put1('credentials', { ...cr, ...(o.name ? { name: o.name } : {}), meta: { ...(cr.meta ?? {}), ...extra } })
  } else {
    const v = String(o.value ?? '').trim()
    // Codex 贴的是 auth.json（在别的电脑上用 ChatGPT 登录过 codex）：存成订阅账号
    if (kind === 'codex' && v.startsWith('{')) {
      try { return execs.saveCodexAuth(v, { name: o.name, makeDefault: o.makeDefault }).id } catch (e) { throw bad((e as Error).message) }
    }
    if (!v || /\s/.test(v) || v.length < 20) throw bad('贴进来的不像 Key / 令牌：要一整串、中间没有空格')
    if (v.includes('#')) throw bad('这是浏览器给的一次性授权码，不是令牌：只能贴回发它的那次登录')
    id = runner.accountsOf(kind).find((x) => getSecret(x)?.trim() === v) ?? uid('cr')
    setSecret(id, v)
    const api = kind !== 'claude' || !!base || /^sk-ant-api/i.test(v)
    const name = o.name?.trim().slice(0, 60) || (kind === 'claude' && !api ? 'Claude Code 的登录令牌' : ACCT_NAME[kind])
    put1('credentials', { id, name, group: 'AI', kind: 'Token', env: '生产', scope: api ? '调模型（按量计费）' : 'Claude 订阅（一年有效）', usedBy: [], updated: now(), aiAllowed: true,
      meta: { ...(kind === 'claude' ? { authMode: api ? 'api' : 'oauth' } : kind === 'codex' ? { authMode: 'api' } : {}), ...extra } } satisfies Credential)
  }
  const list = [...new Set([...runner.accountsOf(kind), id])]
  saveAccounts(kind, list, o.makeDefault ? id : runner.defaultOf(kind) ?? id)
  audit({ via: '—', action: 'ai.account.add', target: `${runner.EXEC_NAMES[kind]} · ${get<Credential>('credentials', id)?.name ?? id}`, level: '危险', result: '成功', how: '本人' })
  return id
}
route('GET', '/api/ai', (c) => executors(hostParam(c.url.searchParams.get('host'))))
route('GET', '/api/ai/accounts', (c) => accountList(runner.kindOf(c.url.searchParams.get('kind') ?? '')))
/** 加一个账号：贴 API Key / 订阅令牌（可带名字、接口地址、CodeBuddy 的站点、Qwen 的模型），或用凭证里已经存的（credId）。Claude 订阅令牌想先真跑一次验证，用 /api/ai/login/token */
route('POST', '/api/ai/accounts', async (c) => {
  const b = c.body ?? {}
  addAiAccount(runner.kindOf(String(b.executor ?? b.kind ?? '')), { value: b.value, credId: b.credId, name: b.name, baseUrl: b.baseUrl, region: b.region, model: b.model, makeDefault: !!b.makeDefault })
  return executors(hostParam(b.host))
})
// 账号：设成默认 / 改名 / 改接口地址、模型、站点 / 从 Opero 去掉（只是 Opero 不再用它，账号和令牌本身不受影响、别的项目照常用）
route('PUT', '/api/ai/accounts/:id', (c) => {
  const id = c.params.id
  const kind = kindOfAccount(id)
  if (!kind) throw new HttpError(404, '没有这个账号')
  if (c.body?.isDefault) saveAccounts(kind, runner.accountsOf(kind), id)
  const cr = get<Credential>('credentials', id)
  const name = String(c.body?.name ?? '').trim().slice(0, 60)
  if (cr && (name || c.body?.baseUrl !== undefined || c.body?.model !== undefined || c.body?.region !== undefined)) {
    const base = String(c.body?.baseUrl ?? cr.meta?.baseUrl ?? '').trim()
    if (base && !/^https?:\/\/\S+$/.test(base)) throw bad('接口地址要以 http:// 或 https:// 开头')
    const model = c.body?.model !== undefined ? String(c.body.model).trim().slice(0, 80) : String(cr.meta?.model ?? '')
    const region = c.body?.region !== undefined ? (c.body.region === 'intl' ? 'intl' : '') : String(cr.meta?.region ?? '')
    put1('credentials', { ...cr, ...(name ? { name } : {}), meta: { ...(cr.meta ?? {}), baseUrl: base || undefined, model: model || undefined, region: region || undefined } })
  }
  if (c.body?.clearLimit) { const lim = kvGet<Record<string, number>>('claudeLimited', {}); delete lim[id]; kvSet('claudeLimited', lim) }
  return { ok: true }
})
route('DELETE', '/api/ai/accounts/:id', (c) => {
  const id = c.params.id
  const kind = kindOfAccount(id)
  if (!kind) throw new HttpError(404, '没有这个账号')
  const def = runner.defaultOf(kind)
  saveAccounts(kind, runner.accountsOf(kind).filter((x) => x !== id), def === id ? undefined : def)
  if (kind === 'claude') for (const e of all<Employee>('employees').filter((x) => x.claudeAccount === id)) put1('employees', { ...e, claudeAccount: undefined })
  if (kind === 'codex') {
    for (const e of all<Employee>('employees').filter((x) => x.codexAccount === id)) put1('employees', { ...e, codexAccount: undefined })
    // ChatGPT 订阅账号在 Opero 这台留的 CODEX_HOME 一起删掉（别的服务器上的下次用不到，留着也无害）
    if (runner.codexMode(id) === 'chatgpt') void hosts.runAiOn(hosts.LOCAL, 'bash', ['-c', 'rm -rf "$HOME/.opero/codex/$1"', '_', id], { timeoutMs: 20_000 })
  }
  const cr = get<Credential>('credentials', id)
  del1('credentials', id); delSecret(id)
  audit({ via: '—', action: 'ai.account.remove', target: cr?.name ?? id, level: '写', result: '成功', how: '本人（只从 Opero 去掉，令牌本身没作废）' })
  return { ok: true }
})
route('PUT', '/api/ai', async (c) => {
  const b = c.body ?? {}
  const conf = runner.aiConf()
  // 贴 Key / 用「凭证 → AI」里已经存的：都是新加一个账号（原来的不动），新加的设成默认
  if (b.claudeKey) addAiAccount('claude', { value: b.claudeKey, makeDefault: true })
  if (b.codexKey) addAiAccount('codex', { value: b.codexKey, makeDefault: true })
  if (b.claudeCredId) addAiAccount('claude', { credId: String(b.claudeCredId), makeDefault: true })
  if (b.codexCredId) addAiAccount('codex', { credId: String(b.codexCredId), makeDefault: true })
  Object.assign(conf, runner.aiConf())
  if (b.claudeBaseUrl !== undefined) conf.claudeBaseUrl = String(b.claudeBaseUrl).trim()
  if (b.codexBaseUrl !== undefined) conf.codexBaseUrl = String(b.codexBaseUrl).trim()
  // 网络出口：空 = 直连；local = 经 Opero 这台；服务器编号 = 经那台 Agent
  for (const k of ['claudeEgress', 'codexEgress'] as const) {
    if (b[k] === undefined) continue
    const v = String(b[k] ?? '')
    if (v && v !== 'local' && !agents.isAgent(get<Server>('servers', v))) throw bad('出口要选装了 Agent 的服务器')
    conf[k] = v || undefined
  }
  kvSet('ai', conf)
  audit({ via: '—', action: 'ai.config', target: 'AI 执行器', level: '危险', result: '成功', how: '本人' })
  return executors(hostParam(b.host))
})
// 一键安装执行器、订阅登录（傻瓜式：网页点按钮，后台在服务器上做；网页每秒问一次进度）
route('GET', '/api/ai/job', () => ({ job: execs.currentJob() }))
route('POST', '/api/ai/install', (c) => {
  const host = hostParam(c.body?.host)
  try { return { job: execs.startInstall(runner.kindOf(String(c.body?.executor ?? '')), host) } } catch (e) { throw bad((e as Error).message) }
})
route('POST', '/api/ai/login', (c) => {
  const host = hostParam(c.body?.host)
  // Claude：订阅登录（setup-token）；Codex：用 ChatGPT 账号登录（设备码）
  try { return { job: runner.kindOf(String(c.body?.executor ?? '')) === 'codex' ? execs.startCodexLogin(host) : execs.startLogin(host) } } catch (e) { throw bad((e as Error).message) }
})
route('POST', '/api/ai/login/token', (c) => {
  const host = hostParam(c.body?.host)
  try { return { job: execs.useToken(String(c.body?.token ?? ''), host) } } catch (e) { throw bad((e as Error).message) }
})
route('POST', '/api/ai/login/code', (c) => {
  try { execs.sendCode(String(c.body?.code ?? '')); return { job: execs.currentJob() } } catch (e) { throw bad((e as Error).message) }
})
route('POST', '/api/ai/job/cancel', () => { execs.cancelJob(); return { job: execs.currentJob() } })
// 测出口：在干活那台上经选的出口访问一下 AI 接口（能拿到 HTTP 状态码就说明通了，401 / 404 也算通）
route('POST', '/api/ai/egress-test', async (c) => {
  const codex = /codex/i.test(String(c.body?.executor ?? ''))
  const host = hostParam(c.body?.host)
  const url = codex ? 'https://api.openai.com/v1/models' : 'https://api.anthropic.com/v1/models'
  const env = runner.egressEnv(codex ? 'codex' : 'claude', host)
  const want = (codex ? runner.aiConf().codexEgress : runner.aiConf().claudeEgress) || ''
  if (want && want !== host && !env.HTTPS_PROXY) return { ok: false, via: 'egress', status: '', secs: 0, out: '这台的 Agent 版本太旧，没有本机出口代理：在那台上运行 sudo opero update 升级' }
  const r = await hosts.runAiOn(host, 'bash', ['-c', `curl -sS -o /dev/null -w '%{http_code} %{time_total}' --max-time 20 ${url}`], { env, timeoutMs: 30_000 })
  const m = r.out.match(/(\d{3}) ([\d.]+)\s*$/)
  const ok = !!m && m[1] !== '000'
  return { ok, via: env.HTTPS_PROXY ? 'egress' : 'direct', status: m?.[1] ?? '', secs: m ? Number(m[2]) : 0, out: ok ? '' : r.out.slice(-300) }
})
route('POST', '/api/ai/test', async (c) => {
  const kind = runner.kindOf(String(c.body?.executor ?? ''))
  const host = hostParam(c.body?.host)
  // 和员工干活时一样：默认账号、它的接口地址、网络出口
  const { env, secrets, cred } = runner.aiEnv(kind, host)
  const bin = hosts.execBin(kind, host)
  const ask = 'Reply with exactly: OK'
  const r = kind === 'codex'
    ? await hosts.runAiOn(host, ...runner.codexCmd(bin, ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-'], env), { env, input: ask, timeoutMs: 120_000 })
    : kind === 'qwen'
      ? await hosts.runAiOn(host, bin, ['--auth-type', 'openai', '-o', 'text', '-m', env.OPENAI_MODEL ?? runner.QWEN_MODEL, '--max-session-turns', '1', '-p', ask], { env, timeoutMs: 120_000 })
      : await hosts.runAiOn(host, bin, ['-p', '--max-turns', '1', '--output-format', 'text'], { env, input: ask, timeoutMs: 120_000 })
  if (kind === 'codex') void runner.syncCodexAuth(host, cred).catch(() => {})
  const out = secrets.reduce((o, k) => o.split(k).join('••••'), r.out)
  return { ok: r.code === 0 && /OK/.test(out), ms: r.ms, out: out.slice(-600) }
})

// ---------- 员工 ----------
/** 员工跑在哪台：本机或装了 Agent 的服务器 */
function empHost(v: unknown) {
  const h = String(v ?? '')
  if (!h || hosts.isLocal(h)) return LOCAL_ID
  return agents.isAgent(get<Server>('servers', h)) ? h : LOCAL_ID
}
function cleanEmp(b: any, old?: Employee): Employee {
  const name = String(b.name ?? old?.name ?? '').trim()
  if (!name) throw bad('先起个名字')
  const pick = <K extends keyof Employee>(k: K, def: Employee[K]) => (b[k] !== undefined ? b[k] : old?.[k] ?? def) as Employee[K]
  return {
    ...(old ?? {}),
    id: old?.id ?? (String(b.id ?? '').match(/^[\w-]{2,40}$/) ? String(b.id) : uid('e')),
    name, avatar: String(pick('avatar', '') || name.slice(0, 1)), color: pick('color', '#5B4FE9'), title: pick('title', ''), prompt: pick('prompt', ''), persona: pick('persona', ''),
    executor: runner.EXEC_NAMES[runner.kindOf(String(pick('executor', 'Claude Code')))], host: empHost(b.host ?? old?.host), workspace: pick('workspace', ''), menus: pick('menus', []),
    model: pick('model', 'Opus 5.5'), effort: pick('effort', 'high'), approval: pick('approval', 'auto'), notify: pick('notify', 'decide'), bg: pick('bg', 'plain'),
    avatarImg: pick('avatarImg', undefined), role: String(pick('role', '') ?? '').trim().slice(0, 20) || undefined, repo: '', resumeId: old?.resumeId, contextUsed: old?.contextUsed ?? 0,
    gender: String(pick('gender', '') ?? '').slice(0, 10), memRepo: String(pick('memRepo', '') ?? '').trim() || undefined, memCred: String(pick('memCred', '') ?? '') || undefined,
    works: old?.works,
    canManage: !!pick('canManage', false),
    claudeAccount: (() => { const v = String(pick('claudeAccount', '') ?? ''); return v && runner.claudeAccounts().includes(v) ? v : undefined })(),
    codexAccount: (() => { const v = String(pick('codexAccount', '') ?? ''); return v && runner.codexAccounts().includes(v) ? v : undefined })(),
    reads: (Array.isArray(b.reads) ? b.reads : old?.reads ?? []).map(String).filter((id: string) => get<Workspace>('workspaces', id)).slice(0, 8),
    budget: Math.max(0, Number(pick('budget', 0)) || 0) || undefined,
    dns: (Array.isArray(b.dns) ? b.dns : old?.dns ?? []).map(String).filter((id: string) => get('domains', id)),
    creds: [...new Set<string>((Array.isArray(b.creds) ? b.creds : old?.creds ?? []).map(String))].filter((id) => get('credentials', id)),
    credGroups: (Array.isArray(b.credGroups) ? b.credGroups : old?.credGroups ?? []).map(String).filter((g: string) => CRED_GROUPS.includes(g)),
    workBranch: /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,100}(?<!\/)$/.test(String(pick('workBranch', '') ?? '')) ? String(pick('workBranch', '')) : undefined,
  }
}
function createEmployee(e: Employee, greet = true) {
  if (get('employees', e.id)) e = { ...e, id: uid('e') }
  e = { ...e, works: [{ no: 1, from: new Date().toLocaleDateString('zh-CN'), reason: '刚建', host: hosts.isLocal(e.host) ? 'Opero 这台' : (get<Server>('servers', e.host)?.name ?? '') }] }
  put1('employees', e)
  const s = sessionFor(e.id)
  if (greet) {
    addMsg(s.id, { from: e.id, kind: 'text', text: `我是「${e.name}」${e.role ? `（${e.role}）` : ''}${e.title ? `，${e.title}` : ''}。有事直接跟我说。` })
    patchSession(s.id, { last: `我是「${e.name}」`, unread: 1 })
  }
  audit({ via: '—', action: 'employee.create', target: e.name, level: '写', result: '成功', how: '本人' })
  return e
}
route('POST', '/api/employees', (c) => createEmployee(cleanEmp(c.body ?? {})))
route('PUT', '/api/employees/:id', (c) => {
  const old = get<Employee>('employees', c.params.id)
  if (!old) throw new HttpError(404, '没有这个员工')
  const e = cleanEmp({ ...c.body, id: old.id }, old)
  // 给员工多开了凭证：记进操作记录（不用验证本人，看明文、删才要）
  const added = (e.creds ?? []).filter((id) => !(old.creds ?? []).includes(id))
  if (added.length) audit({ via: '—', action: 'employee.creds', target: `${e.name}：${added.map((id) => get<Credential>('credentials', id)?.name).join('、')}`, level: '写', result: '成功', how: '本人' })
  if (old.executor !== e.executor || old.workspace !== e.workspace || old.host !== e.host) e.resumeId = undefined // 换了执行器 / 目录：会话接不上了，下一句开新的
  if (old.host !== e.host) {
    if (runner.isWorking(old.id)) throw bad('员工正在干活：等这一轮做完再换服务器')
    e.works = nextWork(e, '换服务器')
    const sid = sessionFor(e.id).id
    memory.moveMemory(old, runner.hostOf(old), runner.hostOf(e)).then((r) => r && system(sid, r)).catch((err) => system(sid, `记忆仓库没搬过来：${(err as Error).message}`))
  }
  return put1('employees', e)
})
route('GET', '/api/employees/:id/where', (c) => {
  const e = get<Employee>('employees', c.params.id)
  if (!e) throw new HttpError(404, '没有这个员工')
  return runner.whereOf(e)
})
route('DELETE', '/api/employees/:id', (c) => {
  const e = get<Employee>('employees', c.params.id)
  if (e) deleteEmployee(e)
  return { ok: true }
})
function deleteEmployee(e: Employee) {
  runner.stop(e.id)
  for (const q of queue.list(e.id)) queue.remove(q.id, true)
  for (const s of all<Session>('sessions').filter((x) => x.employee === e.id)) {
    db.prepare('DELETE FROM messages WHERE sid = ?').run(s.id)
    del1('sessions', s.id)
  }
  del1('employees', e.id)
  audit({ via: '—', action: 'employee.delete', target: e.name, level: '写', result: '成功', how: '本人' })
}
// ---------- 换会话（开新会话接着做 / 换执行器）、历史会话、记忆仓库 ----------
const empOf = (id: string) => { const e = get<Employee>('employees', id); if (!e) throw new HttpError(404, '没有这个员工'); return e }
const day = () => new Date().toLocaleDateString('zh-CN')
/** work 历史：上一个结束、新的开始 */
function nextWork(e: Employee, reason: string): Employee['works'] {
  const works = [...(e.works ?? [])]
  if (works[0] && !works[0].to) works[0] = { ...works[0], to: day() }
  works.unshift({ no: (works[0]?.no ?? 0) + 1, from: day(), reason, host: runner.hostOf(e) === LOCAL_ID ? 'Opero 这台' : (get<Server>('servers', runner.hostOf(e))?.name ?? '') })
  return works.slice(0, 30)
}
/** 交接草稿：最近你说的、员工最后说的、项目现在的样子 */
async function handoffDraft(e: Employee, sid: string): Promise<string> {
  const msgs = listMessages(sid, 400)
  const asks = msgs.filter((m) => m.from === 'me' && m.kind === 'text' && m.text).slice(-5).map((m) => `- ${m.text!.replace(/\s+/g, ' ').slice(0, 160)}`)
  const last = [...msgs].reverse().find((m) => m.from === e.id && m.kind === 'text' && m.text)?.text?.slice(0, 600)
  const w = e.workspace ? get<Workspace>('workspaces', e.workspace) : undefined
  let wsLine = ''
  if (w) {
    const st = await git(['status', '--short'], { host: w.server, cwd: w.dir }).catch(() => ({ code: 1, out: '' }))
    const lg = await git(['log', '-3', '--format=%h %s'], { host: w.server, cwd: w.dir }).catch(() => ({ code: 1, out: '' }))
    const n = st.out.split('\n').filter(Boolean).length
    wsLine = `项目「${w.name}」：${n ? `还有 ${n} 个文件没提交` : '没有未提交的改动'}${lg.out ? `；最近提交：\n${lg.out.split('\n').map((l) => `  - ${l}`).join('\n')}` : ''}`
  }
  return [
    '接着上一个会话做（上一个会话已归档，上下文清空了）。先读你目录里的 CLAUDE.md / AGENTS.md 和 docs/交接.md 最上面几条。',
    asks.length && `上一个会话里我最近说的：\n${asks.join('\n')}`,
    last && `你最后说的：\n> ${last.replace(/\n/g, '\n> ')}`,
    wsLine,
    '没做完的接着做；做完更新交接。',
  ].filter(Boolean).join('\n\n')
}
function rotate(e: Employee, reason: string, draft?: string) {
  if (runner.isWorking(e.id)) throw bad('员工正在干活：等这一轮做完，或者先点「停止」')
  const next = { ...e, resumeId: undefined, contextUsed: 0, works: nextWork(e, reason) }
  put1('employees', next)
  return rotateSession(e.id, reason, { draft })
}
route('GET', '/api/employees/:id/history', (c) => { empOf(c.params.id); return historyOf(c.params.id) })
route('POST', '/api/sessions/:id/handoff', async (c) => {
  const s = sess(c.params.id)
  const e = empOf(s.employee)
  const draft = await handoffDraft(e, s.id)
  const ns = rotate(e, '开新会话接着做', draft)
  audit({ via: '—', action: 'session.handoff', target: e.name, level: '写', result: '成功', how: '本人' })
  return ns
})
route('POST', '/api/employees/:id/switch', async (c) => {
  const e = empOf(c.params.id)
  const k = runner.kindOf(String(c.body?.executor ?? ''))
  const to = runner.EXEC_NAMES[k]
  if (k === runner.kindOf(e.executor)) throw bad(`已经是 ${to} 了`)
  const host = runner.hostOf(e)
  const bin = hosts.execBin(k, host)
  const v = await hosts.runAiOn(host, bin, ['--version'], { timeoutMs: 20_000 })
  if (v.code !== 0) throw bad(`这台还没装好 ${to}：先到「应用 → AI 执行器」装好、登录`)
  // 换执行器 = 开一段新的 work（新执行器、上下文清空），自动发一条交接：你是谁、负责什么、目录在哪、上一段在做什么。员工的目录和项目都在，读文档就能接上
  const draft = await handoffDraft(e, sessionFor(e.id).id)
  const ns = rotate({ ...e }, `换成 ${to}`)
  const cur = put1('employees', { ...get<Employee>('employees', e.id)!, executor: to, model: k === 'claude' ? 'Opus 5.5' : k === 'qwen' ? runner.QWEN_MODEL : '执行器默认', claudeAccount: k === 'claude' ? e.claudeAccount : undefined, codexAccount: k === 'codex' ? e.codexAccount : undefined })
  const w = cur.workspace ? get<Workspace>('workspaces', cur.workspace) : undefined
  const msg = [
    `（Opero 交接）你接手「${cur.name}」这个员工的工作：以前用 ${e.executor} 干，现在换成你（${to}）。`,
    `你负责：${cur.title || '（没写角色）'}${cur.prompt ? `\n${cur.prompt.slice(0, 1500)}` : ''}`,
    w ? `你的项目：「${w.name}」（${w.repo}，分支 ${w.branch || '默认'}），目录就是你的工作目录。` : '你的目录和记忆仓库都还在，就是你的工作目录。',
    draft,
    '先读完上面说的文档，回我一句：你接手了什么、现在进行到哪、下一步做什么。',
  ].join('\n\n')
  queue.post(ns.id, msg, [])
  runner.send(cur.id, msg, [])
  audit({ via: '—', action: 'employee.switch', target: `${e.name}：${e.executor} → ${to}`, level: '写', result: '成功', how: '本人' })
  return ns
})
route('GET', '/api/employees/:id/memory', async (c) => {
  const e = empOf(c.params.id)
  const host = runner.hostOf(e)
  await memory.ensureMemory(e, host)
  return { dir: memory.memDir(e, host), files: await memory.listFiles(e, host), remote: e.memRepo ?? '' }
})
route('GET', '/api/employees/:id/memory/file', async (c) => {
  const e = empOf(c.params.id)
  const text = await memory.readFile(e, runner.hostOf(e), String(c.url.searchParams.get('path') ?? ''))
  if (text === undefined) throw new HttpError(404, '没有这个文件')
  return { text }
})
route('PUT', '/api/employees/:id/memory/file', async (c) => {
  const e = empOf(c.params.id)
  if (runner.isWorking(e.id)) throw bad('员工正在干活：等这一轮做完再改它的记忆')
  try { return { result: await memory.writeFile(e, runner.hostOf(e), String(c.body?.path ?? ''), String(c.body?.text ?? '')) } } catch (err) { throw bad((err as Error).message) }
})

// 预设角色（新建员工时点一个就把名字、职责、提示词、菜单都填好）
route('GET', '/api/presets', () => ({ presets: Object.entries(PRESETS).map(([key, p]) => ({ key, ...p })) }))
route('POST', '/api/setup/employees', (c) => {
  const { presets = [], executor = 'Claude Code', model = 'Opus 5.5' } = c.body ?? {}
  const made: Employee[] = []
  for (const k of presets as string[]) {
    const p = PRESETS[k]
    if (!p) continue
    // 按角色先勾好：这几类凭证现在有的直接给，以后新加的也自动给（员工那边能改）
    const creds = all<Credential>('credentials').filter((x) => x.aiAllowed && (p.credGroups ?? []).includes(x.group)).map((x) => x.id)
    // 预设的名字（管家、运维…）当职位，名字起个人名
    const name = randomName(undefined, [...all<Employee>('employees').map((e) => e.name), ...made.map((e) => e.name)])
    made.push(createEmployee(cleanEmp({ ...p, id: k, role: p.name, name, avatar: name.slice(0, 1), executor, model: runner.kindOf(executor) === 'claude' ? model : runner.kindOf(executor) === 'qwen' ? runner.QWEN_MODEL : '执行器默认', creds })))
  }
  return made
})

// ---------- 会话和消息 ----------
const sess = (id: string) => { const s = get<Session>('sessions', id); if (!s) throw new HttpError(404, '没有这个会话'); return s }
route('POST', '/api/sessions/for/:emp', (c) => sessionFor(c.params.emp))
route('PUT', '/api/sessions/:id', (c) => {
  const s = sess(c.params.id)
  const next = { ...s, ...(c.body?.pinned !== undefined ? { pinned: !!c.body.pinned } : {}), ...(c.body?.draft !== undefined ? { draft: String(c.body.draft) || undefined } : {}) }
  return put1('sessions', next)
})
route('POST', '/api/sessions/:id/read', (c) => { sess(c.params.id); patchSession(c.params.id, { unread: 0 }); return { ok: true } })
route('GET', '/api/sessions/:id/messages', (c) => {
  const before = Number(c.url.searchParams.get('before') ?? 0)
  const rows = db.prepare('SELECT data FROM messages WHERE sid = ? AND ts < ? ORDER BY ts DESC LIMIT 100').all(c.params.id, before || Date.now() + 1) as { data: string }[]
  return rows.reverse().map((r) => JSON.parse(r.data))
})

// 发消息：文字 + 已经传好的图片 / 文件（附件先传、显示在输入框上面，跟着这句话一起发，不会丢）。
//   mode = queue：员工在干活就排队（带着附件）；auto：能插话就插话，插不进去（Codex / 输入通道关了）就排队；闲着就直接派活
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv', log: 'text/plain', zip: 'application/zip' }
function attsOf(emp: Employee, list: unknown): queue.QAtt[] {
  if (!Array.isArray(list)) return []
  return list.slice(0, 10).map((x: any) => {
    const id = path.basename(String(x?.id ?? ''))
    const p = queue.uploadPath(emp, id)
    if (!id || !fs.existsSync(p)) throw bad('有个附件找不到了，重新传一下')
    const name = id.replace(/^[^-]+-/, '')
    const ext = (name.split('.').pop() ?? 'file').toLowerCase()
    const mediaType = MIME[ext] ?? 'application/octet-stream'
    return { id, name, size: fmtSize(fs.statSync(p).size), ext: ext.toUpperCase().slice(0, 4), image: mediaType.startsWith('image/'), mediaType, url: `api/uploads/${emp.id}/${encodeURIComponent(id)}`, w: Number(x?.w) || undefined, h: Number(x?.h) || undefined }
  })
}

route('POST', '/api/sessions/:id/messages', (c) => {
  const s = sess(c.params.id)
  const emp = get<Employee>('employees', s.employee)
  if (!emp) throw new HttpError(404, '没有这个员工')
  const text = String(c.body?.text ?? '').trim()
  const files = attsOf(emp, c.body?.files)
  if (!text && !files.length) throw bad('说点什么')
  return deliver(s, emp, text, files, c.body?.mode === 'queue' ? 'queue' : 'auto')
})

/** 发给员工：在干活就插话 / 排队，闲着就直接派活（发消息、转发共用） */
function deliver(s: Session, emp: Employee, text: string, files: queue.QAtt[], mode: 'queue' | 'auto') {
  const working = runner.isWorking(emp.id)
  // 员工只是在收尾（提交推送）：不进排队，照常显示，收尾完它马上接着看
  if (working && mode !== 'queue' && !runner.canInterject(emp.id) && runner.sendNext(emp.id, text || queue.defaultText(files), queue.toAttachments(emp, files))) {
    queue.post(s.id, text, files)
    return { sent: true, next: true }
  }
  if (working && (mode === 'queue' || !runner.canInterject(emp.id))) {
    try { return { queued: queue.enqueue(emp.id, text, files) } } catch (e) { throw bad((e as Error).message) }
  }
  queue.post(s.id, text, files)
  runner.send(emp.id, text || queue.defaultText(files), queue.toAttachments(emp, files))
  return { sent: true, interjected: working }
}

/** 聊天里一条文件 / 图片消息对应的磁盘文件（员工发的在 data/files，主人传的在员工的 uploads/） */
function fileOfMsg(m: Message): { path: string; name: string } | undefined {
  const u = m.file?.url
  if (!u) return
  const q = new URL(u, 'http://x/')
  let r = q.pathname.match(/^\/api\/files\/(\w+)$/)
  if (r) return { path: path.join(cfg.data, 'files', r[1]), name: q.searchParams.get('name') || m.file!.name }
  r = q.pathname.match(/^\/api\/uploads\/([^/]+)\/([^/]+)$/)
  const e = r && get<Employee>('employees', decodeURIComponent(r[1]))
  const f = r && decodeURIComponent(r[2])
  if (e && f && !f.startsWith('.')) return { path: path.join(runner.empHome(e), 'uploads', f), name: f.replace(/^[^-]+-/, '') }
}

// 转发一条消息给别的员工：文字照转；图片 / 文件把文件本身复制过去（对方能直接看、直接用），不是只转个文件名
route('POST', '/api/sessions/:id/forward', (c) => {
  const s = sess(c.params.id)
  const emp = get<Employee>('employees', s.employee)
  if (!emp) throw new HttpError(404, '没有这个员工')
  const found = getMsg(String(c.body?.msg ?? ''))
  if (!found) throw new HttpError(404, '这条消息没了')
  const m = found.msg
  const fromEmp = get<Employee>('employees', get<Session>('sessions', found.sid)?.employee ?? '')
  const head = `转自「${fromEmp?.name ?? '聊天'}」`
  let files: queue.QAtt[] = []
  if (m.kind === 'file') {
    const src = fileOfMsg(m)
    if (!src || !fs.existsSync(src.path)) throw bad('文件已经没了，转不了')
    const name = path.basename(src.name).replace(/[^\w.\-一-龥]+/g, '_').slice(0, 80) || 'file'
    const id = `${uid('u')}-${name}`
    fs.mkdirSync(path.dirname(queue.uploadPath(emp, id)), { recursive: true })
    fs.copyFileSync(src.path, queue.uploadPath(emp, id))
    files = attsOf(emp, [{ id, w: m.file?.w, h: m.file?.h }])
  }
  const body = m.kind === 'file' ? '' : (m.text ?? (m.card ? String(m.card.data.title ?? '') : ''))
  const text = m.kind === 'file' ? `${head}的${m.file?.image ? '图片' : `文件「${m.file?.name}」`}` : `${head}：\n${body}`
  return deliver(s, emp, text, files, 'auto')
})

// 页面上「交给员工」：没有会话就建，这句话照常发（在忙就排队）；返回会话，网页跳过去
route('POST', '/api/employees/:id/ask', (c) => {
  const emp = get<Employee>('employees', c.params.id)
  if (!emp) throw new HttpError(404, '没有这个员工')
  const text = String(c.body?.text ?? '').trim().slice(0, 8000)
  if (!text) throw bad('说点什么')
  const s = sessionFor(emp.id)
  if (runner.isWorking(emp.id) && !runner.canInterject(emp.id)) {
    try { queue.enqueue(emp.id, text, []) } catch (e) { throw bad((e as Error).message) }
    return { sid: s.id, queued: true }
  }
  queue.post(s.id, text, [])
  runner.send(emp.id, text)
  return { sid: s.id, sent: true }
})

// 传附件：先放进员工目录的 uploads/，回给网页一个附件（还没发）；跟着下一句话一起发
route('POST', '/api/sessions/:id/files', (c) => {
  const s = sess(c.params.id)
  const emp = get<Employee>('employees', s.employee)
  if (!emp || !c.raw?.length) throw bad('没有文件')
  const name = path.basename(String(c.url.searchParams.get('name') || 'file')).replace(/[^\w.\-一-龥]+/g, '_').slice(0, 80) || 'file'
  const id = `${uid('u')}-${name}`
  fs.writeFileSync(queue.uploadPath(emp, id), c.raw, { mode: 0o660 })
  const [att] = attsOf(emp, [{ id, w: c.url.searchParams.get('w'), h: c.url.searchParams.get('h') }])
  return { att }
}, { raw: true })

// 撤回一个还没发的附件
route('DELETE', '/api/sessions/:id/files/:file', (c) => {
  const s = sess(c.params.id)
  const emp = get<Employee>('employees', s.employee)
  if (emp && c.params.file && !c.params.file.includes('/')) { try { fs.unlinkSync(queue.uploadPath(emp, c.params.file)) } catch { /* 已经没了 */ } }
  return { ok: true }
})

// 排队：删一条（连它的附件）、员工闲着时手动开始
route('DELETE', '/api/queue/:id', (c) => { queue.remove(c.params.id, true); return { ok: true } })
route('PUT', '/api/queue/:id', (c) => { try { return queue.edit(c.params.id, String(c.body?.text ?? '')) } catch (e) { throw bad((e as Error).message) } })
route('POST', '/api/sessions/:id/queue/run', (c) => {
  const s = sess(c.params.id)
  if (runner.isWorking(s.employee)) throw bad('员工正在干活，这一轮做完会自动接着发')
  return { ok: queue.drain(s.employee) }
})

// ?dl=1：一律当附件下载（图片默认在页面里直接显示）
function sendFileOut(c: Ctx, p: string, name?: string) {
  const dl = c.url.searchParams.get('dl') === '1'
  let st: fs.Stats
  try { st = fs.statSync(p) } catch { throw new HttpError(404, '文件没了') }
  const ext = path.extname(name ?? p).toLowerCase()
  const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.json': 'application/json', '.log': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8' }
  const type = types[ext] ?? 'application/octet-stream'
  c.res.writeHead(200, {
    'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${type.startsWith('image/') && !dl ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name ?? path.basename(p))}`,
  })
  fs.createReadStream(p).pipe(c.res)
}
route('GET', '/api/uploads/:emp/:file', (c) => {
  const e = get<Employee>('employees', c.params.emp)
  if (!e || c.params.file.includes('/') || c.params.file.startsWith('.')) throw new HttpError(404, '没有')
  sendFileOut(c, path.join(runner.empHome(e), 'uploads', c.params.file), c.params.file.replace(/^[^-]+-/, ''))
})
route('GET', '/api/files/:id', (c) => {
  if (!/^[\w]+$/.test(c.params.id)) throw new HttpError(404, '没有')
  sendFileOut(c, path.join(cfg.data, 'files', c.params.id), c.url.searchParams.get('name') ?? undefined)
})

route('DELETE', '/api/messages/:id', (c) => { delMsg(c.params.id); return { ok: true } })
route('POST', '/api/sessions/:id/stop', (c) => {
  const s = sess(c.params.id)
  if (runner.stop(s.employee)) return { ok: true }
  // 其实没在干活（进程早没了，比如 Opero 重启过）：把留下的「在想… / 在跑命令」气泡清掉
  if (!runner.isWorking(s.employee)) {
    for (const m of listMessages(s.id).filter((x) => x.kind === 'status' && x.spinning)) delMsg(m.id)
    patchSession(s.id, { clear: ['working'] })
  }
  return { ok: true }
})
route('POST', '/api/sessions/:id/new-topic', (c) => {
  const s = sess(c.params.id)
  const reason = String(c.body?.reason ?? '')
  runner.newTopic(s.employee, reason ? `—— 新的 work（${reason}）：上下文已清空，目录和项目都还在 ——` : undefined)
  return { ok: true }
})

// 卡片上的按钮
route('POST', '/api/messages/:id/action', async (c) => {
  const found = getMsg(c.params.id)
  const card = found?.msg.card
  if (!found || !card) throw new HttpError(404, '没有这张卡片')
  // 发布卡片发完就是 done（不能再改进度），但「让员工修 / 重新发布 / 回滚」正是发完以后才有的：这几个按钮不看 state
  const relBtn = card.type === 'release' && !!card.data.rel && String(c.body?.action ?? '').startsWith('rel:')
  if (card.state !== 'open' && !relBtn) throw bad('已经处理过了')
  // 「以后再说」所有等你的卡片都能点（以前发的卡片上没有这个按钮，也认）
  const needYou = !!(card.data.needYou || card.data.credReq || card.type === 'confirm' || card.type === 'ask' || card.type === 'issue')
  const act = card.actions.find((a) => a.id === c.body?.action) ?? (c.body?.action === 'later' && needYou ? { id: 'later', label: '以后再说' } : undefined)
  if (!act) throw bad('没有这个按钮')
  const verified = !!c.sess && Date.now() - c.sess.verified < auth.VERIFY_MS
  if (act.style === 'danger') needVerify(c)
  const s = get<Session>('sessions', found.sid)
  const answer = c.body?.answer !== undefined ? String(c.body.answer) : undefined
  let result: string
  if (act.id === 'later') {
    // 「以后再说」：卡片收起、红点消掉；员工在等的（确认 / 提问）直接回它，没在等的发一句让它别等
    const title = String(card.data.title ?? '')
    if (runner.isPending(c.params.id)) runner.answerCard(c.params.id, { action: 'later' })
    else if (s) runner.send(s.employee, `主人先不处理「${title}」（点了「以后再说」）：别等它；不需要它的部分先做，做不了就停下说清楚卡在哪；以后真的需要再提，不要马上再发一次。`)
    result = '你点了「以后再说」：员工已经知道，先不等它'
    patchMsg(c.params.id, { card: { ...card, state: 'done', result } })
    return { ok: true, result }
  } else if (runner.isPending(c.params.id)) {
    runner.answerCard(c.params.id, { action: act.id, answer, verified })
    result = card.type === 'ask' ? `你选了：${answer ?? ''}` : act.id === 'allow' ? `你同意了${verified && act.style === 'danger' ? ' · 已验证本人' : ''}` : '你没同意，员工已经知道了'
  } else if (card.data.pr && act.id === 'refresh') {
    // 合并请求：现查状态，卡片留着（不算点过）
    const st = await prs.status(card.data.pr)
    const fresh = prCard(card.data.pr, st)
    patchMsg(c.params.id, { card: { ...fresh, id: card.id, state: st.state === 'open' || st.state === 'unknown' ? 'open' : 'done', result: st.state === 'merged' ? '已合并' : st.state === 'closed' ? '已关闭' : null } })
    return { ok: true, result: fresh.data.tag }
  } else if (card.type === 'issue' && card.data.issueId) {
    try { issues.act(String(card.data.issueId), act.id, { by: '主人' }) } catch (e) { throw bad((e as Error).message) }
    result = act.id === 'fix' ? '已交给员工去修' : act.id === 'known' ? '标成已知' : '7 天内不再提醒'
  } else if (card.type === 'release' && card.data.rel) {
    // 发布卡片：让员工修 / 重新发布 / 回滚（生产要验证本人）。卡片本身照旧跟着发布进度更新，不标成点过
    const r = get<Release>('releases', String(card.data.rel))
    if (!r) throw bad('这次发布的记录已经没了')
    const w = get<Workspace>('workspaces', r.ws)
    const d = w?.deploys?.find((x) => x.id === r.target)
    if (act.id !== 'rel:fix' && d && deployProtected(d, (id) => get<Server>('servers', id))) needVerify(c)
    let res: string
    try { res = releases.cardAct(r, act.id, '主人') } catch (e) { throw bad((e as Error).message) }
    // 交给员工修了：按钮去掉、卡片上写一句，免得点两次发两遍
    if (act.id === 'rel:fix') patchMsg(c.params.id, { card: { ...card, actions: card.actions.filter((a) => a.id !== 'rel:fix'), data: { ...card.data, autoFix: true } } })
    return { ok: true, result: res }
  } else if (card.type === 'run') {
    // 一轮的小结：撤销（反着提交一次再推送）/ 发布到某个环境（生产要验证本人）
    const w = get<Workspace>('workspaces', String(card.data.ws))
    if (!w) throw bad('这个项目已经没了')
    if (act.id === 'revert') {
      const busy = all<Employee>('employees').filter((e) => e.workspace === w.id && runner.isWorking(e.id))
      if (busy.length) throw bad(`${busy.map((e) => e.name).join('、')} 还在这个项目里干活，等做完再撤销`)
      try { result = await autogit.revertRun(w, String(card.data.before), String(card.data.after), String(card.data.title ?? '')) } catch (e) { throw bad((e as Error).message) }
    } else {
      const d = (w.deploys ?? []).find((x) => `release:${x.id}` === act.id)
      if (!d) throw bad('这个发布环境已经没了')
      if (deployProtected(d, (id) => get<Server>('servers', id))) needVerify(c) // 发到生产：验证本人
      try { releases.start(w, d.id, { by: '主人', note: String(card.data.title ?? '') || undefined }) } catch (e) { throw bad((e as Error).message) }
      result = `已开始发布到${d.name}，进度在「发布」里看`
    }
  } else if (card.data.perm) {
    // 员工申请权限（request_permission）：点了就给 / 不给，告诉员工
    result = permissions.decide(card, act.id === 'allow', verified)
  } else if (card.data.late || card.data.pending) {
    // 员工当时没等到（超时 / 那一轮结束 / 重启）：现在点了照样算，告诉员工；同意的那件事半小时内再做不用再问
    result = lateAnswer(card, s, act.id, answer, verified)
  } else {
    result = `你点了「${act.label}」`
    if (s) runner.send(s.employee, `我在卡片「${String(card.data.title ?? '')}」上点了「${act.label}」${answer ? `：${answer}` : ''}`)
  }
  patchMsg(c.params.id, { card: { ...card, state: 'done', result } })
  if (s) syncWaiting(s.id)
  return { ok: true, result }
})

/** 晚点的卡片（员工没等到）：选择题把答案发给员工；确认卡同意的记成「预先同意」（同一个员工同一件事 30 分钟内直接放行） */
function lateAnswer(card: Card, s: Session | undefined, action: string, answer: string | undefined, verified: boolean): string {
  const title = String(card.data.title ?? '')
  const emp = s?.employee
  if (card.type === 'ask') {
    if (emp && answer) runner.send(emp, `（你之前问的「${title}」，那时没等到；主人现在选了：${answer}）按这个接着做。`)
    return `你选了：${answer ?? ''}（已告诉员工）`
  }
  const yes = action === 'allow'
  if (yes && emp && card.data.preKey) runner.preApprove(String(card.data.preKey), verified)
  if (emp) runner.send(emp, yes
    ? `主人同意了「${title}」（你之前申请的，那时没等到回复）。现在可以去做了：再执行一次就直接放行，不用再问（30 分钟内有效）。`
    : `主人没同意「${title}」（你之前申请的）。换个办法，或者跟主人说清楚为什么需要。`)
  return yes ? '你同意了（员工那时没等到，已告诉它：30 分钟内再做就直接放行）' : '你没同意，员工已经知道了'
}

// ---------- 服务器 ----------
function inlineCred(name: string, group: string, kind: string, env: any, user: string, secret: string, scope: string): string {
  const id = uid('cr')
  setSecret(id, secret)
  put1('credentials', { id, name, group, kind, env, scope, usedBy: [], updated: now(), aiAllowed: true, user } satisfies Credential)
  return id
}
route('POST', '/api/servers', async (c) => {
  const b = c.body ?? {}
  const ip = String(b.ip ?? '').trim()
  if (!ip) throw bad('地址要填')
  const name = String(b.name ?? '').trim() || ip // 不起名就用地址，连上后能改成主机名
  if (all<Server>('servers').some((s) => s.name === name)) throw bad('已经有同名的服务器')
  const env = envOf(b.env, '测试')
  const user = String(b.user || 'root')
  let credential = b.credential ? String(b.credential) : undefined
  if (!credential && b.secret) credential = inlineCred(`${name} 的 SSH ${b.authKind === 'key' ? '私钥' : '密码'}`, '服务器', b.authKind === 'key' ? '密钥' : '账号密码', env, user, String(b.secret), `${user}@${ip}`)
  const sv: Server = { id: uid('sv'), name, ip, port: Number(b.port) || 22, user, credential, env, ...(typeof b.protect === 'boolean' ? { protect: b.protect } : {}), os: '', agent: 'SSH', online: false, cpu: 0, mem: 0, disk: 0, services: [], logs: [] }
  put1('servers', sv)
  audit({ via: '—', action: 'server.add', target: `${name} · ${user}@${ip}`, level: '写', result: '成功', how: '本人' })
  return pub('servers', await checkServer(sv))
})
route('PUT', '/api/servers/:id', (c) => {
  const old = get<Server>('servers', c.params.id)
  if (!old) throw new HttpError(404, '没有')
  const b = c.body ?? {}
  const name = b.name === undefined ? undefined : String(b.name).trim().slice(0, 40)
  if (name !== undefined && !name) throw bad('名字不能空')
  if (name && all<Server>('servers').some((s) => s.id !== old.id && s.name === name)) throw bad('已经有同名的服务器')
  const env = b.env === undefined ? undefined : envOf(b.env, old.env)
  const protect = typeof b.protect === 'boolean' ? b.protect : undefined
  const changes = [name && name !== old.name && `名字 → ${name}`, env && env !== old.env && `环境 ${old.env} → ${env}`, protect !== undefined && protect !== isProtected(old) && (protect ? '改东西先确认' : '改东西不用确认')].filter(Boolean)
  if (changes.length) audit({ via: '—', action: 'server.update', target: `${old.name} · ${changes.join(' · ')}`, level: '写', result: '成功', how: '本人' })
  if (b.policy !== undefined) audit({ via: '—', action: 'server.policy', target: old.name, level: '写', result: '成功', how: '本人' })
  if (typeof b.autoUpgrade === 'boolean' && b.autoUpgrade !== (old.autoUpgrade !== false)) audit({ via: '—', action: 'server.update', target: `${old.name} · Agent 自动升级${b.autoUpgrade ? '打开' : '关掉'}`, level: '写', result: '成功', how: '本人' })
  if (b.dirs !== undefined) {
    const dirs = cleanDirs(b.dirs)
    applyDirs(old, dirs, (sv) => put1('servers', sv)).catch(() => {})
    audit({ via: '—', action: 'server.dirs', target: `${old.name}：${dirs.map((d) => `${d.path}（${d.mode}）`).join('、') || '清空'}`, level: '危险', result: '成功', how: '本人' })
    old.dirs = dirs.map((d) => ({ ...d, ok: undefined, error: '在设权限…' }))
  }
  if (b.logSrc !== undefined) {
    old.logSrc = cleanLogs(b.logSrc)
    audit({ via: '—', action: 'server.logs', target: `${old.name}：${old.logSrc.map((l) => l.path).join('、') || '清空'}`, level: '写', result: '成功', how: '本人' })
  }
  const next: Server = { ...old, ...(name ? { name } : {}), ...(env ? { env } : {}), ...(protect !== undefined ? { protect } : {}), ...(b.policy !== undefined ? { policy: cleanPolicy(b.policy, old.policy) } : {}), ...(b.ip && old.id !== LOCAL_ID ? { ip: String(b.ip), hostKey: undefined } : {}), ...(b.port ? { port: Number(b.port) } : {}), ...(b.user ? { user: String(b.user) } : {}), ...(b.credential !== undefined ? { credential: b.credential || undefined } : {}), ...(typeof b.autoUpgrade === 'boolean' ? { autoUpgrade: b.autoUpgrade } : {}) }
  return pub('servers', put1('servers', next))
})

route('DELETE', '/api/servers/:id', (c) => {
  if (c.params.id === LOCAL_ID) throw bad('本机不能删')
  del1('servers', c.params.id)
  return { ok: true }
})
route('POST', '/api/servers/:id/check', async (c) => {
  const sv = get<Server>('servers', c.params.id)
  if (!sv) throw new HttpError(404, '没有')
  return pub('servers', await checkServer(sv))
})
// 看日志（服务器详情「日志」）：systemd 服务或日志文件的最后 N 行；只读
route('GET', '/api/servers/:id/services', async (c) => {
  const sv = get<Server>('servers', c.params.id)
  if (!sv) throw new HttpError(404, '没有')
  const r = await execOn(sv, "systemctl list-units --type=service --state=running --no-legend --plain 2>/dev/null | awk '{print $1}' | head -n 200", 20_000)
  return { services: r.out.split('\n').map((x) => x.trim()).filter((x) => /^[\w@.:-]+\.service$/.test(x)) }
})
route('GET', '/api/servers/:id/logs', async (c) => {
  const sv = get<Server>('servers', c.params.id)
  if (!sv) throw new HttpError(404, '没有')
  const q = c.url.searchParams
  const lines = Math.max(20, Math.min(Number(q.get('lines')) || 200, 2000))
  const svc = q.get('service') ?? ''
  const file = q.get('file') ?? ''
  const dir = (q.get('dir') ?? '').replace(/(.)\/+$/, '$1')
  // 目录 / 带 * 的路径：看最新的那个文件
  const newest = (glob: string) => `f=$(ls -t ${glob} 2>/dev/null | head -n 1); if [ -n "$f" ]; then echo "== $f =="; tail -n ${lines} "$f" 2>&1; else echo "没有匹配的日志文件：${glob.replace(/'/g, '')}"; fi`
  let cmd: string
  if (svc) { if (!/^[\w@.:-]+$/.test(svc)) throw bad('服务名不对'); cmd = `journalctl -u '${svc}' -n ${lines} --no-pager -o short-iso 2>&1` }
  else if (dir) { if (!/^\/[\w./@+-]+$/.test(dir) || dir.includes('..')) throw bad('目录要是绝对路径'); cmd = newest(`${shq(dir)}/*.log`) }
  else if (file) {
    if (!/^\/[\w./*@+-]+$/.test(file) || file.includes('..')) throw bad('日志路径要是绝对路径')
    cmd = file.includes('*') ? newest(file) : `tail -n ${lines} '${file}' 2>&1`
  }
  else throw bad('选一个服务或日志文件')
  const r = await execOn(sv, cmd, 20_000)
  return { text: r.out, code: r.code }
})
// 选目录 / 选文件（网页上所有填服务器路径的地方）：列一层，只读。Agent 那台以 root 看，所以能看到 AI 用户看不到的
route('GET', '/api/servers/:id/ls', async (c) => {
  const sv = get<Server>('servers', c.params.id)
  if (!sv) throw new HttpError(404, '没有')
  const p = (c.url.searchParams.get('path') || '/').trim().replace(/(.)\/+$/, '$1')
  if (!p.startsWith('/') || p.split('/').includes('..') || /[\0\n\r]/.test(p)) throw bad('路径要是绝对路径')
  const r = await execOn(sv, `cd -- ${shq(p)} || exit 3; find . -mindepth 1 -maxdepth 1 -printf '%Y\\t%s\\t%TY-%Tm-%Td %TH:%TM\\t%f\\n' 2>/dev/null | head -n 3000`, 20_000)
  if (r.code !== 0) throw bad(r.out.trim().split('\n').pop()?.replace(/^.*cd: /, '') || '打不开这个目录')
  const entries = r.out.split('\n').filter(Boolean).map((l) => {
    const [y, size, time, ...name] = l.split('\t')
    return { name: name.join('\t'), dir: y === 'd', size: Number(size) || 0, time }
  }).filter((e) => e.name && e.name !== '.' && e.name !== '..')
  entries.sort((a, b) => Number(b.dir) - Number(a.dir) || Number(a.name.startsWith('.')) - Number(b.name.startsWith('.')) || a.name.localeCompare(b.name))
  return { path: p, entries }
})
route('POST', '/api/servers/:id/exec', async (c) => {
  const sv = get<Server>('servers', c.params.id)
  if (!sv) throw new HttpError(404, '没有')
  const command = String(c.body?.command ?? '').trim()
  const ro = isReadOnly(command)
  if (!ro && isProtected(sv)) needVerify(c) // 只有生产这类受保护的服务器上改东西才验证本人
  const r = await execOn(sv, command, 60_000)
  audit({ via: '—', action: 'server.exec', target: `${sv.name} · ${command.slice(0, 100)}`, level: ro ? '读' : '写', result: r.code === 0 ? '成功' : '失败', how: ro ? '本人（只读命令）' : '本人（已验证）' })
  return r
})

// ---------- 凭证 ----------
route('POST', '/api/credentials', (c) => saveCred(c))
route('PUT', '/api/credentials/:id', (c) => saveCred(c, c.params.id))
// 新增 / 改凭证不用验证本人（存进去不会泄露什么）；看明文、删才要
async function saveCred(c: Ctx, id?: string) {
  const b = c.body ?? {}
  const old = id ? get<Credential>('credentials', id) : undefined
  if (id && !old) throw new HttpError(404, '没有')
  const group = CRED_GROUPS.includes(String(b.group)) ? String(b.group) : old?.group ?? '其它'
  const kind = String(b.kind ?? old?.kind ?? '').trim().slice(0, 40) || '令牌'
  const meta = cleanMeta(b.meta ?? old?.meta)
  let user = b.user !== undefined ? String(b.user).trim() : old?.user
  // 一行的值（令牌、Key、密码）去掉首尾空白：复制时常多带空格、换行；私钥、证书这类多行的原样存
  const rawSecret = b.secret ? String(b.secret) : ''
  const secret = rawSecret.trim().includes('\n') ? rawSecret : rawSecret.trim()
  if (!old && !secret) throw bad(group === '数据库' || group === '服务器' ? '密码要填' : '密钥 / 令牌要填')
  // 存之前真的连一次：结果记在凭证上（连不上也存，网页上标红，方便以后再试）
  const t = await testCred({ group, kind, meta, user }, secret || (old ? getSecret(old.id) ?? '' : ''))
  if (group === '代码仓库' && t.ok && t.user && kind !== 'GitHub' && !user) user = t.user // git 走 HTTPS 时的用户名（GitHub 不用）
  const name = String(b.name ?? '').trim() || old?.name || autoCredName(group, kind, meta, user ?? t.user)
  const cred: Credential = {
    id: old?.id ?? uid('cr'), name, group, kind, env: envOf(b.env, old?.env ?? '生产'), meta, user,
    test: { ok: t.ok, msg: t.msg, at: Date.now(), details: t.details }, updated: now(), aiAllowed: b.aiAllowed ?? old?.aiAllowed ?? true,
  }
  if (secret) setSecret(cred.id, secret)
  put1('credentials', cred)
  // 数据库：同一份接进「数据」（员工查库用它）
  if (group === '数据库' && isSqlKind(kind)) syncDataSource(cred, b.writable, t.ok)
  // 新加的：按员工「以后新加的这类自动给它」勾好
  if (!old && cred.aiAllowed) for (const e of all<Employee>('employees').filter((x) => x.credGroups?.includes(group))) put1('employees', { ...e, creds: [...(e.creds ?? []), cred.id] })
  if (!old) answerCredRequests(cred)
  // 存的是 Claude 订阅令牌：加进「AI 执行器」的账号列表（不改默认），员工就能用它
  if (group === 'AI' && /anthropic|claude|token/i.test(kind) && runner.isOat(runner.claudeKey(cred.id), cred.id)) {
    const conf = runner.aiConf()
    if (!runner.claudeAccounts().includes(cred.id)) kvSet('ai', { ...conf, claudeAccounts: [...new Set([...(conf.claudeAccounts ?? []), cred.id])], claudeCred: conf.claudeCred ?? cred.id })
  }
  audit({ via: '—', action: old ? 'credential.update' : 'credential.create', target: `${name}（${group} · ${kind}）`, level: '危险', result: '成功', how: '本人' })
  return pub('credentials', cred)
}
/** 员工 request_credential 要过的：同一类（给了类型就同类型）的新凭证存好了 → 给它开、卡片标完成、告诉它接着做 */
function answerCredRequests(cred: Credential) {
  const rows = db.prepare(`SELECT id, sid, data FROM messages WHERE data LIKE '%"credReq"%' ORDER BY ts DESC LIMIT 50`).all() as { id: string; sid: string; data: string }[]
  for (const r of rows) {
    const m = JSON.parse(r.data) as Message
    const q = m.card?.data.credReq as { emp: string; group: string; kind?: string } | undefined
    if (!m.card || m.card.state !== 'open' || !q || q.group !== cred.group || (q.kind && q.kind.toLowerCase() !== cred.kind.toLowerCase())) continue
    const e = get<Employee>('employees', q.emp)
    if (!e) continue
    if (cred.aiAllowed && !e.creds?.includes(cred.id)) put1('employees', { ...e, creds: [...(e.creds ?? []), cred.id] })
    patchMsg(r.id, { card: { ...m.card, state: 'done', result: `已添加「${cred.name}」并给 ${e.name} 开了` } })
    syncWaiting(r.sid)
    runner.send(e.id, `主人加好了凭证「${cred.name}」（${cred.group} · ${cred.kind}${cred.test ? `，测试${cred.test.ok ? '通过' : `没通过：${cred.test.msg}`}` : ''}），已经给你开了，接着做。`)
  }
}
const CRED_GROUPS = ['服务器', '数据库', '代码仓库', '云账号', 'AI', '签名证书', '消息渠道', '其它']
/** 不是密码的字段：只留短字符串 */
function cleanMeta(m: unknown): Record<string, string> | undefined {
  if (!m || typeof m !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(m as Record<string, unknown>).slice(0, 20)) if (/^\w{1,30}$/.test(k) && v !== undefined && v !== null && String(v).trim()) out[k] = String(v).trim().slice(0, 300)
  return Object.keys(out).length ? out : undefined
}
/** 没起名字就自动起：「MySQL · 10.0.0.5/shop」「GitHub · zhangsan」「阿里云 · LTAI…3xQ」 */
function autoCredName(group: string, kind: string, m: Record<string, string> | undefined, user?: string) {
  const x = m ?? {}
  const tail = group === '数据库' ? [x.host, x.db].filter(Boolean).join('/') : group === '服务器' ? `${user ? user + '@' : ''}${x.host ?? ''}` : group === '云账号' ? (x.akId ? `${x.akId.slice(0, 6)}…${x.akId.slice(-3)}` : '') : group === '代码仓库' ? (user || x.site || '') : ''
  return tail ? `${kind} · ${tail}` : kind
}
/** 数据库凭证 ↔ 「数据」里的库：一份 */
function syncDataSource(cred: Credential, writable: unknown, connected: boolean) {
  const m = cred.meta ?? {}
  const old = all<DataSource>('dataSources').find((d) => d.credential === cred.id)
  const ds: DataSource = {
    id: old?.id ?? uid('ds'), name: cred.name, kind: cred.kind as DataSource['kind'], env: cred.env, ...(old?.protect !== undefined ? { protect: old.protect } : {}),
    host: m.host ?? '', port: Number(m.port) || undefined, db: m.db ?? '', user: cred.user ?? '', credential: cred.id,
    writable: typeof writable === 'boolean' ? writable : old?.writable ?? false, tables: old?.tables ?? [],
  }
  put1('dataSources', ds)
  if (connected) schemaOf(ds).then((sc) => { const cur = get<DataSource>('dataSources', ds.id); if (cur) put1('dataSources', { ...cur, ...sc }) }).catch(() => {})
}
// 测试连接：新增时用填的值，编辑时没填新值就用存着的
route('POST', '/api/credentials/test', async (c) => {
  const b = c.body ?? {}
  const old = b.id ? get<Credential>('credentials', String(b.id)) : undefined
  const secret = b.secret ? String(b.secret) : old ? getSecret(old.id) ?? '' : ''
  if (!secret) throw bad('先填密码 / 令牌')
  const r = await testCred({ group: String(b.group ?? old?.group ?? ''), kind: String(b.kind ?? old?.kind ?? ''), meta: cleanMeta(b.meta ?? old?.meta), user: b.user !== undefined ? String(b.user) : old?.user }, secret)
  if (old && !b.secret) put1('credentials', { ...old, test: { ok: r.ok, msg: r.msg, at: Date.now(), details: r.details } })
  return r
})
// 能选的模型：用存着的 Key / 订阅令牌去问 Anthropic / OpenAI 有哪些（读不到就用内置的），缓存 12 小时
const BUILTIN_CLAUDE = ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5', 'Fable 5.1']
route('GET', '/api/ai/models', async (c) => {
  const cache = kvGet<{ at: number; claude: string[]; codex: string[] }>('aiModels', { at: 0, claude: [], codex: [] })
  if (Date.now() - cache.at < 12 * 3600_000 && !c.url.searchParams.get('refresh')) return cache
  const conf = runner.aiConf()
  const get1 = async (url: string, headers: Record<string, string>) => {
    try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) }); return r.ok ? ((await r.json()) as any) : null } catch { return null }
  }
  let claude: string[] = []
  const ck = runner.claudeKey(conf.claudeCred)
  if (ck) {
    const oat = runner.isOat(ck, conf.claudeCred)
    const j = await get1('https://api.anthropic.com/v1/models?limit=100', oat ? { Authorization: `Bearer ${ck}`, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'oauth-2025-04-20' } : { 'x-api-key': ck, 'anthropic-version': '2023-06-01' })
    claude = (j?.data ?? []).map((x: any) => String(x.id)).filter((id: string) => /^claude-/.test(id))
  }
  let codex: string[] = []
  const xk = conf.codexCred ? getSecret(conf.codexCred) : undefined
  if (xk) {
    const j = await get1(`${(conf.codexBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')}/models`, { Authorization: `Bearer ${xk}` })
    codex = (j?.data ?? []).map((x: any) => String(x.id)).filter((id: string) => /^(gpt-|o\d|codex)/.test(id) && !/(audio|realtime|tts|transcribe|image|embedding|search|moderation|instruct)/.test(id)).sort().reverse()
  }
  const out = { at: Date.now(), claude: [...BUILTIN_CLAUDE, ...claude.filter((id) => !Object.values({ a: 'claude-opus-5-5', b: 'claude-sonnet-5-5', c: 'claude-haiku-5-5', d: 'claude-fable-5-1' }).includes(id))], codex: ['执行器默认', ...codex] }
  if (claude.length || codex.length) kvSet('aiModels', out)
  return out
})
// 云账号下的域名（登记域名时点一个）
route('GET', '/api/credentials/:id/zones', async (c) => {
  const cr = get<Credential>('credentials', c.params.id)
  if (!cr) throw new HttpError(404, '没有')
  try { return await dns.zonesOf(cr) } catch (e) { throw bad((e as Error).message) }
})
// 仓库的分支（接入仓库时自动选默认分支）
route('GET', '/api/repo-branches', async (c) => {
  const url = String(c.url.searchParams.get('url') ?? '').trim()
  const cred = c.url.searchParams.get('cred') || undefined
  try { return await remoteBranches(url, cred) } catch (e) { throw bad((e as Error).message) }
})
// 代码仓库凭证能访问的仓库（新建项目时点一个就行）
route('GET', '/api/credentials/:id/repos', async (c) => {
  const cr = get<Credential>('credentials', c.params.id)
  if (!cr || cr.group !== '代码仓库') throw new HttpError(404, '没有')
  try { return { repos: await gitRepos(cr.kind, cr.meta ?? {}, getSecret(cr.id) ?? '') } } catch (e) { throw bad(`读不到仓库列表：${(e as Error).message}`) }
})
route('DELETE', '/api/credentials/:id', (c) => {
  const cr = get<Credential>('credentials', c.params.id)
  delSecret(c.params.id)
  del1('credentials', c.params.id)
  for (const d of all<DataSource>('dataSources').filter((x) => x.credential === c.params.id)) del1('dataSources', d.id)
  for (const e of all<Employee>('employees').filter((x) => x.creds?.includes(c.params.id))) put1('employees', { ...e, creds: e.creds!.filter((x) => x !== c.params.id) })
  audit({ via: '—', action: 'credential.delete', target: cr?.name ?? c.params.id, level: '危险', result: '成功', how: '本人' })
  return { ok: true }
})
route('POST', '/api/credentials/:id/reveal', (c) => {
  needVerify(c)
  const cr = get<Credential>('credentials', c.params.id)
  if (!cr) throw new HttpError(404, '没有')
  audit({ via: '—', action: 'credential.reveal', target: cr.name, level: '危险', result: '成功', how: '本人（已验证）' })
  return { value: getSecret(cr.id) ?? '' }
})

// ---------- 数据库 ----------
route('POST', '/api/data-sources', async (c) => {
  const b = c.body ?? {}
  const name = String(b.name ?? '').trim()
  if (!name || !b.host) throw bad('名字、地址要填')
  const kind = b.kind === 'PostgreSQL' ? 'PostgreSQL' : 'MySQL'
  const env = envOf(b.env, '生产')
  let credential = b.credential ? String(b.credential) : undefined
  if (!credential && b.password) credential = inlineCred(`${name} 的数据库账号`, '数据库', '数据库', env, String(b.user ?? ''), String(b.password), b.writable ? '读写' : '只读')
  const ds: DataSource = { id: uid('ds'), name, kind, env, ...(typeof b.protect === 'boolean' ? { protect: b.protect } : {}), host: String(b.host), port: Number(b.port) || undefined, db: String(b.db ?? ''), user: String(b.user ?? ''), credential, writable: !!b.writable, tables: [] }
  put1('dataSources', ds)
  audit({ via: '—', action: 'data.add', target: `${name} · ${kind} ${ds.host}/${ds.db}`, level: '写', result: '成功', how: '本人' })
  try { Object.assign(ds, await schemaOf(ds)); put1('dataSources', ds) } catch (e) { return { ...ds, error: `连不上：${(e as Error).message}` } }
  return ds
})
route('PUT', '/api/data-sources/:id', (c) => {
  const old = get<DataSource>('dataSources', c.params.id)
  if (!old) throw new HttpError(404, '没有')
  const b = c.body ?? {}
  return put1('dataSources', { ...old, ...(b.name ? { name: String(b.name) } : {}), ...(b.env ? { env: envOf(b.env, old.env) } : {}), ...(typeof b.protect === 'boolean' ? { protect: b.protect } : {}), ...(b.writable !== undefined ? { writable: !!b.writable } : {}) })
})
route('DELETE', '/api/data-sources/:id', (c) => { del1('dataSources', c.params.id); return { ok: true } })
route('POST', '/api/data-sources/:id/schema', async (c) => {
  const ds = get<DataSource>('dataSources', c.params.id)
  if (!ds) throw new HttpError(404, '没有')
  try { return put1('dataSources', { ...ds, ...(await schemaOf(ds)) }) } catch (e) { throw bad(`连不上：${(e as Error).message}`) }
})
route('POST', '/api/data-sources/:id/query', async (c) => {
  const ds = get<DataSource>('dataSources', c.params.id)
  if (!ds) throw new HttpError(404, '没有')
  const sql = String(c.body?.sql ?? '').trim()
  const read = isReadSql(sql)
  if (!read) {
    if (!ds.writable) throw bad('这个库只接了只读账号，不能改数据')
    if (isProtected(ds)) needVerify(c) // 生产库改数据才验证本人
  }
  try {
    const r = await runQuery(ds, sql, { write: !read })
    audit({ via: '—', action: read ? 'db.query' : 'db.exec', target: `${ds.name} · ${sql.slice(0, 100)}`, level: read ? '读' : '写', result: '成功', how: read ? '本人（只读）' : '本人（已验证）' })
    return r
  } catch (e) { throw bad(`出错了：${(e as Error).message}`) }
})
route('POST', '/api/saved-queries', (c) => {
  const b = c.body ?? {}
  return put1('savedQueries', { id: uid('q'), source: String(b.source ?? ''), name: String(b.name ?? '查询').slice(0, 40), sql: String(b.sql ?? '') } satisfies SavedQuery)
})
route('DELETE', '/api/saved-queries/:id', (c) => { del1('savedQueries', c.params.id); return { ok: true } })

// ---------- 触发器 ----------
function cleanTrigger(b: any, old?: Trigger): Trigger {
  try { return makeTrigger(b, old) } catch (e) { throw bad((e as Error).message) }
}
route('POST', '/api/triggers', (c) => pub('triggers', put1('triggers', cleanTrigger(c.body ?? {}))))
route('PUT', '/api/triggers/:id', (c) => {
  const old = get<Trigger>('triggers', c.params.id)
  if (!old) throw new HttpError(404, '没有')
  return pub('triggers', put1('triggers', cleanTrigger(c.body ?? {}, old)))
})
route('DELETE', '/api/triggers/:id', (c) => { del1('triggers', c.params.id); return { ok: true } })
route('POST', '/api/triggers/:id/run', (c) => {
  const t = get<Trigger>('triggers', c.params.id)
  if (!t) throw new HttpError(404, '没有')
  fire(t)
  return { ok: true }
})
route('POST', '/hook/:token', (c) => {
  const t = all<Trigger>('triggers').find((x) => x.kind === 'Webhook' && x.hookToken && x.hookToken === c.params.token)
  if (!t || !t.enabled) throw new HttpError(404, '没有')
  const body = c.raw?.toString('utf8') ?? ''
  fire(t, body || '(空)')
  return { ok: true }
}, { auth: 'none', raw: true })

// ---------- 知识库 ----------
route('POST', '/api/kb', (c) => saveKb(c))
route('PUT', '/api/kb/:id', (c) => saveKb(c, c.params.id))
function saveKb(c: Ctx, id?: string) {
  const b = c.body ?? {}
  const old = id ? get<KbDoc>('kb', id) : undefined
  const name = String(b.name ?? old?.name ?? '').trim()
  if (!name) throw bad('先起个名字')
  const body = String(b.body ?? old?.body ?? '')
  const d: KbDoc = { id: old?.id ?? uid('kb'), name, kind: String(b.kind ?? old?.kind ?? '其它'), summary: String(b.summary ?? '').trim() || body.replace(/\s+/g, ' ').slice(0, 60), body, updated: new Date().toLocaleDateString('zh-CN'), by: '主人' }
  return put1('kb', d)
}
route('DELETE', '/api/kb/:id', (c) => { del1('kb', c.params.id); return { ok: true } })

// ---------- 项目 ----------
route('POST', '/api/workspaces', async (c) => {
  const b = c.body ?? {}
  const repo = String(b.repo ?? '').trim()
  if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(repo)) throw bad('仓库地址要以 https:// 开头')
  const name = String(b.name || repo.replace(/\.git$/, '').split('/').pop() || '').trim()
  if (!name) throw bad('起个名字')
  if (all<Workspace>('workspaces').some((w) => w.name === name)) throw bad('已经有同名的项目')
  const server = empHost(b.server)
  const svName = hosts.isLocal(server) ? '本机' : (get<Server>('servers', server)?.name ?? server)
  const w: Workspace = { id: uid('w'), name, provider: providerOf(repo), repo, branch: String(b.branch ?? '').trim(), host: svName, server, dir: workspaceDir(name, server), last: '拉取中…', employees: [], credential: b.credential || undefined, branches: [], commits: [], docs: [] }
  put1('workspaces', w)
  audit({ via: '—', action: 'workspace.add', target: `${name} · ${repo}`, level: '写', result: '成功', how: '本人' })
  // 建项目就有一个常驻员工（名字用项目名，能改），这个项目相关的权限都给它；拉代码失败要告诉主人（写进这个员工的聊天、推送）
  projectEmployee(w)
  cloneWorkspace(w).then(async () => { const next = put1('workspaces', { ...w, ...(await inspect(w)) }); await ensureBuild(next) })
    .catch((e) => cloneFailed(w, String((e as Error).message)))
  return w
})
/** 给项目建一个员工：跑在项目那台、工作目录就是项目、记忆用项目 docs/；仓库凭证、部署要用的服务器凭证、签名证书都给它 */
function projectEmployee(w: Workspace): Employee {
  const p = PRESETS.dev
  // 职位 = 项目名（同一个项目第二个起加编号），名字随机起一个人名
  const same = all<Employee>('employees').filter((e) => e.workspace === w.id).length
  const role = (same ? `${w.name} ${same + 1}` : w.name).slice(0, 20)
  const name = randomName(undefined, all<Employee>('employees').map((e) => e.name))
  const deploySrv = (w.deploys ?? []).flatMap((d) => d.servers ?? [])
  const creds = [w.credential, ...deploySrv.map((id) => get<Server>('servers', id)?.credential), ...all<Credential>('credentials').filter((c) => c.group === '签名证书').map((c) => c.id)]
    .filter((x): x is string => !!x && !!get('credentials', x))
  // 执行器跟着最近建的员工（多半装好的是哪个就用哪个）
  const last = all<Employee>('employees').slice(-1)[0]
  return createEmployee(cleanEmp({
    name, role, avatar: name.slice(0, 1), color: p.color, title: `${w.name} 项目的开发`, prompt: `你负责「${w.name}」这个项目（${w.repo}）：按主人说的改代码、查问题、发布。先读项目的 README / CLAUDE.md / docs/交接.md 了解规矩；改完自查（看 diff），提交说明写清楚；做完在 docs/交接.md 最上面加一条。`,
    menus: p.menus, effort: 'high', approval: 'auto', executor: last?.executor ?? 'Claude Code', model: last?.model ?? 'Opus 5.5',
    host: w.server ?? 'local', workspace: w.id, creds: [...new Set(creds)],
  }))
}
// 项目再加一个员工（点一下就建，名字「项目名 2」，能改）
route('POST', '/api/workspaces/:id/employees', (c) => {
  const w = get<Workspace>('workspaces', c.params.id)
  if (!w) throw new HttpError(404, '没有')
  return projectEmployee(w)
})
/** 项目还没有编译设置：认出类型、建好流水线（默认「自动」：本地资源够就本地编，不够走流水线） */
const building = new Set<string>()
async function ensureBuild(w: Workspace) {
  if (build.buildsOf(w).length || w.error || building.has(w.id)) return
  building.add(w.id)
  try { await ensureBuild1(w) } finally { building.delete(w.id) }
}
async function ensureBuild1(w: Workspace) {
  // 云效用的令牌：项目自己的凭证是 Codeup 的就用它，不然找第一个 Codeup 凭证
  const own = w.credential ? get<Credential>('credentials', w.credential) : undefined
  const codeup = own && /codeup/i.test(own.kind) ? own.id : all<Credential>('credentials').find((x) => x.group === '代码仓库' && /codeup/i.test(x.kind))?.id
  try {
    const cfg = await build.autoConfig(w, codeup)
    const cur = get<Workspace>('workspaces', w.id)
    if (cur && !build.buildsOf(cur).length) put1('workspaces', { ...cur, builds: [cfg] })
    audit({ via: '—', action: 'build.auto', target: `${w.name} · ${build.providerName(cfg)}${cfg.pipelineError ? `（流水线没建成：${cfg.pipelineError.slice(0, 80)}）` : ''}`, level: '写', result: cfg.pipelineError ? '失败' : '成功', how: '接入项目时自动' })
  } catch { /* 认不出来也不挡 */ }
}
route('POST', '/api/workspaces/:id/refresh', async (c) => {
  const w = get<Workspace>('workspaces', c.params.id)
  if (!w) throw new HttpError(404, '没有')
  if (w.error && !fs.existsSync(path.join(w.dir, '.git'))) {
    try { await cloneWorkspace(w) } catch (e) { cloneFailed(w, String((e as Error).message)); throw bad(`没拉下来：${String((e as Error).message).slice(-300)}`) }
  }
  const next = put1('workspaces', { ...w, ...(await inspect(w)) })
  void ensureBuild(next)
  return next
})
route('PUT', '/api/workspaces/:id', (c) => {
  const w = get<Workspace>('workspaces', c.params.id)
  if (!w) throw new HttpError(404, '没有')
  const b = c.body ?? {}
  const builds = Array.isArray(b.builds) ? cleanBuilds(w, b.builds) : build.buildsOf(w)
  const deploys = Array.isArray(b.deploys) ? cleanDeploys(b.deploys, w.deploys, builds) : w.deploys
  // 删了某个编译组件：还在用它的发布目标要先改
  const orphan = (deploys ?? []).find((d) => d.build && d.build !== 'none' && !builds.some((x) => x.id === d.build))
  if (orphan) throw bad(`发布目标「${orphan.name}」发的是被删掉的编译组件：先给它换一个组件（或改成不编译）`)
  // 改名：只是显示和员工叫它用的名字，目录、仓库都不动
  const name = b.name !== undefined ? String(b.name).trim().slice(0, 40) : w.name
  if (!name) throw bad('项目要有名字')
  if (name !== w.name && all<Workspace>('workspaces').some((x) => x.id !== w.id && x.name === name)) throw bad('已经有同名的项目')
  return put1('workspaces', { ...w, name, ...(b.credential !== undefined ? { credential: b.credential || undefined } : {}), ...(b.preview !== undefined ? { preview: String(b.preview) } : {}),

    builds: builds.length ? builds : undefined, deploys })
})
/** 编译组件列表：每个要有名字（不重名）；已有的按编号保留流水线记录，新的分配编号 */
function cleanBuilds(w: Workspace, list: any[]): build.BuildComp[] {
  const old = build.buildsOf(w)
  const out: build.BuildComp[] = []
  for (const x of list.slice(0, 20)) {
    const name = String(x?.name ?? '').trim().slice(0, 40)
    if (!name) throw bad('编译组件要有名字（比如「网页」「安卓」）')
    if (out.some((y) => y.name === name)) throw bad(`编译组件「${name}」重名了`)
    const prev = old.find((y) => y.id === x?.id)
    const id = prev?.id ?? build.newBuildId({ ...w, builds: [...old, ...out] }, String(x?.id || name))
    out.push({ ...cleanBuild(x, prev)!, id, name })
  }
  return out
}
/** 编译设置：哪种模板、在哪编（云效 / GitHub / 自己的服务器） */
function cleanBuild(b: any, old?: build.BuildCfg): build.BuildCfg | undefined {
  if (!b) return undefined
  const kind = ['node', 'go', 'android', 'spring', 'custom'].includes(b.kind) ? b.kind : 'custom'
  const provider = ['yunxiao', 'github', 'gitlab', 'jenkins', 'local'].includes(b.provider) ? b.provider : 'local'
  const s = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n) || undefined
  const out: build.BuildCfg = { kind, provider, subdir: s(b.subdir, 100), cmd: s(b.cmd, 8000), versionFile: s(b.versionFile), versionRe: s(b.versionRe), service: s(b.service, 80)?.replace(/[^A-Za-z0-9@._-]/g, ''), file: s(b.file, 100) }
  if (kind === 'custom' && !out.cmd) throw bad('自定义模板要写编译命令（把产物放进 out/）')
  if (kind === 'spring') out.spring = { tool: b.spring?.tool === 'gradle' ? 'gradle' : 'maven', jdk: Number(b.spring?.jdk) === 21 ? 21 : 17, task: s(b.spring?.task), jar: s(b.spring?.jar), dirs: Array.isArray(b.spring?.dirs) ? b.spring.dirs.map(String).slice(0, 10) : [] }
  if (provider === 'yunxiao') {
    if (!get<Credential>('credentials', String(b.yunxiao?.cred ?? ''))) throw bad('选一个 Codeup 凭证（个人访问令牌，要有流水线读写）')
    out.yunxiao = { cred: String(b.yunxiao.cred), org: s(b.yunxiao?.org, 64), pipelineId: s(b.yunxiao?.pipelineId, 32) ?? old?.yunxiao?.pipelineId, image: s(b.yunxiao?.image), at: old?.yunxiao?.at }
  }
  if (provider === 'github') out.github = { workflow: s(b.github?.workflow, 80)?.replace(/[^\w.-]/g, '') ?? old?.github?.workflow, at: old?.github?.at }
  if (provider === 'gitlab') out.gitlab = { at: old?.gitlab?.at }
  if (provider === 'jenkins') {
    if (!get<Credential>('credentials', String(b.jenkins?.cred ?? ''))) throw bad('选一个 Jenkins 凭证（凭证 → 其它 → Jenkins：地址、用户名、API Token）')
    out.jenkins = { cred: String(b.jenkins.cred), job: s(b.jenkins?.job, 80)?.replace(/[^\w.-]/g, '-') ?? old?.jenkins?.job, at: old?.jenkins?.at }
  }
  // 本地编在哪台：不选就用项目所在那台
  if (b.local?.server && get<Server>('servers', String(b.local.server))) out.local = { server: String(b.local.server) }
  out.where = ['auto', 'local', 'pipeline'].includes(b.where) ? b.where : provider === 'local' ? 'local' : old?.where ?? 'auto'
  if (out.where === 'pipeline' && provider === 'local') throw bad('「总是流水线」要先选一个打包工具（云效 / GitHub Actions）')
  return out
}
/** 项目 + 编译组件（地址里的 :bid 是组件编号） */
function compOf(c: Ctx): { w: Workspace; b: build.BuildComp } {
  const w = get<Workspace>('workspaces', c.params.id)
  if (!w) throw new HttpError(404, '没有这个项目')
  const b = build.buildsOf(w).find((x) => x.id === c.params.bid)
  if (!b) throw new HttpError(404, '没有这个编译组件（先在编译设置里存好）')
  return { w, b }
}
/** 存一个组件的最新样子（生成流水线后记下流水线编号等） */
export function saveBuild(wsId: string, b: build.BuildComp): Workspace {
  const cur = get<Workspace>('workspaces', wsId)!
  return put1('workspaces', { ...cur, builds: build.buildsOf(cur).map((x) => (x.id === b.id ? b : x)) })
}
route('POST', '/api/workspaces/:id/builds/:bid/generate', async (c) => {
  const { w, b } = compOf(c)
  try {
    const next = await build.generate(w, b)
    audit({ via: '—', action: 'build.generate', target: `${w.name} · ${b.name} · ${build.providerName(next)}`, level: '写', result: '成功', how: '本人' })
    return saveBuild(w.id, { ...next, pipelineError: undefined })
  } catch (e) { throw bad((e as Error).message) }
})
// 打包工具（GitLab / Jenkins…）来拿源码、传产物：地址里带一次性令牌，不用登录
route('GET', '/api/build-src/:token', (c) => {
  const f = pipes.takeSource(c.params.token)
  if (!f || !fs.existsSync(f)) throw new HttpError(404, '地址过期了')
  c.res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': fs.statSync(f).size })
  fs.createReadStream(f).pipe(c.res)
}, { auth: 'none' })
route('PUT', '/api/build-upload/:token', (c) => {
  if (!c.raw?.length) throw bad('没收到产物')
  if (!pipes.receiveUpload(c.params.token, c.raw)) throw new HttpError(404, '地址过期了')
  return { ok: true }
}, { auth: 'none', raw: true, max: 600 * 1024 * 1024 })
// 网页上的「试编译」：只编不发
route('POST', '/api/workspaces/:id/builds/:bid/try', (c) => {
  const { w, b } = compOf(c)
  try { return buildjobs.start(w, b, '主人') } catch (e) { throw bad((e as Error).message) }
})
route('GET', '/api/workspaces/:id/builds/:bid/try', (c) => buildjobs.lastOf(c.params.id, c.params.bid) ?? null)
route('GET', '/api/workspaces/:id/builds/:bid/script', (c) => {
  const { w, b } = compOf(c)
  return { script: build.script(b, build.codeOf(w, b)) }
})
function cleanDeploys(list: any[], old: Deploy[] = [], builds: build.BuildComp[] = []): Deploy[] {
  return list.slice(0, 20).map((d) => {
    const prev = old.find((o) => o.id === d.id)
    const name = String(d.name ?? '').trim().slice(0, 40)
    if (!name) throw bad('发布环境要有名字')
    const env = d.env === undefined ? prev?.env : String(d.env ?? '').trim().slice(0, 20) || undefined
    const servers = (Array.isArray(d.servers) ? d.servers : []).map(String).filter((id: string) => get<Server>('servers', id)).slice(0, 20)
    // 存进安装包的：不发服务器，记下端和渠道
    const pkg = d.package && packages.isPlatform(d.package.platform) ? { platform: d.package.platform, channel: packages.isChannel(d.package.channel) ? d.package.channel : 'test' as const } : undefined
    if (!servers.length && !pkg) throw bad(`发布环境「${name}」要选至少一台服务器（或者选「存进安装包」）`)
    const dir = String(d.dir ?? '').trim().replace(/\/+$/, '')
    if (dir && (!/^\/[\w./@+-]+$/.test(dir) || dir.includes('..'))) throw bad('部署目录要是绝对路径')
    const command = String(d.command ?? '').trim().slice(0, 4000)
    const sign = d.sign ? String(d.sign) : undefined
    if (sign && get<Credential>('credentials', sign)?.group !== '签名证书') throw bad(`发布环境「${name}」的签名证书不对`)
    if (sign && certType(sign) !== 'android') throw bad(`发布环境「${name}」：发布时只能用安卓签名证书签 apk / aab（苹果、Windows 的证书要在 Mac / Windows 上用）`)
    const health = String(d.health ?? '').trim()
    if (health && !/^https?:\/\/\S+$/.test(health)) throw bad('检查地址要以 http:// 或 https:// 开头')
    // 发哪个编译组件：'none' = 不编译；有好几个组件时要选
    const bid = String(d.build ?? '').trim()
    if (bid && bid !== 'none' && !builds.some((x) => x.id === bid)) throw bad(`发布环境「${name}」选的编译组件不在了`)
    if (!bid && builds.length > 1) throw bad(`发布环境「${name}」要选发哪个编译组件`)
    if (pkg && (bid === 'none' || (!bid && !builds.length))) throw bad(`发布环境「${name}」存进安装包：要先有编译组件（编出 apk / ipa / msix 这些的）`)
    return {
      id: prev?.id ?? uid('dp'), name, env, servers: pkg ? [] : servers, package: pkg, build: bid || undefined, dir: dir || undefined, script: String(d.script ?? '').trim().replace(/[^\w./-]/g, '') || undefined, command: command || undefined, sign, health: health || undefined,
      keep: Math.max(1, Math.min(Number(d.keep) || 5, 30)), ai: ['auto', 'ask', 'off'].includes(d.ai) ? d.ai : deployProtected({ env, servers }, (id) => get<Server>('servers', id)) ? 'ask' : 'auto', autoRollback: d.autoRollback !== false,
      last: prev?.last, lastOk: prev?.lastOk,
    }
  })
}
// 发布前看一眼：这个环境线上是哪个版本（最近一次成功的发布），这次会带上哪些提交（线上 → 远端最新）
route('GET', '/api/workspaces/:id/deploys/:did/changes', async (c) => {
  const w = get<Workspace>('workspaces', c.params.id)
  const d = w?.deploys?.find((x) => x.id === c.params.did)
  if (!w || !d) throw new HttpError(404, '没有这个发布环境')
  const ok = all<Release>('releases').filter((r) => r.ws === w.id && r.target === d.id && r.status === 'success').sort((a, b) => b.started - a.started)
  const online = ok[0]
  const on = { host: w.server, cwd: w.dir }
  if (w.credential) await git(['fetch', '--quiet', 'origin', w.branch], { ...on, cred: w.credential, timeoutMs: 30_000 }).catch(() => null)
  const ref = `origin/${w.branch}`
  const range = online?.sha && (await git(['merge-base', '--is-ancestor', online.sha, ref], on).catch(() => ({ code: 1, out: '' }))).code === 0 ? [`${online.sha}..${ref}`] : [ref, '-n', '10']
  const log = await git(['log', '--format=%h%x1f%s%x1f%an%x1f%ct', '-n', '50', ...range], on).catch(() => ({ code: 1, out: '' }))
  await handBackDir(w.server, w.dir) // fetch 是 Opero 这边跑的：目录权限还给 AI 用户
  const commits = log.code === 0 ? log.out.split('\n').filter(Boolean).map((l) => { const [sha, subject, author, ct] = l.split('\x1f'); return { sha, subject, author, at: Number(ct) * 1000, unfinished: /^\[未完成\]/.test(subject ?? '') } }) : []
  return {
    online: online ? { id: online.id, version: online.version, sha: online.sha, at: online.started, by: online.by } : null,
    since: !!(online?.sha && range.length === 1),
    commits,
    // 能回滚到的：之前发成功、版本和线上不一样的（最多 10 个）
    rollbacks: ok.filter((r) => r.version !== online?.version).slice(0, 10).map((r) => ({ id: r.id, version: r.version, at: r.started, by: r.by, note: r.note ?? '', kept: !!r.kept })),
  }
})
route('POST', '/api/workspaces/:id/deploys/:did/run', (c) => {
  const w = get<Workspace>('workspaces', c.params.id)
  const d = w?.deploys?.find((x) => x.id === c.params.did)
  if (!w || !d) throw new HttpError(404, '没有这个发布环境')
  if (deployProtected(d, (id) => get<Server>('servers', id))) needVerify(c) // 发到生产（标成生产的环境、受保护的服务器）：验证本人
  try { return releases.start(w, d.id, { by: '主人', note: c.body?.note ? String(c.body.note) : undefined }) } catch (e) { throw bad((e as Error).message) }
})

// ---------- 发布记录 ----------
route('GET', '/api/releases', (c) => releases.list({ ws: c.url.searchParams.get('ws') ?? undefined, limit: Number(c.url.searchParams.get('limit')) || 100 }))
route('GET', '/api/releases/:id', (c) => { const r = get<Release>('releases', c.params.id); if (!r) throw new HttpError(404, '没有这次发布'); return r })
route('POST', '/api/releases/:id/rollback', (c) => {
  const r = get<Release>('releases', c.params.id)
  const w = r && get<Workspace>('workspaces', r.ws)
  const d = w?.deploys?.find((x) => x.id === r!.target)
  if (!r || !w || !d) throw new HttpError(404, '这次发布或它的目标不在了')
  if (r.status !== 'success') throw bad('只能回滚到发成功的版本')
  if (deployProtected(d, (id) => get<Server>('servers', id))) needVerify(c) // 发到生产（标成生产的环境、受保护的服务器）：验证本人
  try { return releases.start(w, d.id, { by: '主人', rollbackOf: r, note: `回滚到 ${r.version}` }) } catch (e) { throw bad((e as Error).message) }
})
// 发布产物在服务器之间搬（Agent 调）
route('POST', '/api/agent/blob/:key', (c) => {
  const f = releases.blobAllowed(c.params.key, c.agent!.serverId, 'push')
  if (!f) throw new HttpError(403, '这个文件不是给你传的')
  fs.writeFileSync(f, c.raw ?? Buffer.alloc(0), { mode: 0o600 })
  return { ok: true, size: c.raw?.length ?? 0 }
}, { auth: 'agent', raw: true })
route('GET', '/api/agent/blob/:key', (c) => {
  const f = releases.blobAllowed(c.params.key, c.agent!.serverId, 'pull')
  if (!f || !fs.existsSync(f)) throw new HttpError(404, '没有这个文件')
  const st = fs.statSync(f)
  c.res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': st.size })
  fs.createReadStream(f).pipe(c.res)
}, { auth: 'agent' })
route('DELETE', '/api/workspaces/:id', (c) => {
  const w = get<Workspace>('workspaces', c.params.id)
  del1('workspaces', c.params.id) // 目录留着（里面可能有没推的改动），要删去服务器上删
  // 这个项目的员工：一起删（withEmployees）或者留着变成普通员工
  for (const e of all<Employee>('employees').filter((x) => x.workspace === c.params.id)) {
    if (c.url.searchParams.get('withEmployees') === '1') { runner.stop(e.id); deleteEmployee(e) } else put1('employees', { ...e, workspace: '' })
  }
  // 发布记录、安装包一起删（项目页删除框里写了会去掉这些；留着也看不到、占地方）
  for (const r of all<Release>('releases').filter((x) => x.ws === c.params.id)) del1('releases', r.id)
  for (const x of all<packages.AppPackage>('packages').filter((y) => y.ws === c.params.id)) { try { packages.remove(x.id, '主人（删项目）') } catch { /* 已经没了 */ } }
  if (w) audit({ via: '—', action: 'workspace.delete', target: w.name, level: '危险', result: '成功', how: '本人（输入项目名确认）' })
  return { ok: true }
})
// 切分支：所有员工一起换（有员工在干活就等它做完）
route('POST', '/api/workspaces/:id/branch', async (c) => {
  const w = get<Workspace>('workspaces', c.params.id)
  if (!w) throw new HttpError(404, '没有')
  const busy = all<Employee>('employees').filter((e) => e.workspace === w.id && runner.isWorking(e.id))
  if (busy.length) throw bad(`${busy.map((e) => e.name).join('、')} 正在干活，等它做完再切`)
  try { return await switchAndTell(w, String(c.body?.branch ?? '').trim(), '主人') } catch (e) { throw bad((e as Error).message) }
})

// ---------- 问题清单 ----------
route('POST', '/api/issues/:id/action', (c) => {
  try { return issues.act(c.params.id, String(c.body?.action ?? ''), { by: '主人', fixer: c.body?.fixer ? String(c.body.fixer) : undefined, note: c.body?.note ? String(c.body.note) : undefined }) } catch (e) { throw bad((e as Error).message) }
})
route('DELETE', '/api/issues/:id', (c) => { del1('issues', c.params.id); return { ok: true } })

// ---------- 域名（DNS） ----------
route('POST', '/api/domains', (c) => {
  const b = c.body ?? {}
  const domain = String(b.domain ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) throw bad('域名不对，比如 example.com')
  if (all<dns.Domain>('domains').some((d) => d.domain === domain)) throw bad('已经登记过了')
  const provider = b.provider === 'aliyun' ? 'aliyun' : 'cloudflare'
  if (!get<Credential>('credentials', String(b.cred ?? ''))) throw bad('选一个凭证（Cloudflare 填 API 令牌；阿里云用户名填 AccessKeyId、值填 AccessKeySecret）')
  const d: dns.Domain = { id: uid('dm'), domain, provider, cred: String(b.cred) }
  audit({ via: '—', action: 'domain.add', target: domain, level: '写', result: '成功', how: '本人' })
  return put1('domains', d)
})
route('DELETE', '/api/domains/:id', (c) => { del1('domains', c.params.id); return { ok: true } })
const domOf = (id: string) => { const d = get<dns.Domain>('domains', id); if (!d) throw new HttpError(404, '没有这个域名'); return d }
route('GET', '/api/domains/:id/records', async (c) => { try { return await dns.list(domOf(c.params.id)) } catch (e) { throw bad((e as Error).message) } })
route('POST', '/api/domains/:id/records', async (c) => {
  const d = domOf(c.params.id)
  const b = c.body ?? {}
  try {
    const x = await dns.set(d, { rr: String(b.rr ?? '').trim(), type: String(b.type ?? '').toUpperCase(), value: String(b.value ?? '').trim(), ttl: b.ttl ? Number(b.ttl) : undefined, priority: b.priority ? Number(b.priority) : undefined })
    audit({ via: '—', action: 'dns.set', target: `${b.rr}.${d.domain} ${b.type} ${b.value}`, level: '危险', result: '成功', how: '本人' })
    return x
  } catch (e) { throw bad((e as Error).message) }
})
route('DELETE', '/api/domains/:id/records/:rid', async (c) => {
  needVerify(c)
  const d = domOf(c.params.id)
  try { const old = await dns.remove(d, c.params.rid); audit({ via: '—', action: 'dns.delete', target: `${old?.rr}.${d.domain} ${old?.type} ${old?.value}`, level: '危险', result: '成功', how: '本人（已验证）' }); return { ok: true } } catch (e) { throw bad((e as Error).message) }
})

// ---------- 消息渠道（收）：邮箱、Slack ----------
route('POST', '/api/channels', async (c) => {
  const b = c.body ?? {}
  const kind = b.kind === 'slack' ? 'slack' : 'email'
  const name = String(b.name ?? '').trim().slice(0, 40) || (kind === 'slack' ? 'Slack' : String(b.user ?? '邮箱'))
  // 直接贴的密码 / 令牌：存成一个「消息渠道」凭证
  if (!b.cred && b.secret) b.cred = inlineCred(`${kind === 'slack' ? 'Slack 用户令牌' : '邮箱授权码'} · ${name}`, '消息渠道', kind === 'slack' ? 'Slack 用户令牌' : '邮箱（IMAP / SMTP）', '生产', String(b.user ?? ''), String(b.secret), '')
  const cred = get<Credential>('credentials', String(b.cred ?? ''))
  if (!cred) throw bad(kind === 'slack' ? '贴上 Slack 用户令牌（xoxp- 开头）' : '贴上邮箱的授权码 / 应用专用密码')
  const ch: inbox.Channel = { id: inbox.newChannelId(), kind, name, cred: cred.id, enabled: true }
  if (kind === 'email') {
    ch.imapHost = String(b.imapHost ?? '').trim()
    ch.imapPort = Number(b.imapPort) || 993
    ch.user = String(b.user ?? cred.user ?? '').trim()
    if (!ch.imapHost || !ch.user) throw bad('邮箱要填 IMAP 服务器和账号')
  } else {
    try { const r = await inbox.slackCheck(getSecret(cred.id) ?? ''); ch.team = r.team; ch.me = r.me } catch (e) { throw bad((e as Error).message) }
  }
  audit({ via: '—', action: 'channel.add', target: `${kind} · ${name}`, level: '写', result: '成功', how: '本人' })
  return inbox.pubCh(put1('channels', ch))
})
route('PUT', '/api/channels/:id', (c) => {
  const ch = get<inbox.Channel>('channels', c.params.id)
  if (!ch) throw new HttpError(404, '没有这个渠道')
  const next = { ...ch, ...(typeof c.body?.enabled === 'boolean' ? { enabled: c.body.enabled } : {}), ...(c.body?.name ? { name: String(c.body.name).slice(0, 40) } : {}) }
  put('channels', next)
  emit({ t: 'put', coll: 'channels', item: inbox.pubCh(next) })
  return inbox.pubCh(next)
})
route('DELETE', '/api/channels/:id', (c) => { del1('channels', c.params.id); db.prepare('DELETE FROM inbox WHERE ch = ?').run(c.params.id); return { ok: true } })

// ---------- 收件箱 ----------
route('GET', '/api/inbox', (c) => inbox.list({ cat: c.url.searchParams.get('cat') ?? undefined, before: Number(c.url.searchParams.get('before')) || undefined }))
route('PUT', '/api/inbox/:id', (c) => { try { return inbox.mark(c.params.id, { cat: c.body?.cat, done: c.body?.done }) } catch (e) { throw bad((e as Error).message) } })
route('GET', '/api/inbox/:id/body', async (c) => {
  const i = inbox.getItem(c.params.id)
  if (!i) throw new HttpError(404, '没有这条')
  if (i.kind !== 'email') return { text: i.snippet }
  try { return { text: await inbox.emailBody(i) } } catch (e) { throw bad((e as Error).message) }
})
route('POST', '/api/inbox/:id/draft', async (c) => { try { return await inbox.draft(c.params.id, String(c.body?.hint ?? '')) } catch (e) { throw bad((e as Error).message) } })

// ---------- 提醒发到哪（外部渠道） ----------
const KINDS = ['email', 'telegram', 'slack', 'wecom', 'dingtalk', 'feishu', 'webhook']
route('POST', '/api/notifiers', async (c) => {
  const b = c.body ?? {}
  if (!KINDS.includes(b.kind)) throw bad('不认识的渠道')
  const LABEL: Record<string, string> = { telegram: 'Telegram 机器人', slack: 'Slack Webhook', wecom: '企业微信群机器人', dingtalk: '钉钉群机器人', feishu: '飞书群机器人', email: '邮箱（IMAP / SMTP）', webhook: 'Webhook' }
  // 直接贴的令牌 / 地址：存成一个「消息渠道」凭证（加签密钥放用户名）
  if (!b.cred && b.secret) b.cred = inlineCred(`${LABEL[b.kind]} · ${String(b.name ?? '').trim() || '提醒'}`, '消息渠道', LABEL[b.kind], '生产', String(b.secretUser || b.smtpUser || ''), String(b.secret).trim(), '')
  const nc = get<Credential>('credentials', String(b.cred ?? ''))
  if (!nc) throw bad('贴上机器人令牌 / Webhook 地址 / 邮箱授权码')
  // Telegram：没填 chat_id 就去机器人最近收到的消息里找（先给机器人发一句话）
  if (b.kind === 'telegram' && !b.chatId) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${getSecret(nc.id) ?? ''}/getUpdates`, { signal: AbortSignal.timeout(10_000) }).then((x) => x.json()) as any
      const last = (r?.result ?? []).map((u: any) => u.message ?? u.channel_post ?? u.my_chat_member).filter(Boolean).pop()
      if (last?.chat?.id) b.chatId = String(last.chat.id)
    } catch { /* 连不上 Telegram：下面报要填 */ }
  }
  const events = (Array.isArray(b.events) ? b.events : ['decide', 'error']).filter((x: string) => ['decide', 'error', 'all'].includes(x))
  const n: notify.Notifier = {
    id: uid('nt'), kind: b.kind, name: String(b.name ?? b.kind).slice(0, 40), events: events.length ? events : ['decide', 'error'], enabled: true, cred: String(b.cred),
    chatId: b.chatId ? String(b.chatId) : undefined, smtpHost: b.smtpHost ? String(b.smtpHost) : undefined, smtpPort: Number(b.smtpPort) || undefined, smtpUser: b.smtpUser ? String(b.smtpUser) : undefined, to: b.to ? String(b.to) : undefined,
  }
  if (n.kind === 'telegram' && !n.chatId) throw bad('没找到 chat_id：先在 Telegram 里给你的机器人发一句话（群里用就把机器人拉进群、在群里发一句），再点「加上」')
  if (n.kind === 'email' && (!n.smtpHost || !n.to)) throw bad('邮件要填 SMTP 服务器和收件人')
  audit({ via: '—', action: 'notifier.add', target: `${n.kind} · ${n.name}`, level: '写', result: '成功', how: '本人' })
  put('notifiers', n)
  emit({ t: 'put', coll: 'notifiers', item: notify.pub(n) })
  return notify.pub(n)
})
route('PUT', '/api/notifiers/:id', (c) => {
  const n = get<notify.Notifier>('notifiers', c.params.id)
  if (!n) throw new HttpError(404, '没有这个渠道')
  const b = c.body ?? {}
  const next = { ...n, ...(typeof b.enabled === 'boolean' ? { enabled: b.enabled } : {}), ...(Array.isArray(b.events) ? { events: b.events.filter((x: string) => ['decide', 'error', 'all'].includes(x)) } : {}) }
  put('notifiers', next)
  emit({ t: 'put', coll: 'notifiers', item: notify.pub(next) })
  return notify.pub(next)
})
route('DELETE', '/api/notifiers/:id', (c) => { del1('notifiers', c.params.id); return { ok: true } })
route('POST', '/api/notifiers/:id/test', async (c) => { try { await notify.test(c.params.id); return { ok: true } } catch (e) { throw bad((e as Error).message) } })

// ---------- 用量明细 ----------
route('GET', '/api/usage/detail', () => usageDetail())

// ---------- 手机外壳 ----------
const pairCodes = new Map<string, number>()
route('POST', '/api/app/pair-code', () => {
  const code = String(crypto.randomInt(100000, 1000000))
  pairCodes.set(code, Date.now() + 10 * 60_000)
  return { code, expiresIn: 600 }
})
route('POST', '/api/app/pair', (c) => {
  const b = c.body ?? {}
  const code = String(b.code ?? '').trim()
  const exp = pairCodes.get(code)
  if (!exp || exp < Date.now()) { auth.noteFail(c.ip); throw bad('配对码不对或者过期了', 'PAIR') }
  if (auth.tooManyFails(c.ip)) throw new HttpError(429, '试太多次了')
  pairCodes.delete(code)
  return { deviceToken: addDevice(b, '配对码').token }
}, { auth: 'none' })
/** 登记一台设备（App / 桌面端），返回设备令牌和设备 id。同一个 deviceId 再登记就换一个令牌 */
function addDevice(b: any, how: string): { token: string; id: string } {
  const token = crypto.randomBytes(32).toString('base64url')
  const id = String(b.deviceId || uid('d')).slice(0, 64)
  // android / ios / ipados / macos / windows；Electron 过渡版是 desktop-<系统>
  const platform = String(b.platform ?? '').toLowerCase().replace(/[^\w-]/g, '').slice(0, 30) || 'android'
  put1('devices', { id, name: String(b.name || platform).slice(0, 60), platform, appVersion: String(b.appVersion ?? ''), tokenHash: auth.sha(token), enabled: true, paired: Date.now() } satisfies Device)
  audit({ via: '—', action: 'app.pair', target: `${String(b.name || platform)}（${platform}）`, level: '危险', result: '成功', how })
  return { token, id }
}
/** 设备登录成功：登记设备 + 直接给一个 App 会话令牌（省一次 /api/app/session） */
function appLoggedIn(b: any, how: string, verified: boolean) {
  const d = addDevice(b, how)
  const token = auth.newSession(d.id, 'app')
  if (verified) auth.markVerified(token)
  return { deviceToken: d.token, token, deviceId: d.id }
}
/** 原生 App / 桌面端自己登录（不用先在网页上点配对码）：账号 + 密码，开了两步验证再输码。每台设备各登各的，几个端可以同时登着 */
route('POST', '/api/app/login', (c) => {
  if (auth.tooManyFails(c.ip)) throw new HttpError(429, '试太多次了，一分钟后再试')
  const o = auth.owner()
  const b = c.body ?? {}
  if (!o) throw bad('这套 Opero 还没设置主人：先在网页上打开它完成设置', 'SETUP')
  if (String(b.email ?? '').trim().toLowerCase() !== o.email.toLowerCase() || !auth.checkPassword(String(b.password ?? ''))) {
    auth.noteFail(c.ip)
    audit({ via: '—', action: 'login', target: c.ip, level: '读', result: '拒绝', how: 'App：账号或密码不对' })
    throw new HttpError(401, '账号或密码不对', 'LOGIN')
  }
  if (mfa.mfa().enabled) return { mfa: true, ticket: mfa.newTicket() }
  audit({ via: '—', action: 'login', target: c.ip, level: '读', result: '成功', how: `App（${String(b.platform ?? '')}）：密码` })
  return appLoggedIn(b, '账号密码', false)
}, { auth: 'none' })
route('POST', '/api/app/login/mfa', (c) => {
  if (auth.tooManyFails(c.ip)) throw new HttpError(429, '试太多次了，一分钟后再试')
  const b = c.body ?? {}
  const how = mfa.verifyCode(String(b.code ?? ''))
  let passed: boolean
  try { passed = mfa.useTicket(String(b.ticket ?? ''), !!how) } catch (e) { throw new HttpError(401, (e as Error).message, 'LOGIN') }
  if (!passed) { auth.noteFail(c.ip); throw new HttpError(401, '码不对', 'MFA') }
  audit({ via: '—', action: 'login', target: c.ip, level: '读', result: '成功', how: `App（${String(b.platform ?? '')}）：${how === 'recovery' ? '密码 + 恢复码' : '密码 + 两步验证'}` })
  if (how === 'recovery') push({ kind: 'info', title: '用了一个恢复码登录', body: `还剩 ${mfa.mfa().recovery.length} 个，不是你的话马上改密码` })
  return appLoggedIn(b, '账号密码 + 两步验证', true)
}, { auth: 'none' })
/** App 打开网页的票（一分钟有效）：route 是网页的一段（employee;id=e1）；embed = 只显示这一页（原生 App 里嵌的页面），见 docs/api/README.md「嵌网页」 */
route('POST', '/api/app/ticket', (c) => {
  const t = crypto.randomBytes(24).toString('base64url')
  tickets.set(t, { device: c.device!.id, exp: Date.now() + 60_000, route: String(c.body?.route ?? ''), embed: c.body?.embed === true })
  return { url: `/api/app/enter?t=${t}` }
}, { auth: 'device' })
const tickets = new Map<string, { device: string; exp: number; route: string; embed?: boolean }>()
/** 原生 App：用设备令牌换一个主人会话令牌，之后调主人的接口带 Authorization: Bearer <token>（这台设备以前换的 App 会话作废；App 里嵌的网页会话不受影响）。
 *  过期（很久没用）或被断开后再换一次；指纹验过本人用 POST /api/app/verified */
route('POST', '/api/app/session', (c) => {
  auth.endDeviceSessions(c.device!.id, 'app')
  const d = get<Device>('devices', c.device!.id)
  if (d) put('devices', { ...d, seen: Date.now() })
  return { token: auth.newSession(c.device!.id, 'app') }
}, { auth: 'device' })
/** 网页首页的路径（装在子路径下时带前缀） */
function home(c: Ctx) {
  let b = ''
  try { b = new URL(cfg.publicUrl).pathname } catch { /* 没配 */ }
  if (!b || b === '/') b = String(c.req.headers['x-forwarded-prefix'] ?? '')
  return `${b.replace(/[^\w./-]/g, '').replace(/\/+$/, '')}/`.replace(/^(?!\/)/, '/')
}
route('GET', '/api/app/enter', (c) => {
  const t = tickets.get(String(c.url.searchParams.get('t') ?? ''))
  tickets.delete(String(c.url.searchParams.get('t') ?? ''))
  if (!t || t.exp < Date.now()) { c.res.writeHead(302, { Location: home(c) }); c.res.end(); return }
  auth.endDeviceSessions(t.device, 'web')
  setCookie(c, auth.newSession(t.device, 'web'))
  const q = new URLSearchParams({ ...(t.route ? { route: t.route } : {}), ...(t.embed ? { embed: '1' } : {}) }).toString()
  c.res.writeHead(302, { Location: home(c) + (q ? `?${q}` : '') })
  c.res.end()
}, { auth: 'none' })
route('POST', '/api/app/devices', (c) => {
  const d = get<Device>('devices', c.device!.id)!
  const b = c.body ?? {}
  put('devices', { ...d, appVersion: String(b.appVersion ?? d.appVersion ?? ''), enabled: b.enabled !== false, seen: Date.now() })
  return { ok: true }
}, { auth: 'device' })
route('DELETE', '/api/app/devices/:id', (c) => {
  if (c.params.id === c.device!.id) { auth.endDeviceSessions(c.device!.id); del('devices', c.device!.id) }
  return { ok: true }
}, { auth: 'device' })
route('GET', '/api/app/push', async (c) => {
  const d = get<Device>('devices', c.device!.id)
  if (!d || String(c.url.searchParams.get('device') ?? d.id) !== d.id) throw new HttpError(404, '没有这台手机', 'DEVICE_NOT_FOUND')
  return waitPush(Number(c.url.searchParams.get('after') ?? -1), Number(c.url.searchParams.get('wait') ?? 0))
}, { auth: 'device' })
route('POST', '/api/app/verified', (c) => { auth.markDeviceVerified(c.device!.id); return { ok: true } }, { auth: 'device' })
route('GET', '/api/app/update', () => ({ versionCode: 0 }), { auth: 'device' })
route('POST', '/api/app/alarms/:id/ack', () => ({ ok: true }), { auth: 'device' })
route('GET', '/api/app/list', () => all<Device>('devices').map(({ tokenHash: _t, ...d }) => d))
route('DELETE', '/api/app/list/:id', (c) => {
  auth.endDeviceSessions(c.params.id)
  del('devices', c.params.id)
  audit({ via: '—', action: 'app.unpair', target: c.params.id, level: '写', result: '成功', how: '本人' })
  return { ok: true }
})

// ---------- Agent：别的服务器接进来 ----------
// 装 Agent 用的东西都从这套 Opero 自己拿：要接入的机器本来就要连得上它；GitHub 在有些地方（国内云）连不上。版本也和后台一致
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')
route('GET', '/api/install.sh', (c) => {
  c.res.writeHead(200, { 'Content-Type': 'text/x-shellscript; charset=utf-8', 'Cache-Control': 'no-store' })
  fs.createReadStream(path.join(REPO_ROOT, 'code/server/scripts/install.sh')).pipe(c.res)
}, { auth: 'none' })
// Agent 的程序（code/server 里的源码 + LICENSE，开源代码、不含数据和密钥）
route('GET', '/api/agent/code.tgz', (c) => {
  c.res.writeHead(200, { 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store' })
  const p = spawn('tar', ['-C', REPO_ROOT, '--exclude=node_modules', '--exclude=.opero-data', '-czf', '-', 'code/server', 'LICENSE'], { stdio: ['ignore', 'pipe', 'ignore'] })
  p.stdout.pipe(c.res)
  p.on('error', () => c.res.end())
}, { auth: 'none' })
route('POST', '/api/agents/join', (c) => {
  const b = c.body ?? {}
  const env = envOf(b.env, '测试')
  const token = agents.newJoinToken(env, String(b.name ?? '').trim() || undefined)
  const url = baseUrl(c.req, cfg.publicUrl)
  const cmd = `curl -fsSL ${url.replace(/\/+$/, '')}/api/install.sh | sudo bash -s -- --agent ${url} ${token}`
  audit({ via: '—', action: 'agent.token', target: `${b.name || '新服务器'}（${env}）`, level: '写', result: '成功', how: '生成 30 分钟有效的接入命令' })
  return { token, url, cmd, cmdCn: cmd + ' --cn', expiresIn: 1800, since: Date.now() }
})
route('DELETE', '/api/agents/:id', (c) => {
  const sv = get<Server>('servers', c.params.id)
  agents.remove(c.params.id)
  audit({ via: '—', action: 'agent.remove', target: sv?.name ?? c.params.id, level: '危险', result: '成功', how: '本人' })
  return { ok: true }
})
// Agent 自己调的
route('POST', '/api/agent/register', (c) => {
  // 带了公钥就要用它签名（证明私钥在那台上）
  const b = c.body ?? {}
  const signedOk = !!b.pub && keys.verify(String(b.pub), keys.agentPayload('POST', c.req.url ?? '', String(c.req.headers['x-opero-ts'] ?? ''), c.raw ?? Buffer.alloc(0)), String(c.req.headers['x-opero-sig'] ?? ''))
  if (b.pub && !signedOk) throw new HttpError(403, '签名不对', 'SIG')
  try { return agents.register(b, c.ip, signedOk) } catch (e) { throw new HttpError(403, (e as Error).message, 'JOIN') }
}, { auth: 'none' })
// 待接入的机器：核对指纹后接受 / 拒绝
route('POST', '/api/agents/:id/accept', (c) => { try { return agents.pub(agents.decide(c.params.id, true)) } catch (e) { throw bad((e as Error).message) } })
route('POST', '/api/agents/:id/reject', (c) => { try { return agents.pub(agents.decide(c.params.id, false)) } catch (e) { throw bad((e as Error).message) } })
// Opero 换地址（迁移）：让所有在线的 Agent 改连新地址（Opero 的指纹不变，Agent 就无痕接上）
// ---------- 网络出口（egress.ts）：Opero 自己往外连的地址按域名经哪台 Agent 出去 ----------
const egressView = () => ({ rules: egress.rules(), failures: egress.failures(), min: tunnel.ANY_MIN })
route('GET', '/api/egress', () => egressView())
/** 加 / 改一条（同一个域名就是改）：先测，测通了才存；force = 不通也存 */
route('POST', '/api/egress', async (c) => {
  const t = egress.parseTarget(String(c.body?.host ?? ''))
  if (typeof t === 'string') throw bad(t)
  const via = String(c.body?.via ?? '')
  if (!via) throw bad('选经哪台出去')
  const lan = c.body?.lan === true
  if (lan) needVerify(c) // 许连内网：放宽安全，要本人
  const bad1 = egress.viaProblem(via)
  if (bad1) throw bad(bad1)
  const port = Number(c.body?.port) || t.port || 443
  const r = via === 'direct' ? undefined : await egress.test(t.host, port, via, lan)
  if (r?.via && !r.via.ok && c.body?.force !== true) return { saved: false, test: r }
  const rule = egress.upsert({ host: t.host, via, lan, note: String(c.body?.note ?? ''), by: c.ip === 'mcp' ? String(c.body?.by ?? '员工') : '主人' }, r?.via ? { ...r.via, at: Date.now(), port } : undefined)
  audit({ via: c.ip === 'mcp' ? String(c.body?.by ?? '员工') : '—', action: 'egress.set', target: `${rule.host} → ${via === 'direct' ? '直连' : get<Server>('servers', via)?.name ?? via}${lan ? '（允许内网）' : ''}`, level: lan ? '危险' : '写', result: '成功', how: c.ip === 'mcp' ? 'MCP' : '本人' })
  return { saved: true, rule, test: r, ...egressView() }
})
route('PUT', '/api/egress/:id', (c) => {
  const old = egress.rules().find((x) => x.id === c.params.id)
  if (!old) throw new HttpError(404, '没有这条规则')
  const p: Parameters<typeof egress.patch>[1] = {}
  if (c.body?.host !== undefined) { const t = egress.parseTarget(String(c.body.host)); if (typeof t === 'string') throw bad(t); if (egress.rules().some((x) => x.host === t.host && x.id !== old.id)) throw bad(`${t.host} 已经有一条了`); p.host = t.host }
  if (c.body?.via !== undefined) { const bad1 = egress.viaProblem(String(c.body.via)); if (bad1) throw bad(bad1); p.via = String(c.body.via) }
  if (c.body?.lan !== undefined) { if (c.body.lan === true && !old.lan) needVerify(c); p.lan = c.body.lan === true }
  if (c.body?.note !== undefined) p.note = String(c.body.note).trim().slice(0, 60) || undefined
  const r = egress.patch(old.id, p)
  audit({ via: c.ip === 'mcp' ? String(c.body?.by ?? '员工') : '—', action: 'egress.set', target: `${r!.host} → ${r!.via === 'direct' ? '直连' : get<Server>('servers', r!.via)?.name ?? r!.via}${r!.lan ? '（允许内网）' : ''}`, level: p.lan ? '危险' : '写', result: '成功', how: c.ip === 'mcp' ? 'MCP' : '本人' })
  return { rule: r, ...egressView() }
})
route('DELETE', '/api/egress/:id', (c) => {
  const old = egress.rules().find((x) => x.id === c.params.id)
  if (old) {
    egress.remove(old.id)
    audit({ via: c.ip === 'mcp' ? String(c.body?.by ?? '员工') : '—', action: 'egress.delete', target: old.host, level: '写', result: '成功', how: c.ip === 'mcp' ? 'MCP' : '本人' })
  }
  return egressView()
})
/** 测一下：直连和经出口各连一次 TCP（不发内容）。id 给了就把结果记到那条规则上 */
route('POST', '/api/egress/test', async (c) => {
  const t = egress.parseTarget(String(c.body?.host ?? ''))
  if (typeof t === 'string') throw bad(t)
  const port = Number(c.body?.port) || t.port || 443
  const rule = c.body?.id ? egress.rules().find((x) => x.id === c.body.id) : undefined
  const via = String(c.body?.via ?? rule?.via ?? '') || undefined
  const r = await egress.test(t.host, port, via, c.body?.lan === true || rule?.lan)
  if (rule && r.via) egress.patch(rule.id, { test: { ...r.via, at: Date.now(), port } })
  return { host: t.host, port, ...r }
})
route('DELETE', '/api/egress/failures/:host', (c) => { egress.ignoreFail(decodeURIComponent(c.params.host)); return egressView() })

route('POST', '/api/agents/move', (c) => {
  needVerify(c)
  const url = String(c.body?.url ?? '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\/[^\s/]+/.test(url)) throw bad('新地址要以 https:// 开头')
  const list = all<Server>('servers').filter((s) => agents.agentOnline(s))
  for (const s of list) agents.sendTask(s.id, { t: 'move', id: uid('mv'), url })
  audit({ via: '—', action: 'agent.move', target: `${list.length} 台 → ${url}`, level: '危险', result: '成功', how: '本人（已验证）' })
  return { sent: list.length, fingerprint: keys.SERVER_FP }
})
// 一键升级 Agent：让那台在 systemd 里另起一个单元跑 opero update（不在 Agent 自己的进程里，升级时 Agent 重启也不会把它带走）
route('POST', '/api/agents/:id/upgrade', async (c) => {
  const sv = get<Server>('servers', c.params.id)
  if (!sv || !agents.agentOnline(sv)) throw bad('这台的 Agent 不在线')
  const r = await agents.exec(sv.id, 'systemd-run --unit=opero-agent-upgrade --collect --quiet /usr/local/bin/opero update && echo STARTED', { timeoutMs: 30_000 })
  audit({ via: '—', action: 'agent.upgrade', target: `${sv.name}：${sv.agentVersion ?? '?'} → ${cfg.version}`, level: '写', result: r.out.includes('STARTED') ? '成功' : '失败', how: '本人' })
  if (!r.out.includes('STARTED')) throw bad(`没能开始升级：${r.out.slice(-300)}`)
  return { ok: true, from: sv.agentVersion, to: cfg.version }
})
route('GET', '/api/agents/fingerprint', () => ({ fingerprint: keys.SERVER_FP }))
route('GET', '/api/agent/poll', async (c) => {
  const sv = get<Server>('servers', c.agent!.serverId)
  if (sv) { sv.lastSeen = Date.now(); put('servers', sv); if (!sv.online) agents.health(sv, sv) }
  return agents.signedTasks(await agents.poll(c.agent!.serverId))
}, { auth: 'agent' })
route('POST', '/api/agent/events', (c) => { agents.events(c.agent!.serverId, c.body?.events ?? []); return { ok: true } }, { auth: 'agent' })
route('POST', '/api/agent/health', (c) => {
  const sv = get<Server>('servers', c.agent!.serverId)
  if (sv) agents.health(sv, c.body ?? {}, c.ip)
  return { ok: true }
}, { auth: 'agent' })

// ---------- MCP（只认本机 + 这一轮的令牌） ----------
const jobs = new Map<string, { p: Promise<ToolResult>; res?: ToolResult }>()
async function settle(id: string) {
  const j = jobs.get(id)
  if (!j) throw new HttpError(404, '没有这个调用')
  if (!j.res) {
    const r = await Promise.race([j.p, new Promise<null>((res) => setTimeout(() => res(null), 20_000))])
    if (!r) return { done: false, job: id }
  }
  jobs.delete(id)
  return { done: true, ...j.res! }
}
route('GET', '/api/mcp/tools', (c) => {
  const e = get<Employee>('employees', c.run!.emp)
  return { tools: TOOLS.filter((t) => t.name !== 'approve' || runner.kindOf(e?.executor) === 'claude') }
}, { auth: 'mcp' })
route('POST', '/api/mcp/call', (c) => {
  const id = uid('j')
  const j: { p: Promise<ToolResult>; res?: ToolResult } = {
    p: callTool(c.run!, String(c.body?.name ?? ''), c.body?.args).catch((e) => ({ text: `出错了：${(e as Error).message}`, isError: true })),
  }
  j.p.then((r) => { j.res = r })
  jobs.set(id, j)
  return settle(id)
}, { auth: 'mcp' })
route('GET', '/api/mcp/wait/:job', (c) => settle(c.params.job), { auth: 'mcp' })

// 启动时：上次没点完的等待卡片都已经没人在等了
export function expireStaleCards() {
  const rows = db.prepare(`SELECT id, data FROM messages WHERE data LIKE '%"pending":true%' AND data LIKE '%"state":"open"%'`).all() as { id: string; data: string }[]
  for (const r of rows) {
    const m = JSON.parse(r.data) as Message
    // Opero 重启过：员工那边的等待没了，卡片照旧留着（标 late），主人点了再告诉员工
    if (m.card) db.prepare('UPDATE messages SET data = ? WHERE id = ?').run(JSON.stringify({ ...m, card: { ...m.card, data: { ...m.card.data, pending: false, late: true } } }), r.id)
  }
  for (const s of all<Session>('sessions')) if (s.working || s.waiting) { const { working: _w, waiting: _x, ...rest } = s; put('sessions', rest) }
  // 还没处理、也不会失效的（要凭证、线上问题）：红点照旧挂着
  for (const s of all<Session>('sessions')) syncWaiting(s.id)
}

/** Opero 重启（升级、给自己发版、服务器重启）时正在干活的员工：进程跟着没了，那一轮停在一半。
 *  启动时把还在转的「在想…」气泡去掉、写一句发生了什么，返回被打断的会话（启动好了让员工接着做） */
export function interruptedRuns(): { sid: string; emp: string }[] {
  const rows = db.prepare(`SELECT id, sid, data FROM messages WHERE data LIKE '%"kind":"status"%' AND data LIKE '%"spinning":true%'`).all() as { id: string; sid: string; data: string }[]
  const out: { sid: string; emp: string }[] = []
  for (const r of rows) {
    db.prepare('DELETE FROM messages WHERE id = ?').run(r.id)
    const s = get<Session>('sessions', r.sid)
    if (!s || out.some((x) => x.sid === s.id)) continue
    out.push({ sid: s.id, emp: s.employee })
    addMsg(s.id, { from: 'system', kind: 'system', text: 'Opero 重启了（升级 / 发版 / 服务器重启），这一轮做到一半被打断，已经让员工接着做' })
  }
  return out
}


/** 以前没有「员工能用哪些凭证」（谁都能用全部允许 AI 的凭证）：第一次启动按原样写下来，之后在员工资料里收放 */
/** 聊天底部不再放「知识库」：知识库就是员工的 docs，要加东西直接发给员工 */
export function migrateMenus() {
  for (const e of all<Employee>('employees')) if (e.menus?.includes('知识库')) put('employees', { ...e, menus: e.menus.filter((m) => m !== '知识库') })
}
/** 以前员工的名字兼职位（「opero开源-android」「运维」）：一次性把名字挪到职位标签，名字换成随机的人名（按性别、不重名）；
 *  没传图的字头像跟着换成新名字的第一个字。只做一次（kv rolesMigrated）。员工互相找人时职位也认，旧名字照样能用 */
/** 清掉 0.31.1 以前算错的花费（主人 2026-11-28 定的）：以前把执行器的累计花费又加了一遍，记的数偏大很多。
 *  只跑一次：每轮的花费、会话的累计花费、预算提醒记录清零；轮数、成功率、token 是对的，不动。之后按新算法从头记 */
export function migrateCostReset() {
  if (kvGet<number>('costReset', 0)) return
  const n = (db.prepare('SELECT COUNT(*) AS n FROM runs WHERE cost > 0').get() as { n: number }).n
  db.prepare('UPDATE runs SET cost = 0').run()
  for (const s of all<Session>('sessions')) if (s.cost) { const { cost: _c, ...rest } = s; put('sessions', rest as Session) }
  kvSet('budgetWarned', {})
  kvSet('costReset', Date.now())
  if (n) audit({ via: '—', action: 'usage.reset', target: `清掉 ${n} 轮按旧算法记的花费（偏大），之后按新算法记`, level: '写', result: '成功', how: '主人定的（升级时自动跑一次）' })
}
export function migrateRoles() {
  if (kvGet('rolesMigrated', false)) return
  const emps = all<Employee>('employees')
  const taken: string[] = []
  for (const e of emps) {
    if (e.role) { taken.push(e.name); continue }
    const name = randomName(e.gender, [...taken, ...emps.map((x) => x.name)])
    taken.push(name)
    const letterAvatar = !e.avatarImg && (!e.avatar || e.avatar === Array.from(e.name)[0])
    put('employees', { ...e, role: e.name.slice(0, 20), name, ...(letterAvatar ? { avatar: Array.from(name)[0] } : {}) })
  }
  kvSet('rolesMigrated', true)
}
/** 以前一个项目只有一份编译设置（buildCfg）：变成编号 main 的编译组件，流水线记录照留 */
export function migrateBuilds() {
  const NAME: Record<string, string> = { node: 'Node', go: 'Go', android: '安卓', spring: 'Java', custom: '主程序' }
  for (const w of all<Workspace & { buildCfg?: build.BuildCfg }>('workspaces')) {
    if (!w.buildCfg) continue
    const { buildCfg, ...rest } = w
    const builds = build.buildsOf(w).length ? build.buildsOf(w) : [{ ...buildCfg, id: 'main', name: NAME[buildCfg.kind] ?? '主程序' }]
    put('workspaces', { ...rest, builds })
  }
}
export function migrateEmployeeCreds() {
  const ids = all<Credential>('credentials').filter((c) => c.aiAllowed).map((c) => c.id)
  for (const e of all<Employee>('employees')) if (!Array.isArray(e.creds)) put('employees', { ...e, creds: ids, credGroups: e.credGroups ?? PRESETS[e.id]?.credGroups ?? [] })
}

// ---------- 安装包（每个项目按「端 × 渠道」一格，每格只留最新；packages.ts） ----------
route('GET', '/api/workspaces/:id/packages', (c) => packages.list(c.params.id).map(packages.pub))
/** 主人在网页上传（拖进来）：请求体就是文件，边收边写；?name=文件名&platform=&channel=&version=&build=&note=&signed=1 */
route('POST', '/api/workspaces/:id/packages', async (c) => {
  const w = get<Workspace>('workspaces', c.params.id)
  if (!w) throw new HttpError(404, '没有这个项目')
  const q = c.url.searchParams
  const name = path.basename(String(q.get('name') ?? '')).slice(0, 160)
  if (!name) throw bad('要带上文件名')
  const platform = q.get('platform') || packages.guessPlatform(name)
  if (!packages.isPlatform(platform)) throw bad('看不出是哪个端的包：选一下端（安卓 / iPhone / Mac / Windows / Linux）')
  const channel = q.get('channel') || 'test'
  if (!packages.isChannel(channel)) throw bad('渠道只能是 test（测试）或 prod（正式）')
  const dir = path.join(cfg.data, 'tmp')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = path.join(dir, `up-${uid()}`)
  await saveBody(c.req, tmp, 2 * 1024 * 1024 * 1024)
  try {
    return packages.pub(packages.store(w, platform, channel, tmp, { name, version: q.get('version') || undefined, build: q.get('build') || undefined, note: q.get('note') || undefined, signed: q.get('signed') === '1' ? true : q.get('signed') === '0' ? false : undefined, by: '主人' }))
  } catch (e) { fs.rmSync(tmp, { force: true }); throw bad((e as Error).message) }
}, { stream: true })
route('DELETE', '/api/packages/:id', (c) => { packages.remove(decodeURIComponent(c.params.id), '主人'); return { ok: true } })
/** 分享链接：{days: 7}（0 = 关掉）。拿到的人不用登录就能下（扫码装安卓包） */
route('POST', '/api/packages/:id/share', (c) => {
  try { return packages.pub(packages.share(decodeURIComponent(c.params.id), Math.max(0, Math.round(Number(c.body?.days ?? 7))), '主人')) } catch (e) { throw bad((e as Error).message) }
})
/** 把包发出去（下载）：登录的主人 / 分享链接共用 */
function sendPackage(c: Ctx, x: packages.AppPackage) {
  const f = packages.fileOf(x)
  if (!fs.existsSync(f)) throw new HttpError(404, '包的文件不在了')
  const type = x.platform === 'android' && x.file.toLowerCase().endsWith('.apk') ? 'application/vnd.android.package-archive' : 'application/octet-stream'
  c.res.writeHead(200, { 'Content-Type': type, 'Content-Length': String(x.size), 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(x.file)}`, 'Cache-Control': 'no-store' })
  fs.createReadStream(f).pipe(c.res)
}
route('GET', '/api/packages/:id/file', (c) => {
  const x = get<packages.AppPackage>('packages', decodeURIComponent(c.params.id))
  if (!x) throw new HttpError(404, '这一格还没有包')
  sendPackage(c, x)
})
// 分享出去的下载页（不用登录）：手机打开能看到名字、版本、大小，点一下下载；口令不对或过期了就说清楚
const htmlEsc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
route('GET', '/dl/:token', (c) => {
  const x = packages.byShare(c.params.token)
  const w = x && get<Workspace>('workspaces', x.ws)
  const body = !x || !w
    ? '<h1>链接失效了</h1><p>分享链接过期了，或者包已经被删掉。找发给你的人要一个新的。</p>'
    : `<h1>${htmlEsc(w.name)}</h1><p class="s">${htmlEsc(packages.pub(x).slot)}${x.version ? ` · ${htmlEsc(x.version)}` : ''} · ${(x.size / 1048576).toFixed(1)} MB</p>`
      + `<a class="b" href="${htmlEsc(c.params.token)}/file">下载 ${htmlEsc(x.file)}</a>`
      + `${x.note ? `<p>${htmlEsc(x.note)}</p>` : ''}`
      + `${x.platform === 'android' ? '<p class="s">安卓：下载后点开安装；第一次会提示「允许安装未知来源的应用」，允许就行。</p>' : x.platform === 'ios' ? '<p class="s">iPhone / iPad 的 .ipa 不能直接装：要用 TestFlight、企业签名或者 Xcode / Apple Configurator 装到登记过的设备上。</p>' : ''}`
      + `<p class="s">SHA256 ${x.sha256.slice(0, 16)}… · 链接 ${new Date(x.share!.until).toLocaleDateString('zh-CN')} 前有效</p>`
  c.res.writeHead(x ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' })
  c.res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>下载安装包</title><style>body{font:16px/1.6 -apple-system,system-ui,sans-serif;margin:0;padding:32px 20px;background:#F4F5F8;color:#14161F}main{max-width:440px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 4px 20px rgb(0 0 0/.06)}h1{font-size:20px;margin:0 0 4px}.s{color:#7A8091;font-size:13px}.b{display:block;text-align:center;background:#5B4FE9;color:#fff;text-decoration:none;padding:12px;border-radius:12px;margin:18px 0;font-weight:600;word-break:break-all}</style></head><body><main>${body}</main></body></html>`)
}, { auth: 'none' })
route('GET', '/dl/:token/file', (c) => {
  const x = packages.byShare(c.params.token)
  if (!x) throw new HttpError(404, '链接失效了')
  audit({ via: '分享链接', action: 'package.download', target: x.file, level: '读', result: '成功', how: c.ip })
  sendPackage(c, x)
}, { auth: 'none' })
