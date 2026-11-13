import type { Note } from './types';
import { excerpt, formatDate, plainOf } from './utils';

export interface SearchHit {
  note: Note;
  score: number;
  excerptText: string;
}

export interface QueryFilter {
  key: 'tag' | 'notebook' | 'intitle' | 'created' | 'updated' | 'has' | 'is';
  value: string;
  negate: boolean;
}

export interface ParsedQuery {
  /** 去掉运算符后剩下的自由文本，交给全文检索。 */
  text: string;
  filters: QueryFilter[];
  unknown: string[];
}

/** 支持的语法：tag: notebook: intitle: created: updated: has: is:，前缀 - 表示排除。
 *  例：tag:读书 has:attachment -is:trashed 2026
 *  参考印象笔记高级搜索，但只实现本地数据能判定的部分（没有 OCR / 地理位置 / 云端字段）。 */
export const SYNTAX_HINTS: { token: string; desc: string }[] = [
  { token: 'tag:读书', desc: '含指定标签' },
  { token: 'notebook:会议', desc: '在指定笔记本' },
  { token: 'intitle:周报', desc: '标题包含' },
  { token: 'created:7d', desc: '最近 7 天创建' },
  { token: 'created:>2026-11-01', desc: '某日期之后' },
  { token: 'updated:2026-11-01', desc: '当天修改' },
  { token: 'has:attachment', desc: '有附件' },
  { token: 'has:image', desc: '有图片' },
  { token: 'has:todo', desc: '含待办' },
  { token: 'has:link', desc: '含链接' },
  { token: 'is:pinned', desc: '已置顶' },
  { token: 'is:favorite', desc: '已收藏' },
  { token: 'is:reminder', desc: '设了提醒' },
  { token: '-tag:归档', desc: '排除某标签' },
];

const FILTER_RE = /(-?)(tag|notebook|intitle|created|updated|has|is):("[^"]*"|\S+)/gi;

export function parseQuery(raw: string): ParsedQuery {
  const filters: QueryFilter[] = [];
  const unknown: string[] = [];
  let text = raw;
  const re = new RegExp(FILTER_RE.source, 'gi');
  text = text.replace(re, (_m, neg: string, key: string, value: string) => {
    const k = key.toLowerCase() as QueryFilter['key'];
    const v = value.replace(/^"|"$/g, '').toLowerCase();
    if (!v) return '';
    filters.push({ key: k, value: v, negate: neg === '-' });
    return ' ';
  });
  return { text: text.replace(/\s+/g, ' ').trim(), filters, unknown };
}

/** 列表标题/摘要高亮时只用自由文本，避免把 tag: 这类运算符本身画上 <mark>。 */
export function freeTextOf(raw: string): string {
  return parseQuery(raw).text;
}

function sameDay(ts: number, day: string): boolean {
  return formatDate(ts) === day;
}

