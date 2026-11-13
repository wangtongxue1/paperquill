import type { Note } from './types';

/** 从笔记正文里抽出待办。富文本用字符串处理（不走 DOMPurify，避免 input 被清洗）。
 *  索引按「这篇笔记里的第几个待办」计，勾选时据此回写，不依赖 DOM 状态。 */
export interface TaskItem {
  noteId: string;
  noteTitle: string;
  index: number;
  text: string;
  done: boolean;
  source: 'md' | 'html';
  updatedAt: number;
}

const MD_TASK = /^(\s*)[-*+]\s+\[([ xX])\]\s*(.*)$/;
const LI_RE = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
const CB_RE = /<input\b[^>]*type=["']?checkbox[^>]*>/i;

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function collectTasks(notes: Note[]): TaskItem[] {
  const out: TaskItem[] = [];
  for (const note of notes) {
    if (note.trashed) continue;
    if (note.mode === 'markdown') {
      let idx = 0;
      for (const line of note.content.split('\n')) {
        const m = line.match(MD_TASK);
        if (!m) continue;
        out.push({
          noteId: note.id, noteTitle: note.title || '未命名笔记', index: idx++,
          text: m[3].trim(), done: m[2].toLowerCase() === 'x', source: 'md',
          updatedAt: note.updatedAt,
        });
      }
    } else {
      let idx = 0;
      let m: RegExpExecArray | null;
      LI_RE.lastIndex = 0;
      while ((m = LI_RE.exec(note.content))) {
        const cb = m[1].match(CB_RE);
        if (!cb) continue;
        out.push({
          noteId: note.id, noteTitle: note.title || '未命名笔记', index: idx++,
          text: stripTags(m[1].replace(CB_RE, '')),
          done: /\bchecked\b/i.test(cb[0]), source: 'html',
          updatedAt: note.updatedAt,
        });
      }
    }
  }
  return out.sort((a, b) => Number(a.done) - Number(b.done) || b.updatedAt - a.updatedAt);
}

/** 勾选 / 取消勾选后返回新的正文；找不到对应项时原样返回。 */
export function toggleTaskContent(note: Note, index: number): string {
  if (note.mode === 'markdown') {
    let seen = -1;
    return note.content.split('\n').map((line) => {
      const m = line.match(MD_TASK);
      if (!m) return line;
      seen += 1;
      if (seen !== index) return line;
      return line.replace(/\[([ xX])\]/, (_all, c: string) =>
        c.toLowerCase() === 'x' ? '[ ]' : '[x]');
    }).join('\n');
  }

  let seen = -1;
  LI_RE.lastIndex = 0;
  return note.content.replace(LI_RE, (whole, inner: string) => {
    const cb = inner.match(CB_RE);
    if (!cb) return whole;
    seen += 1;
    if (seen !== index) return whole;
    const old = cb[0];
    const next = /\bchecked\b/i.test(old)
      ? old.replace(/\s*checked(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/i, '')
      : old.replace(/\/?>$/, (tail) => ` checked${tail}`);
    return whole.replace(old, next);
  });
}

/** 列表缩略图：优先用附件里的第一张图，其次用正文里第一张 data URL / 普通图片。 */
export function thumbnailOf(note: Note): string {
  const att = (note.attachments || []).find((a) => a.kind === 'image' && a.dataUrl);
  if (att) return att.dataUrl;
  const m = note.content.match(/<img\b[^>]*src=["']([^"']+)["']/i)
    || note.content.match(/!\[[^\]]*\]\(([^)\s]+)\)/);
  const src = m?.[1] || '';
  return src && !src.startsWith('zhijian-attachment:') ? src : '';
}

/** 查找替换：Markdown 直接换字符串；HTML 只替换标签外的文本节点，不破坏标签与属性。 */
export function replaceInContent(
  content: string, mode: Note['mode'], find: string, replacement: string, all: boolean
): { content: string; count: number } {
  if (!find) return { content, count: 0 };
  if (mode === 'markdown') {
    let count = 0;
    const esc = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(esc, all ? 'gi' : 'i');
    const next = content.replace(re, () => { count += 1; return replacement; });
    return { content: next, count };
  }
  let count = 0;
  const esc = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc, all ? 'gi' : 'i');
  // 把 HTML 切成「标签」和「文本」交替的片段，只改文本片段。
  const next = content.replace(/(<[^>]*>)|([^<]+)/g, (_m, tag: string | undefined, text: string | undefined) => {
    if (tag !== undefined) return tag;
    if (text === undefined) return '';
    if (!text || (count > 0 && !all)) return text;
    return text.replace(re, () => { count += 1; return replacement; });
  });
  return { content: next, count };
}

export function countInContent(content: string, mode: Note['mode'], find: string): number {
  if (!find) return 0;
  const esc = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hay = mode === 'rich' ? content.replace(/<[^>]*>/g, ' ') : content;
  return (hay.match(new RegExp(esc, 'gi')) || []).length;
}
