"""核心界面的变化（不止流程）：日志巡检 / Bug 处理 / 运维，各一张「以前的界面 → Opero 的界面」，带标注。
用法：python3 screens.py   → docs/界面设计/opero-界面-日志巡检.png、opero-界面-bug处理.png、opero-界面-运维.png
"""
import subprocess

from svgkit import SVG, tw
from flows import (BRAND, INK, SUB, FAINT, RED, RED_SOFT, ORANGE, ORANGE_SOFT, GREEN, GREEN_SOFT, OLD_BG,
                   defs, header, chip, emp_avatar, me_badge, win, bubble, mini_card, code_lines)

BLUE = "#2B59FF"
MONO_RED = "#F48771"
MONO_YEL = "#DCDCAA"
MONO_GRY = "#9AA0AC"


# ---------- 通用 ----------
def panels(s, left_title, right_title):
    s.add(f'<rect x="40" y="140" width="760" height="720" rx="20" fill="{OLD_BG}" stroke="#E4E5EA"/>')
    chip(s, 64, 160, left_title, "#fff", "#9096A3", 15, 32)
    s.add(f'<rect x="820" y="140" width="740" height="720" rx="20" fill="url(#newlane)" stroke="#DCD7FF"/>')
    chip(s, 844, 160, right_title, "#fff", BRAND, 15, 32)


