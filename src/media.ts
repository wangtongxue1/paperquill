/** 媒体附件：MIME 推断与 data URL 修正。
 *
 *  Windows 上很多音视频扩展名没有注册系统 MIME（.m4a / .mkv / .mov / .amr / .flac …），
 *  选文件时 File.type 会是空字符串，FileReader 生成的 data URL 就成了
 *  `data:application/octet-stream;base64,…`。<audio>/<video> 拿到这种 src 会直接报
 *  MEDIA_ERR_SRC_NOT_SUPPORTED（error.code = 4），表现就是「上传后不能播放」。
 *
 *  对策：① 上传时按扩展名补全 MIME；② 渲染 / 预览时再兜一次，让旧存档里已经
 *  存成 octet-stream 的附件也能播；③ 预览弹窗按扩展名认播放器，别只看 mime。
 */
import type { AttachmentKind } from './types';

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg', wav: 'audio/wav', wave: 'audio/wav', m4a: 'audio/mp4', m4b: 'audio/mp4',
  aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', weba: 'audio/webm',
  flac: 'audio/flac', amr: 'audio/amr', aiff: 'audio/aiff', aif: 'audio/aiff',
  wma: 'audio/x-ms-wma', mid: 'audio/midi', midi: 'audio/midi',
};

const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', ogv: 'video/ogg', mpg: 'video/mpeg',
  mpeg: 'video/mpeg', '3gp': 'video/3gpp', wmv: 'video/x-ms-wmv', ts: 'video/mp2t',
};

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  bmp: 'image/bmp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
};

const MIME_BY_EXT: Record<string, string> = { ...AUDIO_MIME, ...VIDEO_MIME, ...IMAGE_MIME };

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

/** 2.5.9：「插入图片 / 文件」通道只认图片，其余一律当普通文件。
 *  不去看它是不是音视频——音视频只从「插入语音 / 视频」专用入口进来。 */
export function isImageName(name: string, type = ''): boolean {
  return (type || '').toLowerCase().startsWith('image/') || !!IMAGE_MIME[extOf(name)];
}

export function fileChannelKind(name: string, type = ''): AttachmentKind {
  return isImageName(name, type) ? 'image' : 'file';
}

/** 按 mime 优先、扩展名兜底判断附件类型；扩展名比系统 mime 更可靠。 */
export function kindOf(name: string, type = ''): AttachmentKind {
  const t = (type || '').toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  const e = extOf(name);
  if (IMAGE_MIME[e]) return 'image';
  if (AUDIO_MIME[e]) return 'audio';
  if (VIDEO_MIME[e]) return 'video';
  return 'file';
}

/** 给附件定一个浏览器认得的 MIME：扩展名已知时以它为准，否则退回系统 mime / 类型兜底。 */
export function guessMime(name: string, type = '', kind?: AttachmentKind): string {
  const byExt = MIME_BY_EXT[extOf(name)];
  if (byExt) return byExt;
  const t = (type || '').toLowerCase().split(';')[0].trim();
  if (t && t !== 'application/octet-stream') return t;
  if (kind === 'image') return 'image/png';
  if (kind === 'audio') return 'audio/mpeg';
  if (kind === 'video') return 'video/mp4';
  return 'application/octet-stream';
}

/** 把 data URL 的 MIME 段改成能被 <audio>/<video> 解码的类型。
 *  只动 base64 二进制 data URL；文本类（带 charset）与外链原样返回。 */
export function normalizeMediaUrl(dataUrl: string, name: string, mime = '', kind?: AttachmentKind): string {
  if (!dataUrl || !/^data:/i.test(dataUrl)) return dataUrl;
  const i = dataUrl.indexOf(',');
  if (i < 0) return dataUrl;
  const head = dataUrl.slice(0, i);
  if (!/;base64/i.test(head)) return dataUrl;
  const body = dataUrl.slice(i + 1);
  const cur = head.slice(5).split(';')[0].trim().toLowerCase();
  const target = guessMime(name, mime, kind);
  if (!target || target === 'application/octet-stream' || cur === target) return dataUrl;
  return `data:${target};base64,${body}`;
}

/** 预览弹窗该用 audio 还是 video 控件。
 *
 *  2.5.9：扩展名优先；普通文件 / 图片一律不再嗅探音视频内容，
 *  避免从「插入图片 / 文件」进来的附件被误判成播放器。
 *  kind 明确是音视频、或老存档没写 kind 时，仍按 MIME / data URL 头兜底，
 *  这样历史上存坏成 octet-stream 的音视频附件依旧能播。 */
export function mediaTagOf(name: string, mime = '', dataUrl = '', kind?: AttachmentKind): 'audio' | 'video' | null {
  const e = extOf(name);
  if (AUDIO_MIME[e]) return 'audio';
  if (VIDEO_MIME[e]) return 'video';
  if (kind === 'audio') return 'audio';
  if (kind === 'video') return 'video';
  if (kind === 'image' || kind === 'file' || kind === 'board') return null;
  const t = (mime || '').toLowerCase();
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  const cur = ((/^data:([^;,]+)/i.exec(dataUrl || '') || [])[1] || '').toLowerCase();
  if (cur.startsWith('audio/')) return 'audio';
  if (cur.startsWith('video/')) return 'video';
  return null;
}

