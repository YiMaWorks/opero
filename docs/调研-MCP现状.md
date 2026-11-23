# 调研：MCP 现状（给 Opero 的 MCP 底层设计用）

> 查询日期：2026-11-21。全部来自官方文档 / 官方仓库 / 官方 issue，链接附在每条后面。
> 第三方博客只用来找线索，结论没有用它们当依据。

---

## 0. 先看结论（会影响设计的）

| # | 事实 | 对 Opero 的影响 |
|---|---|---|
| 1 | 现行正式版是 **2026-07-28**，**无状态**：取消 `initialize` 握手和 `Mcp-Session-Id`，每个请求在 `_meta` 里带版本和客户端能力；新增必须实现的 `server/discover` | Opero server 按无状态设计，跨调用状态用自己发的句柄（作为工具参数传）；同时要兼容 2025-11-25 及以前的握手式客户端 |
| 2 | 服务器主动发请求（elicitation / sampling / roots）改成 **MRTR**：工具调用直接返回 `resultType:"input_required"` + `inputRequests`，客户端补齐信息后**用新 id 重发原请求**，带上 `inputResponses` 和原样的 `requestState` | 审批、补参数这类交互要按 MRTR 写；`requestState` 必须做签名 / 加密（规范要求视为攻击者可控） |
| 3 | **Tasks 已移出核心，成为官方扩展 `io.modelcontextprotocol/tasks`（SEP-2663，Final）**：`tools/call` 可直接回 `resultType:"task"`，客户端用 `tasks/get` 轮询，`tasks/update` 补输入，`tasks/cancel` 取消 | 长任务走 Tasks。**Claude Code 已支持（公测，v2.1.304+）**，**Codex 不支持** |
| 4 | Claude Code `-p` 无界面：elicitation **没有对话框**。没配 `Elicitation` hook 时，请求一直挂到工具超时；加 `--permission-prompts none` 则直接取消；**Task 里的 elicitation 在无界面时一律让服务器取消任务，hook 也不跑** | Opero 不能指望 CLI 执行器在无界面时把 elicitation 转给人。应该**由 Opero 自己的网页 / 安卓端去收集用户输入**（比如工具先返回「待审批」，审批完再继续），或者给执行器配 `Elicitation` 命令 hook，由 hook 去问 Opero 后台（hook 默认超时 600 秒） |
| 5 | Claude Code 工具调用时长：总上限 `MCP_TOOL_TIMEOUT` 默认约 28 小时；**HTTP 服务器每个请求在收到首字节前有 60 秒计时**；**空闲超时（无响应也无 progress）HTTP 默认 5 分钟、stdio 30 分钟** | HTTP 工具要么 60 秒内开始响应、并且至少每 5 分钟发一次 progress，要么直接回 Task。`-p` 一次性运行**拿不到 Tasks**（需 stream-json 输入 + 环境变量） |
| 6 | Codex CLI：`tool_timeout_sec` 默认 **60 秒**；`codex exec` 下 elicitation 被**静默拒绝**（官方 issue 还开着）；**不处理 `tools/list_changed`**；没有 Tasks | Codex 当执行器时：调大 `tool_timeout_sec`，审批不能靠 elicitation，工具列表要在启动前就定好 |
| 7 | MCP Apps（SEP-1865，Final；扩展 id `io.modelcontextprotocol/ui`；稳定规范 2026-01-26）：工具 `_meta.ui.resourceUri` 指向 `ui://`，mimeType `text/html;profile=mcp-app`，iframe 和宿主之间走 postMessage JSON-RPC（`ui/initialize`、`ui/notifications/tool-input`、`ui/notifications/tool-result`、`tools/call`、`ui/message`、`ui/open-link`、`ui/update-model-context`、`ui/notifications/size-changed` …） | Opero 网页 / WebView 可以直接用官方 `@modelcontextprotocol/ext-apps` 的 `app-bridge` 做宿主。**Claude Code 不渲染 MCP Apps**（会把 ui:// 资源从资源列表里滤掉），所以表单只能由 Opero 前端渲染 |
| 8 | Claude Code 可识别 `_meta["anthropic/requiresUserInteraction"]: true`：这个工具每次都要人确认，在 `-p` 下没人答就直接拒绝 | 高风险工具可以打这个标记，作为执行器这一侧的兜底；主要的风险判定还是放在 Opero server |

