// Opero 给 AI 员工的 MCP 工具（经 mcp.ts 转过来）。账号都在 Opero 这边用，AI 只拿到结果。
// 要你决定的（审核、确认、选方案、危险命令、改数据）先在会话里发一张卡片，等你点了再回给 AI。
import fs from 'node:fs'
import path from 'node:path'
import { cfg } from './config.ts'
import { all, get, kvGet, put, uid } from './db.ts'
import { emit } from './bus.ts'
import { addMsg, audit, empSays, patchSession, sessionFor, system } from './chat.ts'
import { DANGER, execOn, isReadOnly } from './ssh.ts'
import { isReadSql, resultText, runQuery } from './dbconn.ts'
import { syncWorkspace } from './git.ts'
import * as runner from './runner.ts'
import type { Card, Credential, DataSource, Employee, KbDoc, Server, Workspace } from './types.ts'
import { isProtected } from './env.ts'

type Run = { emp: string; sid: string; runId: string }
export interface ToolResult { text: string; isError?: boolean }

const S = (props: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: props, required })
const str = (description: string) => ({ type: 'string', description })

export const TOOLS = [
  { name: 'approve', description: 'Permission check used by Claude Code before running a tool (internal).', inputSchema: S({ tool_name: { type: 'string' }, input: { type: 'object' } }) },
  { name: 'list_servers', description: 'List the servers the owner connected to Opero (name, environment, OS, online, CPU/memory/disk). No credentials.', inputSchema: S({}) },
  { name: 'server_exec', description: 'Run a shell command on one of the owner\'s servers through Opero (Opero holds the SSH credentials; you only get the output). Read-only commands run right away; anything that changes the server may need the owner to approve a card first. Always say why.', inputSchema: S({ server: str('server name or id from list_servers'), command: str('shell command'), reason: str('one line: why you need this') }, ['server', 'command', 'reason']) },
  { name: 'list_databases', description: 'List the databases the owner connected (name, MySQL/PostgreSQL, environment, writable, tables).', inputSchema: S({}) },
  { name: 'db_query', description: 'Run SQL on one of the owner\'s databases through Opero. SELECT/SHOW/EXPLAIN run in a read-only transaction (15 s timeout, 200 rows max, sensitive columns masked). Writes only on databases marked writable and always need the owner to approve.', inputSchema: S({ database: str('database name or id from list_databases'), sql: str('one SQL statement'), reason: str('one line: why') }, ['database', 'sql', 'reason']) },
  { name: 'git_sync', description: 'Fetch the latest code of your workspace from its Git remote with the owner\'s token (you cannot fetch/pull/push yourself), optionally rebase onto it and push your commits. Commit first if you want to push.', inputSchema: S({ workspace: str('workspace name or id (default: yours)'), rebase: { type: 'boolean', description: 'rebase current branch onto its upstream (default true, only when clean)' }, push: { type: 'boolean', description: 'push HEAD to origin (default false)' } }) },
  { name: 'ask_owner', description: 'Ask the owner to pick one of a few options (shown as a card in the chat). Waits for the answer (up to 30 minutes) and returns the chosen option.', inputSchema: S({ question: str('the question'), options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 }, recommend: { type: 'integer', description: 'index of the option you recommend' } }, ['question', 'options']) },
  { name: 'confirm', description: 'Ask the owner to approve something irreversible or production-affecting before you do it (a card with the details). Waits for the answer and returns approved / denied.', inputSchema: S({ title: str('what you want to do, short'), detail: str('the exact command / change'), why: str('why, and what could go wrong'), danger: { type: 'boolean', description: 'true = the owner must verify identity' } }, ['title', 'detail', 'why']) },
  { name: 'send_card', description: 'Post a structured card to the owner (title, optional tag, key/value rows, optional buttons). Does not wait; if the owner taps a button you receive it as a new message.', inputSchema: S({ title: str('title'), tag: str('small tag, e.g. 已完成 / 要你看'), rows: { type: 'array', items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 } }, buttons: { type: 'array', items: { type: 'string' }, maxItems: 3 } }, ['title']) },
  { name: 'send_file', description: 'Send a file or image from your working directory to the owner in the chat.', inputSchema: S({ path: str('absolute path'), name: str('display name (optional)') }, ['path']) },
  { name: 'kb_search', description: 'Search the shared knowledge base (specs, API docs, product notes, conventions) that all employees use. Returns matching docs with a snippet.', inputSchema: S({ query: str('words to look for') }, ['query']) },
  { name: 'kb_get', description: 'Read one knowledge-base doc in full.', inputSchema: S({ id: str('doc id or exact name') }, ['id']) },
  { name: 'kb_save', description: 'Add or update a knowledge-base doc (by name) so every employee can use it.', inputSchema: S({ name: str('doc name'), kind: { type: 'string', enum: ['产品说明', '接口文档', '客户信息', '规范', '其它'] }, summary: str('one line'), body: str('markdown') }, ['name', 'body']) },
  { name: 'list_employees', description: 'List the other AI employees (id, name, role) you can delegate to.', inputSchema: S({}) },
  { name: 'delegate', description: 'Hand a task to another employee. It shows up in that employee\'s chat and it starts working on it.', inputSchema: S({ employee: str('employee id or name'), message: str('the task, with all context it needs') }, ['employee', 'message']) },
]

