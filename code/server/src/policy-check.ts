// 命令拦截（PATH 里的小脚本调它）：按这台机器的规矩检查一条命令，不许就退出 126 并说明原因。
// 用法：node policy-check.ts <命令名> <参数…>；规矩在环境变量 OPERO_POLICY（JSON）。只用 Node 自带的，Agent 那台也能跑。
import { checkCommand, DEFAULT_POLICY, type Policy } from './policy.ts'

let p: Policy = DEFAULT_POLICY
try { p = { ...DEFAULT_POLICY, ...JSON.parse(process.env.OPERO_POLICY || '{}') } } catch { /* 读不了就按默认 */ }
const cmd = process.argv.slice(2).join(' ')
const why = checkCommand(cmd, p)
if (why) {
  process.stderr.write(`[Opero] 这台机器不许跑这条命令：${why}\n`)
  process.exit(126)
}
