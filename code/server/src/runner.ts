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
import { getSecret, scrub, setSecret } from './vault.ts'
import type { Card, CardAction, Credential, Employee, Server, Session, Workspace } from './types.ts'
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
  /** 具体是哪种执行器（kind 是驱动方式） */
  exec: ExecKind
  host: string
  proc: ChildProcess
  stdinOpen: boolean
  pending: number // 已写进去、执行器还没读进去的话（Claude）
  /** 执行器会回显读进去的话（--replay-user-messages）：按回显数待处理的话；不支持的老版本按「一轮结束」数 */
  replay: boolean
  /** 执行器开新一轮的迹象（init / 回复 / 读进话）出过几次：一轮结束后还有待处理的话时，看接下来有没有新的一轮 */
  activity: number
  idle?: ReturnType<typeof setTimeout>
  statusId: string
  said: number // 这一轮说了几段话
  lastResult: string
  stopped: boolean
  /** 这一轮花的（美元，执行器的估算）：最新的累计值 − costBase，不是把每次的累计值加起来 */
  cost: number
  /** 这一轮开始时执行器已经带着的花费（续上会话时恢复的），第一次拿到结果时定 */
  costBase?: number
  /** 这一轮是续哪个会话（--resume 的会话号） */
  resumedFrom?: string
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
  /** 这一轮用的 Claude 账号（凭证 id） */
  cred?: string
  /** 开工时项目的提交（干完的小结和它比） */
  before: string
}

const live = new Map<string, Live>()
/** 进程还在起（第一次要先看执行器支不支持 --effort）：这时来的话先攒着，起好了再交过去 */
const booting = new Map<string, { text: string; files: Attachment[] }[]>()
const stopEarly = new Set<string>()
/** 还在开工准备（拉代码、起执行器）的员工：放弃这一轮（停止、或准备太久） */
const bootAbort = new Map<string, (why: string, requeue: boolean) => void>()
const BOOT_LIMIT = 6 * 60_000
const byToken = new Map<string, { emp: string; sid: string; runId: string; remote?: boolean }>()

/** 干完一轮在收尾（提交记忆、提交推送代码）：这时也算在干活，新来的话排队 */
const finishing = new Set<string>()
export const isWorking = (emp: string) => live.has(emp) || booting.has(emp) || finishing.has(emp)
export const runOf = (token: string) => byToken.get(token)
export const workingList = () => [...live.keys()]

// ---------- AI 执行器的账号（在「AI 执行器」页配，值在保险箱） ----------
/** claudeEgress / codexEgress：网络出口，空 = 从干活那台直连，'local' = 经 Opero 这台，其它 = 经那台 Agent（tunnel.ts） */
/** AI 执行器的账号：Claude / Codex 都可以存好几个（订阅令牌、API Key，各自能带自己的接口地址 = 凭证 meta.baseUrl）；xxxCred 是默认那个；xxxBaseUrl 是没单独设地址的账号共用的 */
export interface AiConf { claudeCred?: string; claudeAccounts?: string[]; claudeBaseUrl?: string; codexCred?: string; codexAccounts?: string[]; codexBaseUrl?: string; claudeEgress?: string; codexEgress?: string
  /** 其它执行器（Qwen Code、CodeBuddy Code…）的账号列表和默认账号 */
  accounts?: Partial<Record<ExecKind, string[]>>; defaults?: Partial<Record<ExecKind, string>> }
/** 执行器种类。驱动方式两种：Codex（codex exec）；其它都是 Claude Code 式的 stream-json（Qwen Code、CodeBuddy Code 的事件和 Claude Code 一样） */
export type ExecKind = 'claude' | 'codex' | 'qwen' | 'codebuddy'
export const EXEC_NAMES: Record<ExecKind, string> = { claude: 'Claude Code', codex: 'Codex', qwen: 'Qwen Code', codebuddy: 'CodeBuddy Code' }
export const kindOf = (executor?: string): ExecKind => { const s = String(executor ?? ''); return /codex/i.test(s) ? 'codex' : /qwen/i.test(s) ? 'qwen' : /codebuddy/i.test(s) ? 'codebuddy' : 'claude' }
export const driverOf = (k: ExecKind): 'claude' | 'codex' => (k === 'codex' ? 'codex' : 'claude')
/** Qwen Code 默认走阿里云百炼的 OpenAI 兼容接口（按量计费的 API Key；Coding Plan 不许接自动化） */
export const QWEN_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
export const QWEN_MODEL = 'qwen3-coder-plus'
export const aiConf = () => kvGet<AiConf>('ai', {})

