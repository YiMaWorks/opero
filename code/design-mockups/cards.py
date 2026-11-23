"""内核固定卡片的示意画法（和 docs/规范/表单与卡片.md 的卡片类型一一对应）。每个函数返回卡片高度。"""
from svgkit import C, tw


def _frame(s, x, y, w, h, accent=None):
    s.rect(x, y, w, h, 12, C["panel"], C["line"], shadow=True)
    if accent:
        s.rect(x, y + 12, 3, h - 24, 1.5, accent)


def _head(s, x, y, w, kind, kind_color, title, tag=None, tag_fg=None, tag_bg=None, size=15):
    s.text(x + 16, y + 24, kind, 12, kind_color, 600)
    kx = x + 16 + tw(kind, 12) + 8
    s.text(kx, y + 24, title, size, C["text"], 600)
    if tag:
        tx = kx + tw(title, size) + 10
        s.pill(tx, y + 11, tag, tag_fg, tag_bg, 11, 7)


def bubble_ai(s, x, y, w, lines, size=14):
    h = 20 + len(lines) * (size + 8)
    s.rect(x, y, w, h, 12, C["panel"], C["line"])
    for i, ln in enumerate(lines):
        s.text(x + 14, y + 24 + i * (size + 8), ln, size, C["text"])
    return h


def bubble_me(s, right, y, text, size=14):
    w = tw(text, size) + 28
    h = size + 22
    s.rect(right - w, y, w, h, 12, C["primary"])
    s.text(right - w + 14, y + h / 2 + size * 0.36, text, size, "#fff")
    return h


def status_line(s, x, y, text, color=C["ok"], spinner=False):
    if spinner:
        s.spinner(x + 6, y - 4)
    else:
        s.dot(x + 6, y - 4, color)
    s.text(x + 18, y, text, 12.5, C["sub"])
    return 22


def system_line(s, cx, y, text):
    w = tw(text, 12) + 24
    s.rect(cx - w / 2, y, w, 24, 12, "#E9EAF1")
    s.text(cx, y + 16, text, 12, C["sub"], 400, "middle")
    return 24


def card_issue(s, x, y, w, compact=False):
    h = 196
    _frame(s, x, y, w, h, C["danger"])
    _head(s, x, y, w, "问题 #42", C["danger"], "支付失败 SIGN_ERR", "严重", C["danger"], C["danger_soft"])
    rows = [("影响", "shop-api 生产 · 微信支付 · 37 次 / 10 分钟"),
            ("原因", "09:40 换了商户密钥，签名还在用缓存里的旧 key"),
            ("建议", "签名器改成每次读配置，换 key 后清缓存")]
    if compact:
        rows = [("影响", "生产 · 微信支付 · 37 次"), ("原因", "换了商户密钥，签名用旧 key"), ("建议", "签名器每次读配置")]
    for i, (k, v) in enumerate(rows):
        yy = y + 54 + i * 24
        s.text(x + 16, yy, k, 13, C["faint"])
        s.text(x + 56, yy, v, 13, C["text"])
    ey = y + 54 + len(rows) * 24 - 4
    ex = x + 16
    ex += s.pill(ex, ey, "日志 3 段", C["primary_text"], C["primary_soft"], 11.5, 8) + 6
    s.pill(ex, ey, "查询 · 5 行", C["primary_text"], C["primary_soft"], 11.5, 8)
    by = y + h - 44
    r = x + w - 14
    r = s.button_r(r, by, "修复", "primary") - 8
    r = s.button_r(r, by, "先盯着") - 8
    s.button_r(r, by, "忽略", "ghost")
    return h


def card_change(s, x, y, w, merged=True, compact=False):
    h = 236
    _frame(s, x, y, w, h, C["primary"])
    title = "shop-api · fix/pay-sign-42" if not compact else "fix/pay-sign-42"
    _head(s, x, y, w, "改动", C["primary"], title, size=14)
    files = [("PayService.java", "+12", "−3"), ("WechatSigner.java", "+8", "−2")]
    for i, (f, a, d) in enumerate(files):
        yy = y + 52 + i * 26
        s.rect(x + 14, yy - 15, w - 28, 22, 6, C["code_bg"])
        s.text(x + 22, yy, f, 12.5, C["text"], 400, mono=True)
        s.text(x + w - 60, yy, a, 12.5, C["ok"], 600, "end", mono=True)
        s.text(x + w - 24, yy, d, 12.5, C["danger"], 600, "end", mono=True)
    cy = y + 118
    s.text(x + 16, cy, "检查", 13, C["faint"])
    cx = x + 56
    for lab in ("编译", "类型检查", "单元测试 48"):
        s.check(cx, cy - 11)
        s.text(cx + 17, cy, lab, 13, C["text"])
        cx += 17 + tw(lab, 13) + 14
    s.text(x + 56, cy + 22, "CI #1832 · 2 分 14 秒", 12, C["faint"])
    if merged:
        s.rect(x + 14, cy + 34, w - 28, 28, 8, C["ok_soft"])
        s.check(x + 24, cy + 42)
        s.text(x + 42, cy + 53, "检查通过，已自动合并到 main", 13, C["ok"], 500)
    by = y + h - 40
    r = x + w - 14
    r = s.button_r(r, by, "看改动", "default", h=30) - 8
    s.button_r(r, by, "撤销合并", "ghost", h=30)
    return h


