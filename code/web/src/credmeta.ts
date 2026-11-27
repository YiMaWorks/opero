// 凭证目录：分类 → 类型 → 要填什么、去哪拿、怎么拿。新增凭证页照这里画，每一种都有明确的获取步骤和直达链接。
// 后台只管连（code/server/src/creds.ts 的测试连接）；改这里的类型名要和那边对上。
import type { CredGroup } from './types'

export interface CredField {
  key: string
  label: string
  placeholder?: string
  /** 默认值（端口这类），用户不用填 */
  def?: string
  hint?: string
  optional?: boolean
  numeric?: boolean
}
export interface CredGuide {
  /** 直达那个平台拿令牌 / Key 的页面；{site} 换成填的平台地址 */
  link?: { label: string; url: string }
  steps: string[]
  /** 要勾 / 要给的权限 */
  perms?: string
  /** 可以直接复制去跑的命令 / SQL（{db} 换成填的库名） */
  snippet?: { label: string; code: string }
}
export interface CredType {
  kind: string
  label?: string
  fields: CredField[]
  /** 用户名：auto = 测试时自动认出来，不用填 */
  user?: { label: string; placeholder?: string; optional?: boolean; def?: string } | 'auto'
  secret: { label: string; placeholder?: string; multiline?: boolean; file?: boolean }
  guide: CredGuide
  /** 能不能「测试连接」 */
  testable?: boolean
}
export interface CredGroupMeta {
  group: CredGroup
  desc: string
  types: CredType[]
  /** 这一类不在这里加，去别的页面（消息渠道） */
  goto?: { page: 'channels'; label: string }
  /** 这一类的共同说明（放在类型选择上面） */
  note?: string
}

const DB_STEPS = (extra: string) => [
  '有连接串（项目配置里的 mysql://… / postgres://… / jdbc:… / Server=…;Database=…）直接贴到最上面的「连接串」，地址、端口、账号、密码、库名自动拆好',
  '库名可以不填：整个实例交给员工，这个账号能看到的库它都能查，查的时候自己挑；只想给一个库就填上',
  '地址填 Opero 这台能连到的内网 IP 或域名；云数据库（阿里云 RDS、腾讯云 CDB 等）要先把 Opero 这台服务器的 IP 加进白名单 / 安全组',
  '现成的账号直接用就行，密码加密存在 Opero，员工拿不到；生产库想更稳就用下面的语句建一个只读账号',
  extra,
  '点「测试连接」会读出能看到哪些库、哪些表、这个账号能不能改数据',
]
const dbFields = (port: string, db: CredField | null): CredField[] => [
  { key: 'host', label: '地址', placeholder: '10.0.0.5 或 db.example.com' },
  { key: 'port', label: '端口', def: port, numeric: true },
  ...(db ? [db] : []),
]
const DB_NAME: CredField = { key: 'db', label: '库名', placeholder: '不填 = 整个实例', optional: true }

