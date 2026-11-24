// 让员工干活：每个员工同一时间最多一个执行器进程（Claude Code / Codex）。
//   Claude Code：claude -p --input-format stream-json --output-format stream-json，stdin 开着，干活时你再发的话直接写进去（插话）；
//     一轮说完、没有待处理的话就关 stdin，进程退出；下一句用 --resume 接着同一个会话。
//   Codex：codex exec --json，提示词走 stdin；干活时你再发的话排队，这一轮完了接着做。
// 执行器跑在 AI 专用的系统用户下（OPERO_AI_USER，经 sudo），读不到 Opero 的数据目录和保险箱；它要连服务器、查库、同步代码都经 MCP 工具找 Opero。
import type { ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { cfg, MCP_SCRIPT } from './config.ts'
import { get, kvGet, kvSet, put, uid } from './db.ts'
import { emit, push } from './bus.ts'
import { addMsg, delMsg, empSays, getMsg, monthCost, monthCostOf, patchMsg, patchSession, recordRun, sessionFor, system } from './chat.ts'
import { getSecret, scrub } from './vault.ts'
import type { Employee, Server, Workspace } from './types.ts'
import * as hosts from './hosts.ts'
import * as agents from './agents.ts'
import * as tunnel from './tunnel.ts'
import * as memory from './memory.ts'
import * as autogit from './autogit.ts'
import { policyOf, policyText, shimBins, SHIM_SCRIPT, type Policy } from './policy.ts'
import { watchResources } from './limits.ts'
import { spawn } from 'node:child_process'

/** path = 员工那台机器上看到的路径；local = Opero 这台上的原文件（远程员工时两者不同） */
export interface Attachment { path: string; name: string; mediaType: string; image: boolean; local?: string }

interface Live {
  emp: string
  sid: string
  runId: string
  token: string
  kind: 'claude' | 'codex'
  host: string
  proc: ChildProcess
  stdinOpen: boolean
  pending: number // 已写进去、还没说完的话（Claude）
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
  /** 这一轮的第一句（自动提交的说明用）、项目、内存看守 */
  ask: string
  ws?: Workspace
  unwatch: () => void
  warned: number
}

const live = new Map<string, Live>()
/** 进程还在起（第一次要先看执行器支不支持 --effort）：这时来的话先攒着，起好了再交过去 */
const booting = new Map<string, { text: string; files: Attachment[] }[]>()
const stopEarly = new Set<string>()
const byToken = new Map<string, { emp: string; sid: string; runId: string; remote?: boolean }>()

/** 干完一轮在收尾（提交记忆、提交推送代码）：这时也算在干活，新来的话排队 */
const finishing = new Set<string>()
export const isWorking = (emp: string) => live.has(emp) || booting.has(emp) || finishing.has(emp)
export const runOf = (token: string) => byToken.get(token)
export const workingList = () => [...live.keys()]

// ---------- AI 执行器的账号（在「AI 执行器」页配，值在保险箱） ----------
/** claudeEgress / codexEgress：网络出口，空 = 从干活那台直连，'local' = 经 Opero 这台，其它 = 经那台 Agent（tunnel.ts） */
export interface AiConf { claudeCred?: string; claudeBaseUrl?: string; codexCred?: string; codexBaseUrl?: string; claudeEgress?: string; codexEgress?: string }
export const aiConf = () => kvGet<AiConf>('ai', {})

/** 执行器的网络出口：让它的 HTTPS 请求走干活那台本机的代理，经 Opero 隧道从选的出口出去（出口就是干活那台时直连） */
export function egressEnv(kind: 'claude' | 'codex', host: string): Record<string, string> {
  const c = aiConf()
  const egress = (kind === 'claude' ? c.claudeEgress : c.codexEgress) || ''
  if (!egress || egress === host) return {}
  let url = ''
  if (hosts.isLocal(host)) url = `http://${encodeURIComponent(egress)}:${tunnel.LOCAL_TOKEN}@127.0.0.1:${tunnel.LOCAL_PORT}`
  else {
    const sv = get<Server>('servers', host)
    if (!sv?.proxyPort || !sv.proxyToken) return {}
    url = `http://${encodeURIComponent(egress)}:${sv.proxyToken}@127.0.0.1:${sv.proxyPort}`
  }
  const opero = (() => { try { return new URL(cfg.publicUrl).hostname } catch { return '' } })()
  const noProxy = ['localhost', '127.0.0.1', '::1', opero].filter(Boolean).join(',')
  return { HTTPS_PROXY: url, https_proxy: url, HTTP_PROXY: url, http_proxy: url, NO_PROXY: noProxy, no_proxy: noProxy }
}

function aiEnv(kind: 'claude' | 'codex', host: string = hosts.LOCAL): { env: Record<string, string>; secrets: string[] } {
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
  Object.assign(env, egressEnv(kind, host))
  return { env, secrets }
}

/** 一次性问 AI（不进任何会话）：整理收件箱、写回复建议用。先用 Claude Code（便宜的模型），不行再用 Codex；返回最后的文字 */
export async function oneShot(prompt: string, timeoutMs = 180_000): Promise<string> {
  const tries: [string, string[], 'claude' | 'codex'][] = [
    [cfg.claudeBin, ['-p', '--max-turns', '1', '--output-format', 'text', '--model', 'claude-haiku-5-5'], 'claude'],
    [cfg.codexBin, ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-'], 'codex'],
  ]
  let last = ''
  for (const [bin, args, kind] of tries) {
    const { env, secrets } = aiEnv(kind)
    const r = await hosts.runAiOn(hosts.LOCAL, bin, args, { env, input: prompt, timeoutMs })
    if (r.code === 0 && r.out.trim()) return scrub(r.out.trim(), secrets)
    last = scrub(r.out, secrets).slice(-300)
  }
  throw new Error(`AI 没回话：${last || '没装 Claude Code / Codex，或没登录'}`)
}

// 本机起进程的工具在 hosts.ts（远程员工经 Agent 跑）；executors 等还按原来的名字用
export const spawnAi = hosts.spawnAi
export const runAi = (bin: string, args: string[], opts: Parameters<typeof hosts.runAiOn>[3] = {}) => hosts.runAiOn(hosts.LOCAL, bin, args, opts)
const killTree = hosts.killTree

/** 员工跑在哪台：local 或装了 Agent 的服务器；那台的 Agent 被移除了就退回本机 */
export function hostOf(emp: Employee): string {
  if (hosts.isLocal(emp.host)) return hosts.LOCAL
  const sv = get<Server>('servers', emp.host)
  return agents.isAgent(sv) ? emp.host : hosts.LOCAL
}

// ---------- 命令拦截：每台机器一个目录放同名小脚本（policy.ts），员工进程的 PATH 最前面是它 ----------
const shimsDone = new Map<string, string>()
async function shimEnv(host: string, p: Policy): Promise<Record<string, string>> {
  const dir = path.posix.join(hosts.workRoot(host), '.opero-shims')
  const bins = shimBins(p)
  const key = bins.join(' ')
  if (shimsDone.get(host) !== key) {
    try {
      if (hosts.isLocal(host)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o2775 })
        for (const b of bins) fs.writeFileSync(path.join(dir, b), SHIM_SCRIPT, { mode: 0o755 })
      } else {
        for (const b of bins) agents.writeFile(host, path.posix.join(dir, b), Buffer.from(SHIM_SCRIPT))
        await new Promise((r) => setTimeout(r, 500))
        await agents.exec(host, `chmod 755 ${dir}/* && chmod 2775 ${dir}`)
      }
      shimsDone.set(host, key)
    } catch { return {} } // 放不了就只靠 Claude Code 的逐条检查和提示词
  }
  const check = hosts.isLocal(host) ? path.join(path.dirname(MCP_SCRIPT), 'policy-check.ts') : '{{SRC}}/policy-check.ts'
  return { OPERO_SHIMS: dir, OPERO_POLICY: JSON.stringify(p), OPERO_NODE: hosts.nodeBin(host), OPERO_CHECK: check }
}

