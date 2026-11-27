// 数据结构。消息 / 卡片和 docs/规范/表单与卡片.md 一致；其它实体对应以后的后台接口。

// ---------- 人和员工 ----------
export interface User {
  id: string
  name: string
  email: string
  lastActive: string
  passkey?: boolean
  // ---- 个人页顶部（一人一套，按自己喜好来；存本机，接后台后存个人偏好） ----
  /** 头像图片（裁好的 data URL）；没有就用 avatar 字 */
  avatarImg?: string
  avatar?: string
  /** 一句签名 */
  signature?: string
  /** 封面：预设的 key（aurora / dusk / ocean / forest / paper / night）或裁好的图片 data URL */
  cover?: string
  /** 顶部显示什么：问候语、今日概况（在干活 / 等你决定 / 本月花了） */
  showGreeting?: boolean
  showToday?: boolean
}

export interface Employee {
  claudeAccount?: string // 用哪个 Claude 账号（不设 = 默认）
  id: string
  name: string
  avatar: string // 头像上的字
  color: string
  title: string // 职责一句话
  prompt: string // 职责提示词（写进它 git 的 CLAUDE.md「我的角色」）
  executor: string
  host: string
  workspace: string
  menus: string[] // 底部菜单（菜单项在 src/menus.ts 注册，二开见 docs/规范/底部菜单.md）
  persona?: string
  gender?: string // 人设：性别
  memRepo?: string // 记忆仓库远端（可选）
  memCred?: string
  canManage?: boolean // 能建 / 改别的员工
  reads?: string[] // 只读参考的项目
  creds?: string[] // 能用哪些凭证（凭证 id）
  credGroups?: string[] // 以后新加的这几类凭证自动给它
  budget?: number // 每月预算（美元）
  workBranch?: string // 在自己的分支上改，干完提合并请求
  dns?: string[] // 能改哪些域名的解析
  // 每个员工都是一个 work：这三项选了就记住（按员工存）
  model: string
  effort: Effort
  approval: Approval
  contextUsed?: number // 上下文用了多少（%）
  // 聊天设置（像微信给每个联系人设）：头像、名字、背景、提醒
  avatarImg?: string // 上传的头像（data URL），有就优先用；没有用 avatar 字 / 表情 + color
  bg?: ChatBg
  notify: Notify
  // 记忆：每个员工一个 git 仓库，换 work / 换服务器都从这里接手
  repo: string
  repoSynced?: string
  works?: WorkRun[] // work 历史（最新在前）
}

