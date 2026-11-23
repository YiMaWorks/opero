# 设计稿生成脚本

出 `docs/界面设计/` 里的示意图用的，不是产品代码。改了样式或卡片后重新生成：

```bash
cd code/design-mockups
python3 web.py && python3 mobile.py && python3 catalog.py
rsvg-convert -z 2 web.svg -o ../../docs/界面设计/opero-v1-网页.png
rsvg-convert -z 2 mobile.svg -o ../../docs/界面设计/opero-v1-手机.png
rsvg-convert -z 2 catalog.svg -o ../../docs/界面设计/opero-v1-卡片.png
```

- `svgkit.py`：画图小工具 + 设计系统颜色（和 `docs/规范/表单与卡片.md` 第 7 节一致）
- `cards.py`：内核卡片的画法（issue / change / release / query / confirm / ask / file …）
- `logo.py`：Logo 候选对比图 + 推荐款单独文件（输出到 `docs/品牌/`）：`python3 logo.py && rsvg-convert -z 2 logo-sheet.svg -o ../../docs/品牌/opero-logo-候选.png`
- 中间产物 `*.svg` 不提交

## 流程 / 界面对比图、README 用图

- `flows.py`：「以前 → 现在」流程对比（开发、运维、日志巡检、bug 处理）和「从 IDE 到聊天」：`python3 flows.py --png` → `docs/界面设计/opero-变化-*.png`
- `screens.py`：日志巡检 / bug 处理 / 运维的核心界面对比（带标注）：`python3 screens.py` → `docs/界面设计/opero-界面-*.png`
- `readme_images.py`：开源 README 用的中英两套图 → `docs/images/zh/`、`docs/images/en/`。英文文字在 `i18n_en.py`（中文 → 英文的表）；图里加了新的中文，跑一下会列出没翻译的。
- `demo.py`：README 顶部的演示动画（一个线上 bug 从发现到上线，点两下），逐帧 SVG → PNG → ffmpeg 合成 `docs/images/<lang>/demo.gif` / `demo.mp4` / `demo-poster.png`。
- `explainer.py`：「为什么做 Opero」讲解视频（4 幕：会话乱、key 泄露与 Agent 代理、一个 App 打通、只管业务）→ `docs/images/<lang>/explainer.gif` / `.mp4` / `-poster.png`。
