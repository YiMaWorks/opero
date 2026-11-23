// AI 执行器的「傻瓜式」安装和登录：网页上点按钮，这里替用户在服务器上做。
//   安装：以 AI 用户跑官方安装脚本（curl https://claude.ai/install.sh | bash），不行再用 npm（国内镜像）装；Codex 用 npm 装。
//   登录（Claude 订阅）：以 AI 用户跑 `claude setup-token`。它是全屏终端界面，输出不是终端时什么都不打，所以用 util-linux 的
//     script 给它一个伪终端，再用下面的小终端模拟器还原屏幕找登录网址和 token；网页把网址给用户，用户在浏览器里批准后把授权码贴回来，
//     这里写进它的输入；拿到 token 先跑一次最小请求验证，再加密存进保险箱。token 不落文件、不进日志。
// 同一时间只做一件事（一个 job），网页每秒问一次进度。
import type { ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { kvSet, put, uid } from './db.ts'
import { emit } from './bus.ts'
import { audit } from './chat.ts'
import { setSecret } from './vault.ts'
import { cfg } from './config.ts'
import * as runner from './runner.ts'
import * as hosts from './hosts.ts'
import type { Credential } from './types.ts'

export interface Job {
  id: string
  type: 'install' | 'login'
  executor: 'claude' | 'codex'
  /** 在哪台机器上装 / 登录（local 或装了 Agent 的服务器） */
  host: string
  /** 登录界面现在显示的最后几行（令牌打码），卡住时给人看 */
  screen?: string
  state: 'running' | 'waitCode' | 'verifying' | 'ok' | 'fail'
  log: string
  url?: string
  message?: string
  started: number
  /** 授权码交上去的时间 */
  codeAt?: number
}

let job: Job | null = null
let proc: ChildProcess | null = null

export const currentJob = () => job

function log(t: string) {
  if (!job) return
  job.log = (job.log + t).slice(-6000)
}
function done(state: 'ok' | 'fail', message: string) {
  if (!job) return
  job.state = state
  job.message = message
  proc = null
}

/** 以 AI 用户跑一段 shell，输出进 job 日志 */
function sh(host: string, script: string, env: Record<string, string> = {}, timeoutMs = 8 * 60_000): Promise<number> {
  return new Promise((resolve) => {
    const p = hosts.spawnAiOn(host, 'bash', ['-c', script], env, hosts.workRoot(host))
    proc = p
    p.stdin!.on('error', () => {})
    p.stdin!.end()
    const add = (b: Buffer) => log(b.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r(?!\n)/g, '\n'))
    p.stdout!.on('data', add)
    p.stderr!.on('data', add)
    const t = setTimeout(() => hosts.killTree(p), timeoutMs)
    p.on('close', (code) => { clearTimeout(t); resolve(code ?? -1) })
    p.on('error', (e) => { log(`\n${e.message}\n`); clearTimeout(t); resolve(-1) })
  })
}

// ---------- 安装 ----------
const CLAUDE_OFFICIAL = 'curl -fsSL https://claude.ai/install.sh | bash'
// 官方脚本没装完 / 以前装坏了，会在 ~/.local/bin 留一个跑不起来的 claude（npm 不肯覆盖：EEXIST）：跑不起来的先挪开再装
const NPM = (pkg: string, bin: string, reg = '') => `command -v npm >/dev/null || { echo "没有 npm"; exit 1; }
f="$HOME/.local/bin/${bin}"
if [ -e "$f" ] || [ -L "$f" ]; then
  if "$f" --version >/dev/null 2>&1; then echo "$f 已经能用"; exit 0; fi
  echo "$f 跑不起来（上次没装完），挪到 $f.broken 再装"; mv -f "$f" "$f.broken"
fi
npm install -g ${pkg} --prefix "$HOME/.local" --no-fund --no-audit${reg ? ` --registry ${reg}` : ''}`
const MIRROR = 'https://registry.npmmirror.com'

