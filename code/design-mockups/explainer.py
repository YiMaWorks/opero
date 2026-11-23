"""讲清楚 Opero 是干什么的（给开发者看），中英两版，约 32 秒：
1 现在的 AI Agent 桌面：能写代码、连库、连服务器，但会话一多就乱
2 每次直接给 key / 账号密码，可能泄露 → Opero 的 Agent 代理：账号在你手上，AI 拿不到
3 开发 → 测试 → 部署 → 上线 → 日志巡检 → 发现 bug → 在线修复 → 发版，一个 App 打通
4 之后你只管业务，开发和运维变简单
逐帧画 SVG → rsvg-convert → ffmpeg。用法：python3 explainer.py [en|zh ...] → docs/images/<lang>/explainer.gif / .mp4 / -poster.png
"""
import math
import os
import shutil
import subprocess
import sys

import svgkit
from svgkit import SVG, tw
from flows import BRAND, INK, SUB, FAINT, RED, RED_SOFT, MINT, defs

W, H, FPS = 1280, 720, 20
SCENES = [(0.0, 8.0), (8.0, 17.0), (17.0, 26.0), (26.0, 32.0)]
DUR = SCENES[-1][1]
GREEN = "#12A150"
DARK = "#14161F"


def pick(zh, en):
    return en if svgkit.LANG == "en" else zh


def clamp(x):
    return max(0.0, min(1.0, x))


def ease(x):
    x = clamp(x)
    return 1 - (1 - x) ** 3


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def logo(s, x, y, k):
    s.add(f'<g transform="translate({x} {y}) scale({k})"><path d="M24.02,65.00 A30,30 0 1 1 35.92,76.49 L19.0,83.0 Z" fill="none" stroke="url(#brand)" stroke-width="13" stroke-linejoin="round" stroke-linecap="round"/><circle cx="50" cy="50" r="8.5" fill="{MINT}"/></g>')


def title(s, n, text, sub, p):
    """每一幕的标题：左上角「1 / 4」+ 大标题 + 一句说明，淡入。"""
    s.add(f'<g opacity="{p:.3f}" transform="translate(0 {(1 - p) * 12:.1f})">')
    s.add(f'<rect x="64" y="52" width="56" height="28" rx="14" fill="{BRAND}"/>')
    s.text(92, 71, f"{n} / 4", 13, "#fff", 700, "middle")
    s.text(64, 124, text, 34, INK, 800)
    s.text(64, 160, sub, 17, SUB)
    s.add("</g>")


# ---------------------------------------------------------------- 1 会话一多就乱
SESS = [
    ("修登录 bug", "fix login bug"), ("查生产库订单", "query prod orders"), ("ssh 到 prod-1 看日志", "ssh prod-1, check logs"),
    ("重构支付模块", "refactor payments"), ("清理测试数据", "clean test data"), ("发版 v1.4.1", "release v1.4.1"),
    ("排查 503", "debug 503s"), ("改导出接口", "fix export API"), ("续 SSL 证书", "renew SSL cert"),
    ("查 shop-admin 内存", "check shop-admin memory"), ("写单元测试", "write unit tests"), ("回滚 v1.4.0？", "roll back v1.4.0?"),
    ("又一个新会话", "yet another session"), ("这个是哪台服务器？", "which server was this?"),
]


