"""手机（安卓）四屏：会话列表 · 问题卡片 · 改动 + 发布 · 看改动。"""
from svgkit import SVG, C, tw, nav_icon
import cards

PW, PH, GAP, TOP = 390, 844, 50, 40
W = PW * 4 + GAP * 5
H = PH + TOP + 90
s = SVG(W, H, "#ECEDF3")
SX = 8           # 屏幕内边距
SW = PW - SX * 2


def phone(i):
    x = GAP + i * (PW + GAP)
    s.rect(x, TOP, PW, PH, 52, "#14161F")
    s.rect(x + SX, TOP + SX, SW, PH - SX * 2, 44, C["bg"])
    s.text(x + 40, TOP + 40, "9:52", 14, C["text"], 600)
    s.rect(x + PW / 2 - 50, TOP + 22, 100, 26, 13, "#14161F")
    s.rect(x + PW - 66, TOP + 29, 26, 12, 3, "none", C["text"], 1.4)
    s.rect(x + PW - 64, TOP + 31, 18, 8, 1.5, C["text"])
    return x + SX, TOP + SX


def header(x, y, title, sub=None, back=True, av=None):
    s.rect(x, y + 50, SW, 56, 0, C["panel"])
    s.line(x, y + 106, x + SW, y + 106)
    if back:
        s.text(x + 18, y + 86, "‹", 26, C["text"], 400)
    tx = x + 44
    if av:
        s.avatar(tx, y + 62, 32, av)
        tx += 42
    s.text(tx, y + 76 if sub else y + 84, title, 16, C["text"], 600)
    if sub:
        s.text(tx, y + 96, sub, 11.5, C["sub"])
    s.text(x + SW - 20, y + 84, "···", 16, C["sub"], 600, "end")


def bottom_menu(x, y, items, input_label="按住 说话"):
    by = y + PH - SX * 2 - 118
    s.rect(x, by, SW, 118, 0, C["panel"])
    s.line(x, by, x + SW, by)
    s.rect(x + 12, by + 10, 26, 22, 6, "#EFF0F5")
    s.text(x + 25, by + 26, "≡", 13, C["sub"], 400, "middle")
    seg = (SW - 50) / len(items)
    for i, m in enumerate(items):
        mx = x + 46 + i * seg
        if i:
            s.line(mx, by + 14, mx, by + 28)
        s.text(mx + seg / 2, by + 26, m, 13, C["text"], 500, "middle")
    s.line(x, by + 42, x + SW, by + 42)
    s.circle(x + 28, by + 72, 15, "none", C["sub"], 1.5)
    s.rect(x + 24, by + 63, 8, 12, 4, "none", C["sub"], 1.5)
    s.rect(x + 54, by + 55, SW - 108, 36, 10, "#EFF0F5")
    s.text(x + SW / 2, by + 78, input_label, 14, C["text"], 600, "middle")
    s.circle(x + SW - 28, by + 72, 15, "none", C["sub"], 1.5)
    s.text(x + SW - 28, by + 78, "+", 18, C["sub"], 400, "middle")


def caption(i, t):
    s.caption(GAP + i * (PW + GAP) + PW / 2, TOP + PH + 40, t)


# ---- 1 会话列表 ----
x, y = phone(0)
s.text(x + 20, y + 92, "Opero", 24, C["text"], 700)
s.circle(x + SW - 60, y + 82, 9, "none", C["text"], 1.8)
s.line(x + SW - 53, y + 89, x + SW - 48, y + 94, C["text"], 1.8)
s.circle(x + SW - 24, y + 84, 11, "none", C["text"], 1.8)
s.text(x + SW - 24, y + 90, "+", 16, C["text"], 500, "middle")
yy = y + 118
s.rect(x + 12, yy, SW - 24, 92, 14, C["warn_soft"])
s.text(x + 26, yy + 26, "等我处理 · 1", 12.5, C["warn"], 600)
s.avatar(x + 26, yy + 38, 40, "开")
s.text(x + 76, yy + 56, "mov 开发", 14.5, C["text"], 600)
s.text(x + 76, yy + 77, "删除 2,300 行旧订单", 12.5, C["warn"])
s.button_r(x + SW - 24, yy + 46, "去确认", "primary", h=30, size=12.5, pad=12)
yy += 108
rows = [("Y", "mov 日志值班", "● 在盯生产 · 6 分钟无新报错", "09:52", C["ok"], 0),
        ("发", "发布", "mov-market v1.4.2 已上生产", "09:51", None, 0),
        ("运", "运维", "AWS-dev 磁盘清理了 3.2 GB", "09:30", None, 2),
        ("总", "总调度", "已派给「发布」和「运维」", "昨天", None, 0),
        ("管", "系统管家", "新员工「uugo 开发」建好了", "昨天", None, 0),
        ("开", "uugo 开发", "首页改版做完了，预览链接…", "周一", None, 0)]