const RO_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'TodoWrite', 'TodoRead', 'NotebookRead', 'Task', 'BashOutput', 'KillShell', 'ExitPlanMode', 'ListMcpResourcesTool', 'ReadMcpResourceTool'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

const ok = (text: string): ToolResult => ({ text })
const fail = (text: string): ToolResult => ({ text, isError: true })

export async function callTool(run: Run, name: string, args: any): Promise<ToolResult> {
  const emp = get<Employee>('employees', run.emp)
  if (!emp) return fail('员工不在了')
  args = args ?? {}
  switch (name) {
    case 'approve': return approve(run, emp, args)
    case 'list_servers': return ok(JSON.stringify(all<Server>('servers').map((s) => ({ id: s.id, name: s.name, env: s.env, os: s.os, online: s.online, cpu: s.cpu, mem: s.mem, disk: s.disk })), null, 1))
    case 'server_exec': return serverExec(run, emp, args)
    case 'list_databases': return ok(JSON.stringify(all<DataSource>('dataSources').map((d) => ({ id: d.id, name: d.name, kind: d.kind, env: d.env, db: d.db, writable: d.writable, tables: d.tables.map((t) => `${t.name}(${t.cols.join(',')})`) })), null, 1))
    case 'db_query': return dbQuery(run, emp, args)
    case 'git_sync': return gitSync(emp, args)
    case 'ask_owner': return askOwner(run, emp, args)
    case 'confirm': {
      const a = await confirmCard(run, emp, { title: String(args.title ?? ''), detail: String(args.detail ?? ''), why: String(args.why ?? ''), danger: !!args.danger })
      return ok(a ? 'approved' : 'denied')
    }
    case 'send_card': return sendCard(emp, args)
    case 'send_file': return sendFile(emp, args)
    case 'kb_search': return kbSearch(String(args.query ?? ''))
    case 'kb_get': {
      const d = findKb(String(args.id ?? ''))
      return d ? ok(`# ${d.name}\n\n${d.body ?? d.summary}`) : fail('没有这份资料')
    }
    case 'kb_save': return kbSave(emp, args)
    case 'list_employees': return ok(JSON.stringify(all<Employee>('employees').filter((e) => e.id !== emp.id).map((e) => ({ id: e.id, name: e.name, title: e.title, working: runner.isWorking(e.id) })), null, 1))
    case 'delegate': return delegate(emp, args)
  }
  return fail(`没有这个工具：${name}`)
}

