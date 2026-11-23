"""启动页动画 v2：标志画出来 → 缩小落到「Opero」的 O 位置 → p e r o 依次出现 → 标语 → 绿点呼吸。
逐帧画 SVG → rsvg-convert → GIF（docs/品牌/opero-splash.gif）。网页版同一套动画：docs/品牌/opero-splash.html。

时间线（秒）：
  0.10–0.90  画出 O 和气泡尾巴（描线）
  0.85–1.15  绿点弹出（回弹）
  1.25–1.85  标志缩小、移到字标的 O 位置
  1.70–2.20  p e r o 依次浮出（每个字母差 0.07 秒）
  2.15–2.55  标语淡入
  2.60–      绿点呼吸（波纹每秒一次），直到加载完成

尺寸关系（字标里的标志 = 字母 O）：圈的外径 = 大写字母高度（0.75 × 字号），线宽 ≈ 粗体笔画（0.135 × 字号）。
"""
import math
import subprocess
import io
from PIL import Image

W, H = 360, 640
FPS = 25
DUR = 4.4
MINT = "#2EE6B0"
# 标志不能和字一样颜色：标志用品牌紫渐变 + 薄荷绿点，字用白（深色）/ 墨色（浅色）
THEMES = {
    "dark": {"bg": ("#1D1F33", "#0D0E17"), "glow": ("#7C6CFF", 0.30), "mark": ("#A496FF", "#6B5BF6"),
             "text": "#FFFFFF", "slogan": 0.72},
    "light": {"bg": ("#FFFFFF", "#F1EFFF"), "glow": ("#7C6CFF", 0.10), "mark": ("#7C6CFF", "#4F3FE0"),
              "text": "#171A26", "slogan": 0.62},
}
FONT = "Noto Sans CJK SC"

# 标志路径（100×100 方框，圆心 50,50）
R0, SW0 = 30.0, 13.0
_a1, _a2 = math.radians(150), math.radians(118)
P1 = (50 + R0 * math.cos(_a1), 50 + R0 * math.sin(_a1))
P2 = (50 + R0 * math.cos(_a2), 50 + R0 * math.sin(_a2))
TIP = (19.0, 83.0)
PATH = f"M{P1[0]:.2f},{P1[1]:.2f} A30,30 0 1 1 {P2[0]:.2f},{P2[1]:.2f} L{TIP[0]},{TIP[1]} Z"
PLEN = R0 * math.radians(328) + math.dist(P2, TIP) + math.dist(TIP, P1)

# 字标几何（按 Noto Sans CJK Bold 量的：字号 100 时 pero 宽 227.5，p/pe/per 宽 64.4/122.5/166.1）
F = 72                                  # 字标字号
K1 = 1.04 * F / 100                     # 字标里标志的缩放（100 单位 → 像素）
HALF = 38.5 * K1                        # 标志半宽（含尾巴）
GAP = 0.05 * F
ADV = [0, 64.4, 122.5, 166.1]
WORD = 227.5 * F / 100
TOTAL = HALF * 2 + GAP + WORD
BASE = 300                              # 字标基线
MCX1 = W / 2 - TOTAL / 2 + HALF         # 字标里标志的圆心
MCY1 = BASE - 0.375 * F
TX0 = MCX1 + HALF + GAP                 # 「pero」起点
# 开场的大标志
MCX0, MCY0, K0 = W / 2, 268, 1.5


def clamp(x):
    return max(0.0, min(1.0, x))


def seg(t, a, b):
    return clamp((t - a) / (b - a))


def ease_out(x):
    return 1 - (1 - x) ** 3


def ease_io(x):
    return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2


def ease_back(x):
    return 1 + 2.9 * (x - 1) ** 3 + 1.9 * (x - 1) ** 2


