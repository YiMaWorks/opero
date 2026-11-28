# native-ui：以前写的原生界面（不参与编译）

2026-11-28 主人定：App 的界面直接用网页的手机版（见 `../README.md`）。这里是之前写的原生（Jetpack Compose）会话列表、聊天、卡片、发布卡片、看大图、常用语、底部五个页签和它们的数据层（`data/Live.kt` 实时数据、`data/Models.kt` 数据结构）。

- **没编通过过**：最后一次试编（云效第 12 次，android 0.4.2）报了 `Live.setPhrases` 和属性 setter 重名（已改成 `savePhrases`），后面可能还有别的错误。
- **不在 `app/src/main/java` 里**，所以不参与编译，也不会因为它编不过。
- 以后哪一页（多半是聊天）要换成原生：把要用的文件挪回 `app/src/main/java/cn/yimakeji/opero/` 对应的目录（包名没改），`MainActivity` 里那一页改成打开原生页，其它照旧用网页；按编译日志修。
- 它依赖的东西还在 app 里：`data/Api.kt`（带登录取文件、上传、实时推送的长连接 `openStream`）、`data/Store.kt`（草稿、「先不换」）、`i18n/I18n.kt`、`ui/theme/Theme.kt`、`web/WebPage.kt`（原来的 `EmbedPage`，嵌网页的 `WebEnv` 接口变了，`AppHost` 合进了 `WebEnv`）。
