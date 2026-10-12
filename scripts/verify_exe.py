#!/usr/bin/env python3
"""校验打包产物：PE 架构、图标资源、版本信息、NSIS 安装包特征。
用法: verify_exe.py <exe文件>...
"""
import hashlib
import struct
import sys

import pefile

RT_ICON = 3
RT_GROUP_ICON = 14
RT_VERSION = 16
RT_MANIFEST = 24


def resource_types(pe):
    types = set()
    if hasattr(pe, 'DIRECTORY_ENTRY_RESOURCE'):
        for entry in pe.DIRECTORY_ENTRY_RESOURCE.entries:
            types.add(entry.id)
    return types


def icon_entries(pe):
    """返回 [(尺寸提示, 数据bytes)]，尝试解出 PNG 数据"""
    out = []
    if not hasattr(pe, 'DIRECTORY_ENTRY_RESOURCE'):
        return out
    for t in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        if t.id != RT_ICON:
            continue
        for e in t.directory.entries:
            for e2 in (e.directory.entries if e.directory else []):
                data = pe.get_data(e2.data.struct.OffsetToData, e2.data.struct.Size)
                out.append((e.id, data))
    return out


def group_icon_sizes(pe):
    """从 RT_GROUP_ICON 解出包含的图标尺寸列表"""
    sizes = []
    if not hasattr(pe, 'DIRECTORY_ENTRY_RESOURCE'):
        return sizes
    for t in pe.DIRECTORY_ENTRY_RESOURCE.entries:
        if t.id != RT_GROUP_ICON:
            continue
        for e in t.directory.entries:
            for e2 in (e.directory.entries if e.directory else []):
                data = pe.get_data(e2.data.struct.OffsetToData, e2.data.struct.Size)
                n = struct.unpack_from('<H', data, 4)[0]
                for i in range(n):
                    w, h, _planes, _bpp, _size, _off = struct.unpack_from('<BBBBHH', data, 6 + 14 * i)
                    sizes.append((w or 256, h or 256))
    return sizes


def version_product(pe):
    if not hasattr(pe, 'VS_FIXEDFILEINFO'):
        return None
    for finfo in pe.FileInfo:
        for entry in finfo:
            if entry.Key.decode(errors='ignore') == 'StringFileInfo':
                for st in entry.StringTable:
                    for k, v in st.entries.items():
                        if k.decode(errors='ignore') == 'ProductName':
                            return v.decode(errors='ignore')
    return None


def avg_rgb(data):
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    try:
        from PIL import Image
        import io
        im = Image.open(io.BytesIO(data)).convert('RGB').resize((8, 8))
        px = list(im.getdata())
        r = sum(p[0] for p in px) / len(px)
        g = sum(p[1] for p in px) / len(px)
        b = sum(p[2] for p in px) / len(px)
        return (round(r), round(g), round(b))
    except Exception:
        return None


def main(paths):
    ok = True
    for p in paths:
        pe = pefile.PE(p, fast_load=False)
        machine = {0x8664: 'x64', 0x14c: 'x86', 0xaa64: 'ARM64'}.get(pe.FILE_HEADER.Machine, hex(pe.FILE_HEADER.Machine))
        types = resource_types(pe)
        sizes = group_icon_sizes(pe)
        entries = icon_entries(pe)
        png_colors = []
        for _id, data in entries:
            c = avg_rgb(data)
            if c:
                png_colors.append(c)
        prod = version_product(pe)
        with open(p, 'rb') as f:
            head = f.read(2_000_000)
        is_nsis = b'Nullsoft' in head
        checks = {
            'PE 架构': machine,
            '图标资源': '✓' if (RT_ICON in types and RT_GROUP_ICON in types) else '✗',
            '图标尺寸': sizes,
            '版本信息': (prod or '✗'),
            'NSIS 安装包': '✓' if is_nsis else ('-' if '安装包' not in p else '✗'),
            '256px 图标平均色': png_colors[-1] if png_colors else None,
        }
        print(f'== {p}')
        for k, v in checks.items():
            print(f'   {k}: {v}')
        if RT_ICON not in types or RT_GROUP_ICON not in types:
            ok = False
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