def frame(t, theme="dark"):
    th = THEMES[theme]
    m = ease_io(seg(t, 1.25, 1.85))
    cx = MCX0 + (MCX1 - MCX0) * m
    cy = MCY0 + (MCY1 - MCY0) * m
    k = K0 + (K1 - K0) * m
    tf = f'translate({cx - 50*k:.3f},{cy - 50*k:.3f}) scale({k:.4f})'
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
           f'<defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">'
           f'<stop offset="0" stop-color="{th["bg"][0]}"/><stop offset="1" stop-color="{th["bg"][1]}"/></linearGradient>'
           f'<linearGradient id="mg" x1="0" y1="0" x2="1" y2="1">'
           f'<stop offset="0" stop-color="{th["mark"][0]}"/><stop offset="1" stop-color="{th["mark"][1]}"/></linearGradient>'
           f'<radialGradient id="glow" cx="0.5" cy="0.44" r="0.55"><stop offset="0" stop-color="{th["glow"][0]}" stop-opacity="{th["glow"][1]}"/>'
           f'<stop offset="1" stop-color="{th["glow"][0]}" stop-opacity="0"/></radialGradient></defs>',
           f'<rect width="{W}" height="{H}" fill="url(#g)"/>',
           f'<rect width="{W}" height="{H}" fill="url(#glow)"/>',
           f'<g transform="{tf}">']
    p = ease_out(seg(t, 0.10, 0.90))
    if p > 0.002:
        out.append(f'<path d="{PATH}" fill="none" stroke="url(#mg)" stroke-width="{SW0}" stroke-linejoin="round" '
                   f'stroke-linecap="round" stroke-dasharray="{PLEN:.2f} {PLEN:.2f}" stroke-dashoffset="{PLEN*(1-p):.2f}"/>')
    if t >= 2.6:
        ph = (t - 2.6) % 1.0
        out.append(f'<circle cx="50" cy="50" r="{8.5 + 11.5*ease_out(ph):.2f}" fill="none" stroke="{MINT}" '
                   f'stroke-width="2.4" opacity="{0.6*(1-ph):.3f}"/>')
    d = seg(t, 0.85, 1.15)
    if d > 0:
        out.append(f'<circle cx="50" cy="50" r="{8.5*ease_back(d):.2f}" fill="{MINT}"/>')
    out.append('</g>')
    for i, ch in enumerate("pero"):
        e = ease_out(seg(t, 1.70 + 0.07 * i, 2.00 + 0.07 * i))
        if e > 0:
            x = TX0 + ADV[i] * F / 100 - 10 * (1 - e)
            out.append(f'<text x="{x:.2f}" y="{BASE}" font-family="{FONT}" font-size="{F}" font-weight="700" '
                       f'fill="{th["text"]}" opacity="{e:.3f}">{ch}</text>')
    g = ease_out(seg(t, 2.15, 2.55))
    if g > 0:
        out.append(f'<text x="{W/2}" y="{BASE + 52 + 6*(1-g):.2f}" font-family="{FONT}" font-size="15" fill="{th["text"]}" '
                   f'text-anchor="middle" opacity="{th["slogan"]*g:.3f}">和 AI 团队聊天，搞定开发</text>')
    out.append('</svg>')
    return "".join(out)


def render(svg, zoom=1):
    png = subprocess.run(["rsvg-convert", "-f", "png", "-z", str(zoom)], input=svg.encode(),
                         capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(png)).convert("RGB")


