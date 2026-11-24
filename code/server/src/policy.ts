// 每台服务器给员工的规矩（服务器详情「给员工的规矩」）：能不能编译、能不能自测（跑测试 / 起服务）、禁止的命令、内存上限、同时最多几个员工。
// Claude Code 每条命令都经 approve 检查（tools.ts）；Codex 没有逐条检查，只写进它的规矩里，资源上限照样管（limits.ts）。
import type { Server } from './types.ts'

export interface Policy {
  /** 允许编译 / 打包（gradle、mvn、docker build、npm run build…）；false = 不许（旧开关，现在看 build） */
  allowBuild: boolean
  /** 编译 / 打包：auto = 看这台现在的资源够不够（推荐，够才跑，不能把 CPU、内存、磁盘打满）；on = 总是允许；off = 不许 */
  build: 'auto' | 'on' | 'off'
  /** 允许自测：跑测试、起项目或服务来试 */
  allowTest: boolean
  /** 禁止的命令（按开头匹配，一行一个） */
  deny: string[]
  /** 员工进程加起来最多用这台多少内存（%），超了先提醒，连续 2 分钟或 10 分钟内超 5 次就停掉最大的那个进程；0 = 不管 */
  memPct: number
  /** 员工进程加起来最多用这台多少 CPU（%）：超了先提醒，连续 2 分钟或 10 分钟内超 5 回就先暂停最占 CPU 的进程（降下来再继续）；0 = 不管 */
  cpuPct: number
  /** 这台上同时最多几个员工在干活，多了排队；0 = 不限 */
  maxConcurrent: number
}

export const DEFAULT_POLICY: Policy = { allowBuild: true, build: 'auto', allowTest: true, deny: [], memPct: 80, cpuPct: 80, maxConcurrent: 0 }

export function policyOf(sv?: Server): Policy {
  const p = sv?.policy ?? {}
  return {
    allowBuild: p.allowBuild ?? DEFAULT_POLICY.allowBuild,
    build: p.build === 'on' || p.build === 'off' || p.build === 'auto' ? p.build : p.allowBuild === false ? 'off' : 'auto',
    allowTest: p.allowTest ?? DEFAULT_POLICY.allowTest,
    deny: Array.isArray(p.deny) ? p.deny.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 50) : [],
    memPct: clamp(p.memPct ?? DEFAULT_POLICY.memPct, 0, 95),
    cpuPct: clamp(p.cpuPct ?? DEFAULT_POLICY.cpuPct, 0, 100),
    maxConcurrent: clamp(p.maxConcurrent ?? 0, 0, 50),
  }
}
const clamp = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)))

/** 收网页上传来的规矩 */
export function cleanPolicy(b: any, old?: Partial<Policy>): Partial<Policy> {
  const o = { ...(old ?? {}) }
  if (typeof b?.allowBuild === 'boolean') o.allowBuild = b.allowBuild
  if (b?.build === 'auto' || b?.build === 'on' || b?.build === 'off') { o.build = b.build; o.allowBuild = b.build !== 'off' }
  if (typeof b?.allowTest === 'boolean') o.allowTest = b.allowTest
  if (b?.deny !== undefined) o.deny = (Array.isArray(b.deny) ? b.deny : String(b.deny).split('\n')).map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 50)
  if (b?.memPct !== undefined) o.memPct = clamp(b.memPct, 0, 95)
  if (b?.cpuPct !== undefined) o.cpuPct = clamp(b.cpuPct, 0, 100)
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

// ---------- 编译要多少资源：够才跑（以前 Android 编译把服务器跑崩过） ----------
export interface Res { memAvail: number; memTotal: number; disk: number; cores: number; load: number }
/** 各类编译大概要多少（GB 内存、GB 磁盘、机器至少几核）：宁可估多一点（和网页「给员工的规矩」里的表一致）。
 *  cloud = 默认不在服务器上编（就算看起来够也交给流水线）；mac = 只能在 macOS 上编 */
