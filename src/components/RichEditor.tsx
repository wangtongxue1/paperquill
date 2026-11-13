/** 富文本编辑面板：Tiptap（ProseMirror）内核 + 纸间笔记自己的工具栏。
 *
 *  这一层只负责「把文档模型编辑好」，落盘格式由 tiptap-html.ts 转回纸间笔记的
 *  简单 HTML，编辑内核可以随时替换而不动产出的数据。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import {
  AlignCenter, AlignLeft, AlignRight, Bold, Braces, CalendarClock, ChevronDown, Code2,
  Eraser, Eye, FileInput, Frame, Heading1, Heading2, Heading3, Highlighter, ImagePlus, Italic,
  Link2, List, ListChecks, ListOrdered, Minus, Paperclip, Plus, Quote, Redo2, Strikethrough, Subscript,
  Superscript, Table2, Trash2, Type, Underline, Undo2, Video, X, Check,
} from 'lucide-react';
import { buildExtensions, CODE_LANGS, FIND_META } from '../editor-schema';
import { findRanges, type FindRange } from '../find';
import { fromEditorHtml, toEditorHtml } from '../tiptap-html';
import { sanitizeHtml } from '../convert';
import { formatDateTime } from '../utils';
import { normalizeMediaUrl, fileKindOf, fileBadgeLabel } from '../media';
import type { Attachment } from '../types';
import { IconBtn, Menu, type MenuItem } from './Common';
import DateTimePop, { type Anchor, type Bounds } from './DateTimePop';

const HILITE_COLORS = ['#fff3a3', '#c9f0d6', '#cfe4fb', '#fbd6e3', '#ffe0bd', '#e6dcfb'];
const FONT_SIZES: { label: string; value: string }[] = [
  { label: '12px', value: '12px' }, { label: '13px', value: '13px' }, { label: '15px', value: '15px' },
  { label: '17px', value: '17px' }, { label: '20px', value: '20px' }, { label: '24px', value: '24px' },
  { label: '30px', value: '30px' },
];

export interface RichEditorHandle {
  insertAttachment: (att: Attachment) => void;
  insertText: (text: string) => void;
  /** 画板重新保存后，把正文里那张快照的图换成新的。 */
  updateBoardImage: (boardId: string, src: string) => void;
  focus: () => void;
  /* --- 编辑器内查找 / 替换（由外层 FindBar 驱动） --- */
  findAll: (query: string, caseSensitive: boolean) => FindRange[];
  setFind: (ranges: FindRange[], active: number) => void;
  selectRange: (r: FindRange | null) => void;
  replaceRanges: (ranges: FindRange[], indices: number[], text: string) => void;
  getSelectedText: () => string;
}

interface Props {
  /** 换笔记时用它重建编辑器实例，避免把上一篇的选区带过来。 */
  docKey: string;
  /** 存档格式的 HTML。 */
  html: string;
  fontFamily: string;
  fontSize: string;
  onContent: (storedHtml: string) => void;
  onFiles: (files: File[]) => void;
  onRequestFile: () => void;
  /** 只挑音频 / 视频。 */
  onRequestMedia: () => void;
  /** 打开「导入到这篇笔记」。 */
  onImport: () => void;
  /** 新建一块画板。 */
  onInsertBoard: () => void;
  /** 双击画板快照回到画板。 */
  onOpenBoard: (boardId: string) => void;
  onOpenPreview: (attId: string, src?: string, name?: string) => void;
  onOpenWiki: (title: string) => void;
  onOpenUrl: (href: string) => void;
  onPreference: (patch: { fontFamily?: string; fontSize?: string }) => void;
}

