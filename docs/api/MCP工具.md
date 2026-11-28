# 员工的 MCP 工具

员工（Claude Code / Codex / Qwen Code / CodeBuddy Code）经 Opero 的 MCP 服务干活：连服务器、查库、编译发布、改配置……主人在网页「应用」里能做的，员工基本都能用工具做，这样主人说一句话，员工就能帮忙改。

## 规矩：应用里的功能尽量都有工具（2026-11-27 主人定的）

- 新加一个应用功能，同时加 MCP 工具（`code/server/src/tools.ts`）；能直接复用网页的接口就复用（`callApi`：同一份校验、改完同样推给网页）。
- 每个工具一个权限等级（`gated`）：**read** 只看，直接做；**write** 改东西，员工的审核方式是「自动」就直接做，否则先出确认卡片；**owner** 放宽安全的（取消生产保护、允许写库、给员工凭证、删凭证 / 域名、调高或取消预算、关提醒、改主人的习惯）一律出危险卡片，主人本人点（网页会验证本人），员工自己做不了。接口要「验证本人」的（403 VERIFY）也自动升级成 owner。所有改动都记操作记录（谁、经 MCP）。
- 员工永远拿不到密钥的值：要新凭证只能 `request_credential`（发卡片让主人去存）。

## 各个应用对应的工具

| 应用 | 工具 |
|---|---|
| 服务器和 Agent | `list_servers` `server_exec` `file_write` `server_check` `server_update` `server_dir_set` `log_register` `log_scan` `egress_manage`（网络出口：Opero 连不上的地址经哪台出去） |
| 凭证 | `list_credentials` `request_credential` `credential_manage`（改名、给 / 收回员工、删） |
| 数据 | `list_databases` `db_query` `database_schema` `database_update` `saved_query` |
| 发布 / 编译 / 安装包 | `setup_info` `build_info` `build_set` `build_generate` `build_try` `build_status` `pipeline_read` `release_list` `release_target_set` `release_publish` `release_status` `sign_package` `package_list` `package_upload` `package_get` `package_share` |
| 问题清单 | `issue_list` `issue_report` `issue_update` |
| 域名 | `domain_manage` `dns_list` `dns_set` `dns_delete` |
| 收件箱 / 消息渠道 | `inbox_list` `inbox_get` `inbox_draft` `notify_manage` |
| 触发器 | `schedule_list` `schedule_set` `schedule_delete` `schedule_run` |
| 知识库 | `kb_search` `kb_get` `kb_save` `kb_delete` |
| 操作记录 | `audit_search` |
| 项目 | `workspace_update` `switch_branch` `git_sync` `pr_create` `pr_status` |
| 员工 | `list_employees` `delegate` `emp_create` `emp_update` |
| AI 执行器 | `ai_status` `ai_install` |
| 用量和成本 | `usage_get` `budget_set` |
| 系统设置 | `settings_get` `settings_set` |
| 聊天里 | `ask_owner` `confirm` `send_card` `send_file` `approve` |
| 生图 | `image_generate`（用员工被授权的 AI Key：通义万相、OpenAI gpt-image、豆包 Seedream、智谱 CogView、硅基流动 Kolors） |

## 生图（`image_generate`，server 0.30.0）

- 挑 Key：主人「凭证 → AI」里能生图的厂商（`imagegen.ts` 的 `IMAGE_PROVIDERS`），并且给这个员工开了（`credBlock`，和 `{{secret:}}` 同一套）；`credential` 参数可以指定。没有 / 没开会明说找主人要哪个（`request_credential` / `credential_manage grant`）。
- 出图：通义万相走异步任务（提交 → 3 秒问一次 → 下载 24 小时有效的地址）；其它走 OpenAI 风格 `POST {base}/images/generations`（回 `b64_json` 或 `url`）。限流（429 / `Throttling`）自动等 4、8、12 秒重试；整体 5 分钟超时。尺寸 512–2048，OpenAI 只有三种比例，挑最接近的；豆包、智谱一次只出一张，`n` 大于 1 就分几次要。**只有通义万相实测过**，其它照各家官方文档接的，第一次用的人留意报错。
- 结果：图存一份到 `data/files/`（聊天用），一份推到员工的 `<家目录>/images/<name>-<时间>[-序号].<ext>`（员工在别的服务器也行，走 Agent）；`send` 默认 true，发到聊天。每次记一条操作记录（`mcp.image`：凭证、模型、张数、尺寸、提示词开头）。
- 钱：生图不走执行器，不算进「用量和成本」的美元数（各家按张计费，在各自的控制台看）；规矩里写了先出 1 张给主人看风格。