export function buildNeed(c: string): { what: string; mem: number; disk: number; cores: number; cloud?: boolean; mac?: boolean } | undefined {
  if (!BUILD.test(c)) return undefined
  if (/\bxcodebuild\b|\bflutter\s+build\s+(ios|ipa|macos)\b/.test(c)) return { what: 'iOS / macOS 打包', mem: 8, disk: 30, cores: 8, mac: true, cloud: true }
  if (/(gradlew?|\.\/gradlew)\b[^|;&]*\b(assemble|bundle|install)[A-Z]\w*/.test(c) || /\bflutter\s+build\b/.test(c)) return { what: 'Android / Flutter 打包', mem: 8, disk: 20, cores: 8, cloud: true }
  if (/(gradlew?|\.\/gradlew|mvnw?|\.\/mvnw)\b/.test(c)) return { what: 'Java（gradle / Maven）编译', mem: 4, disk: 5, cores: 4 }
  if (/\b(docker|podman)\s+(build|buildx|compose\s+build)/.test(c)) return { what: 'Docker 镜像打包', mem: 2, disk: 10, cores: 4 }
  if (/\bcargo\s+build\b/.test(c)) return { what: 'Rust 编译', mem: 4, disk: 10, cores: 4 }
  if (/\bdotnet\s+(build|publish)\b/.test(c)) return { what: '.NET 编译', mem: 4, disk: 5, cores: 4 }
  if (/\bgo\s+build\b/.test(c)) return { what: 'Go 编译', mem: 2, disk: 3, cores: 2 }
  return { what: '前端 / 其它编译', mem: 2, disk: 3, cores: 2 }
}
/** 低配机器（≤ 2 核或 ≤ 8G 内存）：重的编译一律交给流水线 */
export const isLowHost = (r: Pick<Res, 'cores' | 'memTotal'>) => r.cores <= 2 || r.memTotal <= 8.5
const g = (n: number) => `${n.toFixed(n < 10 ? 1 : 0)}G`
/** 资源够不够跑这条编译：留出余量（内存留 1G 或 10%，磁盘留 2G，CPU 负载不能已经快满） */
export function resourceBlock(c: string, r: Res): string | undefined {
  const need = buildNeed(c)
  if (!need) return undefined
  const memReserve = Math.max(1, r.memTotal * 0.1)
  const why: string[] = []
  if (need.mac) return `${need.what}只能在 macOS 上编：交给主人在「发布」里用流水线编`
  if (need.cloud) return `${need.what}默认不在服务器上编（太吃资源，以前把服务器跑崩过）：交给主人在「发布」里用流水线编`
  if (isLowHost(r) && need.mem >= 4) return `这台是低配机器（${r.cores} 核 · ${g(r.memTotal)} 内存），${need.what}交给流水线编`
  if (r.memTotal < need.mem + 0.5) why.push(`这台总共只有 ${g(r.memTotal)} 内存，${need.what}大概要 ${g(need.mem)}`)
  else if (r.memAvail - memReserve < need.mem) why.push(`现在可用内存 ${g(r.memAvail)}（要留 ${g(memReserve)} 给服务），${need.what}大概要 ${g(need.mem)}`)
  if (r.disk - 2 < need.disk) why.push(`磁盘只剩 ${g(r.disk)}，大概要 ${g(need.disk)}`)
  if (r.cores < need.cores) why.push(`只有 ${r.cores} 核，${need.what}至少要 ${need.cores} 核`)
  else if (r.load / r.cores > 0.5) why.push(`CPU 已经比较忙了（负载 ${r.load.toFixed(1)} / ${r.cores} 核，编译会把它顶满）`)
  if (!why.length) return undefined
  return `这台现在跑不了${need.what}：${why.join('；')}。等资源空出来再试，或者交给主人在「发布」里用流水线编`
}
/** 在那台机器上读资源的命令（远程用）：MemAvailable MemTotal（kB）、磁盘剩余（kB）、核数、1 分钟负载 */
export const RES_CMD = (dir: string) => `awk '/^MemAvailable:/{a=$2}/^MemTotal:/{t=$2}END{print a, t}' /proc/meminfo; df -Pk '${dir.replace(/'/g, '')}' 2>/dev/null | awk 'NR==2{print $4}'; nproc; cut -d' ' -f1 /proc/loadavg`
export function parseRes(out: string): Res | undefined {
  const n = out.trim().split(/\s+/).map(Number)
  if (n.length < 5 || n.some((x) => !Number.isFinite(x))) return undefined
  return { memAvail: n[0] / 1048576, memTotal: n[1] / 1048576, disk: n[2] / 1048576, cores: n[3] || 1, load: n[4] }
}

