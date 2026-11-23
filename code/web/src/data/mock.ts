// 原型用的初始数据（演示用）。接后台后这份删掉，由接口 / 推送填进 store。
import type {
  AuditEntry, Channel, Credential, Customization, Flow, KbDoc, DataSource, Employee, Issue, Message, Plugin, ReleaseApp,
  ReleaseRecord, SavedQuery, Server, Session, Settings, Trigger, Usage, User, Workspace,
} from '../types'

// 单用户：Opero 是个人开发助理，每人部署一套，只有主人一个账号
export const seedMe: User = { id: 'u-owner', name: '主人', email: 'owner@example.com', lastActive: '刚刚', passkey: true, signature: '把重复的事交给员工，自己只做决定', cover: 'aurora', showGreeting: true, showToday: true }

export const seedEmployees: Employee[] = [
  { id: 'shop-log', notify: 'all', bg: 'plain', repo: 'github.com/acme/emp-shop-log', repoSynced: '3 分钟前', works: [{ no: 3, from: '11-20 09:10', reason: '上一个上下文满了', host: 'dev-1' }, { no: 2, from: '11-12', to: '11-20', reason: '上下文满了', host: 'dev-1' }, { no: 1, from: '11-01', to: '11-12', reason: '刚建', host: 'dev-1' }], model: 'Opus 5.5', effort: 'high', approval: 'auto', contextUsed: 34, name: 'shop 日志值班', avatar: 'Y', color: '#10B981', title: 'shop 三个项目的线上问题',
    prompt: '你负责 shop-api / shop-admin / shop-h5 的线上问题：盯日志扫描，同一原因合并成一条问题，查清原因后派给「shop 开发」修，发布后确认不再出现再关掉。',
    executor: 'Claude Code', host: 'dev-1', workspace: 'emp-shop-log', menus: ['问题清单', '查生产库', '发布记录'], persona: '冷静、话少、先给结论' },
  { id: 'shop-dev', notify: 'decide', bg: 'plain', repo: 'github.com/acme/emp-shop-dev', repoSynced: '3 分钟前', works: [{ no: 5, from: '今天 08:40', reason: '昨天那个卡住了', host: 'dev-1' }, { no: 4, from: '11-19', to: '今天', reason: '上下文满了', host: 'dev-1' }], model: 'Opus 5.5', effort: 'xhigh', approval: 'auto', contextUsed: 61, name: 'shop 开发', avatar: '开', color: '#EC4899', title: '改 shop-api / shop-admin / short 的代码',
    prompt: '你在 shop 三个仓库里改代码：一律在工作分支上改，改完等 CI 检查通过自动合并；写清楚交接和变更记录。',
    executor: 'Claude Code', host: 'dev-1', workspace: 'shop-api', menus: ['改动记录', '预览'] },
  { id: 'release', notify: 'decide', bg: 'plain', repo: 'github.com/acme/emp-release', repoSynced: '3 分钟前', works: [{ no: 2, from: '11-15', reason: '换服务器（ops-1 → dev-1）', host: 'dev-1' }, { no: 1, from: '11-01', to: '11-15', reason: '刚建', host: 'ops-1' }], model: 'Sonnet 5.5', effort: 'medium', approval: 'auto', contextUsed: 12, name: '发布', avatar: '发', color: '#0EA5E9', title: '应用、环境、流水线、签名证书',
    prompt: '你管所有应用的发布：编译、签名、部署、发布后观察，坏了就回滚。生产有冻结窗口。',
    executor: 'Claude Code', host: 'dev-1', workspace: 'emp-release', menus: ['发布记录', '应用'] },
  { id: 'ops', notify: 'none', bg: 'plain', repo: 'github.com/acme/emp-ops', repoSynced: '3 分钟前', works: [{ no: 1, from: '11-03', reason: '刚建', host: 'ops-1' }], model: '执行器默认', effort: 'medium', approval: 'edits', contextUsed: 22, name: '运维', avatar: '运', color: '#F97316', title: '服务器、环境、资产、配置备份',
    prompt: '你管服务器：监控、清理、备份、nginx 和证书。改配置前先备份。',
    executor: 'Codex', host: 'ops-1', workspace: 'emp-ops', menus: ['服务器'] },
  { id: 'lead', notify: 'decide', bg: 'plain', repo: 'github.com/acme/emp-lead', repoSynced: '3 分钟前', works: [{ no: 1, from: '11-05', reason: '刚建', host: 'dev-1' }], model: 'Opus 5.5', effort: 'high', approval: 'auto', contextUsed: 8, name: '总调度', avatar: '总', color: '#6366F1', title: '理解需求、拆任务派给员工、跟进',
    prompt: '你不亲自干活：理解主人的需求，拆成任务派给合适的员工，跟进到做完，最后用一句话告诉主人结果。',
    executor: 'Claude Code', host: 'dev-1', workspace: 'emp-lead', menus: ['员工'] },
  { id: 'admin', notify: 'decide', bg: 'plain', repo: 'github.com/acme/emp-admin', repoSynced: '3 分钟前', works: [{ no: 1, from: '11-01', reason: '开机向导建的', host: 'ops-1' }], model: 'Sonnet 5.5', effort: 'medium', approval: 'ask', contextUsed: 5, name: '系统管家', avatar: '管', color: '#475569', title: '员工、系统设置、凭据',
    prompt: '你管 Opero 自己：建员工、改设置、管凭据和插件。',
    executor: 'Claude Code', host: 'ops-1', workspace: 'emp-admin', menus: ['员工', '设置'] },
  { id: 'crm-dev', notify: 'decide', bg: 'plain', repo: 'github.com/acme/emp-crm-dev', repoSynced: '3 分钟前', works: [{ no: 1, from: '11-18', reason: '刚建', host: 'dev-1' }], model: '执行器默认', effort: 'high', approval: 'auto', contextUsed: 47, name: 'crm 开发', avatar: '开', color: '#8B5CF6', title: 'crm 前后端',
    prompt: '你负责 crm 的前后端开发，改完起预览给主人看。',
    executor: 'Qwen Code', host: 'dev-1', workspace: 'crm', menus: ['改动记录', '预览'] },
  { id: 'inbox', notify: 'decide', bg: 'plain', repo: 'github.com/acme/emp-inbox', repoSynced: '1 分钟前', works: [{ no: 1, from: '11-10', reason: '刚建', host: 'ops-1' }],
    model: 'Sonnet 5.5', effort: 'medium', approval: 'auto', contextUsed: 18,
    name: '消息助理', avatar: '信', color: '#14B8A6', title: '邮件、Slack、Telegram…所有消息，帮你查、帮你分好；不替你回',
    prompt: '你管主人所有的消息：邮件、Slack、Telegram、飞书。只查、只整理：分成「要你看 / 知道就行 / 归档」，每条附上原文链接，让主人一键过去自己回。**不起草、不代发**（会弄错、会回到不关主人的事）；主人点「给我个回复建议」时才给模板，可以多语言。每天早上 9 点和下午 6 点各汇总一次。',
    executor: 'Claude Code', host: 'ops-1', workspace: 'emp-inbox', menus: ['收件箱', '消息渠道'] },
  { id: 'dev-opero', notify: 'decide', bg: 'plain', repo: 'github.com/acme/emp-dev-opero', repoSynced: '3 分钟前', works: [{ no: 2, from: '11-21', reason: '上下文满了', host: 'ops-1' }, { no: 1, from: '11-01', to: '11-21', reason: '开机向导建的', host: 'ops-1' }], model: 'Opus 5.5', effort: 'xhigh', approval: 'edits', contextUsed: 73, name: '后台开发', avatar: 'O', color: '#5B4FE9', title: '给 Opero 自己加功能（先预览再上线）',
    prompt: '你改的是 Opero 自己：新功能优先做成插件；先起预览，主人点「上线」才发正式的；不能改操作记录、验证本人这些安全代码。',
    executor: 'Claude Code', host: 'ops-1', workspace: 'opero', menus: ['改动记录', '插件'] },
]

