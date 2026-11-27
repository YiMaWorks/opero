# Opero 接口

后台（`code/server`）给所有端提供同一套 HTTP 接口。全部接口列表见 [接口清单.md](接口清单.md)（从代码自动生成）；卡片见 [卡片.md](卡片.md)；数据结构见 `code/server/src/types.ts`。多端怎么分工见 [../多端架构.md](../多端架构.md)。

## 约定

- **地址**：`https://<你的 Opero>/api/...`。装在子路径下（比如 `/opero/`）时前面带上子路径。
- **格式**：请求、返回都是 JSON（`Content-Type: application/json`）；上传文件那几个接口的请求体是原始字节。
- **出错**：HTTP 状态码 + `{ "message": "给人看的原因", "code": "机器认的代码" }`。常见：
  - `401 AUTH`：没登录 / 会话过期 → 原生 App 用设备令牌重新换会话令牌（见下）。
  - `401 DEVICE`：设备令牌不对 / 这台设备被断开了 → 回到配对。
  - `403 CSRF`：网页改东西没带 `X-Opero: 1`（用 Bearer 的不用管）。
  - `403 VERIFY`：危险操作要 5 分钟内验证过本人。
  - `404 NOT_FOUND`、`400`（参数不对，`message` 写了哪里不对）、`429`（试太多次）。
- **时间**：毫秒时间戳（`at`、`ts` 等）；也有一些给人看的字符串（`time: "18:23"`）。
- **ID**：字符串，别假设格式。

## 登录

**每个端都能自己登录**（网页、安卓、iPhone / iPad、Mac、Windows），不用依赖别的端；几个端、几台设备可以同时登着，互不影响。

| 谁 | 怎么登录 | 带什么 |
|---|---|---|
| 网页 | `POST /api/auth/login`（账号 + 密码）→ 开了两步验证再 `POST /api/auth/mfa`；或者通行密钥（`/api/auth/passkey/*`） | 会话令牌在 HttpOnly cookie 里；改东西的请求带 `X-Opero: 1` |
| 原生 App / 桌面端 | `POST /api/app/login`（账号 + 密码）→ 开了两步验证再 `POST /api/app/login/mfa`；或者配对码（可选） | 主人的接口：`Authorization: Bearer <会话令牌>`；设备接口（`/api/app/*`）：`Authorization: Bearer <设备令牌>` |

### 原生 App 登录（主路：账号密码）

登录页让用户填 **Opero 地址、账号（邮箱）、密码**：

1. `POST /api/app/login`，`{ email, password, deviceId, name, platform, appVersion }`
   - `deviceId`：这台设备自己生成、存起来的固定 id（重装 App 可以换）；`name`：给人看的设备名（「张三的 Pixel 8」）；`platform`：`android` / `ios` / `ipados` / `macos` / `windows`。
   - 没开两步验证 → `{ deviceToken, token, deviceId }`，登录完成。
   - 开了两步验证 → `{ mfa: true, ticket }`，进第 2 步。
   - 账号或密码不对 → `401 LOGIN`；试太多次 → `429`（一分钟后再试）；还没设置主人 → `400 SETUP`（提示先在网页上完成设置）。
2. 让用户输验证器里的 6 位码（或者恢复码）：`POST /api/app/login/mfa`，`{ ticket, code, deviceId, name, platform, appVersion }` → `{ deviceToken, token, deviceId }`。码不对 → `401 MFA`（同一张票最多错 5 次）；票过期 → `401 LOGIN`（回第 1 步）。
3. `deviceToken` 存进系统钥匙串 / 密钥库（安卓 Keystore、苹果 Keychain、Windows 凭据保险箱），`token` 是会话令牌，之后调主人的接口都带 `Authorization: Bearer <token>`。

### 原生 App 登录（可选：配对码）

网页已经登着时更省事（不用在手机上打密码）：

1. 网页「我 → 账号安全 → 接手机」点出 6 位配对码（`POST /api/app/pair-code`，10 分钟有效）。
2. App 填 Opero 地址和配对码：`POST /api/app/pair`，`{ code, deviceId, name, platform, appVersion }` → `{ deviceToken }`。
3. 换会话令牌：`POST /api/app/session`（带设备令牌）→ `{ token }`。

