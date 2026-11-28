# code/android：Opero 安卓 App（网页手机版 + 原生外壳）

**界面用网页的手机版**（`code/web`）：和网页一模一样，网页更新了 App 里马上就有，不用重新发 App。原生只做网页做不了的事：登录、常驻推送、指纹、下载 / 分享、语音、选文件、App 内更新。设计和 JS 桥见 `docs/规范/App外壳.md`，接口见 `docs/api/`。

> 2026-11-28 主人定：网页的手机版效果好，App 直接用它，不再两套界面各写一遍。以前写的原生会话列表 / 聊天（0.4.x，没编通过）挪到了 `native-ui/`，不参与编译；以后觉得哪一页手感不够，再把那一页拿回来换成原生（见 `native-ui/README.md`）。

## 功能清单（0.5.0）

勾上 = 代码写了；「待试编」= 还没在流水线上编过、没在手机上点过。

**登录和账号（原生）**
- [x] 地址（先查 `/api/health`）→ 账号密码 → 两步验证；可选配对码；地址、账号预填
- [x] 网页上断开这台 / 改了密码（任何接口 `401 DEVICE`）→ 回登录页并说明；连不上 → 出错页（重试 / 退出登录）
- [x] 登录后用票（`POST /api/app/ticket`）免登录打开整个网页；网页登录过期（`relogin`）自动再换票

**网页里用到的外壳能力（JS 桥 `window.OperoNative`）**
- [x] 返回键：网页每打开一层都记一步历史，能退就退一层，退到底回桌面
- [x] 下载：网页里点下载（`<a download>`、`?dl=1` 的地址）或调 `download(url, name)` → 外壳带登录取下来，图片存相册（Pictures/Opero），别的存「下载」（Download/Opero）；安卓 9 及以下让你选位置
- [x] 分享：`share(url, name)` → 系统分享面板（发微信、邮件…）；网页那边要在 App 里调它（见 `docs/交接.md`「待确认」）
- [x] 指纹验证本人（`verify`，5 分钟内不再问，和后台一致）、语音转文字（`voice`）、选文件 / 拍照（`<input type="file">`）、麦克风、外链交给系统、状态栏跟网页的深浅色、轻震
- [x] 「我 → 设置 → 这台手机」：指纹解锁、离开多久要解锁、接收提醒、严重告警一直响（`getShell` / `setShell`）

**通知（原生）**
- [x] 常驻连接收提醒（要你决定 / 严重告警 / 知道就行）、「我知道了」、开机自启、看门狗
- [x] 点通知直达那个会话（网页开着就交给网页打开，没开就带在票里）；正看着的会话不弹（`setRoute`）

**以后**
- [ ] 哪一页手感不够就换成原生（先看聊天）：代码在 `native-ui/`

| 文件 | 是什么 |
|---|---|
| `MainActivity.kt` | 唯一的 Activity：没登录 → 原生登录页；登录了 → 整页网页；实现外壳能力（`WebEnv`）：指纹、语音、选文件、麦克风、存到手机、分享、外链、锁屏、点通知直达、检查更新 |
| `web/WebPage.kt` | App 里的网页：换票 → WebView（整页，或 `embed: true` 只显示一页）；下载监听；返回；点通知交给网页；加载 / 出错 |
| `web/Bridge.kt` | 网页调外壳的 `window.OperoNative.*`（网页那边是 `code/web/src/native.ts`）；嵌入页用 `ClosableBridge`（多一个 `close`） |
| `ui/login/LoginScreen.kt` | 原生登录：地址 → 账号密码（`/api/app/login`）或配对码 → 两步验证（`/api/app/login/mfa`） |
| `ui/theme/Theme.kt` | 登录页、出错页的颜色（和网页默认风格一致）、阿拉伯语从右往左 |
| `ui/ErrorScreen.kt` | 连不上时的出错页（重试 / 退出登录） |
| `data/Api.kt` | 调接口：`Auth.NONE / DEVICE / OWNER`；会话令牌过期自动换，`401 DEVICE` 发 `signedOut` 回登录页；带登录取文件（也认 `data:`） |
| `data/Account.kt` | 登录 / 两步验证 / 配对码 / 退出 |
| `data/Store.kt` | 本机保存：地址、设备令牌和会话令牌（系统密钥库加密）、上次的账号、语言、深浅色 |
| `i18n/I18n.kt` | 原生页面（登录、出错、提示）的文字 `t("中文原文", 变量…)`：用网页同一份字典 |
| `lock/AppLock.kt` | 指纹：解锁 App、验证本人 |
| `push/` | 常驻连接（长轮询）、通知渠道、「我知道了」、开机自启、看门狗；`VisibleRoute` = 网页正在看的会话 |
| `update/Updater.kt` | App 内更新（下载、核对 sha256、交给系统安装） |
| `native-ui/` | 不参与编译：以前的原生会话列表 / 聊天（Compose），以后换某一页时用 |

## 文字和翻译

- 网页里的文字跟网页走（`code/web/src/i18n/`）。原生的几页（登录、出错、提示）在代码里写中文原文：`t("登录")`、`t("连不上 {0}：{1}", host, err)`（变量用 `{0}`）。
- 字典：编译时 Gradle 任务 `operoI18n` 把 `code/web/src/i18n/locales/<语言>.json` 拷进 assets（和网页同一份），App 独有的句子放 `code/android/i18n/<语言>.json`。
- 加了文字跑 `node code/android/scripts/i18n-check.mjs`，缺哪句补进 `code/android/i18n/` 六种语言（zh-TW、en、ja、de、fr、ar）。
- 通知渠道名这些系统级文字在 `res/values-*/strings.xml`，跟手机系统语言。

## 编译 / 发版

- 开发机上不编 Android。在 Opero 里：项目 opero 的编译组件「安卓」（模板 android、`subdir=code/android`、`versionFile=code/android/app/build.gradle.kts`、只走云效流水线 5421218）。改完提交推送后 `build_try component=安卓` → `build_status component=安卓` 看日志，编出没签名的 release 包（`*-unsigned.apk`）。
- 发版前改 `app/build.gradle.kts` 的 `versionName` 和 `versionCode`。
- 测试包：发布目标「测试」（发到安装包「安卓 · 测试」，部署前用签名证书签名）→ `package_share` 出扫码装的链接。证书不进仓库。正式发布由人来发。

## 怎么测（装上以后）

1. **登录**：打开 → 地址填自己的 Opero（`https://你的域名` 或 `http://IP:7300`；填官网 / 别的网站会提示「这个地址不是 Opero 后台」）→ 账号（邮箱）+ 密码；开了两步验证再输动态码；或者「用配对码登录」。登录后就是网页的手机版，和手机浏览器里看到的一样，不用再登录。网页上断开这台手机 → App 回到登录页并说明。
2. **返回键**：聊天 → 会话列表 → 退到桌面；打开的面板、弹层一层层关。
3. **下载 / 分享**：聊天里点开一张图 → 下载 → 系统相册 Pictures/Opero 里有；文件下载 → 「下载」里 Opero 文件夹有；分享（网页接上 `share` 以后）→ 弹系统分享面板。
4. **指纹**：点一个危险按钮（比如确认执行的卡片）→ 弹手机系统指纹，过了就执行。
5. **通知**：让员工发一张要你确认的卡片，App 退到后台 → 收到通知 → 点了直达那个会话；正开着那个会话时不弹。
6. **其它**：语音输入弹手机自带的语音识别；附件 ＋ 能选图片 / 拍照 / 文件；「我 → 设置 → 这台手机」能开指纹解锁；深色风格时状态栏变深。
