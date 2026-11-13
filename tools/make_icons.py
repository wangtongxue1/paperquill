#!/usr/bin/env python3
"""生成纸间笔记的应用图标（桌面 / 任务栏）。

图案与界面左上角的 LOGO 完全一致：墨绿圆角底 + 白色「纸」字，字形取自
tools/brand-glyph.json（由 gen_brand_glyph.py 从 Noto Sans SC Bold 烘焙，
SIL OFL 授权），按墨迹光学中心精确居中。以前这里是「一页白纸 + 三行线」，
跟应用内的「纸」字方块对不上，而且字是 CSS 文字、居中靠字框，看着总是歪的。

依赖 Pillow（仅生成时；产出的 PNG/ICO 已经提交，构建不需要）。
输出 PNG 各尺寸 + 一个多尺寸 ICO。

用法：python tools/make_icons.py
"""

import json
import struct
import zlib
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'src-tauri' / 'icons'
DATA = ROOT / 'tools' / 'brand-glyph.json'
SUPER = 4  # 超采样倍数，用来做边缘抗锯齿

GREEN = (47, 143, 104, 255)
WHITE = (255, 255, 255, 255)
INSET = 4          # 图标四周留一点安全边距，别贴到窗口边
RADIUS = 27.6      # 0..100 viewBox 里的圆角半径


def render(size: int, polys) -> Image.Image:
    """按目标尺寸原生绘制再降采样：每个尺寸都是自己的抗锯齿，不靠大模型缩小。"""
    s = size * SUPER
    k = s / 100
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    dr.rounded_rectangle(
        [INSET * k, INSET * k, (100 - INSET) * k, (100 - INSET) * k],
        radius=RADIUS * k, fill=GREEN,
    )
    for poly in polys:
        dr.polygon([(x * k, y * k) for x, y in poly], fill=WHITE)
    return im.resize((size, size), Image.LANCZOS)


def png_bytes(im: Image.Image) -> bytes:
    import io
    buf = io.BytesIO()
    im.save(buf, format='PNG', optimize=True)
    return buf.getvalue()


def chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)


def make_ico(entries) -> bytes:
    """Vista+ 的 ICO 可以直接内嵌 PNG，不必再手搓 BMP/DIB。"""
    header = struct.pack('<HHH', 0, 1, len(entries))
    table, blob = b'', b''
    offset = 6 + 16 * len(entries)
    for size, data in entries:
        b = size if size < 256 else 0
        table += struct.pack('<BBBBHHII', b, b, 0, 0, 1, 32, len(data), offset)
        blob += data
        offset += len(data)
    return header + table + blob


def main():
    if not DATA.exists():
        raise SystemExit('缺少 tools/brand-glyph.json，先跑 python tools/gen_brand_glyph.py')
    glyph = json.loads(DATA.read_text(encoding='utf-8'))
    polys = glyph['polys']
    OUT.mkdir(parents=True, exist_ok=True)

    sizes = [16, 32, 48, 64, 128, 256, 512]
    files = {32: '32x32.png', 128: '128x128.png', 256: '128x128@2x.png', 512: 'icon.png'}
    ico_entries = []
    for size in sizes:
        data = png_bytes(render(size, polys))
        ico_entries.append((size, data))
        if size in files:
            (OUT / files[size]).write_bytes(data)
    (OUT / 'icon.ico').write_bytes(make_ico([e for e in ico_entries if e[0] <= 256]))
    print(f'图标已生成（字形「{glyph["char"]}」，光学中心 {glyph["opticalCenter"]}）：')
    print('  ' + ', '.join(p.name for p in sorted(OUT.iterdir())))


if __name__ == '__main__':
    main()
