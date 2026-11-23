# code/android：Opero 安卓 App（原生外壳 + WebView）

界面全在网页里（`code/web`），外壳只做网页做不了的事。设计、JS 桥、后台接口见 `docs/规范/App外壳.md`。照 KidLock 安卓做的，依赖版本也和那边一致。

| 文件 | 是什么 |
|---|---|
| `MainActivity.kt` | 唯一的界面：WebView、连接页 / 票、返回键、选文件、麦克风、锁屏、点通知直达、检查更新 |
| `web/Bridge.kt` | 网页调外壳的 `window.OperoNative.*`（网页那边是 `code/web/src/native.ts`） |
| `assets/pair.html` | 外壳自带的「连接你的 Opero」页（地址 + 配对码） |
| `data/Store.kt` `data/Api.kt` | 本机保存（设备令牌用系统密钥库加密）、调外壳接口 |
| `lock/AppLock.kt` | 指纹：解锁 App、验证本人（30 分钟内不再问） |
| `push/` | 常驻连接（长轮询）、通知渠道（要你决定 / 严重告警 / 知道就行）、「我知道了」、开机自启、看门狗 |
| `update/Updater.kt` | App 内更新（下载、核对 sha256、交给系统安装） |
| `res/drawable/ic_launcher_fg.xml` | 启动图标（和 `docs/品牌/` 的 logo 同一个图形） |

## 编译 / 发版

- 这台开发机禁止编译；在「研发 → 发布」里编组件 `android`（见 `deploy/README.md`）。
- 发版前改 `app/build.gradle.kts` 的 `versionName` 和 `versionCode`。
- 签名在超级后台的服务器上做；还缺 Opero 的签名证书。

## 怎么测（编出来以后）

1. 装上打开 → 「连接你的 Opero」：地址填 `https://opero.yimakeji.cn`，配对码不填 → 直接打开网页原型。
2. 网页里：返回键一层层关（聊天 → 会话列表 → 退到桌面）；深色主题时状态栏变深；「我 → 设置」多一组「这台手机」（指纹解锁、接收提醒、严重告警一直响）。
3. 危险操作（例如「mov 开发」的指纹确认卡片）→ 弹手机系统指纹，不再是网页的模拟弹窗。
4. 聊天里 ＋ 发图片 / 文件：原型里是假的（不调系统选文件）；以后网页换成 `<input type="file">` 就会弹系统选文件。
5. 推送、配对、票：要后台实现 `docs/规范/App外壳.md` 第 3 节的接口才能测。
