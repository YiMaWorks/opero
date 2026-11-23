// 让员工干活：每个员工同一时间最多一个执行器进程（Claude Code / Codex）。
//   Claude Code：claude -p --input-format stream-json --output-format stream-json，stdin 开着，干活时你再发的话直接写进去（插话）；
//     一轮说完、没有待处理的话就关 stdin，进程退出；下一句用 --resume 接着同一个会话。
//   Codex：codex exec --json，提示词走 stdin；干活时你再发的话排队，这一轮完了接着做。
// 执行器跑在 AI 专用的系统用户下（OPERO_AI_USER，经 sudo），读不到 Opero 的数据目录和保险箱；它要连服务器、查库、同步代码都经 MCP 工具找 Opero。
import { spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { cfg, MCP_SCRIPT } from './config.ts'
import { get, kvGet, put, uid } from './db.ts'
import { emit, push } from './bus.ts'
import { addMsg, delMsg, empSays, getMsg, monthCost, patchMsg, patchSession, recordRun, sessionFor, system } from './chat.ts'
import { getSecret, scrub } from './vault.ts'
import type { Employee, Workspace } from './types.ts'

export interface Attachment { path: string; name: string; mediaType: string; image: boolean }

interface Live {
  emp: string
  sid: string
  runId: string
  token: string
  kind: 'claude' | 'codex'
  proc: ChildProcess
  stdinOpen: boolean
  pending: number // 已写进去、还没说完的话（Claude）
  queue: { text: string; files: Attachment[] }[] // 排队的话（Codex）
  statusId: string
  said: number // 这一轮说了几段话
  lastResult: string
  stopped: boolean
  cost: number
  tokens: number
  ok: boolean
  stderr: string
  secrets: string[]
  ctx?: number
}

const live = new Map<string, Live>()
/** 进程还在起（第一次要先看执行器支不支持 --effort）：这时来的话先攒着，起好了再交过去 */
const booting = new Map<string, { text: string; files: Attachment[] }[]>()
const stopEarly = new Set<string>()
const byToken = new Map<string, { emp: string; sid: string; runId: string }>()

export const isWorking = (emp: string) => live.has(emp) || booting.has(emp)
export const runOf = (token: string) => byToken.get(token)
export const workingList = () => [...live.keys()]

// ---------- AI 执行器的账号（在「AI 执行器」页配，值在保险箱） ----------
export interface AiConf { claudeCred?: string; claudeBaseUrl?: string; codexCred?: string; codexBaseUrl?: string }
export const aiConf = () => kvGet<AiConf>('ai', {})

function aiEnv(kind: 'claude' | 'codex'): { env: Record<string, string>; secrets: string[] } {
  const c = aiConf()
  const env: Record<string, string> = {}
  const secrets: string[] = []
  if (kind === 'claude') {
    const k = c.claudeCred ? getSecret(c.claudeCred) : undefined
    if (k) { secrets.push(k); env[k.startsWith('sk-ant-oat') ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY'] = k }
    if (c.claudeBaseUrl) env.ANTHROPIC_BASE_URL = c.claudeBaseUrl
    Object.assign(env, { MCP_TIMEOUT: '60000', MCP_TOOL_TIMEOUT: '1900000', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', API_TIMEOUT_MS: '600000' })
  } else {
    const k = c.codexCred ? getSecret(c.codexCred) : undefined
    if (k) { secrets.push(k); Object.assign(env, { OPENAI_API_KEY: k, CODEX_API_KEY: k }) }
    if (c.codexBaseUrl) env.OPENAI_BASE_URL = c.codexBaseUrl
  }
  return { env, secrets }
}

/** 以 AI 用户跑一个命令（登录 shell，PATH 里有它自己装的 claude / codex） */
export function spawnAi(bin: string, args: string[], env: Record<string, string>, cwd: string): ChildProcess {
  // 一键安装的 Claude Code / Codex 在 AI 用户的 ~/.local/bin；npm 用 Opero 自己的 Node。登录 shell 的 PATH 不一定带这两个，补上
  const wrapper = `export PATH="$HOME/.local/bin:$PATH:${path.dirname(process.execPath)}"; umask 007; exec "$0" "$@"`
  const fullEnv = { ...process.env, ...env } as Record<string, string>
  if (cfg.aiUser) {
    const keep = Object.keys(env)
    return spawn('sudo', ['-n', '-u', cfg.aiUser, '-H', ...(keep.length ? [`--preserve-env=${keep.join(',')}`] : []), '--', 'bash', '-lc', wrapper, bin, ...args],
      { cwd, env: fullEnv, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
  }
  return spawn('bash', ['-lc', wrapper, bin, ...args], { cwd, env: fullEnv, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
}

/** 跑一下拿输出（看版本、测试执行器） */
export function runAi(bin: string, args: string[], opts: { env?: Record<string, string>; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<{ code: number; out: string; ms: number }> {
  const t0 = Date.now()
  return new Promise((resolve) => {
    const p = spawnAi(bin, args, opts.env ?? {}, opts.cwd ?? cfg.work)
    p.stdin!.on('error', () => {})
    let out = ''
    p.stdout!.on('data', (b) => { out += b })
    p.stderr!.on('data', (b) => { out += b })
    p.stdin!.end(opts.input ?? '')
    const t = setTimeout(() => killTree(p), opts.timeoutMs ?? 30_000)
    p.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? -1, out: out.trim(), ms: Date.now() - t0 }) })
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: String(e), ms: Date.now() - t0 }) })
  })
}

function killTree(p: ChildProcess) {
  try { if (p.pid) process.kill(-p.pid, 'SIGTERM') } catch { try { p.kill('SIGTERM') } catch { /* 已经没了 */ } }
  setTimeout(() => { try { if (p.pid) process.kill(-p.pid, 'SIGKILL') } catch { /* 已经没了 */ } }, 5000).unref()
}

const helpCache = new Map<string, boolean>()
async function supportsEffort(): Promise<boolean> {
  if (helpCache.has('effort')) return helpCache.get('effort')!
  const r = await runAi(cfg.claudeBin, ['--help'], { timeoutMs: 20_000 })
  const ok = r.out.includes('--effort')
  helpCache.set('effort', ok)
  return ok
}

// ---------- 员工的工作目录和规矩 ----------
export function empHome(emp: Employee) {
  const d = path.join(cfg.work, 'emp', emp.id)
  fs.mkdirSync(path.join(d, 'uploads'), { recursive: true, mode: 0o2770 })
  return d
}
function cwdOf(emp: Employee): { cwd: string; ws?: Workspace } {
  const ws = emp.workspace ? get<Workspace>('workspaces', emp.workspace) : undefined
  if (ws && fs.existsSync(ws.dir)) return { cwd: ws.dir, ws }
  return { cwd: empHome(emp) }
}

const MODEL_IDS: Record<string, string> = { 'Opus 5.5': 'claude-opus-5-5', 'Sonnet 5.5': 'claude-sonnet-5-5', 'Haiku 5.5': 'claude-haiku-5-5', 'Fable 5.1': 'claude-fable-5-1' }

function rules(emp: Employee, cwd: string, ws?: Workspace) {
  const habits = kvGet<{ habits?: string }>('settings', {}).habits?.trim()
  return [
    `你是 Opero 里的 AI 员工「${emp.name}」${emp.title ? `：${emp.title}` : ''}。主人在手机或电脑上通过聊天和你协作。`,
    emp.prompt?.trim() && `## 你的角色\n${emp.prompt.trim()}`,
    emp.persona?.trim() && `## 说话风格\n${emp.persona.trim()}`,
    habits && `## 主人的习惯（每次都要遵守）\n${habits}`,
    `## 在 Opero 里怎么干活
- 回复像聊天：简短，先给结论；长内容用 Markdown。
- 服务器、数据库、代码仓库、云的账号都在 Opero 的保险箱里，你拿不到，也不要去找、不要让主人发给你。
- 连服务器用 opero 的 server_exec（先 list_servers 看有哪些）；查库用 db_query（先 list_databases）；同步 / 推送代码用 git_sync。
- 要主人在几个方案里选，用 ask_owner；做不可撤销或影响生产的事之前用 confirm；要给主人看结构化的结果用 send_card；要把文件或图片发给主人用 send_file。
- 别的员工更合适的活，用 delegate 转给它（list_employees 看有谁）。
- 共用资料（规范、接口文档、产品说明）先用 kb_search / kb_get 查；值得留给所有员工的，用 kb_save 存进去。
- 工作目录：${cwd}${ws ? `（工作空间「${ws.name}」，仓库 ${ws.repo}，分支 ${ws.branch}）` : '（你自己的目录，可以放笔记和脚本）'}。`,
  ].filter(Boolean).join('\n\n')
}

// ---------- 派活 ----------
export async function send(empId: string, text: string, files: Attachment[] = []): Promise<void> {
  const emp = get<Employee>('employees', empId)
  if (!emp) return
  const wait = booting.get(empId)
  if (wait) {
    wait.push({ text, files })
    system(sessionFor(empId).id, '已插话：员工下一步会看到这句')
    return
  }
  const cur = live.get(empId)
  if (cur) {
    if (cur.kind === 'claude' && cur.stdinOpen) {
      writeUser(cur, text, files)
      system(cur.sid, '已插话：员工下一步会看到这句')
    } else {
      cur.queue.push({ text, files })
      system(cur.sid, '已排队：这一轮做完接着做')
    }
    return
  }
  const budget = kvGet<{ budget?: number; budgetStop?: boolean }>('settings', {})
  if (budget.budgetStop && budget.budget && monthCost() >= budget.budget) {
    const s = sessionFor(empId)
    system(s.id, `这个月的预算（$${budget.budget}）用满了，员工先停下。到「我 → 设置」里调高预算或关掉「用满先停」再试。`)
    return
  }
  start(emp, text, files)
}

function writeUser(l: Live, text: string, files: Attachment[]) {
  const content: any[] = [{ type: 'text', text: withFiles(text, files) }]
  for (const f of files) {
    if (!f.image || !/^image\/(png|jpeg|gif|webp)$/.test(f.mediaType)) continue
    try {
      const data = fs.readFileSync(f.path)
      if (data.length < 5 * 1024 * 1024) content.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType, data: data.toString('base64') } })
    } catch { /* 读不到就只给路径 */ }
  }
  l.proc.stdin!.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n')
  l.pending++
}