// 像微信：一列聊天，置顶的在最上面，其余按最近时间排；要你处理的只在预览前面加红字（不单列一块）
const T = (h: number, m: number, dayAgo = 0) => { const d = new Date(); d.setDate(d.getDate() - dayAgo); d.setHours(h, m, 0, 0); return d.getTime() }
export const seedSessions: Session[] = [
  { id: 's-lead', employee: 'lead', last: '已派给「发布」和「运维」', time: '昨天', ts: T(21, 10, 1), pinned: true },
  { id: 's-shop-log', employee: 'shop-log', last: '支付失败 SIGN_ERR，37 次', time: '09:41', ts: T(9, 41), unread: 1, pinned: true },
  { id: 's-shop-dev', employee: 'shop-dev', last: '删除 2,300 行旧订单 · 要指纹', time: '10:20', ts: T(10, 20), unread: 1, waiting: '要你确认' },
  { id: 's-crm', employee: 'crm-dev', last: '首页改版有两个方案，你选一下', time: '10:05', ts: T(10, 5), unread: 1, waiting: '等你回答' },
  { id: 's-release', employee: 'release', last: 'shop-admin v2.3.0 已上 UAT', time: '09:12', ts: T(9, 12) },
  { id: 's-ops', employee: 'ops', last: 'dev-1 磁盘清理了 3.2 GB', time: '08:30', ts: T(8, 30), unread: 2 },
  { id: 's-admin', employee: 'admin', last: '新员工「crm 开发」建好了', time: '昨天', ts: T(18, 2, 1) },
  { id: 's-inbox', employee: 'inbox', last: '今天 31 条消息，3 条要你看', time: '09:30', ts: T(9, 30), unread: 3, waiting: '要你看' },
  { id: 's-dev-opero', employee: 'dev-opero', last: '「订单导出」插件预览好了', time: '周一', ts: T(16, 40, 3) },
]

