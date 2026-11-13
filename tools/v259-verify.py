#!/usr/bin/env python3
"""2.5.9 三项改动的浏览器端回归探针：

  1) 文件卡片只显示「名称 + 大小」，不再跟英文 MIME / 格式说明；
  2) 文档预览还原内容与格式：Word 用 docx-preview（表格 / 字体 / 颜色），
     Excel 还原合并单元格 / 底色 / 边框 / 多工作表，PPT 按 EMU 坐标还原版式，
     HTML 保留 style 标签原样渲染，Markdown 渲染成排版后的 HTML；
  3) 「插入图片 / 文件」通道不检测音视频，音视频只从专用通道进入。

用法：python tools/make_office_fixtures.py && python tools/make_singlefile.py .temp/zhijian-probe.html && python tools/v259-verify.py
"""

import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / '.temp' / 'zhijian-probe.html'
OUT = ROOT / '.temp' / 'zhijian-v259-verify.html'
FIXTURES = ROOT / '.temp' / 'office-fixtures.json'
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
    await wait(280);
  };
  const FIX = __FIXTURES__;
  const fromB64 = (b64) => {
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const upload = async (file, role = 'file') => {
    const input = document.querySelector('input[data-role="' + role + '"]');
    if (!input) { push('missingInput_' + role, 1); return; }
    const dt = new DataTransfer(); dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(650);
  };
  const frameInfo = () => {
    const f = document.querySelector('.preview-frame--doc');
    const sd = f?.getAttribute('srcdoc') || '';
    let d = null;
    try { d = f?.contentDocument || null; } catch (e) { d = null; }
    return { f, sd, d, text: () => (d?.body?.textContent || sd) };
  };
  const openCard = async (name) => {
    const card = Array.from(document.querySelectorAll('.ProseMirror .attach-card'))
      .find((c) => (c.getAttribute('data-att-name') || '') === name);
    if (!card) return false;
    card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await until(() => document.querySelector('.modal'), 4000);
    await until(() => document.querySelector('.preview-frame, .preview-filecard, .preview-img'), 7000);
    await wait(750);
    return true;
  };

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

    /* ---------- 3) 上传通道分离 ---------- */
    const fileInput = document.querySelector('input[data-role="file"]');
    const mediaInput = document.querySelector('input[data-role="media"]');
    push('channelsExist', !!fileInput && !!mediaInput);
    push('fileAcceptNoMedia', !!fileInput && !/audio\/|video\/|\.mp4|\.mp3/i.test(fileInput.accept || ''));
    push('mediaAcceptAudioVideo', !!mediaInput && /audio\/\*/.test(mediaInput.accept || '') && /video\/\*/.test(mediaInput.accept || ''));
    // 从「插入图片 / 文件」通道进来的 MP4：当普通文件收下，不渲染播放器。
    await upload(new File([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])], '误选的视频.mp4', { type: 'video/mp4' }), 'file');
    push('fileChannelNoPlayer', document.querySelectorAll('.ProseMirror video, .ProseMirror audio').length === 0);
    const mp4Card = Array.from(document.querySelectorAll('.ProseMirror .attach-card'))
      .find((c) => (c.getAttribute('data-att-name') || '') === '误选的视频.mp4');
    push('fileChannelCard', !!mp4Card);
    if (mp4Card) {
      await openCard('误选的视频.mp4');
      push('fileChannelPreviewNoPlayer', document.querySelectorAll('.modal video, .modal audio').length === 0);
      push('openExternalBtn', !!byText('.modal button', '用本机程序打开'));
      await closeModal();
    } else {
      push('fileChannelPreviewNoPlayer', false);
      push('openExternalBtn', false);
    }
    // 专用通道上传同样的 MP4：正常渲染播放器。
    await upload(new File([new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7])], '正式视频.mp4', { type: 'video/mp4' }), 'media');
    push('mediaChannelPlays', !!document.querySelector('.ProseMirror video'));

    /* ---------- 1) 卡片只显示名称 + 大小 ---------- */
    const files = [
      ['格式预览.html', 'text/html', FIX.html],
      ['排版说明.md', 'text/markdown', FIX.md],
      ['预算表.csv', 'text/csv', FIX.csv],
      ['费控蓝图.docx', 'application/octet-stream', FIX.docx],
      ['项目清单.xlsx', 'application/octet-stream', FIX.xlsx],
      ['方案汇报.pptx', 'application/octet-stream', FIX.pptx],
      ['样章.pdf', 'application/pdf', FIX.pdf],
    ];
    for (const [name, type, b64] of files) {
      await upload(new File([fromB64(b64)], name, { type }));
    }
    await wait(800);
    const metas = Array.from(document.querySelectorAll('.ProseMirror .attach-card__meta'))
      .map((m) => (m.textContent || '').trim());
    push('metaCount', metas.length);
    push('metaSample', JSON.stringify(metas.slice(0, 3)));
    push('metaOnlySize', metas.length > 0 && metas.every((m) => !m || /^[\d.]+\s*(B|KB|MB|GB)$/i.test(m)));
    push('metaNoEnglish', metas.every((m) => !/[a-z]{3,}/i.test(m.replace(/(KB|MB|GB|B)/gi, ''))));
    push('metaNoMime', metas.every((m) => !m.includes('/') && !m.includes('·')));
    const subtitle = await (async () => {
      await openCard('费控蓝图.docx');
      const t = (document.querySelector('.modal__head p')?.textContent || '').trim();
      push('subtitleNoMime', !/text\/|application\/|octet-stream|vnd\./i.test(t) && /来自/.test(t));
      push('subtitleHasSize', /\d+\s*(B|KB|MB|GB)/i.test(t));
      return t;
    })();
    push('subtitle', subtitle.slice(0, 60));

    /* ---------- 2) 文档预览还原内容与格式 ---------- */
    // Word：docx-preview 应生成 wrapper / 表格 / 红色粗体样式，而不是纯文字摘录。
    let inf = frameInfo();
    push('iframeReadable', !!inf.d);
    push('docxWrapper', !!inf.f && (inf.d ? !!inf.d.querySelector('.docx-wrapper') : inf.sd.includes('docx-wrapper')));
    push('docxTable', inf.d ? !!inf.d.querySelector('table') : /<table/i.test(inf.sd));
    push('docxStyled', /C0392B|color:\s*#c0392b|font-weight/i.test(inf.sd));
    push('docxContent', inf.text().includes(FIX.marks.docx));
    await closeModal();

    // Excel：合并单元格、底色 / 边框、列宽、两个工作表 tab。
    await openCard('项目清单.xlsx');
    inf = frameInfo();
    push('xlsxMerged', inf.d ? !!inf.d.querySelector('td[colspan="3"]') : /colspan="3"/.test(inf.sd));
    push('xlsxStyled', /background-color|border-left|border-top/i.test(inf.sd));
    push('xlsxTabs', (inf.sd.match(/data-tab=/g) || []).length >= 2);
    push('xlsxContent', inf.text().includes(FIX.marks.xlsx));
    await closeModal();

    // PPT：两页、按坐标绝对定位的形状、主题配色。
    await openCard('方案汇报.pptx');
    inf = frameInfo();
    const slideCount = inf.d ? inf.d.querySelectorAll('.zj-slide').length : (inf.sd.match(/class="zj-slide"/g) || []).length;
    push('pptxPages', slideCount);
    push('pptxPositioned', /class="zj-item"|position: absolute/i.test(inf.sd));
    push('pptxStyled', /13C2C2|C0392B|font-size/i.test(inf.sd));
    push('pptxContent', inf.text().includes(FIX.marks.pptx));
    await closeModal();

    // HTML：<style> 原样保留；沙箱不给 same-origin。
    await openCard('格式预览.html');
    inf = frameInfo();
    push('htmlStyleKept', /<style>/i.test(inf.sd) && /border-bottom:2px solid/i.test(inf.sd));
    push('htmlStrictSandbox', !!inf.f && !(inf.f.getAttribute('sandbox') || '').includes('allow-same-origin'));
    push('htmlContent', inf.sd.includes(FIX.marks.html));
    await closeModal();

    // Markdown：渲染成 h1 / table / blockquote，而不是 <pre> 里的原文。
    await openCard('排版说明.md');
    inf = frameInfo();
    push('mdHeading', inf.d ? !!inf.d.querySelector('h1') : /<h1/i.test(inf.sd));
    push('mdTable', inf.d ? !!inf.d.querySelector('table') : /<table/i.test(inf.sd));
    push('mdQuote', inf.d ? !!inf.d.querySelector('blockquote') : /<blockquote/i.test(inf.sd));
    push('mdNoPlainPre', !/class="preview-text"/.test(document.querySelector('.modal')?.innerHTML || ''));
    push('mdContent', inf.text().includes(FIX.marks.md));
    await closeModal();

    // CSV 仍是表格；PDF 仍走内嵌框架。
    await openCard('预算表.csv');
    inf = frameInfo();
    push('csvTable', inf.d ? !!inf.d.querySelector('table') : /<table/i.test(inf.sd));
    push('csvContent', inf.text().includes('王明勇'));
    await closeModal();
    await openCard('样章.pdf');
    push('pdfFrame', !!document.querySelector('.preview-frame[src]'));
    await closeModal();

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
    for f in (SRC, FIXTURES):
        if not f.exists():
            print(f'缺少 {f}，先运行 make_singlefile.py / make_office_fixtures.py', file=sys.stderr)
            return 1
    html = SRC.read_text(encoding='utf-8')
    fixtures = json.loads(FIXTURES.read_text(encoding='utf-8'))
    probe = PROBE.replace('__FIXTURES__', json.dumps(fixtures, ensure_ascii=False))
    i = html.rfind('</body>')
    OUT.write_text(html[:i] + probe + html[i:], encoding='utf-8')

    profile = pathlib.Path(tempfile.mkdtemp(prefix='zj-v259-'))
    args = [EDGE, '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1440,960',
            '--allow-file-access-from-files', f'--user-data-dir={profile}',
            '--virtual-time-budget=150000', '--dump-dom', OUT.as_uri()]
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
        'rich', 'channelsExist', 'fileAcceptNoMedia', 'mediaAcceptAudioVideo',
        'fileChannelNoPlayer', 'fileChannelCard', 'fileChannelPreviewNoPlayer',
        'openExternalBtn', 'mediaChannelPlays',
        'metaOnlySize', 'metaNoEnglish', 'metaNoMime', 'subtitleNoMime', 'subtitleHasSize',
        'docxWrapper', 'docxTable', 'docxStyled', 'docxContent',
        'xlsxMerged', 'xlsxStyled', 'xlsxTabs', 'xlsxContent',
        'pptxPositioned', 'pptxStyled', 'pptxContent',
        'htmlStyleKept', 'htmlStrictSandbox', 'htmlContent',
        'mdHeading', 'mdTable', 'mdQuote', 'mdNoPlainPre', 'mdContent',
        'csvTable', 'csvContent', 'pdfFrame',
    ]
    fails = [f'{k}={kv.get(k)}（期望 true）' for k in EXPECT_TRUE if kv.get(k) != 'true']
    if int(kv.get('metaCount') or 0) < 7:
        fails.append(f"metaCount={kv.get('metaCount')}（应至少有 7 张卡片）")
    if int(kv.get('pptxPages') or 0) < 2:
        fails.append(f"pptxPages={kv.get('pptxPages')}（应还原 2 页幻灯片）")
    if kv.get('error'):
        fails.append('error=' + kv.get('error'))
    shutil.rmtree(profile, ignore_errors=True)
    if fails:
        print('\n失败：' + ', '.join(fails), file=sys.stderr)
        return 3
    print('\n全部通过：卡片只显示名称与大小 + Word/Excel/PPT/HTML/MD 还原内容与格式 + 图片文件通道不检测音视频')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