export const CRED_META: CredGroupMeta[] = [
  {
    group: '代码仓库',
    desc: '员工拉代码、推送、提合并请求用；接入项目时选它',
    types: [
      {
        kind: 'GitHub', fields: [], user: 'auto', testable: true,
        secret: { label: '令牌', placeholder: 'ghp_…' },
        guide: {
          link: { label: '去 GitHub 创建令牌', url: 'https://github.com/settings/tokens/new?scopes=repo,workflow&description=Opero' },
          steps: [
            '点上面的按钮，登录 GitHub：打开的是「Personal access tokens (classic)」新建页，名字和权限已经替你填好',
            'Expiration（过期时间）选一个，比如 90 days；不想到期就选 No expiration',
            '拉到页面最下面，点绿色的「Generate token」',
            '复制页面上 ghp_ 开头的那一串（只显示这一次），贴到下面',
          ],
          perms: 'repo（读写代码、提合并请求）、workflow（「生成流水线」要往仓库里提交 GitHub Actions 工作流）',
        },
      },
      {
        kind: 'GitLab', user: 'auto', testable: true,
        fields: [{ key: 'site', label: 'GitLab 地址', def: 'https://gitlab.com', hint: '用 gitlab.com 不用改；公司自建的填自己的地址' }],
        secret: { label: '令牌', placeholder: 'glpat-…' },
        guide: {
          link: { label: '去 GitLab 创建令牌', url: '{site}/-/user_settings/personal_access_tokens?name=Opero&scopes=api,read_repository,write_repository' },
          steps: [
            '点上面的按钮，登录 GitLab：打开的是「Personal access tokens」页，名字和权限已经替你勾好（老版本 GitLab 在 头像 → Preferences → Access Tokens）',
            'Expiration date 选一个过期时间',
            '点「Create personal access token」',
            '复制 glpat- 开头的那一串（只显示这一次），贴到下面',
          ],
          perms: 'api（提合并请求、查流水线）、read_repository、write_repository',
        },
      },
      {
        kind: 'Gitee', fields: [], user: 'auto', testable: true,
        secret: { label: '私人令牌' },
        guide: {
          link: { label: '去 Gitee 创建私人令牌', url: 'https://gitee.com/profile/personal_access_tokens/new' },
          steps: [
            '点上面的按钮，登录 Gitee：打开的是「私人令牌 → 生成新令牌」页',
            '「私人令牌描述」填 Opero',
            '权限勾上 user_info、projects、pull_requests',
            '点「提交」，输入 Gitee 登录密码确认',
            '复制生成的令牌（只显示这一次），贴到下面',
          ],
          perms: 'user_info（认出你的账号）、projects（读写仓库）、pull_requests（提合并请求）',
        },
      },
      {
        kind: 'Codeup', label: 'Codeup（阿里云云效）', fields: [], user: 'auto', testable: true,
        secret: { label: '个人访问令牌', placeholder: 'pt-…' },
        guide: {
          link: { label: '去云效创建个人访问令牌', url: 'https://account-devops.aliyun.com/settings/personalAccessToken' },
          steps: [
            '点上面的按钮，用阿里云账号登录云效：打开的是「个人设置 → 个人访问令牌」',
            '点「新建令牌」，名字填 Opero，过期时间选长一点',
            '权限范围：「代码仓库」选读写；「组织 / 成员」选只读（用来认出你的账号、列出仓库）；要用「生成云效流水线」再把「流水线」选读写',
            '点确定，复制 pt- 开头的令牌（只显示这一次），贴到下面',
          ],
          perms: '代码仓库：读写；组织 / 成员：只读；流水线：读写（用云效编译时）',
        },
      },
      {
        kind: 'Gitea', label: 'Gitea / 自建 Git', user: 'auto', testable: true,
        fields: [{ key: 'site', label: '地址', placeholder: 'https://git.example.com' }],
        secret: { label: '访问令牌' },
        guide: {
          link: { label: '去 Gitea 创建令牌', url: '{site}/user/settings/applications' },
          steps: [
            '先在上面填你的 Gitea 地址，再点按钮：打开的是「设置 → 应用」',
            '在「管理 Access Token」里填令牌名称 Opero',
            '权限：repository 选读写，user 选只读',
            '点「生成令牌」，复制那一串（只显示这一次），贴到下面',
          ],
          perms: 'repository：读写；user：只读',
        },
      },
    ],
  },
  {
    group: '数据库',
    desc: '员工查数据用（只读事务、自动打码）；允许改数据的库，改之前要你点确认',
    types: [
      {
        kind: 'MySQL', fields: dbFields('3306', DB_NAME), user: { label: '用户', placeholder: 'opero_ro' }, testable: true, secret: { label: '密码' },
        guide: { steps: DB_STEPS('MySQL 5.7 / 8.x 都可以'), snippet: { label: '建只读账号（MySQL）', code: "CREATE USER 'opero_ro'@'%' IDENTIFIED BY '换成一个强密码';\nGRANT SELECT, SHOW VIEW ON {db}.* TO 'opero_ro'@'%';" } },
      },
      {
        kind: 'MariaDB', fields: dbFields('3306', DB_NAME), user: { label: '用户', placeholder: 'opero_ro' }, testable: true, secret: { label: '密码' },
        guide: { steps: DB_STEPS('MariaDB 10.x 都可以'), snippet: { label: '建只读账号（MariaDB）', code: "CREATE USER 'opero_ro'@'%' IDENTIFIED BY '换成一个强密码';\nGRANT SELECT, SHOW VIEW ON {db}.* TO 'opero_ro'@'%';" } },
      },
      {
        kind: 'PostgreSQL', fields: dbFields('5432', DB_NAME), user: { label: '用户', placeholder: 'opero_ro' }, testable: true, secret: { label: '密码' },
        guide: { steps: DB_STEPS('表在别的 schema 里，把语句里的 public 换掉'), snippet: { label: '建只读账号（PostgreSQL）', code: "CREATE USER opero_ro WITH PASSWORD '换成一个强密码';\nGRANT CONNECT ON DATABASE {db} TO opero_ro;\nGRANT USAGE ON SCHEMA public TO opero_ro;\nGRANT SELECT ON ALL TABLES IN SCHEMA public TO opero_ro;\nALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO opero_ro;" } },
      },
      {
        kind: 'SQL Server', fields: dbFields('1433', DB_NAME), user: { label: '用户', placeholder: 'opero_ro' }, testable: true, secret: { label: '密码' },
        guide: { steps: DB_STEPS('要开 SQL Server 身份验证（混合模式），TCP 1433 端口要放开'), snippet: { label: '建只读账号（SQL Server）', code: "CREATE LOGIN opero_ro WITH PASSWORD = '换成一个强密码';\nUSE {db};\nCREATE USER opero_ro FOR LOGIN opero_ro;\nALTER ROLE db_datareader ADD MEMBER opero_ro;" } },
      },
      {
        kind: 'Oracle', testable: true, user: { label: '用户', placeholder: 'OPERO_RO' }, secret: { label: '密码' },
        fields: dbFields('1521', { key: 'db', label: '服务名', placeholder: 'ORCLPDB1', hint: '不是 SID：在库上跑 SELECT value FROM v$parameter WHERE name = \'service_names\' 能查到' }),
        guide: { steps: DB_STEPS('不用装 Oracle 客户端；12c 及以上都可以。员工看到的表是这个用户自己的，要看别人的表就用 业务用户.表名'), snippet: { label: '建只读账号（Oracle）', code: 'CREATE USER opero_ro IDENTIFIED BY "换成一个强密码";\nGRANT CREATE SESSION TO opero_ro;\nGRANT SELECT ANY TABLE TO opero_ro;' } },
      },
      {
        kind: 'Redis', testable: true, user: { label: '用户（Redis 6 的 ACL 用户，没有就不填）', optional: true }, secret: { label: '密码' },
        fields: dbFields('6379', null),
        guide: { steps: ['地址填 Opero 这台能连到的；云 Redis 要把 Opero 这台的 IP 加进白名单', 'Redis 6 以上可以建一个只读用户（下面的命令），老版本就用 requirepass 的密码', '填好点「测试连接」（会发 AUTH + PING）', '现在只存账号、能测试连接；员工直接查 Redis 还没做'], snippet: { label: '建只读用户（Redis 6+）', code: 'ACL SETUSER opero_ro on >换成一个强密码 ~* +@read' } },
      },
      {
        kind: 'MongoDB', testable: true, user: { label: '用户', placeholder: 'opero_ro' }, secret: { label: '密码' },
        fields: dbFields('27017', { key: 'db', label: '认证库', def: 'admin', optional: true }),
        guide: { steps: ['地址填 Opero 这台能连到的；云 MongoDB 要把 Opero 这台的 IP 加进白名单', '建一个只读用户（下面的命令在 mongosh 里跑）', '填好点「测试连接」（现在只测端口通不通）', '现在只存账号；员工直接查 MongoDB 还没做'], snippet: { label: '建只读用户（mongosh）', code: "use admin\ndb.createUser({ user: 'opero_ro', pwd: '换成一个强密码', roles: [{ role: 'readAnyDatabase', db: 'admin' }] })" } },
      },
    ],
  },
  {
    group: '服务器',
    desc: '只有走 SSH 的服务器要；装了 Opero Agent 的服务器不用存密码',
    note: '推荐给服务器装 Agent（应用 → 服务器 → 接入服务器），不用把 SSH 密码交给 Opero，员工还能在那台上干活。只能用 SSH 的才在这里加。',
    types: [
      {
        kind: 'SSH 私钥', testable: true, user: { label: '登录用户', def: 'root' },
        fields: [{ key: 'host', label: '地址', placeholder: '服务器 IP 或域名' }, { key: 'port', label: '端口', def: '22', numeric: true }],
        secret: { label: '私钥', placeholder: '-----BEGIN OPENSSH PRIVATE KEY-----', multiline: true, file: true },
        guide: {
          steps: [
            '在你自己电脑的终端里生成一对专给 Opero 用的钥匙（下面第一条命令），会得到 opero_key（私钥）和 opero_key.pub（公钥）',
            '把公钥放到服务器上：第二条命令（要输一次服务器密码）；没有 ssh-copy-id 就把 opero_key.pub 的内容追加到服务器的 ~/.ssh/authorized_keys',
            '把私钥 opero_key 的全部内容贴到下面（或点「从文件读」选它）',
            '点「测试连接」，能登录就保存',
          ],
          snippet: { label: '在你电脑上跑', code: 'ssh-keygen -t ed25519 -f opero_key -N "" -C opero\nssh-copy-id -i opero_key.pub root@服务器IP' },
        },
      },
      {
        kind: 'SSH 密码', testable: true, user: { label: '登录用户', def: 'root' },
        fields: [{ key: 'host', label: '地址', placeholder: '服务器 IP 或域名' }, { key: 'port', label: '端口', def: '22', numeric: true }],
        secret: { label: '密码' },
        guide: { steps: ['地址、端口、用户、密码就是你平时 ssh 登录用的那套', '服务器要允许密码登录（sshd_config 里 PasswordAuthentication yes）；更安全的做法是用「SSH 私钥」', '点「测试连接」，能登录就保存'] },
      },
    ],
  },
  {
    group: '云账号',
    desc: '员工查云资源、改域名解析用（阿里云、腾讯云、华为云、AWS、Cloudflare）；建一个只给需要权限的子账号，不要用主账号',
    types: [
      {
        kind: '阿里云', testable: true, fields: [{ key: 'akId', label: 'AccessKey ID', placeholder: 'LTAI…' }],
        secret: { label: 'AccessKey Secret' },
        guide: {
          link: { label: '去阿里云创建 RAM 用户', url: 'https://ram.console.aliyun.com/users/new' },
          steps: [
            '点上面的按钮，登录阿里云：打开的是「RAM 访问控制 → 创建用户」（不要用主账号的 AccessKey）',
            '登录名称填 opero，访问方式勾「使用永久 AccessKey 访问」，点确定',
            '复制 AccessKey ID 和 AccessKey Secret（Secret 只显示这一次），分别贴到下面',
            '回到用户列表，点这个用户的「添加权限」：只看用 ReadOnlyAccess；要让员工改域名解析再加 AliyunDNSFullAccess',
          ],
          perms: 'ReadOnlyAccess（只读）；AliyunDNSFullAccess（改解析时）',
        },
      },
      {
        kind: '腾讯云', testable: true, fields: [{ key: 'akId', label: 'SecretId', placeholder: 'AKID…' }],
        secret: { label: 'SecretKey' },
        guide: {
          link: { label: '去腾讯云新建子用户', url: 'https://console.cloud.tencent.com/cam' },
          steps: [
            '点上面的按钮，登录腾讯云：在「访问管理 → 用户 → 用户列表」点「新建用户 → 快速创建」',
            '用户名填 opero，访问方式勾「编程访问」，用户权限：只看选 ReadOnlyAccess；要改解析再加 QcloudDNSPodFullAccess',
            '创建完成页复制 SecretId 和 SecretKey（SecretKey 只显示这一次），贴到下面',
          ],
          perms: 'ReadOnlyAccess（只读）；QcloudDNSPodFullAccess（改解析时）',
        },
      },
      {
        kind: 'Cloudflare', testable: true, fields: [],
        secret: { label: 'API 令牌' },
        guide: {
          link: { label: '去 Cloudflare 创建 API 令牌', url: 'https://dash.cloudflare.com/profile/api-tokens' },
          steps: [
            '点上面的按钮，登录 Cloudflare：打开的是「My Profile → API Tokens」',
            '点「Create Token」，在模板里找「Edit zone DNS」点「Use template」',
            'Zone Resources 选「Include → All zones」（或者只选要给员工管的域名），点「Continue to summary」→「Create Token」',
            '复制显示的令牌（只显示这一次），贴到下面；测试连接会列出它能管的域名',
          ],
          perms: 'Zone → DNS → Edit（只改解析）',
        },
      },
      {
        kind: '华为云', fields: [{ key: 'akId', label: 'Access Key Id' }],
        secret: { label: 'Secret Access Key' },
        guide: {
          link: { label: '去华为云 IAM 创建用户', url: 'https://console.huaweicloud.com/iam/#/iam/users/create' },
          steps: [
            '点上面的按钮，登录华为云：在「统一身份认证 IAM → 用户 → 创建用户」',
            '用户名填 opero，访问方式勾「编程访问」，凭证类型选「访问密钥」，按需加入只读用户组',
            '创建完成会下载 credentials.csv，里面的 Access Key Id 和 Secret Access Key 分别贴到下面',
            '华为云暂时不能一键测试，用的时候才知道对不对',
          ],
        },
      },
      {
        kind: 'AWS', testable: true, fields: [{ key: 'akId', label: 'Access key ID', placeholder: 'AKIA…' }],
        secret: { label: 'Secret access key' },
        guide: {
          link: { label: '去 AWS IAM 创建用户', url: 'https://console.aws.amazon.com/iam/home#/users/create' },
          steps: [
            '点上面的按钮，登录 AWS：IAM → Users → Create user，User name 填 opero',
            'Permissions 选「Attach policies directly」，勾 ReadOnlyAccess；要改 Route 53 解析再勾 AmazonRoute53FullAccess',
            '建好后进到这个用户 → Security credentials → Create access key → 选「Application running outside AWS」',
            '复制 Access key 和 Secret access key（Secret 只显示这一次），贴到下面',
          ],
          perms: 'ReadOnlyAccess（只读）；AmazonRoute53FullAccess（改解析时）',
        },
      },
    ],
  },
  {
    group: 'AI',
    desc: '模型的 API Key（按量计费）；员工用的 Claude Code / Codex 在「AI 执行器」里登录，不在这里',
    types: (
      [
        ['Anthropic', 'https://console.anthropic.com/settings/keys', 'sk-ant-…'],
        ['OpenAI', 'https://platform.openai.com/api-keys', 'sk-…'],
        ['DeepSeek', 'https://platform.deepseek.com/api_keys', 'sk-…'],
        ['通义千问（阿里云百炼）', 'https://bailian.console.aliyun.com/?tab=model#/api-key', 'sk-…'],
        ['豆包（火山方舟）', 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', ''],
        ['智谱 GLM', 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys', ''],
        ['Kimi（月之暗面）', 'https://platform.moonshot.cn/console/api-keys', 'sk-…'],
        ['硅基流动', 'https://cloud.siliconflow.cn/account/ak', 'sk-…'],
        ['OpenRouter', 'https://openrouter.ai/settings/keys', 'sk-or-…'],
        ['Google Gemini', 'https://aistudio.google.com/apikey', 'AIza…'],
        ['xAI', 'https://console.x.ai/', 'xai-…'],
      ] as const
    ).map(([kind, url, ph]): CredType => ({
      kind, fields: [], testable: true, secret: { label: 'API Key', placeholder: ph || undefined },
      guide: {
        link: { label: `去 ${kind} 拿 Key`, url },
        steps: ['点上面的按钮，登录（没有账号先注册，按量付费的要先充值或绑卡）', '新建一个 API Key，名字填 Opero', '复制这个 Key（很多平台只显示这一次），贴到下面，点「测试连接」'],
      },
    })).concat([{
      kind: 'OpenAI 兼容（中转 / 自建）', testable: true, fields: [{ key: 'base', label: '接口地址', placeholder: 'https://api.example.com/v1', hint: '到 /v1 为止（Opero 会请求 地址/models 来测试）' }],
      secret: { label: 'API Key' },
      guide: { steps: ['向你的中转服务 / 自建网关要接口地址和 Key', '接口要兼容 OpenAI 的格式（有 /v1/models、/v1/chat/completions）', '填好点「测试连接」'] },
    }]),
  },
  {
    group: '签名证书',
    desc: '给 App 签名：安卓的发布时 Opero 自己签；苹果证书、App Store Connect API Key、Windows 代码签名给 Mac / Windows 上打包用。证书和密码都不给员工',
    types: [{
      kind: '安卓签名', fields: [], secret: { label: '证书' },
      guide: {
        steps: [
          '已经有上架用的签名文件（.jks / .keystore）就直接用它：换了签名，用户装新版会提示冲突',
          '还没有就用 JDK 自带的 keytool 生成一个（下面的命令，按提示设密码）；这个文件和密码一定要另外备份，丢了以后就没法更新 App',
          '选签名文件，填密钥库密码和别名（生成时 -alias 后面那个）；密钥密码和密钥库密码一样就不填',
        ],
        snippet: { label: '生成签名文件', code: 'keytool -genkeypair -v -keystore release.jks -alias release -keyalg RSA -keysize 2048 -validity 36500' },
      },
    }, {
      kind: '苹果证书', fields: [], secret: { label: '证书' },
      guide: {
        link: { label: '打开苹果开发者网站 · 证书', url: 'https://developer.apple.com/account/resources/certificates/list' },
        steps: [
          '要付费的 Apple 开发者账号。上架 / TestFlight 用「Apple Distribution」证书，真机调试用「Apple Development」',
          '在 Mac 的「钥匙串访问」→「我的证书」里找到它，展开、连同下面的私钥一起选中 → 右键「导出 2 项…」→ 存成 .p12，设一个导出密码',
          '还没有证书：Xcode → 设置 → Accounts → 选团队 → Manage Certificates → 左下角 + 新建一个，再按上一步导出',
          '描述文件（.mobileprovision，可选）：开发者网站 Profiles 里下载；Team ID 会从描述文件里自动读出来，没有描述文件就在开发者网站 Membership 里看',
          '苹果的签名只能在 Mac 上做（Xcode / codesign）：存在这里是给 Mac 上打包用，密码员工拿不到',
        ],
      },
    }, {
      kind: 'App Store Connect API Key', fields: [], secret: { label: '证书' },
      guide: {
        link: { label: '打开 App Store Connect · API 密钥', url: 'https://appstoreconnect.apple.com/access/integrations/api' },
        steps: [
          'App Store Connect →「用户和访问」→「集成」→「App Store Connect API」→「团队密钥」点 +',
          '名字随便起（比如 Opero），访问权限选「App 管理」（传 TestFlight、改 App 信息都够）→ 生成',
          '马上点「下载 API 密钥」拿到 AuthKey_XXXXXXXXXX.p8：只能下载一次，丢了只能撤销重建',
          '在这里选 .p8 文件（Key ID 会从文件名里读出来），再填页面上方的 Issuer ID',
          '用来在 Mac 上传 TestFlight / App Store（xcrun altool、fastlane），不用你的 Apple ID 密码',
        ],
        perms: 'App 管理（App Manager）',
      },
    }, {
      kind: 'Windows 代码签名', fields: [], secret: { label: '证书' },
      guide: {
        steps: [
          '向证书机构（DigiCert、Sectigo、GlobalSign…）买代码签名证书，或者用公司已有的',
          '导出成带私钥的 .pfx：运行 certmgr.msc →「个人」→「证书」→ 右键证书「所有任务 → 导出」→ 选「是，导出私钥」→ 设密码',
          '2023 年 6 月以后发的证书，私钥一般在硬件令牌或云签名服务里、导不出 .pfx：那就在 Windows 本机用证书商的工具签，这里不用存',
          '时间戳服务器用证书商给的（DigiCert 是 http://timestamp.digicert.com）：签了时间戳，证书过期后签名照样有效',
        ],
        snippet: { label: '在 Windows 上签名', code: 'signtool sign /fd SHA256 /f cert.pfx /p 密码 /tr http://timestamp.digicert.com /td SHA256 app.msix' },
      },
    }],
  },
  {
    group: '消息渠道',
    desc: '收邮件 / Slack、提醒发到 Telegram、企业微信、钉钉、飞书、邮件',
    types: [],
    goto: { page: 'channels', label: '去「消息渠道」接入（每种都有分步说明）' },
  },
  {
    group: '其它',
    desc: '别的令牌、密码：员工在命令里写 {{secret:凭证名字}}，Opero 替它填上，输出里自动打码',
    types: [
      {
        kind: 'Jenkins', testable: true, user: { label: 'Jenkins 用户名' },
        fields: [{ key: 'site', label: 'Jenkins 地址', placeholder: 'https://jenkins.example.com' }],
        secret: { label: 'API Token' },
        guide: {
          link: { label: '去 Jenkins 生成 API Token', url: '{site}/me/configure' },
          steps: [
            '先在上面填 Jenkins 地址，再点按钮：打开的是「你的用户 → 设置（Configure）」',
            '在「API Token」那一栏点「Add new Token」，名字填 Opero，点「Generate」',
            '复制生成的 Token（只显示这一次），贴到下面；用户名填你登录 Jenkins 的用户名',
            '这个用户要能「新建任务、改任务、触发构建」（Job 的 Create / Configure / Build 权限）；Jenkins 要能访问 Opero 的外网地址（拿源码、传产物）',
            '测试连接会列出能看到的任务；然后在项目的编译设置里把打包工具选成 Jenkins，点「生成流水线」',
          ],
          perms: 'Overall/Read、Job/Create、Job/Configure、Job/Build、Job/Read',
        },
      },
      { kind: '令牌', fields: [], secret: { label: '令牌' }, guide: { steps: ['贴上第三方平台给你的令牌 / API Key', '名字起一个员工好认的（比如「短信平台令牌」），员工在命令里写 {{secret:短信平台令牌}} 就会被换成它', '值不会给员工看到，命令的输出里出现了也会被打码'] } },
      { kind: '账号密码', fields: [], user: { label: '账号', optional: true }, secret: { label: '密码' }, guide: { steps: ['填账号和密码', '员工在命令里写 {{secret:凭证名字}} 换成密码；账号直接写在命令里', '值不会给员工看到，输出里出现了也会被打码'] } },
      { kind: '密钥文件内容', fields: [], secret: { label: '内容', multiline: true, file: true }, guide: { steps: ['证书、私钥这类整段的内容，贴进来或者点「从文件读」', '员工写 {{secret:凭证名字}} 时换成整段内容（比如写进服务器上的文件）'] } },
    ],
  },
]

export const groupMeta = (g: string) => CRED_META.find((x) => x.group === g)
export const typeMeta = (g: string, kind: string) => groupMeta(g)?.types.find((t) => t.kind === kind)
export const typeLabel = (g: string, kind: string) => typeMeta(g, kind)?.label ?? kind
/** 链接里的 {site} 换成填的地址（没填用默认） */
export function fillUrl(url: string, meta: Record<string, string>, t: CredType) {
  const site = (meta.site || t.fields.find((f) => f.key === 'site')?.def || '').replace(/\/+$/, '')
  return url.includes('{site}') ? (site ? url.replace('{site}', site) : '') : url
}