export const seedMessages: Record<string, Message[]> = {
  's-shop-log': [
    { id: 'a1', from: 'system', kind: 'system', at: '09:41', text: '09:41 · 日志扫描发现新异常：支付失败 37 次' },
    { id: 'a2', from: 'shop-log', kind: 'text', at: '09:43', text: '查了日志和库：最近 5 单都是 SIGN_ERR，09:40 开始，和换商户密钥的时间一致。' },
    { id: 'a3', from: 'shop-log', kind: 'card', at: '09:43', card: {
      id: 'c-issue-42', type: 'issue', v: 1, state: 'open', level: 'danger',
      data: { no: 42, title: '支付失败 SIGN_ERR', severity: '严重',
        rows: [['影响', 'shop-api 生产 · 微信支付 · 37 次 / 10 分钟'],
               ['原因', '09:40 换了商户密钥，签名还在用缓存里的旧 key'],
               ['建议', '签名器改成每次读配置，换 key 后清缓存']],
        evidence: ['日志 3 段', '查询 · 5 行'] },
      actions: [
        { id: 'fix', label: '修复', style: 'primary', tool: 'issue.fix', args: { issue: 42 } },
        { id: 'watch', label: '先盯着', tool: 'issue.watch', args: { issue: 42 } },
        { id: 'ignore', label: '忽略', style: 'ghost', tool: 'issue.ignore', args: { issue: 42 } },
      ] } },
    { id: 'a4', from: 'shop-log', kind: 'card', at: '09:43', card: {
      id: 'c-q-1', type: 'query', v: 1, state: 'open', level: 'info',
      data: { source: 'shop-prod · 只读', ms: 23, total: 5,
        sql: 'SELECT id, status, err_code, created_at FROM pay_order WHERE user_id = 10086 ORDER BY id DESC LIMIT 5',
        cols: ['id', 'status', 'err_code', 'created_at'],
        rows: [['98213', 'failed', 'SIGN_ERR', '09:41'], ['98207', 'failed', 'SIGN_ERR', '09:40'],
               ['98190', 'paid', '', '09:12'], ['98172', 'paid', '', '08:57'], ['98160', 'paid', '', '08:31']] },
      actions: [
        { id: 'open', label: '展开', panel: 'query' },
        { id: 'export', label: '导出', tool: 'db.export' },
        { id: 'save', label: '存成菜单', tool: 'menu.save' },
      ] } },
    { id: 'a5', from: 'shop-log', kind: 'file', at: '09:44', file: { name: 'sign-error-0940.log', size: '12 KB', ext: 'LOG' } },
  ],
  's-shop-dev': [
    { id: 'b1', from: 'shop-dev', kind: 'text', at: '10:18', text: '你让我清理测试数据：order_tmp 里 2025 年前的旧订单有 2,300 行，已经存好快照。' },
    { id: 'b2', from: 'shop-dev', kind: 'card', at: '10:20', card: {
      id: 'c-confirm-1', type: 'confirm', v: 1, state: 'open', level: 'danger',
      data: { title: '删除 2,300 行旧订单', tag: '危险',
        detail: "shop-prod · DELETE FROM order_tmp WHERE created_at < '2025-01-01'",
        note: '已存快照，7 天内可撤销 · 由「shop 开发」发起（替你清理测试数据）',
        why: '超过 1000 行属于危险操作，需要你本人验证' },
      actions: [
        { id: 'ok', label: '指纹确认', style: 'danger', tool: 'db.exec', args: { confirm: true } },
        { id: 'no', label: '不删', tool: 'db.cancel' },
      ] } },
  ],
  's-crm': [
    { id: 'u1', from: 'crm-dev', kind: 'text', at: '10:03', text: '首页改版写好了两个方案，预览都起好了：A https://pre-a.crm.example.com  B https://pre-b.crm.example.com' },
    { id: 'u2', from: 'crm-dev', kind: 'card', at: '10:05', card: {
      id: 'c-ask-1', type: 'ask', v: 1, state: 'open', level: 'warn',
      data: { title: '首页用哪个方案？', options: ['A：大图轮播 + 分类入口（推荐）', 'B：信息流，像小红书', '都不要，我再想想'], recommend: 0 },
      actions: [{ id: 'submit', label: '提交', style: 'primary', tool: 'core.answer' }] } },
  ],
  's-release': [
    { id: 'r1', from: 'release', kind: 'text', at: '09:12', text: 'shop-admin v2.3.0 已发到 UAT，部署脚本健康检查通过。' },
    { id: 'r2', from: 'release', kind: 'card', at: '09:12', card: {
      id: 'c-gen-1', type: 'generic', v: 1, state: 'open', level: 'info',
      data: { title: 'shop-admin → UAT v2.3.0', tag: '成功', rows: [['耗时', '4 分 12 秒'], ['服务器', 'uat-1'], ['改动', '3 个提交 · 12 个文件']] },
      actions: [{ id: 'prod', label: '发到生产', style: 'primary', tool: 'release.publish', args: { env: 'prod' } }] } },
  ],
  's-ops': [
    { id: 'o1', from: 'ops', kind: 'text', at: '08:28', text: 'dev-1 内存 82%，主要是 3 个员工在干活。磁盘清了 nginx 和 docker 的旧日志，释放 3.2 GB。' },
    { id: 'o2', from: 'ops', kind: 'text', at: '08:30', text: '没动配置，备份在 /home/backup/2026-11-21。' },
  ],
  's-lead': [
    { id: 'l1', from: 'me', kind: 'text', at: '昨天', text: '把 shop-admin 新版发到 UAT，顺便看下 dev 机器内存' },
    { id: 'l2', from: 'lead', kind: 'text', at: '昨天', text: '已派给「发布」和「运维」，做完他们会把结果交回来，你不用盯。' },
  ],
  's-admin': [
    { id: 'm1', from: 'admin', kind: 'text', at: '昨天', text: '新员工「crm 开发」建好了：执行器 Qwen Code，跑在 dev-1，工作空间 crm。' },
  ],
  's-inbox': [
    { id: 'i1', from: 'inbox', kind: 'card', at: '09:30', card: {
      id: 'c-digest-1', type: 'generic', v: 1, state: 'open', level: 'info',
      data: { title: '早上的消息 · 31 条', tag: '3 条要你看', rows: [['要你看', '3 条（在下面，点「去回复」到原处自己回）'], ['知道就行', '9 条：周报、构建通知、日程变更'], ['归档了', '19 条：订阅、广告']] },
      actions: [{ id: 'all', label: '看全部', tool: 'inbox.open' }] } },
    { id: 'i2', from: 'inbox', kind: 'card', at: '09:31', card: {
      id: 'c-msg-1', type: 'generic', v: 1, state: 'open', level: 'warn',
      data: { title: '邮件 · 张总：明天的评审能改到下午 3 点吗？', tag: '要你看', ch: '邮件', original: '明天的评审能改到下午 3 点吗？上午我在外面。',
        rows: [['为什么给你看', '发给你本人，问你时间'], ['原文', '「明天的评审能改到下午 3 点吗？上午我在外面。」']] },
      actions: [{ id: 'open', label: '去回复', style: 'primary', tool: 'msg.open' }, { id: 'suggest', label: '给我个回复建议', tool: 'msg.suggest' }, { id: 'ignore', label: '不关我事', style: 'ghost', tool: 'msg.ignore' }] } },
    { id: 'i3', from: 'inbox', kind: 'card', at: '09:31', card: {
      id: 'c-msg-2', type: 'generic', v: 1, state: 'open', level: 'warn',
      data: { title: 'Slack #shop-dev · 阿浩：v1.4.2 上生产了吗？', tag: '要你看', ch: 'Slack', original: '@主人 v1.4.2 上生产了吗？',
        rows: [['为什么给你看', '@ 了你；我查到：今天 11:56 已发生产，盯了 10 分钟没报错'], ['原文', '「@主人 v1.4.2 上生产了吗？」']] },
      actions: [{ id: 'open', label: '去回复', style: 'primary', tool: 'msg.open' }, { id: 'suggest', label: '给我个回复建议', tool: 'msg.suggest' }, { id: 'ignore', label: '不关我事', style: 'ghost', tool: 'msg.ignore' }] } },
    { id: 'i4', from: 'inbox', kind: 'card', at: '09:32', card: {
      id: 'c-msg-3', type: 'generic', v: 1, state: 'open', level: 'warn',
      data: { title: 'Telegram · 客户 Lily：后台导出报错', tag: '要你看', ch: 'Telegram', original: 'Exporting October orders shows a 403 page.',
        rows: [['为什么给你看', '客户直接找你；我查了操作记录：像是「订单导出」插件的权限问题'], ['原文（英文）', '「Exporting October orders shows a 403 page.」']] },
      actions: [{ id: 'open', label: '去回复', style: 'primary', tool: 'msg.open' }, { id: 'suggest', label: '给我个回复建议', tool: 'msg.suggest' }, { id: 'fwd', label: '转给后台开发查', tool: 'employee.delegate' }] } },
  ],
  's-dev-opero': [
    { id: 'd1', from: 'dev-opero', kind: 'text', at: '周一', text: '「订单导出」插件做好了，预览：https://pre-3.opero.example.com 。改了 4 个文件，没碰内核。' },
    { id: 'd2', from: 'dev-opero', kind: 'card', at: '周一', card: {
      id: 'c-gen-2', type: 'generic', v: 1, state: 'open', level: 'info',
      data: { title: '插件「订单导出」 · 预览中', tag: '检查通过', rows: [['改动', 'plugins/order-export · 4 个文件'], ['预览', 'pre-3（测试库）'], ['上线后', '保留上一版，健康检查不过自动回滚']] },
      actions: [{ id: 'online', label: '上线', style: 'primary', tool: 'opero.promote' }] } },
  ],
}

