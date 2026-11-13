#!/usr/bin/env python3
"""2.5.8 三项改动的浏览器端回归探针（2.5.9 起改用真实 Office 附件验证还原结果）：

  1) 工具栏去掉重复的「插入 ▾」下拉，只保留插入图标；
  2) 文件按类型显示彩色徽标（HTML / XLSX / DOCX / PPTX / PDF / CSV …），
     点击能在弹窗内嵌预览：HTML 沙箱 iframe、Word 正文、Excel/CSV 表格、PPT 分页、PDF 内嵌；
  3) 视频默认不再铺满编辑区，图片 / 文件卡片 / 视频都能调宽度与左中右位置，并落盘保存。

用法：python tools/make_singlefile.py .temp/zhijian-probe.html && python tools/v258-verify.py
"""

import json, pathlib, re, shutil, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / '.temp' / 'zhijian-probe.html'
OUT = ROOT / '.temp' / 'zhijian-v258-verify.html'
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
  const closeModal = async () => {
    const b = Array.from(document.querySelectorAll('.modal button'))
      .find((x) => (x.textContent || '').trim() === '关闭');
    b?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(260);
  };
  // 2.5.9：改用 Python 生成的真实 Office 文件（带样式 / 合并 / 多页），
  // 才能验证「还原格式」而不是只把文字抠出来。
  const FIX = __FIXTURES__;
  const fromB64 = (b64) => {
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const upload = async (file, role = 'file') => {
    const input = document.querySelector('input[data-role="' + role + '"]')
      || document.querySelector('input[type="file"][multiple]');
    const dt = new DataTransfer(); dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(620);
  };
  const officeFiles = [
    ['probe.html', 'text/html', fromB64(FIX.html)],
    ['probe.docx', 'application/octet-stream', fromB64(FIX.docx)],
    ['probe.xlsx', 'application/octet-stream', fromB64(FIX.xlsx)],
    ['probe.pptx', 'application/octet-stream', fromB64(FIX.pptx)],
    ['probe.csv', 'text/csv', fromB64(FIX.csv)],
    ['probe.pdf', 'application/pdf', fromB64(FIX.pdf)],
  ];

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

    /* ---------- 1) 插入入口只保留图标 ---------- */
    const insertDropdown = Array.from(document.querySelectorAll('.toolbar button.toolbar__caret'))
      .find((b) => (b.textContent || '').trim().startsWith('插入'));
    push('noInsertDropdown', !insertDropdown);
    const titles = Array.from(document.querySelectorAll('.toolbar .icon-btn')).map((b) => b.title || '');
    push('iconsKept', ['插入图片 / 文件', '插入语音 / 视频', '插入画板 / 流程图', '从文件导入']
      .every((t) => titles.some((x) => x.includes(t))));

    /* ---------- 2) 上传 6 类文件：徽标 / 卡片 / 内嵌预览 ---------- */
    for (const [name, type, blob] of officeFiles) {
      await upload(new File([blob], name, { type }));
    }
    await wait(700);
    const cards = () => Array.from(document.querySelectorAll('.ProseMirror .attach-card'));
    push('cardCount', cards().length);
    const cardKinds = cards().map((c) => (c.getAttribute('data-att-kind') || '') + ':' +
      (c.querySelector('.attach-card__badge')?.textContent || '').trim());
    push('cardKinds', JSON.stringify(cardKinds));
    push('kindsOk', ['html:HTML', 'word:DOCX', 'excel:XLSX', 'ppt:PPTX', 'pdf:PDF', 'excel:CSV']
      .every((k) => cardKinds.includes(k)));
    push('badgeCss', getComputedStyle(cards()[0].querySelector('.attach-card__badge') || document.body).backgroundColor);
    push('attBadges', document.querySelectorAll('.attachments .file-badge').length);
    push('noPaperclip', !Array.from(document.querySelectorAll('.ProseMirror a[data-att-id]'))
      .some((a) => getComputedStyle(a, '::before').content.includes('📎')));

    /* 逐个点开卡片，检查还原页里的内容与版式 */
    const frameInfo = () => {
      const f = document.querySelector('.preview-frame--doc');
      const sd = f?.getAttribute('srcdoc') || '';
      let d = null;
      try { d = f?.contentDocument || null; } catch (e) { d = null; }
      const text = () => (d?.body?.textContent || sd);
      const has = (sel) => d ? !!d.querySelector(sel) : sd.includes(sel.replace(/^[.#]/, ''));
      return { f, sd, d, text, has };
    };
    const expectPreview = [
      ['probe.html', 'htmlIframe'], ['probe.docx', 'docxText'],
      ['probe.xlsx', 'xlsxTable'], ['probe.pptx', 'pptxSlides'],
      ['probe.csv', 'csvTable'], ['probe.pdf', 'pdfFrame'],
    ];
    for (const [name, keyName] of expectPreview) {
      const card = cards().find((c) => (c.getAttribute('data-att-name') || '') === name);
      if (!card) { push(keyName, 'no-card'); continue; }
      card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await until(() => document.querySelector('.modal'), 4000);
      await until(() => document.querySelector('.preview-frame, .preview-filecard'), 6000);
      await wait(700);
      const info = frameInfo();
      if (name === 'probe.html') {
        push(keyName, !!info.f && (info.sd.includes(FIX.marks.html)));
        push('htmlSourceToggle', !!byText('.modal button', '查看网页源码'));
      } else if (name === 'probe.pdf') {
        push(keyName, !!document.querySelector('.preview-frame[src]'));
      } else if (name === 'probe.docx') {
        push(keyName, info.has('.docx-wrapper'));
        push('docxContent', info.text().includes(FIX.marks.docx));
      } else if (name === 'probe.pptx') {
        const n = info.d ? info.d.querySelectorAll('.zj-slide').length
          : (info.sd.match(/class="zj-slide"/g) || []).length;
        push(keyName, n >= 2);
        push('pptxContent', info.text().includes(FIX.marks.pptx));
      } else if (name === 'probe.xlsx') {
        push(keyName, info.has('table.zj-grid'));
        push('xlsxContent', info.text().includes(FIX.marks.xlsx));
      } else if (name === 'probe.csv') {
        push(keyName, info.has('table'));
        push('csvContent', info.text().includes('王明勇'));
      }
      await closeModal();
    }

    /* ---------- 3) 视频默认尺寸 + 宽度 / 位置可调并持久化 ---------- */
    await upload(new File([new Uint8Array([0, 1, 2, 3, 4, 5])], 'probe.webm', { type: 'video/webm' }), 'media');
    const video = await until(() => document.querySelector('.ProseMirror video'), 5000);
    push('videoDom', !!video);
    if (video) {
      const editorW = document.querySelector('.editor__rich')?.getBoundingClientRect().width || 900;
      push('defaultWidth', video.getAttribute('data-media-width'));
      push('defaultNotFull', video.getBoundingClientRect().width < editorW * 0.85);
      video.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      // 工具条是复用的：等它切到「视频 / 语音」这一组，别点在上一个文件卡片的按钮上。
      await until(() => (document.querySelector('.imgtools__label')?.textContent || '').includes('视频'), 4000);
      await wait(220);
      push('mediaToolbar', !!document.querySelector('.imgtools'));
      push('mediaToolbarKind', (document.querySelector('.imgtools__label')?.textContent || '').trim());
      const wBtn = Array.from(document.querySelectorAll('.imgtools button'))
        .find((b) => (b.title || '') === '宽度 40%');
      wBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await wait(400);
      const v2 = document.querySelector('.ProseMirror video');
      push('widthChanged', v2?.getAttribute('data-media-width') === '40%');
      const rBtn = Array.from(document.querySelectorAll('.imgtools button'))
        .find((b) => (b.title || '') === '靠右对齐');
      rBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await wait(400);
      push('alignRight', document.querySelector('.ProseMirror video')?.getAttribute('data-media-align') === 'right');
    }

    /* 文件卡片位置：hover → 居中 */
    const htmlCard = cards().find((c) => (c.getAttribute('data-att-name') || '') === 'probe.html');
    if (htmlCard) {
      htmlCard.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await until(() => (document.querySelector('.imgtools__label')?.textContent || '').includes('文件'), 4000);
      await wait(220);
      push('cardToolbarLabel', (document.querySelector('.imgtools__label')?.textContent || '').trim());
      push('cardToolbarBtns', Array.from(document.querySelectorAll('.imgtools button')).map((b) => b.title || '').join('|'));
      const cBtn = Array.from(document.querySelectorAll('.imgtools button'))
        .find((b) => (b.title || '') === '居中对齐');
      cBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await wait(420);
      const now = cards().find((c) => (c.getAttribute('data-att-name') || '') === 'probe.html');
      push('cardAligned', now?.getAttribute('data-align') === 'center');
    } else push('cardAligned', 'no-card');

    /* 落盘后切走再回来，宽度 / 位置都还在 */
    await wait(1400);
    const back = rows().find((x) => !(x.textContent || '').includes('双模式')) || rows()[rows().length - 1];
    back?.click(); await wait(700);
    const target = rows().find((x) => (x.textContent || '').includes('双模式')) || rows()[0];
    target?.click(); await wait(900);
    const v3 = document.querySelector('.ProseMirror video');
    push('persistWidth', v3?.getAttribute('data-media-width') === '40%');
    push('persistAlign', v3?.getAttribute('data-media-align') === 'right');
    push('persistCard', !!Array.from(document.querySelectorAll('.ProseMirror .attach-card'))
      .find((c) => c.getAttribute('data-align') === 'center'));

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
        print(f'缺少 {SRC}，先运行 make_singlefile.py', file=sys.stderr)
        return 1
    html = SRC.read_text(encoding='utf-8')
    fixtures = json.loads((ROOT / '.temp' / 'office-fixtures.json').read_text(encoding='utf-8'))
    probe = PROBE.replace('__FIXTURES__', json.dumps(fixtures, ensure_ascii=False))
    i = html.rfind('</body>')
    OUT.write_text(html[:i] + probe + html[i:], encoding='utf-8')

    profile = pathlib.Path(tempfile.mkdtemp(prefix='zj-v258-'))
    args = [EDGE, '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1440,960',
            '--allow-file-access-from-files', f'--user-data-dir={profile}',
            '--virtual-time-budget=120000', '--dump-dom', OUT.as_uri()]
    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         text=True, encoding='utf-8', errors='replace')
    try:
        dom, _ = p.communicate(timeout=240)
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
        'rich', 'noInsertDropdown', 'iconsKept', 'kindsOk', 'noPaperclip',
        'htmlIframe', 'docxText', 'xlsxTable', 'pptxSlides', 'csvTable', 'pdfFrame',
        'docxContent', 'pptxContent', 'xlsxContent', 'htmlSourceToggle',
        'videoDom', 'defaultNotFull', 'mediaToolbar', 'widthChanged', 'alignRight',
        'cardAligned', 'persistWidth', 'persistAlign', 'persistCard',
    ]
    fails = [f'{k}={kv.get(k)}（期望 true）' for k in EXPECT_TRUE if kv.get(k) != 'true']
    if kv.get('error'):
        fails.append('error=' + kv.get('error'))
    if int(kv.get('cardCount') or 0) < 6:
        fails.append(f"cardCount={kv.get('cardCount')}（应插入 6 个文件卡片）")
    if int(kv.get('attBadges') or 0) < 6:
        fails.append(f"attBadges={kv.get('attBadges')}（附件区应有 6 个类型徽标）")
    if kv.get('defaultWidth') != '60%':
        fails.append(f"defaultWidth={kv.get('defaultWidth')}（视频默认宽度应为 60%）")
    shutil.rmtree(profile, ignore_errors=True)
    if fails:
        print('\n失败：' + ', '.join(fails), file=sys.stderr)
        return 3
    print('\n全部通过：插入入口精简 + 文件类型徽标与 HTML/Word/Excel/PPT/CSV/PDF 内嵌预览 + 视频与卡片尺寸位置可调并持久化')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
