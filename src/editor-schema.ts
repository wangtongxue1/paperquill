/** 编辑器内核配置：Tiptap（ProseMirror）扩展清单。
 *
 *  参考的是 Obsidian / Notion / Joplin 富文本那一路做法——正文交给一个
 *  有 schema 的编辑器内核管，而不是自己拿 contenteditable 拼字符串：
 *    · 回车、退格、Tab、粘贴全由内核按文档结构处理，不会「拆坏」列表；
 *    · 待办勾选是节点属性（data-checked），点一下就写进文档模型；
 *    · 撤销重做有完整历史栈，不是浏览器的 execCommand 黑洞。
 *
 *  这份配置同时被编辑器组件和断言脚本引用，测的就是线上那一套。
 */
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Link from '@tiptap/extension-link';
import CodeBlock from '@tiptap/extension-code-block';
import { Node, Extension, InputRule, Mark, mergeAttributes, type Extensions } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { normalizeMediaUrl, fileKindOf, fileBadgeLabel, FILE_KIND_COLORS } from './media';
import { formatSize } from './utils';
import type { FindRange } from './find';

/** 正文链接：把内链与附件链接排除掉，免得一个 <a> 被三种标记同时抢。 */
const PlainLink = Link.extend({
  parseHTML() {
    return [{ tag: 'a[href]:not([data-wiki]):not([data-att-id])' }];
  },
});

/** 笔记内链 [[标题]]：保留 data-wiki，导出与切回 Markdown 时才不丢语义。 */
const WikiLink = Mark.create({
  name: 'wikiLink',
  priority: 60,
  inclusive: false,
  parseHTML() {
    return [{ tag: 'a[data-wiki]' }];
  },
  addAttributes() {
    return {
      wiki: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-wiki'),
        renderHTML: (attrs) => (attrs.wiki ? { 'data-wiki': attrs.wiki } : {}),
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { class: 'wikilink', href: '#' }), 0];
  },
});

/** 附件链接：指向附件区里的文件，点击走预览弹窗而不是外链。
 *  2.5.8：额外记住文件类型 / 名称 / 徽标文字，正文里不再一律显示「📎」。
 *  老存档没有这些属性时，parseHTML 会按链接文字（就是文件名）反推，不用迁移。 */
const AttachmentLink = Mark.create({
  name: 'attachmentLink',
  priority: 60,
  inclusive: false,
  parseHTML() {
    return [{ tag: 'a[data-att-id]' }];
  },
  addAttributes() {
    return {
      attId: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-att-id'),
        renderHTML: (attrs) => (attrs.attId ? { 'data-att-id': attrs.attId } : {}),
      },
      href: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('href'),
        renderHTML: (attrs) => (attrs.href ? { href: attrs.href } : {}),
      },
      name: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-att-name') || el.textContent || '',
        renderHTML: (attrs) => (attrs.name ? { 'data-att-name': attrs.name } : {}),
      },
      kind: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-att-kind')
          || fileKindOf(el.getAttribute('data-att-name') || el.textContent || ''),
        renderHTML: (attrs) => (attrs.kind ? { 'data-att-kind': attrs.kind } : {}),
      },
      label: {
        default: null,
        parseHTML: (el) => {
          const n = el.getAttribute('data-att-name') || el.textContent || '';
          return el.getAttribute('data-att-label') || fileBadgeLabel(n, fileKindOf(n));
        },
        renderHTML: (attrs) => (attrs.label ? { 'data-att-label': attrs.label } : {}),
      },
    };
  },
  renderHTML({ mark, HTMLAttributes }) {
    const name = String(mark.attrs.name || '');
    const kind = String(mark.attrs.kind || fileKindOf(name));
    const label = String(mark.attrs.label || fileBadgeLabel(name, fileKindOf(name)));
    return ['a', mergeAttributes(HTMLAttributes, {
      download: '', 'data-att-kind': kind, 'data-att-label': label, 'data-att-name': name,
    }), 0];
  },
});

/** 代码块带语言：data-lang 与 Tiptap 的 language-x 类名互转。 */
const CodeBlockLang = CodeBlock.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      lang: {
        default: null,
        parseHTML: (el) => {
          const attr = el.getAttribute('data-lang');
          if (attr) return attr;
          const cls = el.querySelector('code')?.className || '';
          return cls.match(/language-([\w-]+)/)?.[1] || null;
        },
        renderHTML: (attrs) => (attrs.lang ? { 'data-lang': attrs.lang } : {}),
      },
    };
  },
});

