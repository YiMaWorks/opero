// Opero 的 MCP 服务（stdio）：Claude Code / Codex 每轮启动时把它拉起来。它自己什么账号都没有，
// 只拿着这一轮的令牌（OPERO_TOKEN）把工具调用转给本机的 Opero（OPERO_API），Opero 去连服务器、查库、等你点卡片，再把结果回过来。
// 单独跑：node src/mcp.ts（不 import 后台的任何模块，只用 Node 自带的东西）。
import readline from 'node:readline'

const API = process.env.OPERO_API ?? 'http://127.0.0.1:7300'
const TOKEN = process.env.OPERO_TOKEN ?? ''

function reply(id: unknown, result: unknown) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n') }
function replyErr(id: unknown, code: number, message: string) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n') }

async function api(method: string, path: string, body?: unknown): Promise<any> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(API + path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw Object.assign(new Error(j.message ?? `HTTP ${r.status}`), { fatal: r.status === 401 || r.status === 404 })
      return j
    } catch (e: any) {
      if (e.fatal || i >= 4) throw e
      await new Promise((res) => setTimeout(res, 1000 * (i + 1))) // Opero 重启时等一下
    }
  }
}

async function call(name: string, args: unknown): Promise<{ text: string; isError?: boolean }> {
  let r = await api('POST', '/api/mcp/call', { name, args })
  while (!r.done) r = await api('GET', `/api/mcp/wait/${encodeURIComponent(r.job)}`)
  return { text: String(r.text ?? ''), isError: !!r.isError }
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', async (line) => {
  let msg: any
  try { msg = JSON.parse(line) } catch { return }
  const { id, method, params } = msg
  try {
    switch (method) {
      case 'initialize':
        reply(id, { protocolVersion: params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'opero', version: '0.1.0' } })
        return
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return
      case 'ping':
        reply(id, {})
        return
      case 'tools/list': {
        const r = await api('GET', '/api/mcp/tools')
        reply(id, { tools: r.tools ?? [] })
        return
      }
      case 'tools/call': {
        const r = await call(String(params?.name ?? ''), params?.arguments ?? {})
        reply(id, { content: [{ type: 'text', text: r.text }], isError: !!r.isError })
        return
      }
      default:
        if (id !== undefined) replyErr(id, -32601, `不支持：${method}`)
    }
  } catch (e: any) {
    if (method === 'tools/call') reply(id, { content: [{ type: 'text', text: `Opero 没响应：${e.message}` }], isError: true })
    else replyErr(id, -32603, String(e.message ?? e))
  }
})
rl.on('close', () => process.exit(0))
