// 跑：cd code/server && npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { failLog } from './faillog.ts'

test('云效日志：行首时间戳 + [INFO]，Kotlin「行:列 空格」的报错排最前', () => {
  // 安卓第 3 次试编的真实一行（路径缩短）
  const log = [
    '2026-11-27 12:09:40 [INFO] > Task :app:compileDebugKotlin',
    '2026-11-27 12:09:52 [INFO] e: file:///root/workspace/__flow_work/repo/code/android/app/src/main/java/cn/yimakeji/opero/Tr.kt:5:32 Syntax error: Expecting a top level declaration.',
    '2026-11-27 12:09:52 [WARNING] w: file:///root/workspace/repo/A.kt:3:1 \'foo\' is deprecated',
    '2026-11-27 12:09:53 [INFO] FAILURE: Build failed with an exception.',
    '2026-11-27 12:09:53 [INFO] * What went wrong:',
    "2026-11-27 12:09:53 [INFO] Execution failed for task ':app:compileDebugKotlin'.",
    '2026-11-27 12:09:53 [ERROR] BUILD FAILED in 1m 2s',
  ].join('\n')
  const out = failLog(log).split('\n')
  assert.match(out[0], /^e: file:\/\/\/.*Tr\.kt:5:32 Syntax error/)
  assert.ok(!out.some((l) => /deprecated/.test(l)), '警告不要')
  assert.ok(out.some((l) => /What went wrong/.test(l)))
  assert.ok(out.some((l) => /BUILD FAILED/.test(l)))
})

test('不带 e: 的 Kotlin 位置（X.kt:5:32 空格）、Go、TypeScript、Java 都认', () => {
  const out = failLog(['src/Main.kt:5:32 Unresolved reference: foo', './x.go:12:5: undefined: foo', "src/a.ts(12,5): error TS2304: Cannot find name 'x'.", 'App.java:12: 错误: 找不到符号', 'FAILURE: Build failed'].join('\n')).split('\n')
  assert.deepEqual(out.slice(0, 4), ['src/Main.kt:5:32 Unresolved reference: foo', './x.go:12:5: undefined: foo', "src/a.ts(12,5): error TS2304: Cannot find name 'x'.", 'App.java:12: 错误: 找不到符号'])
})

test('只有端口号不当成报错位置', () => {
  const out = failLog(['Downloading https://repo.maven.org:443 slow', 'Connecting to mirrors.aliyun.com:80 ok', 'npm ERR! code ECONNRESET'].join('\n'))
  assert.equal(out, 'npm ERR! code ECONNRESET')
})