### 之后

- **会话过期**：会话令牌很久不用（默认 30 天）会过期 → 接口回 `401 AUTH`，用设备令牌 `POST /api/app/session` 再换一个（这台设备以前换的会话令牌作废）。
- **设备被断开**：主人在网页「我 → 账号安全」里删了这台设备，或者改了密码（改密码会断开所有设备）→ 换的时候回 `401 DEVICE`，回到登录页。
- **退出登录**：`DELETE /api/app/devices/<deviceId>`（设备令牌），再删掉本地存的令牌。
- **两种会话互不影响**：原生的会话令牌和 App 里嵌的网页的 cookie 会话（`/api/app/enter` 进的）各记各的，不会互相踢下线；断开设备、改密码两种都作废；验证本人一次两种都算验过。
- 通行密钥（Passkey）登录目前只有网页有；原生端要做得各平台单独接（以后）。

想在 App 里打开某个网页页面（还没做原生的）：见下面「嵌网页」。

**验证本人**：危险操作（看密码明文、删东西、发生产……）要 5 分钟内验证过本人。App 用系统生物识别验过后调 `POST /api/app/verified`（设备令牌），这台设备的会话就算验过。

## 嵌网页（原生 App 里还没做成原生的页面）

1. 换票：`POST /api/app/ticket`（设备令牌），`{ route, embed: true }` → `{ url }`（`/api/app/enter?t=…`，前面拼 Opero 地址，地址结尾不带 `/`；装在子路径下就是 `https://example.com/opero` + `url`）。一分钟内有效，只能用一次。
2. WebView 打开这个地址：进去就是登录状态，**只显示 `route` 这一页**（没有底部页签、侧栏、会话列表）；页面自己带标题栏，App 不用再加一层。
3. `route` 是网页的一段：`页面名;参数=值;参数=值`，参数值要 URL 编码。例：`employee;id=e1`、`workspace;id=w1`、`servers`、`settings`、`credentialEdit;group=代码仓库;kind=GitHub`。页面名和参数见 `code/web/src/pages/index.tsx`（`PageView` 认的那些）。认不出来的显示「这个页面打不开」。
4. 不带 `embed`（老用法）：打开整个网页，`route` 只认 `chat/<会话 id>`（点通知直达）。

**JS 桥**（外壳往 WebView 注入 `window.OperoNative`；网页在 `window.__operoNative` 上放 App 能调的函数）：

| 方向 | 调用 | 什么时候 | App 该做什么 |
|---|---|---|---|
| 网页 → App | `OperoNative.open(route: string)` | 嵌入页里点到别的页面 | 有原生页就开原生页，没有就再换一张票开一个嵌入页。打开聊天是 `chat;emp=<员工 id>` |
| 网页 → App | `OperoNative.close()` | 嵌入页最外层点了关闭（只有 App 提供了 `close` 才显示这个按钮） | 退回 App 上一层 |
| App → 网页 | `window.__operoNative.back()` → `boolean` | 用户按返回键 / 侧滑返回 | 网页有弹窗就关弹窗、有子页就退子页，回 `true`；回 `false` = 到顶了，App 自己退 |

App 没提供 `open` 时（老外壳 / 浏览器里），网页在自己里面一页页往下走，返回由网页自己的返回按钮处理。

## 开机和实时

- `GET /api/bootstrap`：一次拿全：`auth`（登录了没、要不要设置）、`instance`（版本）、`me`、`employees`、`sessions`、`messages`（每个会话最近的消息）、`servers`、`credentials`（不含明文）、`workspaces`、`queue`、`issues`、`releases`、`settings`、`usage` 等。
- `GET /api/events`：Server-Sent Events，每条 `data:` 是一个 JSON：

