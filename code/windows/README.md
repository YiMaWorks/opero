# code/windows：Opero Windows App

C# + WinUI 3（Windows App SDK）原生 App。和后台怎么连、各端怎么分工，先读 `docs/多端架构.md` 和 `docs/api/README.md`。做出来以后替换 `code/desktop`（Electron）在 Windows 上的位置。

> 现状：**还没开工**，这里只有说明。负责 Windows 端的人从「第一步」做起，做完一步在下面「进度」里勾上。

## 技术选择

- .NET 8、C# 12、WinUI 3（Windows App SDK 1.5+），最低 Windows 10 1809（推荐 Windows 11）。
- MVVM：`CommunityToolkit.Mvvm`；网络 `HttpClient`（SSE 用 `ReadAsStreamAsync` 逐行读）；令牌存 Windows 凭据保险箱（`PasswordVault`）或 DPAPI；验证本人用 Windows Hello（`UserConsentVerifier`）；嵌网页用 `WebView2`。
- 打包：MSIX（也可以出不打包的 `.exe` 安装器）。

建议的结构：

```
code/windows/
  Opero.sln
  Opero.Core/        类库：接口客户端（Bearer、401 自动重换会话令牌）、SSE、类型（照 code/server/src/types.ts）、状态
  Opero.App/         WinUI 3 App：页面、托盘、通知、配对
  Opero.Tests/
```

## 第一步做什么（核心先原生）

1. 登录页：填 Opero 地址 + 账号 + 密码 → `POST /api/app/login`（`platform: windows`）；开了两步验证再输码 → `POST /api/app/login/mfa`。设备令牌存凭据保险箱，会话令牌调接口用。另给一个「用配对码登录」的入口（`POST /api/app/pair` + `POST /api/app/session`）。
2. 开机：`GET /api/bootstrap`；实时：`GET /api/events`（SSE），断线重连后重拉 bootstrap。
3. 会话列表 + 聊天（文字、Markdown、卡片和按钮、员工「在干活」的状态行和停止、插话 / 排队、发图片和文件、粘贴截图）。电脑上是左边会话列表、右边聊天的两栏。
4. 托盘：「等你处理」的数量；关窗口藏到托盘。通知：常驻长轮询 `GET /api/app/push`，弹 Windows 通知，点了直达那个会话。
5. 验证本人：Windows Hello 验过 → `POST /api/app/verified`。
6. 其它页面先用 `WebView2` 打开网页：`POST /api/app/ticket` 拿地址再打开，免登录。以后一页页换成原生。

界面照 `docs/规范/界面.md`、`docs/规范/表单与卡片.md`；长相和网页一致，控件用 WinUI 原生的（Fluent）。

## 文案和翻译

源文是简体中文，七种语言的译文在 `code/web/src/i18n/`。写个脚本导出成 `Strings/<语言>/Resources.resw`（同一句话用同样的译文），不要另翻一套。

## 编译和发布

**在 Windows 电脑上本地打包**（不走云端 CI）。要：Visual Studio 2022（「.NET 桌面开发」+ Windows App SDK）或 .NET 8 SDK + Windows SDK。

### 打包

```powershell
cd code\windows
dotnet publish Opero.App -c Release -r win-x64 -p:WindowsPackageType=MSIX -p:GenerateAppxPackageOnBuild=true -p:AppxPackageDir=..\out\
# 有代码签名证书时（.pfx 只放在这台电脑上，密码不写进任何文件）：
signtool sign /fd SHA256 /f <证书.pfx> /p <密码> out\<包名>.msix
```

- 没有证书也能装，会提示「未知发布者」；本机测试可以用 Visual Studio 生成的测试证书。
- `out/` 不进仓库。以后 Opero 的 Agent 支持 Windows 了，这台电脑接进 Opero，就能用编译组件在 Opero 里试编、发布（`docs/多端架构.md`「还没定的」）。
- 版本号：`Package.appxmanifest` 的 Version（和项目文件一致）；每次发都改，记进 `docs/变更记录.md`（写「windows x.y.z」）。

## 规矩

- 只改 `code/windows/` 和这份 README；要后台加 / 改接口，写清楚要什么交给后台负责人，不要改 `code/server`。
- 接口照 `docs/api/`，忽略不认识的字段。
- 做完在 `docs/交接.md` 最上面加一条。

## 进度

- [ ] 解决方案 + Opero.Core
- [ ] 配对 / 登录
- [ ] bootstrap + SSE
- [ ] 会话列表 + 聊天
- [ ] 托盘 + 通知
- [ ] 验证本人
- [ ] 其它页面嵌网页
- [ ] 本地打包（MSIX、签名）
