// 员工的 MCP 工具清单（docs/api/MCP工具.md）：从 code/server/src/tools.ts 的 TOOLS 生成。改了工具就跑：node code/server/scripts/mcp-list.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
process.env.OPERO_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opero-mcplist-')) // 不碰真的数据
const { TOOLS } = await import(path.join(here, '../src/tools.ts'))
const out = path.resolve(here, '../../../docs/api/MCP工具.md')
const keep = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('<!-- 下面是自动生成的 -->')[0] : '# 员工的 MCP 工具\n\n'
const rows = TOOLS.map((t) => `| \`${t.name}\` | ${String(t.description).replace(/\|/g, '\\|').replace(/\n/g, ' ')} | ${Object.keys(t.inputSchema?.properties ?? {}).map((k) => `\`${k}\``).join(' ')} |`)
fs.writeFileSync(out, `${keep}<!-- 下面是自动生成的 -->\n\n共 ${TOOLS.length} 个（从 \`code/server/src/tools.ts\` 生成，别手改这一段）。\n\n| 工具 | 做什么 | 参数 |\n|---|---|---|\n${rows.join('\n')}\n`)
fs.rmSync(process.env.OPERO_DATA, { recursive: true, force: true })
console.log(`MCP 工具 ${TOOLS.length} 个 → docs/api/MCP工具.md`)