/** 图片：除了 src/alt 还要记住附件 id、显示宽度与对齐方式。 */
const AttachedImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      attId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-att-id'),
        renderHTML: (attrs) => (attrs.attId ? { 'data-att-id': attrs.attId } : {}),
      },
      /** 画板快照：双击图片回到画板继续改。 */
      boardId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-board-id'),
        renderHTML: (attrs) => (attrs.boardId ? { 'data-board-id': attrs.boardId } : {}),
      },
      width: {
        default: null,
        parseHTML: (el) => {
          const m = (el.style?.width || '').match(/^([\d.]+%)$/);
          return m ? m[1] : null;
        },
        renderHTML: () => ({}),
      },
      align: {
        default: null,
        parseHTML: (el) => {
          const s = el.style;
          if (!s) return 'inline';
          if (s.display === 'block' && s.marginLeft === 'auto' && s.marginRight === 'auto') return 'center';
          if (s.display === 'block' && s.marginLeft === 'auto') return 'right';
          if (s.display === 'block') return 'left';
          return 'inline';
        },
        renderHTML: () => ({}),
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const width = node.attrs.width as string | null;
    const align = (node.attrs.align as string | null) || 'inline';
    const style: string[] = [];
    if (width) style.push(`width:${width}`);
    if (align === 'center') style.push('display:block', 'margin-left:auto', 'margin-right:auto');
    else if (align === 'right') style.push('display:block', 'margin-left:auto', 'margin-right:0');
    else if (align === 'left') style.push('display:block', 'margin-left:0', 'margin-right:auto');
    return ['img', mergeAttributes(HTMLAttributes, style.length ? { style: style.join(';') } : {})];
  },
});

/** 行首快捷语法：`[]` / `[ ]` / `[x]` 再加空格 → 直接变成检查清单（Obsidian 手感的子集）。
 *  Tiptap 自带的输入规则已经覆盖 # / - / 1. / > / ``` / ---。 */
const TaskShortcut = Extension.create({
  name: 'taskShortcut',
  addInputRules() {
    const make = (find: RegExp, checked: boolean) => new InputRule({
      find,
      handler: ({ range, chain }) => {
        chain().deleteRange(range).toggleTaskList();
        if (checked) chain().updateAttributes('taskItem', { checked: true });
        chain().run();
      },
    });
    return [
      make(/^\[\]\s$/, false),
      make(/^\[ \]\s$/, false),
      make(/^\[x\]\s$/i, true),
      // 兼容 Obsidian 的 `- [ ] ` 写法
      make(/^\s*[-+*]\s\[\]\s$/, false),
      make(/^\s*[-+*]\s\[ \]\s$/, false),
      make(/^\s*[-+*]\s\[x\]\s$/i, true),
    ];
  },
});

/** 插入的时间戳：一个不可拆开的行内节点。
 *  做成节点而不是普通文字，是为了让它有独立样式（品牌色 + 加粗），
 *  切 Markdown 时也能还原成 <time data-time>。 */
const InsertedTime = Node.create({
  name: 'insertedTime',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      value: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-time') || el.getAttribute('datetime') || el.textContent || '',
        renderHTML: (attrs) => ({ 'data-time': attrs.value }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'time[data-time]' }, { tag: 'time' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['time', mergeAttributes(HTMLAttributes, { class: 'ins-time' }), node.attrs.value as string];
  },
});

/** 语音 / 视频：整块插入带原生控件的播放器。
 *  和图片一样带 data-att-id，附件区能对上号，正文删掉后附件会被回收。 */
