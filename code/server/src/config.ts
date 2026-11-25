// 配置：全部来自环境变量（安装脚本写进 /etc/opero/opero.env），没有就用开发时的默认值。
import fs from 'node:fs'
import path from 'node:path'

const env = process.env
/** 仓库根目录（code/server/src → 上三级） */
export const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const data = path.resolve(env.OPERO_DATA || path.join(ROOT, '.opero-data'))

function readVersion(): string {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'code/server/package.json'), 'utf8')).version } catch { return '0.0.0' }
}

export const cfg = {
  version: readVersion(),
  port: Number(env.OPERO_PORT || 7300),
  /** 监听地址：装在服务器上默认 0.0.0.0（建议前面套 nginx + HTTPS） */
  host: env.OPERO_HOST || '127.0.0.1',
  /** 数据目录（数据库、保险箱密钥、上传的文件）：只给 Opero 自己的系统用户读 */
  data,
  /** 员工干活的目录（项目、员工自己的目录）：AI 用户能读写 */
  work: path.resolve(env.OPERO_WORK || path.join(data, 'work')),
  /** 网页（code/web 编出来的 dist）；OPERO_WEB=none：只提供接口，网页另外托管或只用原生 App */
  web: env.OPERO_WEB === 'none' ? '' : path.resolve(env.OPERO_WEB || path.join(ROOT, 'code/web/dist')),
  /** AI 执行器用哪个系统用户跑（安装脚本建的 opero-ai）；空 = 和 Opero 同一个用户（只适合本机开发） */
  aiUser: env.OPERO_AI_USER || '',
  /** 对外地址（https://opero.example.com），用于 Webhook 地址、App 配对；空 = 按请求的 Host 算 */
  publicUrl: (env.OPERO_URL || '').replace(/\/+$/, ''),
  /** 执行器命令（默认在 AI 用户的 PATH 里找） */
  claudeBin: env.OPERO_CLAUDE_BIN || 'claude',
  codexBin: env.OPERO_CODEX_BIN || 'codex',
  /** 每轮最多多少步（Claude Code --max-turns） */
  maxTurns: Number(env.OPERO_MAX_TURNS || 200),
}

export const MCP_SCRIPT = path.join(ROOT, 'code/server/src/mcp.ts')

for (const d of [cfg.data, path.join(cfg.data, 'files'), cfg.work]) fs.mkdirSync(d, { recursive: true, mode: 0o770 })
try { fs.chmodSync(cfg.data, 0o700) } catch { /* 不是自己的目录就算了 */ }
