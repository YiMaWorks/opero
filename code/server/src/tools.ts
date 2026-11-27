// Opero 给 AI 员工的 MCP 工具（经 mcp.ts 转过来）。账号都在 Opero 这边用，AI 只拿到结果。
// 要你决定的（审核、确认、选方案、危险命令、改数据）先在会话里发一张卡片，等你点了再回给 AI。
import fs from 'node:fs'
import path from 'node:path'
import * as hosts from './hosts.ts'
import * as agents from './agents.ts'
import { cfg } from './config.ts'
import { all, db, del, get, kvGet, kvSet, put, uid } from './db.ts'
import { emit } from './bus.ts'
import { addMsg, audit, empSays, patchSession, sessionFor, system } from './chat.ts'
import { CATASTROPHIC, DANGER, execOn, isReadOnly } from './ssh.ts'
import { isReadSql, resultText, runQuery } from './dbconn.ts'
import { git, syncWorkspace } from './git.ts'
import * as runner from './runner.ts'
import { switchAndTell } from './branch.ts'
import type { Card, Credential, DataSource, Deploy, Employee, KbDoc, LogSource, Release, Server, ServerDir, Trigger, Workspace } from './types.ts'
import { makeTrigger } from './triggers.ts'
import { applyDirs, cleanDirs, cleanLogs } from './serverdirs.ts'
import * as pipes from './pipelines.ts'
import { isProtected } from './env.ts'
import { buildNeed, checkCommand, policyOf } from './policy.ts'
import { hostRes } from './resources.ts'
import { buildScan } from './logscan.ts'
import * as issues from './issues.ts'
import * as releases from './releases.ts'
import { signFile } from './signing.ts'
import { providerName } from './build.ts'
import * as build from './build.ts'
import * as buildjobs from './buildjobs.ts'
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
  { name: 'list_servers', description: 'List the servers the owner connected to Opero (name, environment, OS, online, CPU/memory/disk, registered logs). No credentials.', inputSchema: S({}) },
  { name: 'server_exec', description: 'Run a shell command on one of the owner\'s servers through Opero (Opero holds the SSH credentials; you only get the output). Read-only commands run right away; anything that changes the server may need the owner to approve a card first. Always say why.', inputSchema: S({ server: str('server name or id from list_servers'), command: str('shell command'), reason: str('one line: why you need this') }, ['server', 'command', 'reason']) },
  { name: 'list_databases', description: 'List the databases the owner connected (name, kind, environment, writable, tables). A connection without db is a whole server/instance: "dbs" lists the databases you can pick with db_query\'s db.', inputSchema: S({}) },
  { name: 'db_query', description: 'Run SQL on one of the owner\'s databases through Opero. SELECT/SHOW/EXPLAIN run in a read-only transaction (15 s timeout, 200 rows max, sensitive columns masked). Writes only on databases marked writable and always need the owner to approve.', inputSchema: S({ database: str('connection name or id from list_databases (or a database name inside one)'), db: str('whole-instance connections: which database to run in (one of its dbs); MySQL can also use db.table in the SQL'), sql: str('one SQL statement'), reason: str('one line: why') }, ['database', 'sql', 'reason']) },
  { name: 'switch_branch', description: 'Switch your project (workspace) to another Git branch. Every employee of this project shares the same checkout, so they all switch with you; uncommitted changes are stashed first. Use when the owner asks to work on another branch.', inputSchema: S({ branch: str('branch name (existing local or remote branch, or a new one)') }, ['branch']) },
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
  { name: 'log_scan', description: 'Analyse logs on a server without dumping them. mode: hist = matching lines per minute/10 min/hour (when did it start, is it still happening); first = first occurrences with following lines (stack traces); last = latest occurrences; top = error kinds and failing lines, counted (numbers/ids folded); grep = matching lines. Default pattern matches ERROR/Exception/FATAL/Traceback. Give neither file nor service to scan every log the owner registered on that server (list_servers shows them). Read-only.', inputSchema: S({ server: str('server name or id'), file: str('absolute log file path (may contain *)'), service: str('or a systemd service name (journalctl)'), mode: { type: 'string', enum: ['top', 'hist', 'first', 'last', 'grep'] }, grep: str('extended regex to match (optional)'), since_min: { type: 'integer', description: 'journalctl only: last N minutes (default 60)' }, bucket: { type: 'string', enum: ['1m', '10m', '1h'] }, limit: { type: 'integer' }, before: { type: 'integer' }, after: { type: 'integer' }, rotated: { type: 'boolean', description: 'also read rotated files (.1, .gz)' } }, ['server']) },
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
  { name: 'build_info', description: 'Show how a project is built. A project can have several build components (e.g. web, Android, backend), each with its own template, command, where it builds and pipeline; release targets pick which component they ship. Per component: template (node/go/android/spring/custom), where it builds (auto = local server if it has enough resources, else the pipeline; local; pipeline), pipeline tool (Codeup Yunxiao Flow / GitHub Actions) and whether the pipeline exists, the build script contract (put release files in out/; Opero adds SHA256SUMS/VERSION/COMMIT; a deploy.sh inside the package installs it with OPERO_DIR = deploy dir), the last test build and the generated build script. Read this before changing anything.', inputSchema: S({ workspace: str('project name or id (default: your project)'), component: str('build component name or id, e.g. 网页 / 安卓 (default: all components)') }) },
  { name: 'build_set', description: 'Add or change a build component of a project (a project can have several: web, Android, backend…). component = the one to change; a new name adds a new component; remove: true deletes it (not while a release target ships it). Only pass what you want to change. where: auto (default, recommended) / local / pipeline. kind: node / go / android / spring / custom (custom needs cmd: a command run at the repo root that puts the release files into out/, e.g. "bash deploy/build.sh"). Then call build_generate to (re)create the pipeline and build_try to test.', inputSchema: S({ workspace: str('project name or id (default: your project)'), component: str('build component name or id, e.g. 网页 / 安卓 (needed when the project has more than one)'), name: str('rename the component (optional)'), remove: { type: 'boolean', description: 'delete this component' }, kind: { type: 'string', enum: ['node', 'go', 'android', 'spring', 'custom'] }, where: { type: 'string', enum: ['auto', 'local', 'pipeline'] }, cmd: str('custom: build command'), subdir: str('code subdir (optional)'), versionFile: str('file with the version (optional)'), service: str('node/go: systemd service to restart after deploy (optional)'), provider: { type: 'string', enum: ['yunxiao', 'github', 'gitlab', 'jenkins', 'local'], description: 'pipeline tool (local = no pipeline). yunxiao needs a Codeup credential with pipeline permission, jenkins a Jenkins credential' }, credential: str('yunxiao / jenkins: credential name to use (setup_info lists them)'), job: str('jenkins: job name (default opero-<project>-<component>)') }) },
  { name: 'build_generate', description: 'Create or update the pipeline of a build component on its pipeline tool (Codeup Yunxiao Flow: created with the owner\'s Codeup token; GitHub Actions: commits .github/workflows/opero-build-<component>.yml; GitLab: one job per component in .opero/gitlab-ci.yml; Jenkins: job opero-<project>-<component>). Safe to run again after changing settings. Push your build script changes first.', inputSchema: S({ workspace: str('project name or id (default: your project)'), component: str('build component name or id, e.g. 网页 / 安卓 (needed when the project has more than one)') }) },
  { name: 'build_try', description: 'Test-build a build component from the latest pushed commit (build only, nothing is deployed). Decides local vs pipeline like a real release. Different components can build at the same time. Returns right away; poll build_status. Fix the build script / settings from the log until it passes.', inputSchema: S({ workspace: str('project name or id (default: your project)'), component: str('build component name or id, e.g. 网页 / 安卓 (needed when the project has more than one)') }) },
  { name: 'build_status', description: 'Show the current / last test build of a build component: status, where it ran, output files, and the log.', inputSchema: S({ workspace: str('project name or id (default: your project)'), component: str('build component name or id, e.g. 网页 / 安卓 (needed when the project has more than one)') }) },
  { name: 'setup_info', description: 'Everything you need to set up building and releasing a project yourself: repo platform and token, which credentials the owner has (names only, and whether you may use them), existing pipelines on Yunxiao / Jenkins (read them with pipeline_read and reuse their build steps), Opero build settings, release targets, servers with their environment and registered deploy dirs, and what is still missing. Call this first when asked to set up build / release / deploy.', inputSchema: S({ workspace: str('project name or id (default: your project)') }) },
  { name: 'pipeline_read', description: 'Read an existing pipeline the owner already has (Yunxiao pipeline YAML or Jenkins job config.xml) so you can reuse its build / deploy steps in Opero (build_set cmd, release_target_set command). Ids come from setup_info.', inputSchema: S({ tool: { type: 'string', enum: ['yunxiao', 'jenkins'] }, id: str('Yunxiao pipeline id or Jenkins job name'), workspace: str('project (default: yours)') }, ['tool', 'id']) },
  { name: 'release_target_set', description: 'Create or update a release target (environment) of your project: which build component it ships (build; required when the project has more than one; "none" = no build, just run the deploy command), which servers, deploy dir (registered as deployable on those servers automatically), the deploy script inside the package (default deploy.sh) or a deploy command, health-check URL, versions to keep. Targets on production (protected) servers always ask the owner before each release; you cannot loosen a permission the owner set. Then build_try and release_publish.', inputSchema: S({ workspace: str('project (default: yours)'), name: str('target name, e.g. 测试 / 生产'), build: str('build component name or id to ship, or "none"'), servers: { type: 'array', items: { type: 'string' }, description: 'server names or ids (list_servers)' }, dir: str('absolute deploy dir on the servers'), script: str('deploy script inside the package (default deploy.sh)'), command: str('or: command run in the deploy dir when the package has no script / nothing is built'), health: str('http(s) URL that should answer after deploy'), keep: { type: 'integer', description: 'packages kept per server for rollback (default 5)' }, permission: { type: 'string', enum: ['auto', 'ask'], description: 'auto = you may release directly (non-production only); ask = owner approves each release' } }, ['name']) },
  { name: 'request_credential', description: 'Ask the owner for a key / token / account you need and cannot get yourself (e.g. a Codeup token with pipeline permission, a Jenkins API token, a GitHub token with workflow scope, a database account). Posts a card with a button that opens the right "new credential" page with step-by-step instructions; when the owner saves it, it is granted to you and you get a message to continue. Say exactly which permissions are needed and why. Before asking, check setup_info / list_credentials: if the owner already has it but did not grant it to you, say so instead.', inputSchema: S({ group: { type: 'string', enum: ['代码仓库', '数据库', '服务器', '云账号', '签名证书', '其它'] }, kind: str('type inside the group, e.g. Codeup / GitHub / GitLab / MySQL / Jenkins / 阿里云'), why: str('one or two lines: what you will do with it'), perms: str('exact permissions to tick') }, ['group', 'why']) },
  { name: 'schedule_list', description: 'List the scheduled / webhook tasks (triggers): id, name, when, which employee, what it is told, enabled, last run, webhook path.', inputSchema: S({}) },
  { name: 'schedule_set', description: 'Create or change a scheduled task (trigger) that hands an employee a message on a schedule or when a webhook is called. The owner just says it in chat ("每天 18:00 给我发小结") — you set it up. when: 每 N 分钟 (≥5) / 每 N 小时 / 每天 HH:MM / 工作日 HH:MM / 每周一 HH:MM / webhook. Default employee: you. Write prompt as the full instruction the employee gets each time.', inputSchema: S({ id: str('existing trigger id to change (schedule_list); omit to create'), when: str('schedule rule (see description) or "webhook"'), prompt: str('what the employee is told each time'), employee: str('employee name or id (default: you)'), name: str('short name (optional, auto)'), enabled: { type: 'boolean' } }) },
  { name: 'schedule_delete', description: 'Delete a scheduled task (trigger) by id.', inputSchema: S({ id: str('trigger id') }, ['id']) },
  { name: 'server_dir_set', description: 'Register (or remove) a directory on a server: read = employees may read it, write = employees may read and write it (Opero grants the AI user ACL access), deploy = releases may deploy into it. Use when you need access to a dir or a release needs a deploy dir. Write access on production servers asks the owner first.', inputSchema: S({ server: str('server name or id'), path: str('absolute path, at least two levels'), mode: { type: 'string', enum: ['read', 'write', 'deploy'] }, note: str('what it is (optional)'), remove: { type: 'boolean' } }, ['server', 'path']) },
  { name: 'log_register', description: 'Register (or remove) a log on a server so log_scan and the owner\'s log viewer find it: file (absolute path, may contain *), dir (all *.log inside) or service (systemd unit). Find the real log locations yourself first (server_exec: ls, systemctl, the app config).', inputSchema: S({ server: str('server name or id'), kind: { type: 'string', enum: ['file', 'dir', 'service'] }, path: str('path or service name'), note: str('what it is (optional)'), remove: { type: 'boolean' } }, ['server', 'kind', 'path']) },
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
    case 'list_servers': return ok(JSON.stringify(all<Server>('servers').map((s) => ({ id: s.id, name: s.name, env: s.env, os: s.os, online: s.online, cpu: s.cpu, mem: s.mem, disk: s.disk, logs: s.logSrc?.length ? s.logSrc.map((l) => `${l.kind}:${l.path}${l.note ? ` (${l.note})` : ''}`) : undefined })), null, 1))
    case 'server_exec': return serverExec(run, emp, args)
    case 'list_databases': return ok(JSON.stringify(all<DataSource>('dataSources').map((d) => ({ id: d.id, name: d.name, kind: d.kind, env: d.env, db: d.db || '（整个实例）', ...(d.db ? {} : { dbs: d.dbs ?? [] }), writable: d.writable, tables: d.tables.map((t) => `${t.name}(${t.cols.join(',')})`) })), null, 1))
    case 'db_query': return dbQuery(run, emp, args)
    case 'git_sync': return gitSync(emp, args)
    case 'switch_branch': {
      const w = emp.workspace ? get<Workspace>('workspaces', emp.workspace) : undefined
      if (!w) return fail('你没有项目')
      const others = all<Employee>('employees').filter((e) => e.id !== emp.id && e.workspace === w.id && runner.isWorking(e.id))
      if (others.length) return fail(`${others.map((e) => e.name).join('、')} 也在这个项目里干活，等它做完再切`)
      try { const r = await switchAndTell(w, String(args.branch ?? '').trim(), emp.name); return ok(r.msg) } catch (e) { return fail((e as Error).message) }
    }
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
    case 'list_credentials': return ok(JSON.stringify(all<Credential>('credentials').filter((c) => c.aiAllowed && emp.creds?.includes(c.id)).map((c) => ({ name: c.name, group: c.group, kind: c.kind, env: c.env })), null, 1) + '\n（只列主人给你开了的；要别的请主人在你的档案「能用的凭证」里勾上）')
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
    case 'setup_info': return setupInfo(emp, args)
    case 'schedule_list': return scheduleList()
    case 'schedule_set': return scheduleSet(emp, args)
    case 'schedule_delete': {
      const t = get<Trigger>('triggers', String(args.id ?? ''))
      if (!t) return fail('没有这个定时任务（schedule_list 看 id）')
      del('triggers', t.id); emit({ t: 'del', coll: 'triggers', id: t.id })
      audit({ via: emp.name, action: 'trigger.delete', target: t.name, level: '写', result: '成功', how: '员工' })
      return ok(`已删掉「${t.name}」`)
    }
    case 'server_dir_set': return serverDirSet(run, emp, args)
    case 'log_register': return logRegister(emp, args)
    case 'pipeline_read': return pipelineRead(emp, args)
    case 'release_target_set': return releaseTargetSet(emp, args)
    case 'request_credential': return requestCredential(emp, args)
    case 'build_info': case 'build_set': case 'build_generate': case 'build_try': case 'build_status': return buildTool(name, emp, args)
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
  const pol = policyOf(get<Server>('servers', hosts.isLocal(runner.hostOf(emp)) ? 'local' : runner.hostOf(emp)))
  // 编译命令、看资源决定：先读那台现在的资源（可用内存、磁盘、核数、负载）
  const res = cmd && pol.build === 'auto' && buildNeed(cmd) ? await hostRes(runner.hostOf(emp)) : undefined
  const banned = cmd && checkCommand(cmd, pol, { res })
  if (banned) {
    audit({ via: emp.name, action: 'policy.deny', target: cmd.slice(0, 120), level: '写', result: '拒绝', how: banned })
    return deny(`${banned}（这台机器的规矩）`)
  }
  // 照 KidLock：灾难性的直接拒绝（告诉员工原因、别换写法再试），不弹卡片；别的「自动」审核方式下一律直接跑
  const fatal = CATASTROPHIC.why(cmd)
  if (fatal) {
    audit({ via: emp.name, action: 'command.deny', target: cmd.slice(0, 120), level: '危险', result: '拒绝', how: fatal })
    return deny(`这条命令${fatal}，Opero 不让员工跑。不要换个写法再试；真要这么做，停下来在聊天里跟主人说清楚要做什么、为什么，由主人自己去做。`)
  }
  if (emp.approval === 'auto' || RO_TOOLS.has(tool)) return allow
  if (emp.approval === 'edits' && (EDIT_TOOLS.has(tool) || (tool === 'Bash' && isReadOnly(cmd)))) return allow
  // 只有主人给这个员工选了「每一步都问 / 跑命令要问」才走到这里
  const summary = cmd || String(input.file_path ?? input.path ?? input.url ?? JSON.stringify(input)).slice(0, 2000)
  const verb = tool === 'Bash' ? '跑命令' : EDIT_TOOLS.has(tool) ? '改文件' : `用 ${tool}`
  // 员工自己写的「这一步在干嘛」（Claude Code 的 Bash 带 description）：卡片先说人话，命令收起来
  const what = String(input.description ?? '').trim()
  const yes = await confirmCard(run, emp, {
    title: what || `要${verb}`, detail: summary,
    why: `你给这个员工选的审核方式是「${emp.approval === 'ask' ? '每一步都问' : '改文件自动，跑命令要问'}」（员工资料里能改成「自动」）`,
    note: what ? `${emp.name} 要${verb}` : '',
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

/** 员工能不能用这个凭证：总开关开着，并且主人在员工资料「能用的凭证」里给它勾了 */
function credBlock(emp: Employee, id: string | undefined, what: string): string {
  if (!id) return ''
  const c = get<Credential>('credentials', id)
  if (!c) return ''
  if (!c.aiAllowed) return `${what}（凭证「${c.name}」）设成了只有主人本人能用`
  if (!emp.creds?.includes(c.id)) return `${what}用的凭证「${c.name}」没给你开：请主人在员工「${emp.name}」的档案 →「能用的凭证」里勾上它`
  return ''
}

// ---------- 服务器 ----------
const findServer = (k: string) => all<Server>('servers').find((s) => s.id === k || s.name === k || s.ip === k)

async function serverExec(run: Run, emp: Employee, a: { server?: string; command?: string; reason?: string }): Promise<ToolResult> {
  const sv = findServer(String(a.server ?? ''))
  if (!sv) return fail('没有这台服务器（用 list_servers 看名字）')
  const command = String(a.command ?? '').trim()
  if (!command) return fail('命令是空的')
  const blocked = credBlock(emp, sv.credential, `服务器「${sv.name}」的账号`)
  if (blocked) return fail(blocked)
  const ro = isReadOnly(command)
  const dangerWhy = DANGER.why(command)
  const danger = !!dangerWhy
  // 这台自己设过就按它；没设过 = 像生产的标签 + 「我 → 设置」的生产保护开着
  const prod = sv.protect ?? (isProtected(sv) && !!kvGet<{ prodProtect?: boolean }>('settings', {}).prodProtect)
  if (emp.approval === 'plan' && !ro) return fail('现在是「只看不改」，只能跑只读命令')
  const banned = checkCommand(command, policyOf(sv), { hard: false })
  if (banned) return fail(`${banned}（${sv.name} 的规矩）`)
  const filled = fillSecrets(command, emp)
  if ('error' in filled) return fail(filled.error)
  if (danger || (!ro && (emp.approval !== 'auto' || prod))) {
    // 先说人话：员工说的原因当标题，为什么要确认写清楚，命令收在下面
    const reason = String(a.reason ?? '').trim()
    const whyAsk = dangerWhy ? `为什么要你确认：${dangerWhy}` : prod ? `为什么要你确认：${sv.name} 是${sv.env}环境，会改东西` : '为什么要你确认：这条命令会改东西'
    const yes = await confirmCard(run, emp, { title: reason || `在 ${sv.name} 上跑一条命令`, detail: command, why: `${whyAsk}。拿不准就点「不行」，员工会换个办法`, note: `在 ${sv.name}（${sv.env}）上执行`, danger: danger || isProtected(sv) })
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
  { const blocked = credBlock(emp, sv.credential, `服务器「${sv.name}」的账号`); if (blocked) return fail(blocked) }
  // 没指定日志：扫这台登记的全部日志（服务器详情「日志」里登记，可以多个）
  const targets: { file?: string; service?: string; label: string }[] = a.file || a.service
    ? [{ file: a.file, service: a.service, label: String(a.file ?? a.service) }]
    : (sv.logSrc ?? []).map((l) => l.kind === 'service' ? { service: l.path, label: l.path } : { file: l.kind === 'dir' ? `${l.path}/*.log` : l.path, label: l.kind === 'dir' ? `${l.path}/*.log` : l.path })
  if (!targets.length) return fail(`「${sv.name}」没登记日志：给 file（日志文件路径）或 service，或者请主人在服务器详情「日志」里登记要扫的日志`)
  const parts: string[] = []
  let okAll = true
  for (const t of targets) {
    let cmd: string
    try { cmd = buildScan({ ...a, file: t.file, service: t.service, sinceMin: a.since_min }) } catch (e) { parts.push(`== ${t.label} ==\n${(e as Error).message}`); okAll = false; continue }
    const r = await execOn(sv, cmd, 90_000)
    if (r.code !== 0 && r.code !== 1) okAll = false
    parts.push(targets.length > 1 ? `== ${t.label} ==\n${r.out.trim() || '没有匹配的行'}` : r.out)
  }
  audit({ via: emp.name, action: 'log.scan', target: `${sv.name} · ${targets.map((t) => t.label).join('、').slice(0, 200)} · ${a.mode ?? 'top'}`, level: '读', result: okAll ? '成功' : '失败', how: '只读' })
  const all = parts.join('\n\n')
  const out = all.length > 30_000 ? all.slice(0, 12_000) + '\n…（中间省略）…\n' + all.slice(-12_000) : all
  return ok(out.trim() ? out : '没有匹配的行')
}

async function fileWrite(run: Run, emp: Employee, a: { server?: string; path?: string; content?: string; reason?: string }): Promise<ToolResult> {
  const sv = findServer(String(a.server ?? ''))
  if (!sv) return fail('没有这台服务器（用 list_servers 看名字）')
  { const blocked = credBlock(emp, sv.credential, `服务器「${sv.name}」的账号`); if (blocked) return fail(blocked) }
  const p = String(a.path ?? '')
  if (!/^\/[\w./@+-]+$/.test(p) || p.includes('..')) return fail('路径要是绝对路径（字母、数字、. _ - /）')
  const content = String(a.content ?? '')
  if (content.length > 200_000) return fail('一次最多写 200 KB')
  if (emp.approval === 'plan') return fail('现在是「只看不改」')
  const filled = fillSecrets(content, emp)
  if ('error' in filled) return fail(filled.error)
  // 先自动备份再写；只有生产（受保护）的服务器、或者审核方式不是「自动」才问主人
  const prodSv = sv.protect ?? (isProtected(sv) && !!kvGet<{ prodProtect?: boolean }>('settings', {}).prodProtect)
  const yes = !prodSv && emp.approval === 'auto' ? true : await confirmCard(run, emp, { title: `改 ${sv.name} 上的文件`, detail: `${p}\n\n${content.slice(0, 1500)}${content.length > 1500 ? '\n…' : ''}`, why: String(a.reason ?? ''), danger: isProtected(sv), note: '原文件会先备份成 .bak-时间' })
  if (!yes) return fail('主人没同意')
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const b64 = Buffer.from(filled.text).toString('base64')
  const cmd = `set -e; if [ -e '${p}' ]; then cp -a '${p}' '${p}.bak-${ts}'; echo "已备份 ${p}.bak-${ts}"; fi; mkdir -p "$(dirname '${p}')"; printf %s '${b64}' | base64 -d > '${p}'; echo "已写入 ${p}（$(wc -c < '${p}') 字节）"`
  const r = await execOn(sv, cmd, 60_000)
  audit({ via: emp.name, action: 'server.write', target: `${sv.name} · ${p}`, level: '写', result: r.code === 0 ? '成功' : '失败', how: prodSv || emp.approval !== 'auto' ? '主人同意后执行（先备份）' : '先备份再写（不是生产，没问）' })
  return { text: scrub(r.out, filled.secrets), isError: r.code !== 0 }
}

// ---------- 签名（releases.signFile）：只认「员工能用」的签名证书、只签它工作目录里的文件 ----------
async function signPackage(emp: Employee, a: { path?: string; cert?: string }): Promise<ToolResult> {
  const certs = all<Credential>('credentials').filter((c) => c.group === '签名证书' && c.aiAllowed && emp.creds?.includes(c.id))
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
  if (!(emp.dns ?? []).includes(d.id)) return `主人没给你改 ${d.domain} 的权限（员工资料里开）`
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
  if (!w) return fail('没有这个项目')
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

// ---------- 编译 / 流水线（员工自己配、自己试，发生产照旧问主人） ----------
async function buildTool(name: string, emp: Employee, a: any): Promise<ToolResult> {
  const w = findWs(String(a.workspace ?? '') || emp.workspace)
  if (!w) return fail('没有这个项目（不填就是你自己的项目）')
  const list = build.buildsOf(w)
  const key = a.component === undefined ? '' : String(a.component).trim()
  const b = build.findBuild(w, key || undefined)
  const names = list.map((x) => `「${x.name}」`).join('、')
  if (name === 'build_info') {
    if (!list.length) return ok(`「${w.name}」还没有编译组件（接入时会自动配一个；也可以用 build_set 加，比如 component=网页 / 安卓）。`)
    const info = (x: build.BuildComp) => {
      const last = buildjobs.lastOf(w.id, x.id)
      return {
        component: x.name, id: x.id, kind: x.kind, where: build.whereOf(x), summary: build.providerName(x),
        pipeline: { tool: x.provider, ready: build.pipelineReady(x), error: x.pipelineError, yunxiao: x.yunxiao && { org: x.yunxiao.org, pipelineId: x.yunxiao.pipelineId }, github: x.github, jenkins: x.jenkins && { job: x.jenkins.job } },
        cmd: x.cmd, subdir: x.subdir, versionFile: x.versionFile, service: x.service, artifact: build.fileOf(x),
        usedBy: (w.deploys ?? []).filter((d) => d.build === x.id || (!d.build && list.length === 1)).map((d) => d.name),
        lastTry: last && { status: last.status, mode: last.mode, version: last.version, files: last.files, error: last.error, at: new Date(last.at).toLocaleString('zh-CN') },
        ...(b || list.length === 1 ? { script: build.script(x, build.codeOf(w, x)).slice(0, 6000) } : {}),
      }
    }
    if (key && !b) return fail(`「${w.name}」没有叫「${key}」的编译组件（有：${names}）`)
    return ok(JSON.stringify({
      project: w.name, repo: w.repo, branch: w.branch,
      contract: '一个项目可以有好几个编译组件（网页、安卓、后台…），各自的模板、命令、在哪编、流水线；发布目标选发哪个组件。编译脚本把要发的东西放进 out/（node / go 模板会打成 <名字>-<版本>.tgz，包里带 deploy.sh）；Opero 补 SHA256SUMS / VERSION / COMMIT。部署时 Agent 以 root 跑包里的 deploy.sh，OPERO_DIR（= KL_DIR）是部署目录。本地编和流水线跑同一个脚本。',
      components: (b ? [b] : list).map(info),
    }, null, 1))
  }
  if (name === 'build_set') {
    const s = (v: unknown, n = 200) => (v === undefined ? undefined : String(v).trim().slice(0, n))
    // 改哪个：给了 component 找得到就改它，找不到就新加一个叫这个名字的；没给且只有一个就改那个
    if (!key && list.length > 1) return fail(`「${w.name}」有好几个编译组件（${names}）：用 component 说改哪个；要新加就给一个新名字`)
    if (a.remove) {
      if (!b) return fail(`没有这个编译组件（有：${names}）`)
      const users = (w.deploys ?? []).filter((d) => d.build === b.id)
      if (users.length) return fail(`发布目标 ${users.map((d) => `「${d.name}」`).join('、')} 还在发它：先用 release_target_set 给它们换组件`)
      const cur = { ...w, builds: list.filter((x) => x.id !== b.id) }
      put('workspaces', cur); emit({ t: 'put', coll: 'workspaces', item: cur })
      audit({ via: emp.name, action: 'build.remove', target: `${w.name} · ${b.name}`, level: '写', result: '成功', how: '员工' })
      return ok(`已删掉编译组件「${b.name}」`)
    }
    const isNew = !b
    const compName = (s(a.name, 40) || (isNew ? key : b!.name) || '主程序')!
    if (list.some((x) => x.name === compName && x.id !== b?.id)) return fail(`已经有叫「${compName}」的编译组件了`)
    const next: build.BuildComp = { ...(b ?? { id: build.newBuildId(w, compName), name: compName, kind: 'custom', provider: 'local', where: 'auto' }), name: compName }
    if (a.kind) next.kind = a.kind
    if (a.where) next.where = a.where
    if (a.cmd !== undefined) next.cmd = s(a.cmd, 8000)
    if (a.subdir !== undefined) next.subdir = s(a.subdir, 100)
    if (a.versionFile !== undefined) next.versionFile = s(a.versionFile)
    if (a.service !== undefined) next.service = s(a.service, 80)?.replace(/[^A-Za-z0-9@._-]/g, '')
    if (a.provider) {
      const cred = a.credential ? all<Credential>('credentials').find((c) => c.id === a.credential || c.name === a.credential) : undefined
      if (a.credential && !cred) return fail(`没有叫「${a.credential}」的凭证（setup_info 看）`)
      const pick = (kind: string) => cred ?? all<Credential>('credentials').find((c) => c.kind === kind && c.aiAllowed && emp.creds?.includes(c.id))
      if (a.provider === 'yunxiao') {
        if (!build.codeupRepo(w.repo)) return fail('云效流水线要用 Codeup 仓库')
        const c = pick('Codeup')
        if (!c) return fail('没有能用的 Codeup 凭证：request_credential group=代码仓库 kind=Codeup（要「流水线」读写）')
        const blocked = credBlock(emp, c.id, '云效流水线'); if (blocked) return fail(blocked)
        next.yunxiao = { ...(next.provider === 'yunxiao' ? next.yunxiao : {}), cred: c.id }
      } else if (a.provider === 'jenkins') {
        const c = pick('Jenkins')
        if (!c) return fail('没有能用的 Jenkins 凭证：request_credential group=其它 kind=Jenkins')
        const blocked = credBlock(emp, c.id, 'Jenkins'); if (blocked) return fail(blocked)
        next.jenkins = { ...(next.provider === 'jenkins' ? next.jenkins : {}), cred: c.id, ...(a.job ? { job: s(a.job, 80)!.replace(/[^\w.-]/g, '-') } : {}) }
      } else if ((a.provider === 'github' || a.provider === 'gitlab') && !w.credential) return fail('项目没配仓库令牌：request_credential group=代码仓库')
      next.provider = a.provider
      if (a.provider === 'local') next.where = 'local'
    }
    if (next.kind === 'custom' && !next.cmd) return fail('custom 模板要给 cmd（在仓库根目录跑、把要发的东西放进 out/ 的命令）')
    if (next.where === 'pipeline' && next.provider === 'local') return fail('这个项目没有流水线工具（云效要 Codeup 仓库 + Codeup 凭证，GitHub 要项目配了令牌），不能设成「总是流水线」')
    const cur = { ...w, builds: isNew ? [...list, next] : list.map((x) => (x.id === next.id ? next : x)) }
    put('workspaces', cur); emit({ t: 'put', coll: 'workspaces', item: cur })
    audit({ via: emp.name, action: isNew ? 'build.add' : 'build.set', target: `${w.name} · ${next.name} · ${build.providerName(next)}`, level: '写', result: '成功', how: '员工' })
    return ok(`${isNew ? '已加编译组件' : '已改编译组件'}「${next.name}」：${build.providerName(next)}，模板 ${next.kind}。改了脚本相关的设置要再 build_generate（component=${next.name}）更新流水线${isNew && (w.deploys ?? []).length ? '；发布目标要发它就用 release_target_set 的 build 选上' : ''}。`)
  }
  if (!list.length) return fail('还没有编译组件：先 build_set')
  if (!b) return fail(key ? `没有叫「${key}」的编译组件（有：${names}）` : `「${w.name}」有好几个编译组件（${names}）：用 component 说是哪个`)
  if (name === 'build_generate') {
    if (b.provider === 'local') return fail('这个组件没有流水线工具：云效要 Codeup 仓库 + 主人的 Codeup 凭证；GitHub / GitLab 要项目配了令牌；Jenkins 要主人在编译设置里选。没有就只能本地编')
    try {
      const next = await build.generate(w, b)
      const cur0 = get<Workspace>('workspaces', w.id)!
      const cur = { ...cur0, builds: build.buildsOf(cur0).map((x) => (x.id === b.id ? { ...next, pipelineError: undefined } : x)) }
      put('workspaces', cur); emit({ t: 'put', coll: 'workspaces', item: cur })
      audit({ via: emp.name, action: 'build.generate', target: `${w.name} · ${b.name} · ${build.providerName(next)}`, level: '写', result: '成功', how: '员工' })
      return ok(`「${b.name}」的流水线已建好 / 更新（${build.providerName(next)}${next.yunxiao?.pipelineId ? ` · 云效流水线 ${next.yunxiao.pipelineId}` : ''}）。用 build_try 试编一次。`)
    } catch (e) { return fail(`没建成：${(e as Error).message}`) }
  }
  if (name === 'build_try') {
    try { const j = buildjobs.start(w, b, emp.name); return ok(`开始试编译「${b.name}」（${j.id}）：编远端最新提交，只编不发。几分钟后用 build_status 看结果。`) } catch (e) { return fail((e as Error).message) }
  }
  const j = buildjobs.lastOf(w.id, b.id)
  if (!j) return ok(`「${b.name}」还没试编过：build_try`)
  return { text: `「${b.name}」${j.status === 'running' ? '在编…' : j.status === 'ok' ? '编过了' : '没编过'}${j.version ? ` · 版本 ${j.version}` : ''}${j.files?.length ? ` · 产物 ${j.files.join('、')}` : ''}\n\n${j.log.slice(-80).join('\n')}${j.error ? `\n\n错误：${j.error}` : ''}`, isError: j.status === 'fail' }
}
// ---------- 定时任务（触发器）：主人在聊天里说一句，员工建好 ----------
function scheduleList(): ToolResult {
  return ok(JSON.stringify(all<Trigger>('triggers').map((t) => ({ id: t.id, name: t.name, when: t.kind === 'Webhook' ? 'webhook' : t.rule, employee: get<Employee>('employees', t.employee)?.name ?? t.employee, enabled: t.enabled, last: t.last, prompt: t.prompt, ...(t.hookToken ? { webhookPath: `/hook/${t.hookToken}（前面加 Opero 的地址）` } : {}) })), null, 1))
}
function scheduleSet(emp: Employee, a: { id?: string; when?: string; prompt?: string; employee?: string; name?: string; enabled?: boolean }): ToolResult {
  const old = a.id ? get<Trigger>('triggers', String(a.id)) : undefined
  if (a.id && !old) return fail('没有这个定时任务（schedule_list 看 id）')
  const target = a.employee ? all<Employee>('employees').find((e) => e.id === a.employee || e.name === a.employee) : undefined
  if (a.employee && !target) return fail(`没有叫「${a.employee}」的员工（list_employees 看）`)
  const when = a.when === undefined ? undefined : String(a.when).trim()
  const hook = when !== undefined && /^webhook$/i.test(when)
  if (!old && !String(a.prompt ?? '').trim()) return fail('prompt 要写：每次交给员工的那段话')
  try {
    const t = makeTrigger({ ...(when !== undefined ? { kind: hook ? 'Webhook' : '定时', rule: hook ? '' : when } : {}), employee: target?.id ?? old?.employee ?? emp.id, ...(a.prompt !== undefined ? { prompt: a.prompt } : {}), ...(a.name ? { name: a.name } : {}), ...(a.enabled !== undefined ? { enabled: a.enabled } : {}) }, old)
    put('triggers', t); emit({ t: 'put', coll: 'triggers', item: t.hookToken ? { ...t, hookPath: `/hook/${t.hookToken}` } : t })
    audit({ via: emp.name, action: old ? 'trigger.update' : 'trigger.create', target: `${t.name}（${t.rule}）`, level: '写', result: '成功', how: '员工' })
    return ok(`${old ? '已改' : '已建'}「${t.name}」：${t.kind === 'Webhook' ? `有人 POST 到 /hook/${t.hookToken} 时` : t.rule}交给 ${get<Employee>('employees', t.employee)?.name}${t.enabled ? '' : '（停用中）'}`)
  } catch (e) { return fail((e as Error).message) }
}

// ---------- 服务器目录、日志登记（员工自己找、自己登记） ----------
async function serverDirSet(run: Run, emp: Employee, a: { server?: string; path?: string; mode?: string; note?: string; remove?: boolean }): Promise<ToolResult> {
  const sv = findServer(String(a.server ?? ''))
  if (!sv) return fail('没有这台服务器（list_servers 看）')
  const p = String(a.path ?? '').trim().replace(/\/+$/, '')
  const cur = (sv.dirs ?? []).map(({ ok: _o, error: _e, ...d }) => d)
  let next: ServerDir[]
  try {
    next = a.remove ? cur.filter((d) => d.path !== p) : cleanDirs([...cur.filter((d) => d.path !== p), { path: p, mode: a.mode ?? 'read', note: a.note ?? `${emp.name} 登记` }])
  } catch (e) { return fail((e as Error).message) }
  if (!a.remove && a.mode === 'write' && isProtected(sv)) {
    const yes = await confirmCard(run, emp, { title: `让员工能改 ${sv.name} 上的 ${p}`, detail: `登记成「能读写」：AI 用户会拿到这个目录的读写权限（ACL）`, why: String(a.note ?? ''), danger: false })
    if (!yes) return fail('主人没同意')
  }
  await applyDirs(sv, next, (x) => { put('servers', x); emit({ t: 'put', coll: 'servers', item: x }) })
  const got = (get<Server>('servers', sv.id)?.dirs ?? []).find((d) => d.path === p)
  audit({ via: emp.name, action: a.remove ? 'server.dir.remove' : 'server.dir.set', target: `${sv.name} · ${p}${a.remove ? '' : ` · ${a.mode ?? 'read'}`}`, level: '写', result: got?.ok === false ? '失败' : '成功', how: '员工' })
  if (a.remove) return ok(`已去掉 ${sv.name} 上的 ${p}`)
  return got?.ok === false ? fail(`登记了，但开权限没成：${got.error}`) : ok(`已登记 ${sv.name} 上的 ${p}（${a.mode ?? 'read'}）`)
}
function logRegister(emp: Employee, a: { server?: string; kind?: string; path?: string; note?: string; remove?: boolean }): ToolResult {
  const sv = findServer(String(a.server ?? ''))
  if (!sv) return fail('没有这台服务器（list_servers 看）')
  const p = String(a.path ?? '').trim()
  const rest = (sv.logSrc ?? []).filter((x) => !(x.path === p && x.kind === a.kind))
  let logSrc: LogSource[]
  try { logSrc = a.remove ? rest : cleanLogs([...rest, { kind: a.kind, path: p, note: a.note }]) } catch (e) { return fail((e as Error).message) }
  const next = { ...get<Server>('servers', sv.id)!, logSrc }
  put('servers', next); emit({ t: 'put', coll: 'servers', item: next })
  audit({ via: emp.name, action: a.remove ? 'server.log.remove' : 'server.log.set', target: `${sv.name} · ${a.kind} ${p}`, level: '写', result: '成功', how: '员工' })
  return ok(a.remove ? `已去掉 ${sv.name} 的日志 ${p}` : `已登记 ${sv.name} 的日志 ${p}（${a.kind}）；log_scan 不指定就会扫它`)
}

// ---------- 接入：员工自己看现场、自己配，缺 key 才找主人 ----------
async function setupInfo(emp: Employee, a: { workspace?: string }): Promise<ToolResult> {
  const w = findWs(String(a.workspace ?? '') || emp.workspace)
  if (!w) return fail('没有这个项目（不填就是你自己的项目）')
  const creds = all<Credential>('credentials')
  const mine = (c: Credential) => c.aiAllowed && !!emp.creds?.includes(c.id)
  const cv = (c: Credential) => ({ name: c.name, group: c.group, kind: c.kind, env: c.env, youCanUse: mine(c), works: c.test?.ok ?? null })
  const repoCred = w.credential ? creds.find((c) => c.id === w.credential) : undefined
  const platform = build.codeupRepo(w.repo) ? 'Codeup（云效）' : /github\.com/i.test(w.repo) ? 'GitHub' : /gitlab/i.test(w.repo) ? 'GitLab' : /gitee\.com/i.test(w.repo) ? 'Gitee' : '其它 / 自建'
  const comps = build.buildsOf(w)
  const existing: Record<string, unknown> = {}
  const missing: string[] = []
  // 已有的流水线：云效（Codeup 凭证）、Jenkins（「其它 → Jenkins」凭证）
  const codeup = build.codeupRepo(w.repo)
  const yxCreds = creds.filter((c) => c.kind === 'Codeup')
  if (codeup) {
    if (!yxCreds.length) missing.push('Codeup 个人访问令牌（要「流水线」读写）：没有它不能建 / 读云效流水线 → request_credential group=代码仓库 kind=Codeup')
    for (const c of yxCreds.filter(mine).slice(0, 2)) {
      try { existing[`云效（${c.name}）`] = await build.yunxiaoPipelines(c.id, comps.find((x) => x.yunxiao?.org)?.yunxiao?.org || codeup.org) } catch (e) { existing[`云效（${c.name}）`] = `读不到：${(e as Error).message.slice(0, 200)}（令牌可能没勾「流水线」权限）` }
    }
  }
  for (const c of creds.filter((x) => x.kind === 'Jenkins' && mine(x)).slice(0, 2)) {
    try { existing[`Jenkins（${c.name}）`] = await pipes.jenkinsJobs(c.id) } catch (e) { existing[`Jenkins（${c.name}）`] = `读不到：${(e as Error).message.slice(0, 200)}` }
  }
  if (!w.credential) missing.push(`项目没配仓库令牌：Opero 不能替你拉 / 推代码、${platform === 'GitHub' ? '不能提交 GitHub Actions 工作流' : '不能建流水线'} → request_credential group=代码仓库 kind=${platform.startsWith('Codeup') ? 'Codeup' : platform.split(' ')[0]}`)
  const notGranted = creds.filter((c) => c.aiAllowed && !mine(c) && ['代码仓库', '其它', '签名证书', '服务器'].includes(c.group))
  if (notGranted.length) missing.push(`主人有、但没给你开的凭证：${notGranted.map((c) => `${c.name}（${c.group}·${c.kind}）`).join('、')}；要用就请主人在你的档案「能用的凭证」里勾上`)
  const svs = all<Server>('servers')
  if (!(w.deploys ?? []).length) missing.push('还没有发布目标：确定发到哪台、哪个目录后用 release_target_set 建（测试 / 开发环境可以直接建，生产也可以建，发的时候会问主人）')
  return ok(JSON.stringify({
    project: w.name, repo: w.repo, platform, branch: w.branch, codeDir: w.dir, codeServer: get<Server>('servers', w.server ?? '')?.name ?? 'Opero 本机',
    repoToken: repoCred ? { name: repoCred.name, kind: repoCred.kind, works: repoCred.test?.ok ?? null } : null,
    builds: comps.map((x) => ({ component: x.name, summary: build.providerName(x), kind: x.kind, provider: x.provider, pipelineReady: build.pipelineReady(x), pipelineError: x.pipelineError, cmd: x.cmd })),
    releaseTargets: (w.deploys ?? []).map((d) => ({ name: d.name, servers: releases.serversOf(d).map((id) => get<Server>('servers', id)?.name ?? id), dir: d.dir, command: d.command, health: d.health, permission: d.ai ?? 'ask' })),
    servers: svs.map((s) => ({ name: s.name, env: s.env, production: isProtected(s), online: s.online, via: s.via ?? 'ssh', deployDirs: (s.dirs ?? []).filter((x) => x.mode === 'deploy').map((x) => x.path) })),
    credentials: creds.filter((c) => ['代码仓库', '其它', '签名证书', '数据库', '服务器', '云账号'].includes(c.group)).map(cv),
    existingPipelines: existing,
    missing,
    howTo: [
      '看仓库里已有的：.github/workflows、.gitlab-ci.yml、Jenkinsfile、Dockerfile、deploy/、Makefile、*.service、README 里的部署说明——有就照着它配，不要另起一套',
      '平台上已有流水线（existingPipelines）：pipeline_read 读出步骤，把编译命令写进 build_set（custom 的 cmd），部署步骤写进 release_target_set 的 command 或包里的 deploy.sh',
      '都没有：build_set 选模板 → build_generate 建流水线 → build_try 编通 → release_target_set 建目标 → release_publish（生产会问主人）',
      '缺 key 才 request_credential（说清楚要勾哪些权限）；别让主人去网页上自己配编译 / 发布，那是你的活',
    ],
  }, null, 1))
}

async function pipelineRead(emp: Employee, a: { tool?: string; id?: string; workspace?: string }): Promise<ToolResult> {
  const id = String(a.id ?? '').trim()
  if (!id) return fail('给流水线 id / 任务名（setup_info 里有）')
  const creds = all<Credential>('credentials').filter((c) => c.aiAllowed && emp.creds?.includes(c.id))
  try {
    if (a.tool === 'jenkins') {
      const c = creds.find((x) => x.kind === 'Jenkins')
      if (!c) return fail('没有给你开的 Jenkins 凭证')
      return ok(scrub(await pipes.jenkinsJobConfig(c.id, id), [getSecret(c.id) ?? '']))
    }
    const w = findWs(String(a.workspace ?? '') || emp.workspace)
    const org = (w && build.buildsOf(w).find((x) => x.yunxiao?.org)?.yunxiao?.org) || build.codeupRepo(w?.repo ?? '')?.org
    const c = creds.find((x) => x.kind === 'Codeup')
    if (!c || !org) return fail('没有给你开的 Codeup 凭证，或者项目不是 Codeup 仓库')
    return ok(await build.yunxiaoPipeline(c.id, org, id))
  } catch (e) { return fail(`读不到：${(e as Error).message}`) }
}

function releaseTargetSet(emp: Employee, a: { workspace?: string; name?: string; build?: string; servers?: string[]; dir?: string; script?: string; command?: string; health?: string; keep?: number; permission?: string }): ToolResult {
  const w = findWs(String(a.workspace ?? '') || emp.workspace)
  if (!w) return fail('没有这个项目')
  if (w.id !== emp.workspace) return fail('只能配自己项目的发布目标')
  if (emp.approval === 'plan') return fail('现在是「只看不改」')
  const name = String(a.name ?? '').trim().slice(0, 40)
  if (!name) return fail('发布目标要有名字')
  const old = (w.deploys ?? []).find((d) => d.name === name || d.id === name)
  const svs = a.servers ? a.servers.map((k) => findServer(String(k))) : releases.serversOf(old ?? ({ servers: [] } as any)).map((id) => get<Server>('servers', id))
  if (!svs.length || svs.some((x) => !x)) return fail(`服务器不对：${(a.servers ?? []).filter((k) => !findServer(String(k))).join('、') || '至少给一台'}（list_servers 看名字）`)
  const dir = a.dir !== undefined ? String(a.dir).trim().replace(/\/+$/, '') : old?.dir
  if (dir && (!/^\/[\w./@+-]+$/.test(dir) || dir.includes('..') || dir.split('/').filter(Boolean).length < 2)) return fail('部署目录要是绝对路径，至少两层（比如 /srv/app）')
  const health = a.health !== undefined ? String(a.health).trim() : old?.health
  if (health && !/^https?:\/\/\S+$/.test(health)) return fail('检查地址要以 http:// 或 https:// 开头')
  // 发哪个编译组件
  const comps = build.buildsOf(w)
  let bid = old?.build
  if (a.build !== undefined) {
    const k = String(a.build).trim()
    if (k === 'none') bid = 'none'
    else {
      const c = build.findBuild(w, k)
      if (!c) return fail(`没有叫「${k}」的编译组件（有：${comps.map((x) => `「${x.name}」`).join('、') || '还没有，先 build_set'}；不编译写 none）`)
      bid = c.id
    }
  }
  if (!bid && comps.length > 1) return fail(`「${w.name}」有好几个编译组件（${comps.map((x) => `「${x.name}」`).join('、')}）：用 build 说这个目标发哪个`)
  const prod = svs.some((s) => isProtected(s!))
  // 权限：生产一律「发前问主人」；主人设过的不能往松了改
  const rank = { off: 0, ask: 1, auto: 2 } as const
  let ai: 'auto' | 'ask' | 'off' = a.permission === 'auto' && !prod ? 'auto' : a.permission === 'ask' || prod ? 'ask' : old?.ai ?? 'auto'
  if (old?.ai && rank[ai] > rank[old.ai]) ai = old.ai
  const next: Deploy = {
    ...(old ?? { id: uid('dp'), keep: 5, autoRollback: true }), name, build: bid, servers: svs.map((s) => s!.id), dir: dir || undefined,
    script: a.script !== undefined ? String(a.script).trim().replace(/[^\w./-]/g, '') || undefined : old?.script,
    command: a.command !== undefined ? String(a.command).trim().slice(0, 4000) || undefined : old?.command,
    health: health || undefined, keep: a.keep ? Math.max(1, Math.min(Number(a.keep) || 5, 30)) : old?.keep ?? 5, ai,
  }
  // 部署目录登记成「能部署」（发布要求的）：没登记的补上
  const added: string[] = []
  if (next.dir) for (const s of svs) if (!releases.dirAllowed(s!, next.dir)) {
    const cur = get<Server>('servers', s!.id)!
    const sv2 = { ...cur, dirs: [...(cur.dirs ?? []), { path: next.dir, mode: 'deploy' as const, note: `${w.name} · ${name}（${emp.name} 登记）` }] }
    put('servers', sv2); emit({ t: 'put', coll: 'servers', item: sv2 }); added.push(s!.name)
  }
  const cur = get<Workspace>('workspaces', w.id)!
  const deploys = old ? (cur.deploys ?? []).map((d) => (d.id === old.id ? next : d)) : [...(cur.deploys ?? []), next]
  const w2 = { ...cur, deploys }
  put('workspaces', w2); emit({ t: 'put', coll: 'workspaces', item: w2 })
  audit({ via: emp.name, action: old ? 'release.target.update' : 'release.target.create', target: `${w.name} → ${name}（${svs.map((s) => s!.name).join('、')}${next.dir ? ` ${next.dir}` : ''}）`, level: '写', result: '成功', how: '员工' })
  return ok(`${old ? '已改' : '已建'}发布目标「${name}」：发 ${buildLabel(w, next)}，发到 ${svs.map((s) => s!.name).join('、')}${next.dir ? `，目录 ${next.dir}` : ''}${added.length ? `（已在 ${added.join('、')} 上把它登记成能部署）` : ''}；${ai === 'auto' ? '你可以直接发' : '每次发之前会问主人'}${prod && a.permission === 'auto' ? '（有生产服务器，只能「发前问主人」）' : ''}。先 build_try 编通，再 release_publish。`)
}

function requestCredential(emp: Employee, a: { group?: string; kind?: string; why?: string; perms?: string }): ToolResult {
  const group = String(a.group ?? '其它')
  const kind = String(a.kind ?? '').trim()
  const card: Card = {
    id: uid('c'), type: 'generic', v: 1, state: 'open', level: 'warn',
    data: { title: `要一个${kind ? ` ${kind} ` : ''}${group === '其它' ? '凭证' : group + '凭证'}`, tag: '要你给', credReq: { emp: emp.id, group, kind },
      rows: [['用来做什么', String(a.why ?? '')], ...(a.perms ? [['要勾的权限', String(a.perms)]] : []), ['怎么给', '点「去添加」，按页面上的步骤拿到后贴进去保存；存好自动给我用，我接着做']] },
    actions: [{ id: 'add', label: '去添加', style: 'primary', panel: 'credentialEdit', args: { group, ...(kind ? { kind } : {}) } }],
  }
  empSays(emp.id, { kind: 'card', card }, card.data.title, true)
  return ok('已发卡片给主人：存好后你会收到一条消息（凭证名字），收到再接着做；现在先做不需要它的部分，做不了就先停下')
}

/** 这个发布目标发什么：组件名 + 怎么编；不编译 / 没选清楚的说明白 */
function buildLabel(w: Workspace, d: Deploy): string {
  try { const b = build.buildForDeploy(w, d); return b ? `${b.name}（${providerName(b)}）` : '不编译，只跑部署命令' } catch (e) { return (e as Error).message }
}
function releaseList(a: { workspace?: string }): ToolResult {
  const wss = a.workspace ? [findWs(a.workspace)].filter(Boolean) as Workspace[] : all<Workspace>('workspaces').filter((w) => w.deploys?.length)
  const sv = (id?: string) => (id ? get<Server>('servers', id)?.name ?? id : undefined)
  return ok(JSON.stringify(wss.map((w) => ({
    workspace: w.name,
    builds: build.buildsOf(w).map((x) => `${x.name}：${providerName(x)}`), targets: (w.deploys ?? []).map((d) => ({ name: d.name, build: buildLabel(w, d), servers: releases.serversOf(d).map((x) => sv(x)), dir: d.dir, sign: !!d.sign, health: d.health, permission: d.ai ?? 'ask', running: releases.running(w.id, d.id) })),
    latest: releases.list({ ws: w.id, limit: 5 }).map(releases.summary),
  })), null, 1))
}
async function releasePublish(run: Run, emp: Employee, a: { workspace?: string; target?: string; note?: string; reason?: string }): Promise<ToolResult> {
  const w = findWs(String(a.workspace ?? '') || emp.workspace)
  if (!w) return fail('没有这个项目（release_list 看）')
  const d = (w.deploys ?? []).find((x) => x.name === a.target || x.id === a.target)
  if (!d) return fail(`「${w.name}」没有叫「${a.target}」的发布目标（release_list 看）`)
  if (emp.approval === 'plan') return fail('现在是「只看不改」')
  const mode = d.ai ?? 'ask'
  if (mode === 'off') return fail(`「${w.name} → ${d.name}」设成了不许员工发：告诉主人去网页上发`)
  if (mode === 'ask') {
    const svs = releases.serversOf(d).map((id) => get<Server>('servers', id)).filter(Boolean) as Server[]
    const yes = await confirmCard(run, emp, { title: `发布 ${w.name} → ${d.name}`, detail: `${a.note ?? ''}\n\n编译：${buildLabel(w, d)}\n发到：${svs.map((x) => x.name).join('、')}${d.dir ? `（${d.dir}）` : ''}${d.command ? `\n部署命令：${d.command}` : ''}`, why: String(a.reason ?? ''), danger: svs.some((x) => isProtected(x)) })
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
async function dbQuery(run: Run, emp: Employee, a: { database?: string; db?: string; sql?: string; reason?: string }): Promise<ToolResult> {
  const k = String(a.database ?? '')
  const list = all<DataSource>('dataSources')
  // 给的是整个实例里的某个库名，也认：找到那个实例，在这个库里查
  const ds = list.find((d) => d.id === k || d.name === k || (d.db && d.db === k)) ?? list.find((d) => !d.db && d.dbs?.includes(k))
  if (!ds) return fail('没有这个库（用 list_databases 看名字）')
  const db = String(a.db ?? '').trim() || (!ds.db && ds.dbs?.includes(k) ? k : '')
  if (db && ds.db && db !== ds.db) return fail(`「${ds.name}」只接了库 ${ds.db}`)
  const sql = String(a.sql ?? '').trim()
  const blocked = credBlock(emp, ds.credential, `库「${ds.name}」的账号`)
  if (blocked) return fail(blocked)
  const read = isReadSql(sql)
  if (!read) {
    if (!ds.writable) return fail('这个库只接了只读账号，不能改数据')
    if (emp.approval === 'plan') return fail('现在是「只看不改」')
    const danger = /\b(drop|truncate|alter)\b/i.test(sql) || (/^\s*(delete|update)\b/i.test(sql) && !/\bwhere\b/i.test(sql))
    // 生产库、危险语句、或者审核方式不是「自动」才问主人；测试 / 开发库直接改
    const yes = !danger && !isProtected(ds) && emp.approval === 'auto' ? true : await confirmCard(run, emp, { title: `改 ${ds.name}（${ds.env}）的数据`, detail: sql, why: String(a.reason ?? ''), danger: danger || isProtected(ds), note: '改之前没有自动快照，确认 SQL 没问题再点' })
    if (!yes) return fail('主人没同意')
  }
  try {
    const r = await runQuery(ds, sql, { write: !read, db: db || undefined })
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
  if (!w) return fail('没有这个项目')
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

// ---------- 建 / 改员工（员工资料里开了「能管员工」的才行，都要主人点确认） ----------
async function empCreate(run: Run, emp: Employee, a: any): Promise<ToolResult> {
  if (!emp.canManage) return fail('你没有管员工的权限：主人在你的档案里打开「能建、改别的员工」才行')
  const name = String(a.name ?? '').trim().slice(0, 30)
  if (!name || !String(a.prompt ?? '').trim()) return fail('名字和职责都要有')
  if (all<Employee>('employees').some((e) => e.name === name)) return fail('已经有同名的员工')
  const ws = a.workspace ? all<Workspace>('workspaces').find((w) => w.id === a.workspace || w.name === a.workspace) : undefined
  if (a.workspace && !ws) return fail('没有这个项目')
  const sv = a.host ? all<Server>('servers').find((x) => x.id === a.host || x.name === a.host) : undefined
  const exec = /codex/i.test(String(a.executor ?? '')) ? 'Codex' : 'Claude Code'
  const yes = emp.approval === 'auto' ? true : await confirmCard(run, emp, { title: `建一个员工「${name}」`, detail: `职责：${String(a.title ?? '')}\n执行器：${exec}${ws ? `\n项目：${ws.name}` : ''}${sv ? `\n跑在：${sv.name}` : ''}\n\n${String(a.prompt).slice(0, 1500)}`, why: '不会给它任何服务器、库、凭证的权限，要的话你自己给' })
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
  if (ws === undefined && a.workspace) return fail('没有这个项目')
  const patch: Partial<Employee> = {
    ...(a.title !== undefined ? { title: String(a.title).slice(0, 80) } : {}),
    ...(a.prompt !== undefined ? { prompt: String(a.prompt).slice(0, 20000) } : {}),
    ...(a.persona !== undefined ? { persona: String(a.persona).slice(0, 200) } : {}),
    ...(a.workspace !== undefined ? { workspace: ws?.id ?? '', resumeId: undefined } : {}),
  }
  if (!Object.keys(patch).length) return fail('没有要改的')
  const detail = Object.entries(patch).filter(([k2]) => k2 !== 'resumeId').map(([k2, v]) => `${k2}：${String(v).slice(0, 800)}`).join('\n')
  const yes = emp.approval === 'auto' ? true : await confirmCard(run, emp, { title: `改员工「${to.name}」`, detail, why: '它下次干活时记忆仓库里「我的角色」会跟着改' })
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