const helpCache = new Map<string, boolean>()
async function supportsEffort(host: string): Promise<boolean> {
  if (helpCache.has(host)) return helpCache.get(host)!
  const r = await hosts.runAiOn(host, hosts.claudeBin(host), ['--help'], { timeoutMs: 20_000 })
  const ok = r.out.includes('--effort')
  if (r.code === 0) helpCache.set(host, ok) // 没跑成（比如 Agent 刚好断了）不记，下次再问
  return ok
}

// ---------- 员工的工作目录和规矩 ----------
/** 员工自己的目录（Opero 这台上；聊天里传的文件先放这里） */
export function empHome(emp: Employee) {
  const d = path.join(cfg.work, 'emp', emp.id)
  fs.mkdirSync(path.join(d, 'uploads'), { recursive: true, mode: 0o2770 })
  return d
}
/** 员工干活那台机器上它自己的目录 */
const homeOn = (emp: Employee, host: string) => (hosts.isLocal(host) ? empHome(emp) : path.posix.join(agents.REMOTE_WORK, 'emp', emp.id))
function cwdOf(emp: Employee, host: string): { cwd: string; ws?: Workspace } {
  const ws = emp.workspace ? get<Workspace>('workspaces', emp.workspace) : undefined
  // 项目要和员工在同一台机器上
  if (ws && (ws.server ?? hosts.LOCAL) === host && (!hosts.isLocal(host) || fs.existsSync(ws.dir))) return { cwd: ws.dir, ws }
  return { cwd: homeOn(emp, host) }
}

