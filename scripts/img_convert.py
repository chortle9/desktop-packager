#!/usr/bin/env python3
"""图片转 512x512 正方形 PNG（居中裁剪）。用法: img_convert.py <src> <out> <size>"""
import sys

from PIL import Image

src, out, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert("RGBA")
w, h = im.size
scale = max(size / w, size / h)
nw, nh = round(w * scale), round(h * scale)
im = im.resize((nw, nh), Image.LANCZOS)
left = (nw - size) // 2
top = (nh - size) // 2
im = im.crop((left, top, left + size, top + size))
im.save(out, "PNG")
print("ok")