| `t` | 意思 | 其它字段 |
|---|---|---|
| `hello` | 刚连上 | `working`：在干活的员工 |
| `put` | 某个集合加了 / 改了一项（整项替换） | `coll`（`employees` `sessions` `servers` `workspaces` `queue` `issues` `releases` …）、`item` |
| `del` | 某个集合删了一项 | `coll`、`id` |
| `msg` | 会话里来了 / 改了一条消息（同一个 `id` 就是更新，比如员工「在干活」的状态行一直在变） | `sid`、`msg` |
| `msgDel` | 删了一条消息（比如干完了，状态行没了） | `sid`、`id` |
| `settings` / `me` / `usage` | 设置、我、用量变了 | 对应字段 |
| `audit` | 新的操作记录 | `item` |
| `inbox` | 收件箱来了 / 改了 | `item` |
| `toast` | 给主人看一句提示 | `text` |

断线后重连，重连上先重新拉一次 `/api/bootstrap`，免得漏东西。

## 核心流程（原生端先做这些）

| 要做的 | 接口 |
|---|---|
| 会话列表 | `bootstrap.sessions`（+ `events` 的 `put sessions`）；置顶 / 草稿等：`PUT /api/sessions/:id` |
| 打开会话、往前翻 | `GET /api/sessions/:id/messages`；看了：`POST /api/sessions/:id/read` |
| 和员工开会话 | `POST /api/sessions/for/:emp` |
| 发消息 | `POST /api/sessions/:id/messages`，`{ text, files: [{ id, w, h }], mode }`；`mode`：`auto`（员工在干活就插话，插不进就排队）/ `queue`（排队） |
| 发图片 / 文件 | 先传：`POST /api/sessions/:id/files?name=&type=&w=&h=`（请求体是文件字节）→ `{ att }`；撤回：`DELETE /api/sessions/:id/files/:file`；发的时候放进 `files` |
| 转给别的员工（server 0.29.0） | `POST /api/sessions/<目标员工的会话 id>/forward`，`{ msg: <消息 id> }`：文字照转（带「转自「某某」」）；图片 / 文件**把文件本身**复制进目标员工的 `uploads/`，目标会话里是一条 `file` 消息 + 一句「转自「某某」的图片」，员工直接能看能用。在干活就插话 / 排队，同发消息。目标会话先用 `POST /api/sessions/for/:emp` 拿 |
| 排队 | `bootstrap.queue` + `events`；改：`PUT /api/queue/:id`；删：`DELETE /api/queue/:id`；员工闲着时开始：`POST /api/sessions/:id/queue/run` |
| 停止 | `POST /api/sessions/:id/stop` |
| 卡片上的按钮 | `POST /api/messages/<消息 id>/action`（**消息** id，不是卡片 id），`{ action, answer? }`（`ask` 卡片带选中的选项文字）→ `{ ok, result }`；按钮带 `panel` 的不调接口，本地打开页面；危险按钮先验证本人。详见 [卡片.md](卡片.md) |
| 员工「在干活」 | 会话的 `working`（一句话），消息里 `kind: 'status'`、`spinning: true` 的那条 |
| 推送（App 在后台） | `GET /api/app/push?after=<上次的序号>&wait=<秒>`（设备令牌，长轮询） |

消息结构（`Message`）：`kind` 是 `text` / `card` / `file` / `status` / `system`；`from` 是 `me` / 员工 id / `system`；卡片在 `card`，每种卡片的字段、按钮、通用显示见 [卡片.md](卡片.md)；长相见 `docs/规范/表单与卡片.md`。

## 文件和图片地址

- 附件（`QAtt.url`、排队里的附件）：`api/uploads/<员工 id>/<文件>`；员工发的文件（`message.file.url`）：`api/files/<id>?name=<文件名>`。
- 都是**相对地址**，前面拼 Opero 地址（装在子路径下就带上子路径，比如 `https://example.com/opero/` + `api/files/…`）。
- 下载：地址后面加 `dl=1`（`api/files/<id>?name=…&dl=1`、`api/uploads/…?dl=1`），图片也回 `Content-Disposition: attachment`，浏览器直接存；不加的话图片是 `inline`（在页面里显示）。
- 各端看到图片 / 文件都要给：**看大图**（左右翻同一会话里的图）、**下载 / 存到相册**、**系统分享**（发微信等）、**转给员工**（上面的 forward）；网页的做法见 `code/web/src/components/FileView.tsx`。
- 取文件和别的主人接口一样要登录：原生带 `Authorization: Bearer <会话令牌>`（网页里的 `<img>` 用 cookie）。图片原图直接返回，自己缩略。

