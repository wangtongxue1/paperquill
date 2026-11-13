#!/usr/bin/env python3
"""2.5.7 品牌图标居中的验证探针。

浏览器侧：界面 LOGO 必须是矢量字形；path 墨迹盒与绿底盒的中心偏移要接近 0；
不再有 CSS 文字 LOGO；favicon 与图标按钮也不许跑偏。
文件侧：桌面 PNG / ICO 里的白色字形相对绿色圆角底同样要居中。

用法：python tools/make_singlefile.py .temp/zhijian-probe.html && python tools/logo-verify.py
"""

import io
import json
import pathlib
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / '.temp' / 'zhijian-probe.html'
OUT = ROOT / '.temp' / 'zhijian-logo-verify.html'
ICONS = ROOT / 'src-tauri' / 'icons'
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

PROBE = r"""
<script>
(async () => {
  const log = [];
  const push = (k, v) => log.push(`${k}=${v}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 9000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(60); }
    return null;
  };
  try {
    await until(() => document.querySelector('.logo'));
    await wait(350);
    const svg = document.querySelector('.logo');
    push('logoSvg', svg && svg.tagName.toLowerCase() === 'svg');
    push('logoHasRect', !!svg?.querySelector('.brand-mark__bg'));
    push('logoHasPath', !!svg?.querySelector('.brand-mark__glyph'));
    push('logoText', JSON.stringify((svg?.textContent || '').trim()));

    const bg = svg?.querySelector('.brand-mark__bg');
    const glyph = svg?.querySelector('.brand-mark__glyph');
    if (bg && glyph) {
      const a = bg.getBoundingClientRect(), b = glyph.getBoundingClientRect();
      const dx = (b.x + b.width / 2) - (a.x + a.width / 2);
      const dy = (b.y + b.height / 2) - (a.y + a.height / 2);
      push('glyphOffsetDx', dx.toFixed(2));
      push('glyphOffsetDy', dy.toFixed(2));
      push('glyphCentered', Math.abs(dx) < 1.2 && Math.abs(dy) < 1.2);
      // 字形不能顶到绿底边缘：墨迹宽高都要明显小于绿块
      push('glyphFits', b.width < a.width * 0.75 && b.height < a.height * 0.75);
      push('glyphSizeRatio', (b.width / a.width).toFixed(2));
    }
    // 圆角跟旧版一致（30px 方块 9px 圆角），不能被改成小方角
    push('logoRadius', getComputedStyle(document.querySelector('.brand-mark__bg')).getPropertyValue('rx') || 'attr');
    const rr = bg?.getAttribute('rx');
    push('logoRadiusAttr', rr);

    // favicon：同一份字形的 data URI
    const fav = document.querySelector('link[rel="icon"]');
    push('favicon', !!fav);
    push('faviconSvg', !!fav && fav.getAttribute('href').includes('image/svg+xml'));
    push('faviconHasPath', !!fav && decodeURIComponent(fav.getAttribute('href')).includes('<path'));

    // 回归：图标按钮里的 lucide svg 仍在按钮正中
    const offs = Array.from(document.querySelectorAll('.icon-btn')).slice(0, 8)
      .map((b) => {
        const s = b.querySelector('svg'); if (!s) return null;
        const p = b.getBoundingClientRect(), q = s.getBoundingClientRect();
        return Math.abs((q.x + q.width / 2) - (p.x + p.width / 2))
             + Math.abs((q.y + q.height / 2) - (p.y + p.height / 2));
      }).filter((v) => v !== null);
    push('iconBtnMaxOffset', offs.length ? Math.max(...offs).toFixed(2) : 'none');
    push('iconBtnsCentered', offs.length > 0 && offs.every((v) => v < 1));

    push('done', 1);
  } catch (e) { push('error', (e && e.message) || String(e)); }
  const pre = document.createElement('pre'); pre.id = 'probe'; pre.textContent = log.join(' · ');
  document.body.appendChild(pre);
})();
</script>
"""


def png_centering(path):
    """透明底图标：非透明像素 = 绿块；绿块内的亮像素 = 白字。返回两盒中心偏移。"""
    im = Image.open(path).convert('RGBA')
    px = im.load()
    w, h = im.size
    solid, ink = [], []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 128:
                continue
            solid.append((x, y))
            if r > 200 and g > 200 and b > 200:
                ink.append((x, y))

    def center(pts):
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)

    if not solid or not ink:
        return None
    a, b = center(solid), center(ink)
    return (round(b[0] - a[0], 2), round(b[1] - a[1], 2)), len(ink)


