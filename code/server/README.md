# code/server：Opero 后台（v0.1）

一个 Node 进程：登录、聊天、让 Claude Code / Codex 员工干活、Opero MCP 代理（服务器 / 数据库 / Git / 卡片 / 知识库）、保险箱、触发器、操作记录、手机外壳接口；同时把 `code/web/dist` 当网页发出去。设计细节见 `docs/设计.md`「后台 v0.1」。

- **运行时**：Node 22.18+ 直接跑 TypeScript（类型擦除，不用编译）；存储是 Node 自带的 `node:sqlite`；依赖只有 `ssh2`、`mysql2`、`pg`。
- **写法约定**：只用能擦除的 TS 语法（不用 enum、参数属性、namespace），`import` 写 `.ts` 后缀；`npm run typecheck` 做类型检查。

## 装在服务器上

```bash
curl -fsSL https://raw.githubusercontent.com/wfcaven/opero/main/code/server/scripts/install.sh | sudo bash   # 国内：… | sudo bash -s -- --cn
# 或者在拉下来的代码里
sudo bash code/server/scripts/install.sh
```

更省事：让服务器上的 Claude Code / Codex 照根目录 `INSTALL.md` 装。代码从 GitHub 拉到 `/opt/opero/src`，`opero update` 在那里拉最新再重装。装完打开 `http://服务器IP:7300`。脚本做了什么、装在哪：见 `scripts/install.sh` 开头的注释；nginx + HTTPS 例子：`scripts/nginx.conf`。管理命令：`opero status | logs | restart | info | reset-password | update | ai`。

## 本机开发

```bash
cd code/web && npm install && npm run build      # 后台发的是 dist
cd ../server && npm install && npm start         # http://127.0.0.1:7300，数据在仓库根目录 .opero-data/
```

本机开发没有单独的 AI 系统用户（`OPERO_AI_USER` 没设），AI 和后台是同一个用户，启动时会提示。改网页时可以 `npm run dev` 另开 Vite，但真接口要从 7300 打开。

## 配置（环境变量，安装脚本写在 `/etc/opero/opero.env`）

| 变量 | 默认 | 说明 |
|---|---|---|
| `OPERO_PORT` / `OPERO_HOST` | 7300 / 127.0.0.1 | 监听 |
| `OPERO_DATA` | `<仓库>/.opero-data` | 数据库、`vault.key`、文件；只给后台用户读 |
| `OPERO_WORK` | `$OPERO_DATA/work` | 员工干活的目录（`ws/` 工作空间、`emp/` 员工自己的目录） |
| `OPERO_WEB` | `<仓库>/code/web/dist` | 网页 |
| `OPERO_AI_USER` | 空 | 执行器用哪个系统用户跑（安装脚本建 `opero-ai`） |
| `OPERO_URL` | 空 | 对外地址（配了域名填上） |
| `OPERO_CLAUDE_BIN` / `OPERO_CODEX_BIN` | claude / codex | 执行器命令（在 AI 用户的登录 shell 里找） |
| `OPERO_MAX_TURNS` | 200 | Claude Code 每轮最多多少步 |

## 文件

| 文件 | 是什么 |
|---|---|
| `src/main.ts` | 入口：HTTP、认证分发、静态网页（注入 `OPERO_MODE`） |
| `src/api.ts` | 全部接口 |
| `src/runner.ts` | 起执行器、解析流式输出、插话 / 排队、停止、等卡片 |
| `src/tools.ts` | MCP 工具的实现（审核、服务器、数据库、Git、卡片、知识库、转派） |
| `src/mcp.ts` | 挂给执行器的 MCP 服务（stdio），把调用转给本机后台 |
| `src/vault.ts` | 保险箱（AES-256-GCM）+ 输出里去掉密钥 |
| `src/ssh.ts` | SSH 执行、主机指纹、健康（CPU / 内存 / 磁盘）、只读命令判断 |
| `src/dbconn.ts` | MySQL / PostgreSQL 查询（只读事务、打码）、读表结构 |
| `src/git.ts` | 工作空间：clone / 看分支提交 / 同步推送（令牌经 GIT_ASKPASS） |
| `src/triggers.ts` | 定时规则解析和调度、Webhook 触发 |
| `src/auth.ts`、`chat.ts`、`bus.ts`、`db.ts`、`http.ts` | 登录 / 会话消息和操作记录 / SSE 和推送队列 / SQLite / 小路由 |
| `src/presets.ts` | 开机向导里一键建的员工 |
| `src/cli.ts` | `opero reset-password`、`opero info` |
| `scripts/install.sh` | 安装 / 升级 |
