import { marked } from 'marked';
import DOMPurify from 'dompurify';
import TurndownService from 'turndown';
import type { Attachment, EditorMode } from './types';
import { escapeHtml } from './utils';
import { fileBadgeLabel, fileKindOf } from './media';

marked.setOptions({ gfm: true, breaks: true });

/** 正文里图片 / 附件不塞 base64，只写短引用；渲染、导出、落盘镜像时再还原。
 *  参考 Obsidian 的 ![[image.png]] 思路，源码保持可读。 */
export const ATTACHMENT_SCHEME = 'zhijian-attachment:';
export const attachmentRef = (id: string) => `${ATTACHMENT_SCHEME}${id}`;

const ATTACHMENT_RE = /zhijian-attachment:([A-Za-z0-9_-]+)/g;

/** 从正文里数出所有引用到的附件 id（短引用 + data-att-id 两种写法）。
 *  编辑器用它做「正文里删掉了图，附件也一起回收」的判断。 */
export function referencedAttachmentIds(content: string, mode: EditorMode = 'rich'): Set<string> {
  const out = new Set<string>();
  if (!content) return out;
  for (const m of content.matchAll(ATTACHMENT_RE)) out.add(m[1]);
  if (mode === 'rich') {
    for (const m of content.matchAll(/data-att-id=["']([A-Za-z0-9_-]+)["']/g)) out.add(m[1]);
  }
  return out;
}

/** 把短引用还原成自包含的 data URL（导出、镜像、预览都走这里）。 */
export function resolveAttachmentRefs(content: string, attachments: Attachment[] = []): string {
  if (!attachments.length) return content;
  const map = new Map(attachments.map((a) => [a.id, a.dataUrl]));
  return content.replace(ATTACHMENT_RE, (m, id: string) => map.get(id) || m);
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  hr: '---',
});

// htmlToMd 是同步的，用模块级变量把附件表传给规则回调，避免全局注册表。
let currentAttachments: Attachment[] = [];

// 内链：富文本里的 <a data-wiki> 转回 [[标题]]，避免切换一次模式就丢语义。
turndown.addRule('wikilink', {
  filter: (node) => node.nodeName === 'A' && (node as HTMLElement).hasAttribute('data-wiki'),
  replacement: (_content, node) => `[[${(node as HTMLElement).getAttribute('data-wiki') || ''}]]`,
});

// 任务列表复选框：turndown 默认会把 input 丢掉，补一条规则保住 - [ ] / - [x]。
turndown.addRule('taskCheckbox', {
  filter: (node) =>
    node.nodeName === 'INPUT' && (node as HTMLInputElement).type === 'checkbox',
  replacement: (_content, node) => ((node as HTMLInputElement).checked ? '[x] ' : '[ ] '),
});

// ---- 2.5.14 补：样式类格式的往返保留 ----
// Markdown 表达不了下划线 / 高亮 / 颜色 / 字号 / 对齐 / 上下标，之前一切源码就全丢。
// 现在：GFM 能表达的（删除线）写成 ~~...~~，表达不了的用 CommonMark 允许的
// 行内 / 块级 HTML 原样带过去，切回富文本由 TipTap 的解析规则认回来。
let inTableCell = false; // 表格单元格走 mdCellText 递归，块级对齐包装不进格子（列对齐已由分隔行表达）

const KEEP_STYLE_PROPS = ['color', 'font-size', 'font-family', 'background-color'];

// 删除线：GFM 标准写法。
turndown.addRule('strikeThrough', {
  filter: (node) => ['S', 'DEL', 'STRIKE'].includes(node.nodeName),
  replacement: (content) => `~~${content.trim()}~~`,
});

// 下划线 / 上下标：Markdown 没有对应语法，保留原标签。
turndown.addRule('keepInlineTag', {
  filter: ['u', 'sub', 'sup'],
  replacement: (content, node) => {
    const tag = node.nodeName.toLowerCase();
    return `<${tag}>${content.trim()}</${tag}>`;
  },
});

// 高亮：TipTap 认 data-color 或 style 里的 background-color，写 style 就够了。
turndown.addRule('keepHighlight', {
  filter: (node) => node.nodeName === 'MARK',
  replacement: (content, node) => {
    const el = node as HTMLElement;
    const color = el.getAttribute('data-color') || el.style.backgroundColor || '';
    return color
      ? `<mark style="background-color: ${color}">${content.trim()}</mark>`
      : `<mark>${content.trim()}</mark>`;
  },
});

// 文字颜色 / 字号 / 字体：span 只挑这几个可往返的属性带走，别把编辑器内部样式带进源码。
turndown.addRule('keepTextStyle', {
  filter: (node) =>
    node.nodeName === 'SPAN' &&
    KEEP_STYLE_PROPS.some((k) => ((node as HTMLElement).getAttribute('style') || '').toLowerCase().includes(k)),
  replacement: (content, node) => {
    const el = node as HTMLElement;
    const kept = (el.getAttribute('style') || '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((p) => KEEP_STYLE_PROPS.some((k) => p.toLowerCase().startsWith(k)))
      .join('; ');
    return kept ? `<span style="${kept}">${content.trim()}</span>` : content;
  },
});

const blockAlignOf = (el: HTMLElement) => {
  const a = (el.style.textAlign || '').toLowerCase();
  return a === 'center' || a === 'right' || a === 'justify' ? a : '';
};

// 段落 / 标题的对齐：Markdown 无法给块级元素带样式，包一层带 data-block-align 的 div，
// mdToHtml 里再解包成 <p style="text-align:...">。列表 / 引用 / 表格里不动（会破坏容器结构）。
turndown.addRule('keepBlockAlign', {
  filter: (node) => {
    if (inTableCell) return false;
    if (!/^(P|H1|H2|H3|H4|H5|H6)$/.test(node.nodeName)) return false;
    if ((node as HTMLElement).closest?.('blockquote, ol, ul')) return false;
    return !!blockAlignOf(node as HTMLElement);
  },
  replacement: (content, node) => {
    const el = node as HTMLElement;
    const align = blockAlignOf(el);
    const text = content.trim();
    if (!text) return '';
    // 标题的对齐不能丢级别：把 #/## 补回来，切回富文本还是 h1-h6。
    const m = el.nodeName.match(/^H([1-6])$/);
    const body = m ? `${'#'.repeat(Number(m[1]))} ${text}` : text;
    return `\n\n<div data-block-align="${align}">\n\n${body}\n\n</div>\n\n`;
  },
});

// 图片：带 data-att-id 或能反查到附件的，一律写回短引用，不把 base64 灌进源码。
// 设了宽度 / 块级对齐的图片 Markdown 表达不了，改用 <img> 原样带走（src 仍用短引用）。
turndown.addRule('attachmentImage', {
  filter: (node) => node.nodeName === 'IMG',
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const alt = el.getAttribute('alt') || '';
    const src = el.getAttribute('src') || '';
    const id =
      el.getAttribute('data-att-id') ||
      currentAttachments.find((a) => a.dataUrl === src)?.id;
    const url = id ? attachmentRef(id) : src;
    const width = (el.style?.width || '').match(/^[\d.]+%$/)?.[0] || '';
    const display = el.style?.display || '';
    const ml = el.style?.marginLeft || '';
    const mr = el.style?.marginRight || '';
    const isBlock = display === 'block';
    const alignStyle =
      isBlock && ml === 'auto' && mr === 'auto' ? 'display:block;margin-left:auto;margin-right:auto'
      : isBlock && ml === 'auto' ? 'display:block;margin-left:auto;margin-right:0'
      : isBlock ? 'display:block;margin-left:0;margin-right:auto'
      : '';
    if (width || alignStyle) {
      const attrs = [
        `src="${url}"`,
        alt ? `alt="${alt.replace(/"/g, '&quot;')}"` : '',
        id && id !== src ? `data-att-id="${id}"` : '',
        [alignStyle, width ? `width:${width}` : ''].filter(Boolean).join(';')
          ? `style="${[alignStyle, width ? `width:${width}` : ''].filter(Boolean).join(';')}"`
          : '',
      ].filter(Boolean).join(' ');
      return `<img ${attrs}>`;
    }
    return `![${alt}](${url})`;
  },
});

// 文件附件：富文本里的 <a data-att-id download> 也写回短引用。
turndown.addRule('attachmentLink', {
  filter: (node) =>
    node.nodeName === 'A' && (node as HTMLElement).hasAttribute('data-att-id'),
  replacement: (content, node) => {
    const id = (node as HTMLElement).getAttribute('data-att-id') || '';
    return `[${content}](${attachmentRef(id)})`;
  },
});

// 2.5.8：富文本里的文件卡片切回 Markdown 时写回同一条短引用，
// 徽标 / 大小这些纯展示内容不进源码，来回切换不会越切越脏。
turndown.addRule('attachmentCard', {
  filter: (node) =>
    node.nodeName === 'DIV' && (node as HTMLElement).hasAttribute('data-file-card'),
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const id = el.getAttribute('data-att-id') || '';
    const name = el.getAttribute('data-att-name') || el.querySelector('.attach-card__name')?.textContent || '附件';
    return `\n\n[${name}](${attachmentRef(id)})\n\n`;
  },
});

// 音视频 / 插入时间：turndown 默认会把它们压成空文本，这里原样保留标签，
// 切到源码视图还能看见，切回富文本也认得出来。
turndown.addRule('mediaBlock', {
  filter: (node) => /^(VIDEO|AUDIO)$/.test(node.nodeName),
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const src = el.getAttribute('src') || '';
    const attId = el.getAttribute('data-att-id') || '';
    const url = attId ? attachmentRef(attId) : src;
    const tag = el.nodeName.toLowerCase();
    const extra = tag === 'video' ? ' controls' : ' controls';
    return `\n\n<${tag}${extra} src="${url}"${attId ? ` data-att-id="${attId}"` : ''}></${tag}>\n\n`;
  },
});

