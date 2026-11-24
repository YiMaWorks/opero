// Opero 给 AI 员工的 MCP 工具（经 mcp.ts 转过来）。账号都在 Opero 这边用，AI 只拿到结果。
// 要你决定的（审核、确认、选方案、危险命令、改数据）先在会话里发一张卡片，等你点了再回给 AI。
import fs from 'node:fs'
import path from 'node:path'
import { cfg } from './config.ts'
import { all, db, get, kvGet, kvSet, put, uid } from './db.ts'
import { emit } from './bus.ts'
import { addMsg, audit, empSays, patchSession, sessionFor, system } from './chat.ts'
import { DANGER, execOn, isReadOnly } from './ssh.ts'
import { isReadSql, resultText, runQuery } from './dbconn.ts'
import { git, syncWorkspace } from './git.ts'
import * as runner from './runner.ts'
import type { Card, Credential, DataSource, Employee, KbDoc, Release, Server, Workspace } from './types.ts'
import { isProtected } from './env.ts'
import { checkCommand, policyOf } from './policy.ts'
import { buildScan } from './logscan.ts'
import * as issues from './issues.ts'
import * as releases from './releases.ts'
import { signFile } from './signing.ts'
import { providerName } from './build.ts'
import * as prs from './prs.ts'
import * as dns from './dns.ts'
import * as inbox from './inbox.ts'
import { fillSecrets } from './secrets.ts'
import { getSecret, scrub } from './vault.ts'

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
  { name: 'log_scan', description: 'Analyse logs on a server without dumping them. mode: hist = matching lines per minute/10 min/hour (when did it start, is it still happening); first = first occurrences with following lines (stack traces); last = latest occurrences; top = error kinds and failing lines, counted (numbers/ids folded); grep = matching lines. Default pattern matches ERROR/Exception/FATAL/Traceback. Read-only.', inputSchema: S({ server: str('server name or id'), file: str('absolute log file path (may contain *)'), service: str('or a systemd service name (journalctl)'), mode: { type: 'string', enum: ['top', 'hist', 'first', 'last', 'grep'] }, grep: str('extended regex to match (optional)'), since_min: { type: 'integer', description: 'journalctl only: last N minutes (default 60)' }, bucket: { type: 'string', enum: ['1m', '10m', '1h'] }, limit: { type: 'integer' }, before: { type: 'integer' }, after: { type: 'integer' }, rotated: { type: 'boolean', description: 'also read rotated files (.1, .gz)' } }, ['server']) },
  { name: 'file_write', description: 'Write a file on one of the owner\'s servers (config files etc.). The old file is backed up next to it first (<path>.bak-<time>). Always needs the owner to approve a card. Use {{secret:<credential name>}} for passwords/keys — Opero fills them in, you never see them.', inputSchema: S({ server: str('server name or id'), path: str('absolute path'), content: str('full new content'), reason: str('one line: why') }, ['server', 'path', 'content', 'reason']) },
  { name: 'list_credentials', description: 'List the credentials the owner allowed employees to use (names only, never values). Put {{secret:<name>}} in a server_exec command or file_write content and Opero fills in the value; output is masked.', inputSchema: S({}) },
  { name: 'issue_list', description: 'List the issue list (production problems found in logs): id, title, status new/fixing/fixed/known/ignored, severity, count, where.', inputSchema: S({ status: { type: 'string', enum: ['new', 'fixing', 'fixed', 'known', 'ignored'] } }) },
  { name: 'issue_report', description: 'Record a production problem you found (e.g. with log_scan) in the issue list. Same key = same problem: the count goes up instead of a new entry. A new high-severity problem is shown to the owner as a card (fix / known / ignore). Report each distinct problem once per scan.', inputSchema: S({ title: str('short title, e.g. "支付回调签名失败"'), key: str('stable identity: exception type + failing class/line'), severity: { type: 'string', enum: ['high', 'mid', 'low'] }, server: str('server name or id'), workspace: str('workspace (project) name or id, if known'), sample: str('a short log sample / stack trace'), cause: str('likely cause, if you know'), count: { type: 'integer', description: 'occurrences seen in this scan' } }, ['title', 'key', 'severity']) },
  { name: 'issue_update', description: 'Update an issue: mark fixed after you fixed and verified it, add the cause, or reopen.', inputSchema: S({ id: str('issue id'), status: { type: 'string', enum: ['fixed', 'known', 'new'] }, cause: str('root cause'), note: str('short note') }, ['id']) },
  { name: 'emp_create', description: 'Create a new AI employee (only if your profile allows managing employees). The owner approves a card first. Machines, databases and credentials are never granted here — the owner does that.', inputSchema: S({ name: str('display name'), title: str('one-line role'), prompt: str('full role / rules prompt'), persona: str('personality / speaking style (optional)'), executor: { type: 'string', enum: ['Claude Code', 'Codex'] }, workspace: str('workspace name or id it works in (optional)'), host: str('server name or id to run on (optional, default: Opero itself)') }, ['name', 'title', 'prompt']) },
  { name: 'emp_update', description: 'Change another employee\'s title / role prompt / persona / workspace (only if your profile allows managing employees). The owner approves a card first. Its memory repo role section is rewritten on its next run.', inputSchema: S({ employee: str('employee id or name'), title: str('new one-line role'), prompt: str('new role prompt'), persona: str('new personality'), workspace: str('workspace name or id, or empty for its own folder') }, ['employee']) },
  { name: 'pr_create', description: 'Open a pull / merge request from the branch you work on into the workspace main branch (GitHub, GitLab, Gitee, Codeup). Opero pushes your branch first. Commit your work before calling.', inputSchema: S({ title: str('PR title'), body: str('what changed, how to test'), workspace: str('workspace (default: yours)'), target: str('target branch (default: the workspace branch)') }, ['title']) },
  { name: 'pr_status', description: 'Check a pull / merge request you opened: open / merged / closed, and whether it has conflicts. Without id: your latest ones.', inputSchema: S({ id: str('PR number / id (optional)') }) },
  { name: 'dns_list', description: 'DNS: without domain, list the domains you may change; with a domain, list its records (id, rr, type, value, ttl).', inputSchema: S({ domain: str('domain, e.g. example.com (optional)') }) },
  { name: 'dns_set', description: 'Add or update a DNS record (same rr + type is updated). Check the current records first with dns_list; after changing, verify with dig. Only domains the owner granted you.', inputSchema: S({ domain: str('domain'), rr: str('host record: @ for the root, www, api, *.app …'), type: { type: 'string', enum: ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA'] }, value: str('record value'), ttl: { type: 'integer', description: 'seconds (Aliyun: 600/1800/3600/43200/86400)' }, priority: { type: 'integer', description: 'MX only' }, why: str('one line: why') }, ['domain', 'rr', 'type', 'value', 'why']) },
  { name: 'dns_delete', description: 'Delete a DNS record by id (dns_list shows ids). Only domains the owner granted you.', inputSchema: S({ domain: str('domain'), id: str('record id'), why: str('one line: why') }, ['domain', 'id', 'why']) },
  { name: 'sign_package', description: 'Sign an .apk / .aab in your working directory with one of the owner\'s signing certificates (you never see the keystore or passwords). Without arguments: list the certificates you may use. Writes <name>-signed.apk next to it.', inputSchema: S({ path: str('absolute path of the apk / aab (inside your workspace)'), cert: str('certificate name') }) },
  { name: 'inbox_list', description: 'List the owner\'s inbox (email and Slack collected by Opero): id, from, where, summary, category need / fyi / skip, done. Default: things that need the owner and are not done.', inputSchema: S({ cat: { type: 'string', enum: ['open', 'need', 'fyi', 'skip', 'all'] } }) },
  { name: 'inbox_get', description: 'Read one inbox item in full (email body is fetched from the mailbox).', inputSchema: S({ id: str('inbox item id') }, ['id']) },
  { name: 'inbox_draft', description: 'Save a reply draft for an inbox item (in the sender\'s language, plus the Chinese meaning). The owner copies and sends it — you can never send.', inputSchema: S({ id: str('inbox item id'), text: str('the draft') }, ['id', 'text']) },
  { name: 'release_list', description: 'List the release targets of the workspaces (name, servers, whether build/sign/health check is set, your release permission auto/ask/off) and their latest releases.', inputSchema: S({ workspace: str('workspace name or id (optional)') }) },
  { name: 'release_publish', description: 'Release a workspace to one of its targets: Opero takes the latest commit on the remote branch, builds / signs if configured, deploys, health-checks, and rolls back automatically on failure. Push your code first. Permission per target: auto = goes right away, ask = the owner approves a card, off = refused. Returns right away; progress shows as a card. If an auto release fails you get the reason back to fix it.', inputSchema: S({ workspace: str('workspace name or id (default: yours)'), target: str('release target name'), note: str('what is in this release'), reason: str('one line: why now') }, ['target', 'reason']) },
  { name: 'release_status', description: 'Show recent releases (or one by id): steps, error, and the last part of the build / deploy output.', inputSchema: S({ id: str('release id (optional)'), workspace: str('workspace name or id (optional)') }) },
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
    case 'log_scan': return logScan(emp, args)
    case 'file_write': return fileWrite(run, emp, args)
    case 'list_credentials': return ok(JSON.stringify(all<Credential>('credentials').filter((c) => c.aiAllowed).map((c) => ({ name: c.name, group: c.group, kind: c.kind, env: c.env, scope: c.scope })), null, 1))
    case 'issue_list': return ok(JSON.stringify(issues.list({ status: args.status }).slice(0, 50).map(issues.summary), null, 1))
    case 'issue_report': try { const r = issues.report(emp, args); return ok(r.isNew ? `已记下（${r.issue.id}）${r.issue.severity === 'high' ? '，已发卡片给主人' : ''}` : `已有这个问题（${r.issue.id}），次数加到 ${r.issue.count}`) } catch (e) { return fail((e as Error).message) }
    case 'issue_update': try { const i = issues.update(emp, args); return ok(`已更新：${i.title} → ${i.status}`) } catch (e) { return fail((e as Error).message) }
    case 'emp_create': return empCreate(run, emp, args)
    case 'emp_update': return empUpdate(run, emp, args)
    case 'sign_package': return signPackage(emp, args)
    case 'inbox_list': return ok(JSON.stringify(inbox.list({ cat: args.cat === 'all' ? undefined : (args.cat ?? 'open'), limit: 100 }).slice(0, 60).map((i) => ({ id: i.id, from: i.from, where: i.subject, summary: i.summary ?? i.snippet.slice(0, 120), cat: i.cat ?? '未分', done: !!i.done, at: new Date(i.at).toLocaleString('zh-CN') })), null, 1))
    case 'inbox_get': {
      const i = inbox.getItem(String(args.id ?? ''))
      if (!i) return fail('没有这条')
      let body = i.snippet
      if (i.kind === 'email') { try { body = await inbox.emailBody(i) } catch { /* 用摘要 */ } }
      return ok(`来自：${i.from}${i.fromAddr ? ` <${i.fromAddr}>` : ''}\n在：${i.subject}\n时间：${new Date(i.at).toLocaleString('zh-CN')}${i.url ? `\n原消息：${i.url}` : ''}\n\n${body}`)
    }
    case 'inbox_draft': {
      const i = inbox.getItem(String(args.id ?? ''))
      if (!i) return fail('没有这条')
      inbox.mark(i.id, {})
      db.prepare('UPDATE inbox SET data = ? WHERE id = ?').run(JSON.stringify({ ...i, draft: String(args.text ?? '').slice(0, 8000) }), i.id)
      emit({ t: 'inbox', item: { ...i, draft: String(args.text ?? '').slice(0, 8000) } })
      return ok('草稿已存，主人在收件箱里能看到、复制去发')
    }
    case 'dns_list': return dnsList(emp, args)
    case 'dns_set': return dnsSet(run, emp, args)
    case 'dns_delete': return dnsDelete(run, emp, args)
    case 'pr_create': return prCreate(emp, args)
    case 'pr_status': return prStatus(emp, args)
    case 'release_list': case 'list_deploys': return releaseList(args)
    case 'release_publish': case 'deploy': return releasePublish(run, emp, args)
    case 'release_status': return releaseStatus(args)
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
  // 只读参考的项目：不许改（读可以）
  const ro = runner.readDirsOf(emp)
  const target = String(input.file_path ?? input.notebook_path ?? input.path ?? '')
  const hit = ro.find((r) => (EDIT_TOOLS.has(tool) && target.startsWith(r.dir)) || (tool === 'Bash' && String(input.command ?? '').includes(r.dir) && !isReadOnly(String(input.command ?? ''))))
  if (hit) return deny(`「${hit.name}」只给你看，不能改：要改告诉主人交给负责它的员工`)
  // 这台机器的规矩（服务器详情「给员工的规矩」）
  const banned = cmd && checkCommand(cmd, policyOf(get<Server>('servers', runner.hostOf(emp))))
  if (banned) {
    audit({ via: emp.name, action: 'policy.deny', target: cmd.slice(0, 120), level: '写', result: '拒绝', how: banned })
    return deny(`${banned}（这台机器的规矩）`)
  }
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
  empSays(emp.id, { kind: 'file', file: { name, size: fmtSize(st.size), ext, image, url: `api/files/${id}?name=${encodeURIComponent(name)}` } }, image ? '[图片]' : `[文件] ${name}`)
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
  const banned = checkCommand(command, policyOf(sv), { hard: false })
  if (banned) return fail(`${banned}（${sv.name} 的规矩）`)
  const filled = fillSecrets(command)
  if ('error' in filled) return fail(filled.error)
  if (danger || (!ro && (emp.approval !== 'auto' || prod))) {
    const yes = await confirmCard(run, emp, { title: `在 ${sv.name}（${sv.env}）上执行`, detail: command, why: String(a.reason ?? ''), danger: danger || isProtected(sv) })
    if (!yes) return fail('主人没同意')
  }
  const r = await execOn(sv, filled.text, 120_000)
  r.out = scrub(r.out, filled.secrets)
  audit({ via: emp.name, action: 'server.exec', target: `${sv.name} · ${command.slice(0, 100)}`, level: ro ? '读' : danger ? '危险' : '写', result: r.code === 0 ? '成功' : '失败', how: ro ? '只读命令，直接跑' : '写命令' })
  const out = r.out.length > 30_000 ? r.out.slice(0, 12_000) + '\n…（中间省略）…\n' + r.out.slice(-12_000) : r.out
  return { text: `[退出码 ${r.code} · ${r.ms} ms]\n${out}`, isError: r.code !== 0 }
}

async function logScan(emp: Employee, a: any): Promise<ToolResult> {
  const sv = findServer(String(a.server ?? ''))
  if (!sv) return fail('没有这台服务器（用 list_servers 看名字）')
  let cmd: string
  try { cmd = buildScan({ ...a, sinceMin: a.since_min }) } catch (e) { return fail((e as Error).message) }
  const r = await execOn(sv, cmd, 90_000)
  audit({ via: emp.name, action: 'log.scan', target: `${sv.name} · ${a.file ?? a.service} · ${a.mode ?? 'top'}`, level: '读', result: r.code === 0 || r.code === 1 ? '成功' : '失败', how: '只读' })
  const out = r.out.length > 30_000 ? r.out.slice(0, 12_000) + '\n…（中间省略）…\n' + r.out.slice(-12_000) : r.out
  return ok(out.trim() ? out : '没有匹配的行')
}

async function fileWrite(run: Run, emp: Employee, a: { server?: string; path?: string; content?: string; reason?: string }): Promise<ToolResult> {
  const sv = findServer(String(a.server ?? ''))
  if (!sv) return fail('没有这台服务器（用 list_servers 看名字）')
  const p = String(a.path ?? '')
  if (!/^\/[\w./@+-]+$/.test(p) || p.includes('..')) return fail('路径要是绝对路径（字母、数字、. _ - /）')
  const content = String(a.content ?? '')
  if (content.length > 200_000) return fail('一次最多写 200 KB')
  if (emp.approval === 'plan') return fail('现在是「只看不改」')
  const filled = fillSecrets(content)
  if ('error' in filled) return fail(filled.error)
  const yes = await confirmCard(run, emp, { title: `改 ${sv.name} 上的文件`, detail: `${p}\n\n${content.slice(0, 1500)}${content.length > 1500 ? '\n…' : ''}`, why: String(a.reason ?? ''), danger: isProtected(sv), note: '原文件会先备份成 .bak-时间' })
  if (!yes) return fail('主人没同意')
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const b64 = Buffer.from(filled.text).toString('base64')
  const cmd = `set -e; if [ -e '${p}' ]; then cp -a '${p}' '${p}.bak-${ts}'; echo "已备份 ${p}.bak-${ts}"; fi; mkdir -p "$(dirname '${p}')"; printf %s '${b64}' | base64 -d > '${p}'; echo "已写入 ${p}（$(wc -c < '${p}') 字节）"`
  const r = await execOn(sv, cmd, 60_000)
  audit({ via: emp.name, action: 'server.write', target: `${sv.name} · ${p}`, level: '写', result: r.code === 0 ? '成功' : '失败', how: '本人同意后执行（先备份）' })
  return { text: scrub(r.out, filled.secrets), isError: r.code !== 0 }
}

// ---------- 签名（releases.signFile）：只认「员工能用」的签名证书、只签它工作目录里的文件 ----------
async function signPackage(emp: Employee, a: { path?: string; cert?: string }): Promise<ToolResult> {
  const certs = all<Credential>('credentials').filter((c) => c.group === '签名证书' && c.aiAllowed)
  if (!a.path) return ok(certs.length ? JSON.stringify(certs.map((c) => ({ name: c.name, scope: c.scope })), null, 1) : '没有能用的签名证书：主人在「权限和凭证 → 签名证书」里上传，并允许员工用')
  const c = certs.find((x) => x.name === a.cert || x.id === a.cert) ?? (certs.length === 1 ? certs[0] : undefined)
  if (!c) return fail(certs.length ? '指定 cert（签名证书的名字）' : '没有能用的签名证书')
  const f = String(a.path)
  const ws = emp.workspace ? get<Workspace>('workspaces', emp.workspace) : undefined
  const roots = [ws?.dir, runner.empHome(emp)].filter(Boolean) as string[]
  if (!/^\/[\w./@+-]+$/.test(f) || f.includes('..') || !roots.some((r) => f.startsWith(r + '/'))) return fail('只能签你工作目录里的文件（给绝对路径）')
  const host = runner.hostOf(emp)
  const sv = get<Server>('servers', host === 'local' ? 'local' : host)
  if (!sv) return fail('找不到你干活的那台服务器')
  const r = await signFile(sv, f, c.id)
  return r.ok ? ok(r.msg) : fail(r.msg)
}

// ---------- DNS（dns.ts）：只能改主人开给它的域名；审核方式不是「自动」就先确认 ----------
const myDomains = (emp: Employee) => all<dns.Domain>('domains').filter((d) => (emp.dns ?? []).includes(d.id))
function grantedDomain(emp: Employee, name: string): dns.Domain | string {
  const d = all<dns.Domain>('domains').find((x) => x.domain === name.trim().replace(/\.$/, '').toLowerCase())
  if (!d) return `没有登记域名 ${name}（主人在「应用 → 域名」里登记）`
  if (!(emp.dns ?? []).includes(d.id)) return `主人没给你改 ${d.domain} 的权限（员工档案里开）`
  return d
}
async function dnsList(emp: Employee, a: { domain?: string }): Promise<ToolResult> {
  if (!a.domain) return ok(JSON.stringify(myDomains(emp).map((d) => ({ domain: d.domain, provider: d.provider })), null, 1))
  const d = grantedDomain(emp, a.domain)
  if (typeof d === 'string') return fail(d)
  try { return ok(JSON.stringify(await dns.list(d), null, 1)) } catch (e) { return fail((e as Error).message) }
}
async function dnsSet(run: Run, emp: Employee, a: any): Promise<ToolResult> {
  const d = grantedDomain(emp, String(a.domain ?? ''))
  if (typeof d === 'string') return fail(d)
  const r = { rr: String(a.rr ?? '').trim(), type: String(a.type ?? '').toUpperCase(), value: String(a.value ?? '').trim(), ttl: a.ttl ? Number(a.ttl) : undefined, priority: a.priority ? Number(a.priority) : undefined }
  const bad = dns.check(r)
  if (bad) return fail(bad)
  if (emp.approval === 'plan') return fail('现在是「只看不改」')
  if (emp.approval !== 'auto') {
    const yes = await confirmCard(run, emp, { title: `改解析 ${r.rr === '@' ? '' : r.rr + '.'}${d.domain}`, detail: `${r.type} ${r.value}${r.ttl ? ` TTL ${r.ttl}` : ''}`, why: String(a.why ?? '') })
    if (!yes) return fail('主人没同意')
  }
  try {
    const x = await dns.set(d, r)
    audit({ via: emp.name, action: 'dns.set', target: `${r.rr}.${d.domain} ${r.type}：${x.before ? x.before.value + ' → ' : ''}${r.value}`, level: '危险', result: '成功', how: String(a.why ?? '').slice(0, 80) })
    return ok(`${x.before ? `已改（原来是 ${x.before.value}）` : '已加'}：${r.rr} ${r.type} ${r.value}。用 dig 确认一下生效了没`)
  } catch (e) { return fail((e as Error).message) }
}
async function dnsDelete(run: Run, emp: Employee, a: any): Promise<ToolResult> {
  const d = grantedDomain(emp, String(a.domain ?? ''))
  if (typeof d === 'string') return fail(d)
  if (emp.approval === 'plan') return fail('现在是「只看不改」')
  if (emp.approval !== 'auto') {
    const yes = await confirmCard(run, emp, { title: `删解析记录（${d.domain}）`, detail: `记录 id ${a.id}`, why: String(a.why ?? ''), danger: true })
    if (!yes) return fail('主人没同意')
  }
  try {
    const old = await dns.remove(d, String(a.id ?? ''))
    audit({ via: emp.name, action: 'dns.delete', target: `${old?.rr}.${d.domain} ${old?.type} ${old?.value}`, level: '危险', result: '成功', how: String(a.why ?? '').slice(0, 80) })
    return ok(`已删：${old?.rr} ${old?.type} ${old?.value}`)
  } catch (e) { return fail((e as Error).message) }
}

// ---------- 合并请求（prs.ts） ----------
async function prCreate(emp: Employee, a: { title?: string; body?: string; workspace?: string; target?: string }): Promise<ToolResult> {
  const w = findWs(String(a.workspace ?? '') || emp.workspace)
  if (!w) return fail('没有这个工作空间')
  const cur = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], { host: w.server, cwd: w.dir })).out.trim()
  const target = String(a.target || w.branch || '').trim()
  if (!cur || cur === 'HEAD') return fail('现在不在任何分支上')
  if (!target) return fail('不知道合到哪个分支：给 target')
  if (cur === target) return fail(`你现在就在 ${target} 上：合并请求要从你自己的分支提（主人在你的档案里打开「在自己的分支上改」）`)
  const pushed = await syncWorkspace(w, { rebase: false, push: true })
  if (/推送失败/.test(pushed)) return fail(`推送分支失败：${pushed}`)
  try {
    const pr = await prs.create(w, { source: cur, target, title: String(a.title ?? '').slice(0, 200) || `${emp.name} 的改动`, body: String(a.body ?? '') })
    const mine = kvGet<Record<string, prs.PrRef[]>>('prs', {})
    mine[emp.id] = [pr, ...(mine[emp.id] ?? [])].slice(0, 20)
    kvSet('prs', mine)
    empSays(emp.id, { kind: 'card', card: prCard(pr, { state: 'open', conflict: false, url: pr.url, title: pr.title }) }, `合并请求：${pr.title}`)
    audit({ via: emp.name, action: 'pr.create', target: `${w.name} ${cur} → ${target}`, level: '写', result: '成功', how: pr.url })
    return ok(`已提合并请求 ${pr.url}`)
  } catch (e) { return fail(`建合并请求失败：${(e as Error).message}`) }
}
export function prCard(pr: prs.PrRef, st: prs.PrState): Card {
  const tag = st.state === 'merged' ? '已合并' : st.state === 'closed' ? '已关闭' : st.conflict ? '有冲突' : st.state === 'open' ? '待合并' : '状态不明'
  return {
    id: uid('c'), type: 'generic', v: 1, state: 'open', level: st.conflict ? 'warn' : 'info',
    data: { title: `合并请求：${st.title || pr.title}`, tag, url: st.url || pr.url, pr, rows: [['分支', `${pr.source} → ${pr.target}`], ['平台', pr.provider], ['编号', pr.id]] },
    actions: [{ id: 'refresh', label: '刷新状态', style: 'default' }],
  }
}
async function prStatus(emp: Employee, a: { id?: string }): Promise<ToolResult> {
  const list = (kvGet<Record<string, prs.PrRef[]>>('prs', {})[emp.id] ?? []).filter((x) => !a.id || x.id === String(a.id))
  if (!list.length) return fail('没有你提过的合并请求')
  const out = await Promise.all(list.slice(0, 5).map(async (pr) => ({ id: pr.id, branch: `${pr.source} → ${pr.target}`, ...(await prs.status(pr)) })))
  return ok(JSON.stringify(out, null, 1))
}