export const seedWorkspaces: Workspace[] = [
  { id: 'shop-api', name: 'shop-api', provider: 'GitHub', repo: 'acme/shop-api', branch: 'main', host: 'dev-1', dir: '/srv/opero/work/shop-api',
    last: 'fix: 签名每次读配置（shop 开发 · 10 分钟前）', employees: ['shop-dev', 'shop-log', 'release'], preview: 'https://pre-1.shop.example.com',
    branches: [{ name: 'main', status: '主分支' }, { name: 'fix/pay-sign-42', status: '已合并', checks: '编译 · 类型检查 · 单元测试 48' }, { name: 'feat/coupon', status: '检查中', checks: 'CI #1835 运行中' }],
    commits: [{ sha: 'f114e43', msg: 'fix: 签名每次读配置，换 key 清缓存', who: 'shop 开发', when: '10 分钟前' }, { sha: '9a2c1d0', msg: 'feat: 优惠券叠加规则', who: 'shop 开发', when: '昨天' }, { sha: '77be310', msg: 'chore: 升级 SDK', who: '阿浩', when: '周一' }],
    docs: [{ name: 'docs/交接.md', updated: '10 分钟前' }, { name: 'docs/变更记录.md', updated: '10 分钟前' }, { name: 'README.md', updated: '上周' }] },
  { id: 'shop-admin', name: 'shop-admin', provider: 'GitHub', repo: 'acme/shop-admin', branch: 'main', host: 'dev-1', dir: '/srv/opero/work/shop-admin',
    last: 'v2.3.0（发布 · 1 小时前）', employees: ['shop-dev', 'release'],
    branches: [{ name: 'main', status: '主分支' }], commits: [{ sha: '3c9e8f1', msg: 'release: v2.3.0', who: '发布', when: '1 小时前' }],
    docs: [{ name: 'docs/交接.md', updated: '1 小时前' }] },
  { id: 'crm', name: 'crm', provider: 'GitHub', repo: 'acme/crm', branch: 'main', host: 'dev-1', dir: '/srv/opero/work/crm',
    last: '首页改版 A / B（crm 开发 · 15 分钟前）', employees: ['crm-dev'], preview: 'https://pre-a.crm.example.com',
    branches: [{ name: 'main', status: '主分支' }, { name: 'feat/home-v2-a', status: '预览中', checks: '检查通过' }, { name: 'feat/home-v2-b', status: '预览中', checks: '检查通过' }],
    commits: [{ sha: 'b21f0aa', msg: 'feat: 首页改版方案 A', who: 'crm 开发', when: '15 分钟前' }],
    docs: [{ name: 'docs/交接.md', updated: '15 分钟前' }] },
  { id: 'opero', name: 'opero', provider: 'GitHub', repo: 'acme/opero', branch: 'master', host: 'ops-1', dir: '/srv/opero/work/opero',
    last: 'web 0.1.2：侧滑返回（后台开发 · 今天）', employees: ['dev-opero'], preview: 'https://pre-3.opero.example.com',
    branches: [{ name: 'master', status: '主分支' }, { name: 'plugin/order-export', status: '预览中', checks: '检查通过' }],
    commits: [{ sha: 'e716173', msg: 'web 0.1.2：侧滑 / 返回键只关最上面一层', who: '后台开发', when: '今天' }],
    docs: [{ name: 'docs/交接.md', updated: '今天' }, { name: 'docs/需求.md', updated: '昨天' }] },
]

