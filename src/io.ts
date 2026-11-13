import JSZip from 'jszip';
import type { Note, Workspace } from './types';
import { convertContent, htmlToMd, mdToHtml, resolveAttachmentRefs, sanitizeHtml, standaloneHtml } from './convert';
import { formatDateTime, htmlToText, mdToText, slugify, uid, escapeHtml } from './utils';

export type ExportFormat = 'md' | 'html' | 'txt' | 'enex';

function metaOf(note: Note): string {
  const bits = [`纸间笔记 · ${formatDateTime(note.updatedAt)}`];
  if (note.tags.length) bits.push(`标签：${note.tags.join('、')}`);
  if (note.sourceUrl) bits.push(`来源：${note.sourceUrl}`);
  return bits.join('　');
}

export function noteAsMarkdown(note: Note): string {
  // 导出的单篇文件必须自包含：正文的短引用要还原成 data URL。
  // 富文本转 Markdown 时 turndown 会把图片写回短引用，所以还原两次。
  const raw = resolveAttachmentRefs(note.content, note.attachments);
  const body = note.mode === 'markdown'
    ? raw
    : resolveAttachmentRefs(htmlToMd(raw, note.attachments), note.attachments);
  const head = [`# ${note.title || '未命名笔记'}`, ''];
  if (note.tags.length) head.push(`> 标签：${note.tags.map((t) => `#${t}`).join(' ')}`, '');
  if (note.sourceUrl) head.push(`> 来源：${note.sourceUrl}`, '');
  return [...head, body].join('\n').trim() + '\n';
}

export function noteAsHtml(note: Note): string {
  const body = note.mode === 'rich' ? note.content : mdToHtml(note.content, note.attachments);
  return standaloneHtml(note.title || '未命名笔记', body, metaOf(note));
}

/** 打印版：A4 版式、隐藏页边信息、避免图片与表格被切开。 */
export function noteAsPrintHtml(note: Note): string {
  const body = note.mode === 'rich' ? note.content : mdToHtml(note.content, note.attachments);
  return standaloneHtml(note.title || '未命名笔记', resolveAttachmentRefs(body, note.attachments), metaOf(note), { print: true });
}

/** 打印：把笔记写进隐藏 iframe 再调系统打印。
 *  真正的 PDF 落盘走 pdf.ts（jsPDF + html2canvas），两条路各管一件事：
 *  打印是「我要纸张」，导出是「我要文件」。 */
export function printNote(note: Note): void {
  const html = noteAsPrintHtml(note);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) { frame.remove(); return; }
  doc.open(); doc.write(html); doc.close();

  const fire = () => {
    const w = frame.contentWindow;
    if (!w) { frame.remove(); return; }
    try { w.focus(); w.print(); } catch { /* 打印被取消 */ }
    // 打印对话框是同步阻塞的，留足时间再清理，避免出现空白页。
    window.setTimeout(() => frame.remove(), 60_000);
  };

  // 图片都是 data URL，等它们 decode 完再打印，PDF 里才不会缺图。
  const waitImages = () => {
    const imgs = Array.from(doc.images || []);
    const pending = imgs.filter((i) => !i.complete);
    if (!pending.length) { window.setTimeout(fire, 80); return; }
    let left = pending.length;
    const tick = () => { left -= 1; if (left <= 0) window.setTimeout(fire, 80); };
    pending.forEach((i) => { i.addEventListener('load', tick); i.addEventListener('error', tick); });
  };
  window.setTimeout(waitImages, 120);
}

