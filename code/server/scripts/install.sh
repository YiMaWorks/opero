#!/usr/bin/env bash
# Opero 安装 / 升级（像以前的论坛系统：一台 Linux 服务器、一条命令）。要 root。代码从 GitHub 拉，不经过 Opero 官网：
#   curl -fsSL https://raw.githubusercontent.com/wfcaven/opero/main/code/server/scripts/install.sh | sudo bash
#   或者在拉下来的代码里：sudo bash code/server/scripts/install.sh
#   换代码来源（镜像 / 自己的 fork）：OPERO_REPO=https://…/opero.git OPERO_BRANCH=main
# 选项：
#   --update        只升级程序（数据、配置不动）；opero update 就是它
#   --with-claude   顺便给 AI 用户装 Claude Code（默认不装：装好后在网页开机向导里点「一键安装」，有进度、会登录）
#   --with-codex    顺便给 AI 用户装 Codex（同上，默认在网页里装）
#   --port N        端口（默认 7300）
#   --cn            用国内镜像下载 Node 和 npm 包
# 装完的样子：
#   /opt/opero/node      Node 22（只给 Opero 用）
#   /opt/opero/app       程序（code/server + code/web/dist）
#   /etc/opero/opero.env 配置（端口、目录、AI 用户）
#   /var/lib/opero       数据（数据库、保险箱密钥、文件），只有 opero 用户能读
#   /srv/opero/work      员工干活的目录（工作空间），opero-ai 用户读写
#   用户 opero 跑后台；用户 opero-ai 跑 Claude Code / Codex（读不到 /var/lib/opero）
set -euo pipefail

UPDATE=0; CLAUDE=0; CODEX=0; PORT=7300; CN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --update) UPDATE=1 ;;
    --with-claude) CLAUDE=1 ;;
    --no-claude) CLAUDE=0 ;;
    --with-codex) CODEX=1 ;;
    --port) PORT="$2"; shift ;;
    --cn) CN=1 ;;
    *) echo "不认识的选项：$1"; exit 2 ;;
  esac
  shift
done