const withFiles = (text: string, files: Attachment[]) =>
  files.length ? `${text}\n\n主人发来的文件（可以直接读）：\n${files.map((f) => `- ${f.path}（${f.name}）`).join('\n')}` : text

function start(emp: Employee, text: string, files: Attachment[]) {
  const s = sessionFor(emp.id)
  const kind: 'claude' | 'codex' = /codex/i.test(emp.executor) ? 'codex' : 'claude'
  const { cwd, ws } = cwdOf(emp)
  const runId = uid('r')
  const token = crypto.randomBytes(24).toString('base64url')
  const { env, secrets } = aiEnv(kind)
  const mcpEnv = { OPERO_API: `http://127.0.0.1:${cfg.port}`, OPERO_TOKEN: token }
  const uploads = path.join(empHome(emp), 'uploads')
  const status = addMsg(s.id, { from: 'system', kind: 'status', spinning: true, text: `${emp.name} 在想…` })
  patchSession(s.id, { working: '在想…' })
  byToken.set(token, { emp: emp.id, sid: s.id, runId })
  booting.set(emp.id, [])

  const begin = async () => {
    let proc: ChildProcess
    if (kind === 'claude') {
      const pm = emp.approval === 'plan' ? 'plan' : emp.approval === 'ask' ? 'default' : 'acceptEdits'
      const mcp = { mcpServers: { opero: { command: process.execPath, args: ['--disable-warning=ExperimentalWarning', MCP_SCRIPT], env: mcpEnv } } }
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json',
        '--permission-mode', pm, '--max-turns', String(cfg.maxTurns),
        '--mcp-config', JSON.stringify(mcp), '--permission-prompt-tool', 'mcp__opero__approve', '--allowedTools', 'mcp__opero',
        '--append-system-prompt', rules(emp, cwd, ws), '--add-dir', uploads]
      if (!cfg.aiUser) args.push('--disallowedTools', `Read(/${cfg.data}/**),Edit(/${cfg.data}/**),Write(/${cfg.data}/**)`)
      if (MODEL_IDS[emp.model]) args.push('--model', MODEL_IDS[emp.model])
      if (emp.effort && (await supportsEffort())) args.push('--effort', emp.effort)
      if (emp.resumeId) args.push('--resume', emp.resumeId)
      proc = spawnAi(cfg.claudeBin, args, env, cwd)
    } else {
      const q = (v: string) => JSON.stringify(v)
      const args = ['exec',
        '-c', `mcp_servers.opero.command=${q(process.execPath)}`,
        '-c', `mcp_servers.opero.args=[${q('--disable-warning=ExperimentalWarning')},${q(MCP_SCRIPT)}]`,
        '-c', `mcp_servers.opero.env.OPERO_API=${q(mcpEnv.OPERO_API)}`,
        '-c', `mcp_servers.opero.env.OPERO_TOKEN=${q(token)}`,
        '-c', 'mcp_servers.opero.tool_timeout_sec=1800']
      const imgs = files.filter((f) => f.image).map((f) => f.path)
      if (imgs.length) args.push('--image', imgs.join(','))
      args.push('--json', '--skip-git-repo-check', '-C', cwd)
      if (emp.approval === 'plan') args.push('--sandbox', 'read-only')
      else if (emp.approval === 'auto') args.push('--dangerously-bypass-approvals-and-sandbox')
      else args.push('--sandbox', 'workspace-write')
      const eff = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' }[emp.effort]
      if (eff) args.push('-c', `model_reasoning_effort=${q(eff)}`)
      if (emp.model && emp.model !== '执行器默认') args.push('-m', emp.model)
      if (emp.resumeId) args.push('resume', emp.resumeId)
      args.push('-')
      proc = spawnAi(cfg.codexBin, args, env, cwd)
    }
    const l: Live = { emp: emp.id, sid: s.id, runId, token, kind, proc, stdinOpen: kind === 'claude', pending: 0, queue: [], statusId: status.id,
      said: 0, lastResult: '', stopped: false, cost: 0, tokens: 0, ok: false, stderr: '', secrets }
    live.set(emp.id, l)
    if (stopEarly.delete(emp.id)) { l.stopped = true; killTree(proc) }
    const early = booting.get(emp.id) ?? []
    booting.delete(emp.id)
    proc.stdin!.on('error', () => { l.stdinOpen = false }) // 进程已经退了还往里写：不要把后台带崩
    proc.stderr!.on('data', (b) => { l.stderr = (l.stderr + b).slice(-4000) })
    proc.on('error', (e) => { l.stderr += `\n${e.message}` })
    if (kind === 'claude') {
      writeUser(l, text, files)
      for (const x of early) writeUser(l, x.text, x.files)
    } else {
      const first = emp.resumeId ? withFiles(text, files) : `${rules(emp, cwd, ws)}\n\n---\n\n${withFiles(text, files)}`
      proc.stdin!.end(first)
      l.queue.push(...early)
    }
    const rl = readline.createInterface({ input: proc.stdout! })
    rl.on('line', (line) => {
      if (!line.startsWith('{')) return
      let ev: any
      try { ev = JSON.parse(line) } catch { return }
      try { (kind === 'claude' ? onClaude : onCodex)(l, emp, ev) } catch (e) { console.error('解析执行器输出出错', e) }
    })
    proc.on('close', (code) => finish(l, code))
  }
  begin().catch((e) => {
    booting.delete(emp.id)
    delMsg(status.id)
    patchSession(s.id, { clear: ['working'] })
    byToken.delete(token)
    system(s.id, `没能启动执行器：${(e as Error).message}`)
  })
}

