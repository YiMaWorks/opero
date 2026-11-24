// 接口：网页（cookie 登录）、手机外壳（设备令牌）、MCP（每轮的令牌，只认本机）。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { cfg } from './config.ts'
import { all, db, del, get, kvGet, kvSet, put, uid } from './db.ts'
import { addClient, emit, push, waitPush } from './bus.ts'
import { bad, baseUrl, HttpError, isHttps, route, type Ctx } from './http.ts'
import * as auth from './auth.ts'
import { addMsg, audit, delMsg, getMsg, historyOf, listAudit, listMessages, patchMsg, patchSession, rotateSession, sessionFor, system, usage, usageDetail } from './chat.ts'
import * as runner from './runner.ts'
import { callTool, fmtSize, prCard, TOOLS, type ToolResult } from './tools.ts'
import * as prs from './prs.ts'
import * as dns from './dns.ts'
import * as inbox from './inbox.ts'
import * as mfa from './mfa.ts'
import * as notify from './notify.ts'
import * as releases from './releases.ts'
import * as build from './build.ts'
import { checkServer, execOn, isReadOnly, LOCAL_ID } from './ssh.ts'
import { isReadSql, loadSchema, runQuery } from './dbconn.ts'
import { cloneWorkspace, git, inspect, providerOf, workspaceDir } from './git.ts'
import { fire, parseRule } from './triggers.ts'
import { PRESETS } from './presets.ts'
import * as execs from './executors.ts'
import * as agents from './agents.ts'
import * as hosts from './hosts.ts'
import * as queue from './queue.ts'
import * as keys from './keys.ts'
import { delSecret, getSecret, hasSecret, setSecret } from './vault.ts'
import type { Credential, DataSource, Deploy, Device, Employee, Issue, KbDoc, Message, Release, SavedQuery, Server, ServerDir, Session, Trigger, Workspace } from './types.ts'
import * as memory from './memory.ts'
import * as issues from './issues.ts'
import { cleanPolicy } from './policy.ts'
import { envOf, isProtected } from './env.ts'

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
  prodProtect: true, theme: 'system', themeLight: 'amethyst', themeDark: 'slate', customTheme: { mode: 'light', bg: '#F3EEE3', ink: '#111111', accent: '#D9541E' },
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
  const sessions = all<Session>('sessions').filter((s) => !s.archived) // 归档的在员工档案「历史会话」里按需拉
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
    domains: all<dns.Domain>('domains'),
    channels: all<inbox.Channel>('channels').map(inbox.pubCh),
    notifiers: all<notify.Notifier>('notifiers').map(notify.pub),
    inbox: inbox.list({ limit: 200 }),
    audit: listAudit(),
    usage: usage(),
    settings: settings(),
  }
}
const instanceInfo = () => ({ version: cfg.version, isolated: !!cfg.aiUser, aiUser: cfg.aiUser })

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
async function executors(host = hosts.LOCAL) {
  const [cc, cx] = await Promise.all([hosts.runAiOn(host, cfg.claudeBin, ['--version'], { timeoutMs: 15_000 }), hosts.runAiOn(host, cfg.codexBin, ['--version'], { timeoutMs: 15_000 })])
  const c = runner.aiConf()
  const remote = !hosts.isLocal(host)
  return {
    host, aiUser: remote ? 'opero-ai' : cfg.aiUser, isolated: remote || !!cfg.aiUser,
    claude: cc.code === 0 ? cc.out.split('\n')[0] : null,
    codex: cx.code === 0 ? cx.out.split('\n').pop() : null,
    claudeKey: !!(c.claudeCred && hasSecret(c.claudeCred)), claudeBaseUrl: c.claudeBaseUrl ?? '', claudeEgress: c.claudeEgress ?? '', codexEgress: c.codexEgress ?? '',
    codexKey: !!(c.codexCred && hasSecret(c.codexCred)), codexBaseUrl: c.codexBaseUrl ?? '',
    install: {
      claude: `${cfg.aiUser ? `sudo -u ${cfg.aiUser} -H bash -lc ` : 'bash -lc '}'curl -fsSL https://claude.ai/install.sh | bash'`,
      codex: `${cfg.aiUser ? `sudo -u ${cfg.aiUser} -H bash -lc ` : 'bash -lc '}'npm install -g @openai/codex --prefix ~/.local'`,
      login: `${cfg.aiUser ? `sudo -u ${cfg.aiUser} -H bash -lc ` : 'bash -lc '}'claude setup-token'`,
    },
  }
}
route('GET', '/api/ai', (c) => executors(hostParam(c.url.searchParams.get('host'))))
route('PUT', '/api/ai', async (c) => {
  const b = c.body ?? {}
  const conf = runner.aiConf()
  const saveKey = (field: 'claudeCred' | 'codexCred', name: string, value: unknown) => {
    if (value === undefined) return
    const v = String(value).trim()
    const id = conf[field] ?? uid('cr')
    if (!v) { delSecret(id); return }
    setSecret(id, v)
    put1('credentials', { id, name, group: 'AI', kind: 'Token', env: '生产', scope: '调模型（按量计费）', usedBy: [], updated: now(), aiAllowed: true } satisfies Credential)
    conf[field] = id
  }
  saveKey('claudeCred', 'Claude Code 的 API Key / 令牌', b.claudeKey)
  saveKey('codexCred', 'Codex 的 OpenAI API Key', b.codexKey)
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
  try { return { job: execs.startInstall(/codex/i.test(String(c.body?.executor ?? '')) ? 'codex' : 'claude', host) } } catch (e) { throw bad((e as Error).message) }
})
route('POST', '/api/ai/login', (c) => {
  const host = hostParam(c.body?.host)
  try { return { job: execs.startLogin(host) } } catch (e) { throw bad((e as Error).message) }
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
  const codex = /codex/i.test(String(c.body?.executor ?? ''))
  const host = hostParam(c.body?.host)
  const c2 = runner.aiConf()
  const env: Record<string, string> = {}
  const key = codex ? (c2.codexCred && getSecret(c2.codexCred)) : (c2.claudeCred && getSecret(c2.claudeCred))
  if (key) Object.assign(env, codex ? { OPENAI_API_KEY: key, CODEX_API_KEY: key } : { [key.startsWith('sk-ant-oat') ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY']: key })
  if (!codex && c2.claudeBaseUrl) env.ANTHROPIC_BASE_URL = c2.claudeBaseUrl
  if (codex && c2.codexBaseUrl) env.OPENAI_BASE_URL = c2.codexBaseUrl
  Object.assign(env, runner.egressEnv(codex ? 'codex' : 'claude', host))
  const r = codex
    ? await hosts.runAiOn(host, cfg.codexBin, ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-'], { env, input: 'Reply with exactly: OK', timeoutMs: 120_000 })
    : await hosts.runAiOn(host, cfg.claudeBin, ['-p', '--max-turns', '1', '--output-format', 'text'], { env, input: 'Reply with exactly: OK', timeoutMs: 120_000 })
  const out = key ? r.out.split(key).join('••••') : r.out
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
    executor: /codex/i.test(String(pick('executor', 'Claude Code'))) ? 'Codex' : 'Claude Code', host: empHost(b.host ?? old?.host), workspace: pick('workspace', ''), menus: pick('menus', []),
    model: pick('model', 'Opus 5.5'), effort: pick('effort', 'high'), approval: pick('approval', 'auto'), notify: pick('notify', 'decide'), bg: pick('bg', 'plain'),
    avatarImg: pick('avatarImg', undefined), repo: '', resumeId: old?.resumeId, contextUsed: old?.contextUsed ?? 0,
    gender: String(pick('gender', '') ?? '').slice(0, 10), memRepo: String(pick('memRepo', '') ?? '').trim() || undefined, memCred: String(pick('memCred', '') ?? '') || undefined,
    works: old?.works,
    canManage: !!pick('canManage', false),
    reads: (Array.isArray(b.reads) ? b.reads : old?.reads ?? []).map(String).filter((id: string) => get<Workspace>('workspaces', id)).slice(0, 8),
    budget: Math.max(0, Number(pick('budget', 0)) || 0) || undefined,
    dns: (Array.isArray(b.dns) ? b.dns : old?.dns ?? []).map(String).filter((id: string) => get('domains', id)),
    workBranch: /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,100}(?<!\/)$/.test(String(pick('workBranch', '') ?? '')) ? String(pick('workBranch', '')) : undefined,
  }
}
function createEmployee(e: Employee, greet = true) {
  if (get('employees', e.id)) e = { ...e, id: uid('e') }
  e = { ...e, works: [{ no: 1, from: new Date().toLocaleDateString('zh-CN'), reason: '刚建', host: hosts.isLocal(e.host) ? 'Opero 这台' : (get<Server>('servers', e.host)?.name ?? '') }] }
  put1('employees', e)
  const s = sessionFor(e.id)
  if (greet) {
    addMsg(s.id, { from: e.id, kind: 'text', text: `我是「${e.name}」${e.title ? `，${e.title}` : ''}。有事直接跟我说。` })
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
  if (old.executor !== e.executor || old.workspace !== e.workspace || old.host !== e.host) e.resumeId = undefined // 换了执行器 / 目录：会话接不上了，下一句开新的
  if (old.host !== e.host) {
    if (runner.isWorking(old.id)) throw bad('员工正在干活：等这一轮做完再换服务器')
    e.works = nextWork(e, '换服务器')
    const sid = sessionFor(e.id).id
    memory.moveMemory(old, runner.hostOf(old), runner.hostOf(e)).then((r) => r && system(sid, r)).catch((err) => system(sid, `记忆仓库没搬过来：${(err as Error).message}`))
  }
  return put1('employees', e)
})
route('DELETE', '/api/employees/:id', (c) => {
  const e = get<Employee>('employees', c.params.id)
  if (!e) return { ok: true }
  runner.stop(e.id)
  for (const q of queue.list(e.id)) queue.remove(q.id, true)
  for (const s of all<Session>('sessions').filter((x) => x.employee === e.id)) {
    db.prepare('DELETE FROM messages WHERE sid = ?').run(s.id)
    del1('sessions', s.id)
  }
  del1('employees', e.id)
  audit({ via: '—', action: 'employee.delete', target: e.name, level: '写', result: '成功', how: '本人' })
  return { ok: true }
})
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
/** 交接草稿：最近你说的、员工最后说的、工作空间现在的样子 */
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
    wsLine = `工作空间「${w.name}」：${n ? `还有 ${n} 个文件没提交` : '没有未提交的改动'}${lg.out ? `；最近提交：\n${lg.out.split('\n').map((l) => `  - ${l}`).join('\n')}` : ''}`
  }
  return [
    '接着上一个会话做（上一个会话已归档，上下文清空了）。先读你记忆仓库的 CLAUDE.md 和 docs/交接.md 最上面几条。',
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
  const to = /codex/i.test(String(c.body?.executor ?? '')) ? 'Codex' : 'Claude Code'
  if (to === e.executor) throw bad(`已经是 ${to} 了`)
  const host = runner.hostOf(e)
  const bin = to === 'Codex' ? cfg.codexBin : cfg.claudeBin
  const v = await hosts.runAiOn(host, bin, ['--version'], { timeoutMs: 20_000 })
  if (v.code !== 0) throw bad(`这台还没装好 ${to}：先到「我 → AI 执行器」装好、登录`)
  const draft = await handoffDraft(e, sessionFor(e.id).id)
  const ns = rotate({ ...e }, `换成 ${to}`, draft)
  put1('employees', { ...get<Employee>('employees', e.id)!, executor: to, model: to === 'Codex' ? '执行器默认' : 'Opus 5.5' })
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

route('POST', '/api/setup/employees', (c) => {
  const { presets = [], executor = 'Claude Code', model = 'Opus 5.5' } = c.body ?? {}
  const made: Employee[] = []
  for (const k of presets as string[]) {
    const p = PRESETS[k]
    if (!p) continue
    made.push(createEmployee(cleanEmp({ ...p, id: k, executor, model: /codex/i.test(executor) ? '执行器默认' : model })))
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
  const working = runner.isWorking(emp.id)
  const mode = c.body?.mode === 'queue' ? 'queue' : 'auto'
  if (working && (mode === 'queue' || !runner.canInterject(emp.id))) {
    try { return { queued: queue.enqueue(emp.id, text, files) } } catch (e) { throw bad((e as Error).message) }
  }
  queue.post(s.id, text, files)
  runner.send(emp.id, text || queue.defaultText(files), queue.toAttachments(emp, files))
  return { sent: true, interjected: working }
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

function sendFileOut(c: Ctx, p: string, name?: string) {
  let st: fs.Stats
  try { st = fs.statSync(p) } catch { throw new HttpError(404, '文件没了') }
  const ext = path.extname(name ?? p).toLowerCase()
  const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.json': 'application/json', '.log': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8' }
  const type = types[ext] ?? 'application/octet-stream'
  c.res.writeHead(200, {
    'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${type.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name ?? path.basename(p))}`,
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
route('POST', '/api/sessions/:id/stop', (c) => { const s = sess(c.params.id); return { ok: runner.stop(s.employee) } })
route('POST', '/api/sessions/:id/new-topic', (c) => {
  const s = sess(c.params.id)
  const reason = String(c.body?.reason ?? '')
  runner.newTopic(s.employee, reason ? `—— 新的 work（${reason}）：上下文已清空，目录和工作空间都还在 ——` : undefined)
  return { ok: true }
})

// 卡片上的按钮
route('POST', '/api/messages/:id/action', async (c) => {
  const found = getMsg(c.params.id)
  const card = found?.msg.card
  if (!found || !card) throw new HttpError(404, '没有这张卡片')
  if (card.state !== 'open') throw bad('已经处理过了')
  const act = card.actions.find((a) => a.id === c.body?.action)
  if (!act) throw bad('没有这个按钮')
  const verified = !!c.sess && Date.now() - c.sess.verified < auth.VERIFY_MS
  if (act.style === 'danger') needVerify(c)
  const s = get<Session>('sessions', found.sid)
  const answer = c.body?.answer !== undefined ? String(c.body.answer) : undefined
  let result: string
  if (runner.isPending(c.params.id)) {
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
  } else if (card.data.pending) {
    result = '这个请求已经失效（员工那一轮结束了或 Opero 重启过），让员工再发一次'
  } else {
    result = `你点了「${act.label}」`
    if (s) runner.send(s.employee, `我在卡片「${String(card.data.title ?? '')}」上点了「${act.label}」${answer ? `：${answer}` : ''}`)
  }
  patchMsg(c.params.id, { card: { ...card, state: 'done', result } })
  if (s) patchSession(s.id, { clear: ['waiting'] })
  return { ok: true, result }
})

// ---------- 服务器 ----------
function inlineCred(name: string, group: string, kind: string, env: any, user: string, secret: string, scope: string): string {
  const id = uid('cr')
  setSecret(id, secret)
  put1('credentials', { id, name, group, kind, env, scope, usedBy: [], updated: now(), aiAllowed: true, user } satisfies Credential)
  return id
}
route('POST', '/api/servers', async (c) => {
  const b = c.body ?? {}
  const name = String(b.name ?? '').trim()
  const ip = String(b.ip ?? '').trim()
  if (!name || !ip) throw bad('名字和地址都要填')
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
  if (b.dirs !== undefined) {
    needVerify(c)
    const dirs = cleanDirs(b.dirs)
    applyDirs(old, dirs).catch(() => {})
    audit({ via: '—', action: 'server.dirs', target: `${old.name}：${dirs.map((d) => `${d.path}（${d.mode}）`).join('、') || '清空'}`, level: '危险', result: '成功', how: '本人（已验证）' })
    old.dirs = dirs.map((d) => ({ ...d, ok: undefined, error: '在设权限…' }))
  }
  const next: Server = { ...old, ...(name ? { name } : {}), ...(env ? { env } : {}), ...(protect !== undefined ? { protect } : {}), ...(b.policy !== undefined ? { policy: cleanPolicy(b.policy, old.policy) } : {}), ...(b.ip && old.id !== LOCAL_ID ? { ip: String(b.ip), hostKey: undefined } : {}), ...(b.port ? { port: Number(b.port) } : {}), ...(b.user ? { user: String(b.user) } : {}), ...(b.credential !== undefined ? { credential: b.credential || undefined } : {}) }
  return pub('servers', put1('servers', next))
})
/** 服务器登记的目录：绝对路径、不是系统目录、最多 30 个 */
function cleanDirs(list: unknown): ServerDir[] {
  if (!Array.isArray(list)) return []
  const SYS = /^\/(etc|usr|bin|sbin|lib|lib64|boot|proc|sys|dev|run|var\/lib|root)(\/|$)/
  return list.slice(0, 30).map((x: any) => {
    const p = String(x?.path ?? '').trim().replace(/\/+$/, '')
    if (!/^\/[\w./@+-]+$/.test(p) || p.includes('..') || p.split('/').length < 3 && !/^\/(srv|opt|data|home|www|var)\/?/.test(p)) throw bad(`目录不对：${p}（要绝对路径，至少两层，比如 /srv/app）`)
    if (SYS.test(p) && x?.mode !== 'read') throw bad(`${p} 是系统目录，只能登记成「只读」`)
    return { path: p, mode: ['read', 'write', 'deploy'].includes(x?.mode) ? x.mode : 'read', note: String(x?.note ?? '').slice(0, 80) || undefined }
  })
}
/** 按登记的目录给 AI 用户开权限（ACL）：只读 = r-X，读写 = rwX（连默认 ACL，新文件也跟着），能部署的由 Agent 以 root 部署、不用开。去掉的收回 */
async function applyDirs(sv: Server, dirs: ServerDir[]) {
  const before = sv.dirs ?? []
  const results: ServerDir[] = []
  const local = sv.id === LOCAL_ID
  const ai = local ? (cfg.aiUser || 'opero-ai') : 'opero-ai'
  for (const d of dirs) {
    if (d.mode === 'deploy') { results.push({ ...d, ok: true }); continue }
    const perm = d.mode === 'write' ? 'rwX' : 'rX'
    const cmd = `set -e; command -v setfacl >/dev/null || { echo "这台没有 setfacl（装 acl 包：apt install acl / yum install acl）"; exit 3; }; test -d ${shq(d.path)} || { echo "目录不存在"; exit 4; }
p=${shq(d.path)}; while [ "$p" != "/" ]; do p=$(dirname "$p"); setfacl -m u:${ai}:x "$p" 2>/dev/null || true; done
setfacl -R -m u:${ai}:${perm} ${shq(d.path)} && setfacl -R -d -m u:${ai}:${perm} ${shq(d.path)} && echo OK`
    if (local) { results.push({ ...d, ok: false, error: `Opero 这台要你自己用 root 跑：setfacl -R -m u:${ai}:${perm} ${d.path} && setfacl -R -d -m u:${ai}:${perm} ${d.path}` }); continue }
    const r = await execOn(sv, cmd, 120_000)
    results.push({ ...d, ok: r.out.includes('OK'), error: r.out.includes('OK') ? undefined : r.out.trim().split('\n').pop()?.slice(0, 200) })
  }
  for (const old of before.filter((x) => x.mode !== 'deploy' && !dirs.some((d) => d.path === x.path && d.mode !== 'deploy'))) {
    if (!local) await execOn(sv, `command -v setfacl >/dev/null && setfacl -R -x u:${ai} ${shq(old.path)} 2>/dev/null; setfacl -R -d -x u:${ai} ${shq(old.path)} 2>/dev/null; true`, 120_000).catch(() => {})
  }
  const cur = get<Server>('servers', sv.id)
  if (cur) put1('servers', { ...cur, dirs: results })
}
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

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
  let cmd: string
  if (svc) { if (!/^[\w@.:-]+$/.test(svc)) throw bad('服务名不对'); cmd = `journalctl -u '${svc}' -n ${lines} --no-pager -o short-iso 2>&1` }
  else if (file) { if (!/^\/[\w./@+-]+$/.test(file) || file.includes('..')) throw bad('日志路径要是绝对路径'); cmd = `tail -n ${lines} '${file}' 2>&1` }
  else throw bad('选一个服务或日志文件')
  const r = await execOn(sv, cmd, 20_000)
  return { text: r.out, code: r.code }
})
route('POST', '/api/servers/:id/exec', async (c) => {
  const sv = get<Server>('servers', c.params.id)
  if (!sv) throw new HttpError(404, '没有')
  const command = String(c.body?.command ?? '').trim()
  const ro = isReadOnly(command)
  if (!ro) needVerify(c)
  const r = await execOn(sv, command, 60_000)
  audit({ via: '—', action: 'server.exec', target: `${sv.name} · ${command.slice(0, 100)}`, level: ro ? '读' : '写', result: r.code === 0 ? '成功' : '失败', how: ro ? '本人（只读命令）' : '本人（已验证）' })
  return r
})

// ---------- 凭证 ----------
route('POST', '/api/credentials', (c) => saveCred(c))
route('PUT', '/api/credentials/:id', (c) => saveCred(c, c.params.id))
function saveCred(c: Ctx, id?: string) {
  needVerify(c)
  const b = c.body ?? {}
  const old = id ? get<Credential>('credentials', id) : undefined
  if (id && !old) throw new HttpError(404, '没有')
  const name = String(b.name ?? old?.name ?? '').trim()
  if (!name) throw bad('先起个名字')
  const cred: Credential = {
    id: old?.id ?? uid('cr'), name, group: String(b.group ?? old?.group ?? '其它'), kind: String(b.kind ?? old?.kind ?? 'Token'), env: envOf(b.env, old?.env ?? '生产'),
    scope: String(b.scope ?? old?.scope ?? ''), usedBy: Array.isArray(b.usedBy) ? b.usedBy : old?.usedBy ?? [], updated: now(), aiAllowed: b.aiAllowed ?? old?.aiAllowed ?? true,
    user: b.user !== undefined ? String(b.user) : old?.user,
  }
  if (b.secret) setSecret(cred.id, String(b.secret))
  put1('credentials', cred)
  audit({ via: '—', action: old ? 'credential.update' : 'credential.create', target: name, level: '危险', result: '成功', how: '本人（已验证）' })
  return pub('credentials', cred)
}
route('DELETE', '/api/credentials/:id', (c) => {
  needVerify(c)
  const cr = get<Credential>('credentials', c.params.id)
  delSecret(c.params.id)
  del1('credentials', c.params.id)
  audit({ via: '—', action: 'credential.delete', target: cr?.name ?? c.params.id, level: '危险', result: '成功', how: '本人（已验证）' })
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
  if (!name || !b.host || !b.db) throw bad('名字、地址、库名都要填')
  const kind = b.kind === 'PostgreSQL' ? 'PostgreSQL' : 'MySQL'
  const env = envOf(b.env, '生产')
  let credential = b.credential ? String(b.credential) : undefined
  if (!credential && b.password) credential = inlineCred(`${name} 的数据库账号`, '数据库', '数据库', env, String(b.user ?? ''), String(b.password), b.writable ? '读写' : '只读')
  const ds: DataSource = { id: uid('ds'), name, kind, env, ...(typeof b.protect === 'boolean' ? { protect: b.protect } : {}), host: String(b.host), port: Number(b.port) || undefined, db: String(b.db), user: String(b.user ?? ''), credential, writable: !!b.writable, tables: [] }
  put1('dataSources', ds)
  audit({ via: '—', action: 'data.add', target: `${name} · ${kind} ${ds.host}/${ds.db}`, level: '写', result: '成功', how: '本人' })
  try { ds.tables = await loadSchema(ds); put1('dataSources', ds) } catch (e) { return { ...ds, error: `连不上：${(e as Error).message}` } }
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
  try { return put1('dataSources', { ...ds, tables: await loadSchema(ds) }) } catch (e) { throw bad(`连不上：${(e as Error).message}`) }
})
route('POST', '/api/data-sources/:id/query', async (c) => {
  const ds = get<DataSource>('dataSources', c.params.id)
  if (!ds) throw new HttpError(404, '没有')
  const sql = String(c.body?.sql ?? '').trim()
  const read = isReadSql(sql)
  if (!read) {
    if (!ds.writable) throw bad('这个库只接了只读账号，不能改数据')
    needVerify(c)
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
  const name = String(b.name ?? old?.name ?? '').trim()
  if (!name) throw bad('先起个名字')
  const kind = b.kind === 'Webhook' ? 'Webhook' : '定时'
  const rule = String(b.rule ?? old?.rule ?? '').trim()
  if (kind === '定时' && !parseRule(rule)) throw bad('认不出这个时间：写成「每 30 分钟」「每 2 小时」「每天 09:00」「工作日 09:30」「每周一 10:00」')
  const employee = String(b.employee ?? old?.employee ?? '')
  if (!get('employees', employee)) throw bad('选一个员工')
  return {
    id: old?.id ?? uid('t'), name, kind, rule: kind === 'Webhook' ? '有人调 Webhook 地址时' : rule, employee, enabled: b.enabled ?? old?.enabled ?? true,
    last: old?.last ?? '还没触发', prompt: String(b.prompt ?? old?.prompt ?? ''), lastTs: old?.lastTs ?? Date.now(),
    hookToken: kind === 'Webhook' ? (old?.hookToken ?? crypto.randomBytes(18).toString('base64url')) : undefined,
  }
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

// ---------- 工作空间 ----------
route('POST', '/api/workspaces', async (c) => {
  const b = c.body ?? {}
  const repo = String(b.repo ?? '').trim()
  if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(repo)) throw bad('仓库地址要以 https:// 开头')
  const name = String(b.name || repo.replace(/\.git$/, '').split('/').pop() || '').trim()
  if (!name) throw bad('起个名字')
  if (all<Workspace>('workspaces').some((w) => w.name === name)) throw bad('已经有同名的工作空间')
  const server = empHost(b.server)
  const svName = hosts.isLocal(server) ? '本机' : (get<Server>('servers', server)?.name ?? server)
  const w: Workspace = { id: uid('w'), name, provider: providerOf(repo), repo, branch: String(b.branch ?? '').trim(), host: svName, server, dir: workspaceDir(name, server), last: '拉取中…', employees: [], credential: b.credential || undefined, branches: [], commits: [], docs: [] }
  put1('workspaces', w)
  audit({ via: '—', action: 'workspace.add', target: `${name} · ${repo}`, level: '写', result: '成功', how: '本人' })
  cloneWorkspace(w).then(async () => put1('workspaces', { ...w, ...(await inspect(w)) }))
    .catch((e) => put1('workspaces', { ...w, last: '拉取失败', error: String((e as Error).message).slice(-400) }))
  return w
})
route('POST', '/api/workspaces/:id/refresh', async (c) => {
  const w = get<Workspace>('workspaces', c.params.id)
  if (!w) throw new HttpError(404, '没有')
  if (w.error && !fs.existsSync(path.join(w.dir, '.git'))) {
    try { await cloneWorkspace(w) } catch (e) { return put1('workspaces', { ...w, error: String((e as Error).message).slice(-400) }) }
  }
  return put1('workspaces', { ...w, ...(await inspect(w)) })
})
route('PUT', '/api/workspaces/:id', (c) => {
  const w = get<Workspace>('workspaces', c.params.id)
  if (!w) throw new HttpError(404, '没有')
  const b = c.body ?? {}
  return put1('workspaces', { ...w, ...(b.credential !== undefined ? { credential: b.credential || undefined } : {}), ...(b.preview !== undefined ? { preview: String(b.preview) } : {}),
    ...(typeof b.autoSync === 'boolean' ? { autoSync: b.autoSync } : {}), ...(b.budget !== undefined ? { budget: Math.max(0, Number(b.budget) || 0) || undefined } : {}), ...(Array.isArray(b.deploys) ? { deploys: cleanDeploys(b.deploys, w.deploys) } : {}),
    ...(b.buildCfg !== undefined ? { buildCfg: cleanBuild(b.buildCfg, w.buildCfg) } : {}) })
})
/** 编译设置：哪种模板、在哪编（云效 / GitHub / 自己的服务器） */
function cleanBuild(b: any, old?: build.BuildCfg): build.BuildCfg | undefined {
  if (!b) return undefined
  const kind = ['node', 'go', 'android', 'spring', 'custom'].includes(b.kind) ? b.kind : 'custom'
  const provider = ['yunxiao', 'github', 'local'].includes(b.provider) ? b.provider : 'local'
  const s = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n) || undefined
  const out: build.BuildCfg = { kind, provider, subdir: s(b.subdir, 100), cmd: s(b.cmd, 8000), versionFile: s(b.versionFile), versionRe: s(b.versionRe), service: s(b.service, 80)?.replace(/[^A-Za-z0-9@._-]/g, ''), file: s(b.file, 100) }
  if (kind === 'custom' && !out.cmd) throw bad('自定义模板要写编译命令（把产物放进 out/）')
  if (kind === 'spring') out.spring = { tool: b.spring?.tool === 'gradle' ? 'gradle' : 'maven', jdk: Number(b.spring?.jdk) === 21 ? 21 : 17, task: s(b.spring?.task), jar: s(b.spring?.jar), dirs: Array.isArray(b.spring?.dirs) ? b.spring.dirs.map(String).slice(0, 10) : [] }
  if (provider === 'yunxiao') {
    if (!get<Credential>('credentials', String(b.yunxiao?.cred ?? ''))) throw bad('选一个放着云效个人访问令牌的凭证')
    out.yunxiao = { cred: String(b.yunxiao.cred), org: s(b.yunxiao?.org, 64), pipelineId: s(b.yunxiao?.pipelineId, 32) ?? old?.yunxiao?.pipelineId, image: s(b.yunxiao?.image), at: old?.yunxiao?.at }
  }
  if (provider === 'github') out.github = { workflow: s(b.github?.workflow, 80)?.replace(/[^\w.-]/g, '') ?? old?.github?.workflow, at: old?.github?.at }
  if (provider === 'local') {
    if (!get<Server>('servers', String(b.local?.server ?? ''))) throw bad('选一台编译的服务器')
    out.local = { server: String(b.local.server) }
  }
  return out
}
route('POST', '/api/workspaces/:id/build/generate', async (c) => {
  const w = get<Workspace>('workspaces', c.params.id)
  if (!w?.buildCfg) throw bad('先存好编译设置')
  try {
    const next = await build.generate(w, w.buildCfg)
    audit({ via: '—', action: 'build.generate', target: `${w.name} · ${build.providerName(next)}`, level: '写', result: '成功', how: '本人' })
    return put1('workspaces', { ...get<Workspace>('workspaces', w.id)!, buildCfg: next })
  } catch (e) { throw bad((e as Error).message) }
})
route('GET', '/api/workspaces/:id/build/script', (c) => {
  const w = get<Workspace>('workspaces', c.params.id)
  if (!w?.buildCfg) throw bad('先存好编译设置')
  return { script: build.script(w.buildCfg, build.codeOf(w)) }
})
function cleanDeploys(list: any[], old: Deploy[] = []): Deploy[] {
  return list.slice(0, 20).map((d) => {
    const prev = old.find((o) => o.id === d.id)
    const name = String(d.name ?? '').trim().slice(0, 40)
    if (!name) throw bad('发布环境要有名字')
    const servers = (Array.isArray(d.servers) ? d.servers : []).map(String).filter((id: string) => get<Server>('servers', id)).slice(0, 20)
    if (!servers.length) throw bad(`发布环境「${name}」要选至少一台服务器`)
    const dir = String(d.dir ?? '').trim().replace(/\/+$/, '')
    if (dir && (!/^\/[\w./@+-]+$/.test(dir) || dir.includes('..'))) throw bad('部署目录要是绝对路径')
    const command = String(d.command ?? '').trim().slice(0, 4000)
    const sign = d.sign ? String(d.sign) : undefined
    if (sign && get<Credential>('credentials', sign)?.group !== '签名证书') throw bad(`发布环境「${name}」的签名证书不对`)
    const health = String(d.health ?? '').trim()
    if (health && !/^https?:\/\/\S+$/.test(health)) throw bad('检查地址要以 http:// 或 https:// 开头')
    return {
      id: prev?.id ?? uid('dp'), name, servers, dir: dir || undefined, script: String(d.script ?? '').trim().replace(/[^\w./-]/g, '') || undefined, command: command || undefined, sign, health: health || undefined,
      keep: Math.max(1, Math.min(Number(d.keep) || 5, 30)), ai: ['auto', 'ask', 'off'].includes(d.ai) ? d.ai : 'ask', autoRollback: d.autoRollback !== false,
      last: prev?.last, lastOk: prev?.lastOk,
    }
  })
}
route('POST', '/api/workspaces/:id/deploys/:did/run', (c) => {
  const w = get<Workspace>('workspaces', c.params.id)
  const d = w?.deploys?.find((x) => x.id === c.params.did)
  if (!w || !d) throw new HttpError(404, '没有这个发布环境')
  if (releases.serversOf(d).some((id) => { const sv = get<Server>('servers', id); return sv && isProtected(sv) })) needVerify(c)
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
  if (releases.serversOf(d).some((id) => { const sv = get<Server>('servers', id); return sv && isProtected(sv) })) needVerify(c)
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
  del1('workspaces', c.params.id) // 目录留着（里面可能有没推的改动），要删去服务器上删
  return { ok: true }
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
  needVerify(c)
  const d = domOf(c.params.id)
  const b = c.body ?? {}
  try {
    const x = await dns.set(d, { rr: String(b.rr ?? '').trim(), type: String(b.type ?? '').toUpperCase(), value: String(b.value ?? '').trim(), ttl: b.ttl ? Number(b.ttl) : undefined, priority: b.priority ? Number(b.priority) : undefined })
    audit({ via: '—', action: 'dns.set', target: `${b.rr}.${d.domain} ${b.type} ${b.value}`, level: '危险', result: '成功', how: '本人（已验证）' })
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
  const name = String(b.name ?? '').trim().slice(0, 40)
  const cred = get<Credential>('credentials', String(b.cred ?? ''))
  if (!name || !cred) throw bad('名字和凭证都要有')
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
route('POST', '/api/notifiers', (c) => {
  const b = c.body ?? {}
  if (!KINDS.includes(b.kind)) throw bad('不认识的渠道')
  if (!get<Credential>('credentials', String(b.cred ?? ''))) throw bad('选一个凭证（机器人令牌 / 地址 / SMTP 密码）')
  const events = (Array.isArray(b.events) ? b.events : ['decide', 'error']).filter((x: string) => ['decide', 'error', 'all'].includes(x))
  const n: notify.Notifier = {
    id: uid('nt'), kind: b.kind, name: String(b.name ?? b.kind).slice(0, 40), events: events.length ? events : ['decide', 'error'], enabled: true, cred: String(b.cred),
    chatId: b.chatId ? String(b.chatId) : undefined, smtpHost: b.smtpHost ? String(b.smtpHost) : undefined, smtpPort: Number(b.smtpPort) || undefined, smtpUser: b.smtpUser ? String(b.smtpUser) : undefined, to: b.to ? String(b.to) : undefined,
  }
  if (n.kind === 'telegram' && !n.chatId) throw bad('Telegram 要填 chat_id（给机器人发一句话后，用 getUpdates 看）')
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
  const token = crypto.randomBytes(32).toString('base64url')
  const id = String(b.deviceId || uid('d')).slice(0, 64)
  put1('devices', { id, name: String(b.name ?? '手机').slice(0, 60), platform: String(b.platform ?? 'android'), appVersion: String(b.appVersion ?? ''), tokenHash: auth.sha(token), enabled: true, paired: Date.now() } satisfies Device)
  audit({ via: '—', action: 'app.pair', target: String(b.name ?? '手机'), level: '危险', result: '成功', how: '配对码' })
  return { deviceToken: token }
}, { auth: 'none' })
route('POST', '/api/app/ticket', (c) => {
  const t = crypto.randomBytes(24).toString('base64url')
  tickets.set(t, { device: c.device!.id, exp: Date.now() + 60_000, route: String(c.body?.route ?? '') })
  return { url: `/api/app/enter?t=${t}` }
}, { auth: 'device' })
const tickets = new Map<string, { device: string; exp: number; route: string }>()
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
  auth.endDeviceSessions(t.device)
  setCookie(c, auth.newSession(t.device))
  c.res.writeHead(302, { Location: home(c) + (t.route ? `?route=${encodeURIComponent(t.route)}` : '') })
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
const RAW_INSTALL = 'https://raw.githubusercontent.com/yimaworks/opero/main/code/server/scripts/install.sh'
route('POST', '/api/agents/join', (c) => {
  const b = c.body ?? {}
  const env = envOf(b.env, '测试')
  const token = agents.newJoinToken(env, String(b.name ?? '').trim() || undefined)
  const url = baseUrl(c.req, cfg.publicUrl)
  const cmd = `curl -fsSL ${RAW_INSTALL} | sudo bash -s -- --agent ${url} ${token}`
  audit({ via: '—', action: 'agent.token', target: `${b.name || '新服务器'}（${env}）`, level: '写', result: '成功', how: '生成 30 分钟有效的接入命令' })
  return { token, url, cmd, cmdCn: cmd + ' --cn', expiresIn: 1800, since: Date.now() }
})
route('DELETE', '/api/agents/:id', (c) => {
  needVerify(c)
  const sv = get<Server>('servers', c.params.id)
  agents.remove(c.params.id)
  audit({ via: '—', action: 'agent.remove', target: sv?.name ?? c.params.id, level: '危险', result: '成功', how: '本人（已验证）' })
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
route('POST', '/api/agents/:id/accept', (c) => { needVerify(c); try { return agents.pub(agents.decide(c.params.id, true)) } catch (e) { throw bad((e as Error).message) } })
route('POST', '/api/agents/:id/reject', (c) => { needVerify(c); try { return agents.pub(agents.decide(c.params.id, false)) } catch (e) { throw bad((e as Error).message) } })
// Opero 换地址（迁移）：让所有在线的 Agent 改连新地址（Opero 的指纹不变，Agent 就无痕接上）
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
  needVerify(c)
  const sv = get<Server>('servers', c.params.id)
  if (!sv || !agents.agentOnline(sv)) throw bad('这台的 Agent 不在线')
  const r = await agents.exec(sv.id, 'systemd-run --unit=opero-agent-upgrade --collect --quiet /usr/local/bin/opero update && echo STARTED', { timeoutMs: 30_000 })
  audit({ via: '—', action: 'agent.upgrade', target: `${sv.name}：${sv.agentVersion ?? '?'} → ${cfg.version}`, level: '写', result: r.out.includes('STARTED') ? '成功' : '失败', how: '本人（已验证）' })
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
  return { tools: TOOLS.filter((t) => t.name !== 'approve' || !/codex/i.test(e?.executor ?? '')) }
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
    if (m.card) db.prepare('UPDATE messages SET data = ? WHERE id = ?').run(JSON.stringify({ ...m, card: { ...m.card, state: 'done', result: '已失效（Opero 重启过），让员工再发一次' } }), r.id)
  }
  for (const s of all<Session>('sessions')) if (s.working || s.waiting) { const { working: _w, waiting: _x, ...rest } = s; put('sessions', rest) }
}

