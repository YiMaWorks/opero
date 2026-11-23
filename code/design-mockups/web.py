"""网页主界面：导航 · 会话列表 · 聊天（主线：问题 → 修 → 改动 → 发布） · 右侧改动面板。"""
from svgkit import SVG, C, tw, nav_icon
import cards

W, H = 1600, 1000
s = SVG(W, H)

# ---- 一级导航 ----
NX = 72
s.rect(0, 0, NX, H, 0, C["nav"])
s.rect(16, 18, 40, 40, 12, C["primary"])
s.text(36, 45, "O", 20, "#fff", 700, "middle")
items = [("chat", "会话", True, 3), ("people", "员工", False, 0), ("folder", "工作空间", False, 0), ("apps", "应用", False, 0)]
for i, (k, lab, act, badge) in enumerate(items):
    y = 86 + i * 74
    if act:
        s.rect(8, y - 6, 56, 62, 12, "#262A3B")
    col = "#FFFFFF" if act else C["nav_text"]
    nav_icon(s, k, 24, y, col)
    s.text(36, y + 44, lab, 11, col, 500 if act else 400, "middle")
    if badge:
        s.circle(52, y, 8, C["danger"])
        s.text(52, y + 4, str(badge), 10, "#fff", 600, "middle")
nav_icon(s, "me", 24, H - 76, C["nav_text"])
s.text(36, H - 32, "我", 11, C["nav_text"], 400, "middle")

# ---- 会话列表 ----
LX, LW = NX, 300
s.rect(LX, 0, LW, H, 0, "#FBFBFD")
s.line(LX + LW, 0, LX + LW, H)
s.rect(LX + 16, 18, LW - 64, 36, 10, "#EFF0F5")
s.text(LX + 30, 41, "搜索会话、员工、项目", 13, C["faint"])
s.rect(LX + LW - 42, 18, 30, 36, 10, "#EFF0F5")
s.text(LX + LW - 27, 42, "+", 18, C["sub"], 400, "middle")

y = 82
s.text(LX + 18, y, "等我处理 · 1", 12, C["warn"], 600)
y += 12
s.rect(LX + 10, y, LW - 20, 64, 12, C["warn_soft"])
s.avatar(LX + 20, y + 12, 40, "开")
s.text(LX + 72, y + 29, "mov 开发", 14, C["text"], 600)
s.text(LX + LW - 22, y + 29, "10:20", 11.5, C["faint"], 400, "end")
s.text(LX + 72, y + 50, "删除 2,300 行旧订单 · 要指纹", 12.5, C["warn"])
y += 84
s.text(LX + 18, y, "员工", 12, C["faint"], 600)
y += 10
rows = [
    ("Y", "mov 日志值班", "● 在盯生产 · 6 分钟无新报错", "09:52", True, 0, C["ok"]),
    ("发", "发布", "mov-market v1.4.2 已上生产", "09:51", False, 0, None),
    ("运", "运维", "AWS-dev 磁盘清理了 3.2 GB", "09:30", False, 2, None),
    ("总", "总调度", "已派给「发布」和「运维」", "昨天", False, 0, None),
    ("管", "系统管家", "新员工「uugo 开发」建好了", "昨天", False, 0, None),
]
for av, name, last, t, act, badge, st in rows:
    if act:
        s.rect(LX + 10, y, LW - 20, 64, 12, C["primary_soft"])
    s.avatar(LX + 20, y + 12, 40, av)
    if badge:
        s.circle(LX + 58, y + 14, 8, C["danger"])
        s.text(LX + 58, y + 18, str(badge), 10, "#fff", 600, "middle")
    s.text(LX + 72, y + 29, name, 14, C["text"], 600)
    s.text(LX + LW - 22, y + 29, t, 11.5, C["faint"], 400, "end")
    s.text(LX + 72, y + 50, last, 12.5, st or C["sub"])
    y += 70
s.text(LX + 18, y + 18, "所有员工的后台活（扫描、员工之间派活）不进这里", 11.5, C["faint"])

# ---- 聊天 ----
CX, CW = LX + LW, 720
s.rect(CX, 0, CW, H, 0, C["bg"])
s.rect(CX, 0, CW, 72, 0, C["panel"])
s.line(CX, 72, CX + CW, 72)
s.avatar(CX + 20, 16, 40, "Y")
s.text(CX + 72, 34, "mov 日志值班", 16, C["text"], 600)
s.text(CX + 72, 55, "mov 三个项目的线上问题 · Claude Code · AWS-dev", 12.5, C["sub"])
r = s.button_r(CX + CW - 20, 20, "···", "default", h=32, pad=10) - 8
s.button_r(r, 20, "档案", "default", h=32)