// ---------- 审核（Claude Code 每次要用工具前问一下） ----------
async function approve(run: Run, emp: Employee, a: { tool_name?: string; input?: any }): Promise<ToolResult> {
  const tool = String(a.tool_name ?? '')
  const input = a.input ?? {}
  const allow = ok(JSON.stringify({ behavior: 'allow', updatedInput: input }))
  const deny = (message: string) => ok(JSON.stringify({ behavior: 'deny', message }))
  if (tool.startsWith('mcp__opero__')) return allow
  const touchesData = JSON.stringify(input).includes(cfg.data)
  if (touchesData) return deny('这是 Opero 自己的数据目录（里面有保险箱），不能碰。要用账号请用 opero 的工具。')
  if (emp.approval === 'plan') return RO_TOOLS.has(tool) ? allow : deny('现在是「只看不改」：只能读和分析，把方案写出来给主人。')
  const cmd = tool === 'Bash' ? String(input.command ?? '') : ''
  const danger = DANGER.test(cmd)
  if (!danger) {
    if (emp.approval === 'auto' || RO_TOOLS.has(tool)) return allow
    if (emp.approval === 'edits' && (EDIT_TOOLS.has(tool) || (tool === 'Bash' && isReadOnly(cmd)))) return allow
  }
  const summary = cmd || String(input.file_path ?? input.path ?? input.url ?? JSON.stringify(input)).slice(0, 600)
  const verb = tool === 'Bash' ? '跑命令' : EDIT_TOOLS.has(tool) ? '改文件' : `用 ${tool}`
  const yes = await confirmCard(run, emp, {
    title: danger ? `危险命令：${verb}` : `要${verb}`, detail: summary,
    why: danger ? '这条命令可能删数据或让服务器停掉，确认是你要的再点' : `审核方式是「${emp.approval === 'ask' ? '每一步都问' : '改文件自动，跑命令要问'}」`, danger,
  })
  return yes ? allow : deny('主人没同意，换个办法或者问问主人')
}

export async function confirmCard(run: Run, emp: Employee, o: { title: string; detail: string; why: string; danger?: boolean; note?: string }): Promise<boolean> {
  const card: Card = {
    id: uid('c'), type: 'confirm', v: 1, state: 'open', level: o.danger ? 'danger' : 'warn',
    data: { title: o.title, tag: o.danger ? '危险' : '要你确认', detail: o.detail, why: o.why, note: o.note ?? '', pending: true },
    actions: [{ id: 'deny', label: '不行', style: 'ghost' }, { id: 'allow', label: o.danger ? '确认执行' : '同意', style: o.danger ? 'danger' : 'primary' }],
  }
  const m = empSays(emp.id, { kind: 'card', card }, `要你确认：${o.title}`, true)
  const a = await runner.waitCard(m.id, run.runId)
  patchSession(run.sid, { clear: ['waiting'] })
  const yes = a.action === 'allow'
  audit({ via: emp.name, action: 'confirm', target: `${o.title} · ${o.detail.slice(0, 80)}`, level: o.danger ? '危险' : '写', result: yes ? '成功' : '拒绝', how: yes ? (a.verified ? '本人验证后同意' : '本人点「同意」') : a.action === 'deny' ? '本人点「不行」' : '没人点 / 已停下' })
  return yes
}

async function askOwner(run: Run, emp: Employee, a: { question?: string; options?: string[]; recommend?: number }): Promise<ToolResult> {
  const options = (a.options ?? []).map(String).slice(0, 6)
  if (options.length < 2) return fail('至少给两个选项')
  const card: Card = { id: uid('c'), type: 'ask', v: 1, state: 'open', level: 'info', data: { title: String(a.question ?? ''), options, recommend: a.recommend ?? 0, pending: true }, actions: [{ id: 'ok', label: '就这样', style: 'primary' }] }
  const m = empSays(emp.id, { kind: 'card', card }, `要你选：${card.data.title}`, true)
  const r = await runner.waitCard(m.id, run.runId)
  patchSession(run.sid, { clear: ['waiting'] })
  return r.action === 'ok' && r.answer ? ok(`主人选了：${r.answer}`) : fail('主人没选（超时或已停下）')
}

function sendCard(emp: Employee, a: { title?: string; tag?: string; rows?: string[][]; buttons?: string[] }): ToolResult {
  const card: Card = {
    id: uid('c'), type: 'generic', v: 1, state: 'open', level: 'info',
    data: { title: String(a.title ?? ''), tag: a.tag, rows: (a.rows ?? []).filter((r) => Array.isArray(r) && r.length === 2).map((r) => [String(r[0]), String(r[1])]) },
    actions: (a.buttons ?? []).slice(0, 3).map((label, i) => ({ id: `b${i}`, label: String(label), style: i === 0 ? 'primary' : 'default', tool: 'card.reply' })),
  }
  empSays(emp.id, { kind: 'card', card }, card.data.title, !!card.actions.length && /要你|等你/.test(card.data.tag ?? ''))
  return ok('已发给主人')
}

