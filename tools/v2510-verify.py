#!/usr/bin/env python3
"""2.5.10 两项改动的浏览器端回归探针：

  1) 全系统通知统一到窗口上部中间：.toast-host 固定定位、层级最高、
     pointer-events 不挡操作、多条竖向堆叠且互不遮盖、可单条关闭 / 自动消失；
  2) 到期提醒列表不再被 .titlebar 的 overflow:hidden 裁切：
     portal 到 body + fixed 锚定铃铛，整张列表可见且不被遮罩盖住。

用法：python tools/make_singlefile.py .temp/zhijian-probe.html && python tools/v2510-verify.py
"""

import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / '.temp' / 'zhijian-probe.html'
OUT = ROOT / '.temp' / 'zhijian-v2510-verify.html'
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
  const byText = (sel, text) => Array.from(document.querySelectorAll(sel))
    .find((e) => (e.textContent || '').includes(text));
  const click = (el) => el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const toasts = () => Array.from(document.querySelectorAll('.toast-host .toast'));
  const switchMode = async () => {
    click(document.querySelector('.mode-pill'));
    await wait(420);
  };
  const topmostHit = (el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit;
  };

  try {
    await until(() => document.querySelector('.nav-row'));
    byText('.nav-row', '全部笔记')?.click();
    await until(() => document.querySelectorAll('.note-row, .note-card').length);
    click(document.querySelectorAll('.note-row, .note-card')[0]);
    await until(() => document.querySelector('.mode-pill'));
    // 冷启动若已有「提醒到期」通知，先等它自然消失，避免干扰计数。
    await wait(3000);
    push('cleanStart', toasts().length === 0);

    /* ---------- 1) 顶部中间 + 层级最高 ---------- */
    await switchMode();
    await until(() => toasts().length, 5000);
    const host = document.querySelector('.toast-host');
    push('hostExists', !!host);
    const hr = host?.getBoundingClientRect();
    push('hostTop', hr ? Math.round(hr.top) : -1);
    push('hostUpperHalf', !!hr && hr.top < window.innerHeight * 0.25 && hr.top >= 0);
    push('hostCentered', !!hr && Math.abs((hr.left + hr.width / 2) - window.innerWidth / 2) < 6);
    push('hostInViewport', !!hr && hr.left >= 0 && hr.right <= window.innerWidth
      && hr.top >= 0 && hr.bottom <= window.innerHeight);
    push('hostZ', host ? getComputedStyle(host).zIndex : '0');
    push('hostPointerNone', !!host && getComputedStyle(host).pointerEvents === 'none');
    push('toastPointerAuto', toasts().length > 0
      && getComputedStyle(toasts()[0]).pointerEvents === 'auto');
    const t1 = toasts()[0];
    push('toastText', !!t1 && t1.textContent.includes('已切换'));
    push('toastNotCovered', !!t1 && !!topmostHit(t1)?.closest('.toast'));
    push('closeBtn', !!t1?.querySelector('.toast__close'));
    push('noBottomToast', !document.querySelector('.statusbar ~ .toast'));

    /* ---------- 2) 多条堆叠，互不遮盖 ---------- */
    await switchMode();
    await until(() => toasts().length >= 2, 5000);
    push('multiToast', toasts().length >= 2);
    push('toastCount', toasts().length);
    push('distinctText', new Set(toasts().map((x) => x.textContent)).size >= 2);
    await wait(300);   // 等第二条入场动画落位再量间距
    // 用 offsetTop 判堆叠：headless 虚拟时间下 CSS 入场动画的 transform 可能停在首帧，
    // getBoundingClientRect 会把它算进去，offsetTop 才是稳定的布局位置。
    const [aEl, bEl] = toasts();
    push('stackedNoOverlap', !!aEl && !!bEl
      && bEl.offsetTop >= aEl.offsetTop + aEl.offsetHeight - 1);
    const [a, b] = toasts().map((x) => x.getBoundingClientRect());
    push('bothCentered', !!a && !!b && Math.abs((a.left + a.width / 2) - (b.left + b.width / 2)) < 40);
    // 单条关闭不影响另一条
    click(toasts()[0].querySelector('.toast__close'));
    await wait(200);
    push('dismissOne', toasts().length === 1);

    /* ---------- 3) 提醒弹窗不再被标题栏裁切 ---------- */
    const bell = document.querySelector('.reminder-wrap button');
    click(bell);
    await until(() => document.querySelector('.reminder-pop'), 5000);
    const pop = document.querySelector('.reminder-pop');
    push('popExists', !!pop);
    const pr = pop?.getBoundingClientRect();
    push('popPortalToBody', !!pop && pop.parentElement === document.body);
    push('popFixed', !!pop && getComputedStyle(pop).position === 'fixed');
    push('popZ', pop ? getComputedStyle(pop).zIndex : '0');
    const bar = document.querySelector('.titlebar').getBoundingClientRect();
    push('popBelowTitlebar', !!pr && pr.top >= bar.bottom - 2);
    push('popInViewport', !!pr && pr.top >= 0 && pr.left >= 0
      && pr.right <= window.innerWidth && pr.bottom <= window.innerHeight);
    push('popTitle', !!pop && pop.textContent.includes('到期提醒'));
    push('popHeight', pr ? Math.round(pr.height) : 0);
    push('popNotCovered', !!pop && !!topmostHit(pop)?.closest('.reminder-pop'));
    // 底部区域也要真的可点：被 overflow:hidden 裁掉时这里会命中别的元素
    if (pr) {
      const bottomHit = document.elementFromPoint(pr.left + pr.width / 2, pr.bottom - 6);
      push('popBottomVisible', !!bottomHit?.closest('.reminder-pop'));
    }
    const dismiss = document.querySelector('.menu-dismiss');
    push('popAboveDismiss', !!pop && !!dismiss
      && Number(getComputedStyle(pop).zIndex) > Number(getComputedStyle(dismiss).zIndex));
    // 标题栏仍保持原有布局（没有靠改 overflow 粗暴解决）
    push('titlebarOverflowKept', getComputedStyle(document.querySelector('.titlebar')).overflow === 'hidden');

    /* ---------- 4) 弹窗开着时通知仍在最上层 ---------- */
    await switchMode();
    await until(() => toasts().length >= 2, 5000);
    const last = toasts()[toasts().length - 1];
    push('toastAbovePop', !!last && !!topmostHit(last)?.closest('.toast'));
    push('popStillOpen', !!document.querySelector('.reminder-pop'));

    // 关闭提醒弹窗：点遮罩空白处
    document.querySelector('.menu-dismiss')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await wait(250);
    push('popClosed', !document.querySelector('.reminder-pop'));

    /* ---------- 5) 模态框打开时通知也不被遮 ---------- */
    click(document.querySelector('button[title="设置"]'));
    await until(() => document.querySelector('.modal-backdrop'), 5000);
    push('modalOpen', !!document.querySelector('.modal-backdrop'));
    await switchMode();
    await until(() => toasts().length, 5000);
    const inModal = toasts()[toasts().length - 1];
    push('toastAboveModal', !!inModal && !!topmostHit(inModal)?.closest('.toast'));
    push('modalZ', getComputedStyle(document.querySelector('.modal-backdrop')).zIndex);
    // 关掉设置弹窗
    const closeBtn = Array.from(document.querySelectorAll('.modal button'))
      .find((x) => (x.textContent || '').trim() === '关闭'
        || (x.getAttribute('title') || '').includes('关闭'));
    click(closeBtn || document.querySelector('.modal__head button'));
    await wait(250);

    /* ---------- 6) 自动消失 ---------- */
    await wait(3200);
    push('autoHide', toasts().length === 0);
    push('hostGone', !document.querySelector('.toast-host'));

    push('done', 1);
  } catch (e) {
    push('error', String((e && e.stack) || e).slice(0, 500));
  }
  const pre = document.createElement('pre');
  pre.id = 'probe'; pre.textContent = log.join('\n');
  document.body.appendChild(pre);
})();
</script>
"""


def main() -> int:
    if not SRC.exists():
        print(f'缺少 {SRC}，先运行 make_singlefile.py .temp/zhijian-probe.html', file=sys.stderr)
        return 1
    html = SRC.read_text(encoding='utf-8')
    i = html.rfind('</body>')
    OUT.write_text(html[:i] + PROBE + html[i:], encoding='utf-8')

    profile = pathlib.Path(tempfile.mkdtemp(prefix='zj-v2510-'))
    args = [EDGE, '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1440,960',
            '--allow-file-access-from-files', f'--user-data-dir={profile}',
            '--virtual-time-budget=180000', '--dump-dom', OUT.as_uri()]
    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         text=True, encoding='utf-8', errors='replace')
    try:
        dom, _ = p.communicate(timeout=300)
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
        'cleanStart', 'hostExists', 'hostUpperHalf', 'hostCentered', 'hostInViewport',
        'hostPointerNone', 'toastPointerAuto', 'toastText', 'toastNotCovered', 'closeBtn',
        'noBottomToast', 'multiToast', 'distinctText', 'stackedNoOverlap', 'bothCentered',
        'dismissOne', 'popExists', 'popPortalToBody', 'popFixed', 'popBelowTitlebar',
        'popInViewport', 'popTitle', 'popNotCovered', 'popBottomVisible', 'popAboveDismiss',
        'titlebarOverflowKept', 'toastAbovePop', 'popStillOpen', 'popClosed', 'modalOpen',
        'toastAboveModal', 'autoHide', 'hostGone',
    ]
    fails = [f'{k}={kv.get(k)}（期望 true）' for k in EXPECT_TRUE if kv.get(k) != 'true']
    for key, lo, hi in [('hostTop', 0, 200), ('hostZ', 2000, 99999),
                        ('popZ', 1100, 99999), ('popHeight', 45, 9999),
                        ('toastCount', 2, 3)]:
        try:
            v = float(kv.get(key, -1))
        except ValueError:
            v = -1
        if not (lo <= v <= hi):
            fails.append(f'{key}={kv.get(key)}（期望 {lo}~{hi}）')
    if kv.get('error'):
        fails.append('error=' + kv.get('error'))
    shutil.rmtree(profile, ignore_errors=True)
    if fails:
        print('\n失败：' + ', '.join(fails), file=sys.stderr)
        return 3
    print('\n全部通过：通知统一顶部中间、多条不互相遮盖、层级最高；提醒列表 portal 后完整可见')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