turndown.addRule('insertedTime', {
  filter: (node) => node.nodeName === 'TIME',
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const v = el.getAttribute('data-time') || el.getAttribute('datetime') || el.textContent || '';
    return `<time data-time="${v}">${el.textContent || v}</time>`;
  },
});

// 代码块：保留 data-lang，切回 Markdown 时写成 ```js 而不是丢掉语言。
turndown.addRule('fencedCodeLang', {
  filter: (node) => node.nodeName === 'PRE',
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const lang = el.getAttribute('data-lang') || '';
    const code = el.querySelector('code')?.textContent ?? el.textContent ?? '';
    return `\n\n\`\`\`${lang}\n${code.replace(/\n$/, '')}\n\`\`\`\n\n`;
  },
});

// GFM 表格：turndown 默认完全不认识 <table>，整张表会被拆成裸段落。
// 这里在 TABLE 层统一重建管道表：单元格文本递归交给 turndown（保住加粗/链接/图片），
// 管道转义、列数补齐（跨列/缺列）、表头对齐（:--- / :---: / ---:）都还原。
function mdCellText(el: HTMLElement): string {
  inTableCell = true;
  try {
    return turndown.turndown(el.innerHTML.trim()).replace(/\s*\n\s*/g, ' ').trim();
  } catch {
    return (el.textContent || '').replace(/\s*\n\s*/g, ' ').trim();
  } finally {
    inTableCell = false;
  }
}