const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(props, ref) {
  const {
    docKey, html, fontFamily, fontSize, onContent, onFiles, onRequestFile, onRequestMedia,
    onImport, onInsertBoard,
    onOpenBoard, onOpenPreview, onOpenWiki, onOpenUrl, onPreference,
  } = props;

  const lastStored = useRef(html);
  const plainPaste = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [hiliteOpen, setHiliteOpen] = useState(false);
  const [linkPop, setLinkPop] = useState<{ kind: 'url' | 'wiki'; value: string } | null>(null);
  /** 时间戳选择器：一处是插入，一处是点已有时间戳改值。
   *  anchor 是光标（或那个时间戳）的视口坐标 —— 弹层贴着它开，不再固定在右上角。 */
  const [timePop, setTimePop] = useState<
    | { kind: 'insert'; anchor: Anchor; bounds: Bounds; value: string; at: number }
    | { kind: 'edit'; anchor: Anchor; bounds: Bounds; value: string; pos: number }
    | null
  >(null);
  const [lang, setLang] = useState('');
  /** 当前操作的媒体块：图片 / 音视频 / 文件卡片共用一条浮动工具条。
   *  用 hover + click 定位而不是只靠 ProseMirror 选区——点原生播放控件时
   *  选区不一定会落到节点上，工具条却应该一直在。 */
  const [blockSel, setBlockSel] = useState<{ type: 'image' | 'mediaBlock' | 'fileCard'; pos: number } | null>(null);

  const editor = useEditor(
    {
      extensions: buildExtensions('开始写点什么… 输入 # 变标题、- 变列表、[] 变待办'),
      content: toEditorHtml(html),
      shouldRerenderOnTransaction: true,
      editorProps: {
        attributes: {
          class: 'editor__rich prose',
          spellcheck: 'false',
          'data-placeholder': '开始写点什么… 输入 # 变标题、- 变列表、[] 变待办',
        },
        transformPastedHTML: (raw) => toEditorHtml(sanitizeHtml(raw)),
        handlePaste: (view, event) => {
          const dt = (event as ClipboardEvent).clipboardData;
          if (!dt) return false;
          const files = Array.from(dt.files || []);
          if (files.length) {
            event.preventDefault();
            onFiles(files);
            return true;
          }
          if (plainPaste.current) {
            plainPaste.current = false;
            const text = dt.getData('text/plain');
            if (!text) return true;
            event.preventDefault();
            view.dispatch(view.state.tr.insertText(text));
            return true;
          }
          plainPaste.current = false;
          return false;
        },
        handleDrop: (_view, event) => {
          const files = Array.from((event as DragEvent).dataTransfer?.files || []);
          if (!files.length) return false;
          event.preventDefault();
          onFiles(files);
          return true;
        },
      },
      onUpdate: ({ editor: ed }) => {
        const stored = fromEditorHtml(ed.getHTML());
        lastStored.current = stored;
        onContent(stored);
      },
    },
    [docKey]
  );

  // 外部内容变化（切笔记、恢复历史、从模板插入）才整体重设，自己敲字不会走到这里。
  useEffect(() => {
    if (!editor) return;
    if (html === lastStored.current) return;
    editor.commands.setContent(toEditorHtml(html), { emitUpdate: false });
    lastStored.current = html;
  }, [html, editor]);

  useImperativeHandle(ref, () => ({
    insertAttachment: (att: Attachment) => {
      if (!editor) return;
      // 一律「插在选区末尾」，不用 insertContent：选中一张图时 insertContent 会
      // 把那张图整个替换掉（选中 = NodeSelection，插入即替换），用户看起来就是
      // 「新插的图把上一张顶没了」。
      const at = editor.state.selection.to;
      if (att.kind === 'image' || att.kind === 'board') {
        // 属性一起插进去，别走「先 setImage 再 updateAttributes」：
        // 后者的目标是「当前选中的图片」，光标不在图上时就成了空操作，
        // 图会少一个 data-att-id（正文回不到短引用、附件也回收不了）。
        editor.chain().focus().insertContentAt(at, {
          type: 'image',
          attrs: {
            src: normalizeMediaUrl(att.dataUrl, att.name, att.mime, att.kind),
            alt: att.name,
            attId: att.id,
            boardId: att.boardId || null,
          },
        }).run();
      } else if (att.kind === 'audio' || att.kind === 'video') {
        editor.chain().focus().insertContentAt(at, {
          type: 'mediaBlock',
          attrs: {
            src: normalizeMediaUrl(att.dataUrl, att.name, att.mime, att.kind),
            kind: att.kind, attId: att.id, name: att.name,
          },
        }).run();
      } else {
        // 2.5.8：文件改成块级卡片，带类型徽标、大小与预览入口，还能整体对齐。
        // 老笔记里已有的行内 <a data-att-id> 照旧解析，不需要迁移。
        const fk = fileKindOf(att.name, att.mime, att.kind);
        editor.chain().focus().insertContentAt(at, {
          type: 'fileCard',
          attrs: {
            attId: att.id, name: att.name.replace(/[<>&]/g, ''),
            kind: fk, label: fileBadgeLabel(att.name, fk),
            mime: att.mime, size: att.size, align: 'left', width: null,
          },
        }).run();
      }
    },
    insertText: (text: string) => {
      editor?.chain().focus().insertContent(text).run();
    },
    updateBoardImage: (boardId: string, src: string) => {
      if (!editor) return;
      const { state, view } = editor;
      const tr = state.tr;
      let changed = false;
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'image' && node.attrs.boardId === boardId) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, src });
          changed = true;
        }
        return true;
      });
      if (changed) view.dispatch(tr);
    },
    focus: () => editor?.commands.focus(),
    findAll: (query, caseSensitive) => (editor ? findRanges(editor.state.doc, query, caseSensitive) : []),
    setFind: (ranges, active) => {
      // 只改插件状态、不动文档：不会触发 onUpdate，也就不会写进历史 / 误触保存。
      editor?.view.dispatch(editor.state.tr.setMeta(FIND_META, { ranges, active }));
    },
    selectRange: (r) => {
      if (!editor || !r) return;
      // 故意不 focus：查找框要留住焦点，方便连按回车跳下一个。
      editor.commands.setTextSelection({ from: r.from, to: r.to });
      editor.commands.scrollIntoView();
    },
    replaceRanges: (ranges, indices, text) => {
      if (!editor) return;
      const tr = editor.state.tr;
      // 从后往前替换，前面的区间不会因长度变化而错位；一个事务可一次性 Ctrl+Z 撤销。
      [...indices].sort((a, b) => b - a).forEach((idx) => {
        const r = ranges[idx];
        if (r) tr.insertText(text, r.from, r.to);
      });
      if (tr.docChanged) editor.view.dispatch(tr);
    },
    getSelectedText: () => {
      if (!editor) return '';
      const { from, to, empty } = editor.state.selection;
      return empty ? '' : editor.state.doc.textBetween(from, to, ' ');
    },
  }), [editor]);

  if (!editor) return <div className="rich-shell" ref={wrapRef} />;

  const run = (fn: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => {
    fn(editor.chain().focus()).run();
  };

  const level = [1, 2, 3, 4, 5, 6].find((n) => editor.isActive('heading', { level: n })) as 1 | 2 | 3 | 4 | 5 | 6 | undefined;
  const blockValue = level ? `h${level}`
    : editor.isActive('blockquote') ? 'blockquote'
    : editor.isActive('codeBlock') ? 'pre'
    : 'p';

  const setBlock = (v: string) => {
    const c = editor.chain().focus();
    if (v === 'p') c.setParagraph().run();
    else if (v === 'blockquote') c.toggleBlockquote().run();
    else if (v === 'pre') c.toggleCodeBlock().run();
    else c.setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
  };

  const tableMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const inTable = editor.isActive('table');
    const items: MenuItem[] = [
      { label: '插入 3 × 3 表格', icon: <Table2 size={14} />, onClick: () => run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true })) },
      { label: '', divider: true },
      { label: '在上方插入行', icon: <Plus size={14} />, onClick: () => run((c) => c.addRowBefore()) },
      { label: '在下方插入行', icon: <Plus size={14} />, onClick: () => run((c) => c.addRowAfter()) },
      { label: '在左侧插入列', icon: <Plus size={14} />, onClick: () => run((c) => c.addColumnBefore()) },
      { label: '在右侧插入列', icon: <Plus size={14} />, onClick: () => run((c) => c.addColumnAfter()) },
      { label: '', divider: true },
      { label: '删除当前行', icon: <Minus size={14} />, onClick: () => run((c) => c.deleteRow()) },
      { label: '删除当前列', icon: <Minus size={14} />, onClick: () => run((c) => c.deleteColumn()) },
      { label: '首行切换为表头', icon: <Table2 size={14} />, onClick: () => run((c) => c.toggleHeaderRow()) },
      { label: '', divider: true },
      { label: '删除整个表格', icon: <Trash2 size={14} />, danger: true, onClick: () => run((c) => c.deleteTable()) },
      { label: '', divider: true },
      { label: '拖动列边界可调整列宽', disabled: true },
    ];
    if (!inTable) items.splice(1, 0, { label: '光标不在表格里时，只有第一项可用', divider: true });
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4, items });
  };

  const applyLink = () => {
    if (!linkPop) return;
    const v = linkPop.value.trim();
    setLinkPop(null);
    if (!v) return;
    if (linkPop.kind === 'wiki') {
      const safe = v.replace(/[<>&"]/g, '');
      editor.chain().focus().insertContent({
        type: 'text', text: safe, marks: [{ type: 'wikiLink', attrs: { wiki: safe } }],
      }).insertContent(' ').run();
    } else {
      const href = /^https?:\/\//i.test(v) ? v : `https://${v}`;
      if (editor.state.selection.empty) {
        editor.chain().focus().insertContent({
          type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }],
        }).run();
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
      }
    }
  };

  const onKeyDownCapture = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') {
      plainPaste.current = true;
    }
  };

  /* ---------- 时间戳：插入 / 点击改值 ---------- */

  /** 容器矩形：弹层只在这个范围里摆放（翻到上方也不会压到工具栏外面）。 */
  const shellBounds = (): Bounds => {
    const r = wrapRef.current?.getBoundingClientRect();
    return r
      ? { left: r.left, top: r.top, width: r.width, height: r.height }
      : { left: 0, top: 0, width: 720, height: 600 };
  };

  /** 插入点仍是当前光标，但「弹层」锚定到工具栏的日期时间按钮下方。
   *  以前用 coordsAtPos 取光标坐标：第一次插入时光标往往还停在文档开头或上次编辑处，
   *  日历就飘到编辑区中央压住正文。挂在按钮下方是下拉菜单的常规位置，不随光标跑、
   *  也不会遮住正在写的内容；点正文里已有的时间戳改值时仍贴着那个时间戳。 */
  const openTimeInsert = (e: React.MouseEvent) => {
    if (!wrapRef.current) return;
    const at = editor.state.selection.from;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const anchor: Anchor = { left: r.left, top: r.top, bottom: r.bottom };
    setLinkPop(null);
    setTimePop({ kind: 'insert', anchor, bounds: shellBounds(), at, value: formatDateTime(Date.now()) });
  };

  /** 点正文里的时间戳：把选择器开在它下面，默认带上它自己的值。 */
  const openTimeEdit = (el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    const raw = el.getAttribute('data-time') || el.textContent || '';
    // posAtDOM 对行内原子节点返回的是节点起始位置；取不到时退回遍历按值找。
    let pos = editor.view.posAtDOM(el, 0);
    if (editor.state.doc.nodeAt(pos)?.type.name !== 'insertedTime') {
      let found = -1;
      editor.state.doc.descendants((n, p) => {
        if (found < 0 && n.type.name === 'insertedTime' && n.attrs.value === raw) found = p;
      });
      if (found >= 0) pos = found;
    }
    setLinkPop(null);
    setTimePop({
      kind: 'edit',
      anchor: { left: box.left, top: box.top, bottom: box.bottom },
      bounds: shellBounds(),
      value: raw.trim() || formatDateTime(Date.now()),
      pos,
    });
  };

  const applyTime = (value: string) => {
    if (!timePop) return;
    if (timePop.kind === 'insert') {
      // 时间戳是 inline 原子节点。只插节点的话，光标会停在 <time> 元素的右内边缘，
      // 视觉上「紧挨着时间」，继续打字还容易被浏览器算进这个绿色块里。
      // 后面补一个普通空格，并把选区明确放到空格之后：光标就落在时间戳外的正文里。
      editor.chain().focus()
        .insertContentAt(timePop.at, [
          { type: 'insertedTime', attrs: { value } },
          { type: 'text', text: ' ' },
        ])
        .setTextSelection(timePop.at + 2)
        .run();
    } else {
      // 改值也一样：别把光标留在被选中的原子节点上。
      editor.chain().focus().setNodeSelection(timePop.pos)
        .updateAttributes('insertedTime', { value })
        .setTextSelection(timePop.pos + 1)
        .run();
    }
    setTimePop(null);
  };

  /** 从被 hover / 点击的 DOM 反查文档里的块节点位置。
   *  posAtDOM 对「无 contentDOM 的原子节点」有时给节点前、有时给节点内，
   *  所以前后各试一格，认准节点类型再落状态。 */
  const resolveBlockPos = (el: HTMLElement, type: string): number => {
    const candidates: number[] = [];
    try { candidates.push(editor.view.posAtDOM(el, 0)); } catch { /* 不在视图里 */ }
    // 文件卡片是带静态子元素的块节点，posAtDOM 常给出「节点内部」的位置。
    // 兜底按 DOM 身份反查：nodeDOM(pos) 就是渲染出来的那个元素，最稳。
    try {
      editor.state.doc.descendants((n, p) => {
        if (n.type.name === type && editor.view.nodeDOM(p) === el) candidates.push(p);
        return true;
      });
    } catch { /* 忽略 */ }
    for (const p of candidates) {
      for (const q of [p, p - 1]) {
        if (q >= 0 && editor.state.doc.nodeAt(q)?.type.name === type) return q;
      }
    }
    return -1;
  };

  const pickBlock = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    const node = el.closest('img, video, audio, [data-file-card]') as HTMLElement | null;
    if (!node) {
      if (e.type === 'click') setBlockSel(null);
      return;
    }
    const type = node.matches('img') ? 'image'
      : node.hasAttribute('data-file-card') ? 'fileCard' : 'mediaBlock';
    const pos = resolveBlockPos(node, type);
    if (pos < 0) return;
    setBlockSel((prev) => (prev && prev.pos === pos && prev.type === type ? prev : { type, pos }));
  };

  const onClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    const time = el.closest('time') as HTMLElement | null;
    if (time && (time.hasAttribute('data-time') || time.classList.contains('ins-time'))) {
      e.preventDefault();
      openTimeEdit(time);
      return;
    }
    // 文件卡片 / 音视频 / 图片：点一下就把工具条挂上，并顺手打开预览（卡片本身）。
    const card = el.closest('[data-file-card]') as HTMLElement | null;
    if (card) {
      pickBlock(e);
      const id = card.getAttribute('data-att-id') || '';
      if (id) { e.preventDefault(); onOpenPreview(id, '', card.getAttribute('data-att-name') || ''); }
      return;
    }
    const img = el.closest('img');
    if (img) {
      pickBlock(e);
      const boardId = img.getAttribute('data-board-id');
      if (boardId && e.detail >= 2) { e.preventDefault(); onOpenBoard(boardId); return; }
      const pos = editor.view.posAtDOM(img, 0);
      editor.chain().setNodeSelection(pos).run();
      return;
    }
    const media = el.closest('video, audio');
    if (media) { pickBlock(e); return; }
    const a = el.closest('a');
    if (a) {
      const attId = a.getAttribute('data-att-id');
      const wiki = a.getAttribute('data-wiki');
      const href = a.getAttribute('href') || '';
      if (attId) { e.preventDefault(); onOpenPreview(attId, href, a.textContent || ''); return; }
      if (wiki) { e.preventDefault(); onOpenWiki(wiki); return; }
      if (/^https?:\/\//i.test(href)) { e.preventDefault(); onOpenUrl(href); }
    }
    setBlockSel(null);
  };

  const selNode = blockSel ? editor.state.doc.nodeAt(blockSel.pos) : null;
  const selType = selNode && blockSel && selNode.type.name === blockSel.type ? blockSel.type : null;
  const selAttrs = selNode?.attrs || null;
  const curWidth = (selAttrs?.width as string | null)
    || (selType === 'mediaBlock' ? '60%' : selType === 'fileCard' ? '100%' : 'auto');
  const curAlign = (selAttrs?.align as string | null)
    || (selType === 'mediaBlock' ? 'center' : selType === 'image' ? 'inline' : 'left');
  const widthPresets = selType === 'image' ? [25, 50, 75, 100]
    : selType === 'mediaBlock' ? [25, 40, 60, 80, 100] : [50, 75, 100];
  const alignPresets: [string, string, string][] = selType === 'image'
    ? [['left', '左', '靠左对齐'], ['center', '中', '居中对齐'], ['right', '右', '靠右对齐'], ['inline', '嵌入', '嵌入正文']]
    : [['left', '左', '靠左对齐'], ['center', '中', '居中对齐'], ['right', '右', '靠右对齐']];

  const updateBlock = (patch: Record<string, unknown>) => {
    if (!blockSel || !selType) return;
    editor.chain().focus().setNodeSelection(blockSel.pos)
      .updateAttributes(selType, patch).run();
  };
  const removeBlock = () => {
    if (!blockSel) return;
    editor.chain().focus().setNodeSelection(blockSel.pos).deleteSelection().run();
    setBlockSel(null);
  };
  const previewBlock = () => {
    if (!selAttrs) return;
    onOpenPreview(
      String(selAttrs.attId || ''),
      String(selAttrs.src || ''),
      String(selAttrs.alt || selAttrs.name || ''),
    );
  };

  return (
    <div className="rich-shell" ref={wrapRef} onKeyDownCapture={onKeyDownCapture}>
      <div className="toolbar">
        <select className="toolbar__select toolbar__select--block" value={blockValue}
          title="段落格式：正文 / 标题 / 引用 / 代码块"
          onChange={(e) => setBlock(e.currentTarget.value)}>
          <option value="p">正文</option>
          <option value="h1">标题 1</option>
          <option value="h2">标题 2</option>
          <option value="h3">标题 3</option>
          <option value="h4">标题 4</option>
          <option value="h5">标题 5</option>
          <option value="h6">标题 6</option>
          <option value="blockquote">引用</option>
          <option value="pre">代码块</option>
        </select>

        <IconBtn title="撤销 (Ctrl+Z)" onClick={() => run((c) => c.undo())}><Undo2 size={15} /></IconBtn>
        <IconBtn title="重做 (Ctrl+Y)" onClick={() => run((c) => c.redo())}><Redo2 size={15} /></IconBtn>
        <span className="toolbar__sep" />
        <IconBtn title="加粗 (Ctrl+B)" active={editor.isActive('bold')} onClick={() => run((c) => c.toggleBold())}><Bold size={15} /></IconBtn>
        <IconBtn title="斜体 (Ctrl+I)" active={editor.isActive('italic')} onClick={() => run((c) => c.toggleItalic())}><Italic size={15} /></IconBtn>
        <IconBtn title="下划线 (Ctrl+U)" active={editor.isActive('underline')} onClick={() => run((c) => c.toggleUnderline())}><Underline size={15} /></IconBtn>
        <IconBtn title="删除线" active={editor.isActive('strike')} onClick={() => run((c) => c.toggleStrike())}><Strikethrough size={15} /></IconBtn>
        <IconBtn title="行内代码" active={editor.isActive('code')} onClick={() => run((c) => c.toggleCode())}><Code2 size={15} /></IconBtn>
        <IconBtn title="上标" active={editor.isActive('superscript')} onClick={() => run((c) => c.toggleSuperscript())}><Superscript size={15} /></IconBtn>
        <IconBtn title="下标" active={editor.isActive('subscript')} onClick={() => run((c) => c.toggleSubscript())}><Subscript size={15} /></IconBtn>
        <span className="toolbar__sep" />
        <IconBtn title="一级标题" active={editor.isActive('heading', { level: 1 })} onClick={() => run((c) => c.toggleHeading({ level: 1 }))}><Heading1 size={15} /></IconBtn>
        <IconBtn title="二级标题" active={editor.isActive('heading', { level: 2 })} onClick={() => run((c) => c.toggleHeading({ level: 2 }))}><Heading2 size={15} /></IconBtn>
        <IconBtn title="三级标题" active={editor.isActive('heading', { level: 3 })} onClick={() => run((c) => c.toggleHeading({ level: 3 }))}><Heading3 size={15} /></IconBtn>
        <IconBtn title="无序列表" active={editor.isActive('bulletList')} onClick={() => run((c) => c.toggleBulletList())}><List size={15} /></IconBtn>
        <IconBtn title="有序列表" active={editor.isActive('orderedList')} onClick={() => run((c) => c.toggleOrderedList())}><ListOrdered size={15} /></IconBtn>
        <IconBtn title="检查清单（待办）· 回车续行、空行回车跳出" active={editor.isActive('taskList')} onClick={() => run((c) => c.toggleTaskList())}><ListChecks size={15} /></IconBtn>
        <IconBtn title="引用" active={editor.isActive('blockquote')} onClick={() => run((c) => c.toggleBlockquote())}><Quote size={15} /></IconBtn>
        <button className="toolbar__text toolbar__caret" title="表格" onClick={tableMenu}>表格 <ChevronDown size={11} /></button>
        <span className="toolbar__sep" />
        <IconBtn title="插入链接" active={editor.isActive('link')} onClick={() => setLinkPop({ kind: 'url', value: 'https://' })}><Link2 size={15} /></IconBtn>
        <IconBtn title="笔记内链 [[标题]] (Ctrl+K)" active={editor.isActive('wikiLink')} onClick={() => setLinkPop({ kind: 'wiki', value: '' })}><Braces size={15} /></IconBtn>
        <IconBtn title="插入图片 / 文件" onClick={onRequestFile}><ImagePlus size={15} /></IconBtn>
        <IconBtn title="插入语音 / 视频" onClick={onRequestMedia}><Video size={15} /></IconBtn>
        <IconBtn title="插入画板 / 流程图" onClick={onInsertBoard}><Frame size={15} /></IconBtn>
        <IconBtn title="从文件导入到这篇笔记（可覆盖或追加）" onClick={onImport}><FileInput size={15} /></IconBtn>
        <IconBtn title="分割线" onClick={() => run((c) => c.setHorizontalRule())}><Minus size={15} /></IconBtn>
        <span className="toolbar__sep" />
        <span className="toolbar__label" title="字体（同时记为新笔记默认字体）"><Type size={14} /></span>
        <select className="toolbar__select" value={fontFamily} title="字体"
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'inherit') run((c) => c.unsetFontFamily());
            else run((c) => c.setFontFamily(v));
            onPreference({ fontFamily: v });
          }}>
          <option value="inherit">默认字体</option>
          <option value="Microsoft YaHei">微软雅黑</option>
          <option value="SimSun">宋体</option>
          <option value="KaiTi">楷体</option>
          <option value="Consolas, monospace">等宽</option>
          <option value="Georgia, serif">衬线</option>
        </select>
        <select className="toolbar__select toolbar__select--sm" value={fontSize} title="字号"
          onChange={(e) => {
            const v = e.target.value;
            run((c) => c.setFontSize(v));
            onPreference({ fontSize: v });
          }}>
          {FONT_SIZES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <input className="toolbar__color" type="color" defaultValue="#2b3230" title="文字颜色"
          onChange={(e) => run((c) => c.setColor(e.target.value))} />
        <span className="hilite-wrap">
          <button className={`icon-btn ${hiliteOpen ? 'is-active' : ''}`} title="高亮（6 色）"
            onClick={() => setHiliteOpen((v) => !v)}><Highlighter size={15} /></button>
          {hiliteOpen && (
            <>
              <div className="menu-dismiss" onMouseDown={() => setHiliteOpen(false)} />
              <div className="hilite-pop">
                {HILITE_COLORS.map((c) => (
                  <button key={c} title="高亮" style={{ background: c }}
                    onClick={() => { run((chain) => chain.toggleHighlight({ color: c })); setHiliteOpen(false); }} />
                ))}
                <button className="hilite-pop__none" title="取消高亮"
                  onClick={() => { run((chain) => chain.unsetHighlight()); setHiliteOpen(false); }}>无</button>
              </div>
            </>
          )}
        </span>
        <span className="toolbar__sep" />
        <IconBtn title="左对齐" active={editor.isActive({ textAlign: 'left' })} onClick={() => run((c) => c.setTextAlign('left'))}><AlignLeft size={15} /></IconBtn>
        <IconBtn title="居中" active={editor.isActive({ textAlign: 'center' })} onClick={() => run((c) => c.setTextAlign('center'))}><AlignCenter size={15} /></IconBtn>
        <IconBtn title="右对齐" active={editor.isActive({ textAlign: 'right' })} onClick={() => run((c) => c.setTextAlign('right'))}><AlignRight size={15} /></IconBtn>
        <IconBtn title="清除格式" onClick={() => run((c) => c.unsetAllMarks().clearNodes())}><Eraser size={15} /></IconBtn>
        <IconBtn title="插入日期时间（可点开选择具体时刻）" onClick={openTimeInsert}>
          <CalendarClock size={15} />
        </IconBtn>
        {editor.isActive('codeBlock') && (
          <select className="toolbar__select" value={(editor.getAttributes('codeBlock').lang as string) || lang}
            title="代码块语言"
            onChange={(e) => { setLang(e.target.value); run((c) => c.updateAttributes('codeBlock', { lang: e.target.value || null })); }}>
            {CODE_LANGS.map((l) => <option key={l || 'plain'} value={l}>{l || '纯文本'}</option>)}
          </select>
        )}
      </div>

      {linkPop && (
        <div className="link-pop">
          <span>{linkPop.kind === 'wiki' ? '目标笔记标题' : '网址'}</span>
          <input autoFocus value={linkPop.value} placeholder={linkPop.kind === 'wiki' ? '例如：欢迎来到纸间笔记' : 'https://example.com'}
            onChange={(e) => setLinkPop({ ...linkPop, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
              if (e.key === 'Escape') setLinkPop(null);
            }} />
          <button className="link-pop__ok" title="确定" onClick={applyLink}><Check size={14} /></button>
          <button title="取消" onClick={() => setLinkPop(null)}><X size={14} /></button>
        </div>
      )}

      {timePop && (
        <>
          <div className="menu-dismiss" onMouseDown={() => setTimePop(null)} />
          <DateTimePop
            label={timePop.kind === 'insert' ? '插入日期时间' : '修改日期时间'}
            value={timePop.value}
            anchor={timePop.anchor}
            bounds={timePop.bounds}
            onConfirm={applyTime}
            onCancel={() => setTimePop(null)}
          />
        </>
      )}

      {selType && (
        <div className="imgtools imgtools--float" onMouseDown={(e) => e.preventDefault()}>
          <span className="imgtools__label">
            {selType === 'image' ? '图片' : selType === 'fileCard' ? '文件' : '视频 / 语音'} · 宽
          </span>
          {widthPresets.map((p) => (
            <button key={p} className={curWidth === `${p}%` ? 'is-active' : ''} title={`宽度 ${p}%`}
              onClick={() => updateBlock({ width: `${p}%` })}>{p}%</button>
          ))}
          {selType !== 'mediaBlock' && (
            <button className={curWidth === 'auto' ? 'is-active' : ''}
              title={selType === 'image' ? '原始尺寸' : '自适应宽度'}
              onClick={() => updateBlock({ width: null })}>
              {selType === 'image' ? '原图' : '自适应'}
            </button>
          )}
          <span className="toolbar__sep" />
          <span className="imgtools__label">位置</span>
          {alignPresets.map(([a, label, title]) => (
            <button key={a} className={curAlign === a ? 'is-active' : ''} title={title}
              onClick={() => updateBlock({ align: a })}>{label}</button>
          ))}
          <span className="toolbar__sep" />
          {!!selAttrs?.boardId && (
            <button title="编辑画板（也可以直接双击图上）" onClick={() => onOpenBoard(String(selAttrs.boardId))}>
              <Frame size={13} />
            </button>
          )}
          <button title={selType === 'fileCard' ? '预览文件内容' : '查看原图 / 播放'}
            onClick={previewBlock}><Eye size={13} /></button>
          <button title="从正文移除" className="is-danger" onClick={removeBlock}><Trash2 size={13} /></button>
          <button title="收起工具条" onClick={() => setBlockSel(null)}><X size={13} /></button>
        </div>
      )}

      <div className="rich-host" onClick={onClick} onMouseOver={pickBlock}>
        <EditorContent editor={editor} />
      </div>

      {menu && <Menu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
});

export default RichEditor;
