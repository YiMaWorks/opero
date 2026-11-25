// 从 src/api.ts 生成接口清单 docs/api/接口清单.md：按代码里的分节（// ---------- 名 ----------）归类，
// 带上每个接口上面的注释和登录方式。改了接口就跑一次：node code/server/scripts/api-list.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(here, '../src/api.ts'), 'utf8').split('\n')
const out = path.join(here, '../../../docs/api/接口清单.md')

const AUTH = { owner: '主人', none: '不用登录', device: '设备令牌', mcp: '员工（这一轮的令牌）', agent: 'Agent 签名' }
const sections = []
let cur = { name: '开头', items: [] }
sections.push(cur)
let doc = []

for (let i = 0; i < src.length; i++) {
  const line = src[i]
  const sec = line.match(/^\/\/ -{3,}\s*(.+?)\s*-{3,}/)
  if (sec) { cur = { name: sec[1], items: [] }; sections.push(cur); doc = []; continue }
  const m = line.match(/^route\('(GET|POST|PUT|PATCH|DELETE)',\s*'([^']+)'/)
  if (m) {
    // 这个 route( 调用到哪结束：下一个顶格的语句之前
    let j = i
    while (j + 1 < src.length && !/^(route\(|\/\/|\/\*\*|function |async function |const |let |export |type |interface )/.test(src[j + 1])) j++
    const call = src.slice(i, j + 1).join('\n')
    const auths = [...call.matchAll(/auth:\s*'(\w+)'/g)]
    const auth = auths.length ? auths[auths.length - 1][1] : 'owner'
    cur.items.push({ method: m[1], path: m[2], auth, note: doc.join(' ').trim() })
    doc = []
    i = j
    continue
  }
  // 接口上面的注释：// 一行，或 /** … */
  const c1 = line.match(/^\/\/\s?(.*)$/)
  const c2 = line.match(/^\/\*\*\s?(.*?)(\*\/)?$/)
  if (c2) {
    doc = [c2[1]]
    while (!c2[2] && i + 1 < src.length && !src[i].includes('*/')) { i++; doc.push(src[i].replace(/^\s*\*\/?\s?/, '').replace(/\*\/\s*$/, '')) }
    continue
  }
  if (c1) { doc.push(c1[1]); continue }
  if (line.trim() === '' || /^[\s})\]]/.test(line)) continue
  doc = []
}

const esc = (s) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ')
const total = sections.reduce((a, s) => a + s.items.length, 0)
let md = `# 接口清单（自动生成，别手改）\n\n> 由 \`code/server/scripts/api-list.mjs\` 从 \`code/server/src/api.ts\` 生成，共 ${total} 个。改了接口就重新跑：\`node code/server/scripts/api-list.mjs\`。\n> 登录方式、请求 / 返回的约定、实时推送见 [README.md](README.md)。登录一栏：主人 = cookie 或 \`Authorization: Bearer <会话令牌>\`；设备令牌 = App 配对拿到的令牌。\n\n`
for (const s of sections) {
  if (!s.items.length) continue
  md += `## ${s.name}\n\n| 方法 | 路径 | 登录 | 说明 |\n|---|---|---|---|\n`
  for (const it of s.items) md += `| ${it.method} | \`${it.path}\` | ${AUTH[it.auth] ?? it.auth} | ${esc(it.note)} |\n`
  md += '\n'
}
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, md)
console.log(`接口 ${total} 个 → ${path.relative(process.cwd(), out)}`)
