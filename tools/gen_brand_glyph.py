#!/usr/bin/env python3
"""从 Noto Sans SC（SIL OFL）提取「纸」字轮廓，生成品牌标记的共享数据。

为什么要矢量字形：原先 LOGO 是 CSS 文字 + place-items:center，居中的是「字框」，
但汉字的墨迹在字框里并不对称（上密下疏、左密右疏），再叠加 letter-spacing:-1px，
肉眼看上去永远是歪的；而且不同系统回退字体不一样，偏移方向还会变。

这里把字形烘焙成路径，按墨迹包围盒精确居中，界面 SVG 和桌面 ICO 共用同一份数据。

用法：python tools/gen_brand_glyph.py
输出：tools/brand-glyph.json（脚本读取）、src/brandGlyph.ts（前端引用）
"""

import json
import math
import re
from pathlib import Path

from PIL import Image, ImageDraw
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
FONT = Path(r'C:\Windows\Fonts\NotoSansSC-VF.ttf')
CHAR = '纸'
WEIGHT = 800  # 比常规 Bold 略厚：30px 的标题栏图标、16px 的任务栏图标都更清晰


NUM = r'[-+]?\d*\.?\d+'


def flatten(d: str):
    """把 SVG path（M/L/Q/C/Z，绝对坐标）离散成一串闭合多边形。"""
    toks = re.findall(r'[A-Za-z]|' + NUM, d)
    polys, cur, p = [], [], (0.0, 0.0)
    i = 0

    def bez(p0, p1, p2, p3=None):
        steps = 10 if p3 is None else 14
        out = []
        for k in range(1, steps + 1):
            t = k / steps
            if p3 is None:  # 二次
                x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0]
                y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]
            else:           # 三次
                x = (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t ** 2 * p2[0] + t ** 3 * p3[0]
                y = (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t ** 2 * p2[1] + t ** 3 * p3[1]
            out.append((x, y))
        return out

    while i < len(toks):
        c = toks[i]
        if c.isalpha():
            i += 1
            if c in 'Zz':
                if len(cur) > 2:
                    polys.append(cur)
                cur = []
                continue
            if c in 'Mm':
                if len(cur) > 2:
                    polys.append(cur)
                cur = []
            while i < len(toks) and not toks[i].isalpha():
                if c in 'MmLl':
                    x, y = float(toks[i]), float(toks[i + 1]); i += 2
                    if c in 'ml' and cur:
                        x += p[0]; y += p[1]
                    p = (x, y); cur.append(p)
                elif c in 'Qq':
                    x1, y1, x, y = map(float, toks[i:i + 4]); i += 4
                    cur.extend(bez(p, (x1, y1), (x, y)))
                    p = (x, y)
                elif c in 'Cc':
                    x1, y1, x2, y2, x, y = map(float, toks[i:i + 6]); i += 6
                    cur.extend(bez(p, (x1, y1), (x2, y2), (x, y)))
                    p = (x, y)
                elif c in 'Hh':
                    x = float(toks[i]); i += 1
                    p = (x, p[1]); cur.append(p)
                elif c in 'Vv':
                    y = float(toks[i]); i += 1
                    p = (p[0], y); cur.append(p)
                else:
                    i += 1
    if len(cur) > 2:
        polys.append(cur)
    return polys


def ink_centroid(polys, box):
    """把字形光栅化，算墨迹质心。汉字左密右疏，纯 bbox 居中看着仍会偏，
    这里给出质心供前端做「光学居中」的加权补偿。"""
    x0, y0, x1, y1 = box
    S = 480
    im = Image.new('L', (S, S), 0)
    dr = ImageDraw.Draw(im)
    for poly in polys:
        pts = [((x - x0) * S / (x1 - x0), (y1 - y) * S / (y1 - y0)) for x, y in poly]
        dr.polygon(pts, fill=255)
    px = im.load()
    sx = sy = n = 0
    for y in range(S):
        for x in range(S):
            if px[x, y] > 127:
                sx += x; sy += y; n += 1
    if not n:
        return [(x0 + x1) / 2, (y0 + y1) / 2], 0
    # 换回字体坐标（y 向上）
    mx = x0 + (sx / n) * (x1 - x0) / S
    my = y1 - (sy / n) * (y1 - y0) / S
    return [mx, my], n / (S * S)


def main():
    f = instantiateVariableFont(TTFont(str(FONT)), {'wght': WEIGHT}, inplace=True)
    glyphs = f.getGlyphSet()
    glyph = glyphs[f.getBestCmap()[ord(CHAR)]]

    bp = BoundsPen(glyphs)
    glyph.draw(bp)
    x0, y0, x1, y1 = bp.bounds

    pen = SVGPathPen(glyphs)
    glyph.draw(pen)
    raw = pen.getCommands()
    # upem=1000，取整后误差 < 0.1 单位，30px 显示时不足 0.003px，但路径短一半以上
    d = re.sub(r'-?\d+\.\d+', lambda m: str(round(float(m.group()))), raw)
    d = d.replace(' -', '-')  # 省掉分隔符前面的空格
    box = [round(v, 2) for v in (x0, y0, x1, y1)]

    polys = flatten(d)
    centroid, coverage = ink_centroid(polys, box)
    # 纯 bbox 居中 + 35% 的墨迹质心补偿：既不让字框明显偏，也抵消左密右疏的视觉重量
    bbox_c = [(x0 + x1) / 2, (y0 + y1) / 2]
    optical = [round(bbox_c[i] + 0.35 * (centroid[i] - bbox_c[i]), 2) for i in (0, 1)]

    # 同一份字形再给图标生成器一份「归一化到 0..100 viewBox、y 向下」的多边形，
    # 保证界面 LOGO 与桌面 ICO 是同一个字、同一个光学中心。
    occupy = 0.56
    s = 100 * occupy / max(x1 - x0, y1 - y0)
    norm = [[
        [round(50 + (x - optical[0]) * s, 2), round(50 - (y - optical[1]) * s, 2)]
        for x, y in poly
    ] for poly in polys]

    out = {'char': CHAR, 'weight': WEIGHT, 'upem': f['head'].unitsPerEm,
           'box': box, 'opticalCenter': optical, 'centroid': [round(v, 2) for v in centroid],
           'occupy': occupy, 'd': d, 'polys': norm}
    (ROOT / 'tools' / 'brand-glyph.json').write_text(
        json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    ts = (
        '/* 由 tools/gen_brand_glyph.py 生成，请勿手工编辑。\n'
        '   Noto Sans SC wght=800（SIL OFL）「纸」字轮廓；坐标取整，字体坐标系 y 向上。 */\n'
        f'export const GLYPH_D = {json.dumps(d, ensure_ascii=False)};\n'
        f'export const GLYPH_BOX: [number, number, number, number] = {json.dumps(box)};\n'
        f'/** 光学中心：包围盒中心 + 35% 墨迹质心补偿，避免左密右疏看着偏。 */\n'
        f'export const GLYPH_CENTER: [number, number] = {json.dumps(optical)};\n'
        f'/** 字形墨迹占 viewBox 的比例；桌面图标共用，保证两处观感一致。 */\n'
        f'export const GLYPH_OCCUPY = {occupy};\n'
    )
    (ROOT / 'src' / 'brandGlyph.ts').write_text(ts, encoding='utf-8')
    print(f'字形「{CHAR}」bbox={box} 墨迹占比={coverage:.1%} 子路径={len(polys)}')
    print(f'bbox中心={[round(v,1) for v in bbox_c]} 质心={[round(v,1) for v in centroid]} 光学中心={optical}')
    print(f'path {len(raw)} -> {len(d)} 字符')
    print('已写出 tools/brand-glyph.json 与 src/brandGlyph.ts')


if __name__ == '__main__':
    main()
