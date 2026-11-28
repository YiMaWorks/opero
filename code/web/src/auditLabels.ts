// 操作记录里的动作代码（后台 audit 的 action）→ 给人看的话。没收录的显示原代码（小字），不会出错
const L: Record<string, string> = {
  'agent.accept': '接受 Agent 接入', 'agent.add': '接入 Agent', 'agent.move': 'Agent 改连新地址', 'agent.pending': 'Agent 等你接受', 'agent.reconnect': 'Agent 重新接入',
  'agent.reject': '拒绝 Agent 接入', 'agent.remove': '移除 Agent', 'agent.token': '生成接入命令', 'agent.upgrade': '升级 Agent',
  'ai.account.add': '加 AI 账号', 'ai.account.remove': '去掉 AI 账号', 'ai.config': '改 AI 执行器设置', 'ai.install': '装 AI 执行器', 'ai.login': '登录 AI 账号',
  'app.pair': '连上手机 App', 'app.unpair': '断开手机 App', 'build.auto': '自动配编译', 'build.generate': '生成流水线', 'build.remove': '去掉编译组件',
  cancel: '取消', 'channel.add': '加消息渠道', 'command.deny': '拒绝危险命令', confirm: '确认', 'credential.create': '新增凭证', 'credential.delete': '删凭证',
  'credential.reveal': '看凭证明文', 'credential.update': '改凭证', 'data.add': '接入数据库', 'db.exec': '改数据', 'db.query': '查库', delete: '删除',
  'dns.delete': '删解析', 'dns.set': '改解析', 'domain.add': '登记域名', 'egress.delete': '删网络出口', 'egress.set': '设网络出口',
  'employee.create': '建员工', 'employee.creds': '改员工能用的凭证', 'employee.delete': '删员工', 'employee.switch': '换执行器', 'employee.update': '改员工',
  'issue.new': '新问题', 'issue.fix': '交给员工修', 'issue.known': '标成已知', 'issue.ignore': '忽略问题', 'kb.add': '加知识库资料', 'kb.update': '改知识库资料',
  later: '以后再说', list: '列出', 'log.scan': '扫日志', login: '登录', 'mcp.app': '员工改应用设置', 'mcp.image': '员工生图', 'mfa.disable': '关两步验证',
  'mfa.enable': '开两步验证', 'notifier.add': '加提醒渠道', 'notify.test': '试发提醒', 'owner.create': '建主人账号', 'owner.password': '改密码',
  'package.download': '下载安装包', 'package.remove': '删安装包', 'package.store': '存安装包', 'passkey.add': '加通行密钥', 'passkey.remove': '删通行密钥',
  'perm.deny': '没给权限', 'perm.grant': '给了权限', 'perm.request': '申请权限', 'policy.deny': '机器规矩拦下', 'pr.create': '提合并请求',
  'release.end': '发布结束', 'release.rollback': '回滚', 'release.start': '开始发布', 'release.target.create': '建发布环境', 'release.target.update': '改发布环境',
  save: '保存', 'server.add': '接入服务器', 'server.dirs': '改服务器目录', 'server.exec': '在服务器上跑命令', 'server.logs': '改日志登记', 'server.policy': '改机器规矩',
  'server.update': '改服务器', 'server.write': '改服务器上的文件', 'session.handoff': '会话交接', sign: '签名', timeout: '超时',
  'trigger.create': '建触发器', 'trigger.delete': '删触发器', 'trigger.update': '改触发器', 'workspace.add': '接入项目', 'workspace.branch': '切分支',
  'workspace.delete': '删项目', 'usage.reset': '清掉算错的花费', 'workspace.rename': '项目改名', 'git.push': '推送代码', 'git.pull': '拉代码',
}
export const auditLabel = (action: string): string | undefined => L[action]
