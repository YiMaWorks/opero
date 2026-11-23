"""README 顶部的演示动画（中英两版）：一个线上 bug 从发现到上线，你在手机上只点两下。
逐帧画 SVG → rsvg-convert 转 PNG → ffmpeg 合成 MP4 和 GIF。
用法：python3 demo.py [en|zh ...]  → docs/images/<lang>/demo.gif、demo.mp4
"""
import math
import os
import shutil
import subprocess
import sys

import svgkit
from svgkit import SVG, tw
from flows import BRAND, INK, SUB, FAINT, RED, RED_SOFT, MINT, defs, emp_avatar, bubble
from screens import card2

W, H, FPS, DUR = 1280, 720, 20, 17.0
BLUE = "#2B59FF"
GREEN = "#12A150"


def pick(zh, en):
    return en if svgkit.LANG == "en" else zh


def clamp(x):
    return max(0.0, min(1.0, x))


def ease(x):
    x = clamp(x)
    return 1 - (1 - x) ** 3


def grab(fn):
    """把 fn 在一张临时画布上画的东西拿出来（不要背景），返回 (svg 片段, fn 的返回值)。"""
    tmp = SVG(10, 10)
    r = fn(tmp)
    return "\n".join(tmp.items[1:]), r


# ---------- 聊天里的每一条 ----------
def msg_issue(s, x, y, w):
    return card2(s, x, y, w, pick("问题 #42", "Issue #42"), RED, pick("支付签名失败 37 次（新）", "Payment signature failed 37x"),
                 [(pick("原因", "Cause"), pick("微信证书 11-20 换了", "WeChat cert rotated on 11-20")),
                  (pick("影响", "Impact"), pick("约 6% 订单付不了款", "~6% of orders can't be paid"))],
                 [pick("修复", "Fix"), pick("先盯着", "Watch")], tag=pick("严重", "Critical"), tagc=(RED, RED_SOFT))


def msg_change(done):
    def f(s, x, y, w):
        rows = [(pick("检查", "Checks"), pick("编译 ✓  测试 ✓  预览 ✓", "build ✓  tests ✓  preview ✓")), (pick("分支", "Branch"), "fix/sign-cert")]
        if done:
            rows.append(("", pick("✓ 你已批准，正在发布", "✓ Approved by you — shipping")))
        return card2(s, x, y, w, pick("改动", "Change"), BRAND, pick("改了 2 个文件 +20 −5", "2 files changed +20 −5"), rows,
                     [] if done else [pick("上线", "Ship it"), pick("看改动", "View diff")])
    return f


def msg_release(s, x, y, w):
    return card2(s, x, y, w, pick("发布", "Release"), BLUE, pick("v1.4.2 已上生产 ✓", "v1.4.2 is live ✓"),
                 [pick("盯了 10 分钟，没再报错", "Watched 10 min, no new errors"), pick("报错变多会自动回滚", "Auto-rollback if errors rise")],
                 [pick("回到上一版", "Roll back")])


def status(text, done):
    def f(s, x, y, w):
        tw_ = tw(text, 12) + 46
        s.add(f'<rect x="{x}" y="{y}" width="{tw_}" height="28" rx="14" fill="#FFFFFF" stroke="#ECEDF2"/>')
        if done:
            s.circle(x + 16, y + 14, 7, GREEN)
            s.path(f"M{x+12.5},{y+14} l2.5,2.5 l4.5,-5", "#fff", 1.8)
        else:
            s.circle(x + 16, y + 14, 6, "none", "#E2E4EA", 2)
            s.path(f"M{x+16},{y+8} A6,6 0 0 1 {x+22},{y+14}", BRAND, 2)
        s.text(x + 30, y + 18.5, text, 12, SUB)
        return 28
    return f


