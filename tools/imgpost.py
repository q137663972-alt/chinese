#!/usr/bin/env python3
"""imgpost.py —— 图片后处理：可选按 bbox 裁 → 居中裁方 → 缩放到 N×N → 转 WebP

用法：
  python3 tools/imgpost.py <输入图> <输出.webp> [边长=384] [质量=80] [选项]

选项：
  --bbox x,y,w,h       按 0-1000 归一化坐标裁（相对原图宽高）。取 max(w,h)*(1+pad)
                       以中心补成正方；越界则平移，不缩放。
  --pad 0.12           bbox 外扩比例（默认 0.12）
  --no-watermark       跳过「裁掉底部 12%」。Pollinations 免费通道右下角有水印，
                       必须裁；教材扫描图没有水印，裁了反而丢画面 → 一定要加这个参数。
  --auto               没有 bbox 时的兜底：与边缘主色做差分 → Otsu 阈值 → 取最大非背景块

默认行为与改造前完全一致（裁底 12% + 居中裁方），老调用不受影响。
"""
import sys
import os
from PIL import Image, ImageFilter, ImageChops

if len(sys.argv) < 3:
    print(__doc__)
    sys.exit(1)

src, dst = sys.argv[1], sys.argv[2]
rest = sys.argv[3:]

positional = []
bbox = None
pad = 0.12
no_wm = False
auto = False

i = 0
while i < len(rest):
    a = rest[i]
    if a == '--bbox':
        bbox = [float(v) for v in rest[i + 1].split(',')]
        i += 2
    elif a == '--pad':
        pad = float(rest[i + 1]); i += 2
    elif a == '--no-watermark':
        no_wm = True; i += 1
    elif a == '--auto':
        auto = True; i += 1
    else:
        positional.append(a); i += 1

size = int(positional[0]) if len(positional) > 0 else 384
quality = int(positional[1]) if len(positional) > 1 else 80

im = Image.open(src).convert('RGB')

# 1) 躲水印（默认开，教材图必须 --no-watermark 关掉）
if not no_wm:
    w, h = im.size
    im = im.crop((0, 0, w, int(h * 0.88)))

# 2) 裁方
if bbox:
    W, H = im.size
    x, y, bw, bh = [v / 1000.0 * (W if k % 2 == 0 else H) for k, v in enumerate(bbox)]
    s = max(bw, bh) * (1 + pad)
    s = min(s, W, H)                      # 比画布还大就顶到边，不缩放（保清晰度）
    cx, cy = x + bw / 2, y + bh / 2
    left = max(0, min(cx - s / 2, W - s))
    top = max(0, min(cy - s / 2, H - s))
    im = im.crop((int(left), int(top), int(left + s), int(top + s)))
elif auto:
    # 与边缘主色做差分，阈值化后取非背景块的外接框
    g = im.convert('L')
    edge = Image.new('L', im.size, g.getpixel((2, 2)))
    diff = ImageChops.difference(g, edge).filter(ImageFilter.GaussianBlur(2))
    m = diff.point(lambda v: 255 if v > 30 else 0)
    bb = m.getbbox()
    if bb and (bb[2] - bb[0]) > im.size[0] * 0.15 and (bb[3] - bb[1]) > im.size[1] * 0.15:
        w, h = im.size
        bw, bh = bb[2] - bb[0], bb[3] - bb[1]
        s = min(max(bw, bh) * (1 + pad), w, h)
        cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
        left = max(0, min(cx - s / 2, w - s))
        top = max(0, min(cy - s / 2, h - s))
        im = im.crop((int(left), int(top), int(left + s), int(top + s)))
    # 兜底：自动裁失败就走默认居中裁方
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
else:
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))

# 3) 缩放 + 转 WebP
im = im.resize((size, size), Image.LANCZOS)
im.save(dst, 'WEBP', quality=quality, method=6)
print(f'{dst} {size}x{size} {os.path.getsize(dst)}B')
