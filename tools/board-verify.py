#!/usr/bin/env python3
"""针对性验证画板的三处手感：

  1) 画完一个形状后工具不弹回指针（保持当前形状工具）；
  2) 形状工具下「只点不拖」不应生成任何形状（修正：旧版点一下就落一个默认大小的形状）；
  3) 选中一个形状后「拖出」下一个：从空白拖动画出大小，松手长出同样的形状并连一条线；
     而只点不拖不应生成任何形状。

用法：python tools/board-verify.py
前置：python tools/make_singlefile.py .temp/zhijian-probe.html
"""

import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / '.temp' / 'zhijian-probe.html'
OUT = ROOT / '.temp' / 'zhijian-board-verify.html'
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

PROBE = r"""
<script>
(async () => {
  const log = [];
  const push = (k, v) => log.push(`${k}=${v}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(60); }
    return null;
  };
  const byText = (sel, text) =>
    Array.from(document.querySelectorAll(sel)).find((e) => (e.textContent || '').includes(text));
  const rows = () => Array.from(document.querySelectorAll('.note-row, .note-card'));
  const open = async (title) => {
    const r = rows().find((x) => (x.textContent || '').includes(title)) || rows()[0];
    r?.click(); await wait(600);
  };
  const toRich = async () => {
    const pill = document.querySelector('.mode-pill');
    if (pill && pill.textContent.includes('源码')) { pill.click(); await wait(900); }
  };

  try {
    await until(() => document.querySelector('.nav-row'));
    byText('.nav-row', '全部笔记')?.click();
    await until(() => document.querySelector('.note-row, .note-card'));
    await open('双模式');
    push('editor', !!document.querySelector('.editor__title'));
    await toRich();

    Array.from(document.querySelectorAll('.toolbar .icon-btn'))
      .find((b) => (b.title || '').includes('画板'))?.click();
    await wait(700);
    push('boardOpen', !!document.querySelector('.board'));

    if (document.querySelector('.board')) {
      const toolBtn = (prefix) => Array.from(document.querySelectorAll('.board__tools button'))
        .find((b) => (b.title || '').startsWith(prefix) && b.getAttribute('data-tool'));
      const svg = document.querySelector('.board__svg');
      const rect = svg.getBoundingClientRect();
      const pe = (type, x, y) => svg.dispatchEvent(new PointerEvent(type, {
        bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons: 1,
      }));
      const peOn = (cx, cy, type = 'pointerdown') => {
        const el = document.elementFromPoint(rect.left + cx, rect.top + cy) || svg;
        el.dispatchEvent(new PointerEvent(type, {
          bubbles: true, clientX: rect.left + cx, clientY: rect.top + cy,
          pointerId: 1, button: 0, buttons: 1,
        }));
      };
      const activeTool = () => {
        const a = document.querySelector('.board__tools button.is-active');
        return a ? a.title : '';
      };
      // 形状组 = 带 data-el 但不是连线的组（连线也是 g[data-el]，但里面是 path[marker-end]）
      const shapeGroups = () =>
        Array.from(document.querySelectorAll('.board__svg g[data-el]'))
          .filter((g) => !g.querySelector('path[marker-end]'));

      // ---------- 1) 画完形状后工具保持 ----------
      toolBtn('矩形')?.click();
      await wait(150);
      push('toolBeforeDraw', activeTool());
      pe('pointerdown', rect.left + 200, rect.top + 160);
      pe('pointermove', rect.left + 340, rect.top + 240);
      pe('pointerup', rect.left + 340, rect.top + 240);
      await wait(250);
      push('shapesAfterDraw', document.querySelectorAll('.board__svg g[data-el]').length);
      push('toolAfterDraw', activeTool());                       // 期望仍以「矩形」开头

      // 再画一个，确认连续画同类型
      pe('pointerdown', rect.left + 480, rect.top + 320);
      pe('pointermove', rect.left + 620, rect.top + 400);
      pe('pointerup', rect.left + 620, rect.top + 400);
      await wait(250);
      push('shapesTwoDraws', document.querySelectorAll('.board__svg g[data-el]').length);
      push('toolTwoDraws', activeTool());

      // 1b) 形状工具下「只点不拖」不应生成形状（本次修正的核心）
      const beforeClick = document.querySelectorAll('.board__svg g[data-el]').length;
      pe('pointerdown', rect.left + 840, rect.top + 160);
      pe('pointerup', rect.left + 840, rect.top + 160);
      await wait(200);
      push('rectClickShapes', document.querySelectorAll('.board__svg g[data-el]').length - beforeClick);  // 期望 0

      // ---------- 2) 选中形状后「拖出」下一个（同形状+连线） ----------
      toolBtn('选择')?.click();
      await wait(150);
      // 点中第一个矩形（中心约 270,200）
      peOn(270, 200);
      pe('pointerup', rect.left + 270, rect.top + 200);
      await wait(200);
      push('selTip', document.querySelector('.board__palettetip')?.textContent || '');

      // 2a) 拖出下一个：从空白按下并拖出大小，松手应长出 1 形状 + 1 连线
      const beforeShapes = shapeGroups().length;
      const beforeArrows = document.querySelectorAll('.board__svg path[marker-end]').length;
      pe('pointerdown', rect.left + 200, rect.top + 520);
      pe('pointermove', rect.left + 360, rect.top + 640);
      pe('pointerup', rect.left + 360, rect.top + 640);
      await wait(300);
      push('branchShapes', shapeGroups().length - beforeShapes);          // 期望 1
      push('branchArrows', document.querySelectorAll('.board__svg path[marker-end]').length - beforeArrows);  // 期望 1

      // 2b) 只点不拖：选中状态下点空白不应生成任何形状 / 连线（2.6.0 修正）
      const clickShapes = shapeGroups().length;
      const clickArrows = document.querySelectorAll('.board__svg path[marker-end]').length;
      pe('pointerdown', rect.left + 760, rect.top + 700);
      pe('pointerup', rect.left + 760, rect.top + 700);
      await wait(300);
      push('clickShapes', shapeGroups().length - clickShapes);                       // 期望 0
      push('clickArrows', document.querySelectorAll('.board__svg path[marker-end]').length - clickArrows);  // 期望 0

      // ---------- 3) 右击形状弹出菜单并删除 ----------
      const ctxShapesBefore = shapeGroups().length;
      const ctxEl = document.elementFromPoint(rect.left + 270, rect.top + 200);
      ctxEl?.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: rect.left + 270, clientY: rect.top + 200,
        button: 2, buttons: 2,
      }));
      await wait(280);
      push('ctxMenuShown', !!document.querySelector('.board__ctxmenu'));
      push('ctxDelLabel', document.querySelector('.board__ctxitem--danger')?.textContent?.trim() || '');
      const ctxDel = document.querySelector('.board__ctxitem--danger');
      ctxDel?.click();
      await wait(320);
      push('ctxShapesAfter', shapeGroups().length - ctxShapesBefore);   // 期望 -1
      push('ctxMenuClosed', !document.querySelector('.board__ctxmenu')); // 期望 true
    }

    push('done', 1);
  } catch (e) {
    push('error', String((e && e.message) || e));
  }

  const pre = document.createElement('pre');
  pre.id = 'probe';
  pre.textContent = log.join(' · ');
  document.body.appendChild(pre);
})();
</script>
"""