function setStatus(l: Live, text: string) {
  patchMsg(l.statusId, { text })
  patchSession(l.sid, { working: text.slice(0, 40) })
}

function say(l: Live, text: string) {
  const t = scrub(text.trim(), l.secrets)
  if (!t) return
  l.said++
  empSays(l.emp, { kind: 'text', text: t }, t)
}

function toolLine(name: string, input: any): string {
  const pick = input && (input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.server)
  const short = typeof pick === 'string' ? pick.replace(/\s+/g, ' ').slice(0, 80) : ''
  const label: Record<string, string> = { Bash: '在跑命令', Read: '在看', Edit: '在改', Write: '在写', MultiEdit: '在改', Grep: '在搜', Glob: '在找文件', WebFetch: '在看网页', WebSearch: '在搜网页', TodoWrite: '在列计划', Task: '派了个子任务' }
  if (name.startsWith('mcp__opero__')) return `在用 Opero：${name.slice(12)}${short ? ' · ' + short : ''}`
  return `${label[name] ?? `在用 ${name}`}${short ? '：' + short : ''}`
}

function onClaude(l: Live, emp: Employee, ev: any) {
  switch (ev.type) {
    case 'system':
      if (ev.subtype === 'init' && ev.session_id && ev.session_id !== emp.resumeId) saveEmp(emp.id, { resumeId: ev.session_id })
      return
    case 'assistant': {
      const m = ev.message
      const u = m?.usage
      if (u) l.ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      for (const b of m?.content ?? []) {
        if (b.type === 'text') say(l, b.text)
        else if (b.type === 'tool_use') setStatus(l, toolLine(b.name, b.input))
      }
      return
    }
    case 'result': {
      l.cost += Number(ev.total_cost_usd ?? 0)
      const u = ev.usage ?? {}
      l.tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
      l.ok = !ev.is_error
      if (ev.session_id) saveEmp(emp.id, { resumeId: ev.session_id })
      if (l.said === 0 && typeof ev.result === 'string' && ev.result.trim()) say(l, ev.result)
      if (ev.subtype === 'error_max_turns') system(l.sid, `这一轮步数用完了（${ev.num_turns ?? cfg.maxTurns} 步），说「继续」接着做`)
      else if (ev.is_error && ev.subtype !== 'success') system(l.sid, `这一轮出错了：${scrub(String(ev.result ?? ev.subtype ?? ''), l.secrets).slice(0, 500)}`)
      l.said = 0
      l.pending = Math.max(0, l.pending - 1)
      if (l.pending === 0 && l.stdinOpen) { l.stdinOpen = false; l.proc.stdin!.end() }
      else setStatus(l, `${emp.name} 在看你插的话…`)
      return
    }
  }
}

