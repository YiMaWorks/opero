"""开发流程、运维的「以前 → 现在（Opero）」对比图。输出 docs/界面设计/opero-变化-开发.png、opero-变化-运维.png。
用法：python3 flows.py && rsvg-convert -z 2 dev-flow.svg -o ../../docs/界面设计/opero-变化-开发.png（运维同理），或直接 python3 flows.py --png
"""
import subprocess
import sys

from svgkit import SVG, C, tw, T

BRAND = "#5B4FE9"
BRAND2 = "#8B5CF6"
MINT = "#2EE6B0"
GREY = "#8A90A0"
OLD_BG = "#F1F1F4"
OLD_BOX = "#FFFFFF"
OLD_LINE = "#DADCE3"
INK = "#14161F"
SUB = "#4E5465"
FAINT = "#7A8091"
RED = "#D92D20"
RED_SOFT = "#FEECEB"
ORANGE = "#C26A00"
ORANGE_SOFT = "#FFF3E2"
GREEN = "#12A150"
GREEN_SOFT = "#E8F7EE"
EMP = {"值": "#10B981", "开": "#EC4899", "发": "#0EA5E9", "运": "#F97316", "信": "#14B8A6", "总": "#6366F1"}


def defs(s):
    s.defs.append(
        '<defs>'
        f'<linearGradient id="brand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{BRAND}"/><stop offset="1" stop-color="{BRAND2}"/></linearGradient>'
        '<linearGradient id="newlane" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F4F2FF"/><stop offset="1" stop-color="#EEF8FF"/></linearGradient>'
        '<marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="#B7BBC6"/></marker>'
        f'<marker id="arrb" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="{BRAND}"/></marker>'
        '<filter id="sh" x="-10%" y="-10%" width="120%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="#1C1F2A" flood-opacity="0.08"/></filter>'
        '</defs>')


def arrow(s, x1, y1, x2, y2, new=False, dash=False):
    d = ' stroke-dasharray="5 5"' if dash else ""
    s.add(f'<path d="M{x1},{y1} L{x2},{y2}" stroke="{BRAND if new else "#B7BBC6"}" stroke-width="{2.2 if new else 1.6}" fill="none" marker-end="url(#{"arrb" if new else "arr"})"{d}/>')


def chip(s, x, y, text, fg, bg, size=13, h=28):
    w = tw(text, size) + 22
    s.rect(x, y, w, h, h / 2, bg)
    s.text(x + w / 2, y + h / 2 + size * 0.36, text, size, fg, 600, "middle")
    return w


