# 默认头像

168 张。员工选了以后存成 data URL（和上传的图片一样），网页、原生 App 都能直接显示。新员工默认随机给一张同性别的「写实」头像。

## 写实（`rl-f01–f20` 女、`rl-m01–m20` 男，256×256 JPG）

**AI 生成的照片，不是真人。** 用阿里云百炼的 API 调通义万相（wan2.2-t2i-plus）生成（2026-11），按《阿里云百炼服务协议》，经 API 生成的内容归使用者所有，这里随项目的许可一起发布。人物描述（年龄、发型、穿着、背景色）在 `code/web/scripts/avatars-real.tsv`，提示词模板和后期（裁到脸为主、压成 256×256）在 `code/web/scripts/avatars-real.py`。要重新生成或加新的：让员工用 `image_generate` 按那个模板出图，再跑脚本。

## 画风（DiceBear，PNG）

都是用 DiceBear（https://www.dicebear.com）按固定参数一次性生成的，运行时不依赖它。

| 文件 | 画风（界面上叫） | 作者 | 许可 |
|---|---|---|---|
| `f01–f18`（女）、`m01–m18`（男） | Lorelei（插画） | Lisa Wischofsky | CC0 1.0 |
| `av-f01–14`、`av-m01–14` | Avataaars（卡通） | Pablo Stanley | 个人和商业使用都免费（https://avataaars.com） |
| `mi-f01–10`、`mi-m01–10` | Micah（扁平） | Micah Lanier | CC BY 4.0 |
| `th-f01–08`、`th-m01–08` | Toon Head（Q 版） | Johan Melin | CC BY 4.0 |
| `pe-f01–08`、`pe-m01–08` | Personas（简约） | Draftbit | CC BY 4.0 |
| `bt-01–12` | Bottts（机器人） | Pablo Stanley | 个人和商业使用都免费 |

CC BY 4.0 要署名：网页「关于 Opero → 用到的素材」里写了作者和许可；改了画（这里只是按参数生成、没有改原作）也要注明。

重新生成：`code/web/scripts/avatars-lorelei.mjs`（插画那 36 张）、`avatars-more.mjs`（其它 92 张），在一个临时目录里 `npm i @dicebear/core @dicebear/collection @resvg/resvg-js` 后 `node <脚本> <输出目录>`。参数说明见 `docs/设计.md`「默认头像和名字」。
