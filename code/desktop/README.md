# Opero 桌面端（过渡用）

> 这是 Electron + WebView 的过渡版本。原生桌面端在做：Mac 在 `code/apple`（SwiftUI），Windows 在 `code/windows`（WinUI 3），见 `docs/多端架构.md`。它们能用以后删掉这个目录；在那之前只修 bug，不加新功能。

一个窗口打开你自己的 Opero（不是官网）；托盘显示「等你处理」的数量；要你决定的事、出错弹系统通知，点了直接到那个会话。关窗口只是藏到托盘，托盘里「退出」才退出。

- **连接**：和安卓 App 一样用配对码：网页「我 → 账号安全 → 接手机」拿 6 位配对码，在桌面端填地址和配对码。设备令牌用系统钥匙串加密存在本机（`safeStorage`）。
- **登录网页**：用设备令牌换一张一分钟有效的票（`/api/app/ticket` → `/api/app/enter`），不用再输密码。
- **提醒**：长轮询 `/api/app/push`（和手机同一个队列），弹系统通知；「等你处理」的数量读 `/api/bootstrap` 里在等你的会话。
- **断开**：托盘「断开这台电脑」，或者网页「我 → 账号安全」里删掉这台。
- 文字跟系统语言（简体 / 繁体中文、English、日本語、Deutsch、Français、العربية）。

## 开发和打包

```bash
cd code/desktop
npm install
npm start            # 开发：直接跑
npm run dist         # 打包：mac 出 .dmg、Windows 出 .exe（NSIS）、Linux 出 .AppImage（各自在对应系统上打）
```

用的是 Electron + electron-builder。图标在 `assets/icon.png`（和 `docs/images/logo.png` 同一张）。没有签名：mac 第一次打开要在「系统设置 → 隐私与安全性」里允许；Windows 会提示「未知发布者」。