HTML = """<!doctype html>
<!-- Opero 启动页（动画版，由 code/design-mockups/splash.py 生成，别手改）。网页 / 桌面 / App WebView 通用，和 opero-splash.gif 同一套动画。
     用法：加载完成后给 #splash 加 class="done"，0.3 秒淡出。系统开了「减少动态效果」时直接显示最终画面。 -->
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Opero</title>
<style>
  html, body {{ margin: 0; height: 100%; }}
  /* 默认深色；系统是浅色模式时用浅色。标志永远是品牌紫 + 薄荷绿点，字和标志不同色 */
  #splash {{ --bg1: #1D1F33; --bg2: #0D0E17; --glow: rgba(124,108,255,.30); --m1: #A496FF; --m2: #6B5BF6;
    --text: #FFFFFF; --slogan: .72; }}
  @media (prefers-color-scheme: light) {{
    #splash {{ --bg1: #FFFFFF; --bg2: #F1EFFF; --glow: rgba(124,108,255,.10); --m1: #7C6CFF; --m2: #4F3FE0;
      --text: #171A26; --slogan: .62; }}
  }}
  #splash {{ position: fixed; inset: 0; transition: opacity .3s ease;
    background: radial-gradient(55% 40% at 50% 44%, var(--glow), transparent),
                linear-gradient(170deg, var(--bg1), var(--bg2)); }}
  .m1 {{ stop-color: var(--m1); }} .m2 {{ stop-color: var(--m2); }}
  #splash.done {{ opacity: 0; pointer-events: none; }}
  svg {{ width: 100%; height: 100%; display: block; }}
  text {{ font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; fill: var(--text); }}
  .mark {{ transform: translate({x0}px, {y0}px) scale({k0});
    animation: settle .6s cubic-bezier(.65,0,.35,1) 1.25s forwards; }}
  .ring {{ fill: none; stroke: url(#mg); stroke-width: 13; stroke-linejoin: round; stroke-linecap: round;
    stroke-dasharray: 100 100; stroke-dashoffset: 100; animation: draw .8s cubic-bezier(.33,1,.68,1) .1s forwards; }}
  .dot {{ fill: #2EE6B0; transform: scale(0); animation: pop .3s cubic-bezier(.34,1.9,.64,1) .85s forwards; }}
  .wave {{ fill: none; stroke: #2EE6B0; stroke-width: 2.4; opacity: 0; animation: wave 1s cubic-bezier(.33,1,.68,1) 2.6s infinite; }}
  .word {{ font-size: {f}px; font-weight: 700; }}
  .ch {{ fill-opacity: 0; animation: rise .3s cubic-bezier(.33,1,.68,1) forwards; }}
  .slogan {{ font-size: 15px; opacity: 0; transform: translateY(6px); animation: slogan .4s cubic-bezier(.33,1,.68,1) 2.15s forwards; }}
  @keyframes settle {{ to {{ transform: translate({x1}px, {y1}px) scale({k1}); }} }}
  @keyframes draw {{ to {{ stroke-dashoffset: 0; }} }}
  @keyframes pop {{ to {{ transform: scale(1); }} }}
  @keyframes wave {{ 0% {{ transform: scale(1); opacity: .6; }} 100% {{ transform: scale(2.35); opacity: 0; }} }}
  @keyframes rise {{ to {{ fill-opacity: 1; }} }}
  @keyframes slogan {{ to {{ opacity: var(--slogan); transform: none; }} }}
  @media (prefers-reduced-motion: reduce) {{
    .mark {{ animation: none; transform: translate({x1}px, {y1}px) scale({k1}); }}
    .ring, .dot, .slogan {{ animation: none; stroke-dashoffset: 0; transform: none; opacity: 1; }}
    .ch {{ animation: none; fill-opacity: 1; }}
    .slogan {{ opacity: var(--slogan); }} .wave {{ display: none; }}
  }}
</style>
</head>
<body>
<div id="splash">
  <svg viewBox="0 0 {w} {h}" preserveAspectRatio="xMidYMid meet" aria-label="Opero">
    <defs><linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop class="m1" offset="0"/><stop class="m2" offset="1"/></linearGradient></defs>
    <g class="mark"><g transform="translate(-50 -50)">
      <path class="ring" pathLength="100" d="{path}"/>
      <circle class="wave" cx="50" cy="50" r="8.5" style="transform-box: fill-box; transform-origin: center"/>
      <circle class="dot" cx="50" cy="50" r="8.5" style="transform-box: fill-box; transform-origin: center"/>
    </g></g>
{letters}
    <text class="slogan" x="{cxw}" y="{sy}" text-anchor="middle">和 AI 团队聊天，搞定开发</text>
  </svg>
</div>
</body>
</html>
"""