function onCodex(l: Live, emp: Employee, ev: any) {
  switch (ev.type) {
    case 'thread.started':
      if (ev.thread_id) saveEmp(emp.id, { resumeId: ev.thread_id })
      return
    case 'turn.completed': {
      const u = ev.usage ?? {}
      l.tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0)
      l.ctx = u.input_tokens
      l.ok = true
      return
    }
    case 'turn.failed':
      system(l.sid, `这一轮失败了：${scrub(String(ev.error?.message ?? ''), l.secrets).slice(0, 500)}`)
      return
    case 'error':
      if (ev.message) system(l.sid, scrub(String(ev.message), l.secrets).slice(0, 500))
      return
    case 'item.started':
    case 'item.completed': {
      const it = ev.item ?? {}
      const done = ev.type === 'item.completed'
      if (it.type === 'agent_message' && done) say(l, String(it.text ?? ''))
      else if (it.type === 'command_execution' && !done) setStatus(l, toolLine('Bash', { command: it.command }))
      else if (it.type === 'file_change' && done) setStatus(l, `在改：${(it.changes ?? []).map((c: any) => path.basename(String(c.path))).join('、').slice(0, 80)}`)
      else if (it.type === 'mcp_tool_call' && !done) setStatus(l, toolLine(`mcp__${it.server}__${it.tool}`, it.arguments))
      else if (it.type === 'web_search' && !done) setStatus(l, toolLine('WebSearch', { query: it.query }))
      return
    }
  }
}

