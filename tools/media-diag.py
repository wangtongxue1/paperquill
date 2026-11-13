#!/usr/bin/env python3
"""诊断：视频 / 语音上传后为什么不能播放（临时探针，不进回归套件）。

用法：python tools/make_singlefile.py .temp/zhijian-probe.html && python tools/media-diag.py
"""
import pathlib, re, shutil, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / '.temp' / 'zhijian-probe.html'
OUT = ROOT / '.temp' / 'zhijian-media-diag.html'
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
  const rows = () => Array.from(document.querySelectorAll('.note-row, .note-card'));
  const byText = (sel, text) => Array.from(document.querySelectorAll(sel)).find((e) => (e.textContent || '').includes(text));

  // 生成一个真实可播的 WAV（8kHz / 8bit / mono / 0.4 秒正弦）
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
    if (!input) { push('noFileInput', 1); return; }
    const dt = new DataTransfer(); dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(900);
  };
  const media = () => document.querySelector('.ProseMirror video, .ProseMirror audio');
  const info = (el) => el ? {
    tag: el.tagName, head: (el.getAttribute('src') || '').slice(0, 48),
    controls: el.hasAttribute('controls'), ce: el.getAttribute('contenteditable'),
    ready: el.readyState, err: el.error ? el.error.code : 0,
    dur: Number.isFinite(el.duration) ? Math.round(el.duration * 100) / 100 : 'NaN',
    net: el.networkState, paused: el.paused,
  } : null;

  try {
    await until(() => document.querySelector('.nav-row'));
    byText('.nav-row', '全部笔记')?.click();
    await until(() => document.querySelector('.note-row, .note-card'));
    await wait(400);
    push('rows', rows().length);
    (rows().find((x) => (x.textContent || '').includes('双模式')) || rows()[0])?.click();
    await until(() => document.querySelector('.editor'));
    await wait(600);
    const pill0 = document.querySelector('.mode-pill');
    if (pill0 && pill0.textContent.includes('源码')) { pill0.click(); await wait(900); }
    push('rich', !!document.querySelector('.ProseMirror'));
    push('fileInputCount', document.querySelectorAll('input[type="file"][multiple]').length);

    const wav = makeWav();

    /* A. 正常 mime 的音频 */
    await upload(new File([wav], 'probe.wav', { type: 'audio/wav' }));
    const a = media();
    push('A_dom', a ? a.tagName : 'none');
    push('A_info', JSON.stringify(info(a)));
    if (a) {
      push('A_canPlay', a.canPlayType('audio/wav'));
      try { await a.play(); await wait(350); push('A_played', !a.paused && a.currentTime > 0); }
      catch (e) { push('A_playErr', String(e && e.name || e)); }
      push('A_after', JSON.stringify(info(a)));
    }

    /* B. mime 为空（Windows 上 .mp3/.m4a/.amr 常见） */
    await upload(new File([wav], 'probe2.mp3', { type: '' }));
    const bs = Array.from(document.querySelectorAll('.ProseMirror video, .ProseMirror audio'));
    const b = bs[bs.length - 1];
    push('B_dom', b ? b.tagName : 'none');
    push('B_info', JSON.stringify(info(b)));
    const attNames = Array.from(document.querySelectorAll('.attachments .attachment span')).map((x) => x.textContent);
    push('B_atts', JSON.stringify(attNames));
    // 点附件图标看预览弹窗里是否有播放器
    const icon = Array.from(document.querySelectorAll('.attachments .attachment'))
      .find((x) => (x.textContent || '').includes('probe2.mp3'))?.querySelector('.attachment__file');
    icon?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(450);
    push('B_previewAudio', document.querySelectorAll('.modal audio, .preview-audio').length);
    push('B_previewVideo', document.querySelectorAll('.modal video, .preview-video').length);
    push('B_unsupported', !!byText('.modal', '不支持内嵌预览'));
    byText('.modal button', '关闭')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(200);

    /* C. 正常 mime 的视频（假字节，只看 DOM / 报错） */
    await upload(new File([new Uint8Array([0, 1, 2, 3, 4, 5])], 'probe.mp4', { type: 'video/mp4' }));
    const vs = Array.from(document.querySelectorAll('.ProseMirror video'));
    const c = vs[vs.length - 1];
    push('C_dom', c ? c.tagName : 'none');
    push('C_info', JSON.stringify(info(c)));
    if (c) push('C_canPlay', c.canPlayType('video/mp4'));

    /* D. mime 为空的视频 */
    await upload(new File([new Uint8Array([0, 1, 2, 3, 4, 5])], 'probe2.mkv', { type: '' }));
    const vs2 = Array.from(document.querySelectorAll('.ProseMirror video, .ProseMirror audio'));
    push('D_dom', vs2.length ? vs2[vs2.length - 1].tagName : 'none');
    push('D_info', JSON.stringify(info(vs2[vs2.length - 1])));

    push('done', 1);
  } catch (e) {
    push('error', String((e && e.stack) || e).slice(0, 400));
  }
  const pre = document.createElement('pre');
  pre.id = 'probe'; pre.textContent = log.join('\n');
  document.body.appendChild(pre);
})();
</script>
"""


def main() -> int:
    if not SRC.exists():
        print('缺少单文件构建', file=sys.stderr); return 1
    html = SRC.read_text(encoding='utf-8')
    i = html.rfind('</body>')
    OUT.write_text(html[:i] + PROBE + html[i:], encoding='utf-8')
    profile = pathlib.Path(tempfile.mkdtemp(prefix='zj-media-'))
    args = [EDGE, '--headless=new', '--disable-gpu', '--no-sandbox', '--window-size=1440,960',
            '--allow-file-access-from-files', f'--user-data-dir={profile}',
            '--virtual-time-budget=60000', '--dump-dom', OUT.as_uri()]
    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         text=True, encoding='utf-8', errors='replace')
    try:
        dom, _ = p.communicate(timeout=180)
    except subprocess.TimeoutExpired:
        p.kill(); dom, _ = p.communicate()
    m = re.search(r'<pre id="probe">(.*?)</pre>', dom or '', re.S)
    if not m:
        print('探针无输出：\n' + (dom or '')[:600], file=sys.stderr); return 2
    text = m.group(1).replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    print(text)
    shutil.rmtree(profile, ignore_errors=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