/** 执行器的网络出口：让它的 HTTPS 请求走干活那台本机的代理，经 Opero 隧道从选的出口出去（出口就是干活那台时直连） */
export function egressEnv(kind: ExecKind, host: string): Record<string, string> {
  if (kind !== 'claude' && kind !== 'codex') return {} // 国产执行器连国内的接口，不用出口
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

/** 读一个 Claude 账号的值：去掉首尾空白；里面有订阅令牌（sk-ant-oat…）就只取令牌（复制时多带了空格、换行也能用） */
export const OAT_RE = /sk-ant-oat\d{2}-[A-Za-z0-9_-]{40,}/
export function claudeKey(id?: string): string {
  const v = (id ? getSecret(id) ?? '' : '').trim()
  return v.match(OAT_RE)?.[0] ?? v
}
/** 是订阅令牌（走 CLAUDE_CODE_OAUTH_TOKEN）还是 API Key：存的时候记在凭证上（meta.authMode）；没记的按值猜——
 *  Anthropic 的 API Key 都是 sk-ant-api 开头，别的都当订阅令牌（令牌格式以后变了也不用改这里） */
export function isOat(k: string, id?: string): boolean {
  if (baseOf('claude', id)) return false // 走代理 / 中转的一律按 API Key
  const mode = id ? get<Credential>('credentials', id)?.meta?.authMode : undefined
  if (mode === 'oauth') return true
  if (mode === 'api') return false
  return !!k && (OAT_RE.test(k) || !/^sk-ant-api/i.test(k))
}

/** 登录过的 Claude 账号（凭证 id）：可以有好几个（买了多个订阅），登录新的不会让旧的失效；claudeCred 是默认那个 */
export function claudeAccounts(): string[] {
  const c = aiConf()
  const list = [...new Set([...(c.claudeAccounts ?? []), ...(c.claudeCred ? [c.claudeCred] : [])])]
  return list.filter((id) => !!getSecret(id))
}
/** Codex 的账号（凭证 id）：也可以有好几个；codexCred 是默认那个 */
export function codexAccounts(): string[] {
  const c = aiConf()
  return [...new Set([...(c.codexAccounts ?? []), ...(c.codexCred ? [c.codexCred] : [])])].filter((id) => !!getSecret(id))
}
/** 这个账号的接口地址：账号自己设的 → 共用的 → 官方（空） */
export function baseOf(kind: ExecKind, id?: string): string {
  const own = id ? String(get<Credential>('credentials', id)?.meta?.baseUrl ?? '').trim() : ''
  const c = aiConf()
  return own || (kind === 'claude' ? c.claudeBaseUrl : kind === 'codex' ? c.codexBaseUrl : '') || ''
}
/** 某种执行器的账号（凭证 id）：Claude / Codex 用原来的列表，其它用 accounts[种类] */
export function accountsOf(k: ExecKind): string[] {
  if (k === 'claude') return claudeAccounts()
  if (k === 'codex') return codexAccounts()
  const c = aiConf()
  return [...new Set([...(c.accounts?.[k] ?? []), ...(c.defaults?.[k] ? [c.defaults[k]!] : [])])].filter((id) => !!getSecret(id))
}
/** 默认账号：设过且还在就用它，不然第一个 */
export function defaultOf(k: ExecKind): string | undefined {
  const list = accountsOf(k)
  const c = aiConf()
  const d = k === 'claude' ? c.claudeCred : k === 'codex' ? c.codexCred : c.defaults?.[k]
  return d && list.includes(d) ? d : list[0]
}
/** Qwen Code 用哪个模型：员工选了就用；没选用账号上记的；都没有用 qwen3-coder-plus */
export function qwenModel(emp?: Employee, cred?: string): string {
  if (emp?.model && emp.model !== '执行器默认') return emp.model
  return String(get<Credential>('credentials', cred ?? '')?.meta?.model ?? '') || QWEN_MODEL
}
/** 用量到上限的账号：到这个时间之前先换别的用 */
const limitedUntil = () => kvGet<Record<string, number>>('claudeLimited', {})
export function markLimited(id: string, ms = 60 * 60_000) { kvSet('claudeLimited', { ...limitedUntil(), [id]: Date.now() + ms }) }
/** 这一轮用哪个账号：员工指定的 → 默认的 → 其它的；到上限的往后排（都到上限就还按原顺序）。Claude、Codex 都这样 */
export function pickAccount(kind: 'claude' | 'codex', emp?: Employee): string | undefined {
  const all = accountsOf(kind)
  if (!all.length) return undefined
  const mine = kind === 'claude' ? emp?.claudeAccount : emp?.codexAccount
  const order = [...new Set([mine, defaultOf(kind), ...all].filter((x): x is string => !!x && all.includes(x)))]
  const lim = limitedUntil()
  return order.find((id) => !(lim[id] > Date.now())) ?? order[0]
}
export const pickClaude = (emp?: Employee) => pickAccount('claude', emp)

// ---------- Codex 的 ChatGPT 订阅账号 ----------
// 订阅账号存的是 Codex 的 auth.json（ChatGPT 登录的令牌，Codex 用的时候自己续期）。每个账号在干活那台上一个自己的 CODEX_HOME：
// AI 用户的 ~/.opero/codex/<账号>/（auth.json 0600；sessions 链到 ~/.codex/sessions，换账号也能接着原来的会话）。
// 保险箱里的是「最新的一份」：起进程前，那台上的版本号（.opero-gen）和保险箱的不一样就写一份进去；跑完把 Codex 续期过的读回来存好（syncCodexAuth）。
/** 这个 Codex 账号是 ChatGPT 订阅（auth.json）还是 API Key */
export function codexMode(id?: string): 'chatgpt' | 'api' {
  if (!id) return 'api'
  const m = get<Credential>('credentials', id)?.meta?.authMode
  if (m === 'chatgpt') return 'chatgpt'
  if (m === 'api') return 'api'
  return /^\s*\{/.test(getSecret(id) ?? '') ? 'chatgpt' : 'api'
}
/** auth.json 里能看出来的：邮箱、套餐（plus / pro / business…）、令牌（打码用） */
export function codexAuthInfo(json: string): { email: string; plan: string; tokens: string[]; ok: boolean } {
  try {
    const j = JSON.parse(json)
    const t = j?.tokens ?? {}
    const tokens = [t.access_token, t.refresh_token, t.id_token, j?.OPENAI_API_KEY].filter((x): x is string => typeof x === 'string' && x.length > 8)
    let email = '', plan = ''
    const idt = String(t.id_token ?? '')
    if (idt.split('.').length === 3) {
      try {
        const p = JSON.parse(Buffer.from(idt.split('.')[1], 'base64url').toString('utf8'))
        email = String(p.email ?? '')
        plan = String(p['https://api.openai.com/auth']?.chatgpt_plan_type ?? '')
      } catch { /* 解不开就算了 */ }
    }
    return { email, plan, tokens, ok: !!t.refresh_token || !!t.access_token }
  } catch { return { email: '', plan: '', tokens: [], ok: false } }
}
/** 起 Codex 之前在那台上准备好这个账号的 CODEX_HOME（bash -c 的脚本，$0 = codex，后面是它的参数） */
const CODEX_PREP = [
  'set -e',
  'b="$HOME/.opero/codex"; d="$b/$OPERO_CODEX_ACCT"',
  'mkdir -p "$d" "$HOME/.codex/sessions"; chmod 700 "$HOME/.opero" "$b" "$d" 2>/dev/null || true',
  'if [ -n "$OPERO_CODEX_AUTH" ] && { [ ! -s "$d/auth.json" ] || [ "$OPERO_CODEX_GEN" != "$(cat "$d/.opero-gen" 2>/dev/null)" ]; }; then',
  '  (umask 077; printf %s "$OPERO_CODEX_AUTH" > "$d/auth.json.tmp" && mv -f "$d/auth.json.tmp" "$d/auth.json"; printf %s "$OPERO_CODEX_GEN" > "$d/.opero-gen")',
  'fi',
  '[ -e "$d/sessions" ] || ln -s "$HOME/.codex/sessions" "$d/sessions" 2>/dev/null || true',
  'unset OPERO_CODEX_AUTH OPERO_CODEX_GEN; export CODEX_HOME="$d"',
  'exec "$0" "$@"',
].join('\n')
/** 要用订阅账号时把 codex 包一层（先准备 CODEX_HOME 再 exec，进程号不变）；API Key 账号原样 */
export function codexCmd(bin: string, args: string[], env: Record<string, string>): [string, string[]] {
  return env.OPERO_CODEX_ACCT ? ['bash', ['-c', CODEX_PREP, bin, ...args]] : [bin, args]
}
/** 跑完把那台上 Codex 续期过的 auth.json 读回来：和保险箱里的不一样就存回去、版本号 +1（别的服务器下次起进程时会拿到新的） */
export async function syncCodexAuth(host: string, id?: string) {
  if (!id || codexMode(id) !== 'chatgpt') return
  const r = await hosts.runAiOn(host, 'bash', ['-c', 'cat "$HOME/.opero/codex/$1/auth.json" 2>/dev/null', '_', id], { timeoutMs: 20_000 })
  const now = r.out.trim()
  if (r.code !== 0 || !now || now === (getSecret(id) ?? '').trim() || !codexAuthInfo(now).ok) return
  const cr = get<Credential>('credentials', id)
  if (!cr) return
  const gen = String(Number(cr.meta?.gen ?? 0) + 1)
  setSecret(id, now)
  put('credentials', { ...cr, meta: { ...(cr.meta ?? {}), gen } })
  // 这台已经是最新的了：把版本号也对上，下次不用再写
  await hosts.runAiOn(host, 'bash', ['-c', 'printf %s "$2" > "$HOME/.opero/codex/$1/.opero-gen"', '_', id, gen], { timeoutMs: 20_000 })
}

export function aiEnv(kind: ExecKind, host: string = hosts.LOCAL, emp?: Employee): { env: Record<string, string>; secrets: string[]; cred?: string } {
  const c = aiConf()
  const env: Record<string, string> = {}
  const secrets: string[] = []
  let cred: string | undefined
  if (kind === 'claude') {
    cred = pickClaude(emp)
    const k = cred ? claudeKey(cred) : ''
    const base = baseOf('claude', cred)
    if (k) { secrets.push(k); env[isOat(k, cred) ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY'] = k }
    if (base) env.ANTHROPIC_BASE_URL = base
    Object.assign(env, { MCP_TIMEOUT: '60000', MCP_TOOL_TIMEOUT: '1900000', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', API_TIMEOUT_MS: '600000' })
  } else if (kind === 'qwen') {
    // Qwen Code：OpenAI 兼容接口（默认百炼），模型员工没选就用账号上记的 / qwen3-coder-plus
    cred = defaultOf('qwen')
    const k = cred ? getSecret(cred)?.trim() : undefined
    if (k) { secrets.push(k); env.OPENAI_API_KEY = k }
    env.OPENAI_BASE_URL = baseOf('qwen', cred) || QWEN_BASE
    env.OPENAI_MODEL = qwenModel(emp, cred)
  } else if (kind === 'codebuddy') {
    // CodeBuddy Code：CodeBuddy 的 API Key；默认国内站（internal），账号上标了国际站就不设
    cred = defaultOf('codebuddy')
    const k = cred ? getSecret(cred)?.trim() : undefined
    if (k) { secrets.push(k); env.CODEBUDDY_API_KEY = k }
    if (String(get<Credential>('credentials', cred ?? '')?.meta?.region ?? '') !== 'intl') env.CODEBUDDY_INTERNET_ENVIRONMENT = 'internal'
    const base = baseOf('codebuddy', cred)
    if (base) env.CODEBUDDY_BASE_URL = base
  } else {
    // Codex：员工指定的账号 → 默认 → 其它（到上限的往后排）。ChatGPT 订阅账号：auth.json 交给 codexCmd 写进这个账号的 CODEX_HOME；API Key 账号：环境变量
    cred = pickAccount('codex', emp)
    const k = cred ? getSecret(cred)?.trim() : undefined
    if (k && codexMode(cred) === 'chatgpt') {
      secrets.push(k, ...codexAuthInfo(k).tokens)
      Object.assign(env, { OPERO_CODEX_ACCT: cred!, OPERO_CODEX_AUTH: k, OPERO_CODEX_GEN: String(get<Credential>('credentials', cred!)?.meta?.gen ?? 0) })
    } else {
      const base = baseOf('codex', cred)
      if (k) { secrets.push(k); Object.assign(env, { OPENAI_API_KEY: k, CODEX_API_KEY: k }) }
      if (base) env.OPENAI_BASE_URL = base
    }
  }
  Object.assign(env, egressEnv(kind, host))
  return { env, secrets, cred }
}

/** 一次性问 AI（不进任何会话）：整理收件箱、写回复建议用。先用 Claude Code（便宜的模型），不行再用 Codex；返回最后的文字 */
export async function oneShot(prompt: string, timeoutMs = 180_000): Promise<string> {
  const tries: [string, string[], 'claude' | 'codex'][] = [
    [cfg.claudeBin, ['-p', '--max-turns', '1', '--output-format', 'text', '--model', 'claude-haiku-5-5'], 'claude'],
    [cfg.codexBin, ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-'], 'codex'],
  ]
  let last = ''
  for (const [bin, args, kind] of tries) {
    const { env, secrets, cred } = aiEnv(kind)
    const [b2, a2] = kind === 'codex' ? codexCmd(bin, args, env) : [bin, args]
    const r = await hosts.runAiOn(hosts.LOCAL, b2, a2, { env, input: prompt, timeoutMs })
    if (kind === 'codex') void syncCodexAuth(hosts.LOCAL, cred).catch(() => {})
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

/** 那台的 claude 支持哪些参数（看 --help；老版本没有的参数不加，免得起不来） */
const helpCache = new Map<string, string>()
async function execHelp(host: string, kind: ExecKind = 'claude'): Promise<string> {
  const key = `${host}:${kind}`
  if (helpCache.has(key)) return helpCache.get(key)!
  const r = await hosts.runAiOn(host, hosts.execBin(kind, host), ['--help'], { timeoutMs: 20_000 })
  if (r.code === 0) helpCache.set(key, r.out) // 没跑成（比如 Agent 刚好断了）不记，下次再问
  return r.out
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

/** 员工资料上显示：在哪台、工作目录、记忆放在哪 */
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
    `你是 Opero 里的 AI 员工「${emp.name}」${emp.role ? `（职位：${emp.role}）` : ''}${emp.title ? `：${emp.title}` : ''}。主人在手机或电脑上通过聊天和你协作。别的员工、文档里可能用你的职位称呼你。`,
    emp.prompt?.trim() && `## 你的角色\n${emp.prompt.trim()}`,
    emp.persona?.trim() && `## 说话风格\n${emp.persona.trim()}`,
    habits && `## 主人的习惯（每次都要遵守）\n${habits}`,
    `## 在 Opero 里怎么干活
- 回复像聊天：简短，先给结论；长内容用 Markdown。
- 服务器、数据库、代码仓库、云的账号都在 Opero 的保险箱里，你拿不到，也不要去找、不要让主人发给你。
- 连服务器用 opero 的 server_exec（先 list_servers 看有哪些）；看日志用 log_scan（按时间统计、第一次 / 最近出现、异常汇总，别整份 cat）；改服务器上的文件用 file_write（自动备份）；要密码 / 令牌就在命令里写 {{secret:凭证名}}（list_credentials 看有哪些），Opero 替你填，你看不到值。
- 查库用 db_query（先 list_databases）；同步 / 推送代码用 git_sync；${emp.dns?.length ? '改域名解析用 dns_list / dns_set / dns_delete（只限主人开给你的域名，改前先看、改后用 dig 确认）；' : ''}${emp.workBranch ? `你在自己的分支 ${emp.workBranch} 上改，做完用 pr_create 提合并请求（pr_status 看合没合）；` : ''}发布用 release_publish（release_list 看有哪些目标、你有没有权限发，release_status 看结果）。
- 接入、编译、发布是你的活，不是主人的：主人只管给 key 和批生产。先 setup_info 看现场（仓库平台、主人有哪些凭证、平台上已有的流水线、服务器、缺什么），再看仓库里已有的（.github/workflows、.gitlab-ci.yml、Jenkinsfile、Dockerfile、deploy/、README 的部署说明）。三种情况：① 已有流水线 / 部署脚本：pipeline_read 读出来，照着它的步骤配 Opero（build_set 的 cmd、release_target_set 的 command 或包里的 deploy.sh），不另起一套；② 什么都没有：自己写 deploy/build.sh 和 deploy.sh，build_set → build_generate → build_try 编通 → release_target_set 建测试 / 生产目标；③ 缺 key（仓库令牌、云效流水线权限、Jenkins Token、数据库账号…）：request_credential 说清楚要什么权限、拿来干嘛，然后等它（主人存好你会收到消息）。不要让主人「去网页上配编译 / 发布 / 目录」，能自己做的都做完再汇报。
- 跑命令时 description 用中文写清楚这一步做什么、为什么（比如「去掉部署脚本里重启失败计数那一行，再检查语法」）：要主人确认时卡片标题就是它，主人看不懂命令。删根目录 / 家目录、格式化、关机重启、curl | sh 这类会被直接拒绝：被拒了别换写法再试，跟主人说清楚由他来做。
- 等发布 / 编译结果不要用 sleep 干等：release_publish 发起后，发完 Opero 会把结果发给你；build_try 隔一会用 build_status 查一次，没编完就先做别的或者这一轮先结束。
- 「应用」里的功能基本都有工具（改服务器 / 数据库的名字和保护、存查询、凭证改名和授权、提醒渠道、预算、系统设置、项目设置、AI 执行器、域名、操作记录…，见 server_update、database_update、saved_query、credential_manage、notify_manage、budget_set、settings_set、workspace_update、ai_status、domain_manage、audit_search）：主人说「帮我改一下 xxx」就直接用工具改；放宽安全的那几种会自动出卡片让主人本人点，你不用自己再问。
- 配置类的事都是你用工具配，不要让主人去页面上填：定时 / Webhook 任务用 schedule_set（schedule_list、schedule_delete），服务器目录用 server_dir_set，日志用 log_register，发布目标用 release_target_set，编译用 build_set。主人一句话说清楚的直接配好，配完一句话告诉他配了什么；说不清的地方先自己查（list_servers、server_exec 看路径），实在定不了再 ask_owner 给几个选项。
- 编译的细节：build_info 看现在怎么编；顺序是写好 deploy/build.sh（把要发的东西放进 out/）和包里的 deploy.sh → 提交推送 → build_set → build_generate（云效、GitHub Actions、GitLab CI、Jenkins）→ build_try → build_status 看日志改到编通。建流水线、试编译、建发布目标都不用问主人；发生产要主人确认。在哪编默认「自动」：编译那台资源够就本地编，不够走流水线；不要自己在服务器上硬跑大编译（Android、Docker 这类）。
- App 的安装包（apk / aab / ipa / dmg / msix / exe / AppImage…）放进项目的「安装包」：每个项目按端（android / ios / mac / windows / linux）× 渠道（test 测试 / prod 正式）一格，每格只留最新一个。发布目标用 release_target_set 的 package（比如 android:test）就会编完签好自动放进去；自己打的用 package_upload；package_list 看现在各格是什么，package_get 拿到自己目录，要给测试同事装就 package_share 出下载链接（扫码能装安卓包）。安卓包要先签名（发布目标选签名证书，或者 sign_package）。打出新包就放进去，不用问主人。
- Opero 给自己发版（发布目标就是 Opero 跑的那台、部署脚本会重启 Opero）：发布中途 Opero 会跟着重启，健康检查和回滚走不完——这种先告诉主人，用别的发布渠道或者在部署脚本里把重启放到最后、用 systemd-run 之类脱离出去。
- 线上问题记进问题清单：issue_report（同一个问题用同一个 key），修好了 issue_update 标 fixed；issue_list 看现在有哪些。
- 要主人在几个方案里选，用 ask_owner；做不可撤销或影响生产的事之前用 confirm；要给主人看结构化的结果用 send_card；要把文件或图片发给主人用 send_file。
- Opero 这边连不上外面的地址（邮箱、提醒渠道、AI Key、DNS、流水线、代码平台的接口报「连不上 / 超时」）：用 egress_manage 先 list 看最近连不上的，test 找一台能连上的服务器，再 set 让那个域名经它出去；别让主人自己去找设置。
- 要图片（头像、插画、图标、配图、界面效果图）用 image_generate：主人存的 AI Key 由 Opero 去调（通义万相、OpenAI、豆包、智谱、硅基流动），图放进你目录的 images/ 并发到聊天；每张都花钱，先出 1 张给主人看风格，定了再批量。没有能用的 Key 它会告诉你找主人要哪个。
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
/** 员工刚说完、在收尾（关输入、提交推送、算小结）的那几秒：主人这时说的话不进排队，照常显示，收尾完马上接着做 */
const nextUp = new Map<string, { text: string; files: Attachment[] }[]>()
export function sendNext(empId: string, text: string, files: Attachment[] = []): boolean {
  const l = live.get(empId)
  if (!finishing.has(empId) && !(l && l.kind === 'claude' && !l.stdinOpen)) return false
  nextUp.set(empId, [...(nextUp.get(empId) ?? []), { text, files }])
  return true
}

export function canInterject(empId: string) {
  if (booting.has(empId)) return true
  const l = live.get(empId)
  return !!l && l.kind === 'claude' && l.stdinOpen
}

// ---------- 花费 ----------
/** 这一轮花了多少。Claude Code 的 total_cost_usd 是累计值（见 docs/设计.md「花费怎么算」）：
 *  ① 流式输入下每次结果都是「这个进程到现在」的累计，不能加起来；② 2.1.277 起续上会话时还会把这个会话之前的花费带回来。
 *  所以：这一轮 = 最新累计 − 开始时带着的（costBase）。带没带（老版本、Qwen 这些不带）看第一次结果：是续的同一个会话，
 *  而且累计花费和累计 token（modelUsage）都不少于上次记下的、累计 token 明显比这一次的多，才当作带了。 */
export function costOf(emp: Employee, l: Pick<Live, 'cost' | 'costBase' | 'resumedFrom'>, ev: { total_cost_usd?: number; modelUsage?: Record<string, any>; session_id?: string }, turnTok: number): number | undefined {
  if (ev.total_cost_usd === undefined || ev.total_cost_usd === null) return
  const total = Number(ev.total_cost_usd) || 0
  const tok = Object.values(ev.modelUsage ?? {}).reduce((n: number, m: any) => n + (m?.inputTokens ?? 0) + (m?.outputTokens ?? 0) + (m?.cacheReadInputTokens ?? 0) + (m?.cacheCreationInputTokens ?? 0), 0)
  if (l.costBase === undefined) {
    const m = emp.costMark
    const carried = !!m && !!l.resumedFrom && m.sid === l.resumedFrom && total >= m.total - 1e-6 && tok > 0 && tok >= m.tok && tok > turnTok * 1.2 + 1000
    l.costBase = carried ? m!.total : 0
  }
  if (ev.session_id) { emp.costMark = { sid: ev.session_id, total, tok }; saveEmp(emp.id, { costMark: emp.costMark }) }
  return Math.max(0, total - l.costBase)
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
  if (emp.budget && monthCostOf({ emp: emp.id }) >= emp.budget) return `「${emp.name}」这个月的预算（$${emp.budget}）用满了，先停下。到员工资料里调高预算再试。`
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
  const exec = kindOf(emp.executor)
  const kind = driverOf(exec) // stream-json（Claude Code / Qwen Code / CodeBuddy Code）还是 codex
  const host = hostOf(emp)
  const { cwd, ws } = cwdOf(emp, host)
  files = place(emp, host, files)
  const runId = uid('r')
  const token = crypto.randomBytes(24).toString('base64url')
  const { env, secrets, cred } = aiEnv(exec, host, emp)
  const mcpEnv = { OPERO_API: hosts.apiBase(host), OPERO_TOKEN: token }
  const uploads = hosts.isLocal(host) ? path.join(empHome(emp), 'uploads') : path.posix.join(homeOn(emp, host), 'uploads')
  const mkdirs = hosts.isLocal(host) ? [] : [uploads, cwd]
  const mcpScript = hosts.isLocal(host) ? MCP_SCRIPT : '{{MCP}}'
  const status = addMsg(s.id, { from: 'system', kind: 'status', spinning: true, text: `${emp.name} 在想…` })
  patchSession(s.id, { working: '在想…' })
  byToken.set(token, { emp: emp.id, sid: s.id, runId, remote: !hosts.isLocal(host) })
  booting.set(emp.id, [])
  // 开工准备每一步都写在状态上（卡住时看得出卡在哪）；6 分钟还没起来就放弃这一轮，不让「在想…」一直挂着
  let lastStep = '在想…'
  let aborted = false
  const step = (t: string) => { if (aborted) return; lastStep = t; patchMsg(status.id, { text: `${emp.name} ${t}` }); patchSession(s.id, { working: t }) }
  const abort = (why: string, requeue: boolean) => {
    if (aborted) return
    aborted = true
    clearTimeout(guard)
    bootAbort.delete(emp.id)
    const early = booting.get(emp.id) ?? []
    booting.delete(emp.id)
    stopEarly.delete(emp.id)
    delMsg(status.id)
    patchSession(s.id, { clear: ['working'] })
    byToken.delete(token)
    system(s.id, why)
    if (requeue) for (const x of early) hooks.busy?.(emp.id, x.text, x.files, '没开起工来，你这句先排队')
  }
  const guard = setTimeout(() => abort(`没能开工：「${lastStep.replace(/…$/, '')}」${BOOT_LIMIT / 60_000} 分钟还没完成，这一轮先放下了。再发一次试试；还卡就看看那台服务器的 Agent 在不在线`, true), BOOT_LIMIT)
  bootAbort.set(emp.id, abort)

  const begin = async () => {
    let proc: ChildProcess
    let replay = false
    // 记忆仓库（没有就建、Opero 管的那段对一遍）和项目（拉到最新）
    // 项目员工：记忆就是项目的 docs/，不另建
    if (!ws) step('在准备记忆…')
    const mem = ws ? { dir: '', note: undefined as string | undefined } : await memory.ensureMemory(emp, host)
    if (aborted) return
    if (ws) step('在拉项目最新代码…')
    const pre = ws ? await autogit.preSync(ws, emp) : ''
    const before = ws ? await autogit.head(ws) : ''
    if (aborted) return // 放弃了就别再动项目（你可能已经又发了一句，新的一轮在拉代码）
    // 只读参考的项目也拉到最新（比如从上游仓库同步代码的项目，要读上游最新的）
    if (emp.reads?.length) step('在拉参考项目的代码…')
    const readNotes = (await Promise.all((emp.reads ?? []).map((id) => get<Workspace>('workspaces', id)).filter((w): w is Workspace => !!w && (w.server ?? hosts.LOCAL) === host).map((w) => autogit.refreshRead(w)))).filter(Boolean).join('\n')
    const notes = [mem.note && `（Opero：${mem.note}）`, pre, readNotes].filter(Boolean).join('\n')
    if (notes) text = `${notes}\n\n${text}`
    if (aborted) return
    const memDirs = ws || mem.note ? [] : [mem.dir]
    step('在准备环境…')
    Object.assign(env, await shimEnv(host, policyOf(get<Server>('servers', host))))
    if (aborted) return
    step('在启动执行器…')
    if (kind === 'claude' && exec !== 'claude') {
      // Qwen Code / CodeBuddy Code：和 Claude Code 一样的 stream-json，参数各自的。没有「每步请示 Opero」的权限工具：
      // 「自动」档和 Codex 一样放开，靠 Opero 的命令拦截（shim）守规矩；「命令要问 / 每步都问」在无界面时等于不许
      const sys = rules(emp, cwd, ws, host, mem.dir)
      const dirs = [uploads, ...memDirs.filter((d) => d !== cwd), ...readDirsOf(emp, host).map((r) => r.dir), ...writeDirsOf(host).map((r) => r.dir)].flatMap((d) => ['--add-dir', d])
      const help = await execHelp(host, exec)
      let args: string[]
      if (exec === 'qwen') {
        const mcp = { mcpServers: { opero: { command: hosts.nodeBin(host), args: ['--disable-warning=ExperimentalWarning', mcpScript], env: mcpEnv, trust: true, timeout: 1_900_000 } } }
        const am = emp.approval === 'plan' ? 'plan' : emp.approval === 'ask' ? 'default' : emp.approval === 'edits' ? 'auto-edit' : 'yolo'
        args = ['--input-format', 'stream-json', '-o', 'stream-json', '--auth-type', 'openai', '--approval-mode', am, '--max-session-turns', String(cfg.maxTurns),
          '--mcp-config', JSON.stringify(mcp), '--append-system-prompt', sys, ...dirs, '-m', qwenModel(emp, cred)]
      } else {
        const mcp = { mcpServers: { opero: { command: hosts.nodeBin(host), args: ['--disable-warning=ExperimentalWarning', mcpScript], env: mcpEnv } } }
        const pm = emp.approval === 'plan' ? 'plan' : emp.approval === 'ask' ? 'default' : emp.approval === 'edits' ? 'acceptEdits' : 'bypassPermissions'
        args = ['-p', '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--permission-mode', pm, '--max-turns', String(cfg.maxTurns),
          '--mcp-config', JSON.stringify(mcp), '--strict-mcp-config', '--allowedTools', 'mcp__opero', '--append-system-prompt', sys, ...dirs]
        if (!cfg.aiUser && hosts.isLocal(host)) args.push('--disallowedTools', `Read(/${cfg.data}/**),Edit(/${cfg.data}/**),Write(/${cfg.data}/**)`)
        if (emp.model && emp.model !== '执行器默认') args.push('--model', emp.model)
        if (emp.effort && help.includes('--effort')) args.push('--effort', emp.effort)
      }
      if (help.includes('--replay-user-messages')) { args.push('--replay-user-messages'); replay = true }
      if (emp.resumeId) args.push('--resume', emp.resumeId)
      proc = hosts.spawnAiOn(host, hosts.execBin(exec, host), args, env, cwd, mkdirs, policyOf(get<Server>('servers', host)).memPct, policyOf(get<Server>('servers', host)).cpuPct)
    } else if (kind === 'claude') {
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
      const help = await execHelp(host, 'claude')
      if (emp.effort && help.includes('--effort')) args.push('--effort', emp.effort)
      if (help.includes('--replay-user-messages')) { args.push('--replay-user-messages'); replay = true }
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
      const [cbin, cargs] = codexCmd(hosts.codexBin(host), args, env)
      proc = hosts.spawnAiOn(host, cbin, cargs, env, cwd, mkdirs, policyOf(get<Server>('servers', host)).memPct, policyOf(get<Server>('servers', host)).cpuPct)
    }
    if (aborted) { killTree(proc); return } // 准备太久已经放弃了 / 你按了停止
    clearTimeout(guard)
    bootAbort.delete(emp.id)
    step('在想…')
    const l: Live = { emp: emp.id, sid: s.id, runId, token, kind, exec, host, proc, stdinOpen: kind === 'claude', pending: 0, replay, activity: 0, statusId: status.id,
      said: 0, lastResult: '', stopped: false, cost: 0, resumedFrom: emp.resumeId, tokens: 0, ok: false, stderr: '', secrets, ask, ws, unwatch: () => {}, warned: 0, before, cred }
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
    clearTimeout(guard)
    bootAbort.delete(emp.id)
    if (aborted) return
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

/** 不再往执行器里写：它把手上的做完就退出 */
function endInput(l: Live) {
  if (l.idle) { clearTimeout(l.idle); l.idle = undefined }
  if (!l.stdinOpen) return
  l.stdinOpen = false
  l.proc.stdin!.end()
}

function onClaude(l: Live, emp: Employee, ev: any) {
  // 新一轮开始的迹象（一轮结束后的零星事件不算）
  if (ev.type === 'assistant' || ev.type === 'user' || (ev.type === 'system' && ev.subtype === 'init')) l.activity++
  switch (ev.type) {
    case 'user':
      // 执行器读进了一句我们写的话（中途插的话可能直接并进正在做的这一轮，也可能另起一轮）
      if (ev.isReplay && l.replay) l.pending = Math.max(0, l.pending - 1)
      return
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
      const u = ev.usage ?? {}
      const turnTok = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
      l.tokens += turnTok // usage 只算这一次（不累计）
      const c = costOf(emp, l, ev, turnTok)
      if (c !== undefined) l.cost = c
      l.ok = !ev.is_error
      if (ev.session_id) saveEmp(emp.id, { resumeId: ev.session_id })
      if (l.said === 0 && typeof ev.result === 'string' && ev.result.trim()) say(l, ev.result)
      if (ev.subtype === 'error_max_turns') system(l.sid, `这一轮步数用完了（${ev.num_turns ?? cfg.maxTurns} 步），说「继续」接着做`)
      else if (ev.is_error && ev.subtype !== 'success') {
        const why = scrub(String(ev.result ?? ev.subtype ?? ''), l.secrets)
        system(l.sid, `这一轮出错了：${why.slice(0, 500)}`)
        limitHit(l, why)
      }
      l.said = 0
      if (!l.replay) l.pending = Math.max(0, l.pending - 1)
      if (l.pending === 0) { endInput(l); return }
      // 还有没读的话：执行器会马上另起一轮（立刻有 system init）。10 秒一点动静都没有，说明插的话已经并进刚才那一轮做完了，收尾，别一直挂着「在看你插的话」
      setStatus(l, `${emp.name} 在看你插的话…`)
      const seen = l.activity
      if (l.idle) clearTimeout(l.idle)
      l.idle = setTimeout(() => { l.idle = undefined; if (l.activity === seen) { l.pending = 0; endInput(l) } }, 10_000)
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
  if (l.idle) { clearTimeout(l.idle); l.idle = undefined }
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
    const sessCost = (get<Session>('sessions', l.sid)?.cost ?? 0) + l.cost
    if (l.cost) patchSession(l.sid, { cost: sessCost })
    const summary = kvGet<{ runSummary?: boolean }>('settings', {}).runSummary !== false
    if (l.ws) {
      setStatus(l, '在提交、推送代码…')
      const r = await autogit.postSync(l.ws, emp, { ok, stopped: l.stopped, ask: l.ask }).catch((e) => `自动提交出错：${(e as Error).message}`)
      if (summary) runSummary(l, ok, r, sessCost, await autogit.runDiff(l.ws, l.before))
      else if (r) system(l.sid, r)
    } else if (summary && l.cost) runSummary(l, ok, '', sessCost, null)
    if (!l.ws) await memory.commitMemory(emp, l.host, `${emp.name}: ${l.ask.replace(/\s+/g, ' ').slice(0, 60) || '一轮'}${ok ? '' : '（没做完）'}`).catch(() => '')
  })().finally(() => {
    finishing.delete(l.emp)
    delMsg(l.statusId)
    patchSession(l.sid, { clear: ['working'] })
    // 收尾时主人说的话：马上开下一轮（几句合成一句）
    const next = nextUp.get(l.emp)
    if (next?.length) { nextUp.delete(l.emp); void send(l.emp, next.map((x) => x.text).filter(Boolean).join('\n\n'), next.flatMap((x) => x.files)) }
    after(l, code, emp)
  })
}

/** 订阅登录（计入订阅额度）还是 API Key（按量计费）：执行器报的花费对订阅只是估算 */
function billing(kind: ExecKind, cred?: string): 'sub' | 'api' {
  const c = aiConf()
  if (kind === 'qwen' || kind === 'codebuddy') return 'api'
  if (kind === 'codex') return !codexAccounts().length || codexMode(cred ?? defaultOf('codex')) === 'chatgpt' ? 'sub' : 'api'
  const id = cred ?? c.claudeCred
  if (baseOf('claude', id)) return 'api'
  const k = claudeKey(id)
  return !k || isOat(k, id) ? 'sub' : 'api'
}

/** 一轮做完的小结卡片：做完没有、提交推送、改了哪些文件、这一轮和这个会话的用量；能撤销 / 发布这次改动 */
function runSummary(l: Live, ok: boolean, git: string, sessCost: number, d: autogit.RunDiff | null) {
  const w = l.ws
  const changed = !!d && d.files > 0
  const actions: CardAction[] = []
  if (w && d?.revertible) actions.push({ id: 'revert', label: '撤销这次改动', style: 'ghost' })
  if (w && changed && d!.pushed) for (const t of (w.deploys ?? []).filter((x) => x.servers?.length).slice(0, 2)) actions.push({ id: `release:${t.id}`, label: (w.deploys!.length > 1 ? `发布到${t.name}` : '发布这次改动'), style: 'primary' })
  const card: Card = { id: uid('c'), type: 'run', v: 1, state: actions.length ? 'open' : 'done', level: 'info', actions,
    data: { ok, stopped: l.stopped, git, ws: w?.id ?? '', before: l.before, after: d?.after ?? '', files: d?.files ?? 0, ins: d?.ins ?? 0, del: d?.del ?? 0, list: d?.list ?? [],
      cost: l.cost, sessionCost: sessCost, tokens: l.tokens, billing: billing(l.exec, l.cred), title: l.ask.replace(/\s+/g, ' ').trim().slice(0, 60) } }
  addMsg(l.sid, { from: l.emp, kind: 'card', card })
}

/** 账号用量到上限（订阅的 5 小时 / 每周额度、429）：记下来，后面的活先换别的账号，并告诉主人 */
function limitHit(l: Live, text: string) {
  if ((l.exec !== 'claude' && l.exec !== 'codex') || !l.cred || !/usage limit|rate.?limit|limit reached|429|quota|too many requests|5-hour limit|weekly limit|try again in/i.test(text)) return
  const m = text.match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i)
  let ms = 60 * 60_000
  if (m) {
    let h = Number(m[1]) % 12 + (/pm/i.test(m[3] ?? '') ? 12 : 0)
    if (!m[3]) h = Number(m[1])
    const t = new Date(); t.setHours(h, Number(m[2] ?? 0), 0, 0)
    if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1)
    ms = Math.min(7 * 86400_000, t.getTime() - Date.now())
  }
  markLimited(l.cred, ms)
  const name = get<Credential>('credentials', l.cred)?.name ?? '这个账号'
  const next = accountsOf(l.exec).filter((id) => id !== l.cred && !(limitedUntil()[id] > Date.now()))
  system(l.sid, next.length ? `「${name}」用量到上限了，后面的活先换「${get<Credential>('credentials', next[0])?.name ?? '另一个账号'}」；说「继续」就用新账号接着做` : `「${name}」用量到上限了，也没有别的可用账号：等额度恢复，或者在「应用 → AI 执行器」再加一个账号`)
}

function after(l: Live, code: number | null, emp: Employee | undefined) {
  // ChatGPT 订阅账号：Codex 跑的时候可能续期了令牌，读回来存进保险箱
  if (l.exec === 'codex') void syncCodexAuth(l.host, l.cred).catch(() => {})
  if (!l.stopped && !l.ok && code !== 0) {
    const err = scrub(l.stderr.trim(), l.secrets).split('\n').slice(-6).join('\n')
    limitHit(l, err)
    const hint = /Request not allowed|unsupported_country|not available in your (country|region)|forbidden/i.test(err) ? '\n\n这台服务器连 Anthropic 被拒绝（所在地区不支持）：到「应用 → AI 执行器」第 2 步「网络出口」把 Claude 设成经海外的服务器出去，或者让这个员工跑在海外那台。'
      : l.exec === 'codex' && codexMode(l.cred) === 'chatgpt' && /refresh|expired|sign in again|log ?in again|401|unauthorized/i.test(err) ? `\n\nChatGPT 登录失效了（「${get<Credential>('credentials', l.cred ?? '')?.name ?? 'Codex 账号'}」）：到「应用 → AI 执行器 → Codex」第 3 步再登录一次这个 ChatGPT 账号，登录好把旧的去掉。`
      : /auth|login|api key|401|credential|unauthorized|OAuth/i.test(err) ? '\n\n像是执行器没登录：到「应用 → AI 执行器」加一个账号（订阅登录或 API Key）。'
      : /not found|No such file|command not found/i.test(err) ? '\n\n像是服务器上没装这个执行器：到「应用 → AI 执行器」一键安装。' : ''
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
    // 还在开工准备：立刻放下（状态清掉），不用等它起来再杀
    const ab = bootAbort.get(empId)
    if (ab) { ab('你让员工停下了', false); return true }
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