---

## 1. MCP 规范版本

### 1.1 版本号

| 版本 | 状态 | 说明 |
|---|---|---|
| **2026-07-28** | **Current（现行）** | 无状态、MRTR、Tasks 移到扩展 |
| 2025-11-25 | Final | icons、URL 模式 elicitation、sampling 可带工具、实验性 Tasks |
| 2025-06-18 | Final | structured output（`outputSchema` / `structuredContent`）、`resource_link`、form 模式 elicitation 都是这一版引入的 |
| draft | Draft | 下一版草案，目前只有小改动 |

出处：[Versioning](https://modelcontextprotocol.io/specification/versioning)

### 1.2 2025-06-18 → 2025-11-25 的变化

出处：[2025-11-25 Key Changes](https://modelcontextprotocol.io/specification/2025-11-25/changelog)

- **icons**：tools / resources / resource templates / prompts 可以带图标（SEP-973）。
- **elicitation**：新增 **URL 模式**（SEP-1036，用于登录、支付这类在浏览器外完成的流程）；enum 支持带标题、单选、多选（SEP-1330）；所有基本类型都能设默认值（SEP-1034）。
- **sampling 带工具**：`tools` / `toolChoice` 参数（SEP-1577）。
- **Tasks（实验性）**：可持久、可轮询、可稍后取结果的请求（SEP-1686）。
- **授权**：支持 OpenID Connect Discovery；通过 `WWW-Authenticate` 增量申请 scope（SEP-835）；推荐用 **Client ID Metadata Documents** 注册客户端（SEP-991）；Protected Resource Metadata 对齐 RFC 9728（SEP-985）。
- 其他：工具名规范（SEP-986）；输入校验错误按「工具执行错误」返回，方便模型自己纠正（SEP-1303）；SSE 允许服务器主动断开、客户端轮询（SEP-1699）；默认使用 JSON Schema 2020-12（SEP-1613）。

### 1.3 2025-11-25 → 2026-07-28 的变化（破坏性很大）

出处：[2026-07-28 Key Changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog)

| 方面 | 变化 | SEP |
|---|---|---|
| 会话 | 去掉协议级会话和 `Mcp-Session-Id`；`tools/list` 等不再随连接变化；需要跨调用状态就用服务器发的句柄，作为普通工具参数传 | [SEP-2567](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2567) |
| 握手 | 去掉 `initialize` / `notifications/initialized`；每个请求 `_meta` 带 `io.modelcontextprotocol/protocolVersion`、`.../clientCapabilities`，建议带 `.../clientInfo`；结果 `_meta` 带 `.../serverInfo`；版本不符返回 `UnsupportedProtocolVersionError` | [SEP-2575](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2575) |
| 发现 | 新增服务器**必须实现**的 `server/discover`（支持的版本、能力、身份） | SEP-2575 |
| 订阅 | 去掉 HTTP GET 流和 `resources/subscribe`，改用 `subscriptions/listen`（一条长 POST 响应流，按类型订阅 `toolsListChanged` 等）；`notifications/progress` 仍然走所属请求自己的响应流 | SEP-2575 |
| 删除 | `ping`、`logging/setLevel`、`notifications/roots/list_changed`；日志级别改成每个请求在 `_meta` 里带 `io.modelcontextprotocol/logLevel` | SEP-2575 |
| Tasks | 移到官方扩展 `io.modelcontextprotocol/tasks`；去掉阻塞式 `tasks/result` 和 `tasks/list`，改成 `tasks/get` 轮询，新增 `tasks/update`；服务器可以不经请求方逐个开启、自己决定回 task | [SEP-2663](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2663) |
| MRTR | 服务器不再主动发请求，改成返回 `InputRequiredResult`（见 1.4） | [SEP-2322](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2322) |
| resultType | 所有结果必须带 `resultType`：`complete` / `input_required`（Tasks 扩展另加 `task`）；老服务器没带就当 `complete` | SEP-2322 |
| 传输 | Streamable HTTP 去掉 SSE 续传（`Last-Event-ID`），流断了正在进行的请求就丢了，客户端要用新 id 重发；POST 必须带 `Mcp-Method`、`Mcp-Name` 头（SEP-2243） | SEP-2575 / SEP-2243 |
| 缓存 | 列表类结果必须带 `ttlMs`、`cacheScope`；建议 `tools/list` 顺序固定 | [SEP-2549](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2549) |
| Schema | `inputSchema` / `outputSchema` 可以用任意 JSON Schema 2020-12 关键字；`structuredContent` 可以是任意 JSON 值 | [SEP-2106](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2106) |
| elicitation | 去掉 `notifications/elicitation/complete` 和 URL 模式的 `elicitationId`（改为客户端重试原请求时得知结果） | — |
| 授权 | 授权服务器应返回 `iss`，客户端必须校验（SEP-2468）；凭据按 issuer 绑定（SEP-2352）；DCR 要带 `application_type`（SEP-837）；**DCR 降为 Deprecated，推荐 Client ID Metadata Documents** | 见 changelog |
| 扩展 | 能力里加了 `extensions` 字段（MCP Apps、Tasks 等都走它） | [SEP-2133](https://modelcontextprotocol.io/seps/2133-extensions.md) |
| 追踪 | `_meta` 里约定 `traceparent` / `tracestate` / `baggage`（OpenTelemetry） | SEP-414 |
| 错误码 | `-32020`～`-32099` 归规范使用；资源不存在改为 `-32602` | SEP-2164 |

**Deprecated（还能用，但新实现别再加）**：Roots、Sampling、Logging（SEP-2577；建议目录用工具参数传、日志写 stderr 或用 OTel）；HTTP+SSE 传输；sampling 的 `includeContext` 取 `thisServer` / `allServers`；OAuth 动态客户端注册（DCR）。

### 1.4 MRTR（多轮请求）要点

出处：[MRTR 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr.md)

- 只有 `tools/call`、`prompts/get`、`resources/read` 可以返回 `InputRequiredResult`。
- 返回体：`{ resultType: "input_required", inputRequests: { <key>: { method: "elicitation/create" | "sampling/createMessage" | "roots/list", params } }, requestState: "<不透明串>" }`，两个字段至少有一个。
- 客户端：补齐后**用新的 JSON-RPC id 重发原请求**，带 `inputResponses`（同样的 key）和原样的 `requestState`。
- 服务器必须把 `requestState` 当成不可信输入：涉及权限或业务逻辑时要 HMAC / AEAD 保护，里面建议放用户身份、短 TTL、原请求摘要，防止重放。只允许用一次的操作要在服务器端自己保证。
- 客户端没声明 elicitation 能力，就不能给它发 elicitation。
- elicitation 的 `mode`：`form`（带 `requestedSchema`）或 `url`。

### 1.5 下一版草案和进行中的方向

- 草案目前只有小改动：Client ID Metadata Document 引用的草案版本改成 -03；恢复几个类型上被误删的 `_meta`。出处：[draft changelog](https://modelcontextprotocol.io/specification/draft/changelog.md)
- **下一版发布日期：未查到**（SEP-3398「Release Cycle Updates」状态为 Accepted）。出处：[SEP 索引](https://modelcontextprotocol.io/seps/index.md)
- 路线图（2026-08-22 更新）的重点：Tasks / 事件 / 订阅三者的统一（Tasks 打算以后并回核心）；stdio 上跑 HTTP，统一成一种传输；ETag 缓存；**agent 身份与委派**（DPoP、Workload Identity Federation SEP-1933、ID-JAG、RFC 8693 token exchange；还在讨论区分有人交互和无界面 agent）；重新设计 `tools/call` 结果的形状（解决 `content` 和 `structuredContent` 并存带来的混乱）；**渐进式发现**（大量工具按需加载）。出处：[Roadmap](https://modelcontextprotocol.io/development/roadmap.md)
- 新的官方扩展（都已 Final）：Events（SEP-3415，支持轮询 / 推送 / webhook）、Skills（SEP-2640）、Server Cards（SEP-2127，HTTP 服务器发现）、OAuth Client Credentials、Enterprise-Managed Authorization。出处：[Extension 矩阵](https://modelcontextprotocol.io/extensions/client-matrix.md)

---

## 2. MCP Apps（SEP-1865 / ext-apps）

出处：[MCP Apps 概览](https://modelcontextprotocol.io/extensions/apps/overview.md)、[规范 2026-01-26（Stable）](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)、[ext-apps 仓库](https://github.com/modelcontextprotocol/ext-apps)、[SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp.md)

### 2.1 状态

- SEP-1865：**Final**；扩展 id：`io.modelcontextprotocol/ui`。
- 规范版本：`2026-01-26`（**Stable**），另有 `draft`（Development）。草案相对稳定版改了什么：未查到。
- 能力协商：在 `capabilities.extensions["io.modelcontextprotocol/ui"]` 下声明，`mimeTypes` 必填，里面要有 `"text/html;profile=mcp-app"`。服务器应该先检查这个能力，再注册带 UI 的工具。

### 2.2 工具怎么声明 UI

| 项 | 值 |
|---|---|
| 工具字段 | `_meta.ui.resourceUri`：`ui://...`（旧写法 `_meta["ui/resourceUri"]` 已弃用，GA 前删除） |
| 可见性 | `_meta.ui.visibility`：数组，取值 `"model"`、`"app"`，不写就是两个都有。宿主**不得**把只有 `"app"` 的工具给模型；app 调没有 `"app"` 的工具时，宿主必须拒绝 |
| 资源 URI | 必须是 `ui://` 开头 |
| mimeType | `text/html;profile=mcp-app` |
| 内容 | `text` 或 `blob`（base64） |
| 资源 `_meta.ui` | `csp`：`connectDomains` / `resourceDomains` / `frameDomains` / `baseUriDomains`；`permissions`：`camera` / `microphone` / `geolocation` / `clipboardWrite`；`domain`；`prefersBorder` |

### 2.3 沙箱 / CSP

- Web 宿主必须用**不同源的沙箱代理 iframe**包一层（代理用 `allow-scripts allow-same-origin`），代理再加载 app。
- 代理 → 宿主发 `ui/notifications/sandbox-proxy-ready`；宿主 → 代理发 `ui/notifications/sandbox-resource-ready`（带 `html`、可选的 `sandbox`、`csp`、`permissions`）。代理只转发不以 `ui/notifications/sandbox-` 开头的消息。
- 没写 `csp` 时默认：`default-src 'none'`，`connect-src 'none'`，脚本和样式 `'self' 'unsafe-inline'`，图片和媒体 `'self' data:`；`frame-src 'none'`，`base-uri 'self'`，`object-src 'none'`。宿主可以更严，但不能放开没声明的域名。
- 宿主收到 `ui/notifications/initialized` 之前，不能给 app 发任何消息。

### 2.4 iframe ↔ 宿主消息（postMessage 上的 JSON-RPC）

| 方向 | 名称 | 说明 |
|---|---|---|
| App→宿主 请求 | `ui/initialize` | 参数 `appCapabilities`（`experimental`、`tools.listChanged`、`availableDisplayModes`）；返回 `protocolVersion`、`hostCapabilities`、`hostInfo`、**`hostContext`** |
| App→宿主 通知 | `ui/notifications/initialized` | 初始化完成 |
| 宿主→App 通知 | `ui/notifications/tool-input` | 完整的工具参数 `arguments`，在 tool-result 之前发一次 |
| 宿主→App 通知 | `ui/notifications/tool-input-partial` | 流式的部分参数，可选，可以发多次 |
| 宿主→App 通知 | `ui/notifications/tool-result` | `CallToolResult` |
| 宿主→App 通知 | `ui/notifications/tool-cancelled` | `reason` |
| 宿主→App 通知 | `ui/notifications/host-context-changed` | 部分 `hostContext`（比如切换主题） |
| 宿主→App 请求 | `ui/resource-teardown` | `reason`，宿主应该等 app 回复后再销毁 |
| App→宿主 请求 | `tools/call` | 由宿主代理调用 MCP 工具（受 visibility 限制） |
| App→宿主 请求 | `resources/read` | 读资源 |
| App→宿主 请求 | `ui/message` | `role`、`content`：往对话里发一条消息 |
| App→宿主 请求 | `ui/open-link` | `url` |
| App→宿主 请求 | `ui/update-model-context` | `content`、`structuredContent`：更新给模型看的上下文 |
| App→宿主 请求 | `ui/request-display-mode` | `mode`：`inline` / `fullscreen` / `pip`，返回实际生效的模式 |
| App→宿主 通知 | `ui/notifications/size-changed` | `width`、`height` |
| 通用 | `notifications/message`、`ping` | 日志、保活 |

**`hostContext` 字段**：`toolInfo`、`theme`、`styles`（`variables`、`css.fonts`）、`displayMode`、`availableDisplayModes`、`containerDimensions`、`locale`、`timeZone`、`userAgent`、`platform`、`deviceCapabilities`、`safeAreaInsets`。主题和语言就是通过这里传给 app 的。

### 2.5 SDK 包名

- `@modelcontextprotocol/ext-apps`（子路径 `/react`、`/app-bridge`、`/server`）。宿主一侧用 **`app-bridge`**，参考 [basic-host 示例](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-host)。
- 搭配 MCP TS SDK v2：`@modelcontextprotocol/client`、`@modelcontextprotocol/server`（另有 `/node`、`/express`）、`@modelcontextprotocol/core`。
- 社区的宿主 React 组件：`@mcp-ui/client`（[MCP-UI](https://github.com/MCP-UI-Org/mcp-ui)）。
- ext-apps 1.x 和 2.x 的线上协议没有变化。
- 移动端 / WebView 宿主的官方说明：未查到。

### 2.6 哪些客户端支持（官方矩阵）

出处：[Extension Support Matrix（源文件）](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/extensions/client-matrix.mdx)

| 客户端 | MCP Apps | Tasks |
|---|---|---|
| Claude（网页） | ✔ | ✔ |
| Claude Desktop | ✔ | — |
| **Claude Code** | **—**（不渲染） | **✔** |
| VS Code GitHub Copilot | ✔ | — |
| Microsoft 365 Copilot | ✔ | — |
| Goose | ✔ | — |
| ChatGPT | ✔ | — |
| Cursor | ✔ | — |
| Postman / Archestra.AI / PostHog Code / Kiro Crew | ✔ | — |
| MCPJam | ✔ | ✔ |
| Glean | ✔ | ✔ |
| MCP Inspector | 部分 | — |
| Codex CLI | 不在矩阵里 | 不支持（见第 5 节） |

---

## 3. Tasks（长时间 / 异步工具调用）

出处：[Tasks 概览](https://modelcontextprotocol.io/extensions/tasks/overview.md)、[ext-tasks 仓库](https://github.com/modelcontextprotocol/ext-tasks)、[schema 2026-07-28（Stable）](https://github.com/modelcontextprotocol/ext-tasks/blob/main/schema/2026-07-28/schema.ts)、[SEP-2663](https://modelcontextprotocol.io/seps/2663-tasks-extension.md)

### 3.1 协议

| 环节 | 内容 |
|---|---|
| 协商 | 客户端在每个请求的 `_meta["io.modelcontextprotocol/clientCapabilities"].extensions` 里放 `"io.modelcontextprotocol/tasks": {}`；服务器在 `server/discover` 的能力里声明同样的 key。**客户端没声明，服务器就绝不能回 task** |
| 创建 | 由服务器决定：`tools/call` 直接回 `CreateTaskResult`：`{ resultType:"task", taskId, status, statusMessage?, createdAt, lastUpdatedAt, ttlMs (可为 null), pollIntervalMs? }`。回之前任务必须已经持久化 |
| 轮询 | `tasks/get {taskId}` → 返回 `resultType:"complete"` 加任务的当前状态；`completed` 时带 `result`（就是原本同步调用会返回的 `CallToolResult`），`failed` 时带 `error`（JSON-RPC 错误对象），`input_required` 时带 `inputRequests` |
| 补输入 | `tasks/update {taskId, inputResponses}` → 返回空结果 |
| 取消 | `tasks/cancel {taskId}`，属于协作式取消，服务器可以不停 |
| 状态值 | `working`、`input_required`、`completed`、`failed`、`cancelled`（后三个是终态） |
| 推送 | `notifications/tasks`（完整的任务状态），客户端通过 `subscriptions/listen` 订阅；这是可选的，默认还是轮询 |
| 老版 | 2025-11-25 的实验性 Tasks（`tasks/result`、`tasks/list`、按请求开启）已被这一版替代 |

### 3.2 客户端支持

- 官方矩阵里打勾的：Claude（网页）、**Claude Code**、MCPJam、Glean。
- Claude Code 具体怎么实现：见 4.4。
- Codex：不支持（[openai/codex#48617](https://github.com/openai/codex/issues/48617)，还开着）。
- TS 实现包：`@modelcontextprotocol/ext-tasks`。

---

## 4. Claude Code 作为 MCP 客户端

出处：[Claude Code MCP 文档](https://code.claude.com/docs/en/mcp)、[环境变量](https://code.claude.com/docs/en/env-vars)、[Hooks](https://code.claude.com/docs/en/hooks)、[无界面模式](https://code.claude.com/docs/en/headless)、[错误说明](https://code.claude.com/docs/en/errors)

### 4.1 传输和协议版本

| 项 | 现状 |
|---|---|
| 传输 | `stdio`；`http`（推荐，`streamable-http` 是别名）；`sse`（已弃用，v2.1.265+ 会先试 HTTP 再回退到 SSE）；`ws`（WebSocket，只能在 `.mcp.json` / `add-json` 里配，只支持请求头鉴权，单条消息超过 16 MiB 会断开） |
| 协议版本 | 有 v1 / v2 两套运行时；v2 基于 TS SDK 2.0，会和 HTTP / stdio 服务器协商 **2026-07-28**，服务器不支持就回退到老版本。`MCP_SDK_GENERATION=v1\|v2`、`MCP_PROTOCOL_NEGOTIATION=auto\|legacy` 可以强制指定 |
| 鉴权 | OAuth（`-p` / SDK 里**走不完 OAuth**，要先在交互模式登录）；`headersHelper` 可以动态生成请求头（10 秒超时，遇到 401 / 403 会自动重跑一次） |

### 4.2 超时（关键数字）

| 变量 / 字段 | 默认值 | 说明 |
|---|---|---|
| `MCP_TIMEOUT` | 30000 ms | 服务器启动 / 连接超时 |
| `MCP_TOOL_TIMEOUT` | 100000000 ms（约 28 小时） | 单次工具调用的总时长上限 |
| `.mcp.json` 里单个服务器的 `timeout`（ms） | — | 覆盖上一行；是硬性的总时长上限，**progress 通知不会延长它** |
| HTTP / SSE 每个请求的计时 | **60 秒**（取 60 秒、该服务器的工具超时、`MCP_TIMEOUT` 三者最大值；未设置时的 28 小时默认值不参与比较） | 从发出请求到收到**首字节**。stdio / ws 没有这个计时 |
| `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` | HTTP / SSE / ws **5 分钟**，stdio **30 分钟** | 既没有响应也没有 progress 就中止；设 `0` 关闭 |
| `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS` | 120000 ms | 交互模式下，主对话里的调用超过 2 分钟会转到后台；`-p` 默认不转（除非 `CLAUDE_AUTO_BACKGROUND_TASKS=1`）；`-p` 结束时，被转到后台的调用结果会丢失 |

**结论**：远程 HTTP 工具要在 60 秒内开始响应，之后每 5 分钟内至少发一次 progress 或数据；更长的任务用 Tasks。

### 4.3 elicitation（重点：无界面时怎么处理）

- 交互模式：在终端弹对话框；支持 form 和 url 两种模式（协商到 2026-07-28 时，或连用户自己配置的服务器且版本 ≥ v2.1.287 时，声明 `elicitation:{form:{},url:{}}`；连 claude.ai connector 等时只声明 `elicitation:{}`，即只支持 form）。
- **`-p` 无界面**：
  - 没有对话框。没配 hook 时，请求**一直等到工具超时**，然后报错「The server asked the user a question, and no answer came before the time limit…」（[错误说明](https://code.claude.com/docs/en/errors)）。
  - 加 `--permission-prompts none`：没有被 hook 回答的 elicitation **直接取消**（[headless](https://code.claude.com/docs/en/headless)）。
  - **`Elicitation` hook** 可以用程序代答（输入里有 `mcp_server_name`、`message`、`mode`、`url`、`requested_schema`；输出 `hookSpecificOutput.action` = accept / decline / cancel，外加 `content`）。命令 hook 默认超时 600 秒。另有 `ElicitationResult` hook，可以在回复发回服务器前修改或拦截。
  - Agent SDK（TS）：用 `onElicitation` 回调代答。
  - **在 MCP Task 内部发起的 elicitation**：无界面时 Claude Code 直接让服务器取消这个任务，**不跑 hook，也不调 `onElicitation`**；Task 里的 `elicitation/create` 只在交互终端里处理。
- 设计建议：Opero 不要依赖 CLI 把 elicitation 转给人。需要人参与时，由 Opero 后台自己推送到网页 / 安卓端收集，工具这一侧返回「待审批」或者用 Task 挂起；或者给执行器配一个 `Elicitation` 命令 hook，由它去调 Opero 后台并等待结果（注意 600 秒的 hook 超时和工具超时）。

### 4.4 其他能力

| 能力 | 现状 |
|---|---|
| progress 通知 | 支持：会重置空闲计时，后台任务的条目里显示最新进度；不会延长总时长上限 |
| `list_changed` | 交互模式：tools / prompts / resources 都会刷新；**`-p` 和 Agent SDK 只刷新工具列表**；v2 运行时通过一条一直开着的流接收（流断了会重连，有次数限制） |
| **MCP Apps** | **不支持渲染**：`ui://` 或 `text/html;profile=mcp-app` 的资源不会出现在 `@` 提示和资源列表里，但按 URI 读取还能读到 |
| **Tasks** | **公测，v2.1.304+**。条件：服务器是 HTTP / stdio / connector，协商到 2026-07-28；会话会拉取 feature flag（**Bedrock / Vertex / Foundry 上不行，关了遥测也不行**）；调用来自主对话（子 agent 不行）；交互模式，或者 SDK / `-p --input-format stream-json` 并且 `CLAUDE_AUTO_BACKGROUND_TASKS=1`。**一次性的 `claude -p "<prompt>"` 拿不到 Tasks**。轮询间隔会被限制在 250～30000 ms（默认 2000 ms）；`taskId` 最多 128 个可打印 ASCII 字符；不使用 `tasks/result`、`tasks/list`、`notifications/tasks`；`inputRequests` 最多处理 16 个 key。在 HTTP 上，task 回复也必须在 60 秒的计时内开始 |
| tool search / 延迟加载 | **默认开启**：会话开始时只加载工具名和服务器 instructions，用到时再加载定义。`ENABLE_TOOL_SEARCH` 可设为（不设）/ `true` / `auto`（工具定义总量低于上下文 10% 时预先加载）/ `auto:N` / `false`；单个服务器可设 `alwaysLoad: true` 始终预先加载；没有每个服务器的工具数上限 |
| 输出长度 | `MAX_MCP_OUTPUT_TOKENS` 默认 **25000**；超过 10000 token 时提示警告；没有声明 `anthropic/maxResultSizeChars` 的工具，纯文本结果超过 50000 字符会存成文件；工具可以用 `_meta["anthropic/maxResultSizeChars"]` 自己放宽文本上限 |
| 需要人确认的工具 | `_meta["anthropic/requiresUserInteraction"]: true`：每次都要人确认，`bypassPermissions` 也跳不过；`-p` 下没人答就拒绝；`--permission-prompt-tool` 返回的 allow 也会被改成 deny；Agent SDK 的 `canUseTool` 可以批准 |
| 断线重试 | 带 `annotations.idempotentHint` 或 `readOnlyHint` 的工具，HTTP 断线后会在新连接上重试一次；`readOnlyHint` 的工具还会和其他只读调用并行执行 |
| 资源 / prompts | 资源可以用 `@` 引用（`-p` 下只当普通文本）；prompts 可以当斜杠命令用 |
| 工具名长度 | `mcp__<server>__<tool>` 超过 128 个字符的工具会被丢掉 |

---

## 5. Codex CLI 作为 MCP 客户端

出处：[Codex MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)（原 developers.openai.com/codex/mcp，已 308 跳转到这里）、[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference.md)、[codex exec](https://learn.chatgpt.com/docs/non-interactive-mode.md)、openai/codex 的 issue

| 项 | 现状 |
|---|---|
| 传输 | STDIO、Streamable HTTP（鉴权：`bearer_token_env_var`、`http_headers`、`env_http_headers`、OAuth `codex mcp login`） |
| 超时 | `[mcp_servers.<id>]` 下的 `startup_timeout_sec` 默认 **10**；`tool_timeout_sec` 默认 **60**（秒）；顶层的 `mcp_optional_startup_grace_ms` 默认 1000 |
| 其他配置 | `enabled`、`required`（`codex exec` 下必需的服务器起不来就直接退出）、`enabled_tools` / `disabled_tools`、`default_tools_approval_mode`（`auto` / `prompt` / `writes` / `approve`）、`tools.<tool>.approval_mode`、`tools.<tool>.output_token_limit` |
| elicitation | 支持，但受 `approval_policy` 控制：`approval_policy = { granular = { mcp_elicitations = true } }` 时才会弹出，否则**自动拒绝**。`codex exec` 下 elicitation **被静默拒绝，退出码仍是 0，`--json` 里也没有任何事件**（[#60400](https://github.com/openai/codex/issues/60400)，2026-11-09，还开着）；0.167.0 里即使 `on-request` 也会自动拒绝 form 模式（[#60158](https://github.com/openai/codex/issues/60158)，还开着） |
| `tools/list_changed` | **不处理**：收到通知只写一行日志，会话中途工具列表不会更新（[#37417](https://github.com/openai/codex/issues/37417)、[#10105](https://github.com/openai/codex/issues/10105)、[#33266](https://github.com/openai/codex/issues/33266)，都还开着） |
| Tasks | **不支持**：所有调用都是普通 `tools/call`，回 task 会被当成错误（[#48617](https://github.com/openai/codex/issues/48617)，还开着） |
| MCP Apps | Codex CLI：未查到（终端客户端，不在官方矩阵里）；ChatGPT 支持 |
| 支持的协议版本（是否到 2026-07-28） | 未查到 |

---

## 6. agent 之间互相委派任务

**A2A（Agent2Agent）** 是现在的主流标准：Google 在 2025-04 发布，2025-06 交给 Linux Foundation，**v1.0 在 2026-03 发布**（加了 Signed Agent Cards、多租户等），后来并入 Agentic AI Foundation（AAIF，MCP 也在这里）。官方的说法是两者**互补**：MCP 负责 agent 连工具和数据，A2A 负责 agent 之间通过 Agent Card 发现对方、委派任务、跟踪任务状态，而且不暴露各自内部的提示词和记忆。IBM 的 ACP（Agent Communication Protocol）已经并入 A2A。另外有一个同名的 **ACP（Agent Client Protocol，Zed 主导）**，它管的是编辑器和编码 agent 之间（stdio JSON-RPC），不是 agent 之间。MCP 自己没有专门的 agent 委派原语，但路线图在做 agent 身份与委派授权（SEP-1933、ID-JAG、token exchange），而 Tasks 和 Events 已经足够让「把一个 agent 包装成长时间运行的 MCP 工具」这种做法落地（Codex 的 `codex mcp-server` 就是把自己暴露成 MCP 工具）。对 Opero 来说：内部委派用 MCP Tasks 就够了；要和外部 agent 互通时再考虑 A2A。
出处：[a2a-protocol.org](https://a2a-protocol.org/latest/)、[LF 新闻稿 2026-04-09](https://www.prnewswire.com/news-releases/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year-302737641.html)、[Agent Client Protocol（Zed）](https://zed.dev/acp)、[MCP Roadmap](https://modelcontextprotocol.io/development/roadmap.md)

---

## 7. 待确认 / 没查到

- MCP 下一版的发布日期：未查到。
- MCP Apps 草案相对 2026-01-26 改了什么：未查到。
- MCP Apps 在移动端 / WebView 宿主上的官方要求（比如双 iframe 在安卓 WebView 上怎么做）：未查到，需要自己验证。
- Codex CLI 支持的 MCP 协议版本、是否支持 MCP Apps：未查到。
- Claude Code `-p` 下没有 hook 时 elicitation 会挂多久：按文档是挂到工具超时（总时长或单服务器 `timeout`）；空闲超时会不会提前打断它，文档没写清楚，需要实测。

查询日期：2026-11-21