def card_release(s, x, y, w, compact=False):
    h = 170
    _frame(s, x, y, w, h, C["info"])
    _head(s, x, y, w, "发布", C["info"], "shop-api → 生产 v1.4.2" if not compact else "→ 生产 v1.4.2")
    steps = [("编译", "done"), ("签名", "done"), ("部署", "done"), ("观察", "doing")]
    sx = x + 20
    seg = (w - 40) / (len(steps) - 1)
    sy = y + 62
    for i, (lab, st) in enumerate(steps):
        px = sx + i * seg
        if i < len(steps) - 1:
            s.line(px + 8, sy, px + seg - 8, sy, C["ok"] if steps[i + 1][1] != "todo" else C["line"], 2)
        if st == "done":
            s.check(px - 8, sy - 8, C["ok"], 16)
        else:
            s.circle(px, sy, 8, C["panel"], C["info"], 2)
            s.circle(px, sy, 3, C["info"])
        s.text(px, sy + 26, lab, 12, C["sub"], 400, "middle")
    s.rect(x + 14, y + 104, w - 28, 26, 8, C["info_soft"])
    s.text(x + 24, y + 121, "盯生产报错 6 / 10 分钟 · 没有新的 SIGN_ERR" if not compact else "盯报错 6/10 分钟 · 无新 SIGN_ERR", 12.5, "#0369A1")
    by = y + h - 36
    s.button_r(x + w - 14, by, "回滚到 v1.4.1", "default", h=28, size=12.5)
    s.text(x + 16, by + 19, "有异常会自动回滚", 12, C["faint"])
    return h


def card_query(s, x, y, w, rows=5):
    cols = [("id", 70), ("status", 70), ("err_code", 90), ("created_at", 90)]
    h = 92 + rows * 26 + 36
    _frame(s, x, y, w, h)
    _head(s, x, y, w, "查询", C["sub"], "shop-prod · 只读", size=13.5)
    s.text(x + w - 16, y + 24, "23 ms · 5 行", 12, C["faint"], 400, "end")
    s.rect(x + 14, y + 38, w - 28, 26, 6, C["code_bg"])
    s.text(x + 22, y + 55, "SELECT id,status,err_code … WHERE user_id=10086", 11.5, C["sub"], mono=True)
    ty = y + 84
    cx = x + 18
    for name, cw in cols:
        s.text(cx, ty, name, 12, C["faint"], 600, mono=True)
        cx += cw
    data = [("98213", "failed", "SIGN_ERR", "09:41"), ("98207", "failed", "SIGN_ERR", "09:40"),
            ("98190", "paid", "", "09:12"), ("98172", "paid", "", "08:57"), ("98160", "paid", "", "08:31")]
    for i, row in enumerate(data[:rows]):
        ry = ty + 26 * (i + 1)
        s.line(x + 14, ry - 18, x + w - 14, ry - 18)
        cx = x + 18
        for j, (v, (_, cw)) in enumerate(zip(row, cols)):
            col = C["danger"] if v in ("failed", "SIGN_ERR") else C["text"]
            s.text(cx, ry, v, 12.5, col, 400, mono=True)
            cx += cw
    by = y + h - 34
    bx = x + 14
    for lab in ("展开", "导出", "存成菜单"):
        bx += s.button(bx, by, lab, "default", size=12, h=26, pad=10) + 6
    return h


def card_confirm(s, x, y, w):
    h = 170
    _frame(s, x, y, w, h, C["danger"])
    _head(s, x, y, w, "要你确认", C["danger"], "删除 2,300 行旧订单", "危险", C["danger"], C["danger_soft"])
    s.text(x + 16, y + 56, "shop-prod · DELETE FROM order_tmp WHERE created_at < '2025-01-01'", 12, C["sub"], mono=True)
    s.text(x + 16, y + 82, "已存快照，7 天内可撤销 · 由「shop 开发」发起（替你清理测试数据）", 12.5, C["text"])
    s.rect(x + 14, y + 96, w - 28, 26, 8, C["warn_soft"])
    s.text(x + 24, y + 113, "超过 1000 行属于危险操作，需要你本人验证", 12.5, C["warn"])
    by = y + h - 40
    r = s.button_r(x + w - 14, by, "指纹确认", "danger") - 8
    s.button_r(r, by, "不删", "default")
    return h


def card_ask(s, x, y, w):
    h = 196
    _frame(s, x, y, w, h, C["primary"])
    _head(s, x, y, w, "提问", C["primary"], "旧 key 的缓存怎么处理？")
    opts = [("发布时清一次（推荐）", True), ("改成 5 分钟过期", False), ("不缓存", False)]
    for i, (o, sel) in enumerate(opts):
        oy = y + 44 + i * 34
        s.rect(x + 14, oy, w - 28, 28, 8, C["primary_soft"] if sel else C["panel"], C["primary"] if sel else C["line"])
        s.circle(x + 30, oy + 14, 6, "none", C["primary"] if sel else C["faint"], 1.6)
        if sel:
            s.circle(x + 30, oy + 14, 3, C["primary"])
        s.text(x + 44, oy + 19, o, 13, C["text"])
    by = y + h - 42
    s.button_r(x + w - 14, by, "提交", "primary")
    s.text(x + 16, by + 21, "AI 推荐的已选好", 12, C["faint"])
    return h


def card_file(s, x, y, w):
    h = 62
    _frame(s, x, y, w, h)
    s.rect(x + 12, y + 12, 38, 38, 8, C["primary_soft"])
    s.text(x + 31, y + 36, "LOG", 11, C["primary_text"], 700, "middle")
    s.text(x + 60, y + 29, "sign-error-0940.log", 13.5, C["text"], 500)
    s.text(x + 60, y + 48, "12 KB · 点开预览", 12, C["faint"])
    return h


def card_text(s, x, y, w):
    lines = ["最近 5 单都是 SIGN_ERR，09:40 开始，", "和日志里换密钥的时间一致。"]
    return bubble_ai(s, x, y, w, lines)