export function startInstall(executor: 'claude' | 'codex', host = hosts.LOCAL): Job {
  if (job && (job.state === 'running' || job.state === 'waitCode' || job.state === 'verifying')) throw new Error('正在做另一件事，等它做完')
  job = { id: uid('j'), type: 'install', executor, host, state: 'running', log: '', started: Date.now() }
  const steps = executor === 'claude'
    ? [['用官方安装脚本装 Claude Code', CLAUDE_OFFICIAL], ['官方脚本没成功，改用 npm 装', NPM('@anthropic-ai/claude-code', 'claude')], ['再试国内镜像', NPM('@anthropic-ai/claude-code', 'claude', MIRROR)]]
    : [['用 npm 装 Codex', NPM('@openai/codex', 'codex')], ['再试国内镜像', NPM('@openai/codex', 'codex', MIRROR)]]
  const bin = executor === 'claude' ? cfg.claudeBin : cfg.codexBin
  ;(async () => {
    for (const [title, script] of steps) {
      log(`\n▶ ${title}\n`)
      const code = await sh(host, script, runner.egressEnv(executor, host))
      // 退出码不是 0 也看一眼：官方脚本有时装好了、最后一步报错
      const v = await hosts.runAiOn(host, bin, ['--version'], { timeoutMs: 20_000 })
      if (v.code === 0) {
        log(`\n✓ 装好了：${v.out.split('\n').pop()}\n`)
        audit({ via: '—', action: 'ai.install', target: executor === 'claude' ? 'Claude Code' : 'Codex', level: '写', result: '成功', how: '网页一键安装' })
        return done('ok', v.out.split('\n').pop() ?? '')
      }
      if (code === 0) log(`\n装完了但找不到命令：${v.out.slice(-300)}\n`)
    }
    done('fail', '没装上：看上面的日志。常见原因是服务器连不上外网，可以让运维帮忙按 INSTALL.md 手动装')
  })()
  return job
}

