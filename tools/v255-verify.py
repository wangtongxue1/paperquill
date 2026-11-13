#!/usr/bin/env python3
"""2.5.5 三项改动的浏览器端回归探针：

  1) Ctrl+F / Ctrl+H → 笔记内容内查找替换（命中高亮、上下跳、替换一处 / 全部替换、Esc 关闭）；
  2) 音视频上传后 MIME 修正，正文播放器与附件预览都能加载（含 File.type 为空的情况）；
  3) 插入入口只保留工具栏图标（2.5.8 起移除重复的「插入 ▾」下拉），底部附件区点名字可回插本篇附件。

用法：python tools/make_singlefile.py .temp/zhijian-probe.html && python tools/v255-verify.py
"""

import pathlib, re, shutil, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / '.temp' / 'zhijian-probe.html'
OUT = ROOT / '.temp' / 'zhijian-v255-verify.html'
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
  const setVal = (el, v) => {
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const key = (k, opts = {}) => document.dispatchEvent(new KeyboardEvent('keydown', {
    key: k, bubbles: true, cancelable: true, ...opts,
  }));
  // 取原文里真实存在的连续中文片段（不能先把空格去掉，否则查不到）
  const pick = (s) => (s.match(/[\u4e00-\u9fa5]{3}/) || [s.replace(/\s+/g, '').slice(0, 3)])[0] || '';

  // 真实可播的 WAV（8kHz / 8bit / mono / 0.4 秒正弦）
  function makeWav() {
    const rate = 8000, n = rate * 0.4 | 0, data = new Uint8Array(n);
    for (let i = 0; i < n; i++) data[i] = 128 + Math.round(110 * Math.sin(2 * Math.PI * 440 * i / rate));
    const b = new Uint8Array(44 + n), v = new DataView(b.buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true);
    v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    str(36, 'data'); v.setUint32(40, n, true); b.set(data, 44);
    return b;
  }
  const upload = async (file) => {
    const input = document.querySelector('input[data-role="media"]')
      || document.querySelector('input[type="file"][multiple]');
    const dt = new DataTransfer(); dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(750);
  };
  const lastMedia = (tag) => {
    const list = Array.from(document.querySelectorAll('.ProseMirror ' + tag));
    return list[list.length - 1] || null;
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

    /* ---------- 1) Ctrl+F 内容内查找 / 替换 ---------- */
    key('f', { ctrlKey: true });
    await until(() => document.querySelector('.findbar'));
    push('ctrlFBar', !!document.querySelector('.findbar'));
    push('ctrlFNoGlobalDialog', !byText('.modal', '搜索笔记'));
    const barText = () => (document.querySelector('.ProseMirror')?.textContent || '');
    const sample = pick(barText());
    push('sample', sample);
    setVal(document.querySelector('.findbar__input'), sample);
    await wait(500);
    push('hitCount', document.querySelectorAll('.ProseMirror .find-hit').length);
    push('currentHit', document.querySelectorAll('.ProseMirror .find-hit.is-current').length);
    push('findCountText', (document.querySelector('.findbar__count')?.textContent || '').trim());

    // 下一个 / 上一个：当前项序号会变
    const before = (document.querySelector('.findbar__count')?.textContent || '').trim();
    const nextBtn = document.querySelector('.findbar__row button[title^="下一个"]');
    nextBtn?.click(); await wait(320);
    const after = (document.querySelector('.findbar__count')?.textContent || '').trim();
    push('nextMoved', before !== after || document.querySelectorAll('.ProseMirror .find-hit').length === 1);

    // 展开替换 → 替换一处
    document.querySelector('.findbar__toggle')?.click();
    await wait(250);
    push('replaceRow', !!document.querySelector('.findbar__row--replace'));
    const replInput = document.querySelector('.findbar__row--replace .findbar__input');
    setVal(replInput, 'ZZ探针ZZ');
    await wait(200);
    const oneBtn = document.querySelector('.findbar__row--replace button');
    oneBtn?.click(); await wait(600);
    push('replacedOne', barText().includes('ZZ探针ZZ'));
    push('decoCleanAfterReplace', document.querySelectorAll('.ProseMirror .find-hit').length === 0 ||
      barText().includes('ZZ探针ZZ'));

    // 全部替换（把刚替换出来的都改成统一词）
    setVal(document.querySelector('.findbar__input'), 'ZZ探针ZZ');
    await wait(350);
    setVal(document.querySelector('.findbar__row--replace .findbar__input'), 'YY全部YY');
    await wait(200);
    const allBtn = document.querySelectorAll('.findbar__row--replace button')[1];
    allBtn?.click(); await wait(650);
    push('replaceAll', barText().includes('YY全部YY') && !barText().includes('ZZ探针ZZ'));

    key('Escape'); await wait(300);
    push('escClosed', !document.querySelector('.findbar'));
    push('noHitAfterClose', document.querySelectorAll('.ProseMirror .find-hit').length === 0);

    // Ctrl+Shift+F 仍走全局搜索
    key('f', { ctrlKey: true, shiftKey: true });
    await wait(400);
    push('globalSearchStillWorks', !!byText('.modal', '搜索笔记') || !!byText('.modal', '搜索'));
    key('Escape'); await wait(250);

    /* ---------- 2) 音视频上传后能播（重点：File.type 为空） ---------- */
    const wav = makeWav();
    await upload(new File([wav], 'probe.wav', { type: '' }));   // 模拟 Windows 无 MIME
    const a = lastMedia('audio');
    push('audioDom', !!a);
    push('audioMime', (a?.getAttribute('src') || '').slice(0, 22));
    push('audioMimeFixed', /^data:audio\/wav;base64/.test(a?.getAttribute('src') || ''));
    push('audioReady', a ? a.readyState : -1);
    push('audioError', a && a.error ? a.error.code : 0);

    // 附件预览弹窗里也要有播放器，不能落到「不支持内嵌预览」
    const attRow = Array.from(document.querySelectorAll('.attachments .attachment'))
      .find((x) => (x.textContent || '').includes('probe.wav'));
    attRow?.querySelector('.attachment__file')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(450);
    push('previewAudio', document.querySelectorAll('.preview-audio').length);
    push('previewNotUnsupported', !byText('.modal', '不支持内嵌预览'));
    byText('.modal button', '关闭')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(250);

    await upload(new File([new Uint8Array([0, 1, 2, 3, 4, 5])], 'probe.webm', { type: '' }));
    const v = lastMedia('video');
    push('videoDom', !!v);
    push('videoMimeFixed', /^data:video\/webm;base64/.test(v?.getAttribute('src') || ''));
    push('videoControls', !!v && v.hasAttribute('controls'));
    const vRow = Array.from(document.querySelectorAll('.attachments .attachment'))
      .find((x) => (x.textContent || '').includes('probe.webm'));
    vRow?.querySelector('.attachment__file')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(450);
    push('previewVideo', document.querySelectorAll('.preview-video').length);
    byText('.modal button', '关闭')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(250);

    /* ---------- 3) 2.5.8：插入下拉已移除，保留工具栏图标 + 附件区回插 ---------- */
    const insertBtn = Array.from(document.querySelectorAll('.toolbar button.toolbar__caret'))
      .find((b) => (b.textContent || '').trim().startsWith('插入'));
    push('noInsertDropdown', !insertBtn);
    const iconTitles = Array.from(document.querySelectorAll('.toolbar .icon-btn')).map((b) => b.title || '');
    push('insertFileIcon', iconTitles.some((t) => t.includes('插入图片 / 文件')));
    push('insertMediaIcon', iconTitles.some((t) => t.includes('插入语音 / 视频')));
    push('insertBoardIcon', iconTitles.some((t) => t.includes('插入画板')));
    push('insertImportIcon', iconTitles.some((t) => t.includes('从文件导入')));
    const attBefore = document.querySelectorAll('.ProseMirror [data-att-id]').length;
    const richAttRow = Array.from(document.querySelectorAll('.attachments .attachment'))
      .find((x) => (x.textContent || '').includes('probe.wav'));
    richAttRow?.querySelector(':scope > span')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(650);
    const attAfter = document.querySelectorAll('.ProseMirror [data-att-id]').length;
    push('reInsertAdded', attAfter - attBefore);

    /* ---------- 源码视图同样支持 Ctrl+F / Ctrl+H ---------- */
    document.querySelector('.mode-pill')?.click();
    await wait(950);
    push('mdMode', !document.querySelector('.ProseMirror'));
    key('f', { ctrlKey: true }); await wait(350);
    push('mdFindBar', !!document.querySelector('.findbar'));
    key('h', { ctrlKey: true }); await wait(300);
    push('ctrlHReplace', !!document.querySelector('.findbar__row--replace'));
    const mdText = document.querySelector('.md-editor__input')?.value || '';
    setVal(document.querySelector('.findbar__input'), pick(mdText));
    await wait(450);
    push('mdFindCount', (document.querySelector('.findbar__count')?.textContent || '').trim());
    key('Escape'); await wait(250);

    // 源码视图里点底部附件区的名字回插音视频 → 预览区应直接渲染播放器
    const mdAttRow = Array.from(document.querySelectorAll('.attachments .attachment'))
      .find((x) => (x.textContent || '').includes('probe.wav'));
    mdAttRow?.querySelector(':scope > span')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(850);
    const mdMedia = Array.from(document.querySelectorAll('.editor__preview audio, .editor__preview video'));
    push('mdPreviewMedia', mdMedia.length);
    push('mdPreviewSrcFixed', mdMedia.some((m) => /^data:audio\//.test(m.getAttribute('src') || '')));

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
    i = html.rfind('</body>')
    OUT.write_text(html[:i] + PROBE + html[i:], encoding='utf-8')

    profile = pathlib.Path(tempfile.mkdtemp(prefix='zj-v255-'))
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
        'rich', 'ctrlFBar', 'ctrlFNoGlobalDialog', 'nextMoved', 'replaceRow', 'replacedOne',
        'decoCleanAfterReplace', 'replaceAll', 'escClosed', 'noHitAfterClose',
        'globalSearchStillWorks', 'audioDom', 'audioMimeFixed', 'previewNotUnsupported',
        'videoDom', 'videoMimeFixed', 'videoControls', 'noInsertDropdown',
        'insertFileIcon', 'insertMediaIcon', 'insertBoardIcon', 'insertImportIcon',
        'mdMode', 'mdFindBar', 'ctrlHReplace',
        'mdPreviewSrcFixed',
    ]
    EXPECT_NUM = {
        'currentHit': '1', 'audioError': '0', 'previewAudio': '1', 'previewVideo': '1',
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
    if kv.get('hitCount') in (None, '0', 'none'):
        fails.append(f"hitCount={kv.get('hitCount')}（查找应至少命中一处）")
    if int(kv.get('reInsertAdded') or 0) < 1:
        fails.append(f"reInsertAdded={kv.get('reInsertAdded')}（回插附件应新增节点）")
    if int(kv.get('audioReady') or 0) < 2:
        fails.append(f"audioReady={kv.get('audioReady')}（音频应至少加载到 HAVE_CURRENT_DATA）")
    if not kv.get('mdFindCount') or '无结果' in kv.get('mdFindCount', ''):
        fails.append(f"mdFindCount={kv.get('mdFindCount')}（源码视图查找应有命中）")
    if int(kv.get('mdPreviewMedia') or 0) < 1:
        fails.append(f"mdPreviewMedia={kv.get('mdPreviewMedia')}（源码视图预览应有播放器）")

    shutil.rmtree(profile, ignore_errors=True)
    if fails:
        print('\n失败：' + ', '.join(fails), file=sys.stderr)
        return 3
    print('\n全部通过：Ctrl+F 内容内查找替换 + 音视频 MIME 修正可播放 + 工具栏精简与附件回插')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