/** 员工档案上显示：在哪台、工作目录、记忆放在哪 */
export function whereOf(emp: Employee): { host: string; cwd: string; project?: string; mem: string } {
  const host = hostOf(emp)
  const { cwd, ws } = cwdOf(emp, host)
  return { host, cwd, project: ws?.id, mem: ws ? `${ws.dir}/docs` : memory.memDir(emp, host) }
}
/** 能只读看的别的项目（要和员工在同一台机器上、已经拉下来了） */
export function readDirsOf(emp: Employee, host = hostOf(emp)): { name: string; dir: string }[] {
  const wss = (emp.reads ?? []).slice(0, 8).map((id) => get<Workspace>('workspaces', id)).filter((w): w is Workspace => !!w && w.id !== emp.workspace && (w.server ?? hosts.LOCAL) === host)
    .map((w) => ({ name: w.name, dir: w.dir }))
  // 那台服务器「目录」里登记成只读的
  const sv = get<Server>('servers', hosts.isLocal(host) ? 'local' : host)
  const dirs = (sv?.dirs ?? []).filter((d) => d.mode === 'read' && d.ok !== false).map((d) => ({ name: d.note || d.path, dir: d.path }))
  return [...wss, ...dirs]
}
/** 那台服务器「目录」里登记成读写的：员工能改 */
export function writeDirsOf(host: string): { name: string; dir: string }[] {
  const sv = get<Server>('servers', hosts.isLocal(host) ? 'local' : host)
  return (sv?.dirs ?? []).filter((d) => d.mode === 'write' && d.ok !== false).map((d) => ({ name: d.note || d.path, dir: d.path }))
}

/** 远程员工：聊天里传的文件先送到那台的 uploads 目录 */
function place(emp: Employee, host: string, files: Attachment[]): Attachment[] {
  if (hosts.isLocal(host) || !files.length) return files
  const dir = path.posix.join(homeOn(emp, host), 'uploads')
  return files.map((f) => {
    const remote = path.posix.join(dir, path.basename(f.path))
    try { agents.writeFile(host, remote, fs.readFileSync(f.local ?? f.path)) } catch { /* 读不到就算了 */ }
    return { ...f, path: remote, local: f.local ?? f.path }
  })
}

const MODEL_IDS: Record<string, string> = { 'Opus 5.5': 'claude-opus-5-5', 'Sonnet 5.5': 'claude-sonnet-5-5', 'Haiku 5.5': 'claude-haiku-5-5', 'Fable 5.1': 'claude-fable-5-1' }

const LANG_NAMES: Record<string, string> = { 'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English', ja: '日本語', de: 'Deutsch', fr: 'Français', ar: 'العربية' }