export const seedIssues: Issue[] = [
  { id: 42, title: '支付失败 SIGN_ERR', project: 'shop-api', status: 'new', severity: '严重', count: 37, first: '09:40', last: '09:41', owner: 'shop-log', cause: '换商户密钥后签名还用缓存里的旧 key' },
  { id: 41, title: 'S3 上传超时', project: 'shop-api', status: 'fixed', severity: '严重', count: 12, first: '昨天 09:40', last: '昨天 10:02', owner: 'shop-log', cause: '新 Key 没给 shop-media-prod 桶写权限' },
  { id: 39, title: '图片压缩 OOM', project: 'shop-admin', status: 'watching', severity: '一般', count: 3, first: '周一', last: '昨天', owner: 'shop-log', cause: '大图没限制尺寸' },
  { id: 37, title: '登录验证码偶发 500', project: 'shop-h5', status: 'ignored', severity: '一般', count: 2, first: '上周', last: '上周', owner: 'shop-log', cause: '第三方短信接口抖动' },
]

export const seedServers: Server[] = [
  { id: 'aws-dev', name: 'dev-1', ip: '203.0.113.10', env: '开发', os: 'Ubuntu 24.04 · 4 核 16G', agent: '2.0.1', online: true, cpu: 34, mem: 82, disk: 61,
    services: [{ name: 'opero-agent', status: '运行中' }, { name: 'docker', status: '运行中' }, { name: 'nginx', status: '运行中' }],
    logs: ['09:52 agent 心跳正常', '09:41 日志扫描：shop-api 新异常 SIGN_ERR', '08:30 运维清理旧日志 3.2 GB'] },
  { id: 'aws-uat', name: 'uat-1', ip: '203.0.113.20', env: '测试', os: 'Ubuntu 24.04 · 2 核 8G', agent: '2.0.1', online: true, cpu: 12, mem: 45, disk: 40,
    services: [{ name: 'opero-agent', status: '运行中' }, { name: 'shop-admin', status: '运行中' }], logs: ['09:12 部署 shop-admin v2.3.0'] },
  { id: 'aws-prod', name: 'prod-1', ip: '203.0.113.30', env: '生产', os: 'Ubuntu 22.04 · 8 核 32G', agent: '2.0.0', online: true, cpu: 41, mem: 63, disk: 55,
    services: [{ name: 'opero-agent', status: '运行中' }, { name: 'shop-api', status: '运行中' }, { name: 'shop-h5', status: '运行中' }], logs: ['09:40 shop-api 换商户密钥'] },
  { id: 'ops', name: 'ops-1', ip: '198.51.100.40', env: '生产', os: 'Ubuntu 24.04 · 4 核 8G', agent: '2.0.1', online: true, cpu: 8, mem: 51, disk: 72,
    services: [{ name: 'opero-agent', status: '运行中' }, { name: 'nginx', status: '运行中' }, { name: 'opero', status: '运行中' }], logs: ['09:38 部署 opero web 0.1.0'] },
]

export const seedApps: ReleaseApp[] = [
  { id: 'shop-api', name: 'shop-api', components: [{ code: 'api', name: '后台', kind: 'Java', version: 'v1.4.1' }, { code: 'android', name: '安卓', kind: 'Android', version: '3.2.0' }],
    envs: [{ name: '测试', server: 'uat-1', dir: '/srv/apps/shop-api', aiRelease: 'auto' }, { name: '生产', server: 'prod-1', dir: '/srv/apps/shop-api', aiRelease: 'auto' }] },
  { id: 'shop-admin', name: 'shop-admin', components: [{ code: 'web', name: '网页', kind: 'Node', version: 'v2.3.0' }],
    envs: [{ name: '测试', server: 'uat-1', dir: '/srv/apps/shop-admin', aiRelease: 'auto' }, { name: '生产', server: 'prod-1', dir: '/srv/apps/shop-admin', aiRelease: 'ask' }] },
  { id: 'opero', name: 'opero', components: [{ code: 'web', name: '网页（界面原型）', kind: '自定义', version: '0.1.2' }],
    envs: [{ name: '生产', server: 'ops-1', dir: '/srv/apps/opero', aiRelease: 'auto' }] },
]

