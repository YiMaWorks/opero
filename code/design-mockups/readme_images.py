"""README 用的图（中英两套）：python3 readme_images.py → docs/images/en/*.png、docs/images/zh/*.png
英文版的文字在 i18n_en.py；有没翻译的会列出来。"""
import os
import subprocess
import sys

import svgkit
import flows
import screens

ROOT = "../../docs/images/"
SHOTS = [  # (函数, svg 名, 输出文件名)
    (flows.ui, "ui-flow.svg", "ide-to-chat.png"),
    (screens.patrol, None, "screen-log-patrol.png"),
    (screens.bug, None, "screen-bug-fix.png"),
    (screens.ops, None, "screen-ops.png"),
    (flows.patrol, "patrol-flow.svg", "flow-log-patrol.png"),
    (flows.bug, "bug-flow.svg", "flow-bug-fix.png"),
    (flows.ops, "ops-flow.svg", "flow-ops.png"),
]
SCREEN_PNG = {screens.patrol: "opero-界面-日志巡检.png", screens.bug: "opero-界面-bug处理.png", screens.ops: "opero-界面-运维.png"}

for lang in sys.argv[1:] or ["zh", "en"]:
    svgkit.LANG = lang
    out = ROOT + lang + "/"
    os.makedirs(out, exist_ok=True)
    for fn, svg, png in SHOTS:
        if svg is None:
            screens.OUT["dir"] = out
            fn()
            os.replace(out + SCREEN_PNG[fn], out + png)
        else:
            fn()
            subprocess.run(["rsvg-convert", "-z", "2", svg, "-o", out + png], check=True)
    screens.OUT["dir"] = "../../docs/界面设计/"

if svgkit.MISSING:
    print("没翻译的：")
    for m in svgkit.MISSING:
        print(repr(m))
