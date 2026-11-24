// 命令拦截（PATH 里的小脚本调它）：按这台机器的规矩检查一条命令，不许就退出 126 并说明原因。
// 用法：node policy-check.ts <命令名> <参数…>；规矩在环境变量 OPERO_POLICY（JSON）。只用 Node 自带的，Agent 那台也能跑。
import fs from 'node:fs'
import os from 'node:os'
import { buildNeed, checkCommand, DEFAULT_POLICY, type Policy, type Res } from './policy.ts'

let p: Policy = DEFAULT_POLICY
try { p = { ...DEFAULT_POLICY, ...JSON.parse(process.env.OPERO_POLICY || '{}') } } catch { /* 读不了就按默认 */ }
const cmd = process.argv.slice(2).join(' ')
// 编译命令：读这台现在的资源（可用内存、当前目录所在盘的剩余、核数、负载）
let res: Res | undefined
if (buildNeed(cmd)) {
  try {
    const mi = fs.readFileSync('/proc/meminfo', 'utf8')
    const kb = (k: string) => Number(mi.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] ?? 0)
    const st = fs.statfsSync(process.cwd())
    res = { memAvail: kb('MemAvailable') / 1048576, memTotal: kb('MemTotal') / 1048576, disk: (st.bavail * st.bsize) / 1073741824, cores: os.cpus().length || 1, load: os.loadavg()[0] }
  } catch { /* 读不到就不按资源拦 */ }
}
const why = checkCommand(cmd, p, { res })
if (why) {
  process.stderr.write(`[Opero] 这台机器不许跑这条命令：${why}\n`)
  process.exit(126)
}