export const seedReleases: ReleaseRecord[] = [
  { id: 371, app: 'shop-admin', env: '测试', version: 'v2.3.0', status: '成功', by: '发布', when: '09:12', duration: '4 分 12 秒',
    steps: [{ name: '编译', ok: true }, { name: '签名', ok: true }, { name: '部署', ok: true }, { name: '健康检查', ok: true }] },
  { id: 366, app: 'shop-h5', env: '开发', version: 'v0.9.4', status: '失败', by: 'shop 开发', when: '昨天', duration: '1 分 03 秒',
    steps: [{ name: '编译', ok: false, note: 'Kotlin 空安全：PlayerVM.kt:88' }] },
  { id: 365, app: 'opero', env: '生产', version: '0.1.0', status: '成功', by: '主人', when: '今天 09:38', duration: '1 分 06 秒',
    steps: [{ name: '编译', ok: true }, { name: '签名', ok: true }, { name: '部署', ok: true }] },
  { id: 352, app: 'crm', env: '生产', version: 'v1.8.0', status: '已回滚', by: '发布', when: '周一', duration: '6 分 40 秒',
    steps: [{ name: '编译', ok: true }, { name: '部署', ok: true }, { name: '发布后观察', ok: false, note: '5 分钟内 500 错误 23 次，已自动回滚到 v1.7.9' }] },
]

// 权限 = 你在公司本来就有的账号，带进来；员工能做的不会超过这些账号本身的权限
export const seedCredentials: Credential[] = [
  { id: 'cr-6', name: 'dev-1 Agent 令牌', group: '服务器', kind: 'Token', env: '开发', scope: '开发机：读写', usedBy: ['shop-dev', 'shop-log', 'ops', 'crm-dev'], updated: '上个月', aiAllowed: true },
  { id: 'cr-7', name: 'prod-1 Agent 令牌', group: '服务器', kind: 'Token', env: '生产', scope: '生产机：只读日志 + 部署目录', usedBy: ['shop-log', 'release'], updated: '上个月', aiAllowed: true },
  { id: 'cr-1', name: 'shop-prod 只读账号', group: '数据库', kind: '数据库', env: '生产', scope: '只读', usedBy: ['shop-log', 'shop-dev'], updated: '上周', aiAllowed: true },
  { id: 'cr-8', name: 'shop-prod 读写账号', group: '数据库', kind: '数据库', env: '生产', scope: '读写（改数据先存快照）', usedBy: ['shop-dev'], updated: '上周', aiAllowed: true },
  { id: 'cr-3', name: 'GitHub 个人令牌', group: '代码仓库', kind: 'Token', env: '开发', scope: '你能访问的仓库：读写', usedBy: ['shop-dev', 'crm-dev', 'dev-opero'], updated: '上个月', aiAllowed: true },
  { id: 'cr-9', name: '阿里云 RAM 子账号', group: '云账号', kind: '密钥', env: '生产', scope: 'ECS / RDS 只读', usedBy: ['ops'], updated: '上个月', aiAllowed: true },
  { id: 'cr-4', name: 'Anthropic API Key', group: 'AI', kind: 'Token', env: '生产', scope: '调模型（按量计费）', usedBy: ['全部员工'], updated: '上个月', aiAllowed: true },
  { id: 'cr-10', name: '邮箱授权码（owner@example.com）', group: '消息渠道', kind: '账号密码', env: '生产', scope: '只读收信（代发默认关）', usedBy: ['inbox'], updated: '11-10', aiAllowed: true },
  { id: 'cr-11', name: 'Slack 用户令牌', group: '消息渠道', kind: 'Token', env: '生产', scope: '读你能看的频道（代发默认关）', usedBy: ['inbox'], updated: '11-10', aiAllowed: true },
  { id: 'cr-12', name: 'Telegram 机器人令牌', group: '消息渠道', kind: 'Token', env: '生产', scope: '收机器人消息、给你发通知', usedBy: ['inbox'], updated: '11-10', aiAllowed: true },
  { id: 'cr-2', name: '微信支付商户密钥', group: '其它', kind: '密钥', env: '生产', scope: '支付签名', usedBy: ['release'], updated: '今天 09:40', aiAllowed: false },
  { id: 'cr-5', name: '安卓签名证书', group: '其它', kind: '证书', env: '生产', scope: '给安装包签名', usedBy: ['release'], updated: '半年前', aiAllowed: true },
]

export const seedCustom: Customization = {
  fork: 'GitHub · owner/opero（fork 自官方 opero）',
  base: '官方 0.3.0',
  mine: [
    { what: '插件「订单导出」', kind: '插件', status: '预览中' },
    { what: '给「shop 日志值班」加底部菜单「查生产库」', kind: '菜单', status: '已上线' },
    { what: '员工模板「crm 开发」（Qwen Code）', kind: '员工模板', status: '已上线' },
    { what: '规则：周五 18 点后不自动发生产', kind: '规则', status: '已上线' },
  ],
  update: { version: '官方 0.3.2', notes: ['会话列表支持按项目分组', '发布卡片显示改动摘要', '修复：Codex 长任务超时'] },
}

