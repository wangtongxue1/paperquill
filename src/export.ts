/** 全系统统一的导出入口。
 *
 *  以前三个地方各写一套：列表右键只有 MD/HTML，编辑器菜单有五项，导入导出面板又是另一套，
 *  同一篇笔记在不同入口能导出的格式还不一样。现在都收口到这里：
 *  一份格式清单 + 一个执行函数，谁要导出都调 `openDialog('export', { ids })`。
 */
import JSZip from 'jszip';
import type { Note } from './types';
import { exportSingle } from './io';
import { noteToPdfBlob } from './pdf';
import { noteToDocxBlob } from './docx-export';
import { storage } from './storage';
import { formatDateTime, slugify } from './utils';

export type ExportFormat = 'md' | 'html' | 'docx' | 'pdf' | 'txt' | 'enex';

export interface ExportFormatMeta {
  id: ExportFormat;
  label: string;
  ext: string;
  /** 面板上的一句话说明，写清楚「导出来是什么」。 */
  desc: string;
  /** 多篇一起导出时是否支持。 */
  many: boolean;
}

export const EXPORT_FORMATS: ExportFormatMeta[] = [
  {
    id: 'md', label: 'Markdown', ext: 'md', many: true,
    desc: '纯文本源码，图片以 data URL 内嵌，Obsidian / Typora 都能直接打开',
  },
  {
    id: 'html', label: 'HTML', ext: 'html', many: true,
    desc: '带样式的独立网页，双击就能看，不依赖纸间笔记',
  },
  {
    id: 'docx', label: 'Word', ext: 'docx', many: true,
    desc: '真正的 .docx：标题、表格、图片、列表都保留，Word / WPS 打开就能接着改',
  },
  {
    id: 'pdf', label: 'PDF', ext: 'pdf', many: false,
    desc: '按 A4 排版，版面与屏幕一致；图像型 PDF，适合归档与打印',
  },
  {
    id: 'txt', label: '纯文本', ext: 'txt', many: true,
    desc: '只保留文字，去掉所有格式与图片，方便粘到别处',
  },
  {
    id: 'enex', label: 'ENEX', ext: 'enex', many: true,
    desc: '印象笔记导出格式，可以导入印象笔记等支持 ENEX 的软件',
  },
];

const MIME: Record<ExportFormat, string> = {
  md: 'text/markdown;charset=utf-8',
  html: 'text/html;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
  enex: 'application/xml;charset=utf-8',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const baseOf = (note: Note) => slugify(note.title || '未命名笔记');

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export interface ExportResult {
  name: string;
  count: number;
}

/** 执行导出。单篇出单个文件，多篇按格式打包成 zip（ENEX 天然支持多篇，出单个文件）。 */
export async function exportNotes(notes: Note[], format: ExportFormat, all: Note[]): Promise<ExportResult> {
  if (!notes.length) throw new Error('没有可导出的笔记');
  const stamp = formatDateTime(Date.now()).slice(0, 10);

  if (notes.length === 1) {
    const note = notes[0];
    if (format === 'pdf') {
      const blob = await noteToPdfBlob(note);
      const name = `${baseOf(note)}.pdf`;
      await storage.saveBinary(name, await blobToBase64(blob), MIME.pdf);
      return { name, count: 1 };
    }
    if (format === 'docx') {
      const blob = await noteToDocxBlob(note);
      const name = `${baseOf(note)}.docx`;
      await storage.saveBinary(name, await blobToBase64(blob), MIME.docx);
      return { name, count: 1 };
    }
    const name = `${baseOf(note)}.${format}`;
    await storage.saveText(name, exportSingle(note, format, all), MIME[format]);
    return { name, count: 1 };
  }

  if (format === 'pdf') throw new Error('PDF 一次只能导一篇');

  if (format === 'enex') {
    const name = `纸间笔记-${notes.length}篇-${stamp}.enex`;
    await storage.saveText(name, exportSingle(notes[0], 'enex', notes), MIME.enex);
    return { name, count: notes.length };
  }

  const zip = new JSZip();
  const seen = new Map<string, number>();
  for (const note of notes) {
    const base = baseOf(note);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const file = `${base}${n > 1 ? `-${n}` : ''}.${format}`;
    // docx 是二进制，其余格式都是文本源码。
    if (format === 'docx') {
      const blob = await noteToDocxBlob(note);
      zip.file(file, new Uint8Array(await blob.arrayBuffer()));
    } else {
      zip.file(file, exportSingle(note, format, all));
    }
  }
  const b64 = await zip.generateAsync({ type: 'base64' });
  const name = `纸间笔记-${notes.length}篇-${stamp}-${format}.zip`;
  await storage.saveBinary(name, b64, 'application/zip');
  return { name, count: notes.length };
}