const MediaBlock = Node.create({
  name: 'mediaBlock',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: {
        default: null,
        // 旧存档里可能存成了 data:application/octet-stream;base64,…，
        // 解析 / 渲染时按文件名补全 MIME，老附件也能直接播。
        parseHTML: (el) => normalizeMediaUrl(el.getAttribute('src') || '', el.getAttribute('data-name') || ''),
        renderHTML: (attrs) => (attrs.src ? { src: attrs.src } : {}),
      },
      kind: {
        default: 'video',
        parseHTML: (el) => (el.tagName === 'AUDIO' ? 'audio' : 'video'),
        renderHTML: () => ({}),
      },
      attId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-att-id'),
        renderHTML: (attrs) => (attrs.attId ? { 'data-att-id': attrs.attId } : {}),
      },
      name: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-name') || '',
        renderHTML: (attrs) => (attrs.name ? { 'data-name': attrs.name } : {}),
      },
      /** 2.5.8：视频默认只占编辑区 60%，不再一插进来就铺满整屏。 */
      width: {
        default: null,
        parseHTML: (el) => {
          const m = (el.style?.width || '').match(/^([\d.]+%)$/);
          return m ? m[1] : null;
        },
        renderHTML: () => ({}),
      },
      align: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-media-align') || null,
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'video' }, { tag: 'audio' }];
  },
  renderHTML({ node }) {
    const isAudio = node.attrs.kind === 'audio';
    const width = typeof node.attrs.width === 'string' && node.attrs.width
      ? node.attrs.width : (isAudio ? '100%' : '60%');
    const align = (node.attrs.align as string | null) || 'center';
    const margin = align === 'center' ? ['margin-left:auto', 'margin-right:auto']
      : align === 'right' ? ['margin-left:auto', 'margin-right:0']
      : ['margin-left:0', 'margin-right:auto'];
    const style = [`width:${width}`, 'max-width:100%', 'display:block', ...margin].join(';');
    const attrs: Record<string, string> = {
      controls: 'controls',
      preload: 'metadata',
      playsinline: 'playsinline',
      src: normalizeMediaUrl(String(node.attrs.src || ''), String(node.attrs.name || '')),
      style,
      'data-media-width': width,
      'data-media-align': align,
    };
    if (node.attrs.attId) attrs['data-att-id'] = String(node.attrs.attId);
    if (node.attrs.name) attrs['data-name'] = String(node.attrs.name);
    return [isAudio ? 'audio' : 'video', mergeAttributes(attrs)];
  },
});

/** 文件卡片：2.5.8 起新插入的非图片附件走这个块级节点。
 *  用块而不是行内链接，是为了能像图片/视频一样整体居左、居中、居右，
 *  也能把「类型徽标 + 文件名 + 大小 + 预览」排成一行。
 *  老笔记里的 <a data-att-id> 仍由 AttachmentLink 解析，不迁移、不丢引用。 */
const FileCard = Node.create({
  name: 'fileCard',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      attId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-att-id'),
        renderHTML: (attrs) => (attrs.attId ? { 'data-att-id': attrs.attId } : {}),
      },
      name: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-att-name') || el.getAttribute('data-name') || '',
        renderHTML: (attrs) => (attrs.name ? { 'data-att-name': attrs.name } : {}),
      },
      kind: {
        default: 'file',
        parseHTML: (el) => el.getAttribute('data-att-kind')
          || fileKindOf(el.getAttribute('data-att-name') || ''),
        renderHTML: (attrs) => (attrs.kind ? { 'data-att-kind': attrs.kind } : {}),
      },
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-att-label') || '',
        renderHTML: (attrs) => (attrs.label ? { 'data-att-label': attrs.label } : {}),
      },
      mime: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-att-mime') || '',
        renderHTML: (attrs) => (attrs.mime ? { 'data-att-mime': attrs.mime } : {}),
      },
      size: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-att-size') || 0) || 0,
        renderHTML: (attrs) => (attrs.size ? { 'data-att-size': String(attrs.size) } : {}),
      },
      /** 位置：left / center / right。 */
      align: {
        default: 'left',
        parseHTML: (el) => el.getAttribute('data-align') || 'left',
        renderHTML: () => ({}),
      },
      /** 宽度：null = 自适应（默认 100%），或 25% / 50% / 75% 等。 */
      width: {
        default: null,
        parseHTML: (el) => {
          const m = (el.style?.width || '').match(/^([\d.]+%)$/);
          return m ? m[1] : null;
        },
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-file-card]' }];
  },
  renderHTML({ node }) {
    const a = node.attrs;
    const name = String(a.name || '附件');
    const kind = String(a.kind || fileKindOf(name));
    const label = String(a.label || fileBadgeLabel(name, fileKindOf(name)));
    const [fg, bg] = FILE_KIND_COLORS[(kind in FILE_KIND_COLORS ? kind : 'file') as keyof typeof FILE_KIND_COLORS] || FILE_KIND_COLORS.file;
    // 2.5.9：卡片只展示「名称 + 大小」，不再跟一串英文 MIME / 格式说明。
    const meta = a.size ? formatSize(Number(a.size)) : '';
    const align = (String(a.align || 'left'));
    const style = a.width ? `width:${a.width};max-width:100%` : '';
    return ['div', mergeAttributes({
      class: 'attach-card',
      'data-file-card': '',
      'data-att-id': String(a.attId || ''),
      'data-att-name': name,
      'data-att-kind': kind,
      'data-att-label': label,
      'data-att-mime': String(a.mime || ''),
      'data-att-size': String(a.size || 0),
      'data-align': align,
      'data-width': a.width ? String(a.width) : 'auto',
      style,
    }),
      ['span', { class: 'attach-card__badge', style: `color:${fg};background:${bg}` }, label],
      ['span', { class: 'attach-card__name' }, name],
      ['span', { class: 'attach-card__meta' }, meta],
      ['span', { class: 'attach-card__act' }, '预览'],
    ];
  },
});

