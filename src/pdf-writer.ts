/** 最小 PDF 写入器：只做「把若干张 JPEG 铺到固定尺寸页面上」这一件事。
 *
 *  单独成文件有两个原因：
 *    · 不引 jsPDF——那套东西 700 KB，而我们只需要图像页（JPEG 直嵌 DCTDecode）；
 *    · 纯字节逻辑，可以脱离浏览器用 Node 跑断言（tools/pdf-writer-probe.mjs），
 *      xref 偏移错一位 PDF 就打不开，这种东西必须有测试兜着。
 */

export interface ImagePage {
  jpeg: Uint8Array;
  pxW: number;
  pxH: number;
  /** 在页面上的位置与尺寸（pt，原点在左下角） */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 对象编号：1=Catalog、2=Pages，之后每页占 3 个（Page / Image / Contents）。 */
export function writePdf(pages: ImagePage[], pageW: number, pageH: number): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const put = (part: string | Uint8Array) => {
    const bin = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bin);
    size += bin.length;
  };

  const offsets = new Map<number, number>();
  let next = 3;

  const obj = (num: number, dict: string, stream?: Uint8Array) => {
    offsets.set(num, size);
    put(`${num} 0 obj\n${dict}\n`);
    if (stream) {
      put('stream\n');
      put(stream);
      put('\nendstream\n');
    }
    put('endobj\n');
  };

  put('%PDF-1.4\n');
  // 二进制标记行：告诉工具这是二进制文件，别按文本处理。
  put(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const ids = pages.map(() => {
    const id = { page: next, img: next + 1, content: next + 2 };
    next += 3;
    return id;
  });

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${ids.map((i) => `${i.page} 0 R`).join(' ')}] /Count ${pages.length} >>`);

  pages.forEach((p, i) => {
    const id = ids[i];
    obj(id.page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      `/Resources << /XObject << /Im0 ${id.img} 0 R >> >> /Contents ${id.content} 0 R >>`);
    obj(id.img,
      `<< /Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`,
      p.jpeg);
    const content = enc.encode(
      `q\n${p.w.toFixed(2)} 0 0 ${p.h.toFixed(2)} ${p.x.toFixed(2)} ${p.y.toFixed(2)} cm\n/Im0 Do\nQ\n`
    );
    obj(id.content, `<< /Length ${content.length} >>`, content);
  });

  const xrefAt = size;
  const count = next; // 对象 1..count-1；xref 首项是 free 的 0 号对象
  put(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) {
    put(`${String(offsets.get(n) ?? 0).padStart(10, '0')} 00000 n \n`);
  }
  put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
