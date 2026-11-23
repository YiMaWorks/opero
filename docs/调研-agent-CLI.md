# 调研：能当 Opero 执行器的 CLI 编码 agent

- 查询日期：2026-11-21（资料用 WebSearch / WebFetch 查，以官方文档、GitHub releases、npm / PyPI registry 为准）
- 标「第三方」的是只在非官方资料里看到的；「未查到」就是没查到，不是"没有"。
- 版本号和日期都是 2026-11-21 前后的快照，这些项目几乎每天发版，用之前再核对。

## 一句话结论

**行业已经收敛到两种驱动方式：① Claude Code 风格的 `stream-json`（stdin 写 JSONL 消息、stdout 读 JSONL 事件）；② ACP（Agent Client Protocol，stdio JSON-RPC，`session/new` 时能直接把 MCP server 传给 agent）。** Opero 的 Go Agent 实现这两种"驱动器"，再加一个 Codex app-server 驱动器，就能覆盖几乎所有主流 CLI。第一批建议：**Claude Code（stream-json）、Codex（app-server）、OpenCode / Qwen Code（ACP 或 stream-json）**，第二批接 ACP 通用驱动覆盖 Goose、Copilot CLI、Kimi Code、Kiro、Cline、Droid 等。
另外三件会影响选型的事：
1. **订阅账号基本都不能拿来给别人提供服务**：Anthropic 明确禁止第三方产品用 claude.ai 订阅登录或订阅额度；OpenAI 的 ChatGPT 条款禁止"用 ChatGPT 驱动第三方服务"；阿里百炼 Coding Plan 明确禁止自动化脚本 / 应用后端。服务器端执行器应按 **API Key 按量计费** 设计。
2. **Codex 的 `codex mcp-server` 已删除**（2026-08 废弃、0.154.0 / 2026-09-09 移除，版本号来自第三方转引），官方现在推 app-server / SDK。
3. **Gemini CLI 对个人账号已停服**（2026-06-18 起由闭源的 Antigravity CLI `agy` 替代），只剩付费 API Key 和 Code Assist 企业版能用；iFlow CLI、Continue CLI、Roo Code、OpenHands CLI、旧 Kimi CLI（Python 版）已停更 / 关停。

## 总对比表

优先级：P0 = 第一批；P1 = 第二批（多数走 ACP 通用驱动）；P2 = 有需要再接；✗ = 不建议。

