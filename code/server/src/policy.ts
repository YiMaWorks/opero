// 每台服务器给员工的规矩（服务器详情「给员工的规矩」）：能不能编译、能不能自测（跑测试 / 起服务）、禁止的命令、内存上限、同时最多几个员工。
// Claude Code 每条命令都经 approve 检查（tools.ts）；Codex 没有逐条检查，只写进它的规矩里，资源上限照样管（limits.ts）。
import type { Server } from './types.ts'

export interface Policy {
  /** 允许编译 / 打包（gradle、mvn、docker build、npm run build…） */
  allowBuild: boolean
  /** 允许自测：跑测试、起项目或服务来试 */
  allowTest: boolean
  /** 禁止的命令（按开头匹配，一行一个） */
  deny: string[]
  /** 员工进程加起来最多用这台多少内存（%），超了先提醒，连续 2 分钟或 10 分钟内超 5 次就停掉最大的那个进程；0 = 不管 */
  memPct: number
  /** 这台上同时最多几个员工在干活，多了排队；0 = 不限 */
  maxConcurrent: number
}

export const DEFAULT_POLICY: Policy = { allowBuild: true, allowTest: true, deny: [], memPct: 80, maxConcurrent: 0 }

export function policyOf(sv?: Server): Policy {
  const p = sv?.policy ?? {}
  return {
    allowBuild: p.allowBuild ?? DEFAULT_POLICY.allowBuild,
    allowTest: p.allowTest ?? DEFAULT_POLICY.allowTest,
    deny: Array.isArray(p.deny) ? p.deny.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 50) : [],
    memPct: clamp(p.memPct ?? DEFAULT_POLICY.memPct, 0, 95),
    maxConcurrent: clamp(p.maxConcurrent ?? 0, 0, 50),
  }
}
const clamp = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)))

/** 收网页上传来的规矩 */
export function cleanPolicy(b: any, old?: Partial<Policy>): Partial<Policy> {
  const o = { ...(old ?? {}) }
  if (typeof b?.allowBuild === 'boolean') o.allowBuild = b.allowBuild
  if (typeof b?.allowTest === 'boolean') o.allowTest = b.allowTest
  if (b?.deny !== undefined) o.deny = (Array.isArray(b.deny) ? b.deny : String(b.deny).split('\n')).map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 50)
  if (b?.memPct !== undefined) o.memPct = clamp(b.memPct, 0, 95)
  if (b?.maxConcurrent !== undefined) o.maxConcurrent = clamp(b.maxConcurrent, 0, 50)
  return o
}

