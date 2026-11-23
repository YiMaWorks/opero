"""出设计稿用的小工具：拼 SVG，再用 rsvg-convert 转 PNG。只用于 docs/界面设计/ 的示意图。"""
from xml.sax.saxutils import escape

FONT = "Noto Sans CJK SC"
MONO = "Noto Sans Mono CJK SC"

# 设计系统（草案 v0.1）
C = {
    "primary": "#5B4FE9", "primary_soft": "#EEECFE", "primary_text": "#4338CA",
    "ok": "#16A34A", "ok_soft": "#E8F7EE",
    "warn": "#D97706", "warn_soft": "#FEF3E2",
    "danger": "#DC2626", "danger_soft": "#FDECEC",
    "info": "#0EA5E9", "info_soft": "#E6F5FD",
    "bg": "#F4F5F9", "panel": "#FFFFFF", "nav": "#171A26", "nav_text": "#9AA0B4",
    "text": "#1C1F2A", "sub": "#6B7280", "faint": "#9CA3AF", "line": "#E7E8EE",
    "code_bg": "#FAFAFC", "add": "#E7F6EC", "add_strong": "#C9EDD5", "del": "#FDEDED", "del_strong": "#F8D3D3",
}
AVATAR = {"Y": "#10B981", "开": "#EC4899", "发": "#0EA5E9", "运": "#F97316", "管": "#475569", "总": "#6366F1", "我": "#334155"}


# ---- 多语言：LANG = "en" 时，含中文的文字按 i18n_en.py 的表换成英文（没翻译的记进 MISSING） ----
LANG = "zh"
MISSING = []
_EN = None


def T(s):
    global _EN
    if LANG == "zh" or not any(ord(c) > 0x2E80 for c in s):
        return s
    if _EN is None:
        try:
            from i18n_en import EN
        except ImportError:
            EN = {}
        _EN = EN
    if s in _EN:
        return _EN[s]
    if s not in MISSING:
        MISSING.append(s)
    return s


def tw(s, size):
    """估算文字宽度。"""
    s = T(s)
    w = 0
    for ch in s:
        w += size * (1.0 if ord(ch) > 0x2E80 else 0.6)
    return w