function rules(emp: Employee, cwd: string, ws: Workspace | undefined, host: string, mem: string) {
  const st = kvGet<{ habits?: string; lang?: string; langResolved?: string }>('settings', {})
  const habits = st.habits?.trim()
  const ln = LANG_NAMES[st.lang && st.lang !== 'auto' ? (st.lang === 'zh' ? 'zh-CN' : st.lang) : st.langResolved ?? ''] ?? ''
  return [
    ln && `主人的界面语言是「${ln}」：回复主人、发卡片、写给主人看的内容都用 ${ln}（主人用别的语言跟你说话就跟着主人）。`,
    `你是 Opero 里的 AI 员工「${emp.name}」${emp.title ? `：${emp.title}` : ''}。主人在手机或电脑上通过聊天和你协作。`,
    emp.prompt?.trim() && `## 你的角色\n${emp.prompt.trim()}`,
    emp.persona?.trim() && `## 说话风格\n${emp.persona.trim()}`,
    habits && `## 主人的习惯（每次都要遵守）\n${habits}`,
    `## 在 Opero 里怎么干活
- 回复像聊天：简短，先给结论；长内容用 Markdown。
- 服务器、数据库、代码仓库、云的账号都在 Opero 的保险箱里，你拿不到，也不要去找、不要让主人发给你。
- 连服务器用 opero 的 server_exec（先 list_servers 看有哪些）；看日志用 log_scan（按时间统计、第一次 / 最近出现、异常汇总，别整份 cat）；改服务器上的文件用 file_write（自动备份）；要密码 / 令牌就在命令里写 {{secret:凭证名}}（list_credentials 看有哪些），Opero 替你填，你看不到值。
- 查库用 db_query（先 list_databases）；同步 / 推送代码用 git_sync；${emp.dns?.length ? '改域名解析用 dns_list / dns_set / dns_delete（只限主人开给你的域名，改前先看、改后用 dig 确认）；' : ''}${emp.workBranch ? `你在自己的分支 ${emp.workBranch} 上改，做完用 pr_create 提合并请求（pr_status 看合没合）；` : ''}发布用 release_publish（release_list 看有哪些目标、你有没有权限发，release_status 看结果）。
- 编译 / 打包由 Opero 管（build_info 看现在怎么编）：配或改编译、建流水线按这个顺序——build_info 看现状 → 需要的话写好 deploy/build.sh（把要发的东西放进 out/）和包里的 deploy.sh → 提交推送 → build_set 改设置 → build_generate 建 / 更新流水线（云效、GitHub Actions）→ build_try 试编 → build_status 看日志，改到编通 → release_list 看发布目标。建流水线、试编译不用问主人；发生产要主人确认。在哪编默认「自动」：编译那台资源够就本地编，不够走流水线；不要自己在服务器上硬跑大编译（Android、Docker 这类）。
- 线上问题记进问题清单：issue_report（同一个问题用同一个 key），修好了 issue_update 标 fixed；issue_list 看现在有哪些。
- 要主人在几个方案里选，用 ask_owner；做不可撤销或影响生产的事之前用 confirm；要给主人看结构化的结果用 send_card；要把文件或图片发给主人用 send_file。
- 按约定直接做，少问：只有删重要数据、影响生产（发生产、改生产服务器 / 生产库）这类不可撤销的事才用 confirm；同步代码、建临时文件、清理自己的临时目录、在测试 / 开发环境改东西这些都直接做，不要问主人。
- 临时文件放在你自己的目录 ${path.posix.join(homeOn(emp, host), 'tmp')}（没有就建），不要用 /tmp；在你自己干活的这台机器上直接在终端跑命令，不要用 server_exec（那是管别的服务器用的，以 root 跑）。
- 别的员工更合适的活，用 delegate 转给它（list_employees 看有谁）。${emp.canManage ? '\n- 你能管员工：主人要建新员工或改别的员工的职责，用 emp_create / emp_update（主人会点确认；服务器、库、凭证的权限由主人自己给）。' : ''}
- 共用资料（规范、接口文档、产品说明）先用 kb_search / kb_get 查；值得留给所有员工的，用 kb_save 存进去。
- 工作目录：${cwd}${ws ? `（项目「${ws.name}」，仓库 ${ws.repo}，分支 ${ws.branch}）` : '（就是你的记忆仓库）'}。${ws && autogit.autoOn(ws) ? '\n- 这个项目开了自动同步：开工前 Opero 已经拉到最新；这一轮干完 Opero 会自动提交并推送，你可以自己 commit（写好提交说明），不用推送。' : ''}`,
    mem ? `## 你的记忆仓库：${mem}
- 开工先读 ${mem}/CLAUDE.md 和 ${mem}/docs/交接.md 最上面几条，接着上次做。
- 做完在 docs/交接.md 最上面加一条（做了什么、为什么、怎么验证、还剩什么、下一步），docs/记录/<年-月>.md 记一行流水；机器的事记 docs/机器/。
- 这个仓库每轮干完 Opero 自动提交，换会话、换执行器、换服务器都从这里接着干，所以交接要写清楚。` : `## 记忆：就是这个项目的 docs/
- 开工先读项目里的 CLAUDE.md / AGENTS.md / README 和 docs/交接.md 最上面几条（没有 docs/交接.md 就建一个），接着上次做。
- 做完在 docs/交接.md 最上面加一条（做了什么、为什么、怎么验证、还剩什么、下一步），跟代码一起提交。这个项目可能还有别的员工，大家看同一份交接。`,
    writeDirsOf(host).length && `## 这台服务器上你能改的目录\n${writeDirsOf(host).map((r) => `- ${r.name}：${r.dir}`).join('\n')}`,
    readDirsOf(emp, host).length && `## 只读参考的项目（只能看，不能改）\n${readDirsOf(emp, host).map((r) => `- ${r.name}：${r.dir}`).join('\n')}\n要改这些项目，告诉主人交给负责它的员工。`,
    policyText(policyOf(hosts.isLocal(host) ? get<Server>('servers', 'local') : get<Server>('servers', host)), hosts.isLocal(host) ? 'Opero 这台' : get<Server>('servers', host)?.name ?? host),
  ].filter(Boolean).join('\n\n')
}

