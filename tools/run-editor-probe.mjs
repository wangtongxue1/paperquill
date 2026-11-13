#!/usr/bin/env node
/** 跑编辑器内核断言：esbuild 打包 → 临时页面 → Edge headless --dump-dom 取结果。
 *
 *  用法：node tools/run-editor-probe.mjs
 *  依赖项目里已有的 esbuild（vite 的传递依赖）与本机 Edge / Chrome。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.temp');
const OUT_JS = join(TMP, 'editor-probe.js');
const OUT_HTML = join(TMP, 'editor-probe.html');

const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

function findEsbuild() {
  const pnpmDir = join(ROOT, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) throw new Error('找不到 node_modules/.pnpm，先 pnpm install');
  const hit = readdirSync(pnpmDir).find((d) => d.startsWith('esbuild@'));
  if (!hit) throw new Error('找不到 esbuild，先 pnpm install');
  return join(pnpmDir, hit, 'node_modules', 'esbuild', 'bin', 'esbuild');
}

const esbuild = findEsbuild();
mkdirSync(TMP, { recursive: true });
execFileSync(process.execPath, [
  esbuild, join(ROOT, 'tools', 'verify_editor.ts'),
  '--bundle', '--format=iife', `--outfile=${OUT_JS}`, '--log-level=warning',
], { stdio: 'inherit' });

const js = readFileSync(OUT_JS, 'utf8');
writeFileSync(OUT_HTML,
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>editor probe</title>\n` +
  `<style>body{font:14px/1.7 sans-serif}li[data-type=taskItem]{display:flex;gap:8px}</style></head>\n` +
  `<body><pre id="out"></pre><script>try {
${js}
} catch (e) { document.getElementById('out').textContent = 'THROW: ' + ((e && e.stack) || e); }</script></body></html>`, 'utf8');

const browser = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error('找不到 Edge / Chrome，无法跑浏览器断言');
  process.exit(1);
}

const res = spawnSync(browser, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--user-data-dir=${join(TMP, 'edge-profile-editor')}`,
  '--window-size=1280,900',
  '--virtual-time-budget=6000', '--dump-dom',
  `file:///${OUT_HTML.replace(/\\/g, '/')}`,
], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

const dom = res.stdout || '';
const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
if (!m) {
  console.error('断言页面没有输出，DOM 片段：\n' + dom.slice(0, 600));
  process.exit(2);
}
const text = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
console.log(text);
const fail = Number((text.match(/fail=(\d+)/) || [])[1] || 0);
process.exit(fail === 0 ? 0 : 3);
