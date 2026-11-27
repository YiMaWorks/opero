#!/usr/bin/env python3
"""写实头像（public/avatars/rl-*.jpg）的后期：把通义万相出的 1024×1024 原图裁到脸为主、压成 256×256 JPG。

原图怎么来：avatars-real.tsv 每行「编号 \\t 人物 \\t 背景色」，套进下面的 PROMPT，用员工的 image_generate 工具
（通义万相 wan2.2-t2i-plus，1024x1024，negative_prompt 用 NEG）一张张出，存成 <原图目录>/<编号>.png。

用法：python3 avatars-real.py <原图目录> <输出目录>（要 Pillow）
"""
import sys, pathlib
from PIL import Image

PROMPT = ('真实人像摄影，{who}，头肩构图，正面，面部居中，自然的微笑，眼神看向镜头，皮肤有真实质感和细微毛孔，淡妆或素颜，'
          '柔和的影棚柔光，{bg}纯色渐变背景，85mm镜头，f/2.0，浅景深，高清，职业形象照')
NEG = '卡通，动漫，插画，3D渲染，塑料皮肤，过度磨皮，美颜滤镜，网红脸，夸张表情，文字，水印，logo，边框，耳机，电脑，复杂背景，多人，手部特写，畸形'

# 原图是头肩照、脸在正中偏上：取中间 72% 的正方形、往上挪一点，脸占圆形头像六成左右，32px 也认得出
CROP = 0.72
UP = 0.07

def main(src: str, dst: str):
    out = pathlib.Path(dst); out.mkdir(parents=True, exist_ok=True)
    for f in sorted(pathlib.Path(src).glob('r[fm][0-9][0-9].png')):
        im = Image.open(f).convert('RGB')
        w, h = im.size
        s = int(min(w, h) * CROP)
        left = (w - s) // 2
        top = max(0, int((h - s) / 2 - h * UP))
        im = im.crop((left, top, left + s, top + s)).resize((256, 256), Image.LANCZOS)
        name = 'rl-' + f.stem[1:] + '.jpg'   # rf01 → rl-f01
        im.save(out / name, quality=86, optimize=True, progressive=True)
        print(name, (out / name).stat().st_size)

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