function sendFile(emp: Employee, a: { path?: string; name?: string }): ToolResult {
  const p = path.resolve(String(a.path ?? ''))
  if (p.startsWith(cfg.data)) return fail('不能发这个目录里的文件')
  let st: fs.Stats
  try { st = fs.statSync(p) } catch { return fail('文件不存在或读不到') }
  if (!st.isFile() || st.size > 30 * 1024 * 1024) return fail('只能发 30 MB 以内的文件')
  const id = uid('f')
  const name = String(a.name || path.basename(p))
  fs.copyFileSync(p, path.join(cfg.data, 'files', id))
  const ext = (name.split('.').pop() ?? 'file').toUpperCase().slice(0, 4)
  const image = /^(PNG|JPG|JPEG|GIF|WEBP)$/.test(ext)
  empSays(emp.id, { kind: 'file', file: { name, size: fmtSize(st.size), ext, image, url: `/api/files/${id}?name=${encodeURIComponent(name)}` } }, image ? '[图片]' : `[文件] ${name}`)
  return ok('已发给主人')
}
export const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

// ---------- 服务器 ----------
const findServer = (k: string) => all<Server>('servers').find((s) => s.id === k || s.name === k || s.ip === k)

async function serverExec(run: Run, emp: Employee, a: { server?: string; command?: string; reason?: string }): Promise<ToolResult> {
  const sv = findServer(String(a.server ?? ''))
  if (!sv) return fail('没有这台服务器（用 list_servers 看名字）')
  const command = String(a.command ?? '').trim()
  if (!command) return fail('命令是空的')
  const cred = sv.credential ? get<Credential>('credentials', sv.credential) : undefined
  if (cred && !cred.aiAllowed) return fail('这台服务器的账号设成了「只有主人本人能用」，员工不能用')
  const ro = isReadOnly(command)
  const danger = DANGER.test(command)
  // 这台自己设过就按它；没设过 = 像生产的标签 + 「我 → 设置」的生产保护开着
  const prod = sv.protect ?? (isProtected(sv) && !!kvGet<{ prodProtect?: boolean }>('settings', {}).prodProtect)
  if (emp.approval === 'plan' && !ro) return fail('现在是「只看不改」，只能跑只读命令')
  if (danger || (!ro && (emp.approval !== 'auto' || prod))) {
    const yes = await confirmCard(run, emp, { title: `在 ${sv.name}（${sv.env}）上执行`, detail: command, why: String(a.reason ?? ''), danger: danger || isProtected(sv) })
    if (!yes) return fail('主人没同意')
  }
  const r = await execOn(sv, command, 120_000)
  audit({ via: emp.name, action: 'server.exec', target: `${sv.name} · ${command.slice(0, 100)}`, level: ro ? '读' : danger ? '危险' : '写', result: r.code === 0 ? '成功' : '失败', how: ro ? '只读命令，直接跑' : '写命令' })
  const out = r.out.length > 30_000 ? r.out.slice(0, 12_000) + '\n…（中间省略）…\n' + r.out.slice(-12_000) : r.out
  return { text: `[退出码 ${r.code} · ${r.ms} ms]\n${out}`, isError: r.code !== 0 }
}

// ---------- 数据库 ----------
async function dbQuery(run: Run, emp: Employee, a: { database?: string; sql?: string; reason?: string }): Promise<ToolResult> {
  const k = String(a.database ?? '')
  const ds = all<DataSource>('dataSources').find((d) => d.id === k || d.name === k || d.db === k)
  if (!ds) return fail('没有这个库（用 list_databases 看名字）')
  const sql = String(a.sql ?? '').trim()
  const cred = ds.credential ? get<Credential>('credentials', ds.credential) : undefined
  if (cred && !cred.aiAllowed) return fail('这个库的账号设成了「只有主人本人能用」')
  const read = isReadSql(sql)
  if (!read) {
    if (!ds.writable) return fail('这个库只接了只读账号，不能改数据')
    if (emp.approval === 'plan') return fail('现在是「只看不改」')
    const danger = /\b(drop|truncate|alter)\b/i.test(sql) || (/^\s*(delete|update)\b/i.test(sql) && !/\bwhere\b/i.test(sql))
    const yes = await confirmCard(run, emp, { title: `改 ${ds.name}（${ds.env}）的数据`, detail: sql, why: String(a.reason ?? ''), danger: danger || isProtected(ds), note: '改之前没有自动快照，确认 SQL 没问题再点' })
    if (!yes) return fail('主人没同意')
  }
  try {
    const r = await runQuery(ds, sql, { write: !read })
    audit({ via: emp.name, action: read ? 'db.query' : 'db.exec', target: `${ds.name} · ${sql.slice(0, 100)}`, level: read ? '读' : '写', result: '成功', how: read ? '只读事务' : '本人同意后执行' })
    return ok(resultText(r))
  } catch (e) {
    audit({ via: emp.name, action: read ? 'db.query' : 'db.exec', target: `${ds.name} · ${sql.slice(0, 100)}`, level: read ? '读' : '写', result: '失败', how: (e as Error).message.slice(0, 80) })
    return fail(`出错了：${(e as Error).message}`)
  }
}