# 时间线：(出现时间, 谁说的, 画法)；画法返回高度
def timeline(t):
    items = [
        (0.8, "值", msg_issue),
        (4.0, "me", lambda s, x, y, w: bubble(s, x + w - 150, y, 150, pick("修复，修好直接发", "Fix it and ship it."), me=True, size=13)),
        (4.8, "sys", pick("已交给「开发」", "Handed to Dev")),
        (5.5, "开", status(pick("复现了：证书没跟着换", "Reproduced: cert not rotated in code"), t > 6.4)),
        (6.6, "开", status(pick("在分支上改好了", "Fixed on branch fix/sign-cert"), t > 7.4)),
        (7.6, "开", msg_change(t > 10.0)),
        (10.8, "发", msg_release),
    ]
    return items


def chat(s, t, x0, y0, w, h):
    """手机里的聊天区：头像 + 气泡 / 卡片，新消息从下面滑上来，满了往上滚。"""
    parts, y, tap = [], 0, None
    for at, who, draw in timeline(t):
        if t < at:
            continue
        p = ease((t - at) / 0.45)
        if who == "sys":
            frag = f'<text x="{w / 2}" y="{y + 16}" font-family="{svgkit.FONT}" font-size="11.5" fill="{FAINT}" text-anchor="middle">{svgkit.T(draw)}</text>'
            hh = 24
        elif who == "me":
            frag, hh = grab(lambda c: draw(c, 0, y, w - 44))
            frag += "\n" + grab(lambda c: me_avatar(c, w - 34, y))[0]
        else:
            label = ""
            if who != "值":
                # 别的员工插进来说话：头像旁边先写名字（像群聊）
                name = {"开": pick("开发", "Dev"), "发": pick("发布", "Release")}[who]
                label = f'<text x="44" y="{y + 10}" font-family="{svgkit.FONT}" font-size="10.5" fill="{FAINT}">{name}</text>'
                av_y = y
                y += 15
            else:
                av_y = y
            frag, hh = grab(lambda c: draw(c, 44, y, w - 44))
            frag = label + frag + "\n" + grab(lambda c: emp_avatar(c, 4, av_y, who, 32))[0]
        parts.append((frag, y, hh, p, draw))
        if draw is msg_issue:
            tap = ("fix", y, hh)
        if who == "开" and hh > 60:
            tap = ("ship", y, hh)
        y += hh + 12
    total = y
    scroll = max(0, total - h + 20)
    out = []
    for frag, yy, hh, p, _ in parts:
        dy = (1 - p) * 24
        out.append(f'<g opacity="{p:.3f}" transform="translate(0 {dy:.1f})">{frag}</g>')
    s.add(f'<clipPath id="cc"><rect x="{x0}" y="{y0}" width="{w}" height="{h}"/></clipPath>')
    s.add(f'<g clip-path="url(#cc)"><g transform="translate({x0} {y0 - scroll:.1f})">' + "\n".join(out) + "</g></g>")
    return parts, scroll


def me_avatar(s, x, y):
    s.add(f'<rect x="{x}" y="{y}" width="32" height="32" rx="9" fill="url(#brand)"/>')
    s.text(x + 16, y + 21.5, pick("我", "Me"), 13, "#fff", 700, "middle")
    return 32


def finger(s, cx, cy, p):
    """点一下：一个圆从大变小，再放出一圈波纹。"""
    if p <= 0 or p >= 1:
        return
    r = 26 - 10 * ease(min(1, p * 2))
    s.add(f'<circle cx="{cx}" cy="{cy}" r="{r:.1f}" fill="#14161F" opacity="{0.22 * (1 - max(0, p - 0.6) / 0.4):.3f}"/>')
    if p > 0.45:
        q = (p - 0.45) / 0.55
        s.add(f'<circle cx="{cx}" cy="{cy}" r="{16 + 26 * q:.1f}" fill="none" stroke="{BRAND}" stroke-width="2" opacity="{0.6 * (1 - q):.3f}"/>')


