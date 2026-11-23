// 后台用到的数据结构：和网页 code/web/src/types.ts 一致（网页直接拿去用），这里只列后台要读写的字段。
export type EnvTag = '开发' | '测试' | '生产'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Approval = 'auto' | 'edits' | 'ask' | 'plan'

export interface Employee {
  id: string
  name: string
  avatar: string
  color: string
  title: string
  prompt: string
  persona?: string
  executor: string // 'Claude Code' | 'Codex'
  host: string
  workspace: string // 工作空间 id；空 = 在自己的目录里干活
  menus: string[]
  model: string
  effort: Effort
  approval: Approval
  notify: 'all' | 'decide' | 'none'
  bg?: string
  avatarImg?: string
  contextUsed?: number
  repo: string
  repoSynced?: string
  works?: { no: number; from: string; to?: string; reason: string; host: string }[]
  /** 执行器自己的会话编号（Claude Code session_id / Codex thread_id），下一轮 --resume 接着聊 */
  resumeId?: string
}

export interface Session {
  id: string
  employee: string
  last: string
  time: string
  ts: number
  unread?: number
  pinned?: boolean
  working?: string
  waiting?: string
}

export interface CardAction { id: string; label: string; style?: 'primary' | 'danger' | 'default' | 'ghost'; tool?: string; panel?: string; args?: Record<string, unknown> }
export interface Card {
  id: string
  type: 'issue' | 'change' | 'release' | 'query' | 'confirm' | 'ask' | 'generic'
  v: 1
  state: 'open' | 'done'
  level: 'info' | 'warn' | 'danger'
  data: Record<string, any>
  actions: CardAction[]
  result?: string | null
}

export interface Message {
  id: string
  from: string // 'me' | 'system' | 员工 id
  kind: 'text' | 'status' | 'system' | 'file' | 'card'
  at: string
  ts?: number
  text?: string
  spinning?: boolean
  file?: { name: string; size: string; ext: string; image?: boolean; url?: string; w?: number; h?: number }
  card?: Card
}

export interface Server {
  id: string
  name: string
  ip: string
  port?: number
  user?: string
  credential?: string
  env: EnvTag
  os: string
  agent: string
  online: boolean
  cpu: number
  mem: number
  disk: number
  services: { name: string; status: '运行中' | '已停止' | '异常' }[]
  logs: string[]
  checked?: number
  error?: string
  hostKey?: string
  /** 接入方式：local = Opero 自己这台；agent = 装了 Opero Agent（员工能在上面干活）；ssh = 只用 SSH 跑命令 */
  via?: 'local' | 'agent' | 'ssh' | 'pending' | 'rejected'
  /** Agent 自己的公钥（ed25519 原始 32 字节 base64）和指纹（SHA256:…）：Opero 按指纹认机器，换地址也认得 */
  agentPub?: string
  agentFp?: string
  /** Agent：密钥的 sha256、机器编号（重装认得出是同一台）、版本、最后一次心跳、连的 Opero 地址、装了哪些执行器 */
  agentKeyHash?: string
  machineId?: string
  agentVersion?: string
  lastSeen?: number
  agentUrl?: string
  executors?: { claude?: string | null; codex?: string | null }
  /** Agent 那台本机出口代理（127.0.0.1）的端口和口令 */
  proxyPort?: number
  proxyToken?: string
}

export interface Credential {
  id: string
  name: string
  group: string
  kind: string
  env: EnvTag
  scope: string
  usedBy: string[]
  updated: string
  aiAllowed: boolean
  user?: string
  hasSecret?: boolean
}

export interface DataSource {
  id: string
  name: string
  kind: 'MySQL' | 'PostgreSQL'
  env: EnvTag
  host: string
  port?: number
  db: string
  user?: string
  credential?: string
  writable: boolean
  tables: { name: string; rows: string; cols: string[] }[]
}

export interface SavedQuery { id: string; source: string; name: string; sql: string }

export interface Trigger {
  id: string
  name: string
  kind: '定时' | 'Webhook' | '监控' | '邮件'
  rule: string
  employee: string
  enabled: boolean
  last: string
  prompt?: string
  hookToken?: string
  lastTs?: number
}

export interface KbDoc { id: string; name: string; kind: string; updated: string; by: string; summary: string; body?: string }

export interface Workspace {
  id: string
  name: string
  provider: string
  repo: string
  branch: string
  host: string
  dir: string
  last: string
  employees: string[]
  credential?: string
  /** 拉在哪台服务器上（local 或装了 Agent 的服务器编号） */
  server?: string
  preview?: string
  branches: { name: string; status: string; checks?: string }[]
  commits: { sha: string; msg: string; who: string; when: string }[]
  docs: { name: string; updated: string }[]
  error?: string
}

export interface Device { id: string; name: string; platform: string; appVersion?: string; tokenHash: string; enabled: boolean; paired: number; seen?: number }

export interface Owner { email: string; name: string; salt: string; hash: string }