function saveEmp(id: string, patch: Partial<Employee>) {
  const e = get<Employee>('employees', id)
  if (!e) return
  const next = { ...e, ...patch }
  put('employees', next)
  emit({ t: 'put', coll: 'employees', item: next })
}

function finish(l: Live, code: number | null) {
  live.delete(l.emp)
  setTimeout(() => byToken.delete(l.token), 10_000)
  delMsg(l.statusId)
  patchSession(l.sid, { clear: ['working'] })
  cancelPending(l.runId, '员工这一轮已经结束')
  const emp = get<Employee>('employees', l.emp)
  if (l.ctx && emp) saveEmp(emp.id, { contextUsed: Math.min(100, Math.round((100 * l.ctx) / 200_000)) })
  recordRun(l.runId, l.emp, l.ok && !l.stopped, l.cost, l.tokens)
  if (!l.stopped && !l.ok && code !== 0) {
    const err = scrub(l.stderr.trim(), l.secrets).split('\n').slice(-6).join('\n')
    const hint = /auth|login|api key|401|credential|unauthorized|OAuth/i.test(err) ? '\n\n像是执行器没登录：到「我 → AI 执行器」配 API Key，或者在服务器上用 AI 用户登录一次。'
      : /not found|No such file|command not found/i.test(err) ? '\n\n像是服务器上没装这个执行器：到「我 → AI 执行器」看安装方法。' : ''
    system(l.sid, `执行器退出了（${code}）${err ? '：\n' + err : ''}${hint}`)
    push({ kind: 'info', title: emp?.name ?? '员工', body: '执行器出错了', route: `chat/${l.sid}` })
  }
  const next = l.queue.shift()
  if (next && emp && !l.stopped) {
    const rest = l.queue.splice(0)
    const text = [next, ...rest].map((x) => x.text).join('\n\n')
    start(emp, text, [next, ...rest].flatMap((x) => x.files))
  }
}