HOME_DIR=/opt/opero; APP=$HOME_DIR/app; NODE_DIR=$HOME_DIR/node
ETC=/etc/opero; DATA=/var/lib/opero; WORK=/srv/opero/work
REPO=${OPERO_REPO:-https://github.com/wfcaven/opero.git}
BRANCH=${OPERO_BRANCH:-main}
SRC=$HOME_DIR/src   # 代码的 git 副本，opero update 在这里拉最新
say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m出错：\033[0m%s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "要用 root 跑（前面加 sudo）"
[ "$(uname -s)" = Linux ] || die "只支持 Linux"
command -v systemctl >/dev/null || die "要有 systemd"
case "$(uname -m)" in x86_64|amd64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) die "不支持的 CPU：$(uname -m)" ;; esac

# ---------- 基础工具 ----------
need=""
for c in curl tar git sudo; do command -v $c >/dev/null || need="$need $c"; done
# script（util-linux）：网页里登录 Claude 账号要靠它给登录界面一个伪终端
if ! command -v script >/dev/null; then
  if command -v apt-get >/dev/null; then need="$need bsdutils"; else need="$need util-linux"; fi
fi
if [ -n "$need" ]; then
  say "装基础工具：$need"
  if command -v apt-get >/dev/null; then apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $need
  elif command -v dnf >/dev/null; then dnf install -y -q $need
  elif command -v yum >/dev/null; then yum install -y -q $need
  else die "缺少：$need，先手动装上"; fi
fi

# ---------- 用户 ----------
if ! id opero >/dev/null 2>&1; then say "建用户 opero（跑后台）"; useradd --system --home-dir $DATA --shell /usr/sbin/nologin opero; fi
if ! id opero-ai >/dev/null 2>&1; then say "建用户 opero-ai（跑 AI 执行器）"; useradd --create-home --shell /bin/bash opero-ai; fi
getent group opero-work >/dev/null || groupadd opero-work
usermod -aG opero-work opero
usermod -aG opero-work opero-ai

# ---------- Node 22 ----------
node_ok() { [ -x $NODE_DIR/bin/node ] && $NODE_DIR/bin/node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'; }
if ! node_ok; then
  BASE=https://nodejs.org/dist/latest-v22.x
  [ $CN = 1 ] && BASE=https://npmmirror.com/mirrors/node/latest-v22.x
  say "下载 Node 22（$BASE）"
  SUMS=$(curl -fsSL "$BASE/SHASUMS256.txt")
  FILE=$(echo "$SUMS" | grep -o "node-v22[0-9.]*-linux-$ARCH.tar.gz" | head -1)
  [ -n "$FILE" ] || die "找不到 Node 安装包"
  TMP=$(mktemp -d)
  curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE"
  (cd "$TMP" && echo "$SUMS" | grep " $FILE\$" | sha256sum -c - >/dev/null) || die "Node 安装包校验不对"
  rm -rf $NODE_DIR.new && mkdir -p $NODE_DIR.new
  tar -xzf "$TMP/$FILE" -C $NODE_DIR.new --strip-components=1
  rm -rf $NODE_DIR && mv $NODE_DIR.new $NODE_DIR
  rm -rf "$TMP"
fi
export PATH=$NODE_DIR/bin:$PATH
say "Node $(node -v)"
REG=(); [ $CN = 1 ] && REG=(--registry=https://registry.npmmirror.com)

# ---------- 程序 ----------
HERE=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)
CHECKOUT=""
if [ -n "$HERE" ] && [ -f "$HERE/../src/main.ts" ] && [ -f "$HERE/../../web/package.json" ]; then CHECKOUT=$(cd "$HERE/../../.." && pwd); fi
mkdir -p $HOME_DIR
if [ -z "$CHECKOUT" ] || [ "$CHECKOUT" = "$APP" ]; then
  # curl | bash 进来的：把代码拉到 $SRC（已经有就更新到最新）
  if [ -d $SRC/.git ]; then
    say "更新代码：$REPO（$BRANCH）"
    git -C $SRC fetch --quiet --depth 1 origin "$BRANCH" && git -C $SRC reset --quiet --hard FETCH_HEAD
  else
    say "拉代码：$REPO（$BRANCH）"
    rm -rf $SRC && git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" $SRC
  fi
  CHECKOUT=$SRC
fi
say "用代码：$CHECKOUT（$(git -C "$CHECKOUT" log -1 --format='%h %cd' --date=short 2>/dev/null || echo '不是 git 仓库')）"
NEW=$HOME_DIR/app.new
rm -rf $NEW && mkdir -p $NEW
# 网页每次现编（dist 不进 git；本地开发留下的旧 dist 也不要）
tar -C "$CHECKOUT" --exclude=node_modules --exclude=.git --exclude=.opero-data --exclude=code/web/dist -cf - code/server code/web LICENSE README.md | tar -C $NEW -xf -
[ -f $NEW/code/server/src/main.ts ] || die "代码不对（没有 code/server/src/main.ts）"
say "装后台依赖"
(cd $NEW/code/server && npm ci --omit=dev --no-audit --no-fund "${REG[@]}" >/dev/null)
if [ ! -f $NEW/code/web/dist/index.html ]; then
  say "编网页（要一两分钟）"
  (cd $NEW/code/web && npm ci --no-audit --no-fund "${REG[@]}" >/dev/null && npm run build >/dev/null)
  rm -rf $NEW/code/web/node_modules
fi
rm -rf $HOME_DIR/app.old
[ -d $APP ] && mv $APP $HOME_DIR/app.old
mv $NEW $APP
chown -R root:root $APP && chmod -R a+rX $APP

# ---------- 目录和配置 ----------
mkdir -p $DATA $WORK $ETC
chown opero:opero $DATA && chmod 700 $DATA
chown opero-ai:opero-work /srv/opero $WORK && chmod 2770 $WORK && chmod 755 /srv/opero
if [ ! -f $ETC/opero.env ]; then
  say "写配置 $ETC/opero.env"
  cat > $ETC/opero.env <<EOF
# Opero 配置（改完 systemctl restart opero）
OPERO_PORT=$PORT
# 只给本机 nginx 用就改成 127.0.0.1
OPERO_HOST=0.0.0.0
OPERO_DATA=$DATA
OPERO_WORK=$WORK
OPERO_WEB=$APP/code/web/dist
OPERO_AI_USER=opero-ai
# 对外地址（配好域名和 HTTPS 后填，比如 https://opero.example.com）
OPERO_URL=
PATH=$NODE_DIR/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EOF
fi
chown root:opero $ETC/opero.env && chmod 640 $ETC/opero.env

# opero 用户能以 opero-ai 跑执行器（带上 API Key 等环境变量），别的不行
cat > /etc/sudoers.d/opero <<'EOF'
Defaults:opero !requiretty
opero ALL=(opero-ai) NOPASSWD:SETENV: ALL
EOF
chmod 440 /etc/sudoers.d/opero
visudo -cf /etc/sudoers.d/opero >/dev/null || { rm -f /etc/sudoers.d/opero; die "sudoers 写错了"; }

# AI 用户登录 shell 里有 Opero 的 Node（装 Codex、跑 npm 用）；新文件默认组内可读写
cat > /etc/profile.d/opero.sh <<EOF
case ":\$PATH:" in *":$NODE_DIR/bin:"*) ;; *) export PATH="\$PATH:$NODE_DIR/bin" ;; esac
[ "\$(id -un)" = opero-ai ] && umask 007
EOF

