import type { Note } from './types';

export function uid(prefix = 'n'): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rnd}`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 把 HTML/Markdown 都压成可搜索、可做摘要的纯文本。 */
export function plainOf(note: Pick<Note, 'content' | 'mode' | 'title' | 'tags'>): string {
  const raw = note.mode === 'rich' ? htmlToText(note.content) : mdToText(note.content);
  return raw.replace(/\s+/g, ' ').trim();
}

export function htmlToText(html: string): string {
  if (typeof document === 'undefined') {
    return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
  }
  const el = document.createElement('div');
  el.innerHTML = html;
  el.querySelectorAll('script,style').forEach((n) => n.remove());
  return (el.textContent || '').replace(/\u00a0/g, ' ');
}

export function mdToText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/[#>*_`~|>-]/g, ' ')
    .replace(/\bdata:image\/[^\s)]+/g, ' ');
}

export function excerpt(text: string, max = 110): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/** 模板卡片上的正文摘要。
 *  不能只把 # * - 这类字符删掉：表格会剩下一串竖线、标题和小节名会连成一团
 *  （「会议信息 时间： 地点： 参会： 议 题 1. 结论」），所以先按行/块去掉结构符号，
 *  再把空白压平。 */
export function templatePreview(content: string, max = 60): string {
  const text = (content || '')
    .replace(/```[\s\S]*?```/g, ' ')                 // 代码块整段不要
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')            // 图片
    .replace(/\[\[([^\]]*)\]\]/g, '$1')               // 内链只留标题
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')          // 链接只留文字
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')               // 标题符号
    .replace(/^\s{0,3}>\s?/gm, '')                    // 引用符号
    .replace(/^\s{0,3}[-*+]\s+\[[ xX]\]\s*/gm, '')    // 待办勾选框
    .replace(/^\s{0,3}([-*+]|\d+[.)])\s+/gm, '')      // 列表符号
    .replace(/^\s*\|?[\s:|-]{3,}\|?[\s:|-]*$/gm, ' ') // 表格分隔行 |---|
    .replace(/\|/g, ' ')                              // 表格竖线
    .replace(/^\s*(-{3,}|\*{3,})\s*$/gm, ' ')         // 分割线
    .replace(/[*_`~]/g, '')                           // 行内强调符号
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

/** 附件大小：小文件不要被四舍五入成 0 KB。 */
export function formatSize(bytes: number): string {
  if (!bytes) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function wordCount(text: string): number {  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (text.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9_\u00c0-\u024f]+/g) || []).length;
  return cjk + words;
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  return `${formatDate(ts)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(ts);
  const today = new Date();
  if (d.getFullYear() === today.getFullYear()) {
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return formatDate(ts);
}

/** Windows / macOS / Linux 都接受的文件名。 */
export function slugify(s: string): string {
  const cleaned = s
    .replace(/[\\/:*?"<>|\r\n\t]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || '未命名笔记';
}

export function downloadBlob(name: string, data: BlobPart, mime = 'text/plain;charset=utf-8'): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function dataUrlToBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return file.text();
}

export function toLocalInputValue(ts: number): string {
  const d = new Date(ts - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export function fromLocalInputValue(v: string): number {
  return new Date(v).getTime();
}
