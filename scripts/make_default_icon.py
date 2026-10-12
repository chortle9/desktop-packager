#!/usr/bin/env python3
"""生成内置默认图标（圆角渐变底 + 白色地球）。
用法: make_default_icon.py <输出png> [顶部颜色#RRGGBB] [底部颜色#RRGGBB]
"""
import sys

from PIL import Image, ImageDraw


def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


SIZE = 512
SS = 4  # 超采样倍数，用于抗锯齿
W = SIZE * SS

out = sys.argv[1] if len(sys.argv) > 1 else 'icon.png'
top = hex2rgb(sys.argv[2]) if len(sys.argv) > 2 else (59, 130, 246)   # #3B82F6 蓝
bottom = hex2rgb(sys.argv[3]) if len(sys.argv) > 3 else (6, 182, 212) # #06B6D4 青

img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 垂直渐变底
for y in range(W):
    t = y / W
    c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    d.line([(0, y), (W, y)], fill=c + (255,))

# 圆角遮罩
mask = Image.new("L", (W, W), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, W - 1, W - 1], radius=int(W * 0.22), fill=255)
img.putalpha(mask)

# 白色地球
cx, cy, r = W * 0.5, W * 0.5, W * 0.26
lw = int(W * 0.045)
white = (255, 255, 255, 255)
d = ImageDraw.Draw(img)
d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=white, width=lw)          # 外圆
d.line([cx - r, cy, cx + r, cy], fill=white, width=lw)                        # 赤道
d.ellipse([cx - r * 0.42, cy - r, cx + r * 0.42, cy + r], outline=white, width=lw)  # 经线
d.arc([cx - r, cy - r * 0.75, cx + r * 0.8, cy + r * 0.55], 200, 340, fill=white, width=lw)  # 斜弧高光

img = img.resize((SIZE, SIZE), Image.LANCZOS)
img.save(out, "PNG")
print("icon saved ->", out)