function hasClause(note: Note, value: string): boolean {
  const c = note.content.toLowerCase();
  switch (value) {
    case 'attachment': case 'attachments': return (note.attachments?.length || 0) > 0;
    case 'image': case 'images':
      return (note.attachments || []).some((a) => a.kind === 'image') || /<img|!\[[^\]]*\]\(/.test(c);
    case 'link': case 'links': return /<a\s|\[[^\]]*\]\(http/.test(c);
    case 'todo': case 'tasks': case 'checkbox': return /\[[ xX]\]|<input[^>]+type=["']?checkbox/i.test(c);
    case 'table': return /<table|\|\s*---/.test(c);
    case 'tag': case 'tags': return note.tags.length > 0;
    case 'reminder': return !!note.reminderAt;
    case 'code': return /<pre|```/.test(c);
    default: return false;
  }
}

function isClause(note: Note, value: string): boolean {
  switch (value) {
    case 'pinned': return note.pinned;
    case 'favorite': case 'starred': return note.favorite;
    case 'reminder': return !!note.reminderAt && !note.reminderDone;
    case 'trashed': return note.trashed;
    case 'untagged': return note.tags.length === 0;
    case 'rich': return note.mode === 'rich';
    case 'markdown': case 'source': return note.mode === 'markdown';
    default: return false;
  }
}

function dateClause(ts: number, value: string): boolean {
  if (/^\d+d$/.test(value)) {
    const days = Number(value.slice(0, -1));
    return ts >= Date.now() - days * 86_400_000;
  }
  const m = value.match(/^([<>])?(\d{4}-\d{2}-\d{2})$/);
  if (!m) return false;
  const [, op, day] = m;
  if (!op) return sameDay(ts, day);
  const target = new Date(`${day}T00:00:00`).getTime();
  return op === '>' ? ts >= target + 86_400_000 : ts < target;
}

function filterHit(note: Note, f: QueryFilter, notebookName: (id: string | null) => string): boolean {
  let ok = false;
  switch (f.key) {
    case 'tag': ok = note.tags.some((t) => t.toLowerCase().includes(f.value)); break;
    case 'notebook': ok = notebookName(note.notebookId).toLowerCase().includes(f.value); break;
    case 'intitle': ok = (note.title || '').toLowerCase().includes(f.value); break;
    case 'created': ok = dateClause(note.createdAt, f.value); break;
    case 'updated': ok = dateClause(note.updatedAt, f.value); break;
    case 'has': ok = hasClause(note, f.value); break;
    case 'is': ok = isClause(note, f.value); break;
  }
  return f.negate ? !ok : ok;
}

export function matchFilters(
  note: Note,
  parsed: ParsedQuery,
  notebookName: (id: string | null) => string
): boolean {
  return parsed.filters.every((f) => filterHit(note, f, notebookName));
}

/* ---------------- 全文检索（内存倒排式打分） ---------------- */

function tokenize(query: string): string[] {
  const parts = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    out.push(p);
    // 中文长词按 2-gram 拆开，让「印象笔记使用心得」也能命中「笔记心得」这类不完整查询。
    if (p.length >= 3 && /[\u3400-\u9fff]/.test(p)) {
      for (let i = 0; i < p.length - 1; i++) out.push(p.slice(i, i + 2));
    }
  }
  return Array.from(new Set(out));
}

/** 个人笔记量级（几千篇）现算足够快，不引 SQLite FTS。 */
export function searchNotes(notes: Note[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes.map((note) => ({ note, score: 0, excerptText: '' }));
  const tokens = tokenize(q);
  const hits: SearchHit[] = [];

  for (const note of notes) {
    const title = note.title.toLowerCase();
    const tags = note.tags.join(' ').toLowerCase();
    const body = plainOf(note).toLowerCase();
    let score = 0;
    let matched = 0;

    for (const t of tokens) {
      let hit = false;
      if (title.includes(t)) { score += title === t ? 30 : 14; hit = true; }
      if (tags.includes(t)) { score += 9; hit = true; }
      if (body.includes(t)) { score += 4; hit = true; }
      if (hit) matched += 1;
    }

    // 查询词必须全部有落点，避免「苹果 手机」把只含「苹果」的笔记也搜出来。
    const mainTokens = q.split(/\s+/).filter(Boolean);
    const allMatched = mainTokens.every((t) => {
      if (title.includes(t) || tags.includes(t) || body.includes(t)) return true;
      return t.length >= 3 && /[\u3400-\u9fff]/.test(t) &&
        Array.from({ length: t.length - 1 }, (_, i) => t.slice(i, i + 2))
          .some((g) => title.includes(g) || tags.includes(g) || body.includes(g));
    });

    if (score > 0 && allMatched) {
      const text = plainOf(note);
      const lower = text.toLowerCase();
      const first = mainTokens.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
      const start = first === undefined ? 0 : Math.max(0, first - 30);
      hits.push({
        note,
        score: score + matched * 2,
        excerptText: excerpt(text.slice(start), 120),
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt);
}

/** 给摘要/标题里的命中片段加 <mark>（值已 escape，调用方用 dangerouslySetInnerHTML）。 */
export function highlight(text: string, query: string): string {
  const clean = freeTextOf(query);
  if (!clean.trim()) return escapeHtmlSafe(text);
  const tokens = clean.trim().split(/\s+/).filter(Boolean);
  let html = escapeHtmlSafe(text);
  for (const t of tokens) {
    if (!t) continue;
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    html = html.replace(re, '<mark>$1</mark>');
  }
  return html;
}

function escapeHtmlSafe(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
