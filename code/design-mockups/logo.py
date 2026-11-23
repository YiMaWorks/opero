"""Opero logo 候选（三款）+ 推荐款的单独文件。

A 对话 O：O 的左下角长出气泡尾巴（聊天为入口），中间一颗薄荷绿的点（AI 员工在干活——界面里「在干活」的状态点）。
B 轨道 O：O 上缺一口，一颗点在轨道上（员工围着你的业务转）。
C 气泡终端：气泡里一个 >_（在聊天里干开发的活）。
"""
import math
import os
from svgkit import SVG, C, FONT

PURPLE_A, PURPLE_B = "#7C6CFF", "#4F3FE0"
MINT = "#2EE6B0"
INK = "#171A26"
OUT = "../../docs/品牌"


def mark_A(cx, cy, size, color, dot=MINT):
    k = size / 100
    r, sw = 30 * k, 13 * k
    a1, a2 = math.radians(150), math.radians(118)
    x1, y1 = cx + r * math.cos(a1), cy + r * math.sin(a1)
    x2, y2 = cx + r * math.cos(a2), cy + r * math.sin(a2)
    tx, ty = cx - 31 * k, cy + 33 * k
    d = f"M{x1:.2f},{y1:.2f} A{r:.2f},{r:.2f} 0 1 1 {x2:.2f},{y2:.2f} L{tx:.2f},{ty:.2f} Z"
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{sw:.2f}" '
            f'stroke-linejoin="round" stroke-linecap="round"/>'
            f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{8.5*k:.2f}" fill="{dot}"/>')


def mark_B(cx, cy, size, color, dot=MINT):
    k = size / 100
    r, sw = 30 * k, 13 * k
    gap = math.radians(30)
    c = math.radians(-45)
    a1, a2 = c + gap, c - gap
    x1, y1 = cx + r * math.cos(a1), cy + r * math.sin(a1)
    x2, y2 = cx + r * math.cos(a2), cy + r * math.sin(a2)
    d = f"M{x1:.2f},{y1:.2f} A{r:.2f},{r:.2f} 0 1 1 {x2:.2f},{y2:.2f}"
    dx, dy = cx + r * math.cos(c), cy + r * math.sin(c)
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{sw:.2f}" stroke-linecap="round"/>'
            f'<circle cx="{dx:.2f}" cy="{dy:.2f}" r="{9*k:.2f}" fill="{dot}"/>')


def mark_C(cx, cy, size, color, dot=MINT, inner="#fff"):
    k = size / 100
    x0, y0 = cx - 32 * k, cy - 27 * k
    w, h, r = 64 * k, 50 * k, 15 * k
    body = (f'<rect x="{x0:.2f}" y="{y0:.2f}" width="{w:.2f}" height="{h:.2f}" rx="{r:.2f}" fill="{color}"/>'
            f'<path d="M{cx-20*k:.2f},{cy+20*k:.2f} L{cx-26*k:.2f},{cy+34*k:.2f} L{cx-6*k:.2f},{cy+22*k:.2f} Z" '
            f'fill="{color}" stroke="{color}" stroke-width="{3*k:.2f}" stroke-linejoin="round"/>')
    sw = 7 * k
    chev = (f'<path d="M{cx-17*k:.2f},{cy-12*k:.2f} L{cx-5*k:.2f},{cy-2*k:.2f} L{cx-17*k:.2f},{cy+8*k:.2f}" '
            f'fill="none" stroke="{inner}" stroke-width="{sw:.2f}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="M{cx+3*k:.2f},{cy+8*k:.2f} L{cx+17*k:.2f},{cy+8*k:.2f}" stroke="{dot}" '
            f'stroke-width="{sw:.2f}" stroke-linecap="round"/>')
    return body + chev


def grad_defs(s):
    s.defs.append(f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
                  f'<stop offset="0" stop-color="{PURPLE_A}"/><stop offset="1" stop-color="{PURPLE_B}"/>'
                  f'</linearGradient></defs>')


def app_icon(s, x, y, size, mark, **kw):
    s.add(f'<rect x="{x}" y="{y}" width="{size}" height="{size}" rx="{size*0.225:.2f}" fill="url(#g)"/>')
    if mark is mark_C:
        s.add(mark(x + size / 2, y + size / 2, size * 0.78, "#fff", inner=PURPLE_B))
    else:
        s.add(mark(x + size / 2, y + size / 2, size * 0.78, "#fff", **kw))


def wordmark(s, x, y, size, color):
    s.add(f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="700" '
          f'fill="{color}" letter-spacing="{-size*0.02:.2f}">Opero</text>')


