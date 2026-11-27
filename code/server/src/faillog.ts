// 编译失败日志的摘要（build.ts 用；单独一个文件、不引别的模块，测试直接 import：faillog.test.ts）
/** 编译失败的日志里挑有用的给人和 AI 看：
 *  ① 编译器带位置的报错放最前面（Kotlin `e: file:///…/X.kt:12:5 …`、Go `x.go:12:5: …`、Java `X.java:12: 错误: …`、TypeScript `x.ts(12,5): …`、gcc / rustc 一类），
 *     只留最前面 25 条（后面的多是连锁报错），警告不要；
 *  ② 再接最后几行带 error / fail / exception 的摘要（Gradle 的 FAILURE、What went wrong、npm ERR! 这些）。最多 40 行，每行最多 300 字 */
export function failLog(raw: string, max = 40): string {
  // 每行先去掉颜色、行首的时间戳和日志级别（云效：`2026-11-27 12:09:52 [INFO] e: …`）；级别是 WARN / WARNING 的整行当警告
  const lines: { t: string; warnTag: boolean }[] = []
  for (const l of raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split(/\r?\n/)) {
    let t = l.replace(/^\s*\[?\d{4}-\d\d-\d\d[T ][\d:.,]+Z?\]?\s*/, '')
    const lv = t.match(/^\s*\[(INFO|ERROR|WARN|WARNING|DEBUG|TRACE|NOTICE)\]\s*/i)
    if (lv) t = t.slice(lv[0].length)
    t = t.trimEnd()
    if (t.trim()) lines.push({ t, warnTag: !!lv && /^WARN/i.test(lv[1]) })
  }
  const warn = /^\s*w: |\bwarning\b|警告/i
  // 带位置的报错：Kotlin `e: …`、`X.kt:5:32 报错`（行:列后面是空格）、`x.go:12:5: …`、`X.java:12: 错误`、`x.ts(12,5): …`、rustc `--> src/x.rs:1:2`。
  // 只有行号时要求后面跟冒号（不然 `maven.org:443 ` 这种也会被当成报错位置）
  const loc = /^\s*e: |[\w@+./\\-]+\.[A-Za-z][A-Za-z0-9]{0,5}(?::\d+:\d+:?\s|:\d+:\s|\(\d+,\d+\):?\s)|^\s*--> [\w./\\-]+:\d+:\d+/
  const cut = (x: string) => (x.length > 300 ? x.slice(0, 300) + '…' : x)
  const ok = lines.filter((x) => !x.warnTag && !warn.test(x.t)).map((x) => x.t)
  const errs = [...new Set(ok.filter((x) => loc.test(x)))].slice(0, 25)
  const kw = ok.filter((x) => /error|fail|错误|失败|exception|what went wrong|\bERR!/i.test(x) && !errs.includes(x))
  const tail = kw.slice(-Math.max(5, Math.min(15, max - errs.length)))
  return [...errs, ...(errs.length && tail.length ? ['…'] : []), ...tail].slice(0, max + 1).map(cut).join('\n')
}
