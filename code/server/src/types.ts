import type { SysInfo } from './sysinfo.ts'
import type { Policy } from './policy.ts'
import type { BuildComp } from './build.ts'
// 后台用到的数据结构：和网页 code/web/src/types.ts 一致（网页直接拿去用），这里只列后台要读写的字段。
/** 环境标签：随便起名（见 env.ts） */
export type EnvTag = string
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
  workspace: string // 项目 id；空 = 在自己的目录里干活
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
  /** 人设：性别（写进记忆仓库「我的人设」） */
  gender?: string
  /** 记忆仓库的远端（可选）：git 地址 + 凭证；不配就只在干活那台机器上 */
  memRepo?: string
  memCred?: string
  /** 能建 / 改别的员工（emp_create / emp_update，都要主人点确认） */
  canManage?: boolean
  /** 用哪个 Claude 账号（凭证 id，「AI 执行器」里登录的那几个）；不设 = 默认账号 */
  claudeAccount?: string
  /** 能只读看的别的项目（最多 8 个，要和员工在同一台机器上） */
  reads?: string[]
  /** 这个员工每月预算（美元，0 / 不填 = 不单独限） */
  budget?: number
  /** 在自己的分支上改（比如 opero/dev），干完提合并请求；不填 = 直接在项目的主分支上改 */
  workBranch?: string
  /** 能改哪些域名的解析（域名 id，见 dns.ts） */
  dns?: string[]
  /** 能用哪些凭证（凭证 id）：连服务器、查库、{{secret:名}}、签名都只认这里勾了的 */
  creds?: string[]
  /** 以后新加的这几类凭证自动给它（按角色预先勾好，员工页能改） */
  credGroups?: string[]
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
  /** 归档了（开了新会话接着做 / 换了执行器）：不在会话列表里，员工资料「历史会话」能看 */
  archived?: number
  /** 归档时记一句：为什么换、用的执行器 */
  title?: string
  /** 新会话的输入框预填（交接） */
  draft?: string
  /** 这个会话累计花费（执行器报的，美元） */
  cost?: number
}

export interface CardAction { id: string; label: string; style?: 'primary' | 'danger' | 'default' | 'ghost'; tool?: string; panel?: string; args?: Record<string, unknown> }
export interface Card {
  id: string
  type: 'issue' | 'change' | 'release' | 'query' | 'confirm' | 'ask' | 'generic' | 'run'
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
  /** 员工在上面改东西先出确认卡片；没设过按环境标签猜（env.ts isProtected） */
  protect?: boolean
  /** 给员工的规矩（policy.ts）：能不能编译 / 自测、禁止的命令、内存上限、同时几个员工 */
  policy?: Partial<Policy>
  /** 这台上登记的本地目录：read = 员工能读，write = 员工能读写，deploy = 发布能部署进去（Agent 用 ACL 给 AI 用户开权限） */
  dirs?: ServerDir[]
  /** 登记的日志（可以多个）：员工的 log_scan 不指定就扫这些；网页「日志」里点一下就看 */
  logSrc?: LogSource[]
  /** 接入方式：local = Opero 自己这台；agent = 装了 Opero Agent（员工能在上面干活）；ssh = 只用 SSH 跑命令 */
  via?: 'local' | 'agent' | 'ssh' | 'pending' | 'rejected'
  /** Agent 自己的公钥（ed25519 原始 32 字节 base64）和指纹（SHA256:…）：Opero 按指纹认机器，换地址也认得 */
  agentPub?: string
  agentFp?: string
  /** Agent：密钥的 sha256、机器编号（重装认得出是同一台）、版本、最后一次心跳、连的 Opero 地址、装了哪些执行器 */
  agentKeyHash?: string
  machineId?: string
  agentVersion?: string
  /** 最近一次接入（用令牌注册 / 你接受）的时间：网页「已接入」按它认，不按心跳 */
  joinedAt?: number
  lastSeen?: number
  agentUrl?: string
  executors?: { claude?: string | null; codex?: string | null }
  /** 机器信息：Agent 每次心跳报、Opero 这台自己读（主机名、系统、内核、CPU、内存 / 磁盘大小、内网地址、开机时长） */
  sys?: SysInfo
  /** Agent 那台本机出口代理（127.0.0.1）的端口和口令 */
  proxyPort?: number
  proxyToken?: string
}

export interface Credential {
  id: string
  name: string
  /** 分类：服务器 / 数据库 / 代码仓库 / 云账号 / AI / 签名证书 / 其它 */
  group: string
  /** 分类里的具体类型：MySQL、GitHub、阿里云、OpenAI、SSH 密码…（见网页 credmeta.ts） */
  kind: string
  env: EnvTag
  /** 不是密码的那些字段：地址、端口、库名、平台地址、AccessKey ID、区域…… */
  meta?: Record<string, string>
  /** 最近一次「测试连接」：能不能用、说明（比如识别出的账号、读到几张表） */
  test?: { ok: boolean; msg: string; at: number; details?: { title: string; items: string[]; total?: number }[] }
  updated: string
  /** 总开关：关了只有主人本人能用；开着也要在员工那边勾了才给那个员工用 */
  aiAllowed: boolean
  user?: string
  hasSecret?: boolean
  /** 旧字段（以前手写的说明 / 给自己看的标记），不再用 */
  scope?: string
  usedBy?: string[]
}

