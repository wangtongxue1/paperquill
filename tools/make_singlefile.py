#!/usr/bin/env python3
"""把 dist/ 里的 JS 与 CSS 内联进一个 HTML，产出可双击、离线可用的单文件版本。

为什么需要这一步：Vite 默认产出 ES module，Chrome/Edge 在 file:// 下会因为
CORS 拒绝加载 module script，双击 index.html 会白屏。构建配置已改成 IIFE 单
chunk，这里再把资源内联，就没有任何跨文件请求了。

用法：python tools/make_singlefile.py [输出路径]
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
DIST = ROOT / 'dist'
DEFAULT_OUT = ROOT.parent / 'output' / 'zhijian' / '纸间笔记-离线版.html'


def main() -> int:
    index = DIST / 'index.html'
    js = DIST / 'assets' / 'zhijian.js'
    css = DIST / 'assets' / 'zhijian.css'  # IIFE 模式下 Vite 会把 CSS 注入 JS，这个文件可以不存在
    for f in (index, js):
        if not f.exists():
            print(f'缺少构建产物：{f}\n请先运行 pnpm build', file=sys.stderr)
            return 1

    html = index.read_text(encoding='utf-8')
    js_text = js.read_text(encoding='utf-8').replace('</script', '<\\/script')

    # type="module" 在 file:// 下会被 CORS 拦掉；产物本身已是 IIFE，换成普通 script。
    # 关键：普通 script 是同步执行的，必须放到 </body> 前，否则执行时 #root 还没解析，
    # createRoot 会抛 React #299（单文件版第一次做出来就是白屏在这里）。
    html, n_js = re.subn(r'<script[^>]*src="[^"]*zhijian\.js"[^>]*>\s*</script>', '', html)
    script_block = '<script>\n' + js_text + '\n</script>'
    if '</body>' in html:
        html = html.replace('</body>', script_block + '\n  </body>', 1)
    else:
        html += script_block
    if css.exists():
        css_text = css.read_text(encoding='utf-8')
        html = re.sub(
            r'<link[^>]*href="[^"]*zhijian\.css"[^>]*/?>',
            lambda _m: '<style>\n' + css_text + '\n</style>',
            html,
        )
    if n_js != 1:
        print(f'内联失败：script 命中 {n_js} 次', file=sys.stderr)
        return 1

    # 移走 modulepreload（单文件里没有第二个 chunk 要预载）
    html = re.sub(r'<link[^>]*rel="modulepreload"[^>]*/?>', '', html)
    html = html.replace('<title>纸间笔记 · 个人笔记</title>',
                        '<title>纸间笔记 · 个人笔记（离线单文件版）</title>')

    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding='utf-8')
    print(f'已生成 {out}（{out.stat().st_size:,} 字节）')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
