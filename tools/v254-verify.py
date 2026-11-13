#!/usr/bin/env python3
"""2.5.4 四项改动的浏览器端回归探针：

  1) 首页布局自定义：编辑条、勾选显隐、↑↓ 排序、恢复默认、关闭；
  2) 插入日期时间：弹层锚定工具栏按钮下方，不再飘到编辑区中央；
  3) 删正文图片后「立刻」切笔记：孤儿附件仍被回收（旧版会漏）；
  4) 正文插图默认不再被提升为笔记列表缩略图（LOGO 位）。

用法：python tools/v254-verify.py
前置：pnpm build && python tools/make_singlefile.py .temp/zhijian-probe.html
"""

import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / '.temp' / 'zhijian-probe.html'
OUT = ROOT / '.temp' / 'zhijian-v254-verify.html'
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

PROBE = r"""
<script>
(async () => {
  const log = [];
  const push = (k, v) => log.push(`${k}=${v}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await wait(60); }
    return null;
  };
  const byText = (sel, text) =>
    Array.from(document.querySelectorAll(sel)).find((e) => (e.textContent || '').includes(text));
  const rows = () => Array.from(document.querySelectorAll('.note-row, .note-card'));
  const disp = (el) => el ? getComputedStyle(el).display : 'missing';
  const card = (cls) => document.querySelector('.home__grid .home-card--' + cls);
  const visibleCards = () => Array.from(document.querySelectorAll('.home__grid .home-card'))
    .filter((e) => disp(e) !== 'none').length;
  const gotoHome = async () => {
    byText('.nav-row', '首页')?.click();
    await until(() => document.querySelector('.home__grid'));
    await wait(320);
  };

  try {
    await until(() => document.querySelector('.nav-row'));

    /* ---------- 1) 首页布局自定义 ---------- */
    await gotoHome();
    push('homeVisibleDefault', visibleCards());
    push('statsDefault', disp(document.querySelector('.home__stats')) !== 'none');
    push('recentDefault', disp(card('recent')) !== 'none');
    const editBtn = byText('.fullview__acts button', '自定义布局');
    push('editBtn', !!editBtn);
    editBtn?.click();
    await until(() => document.querySelector('.home-layout'));
    push('layoutItems', document.querySelectorAll('.home-layout__item').length);

    const item = (text) => Array.from(document.querySelectorAll('.home-layout__item'))
      .find((x) => (x.textContent || '').includes(text));
    const cb = item('最近笔记')?.querySelector('input[type=checkbox]');
    cb?.click(); await wait(320);
    push('recentHidden', disp(card('recent')) === 'none');
    push('visibleAfterHide', visibleCards());
    cb?.click(); await wait(280);
    push('recentRestored', disp(card('recent')) !== 'none');

    const orderBefore = Number(card('tasks')?.style.order || -1);
    item('待办')?.querySelector('.home-layout__move button[title="上移"]')?.click();
    await wait(320);
    const orderAfter = Number(card('tasks')?.style.order || -1);
    push('orderBefore', orderBefore);
    push('orderAfter', orderAfter);
    push('orderMoved', orderBefore > 0 && orderAfter === orderBefore - 1);

    byText('.home-layout__acts button', '恢复默认')?.click();
    await wait(320);
    push('resetOrder', Number(card('tasks')?.style.order || -1) === 4);
    push('resetAllVisible', visibleCards() === 6);
    byText('.home-layout__acts button', '完成')?.click();
    await wait(220);
    push('layoutClosed', !document.querySelector('.home-layout'));

    /* ---------- 4) 正文插图默认不占列表 LOGO 位 ---------- */
    byText('.nav-row', '全部笔记')?.click();
    await until(() => document.querySelector('.note-row, .note-card'));
    await wait(320);
    push('thumbsDefault', document.querySelectorAll('.note-row__thumb').length);

    /* ---------- 2) 日期时间弹层锚定按钮 ---------- */
    const r0 = rows().find((x) => (x.textContent || '').includes('双模式')) || rows()[0];
    r0?.click(); await wait(750);
    const pill = document.querySelector('.mode-pill');
    if (pill && pill.textContent.includes('源码')) { pill.click(); await wait(950); }
    push('rich', !!document.querySelector('.ProseMirror'));
    const dtpBtn = document.querySelector('.toolbar button[title*="插入日期时间"]');
    push('dtpBtn', !!dtpBtn);
    const shell = document.querySelector('.rich-shell');
    const btnRect = dtpBtn?.getBoundingClientRect();
    const shellRect = shell?.getBoundingClientRect();
    const btnBottom = btnRect && shellRect ? btnRect.bottom - shellRect.top : -1;
    push('btnBottom', Math.round(btnBottom));
    dtpBtn?.click();
    await until(() => document.querySelector('.dtp'));
    await wait(240);
    const dtp = document.querySelector('.dtp');
    push('dtpShown', !!dtp);
    const dtpTop = dtp ? parseFloat(dtp.style.top) : -1;
    push('dtpTop', Math.round(dtpTop));
    push('dtpNearBtn', dtpTop >= 0 && Math.abs(dtpTop - (btnBottom + 6)) < 40);
    push('dtpNotCenter', dtpTop >= 0 && dtpTop < 140);
    byText('.dtp__foot button', '取消')?.click();
    await wait(220);
    push('dtpClosed', !document.querySelector('.dtp'));

    /* ---------- 3) 删正文图片 + 立刻切笔记，孤儿附件仍回收 ---------- */
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], 'probe.png', { type: 'image/png' });
    const dtx = new DataTransfer();
    dtx.items.add(file);
    const fileInput = document.querySelector('input[type="file"][multiple]');
    push('fileInput', !!fileInput);
    if (fileInput) {
      fileInput.files = dtx.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await until(() => document.querySelector('.ProseMirror img[data-att-id]'), 9000);
    await wait(600);
    const img = document.querySelector('.ProseMirror img[data-att-id]');
    push('imgInserted', !!img);
    const atts = () => document.querySelectorAll('.attachments .attachment img').length;
    push('attAfterInsert', atts());

    // 点图片选中节点 → 浮动图片工具栏点「从正文移除」
    img?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await wait(320);
    const removeBtn = document.querySelector('.imgtools button.is-danger');
    push('removeBtn', !!removeBtn);
    removeBtn?.click();
    await wait(320);
    push('imgAfterDelete', document.querySelectorAll('.ProseMirror img[data-att-id]').length);

    // 关键：不等 800ms 宽限期，立刻切到另一篇笔记
    const other = rows().find((x) => !(x.textContent || '').includes('双模式'));
    other?.click();
    await wait(500);
    const back = rows().find((x) => (x.textContent || '').includes('双模式'));
    back?.click();
    await wait(700);
    push('attAfterSwitch', atts());
    push('orphanCleaned', atts() === 0);

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

    profile = pathlib.Path(tempfile.mkdtemp(prefix='zj-v254-'))
    args = [
        EDGE, '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1440,960',
        '--allow-file-access-from-files', f'--user-data-dir={profile}',
        '--virtual-time-budget=90000', '--dump-dom', OUT.as_uri(),
    ]
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding='utf-8', errors='replace')
    try:
        dom, _ = proc.communicate(timeout=200)
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

    EXPECT_TRUE = [
        'statsDefault', 'recentDefault', 'editBtn', 'recentHidden', 'recentRestored',
        'orderMoved', 'resetOrder', 'resetAllVisible', 'layoutClosed',
        'rich', 'dtpBtn', 'dtpShown', 'dtpNearBtn', 'dtpNotCenter', 'dtpClosed',
        'fileInput', 'imgInserted', 'removeBtn', 'orphanCleaned',
    ]
    EXPECT_NUM = {
        'homeVisibleDefault': '6', 'layoutItems': '7', 'visibleAfterHide': '5',
        'thumbsDefault': '0', 'attAfterInsert': '1', 'imgAfterDelete': '0',
        'attAfterSwitch': '0',
    }
    fails = []
    for k in EXPECT_TRUE:
        if kv.get(k) != 'true':
            fails.append(f'{k}={kv.get(k)}（期望 true）')
    for k, v in EXPECT_NUM.items():
        if kv.get(k) != v:
            fails.append(f'{k}={kv.get(k)}（期望 {v}）')
    if kv.get('error'):
        fails.append('error=' + kv.get('error'))

    shutil.rmtree(profile, ignore_errors=True)
    if fails:
        print('\n失败：' + ', '.join(fails), file=sys.stderr)
        return 3
    print('\n全部通过：首页自定义 + 日期弹层锚定按钮 + 切笔记前回收孤儿附件 + 正文图不当 LOGO')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