// ---------- 排队（queue.ts 接上来）：插不进去的话进队；一轮结束发下一条 ----------
let hooks: { busy?: (emp: string, text: string, files: Attachment[], why?: string) => void; idle?: (emp: string, stopped: boolean) => void; freed?: (host: string) => void } = {}
export function setHooks(h: typeof hooks) { hooks = h }
/** 员工在干活、而且现在能插话（Claude Code 的输入通道开着，或者进程正在起） */
export function canInterject(empId: string) {
  if (booting.has(empId)) return true
  const l = live.get(empId)
  return !!l && l.kind === 'claude' && l.stdinOpen
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
  if (finishing.has(empId)) { hooks.busy?.(empId, text, files, '员工在收尾（提交代码），已排队：马上接着做'); return }
  const cur = live.get(empId)
  if (cur) {
    files = place(emp, cur.host, files)
    if (cur.kind === 'claude' && cur.stdinOpen) {
      writeUser(cur, text, files)
      system(cur.sid, '已插话：员工下一步会看到这句')
    } else hooks.busy?.(empId, text, files)
    return
  }
  const budget = kvGet<{ budget?: number; budgetStop?: boolean }>('settings', {})
  if (budget.budgetStop && budget.budget && monthCost() >= budget.budget) {
    const s = sessionFor(empId)
    system(s.id, `这个月的预算（$${budget.budget}）用满了，员工先停下。到「我 → 设置」里调高预算或关掉「用满先停」再试。`)
    return
  }
  // 单独给员工 / 项目设的预算：用满就停（这两个不看「用满先停」开关，设了就是要管住）
  const over = budgetOver(emp)
  if (over) { system(sessionFor(empId).id, over); return }
  const host = hostOf(emp)
  const max = policyOf(get<Server>('servers', host)).maxConcurrent
  if (max && [...live.values()].filter((x) => x.host === host).length + [...booting.keys()].filter((id) => hostOf(get<Employee>('employees', id) ?? emp) === host).length >= max) {
    hooks.busy?.(empId, text, files, `这台服务器同时最多 ${max} 个员工在干活，已排队：有人做完就轮到它`)
    return
  }
  start(emp, text, files)
}


/** 员工 / 它的项目这个月的预算用满了：返回原因 */
export function budgetOver(emp: Employee): string {
  if (emp.budget && monthCostOf({ emp: emp.id }) >= emp.budget) return `「${emp.name}」这个月的预算（$${emp.budget}）用满了，先停下。到员工档案里调高预算再试。`
  const ws = emp.workspace ? get<Workspace>('workspaces', emp.workspace) : undefined
  if (ws?.budget && monthCostOf({ ws: ws.id }) >= ws.budget) return `项目「${ws.name}」这个月的预算（$${ws.budget}）用满了，先停下。到项目里调高预算再试。`
  return ''
}

/** 一轮做完：员工 / 项目预算到了 80% 提醒一次（每月一次） */
function budgetWarn(emp: Employee, sid: string) {
  const month = new Date().toISOString().slice(0, 7)
  const warned = kvGet<Record<string, string>>('budgetWarned', {})
  const check = (key: string, used: number, cap: number | undefined, label: string) => {
    if (!cap || used < cap * 0.8 || warned[key] === month) return
    warned[key] = month
    kvSet('budgetWarned', warned)
    system(sid, `⚠ ${label}这个月花了 $${used.toFixed(2)}，预算 $${cap} 用了 ${Math.round((100 * used) / cap)}%`)
    push({ kind: 'info', title: '预算快用完了', body: `${label}：$${used.toFixed(2)} / $${cap}`, route: `chat/${sid}` })
  }
  check(`e:${emp.id}`, monthCostOf({ emp: emp.id }), emp.budget, `「${emp.name}」`)
  const ws = emp.workspace ? get<Workspace>('workspaces', emp.workspace) : undefined
  if (ws) check(`w:${ws.id}`, monthCostOf({ ws: ws.id }), ws.budget, `项目「${ws.name}」`)
}

