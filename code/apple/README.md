# code/apple：Opero 苹果 App（iPhone / iPad / Mac）

一套 Swift + SwiftUI 代码，出 iPhone、iPad、Mac 三个原生 App。和后台怎么连、各端怎么分工，先读 `docs/多端架构.md` 和 `docs/api/README.md`。

> 现状：**还没开工**，这里只有说明。负责苹果端的人从「第一步」做起，做完一步在下面「进度」里勾上。

## 技术选择

- Swift 5.10+ / SwiftUI，最低 iOS 17、iPadOS 17、macOS 14（用得上 `@Observable`、`NavigationSplitView`）。
- 一个 Xcode 工程 `Opero.xcodeproj`，两个目标：`Opero`（iOS / iPadOS）和 `Opero Mac`（macOS，原生 SwiftUI，不用 Catalyst）；共用代码放 Swift Package `OperoKit`。
- 不引第三方库能做的就不引：网络 `URLSession`（含 SSE：`URLSession.bytes(for:)` 逐行读）、钥匙串 `Security`、生物识别 `LocalAuthentication`。

建议的结构：

```
code/apple/
  Opero.xcodeproj
  OperoKit/                 Swift Package：各平台共用
    Sources/OperoKit/
      API/                  接口客户端（Bearer、401 自动重换会话令牌）、SSE、类型（照 code/server/src/types.ts）
      Store/                全局状态：bootstrap + events 合并
      Auth/                 配对、设备令牌（钥匙串）、会话令牌、验证本人
      Features/Chat/        会话列表、聊天、卡片、输入框（插话 / 排队、附件）
  App-iOS/                  iOS / iPadOS 入口、推送、App 图标
  App-macOS/                Mac 入口、菜单栏、通知
  Resources/Localizable.xcstrings   从 code/web/src/i18n 导出（见下）
```

## 第一步做什么（核心先原生）

1. 登录页：填 Opero 地址 + 账号 + 密码 → `POST /api/app/login`（`platform: ios` / `ipados` / `macos`）；开了两步验证再输码 → `POST /api/app/login/mfa`。拿到的设备令牌存钥匙串，会话令牌调接口用。另给一个「用配对码登录」的入口（`POST /api/app/pair` + `POST /api/app/session`）。
2. 开机：`GET /api/bootstrap`；实时：`GET /api/events`（SSE），断线重连后重拉 bootstrap。
3. 会话列表（置顶、未读、员工在干活）→ 聊天（文字、Markdown、卡片和按钮、员工「在干活」的状态行和停止、插话 / 排队、发图片和文件）。
4. 验证本人：Face ID / Touch ID 验过 → `POST /api/app/verified`。
5. 其它页面（员工、项目、服务器、发布、设置）先用 `WKWebView` 打开网页：`POST /api/app/ticket` 拿地址再打开，免登录。以后一页页换成原生。
6. 推送：iOS 在后台不能长轮询，先只做 App 打开时的实时 + 本地通知；APNs 方案见 `docs/多端架构.md`「还没定的」。Mac 可以常驻长轮询 `GET /api/app/push`。

界面照 `docs/规范/界面.md`、`docs/规范/表单与卡片.md`；长相和网页一致，控件用 SwiftUI 原生的。

## 文案和翻译

源文是简体中文，七种语言的译文在 `code/web/src/i18n/`。写个脚本把要用的句子导出成 `Localizable.xcstrings`（同一句话用同样的译文），不要另翻一套。

## 编译和发布

**在 Mac 电脑上本地打包**（不走云端 CI）。要：Xcode 15+；Xcode「设置 → 账号」里登录我们的 Apple Developer 团队（已付费账号），签名用自动签名。

签名配置不进仓库：
- `Config/Signing.example.xcconfig`（提交）：`DEVELOPMENT_TEAM =` 留空、`CODE_SIGN_STYLE = Automatic`、`PRODUCT_BUNDLE_IDENTIFIER` 前缀。
- `Config/Signing.local.xcconfig`（不提交，加进 `.gitignore`）：填我们的团队编号；工程的 xcconfig 用 `#include? "Signing.local.xcconfig"` 引它。拿到开源代码的人填自己的团队就能打。
- App Store Connect API 密钥（`.p8`）、公证的钥匙串配置（`xcrun notarytool store-credentials opero-notary …`）只存在那台 Mac 的钥匙串里。

### 打包

iOS / iPadOS（导出后上传 App Store Connect → TestFlight → 提交 App Store）：

```bash
cd code/apple
xcodebuild -scheme Opero -configuration Release -destination 'generic/platform=iOS' -archivePath out/Opero-iOS.xcarchive archive
xcodebuild -exportArchive -archivePath out/Opero-iOS.xcarchive -exportOptionsPlist Config/ExportOptions-AppStore.plist -exportPath out/ios
# Config/ExportOptions-AppStore.plist：method = app-store-connect，destination = upload（用 API 密钥直接传到 App Store Connect）
```

Mac（Developer ID 签名 + 公证 + 钉票，出 `.dmg`）：

```bash
xcodebuild -scheme 'Opero Mac' -configuration Release -archivePath out/Opero-Mac.xcarchive archive
xcodebuild -exportArchive -archivePath out/Opero-Mac.xcarchive -exportOptionsPlist Config/ExportOptions-DeveloperID.plist -exportPath out/mac
hdiutil create -volname Opero -srcfolder out/mac/Opero.app -ov -format UDZO out/Opero-<版本>.dmg
xcrun notarytool submit out/Opero-<版本>.dmg --keychain-profile opero-notary --wait
xcrun stapler staple out/Opero-<版本>.dmg
```

`out/` 不进仓库。以后 Opero 的 Agent 支持 macOS 了，这台 Mac 接进 Opero，就能用编译组件在 Opero 里试编、发布（`docs/多端架构.md`「还没定的」）。
- 版本号：工程里的 Marketing Version（对外）和 Build（每次 +1）；每次发都改，记进 `docs/变更记录.md`（写「apple x.y.z」）。

## 规矩

- 只改 `code/apple/` 和这份 README；要后台加 / 改接口，写清楚要什么交给后台负责人，不要改 `code/server`。
- 接口照 `docs/api/`，忽略不认识的字段（后台会加新字段）。
- 做完在 `docs/交接.md` 最上面加一条。

## 进度

- [ ] Xcode 工程 + OperoKit
- [ ] 配对 / 登录
- [ ] bootstrap + SSE
- [ ] 会话列表
- [ ] 聊天（消息、卡片、状态行、停止、插话 / 排队、附件）
- [ ] 验证本人
- [ ] 其它页面嵌网页
- [ ] Mac 版
- [ ] 本地打包（签名配置、ExportOptions、iOS 上传 TestFlight、Mac 公证 dmg）
