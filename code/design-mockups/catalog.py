"""内核卡片清单：每种卡片的样子 + 类型名（对应 docs/规范/表单与卡片.md）。"""
from svgkit import SVG, C
import cards

W, H = 1600, 960
s = SVG(W, H)
s.text(48, 58, "Opero 内核卡片（v0.1）", 26, C["text"], 700)
s.text(48, 88, "所有卡片 = 一份 JSON 描述，网页 / 桌面 / App 用同一套网页组件渲染（App 里是 WebView）；加卡片不用发 App。插件要更复杂的界面用 MCP Apps。", 14, C["sub"])

COLW = 470
cols = [48, 48 + COLW + 40, 48 + (COLW + 40) * 2]


def label(x, y, code, desc):
    s.text(x, y, code, 13, C["primary_text"], 600, mono=True)
    s.text(x + 9 * len(code) + 12, y, desc, 13, C["sub"])
    return 14


# 第 1 列
x, y = cols[0], 130
y += label(x, y, "text", "员工说的话（Markdown）") + 6
y += cards.card_text(s, x, y, COLW) + 26
y += label(x, y, "status", "在做什么（自动来自执行器事件）") + 14
cards.status_line(s, x, y + 4, "在查日志… 已读 3 个文件", spinner=True)
y += 34
y += label(x, y, "file", "文件 / 图片 / 日志片段") + 6
y += cards.card_file(s, x, y, COLW) + 26
y += label(x, y, "issue", "问题：原因、影响、证据、建议") + 6
y += cards.card_issue(s, x, y, COLW) + 26
y += label(x, y, "system", "系统提示（触发、转来）") + 10
cards.system_line(s, x + COLW / 2, y, "09:41 · 日志扫描发现新异常：支付失败 37 次")

# 第 2 列
x, y = cols[1], 130
y += label(x, y, "change", "改动：文件、检查结果、合并状态") + 6
y += cards.card_change(s, x, y, COLW) + 26
y += label(x, y, "release", "发布：进度、发布后观察、回滚") + 6
y += cards.card_release(s, x, y, COLW) + 26
y += label(x, y, "ask", "提问：员工拿不准时让你选（少用）") + 6
y += cards.card_ask(s, x, y, COLW) + 26

# 第 3 列
x, y = cols[2], 130
y += label(x, y, "query", "查询结果：SQL 可见、可导出、可存成菜单") + 6
y += cards.card_query(s, x, y, COLW) + 26
y += label(x, y, "confirm", "要你确认：只有危险操作 / 你没权限时") + 6
y += cards.card_confirm(s, x, y, COLW) + 26
y += label(x, y, "app", "插件自定义界面（MCP Apps，沙箱里跑）") + 6
s.rect(x, y, COLW, 110, 12, C["panel"], C["line"], shadow=True)
s.add(f'<rect x="{x+14}" y="{y+14}" width="{COLW-28}" height="82" rx="8" fill="none" stroke="{C["faint"]}" stroke-dasharray="5 4"/>')
s.text(x + COLW / 2, y + 50, "ui://release/publish", 13, C["primary_text"], 600, "middle", mono=True)
s.text(x + COLW / 2, y + 74, "插件的 HTML 表单，主题 / 语言由宿主传入", 12.5, C["sub"], 400, "middle")

s.save("catalog.svg")