def main() -> int:
    if not SRC.exists():
        print(f'缺少 {SRC}，先运行 make_singlefile.py', file=sys.stderr)
        return 1
    html = SRC.read_text(encoding='utf-8')
    i = html.rfind('</body>')
    if i < 0:
        print('找不到 </body>', file=sys.stderr)
        return 1
    html = html[:i] + PROBE + html[i:]
    OUT.write_text(html, encoding='utf-8')

    profile = pathlib.Path(tempfile.mkdtemp(prefix='zj-board-'))
    args = [
        EDGE, '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1360,900',
        '--allow-file-access-from-files', f'--user-data-dir={profile}',
        '--virtual-time-budget=60000', '--dump-dom', OUT.as_uri(),
    ]
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding='utf-8', errors='replace')
    try:
        dom, _ = proc.communicate(timeout=180)
    except subprocess.TimeoutExpired:
        proc.kill()
        dom, _ = proc.communicate()
    dom = dom or ''
    m = re.search(r'<pre id="probe">(.*?)</pre>', dom, re.S)
    if not m:
        print('探针没有输出，DOM 前 600 字符：\n' + dom[:600], file=sys.stderr)
        return 2
    text = m.group(1).replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    print(text)
    kv = dict(kv.split('=', 1) for kv in text.split(' · ') if '=' in kv)

    fails = []
    if not kv.get('toolAfterDraw', '').startswith('矩形'):
        fails.append(f"toolAfterDraw={kv.get('toolAfterDraw')}（画完形状后工具没保持矩形）")
    if not kv.get('toolTwoDraws', '').startswith('矩形'):
        fails.append(f"toolTwoDraws={kv.get('toolTwoDraws')}（连画第二个也没保持）")
    if kv.get('branchShapes') != '1':
        fails.append(f"branchShapes={kv.get('branchShapes')}（拖出应长出 1 个形状）")
    if kv.get('branchArrows') != '1':
        fails.append(f"branchArrows={kv.get('branchArrows')}（拖出应多出 1 条连线）")
    if kv.get('clickShapes') != '0':
        fails.append(f"clickShapes={kv.get('clickShapes')}（只点不拖不应生成形状）")
    if kv.get('clickArrows') != '0':
        fails.append(f"clickArrows={kv.get('clickArrows')}（只点不拖不应生成连线）")
    if kv.get('rectClickShapes') != '0':
        fails.append(f"rectClickShapes={kv.get('rectClickShapes')}（矩形工具点一下不应生成形状）")
    if not kv.get('ctxMenuShown'):
        fails.append('ctxMenuShown 未弹出右键菜单')
    if kv.get('ctxShapesAfter') != '-1':
        fails.append(f"ctxShapesAfter={kv.get('ctxShapesAfter')}（右击删除应少 1 个形状）")
    if not kv.get('ctxMenuClosed'):
        fails.append('ctxMenuClosed 删除后菜单未收起')
    if kv.get('error'):
        fails.append('error=' + kv.get('error'))

    shutil.rmtree(profile, ignore_errors=True)
    if fails:
        print('\n失败：' + ', '.join(fails), file=sys.stderr)
        return 3
    print('\n全部通过：画完形状保持工具 + 选中拖出生成形状与连线 + 只点不拖不生成 + 右击删除')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