function writeUser(l: Live, text: string, files: Attachment[]) {
  const content: any[] = [{ type: 'text', text: withFiles(text, files) }]
  for (const f of files) {
    if (!f.image || !/^image\/(png|jpeg|gif|webp)$/.test(f.mediaType)) continue
    try {
      const data = fs.readFileSync(f.local ?? f.path)
      if (data.length < 5 * 1024 * 1024) content.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType, data: data.toString('base64') } })
    } catch { /* 读不到就只给路径 */ }
  }
  l.proc.stdin!.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n')
  l.pending++
}

const withFiles = (text: string, files: Attachment[]) =>
  files.length ? `${text}\n\n主人发来的文件（可以直接读）：\n${files.map((f) => `- ${f.path}（${f.name}）`).join('\n')}` : text

function start(emp: Employee, text: string, files: Attachment[]) {
  const ask = text // 主人原话（自动提交的说明用；下面可能在前面加 Opero 的提示）
  const s = sessionFor(emp.id)
  const kind: 'claude' | 'codex' = /codex/i.test(emp.executor) ? 'codex' : 'claude'
  const host = hostOf(emp)
  const { cwd, ws } = cwdOf(emp, host)
  files = place(emp, host, files)
  const runId = uid('r')
  const token = crypto.randomBytes(24).toString('base64url')
  const { env, secrets } = aiEnv(kind, host)
  const mcpEnv = { OPERO_API: hosts.apiBase(host), OPERO_TOKEN: token }
  const uploads = hosts.isLocal(host) ? path.join(empHome(emp), 'uploads') : path.posix.join(homeOn(emp, host), 'uploads')
  const mkdirs = hosts.isLocal(host) ? [] : [uploads, cwd]
  const mcpScript = hosts.isLocal(host) ? MCP_SCRIPT : '{{MCP}}'
  const status = addMsg(s.id, { from: 'system', kind: 'status', spinning: true, text: `${emp.name} 在想…` })
  patchSession(s.id, { working: '在想…' })
  byToken.set(token, { emp: emp.id, sid: s.id, runId, remote: !hosts.isLocal(host) })
  booting.set(emp.id, [])

  const begin = async () => {
    let proc: ChildProcess
    // 记忆仓库（没有就建、Opero 管的那段对一遍）和项目（拉到最新）
    // 项目员工：记忆就是项目的 docs/，不另建
    const mem = ws ? { dir: '', note: undefined as string | undefined } : await memory.ensureMemory(emp, host)
    const pre = ws ? await autogit.preSync(ws, emp) : ''
    // 只读参考的项目也拉到最新（比如从上游仓库同步代码的项目，要读上游最新的）
    const readNotes = (await Promise.all((emp.reads ?? []).map((id) => get<Workspace>('workspaces', id)).filter((w): w is Workspace => !!w && (w.server ?? hosts.LOCAL) === host).map((w) => autogit.refreshRead(w)))).filter(Boolean).join('\n')
    const notes = [mem.note && `（Opero：${mem.note}）`, pre, readNotes].filter(Boolean).join('\n')
    if (notes) text = `${notes}\n\n${text}`
    const memDirs = ws || mem.note ? [] : [mem.dir]
    Object.assign(env, await shimEnv(host, policyOf(get<Server>('servers', host))))
    if (kind === 'claude') {
      const pm = emp.approval === 'plan' ? 'plan' : emp.approval === 'ask' ? 'default' : 'acceptEdits'
      const mcp = { mcpServers: { opero: { command: hosts.nodeBin(host), args: ['--disable-warning=ExperimentalWarning', mcpScript], env: mcpEnv } } }
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json',
        '--permission-mode', pm, '--max-turns', String(cfg.maxTurns),
        '--mcp-config', JSON.stringify(mcp), '--permission-prompt-tool', 'mcp__opero__approve', '--allowedTools', 'mcp__opero',
        '--append-system-prompt', rules(emp, cwd, ws, host, mem.dir), '--add-dir', uploads, ...memDirs.filter((d) => d !== cwd).flatMap((d) => ['--add-dir', d]), ...readDirsOf(emp, host).flatMap((r) => ['--add-dir', r.dir]), ...writeDirsOf(host).flatMap((r) => ['--add-dir', r.dir])]
      if (!cfg.aiUser && hosts.isLocal(host)) args.push('--disallowedTools', `Read(/${cfg.data}/**),Edit(/${cfg.data}/**),Write(/${cfg.data}/**)`)
      // 显示名（Opus 5.5）换成型号；从接口读到的完整型号（claude-…）直接用
      const mid = MODEL_IDS[emp.model] ?? (/^claude-[\w.-]+$/.test(emp.model ?? '') ? emp.model : '')
      if (mid) args.push('--model', mid)
      if (emp.effort && (await supportsEffort(host))) args.push('--effort', emp.effort)
      if (emp.resumeId) args.push('--resume', emp.resumeId)
      proc = hosts.spawnAiOn(host, hosts.claudeBin(host), args, env, cwd, mkdirs, policyOf(get<Server>('servers', host)).memPct, policyOf(get<Server>('servers', host)).cpuPct)
    } else {
      const q = (v: string) => JSON.stringify(v)
      const args = ['exec',
        '-c', `mcp_servers.opero.command=${q(hosts.nodeBin(host))}`,
        '-c', `mcp_servers.opero.args=[${q('--disable-warning=ExperimentalWarning')},${q(mcpScript)}]`,
        '-c', `mcp_servers.opero.env.OPERO_API=${q(mcpEnv.OPERO_API)}`,
        '-c', `mcp_servers.opero.env.OPERO_TOKEN=${q(token)}`,
        '-c', 'mcp_servers.opero.tool_timeout_sec=1800']
      const imgs = files.filter((f) => f.image).map((f) => f.path)
      if (imgs.length) args.push('--image', imgs.join(','))
      args.push('--json', '--skip-git-repo-check', '-C', cwd)
      const roots = [uploads, ...memDirs, ...writeDirsOf(host).map((r) => r.dir)].filter((d) => d !== cwd)
      if (roots.length) args.push('-c', `sandbox_workspace_write.writable_roots=[${roots.map(q).join(',')}]`)
      if (emp.approval === 'plan') args.push('--sandbox', 'read-only')
      else if (emp.approval === 'auto') args.push('--dangerously-bypass-approvals-and-sandbox')
      else args.push('--sandbox', 'workspace-write')
      const eff = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' }[emp.effort]
      if (eff) args.push('-c', `model_reasoning_effort=${q(eff)}`)
      if (emp.model && emp.model !== '执行器默认') args.push('-m', emp.model)
      if (emp.resumeId) args.push('resume', emp.resumeId)
      args.push('-')
      proc = hosts.spawnAiOn(host, hosts.codexBin(host), args, env, cwd, mkdirs, policyOf(get<Server>('servers', host)).memPct, policyOf(get<Server>('servers', host)).cpuPct)
    }
    const l: Live = { emp: emp.id, sid: s.id, runId, token, kind, host, proc, stdinOpen: kind === 'claude', pending: 0, statusId: status.id,
      said: 0, lastResult: '', stopped: false, cost: 0, tokens: 0, ok: false, stderr: '', secrets, ask, ws, unwatch: () => {}, warned: 0 }
    // 内存上限（这台的规矩）：本机在这里看着，远程由 Agent 看着、超了在 stderr 里说一句
    const { memPct, cpuPct } = policyOf(get<Server>('servers', host))
    if (hosts.isLocal(host)) l.unwatch = watchResources(proc.pid, { memPct, cpuPct }, {
      signal: (pid, sig) => { if (cfg.aiUser) spawn('sudo', ['-n', '-u', cfg.aiUser, 'kill', `-${sig.slice(3)}`, String(pid)], { stdio: 'ignore' }).on('error', () => {}); else process.kill(pid, sig) },
      warnCpu: (pct) => { if (Date.now() - l.warned > 5 * 60_000) { l.warned = Date.now(); system(l.sid, `⚠ ${emp.name} 的进程用了这台 ${pct}% CPU（上限 ${cpuPct}%），一直这样会先暂停最占 CPU 的进程`) } },
      paused: (p, pct) => system(l.sid, `⏸ CPU 一直超过上限（${pct}% > ${cpuPct}%），先暂停了：${p.cmd || p.pid}。机器降下来会自动继续`),
      resumed: (p) => system(l.sid, `▶ 机器降下来了，继续：${p.cmd || p.pid}`),
      stoppedCpu: (p) => system(l.sid, `⚠ 暂停了 10 分钟机器还是忙，停掉了：${p.cmd || p.pid}。要编译就交给流水线（发布里的编译设置）`),
      warn: (pct) => { if (Date.now() - l.warned > 5 * 60_000) { l.warned = Date.now(); system(l.sid, `⚠ ${emp.name} 的进程用了这台 ${pct}% 内存（上限 ${memPct}%），一直这样会停掉最大的那个进程`) } },
      killed: (p, pct) => system(l.sid, `⚠ 内存超过上限（${pct}% > ${memPct}%），停掉了最大的进程：${p.cmd || p.pid}（${p.mb} MB）`),
    })
    live.set(emp.id, l)
    if (stopEarly.delete(emp.id)) { l.stopped = true; killTree(proc) }
    const early = booting.get(emp.id) ?? []
    booting.delete(emp.id)
    proc.stdin!.on('error', () => { l.stdinOpen = false }) // 进程已经退了还往里写：不要把后台带崩
    proc.stderr!.on('data', (b) => {
      const t = String(b)
      for (const line of t.split('\n')) if (line.startsWith('[opero] ')) system(l.sid, line.slice(8)) // Agent 那边的提醒（内存上限）
      l.stderr = (l.stderr + t).slice(-4000)
    })
    proc.on('error', (e) => { l.stderr += `\n${e.message}` })
    if (kind === 'claude') {
      writeUser(l, text, files)
      for (const x of early) writeUser(l, x.text, x.files)
    } else {
      const first = emp.resumeId ? withFiles(text, files) : `${rules(emp, cwd, ws, host, mem.dir)}\n\n---\n\n${withFiles(text, files)}`
      proc.stdin!.end(first)
      for (const x of early) hooks.busy?.(emp.id, x.text, x.files)
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
  finishing.add(l.emp)
  live.delete(l.emp)
  l.unwatch()
  setTimeout(() => byToken.delete(l.token), 10_000)
  cancelPending(l.runId, '员工这一轮已经结束')
  const emp = get<Employee>('employees', l.emp)
  if (l.ctx && emp) saveEmp(emp.id, { contextUsed: Math.min(100, Math.round((100 * l.ctx) / 200_000)) })
  recordRun(l.runId, l.emp, l.ok && !l.stopped, l.cost, l.tokens, l.ws?.id ?? '')
  if (emp) budgetWarn(emp, l.sid)
  // 收尾：记忆仓库提交、项目提交推送，做完再放下一条排队的（免得两轮同时动 git）
  const ok = l.ok && !l.stopped
  ;(async () => {
    if (!emp) return
    if (l.ws) { setStatus(l, '在提交、推送代码…'); const r = await autogit.postSync(l.ws, emp, { ok, stopped: l.stopped, ask: l.ask }).catch((e) => `自动提交出错：${(e as Error).message}`); if (r) system(l.sid, r) }
    if (!l.ws) await memory.commitMemory(emp, l.host, `${emp.name}: ${l.ask.replace(/\s+/g, ' ').slice(0, 60) || '一轮'}${ok ? '' : '（没做完）'}`).catch(() => '')
  })().finally(() => {
    finishing.delete(l.emp)
    delMsg(l.statusId)
    patchSession(l.sid, { clear: ['working'] })
    after(l, code, emp)
  })
}

function after(l: Live, code: number | null, emp: Employee | undefined) {
  if (!l.stopped && !l.ok && code !== 0) {
    const err = scrub(l.stderr.trim(), l.secrets).split('\n').slice(-6).join('\n')
    const hint = /auth|login|api key|401|credential|unauthorized|OAuth/i.test(err) ? '\n\n像是执行器没登录：到「我 → AI 执行器」配 API Key，或者在服务器上用 AI 用户登录一次。'
      : /not found|No such file|command not found/i.test(err) ? '\n\n像是服务器上没装这个执行器：到「我 → AI 执行器」看安装方法。' : ''
    system(l.sid, `执行器退出了（${code}）${err ? '：\n' + err : ''}${hint}`)
    push({ kind: 'info', error: true, title: emp?.name ?? '员工', body: '执行器出错了', route: `chat/${l.sid}` })
  }
  hooks.idle?.(l.emp, l.stopped)
  hooks.freed?.(l.host)
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
  cancelPending(l.runId, '你让员工停下了')
  killTree(l.proc)
  system(l.sid, '你让员工停下了')
  return true
}

/** 新话题：下一句开一个新的执行器会话（上下文清空）；员工的目录和项目都还在 */
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
