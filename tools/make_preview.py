#!/usr/bin/env python3
"""给交付目录生成界面截图（不需要手动开窗口）。

做法：把单文件版复制一份，末尾注入一段「点开全部笔记 → 打开一篇 → 切到富文本」
的小脚本，再让 Edge headless 在虚拟时间跑完后截图。

用法：python tools/make_preview.py [输出 png] [light|dark]
前置：python tools/make_singlefile.py .temp/zhijian-probe.html
"""

import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / '.temp' / 'zhijian-probe.html'
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / 'output' / 'zhijian' / '界面预览.png'
THEME = sys.argv[2] if len(sys.argv) > 2 else 'light'
OUT = OUT.resolve()
EDGE = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

SCRIPT = """
<script>
(async () => {
  const THEME = '__THEME__';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const byText = (sel, t) => Array.from(document.querySelectorAll(sel)).find((e) => (e.textContent || '').includes(t));
  await wait(200);
  byText('.nav-row', '全部笔记')?.click();
  await wait(350);
  const rows = Array.from(document.querySelectorAll('.note-row, .note-card'));
  const pick = rows.find((r) => (r.textContent || '').includes('读书笔记')) || rows[0];
  pick?.click();
  await wait(350);
  const pill = document.querySelector('.mode-pill');
  if (pill && pill.textContent.includes('源码')) { pill.click(); await wait(450); }
  document.querySelector('.editor__title')?.blur();
  // 滚到「可以用在哪」那组待办，让截图里能看清勾选/未勾选的样式
  const rich = document.querySelector('.editor__rich');
  if (rich) {
    const t = Array.from(rich.querySelectorAll('h2')).find((h) => (h.textContent || '').includes('可以用在哪'));
    if (t) rich.scrollTop += t.getBoundingClientRect().top - rich.getBoundingClientRect().top - rich.clientHeight * 0.55;
  }
  if (THEME === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    await wait(120);
  }
  await wait(250);
})();
</script>
"""


def main() -> int:
    if not SRC.exists():
        print(f'缺少 {SRC}', file=sys.stderr)
        return 1
    html = SRC.read_text(encoding='utf-8')
    i = html.rfind('</body>')
    demo = ROOT / '.temp' / 'zhijian-preview.html'
    demo.write_text(html[:i] + SCRIPT.replace('__THEME__', THEME) + html[i:], encoding='utf-8')

    OUT.parent.mkdir(parents=True, exist_ok=True)
    profile = pathlib.Path(tempfile.gettempdir()) / 'zhijian-edge-shot'
    res = subprocess.run([
        EDGE, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--allow-file-access-from-files', f'--user-data-dir={profile}',
        '--window-size=1440,900', '--virtual-time-budget=6000',
        f'--screenshot={OUT}', demo.as_uri(),
    ], capture_output=True, text=True, encoding='utf-8', errors='replace')
    if not OUT.exists():
        print('截图失败：\n' + (res.stderr or '')[:800], file=sys.stderr)
        return 2
    print(f'已生成 {OUT}（{OUT.stat().st_size:,} 字节）')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