// 编译 / 打包
const BUILD = /(^|[\s;&|(])(\.\/gradlew|gradlew?|mvn|mvnw|\.\/mvnw|xcodebuild|docker\s+(build|buildx|compose\s+build)|podman\s+build|flutter\s+build|cargo\s+build|go\s+build|dotnet\s+(build|publish)|(npm|pnpm)\s+run\s+(build|package|dist)|yarn\s+(run\s+)?(build|package|dist)|vite\s+build|webpack|tsc\s+-b\b|make(\s|$)|unity\s+-batchmode)/i
// 自测：跑测试、起项目 / 服务来试
const TEST = /(^|[\s;&|(])((npm|pnpm)\s+(run\s+)?(test|dev|start|serve|preview)|yarn\s+(run\s+)?(test|dev|start|serve|preview)|npx\s+(jest|vitest|playwright|cypress)|jest|vitest|pytest|go\s+test|cargo\s+test|mvn\s+test|(\.\/)?gradlew?\s+test|playwright\s+test|cypress\s+run|python3?\s+-m\s+(http\.server|pytest|unittest)|(flask|uvicorn|gunicorn)\s|php\s+-S\s|rails\s+s(erver)?\b|java\s+-jar\s)/i
// 不管怎么设都不许：装系统软件、提权、管系统服务、改系统目录、整盘删、下载就执行
const HARD: [RegExp, string][] = [
  [/(^|[\s;&|(])sudo\s/, '不能用 sudo'],
  [/(^|[\s;&|(])(apt(-get)?|yum|dnf|zypper|apk|brew|snap)\s+(install|remove|upgrade|update|purge)/, '不能装系统软件：要装什么告诉主人'],
  [/(^|[\s;&|(])systemctl\s+(start|stop|restart|reload|enable|disable|mask|daemon-reload)/, '不能管系统服务：告诉主人或让运维员工经 server_exec 做'],
  [/(^|\s)(>|>>|tee|cp|mv|rm|chmod|chown|sed\s+-i)\s+\/(etc|usr|boot|bin|sbin|lib)\//, '不能改系统目录'],
  [/\brm\s+-[a-z]*r[a-z]*\s+(-[a-z]+\s+)*(\/|~|\/\*)(\s|$)/i, '不能整盘删除'],
  [/(curl|wget)\s[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/, '不能下载了直接执行（curl | sh）'],
]

/** 这条命令在这台上能不能跑：能 = undefined，不能 = 原因（会回给员工） */
export function checkCommand(cmd: string, p: Policy, o: { hard?: boolean } = { hard: true }): string | undefined {
  const c = cmd.trim()
  if (!c) return undefined
  if (o.hard !== false) for (const [re, why] of HARD) if (re.test(c)) return why
  for (const d of p.deny) if (c.startsWith(d) || c.includes(`&& ${d}`) || c.includes(`; ${d}`)) return `这台禁止「${d}」`
  if (!p.allowBuild && BUILD.test(c)) return '这台不许编译 / 打包：改完写清楚怎么编，交给主人去「发布」里编'
  if (!p.allowTest && TEST.test(c)) return '这台不许自测（跑测试、起项目或服务来试）：改完读代码、看 diff 自查，写清楚怎么测交给主人'
  return undefined
}

/** 写进员工规矩里的一段（Codex 没有逐条检查，靠它自己守） */
export function policyText(p: Policy, hostName: string): string {
  const lines = [
    !p.allowBuild && '不许编译 / 打包（gradle、mvn、docker build、npm run build 这类）：改完写清楚怎么编，交给主人',
    !p.allowTest && '不许自测（跑测试、起项目或服务来试、调接口验证）：改完读代码、看 diff 自查，写清楚怎么测交给主人',
    p.deny.length && `禁止的命令：${p.deny.join('、')}`,
    '不能用 sudo、不能装系统软件、不能管系统服务、不能改 /etc /usr 这些系统目录',
    p.memPct && `你的进程加起来最多用这台 ${p.memPct}% 内存，超了会被停掉`,
  ].filter(Boolean)
  return `## 这台机器（${hostName}）的规矩\n${lines.map((l) => `- ${l}`).join('\n')}`
}

// ---------- PATH 拦截：Codex 没有逐条命令检查，在 PATH 最前面放一批同名小脚本，先按规矩查一遍再交给真的命令 ----------
const SHIM_BINS = ['sudo', 'apt', 'apt-get', 'yum', 'dnf', 'zypper', 'apk', 'brew', 'snap', 'systemctl',
  'gradle', 'gradlew', 'mvn', 'mvnw', 'docker', 'podman', 'xcodebuild', 'flutter', 'cargo', 'go', 'dotnet', 'npm', 'pnpm', 'yarn', 'npx', 'vite', 'webpack', 'make', 'tsc',
  'jest', 'vitest', 'pytest', 'playwright', 'cypress', 'flask', 'uvicorn', 'gunicorn', 'php', 'rails', 'java', 'unity']

/** 要放哪些小脚本（固定一批 + 禁止命令的第一个词） */
export function shimBins(p: Policy): string[] {
  const extra = p.deny.map((d) => d.trim().split(/\s+/)[0]).filter((b) => /^[\w.+-]{1,40}$/.test(b))
  return [...new Set([...SHIM_BINS, ...extra])]
}

/** 每个小脚本的内容：先调 policy-check（规矩不许就停），再去 PATH 里找真的命令（跳过自己这个目录） */
export const SHIM_SCRIPT = `#!/bin/sh
n=$(basename "$0")
if [ -n "$OPERO_POLICY" ] && [ -n "$OPERO_NODE" ] && [ -n "$OPERO_CHECK" ]; then
  "$OPERO_NODE" --disable-warning=ExperimentalWarning "$OPERO_CHECK" "$n" "$@"
  [ $? -eq 126 ] && exit 126
fi
d=$(cd "$(dirname "$0")" && pwd)
P=$(printf %s "$PATH" | tr ':' '\\n' | grep -vxF "$d" | paste -sd: -)
r=$(PATH="$P" command -v "$n") || { echo "$n: command not found" >&2; exit 127; }
exec "$r" "$@"
`
