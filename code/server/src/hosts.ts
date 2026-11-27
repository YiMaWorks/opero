// 在哪台机器上跑 AI 执行器：local = Opero 自己这台（经 sudo 切到 AI 用户），其它 = 那台服务器上的 Opero Agent（agents.ts）。
// 远程进程用起来和本机子进程一样（stdin / stdout / stderr / close），runner 和 executors 不用分两套写。
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { cfg } from './config.ts'
import * as agents from './agents.ts'

export const LOCAL = 'local'
export const isLocal = (host?: string) => !host || host === LOCAL

/** 执行器命令：OPERO_CLAUDE_BIN / OPERO_CODEX_BIN 只是 Opero 这台的路径（比如自己打包的 claude）；别的服务器上一律用 AI 用户 PATH 里的（一键安装装在 ~/.local/bin） */
export const claudeBin = (host?: string) => (isLocal(host) ? cfg.claudeBin : 'claude')
export const codexBin = (host?: string) => (isLocal(host) ? cfg.codexBin : 'codex')
/** 各种执行器的命令（claude / codex / qwen / codebuddy）：本机按配置，远程用 AI 用户 PATH 里的 */
export const execBin = (kind: string, host?: string) =>
  kind === 'codex' ? codexBin(host) : kind === 'qwen' ? (isLocal(host) ? cfg.qwenBin : 'qwen') : kind === 'codebuddy' ? (isLocal(host) ? cfg.codebuddyBin : 'codebuddy') : claudeBin(host)

/** 本机：以 AI 用户跑一个命令（登录 shell，PATH 里有它自己装的 claude / codex） */
export function spawnAi(bin: string, args: string[], env: Record<string, string>, cwd: string): ChildProcess {
  // 一键安装的 Claude Code / Codex 在 AI 用户的 ~/.local/bin；npm 用 Opero 自己的 Node。登录 shell 的 PATH 不一定带这两个，补上
  // nice：员工进程（包括它起的编译）让着这台上的线上服务
  const wrapper = `export PATH="\${OPERO_SHIMS:+\$OPERO_SHIMS:}$HOME/.local/bin:$PATH:${path.dirname(process.execPath)}"; umask 007; exec nice -n 10 "$0" "$@"`
  const fullEnv = { ...process.env, ...env } as Record<string, string>
  if (cfg.aiUser) {
    const keep = Object.keys(env)
    return spawn('sudo', ['-n', '-u', cfg.aiUser, '-H', ...(keep.length ? [`--preserve-env=${keep.join(',')}`] : []), '--', 'bash', '-lc', wrapper, bin, ...args],
      { cwd, env: fullEnv, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
  }
  return spawn('bash', ['-lc', wrapper, bin, ...args], { cwd, env: fullEnv, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
}

/** 在某台机器上以 AI 用户起进程；远程时 mkdirs 里的目录 Agent 会先建好（属 AI 用户） */
export function spawnAiOn(host: string | undefined, bin: string, args: string[], env: Record<string, string>, cwd: string, mkdirs: string[] = [], memPct = 0, cpuPct = 0): ChildProcess {
  if (isLocal(host)) return spawnAi(bin, args, env, cwd)
  return agents.spawnRemote(host!, { as: 'ai', bin, args, env, cwd, mkdirs, memPct, cpuPct })
}

export function killTree(p: ChildProcess) {
  if ((p as unknown as { remote?: boolean }).remote) { p.kill(); return }
  try { if (p.pid) process.kill(-p.pid, 'SIGTERM') } catch { try { p.kill('SIGTERM') } catch { /* 已经没了 */ } }
  setTimeout(() => { try { if (p.pid) process.kill(-p.pid, 'SIGKILL') } catch { /* 已经没了 */ } }, 5000).unref()
}

/** 跑一下拿输出（看版本、测试执行器） */
export function runAiOn(host: string | undefined, bin: string, args: string[], opts: { env?: Record<string, string>; cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<{ code: number; out: string; ms: number }> {
  const t0 = Date.now()
  return new Promise((resolve) => {
    const p = spawnAiOn(host, bin, args, opts.env ?? {}, opts.cwd ?? workRoot(host))
    p.stdin!.on('error', () => {})
    let out = ''
    p.stdout!.on('data', (b) => { out += b })
    p.stderr!.on('data', (b) => { out += b })
    p.stdin!.end(opts.input ?? '')
    let done = false
    const end = (code: number, o: string) => { if (done) return; done = true; clearTimeout(t); resolve({ code, out: o.trim(), ms: Date.now() - t0 }) }
    // 超时杀掉；远程的可能等不到「已退出」，再等 5 秒没有就按超时返回
    const t = setTimeout(() => { killTree(p); setTimeout(() => end(-1, `${out}\n（超时）`), 5000).unref() }, opts.timeoutMs ?? 30_000)
    p.on('close', (code) => end(code ?? -1, out))
    p.on('error', (e) => end(-1, String(e)))
  })
}

/** 员工干活的根目录：本机按配置，远程固定 /srv/opero/work（Agent 安装脚本建的） */
export const workRoot = (host?: string) => (isLocal(host) ? cfg.work : agents.REMOTE_WORK)

/** MCP 用的 node 和脚本、以及连回 Opero 的地址：远程时写占位符，Agent 换成它那台上的路径和它连的地址 */
export const nodeBin = (host?: string) => (isLocal(host) ? process.execPath : '{{NODE}}')
export const apiBase = (host?: string) => (isLocal(host) ? `http://127.0.0.1:${cfg.port}` : '{{API}}')