class SVG:
    def __init__(self, w, h, bg=C["bg"]):
        self.w, self.h = w, h
        self.items = []
        self.defs = []
        self.rect(0, 0, w, h, 0, bg)

    def add(self, s):
        self.items.append(s)

    def rect(self, x, y, w, h, r=0, fill="none", stroke=None, sw=1, opacity=1, shadow=False):
        st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
        if shadow:
            self.add(f'<rect x="{x}" y="{y+2}" width="{w}" height="{h}" rx="{r}" fill="#1C1F2A" opacity="0.05"/>')
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}"{st} opacity="{opacity}"/>')

    def text(self, x, y, s, size=14, color=C["text"], weight=400, anchor="start", mono=False, opacity=1):
        s = T(s)
        fam = MONO if mono else FONT
        self.add(f'<text x="{x}" y="{y}" font-family="{fam}" font-size="{size}" font-weight="{weight}" '
                 f'fill="{color}" text-anchor="{anchor}" opacity="{opacity}" xml:space="preserve">{escape(s)}</text>')

    def line(self, x1, y1, x2, y2, color=C["line"], sw=1):
        self.add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{sw}"/>')

    def circle(self, cx, cy, r, fill, stroke=None, sw=1):
        st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
        self.add(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"{st}/>')

    def path(self, d, stroke, sw=2, fill="none"):
        self.add(f'<path d="{d}" stroke="{stroke}" stroke-width="{sw}" fill="{fill}" stroke-linecap="round" stroke-linejoin="round"/>')

    # ---- 组件 ----
    def avatar(self, x, y, size, ch, color=None, r=None):
        color = color or AVATAR.get(ch, C["primary"])
        self.rect(x, y, size, size, r if r is not None else size * 0.28, color)
        self.text(x + size / 2, y + size * 0.66, ch, size * 0.46, "#fff", 600, "middle")

    def pill(self, x, y, s, fg, bg, size=12, pad=8, h=None):
        h = h or size + 10
        w = tw(s, size) + pad * 2
        self.rect(x, y, w, h, h / 2, bg)
        self.text(x + w / 2, y + h / 2 + size * 0.36, s, size, fg, 500, "middle")
        return w

    def button(self, x, y, s, kind="default", size=13, h=32, pad=14):
        w = tw(s, size) + pad * 2
        if kind == "primary":
            self.rect(x, y, w, h, 8, C["primary"])
            col = "#fff"
        elif kind == "danger":
            self.rect(x, y, w, h, 8, C["danger"])
            col = "#fff"
        elif kind == "ghost":
            col = C["primary_text"]
        else:
            self.rect(x, y, w, h, 8, "#fff", C["line"])
            col = C["text"]
        self.text(x + w / 2, y + h / 2 + size * 0.36, s, size, col, 500, "middle")
        return w

    def button_r(self, right, y, s, kind="default", **kw):
        """右对齐按钮，返回左边 x。"""
        size = kw.get("size", 13)
        pad = kw.get("pad", 14)
        w = tw(s, size) + pad * 2
        self.button(right - w, y, s, kind, **kw)
        return right - w

    def check(self, x, y, color=C["ok"], s=12):
        self.circle(x + s / 2, y + s / 2, s / 2, color)
        self.path(f"M{x+s*0.28},{y+s*0.52} L{x+s*0.44},{y+s*0.68} L{x+s*0.74},{y+s*0.36}", "#fff", 1.6)

    def dot(self, x, y, color, r=4):
        self.circle(x, y, r, color)

    def spinner(self, x, y, color=C["primary"], r=6):
        self.circle(x, y, r, "none", C["line"], 2)
        self.path(f"M{x},{y-r} A{r},{r} 0 0 1 {x+r},{y}", color, 2)

    def caption(self, x, y, s):
        self.text(x, y, s, 13, C["sub"], 400, "middle")

    def save(self, path):
        body = "\n".join(self.items)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" '
               f'viewBox="0 0 {self.w} {self.h}">{"".join(self.defs)}\n{body}\n</svg>')
        with open(path, "w", encoding="utf-8") as f:
            f.write(svg)


def nav_icon(s, kind, x, y, color):
    """简单线框图标，24x24。"""
    if kind == "chat":
        s.path(f"M{x+3},{y+5} h18 a2,2 0 0 1 2,2 v9 a2,2 0 0 1 -2,2 h-10 l-5,4 v-4 h-3 a2,2 0 0 1 -2,-2 v-9 a2,2 0 0 1 2,-2 z", color, 1.8)
    elif kind == "people":
        s.circle(x + 10, y + 9, 4, "none", color, 1.8)
        s.path(f"M{x+3},{y+21} c0,-5 4,-7 7,-7 s7,2 7,7", color, 1.8)
        s.path(f"M{x+17},{y+5} a4,4 0 0 1 0,8 M{x+20},{y+15} c2,1 3,3 3,6", color, 1.8)
    elif kind == "folder":
        s.path(f"M{x+2},{y+6} h7 l2,2 h11 v12 h-20 z", color, 1.8)
    elif kind == "apps":
        for dx in (0, 11):
            for dy in (0, 11):
                s.rect(x + 2 + dx, y + 2 + dy, 8, 8, 2, "none", color, 1.8)
    elif kind == "me":
        s.circle(x + 12, y + 8, 5, "none", color, 1.8)
        s.path(f"M{x+3},{y+22} c0,-6 5,-8 9,-8 s9,2 9,8", color, 1.8)
    elif kind == "home":
        s.path(f"M{x+3},{y+11} l9,-7 l9,7 v10 h-18 z", color, 1.8)