# ---- 对比图 ----
W, H = 1600, 1040
s = SVG(W, H, "#F4F5F9")
grad_defs(s)
s.text(60, 70, "Opero Logo 候选", 28, C["text"], 700)
s.text(60, 102, "颜色：紫色系（主色）+ 薄荷绿（「在干活」的状态点，和界面一致）。同一个标志用于 App 图标、网页左上角、桌面托盘、推送小图标。", 14, C["sub"])
cands = [
    ("A", "对话 O（推荐）", mark_A, ["O 的左下角长出气泡尾巴：聊天就是入口", "中间的绿点：AI 员工在干活", "小到 16px 还认得出，和「O」字母直接对应"]),
    ("B", "轨道 O", mark_B, ["O 上缺一口，一颗点在轨道上", "员工围着你的业务转、一直在线", "更抽象、更像科技公司"]),
    ("C", "气泡终端", mark_C, ["气泡里一个 >_", "在聊天里干开发的活，一看就懂", "最直白，但和「O」没关系"]),
]
colw = 480
for i, (key, name, mk, notes) in enumerate(cands):
    x = 60 + i * (colw + 20)
    y = 140
    s.rect(x, y, colw, 860, 20, "#FFFFFF", "#E7E8EE")
    if key == "A":
        s.rect(x, y, colw, 860, 20, "none", PURPLE_B, 2)
    s.text(x + 28, y + 46, f"{key} · {name}", 20, C["text"], 700)
    app_icon(s, x + 28, y + 76, 200, mk)
    s.rect(x + 252, y + 76, 200, 96, 16, "#FFFFFF", "#E7E8EE")
    s.add(mk(x + 352, y + 124, 84, PURPLE_B) if mk is not mark_C else mk(x + 352, y + 124, 84, PURPLE_B))
    s.rect(x + 252, y + 180, 200, 96, 16, INK)
    s.add(mk(x + 352, y + 228, 84, "#FFFFFF") if mk is not mark_C else mk(x + 352, y + 228, 84, "#FFFFFF", inner=INK))
    # 横版组合
    ly = y + 330
    s.rect(x + 28, ly, colw - 56, 110, 16, "#FFFFFF", "#E7E8EE")
    app_icon(s, x + 52, ly + 23, 64, mk)
    wordmark(s, x + 132, ly + 75, 44, C["text"])
    s.rect(x + 28, ly + 124, colw - 56, 110, 16, INK)
    app_icon(s, x + 52, ly + 147, 64, mk)
    wordmark(s, x + 132, ly + 199, 44, "#FFFFFF")
    # 小尺寸
    sy = ly + 270
    s.text(x + 28, sy, "小尺寸", 13, C["faint"], 600)
    sx = x + 28
    for sz in (64, 48, 32, 24, 16):
        app_icon(s, sx, sy + 14 + (64 - sz) / 2, sz, mk)
        sx += sz + 22
    for j, n in enumerate(notes):
        s.text(x + 28, sy + 120 + j * 26, "· " + n, 14, C["sub"])
s.save("logo-sheet.svg")

# ---- 推荐款单独文件 ----
os.makedirs(OUT, exist_ok=True)


def single(name, w, h, bg, fn):
    t = SVG(w, h, bg)
    if bg == "none":
        t.items.clear()
    grad_defs(t)
    fn(t)
    t.save(f"{OUT}/{name}.svg")


single("opero-icon", 1024, 1024, "none", lambda t: app_icon(t, 0, 0, 1024, mark_A))
single("opero-mark", 512, 512, "none", lambda t: t.add(mark_A(256, 256, 480, PURPLE_B)))
single("opero-mark-white", 512, 512, "none", lambda t: t.add(mark_A(256, 256, 480, "#FFFFFF")))


def lockup(t, color, mark_color):
    """横版字标：标志当「O」+ pero（和启动页最终画面一致）。字号 96，圆的外径 = 大写高度。"""
    f = 96
    k = 1.04 * f / 100
    half = 38.5 * k
    base = 112
    cx, cy = 16 + half, base - 0.375 * f
    t.add(mark_A(cx, cy, 100 * k, mark_color))
    t.add(f'<text x="{cx + half + 0.05 * f:.2f}" y="{base}" font-family="{FONT}" font-size="{f}" '
          f'font-weight="700" fill="{color}">pero</text>')


single("opero-logo", 340, 150, "none", lambda t: lockup(t, C["text"], PURPLE_B))
single("opero-logo-dark", 340, 150, "none", lambda t: lockup(t, "#FFFFFF", "#8E7EFF"))
