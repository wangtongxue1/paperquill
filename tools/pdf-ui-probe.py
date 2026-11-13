#!/usr/bin/env python3
"""导出 PDF 的端到端探针（单独一个脚本）。

为什么不跟 ui-probe.py 放在一起：导出 PDF 要真的跑一遍 html2canvas，
它是慢的、按真实时间走的，混在那条靠虚拟时间快进的链路里会把预算吃光。
这里单独开一个干净的浏览器档案，走「编辑器菜单 → 导出… → 统一面板选 PDF → 导出」
这条当前真实路径，把产出的字节捞回来校验。

用法：python tools/pdf-ui-probe.py
前置：pnpm build && python tools/make_singlefile.py .temp/zhijian-probe.html
"""

import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / '.temp' / 'zhijian-probe.html'
OUT = ROOT / '.temp' / 'zhijian-pdf-probe.html'
PROFILE = ROOT / '.temp' / 'edge-pdf-profile'
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

PROBE = r"""
<script>
(async () => {
  const log = [];
  const push = (k, v) => log.push(`${k}=${v}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, tries = 80) => {
    for (let i = 0; i < tries; i++) { const v = fn(); if (v) return v; await wait(150); }
    return null;
  };
  try {
    await until(() => document.querySelector('.nav-row'));
    Array.from(document.querySelectorAll('.nav-row'))
      .find((e) => (e.textContent || '').includes('全部笔记'))?.click();
    await until(() => document.querySelector('.note-row, .note-card'));
    document.querySelector('.note-row, .note-card')?.click();
    await wait(900);
    push('editor', !!document.querySelector('.editor__title'));

    let pdfBlob = null;
    const origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      if (b instanceof Blob && b.type === 'application/pdf') pdfBlob = b;
      return origCreate(b);
    };

    // 打开编辑器「更多」菜单
    document.querySelector('.editor__headacts .icon-btn:last-child')?.click();
    await wait(350);
    const menuOk = !!Array.from(document.querySelectorAll('.menu__item'))
      .find((e) => (e.textContent || '').trim() === '导出…');
    push('menu', menuOk);
    push('printItem', !!Array.from(document.querySelectorAll('.menu__item'))
      .find((e) => (e.textContent || '').includes('打印')));
    // 点开统一导出面板
    Array.from(document.querySelectorAll('.menu__item'))
      .find((e) => (e.textContent || '').trim() === '导出…')?.click();
    await wait(450);
    push('exportDialog', !!document.querySelector('.export-cards'));
    // 选 PDF 卡
    const pdfCard = Array.from(document.querySelectorAll('.export-card'))
      .find((b) => (b.textContent || '').includes('PDF'));
    push('pdfCard', !!pdfCard);
    pdfCard?.click();
    await wait(250);
    // 点「导出 PDF」主按钮（modal 底部的 primary 按钮）
    const okBtn = document.querySelector('.modal__foot .btn--primary');
    push('okBtn', !!okBtn);
    okBtn?.click();

    // 等 PDF blob 生成（html2canvas 渲染 + jsPDF 拼接，较慢）
    await until(() => pdfBlob, 500);
    push('bytes', pdfBlob ? pdfBlob.size : 0);
    if (pdfBlob) {
      const buf = new Uint8Array(await pdfBlob.arrayBuffer());
      const text = new TextDecoder('iso-8859-1').decode(buf);
      push('head', String.fromCharCode(...buf.slice(0, 8)));
      push('pages', (text.match(/\/Type \/Page[^s]/g) || []).length);
      push('eof', text.trimEnd().endsWith('%%EOF'));
      push('hasXref', /startxref\s+\d+\s+%%EOF/.test(text));
      // 真正的图片流：DCTDecode 且 /Length 与字节数能对上
      const m = text.match(/\/Subtype \/Image \/Width (\d+) \/Height (\d+)[^>]*\/Length (\d+) >>\nstream\n/);
      push('imageDict', m ? `${m[1]}x${m[2]}/${m[3]}` : 'none');
      // 原样落一份到磁盘，方便人工打开确认
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) {
        bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      }
      const holder = document.createElement('pre');
      holder.id = 'pdfb64';
      holder.textContent = btoa(bin);
      document.body.appendChild(holder);
    }
    URL.createObjectURL = origCreate;
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
    OUT.write_text(html[:i] + PROBE + html[i:], encoding='utf-8')

    # 每次用全新档案：上一次跑留下的笔记会让列表顺序变，也会拖慢启动。
    if PROFILE.exists():
        shutil.rmtree(PROFILE, ignore_errors=True)
    PROFILE.mkdir(parents=True, exist_ok=True)

    args = [
        EDGE, '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1360,900',
        '--allow-file-access-from-files', f'--user-data-dir={PROFILE}',
        '--virtual-time-budget=180000', '--dump-dom', OUT.as_uri(),
    ]
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding='utf-8', errors='replace')
    try:
        dom, _ = proc.communicate(timeout=240)
    except subprocess.TimeoutExpired:
        proc.kill()
        dom, _ = proc.communicate()

    m = re.search(r'<pre id="probe">(.*?)</pre>', dom or '', re.S)
    if not m:
        print('PDF 探针没有输出，DOM 前 400 字符：\n' + (dom or '')[:400], file=sys.stderr)
        return 2
    text = m.group(1).replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    print(text)

    # 顺手把导出的 PDF 存一份，方便双击打开眼见为实
    mb = re.search(r'<pre id="pdfb64">(.*?)</pre>', dom or '', re.S)
    if mb:
        import base64
        pdf_path = ROOT / '.temp' / 'exported.pdf'
        pdf_path.write_bytes(base64.b64decode(mb.group(1).strip()))
        print(f'已保存 {pdf_path}（{pdf_path.stat().st_size:,} 字节）')
    ok = ('bytes=' in text and 'bytes=0' not in text
          and 'head=%PDF-1.4' in text and 'eof=true' in text
          and 'hasXref=true' in text and 'menu=true' in text and 'printItem=true' in text
          and 'exportDialog=true' in text and 'pdfCard=true' in text and 'okBtn=true' in text)
    if not ok:
        print('\nPDF 导出有问题', file=sys.stderr)
        return 3
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