for av, name, last, t, col, badge in rows:
    s.rect(x, yy, SW, 74, 0, C["panel"])
    s.avatar(x + 18, yy + 14, 46, av)
    if badge:
        s.circle(x + 62, yy + 16, 9, C["danger"])
        s.text(x + 62, yy + 20, str(badge), 10.5, "#fff", 600, "middle")
    s.text(x + 76, yy + 34, name, 15, C["text"], 600)
    s.text(x + SW - 18, yy + 34, t, 11.5, C["faint"], 400, "end")
    s.text(x + 76, yy + 57, last, 13, col or C["sub"])
    s.line(x + 76, yy + 74, x + SW, yy + 74)
    yy += 74
ty = y + PH - SX * 2 - 84
s.rect(x, ty, SW, 84, 0, C["panel"])
s.line(x, ty, x + SW, ty)
tabs = [("chat", "会话", True, 3), ("people", "员工", False, 0), ("folder", "工作空间", False, 0), ("me", "我", False, 0)]
for i, (k, lab, act, b) in enumerate(tabs):
    cx = x + SW / 8 + i * SW / 4
    col = C["primary"] if act else C["faint"]
    nav_icon(s, k, cx - 12, ty + 12, col)
    s.text(cx, ty + 54, lab, 11, col, 500, "middle")
    if b:
        s.circle(cx + 14, ty + 13, 8, C["danger"])
        s.text(cx + 14, ty + 17, str(b), 10, "#fff", 600, "middle")
caption(0, "会话列表：「等我处理」置顶，只有真要你决定的才在这")

# ---- 2 问题卡片 ----
x, y = phone(1)
header(x, y, "mov 日志值班", "Claude Code · AWS-dev", av="Y")
yy = y + 124
cards.system_line(s, x + SW / 2, yy, "09:41 · 日志扫描发现新异常")
yy += 38
s.avatar(x + 12, yy, 26, "Y")
yy += cards.card_issue(s, x + 44, yy, SW - 58, compact=True) + 12
s.avatar(x + 12, yy, 26, "Y")
yy += cards.card_file(s, x + 44, yy, SW - 58) + 14
yy += cards.bubble_me(s, x + SW - 14, yy, "修，顺便把缓存问题一起处理") + 12
s.avatar(x + 12, yy, 26, "Y")
cards.status_line(s, x + 44, yy + 17, "派给「mov 开发」…", spinner=True)
bottom_menu(x, y, ["问题清单", "日志扫描", "更多"])
caption(1, "聊天：问题卡片 + 底部菜单 + 按住说话")

# ---- 3 改动 + 发布 ----
x, y = phone(2)
header(x, y, "mov 日志值班", "Claude Code · AWS-dev", av="Y")
yy = y + 120
s.avatar(x + 12, yy, 26, "Y")
cards.status_line(s, x + 44, yy + 17, "「mov 开发」改完了，检查通过")
yy += 32
yy += cards.card_change(s, x + 44, yy, SW - 58, compact=True) + 12
s.avatar(x + 12, yy, 26, "Y")
yy += cards.card_release(s, x + 44, yy, SW - 58, compact=True) + 10
bottom_menu(x, y, ["问题清单", "日志扫描", "更多"])
caption(2, "改动自动检查、合并；发布后自动盯报错，坏了就回滚")

