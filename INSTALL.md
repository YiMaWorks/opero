# Installing Opero (instructions for you and your AI agent)

> **Easiest way:** open Claude Code or Codex on the server where Opero should run, and say:
>
> *"Install Opero on this server by following https://github.com/yimaworks/opero/blob/main/INSTALL.md"*
>
> The agent reads this file and does the rest. Everything below is written so an AI agent can follow it step by step; a human can follow it too.
>
> 中文用户也可以直接对 AI 说：「按 https://github.com/yimaworks/opero/blob/main/INSTALL.md 帮我在这台服务器上装好 Opero」。

Opero downloads everything from GitHub, nodejs.org and the npm registry (or their mirrors in China with `--cn`). It never contacts the Opero website.

## Agent rules

- Work in small steps and show the user the output of each step.
- Use the installer below. Do not hand-install Node, create users, or write systemd units yourself; the installer is idempotent, so re-running it is the fix for most half-finished installs.
- **Stop and ask the user** before: running anything as root for the first time, opening firewall ports, changing an existing nginx / Apache config, or installing on a server that already runs other important services on port 7300.
- Never ask the user to paste API keys, passwords or tokens into the chat. Keys are entered later in the Opero web UI, where they are stored encrypted.

## 1. Check the server

Run and report:

```bash
uname -sm; cat /etc/os-release | head -3; nproc; free -h | head -2; df -h / | tail -1
command -v systemctl git curl sudo; id -u
ss -ltn | grep -E ':7300\b' || echo "port 7300 free"
```

Requirements: Linux with systemd (Ubuntu / Debian / RHEL family), x86_64 or arm64, 2 vCPU, 2 GB+ RAM (4 GB recommended), 5 GB free disk, root or sudo. If the server is in mainland China, or `curl -sI https://github.com` is slow or fails, plan to add `--cn` and possibly a mirror (step 2).

## 2. Run the installer

```bash
curl -fsSL https://raw.githubusercontent.com/yimaworks/opero/main/code/server/scripts/install.sh | sudo bash
```

Options (append after `sudo bash -s --`):

| Option | Use when |
|---|---|
| `--cn` | Node and npm packages from mirrors in China |
| `--with-claude` / `--with-codex` | also install the CLI now (normally the web wizard does it, with progress and login) |
| `--port 8080` | port 7300 is taken |

Example: `curl -fsSL …/install.sh | sudo bash -s -- --cn`.

The installer only installs Opero itself. **Do not install or log in to Claude Code / Codex by hand**: the web setup wizard does it with buttons (step 5).

If GitHub cannot be reached, clone from any mirror or a fork and run the installer from the clone:

```bash
git clone --depth 1 <mirror-url>/opero.git && sudo OPERO_REPO=<mirror-url>/opero.git bash opero/code/server/scripts/install.sh --cn
```

It takes a few minutes (Node download, npm install, web build). It creates:

| Path / user | What |
|---|---|
| `/opt/opero/node`, `/opt/opero/app`, `/opt/opero/src` | Node 22, the running app, the git checkout used by `opero update` |
| `/etc/opero/opero.env` | port, directories, AI user |
| `/var/lib/opero` | database, vault key, files (only user `opero` can read) |
| `/srv/opero/work` | workspaces where employees work |
| user `opero` / `opero-ai` | backend / Claude Code and Codex (cannot read `/var/lib/opero`) |
| service `opero`, command `opero` | `opero status`, `opero logs`, `sudo opero update`, `opero reset-password` |

## 3. Verify

```bash
systemctl is-active opero && curl -s http://127.0.0.1:7300/api/health
```

Expected: `active` and `{"ok":true,"version":"…"}`. If not, run `journalctl -u opero -n 80 --no-pager` and fix what it says, then re-run the installer.

## 4. Make it reachable (ask the user first)

- **Quick test:** open `http://<server-ip>:7300` (the port must be open in the cloud firewall / security group).
- **Recommended:** a domain with HTTPS. Use `/opt/opero/app/code/server/scripts/nginx.conf` as the template (replace the domain and certificate paths; get a certificate with certbot if there is none). Then set `OPERO_HOST=127.0.0.1` and `OPERO_URL=https://<domain>` in `/etc/opero/opero.env` and run `sudo opero restart`.

## 5. Hand over to the user

Tell the user to open the address and:

1. Create the owner account (first visit only).
2. In the setup wizard step "接 AI 执行器" (connect an AI executor), everything is a button:
   1. **一键安装 Claude Code** (install): Opero installs it on the server for the AI user (1–3 minutes, progress shown).
   2. **开始登录** (log in): click "打开登录页", sign in to the Claude account in the browser, click **Authorize**, copy the code shown, paste it back and click "提交". Opero verifies it and stores the token encrypted. (Or choose "API Key" and paste a key from console.anthropic.com.)
   3. **让它回一句话** (test): it should answer within a few seconds.
3. Create employees, then chat.

## 6. More servers (Opero Agent)

Employees can also work on other servers. Opero installs a small **Agent** there; it connects out to Opero (no inbound port needed) and coexists with other agents on the machine (for example KidLock's `kl-logagent`).

1. In Opero: **应用 → 服务器和 Agent → 接入 → 装 Agent → 生成安装命令** (one-time token, valid 30 minutes).
2. On the other server, run that command as root. It looks like:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/yimaworks/opero/main/code/server/scripts/install.sh | sudo bash -s -- --agent https://<your-opero> <token>
   ```
   It installs Node 22, the `opero-ai` user, `/srv/opero/work` and the `opero-agent` service. The page shows "已接入" within seconds.
3. Click the server → **AI 执行器**: one-click install Claude Code on it and log in (same buttons as step 5).
4. In an employee's **编辑 → 跑在哪台服务器**, pick that server.

Re-installing, or running a new command on the same machine, re-links the same server (identified by `/etc/machine-id`); no duplicates. The other server must be able to reach your Opero address (set `OPERO_URL` if Opero is behind a domain). Agent commands on that machine: `opero status`, `opero logs`, `sudo opero update`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Node 安装包校验不对` / download fails | network to nodejs.org; re-run with `--cn` |
| `npm ci` hangs or fails | re-run with `--cn`; check free memory (`free -h`) |
| service not active | `journalctl -u opero -n 80`; port in use → `--port`; then re-run the installer |
| "一键安装" fails | usually no internet access to claude.ai / npm; check the log shown in the wizard, re-run with `--cn` mirrors, or `sudo opero ai -c 'curl -fsSL https://claude.ai/install.sh \| bash'` |
| login says "Invalid code" | the code is single-use; click 开始登录 again and paste the new code right away |
| employee replies "执行器退出了 … login / API key" | key missing or wrong: set it in 我 → AI 执行器, or log in as the AI user |
| forgot password | `opero reset-password` |
| Agent shows 离线 | on that server: `systemctl status opero-agent`, `journalctl -u opero-agent -n 50`; can it reach the Opero URL? |
| Agent install says the token is invalid / expired | generate a new command in Opero (tokens are single-use, 30 minutes) |
| update | `sudo opero update` (pulls the latest code from the same repo and re-installs; data and config stay) |
