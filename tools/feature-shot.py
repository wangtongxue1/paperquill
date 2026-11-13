#!/usr/bin/env python3
"""为画板手感改动生成实机截图：

  board  —— 画板里画一个矩形（工具保持矩形），再切选择工具选中它，
           状态栏提示「从空白拖出下一个（同形状+连线）」（2.5.1 起由点击生成改为拖出生成）。
  about  —— 关于页，标题已是「纸间笔记」。

用法：python tools/feature-shot.py <board|about> <输出png> [light|dark]
前置：python tools/make_singlefile.py .temp/zhijian-probe.html
"""

import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / '.temp' / 'zhijian-probe.html'
SCENARIO = sys.argv[1] if len(sys.argv) > 1 else 'board'
OUT = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else (
    ROOT.parent / 'output' / 'zhijian' / '画板-接龙提示.png')
THEME = sys.argv[3] if len(sys.argv) > 3 else 'light'
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

BOARD = r"""
<script>
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const byText = (sel, t) => Array.from(document.querySelectorAll(sel)).find((e) => (e.textContent || '').includes(t));
  await wait(250);
  byText('.nav-row', '全部笔记')?.click();
  await wait(350);
  const rows = Array.from(document.querySelectorAll('.note-row, .note-card'));
  (rows.find((r) => (r.textContent || '').includes('双模式')) || rows[0])?.click();
  await wait(400);
  const pill = document.querySelector('.mode-pill');
  if (pill && pill.textContent.includes('源码')) { pill.click(); await wait(500); }
  // 打开画板
  Array.from(document.querySelectorAll('.toolbar .icon-btn')).find((b) => (b.title || '').includes('画板'))?.click();
  await wait(700);
  const svg = document.querySelector('.board__svg');
  if (svg) {
    const rect = svg.getBoundingClientRect();
    const pe = (t, x, y) => svg.dispatchEvent(new PointerEvent(t, {
      bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 1 }));
    const toolBtn = (p) => Array.from(document.querySelectorAll('.board__tools button'))
      .find((b) => (b.title || '').startsWith(p) && b.getAttribute('data-tool'));
    toolBtn('矩形')?.click(); await wait(150);
    pe('pointerdown', rect.left + 220, rect.top + 200);
    pe('pointermove', rect.left + 380, rect.top + 290);
    pe('pointerup', rect.left + 380, rect.top + 290);
    await wait(300);
    // 切回选择工具并选中刚画的矩形，让状态栏提示「从空白拖出下一个」显示出来
    toolBtn('选择')?.click(); await wait(150);
    const cx = rect.left + 300, cy = rect.top + 245;
    const hit = document.elementFromPoint(cx, cy) || svg;
    hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1, button: 0, buttons: 1 }));
    svg.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1, button: 0, buttons: 1 }));
    await wait(300);
  }
  if ('__THEME__' === 'dark') { document.documentElement.setAttribute('data-theme', 'dark'); await wait(150); }
  await wait(300);
})();
</script>
"""

ABOUT = r"""
<script>
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const byText = (sel, t) => Array.from(document.querySelectorAll(sel)).find((e) => (e.textContent || '').includes(t));
  await wait(250);
  byText('.nav-row', '全部笔记')?.click();
  await wait(350);
  const rows = Array.from(document.querySelectorAll('.note-row, .note-card'));
  (rows.find((r) => (r.textContent || '').includes('双模式')) || rows[0])?.click();
  await wait(400);
  document.querySelector('.icon-btn[title="关于与快捷键"]')?.click();
  await wait(600);
  if ('__THEME__' === 'dark') { document.documentElement.setAttribute('data-theme', 'dark'); await wait(150); }
  await wait(250);
})();
</script>
"""

SCRIPT = BOARD if SCENARIO == 'board' else ABOUT


def main() -> int:
    if not SRC.exists():
        print(f'缺少 {SRC}', file=sys.stderr)
        return 1
    html = SRC.read_text(encoding='utf-8')
    i = html.rfind('</body>')
    demo = ROOT / '.temp' / 'zhijian-feature.html'
    demo.write_text(html[:i] + SCRIPT.replace('__THEME__', THEME) + html[i:], encoding='utf-8')

    OUT.parent.mkdir(parents=True, exist_ok=True)
    profile = pathlib.Path(tempfile.gettempdir()) / 'zhijian-edge-feat'
    res = subprocess.run([
        EDGE, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--allow-file-access-from-files', f'--user-data-dir={profile}',
        '--window-size=1360,900', '--virtual-time-budget=8000',
        f'--screenshot={OUT}', demo.as_uri(),
    ], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if not OUT.exists():
        print('截图失败：\n' + (res.stderr or '')[:800], file=sys.stderr)
        return 2
    print(f'已生成 {OUT}（{OUT.stat().st_size:,} 字节）')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
