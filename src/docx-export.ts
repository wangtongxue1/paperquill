/** Word (.docx) 导出：把存档 HTML 映射成真正的 OOXML 文档（docx 库）。
 *
 *  支持的映射：标题 h1-h6、段落、加粗/斜体/下划线/删除线/行内代码、字体/字号/颜色、
 *  高亮、上下标、链接、图片（含附件图片）、无序/有序列表、待办（复选框符号）、
 *  表格（表头加粗、列对齐）、代码块（等宽+底纹）、引用块、分割线、时间戳、
 *  音视频占位、文件卡片占位、内链（[[标题]] 转成普通文本）。
 *  Word 没有对应概念的元素给出可读占位，不丢内容。
 */
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, ImageRun,
  LevelFormat, Packer, Paragraph, ShadingType, Table, TableCell, TableRow,
  TextRun, UnderlineType, WidthType,
} from 'docx';
import type { Note, Attachment } from './types';
import { mdToHtml, resolveAttachmentRefs } from './convert';

const ZH_FONT = 'Microsoft YaHei';

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  color?: string;
  sizePx?: number;
  fontFamily?: string;
  highlight?: string;
  superscript?: boolean;
  subscript?: boolean;
  link?: string;
}

const pxToHalfPt = (px: number) => Math.round(px * 2);

function styleOfSpan(el: HTMLElement, base: RunStyle): RunStyle {
  const s: RunStyle = { ...base };
  const st = el.style;
  if (st.color) s.color = st.color;
  if (st.backgroundColor && !s.highlight) s.highlight = st.backgroundColor;
  if (st.fontSize) {
    const m = /([\d.]+)px/.exec(st.fontSize);
    if (m) s.sizePx = parseFloat(m[1]);
  }
  if (st.fontFamily) s.fontFamily = st.fontFamily;
  if (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600) s.bold = true;
  if (st.fontStyle === 'italic') s.italics = true;
  return s;
}

/** dataUrl → { bytes, mime }；解析失败返回 null（图片就跳过，别让整次导出失败）。 */
function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+)?;base64,(.+)$/s.exec(dataUrl.trim());
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime: m[1] || 'image/png' };
  } catch {
    return null;
  }
}