function enexTime(ts: number): string {
  return new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** ENEX 是 Evernote 的公开导出格式，用它可以在印象笔记和其它笔记软件之间搬家。 */
export function exportEnex(notes: Note[]): string {
  const items = notes
    .map((n) => {
      const html = (n.mode === 'rich' ? n.content : mdToHtml(n.content, n.attachments))
        .replace(/<br\s*>/gi, '<br/>')
        .replace(/<hr\s*>/gi, '<hr/>')
        .replace(/<(img|input)([^>]*?)\s*\/?>/gi, '<$1$2/>');
      const tags = n.tags.map((t) => `<tag>${xmlEscape(t)}</tag>`).join('');
      return `<note><title>${xmlEscape(n.title || '未命名笔记')}</title><content><![CDATA[<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>${html}</en-note>]]></content><created>${enexTime(n.createdAt)}</created><updated>${enexTime(n.updatedAt)}</updated>${tags}</note>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export3.dtd">\n<en-export export-date="${enexTime(Date.now())}" application="ZhiJian" version="1.0">\n${items}\n</en-export>`;
}

export function exportSingle(note: Note, format: ExportFormat, all?: Note[]): string {
  switch (format) {
    case 'md': return noteAsMarkdown(note);
    case 'html': return noteAsHtml(note);
    case 'txt': return `${note.title}\n\n${note.mode === 'rich' ? htmlToText(note.content) : mdToText(note.content)}\n`;
    case 'enex': return exportEnex(all?.length ? all : [note]);
  }
}

export function exportBackup(ws: Workspace): string {
  return JSON.stringify(ws, null, 2);
}

/** 整库 Markdown 打包：每个笔记本一个目录，附一份备份 JSON。 */
export async function exportMarkdownZip(ws: Workspace): Promise<string> {
  const zip = new JSZip();
  const byId = new Map(ws.notebooks.map((nb) => [nb.id, nb.name]));
  const root = zip.folder('纸间笔记导出')!;
  const seen = new Map<string, number>();

  for (const note of ws.notes.filter((n) => !n.trashed)) {
    const folder = note.notebookId ? byId.get(note.notebookId) || '未分类' : '未分类';
    const base = slugify(note.title || '未命名笔记');
    const count = (seen.get(`${folder}/${base}`) ?? 0) + 1;
    seen.set(`${folder}/${base}`, count);
    const name = `${base}${count > 1 ? `-${count}` : ''}.md`;
    root.folder(folder)!.file(name, noteAsMarkdown(note));
  }
  root.file('workspace-backup.json', exportBackup(ws));
  root.file(
    'README.txt',
    `纸间笔记导出 · ${formatDateTime(Date.now())}\n\n` +
    `每篇笔记是一个独立的 Markdown 文件，按笔记本分目录。\n` +
    `workspace-backup.json 是完整备份，可以在纸间笔记里「导入 → 恢复备份」原样还原（含标签、提醒、回收站）。\n`
  );
  return await zip.generateAsync({ type: 'base64' });
}

/* ------------------------------ 导入 ------------------------------ */

function makeNote(partial: Partial<Note> & Pick<Note, 'title' | 'content' | 'mode'>): Note {
  const t = Date.now();
  return {
    id: uid('note'), title: partial.title, content: partial.content, mode: partial.mode,
    notebookId: partial.notebookId ?? null,
    tags: partial.tags ?? [],
    createdAt: partial.createdAt ?? t,
    updatedAt: partial.updatedAt ?? t,
    pinned: false, favorite: false, trashed: false, trashedAt: null,
    reminderAt: null, reminderDone: false,
    sourceUrl: partial.sourceUrl ?? '',
    attachments: [],
  };
}

function parseEnexTime(s: string): number | undefined {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return undefined;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

function parseEnex(xml: string): Note[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('ENEX 文件无法解析');
  return Array.from(doc.querySelectorAll('note')).map((el) => {
    const title = el.querySelector('title')?.textContent || '导入的笔记';
    const raw = el.querySelector('content')?.textContent || '';
    // CDATA 里是 en-note 文档，剥掉外层包装，只保留正文 HTML。
    let html = raw.replace(/^[\s\S]*?<en-note[^>]*>/i, '').replace(/<\/en-note>[\s\S]*$/i, '');
    html = sanitizeHtml(html);
    const tags = Array.from(el.querySelectorAll('tag')).map((t) => t.textContent?.trim() || '').filter(Boolean);
    const created = parseEnexTime(el.querySelector('created')?.textContent?.trim() || '');
    const updated = parseEnexTime(el.querySelector('updated')?.textContent?.trim() || '');
    // ENEX 正文本来就是 HTML，直接进富文本，不要再折一趟 Markdown（会丢样式）。
    return makeNote({
      title,
      content: html,
      mode: 'rich',
      tags,
      createdAt: created,
      updatedAt: updated ?? created,
    });
  });
}

export interface ImportResult {
  notes?: Note[];
  workspace?: Workspace;
  label: string;
}

export async function parseImport(file: File): Promise<ImportResult> {
  const text = await file.text();
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.json')) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed.notes) && parsed.settings) {
      return { workspace: parsed as Workspace, label: '完整备份' };
    }
    throw new Error('这个 JSON 不是纸间笔记备份文件');
  }

  if (lower.endsWith('.enex') || lower.endsWith('.xml')) {
    const notes = parseEnex(text);
    return { notes, label: `${notes.length} 篇 ENEX 笔记` };
  }

  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    const clean = sanitizeHtml(text);
    const doc = new DOMParser().parseFromString(clean, 'text/html');
    doc.querySelectorAll('script,style,nav,footer,header,aside,iframe').forEach((n) => n.remove());
    const title = doc.querySelector('title')?.textContent?.trim() || file.name.replace(/\.[^.]+$/, '');
    const body = doc.body?.innerHTML.trim() || clean;
    return {
      notes: [makeNote({ title, content: body, mode: 'rich' })],
      label: '1 篇 HTML 笔记',
    };
  }

  // Markdown / 纯文本：进来就转成富文本 HTML。
  // 「所有内容进笔记后默认富文本」是产品约定——源码视图是随手要看时才切过去的。
  return {
    notes: [makeNote({
      title: file.name.replace(/\.[^.]+$/, ''),
      content: mdToHtml(text),
      mode: 'rich',
    })],
    label: '1 篇 Markdown / 文本笔记',
  };
}

/** 把导入的内容并进一篇已有笔记。
 *  replace=覆盖正文；append=接在末尾（分一条分割线）。
 *  附件与标签一起合并，富文本/源码两种模式都能用。 */
export function mergeIntoNote(
  target: Note,
  incoming: Note,
  how: 'replace' | 'append'
): Pick<Note, 'content' | 'mode' | 'attachments'> {
  const mode = target.mode;
  const body = incoming.mode === mode
    ? incoming.content
    : convertContent(incoming.content, incoming.mode, mode, incoming.attachments);

  if (how === 'replace') {
    return { content: body, mode, attachments: incoming.attachments || [] };
  }
  const hasText = !!target.content.trim();
  const divider = mode === 'rich' ? '<hr>' : '\n\n---\n\n';
  return {
    content: hasText ? `${target.content}${divider}${body}` : body,
    mode,
    attachments: [...(target.attachments || []), ...(incoming.attachments || [])],
  };
}

/** 剪藏：从粘贴/抓取的 HTML 里抽出正文并转成一篇新笔记。 */
export function clipToNote(html: string, opts: { title?: string; url?: string; asMarkdown?: boolean } = {}): Note {
  const clean = sanitizeHtml(html);
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  doc.querySelectorAll('script,style,nav,footer,header,aside,iframe,form,noscript').forEach((n) => n.remove());
  const title =
    opts.title?.trim() ||
    doc.querySelector('title')?.textContent?.trim() ||
    doc.querySelector('h1')?.textContent?.trim() ||
    '网页剪藏';
  let body = doc.body?.innerHTML.trim() || clean;
  if (opts.url) {
    body = `<p><small>来源：<a href="${escapeHtml(opts.url)}">${escapeHtml(opts.url)}</a></small></p>\n` + body;
  }
  return makeNote({
    title,
    content: opts.asMarkdown ? htmlToMd(body) : body,
    mode: opts.asMarkdown ? 'markdown' : 'rich',
    sourceUrl: opts.url || '',
    tags: ['剪藏'],
  });
}

