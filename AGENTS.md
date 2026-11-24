# 给 AI 的说明 / Notes for AI agents

（Claude Code 读 CLAUDE.md，Codex 读 AGENTS.md，两份内容一样。Claude Code reads CLAUDE.md, Codex reads AGENTS.md; both are identical.）

## 这份代码是什么

- 这是 **Opero**：自己部署的「AI 开发团队」，在聊天 App 里指挥 AI 员工（Claude Code / Codex）干活。来源：开源项目 https://github.com/yimaworks/opero 。
- **拿到之后它就是这个仓库主人自己的代码**：按主人的需求直接改、二开都行。
- **不需要、也不要定期去同步上游**。不要写「每次先从上游拉代码」这类脚本或流程，也不要把「跟上游保持一致」当成日常任务。
- 只有主人明确要「升级到新版本」或者想参考上游某个功能的做法时，才去上面的 GitHub 看最新代码，挑需要的部分合进来（合之前先跟主人确认）。

## 目录

- `code/server`：后台（Node 22 直接跑 TypeScript，SQLite），说明见 `code/server/README.md`。
- `code/web`：网页（React + Vite），说明见 `code/web/README.md`。
- `code/android`、`code/desktop`：手机 App 外壳、桌面端。
- `docs/设计.md`：设计和接口；`docs/规范/`：界面、数据、表单与卡片等规范；`docs/变更记录.md`：版本记录。

## 改代码时

- 界面照 `docs/规范/界面.md` 做：能点不填、能自动补的自动补、确认只给危险操作。
- 界面文字源文是简体中文，改了跑 `cd code/web && node scripts/i18n-extract.mjs`，再补各语言（`code/web/src/i18n/`）。
- 不要把密钥、令牌、密码、`.env` 提交进 git。

## What this code is (English)

- This is **Opero**, a self-hosted "AI dev team" you command from a chat app. Origin: https://github.com/yimaworks/opero .
- **Once cloned, it is the repo owner's own code.** Change and extend it as the owner asks.
- **Do not set up routine syncing with upstream** (no "pull upstream before every task" scripts or workflows). Only look at the GitHub repo when the owner explicitly wants to upgrade or wants to see how upstream implemented something, then bring over just what is needed (confirm with the owner first).

---

在 Opero 官方开发仓库里干活的：如果有 `docs/开发规矩.md`，先读它，按那份做（公开版本里没有这个文件）。
Working in the official Opero development repository: if `docs/开发规矩.md` exists, read and follow it (it is not in the public copy).
