#!/usr/bin/env python3
"""tools/imgstats.py —— 客观图像统计，用来判「写实照片 vs 扁平卡通」和「背景纯不纯」。

为什么不用视觉模型判：免费档 GLM-4V-Flash 实测把一张照片真牛判成「卡通」，
却把扁平卡通的火苗判合格 —— 分不清照片和卡通是它最不行的地方，偏偏这道判据最要命。
而这两件事在像素上是客观的：
  写实照片  = 颜色数极多 + 到处都是细微纹理 + 背景也是杂乱的
  扁平卡通  = 颜色数很少 + 大片纯色块 + 背景纯色
所以改用统计量判，语义项（恐怖、图里有字）才留给视觉模型。

用法：python3 tools/imgstats.py img/u725b.webp   →  一行 JSON
"""
import json
import sys
import numpy as np
from PIL import Image

BLOCK = 8          # 局部平整度统计块边长
FLAT_STD = 6.0     # 块内标准差低于此值视为「纯色块」


def stats(path, size=256):
    im = Image.open(path).convert("RGB").resize((size, size), Image.BILINEAR)
    a = np.asarray(im).astype(np.float32)

    # ① 颜色数：4bit/通道量化后的唯一色数。照片上千，扁平卡通几百。
    q = np.ascontiguousarray((a.astype(np.uint8) >> 4).reshape(-1, 3))
    uniq = int(len(np.unique(q, axis=0)))

    # ② 平整块占比：切 8x8 块，块内标准差小 = 纯色块。扁平卡通大片纯色，照片几乎处处有纹理。
    h, w, _ = a.shape
    bh, bw = h // BLOCK, w // BLOCK
    blocks = a[: bh * BLOCK, : bw * BLOCK].reshape(bh, BLOCK, bw, BLOCK, 3)
    bstd = blocks.std(axis=(1, 3))                      # (bh, bw, 3)
    flat_ratio = float((bstd.max(axis=2) < FLAT_STD).mean())

    # ③ 边缘密度：相邻像素平均绝对差。照片细节多 → 高；扁平卡通只有轮廓 → 低。
    edge = float((np.abs(np.diff(a, axis=0)).mean() + np.abs(np.diff(a, axis=1)).mean()) / 2)

    # ④ 背景（外圈 10% 边框）的色彩离散度：纯色背景 → 极低。
    m = max(2, size // 10)
    border = np.concatenate([
        a[:m].reshape(-1, 3), a[-m:].reshape(-1, 3),
        a[:, :m].reshape(-1, 3), a[:, -m:].reshape(-1, 3),
    ])
    bg_std = float(border.std(axis=0).mean())
    bg_uniq = int(len(np.unique((border.astype(np.uint8) >> 4), axis=0)))

    # ⑤ 主体占比：中心区域与整幅的颜色差（主体是不是压得住画面）
    c = a[size // 4: size * 3 // 4, size // 4: size * 3 // 4]
    return {
        "uniq": uniq,
        "flat": round(flat_ratio, 3),
        "edge": round(edge, 2),
        "bg_std": round(bg_std, 2),
        "bg_uniq": bg_uniq,
        "center_std": round(float(c.std(axis=(0, 1)).mean()), 2),
    }


if __name__ == "__main__":
    out = {}
    for p in sys.argv[1:]:
        try:
            out[p.split("/")[-1]] = stats(p)
        except Exception as e:  # 单张失败不影响整批
            out[p.split("/")[-1]] = {"error": str(e)[:60]}
    print(json.dumps(out if len(out) > 1 else list(out.values())[0], ensure_ascii=False))