/* ---------- 编辑器内查找：所有命中的视图层高亮 ---------- */

export const FIND_META = 'zhijianFindRanges';
interface FindDecoState { decos: DecorationSet }
const findKey = new PluginKey<FindDecoState>('zhijianFind');

const FindHighlight = Extension.create({
  name: 'findHighlight',
  addProseMirrorPlugins() {
    return [new Plugin<FindDecoState>({
      key: findKey,
      state: {
        init: () => ({ decos: DecorationSet.empty }),
        apply(tr, prev) {
          const meta = tr.getMeta(FIND_META) as { ranges: FindRange[]; active: number } | undefined;
          if (meta) {
            const list = meta.ranges
              .map((r, i) => ({ r, i }))
              .sort((a, b) => a.r.from - b.r.from)
              .map(({ r, i }) => Decoration.inline(r.from, r.to, {
                class: i === meta.active ? 'find-hit is-current' : 'find-hit',
              }));
            return { decos: DecorationSet.create(tr.doc, list) };
          }
          if (tr.docChanged) return { decos: prev.decos.map(tr.mapping, tr.doc) };
          return prev;
        },
      },
      props: {
        decorations(state) { return findKey.getState(state)?.decos ?? DecorationSet.empty; },
      },
    })];
  },
});

export function buildExtensions(placeholder = ''): Extensions {
  return [
    StarterKit.configure({
      // 标题支持 1–6 级（Markdown 的 # ~ ###### 全都能落地，不再截到 3 级）
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      codeBlock: false,
      link: false,
      // 列表用 Tiptap 自带的，待办单独加
      bulletList: { keepMarks: true, keepAttributes: false },
      orderedList: { keepMarks: true, keepAttributes: false },
    }),
    PlainLink.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: { rel: 'noopener noreferrer', class: 'ext-link' },
    }),
    WikiLink,
    AttachmentLink,
    InsertedTime,
    MediaBlock,
    FileCard,
    CodeBlockLang,
    TaskList,
    // nested: false —— 不做多层缩进待办，换来的是结构永远不会被缩进搞乱
    TaskItem.configure({ nested: false }),
    // 列宽可拖拽（columnResizing 会把 colwidth 写进单元格属性并持久化）。
    // cellMinWidth 给个合理下限，免得拖成一像素；配合 CSS 的 table-layout: fixed，
    // 单元格里塞图片 / 时间戳也不会把别的列挤成一条缝、或把整张表撑出编辑区。
    Table.configure({ resizable: true, handleWidth: 6, cellMinWidth: 48, lastColumnResizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    AttachedImage.configure({ inline: false, allowBase64: true }),
    TextAlign.configure({ types: ['heading', 'paragraph', 'image'] }),
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Subscript,
    Superscript,
    TaskShortcut,
    Placeholder.configure({ placeholder }),
    FindHighlight,
  ];
}

export const CODE_LANGS = [
  '', 'javascript', 'typescript', 'python', 'java', 'go', 'rust', 'sql', 'bash', 'json', 'html', 'css',
];