/* ---------- 文件类型徽标 ----------
 *  以前正文里所有非图片附件都是同一个「📎」emoji，附件区则是同一个灰色文件图标，
 *  HTML / Excel / Word / PPT 完全分不出来。这里按扩展名归成 12 类，给每类一个
 *  短标签和配色：正文链接、文件卡片、附件区、预览弹窗共用同一套，改一处全改。
 */
export type FileKind =
  | 'html' | 'pdf' | 'word' | 'excel' | 'ppt' | 'image' | 'video' | 'audio'
  | 'text' | 'code' | 'archive' | 'file';

/** 前景 / 背景：用固定色值，CSS 伪元素与 React 内联样式都能直接吃。 */
export const FILE_KIND_COLORS: Record<FileKind, [string, string]> = {
  html: ['#a63d18', '#ffeadf'],
  pdf: ['#b3312c', '#fde9e7'],
  word: ['#1f56b0', '#e6efff'],
  excel: ['#12764a', '#e0f4e9'],
  ppt: ['#bb4a10', '#ffeadd'],
  image: ['#6b43b5', '#f0e9ff'],
  video: ['#0d7486', '#ddf3f6'],
  audio: ['#9b3f7f', '#fbe8f4'],
  text: ['#4b5563', '#edf1f5'],
  code: ['#37507a', '#e6edfa'],
  archive: ['#826317', '#fbf0d3'],
  file: ['#4b5563', '#edf1f5'],
};

const EXT_KIND: Record<string, FileKind> = {
  html: 'html', htm: 'html', mhtml: 'html',
  pdf: 'pdf',
  doc: 'word', docx: 'word', docm: 'word', dot: 'word', dotx: 'word', rtf: 'word', odt: 'word', wps: 'word',
  xls: 'excel', xlsx: 'excel', xlsm: 'excel', xlsb: 'excel', csv: 'excel', tsv: 'excel', ods: 'excel', et: 'excel',
  ppt: 'ppt', pptx: 'ppt', pptm: 'ppt', pps: 'ppt', ppsx: 'ppt', odp: 'ppt', dps: 'ppt',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image',
  svg: 'image', avif: 'image', ico: 'image', heic: 'image',
  mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', mkv: 'video', avi: 'video',
  ogv: 'video', mpg: 'video', mpeg: 'video', '3gp': 'video', wmv: 'video', m2ts: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', flac: 'audio',
  amr: 'audio', wma: 'audio', aiff: 'audio', opus: 'audio', mid: 'audio', midi: 'audio',
  md: 'text', markdown: 'text', txt: 'text', log: 'text', enex: 'text',
  json: 'code', xml: 'code', yaml: 'code', yml: 'code', js: 'code', ts: 'code', jsx: 'code',
  tsx: 'code', css: 'code', scss: 'code', py: 'code', java: 'code', go: 'code', rs: 'code',
  sql: 'code', sh: 'code', bat: 'code',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive',
};

/** 附件类型 → 徽标类别；MIME 只作兜底，扩展名更可靠。 */
export function fileKindOf(name: string, mime = '', kind?: AttachmentKind): FileKind {
  const e = extOf(name);
  if (EXT_KIND[e]) return EXT_KIND[e];
  const t = (mime || '').toLowerCase();
  if (t.includes('pdf')) return 'pdf';
  if (t.includes('word') || t.includes('msword') || t.includes('openxmlformats-officedocument.word')) return 'word';
  if (t.includes('excel') || t.includes('spreadsheet') || t.includes('openxmlformats-officedocument.spreadsheet')) return 'excel';
  if (t.includes('powerpoint') || t.includes('presentation')) return 'ppt';
  if (kind === 'image' || kind === 'board' || t.startsWith('image/')) return 'image';
  if (kind === 'video' || t.startsWith('video/')) return 'video';
  if (kind === 'audio' || t.startsWith('audio/')) return 'audio';
  if (t.startsWith('text/html')) return 'html';
  if (t.startsWith('text/')) return 'text';
  return 'file';
}

/** 徽标上显示的短文字：优先用扩展名，最多 4 个字符；认不出来就按类别给。 */
export function fileBadgeLabel(name: string, fk?: FileKind): string {
  const e = extOf(name).toUpperCase();
  if (e && e.length <= 4 && /^[A-Z0-9]+$/.test(e)) return e;
  const fallback: Record<FileKind, string> = {
    html: 'HTML', pdf: 'PDF', word: 'DOC', excel: 'XLS', ppt: 'PPT',
    image: 'IMG', video: 'VID', audio: 'AUD', text: 'TXT',
    code: 'CODE', archive: 'ZIP', file: 'FILE',
  };
  return fallback[fk || fileKindOf(name)];
}

/** data URL（base64）→ 字节：Office / HTML 预览需要先解出原始文件。 */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const i = dataUrl.indexOf(',');
  if (i < 0) return new Uint8Array();
  const head = dataUrl.slice(0, i);
  const body = dataUrl.slice(i + 1);
  try {
    if (!/;base64/i.test(head)) return new TextEncoder().encode(decodeURIComponent(body));
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let n = 0; n < bin.length; n++) bytes[n] = bin.charCodeAt(n);
    return bytes;
  } catch {
    return new Uint8Array();
  }
}
