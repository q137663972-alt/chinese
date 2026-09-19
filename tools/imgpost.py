#!/usr/bin/env python3
"""imgpost.py —— 生图后处理：居中裁方 → 缩放到 N×N → 转 WebP

用法：python3 tools/imgpost.py <输入图> <输出.webp> [边长，默认 384] [质量，默认 80]
"""
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
size = int(sys.argv[3]) if len(sys.argv) > 3 else 384
quality = int(sys.argv[4]) if len(sys.argv) > 4 else 80

im = Image.open(src)
im = im.convert('RGB')
# Pollinations 免费通道右下角有水印：先裁掉底部 12%，再居中裁方
w, h = im.size
im = im.crop((0, 0, w, int(h * 0.88)))
w, h = im.size
s = min(w, h)
im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
im = im.resize((size, size), Image.LANCZOS)
im.save(dst, 'WEBP', quality=quality, method=6)
print(f'{dst} {size}x{size} {__import__("os").path.getsize(dst)}B')