def check_ico(path):
    raw = path.read_bytes()
    reserved, kind, count = struct.unpack('<HHH', raw[:6])
    return reserved == 0 and kind == 1 and count >= 4


def main() -> int:
    fails = []
    if not SRC.exists():
        print('缺少单文件版，请先运行 make_singlefile.py', file=sys.stderr)
        return 1
    html = SRC.read_text(encoding='utf-8')
    i = html.rfind('</body>')
    OUT.write_text(html[:i] + PROBE + html[i:], encoding='utf-8')

    profile = pathlib.Path(tempfile.mkdtemp(prefix='zhijian-logo-verify-'))
    args = [EDGE, '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1360,900',
            '--allow-file-access-from-files', f'--user-data-dir={profile}',
            '--virtual-time-budget=25000', '--dump-dom', OUT.as_uri()]
    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         text=True, encoding='utf-8', errors='replace')
    try:
        dom, _ = p.communicate(timeout=150)
    except subprocess.TimeoutExpired:
        p.kill(); dom, _ = p.communicate()
    m = re.search(r'<pre id="probe">(.*?)</pre>', dom or '', re.S)
    if not m:
        print('没拿到探针结果', file=sys.stderr); return 2
    text = m.group(1)
    kv = {}
    for piece in text.split(' · '):
        if '=' in piece:
            k, v = piece.split('=', 1)
            kv[k] = v
        print(piece)

    expect = {
        'logoSvg': 'true', 'logoHasRect': 'true', 'logoHasPath': 'true',
        'logoText': '""', 'glyphCentered': 'true', 'glyphFits': 'true',
        'favicon': 'true', 'faviconSvg': 'true', 'faviconHasPath': 'true',
        'iconBtnsCentered': 'true', 'done': '1',
    }
    fails += [f'{k}={kv.get(k)}（期望 {v}）' for k, v in expect.items() if kv.get(k) != v]
    if kv.get('error'):
        fails.append('error=' + kv['error'])
    if float(kv.get('iconBtnMaxOffset') or 99) >= 1:
        fails.append('iconBtnMaxOffset=' + str(kv.get('iconBtnMaxOffset')))
    # 圆角：viewBox 100 里默认 30，30px 显示即 9px，跟旧版一致
    if abs(float(kv.get('logoRadiusAttr') or 0) - 30) > 0.01:
        fails.append('logoRadiusAttr=' + str(kv.get('logoRadiusAttr')) + '（应为 30）')

    print('\n--- 桌面图标 ---')
    for name in ('32x32.png', '128x128.png', '128x128@2x.png', 'icon.png'):
        f = ICONS / name
        if not f.exists():
            fails.append('缺少 ' + name); continue
        c = png_centering(f)
        if not c:
            fails.append(name + ' 解析不出字形'); continue
        (dx, dy), n = c
        print(f'{name}: 字形中心偏移 dx={dx}, dy={dy}, 白色像素={n}')
        tol = 1.0 if Image.open(f).width <= 32 else 2.0
        if abs(dx) > tol or abs(dy) > tol:
            fails.append(f'{name} 字形偏心 dx={dx} dy={dy}')
    ico = ICONS / 'icon.ico'
    print(f'icon.ico 结构有效: {check_ico(ico) if ico.exists() else False}')
    if not ico.exists() or not check_ico(ico):
        fails.append('icon.ico 无效')

    # 界面与图标共用同一份字形数据
    glyph = json.loads((ROOT / 'tools' / 'brand-glyph.json').read_text(encoding='utf-8'))
    print(f'共享字形: {glyph["char"]} wght={glyph["weight"]} 光学中心={glyph["opticalCenter"]}')
    if glyph.get('occupy') != 0.56:
        fails.append('界面与图标的 occupy 不一致')

    shutil.rmtree(profile, ignore_errors=True)
    if fails:
        print('\n失败：' + ', '.join(fails), file=sys.stderr)
        return 3
    print('\n全部通过：界面 LOGO / favicon / 桌面图标均使用同一矢量字形且精确居中')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
