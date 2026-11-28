# App 外壳规范（安卓，v0.1，2026-11-22）

> **2026-11-28 主人定（安卓 0.5.0 起）**：App 的界面就用网页的手机版，原生只做外壳（这份规范的做法）。2026-11-25 起试过把会话列表 / 聊天做成原生，两套界面要各写一遍，挪到了 `code/android/native-ui/`（不参与编译）。登录页是原生的（账号密码 / 配对码 / 两步验证），登录后用票整页打开网页。
>
> 代码在 `code/android/`，网页那边是 `code/web/src/native.ts`。
> 外壳做的：常驻推送 + 看门狗补取、严重告警追着响 + 「我知道了」、指纹解锁 / 验证本人 5 分钟、点通知直达、密钥库加密存令牌、App 内更新、edge-to-edge + 状态栏跟主题。
> 聊天、卡片、表单不用原生写：如果每种卡片网页和 App 各写一遍，加一种卡片就要发 App。Opero 的界面**全在网页里**，外壳只做网页做不了的事；加功能只发网页，不用发 App。

## 1. 外壳管什么、不管什么

| 外壳管（原生） | 网页管 |
|---|---|
| 登录你的 Opero（原生 Compose：地址 + 账号密码 / 配对码 + 两步验证，`ui/login/LoginScreen.kt`） | 所有页面、聊天、卡片、表单 |
| 常驻推送、通知渠道、严重告警一直响 | 推什么（按员工的「提醒」设置，后台定） |
| 指纹：解锁 App、验证本人 | 什么时候要验证本人（`requireVerify`） |
| 点通知打开某个会话 | 打开以后显示什么 |
| 选文件 / 拍照、麦克风权限、下载交给系统 | 发图片、按住说话的界面 |
| 返回键 = 网页后退（网页每打开一层记一步历史，返回只关最上面一层；到底了退到桌面） | 层级（`App.tsx` 的 history 深度） |
| 状态栏 / 导航栏颜色跟网页的深浅色 | 主题 |
| App 内更新（只有外壳本身要更新时） | 网页随 Opero 一起发版 |

**一人一套带来的不同（和多人共用的后台比）**：
- 没有固定服务器：第一次打开填自己那套的地址；一台手机连一套。
- **没有厂商推送**（华为 / 荣耀 / 小米…）：厂商推送要 App 发行方的密钥在服务端发，不能发给每一套自建的 Opero。只靠常驻连接 + 每 15 分钟的看门狗补取（后台存 24 小时）。要在 App 被杀后也收到，用「通知发到哪」里的 Telegram / Slack / 邮件兜底。以后要做可以加一个官方中转（待确认）。
- 没有账号密码：手机配对拿一个**设备令牌**（系统密钥库加密存），网页「我 → 账号安全 → 接手机」能看到、能断开。

## 2. 网页 ↔ 外壳（JS 桥）

外壳 WebView 的 User-Agent 末尾加 `OperoApp/<版本> light|dark`，并注入 `window.OperoNative`。网页用 `src/native.ts` 包好的函数，不要直接调 `window.OperoNative`；不在 App 里时这些函数什么都不做 / 走网页的做法。

| 网页调外壳 `OperoNative.*` | 做什么 |
|---|---|
| `version()` | 外壳版本 |
| `verify(id, title, subtitle)` | 弹系统指纹 / 面容 / 锁屏密码；5 分钟内验过直接过（和后台 `VERIFY_MS` 一致）。验过后外壳调后台 `POST /api/app/verified`，结果回 `window.__operoNative.onVerify(id, ok, err)` |
| `setTheme(dark)` | 状态栏、导航栏、底色跟着网页 |
| `setBadge(n)` | 红点数（只算要你决定的）。安卓桌面角标跟着通知走，外壳收下不用 |
| `setRoute(route)` | 正在看的会话 `chat/<编号>`：推的就是它时不弹通知 |
| `download(url, name)`（安卓 0.5.0） | 把文件存到手机：外壳带登录取 `url`（相对地址 / 绝对地址 / `data:`），图片进相册（Pictures/Opero），别的进「下载」（Download/Opero）；安卓 9 及以下让用户选位置。网页里 `<a download>`、`?dl=1` 的链接不调它也会被外壳的下载监听接住 |
| `share(url, name)`（安卓 0.5.0） | 把文件交给系统分享面板（发微信、邮件…）。WebView 没有 `navigator.share`，网页在 App 里要分享文件就调它 |

网页在哪调（web 0.52.2）：`native.ts` 的 `nativeDownload` / `nativeShare`；聊天文件 `components/FileView.tsx`（下载、分享、看大图里的按钮），安装包 `components/Packages.tsx` 的「下载」。不在 App 里或老外壳没有这两个方法时，网页照旧用浏览器的下载 / `navigator.share`。
| `openExternal(url)` | 交给系统打开（邮件 / Slack / Telegram 原消息、文档链接；只认 http / mailto / tg / slack） |
| `haptic()` | 轻震（长按、按住说话） |
| `relogin()` | 网页登录过期（接口 401）：外壳用设备令牌重新要票再打开 |
| `unpair()` | 退出登录：断开这台手机，回到原生登录页 |
| `getShell()` / `setShell(json)` | 「这台手机」的设置：`lockOn`、`lockAfter`（秒，0 = 每次）、`pushEnabled`、`insistent`；网页设置页在 App 里多一组「这台手机」 |
| `open(route)`（可选） | 嵌入页（`?embed=1`）里点到别的页面：App 开原生页或再开一个嵌入页；`chat;emp=<员工>` = 打开聊天。外壳没有它，网页就在自己里面跳 |
| `close()`（可选） | 嵌入页最外层点了关闭：App 退回上一层。外壳没有它，网页不显示关闭按钮 |