// ---------- 发布（releases.ts） ----------
const findWs = (k: string) => all<Workspace>('workspaces').find((x) => x.id === k || x.name === k)
function releaseList(a: { workspace?: string }): ToolResult {
  const wss = a.workspace ? [findWs(a.workspace)].filter(Boolean) as Workspace[] : all<Workspace>('workspaces').filter((w) => w.deploys?.length)
  const sv = (id?: string) => (id ? get<Server>('servers', id)?.name ?? id : undefined)
  return ok(JSON.stringify(wss.map((w) => ({
    workspace: w.name,
    build: providerName(w.buildCfg), targets: (w.deploys ?? []).map((d) => ({ name: d.name, servers: releases.serversOf(d).map((x) => sv(x)), dir: d.dir, sign: !!d.sign, health: d.health, permission: d.ai ?? 'ask', running: releases.running(w.id, d.id) })),
    latest: releases.list({ ws: w.id, limit: 5 }).map(releases.summary),
  })), null, 1))
}
async function releasePublish(run: Run, emp: Employee, a: { workspace?: string; target?: string; note?: string; reason?: string }): Promise<ToolResult> {
  const w = findWs(String(a.workspace ?? '') || emp.workspace)
  if (!w) return fail('没有这个工作空间（release_list 看）')
  const d = (w.deploys ?? []).find((x) => x.name === a.target || x.id === a.target)
  if (!d) return fail(`「${w.name}」没有叫「${a.target}」的发布目标（release_list 看）`)
  if (emp.approval === 'plan') return fail('现在是「只看不改」')
  const mode = d.ai ?? 'ask'
  if (mode === 'off') return fail(`「${w.name} → ${d.name}」设成了不许员工发：告诉主人去网页上发`)
  if (mode === 'ask') {
    const svs = releases.serversOf(d).map((id) => get<Server>('servers', id)).filter(Boolean) as Server[]
    const yes = await confirmCard(run, emp, { title: `发布 ${w.name} → ${d.name}`, detail: `${a.note ?? ''}\n\n编译：${providerName(w.buildCfg)}\n发到：${svs.map((x) => x.name).join('、')}${d.dir ? `（${d.dir}）` : ''}${d.command ? `\n部署命令：${d.command}` : ''}`, why: String(a.reason ?? ''), danger: svs.some((x) => isProtected(x)) })
    if (!yes) return fail('主人没同意')
  }
  try {
    const r = releases.start(w, d.id, { by: emp.name, emp, sid: run.sid, note: a.note ?? a.reason })
    return ok(`已开始发布（${r.id}），进度在聊天的卡片里；发完我会告诉你结果${mode === 'auto' ? '，失败会把原因发给你接着修' : ''}`)
  } catch (e) { return fail((e as Error).message) }
}
function releaseStatus(a: { id?: string; workspace?: string }): ToolResult {
  if (a.id) {
    const r = get<Release>('releases', String(a.id))
    if (!r) return fail('没有这次发布')
    return ok(`${JSON.stringify(releases.summary(r), null, 1)}\n\n输出（最后一段）：\n${r.tail ?? '（没有）'}`)
  }
  const w = a.workspace ? findWs(a.workspace) : undefined
  return ok(JSON.stringify(releases.list({ ws: w?.id, limit: 3 }).map((r) => ({ ...releases.summary(r), tail: (r.tail ?? '').slice(-1500) })), null, 1))
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

// ---------- 建 / 改员工（员工档案里开了「能管员工」的才行，都要主人点确认） ----------
async function empCreate(run: Run, emp: Employee, a: any): Promise<ToolResult> {
  if (!emp.canManage) return fail('你没有管员工的权限：主人在你的档案里打开「能建、改别的员工」才行')
  const name = String(a.name ?? '').trim().slice(0, 30)
  if (!name || !String(a.prompt ?? '').trim()) return fail('名字和职责都要有')
  if (all<Employee>('employees').some((e) => e.name === name)) return fail('已经有同名的员工')
  const ws = a.workspace ? all<Workspace>('workspaces').find((w) => w.id === a.workspace || w.name === a.workspace) : undefined
  if (a.workspace && !ws) return fail('没有这个工作空间')
  const sv = a.host ? all<Server>('servers').find((x) => x.id === a.host || x.name === a.host) : undefined
  const exec = /codex/i.test(String(a.executor ?? '')) ? 'Codex' : 'Claude Code'
  const yes = await confirmCard(run, emp, { title: `建一个员工「${name}」`, detail: `职责：${String(a.title ?? '')}\n执行器：${exec}${ws ? `\n工作空间：${ws.name}` : ''}${sv ? `\n跑在：${sv.name}` : ''}\n\n${String(a.prompt).slice(0, 1500)}`, why: '不会给它任何服务器、库、凭证的权限，要的话你自己给' })
  if (!yes) return fail('主人没同意')
  const e: Employee = {
    id: uid('e'), name, avatar: name.slice(0, 1), color: '#5B4FE9', title: String(a.title ?? '').slice(0, 80), prompt: String(a.prompt).slice(0, 20000), persona: String(a.persona ?? '').slice(0, 200),
    executor: exec, host: sv && (sv.via === 'agent' || sv.id === 'local') ? sv.id : 'local', workspace: ws?.id ?? '', menus: [], model: exec === 'Codex' ? '执行器默认' : 'Opus 5.5', effort: 'high', approval: 'edits', notify: 'decide', repo: '',
    works: [{ no: 1, from: new Date().toLocaleDateString('zh-CN'), reason: `「${emp.name}」建的`, host: sv?.name ?? 'Opero 这台' }],
  }
  put('employees', e)
  emit({ t: 'put', coll: 'employees', item: e })
  const s = sessionFor(e.id)
  addMsg(s.id, { from: e.id, kind: 'text', text: `我是「${e.name}」，${e.title}。「${emp.name}」帮你建的我，有事直接跟我说。` })
  audit({ via: emp.name, action: 'employee.create', target: name, level: '写', result: '成功', how: '主人确认后' })
  return ok(`已建好「${name}」（id ${e.id}），审核方式默认「改文件自动，跑命令要问」，主人可以在它的档案里改`)
}

async function empUpdate(run: Run, emp: Employee, a: any): Promise<ToolResult> {
  if (!emp.canManage) return fail('你没有管员工的权限：主人在你的档案里打开「能建、改别的员工」才行')
  const k = String(a.employee ?? '')
  const to = all<Employee>('employees').find((e) => e.id === k || e.name === k)
  if (!to) return fail('没有这个员工（list_employees 看）')
  if (runner.isWorking(to.id)) return fail(`「${to.name}」正在干活，等它做完再改`)
  const ws = a.workspace === undefined ? undefined : a.workspace === '' ? null : all<Workspace>('workspaces').find((w) => w.id === a.workspace || w.name === a.workspace)
  if (ws === undefined && a.workspace) return fail('没有这个工作空间')
  const patch: Partial<Employee> = {
    ...(a.title !== undefined ? { title: String(a.title).slice(0, 80) } : {}),
    ...(a.prompt !== undefined ? { prompt: String(a.prompt).slice(0, 20000) } : {}),
    ...(a.persona !== undefined ? { persona: String(a.persona).slice(0, 200) } : {}),
    ...(a.workspace !== undefined ? { workspace: ws?.id ?? '', resumeId: undefined } : {}),
  }
  if (!Object.keys(patch).length) return fail('没有要改的')
  const detail = Object.entries(patch).filter(([k2]) => k2 !== 'resumeId').map(([k2, v]) => `${k2}：${String(v).slice(0, 800)}`).join('\n')
  const yes = await confirmCard(run, emp, { title: `改员工「${to.name}」`, detail, why: '它下次干活时记忆仓库里「我的角色」会跟着改' })
  if (!yes) return fail('主人没同意')
  const next = { ...to, ...patch }
  put('employees', next)
  emit({ t: 'put', coll: 'employees', item: next })
  audit({ via: emp.name, action: 'employee.update', target: to.name, level: '写', result: '成功', how: '主人确认后' })
  return ok(`已改好「${to.name}」`)
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