## 网络出口（server 0.31.0）

Opero 自己往外连（收发邮件、提醒渠道、AI Key、生图、DNS、流水线、代码平台的接口）时，按域名经某台 Agent 出去。规则 `EgressRule`（`code/server/src/egress.ts`）：`{ id, host, via: 服务器 id | 'direct', lan?, note?, at, by?, test?: { ok, ms?, err?, at, port } }`，最具体的生效，写域名也管子域名。

| 做什么 | 接口 |
|---|---|
| 规则 + 最近连不上的 | `GET /api/egress` → `{ rules, failures: [{ host, port, what, err, at, n }], min: 'Agent 最低版本' }` |
| 加 / 改（同域名就是改） | `POST /api/egress { host（网址、邮箱、host:port 都认）, via, port?（测试用）, lan?, note?, force? }`：先测，经出口不通回 `{ saved: false, test }`，`force` 照存；`lan: true` 要验证本人 |
| 就地改 | `PUT /api/egress/:id { host?, via?, lan?, note? }`（打开 `lan` 要验证本人） |
| 删 | `DELETE /api/egress/:id` |
| 测 | `POST /api/egress/test { host, port?, via?, lan?, id? }` → `{ host, port, direct: { ok, ms?, err? }, via? }`（只连 TCP；给 `id` 记到那条规则上） |
| 忽略一个连不上的 | `DELETE /api/egress/failures/:host` |

## 安装包（server 0.26.0）

每个项目按「端 × 渠道」一格：端 `android / ios / mac / windows / linux`，渠道 `test / prod`；**每格只留最新一个**，新的进来旧的删掉。数据结构 `AppPackage`（`code/server/src/packages.ts`），启动数据里是 `packages`，实时推送的集合名也是 `packages`。

| 做什么 | 接口 |
|---|---|
| 列一个项目的 | `GET /api/workspaces/:id/packages` |
| 上传（请求体就是文件，边收边写，最多 2 GB） | `POST /api/workspaces/:id/packages?name=<文件名>&platform=&channel=&version=&build=&note=&signed=1` ——`platform` 不给就按扩展名认（.apk/.aab 安卓、.ipa、.dmg/.pkg、.msix/.exe/.msi、.AppImage/.deb/.rpm），`channel` 默认 `test` |
| 下载（要登录） | `GET /api/packages/:id/file`（`:id` 是 `项目:端:渠道`，要 URL 编码） |
| 删 | `DELETE /api/packages/:id` |
| 分享链接 | `POST /api/packages/:id/share {days}`（默认 7、最多 90，0 = 关掉）；拿到的 `share.token` 拼成 `<Opero 地址>/dl/<token>` 就是不用登录的下载页，`/dl/<token>/file` 直接下文件。换了包链接照样能用，到期失效 |

前面有 nginx 的要放开这几个地址的大小（`code/server/scripts/nginx.conf` 里有现成的 `location`）。员工用 MCP 的 `package_list / package_upload / package_get / package_share`；发布环境设 `package: {platform, channel}` 就是编完（签好名）自动放进来。

## 后台只提供接口

设环境变量 `OPERO_WEB=none`：后台不再托管网页，非 `/api/` 的地址回 404。网页可以单独托管（`code/web` 编出来的 `dist/`），或者只用原生 App。

## 改接口的人

- 加 / 改接口在 `code/server/src/api.ts`，接口上面写一行注释说明用途（会进接口清单）。
- 改完跑 `node code/server/scripts/api-list.mjs` 重新生成 `接口清单.md`；约定、登录、实时推送有变化就改这份 README。
- 不兼容的改动（删字段、改含义）先和各端负责人说好，加新字段可以直接加（各端要忽略不认识的字段）。