export const seedDataSources: DataSource[] = [
  { id: 'shop-prod', name: 'shop-prod', kind: 'MySQL', env: '生产', host: 'rm-xxx.mysql.rds.aliyuncs.com', db: 'shop', writable: true,
    tables: [{ name: 'pay_order', rows: '1.2M', cols: ['id', 'user_id', 'status', 'err_code', 'amount', 'created_at'] }, { name: 'user', rows: '86K', cols: ['id', 'phone', 'nickname', 'created_at'] }, { name: 'order_tmp', rows: '2.3K', cols: ['id', 'payload', 'created_at'] }] },
  { id: 'shop-uat', name: 'shop-uat', kind: 'MySQL', env: '测试', host: '10.20.0.15', db: 'shop', writable: true,
    tables: [{ name: 'pay_order', rows: '12K', cols: ['id', 'user_id', 'status', 'err_code', 'amount', 'created_at'] }] },
  { id: 'opero', name: 'opero', kind: 'MySQL', env: '生产', host: 'rm-yyy.mysql.rds.aliyuncs.com', db: 'opero', writable: false, tables: [] },
]

export const seedSavedQueries: SavedQuery[] = [
  { id: 'q1', source: 'shop-prod', name: '今天失败的支付', sql: "SELECT id, user_id, err_code, created_at FROM pay_order WHERE status = 'failed' AND created_at >= CURDATE() ORDER BY id DESC" },
  { id: 'q2', source: 'shop-prod', name: '某个用户最近的订单', sql: 'SELECT id, status, err_code, created_at FROM pay_order WHERE user_id = :user_id ORDER BY id DESC LIMIT 20' },
]

export const seedChannels: Channel[] = [
  { id: 'ch1', kind: '邮件', account: 'owner@example.com（IMAP / SMTP）', inbound: true, notifyMe: false, allowSend: false, status: '已连接', today: 23 },
  { id: 'ch2', kind: 'Slack', account: 'acme.slack.com · 你的账号', inbound: true, notifyMe: true, allowSend: false, status: '已连接', today: 5 },
  { id: 'ch3', kind: 'Telegram', account: '@opero_owner_bot', inbound: true, notifyMe: true, allowSend: false, status: '已连接', today: 3 },
  { id: 'ch4', kind: '飞书', account: 'Acme · 你的账号', inbound: false, notifyMe: false, allowSend: false, status: '要重新登录', today: 0 },
]

export const seedKb: KbDoc[] = [
  { id: 'kb1', name: 'shop 产品说明', kind: '产品说明', updated: '上周', by: '主人', summary: 'shop-api / shop-admin / short 是干什么的、用户是谁、主要流程' },
  { id: 'kb2', name: '支付接口文档（微信 / 支付宝）', kind: '接口文档', updated: '11-18', by: 'shop 开发', summary: '下单、回调、退款、签名规则；商户密钥在「权限和凭证」' },
  { id: 'kb3', name: '大客户名单和联系人', kind: '客户信息', updated: '11-10', by: '主人', summary: 'Lily（导出报表）、张总（评审）…… 消息助理判断「为什么给你看」时会查' },
  { id: 'kb4', name: '发版规范', kind: '规范', updated: '11-02', by: '发布', summary: '冻结窗口、版本号规则、回滚条件' },
  { id: 'kb5', name: 'crm 首页改版需求', kind: '其它', updated: '11-17', by: 'crm 开发', summary: '两个方案的截图和取舍' },
]

export const seedFlows: Flow[] = [
  { id: 'f1', name: '发版前检查', employee: 'release', steps: ['看测试环境 2 小时内有没有新报错', '核对冻结窗口', '核对版本号已改', '生成更新说明'], runs: 14, last: '今天 09:10' },
  { id: 'f2', name: '每天清理旧日志', employee: 'ops', steps: ['列出 7 天前的 nginx / docker 日志', '压缩后删掉原文件', '报告释放了多少空间'], runs: 21, last: '今天 08:30' },
  { id: 'f3', name: '新项目接入', employee: 'admin', steps: ['接入仓库', '建开发员工（从模板）', '配发布环境', '加日志扫描触发器'], runs: 3, last: '11-18' },
]

export const seedTriggers: Trigger[] = [
  { id: 't1', name: 'shop 日志扫描', kind: '监控', rule: '新种类异常 / 恢复后又出现 / 发布后还在报 · 生产「严重 + 错误」', employee: 'shop-log', enabled: true, last: '09:41 触发' },
  { id: 't2', name: '每天 9 点巡检服务器', kind: '定时', rule: '每天 09:00', employee: 'ops', enabled: true, last: '今天 09:00' },
  { id: 't3', name: '每周一出周报', kind: '定时', rule: '每周一 10:00', employee: 'lead', enabled: false, last: '上周一' },
  { id: 't5', name: '每天 9 点 / 18 点汇总消息', kind: '定时', rule: '每天 09:00、18:00', employee: 'inbox', enabled: true, last: '今天 09:30' },
  { id: 't4', name: 'GitHub 合并请求', kind: 'Webhook', rule: 'https://opero.example.com/hook/t4（已生成密钥）', employee: 'shop-dev', enabled: true, last: '昨天' },
]

export const seedPlugins: Plugin[] = [
  { id: 'server', name: '服务器与 Agent', desc: '服务器、日志扫描、只读命令', enabled: true, builtin: true, tools: 9, version: '1.0' },
  { id: 'release', name: '发布', desc: '应用、环境、流水线、签名、回滚', enabled: true, builtin: true, tools: 7, version: '1.0' },
  { id: 'credential', name: '凭证', desc: '加密存放，AI 只拿编号', enabled: true, builtin: true, tools: 3, version: '1.0' },
  { id: 'data', name: '数据', desc: '查库、修数据（快照撤销）', enabled: true, builtin: true, tools: 5, version: '1.0' },
  { id: 'cloud', name: '云', desc: 'AWS / 阿里云', enabled: true, builtin: true, tools: 6, version: '1.0' },
  { id: 'notify', name: '通知渠道', desc: '推送、短信、邮件', enabled: true, builtin: true, tools: 2, version: '1.0' },
  { id: 'order-export', name: '订单导出', desc: '「后台开发」做的，预览中', enabled: false, builtin: false, tools: 1, version: '0.1' },
]