export function stop(empId: string): boolean {
  const l = live.get(empId)
  if (!l) {
    if (!booting.has(empId)) return false
    stopEarly.add(empId)
    booting.set(empId, [])
    system(sessionFor(empId).id, '你让员工停下了')
    return true
  }
  l.stopped = true
  l.queue = []
  cancelPending(l.runId, '你让员工停下了')
  killTree(l.proc)
  system(l.sid, '你让员工停下了')
  return true
}

/** 新话题：下一句开一个新的执行器会话（上下文清空）；员工的目录和工作空间都还在 */
export function newTopic(empId: string, note = '—— 新话题：上下文已清空 ——') {
  stop(empId)
  saveEmp(empId, { resumeId: undefined, contextUsed: 0 })
  const s = sessionFor(empId)
  system(s.id, note)
}

// ---------- 等你决定的卡片（审核、提问、确认）：工具在等，网页点了按钮就放行 ----------
export interface PendingAnswer { action: string; answer?: string; verified?: boolean }
const pending = new Map<string, { runId: string; resolve: (a: PendingAnswer) => void }>()

export function waitCard(msgId: string, runId: string, timeoutMs = 30 * 60_000): Promise<PendingAnswer> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      pending.delete(msgId)
      patchMsg(msgId, { card: { ...(getCard(msgId) as any), state: 'done', result: '30 分钟没人点，已当作不同意' } })
      resolve({ action: 'timeout' })
    }, timeoutMs)
    pending.set(msgId, { runId, resolve: (a) => { clearTimeout(t); pending.delete(msgId); resolve(a) } })
  })
}
const getCard = (msgId: string) => getMsg(msgId)?.msg.card
export const answerCard = (msgId: string, a: PendingAnswer) => {
  const p = pending.get(msgId)
  if (!p) return false
  p.resolve(a)
  return true
}
export const isPending = (msgId: string) => pending.has(msgId)

function cancelPending(runId: string, why: string) {
  for (const [id, p] of [...pending]) {
    if (p.runId !== runId) continue
    p.resolve({ action: 'cancel' })
    const c = getCard(id)
    if (c) patchMsg(id, { card: { ...c, state: 'done', result: why } })
  }
}

export function stopAll() { for (const id of [...live.keys()]) { const l = live.get(id)!; l.stopped = true; killTree(l.proc) } }