| Agent | 开源 / 许可 | 无界面命令 | 续会话 / 常驻驱动 | 流式事件 | MCP 客户端 | ACP | 认证 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| Claude Code | 闭源（All rights reserved）；Python SDK MIT | `claude -p [--bare]` | `--resume/--session-id`；`--input-format stream-json` 常驻；TS/Py Agent SDK | stream-json（system/init、assistant、user、stream_event、result） | stdio / http / sse(废弃)；`--mcp-config` + `--strict-mcp-config` | 适配器 `@agentclientprotocol/claude-agent-acp` | API Key / Bedrock / Vertex / Foundry / 网关；订阅禁止对外 | **P0** |
| OpenAI Codex CLI | 开源 Apache-2.0（Rust） | `codex exec --json` | `codex exec resume <id>`；`codex app-server`（JSON-RPC，常驻，标 Experimental）；TS/Py SDK | exec：thread/turn/item.*；app-server：item/*、turn/* 通知 | stdio / Streamable HTTP；config.toml 或 `-c` 覆盖 | 适配器 `@agentclientprotocol/codex-acp` | ChatGPT 登录 / API Key；第三方需兼容 Responses API | **P0** |
| Gemini CLI | 开源 Apache-2.0（TS） | `gemini -p -o stream-json` | `-r/--resume`；无 stdin 流式，常驻走 ACP | stream-json（init、message、tool_use、tool_result、result） | stdio / SSE / Streamable HTTP；只能写 settings.json | 原生 `gemini --acp` | API Key / Vertex / Code Assist；个人账号已停服 | P2 |
| GitHub Copilot CLI | 闭源（允许随应用再分发）；SDK MIT | `copilot -p --output-format json` | `--resume/--session-id`；`--acp`；多语言 SDK（含 Go） | JSONL（字段文档不全）；SDK 事件 tool.execution_start 等 | stdio / http / sse；`--additional-mcp-config` | 原生 `copilot --acp`（preview） | GitHub 令牌；**BYOK 支持 OpenAI 兼容** | P1 |
| Cursor CLI | 闭源 | `agent -p --output-format stream-json` | `--resume/--continue`；`agent acp`；`@cursor/sdk`(beta) | stream-json（system/init、assistant、tool_call、result） | stdio / HTTP / SSE；只认 `.cursor/mcp.json` | 原生 `agent acp`（有 MCP 被忽略的 bug 报告） | Cursor 账号 / `CURSOR_API_KEY`；CLI BYOK 未查到 | P2 |
| Kiro CLI（原 Amazon Q Developer CLI） | 闭源（Q CLI 旧仓库 MIT/Apache 仅修安全） | `kiro-cli chat --no-interactive --output-format stream-json` | `--resume-id`；`kiro-cli acp` | ACP 形状 JSONL + runFinished / runError | stdio / HTTP；mcp.json 或 agent 配置 | 原生 `kiro-cli acp` | `KIRO_API_KEY`（需 Pro 以上订阅），只能用平台模型 | P1 |
| OpenCode | 开源 MIT（TS/Bun） | `opencode run --format json` | `-s <id>` / `-c`；`opencode serve`（HTTP + SSE）；TS SDK | JSONL（step_start、tool_use、text、step_finish）；SSE | stdio(local) / Streamable HTTP(remote)；执行超时可配 12h | 原生 `opencode acp` | 任意 OpenAI 兼容；ChatGPT / Copilot 登录 | **P0/P1** |
| Aider | 开源 Apache-2.0（Python） | `aider -m ... --yes-always` | 只有 markdown 历史；无 server | 纯文本 | **不支持** | 无 | 各家 API Key / OpenAI 兼容 | ✗（基本停更） |
| Goose | 开源 Apache-2.0（Rust，归 AAIF） | `goose run -t ... --output-format stream-json` | `-n name -r`；`goose acp`；`goose serve`（ACP over HTTP/WS） | stream-json（message、notification、complete、error） | stdio / Streamable HTTP；支持 elicitation、MCP Apps | 原生（主接口） | 任意 provider / OpenAI 兼容 / 自定义 provider | P1 |
| Crush（Charm） | 源码公开 FSL-1.1-MIT（Go） | `crush run`（纯文本） | `-s <id>` / `-C`；`crush serve`（REST + SSE，无文档） | run 无结构化输出 | stdio / http / sse | 无（issue #990 未合） | OpenAI / Anthropic 兼容，内置国内厂商 | P2 |
| Amp | 闭源 | `amp -x --stream-json` | `amp threads continue`；`--stream-json-input` 常驻、支持 steer 插话；TS SDK | 兼容 Claude Code 的 stream-json | stdio / 远程 URL；`--mcp-config` | 官方不做；社区 amp-acp | Amp 账号 / `AMP_API_KEY`（按 credits） | P2 |
| Qwen Code | 开源 Apache-2.0（TS，源自 Gemini CLI） | `qwen -p -o stream-json` | `--resume <id>`；`--input-format stream-json` 常驻；`--acp`；`qwen serve`（HTTP + SSE）；TS/Py/Java SDK | 类 Claude Code stream-json | stdio / SSE / Streamable HTTP；`timeout` 默认 600s | 原生 `--acp` | OpenAI / Anthropic / Gemini 兼容，百炼；Coding Plan 禁止自动化 | **P0/P1** |
| Kimi Code CLI（Kimi CLI 后继） | 开源 MIT（TS）；旧 kimi-cli(Python) 已归档 | `kimi -p --output-format stream-json` | `-S <id>` / `-c`；`kimi acp`；官方 Go SDK（kimi-agent-sdk） | stream-json（schema 无文档，过程在 stderr） | stdio / HTTP / SSE；`toolTimeoutMs`；无 `--mcp-config` | 原生 `kimi acp` | Kimi 会员 / Moonshot API Key / 自定义 provider | P1 |
| iFlow CLI | 已关停（2026-04-17 停服） | `iflow -p` | `--resume` | 未查到 | 有 | 有 | 已关停 | ✗ |
| 腾讯 CodeBuddy Code | 闭源（许可未查到） | `codebuddy -p --output-format stream-json` | `-r <id>/--session-id`；`--input-format stream-json` 常驻；`--acp`；TS/Py SDK | **对齐 Claude Code 2.1.220 stream-json** | stdio / SSE / HTTP；`--mcp-config`；MCP Apps 仅 Web UI | 原生 `--acp` | 腾讯账号 / `CODEBUDDY_API_KEY`；BYOK 未查到 | P1（国内首选） |
| Qoder CLI（阿里） | 许可未查到 | `qodercli -p -o stream-json` | `--session-id` / `-c`；`--input-format stream-json`；`--acp` | 类 Claude Code（第三方实测） | 未查到细节 | 原生 `--acp` | `QODER_PERSONAL_ACCESS_TOKEN`（credits） | P2（待细查） |
| Factory Droid | 闭源 | `droid exec -o stream-json` | `-s <id>`；`--input-format stream-jsonrpc` 常驻（JSON-RPC，权限回调）；TS/Py SDK | json / stream-json / stream-jsonrpc / acp | stdio / http / sse；单工具 `timeout` | 原生 `-o acp` | `FACTORY_API_KEY`；BYOK customModels | P1 |
| Augment Auggie | 闭源（需订阅） | `auggie --print --mode json` | `-c` / `--session`；`--acp`；TS/Py SDK | json（字段未查到）；ACP 事件 | stdio / http / sse；`--mcp-config` | 原生 `--acp` | Augment 账号，只能用托管模型 | P2 |
| Cline CLI | 开源 Apache-2.0（TS） | `cline --json "task"`（**默认 auto-approve**） | `--id <id>`；`--acp`；`cline hub` 守护；TS SDK | NDJSON（agent_event、run_result） | stdio / sse / streamableHttp（不写 type 默认 sse） | 原生 `--acp` | 完全 BYOK，OpenAI 兼容 | P1 |
| Continue CLI (cn) | Apache-2.0，**已停更**（被 Cursor 收购） | `cn -p` | `--resume` | json（无 schema） | YAML 配置 | 未查到 | 自带 key | ✗ |
| Mistral Vibe | 许可未确认（Python） | `vibe -p --output streaming` | `vibe-acp`；实验 `vibe run-server` | text / json / streaming | 未查到细节 | 原生 `vibe-acp` | `MISTRAL_API_KEY` | P2 |
| JetBrains Junie CLI | 闭源 | `junie --output-format json-stream` | `--acp true` | json / json-stream | `~/.junie/mcp/mcp.json` | 原生 | `JUNIE_API_KEY`；BYOK（第三方） | P2 |
| MiniMax Code | 开源 MIT（TS） | `mcode exec` | `mcode acp`；`@minimax-ai/code-sdk` | 未查到 | 未查到 | 原生 `mcode acp` | 自定义 base URL（openai / anthropic 格式） | P2 |

---

## 各 agent 详细

### 1. Claude Code（Anthropic）
1. **基本**：闭源（LICENSE 写 All rights reserved，受 Commercial Terms 约束），TypeScript（第三方信息）。CLI v2.1.330（2026-11-20）。SDK：TS `@anthropic-ai/claude-agent-sdk` v0.3.330、Python `claude-agent-sdk` v0.2.187（MIT），都是包装 CLI 子进程。
2. **无界面**：`claude -p "..."`；官方推荐 `--bare`（不加载本机 hooks / 插件 / CLAUDE.md / .mcp.json，也不读订阅登录，必须用 `ANTHROPIC_API_KEY`）。续会话 `--continue`、`--resume <id>`、`--session-id <uuid>`（预先指定）、`--fork-session`。常驻：`--input-format stream-json --output-format stream-json --verbose`，stdin 持续写 `{"type":"user","message":{"role":"user","content":...},"parent_tool_use_id":null}`；`--max-turns`、`--replay-user-messages`。SIGINT 结束当前轮，SIGTERM 退出码 143。
3. **输出**：`text` / `json`（`result`、`session_id`、`total_cost_usd`、`structured_output`（配 `--json-schema`）、`permission_denials`）/ `stream-json`：`system/init`（model、tools、`mcp_servers[{name,status}]`、`mcp_server_errors`）、`assistant` / `user`（含 tool_use / tool_result，`parent_tool_use_id` 区分子 agent）、`stream_event`（需 `--include-partial-messages`）、`system/api_retry`、`permission_denied`、最后 `result`。过程事件完整。
4. **MCP**：stdio、http（Streamable）、sse（废弃）、ws。配置 `.mcp.json` / `~/.claude.json`；命令行 `--mcp-config <文件或JSON>` + `--strict-mcp-config`（只用传入的，适合 Opero 注入）。超时：`MCP_TIMEOUT`（启动，默认 30s）、`MCP_TOOL_TIMEOUT`、每 server `timeout`、`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`。elicitation 支持 form / url；`-p` 下无人应答会取消，可用 `Elicitation` hook 或 SDK `onElicitation` 应答。MCP Apps：`ui://` 资源交给宿主渲染，CLI 不渲染。自己当 server：`claude mcp serve`（只暴露自带工具）。`--permission-prompt-tool mcp__srv__tool` 可把审批交给 Opero 的 MCP 工具。
5. **ACP / SDK**：无原生 ACP；适配器 `@agentclientprotocol/claude-agent-acp`（Apache-2.0，0.109.0，旧包 `@zed-industries/claude-code-acp` 已废弃）。官方 SDK TS / Python。
6. **认证**：订阅登录、`ANTHROPIC_API_KEY`、`apiKeyHelper`、Bedrock、Vertex、Microsoft Foundry、`ANTHROPIC_BASE_URL` 网关（要求 Anthropic Messages 格式，官方不支持经网关接非 Claude 模型）。**条款：未经批准，第三方产品不得提供 claude.ai 登录或使用订阅额度，必须用 API Key。**
7. **权限 / 沙箱**：`--permission-mode` default / acceptEdits / plan / auto / dontAsk / bypassPermissions（2.1.302 起 `-p` 默认 Manual）；`--allowedTools "Bash(git diff *),Read"`、`--disallowedTools`、`--tools`；`--permission-prompts none`（需审批的一律拒绝）。沙箱：Linux bubblewrap / macOS Seatbelt，`sandbox.enabled`，只管 Bash 及子进程，网络按域名白名单。
8. **判断**：最适合，协议成熟、MCP 注入和审批回调齐全；必须走 API Key 计费。

### 2. OpenAI Codex CLI
1. **基本**：开源 Apache-2.0，Rust（codex-rs）。稳定版 0.171.0（2026-11-20），alpha 0.173.0-alpha.4。TS SDK `@openai/codex-sdk`、Python SDK `openai-codex` 同为 0.171.0。
2. **无界面**：`codex exec "..."`，参数 `--json`、`-o/--output-last-message`、`--output-schema`、`-s/--sandbox`、`--skip-git-repo-check`、`--ephemeral`、`-c key=val`、`-m`、`-C`、`--ignore-user-config`；`--full-auto` 已不支持。续会话 `codex exec resume <SESSION_ID>|--last "prompt"`，另有 `exec fork`。常驻：`codex app-server`（默认 stdio JSONL，JSON-RPC 2.0 省略 jsonrpc 字段；也可 WebSocket / unix socket；标 Experimental）。方法：`initialize`、`thread/start|resume|fork`、`turn/start`、`turn/steer`（插话）、`turn/interrupt`、`account/login/start`。`codex app-server generate-ts` / `generate-json-schema` 生成当前版本 schema。`codex mcp-server` 已删除。
3. **输出**：exec `--json`：`thread.started`（thread_id）、`turn.started`、`turn.completed`（usage）、`turn.failed`、`item.started/completed`（item 含 id、type、text/command、status）、`error`。app-server 通知：`item/started`、`item/completed`、`item/agentMessage/delta`、`turn/completed`、`thread/status/changed`。item 类型：agentMessage、reasoning、commandExecution、fileChange、mcpToolCall、webSearch、plan 等。
4. **MCP**：`~/.codex/config.toml` 的 `[mcp_servers.<id>]`：stdio（command/args/env/cwd）、Streamable HTTP（url/bearer_token_env_var/http_headers）；文档没提 SSE。`startup_timeout_sec`（默认 10）、`tool_timeout_sec`（默认 60），`enabled_tools` / `disabled_tools` / `required`。命令行用 `-c 'mcp_servers.x.url="..."'` 注入。elicitation 支持（app-server 发 `mcpServer/elicitation/request`，需 approval_policy granular 里 `mcp_elicitations=true`，否则自动拒绝）。MCP Apps 未查到。不能再当 MCP server。
5. **ACP / SDK**：无原生；适配器 `@agentclientprotocol/codex-acp` v2.8.0（内含 Codex 0.170.0）。官方 SDK TS / Python。
6. **认证**：ChatGPT 登录（浏览器 / device code）、`CODEX_API_KEY` / `codex login --with-api-key`、app-server `apiKey`。第三方模型：`model_providers.<id>` 的 `base_url` / `env_key`，但 `wire_api` 只剩 `responses`，第三方必须兼容 Responses API；`--oss`（ollama / lmstudio）。**条款：ChatGPT 套餐禁止转售或驱动第三方服务**（2026-10 有"Sign in with ChatGPT"合作计划，非通用授权，第三方转引）。
7. **权限 / 沙箱**：`approval_policy` on-request / never / granular；`sandbox_mode` read-only / workspace-write（network_access、writable_roots）/ danger-full-access。app-server 审批请求 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`，回 accept / acceptForSession / decline / cancel。Linux bwrap + seccomp（Ubuntu 24.04 AppArmor 可能挡 userns），macOS Seatbelt。
8. **判断**：很适合，app-server 是正经的双向常驻协议（含插话、中断、审批回调）；注意 Experimental 和 Responses API 限制。

### 3. Gemini CLI（Google）
1. **基本**：开源 Apache-2.0，TS。npm 稳定版 v0.70.0（2026-11-19）。**2026-06-18 起个人免费 / Google One 账号停服**，改推闭源 Antigravity CLI（`agy`）；付费 API Key 和 Code Assist 企业版仍可用（有第三方说"最后稳定版 v0.44.0"，与 npm 不符，以 npm 为准）。
2. **无界面**：`gemini -p "..."`（非 TTY 自动进入）、`-o/--output-format`、`-m`、`--approval-mode`。续会话 `-r/--resume latest|序号|UUID`；无 `--session-id`；能否和 `-p` 同用文档没写。无 stdin 流式输入，常驻走 ACP。SDK 包未发布（`@google/gemini-cli-core` 可当库）。退出码 0 / 1 / 42 / 53。
3. **输出**：text、json（response、stats、error）、stream-json（init、message、tool_use、tool_result、error、result）。
4. **MCP**：settings.json 的 `mcpServers`：command→stdio、`url`→SSE、`httpUrl`→Streamable HTTP；`timeout` 默认 600000ms、`trust`、`includeTools/excludeTools`、`oauth`。**无命令行注入参数**（只有 `--allowed-mcp-server-names` 筛选）。elicitation：v0.33.1 报 Method not found，之后有实现提交，是否发布未查到。MCP Apps、当 MCP server：未查到。
5. **ACP**：原生 `gemini --acp`，客户端可在 session/new 传 MCP server。
6. **认证**：Google 登录、`GEMINI_API_KEY`、Vertex。第三方模型 / 自定义 base URL：官方未查到。订阅条款：未查到。
7. **权限 / 沙箱**：`--approval-mode` default / auto_edit / yolo / plan；`--allowed-tools` 废弃改 Policy Engine。沙箱 docker / podman / Seatbelt / gVisor / lxc。
8. **判断**：协议可用（ACP 走 session/new 也能注入 MCP），但产品前景不明，不优先。

### 4. GitHub Copilot CLI
1. **基本**：闭源，自有许可证（允许把未修改副本作为应用 / 服务的一部分再分发）。稳定版 1.0.114（2026-11-18）。SDK `@github/copilot-sdk` 1.0.34（MIT，GA），覆盖 Node、Python、**Go**、.NET、Java、Rust。语言未查到。
2. **无界面**：`copilot -p "..."`、`-s`、`--no-ask-user`、`--model`、`--autopilot`。续会话 `--resume[=ID]`、`--continue`、`--session-id <UUID>`。常驻：`copilot --acp [--stdio|--port N]`（preview）；SDK（JSON-RPC，spawn 子进程或 `copilot-runtime --server`）；旧 `--server/--headless` 标 legacy。
3. **输出**：`--output-format text|json`（JSONL，`-p` 下字段官方没写全）。SDK / 会话事件：`assistant.turn_start`、`assistant.message`、`tool.execution_start`（toolCallId、toolName、arguments、mcpServerName）、`tool.execution_complete`、`assistant.turn_end`、`session.idle`、`session.error`。
4. **MCP**：`~/.copilot/mcp-config.json` / `.mcp.json`；type local/stdio、http、sse；`tools` 必填；`timeout` 默认 30000ms；OAuth（含无浏览器 client_credentials）。命令行注入 `--additional-mcp-config=<JSON|@文件>`。elicitation 支持 form / URL（第三方转载 changelog）。MCP Apps、当 server：未查到。
5. **ACP / SDK**：原生 `--acp`；官方多语言 SDK。
6. **认证**：GitHub 登录或 `COPILOT_GITHUB_TOKEN` / `GH_TOKEN`（fine-grained PAT 需 Copilot Requests 权限）。**BYOK**：`COPILOT_PROVIDER_BASE_URL`、`COPILOT_PROVIDER_TYPE`（openai / anthropic / azure）、`COPILOT_PROVIDER_API_KEY`、`COPILOT_MODEL`（部分变量名来自第三方），可接 OpenAI 兼容 / 国内模型。订阅对外条款：未查到。
7. **权限 / 沙箱**：`--allow-tool='shell(git:*),write'`、`--deny-tool`、`--available-tools`、`--allow-all`（=yolo）、`--allow-url`。本地沙箱 2026-10-07 GA（文件、网络、凭据代理），`--sandbox` 开启，默认关。
8. **判断**：适合，BYOK + 官方 Go SDK + ACP 都有；`-p` JSONL 字段需实测。

### 5. Cursor CLI（cursor-agent / `agent`）
1. **基本**：Anysphere，闭源。版本 2026.11.19-f005e9d（安装脚本）。`@cursor/sdk` 1.4.2（beta）。语言未查到。
2. **无界面**：`agent -p "..."`、`--output-format`、`--stream-partial-output`、`--model`、`--mode plan|ask`、`--force/--yolo`、`--approve-mcps`、`--api-key`。续会话 `--resume [chatId]`、`--continue`、`create-chat`。无 stdin 流式；常驻用 `agent acp` 或 SDK。团队管理员可关 headless。
3. **输出**：json 只在成功时输出一条 result（失败非零退出 + stderr）；stream-json：`system/init`、`user`、`assistant`、`tool_call`（started / completed，call_id）、`result`；print 模式不出 thinking。
4. **MCP**：和 IDE 共用 `.cursor/mcp.json` / `~/.cursor/mcp.json`，stdio / HTTP / SSE。命令行注入未查到；ACP `session/new` 传 mcpServers 有"被静默忽略"的 bug 报告。elicitation、MCP Apps、超时：未查到。
5. **ACP / SDK**：原生 `agent acp`（含 request_permission、扩展 `cursor/ask_question` 等）；SDK TS / Python（beta）。
6. **认证**：浏览器登录、`CURSOR_API_KEY`、`CURSOR_AUTH_TOKEN`。CLI 能否 BYOK / 自定义 base URL：未查到。条款：未查到。
7. **权限 / 沙箱**：`cli-config.json` 的 `permissions.allow/deny`（`Shell(git)`、`Mcp(server:tool)` 等）；print 模式无 `--force` 时需审批的直接拒绝。沙箱：Linux Landlock + seccomp（内核 ≥6.2），macOS Seatbelt。
8. **判断**：勉强，绑定 Cursor 计费、MCP 注入不可靠。

### 6. Kiro CLI（原 Amazon Q Developer CLI）
1. **基本**：AWS。**Amazon Q Developer CLI 于 2025-11-17 改名 Kiro CLI**，旧仓库 aws/amazon-q-developer-cli（Rust，MIT/Apache-2.0）只修关键安全问题。Kiro CLI 闭源（AWS IP License，第三方）。最新 3.5.0（2026-11-17），3.0 起默认 V3 引擎。语言未查到。
2. **无界面**：`kiro-cli chat --no-interactive "prompt"`（也可 stdin）；`--agent`、`--model`、`--require-mcp-startup`（MCP 起不来退出码 3）。续会话 `--resume-id <ID>` / `--resume`。常驻 `kiro-cli acp`。`KIRO_HEADLESS_WORKFLOW_TIMEOUT_SECS` 默认 21600s。
3. **输出**：`--output-format stream-json`：ACP 形状事件（`tool_call` / `tool_call_update`，第三方），成功 `runFinished`（finalText、sessionId），失败 `runError`。
4. **MCP**：`.kiro/settings/mcp.json`、`~/.kiro/settings/mcp.json`、agent 配置 `mcpServers`；stdio / 远程 HTTP(SSE)；`timeout` / `timeoutMs`（连接超时）；`autoApprove`、`disabledTools`。elicitation 支持。MCP Apps、当 server：未查到。
5. **ACP**：原生，`session/new` 带 `mcpServers`。无官方 agent SDK。
6. **认证**：headless 必须 `KIRO_API_KEY`，只有 Pro / Pro+ / Pro Max / Power 订阅才有；模型由平台提供（含 Claude、GPT、Kimi、DeepSeek、GLM、Qwen 等）。BYOK、对外服务条款：未查到。
7. **权限 / 沙箱**：`--trust-all-tools`、`--trust-tools=a,@server/tool`；V3 `permissions.yaml`。沙箱默认关，`sandbox.json` 开启（Linux bwrap / macOS Seatbelt）。
8. **判断**：协议上适合（ACP），但闭源、绑定 Kiro 付费账号。

### 7. OpenCode
1. **基本**：原 SST，仓库已转到 anomalyco/opencode，MIT，TS/Bun。两条线：v2.3.2（2026-11-18）和 GitHub 标 Latest 的 v1.19.6（2026-11-17）。**2.0 是大改**：配置变 `opencode.jsonc`、MCP 在 `mcp.servers`、SDK 改名 `@opencode/sdk`。
2. **无界面**：`opencode run "..."`，`--format json`、`-m provider/model`、`--agent`、`-c` / `-s ID`、`--fork`、`--auto`（批准所有未明确拒绝的权限）（参数来自第三方速查表）。常驻：`opencode serve` HTTP API（`POST /api/session`、`POST /api/session/{id}/prompt`、SSE `GET /api/event`、`POST /api/session/{id}/permission/{requestID}/reply`，OpenAPI 在 `/docs/openapi.json`）。SSE 易失：慢消费会溢出、断线丢事件。
3. **输出**：run JSONL 每行 `type`、`timestamp`、`sessionID`、`part`；类型 `step_start`、`tool_use`、`text`、`step_finish`（cost、tokens）。SSE：`session.text.delta`、`permission.asked`、`session.idle` 等。
4. **MCP**：`type:"local"`（stdio）/ `type:"remote"`（Streamable HTTP），无 SSE。`mcp.timeout` 可每 server 覆盖：startup 30s、catalog 30s、**execution 12h**（适合长时间工具）。elicitation 支持 form / URL。MCP Apps 不支持（issue #10884）。当 server：未查到。
5. **ACP / SDK**：原生 `opencode acp`（load / resume / fork / list / close）；TS SDK；Python 未查到。
6. **认证**：`providers` 里配 openai-compatible + `baseURL`，可接任意 OpenAI 兼容 / 国内模型；ChatGPT Plus/Pro 登录、Copilot OAuth、自家 OpenCode Go 订阅。对外服务条款：未查到。
7. **权限 / 沙箱**：`permissions` 规则（action / resource / effect=allow|ask|deny），按 agent 配置；**没有沙箱**。
8. **判断**：很适合（开源 + 任意模型 + serve / ACP）；2.x 变化快，要锁版本。

### 8. Aider
1. **基本**：Aider-AI，Apache-2.0，Python。PyPI 0.86.2（2026-02-12）；main 约 2026-05 后无合并（第三方），**基本停更**。社区分叉 cecli（原 aider-ce）加了 MCP。
2. **无界面**：`--message/-m`、`--message-file`、`--yes-always`、`--no-auto-commits`；续会话只有 `--restore-chat-history`；无 server，只有非官方 Python API。
3. **输出**：纯文本。
4. **MCP**：不支持。
5. **ACP**：未查到。
6. **认证**：各家 API Key，`--openai-api-base`。
7. **权限**：只有 `--yes-always`；无白名单 / 沙箱；默认自动 git commit。
8. **判断**：不适合。

### 9. Goose
1. **基本**：Block 发起，现归 Linux Foundation 下 AAIF（仓库 aaif-goose/goose），Apache-2.0，Rust。v1.60.2（2026-11-20）。正在迁到 ACP 架构；旧 goosed REST server 据第三方已删。
2. **无界面**：`goose run -t "..."`、`-i file|-`、`--max-turns`、`--provider`、`--model`、`--with-extension`、`--with-streamable-http-extension`、`--recipe`。续会话 `goose run -n <name> -r`。常驻：`goose acp`（stdio）、`goose serve`（ACP over HTTP/WS，127.0.0.1:3284，需 `GOOSE_SERVER__SECRET_KEY`）。
3. **输出**：`--output-format text|json|stream-json`；事件 message / notification / complete / error，content 含 text、toolRequest、toolResponse（官方无 schema，第三方解析）。
4. **MCP**：扩展即 MCP server，stdio / Streamable HTTP；elicitation（form）支持；**MCP Apps（ui://）v1.25 起支持**（桌面端 iframe）。工具超时字段：未查到。`goose mcp <name>` 只是跑内置 server。
5. **ACP / SDK**：原生（主接口），还能反过来把 Claude Code / Codex 当 ACP provider；TS 客户端、Python 绑定（alpha）。
6. **认证**：`GOOSE_PROVIDER` / `GOOSE_MODEL`，OpenAI 兼容（`OPENAI_HOST`），自定义 provider JSON（可接 DeepSeek、Kimi）。
7. **权限 / 沙箱**：`GOOSE_MODE` auto / approve / smart_approve / chat，按工具 Always / Ask / Never；smart_approve 绕过 ask 规则（issue #11017）；无 OS 级沙箱。
8. **判断**：很适合，开源、模型最灵活、ACP 原生。

### 10. Crush（Charm）
1. **基本**：charmbracelet，FSL-1.1-MIT（源码公开，延期转 MIT），Go。v0.102.0（2026-11-19）。
2. **无界面**：`crush run "..."`（或 stdin），`-q`、`-m`、`-s <id>`、`-C`；v0.102 起 run 自动批准自己会话的权限。常驻 `crush serve`（REST + SSE，unix socket / tcp），`CRUSH_PERMISSIONS_PIPED=1` 让宿主回答权限。
3. **输出**：run 只有纯文本；SSE 事件无文档。
4. **MCP**：stdio / http / sse，OAuth；超时字段名未查到；elicitation、MCP Apps、当 server：未查到。
5. **ACP**：不支持（issue #990）。无 SDK。
6. **认证**：provider type completions / responses / messages + base_url；内置 Z.ai、MiniMax、Moonshot、阿里。
7. **权限**：`--yolo`、allow / deny 工具名；沙箱未查到。
8. **判断**：一般，缺结构化输出和 ACP。

### 11. Amp（Sourcegraph）
1. **基本**：闭源；npm `@sourcegraph/amp` 滚动版本（约 2026-11-21），无语义版本号。语言未查到。
2. **无界面**：`amp -x "..."`（stdout 重定向自动进入），`--mcp-config '<json>'`；续会话 `amp threads continue [id] -x`；常驻：`--stream-json-input` 从 stdin 持续读 JSONL，支持 `steer:true` 插话。TS SDK `@ampcode/sdk`（`execute()`，底层起 CLI）。
3. **输出**：`--stream-json`，尽量兼容 Claude Code（system/init、assistant、user、result、system/subagent_finished）。
4. **MCP**：`amp.mcpServers` 本地 / 远程 URL；`--mcp-config` 传入的免审批；OAuth；elicitation 支持（10 分钟超时）；MCP Apps 文档提到未详述；工具超时、当 server：未查到。
5. **ACP**：官方不做；社区 amp-acp。
6. **认证**：`AMP_API_KEY`，按 credits 计费（无加价）；BYOK / 订阅接入的配置未查到；条款：不得转售额度。
7. **权限**：`amp.permissions` allow / reject / ask / delegate（交给外部程序判断）；`--dangerously-allow-all`；本地沙箱未查到。
8. **判断**：协议好接（Claude Code 兼容），但闭源 + 绑定 Amp 计费。

### 12. Qwen Code（阿里通义）
1. **基本**：开源 Apache-2.0，TS（Node 22+），源自 Gemini CLI v0.8.2，现已独立开发。v0.28.3（2026-11-21），活跃。
2. **无界面**：`qwen -p "..."`；续会话 `--continue` / `--resume <sessionId>`；`--max-session-turns`、`--max-tool-calls`、`--max-wall-time`。常驻三条路：`--input-format stream-json --output-format stream-json`；`--acp`；`qwen serve --no-web`（实验 HTTP + SSE，127.0.0.1:4170，`QWEN_SERVER_TOKEN`）。
3. **输出**：`-o text|json|stream-json`；事件 `system`（session_start）、`assistant`（含 `parent_tool_use_id`）、`result`；`--include-partial-messages` 出 `stream_event`。与 Claude Code 很像。
4. **MCP**：stdio（command）、SSE（url）、Streamable HTTP（httpUrl）；`timeout` 默认 600000ms；`qwen mcp add`。**elicitation 未支持**（PR #17358 只做声明 + 自动拒绝）。MCP Apps：官方未明确支持（issue #8968）。SDK 里带 `qwen-serve-mcp`（把运行中的 qwen serve 暴露成 MCP server）。命令行一次性注入 MCP 配置的参数：未查到（可通过工作目录 settings.json 或 ACP session/new 注入）。
5. **ACP / SDK**：原生 `--acp`；TS `@qwen-code/sdk`（含 DaemonClient）、Python、Java SDK。
6. **认证**：Qwen OAuth 免费档 2026-04-15 已停；`OPENAI_API_KEY/BASE_URL/MODEL`、`ANTHROPIC_*`、`GEMINI_*`、`modelProviders`，百炼。**百炼 Coding Plan 条款禁止自动化脚本 / 应用后端 / 非交互批量调用**，要用按量 API Key。
7. **权限 / 沙箱**：`--approval-mode plan|default|auto-edit|auto|yolo`；`--allowed-tools`、`--exclude-tools`、`permissions.allow/deny`；沙箱 docker / podman / Seatbelt，Linux 还有 bwrap / Landlock。
8. **判断**：很适合，国内模型友好、协议接近 Claude Code；缺 elicitation。

### 13. Kimi CLI → Kimi Code CLI（月之暗面）
1. **基本**：旧 MoonshotAI/kimi-cli（Python）**已归档**，最后 1.52.0（2026-09-22）。后继 **Kimi Code CLI**（MoonshotAI/kimi-code，MIT，TS，npm `@moonshot-ai/kimi-code`，命令 `kimi`）v2.7.2（2026-11-20）。注意 PyPI 的 `kimi-code` 是旧版别名。
2. **无界面**：`kimi -p "..."`（print 默认自动审批）；退出码 4 = 会话被别的进程占用。续会话 `-S/--session <id>`、`-c`。常驻 `kimi acp`；`kimi web`（REST + WS，API 无文档）。无 stdin 流式输入（未查到）。
3. **输出**：`--output-format text|stream-json`；能确认的字段 role、content、tool_calls、type、session_id（`session.resume_hint` 行）；**thinking 和工具进度走 stderr**；完整 schema 未查到。
4. **MCP**：stdio / HTTP / legacy SSE；`~/.kimi-code/mcp.json` / `.kimi-code/mcp.json`；`startupTimeoutMs`（默认 30000）、**`toolTimeoutMs`**、`enabledTools`。无 `--mcp-config`（issue #1971）。elicitation、MCP Apps、当 server：未查到。
5. **ACP / SDK**：原生 `kimi acp`；`kimi-agent-sdk`（Apache-2.0，**含 Go**、Node、Python），但它对新 TS 版的兼容性未核实。
6. **认证**：Kimi 会员 OAuth 或 Moonshot API Key；`config.toml` `[providers]` 支持 openai / anthropic / bedrock / vertex 等 + base_url。会员 key 可接第三方工具（不许改 UA）；能否对外提供服务未查到明确条款。
7. **权限**：`--yolo`、`--auto`、`--plan`；`[[permission.rules]]`；CLI 沙箱未查到。
8. **判断**：比较适合（走 ACP），刚重写、变化快，要锁版本。

### 14. iFlow CLI（心流）
**已停**：2026-03-20 停止维护，2026-04-17 停服，官方让迁 Qoder。最后 0.5.17（2026-03-11）。曾有 `-p`、`--resume`、ACP、MCP、Python/Java/TS SDK。许可证未查到。**不要用。**

### 15. 腾讯 CodeBuddy Code
1. **基本**：腾讯云，npm `@tencent-ai/codebuddy-code`，命令 `codebuddy`。官方源码仓库没找到，许可证 / 语言未查到（按闭源看）。文档发布记录最新 v2.184.0（搜索结果称 npm 2.185.0，未亲自核实）。
2. **无界面**：`codebuddy -p`，`--output-format text|json|stream-json`、`--input-format text|stream-json`、`--include-partial-messages`、`--json-schema`。续会话 `-c`、`-r <id>`、`--session-id <uuid>`。常驻：stdin stream-json 长连；`--acp`；`--serve`（Web UI）；Agent SDK。
3. **输出**：**官方声明 wire 格式对齐 Claude Code 2.1.220 stream-json**：system（init、usage_update、task_*）、assistant、user、result、control_response；stdin 收 control_request（initialize、interrupt）和 user。`--permission-prompt-tool` 不支持。
4. **MCP**：stdio / SSE / HTTP；`--mcp-config`、`--strict-mcp-config`；`-p` 下项目级 server 需预批准。**MCP Apps（ui://）只在 Web UI 渲染**，`-p` 退化为文本。elicitation、工具超时、当 server：未查到。
5. **ACP / SDK**：原生 `--acp`；TS `@tencent-ai/agent-sdk`、Python `codebuddy-agent-sdk`（Preview）。
6. **认证**：交互登录或 `CODEBUDDY_API_KEY` + `CODEBUDDY_INTERNET_ENVIRONMENT`（国内 internal 等），企业 `CODEBUDDY_AUTH_TOKEN`，`CODEBUDDY_BASE_URL`。任意 OpenAI 兼容模型、对外服务条款：未查到。
7. **权限 / 沙箱**：`--permission-mode default|acceptEdits|plan|bypassPermissions`、`--allowedTools`；`-p` 需 `-y`，高危命令仍可能要确认（无人值守时的坑）；Bash 沙箱 bubblewrap / Seatbelt。
8. **判断**：国内首选之一，Claude Code 驱动器几乎可直接复用；闭源，高危确认要实测。

### 16. Factory Droid
1. **基本**：Factory，闭源（未查到开源许可）。CLI v1.16.0（2026-11-20），几乎每日发版。
2. **无界面**：`droid exec "..."`（或 `-f` / stdin），`--cwd`、`-m`、`-w/--worktree`。续会话 `-s/--session-id`、`--fork`。常驻：`--input-format stream-jsonrpc --output-format stream-jsonrpc`（方法 `droid.initialize_session`、`droid.add_user_message`；推送 `droid.session_notification`；反向请求 `droid.request_permission`、`droid.ask_user`；支持中断、改设置、管 MCP）。
3. **输出**：`-o text|json|stream-json|stream-jsonrpc|acp`；json 含 result、session_id、usage；stream-json：system、message、tool_call、tool_result、completion。退出码 0 只代表跑完。
4. **MCP**：stdio / http / sse；`~/.factory/mcp.json`、`droid mcp add`；每 server `timeout`（单次工具，ms）和 `connectTimeout`；elicitation 支持。MCP Apps、当 server：未查到。
5. **ACP / SDK**：原生 `-o acp`（比 stream-jsonrpc 窄，第三方）；TS `@factory/droid-sdk`、Python `droid-sdk`。
6. **认证**：`FACTORY_API_KEY`；BYOK `customModels`（baseUrl、apiKey、provider）。对外条款：未查到。
7. **权限 / 沙箱**：默认只读，`--auto low|medium|high` 分级，越级非零退出；`--skip-permissions-unsafe`；沙箱 per-command / whole-process（可把 MCP 子进程也隔离），文件 / 网络白名单。
8. **判断**：协议能力最全之一，适合；闭源。

### 17. Augment Auggie CLI
1. **基本**：Augment Code，专有许可（需订阅），Node ≥22。稳定 0.36.0，预发布 1.3.0-prerelease（2026-11-20）。
2. **无界面**：`auggie --print "..."`、`--mode text|stream|json`；续会话 `-c`、`--session`；常驻 `--acp`。企业合同可能没开通非交互模式。
3. **输出**：json 字段未查到；ACP 事件。
4. **MCP**：stdio / http / sse；`--mcp-config`（可重复）；elicitation、MCP Apps、超时未查到；`--mcp` 当 server 在 1.x 已移除。
5. **ACP / SDK**：原生；TS / Python SDK。
6. **认证**：Augment 登录 / `AUGMENT_SESSION_AUTH` / Service Account；只能用托管模型，无 BYOK。
7. **权限**：`toolPermissions`（allow / deny / ask-user / webhook-policy / script-policy）；无界面时 ask-user 直接拒绝。沙箱未查到。
8. **判断**：中等，能 ACP 常驻但闭源、无 BYOK。

### 18. Cline CLI
1. **基本**：Cline Bot Inc.，Apache-2.0，TS。cli-v3.0.75（2026-11-21），基于 `@cline/sdk` 重写。
2. **无界面**：`cline --json "task"`（管道自动无界面），**默认 `--auto-approve true`**；`-m`、`-P`、`-k`、`-t/--timeout`、`--worktree`。续会话 `--id`。常驻 `--acp`、`cline hub`（端口 25463）、`@cline/sdk`。
3. **输出**：NDJSON：`agent_event`（content_start/update/end、iteration_*、usage、done、error）、`hook_event`、`run_result`、`run_aborted`。
4. **MCP**：stdio / sse / streamableHttp（**不写 type 默认 sse**）；`autoApprove`、每 server 超时（第三方）；elicitation 不支持（discussion #4522）；MCP Apps、当 server：未查到。
5. **ACP / SDK**：原生（ACP 模式默认不自动批准）；TS SDK。
6. **认证**：完全 BYOK，`cline auth -p -k -m -b <baseurl>`，OpenAI 兼容。
7. **权限**：`--auto-approve`、hooks；`CLINE_SANDBOX` 细节未查到。
8. **判断**：适合（开源 + BYOK + ACP），务必显式关 auto-approve。

### 19. Continue CLI（cn）
**已停更**：2026-06-18 Continue 被 Cursor 收购，仓库只读，Hub / `cn login` 下线；最后 `@continuedev/cli` 1.5.47。曾有 `cn -p`、`--resume`、`cn serve`、YAML MCP。**不建议。**

### 20. 其它
- **Qoder CLI（阿里，`qodercli`）**：iFlow 迁移目标。`-p`、`-o text|json|stream-json`、`--input-format stream-json`、`--session-id`、`--acp`、`--permission-mode`、`--allowed-tools`；`QODER_PERSONAL_ACCESS_TOKEN`，按 credits；第三方实测 stream-json 是 Claude Code 形状。许可、MCP 细节未查到，值得再查。
- **MiniMax Code（`mcode`）**：MIT，TS，`@minimax-ai/code` 0.6.9；`mcode exec`、`mcode acp`、`@minimax-ai/code-sdk`；`mcode provider add --base-url`（openai / anthropic 格式）。输出格式未查到。
- **智谱 ZCode（zai-org/ZCode）**：Apache-2.0，2026-09-20 开源，无预编译 CLI 包；headless / MCP / ACP 未查到。
- **字节 Trae Agent（`trae-cli run`）**：MIT，Python，最后提交约 2026-02，基本不活跃；商业 TRAE 无官方 CLI。
- **百度 Comate CLI（`comatecli run -q`）**：预览版，设备码登录；输出 / MCP / ACP 未查到。
- **DeepSeek**：没查到官方 CLI，只有社区项目（DeepSeek-TUI 等）。
- **Mistral Vibe**：Python，许可未确认，v3.1.4；`vibe -p --output text|json|streaming`、`--max-turns/--max-price`、`vibe-acp`、`MISTRAL_API_KEY`。
- **JetBrains Junie CLI**：闭源，2026-06-17 GA；`--output-format json-stream`、`--acp true`、`JUNIE_API_KEY`；第三方称 stdout 总带颜色、`--plan` 在无界面下拦不住改文件。
- **Kilo Code CLI**：OpenCode 的 fork（MIT，第三方），`kilo run --format json --auto`、`kilo serve`；ACP 未查到。
- **Warp → Oz CLI**：`oz agent run --output-format ndjson`，闭源，会话在 Warp 后端。
- **已停 / 关停**：OpenHands CLI（官方写明不再维护，改推 Software Agent SDK）、Roo Code（2026-05-15 关停）、Plandex（2025-07 后无新版、云服务已关）、iFlow、Continue、旧 Kimi CLI、Aider（实际停更）。

---

## ACP 规范要点（Go Agent 实现 ACP 客户端时用）

- **仓库**：agentclientprotocol/agent-client-protocol（Apache-2.0，原属 Zed）。`protocolVersion` = 1，可选能力靠 capabilities 协商。
- **传输**：目前只定义 stdio，JSON-RPC 2.0，按换行分帧。远程 Streamable HTTP 仍在 RFD 草案。
- **Agent 端方法**：`initialize`、`authenticate`、`session/new`、`session/prompt`；可选 `session/load`（回放历史）、`session/resume`（不回放）、`session/list`、`session/close`、`session/set_mode`、`session/set_config_option`；通知 `session/cancel`（agent 以 `stopReason: cancelled` 结束本轮）。
- **Client 端方法（我们要实现）**：`session/request_permission`（options kind = allow_once / allow_always / reject_once / reject_always）；可选 `fs/read_text_file`、`fs/write_text_file`、`terminal/*`；`elicitation/create`（form / url，2026-07-22 稳定）。
- **事件** `session/update` 的 `sessionUpdate`：`agent_message_chunk`、`agent_thought_chunk`、`tool_call`、`tool_call_update`（toolCallId、title、kind、status=pending/in_progress/completed/failed、rawInput、rawOutput）、`plan`、`usage_update`、`current_mode_update` 等。
- **stopReason**：end_turn、max_tokens、max_turn_requests、refusal、cancelled。
- **MCP 注入**：`session/new|load|resume` 都带 `mcpServers`：stdio（name、command、args、env）必须支持；http（type、url、headers）看 `mcpCapabilities.http`；sse 已弃用。RFD「MCP-over-ACP」（client 直接在 ACP 连接上提供 MCP 工具）还是不稳定草案。
- **SDK**：官方 TS、Python、Rust、Kotlin、Java；**Go 无官方**，社区 `github.com/coder/acp-go-sdk`（据 fork 方说法上游 2026-06 后没发版，有 fork 在维护）——协议不大，也可自己写。

---

## 对 Opero 执行器适配层的建议

### 统一抽象（Go 接口草案）

```go
type Executor interface {
    Start(ctx, StartOpts) (Session, error) // 起进程：工作目录、模型、权限模式、MCP 注入、认证注入、续会话 id
}
type Session interface {
    ID() string                         // 执行器自己的 session/thread id，存库，用来 resume
    Send(ctx, Message) error            // 发一条用户消息（新一轮）
    Steer(ctx, Message) error           // 插话：本轮进行中追加（不支持的降级为 Interrupt + Send）
    Interrupt(ctx) error                // 停止当前轮，会话保留
    Close(ctx) error                    // 结束进程（SIGTERM → 超时 SIGKILL）
    Events() <-chan Event               // 统一事件流
    Respond(ctx, reqID string, Decision) error // 回答审批 / elicitation 请求
}
```

- **统一事件**（各驱动器自己翻译）：`session_started{session_id, model, mcp_status}`、`text_delta`、`message`、`thinking`、`tool_call_started{id, name, input, mcp_server}`、`tool_call_finished{id, output, is_error}`、`permission_request{id, tool, input, options}`、`elicitation_request`、`usage{tokens, cost}`、`turn_done{stop_reason, result}`、`error{retryable}`、`process_exit{code}`。原始行另存一份日志，便于排查。
- **三个驱动器就够覆盖绝大多数**：
  1. **stream-json 驱动**（Claude Code 系）：Claude Code、CodeBuddy、Qwen Code、Qoder、Amp（字段小差异用 profile 处理）。
  2. **ACP 驱动**（通用）：Goose、OpenCode、Copilot、Kiro、Kimi Code、Cline、Droid、Auggie、Gemini、Cursor、Junie、Vibe、MiniMax，以及经适配器的 Claude / Codex。
  3. **Codex app-server 驱动**：Codex（官方首推、能力最全；ACP 适配器作备选）。
- **MCP 注入**：Opero 后台提供一个 Streamable HTTP MCP 端点，按"员工 + 会话"签发短期 token 放在 header 里（headers 字段大家都支持）。注入方式：Claude / CodeBuddy 用 `--mcp-config` + `--strict-mcp-config`；Codex 用 `-c mcp_servers.opero.url=...` 或 app-server 启动前写隔离的 `CODEX_HOME/config.toml`；ACP 系在 `session/new` 的 `mcpServers` 里传；其余写进隔离的工作区配置文件。长工具：统一把各家工具超时调大（Claude `MCP_TOOL_TIMEOUT`、Codex `tool_timeout_sec`、OpenCode `execution`、Kimi `toolTimeoutMs`、Droid `timeout`），超长任务最好改成"立即返回任务 id + 轮询"模式，不依赖超时设置。
- **认证注入**：只用环境变量 / 隔离配置目录注入 API Key（`ANTHROPIC_API_KEY`、`CODEX_API_KEY`、`OPENAI_API_KEY/BASE_URL` 等），每个员工独立 HOME / 配置目录（`CLAUDE_CONFIG_DIR`、`CODEX_HOME` 之类），不共用登录态；不把个人订阅登录当成默认方案（条款风险）。
- **权限**：执行器内部开"需审批就回调"模式，审批请求翻译成 `permission_request` 发到 Opero 聊天里让人点；或者由 Opero 策略自动批。配合执行器自带沙箱（bwrap 等）或容器隔离。不要用 yolo / bypass 当默认。

### 第一批建议支持
1. **Claude Code（stream-json 驱动）**：已定，协议最成熟，MCP 注入 / 审批回调 / elicitation hook 都有。
2. **Codex（app-server 驱动）**：已计划；开源、有插话（turn/steer）、中断、审批和 elicitation 回调。
3. **OpenCode（ACP 驱动）**：开源 MIT、能接任意 OpenAI 兼容 / 国内模型，给不用 Claude / OpenAI 的用户一条路；同时把 ACP 通用驱动做出来，后面接 Goose、Copilot、Kimi Code、Kiro、Cline、Droid 基本是配置活。
4. **Qwen Code（复用 stream-json 驱动，或走 ACP）**：国内模型首选开源方案，改动小。

第二批：Goose、GitHub Copilot CLI（BYOK + 官方 Go SDK）、腾讯 CodeBuddy（复用 stream-json）、Kimi Code、Cline、Factory Droid。
不建议：Aider、Continue、iFlow、Roo Code、OpenHands CLI、Plandex（停更 / 关停）；Gemini CLI、Cursor CLI 暂缓。

## 待确认（没查实的点）
- 各家订阅能否用于"给第三方提供服务"：只查实了 Anthropic、OpenAI、阿里百炼 Coding Plan（都不允许）；Copilot、Cursor、Kiro、Kimi、CodeBuddy、Amp 等未查到明确条款。
- Copilot CLI `-p --output-format json` 的完整字段、Kimi Code stream-json schema、Auggie json 字段、Goose stream-json schema：官方无文档，需要实测。
- Codex `mcp-server` 删除的具体版本号（0.154.0）来自第三方转引。
- Cursor ACP 模式 `session/new` 传 mcpServers 被忽略是 bug 报告，是否已修未查到。
- Gemini CLI elicitation 是否已发布、CodeBuddy 的许可证和工具超时变量名、Qoder CLI 的许可和 MCP 细节：未查到。
- Qwen Code 是否有命令行一次性注入 MCP 配置的参数：未查到。

## 资料链接（查询日期 2026-11-21）

**Claude Code**：https://code.claude.com/docs/en/headless ・ https://code.claude.com/docs/en/cli-reference ・ https://code.claude.com/docs/en/mcp ・ https://code.claude.com/docs/en/agent-sdk/overview ・ https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode ・ https://code.claude.com/docs/en/sandboxing ・ https://code.claude.com/docs/en/llm-gateway ・ https://github.com/anthropics/claude-code/releases ・ https://github.com/anthropics/claude-agent-sdk-typescript/releases ・ https://github.com/anthropics/claude-agent-sdk-python/releases ・ https://github.com/zed-industries/claude-agent-acp/releases

**Codex**：https://github.com/openai/codex ・ https://github.com/openai/codex/releases ・ https://learn.chatgpt.com/docs/non-interactive-mode ・ https://learn.chatgpt.com/docs/app-server ・ https://learn.chatgpt.com/docs/codex-sdk ・ https://learn.chatgpt.com/docs/extend/mcp?surface=cli ・ https://learn.chatgpt.com/docs/config-file/config-reference ・ https://learn.chatgpt.com/docs/permissions ・ https://github.com/agentclientprotocol/codex-acp/releases ・ https://www.developersdigest.tech/blog/codex-mcp-server-removed（第三方）

**Gemini CLI**：https://github.com/google-gemini/gemini-cli/releases ・ https://geminicli.com/docs/cli/headless/ ・ https://geminicli.com/docs/tools/mcp-server/ ・ https://geminicli.com/docs/cli/acp-mode/ ・ https://geminicli.com/docs/cli/sandbox/ ・ https://geminicli.com/docs/get-started/authentication/ ・ https://www.theregister.com/ai-ml/2026/05/20/bye-bye-gemini-cli-google-nudges-devs-toward-antigravity/5243605

**Copilot CLI**：https://github.com/github/copilot-cli/releases ・ https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference ・ https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference ・ https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server ・ https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/streaming-events ・ https://github.com/github/copilot-sdk ・ https://github.blog/changelog/2026-10-07-local-sandboxing-for-github-copilot-now-generally-available/

**Cursor CLI**：https://cursor.com/docs/cli/headless ・ https://cursor.com/docs/cli/reference/output-format ・ https://cursor.com/docs/cli/reference/parameters ・ https://cursor.com/docs/cli/mcp ・ https://cursor.com/docs/cli/acp ・ https://cursor.com/docs/cli/reference/permissions ・ https://cursor.com/docs/sdk/typescript

**Kiro / Q CLI**：https://kiro.dev/docs/cli/headless/ ・ https://kiro.dev/changelog/cli/ ・ https://kiro.dev/docs/cli/acp/ ・ https://kiro.dev/docs/mcp/configuration/ ・ https://kiro.dev/docs/sandbox/ ・ https://github.com/aws/amazon-q-developer-cli

**OpenCode**：https://github.com/anomalyco/opencode ・ https://opencode.ai/docs/cli/ ・ https://opencode.ai/docs/server/ ・ https://opencode.ai/docs/sdk/ ・ https://opencode.ai/docs/mcp-servers/ ・ https://opencode.ai/docs/acp/ ・ https://opencode.ai/docs/providers/ ・ https://opencode.ai/docs/permissions/

**Aider**：https://aider.chat/docs/scripting.html ・ https://pypi.org/project/aider-chat/ ・ https://github.com/Aider-AI/aider/releases

**Goose**：https://github.com/aaif-goose/goose ・ https://goose-docs.ai/docs/guides/running-tasks/ ・ https://goose-docs.ai/docs/guides/goose-cli-commands/ ・ https://goose-docs.ai/docs/guides/mcp-elicitation/ ・ https://goose-docs.ai/docs/tutorials/building-mcp-apps/

**Crush**：https://github.com/charmbracelet/crush ・ https://github.com/charmbracelet/crush/issues/990

**Amp**：https://ampcode.com/docs/cli/streaming-json ・ https://ampcode.com/docs/cli/execute-mode ・ https://ampcode.com/docs/sdk ・ https://ampcode.com/docs/customize/mcp ・ https://ampcode.com/terms ・ https://github.com/zed-industries/zed/discussions/37885

**Qwen Code**：https://github.com/QwenLM/qwen-code ・ https://qwenlm.github.io/qwen-code-docs/en/users/features/headless/ ・ https://qwenlm.github.io/qwen-code-docs/en/developers/tools/mcp-server/ ・ https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/ ・ https://qwenlm.github.io/qwen-code-docs/en/users/qwen-serve/ ・ https://help.aliyun.com/zh/model-studio/coding-plan

**Kimi**：https://github.com/MoonshotAI/kimi-cli ・ https://github.com/MoonshotAI/kimi-code ・ https://moonshotai.github.io/kimi-code/en/reference/kimi-command ・ https://moonshotai.github.io/kimi-code/en/customization/mcp.html ・ https://github.com/MoonshotAI/kimi-agent-sdk

**iFlow / Qoder**：https://github.com/iflow-ai/iflow-cli ・ https://platform.iflow.cn/en/cli/changelog ・ https://docs.qoder.com/zh/cli/run-in-scripts

**CodeBuddy Code**：https://www.codebuddy.ai/docs/cli/headless ・ https://www.codebuddy.ai/docs/cli/workflow-stdio-protocol ・ https://www.codebuddy.ai/docs/cli/mcp ・ https://www.codebuddy.ai/docs/cli/mcp-apps ・ https://www.codebuddy.ai/docs/cli/acp ・ https://www.codebuddy.ai/docs/cli/sdk ・ https://www.codebuddy.ai/docs/cli/env-vars

**Factory Droid**：https://docs.factory.com/cli/droid-exec/overview ・ https://docs.factory.com/cli/configuration/mcp ・ https://docs.factory.ai/cli/configuration/sandbox ・ https://docs.factory.com/changelog/release-notes

**Auggie**：https://docs.augmentcode.com/cli/reference ・ https://docs.augmentcode.com/cli/acp/agent ・ https://docs.augmentcode.com/cli/sdk.md ・ https://github.com/augmentcode/auggie

**Cline**：https://docs.cline.bot/cline-cli/cli-reference ・ https://docs.cline.bot/cline-cli/acp-editor-integrations ・ https://docs.cline.bot/sdk/overview ・ https://github.com/cline/cline/releases/tag/cli-v3.0.75

**Continue / 其它**：https://github.com/continuedev/continue ・ https://docs.openhands.dev/openhands/usage/cli/command-reference ・ https://github.com/plandex-ai/plandex/releases ・ https://kilo.ai/docs/code-with-ai/platforms/cli ・ https://docs.mistral.ai/vibe/code/cli/work-with-cli ・ https://junie.jetbrains.com/docs/parameters.html ・ https://github.com/MiniMax-AI/minimax-code ・ https://github.com/bytedance/trae-agent ・ https://cloud.baidu.com/doc/COMATE/s/0mrcv8nsa

**ACP**：https://agentclientprotocol.com/protocol/overview ・ https://agentclientprotocol.com/protocol/session-setup ・ https://agentclientprotocol.com/protocol/prompt-turn ・ https://agentclientprotocol.com/protocol/tool-calls ・ https://agentclientprotocol.com/rfds/mcp-over-acp ・ https://agentclientprotocol.com/get-started/agents ・ https://github.com/agentclientprotocol/agent-client-protocol ・ https://github.com/coder/acp-go-sdk