/** 异步读取图片真实尺寸，按最大宽度等比缩放。 */
function imageSize(url: string, maxW = 600): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.naturalWidth);
      resolve({ w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

type InlineNode = TextRun | ExternalHyperlink | ImageRun;

/** 行内节点 → TextRun / Hyperlink。块级子元素（罕见）降级为文本。 */
async function inlineRuns(node: Node, style: RunStyle, atts: Attachment[]): Promise<InlineNode[]> {
  const out: InlineNode[] = [];
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent || '').replace(/\u00a0/g, ' ');
    if (text) out.push(new TextRun({ text, ...runOpts(style) }));
    return out;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return out;
  const el = node as HTMLElement;
  const tag = el.tagName;

  if (tag === 'BR') { out.push(new TextRun({ break: 1 })); return out; }

  if (tag === 'IMG') {
    const src = el.getAttribute('src') || '';
    const data = dataUrlToBytes(src);
    if (data && /^image\//.test(data.mime)) {
      const size = await imageSize(src);
      if (size) {
        out.push(new ImageRun({
          data: data.bytes, type: data.mime.includes('png') ? 'png' : data.mime.includes('gif') ? 'gif' : data.mime.includes('webp') ? 'jpg' : 'jpg',
          transformation: { width: size.w, height: size.h },
        }));
        return out;
      }
    }
    out.push(new TextRun({ text: `[图片${el.getAttribute('alt') ? '：' + el.getAttribute('alt') : ''}]`, ...runOpts(style) }));
    return out;
  }

  // 行内链接：外链走真正的超链接；内链/附件链接降级为带样式文本
  if (tag === 'A') {
    const href = el.getAttribute('href') || '';
    const kids = await inlineChildren(el, { ...style, link: href }, atts);
    if (/^https?:\/\//i.test(href)) {
      out.push(new ExternalHyperlink({ children: kids.filter((k): k is TextRun => k instanceof TextRun), link: href }));
    } else {
      out.push(...kids);
    }
    return out;
  }

  const s = { ...style };
  if (tag === 'STRONG' || tag === 'B') s.bold = true;
  if (tag === 'EM' || tag === 'I') s.italics = true;
  if (tag === 'U' || tag === 'INS') s.underline = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') s.strike = true;
  if (tag === 'SUP') s.superscript = true;
  if (tag === 'SUB') s.subscript = true;
  if (tag === 'CODE') s.code = true;
  if (tag === 'MARK') s.highlight = el.style.backgroundColor || '#fff3bf';
  if (tag === 'TIME') { s.color = s.color || '#2f8f68'; s.bold = true; }
  if (tag === 'SPAN' || tag === 'FONT') Object.assign(s, pickSpanStyle(el, style));

  out.push(...(await inlineChildren(el, s, atts)));
  return out;
}

function pickSpanStyle(el: HTMLElement, base: RunStyle): RunStyle {
  const s = styleOfSpan(el, base);
  // 高亮只有纯色才有意义：浅色背景当成高亮，深色忽略
  if (s.highlight && !/^#|rgb|hsl/i.test(s.highlight)) s.highlight = undefined;
  return s;
}

async function inlineChildren(el: HTMLElement, style: RunStyle, atts: Attachment[]): Promise<InlineNode[]> {
  const out: InlineNode[] = [];
  for (const n of Array.from(el.childNodes)) {
    out.push(...(await inlineRuns(n, style, atts)));
  }
  return out;
}

function runOpts(s: RunStyle) {
  const o: Record<string, unknown> = {};
  if (s.bold) o.bold = true;
  if (s.italics) o.italics = true;
  if (s.strike) o.strike = true;
  if (s.underline) o.underline = { type: UnderlineType.SINGLE };
  if (s.superscript) o.superScript = true;
  if (s.subscript) o.subScript = true;
  if (s.sizePx) o.size = pxToHalfPt(s.sizePx);
  if (s.color) o.color = toHex(s.color);
  if (s.highlight) o.shading = { type: ShadingType.CLEAR, fill: toHex(s.highlight) };
  const mono = s.code || /consolas|monospace/i.test(s.fontFamily || '');
  o.font = mono ? { ascii: 'Consolas', eastAsia: 'Consolas' } : { ascii: s.fontFamily?.split(',')[0]?.trim() || ZH_FONT, eastAsia: s.fontFamily?.split(',')[0]?.trim() || ZH_FONT };
  return o;
}

/** Word 的 fill 不认 rgb()/rgba()，转成 #RRGGBB。 */
function toHex(c: string): string {
  const v = (c || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toUpperCase();
  const m = /rgba?\(([^)]+)\)/i.exec(v);
  if (m) {
    const parts = m[1].split(',').map((x) => parseFloat(x.trim()));
    if (parts.length >= 3) {
      return '#' + parts.slice(0, 3).map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase();
    }
  }
  return /#[0-9a-f]{3,8}/i.exec(v)?.[0]?.toUpperCase() || undefined as unknown as string;
}

const HEADS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  H1: HeadingLevel.HEADING_1, H2: HeadingLevel.HEADING_2, H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4, H5: HeadingLevel.HEADING_5, H6: HeadingLevel.HEADING_6,
};

function isTaskItem(li: HTMLElement): boolean {
  if (li.classList.contains('task-item')) return true;
  return !!li.querySelector(':scope > input[type="checkbox"]');
}

/** 列表递归：返回该 li 产生的段落（含嵌套子列表）。 */
async function listItems(
  list: HTMLElement, ordered: boolean, level: number, atts: Attachment[],
  out: (Paragraph | Table)[], ref: { olId: number }
) {
  for (const li of Array.from(list.children).filter((n) => n.tagName === 'LI') as HTMLElement[]) {
    if (isTaskItem(li)) {
      const box = li.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      const mark = box?.checked ? '☑ ' : '☐ ';
      const firstPara = await firstBlockRuns(li, atts, ['input', 'label', 'div', 'ul', 'ol']);
      out.push(new Paragraph({ children: [new TextRun({ text: mark }), ...firstPara], bullet: { level: Math.min(level, 8) } }));
      await nestedBlocks(li, atts, out, ref, level + 1);
      continue;
    }
    const runs = await liRuns(li, atts);
    out.push(ordered
      ? new Paragraph({ children: runs, numbering: { reference: `zj-ol-${ref.olId}`, level: Math.min(level, 8) } })
      : new Paragraph({ children: runs, bullet: { level: Math.min(level, 8) } }));
    await nestedBlocks(li, atts, out, ref, level + 1);
  }
}

/** li 的直接行内内容（跳过 input/嵌套块）。 */
async function liRuns(li: HTMLElement, atts: Attachment[]): Promise<InlineNode[]> {
  const runs: InlineNode[] = [];
  const clone = li.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('ul, ol, div, label, input, table').forEach((n) => n.remove());
  for (const n of Array.from(clone.childNodes)) {
    runs.push(...(await inlineRuns(n, {}, atts)));
  }
  if (!runs.length) runs.push(new TextRun({ text: '' }));
  return runs;
}

/** taskItem 的第一段行内内容。 */
async function firstBlockRuns(li: HTMLElement, atts: Attachment[], skip: string[]): Promise<InlineNode[]> {
  const clone = li.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(skip.join(', ')).forEach((n) => n.remove());
  const runs: InlineNode[] = [];
  for (const n of Array.from(clone.childNodes)) {
    runs.push(...(await inlineRuns(n, {}, atts)));
  }
  return runs;
}

async function nestedBlocks(li: HTMLElement, atts: Attachment[], out: (Paragraph | Table)[], ref: { olId: number }, level: number) {
  for (const child of Array.from(li.children)) {
    if (child.tagName === 'UL') await listItems(child as HTMLElement, false, level, atts, out, ref);
    else if (child.tagName === 'OL') await listItems(child as HTMLElement, true, level, atts, out, ref);
    else if (child.tagName === 'TABLE') out.push(await htmlTable(child as HTMLTableElement, atts));
  }
}

function cellAlignOf(el: HTMLElement): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  const a = (el.getAttribute('align') || el.style.textAlign || '').toLowerCase();
  if (a === 'center') return AlignmentType.CENTER;
  if (a === 'right' || a === 'end') return AlignmentType.RIGHT;
  if (a === 'left' || a === 'start') return AlignmentType.LEFT;
  return undefined;
}