// ---------- 代码 ----------
async function gitSync(emp: Employee, a: { workspace?: string; rebase?: boolean; push?: boolean }): Promise<ToolResult> {
  const k = String(a.workspace ?? '') || emp.workspace
  const w = all<Workspace>('workspaces').find((x) => x.id === k || x.name === k)
  if (!w) return fail('没有这个工作空间')
  const out = await syncWorkspace(w, { rebase: a.rebase, push: a.push })
  audit({ via: emp.name, action: a.push ? 'git.push' : 'git.sync', target: w.name, level: a.push ? '写' : '读', result: /失败/.test(out) ? '失败' : '成功', how: '用主人的令牌' })
  return { text: out, isError: /失败/.test(out) }
}

// ---------- 知识库 ----------
const findKb = (k: string) => all<KbDoc>('kb').find((d) => d.id === k || d.name === k)
function kbSearch(q: string): ToolResult {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const docs = all<KbDoc>('kb').map((d) => {
    const text = `${d.name}\n${d.summary}\n${d.body ?? ''}`.toLowerCase()
    const score = words.reduce((n, w) => n + (text.split(w).length - 1), 0)
    const i = words.length ? text.indexOf(words[0]) : 0
    return { d, score, snippet: (d.body ?? d.summary).slice(Math.max(0, i - 80), i + 220) }
  }).filter((x) => x.score > 0 || !words.length).sort((a, b) => b.score - a.score).slice(0, 8)
  if (!docs.length) return ok('没找到相关资料')
  return ok(docs.map((x) => `## ${x.d.name}（id ${x.d.id} · ${x.d.kind}）\n${x.snippet}`).join('\n\n'))
}
function kbSave(emp: Employee, a: { name?: string; kind?: string; summary?: string; body?: string }): ToolResult {
  const name = String(a.name ?? '').trim()
  if (!name) return fail('要有名字')
  const old = findKb(name)
  const d: KbDoc = { id: old?.id ?? uid('kb'), name, kind: a.kind ?? old?.kind ?? '其它', summary: String(a.summary ?? old?.summary ?? '').slice(0, 120), body: String(a.body ?? ''), updated: new Date().toLocaleDateString('zh-CN'), by: emp.name }
  put('kb', d)
  emit({ t: 'put', coll: 'kb', item: d })
  audit({ via: emp.name, action: old ? 'kb.update' : 'kb.add', target: name, level: '写', result: '成功', how: '员工整理' })
  return ok(old ? '已更新' : '已加进知识库')
}

// ---------- 转给别的员工 ----------
function delegate(from: Employee, a: { employee?: string; message?: string }): ToolResult {
  const k = String(a.employee ?? '')
  const to = all<Employee>('employees').find((e) => e.id === k || e.name === k)
  if (!to) return fail('没有这个员工（用 list_employees 看）')
  if (to.id === from.id) return fail('不能转给自己')
  const msg = String(a.message ?? '').trim()
  const s = sessionFor(to.id)
  system(s.id, `「${from.name}」转来：${msg.slice(0, 200)}`)
  patchSession(s.id, { last: `「${from.name}」转来的活`, unread: 1 })
  runner.send(to.id, `「${from.name}」转给你的活：\n\n${msg}\n\n做完如果「${from.name}」需要结果，用 delegate 转回给它。`)
  addMsg(sessionFor(from.id).id, { from: 'system', kind: 'system', text: `已转给「${to.name}」` })
  return ok(`已转给「${to.name}」，它开始做了`)
}