STEPS = [
    (0.8, pick("「日志值班」发现新报错，查清原因和影响", "Log Watch spots a new error and explains it")),
    (3.0, pick("你点「修复」", "You tap Fix")),
    (5.0, pick("「开发」复现、在分支上改、跑完检查", "Dev reproduces it, fixes it on a branch, runs the checks")),
    (9.0, pick("你点「上线」", "You tap Ship it")),
    (10.8, pick("「发布」上线并盯着，出事自动回滚", "Release ships it and watches — auto-rollback if needed")),
]


def frame(t):
    global STEPS
    s = SVG(W, H, "#F7F6FC")
    defs(s)
    s.add('<defs><linearGradient id="bgg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F4F2FF"/><stop offset="1" stop-color="#EAF6FF"/></linearGradient></defs>')
    s.rect(0, 0, W, H, 0, "url(#bgg)")
    # 手机
    px, py, pw, ph = 110, 24, 360, 672
    s.add(f'<rect x="{px}" y="{py}" width="{pw}" height="{ph}" rx="42" fill="#14161F"/>')
    s.add(f'<rect x="{px+10}" y="{py+10}" width="{pw-20}" height="{ph-20}" rx="33" fill="#F4F5F8"/>')
    s.rect(px + 10, py + 44, pw - 20, 56, 0, "#FFFFFF")
    s.text(px + 28, py + 78, "‹", 22, SUB)
    emp_avatar(s, px + 48, py + 56, "值", 32)
    s.text(px + 90, py + 70, pick("shop 日志值班", "Log Watch"), 14.5, INK, 700)
    s.text(px + 90, py + 88, pick("在盯 shop 三个服务", "Watching 3 shop services"), 11, FAINT)
    # 输入条
    s.rect(px + 10, py + ph - 74, pw - 20, 54, 0, "#FFFFFF")
    s.add(f'<rect x="{px+24}" y="{py+ph-64}" width="{pw-100}" height="34" rx="17" fill="#F4F5F8"/>')
    s.text(px + pw / 2 - 26, py + ph - 42, pick("按住 说话", "Hold to talk"), 13, INK, 600, "middle")
    s.add(f'<circle cx="{px+pw-46}" cy="{py+ph-47}" r="17" fill="url(#brand)"/>')
    cx0, cy0, cw, chh = px + 22, py + 112, pw - 44, ph - 112 - 84
    parts, scroll = chat(s, t, cx0, cy0, cw, chh)
    # 点「修复」/「上线」
    for frag, yy, hh, p, draw in parts:
        bx, by = cx0 + 44 + 18 + 24, cy0 + yy + hh - 36 + 13 - scroll
        if draw is msg_issue:
            finger(s, bx, by, (t - 3.0) / 1.0)
        elif hh > 100 and draw.__name__ == "f" and t < 10.2:
            finger(s, bx + 4, by, (t - 9.0) / 1.0)

    # 右边：标题 + 步骤
    rx = 560
    s.add(f'<g transform="translate({rx} 78) scale(0.5)"><path d="M24.02,65.00 A30,30 0 1 1 35.92,76.49 L19.0,83.0 Z" fill="none" stroke="url(#brand)" stroke-width="13" stroke-linejoin="round" stroke-linecap="round"/><circle cx="50" cy="50" r="8.5" fill="{MINT}"/></g>')
    s.text(rx + 62, 118, "Opero", 40, INK, 800)
    s.text(rx, 168, pick("你自己部署的 AI 开发团队，装在一个聊天 App 里", "Your self-hosted AI dev team, in a chat app"), 22, INK, 600)
    s.text(rx, 200, pick("一个线上 bug：从发现到上线，你只点两下。", "A production bug, from alert to release — in two taps."), 16, SUB)
    for i, (at, text) in enumerate(STEPS):
        y = 268 + i * 76
        on = t >= at and (i == len(STEPS) - 1 or t < STEPS[i + 1][0])
        done = i < len(STEPS) - 1 and t >= STEPS[i + 1][0]
        you = i in (1, 3)
        op = 1 if t >= at else 0.35
        fill = BRAND if on else ("#FFFFFF" if not done else "#EEECFE")
        s.add(f'<g opacity="{op}"><rect x="{rx}" y="{y}" width="620" height="60" rx="14" fill="{fill}" stroke="{"#DCD7FF" if not on else BRAND}"/>')
        num = "✓" if done else str(i + 1)
        s.add(f'<circle cx="{rx+32}" cy="{y+30}" r="15" fill="{"#FFFFFF" if on else (BRAND if done else "#ECEAF8")}"/>')
        s.text(rx + 32, y + 35, num, 14, BRAND if on else ("#FFFFFF" if done else SUB), 700, "middle")
        s.text(rx + 60, y + 36, text, 16.5, "#FFFFFF" if on else INK, 700 if you else 500)
        if you:
            tag = pick("你", "you")
            s.add(f'<rect x="{rx+620-64}" y="{y+19}" width="48" height="22" rx="11" fill="{"#FFFFFF" if on else "#EEECFE"}"/>')
            s.text(rx + 620 - 40, y + 34, tag, 12, BRAND, 700, "middle")
        s.add("</g>")

    # 结尾
    if t > 14.0:
        p = ease((t - 14.0) / 0.6)
        s.add(f'<rect x="0" y="0" width="{W}" height="{H}" fill="#14161F" opacity="{0.95 * p:.3f}"/>')
        s.add(f'<g opacity="{p:.3f}">')
        s.add(f'<g transform="translate({W/2 - 150} 210) scale(0.9)"><path d="M24.02,65.00 A30,30 0 1 1 35.92,76.49 L19.0,83.0 Z" fill="none" stroke="url(#brand)" stroke-width="13" stroke-linejoin="round" stroke-linecap="round"/><circle cx="50" cy="50" r="8.5" fill="{MINT}"/></g>')
        s.text(W / 2 + 40, 278, "Opero", 64, "#FFFFFF", 800, "middle")
        s.text(W / 2, 370, pick("两下点击 · 15 分钟 · 手机上搞定", "2 taps · 15 minutes · from your phone"), 30, "#FFFFFF", 700, "middle")
        s.text(W / 2, 420, pick("自己部署 · Claude Code / Codex 员工 · 以 MCP 为底 · 支持二开",
                                "Self-hosted · Claude Code & Codex employees · MCP · built to be hacked"), 17, "#C9C6E8", 500, "middle")
        s.add("</g>")
    return s