function cellAlign(el: HTMLElement): string {
  const a = (el.getAttribute('align') || el.style.textAlign || '').toLowerCase();
  if (a === 'center') return ':---:';
  if (a === 'right' || a === 'end') return '---:';
  if (a === 'left' || a === 'start') return ':---';
  return '---';
}

turndown.addRule('gfmTable', {
  filter: (node) => node.nodeName === 'TABLE',
  replacement: (_content, node) => {
    const table = node as HTMLTableElement;
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return '';
    const grid = rows.map((tr) =>
      Array.from(tr.children)
        .filter((el) => /^(TD|TH)$/.test(el.tagName))
        .map((el) => mdCellText(el as HTMLElement).replace(/\|/g, '\\|'))
    );
    const cols = Math.max(...grid.map((r) => r.length));
    const head = rows[0];
    const headCells = Array.from(head.children).filter((el) => /^(TD|TH)$/.test(el.tagName)) as HTMLElement[];
    const sepCells = Array.from({ length: cols }, (_v, i) => cellAlign(headCells[i] || headCells[headCells.length - 1]));
    const lines = grid.map((r) => {
      const cells = [...r];
      while (cells.length < cols) cells.push('');
      return `| ${cells.join(' | ')} |`;
    });
    // GFM 规定第一行就是表头，分隔行永远插在第一行之后。
    return `\n\n${[lines[0], `| ${sepCells.join(' | ')} |`, ...lines.slice(1)].join('\n')}\n\n`;
  },
});