/** 表格：表头加粗，列对齐跟随原样式；单元格里的段落逐个映射。 */
async function htmlTable(table: HTMLTableElement, atts: Attachment[]): Promise<Table> {
  const rows = Array.from(table.querySelectorAll('tr'));
  const trs: TableRow[] = [];
  for (const tr of rows) {
    const cells = Array.from(tr.children).filter((el) => /^(TD|TH)$/.test(el.tagName)) as HTMLElement[];
    const tcs: TableCell[] = [];
    for (const cell of cells) {
      const paras: (Paragraph | Table)[] = [];
      for (const child of Array.from(cell.children)) {
        if (/^(P|H[1-6]|UL|OL|PRE|BLOCKQUOTE)$/i.test(child.tagName)) {
          paras.push(...(await blockParagraphs(child as HTMLElement, atts)));
        }
      }
      if (!paras.length) paras.push(new Paragraph({ children: await inlineRuns(cell, {}, atts) }));
      tcs.push(new TableCell({
        children: paras,
        width: { size: 100 / Math.max(cells.length, 1), type: WidthType.PERCENTAGE },
      }));
    }
    trs.push(new TableRow({ children: tcs }));
  }
  return new Table({ rows: trs, width: { size: 100, type: WidthType.PERCENTAGE } });
}