def scene1(s, t):
    title(s, 1, pick("AI Agent 桌面很强，但会话一多就乱", "AI agent desktops are powerful — until the sessions pile up"),
          pick("能写代码、连数据库、连服务器……开了十几个会话后，谁也记不清哪个在干什么。",
               "They write code, query databases, SSH into servers… after a dozen sessions, nobody knows which is which."), ease(t / 0.6))
    # 桌面窗口
    x, y, w, h = 64, 196, 1152, 480
    s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="#1C1E25" filter="url(#sh)"/>')
    for i, c in enumerate(["#FF5F57", "#FEBC2E", "#28C840"]):
        s.circle(x + 20 + i * 18, y + 18, 6, c)
    s.text(x + w / 2, y + 23, pick("AI Agent 桌面", "AI agent desktop"), 13, "#9AA0AC", 500, "middle")
    s.rect(x, y + 36, 300, h - 36, 0, "#17181E")
    n = min(len(SESS), int(max(0, t - 0.8) * 3.2))
    for i in range(n):
        name = pick(*SESS[i])
        yy = y + 50 + i * 30
        if yy > y + h - 20:
            break
        hot = i in (2, 4, 9)
        s.rect(x + 10, yy - 2, 280, 26, 6, "#262833" if i == n - 1 else "#17181E")
        s.circle(x + 24, yy + 11, 4, "#F48771" if hot else "#6CB6FF")
        s.text(x + 38, yy + 15.5, name, 13, "#D5D8E0")
        if hot:
            s.text(x + 280, yy + 15.5, pick("生产", "prod"), 11, "#F48771", 600, "end")
    # 右边一堆 tab 和终端
    tabs = min(9, int(max(0, t - 1.2) * 2.4))
    for i in range(tabs):
        tx = x + 310 + i * 92
        s.rect(tx, y + 44, 86, 26, 6, "#2A2C36")
        s.text(tx + 43, y + 61, pick("会话", "chat") + f" {i + 3}", 11.5, "#B5B9C4", 500, "middle")
    for i in range(min(8, int(max(0, t - 1.5) * 2.5))):
        s.rect(x + 316, y + 92 + i * 34, 300 + (i * 97) % 480, 12, 4, ["#4EC9B0", "#9CDCFE", "#CE9178", "#C586C0"][i % 4], opacity=0.7)
    # 结论
    if t > 5.0:
        p = ease((t - 5.0) / 0.5)
        s.add(f'<g opacity="{p:.3f}">')
        s.add(f'<rect x="{x + 640}" y="{y + 330}" width="470" height="120" rx="16" fill="{RED_SOFT}" stroke="{RED}" stroke-opacity=".4"/>')
        s.text(x + 664, y + 372, pick(f"{len(SESS)} 个会话、3 个连着生产", f"{len(SESS)} sessions, 3 touching production"), 20, RED, 800)
        s.text(x + 664, y + 404, pick("哪个在改代码？哪个连着数据库？", "Which one is editing code? Which one has the DB?"), 15, INK)
        s.text(x + 664, y + 428, pick("关掉一个，上下文就没了。", "Close one and its context is gone."), 15, INK)
        s.add("</g>")


# ---------------------------------------------------------------- 2 key 泄露 → Agent 代理
def node(s, x, y, w, h, text, sub, fill, stroke, fg=INK):
    s.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="{fill}" stroke="{stroke}"/>')
    s.text(x + w / 2, y + h / 2 + (2 if sub else 6), text, 18, fg, 700, "middle")
    if sub:
        s.text(x + w / 2, y + h / 2 + 24, sub, 12.5, SUB if fg == INK else "#E6E3FF", 500, "middle")


def keychip(s, x, y, text, color=RED, op=1.0):
    w = tw(text, 13) + 40
    s.add(f'<g opacity="{op:.3f}"><rect x="{x}" y="{y}" width="{w}" height="30" rx="15" fill="#FFFFFF" stroke="{color}"/>')
    # 钥匙
    s.circle(x + 16, y + 15, 5, "none", color, 2)
    s.path(f"M{x+21},{y+15} h9 M{x+27},{y+15} v4", color, 2)
    s.text(x + 36, y + 20, text, 13, color, 600, mono=True)
    s.add("</g>")