const PURIFY_OPTIONS = {
  ADD_ATTR: [
    'data-wiki', 'data-att-id', 'data-task-line', 'data-lang', 'data-align', 'data-block-align',
    'target', 'rel', 'class', 'data-time', 'data-board-id', 'datetime',
    'style', 'data-id', 'contenteditable', 'download', 'checked', 'type',
    'controls', 'poster', 'preload', 'playsinline', 'loop', 'muted',
  ],
  ADD_TAGS: ['iframe', 'video', 'audio', 'source', 'time'],
  FORBID_TAGS: ['script', 'object', 'embed', 'form', 'meta', 'link'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'srcdoc'],
};

/** 清洗外部 HTML（剪藏 / 粘贴 / 导入），去掉脚本与事件属性，保留图片、链接与基本排版。 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_OPTIONS) as string;
}

/** [[标题]] 转成可点击的内链标记。先于 marked 处理，且跳过代码块。 */
function renderWikilinks(md: string): string {
  return md
    .split(/(```[\s\S]*?```)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/\[\[([^\]\n]+)\]\]/g, (_m, title: string) => {
            const t = String(title).trim();
            return `<a href="#" class="wikilink" data-wiki="${escapeHtml(t)}">${escapeHtml(t)}</a>`;
          })
    )
    .join('');
}

/** marked 已经把 - [x] 渲染成 <li><input type=checkbox>，
 *  这里只补 class、去掉 disabled 并标上序号，让预览里的复选框可以点击回写源码。
 *  （旧版 renderTasks 想自己替换 [x]，但 marked 早就处理过了，等于没生效。） */