// ---------- Claude 订阅登录（claude setup-token） ----------
const OSC8 = /\x1b\]8;[^;\x07\x1b]*;(https:\/\/[^\x07\x1b\s]+)(?:\x07|\x1b\\)/
const URL_RE = /https:\/\/(claude\.ai|claude\.com|console\.anthropic\.com)\/[^\s"'<>]+/
const TOKEN_RE = /sk-ant-oat\d{2}-[A-Za-z0-9_-]{40,}/
// 授权码贴回去以后屏幕上出现这些就算失败（措辞以后可能变：宽一点）
const ERR_RE = /(OAuth error|Login failed|Authentication failed|Invalid (authorization )?code|invalid_grant|expired|Error:|failed)/i

export function startLogin(host = hosts.LOCAL): Job {
  if (job && (job.state === 'running' || job.state === 'waitCode' || job.state === 'verifying')) throw new Error('正在做另一件事，等它做完')
  job = { id: uid('j'), type: 'login', executor: 'claude', host, state: 'running', log: '', started: Date.now() }
  const j = job
  const vt = new Screen(60, 500)
  let raw = ''
  let token = ''
  let tokenShort = '' // 没接下一行的那个（接错了时退回它）
  let fail = ''
  const p = hosts.spawnAiOn(host, 'script', ['-qfec', `stty cols 500 rows 60 2>/dev/null; exec ${cfg.claudeBin} setup-token`, '/dev/null'],
    { TERM: 'xterm-256color', NO_COLOR: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ...runner.egressEnv('claude', host) }, hosts.workRoot(host))
  proc = p
  p.stdin!.on('error', () => {})
  const scan = () => {
    const lines = vt.lines()
    // 令牌一般在一行里；万一被界面的框折成两行（令牌正好顶到行尾），把下一行开头的那段接上
    const clean = (l: string) => l.replace(/[│┃║|]/g, ' ').trim()
    lines.forEach((l, i) => {
      const c = clean(l)
      const t0 = c.match(TOKEN_RE)?.[0]
      if (!t0) return
      const t = c.endsWith(t0) && lines[i + 1] ? t0 + (clean(lines[i + 1]).match(/^[A-Za-z0-9_-]+/)?.[0] ?? '') : t0
      if (t.length > token.length) { token = t; tokenShort = t0 }
    })
    if (j.codeAt) for (const l of lines.slice(-12)) if (ERR_RE.test(l) && !/https:\/\//.test(l)) fail = l.trim().replace(/^[✘✗×\s]+/, '').slice(0, 200)
    j.screen = lines.slice(-8).join('\n').replace(TOKEN_RE, '***').replace(/https:\/\/\S+/g, '（登录网址）').slice(-800)
    if (!j.url) {
      const u = raw.match(OSC8)?.[1] ?? lines.map((l) => l.match(URL_RE)?.[0]).find((u) => u && u.includes('oauth') && u.includes('state='))
      if (u && URL_RE.test(u)) { j.url = u; j.state = 'waitCode'; raw = ''; log('登录网址已生成，等你在浏览器里批准，再把授权码贴回来\n') }
    }
  }
  const decOut = new StringDecoder('utf8')
  const decErr = new StringDecoder('utf8')
  const onData = (s: string) => {
    vt.write(s)
    if (!j.url) raw = (raw + s).slice(-256 * 1024)
    scan()
    if ((token || fail) && j.state !== 'verifying' && j.state !== 'ok' && j.state !== 'fail') setTimeout(finish, 1200) // 这一帧可能还没画完
  }
  p.stdout!.on('data', (b: Buffer) => onData(decOut.write(b)))
  p.stderr!.on('data', (b: Buffer) => onData(decErr.write(b)))
  const timer = setTimeout(() => { if (j.state === 'running' || j.state === 'waitCode') { kill(); done('fail', j.url ? '等了 15 分钟没收到授权码，重新点「开始登录」' : '没拿到登录网址') } }, 15 * 60_000)
  // 授权码交上去 2 分钟还没结果：多半是界面换了说法认不出来，停下来把屏幕给人看
  const stuck = setInterval(() => {
    if (job !== j || finished) { clearInterval(stuck); return }
    if (j.codeAt && Date.now() - j.codeAt > 120_000 && j.state === 'running') { clearInterval(stuck); finished = true; clearTimeout(timer); kill(); done('fail', `交了授权码 2 分钟没结果，登录界面最后显示：${j.screen || '（空）'}。重新点「开始登录」，拿到授权码马上贴`) }
  }, 5000)
  let finished = false
  const finish = async () => {
    if (finished || job !== j) return
    scan()
    if (!token && !fail) return
    finished = true
    clearTimeout(timer)
    kill()
    if (!token) return done('fail', `没登录成功：${fail}（授权码只能用一次，重新点「开始登录」）`)
    j.state = 'verifying'
    log('已拿到令牌，正在验证能不能用…\n')
    const check = (t: string) => hosts.runAiOn(j.host, cfg.claudeBin, ['-p', '--max-turns', '1', '--output-format', 'text'], { env: { CLAUDE_CODE_OAUTH_TOKEN: t, ...runner.egressEnv('claude', j.host) }, input: 'Reply with exactly: OK', timeoutMs: 120_000 })
    let v = await check(token)
    if ((v.code !== 0 || !/OK/.test(v.out)) && tokenShort && tokenShort !== token) { const v2 = await check(tokenShort); if (v2.code === 0 && /OK/.test(v2.out)) { v = v2; token = tokenShort } }
    if (v.code !== 0 || !/OK/.test(v.out)) return done('fail', `登录成功了，但用它跑 Claude Code 被拒绝：${v.out.split(token).join('••••').slice(-300)}`)
    saveClaudeToken(token)
    log('验证通过，已加密保存\n')
    done('ok', '已登录，员工可以干活了')
  }
  p.on('close', () => { if (!finished) { scan(); if (token || fail) finish(); else if (j.state === 'running' || j.state === 'waitCode') { clearTimeout(timer); done('fail', `登录界面退出了：${vt.lines().slice(-4).join(' / ').replace(TOKEN_RE, '***').slice(0, 300) || '没有输出（服务器上可能没有 script 命令）'}`) } } })
  p.on('error', (e) => { clearTimeout(timer); done('fail', `启动不了：${e.message}`) })
  return j
}

function kill() {
  const p = proc
  if (!p) return
  try { p.stdin?.end() } catch { /* 没了 */ }
  hosts.killTree(p)
}

/** 把浏览器里拿到的授权码写进正在跑的 setup-token（原始输入模式：先贴码，再单独发回车） */
export function sendCode(code: string) {
  const c = code.trim()
  if (!job || job.type !== 'login' || job.state !== 'waitCode' || !proc) throw new Error('现在没有在登录，重新点「开始登录」')
  if (!c || c.length > 400 || /[\r\n\x1b]/.test(c)) throw new Error('授权码不对')
  const p = proc
  p.stdin!.write(c)
  setTimeout(() => p.stdin?.write('\r'), 400)
  job.state = 'running'
  job.codeAt = Date.now()
  log('收到授权码，正在向 Anthropic 确认…\n')
}

export function cancelJob() {
  kill()
  if (job && job.state !== 'ok' && job.state !== 'fail') done('fail', '已取消')
}

function saveClaudeToken(token: string) {
  const conf = runner.aiConf()
  const id = conf.claudeCred ?? uid('cr')
  setSecret(id, token)
  const cred: Credential = { id, name: 'Claude Code 的登录令牌', group: 'AI', kind: 'Token', env: '生产', scope: 'Claude 订阅（一年有效）', usedBy: [], updated: new Date().toLocaleString('zh-CN', { hour12: false }).slice(0, 16), aiAllowed: true }
  put('credentials', cred)
  emit({ t: 'put', coll: 'credentials', item: { ...cred, hasSecret: true } })
  kvSet('ai', { ...conf, claudeCred: id })
  audit({ via: '—', action: 'ai.login', target: 'Claude Code（订阅）', level: '危险', result: '成功', how: '网页登录，令牌已加密保存' })
}

// ---------- 小终端模拟器：只还原屏幕上的字（光标移动、擦除、换行滚屏），颜色等一律忽略 ----------
class Screen {
  rows: number
  cols: number
  cells: string[][]
  r = 0
  c = 0
  pend = ''
  constructor(rows: number, cols: number) {
    this.rows = rows
    this.cols = cols
    this.cells = Array.from({ length: rows }, () => this.blank())
  }
  blank() { return Array<string>(this.cols).fill(' ') }
  clamp() { this.r = Math.max(0, Math.min(this.rows - 1, this.r)); this.c = Math.max(0, Math.min(this.cols, this.c)) }
  lf() { if (this.r >= this.rows - 1) { this.cells.shift(); this.cells.push(this.blank()) } else this.r++ }
  put(ch: string) { if (this.c >= this.cols) { this.c = 0; this.lf() } this.cells[this.r][this.c++] = ch }
  erase(row: number, from: number, to: number) { if (row < 0 || row >= this.rows) return; for (let i = Math.max(0, from); i < Math.min(to, this.cols); i++) this.cells[row][i] = ' ' }
  clear() { this.cells = Array.from({ length: this.rows }, () => this.blank()) }
  csi(params: string, fin: string) {
    if (/^[?<>=]/.test(params)) {
      if (params.startsWith('?') && (fin === 'h' || fin === 'l') && /104[79]/.test(params)) { this.clear(); this.r = this.c = 0 }
      return
    }
    const n = params.split(';').map((x) => (x.trim() === '' ? -1 : Number(x)))
    const arg = (i: number, d: number) => (n[i] !== undefined && n[i] >= 0 && !Number.isNaN(n[i]) ? n[i] : d)
    const one = () => Math.max(1, arg(0, 1))
    switch (fin) {
      case 'A': this.r -= one(); break
      case 'B': case 'e': this.r += one(); break
      case 'C': case 'a': this.c += one(); break
      case 'D': this.c -= one(); break
      case 'E': this.r += one(); this.c = 0; break
      case 'F': this.r -= one(); this.c = 0; break
      case 'G': case '`': this.c = one() - 1; break
      case 'd': this.r = one() - 1; break
      case 'H': case 'f': this.r = arg(0, 1) - 1; this.c = arg(1, 1) - 1; break
      case 'J': {
        const m = arg(0, 0)
        if (m === 0) { this.erase(this.r, this.c, this.cols); for (let i = this.r + 1; i < this.rows; i++) this.erase(i, 0, this.cols) }
        else if (m === 1) { for (let i = 0; i < this.r; i++) this.erase(i, 0, this.cols); this.erase(this.r, 0, this.c + 1) }
        else this.clear()
        break
      }
      case 'K': { const m = arg(0, 0); if (m === 0) this.erase(this.r, this.c, this.cols); else if (m === 1) this.erase(this.r, 0, this.c + 1); else this.erase(this.r, 0, this.cols); break }
      case 'X': this.erase(this.r, this.c, this.c + one()); break
      case 'P': { const l = this.cells[this.r]; if (l) { const k = one(); l.splice(this.c, k); while (l.length < this.cols) l.push(' ') } break }
      case 'S': for (let i = 0; i < one(); i++) { this.cells.shift(); this.cells.push(this.blank()) } break
    }
    this.clamp()
  }
  write(input: string) {
    const b = this.pend + input
    this.pend = ''
    let i = 0
    while (i < b.length) {
      const ch = b[i]
      if (ch === '\x1b') {
        if (i + 1 >= b.length) { this.pend = b.slice(i); return }
        const nx = b[i + 1]
        if (nx === '[') {
          let j = i + 2
          while (j < b.length && (b.charCodeAt(j) < 0x40 || b.charCodeAt(j) > 0x7e)) j++
          if (j >= b.length) { if (b.length - i < 16384) this.pend = b.slice(i); return }
          this.csi(b.slice(i + 2, j), b[j])
          i = j + 1
        } else if (']P_^X'.includes(nx)) {
          let j = i + 2
          let end = -1
          while (j < b.length) {
            if (b[j] === '\x07') { end = j + 1; break }
            if (b[j] === '\x1b' && b[j + 1] === '\\') { end = j + 2; break }
            j++
          }
          if (end < 0) { if (b.length - i < 16384) this.pend = b.slice(i); return }
          i = end
        } else if ('()*+#% '.includes(nx)) i += 3
        else i += 2
      } else if (ch === '\r') { this.c = 0; i++ }
      else if (ch === '\n' || ch === '\x0b' || ch === '\x0c') { this.lf(); i++ }
      else if (ch === '\b') { if (this.c > 0) this.c--; i++ }
      else if (ch === '\t') { this.c = Math.min((Math.floor(this.c / 8) + 1) * 8, this.cols - 1); i++ }
      else if (ch < ' ' || ch === '\x7f') i++
      else { const cp = b.codePointAt(i)!; const s = String.fromCodePoint(cp); this.put(s); i += s.length }
    }
  }
  lines() { return this.cells.map((l) => l.join('').trimEnd()).filter((l) => l.trim()) }
}
