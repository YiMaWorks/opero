# 接 AI 执行器（给用户看的）

员工干活靠「AI 执行器」：Opero 在服务器上替你装好一个编程 Agent 的命令行版，员工每一轮都交给它做。现在能接四种，在 **应用 → AI 执行器** 里一键安装、加账号、试一下，全程不用碰服务器命令行。

| 执行器 | 谁家的 | 怎么付费 | 账号怎么加 | 要不要网络出口 |
|---|---|---|---|---|
| Claude Code（推荐） | Anthropic | Claude Pro / Max 订阅，或 API Key 按量 | 用 Claude 账号登录 / 贴订阅令牌 / 贴 API Key | 国内服务器要 |
| Codex | OpenAI | ChatGPT 订阅，或 API Key 按量 | 用 ChatGPT 登录（设备码）/ 贴 auth.json / 贴 API Key | 国内服务器要 |
| Qwen Code | 阿里 · 通义 | 百炼 API Key 按量 | 贴百炼 API Key | 不用 |
| CodeBuddy Code | 腾讯 | CodeBuddy 套餐积分（标准版及以上） | 贴 CodeBuddy API Key | 不用 |

每种执行器都能存好几个账号：设默认、改名、去掉（只是 Opero 不再用它，账号和令牌本身不作废）。Claude、Codex 的员工还能在 work 设置里单独指定用哪个账号；一个账号用量到上限，后面的活自动先换别的账号。令牌和 Key 都加密存在 Opero 的保险箱里，只在员工干活时交给执行器。

下面的说明是 2026-11 对照各家官方页面写的，各家改了套餐或页面以官方为准。

## Claude Code

- **用 Claude 账号登录（Pro / Max）**：点「登录 Claude 账号」→ 自动打开 Claude 登录页 → 登录、点 Authorize → 复制页面上的码 → 贴回来。要加另一个 Claude 账号：登录页出来后点「复制链接」，在无痕窗口打开再登录。
- **贴订阅令牌**：在装了 Claude Code 的电脑上跑 `claude setup-token`，把打印出来的整串贴进来（会先真跑一次验证）。
- **贴 API Key（按量）**：[console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) → Create Key。可以给这个账号单独填接口地址（代理 / 中转）。

## Codex

三种方式任选，都是新加一个账号：

### 1. 用 ChatGPT 账号登录（订阅，推荐）