/** 提醒：all 每条都提醒（红点数字）· decide 只提醒要你决定的（默认，其它只给灰点）· none 不提醒 */
export type Notify = 'all' | 'decide' | 'none'
export type ChatBg = 'plain' | 'soft' | 'grid' | 'dusk' | 'mint'
export interface WorkRun {
  no: number
  from: string
  to?: string
  reason: string // 为什么换：上下文满了 / 卡住了 / 换服务器 / 你让换的
  host: string
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
/** 审核方式：auto 自动（信任 AI）· edits 改文件自动、跑命令要问 · ask 每一步都问 · plan 只看不改 */
export type Approval = 'auto' | 'edits' | 'ask' | 'plan'

// ---------- 会话和消息 ----------
export type CardType = 'issue' | 'change' | 'release' | 'query' | 'confirm' | 'ask' | 'generic' | 'run'
export type Level = 'info' | 'warn' | 'danger'
export type ButtonStyle = 'primary' | 'danger' | 'default' | 'ghost'

export interface CardAction {
  id: string
  label: string
  style?: ButtonStyle
  tool?: string // 点了走网关调这个工具
  panel?: PanelKind // 或者只打开面板
  args?: Record<string, unknown>
}

export interface Card {
  id: string
  type: CardType
  v: 1
  state: 'open' | 'done'
  level: Level
  data: Record<string, any>
  actions: CardAction[]
  result?: string | null
}

export type MessageKind = 'text' | 'status' | 'system' | 'file' | 'card'

export interface Message {
  id: string
  ts?: number
  from: 'me' | 'system' | string // string = 员工 id
  kind: MessageKind
  at: string
  text?: string
  spinning?: boolean
  file?: { name: string; size: string; ext: string; image?: boolean; /** 图片缩略图（data URL） */ url?: string; w?: number; h?: number }
  card?: Card
}

/** 真的一套：已经传好、还没发（或排着队）的附件 */
export interface QAtt { id: string; name: string; size: string; ext: string; image: boolean; mediaType: string; url: string; w?: number; h?: number }
/** 真的一套：员工在干活时排队的一句话（带着它自己的图片 / 文件） */
export interface QueueItem { id: string; emp: string; sid: string; text: string; files: QAtt[]; at: number; source: 'me' | 'auto' }

export interface Session {
  id: string
  employee: string
  last: string
  time: string
  ts: number // 排序用：最近一条的时间
  unread?: number
  pinned?: boolean // 置顶（用户自己设）
  working?: string // 在干活时的一句话（绿色）
  waiting?: string // 要你处理（预览前红字）
  archived?: number // 归档了（开新会话接着做 / 换执行器）：不在会话列表里
  title?: string // 归档时记的一句
  draft?: string // 新会话输入框预填（交接）
  cost?: number // 这个会话累计花费（执行器报的，美元）
}

// ---------- 项目 / 问题 ----------
export interface Workspace {
  id: string
  name: string
  provider: 'Codeup' | 'GitHub' | 'Gitea' | 'Gitee' | 'GitLab' | 'Git'
  credential?: string
  error?: string
  /** 真的一套：拉在哪台服务器上（local 或装了 Agent 的服务器编号） */
  server?: string
  repo: string
  branch: string
  host: string
  dir: string
  last: string
  employees: string[]
  preview?: string
  branches: { name: string; status: string; checks?: string }[]
  commits: { sha: string; msg: string; who: string; when: string }[]
  docs: { name: string; updated: string }[]
  /** 干完自动提交推送、派活前自动拉最新（默认开） */
  autoSync?: boolean
  /** 发布目标：一台服务器 + 一条命令 */
  deploys?: Deploy[]
  budget?: number // 这个项目每月预算（美元）
  /** 编译组件（网页、安卓、后台…）：各自的模板、在哪编、流水线；发布目标选发哪个 */
  builds?: BuildComp[]
}

/** 发布环境：发到哪几台、部署目录、部署脚本 / 命令、签名、检查、留几个版本、员工能不能发 */
export interface Deploy {
  id: string; name: string; servers: string[]; dir?: string; script?: string; command?: string
  /** 发哪个编译组件（编号）；'none' = 不编译，只跑部署命令；不填 = 项目只有一个组件时就是它 */
  build?: string
  sign?: string; health?: string; keep?: number; ai?: 'auto' | 'ask' | 'off'; autoRollback?: boolean; last?: string; lastOk?: boolean
}
/** 编译组件：编号 + 名字（「网页」「安卓」）+ 编译设置 */
export type BuildComp = BuildCfg & { id: string; name: string }
/** 编译设置：模板、在哪编 */
export interface BuildCfg {
  kind: 'node' | 'go' | 'android' | 'spring' | 'custom'
  /** 在哪编：auto = 本地资源够就本地、不够走流水线（默认）；local = 总是本地；pipeline = 总是流水线 */
  where?: 'auto' | 'local' | 'pipeline'
  /** 流水线用哪个打包工具（local = 没有流水线） */
  provider: 'yunxiao' | 'github' | 'gitlab' | 'jenkins' | 'local'
  gitlab?: { at?: number }
  jenkins?: { cred: string; job?: string; at?: number }
  pipelineError?: string
  subdir?: string; cmd?: string; versionFile?: string; versionRe?: string; service?: string; file?: string
  spring?: { tool?: 'maven' | 'gradle'; jdk?: 17 | 21; task?: string; jar?: string; dirs?: string[] }
  yunxiao?: { cred: string; org?: string; pipelineId?: string; image?: string; at?: number }
  github?: { workflow?: string; at?: number }
  local?: { server: string }
}
/** 服务器上登记的目录 */
/** 服务器上登记的日志：file = 文件（可带 *），dir = 目录（里面的 *.log），service = 系统服务（journalctl） */
export interface LogSource { kind: 'file' | 'dir' | 'service'; path: string; note?: string }
export interface ServerDir { path: string; mode: 'read' | 'write' | 'deploy'; note?: string; ok?: boolean; error?: string }
export interface ReleaseStep { k: 'build' | 'checkout' | 'transfer' | 'sign' | 'deploy' | 'health' | 'rollback'; s: 'pending' | 'running' | 'done' | 'failed' | 'skipped'; msg?: string; t0?: number; t1?: number }
/** 真的一套的一次发布 */
export interface LiveRelease {
  id: string; ws: string; target: string; targetName: string; build?: string; version: string; sha: string; status: 'running' | 'success' | 'failed'
  steps: ReleaseStep[]; note?: string; by: string; emp?: string; sid?: string; rollbackOf?: string; servers?: string[]; pkgName?: string; buildUrl?: string; kept?: boolean
  started: number; ended?: number; error?: string; tail?: string
}
/** 收消息的账号（邮箱 / Slack） */
export interface InChannel { id: string; kind: 'email' | 'slack'; name: string; cred: string; enabled: boolean; imapHost?: string; imapPort?: number; user?: string; team?: string; status?: 'ok' | 'error'; error?: string; lastSync?: number; convCount?: number }
/** 收件箱里的一条 */
export interface InboxItem {
  id: string; ch: string; kind: 'email' | 'slack'; from: string; fromAddr?: string; subject: string; snippet: string; at: number; url?: string
  mention?: boolean; cat?: 'need' | 'fyi' | 'skip'; by?: 'ai' | 'rule' | 'me'; summary?: string; important?: boolean; done?: boolean; draft?: string
}
/** 提醒发到外部的渠道 */
export interface Notifier {
  id: string; kind: 'email' | 'telegram' | 'slack' | 'wecom' | 'dingtalk' | 'feishu' | 'webhook'; name: string; events: ('decide' | 'error' | 'all')[]; enabled: boolean; cred: string
  credName?: string; chatId?: string; smtpHost?: string; smtpPort?: number; smtpUser?: string; to?: string; lastOk?: number; lastError?: string
}
/** 登记的域名（DNS） */
export interface Domain { id: string; domain: string; provider: 'cloudflare' | 'aliyun'; cred: string }

/** 真的一套的问题清单（日志巡检记下来的线上问题） */
export interface LiveIssue {
  id: string
  title: string
  server?: string
  workspace?: string
  severity: 'high' | 'mid' | 'low'
  status: 'new' | 'fixing' | 'fixed' | 'known' | 'ignored'
  count: number
  first: number
  last: number
  key: string
  sample: string
  cause?: string
  reporter?: string
  fixer?: string
  ignoreUntil?: number
  note?: string
}

/** 服务器给员工的规矩 */
export interface Policy { allowBuild?: boolean; build?: 'auto' | 'on' | 'off'; cpuPct?: number; allowTest?: boolean; deny?: string[]; memPct?: number; maxConcurrent?: number }

export type IssueStatus = 'new' | 'watching' | 'fixing' | 'fixed' | 'ignored'
export interface Issue {
  id: number
  title: string
  project: string
  status: IssueStatus
  severity: '严重' | '一般'
  count: number
  first: string
  last: string
  owner: string // 员工 id
  cause?: string
}

// ---------- 应用（插件）：服务器、发布、凭证、数据、触发器 ----------
/** 环境标签：随便起名、要几个都行；「改东西先确认」是单独的开关（protect） */
export type EnvTag = string

export interface Server {
  id: string
  name: string
  ip: string
  env: EnvTag
  /** 员工在上面改东西先出确认卡片；没设过按标签猜（像生产的就开） */
  protect?: boolean
  /** 给员工的规矩：能不能编译 / 自测、禁止的命令、内存上限、同时几个员工 */
  policy?: Policy
  /** 登记的本地目录：员工只读 / 读写、发布能部署进去 */
  dirs?: ServerDir[]
  /** 登记的日志（可以多个）：日志扫描不指定就扫这些 */
  logSrc?: LogSource[]
  os: string
  agent: string
  online: boolean
  cpu: number
  mem: number
  disk: number
  services: { name: string; status: '运行中' | '已停止' | '异常' }[]
  logs: string[]
  /** 真的一套：接入方式（本机 / 装了 Opero Agent / 只用 SSH）、Agent 版本、最后心跳、装了哪些执行器、连不上的原因 */
  via?: 'local' | 'agent' | 'ssh' | 'pending' | 'rejected'
  /** Agent 的指纹（SHA256:…），Opero 按它认机器 */
  agentFp?: string
  agentVersion?: string
  joinedAt?: number // 最近一次接入的时间（不是心跳）
  lastSeen?: number
  executors?: { claude?: string | null; codex?: string | null }
  /** 机器信息（Agent 心跳 / Opero 这台自己读，自动填） */
  sys?: { hostname: string; os: string; kernel: string; arch: string; cpuModel: string; cores: number; memGb: number; diskGb: number; ips: string[]; uptime: number }
  error?: string
  port?: number
  user?: string
}

export interface ReleaseApp {
  id: string
  name: string
  components: { code: string; name: string; kind: string; version: string }[]
  envs: { name: EnvTag; server: string; dir: string; aiRelease: 'auto' | 'ask' | 'off' }[]
}

export interface ReleaseRecord {
  id: number
  app: string
  env: EnvTag
  version: string
  status: '成功' | '失败' | '进行中' | '已回滚'
  by: string
  when: string
  duration: string
  steps: { name: string; ok: boolean; note?: string }[]
}

/** 权限 = 你在公司本来就有的账号，带进来就有；没有的这里也没有 */
export type CredGroup = '服务器' | '数据库' | '代码仓库' | '云账号' | '签名证书' | 'AI' | '消息渠道' | '其它'
export interface Credential {
  id: string
  /** 用户名（账号密码 / Codeup 令牌要配用户名时） */
  user?: string
  /** 真的一套：值已经存进保险箱 */
  hasSecret?: boolean
  name: string
  group: CredGroup
  /** 分类里的具体类型：MySQL、GitHub、阿里云、OpenAI、SSH 密码…（见 credmeta.ts） */
  kind: string
  env: EnvTag
  /** 不是密码的那些字段：地址、端口、库名、平台地址、AccessKey ID…… */
  meta?: Record<string, string>
  /** 最近一次「测试连接」 */
  test?: { ok: boolean; msg: string; at: number; details?: { title: string; items: string[]; total?: number }[] }
  updated: string
  aiAllowed: boolean
  /** 试用版假数据用：能做什么 / 谁在用（真的一套从员工那边算） */
  scope?: string
  usedBy?: string[]
}

/** 我的定制：这套 Opero 是官方底座的 fork，按自己的习惯二开 */
export interface Customization {
  fork: string
  base: string
  mine: { what: string; kind: '插件' | '菜单' | '员工模板' | '卡片' | '规则'; status: '已上线' | '预览中' }[]
  update?: { version: string; notes: string[] }
}

export interface DataSource {
  id: string
  name: string
  kind: 'MySQL' | 'MariaDB' | 'PostgreSQL' | 'SQL Server' | 'Oracle'
  env: EnvTag
  protect?: boolean
  host: string
  db: string
  credential?: string
  writable: boolean
  tables: { name: string; rows: string; cols: string[] }[]
  dbs?: string[] // 没填库名（整个实例）：能看到的库
}

export interface SavedQuery {
  id: string
  source: string
  name: string
  sql: string
}

/** 消息渠道：邮件 / IM 进来的消息交给「消息助理」；Opero 的通知也能发到这里 */
export interface Channel {
  id: string
  kind: '邮件' | 'Slack' | 'Telegram' | '飞书' | '企业微信' | '钉钉'
  account: string
  inbound: boolean // 收进来交给消息助理
  notifyMe: boolean // Opero 的通知也发到这里
  allowSend: boolean // 允许消息助理以你的名义代发（默认关：AI 会弄错，商业场景要严谨）
  status: '已连接' | '要重新登录'
  today: number // 今天收到多少
}

/** 知识库：所有员工共用的资料，放在一个 git 仓库（opero-kb），员工按需查 */
export interface KbDoc {
  id: string
  name: string
  kind: '产品说明' | '接口文档' | '客户信息' | '规范' | '其它'
  updated: string
  by: string
  summary: string
}

/** 流程：做过的事存成固定步骤，下次直接跑，不经过 AI（快、省钱、结果一样） */
export interface Flow {
  id: string
  name: string
  employee: string
  steps: string[]
  runs: number
  last: string
}

export interface Trigger {
  id: string
  /** 每次触发交给员工的话（真的一套） */
  prompt?: string
  /** Webhook 地址的路径（真的一套，后台生成） */
  hookPath?: string
  name: string
  kind: '定时' | 'Webhook' | '监控' | '邮件'
  rule: string
  employee: string
  enabled: boolean
  last: string
}

export interface Plugin {
  id: string
  name: string
  desc: string
  enabled: boolean
  builtin: boolean
  tools: number
  version: string
}

// ---------- 操作记录 / 设置（单用户：没有账号、角色、授权、申请） ----------
export interface AuditEntry {
  id: string
  when: string
  who: string
  via: string
  action: string
  target: string
  level: '读' | '写' | '危险'
  result: '成功' | '失败' | '拒绝'
  how: string
}

export interface Usage {
  employee: string
  tasks: number
  success: number
  tokens: string
  cost: number // 元
}

export interface Settings {
  prodProtect: boolean
  /** 每轮做完发一张小结卡片（默认开） */
  runSummary?: boolean
  habits: string // 我的习惯：所有员工都遵守的个人规矩（每次派活都带上）
  phrases?: string[] // 常用语：聊天输入框点一下就填进去
  /** 风格：'system' = 跟随系统（浅色用 themeLight、深色用 themeDark）；'custom' = 自己挑的三个颜色；其它 = themes.ts 里某一套的 key */
  theme: string
  themeLight: string
  themeDark: string
  customTheme: { mode: 'light' | 'dark'; bg: string; ink: string; accent: string }
  /** 界面语言：auto = 跟随系统，或 zh-CN / zh-TW / en / ja / de / fr / ar（i18n/index.ts）；旧值 zh 当 zh-CN */
  lang: string
  /** 实际在用的语言（auto 时按这台设备的系统），后台据此让员工用这个语言回复 */
  langResolved?: string
  notify: 'decide' | 'errors' | 'all'
  notifyTo: string[] // 通知发到哪：App 推送 / Telegram / Slack / 邮件
  budget: number // 每月预算（元），0 = 不限
  budgetStop: boolean // 用满了员工先停下来问你
  fallback: string // AI 不可用时的备用执行器（'' = 不用备用）
  aiDown: boolean // 演示：模拟 AI 不可用
}

// ---------- 界面 ----------
export type PanelKind = 'diff' | 'query' | 'menu' | 'profile' | 'credentialEdit'

export type Tab = 'chat' | 'people' | 'workspace' | 'apps' | 'me'

export type PageName =
  | 'employees' | 'employee' | 'employeeEdit' | 'memory'
  | 'workspaces' | 'workspace' | 'workspaceAdd' | 'issues' | 'issue'
  | 'apps' | 'servers' | 'server' | 'serverAdd' | 'releases' | 'release' | 'credentials' | 'credentialEdit'
  | 'data' | 'query' | 'triggers' | 'triggerEdit' | 'plugins' | 'audit'
  | 'me' | 'meEdit' | 'settings' | 'system' | 'chatInfo' | 'usage' | 'security' | 'about' | 'habits' | 'customize'
  | 'chatSettings' | 'channels' | 'inbox' | 'knowledge' | 'flows'
  | 'diff' | 'queryResult' | 'profile' | 'placeholder'
  | 'executors' | 'dataSourceAdd' | 'comingSoon' | 'history' | 'domains' | 'domain'

export interface Route {
  page: PageName
  params?: Record<string, any>
}