def emp_avatar(s, x, y, ch, size=30):
    col = EMP.get(ch, BRAND)
    s.add(f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="{size*0.27}" fill="{col}" opacity="0.16"/>')
    s.text(x + size / 2, y + size * 0.67, ch, size * 0.46, col, 700, "middle")


def me_badge(s, x, y, size=30):
    s.add(f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="{size*0.27}" fill="url(#brand)"/>')
    s.text(x + size / 2, y + size * 0.67, "你", size * 0.46, "#fff", 700, "middle")


def old_step(s, x, y, w, h, title, tool, pain=None):
    s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{OLD_BOX}" stroke="{OLD_LINE}"/>')
    # 人在做：灰色小人
    s.circle(x + 22, y + 22, 7, "none", GREY, 1.6)
    s.path(f"M{x+12},{y+40} c0,-7 5,-9 10,-9 s10,2 10,9", GREY, 1.6)
    s.text(x + 42, y + 30, title, 15, INK, 600)
    s.text(x + 14, y + 62, tool, 12.5, FAINT)
    if pain:
        pw = tw(pain, 11.5) + 14
        s.rect(x + 14, y + h - 30, pw, 20, 10, RED_SOFT)
        s.text(x + 14 + pw / 2, y + h - 16, pain, 11.5, RED, 600, "middle")


def new_step(s, x, y, w, h, title, sub, who, you=False):
    if you:
        s.add(f'<rect x="{x-3}" y="{y-3}" width="{w+6}" height="{h+6}" rx="15" fill="none" stroke="{BRAND}" stroke-width="2" stroke-dasharray="0"/>')
    s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="#FFFFFF" filter="url(#sh)"/>')
    if you:
        me_badge(s, x + 12, y + 12)
    else:
        emp_avatar(s, x + 12, y + 12, who)
    s.text(x + 52, y + 32, title, 15, INK, 700)
    lines = sub if isinstance(sub, list) else [sub]
    for i, ln in enumerate(lines):
        s.text(x + 14, y + 62 + i * 19, ln, 12.5, SUB)


def header(s, title, subtitle):
    s.rect(0, 0, s.w, s.h, 0, "#FAFAFC")
    # 标志：对话 O
    s.add(f'<g transform="translate(60 44) scale(0.42)"><path d="M24.02,65.00 A30,30 0 1 1 35.92,76.49 L19.0,83.0 Z" fill="none" stroke="url(#brand)" stroke-width="13" stroke-linejoin="round" stroke-linecap="round"/><circle cx="50" cy="50" r="8.5" fill="{MINT}"/></g>')
    s.text(112, 76, title, 34, INK, 800)
    s.text(112, 108, subtitle, 17, SUB)


def lane(s, y, h, new):
    if new:
        s.add(f'<rect x="40" y="{y}" width="{s.w-80}" height="{h}" rx="20" fill="url(#newlane)" stroke="#DCD7FF"/>')
    else:
        s.add(f'<rect x="40" y="{y}" width="{s.w-80}" height="{h}" rx="20" fill="{OLD_BG}" stroke="#E4E5EA"/>')


def lane_title(s, y, label, sub, new):
    if new:
        w = chip(s, 64, y, label, "#fff", BRAND, 15, 32)
    else:
        w = chip(s, 64, y, label, "#fff", "#9096A3", 15, 32)
    s.text(64 + w + 14, y + 22, sub, 15, SUB)


def stats(s, x, y, items, new):
    for t in items:
        fg, bg = (BRAND, "#FFFFFF") if new else (RED, RED_SOFT)
        if not new and t.startswith("!"):
            fg, bg, t = ORANGE, ORANGE_SOFT, t[1:]
        w = chip(s, x, y, t, fg, bg, 13.5, 30)
        if new:
            s.add(f'<rect x="{x}" y="{y}" width="{w}" height="30" rx="15" fill="none" stroke="#D9D3FF"/>')
        x += w + 10
    return x


def stats_r(s, y, items, new):
    """右对齐的一排统计（英文更长也不出框）。"""
    w = sum(tw(t.lstrip("!"), 13.5) + 22 + 10 for t in items)
    return stats(s, 1530 - w, y, items, new)


def snake(s, steps, x0, y0, w, h, gapx, per_row, gapy, draw, new):
    """一行 per_row 个，第二行从右往左（像流程走回来）。"""
    pos = []
    for i, st in enumerate(steps):
        row, col = divmod(i, per_row)
        if row % 2 == 1:
            col = per_row - 1 - col
        x = x0 + col * (w + gapx)
        y = y0 + row * (h + gapy)
        pos.append((x, y))
    for i in range(len(pos) - 1):
        (x1, y1), (x2, y2) = pos[i], pos[i + 1]
        if y1 == y2:
            if x2 > x1:
                arrow(s, x1 + w + 4, y1 + h / 2, x2 - 6, y2 + h / 2, new)
            else:
                arrow(s, x1 - 4, y1 + h / 2, x2 + w + 6, y2 + h / 2, new)
        else:
            arrow(s, x1 + w / 2, y1 + h + 4, x2 + w / 2, y2 - 6, new)
    for (x, y), st in zip(pos, steps):
        draw(s, x, y, w, h, *st)


def bottom_compare(s, y, old_n, old_total, new_n, label_old, label_new):
    s.text(64, y + 17, "你亲自动手", 16, INK, 700)
    s.text(170, y, "以前", 14, SUB, 700)
    bx = 240
    for i in range(old_total):
        s.rect(bx + i * 26, y - 16, 20, 20, 5, "#C9CCD5" if i < old_n else "#EDEEF2")
    s.text(bx + old_total * 26 + 10, y, label_old, 14, SUB)
    y2 = y + 34
    s.text(170, y2, "现在", 14, BRAND, 700)
    for i in range(old_total):
        if i < new_n:
            s.add(f'<rect x="{bx + i * 26}" y="{y2 - 16}" width="20" height="20" rx="5" fill="url(#brand)"/>')
        else:
            s.rect(bx + i * 26, y2 - 16, 20, 20, 5, "#EDEEF2")
    s.text(bx + old_total * 26 + 10, y2, label_new, 14, BRAND, 700)


# ---------------------------------------------------------------- 开发
def dev():
    s = SVG(1600, 1110, "#FAFAFC")
    defs(s)
    header(s, "开发流程的变化", "以前：人在流程里跑腿，切一堆工具、等一堆人；现在：AI 员工把流程跑完，你在手机上只做决定")

    # 以前
    lane(s, 140, 420, False)
    lane_title(s, 160, "以前", "一个线上 bug，从发现到修好上线", False)
    stats(s, 900, 162, ["半天到两天", "切 7 个工具", "必须开电脑", "!等人 3 次"], False)
    old = [
        ("用户 / 客服报问题", "微信群 · 工单", "说不清哪里错"),
        ("找到对的人", "群里 @ 来 @ 去", "等人回"),
        ("登服务器看日志", "VPN · 跳板机 · SSH", "必须开电脑"),
        ("拉代码、定位", "IDE · Git", None),
        ("改代码、自己测", "本地环境", "环境不一致"),
        ("提 PR、等评审", "Codeup / GitHub", "等人评审"),
        ("打包", "CI 流水线", None),
        ("发布到服务器", "发布系统 · 签名", "怕发错"),
        ("盯日志、确认好了", "SSH · 监控", "半夜也得看"),
        ("回复用户", "微信群 · 工单", "等人转达"),
    ]
    snake(s, old, 70, 212, 268, 112, 34, 5, 44, old_step, False)
    s.text(70, 540, "整条链路都靠你（或你找的人）一步步推；任何一步卡住，后面全停。", 14, FAINT)

    # 现在
    lane(s, 590, 400, True)
    lane_title(s, 610, "现在 · Opero", "同一个 bug：员工发现、员工修、员工发，你点两下", True)
    stats(s, 990, 612, ["15 分钟", "1 个 App", "手机就行", "你动手 2 次"], True)
    new = [
        ("发现问题", ["日志值班 24 小时扫日志", "出「问题卡片」：原因 · 影响"], "值", False),
        ("点「修复」", ["在手机上看卡片", "一个按钮，交给开发员工"], "", True),
        ("改代码 + 检查", ["开发员工在分支上改", "编译、检查、预览自动跑"], "开", False),
        ("自动合并、发布", ["检查都过就合并", "发布员工发版，盯 10 分钟"], "发", False),
        ("出事自动回滚", ["报错变多就退回上一版", "每一步都有操作记录可撤销"], "发", False),
        ("看结果", ["手机收到「已上线」", "要回到上一版说一声"], "", True),
    ]
    xs = 70
    w, h, gap = 225, 128, 20
    for i, st in enumerate(new):
        x = xs + i * (w + gap)
        new_step(s, x, 670, w, h, *st)
        if i < len(new) - 1:
            arrow(s, x + w + 3, 670 + h / 2, x + w + gap - 3, 670 + h / 2, True)
    # 危险操作说明
    s.rect(70, 826, 1460, 64, 14, "#FFFFFF", "#E6E2FF")
    me_badge(s, 86, 843, 30)
    s.text(130, 864, "只有两种时候找你：要你拍板（卡片上点一下）、危险操作（改生产数据、删东西 → 指纹确认）。其余员工有权限就直接做。", 15, INK, 500)
    s.text(70, 940, "员工就是一个个 work（Claude Code / Codex…）跑在你自己的服务器上，用的是你带进来的账号和权限；记忆在它自己的 git 里，换 work 不丢。", 14, FAINT)

    bottom_compare(s, 1030, 10, 10, 2, "以前：10 步全是你推", "现在：2 次，都在手机上")
    s.save("dev-flow.svg")


# ---------------------------------------------------------------- 运维
def ops():
    s = SVG(1600, 1110, "#FAFAFC")
    defs(s)
    header(s, "运维的变化", "以前：出事了人去救火，半夜被电话叫醒；现在：运维员工 24 小时盯着，小事自己处理，大事叫你拍板")

    lane(s, 140, 420, False)
    lane_title(s, 160, "以前", "一台服务器磁盘快满 / 服务挂了", False)
    stats_r(s, 162, ["30 分钟到几小时", "半夜被叫醒", "!靠记性", "!没留记录"], False)
    old = [
        ("收到告警", "短信 · 电话 · 邮件", "半夜也响"),
        ("爬起来开电脑", "VPN · 跳板机", "必须开电脑"),
        ("一台台登服务器", "SSH × N", "密码到处存"),
        ("查日志、查进程", "grep · top · df", "靠经验"),
        ("判断要不要动", "问群里 · 翻文档", "等人回"),
        ("动手处理", "重启 · 清磁盘 · 扩容", "手抖就出事"),
        ("确认恢复", "刷监控 · curl", None),
        ("续证书、改配置", "到期了才想起来", "经常忘"),
        ("写事故记录", "文档 · 群公告", "常常没写"),
        ("下次再来一遍", "知识在某个人脑子里", "人走就没了"),
    ]
    snake(s, old, 70, 212, 268, 112, 34, 5, 44, old_step, False)
    s.text(70, 540, "运维的知识和权限都在人身上：谁在、谁记得，事情就靠谁。", 14, FAINT)

    lane(s, 590, 400, True)
    lane_title(s, 610, "现在 · Opero", "运维员工 + 日志值班一直在线，用你带进来的服务器账号", True)
    stats_r(s, 612, ["24 小时盯着", "小事自己做", "大事指纹确认", "全程留记录"], True)
    new = [
        ("一直盯着", ["Agent 装在每台服务器上", "CPU · 内存 · 磁盘 · 日志 · 证书"], "运", False),
        ("先查清楚", ["自己登上去查日志、查进程", "出结论：原因 · 影响 · 建议"], "运", False),
        ("小事直接做", ["清缓存日志、重启挂掉的服务", "续证书 · 都能撤销"], "运", False),
        ("大事问你", ["扩容、改生产配置、删数据", "卡片 + 指纹，30 分钟内不再问"], "", True),
        ("记下来", ["每一步进操作记录", "写进它的记忆仓库，下次更快"], "运", False),
        ("每天汇报", ["早上一条：昨晚处理了什么", "什么快到期、花了多少钱"], "信", False),
    ]
    xs = 70
    w, h, gap = 225, 128, 20
    for i, st in enumerate(new):
        x = xs + i * (w + gap)
        new_step(s, x, 670, w, h, *st)
        if i < len(new) - 1:
            arrow(s, x + w + 3, 670 + h / 2, x + w + gap - 3, 670 + h / 2, True)
    s.rect(70, 826, 1460, 64, 14, "#FFFFFF", "#E6E2FF")
    me_badge(s, 86, 843, 30)
    s.text(130, 864, "半夜不再叫醒你：能自己处理的处理完写进早报；真要你决定的才推送（严重告警会一直响，直到你点「我知道了」）。", 15, INK, 500)
    s.text(70, 940, "权限就是你在公司本来有的：带进来的服务器账号、云账号；AI 看不到明文密码，危险命令永远要你本人。", 14, FAINT)

    bottom_compare(s, 1030, 10, 10, 1, "以前：10 步全是人", "现在：只有「大事」那 1 步要你")
    s.save("ops-flow.svg")


if __name__ == "__main__":
    dev()
    ops()
    if "--png" in sys.argv:
        out = "../../docs/界面设计/"
        subprocess.run(["rsvg-convert", "-z", "2", "dev-flow.svg", "-o", out + "opero-变化-开发.png"], check=True)
        subprocess.run(["rsvg-convert", "-z", "2", "ops-flow.svg", "-o", out + "opero-变化-运维.png"], check=True)


# ---------------------------------------------------------------- 界面：IDE → 聊天
def code_lines(s, x, y, n, seed=0, maxx=None):
    import random
    rnd = random.Random(seed)
    cols = ["#C586C0", "#9CDCFE", "#DCDCAA", "#CE9178", "#4EC9B0", "#6A9955", "#D4D4D4"]
    for i in range(n):
        s.text(x, y + i * 19, f"{i + 41:>3}", 11, "#5A5F6B", mono=True)
        cx = x + 34 + rnd.choice([0, 0, 16, 16, 32])
        for _ in range(rnd.randint(2, 5)):
            w = rnd.randint(18, 90)
            if maxx and cx + w > maxx:
                break
            s.rect(cx, y + i * 19 - 9, w, 8, 3, rnd.choice(cols), opacity=0.85)
            cx += w + 8


def win(s, x, y, w, h, title, dark=True):
    bg, bar = ("#1E1F24", "#2A2C33") if dark else ("#FFFFFF", "#F1F2F5")
    s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{bg}" filter="url(#sh)"/>')
    s.add(f'<rect x="{x}" y="{y}" width="{w}" height="28" rx="10" fill="{bar}"/><rect x="{x}" y="{y+18}" width="{w}" height="10" fill="{bar}"/>')
    for i, c in enumerate(["#FF5F57", "#FEBC2E", "#28C840"]):
        s.circle(x + 16 + i * 16, y + 14, 5, c)
    # 标题居中，但别压到左边三个圆点
    tx = max(x + w / 2, x + 66 + tw(title, 12) / 2)
    s.text(tx, y + 19, title, 12, "#A0A4AE" if dark else FAINT, 500, "middle")


def bubble(s, x, y, w, text, me=False, size=13):
    lines = text if isinstance(text, list) else [text]
    h = 16 + len(lines) * (size + 7)
    if me:
        s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="url(#brand)"/>')
    else:
        s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="#FFFFFF" stroke="#ECEDF2"/>')
    for i, ln in enumerate(lines):
        s.text(x + 12, y + 12 + size + i * (size + 7) - 2, ln, size, "#fff" if me else INK, 500 if me else 400)
    return h


def mini_card(s, x, y, w, kind, color, title, rows, buttons):
    h = 44 + len(rows) * 20 + 44
    s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="#FFFFFF" stroke="#ECEDF2"/>')
    s.add(f'<rect x="{x+6}" y="{y+12}" width="3" height="{h-24}" rx="1.5" fill="{color}"/>')
    s.text(x + 18, y + 22, kind, 11.5, color, 700)
    s.text(x + 18, y + 42, title, 14, INK, 700)
    for i, r in enumerate(rows):
        s.text(x + 18, y + 64 + i * 20, r, 12, SUB)
    bx = x + 18
    by = y + h - 36
    for j, b in enumerate(buttons):
        bw = tw(b, 12.5) + 22
        if j == 0:
            s.add(f'<rect x="{bx}" y="{by}" width="{bw}" height="26" rx="7" fill="{BRAND}"/>')
            s.text(bx + bw / 2, by + 17.5, b, 12.5, "#fff", 600, "middle")
        else:
            s.rect(bx, by, bw, 26, 7, "#FFFFFF", "#E2E4EA")
            s.text(bx + bw / 2, by + 17.5, b, 12.5, INK, 500, "middle")
        bx += bw + 8
    return h


def ui():
    s = SVG(1600, 1120, "#FAFAFC")
    defs(s)
    header(s, "界面的变化", "以前：坐在电脑前，IDE + 终端 + 一堆网页来回切；现在：像微信一样和员工聊天，看结论、点卡片")

    # ---- 左：以前 ----
    s.add(f'<rect x="40" y="140" width="740" height="700" rx="20" fill="{OLD_BG}" stroke="#E4E5EA"/>')
    chip(s, 64, 160, "以前 · 在 IDE 里", "#fff", "#9096A3", 15, 32)
    # IDE 主窗口
    X, Y, W, H = 70, 214, 560, 420
    win(s, X, Y, W, H, "PayService.java — shop-api — IDE")
    s.rect(X, Y + 28, 130, H - 28, 0, "#202127")
    for i, f in enumerate(["▾ src", "  ▾ pay", "    PayService.java", "    WechatSigner.java", "  ▸ order", "  ▸ user", "▸ resources", "▸ test", "pom.xml", "Dockerfile"]):
        s.text(X + 10, Y + 52 + i * 20, f, 11, "#E6E6E6" if "PayService" in f else "#8C919C", mono=True)
    s.rect(X + 130, Y + 28, W - 130, 26, 0, "#25262C")
    s.text(X + 142, Y + 45, "PayService.java   ×", 11, "#E6E6E6", mono=True)
    s.text(X + 290, Y + 45, "WechatSigner.java", 11, "#8C919C", mono=True)
    code_lines(s, X + 140, Y + 76, 12, 3)
    # 终端
    s.rect(X + 130, Y + 310, W - 130, H - 310, 0, "#16171B")
    s.text(X + 142, Y + 330, "终端", 11, "#8C919C")
    for i, t in enumerate(["$ ssh deploy@dev-1", "$ tail -f /var/log/shop/app.log | grep SIGN_ERR", "  ERROR SIGN_ERR invalid signature (×37)", "$ mvn -q test   ..."]):
        s.text(X + 142, Y + 350 + i * 17, t, 11, "#F48771" if "ERROR" in t else "#B5CEA8", mono=True)
    # 周围乱七八糟的窗口
    win(s, 560, 250, 200, 120, "CI 流水线", dark=False)
    for i in range(3):
        s.rect(575, 292 + i * 22, 14, 14, 4, ["#12A150", "#C26A00", "#D92D20"][i])
        s.rect(596, 295 + i * 22, 140, 8, 3, "#E3E5EA")
    win(s, 600, 430, 160, 110, "监控", dark=False)
    s.path("M612,515 L632,500 L652,508 L672,480 L692,492 L712,470 L742,476", "#2B59FF", 2)
    win(s, 470, 590, 190, 120, "工作群（99+）", dark=False)
    for i in range(3):
        s.rect(484, 628 + i * 24, 16, 16, 5, "#D7DAE2")
        s.rect(506, 632 + i * 24, 120 - i * 20, 8, 3, "#E3E5EA")
    win(s, 120, 650, 260, 110, "Jira · SHOP-1024", dark=False)
    s.rect(136, 690, 180, 9, 3, "#E3E5EA"); s.rect(136, 708, 220, 9, 3, "#E3E5EA"); s.rect(136, 726, 140, 9, 3, "#E3E5EA")
    s.text(70, 812, "你自己找日志、读代码、敲命令、切窗口；只能在电脑前做。", 14, FAINT)

    # ---- 右：现在 ----
    s.add(f'<rect x="820" y="140" width="740" height="700" rx="20" fill="url(#newlane)" stroke="#DCD7FF"/>')
    chip(s, 844, 160, "现在 · 在聊天里", "#fff", BRAND, 15, 32)
    # 手机
    PX, PY, PW, PH = 860, 210, 330, 610
    s.add(f'<rect x="{PX}" y="{PY}" width="{PW}" height="{PH}" rx="38" fill="#14161F"/>')
    s.add(f'<rect x="{PX+10}" y="{PY+10}" width="{PW-20}" height="{PH-20}" rx="30" fill="#F4F5F8"/>')
    s.rect(PX + 10, PY + 40, PW - 20, 52, 0, "#FFFFFF")
    s.text(PX + 30, PY + 72, "‹", 22, SUB)
    emp_avatar(s, PX + 50, PY + 52, "值", 28)
    s.text(PX + 88, PY + 64, "shop 日志值班", 14, INK, 700)
    s.text(PX + 88, PY + 82, "在盯 shop 三个项目的线上日志", 11, FAINT)
    yy = PY + 108
    yy += mini_card(s, PX + 22, yy, PW - 44, "问题", RED, "#42 支付签名失败 37 次", ["原因：微信证书 11-20 换了，代码还用旧的", "影响：约 6% 订单付不了款"], ["修复", "先盯着"]) + 10
    yy += bubble(s, PX + PW - 22 - 120, yy, 120, "修复，修好直接发", me=True) + 10
    yy += mini_card(s, PX + 22, yy, PW - 44, "发布", "#2B59FF", "v1.4.2 已上生产 ✓", ["改了 2 个文件 +20 −5 · 检查全过", "盯了 10 分钟，没再报错"], ["看改动", "回到上一版"]) + 10
    # 输入条
    s.rect(PX + 10, PY + PH - 72, PW - 20, 52, 0, "#FFFFFF")
    s.add(f'<rect x="{PX+24}" y="{PY+PH-62}" width="{PW-100}" height="34" rx="17" fill="#F4F5F8"/>')
    s.text(PX + 40, PY + PH - 40, "按住 说话", 13, FAINT)
    s.add(f'<circle cx="{PX+PW-46}" cy="{PY+PH-45}" r="17" fill="url(#brand)"/>')
    # 右边说明
    tx = 1225
    items = [
        ("看的是结论", "员工先查完：原因、影响、建议，写在卡片上；代码和日志点开才看"),
        ("做的是决定", "卡片上一个按钮，或者说一句话；危险操作指纹确认"),
        ("和员工聊天", "每个员工一个会话，像微信；在干活的会动，要你决定的才红点"),
        ("哪里都能用", "手机、电脑浏览器、App；不用装 IDE、不用连 VPN"),
        ("IDE 还在", "要亲手改代码随时打开，只是不再是每天的入口"),
    ]
    for i, (t, d) in enumerate(items):
        y0 = 230 + i * 118
        s.add(f'<rect x="{tx}" y="{y0}" width="310" height="100" rx="14" fill="#FFFFFF" filter="url(#sh)"/>')
        s.add(f'<rect x="{tx+16}" y="{y0+18}" width="6" height="22" rx="3" fill="url(#brand)"/>')
        s.text(tx + 32, y0 + 36, t, 16, INK, 700)
        # 简单折行
        d = T(d)
        line, lines = "", []
        if any(ord(c) > 0x2E80 for c in d):
            for ch in d:
                # 标点不放行首
                if tw(line + ch, 13) > 282 and ch not in "，。；、：）」":
                    lines.append(line); line = ""
                line += ch
        else:
            for word in d.split(" "):
                if line and tw(line + " " + word, 13) > 282:
                    lines.append(line); line = word
                else:
                    line = (line + " " + word).strip()
        lines.append(line)
        for j, ln in enumerate(lines[:3]):
            s.text(tx + 18, y0 + 62 + j * 19, ln, 13, SUB)

    # ---- 下：对照表 ----
    rows = [("你看的", "代码、日志、命令输出", "结论 + 卡片（原因 · 影响 · 建议）"),
            ("你做的", "写代码、敲命令、点流水线", "说一句话、点一个按钮"),
            ("在哪做", "电脑前，7 个窗口来回切", "手机 / 任何浏览器，一个 App"),
            ("要会的", "IDE、Git、SSH、流水线、监控", "会聊天就行")]
    y0 = 868
    s.rect(40, y0, 1520, 220, 18, "#FFFFFF", "#E8E9EE")
    s.text(260, y0 + 34, "以前", 14, FAINT, 700)
    s.text(820, y0 + 34, "现在", 14, BRAND, 700)
    for i, (k, a, b) in enumerate(rows):
        yy = y0 + 72 + i * 38
        s.line(64, yy - 26, 1536, yy - 26, "#F0F1F4")
        s.text(70, yy, k, 15, INK, 700)
        s.text(260, yy, a, 15, SUB)
        s.text(780, yy, "→", 16, BRAND, 700)
        s.text(820, yy, b, 15, INK, 600)
    s.save("ui-flow.svg")


if __name__ == "__main__" and "--png" in sys.argv:
    ui()
    subprocess.run(["rsvg-convert", "-z", "2", "ui-flow.svg", "-o", "../../docs/界面设计/opero-变化-界面.png"], check=True)


# ---------------------------------------------------------------- 通用：一张「以前 → 现在」
def compare(fname, title, subtitle, old_sub, old_stats, old_steps, old_note, new_sub, new_stats, new_steps, you_note, foot, you_new, label_old, label_new):
    s = SVG(1600, 1110, "#FAFAFC")
    defs(s)
    header(s, title, subtitle)
    lane(s, 140, 420, False)
    lane_title(s, 160, "以前", old_sub, False)
    x_end = 1530
    w_stats = sum(tw(t.lstrip("!"), 13.5) + 22 + 10 for t in old_stats)
    stats(s, x_end - w_stats, 162, old_stats, False)
    snake(s, old_steps, 70, 212, 268, 112, 34, 5, 44, old_step, False)
    s.text(70, 540, old_note, 14, FAINT)
    lane(s, 590, 400, True)
    lane_title(s, 610, "现在 · Opero", new_sub, True)
    w_stats = sum(tw(t, 13.5) + 22 + 10 for t in new_stats)
    stats(s, x_end - w_stats, 612, new_stats, True)
    w, h, gap = 225, 128, 20
    for i, st in enumerate(new_steps):
        x = 70 + i * (w + gap)
        new_step(s, x, 670, w, h, *st)
        if i < len(new_steps) - 1:
            arrow(s, x + w + 3, 670 + h / 2, x + w + gap - 3, 670 + h / 2, True)
    s.rect(70, 826, 1460, 64, 14, "#FFFFFF", "#E6E2FF")
    me_badge(s, 86, 843, 30)
    s.text(130, 864, you_note, 15, INK, 500)
    s.text(70, 940, foot, 14, FAINT)
    bottom_compare(s, 1030, 10, 10, you_new, label_old, label_new)
    s.save(fname)


def patrol():
    compare(
        "patrol-flow.svg", "日志巡检的变化",
        "以前：出了事才去翻日志，错误淹在海量日志里没人看；现在：日志值班每 5 分钟扫一遍，只把新问题、带着原因报给你",
        "每天看一眼线上日志有没有问题", ["出事了才看", "人肉 grep", "!噪音太多", "!新问题漏掉"],
        [("想起来去看", "早上 · 或者用户投诉后", "出事了才看"),
         ("登一台台服务器", "VPN · SSH × N", "必须开电脑"),
         ("翻日志", "tail · grep · less", "几万行"),
         ("翻压缩的旧日志", "zgrep · 下载到本地", "很慢"),
         ("分辨新老问题", "凭印象", "靠记性"),
         ("数出现几次", "grep -c · 表格", None),
         ("找原因", "对着代码猜", "费时间"),
         ("记下来", "Jira · 表格", "常常没记"),
         ("通知开发", "群里 @", "等人回"),
         ("明天再来一遍", "同样的步骤", "坚持不下去")],
        "日志太多、人太忙：大部分错误从来没人看过，直到用户来投诉。",
        "日志值班员工一直在线，用你带进来的服务器账号只读查看", ["每 5 分钟", "所有服务器", "只报新问题", "带原因"],
        [("一直在扫", ["每台服务器上的 Agent 读日志", "连滚动出去的 .gz 一起读"], "值", False),
         ("归类去重", ["同一种错误合成一条", "老问题不重复吵你"], "值", False),
         ("查清原因", ["看出错的代码行、最近提交", "查库（只读）看影响多少单"], "值", False),
         ("出问题卡片", ["严重程度 · 原因 · 影响 · 建议", "只有严重的才推送"], "值", False),
         ("你选一个", ["修复 → 交给开发员工", "先盯着 / 忽略"], "", True),
         ("记住你的选择", ["忽略的同类以后不提醒", "盯着的再出现告诉你"], "值", False)],
        "你只看卡片：一句话原因、影响多少、建议怎么办；选「修复」它就交给开发员工，选「忽略」以后同类不再吵你。",
        "问题清单在员工的底部菜单「问题清单」里，按严重程度排；每天早上汇总一条到消息助理。",
        1, "以前：10 步全是你", "现在：1 次，看卡片选一个")


def bug():
    compare(
        "bug-flow.svg", "Bug 处理的变化",
        "以前：报 bug → 复现 → 改 → 测 → 评审 → 打包 → 发布，一路找人等人；现在：说一句话，员工改好给你预览，你点上线",
        "测试 / 客户报了一个 bug", ["半天到两天", "切 7 个工具", "必须开电脑", "!等人 3 次"],
        [("收到 bug", "工单 · 微信群 · 截图", "说不清"),
         ("复现", "本地环境 · 测试账号", "环境不一致"),
         ("定位", "IDE · 日志 · 查库", "必须开电脑"),
         ("改代码", "IDE · Git 分支", None),
         ("自己测", "本地跑 · 手点", "漏测"),
         ("提 PR、等评审", "Codeup / GitHub", "等人评审"),
         ("打包", "CI 流水线", None),
         ("发布", "发布系统 · 签名", "怕发错"),
         ("验证", "测试环境 · 生产", "半夜也得看"),
         ("关单、回复", "工单 · 群里", "等人转达")],
        "一个小 bug 也要走完整条链路，任何一个人不在，事情就停在那里。",
        "同一个 bug：你说一句，开发员工从复现做到预览", ["15 分钟", "1 个 App", "手机就行", "你动手 2 次"],
        [("说一句 / 发截图", ["「导出 10 月订单报 403」", "或者从消息助理转过来"], "", True),
         ("复现 + 定位", ["开发员工看日志、查库（只读）", "找到出错的代码和原因"], "开", False),
         ("在分支上改", ["改完跑编译、检查", "出预览链接给你看"], "开", False),
         ("你点「上线」", ["预览里看一眼对不对", "不对就直接说哪里不对"], "", True),
         ("发布 + 盯着", ["发布员工发版、盯 10 分钟", "报错变多自动回滚"], "发", False),
         ("关单、回复", ["问题清单自动关", "消息助理给你回复建议"], "信", False)],
        "你做两件事：把问题说清楚（一句话或截图）、看预览点上线。改坏了随时「回到上一版」。",
        "员工在分支上改、检查过了才合并；每一步都有操作记录，改动点开就能看到哪几行。",
        2, "以前：10 步全是你推", "现在：2 次，都在手机上")


if __name__ == "__main__" and "--png" in sys.argv:
    patrol()
    bug()
    out = "../../docs/界面设计/"
    subprocess.run(["rsvg-convert", "-z", "2", "patrol-flow.svg", "-o", out + "opero-变化-日志巡检.png"], check=True)
    subprocess.run(["rsvg-convert", "-z", "2", "bug-flow.svg", "-o", out + "opero-变化-bug处理.png"], check=True)