## 还没有工具的（要单独商量）

- **新建凭证、改凭证的值、看明文**：值只能主人自己贴进保险箱，员工拿不到——`request_credential` 发卡片代替。
- **AI 执行器的账号 / 登录**：令牌、订阅登录都要主人本人。
- **接入新服务器**：SSH 要密码 / 私钥；装 Agent 要在那台上用 root 跑一条命令。员工可以帮着生成命令、说明步骤，但跑命令和给密码要主人。
- **新加提醒 / 收件渠道**：要渠道的令牌（同上）。
- **主人账号安全**：密码、通行密钥、两步验证、登录过的设备——只能主人本人。
- **删员工、删项目**：会删掉聊天记录和设置，现在只在网页上做；要不要给员工（主人本人确认）待定。
- **服务器的机器规矩**（不许跑的命令、内存上限、能不能编译）：可以做成工具（一律主人本人确认），还没做。

<!-- 下面是自动生成的 -->

共 76 个（从 `code/server/src/tools.ts` 生成，别手改这一段）。

| 工具 | 做什么 | 参数 |
|---|---|---|
| `approve` | Permission check used by Claude Code before running a tool (internal). | `tool_name` `input` |
| `list_servers` | List the servers the owner connected to Opero (name, environment, OS, online, CPU/memory/disk, registered logs). No credentials. |  |
| `server_exec` | Run a shell command on one of the owner's servers through Opero (Opero holds the SSH credentials; you only get the output). Read-only commands run right away; anything that changes the server may need the owner to approve a card first. Always say why. | `server` `command` `reason` |
| `list_databases` | List the databases the owner connected (name, kind, environment, writable, tables). A connection without db is a whole server/instance: "dbs" lists the databases you can pick with db_query's db. |  |
| `db_query` | Run SQL on one of the owner's databases through Opero. SELECT/SHOW/EXPLAIN run in a read-only transaction (15 s timeout, 200 rows max, sensitive columns masked). Writes only on databases marked writable and always need the owner to approve. | `database` `db` `sql` `reason` |
| `switch_branch` | Switch your project (workspace) to another Git branch. Every employee of this project shares the same checkout, so they all switch with you; uncommitted changes are stashed first. Use when the owner asks to work on another branch. | `branch` |
| `git_sync` | Fetch the latest code of your workspace from its Git remote with the owner's token (you cannot fetch/pull/push yourself), optionally rebase onto it and push your commits. Commit first if you want to push. | `workspace` `rebase` `push` |
| `ask_owner` | Ask the owner to pick one of a few options (shown as a card in the chat). Waits for the answer (up to 30 minutes) and returns the chosen option. | `question` `options` `recommend` |
| `confirm` | Ask the owner to approve something irreversible or production-affecting before you do it (a card with the details). Waits for the answer and returns approved / denied. | `title` `detail` `why` `danger` |
| `send_card` | Post a structured card to the owner (title, optional tag, key/value rows, optional buttons). Does not wait; if the owner taps a button you receive it as a new message. | `title` `tag` `rows` `buttons` |
| `send_file` | Send a file or image from your working directory to the owner in the chat. | `path` `name` |
| `image_generate` | Generate images from a text prompt (photos, avatars, illustrations, icons, UI mockups…) with an AI image model, using an AI key the owner granted you; Opero calls the API, you never see the key. Works with these AI credentials: 通义千问（阿里云百炼） → 通义万相 (default wan2.2-t2i-plus; also wan2.2-t2i-flash, qwen-image), OpenAI → gpt-image-1, 豆包（火山方舟） → Seedream, 智谱 GLM → CogView, 硅基流动 → Kolors. Images land in <your home>/images/ (paths returned, so you can crop / resize / commit them) and, unless send=false, show up in the chat for the owner. Each image costs money: make 1 first to check the style, then the rest. Write the prompt in Chinese for 通义 / 豆包 / 智谱. No key granted → it tells you which one to ask for. | `prompt` `negative_prompt` `size` `n` `model` `credential` `name` `send` |
| `kb_search` | Search the shared knowledge base (specs, API docs, product notes, conventions) that all employees use. Returns matching docs with a snippet. | `query` |
| `kb_get` | Read one knowledge-base doc in full. | `id` |
| `kb_save` | Add or update a knowledge-base doc (by name) so every employee can use it. | `name` `kind` `summary` `body` |
| `list_employees` | List the other AI employees (id, name, role) you can delegate to. |  |
| `delegate` | Hand a task to another employee. It shows up in that employee's chat and it starts working on it. | `employee` `message` |
| `log_scan` | Analyse logs on a server without dumping them. mode: hist = matching lines per minute/10 min/hour (when did it start, is it still happening); first = first occurrences with following lines (stack traces); last = latest occurrences; top = error kinds and failing lines, counted (numbers/ids folded); grep = matching lines. Default pattern matches ERROR/Exception/FATAL/Traceback. Give neither file nor service to scan every log the owner registered on that server (list_servers shows them). Read-only. | `server` `file` `service` `mode` `grep` `since_min` `bucket` `limit` `before` `after` `rotated` |
| `file_write` | Write a file on one of the owner's servers (config files etc.). The old file is backed up next to it first (<path>.bak-<time>). Always needs the owner to approve a card. Use {{secret:<credential name>}} for passwords/keys — Opero fills them in, you never see them. | `server` `path` `content` `reason` |
| `my_permissions` | See every permission in Opero and whether you have it: all credentials (name, group, kind, environment, scope — never values) marked granted / not-granted / owner-only, the domains whose DNS you may change, and your review mode. Knowing is not having: to use one you do not have, call request_permission. |  |
| `request_permission` | Ask the owner for a permission you do not have yet (see my_permissions): kind credential (an existing credential, by name) or domain (change that domain's DNS). Posts a card the owner approves with one tap; it never expires. Does NOT wait: keep doing work that does not need it; when the owner decides, Opero tells you in the chat. For a brand-new credential that does not exist yet use request_credential. | `kind` `name` `why` |
| `list_credentials` | List the credentials the owner allowed employees to use (names only, never values). Put {{secret:<name>}} in a server_exec command or file_write content and Opero fills in the value; output is masked. |  |
| `issue_list` | List the issue list (production problems found in logs): id, title, status new/fixing/fixed/known/ignored, severity, count, where. | `status` |
| `issue_report` | Record a production problem you found (e.g. with log_scan) in the issue list. Same key = same problem: the count goes up instead of a new entry. A new high-severity problem is shown to the owner as a card (fix / known / ignore). Report each distinct problem once per scan. | `title` `key` `severity` `server` `workspace` `sample` `cause` `count` |
| `issue_update` | Update an issue: mark fixed after you fixed and verified it, add the cause, or reopen. | `id` `status` `cause` `note` |
| `emp_create` | Create a new AI employee (only if your profile allows managing employees). The owner approves a card first. Machines, databases and credentials are never granted here — the owner does that. | `name` `role` `title` `prompt` `persona` `executor` `workspace` `host` |
| `emp_update` | Change another employee's title / role prompt / persona / workspace (only if your profile allows managing employees). The owner approves a card first. Its memory repo role section is rewritten on its next run. | `employee` `title` `prompt` `persona` `workspace` |
| `pr_create` | Open a pull / merge request from the branch you work on into the workspace main branch (GitHub, GitLab, Gitee, Codeup). Opero pushes your branch first. Commit your work before calling. | `title` `body` `workspace` `target` |
| `pr_status` | Check a pull / merge request you opened: open / merged / closed, and whether it has conflicts. Without id: your latest ones. | `id` |
| `dns_list` | DNS: without domain, list the domains you may change; with a domain, list its records (id, rr, type, value, ttl). | `domain` |
| `dns_set` | Add or update a DNS record (same rr + type is updated). Check the current records first with dns_list; after changing, verify with dig. Only domains the owner granted you. | `domain` `rr` `type` `value` `ttl` `priority` `why` |
| `dns_delete` | Delete a DNS record by id (dns_list shows ids). Only domains the owner granted you. | `domain` `id` `why` |
| `server_update` | Rename a server, change its environment tag / production protection, or turn its Agent auto-upgrade on / off. Turning protection OFF (or moving a protected server to a non-production tag) always needs the owner to confirm in person. | `server` `name` `env` `protect` `autoUpgrade` |
| `server_check` | Re-check a server now: online, CPU / memory / disk, OS, Agent version. | `server` |
| `database_update` | Rename a database or change its environment tag, protection, or whether employees may write to it. Allowing writes or removing protection always needs the owner in person. | `database` `name` `env` `protect` `writable` |
| `database_schema` | Refresh a database's table / column list (after migrations). | `database` |
| `saved_query` | Saved queries (shown as one-click menus for the owner): list, save, delete. | `action` `name` `database` `sql` `id` |
| `kb_delete` | Delete a document from the shared knowledge base. | `id` `title` |
| `schedule_run` | Run a scheduled / webhook task right now (schedule_list for names). | `name` |
| `notify_manage` | Where the owner's reminders go (Telegram, Slack, WeCom, DingTalk, Feishu, email, webhook) and where the inbox receives from: list, test (send a test reminder), update (enabled, events: decide / error / all). Turning reminders off or dropping "decide" needs the owner in person. Adding a channel needs its token: ask the owner (request_credential / the 消息渠道 page). | `action` `id` `enabled` `events` |
| `credential_manage` | Manage existing credentials without seeing their values: rename; grant / revoke an employee's use of one (granting always needs the owner in person); delete (owner in person). To get a NEW credential use request_credential. | `action` `credential` `name` `employee` |
| `audit_search` | Search the operation log (who did what, when; employees and the owner). | `q` `who` `limit` |
| `usage_get` | Cost and usage: per employee, per project, this month vs budget. |  |
| `budget_set` | Monthly budget (USD) of an employee; 0 = no own limit. (Projects have no budget.) Raising or removing a budget needs the owner in person; lowering follows your review mode. | `employee` `usd` |
| `settings_get` | Read the system settings (run summary, production protection, theme, language, reminder level, global budget, quick phrases, the owner's habits). |  |
| `settings_set` | Change system settings. Turning production protection off, raising / removing the global budget, turning off budget stop, or changing the owner's habits (the rules all employees follow) needs the owner in person. | `runSummary` `prodProtect` `theme` `lang` `notify` `budget` `budgetStop` `phrases` `habits` |
| `workspace_update` | Change a project's settings: rename, preview URL. (Projects always auto commit & push after each round — that is the standard, not a setting. Builds: build_set; release targets: release_target_set.) | `workspace` `name` `preview` |
| `ai_status` | Subscription accounts include remaining usage (5-hour window and week, % left and reset time). AI executors: which are installed (Claude Code, Codex, Qwen Code, CodeBuddy Code) and which accounts exist (names only), default, usage limits. Adding accounts / logging in is the owner's job. |  |
| `ai_install` | Install an AI executor (as the AI user, via the official script / npm) on Opero's machine or an Agent server. | `executor` `server` |
| `egress_manage` | Network egress rules: when Opero itself cannot reach an address (mailbox IMAP/SMTP, notification channels like Telegram/Slack, AI keys, image generation, DNS, pipelines, code hosting APIs…), route connections to that domain (and its subdomains) through another server's Agent that can. action=list: rules + recent connection failures (start here when something "can't connect"); test: try host[:port] directly and via a server; set: add/change a rule (tests first, saves only if it connects through that server; force=true saves anyway); delete. via = server name/id with an Agent, or "direct" for an exception. lan=true (allow private/intranet addresses) needs the owner in person. | `action` `host` `via` `port` `lan` `note` `force` |
| `domain_manage` | Register a domain in Opero (with a DNS credential: Cloudflare API token or Aliyun AccessKey) or remove one (owner in person). Records: dns_list / dns_set / dns_delete. | `action` `domain` `provider` `credential` |
| `sign_package` | Sign an .apk / .aab in your working directory with one of the owner's signing certificates (you never see the keystore or passwords). Without arguments: list the certificates you may use. Writes <name>-signed.apk next to it. | `path` `cert` |
| `package_list` | App packages of a project (apk / aab / ipa / dmg / msix / exe / AppImage …). Every project has one slot per platform × channel (android / ios / mac / windows / linux × test / prod) and each slot keeps ONLY the latest package — uploading replaces the old one. Shows version, size, sha256, signed, who / when, share link. Use it before telling the owner where a build is. | `workspace` |
| `package_upload` | Put an app package you built (a file in your working directory) into the project's package slot; replaces the previous one in that slot (only the latest is kept). Platform is guessed from the extension (.apk/.aab android, .ipa ios, .dmg/.pkg mac, .msix/.exe/.msi windows, .AppImage/.deb/.rpm linux). Sign android packages first (sign_package) or say signed=false. Channel test = for testers (default), prod = the release build. Do this whenever you produce an installable build — the owner downloads / shares it from the project page. Release targets set to "store as package" do this automatically. | `path` `platform` `channel` `version` `build` `signed` `note` `workspace` |
| `package_get` | Copy the latest package of a slot into your working directory (to test it, upload it to a store, inspect it). Returns the path. | `platform` `channel` `workspace` |
| `package_share` | Make (or turn off with days=0) a public download link for a slot's latest package, e.g. for testers to install the android build by scanning a QR code. The link keeps working when the package is replaced, until it expires (default 7 days, max 90). | `platform` `channel` `days` `workspace` |
| `inbox_list` | List the owner's inbox (email and Slack collected by Opero): id, from, where, summary, category need / fyi / skip, done. Default: things that need the owner and are not done. | `cat` |
| `inbox_get` | Read one inbox item in full (email body is fetched from the mailbox). | `id` |
| `inbox_draft` | Save a reply draft for an inbox item (in the sender's language, plus the Chinese meaning). The owner copies and sends it — you can never send. | `id` `text` |
| `release_list` | List the release targets of the workspaces (name, servers, whether build/sign/health check is set, your release permission auto/ask/off) and their latest releases. | `workspace` |
| `release_publish` | Release a workspace to one of its targets: Opero takes the latest commit on the remote branch, builds / signs if configured, deploys, health-checks, and rolls back automatically on failure. Push your code first. Permission per target: auto = goes right away, ask = the owner approves a card, off = refused. Returns right away; progress shows as a card. If an auto release fails you get the reason back to fix it. | `workspace` `target` `note` `reason` |
| `build_info` | Show how a project is built. A project can have several build components (e.g. web, Android, backend), each with its own template, command, where it builds and pipeline; release targets pick which component they ship. Per component: template (node/go/android/spring/custom), where it builds (auto = local server if it has enough resources, else the pipeline; local; pipeline), pipeline tool (Codeup Yunxiao Flow / GitHub Actions) and whether the pipeline exists, the build script contract (put release files in out/; Opero adds SHA256SUMS/VERSION/COMMIT; a deploy.sh inside the package installs it with OPERO_DIR = deploy dir), the last test build and the generated build script. Read this before changing anything. | `workspace` `component` |
| `build_set` | Add or change a build component of a project (a project can have several: web, Android, backend…). component = the one to change; a new name adds a new component; remove: true deletes it (not while a release target ships it). Only pass what you want to change. where: auto (default, recommended) / local / pipeline. kind: node / go / android / spring / custom (custom needs cmd: a command run at the repo root that puts the release files into out/, e.g. "bash deploy/build.sh"). Then call build_generate to (re)create the pipeline and build_try to test. | `workspace` `component` `name` `remove` `kind` `where` `cmd` `subdir` `versionFile` `service` `provider` `credential` `job` |
| `build_generate` | Create or update the pipeline of a build component on its pipeline tool (Codeup Yunxiao Flow: created with the owner's Codeup token; GitHub Actions: commits .github/workflows/opero-build-<component>.yml; GitLab: one job per component in .opero/gitlab-ci.yml; Jenkins: job opero-<project>-<component>). Safe to run again after changing settings. Push your build script changes first. | `workspace` `component` |
| `build_try` | Test-build a build component from the latest pushed commit (build only, nothing is deployed). Decides local vs pipeline like a real release. Different components can build at the same time. Returns right away; poll build_status. Fix the build script / settings from the log until it passes. | `workspace` `component` |
| `build_status` | Show the current / last test build of a build component: status, where it ran, output files, and the log. | `workspace` `component` |
| `setup_info` | Everything you need to set up building and releasing a project yourself: repo platform and token, which credentials the owner has (names only, and whether you may use them), existing pipelines on Yunxiao / Jenkins (read them with pipeline_read and reuse their build steps), Opero build settings, release targets, servers with their environment and registered deploy dirs, and what is still missing. Call this first when asked to set up build / release / deploy. | `workspace` |
| `pipeline_read` | Read an existing pipeline the owner already has (Yunxiao pipeline YAML or Jenkins job config.xml) so you can reuse its build / deploy steps in Opero (build_set cmd, release_target_set command). Ids come from setup_info. | `tool` `id` `workspace` |
| `release_target_set` | Create or update a release target (environment) of your project: which build component it ships (build; required when the project has more than one; "none" = no build, just run the deploy command), which servers, deploy dir (registered as deployable on those servers automatically), the deploy script inside the package (default deploy.sh) or a deploy command, health-check URL, versions to keep. Targets on production (protected) servers always ask the owner before each release; you cannot loosen a permission the owner set. Then build_try and release_publish. | `workspace` `name` `env` `build` `servers` `dir` `script` `command` `health` `keep` `package` `permission` `sign` |
| `request_credential` | Ask the owner for a key / token / account you need and cannot get yourself (e.g. a Codeup token with pipeline permission, a Jenkins API token, a GitHub token with workflow scope, a database account). Posts a card with a button that opens the right "new credential" page with step-by-step instructions; when the owner saves it, it is granted to you and you get a message to continue. Say exactly which permissions are needed and why. Before asking, check setup_info / list_credentials: if the owner already has it but did not grant it to you, say so instead. | `group` `kind` `why` `perms` |
| `schedule_list` | List the scheduled / webhook tasks (triggers): id, name, when, which employee, what it is told, enabled, last run, webhook path. |  |
| `schedule_set` | Create or change a scheduled task (trigger) that hands an employee a message on a schedule or when a webhook is called. The owner just says it in chat ("每天 18:00 给我发小结") — you set it up. when: 每 N 分钟 (≥5) / 每 N 小时 / 每天 HH:MM / 工作日 HH:MM / 每周一 HH:MM / webhook. Default employee: you. Write prompt as the full instruction the employee gets each time. | `id` `when` `prompt` `employee` `name` `enabled` |
| `schedule_delete` | Delete a scheduled task (trigger) by id. | `id` |
| `server_dir_set` | Register (or remove) a directory on a server: read = employees may read it, write = employees may read and write it (Opero grants the AI user ACL access), deploy = releases may deploy into it. Use when you need access to a dir or a release needs a deploy dir. Write access on production servers asks the owner first. | `server` `path` `mode` `note` `remove` |
| `log_register` | Register (or remove) a log on a server so log_scan and the owner's log viewer find it: file (absolute path, may contain *), dir (all *.log inside) or service (systemd unit). Find the real log locations yourself first (server_exec: ls, systemctl, the app config). | `server` `kind` `path` `note` `remove` |
| `release_status` | Show recent releases (or one by id): steps, error, and the last part of the build / deploy output. | `id` `workspace` |