# ---- 4 看改动（全屏） ----
x, y = phone(3)
header(x, y, "看改动", "fix/pay-sign-42 · +20 −5 · 已合并")
yy = y + 118
tx = x + 12
tx += s.pill(tx, yy, "PayService.java", C["primary_text"], C["primary_soft"], 12, 10, 26) + 6
s.pill(tx, yy, "WechatSigner.java", C["sub"], "#E9EAF1", 12, 10, 26)
yy += 46
s.rect(x, yy - 8, SW, 410, 0, C["panel"])
code = [(" ", "53", "PayReq req = build(o);"),
        ("-", "54", "String sign = signer.sign("),
        ("-", "", "    req, cachedKey);"),
        ("+", "54", "String key ="),
        ("+", "", "    config.merchantKey();"),
        ("+", "55", "String sign ="),
        ("+", "", "    signer.sign(req, key);"),
        (" ", "56", "return client.send(req, sign);"),
        ("@", "", "··· 32 行没改，点开 ···"),
        (" ", "89", "void onConfigChanged(Config c) {"),
        ("-", "90", "  // TODO"),
        ("+", "90", "  if (c.changed(\"merchantKey\")) {"),
        ("+", "91", "    signer.clearCache();"),
        ("+", "92", "  }"),
        (" ", "93", "}")]
for kind, ln, t in code:
    if kind == "@":
        s.rect(x, yy - 16, SW, 26, 0, "#F1F0FE")
        s.text(x + SW / 2, yy + 1, t, 12, C["primary_text"], 400, "middle")
        yy += 27
        continue
    bg = {"+": C["add"], "-": C["del"]}.get(kind)
    if bg:
        s.rect(x, yy - 16, SW, 26, 0, bg)
    s.text(x + 30, yy + 1, ln, 11.5, C["faint"], 400, "end", mono=True)
    s.text(x + 40, yy + 1, kind if kind != " " else "", 12, {"+": C["ok"], "-": C["danger"]}.get(kind, C["faint"]), 700, mono=True)
    s.text(x + 54, yy + 1, t, 12.5, C["text"], 400, mono=True)
    yy += 26
yy += 18
s.rect(x + 12, yy, SW - 24, 70, 12, C["panel"], C["line"])
s.text(x + 26, yy + 26, "员工说明", 12, C["faint"], 600)
s.text(x + 26, yy + 50, "签名每次从配置取 key；key 变了清缓存。", 12.5, C["text"])
by = y + PH - SX * 2 - 86
s.rect(x, by, SW, 86, 0, C["panel"])
s.line(x, by, x + SW, by)
half = (SW - 36) / 2
s.rect(x + 12, by + 14, half, 42, 10, "#fff", C["line"])
s.text(x + 12 + half / 2, by + 41, "撤销合并", 14, C["text"], 500, "middle")
s.rect(x + 24 + half, by + 14, half, 42, 10, C["primary"])
s.text(x + 24 + half * 1.5, by + 41, "对这里说…", 14, "#fff", 500, "middle")
caption(3, "手机看改动：单栏、长行折行、没改的收起")

# 屏幕圆角外的部分用机身颜色盖住
for i in range(4):
    px = GAP + i * (PW + GAP)
    ox, oy, iw, ih, r = px + SX, TOP + SX, SW, PH - SX * 2, 44
    R = 52
    d = (f"M{px+R},{TOP} h{PW-2*R} a{R},{R} 0 0 1 {R},{R} v{PH-2*R} a{R},{R} 0 0 1 {-R},{R} "
         f"h{-(PW-2*R)} a{R},{R} 0 0 1 {-R},{-R} v{-(PH-2*R)} a{R},{R} 0 0 1 {R},{-R} z "
         f"M{ox+r},{oy} h{iw-2*r} a{r},{r} 0 0 1 {r},{r} v{ih-2*r} a{r},{r} 0 0 1 {-r},{r} "
         f"h{-(iw-2*r)} a{r},{r} 0 0 1 {-r},{-r} v{-(ih-2*r)} a{r},{r} 0 0 1 {r},{-r} z")
    s.add(f'<path d="{d}" fill="#14161F" fill-rule="evenodd"/>')
    s.rect(px, TOP, PW, PH, 52, "none", "#14161F", 1)

s.save("mobile.svg")
