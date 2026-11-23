# Installing Opero (instructions for you and your AI agent)

> **Easiest way:** open Claude Code or Codex on the server where Opero should run, and say:
>
> *"Install Opero on this server by following https://github.com/wfcaven/opero/blob/main/INSTALL.md"*
>
> The agent reads this file and does the rest. Everything below is written so an AI agent can follow it step by step; a human can follow it too.
>
> 中文用户也可以直接对 AI 说：「按 https://github.com/wfcaven/opero/blob/main/INSTALL.md 帮我在这台服务器上装好 Opero」。

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
curl -fsSL https://raw.githubusercontent.com/wfcaven/opero/main/code/server/scripts/install.sh | sudo bash
```

Options (append after `sudo bash -s --`):

| Option | Use when |
|---|---|
| `--cn` | Node and npm packages from mirrors in China |
| `--with-codex` | also install the Codex CLI for the AI user |
| `--no-claude` | do not install Claude Code |
| `--port 8080` | port 7300 is taken |

Example: `curl -fsSL …/install.sh | sudo bash -s -- --cn --with-codex`.

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
sudo -u opero-ai -H bash -lc 'claude --version'     # or codex --version
```

Expected: `active` and `{"ok":true,"version":"…"}`. If not, run `journalctl -u opero -n 80 --no-pager` and fix what it says, then re-run the installer.

## 4. Make it reachable (ask the user first)

- **Quick test:** open `http://<server-ip>:7300` (the port must be open in the cloud firewall / security group).
- **Recommended:** a domain with HTTPS. Use `/opt/opero/app/code/server/scripts/nginx.conf` as the template (replace the domain and certificate paths; get a certificate with certbot if there is none). Then set `OPERO_HOST=127.0.0.1` and `OPERO_URL=https://<domain>` in `/etc/opero/opero.env` and run `sudo opero restart`.

## 5. Hand over to the user

Tell the user to open the address and:

1. Create the owner account (first visit only).
2. Connect an AI executor in the setup wizard: paste an Anthropic / OpenAI API key, **or** log in on the server as the AI user (`sudo opero ai`, then `claude setup-token` or `codex login`) and paste the token. Press "测试一下 / Test"; it should answer OK.
3. Create employees, then chat.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Node 安装包校验不对` / download fails | network to nodejs.org; re-run with `--cn` |
| `npm ci` hangs or fails | re-run with `--cn`; check free memory (`free -h`) |
| service not active | `journalctl -u opero -n 80`; port in use → `--port`; then re-run the installer |
| executor shows "not installed" in the wizard | `sudo opero ai -c 'curl -fsSL https://claude.ai/install.sh \| bash'` |
| employee replies "执行器退出了 … login / API key" | key missing or wrong: set it in 我 → AI 执行器, or log in as the AI user |
| forgot password | `opero reset-password` |
| update | `sudo opero update` (pulls the latest code from the same repo and re-installs; data and config stay) |
