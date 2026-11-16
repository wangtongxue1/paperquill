/** 表格往返探针：md 导入 → 富文本 → 源码 → 富文本，验证表格不丢格式。
 *  跑法：node tools/run-table-probe.mjs
 */
import { Editor } from '@tiptap/core';
import { buildExtensions } from '../src/editor-schema';
import { fromEditorHtml, toEditorHtml } from '../src/tiptap-html';
import { htmlToMd, mdToHtml } from '../src/convert';

let ok = 0;
let total = 0;
const fails: string[] = [];
const out: string[] = [];
const progressEl = document.getElementById('result') as HTMLPreElement | null;

function mark(step: string) {
  if (progressEl) progressEl.textContent = 'STEP ' + step;
}

function check(name: string, cond: boolean, extra = '') {
  total += 1;
  if (cond) { ok += 1; out.push(`ok  ${name}`); return; }
  fails.push(name);
  out.push(`FAIL ${name}${extra ? ` :: ${extra}` : ''}`);
}

function mount(html: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = new Editor({ element: host, extensions: buildExtensions(), content: toEditorHtml(html) });
  return editor;
}

const GFM_MD = `| 列一 | 列二 | 列三 |
| --- | :---: | ---: |
| a | b | c |
| 管道 \\| 转义 | x | y |`;

try {
  /* ---------- A. md 导入 → 富文本 ---------- */
  mark('A1');
  const htmlFromMd = mdToHtml(GFM_MD);
  out.push('A mdToHtml = ' + htmlFromMd.slice(0, 400));
  mark('A2');
  const edA = mount(htmlFromMd);
  const storedA = fromEditorHtml(edA.getHTML());
  const rowsA = edA.view.dom.querySelectorAll('table tr').length;
  out.push('A editor = ' + edA.getHTML().slice(0, 400));
  check('A1 md 表格进编辑器后是 table 节点', !!edA.view.dom.querySelector('table'));
  check('A2 行数=3（表头+2行）', rowsA === 3, `rows=${rowsA}`);
  check('A3 表头在 thead/th', !!edA.view.dom.querySelector('th'), edA.getHTML().slice(0, 300));
  check('A4 单元格文本完整', storedA.includes('列一') && storedA.includes('转义'), storedA.slice(0, 300));

  /* ---------- B. 富文本 → 源码（关键：turndown 默认不认识 table） ---------- */
  mark('B1');
  const RICH_SEED = `<h2>表</h2>
<table><thead><tr><th>名称</th><th>数量</th></tr></thead>
<tbody><tr><td>苹果</td><td>3</td></tr><tr><td>香 | 蕉</td><td>5</td></tr></tbody></table>`;
  const mdFromRich = htmlToMd(RICH_SEED);
  out.push('B htmlToMd = ' + mdFromRich);
  check('B1 富文本表格转 md 保留 | 分隔', mdFromRich.includes('|'), mdFromRich);
  check('B2 表头保留', mdFromRich.includes('名称') && mdFromRich.includes('数量'), mdFromRich);
  check('B3 行数不丢', mdFromRich.includes('苹果') && mdFromRich.includes('香 \\| 蕉'), mdFromRich);
  check('B4 单元格里的 | 转义', !mdFromRich.includes('|香 '), mdFromRich);

  /* ---------- C. md → rich → md → rich 全程往返 ---------- */
  mark('C1');
  const md2 = htmlToMd(storedA);
  out.push('C 往返 md = ' + md2.slice(0, 300));
  const back = mdToHtml(md2);
  check('C1 往返后表格仍在', /<table/.test(back), back.slice(0, 200));
  mark('C2');
  const edC = mount(back);
  check('C2 往返后行数仍是 3', edC.view.dom.querySelectorAll('table tr').length === 3,
    edC.view.dom.querySelectorAll('table tr').length + ' | ' + edC.getHTML().slice(0, 200));
  check('C3 转义管道往返后不串列', md2.includes('\\|'), md2);

  /* ---------- D. 无表头的纯 td 表格 ---------- */
  mark('D1');
  const TD_TABLE = `<table><tbody><tr><td>一</td><td>二</td></tr><tr><td>1</td><td>2</td></tr></tbody></table>`;
  const mdTd = htmlToMd(TD_TABLE);
  out.push('D td 表 md = ' + mdTd);
  check('D1 纯 td 表格转 md 不丢行', mdTd.includes('一') && mdTd.includes('2'), mdTd);
  const backTd = mdToHtml(mdTd);
  check('D2 纯 td 表格 md 回来仍是表', /<table/.test(backTd), backTd.slice(0, 160));
} catch (err) {
  out.push(`CRASH: ${err}`);
}

mark('final');
const el = document.createElement('pre');
el.id = 'result-final';
el.textContent = `ok=${ok}/${total}\n` + out.join('\n') + '\nRESULT ok=' + ok + '/' + total + (fails.length ? ' fails=' + fails.join(',') : ' all-pass') + '\ndone=1';
document.body.appendChild(el);