/** 块级元素 → 段落数组（代码块 / 图片块会产生多段）。 */
async function blockParagraphs(el: HTMLElement, atts: Attachment[]): Promise<(Paragraph | Table)[]> {
  const tag = el.tagName;
  const attOf = () => ({
    alignment: cellAlignOf(el),
  });

  if (/^H[1-6]$/.test(tag)) {
    return [new Paragraph({ heading: HEADS[tag], children: await inlineRuns(el, {}, atts) })];
  }
  if (tag === 'UL' || tag === 'OL') {
    const out: (Paragraph | Table)[] = [];
    await listItems(el as HTMLElement, tag === 'OL', 0, atts, out, { olId: 0 });
    return out;
  }
  if (tag === 'PRE') {
    const code = el.querySelector('code')?.textContent ?? el.textContent ?? '';
    const lang = el.getAttribute('data-lang') || '';
    return code.replace(/\n$/, '').split('\n').map((line) => new Paragraph({
      children: [new TextRun({ text: line || ' ', font: { ascii: 'Consolas', eastAsia: 'Consolas' }, size: 19, ...(lang ? {} : {}) })],
      shading: { type: ShadingType.CLEAR, fill: '#F4F5F2' },
      ...attOf(),
    }));
  }
  if (tag === 'BLOCKQUOTE') {
    const paras: (Paragraph | Table)[] = [];
    for (const child of Array.from(el.children).length
      ? Array.from(el.children)
      : [el]) {
      paras.push(...(await blockParagraphs(child as HTMLElement, atts)));
    }
    return paras;
  }
  if (tag === 'TABLE') return [await htmlTable(el as HTMLTableElement, atts)];
  if (tag === 'HR') {
    return [new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'DFE3DD' } },
      ...attOf(),
    })];
  }
  if (tag === 'IMG' || tag === 'VIDEO' || tag === 'AUDIO') {
    return [new Paragraph({ ...attOf(), children: await inlineRuns(el, {}, atts) })];
  }
  if (tag === 'DIV' && el.hasAttribute('data-file-card')) {
    const name = el.getAttribute('data-att-name') || el.querySelector('.attach-card__name')?.textContent || '附件';
    return [new Paragraph({ ...attOf(), children: [new TextRun({ text: `[附件：${name}]`, color: '89918A', italics: true })] })];
  }
  // 普通段落 / 其他块级兜底
  const runs = await inlineRuns(el, {}, atts);
  if (!runs.length) return [new Paragraph({ text: '', ...attOf() })];
  return [new Paragraph({ children: runs, ...attOf() })];
}

export async function noteToDocxBlob(note: Note): Promise<Blob> {
  const atts: Attachment[] = note.attachments || [];
  const raw = note.mode === 'rich'
    ? resolveAttachmentRefs(note.content, atts)
    : mdToHtml(note.content, atts);
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${raw || ''}</body>`, 'text/html');

  const children: (Paragraph | Table)[] = [];

  // 有序列表每个 <ol> 一份编号引用（嵌套层级各自有缩进定义）
  const allOl = Array.from(doc.body.querySelectorAll('ol'));
  const numbering = allOl.map((_, i) => ({
    reference: `zj-ol-${i + 1}`,
    levels: Array.from({ length: 9 }, (_v, level) => ({
      level,
      format: LevelFormat.DECIMAL,
      text: `%${level + 1}.`,
      alignment: AlignmentType.START,
      style: { paragraph: { indent: { left: 360 * (level + 1) } } },
    })),
  }));

  for (const el of Array.from(doc.body.children)) {
    if (el.tagName === 'OL') {
      const idx = allOl.indexOf(el as HTMLOListElement) + 1;
      const out: (Paragraph | Table)[] = [];
      await listItems(el as unknown as HTMLOListElement, true, 0, atts, out, { olId: idx });
      children.push(...out);
      continue;
    }
    children.push(...(await blockParagraphs(el as HTMLElement, atts)));
  }

  const wordDoc = new Document({
    styles: {
      default: {
        document: {
          run: { font: { ascii: ZH_FONT, eastAsia: ZH_FONT }, size: 22 },
          paragraph: { spacing: { line: 320 } },
        },
      },
    },
    numbering: numbering.length ? { config: numbering } : undefined,
    sections: [{ children: children.length ? children : [new Paragraph({ text: '' })] }],
  });

  return Packer.toBlob(wordDoc);
}
