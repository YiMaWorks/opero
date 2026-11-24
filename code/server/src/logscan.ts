// log_scan：在服务器上分析日志（经 server_exec 的通道跑只读命令），比 tail / grep 省事：
//   hist  按时间统计匹配的行（每分钟 / 10 分钟 / 小时）：什么时候开始的、现在还有没有
//   first 第一次出现的几条（带前后几行，异常堆栈一般在后面）
//   last  最近几次
//   top   异常类型 / 出错行汇总（数字、编号抹掉后合并计数）
//   grep  直接按条件看匹配的行（最多 limit 行）
// 日志可以是文件（支持 * 和滚动出去的 .1 / .gz：rotated = true），也可以是 systemd 服务（journalctl）。
import { q } from './git.ts'

export interface ScanArgs { file?: string; service?: string; mode?: string; grep?: string; sinceMin?: number; bucket?: string; limit?: number; before?: number; after?: number; rotated?: boolean }

const ERR = 'ERROR|Exception|FATAL|CRITICAL|Traceback|panic:|Caused by'

export function buildScan(a: ScanArgs): string {
  const mode = ['hist', 'first', 'last', 'top', 'grep'].includes(String(a.mode)) ? String(a.mode) : 'top'
  const pat = String(a.grep ?? '').trim() || ERR
  const limit = Math.max(1, Math.min(Number(a.limit) || (mode === 'grep' ? 200 : 5), mode === 'grep' ? 500 : 20))
  const before = Math.max(0, Math.min(Number(a.before) || 2, 20))
  const after = Math.max(0, Math.min(Number(a.after) || (mode === 'first' || mode === 'last' ? 15 : 0), 50))
  // 来源：一条输出整份日志文本的命令
  let src: string
  if (a.service) {
    const since = Math.max(1, Math.min(Number(a.sinceMin) || 60, 1440 * 7))
    src = `journalctl -u ${q(String(a.service))} --no-pager -o short-iso --since ${q(`-${since}min`)}`
  } else if (a.file) {
    const f = String(a.file)
    if (!/^\/[\w./*@+-]+$/.test(f)) throw new Error('日志路径只能是绝对路径（字母、数字、. _ - / 和 *）')
    // 文件名里可以带 *；rotated = 连 .1 / .gz 一起，按修改时间从旧到新
    const files = a.rotated ? `$(ls -tr ${f.includes('*') ? f : `${q(f)}*`} 2>/dev/null)` : (f.includes('*') ? `$(ls -tr ${f} 2>/dev/null)` : q(f))
    src = `zcat -f ${files}`
  } else throw new Error('要给 file（日志文件路径）或 service（systemd 服务名）')
  const g = `grep -E ${q(pat)}`
  switch (mode) {
    case 'hist': {
      // 行首的时间：2026-11-23 14:20:31 / 2026-11-23T14:20:31 / [23/Nov/2026:14:20:31 …
      const width = a.bucket === '1m' ? 16 : a.bucket === '1h' ? 13 : 15
      return `${src} | ${g} | sed -E 's/^[^0-9]*//' | cut -c1-${width} | sed -E 's/T/ /' | uniq -c | tail -n 72`
    }
    case 'first': return `${src} | grep -n -m ${limit} -B ${before} -A ${after} -E ${q(pat)}`
    case 'last': return `${src} | grep -n -B ${before} -A ${after} -E ${q(pat)} | tail -n ${limit * (before + after + 2)}`
    case 'grep': return `${src} | ${g} | tail -n ${limit}`
    default: // top：抹掉时间、数字、十六进制、引号里的值后合并
      return `${src} | ${g} | sed -E 's/^[^A-Za-z]*//; s/0x[0-9a-fA-F]+/0x?/g; s/[0-9]+/N/g; s/"[^"]*"/"?"/g' | cut -c1-200 | sort | uniq -c | sort -rn | head -n 25`
  }
}