export const seedAudit: AuditEntry[] = [
  { id: 'au1', when: '09:43', who: '主人', via: 'shop 日志值班', action: 'db.query', target: 'shop-prod', level: '读', result: '成功', how: '直接做（审核方式：自动）' },
  { id: 'au2', when: '09:41', who: '系统', via: 'shop 日志值班', action: 'server.logscan', target: 'prod-1', level: '读', result: '成功', how: '触发器「shop 日志扫描」' },
  { id: 'au3', when: '09:38', who: '主人', via: '—', action: 'release.publish', target: 'opero · 生产', level: '写', result: '成功', how: '本人点「发布」+ 指纹' },
  { id: 'au4', when: '昨天', who: '主人', via: '运维', action: 'server.cmd', target: 'prod-1 · rm -rf /var/log/old', level: '写', result: '拒绝', how: '只读命令通道不能写 → 交给运维走写操作' },
  { id: 'au5', when: '昨天', who: '主人', via: '系统管家', action: 'employee.create', target: 'crm 开发', level: '写', result: '成功', how: '直接做' },
]

export const seedUsage: Usage[] = [
  { employee: 'shop-log', tasks: 46, success: 44, tokens: '3.1M', cost: 86.4 },
  { employee: 'shop-dev', tasks: 31, success: 27, tokens: '5.8M', cost: 162.0 },
  { employee: 'release', tasks: 28, success: 26, tokens: '0.9M', cost: 21.5 },
  { employee: 'ops', tasks: 19, success: 19, tokens: '0.6M', cost: 9.8 },
  { employee: 'lead', tasks: 12, success: 11, tokens: '0.4M', cost: 11.2 },
  { employee: 'crm-dev', tasks: 9, success: 8, tokens: '2.2M', cost: 38.6 },
  { employee: 'dev-opero', tasks: 6, success: 6, tokens: '1.5M', cost: 44.1 },
  { employee: 'inbox', tasks: 22, success: 22, tokens: '0.8M', cost: 12.4 },
  { employee: 'admin', tasks: 4, success: 4, tokens: '0.1M', cost: 2.3 },
]

export const seedSettings: Settings = {
  prodProtect: false, theme: 'system', themeLight: 'amethyst', themeDark: 'slate', customTheme: { mode: 'light', bg: '#F3EEE3', ink: '#111111', accent: '#D9541E' }, lang: 'auto', notify: 'decide', notifyTo: ['App 推送', 'Telegram'],
  budget: 800, budgetStop: true, fallback: 'Codex', aiDown: false,
  habits: '- 回复用中文，先给结论再说原因\n- 改代码在分支上，检查通过就合并，不用问我\n- 不要在共享服务器上跑测试和服务\n- 周五 18 点后不自动发生产',
}

export const diffFiles = [
  {
    name: 'PayService.java', add: 12, del: 3,
    lines: [
      [' ', '52', 'public PayResult pay(Order o) {'],
      [' ', '53', '  PayReq req = build(o);'],
      ['-', '54', '  String sign = signer.sign(req, cachedKey);'],
      ['+', '54', '  String key = config.merchantKey();'],
      ['+', '55', '  String sign = signer.sign(req, key);'],
      [' ', '56', '  return client.send(req, sign);'],
      [' ', '57', '}'],
      ['@', '', '@@ 88,6 +89,14 @@ onConfigChanged'],
      [' ', '89', 'void onConfigChanged(Config c) {'],
      ['-', '90', '  // TODO'],
      ['+', '90', '  if (c.changed("merchantKey")) {'],
      ['+', '91', '    signer.clearCache();'],
      ['+', '92', '    log.info("merchant key rotated");'],
      ['+', '93', '  }'],
      [' ', '94', '}'],
    ],
  },
  {
    name: 'WechatSigner.java', add: 8, del: 2,
    lines: [
      [' ', '18', 'public class WechatSigner {'],
      ['-', '19', '  private final Map<String, String> cache = new HashMap<>();'],
      ['+', '19', '  private final Map<String, String> cache = new ConcurrentHashMap<>();'],
      [' ', '20', ''],
      ['+', '41', '  public void clearCache() {'],
      ['+', '42', '    cache.clear();'],
      ['+', '43', '  }'],
    ],
  },
]

// 员工记忆（它 git 仓库里的文件，演示）
export const memoryFiles: Record<string, { name: string; text: string }[]> = {
  default: [
    { name: 'CLAUDE.md', text: '## 我的角色\n（职责提示词）\n\n## 规矩\n- 先读 docs/交接.md 再开工\n- 改代码在工作分支上，CI 通过自动合并\n- 不在提示词里写「自测」' },
    { name: 'docs/交接.md', text: '## 2026-11-22\n- 修了 #42 支付签名，v1.4.2 已上生产\n- 下一步：盯 SIGN_ERR 24 小时' },
    { name: 'docs/机器/dev-1.md', text: '- 工作区 /srv/opero/work' },
  ],
}
