/** 真正的 PDF 导出：把笔记排成 A4 版面，直接落成一个 .pdf 文件。
 *
 *  为什么不用 window.print()：桌面版跑在 WebView2 里，它的打印对话框不一定
 *  带「另存为 PDF」；浏览器版又各有各的界面。用户点「导出为 PDF」就该拿到文件，
 *  而不是被丢进一个还得自己找选项的打印预览。
 *
 *  为什么不用 jsPDF：我们要的只是「把几张图铺到 A4 上」，jsPDF 打包进来 700 KB，
 *  其中 99% 用不到。这里的 writer 只实现图像页（JPEG 直嵌 DCTDecode），
 *  三十行就能写完，还能顺手把分页点对齐到空白行。
 *
 *  链路：离屏渲染白底版式 → html2canvas 截图 → 按 A4 版心切片 → 写 PDF 字节。
 */
import html2canvas from 'html2canvas';
import type { Note } from './types';
import { mdToHtml, resolveAttachmentRefs } from './convert';
import { escapeHtml, formatDateTime, slugify } from './utils';
import { writePdf, type ImagePage } from './pdf-writer';
import { storage } from './storage';

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 36; // pt，四边各 12.7mm
/** 渲染宽度（CSS px）。版心 523.28pt ÷ 720px ≈ 0.727pt/px，15px 正文约 10.9pt。 */
const RENDER_W = 720;

function metaText(note: Note): string {
  const bits = [`纸间笔记 · 导出 ${formatDateTime(Date.now())}`, `修改 ${formatDateTime(note.updatedAt)}`];
  if (note.tags.length) bits.push(`标签：${note.tags.join('、')}`);
  if (note.sourceUrl) bits.push(`来源：${note.sourceUrl}`);
  return bits.join('　');
}

function waitImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'));
  return Promise.all(imgs.map((img) => (img.complete
    ? Promise.resolve()
    : new Promise<void>((res) => {
      img.addEventListener('load', () => res(), { once: true });
      img.addEventListener('error', () => res(), { once: true });
    })))).then(() => undefined);
}

/** 从 limit 往上找一整行白像素，最多回退 240px；找不到就用 limit 硬切。 */
function findBreak(ctx: CanvasRenderingContext2D, width: number, from: number, limit: number): number {
  const lowest = Math.max(from + 48, limit - 240);
  for (let y = limit - 1; y > lowest; y--) {
    const row = ctx.getImageData(0, y, width, 1).data;
    let blank = true;
    for (let i = 0; i < row.length; i += 4) {
      if (row[i] < 248 || row[i + 1] < 248 || row[i + 2] < 248) { blank = false; break; }
    }
    if (blank) return y;
  }
  return limit;
}

function canvasJpeg(canvas: HTMLCanvasElement): Promise<{ jpeg: Uint8Array; pxW: number; pxH: number }> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('图片编码失败')); return; }
      void blob.arrayBuffer().then((buf) => resolve({
        jpeg: new Uint8Array(buf), pxW: canvas.width, pxH: canvas.height,
      }));
    }, 'image/jpeg', 0.92);
  });
}

async function buildPdf(canvas: HTMLCanvasElement): Promise<Blob> {
  const pageW = A4.w - MARGIN * 2;
  const pageH = A4.h - MARGIN * 2;
  const scale = pageW / canvas.width;        // pt / canvas px
  const pageHpx = Math.floor(pageH / scale); // 每页能装多少 canvas 像素

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法读取渲染结果');

  const pages: ImagePage[] = [];
  let y = 0;
  while (y < canvas.height) {
    let slice = Math.min(pageHpx, canvas.height - y);
    if (y + slice < canvas.height) slice = findBreak(ctx, canvas.width, y, y + slice);
    if (slice <= 0) break;

    const page = document.createElement('canvas');
    page.width = canvas.width;
    page.height = slice;
    const pctx = page.getContext('2d');
    if (!pctx) throw new Error('无法创建页面画布');
    pctx.fillStyle = '#ffffff';
    pctx.fillRect(0, 0, page.width, page.height);
    pctx.drawImage(canvas, 0, y, canvas.width, slice, 0, 0, canvas.width, slice);

    const img = await canvasJpeg(page);
    const h = slice * scale;
    pages.push({ ...img, x: MARGIN, y: A4.h - MARGIN - h, w: pageW, h });
    y += slice;
  }
  if (!pages.length) throw new Error('这篇笔记没有可导出的内容');

  const bytes = writePdf(pages, A4.w, A4.h);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000; // 分块，避免 apply 参数过多爆栈
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** 生成 PDF 二进制。失败会抛错，由调用方提示。 */
export async function noteToPdfBlob(note: Note): Promise<Blob> {
  const body = note.mode === 'rich' ? note.content : mdToHtml(note.content, note.attachments);
  const html = resolveAttachmentRefs(body, note.attachments || []);

  const stage = document.createElement('div');
  stage.className = 'pdf-stage';
  stage.style.width = `${RENDER_W}px`;
  stage.innerHTML =
    `<div class="pdf-stage__head">` +
    `<h1>${escapeHtml(note.title || '未命名笔记')}</h1>` +
    `<div class="pdf-stage__meta">${escapeHtml(metaText(note))}</div>` +
    `</div><div class="prose">${html}</div>`;
  // 放在视口外：html2canvas 自己算坐标，负偏移不会丢内容，也不会被用户看到。
  document.body.appendChild(stage);

  try {
    await waitImages(stage);
    // 等一帧，确保字体与布局都算完了再截。
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    const canvas = await html2canvas(stage, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: RENDER_W,
    });
    return await buildPdf(canvas);
  } finally {
    stage.remove();
  }
}

/** 导出并保存（桌面版弹原生保存框，浏览器版直接下载）。返回文件名。 */
export async function exportNotePdf(note: Note): Promise<string> {
  const blob = await noteToPdfBlob(note);
  const name = `${slugify(note.title || '未命名笔记')}.pdf`;
  return await storage.saveBinary(name, await blobToBase64(blob), 'application/pdf');
}