def callout(s, n, x, y, lx, ly, text, new=False, w=None):
    """在 (x,y) 放编号点；说明框左上角在 (lx, ly - 高/2)，引线连到框最近的一边。"""
    col = BRAND if new else RED
    lines = text if isinstance(text, list) else [text]
    bw = max(w or 0, max(tw(t, 13) for t in lines) + 24)
    bh = 14 + len(lines) * 19
    bx, by = lx, ly - bh / 2
    if by > y + 20:      # 框在下面：连到框顶中间
        ex, ey = bx + min(bw / 2, 40), by
    elif bx > x:         # 框在右边：连到框左边
        ex, ey = bx, ly
    else:
        ex, ey = bx + bw, ly
    s.add(f'<path d="M{x},{y} L{ex},{ey}" stroke="{col}" stroke-width="1.4" stroke-dasharray="4 3" fill="none"/>')
    s.add(f'<circle cx="{x}" cy="{y}" r="13" fill="#FFFFFF"/>')
    s.circle(x, y, 11, col)
    s.text(x, y + 4.5, str(n), 12, "#fff", 700, "middle")
    s.add(f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="9" fill="#FFFFFF" stroke="{col}" stroke-opacity=".5"/>')
    for i, t in enumerate(lines):
        s.text(bx + 12, by + 22 + i * 19, t, 13, INK if i == 0 else SUB, 600 if i == 0 else 400)


def phone(s, x, y, emp, name, sub, menus, w=330, h=660):
    s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="38" fill="#14161F"/>')
    s.add(f'<rect x="{x+10}" y="{y+10}" width="{w-20}" height="{h-20}" rx="30" fill="#F4F5F8"/>')
    s.rect(x + 10, y + 40, w - 20, 54, 0, "#FFFFFF")
    s.text(x + 28, y + 73, "‹", 22, SUB)
    emp_avatar(s, x + 48, y + 52, emp, 30)
    s.text(x + 88, y + 65, name, 14, INK, 700)
    s.text(x + 88, y + 83, sub, 11, FAINT)
    # 底部菜单 + 输入
    by = y + h - 104
    s.rect(x + 10, by, w - 20, 40, 0, "#FFFFFF")
    s.line(x + 10, by, x + w - 10, by, "#ECEDF2")
    cw = (w - 60) / len(menus)
    for i, m in enumerate(menus):
        s.text(x + 50 + cw * i + cw / 2, by + 25, m, 12.5, INK, 600, "middle")
        if i:
            s.line(x + 50 + cw * i, by + 8, x + 50 + cw * i, by + 32, "#ECEDF2")
    s.text(x + 30, by + 26, "≡", 15, SUB)
    s.rect(x + 10, by + 40, w - 20, 54, 0, "#FFFFFF")
    s.line(x + 10, by + 40, x + w - 10, by + 40, "#ECEDF2")
    s.add(f'<rect x="{x+24}" y="{by+50}" width="{w-96}" height="34" rx="17" fill="#F4F5F8"/>')
    s.text(x + w / 2 - 24, by + 72, "按住 说话", 13, INK, 600, "middle")
    s.add(f'<circle cx="{x+w-44}" cy="{by+67}" r="17" fill="url(#brand)"/>')
    s.path(f"M{x+w-51},{by+67} h14 M{x+w-44},{by+60} v14", "#fff", 2)
    return x + 22, y + 108, w - 44


def card2(s, x, y, w, kind, color, title, rows, buttons, tag=None, tagc=None, quote=None):
    """更像 Opero 的卡片：小字头 + 标题 + 行 + 按钮（主按钮在前）。"""
    h = 52 + len(rows) * 20 + (40 if quote else 0) + (40 if buttons else 6)
    s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="#FFFFFF" stroke="#ECEDF2"/>')
    s.add(f'<rect x="{x+6}" y="{y+12}" width="3" height="{h-24}" rx="1.5" fill="{color}"/>')
    s.text(x + 18, y + 22, kind, 11.5, color, 700)
    if tag:
        tw_ = tw(tag, 11) + 14
        s.rect(x + w - tw_ - 12, y + 10, tw_, 18, 9, tagc[1])
        s.text(x + w - tw_ / 2 - 12, y + 23, tag, 11, tagc[0], 600, "middle")
    s.text(x + 18, y + 44, title, 14, INK, 700)
    yy = y + 66
    if quote:
        s.rect(x + 18, yy - 12, w - 36, 32, 6, "#F1F2F6")
        s.rect(x + 18, yy - 12, 3, 32, 1.5, "#D5D8E0")
        s.text(x + 30, yy + 8, quote, 12, INK)
        yy += 40
    kw = max([44] + [tw(r[0], 12) + 10 for r in rows if isinstance(r, tuple)])
    for i, r in enumerate(rows):
        k, v = r if isinstance(r, tuple) else ("", r)
        if k:
            s.text(x + 18, yy + i * 20, k, 12, FAINT)
            s.text(x + 18 + kw, yy + i * 20, v, 12, SUB)
        else:
            s.text(x + 18, yy + i * 20, v, 12, SUB)
    if buttons:
        bx, by = x + 18, y + h - 36
        links = [b[1:] for b in buttons if b.startswith("~")]
        buttons = [b for b in buttons if not b.startswith("~")]
        for j, b in enumerate(buttons):
            bw = tw(b, 12.5) + 22
            if j == 0:
                s.add(f'<rect x="{bx}" y="{by}" width="{bw}" height="26" rx="7" fill="{BRAND}"/>')
                s.text(bx + bw / 2, by + 17.5, b, 12.5, "#fff", 600, "middle")
            else:
                s.rect(bx, by, bw, 26, 7, "#FFFFFF", "#E2E4EA")
                s.text(bx + bw / 2, by + 17.5, b, 12.5, INK, 500, "middle")
            bx += bw + 8
        # 右边的文字链接：放得下才画，免得压到按钮
        for t in links:
            if bx + tw(t, 12.5) + 8 < x + w - 18:
                s.text(x + w - 18, by + 17.5, t, 12.5, SUB, 500, "end")
    return h


def sysline(s, cx, y, text):
    s.text(cx, y, text, 11, FAINT, 400, "middle")


def bottom(s, rows):
    y0 = 882
    s.rect(40, y0, 1520, 200, 18, "#FFFFFF", "#E8E9EE")
    s.text(260, y0 + 32, "以前的界面", 14, FAINT, 700)
    s.text(860, y0 + 32, "Opero 的界面", 14, BRAND, 700)
    for i, (k, a, b) in enumerate(rows):
        yy = y0 + 70 + i * 38
        s.line(64, yy - 26, 1536, yy - 26, "#F0F1F4")
        s.text(70, yy, k, 15, INK, 700)
        s.text(260, yy, a, 15, SUB)
        s.text(820, yy, "→", 16, BRAND, 700)
        s.text(860, yy, b, 15, INK, 600)


OUT = {"dir": "../../docs/界面设计/"}


def save(s, name, png):
    s.save(name)
    subprocess.run(["rsvg-convert", "-z", "2", name, "-o", OUT["dir"] + png], check=True)


# ---------- 1 日志巡检 ----------
def patrol():
    s = SVG(1600, 1110, "#FAFAFC")
    defs(s)
    header(s, "日志巡检：界面的变化", "以前盯着终端和日志平台自己挑错误；现在打开「日志值班」的聊天，只看它整理好的问题卡片")
    panels(s, "以前 · 终端 + 日志平台", "现在 · 和「日志值班」聊天")

    # 日志平台（后面）
    win(s, 300, 214, 470, 300, "日志平台 · 搜索", dark=False)
    s.rect(316, 254, 438, 30, 7, "#F4F5F8", "#E2E4EA")
    s.text(328, 274, 'level:ERROR AND service:shop-api', 12, SUB, mono=True)
    import random
    rnd = random.Random(7)
    for i in range(36):
        hh = rnd.randint(6, 60)
        s.rect(318 + i * 12, 360 - hh, 9, hh, 2, "#F4A6A0" if hh > 45 else "#C9D3F2")
    for i in range(6):
        s.rect(318, 376 + i * 22, 430, 14, 3, "#F1F2F6")
        s.rect(322, 379 + i * 22, 60, 8, 3, "#E9B4AE")
        s.rect(390, 379 + i * 22, 200 + rnd.randint(0, 140), 8, 3, "#DADDE4")
    # 终端（前面）
    win(s, 70, 330, 520, 400, "ssh deploy@prod-1-1 — 终端")
    logs = [
        ("$ zgrep ERROR /var/log/shop/app.log.*.gz | wc -l", MONO_GRY),
        ("21384", MONO_GRY),
        ("$ grep ERROR app.log | tail -n 14", MONO_GRY),
        ("10:21:07 ERROR SIGN_ERR invalid signature", MONO_RED),
        ("10:21:07 WARN  pool slow 812ms", MONO_YEL),
        ("10:21:08 ERROR SIGN_ERR invalid signature", MONO_RED),
        ("10:21:09 ERROR NPE OrderService.java:214", MONO_RED),
        ("10:21:09 WARN  retry 2/3 redis", MONO_YEL),
        ("10:21:11 ERROR SIGN_ERR invalid signature", MONO_RED),
        ("10:21:12 ERROR timeout /api/coupon 5000ms", MONO_RED),
        ("10:21:12 WARN  deprecated api v1", MONO_YEL),
        ("10:21:14 ERROR SIGN_ERR invalid signature", MONO_RED),
        ("10:21:15 ERROR NPE OrderService.java:214", MONO_RED),
        ("10:21:15 WARN  pool slow 903ms", MONO_YEL),
        ("10:21:16 ERROR SIGN_ERR invalid signature", MONO_RED),
        ("$ ssh deploy@prod-1-2   # 下一台…", MONO_GRY),
    ]
    for i, (t, c) in enumerate(logs):
        s.text(86, 374 + i * 21, t, 12, c, mono=True)
    callout(s, 1, 330, 470, 70, 800, ["几万行原始日志", "错误、警告混在一起，自己挑"], w=230)
    callout(s, 2, 300, 688, 316, 800, ["每台服务器各登一遍", "日志平台、终端来回切"], w=220)
    callout(s, 3, 700, 330, 552, 800, ["分不清新老问题", "看不出原因和影响"], w=220)

    # 手机
    cx, cy, cw = phone(s, 870, 206, "值", "shop 日志值班", "在盯 shop 三个项目 · 每 5 分钟", ["问题清单", "日志扫描", "查生产库"])
    sysline(s, cx + cw / 2, cy + 6, "今天 09:30")
    h = card2(s, cx, cy + 16, cw, "早报", BLUE, "昨晚扫了 3 台 · 2.1 万行日志", [("新问题", "1 个（严重）"), ("老问题", "4 个，没变多"), ("已忽略", "12 类，没提醒你")], ["看问题清单"])
    y = cy + 16 + h + 10
    h = card2(s, cx, y, cw, "问题 #42", RED, "支付签名失败 37 次（新）", [("原因", "微信证书 11-20 换了，代码还用旧的"), ("影响", "约 6% 订单付不了款"), ("开始", "今天 10:21，还在增加")], ["修复", "先盯着", "~忽略"], tag="严重", tagc=(RED, RED_SOFT))
    callout(s, 1, cx + cw + 4, cy + 40, 1268, 260, ["只报新问题", "同一种错误合成一条，老的不吵你"], new=True)
    callout(s, 2, cx + cw + 4, y + 80, 1268, 420, ["原因、影响、从什么时候", "它先查完：看代码行、查库算影响"], new=True)
    callout(s, 3, cx + cw + 4, y + h - 23, 1268, 600, ["一个按钮交给开发员工", "忽略的同类以后不再提醒"], new=True)
    callout(s, 4, 1188, 782, 1268, 760, ["底部菜单直达", "问题清单、日志扫描、查生产库"], new=True)

    bottom(s, [("你看到的", "几万行原始日志 + 柱状图", "一张卡片：原因 · 影响 · 建议"),
               ("你要做的", "登服务器、写 grep、自己判断", "选「修复 / 先盯着 / 忽略」"),
               ("多台服务器", "一台台登上去看", "员工每 5 分钟全扫一遍"),
               ("在哪", "电脑前，终端 + 日志平台", "手机上一个会话")])
    save(s, "screen-patrol.svg", "opero-界面-日志巡检.png")


# ---------- 2 Bug 处理 ----------
def bug():
    s = SVG(1600, 1110, "#FAFAFC")
    defs(s)
    header(s, "Bug 处理：界面的变化", "以前在工单系统里来回问、在 IDE 里改、在流水线里等；现在在和「开发员工」的聊天里，从截图到上线")
    panels(s, "以前 · 工单 + IDE + 流水线", "现在 · 和「shop 开发」聊天")

    # 工单
    win(s, 70, 214, 470, 430, "工单 · SHOP-1024 导出订单报错", dark=False)
    s.text(90, 270, "SHOP-1024  导出 10 月订单报错", 16, INK, 700)
    for i, (k, v, c) in enumerate([("状态", "处理中", ORANGE), ("经办人", "张三 → 李四 → 张三", SUB), ("优先级", "高", RED)]):
        s.text(90, 302 + i * 24, k, 12.5, FAINT)
        s.text(160, 302 + i * 24, v, 12.5, c, 600)
    s.rect(90, 372, 430, 50, 8, "#F6F7F9")
    s.text(102, 394, "客户说导出不了，截图见附件。", 12.5, SUB)
    s.text(102, 412, "（附件：IMG_2041.jpg）", 12, FAINT)
    comments = [("客服", "能复现吗？客户在催"), ("张三", "我这边没问题啊，什么账号？"), ("客服", "@张三 客户账号 lily@…"), ("张三", "@李四 好像是权限，你看下"), ("李四", "明天看")]
    for i, (who, t) in enumerate(comments):
        y = 446 + i * 36
        s.rect(90, y, 24, 24, 7, "#E3E5EA")
        s.text(122, y + 10, who, 11.5, FAINT)
        s.text(122, y + 26, t, 12.5, INK)
    # IDE + 流水线
    win(s, 420, 430, 360, 220, "OrderExport.java — IDE")
    code_lines(s, 436, 484, 8, 11, maxx=764)
    win(s, 470, 230, 300, 170, "流水线 #1187", dark=False)
    for i, (t, c) in enumerate([("编译", GREEN), ("单元测试", RED), ("打包", "#C9CCD5"), ("部署", "#C9CCD5")]):
        s.circle(494, 282 + i * 28, 7, c)
        s.text(510, 287 + i * 28, t, 12.5, INK)
    s.text(620, 315, "失败 · 重跑？", 12.5, RED, 600)
    callout(s, 1, 300, 520, 70, 800, ["说不清、来回问", "复现要找账号、等人回"], w=230)
    callout(s, 2, 372, 304, 316, 800, ["经办人转来转去", "状态靠手动改"], w=220)
    callout(s, 3, 748, 287, 552, 800, ["改完还要盯流水线", "失败了再回 IDE"], w=220)

    cx, cy, cw = phone(s, 870, 206, "开", "shop 开发", "Opus 5.5 · 在分支上改，检查过再合并", ["改动记录", "预览", "发布记录"])
    sysline(s, cx + cw / 2, cy + 6, "今天 14:02")
    # 我：截图 + 一句话
    s.add(f'<rect x="{cx+cw-120}" y="{cy+16}" width="120" height="78" rx="12" fill="#DCE3F5"/>')
    s.rect(cx + cw - 108, cy + 28, 96, 8, 3, "#B9C4E0")
    s.rect(cx + cw - 108, cy + 44, 70, 8, 3, "#B9C4E0")
    s.rect(cx + cw - 108, cy + 62, 50, 18, 5, "#F4A6A0")
    hb = bubble(s, cx + cw - 232, cy + 102, 232, "导出 10 月订单报 403，客户在催", me=True, size=12.5)
    y = cy + 102 + hb + 10
    hb = bubble(s, cx, y, cw - 16, ["复现了：导出插件少了 export 权限，", "只影响开了子账号的客户，已在分支上改"], size=12)
    y += hb + 10
    h = card2(s, cx, y, cw, "改动", BRAND, "改了 2 个文件 +12 −3", [("检查", "编译 ✓  测试 ✓  预览 ✓"), ("分支", "fix/export-403")], ["上线", "看改动", "~打开预览"])
    callout(s, 1, cx + cw + 4, cy + 50, 1268, 250, ["截图 + 一句话就是 bug 报告", "截图先裁剪；也能从消息助理转过来"], new=True)
    callout(s, 2, cx + cw + 4, y - 30, 1268, 400, ["员工自己复现、定位", "用你带进来的账号只读查日志、查库"], new=True)
    callout(s, 3, cx + cw + 4, y + 50, 1268, 545, ["改动 + 检查结果 + 预览", "看过没问题点「上线」"], new=True)
    callout(s, 4, cx + cw + 4, y + h - 23, 1268, 690, ["上线后发布员工盯着", "出事自动回滚，随时「回到上一版」"], new=True)

    bottom(s, [("你看到的", "工单评论、代码、流水线日志", "结论 + 改动卡片（检查都过了）"),
               ("你要做的", "转派、催人、改代码、重跑流水线", "发截图说一句、看预览、点上线"),
               ("谁在推进", "你推着每个人", "员工自己推到「等你点上线」"),
               ("在哪", "电脑前，3 个系统", "手机上一个会话")])
    save(s, "screen-bug.svg", "opero-界面-bug处理.png")


# ---------- 3 运维 ----------
def ops():
    s = SVG(1600, 1110, "#FAFAFC")
    defs(s)
    header(s, "运维：界面的变化", "以前是监控大屏 + 半夜的告警短信 + 终端；现在是和「运维」的聊天：早报、处理结果、要你确认的事")
    panels(s, "以前 · 监控大屏 + 告警短信 + 终端", "现在 · 和「运维」聊天")

    win(s, 70, 214, 700, 330, "监控 · 生产环境", dark=True)
    import random
    rnd = random.Random(3)
    for k in range(6):
        gx, gy = 86 + (k % 3) * 228, 254 + (k // 3) * 140
        s.rect(gx, gy, 216, 126, 8, "#25272E")
        s.text(gx + 10, gy + 20, ["CPU", "内存", "磁盘", "QPS", "错误率", "延迟 P99"][k], 11.5, "#A0A4AE")
        pts = " ".join(f"{gx + 10 + i * 13},{gy + 100 - rnd.randint(5, 60 if k != 2 else 80)}" for i in range(16))
        col = "#F48771" if k in (2, 4) else "#6CB6FF"
        s.add(f'<polyline points="{pts}" fill="none" stroke="{col}" stroke-width="2"/>')
        if k == 2:
            s.rect(gx + 140, gy + 8, 66, 18, 9, "#5A2A2A")
            s.text(gx + 173, gy + 21, "92%", 11, "#FF9A9A", 700, "middle")
    # 短信
    s.add('<rect x="96" y="560" width="330" height="110" rx="18" fill="#FFFFFF" filter="url(#sh)"/>')
    s.text(116, 588, "短信 · 03:12", 12, FAINT)
    s.text(116, 614, "【告警】prod-1-1 磁盘使用率 92%", 13.5, INK, 700)
    s.text(116, 638, "【告警】shop-admin 服务 503（第 3 次）", 13.5, INK, 700)
    s.text(116, 660, "请尽快处理。退订回 T", 12, FAINT)
    win(s, 450, 560, 320, 160, "ssh root@prod-1-1")
    for i, (t, c) in enumerate([("# df -h /", MONO_GRY), ("/dev/xvda1  100G  92G  8G  92%", MONO_RED), ("# du -sh /var/log/*", MONO_GRY), ("41G  /var/log/shop", MONO_YEL), ("# systemctl restart shop-admin", MONO_GRY)]):
        s.text(464, 604 + i * 20, t, 12, c, mono=True)
    callout(s, 3, 744, 330, 552, 790, ["一屏几十张图", "自己看哪里不对"], w=220)
    callout(s, 1, 410, 600, 70, 790, ["半夜 3 点被叫醒", "短信一条接一条"], w=230)
    callout(s, 2, 472, 690, 316, 790, ["登上去手敲命令", "做了什么没人知道"], w=220)

    cx, cy, cw = phone(s, 870, 206, "运", "运维", "盯着 6 台服务器 · 用你带进来的账号", ["服务器", "操作记录", "触发器"])
    sysline(s, cx + cw / 2, cy + 6, "今天 08:30")
    h = card2(s, cx, cy + 16, cw, "早报", BLUE, "昨晚处理了 2 件，都可撤销", [("03:12", "磁盘 92%：清了旧日志，现 51%"), ("03:15", "shop-admin 503：已重启，疑内存泄漏"), ("提醒", "证书 12 天后到期，已排续期")], ["看操作记录"])
    y = cy + 16 + h + 10
    h2 = card2(s, cx, y, cw, "要你确认", ORANGE, "shop-admin 内存泄漏：先加内存撑着？", [("方案", "prod-1 内存 4G → 8G，+¥80/月"), ("同时", "已让「shop 开发」去修泄漏")], ["指纹确认", "先不加"], tag="要你决定", tagc=(ORANGE, ORANGE_SOFT))
    callout(s, 1, cx + cw + 4, cy + 60, 1268, 250, ["半夜的事它先处理完", "早上一条早报，每件都能撤销"], new=True)
    callout(s, 2, cx + cw + 4, y + 50, 1268, 420, ["花钱、改生产才问你", "卡片 + 指纹，30 分钟内不再问"], new=True)
    callout(s, 3, cx + cw + 4, y + 104, 1268, 580, ["查原因交给开发员工", "员工之间自己转，不用你传话"], new=True)
    callout(s, 4, 1188, 782, 1268, 740, ["服务器、操作记录随手点开", "不用记 IP、不用连 VPN"], new=True)

    bottom(s, [("你看到的", "几十张监控图 + 告警短信", "早报 + 处理结果 + 要你确认的卡片"),
               ("你要做的", "半夜爬起来、登服务器、敲命令", "早上看一眼，大事按个指纹"),
               ("留下的", "什么都没留（除了命令历史）", "每一步操作记录，能撤销"),
               ("在哪", "电脑前，VPN + 终端", "手机上一个会话")])
    save(s, "screen-ops.svg", "opero-界面-运维.png")


if __name__ == "__main__":
    patrol()
    bug()
    ops()