def build(lang):
    svgkit.LANG = lang
    global STEPS
    STEPS = [(a, pick(*x) if isinstance(x, tuple) else x) for a, x in STEPS_SRC]
    tmp = f"/tmp/opero-demo-{lang}"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    n = int(DUR * FPS)
    for i in range(n):
        s = frame(i / FPS)
        s.save(f"{tmp}/f.svg")
        subprocess.run(["rsvg-convert", f"{tmp}/f.svg", "-o", f"{tmp}/{i:04d}.png"], check=True)
    out = f"../../docs/images/{lang}/"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", f"{tmp}/%04d.png",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", out + "demo.mp4"], check=True)
    # GIF：先生成调色板再用它，比直接转清楚很多；宽 960 控制大小
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", f"{tmp}/%04d.png",
                    "-vf", "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle",
                    out + "demo.gif"], check=True)
    shutil.copy(f"{tmp}/{int(8.6 * FPS):04d}.png", out + "demo-poster.png")


STEPS_SRC = [
    (0.8, ("「日志值班」发现新报错，查清原因和影响", "Log Watch spots a new error and explains it")),
    (3.0, ("你点「修复」", "You tap Fix")),
    (5.0, ("「开发」复现、在分支上改、跑完检查", "Dev reproduces, fixes on a branch, runs checks")),
    (9.0, ("你点「上线」", "You tap Ship it")),
    (10.8, ("「发布」上线并盯着，出事自动回滚", "Release ships and watches — auto-rollback")),
]

if __name__ == "__main__":
    for lang in sys.argv[1:] or ["en", "zh"]:
        build(lang)