def scene2(s, t):
    title(s, 2, pick("把 key 和密码直接交给 AI？", "Handing your keys to the AI?"),
          pick("今天的做法：把数据库密码、服务器账号、云 key 贴进对话 —— 它们会留在提示词、日志和历史记录里。",
               "Today: paste DB passwords, server logins and cloud keys into the chat — they end up in prompts, logs and history."), ease(t / 0.6))
    split = 4.2
    if t < split + 0.5:
        # 以前：key 从你飞向 AI
        op = 1 - ease((t - split) / 0.5)
        s.add(f'<g opacity="{op:.3f}">')
        node(s, 100, 300, 220, 110, pick("你", "You"), pick("复制粘贴", "copy & paste"), "#FFFFFF", "#E2E4EA")
        node(s, 520, 300, 240, 110, "AI agent", pick("提示词 · 会话历史", "prompts · history"), "#FFFFFF", "#E2E4EA")
        node(s, 960, 300, 220, 110, pick("模型服务 · 日志", "Model API · logs"), pick("你管不到的地方", "out of your control"), "#FFFFFF", "#E2E4EA")
        for x1, x2 in ((320, 520), (760, 960)):
            s.add(f'<path d="M{x1},355 L{x2 - 6},355" stroke="{RED}" stroke-width="2" stroke-dasharray="6 5" fill="none" marker-end="url(#arr)"/>')
        keys = [("DB_PASSWORD=Pr0d#2026", 0.8), ("AWS_SECRET_KEY=wJal…", 1.4), ("root@prod-1 : ********", 2.0)]
        for i, (k, at) in enumerate(keys):
            p = clamp((t - at) / 1.6)
            if p <= 0:
                continue
            # 钥匙从「你」一路飘到「模型服务 · 日志」，走在三个框下面
            kx = 120 + p * 820
            ky = 432 + i * 38 - math.sin(p * math.pi) * 14
            keychip(s, kx, ky, k, RED, 1 if p < 1 else 0.9)
        if t > 2.8:
            q = ease((t - 2.8) / 0.4)
            s.add(f'<g opacity="{q:.3f}"><rect x="400" y="566" width="480" height="54" rx="14" fill="{RED_SOFT}" stroke="{RED}" stroke-opacity=".4"/>')
            s.text(640, 600, pick("⚠ 一旦泄露，删聊天记录也收不回来", "⚠ Once leaked, deleting the chat won't take it back"), 17, RED, 700, "middle")
            s.add("</g>")
        s.add("</g>")
    if t > split:
        p = ease((t - split) / 0.6)
        s.add(f'<g opacity="{p:.3f}">')
        s.text(640, 232, pick("Opero：AI 通过 Agent 代理去做，账号始终在你手上", "With Opero: the AI works through an agent proxy. Credentials never leave you."), 19, BRAND, 800, "middle")
        node(s, 80, 300, 220, 110, "AI agent", pick("只说「在 prod-1 上查日志」", "asks: \"check logs on prod-1\""), "#FFFFFF", "#E2E4EA")
        # 代理
        s.add(f'<rect x="420" y="276" width="440" height="160" rx="20" fill="url(#brand)"/>')
        s.text(640, 318, pick("Opero Agent 代理", "Opero agent proxy"), 22, "#fff", 800, "middle")
        s.text(640, 346, pick("身份 → 判定 → 审计 → 执行（MCP）", "identity → policy → audit → execute (MCP)"), 14, "#E6E3FF", 500, "middle")
        # 保险箱
        s.add(f'<rect x="470" y="364" width="340" height="52" rx="12" fill="#FFFFFF" opacity=".95"/>')
        s.rect(488, 386, 22, 18, 4, "none", BRAND, 2)
        s.path("M493,386 v-6 a6,6 0 0 1 12,0 v6", BRAND, 2)
        s.text(522, 396, pick("密码保险箱：加密存在你的服务器上", "Vault: encrypted, on your own server"), 14, INK, 600)
        node(s, 980, 300, 220, 110, pick("服务器 · 数据库 · 云", "Servers · DBs · cloud"), pick("用你的账号去连", "reached with your access"), "#FFFFFF", "#E2E4EA")
        a = ease((t - split - 0.4) / 0.8)
        s.add(f'<path d="M300,355 L{300 + 116 * a:.1f},355" stroke="{BRAND}" stroke-width="3" fill="none"/>')
        b = ease((t - split - 1.0) / 0.8)
        s.add(f'<path d="M860,355 L{860 + 116 * b:.1f},355" stroke="{BRAND}" stroke-width="3" fill="none"/>')
        if t > split + 1.8:
            c = ease((t - split - 1.8) / 0.6)
            s.add(f'<g opacity="{c:.3f}">')
            s.add(f'<rect x="80" y="440" width="220" height="40" rx="10" fill="#E8F7EE"/>')
            s.text(190, 466, pick("AI 只看到结果 ✓", "AI only sees results ✓"), 15, GREEN, 700, "middle")
            for i, line in enumerate([
                pick("· AI 拿不到明文密码和 key", "· The AI never sees plaintext passwords or keys"),
                pick("· 危险操作要你本人指纹确认", "· Risky actions need your fingerprint"),
                pick("· 每一步都进操作记录，能撤销", "· Every step is logged and undoable"),
            ]):
                s.text(420, 486 + i * 30, line, 17, INK, 600)
            s.add("</g>")
        s.add("</g>")


# ---------------------------------------------------------------- 3 一个 App 打通
LOOP = [
    ("开发", "Develop", "开"), ("测试", "Test", "开"), ("部署", "Deploy", "发"), ("上线", "Release", "发"),
    ("日志巡检", "Log watch", "值"), ("发现 bug", "Find bug", "值"), ("在线修复", "Fix online", "开"), ("发版", "Ship", "发"),
]


