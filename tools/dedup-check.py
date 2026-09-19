#!/usr/bin/env python3
"""dedup-check.py —— AI 出图后的「撞图」质检

看图识字题干是图、选项是同单元的字。同一个单元里若有两个字的图长得几乎一样，
孩子眼里就是两个都对 = 死题。用感知哈希（dHash）把所有图两两比对，
只关心同一单元内的近重复（跨单元不影响答题，仅提示）。

用法：
    node tools/emit-units.mjs       # 先导出单元结构
    python3 tools/dedup-check.py    # 再跑本脚本
"""
import json
import os
import sys
from itertools import combinations
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(ROOT)
IMG = os.path.join(ROOT, 'img')
UNITS = os.path.join(ROOT, 'tmp', 'units.json')
THRESHOLD = 10          # 汉明距离 <= 10 视为"看起来一样"（64 位哈希）
WARN = 14               # 10 < d <= 14 提示人工看一眼


def dhash(path):
    im = Image.open(path).convert('L').resize((9, 8), Image.LANCZOS)
    px = list(im.tobytes())
    bits = []
    for r in range(8):
        for c in range(8):
            bits.append(1 if px[r * 9 + c] > px[r * 9 + c + 1] else 0)
    return bits


def dist(a, b):
    return sum(1 for x, y in zip(a, b) if x != y)


def main():
    if not os.path.exists(UNITS):
        sys.exit('先跑：node tools/emit-units.mjs')
    units = json.load(open(UNITS, encoding='utf-8'))

    cache = {}
    missing = []
    for u in units:
        for z in u['zs']:
            f = os.path.join(IMG, 'u%x.webp' % ord(z))
            if not os.path.exists(f):
                missing.append(z)
                continue
            if z not in cache:
                cache[z] = dhash(f)

    print('已有图：%d 字，缺图：%d 字' % (len(cache), len(set(missing))))
    if len(set(missing)):
        print('缺图：' + ''.join(sorted(set(missing))))

    bad, warn = [], []
    for u in units:
        zs = [z for z in u['zs'] if z in cache]
        for a, b in combinations(zs, 2):
            d = dist(cache[a], cache[b])
            if d <= THRESHOLD:
                bad.append((d, u['g'], u['unit'], a, b))
            elif d <= WARN:
                warn.append((d, u['g'], u['unit'], a, b))

    bad.sort()
    warn.sort()
    print('\n同单元撞图（必须重画）：%d 对' % len(bad))
    for d, g, un, a, b in bad:
        print('  G%s %s：%s = %s  (距离 %d)' % (g, un, a, b, d))
    print('疑似相似（建议看一眼）：%d 对' % len(warn))
    for d, g, un, a, b in warn[:20]:
        print('  G%s %s：%s ~ %s  (距离 %d)' % (g, un, a, b, d))
    if len(warn) > 20:
        print('  …另 %d 对' % (len(warn) - 20))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