def write_html():
    # 整个单词一起排（换字体也不会错位），每个字母只做淡入
    spans = "".join(f'<tspan class="ch" style="animation-delay: {1.70 + 0.07*i:.2f}s">{ch}</tspan>'
                    for i, ch in enumerate("pero"))
    letters = f'    <text class="word" x="{TX0:.2f}" y="{BASE}">{spans}</text>'
    html = HTML.format(x0=MCX0, y0=MCY0, k0=K0, x1=f"{MCX1:.2f}", y1=f"{MCY1:.2f}", k1=f"{K1:.4f}", f=F,
                       w=W, h=H, path=PATH, letters=letters, cxw=W / 2, sy=BASE + 52)
    with open("../../docs/品牌/opero-splash.html", "w", encoding="utf-8") as fh:
        fh.write(html)


if __name__ == "__main__":
    write_html()
    n = int(DUR * FPS)
    hi = [render(frame(i / FPS), 3) for i in range(n)]
    hi[-1].save("../../docs/品牌/opero-splash.png")
    light = render(frame(DUR - 0.01, "light"), 3)
    both = Image.new("RGB", (hi[-1].width * 2 + 60, hi[-1].height), "#E6E7EE")
    both.paste(hi[-1], (0, 0))
    both.paste(light, (hi[-1].width + 60, 0))
    both.save("../../docs/品牌/opero-splash-深浅对比.png")
    # GIF：3 倍（1080×1920，和手机屏幕一样，不再被放大）。GIF 只有 256 色，边缘要靠过渡色才不出锯齿：
    # 挑颜色时只拿「标志 + 字标 + 标语」区域里的像素（背景渐变只占少量），让过渡色都能分到名额；不抖动（抖动会起颗粒）。
    lo = hi
    Z = 3
    box = (int(20 * Z), int(160 * Z), int((W - 20) * Z), int(380 * Z))
    picks = [lo[min(n - 1, int(t * FPS))] for t in (0.4, 0.7, 0.9, 1.0, 1.1, 1.35, 1.5, 1.65, 1.8, 1.9, 2.0, 2.3, 2.7, 2.85, 3.0, 3.2, 3.4, 4.3)]
    crops = [im.crop(box).resize(((box[2] - box[0]) // 2, (box[3] - box[1]) // 2), Image.NEAREST) for im in picks]
    cw, ch = crops[0].size
    cols = 6
    rows = (len(crops) + cols - 1) // cols
    sample = Image.new("RGB", (cw * cols, ch * rows + 400))
    for i, c in enumerate(crops):
        sample.paste(c, ((i % cols) * cw, (i // cols) * ch))
    sample.paste(lo[-1].resize((cw * cols, 400)), (0, ch * rows))
    # 256 色分两份：96 色给背景渐变（取一帧没有标志的背景），160 色给标志 / 字的边缘过渡
    bg_pal = lo[0].resize((W, H)).quantize(colors=96, method=Image.Quantize.MEDIANCUT).getpalette()[:96 * 3]
    fg_pal = sample.crop((0, 0, cw * cols, ch * rows)).quantize(colors=160, method=Image.Quantize.MAXCOVERAGE).getpalette()[:160 * 3]
    pal = Image.new("P", (1, 1))
    pal.putpalette(bg_pal + fg_pal)
    gif = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in lo]
    gif[0].save("../../docs/品牌/opero-splash.gif", save_all=True, append_images=gif[1:],
                duration=int(1000 / FPS), loop=0, optimize=True)
    print("frames", n, "mark→", round(MCX1, 1), round(MCY1, 1), "text x", round(TX0, 1))