mx = CX + 28
mw = 500
y = 92
cards.system_line(s, CX + CW / 2, y, "09:41 · 日志扫描发现新异常：支付失败 37 次")
y += 40
s.avatar(mx, y, 30, "Y")
y += cards.card_issue(s, mx + 40, y, mw) + 14
y += cards.bubble_me(s, CX + CW - 28, y, "修，顺便把缓存问题一起处理") + 14
s.avatar(mx, y, 30, "Y")
cards.status_line(s, mx + 42, y + 18, "派给「mov 开发」· 改完已检查通过、自动合并")
y += 30
y += cards.card_change(s, mx + 40, y, mw) + 14
s.avatar(mx, y, 30, "Y")
cards.card_release(s, mx + 40, y, mw)

# 底部菜单 + 输入
by = H - 132
s.rect(CX, by, CW, 132, 0, C["panel"])
s.line(CX, by, CX + CW, by)
menus = ["问题清单", "日志扫描", "查生产库", "发布记录"]
mwid = (CW - 60) / len(menus)
s.rect(CX + 16, by + 12, 28, 24, 6, "#EFF0F5")
s.text(CX + 30, by + 29, "≡", 14, C["sub"], 400, "middle")
for i, m in enumerate(menus):
    x0 = CX + 52 + i * mwid
    if i:
        s.line(x0, by + 16, x0, by + 32)
    s.text(x0 + mwid / 2, by + 29, m, 13.5, C["text"], 500, "middle")
s.line(CX, by + 48, CX + CW, by + 48)
s.text(CX + 22, by + 80, "跟「mov 日志值班」说点什么…（Enter 发送）", 14, C["faint"])
s.text(CX + 22, by + 114, "附件   截图   语音", 12.5, C["sub"])
s.button_r(CX + CW - 20, by + 90, "发送", "primary", h=32)

# ---- 右侧面板：看改动 ----
PX = CX + CW
PW = W - PX
s.rect(PX, 0, PW, H, 0, C["panel"])
s.line(PX, 0, PX, H)
s.text(PX + 22, 36, "看改动", 16, C["text"], 600)
s.text(PX + 22, 57, "fix/pay-sign-42 · 2 个文件 +20 −5 · 已合并", 12.5, C["sub"])
s.text(PX + PW - 22, 40, "×", 20, C["faint"], 400, "end")
s.line(PX, 72, PX + PW, 72)
tx = PX + 16
tx += s.pill(tx, 84, "PayService.java  +12 −3", C["primary_text"], C["primary_soft"], 12, 10, 26) + 8
s.pill(tx, 84, "WechatSigner.java  +8 −2", C["sub"], "#F0F1F5", 12, 10, 26)

code = [
    (" ", "52", "  public PayResult pay(Order o) {"),
    (" ", "53", "    PayReq req = build(o);"),
    ("-", "54", "    String sign = signer.sign(req, cachedKey);"),
    ("+", "54", "    String key = config.merchantKey();"),
    ("+", "55", "    String sign = signer.sign(req, key);"),
    (" ", "56", "    return client.send(req, sign);"),
    (" ", "57", "  }"),
    ("@", "", "@@ 88,6 +89,14 @@ onConfigChanged"),
    (" ", "89", "  void onConfigChanged(Config c) {"),
    ("-", "90", "    // TODO"),
    ("+", "90", "    if (c.changed(\"merchantKey\")) {"),
    ("+", "91", "      signer.clearCache();"),
    ("+", "92", "      log.info(\"merchant key rotated\");"),
    ("+", "93", "    }"),
    (" ", "94", "  }"),
]
cy = 130
for kind, ln, txt in code:
    if kind == "@":
        s.rect(PX + 12, cy - 15, PW - 24, 24, 0, "#F1F0FE")
        s.text(PX + 22, cy + 1, txt, 12, C["primary_text"], 400, mono=True)
        cy += 26
        continue
    bg = {"+": C["add"], "-": C["del"]}.get(kind)
    if bg:
        s.rect(PX + 12, cy - 15, PW - 24, 24, 0, bg)
    s.text(PX + 44, cy + 1, ln, 12, C["faint"], 400, "end", mono=True)
    col = {"+": C["ok"], "-": C["danger"]}.get(kind, C["faint"])
    s.text(PX + 56, cy + 1, kind if kind != " " else "", 12.5, col, 700, mono=True)
    s.text(PX + 72, cy + 1, txt, 12.5, C["text"], 400, mono=True)
    cy += 24
cy += 16
s.rect(PX + 16, cy, PW - 32, 92, 12, C["code_bg"], C["line"])
s.text(PX + 32, cy + 28, "员工说明", 12.5, C["faint"], 600)
s.text(PX + 32, cy + 52, "签名不再用缓存的 key，每次从配置取；配置里的", 13, C["text"])
s.text(PX + 32, cy + 74, "merchantKey 变了就清签名缓存。", 13, C["text"])
cy += 112
r = s.button_r(PX + PW - 16, cy, "撤销合并", "default") - 8
s.button_r(r, cy, "对这里说…", "ghost")

s.save("web.svg")
