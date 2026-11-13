/** 2.5.9：附件文档的高保真预览渲染。
 *
 *  以前 Word / Excel / PPT 只抽文字做「正文摘录」，格式全丢。这里改成真正把
 *  OOXML 的排版信息还原出来：Word 交给 docx-preview（字体 / 段落 / 表格 / 页眉页脚 /
 *  分页 / 图片），Excel 自己解析 styles.xml 渲染带字体、底色、边框、合并单元格、
 *  列宽行高、数字格式的工作表，PPT 按 EMU 坐标绝对定位还原文字、字号、配色与图片。
 *  HTML 直接用原始文档渲染（sandbox iframe 隔离），Markdown 用 marked 排版。
 *
 *  全部在本地完成，不联网、不上传文件；输出的是一整个 HTML 文档字符串，
 *  由预览弹窗塞进 sandbox iframe，样式不会污染应用本身。
 */
import JSZip from 'jszip';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { renderAsync } from 'docx-preview';
import { extOf, guessMime } from './media';

/* ==================== HTML 外壳与通用工具 ==================== */

const BASE_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { background: #fff; color: #1f2937; font-family: "Noto Sans SC", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif; }
.zj-note { padding: 7px 12px; margin: 0 0 12px; border-radius: 6px; background: #f0f7f4; color: #1d6b52; font-size: 11px; line-height: 1.7; }
img { max-width: 100%; }
a { color: #0f766e; }
`;

/** 包成一个独立 HTML 文档；head 里可以塞 docx-preview 生成的 <style> 节点。 */
export function htmlPage(body: string, css = '', head = '', script = ''): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<style>${BASE_CSS}${css}</style>${head}</head><body>${body}`
    + (script ? `<script>${script}</script>` : '') + `</body></html>`;
}

export function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function xdoc(xml: string): Document {
  return new DOMParser().parseFromString(xml || '', 'application/xml');
}

/** 直接子元素（按 localName 匹配，忽略 OOXML 的命名空间前缀）。 */
function kids(el: Element | Document | undefined, name: string): Element[] {
  if (!el) return [];
  return Array.from(el.children || []).filter((c) => c.localName === name) as Element[];
}

/** 任意深度的后代（同样按 localName）。 */
function all(el: Element | Document | undefined, name: string): Element[] {
  if (!el) return [];
  return Array.from(el.getElementsByTagName('*')).filter((c) => c.localName === name) as Element[];
}

function first(el: Element | Document | undefined, name: string): Element | undefined {
  return kids(el, name)[0] || all(el, name)[0];
}

function attr(el: Element | undefined, name: string, fallback = ''): string {
  return el?.getAttribute(name) ?? fallback;
}

/** Office 主题色回退表：pptx / xlsx 都可能不带 theme 文件或用 schemeClr。 */
const THEME: Record<string, string> = {
  dk1: '#000000', lt1: '#FFFFFF', dk2: '#1F497D', lt2: '#EEECE1',
  tx1: '#000000', bg1: '#FFFFFF', tx2: '#1F497D', bg2: '#EEECE1',
  accent1: '#4472C4', accent2: '#ED7D31', accent3: '#A5A5A5', accent4: '#FFC000',
  accent5: '#5B9BD5', accent6: '#70AD47', hlink: '#0563C1', folHlink: '#954F72',
  phClr: '#808080',
};

/** 从 <a:solidFill> / <color> / <fgColor> 之类的节点里取一个 CSS 颜色。 */
function colorFrom(el: Element | undefined): string {
  if (!el) return '';
  const rgb = el.getAttribute('rgb');
  if (rgb && /^[0-9a-f]{6,8}$/i.test(rgb)) return '#' + (rgb.length === 8 ? rgb.slice(2) : rgb);
  if (el.localName === 'srgbClr' && el.getAttribute('val')) return '#' + el.getAttribute('val')!;
  if (el.localName === 'schemeClr') return THEME[el.getAttribute('val') || ''] || '';
  if (el.localName === 'sysClr' && el.getAttribute('lastClr')) return '#' + el.getAttribute('lastClr')!;
  const indexed = el.getAttribute('theme');
  if (indexed != null) {
    const n = Number(indexed);
    const keys = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
    return THEME[keys[n]] || '';
  }
  const srgb = all(el, 'srgbClr')[0];
  if (srgb?.getAttribute('val')) return '#' + srgb.getAttribute('val')!;
  const scheme = all(el, 'schemeClr')[0];
  if (scheme) return THEME[scheme.getAttribute('val') || ''] || '';
  const sys = all(el, 'sysClr')[0];
  if (sys?.getAttribute('lastClr')) return '#' + sys.getAttribute('lastClr')!;
  const col = all(el, 'color')[0];
  if (col?.getAttribute('rgb')) {
    const v = col.getAttribute('rgb')!;
    return '#' + (v.length === 8 ? v.slice(2) : v);
  }
  return '';
}

function num(v: string | null | undefined, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/* ==================== Word（docx-preview） ==================== */

const DOCX_CSS = `
body { background: #f3f4f2; }
.docx-wrapper { padding: 18px 10px 40px !important; background: #f3f4f2 !important; }
.docx-wrapper > section.docx { box-shadow: 0 2px 14px rgba(0,0,0,.12); margin: 0 auto 22px !important; }
.docx-wrapper > section.docx > * { box-sizing: border-box; }
`;

export async function renderDocx(bytes: Uint8Array): Promise<string> {
  const bodyHost = document.createElement('div');
  const styleHost = document.createElement('div');
  await renderAsync(new Blob([bytes as BlobPart]), bodyHost, styleHost, {
    className: 'docx', inWrapper: true, ignoreWidth: false, ignoreHeight: false,
    ignoreFonts: false, breakPages: true, useBase64URL: true,
    renderHeaders: true, renderFooters: true, renderFootnotes: true,
    renderEndnotes: true, experimental: true, debug: false,
  });
  // styleHost 里是 docx-preview 自己 append 的 <style> 节点，直接放进 head。
  return htmlPage(bodyHost.innerHTML, DOCX_CSS, styleHost.innerHTML);
}

/* ==================== Excel（OOXML 样式还原） ==================== */

const SHEET_CSS = `
body { padding: 0; overflow-x: auto; }
.zj-tabs { position: sticky; top: 0; z-index: 5; display: flex; gap: 4px; flex-wrap: wrap;
  padding: 8px 10px; background: #f7f8f7; border-bottom: 1px solid #dfe5e1; }
.zj-tabs button { border: 1px solid transparent; border-radius: 5px 5px 0 0; padding: 5px 12px;
  background: transparent; color: #55635c; font: 600 12px/1.4 inherit; cursor: pointer; }
.zj-tabs button.on { background: #fff; border-color: #dfe5e1; border-bottom-color: #fff; color: #137a5e; }
.zj-sheet { display: none; padding: 12px; }
.zj-sheet.on { display: block; }
.zj-sheetname { margin: 0 0 8px; font-size: 12px; color: #6b7770; }
table.zj-grid { border-collapse: collapse; table-layout: fixed; background: #fff; font-family: Calibri, "Microsoft YaHei", sans-serif; }
table.zj-grid td { overflow: hidden; padding: 1px 4px; vertical-align: middle; }
table.zj-grid .zj-head { position: sticky; top: 0; }
.zj-rownum { background: #f5f7f5 !important; color: #8b958f; text-align: center; font-size: 10px; min-width: 34px; width: 34px; }
`;
const SHEET_JS = `
document.addEventListener('click', function (e) {
  var b = e.target.closest ? e.target.closest('[data-tab]') : null;
  if (!b) return;
  var i = b.getAttribute('data-tab');
  document.querySelectorAll('.zj-tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
  document.querySelectorAll('.zj-sheet').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-sheet') === i); });
});
`;

interface CellStyle { css: string; fmt: string }
interface GridCell { html: string; css: string; colSpan: number; rowSpan: number; skip: boolean }

/** 列字母 A1 / AB12 → 0 基列号。 */
function colIndex(ref: string): number {
  const m = /^([A-Z]+)/i.exec(ref || '');
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel 序列号 → 日期字符串（1900 日期系统）。 */
function serialDate(n: number, fmt: string): string {
  if (n < 1 || n > 2958465) return '';
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  const frac = n - Math.floor(n);
  const p = (v: number) => String(v).padStart(2, '0');
  const y = d.getUTCFullYear(), mo = p(d.getUTCMonth() + 1), da = p(d.getUTCDate());
  const hasTime = /[hHsS]/.test(fmt);
  let time = '';
  if (hasTime) {
    const sec = Math.round(frac * 86400);
    time = ` ${p(Math.floor(sec / 3600))}:${p(Math.floor(sec % 3600 / 60))}:${p(sec % 60)}`;
    if (!/[sS]/.test(fmt)) time = time.slice(0, 5);
  }
  if (/mmm/i.test(fmt)) {
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    return `${da}-${mon}-${String(y).slice(2)}${time}`;
  }
  if (/^d[-\/]/.test(fmt)) return `${da}/${mo}/${y}${time}`;
  return `${y}-${mo}-${da}${time}`;
}

function formatValue(raw: string, fmt: string): string {
  if (raw === '' || !Number.isFinite(Number(raw))) return raw;
  const n = Number(raw);
  const f = (fmt || 'General').toLowerCase();
  if (n > 20000 && n < 80000 && /[ymd]/.test(f) && !f.includes('general')) {
    const d = serialDate(n, fmt);
    if (d) return d;
  }
  if (f.includes('%')) {
    const dec = (f.match(/0\.(0+)/) || [])[1]?.length ?? 0;
    return (n * 100).toFixed(dec) + '%';
  }
  if (/^#,##0/.test(f) || /^0(\.0+)?$/.test(f)) {
    const dec = (f.match(/\.(0+)/) || [])[1]?.length ?? 0;
    return n.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  if (f === '0' || f === 'general') return String(n);
  return raw;
}

const BUILTIN_FMT: Record<number, string> = {
  0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%',
  14: 'mm/dd/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yy h:mm', 37: '#,##0',
  38: '#,##0', 39: '#,##0.00', 40: '#,##0.00', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 49: '@',
};

function borderCss(border: Element | undefined): string {
  if (!border) return '';
  return (['left', 'right', 'top', 'bottom'] as const).map((side) => {
    const el = kids(border, side)[0];
    const st = el?.getAttribute('style') || '';
    if (!st || st === 'none') return '';
    const w = st === 'thick' ? '3px' : st === 'medium' ? '2px' : '1px';
    const kind = /double/.test(st) ? 'double' : /dash/.test(st) ? 'dashed' : /dot/.test(st) ? 'dotted' : 'solid';
    return `border-${side}:${w} ${kind} ${colorFrom(el) || '#c9d2cc'}`;
  }).filter(Boolean).join(';');
}

function parseCellXfs(doc: Document): CellStyle[] {
  const fmtMap: Record<number, string> = { ...BUILTIN_FMT };
  for (const n of all(doc, 'numFmt')) {
    const id = num(n.getAttribute('numFmtId'), -1);
    if (id >= 0) fmtMap[id] = n.getAttribute('formatCode') || 'General';
  }
  const fonts = first(doc, 'fonts');
  const fills = first(doc, 'fills');
  const borders = first(doc, 'borders');
  const xfsRoot = first(doc, 'cellXfs');
  const fontEls = kids(fonts, 'font');
  const fillEls = kids(fills, 'fill');
  const borderEls = kids(borders, 'border');
  const out: CellStyle[] = [];
  for (const xf of kids(xfsRoot, 'xf')) {
    const fi = num(xf.getAttribute('fontId'));
    const fl = num(xf.getAttribute('fillId'));
    const bi = num(xf.getAttribute('borderId'));
    const nf = num(xf.getAttribute('numFmtId'));
    const f = fontEls[fi];
    const parts: string[] = [];
    if (f) {
      const sz = attr(first(f, 'sz'), 'val');
      const face = attr(first(f, 'name'), 'val', 'Calibri');
      // 字体名只能用单引号：style 属性本身用双引号包着，这里出现双引号会
      // 提前截断属性，后面的底色 / 边框 / 对齐全部被浏览器丢掉。
      parts.push(`font-family:'${face.replace(/['"]/g, '')}','Microsoft YaHei',sans-serif`, `font-size:${sz || 11}pt`);
      if (first(f, 'b')) parts.push('font-weight:700');
      if (first(f, 'i')) parts.push('font-style:italic');
      if (first(f, 'u')) parts.push('text-decoration:underline');
      const c = colorFrom(first(f, 'color'));
      if (c) parts.push(`color:${c}`);
    }
    const fill = fillEls[fl];
    const fg = fill ? (all(fill, 'fgColor')[0] || first(fill, 'fgColor')) : undefined;
    if (fg) {
      const c = colorFrom(fg);
      if (c) parts.push(`background-color:${c}`);
    }
    const bd = borderCss(borderEls[bi]);
    if (bd) parts.push(bd);
    const align = kids(xf, 'alignment')[0] || all(xf, 'alignment')[0];
    if (align) {
      const h = align.getAttribute('horizontal');
      const v = align.getAttribute('vertical');
      const wrap = align.getAttribute('wrapText');
      if (h && h !== 'general') parts.push(`text-align:${h === 'center' ? 'center' : h}`);
      if (v) parts.push(`vertical-align:${v === 'center' ? 'middle' : v}`);
      parts.push(`white-space:${wrap === '1' ? 'pre-wrap' : 'nowrap'}`);
    } else {
      parts.push('white-space:nowrap');
    }
    parts.push('overflow:hidden', 'text-overflow:ellipsis');
    out.push({ css: parts.join(';'), fmt: fmtMap[nf] || 'General' });
  }
  return out;
}

async function renderWorkbook(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const read = async (p: string) => (await zip.file(p)?.async('string')) || '';
  const sharedXml = xdoc(await read('xl/sharedStrings.xml'));
  const strings = all(sharedXml, 'si').map((si) => all(si, 't').map((t) => t.textContent || '').join(''));
  const styles = parseCellXfs(xdoc(await read('xl/styles.xml')));
  const wb = xdoc(await read('xl/workbook.xml'));
  const rels = xdoc(await read('xl/_rels/workbook.xml.rels'));
  const relMap = new Map<string, string>();
  for (const r of all(rels, 'Relationship')) relMap.set(r.getAttribute('Id') || '', r.getAttribute('Target') || '');
  const sheets = all(wb, 'sheet').map((s) => ({
    name: s.getAttribute('name') || '工作表',
    rid: s.getAttribute('r:id') || s.getAttribute('id') || '',
  }));
  const targets = sheets.map((s) => {
    const t = relMap.get(s.rid) || '';
    return t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
  });
  if (!targets.length) targets.push('xl/worksheets/sheet1.xml');

  const tabs: string[] = [], bodies: string[] = [];
  for (let si = 0; si < targets.length; si++) {
    const xml = xdoc(await read(targets[si]));
    const cols: { min: number; max: number; w: number }[] = all(xml, 'col').map((c) => ({
      min: num(c.getAttribute('min'), 1), max: num(c.getAttribute('max'), 1),
      w: num(c.getAttribute('width'), 8.43),
    }));
    const merges = all(xml, 'mergeCell').map((m) => m.getAttribute('ref') || '').filter(Boolean);
    const rowEls = all(xml, 'row');
    const maxCols = Math.max(1, ...rowEls.flatMap((r) => kids(r, 'c').map((c) => colIndex(c.getAttribute('r') || '') + 1)), 3);
    const rows: GridCell[][] = [];
    const cap = Math.min(rowEls.length, 500);

    for (let ri = 0; ri < cap; ri++) {
      const row = rowEls[ri];
      const cells: GridCell[] = Array.from({ length: maxCols }, () => ({ html: '', css: '', colSpan: 1, rowSpan: 1, skip: false }));
      const ht = num(row.getAttribute('ht'), 0);
      for (const c of kids(row, 'c')) {
        const ci = colIndex(c.getAttribute('r') || '');
        if (ci >= maxCols) continue;
        const st = styles[num(c.getAttribute('s'))] || { css: '', fmt: 'General' };
        const t = c.getAttribute('t') || '';
        const vEl = kids(c, 'v')[0];
        const raw = vEl?.textContent || '';
        let val = '';
        if (t === 's') val = strings[Number(raw)] ?? '';
        else if (t === 'inlineStr') val = all(c, 't').map((x) => x.textContent || '').join('');
        else if (t === 'b') val = raw === '1' ? 'TRUE' : 'FALSE';
        else if (t === 'e') val = raw;
        else if (t === 'str' || t === 'd') val = raw;
        else val = formatValue(raw, st.fmt);
        cells[ci] = { html: esc(val), css: st.css, colSpan: 1, rowSpan: 1, skip: false };
      }
      rows.push(cells);
      if (ht) (rows[ri] as GridCell[] & { height?: number }).height = ht;
    }

    // 合并单元格：左上角撑开，被盖住的格子渲染时跳过。
    for (const ref of merges) {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(ref);
      if (!m) continue;
      const c1 = colIndex(m[1]), r1 = Number(m[2]) - 1, c2 = colIndex(m[3]), r2 = Number(m[4]) - 1;
      if (!rows[r1]?.[c1]) continue;
      rows[r1][c1].colSpan = Math.max(1, Math.min(c2 - c1 + 1, maxCols - c1));
      rows[r1][c1].rowSpan = Math.max(1, Math.min(r2 - r1 + 1, cap - r1));
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        if (r === r1 && c === c1) continue;
        if (rows[r]?.[c]) rows[r][c].skip = true;
      }
    }

    const colgroup = Array.from({ length: maxCols }, (_, i) => {
      const c = cols.find((x) => i + 1 >= x.min && i + 1 <= x.max);
      return `<col style="width:${Math.round((c?.w ?? 8.43) * 7 + 5)}px">`;
    }).join('');
    const trs = rows.map((cells, ri) => {
      const h = (rows[ri] as GridCell[] & { height?: number }).height;
      const tds = cells.map((cell, ci) => {
        if (cell.skip) return '';
        const span = (cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : '')
          + (cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : '');
        return `<td${span} style="${cell.css}">${cell.html}</td>`;
      }).join('');
      return `<tr${h ? ` style="height:${Math.round(h * 4 / 3)}px"` : ''}>`
        + `<td class="zj-rownum">${ri + 1}</td>${tds}</tr>`;
    }).join('');
    tabs.push(`<button data-tab="${si}" class="${si === 0 ? 'on' : ''}">${esc(sheets[si]?.name || `工作表 ${si + 1}`)}</button>`);
    // 只在真的被截断时提示，别在文档里塞不属于原文件的说明文字。
    const clipped = rowEls.length > 500
      ? `<p class="zj-sheetname">仅显示前 500 行（原表共 ${rowEls.length} 行），完整内容请用本机程序打开</p>` : '';
    bodies.push(`<div class="zj-sheet ${si === 0 ? 'on' : ''}" data-sheet="${si}">`
      + clipped
      + `<table class="zj-grid"><colgroup><col style="width:34px">${colgroup}</colgroup><tbody>${trs}</tbody></table></div>`);
  }
  return htmlPage(`<div class="zj-tabs">${tabs.join('')}</div>${bodies.join('')}`, SHEET_CSS, '', SHEET_JS);
}

/* ==================== PowerPoint（EMU 坐标还原） ==================== */

const SLIDE_CSS = `
body { background: #ecefec; padding: 18px 0 40px; }
.zj-slide { position: relative; margin: 0 auto 18px; overflow: hidden; background: #fff;
  box-shadow: 0 3px 16px rgba(0,0,0,.16); transform-origin: top left; }
.zj-slide > .zj-item { position: absolute; overflow: hidden; }
.zj-item p { margin: 0; line-height: 1.35; word-break: break-word; }
.zj-item img { width: 100%; height: 100%; object-fit: fill; }
.zj-slide-no { position: absolute; right: 8px; bottom: 6px; font-size: 10px; color: #9aa5a0; }
`;
/** 幻灯片按 EMU 比例画在 900px 的画布上；弹窗比它窄时用 zoom 整体缩放，
 *  保证不用横向滚动就能看完整页。Chromium / WebView2 都支持元素级 zoom。 */
const SLIDE_JS = `
function zjFit() {
  var s = Math.min(1, (document.documentElement.clientWidth - 36) / 900);
  document.querySelectorAll('.zj-slide').forEach(function (el) { el.style.zoom = String(s); });
}
zjFit();
window.addEventListener('resize', zjFit);
`;

function relAttr(el: Element, name: string): string {
  return el.getAttribute(`r:${name}`) || el.getAttribute(name)
    || el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', name) || '';
}

function resolveRel(from: string, target: string): string {
  const base = from.replace(/\/[^/]+$/, '');
  const parts = `${base}/${target}`.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

function textStyle(rPr: Element | undefined, fallbackSize: string): string {
  const s: string[] = [];
  const sz = rPr?.getAttribute('sz');
  s.push(`font-size:${sz ? `${(num(sz) / 100 * 4 / 3).toFixed(1)}px` : fallbackSize}`);
  if (rPr?.getAttribute('b') === '1') s.push('font-weight:700');
  if (rPr?.getAttribute('i') === '1') s.push('font-style:italic');
  if (rPr?.getAttribute('u') && rPr.getAttribute('u') !== 'none') s.push('text-decoration:underline');
  const fill = rPr ? (kids(rPr, 'solidFill')[0] || all(rPr, 'solidFill')[0]) : undefined;
  const c = colorFrom(fill);
  if (c) s.push(`color:${c}`);
  const latin = rPr ? first(rPr, 'latin') : undefined;
  if (latin?.getAttribute('typeface')) {
    s.push(`font-family:'${latin.getAttribute('typeface')!.replace(/['"]/g, '')}','Microsoft YaHei',sans-serif`);
  }
  return s.join(';');
}

async function renderSlides(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const read = async (p: string) => (await zip.file(p)?.async('string')) || '';
  const pres = xdoc(await read('ppt/presentation.xml'));
  const sz = all(pres, 'sldSz')[0];
  const cx = num(sz?.getAttribute('cx'), 9144000), cy = num(sz?.getAttribute('cy'), 6858000);
  const W = 900, scale = W / cx, H = Math.round(cy * scale);

  const slidePaths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => num(/slide(\d+)/.exec(a)?.[1]) - num(/slide(\d+)/.exec(b)?.[1]));

  const html: string[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const path = slidePaths[i];
    const xml = xdoc(await read(path));
    const rels = xdoc(await read(path.replace('/slides/', '/slides/_rels/') + '.rels'));
    const relMap = new Map<string, string>();
    for (const r of all(rels, 'Relationship')) relMap.set(r.getAttribute('Id') || '', r.getAttribute('Target') || '');
    // 图片先转成 data URL，iframe 里才能显示。
    const imgCache = new Map<string, string>();
    const imgUrl = async (rid: string): Promise<string> => {
      if (imgCache.has(rid)) return imgCache.get(rid)!;
      const target = relMap.get(rid);
      if (!target) return '';
      const p = resolveRel(path, target);
      const b = await zip.file(p)?.async('base64');
      const url = b ? `data:${guessMime(p, '', 'image')};base64,${b}` : '';
      imgCache.set(rid, url);
      return url;
    };

    const bg = first(xml, 'bg');
    const bgFill = bg ? (all(bg, 'solidFill')[0] || all(bg, 'gradFill')[0]) : undefined;
    const bgColor = colorFrom(bgFill) || '#ffffff';
    const tree = first(xml, 'spTree');
    const items: string[] = [];
    for (const shape of (tree?.children ? Array.from(tree.children) : [])) {
      if (!['sp', 'pic', 'graphicFrame', 'cxnSp'].includes(shape.localName)) continue;
      const spPr = kids(shape, 'spPr')[0] || all(shape, 'spPr')[0];
      const xfrm = spPr ? (kids(spPr, 'xfrm')[0] || all(spPr, 'xfrm')[0]) : undefined;
      const off = xfrm ? first(xfrm, 'off') : undefined;
      const ext = xfrm ? first(xfrm, 'ext') : undefined;
      const x = Math.round(num(off?.getAttribute('x')) * scale);
      const y = Math.round(num(off?.getAttribute('y')) * scale);
      const w = Math.max(1, Math.round(num(ext?.getAttribute('cx')) * scale));
      const h = Math.max(1, Math.round(num(ext?.getAttribute('cy')) * scale));
      if (!w || !h || x > W || y > H) continue;

      let inner = '';
      if (shape.localName === 'pic') {
        const blip = all(shape, 'blip')[0];
        const url = blip ? await imgUrl(relAttr(blip, 'embed')) : '';
        inner = url ? `<img src="${url}" alt="">` : '';
      } else {
        const txBody = kids(shape, 'txBody')[0] || all(shape, 'txBody')[0];
        const paras = txBody ? kids(txBody, 'p') : [];
        inner = paras.map((p) => {
          const pPr = kids(p, 'pPr')[0];
          const algn = pPr?.getAttribute('algn') || '';
          const align = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : 'left';
          const runs: string[] = [];
          for (const r of Array.from(p.children)) {
            if (r.localName === 'br') { runs.push('<br>'); continue; }
            if (!['r', 'fld'].includes(r.localName)) continue;
            const rPr = kids(r, 'rPr')[0];
            const t = kids(r, 't')[0]?.textContent || '';
            runs.push(`<span style="${textStyle(rPr, `${Math.max(12, Math.round(h / Math.max(paras.length, 1) / 1.5))}px`)}">${esc(t)}</span>`);
          }
          return `<p style="text-align:${align}">${runs.join('') || '&nbsp;'}</p>`;
        }).join('');
      }
      const fill = spPr ? (kids(spPr, 'solidFill')[0] || all(spPr, 'solidFill')[0]) : undefined;
      const shapeBg = colorFrom(fill);
      const box = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`
        + (shapeBg ? `background:${shapeBg};` : '')
        + `display:flex;flex-direction:column;justify-content:center;`;
      items.push(`<div class="zj-item" style="${box}">${inner}</div>`);
    }
    html.push(`<div class="zj-slide" style="width:${W}px;height:${H}px;background:${bgColor}">`
      + items.join('') + `<span class="zj-slide-no">${i + 1} / ${slidePaths.length}</span></div>`);
  }
  return htmlPage(html.join(''), SLIDE_CSS, '', SLIDE_JS);
}

/* ==================== CSV / TSV / Markdown / 文本 / HTML ==================== */

function parseDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function renderDelimited(text: string, sep: string): string {
  const rows = parseDelimited(text, sep).slice(0, 500);
  if (!rows.length) return htmlPage('<p class="zj-note">（空表格）</p>');
  const body = rows.map((r, i) => `<tr>${r.map((c) => i === 0
    ? `<th style="border:1px solid #dfe5e1;padding:5px 9px;background:#f3f6f4;text-align:left;white-space:nowrap">${esc(c)}</th>`
    : `<td style="border:1px solid #e8ece9;padding:5px 9px;white-space:nowrap">${esc(c)}</td>`).join('')}</tr>`).join('');
  return htmlPage(`<div style="padding:12px;overflow:auto"><table style="border-collapse:collapse;font-size:12px">${body}</table></div>`);
}

const MD_CSS = `
body { padding: 26px 32px 60px; line-height: 1.85; font-size: 14px; }
article { max-width: 860px; margin: 0 auto; }
h1,h2,h3,h4,h5,h6 { line-height: 1.4; margin: 1.4em 0 .6em; color: #16241e; }
h1 { font-size: 26px; border-bottom: 1px solid #e4eae6; padding-bottom: 8px; }
h2 { font-size: 21px; } h3 { font-size: 17px; }
p { margin: 0 0 12px; } ul,ol { padding-left: 24px; margin: 0 0 12px; }
blockquote { margin: 12px 0; padding: 8px 16px; border-left: 3px solid #13c2c2; background: #f5faf9; color: #4a5b53; }
code { background: #f1f4f2; padding: 1px 5px; border-radius: 4px; font-family: Consolas, monospace; font-size: .9em; }
pre { background: #1f2a25; color: #e6f0ea; padding: 14px 16px; border-radius: 8px; overflow: auto; }
pre code { background: transparent; color: inherit; padding: 0; }
table { border-collapse: collapse; margin: 12px 0; width: 100%; }
th,td { border: 1px solid #dfe5e1; padding: 7px 11px; text-align: left; }
th { background: #f3f6f4; }
img { max-width: 100%; border-radius: 6px; }
hr { border: 0; border-top: 1px solid #e4eae6; margin: 22px 0; }
input[type=checkbox] { margin-right: 6px; }
`;

export function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
  const clean = DOMPurify.sanitize(raw, {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    ADD_ATTR: ['class', 'target', 'checked', 'type', 'align'],
  }) as string;
  return htmlPage(`<article>${clean}</article>`, MD_CSS);
}

export function renderPlainText(text: string): string {
  return htmlPage(
    `<pre style="margin:0;padding:16px 18px;white-space:pre-wrap;word-break:break-word;`
    + `font-family:Consolas,'Microsoft YaHei',monospace;font-size:12.5px;line-height:1.8">${esc(text || '（空文件）')}</pre>`,
    'body { padding: 12px; }',
  );
}

/** HTML 附件：直接用原始文档渲染，不删样式、不删脚本。
 *  弹窗用 sandbox（allow-scripts 但不 allow-same-origin）隔离，
 *  脚本跑在 opaque origin 里，碰不到应用页面与本地存档。 */
export function rawHtmlPage(raw: string): string {
  if (/<html[\s>]/i.test(raw)) {
    return /<meta[^>]+charset=/i.test(raw) ? raw
      : raw.replace(/<head([^>]*)>/i, '<head$1><meta charset="utf-8">');
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body>${raw}</body></html>`;
}

/* ==================== 统一入口 ==================== */

export interface PreviewResult { html?: string; error?: string }

/** 根据扩展名把附件字节渲染成完整 HTML 文档。失败时给 error，弹窗退回信息卡。 */
export async function buildDocPreview(name: string, bytes: Uint8Array, text: string): Promise<PreviewResult> {
  const e = extOf(name);
  try {
    if (/^(docx|docm|dotx)$/.test(e)) {
      if (bytes.length < 4 || bytes[0] !== 0x50) return { error: '这不是标准 DOCX（旧版 .doc 请先另存为 .docx）' };
      return { html: await renderDocx(bytes) };
    }
    if (/^(xlsx|xlsm)$/.test(e)) return { html: await renderWorkbook(bytes) };
    if (/^(pptx|pptm|ppsx)$/.test(e)) return { html: await renderSlides(bytes) };
    if (/^(html|htm|mhtml)$/.test(e)) return { html: rawHtmlPage(text || new TextDecoder('utf-8').decode(bytes)) };
    if (/^(md|markdown)$/.test(e)) return { html: renderMarkdown(text) };
    if (/^(csv|tsv)$/.test(e)) return { html: renderDelimited(text, e === 'tsv' ? '\t' : ',') };
    if (/^(txt|log|json|xml|yaml|yml|js|ts|jsx|tsx|css|scss|py|java|go|rs|sql|sh|bat|ini|conf)$/.test(e)) {
      return { html: renderPlainText(text) };
    }
  } catch (err) {
    return { error: `解析失败：${String(err)}` };
  }
  return { error: '这个格式暂不支持内嵌预览' };
}