要什么：
- ChatGPT **Plus、Pro、Business、Enterprise 或 Edu** 订阅。Codex 的用量算在套餐里，不另外按量收费：Plus、Business 每 5 小时有额度（可能还有每周额度），Pro 没有 5 小时限制。OpenAI 没写 Free、Go 套餐包含命令行版 Codex。
- **先打开「设备码登录」**：个人账号在 ChatGPT [设置 → 安全](https://chatgpt.com/#settings/Security) 里打开（Enable device code login）；Business / Enterprise / Edu 工作区要管理员在工作区权限里打开。不打开的话登录会失败。
- 服务器要连得上 auth.openai.com 和 chatgpt.com（国内服务器先在第 2 步设网络出口）。

步骤：点「用 ChatGPT 账号登录」→ 页面上出现网址（auth.openai.com/codex/device）和一个一次性码 → 在**任何设备**的浏览器里打开网址、登录要给 Opero 用的那个 ChatGPT 账号、输入码 → 回到 Opero 等几秒，自动保存并试跑一次。码 15 分钟内有效。浏览器里已经登录了别的 ChatGPT 账号的，先退出或用无痕窗口。

同一个 ChatGPT 账号再登录一次 = 更新它的登录；换一个账号就是新加一个。登录令牌 Codex 用的时候自己续期，Opero 每轮做完把续期过的存回保险箱。

### 2. 贴 auth.json

适合已经在自己电脑上用 ChatGPT 登录过 Codex 的：
1. 电脑上装 Codex：`npm install -g @openai/codex`（Mac 也可以 `brew install codex`）。
2. 跑 `codex login`，在浏览器里选 **Sign in with ChatGPT** 登录。
3. 打开 `~/.codex/auth.json`（Windows：`%USERPROFILE%\.codex\auth.json`），全部复制，贴到 Opero。

auth.json 里是登录令牌，当密码对待：别发到聊天群、别提交进仓库。

### 3. 贴 OpenAI API Key（按量）

[platform.openai.com/api-keys](https://platform.openai.com/api-keys) → Create new secret key，马上复制（sk- 开头）。用 API Key 时按 OpenAI API 标准价格收费，不用 ChatGPT 套餐额度；账户要先有余额（Billing）。

## Qwen Code（阿里通义）

要什么：阿里云账号，开通「阿里云百炼」，按调用量（token）计费。要**普通的百炼 API Key**，别用「百炼 Coding Plan」的专属 Key——Coding Plan 的条款不允许程序自动调用。

步骤：
1. 打开百炼控制台的 [API Key 页（华北2 北京）](https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key)，登录阿里云。
2. 点 **创建 API Key**：归属账号、归属业务空间用默认，权限选 **全部** → 确定。
3. **马上复制完整的 Key**（sk- 开头）：只在创建成功时完整显示一次，之后只剩打码的，丢了只能重置或新建。
4. 贴到 Opero。

注意：
- Key 分地域、不能混用。北京地域用默认接口地址；新加坡地域的 Key 在「换接口地址」里填 `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`。也能填别的 OpenAI 兼容接口（ModelScope、自建 vLLM）。
- 点不了「创建」：子账号（RAM 用户）要主账号或业务空间管理员给权限。每个账号每个地域最多 50 个 Key。
- 默认模型 `qwen3-coder-plus`，可以在账号上改，或者在员工的 work 设置里选。

## CodeBuddy Code（腾讯）

要什么：**CodeBuddy「个人标准版」或更高**才能建 API Key。定价页上叫「个人专业版」，¥58 / 人 / 月；企业的旗舰版、专享版也行。免费的「个人体验版」建不了，访问密钥页会提示「该功能为标准版以上用户可用」。企业账号找企业管理员。看套餐：[codebuddy.cn/pricing](https://www.codebuddy.cn/pricing/)。国际站（codebuddy.ai）要 Pro（可先 7 天免费试用，之后 10 美元 / 月）。

步骤：
1. 打开「访问密钥」页：国内站 [codebuddy.cn/profile/keys](https://www.codebuddy.cn/profile/keys)，国际站 [codebuddy.ai/profile/keys](https://www.codebuddy.ai/profile/keys)。
2. 点 **创建密钥**：名字随便起；有效期建议选 **永久有效**（选 7 天 / 30 天 / 1 年的，到期后员工会突然用不了）。
3. **马上复制**：密钥只显示一次，丢了只能重新建。
4. 在 Opero 里选对站点（国内站 / 国际站），贴进来。

CodeBuddy 按积分扣费（不同模型扣得不一样），剩多少在「套餐与用量」里看。

## 出问题时

| 现象 | 怎么办 |
|---|---|
| Codex 设备码登录失败 | 多半是 ChatGPT 没打开「设备码登录」（见上）；或码过期了、输码时登录的是别的账号；或服务器连不上 auth.openai.com（设网络出口） |
| 员工说「ChatGPT 登录失效了」 | 在 Codex 第 3 步再登录一次这个 ChatGPT 账号，登录好把旧的去掉 |
| 「用量到上限了」 | 等额度恢复，或者再加一个账号（后面的活自动换过去） |
| Claude「所在地区不支持」 | 第 2 步「网络出口」把 Claude 设成经海外的服务器出去 |
| CodeBuddy 页面提示「该功能为标准版以上用户可用」 | 免费的体验版不能建 API Key，要升级套餐 |

## 资料来源（2026-11 查的）

- OpenAI：[Codex 登录说明](https://learn.chatgpt.com/docs/auth)（设备码、auth.json、凭证存在哪）、[Codex 套餐和额度](https://learn.chatgpt.com/docs/pricing)
- 阿里云：[获取百炼 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)
- 腾讯：CodeBuddy [定价页](https://www.codebuddy.cn/pricing/)和「访问密钥」页的界面文案；[CodeBuddy Code 认证说明](https://www.codebuddy.ai/docs/cli/iam)（`CODEBUDDY_API_KEY`、`CODEBUDDY_INTERNET_ENVIRONMENT`）
