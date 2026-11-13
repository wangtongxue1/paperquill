#!/usr/bin/env python3
"""2.5.6 三项改动的浏览器端回归探针：

  1) 插入日期时间后，光标落在时间戳之外的正文里（后面补空格），继续打字不会写进绿色块；
  2) 表格列宽可拖拽；插入时间戳 / 大图之后表格仍是固定布局、不越出设计宽度、不挤窄别的列；
  3) 「设置提醒」弹窗改用与笔记正文同一个 DateTimePop（停靠模式），不再有原生 datetime-local。

用法：python tools/make_singlefile.py .temp/zhijian-probe.html && python tools/v256-verify.py
"""

import pathlib, re, shutil, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / '.temp' / 'zhijian-probe.html'
OUT = ROOT / '.temp' / 'zhijian-v256-verify.html'
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
  const byText = (sel, text) => Array.from(document.querySelectorAll(sel))
    .find((e) => (e.textContent || '').includes(text));
  const rows = () => Array.from(document.querySelectorAll('.note-row, .note-card'));
  const mouse = (type, x, y, down = true) => new MouseEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y,
    button: 0, buttons: down ? 1 : 0, view: window,
  });

  try {
    await until(() => document.querySelector('.nav-row'));
    byText('.nav-row', '全部笔记')?.click();
    await until(() => rows().length);
    await wait(400);
    (rows().find((x) => (x.textContent || '').includes('双模式')) || rows()[0])?.click();
    await until(() => document.querySelector('.editor'));
    await wait(600);
    const pill = document.querySelector('.mode-pill');
    if (pill && pill.textContent.includes('源码')) { pill.click(); await wait(900); }
    push('rich', !!document.querySelector('.ProseMirror'));

    /* ---------- 1) 插入日期时间后的光标落点 ---------- */
    const timeBtn = () => document.querySelector('.toolbar button[title*="插入日期时间"]');
    const times = () => document.querySelectorAll('.ProseMirror time[data-time]');
    const n0 = times().length;
    timeBtn()?.click();
    await until(() => document.querySelector('.dtp'));
    push('timePopShown', !!document.querySelector('.dtp'));
    document.querySelector('.dtp__ok')?.click();
    await wait(500);
    // React 收起浮层后浏览器才把 DOM selection 落到正文里，等一下再读，别读竞态
    await until(() => window.getSelection()?.anchorNode, 2500);
    const t = times()[times().length - 1];
    push('timeInserted', times().length - n0);
    push('trailingSpace', t && t.nextSibling && t.nextSibling.nodeType === 3
      && /^\s/.test(t.nextSibling.textContent || ''));
    const sel = window.getSelection();
    push('caretOutsideTime', !!sel.anchorNode && !(t && t.contains(sel.anchorNode)));
    push('caretInText', !!sel.anchorNode && sel.anchorNode.nodeType === 3);
    // 真打一个字：不能落进 <time> 里（旧版光标贴在原子节点内边缘会这样）
    if (t && sel.anchorNode) {
      document.execCommand('insertText', false, 'Z');
      await wait(350);
      push('typedOutsideTime', !/Z/.test(t.textContent || ''));
      push('typedIntoDoc', /Z/.test(document.querySelector('.ProseMirror').textContent || ''));
    }

    /* ---------- 2) 表格：列宽拖拽 + 内容不挤压 ---------- */
    const tableBtn = document.querySelector('.toolbar button[title="表格"]');
    tableBtn?.click();
    await wait(180);
    byText('.menu .menu__item', '插入 3')?.click();
    const table = await until(() => document.querySelector('.ProseMirror table'), 6000);
    push('tableInserted', !!table);
    const wrapper = table?.closest('.tableWrapper') || table?.parentElement;
    push('hasWrapper', !!table?.closest('.tableWrapper'));
    push('colCount', table ? table.querySelectorAll('colgroup col').length : 0);
    push('tableLayout', table ? getComputedStyle(table).tableLayout : 'none');
    const wBefore = table ? table.getBoundingClientRect().width : 0;
    const wrapW = wrapper ? wrapper.getBoundingClientRect().width : 0;
    push('widthBefore', Math.round(wBefore));
    push('wrapperW', Math.round(wrapW));
    push('fitsDesign', wBefore <= wrapW + 2);
    // 列宽等分（旧版会被 nowrap 时间戳 / 大图挤成一条缝）
    const cells = table ? Array.from(table.querySelectorAll('tr')[0].children) : [];
    push('minCellW', cells.length ? Math.round(Math.min(...cells.map((c) => c.getBoundingClientRect().width))) : 0);

    // 拖拽第一列右边界：mousemove 亮手柄 → mousedown → window mousemove → mouseup
    const first = cells[0];
    if (first) {
      const r = first.getBoundingClientRect();
      const cx = r.right - 2, cy = r.top + Math.min(10, r.height / 2);
      first.dispatchEvent(mouse('mousemove', cx, cy));
      await wait(160);
      push('resizeHandle', !!document.querySelector('.ProseMirror .column-resize-handle'));
      first.dispatchEvent(mouse('mousedown', cx, cy));
      window.dispatchEvent(mouse('mousemove', cx + 70, cy));
      window.dispatchEvent(mouse('mouseup', cx + 70, cy, false));
      await wait(300);
      const col0 = table.querySelector('colgroup col');
      push('colWidthAfterDrag', col0 ? (col0.style.width || 'none') : 'none');
      push('resized', !!(col0 && /\d+px/.test(col0.style.width)));
    }

    // 往第一格里塞「时间戳 + 超宽 SVG 图片」，表格宽度不许变
    if (first) {
      const r2 = first.getBoundingClientRect();
      first.dispatchEvent(mouse('mousedown', r2.left + 18, r2.top + 12));
      first.dispatchEvent(mouse('mouseup', r2.left + 18, r2.top + 12, false));
      await wait(150);
      timeBtn()?.click();
      await until(() => document.querySelector('.dtp'));
      document.querySelector('.dtp__ok')?.click();
      await wait(400);
      // 1200px 宽的 SVG：旧版 table-layout:auto 会把它当最小内容宽度撑爆表格
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="280"><rect width="1200" height="280" fill="#13C2C2"/></svg>';
      const file = new File([svg], 'wide.svg', { type: 'image/svg+xml' });
      const dt = new DataTransfer(); dt.items.add(file);
      const picker = Array.from(document.querySelectorAll('input[type=file]'))
        .find((i) => /image/i.test(i.accept || '')) || document.querySelector('input[type=file]');
      picker.files = dt.files;
      picker.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(900);
      const wAfter = table.getBoundingClientRect().width;
      push('widthAfter', Math.round(wAfter));
      push('notGrown', wAfter <= wrapW + 2);
      push('imageInCell', !!table.querySelector('img'));
      push('imageCapped', (() => {
        const im = table.querySelector('img');
        return !!im && im.getBoundingClientRect().width <= first.getBoundingClientRect().width + 2;
      })());
      const cells2 = Array.from(table.querySelectorAll('tr')[0].children);
      push('minCellWAfter', Math.round(Math.min(...cells2.map((c) => c.getBoundingClientRect().width))));
    }

    /* ---------- 3) 提醒弹窗：统一成同一个日期时间选择器 ---------- */
    document.querySelector('.editor__headacts button[title="提醒"]')?.click();
    await until(() => byText('.modal h2', '设置提醒'));
    const modal = document.querySelector('.modal');
    push('reminderDialog', !!modal);
    push('noNativeInput', !document.querySelector('.modal input[type="datetime-local"]'));
    push('dockedPicker', !!document.querySelector('.modal .dtp--docked'));
    push('dockedDays', document.querySelectorAll('.modal .dtp__grid .dtp__day:not(.is-blank)').length);
    push('dockedTimeInputs', document.querySelectorAll('.modal .dtp__num').length);
    push('noInnerFooter', !document.querySelector('.modal .dtp__foot'));
    const dp = document.querySelector('.modal .dtp--docked');
    if (modal && dp) {
      const mr = modal.getBoundingClientRect(), dr = dp.getBoundingClientRect();
      push('pickerInsideModal', dr.left >= mr.left - 1 && dr.right <= mr.right + 1
        && dr.bottom <= mr.bottom + 1);
      push('pickerPosition', getComputedStyle(dp).position);
    }
    const field = () => (document.querySelector('.dtp-field__value')?.textContent || '').trim();
    const v0 = field();
    push('fieldValue', v0);
    // 点一个不同的日期 → 字段实时更新
    const days = Array.from(document.querySelectorAll('.modal .dtp__grid .dtp__day:not(.is-blank)'));
    const target = days.find((d) => d.textContent.trim() !== v0.slice(8, 10).replace(/^0/, '')) || days[10];
    target?.click();
    await wait(250);
    push('dayPickedSync', field() !== v0 && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(field()));
    // 快捷按钮也要把日历回灌同步
    byText('.preset-row button', '1 小时后')?.click();
    await wait(250);
    push('presetSync', /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(field()));
    const onDay = document.querySelector('.modal .dtp__day.is-on')?.textContent.trim();
    push('calendarFollowsPreset', !!onDay && field().slice(8, 10).replace(/^0/, '') === onDay);
    // 收起 / 展开
    document.querySelector('.modal .dtp__x')?.click();
    await wait(150);
    push('pickerCollapsed', !document.querySelector('.modal .dtp--docked'));
    document.querySelector('.dtp-field')?.click();
    await wait(150);
    push('pickerReopened', !!document.querySelector('.modal .dtp--docked'));
    // Esc 只收起选择器，不该把整个弹窗关掉
    document.querySelector('.modal .dtp--docked')?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true,
    }));
    await wait(180);
    push('escKeepsDialog', !!document.querySelector('.modal'));
    // 保存后编辑区出现提醒标记
    byText('.modal__foot button', '保存提醒')?.click();
    await wait(400);
    push('reminderSaved', !!document.querySelector('.editor__reminder'));

    push('done', 1);
  } catch (err) {
    push('error', (err && err.stack) || String(err));
  }
  const pre = document.createElement('pre');
  pre.id = 'probe'; pre.textContent = log.join('\n');
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
    OUT.write_text(html[:i] + PROBE + html[i:], encoding='utf-8')

    profile = pathlib.Path(tempfile.mkdtemp(prefix='zj-v256-'))
    args = [EDGE, '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1440,960',
            '--allow-file-access-from-files', f'--user-data-dir={profile}',
            '--virtual-time-budget=90000', '--dump-dom', OUT.as_uri()]
    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         text=True, encoding='utf-8', errors='replace')
    try:
        dom, _ = p.communicate(timeout=200)
    except subprocess.TimeoutExpired:
        p.kill(); dom, _ = p.communicate()
    m = re.search(r'<pre id="probe">(.*?)</pre>', dom or '', re.S)
    if not m:
        print('探针没有输出，DOM 前 600 字符：\n' + (dom or '')[:600], file=sys.stderr)
        return 2
    text = m.group(1).replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    print(text)
    kv = dict(line.split('=', 1) for line in text.split('\n') if '=' in line)

    EXPECT_TRUE = [
        'rich', 'timePopShown', 'trailingSpace', 'caretOutsideTime', 'caretInText',
        'typedOutsideTime', 'typedIntoDoc', 'tableInserted', 'hasWrapper',
        'fitsDesign', 'resizeHandle', 'resized', 'notGrown', 'imageInCell', 'imageCapped',
        'reminderDialog', 'noNativeInput', 'dockedPicker', 'noInnerFooter',
        'pickerInsideModal', 'dayPickedSync', 'presetSync', 'calendarFollowsPreset',
        'pickerCollapsed', 'pickerReopened', 'escKeepsDialog', 'reminderSaved',
    ]
    EXPECT_NUM = {'timeInserted': '1', 'colCount': '3', 'dockedTimeInputs': '2'}
    fails = []
    for k in EXPECT_TRUE:
        if kv.get(k) != 'true':
            fails.append(f'{k}={kv.get(k)}（期望 true）')
    for k, v in EXPECT_NUM.items():
        if kv.get(k) != v:
            fails.append(f'{k}={kv.get(k)}（期望 {v}）')
    if kv.get('tableLayout') != 'fixed':
        fails.append(f"tableLayout={kv.get('tableLayout')}（应为 fixed）")
    if kv.get('pickerPosition') != 'static':
        fails.append(f"pickerPosition={kv.get('pickerPosition')}（停靠模式应为 static）")
    if int(kv.get('dockedDays') or 0) < 28:
        fails.append(f"dockedDays={kv.get('dockedDays')}（日历格子不对）")
    if int(kv.get('minCellWAfter') or 0) < 30:
        fails.append(f"minCellWAfter={kv.get('minCellWAfter')}（插入内容后有列被挤窄）")
    if int(kv.get('minCellW') or 0) < 30:
        fails.append(f"minCellW={kv.get('minCellW')}（初始列宽不均）")
    if kv.get('error'):
        fails.append('error=' + kv.get('error'))

    shutil.rmtree(profile, ignore_errors=True)
    if fails:
        print('\n失败：' + ', '.join(fails), file=sys.stderr)
        return 3
    print('\n全部通过：时间戳后光标落点 + 表格列宽拖拽与自适应 + 提醒弹窗统一日期时间选择器')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