/** 这条命令在这台上能不能跑：能 = undefined，不能 = 原因（会回给员工）。res：那台现在的资源（看资源决定时用） */
export function checkCommand(cmd: string, p: Policy, o: { hard?: boolean; res?: Res } = { hard: true }): string | undefined {
  const c = cmd.trim()
  if (!c) return undefined
  if (o.hard !== false) for (const [re, why] of HARD) if (re.test(c)) return why
  for (const d of p.deny) if (c.startsWith(d) || c.includes(`&& ${d}`) || c.includes(`; ${d}`)) return `这台禁止「${d}」`
  const mode = p.build ?? (p.allowBuild === false ? 'off' : 'auto')
  if (mode === 'off' && BUILD.test(c)) return '这台不许编译 / 打包：改完写清楚怎么编，交给主人去「发布」里编'
  if (mode === 'auto' && o.res) { const r = resourceBlock(c, o.res); if (r) return r }
  if (!p.allowTest && TEST.test(c)) return '这台不许自测（跑测试、起项目或服务来试）：改完读代码、看 diff 自查，写清楚怎么测交给主人'
  return undefined
}

/** 写进员工规矩里的一段（Codex 没有逐条检查，靠它自己守） */
export function policyText(p: Policy, hostName: string): string {
  const lines = [
    (p.build ?? (p.allowBuild === false ? 'off' : 'auto')) === 'off' && '不许编译 / 打包（gradle、mvn、docker build、npm run build 这类）：改完写清楚怎么编，交给主人',
    (p.build ?? 'auto') === 'auto' && '编译 / 打包要看这台资源：Opero 会先查可用内存、磁盘、CPU，够才让跑（Android 打包大概要 4G 内存），不够会拒绝；被拒了就别换写法硬跑，写清楚怎么编交给主人',
    !p.allowTest && '不许自测（跑测试、起项目或服务来试、调接口验证）：改完读代码、看 diff 自查，写清楚怎么测交给主人',
    p.deny.length && `禁止的命令：${p.deny.join('、')}`,
    '不能用 sudo、不能装系统软件、不能管系统服务、不能改 /etc /usr 这些系统目录',
    p.memPct && `你的进程加起来最多用这台 ${p.memPct}% 内存，一直超会停掉最大的进程`,
    p.cpuPct && `你的进程加起来最多用这台 ${p.cpuPct}% CPU，一直超会先暂停最占 CPU 的进程（多半是编译），降下来再继续`,
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
# 编译时少用一个核：CPU 不打满
c=$(nproc 2>/dev/null || echo 2); w=$(( c > 2 ? c - 1 : 1 ))
case "$n" in
  gradle|gradlew) export GRADLE_OPTS="\${GRADLE_OPTS:--Dorg.gradle.workers.max=$w -Dorg.gradle.daemon=false}" ;;
  make) export MAKEFLAGS="\${MAKEFLAGS:--j$w}" ;;
  cargo) export CARGO_BUILD_JOBS="\${CARGO_BUILD_JOBS:-$w}" ;;
esac
d=$(cd "$(dirname "$0")" && pwd)
P=$(printf %s "$PATH" | tr ':' '\\n' | grep -vxF "$d" | paste -sd: -)
r=$(PATH="$P" command -v "$n") || { echo "$n: command not found" >&2; exit 127; }
exec "$r" "$@"
`