/** 能查的库（Redis、MongoDB 只存账号、能测试连接，不进「数据」） */
export type DbKind = 'MySQL' | 'MariaDB' | 'PostgreSQL' | 'SQL Server' | 'Oracle'
export interface DataSource {
  id: string
  name: string
  kind: DbKind
  env: EnvTag
  /** 改数据的确认卡片标成危险；没设过按环境标签猜 */
  protect?: boolean
  host: string
  port?: number
  db: string
  user?: string
  credential?: string
  writable: boolean
  tables: { name: string; rows: string; cols: string[] }[]
  /** 没填库名（整个实例）：这个账号能看到的库，员工查的时候挑一个 */
  dbs?: string[]
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
  /** 干完自动提交推送、派活前自动拉最新（默认开） */
  autoSync?: boolean
  /** 发布：每个目标一台服务器 + 一条命令（deploy 工具 / 网页「发布」按钮跑） */
  deploys?: Deploy[]
  /** 这个项目每月预算（美元，0 / 不填 = 不单独限） */
  budget?: number
  /** 编译组件（网页、安卓、后台…）：每个有自己的模板、命令、在哪编、流水线（build.ts）；发布目标选发哪个 */
  builds?: BuildComp[]
}

/** 发布环境：发哪个编译组件、发到哪几台、部署目录、包里的部署脚本 / 部署命令、签不签名、发完检查哪个地址、留几个版本、员工能不能自己发 */
export interface Deploy {
  id: string
  name: string
  /** 发哪个编译组件（Workspace.builds 的编号）；'none' = 不编译，只跑部署命令；不填 = 项目只有一个组件时就是它 */
  build?: string
  /** 发到哪几台（每台都要在「目录」里把部署目录登记成「能部署」） */
  servers: string[]
  /** 部署目录（OPERO_DIR = KL_DIR） */
  dir?: string
  /** 包里的部署脚本（默认 deploy.sh）：bash <脚本> <包目录> <发布编号> */
  script?: string
  /** 包里没有部署脚本时跑的命令（在部署目录里跑；没编译时就是「部署 = 跑这条命令」，OPERO_REF = 远端最新提交） */
  command?: string
  /** 给包里的 apk / aab 签名：用哪个签名证书（凭证） */
  sign?: string
  health?: string
  keep?: number
  ai?: 'auto' | 'ask' | 'off'
  autoRollback?: boolean
  last?: string
  lastOk?: boolean
}

export interface ReleaseStep { k: 'build' | 'checkout' | 'transfer' | 'sign' | 'deploy' | 'health' | 'rollback'; s: 'pending' | 'running' | 'done' | 'failed' | 'skipped'; msg?: string; t0?: number; t1?: number }
/** 一次发布 */
export interface Release {
  id: string
  ws: string
  target: string
  targetName: string
  /** 发的哪个编译组件（名字，给人看；不编译的没有） */
  build?: string
  version: string
  sha: string
  status: 'running' | 'success' | 'failed'
  steps: ReleaseStep[]
  note?: string
  by: string
  /** 员工发的：哪个员工、哪个会话、聊天里那张卡片 */
  emp?: string
  sid?: string
  msgId?: string
  rollbackOf?: string
  /** 发到哪几台、发的是哪个包、编译的网页链接 */
  servers?: string[]
  pkgName?: string
  buildUrl?: string
  /** 每台上这个版本的包还留着（能回滚） */
  kept?: boolean
  started: number
  ended?: number
  error?: string
  tail?: string
}

/** 问题清单：日志巡检记下来的线上问题 */
export interface Issue {
  id: string
  title: string
  /** 哪台服务器 / 哪个项目 */
  server?: string
  workspace?: string
  severity: 'high' | 'mid' | 'low'
  status: 'new' | 'fixing' | 'fixed' | 'known' | 'ignored'
  count: number
  first: number
  last: number
  /** 同一个问题的标识（异常类型 + 出错位置），用来合并 */
  key: string
  sample: string
  cause?: string
  /** 谁报的、谁在修 */
  reporter?: string
  fixer?: string
  ignoreUntil?: number
  note?: string
}

export interface Device { id: string; name: string; platform: string; appVersion?: string; tokenHash: string; enabled: boolean; paired: number; seen?: number }

export interface Owner { email: string; name: string; salt: string; hash: string }

/** 服务器上登记的日志：file = 文件（可带 *），dir = 目录（里面的 *.log），service = 系统服务（journalctl）。日志扫描不指定时扫这些 */
export interface LogSource { kind: 'file' | 'dir' | 'service'; path: string; note?: string }
export interface ServerDir { path: string; mode: 'read' | 'write' | 'deploy'; note?: string; ok?: boolean; error?: string }
