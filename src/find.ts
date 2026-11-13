/** 编辑器内查找：把文档模型里的纯文本片段定位成可替换的绝对区间。
 *  不碰 HTML 字符串，所以替换时不会破坏标签、链接、图片、待办等结构。 */
import type { Node as PMNode } from '@tiptap/pm/model';

export interface FindRange { from: number; to: number }

/** 逐文本节点查找。命中不会跨格式片段（例如一半加粗一半不加粗），这是刻意取舍：
 *  跨节点替换会拆掉 mark，容易把用户排好的版弄乱。 */
export function findRanges(doc: PMNode, query: string, caseSensitive = false): FindRange[] {
  const out: FindRange[] = [];
  if (!query) return out;
  const needle = caseSensitive ? query : query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    const hay = caseSensitive ? text : text.toLowerCase();
    let i = hay.indexOf(needle);
    while (i >= 0) {
      out.push({ from: pos + i, to: pos + i + query.length });
      i = hay.indexOf(needle, i + Math.max(needle.length, 1));
    }
  });
  return out;
}

/** 源码视图（纯字符串）用的匹配表。 */
export function findStringRanges(text: string, query: string, caseSensitive = false): FindRange[] {
  const out: FindRange[] = [];
  if (!query) return out;
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  let i = hay.indexOf(needle);
  while (i >= 0) {
    out.push({ from: i, to: i + query.length });
    i = hay.indexOf(needle, i + Math.max(needle.length, 1));
  }
  return out;
}

/** 从后往前替换，前面的区间不受影响。 */
export function replaceRanges(text: string, ranges: FindRange[], indices: number[], replacement: string): string {
  let out = text;
  const sorted = [...indices].sort((a, b) => b - a);
  for (const idx of sorted) {
    const r = ranges[idx];
    if (!r) continue;
    out = out.slice(0, r.from) + replacement + out.slice(r.to);
  }
  return out;
}