| 外壳调网页 | 做什么 |
|---|---|
| `window.__operoNative.open(route)` | 点通知打开：`chat/<会话编号>` → 打开那个会话（`App.tsx` 的 `onNativeOpen`） |
| `window.__operoNative.onVerify(id, ok, err)` | 验证本人的结果 |
| `window.__operoNative.back()` → `boolean`（嵌入页） | 返回键：网页有弹窗 / 子页就退一层回 `true`；回 `false` = 到顶了，App 自己退 |

**安全**：桥只在自己那套 Opero 的页面（同协议 + 主机 + 端口）和 `file:///android_asset/` 里起作用；别的网站的链接一律交给系统浏览器，进不了这个 WebView。

## 3. 外壳用的后台接口（后台要实现，都带 `Authorization: Bearer <设备令牌>`、`X-Opero-Client: app`）

| 接口 | 用途 | 返回 |
|---|---|---|
| `POST /api/app/pair` `{code, deviceId, name, platform, appVersion}`（不带令牌） | 用网页给的 6 位配对码（10 分钟有效、用一次作废）换设备令牌 | `{deviceToken}` |
| `POST /api/app/ticket` `{route, embed?}` | 要一张一次性的票（1 分钟有效）；`embed: true` = 只显示 `route` 那一页（原生 App 嵌网页用，见 `docs/api/README.md`「嵌网页」） | `{url}`：打开它，后台种好登录 cookie 再跳到首页（带 route 就跳到那里） |
| `POST /api/app/login` `{email, password, deviceId, name, platform, appVersion}`（不带令牌） | App 自己用账号密码登录（不依赖网页给配对码）；开了两步验证先回票，再 `POST /api/app/login/mfa` `{ticket, code, …}` | `{deviceToken, token, deviceId}` 或 `{mfa: true, ticket}` |
| `POST /api/app/session` | 原生页面用：换一个会话令牌，调主人的接口带 `Authorization: Bearer`；和网页的 cookie 会话各记各的，不互相踢 | `{token}` |
| `POST /api/app/verified` | 这台手机刚验过本人：这台设备的会话（原生和网页）记 5 分钟 | `{}` |
| `POST /api/app/devices` `{deviceId, platform, brand, model, osVersion, appVersion, enabled}` | 登记这台手机 | `{}` |
| `GET /api/app/push?device=&after=&wait=25` | 长轮询：没新的就等最多 25 秒；后台存 24 小时 | `{items: [PushItem], last}`；没这台手机回 `404 {code: "DEVICE_NOT_FOUND"}` |
| `DELETE /api/app/devices/<deviceId>` | 断开 | `{}` |
| `POST /api/app/alarms/<编号>/ack` | 通知上点「我知道了」：不再响 | `{}` |
| `GET /api/app/update?platform=android&build=` | 有没有新外壳 | `{versionCode, versionName, url, sha256, must, notes}` |

设备令牌被作废（网页里断开了、改了密码）→ 任何接口回 `401 DEVICE` → 外壳清掉令牌，回原生登录页并说明。

**PushItem**：`{id, kind, title, body?, route?, alarm?}`
- `kind`：`decide` 要你决定（高优先级、横幅）/ `alarm` 严重告警（闹钟铃声、长震、一直响到点「我知道了」）/ `info` 知道就行 / `clear` 收掉 `alarm` 那条（别处已处理 / 已恢复）。
- 推什么由后台按员工的「提醒」设置定：只提醒要我决定的（默认）→ 只推 `decide`；每条都提醒 → 也推 `info`；不提醒 → 不推。设置里「推送什么」是总开关。

## 4. 打开流程

1. 没登录 → 原生登录页：填地址（**没有默认值**：Opero 没有公共服务器，App 只连用户自己装的那套；官网只是介绍和试用），先 `GET <地址>/api/health`，回 `{"ok":true}` 才算是 Opero 后台，否则提示「这个地址不是 Opero 后台」→ 账号密码（`/api/app/login`，开了两步验证再 `/api/app/login/mfa`），或者配对码（`/api/app/pair`）。
2. 登录过 → `POST /api/app/ticket {route}` → 整页打开票地址；同时起常驻连接。返回键：网页能后退就后退，退到底回桌面。
3. 点通知 → 带 `route`（`chat/<会话>`）：网页开着就交给网页 `__operoNative.open(route)`；还没开（或正在加载）就带在票里 / 加载完再交。
4. 开了「指纹解锁 App」→ 冷启动、离开超过设定时间回来先盖锁屏；打开系统的选文件、相机、安装界面回来不锁。

## 5. 构建和发版

- 版本号：`code/android/app/build.gradle.kts` 的 `versionName`（每次发改它，`versionCode` 也 +1）。
- 流水线：组件 `android`（模板：装 JDK 21 + SDK，`assembleRelease`，取没签名的包）；依赖版本见 `gradle/libs.versions.toml`（这组一起编过）。
- 签名：发布时签（证书不进仓库、不进流水线）。

## 6. 还没做 / 以后

- 扫码配对（网页显示二维码，App 扫）：要相机页，先用 6 位配对码。
- iOS 外壳。
- 官方推送中转（App 被杀后也能收到）。
- 「分享到 Opero」（别的 App 分享文字 / 截图给某个员工）。