# ---------- 服务 ----------
cat > /etc/systemd/system/opero.service <<EOF
[Unit]
Description=Opero (self-hosted AI dev team)
After=network-online.target
Wants=network-online.target

[Service]
User=opero
Group=opero
SupplementaryGroups=opero-work
EnvironmentFile=$ETC/opero.env
WorkingDirectory=$APP/code/server
ExecStart=$NODE_DIR/bin/node --disable-warning=ExperimentalWarning src/main.ts
Restart=always
RestartSec=3
UMask=0007
KillMode=mixed
TimeoutStopSec=15
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

cat > /usr/local/bin/opero <<EOF
#!/usr/bin/env bash
# Opero 管理命令
run() { sudo -u opero bash -c "set -a; . $ETC/opero.env; set +a; exec $NODE_DIR/bin/node --disable-warning=ExperimentalWarning $APP/code/server/src/cli.ts \$*"; }
case "\${1:-}" in
  status) systemctl status opero --no-pager ;;
  logs) journalctl -u opero -n 200 -f ;;
  restart) systemctl restart opero ;;
  stop) systemctl stop opero ;;
  start) systemctl start opero ;;
  reset-password) run reset-password ;;
  info) run info ;;
  update) shift; [ "\$(id -u)" = 0 ] || { echo "要 root：sudo opero update"; exit 1; }
    [ -d $SRC/.git ] || git clone --quiet --depth 1 --branch $BRANCH $REPO $SRC || exit 1
    git -C $SRC fetch --quiet --depth 1 origin $BRANCH && git -C $SRC reset --quiet --hard FETCH_HEAD || exit 1
    exec bash $SRC/code/server/scripts/install.sh --update "\$@" ;;
  ai) shift; sudo -u opero-ai -H bash -l "\$@" ;;
  *) echo "用法：opero status | logs | restart | start | stop | info | reset-password | update | ai（切到 AI 用户的 shell，登录 claude / codex）" ;;
esac
EOF
chmod 755 /usr/local/bin/opero

# ---------- AI 执行器 ----------
if [ $UPDATE = 0 ] && [ $CLAUDE = 1 ] && ! sudo -u opero-ai -H bash -lc 'command -v claude' >/dev/null 2>&1; then
  say "给 opero-ai 装 Claude Code"
  sudo -u opero-ai -H bash -lc 'curl -fsSL https://claude.ai/install.sh | bash' || echo "（Claude Code 没装上，之后可以运行：opero ai -c 'curl -fsSL https://claude.ai/install.sh | bash'）"
fi
if [ $CODEX = 1 ] && ! sudo -u opero-ai -H bash -lc 'command -v codex' >/dev/null 2>&1; then
  say "给 opero-ai 装 Codex"
  sudo -u opero-ai -H bash -lc "npm install -g @openai/codex --prefix ~/.local ${REG[*]}" || echo "（Codex 没装上）"
fi

systemctl daemon-reload
systemctl enable opero >/dev/null 2>&1
systemctl restart opero
sleep 2
systemctl is-active --quiet opero || { journalctl -u opero -n 40 --no-pager; die "Opero 没起来，看上面的日志"; }
rm -rf $HOME_DIR/app.old

PORT_NOW=$(grep -E '^OPERO_PORT=' $ETC/opero.env | cut -d= -f2)
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ $UPDATE = 1 ]; then
  say "升级好了：$(cat $APP/code/server/package.json | grep '"version"' | head -1 | tr -d ' ",' | cut -d: -f2)"
else
  cat <<EOF

  Opero 装好了 🎉
  下一步（都在网页上点，不用再敲命令）：
    1. 打开 http://${IP:-服务器IP}:${PORT_NOW}，设主人账号
    2. 开机向导「接 AI 执行器」：点「一键安装 Claude Code」→ 点「开始登录」→ 浏览器里授权 → 贴回授权码
    3. 建员工，开始聊

  正式用建议：配一个域名 + HTTPS（nginx 反代到 127.0.0.1:${PORT_NOW}，例子见 code/server/scripts/nginx.conf），
  然后把 $ETC/opero.env 里的 OPERO_HOST 改成 127.0.0.1、OPERO_URL 填上域名，opero restart
  常用：opero status · opero logs · opero update · opero reset-password
EOF
fi