function markTasks(html: string): string {
  // `- [ ]` 后面一个字都没写时，marked 不会认成任务项，会原样留下 `<li>[ ]</li>`，
  // 预览里就出现一个圆点 + 字面的「[]」。先把它补成空复选框，再走下面的通用处理。
  const filled = html.replace(/<li>\s*\[([ xX])\]\s*<\/li>/g,
    (_m, flag: string) => `<li><input type="checkbox"${flag.toLowerCase() === 'x' ? ' checked' : ''}></li>`);
  let index = -1;
  return filled.replace(/<li>\s*<input([^>]*)>/g, (whole, attrs: string) => {
    if (!/type=["']checkbox["']/.test(attrs)) return whole;
    index += 1;
    const clean = attrs
      .replace(/\s+disabled(?:=(?:""|''|disabled))?/gi, '')
      .replace(/\s+checked(?:=(?:""|''|checked))?/gi, (m) => m.toLowerCase().includes('checked') ? ' checked' : '');
    return `<li class="task-item"><input${clean} data-task-line="${index}">`;
  });
}

/** 源码视图的附件只是 `[名字](zhijian-attachment:id)`，marked 出来是普通 <a>。
 *  这里补上 data-att-id / 类型徽标，让预览里的文件链接与富文本的文件卡片长得一样，
 *  点一下也能走同一个预览弹窗；顺带给图片补回 id，切回富文本不会把附件当孤儿回收。 */
function annotateAttachmentNodes(html: string, attachments: Attachment[]): string {
  if (!attachments.length || typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  const byName = new Map(attachments.map((a) => [a.name, a]));
  const byUrl = new Map(attachments.map((a) => [a.dataUrl, a]));
  doc.body.querySelectorAll('a').forEach((a) => {
    const att = byUrl.get(a.getAttribute('href') || '') || byName.get((a.textContent || '').trim());
    if (!att) return;
    const fk = fileKindOf(att.name, att.mime, att.kind);
    a.setAttribute('data-att-id', att.id);
    a.setAttribute('data-att-kind', fk);
    a.setAttribute('data-att-label', fileBadgeLabel(att.name, fk));
    a.setAttribute('data-att-name', att.name);
    a.setAttribute('download', '');
  });
  doc.body.querySelectorAll('img').forEach((img) => {
    const att = byUrl.get(img.getAttribute('src') || '');
    if (att) img.setAttribute('data-att-id', att.id);
  });
  return doc.body.innerHTML;
}

/** 把 htmlToMd 写出的 <div data-block-align> 解包回带 text-align 的段落 / 标题 / 图片，
 *  这样切回富文本时 TipTap 的 TextAlign 规则能直接认回对齐。 */
function resolveAlignDivs(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  doc.body.querySelectorAll('div[data-block-align]').forEach((div) => {
    const align = div.getAttribute('data-block-align') || '';
    for (const kid of Array.from(div.childNodes)) {
      if (kid.nodeType === 1 && /^(P|H[1-6])$/.test((kid as Element).tagName)) {
        (kid as HTMLElement).style.textAlign = align;
      } else if (kid.nodeType === 1 && (kid as Element).tagName === 'IMG') {
        // 图片的块级对齐走它自己的 display/margin 约定（AttachedImage.parseHTML 认这个）。
        const img = kid as HTMLElement;
        if (!img.style.width) img.style.width = 'auto';
        img.style.display = 'block';
        img.style.marginLeft = align === 'right' ? 'auto' : align === 'center' ? 'auto' : '0';
        img.style.marginRight = align === 'left' ? '0' : 'auto';
      } else if (kid.nodeType === 3 && (kid.textContent || '').trim()) {
        const p = doc.createElement('p');
        p.style.textAlign = align;
        kid.replaceWith(p);
        p.appendChild(kid);
      }
    }
    div.replaceWith(...Array.from(div.childNodes));
  });
  return doc.body.innerHTML;
}

export function mdToHtml(md: string, attachments: Attachment[] = []): string {
  // 必须在 marked 之前还原：自定义 scheme 会被 DOMPurify 当成不安全 URI 丢掉。
  const resolved = resolveAttachmentRefs(renderWikilinks(md), attachments);
  const html = marked.parse(resolved, { async: false }) as string;
  return annotateAttachmentNodes(markTasks(resolveAlignDivs(sanitizeHtml(html))), attachments);
}

export function htmlToMd(html: string, attachments: Attachment[] = []): string {
  currentAttachments = attachments;
  try {
    const clean = sanitizeHtml(html);
    // turndown 给列表项的「-   」和复选框后的空格会堆成「-   [x]   文案」，
    // 这里统一收敛成 - [x] 文案，写出来的源码才跟手写的一样。
    return turndown.turndown(clean)
      .replace(/^(\s*)[-*+]\s+\[([ xX])\]\s+/gm, '$1- [$2] ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } finally {
    currentAttachments = [];
  }
}

/** 把笔记内容从一种模式转换成另一种，是「双模式可切换」的唯一转换入口。 */
export function convertContent(
  content: string,
  from: EditorMode,
  to: EditorMode,
  attachments: Attachment[] = []
): string {
  if (from === to) return content;
  return from === 'markdown' ? mdToHtml(content, attachments) : htmlToMd(content, attachments);
}

/** 生成可独立打开的完整 HTML 文档（用于导出、打印成 PDF 与 .html 镜像）。 */
export function standaloneHtml(title: string, bodyHtml: string, meta = '', opts: { print?: boolean } = {}): string {
  const printCss = opts.print
    ? `@page{size:A4;margin:16mm 14mm}
       .meta{margin-bottom:18px}
       img,video{break-inside:avoid;page-break-inside:avoid}
       h1,h2,h3,h4,h5,h6{break-after:avoid;page-break-after:avoid}
       pre,table,blockquote{break-inside:avoid;page-break-inside:avoid}
       a{text-decoration:none}`
    : '';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark}
body{max-width:760px;margin:48px auto;padding:0 24px;font:16px/1.8 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#242824;background:#fff}
img{max-width:100%;height:auto;border-radius:8px}
video{max-width:100%;border-radius:8px}
audio{width:100%}
pre{background:#f4f5f2;padding:14px;border-radius:8px;overflow:auto}
code{font-family:Consolas,monospace;font-size:.92em}
blockquote{border-left:3px solid #2f8f68;margin:0;padding-left:14px;color:#666}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #dfe3dd;padding:8px 12px}
a{color:#1f7a55;font-weight:600;text-decoration:underline;text-underline-offset:2px}
.wikilink{background:#e8f4ee;padding:1px 4px;border-radius:4px;text-decoration:none}
time[data-time]{color:#2f8f68;font-weight:700}
.task-item{list-style:none;margin-left:-20px}.task-item input{margin-right:6px}
.meta{color:#89918a;font-size:13px;margin-bottom:28px;border-bottom:1px solid #e8ebe6;padding-bottom:12px}
@media print{body{max-width:none;margin:0 auto;padding:0}}
${printCss}
</style></head><body>
<div class="meta">${escapeHtml(meta)}</div>
${bodyHtml}
</body></html>`;
}
