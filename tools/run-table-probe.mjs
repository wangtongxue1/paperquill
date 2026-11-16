#!/usr/bin/env node
/** 跑表格往返探针：esbuild 打包 verify_table.ts → 临时页面 → Edge headless --dump-dom。
 *  用法：node tools/run-table-probe.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.temp');
const OUT_JS = join(TMP, 'table-probe.js');
const OUT_HTML = join(TMP, 'table-probe.html');

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
  esbuild, join(ROOT, 'tools', 'verify_table.ts'),
  '--bundle', '--format=iife', `--outfile=${OUT_JS}`, '--log-level=warning',
], { stdio: 'inherit' });

const js = readFileSync(OUT_JS, 'utf8');
writeFileSync(OUT_HTML,
  `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>table probe</title>\n` +
  `<style>body{font:14px/1.7 sans-serif}li[data-type=taskItem]{display:flex;gap:8px}</style></head>\n` +
  `<body><pre id="result">RUNNING</pre><script>window.onerror=function(m,s,l,c,e){document.getElementById('result').textContent='ERR: '+m+' @'+l+':'+c+'\\n'+((e&&e.stack)||'');};window.onunhandledrejection=function(ev){document.getElementById('result').textContent='REJ: '+(ev.reason&&ev.reason.stack||ev.reason);};</script><script>try {
${js}
} catch (e) { document.getElementById('result').textContent = 'THROW: ' + ((e && e.stack) || e); }</script></body></html>`, 'utf8');
console.log('probe 页面已生成');

const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!edge) throw new Error('找不到 Edge/Chrome');
const res = spawnSync(edge, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--user-data-dir=${join(TMP, 'edge-profile-table')}`,
  '--window-size=1280,900',
  '--virtual-time-budget=6000', '--dump-dom',
  `file:///${OUT_HTML.replace(/\\/g, '/')}`,
], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

const dom = res.stdout || '';
const m = dom.match(/<pre id="result-final">([\s\S]*?)<\/pre>/) || dom.match(/<pre id="result">([\s\S]*?)<\/pre>/);
if (!m) { console.error('探针没有产出结果\n' + dom.slice(0, 600)); process.exit(1); }
const text = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
console.log(text);
const fail = Number((text.match(/ok=(\d+)\/(\d+)/) || []));
process.exit(fail[1] === fail[2] ? 0 : 3);
