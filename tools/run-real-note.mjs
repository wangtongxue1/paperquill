// 临时 runner：复用 run-table-probe 的机制跑 verify_real_note.ts
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname ?? '.', '..');
const pnpm = join(ROOT, 'node_modules', '.pnpm');
const esbuild = join(pnpm, readdirSync(pnpm).find(d => d.startsWith('esbuild@')), 'node_modules', 'esbuild', 'bin', 'esbuild');
mkdirSync(join(ROOT, '.temp'), { recursive: true });
execFileSync(process.execPath, [esbuild, join(ROOT, 'tools', 'verify_real_note.ts'), '--bundle', '--format=iife', `--outfile=${join(ROOT, '.temp', 'real.js')}`, '--log-level=warning'], { stdio: 'inherit' });
const js = readFileSync(join(ROOT, '.temp', 'real.js'), 'utf8');
writeFileSync(join(ROOT, '.temp', 'real.html'),
  `<!doctype html><html><head><meta charset="utf-8"></head><body><pre id="result">RUNNING</pre><script>window.onerror=function(m,s,l,c,e){document.getElementById('result').textContent='ERR: '+m+' @'+l+':'+c+'\\n'+((e&&e.stack)||'');};</script><script>try { ${js} } catch (e) { document.getElementById('result').textContent = 'THROW: ' + (e && e.stack || e); } </script></body></html>`);
const edges = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const edge = edges.find(p => { try { execFileSync(p, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } });
const udd = join(ROOT, '.temp', 'edge-real');
const dom = spawnSync(edge, ['--headless=new', `--user-data-dir=${udd}`, '--disable-gpu', '--virtual-time-budget=8000', '--dump-dom', 'file:///' + join(ROOT, '.temp', 'real.html').replace(/\\/g, '/')], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }).stdout;
const m = dom.match(/<pre id="result">([\s\S]*?)<\/pre>/);
console.log(m ? m[1] : dom.slice(0, 800));
