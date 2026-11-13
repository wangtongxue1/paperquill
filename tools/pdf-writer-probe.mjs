#!/usr/bin/env node
/** PDF 写入器的结构断言。
 *
 *  这东西错了不在界面上报错——用户只会发现「导出的 PDF 打不开」。
 *  所以脱离浏览器，用 Node 直接跑 writePdf，再按 PDF 规范回读一遍：
 *  每一处 xref 偏移都必须真的落在 "n 0 obj" 上，/Length 必须等于实际流长。
 *
 *  用法：node tools/pdf-writer-probe.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, '.temp');
const BUNDLE = path.join(OUT_DIR, 'pdf-writer.js');
const PDF_OUT = path.join(OUT_DIR, 'pdf-writer-test.pdf');

fs.mkdirSync(OUT_DIR, { recursive: true });
// 用项目自带的 tsc 把纯逻辑文件编成 ESM（没有依赖，不需要打包器）。
execFileSync('npx', [
  'tsc', 'src/pdf-writer.ts', '--outDir', '.temp', '--module', 'esnext',
  '--target', 'es2020', '--moduleResolution', 'bundler', '--skipLibCheck',
], { cwd: ROOT, stdio: 'pipe', shell: true });

const { writePdf } = await import(pathToFileUrl(BUNDLE));

function pathToFileUrl(p) {
  return new URL(`file://${p.replace(/\\/g, '/')}`).href;
}

// 1×1 白 JPEG：内容不重要，这里验的是容器结构。
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwc' +
  'KDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAA' +
  'AAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

const A4 = { w: 595.28, h: 841.89 };
const PAGES = 4;
const pages = Array.from({ length: PAGES }, (_, i) => ({
  jpeg: new Uint8Array(JPEG),
  pxW: 1, pxH: 1,
  x: 36, y: 36 + i, w: 523.28, h: 769.89,
}));

const bytes = writePdf(pages, A4.w, A4.h);
fs.writeFileSync(PDF_OUT, bytes);

const text = Buffer.from(bytes).toString('latin1');
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

check('header', text.startsWith('%PDF-1.4'), text.slice(0, 8));
check('binary-marker', text.slice(0, 16).includes('%âãÏÓ'));
check('eof', text.trimEnd().endsWith('%%EOF'));
check('page-count', (text.match(/\/Type \/Page[^s]/g) || []).length === PAGES,
  String((text.match(/\/Type \/Page[^s]/g) || []).length));
check('kids', new RegExp(`/Kids \\[(?:\\d+ 0 R ?){${PAGES}}\\]`).test(text));
check('count-dict', text.includes(`/Count ${PAGES}`));

// startxref 指向的字节必须正好是 "xref"
const sx = text.lastIndexOf('startxref');
const offset = Number(text.slice(sx + 9).trim().split(/\s/)[0]);
check('startxref', text.slice(offset, offset + 4) === 'xref', `offset=${offset} got=${text.slice(offset, offset + 10)}`);

// xref 表：第一项 free，之后每个偏移都必须指向 "n 0 obj"
const xrefBlock = text.slice(offset, text.indexOf('trailer', offset));
const lines = xrefBlock.split('\n');
const header = lines[1].trim().split(/\s+/); // "0 6"
const total = Number(header[1]);
const entries = lines.slice(2, 2 + total);
// 对象：1 Catalog + 2 Pages + 每页 3 个；xref 还要多一条 0 号 free 项。
const expectedSize = PAGES * 3 + 3;
check('xref-size', total === expectedSize, `size=${total} expected=${expectedSize}`);
check('xref-entry-len', entries.every((l) => l.length === 19 || l.length === 20),
  `lens=${[...new Set(entries.map((l) => l.length))].join(',')}`);
let xrefOk = true;
let badAt = '';
entries.forEach((line, i) => {
  const off = Number(line.slice(0, 10));
  const expected = `${i} 0 obj`;
  if (i > 0 && text.slice(off, off + expected.length) !== expected) {
    xrefOk = false;
    badAt = `obj ${i} @${off} got "${text.slice(off, off + 12)}"`;
  }
});
check('xref-offsets', xrefOk, badAt);

// 图像流长度必须与实际字节数一致
let lenOk = true;
let lenDetail = '';
pages.forEach((p, i) => {
  const re = new RegExp(`/Subtype /Image[^>]*?/Length (\\d+) >>\\nstream\\n`, 'g');
  const m = [...text.matchAll(re)][i];
  if (!m) { lenOk = false; lenDetail = `page ${i + 1} 找不到 image 字典`; return; }
  if (Number(m[1]) !== p.jpeg.length) {
    lenOk = false;
    lenDetail = `page ${i + 1} /Length=${m[1]} 实际=${p.jpeg.length}`;
  }
});
check('stream-length', lenOk, lenDetail);

// 内容流里的摆放矩阵必须带上页面尺寸
check('content-matrix', text.includes('523.28 0 0') && text.includes('/Im0 Do'));

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? '  ✓' : '  ✗'} ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed.length}/${results.length} 通过 · 输出 ${PDF_OUT} (${bytes.length} 字节)`);
process.exit(failed.length ? 1 : 0);