def scene3(s, t):
    title(s, 3, pick("开发到运维，一个 App 打通", "From code to production — one app"),
          pick("每一步都有 AI 员工负责：开发、测试、部署、上线、日志巡检、发现 bug、在线修复、发版。",
               "AI employees own every step: develop, test, deploy, release, watch logs, find bugs, fix online, ship."), ease(t / 0.6))
    cx, cy, R = 640, 450, 210
    s.add(f'<circle cx="{cx}" cy="{cy}" r="{R}" fill="none" stroke="#DCD7FF" stroke-width="3" stroke-dasharray="6 8"/>')
    # 中间：手机
    s.add(f'<rect x="{cx-62}" y="{cy-110}" width="124" height="220" rx="22" fill="{DARK}"/>')
    s.add(f'<rect x="{cx-55}" y="{cy-103}" width="110" height="206" rx="17" fill="#F4F2FF"/>')
    logo(s, cx - 30, cy - 62, 0.6)
    s.text(cx, cy + 22, "Opero", 20, INK, 800, "middle")
    s.text(cx, cy + 46, pick("一个 App", "one app"), 12, SUB, 500, "middle")
    active = int(max(0, t - 0.8) / 0.75)
    for i, (zh, en, who) in enumerate(LOOP):
        ang = -math.pi / 2 + i * 2 * math.pi / len(LOOP)
        x, y = cx + R * math.cos(ang), cy + R * math.sin(ang)
        on = i < active or (active >= len(LOOP))
        cur = i == active % len(LOOP) and active < len(LOOP) + 4
        w = 150
        fill = BRAND if cur else ("#FFFFFF" if not on else "#EEECFE")
        s.add(f'<rect x="{x - w/2:.1f}" y="{y - 26:.1f}" width="{w}" height="52" rx="26" fill="{fill}" stroke="{BRAND if on or cur else "#E2E4EA"}" stroke-width="{2 if cur else 1}"/>')
        s.text(x, y + 6, pick(zh, en), 16, "#fff" if cur else (BRAND if on else SUB), 700, "middle")
    if t > 7.2:
        p = ease((t - 7.2) / 0.5)
        s.add(f'<g opacity="{p:.3f}"><rect x="900" y="640" width="330" height="44" rx="22" fill="{DARK}"/>')
        s.text(1065, 668, pick("循环跑起来，你只点关键几下", "The loop runs; you tap only the key steps"), 14, "#fff", 600, "middle")
        s.add("</g>")


# ---------------------------------------------------------------- 4 只管业务
def scene4(s, t):
    p = ease(t / 0.8)
    s.add(f'<rect x="0" y="0" width="{W}" height="{H}" fill="{DARK}" opacity="{0.96 * p:.3f}"/>')
    s.add(f'<g opacity="{p:.3f}">')
    logo(s, W / 2 - 170, 150, 1.0)
    s.text(W / 2 + 40, 232, "Opero", 72, "#FFFFFF", 800, "middle")
    q = ease((t - 0.8) / 0.6)
    s.add(f'<g opacity="{q:.3f}">')
    s.text(W / 2, 340, pick("你只管业务。开发和运维，交给 AI 员工。", "You focus on the product. AI employees handle dev & ops."), 32, "#FFFFFF", 800, "middle")
    s.text(W / 2, 392, pick("自己部署 · 账号在你手上 · Claude Code / Codex 员工 · 以 MCP 为底 · 支持二开",
                            "Self-hosted · your credentials stay yours · Claude Code & Codex employees · MCP · hackable"), 17, "#C9C6E8", 500, "middle")
    s.add("</g>")
    r = ease((t - 1.8) / 0.6)
    s.add(f'<g opacity="{r:.3f}"><rect x="{W/2-270}" y="450" width="540" height="56" rx="28" fill="url(#brand)"/>')
    s.text(W / 2, 486, pick("开源 · Apache-2.0 · 欢迎 Star", "Open source · Apache-2.0 · Star it on GitHub"), 18, "#FFFFFF", 700, "middle")
    s.add("</g></g>")


def frame(t):
    s = SVG(W, H, "#F7F6FC")
    defs(s)
    s.add('<defs><linearGradient id="bgg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6F4FF"/><stop offset="1" stop-color="#EDF7FF"/></linearGradient></defs>')
    s.rect(0, 0, W, H, 0, "url(#bgg)")
    fns = [scene1, scene2, scene3, scene4]
    for i, ((a, b), fn) in enumerate(zip(SCENES, fns)):
        if a - 0.01 <= t < b or (i == len(SCENES) - 1 and t >= a):
            # 换场：前一幕最后 0.4 秒淡出
            fade = 1.0 if i == len(SCENES) - 1 else 1 - clamp((t - (b - 0.4)) / 0.4)
            s.add(f'<g opacity="{fade:.3f}">')
            fn(s, t - a)
            s.add("</g>")
    # 底部进度条
    s.rect(0, H - 4, W * t / DUR, 4, 0, BRAND)
    return s


def build(lang):
    svgkit.LANG = lang
    tmp = f"/tmp/opero-explainer-{lang}"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    n = int(DUR * FPS)
    for i in range(n):
        frame(i / FPS).save(f"{tmp}/f.svg")
        subprocess.run(["rsvg-convert", f"{tmp}/f.svg", "-o", f"{tmp}/{i:04d}.png"], check=True)
    out = f"../../docs/images/{lang}/"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", f"{tmp}/%04d.png",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-movflags", "+faststart", out + "explainer.mp4"], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", f"{tmp}/%04d.png",
                    "-vf", "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle",
                    out + "explainer.gif"], check=True)
    shutil.copy(f"{tmp}/{int(15.5 * FPS):04d}.png", out + "explainer-poster.png")


if __name__ == "__main__":
    for lang in sys.argv[1:] or ["en", "zh"]:
        build(lang)
