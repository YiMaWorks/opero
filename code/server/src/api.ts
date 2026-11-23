// 接口：网页（cookie 登录）、手机外壳（设备令牌）、MCP（每轮的令牌，只认本机）。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { cfg } from './config.ts'
import { all, db, del, get, kvGet, kvSet, put, uid } from './db.ts'
import { addClient, emit, waitPush } from './bus.ts'
import { bad, baseUrl, HttpError, isHttps, route, type Ctx } from './http.ts'
import * as auth from './auth.ts'
import { addMsg, audit, delMsg, getMsg, listAudit, listMessages, patchMsg, patchSession, sessionFor, system, usage } from './chat.ts'
import * as runner from './runner.ts'
import { callTool, fmtSize, TOOLS, type ToolResult } from './tools.ts'
import { checkServer, execOn, isReadOnly, LOCAL_ID } from './ssh.ts'
import { isReadSql, loadSchema, runQuery } from './dbconn.ts'
import { cloneWorkspace, inspect, providerOf, workspaceDir } from './git.ts'
import { fire, parseRule } from './triggers.ts'
import { PRESETS } from './presets.ts'
import * as execs from './executors.ts'
import * as agents from './agents.ts'
import * as hosts from './hosts.ts'
import * as queue from './queue.ts'
import * as keys from './keys.ts'
import { delSecret, getSecret, hasSecret, setSecret } from './vault.ts'
import type { Credential, DataSource, Device, Employee, KbDoc, Message, SavedQuery, Server, Session, Trigger, Workspace } from './types.ts'
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
  habits: '- 先给结论再说原因\n- 改代码在分支上做，改完自己看一遍 diff\n- 不确定的先问我',
}
export const settings = () => ({ ...defaultSettings, ...kvGet<Record<string, unknown>>('settings', {}) })

function bootstrap(c: Ctx) {
  const o = auth.owner()
  const sess = c.sess
  const setupDone = kvGet('setupDone', false)
  if (!o || !sess) return { auth: { needOwner: !o, loggedIn: false, setupDone }, instance: instanceInfo() }
  const sessions = all<Session>('sessions')
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
  const token = auth.newSession()
  setCookie(c, token)
  audit({ via: '—', action: 'login', target: c.ip, level: '读', result: '成功', how: '密码' })
  return { ok: true }
}, { auth: 'none' })

route('POST', '/api/auth/logout', (c) => { auth.endSession(c.sess!.token); setCookie(c, null); return { ok: true } })

route('POST', '/api/auth/verify', (c) => {
  if (auth.tooManyFails(c.ip)) throw new HttpError(429, '试太多次了，一分钟后再试')
  if (!auth.checkPassword(String(c.body?.password ?? ''))) { auth.noteFail(c.ip); throw new HttpError(401, '密码不对', 'VERIFY_FAIL') }
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
  }
}
function createEmployee(e: Employee, greet = true) {
  if (get('employees', e.id)) e = { ...e, id: uid('e') }
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
  const next = { ...s, ...(c.body?.pinned !== undefined ? { pinned: !!c.body.pinned } : {}) }
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
    return { id, name, size: fmtSize(fs.statSync(p).size), ext: ext.toUpperCase().slice(0, 4), image: mediaType.startsWith('image/'), mediaType, url: `/api/uploads/${emp.id}/${encodeURIComponent(id)}`, w: Number(x?.w) || undefined, h: Number(x?.h) || undefined }
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
route('POST', '/api/messages/:id/action', (c) => {
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
  const next: Server = { ...old, ...(name ? { name } : {}), ...(env ? { env } : {}), ...(protect !== undefined ? { protect } : {}), ...(b.ip && old.id !== LOCAL_ID ? { ip: String(b.ip), hostKey: undefined } : {}), ...(b.port ? { port: Number(b.port) } : {}), ...(b.user ? { user: String(b.user) } : {}), ...(b.credential !== undefined ? { credential: b.credential || undefined } : {}) }
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
  return put1('workspaces', { ...w, ...(b.credential !== undefined ? { credential: b.credential || undefined } : {}), ...(b.preview !== undefined ? { preview: String(b.preview) } : {}) })
})
route('DELETE', '/api/workspaces/:id', (c) => {
  del1('workspaces', c.params.id) // 目录留着（里面可能有没推的改动），要删去服务器上删
  return { ok: true }
})

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
route('GET', '/api/app/enter', (c) => {
  const t = tickets.get(String(c.url.searchParams.get('t') ?? ''))
  tickets.delete(String(c.url.searchParams.get('t') ?? ''))
  if (!t || t.exp < Date.now()) { c.res.writeHead(302, { Location: '/' }); c.res.end(); return }
  auth.endDeviceSessions(t.device)
  setCookie(c, auth.newSession(t.device))
  c.res.writeHead(302, { Location: '/' + (t.route ? `?route=${encodeURIComponent(t.route)}` : '') })
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

